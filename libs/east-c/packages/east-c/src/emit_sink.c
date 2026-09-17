/*
 * The streaming emit sink behind `run --emit` — see include/east/emit_sink.h
 * for the contract. Shared by the east-c CLI and east-py, so both write the
 * same bytes for the same emissions.
 */

#include <east/compat.h>
#include <east/emit_sink.h>

#include <east/builtins.h>
#include <east/compiler.h>
#include <east/serialization.h>

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Batching mirrors the paged encoder: an element cap, refined toward a
 * byte target from the writer's actual output as segments flush. */
#define EMIT_BATCH_CAP 1000
#define EMIT_TARGET_BYTES (2u * 1024u * 1024u)

/* Out-of-order Set/Dict emission buffers and spills sorted runs of at most
 * this many elements (EAST_EMIT_RUN_ELEMENTS overrides; minimum 1) — the
 * in-memory bound of the sink's spill/merge path (issue #518). */
#define EMIT_RUN_ELEMENTS_DEFAULT 100000u

static size_t emit_run_elements_from_env(void)
{
    const char *env = getenv("EAST_EMIT_RUN_ELEMENTS");
    if (env && *env) {
        bool digits = true;
        for (const char *p = env; *p; p++) {
            if (*p < '0' || *p > '9') {
                digits = false;
                break;
            }
        }
        if (digits) {
            errno = 0;
            char *end = NULL;
            unsigned long long v = strtoull(env, &end, 10);
            if (errno == 0 && end && *end == '\0' && v >= 1 && v <= (unsigned long long)SIZE_MAX)
                return (size_t)v;
        }
    }
    return EMIT_RUN_ELEMENTS_DEFAULT;
}

/* One buffered out-of-order emission, encoded at the emit: the decoded key
 * (owned — it orders the run and catches duplicates) and where its entry
 * bytes — the key then, for dict outputs, the value, exactly as a segment
 * holds them — sit in the run arena. The value itself is released at the
 * emit, while it is small and hot. `seq` is the emission's position in the
 * stream: entries order by (key, seq), so equal keys fold in emission order. */
typedef struct {
    EastValue *key;
    size_t offset;
    size_t key_len;
    size_t val_len;
    uint64_t seq;
} EmitPending;

struct EastEmitSink {
    FILE *out;
    Beast2StreamWriter *writer;
    EastType *out_type;      /* borrowed: the output collection type */
    const char *output_path; /* borrowed */
    EastEmitKind kind;
    bool verbose;
    EastCompiledFn *merge_fn; /* borrowed: folds equal dict keys, or NULL */
    bool union_mode;          /* equal set elements collapse to the first */
    EastValue *batch;         /* owned accumulator of the collection kind */
    EastValue *last_key;      /* owned: previous key/element for the ascent check */
    size_t batch_count;
    size_t next_batch;
    size_t written_elements;
    size_t written_bytes;
    /* written_bytes at the current writer's creation. The batch refinement
     * needs the total the sink WILL have written once every frame lands —
     * writer_base + the writer's emitted total — which, with frames still
     * deflating on the pool (#763), only the writer's bounds can give. */
    size_t writer_base;
    size_t emitted;
    /* Out-of-order (spill/merge) state; `buffered` false means the
     * ascending fast path is still live. */
    bool buffered;
    EmitPending *buf;
    size_t buf_len, buf_cap;
    ByteBuffer *arena;           /* the current run's entry bytes */
    Beast2EntryEncoder *encoder; /* per-entry self-contained encoder */
    size_t run_cap;
    char **run_paths; /* owned paths of spilled runs (run 0 = demoted prefix) */
    size_t num_runs, runs_cap;
    size_t spilled_bytes;
    /* The -v epilogue's account of the buffered path. */
    size_t spills;
    size_t peak_entries;
    size_t peak_bytes;
    double spill_ms;
    double merge_ms;
};

typedef struct EastEmitSink EmitSink;

static double elapsed_ms(struct timespec *start, struct timespec *end)
{
    return (double)(end->tv_sec - start->tv_sec) * 1000.0 +
           (double)(end->tv_nsec - start->tv_nsec) / 1e6;
}

static double emit_elapsed_ms(struct timespec *since)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return elapsed_ms(since, &now);
}

/* Reads a whole file into a malloc'd buffer; NULL when it cannot be read. */
static uint8_t *read_whole_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc((size_t)len > 0 ? (size_t)len : 1u);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    *out_len = rd;
    return buf;
}

static EastValue *emit_new_batch(EmitSink *s)
{
    switch (s->kind) {
    case EAST_EMIT_ARRAY:
    case EAST_EMIT_SET:
        return s->kind == EAST_EMIT_ARRAY ? east_array_new(s->out_type->data.element)
                                          : east_set_new(s->out_type->data.element);
    default:
        return east_dict_new(s->out_type->data.dict.key, s->out_type->data.dict.value);
    }
}

/* The key type of a Set/Dict sink (the element type for a Set). */
static EastType *emit_key_type(EmitSink *s)
{
    return s->kind == EAST_EMIT_DICT ? s->out_type->data.dict.key : s->out_type->data.element;
}

