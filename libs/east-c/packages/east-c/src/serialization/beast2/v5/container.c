/*
 * BEAST2 v5 container — frames, header sections, index/footer, and the
 * whole-value encode/decode entry points behind the ../full.c dispatch.
 * Wire specification: libs/east/src/serialization/beast2/v5/SPEC.md.
 */

#include "internal_v5.h"

/* ================================================================== */
/*  Frames                                                             */
/* ================================================================== */

/* Frames with payloads below this size are stored uncompressed. */
#define B2V5_COMPRESSION_THRESHOLD 64

void b2v5_write_frame(ByteBuffer *buf, const uint8_t *logical, size_t logical_len, int32_t codec_id)
{
    if (codec_id == EAST_BEAST2_CODEC_DEFLATE && logical_len >= B2V5_COMPRESSION_THRESHOLD) {
        uint8_t *compressed = NULL;
        size_t compressed_len = 0;
        if (b2v5_deflate_raw(logical, logical_len, &compressed, &compressed_len) &&
            compressed_len < logical_len) {
            write_varint(buf, EAST_BEAST2_CODEC_DEFLATE);
            write_varint(buf, (uint64_t)logical_len);
            write_varint(buf, (uint64_t)compressed_len);
            byte_buffer_write_bytes(buf, compressed, compressed_len);
            free(compressed);
            return;
        }
        free(compressed);
    }
    write_varint(buf, EAST_BEAST2_CODEC_NONE);
    write_varint(buf, (uint64_t)logical_len);
    write_varint(buf, (uint64_t)logical_len);
    byte_buffer_write_bytes(buf, logical, logical_len);
}

void b2v5_frames_init(B2V5Frames *f, const uint8_t *data, size_t len, size_t first_frame_offset)
{
    memset(f, 0, sizeof(*f));
    f->data = data;
    f->len = len;
    f->wire_offset = first_frame_offset;
}

void b2v5_frames_dispose(B2V5Frames *f)
{
    free(f->chunk_owned);
    f->chunk_owned = NULL;
    f->chunk = NULL;
    f->chunk_len = 0;
    f->chunk_off = 0;
}

bool b2v5_frames_next(B2V5Frames *f)
{
    free(f->chunk_owned);
    f->chunk_owned = NULL;
    f->chunk = NULL;
    f->chunk_len = 0;
    f->chunk_off = 0;

    if (f->wire_offset >= f->len) {
        east_builtin_error("beast2 v5: truncated value stream (expected another frame)");
        return false;
    }

    size_t offset = f->wire_offset;
    uint64_t codec, uncompressed_len, payload_len;
    if (!read_varint_checked(f->data, f->len, &offset, &codec)) goto malformed;
    if (!read_varint_checked(f->data, f->len, &offset, &uncompressed_len)) goto malformed;
    if (!read_varint_checked(f->data, f->len, &offset, &payload_len)) goto malformed;

    if (codec != EAST_BEAST2_CODEC_NONE && codec != EAST_BEAST2_CODEC_DEFLATE) {
        char msg[96];
        if (codec == 2) {
            snprintf(msg, sizeof(msg),
                     "beast2 v5: frame uses codec 2 (zstd), which this runtime does not support");
        } else {
            snprintf(msg, sizeof(msg), "beast2 v5: unknown frame codec %llu",
                     (unsigned long long)codec);
        }
        east_builtin_error(msg);
        return false;
    }
    if (uncompressed_len > B2V5_MAX_FRAME_UNCOMPRESSED) {
        east_builtin_error("beast2 v5: frame uncompressed length exceeds the 1 GiB limit");
        return false;
    }
    if (codec == EAST_BEAST2_CODEC_NONE && payload_len != uncompressed_len) goto malformed;
    if (payload_len > f->len - offset) goto malformed;

    if (codec == EAST_BEAST2_CODEC_NONE) {
        f->chunk = f->data + offset;
        f->chunk_len = (size_t)payload_len;
    } else {
        uint8_t *out = malloc(uncompressed_len ? (size_t)uncompressed_len : 1);
        if (!out) return false;
        if (!b2v5_inflate_raw(f->data + offset, (size_t)payload_len, out,
                              (size_t)uncompressed_len)) {
            free(out);
            east_builtin_error("beast2 v5: frame failed to inflate to its declared length");
            return false;
        }
        f->chunk_owned = out;
        f->chunk = out;
        f->chunk_len = (size_t)uncompressed_len;
    }
    f->wire_offset = offset + (size_t)payload_len;
    return true;

malformed:
    east_builtin_error("beast2 v5: malformed frame header");
    return false;
}

