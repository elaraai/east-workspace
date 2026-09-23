/*
 * Sorted runs, pinned across runtimes.
 *
 * Each run is the canonical blob of its sorted, folded value; a key's values
 * fold in the order they were added; a run closes at the element cap or the
 * byte cap; and the runs a pinned sequence of elements closes are the runs
 * TypeScript closes for it (`east/src/serialization/beast2/v5/runs.spec.ts`),
 * compared by a digest of every run's bytes. Merging the runs back is the
 * canonical blob of the whole value. Run under ASan/LSan for the sorter's
 * lifetimes, its error paths included.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/type_of_type.h>

#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

/* TypeScript's runs of the parity sequences below: fnv1a64 over every run's
 * fnv1a64, in hex, joined with ','. */
#define PERMUTED_DICT_DIGEST "d90d3818c52e31bb"
#define SET_UNION_DIGEST "a4a7379f0468c2be"

/* ----- a sink that keeps each run's bytes ----------------------------- */

typedef struct {
    ByteBuffer *runs[16];
    bool closed[16];
    size_t n;
} Runs;

static bool runs_open(void *ctx, size_t run)
{
    Runs *r = ctx;
    CHECK(run == r->n, "run %zu opened where run %zu was next", run, r->n);
    if (r->n == sizeof r->runs / sizeof r->runs[0]) {
        east_builtin_error("test: too many runs");
        return false;
    }
    r->runs[r->n] = byte_buffer_new(1024);
    r->closed[r->n] = false;
    r->n++;
    return true;
}

static bool runs_write(void *ctx, const uint8_t *bytes, size_t len)
{
    Runs *r = ctx;
    byte_buffer_write_bytes(r->runs[r->n - 1], bytes, len);
    return true;
}

static bool runs_close(void *ctx)
{
    Runs *r = ctx;
    r->closed[r->n - 1] = true;
    return true;
}

static void runs_free(Runs *r)
{
    for (size_t i = 0; i < r->n; i++)
        byte_buffer_free(r->runs[i]);
    memset(r, 0, sizeof(*r));
}

static Beast2RunSorter *sorter_new(Runs *r, EastType *type, int32_t codec, EastValue *merge_fn,
                                   bool union_mode)
{
    memset(r, 0, sizeof(*r));
    Beast2RunSink sink = {r, runs_open, runs_write, runs_close};
    return east_beast2_run_sorter_new(
        type, codec, &sink, merge_fn ? merge_fn->data.function.compiled : NULL, union_mode);
}

/* Finishes and frees a sorter, checking every run it wrote was closed. */
static bool sorter_finish(Beast2RunSorter *s, Runs *r)
{
    bool ok = east_beast2_run_sorter_finish(s);
    if (ok) {
        CHECK(east_beast2_run_sorter_runs(s) == r->n, "%zu runs counted, %zu written",
              east_beast2_run_sorter_runs(s), r->n);
        for (size_t i = 0; i < r->n; i++)
            CHECK(r->closed[i], "run %zu was not closed", i);
    }
    east_beast2_run_sorter_free(s);
    return ok;
}

static bool bytes_equal(const ByteBuffer *a, const ByteBuffer *b)
{
    return a && b && a->len == b->len && memcmp(a->data, b->data, a->len) == 0;
}

static size_t element_count(const ByteBuffer *run, EastType *type)
{
    Beast2Pages *p = east_beast2_pages_new(run->data, run->len, type);
    size_t n = p ? east_beast2_pages_element_count(p) : SIZE_MAX;
    if (p) east_beast2_pages_free(p);
    return n;
}

/* ----- folds ------------------------------------------------------------ */

static EvalResult sum_invoke(EastCompiledFn *self, EastValue **args, size_t n)
{
    (void)self;
    if (n != 3) return eval_error("sum: wrong arity");
    return eval_ok(east_integer(args[1]->data.integer + args[2]->data.integer));
}

