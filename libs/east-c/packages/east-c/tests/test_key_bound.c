/*
 * Gate for issue #1616, D2: a bound of a key range.
 *
 * A bound is a leading part of a Dict's key or a Set's element. Asserted here,
 * as TypeScript's `key_bound.spec.ts` asserts it for its copy of the rule:
 *
 *   1. the types that are a key's type cut short — the whole key, its first
 *      fields in order, its last field given cut short the same way — and the
 *      ones that are not: a later field alone, fields out of order, a field of
 *      another type, an earlier field cut short, no field at all;
 *   2. the words a bound of any other type is refused in, to the letter the
 *      words TypeScript refuses it in, the dash among them, and a prefix
 *      refused on every key that is not a struct;
 *   3. how a key stands to a bound: for keys made from a seed, over floats
 *      with NaN, both zeros and both infinities, options, variants and a
 *      nested struct, "at or past the bound" is false, then true, over the
 *      keys in order, and is what comparing the leading leaves one at a time
 *      gives; a bound that is the whole key stands as the key's own order
 *      does;
 *   4. the comparison never reads past a value's fields: handed a bound type
 *      longer than a value, it stops at the fewest fields any of them holds.
 *
 * Run under ASan/LSan too (scripts/run_leak_check.sh): a read past a value's
 * fields is a heap overflow there.
 */
#include <east/east.h>

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void check(bool ok, const char *what)
{
    if (!ok) {
        printf("FAIL: %s\n", what);
        failures++;
    }
}

/* A fixed-seed LCG: the same keys on every run and platform. */
static uint64_t rng_state = 0x1616161616161616ull;
static uint32_t rng(void)
{
    rng_state = rng_state * 6364136223846793005ull + 1442695040888963407ull;
    return (uint32_t)(rng_state >> 33);
}

static EastType *struct_of(const char **names, EastType **types, size_t count)
{
    return east_struct_type(names, types, count);
}

/* ---- the key types ------------------------------------------------------ */

/* Sheets printed, keyed by press, day and job. */
static EastType *sheets_type(void)
{
    const char *names[] = {"press", "day", "job"};
    EastType *types[] = {&east_string_type, &east_datetime_type, &east_string_type};
    return struct_of(names, types, 3);
}

/* An index's key: the index key, its parts a struct of their own, then the row's key. */
static EastType *level_type(void)
{
    const char *names[] = {"day", "week"};
    EastType *types[] = {&east_null_type, &east_null_type};
    return east_variant_type(names, types, 2);
}

static EastType *on_type(size_t fields)
{
    const char *names[] = {"hall", "press"};
    EastType *types[] = {&east_string_type, &east_string_type};
    return struct_of(names, types, fields);
}

static EastType *ik_type(EastType *on, size_t fields)
{
    const char *names[] = {"on", "key", "level", "tile"};
    EastType *types[] = {on, &east_string_type, level_type(), &east_integer_type};
    return struct_of(names, types, fields);
}

static EastType *indexed_type(void)
{
    const char *names[] = {"ik", "k"};
    EastType *types[] = {ik_type(on_type(2), 4), &east_string_type};
    return struct_of(names, types, 2);
}

/* A struct of one field. */
static EastType *one_field(const char *name, EastType *type)
{
    const char *names[] = {name};
    EastType *types[] = {type};
    return struct_of(names, types, 1);
}

static EastType *option_of(EastType *inner)
{
    const char *names[] = {"none", "some"};
    EastType *types[] = {&east_null_type, inner};
    return east_variant_type(names, types, 2);
}

/* ---- 1: a bound's type is the key's type cut short ---------------------- */