/* ================================================================== */
/*  Type section                                                       */
/* ================================================================== */

/* FNV-1a 64 — must match the TS and Python implementations bit-for-bit. */
static uint64_t b2v5_fnv1a64(const uint8_t *data, size_t len)
{
    uint64_t hash = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < len; i++) {
        hash ^= data[i];
        hash *= 0x100000001b3ULL;
    }
    return hash;
}

/* Encode a type's structural section bytes (the v4 type-table section). */
static ByteBuffer *b2v5_structural_bytes(EastType *type)
{
    Beast2FlatTypeTable tt;
    flat_tt_init(&tt);
    size_t root_idx = flat_tt_add_et(&tt, type);
    ByteBuffer *buf = byte_buffer_new(128);
    if (buf) write_type_table_section(root_idx, &tt, buf);
    flat_tt_free(&tt);
    return buf;
}

/* Lazily computed well-known schema encodings (single-thread contract). */
typedef struct {
    uint32_t id;
    EastType **type_slot; /* address of the runtime's type singleton */
    const char *name;
    ByteBuffer *bytes;
    uint64_t hash;
} B2V5WellKnown;

static B2V5WellKnown b2v5_well_known[] = {
    {B2V5_WELL_KNOWN_IR_TYPE, &east_ir_type, "IRType", NULL, 0},
    {B2V5_WELL_KNOWN_EAST_TYPE_VALUE_TYPE, &east_type_type, "EastTypeValueType", NULL, 0},
};
#define B2V5_WELL_KNOWN_COUNT (sizeof(b2v5_well_known) / sizeof(b2v5_well_known[0]))

static B2V5WellKnown *b2v5_well_known_entry(size_t i)
{
    B2V5WellKnown *e = &b2v5_well_known[i];
    if (!e->bytes) {
        if (!east_type_type) east_type_of_type_init();
        if (!*e->type_slot) return NULL;
        e->bytes = b2v5_structural_bytes(*e->type_slot);
        if (!e->bytes) return NULL;
        e->hash = b2v5_fnv1a64(e->bytes->data, e->bytes->len);
    }
    return e;
}

void b2v5_write_type_section(ByteBuffer *buf, EastType *type)
{
    ByteBuffer *structural = b2v5_structural_bytes(type);
    if (!structural) return;
    for (size_t i = 0; i < B2V5_WELL_KNOWN_COUNT; i++) {
        B2V5WellKnown *e = b2v5_well_known_entry(i);
        if (!e || e->bytes->len != structural->len ||
            memcmp(e->bytes->data, structural->data, structural->len) != 0)
            continue;
        write_varint(buf, B2V5_TYPE_SECTION_WELL_KNOWN);
        write_varint(buf, e->id);
        uint64_t hash = e->hash;
        for (int b = 0; b < 8; b++) {
            byte_buffer_write_u8(buf, (uint8_t)(hash & 0xff));
            hash >>= 8;
        }
        byte_buffer_free(structural);
        return;
    }
    write_varint(buf, B2V5_TYPE_SECTION_STRUCTURAL);
    byte_buffer_write_bytes(buf, structural->data, structural->len);
    byte_buffer_free(structural);
}

