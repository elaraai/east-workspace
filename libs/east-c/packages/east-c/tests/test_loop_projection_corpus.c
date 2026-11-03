/*
 * The loop projection corpus (#1112), as east-c runs it.
 *
 * east/test/loop_projection_corpus.spec.ts writes loops over a paged input,
 * each with the projection its body admits, and the piece programs of #1093's
 * benchmark queries, each run inside a function that collects what it emits.
 *
 * For each loop, east_beast2_projection_for_loop must infer from the loop's
 * body the type TypeScript inferred, or decline where it declined, so every
 * runtime decodes a loop's segments to the same fields. Every case then runs
 * over its inputs opened paged and frozen, as e3 opens a task's inputs: the
 * answer must be TypeScript's, and its paged loops must decode as many
 * segments projected, and as many whole, as TypeScript's did.
 *
 * Usage: test_loop_projection_corpus [corpus-dir]
 *   (default: $EAST_TEST_IR_DIR/loop_projection, which make sets; written by
 *   `make test-export` in libs/east)
 *
 * Run under ASan/LSan for the plans' and the paged values' lifetimes.
 */
#include <east/east.h>
#include <east/type_of_type.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SKIP_EXIT_CODE 77

/* The most inputs a case reads. */
#define MAX_INPUTS 4

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

static PlatformRegistry *g_platform;
static BuiltinRegistry *g_builtins;

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

/* A case's function, decoded and compiled as `exec` compiles a unit's
 * program: with the IR's own source map current, then handed to the function.
 * The IR is the caller's to release, after the function. */
static EastCompiledFn *compile_case(const char *name, EastValue *blob, IRNode **ir_out)
{
    EastSourceMap *map = NULL;
    IRNode *ir = east_beast2_decode_ir(blob->data.blob.data, blob->data.blob.len, NULL, &map);
    *ir_out = ir;
    CHECK(ir != NULL, "%s: the function's IR does not decode", name);
    if (!ir) {
        east_source_map_release(map);
        return NULL;
    }
    const EastSourceMap *saved = east_get_source_map();
    if (map) east_set_source_map(map);
    char *err = NULL;
    EastCompiledFn *fn = east_compile_fn(ir, g_platform, g_builtins, &err);
    east_set_source_map(saved);
    CHECK(fn != NULL, "%s: the function does not compile: %s", name, err ? err : "?");
    free(err);
    if (!fn) {
        east_source_map_release(map);
        return NULL;
    }
    if (map) fn->source_map = map;
    return fn;
}

static bool is_variable(const IRNode *node, const char *name)
{
    return node && node->kind == IR_VARIABLE && node->data.variable.name &&
           strcmp(node->data.variable.name, name) == 0;
}

/* The loop over the function's first parameter — the first for-loop its body
 * runs, as the corpus writes each — with its value variable in *target. */
static IRNode *paged_loop(IRNode *fn_ir, const char **target)
{
    if (fn_ir->kind != IR_FUNCTION || fn_ir->data.function.num_params == 0) return NULL;
    const char *param = fn_ir->data.function.params[0].name;
    IRNode *body = fn_ir->data.function.body;
    IRNode **stmts = &body;
    size_t n = 1;
    if (body->kind == IR_BLOCK) {
        stmts = body->data.block.stmts;
        n = body->data.block.num_stmts;
    }
    for (size_t i = 0; i < n; i++) {
        IRNode *s = stmts[i];
        if (s->kind == IR_FOR_ARRAY && is_variable(s->data.for_array.array, param)) {
            *target = s->data.for_array.var.name;
            return s->data.for_array.body;
        }
        if (s->kind == IR_FOR_DICT && is_variable(s->data.for_dict.dict, param)) {
            *target = s->data.for_dict.val.name;
            return s->data.for_dict.body;
        }
    }
    return NULL;
}

/* A type for a failure message (freed by the caller). */
static char *printed(EastType *type)
{
    return type ? east_print_type(type) : strdup("(whole)");
}

/* The loop's projection, inferred from its body against the input's type: the
 * type TypeScript inferred, or none where it declined. */
