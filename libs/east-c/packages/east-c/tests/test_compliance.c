/*
 * Compliance test runner for east-c.
 *
 * Loads TypeScript-exported IR JSON files and executes them to verify
 * cross-implementation compatibility.
 *
 * Usage: test_compliance <path-to-ir.json>
 *
 * To generate test IR files:
 *   cd ../east && npm run test:export
 */

#include <east/east.h>
#include <east/eval_result.h>
#include <east/type_of_type.h>
#include <east/compat.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* ------------------------------------------------------------------ */
/*  Test counters                                                      */
/* ------------------------------------------------------------------ */

static int g_tests_run = 0;
static int g_tests_passed = 0;
static int g_tests_failed = 0;
static const char *g_current_describe = "";
static int g_quiet = 0; /* Set by EAST_QUIET=1 env var */

/* ------------------------------------------------------------------ */
/*  Test platform functions                                            */
/* ------------------------------------------------------------------ */

static EvalResult plat_test_pass(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type)
{
    (void)args;
    (void)num_args;
    return eval_ok(east_null());
}

static EvalResult plat_test_fail(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *message = "";
    if (num_args > 0 && args[0] && args[0]->kind == EAST_VAL_STRING) {
        message = args[0]->data.string.data;
    }
    return eval_error(message);
}