static EvalResult concat_invoke(EastCompiledFn *self, EastValue **args, size_t n)
{
    (void)self;
    if (n != 3) return eval_error("concat: wrong arity");
    size_t la = args[1]->data.string.len, lb = args[2]->data.string.len;
    char *joined = malloc(la + lb + 1);
    memcpy(joined, args[1]->data.string.data, la);
    memcpy(joined + la, args[2]->data.string.data, lb);
    EastValue *v = east_string_len(joined, la + lb);
    free(joined);
    return eval_ok(v);
}

/* A foreign `(K, V, V) -> V`. */
static EastValue *fold_fn(EastInvokeFn invoke, EastType *key, EastType *value)
{
    EastType *inputs[3] = {key, value, value};
    EastType *fn_type = east_function_type(inputs, 3, value);
    return east_foreign_function(invoke, NULL, NULL, fn_type);
}

static bool add_pair_si(Beast2RunSorter *s, const char *key, int64_t value)
{
    EastValue *k = east_string(key), *v = east_integer(value);
    bool ok = east_beast2_run_sorter_add_pair(s, k, v);
    east_value_release(k);
    east_value_release(v);
    return ok;
}

static bool add_pair_ss(Beast2RunSorter *s, const char *key, const char *value)
{
    EastValue *k = east_string(key), *v = east_string(value);
    bool ok = east_beast2_run_sorter_add_pair(s, k, v);
    east_value_release(k);
    east_value_release(v);
    return ok;
}

static bool add_string(Beast2RunSorter *s, const char *element)
{
    EastValue *e = east_string(element);
    bool ok = east_beast2_run_sorter_add(s, e);
    east_value_release(e);
    return ok;
}

static void test_run_is_canonical(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *sum = fold_fn(sum_invoke, &east_string_type, &east_integer_type);
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, sum, false);
    bool ok = s && add_pair_si(s, "c", 1) && add_pair_si(s, "a", 2) && add_pair_si(s, "c", 3) &&
              add_pair_si(s, "b", 4) && add_pair_si(s, "a", 5);
    ok = s && sorter_finish(s, &r) && ok;
    CHECK(ok && r.n == 1, "one run expected: %s", ok ? "" : east_builtin_get_error());

    EastValue *expected = east_dict_new(&east_string_type, &east_integer_type);
    const char *keys[3] = {"a", "b", "c"};
    const int64_t values[3] = {7, 4, 4};
    for (int i = 0; i < 3; i++) {
        EastValue *k = east_string(keys[i]), *v = east_integer(values[i]);
        east_dict_set(expected, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    ByteBuffer *paged = east_beast2_encode_paged(expected, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(r.n == 1 && bytes_equal(r.runs[0], paged),
          "the run is not the canonical blob of its folded value");
    byte_buffer_free(paged);
    east_value_release(expected);
    runs_free(&r);
    east_value_release(sum);
    east_type_release(type);
}

static void test_fold_order(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_string_type);
    EastValue *concat = fold_fn(concat_invoke, &east_string_type, &east_string_type);
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, concat, false);
    bool ok = s && add_pair_ss(s, "k", "a") && add_pair_ss(s, "j", "x") &&
              add_pair_ss(s, "k", "b") && add_pair_ss(s, "k", "c");
    ok = s && sorter_finish(s, &r) && ok;
    EastValue *run =
        ok && r.n == 1 ? east_beast2_decode_full(r.runs[0]->data, r.runs[0]->len, type) : NULL;
    CHECK(run && east_dict_len(run) == 2, "the fold did not write two keys");
    if (run) {
        EastValue *k = east_string("k");
        EastValue *v = east_dict_get(run, k);
        CHECK(v && strcmp(v->data.string.data, "abc") == 0, "k folded to %s",
              v ? v->data.string.data : "?");
        east_value_release(k);
        east_value_release(run);
    }
    runs_free(&r);
    east_value_release(concat);
    east_type_release(type);
}