static void test_bound_types(void)
{
    EastType *sheets = sheets_type();
    EastType *indexed = indexed_type();

    check(east_key_bound_type_ok(sheets, sheets), "the whole key is a bound");
    check(east_key_bound_type_ok(sheets, one_field("press", &east_string_type)),
          "the key's first field is a bound");
    {
        const char *names[] = {"press", "day"};
        EastType *types[] = {&east_string_type, &east_datetime_type};
        check(east_key_bound_type_ok(sheets, struct_of(names, types, 2)),
              "the key's first two fields are a bound");
    }
    check(east_key_bound_type_ok(indexed, one_field("ik", ik_type(on_type(1), 1))),
          "a nested struct's first field is a bound: the last field given cut short");
    check(east_key_bound_type_ok(indexed, one_field("ik", ik_type(on_type(2), 2))),
          "a nested struct whole, then the next field, is a bound");
    check(east_key_bound_type_ok(indexed, one_field("ik", ik_type(on_type(2), 4))),
          "the first field whole is a bound");
    check(east_key_bound_type_ok(&east_string_type, &east_string_type),
          "a key that is not a struct is bounded by its own type");
    check(east_key_bound_type_ok(option_of(&east_integer_type), option_of(&east_integer_type)),
          "an option key is bounded by its own type");

    check(!east_key_bound_type_ok(sheets, one_field("day", &east_datetime_type)),
          "a later field alone is no bound");
    {
        const char *names[] = {"day", "press"};
        EastType *types[] = {&east_datetime_type, &east_string_type};
        check(!east_key_bound_type_ok(sheets, struct_of(names, types, 2)),
              "fields out of order are no bound");
    }
    check(!east_key_bound_type_ok(sheets, one_field("press", &east_integer_type)),
          "a field of another type is no bound");
    {
        const char *names[] = {"press", "day"};
        EastType *types[] = {&east_string_type, &east_string_type};
        check(!east_key_bound_type_ok(sheets, struct_of(names, types, 2)),
              "a second field of another type is no bound");
    }
    {
        const char *names[] = {"press", "day", "job", "more"};
        EastType *types[] = {&east_string_type, &east_datetime_type, &east_string_type,
                             &east_string_type};
        check(!east_key_bound_type_ok(sheets, struct_of(names, types, 4)),
              "more fields than the key has are no bound");
    }
    check(!east_key_bound_type_ok(indexed, one_field("ik", ik_type(on_type(1), 2))),
          "only the last field a bound gives may be cut short");
    check(!east_key_bound_type_ok(sheets, struct_of(NULL, NULL, 0)), "no field at all is no bound");
    check(!east_key_bound_type_ok(&east_string_type, &east_integer_type),
          "another type is no bound of a key that is not a struct");
    check(!east_key_bound_type_ok(&east_string_type, one_field("press", &east_string_type)),
          "a struct is no bound of a key that is not one");
    check(!east_key_bound_type_ok(sheets, NULL) && !east_key_bound_type_ok(NULL, sheets),
          "no type is no bound");
}

/* ---- 2: the words of a refusal ------------------------------------------ */

static void check_refusal(EastKeyBoundName name, EastType *key, EastType *bound,
                          const char *expected, const char *what)
{
    char *words = east_key_bound_refusal(name, key, bound);
    bool same = expected == NULL ? words == NULL : words != NULL && strcmp(words, expected) == 0;
    if (!same)
        printf("  got: %s\n  want: %s\n", words ? words : "(none)", expected ? expected : "(none)");
    check(same, what);
    free(words);
}

