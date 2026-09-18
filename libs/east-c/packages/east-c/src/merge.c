/*
 * The blob merge behind `merge` — see include/east/merge.h for the contract.
 */

#include <east/compat.h>
#include <east/merge.h>

#include <east/builtins.h>
#include <east/compiler.h>
#include <east/file_map.h>
#include <east/serialization.h>

#include "emit_writer.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Posts a formatted message. */
static void merge_error(const char *fmt, ...)
{
    char msg[1024];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);
    east_builtin_error(msg);
}

/* Posts `merge: input <n> (<path>): <the message already posted>`. */
static void merge_input_error(size_t index, const char *path)
{
    char *specific = east_builtin_get_error();
    merge_error("merge: input %zu (%s): %s", index, path, specific ? specific : "cannot be read");
    free(specific);
}

/* One input and its current entry. */
typedef struct {
    const char *path;
    uint8_t *data; /* the mapping */
    size_t len;
    void *map_ctx;
    Beast2SegmentReader *reader;
    EastValue *segment; /* owned; NULL when exhausted */
    size_t idx, seg_len;
    ByteBuffer *enc;     /* the current entry re-encoded: the key's bytes, then the value's */
    EastValue *key;      /* owned; NULL once the input is exhausted */
    EastValue *prev_key; /* owned; the previous entry's key, for the ascent check */
    size_t key_len, val_len;
    size_t entries; /* entries read so far */
} MergeCursor;

typedef struct {
    EastType *type; /* the inputs' collection type (input 0's) */
    EastTypeKind kind;
    EastType *key_type;
    EastType *value_type; /* Dict inputs; NULL for a Set */
    Beast2EntryEncoder *encoder;
    EastCompiledFn *merge_fn;
    bool union_mode;
    EmitWriter out;
    ByteBuffer *seg; /* the open output segment: its entries' bytes */
    size_t seg_count;
    EastValue *seg_first, *seg_last; /* owned: the open segment's first and last keys */
    EastMergeStats stats;
} Merge;

static void cursor_drop_key(MergeCursor *c)
{
    if (c->key) east_value_release(c->key);
    c->key = NULL;
}

static void cursor_close(MergeCursor *c)
{
    cursor_drop_key(c);
    if (c->prev_key) east_value_release(c->prev_key);
    if (c->segment) east_value_release(c->segment);
    if (c->reader) east_beast2_reader_free(c->reader);
    if (c->enc) byte_buffer_free(c->enc);
    if (c->data) input_release_mapping(c->map_ctx, c->data, c->len);
    memset(c, 0, sizeof(*c));
}

/* Advances a cursor to its next entry, re-encoding it into c->enc so the
 * merge copies bytes uniformly. Returns false with the message posted. */
static bool cursor_advance(Merge *m, MergeCursor *c, size_t index)
{
    cursor_drop_key(c);
    if (c->segment && c->idx + 1 < c->seg_len) {
        c->idx++;
    } else {
        if (c->segment) {
            east_value_release(c->segment);
            c->segment = NULL;
        }
        for (;;) {
            EastValue *seg = east_beast2_reader_next(c->reader);
            if (!seg) {
                if (east_beast2_reader_done(c->reader)) return true; /* exhausted */
                merge_input_error(index, c->path);
                return false;
            }
            size_t n = m->kind == EAST_TYPE_DICT ? east_dict_len(seg) : east_set_len(seg);
            if (n > 0) {
                c->segment = seg;
                c->idx = 0;
                c->seg_len = n;
                break;
            }
            east_value_release(seg);
        }
    }
    EastValue *key = m->kind == EAST_TYPE_DICT ? east_dict_key_at(c->segment, c->idx)
                                               : east_set_at(c->segment, c->idx);
    /* The reader holds each input to the canonical order; this is the same
     * check at the merge's own level, in its own words. */
    if (c->prev_key && east_value_compare(c->prev_key, key) >= 0) {
        merge_error("merge: input %zu (%s) is not in ascending key order at entry %zu", index,
                    c->path, c->entries);
        return false;
    }
    c->enc->len = 0;
    east_beast2_entry_begin(m->encoder);
    if (!east_beast2_entry_encode(m->encoder, c->enc, key, m->key_type)) {
        merge_input_error(index, c->path);
        return false;
    }
    c->key_len = c->enc->len;
    c->val_len = 0;
    if (m->kind == EAST_TYPE_DICT) {
        if (!east_beast2_entry_encode(m->encoder, c->enc, east_dict_val_at(c->segment, c->idx),
                                      m->value_type)) {
            merge_input_error(index, c->path);
            return false;
        }
        c->val_len = c->enc->len - c->key_len;
    }
    east_value_retain(key);
    c->key = key;
    if (c->prev_key) east_value_release(c->prev_key);
    east_value_retain(key);
    c->prev_key = key;
    c->entries++;
    return true;
}

