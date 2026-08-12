/*
 * Lazy paged collection value gate (issue #505).
 *
 * EAST_VAL_PAGED wraps an indexed beast2 v5 blob behind the Beast2Pages
 * reader: size, keyed get/has and iteration answer from the pager, and any
 * other operation hydrates the whole value once and delegates. This gate
 * proves the value kind end to end, with no CLI involved:
 *
 *   1. construction from a paged-encoded blob (and refusal of an
 *      index-less whole-value blob), plus the element shape gate: mutable-
 *      nested / identity-compared element types refuse to open lazily
 *      (#516) while the same bytes open under a value-semantic type;
 *   2. pager-served reads: array length + keyed dict get/has through the
 *      core accessors, without hydration;
 *   3. observational equivalence: compare/equal/print against the eager
 *      value hydrate on demand and agree;
 *   4. hydrate-once caching and post-hydration delegation;
 *   5. release of every state (never-hydrated, hydrated, GC-tracked).
 *
 * Run under ASan/LSan (run_leak_check.sh's build-asan configuration): the
 * wrapper owns the pager, the blob bytes and the hydrated child, and a
 * lifetime mistake in any of the three is exactly what this gate feeds the
 * sanitizer.
 */
#include <east/east.h>
#include <east/gc.h>
#include <east/type_of_type.h>

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

/* An Array<Integer> of 0..n-1, paged-encoded with tiny segments. Returns a
 * malloc'd copy of the wire bytes (open_paged takes ownership). */
static uint8_t *encode_int_array(size_t n, size_t *len_out)
{
    EastType *at = east_array_type(&east_integer_type);
    EastValue *arr = east_array_new(at->data.element);
    for (size_t i = 0; i < n; i++) {
        EastValue *v = east_integer((int64_t)i);
        east_array_push(arr, v);
        east_value_release(v);
    }
    ByteBuffer *buf = east_beast2_encode_paged(arr, at, EAST_BEAST2_CODEC_DEFLATE, 64);
    east_value_release(arr);
    if (!buf) return NULL;
    uint8_t *data = malloc(buf->len);
    memcpy(data, buf->data, buf->len);
    *len_out = buf->len;
    byte_buffer_free(buf);
    return data;
}

