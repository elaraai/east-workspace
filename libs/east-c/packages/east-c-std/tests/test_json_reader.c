/*
 * The strict streaming JSON reader on east-c.
 *
 * The std compliance corpus pins the VALUES, the East-level behaviour and the
 * exact error text against the other runtimes; this gate pins, at the C API,
 * the accept/reject sets the C form checks implement, the wording of a sample
 * of refusals, the shapes the corpus reaches only through the runners (Vector,
 * Matrix, Ref, the entry struct in either field order) and the host details
 * the corpus cannot: a comma-decimal locale, and the bytes of an invalid UTF-8
 * string. Run under ASan/LSan via make leak-check-std.
 */
#include <east/east.h>
#include <east/serialization.h>
#include <east/type_of_type.h>
#include <east_std/east_std.h>

#include <locale.h>
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

/* Reads a whole document as `type`; the value, or NULL with *err set. */
static EastValue *read_doc(const char *json, size_t len, EastType *type, char **err)
{
    *err = NULL;
    EastJsonReader *r = east_json_reader_open(json, len, "", false, err);
    if (!r) return NULL;
    EastValue *v = east_json_reader_read(r, type, err);
    east_json_reader_free(r);
    return v;
}

/* Whether the reader accepts `json` as `type`. */
static bool accepts(const char *json, EastType *type)
{
    char *err = NULL;
    EastValue *v = read_doc(json, strlen(json), type, &err);
    free(err);
    if (!v) return false;
    east_value_release(v);
    return true;
}