/* Maps input `index`, checks its type against the merge's, and positions the
 * cursor on its first entry. Returns false with the message posted; the
 * cursor still needs cursor_close. */
static bool cursor_open(Merge *m, MergeCursor *c, size_t index, const char *path)
{
    memset(c, 0, sizeof(*c));
    c->path = path;
    c->data = map_input_file(path, &c->len, &c->map_ctx);
    if (!c->data) {
        merge_error("merge: input %zu (%s): cannot open the file", index, path);
        return false;
    }
    EastType *type = east_beast2_extract_type(c->data, c->len);
    if (!type) {
        merge_input_error(index, path);
        return false;
    }
    bool same = east_type_equal(type, m->type);
    if (!same) {
        char *got = east_print_type(type);
        char *expected = east_print_type(m->type);
        merge_error("merge: input %zu (%s) has type %s, expected %s (input 0)", index, path,
                    got ? got : "?", expected ? expected : "?");
        free(got);
        free(expected);
        east_type_release(type);
        return false;
    }
    east_type_release(type);
    c->reader = east_beast2_reader_new(c->data, c->len, m->type);
    c->enc = byte_buffer_new(256);
    if (!c->reader || !c->enc) {
        merge_input_error(index, path);
        return false;
    }
    return cursor_advance(m, c, index);
}

/* Whether input `a`'s entry leaves the heap before input `b`'s: the lesser
 * key, and for equal keys the earlier input — the order equal keys fold. */
static bool cursor_before(const MergeCursor *cur, size_t a, size_t b)
{
    int order = east_value_compare(cur[a].key, cur[b].key);
    return order < 0 || (order == 0 && a < b);
}

static void heap_sift_down(size_t *heap, size_t n, size_t i, const MergeCursor *cur)
{
    for (;;) {
        size_t least = i, l = 2 * i + 1, r = l + 1;
        if (l < n && cursor_before(cur, heap[l], heap[least])) least = l;
        if (r < n && cursor_before(cur, heap[r], heap[least])) least = r;
        if (least == i) return;
        size_t t = heap[i];
        heap[i] = heap[least];
        heap[least] = t;
        i = least;
    }
}

/* Frames the entries accumulated in the open segment as one output segment. */
static bool merge_flush(Merge *m)
{
    if (m->seg_count == 0) return true;
    bool ok = emit_writer_write_raw(&m->out, m->seg->data, m->seg->len, m->seg_count, m->seg_first,
                                    m->seg_last);
    m->seg->len = 0;
    m->seg_count = 0;
    if (m->seg_first) east_value_release(m->seg_first);
    if (m->seg_last) east_value_release(m->seg_last);
    m->seg_first = m->seg_last = NULL;
    return ok;
}

/* Writes one merged entry into the open segment, which goes out once it
 * holds the batch. */
static bool merge_put(Merge *m, EastValue *key, const uint8_t *bytes, size_t len)
{
    if (len > 0) byte_buffer_write_bytes(m->seg, bytes, len);
    if (!m->seg_first) {
        m->seg_first = key;
        east_value_retain(key);
    }
    if (m->seg_last) east_value_release(m->seg_last);
    m->seg_last = key;
    east_value_retain(key);
    m->seg_count++;
    m->stats.entries++;
    return m->seg_count < m->out.next_batch || merge_flush(m);
}

/* acc = merge(key, acc, value). Consumes `acc` and `value`; returns the result
 * (owned), or NULL with the merge function's message posted. */
static EastValue *merge_fold(Merge *m, EastValue *key, EastValue *acc, EastValue *value)
{
    EastValue *args[3] = {key, acc, value};
    EvalResult r = east_call(m->merge_fn, args, 3);
    east_value_release(acc);
    east_value_release(value);
    if (r.status == EVAL_ERROR || !r.value) {
        east_builtin_error(r.error_message ? r.error_message : "merge: the merge function failed");
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        return NULL;
    }
    EastValue *out = r.value;
    eval_result_free(&r);
    return out;
}

/* Commits the held entry of a folding merge: its bytes as copied, or — when
 * a fold ran — the key and the folded value re-encoded into `held`. */
