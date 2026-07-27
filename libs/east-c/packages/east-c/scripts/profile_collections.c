/*
 * Beast2 collection encode/decode benchmark — pure C, no TS, no files.
 *
 * Builds large Dict and Set values directly with the east-c constructors,
 * encodes each to beast2 (timed), then decodes the encoded buffer (timed),
 * averaged over N iterations. Sweeps sizes to expose how encode/decode cost
 * scales with collection size for complex types.
 *
 * Build Release for representative numbers:
 *   cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
 *   cmake --build build-release --target profile_collections
 *   ./build-release/packages/east-c/profile_collections [iters]
 */
#include <east/east.h>
#include <east/serialization.h>
#include <east/type_of_type.h>
#include <east/types.h>

#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static EastType *option_type(EastType *inner)
{
    const char *names[2] = {"none", "some"};
    EastType *types[2] = {&east_null_type, inner};
    return east_variant_type(names, types, 2);
}

static double ms_since(struct timespec *a, struct timespec *b)
{
    return (b->tv_sec - a->tv_sec) * 1000.0 + (b->tv_nsec - a->tv_nsec) / 1e6;
}

/* Time encode + decode of value:type, `iters` each; print one row. */
static void bench(const char *label, EastValue *value, EastType *type, int iters)
{
    struct timespec t0, t1;

    ByteBuffer *blob = east_beast2_encode_full(value, type); /* warmup + size */
    size_t bytes = blob->len;
    byte_buffer_free(blob);

    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int i = 0; i < iters; i++) {
        ByteBuffer *b = east_beast2_encode_full(value, type);
        byte_buffer_free(b);
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double enc_ms = ms_since(&t0, &t1) / iters;

    blob = east_beast2_encode_full(value, type); /* one canonical buffer to decode */
    EastValue *warm = east_beast2_decode_auto(blob->data, blob->len);
    east_value_release(warm);

    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int i = 0; i < iters; i++) {
        EastValue *d = east_beast2_decode_auto(blob->data, blob->len);
        east_value_release(d);
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double dec_ms = ms_since(&t0, &t1) / iters;
    byte_buffer_free(blob);

    printf("  %-26s  %9zu  %11.3f  %11.3f\n", label, bytes, enc_ms, dec_ms);
    fflush(stdout);
}