static void test_union_and_duplicates(void)
{
    EastType *type = east_set_type(&east_string_type);
    const char *elements[5] = {"b", "a", "b", "c", "a"};
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, true);
    bool ok = s != NULL;
    for (int i = 0; ok && i < 5; i++)
        ok = add_string(s, elements[i]);
    ok = s && sorter_finish(s, &r) && ok;
    EastValue *run =
        ok && r.n == 1 ? east_beast2_decode_full(r.runs[0]->data, r.runs[0]->len, type) : NULL;
    CHECK(run && east_set_len(run) == 3, "union did not keep three elements");
    if (run) east_value_release(run);
    runs_free(&r);

    s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, false);
    ok = s && add_string(s, "b") && add_string(s, "a") && add_string(s, "b");
    CHECK(ok, "adding below the cap wrote nothing, so refused nothing");
    CHECK(s && !east_beast2_run_sorter_finish(s), "a repeated element was accepted");
    char *err = east_builtin_get_error();
    CHECK(err && strcmp(err, "beast2 v5: duplicate Set element emitted: \"b\" — Set elements "
                             "must be unique") == 0,
          "the refusal says %s", err ? err : "nothing");
    free(err);
    CHECK(s && !r.closed[0], "a failed run was closed");
    east_beast2_run_sorter_free(s);
    runs_free(&r);
    east_type_release(type);

    EastType *dict = east_dict_type(&east_string_type, &east_integer_type);
    s = sorter_new(&r, dict, EAST_BEAST2_CODEC_DEFLATE, NULL, false);
    ok = s && add_pair_si(s, "k", 1) && add_pair_si(s, "j", 2) && add_pair_si(s, "k", 3);
    CHECK(ok && !east_beast2_run_sorter_finish(s), "a repeated key was accepted");
    err = east_builtin_get_error();
    CHECK(err && strcmp(err, "beast2 v5: duplicate Dict key emitted: \"k\" — Dict keys must be "
                             "unique") == 0,
          "the refusal says %s", err ? err : "nothing");
    free(err);
    CHECK(s && !add_pair_si(s, "z", 4), "a failed sorter accepted an element");
    free(east_builtin_get_error());
    east_beast2_run_sorter_free(s);
    runs_free(&r);
    east_type_release(dict);
}

/* ----- the caps --------------------------------------------------------- */

static void test_count_cap(void)
{
    EastType *type = east_set_type(&east_integer_type);
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, false);
    bool ok = s != NULL;
    const int64_t n = EAST_BEAST2_RUN_MAX_COUNT + 10;
    for (int64_t i = 0; ok && i < n; i++) {
        EastValue *e = east_integer(n - i);
        ok = east_beast2_run_sorter_add(s, e);
        east_value_release(e);
    }
    ok = s && sorter_finish(s, &r) && ok;
    CHECK(ok && r.n == 2 && element_count(r.runs[0], type) == EAST_BEAST2_RUN_MAX_COUNT &&
              element_count(r.runs[1], type) == 10,
          "the element cap did not close the first run at %d elements", EAST_BEAST2_RUN_MAX_COUNT);
    /* The first run holds the elements added first, whatever their keys. */
    EastValue *second =
        r.n == 2 ? east_beast2_decode_full(r.runs[1]->data, r.runs[1]->len, type) : NULL;
    CHECK(second && east_set_len(second) == 10 && east_set_at(second, 9)->data.integer == 10,
          "the second run does not hold the ten elements added last");
    if (second) east_value_release(second);
    runs_free(&r);
    east_type_release(type);
}

