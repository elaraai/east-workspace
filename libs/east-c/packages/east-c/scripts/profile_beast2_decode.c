/*
 * Beast2 v2 decode + encode benchmark.
 *
 * Decodes a beast2 file, then re-encodes the decoded value.
 * If --ir flag is passed, decodes as IR (beast2_decode_ir) instead.
 * Reports times for both operations.
 *
 * Usage: ./profile_beast2_decode /tmp/ui.beast2 [iterations]
 *        ./profile_beast2_decode --ir /tmp/ui_fn.beast2 [iterations]
 *
 * Generate the test files with:
 *   cd libs/east && npx tsx contrib/examples/beast2_v2_benchmark.ts
 */
#include <east/east.h>
#include <east/type_of_type.h>
#include <east/ir.h>
#include <east/compiler.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double elapsed_ms(struct timespec *a, struct timespec *b) {
    return (b->tv_sec - a->tv_sec) * 1000.0 + (b->tv_nsec - a->tv_nsec) / 1e6;
}

static int profile_ir(const uint8_t *data, long fsize, int iters) {
    struct timespec t0, t1;

    /* Warmup */
    IRNode *ir = east_beast2_decode_ir(data, fsize, NULL);
    if (!ir) { fprintf(stderr, "IR decode failed!\n"); return 1; }
    ir_node_release(ir);

    /* Timed decode iterations */
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int i = 0; i < iters; i++) {
        ir = east_beast2_decode_ir(data, fsize, NULL);
        if (i < iters - 1) { ir_node_release(ir); east_type_registry_clear(); east_type_of_type_init(); }
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double decode_ms = elapsed_ms(&t0, &t1) / iters;

    fprintf(stderr, "=== IR Decode (direct) ===\n");
    fprintf(stderr, "  %d iterations: %.1f ms/call\n", iters, decode_ms);
    fprintf(stderr, "  IR node kind: %d\n\n", ir->kind);

    /* Compile */
    BuiltinRegistry *builtins = builtin_registry_new();
    EastCompiledFn *fn = east_compile(ir, NULL, builtins);
    if (!fn) { fprintf(stderr, "Compile failed!\n"); ir_node_release(ir); builtin_registry_free(builtins); return 1; }

    /* Execute — if the result is a function (closure), call it to get the actual value */
    EvalResult result = east_call(fn, NULL, 0);
    if (result.error_message) {
        fprintf(stderr, "Execute failed: %s\n", result.error_message);
    } else {
        /* Check if result is a closure that needs calling */
        EastCompiledFn *inner_fn = NULL;
        if (result.value && result.value->kind == EAST_VAL_FUNCTION && result.value->data.function.compiled) {
            inner_fn = result.value->data.function.compiled;
            fprintf(stderr, "  (outer function returns closure — calling it)\n");
        }

        clock_gettime(CLOCK_MONOTONIC, &t0);
        for (int i = 0; i < iters; i++) {
            EvalResult r = east_call(fn, NULL, 0);
            /* If outer returns a closure, call it */
            if (inner_fn && r.value && r.value->kind == EAST_VAL_FUNCTION) {
                EastCompiledFn *cfn = r.value->data.function.compiled;
                if (cfn) {
                    EvalResult inner = east_call(cfn, NULL, 0);
                    east_value_release(r.value);
                    eval_result_free(&r);
                    r = inner;
                }
            }
            if (r.value) east_value_release(r.value);
            eval_result_free(&r);
        }
        clock_gettime(CLOCK_MONOTONIC, &t1);
        double exec_ms = elapsed_ms(&t0, &t1) / iters;

        fprintf(stderr, "=== Execute ===\n");
        fprintf(stderr, "  %d iterations: %.1f ms/call\n\n", iters, exec_ms);

        fprintf(stderr, "=== Summary ===\n");
        fprintf(stderr, "  decode: %.1f ms\n", decode_ms);
        fprintf(stderr, "  execute: %.1f ms\n", exec_ms);
        fprintf(stderr, "  total: %.1f ms\n", decode_ms + exec_ms);
    }

    if (result.value) east_value_release(result.value);
    eval_result_free(&result);
    east_compiled_fn_free(fn);
    ir_node_release(ir);
    builtin_registry_free(builtins);
    return 0;
}

