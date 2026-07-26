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
    if (!b2_container_count_within_bounds(n, r->type, r->frames.chunk_len - r->frames.chunk_off)) {
        east_builtin_error("beast2 v5: segment count exceeds its frame");
        r->failed = true;
        return NULL;
    }

    EastValue *segment = b2v5_new_segment_container(r->type, (size_t)n);
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

/* ================================================================== */
/*  Paging reader — random access over an indexed, self-contained blob  */
/* ================================================================== */

/*  Deliberately shares nothing mutable with the sequential reader above.
 *  A pager holds only the parsed header/index; the frame cursor and decode
 *  context are LOCALS per call, so repeated seeks cannot corrupt each other
 *  and every error path frees exactly what it allocated.
 *
 *  The critical divergence: the pager must NOT run reader_start(). That
 *  consumes the root NEW tag and registers definition 0, which is stream
 *  position state. A self-contained segment decodes against an EMPTY
 *  definition table — REF deltas are relative, so the numbering works out —
 *  and a blob mis-flagged as self-contained then trips the delta bounds
 *  check with a real error instead of silently resolving a cross-segment
 *  backref to an empty placeholder. Wrong data is worse than no data.  */

struct Beast2Pages {
    const uint8_t *data; /* borrowed — caller keeps it alive and unchanged */
    size_t len;
    EastType *type;     /* retained decode type */
    EastSourceMap sm;   /* owned (header) */
    B2V5Index index;    /* owned */
    size_t *cumulative; /* prefix sums of index.counts; NULL when count == 0 */
};

Beast2Pages *east_beast2_pages_new(const uint8_t *data, size_t len, EastType *type)
{
    if (!data || !type) {
        east_builtin_error("beast2 v5: paging needs a blob and a decode type");
        return NULL;
    }
    if (!b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5 segment reading needs an Array, Set or Dict type");
        return NULL;
    }
    /* Pre-check the magic: b2v5_read_header returns false silently on a bad
     * prefix, and "not a v5 blob" deserves a message the caller can act on. */
    if (len < 8) {
        char msg[64];
        snprintf(msg, sizeof(msg), "Data too short for Beast2 format: %zu bytes", len);
        east_builtin_error(msg);
        return NULL;
    }
    if (memcmp(data, BEAST2_MAGIC, 7) == 0 && data[7] == 0x04) {
        east_builtin_error("beast2 v5: segment APIs need a v5 blob; this is a v4 container "
                           "(re-encode with version 5)");
        return NULL;
    }
    if (memcmp(data, BEAST2_MAGIC_V5, 8) != 0) {
        east_builtin_error("beast2 v5: not a beast2 v5 container");
        return NULL;
    }

    Beast2Pages *p = calloc(1, sizeof(*p));
    if (!p) return NULL;

    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) {
        free(p);
        return NULL;
    }
    /* The wire root type only advances the header; decoding follows the
     * caller's type, exactly like the sequential reader. */
    east_type_release(h.root_type);
    h.root_type = NULL;

    p->data = data;
    p->len = len;
    p->type = type;
    east_type_retain(type);
    p->sm = h.sm; /* take ownership */
    memset(&h.sm, 0, sizeof(h.sm));

    int ix = b2v5_read_index(data, len, &p->index);
    if (ix == -1) {
        east_beast2_pages_free(p);
        return NULL;
    }
    if (ix == 0) {
        east_builtin_error("beast2 v5: blob carries no index — random access needs one "
                           "(write with the index enabled, the default)");
        east_beast2_pages_free(p);
        return NULL;
    }

    if (p->index.count > 0) {
        p->cumulative = malloc(p->index.count * sizeof(*p->cumulative));
        if (!p->cumulative) {
            east_beast2_pages_free(p);
            return NULL;
        }
        size_t running = 0;
        for (size_t i = 0; i < p->index.count; i++) {
            running += p->index.counts[i];
            p->cumulative[i] = running;
        }
    }
    return p;
}

size_t east_beast2_pages_segment_count(Beast2Pages *p)
{
    return p ? p->index.count : 0;
}

size_t east_beast2_pages_element_count(Beast2Pages *p)
{
    return p ? p->index.total : 0;
}

bool east_beast2_pages_self_contained(Beast2Pages *p)
{
    return p && p->index.self_contained;
}

const size_t *east_beast2_pages_counts(Beast2Pages *p, size_t *n_out)
{
    if (n_out) *n_out = p ? p->index.count : 0;
    return p ? p->index.counts : NULL;
}