static void test_byte_cap(void)
{
    /* Elements of 2 MiB: the run that reaches the cap is written with the
     * element that reached it. */
    EastType *type = east_dict_type(&east_string_type, &east_blob_type);
    size_t payload_len = 2u * 1024u * 1024u;
    uint8_t *payload = malloc(payload_len);
    memset(payload, 7, payload_len);
    EastValue *blob = east_blob(payload, payload_len);
    free(payload);
    /* Per element: the key's length prefix and 8 bytes, the blob's 4-byte
     * length prefix and its bytes. */
    size_t per_element = 1 + 8 + 4 + payload_len;
    size_t first = (EAST_BEAST2_RUN_MAX_BYTES + per_element - 1) / per_element;
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_NONE, NULL, false);
    bool ok = s != NULL;
    for (int i = 0; ok && i < 40; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07d", i);
        EastValue *k = east_string(buf);
        ok = east_beast2_run_sorter_add_pair(s, k, blob);
        east_value_release(k);
    }
    ok = s && sorter_finish(s, &r) && ok;
    CHECK(ok && r.n == 2 && element_count(r.runs[0], type) == first &&
              element_count(r.runs[1], type) == 40 - first,
          "the byte cap did not close the first run at %zu elements", first);
    runs_free(&r);
    east_value_release(blob);
    east_type_release(type);
}

/* ----- the sorter's edges ---------------------------------------------- */

static void test_rollback_and_refusals(void)
{
    const char *names[2] = {"a", "b"};
    EastType *cases[2] = {&east_integer_type, &east_null_type};
    EastType *variant = east_variant_type(names, cases, 2);
    EastType *type = east_dict_type(&east_string_type, variant);
    EastValue *one = east_integer(1);
    EastValue *good = east_variant_new("a", one, variant);
    EastValue *bad = east_variant_new("zzz", east_null(), variant);
    EastValue *a = east_string("a"), *b = east_string("b"), *c = east_string("c");

    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, false);
    CHECK(s && east_beast2_run_sorter_add_pair(s, b, good), "a good entry was refused");
    CHECK(s && !east_beast2_run_sorter_add_pair(s, a, bad), "an unencodable entry was accepted");
    free(east_builtin_get_error());
    CHECK(s && east_beast2_run_sorter_add_pair(s, a, good), "the sorter refused after a failure");
    CHECK(s && sorter_finish(s, &r), "finish failed: %s", east_builtin_get_error());
    EastValue *run =
        r.n == 1 ? east_beast2_decode_full(r.runs[0]->data, r.runs[0]->len, type) : NULL;
    CHECK(run && east_dict_len(run) == 2, "the run does not hold the two good entries");
    if (run) east_value_release(run);
    runs_free(&r);

    s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, false);
    CHECK(s && east_beast2_run_sorter_finish(s) && r.n == 0, "an empty sorter wrote a run");
    CHECK(s && east_beast2_run_sorter_finish(s), "finish is not idempotent");
    CHECK(s && !east_beast2_run_sorter_add_pair(s, c, good), "an add after finish was accepted");
    char *err = east_builtin_get_error();
    CHECK(err && strstr(err, "after finish"), "the refusal says %s", err ? err : "nothing");
    free(err);
    east_beast2_run_sorter_free(s);
    runs_free(&r);

    EastType *array = east_array_type(&east_integer_type);
    EastType *set = east_set_type(&east_integer_type);
    EastType *ints = east_dict_type(&east_integer_type, &east_integer_type);
    EastValue *sum = fold_fn(sum_invoke, &east_integer_type, &east_integer_type);
    CHECK(!sorter_new(&r, array, EAST_BEAST2_CODEC_DEFLATE, NULL, false), "an Array was sorted");
    err = east_builtin_get_error();
    CHECK(err && strstr(err, "Set or Dict values, not Array"), "the refusal says %s",
          err ? err : "nothing");
    free(err);
    CHECK(!sorter_new(&r, set, EAST_BEAST2_CODEC_DEFLATE, sum, false), "a Set took a merge");
    err = east_builtin_get_error();
    CHECK(err && strstr(err, "folds a Dict"), "the refusal says %s", err ? err : "nothing");
    free(err);
    CHECK(!sorter_new(&r, ints, EAST_BEAST2_CODEC_DEFLATE, NULL, true), "a Dict took union");
    err = east_builtin_get_error();
    CHECK(err && strstr(err, "collapses a Set"), "the refusal says %s", err ? err : "nothing");
    free(err);
    /* The fold is called with the Dict's own keys and values. */
    CHECK(!sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, sum, false),
          "a merge function of another type was taken");
    err = east_builtin_get_error();
    CHECK(err && strstr(err, "a merge function is (K, V, V) -> V"), "the refusal says %s",
          err ? err : "nothing");
    free(err);

    east_value_release(sum);
    east_type_release(ints);
    east_type_release(set);
    east_type_release(array);
    east_value_release(a);
    east_value_release(b);
    east_value_release(c);
    east_value_release(bad);
    east_value_release(good);
    east_value_release(one);
    east_type_release(type);
    east_type_release(variant);
}

