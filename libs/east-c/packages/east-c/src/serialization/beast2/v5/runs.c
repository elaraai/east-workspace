/*
 * Sorted runs — a Set's or Dict's elements in any order in, sorted canonical
 * collections out (east_beast2_run_sorter_*, the C mirror of TypeScript's
 * v5/runs.ts). A producer that cannot hand its keys over in order — a re-key,
 * an index built in another order than its source's — adds them here, and the
 * runs are merged afterwards, a key range at a time if need be (east/merge.h).
 *
 * Every runtime must close a run at the same element and write it as the same
 * bytes, because where a run closes decides how a repeated key's values group
 * before they fold. So the caps count only what every runtime measures alike —
 * elements, and the bytes of their canonical encoding — and an element's bytes
 * are the element writer's own: encoded with aliasing scoped to it, then
 * copied into the run's writer.
 *
 * A run is written as a blob, through the element writer to the sink, or as a
 * manifest directory, through the manifest writer — the segments are the same.
 *
 * A fold whose values do not grow — a Dict's merge over a bounded value type,
 * a Set's union — folds a key's values as they are added, in a fold table in
 * front of the open run (SPEC.md, "Folding as added"): an output with few keys
 * then sorts a few elements rather than every one. The table's bounds, and
 * when it spills and steps aside, are constants and rules of the format too,
 * as the caps are.
 */

#include "internal_v5.h"

/* One element of the open run: its key, which orders the run, and where its
 * bytes sit in the arena — the key's, then for a Dict the value's. `seq` is
 * its place in the run, so equal keys keep the order they were added, the
 * order their values fold in. */
typedef struct {
    EastValue *key; /* owned */
    size_t offset;
    size_t len;
    size_t key_len;
    size_t seq;
} B2V5RunEntry;

/* A partial fold of a key's values in the fold table, and how many values it
 * covers. */
typedef struct {
    EastValue *value; /* owned */
    size_t covers;
} B2V5Partial;

/* A key the fold table holds: the key as first added, which the merge function
 * is given; its canonical bytes, at `key_offset` in the table's key arena, and
 * their FNV-1a; and its values' partial folds, oldest first — a Set's key has
 * none. The covers halve from one partial to the next, so 64 hold any count. */
typedef struct {
    EastValue *key; /* owned */
    uint64_t hash;
    size_t key_offset;
    size_t key_len;
    B2V5Partial *partials; /* owned */
    uint8_t depth;
    uint8_t cap;
} B2V5FoldEntry;

/* The fold table's slots: open addressing by the keys' FNV-1a, each an entry's
 * index plus one, 0 when empty — twice the keys it holds at most, so it is at
 * most half full. */
#define B2V5_FOLD_SLOTS (2u * EAST_BEAST2_FOLD_TABLE_MAX_KEYS)

struct Beast2RunSorter {
    EastType *type;    /* retained: the Set or Dict type the runs hold */
    EastSourceMap *sm; /* one reference: the runs' header map, or NULL */
    int32_t codec;
    bool parallel;
    Beast2RunSink sink;
    char *dir;                /* a directory sorter's directory, which run n is written into as the
                                 manifest directory <dir>/<n>.beast2; NULL for a blob sorter */
    EastCompiledFn *merge_fn; /* borrowed: folds a Dict key added again, or NULL */
    bool union_mode;          /* a Set element added again is kept once */
    B2V5EncodeCtx ctx;        /* aliasing scoped per element */
    ByteBuffer *arena;        /* the open run's elements, back to back */
    ByteBuffer *folded;       /* a folded element, while it is assembled */
    B2V5RunEntry *entries;
    size_t count;
    size_t cap;
    size_t runs; /* runs written */
    bool finished;
    bool failed;
    /* The fold table: on for a fold it takes, until it steps aside. Its
     * buffers are made as the first element is added. */
    bool table_on;
    bool table_spilled;    /* the table has spilled */
    size_t table_absorbed; /* the elements it absorbed, which its first spill weighs */
    B2V5FoldEntry *table;  /* its entries, in the order their keys entered */
    size_t table_count;
    size_t table_cap;
    uint32_t *table_slots;  /* B2V5_FOLD_SLOTS of them */
    ByteBuffer *table_keys; /* the entries' canonical key bytes, back to back */
    ByteBuffer *scratch;    /* an element the table takes, while it is weighed */
    ByteBuffer *spilling;   /* an entry the table spills, while it is assembled */
};

