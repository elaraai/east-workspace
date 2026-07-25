/*
 * BEAST2 v5 streaming writer + sequential segment reader — the public
 * bounded-memory APIs (east_beast2_writer_* / east_beast2_reader_*).
 * The Python bridge in east-py wraps these 1:1.
 */

#include "internal_v5.h"

/* ================================================================== */
/*  Streaming writer                                                   */
/* ================================================================== */

struct Beast2StreamWriter {
    EastType *type; /* retained root collection type */
    int32_t codec;
    bool with_index;
    bool finished;
    bool failed;
    B2V5EncodeCtx ctx;
    ByteBuffer *pending;  /* bytes not yet drained by take() */
    size_t total_emitted; /* all bytes ever appended to pending */
    size_t *seg_offsets;
    size_t *seg_counts;
    size_t seg_count;
    size_t seg_cap;
};

Beast2StreamWriter *east_beast2_writer_new(EastType *type, int32_t codec_id, bool self_contained,
                                           bool with_index)
{
    if (!type) return NULL;
    if (!b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5 streams hold Array, Set or Dict values");
        return NULL;
    }
    if (codec_id != EAST_BEAST2_CODEC_NONE && codec_id != EAST_BEAST2_CODEC_DEFLATE) {
        east_builtin_error("beast2 v5: unsupported codec id");
        return NULL;
    }
    if (!east_type_type) east_type_of_type_init();

    Beast2StreamWriter *w = calloc(1, sizeof(*w));
    if (!w) return NULL;
    w->type = type;
    east_type_retain(type);
    w->codec = codec_id;
    w->with_index = with_index;
    b2v5_enc_ctx_init(&w->ctx, NULL, self_contained);
    w->pending = byte_buffer_new(256);
    if (!w->pending) {
        east_type_release(w->type);
        free(w);
        return NULL;
    }

    /* Header: magic + type section + (empty) source map section, then the
     * root tag as its own frame so every segment frame is pure. The root
     * container consumes definition 0 (no root object exists on the encode
     * side — batches are independent values, so nothing can alias it). */
    byte_buffer_write_bytes(w->pending, BEAST2_MAGIC_V5, 8);
    b2v5_write_type_section(w->pending, type);
    b2v5_write_source_map_section(NULL, w->pending);
    static const uint8_t tag_new = B2V5_TAG_NEW;
    b2v5_write_frame(w->pending, &tag_new, 1, EAST_BEAST2_CODEC_NONE);
    w->ctx.def_count = 1;
    w->ctx.segment_base_def = 1;
    w->total_emitted = w->pending->len;
    return w;
}

bool east_beast2_writer_write(Beast2StreamWriter *w, EastValue *batch)
{
    if (!w || !batch) return false;
    if (w->finished || w->failed) {
        east_builtin_error("beast2 v5: write() after finish()");
        return false;
    }

    size_t n = 0;
    switch (w->type->kind) {
    case EAST_TYPE_ARRAY:
        if (batch->kind != EAST_VAL_ARRAY) goto wrong_kind;
        n = batch->data.array.len;
        break;
    case EAST_TYPE_SET:
        if (batch->kind != EAST_VAL_SET) goto wrong_kind;
        n = batch->data.set.len;
        break;
    case EAST_TYPE_DICT:
        if (batch->kind != EAST_VAL_DICT) goto wrong_kind;
        n = batch->data.dict.len;
        break;
    default:
        goto wrong_kind;
    }
    /* Empty batches are skipped — segment counts are never zero, so the
     * stream terminator stays unambiguous. */
    if (n == 0) return true;

    b2v5_enc_ctx_begin_segment(&w->ctx);

    ByteBuffer *logical = byte_buffer_new(256);
    if (!logical) return false;
    write_varint(logical, (uint64_t)n);
    switch (w->type->kind) {
    case EAST_TYPE_ARRAY:
        for (size_t i = 0; i < n && !w->ctx.failed; i++)
            b2v5_encode_value(logical, batch->data.array.items[i], w->type->data.element, &w->ctx);
        break;
    case EAST_TYPE_SET:
        for (size_t i = 0; i < n && !w->ctx.failed; i++)
            b2v5_encode_value(logical, east_set_at(batch, i), w->type->data.element, &w->ctx);
        break;
    default:
        for (size_t i = 0; i < n && !w->ctx.failed; i++) {
            b2v5_encode_value(logical, east_dict_key_at(batch, i), w->type->data.dict.key, &w->ctx);
            b2v5_encode_value(logical, east_dict_val_at(batch, i), w->type->data.dict.value,
                              &w->ctx);
        }
        break;
    }
    if (w->ctx.failed) {
        byte_buffer_free(logical);
        w->failed = true;
        return false;
    }

    if (w->seg_count == w->seg_cap) {
        size_t new_cap = w->seg_cap ? w->seg_cap * 2 : 16;
        size_t *offsets = realloc(w->seg_offsets, new_cap * sizeof(size_t));
        if (offsets) w->seg_offsets = offsets;
        size_t *counts = realloc(w->seg_counts, new_cap * sizeof(size_t));
        if (counts) w->seg_counts = counts;
        if (!offsets || !counts) {
            byte_buffer_free(logical);
            w->failed = true;
            return false;
        }
        w->seg_cap = new_cap;
    }
    w->seg_offsets[w->seg_count] = w->total_emitted;
    w->seg_counts[w->seg_count] = n;
    w->seg_count++;

    size_t before = w->pending->len;
    b2v5_write_frame(w->pending, logical->data, logical->len, w->codec);
    w->total_emitted += w->pending->len - before;
    byte_buffer_free(logical);
    return true;

wrong_kind:
    east_builtin_error("beast2 v5: batch value does not match the stream's collection type");
    w->failed = true;
    return false;
}

