/*
 * The streaming emit sink behind `run --emit` — see include/east/emit_sink.h
 * for the contract. Shared by the east-c CLI and east-py, so both write the
 * same bytes for the same emissions.
 */

#include <east/compat.h>
#include <east/emit_sink.h>

#include <east/builtins.h>
#include <east/compiler.h>
#include <east/file_map.h>
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

/* Out-of-order Set/Dict emission buffers and spills sorted runs once the
 * buffered entries reach this many (EAST_EMIT_RUN_ELEMENTS overrides) or
 * their encoded bytes reach this many (EAST_EMIT_RUN_BYTES overrides) — the
 * in-memory bound of the sink's spill/merge path (issues #518, #770). */
#define EMIT_RUN_ELEMENTS_DEFAULT 100000u
#define EMIT_RUN_BYTES_DEFAULT (64u * 1024u * 1024u)

/* At most this many sources feed one merge; more runs merge in passes. */
#define EMIT_MERGE_FANIN 64

/* A positive size from the environment variable `name`: digits only, at
 * least 1, no overflow — anything else (a sign, a suffix, a number strtoull
 * would wrap or saturate) is `fallback`. */
static size_t emit_size_from_env(const char *name, size_t fallback)
{
    const char *env = getenv(name);
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
    return fallback;
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
    size_t run_cap;              /* spill at this many buffered entries... */
    size_t run_bytes;            /* ...or at this many buffered entry bytes */
    /* Owned paths of every temporary run: the spill runs by index, then the
     * merge passes' intermediate runs. */
    char **run_paths;
    size_t num_runs, runs_cap;
    bool prefix_run; /* run 0 is the demoted beast2 prefix */
    size_t spilled_bytes;
    /* The -v epilogue's account of the buffered path. */
    size_t spills;
    size_t peak_entries;
    size_t peak_bytes;
    size_t merge_sources;
    size_t merge_passes;
    size_t merge_width; /* the most sources one merge read */
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

/* A merge pass's intermediate run: `<output>.run<N>.p<pass>`. */
static char *emit_pass_run_path(EmitSink *s, size_t n, size_t pass)
{
    size_t len = strlen(s->output_path) + 56;
    char *p = malloc(len);
    if (p) snprintf(p, len, "%s.run%zu.p%zu", s->output_path, n, pass);
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

/* One record: `varint(key_len) key varint(val_len) value`, from an entry's
 * bytes (the key's, then the value's). */
static bool run_write_record(FILE *f, const uint8_t *entry, size_t key_len, size_t val_len)
{
    return run_write_varint(f, key_len) && fwrite(entry, 1, key_len, f) == key_len &&
           run_write_varint(f, val_len) && fwrite(entry + key_len, 1, val_len, f) == val_len;
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
        ok = run_write_record(rf, s->arena->data + e->offset, e->key_len, e->val_len);
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
        s->prefix_run = true;
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

/* ----- the merge: a binary min-heap over the sources, in passes ----- */

typedef enum {
    SOURCE_RUN,    /* raw records, read sequentially through the stdio buffer */
    SOURCE_PREFIX, /* the demoted beast2 prefix, segment by segment through a mapping */
    SOURCE_TAIL,   /* the sorted in-memory entries */
} MergeSourceKind;

/* One merge source and its current entry. */
typedef struct {
    MergeSourceKind kind;
    /* SOURCE_RUN */
    FILE *f;
    uint8_t *rec; /* the current record's bytes: key then value */
    size_t rec_cap;
    /* SOURCE_PREFIX: its values re-encoded entry by entry */
    uint8_t *data; /* the mapping */
    size_t len;
    void *map_ctx;
    Beast2SegmentReader *reader;
    EastValue *segment; /* owned; NULL when exhausted */
    size_t idx, seg_len;
    ByteBuffer *enc; /* the current pair re-encoded */
    /* SOURCE_TAIL */
    size_t next; /* the next pending entry */
    /* Every kind: the current entry's key (owned; NULL once the source is
     * exhausted) and bytes, the key's then the value's. */
    EastValue *key;
    const uint8_t *bytes;
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
    c->bytes = c->rec;
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
    c->bytes = c->enc->data;
    return true;
}

/* Advances the tail cursor to the next sorted pending entry. */
static void cursor_advance_tail(EmitSink *s, MergeCursor *c)
{
    cursor_drop_key(c);
    if (c->next >= s->buf_len) return; /* exhausted */
    const EmitPending *e = &s->buf[c->next++];
    east_value_retain(e->key);
    c->key = e->key;
    c->bytes = s->arena->data + e->offset;
    c->key_len = e->key_len;
    c->val_len = e->val_len;
}

static bool cursor_advance(EmitSink *s, MergeCursor *c)
{
    switch (c->kind) {
    case SOURCE_RUN:
        return cursor_advance_raw(s, c);
    case SOURCE_PREFIX:
        return cursor_advance_prefix(s, c);
    default:
        cursor_advance_tail(s, c);
        return true;
    }
}

/* Opens a source on its first entry: `path` is the run's file (unused for
 * the tail). On false the cursor still needs cursor_close. */
static bool cursor_open(EmitSink *s, MergeCursor *c, MergeSourceKind kind, const char *path)
{
    memset(c, 0, sizeof(*c));
    c->kind = kind;
    if (kind == SOURCE_PREFIX) {
        c->data = map_input_file(path, &c->len, &c->map_ctx);
        if (!c->data) return false;
        c->reader = east_beast2_reader_new(c->data, c->len, s->out_type);
        c->enc = byte_buffer_new(256);
        if (!c->reader || !c->enc) return false;
    } else if (kind == SOURCE_RUN) {
        c->f = fopen(path, "rb");
        if (!c->f) return false;
    }
    return cursor_advance(s, c);
}

static void cursor_close(MergeCursor *c)
{
    cursor_drop_key(c);
    if (c->segment) east_value_release(c->segment);
    if (c->reader) east_beast2_reader_free(c->reader);
    if (c->enc) byte_buffer_free(c->enc);
    if (c->data) input_release_mapping(c->map_ctx, c->data, c->len);
    if (c->f) fclose(c->f);
    free(c->rec);
    memset(c, 0, sizeof(*c));
}

/* Whether source `a`'s entry leaves the heap before source `b`'s: the lesser
 * key, and for equal keys the earlier source — emission order. */
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

/* Where one merge writes: raw records into an intermediate run, or segments
 * framed by the output writer (the final pass). */
typedef struct {
    FILE *run;       /* an intermediate pass's run; NULL in the final pass */
    ByteBuffer *seg; /* the final pass's open segment: its entries' bytes */
    size_t seg_count;
    EastValue *seg_first, *seg_last; /* owned: the open segment's first and last keys */
} MergeOut;

/* Frames the entries accumulated in the open segment as one output segment. */
static bool emit_flush_raw(EmitSink *s, MergeOut *out)
{
    if (out->seg_count == 0) return true;
    bool ok = east_beast2_writer_write_raw(s->writer, out->seg->data, out->seg->len, out->seg_count,
                                           out->seg_first, out->seg_last);
    ok = ok && emit_drain(s);
    if (ok) emit_adapt_batch(s, out->seg_count);
    out->seg->len = 0;
    out->seg_count = 0;
    if (out->seg_first) east_value_release(out->seg_first);
    if (out->seg_last) east_value_release(out->seg_last);
    out->seg_first = out->seg_last = NULL;
    return ok;
}

/* Writes one merged entry: a raw record into the intermediate run, or its
 * bytes into the open segment, which goes out once it holds the batch. */
static bool merge_out_put(EmitSink *s, MergeOut *out, EastValue *key, const uint8_t *bytes,
                          size_t key_len, size_t val_len)
{
    if (out->run) {
        if (!run_write_record(out->run, bytes, key_len, val_len)) return false;
        s->spilled_bytes += key_len + val_len;
        return true;
    }
    if (key_len + val_len > 0) byte_buffer_write_bytes(out->seg, bytes, key_len + val_len);
    if (!out->seg_first) {
        out->seg_first = key;
        east_value_retain(key);
    }
    if (out->seg_last) east_value_release(out->seg_last);
    out->seg_last = key;
    east_value_retain(key);
    out->seg_count++;
    return out->seg_count < s->next_batch || emit_flush_raw(s, out);
}

/* Commits the held entry of a folding merge: its bytes as copied, or — when
 * a fold ran — the key and the folded value re-encoded into `held` (and *acc
 * released). */
static bool emit_commit_held(EmitSink *s, MergeOut *out, ByteBuffer *held, size_t key_len,
                             EastValue *key, EastValue **acc)
{
    if (*acc) {
        held->len = 0;
        east_beast2_entry_begin(s->encoder);
        bool ok = east_beast2_entry_encode(s->encoder, held, key, emit_key_type(s));
        key_len = held->len;
        ok = ok && east_beast2_entry_encode(s->encoder, held, *acc, s->out_type->data.dict.value);
        east_value_release(*acc);
        *acc = NULL;
        if (!ok) return false;
    }
    return merge_out_put(s, out, key, held->data, key_len, held->len - key_len);
}

/* Merges `n` open sources, given in emission order, into `out`: a binary
 * min-heap of the sources ordered by (key, source index), so equal keys leave
 * in emission order. Keys are decoded; bytes are copied. Equal keys fold — a
 * merge function holds the current key's entry back until a greater key
 * arrives, its bytes untouched unless a second equal key makes it fold, and
 * then re-encoded from the folded value; union keeps the first — or, without
 * a fold, are the duplicate error (*duplicate_out set). Returns false with
 * the message posted. */
static bool emit_merge_sources(EmitSink *s, MergeCursor *cur, size_t n, MergeOut *out,
                               bool *duplicate_out)
{
    size_t *heap = malloc((n > 0 ? n : 1) * sizeof(size_t));
    if (!heap) return false;
    size_t live = 0;
    for (size_t i = 0; i < n; i++)
        if (cur[i].key) heap[live++] = i;
    for (size_t i = live / 2; i-- > 0;)
        heap_sift_down(heap, live, i, cur);

    EastType *vt = s->kind == EAST_EMIT_DICT ? s->out_type->data.dict.value : NULL;
    ByteBuffer *held = s->merge_fn ? byte_buffer_new(256) : NULL;
    size_t held_key_len = 0;
    EastValue *held_key = NULL; /* owned */
    EastValue *held_acc = NULL; /* owned: the folded value, once a fold ran */
    EastValue *prev_key = NULL; /* owned */
    bool ok = !s->merge_fn || held != NULL;
    while (ok && live > 0) {
        MergeCursor *c = &cur[heap[0]];
        EastValue *key = c->key;
        if (prev_key && east_value_compare(prev_key, key) == 0) {
            if (!emit_folds(s)) {
                char msg[512];
                emit_duplicate_msg(s, key, msg, sizeof(msg));
                east_builtin_error(msg);
                *duplicate_out = true;
                ok = false;
                break;
            }
            if (s->merge_fn) {
                if (!held_acc) {
                    held_acc = east_beast2_entry_decode(held->data + held_key_len,
                                                        held->len - held_key_len, vt);
                }
                EastValue *v = held_acc
                                   ? east_beast2_entry_decode(c->bytes + c->key_len, c->val_len, vt)
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
        } else {
            east_value_retain(key);
            if (prev_key) east_value_release(prev_key);
            prev_key = key;
            if (s->merge_fn) {
                /* A greater key: the held entry is final — commit it, then
                 * hold this one. */
                if (held_key) {
                    ok = emit_commit_held(s, out, held, held_key_len, held_key, &held_acc);
                    east_value_release(held_key);
                    held_key = NULL;
                }
                if (ok) {
                    held->len = 0;
                    byte_buffer_write_bytes(held, c->bytes, c->key_len + c->val_len);
                    held_key_len = c->key_len;
                    held_key = key;
                    east_value_retain(key);
                }
            } else {
                ok = merge_out_put(s, out, key, c->bytes, c->key_len, c->val_len);
            }
        }
        if (ok) ok = cursor_advance(s, c);
        if (ok && !c->key) heap[0] = heap[--live];
        if (ok && live > 0) heap_sift_down(heap, live, 0, cur);
    }
    if (ok && held_key) ok = emit_commit_held(s, out, held, held_key_len, held_key, &held_acc);
    if (held_key) east_value_release(held_key);
    if (held_acc) east_value_release(held_acc);
    if (held) byte_buffer_free(held);
    if (prev_key) east_value_release(prev_key);
    free(heap);
    return ok;
}

/* Opens one merge's sources into `cur`: the `m` runs named by index into
 * run_paths — the first the demoted prefix when `prefix` — then, when
 * `tail`, the in-memory tail as the last source. *opened counts the cursors
 * that need cursor_close, whether or not they opened. */
static bool emit_open_sources(EmitSink *s, MergeCursor *cur, const size_t *runs, size_t m,
                              bool prefix, bool tail, size_t *opened)
{
    *opened = 0;
    for (size_t i = 0; i < m; i++) {
        (*opened)++;
        MergeSourceKind kind = i == 0 && prefix ? SOURCE_PREFIX : SOURCE_RUN;
        if (!cursor_open(s, &cur[i], kind, s->run_paths[runs[i]])) return false;
    }
    if (tail) {
        (*opened)++;
        if (!cursor_open(s, &cur[m], SOURCE_TAIL, NULL)) return false;
    }
    return true;
}

/* Merges the spilled runs and the sorted in-memory tail into the canonical
 * output file. While the runs and the tail are more than EMIT_MERGE_FANIN
 * sources, a pass merges every EMIT_MERGE_FANIN consecutive runs into one
 * intermediate run (a lone run passes through) and removes the runs it read;
 * the final pass merges what is left, the tail last, into the output. Memory
 * is one entry per source plus one output segment. On failure the partial
 * output is left unfinalized (no terminator or index), exactly like an error
 * on the straight-through path. */
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

    size_t tail = s->buf_len > 0 ? 1u : 0u;
    size_t level_n = s->num_runs;
    bool level_prefix = s->prefix_run;
    size_t *level = malloc((level_n > 0 ? level_n : 1) * sizeof(size_t));
    MergeCursor *cur = calloc(EMIT_MERGE_FANIN, sizeof(MergeCursor));
    bool ok = level != NULL && cur != NULL;
    for (size_t i = 0; ok && i < level_n; i++)
        level[i] = i;
    s->merge_sources = level_n + tail;
    s->merge_passes = 0;
    s->merge_width = 0;
    bool duplicate = false;

    while (ok && level_n + tail > EMIT_MERGE_FANIN) {
        s->merge_passes++;
        size_t next_n = 0;
        for (size_t g = 0; ok && g < level_n; g += EMIT_MERGE_FANIN) {
            size_t m = level_n - g < EMIT_MERGE_FANIN ? level_n - g : EMIT_MERGE_FANIN;
            bool prefix = g == 0 && level_prefix;
            if (m == 1 && !prefix) {
                level[next_n++] = level[g];
                continue;
            }
            char *path =
                emit_runs_reserve(s) ? emit_pass_run_path(s, next_n, s->merge_passes) : NULL;
            ok = path != NULL;
            if (!ok) break;
            s->run_paths[s->num_runs++] = path; /* owned from here, freed with the sink */
            MergeOut out = {0};
            out.run = fopen(path, "wb");
            ok = out.run != NULL;
            size_t opened = 0;
            if (ok) ok = emit_open_sources(s, cur, level + g, m, prefix, false, &opened);
            if (ok) ok = emit_merge_sources(s, cur, m, &out, &duplicate);
            for (size_t i = 0; i < opened; i++)
                cursor_close(&cur[i]);
            if (out.run) ok = fclose(out.run) == 0 && ok;
            if (!ok) break;
            if (m > s->merge_width) s->merge_width = m;
            for (size_t i = 0; i < m; i++)
                remove(s->run_paths[level[g + i]]);
            level[next_n++] = s->num_runs - 1;
        }
        level_n = next_n;
        level_prefix = false;
    }

    MergeOut out = {0};
    size_t opened = 0;
    if (ok) {
        s->merge_passes++;
        if (level_n + tail > s->merge_width) s->merge_width = level_n + tail;
        s->out = fopen(s->output_path, "wb");
        ok = s->out != NULL;
    }
    if (ok) {
        s->writer = east_beast2_writer_new(s->out_type, EAST_BEAST2_CODEC_DEFLATE, true, true);
        if (s->writer) {
            east_beast2_writer_set_parallel(s->writer, true);
            /* The refinement starts afresh, as a new sink's does: the demoted
             * prefix's bytes and elements (already counted in spilled_bytes)
             * never size the merge's segments, so the output is what the
             * ascending path writes for the same entries. */
            s->next_batch = EMIT_BATCH_CAP;
            s->written_elements = 0;
            s->written_bytes = 0;
            s->writer_base = 0;
        }
        ok = s->writer != NULL && emit_drain(s);
    }
    if (ok) {
        out.seg = byte_buffer_new(1 << 16);
        ok = out.seg != NULL;
    }
    if (ok) ok = emit_open_sources(s, cur, level, level_n, level_prefix, tail != 0, &opened);
    if (ok) ok = emit_merge_sources(s, cur, level_n + tail, &out, &duplicate);
    for (size_t i = 0; i < opened; i++)
        cursor_close(&cur[i]);
    if (ok) ok = emit_flush_raw(s, &out);
    if (ok) {
        ok = east_beast2_writer_finish(s->writer);
        ok = emit_drain(s) && ok;
    }
    if (s->out) {
        ok = fclose(s->out) == 0 && ok;
        s->out = NULL;
    }

    if (out.seg_first) east_value_release(out.seg_first);
    if (out.seg_last) east_value_release(out.seg_last);
    if (out.seg) byte_buffer_free(out.seg);
    free(level);
    free(cur);
    emit_buf_clear(s);
    if (s->verbose) s->merge_ms = emit_elapsed_ms(&t0);
    if (ok) {
        /* The runs a pass read are already gone; this removes the rest. */
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
        if (s->buf_len >= s->run_cap || s->arena->len >= s->run_bytes) {
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
    s->run_cap = cfg->run_elements > 0
                     ? cfg->run_elements
                     : emit_size_from_env("EAST_EMIT_RUN_ELEMENTS", EMIT_RUN_ELEMENTS_DEFAULT);
    s->run_bytes = cfg->run_bytes > 0
                       ? cfg->run_bytes
                       : emit_size_from_env("EAST_EMIT_RUN_BYTES", EMIT_RUN_BYTES_DEFAULT);
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
    out->sources = s->merge_sources;
    out->passes = s->merge_passes;
    out->runs_per_pass = s->merge_width;
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