EastType *b2v5_read_type_section(const uint8_t *data, size_t len, size_t *offset)
{
    uint64_t kind;
    if (!read_varint_checked(data, len, offset, &kind)) return NULL;

    if (kind == B2V5_TYPE_SECTION_STRUCTURAL) {
        TypeTableResult tt = read_type_table_section(data, len, offset);
        EastType *root = tt.root_type;
        if (root) east_type_retain(root);
        type_table_result_free(&tt);
        return root;
    }
    if (kind != B2V5_TYPE_SECTION_WELL_KNOWN && kind != B2V5_TYPE_SECTION_WELL_KNOWN_FALLBACK) {
        east_builtin_error("beast2 v5: unknown type section kind");
        return NULL;
    }
    bool has_fallback = kind == B2V5_TYPE_SECTION_WELL_KNOWN_FALLBACK;

    uint64_t id;
    if (!read_varint_checked(data, len, offset, &id)) return NULL;
    if (*offset + 8 > len) return NULL;
    uint64_t hash = 0;
    for (int b = 7; b >= 0; b--) {
        hash = (hash << 8) | data[*offset + (size_t)b];
    }
    *offset += 8;

    for (size_t i = 0; i < B2V5_WELL_KNOWN_COUNT; i++) {
        if (b2v5_well_known[i].id != id) continue;
        B2V5WellKnown *e = b2v5_well_known_entry(i);
        if (!e) return NULL;
        if (e->hash == hash) {
            /* The whole point: skip the schema entirely. */
            if (has_fallback) {
                uint64_t section_len;
                if (!read_varint_checked(data, len, offset, &section_len)) return NULL;
                if (section_len > len - *offset) return NULL;
                *offset += (size_t)section_len;
            }
            east_type_retain(*e->type_slot);
            return *e->type_slot;
        }
        if (!has_fallback) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                     "beast2 v5: well-known type %u (%s) hash mismatch — blob 0x%016llx, "
                     "this runtime 0x%016llx; the encoding and decoding runtimes disagree on "
                     "the schema",
                     e->id, e->name, (unsigned long long)hash, (unsigned long long)e->hash);
            east_builtin_error(msg);
            return NULL;
        }
        /* Drifted, but the blob carries its own schema — decode that rather
         * than silently substituting this runtime's idea of the id. */
        break;
    }

    if (!has_fallback) {
        char msg[192];
        snprintf(msg, sizeof(msg),
                 "beast2 v5: unknown well-known type id %llu with no structural fallback — the "
                 "blob was written by a newer runtime whose format registry this one lacks",
                 (unsigned long long)id);
        east_builtin_error(msg);
        return NULL;
    }

    /* Unknown (or drifted) id carrying a fallback: decode the structural
     * bytes exactly as a kind-0 section. */
    {
        TypeTableResult tt = read_type_table_section(data, len, offset);
        EastType *root = tt.root_type;
        if (root) east_type_retain(root);
        type_table_result_free(&tt);
        return root;
    }
}

/* ================================================================== */
/*  Source map section (inline filenames)                              */
/* ================================================================== */

void b2v5_write_stacks(ByteBuffer *buf, EastSourceMap *sm, size_t from, size_t to)
{
    for (size_t i = from; i < to; i++) {
        size_t count = sm->stack_counts[i];
        write_varint(buf, (uint64_t)count);
        for (size_t j = 0; j < count; j++) {
            EastLocation *loc = &sm->stacks[i][j];
            const char *fn = loc->filename ? loc->filename : "";
            size_t fn_len = strlen(fn);
            write_varint(buf, (uint64_t)fn_len);
            byte_buffer_write_bytes(buf, (const uint8_t *)fn, fn_len);
            write_varint(buf, (uint64_t)loc->line);
            write_varint(buf, (uint64_t)loc->column);
        }
    }
}

