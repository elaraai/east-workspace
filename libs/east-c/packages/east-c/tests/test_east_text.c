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
 *     end, more than one — print every one escaped and parse back;
 *   - a string is double-quoted: a single-quoted one is refused, as
 *     TypeScript refuses it (#1135);
 *   - a back-reference is written with TypeScript's path components — a
 *     field or case named as the text spells it, a Dict key's text in
 *     brackets, a Ref's content a step `[]` down — and reads back to the one
 *     container, under a quoted name, a key holding `]` or a NUL, and round a
 *     Ref's cycle; one to nothing is refused with TypeScript's message
 *     (#1135).
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

    /* A string is double-quoted: a single-quoted one was once read as one */
    refuses("'a'", &east_string_type, "expected '\"', got '''");
    refuses("\"a\\'b\"", &east_string_type, "unexpected escape sequence in string");

    /* A back-reference to nothing the text holds, or above its root */
    const char *pair[2] = {"a", "b"};
    EastType *ints = east_array_type(&east_integer_type);
    EastType *arrays[2] = {ints, ints};
    EastType *two = east_struct_type(pair, arrays, 2);
    refuses("(a=[1], b=1#.c)", two, "undefined reference 1#.c at .b");
    refuses("(a=[1], b=3#)", two,
            "invalid reference 3#: Invalid relative reference: going up 3 levels from depth 1");
    /* A reference's count of levels is digits alone: a signed one was once
     * read as a count wrapped round, far above the root */
    refuses("(a=[1], b=-1#.a)", two, "expected '[' to start array at .b");
    east_type_release(two);

    /* A back-reference to a container of another type than the text expects
     * where it stands, which read would be a value of the wrong type (#1139) */
    EastType *ints_dict = east_dict_type(&east_integer_type, &east_integer_type);
    EastType *dict_types[2] = {ints, ints_dict};
    EastType *to_dict = east_struct_type(pair, dict_types, 2);
    refuses("(a=[1], b=1#.a)", to_dict,
            "invalid reference 1#.a: it names a value of another type at .b");
    east_type_release(to_dict);
    east_type_release(ints_dict);
    EastType *strings = east_array_type(&east_string_type);
    EastType *string_types[2] = {ints, strings};
    EastType *to_strings = east_struct_type(pair, string_types, 2);
    refuses("(a=[1], b=1#.a)", to_strings,
            "invalid reference 1#.a: it names a value of another type at .b");
    east_type_release(to_strings);
    east_type_release(strings);
    const char *ref_pair[2] = {"r", "x"};
    EastType *ref_ints = east_ref_type(ints);
    EastType *ref_types[2] = {ref_ints, ints};
    EastType *to_ref = east_struct_type(ref_pair, ref_types, 2);
    refuses("(r=&[1], x=1#.r)", to_ref,
            "invalid reference 1#.r: it names a value of another type at .x");
    east_type_release(to_ref);
    east_type_release(ref_ints);
    east_type_release(ints);
}

/* `value` prints as exactly `want` (`want_len` bytes) and parses back, both at
 * their length; the value read back is the caller's. */
static EastValue *reads_back(EastValue *value, EastType *type, const char *want, size_t want_len,
                             const char *what)
{
    size_t len = 0;
    char *text = east_print_value_len(value, type, &len);
    CHECK(text && len == want_len && memcmp(text, want, want_len) == 0,
          "%s prints as TypeScript does, got %.*s", what, (int)len, text ? text : "");
    char *err = NULL;
    EastValue *back = text ? east_parse_value_len(text, len, type, &err) : NULL;
    CHECK(back != NULL, "%s parses back: %s", what, err ? err : "");
    free(err);
    free(text);
    return back;
}

/* `value` prints as exactly `want` (`want_len` bytes) and parses back equal,
 * both at their length. */
static void round_trips(EastValue *value, EastType *type, const char *want, size_t want_len,
                        const char *what)
{
    EastValue *back = reads_back(value, type, want, want_len, what);
    CHECK(!back || east_value_equal(back, value), "%s parses back equal", what);
    if (back) east_value_release(back);
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

/* An array of two integers */
static EastValue *ints_of(int64_t a, int64_t b)
{
    EastValue *arr = east_array_new(&east_integer_type);
    EastValue *x = east_integer(a);
    EastValue *y = east_integer(b);
    east_array_push(arr, x);
    east_array_push(arr, y);
    east_value_release(x);
    east_value_release(y);
    return arr;
}

/* A struct of `holder`, typed `holder_type` and holding `shared`, and then
 * `shared` again: it prints as `want` (`want_len` bytes), and reads back
 * equal, with its second field the very array `held` finds in its first. */
static void shares(const char *holder_name, EastType *holder_type, EastValue *holder,
                   const char *shared_name, EastValue *shared, const char *want, size_t want_len,
                   EastValue *(*held)(EastValue *), const char *what)
{
    const char *names[2] = {holder_name, shared_name};
    EastType *types[2] = {holder_type, east_array_type(&east_integer_type)};
    EastType *st = east_struct_type(names, types, 2);
    EastValue *fields[2] = {holder, shared};
    EastValue *sv = east_struct_new(names, fields, 2, st);
    EastValue *back = reads_back(sv, st, want, want_len, what);
    if (back) {
        CHECK(east_value_equal(back, sv), "%s reads back equal", what);
        CHECK(held(east_struct_get_field_idx(back, 0)) == east_struct_get_field_idx(back, 1),
              "%s reads back to the one array", what);
        east_value_release(back);
    }
    east_value_release(sv);
    east_type_release(st);
}

static EastValue *dict_a_bracket_b(EastValue *d)
{
    EastValue *key = east_string("a]b");
    EastValue *v = east_dict_get(d, key);
    east_value_release(key);
    return v;
}

static EastValue *dict_say_quote(EastValue *d)
{
    EastValue *key = east_string("say \"]\" \\");
    EastValue *v = east_dict_get(d, key);
    east_value_release(key);
    return v;
}

static EastValue *dict_a_nul_c(EastValue *d)
{
    EastValue *key = east_string_len("a\0c", 3);
    EastValue *v = east_dict_get(d, key);
    east_value_release(key);
    return v;
}

static EastValue *variant_payload(EastValue *v)
{
    return v->data.variant.value;
}

static EastValue *itself(EastValue *v)
{
    return v;
}

static void test_back_references(void)
{
    EastType *ints = east_array_type(&east_integer_type);

    /* Under a quoted field name: the reference names the field as the text
     * spells it */
    {
        EastValue *shared = ints_of(1, 2);
        const char want[] = "(`a b`=[1, 2], c=1#.`a b`)";
        shares("a b", ints, shared, "c", shared, want, sizeof(want) - 1, itself,
               "a back-reference under a quoted field name");
        east_value_release(shared);
    }

    /* Under a Dict key holding `]`: the key's text is taken whole */
    {
        EastValue *shared = ints_of(1, 2);
        EastType *dt = east_dict_type(&east_string_type, ints);
        EastValue *d = east_dict_new(&east_string_type, ints);
        EastValue *key = east_string("a]b");
        east_dict_set(d, key, shared);
        const char want[] = "(d={\"a]b\":[1, 2]}, x=1#.d[\"a]b\"])";
        shares("d", dt, d, "x", shared, want, sizeof(want) - 1, dict_a_bracket_b,
               "a back-reference under a Dict key holding ]");
        east_value_release(key);
        east_value_release(d);
        east_value_release(shared);
        east_type_release(dt);
    }

    /* Under a Dict key holding a quote, a `]` and a backslash, each escaped in
     * the key's text: an escaped quote ends no string */
    {
        EastValue *shared = ints_of(1, 2);
        EastType *dt = east_dict_type(&east_string_type, ints);
        EastValue *d = east_dict_new(&east_string_type, ints);
        EastValue *key = east_string("say \"]\" \\");
        east_dict_set(d, key, shared);
        const char want[] = "(d={\"say \\\"]\\\" \\\\\":[1, 2]}, x=1#.d[\"say \\\"]\\\" \\\\\"])";
        shares("d", dt, d, "x", shared, want, sizeof(want) - 1, dict_say_quote,
               "a back-reference under a Dict key holding an escaped quote");
        east_value_release(key);
        east_value_release(d);
        east_value_release(shared);
        east_type_release(dt);
    }

    /* Under one of two Dict keys alike up to a NUL: a key's text is matched
     * at its length, so the reference names the second, not the first */
    {
        EastValue *first = ints_of(1, 2);
        EastValue *shared = ints_of(3, 4);
        EastType *dt = east_dict_type(&east_string_type, ints);
        EastValue *d = east_dict_new(&east_string_type, ints);
        EastValue *k1 = east_string_len("a\0b", 3);
        EastValue *k2 = east_string_len("a\0c", 3);
        east_dict_set(d, k1, first);
        east_dict_set(d, k2, shared);
        const char want[] = "(d={\"a\0b\":[1, 2],\"a\0c\":[3, 4]}, x=1#.d[\"a\0c\"])";
        shares("d", dt, d, "x", shared, want, sizeof(want) - 1, dict_a_nul_c,
               "a back-reference under a Dict key holding a NUL");
        east_value_release(k1);
        east_value_release(k2);
        east_value_release(d);
        east_value_release(first);
        east_value_release(shared);
        east_type_release(dt);
    }

    /* Under a quoted case name: the case is a step down, named as the text
     * spells it */
    {
        EastValue *shared = ints_of(1, 2);
        const char *cases[2] = {"my case", "other"};
        EastType *case_types[2] = {ints, &east_null_type};
        EastType *vt = east_variant_type(cases, case_types, 2);
        EastValue *v = east_variant_new("my case", shared, vt);
        const char want[] = "(v=.`my case` [1, 2], x=1#.v.`my case`)";
        shares("v", vt, v, "x", shared, want, sizeof(want) - 1, variant_payload,
               "a back-reference under a quoted case name");
        east_value_release(v);
        east_value_release(shared);
        east_type_release(vt);
    }

    /* Through a Ref: its content is a step `[]` down from it */
    {
        EastValue *shared = ints_of(1, 2);
        EastType *rt = east_ref_type(ints);
        EastValue *r = east_ref_new(shared);
        const char want[] = "(r=&[1, 2], x=1#.r[])";
        shares("r", rt, r, "x", shared, want, sizeof(want) - 1, east_ref_get,
               "a back-reference to a Ref's content");
        east_value_release(r);
        east_value_release(shared);
        east_type_release(rt);
    }

    /* Round a Ref's cycle, Node = Ref<Array<Node>>: the Ref is registered
     * before its content, so the reference in it reads back to the Ref */
    {
        EastType *rec = east_recursive_type_new();
        east_recursive_type_set(rec, east_ref_type(east_array_type(rec)));
        EastType *node = east_recursive_type_intern(rec);
        EastValue *arr = east_array_new(node);
        EastValue *r = east_ref_new(arr);
        east_array_push(arr, r);
        east_value_release(arr);
        EastValue *back = reads_back(r, node, "&[2#]", 5, "a Ref's cycle");
        if (back) {
            CHECK(east_array_get(east_ref_get(back), 0) == back, "a Ref's cycle reads back to it");
            east_ref_set(back, east_null());
            east_value_release(back);
        }
        east_ref_set(r, east_null());
        east_value_release(r);
    }

    east_type_release(ints);
}

int main(void)
{
    test_refusals();
    test_strings();
    test_identifiers();
    test_back_references();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("east text gate: all checks passed\n");
    return 0;
}