/* Whether a value type's encoding is bounded, so a fold over it does not grow:
 * Null, Boolean, Integer, Float, DateTime, and Structs and Variants of those.
 * A recursive type is not, and nothing under it is looked at. */
static bool run_sorter_bounded(const EastType *t)
{
    switch (t->kind) {
    case EAST_TYPE_NULL:
    case EAST_TYPE_BOOLEAN:
    case EAST_TYPE_INTEGER:
    case EAST_TYPE_FLOAT:
    case EAST_TYPE_DATETIME:
        return true;
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < t->data.struct_.num_fields; i++)
            if (!run_sorter_bounded(t->data.struct_.fields[i].type)) return false;
        return true;
    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < t->data.variant.num_cases; i++)
            if (!run_sorter_bounded(t->data.variant.cases[i].type)) return false;
        return true;
    default:
        return false;
    }
}

/* A sorter writing to `sink`, or into `dir` when that is given. */
static Beast2RunSorter *run_sorter_new(EastType *type, int32_t codec_id, const Beast2RunSink *sink,
                                       const char *dir, EastCompiledFn *merge_fn, bool union_mode)
{
    if (!type) {
        east_builtin_error("beast2 v5: a run sorter needs a type");
        return NULL;
    }
    if (type->kind != EAST_TYPE_SET && type->kind != EAST_TYPE_DICT) {
        char msg[160];
        snprintf(msg, sizeof(msg),
                 "beast2 v5: sorted runs hold Set or Dict values, not %s — an Array keeps the "
                 "order it is written in",
                 east_type_kind_name(type->kind));
        east_builtin_error(msg);
        return NULL;
    }
    if (merge_fn && type->kind != EAST_TYPE_DICT) {
        east_builtin_error("beast2 v5: a merge function folds a Dict's values; a Set's equal "
                           "elements collapse under union");
        return NULL;
    }
    if (union_mode && type->kind != EAST_TYPE_SET) {
        east_builtin_error("beast2 v5: union collapses a Set's equal elements; a Dict's values "
                           "fold with a merge function");
        return NULL;
    }
    if (merge_fn) {
        /* The fold is called with the Dict's own keys and values, and what it
         * returns is encoded as a value, so its type must be (K, V, V) -> V. */
        EastType *t = merge_fn->fn_type;
        EastType *kt = type->data.dict.key, *vt = type->data.dict.value;
        if (!t || t->kind != EAST_TYPE_FUNCTION || t->data.function.num_inputs != 3 ||
            !east_type_equal(t->data.function.inputs[0], kt) ||
            !east_type_equal(t->data.function.inputs[1], vt) ||
            !east_type_equal(t->data.function.inputs[2], vt) ||
            !east_type_equal(t->data.function.output, vt)) {
            char *ks = east_print_type(kt);
            char *vs = east_print_type(vt);
            char *ts = t ? east_print_type(t) : NULL;
            char msg[1024];
            snprintf(msg, sizeof(msg),
                     "beast2 v5: a merge function is (K, V, V) -> V over the Dict's key and value "
                     "types (K = %s, V = %s), got %s",
                     ks ? ks : "?", vs ? vs : "?", ts ? ts : "?");
            free(ks);
            free(vs);
            free(ts);
            east_builtin_error(msg);
            return NULL;
        }
    }
    if (codec_id != EAST_BEAST2_CODEC_NONE && codec_id != EAST_BEAST2_CODEC_DEFLATE) {
        east_builtin_error("beast2 v5: unsupported codec id");
        return NULL;
    }
    Beast2RunSorter *s = calloc(1, sizeof(*s));
    ByteBuffer *arena = byte_buffer_new(1 << 16);
    ByteBuffer *folded = byte_buffer_new(256);
    char *dir_copy = dir ? strdup(dir) : NULL;
    if (!s || !arena || !folded || (dir && !dir_copy)) {
        free(s);
        byte_buffer_free(arena);
        byte_buffer_free(folded);
        free(dir_copy);
        east_builtin_error("beast2 v5: out of memory building a run sorter");
        return NULL;
    }
    s->type = type;
    east_type_retain(type);
    s->codec = codec_id;
    if (sink) s->sink = *sink;
    s->dir = dir_copy;
    s->merge_fn = merge_fn;
    s->union_mode = union_mode;
    s->table_on = type->kind == EAST_TYPE_DICT
                      ? merge_fn != NULL && run_sorter_bounded(type->data.dict.value)
                      : union_mode;
    s->arena = arena;
    s->folded = folded;
    /* The element writer's own numbering: definition 0 is the root. */
    b2v5_enc_ctx_init(&s->ctx, NULL, true);
    s->ctx.def_count = 1;
    s->ctx.segment_base_def = 1;
    return s;
}

