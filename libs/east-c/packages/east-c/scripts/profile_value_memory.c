/*
 * Live-footprint profiler for East values — pure C, no TS, no files.
 *
 * Builds one large collection per value shape and reports the bytes each
 * element costs, three ways: `nodes` is what the value slab holds (value nodes
 * only — not the malloc'd item arrays, btree nodes or long string buffers),
 * `reserved` is what the slab has taken from the OS, and `rss` is the process
 * delta, which counts everything. `rss` is the column comparable with issue
 * #423, whose Array shapes and pre-#423 baselines are reproduced below; the
 * Set/Dict/Struct shapes extend it to the other collection types.
 *
 * Build Release for representative numbers:
 *   cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
 *   cmake --build build-release --target profile_value_memory
 *   ./build-release/packages/east-c/profile_value_memory [n]
 */
#include <east/east.h>
#include <east/types.h>
#include <east/value_slab.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef __linux__
#include <unistd.h>
#endif

/* Resident set size in bytes, or 0 where the platform does not expose it
 * cheaply (everything but Linux here — the slab column still works). */
static size_t rss_bytes(void)
{
#ifdef __linux__
    FILE *f = fopen("/proc/self/statm", "r");
    if (!f) return 0;
    unsigned long total_pages = 0, resident_pages = 0;
    int read = fscanf(f, "%lu %lu", &total_pages, &resident_pages);
    fclose(f);
    if (read != 2) return 0;
    return (size_t)resident_pages * (size_t)sysconf(_SC_PAGESIZE);
#else
    return 0;
#endif
}

typedef EastValue *(*ElementFn)(long i, void *ctx);

/* Every array built stays alive to the end of the run. Freeing one would let
 * the next shape reuse its pages, and the RSS delta would stop being
 * attributable — the issue measured a fresh process per shape for the same
 * reason. Pass a smaller n if the total is too large for the machine. */
#define MAX_SHAPES 16
static EastValue *g_kept[MAX_SHAPES];
static size_t g_kept_len = 0;

static void bench(const char *label, ElementFn make, void *ctx, EastType *elem_type, long n,
                  double baseline)
{
    size_t slab_before = east_value_slab_stats().bytes_live;
    size_t reserved_before = east_value_slab_stats().bytes_reserved;
    size_t rss_before = rss_bytes();

    EastValue *arr = east_array_new_with_capacity(elem_type, (size_t)n);
    for (long i = 0; i < n; i++) {
        EastValue *e = make(i, ctx);
        east_array_push(arr, e);
        east_value_release(e);
    }

    size_t slab_after = east_value_slab_stats().bytes_live;
    size_t reserved_after = east_value_slab_stats().bytes_reserved;
    size_t rss_after = rss_bytes();

    double slab_per = (double)(slab_after - slab_before) / (double)n;
    double rss_per = rss_after > rss_before ? (double)(rss_after - rss_before) / (double)n : 0.0;
    double reserved_per = (double)(reserved_after - reserved_before) / (double)n;

    if (rss_per > 0.0)
        printf("  %-42s %10.1f %10.1f %10.1f %10.1f\n", label, baseline, slab_per, reserved_per,
               rss_per);
    else
        printf("  %-42s %10.1f %10.1f %10.1f %10s\n", label, baseline, slab_per, reserved_per,
               "n/a");
    fflush(stdout);

    g_kept[g_kept_len++] = arr;
}

typedef struct {
    EastType *row_type;
    EastType *opt_float;
    const char **names;
} RowCtx;

static EastValue *make_row(long i, void *ctx)
{
    RowCtx *rc = (RowCtx *)ctx;
    EastValue *vals[5];
    for (int f = 0; f < 5; f++) {
        EastValue *num = east_float((double)(i + f));
        vals[f] = east_variant_new("some", num, rc->opt_float);
        east_value_release(num);
    }
    EastValue *row = east_struct_new(rc->names, vals, 5, rc->row_type);
    for (int f = 0; f < 5; f++)
        east_value_release(vals[f]);
    return row;
}

typedef EastValue *(*BuildFn)(long n, void *ctx);

static void bench_built(const char *label, BuildFn build, void *ctx, long n, double baseline)
{
    size_t slab_before = east_value_slab_stats().bytes_live;
    size_t reserved_before = east_value_slab_stats().bytes_reserved;
    size_t rss_before = rss_bytes();

    EastValue *c = build(n, ctx);

    size_t slab_after = east_value_slab_stats().bytes_live;
    size_t reserved_after = east_value_slab_stats().bytes_reserved;
    size_t rss_after = rss_bytes();

    double slab_per = (double)(slab_after - slab_before) / (double)n;
    double reserved_per = (double)(reserved_after - reserved_before) / (double)n;
    double rss_per = rss_after > rss_before ? (double)(rss_after - rss_before) / (double)n : 0.0;

    if (rss_per > 0.0)
        printf("  %-42s %10s %10.1f %10.1f %10.1f\n", label, "-", slab_per, reserved_per, rss_per);
    else
        printf("  %-42s %10s %10.1f %10.1f %10s\n", label, "-", slab_per, reserved_per, "n/a");
    fflush(stdout);

    g_kept[g_kept_len++] = c;
}

