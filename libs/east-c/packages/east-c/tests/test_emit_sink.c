/*
 * Emit sink gate (issues #507, #770): the library sink behind `run --emit`.
 *
 *   1. segmentation — the sink's file is byte-identical to what the paged
 *      encoder writes for the same value: one value segments the same
 *      wherever it is written. Pinned on rows wide enough that the cut rule's
 *      byte-aware threshold binds, so the cuts depend on the rows' sizes as
 *      well as their keys, and on rows so wide a segment holds a handful;
 *   2. folds — --merge folds adjacent equal dict keys in emission order and
 *      --union collapses adjacent equal set elements, and the file is
 *      byte-identical to the flag-less sink's for the folded sequence — at
 *      the segment boundaries too, where the held entry is the one a cut
 *      falls at;
 *   3. errors — a duplicate key without a fold, and an out-of-order key,
 *      end the emission with the canonical messages, and the output is left
 *      unfinalised (no index).
 *
 * Run under ASan/LSan (run_leak_check.sh's build-asan configuration) for the
 * sink's lifetimes, the error paths included.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/type_of_type.h>

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

static uint8_t *read_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc(len > 0 ? (size_t)len : 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    *out_len = rd;
    return buf;
}

static bool same_bytes(const char *path_a, const char *path_b)
{
    size_t len_a = 0, len_b = 0;
    uint8_t *a = read_file(path_a, &len_a);
    uint8_t *b = read_file(path_b, &len_b);
    bool same = a && b && len_a == len_b && memcmp(a, b, len_a) == 0;
    free(a);
    free(b);
    return same;
}

/* Calls a sink's emit function value with `n` arguments; returns the
 * evaluation error's message (malloc'd) or NULL on success. */
static char *emit(EastValue *fn, EastValue **args, size_t n)
{
    EvalResult r = east_call(fn->data.function.compiled, args, n);
    char *err = NULL;
    if (r.status == EVAL_ERROR) err = strdup(r.error_message ? r.error_message : "?");
    if (r.value) east_value_release(r.value);
    eval_result_free(&r);
    return err;
}

/* ----- 1. segmentation ------------------------------------------------ */

/* Dict<Integer, Struct{text: String}>. */
static EastType *row_type_of(void)
{
    const char *names[1] = {"text"};
    EastType *types[1] = {&east_string_type};
    return east_struct_type(names, types, 1);
}

/* Incompressible text of `chars` symbols from a 64-symbol alphabet, from a
 * running LCG state — deterministic, so every run writes the same rows. */
static EastValue *noise_row(EastType *row_type, size_t chars, uint32_t *seed)
{
    static const char alphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    char *text = malloc(chars + 1);
    for (size_t c = 0; c < chars; c++) {
        *seed = (uint32_t)(((uint64_t)*seed * 48271u) % 2147483647u);
        text[c] = alphabet[(*seed >> 8) & 63u];
    }
    text[chars] = '\0';
    EastValue *v = east_string_len(text, chars);
    free(text);
    EastValue *fields[1] = {v};
    const char *names[1] = {"text"};
    EastValue *row = east_struct_new(names, fields, 1, row_type);
    east_value_release(v);
    return row;
}

/* Emits `rows` rows of `chars` symbols through a dict sink at `path`, the
 * first `wider` of them one symbol wider, and returns the value emitted. */
static EastValue *emit_rows(const char *path, size_t rows, size_t chars, size_t wider,
                            uint32_t seed)
{
    EastType *row_type = row_type_of();
    EastType *dict_type = east_dict_type(&east_integer_type, row_type);
    EastType *fn_inputs[2] = {&east_integer_type, row_type};
    EastType *fn_type = east_function_type(fn_inputs, 2, &east_null_type);
    EastEmitSinkConfig cfg = {.kind = EAST_EMIT_DICT, .out_type = dict_type, .output_path = path};
    EastEmitSink *sink = east_emit_sink_new(&cfg);
    CHECK(sink != NULL, "segmentation: the sink did not open");
    if (!sink) return NULL;
    EastValue *fn = east_emit_sink_function(sink, fn_type);
    EastValue *emitted = east_dict_new(&east_integer_type, row_type);
    bool ok = fn != NULL && emitted != NULL;
    for (size_t i = 0; i < rows && ok; i++) {
        EastValue *key = east_integer((int64_t)i);
        EastValue *row = noise_row(row_type, chars + (i < wider ? 1u : 0u), &seed);
        EastValue *args[2] = {key, row};
        char *err = emit(fn, args, 2);
        CHECK(err == NULL, "segmentation: emit %zu failed: %s", i, err ? err : "");
        ok = err == NULL;
        free(err);
        if (ok) east_dict_set(emitted, key, row);
        east_value_release(key);
        east_value_release(row);
    }
    if (ok) {
        ok = east_emit_sink_finish(sink);
        CHECK(ok, "segmentation: finish failed");
    }
    if (fn) east_value_release(fn);
    east_emit_sink_free(sink);
    if (!ok && emitted) {
        east_value_release(emitted);
        emitted = NULL;
    }
    return emitted;
}