static void check_inference(const char *name, IRNode *fn_ir, EastValue *input, EastValue *projected)
{
    const char *target = NULL;
    IRNode *body = paged_loop(fn_ir, &target);
    CHECK(body != NULL, "%s: the function runs no loop over its first parameter", name);
    if (!body) return;
    EastType *root = east_beast2_extract_type(input->data.blob.data, input->data.blob.len);
    CHECK(root != NULL, "%s: the input's type does not decode", name);
    if (!root) return;
    Beast2Projection *pr = east_beast2_projection_for_loop(body, target, root);
    if (!pr) free(east_builtin_get_error());
    bool want = strcmp(east_variant_case_name(projected), "some") == 0;
    EastType *want_type = want ? east_type_from_value(projected->data.variant.value) : NULL;
    EastType *got_type = pr ? east_beast2_projection_root_type(pr) : NULL;
    bool same = want ? got_type && want_type && east_type_equal(got_type, want_type) : !got_type;
    if (!same) {
        char *got_text = printed(got_type);
        char *want_text = printed(want_type);
        CHECK(same, "%s: inferred %s, TypeScript inferred %s", name, got_text, want_text);
        free(got_text);
        free(want_text);
    }
    if (want_type) east_type_release(want_type);
    if (pr) east_beast2_projection_free(pr);
    east_type_release(root);
}

/* Runs a case's function over its inputs opened paged and frozen: the answer
 * must be `expected`'s, and its loops must decode `projected` segments
 * projected and `whole` whole. */
static void run_case(const char *name, EastCompiledFn *fn, EastValue *const *blobs, size_t n,
                     EastValue *expected, size_t projected, size_t whole)
{
    CHECK(n <= MAX_INPUTS && fn->num_params == n, "%s: the function takes %zu inputs, not %zu",
          name, fn->num_params, n);
    if (n > MAX_INPUTS || fn->num_params != n) return;
    EastValue *args[MAX_INPUTS] = {NULL};
    EastType *types[MAX_INPUTS] = {NULL};
    bool opened = true;
    for (size_t i = 0; opened && i < n; i++) {
        const EastValue *blob = blobs[i];
        types[i] = east_beast2_extract_type(blob->data.blob.data, blob->data.blob.len);
        args[i] = types[i] ? east_beast2_open_paged_view(blob->data.blob.data, blob->data.blob.len,
                                                         types[i], true)
                           : NULL;
        CHECK(args[i] && args[i]->kind == EAST_VAL_PAGED, "%s: input %zu does not open paged: %s",
              name, i, args[i] ? "(decoded whole)" : east_builtin_get_error());
        opened = args[i] != NULL;
    }
    if (opened) {
        size_t projected_before = 0, whole_before = 0;
        east_beast2_paged_loop_stats(&projected_before, &whole_before);
        EvalResult r = east_call(fn, args, n);
        size_t projected_after = 0, whole_after = 0;
        east_beast2_paged_loop_stats(&projected_after, &whole_after);
        CHECK(r.status == EVAL_OK, "%s: the function failed: %s", name,
              r.error_message ? r.error_message : "?");
        if (r.status == EVAL_OK && r.value) {
            CHECK(east_value_equal(r.value, expected), "%s: the answer is not TypeScript's", name);
        }
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        size_t got_projected = projected_after - projected_before;
        size_t got_whole = whole_after - whole_before;
        CHECK(got_projected == projected && got_whole == whole,
              "%s: %zu segments decoded projected and %zu whole, where TypeScript decoded %zu and "
              "%zu",
              name, got_projected, got_whole, projected, whole);
        printf("    %zu segments decoded projected, %zu whole\n", got_projected, got_whole);
    }
    for (size_t i = 0; i < n; i++) {
        if (args[i]) east_value_release(args[i]);
        if (types[i]) east_type_release(types[i]);
    }
}

/* The answer a case's result blob holds (released by the caller). */
static EastValue *expected_of(const char *name, EastValue *c)
{
    EastValue *blob = east_struct_get_field(c, "result");
    EastValue *expected = east_beast2_decode_auto(blob->data.blob.data, blob->data.blob.len);
    CHECK(expected != NULL, "%s: the expected answer does not decode: %s", name,
          east_builtin_get_error());
    return expected;
}