/* Whether equal keys fold (merge or union) instead of being a duplicate. */
static bool emit_folds(EmitSink *s)
{
    return s->merge_fn != NULL || s->union_mode;
}

/* acc = merge(key, acc, value). Consumes `acc` and `value`; returns the result
 * (owned), or NULL with the merge function's message posted. */
static EastValue *emit_fold_values(EmitSink *s, EastValue *key, EastValue *acc, EastValue *value)
{
    EastValue *args[3] = {key, acc, value};
    EvalResult r = east_call(s->merge_fn, args, 3);
    east_value_release(acc);
    east_value_release(value);
    if (r.status == EVAL_ERROR || !r.value) {
        east_builtin_error(r.error_message ? r.error_message : "emit: the merge function failed");
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        return NULL;
    }
    EastValue *out = r.value;
    eval_result_free(&r);
    return out;
}

static bool emit_drain(EmitSink *s)
{
    ByteBuffer *buf = east_beast2_writer_take(s->writer);
    if (!buf) return true;
    size_t wrote = fwrite(buf->data, 1, buf->len, s->out);
    bool ok = wrote == buf->len;
    s->written_bytes += wrote;
    byte_buffer_free(buf);
    return ok;
}

/* The refinement: `bytes` written over `elements`, toward the byte target,
 * clamped to the element cap. Non-increasing in `bytes`. */
static size_t emit_next_batch(size_t bytes, size_t elements)
{
    size_t avg = bytes / (elements > 0 ? elements : 1);
    if (avg == 0) avg = 1;
    size_t next = EMIT_TARGET_BYTES / avg;
    if (next < 1) next = 1;
    if (next > EMIT_BATCH_CAP) next = EMIT_BATCH_CAP;
    return next;
}

/* After a segment of `n` elements landed: the running average wire size
 * refines the next batch toward the byte target. The byte count includes
 * the header — a slight average overestimate that only makes batches
 * marginally smaller. Shared by the value path and the raw merge so both
 * segment identically.
 *
 * The frames may still be deflating on the writer's pool, so the exact byte
 * count is not yet known: decide at both of the writer's bounds, and only
 * when those decisions differ wait for the frames. The decision is monotone
 * in the byte count, so agreeing bounds give exactly the decision a serial
 * writer would have made — the segmentation, and every byte, is unchanged. */
static void emit_adapt_batch(EmitSink *s, size_t n)
{
    s->written_elements += n;
    size_t lo, hi;
    east_beast2_writer_emitted_bounds(s->writer, &lo, &hi);
    size_t next = emit_next_batch(s->writer_base + lo, s->written_elements);
    if (next != emit_next_batch(s->writer_base + hi, s->written_elements)) {
        east_beast2_writer_settle(s->writer);
        east_beast2_writer_emitted_bounds(s->writer, &lo, &hi);
        next = emit_next_batch(s->writer_base + lo, s->written_elements);
    }
    s->next_batch = next;
}

static bool emit_flush(EmitSink *s)
{
    if (s->batch_count == 0) return true;
    if (!east_beast2_writer_write(s->writer, s->batch)) return false;
    if (!emit_drain(s)) return false;
    size_t n = s->batch_count;
    east_value_release(s->batch);
    s->batch = emit_new_batch(s);
    s->batch_count = 0;
    if (!s->batch) return false;
    emit_adapt_batch(s, n);
    return true;
}

/* Formats the duplicate-key error (shared by the emit-time eval error and
 * the finalize-time report). `key` may be NULL. */
static void emit_duplicate_msg(EmitSink *s, EastValue *key, char *buf, size_t buflen)
{
    const char *noun = s->kind == EAST_EMIT_DICT ? "Dict" : "Set";
    const char *part = s->kind == EAST_EMIT_DICT ? "key" : "element";
    char *printed = key ? east_print_value(key, emit_key_type(s)) : NULL;
    snprintf(buf, buflen, "beast2 v5: duplicate %s %s emitted%s%s — %s %ss must be unique", noun,
             part, printed ? ": " : "", printed ? printed : "", noun, part);
    free(printed);
}

static char *emit_run_path(EmitSink *s, size_t i)
{
    size_t len = strlen(s->output_path) + 32;
    char *p = malloc(len);
    if (p) snprintf(p, len, "%s.run%zu", s->output_path, i);
    return p;
}

/* Drops the buffered entries: their keys, and the arena's bytes. */
static void emit_buf_clear(EmitSink *s)
{
    for (size_t i = 0; i < s->buf_len; i++)
        east_value_release(s->buf[i].key);
    s->buf_len = 0;
    if (s->arena) s->arena->len = 0;
}

