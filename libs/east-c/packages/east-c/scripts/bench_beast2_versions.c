/*
 * beast2 benchmark (east-c side): encode time, encoded size and decode time
 * for v4 and v5 (none + deflate), over the corpus written by
 * libs/east/contrib/beast2-bench/generate-corpus.ts.
 *
 * Each case is seeded by decoding its v4 blob into a native EastValue, so the
 * TypeScript, east-c and east-py benchmarks all measure the same values and
 * their numbers are directly comparable. Emits JSON on stdout; point
 * contrib/beast2-bench/report.ts at it (as <corpus dir>/c.json) to render the
 * comparison tables.
 *
 *   ./build/packages/east-c/bench_beast2_versions [corpus_dir] > $DIR/c.json
 *
 * Build Release for meaningful numbers.
 */
#include <east/east.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static uint8_t *read_file(const char *path, size_t *len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc((size_t)n);
    if (fread(buf, 1, (size_t)n, f) != (size_t)n) {
        free(buf);
        fclose(f);
        return NULL;
    }
    fclose(f);
    *len = (size_t)n;
    return buf;
}

#define BUDGET_MS 400.0

int main(int argc, char **argv)
{
    const char *dir = argc > 1 ? argv[1] : "/tmp/beast2-bench";
    east_type_of_type_init();

    DIR *d = opendir(dir);
    if (!d) {
        fprintf(stderr, "cannot open %s\n", dir);
        return 1;
    }

    char names[64][128];
    int n_names = 0;
    struct dirent *ent;
    while ((ent = readdir(d)) && n_names < 64) {
        const char *suffix = strstr(ent->d_name, ".v4.beast2");
        if (!suffix || suffix[10] != '\0') continue;
        size_t base = (size_t)(suffix - ent->d_name);
        memcpy(names[n_names], ent->d_name, base);
        names[n_names][base] = '\0';
        n_names++;
    }
    closedir(d);

    printf("[\n");
    int emitted = 0;
    for (int i = 0; i < n_names; i++) {
        char path[512];
        snprintf(path, sizeof path, "%.400s/%.100s.v4.beast2", dir, names[i]);
        size_t blob_len;
        uint8_t *blob = read_file(path, &blob_len);
        if (!blob) continue;

        EastType *type = east_beast2_extract_type(blob, blob_len);
        EastValue *value = east_beast2_decode_auto(blob, blob_len);
        if (!type || !value) {
            fprintf(stderr, "skip %s (decode failed)\n", names[i]);
            free(blob);
            if (type) east_type_release(type);
            if (value) east_value_release(value);
            continue;
        }

        struct {
            const char *label;
            int version;
            int32_t codec;
        } variants[3] = {
            {"v4", 4, 0},
            {"v5-none", 5, EAST_BEAST2_CODEC_NONE},
            {"v5-deflate", 5, EAST_BEAST2_CODEC_DEFLATE},
        };

        if (emitted++) printf(",\n");
        printf("  {\"name\": \"%s\"", names[i]);

        for (int v = 0; v < 3; v++) {
            ByteBuffer *out = variants[v].version == 4
                                  ? east_beast2_encode_full(value, type)
                                  : east_beast2_encode_v5(value, type, variants[v].codec, false);
            if (!out) {
                char *err = east_builtin_get_error();
                fprintf(stderr, "  %s/%s encode failed: %s\n", names[i], variants[v].label,
                        err ? err : "(no message)");
                free(err);
                continue;
            }
            size_t size = out->len;
            uint8_t *enc_bytes = malloc(size);
            memcpy(enc_bytes, out->data, size);
            byte_buffer_free(out);

            /* encode timing */
            double t0 = now_ms();
            long iters = 0;
            do {
                ByteBuffer *b = variants[v].version == 4
                                    ? east_beast2_encode_full(value, type)
                                    : east_beast2_encode_v5(value, type, variants[v].codec, false);
                if (b) byte_buffer_free(b);
                iters++;
            } while (now_ms() - t0 < BUDGET_MS);
            double enc_ms = (now_ms() - t0) / (double)iters;

            /* decode timing */
            t0 = now_ms();
            iters = 0;
            do {
                EastValue *r = east_beast2_decode_full(enc_bytes, size, type);
                if (r) east_value_release(r);
                iters++;
            } while (now_ms() - t0 < BUDGET_MS);
            double dec_ms = (now_ms() - t0) / (double)iters;

            printf(", \"%s_size\": %zu, \"%s_enc\": %.6f, \"%s_dec\": %.6f", variants[v].label,
                   size, variants[v].label, enc_ms, variants[v].label, dec_ms);
            free(enc_bytes);
        }
        printf("}");
        fflush(stdout);

        east_value_release(value);
        east_type_release(type);
        free(blob);
    }
    printf("\n]\n");
    return 0;
}
