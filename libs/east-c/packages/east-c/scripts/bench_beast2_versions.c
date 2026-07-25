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
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Directory listing: dirent.h is POSIX and MSVC does not ship it. */
#ifdef _WIN32
#include <windows.h>
#else
#include <dirent.h>
#endif

#define MAX_CASES 64
#define MAX_NAME 128

/* Collect the corpus case names (files called "<name>.v4.beast2", excluding
 * the "<name>.type.beast2" companions). Returns how many were found. */
static int list_cases(const char *dir, char names[MAX_CASES][MAX_NAME])
{
    int n = 0;
    const char *suffix_str = ".v4.beast2";
    const size_t suffix_len = 10;

#ifdef _WIN32
    char pattern[512];
    snprintf(pattern, sizeof pattern, "%.480s\\*.v4.beast2", dir);
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern, &fd);
    if (h == INVALID_HANDLE_VALUE) return 0;
    do {
        const char *found = strstr(fd.cFileName, suffix_str);
        if (!found || found[suffix_len] != '\0') continue;
        size_t base = (size_t)(found - fd.cFileName);
        if (base == 0 || base >= MAX_NAME) continue;
        memcpy(names[n], fd.cFileName, base);
        names[n][base] = '\0';
        n++;
    } while (n < MAX_CASES && FindNextFileA(h, &fd));
    FindClose(h);
#else
    DIR *d = opendir(dir);
    if (!d) return 0;
    struct dirent *ent;
    while (n < MAX_CASES && (ent = readdir(d))) {
        const char *found = strstr(ent->d_name, suffix_str);
        if (!found || found[suffix_len] != '\0') continue;
        size_t base = (size_t)(found - ent->d_name);
        if (base == 0 || base >= MAX_NAME) continue;
        memcpy(names[n], ent->d_name, base);
        names[n][base] = '\0';
        n++;
    }
    closedir(d);
#endif
    return n;
}

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

    char names[MAX_CASES][MAX_NAME];
    int n_names = list_cases(dir, names);
    if (n_names == 0) {
        fprintf(stderr, "no corpus cases found in %s\n", dir);
        return 1;
    }

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