bool b2v5_append_stacks(EastSourceMap *sm, const uint8_t *data, size_t len, size_t *offset,
                        uint64_t n_new)
{
    /* Each stack needs at least its frame-count varint. */
    if (n_new > len - *offset) return false;
    size_t old_count = sm->num_stacks > 0 ? sm->num_stacks : 1;
    size_t new_count = old_count + (size_t)n_new;
    EastLocation **stacks = realloc(sm->stacks, new_count * sizeof(EastLocation *));
    if (!stacks) return false;
    sm->stacks = stacks;
    size_t *counts = realloc(sm->stack_counts, new_count * sizeof(size_t));
    if (!counts) return false;
    sm->stack_counts = counts;
    if (sm->num_stacks == 0) {
        /* Materialize the implicit empty sentinel at index 0. */
        sm->stacks[0] = NULL;
        sm->stack_counts[0] = 0;
    }
    for (size_t i = old_count; i < new_count; i++) {
        sm->stacks[i] = NULL;
        sm->stack_counts[i] = 0;
    }
    sm->num_stacks = old_count; /* grow as stacks parse successfully */

    for (uint64_t s = 0; s < n_new; s++) {
        uint64_t frame_count;
        if (!read_varint_checked(data, len, offset, &frame_count)) return false;
        /* Each frame needs >= 3 bytes (three varints). */
        if (frame_count > (len - *offset) / 3) return false;
        size_t idx = sm->num_stacks;
        sm->stack_counts[idx] = (size_t)frame_count;
        if (frame_count > 0) {
            sm->stacks[idx] = calloc((size_t)frame_count, sizeof(EastLocation));
            if (!sm->stacks[idx]) return false;
            for (uint64_t j = 0; j < frame_count; j++) {
                size_t fn_len;
                char *fn = b2_read_string_varint(data, len, offset, &fn_len);
                if (!fn) return false;
                uint64_t line, col;
                if (!read_varint_checked(data, len, offset, &line) ||
                    !read_varint_checked(data, len, offset, &col)) {
                    free(fn);
                    return false;
                }
                sm->stacks[idx][j].filename = fn;
                sm->stacks[idx][j].line = (int64_t)line;
                sm->stacks[idx][j].column = (int64_t)col;
            }
        }
        sm->num_stacks = idx + 1;
    }
    return true;
}

void b2v5_write_source_map_section(EastSourceMap *sm, ByteBuffer *buf)
{
    ByteBuffer *payload = byte_buffer_new(64);
    if (!payload) return;
    if (!sm || sm->num_stacks <= 1) {
        write_varint(payload, 0);
    } else {
        write_varint(payload, (uint64_t)(sm->num_stacks - 1));
        b2v5_write_stacks(payload, sm, 1, sm->num_stacks);
    }
    write_varint(buf, (uint64_t)payload->len);
    byte_buffer_write_bytes(buf, payload->data, payload->len);
    byte_buffer_free(payload);
}

bool b2v5_read_source_map_section(const uint8_t *data, size_t len, size_t *offset,
                                  EastSourceMap *sm_out)
{
    memset(sm_out, 0, sizeof(*sm_out));
    uint64_t payload_len;
    if (!read_varint_checked(data, len, offset, &payload_len)) return false;
    if (payload_len > len - *offset) return false;
    size_t section_end = *offset + (size_t)payload_len;

    uint64_t stack_count;
    if (!read_varint_checked(data, section_end, offset, &stack_count)) return false;
    if (stack_count > 0) {
        if (!b2v5_append_stacks(sm_out, data, section_end, offset, stack_count)) {
            beast2_source_map_free(sm_out);
            return false;
        }
    }
    if (*offset != section_end) {
        beast2_source_map_free(sm_out);
        return false;
    }
    return true;
}

/* ================================================================== */
/*  Header                                                             */
/* ================================================================== */

bool b2v5_read_header(const uint8_t *data, size_t len, B2V5Header *h)
{
    memset(h, 0, sizeof(*h));
    if (!data || len < 8) return false;
    if (memcmp(data, BEAST2_MAGIC_V5, 8) != 0) return false;
    if (!east_type_type) east_type_of_type_init();

    size_t offset = 8;
    h->root_type = b2v5_read_type_section(data, len, &offset);
    if (!h->root_type) return false;
    if (!b2v5_read_source_map_section(data, len, &offset, &h->sm)) {
        east_type_release(h->root_type);
        h->root_type = NULL;
        east_builtin_error("beast2 v5: malformed source map section");
        return false;
    }
    h->frame_offset = offset;
    return true;
}

