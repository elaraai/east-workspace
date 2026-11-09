/*
 * A variant's cases in East's order (east-workspace#1574, #1578).
 *
 * A variant's cases sort by name, as strings by code point, and a case's
 * place in that order is its tag. east_variant_type sorts the cases it is
 * given, so a type a TypeScript East before #1574 wrote — which listed a case
 * named like an integer ("50") before the rest — would be read as a type
 * whose tags name other cases. Every door a listed type comes in by refuses
 * one out of order instead: a type value (east_type_from_value) and a beast2
 * type table, so the whole decode refuses such bytes; and the readers that
 * decode a blob's segments by the asked type's positions — the sequential
 * reader and the pages — check the header's type against it first, as the
 * whole decode does, so a header of another type is refused rather than
 * misread.
 *
 * The bytes are v1.0.105's for Dict<String, Variant{50, 100, 300, 400}> =
 * {a: 50, b: 100, c: 300, d: 400}: paged (one segment) and whole, the cases'
 * tags 0 to 3 in the order 50, 100, 300, 400 (the same bytes as east's
 * src/serialization/beast2/v5/header-type.spec.ts).
 */
#include <east/east.h>

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, what)                                                                          \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            printf("FAIL: %s\n", what);                                                            \
            failures++;                                                                            \
        } else {                                                                                   \
            printf("ok: %s\n", what);                                                              \
        }                                                                                          \
    } while (0)

static const uint8_t OLD_PAGED[] = {
    0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05, 0x00, 0x1c, 0x03, 0x04, 0x01, 0x00,
    0x08, 0x04, 0x02, 0x35, 0x30, 0x01, 0x03, 0x31, 0x30, 0x30, 0x01, 0x03, 0x33, 0x30,
    0x30, 0x01, 0x03, 0x34, 0x30, 0x30, 0x01, 0x0b, 0x00, 0x02, 0x01, 0x00, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x0d, 0x0d, 0x04, 0x01, 0x61, 0x00, 0x01, 0x62, 0x01, 0x01, 0x63,
    0x02, 0x01, 0x64, 0x03, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x2c, 0x04, 0x40, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0xf5,
};

static const uint8_t OLD_WHOLE[] = {
    0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05, 0x00, 0x1c, 0x03, 0x04, 0x01, 0x00, 0x08,
    0x04, 0x02, 0x35, 0x30, 0x01, 0x03, 0x31, 0x30, 0x30, 0x01, 0x03, 0x33, 0x30, 0x30, 0x01,
    0x03, 0x34, 0x30, 0x30, 0x01, 0x0b, 0x00, 0x02, 0x01, 0x00, 0x00, 0x0f, 0x0f, 0x00, 0x04,
    0x01, 0x61, 0x00, 0x01, 0x62, 0x01, 0x01, 0x63, 0x02, 0x01, 0x64, 0x03, 0x00,
};

/* The refusal the last call posted names `needle`; the message is consumed. */
static bool posted(const char *needle)
{
    char *msg = east_builtin_get_error();
    bool says = msg && strstr(msg, needle);
    if (!says) printf("  posted: %s\n", msg ? msg : "(nothing)");
    free(msg);
    return says;
}

/* Variant{50, 100, 300, 400} of Nulls. */
static EastType *grade_type(void)
{
    const char *names[] = {"50", "100", "300", "400"};
    EastType *types[] = {&east_null_type, &east_null_type, &east_null_type, &east_null_type};
    return east_variant_type(names, types, 4);
}

static void test_case_order(void)
{
    const char *sorted[] = {"100", "300", "400", "50", "a"};
    CHECK(east_variant_cases_in_order(sorted, 5), "cases as their names sort are in order");
    /* By code point, as strcmp gives over UTF-8: Ａ (U+FF21) before 𝐀 (U+1D400). */
    const char *wide[] = {"b", "\xEF\xBC\xA1", "\xF0\x9D\x90\x80"};
    CHECK(east_variant_cases_in_order(wide, 3), "cases sort by code point");
    const char *old[] = {"50", "100"};
    CHECK(!east_variant_cases_in_order(old, 2) && posted("lists its case \"100\" after \"50\""),
          "a case named like an integer listed first is out of order");
    const char *twice[] = {"a", "a"};
    CHECK(!east_variant_cases_in_order(twice, 2) && posted("lists its case \"a\" twice"),
          "a case listed twice is refused");
}

