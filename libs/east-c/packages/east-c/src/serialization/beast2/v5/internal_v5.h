/*
 * BEAST2 v5 internal shared declarations — the segment-terminated record
 * stream (issue #416). Private to the v5 implementation files; the public
 * API surface is in east/serialization.h and the version dispatch in
 * ../full.c. Wire specification: libs/east/src/serialization/beast2/v5/SPEC.md.
 */

#ifndef BEAST2_INTERNAL_V5_H
#define BEAST2_INTERNAL_V5_H

#include "../internal.h"

/* ================================================================== */
/*  Wire constants                                                     */
/* ================================================================== */

#define B2V5_TAG_NEW 0x00
#define B2V5_TAG_REF 0x01

#define B2V5_TYPE_SECTION_STRUCTURAL 0
#define B2V5_TYPE_SECTION_WELL_KNOWN 1
/* id + hash + structural bytes. DECODE-ONLY in this release: nothing emits
 * it. It exists so a later release can add a well-known id and decoders
 * shipped now fall back to the structural bytes rather than hard-failing on
 * an id they have never heard of. The well-known registry below is part of
 * the wire format (mirrored in the TS and Python runtimes), not a runtime
 * extension point — see v5/SPEC.md. */
#define B2V5_TYPE_SECTION_WELL_KNOWN_FALLBACK 2

#define B2V5_WELL_KNOWN_IR_TYPE 1
#define B2V5_WELL_KNOWN_EAST_TYPE_VALUE_TYPE 2

#define B2V5_INDEX_FLAG_SELF_CONTAINED 0x01

/* Decompression-bomb guard: max declared uncompressed bytes per frame. */
#define B2V5_MAX_FRAME_UNCOMPRESSED ((uint64_t)1 << 30)

/* ================================================================== */
/*  Deflate (v5/deflate.c — miniz raw DEFLATE)                          */
/* ================================================================== */

/* Compress src into a malloc'd raw-DEFLATE buffer (caller frees *out). */
bool b2v5_deflate_raw(const uint8_t *src, size_t src_len, uint8_t **out, size_t *out_len);
/* Inflate a raw-DEFLATE stream into dst; the output must be exactly dst_len. */
bool b2v5_inflate_raw(const uint8_t *src, size_t src_len, uint8_t *dst, size_t dst_len);

/* ================================================================== */
/*  Frames (v5/container.c)                                             */
/* ================================================================== */

/* Sequential cursor over the value stream's frames. The current logical
 * chunk is either a view into the blob (codec none) or an owned buffer
 * (deflate). The driver stops pulling frames once the logical value
 * encoding self-terminates. */
typedef struct {
    const uint8_t *data; /* whole blob (borrowed) */
    size_t len;
    size_t wire_offset;   /* next unread frame */
    const uint8_t *chunk; /* current logical chunk */
    size_t chunk_len;
    size_t chunk_off;
    uint8_t *chunk_owned; /* non-NULL when the chunk is malloc'd (deflate) */
} B2V5Frames;

void b2v5_frames_init(B2V5Frames *f, const uint8_t *data, size_t len, size_t first_frame_offset);
/* Consume the next frame into the current chunk. Posts an error and returns
 * false on truncation, unknown codec, or inconsistent lengths. */
bool b2v5_frames_next(B2V5Frames *f);
void b2v5_frames_dispose(B2V5Frames *f);

static inline bool b2v5_chunk_exhausted(const B2V5Frames *f)
{
    return f->chunk_off >= f->chunk_len;
}

/* Append one frame carrying `logical` to buf. codec_id degrades to none for
 * tiny or incompressible payloads. */
void b2v5_write_frame(ByteBuffer *buf, const uint8_t *logical, size_t logical_len,
                      int32_t codec_id);

/* ================================================================== */
/*  Header: type section + source map section (v5/container.c)          */
/* ================================================================== */

/* Write the v5 type section (well-known on exact match, else structural). */
void b2v5_write_type_section(ByteBuffer *buf, EastType *type);
/* Read the v5 type section; returns a retained root type or NULL (error posted). */
EastType *b2v5_read_type_section(const uint8_t *data, size_t len, size_t *offset);

/* Write / read the v5 source map section (inline filenames, no string table). */
void b2v5_write_source_map_section(EastSourceMap *sm, ByteBuffer *buf);
bool b2v5_read_source_map_section(const uint8_t *data, size_t len, size_t *offset,
                                  EastSourceMap *sm_out);