/* Encodes one emission into the arena and keeps its key. */
static bool emit_buf_push(EmitSink *s, EastValue *key, EastValue *val)
{
    if (s->buf_len == s->buf_cap) {
        size_t cap = s->buf_cap ? s->buf_cap * 2 : 1024;
        EmitPending *grown = realloc(s->buf, cap * sizeof(EmitPending));
        if (!grown) return false;
        s->buf = grown;
        s->buf_cap = cap;
    }
    size_t offset = s->arena->len;
    east_beast2_entry_begin(s->encoder);
    if (!east_beast2_entry_encode(s->encoder, s->arena, key, emit_key_type(s))) return false;
    size_t key_len = s->arena->len - offset;
    size_t val_len = 0;
    if (val) {
        if (!east_beast2_entry_encode(s->encoder, s->arena, val, s->out_type->data.dict.value))
            return false;
        val_len = s->arena->len - offset - key_len;
    }
    east_value_retain(key);
    s->buf[s->buf_len++] = (EmitPending){key, offset, key_len, val_len, s->emitted};
    if (s->buf_len > s->peak_entries) s->peak_entries = s->buf_len;
    if (s->arena->len > s->peak_bytes) s->peak_bytes = s->arena->len;
    return true;
}

static bool emit_runs_reserve(EmitSink *s)
{
    if (s->runs_cap > s->num_runs) return true;
    size_t cap = s->runs_cap ? s->runs_cap * 2 : 8;
    char **grown = realloc(s->run_paths, cap * sizeof(char *));
    if (!grown) return false;
    s->run_paths = grown;
    s->runs_cap = cap;
    return true;
}

static int emit_pending_cmp(const void *a, const void *b)
{
    const EmitPending *x = a, *y = b;
    int order = east_value_compare(x->key, y->key);
    if (order != 0) return order;
    return x->seq < y->seq ? -1 : x->seq > y->seq ? 1 : 0;
}

/* Sorts the pending buffer by (key, emission sequence). Without a fold, an
 * adjacent equal pair is a duplicate: returns 1 with the offending key
 * (borrowed from the buffer) in *dup_out. With a fold, each run of equal keys
 * collapses to one entry in emission order — union keeps the first; merge
 * folds the values and re-encodes the key and the result at the arena's end.
 * Returns 0 on success, 2 with the message posted on a failure (the merge
 * function's error, an encode failure). */
static int emit_sort_pending(EmitSink *s, EastValue **dup_out)
{
    qsort(s->buf, s->buf_len, sizeof(EmitPending), emit_pending_cmp);
    bool folds = emit_folds(s);
    size_t kept = 0;
    for (size_t i = 0; i < s->buf_len;) {
        size_t j = i + 1;
        while (j < s->buf_len && east_value_compare(s->buf[i].key, s->buf[j].key) == 0)
            j++;
        if (j - i > 1) {
            if (!folds) {
                *dup_out = s->buf[i + 1].key;
                return 1;
            }
            if (s->merge_fn) {
                EmitPending *e = &s->buf[i];
                EastType *vt = s->out_type->data.dict.value;
                EastValue *acc = east_beast2_entry_decode(s->arena->data + e->offset + e->key_len,
                                                          e->val_len, vt);
                for (size_t k = i + 1; acc && k < j; k++) {
                    const EmitPending *next = &s->buf[k];
                    EastValue *v = east_beast2_entry_decode(
                        s->arena->data + next->offset + next->key_len, next->val_len, vt);
                    if (!v) {
                        east_value_release(acc);
                        acc = NULL;
                        break;
                    }
                    acc = emit_fold_values(s, e->key, acc, v);
                }
                if (!acc) return 2;
                size_t offset = s->arena->len;
                east_beast2_entry_begin(s->encoder);
                bool ok = east_beast2_entry_encode(s->encoder, s->arena, e->key, emit_key_type(s));
                size_t key_len = s->arena->len - offset;
                ok = ok && east_beast2_entry_encode(s->encoder, s->arena, acc, vt);
                east_value_release(acc);
                if (!ok) return 2;
                e->offset = offset;
                e->key_len = key_len;
                e->val_len = s->arena->len - offset - key_len;
                if (s->arena->len > s->peak_bytes) s->peak_bytes = s->arena->len;
            }
            for (size_t k = i + 1; k < j; k++)
                east_value_release(s->buf[k].key);
        }
        s->buf[kept++] = s->buf[i];
        i = j;
    }
    s->buf_len = kept;
    return 0;
}

/* ----- the run record format: LEB128 length prefixes around raw bytes ----- */

static bool run_write_varint(FILE *f, uint64_t v)
{
    uint8_t b[10];
    size_t n = 0;
    do {
        uint8_t byte = (uint8_t)(v & 0x7f);
        v >>= 7;
        if (v) byte |= 0x80;
        b[n++] = byte;
    } while (v);
    return fwrite(b, 1, n, f) == n;
}

/* Returns 1 with *out read, 0 at a clean end of file (before any byte of
 * the number), -1 on a truncated or overlong number. */
static int run_read_varint(FILE *f, uint64_t *out)
{
    uint64_t v = 0;
    unsigned shift = 0;
    bool first = true;
    for (;;) {
        int c = fgetc(f);
        if (c == EOF) return first ? 0 : -1;
        first = false;
        v |= (uint64_t)(c & 0x7f) << shift;
        if (!(c & 0x80)) break;
        shift += 7;
        if (shift > 63) return -1;
    }
    *out = v;
    return 1;
}