Beast2RunSorter *east_beast2_run_sorter_new(EastType *type, int32_t codec_id,
                                            const Beast2RunSink *sink, EastCompiledFn *merge_fn,
                                            bool union_mode)
{
    if (!sink || !sink->open || !sink->write || !sink->close) {
        east_builtin_error("beast2 v5: a run sorter needs a type and a sink");
        return NULL;
    }
    return run_sorter_new(type, codec_id, sink, NULL, merge_fn, union_mode);
}

Beast2RunSorter *east_beast2_run_sorter_new_dir(EastType *type, int32_t codec_id, const char *dir,
                                                EastCompiledFn *merge_fn, bool union_mode)
{
    if (!dir) {
        east_builtin_error("beast2 v5: a run sorter needs a directory to write its runs into");
        return NULL;
    }
    return run_sorter_new(type, codec_id, NULL, dir, merge_fn, union_mode);
}

void east_beast2_run_sorter_set_parallel(Beast2RunSorter *s, bool parallel)
{
    if (s) s->parallel = parallel;
}

void east_beast2_run_sorter_set_source_map(Beast2RunSorter *s, EastSourceMap *source_map)
{
    /* Only before the first element: an element's bytes are written against
     * the map its run's header holds. */
    if (!s || s->count > 0 || s->runs > 0 || s->table_absorbed > 0) return;
    east_source_map_retain(source_map);
    east_source_map_release(s->sm);
    s->sm = source_map;
    b2v5_enc_ctx_free(&s->ctx);
    b2v5_enc_ctx_init(&s->ctx, source_map, true);
    s->ctx.def_count = 1;
    s->ctx.segment_base_def = 1;
}

size_t east_beast2_run_sorter_runs(const Beast2RunSorter *s)
{
    return s ? s->runs : 0;
}

/* Lets go of the open run's elements. */
static void run_sorter_clear(Beast2RunSorter *s)
{
    for (size_t i = 0; i < s->count; i++)
        east_value_release(s->entries[i].key);
    s->count = 0;
    s->arena->len = 0;
}

static int run_entry_order(const void *a, const void *b)
{
    const B2V5RunEntry *x = a, *y = b;
    int order = east_value_compare(x->key, y->key);
    if (order != 0) return order;
    return x->seq < y->seq ? -1 : x->seq > y->seq ? 1 : 0;
}

/* Moves the bytes the run's writer has produced to the sink. */
static bool run_sorter_drain(Beast2RunSorter *s, Beast2ElementWriter *w)
{
    ByteBuffer *buf = east_beast2_element_writer_take(w);
    if (!buf) return true;
    bool ok = s->sink.write(s->sink.ctx, buf->data, buf->len);
    byte_buffer_free(buf);
    return ok;
}

/* Where the run being written goes: a blob, through the element writer, or a
 * manifest directory. */
typedef struct {
    Beast2ElementWriter *blob;
    Beast2ManifestWriter *dir;
} B2V5RunOut;

/* Adds one element, already in its canonical bytes, to the run being
 * written. */
static bool run_out_add(Beast2RunSorter *s, B2V5RunOut *out, const uint8_t *element, size_t len,
                        size_t key_len)
{
    if (out->dir) return east_beast2_manifest_writer_add_encoded(out->dir, element, len, key_len);
    size_t segments = east_beast2_element_writer_segments(out->blob);
    if (!east_beast2_element_writer_add_encoded(out->blob, element, len, key_len)) return false;
    /* The sink takes the bytes as each segment closes. */
    return east_beast2_element_writer_segments(out->blob) == segments ||
           run_sorter_drain(s, out->blob);
}

