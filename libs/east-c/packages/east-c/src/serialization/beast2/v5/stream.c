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
    EastValue *last_key; /* retained; greatest Set element / Dict key written */
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

    /* Set/Dict segment content is the canonical value split at segment
     * boundaries. Batches are btrees (internally sorted by construction), so
     * only the boundary needs checking: the batch must start strictly above
     * the previous batch's greatest key. */
    if (w->type->kind != EAST_TYPE_ARRAY) {
        EastValue *first =
            w->type->kind == EAST_TYPE_SET ? east_set_at(batch, 0) : east_dict_key_at(batch, 0);
        if (w->last_key && first && east_value_compare(w->last_key, first) >= 0) {
            east_builtin_error(
                w->type->kind == EAST_TYPE_SET
                    ? "beast2 v5: Set stream batches must be strictly ascending in East element "
                      "order — segment content is the canonical value; pre-sort batches, or "
                      "encode arrival order as an Array"
                    : "beast2 v5: Dict stream batches must be strictly ascending in East key "
                      "order — segment content is the canonical value; pre-sort batches, or "
                      "encode arrival order as an Array");
            w->failed = true;
            return false;
        }
        EastValue *last = w->type->kind == EAST_TYPE_SET ? east_set_at(batch, n - 1)
                                                         : east_dict_key_at(batch, n - 1);
        if (last) {
            if (w->last_key) east_value_release(w->last_key);
            w->last_key = last;
            east_value_retain(last);
        }
    }

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
    if (w->last_key) east_value_release(w->last_key);
    b2v5_enc_ctx_free(&w->ctx);
    if (w->pending) byte_buffer_free(w->pending);
    free(w->seg_offsets);
    free(w->seg_counts);
    free(w);
}

/* ================================================================== */
/*  Paged whole-value encode                                           */
/* ================================================================== */

#define B2V5_PAGED_BATCH_DEFAULT 1000
#define B2V5_PAGED_TARGET_BYTES_DEFAULT (2 * 1024 * 1024)
#define B2V5_PAGED_PROBE_BATCH 16

/* Build a batch container holding elements [i, j) of value, in canonical
 * order (btree walks are already sorted, so the writer's ascent check passes
 * by construction). */
static EastValue *paged_batch(EastValue *value, EastType *type, size_t i, size_t j)
{
    EastValue *batch = b2v5_new_segment_container(type, j - i);
    if (!batch) return NULL;
    if (type->kind == EAST_TYPE_ARRAY) {
        for (size_t k = i; k < j; k++)
            east_array_push(batch, value->data.array.items[k]);
    } else if (type->kind == EAST_TYPE_SET) {
        for (size_t k = i; k < j; k++)
            east_set_insert(batch, east_set_at(value, k));
    } else {
        for (size_t k = i; k < j; k++)
            east_dict_set(batch, east_dict_key_at(value, k), east_dict_val_at(value, k));
    }
    return batch;
}

ByteBuffer *east_beast2_encode_paged(EastValue *value, EastType *type, int32_t codec_id,
                                     size_t target_segment_bytes)
{
    if (!value || !type) return NULL;
    if (!b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5: paged encode holds Array, Set or Dict values");
        return NULL;
    }
    size_t target =
        target_segment_bytes ? target_segment_bytes : (size_t)B2V5_PAGED_TARGET_BYTES_DEFAULT;
    size_t n = type->kind == EAST_TYPE_ARRAY ? value->data.array.len
               : type->kind == EAST_TYPE_SET ? value->data.set.len
                                             : value->data.dict.len;

    /* Probe: a throwaway scratch encode of the first few elements measures
     * the average wire size and seeds the batch size. */
    size_t next_batch = B2V5_PAGED_BATCH_DEFAULT;
    size_t probe_n = n < B2V5_PAGED_PROBE_BATCH ? n : (size_t)B2V5_PAGED_PROBE_BATCH;
    if (probe_n > 0) {
        Beast2StreamWriter *scratch = east_beast2_writer_new(type, codec_id, true, true);
        if (!scratch) return NULL;
        size_t header = scratch->total_emitted;
        EastValue *pb = paged_batch(value, type, 0, probe_n);
        bool ok = pb && east_beast2_writer_write(scratch, pb);
        if (pb) east_value_release(pb);
        size_t body = scratch->total_emitted - header;
        east_beast2_writer_free(scratch);
        if (!ok) return NULL;
        double avg = body > 0 ? (double)body / (double)probe_n : 1.0;
        if (avg < 1.0) avg = 1.0;
        size_t by_target = (size_t)((double)target / avg);
        next_batch = by_target < 1                          ? 1
                     : by_target > B2V5_PAGED_BATCH_DEFAULT ? (size_t)B2V5_PAGED_BATCH_DEFAULT
                                                            : by_target;
    }

    Beast2StreamWriter *w = east_beast2_writer_new(type, codec_id, true, true);
    if (!w) return NULL;
    size_t header = w->total_emitted;
    size_t written = 0;
    size_t i = 0;
    bool ok = true;
    while (i < n && ok) {
        size_t j = i + next_batch;
        if (j > n) j = n;
        EastValue *batch = paged_batch(value, type, i, j);
        ok = batch && east_beast2_writer_write(w, batch);
        if (batch) east_value_release(batch);
        if (!ok) break;
        written += j - i;
        i = j;
        /* Refine toward the target as real output accumulates. */
        double avg = (double)(w->total_emitted - header) / (double)written;
        if (avg < 1.0) avg = 1.0;
        size_t nb = (size_t)((double)target / avg);
        next_batch = nb < 1                          ? 1
                     : nb > B2V5_PAGED_BATCH_DEFAULT ? (size_t)B2V5_PAGED_BATCH_DEFAULT
                                                     : nb;
    }
    if (ok) ok = east_beast2_writer_finish(w);
    ByteBuffer *out = ok ? east_beast2_writer_take(w) : NULL;
    east_beast2_writer_free(w);
    return out;
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
    B2V5OrderCheck order;        /* strict ascent across segments (Set/Dict) */
    EastValue *root_placeholder; /* definition 0; owned, never returned */
    EastSourceMap *sm;           /* one reference (header + inline deltas) */
    B2V5Index index;
    const Beast2Projection *proj; /* borrowed column projection, or NULL (#599) */
    bool has_index;
    bool started;
    bool done;
    bool failed;
};