ByteBuffer *east_beast2_writer_take(Beast2StreamWriter *w)
{
    if (!w || w->pending->len == 0) return NULL;
    ByteBuffer *out = w->pending;
    w->pending = byte_buffer_new(256);
    if (!w->pending) {
        /* Restore so the writer stays usable; the caller sees no bytes. */
        w->pending = out;
        return NULL;
    }
    return out;
}

bool east_beast2_writer_finish(Beast2StreamWriter *w)
{
    if (!w) return false;
    if (w->finished) return !w->failed;
    if (w->failed) return false;
    w->finished = true;

    static const uint8_t terminator = 0x00;
    size_t before = w->pending->len;
    b2v5_write_frame(w->pending, &terminator, 1, EAST_BEAST2_CODEC_NONE);
    w->total_emitted += w->pending->len - before;

    if (w->with_index) {
        bool self_contained = w->ctx.self_contained && !w->ctx.cross_segment_ref;
        before = w->pending->len;
        b2v5_write_index_footer(w->pending, w->total_emitted, w->seg_offsets, w->seg_counts,
                                w->seg_count, self_contained);
        w->total_emitted += w->pending->len - before;
    }
    return true;
}

void east_beast2_writer_free(Beast2StreamWriter *w)
{
    if (!w) return;
    if (w->type) east_type_release(w->type);
    b2v5_enc_ctx_free(&w->ctx);
    if (w->pending) byte_buffer_free(w->pending);
    free(w->seg_offsets);
    free(w->seg_counts);
    free(w);
}

/* ================================================================== */
/*  Sequential segment reader                                          */
/* ================================================================== */

struct Beast2SegmentReader {
    const uint8_t *data; /* borrowed — caller keeps it alive and unchanged */
    size_t len;
    EastType *type; /* retained decode type */
    B2V5Frames frames;
    B2V5DecodeCtx ctx;
    EastValue *root_placeholder; /* definition 0; owned, never returned */
    EastSourceMap sm;            /* owned (header + inline deltas) */
    B2V5Index index;
    bool has_index;
    bool started;
    bool done;
    bool failed;
};

Beast2SegmentReader *east_beast2_reader_new(const uint8_t *data, size_t len, EastType *type)
{
    if (!data || !type) return NULL;
    if (!b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5 segment reading needs an Array, Set or Dict type");
        return NULL;
    }

    Beast2SegmentReader *r = calloc(1, sizeof(*r));
    if (!r) return NULL;

    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) {
        free(r);
        return NULL;
    }
    /* The wire root type only advances the header; decoding follows the
     * caller's type, exactly like east_beast2_decode_full. */
    east_type_release(h.root_type);
    h.root_type = NULL;

    r->data = data;
    r->len = len;
    r->type = type;
    east_type_retain(type);
    r->sm = h.sm; /* take ownership */
    memset(&h.sm, 0, sizeof(h.sm));
    b2v5_frames_init(&r->frames, data, len, h.frame_offset);
    b2v5_dec_ctx_init(&r->ctx, &r->sm);

    int ix = b2v5_read_index(data, len, &r->index);
    if (ix == -1) {
        east_beast2_reader_free(r);
        return NULL;
    }
    r->has_index = ix == 1;
    return r;
}

