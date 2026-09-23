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
/* The strict-ascent state a ranged cursor threads across the segments it
 * decodes through the pager — the sequential reader's own check, in its own
 * words. */
#include "serialization/beast2/v5/internal_v5.h"

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

/* Posts `merge: <who>: <the message already posted>`, or `fallback`. */
static void merge_posted_error(const char *who, const char *fallback)
{
    char *specific = east_builtin_get_error();
    merge_error("merge: %s: %s", who, specific ? specific : fallback);
    free(specific);
}

/* `input <n> (<path>)` — how a message names an input. */
static void input_who(char *buf, size_t cap, size_t index, const char *path)
{
    snprintf(buf, cap, "input %zu (%s)", index, path);
}

/* Posts `merge: input <n> (<path>): <the message already posted>`. */
static void merge_input_error(size_t index, const char *path)
{
    char who[4200];
    input_who(who, sizeof(who), index, path);
    merge_posted_error(who, "cannot be read");
}

/* Whether `path` is a regular file holding nothing. */
static bool empty_regular_file(const char *path)
{
    struct stat st;
    return stat(path, &st) == 0 && S_ISREG(st.st_mode) && st.st_size == 0;
}

/* Posts why `who`'s file could not be mapped: an empty regular file is a
 * blob too short to read, in the reader's words — the sentence east-node
 * gives for it — and a file that is missing, unreadable or not a regular
 * file cannot be opened. */
static void merge_map_error(const char *who, const char *path)
{
    char buf[128];
    merge_error("merge: %s: %s", who,
                empty_regular_file(path) ? east_beast2_magic_problem(NULL, 0, buf, sizeof(buf))
                                         : "cannot open the file");
}

/* Posts why `who`'s mapped bytes are not a blob: a short file or a wrong
 * magic in the reader's words (east-node's sentence for the same bytes),
 * else whatever the decoder posted. */
static void merge_not_blob_error(const char *who, const uint8_t *data, size_t len)
{
    char buf[128];
    const char *problem = east_beast2_magic_problem(data, len, buf, sizeof(buf));
    if (problem) {
        free(east_builtin_get_error());
        merge_error("merge: %s: %s", who, problem);
    } else {
        merge_posted_error(who, "cannot be read");
    }
}

/* One input and its current entry. A whole input is read through the
 * sequential reader; a ranged input through the pager, from the segment
 * owning the lower bound, with the strict-ascent state threaded across the
 * segments it decodes. */
typedef struct {
    const char *path;
    uint8_t *data; /* the mapping */
    size_t len;
    void *map_ctx;
    Beast2SegmentReader *reader; /* a whole input */
    Beast2Pages *pages;          /* a ranged input */
    size_t next_seg;             /* ranged: the next segment to decode */
    B2V5OrderCheck order;        /* ranged: strict ascent across the decoded segments */
    bool past_from;              /* ranged: a key at or past the lower bound has been seen */
    bool done;                   /* ranged: the upper bound, or the last segment, was reached */
    EastValue *segment;          /* owned; NULL when exhausted */
    size_t idx, seg_len;
    EastValue *key;   /* owned; NULL once the input is exhausted */
    EastValue *value; /* owned; Dict inputs only */
} MergeCursor;

typedef struct {
    EastType *type; /* the inputs' collection type (input 0's) */
    EastTypeKind kind;
    EastType *key_type;
    EastType *value_type; /* Dict inputs; NULL for a Set */
    EastCompiledFn *merge_fn;
    bool union_mode;
    EastValue *from, *to; /* owned; the key range's bounds, NULL when open */
    EmitWriter out;
    EastValue *batch; /* owned accumulator of the collection kind — the sink's */
    size_t batch_count;
    EastMergeStats stats;
} Merge;

static void cursor_drop_entry(MergeCursor *c)
{
    if (c->key) east_value_release(c->key);
    if (c->value) east_value_release(c->value);
    c->key = NULL;
    c->value = NULL;
}

static void cursor_close(MergeCursor *c)
{
    cursor_drop_entry(c);
    if (c->segment) east_value_release(c->segment);
    if (c->reader) east_beast2_reader_free(c->reader);
    if (c->pages) east_beast2_pages_free(c->pages);
    b2v5_order_check_dispose(&c->order);
    if (c->data) input_release_mapping(c->map_ctx, c->data, c->len);
    memset(c, 0, sizeof(*c));
}

/* The first and last keys of a decoded, non-empty segment (borrowed). */
static EastValue *segment_key_at(Merge *m, EastValue *seg, size_t i)
{
    return m->kind == EAST_TYPE_DICT ? east_dict_key_at(seg, i) : east_set_at(seg, i);
}