/* ----- two-runtime parity ---------------------------------------------- */

/* fnv1a64 over every run's fnv1a64, in hex, joined with ','. */
static void runs_digest(const Runs *r, char *out, size_t outlen)
{
    char joined[16 * 17 + 1];
    size_t at = 0;
    for (size_t i = 0; i < r->n; i++) {
        at += (size_t)snprintf(joined + at, sizeof(joined) - at, "%s%016" PRIx64, i ? "," : "",
                               east_beast2_fnv1a64(r->runs[i]->data, r->runs[i]->len));
    }
    snprintf(out, outlen, "%016" PRIx64, east_beast2_fnv1a64((const uint8_t *)joined, at));
}

static void test_permuted_dict_parity(void)
{
    /* 300,000 distinct keys in a permuted order: 7919 is prime to 300,000. */
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, false);
    east_beast2_run_sorter_set_parallel(s, true);
    const int64_t n = 300000;
    bool ok = s != NULL;
    for (int64_t i = 0; ok && i < n; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07" PRId64, (i * 7919) % n);
        ok = add_pair_si(s, buf, i);
    }
    ok = s && sorter_finish(s, &r) && ok;
    CHECK(ok && r.n == 3 && element_count(r.runs[0], type) == EAST_BEAST2_RUN_MAX_COUNT &&
              element_count(r.runs[1], type) == EAST_BEAST2_RUN_MAX_COUNT &&
              element_count(r.runs[2], type) == (size_t)n - 2 * EAST_BEAST2_RUN_MAX_COUNT,
          "the permuted Dict did not close runs at the element cap");
    char digest[32];
    runs_digest(&r, digest, sizeof(digest));
    CHECK(strcmp(digest, PERMUTED_DICT_DIGEST) == 0,
          "the permuted Dict's runs diverge from TypeScript's: %s (expected %s)", digest,
          PERMUTED_DICT_DIGEST);
    runs_free(&r);
    east_type_release(type);
}

/* 300,000 elements over 200,000 values: each repeats, within a run and across
 * runs. */
static void add_repeating_elements(Beast2RunSorter *s, bool *ok)
{
    for (int64_t i = 0; *ok && i < 300000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "e%06" PRId64, (i * 7919) % 200000);
        *ok = add_string(s, buf);
    }
}

static void test_set_union_parity(void)
{
    EastType *type = east_set_type(&east_string_type);
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, NULL, true);
    bool ok = s != NULL;
    add_repeating_elements(s, &ok);
    ok = s && sorter_finish(s, &r) && ok;
    CHECK(ok && r.n == 3, "the Set under union wrote %zu runs, not 3", r.n);
    char digest[32];
    runs_digest(&r, digest, sizeof(digest));
    CHECK(strcmp(digest, SET_UNION_DIGEST) == 0,
          "the Set's runs under union diverge from TypeScript's: %s (expected %s)", digest,
          SET_UNION_DIGEST);
    runs_free(&r);
    east_type_release(type);
}

/* ----- the runs, merged -------------------------------------------------- */

static bool write_file(const char *path, const ByteBuffer *bytes)
{
    FILE *f = fopen(path, "wb");
    if (!f) return false;
    bool ok = fwrite(bytes->data, 1, bytes->len, f) == bytes->len;
    return fclose(f) == 0 && ok;
}