void b2v5_header_dispose(B2V5Header *h)
{
    if (h->root_type) east_type_release(h->root_type);
    h->root_type = NULL;
    beast2_source_map_free(&h->sm);
}

/* ================================================================== */
/*  Index + footer                                                     */
/* ================================================================== */

void b2v5_write_index_footer(ByteBuffer *buf, size_t index_offset, const size_t *offsets,
                             const size_t *counts, size_t n, bool self_contained)
{
    write_varint(buf, self_contained ? B2V5_INDEX_FLAG_SELF_CONTAINED : 0);
    write_varint(buf, (uint64_t)n);
    size_t prev = 0;
    for (size_t i = 0; i < n; i++) {
        write_varint(buf, (uint64_t)(offsets[i] - prev));
        write_varint(buf, (uint64_t)counts[i]);
        prev = offsets[i];
    }
    uint64_t off = (uint64_t)index_offset;
    for (int b = 0; b < 8; b++) {
        byte_buffer_write_u8(buf, (uint8_t)(off & 0xff));
        off >>= 8;
    }
    byte_buffer_write_bytes(buf, BEAST2_FOOTER_MAGIC_V5, 8);
}

int b2v5_read_index(const uint8_t *data, size_t len, B2V5Index *out)
{
    memset(out, 0, sizeof(*out));
    if (len < 16) return 0;
    size_t footer_start = len - 16;
    if (memcmp(data + footer_start + 8, BEAST2_FOOTER_MAGIC_V5, 8) != 0) return 0;

    uint64_t index_offset = 0;
    for (int b = 7; b >= 0; b--) {
        index_offset = (index_offset << 8) | data[footer_start + (size_t)b];
    }
    if (index_offset < 8 || index_offset >= footer_start) {
        east_builtin_error("beast2 v5: footer index offset out of range");
        return -1;
    }

    size_t offset = (size_t)index_offset;
    uint64_t flags, segment_count;
    if (!read_varint_checked(data, footer_start, &offset, &flags)) goto malformed;
    if (flags & ~(uint64_t)B2V5_INDEX_FLAG_SELF_CONTAINED) {
        east_builtin_error("beast2 v5: unknown index flags");
        return -1;
    }
    if (!read_varint_checked(data, footer_start, &offset, &segment_count)) goto malformed;
    /* Each segment entry needs >= 2 bytes (two varints). */
    if (segment_count > (footer_start - offset) / 2) goto malformed;

    out->count = (size_t)segment_count;
    if (out->count > 0) {
        out->offsets = calloc(out->count, sizeof(size_t));
        out->counts = calloc(out->count, sizeof(size_t));
        if (!out->offsets || !out->counts) goto malformed;
    }
    {
        size_t prev = 0;
        for (size_t i = 0; i < out->count; i++) {
            uint64_t delta, count;
            if (!read_varint_checked(data, footer_start, &offset, &delta)) goto malformed;
            if (!read_varint_checked(data, footer_start, &offset, &count)) goto malformed;
            prev += (size_t)delta;
            if (prev >= (size_t)index_offset) goto malformed;
            out->offsets[i] = prev;
            out->counts[i] = (size_t)count;
            out->total += (size_t)count;
        }
    }
    if (offset != footer_start) goto malformed;
    out->index_offset = (size_t)index_offset;
    out->self_contained = (flags & B2V5_INDEX_FLAG_SELF_CONTAINED) != 0;
    return 1;

malformed:
    b2v5_index_free(out);
    east_builtin_error("beast2 v5: malformed index section");
    return -1;
}

void b2v5_index_free(B2V5Index *ix)
{
    free(ix->offsets);
    free(ix->counts);
    memset(ix, 0, sizeof(*ix));
}

/* ================================================================== */
/*  Whole-value encode                                                 */
/* ================================================================== */