/* Write stacks [from, to) of sm as an inline delta payload (no length prefix). */
void b2v5_write_stacks(ByteBuffer *buf, EastSourceMap *sm, size_t from, size_t to);
/* Append n_new stacks parsed from data to sm (grows the arrays). */
bool b2v5_append_stacks(EastSourceMap *sm, const uint8_t *data, size_t len, size_t *offset,
                        uint64_t n_new);

/* Parsed v5 header. */
typedef struct {
    EastType *root_type; /* retained */
    EastSourceMap sm;    /* owned */
    size_t frame_offset; /* first value-stream frame */
} B2V5Header;

/* Verify the v5 magic and parse the header sections. */
bool b2v5_read_header(const uint8_t *data, size_t len, B2V5Header *h);
void b2v5_header_dispose(B2V5Header *h);

/* ================================================================== */
/*  Index + footer (v5/container.c)                                     */
/* ================================================================== */

typedef struct {
    size_t *offsets;     /* absolute wire offset of each segment's frame */
    size_t *counts;      /* element (pair) count of each segment */
    size_t count;        /* number of segments */
    size_t total;        /* sum of counts */
    size_t index_offset; /* wire offset the footer points at */
    bool self_contained;
} B2V5Index;

/* Returns 1 with *out populated, 0 when the blob has no v5 footer, or -1
 * (error posted) when a footer is present but the index is malformed. */
int b2v5_read_index(const uint8_t *data, size_t len, B2V5Index *out);
void b2v5_index_free(B2V5Index *ix);

/* Append the index section + footer for the given segments. */
void b2v5_write_index_footer(ByteBuffer *buf, size_t index_offset, const size_t *offsets,
                             const size_t *counts, size_t n, bool self_contained);

/* ================================================================== */
/*  Value codec (v5/codec.c)                                            */
/* ================================================================== */

typedef struct {
    /* Identity map: EastValue* → definition index. Containers with
     * ref_count == 1 at encode time cannot recur in the walk and are never
     * inserted (refcount-1 elision); the definition counter still counts
     * them so decoder numbering matches. */
    Beast2PtrSlot *map;
    int map_mask;
    int map_count;
    size_t def_count;        /* definitions so far (counter) */
    size_t segment_base_def; /* definitions before the current root segment */
    bool cross_segment_ref;  /* some REF reached below segment_base_def */
    bool self_contained;     /* forbids inline source-map growth */
    EastSourceMap *sm;       /* stream source map (borrowed; adopted from the
                                first function value carrying one) */
    size_t sm_emitted;       /* stacks on the wire, incl. the empty sentinel */
    bool failed;             /* an error has been posted */
} B2V5EncodeCtx;

void b2v5_enc_ctx_init(B2V5EncodeCtx *ctx, EastSourceMap *header_sm, bool self_contained);
void b2v5_enc_ctx_free(B2V5EncodeCtx *ctx);
/* Reset per-segment aliasing scope (self-contained writers, per segment). */
void b2v5_enc_ctx_begin_segment(B2V5EncodeCtx *ctx);
/* Register a container definition without writing a tag (the root container
 * of a segmented stream — its NEW tag is framed separately). */
void b2v5_enc_ctx_register(B2V5EncodeCtx *ctx, EastValue *value);

/* Encode one value (logical bytes) — containers emit NEW/REF + segments. */
void b2v5_encode_value(ByteBuffer *buf, EastValue *value, EastType *type, B2V5EncodeCtx *ctx);

typedef struct {
    EastValue **defs; /* decoded containers in definition order (borrowed) */
    size_t def_count;
    size_t def_cap;
    EastSourceMap *sm; /* borrowed; owned by the entry point / reader */
    int depth;
} B2V5DecodeCtx;

void b2v5_dec_ctx_init(B2V5DecodeCtx *ctx, EastSourceMap *sm);
void b2v5_dec_ctx_free(B2V5DecodeCtx *ctx);
bool b2v5_dec_ctx_push(B2V5DecodeCtx *ctx, EastValue *container);

/* Decode one value from the current logical chunk. Returns a retained value
 * or NULL (error posted where a message helps). */
EastValue *b2v5_decode_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                             B2V5DecodeCtx *ctx);

/* Decode n elements (pairs for Dict) from the current chunk into container. */
bool b2v5_decode_elements_into(EastValue *container, EastType *container_type, uint64_t n,
                               const uint8_t *data, size_t len, size_t *offset, B2V5DecodeCtx *ctx);

/* ================================================================== */
/*  Whole-value entry helpers (v5/container.c)                          */
/* ================================================================== */

static inline bool b2v5_is_segmented_root(const EastType *type)
{
    return type && (type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
                    type->kind == EAST_TYPE_DICT);
}

#endif /* BEAST2_INTERNAL_V5_H */