Beast2SegmentReader *east_beast2_reader_new(const uint8_t *data, size_t len, EastType *type)
{
    if (!data || !type) {
        east_builtin_error("beast2 v5: segment reading needs a blob and a decode type");
        return NULL;
    }
    if (!b2v5_is_segmented_root(type)) {
        east_builtin_error("beast2 v5 segment reading needs an Array, Set or Dict type");
        return NULL;
    }
    /* Pre-check the magic: b2v5_read_header returns false silently on a bad
     * prefix, and "not a v5 blob" deserves a message the caller can act on.
     * (Same checks, same order, as east_beast2_pages_new.) */
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
    r->sm = h.sm; /* take the header's reference */
    h.sm = NULL;
    b2v5_frames_init(&r->frames, data, len, h.frame_offset);
    b2v5_dec_ctx_init(&r->ctx, r->sm);

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

void east_beast2_reader_set_projection(Beast2SegmentReader *r, const Beast2Projection *pr)
{
    if (!r || r->started) return; /* projection must be set before the first next() */
    if (pr && east_beast2_projection_is_identity((Beast2Projection *)pr)) pr = NULL;
    r->proj = pr;
    r->ctx.proj_active = pr != NULL;
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

    EastValue *segment =
        b2v5_new_segment_container(r->proj ? r->proj->root->proj : r->type, (size_t)n);
    if (!segment) {
        r->failed = true;
        return NULL;
    }
    bool decoded =
        r->proj ? b2v5_decode_elements_into_projected(
                      segment, r->proj->root, n, r->frames.chunk, r->frames.chunk_len,
                      &r->frames.chunk_off, &r->ctx,
                      r->type->kind == EAST_TYPE_ARRAY ? NULL : &r->order)
                : b2v5_decode_elements_into(segment, r->type, n, r->frames.chunk,
                                            r->frames.chunk_len, &r->frames.chunk_off, &r->ctx,
                                            r->type->kind == EAST_TYPE_ARRAY ? NULL : &r->order);
    if (!decoded) {
        east_value_release(segment);
        /* Keep a specific posted message (e.g. the canonical-order
         * violation) over the generic one. */
        char *specific = east_builtin_get_error();
        if (specific) {
            east_builtin_error(specific);
            free(specific);
        } else {
            east_builtin_error("beast2 v5: malformed segment");
        }
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
    b2v5_order_check_dispose(&r->order);
    b2v5_frames_dispose(&r->frames);
    b2v5_dec_ctx_free(&r->ctx);
    east_source_map_release(r->sm);
    b2v5_index_free(&r->index);
    free(r);
}

/* ================================================================== */
/*  Splice extents — byte geometry for merging blobs (issue #484)      */
/* ================================================================== */

/* Both the root NEW tag frame and the terminator frame encode to exactly
 * these four bytes: codec 0, uncompressed len 1, payload len 1, payload 0x00. */
static const uint8_t B2V5_TAG_OR_TERMINATOR_FRAME[4] = {0x00, 0x01, 0x01, 0x00};

Beast2SpliceExtents *east_beast2_splice_extents(const uint8_t *data, size_t len)
{
    if (!data) {
        east_builtin_error("beast2 v5: splice extents need a blob");
        return NULL;
    }
    if (len < 8) {
        char msg[64];
        snprintf(msg, sizeof(msg), "Data too short for Beast2 format: %zu bytes", len);
        east_builtin_error(msg);
        return NULL;
    }
    if (memcmp(data, BEAST2_MAGIC, 7) == 0 && data[7] == 0x04) {
        east_builtin_error("beast2 v5: splice needs v5 blobs; this is a v4 container "
                           "(re-encode with version 5)");
        return NULL;
    }
    if (memcmp(data, BEAST2_MAGIC_V5, 8) != 0) {
        east_builtin_error("beast2 v5: not a beast2 v5 container");
        return NULL;
    }

    B2V5Header h;
    if (!b2v5_read_header(data, len, &h)) {
        /* Re-post any specific message (e.g. a well-known hash mismatch);
         * type-section truncation returns false silently, so cover it. */
        char *specific = east_builtin_get_error();
        if (specific) {
            east_builtin_error(specific);
            free(specific);
        } else {
            east_builtin_error("beast2 v5: malformed header sections");
        }
        return NULL;
    }
    bool source_map_empty = h.sm->num_stacks == 0;
    size_t frame_offset = h.frame_offset;
    b2v5_header_dispose(&h);

    /* Index BEFORE frame geometry: an index-less whole-value blob packs the
     * tag, segments and terminator into one frame, so probing for the framed
     * layout first would report a confusing geometry error instead of the
     * actionable one. */
    B2V5Index ix;
    int r = b2v5_read_index(data, len, &ix);
    if (r == -1) return NULL; /* error already posted */
    if (r == 0) {
        east_builtin_error("beast2 v5: blob carries no index — splice needs one "
                           "(write with the index enabled, the default)");
        return NULL;
    }

    if (frame_offset + 4 > len ||
        memcmp(data + frame_offset, B2V5_TAG_OR_TERMINATOR_FRAME, 4) != 0) {
        east_builtin_error("beast2 v5: root tag frame not found where expected");
        b2v5_index_free(&ix);
        return NULL;
    }
    size_t prefix_end = frame_offset + 4;

    size_t segments_end = prefix_end;
    if (ix.count > 0) {
        if (ix.offsets[0] != prefix_end) {
            east_builtin_error("beast2 v5: segments not contiguous with the header");
            b2v5_index_free(&ix);
            return NULL;
        }
        size_t off = ix.offsets[ix.count - 1];
        uint64_t codec, uncompressed_len, payload_len;
        if (!read_varint_checked(data, len, &off, &codec) ||
            !read_varint_checked(data, len, &off, &uncompressed_len) ||
            !read_varint_checked(data, len, &off, &payload_len) || payload_len > len - off) {
            east_builtin_error("beast2 v5: malformed segment frame header");
            b2v5_index_free(&ix);
            return NULL;
        }
        segments_end = off + (size_t)payload_len;
    }
    if (segments_end + 4 != ix.index_offset ||
        memcmp(data + segments_end, B2V5_TAG_OR_TERMINATOR_FRAME, 4) != 0) {
        east_builtin_error("beast2 v5: terminator frame not found where expected");
        b2v5_index_free(&ix);
        return NULL;
    }

    Beast2SpliceExtents *e = calloc(1, sizeof(*e));
    if (!e) {
        b2v5_index_free(&ix);
        return NULL;
    }
    e->prefix_end = prefix_end;
    e->segments_end = segments_end;
    e->index_offset = ix.index_offset;
    e->segment_count = ix.count;
    e->self_contained = ix.self_contained;
    e->source_map_empty = source_map_empty;
    /* Steal the index arrays rather than copying. */
    e->offsets = ix.offsets;
    e->counts = ix.counts;
    memset(&ix, 0, sizeof(ix));
    return e;
}

void east_beast2_splice_extents_free(Beast2SpliceExtents *e)
{
    if (!e) return;
    free(e->offsets);
    free(e->counts);
    free(e);
}

ByteBuffer *east_beast2_splice_tail(const size_t *offsets, const size_t *counts, size_t n,
                                    size_t stream_end)
{
    ByteBuffer *buf = byte_buffer_new(64);
    if (!buf) return NULL;
    byte_buffer_write_bytes(buf, B2V5_TAG_OR_TERMINATOR_FRAME, 4);
    b2v5_write_index_footer(buf, stream_end + 4, offsets, counts, n, true);
    return buf;
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

/* Decoded segments kept hot for the element and keyed paths (#481 W2). The
 * window is budgeted in BYTES of decompressed frame — not a slot count — so
 * wide-row tables stay bounded no matter what row grain they were written at
 * (#560): each cached segment is weighted by its frame's decompressed length
 * (an O(1) read from the frame header), and insertion evicts LRU entries
 * until the new one fits. The newest segment always caches, even alone over
 * budget, so repeated point reads into one hot segment stay warm. */
#define B2V5_PAGES_CACHE_BYTES_DEFAULT (64u * 1024 * 1024)

typedef struct {
    size_t idx;
    EastValue *seg; /* owned */
    size_t bytes;   /* decompressed frame length — the budget weight */
    uint64_t tick;
} B2V5CacheEntry;

struct Beast2Pages {
    const uint8_t *data; /* borrowed — caller keeps it alive and unchanged */
    size_t len;
    EastType *type;       /* retained decode type */
    EastSourceMap *sm;    /* one reference (header) */
    B2V5Index index;      /* owned */
    size_t *cumulative;   /* prefix sums of index.counts; NULL when count == 0 */
    EastValue **fences;   /* lazily decoded first element/key per segment (owned) */
    bool fences_verified; /* strict ascent checked (first keyed read) */
    bool frozen;          /* frozen open: every decoded segment/fence is branded */
    /* Open-time column projection (#599): when set, EVERY segment decode —
     * including the shared cache — materializes the projected subset, so
     * cache entries all carry one shape for the pager's whole lifetime (the
     * cache-correctness rule: a segment decoded under one mask is never
     * served to an operation needing a wider one). Borrowed; the owner
     * keeps it alive for the pager's lifetime. Fences stay wire-shaped
     * (keys/elements never project). */
    const Beast2Projection *proj;
    B2V5CacheEntry *cache; /* dynamic; cache_count entries live */
    size_t cache_count;
    size_t cache_cap;
    size_t cache_bytes;  /* sum of live entry weights */
    size_t cache_budget; /* bytes; EAST_PAGED_CACHE_BYTES overrides the default */
    uint64_t lru_tick;
    /* What paging has cost so far: segments and fences actually decoded —
     * a cache hit is not counted again. The runners' account of a lazy
     * input, which no residency figure can give on a mapping. */
    size_t segments_decoded;
    size_t fences_probed;
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
    p->sm = h.sm; /* take the header's reference */
    h.sm = NULL;

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

    p->cache_budget = (size_t)B2V5_PAGES_CACHE_BYTES_DEFAULT;
    const char *env = getenv("EAST_PAGED_CACHE_BYTES");
    if (env && *env) {
        char *end = NULL;
        unsigned long long budget = strtoull(env, &end, 10);
        if (end && *end == '\0') p->cache_budget = (size_t)budget;
    }
    return p;
}

void east_beast2_pages_set_cache_budget(Beast2Pages *p, size_t bytes)
{
    if (p) p->cache_budget = bytes;
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

/* One segment decode, optionally through a column projection (#599). The
 * projected path registers skipped containers as sentinel definitions and a
 * REF crossing the projection boundary posts B2V5_PROJ_ALIAS_MSG — the
 * caller retries whole. */
static EastValue *pages_decode_segment(Beast2Pages *p, size_t i, const Beast2Projection *pr)
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
    if (pr && east_beast2_projection_is_identity((Beast2Projection *)pr)) pr = NULL;

    B2V5Frames f;
    B2V5DecodeCtx ctx;
    B2V5OrderCheck order = {0};
    EastValue *segment = NULL;
    EastValue *result = NULL;
    uint64_t n = 0;
    size_t sm_mark = p->sm->num_stacks;

    b2v5_frames_init(&f, p->data, p->len, p->index.offsets[i]);
    b2v5_dec_ctx_init(&ctx, p->sm);
    ctx.frozen = p->frozen;
    ctx.proj_active = pr != NULL;

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
    segment = b2v5_new_segment_container(pr ? pr->root->proj : p->type, (size_t)n);
    if (!segment) goto done;
    if (ctx.frozen) east_value_set_frozen(segment);
    bool decoded =
        pr ? b2v5_decode_elements_into_projected(segment, pr->root, n, f.chunk, f.chunk_len,
                                                 &f.chunk_off, &ctx,
                                                 p->type->kind == EAST_TYPE_ARRAY ? NULL : &order)
           : b2v5_decode_elements_into(segment, p->type, n, f.chunk, f.chunk_len, &f.chunk_off,
                                       &ctx, p->type->kind == EAST_TYPE_ARRAY ? NULL : &order);
    if (!decoded) {
        /* Keep a specific posted message (e.g. the canonical-order
         * violation) over the generic one. */
        char *specific = east_builtin_get_error();
        if (specific) {
            east_builtin_error(specific);
            free(specific);
        } else {
            east_builtin_error("beast2 v5: malformed segment");
        }
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
    if (p->sm->num_stacks != sm_mark) {
        east_builtin_error("beast2 v5: self-contained segments cannot add source maps");
        goto done;
    }
    result = segment;
    segment = NULL;
    p->segments_decoded++;

done:
    if (segment) east_value_release(segment);
    b2v5_order_check_dispose(&order);
    b2v5_dec_ctx_free(&ctx);
    b2v5_frames_dispose(&f);
    return result;
}

EastValue *east_beast2_pages_segment(Beast2Pages *p, size_t i)
{
    return pages_decode_segment(p, i, p ? p->proj : NULL);
}

EastValue *east_beast2_pages_segment_projected(Beast2Pages *p, size_t i, const Beast2Projection *pr)
{
    /* Per-call projections NEVER touch the shared cache: an entry decoded
     * under one mask must not answer an operation needing another. */
    return pages_decode_segment(p, i, pr);
}

void east_beast2_pages_set_projection(Beast2Pages *p, const Beast2Projection *pr)
{
    if (!p) return;
    if (pr && east_beast2_projection_is_identity((Beast2Projection *)pr)) pr = NULL;
    /* Cached segments decoded under the previous shape are unusable now. */
    for (size_t k = 0; k < p->cache_count; k++)
        east_value_release(p->cache[k].seg);
    p->cache_count = 0;
    p->cache_bytes = 0;
    p->proj = pr;
}

/* Segment i's budget weight: its frame's decompressed byte length, an O(1)
 * varint read from the frame header. 0 on a malformed header — the entry
 * then costs nothing against the budget, and the decode itself will post
 * the real error. */
static size_t pages_frame_weight(Beast2Pages *p, size_t i)
{
    size_t off = p->index.offsets[i];
    uint64_t codec, uncompressed_len, payload_len;
    if (!read_varint_checked(p->data, p->len, &off, &codec) ||
        !read_varint_checked(p->data, p->len, &off, &uncompressed_len) ||
        !read_varint_checked(p->data, p->len, &off, &payload_len))
        return 0;
    return (size_t)uncompressed_len;
}

/* Fetch segment i through the pager's byte-budgeted shared cache. Returns a
 * RETAINED value (caller releases); the cache keeps its own reference. Only
 * the element and keyed paths route through here — the public segment()
 * stays a fresh decode, so a caller mutating its result cannot poison the
 * cache. */
static EastValue *pages_segment_cached(Beast2Pages *p, size_t i)
{
    for (size_t k = 0; k < p->cache_count; k++) {
        if (p->cache[k].idx == i) {
            p->cache[k].tick = ++p->lru_tick;
            east_value_retain(p->cache[k].seg);
            return p->cache[k].seg;
        }
    }
    EastValue *seg = east_beast2_pages_segment(p, i);
    if (!seg) return NULL;

    size_t bytes = pages_frame_weight(p, i);
    /* Evict least-recently-used entries until the new one fits. */
    while (p->cache_count > 0 && p->cache_bytes + bytes > p->cache_budget) {
        size_t victim = 0;
        for (size_t k = 1; k < p->cache_count; k++)
            if (p->cache[k].tick < p->cache[victim].tick) victim = k;
        east_value_release(p->cache[victim].seg);
        p->cache_bytes -= p->cache[victim].bytes;
        p->cache[victim] = p->cache[--p->cache_count];
    }
    if (p->cache_count == p->cache_cap) {
        size_t cap = p->cache_cap ? p->cache_cap * 2 : 8;
        B2V5CacheEntry *grown = realloc(p->cache, cap * sizeof(*grown));
        if (!grown) return seg; /* uncached; correctness unaffected */
        p->cache = grown;
        p->cache_cap = cap;
    }
    p->cache[p->cache_count].idx = i;
    p->cache[p->cache_count].seg = seg;
    p->cache[p->cache_count].bytes = bytes;
    p->cache[p->cache_count].tick = ++p->lru_tick;
    p->cache_count++;
    p->cache_bytes += bytes;
    east_value_retain(seg); /* the cache's reference */
    return seg;
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

    EastValue *segment = pages_segment_cached(p, lo);
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
    for (size_t k = 0; k < p->cache_count; k++)
        east_value_release(p->cache[k].seg);
    free(p->cache);
    if (p->fences) {
        for (size_t i = 0; i < p->index.count; i++)
            if (p->fences[i]) east_value_release(p->fences[i]);
        free(p->fences);
    }
    if (p->type) east_type_release(p->type);
    east_source_map_release(p->sm);
    b2v5_index_free(&p->index);
    free(p->cumulative);
    free(p);
}

/* The fence value's type: what one probe decodes — the KEY for Dict roots,
 * the element otherwise. */
static EastType *pages_fence_type(Beast2Pages *p)
{
    if (p->type->kind == EAST_TYPE_DICT) return p->type->data.dict.key;
    return p->type->data.element;
}

EastValue *east_beast2_pages_fence(Beast2Pages *p, size_t i)
{
    if (!p) return NULL;
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
    if (!p->fences) {
        p->fences = calloc(p->index.count, sizeof(EastValue *));
        if (!p->fences) return NULL;
    }
    if (p->fences[i]) {
        east_value_retain(p->fences[i]);
        return p->fences[i];
    }

    size_t off = p->index.offsets[i];
    uint64_t codec, uncompressed_len, payload_len;
    if (!read_varint_checked(p->data, p->len, &off, &codec) ||
        !read_varint_checked(p->data, p->len, &off, &uncompressed_len) ||
        !read_varint_checked(p->data, p->len, &off, &payload_len) || payload_len > p->len - off) {
        east_builtin_error("beast2 v5: malformed segment frame header");
        return NULL;
    }

    EastValue *first = NULL;
    size_t sm_mark = p->sm->num_stacks;
    B2V5DecodeCtx ctx;

    if (codec == EAST_BEAST2_CODEC_NONE) {
        size_t coff = 0;
        uint64_t n;
        b2v5_dec_ctx_init(&ctx, p->sm);
        ctx.frozen = p->frozen;
        if (read_varint_checked(p->data + off, (size_t)payload_len, &coff, &n) && n > 0)
            first = b2v5_decode_value(p->data + off, (size_t)payload_len, &coff,
                                      pages_fence_type(p), &ctx);
        b2v5_dec_ctx_free(&ctx);
    } else {
        /* Inflate a bounded prefix and decode the first element from it; a
         * truncated element grows the probe until it fits (the final attempt
         * inflates the whole frame, so real corruption still surfaces). */
        size_t cap = 4096;
        for (;;) {
            if (cap > (size_t)uncompressed_len) cap = (size_t)uncompressed_len;
            uint8_t *buf = malloc(cap ? cap : 1);
            if (!buf) return NULL;
            size_t got = b2v5_inflate_prefix(p->data + off, (size_t)payload_len, buf, cap);
            if (got == 0) {
                free(buf);
                east_builtin_error("beast2 v5: segment frame failed to inflate");
                return NULL;
            }
            size_t coff = 0;
            uint64_t n;
            b2v5_dec_ctx_init(&ctx, p->sm);
            ctx.frozen = p->frozen;
            if (read_varint_checked(buf, got, &coff, &n) && n > 0)
                first = b2v5_decode_value(buf, got, &coff, pages_fence_type(p), &ctx);
            b2v5_dec_ctx_free(&ctx);
            free(buf);
            if (first || cap >= (size_t)uncompressed_len) break;
            /* Truncation, not corruption: drop the posted error, probe bigger. */
            free(east_builtin_get_error());
            cap *= 4;
        }
    }

    if (p->sm->num_stacks != sm_mark) {
        if (first) east_value_release(first);
        east_builtin_error("beast2 v5: self-contained segments cannot add source maps");
        return NULL;
    }
    if (!first) {
        char *specific = east_builtin_get_error();
        if (specific) {
            east_builtin_error(specific);
            free(specific);
        } else {
            east_builtin_error("beast2 v5: malformed segment");
        }
        return NULL;
    }
    p->fences[i] = first;     /* the cache owns one reference */
    east_value_retain(first); /* and the caller gets their own */
    p->fences_probed++;
    return first;
}

void east_beast2_pages_stats(Beast2Pages *p, size_t *segments_decoded, size_t *fences_probed)
{
    if (segments_decoded) *segments_decoded = p ? p->segments_decoded : 0;
    if (fences_probed) *fences_probed = p ? p->fences_probed : 0;
}

/* ================================================================== */
/*  Keyed reads (issue #481 W2)                                        */
/* ================================================================== */

/* Partition search over the lazily decoded fences: *out becomes the LAST
 * segment whose fence is < key (or <= key with or_equal), SIZE_MAX when no
 * fence satisfies it. Assumes fences ascend — keyed callers verify that
 * first; find_sorted relies on the array's own sortedness contract. Returns
 * false when a fence fails to decode (error posted). */
static bool pages_fence_search(Beast2Pages *p, EastValue *key, bool or_equal, size_t *out)
{
    size_t lo = 0;
    size_t hi = p->index.count;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        EastValue *f = east_beast2_pages_fence(p, mid);
        if (!f) return false;
        int c = east_value_compare(f, key);
        east_value_release(f);
        if (or_equal ? c <= 0 : c < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    *out = lo == 0 ? SIZE_MAX : lo - 1;
    return true;
}

static void pages_disjoint_error(void)
{
    east_builtin_error("beast2 v5: segments are not disjoint ascending key ranges — the wire "
                       "must hold the canonical value (corrupt or pre-contract blob)");
}

/* Keyed reads assume the fences ascend STRICTLY (unique keys, disjoint
 * segments) — a binary search over unsorted fences lands arbitrarily and
 * would report false misses, and wrong data is worse than no data. Verify
 * the whole table once per pager, lazily, on the first keyed operation:
 * each fence is a cached bounded probe (microseconds warm), so a
 * 1000-segment file pays ~a dozen milliseconds once, and a blob whose
 * batches were not written in sorted key order fails loudly here. */
static bool pages_verify_fences(Beast2Pages *p)
{
    if (p->fences_verified) return true;
    if (p->index.count < 2) {
        p->fences_verified = true;
        return true;
    }
    EastValue *prev = east_beast2_pages_fence(p, 0);
    if (!prev) return false;
    for (size_t i = 1; i < p->index.count; i++) {
        EastValue *f = east_beast2_pages_fence(p, i);
        if (!f) {
            east_value_release(prev);
            return false;
        }
        int c = east_value_compare(prev, f);
        east_value_release(prev);
        prev = f;
        if (c >= 0) {
            east_value_release(prev);
            pages_disjoint_error();
            return false;
        }
    }
    east_value_release(prev);
    p->fences_verified = true;
    return true;
}

/* A decoded segment's greatest key must stay below the next fence — with
 * the fences verified this pins the landed segment's whole key range, so an
 * overlapping writer is caught on any segment a keyed read decodes. */
static bool pages_tail_guard(Beast2Pages *p, size_t s, EastValue *seg)
{
    if (s + 1 >= p->index.count) return true;
    size_t n = p->type->kind == EAST_TYPE_DICT ? east_dict_len(seg) : east_set_len(seg);
    if (n == 0) return true;
    EastValue *last =
        p->type->kind == EAST_TYPE_DICT ? east_dict_key_at(seg, n - 1) : east_set_at(seg, n - 1);
    EastValue *f = east_beast2_pages_fence(p, s + 1);
    if (!f) return false;
    int c = east_value_compare(last, f);
    east_value_release(f);
    if (c >= 0) {
        pages_disjoint_error();
        return false;
    }
    return true;
}

int east_beast2_pages_get_key(Beast2Pages *p, EastValue *key, EastValue **value_out)
{
    if (value_out) *value_out = NULL;
    if (!p || !key) {
        east_builtin_error("beast2 v5: keyed read needs a pager and a key");
        return -1;
    }
    if (p->type->kind == EAST_TYPE_ARRAY) {
        east_builtin_error("beast2 v5: keyed reads address Set and Dict roots; "
                           "element() addresses Array rows");
        return -1;
    }
    if (!p->index.self_contained) {
        east_builtin_error("beast2 v5: blob has cross-segment aliasing — random access needs "
                           "self-contained segments");
        return -1;
    }
    if (p->index.count == 0) return 0;
    if (!pages_verify_fences(p)) return -1;

    size_t s;
    if (!pages_fence_search(p, key, true, &s)) return -1;
    if (s == SIZE_MAX) return 0; /* key precedes every segment's first key */

    EastValue *seg = pages_segment_cached(p, s);
    if (!seg) return -1;
    if (!pages_tail_guard(p, s, seg)) {
        east_value_release(seg);
        return -1;
    }
    int found = 0;
    if (p->type->kind == EAST_TYPE_DICT) {
        EastValue *v = east_dict_get(seg, key);
        if (v) {
            found = 1;
            if (value_out) {
                east_value_retain(v); /* east_dict_get borrows from the segment */
                *value_out = v;
            }
        }
    } else {
        found = east_set_has(seg, key) ? 1 : 0;
    }
    east_value_release(seg);
    return found;
}

EastValue *east_beast2_pages_get_keys(Beast2Pages *p, EastValue *keys, EastValue **missing_out)
{
    if (missing_out) *missing_out = NULL;
    if (!p || !keys) {
        east_builtin_error("beast2 v5: batched keyed read needs a pager and a key set");
        return NULL;
    }
    if (p->type->kind != EAST_TYPE_DICT) {
        east_builtin_error("beast2 v5: get_keys addresses Dict roots");
        return NULL;
    }
    if (keys->kind != EAST_VAL_SET) {
        east_builtin_error("beast2 v5: get_keys takes a Set of keys");
        return NULL;
    }
    if (!p->index.self_contained) {
        east_builtin_error("beast2 v5: blob has cross-segment aliasing — random access needs "
                           "self-contained segments");
        return NULL;
    }

    if (!pages_verify_fences(p)) return NULL;

    /* Under an open-time projection the served values are narrow, so the
     * result dict must carry the projected value type. */
    EastType *found_vt = p->proj ? p->proj->root->proj->data.dict.value : p->type->data.dict.value;
    EastValue *found = east_dict_new(p->type->data.dict.key, found_vt);
    EastValue *missing = east_set_new(p->type->data.dict.key);
    EastValue *seg = NULL;
    if (!found || !missing) goto fail;

    /* Requested keys iterate in East order and the fences ascend (verified
     * above), so one forward merge finds every owning segment: the cursor
     * advances while the next fence is <= the key, and each owning segment
     * decodes once no matter how many keys land in it. */
    size_t cur = SIZE_MAX; /* before segment 0 */
    size_t n = east_set_len(keys);
    for (size_t i = 0; i < n; i++) {
        EastValue *key = east_set_at(keys, i); /* borrowed */
        for (;;) {
            size_t next = cur == SIZE_MAX ? 0 : cur + 1;
            if (next >= p->index.count) break;
            EastValue *f = east_beast2_pages_fence(p, next);
            if (!f) goto fail;
            bool advance = east_value_compare(f, key) <= 0;
            east_value_release(f);
            if (!advance) break;
            cur = next;
            if (seg) {
                east_value_release(seg);
                seg = NULL;
            }
        }
        if (cur == SIZE_MAX) {
            east_set_insert(missing, key);
            continue;
        }
        if (!seg) {
            seg = pages_segment_cached(p, cur);
            if (!seg) goto fail;
            if (!pages_tail_guard(p, cur, seg)) goto fail;
        }
        EastValue *v = east_dict_get(seg, key); /* borrowed */
        if (v) {
            east_dict_set(found, key, v); /* dict_set retains both */
        } else {
            east_set_insert(missing, key); /* set_insert retains */
        }
    }
    if (seg) east_value_release(seg);
    if (missing_out)
        *missing_out = missing;
    else
        east_value_release(missing);
    return found;

fail:
    if (seg) east_value_release(seg);
    if (found) east_value_release(found);
    if (missing) east_value_release(missing);
    return NULL;
}

EastValue *east_beast2_pages_segment_disjoint(Beast2Pages *p, size_t i)
{
    if (!p) return NULL;
    if (p->type->kind == EAST_TYPE_ARRAY) {
        east_builtin_error("beast2 v5: disjoint segment reads address Set and Dict roots");
        return NULL;
    }
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
    if (!pages_verify_fences(p)) return NULL;
    EastValue *seg = pages_segment_cached(p, i);
    if (!seg) return NULL;
    if (!pages_tail_guard(p, i, seg)) {
        east_value_release(seg);
        return NULL;
    }
    return seg;
}

EastValue *east_beast2_pages_segment_disjoint_projected(Beast2Pages *p, size_t i,
                                                        const Beast2Projection *pr)
{
    if (!p) return NULL;
    if (p->type->kind == EAST_TYPE_ARRAY) {
        east_builtin_error("beast2 v5: disjoint segment reads address Set and Dict roots");
        return NULL;
    }
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
    /* Fences decode wire-shaped keys, so the disjointness contract is
     * verified exactly as in the whole-decode path; the segment itself is a
     * fresh projected decode that never enters the shared cache. */
    if (!pages_verify_fences(p)) return NULL;
    EastValue *seg = pages_decode_segment(p, i, pr);
    if (!seg) return NULL;
    if (!pages_tail_guard(p, i, seg)) {
        east_value_release(seg);
        return NULL;
    }
    return seg;
}

EastType *east_beast2_pages_type(Beast2Pages *p)
{
    return p ? p->type : NULL;
}

/* ================================================================== */
/*  Lazy pager-backed collection values (issue #505)                    */
/* ================================================================== */

/* Whether every value of `t` is value-semantic for the lazy paged contract:
 * no East-mutable container (Array/Set/Dict/Ref — a write through a freshly
 * decoded pager-served element would be dropped) and no identity-compared or
 * state-carrying kind (Vector/Matrix under `Is`; functions' captures).
 * Structs/variants/scalars compare by value and have no in-place mutation
 * builtins. Mirrors the TS gate (east lazy.ts `isBeast2LazySafe`).
 * `recursive` carries the enclosing Recursive wrapper for cycle protection
 * (self-references point back at the wrapper). */
static bool lazy_safe_element(const EastType *t, const EastType *recursive)
{
    if (!t) return false;
    if (t == recursive) return true; /* back-reference: already on the checked path */
    switch (t->kind) {
    case EAST_TYPE_NEVER:
    case EAST_TYPE_NULL:
    case EAST_TYPE_BOOLEAN:
    case EAST_TYPE_INTEGER:
    case EAST_TYPE_FLOAT:
    case EAST_TYPE_STRING:
    case EAST_TYPE_DATETIME:
    case EAST_TYPE_BLOB:
        return true;
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < t->data.struct_.num_fields; i++)
            if (!lazy_safe_element(t->data.struct_.fields[i].type, recursive)) return false;
        return true;
    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < t->data.variant.num_cases; i++)
            if (!lazy_safe_element(t->data.variant.cases[i].type, recursive)) return false;
        return true;
    case EAST_TYPE_RECURSIVE:
        return lazy_safe_element(t->data.recursive.node, t);
    default:
        /* Array/Set/Dict/Ref, Vector/Matrix, Function/AsyncFunction. */
        return false;
    }
}

/* The frozen-open variant of lazy_safe_element (issue #539): frozen values
 * cannot be mutated and frozen collections (incl. Vector/Matrix) compare as
 * value types under Is, so fresh per-segment decodes are unobservable for
 * every shape except Ref (the explicit identity cell — identity across fresh
 * decodes cannot be kept without pinning) and functions (a decoded closure
 * re-creates any mutable state it captured; captures stay mutable even in a
 * frozen decode). Mirrors the TS gate (east lazy.ts, frozen mode). */
static bool lazy_safe_element_frozen(const EastType *t, const EastType *recursive)
{
    if (!t) return false;
    if (t == recursive) return true; /* back-reference: already on the checked path */
    switch (t->kind) {
    case EAST_TYPE_REF:
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return false;
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
        return lazy_safe_element_frozen(t->data.element, recursive);
    case EAST_TYPE_DICT:
        return lazy_safe_element_frozen(t->data.dict.key, recursive) &&
               lazy_safe_element_frozen(t->data.dict.value, recursive);
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < t->data.struct_.num_fields; i++)
            if (!lazy_safe_element_frozen(t->data.struct_.fields[i].type, recursive)) return false;
        return true;
    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < t->data.variant.num_cases; i++)
            if (!lazy_safe_element_frozen(t->data.variant.cases[i].type, recursive)) return false;
        return true;
    case EAST_TYPE_RECURSIVE:
        return lazy_safe_element_frozen(t->data.recursive.node, t);
    default:
        /* Scalars, Blob, Vector, Matrix — all value types when frozen. */
        return true;
    }
}

/* The root-level shape gate: only collection roots whose element (and key)
 * shapes are value-semantic may open lazily; anything else must decode
 * eagerly. Non-collection roots pass through to east_beast2_pages_new's own
 * (more specific) refusal. `frozen` collapses the gate to the Ref/function
 * exclusions above. */
static bool lazy_shape_safe(const EastType *type, bool frozen)
{
    if (!type) return false;
    bool (*safe)(const EastType *, const EastType *) =
        frozen ? lazy_safe_element_frozen : lazy_safe_element;
    switch (type->kind) {
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
        return safe(type->data.element, NULL);
    case EAST_TYPE_DICT:
        return safe(type->data.dict.key, NULL) && safe(type->data.dict.value, NULL);
    default:
        return true;
    }
}

/* Post the shape-gate refusal for a type that must decode eagerly instead:
 * the plain gate (#516) excludes every element shape East can mutate in
 * place or observe by identity; the frozen gate (#539) collapses to the
 * Ref/function exclusions. */
static bool lazy_shape_gate(const EastType *type, bool frozen)
{
    if (!type || lazy_shape_safe(type, frozen)) return true;
    east_builtin_error(frozen
                           ? "beast2 v5: frozen lazy paged values need element shapes without a "
                             "Ref (an identity cell) or function values (captured state) — such "
                             "shapes must decode eagerly"
                           : "beast2 v5: lazy paged values need value-semantic element shapes — "
                             "an element containing an Array/Set/Dict/Ref (mutable in place) or a "
                             "Vector/Matrix/function (identity-compared) must decode eagerly");
    return false;
}

/* The one constructor behind every lazy open: the pager, then the value
 * born with its ownership of `data` settled (see east_paged_new) — there is
 * no state in which the bytes could be released under a mode the caller did
 * not ask for. On NULL nothing of the caller's has been taken: the bytes
 * stay theirs, an owner is not retained, a release callback never fires. */
static EastValue *open_paged_common(uint8_t *data, size_t len, EastType *type, bool frozen,
                                    bool owns_data, EastValue *owner,
                                    void (*release)(void *ctx, uint8_t *data, size_t len),
                                    void *release_ctx)
{
    Beast2Pages *pages = east_beast2_pages_new(data, len, type);
    if (!pages) return NULL;
    /* Random access (and therefore every pager-served operation) needs
     * self-contained segments; refuse now rather than on first read. */
    if (!east_beast2_pages_self_contained(pages)) {
        east_beast2_pages_free(pages);
        east_builtin_error("beast2 v5: blob has cross-segment aliasing — lazy paged values need "
                           "self-contained segments");
        return NULL;
    }
    pages->frozen = frozen;
    EastValue *v = east_paged_new(pages, data, len, owns_data, owner, release, release_ctx);
    if (!v) {
        east_beast2_pages_free(pages);
        return NULL;
    }
    if (frozen) east_value_set_frozen(v);
    return v;
}

EastValue *east_beast2_open_paged(uint8_t *data, size_t len, EastType *type)
{
    /* Shape gate (#516): element shapes East can mutate in place (or observe
     * by identity) must not be served as fresh pager decodes — the caller
     * falls back to the eager whole decode, which is always correct. */
    if (!lazy_shape_gate(type, false)) return NULL;
    return open_paged_common(data, len, type, false, true, NULL, NULL, NULL);
}

EastValue *east_beast2_open_paged_frozen(uint8_t *data, size_t len, EastType *type)
{
    /* The collapsed frozen gate (#539): only Ref- and function-bearing
     * element shapes still force the eager (frozen) decode. */
    if (!lazy_shape_gate(type, true)) return NULL;
    return open_paged_common(data, len, type, true, true, NULL, NULL, NULL);
}

EastValue *east_beast2_open_paged_view(const uint8_t *data, size_t len, EastType *type, bool frozen)
{
    if (!lazy_shape_gate(type, frozen)) return NULL;
    return open_paged_common((uint8_t *)data, len, type, frozen, false, NULL, NULL, NULL);
}

EastValue *east_beast2_open_paged_owned(EastValue *owner, const uint8_t *data, size_t len,
                                        EastType *type, bool frozen)
{
    if (!owner) {
        east_builtin_error("beast2 v5: an owned lazy open needs the value that owns the bytes");
        return NULL;
    }
    if (!lazy_shape_gate(type, frozen)) return NULL;
    return open_paged_common((uint8_t *)data, len, type, frozen, false, owner, NULL, NULL);
}

EastValue *east_beast2_open_paged_external(uint8_t *data, size_t len, EastType *type, bool frozen,
                                           void (*release)(void *ctx, uint8_t *data, size_t len),
                                           void *ctx)
{
    if (!release) {
        east_builtin_error("beast2 v5: an external lazy open needs a release callback");
        return NULL;
    }
    if (!lazy_shape_gate(type, frozen)) return NULL;
    /* On NULL the bytes stay the caller's and the callback never fires — the
     * same ownership rule east_beast2_open_paged applies to its free(). */
    return open_paged_common(data, len, type, frozen, false, NULL, release, ctx);
}

EastValue *east_paged_hydrated(EastValue *v)
{
    if (!v || v->kind != EAST_VAL_PAGED) return v;
    if (v->data.paged.hydrated) return v->data.paged.hydrated;
    /* A frozen open hydrates frozen, so the eager child enforces the same
     * contract the pager-served reads did. */
    EastValue *whole =
        v->data.paged.frozen
            ? east_beast2_decode_full_frozen(v->data.paged.data, v->data.paged.len,
                                             east_beast2_pages_type(v->data.paged.pages))
            : east_beast2_decode_full(v->data.paged.data, v->data.paged.len,
                                      east_beast2_pages_type(v->data.paged.pages));
    if (!whole) return NULL;
    /* Iteration locks taken on the wrapper carry over, so a body that
     * hydrates mid-loop still cannot mutate the collection it iterates. */
    whole->iter_lock += v->iter_lock;
    v->data.paged.hydrated = whole;
    return whole;
}

bool east_beast2_pages_find_sorted(Beast2Pages *p, EastValue *target, bool last, size_t *index_out)
{
    if (!p || !target || !index_out) {
        east_builtin_error("beast2 v5: find_sorted needs a pager, a target and an out param");
        return false;
    }
    *index_out = 0;
    if (p->type->kind != EAST_TYPE_ARRAY) {
        east_builtin_error("beast2 v5: find_sorted addresses Array roots");
        return false;
    }
    if (p->proj) {
        east_builtin_error("beast2 v5: find_sorted needs whole elements — the file is sorted by "
                           "the full element, and a projection changes comparisons; open without "
                           "project= to search");
        return false;
    }
    if (!p->index.self_contained) {
        east_builtin_error("beast2 v5: blob has cross-segment aliasing — random access needs "
                           "self-contained segments");
        return false;
    }
    if (p->index.count == 0) return true;

    /* The global insertion index decomposes: the last segment whose fence is
     * < target (<= for the upper bound) owns the boundary — everything before
     * it is entirely below — and the in-segment binary search adds its base.
     * Duplicates spanning segments make fences merely non-decreasing, which
     * both searches tolerate; sortedness itself is the caller's contract,
     * exactly as in the eager ArrayFindSorted* builtins. */
    size_t s;
    if (!pages_fence_search(p, target, last, &s)) return false;
    if (s == SIZE_MAX) s = 0;
    EastValue *seg = pages_segment_cached(p, s);
    if (!seg) return false;
    size_t lo = 0;
    size_t hi = east_array_len(seg);
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        int c = east_value_compare(east_array_get(seg, mid), target);
        if (last ? c <= 0 : c < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    east_value_release(seg);
    *index_out = (s == 0 ? 0 : p->cumulative[s - 1]) + lo;
    return true;
}