static EvalResult plat_describe(EastValue **args, size_t num_args, EastType **input_types,
                                size_t num_input_types, EastType *output_type)
{
    (void)num_args;

    const char *name = "";
    if (num_args > 0 && args[0] && args[0]->kind == EAST_VAL_STRING) {
        name = args[0]->data.string.data;
    }

    const char *prev_describe = g_current_describe;
    g_current_describe = name;
    if (!g_quiet) printf("[>] %s\n", name);

    int failed_before = g_tests_failed;

    struct timespec dt0, dt1;
    clock_gettime(CLOCK_MONOTONIC, &dt0);

    /* Call the body function (second argument).
     *
     * plat_test() catches errors in individual test bodies and returns ok,
     * so test-level failures do NOT abort the describe. A describe body
     * only aborts if its setup code (outside any test() call) throws — in
     * which case any test() calls after the throw are never registered and
     * are silently lost. Count that as one failure so the error isn't
     * invisible. */
    if (num_args <= 1 || !args[1] || args[1]->kind != EAST_VAL_FUNCTION) {
        g_tests_run++;
        g_tests_failed++;
        printf("  [x] describe \"%s\": no body (not a function)\n", name);
    } else {
        EastCompiledFn *body = args[1]->data.function.compiled;
        EvalResult r = east_call(body, NULL, 0);
        if (r.status == EVAL_ERROR) {
            /* Count as a failed test so errors don't vanish silently */
            g_tests_run++;
            g_tests_failed++;
            printf("  [x] describe \"%s\" setup: %s\n", name,
                   r.error_message ? r.error_message : "?");
            eval_result_free(&r);
        } else {
            if (r.value) east_value_release(r.value);
            eval_result_free(&r);
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &dt1);
    double desc_ms = (dt1.tv_sec - dt0.tv_sec) * 1000.0 + (dt1.tv_nsec - dt0.tv_nsec) / 1e6;

    if (g_tests_failed > failed_before) {
        printf("[x] %s (%.6fms)\n", name, desc_ms);
    } else if (!g_quiet) {
        printf("[+] %s (%.6fms)\n", name, desc_ms);
    }

    g_current_describe = prev_describe;
    return eval_ok(east_null());
}

/* The frozen-inputs fixtures' freeze capability (#539): an encode + frozen
 * decode through the real beast2 path, so the suite exercises the same
 * construction a frozen task input takes. One implementation registered
 * under each fixture type's name. */
static EvalResult plat_freeze(EastValue **args, size_t num_args, EastType **input_types,
                              size_t num_input_types, EastType *output_type)
{
    (void)output_type;
    if (num_args < 1 || num_input_types < 1 || !args[0] || !input_types[0])
        return eval_error("freeze: missing argument or input type");
    ByteBuffer *blob = east_beast2_encode_full(args[0], input_types[0]);
    if (!blob) {
        char *err = east_builtin_get_error();
        EvalResult r = eval_error(err ? err : "freeze: encode failed");
        free(err);
        return r;
    }
    EastValue *frozen = east_beast2_decode_full_frozen(blob->data, blob->len, input_types[0]);
    byte_buffer_free(blob);
    if (!frozen) {
        char *err = east_builtin_get_error();
        EvalResult r = eval_error(err ? err : "freeze: frozen decode failed");
        free(err);
        return r;
    }
    return eval_ok(frozen);
}

static EvalResult plat_test(EastValue **args, size_t num_args, EastType **input_types,
                            size_t num_input_types, EastType *output_type)
{
    (void)num_args;

    const char *name = "";
    if (num_args > 0 && args[0] && args[0]->kind == EAST_VAL_STRING) {
        name = args[0]->data.string.data;
    }

    g_tests_run++;

    /* Reject tests with no body or non-function body. Previously these were
     * silently counted as PASSED because `failed` stayed 0 and the success
     * branch was taken — hiding real bugs like lost function compilation. */
    if (num_args <= 1 || !args[1] || args[1]->kind != EAST_VAL_FUNCTION) {
        g_tests_failed++;
        printf("  [x] %s: no body (test arg missing or not a function)\n", name);
        return eval_ok(east_null());
    }

    struct timespec tt0, tt1;
    clock_gettime(CLOCK_MONOTONIC, &tt0);

    /* Call the body function (second argument) */
    int failed = 0;
    const char *err_msg = NULL;
    const char *err_file = NULL;
    long err_line = 0, err_col = 0;

    EastCompiledFn *body = args[1]->data.function.compiled;
    EvalResult r = east_call(body, NULL, 0);
    if (r.status == EVAL_ERROR) {
        failed = 1;
        if (r.error_message) err_msg = strdup(r.error_message);
        if (r.locations && r.num_locations > 0) {
            if (r.locations[0].filename) err_file = strdup(r.locations[0].filename);
            err_line = (long)r.locations[0].line;
            err_col = (long)r.locations[0].column;
        }
    }
    if (r.value) east_value_release(r.value);
    eval_result_free(&r);

    clock_gettime(CLOCK_MONOTONIC, &tt1);
    double test_ms = (tt1.tv_sec - tt0.tv_sec) * 1000.0 + (tt1.tv_nsec - tt0.tv_nsec) / 1e6;

    if (failed) {
        g_tests_failed++;
        printf("  [x] %s (%.6fms)\n", name, test_ms);
        printf("    %s\n", err_msg ? err_msg : "?");
        if (err_file) {
            printf("    at %s:%ld:%ld\n", err_file, err_line, err_col);
            free((void *)err_file);
        }
        free((void *)err_msg);
    } else {
        g_tests_passed++;
        if (!g_quiet) printf("  [+] %s (%.6fms)\n", name, test_ms);
    }

    return eval_ok(east_null());
}

/* ------------------------------------------------------------------ */
/*  File loading                                                       */
/* ------------------------------------------------------------------ */

static char *read_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Cannot open file: %s\n", path);
        return NULL;
    }

    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);

    char *buf = malloc((size_t)len + 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }

    size_t read = fread(buf, 1, (size_t)len, f);
    buf[read] = '\0';
    fclose(f);

    if (out_len) *out_len = read;
    return buf;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

/* Runs on a large-stack worker thread (east_run_on_large_stack) so deeply
 * recursive fuzz suites don't overflow the main thread's fixed stack. */