/* Checks that reading `json` as `type` fails with exactly `message`. */
static void refuses_with(const char *json, EastType *type, const char *message)
{
    char *err = NULL;
    EastValue *v = read_doc(json, strlen(json), type, &err);
    if (v) east_value_release(v);
    CHECK(v == NULL, "%s should be refused", json);
    CHECK(err && strcmp(err, message) == 0, "%s: expected\n  %s\ngot\n  %s", json, message,
          err ? err : "(none)");
    free(err);
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
    EastType *string_struct = struct_of("v", &east_string_type);

    /* Everything the encoder emits is accepted. */
    const char *accepted[] = {
        "{\"v\":\"0\"}",
        "{\"v\":\"1\"}",
        "{\"v\":\"-1\"}",
        "{\"v\":\"9223372036854775807\"}",
        "{\"v\":\"-9223372036854775808\"}",
        "{ \"v\" : \"1\" }",
        "{\n\t\"v\":\n\"1\"\n}",
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
    CHECK(accepts("{\"v\":\"0001-01-01T00:00:00.000+00:00\"}", date_struct),
          "DateTime should accept the first year");

    const char *rejected_date[] = {
        "{\"v\":\"2022-06-29T13:43:00.123Z\"}",      /* the decoder takes Z */
        "{\"v\":\"2022-06-29T13:43:00.123+05:00\"}", /* and any offset */
        "{\"v\":\"2022-06-29T13:43:00+00:00\"}",     /* no milliseconds */
        "{\"v\":\"2026-02-30T00:00:00.000+00:00\"}", /* a day February lacks */
        "{\"v\":\"2026-04-31T00:00:00.000+00:00\"}", /* a day April lacks */
        "{\"v\":\"2025-02-29T00:00:00.000+00:00\"}", /* Feb 29 in a common year */
        "{\"v\":\"0000-01-01T00:00:00.000+00:00\"}", /* year 0, below the shared range */
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

    /* The wording is east-node's, word for word: the shared corpus pins the
     * whole table through the runners, this pins a sample at the C API. */
    refuses_with("{\"v\":7}", int_struct,
                 "/v: expected Integer as a quoted decimal string, got a number");
    refuses_with("{\"v\":\"x\"}", int_struct,
                 "/v: \"x\" is not a 64-bit integer in East JSON's form");
    refuses_with("{\"v\":\"a\\\"b\"}", int_struct,
                 "/v: \"a\\\"b\" is not a 64-bit integer in East JSON's form");
    refuses_with("{\"v\":\"2026-02-30T00:00:00.000+00:00\"}", date_struct,
                 "/v: \"2026-02-30T00:00:00.000+00:00\" is not a real date");
    refuses_with("{\"v\":\"2022-06-29T13:43:00.123Z\"}", date_struct,
                 "/v: \"2022-06-29T13:43:00.123Z\" is not East JSON's UTC date-time form");
    refuses_with("{\"v\":\"a\\qb\"}", string_struct, "/v: invalid escape \"\\q\"");
    refuses_with("{\"v\":\"a\x01"
                 "b\"}",
                 string_struct, "/v: unescaped control character U+0001 in string");
    refuses_with("{\"v\":\"\\uzzzz\"}", string_struct, "/v: invalid \\u escape \"\\uzzzz\"");
    refuses_with("{\"v\":\"abc", string_struct, "/v: unexpected end of document");
    refuses_with("{\"v\":1}", string_struct, "/v: expected a String, got a number");
    refuses_with("{v:\"1\"}", int_struct, "expected a field name, got \"v\"");
    refuses_with("{\"v\" \"1\"}", int_struct, "expected \":\" after a field name, got a string");
    refuses_with("{\"v\":\"1\",\"extra\":1}", int_struct, "unexpected field \"extra\"");
    refuses_with("{}", int_struct, "missing field \"v\"");
    refuses_with("[1]", int_struct, "expected an object, got an array");
    refuses_with("", int_struct, "expected an object, got end of document");
    refuses_with("\xE2\x98\x83", int_struct, "expected an object, got \"\xE2\x98\x83\"");
    refuses_with("\xFF", int_struct, "expected an object, got \"\xEF\xBF\xBD\"");

    /* A quoted value is clipped at 200 code points, with an ellipsis, so a
     * message never grows with the document. */
    {
        char doc[512];
        char want[512];
        strcpy(doc, "{\"v\":\"");
        for (int i = 0; i < 250; i++)
            strcat(doc, "x");
        strcat(doc, "\"}");
        strcpy(want, "/v: \"");
        for (int i = 0; i < 200; i++)
            strcat(want, "x");
        strcat(want, "\xE2\x80\xA6\" is not a 64-bit integer in East JSON's form");
        refuses_with(doc, int_struct, want);
    }

    /* Strings are validated as UTF-8 — a well-formed sequence reads, a
     * malformed one is refused rather than repaired or passed through. */
    {
        char *err = NULL;
        const char ok[] = "{\"v\":\"a\xC3\xA9\xF0\x9F\x98\x80\"}";
        EastValue *v = read_doc(ok, sizeof ok - 1, string_struct, &err);
        CHECK(v != NULL, "a raw multi-byte string reads: %s", err ? err : "");
        if (v) {
            EastValue *s = east_struct_get_field(v, "v");
            CHECK(s && s->data.string.len == 7, "the bytes are kept as they are");
            east_value_release(v);
        }
        free(err);

        const char *bad[] = {
            "{\"v\":\"a\xFF"
            "b\"}", /* a byte no sequence starts with */
            "{\"v\":\"a\xC0\x80"
            "b\"}", /* an overlong encoding */
            "{\"v\":\"a\xED\xA0\x80"
            "b\"}", /* an encoded surrogate */
            "{\"v\":\"a\xF4\x90\x80\x80"
            "b\"}",                  /* past U+10FFFF */
            "{\"v\":\"a\xE2\x98\"}", /* a sequence cut off by the quote */
        };
        const size_t bad_len[] = {13, 14, 15, 16, 12};
        for (size_t i = 0; i < sizeof bad / sizeof *bad; i++) {
            err = NULL;
            v = read_doc(bad[i], bad_len[i], string_struct, &err);
            if (v) east_value_release(v);
            CHECK(v == NULL, "invalid UTF-8 case %zu is refused", i);
            CHECK(err && strcmp(err, "/v: invalid UTF-8 in string") == 0,
                  "invalid UTF-8 case %zu names the fault: %s", i, err ? err : "(none)");
            free(err);
        }
    }

    /* The shapes the shared corpus reaches only through the runners. */
    {
        EastType *vec = struct_of("v", east_vector_type(&east_float_type));
        EastType *mat = struct_of("v", east_matrix_type(&east_integer_type));
        EastType *cell = struct_of("v", east_ref_type(&east_integer_type));
        EastType *grid = struct_of("v", east_array_type(east_array_type(&east_integer_type)));

        char *err = NULL;
        EastValue *v = read_doc("{\"v\":[1.5,\"NaN\",-2e3]}", 23, vec, &err);
        CHECK(v != NULL, "a Vector reads: %s", err ? err : "");
        if (v) {
            EastValue *f = east_struct_get_field(v, "v");
            CHECK(f && f->kind == EAST_VAL_VECTOR && f->data.vector.len == 3 &&
                      ((double *)f->data.vector.data)[0] == 1.5 &&
                      ((double *)f->data.vector.data)[2] == -2000.0,
                  "the Vector holds its elements");
            east_value_release(v);
        }
        free(err);

        v = read_doc("{\"v\":[[\"1\",\"2\"],[\"3\",\"4\"]]}", 27, mat, &err);
        CHECK(v != NULL, "a Matrix reads: %s", err ? err : "");
        if (v) {
            EastValue *m = east_struct_get_field(v, "v");
            CHECK(m && m->kind == EAST_VAL_MATRIX && m->data.matrix.rows == 2 &&
                      m->data.matrix.cols == 2 && ((int64_t *)m->data.matrix.data)[3] == 4,
                  "the Matrix holds its elements, row-major");
            east_value_release(v);
        }
        free(err);
        CHECK(accepts("{\"v\":[]}", mat), "an empty Matrix reads");
        CHECK(accepts("{\"v\":[[]]}", mat), "a Matrix of one empty row reads");
        refuses_with("{\"v\":[[\"1\",\"2\"],[\"3\"]]}", mat,
                     "/v: Matrix row 1 has 1 columns, expected 2");
        refuses_with("{\"v\":[\"1\"]}", mat, "/v/0: expected an array, got a string");

        CHECK(accepts("{\"v\":[\"7\"]}", cell), "a Ref reads");
        refuses_with("{\"v\":[\"1\",\"2\"]}", cell,
                     "/v: expected a Ref to hold exactly one element");
        refuses_with("{\"v\":[]}", cell, "/v: expected a Ref to hold exactly one element");
        refuses_with("{\"v\":{\"$ref\":\"1#\"}}", cell,
                     "/v: expected a Ref as a one-element array, got an object");

        CHECK(accepts("{\"v\":[[\"1\"],[]]}", grid), "nested arrays read");
        refuses_with("{\"v\":[[\"1\"],[\"x\"]]}", grid,
                     "/v/1/0: \"x\" is not a 64-bit integer in East JSON's form");

        east_type_release(vec);
        east_type_release(mat);
        east_type_release(cell);
        east_type_release(grid);
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
            err = NULL;
            EastValue *c = east_json_reader_next(r, int_struct, &err);
            CHECK(c == NULL && err && strcmp(err, "the reader is exhausted") == 0,
                  "reading past the end is refused by name: %s", err ? err : "(none)");
            free(err);
            if (a) east_value_release(a);
            if (b) east_value_release(b);
            east_json_reader_free(r);
        }
    }

    /* An object iterates as {key, value} entries, in either declared field
     * order — the struct is built in the type's own order, so encoding it
     * back pairs every field with its own value — and a fault inside a member
     * is located by the member's name. */
    {
        const char *names_kv[] = {"key", "value"};
        const char *names_vk[] = {"value", "key"};
        EastType *key_first =
            east_struct_type(names_kv, (EastType *[]){&east_string_type, &east_integer_type}, 2);
        EastType *value_first =
            east_struct_type(names_vk, (EastType *[]){&east_integer_type, &east_string_type}, 2);
        EastType *orders[] = {key_first, value_first};
        const char *encoded[] = {"{\"key\":\"a\",\"value\":\"1\"}",
                                 "{\"value\":\"1\",\"key\":\"a\"}"};
        for (size_t o = 0; o < 2; o++) {
            char *err = NULL;
            EastJsonReader *r =
                east_json_reader_open("{\"a\":\"1\",\"b\":\"2\"}", 17, "", true, &err);
            CHECK(r != NULL, "the object opens: %s", err ? err : "");
            free(err);
            if (!r) continue;
            err = NULL;
            EastValue *entry = east_json_reader_next(r, orders[o], &err);
            CHECK(entry != NULL, "order %zu: the first member reads: %s", o, err ? err : "");
            free(err);
            if (entry) {
                EastValue *k = east_struct_get_field(entry, "key");
                EastValue *val = east_struct_get_field(entry, "value");
                CHECK(k && k->kind == EAST_VAL_STRING && strcmp(k->data.string.data, "a") == 0,
                      "order %zu: the key is the member name", o);
                CHECK(val && val->kind == EAST_VAL_INTEGER && val->data.integer == 1,
                      "order %zu: the value is the member value", o);
                char *json = east_json_encode(entry, orders[o]);
                CHECK(json && strcmp(json, encoded[o]) == 0,
                      "order %zu: the entry encodes in the type's field order: %s", o,
                      json ? json : "(null)");
                free(json);
                east_value_release(entry);
            }
            east_json_reader_free(r);
        }

        char *err = NULL;
        EastJsonReader *r =
            east_json_reader_open("{\"a\":\"1\",\"b~/c\":\"x\"}", 20, "", true, &err);
        free(err);
        if (r) {
            err = NULL;
            EastValue *first = east_json_reader_next(r, key_first, &err);
            if (first) east_value_release(first);
            free(err);
            err = NULL;
            EastValue *second = east_json_reader_next(r, key_first, &err);
            CHECK(second == NULL, "the malformed member is refused");
            CHECK(err && strcmp(err,
                                "/b~0~1c: \"x\" is not a 64-bit integer in East JSON's form") == 0,
                  "and is located by its escaped name: %s", err ? err : "(none)");
            free(err);
            east_json_reader_free(r);
        }

        /* The type is checked before anything is consumed, at the container. */
        err = NULL;
        r = east_json_reader_open("{\"a\":\"1\"}", 9, "", true, &err);
        free(err);
        if (r) {
            err = NULL;
            EastValue *v = east_json_reader_next(r, &east_integer_type, &err);
            CHECK(v == NULL && err &&
                      strcmp(err, "iterating an object needs a Struct with exactly the fields key "
                                  "and value") == 0,
                  "a non-entry type is refused at the container: %s", err ? err : "(none)");
            free(err);
            EastType *int_key = east_struct_type(
                names_kv, (EastType *[]){&east_integer_type, &east_integer_type}, 2);
            err = NULL;
            v = east_json_reader_next(r, int_key, &err);
            CHECK(v == NULL && err && strcmp(err, "iterating an object needs a String key") == 0,
                  "a non-String key is refused at the container: %s", err ? err : "(none)");
            free(err);
            east_type_release(int_key);
            east_json_reader_free(r);
        }
        east_type_release(key_first);
        east_type_release(value_first);
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

    /* A pointer that does not resolve names what is missing, quoted as
     * east-node quotes it. */
    {
        const char *cases[][3] = {
            {"{\"data\":[]}", "/nope", "no member \"nope\""},
            {"[[1],[2]]", "/5", "no element 5"},
            {"[[1],[2]]", "/x", "expected an array index, got \"x\""},
            {"{\"a\":\"s\"}", "/a/b", "/a: cannot descend into a string looking for \"b\""},
            {"[]", "data", "a JSON Pointer must be empty or start with \"/\", got \"data\""},
            {"{\"data\":\"s\"}", "/data",
             "/data: expected an array or object to iterate, got a string"},
            {"", "", "expected an array or object to iterate, got end of document"},
        };
        for (size_t i = 0; i < sizeof cases / sizeof *cases; i++) {
            char *err = NULL;
            EastJsonReader *r =
                east_json_reader_open(cases[i][0], strlen(cases[i][0]), cases[i][1], true, &err);
            CHECK(r == NULL, "pointer case %zu fails", i);
            CHECK(err && strcmp(err, cases[i][2]) == 0,
                  "pointer case %zu: expected\n  %s\ngot\n  %s", i, cases[i][2],
                  err ? err : "(none)");
            free(err);
            if (r) east_json_reader_free(r);
        }
    }

    /* Navigating past a value is not reading it, but it is still JSON: a
     * fault before the pointer target is refused at open, with east-node's
     * words, and nesting counts every value alike on both. */
    {
        const char *cases[][2] = {
            {"{\"junk\":[1,,2],\"data\":[]}", "unexpected character \",\""},
            {"{\"junk\":trux,\"data\":[]}", "expected true"},
            {"{\"junk\":\"a\\qb\",\"data\":[]}", "invalid escape \"\\q\""},
            {"{\"junk\":{\"a\" 1},\"data\":[]}", "expected \":\" after a field name, got a number"},
            {"{\"junk\":[1e],\"data\":[]}", "expected a digit in the exponent"},
            {"{\"junk\":[1 2],\"data\":[]}", "expected \",\" or \"]\" in array"},
            {"{\"junk\":{a:1},\"data\":[]}", "expected a field name, got \"a\""},
            {"{\"junk\":[1,2", "unexpected end of document"},
        };
        for (size_t i = 0; i < sizeof cases / sizeof *cases; i++) {
            char *err = NULL;
            EastJsonReader *r =
                east_json_reader_open(cases[i][0], strlen(cases[i][0]), "/data", true, &err);
            CHECK(r == NULL, "skip case %zu fails", i);
            CHECK(err && strcmp(err, cases[i][1]) == 0, "skip case %zu: expected\n  %s\ngot\n  %s",
                  i, cases[i][1], err ? err : "(none)");
            free(err);
            if (r) east_json_reader_free(r);
        }
        CHECK(accepts("[1,[2,[3]],{\"a\":{\"b\":[true,null,\"s\",-1.5e2]}}]",
                      east_array_type(&east_integer_type)) == false,
              "an Integer array refuses a mixed document (the skip is not the read)");

        /* Mixed bracket kinds past the bound: 1500 object+array pairs. */
        size_t pairs = 1500;
        size_t len = 9 + pairs * 6 + 1 + pairs * 2 + 11;
        char *deep = malloc(len + 1);
        if (deep) {
            char *w = deep;
            w += sprintf(w, "{\"junk\":");
            for (size_t i = 0; i < pairs; i++)
                w += sprintf(w, "{\"a\":[");
            w += sprintf(w, "1");
            for (size_t i = 0; i < pairs; i++)
                w += sprintf(w, "]}");
            w += sprintf(w, ",\"data\":[]}");
            char *err = NULL;
            EastJsonReader *r =
                east_json_reader_open(deep, (size_t)(w - deep), "/data", true, &err);
            CHECK(r == NULL && err && strcmp(err, "document nests deeper than 2048") == 0,
                  "mixed nesting past the bound is refused: %s", err ? err : "(none)");
            free(err);
            if (r) east_json_reader_free(r);
            free(deep);
        }
    }

    /* An Option is null or its payload wherever the payload cannot itself be
     * null, so the tagged object there is refused as the payload it is not;
     * only Option<Null> and Option<Option<T>> keep the tagged form, so a bare
     * null there is refused as the object it is not. The rule is the one the
     * encoder and both whole-document decoders apply. */
    {
        const char *cases[] = {"none", "some"};
        EastType *option_int =
            east_variant_type(cases, (EastType *[]){&east_null_type, &east_integer_type}, 2);
        EastType *option_option =
            east_variant_type(cases, (EastType *[]){&east_null_type, option_int}, 2);
        EastType *option_null =
            east_variant_type(cases, (EastType *[]){&east_null_type, &east_null_type}, 2);

        EastType *opt = struct_of("v", option_int);
        EastType *nested = struct_of("v", option_option);
        EastType *unit = struct_of("v", option_null);
        CHECK(accepts("{\"v\":null}", opt), "a flat none reads");
        CHECK(accepts("{\"v\":\"7\"}", opt), "a flat some reads");
        refuses_with("{\"v\":{\"type\":\"some\",\"value\":\"7\"}}", opt,
                     "/v: expected Integer as a quoted decimal string, got an object");
        refuses_with("{\"v\":{\"type\":\"none\",\"value\":null}}", opt,
                     "/v: expected Integer as a quoted decimal string, got an object");
        refuses_with("{\"v\":\"x\"}", opt, "/v: \"x\" is not a 64-bit integer in East JSON's form");
        CHECK(accepts("{\"v\":{\"type\":\"some\",\"value\":null}}", nested),
              "some(none) reads tagged");
        CHECK(accepts("{\"v\":{\"type\":\"some\",\"value\":\"1\"}}", nested),
              "some(some(1)) reads tagged");
        refuses_with("{\"v\":null}", nested, "/v: expected an object, got null");
        refuses_with("{\"v\":\"1\"}", nested, "/v: expected an object, got a string");
        CHECK(accepts("{\"v\":{\"type\":\"none\",\"value\":null}}", unit),
              "Option<Null>'s none reads tagged");
        CHECK(accepts("{\"v\":{\"type\":\"some\",\"value\":null}}", unit),
              "Option<Null>'s some reads tagged");
        refuses_with("{\"v\":null}", unit, "/v: expected an object, got null");

        /* What is read back is the value, and the encoder writes it the same way. */
        const char *docs[] = {"{\"v\":null}", "{\"v\":\"7\"}"};
        const char *want_case[] = {"none", "some"};
        for (size_t i = 0; i < 2; i++) {
            char *err = NULL;
            EastValue *v = read_doc(docs[i], strlen(docs[i]), opt, &err);
            CHECK(v != NULL, "%s reads: %s", docs[i], err ? err : "");
            free(err);
            if (!v) continue;
            EastValue *field = east_struct_get_field(v, "v");
            CHECK(field && field->kind == EAST_VAL_VARIANT &&
                      strcmp(east_variant_case_name(field), want_case[i]) == 0,
                  "%s reads as %s", docs[i], want_case[i]);
            char *json = east_json_encode(v, opt);
            CHECK(json && strcmp(json, docs[i]) == 0, "%s encodes back as itself: %s", docs[i],
                  json ? json : "(null)");
            free(json);
            east_value_release(v);
        }

        /* A recursive payload is judged by what the wrapper encodes: the
         * ordinary linked list, next: Option<self>, is flat at every depth. */
        EastType *rec = east_recursive_type_new();
        EastType *next = east_variant_type(cases, (EastType *[]){&east_null_type, rec}, 2);
        EastType *node = east_struct_type((const char *[]){"head", "next"},
                                          (EastType *[]){&east_integer_type, next}, 2);
        east_recursive_type_set(rec, node);
        {
            const char *doc = "{\"head\":\"2\",\"next\":{\"head\":\"1\",\"next\":null}}";
            char *err = NULL;
            EastValue *v = read_doc(doc, strlen(doc), rec, &err);
            CHECK(v != NULL, "a chain reads: %s", err ? err : "");
            free(err);
            if (v) {
                char *json = east_json_encode(v, rec);
                CHECK(json && strcmp(json, doc) == 0, "a chain encodes back as itself: %s",
                      json ? json : "(null)");
                free(json);
                east_value_release(v);
            }
        }
        refuses_with("{\"head\":\"1\",\"next\":{\"type\":\"none\",\"value\":null}}", rec,
                     "/next: unexpected field \"type\"");

        east_type_release(opt);
        east_type_release(nested);
        east_type_release(unit);
    }

    /* A Float is read the same under any LC_NUMERIC: "1.5" is 1.5, not the 1
     * a comma locale's strtod stops at — and prints back as "1.5". Skipped
     * where the host has no comma locale to switch to. */
    {
        const char *locales[] = {"de_DE.UTF-8", "de_DE.utf8", "de_DE", "fr_FR.UTF-8", "de-DE"};
        const char *chosen = NULL;
        for (size_t i = 0; i < sizeof locales / sizeof *locales && !chosen; i++) {
            if (setlocale(LC_NUMERIC, locales[i])) chosen = locales[i];
        }
        if (chosen && localeconv()->decimal_point[0] == ',') {
            EastType *floats = east_array_type(&east_float_type);
            char *err = NULL;
            EastValue *v = read_doc("[1.5,2.25,1.5e2,1e-3]", 21, floats, &err);
            CHECK(v != NULL, "under %s the array reads: %s", chosen, err ? err : "");
            if (v) {
                double got[4];
                for (size_t i = 0; i < 4; i++)
                    got[i] = east_array_get(v, i)->data.float64;
                CHECK(got[0] == 1.5 && got[1] == 2.25 && got[2] == 150.0 && got[3] == 0.001,
                      "under %s the values are the JSON's: %g %g %g %g", chosen, got[0], got[1],
                      got[2], got[3]);
                char *json = east_json_encode(v, floats);
                CHECK(json && strcmp(json, "[1.5,2.25,150,0.001]") == 0,
                      "under %s the encoder writes '.': %s", chosen, json ? json : "(null)");
                free(json);
                east_value_release(v);
            }
            free(err);
            char buf[64];
            east_fmt_double(buf, sizeof buf, 1.5);
            CHECK(strcmp(buf, "1.5") == 0, "under %s east_fmt_double writes '.': %s", chosen, buf);
            east_type_release(floats);
            setlocale(LC_NUMERIC, "C");
        } else {
            printf("test_json_reader: no comma-decimal locale on this host, locale case skipped\n");
        }
    }

    east_type_release(int_struct);
    east_type_release(date_struct);
    east_type_release(blob_struct);
    east_type_release(string_struct);

    if (failures == 0) {
        printf("test_json_reader: all cases passed\n");
        return 0;
    }
    fprintf(stderr, "test_json_reader: %d failure(s)\n", failures);
    return 1;
}