/* Writes the sorted (and folded) pending buffer as one raw run file and
 * clears it. Returns 0 on success, 1 on a duplicate (retaining the offending
 * key into *dup_out), 2 on an I/O or allocation failure, 3 on a fold failure
 * (message posted). */
static int emit_spill(EmitSink *s, EastValue **dup_out)
{
    if (s->buf_len == 0) return 0;
    struct timespec t0;
    if (s->verbose) clock_gettime(CLOCK_MONOTONIC, &t0);
    EastValue *dup = NULL;
    int sorted = emit_sort_pending(s, &dup);
    if (sorted == 1) {
        east_value_retain(dup);
        *dup_out = dup;
        return 1;
    }
    if (sorted != 0) return 3;
    if (!emit_runs_reserve(s)) return 2;
    char *path = emit_run_path(s, s->num_runs);
    if (!path) return 2;
    FILE *rf = fopen(path, "wb");
    if (!rf) {
        free(path);
        return 2;
    }
    bool ok = true;
    size_t bytes = 0;
    for (size_t i = 0; ok && i < s->buf_len; i++) {
        const EmitPending *e = &s->buf[i];
        const uint8_t *rec = s->arena->data + e->offset;
        ok = run_write_varint(rf, e->key_len) && fwrite(rec, 1, e->key_len, rf) == e->key_len &&
             run_write_varint(rf, e->val_len) &&
             fwrite(rec + e->key_len, 1, e->val_len, rf) == e->val_len;
        bytes += e->key_len + e->val_len;
    }
    ok = fclose(rf) == 0 && ok;
    if (!ok) {
        remove(path);
        free(path);
        return 2;
    }
    s->run_paths[s->num_runs++] = path;
    s->spilled_bytes += bytes;
    s->spills++;
    emit_buf_clear(s);
    if (s->verbose) s->spill_ms += emit_elapsed_ms(&t0);
    return 0;
}

/* First out-of-order key: finalize the ascending prefix written so far (a
 * complete canonical beast2 file), demote it to spill run #0 — the one run
 * the merge reads as a beast2 blob — and switch to buffered emission. */
static bool emit_demote_to_runs(EmitSink *s)
{
    if (!emit_flush(s)) return false;
    bool ok = east_beast2_writer_finish(s->writer);
    ok = emit_drain(s) && ok;
    ok = fclose(s->out) == 0 && ok;
    s->out = NULL;
    east_beast2_writer_free(s->writer);
    s->writer = NULL;
    if (!ok) return false;
    if (s->written_elements > 0) {
        if (!emit_runs_reserve(s)) return false;
        char *run0 = emit_run_path(s, 0);
        if (!run0) return false;
        remove(run0); /* Windows rename() refuses an existing destination */
        if (rename(s->output_path, run0) != 0) {
            free(run0);
            return false;
        }
        s->run_paths[s->num_runs++] = run0;
        s->spilled_bytes += s->written_bytes;
    } else {
        /* Header-only prefix: nothing emitted before the inversion. */
        remove(s->output_path);
    }
    s->buffered = true;
    s->arena = byte_buffer_new(1 << 16);
    s->encoder = east_beast2_entry_encoder_new();
    if (!s->arena || !s->encoder) return false;
    fprintf(stderr,
            "east emit: %s left ascending order at element %zu; establishing canonical "
            "order in the sink (spill/merge)\n",
            s->kind == EAST_EMIT_DICT ? "Dict keys" : "Set elements", s->emitted);
    return true;
}

/* One merge cursor over a spilled run. Run 0 is the demoted ascending
 * prefix, a beast2 blob read through the segment reader with its values
 * re-encoded entry by entry; every later run is raw records read
 * sequentially, its keys decoded and its bytes copied as they are. */
typedef struct {
    /* raw runs */
    FILE *f;
    uint8_t *rec; /* current record's bytes: key then value */
    size_t rec_cap;
    /* the demoted beast2 prefix */
    uint8_t *data;
    size_t len;
    Beast2SegmentReader *reader;
    EastValue *segment; /* owned; NULL when exhausted */
    size_t idx, seg_len;
    ByteBuffer *enc; /* the current pair re-encoded */
    /* both */
    EastValue *key; /* owned: the current key, NULL when exhausted */
    size_t key_len, val_len;
} MergeCursor;

static void cursor_drop_key(MergeCursor *c)
{
    if (c->key) east_value_release(c->key);
    c->key = NULL;
}

/* Advances a raw-run cursor to its next record. Returns false on a read or
 * decode error (message posted). */