static int run_suite(void *arg)
{
    const char *json_path = (const char *)arg;

    /* Check EAST_QUIET env var */
    {
        const char *eq = getenv("EAST_QUIET");
        g_quiet = (eq != NULL && strcmp(eq, "1") == 0);
    }

    /* Initialize type descriptors */
    east_type_of_type_init();

    /* Register builtins */
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);

    /* Register test platform functions */
    PlatformRegistry *platform = platform_registry_new();
    platform_registry_add(platform, "testPass", plat_test_pass, false);
    platform_registry_add(platform, "testFail", plat_test_fail, false);
    platform_registry_add(platform, "describe", plat_describe, true);
    platform_registry_add(platform, "test", plat_test, true);
    /* The Frozen suite's per-type freeze capability (#539). */
    platform_registry_add(platform, "freezeArray", plat_freeze, false);
    platform_registry_add(platform, "freezeSet", plat_freeze, false);
    platform_registry_add(platform, "freezeDict", plat_freeze, false);
    platform_registry_add(platform, "freezeRef", plat_freeze, false);
    platform_registry_add(platform, "freezeVector", plat_freeze, false);
    platform_registry_add(platform, "freezeMatrix", plat_freeze, false);

    /* Stage 1: Read JSON file */
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);

    size_t json_len = 0;
    char *json = read_file(json_path, &json_len);
    if (!json) return 1;

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double load_ms = (t1.tv_sec - t0.tv_sec) * 1000.0 + (t1.tv_nsec - t0.tv_nsec) / 1e6;
    if (!g_quiet) printf("Load: %.1f ms (%.1f MB)\n", load_ms, json_len / (1024.0 * 1024.0));

    /* Stage 2: Decode JSON wrapper {source_map, ir} */
    clock_gettime(CLOCK_MONOTONIC, &t0);

    /* Build wrapper type: Struct({ir: IRType, source_map: SourceMapType}) */
    /* source_map: { stacks: Array(Array(Struct({filename, line, column}))) } */
    EastType *loc_struct = east_struct_type(
        (const char *[]){"filename", "line", "column"},
        (EastType *[]){&east_string_type, &east_integer_type, &east_integer_type}, 3);
    EastType *loc_arr = east_array_type(loc_struct);
    EastType *stacks_arr = east_array_type(loc_arr);
    EastType *sm_type = east_struct_type((const char *[]){"stacks"}, (EastType *[]){stacks_arr}, 1);
    EastType *wrapper_type = east_struct_type((const char *[]){"ir", "source_map"},
                                              (EastType *[]){east_ir_type, sm_type}, 2);

    EastValue *wrapper_val = east_json_decode(json, wrapper_type);
    free(json);

    east_type_release(loc_struct);
    east_type_release(loc_arr);
    east_type_release(stacks_arr);
    east_type_release(sm_type);
    east_type_release(wrapper_type);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double decode_ms = (t1.tv_sec - t0.tv_sec) * 1000.0 + (t1.tv_nsec - t0.tv_nsec) / 1e6;
    if (!g_quiet) printf("Decode: %.1f ms\n", decode_ms);

    if (!wrapper_val) {
        fprintf(stderr, "Failed to decode JSON as IR\n");
        return 1;
    }

    /* Extract source_map and ir from wrapper.
     * Struct fields are sorted alphabetically: ir=0, source_map=1 */
    EastValue *ir_val = east_struct_get_field_idx(wrapper_val, 0); /* ir */
    EastValue *sm_val = east_struct_get_field_idx(wrapper_val, 1); /* source_map */

    /* Build the EastSourceMap from the decoded source_map value — a heap map
     * the compiled function takes over below (one reference, released with
     * it; closures created during the run take their own). */
    EastSourceMap *source_map = east_source_map_new();
    if (!source_map) {
        fprintf(stderr, "Failed to allocate the source map\n");
        east_value_release(wrapper_val);
        return 1;
    }
    if (sm_val && sm_val->kind == EAST_VAL_STRUCT) {
        EastValue *stacks_val = east_struct_get_field_idx(sm_val, 0); /* stacks */
        if (stacks_val && stacks_val->kind == EAST_VAL_ARRAY) {
            size_t ns = stacks_val->data.array.len;
            source_map->num_stacks = ns;
            source_map->stacks = calloc(ns, sizeof(EastLocation *));
            source_map->stack_counts = calloc(ns, sizeof(size_t));
            for (size_t i = 0; i < ns; i++) {
                EastValue *stack = stacks_val->data.array.items[i];
                if (!stack || stack->kind != EAST_VAL_ARRAY) continue;
                size_t nf = stack->data.array.len;
                source_map->stack_counts[i] = nf;
                if (nf == 0) continue;
                source_map->stacks[i] = calloc(nf, sizeof(EastLocation));
                for (size_t j = 0; j < nf; j++) {
                    EastValue *frame = stack->data.array.items[j];
                    if (!frame || frame->kind != EAST_VAL_STRUCT) continue;
                    /* Field order matches type creation: filename=0, line=1, column=2 */
                    EastValue *fn_v = east_struct_get_field_idx(frame, 0);
                    EastValue *ln_v = east_struct_get_field_idx(frame, 1);
                    EastValue *col_v = east_struct_get_field_idx(frame, 2);
                    if (fn_v && fn_v->kind == EAST_VAL_STRING)
                        source_map->stacks[i][j].filename = strdup(fn_v->data.string.data);
                    if (ln_v && ln_v->kind == EAST_VAL_INTEGER)
                        source_map->stacks[i][j].line = ln_v->data.integer;
                    if (col_v && col_v->kind == EAST_VAL_INTEGER)
                        source_map->stacks[i][j].column = col_v->data.integer;
                }
            }
        }
    }

    /* Stage 3: Convert EastValue variant tree to IRNode (loc_id copied, not resolved) */
    clock_gettime(CLOCK_MONOTONIC, &t0);

    IRNode *ir = east_ir_from_value(ir_val);
    east_value_release(wrapper_val);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double convert_ms = (t1.tv_sec - t0.tv_sec) * 1000.0 + (t1.tv_nsec - t0.tv_nsec) / 1e6;
    if (!g_quiet) printf("Convert: %.1f ms\n", convert_ms);

    if (!ir) {
        fprintf(stderr, "Failed to convert IR value to IR node\n");
        east_source_map_release(source_map);
        return 1;
    }

    /* Stage 4: Compile and execute */
    clock_gettime(CLOCK_MONOTONIC, &t0);

    /*
     * The top-level IR is an AsyncFunction with 0 params.
     * Extract the body and compile it directly.
     */
    IRNode *body = ir;
    if (ir->kind == IR_ASYNC_FUNCTION || ir->kind == IR_FUNCTION) {
        body = ir->data.function.body;
    }

    char *compile_err = NULL;
    EastCompiledFn *fn = east_compile_checked(body, platform, builtins, &compile_err);
    if (!fn) {
        fprintf(stderr, "Failed to compile IR%s%s\n", compile_err ? ": " : "",
                compile_err ? compile_err : "");
        free(compile_err);
        ir_node_release(ir);
        east_source_map_release(source_map);
        return 1;
    }

    /* Hand the map's reference to the compiled function (released with it)
     * and install it as the current map for loc_id resolution. */
    fn->source_map = source_map;
    east_set_source_map(fn->source_map);

    /* Extract the filename from path for display */
    const char *fname = strrchr(json_path, '/');
    fname = fname ? fname + 1 : json_path;
    if (!g_quiet) printf("\n%s:\n", fname);

    EvalResult result = east_call(fn, NULL, 0);

    clock_gettime(CLOCK_MONOTONIC, &t1);
    double exec_ms = (t1.tv_sec - t0.tv_sec) * 1000.0 + (t1.tv_nsec - t0.tv_nsec) / 1e6;

    /* A fatal error in the top-level script is itself a compliance failure.
     * Previously only individual test() failures contributed to the exit
     * code, so a crash before any tests registered would print to stderr
     * but return 0 (success) — the shell aggregator would see "Results:
     * 0/0 passed" and count it as a pass. Track it as a fatal failure so
     * both the per-file Results line and the exit code reflect it. */
    int fatal = 0;
    if (result.status == EVAL_ERROR) {
        fatal = 1;
        fprintf(stderr, "\nFATAL ERROR: %s\n",
                result.error_message ? result.error_message : "unknown");
        if (result.locations && result.num_locations > 0) {
            fprintf(stderr, "  at %s:%ld:%ld\n",
                    result.locations[0].filename ? result.locations[0].filename : "?",
                    (long)result.locations[0].line, (long)result.locations[0].column);
        }
    }

    if (!g_quiet) printf("[i] tests %d\n", g_tests_run);
    printf("\nResults: %d/%d passed", g_tests_passed, g_tests_run);
    if (g_tests_failed > 0 || fatal) {
        printf(" (%d failed", g_tests_failed);
        if (fatal) printf(", FATAL");
        printf(")");
    }
    printf("\nExecute: %.1f ms\n", exec_ms);

    /* Cleanup — the map goes with the compiled function; clear the current
     * map first so nothing resolves against a freed one. */
    if (result.value) east_value_release(result.value);
    eval_result_free(&result);
    east_set_source_map(NULL);
    east_compiled_fn_free(fn);
    ir_node_release(ir);
    east_type_registry_clear();
    platform_registry_free(platform);
    builtin_registry_free(builtins);

    return (g_tests_failed > 0 || fatal) ? 1 : 0;
}

int main(int argc, char **argv)
{
    east_init_crash_handling(); /* Windows: fail fast on a fault, never hang on WER */
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <ir-json-file>\n", argv[0]);
        return 1;
    }
    return east_run_on_large_stack(run_suite, (void *)argv[1]);
}
