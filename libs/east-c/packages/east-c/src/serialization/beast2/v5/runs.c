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

struct Beast2RunSorter {
    EastType *type; /* retained: the Set or Dict type the runs hold */
    int32_t codec;
    bool parallel;
    Beast2RunSink sink;
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
};

Beast2RunSorter *east_beast2_run_sorter_new(EastType *type, int32_t codec_id,
                                            const Beast2RunSink *sink, EastCompiledFn *merge_fn,
                                            bool union_mode)
{
    if (!type || !sink || !sink->open || !sink->write || !sink->close) {
        east_builtin_error("beast2 v5: a run sorter needs a type and a sink");
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
    if (!s || !arena || !folded) {
        free(s);
        byte_buffer_free(arena);
        byte_buffer_free(folded);
        east_builtin_error("beast2 v5: out of memory building a run sorter");
        return NULL;
    }
    s->type = type;
    east_type_retain(type);
    s->codec = codec_id;
    s->sink = *sink;
    s->merge_fn = merge_fn;
    s->union_mode = union_mode;
    s->arena = arena;
    s->folded = folded;
    /* The element writer's own numbering: definition 0 is the root. */
    b2v5_enc_ctx_init(&s->ctx, NULL, true);
    s->ctx.def_count = 1;
    s->ctx.segment_base_def = 1;
    return s;
}

void east_beast2_run_sorter_set_parallel(Beast2RunSorter *s, bool parallel)
{
    if (s) s->parallel = parallel;
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

/* A Dict value, decoded from its bytes alone: a key holds no container, so
 * nothing in the value refers back into it. Returns NULL with the message
 * posted. */
static EastValue *run_sorter_decode_value(Beast2RunSorter *s, const uint8_t *bytes, size_t len)
{
    B2V5DecodeCtx ctx;
    b2v5_dec_ctx_init(&ctx, NULL);
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

/* acc = merge(key, acc, value). Consumes `acc` and `value`; returns the result
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

/* Folds the values of the equal keys at entries [i, j) in the order they were
 * added, and adds the key with the folded value. */
static bool run_sorter_add_folded(Beast2RunSorter *s, Beast2ElementWriter *w, size_t i, size_t j)
{
    const uint8_t *arena = s->arena->data;
    const B2V5RunEntry *first = &s->entries[i];
    EastValue *acc = run_sorter_decode_value(s, arena + first->offset + first->key_len,
                                             first->len - first->key_len);
    for (size_t k = i + 1; acc && k < j; k++) {
        const B2V5RunEntry *e = &s->entries[k];
        EastValue *value =
            run_sorter_decode_value(s, arena + e->offset + e->key_len, e->len - e->key_len);
        if (!value) {
            east_value_release(acc);
            return false;
        }
        acc = run_sorter_fold(s, first->key, acc, value);
    }
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
    return east_beast2_element_writer_add_encoded(w, s->folded->data, s->folded->len,
                                                  first->key_len);
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

/* Sorts the open run, folds its repeated keys, and writes it. A failure ends
 * the sorter and leaves the run's sink without its close. */
static bool run_sorter_write_run(Beast2RunSorter *s)
{
    qsort(s->entries, s->count, sizeof(B2V5RunEntry), run_entry_order);
    Beast2ElementWriter *w = east_beast2_element_writer_new(s->type, s->codec);
    if (w) east_beast2_element_writer_set_parallel(w, s->parallel);
    bool ok = w != NULL && s->sink.open(s->sink.ctx, s->runs);
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
        size_t segments = east_beast2_element_writer_segments(w);
        ok = (j - i == 1 || !s->merge_fn)
                 ? east_beast2_element_writer_add_encoded(w, s->arena->data + first->offset,
                                                          first->len, first->key_len)
                 : run_sorter_add_folded(s, w, i, j);
        /* The sink takes the bytes as each segment closes. */
        if (ok && east_beast2_element_writer_segments(w) != segments) ok = run_sorter_drain(s, w);
        i = j;
    }
    if (ok) {
        ok = east_beast2_element_writer_finish(w) && run_sorter_drain(s, w) &&
             s->sink.close(s->sink.ctx);
    }
    east_beast2_element_writer_free(w);
    if (!ok) {
        s->failed = true;
        return false;
    }
    s->runs++;
    run_sorter_clear(s);
    return true;
}

/* Encodes `head` (a Set element or a Dict key) and, for a Dict, `value` as one
 * element of the open run, and writes the run once it reaches either cap. */
static bool run_sorter_encode(Beast2RunSorter *s, EastValue *head, EastValue *value)
{
    if (s->finished || s->failed) {
        east_builtin_error("beast2 v5: add() after finish()");
        return false;
    }
    if (s->count == s->cap) {
        size_t cap = s->cap ? s->cap * 2 : 1024;
        B2V5RunEntry *grown = realloc(s->entries, cap * sizeof(*grown));
        if (!grown) {
            east_builtin_error("beast2 v5: out of memory adding an element");
            return false;
        }
        s->entries = grown;
        s->cap = cap;
    }
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
    return s->count == 0 || run_sorter_write_run(s);
}

void east_beast2_run_sorter_free(Beast2RunSorter *s)
{
    if (!s) return;
    run_sorter_clear(s);
    free(s->entries);
    byte_buffer_free(s->arena);
    byte_buffer_free(s->folded);
    b2v5_enc_ctx_free(&s->ctx);
    east_type_release(s->type);
    free(s);
}