static bool merge_commit_held(Merge *m, ByteBuffer *held, size_t key_len, EastValue *key,
                              EastValue **acc)
{
    if (*acc) {
        held->len = 0;
        east_beast2_entry_begin(m->encoder);
        bool ok = east_beast2_entry_encode(m->encoder, held, key, m->key_type);
        key_len = held->len;
        ok = ok && east_beast2_entry_encode(m->encoder, held, *acc, m->value_type);
        east_value_release(*acc);
        *acc = NULL;
        if (!ok) return false;
    }
    (void)key_len;
    return merge_put(m, key, held->data, held->len);
}

/* Merges the open cursors: a binary min-heap ordered by (key, input index),
 * so equal keys leave in input order. Keys are decoded; bytes are copied.
 * Equal keys fold — a merge function holds the current key's entry back
 * until a greater key arrives, its bytes untouched unless a second equal key
 * makes it fold, and then re-encoded from the folded value; union keeps the
 * first — or, without a fold, are the duplicate error. */
static bool merge_sources(Merge *m, MergeCursor *cur, size_t n)
{
    size_t *heap = malloc((n > 0 ? n : 1) * sizeof(size_t));
    if (!heap) return false;
    size_t live = 0;
    for (size_t i = 0; i < n; i++)
        if (cur[i].key) heap[live++] = i;
    for (size_t i = live / 2; i-- > 0;)
        heap_sift_down(heap, live, i, cur);

    ByteBuffer *held = m->merge_fn ? byte_buffer_new(256) : NULL;
    size_t held_key_len = 0;
    EastValue *held_key = NULL; /* owned */
    EastValue *held_acc = NULL; /* owned: the folded value, once a fold ran */
    EastValue *prev_key = NULL; /* owned */
    bool ok = !m->merge_fn || held != NULL;
    while (ok && live > 0) {
        size_t index = heap[0];
        MergeCursor *c = &cur[index];
        EastValue *key = c->key;
        if (prev_key && east_value_compare(prev_key, key) == 0) {
            if (!m->merge_fn && !m->union_mode) {
                const char *noun = m->kind == EAST_TYPE_DICT ? "Dict" : "Set";
                const char *part = m->kind == EAST_TYPE_DICT ? "key" : "element";
                char *printed = east_print_value(key, m->key_type);
                merge_error("beast2 v5: duplicate %s %s emitted: %s — %s %ss must be unique", noun,
                            part, printed ? printed : "?", noun, part);
                free(printed);
                ok = false;
                break;
            }
            m->stats.folds++;
            if (m->merge_fn) {
                if (!held_acc) {
                    held_acc = east_beast2_entry_decode(held->data + held_key_len,
                                                        held->len - held_key_len, m->value_type);
                }
                EastValue *v = held_acc ? east_beast2_entry_decode(c->enc->data + c->key_len,
                                                                   c->val_len, m->value_type)
                                        : NULL;
                if (!v) {
                    ok = false;
                    break;
                }
                held_acc = merge_fold(m, key, held_acc, v);
                if (!held_acc) {
                    ok = false;
                    break;
                }
            }
            /* Union: the first element stands; the equal one is dropped. */
        } else {
            east_value_retain(key);
            if (prev_key) east_value_release(prev_key);
            prev_key = key;
            if (m->merge_fn) {
                /* A greater key: the held entry is final — commit it, then
                 * hold this one. */
                if (held_key) {
                    ok = merge_commit_held(m, held, held_key_len, held_key, &held_acc);
                    east_value_release(held_key);
                    held_key = NULL;
                }
                if (ok) {
                    held->len = 0;
                    byte_buffer_write_bytes(held, c->enc->data, c->key_len + c->val_len);
                    held_key_len = c->key_len;
                    held_key = key;
                    east_value_retain(key);
                }
            } else {
                ok = merge_put(m, key, c->enc->data, c->key_len + c->val_len);
            }
        }
        if (ok) ok = cursor_advance(m, c, index);
        if (ok && !c->key) heap[0] = heap[--live];
        if (ok && live > 0) heap_sift_down(heap, live, 0, cur);
    }
    if (ok && held_key) ok = merge_commit_held(m, held, held_key_len, held_key, &held_acc);
    if (held_key) east_value_release(held_key);
    if (held_acc) east_value_release(held_acc);
    if (held) byte_buffer_free(held);
    if (prev_key) east_value_release(prev_key);
    free(heap);
    return ok;
}

