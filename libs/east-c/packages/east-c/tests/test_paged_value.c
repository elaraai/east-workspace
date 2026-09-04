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
#include <east/compiler.h>
#include <east/env.h>
#include <east/gc.h>
#include <east/ir.h>
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

/* The platform-call boundary (issue #621): by default a paged argument
 * hydrates whole before the platform function runs (kind-blind C
 * implementations read value union arms directly), and a registration that
 * declared serves_paged — the python bridge's dispatch — receives the paged
 * wrapper itself, un-hydrated, with the API accessors answering from the
 * pager. */
static EastValueKind plat_probe_seen_kind;

static EvalResult plat_probe(EastValue **args, size_t num_args, EastType **input_types,
                             size_t num_input_types, EastType *output_type)
{
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    plat_probe_seen_kind = (num_args > 0 && args[0]) ? args[0]->kind : EAST_VAL_NULL;
    /* east_dict_len is pager-served on a live paged value. */
    return eval_ok(east_integer((int64_t)east_dict_len(args[0])));
}

static void test_platform_boundary(void)
{
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);

    for (int paged_capable = 0; paged_capable < 2; paged_capable++) {
        size_t len = 0;
        uint8_t *data = encode_int_dict(300, &len);
        CHECK(data != NULL, "paged encode failed");
        if (!data) break;
        EastValue *paged = east_beast2_open_paged(data, len, dt);
        CHECK(paged != NULL, "open_paged failed");
        if (!paged) {
            free(data);
            break;
        }

        PlatformRegistry *platform = platform_registry_new();
        platform_registry_add_typed(platform, "probe", plat_probe, false, (EastType *[]){dt}, 1,
                                    &east_integer_type);
        if (paged_capable) platform_registry_set_serves_paged(platform, "probe", true);
        CHECK(platform_registry_serves_paged(platform, "probe") == (paged_capable != 0),
              "serves_paged flag readback wrong");

        IRNode *arg = ir_variable(dt, "d", false, false);
        IRNode *node =
            ir_platform(&east_integer_type, "probe", NULL, 0, (IRNode *[]){arg}, 1, false, false);
        ir_node_release(arg); /* the builder retained its own reference */
        Environment *env = env_new(NULL);
        env_set(env, "d", paged);

        plat_probe_seen_kind = EAST_VAL_NULL;
        EvalResult r = eval_ir(node, env, platform, builtins);
        CHECK(r.status == EVAL_OK, "platform eval failed: %s",
              r.error_message ? r.error_message : "(none)");
        CHECK(r.value && r.value->kind == EAST_VAL_INTEGER && r.value->data.integer == 300,
              "platform result wrong");
        if (paged_capable) {
            CHECK(plat_probe_seen_kind == EAST_VAL_PAGED, "serves_paged impl saw kind %d",
                  (int)plat_probe_seen_kind);
            CHECK(paged->data.paged.hydrated == NULL, "serves_paged call hydrated the argument");
        } else {
            CHECK(plat_probe_seen_kind == EAST_VAL_DICT, "default impl saw kind %d",
                  (int)plat_probe_seen_kind);
            CHECK(paged->data.paged.hydrated != NULL, "default call did not hydrate the argument");
        }

        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        env_release(env);
        ir_node_release(node);
        platform_registry_free(platform);
        east_value_release(paged);
    }
    builtin_registry_free(builtins);
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

/* The ownership modes of issue #658: a paged value that RETAINS the value
 * whose bytes it aliases (the blob.openBeast builtin's Blob), released after
 * the pager on every death path; and one whose bytes a host callback
 * releases (an mmap), fired exactly once — never on a failed open. */