/* Loads the cursor's next non-empty segment into c->segment, or leaves it
 * NULL once the input is exhausted. Returns false with the message posted.
 * A whole input comes from the sequential reader, which holds it to the
 * canonical order; a ranged input from the pager, segment by segment from
 * the sought one, its first key accepted into the ascent state the previous
 * segment's last key left — the reader's check, extended across segments in
 * its own words. */
static bool cursor_load_segment(Merge *m, MergeCursor *c, size_t index)
{
    if (c->done) return true;
    for (;;) {
        EastValue *seg;
        if (c->pages) {
            if (c->next_seg >= east_beast2_pages_segment_count(c->pages)) {
                c->done = true;
                return true;
            }
            seg = east_beast2_pages_segment(c->pages, c->next_seg++);
            if (!seg) {
                merge_input_error(index, c->path);
                return false;
            }
        } else {
            seg = east_beast2_reader_next(c->reader);
            if (!seg) {
                if (east_beast2_reader_done(c->reader)) {
                    c->done = true;
                    return true;
                }
                merge_input_error(index, c->path);
                return false;
            }
        }
        size_t n = m->kind == EAST_TYPE_DICT ? east_dict_len(seg) : east_set_len(seg);
        if (n == 0) {
            east_value_release(seg);
            continue;
        }
        if (c->pages) {
            if (!b2v5_order_accept(&c->order, segment_key_at(m, seg, 0),
                                   m->kind == EAST_TYPE_DICT)) {
                east_value_release(seg);
                merge_input_error(index, c->path);
                return false;
            }
            /* The segment's own ascent was checked as it decoded; its last
             * key is what the next segment's first must exceed. */
            EastValue *last = segment_key_at(m, seg, n - 1);
            east_value_retain(last);
            east_value_release(c->order.prev);
            c->order.prev = last;
        }
        c->segment = seg;
        c->idx = 0;
        c->seg_len = n;
        return true;
    }
}

/* Advances a cursor to its next entry within the merge's key range, holding
 * the decoded key and value — the merge writes VALUES through the emit
 * sink's own writer, so the output is what the sink writes for the same
 * entries, whatever aliasing scope the input's writer used. Returns false
 * with the message posted. The reader holds each input to the canonical
 * order: a key that does not ascend is its error, prefixed with the input,
 * in the same words on every runtime. */
static bool cursor_advance(Merge *m, MergeCursor *c, size_t index)
{
    cursor_drop_entry(c);
    for (;;) {
        if (c->segment && c->idx + 1 < c->seg_len) {
            c->idx++;
        } else {
            if (c->segment) {
                east_value_release(c->segment);
                c->segment = NULL;
            }
            if (!cursor_load_segment(m, c, index)) return false;
            if (!c->segment) return true; /* exhausted */
        }
        EastValue *key = segment_key_at(m, c->segment, c->idx);
        /* Keys below the lower bound — in the sought segment only — are
         * skipped; the first key at or past the upper bound ends the input. */
        if (m->from && !c->past_from) {
            if (east_value_compare(key, m->from) < 0) continue;
            c->past_from = true;
        }
        if (m->to && east_value_compare(key, m->to) >= 0) {
            east_value_release(c->segment);
            c->segment = NULL;
            c->done = true;
            return true;
        }
        if (m->kind == EAST_TYPE_DICT) {
            EastValue *value = east_dict_val_at(c->segment, c->idx); /* borrowed */
            east_value_retain(value);
            c->value = value;
        }
        east_value_retain(key);
        c->key = key;
        return true;
    }
}

/* Positions a ranged cursor at the segment owning the lower bound: the
 * fences are probed (a bounded prefix of each frame) and checked to ascend
 * strictly — a fence that does not ascend is a key that does not ascend, the
 * reader's own error — and the greatest fence at or below the bound picks
 * the segment; a bound below every fence starts at the first. Returns false
 * with the message posted. */
static bool cursor_seek(Merge *m, MergeCursor *c, size_t index)
{
    size_t n = east_beast2_pages_segment_count(c->pages);
    bool is_dict = m->kind == EAST_TYPE_DICT;
    B2V5OrderCheck fences = {0};
    for (size_t i = 0; i < n; i++) {
        EastValue *f = east_beast2_pages_fence(c->pages, i);
        bool ok = f && b2v5_order_accept(&fences, f, is_dict);
        if (f) east_value_release(f);
        if (!ok) {
            b2v5_order_check_dispose(&fences);
            merge_input_error(index, c->path);
            return false;
        }
    }
    b2v5_order_check_dispose(&fences);
    /* The first segment whose fence is above the bound; the one before it
     * owns the bound. */
    size_t lo = 0, hi = n;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        EastValue *f = east_beast2_pages_fence(c->pages, mid);
        if (!f) {
            merge_input_error(index, c->path);
            return false;
        }
        int order = east_value_compare(f, m->from);
        east_value_release(f);
        if (order <= 0)
            lo = mid + 1;
        else
            hi = mid;
    }
    c->next_seg = lo == 0 ? 0 : lo - 1;
    return true;
}

