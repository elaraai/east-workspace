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
/* Inflate at most dst_cap bytes of a stream's logical prefix (fence probes).
 * Returns bytes produced, or 0 on corruption. */
size_t b2v5_inflate_prefix(const uint8_t *src, size_t src_len, uint8_t *dst, size_t dst_cap);

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

/* Write / read the v5 source map section (inline filenames, no string table).
 * The reader appends into a FRESH (empty) map — east_source_map_new() — so the
 * map's own bookkeeping (its reference count) is never touched. */
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
    EastSourceMap *sm;   /* heap map: one reference (NULL once stolen by a reader) */
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
    EastSourceMap *sm; /* borrowed from the entry point / reader; every decoded
                          closure takes its own reference to it */
    int depth;
    /* Brand every constructed container/Ref/Vector/Matrix at construction
     * (task-input decodes). Cleared around Function subtrees — a decoded
     * closure and its captures stay mutable. */
    bool frozen;
    /* Column projection (issue #599). When a projection drives the decode,
     * every definition records the SHAPE it decoded under (`def_plans`,
     * parallel to `defs`): NULL for a wire-shaped decode, a B2V5ProjNode*
     * for a narrowed one, B2V5_PROJ_SKIPPED for a parsed-and-skipped
     * subtree. A REF must resolve to a definition of the SAME shape — a
     * container aliased across the projection boundary would otherwise
     * serve a value whose layout disagrees with the reference site's type,
     * which is the worst available failure — so a mismatch posts the
     * B2V5_PROJ_ALIAS_MSG error and the caller falls back to a whole
     * decode. All three fields stay zero when no projection is active, and
     * the tag reader then skips the check entirely. */
    bool proj_active;
    const void *cur_shape;  /* shape of the value being decoded right now */
    const void **def_plans; /* per-definition shape, parallel to defs */
} B2V5DecodeCtx;

/* def_plans marker for a definition whose bytes were parsed and skipped. */
extern const void *const B2V5_PROJ_SKIPPED;

/* The detectable prefix of every projection-alias error (python retries the
 * segment as a whole decode when it sees this). */
#define B2V5_PROJ_ALIAS_MSG                                                                        \
    "beast2 v5 projection alias: a shared container crosses the projection "                       \
    "boundary — decode without a projection"

void b2v5_dec_ctx_init(B2V5DecodeCtx *ctx, EastSourceMap *sm);
void b2v5_dec_ctx_free(B2V5DecodeCtx *ctx);
bool b2v5_dec_ctx_push(B2V5DecodeCtx *ctx, EastValue *container);

/* Decode one value from the current logical chunk. Returns a retained value
 * or NULL (error posted where a message helps). */
EastValue *b2v5_decode_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                             B2V5DecodeCtx *ctx);

/* Read a container tag (v5/codec.c). Returns 1 and sets *aliased (retained)
 * for REF, 0 for NEW, -1 for corruption or a projection-shape mismatch. */
int b2v5_read_container_tag(const uint8_t *data, size_t len, size_t *offset, B2V5DecodeCtx *ctx,
                            EastValue **aliased);

/* Running strict-ascent state for Set/Dict content. The wire must hold the
 * canonical value — elements/keys strictly ascending across the container's
 * whole content, segments concatenating — so decoders validate against the
 * previously accepted key and reject violations as corruption. Threading one
 * state across consecutive segments extends the check over the boundary; a
 * fresh state validates a single segment in isolation. */
typedef struct {
    EastValue *prev; /* retained; NULL until the first element lands */
} B2V5OrderCheck;

static inline void b2v5_order_check_dispose(B2V5OrderCheck *order)
{
    if (order && order->prev) {
        east_value_release(order->prev);
        order->prev = NULL;
    }
}

/* Accept `next` into the running strict-ascent state (v5/codec.c); false
 * posts the canonical-order corruption error and leaves `next` untouched. */
bool b2v5_order_accept(B2V5OrderCheck *order, EastValue *next, bool is_dict);

/* Decode n elements (pairs for Dict) from the current chunk into container.
 * `order` is required for Set/Dict content (pass NULL for Array). */
bool b2v5_decode_elements_into(EastValue *container, EastType *container_type, uint64_t n,
                               const uint8_t *data, size_t len, size_t *offset, B2V5DecodeCtx *ctx,
                               B2V5OrderCheck *order);

/* ================================================================== */
/*  Column projection (v5/project.c, issue #599)                        */
/* ================================================================== */

/* One node of a validated projection plan, mirroring the wire type. */
typedef struct B2V5ProjNode {
    EastType *wire; /* retained */
    EastType *proj; /* retained */
    int mode;       /* B2V5_PROJ_WHOLE | B2V5_PROJ_NARROW */
    /* NARROW struct: one child per WIRE field (NULL = parse-and-skip), with
     * proj_idx[i] the kept field's index in the projected struct (-1 when
     * skipped). NARROW variant: one child per case (never NULL). NARROW
     * array/ref: children[0] = element. NARROW dict: children[0] = value
     * (keys never project — they order the container). */
    struct B2V5ProjNode **children;
    size_t n_children;
    int *proj_idx;
} B2V5ProjNode;

#define B2V5_PROJ_WHOLE 0
#define B2V5_PROJ_NARROW 1

struct Beast2Projection {
    B2V5ProjNode *root;
};

/* Decode one projected value from the current chunk (NULL = error posted). */
EastValue *b2v5_decode_value_projected(const uint8_t *data, size_t len, size_t *offset,
                                       const B2V5ProjNode *node, B2V5DecodeCtx *ctx);

/* Decode n root elements (pairs for Dict) into container under the plan.
 * `order` is required for Dict content (Set roots never project narrow). */
bool b2v5_decode_elements_into_projected(EastValue *container, const B2V5ProjNode *root, uint64_t n,
                                         const uint8_t *data, size_t len, size_t *offset,
                                         B2V5DecodeCtx *ctx, B2V5OrderCheck *order);

/* ================================================================== */
/*  Whole-value entry helpers (v5/container.c)                          */
/* ================================================================== */

/* Create an empty container for one decoded segment of `type`. Shared by the
 * sequential reader and the pager so the three-way switch exists once. */
static inline EastValue *b2v5_new_segment_container(EastType *type, size_t cap)
{
    if (type->kind == EAST_TYPE_ARRAY) return east_array_new_with_capacity(type->data.element, cap);
    if (type->kind == EAST_TYPE_SET) return east_set_new_with_capacity(type->data.element, cap);
    return east_dict_new_with_capacity(type->data.dict.key, type->data.dict.value, cap);
}

static inline bool b2v5_is_segmented_root(const EastType *type)
{
    return type && (type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
                    type->kind == EAST_TYPE_DICT);
}

#endif /* BEAST2_INTERNAL_V5_H */