static bool reader_start(Beast2SegmentReader *r)
{
    if (!b2v5_frames_next(&r->frames)) return false;
    if (b2v5_chunk_exhausted(&r->frames)) return false;
    uint8_t tag = r->frames.chunk[r->frames.chunk_off++];
    if (tag != B2V5_TAG_NEW) {
        east_builtin_error("beast2 v5: root container must be NEW");
        return false;
    }
    /* Definition 0 is the root container. Segments never alias it, but the
     * numbering must match the writer's, so register a placeholder. */
    if (r->type->kind == EAST_TYPE_ARRAY) {
        r->root_placeholder = east_array_new(r->type->data.element);
    } else if (r->type->kind == EAST_TYPE_SET) {
        r->root_placeholder = east_set_new(r->type->data.element);
    } else {
        r->root_placeholder = east_dict_new(r->type->data.dict.key, r->type->data.dict.value);
    }
    if (!r->root_placeholder) return false;
    if (!b2v5_dec_ctx_push(&r->ctx, r->root_placeholder)) return false;
    r->started = true;
    return true;
}

EastValue *east_beast2_reader_next(Beast2SegmentReader *r)
{
    if (!r || r->done || r->failed) return NULL;
    if (!r->started) {
        if (!reader_start(r)) {
            r->failed = true;
            return NULL;
        }
    }

    if (b2v5_chunk_exhausted(&r->frames)) {
        if (!b2v5_frames_next(&r->frames)) {
            r->failed = true;
            return NULL;
        }
    }
    uint64_t n;
    if (!read_varint_checked(r->frames.chunk, r->frames.chunk_len, &r->frames.chunk_off, &n)) {
        east_builtin_error("beast2 v5: malformed segment header");
        r->failed = true;
        return NULL;
    }
    if (n == 0) {
        /* Terminator: the chunk must be exhausted and the remaining wire
         * bytes must be nothing or the (already parsed) index + footer. */
        r->done = true;
        if (!b2v5_chunk_exhausted(&r->frames)) {
            east_builtin_error("beast2 v5: logical bytes after the root terminator");
            r->failed = true;
        } else if (r->has_index) {
            if (r->index.index_offset != r->frames.wire_offset) {
                east_builtin_error("beast2 v5: index offset does not match the value stream");
                r->failed = true;
            }
        } else if (r->frames.wire_offset != r->len) {
            east_builtin_error("beast2 v5: trailing bytes after the value stream");
            r->failed = true;
        }
        return NULL;
    }
    if (n > r->frames.chunk_len - r->frames.chunk_off) {
        east_builtin_error("beast2 v5: segment count exceeds its frame");
        r->failed = true;
        return NULL;
    }

    EastValue *segment;
    if (r->type->kind == EAST_TYPE_ARRAY) {
        segment = east_array_new_with_capacity(r->type->data.element, (size_t)n);
    } else if (r->type->kind == EAST_TYPE_SET) {
        segment = east_set_new_with_capacity(r->type->data.element, (size_t)n);
    } else {
        segment = east_dict_new_with_capacity(r->type->data.dict.key, r->type->data.dict.value,
                                              (size_t)n);
    }
    if (!segment) {
        r->failed = true;
        return NULL;
    }
    if (!b2v5_decode_elements_into(segment, r->type, n, r->frames.chunk, r->frames.chunk_len,
                                   &r->frames.chunk_off, &r->ctx)) {
        east_value_release(segment);
        east_builtin_error("beast2 v5: malformed segment");
        r->failed = true;
        return NULL;
    }
    return segment;
}

bool east_beast2_reader_done(Beast2SegmentReader *r)
{
    return r && r->done && !r->failed;
}

bool east_beast2_reader_counts(Beast2SegmentReader *r, size_t *segment_count, size_t *element_count)
{
    if (!r || !r->has_index) return false;
    if (segment_count) *segment_count = r->index.count;
    if (element_count) *element_count = r->index.total;
    return true;
}

void east_beast2_reader_free(Beast2SegmentReader *r)
{
    if (!r) return;
    if (r->type) east_type_release(r->type);
    if (r->root_placeholder) east_value_release(r->root_placeholder);
    b2v5_frames_dispose(&r->frames);
    b2v5_dec_ctx_free(&r->ctx);
    beast2_source_map_free(&r->sm);
    b2v5_index_free(&r->index);
    free(r);
}