/* A Dict<Integer, String> of i -> "row-i", paged-encoded. */
static uint8_t *encode_int_dict(size_t n, size_t *len_out)
{
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *dict = east_dict_new(dt->data.dict.key, dt->data.dict.value);
    for (size_t i = 0; i < n; i++) {
        char name[32];
        snprintf(name, sizeof(name), "row-%zu", i);
        EastValue *k = east_integer((int64_t)i);
        EastValue *v = east_string(name);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    ByteBuffer *buf = east_beast2_encode_paged(dict, dt, EAST_BEAST2_CODEC_DEFLATE, 64);
    east_value_release(dict);
    if (!buf) return NULL;
    uint8_t *data = malloc(buf->len);
    memcpy(data, buf->data, buf->len);
    *len_out = buf->len;
    byte_buffer_free(buf);
    return data;
}

static void test_open_and_refuse(void)
{
    EastType *at = east_array_type(&east_integer_type);

    size_t len = 0;
    uint8_t *data = encode_int_array(100, &len);
    CHECK(data != NULL, "paged encode failed");
    if (!data) return;
    EastValue *paged = east_beast2_open_paged(data, len, at);
    CHECK(paged != NULL && paged->kind == EAST_VAL_PAGED, "open_paged failed");
    if (paged)
        east_value_release(paged);
    else
        free(data);

    /* A whole-value (index-less) v5 blob must be refused, with the caller
     * keeping ownership of the bytes. */
    EastValue *arr = east_array_new(at->data.element);
    EastValue *one = east_integer(1);
    east_array_push(arr, one);
    east_value_release(one);
    ByteBuffer *whole = east_beast2_encode_v5(arr, at, EAST_BEAST2_CODEC_NONE, false);
    east_value_release(arr);
    CHECK(whole != NULL, "whole encode failed");
    if (!whole) return;
    uint8_t *wdata = malloc(whole->len);
    memcpy(wdata, whole->data, whole->len);
    size_t wlen = whole->len;
    byte_buffer_free(whole);
    EastValue *refused = east_beast2_open_paged(wdata, wlen, at);
    CHECK(refused == NULL, "index-less blob unexpectedly opened");
    free(east_builtin_get_error());
    free(wdata); /* ownership stayed with us */
}

static void test_shape_gate(void)
{
    /* Mutable-nested element shapes must refuse to open lazily — a write
     * through a freshly decoded pager-served element would be dropped, so
     * the caller falls back to the eager decode (#516). */
    size_t len = 0;
    uint8_t *data = encode_int_dict(10, &len);
    CHECK(data != NULL, "paged encode failed");
    if (!data) return;

    EastType *xs_arr = east_array_type(&east_integer_type);
    EastType *row = east_struct_type((const char *[]){"xs"}, (EastType *[]){xs_arr}, 1);
    EastType *nested = east_dict_type(&east_integer_type, row);
    EastValue *refused = east_beast2_open_paged(data, len, nested);
    CHECK(refused == NULL, "mutable-nested element shape unexpectedly opened lazily");
    char *err = east_builtin_get_error();
    CHECK(err != NULL && strstr(err, "value-semantic element shapes") != NULL,
          "unexpected gate message: %s", err ? err : "(none)");
    free(err);

    /* Vector elements are identity-compared by `Is` — refused too. */
    EastType *vec_arr = east_array_type(east_vector_type(&east_float_type));
    EastValue *vec_refused = east_beast2_open_paged(data, len, vec_arr);
    CHECK(vec_refused == NULL, "vector element shape unexpectedly opened lazily");
    free(east_builtin_get_error());

    /* Ref elements inside a struct — refused. */
    EastType *ref_row = east_struct_type((const char *[]){"r"},
                                         (EastType *[]){east_ref_type(&east_integer_type)}, 1);
    EastValue *ref_refused = east_beast2_open_paged(data, len, east_array_type(ref_row));
    CHECK(ref_refused == NULL, "ref element shape unexpectedly opened lazily");
    free(east_builtin_get_error());

    /* The same bytes open fine under a value-semantic type (the gate is a
     * shape decision, not a bytes decision). */
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    EastValue *ok = east_beast2_open_paged(data, len, dt);
    CHECK(ok != NULL && ok->kind == EAST_VAL_PAGED, "value-semantic shape failed to open");
    if (ok)
        east_value_release(ok); /* owns data */
    else
        free(data);
}

static void test_pager_served_reads(void)
{
    EastType *at = east_array_type(&east_integer_type);
    size_t len = 0;
    uint8_t *data = encode_int_array(500, &len);
    EastValue *paged = east_beast2_open_paged(data, len, at);
    CHECK(paged != NULL, "open_paged failed");
    if (!paged) {
        free(data);
        return;
    }
    CHECK(east_array_len(paged) == 500, "paged length %zu", east_array_len(paged));
    CHECK(paged->data.paged.hydrated == NULL, "length read hydrated the value");
    east_value_release(paged);

    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    size_t dlen = 0;
    uint8_t *ddata = encode_int_dict(300, &dlen);
    EastValue *pdict = east_beast2_open_paged(ddata, dlen, dt);
    CHECK(pdict != NULL, "dict open_paged failed");
    if (!pdict) {
        free(ddata);
        return;
    }
    EastValue *key = east_integer(123);
    EastValue *missing = east_integer(9999);
    CHECK(east_dict_len(pdict) == 300, "paged dict length %zu", east_dict_len(pdict));
    CHECK(east_dict_has(pdict, key), "paged dict_has(123) false");
    CHECK(!east_dict_has(pdict, missing), "paged dict_has(9999) true");
    CHECK(pdict->data.paged.hydrated == NULL, "keyed reads hydrated the value");
    east_value_release(key);
    east_value_release(missing);
    east_value_release(pdict);
}

static void test_equivalence_and_hydration(void)
{
    EastType *at = east_array_type(&east_integer_type);
    size_t len = 0;
    uint8_t *data = encode_int_array(200, &len);
    EastValue *paged = east_beast2_open_paged(data, len, at);
    CHECK(paged != NULL, "open_paged failed");
    if (!paged) {
        free(data);
        return;
    }

    EastValue *eager = east_beast2_decode_full(data, len, at);
    CHECK(eager != NULL, "eager decode failed");

    /* compare/equal unpage internally — the paged value must equal its own
     * eager decode, hydrating on demand. */
    CHECK(east_value_equal(paged, eager), "paged != eager");
    CHECK(east_value_compare(paged, eager) == 0, "paged compare != 0");
    CHECK(paged->data.paged.hydrated != NULL, "equality did not hydrate");

    /* Hydration is cached, and post-hydration reads delegate to it. */
    EastValue *h1 = east_paged_hydrated(paged);
    EastValue *h2 = east_paged_hydrated(paged);
    CHECK(h1 == h2 && h1 == paged->data.paged.hydrated, "hydration not cached");
    CHECK(east_array_len(paged) == 200, "post-hydration length wrong");
    CHECK(east_array_get(paged, 42) == east_array_get(h1, 42),
          "post-hydration get does not delegate");

    if (eager) east_value_release(eager);
    east_value_release(paged);
}

/* A Dict<Integer, Struct{xs: Array<Integer>}> — the nested-container shape
 * the unfrozen gate refuses — paged-encoded with tiny segments. */
static uint8_t *encode_nested_dict(size_t n, EastType *nested, size_t *len_out)
{
    EastType *row_type = nested->data.dict.value;
    EastValue *dict = east_dict_new(nested->data.dict.key, row_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *xs = east_array_new(&east_integer_type);
        EastValue *elem = east_integer((int64_t)(i * 10));
        east_array_push(xs, elem);
        east_value_release(elem);
        const char *names[] = {"xs"};
        EastValue *vals[] = {xs};
        EastValue *row = east_struct_new(names, vals, 1, row_type);
        east_value_release(xs);
        EastValue *k = east_integer((int64_t)i);
        east_dict_set(dict, k, row);
        east_value_release(k);
        east_value_release(row);
    }
    ByteBuffer *buf = east_beast2_encode_paged(dict, nested, EAST_BEAST2_CODEC_DEFLATE, 64);
    east_value_release(dict);
    if (!buf) return NULL;
    uint8_t *data = malloc(buf->len);
    memcpy(data, buf->data, buf->len);
    *len_out = buf->len;
    byte_buffer_free(buf);
    return data;
}

static void test_frozen_open(void)
{
    /* The collapsed frozen gate (#539): a nested-container element shape the
     * unfrozen gate refuses opens frozen, serves frozen values from the
     * pager, refuses mutation, and hydrates frozen. */
    EastType *xs_arr = east_array_type(&east_integer_type);
    EastType *row = east_struct_type((const char *[]){"xs"}, (EastType *[]){xs_arr}, 1);
    EastType *nested = east_dict_type(&east_integer_type, row);

    size_t len = 0;
    uint8_t *data = encode_nested_dict(20, nested, &len);
    CHECK(data != NULL, "nested paged encode failed");
    if (!data) return;

    EastValue *unfrozen_refused = east_beast2_open_paged(data, len, nested);
    CHECK(unfrozen_refused == NULL, "nested shape unexpectedly opened without frozen");
    free(east_builtin_get_error());

    EastValue *frozen = east_beast2_open_paged_frozen(data, len, nested);
    CHECK(frozen != NULL && frozen->kind == EAST_VAL_PAGED, "frozen open failed");
    if (!frozen) {
        free(data);
        return;
    }
    CHECK(east_value_frozen(frozen), "frozen paged value not branded");

    /* Pager-served keyed read hands back frozen values without hydrating. */
    EastValue *key = east_integer(7);
    EastValue *out = NULL;
    CHECK(east_beast2_pages_get_key(frozen->data.paged.pages, key, &out) == 1, "keyed read miss");
    east_value_release(key);
    if (out) {
        EastValue *xs = east_struct_get_field(out, "xs");
        CHECK(xs != NULL && east_value_frozen(xs), "pager-served nested array not frozen");
        east_value_release(out);
    }
    CHECK(frozen->data.paged.hydrated == NULL, "keyed read hydrated the frozen value");

    /* Hydration inherits the brand, so the eager child refuses mutation too. */
    EastValue *h = east_paged_hydrated(frozen);
    CHECK(h != NULL && east_value_frozen(h), "frozen hydration lost the brand");
    if (h) {
        EastValue *hkey = east_integer(3);
        EastValue *hrow = east_dict_get(h, hkey);
        EastValue *hxs = hrow ? east_struct_get_field(hrow, "xs") : NULL;
        CHECK(hxs != NULL && east_value_frozen(hxs), "hydrated nested array not frozen");
        east_value_release(hkey);
    }
    east_value_release(frozen);

    /* Ref- and function-bearing shapes still refuse the frozen open. */
    size_t dlen = 0;
    uint8_t *ddata = encode_int_dict(5, &dlen);
    EastType *ref_row = east_struct_type((const char *[]){"r"},
                                         (EastType *[]){east_ref_type(&east_integer_type)}, 1);
    EastValue *ref_refused = east_beast2_open_paged_frozen(ddata, dlen, east_array_type(ref_row));
    CHECK(ref_refused == NULL, "Ref element shape unexpectedly opened frozen");
    free(east_builtin_get_error());

    /* Vector elements DO open frozen (value-typed under Is). */
    EastType *vec_arr = east_array_type(east_vector_type(&east_float_type));
    EastValue *vec_ok = east_beast2_open_paged_frozen(ddata, dlen, vec_arr);
    /* The bytes are a Dict blob, so the open may fail later on type grounds —
     * the SHAPE gate itself must not refuse. Either a paged value or a
     * non-gate error is acceptable; a gate message is not. */
    if (!vec_ok) {
        char *err = east_builtin_get_error();
        CHECK(err == NULL || strstr(err, "frozen lazy paged values need") == NULL,
              "vector shape hit the frozen gate: %s", err ? err : "(none)");
        free(err);
        free(ddata);
    } else {
        east_value_release(vec_ok);
    }
}

static void test_release_states(void)
{
    EastType *at = east_array_type(&east_integer_type);

    /* Never hydrated. */
    size_t len = 0;
    uint8_t *data = encode_int_array(50, &len);
    EastValue *p1 = east_beast2_open_paged(data, len, at);
    CHECK(p1 != NULL, "open failed");
    if (p1)
        east_value_release(p1);
    else
        free(data);

    /* Hydrated. */
    data = encode_int_array(50, &len);
    EastValue *p2 = east_beast2_open_paged(data, len, at);
    if (p2) {
        CHECK(east_paged_hydrated(p2) != NULL, "hydrate failed");
        east_value_release(p2);
    } else {
        free(data);
    }

    /* Alive across a forced full GC pass (the wrapper is a GC kind). */
    data = encode_int_array(50, &len);
    EastValue *p3 = east_beast2_open_paged(data, len, at);
    if (p3) {
        east_gc_collect_full();
        CHECK(east_array_len(p3) == 50, "paged value damaged by GC");
        east_value_release(p3);
    } else {
        free(data);
    }
}

int main(void)
{
    east_type_of_type_init();

    test_open_and_refuse();
    test_shape_gate();
    test_pager_served_reads();
    test_equivalence_and_hydration();
    test_frozen_open();
    test_release_states();

    east_gc_collect_full();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("paged value gate: all checks passed\n");
    return 0;
}
