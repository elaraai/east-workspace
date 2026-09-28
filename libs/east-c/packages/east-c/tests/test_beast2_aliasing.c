/*
 * Aliasing in a segmented collection is scoped per root element, pinned
 * across runtimes.
 *
 * An element's bytes must depend on that element alone — never on which
 * objects it shares with its neighbours — here, in TypeScript
 * (`east/src/serialization/beast2/v5/aliasing.spec.ts`) and in east-py, which
 * binds this encoder. That is what lets an encoded element be sorted, merged
 * and re-cut by byte copy, and a collection built one way hash the same as one
 * built another.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/serialization.h>

#include <inttypes.h>
#include <stdbool.h>
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

/* The digest the TypeScript encoder produces for the shared-value Dict below,
 * written with codec `none` (deflate output is not byte-identical across zlib
 * builds): fnv1a64 over the whole blob. */
#define SHARED_DICT_DIGEST "d5a98a7fcc1c03cb"

/* An `Array<Integer>` holding `values`. */
static EastValue *int_array(const int64_t *values, size_t n)
{
    EastValue *arr = east_array_new(&east_integer_type);
    for (size_t i = 0; i < n; i++) {
        EastValue *v = east_integer(values[i]);
        east_array_push(arr, v);
        east_value_release(v);
    }
    return arr;
}

/* `Dict<String, Array<Integer>>` of keys "a", "b", "c": one array object under
 * every key when `shared`, otherwise a copy per key. */
static EastValue *tags_by_name(bool shared)
{
    static const int64_t tags[] = {1, 2, 3};
    static const char *keys[] = {"a", "b", "c"};
    EastValue *dict = east_dict_new(&east_string_type, NULL);
    EastValue *one = int_array(tags, 3);
    for (size_t i = 0; i < 3; i++) {
        EastValue *k = east_string(keys[i]);
        EastValue *v = shared ? one : int_array(tags, 3);
        east_dict_set(dict, k, v);
        east_value_release(k);
        if (!shared) east_value_release(v);
    }
    east_value_release(one);
    return dict;
}

static bool same_bytes(ByteBuffer *a, ByteBuffer *b)
{
    return a && b && a->len == b->len && memcmp(a->data, b->data, a->len) == 0;
}

/* The fixture TypeScript pins: the Dict whose three values are one array. */
static void test_shared_dict_parity(void)
{
    EastType *tags = east_array_type(&east_integer_type);
    EastType *type = east_dict_type(&east_string_type, tags);
    EastValue *dict = tags_by_name(true);

    ByteBuffer *blob = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_NONE);
    CHECK(blob != NULL, "paged encode failed: %s", east_builtin_get_error());
    if (blob) {
        char digest[32];
        snprintf(digest, sizeof(digest), "%016" PRIx64, east_beast2_fnv1a64(blob->data, blob->len));
        CHECK(strcmp(digest, SHARED_DICT_DIGEST) == 0,
              "shared-value Dict encodes differently from TypeScript: digest %s (expected %s)",
              digest, SHARED_DICT_DIGEST);
        byte_buffer_free(blob);
    }

    east_value_release(dict);
    east_type_release(type);
    east_type_release(tags);
}

/* Sharing between elements encodes as if each held its own copy — through
 * the paged encoder and the indexed whole-value encode alike. */