static void test_owned_open(void)
{
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    size_t len = 0;
    uint8_t *data = encode_int_dict(300, &len);
    CHECK(data != NULL, "paged encode failed");
    if (!data) return;
    EastValue *blob = east_blob(data, len); /* copies the bytes */
    free(data);
    CHECK(blob != NULL, "blob alloc failed");
    if (!blob) return;

    for (int frozen = 0; frozen < 2; frozen++) {
        EastValue *paged = east_beast2_open_paged_owned(blob, blob->data.blob.data,
                                                        blob->data.blob.len, dt, frozen != 0);
        CHECK(paged != NULL && paged->kind == EAST_VAL_PAGED, "owned open failed (frozen=%d)",
              frozen);
        if (!paged) continue;
        CHECK(blob->ref_count == 2, "owner not retained: ref_count %d", blob->ref_count);
        CHECK(paged->data.paged.owner == blob && !paged->data.paged.owns_data &&
                  paged->data.paged.release == NULL,
              "owned mode fields wrong");
        CHECK(east_value_frozen(paged) == (frozen != 0), "frozen brand wrong (frozen=%d)", frozen);

        EastValue *key = east_integer(123);
        CHECK(east_dict_has(paged, key), "owned keyed read miss");
        east_value_release(key);
        CHECK(paged->data.paged.hydrated == NULL, "keyed read hydrated the owned value");

        EastValue *h = east_paged_hydrated(paged);
        CHECK(h != NULL && east_dict_len(h) == 300, "owned hydration failed");
        CHECK(h == NULL || east_value_frozen(h) == (frozen != 0), "hydrated brand wrong");
        east_value_release(paged);
        CHECK(blob->ref_count == 1, "owner not released: ref_count %d", blob->ref_count);
    }

    /* Everything above read through the Blob's bytes without touching them:
     * the paged encode is deterministic, so a fresh encode is the oracle. */
    size_t again_len = 0;
    uint8_t *again = encode_int_dict(300, &again_len);
    CHECK(again != NULL && again_len == blob->data.blob.len &&
              memcmp(again, blob->data.blob.data, again_len) == 0,
          "owner bytes damaged");
    free(again);

    /* A failed open retains nothing: a Ref-bearing shape is gated even frozen. */
    EastType *ref_row = east_struct_type((const char *[]){"r"},
                                         (EastType *[]){east_ref_type(&east_integer_type)}, 1);
    EastValue *refused = east_beast2_open_paged_owned(
        blob, blob->data.blob.data, blob->data.blob.len, east_array_type(ref_row), true);
    CHECK(refused == NULL, "gated shape unexpectedly opened owned");
    free(east_builtin_get_error());
    CHECK(blob->ref_count == 1, "failed owned open retained the owner");
    CHECK(east_beast2_open_paged_owned(NULL, blob->data.blob.data, blob->data.blob.len, dt,
                                       false) == NULL,
          "owned open without an owner");
    free(east_builtin_get_error());
    east_value_release(blob);
}

typedef struct {
    int calls;
    uint8_t *data;
    size_t len;
} ReleaseProbe;

static void release_probe(void *ctx, uint8_t *data, size_t len)
{
    ReleaseProbe *p = (ReleaseProbe *)ctx;
    p->calls++;
    p->data = data;
    p->len = len;
    free(data); /* the test's malloc'd bytes — an mmap would munmap here */
}

static void test_external_open(void)
{
    EastType *at = east_array_type(&east_integer_type);
    size_t len = 0;
    uint8_t *data = encode_int_array(500, &len);
    CHECK(data != NULL, "paged encode failed");
    if (!data) return;
    ReleaseProbe probe = {0, NULL, 0};
    EastValue *paged = east_beast2_open_paged_external(data, len, at, true, release_probe, &probe);
    CHECK(paged != NULL && paged->kind == EAST_VAL_PAGED, "external open failed");
    if (!paged) {
        free(data);
        return;
    }
    CHECK(!paged->data.paged.owns_data && paged->data.paged.release == release_probe &&
              paged->data.paged.release_ctx == &probe && paged->data.paged.owner == NULL,
          "external mode fields wrong");
    CHECK(east_value_frozen(paged), "external frozen open not branded");
    CHECK(east_array_len(paged) == 500, "external length %zu", east_array_len(paged));
    CHECK(probe.calls == 0, "release fired before the value died");
    EastValue *h = east_paged_hydrated(paged);
    CHECK(h != NULL && east_value_frozen(h) && east_array_len(h) == 500, "external hydration");
    east_value_release(paged);
    CHECK(probe.calls == 1 && probe.data == data && probe.len == len,
          "release fired %d time(s) with (%p, %zu)", probe.calls, (void *)probe.data, probe.len);

    /* A gated shape never fires the callback and leaves the bytes ours. */
    size_t glen = 0;
    uint8_t *gdata = encode_int_array(5, &glen);
    ReleaseProbe gprobe = {0, NULL, 0};
    EastType *ref_row = east_struct_type((const char *[]){"r"},
                                         (EastType *[]){east_ref_type(&east_integer_type)}, 1);
    EastValue *refused = east_beast2_open_paged_external(gdata, glen, east_array_type(ref_row),
                                                         true, release_probe, &gprobe);
    CHECK(refused == NULL, "gated shape unexpectedly opened external");
    free(east_builtin_get_error());
    CHECK(gprobe.calls == 0, "release fired on a gated open");
    free(gdata);

    /* Nor does a blob that is not pageable (index-less whole-value v5). */
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
    ReleaseProbe wprobe = {0, NULL, 0};
    EastValue *unpaged =
        east_beast2_open_paged_external(wdata, wlen, at, false, release_probe, &wprobe);
    CHECK(unpaged == NULL, "index-less blob unexpectedly opened external");
    free(east_builtin_get_error());
    CHECK(wprobe.calls == 0, "release fired on an unpageable open");

    /* And a missing callback is refused up front, before the bytes are read. */
    CHECK(east_beast2_open_paged_external(wdata, wlen, at, false, NULL, NULL) == NULL,
          "external open without a callback");
    free(east_builtin_get_error());
    free(wdata);
}