ByteBuffer *east_beast2_encode_v5(EastValue *value, EastType *type, int32_t codec_id,
                                  bool with_index)
{
    if (!value || !type) return NULL;
    if (codec_id != EAST_BEAST2_CODEC_NONE && codec_id != EAST_BEAST2_CODEC_DEFLATE) {
        east_builtin_error("beast2 v5: unsupported codec id");
        return NULL;
    }
    /* The post-encode error check reads the shared error slot; drain any
     * stale message a caller left unconsumed. */
    free(east_builtin_get_error());
    if (!east_type_type) east_type_of_type_init();

    /* Header source map: only a root function value carries one up front;
     * maps on nested functions travel as inline deltas. */
    EastSourceMap *header_sm = NULL;
    if ((type->kind == EAST_TYPE_FUNCTION || type->kind == EAST_TYPE_ASYNC_FUNCTION) &&
        value->kind == EAST_VAL_FUNCTION && value->data.function.compiled) {
        header_sm = value->data.function.compiled->source_map;
    }

    B2V5EncodeCtx ctx;
    b2v5_enc_ctx_init(&ctx, header_sm, false);

    ByteBuffer *buf = byte_buffer_new(256);
    if (!buf) {
        b2v5_enc_ctx_free(&ctx);
        return NULL;
    }
    byte_buffer_write_bytes(buf, BEAST2_MAGIC_V5, 8);
    b2v5_write_type_section(buf, type);
    b2v5_write_source_map_section(header_sm, buf);

    bool indexed = with_index && b2v5_is_segmented_root(type);
    if (!indexed) {
        ByteBuffer *logical = byte_buffer_new(256);
        if (!logical) {
            byte_buffer_free(buf);
            b2v5_enc_ctx_free(&ctx);
            return NULL;
        }
        b2v5_encode_value(logical, value, type, &ctx);
        if (!ctx.failed) b2v5_write_frame(buf, logical->data, logical->len, codec_id);
        byte_buffer_free(logical);
    } else {
        /* Indexed layout: tag frame, one segment frame, terminator frame —
         * every indexed segment frame holds exactly varint(n) + n elements.
         * The root container is definition 0; nested REFs to it resolve via
         * the identity map (refcount-1 roots are elided as usual). */
        b2v5_enc_ctx_register(&ctx, value);
        ctx.segment_base_def = 1;

        static const uint8_t tag_new = B2V5_TAG_NEW;
        static const uint8_t terminator = 0x00;
        b2v5_write_frame(buf, &tag_new, 1, EAST_BEAST2_CODEC_NONE);

        size_t n = 0;
        if (type->kind == EAST_TYPE_ARRAY)
            n = value->data.array.len;
        else if (type->kind == EAST_TYPE_SET)
            n = value->data.set.len;
        else
            n = value->data.dict.len;

        size_t seg_offsets[1];
        size_t seg_counts[1];
        size_t seg_n = 0;

        if (n > 0) {
            ByteBuffer *logical = byte_buffer_new(256);
            if (!logical) {
                byte_buffer_free(buf);
                b2v5_enc_ctx_free(&ctx);
                return NULL;
            }
            write_varint(logical, (uint64_t)n);
            if (type->kind == EAST_TYPE_ARRAY) {
                for (size_t i = 0; i < n && !ctx.failed; i++)
                    b2v5_encode_value(logical, value->data.array.items[i], type->data.element,
                                      &ctx);
            } else if (type->kind == EAST_TYPE_SET) {
                for (size_t i = 0; i < n && !ctx.failed; i++)
                    b2v5_encode_value(logical, east_set_at(value, i), type->data.element, &ctx);
            } else {
                for (size_t i = 0; i < n && !ctx.failed; i++) {
                    b2v5_encode_value(logical, east_dict_key_at(value, i), type->data.dict.key,
                                      &ctx);
                    b2v5_encode_value(logical, east_dict_val_at(value, i), type->data.dict.value,
                                      &ctx);
                }
            }
            if (!ctx.failed) {
                seg_offsets[0] = buf->len;
                seg_counts[0] = n;
                seg_n = 1;
                b2v5_write_frame(buf, logical->data, logical->len, codec_id);
            }
            byte_buffer_free(logical);
        }
        if (!ctx.failed) {
            b2v5_write_frame(buf, &terminator, 1, EAST_BEAST2_CODEC_NONE);
            b2v5_write_index_footer(buf, buf->len, seg_offsets, seg_counts, seg_n,
                                    !ctx.cross_segment_ref);
        }
    }

    b2v5_enc_ctx_free(&ctx);

    /* Surface any posted encode error as NULL (same dance as the v4 path). */
    {
        char *saved_err = east_builtin_get_error();
        if (saved_err) {
            byte_buffer_free(buf);
            east_builtin_error(saved_err);
            free(saved_err);
            return NULL;
        }
    }
    return buf;
}