static void test_refusals(void)
{
    EastType *sheets = sheets_type();
    EastType *indexed = indexed_type();
    {
        const char *names[] = {"press", "day"};
        EastType *types[] = {&east_string_type, &east_datetime_type};
        check_refusal(EAST_KEY_BOUND_FROM, sheets, struct_of(names, types, 2), NULL,
                      "a leading part of the key is not refused");
    }
    check_refusal(EAST_KEY_BOUND_FROM, sheets, one_field("day", &east_datetime_type),
                  "a range's `from` is no leading part of the key: a bound gives the key's first "
                  "fields in order \xe2\x80\x94 press, day, job",
                  "a `from` that is no leading part names the key's fields in order");
    check_refusal(
        EAST_KEY_BOUND_TO, indexed, one_field("k", &east_string_type),
        "a range's `to` is no leading part of the key: a bound gives the key's first "
        "fields in order \xe2\x80\x94 ik.on.hall, ik.on.press, ik.key, ik.level, ik.tile, k",
        "a `to` that is no leading part names the leaves through nested structs");
    check_refusal(EAST_KEY_BOUND_PREFIX, sheets, one_field("job", &east_string_type),
                  "a prefix is no leading part of the key: a bound gives the key's first fields in "
                  "order \xe2\x80\x94 press, day, job",
                  "a prefix that is no leading part is refused in the same words");
    check_refusal(EAST_KEY_BOUND_PREFIX, sheets, NULL,
                  "a prefix is no leading part of the key: a bound gives the key's first fields in "
                  "order \xe2\x80\x94 press, day, job",
                  "a bound of no type is refused as no leading part");
    check_refusal(EAST_KEY_BOUND_TO, &east_string_type, &east_integer_type,
                  "a range's `to` is not the key's type: a bound of a String key is a String",
                  "a bound of another type on a key that is not a struct names the key's type");
    check_refusal(EAST_KEY_BOUND_FROM, &east_string_type, &east_string_type, NULL,
                  "a key that is not a struct is bounded by its own type");
    check_refusal(
        EAST_KEY_BOUND_PREFIX, &east_string_type, &east_string_type,
        "a prefix gives the first fields of a struct key, and this key is a String: read "
        "one key with `get`, or the keys between two with `range`",
        "a prefix of a String key is refused whatever its type, naming `get` and `range`");
    check_refusal(
        EAST_KEY_BOUND_PREFIX, level_type(), level_type(),
        "a prefix gives the first fields of a struct key, and this key is a Variant: read "
        "one key with `get`, or the keys between two with `range`",
        "a prefix of a Variant key is refused");
}

/* ---- 3: how a key stands to a bound ------------------------------------- */

/* A key whose leaves hold the orders that are easy to get wrong:
 * { x: Float, tag: Option<String>, what: Variant{ a: Integer, b: Null }, at: { day: DateTime, n:
 * Integer } }. */
#define ODD_LEAVES 5
static EastType *odd_what, *odd_tag, *odd_at, *odd_type;

static void odd_types(void)
{
    odd_tag = option_of(&east_string_type);
    {
        const char *names[] = {"a", "b"};
        EastType *types[] = {&east_integer_type, &east_null_type};
        odd_what = east_variant_type(names, types, 2);
    }
    {
        const char *names[] = {"day", "n"};
        EastType *types[] = {&east_datetime_type, &east_integer_type};
        odd_at = struct_of(names, types, 2);
    }
    const char *names[] = {"x", "tag", "what", "at"};
    EastType *types[] = {&east_float_type, odd_tag, odd_what, odd_at};
    odd_type = struct_of(names, types, 4);
}

static EastValue *odd_x(void)
{
    static const double floats[] = {NAN, -INFINITY, INFINITY, -0.0, 0.0, -1.5, 2.25, 1e300};
    return east_float(floats[rng() % 8]);
}

static EastValue *odd_tag_value(void)
{
    static const char *const tags[] = {"", "a", "b\xf0\x9f\x98\x80", "\xef\xbf\xbf"};
    uint32_t pick = rng() % 5;
    if (pick == 4) return east_variant_new("none", east_null(), odd_tag);
    EastValue *text = east_string(tags[pick]);
    EastValue *some = east_variant_new("some", text, odd_tag);
    east_value_release(text);
    return some;
}

static EastValue *odd_what_value(void)
{
    uint32_t pick = rng() % 3;
    if (pick == 2) return east_variant_new("b", east_null(), odd_what);
    EastValue *n = east_integer(pick == 0 ? -1 : 7);
    EastValue *a = east_variant_new("a", n, odd_what);
    east_value_release(n);
    return a;
}

static EastValue *odd_day(void)
{
    static const int64_t days[] = {0, 1780272000000, 1780272000001};
    return east_datetime(days[rng() % 3]);
}

/* A key, or the first `at_fields` fields of its nested struct with it: every
 * leaf its own value, made from the seed. */