/* Whether `fn` is `(K, V, V) -> V` over the inputs' key and value types. */
static bool merge_fn_matches(EastCompiledFn *fn, EastType *key_type, EastType *value_type)
{
    EastType *t = fn ? fn->fn_type : NULL;
    return t && t->kind == EAST_TYPE_FUNCTION && t->data.function.num_inputs == 3 &&
           east_type_equal(t->data.function.inputs[0], key_type) &&
           east_type_equal(t->data.function.inputs[1], value_type) &&
           east_type_equal(t->data.function.inputs[2], value_type) &&
           east_type_equal(t->data.function.output, value_type);
}

bool east_merge_blobs(const EastMergeConfig *cfg, EastMergeStats *stats_out)
{
    if (stats_out) memset(stats_out, 0, sizeof(*stats_out));
    if (!cfg || !cfg->input_paths || cfg->num_inputs == 0 || !cfg->output_path) {
        east_builtin_error("merge: needs at least one input and an output");
        return false;
    }
    if (cfg->merge_fn && cfg->union_mode) {
        east_builtin_error("merge: --merge and --union are two folds — give one");
        return false;
    }

    /* The type is input 0's, read from its header. */
    size_t len0 = 0;
    void *ctx0 = NULL;
    uint8_t *data0 = map_input_file(cfg->input_paths[0], &len0, &ctx0);
    if (!data0) {
        merge_error("merge: input 0 (%s): cannot open the file", cfg->input_paths[0]);
        return false;
    }
    EastType *type = east_beast2_extract_type(data0, len0);
    input_release_mapping(ctx0, data0, len0);
    if (!type) {
        merge_input_error(0, cfg->input_paths[0]);
        return false;
    }
    if (type->kind != EAST_TYPE_SET && type->kind != EAST_TYPE_DICT) {
        merge_error("merge: inputs must be Set or Dict blobs, got %s",
                    east_type_kind_name(type->kind));
        east_type_release(type);
        return false;
    }
    if (cfg->merge_fn && type->kind != EAST_TYPE_DICT) {
        east_builtin_error("--merge applies to Dict inputs only");
        east_type_release(type);
        return false;
    }
    if (cfg->union_mode && type->kind != EAST_TYPE_SET) {
        east_builtin_error("--union applies to Set inputs only");
        east_type_release(type);
        return false;
    }

    Merge m;
    memset(&m, 0, sizeof(m));
    m.type = type;
    m.kind = type->kind;
    m.key_type = type->kind == EAST_TYPE_DICT ? type->data.dict.key : type->data.element;
    m.value_type = type->kind == EAST_TYPE_DICT ? type->data.dict.value : NULL;
    m.merge_fn = cfg->merge_fn;
    m.union_mode = cfg->union_mode;
    if (m.merge_fn && !merge_fn_matches(m.merge_fn, m.key_type, m.value_type)) {
        char *ks = east_print_type(m.key_type);
        char *vs = east_print_type(m.value_type);
        char *ts = m.merge_fn->fn_type ? east_print_type(m.merge_fn->fn_type) : NULL;
        merge_error("--merge: expected a function (K, V, V) -> V matching the inputs (K = %s, "
                    "V = %s), got %s",
                    ks ? ks : "?", vs ? vs : "?", ts ? ts : "?");
        free(ks);
        free(vs);
        free(ts);
        east_type_release(type);
        return false;
    }

    m.encoder = east_beast2_entry_encoder_new();
    m.seg = byte_buffer_new(1 << 16);
    MergeCursor *cur = calloc(cfg->num_inputs, sizeof(MergeCursor));
    bool ok = m.encoder && m.seg && cur;
    if (!ok) east_builtin_error("merge: out of memory");
    size_t opened = 0;
    for (size_t i = 0; ok && i < cfg->num_inputs; i++) {
        opened++;
        ok = cursor_open(&m, &cur[i], i, cfg->input_paths[i]);
    }
    bool writer_open = false;
    if (ok) {
        ok = emit_writer_open(&m.out, m.type, cfg->output_path);
        writer_open = ok;
    }
    if (ok) ok = merge_sources(&m, cur, cfg->num_inputs);
    if (ok) ok = merge_flush(&m);
    if (ok) ok = emit_writer_finish(&m.out);
    if (writer_open) emit_writer_close(&m.out);
    for (size_t i = 0; i < opened; i++)
        cursor_close(&cur[i]);
    free(cur);
    if (m.seg_first) east_value_release(m.seg_first);
    if (m.seg_last) east_value_release(m.seg_last);
    if (m.seg) byte_buffer_free(m.seg);
    if (m.encoder) east_beast2_entry_encoder_free(m.encoder);
    east_type_release(type);
    if (ok && stats_out) {
        m.stats.inputs = cfg->num_inputs;
        *stats_out = m.stats;
    }
    return ok;
}