EastValue *east_beast2_pages_segment(Beast2Pages *p, size_t i)
{
    if (!p) return NULL;
    /* Self-contained is checked BEFORE the range check: on a cross-aliased
     * blob every index is unusable, so reporting aliasing is more useful
     * than reporting a bound. (Matches the TS ordering.) */
    if (!p->index.self_contained) {
        east_builtin_error("beast2 v5: blob has cross-segment aliasing — random access needs "
                           "self-contained segments");
        return NULL;
    }
    if (i >= p->index.count) {
        char msg[96];
        snprintf(msg, sizeof(msg), "beast2 v5: segment %zu out of range (%zu segments)", i,
                 p->index.count);
        east_builtin_error(msg);
        return NULL;
    }

    B2V5Frames f;
    B2V5DecodeCtx ctx;
    EastValue *segment = NULL;
    EastValue *result = NULL;
    uint64_t n = 0;
    size_t sm_mark = p->sm.num_stacks;

    b2v5_frames_init(&f, p->data, p->len, p->index.offsets[i]);
    b2v5_dec_ctx_init(&ctx, &p->sm);

    if (!b2v5_frames_next(&f)) goto done; /* error already posted */
    if (!read_varint_checked(f.chunk, f.chunk_len, &f.chunk_off, &n)) {
        east_builtin_error("beast2 v5: malformed segment header");
        goto done;
    }
    /* Corruption check BEFORE any allocation sized from n. */
    if (n != (uint64_t)p->index.counts[i]) {
        char msg[128];
        snprintf(msg, sizeof(msg), "beast2 v5: segment %zu declares %llu elements, index says %zu",
                 i, (unsigned long long)n, p->index.counts[i]);
        east_builtin_error(msg);
        goto done;
    }
    if (!b2_container_count_within_bounds(n, p->type, f.chunk_len - f.chunk_off)) {
        east_builtin_error("beast2 v5: segment count exceeds its frame");
        goto done;
    }
    segment = b2v5_new_segment_container(p->type, (size_t)n);
    if (!segment) goto done;
    if (!b2v5_decode_elements_into(segment, p->type, n, f.chunk, f.chunk_len, &f.chunk_off, &ctx)) {
        east_builtin_error("beast2 v5: malformed segment");
        goto done;
    }
    if (!b2v5_chunk_exhausted(&f)) {
        char msg[96];
        snprintf(msg, sizeof(msg), "beast2 v5: logical bytes after segment %zu", i);
        east_builtin_error(msg);
        goto done;
    }
    /* A self-contained stream may not grow the source map mid-segment —
     * stacks are whole-stream state, so an inline delta here means the
     * self_contained flag lied. */
    if (p->sm.num_stacks != sm_mark) {
        east_builtin_error("beast2 v5: self-contained segments cannot add source maps");
        goto done;
    }
    result = segment;
    segment = NULL;

done:
    if (segment) east_value_release(segment);
    b2v5_dec_ctx_free(&ctx);
    b2v5_frames_dispose(&f);
    return result;
}

EastValue *east_beast2_pages_element(Beast2Pages *p, size_t row)
{
    if (!p) return NULL;
    if (p->type->kind != EAST_TYPE_ARRAY) {
        east_builtin_error(p->type->kind == EAST_TYPE_SET
                               ? "beast2 v5: element() addresses Array roots; this blob holds a Set"
                               : "beast2 v5: element() addresses Array roots; this blob holds a "
                                 "Dict");
        return NULL;
    }
    /* Range check MUST precede the search: with zero segments the initial
     * `hi = count - 1` would underflow to SIZE_MAX. */
    if (row >= p->index.total) {
        char msg[96];
        snprintf(msg, sizeof(msg), "beast2 v5: element %zu out of range (%zu elements)", row,
                 p->index.total);
        east_builtin_error(msg);
        return NULL;
    }

    size_t lo = 0;
    size_t hi = p->index.count - 1;
    while (lo < hi) {
        /* lo + (hi - lo) / 2, never (lo + hi) / 2 — size_t addition can wrap. */
        size_t mid = lo + (hi - lo) / 2;
        if (p->cumulative[mid] <= row) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    size_t base = lo == 0 ? 0 : p->cumulative[lo - 1];

    EastValue *segment = east_beast2_pages_segment(p, lo);
    if (!segment) return NULL;
    /* east_array_get returns a BORROWED pointer into the segment's items —
     * retain before releasing the segment or the caller gets freed memory. */
    EastValue *item = east_array_get(segment, row - base);
    if (!item) {
        east_value_release(segment);
        char msg[112];
        snprintf(msg, sizeof(msg),
                 "beast2 v5: segment %zu holds fewer elements than the index claims", lo);
        east_builtin_error(msg);
        return NULL;
    }
    east_value_retain(item);
    east_value_release(segment);
    return item;
}

void east_beast2_pages_free(Beast2Pages *p)
{
    if (!p) return;
    if (p->type) east_type_release(p->type);
    beast2_source_map_free(&p->sm);
    b2v5_index_free(&p->index);
    free(p->cumulative);
    free(p);
}