static EastValue *odd_key(void)
{
    EastValue *day = odd_day();
    EastValue *n = east_integer((int64_t)(rng() % 3));
    const char *at_names[] = {"day", "n"};
    EastValue *at_values[] = {day, n};
    EastValue *at = east_struct_new(at_names, at_values, 2, odd_at);
    east_value_release(day);
    east_value_release(n);

    EastValue *x = odd_x();
    EastValue *tag = odd_tag_value();
    EastValue *what = odd_what_value();
    const char *names[] = {"x", "tag", "what", "at"};
    EastValue *values[] = {x, tag, what, at};
    EastValue *key = east_struct_new(names, values, 4, odd_type);
    east_value_release(x);
    east_value_release(tag);
    east_value_release(what);
    east_value_release(at);
    return key;
}

/* The leaf of a key at `leaf` (0 to 4), borrowed. */
static EastValue *odd_leaf(EastValue *key, size_t leaf)
{
    if (leaf < 3) return east_struct_get_field_idx(key, leaf);
    return east_struct_get_field_idx(east_struct_get_field_idx(key, 3), leaf - 3);
}

/* The type of a bound that gives the key's first `leaves` leaves, 1 to 5. */
static EastType *odd_bound_type(size_t leaves)
{
    const char *names[] = {"x", "tag", "what", "at"};
    EastType *types[] = {&east_float_type, odd_tag, odd_what, odd_at};
    if (leaves <= 3) return struct_of(names, types, leaves);
    if (leaves == 4) types[3] = one_field("day", &east_datetime_type);
    return struct_of(names, types, 4);
}

/* A bound that gives the first `leaves` leaves of `key`, of `type`. */
static EastValue *odd_bound(EastValue *key, size_t leaves, EastType *type)
{
    const char *names[] = {"x", "tag", "what", "at"};
    EastValue *values[4];
    size_t fields = leaves <= 3 ? leaves : 4;
    for (size_t i = 0; i < fields && i < 3; i++)
        values[i] = east_struct_get_field_idx(key, i);
    EastValue *cut = NULL;
    if (leaves == 4) {
        const char *at_names[] = {"day"};
        EastValue *at_values[] = {odd_leaf(key, 3)};
        cut = east_struct_new(at_names, at_values, 1, type->data.struct_.fields[3].type);
        values[3] = cut;
    } else if (leaves == 5) {
        values[3] = east_struct_get_field_idx(key, 3);
    }
    EastValue *bound = east_struct_new(names, values, fields, type);
    if (cut) east_value_release(cut);
    return bound;
}

static int compare_keys(const void *a, const void *b)
{
    return east_value_compare(*(EastValue *const *)a, *(EastValue *const *)b);
}

#define KEYS 400
#define TRIALS 60