int main(int argc, char **argv)
{
    int iters = argc > 1 ? atoi(argv[1]) : 3;
    const long sizes[] = {1000, 10000, 50000};
    const char *fnames[] = {"a", "b", "c"};

    east_type_of_type_init();

    printf("beast2 encode/decode (Release, %d iters, ms/call)\n", iters);
    printf("  %-26s  %9s  %11s  %11s\n", "case", "bytes", "encode", "decode");

    EastType *dict_sf = east_dict_type(&east_string_type, &east_float_type);
    EastType *set_int = east_set_type(&east_integer_type);

    for (size_t si = 0; si < sizeof(sizes) / sizeof(*sizes); si++) {
        long n = sizes[si];
        char label[64];

        /* Dict<String, Float> */
        EastValue *d = east_dict_new(&east_string_type, &east_float_type);
        for (long i = 0; i < n; i++) {
            char kbuf[24];
            snprintf(kbuf, sizeof kbuf, "key_%08ld", i);
            EastValue *k = east_string(kbuf);
            EastValue *v = east_float((double)i * 1.5);
            east_dict_set(d, k, v);
            east_value_release(k);
            east_value_release(v);
        }
        snprintf(label, sizeof label, "dict<str,float> n=%ld", n);
        bench(label, d, dict_sf, iters);
        east_value_release(d);

        /* Set<Integer> */
        EastValue *s = east_set_new(&east_integer_type);
        for (long i = 0; i < n; i++) {
            EastValue *e = east_integer(i);
            east_set_insert(s, e);
            east_value_release(e);
        }
        snprintf(label, sizeof label, "set<int> n=%ld", n);
        bench(label, s, set_int, iters);
        east_value_release(s);
    }

    /* Complex: Dict<String, Struct{a:int, b:float, c:string}> */
    EastType *ftypes[] = {&east_integer_type, &east_float_type, &east_string_type};
    EastType *row_t = east_struct_type(fnames, ftypes, 3);
    EastType *dict_struct = east_dict_type(&east_string_type, row_t);
    {
        long n = 10000;
        EastValue *d = east_dict_new(&east_string_type, row_t);
        for (long i = 0; i < n; i++) {
            char kbuf[24], cbuf[24];
            snprintf(kbuf, sizeof kbuf, "key_%08ld", i);
            snprintf(cbuf, sizeof cbuf, "v%ld", i);
            EastValue *k = east_string(kbuf);
            EastValue *fv[3] = {east_integer(i), east_float((double)i * 0.5), east_string(cbuf)};
            EastValue *row = east_struct_new(fnames, fv, 3, row_t);
            east_value_release(fv[0]);
            east_value_release(fv[1]);
            east_value_release(fv[2]);
            east_dict_set(d, k, row);
            east_value_release(k);
            east_value_release(row);
        }
        char label[64];
        snprintf(label, sizeof label, "dict<str,struct3> n=%ld", n);
        bench(label, d, dict_struct, iters);
        east_value_release(d);
    }

    /* A realistic dataset row: 14 fields, mixed types, one cell in five empty.
     * struct3 above understates the common case — a Dict/Array of wide structs
     * is what an East dataset actually is, and per-field costs scale with the
     * field count. */
    const char *wnames[] = {"id",  "sku",    "qty",    "price",  "cost",    "uom",  "lot",
                            "bin", "weight", "volume", "active", "updated", "note", "rank"};
    EastType *opt_f = option_type(&east_float_type);
    EastType *opt_s = option_type(&east_string_type);
    EastType *wtypes[] = {&east_string_type,
                          &east_string_type,
                          &east_integer_type,
                          &east_float_type,
                          &east_float_type,
                          &east_string_type,
                          opt_s,
                          opt_s,
                          opt_f,
                          opt_f,
                          &east_boolean_type,
                          &east_datetime_type,
                          &east_string_type,
                          &east_integer_type};
    EastType *wrow_t = east_struct_type(wnames, wtypes, 14);
    EastType *dict_wrow = east_dict_type(&east_string_type, wrow_t);
    EastType *arr_wrow = east_array_type(wrow_t);
    {
        long n = 10000;
        EastValue *d = east_dict_new(&east_string_type, wrow_t);
        EastValue *a = east_array_new_with_capacity(wrow_t, (size_t)n);
        for (long i = 0; i < n; i++) {
            char kbuf[24], sbuf[24], nbuf[40];
            snprintf(kbuf, sizeof kbuf, "key_%08ld", i);
            snprintf(sbuf, sizeof sbuf, "SKU-%06ld", i);
            snprintf(nbuf, sizeof nbuf, "line note %ld", i);
            EastValue *empty = east_null();
            EastValue *fv[14];
            fv[0] = east_string(kbuf);
            fv[1] = east_string(sbuf);
            fv[2] = east_integer(i);
            fv[3] = east_float((double)i * 0.5);
            fv[4] = east_float((double)i * 0.25);
            fv[5] = east_string("EA");
            /* One optional cell in five is empty, as in the table behind #423. */
            fv[6] = i % 5 == 0 ? east_variant_new("none", empty, opt_s)
                               : east_variant_new("some", fv[1], opt_s);
            fv[7] = i % 5 == 1 ? east_variant_new("none", empty, opt_s)
                               : east_variant_new("some", fv[5], opt_s);
            fv[8] = i % 5 == 2 ? east_variant_new("none", empty, opt_f)
                               : east_variant_new("some", fv[3], opt_f);
            fv[9] = i % 5 == 3 ? east_variant_new("none", empty, opt_f)
                               : east_variant_new("some", fv[4], opt_f);
            fv[10] = east_boolean(i % 2 == 0);
            fv[11] = east_datetime(1700000000000LL + i);
            fv[12] = east_string(nbuf);
            fv[13] = east_integer(i % 97);

            EastValue *row = east_struct_new(wnames, fv, 14, wrow_t);
            for (int f = 0; f < 14; f++)
                east_value_release(fv[f]);
            EastValue *k = east_string(kbuf);
            east_dict_set(d, k, row);
            east_array_push(a, row);
            east_value_release(k);
            east_value_release(row);
        }
        bench("dict<str,row14> n=10000", d, dict_wrow, iters);
        bench("array<row14> n=10000", a, arr_wrow, iters);
        east_value_release(d);
        east_value_release(a);
    }

    east_type_release(arr_wrow);
    east_type_release(dict_wrow);
    east_type_release(wrow_t);
    east_type_release(dict_struct);
    east_type_release(row_t);
    east_type_release(dict_sf);
    east_type_release(set_int);
    east_type_registry_clear();
    return 0;
}