static void test_dict_sharing_is_content(void)
{
    EastType *tags = east_array_type(&east_integer_type);
    EastType *type = east_dict_type(&east_string_type, tags);
    EastValue *shared = tags_by_name(true);
    EastValue *copies = tags_by_name(false);

    ByteBuffer *a = east_beast2_encode_paged(shared, type, EAST_BEAST2_CODEC_DEFLATE);
    ByteBuffer *b = east_beast2_encode_paged(copies, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(same_bytes(a, b), "paged: a Dict whose values share an array encodes differently "
                            "from one holding copies");
    byte_buffer_free(a);
    byte_buffer_free(b);

    a = east_beast2_encode_v5(shared, type, EAST_BEAST2_CODEC_NONE, true);
    b = east_beast2_encode_v5(copies, type, EAST_BEAST2_CODEC_NONE, true);
    CHECK(same_bytes(a, b), "indexed: a Dict whose values share an array encodes differently "
                            "from one holding copies");
    byte_buffer_free(a);
    byte_buffer_free(b);

    east_value_release(shared);
    east_value_release(copies);
    east_type_release(type);
    east_type_release(tags);
}

static void test_array_sharing_is_content(void)
{
    static const int64_t inner_values[] = {4, 5};
    EastType *inner_type = east_array_type(&east_integer_type);
    EastType *type = east_array_type(inner_type);
    EastValue *inner = int_array(inner_values, 2);
    EastValue *shared = east_array_new(inner_type);
    EastValue *copies = east_array_new(inner_type);
    for (int i = 0; i < 3; i++) {
        east_array_push(shared, inner);
        EastValue *copy = int_array(inner_values, 2);
        east_array_push(copies, copy);
        east_value_release(copy);
    }

    ByteBuffer *a = east_beast2_encode_paged(shared, type, EAST_BEAST2_CODEC_DEFLATE);
    ByteBuffer *b = east_beast2_encode_paged(copies, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(same_bytes(a, b), "an Array whose elements are one array encodes differently from "
                            "one holding copies");
    byte_buffer_free(a);
    byte_buffer_free(b);

    east_value_release(shared);
    east_value_release(copies);
    east_value_release(inner);
    east_type_release(type);
    east_type_release(inner_type);
}

/* The two fields of one element that are one array decode as one array. */
static void test_sharing_inside_an_element(void)
{
    static const int64_t values[] = {9};
    EastType *tags = east_array_type(&east_integer_type);
    const char *names[] = {"left", "right"};
    EastType *field_types[] = {tags, tags};
    EastType *pair = east_struct_type(names, field_types, 2);
    EastType *type = east_array_type(pair);

    EastValue *one = int_array(values, 1);
    EastValue *fields[] = {one, one};
    EastValue *element = east_struct_new(names, fields, 2, pair);
    EastValue *pairs = east_array_new(pair);
    east_array_push(pairs, element);

    ByteBuffer *blob = east_beast2_encode_paged(pairs, type, EAST_BEAST2_CODEC_NONE);
    CHECK(blob != NULL, "paged encode failed: %s", east_builtin_get_error());
    if (blob) {
        EastValue *decoded = east_beast2_decode_full(blob->data, blob->len, type);
        CHECK(decoded != NULL, "decode failed: %s", east_builtin_get_error());
        if (decoded) {
            EastValue *first = east_array_get(decoded, 0);
            CHECK(east_struct_get_field_idx(first, 0) == east_struct_get_field_idx(first, 1),
                  "one element's two references to one array decode as two arrays");
            east_value_release(decoded);
        }
        byte_buffer_free(blob);
    }

    east_value_release(pairs);
    east_value_release(element);
    east_value_release(one);
    east_type_release(type);
    east_type_release(pair);
    east_type_release(tags);
}

/* An element that shares enough containers inside itself to grow the identity
 * table, then elements that share those containers with it: the reset after a
 * growth must still forget every one of them. */
static void test_reset_after_the_table_grows(void)
{
    static const int64_t values[] = {7};
    EastType *leaf = east_array_type(&east_integer_type);
    EastType *row = east_array_type(leaf);
    EastType *type = east_array_type(row);

    /* 200 distinct arrays, each referenced twice inside the first element. */
    EastValue *leaves[200];
    for (int i = 0; i < 200; i++)
        leaves[i] = int_array(values, 1);

    EastValue *shared = east_array_new(row);
    EastValue *copies = east_array_new(row);
    EastValue *big = east_array_new(leaf);
    for (int i = 0; i < 200; i++) {
        east_array_push(big, leaves[i]);
        east_array_push(big, leaves[i]);
    }
    east_array_push(shared, big);
    east_array_push(copies, big);
    for (int i = 0; i < 200; i++) {
        EastValue *next = east_array_new(leaf);
        east_array_push(next, leaves[i]);
        east_array_push(shared, next);
        east_value_release(next);
        EastValue *copy_row = east_array_new(leaf);
        EastValue *copy = int_array(values, 1);
        east_array_push(copy_row, copy);
        east_value_release(copy);
        east_array_push(copies, copy_row);
        east_value_release(copy_row);
    }

    ByteBuffer *a = east_beast2_encode_paged(shared, type, EAST_BEAST2_CODEC_NONE);
    ByteBuffer *b = east_beast2_encode_paged(copies, type, EAST_BEAST2_CODEC_NONE);
    CHECK(same_bytes(a, b), "a container a large element shared leaked into a later element");
    byte_buffer_free(a);
    byte_buffer_free(b);

    east_value_release(big);
    east_value_release(shared);
    east_value_release(copies);
    for (int i = 0; i < 200; i++)
        east_value_release(leaves[i]);
    east_type_release(type);
    east_type_release(row);
    east_type_release(leaf);
}

int main(void)
{
    test_shared_dict_parity();
    test_dict_sharing_is_content();
    test_array_sharing_is_content();
    test_sharing_inside_an_element();
    test_reset_after_the_table_grows();

    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("beast2 aliasing: all checks passed\n");
    return 0;
}