static int profile_value(const uint8_t *data, long fsize, int iters) {
    struct timespec t0, t1;
    EastValue *val = NULL;

    /* Warmup */
    val = east_beast2_decode_auto(data, fsize);
    if (!val) { fprintf(stderr, "Decode failed!\n"); return 1; }

    /* Get the type from the blob header for re-encoding */
    EastType *decoded_type = east_beast2_extract_type(data, fsize);

    east_value_release(val);

    /* Timed iterations */
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int i = 0; i < iters; i++) {
        val = east_beast2_decode_auto(data, fsize);
        if (i < iters - 1) east_value_release(val);
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double decode_ms = elapsed_ms(&t0, &t1) / iters;

    fprintf(stderr, "=== Decode ===\n");
    fprintf(stderr, "  %d iterations: %.1f ms/call\n\n", iters, decode_ms);

    /* === Encode benchmark === */
    if (val && decoded_type) {
        ByteBuffer *blob = NULL;

        /* Warmup */
        blob = east_beast2_encode_full(val, decoded_type);
        if (blob) {
            fprintf(stderr, "=== Encode ===\n");
            fprintf(stderr, "  re-encoded size: %zu bytes (%.2f MB)\n", blob->len, blob->len / 1048576.0);
            byte_buffer_free(blob);

            /* Timed iterations */
            clock_gettime(CLOCK_MONOTONIC, &t0);
            for (int i = 0; i < iters; i++) {
                blob = east_beast2_encode_full(val, decoded_type);
                byte_buffer_free(blob);
            }
            clock_gettime(CLOCK_MONOTONIC, &t1);
            double encode_ms = elapsed_ms(&t0, &t1) / iters;
            fprintf(stderr, "  %d iterations: %.1f ms/call\n\n", iters, encode_ms);

            fprintf(stderr, "=== Summary ===\n");
            fprintf(stderr, "  decode: %.1f ms\n", decode_ms);
            fprintf(stderr, "  encode: %.1f ms\n", encode_ms);
        } else {
            fprintf(stderr, "  Re-encode failed (no type info)\n");
        }
    }

    /* Cleanup */
    if (val) east_value_release(val);
    if (decoded_type) east_type_release(decoded_type);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s [--ir] <file.beast2> [iterations]\n", argv[0]);
        return 1;
    }

    int ir_mode = 0;
    int arg_idx = 1;
    if (strcmp(argv[1], "--ir") == 0) {
        ir_mode = 1;
        arg_idx = 2;
    }
    if (arg_idx >= argc) {
        fprintf(stderr, "Usage: %s [--ir] <file.beast2> [iterations]\n", argv[0]);
        return 1;
    }

    const char *path = argv[arg_idx];
    int iters = (arg_idx + 1 < argc) ? atoi(argv[arg_idx + 1]) : 5;

    /* Read file */
    FILE *f = fopen(path, "rb");
    if (!f) { perror("fopen"); return 1; }
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *data = malloc(fsize);
    fread(data, 1, fsize, f);
    fclose(f);
    fprintf(stderr, "File: %s (%ld bytes, %.2f MB)\n", path, fsize, fsize / 1048576.0);
    fprintf(stderr, "Mode: %s\n\n", ir_mode ? "IR (direct decode)" : "value (beast2_decode_auto)");

    /* Init type system */
    east_type_of_type_init();

    int ret = ir_mode
        ? profile_ir(data, fsize, iters)
        : profile_value(data, fsize, iters);

    free(data);
    east_type_registry_clear();
    return ret;
}