/* A Dict value, decoded from its bytes alone: a key holds no container, so
 * nothing in the value refers back into it. A closure in it resolves against
 * the runs' map, which its bytes were written against, so it names the lines
 * it was written at — and is written again as it was. Returns NULL with the
 * message posted. */
static EastValue *run_sorter_decode_value(Beast2RunSorter *s, const uint8_t *bytes, size_t len)
{
    B2V5DecodeCtx ctx;
    b2v5_dec_ctx_init(&ctx, s->sm);
    size_t offset = 0;
    EastValue *value = b2v5_decode_value(bytes, len, &offset, s->type->data.dict.value, &ctx);
    b2v5_dec_ctx_free(&ctx);
    if (!value) {
        char *specific = east_builtin_get_error();
        east_builtin_error(specific ? specific : "beast2 v5: a run's value failed to decode");
        free(specific);
    }
    return value;
}

/* merge(key, acc, value). Consumes `acc` and `value`; returns the result
 * (owned), or NULL with the merge function's message posted. */
static EastValue *run_sorter_fold(Beast2RunSorter *s, EastValue *key, EastValue *acc,
                                  EastValue *value)
{
    EastValue *args[3] = {key, acc, value};
    EvalResult r = east_call(s->merge_fn, args, 3);
    east_value_release(acc);
    east_value_release(value);
    if (r.status == EVAL_ERROR || !r.value) {
        east_builtin_error(r.error_message ? r.error_message
                                           : "beast2 v5: the merge function failed");
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        return NULL;
    }
    EastValue *out = r.value;
    eval_result_free(&r);
    return out;
}

/* Folds the values of the equal keys at entries [i, j) and adds the key with
 * the folded value. The values fold pairwise in the order they were added
 * (SPEC.md, "Sorted runs and merges"), `merge(key, older, newer)`: each value
 * becomes the newest partial fold, and while the newest two partials cover
 * equally many values they fold into one; the partials left then fold newest
 * into oldest. Two or three values fold as `acc = merge(key, acc, value)`;
 * more group as a balanced tree, so a merge that copies its operands —
 * a.union(b), a.concat(b) — copies each value O(log n) times rather than O(n)
 * (#1003). */
static bool run_sorter_add_folded(Beast2RunSorter *s, B2V5RunOut *out, size_t i, size_t j)
{
    const uint8_t *arena = s->arena->data;
    const B2V5RunEntry *first = &s->entries[i];
    /* The partial folds, oldest first, and how many values each covers: a
     * power of two, halving from one to the next, so 64 hold any count. */
    struct {
        EastValue *value;
        size_t covers;
    } partials[64];
    size_t depth = 0;
    EastValue *acc = NULL;
    for (size_t k = i; k < j; k++) {
        const B2V5RunEntry *e = &s->entries[k];
        acc = run_sorter_decode_value(s, arena + e->offset + e->key_len, e->len - e->key_len);
        size_t covers = 1;
        while (acc && depth > 0 && partials[depth - 1].covers == covers) {
            acc = run_sorter_fold(s, first->key, partials[--depth].value, acc);
            covers *= 2;
        }
        if (!acc) break;
        partials[depth].value = acc;
        partials[depth].covers = covers;
        depth++;
    }
    if (acc) {
        acc = partials[--depth].value;
        while (acc && depth > 0)
            acc = run_sorter_fold(s, first->key, partials[--depth].value, acc);
    }
    /* A value that failed to decode or fold leaves partials never folded. */
    while (depth > 0)
        east_value_release(partials[--depth].value);
    if (!acc) return false;
    s->folded->len = 0;
    byte_buffer_write_bytes(s->folded, arena + first->offset, first->key_len);
    b2v5_enc_ctx_begin_element(&s->ctx);
    b2v5_encode_value(s->folded, acc, s->type->data.dict.value, &s->ctx);
    east_value_release(acc);
    if (s->ctx.failed) {
        s->ctx.failed = false;
        return false;
    }
    return run_out_add(s, out, s->folded->data, s->folded->len, first->key_len);
}