static void check_loop(EastValue *c)
{
    const char *name = east_struct_get_field(c, "name")->data.string.data;
    IRNode *ir = NULL;
    EastCompiledFn *fn = compile_case(name, east_struct_get_field(c, "fn"), &ir);
    EastValue *input = east_struct_get_field(c, "input");
    EastValue *projected = east_struct_get_field(c, "projected");
    if (ir) check_inference(name, ir, input, projected);
    EastValue *expected = expected_of(name, c);
    if (fn && expected) {
        size_t segments = (size_t)east_struct_get_field(c, "segments")->data.integer;
        bool narrowed = strcmp(east_variant_case_name(projected), "some") == 0;
        run_case(name, fn, &input, 1, expected, narrowed ? segments : 0, narrowed ? 0 : segments);
    }
    if (expected) east_value_release(expected);
    if (fn) east_compiled_fn_free(fn);
    if (ir) ir_node_release(ir);
}

static void check_piece(EastValue *c)
{
    const char *name = east_struct_get_field(c, "name")->data.string.data;
    IRNode *ir = NULL;
    EastCompiledFn *fn = compile_case(name, east_struct_get_field(c, "fn"), &ir);
    EastValue *expected = expected_of(name, c);
    EastValue *inputs = east_struct_get_field(c, "inputs");
    size_t n = east_array_len(inputs);
    EastValue *blobs[MAX_INPUTS] = {NULL};
    for (size_t i = 0; i < n && i < MAX_INPUTS; i++)
        blobs[i] = east_array_get(inputs, i);
    if (fn && expected) {
        run_case(name, fn, blobs, n, expected,
                 (size_t)east_struct_get_field(c, "projected")->data.integer,
                 (size_t)east_struct_get_field(c, "whole")->data.integer);
    }
    if (expected) east_value_release(expected);
    if (fn) east_compiled_fn_free(fn);
    if (ir) ir_node_release(ir);
}

/* Checks every case of one corpus file. */
static void run_file(const char *dir, const char *file, void (*check)(EastValue *))
{
    char path[1200];
    snprintf(path, sizeof(path), "%s/%s", dir, file);
    ByteBuffer *bytes = read_file(path);
    CHECK(bytes != NULL, "%s is missing", path);
    if (!bytes) return;
    EastValue *cases = east_beast2_decode_auto(bytes->data, bytes->len);
    byte_buffer_free(bytes);
    CHECK(cases != NULL, "%s does not decode: %s", path, east_builtin_get_error());
    if (!cases) return;
    size_t n = east_array_len(cases);
    for (size_t i = 0; i < n; i++) {
        EastValue *c = east_array_get(cases, i);
        printf("%s: %s\n", file, east_struct_get_field(c, "name")->data.string.data);
        int before = failures;
        check(c);
        if (failures != before) printf("    [x] failed\n");
    }
    CHECK(n > 0, "%s holds no cases", path);
    east_value_release(cases);
}

int main(int argc, char **argv)
{
    char default_corpus[1024];
    const char *corpus = argc > 1 ? argv[1] : NULL;
    if (!corpus) {
        const char *ir = getenv("EAST_TEST_IR_DIR");
        if (!ir || !*ir) {
            printf("SKIP: EAST_TEST_IR_DIR is unset (run it through make: make -C libs/east-c "
                   "unit)\n");
            return SKIP_EXIT_CODE;
        }
        snprintf(default_corpus, sizeof(default_corpus), "%s/loop_projection", ir);
        corpus = default_corpus;
    }
    char probe[1200];
    snprintf(probe, sizeof(probe), "%s/loops.beast2", corpus);
    FILE *f = fopen(probe, "rb");
    if (!f) {
        printf("SKIP: no corpus at %s (run `make test-export` in libs/east)\n", corpus);
        return SKIP_EXIT_CODE;
    }
    fclose(f);

    east_type_of_type_init();
    g_builtins = builtin_registry_new();
    east_register_all_builtins(g_builtins);
    g_platform = platform_registry_new();
    east_set_thread_context(g_platform, g_builtins);

    run_file(corpus, "loops.beast2", check_loop);
    run_file(corpus, "pieces.beast2", check_piece);

    platform_registry_free(g_platform);
    builtin_registry_free(g_builtins);
    if (failures > 0) {
        fprintf(stderr, "loop projection corpus: %d check(s) failed\n", failures);
        return 1;
    }
    printf("loop projection corpus: all cases passed\n");
    return 0;
}