static bool cursor_advance_raw(EmitSink *s, MergeCursor *c)
{
    cursor_drop_key(c);
    uint64_t klen, vlen;
    int r = run_read_varint(c->f, &klen);
    if (r == 0) return true; /* exhausted */
    if (r < 0) goto corrupt;
    if (c->rec_cap < klen) {
        uint8_t *grown = realloc(c->rec, (size_t)klen);
        if (!grown) return false;
        c->rec = grown;
        c->rec_cap = (size_t)klen;
    }
    if (fread(c->rec, 1, (size_t)klen, c->f) != klen) goto corrupt;
    if (run_read_varint(c->f, &vlen) != 1) goto corrupt;
    if (c->rec_cap < klen + vlen) {
        uint8_t *grown = realloc(c->rec, (size_t)(klen + vlen));
        if (!grown) return false;
        c->rec = grown;
        c->rec_cap = (size_t)(klen + vlen);
    }
    if (fread(c->rec + klen, 1, (size_t)vlen, c->f) != vlen) goto corrupt;
    c->key = east_beast2_entry_decode(c->rec, (size_t)klen, emit_key_type(s));
    if (!c->key) {
        char *err = east_builtin_get_error();
        char msg[512];
        snprintf(msg, sizeof(msg), "emit: cannot decode a spilled key: %s", err ? err : "?");
        free(err);
        east_builtin_error(msg);
        return false;
    }
    c->key_len = (size_t)klen;
    c->val_len = (size_t)vlen;
    return true;
corrupt:
    east_builtin_error("emit: a spilled run is truncated or corrupt");
    return false;
}

/* Advances the demoted-prefix cursor to its next pair, re-encoding it into
 * c->enc so the merge copies bytes uniformly. */
static bool cursor_advance_prefix(EmitSink *s, MergeCursor *c)
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
            if (!seg) return east_beast2_reader_done(c->reader); /* exhausted, or error */
            size_t n = s->kind == EAST_EMIT_DICT ? east_dict_len(seg) : east_set_len(seg);
            if (n > 0) {
                c->segment = seg;
                c->idx = 0;
                c->seg_len = n;
                break;
            }
            east_value_release(seg);
        }
    }
    EastValue *key = s->kind == EAST_EMIT_DICT ? east_dict_key_at(c->segment, c->idx)
                                               : east_set_at(c->segment, c->idx);
    c->enc->len = 0;
    east_beast2_entry_begin(s->encoder);
    if (!east_beast2_entry_encode(s->encoder, c->enc, key, emit_key_type(s))) return false;
    c->key_len = c->enc->len;
    c->val_len = 0;
    if (s->kind == EAST_EMIT_DICT) {
        if (!east_beast2_entry_encode(s->encoder, c->enc, east_dict_val_at(c->segment, c->idx),
                                      s->out_type->data.dict.value))
            return false;
        c->val_len = c->enc->len - c->key_len;
    }
    east_value_retain(key);
    c->key = key;
    return true;
}

static bool cursor_advance(EmitSink *s, MergeCursor *c)
{
    return c->reader ? cursor_advance_prefix(s, c) : cursor_advance_raw(s, c);
}

static const uint8_t *cursor_bytes(const MergeCursor *c)
{
    return c->reader ? c->enc->data : c->rec;
}

/* Frames the raw entries accumulated in `seg` as one output segment. */
static bool emit_flush_raw(EmitSink *s, ByteBuffer *seg, size_t *count, EastValue **first,
                           EastValue **last)
{
    if (*count == 0) return true;
    bool ok = east_beast2_writer_write_raw(s->writer, seg->data, seg->len, *count, *first, *last);
    ok = ok && emit_drain(s);
    if (ok) emit_adapt_batch(s, *count);
    seg->len = 0;
    *count = 0;
    if (*first) east_value_release(*first);
    if (*last) east_value_release(*last);
    *first = *last = NULL;
    return ok;
}

/* Appends the held entry of a folding merge to the output segment: its bytes
 * as copied, or — when a fold ran — the key and the folded value re-encoded
 * (and *acc released). Keeps the segment's first/last keys for the writer's
 * ascent check. */
static bool emit_commit_held(EmitSink *s, ByteBuffer *seg, ByteBuffer *held, EastValue *held_key,
                             EastValue **acc, EastValue **seg_first, EastValue **seg_last,
                             size_t *seg_count)
{
    if (*acc) {
        east_beast2_entry_begin(s->encoder);
        bool ok = east_beast2_entry_encode(s->encoder, seg, held_key, emit_key_type(s)) &&
                  east_beast2_entry_encode(s->encoder, seg, *acc, s->out_type->data.dict.value);
        east_value_release(*acc);
        *acc = NULL;
        if (!ok) return false;
    } else {
        byte_buffer_write_bytes(seg, held->data, held->len);
    }
    if (!*seg_first) {
        *seg_first = held_key;
        east_value_retain(held_key);
    }
    if (*seg_last) east_value_release(*seg_last);
    *seg_last = held_key;
    east_value_retain(held_key);
    (*seg_count)++;
    return true;
}

/* K-way merges the spilled runs + the sorted in-memory tail into the
 * canonical output file — one record per run plus one output segment in
 * memory — with the cross-run duplicate check on the merged stream. Keys
 * are decoded; value bytes are copied. On failure the partial output is
 * left unfinalized (no terminator or index), exactly like an error on the
 * straight-through path. */