/* Posts the refusal of a key added twice without a fold. */
static void run_sorter_duplicate_error(Beast2RunSorter *s, EastValue *key)
{
    bool dict = s->type->kind == EAST_TYPE_DICT;
    const char *noun = dict ? "Dict" : "Set";
    const char *part = dict ? "key" : "element";
    char *printed = east_print_value(key, dict ? s->type->data.dict.key : s->type->data.element);
    size_t cap = (printed ? strlen(printed) : 1) + 128;
    char *msg = malloc(cap);
    if (msg) {
        snprintf(msg, cap, "beast2 v5: duplicate %s %s emitted: %s — %s %ss must be unique", noun,
                 part, printed ? printed : "?", noun, part);
        east_builtin_error(msg);
    } else {
        east_builtin_error("beast2 v5: duplicate key emitted");
    }
    free(msg);
    free(printed);
}

/* Opens run `s->runs`: the manifest directory <dir>/<n>.beast2 of a directory
 * sorter, else a blob through the element writer to the sink. */
static bool run_sorter_open_run(Beast2RunSorter *s, B2V5RunOut *out)
{
    if (s->dir) {
        size_t need = strlen(s->dir) + 32;
        char *path = malloc(need);
        if (!path) {
            east_builtin_error("beast2 v5: out of memory opening a run");
            return false;
        }
        snprintf(path, need, "%s/%zu.beast2", s->dir, s->runs);
        out->dir =
            east_beast2_manifest_writer_new_dir_with_source_map(s->type, s->codec, path, s->sm);
        free(path);
        if (!out->dir) return false;
        east_beast2_manifest_writer_set_parallel(out->dir, s->parallel);
        return true;
    }
    out->blob = b2v5_element_writer_new(s->type, s->codec, s->sm);
    if (!out->blob) return false;
    east_beast2_element_writer_set_parallel(out->blob, s->parallel);
    return s->sink.open(s->sink.ctx, s->runs);
}

/* Sorts the open run, folds its repeated keys, and writes it. A failure ends
 * the sorter and leaves the run incomplete: a blob's sink without its close,
 * a manifest directory without its manifest. */
static bool run_sorter_write_run(Beast2RunSorter *s)
{
    qsort(s->entries, s->count, sizeof(B2V5RunEntry), run_entry_order);
    B2V5RunOut out = {NULL, NULL};
    bool ok = run_sorter_open_run(s, &out);
    for (size_t i = 0; ok && i < s->count;) {
        const B2V5RunEntry *first = &s->entries[i];
        size_t j = i + 1;
        while (j < s->count && east_value_compare(first->key, s->entries[j].key) == 0)
            j++;
        if (j - i > 1 && !s->merge_fn && !s->union_mode) {
            run_sorter_duplicate_error(s, first->key);
            ok = false;
            break;
        }
        ok = (j - i == 1 || !s->merge_fn)
                 ? run_out_add(s, &out, s->arena->data + first->offset, first->len, first->key_len)
                 : run_sorter_add_folded(s, &out, i, j);
        i = j;
    }
    if (ok && out.dir) {
        ok = east_beast2_manifest_writer_finish(out.dir);
    } else if (ok) {
        ok = east_beast2_element_writer_finish(out.blob) && run_sorter_drain(s, out.blob) &&
             s->sink.close(s->sink.ctx);
    }
    if (out.blob) east_beast2_element_writer_free(out.blob);
    east_beast2_manifest_writer_free(out.dir);
    if (!ok) {
        s->failed = true;
        return false;
    }
    s->runs++;
    run_sorter_clear(s);
    return true;
}

/* Makes room for one more element of the open run. */
static bool run_sorter_reserve(Beast2RunSorter *s)
{
    if (s->count < s->cap) return true;
    size_t cap = s->cap ? s->cap * 2 : 1024;
    B2V5RunEntry *grown = realloc(s->entries, cap * sizeof(*grown));
    if (!grown) {
        east_builtin_error("beast2 v5: out of memory adding an element");
        return false;
    }
    s->entries = grown;
    s->cap = cap;
    return true;
}

