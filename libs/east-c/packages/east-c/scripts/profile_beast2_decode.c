/*
 * Beast2 v2 decode + encode benchmark.
 *
 * Decodes a beast2 file, then re-encodes the decoded value.
 * Reports times for both operations.
 *
 * Usage: ./profile_beast2_decode /tmp/ui.beast2 [iterations]
 *
 * Generate the test file with:
 *   cd libs/east && npx tsx contrib/examples/beast2_v2_benchmark.ts
 */
#include <east/east.h>
#include <east/type_of_type.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static double elapsed_ms(struct timespec *a, struct timespec *b) {
    return (b->tv_sec - a->tv_sec) * 1000.0 + (b->tv_nsec - a->tv_nsec) / 1e6;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <file.beast2> [iterations]\n", argv[0]);
        return 1;
    }
    int iters = argc > 2 ? atoi(argv[2]) : 5;

    /* Read file */
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("fopen"); return 1; }
    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *data = malloc(fsize);
    fread(data, 1, fsize, f);
    fclose(f);
    fprintf(stderr, "File: %s (%ld bytes, %.2f MB)\n\n", argv[1], fsize, fsize / 1048576.0);

    /* Init type system */
    east_type_of_type_init();

    /* === Decode benchmark === */
    struct timespec t0, t1;
    EastValue *val = NULL;

    /* Warmup */
    val = east_beast2_decode_auto(data, fsize);
    if (!val) { fprintf(stderr, "Decode failed!\n"); free(data); return 1; }

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
    free(data);
    east_type_registry_clear();
    return 0;
}
