/*
 * FileSystem.openBeast on east-c-std (fs_open_beast<T>): the file maps and
 * opens as a FROZEN paged value whose keyed reads answer from the mapping
 * without hydrating; a header of another type is refused naming both types;
 * a missing file and a file that is not a beast2 container are loud; an
 * index-less file decodes whole, frozen; and the mapping dies with the value.
 * The std compliance corpus pins the VALUES against the other runtimes; this
 * gate pins the mechanism. Run under ASan/LSan via make leak-check (ctest in
 * the build-asan tree).
 */
#include <east/east.h>
#include <east/gc.h>
#include <east/type_of_type.h>
#include <east_std/east_std.h>

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <sys/mman.h>
#include <unistd.h>
#endif

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

/* ctest runs in the build tree; relative paths keep this portable. */
static const char *TABLE_PATH = "east_std_open_beast_table.beast2";
static const char *WHOLE_PATH = "east_std_open_beast_whole.beast2";
static const char *TEXT_PATH = "east_std_open_beast_text.txt";
static const char *MISSING_PATH = "east_std_open_beast_missing.beast2";

static int write_file(const char *path, const uint8_t *data, size_t len)
{
    FILE *f = fopen(path, "wb");
    if (!f) return 0;
    size_t written = fwrite(data, 1, len, f);
    return fclose(f) == 0 && written == len;
}

/* A Dict<Integer, String> of i -> "row-i". */
static EastValue *table_value(EastType *dt, size_t n)
{
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
    return dict;
}

static int write_fixtures(EastType *dt)
{
    EastValue *dict = table_value(dt, 300);
    /* Tiny segments: 300 rows over many segments, so a keyed read touches one. */
    ByteBuffer *paged = east_beast2_encode_paged(dict, dt, EAST_BEAST2_CODEC_DEFLATE, 64);
    ByteBuffer *whole = east_beast2_encode_full(dict, dt);
    east_value_release(dict);
    int ok = paged && whole && write_file(TABLE_PATH, paged->data, paged->len) &&
             write_file(WHOLE_PATH, whole->data, whole->len);
    const char *text = "not a beast2 container";
    ok = ok && write_file(TEXT_PATH, (const uint8_t *)text, strlen(text));
    if (paged) byte_buffer_free(paged);
    if (whole) byte_buffer_free(whole);
    return ok;
}

/* Calls fs_open_beast<type>(path) the way the evaluator does: through the
 * generic registry lookup, with the resolved T as the call's output type. */
static EvalResult call_open(PlatformRegistry *reg, EastType *type, const char *path)
{
    PlatformFn fn = platform_registry_get(reg, "fs_open_beast", (EastType *[]){type}, 1);
    CHECK(fn != NULL, "fs_open_beast is not registered");
    if (!fn) return eval_error("fs_open_beast unregistered");
    EastValue *arg = east_string(path);
    EastValue *args[1] = {arg};
    EvalResult r = fn(args, 1, (EastType *[]){&east_string_type}, 1, type);
    east_value_release(arg);
    return r;
}