static bool emit_merge_runs(EmitSink *s)
{
    struct timespec t0;
    if (s->verbose) clock_gettime(CLOCK_MONOTONIC, &t0);
    EastValue *tail_dup = NULL;
    int sorted = emit_sort_pending(s, &tail_dup);
    if (sorted == 1) {
        char msg[512];
        emit_duplicate_msg(s, tail_dup, msg, sizeof(msg));
        east_builtin_error(msg);
        return false;
    }
    if (sorted != 0) return false; /* the fold's message is posted */

    size_t k = s->num_runs;
    MergeCursor *cur = calloc(k > 0 ? k : 1, sizeof(MergeCursor));
    bool ok = cur != NULL;
    for (size_t i = 0; ok && i < k; i++) {
        bool prefix = i == 0 && s->written_elements > 0;
        if (prefix) {
            cur[i].data = read_whole_file(s->run_paths[i], &cur[i].len);
            ok = cur[i].data != NULL;
            if (ok) {
                cur[i].reader = east_beast2_reader_new(cur[i].data, cur[i].len, s->out_type);
                cur[i].enc = byte_buffer_new(256);
                ok = cur[i].reader != NULL && cur[i].enc != NULL;
            }
        } else {
            cur[i].f = fopen(s->run_paths[i], "rb");
            ok = cur[i].f != NULL;
        }
        if (ok) ok = cursor_advance(s, &cur[i]);
    }

    if (ok) {
        s->out = fopen(s->output_path, "wb");
        ok = s->out != NULL;
    }
    if (ok) {
        s->writer = east_beast2_writer_new(s->out_type, EAST_BEAST2_CODEC_DEFLATE, true, true);
        if (s->writer) {
            east_beast2_writer_set_parallel(s->writer, true);
            s->writer_base = s->written_bytes;
        }
        ok = s->writer != NULL && emit_drain(s);
    }

    ByteBuffer *seg = byte_buffer_new(1 << 16);
    ok = ok && seg != NULL;
    size_t seg_count = 0;
    EastValue *seg_first = NULL, *seg_last = NULL; /* owned */
    size_t tail_idx = 0;
    EastValue *prev_key = NULL; /* owned */
    bool duplicate = false;
    /* A merge function folds equal keys across sources, so the entry for
     * the current key is held back until a greater key arrives: its bytes
     * stay as they were copied unless a second equal key makes it fold, and
     * then it is re-encoded from the folded value. */
    ByteBuffer *held = s->merge_fn ? byte_buffer_new(256) : NULL;
    size_t held_key_len = 0;
    EastValue *held_key = NULL; /* owned */
    EastValue *held_acc = NULL; /* owned: the folded value, once a fold ran */
    ok = ok && (!s->merge_fn || held != NULL);
    while (ok) {
        int min = -1;
        EastValue *min_key = NULL;
        for (size_t i = 0; i < k; i++) {
            if (!cur[i].key) continue;
            if (min < 0 || east_value_compare(cur[i].key, min_key) < 0) {
                min = (int)i;
                min_key = cur[i].key;
            }
        }
        bool from_tail = false;
        if (tail_idx < s->buf_len &&
            (min < 0 || east_value_compare(s->buf[tail_idx].key, min_key) < 0)) {
            from_tail = true;
        }
        if (min < 0 && !from_tail) break;

        EastValue *key;
        const uint8_t *bytes;
        size_t nbytes;
        if (from_tail) {
            const EmitPending *e = &s->buf[tail_idx++];
            key = e->key;
            bytes = s->arena->data + e->offset;
            nbytes = e->key_len + e->val_len;
        } else {
            key = cur[min].key;
            bytes = cursor_bytes(&cur[min]);
            nbytes = cur[min].key_len + cur[min].val_len;
        }
        size_t key_len = from_tail ? s->buf[tail_idx - 1].key_len : cur[min].key_len;
        if (prev_key && east_value_compare(prev_key, key) == 0) {
            if (!emit_folds(s)) {
                char msg[512];
                emit_duplicate_msg(s, key, msg, sizeof(msg));
                east_builtin_error(msg);
                duplicate = true;
                ok = false;
                break;
            }
            if (s->merge_fn) {
                EastType *vt = s->out_type->data.dict.value;
                if (!held_acc) {
                    held_acc = east_beast2_entry_decode(held->data + held_key_len,
                                                        held->len - held_key_len, vt);
                }
                EastValue *v = held_acc
                                   ? east_beast2_entry_decode(bytes + key_len, nbytes - key_len, vt)
                                   : NULL;
                if (!v) {
                    ok = false;
                    break;
                }
                held_acc = emit_fold_values(s, key, held_acc, v);
                if (!held_acc) {
                    ok = false;
                    break;
                }
            }
            /* Union: the first element stands; the equal one is dropped. */
            if (!from_tail) ok = cursor_advance(s, &cur[min]);
            continue;
        }
        east_value_retain(key);
        if (prev_key) east_value_release(prev_key);
        prev_key = key;

        if (s->merge_fn) {
            /* A greater key: the held entry is final — commit it, then hold
             * this one. */
            if (held_key) {
                ok = emit_commit_held(s, seg, held, held_key, &held_acc, &seg_first, &seg_last,
                                      &seg_count);
                east_value_release(held_key);
                held_key = NULL;
                if (ok && seg_count >= s->next_batch)
                    ok = emit_flush_raw(s, seg, &seg_count, &seg_first, &seg_last);
            }
            held->len = 0;
            byte_buffer_write_bytes(held, bytes, nbytes);
            held_key_len = key_len;
            held_key = key;
            east_value_retain(key);
            if (ok && !from_tail) ok = cursor_advance(s, &cur[min]);
            continue;
        }

        byte_buffer_write_bytes(seg, bytes, nbytes);
        if (!seg_first) {
            seg_first = key;
            east_value_retain(key);
        }
        if (seg_last) east_value_release(seg_last);
        seg_last = key;
        east_value_retain(key);
        seg_count++;
        if (!from_tail) ok = cursor_advance(s, &cur[min]);
        if (ok && seg_count >= s->next_batch)
            ok = emit_flush_raw(s, seg, &seg_count, &seg_first, &seg_last);
    }
    if (ok && held_key) {
        ok = emit_commit_held(s, seg, held, held_key, &held_acc, &seg_first, &seg_last, &seg_count);
    }
    if (held_key) east_value_release(held_key);
    if (held_acc) east_value_release(held_acc);
    if (held) byte_buffer_free(held);
    if (ok) ok = emit_flush_raw(s, seg, &seg_count, &seg_first, &seg_last);
    if (ok) {
        ok = east_beast2_writer_finish(s->writer);
        ok = emit_drain(s) && ok;
    }
    if (s->out) {
        ok = fclose(s->out) == 0 && ok;
        s->out = NULL;
    }

    if (prev_key) east_value_release(prev_key);
    if (seg_first) east_value_release(seg_first);
    if (seg_last) east_value_release(seg_last);
    if (seg) byte_buffer_free(seg);
    for (size_t i = 0; i < k; i++) {
        cursor_drop_key(&cur[i]);
        if (cur[i].segment) east_value_release(cur[i].segment);
        if (cur[i].reader) east_beast2_reader_free(cur[i].reader);
        if (cur[i].enc) byte_buffer_free(cur[i].enc);
        free(cur[i].data);
        if (cur[i].f) fclose(cur[i].f);
        free(cur[i].rec);
    }
    free(cur);
    emit_buf_clear(s);
    if (s->verbose) s->merge_ms = emit_elapsed_ms(&t0);
    if (ok) {
        for (size_t i = 0; i < s->num_runs; i++)
            remove(s->run_paths[i]);
    } else if (!duplicate) {
        /* Keep a specific message a cursor posted; otherwise say what failed. */
        char *err = east_builtin_get_error();
        east_builtin_error(err ? err : "emit: failed to merge spilled runs");
        free(err);
    }
    return ok;
}

