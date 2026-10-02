/*
 * East text gate (#964).
 *
 * A string's East text escapes `\` and `"`, and a quoted identifier's `\` and
 * a backtick: every other character is written as itself, as the TypeScript
 * printer writes it. The compliance corpus pins the printed text against
 * TypeScript's through the IR every runtime runs; this gate pins what no IR
 * reaches, the host entry points:
 *
 *   - east_parse_value, the plain entry the python bridge and the CLI read
 *     text through, refuses what east_parse_value_with_error refuses — an
 *     escape the grammar has no meaning for, which it once read with the
 *     backslash dropped, a field missing or out of order, trailing input —
 *     rather than answer a wrong value;
 *   - a string holding every control character, a NUL among them, prints and
 *     parses back at its length, through east_print_value_len and
 *     east_parse_value_len;
 *   - field and case names holding backslashes and backticks — one at the
 *     end, more than one — print every one escaped and parse back.
 */
#include <east/east.h>

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

/* The plain entry refuses `text`, and the entry that says why says `why`. */
static void refuses(const char *text, EastType *type, const char *why)
{
    EastValue *plain = east_parse_value(text, type);
    CHECK(plain == NULL, "east_parse_value refuses %s", text);
    if (plain) east_value_release(plain);
    char *err = NULL;
    EastValue *v = east_parse_value_with_error(text, type, &err);
    CHECK(v == NULL && err && strstr(err, why),
          "east_parse_value_with_error refuses %s saying %s, got %s", text, why,
          err ? err : "(no message)");
    if (v) east_value_release(v);
    free(err);
}

static void test_refusals(void)
{
    /* Escapes the grammar has no meaning for: once read as "atb", "au0009b" */
    refuses("\"a\\tb\"", &east_string_type, "unexpected escape sequence in string");
    refuses("\"a\\u0009b\"", &east_string_type, "unexpected escape sequence in string");
    refuses("\"a\\nb\"", &east_string_type, "unexpected escape sequence in string");
    refuses("\"ok\" more", &east_string_type, "unexpected input after parsed value");

    /* A struct is read whole and in order: a missing field was once null */
    const char *names[2] = {"a", "b"};
    EastType *types[2] = {&east_integer_type, &east_integer_type};
    EastType *ab = east_struct_type(names, types, 2);
    refuses("(a=1)", ab, "missing required field 'b'");
    refuses("(b=2, a=1)", ab, "unknown field 'b'");
    east_type_release(ab);

    /* A quoted name holds only the two escapes, and closes */
    const char *id[1] = {"id"};
    EastType *one[1] = {&east_integer_type};
    EastType *s = east_struct_type(id, one, 1);
    refuses("(`id\\x`=1)", s, "missing required field 'id'");
    east_type_release(s);
    const char *spaced[1] = {"a b"};
    EastType *v = east_variant_type(spaced, one, 1);
    refuses(".`a\\x` 1", v, "unexpected escape sequence in identifier");
    refuses(".`a b 1", v, "unterminated identifier (missing closing `)");
    east_type_release(v);
}

/* `value` prints as exactly `want` (`want_len` bytes) and parses back equal,
 * both at their length. */
static void round_trips(EastValue *value, EastType *type, const char *want, size_t want_len,
                        const char *what)
{
    size_t len = 0;
    char *text = east_print_value_len(value, type, &len);
    CHECK(text && len == want_len && memcmp(text, want, want_len) == 0,
          "%s prints as TypeScript does", what);
    char *err = NULL;
    EastValue *back = text ? east_parse_value_len(text, len, type, &err) : NULL;
    CHECK(back && east_value_equal(back, value), "%s parses back: %s", what, err ? err : "unequal");
    if (back) east_value_release(back);
    free(err);
    free(text);
}

static void test_strings(void)
{
    /* Every C0 control character, a NUL first among them, DEL, a quote and a
     * backslash: only the last two are escaped. */
    char raw[40];
    size_t n = 0;
    for (int c = 0; c < 32; c++)
        raw[n++] = (char)c;
    raw[n++] = 0x7f;
    raw[n++] = '"';
    raw[n++] = '\\';
    char want[48];
    size_t w = 0;
    want[w++] = '"';
    for (size_t i = 0; i < n; i++) {
        if (raw[i] == '"' || raw[i] == '\\') want[w++] = '\\';
        want[w++] = raw[i];
    }
    want[w++] = '"';
    EastValue *s = east_string_len(raw, n);
    round_trips(s, &east_string_type, want, w, "a string of every control character");
    east_value_release(s);

    /* Text holding a NUL, read at its length: the NUL is the string's */
    const char text[] = {'"', 'a', '\0', 'b', '"'};
    char *err = NULL;
    EastValue *at_length = east_parse_value_len(text, sizeof(text), &east_string_type, &err);
    CHECK(at_length && at_length->data.string.len == 3 &&
              memcmp(at_length->data.string.data, "a\0b", 3) == 0,
          "a NUL in the text is read as itself: %s", err ? err : "");
    if (at_length) east_value_release(at_length);
    free(err);
}

static void test_identifiers(void)
{
    struct {
        const char *name;
        const char *field_text;
        const char *case_text;
    } names[] = {
        {"a\\", "(`a\\\\`=1)", ".`a\\\\` 1"},
        {"a`", "(`a\\``=1)", ".`a\\`` 1"},
        {"a\\b\\c", "(`a\\\\b\\\\c`=1)", ".`a\\\\b\\\\c` 1"},
        {"a`b`c", "(`a\\`b\\`c`=1)", ".`a\\`b\\`c` 1"},
        {"my case", "(`my case`=1)", ".`my case` 1"},
    };
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        const char *name[1] = {names[i].name};
        EastType *types[1] = {&east_integer_type};

        EastType *st = east_struct_type(name, types, 1);
        EastValue *field[1] = {east_integer(1)};
        EastValue *sv = east_struct_new(name, field, 1, st);
        round_trips(sv, st, names[i].field_text, strlen(names[i].field_text), names[i].field_text);
        east_value_release(field[0]);
        east_value_release(sv);
        east_type_release(st);

        EastType *vt = east_variant_type(name, types, 1);
        EastValue *payload = east_integer(1);
        EastValue *vv = east_variant_new(names[i].name, payload, vt);
        round_trips(vv, vt, names[i].case_text, strlen(names[i].case_text), names[i].case_text);
        east_value_release(payload);
        east_value_release(vv);
        east_type_release(vt);
    }
}

int main(void)
{
    test_refusals();
    test_strings();
    test_identifiers();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("east text gate: all checks passed\n");
    return 0;
}