static EastValue *build_set_int(long n, void *ctx)
{
    (void)ctx;
    EastValue *s = east_set_new(&east_integer_type);
    for (long i = 0; i < n; i++) {
        EastValue *e = east_integer(i);
        east_set_insert(s, e);
        east_value_release(e);
    }
    return s;
}

static EastValue *build_set_string(long n, void *ctx)
{
    (void)ctx;
    EastValue *s = east_set_new(&east_string_type);
    char buf[32];
    for (long i = 0; i < n; i++) {
        snprintf(buf, sizeof(buf), "key-%ld", i);
        EastValue *e = east_string(buf);
        east_set_insert(s, e);
        east_value_release(e);
    }
    return s;
}

static EastValue *build_dict_str_float(long n, void *ctx)
{
    (void)ctx;
    EastValue *d = east_dict_new(&east_string_type, &east_float_type);
    char buf[32];
    for (long i = 0; i < n; i++) {
        snprintf(buf, sizeof(buf), "key-%ld", i);
        EastValue *k = east_string(buf);
        EastValue *v = east_float((double)i);
        east_dict_set(d, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return d;
}

static EastValue *build_dict_str_row(long n, void *ctx)
{
    RowCtx *rc = (RowCtx *)ctx;
    EastValue *d = east_dict_new(&east_string_type, rc->row_type);
    char buf[32];
    for (long i = 0; i < n; i++) {
        snprintf(buf, sizeof(buf), "key-%ld", i);
        EastValue *k = east_string(buf);
        EastValue *row = make_row(i, rc);
        east_dict_set(d, k, row);
        east_value_release(k);
        east_value_release(row);
    }
    return d;
}

static EastValue *make_integer(long i, void *ctx)
{
    (void)ctx;
    return east_integer(i);
}

static EastValue *make_none(long i, void *ctx)
{
    (void)i;
    return east_variant_new("none", east_null(), (EastType *)ctx);
}

static EastValue *make_string(long i, void *ctx)
{
    (void)i;
    return east_string((const char *)ctx);
}

static EastValue *make_some_string(long i, void *ctx)
{
    (void)i;
    EastType *opt = (EastType *)ctx;
    EastValue *s = east_string("0.00");
    EastValue *v = east_variant_new("some", s, opt);
    east_value_release(s);
    return v;
}

static EastType *option_of(EastType *inner)
{
    const char *names[2] = {"none", "some"};
    EastType *types[2] = {&east_null_type, inner};
    return east_variant_type(names, types, 2);
}

int main(int argc, char **argv)
{
    long n = argc > 1 ? atol(argv[1]) : 500000;

    east_type_of_type_init();

    printf("value footprint, %ld elements per shape (bytes per element)\n", n);
    printf("  %-42s %10s %10s %10s %10s\n", "shape", "pre-#423", "nodes", "reserved", "rss");

    EastType *opt_int = option_of(&east_integer_type);
    EastType *opt_str = option_of(&east_string_type);

    char long_str[41];
    memset(long_str, 'x', sizeof(long_str) - 1);
    long_str[sizeof(long_str) - 1] = '\0';

    bench("Array<Integer>", make_integer, NULL, &east_integer_type, n, 112.1);
    bench("Array<Option<Integer>> (all none)", make_none, opt_int, opt_int, n, 112.3);
    bench("Array<String> 4 chars", make_string, (void *)"0.00", &east_string_type, n, 144.2);
    bench("Array<String> 40 chars", make_string, long_str, &east_string_type, n, 176.2);
    bench("Array<Option<String>> 4 chars", make_some_string, opt_str, opt_str, n, 248.4);

    const char *fnames[5] = {"a", "b", "c", "d", "e"};
    EastType *opt_float = option_of(&east_float_type);
    EastType *ftypes[5] = {opt_float, opt_float, opt_float, opt_float, opt_float};
    EastType *row_type = east_struct_type(fnames, ftypes, 5);
    RowCtx rc = {row_type, opt_float, fnames};
    bench("Array<Struct<5x Option<Float>>>", make_row, &rc, row_type, n / 5, 1410.3);

    /* The other collection kinds. #423 measured only Arrays, but a Set or Dict
     * stores the same element nodes, so they carry the same win — and a Struct
     * value additionally stops copying its field names. */
    bench_built("Set<Integer>", build_set_int, NULL, n, 0);
    bench_built("Set<String> 9 chars", build_set_string, NULL, n, 0);
    bench_built("Dict<String, Float>", build_dict_str_float, NULL, n, 0);
    bench_built("Dict<String, Struct<5x Option<Float>>>", build_dict_str_row, &rc, n / 5, 0);

    for (size_t i = 0; i < g_kept_len; i++)
        east_value_release(g_kept[i]);
    east_value_slab_drain();
    east_type_registry_clear();
    return 0;
}