static void test_compare(void)
{
    odd_types();
    EastValue *keys[KEYS];
    for (size_t i = 0; i < KEYS; i++)
        keys[i] = odd_key();
    qsort(keys, KEYS, sizeof(keys[0]), compare_keys);

    bool monotone = true;
    bool as_leaves = true;
    bool whole_as_key = true;
    for (size_t leaves = 1; leaves <= ODD_LEAVES; leaves++) {
        EastType *type = odd_bound_type(leaves);
        check(east_key_bound_type_ok(odd_type, type), "a bound of each length is a leading part");
        for (size_t trial = 0; trial < TRIALS; trial++) {
            EastValue *from = odd_key();
            EastValue *bound = odd_bound(from, leaves, type);
            bool held = false;
            for (size_t i = 0; i < KEYS; i++) {
                int stands = east_key_bound_compare(keys[i], bound, type);
                /* False, then true: never false again once it has held. */
                if (stands >= 0)
                    held = true;
                else if (held)
                    monotone = false;
                /* The oracle: the leading leaves compared one at a time. */
                int oracle = 0;
                for (size_t leaf = 0; leaf < leaves && oracle == 0; leaf++)
                    oracle = east_value_compare(odd_leaf(keys[i], leaf), odd_leaf(from, leaf));
                if ((stands > 0) != (oracle > 0) || (stands < 0) != (oracle < 0)) as_leaves = false;
                /* A bound that is the whole key stands as the key's own order does. */
                if (leaves == ODD_LEAVES) {
                    int own = east_value_compare(keys[i], from);
                    if ((stands > 0) != (own > 0) || (stands < 0) != (own < 0))
                        whole_as_key = false;
                }
            }
            east_value_release(bound);
            east_value_release(from);
        }
    }
    check(monotone, "at or past a bound is false, then true, over the keys in order");
    check(as_leaves, "a key stands to a bound as its leading leaves compare, one at a time");
    check(whole_as_key, "a bound that is the whole key stands as the key's own order does");

    /* The zeros and NaN order as East orders them. */
    EastType *x_only = odd_bound_type(1);
    EastValue *at = odd_key();
    const char *names[] = {"x"};
    EastValue *minus_zero = east_float(-0.0);
    EastValue *zero = east_float(0.0);
    EastValue *nan = east_float(NAN);
    EastValue *inf = east_float(INFINITY);
    const char *key_names[] = {"x", "tag", "what", "at"};
    EastValue *key_fields[] = {minus_zero, east_struct_get_field_idx(at, 1),
                               east_struct_get_field_idx(at, 2), east_struct_get_field_idx(at, 3)};
    EastValue *key = east_struct_new(key_names, key_fields, 4, odd_type);
    EastValue *b_minus = east_struct_new(names, &minus_zero, 1, x_only);
    EastValue *b_zero = east_struct_new(names, &zero, 1, x_only);
    EastValue *b_nan = east_struct_new(names, &nan, 1, x_only);
    EastValue *b_inf = east_struct_new(names, &inf, 1, x_only);
    check(east_key_bound_compare(key, b_minus, x_only) == 0, "a key of -0 is at a bound of -0");
    check(east_key_bound_compare(key, b_zero, x_only) < 0, "a key of -0 is before a bound of 0");
    check(east_key_bound_compare(key, b_inf, x_only) < 0, "and before a bound of infinity");
    check(east_key_bound_compare(key, b_nan, x_only) < 0, "and before a bound of NaN");
    key_fields[0] = nan;
    EastValue *nan_key = east_struct_new(key_names, key_fields, 4, odd_type);
    check(east_key_bound_compare(nan_key, b_inf, x_only) > 0,
          "a key of NaN is past a bound of infinity");
    check(east_key_bound_compare(nan_key, b_nan, x_only) == 0, "and at a bound of NaN");

    /* ---- 4: never past a value's fields ---- */
    /* A bound type that names more fields than the bound's value holds: the
     * walk stops at the value's own fields. */
    check(east_key_bound_compare(key, b_minus, odd_type) == 0,
          "a bound value shorter than its type is read to its own fields alone");
    check(east_key_bound_compare(b_minus, key, odd_type) == 0,
          "and a key shorter than the bound is read to its own");
    /* A key that is not a struct under a struct bound falls back to the values' own order. */
    check(east_key_bound_compare(zero, b_zero, x_only) == east_value_compare(zero, b_zero),
          "a key that is no struct is compared as the values order");
    check(east_key_bound_compare(zero, minus_zero, &east_float_type) > 0,
          "a key that is not a struct stands to its bound by East's order");

    east_value_release(nan_key);
    east_value_release(b_inf);
    east_value_release(b_nan);
    east_value_release(b_zero);
    east_value_release(b_minus);
    east_value_release(key);
    east_value_release(inf);
    east_value_release(nan);
    east_value_release(zero);
    east_value_release(minus_zero);
    east_value_release(at);
    for (size_t i = 0; i < KEYS; i++)
        east_value_release(keys[i]);
}

int main(void)
{
    east_type_of_type_init();

    printf("key bound gate (issue #1616)\n");
    test_bound_types();
    test_refusals();
    test_compare();

    if (failures == 0) {
        printf("GATE PASS: a bound is a leading part of the key, refused in TypeScript's words "
               "when it is not, and a key stands to it as its leading leaves compare (issue "
               "#1616)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