/* Adds an element, already in its canonical bytes, to the open run — `key`
 * retained — and writes the run once it reaches either cap. */
static bool run_sorter_add_encoded(Beast2RunSorter *s, const uint8_t *bytes, size_t len,
                                   size_t key_len, EastValue *key)
{
    if (!run_sorter_reserve(s)) return false;
    size_t start = s->arena->len;
    byte_buffer_write_bytes(s->arena, bytes, len);
    east_value_retain(key);
    s->entries[s->count] = (B2V5RunEntry){key, start, len, key_len, s->count};
    s->count++;
    if (s->count >= EAST_BEAST2_RUN_MAX_COUNT || s->arena->len >= EAST_BEAST2_RUN_MAX_BYTES)
        return run_sorter_write_run(s);
    return true;
}

/* Lets go of a fold table entry: its key, and the partials it still holds. */
static void fold_entry_free(B2V5FoldEntry *e)
{
    while (e->depth > 0)
        east_value_release(e->partials[--e->depth].value);
    free(e->partials);
    east_value_release(e->key);
}

/* Empties the fold table. */
static void fold_table_clear(Beast2RunSorter *s)
{
    for (size_t i = 0; i < s->table_count; i++)
        fold_entry_free(&s->table[i]);
    s->table_count = 0;
    if (s->table_keys) s->table_keys->len = 0;
    if (s->table_slots) memset(s->table_slots, 0, B2V5_FOLD_SLOTS * sizeof(*s->table_slots));
}

/* Spills the fold table into the open run: each entry, in the order its key
 * entered, its partials folded newest into oldest, as one element. At the
 * first spill, a table that absorbed fewer than two elements a key steps
 * aside. A failure ends the sorter. */
static bool run_sorter_spill(Beast2RunSorter *s)
{
    bool step_aside = !s->table_spilled && s->table_absorbed < 2 * s->table_count;
    s->table_spilled = true;
    bool ok = true;
    for (size_t n = 0; ok && n < s->table_count; n++) {
        B2V5FoldEntry *e = &s->table[n];
        ByteBuffer *out = s->spilling;
        out->len = 0;
        byte_buffer_write_bytes(out, s->table_keys->data + e->key_offset, e->key_len);
        if (e->depth > 0) {
            EastValue *acc = e->partials[--e->depth].value;
            while (acc && e->depth > 0)
                acc = run_sorter_fold(s, e->key, e->partials[--e->depth].value, acc);
            if (!acc) {
                ok = false;
                break;
            }
            b2v5_enc_ctx_begin_element(&s->ctx);
            b2v5_encode_value(out, acc, s->type->data.dict.value, &s->ctx);
            east_value_release(acc);
            if (s->ctx.failed) {
                s->ctx.failed = false;
                ok = false;
                break;
            }
        }
        ok = run_sorter_add_encoded(s, out->data, out->len, e->key_len, e->key);
    }
    fold_table_clear(s);
    if (step_aside) s->table_on = false;
    if (!ok) s->failed = true;
    return ok;
}

/* Makes the fold table's buffers, as the first element is added. */
static bool fold_table_ready(Beast2RunSorter *s)
{
    if (s->table_slots) return true;
    s->table_slots = calloc(B2V5_FOLD_SLOTS, sizeof(*s->table_slots));
    s->table_keys = byte_buffer_new(1 << 12);
    s->scratch = byte_buffer_new(256);
    s->spilling = byte_buffer_new(256);
    if (!s->table_slots || !s->table_keys || !s->scratch || !s->spilling) {
        free(s->table_slots);
        s->table_slots = NULL;
        east_builtin_error("beast2 v5: out of memory building a fold table");
        return false;
    }
    return true;
}

/* Folds `value` (decoded, consumed) into an entry's partials, pairwise as a
 * run folds a key's values: it becomes the newest partial, and while the
 * newest two cover equally many values they fold into one. The partials change
 * only once every fold has returned, so a fold that fails leaves them as they
 * were. */