static EvalResult emit_invoke(EastCompiledFn *self, EastValue **args, size_t n_args)
{
    EmitSink *s = (EmitSink *)self->invoke_userdata;
    size_t expected = s->kind == EAST_EMIT_DICT ? 2 : 1;
    if (n_args != expected || !args[0] || (expected == 2 && !args[1])) {
        return eval_error("emit called with the wrong number of arguments");
    }
    EastValue *key = args[0];
    if (s->buffered) {
        if (!emit_buf_push(s, key, expected == 2 ? args[1] : NULL)) {
            char *err = east_builtin_get_error();
            char msg[512];
            snprintf(msg, sizeof(msg), "emit: cannot encode the emitted value%s%s", err ? ": " : "",
                     err ? err : "");
            free(err);
            return eval_error(msg);
        }
        s->emitted++;
        if (s->buf_len >= s->run_cap) {
            EastValue *dup = NULL;
            int rc = emit_spill(s, &dup);
            if (rc == 1) {
                char msg[512];
                emit_duplicate_msg(s, dup, msg, sizeof(msg));
                east_value_release(dup);
                return eval_error(msg);
            }
            if (rc == 3) {
                char *err = east_builtin_get_error();
                EvalResult failed = eval_error(err ? err : "emit: the merge function failed");
                free(err);
                return failed;
            }
            if (rc != 0) return eval_error("emit: failed to write a spill run");
        }
        return eval_ok(east_null());
    }
    if (s->kind != EAST_EMIT_ARRAY) {
        if (s->last_key) {
            int order = east_value_compare(s->last_key, key);
            if (order == 0 && s->union_mode) {
                /* The first element stands. */
                s->emitted++;
                return eval_ok(east_null());
            }
            if (order == 0 && s->merge_fn) {
                /* The flush rule keeps the last entry in the open batch, so
                 * the fold lands in place. */
                EastValue *acc = east_dict_get(s->batch, key); /* borrowed */
                if (!acc) return eval_error("emit: the folded key is missing from the batch");
                EastValue *fold_args[3] = {key, acc, args[1]};
                EvalResult r = east_call(s->merge_fn, fold_args, 3);
                if (r.status == EVAL_ERROR) return r;
                east_dict_set(s->batch, key, r.value);
                if (r.value) east_value_release(r.value);
                eval_result_free(&r);
                s->emitted++;
                return eval_ok(east_null());
            }
            if (order == 0) {
                char msg[512];
                emit_duplicate_msg(s, key, msg, sizeof(msg));
                return eval_error(msg);
            }
            if (order > 0) {
                /* Out of order: demote to spill runs and re-enter buffered. */
                if (!emit_demote_to_runs(s)) {
                    return eval_error("emit: failed to demote the output to a spill run");
                }
                return emit_invoke(self, args, n_args);
            }
        }
        east_value_retain(key);
        if (s->last_key) east_value_release(s->last_key);
        s->last_key = key;
    }
    /* The flush rule: a full batch goes out only now that an element which
     * will not fold into it has arrived. */
    if (s->batch_count >= s->next_batch && !emit_flush(s)) {
        return eval_error("emit: failed to write output segment");
    }
    switch (s->kind) {
    case EAST_EMIT_ARRAY:
        east_array_push(s->batch, args[0]);
        break;
    case EAST_EMIT_SET:
        east_set_insert(s->batch, args[0]);
        break;
    default:
        east_dict_set(s->batch, args[0], args[1]);
        break;
    }
    s->batch_count++;
    s->emitted++;
    return eval_ok(east_null());
}