/* The sink's file at `path` against the paged encode of `value`; returns the
 * file's segment count. */
static size_t check_against_paged(const char *what, const char *path, EastValue *value)
{
    EastType *dict_type = east_dict_type(&east_integer_type, row_type_of());
    size_t len = 0;
    uint8_t *data = read_file(path, &len);
    ByteBuffer *paged = east_beast2_encode_paged(value, dict_type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(data != NULL && paged != NULL, "%s: no output to compare", what);
    size_t segments = 0;
    if (data && paged) {
        CHECK(paged->len == len && memcmp(paged->data, data, len) == 0,
              "%s: the sink wrote %zu bytes where the paged encoder writes %zu for the same "
              "value — one value must segment the same wherever it is written",
              what, len, paged->len);
        Beast2SpliceExtents *ext = east_beast2_splice_extents(data, len);
        if (ext) {
            segments = ext->segment_count;
            east_beast2_splice_extents_free(ext);
        }
    }
    if (paged) byte_buffer_free(paged);
    free(data);
    return segments;
}

/* Rows of about 4 KB: the open segment's average size lifts the threshold
 * above the narrow one, so segments close near the byte target, and widening
 * the leading rows moves the cuts the sink must follow. */
static void test_segmentation(void)
{
    const char *path = "emit_sink_gate_segments.beast2";
    static const size_t wider[] = {0, 1, 7, 64, 700, 2100};
    for (size_t w = 0; w < sizeof wider / sizeof wider[0]; w++) {
        EastValue *value = emit_rows(path, 2100, 4000, wider[w], 12345);
        if (!value) return;
        size_t segments = check_against_paged("segmentation", path, value);
        CHECK(segments > 4, "segmentation: 8 MB of rows is %zu segments", segments);
        east_value_release(value);
    }
    remove(path);
}

/* Rows of about 300 KB, a few to a segment: the byte target, not the count,
 * closes every segment. */
static void test_segmentation_wide_rows(void)
{
    const char *path = "emit_sink_gate_wide.beast2";
    EastValue *value = emit_rows(path, 40, 300000, 0, 999);
    if (!value) return;
    size_t segments = check_against_paged("wide rows", path, value);
    CHECK(segments > 4, "wide rows: 12 MB of rows is %zu segments", segments);
    east_value_release(value);
    remove(path);
}

/* ----- 2. folds and 3. errors --------------------------------------- */

/* A foreign `(Integer, String, String) -> String`: the two strings joined. */
static EvalResult concat_invoke(EastCompiledFn *self, EastValue **args, size_t n)
{
    (void)self;
    if (n != 3) return eval_error("concat: wrong arity");
    size_t la = args[1]->data.string.len, lb = args[2]->data.string.len;
    char *joined = malloc(la + lb + 1);
    memcpy(joined, args[1]->data.string.data, la);
    memcpy(joined + la, args[2]->data.string.data, lb);
    joined[la + lb] = '\0';
    EastValue *v = east_string_len(joined, la + lb);
    free(joined);
    return eval_ok(v);
}

typedef struct {
    int64_t key;
    const char *value;
} Pair;

/* Emits `pairs` through a dict sink at `path`, with or without the concat
 * fold; returns the first emission's error message (malloc'd) or NULL. The
 * sink is finished only when every emission succeeded. */
static char *emit_pairs(const char *path, const Pair *pairs, size_t n, bool fold, bool *finished)
{
    EastType *dict_type = east_dict_type(&east_integer_type, &east_string_type);
    EastType *emit_inputs[2] = {&east_integer_type, &east_string_type};
    EastType *emit_type = east_function_type(emit_inputs, 2, &east_null_type);
    EastType *fold_inputs[3] = {&east_integer_type, &east_string_type, &east_string_type};
    EastType *fold_type = east_function_type(fold_inputs, 3, &east_string_type);
    EastValue *fold_fn = fold ? east_foreign_function(concat_invoke, NULL, NULL, fold_type) : NULL;
    EastEmitSinkConfig cfg = {.kind = EAST_EMIT_DICT,
                              .out_type = dict_type,
                              .output_path = path,
                              .merge_fn = fold_fn ? fold_fn->data.function.compiled : NULL};
    EastEmitSink *sink = east_emit_sink_new(&cfg);
    *finished = false;
    char *err = NULL;
    if (!sink) {
        err = east_builtin_get_error();
        if (fold_fn) east_value_release(fold_fn);
        return err ? err : strdup("the sink did not open");
    }
    EastValue *fn = east_emit_sink_function(sink, emit_type);
    for (size_t i = 0; i < n && !err; i++) {
        EastValue *key = east_integer(pairs[i].key);
        EastValue *value = east_string(pairs[i].value);
        EastValue *args[2] = {key, value};
        err = emit(fn, args, 2);
        east_value_release(key);
        east_value_release(value);
    }
    if (!err) *finished = east_emit_sink_finish(sink);
    east_value_release(fn);
    east_emit_sink_free(sink);
    if (fold_fn) east_value_release(fold_fn);
    return err;
}

/* Emits `keys` through a set sink at `path`, with or without union. */
static char *emit_keys(const char *path, const int64_t *keys, size_t n, bool union_mode,
                       bool *finished)
{
    EastType *set_type = east_set_type(&east_integer_type);
    EastType *emit_inputs[1] = {&east_integer_type};
    EastType *emit_type = east_function_type(emit_inputs, 1, &east_null_type);
    EastEmitSinkConfig cfg = {
        .kind = EAST_EMIT_SET, .out_type = set_type, .output_path = path, .union_mode = union_mode};
    EastEmitSink *sink = east_emit_sink_new(&cfg);
    *finished = false;
    if (!sink) {
        char *err = east_builtin_get_error();
        return err ? err : strdup("the sink did not open");
    }
    EastValue *fn = east_emit_sink_function(sink, emit_type);
    char *err = NULL;
    for (size_t i = 0; i < n && !err; i++) {
        EastValue *key = east_integer(keys[i]);
        EastValue *args[1] = {key};
        err = emit(fn, args, 1);
        east_value_release(key);
    }
    if (!err) *finished = east_emit_sink_finish(sink);
    east_value_release(fn);
    east_emit_sink_free(sink);
    return err;
}

/* Whether the blob at `path` carries an index (a finalised output). */
static bool has_index(const char *path, EastType *type)
{
    size_t len = 0;
    uint8_t *data = read_file(path, &len);
    if (!data) return false;
    Beast2Pages *pages = east_beast2_pages_new(data, len, type);
    bool indexed = pages != NULL;
    if (pages) east_beast2_pages_free(pages);
    free(east_builtin_get_error());
    free(data);
    return indexed;
}

static void test_folds(void)
{
    /* Adjacent equal keys fold in emission order into the entry the sink
     * holds back. */
    bool finished = false;
    static const Pair merged[] = {{1, "a"}, {1, "b"}, {2, "c"}, {2, "d"}, {2, "e"}, {3, "f"}};
    char *err = emit_pairs("emit_sink_gate_merge.beast2", merged, 6, true, &finished);
    CHECK(err == NULL && finished, "merge: expected the fold to succeed, got %s",
          err ? err : "an unfinished output");
    free(err);
    static const Pair folded[] = {{1, "ab"}, {2, "cde"}, {3, "f"}};
    err = emit_pairs("emit_sink_gate_folded.beast2", folded, 3, false, &finished);
    CHECK(err == NULL && finished, "merge: the folded control failed: %s", err ? err : "");
    free(err);
    CHECK(same_bytes("emit_sink_gate_merge.beast2", "emit_sink_gate_folded.beast2"),
          "merge: the folded output is not byte-identical to the flag-less sink's output for "
          "the folded sequence");
    size_t len = 0;
    uint8_t *data = read_file("emit_sink_gate_merge.beast2", &len);
    EastType *dict_type = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = data ? east_beast2_decode_full(data, len, dict_type) : NULL;
    CHECK(dict != NULL && dict->data.dict.len == 3, "merge: expected three folded pairs");
    if (dict) {
        EastValue *two = east_integer(2);
        EastValue *v = east_dict_get(dict, two);
        CHECK(v && strcmp(v->data.string.data, "cde") == 0, "merge: key 2 folded to %s",
              v ? v->data.string.data : "?");
        east_value_release(two);
        east_value_release(dict);
    }
    free(data);

    /* Every key twice, across many segments: some folds land on the entry a
     * segment starts at, and the file is still the folded sequence's. */
    enum { KEYS = 12000 };
    Pair *twice = malloc(2 * KEYS * sizeof(Pair));
    Pair *once = malloc(KEYS * sizeof(Pair));
    for (int64_t k = 0; k < KEYS; k++) {
        twice[2 * k] = (Pair){k, "left-"};
        twice[2 * k + 1] = (Pair){k, "right"};
        once[k] = (Pair){k, "left-right"};
    }
    err = emit_pairs("emit_sink_gate_merge_many.beast2", twice, 2 * KEYS, true, &finished);
    CHECK(err == NULL && finished, "merge across segments: the fold failed: %s", err ? err : "");
    free(err);
    err = emit_pairs("emit_sink_gate_folded_many.beast2", once, KEYS, false, &finished);
    CHECK(err == NULL && finished, "merge across segments: the control failed: %s", err ? err : "");
    free(err);
    CHECK(same_bytes("emit_sink_gate_merge_many.beast2", "emit_sink_gate_folded_many.beast2"),
          "merge across segments: the folded output differs from the folded sequence's");
    data = read_file("emit_sink_gate_merge_many.beast2", &len);
    Beast2SpliceExtents *ext = data ? east_beast2_splice_extents(data, len) : NULL;
    CHECK(ext && ext->segment_count > 2, "merge across segments: too few segments");
    if (ext) east_beast2_splice_extents_free(ext);
    free(data);
    free(twice);
    free(once);

    static const int64_t elements[] = {1, 1, 2, 3, 3, 3};
    err = emit_keys("emit_sink_gate_union.beast2", elements, 6, true, &finished);
    CHECK(err == NULL && finished, "union: expected the union to succeed, got %s",
          err ? err : "an unfinished output");
    free(err);
    static const int64_t distinct[] = {1, 2, 3};
    err = emit_keys("emit_sink_gate_distinct.beast2", distinct, 3, false, &finished);
    CHECK(err == NULL && finished, "union: the distinct control failed: %s", err ? err : "");
    free(err);
    CHECK(same_bytes("emit_sink_gate_union.beast2", "emit_sink_gate_distinct.beast2"),
          "union: the union output is not byte-identical to the flag-less sink's output for "
          "the distinct sequence");
    remove("emit_sink_gate_merge.beast2");
    remove("emit_sink_gate_folded.beast2");
    remove("emit_sink_gate_merge_many.beast2");
    remove("emit_sink_gate_folded_many.beast2");
    remove("emit_sink_gate_union.beast2");
    remove("emit_sink_gate_distinct.beast2");
}

static void test_errors(void)
{
    EastType *dict_type = east_dict_type(&east_integer_type, &east_string_type);
    bool finished = false;

    static const Pair duplicate[] = {{1, "a"}, {1, "b"}};
    char *err = emit_pairs("emit_sink_gate_duplicate.beast2", duplicate, 2, false, &finished);
    CHECK(err != NULL && strcmp(err, "beast2 v5: duplicate Dict key emitted: 1 — Dict keys must "
                                     "be unique") == 0,
          "duplicate: expected the canonical message, got %s", err ? err : "success");
    CHECK(!finished && !has_index("emit_sink_gate_duplicate.beast2", dict_type),
          "duplicate: the aborted output must carry no index");
    free(err);

    static const Pair disorder[] = {{2, "b"}, {1, "a"}};
    err = emit_pairs("emit_sink_gate_disorder.beast2", disorder, 2, false, &finished);
    CHECK(err != NULL && strcmp(err, "beast2 v5: Dict key emitted out of order: 1 after 2 — "
                                     "Set/Dict emissions must ascend in East order") == 0,
          "out of order: expected the canonical message, got %s", err ? err : "success");
    CHECK(!finished && !has_index("emit_sink_gate_disorder.beast2", dict_type),
          "out of order: the aborted output must carry no index");
    free(err);

    /* A fold never reorders: an out-of-order key is refused under --merge too. */
    static const Pair disorder_fold[] = {{2, "b"}, {2, "c"}, {1, "a"}};
    err = emit_pairs("emit_sink_gate_disorder_fold.beast2", disorder_fold, 3, true, &finished);
    CHECK(err != NULL && strstr(err, "emitted out of order: 1 after 2") != NULL,
          "out of order under --merge: expected the canonical message, got %s",
          err ? err : "success");
    free(err);

    static const int64_t set_disorder[] = {3, 1};
    err = emit_keys("emit_sink_gate_set_disorder.beast2", set_disorder, 2, true, &finished);
    CHECK(err != NULL && strcmp(err, "beast2 v5: Set element emitted out of order: 1 after 3 — "
                                     "Set/Dict emissions must ascend in East order") == 0,
          "set out of order: expected the canonical message, got %s", err ? err : "success");
    free(err);

    remove("emit_sink_gate_duplicate.beast2");
    remove("emit_sink_gate_disorder.beast2");
    remove("emit_sink_gate_disorder_fold.beast2");
    remove("emit_sink_gate_set_disorder.beast2");
}

int main(void)
{
    east_type_of_type_init();
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    east_set_thread_context(platform, builtins);

    test_segmentation();
    test_segmentation_wide_rows();
    test_folds();
    test_errors();

    platform_registry_free(platform);
    builtin_registry_free(builtins);
    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("emit sink gate: all checks passed\n");
    return 0;
}
