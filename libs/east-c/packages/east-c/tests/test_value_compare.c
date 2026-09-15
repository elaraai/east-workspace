/*
 * Value ordering gate.
 *
 * east_value_compare is the order behind every Set and Dict, and that order
 * is the canonical wire order the TypeScript, Python and C runtimes all pin
 * through the compliance corpus. Two trims make the common compare cheaper
 * without moving a single result, and this gate pins the results they must
 * not move:
 *
 *   - two structs that borrow their names from one interned type skip the
 *     per-field name compare (the names are the same pointers); a struct
 *     carrying its own copied names — in the type's order or another —
 *     still compares name-then-value exactly as before;
 *   - a same-kind compare no longer ranks both kinds first; kinds still
 *     rank in the documented order when they differ.
 *
 * It also pins east_dict_find, the single search behind the keyed reads
 * that used to ask `has` and then `get`.
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

static int sign(int c)
{
    return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/* {a: x, b: y} in the given name order, stamped with `type` (or NULL). */
static EastValue *pair(const char *n0, int64_t v0, const char *n1, int64_t v1, EastType *type)
{
    const char *names[2] = {n0, n1};
    EastValue *v[2] = {east_integer(v0), east_integer(v1)};
    EastValue *s = east_struct_new(names, v, 2, type);
    east_value_release(v[0]);
    east_value_release(v[1]);
    return s;
}

static void test_struct_names(void)
{
    const char *names[2] = {"a", "b"};
    EastType *types[2] = {&east_integer_type, &east_integer_type};
    EastType *ab = east_struct_type(names, types, 2);

    EastValue *borrowed_12 = pair("a", 1, "b", 2, ab); /* borrows names from ab */
    EastValue *borrowed_13 = pair("a", 1, "b", 3, ab);
    EastValue *copied_12 = pair("a", 1, "b", 2, NULL); /* own copies, same order */
    EastValue *swapped_21 = pair("b", 2, "a", 1, ab);  /* own copies, other order */
    CHECK(borrowed_12->data.struct_.field_names == NULL && copied_12->data.struct_.field_names &&
              swapped_21->data.struct_.field_names,
          "struct names: borrowed / copied / swapped shapes as intended");

    /* Same type, both borrowed: value order decides. */
    CHECK(sign(east_value_compare(borrowed_12, borrowed_13)) == -1 &&
              sign(east_value_compare(borrowed_13, borrowed_12)) == 1 &&
              east_value_compare(borrowed_12, borrowed_12) == 0,
          "struct names: borrowed values order by field values");

    /* Borrowed vs copied with equal names: equal names, then values — the
     * copied value compares equal to its borrowed twin. */
    CHECK(east_value_compare(borrowed_12, copied_12) == 0 &&
              east_value_compare(copied_12, borrowed_12) == 0,
          "struct names: a copied-names twin compares equal to the borrowed one");
    CHECK(sign(east_value_compare(copied_12, borrowed_13)) == -1,
          "struct names: copied vs borrowed still orders by values");

    /* A swapped field order compares its first NAME first: "b" > "a", so the
     * swapped value sorts after every {a, b} value regardless of values. */
    CHECK(sign(east_value_compare(swapped_21, borrowed_12)) == 1 &&
              sign(east_value_compare(borrowed_12, swapped_21)) == -1 &&
              sign(east_value_compare(swapped_21, copied_12)) == 1,
          "struct names: a differing field order still compares by name first");

    /* Equality follows the same rules. */
    CHECK(east_value_equal(borrowed_12, copied_12) && !east_value_equal(borrowed_12, swapped_21),
          "struct names: equality agrees with ordering");

    east_value_release(borrowed_12);
    east_value_release(borrowed_13);
    east_value_release(copied_12);
    east_value_release(swapped_21);
}

static void test_kind_rank(void)
{
    /* NULL < BOOLEAN < INTEGER < FLOAT < STRING < DATETIME < BLOB */
    EastValue *b = east_boolean(true);
    EastValue *i = east_integer(-5);
    EastValue *f = east_float(-1e9);
    EastValue *s = east_string("");
    EastValue *d = east_datetime(0);
    EastValue *n = east_null();
    EastValue *order[6] = {n, b, i, f, s, d};
    for (int x = 0; x < 6; x++) {
        for (int y = 0; y < 6; y++) {
            int c = sign(east_value_compare(order[x], order[y]));
            int want = x < y ? -1 : x > y ? 1 : 0;
            CHECK(c == want, "kind rank: order[%d] vs order[%d] gave %d, expected %d", x, y, c,
                  want);
        }
    }
    east_value_release(b);
    east_value_release(i);
    east_value_release(f);
    east_value_release(s);
    east_value_release(d);
}

static void test_dict_find(void)
{
    EastValue *dict = east_dict_new(&east_integer_type, &east_string_type);
    EastValue *k1 = east_integer(1), *k2 = east_integer(2), *k3 = east_integer(3);
    EastValue *one = east_string("one"), *two = east_string("two");
    east_dict_set(dict, k1, one);
    east_dict_set(dict, k2, two);

    EastValue *out = (EastValue *)1;
    CHECK(east_dict_find(dict, k1, &out) && out == one, "dict find: a present key and its value");
    CHECK(east_dict_find(dict, k2, &out) && out == two, "dict find: the other key");
    out = (EastValue *)1;
    CHECK(!east_dict_find(dict, k3, &out) && out == NULL, "dict find: an absent key clears out");
    CHECK(east_dict_find(dict, k1, NULL), "dict find: a NULL out is a membership test");
    CHECK(east_dict_find(dict, k1, &out) == east_dict_has(dict, k1) &&
              east_dict_find(dict, k3, &out) == east_dict_has(dict, k3),
          "dict find: agrees with has");
    CHECK(!east_dict_find(k1, k1, &out), "dict find: a non-dict answers absent");

    east_value_release(dict);
    east_value_release(k1);
    east_value_release(k2);
    east_value_release(k3);
    east_value_release(one);
    east_value_release(two);
}

int main(void)
{
    test_struct_names();
    test_kind_rank();
    test_dict_find();
    east_type_registry_clear();

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("value compare gate: all checks passed\n");
    return 0;
}
