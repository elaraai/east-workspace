/*
 * The strict streaming JSON reader on east-c.
 *
 * The std compliance corpus pins the VALUES and the East-level behaviour
 * against the other runtimes; this gate pins the accept/reject sets the C form
 * checks implement. Those checks are hand-coded rather than run through a
 * regex, so the table below is the same one east-node-std and east-py-std
 * assert — if the three agree here they agree on what the published contract
 * admits. Run under ASan/LSan via make leak-check-std.
 */
#include <east/east.h>
#include <east/serialization.h>
#include <east/type_of_type.h>
#include <east_std/east_std.h>

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

/* Reads a whole document as `type`; true when the reader accepts it. */
static bool accepts(const char *json, EastType *type)
{
    char *err = NULL;
    EastJsonReader *r = east_json_reader_open(json, strlen(json), "", false, &err);
    if (!r) {
        free(err);
        return false;
    }
    EastValue *v = east_json_reader_read(r, type, &err);
    east_json_reader_free(r);
    free(err);
    if (!v) return false;
    east_value_release(v);
    return true;
}

static EastType *struct_of(const char *field, EastType *type)
{
    return east_struct_type((const char *[]){field}, (EastType *[]){type}, 1);
}

int main(void)
{
    east_type_of_type_init();

    EastType *int_struct = struct_of("v", &east_integer_type);
    EastType *date_struct = struct_of("v", &east_datetime_type);
    EastType *blob_struct = struct_of("v", &east_blob_type);

    /* Everything the encoder emits is accepted. */
    const char *accepted[] = {
        "{\"v\":\"0\"}",
        "{\"v\":\"1\"}",
        "{\"v\":\"-1\"}",
        "{\"v\":\"9223372036854775807\"}",
        "{\"v\":\"-9223372036854775808\"}",
    };
    for (size_t i = 0; i < sizeof accepted / sizeof *accepted; i++) {
        CHECK(accepts(accepted[i], int_struct), "Integer should accept %s", accepted[i]);
    }

    /* Everything the historic decoder tolerates and the encoder never emits is
     * refused. strtoll swallows each of these. */
    const char *rejected_int[] = {
        "{\"v\":\"0x10\"}",
        "{\"v\":\"0b101\"}",
        "{\"v\":\"0o17\"}",
        "{\"v\":\" 7 \"}",
        "{\"v\":\"007\"}",
        "{\"v\":\"+7\"}",
        "{\"v\":\"-0\"}",
        "{\"v\":7}",
        "{\"v\":\"9223372036854775808\"}",
        "{\"v\":\"-9223372036854775809\"}",
        "{\"v\":\"18446744073709551615\"}",
        "{\"v\":\"9999999999999999999\"}",
        "{\"v\":\"\"}",
        "{\"v\":\"1e3\"}",
        "{\"v\":\"7.5\"}",
    };
    for (size_t i = 0; i < sizeof rejected_int / sizeof *rejected_int; i++) {
        CHECK(!accepts(rejected_int[i], int_struct), "Integer should refuse %s", rejected_int[i]);
    }

    CHECK(accepts("{\"v\":\"2024-02-29T00:00:00.000+00:00\"}", date_struct),
          "DateTime should accept a leap day");
    CHECK(accepts("{\"v\":\"1970-01-01T00:00:00.000+00:00\"}", date_struct),
          "DateTime should accept the epoch");

    const char *rejected_date[] = {
        "{\"v\":\"2022-06-29T13:43:00.123Z\"}",      /* the decoder takes Z */
        "{\"v\":\"2022-06-29T13:43:00.123+05:00\"}", /* and any offset */
        "{\"v\":\"2022-06-29T13:43:00+00:00\"}",     /* no milliseconds */
        "{\"v\":\"2026-02-30T00:00:00.000+00:00\"}", /* a day February lacks */
        "{\"v\":\"2026-04-31T00:00:00.000+00:00\"}", /* a day April lacks */
        "{\"v\":\"2025-02-29T00:00:00.000+00:00\"}", /* Feb 29 in a common year */
        "{\"v\":\"2022-13-29T13:43:00.123+00:00\"}", /* month 13 */
        "{\"v\":\"2022-06-29T24:43:00.123+00:00\"}", /* hour 24 */
        "{\"v\":\"2022-06-29 13:43:00.123+00:00\"}", /* space, not T */
    };
    for (size_t i = 0; i < sizeof rejected_date / sizeof *rejected_date; i++) {
        CHECK(!accepts(rejected_date[i], date_struct), "DateTime should refuse %s",
              rejected_date[i]);
    }

    CHECK(accepts("{\"v\":\"0x\"}", blob_struct), "Blob should accept the empty blob");
    CHECK(accepts("{\"v\":\"0xdeadbeef\"}", blob_struct), "Blob should accept lowercase hex");
    const char *rejected_blob[] = {
        "{\"v\":\"0xDEADBEEF\"}", /* the decoder takes uppercase */
        "{\"v\":\"0x123\"}",      /* odd digit count */
        "{\"v\":\"deadbeef\"}",   /* no prefix */
        "{\"v\":\"0xgg\"}",
    };
    for (size_t i = 0; i < sizeof rejected_blob / sizeof *rejected_blob; i++) {
        CHECK(!accepts(rejected_blob[i], blob_struct), "Blob should refuse %s", rejected_blob[i]);
    }

    /* Structural strictness. */
    CHECK(!accepts("{\"v\":\"1\",\"extra\":1}", int_struct), "an unmodelled field is refused");
    CHECK(!accepts("{}", int_struct), "a missing field is refused");
    CHECK(!accepts("{\"v\":\"1\",\"v\":\"2\"}", int_struct), "a duplicate field is refused");
    /* JSON objects are unordered, so field order is not something to require. */
    {
        EastType *two = east_struct_type((const char *[]){"a", "b"},
                                         (EastType *[]){&east_integer_type, &east_string_type}, 2);
        CHECK(accepts("{\"a\":\"1\",\"b\":\"x\"}", two), "declared order is accepted");
        CHECK(accepts("{\"b\":\"x\",\"a\":\"1\"}", two), "any order is accepted");
        east_type_release(two);
    }

    /* Iteration: `more` is a predicate and `next` advances, so reading two
     * elements in a row needs no `more` between them. */
    {
        char *err = NULL;
        EastJsonReader *r =
            east_json_reader_open("[{\"v\":\"1\"},{\"v\":\"2\"}]", 25, "", true, &err);
        CHECK(r != NULL, "the array opens: %s", err ? err : "");
        free(err);
        if (r) {
            err = NULL;
            EastValue *a = east_json_reader_next(r, int_struct, &err);
            CHECK(a != NULL, "first element reads: %s", err ? err : "");
            free(err);
            err = NULL;
            EastValue *b = east_json_reader_next(r, int_struct, &err);
            CHECK(b != NULL, "second element reads without an intervening more(): %s",
                  err ? err : "");
            free(err);
            CHECK(!east_json_reader_more(r), "the array is exhausted");
            if (a) east_value_release(a);
            if (b) east_value_release(b);
            east_json_reader_free(r);
        }
    }

    /* A pointer selects the container, and the member after a large array is
     * still reachable — the envelope shape every ingest meets. */
    {
        const char *doc = "{\"meta\":{\"v\":\"7\"},\"data\":[{\"v\":\"1\"},{\"v\":\"2\"}]}";
        char *err = NULL;
        EastJsonReader *r = east_json_reader_open(doc, strlen(doc), "/data", true, &err);
        CHECK(r != NULL, "a pointer selects the array: %s", err ? err : "");
        free(err);
        if (r) {
            size_t count = 0;
            while (east_json_reader_more(r)) {
                err = NULL;
                EastValue *v = east_json_reader_next(r, int_struct, &err);
                free(err);
                if (!v) break;
                east_value_release(v);
                count++;
            }
            CHECK(count == 2, "both rows read, got %zu", count);
            east_json_reader_free(r);
        }

        err = NULL;
        r = east_json_reader_open(doc, strlen(doc), "/meta", false, &err);
        CHECK(r != NULL, "a pointer selects a scalar subtree: %s", err ? err : "");
        free(err);
        if (r) {
            err = NULL;
            EastValue *v = east_json_reader_read(r, int_struct, &err);
            CHECK(v != NULL, "the envelope member reads: %s", err ? err : "");
            free(err);
            if (v) east_value_release(v);
            east_json_reader_free(r);
        }
    }

    /* A pointer that does not resolve names what is missing. */
    {
        char *err = NULL;
        EastJsonReader *r = east_json_reader_open("{\"data\":[]}", 11, "/nope", true, &err);
        CHECK(r == NULL, "an unresolvable pointer fails");
        CHECK(err && strstr(err, "no member \"nope\""), "and names the member: %s",
              err ? err : "(none)");
        free(err);
    }

    /* An error carries the RFC 6901 pointer of the offending element. */
    {
        const char *doc = "[{\"v\":\"1\"},{\"v\":\"nope\"}]";
        char *err = NULL;
        EastJsonReader *r = east_json_reader_open(doc, strlen(doc), "", true, &err);
        free(err);
        if (r) {
            err = NULL;
            EastValue *a = east_json_reader_next(r, int_struct, &err);
            free(err);
            if (a) east_value_release(a);
            err = NULL;
            EastValue *b = east_json_reader_next(r, int_struct, &err);
            CHECK(b == NULL, "the malformed row is refused");
            CHECK(err && strstr(err, "/1/v"), "and names its pointer: %s", err ? err : "(none)");
            free(err);
            east_json_reader_free(r);
        }
    }

    east_type_release(int_struct);
    east_type_release(date_struct);
    east_type_release(blob_struct);

    if (failures == 0) {
        printf("test_json_reader: all cases passed\n");
        return 0;
    }
    fprintf(stderr, "test_json_reader: %d failure(s)\n", failures);
    return 1;
}