/* ================================================================== */
/*  Whole-value decode                                                 */
/* ================================================================== */

/* Decode the value stream with `decode_type`, enforcing whole-stream
 * strictness. On success returns the value and leaves the accumulated
 * source map in h->sm (inline deltas included). */
static EastValue *b2v5_decode_stream(const uint8_t *data, size_t len, B2V5Header *h,
                                     EastType *decode_type, bool frozen)
{
    B2V5DecodeCtx ctx;
    b2v5_dec_ctx_init(&ctx, &h->sm);
    ctx.frozen = frozen;
    B2V5Frames frames;
    b2v5_frames_init(&frames, data, len, h->frame_offset);

    EastValue *result = NULL;
    size_t *seg_counts = NULL;
    size_t seg_count = 0, seg_cap = 0;
    bool segmented = b2v5_is_segmented_root(decode_type);
    /* One strict-ascent state across all root segments: Set/Dict wire content
     * is the canonical value, so segments concatenate in ascending order. */
    B2V5OrderCheck order = {0};
    B2V5OrderCheck *op = segmented && decode_type->kind != EAST_TYPE_ARRAY ? &order : NULL;

    if (!b2v5_frames_next(&frames)) goto done;

    if (!segmented) {
        result =
            b2v5_decode_value(frames.chunk, frames.chunk_len, &frames.chunk_off, decode_type, &ctx);
        if (result && !b2v5_chunk_exhausted(&frames)) {
            east_value_release(result);
            result = NULL;
            east_builtin_error("beast2 v5: logical bytes after the root value");
        }
        if (result && frames.wire_offset != len) {
            east_value_release(result);
            result = NULL;
            east_builtin_error("beast2 v5: trailing bytes after the value stream");
        }
        goto done;
    }

    /* Segmented (Array/Set/Dict) root. */
    {
        if (b2v5_chunk_exhausted(&frames)) goto corrupt;
        uint8_t tag = frames.chunk[frames.chunk_off++];
        if (tag != B2V5_TAG_NEW) {
            east_builtin_error("beast2 v5: root container must be NEW");
            goto done;
        }
        EastValue *container;
        if (decode_type->kind == EAST_TYPE_ARRAY) {
            container = east_array_new(decode_type->data.element);
        } else if (decode_type->kind == EAST_TYPE_SET) {
            container = east_set_new(decode_type->data.element);
        } else {
            container = east_dict_new(decode_type->data.dict.key, decode_type->data.dict.value);
        }
        if (!container) goto done;
        if (ctx.frozen) east_value_set_frozen(container);
        if (!b2v5_dec_ctx_push(&ctx, container)) {
            east_value_release(container);
            goto done;
        }

        for (;;) {
            if (b2v5_chunk_exhausted(&frames)) {
                if (!b2v5_frames_next(&frames)) {
                    east_value_release(container);
                    goto done;
                }
            }
            uint64_t n;
            if (!read_varint_checked(frames.chunk, frames.chunk_len, &frames.chunk_off, &n)) {
                east_value_release(container);
                goto corrupt;
            }
            if (n == 0) break;
            if (!b2_container_count_within_bounds(n, decode_type,
                                                  frames.chunk_len - frames.chunk_off)) {
                east_value_release(container);
                goto corrupt;
            }
            if (seg_count == seg_cap) {
                size_t new_cap = seg_cap ? seg_cap * 2 : 16;
                size_t *grown = realloc(seg_counts, new_cap * sizeof(size_t));
                if (!grown) {
                    east_value_release(container);
                    goto done;
                }
                seg_counts = grown;
                seg_cap = new_cap;
            }
            seg_counts[seg_count++] = (size_t)n;
            if (!b2v5_decode_elements_into(container, decode_type, n, frames.chunk,
                                           frames.chunk_len, &frames.chunk_off, &ctx, op)) {
                east_value_release(container);
                goto corrupt;
            }
        }
        if (!b2v5_chunk_exhausted(&frames)) {
            east_value_release(container);
            east_builtin_error("beast2 v5: logical bytes after the root terminator");
            goto done;
        }

        /* Trailing bytes must be nothing or a consistent index + footer. */
        if (frames.wire_offset != len) {
            B2V5Index ix;
            int r = b2v5_read_index(data, len, &ix);
            bool ok = r == 1 && ix.index_offset == frames.wire_offset && ix.count == seg_count;
            if (ok) {
                for (size_t i = 0; i < seg_count; i++) {
                    if (ix.counts[i] != seg_counts[i]) {
                        ok = false;
                        break;
                    }
                }
            }
            if (r == 1) b2v5_index_free(&ix);
            if (!ok) {
                east_value_release(container);
                if (r != -1)
                    east_builtin_error("beast2 v5: trailing bytes are not a "
                                       "consistent index + footer");
                goto done;
            }
        }
        result = container;
    }
    goto done;

corrupt: {
    /* Keep a specific posted message (e.g. the canonical-order violation)
     * over the generic one. */
    char *specific = east_builtin_get_error();
    if (specific) {
        east_builtin_error(specific);
        free(specific);
    } else {
        east_builtin_error("beast2 v5: malformed value stream");
    }
}

done:
    b2v5_order_check_dispose(&order);
    free(seg_counts);
    b2v5_frames_dispose(&frames);
    b2v5_dec_ctx_free(&ctx);
    return result;
}