static ByteBuffer *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    ByteBuffer *buf = byte_buffer_new(len > 0 ? (size_t)len : 1);
    buf->len = fread(buf->data, 1, (size_t)len, f);
    fclose(f);
    return buf;
}

/* Merges the runs through the blob merge and checks the output is the
 * canonical blob of `expected`. */
static void check_merged(const char *what, Runs *r, EastValue *merge_fn, bool union_mode,
                         EastValue *expected, EastType *type)
{
    char names[16][32];
    const char *paths[16];
    bool ok = true;
    for (size_t i = 0; i < r->n; i++) {
        snprintf(names[i], sizeof(names[i]), "runs_gate_run%zu.beast2", i);
        paths[i] = names[i];
        ok = ok && write_file(paths[i], r->runs[i]);
    }
    EastMergeConfig cfg = {.input_paths = paths,
                           .num_inputs = r->n,
                           .output_path = "runs_gate_merged.beast2",
                           .merge_fn = merge_fn ? merge_fn->data.function.compiled : NULL,
                           .union_mode = union_mode};
    EastMergeStats stats;
    ok = ok && east_merge_blobs(&cfg, &stats);
    CHECK(ok, "%s: the merge failed: %s", what, east_builtin_get_error());
    ByteBuffer *merged = ok ? read_file("runs_gate_merged.beast2") : NULL;
    ByteBuffer *paged = east_beast2_encode_paged(expected, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(bytes_equal(merged, paged), "%s: the merged runs are not the canonical blob", what);
    if (merged) byte_buffer_free(merged);
    byte_buffer_free(paged);
    for (size_t i = 0; i < r->n; i++)
        remove(paths[i]);
    remove("runs_gate_merged.beast2");
}

static void test_runs_merge_back(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *sum = fold_fn(sum_invoke, &east_string_type, &east_integer_type);
    EastValue *expected = east_dict_new(&east_string_type, &east_integer_type);
    Runs r;
    Beast2RunSorter *s = sorter_new(&r, type, EAST_BEAST2_CODEC_DEFLATE, sum, false);
    bool ok = s != NULL;
    for (int64_t i = 0; ok && i < 300000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07" PRId64, (i * 7919) % 200000);
        ok = add_pair_si(s, buf, i);
        EastValue *k = east_string(buf);
        EastValue *acc = east_dict_get(expected, k);
        EastValue *v = east_integer((acc ? acc->data.integer : 0) + i);
        east_dict_set(expected, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    ok = s && sorter_finish(s, &r) && ok;
    CHECK(ok && r.n > 1, "the Dict wrote %zu runs", r.n);
    if (ok) check_merged("Dict", &r, sum, false, expected, type);
    runs_free(&r);
    east_value_release(expected);
    east_value_release(sum);
    east_type_release(type);

    EastType *set_type = east_set_type(&east_string_type);
    EastValue *set = east_set_new(&east_string_type);
    for (int64_t i = 0; i < 200000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "e%06" PRId64, i);
        EastValue *e = east_string(buf);
        east_set_insert(set, e);
        east_value_release(e);
    }
    s = sorter_new(&r, set_type, EAST_BEAST2_CODEC_DEFLATE, NULL, true);
    ok = s != NULL;
    add_repeating_elements(s, &ok);
    ok = s && sorter_finish(s, &r) && ok;
    if (ok) check_merged("Set", &r, NULL, true, set, set_type);
    runs_free(&r);
    east_value_release(set);
    east_type_release(set_type);
}

int main(void)
{
    east_type_of_type_init();
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    east_set_thread_context(platform, builtins);

    test_run_is_canonical();
    test_fold_order();
    test_union_and_duplicates();
    test_count_cap();
    test_byte_cap();
    test_rollback_and_refusals();
    test_permuted_dict_parity();
    test_set_union_parity();
    test_runs_merge_back();

    platform_registry_free(platform);
    builtin_registry_free(builtins);
    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("beast2 runs: all checks passed\n");
    return 0;
}