static bool fold_entry_add(Beast2RunSorter *s, B2V5FoldEntry *e, EastValue *value)
{
    if (e->depth == e->cap) {
        uint8_t cap = e->cap ? (uint8_t)(e->cap * 2) : 4;
        B2V5Partial *grown = realloc(e->partials, cap * sizeof(*grown));
        if (!grown) {
            east_value_release(value);
            east_builtin_error("beast2 v5: out of memory folding a key's values");
            return false;
        }
        e->partials = grown;
        e->cap = cap;
    }
    size_t covers = 1;
    uint8_t top = e->depth;
    while (top > 0 && e->partials[top - 1].covers == covers) {
        /* The fold takes its own reference to the partial. */
        east_value_retain(e->partials[top - 1].value);
        value = run_sorter_fold(s, e->key, e->partials[top - 1].value, value);
        if (!value) return false;
        covers *= 2;
        top--;
    }
    while (e->depth > top)
        east_value_release(e->partials[--e->depth].value);
    e->partials[e->depth++] = (B2V5Partial){value, covers};
    return true;
}

/* Folds one element into the fold table — first spilling it when the
 * element's key is new and would take it past a bound — or, when that spill
 * steps the table aside, adds it to the open run. An element that fails to
 * encode, or whose fold fails, leaves the sorter as it was. */
static bool run_sorter_table_add(Beast2RunSorter *s, EastValue *head, EastValue *value)
{
    if (!fold_table_ready(s)) return false;
    ByteBuffer *scratch = s->scratch;
    scratch->len = 0;
    b2v5_enc_ctx_begin_element(&s->ctx);
    EastType *head_type =
        s->type->kind == EAST_TYPE_DICT ? s->type->data.dict.key : s->type->data.element;
    b2v5_encode_value(scratch, head, head_type, &s->ctx);
    size_t key_len = scratch->len;
    if (value && !s->ctx.failed)
        b2v5_encode_value(scratch, value, s->type->data.dict.value, &s->ctx);
    if (s->ctx.failed) {
        s->ctx.failed = false;
        return false;
    }
    /* Keys are held by their canonical bytes, which are equal exactly when
     * the keys are. */
    const size_t mask = B2V5_FOLD_SLOTS - 1;
    uint64_t hash = east_beast2_fnv1a64(scratch->data, key_len);
    size_t slot = (size_t)hash & mask;
    B2V5FoldEntry *entry = NULL;
    for (uint32_t at; (at = s->table_slots[slot]) != 0; slot = (slot + 1) & mask) {
        B2V5FoldEntry *e = &s->table[at - 1];
        if (e->hash == hash && e->key_len == key_len &&
            memcmp(s->table_keys->data + e->key_offset, scratch->data, key_len) == 0) {
            entry = e;
            break;
        }
    }
    /* A value folds decoded, as a run folds it. */
    EastValue *decoded = NULL;
    if (value) {
        decoded = run_sorter_decode_value(s, scratch->data + key_len, scratch->len - key_len);
        if (!decoded) return false;
    }
    if (entry) {
        if (decoded && !fold_entry_add(s, entry, decoded)) return false;
        s->table_absorbed++;
        return true;
    }
    /* A new key. A table holding no key never spills: a key whose bytes alone
     * pass the bound enters it. */
    if (s->table_count >= EAST_BEAST2_FOLD_TABLE_MAX_KEYS ||
        (s->table_count > 0 &&
         s->table_keys->len + key_len > EAST_BEAST2_FOLD_TABLE_MAX_KEY_BYTES)) {
        if (!run_sorter_spill(s)) {
            if (decoded) east_value_release(decoded);
            return false;
        }
        if (!s->table_on) {
            if (decoded) east_value_release(decoded);
            return run_sorter_add_encoded(s, scratch->data, scratch->len, key_len, head);
        }
        slot = (size_t)hash & mask;
    }
    if (s->table_count == s->table_cap) {
        size_t cap = s->table_cap ? s->table_cap * 2 : 1024;
        B2V5FoldEntry *grown = realloc(s->table, cap * sizeof(*grown));
        if (!grown) {
            if (decoded) east_value_release(decoded);
            east_builtin_error("beast2 v5: out of memory adding a key to a fold table");
            return false;
        }
        s->table = grown;
        s->table_cap = cap;
    }
    B2V5FoldEntry *e = &s->table[s->table_count];
    *e = (B2V5FoldEntry){head, hash, s->table_keys->len, key_len, NULL, 0, 0};
    if (decoded && !fold_entry_add(s, e, decoded)) return false;
    east_value_retain(head);
    byte_buffer_write_bytes(s->table_keys, scratch->data, key_len);
    s->table_slots[slot] = (uint32_t)(s->table_count + 1);
    s->table_count++;
    s->table_absorbed++;
    return true;
}