static void test_type_value(void)
{
    EastType *grade = grade_type();
    EastValue *value = east_type_to_value(grade);
    CHECK(value != NULL, "a variant type has a type value");
    EastType *back = east_type_from_value(value);
    CHECK(back == grade, "a type value in East's order reads as its type");
    if (back) east_type_release(back);

    /* The same type value with its first case moved last: 50 before 100, as
     * a TypeScript East before #1574 listed it. */
    EastValue *cases = value->data.variant.value;
    EastValue *old_cases = east_array_new(cases->data.array.elem_type);
    size_t n = cases->data.array.len;
    for (size_t i = 0; i < n; i++)
        east_array_push(old_cases, cases->data.array.items[(i + n - 1) % n]);
    EastValue *old = east_variant_new("Variant", old_cases, east_type_type->data.recursive.node);
    EastType *refused = east_type_from_value(old);
    CHECK(refused == NULL && posted("lists its case \"100\" after \"50\""),
          "a type value listing its cases out of East's order is refused");
    east_value_release(old);
    east_value_release(old_cases);
    east_value_release(value);
    east_type_release(grade);
}

static void test_old_bytes(void)
{
    EastType *grade = grade_type();
    EastType *shades = east_dict_type(&east_string_type, grade);

    EastValue *whole = east_beast2_decode_full(OLD_WHOLE, sizeof(OLD_WHOLE), shades);
    CHECK(whole == NULL && posted("lists its case \"100\" after \"50\""),
          "the whole decode refuses a header listing the cases out of order");
    EastValue *paged = east_beast2_decode_full(OLD_PAGED, sizeof(OLD_PAGED), shades);
    CHECK(paged == NULL && posted("lists its case \"100\" after \"50\""),
          "the whole decode refuses such a paged blob");
    Beast2SegmentReader *reader = east_beast2_reader_new(OLD_PAGED, sizeof(OLD_PAGED), shades);
    CHECK(reader == NULL && posted("lists its case \"100\" after \"50\""),
          "the segment reader refuses it at open");
    if (reader) east_beast2_reader_free(reader);
    Beast2Pages *pages = east_beast2_pages_new(OLD_PAGED, sizeof(OLD_PAGED), shades);
    CHECK(pages == NULL && posted("lists its case \"100\" after \"50\""),
          "the pages refuse it at open");
    if (pages) east_beast2_pages_free(pages);

    east_type_release(shades);
    east_type_release(grade);
}

static void test_another_type(void)
{
    /* A header of another type, in order: the readers that decode by the
     * asked type's positions refuse it as the whole decode does. */
    EastType *ints = east_dict_type(&east_string_type, &east_integer_type);
    EastType *strings = east_dict_type(&east_string_type, &east_string_type);
    EastValue *dict = east_dict_new(&east_string_type, &east_integer_type);
    EastValue *key = east_string("a");
    EastValue *one = east_integer(1);
    east_dict_set(dict, key, one);
    east_value_release(key);
    east_value_release(one);
    ByteBuffer *blob = east_beast2_encode_paged(dict, ints, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(blob != NULL, "a paged blob of Dict<String, Integer> is written");
    if (blob) {
        Beast2SegmentReader *reader = east_beast2_reader_new(blob->data, blob->len, strings);
        CHECK(reader == NULL && posted("cannot decode a blob of type"),
              "the segment reader refuses a header of another type");
        if (reader) east_beast2_reader_free(reader);
        Beast2Pages *pages = east_beast2_pages_new(blob->data, blob->len, strings);
        CHECK(pages == NULL && posted("cannot decode a blob of type"),
              "the pages refuse a header of another type");
        if (pages) east_beast2_pages_free(pages);
        Beast2Pages *same = east_beast2_pages_new(blob->data, blob->len, ints);
        CHECK(same != NULL, "the pages open a header of the asked type");
        if (same) east_beast2_pages_free(same);
        byte_buffer_free(blob);
    }
    east_value_release(dict);
    east_type_release(strings);
    east_type_release(ints);
}

int main(void)
{
    east_type_of_type_init();
    test_case_order();
    test_type_value();
    test_old_bytes();
    test_another_type();
    if (failures) {
        printf("%d failure(s)\n", failures);
        return 1;
    }
    printf("all passed\n");
    return 0;
}