/* Maps input `index`, checks its type against the merge's, and positions the
 * cursor on its first entry — within the merge's key range, when it has
 * one. Returns false with the message posted; the cursor still needs
 * cursor_close. */
static bool cursor_open(Merge *m, MergeCursor *c, size_t index, const char *path)
{
    memset(c, 0, sizeof(*c));
    c->path = path;
    char who[4200];
    input_who(who, sizeof(who), index, path);
    c->data = map_input_file(path, &c->len, &c->map_ctx);
    if (!c->data) {
        merge_map_error(who, path);
        return false;
    }
    EastType *type = east_beast2_extract_type(c->data, c->len);
    if (!type) {
        merge_not_blob_error(who, c->data, c->len);
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
    /* Every input carries the paging index — what the runners write, and
     * what a seek needs — so a blob without one is refused in the reader's
     * words, east-node's sentence for the same bytes. */
    B2V5Index paging;
    int ix = b2v5_read_index(c->data, c->len, &paging);
    if (ix == 1) b2v5_index_free(&paging);
    if (ix == 0) {
        merge_error(
            "merge: %s: beast2 v5: blob carries no index — ranged reads need one (write with "
            "the index enabled, the default)",
            who);
        return false;
    }
    if (ix == -1) {
        merge_posted_error(who, "cannot be read");
        return false;
    }
    if (m->from || m->to) {
        c->pages = east_beast2_pages_new(c->data, c->len, m->type);
        if (!c->pages) {
            merge_input_error(index, path);
            return false;
        }
        if (m->from && !cursor_seek(m, c, index)) return false;
    } else {
        c->reader = east_beast2_reader_new(c->data, c->len, m->type);
        if (!c->reader) {
            merge_input_error(index, path);
            return false;
        }
    }
    return cursor_advance(m, c, index);
}

/* Reads the merge's key range: `Struct{from: Option<K>, to: Option<K>}`
 * over the inputs' key type — the shape east-node checks (merge.ts) and
 * e3-core writes (partitionExec.ts) — self-describing, checked against that
 * type. Returns false with the message posted. */
static bool merge_read_range(Merge *m, const char *path)
{
    size_t len = 0;
    void *ctx = NULL;
    char who[4200];
    snprintf(who, sizeof(who), "--range (%s)", path);
    uint8_t *data = map_input_file(path, &len, &ctx);
    if (!data) {
        merge_map_error(who, path);
        return false;
    }
    const char *case_names[2] = {"none", "some"};
    EastType *case_types[2] = {&east_null_type, m->key_type};
    EastType *option = east_variant_type(case_names, case_types, 2);
    const char *field_names[2] = {"from", "to"};
    EastType *field_types[2] = {option, option};
    EastType *expected = east_struct_type(field_names, field_types, 2);
    bool ok = false;
    EastValue *bounds = NULL;
    EastType *type = east_beast2_extract_type(data, len);
    if (!type) {
        merge_not_blob_error(who, data, len);
    } else if (!east_type_equal(type, expected)) {
        char *got = east_print_type(type);
        char *want = east_print_type(expected);
        merge_error(
            "merge: --range (%s) has type %s, expected %s (bounds over the inputs' key type)", path,
            got ? got : "?", want ? want : "?");
        free(got);
        free(want);
    } else if (!(bounds = east_beast2_decode_full(data, len, expected))) {
        merge_posted_error(who, "cannot be read");
    } else {
        EastValue *from = east_struct_get_field(bounds, "from"); /* borrowed */
        EastValue *to = east_struct_get_field(bounds, "to");
        if (from && strcmp(east_variant_case_name(from), "some") == 0) {
            m->from = from->data.variant.value;
            east_value_retain(m->from);
        }
        if (to && strcmp(east_variant_case_name(to), "some") == 0) {
            m->to = to->data.variant.value;
            east_value_retain(m->to);
        }
        ok = true;
    }
    if (bounds) east_value_release(bounds);
    if (type) east_type_release(type);
    input_release_mapping(ctx, data, len);
    return ok;
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

/* An empty batch of the inputs' collection kind. */
static EastValue *merge_new_batch(Merge *m)
{
    return m->kind == EAST_TYPE_DICT ? east_dict_new(m->key_type, m->value_type)
                                     : east_set_new(m->key_type);
}

/* Writes the open batch as one output segment, through the writer the emit
 * sink writes through. */
static bool merge_flush(Merge *m)
{
    if (m->batch_count == 0) return true;
    if (!emit_writer_write(&m->out, m->batch, m->batch_count)) return false;
    east_value_release(m->batch);
    m->batch = merge_new_batch(m);
    m->batch_count = 0;
    if (!m->batch) {
        east_builtin_error("merge: out of memory");
        return false;
    }
    return true;
}

/* Appends one merged entry to the open batch, under the sink's flush rule:
 * a full batch goes out only now that an entry which will not fold into it
 * has arrived, so the batch's last entry is always still open for a fold. */
static bool merge_append(Merge *m, EastValue *key, EastValue *value)
{
    if (emit_writer_starts_segment(&m->out, key, m->batch_count) && !merge_flush(m)) return false;
    if (m->kind == EAST_TYPE_DICT)
        east_dict_set(m->batch, key, value);
    else
        east_set_insert(m->batch, key);
    m->batch_count++;
    m->stats.entries++;
    /* The opening probe sizes the first segment from what these entries
     * weigh, as the paged encoder and the sink do. */
    return emit_writer_probe(&m->out, &m->batch, &m->batch_count);
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

/* Merges the open cursors: a binary min-heap ordered by (key, input index),
 * so equal keys leave in input order. Entries are decoded values, appended to
 * the open batch and encoded by the emit sink's own writer — one aliasing
 * scope per entry, so a container two entries share is written out in each,
 * exactly as `run --emit` writes it.
 *
 * Equal keys fold in place: the flush rule keeps the previous entry in the
 * open batch, so `acc = merge(key, acc, value)` replaces it there, as the
 * sink's fold does. Union keeps the first; without a fold an equal key is
 * the duplicate error. */
static bool merge_sources(Merge *m, MergeCursor *cur, size_t n)
{
    size_t *heap = malloc((n > 0 ? n : 1) * sizeof(size_t));
    if (!heap) return false;
    size_t live = 0;
    for (size_t i = 0; i < n; i++)
        if (cur[i].key) heap[live++] = i;
    for (size_t i = live / 2; i-- > 0;)
        heap_sift_down(heap, live, i, cur);

    EastValue *prev_key = NULL; /* owned */
    bool ok = true;
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
                /* The previous entry is still in the open batch — the flush
                 * rule guarantees it — so the fold lands in place. */
                EastValue *acc = east_dict_get(m->batch, key); /* borrowed */
                if (!acc) {
                    east_builtin_error("merge: the folded key is missing from the batch");
                    ok = false;
                    break;
                }
                east_value_retain(acc);
                east_value_retain(c->value);
                EastValue *folded = merge_fold(m, key, acc, c->value);
                if (!folded) {
                    ok = false;
                    break;
                }
                east_dict_set(m->batch, key, folded);
                east_value_release(folded);
            }
            /* Union: the first element stands; the equal one is dropped. */
        } else {
            east_value_retain(key);
            if (prev_key) east_value_release(prev_key);
            prev_key = key;
            ok = merge_append(m, key, c->value);
        }
        if (ok) ok = cursor_advance(m, c, index);
        if (ok && !c->key) heap[0] = heap[--live];
        if (ok && live > 0) heap_sift_down(heap, live, 0, cur);
    }
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
    char who0[4200];
    input_who(who0, sizeof(who0), 0, cfg->input_paths[0]);
    uint8_t *data0 = map_input_file(cfg->input_paths[0], &len0, &ctx0);
    if (!data0) {
        merge_map_error(who0, cfg->input_paths[0]);
        return false;
    }
    EastType *type = east_beast2_extract_type(data0, len0);
    if (!type) {
        merge_not_blob_error(who0, data0, len0);
        input_release_mapping(ctx0, data0, len0);
        return false;
    }
    input_release_mapping(ctx0, data0, len0);
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

    m.batch = merge_new_batch(&m);
    MergeCursor *cur = calloc(cfg->num_inputs, sizeof(MergeCursor));
    bool ok = m.batch && cur;
    if (!ok) east_builtin_error("merge: out of memory");
    if (ok && cfg->range_path) ok = merge_read_range(&m, cfg->range_path);
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
    if (m.batch) east_value_release(m.batch);
    if (m.from) east_value_release(m.from);
    if (m.to) east_value_release(m.to);
    east_type_release(type);
    if (ok && stats_out) {
        m.stats.inputs = cfg->num_inputs;
        *stats_out = m.stats;
    }
    return ok;
}