/* Encodes `head` (a Set element or a Dict key) and, for a Dict, `value` as one
 * element of the open run, and writes the run once it reaches either cap — or
 * folds it into the fold table, while the table is on. */
static bool run_sorter_encode(Beast2RunSorter *s, EastValue *head, EastValue *value)
{
    if (s->finished || s->failed) {
        east_builtin_error("beast2 v5: add() after finish()");
        return false;
    }
    if (s->table_on) return run_sorter_table_add(s, head, value);
    if (!run_sorter_reserve(s)) return false;
    size_t start = s->arena->len;
    /* Aliasing is scoped to the element, so its bytes depend on it alone and
     * it can be written into whichever run it lands in by byte copy. */
    b2v5_enc_ctx_begin_element(&s->ctx);
    EastType *head_type =
        s->type->kind == EAST_TYPE_DICT ? s->type->data.dict.key : s->type->data.element;
    b2v5_encode_value(s->arena, head, head_type, &s->ctx);
    size_t key_len = s->arena->len - start;
    if (value && !s->ctx.failed)
        b2v5_encode_value(s->arena, value, s->type->data.dict.value, &s->ctx);
    if (s->ctx.failed) {
        s->arena->len = start;
        s->ctx.failed = false;
        return false;
    }
    east_value_retain(head);
    s->entries[s->count] = (B2V5RunEntry){head, start, s->arena->len - start, key_len, s->count};
    s->count++;
    if (s->count >= EAST_BEAST2_RUN_MAX_COUNT || s->arena->len >= EAST_BEAST2_RUN_MAX_BYTES)
        return run_sorter_write_run(s);
    return true;
}

bool east_beast2_run_sorter_add(Beast2RunSorter *s, EastValue *element)
{
    if (!s || !element) return false;
    if (s->type->kind == EAST_TYPE_DICT) {
        east_builtin_error("beast2 v5: a Dict sorter takes pairs (add_pair)");
        return false;
    }
    return run_sorter_encode(s, element, NULL);
}

bool east_beast2_run_sorter_add_pair(Beast2RunSorter *s, EastValue *key, EastValue *value)
{
    if (!s || !key || !value) return false;
    if (s->type->kind != EAST_TYPE_DICT) {
        east_builtin_error("beast2 v5: only a Dict sorter takes pairs");
        return false;
    }
    return run_sorter_encode(s, key, value);
}

bool east_beast2_run_sorter_finish(Beast2RunSorter *s)
{
    if (!s) return false;
    if (s->finished) return !s->failed;
    s->finished = true;
    if (s->failed) return false;
    if (s->table_on && s->table_count > 0 && !run_sorter_spill(s)) return false;
    return s->count == 0 || run_sorter_write_run(s);
}

bool east_beast2_run_sorter_fold_table(const Beast2RunSorter *s, size_t *keys, size_t *key_bytes)
{
    bool on = s && s->table_on;
    if (keys) *keys = on ? s->table_count : 0;
    if (key_bytes) *key_bytes = on && s->table_keys ? s->table_keys->len : 0;
    return on;
}

void east_beast2_run_sorter_free(Beast2RunSorter *s)
{
    if (!s) return;
    run_sorter_clear(s);
    fold_table_clear(s);
    free(s->table);
    free(s->table_slots);
    byte_buffer_free(s->table_keys);
    byte_buffer_free(s->scratch);
    byte_buffer_free(s->spilling);
    free(s->entries);
    byte_buffer_free(s->arena);
    byte_buffer_free(s->folded);
    b2v5_enc_ctx_free(&s->ctx);
    east_source_map_release(s->sm);
    east_type_release(s->type);
    free(s->dir);
    free(s);
}