static void test_release_modes_under_gc(void)
{
    /* A paged value reachable only through a reference cycle dies in the
     * collector's destroy path, which must honour the ownership modes just
     * like the refcount path: the owner is released, the callback fires
     * exactly once. */
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    size_t len = 0;
    uint8_t *data = encode_int_dict(50, &len);
    CHECK(data != NULL, "paged encode failed");
    if (!data) return;
    EastValue *blob = east_blob(data, len);
    free(data);
    EastValue *paged =
        east_beast2_open_paged_owned(blob, blob->data.blob.data, blob->data.blob.len, dt, false);
    CHECK(paged != NULL, "owned open failed");
    if (!paged) {
        east_value_release(blob);
        return;
    }
    EastValue *cycle = east_array_new(NULL);
    east_array_push(cycle, paged);
    east_array_push(cycle, cycle); /* self-reference: garbage once our refs drop */
    east_value_release(paged);
    east_value_release(cycle);
    CHECK(blob->ref_count == 2, "owner not held while the cycle is alive");
    east_gc_collect_full();
    CHECK(blob->ref_count == 1, "collector did not release the owner: ref_count %d",
          blob->ref_count);
    east_value_release(blob);

    EastType *at = east_array_type(&east_integer_type);
    size_t elen = 0;
    uint8_t *edata = encode_int_array(50, &elen);
    CHECK(edata != NULL, "paged encode failed");
    if (!edata) return;
    ReleaseProbe probe = {0, NULL, 0};
    EastValue *ext = east_beast2_open_paged_external(edata, elen, at, false, release_probe, &probe);
    CHECK(ext != NULL, "external open failed");
    if (!ext) {
        free(edata);
        return;
    }
    EastValue *cycle2 = east_array_new(NULL);
    east_array_push(cycle2, ext);
    east_array_push(cycle2, cycle2);
    east_value_release(ext);
    east_value_release(cycle2);
    CHECK(probe.calls == 0, "release fired before collection");
    east_gc_collect_full();
    CHECK(probe.calls == 1, "collector fired release %d time(s)", probe.calls);
}

/* The blob.openBeast builtin (issue #659), invoked through the registry the
 * way the evaluator does: an indexed v5 collection Blob opens as a FROZEN
 * paged value that retains the Blob and answers keyed reads from the pager;
 * a v5 header of another type is refused, naming both types; an index-less
 * blob and a gated (Ref-bearing) element shape decode whole, frozen. */