static void test_paged_open(PlatformRegistry *reg, EastType *dt)
{
    EvalResult r = call_open(reg, dt, TABLE_PATH);
    CHECK(r.status == EVAL_OK, "open failed: %s", r.error_message ? r.error_message : "?");
    if (r.status != EVAL_OK || !r.value) {
        if (r.value) east_value_release(r.value);
        eval_result_free(&r);
        return;
    }
    EastValue *v = r.value;
    CHECK(v->kind == EAST_VAL_PAGED, "not a paged value: kind %d", (int)v->kind);
    CHECK(east_value_frozen(v), "opened value not frozen");
    if (v->kind != EAST_VAL_PAGED) {
        east_value_release(v);
        eval_result_free(&r);
        return;
    }
    CHECK(v->data.paged.release != NULL && !v->data.paged.owns_data && v->data.paged.owner == NULL,
          "the bytes are not a host-released mapping");
#ifndef _WIN32
    long page = sysconf(_SC_PAGESIZE);
    CHECK(page > 0 && ((uintptr_t)v->data.paged.data % (uintptr_t)page) == 0,
          "the bytes are not a page-aligned mapping");
#endif

    EastValue *key = east_integer(123);
    EastValue *missing = east_integer(9999);
    CHECK(east_dict_len(v) == 300, "paged length %zu", east_dict_len(v));
    CHECK(east_dict_has(v, key), "dict_has(123) false");
    CHECK(!east_dict_has(v, missing), "dict_has(9999) true");
    EastValue *row = NULL;
    CHECK(east_beast2_pages_get_key(v->data.paged.pages, key, &row) == 1, "keyed read miss");
    CHECK(row != NULL && row->kind == EAST_VAL_STRING &&
              strcmp(row->data.string.data, "row-123") == 0,
          "keyed read value wrong");
    if (row) east_value_release(row);
    east_value_release(key);
    east_value_release(missing);
    CHECK(v->data.paged.hydrated == NULL, "keyed reads hydrated the value");

#ifndef _WIN32
    /* The mapping dies with the value: once released, the range is no
     * longer mapped (msync reports ENOMEM for an unmapped range). */
    uint8_t *mapping = v->data.paged.data;
    size_t mapping_len = v->data.paged.len;
    r.value = NULL;
    east_value_release(v);
    errno = 0;
    int rc = msync(mapping, mapping_len, MS_ASYNC);
    CHECK(rc == -1 && errno == ENOMEM, "the mapping outlived the value (msync rc %d, errno %d)", rc,
          errno);
#else
    r.value = NULL;
    east_value_release(v);
#endif
    eval_result_free(&r);
}

static void test_refusals(PlatformRegistry *reg, EastType *dt)
{
    EastType *at = east_array_type(&east_integer_type);
    EvalResult mismatch = call_open(reg, at, TABLE_PATH);
    CHECK(mismatch.status == EVAL_ERROR, "a Dict file opened as an Array");
    CHECK(mismatch.error_message && strstr(mismatch.error_message, "Failed to open beast file") &&
              strstr(mismatch.error_message, "cannot open a blob of type"),
          "unexpected mismatch message: %s", mismatch.error_message ? mismatch.error_message : "?");
    eval_result_free(&mismatch);

    EvalResult missing = call_open(reg, dt, MISSING_PATH);
    CHECK(missing.status == EVAL_ERROR, "a missing file opened");
    CHECK(missing.error_message && strstr(missing.error_message, "Failed to open beast file"),
          "unexpected missing-file message: %s",
          missing.error_message ? missing.error_message : "?");
    eval_result_free(&missing);

    EvalResult text = call_open(reg, dt, TEXT_PATH);
    CHECK(text.status == EVAL_ERROR, "a text file opened as beast2");
    CHECK(text.error_message && strstr(text.error_message, "Failed to open beast file") &&
              strstr(text.error_message, "Invalid Beast2 magic at offset 0"),
          "unexpected text-file message: %s", text.error_message ? text.error_message : "?");
    eval_result_free(&text);
}

static void test_indexless_open(PlatformRegistry *reg, EastType *dt)
{
    EvalResult r = call_open(reg, dt, WHOLE_PATH);
    CHECK(r.status == EVAL_OK, "index-less open failed: %s",
          r.error_message ? r.error_message : "?");
    if (r.status == EVAL_OK && r.value) {
        CHECK(r.value->kind == EAST_VAL_DICT, "index-less file did not decode whole (kind %d)",
              (int)r.value->kind);
        CHECK(east_value_frozen(r.value), "whole decode not frozen");
        CHECK(east_dict_len(r.value) == 300, "whole length %zu", east_dict_len(r.value));
        east_value_release(r.value);
        r.value = NULL;
    }
    eval_result_free(&r);
}

int main(void)
{
    east_type_of_type_init();
    EastType *dt = east_dict_type(&east_integer_type, &east_string_type);
    if (!write_fixtures(dt)) {
        fprintf(stderr, "could not write the fixture files\n");
        return 1;
    }

    PlatformRegistry *reg = platform_registry_new();
    east_std_register_fs(reg);

    test_paged_open(reg, dt);
    test_refusals(reg, dt);
    test_indexless_open(reg, dt);

    platform_registry_free(reg);
    remove(TABLE_PATH);
    remove(WHOLE_PATH);
    remove(TEXT_PATH);
    east_gc_collect_full();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("fs_open_beast gate: all checks passed\n");
    return 0;
}