EastValue *east_beast2_v5_decode_full(const uint8_t *data, size_t len, EastType *type, bool frozen)
{
    if (!data || !type) return NULL;
    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) return NULL;
    EastValue *result = b2v5_decode_stream(data, len, &h, type, frozen);
    b2v5_header_dispose(&h);
    return result;
}

EastValue *east_beast2_v5_decode_auto(const uint8_t *data, size_t len)
{
    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) return NULL;
    EastValue *result = b2v5_decode_stream(data, len, &h, h.root_type, false);
    b2v5_header_dispose(&h);
    return result;
}

IRNode *east_beast2_v5_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out,
                                 EastSourceMap **source_map_out)
{
    if (ir_value_out) *ir_value_out = NULL;
    if (source_map_out) *source_map_out = NULL;
    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) return NULL;
    if (!east_ir_type) east_type_of_type_init();

    EastValue *ir_value = b2v5_decode_stream(data, len, &h, east_ir_type, false);
    if (!ir_value) {
        b2v5_header_dispose(&h);
        return NULL;
    }

    IRNode *ir = east_ir_from_value(ir_value);

    if (ir_value_out) {
        *ir_value_out = ir_value;
    } else {
        east_value_release(ir_value);
    }

    /* Hand ownership of the (header + inline deltas) source map to the caller
     * if requested — same contract as the v4 path. */
    if (source_map_out && h.sm.num_stacks > 0) {
        EastSourceMap *heap_sm = calloc(1, sizeof(EastSourceMap));
        if (heap_sm) {
            *heap_sm = h.sm;
            memset(&h.sm, 0, sizeof(h.sm));
            *source_map_out = heap_sm;
        }
    }
    b2v5_header_dispose(&h);
    return ir;
}

EastType *east_beast2_v5_extract_type(const uint8_t *data, size_t len)
{
    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) return NULL;
    EastType *root = h.root_type;
    east_type_retain(root);
    b2v5_header_dispose(&h);
    return root;
}