EastEmitSink *east_emit_sink_new(const EastEmitSinkConfig *cfg)
{
    if (!cfg || !cfg->out_type || !cfg->output_path) {
        east_builtin_error("emit: the sink needs an output type and an output path");
        return NULL;
    }
    if (cfg->merge_fn && cfg->kind != EAST_EMIT_DICT) {
        east_builtin_error("--merge applies to --emit dict only");
        return NULL;
    }
    if (cfg->union_mode && cfg->kind != EAST_EMIT_SET) {
        east_builtin_error("--union applies to --emit set only");
        return NULL;
    }
    EmitSink *s = calloc(1, sizeof(EmitSink));
    if (!s) {
        east_builtin_error("emit: out of memory");
        return NULL;
    }
    s->kind = cfg->kind;
    s->merge_fn = cfg->merge_fn;
    s->union_mode = cfg->union_mode;
    s->out_type = cfg->out_type;
    s->output_path = cfg->output_path;
    s->verbose = cfg->verbose;
    s->next_batch = EMIT_BATCH_CAP;
    s->run_cap = cfg->run_elements > 0 ? cfg->run_elements : emit_run_elements_from_env();
    s->out = fopen(cfg->output_path, "wb");
    if (!s->out) {
        char msg[1024];
        snprintf(msg, sizeof(msg), "Cannot write file: %s", cfg->output_path);
        east_builtin_error(msg);
        free(s);
        return NULL;
    }
    s->writer = east_beast2_writer_new(s->out_type, EAST_BEAST2_CODEC_DEFLATE, true, true);
    if (s->writer) {
        /* Frames deflate on worker threads (#763); emit_adapt_batch reads
         * the byte count through the writer's bounds, so the output is
         * byte-identical to a serial writer's. */
        east_beast2_writer_set_parallel(s->writer, true);
        s->writer_base = 0;
    }
    s->batch = emit_new_batch(s);
    if (!s->writer || !s->batch) {
        if (s->writer) east_beast2_writer_free(s->writer);
        if (s->batch) east_value_release(s->batch);
        fclose(s->out);
        free(s);
        east_builtin_error("emit: failed to construct the output writer");
        return NULL;
    }
    return s;
}

EastValue *east_emit_sink_function(EastEmitSink *sink, EastType *fn_type)
{
    return east_foreign_function(emit_invoke, sink, NULL, fn_type);
}

bool east_emit_sink_finish(EastEmitSink *s)
{
    if (s->buffered) return emit_merge_runs(s);
    bool ok = emit_flush(s);
    ok = east_beast2_writer_finish(s->writer) && ok;
    ok = emit_drain(s) && ok;
    ok = fclose(s->out) == 0 && ok;
    s->out = NULL;
    if (!ok) east_builtin_error("emit: failed to write the output");
    return ok;
}

void east_emit_sink_stats(const EastEmitSink *s, EastEmitSinkStats *out)
{
    memset(out, 0, sizeof(*out));
    out->emitted = s->emitted;
    out->buffered = s->buffered;
    out->runs = s->num_runs;
    out->spills = s->spills;
    out->peak_entries = s->peak_entries;
    out->peak_bytes = s->peak_bytes;
    out->spilled_bytes = s->spilled_bytes;
    out->spill_ms = s->spill_ms;
    out->merge_ms = s->merge_ms;
}

void east_emit_sink_free(EastEmitSink *s)
{
    if (!s) return;
    if (s->out) fclose(s->out);
    if (s->writer) east_beast2_writer_free(s->writer);
    if (s->batch) east_value_release(s->batch);
    if (s->last_key) east_value_release(s->last_key);
    emit_buf_clear(s);
    free(s->buf);
    if (s->arena) byte_buffer_free(s->arena);
    if (s->encoder) east_beast2_entry_encoder_free(s->encoder);
    for (size_t i = 0; i < s->num_runs; i++)
        free(s->run_paths[i]);
    free(s->run_paths);
    free(s);
}