static void test_open_beast_builtin(void)
{
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);

    size_t len = 0;
    uint8_t *data = encode_int_dict(300, &len);
    CHECK(data != NULL, "paged encode failed");
    if (!data) {
        builtin_registry_free(builtins);
        return;
    }
    EastValue *blob = east_blob(data, len);
    free(data);
    EastValue *args[1] = {blob};

    BuiltinImpl open = builtin_registry_get(builtins, "BlobOpenBeast2", (EastType *[]){dt}, 1);
    CHECK(open != NULL, "BlobOpenBeast2 is not registered");
    EastValue *paged = open ? open(args, 1) : NULL;
    if (!paged) {
        char *err = east_builtin_get_error();
        CHECK(false, "openBeast failed: %s", err ? err : "(none)");
        free(err);
    } else {
        CHECK(paged->kind == EAST_VAL_PAGED, "openBeast did not page (kind %d)", (int)paged->kind);
        CHECK(east_value_frozen(paged), "openBeast result not frozen");
        CHECK(paged->kind == EAST_VAL_PAGED && paged->data.paged.owner == blob &&
                  blob->ref_count == 2,
              "openBeast did not retain the Blob (ref_count %d)", blob->ref_count);
        EastValue *key = east_integer(42);
        CHECK(east_dict_has(paged, key), "keyed read miss");
        east_value_release(key);
        CHECK(paged->kind != EAST_VAL_PAGED || paged->data.paged.hydrated == NULL,
              "keyed read hydrated the opened value");
        east_value_release(paged);
        CHECK(blob->ref_count == 1, "Blob not released with the paged value");
    }

    /* A v5 header of another type is refused, naming both types. */
    EastType *at = east_array_type(&east_integer_type);
    BuiltinImpl open_as_array =
        builtin_registry_get(builtins, "BlobOpenBeast2", (EastType *[]){at}, 1);
    EastValue *refused = open_as_array ? open_as_array(args, 1) : NULL;
    CHECK(refused == NULL, "openBeast opened a Dict blob as an Array");
    if (refused) east_value_release(refused);
    char *err = east_builtin_get_error();
    CHECK(err != NULL && strstr(err, "cannot open a blob of type") != NULL,
          "unexpected mismatch message: %s", err ? err : "(none)");
    free(err);
    CHECK(blob->ref_count == 1, "a refused open retained the Blob");
    east_value_release(blob);

    /* An index-less blob decodes whole, frozen. */
    EastValue *dict = east_dict_new(dt->data.dict.key, dt->data.dict.value);
    EastValue *k = east_integer(1);
    EastValue *v = east_string("one");
    east_dict_set(dict, k, v);
    east_value_release(k);
    east_value_release(v);
    ByteBuffer *whole = east_beast2_encode_full(dict, dt);
    east_value_release(dict);
    CHECK(whole != NULL, "whole encode failed");
    if (whole) {
        EastValue *wblob = east_blob(whole->data, whole->len);
        byte_buffer_free(whole);
        EastValue *wargs[1] = {wblob};
        BuiltinImpl open_whole =
            builtin_registry_get(builtins, "BlobOpenBeast2", (EastType *[]){dt}, 1);
        EastValue *eager = open_whole ? open_whole(wargs, 1) : NULL;
        CHECK(eager != NULL && eager->kind == EAST_VAL_DICT && east_value_frozen(eager) &&
                  east_dict_len(eager) == 1,
              "index-less open did not decode whole and frozen");
        if (eager) east_value_release(eager);
        east_value_release(wblob);
    }

    /* A Ref-bearing element shape (gated even frozen) decodes whole, frozen. */
    EastType *ref_row = east_struct_type((const char *[]){"r"},
                                         (EastType *[]){east_ref_type(&east_integer_type)}, 1);
    EastType *rt = east_dict_type(&east_integer_type, ref_row);
    EastValue *cells = east_dict_new(rt->data.dict.key, rt->data.dict.value);
    for (size_t i = 0; i < 20; i++) {
        EastValue *inner = east_integer((int64_t)(i * 10));
        EastValue *cell = east_ref_new(inner);
        east_value_release(inner);
        const char *names[] = {"r"};
        EastValue *vals[] = {cell};
        EastValue *row = east_struct_new(names, vals, 1, ref_row);
        east_value_release(cell);
        EastValue *rk = east_integer((int64_t)i);
        east_dict_set(cells, rk, row);
        east_value_release(rk);
        east_value_release(row);
    }
    ByteBuffer *rbuf = east_beast2_encode_paged(cells, rt, EAST_BEAST2_CODEC_DEFLATE, 64);
    east_value_release(cells);
    CHECK(rbuf != NULL, "ref paged encode failed");
    if (rbuf) {
        EastValue *rblob = east_blob(rbuf->data, rbuf->len);
        byte_buffer_free(rbuf);
        EastValue *rargs[1] = {rblob};
        BuiltinImpl open_refs =
            builtin_registry_get(builtins, "BlobOpenBeast2", (EastType *[]){rt}, 1);
        EastValue *rwhole = open_refs ? open_refs(rargs, 1) : NULL;
        CHECK(rwhole != NULL && rwhole->kind == EAST_VAL_DICT && east_value_frozen(rwhole) &&
                  east_dict_len(rwhole) == 20,
              "gated shape did not decode whole and frozen");
        if (rwhole) {
            EastValue *k3 = east_integer(3);
            EastValue *row = east_dict_get(rwhole, k3);
            EastValue *cell = row ? east_struct_get_field(row, "r") : NULL;
            EastValue *held = cell ? east_ref_get(cell) : NULL;
            CHECK(held != NULL && held->kind == EAST_VAL_INTEGER && held->data.integer == 30,
                  "ref element value wrong");
            east_value_release(k3);
            east_value_release(rwhole);
        }
        east_value_release(rblob);
    }
    builtin_registry_free(builtins);
}

int main(void)
{
    east_type_of_type_init();

    test_open_and_refuse();
    test_shape_gate();
    test_pager_served_reads();
    test_equivalence_and_hydration();
    test_frozen_open();
    test_platform_boundary();
    test_release_states();
    test_owned_open();
    test_external_open();
    test_release_modes_under_gc();
    test_open_beast_builtin();

    east_gc_collect_full();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("paged value gate: all checks passed\n");
    return 0;
}
