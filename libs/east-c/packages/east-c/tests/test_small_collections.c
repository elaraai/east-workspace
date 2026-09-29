/*
 * Gate for issue #1005: a small Set or Dict costs what it holds.
 *
 * A one-entry Dict<Integer, Integer> occupied ~4.4 KB and a one-element
 * Set<Integer> ~2.4 KB, against ~0.3 KB for a one-element Array: each held a
 * B-tree whose first leaf is allocated whole, 255 slots. Now a Set keeps up to
 * EAST_SMALL_COLLECTION_MAX elements in `items`, and a Dict its entries in
 * `keys`/`values` — sorted, a reference held for each, no tree — and one more
 * moves them into a tree, whose cache the arrays then become. Asserted here:
 *
 *   1. the representation — no tree while small, arrays exactly as large as
 *      a capacity hint asks and never more than twice what they hold, a tree
 *      past the boundary, and small again once cleared;
 *   2. every operation — insert, has, find/get, delete, pop, clear, indexed
 *      and visited order — against a reference model, in random order, as the
 *      collections grow past the boundary, shrink back under it as trees, and
 *      are cleared and grow again;
 *   3. ownership — each element holds exactly the references the model says
 *      the collection keeps, a Dict's replaced key and value are released, and
 *      a pop hands its value's reference to the caller;
 *   4. one collection, two representations — a tree shrunk to a few elements
 *      and a small collection of the same elements are equal, order equal, and
 *      print alike.
 *
 * Like test_value_layout (#423), it asserts the representation rather than
 * process RSS, so it is deterministic across platforms and allocators. Run
 * under ASan/LSan too (scripts/run_leak_check.sh's build-asan config): the small
 * store owns its references, so a missed release or a double one is a leak or
 * a use-after-free there.
 */
#include <east/east.h>

#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int failures = 0;

static void check(bool ok, const char *what)
{
    if (!ok) {
        printf("FAIL: %s\n", what);
        failures++;
    }
}

/* A fixed-seed LCG: the same operations on every run and platform. */
static uint64_t rng_state = 0x9E3779B97F4A7C15ull;
static uint32_t rng(void)
{
    rng_state = rng_state * 6364136223846793005ull + 1442695040888963407ull;
    return (uint32_t)(rng_state >> 33);
}

/* Keys range over three times the boundary, so the collections cross it. */
#define KEYS (3 * EAST_SMALL_COLLECTION_MAX)
#define STEPS 24000

/* The chance, in tenths, that a step inserts rather than removes: the
 * collections grow past the boundary, shrink back under it as trees, are
 * cleared at the midpoint, and grow and shrink again. */
static unsigned insert_tenths(size_t step)
{
    if (step < STEPS / 4) return 8;
    if (step < STEPS / 2) return 2;
    if (step < 3 * STEPS / 4) return 7;
    return 3;
}

/* ---- 1: the representation --------------------------------------------- */

static void test_representation(void)
{
    EastType *it = &east_integer_type;
    EastValue *keys[EAST_SMALL_COLLECTION_MAX + 1];
    for (size_t k = 0; k <= EAST_SMALL_COLLECTION_MAX; k++)
        keys[k] = east_integer((int64_t)k);

    EastValue *set = east_set_new(it);
    EastValue *dict = east_dict_new(it, it);
    check(set->data.set.tree == NULL && set->data.set.items == NULL,
          "an empty set allocates nothing besides its node");
    check(dict->data.dict.tree == NULL && dict->data.dict.keys == NULL,
          "an empty dict allocates nothing besides its node");

    east_set_insert(set, keys[0]);
    east_dict_set(dict, keys[0], keys[0]);
    check(set->data.set.tree == NULL, "a one-element set holds no tree");
    check(set->data.set.cap == 1, "and room for its one element");
    check(dict->data.dict.tree == NULL, "a one-entry dict holds no tree");
    check(dict->data.dict.cap == 1, "and room for its one entry");
    printf("  one-element Set: %zu bytes besides its node; one-entry Dict: %zu\n",
           set->data.set.cap * sizeof(EastValue *), 2 * dict->data.dict.cap * sizeof(EastValue *));

    /* In reverse, so every insert shifts what is there. */
    for (size_t k = EAST_SMALL_COLLECTION_MAX - 1; k >= 1; k--) {
        east_set_insert(set, keys[k]);
        east_dict_set(dict, keys[k], keys[k]);
        check(set->data.set.cap <= 2 * set->data.set.len,
              "a set's `items` stays within twice its elements");
        check(dict->data.dict.cap <= 2 * dict->data.dict.len,
              "a dict's arrays stay within twice its entries");
    }
    check(set->data.set.len == EAST_SMALL_COLLECTION_MAX && set->data.set.tree == NULL,
          "a set at the boundary is still small");
    check(dict->data.dict.len == EAST_SMALL_COLLECTION_MAX && dict->data.dict.tree == NULL,
          "a dict at the boundary is still small");

    east_set_insert(set, keys[EAST_SMALL_COLLECTION_MAX]);
    east_dict_set(dict, keys[EAST_SMALL_COLLECTION_MAX], keys[EAST_SMALL_COLLECTION_MAX]);
    check(set->data.set.tree != NULL, "one element past the boundary, a set is a tree");
    check(dict->data.dict.tree != NULL, "one entry past the boundary, a dict is a tree");
    check(east_set_len(set) == EAST_SMALL_COLLECTION_MAX + 1, "the move loses no element");
    check(east_dict_len(dict) == EAST_SMALL_COLLECTION_MAX + 1, "the move loses no entry");
    for (size_t k = 0; k <= EAST_SMALL_COLLECTION_MAX; k++) {
        check(east_set_at(set, k) == keys[k], "the tree's set holds every element in order");
        check(east_dict_key_at(dict, k) == keys[k] && east_dict_val_at(dict, k) == keys[k],
              "the tree's dict holds every entry in order");
    }

    east_set_clear(set);
    east_dict_clear(dict);
    check(set->data.set.tree == NULL && set->data.set.items == NULL,
          "a cleared set is small again, holding nothing");
    check(dict->data.dict.tree == NULL && dict->data.dict.keys == NULL,
          "a cleared dict is small again, holding nothing");
    east_value_release(set);
    east_value_release(dict);

    /* A capacity hint sizes the arrays exactly, where the collection stays small. */
    EastValue *hinted_set = east_set_new_with_capacity(it, 3);
    EastValue *hinted_dict = east_dict_new_with_capacity(it, it, 3);
    check(hinted_set->data.set.cap == 3 && hinted_set->data.set.tree == NULL,
          "a set hinted at 3 elements has room for exactly 3");
    check(hinted_dict->data.dict.cap == 3 && hinted_dict->data.dict.tree == NULL,
          "a dict hinted at 3 entries has room for exactly 3");
    east_value_release(hinted_set);
    east_value_release(hinted_dict);
    EastValue *large_set = east_set_new_with_capacity(it, 10 * EAST_SMALL_COLLECTION_MAX);
    check(large_set->data.set.cap == 0,
          "a hint past the boundary reserves nothing: the elements go into a tree");
    east_value_release(large_set);

    for (size_t k = 0; k <= EAST_SMALL_COLLECTION_MAX; k++) {
        check(keys[k]->ref_count == 1, "every element's references came back");
        east_value_release(keys[k]);
    }
}

/* ---- 2 and 3: every operation, against a model --------------------------- */

typedef struct {
    EastValue **elems;
    size_t n;
} Visited;

static void collect(EastValue *v, void *ctx)
{
    Visited *seen = ctx;
    if (seen->n < 2 * KEYS) seen->elems[seen->n] = v;
    seen->n++;
}

static void test_set_model(void)
{
    EastValue *pool[KEYS];
    bool in[KEYS];
    for (size_t k = 0; k < KEYS; k++) {
        pool[k] = east_integer((int64_t)k);
        in[k] = false;
    }
    EastValue *visited[2 * KEYS];
    size_t count = 0;
    bool was_tree = false;
    bool small_after_clear = false;
    EastValue *set = east_set_new(&east_integer_type);

    for (size_t step = 0; step < STEPS; step++) {
        if (step == STEPS / 2) {
            east_set_clear(set);
            for (size_t k = 0; k < KEYS; k++)
                in[k] = false;
            count = 0;
            small_after_clear = set->data.set.tree == NULL;
        }
        size_t k = rng() % KEYS;
        if (rng() % 10 < insert_tenths(step)) {
            east_set_insert(set, pool[k]);
            if (!in[k]) count++;
            in[k] = true;
        } else {
            bool deleted = east_set_delete(set, pool[k]);
            check(deleted == in[k], "a delete finds exactly the elements the set holds");
            if (in[k]) count--;
            in[k] = false;
        }
        was_tree = was_tree || set->data.set.tree != NULL;
        check(east_set_len(set) == count, "a set's length is its element count");
        size_t probe = rng() % KEYS;
        check(east_set_has(set, pool[probe]) == in[probe], "has answers as the model does");

        if (step % 97 == 0 || step == STEPS - 1) {
            size_t i = 0;
            for (size_t e = 0; e < KEYS; e++) {
                if (!in[e]) continue;
                check(i < east_set_len(set) && east_set_at(set, i) == pool[e],
                      "a set's elements index in order");
                i++;
            }
            Visited seen = {visited, 0};
            east_set_visit(set, collect, &seen);
            check(seen.n == count, "a visit sees every element once");
            for (size_t v = 1; v < seen.n && v < 2 * KEYS; v++)
                check(east_value_compare(visited[v - 1], visited[v]) < 0, "and in order");
            for (size_t e = 0; e < KEYS; e++)
                check(pool[e]->ref_count == 1 + (in[e] ? 1 : 0),
                      "a set holds one reference to each of its elements, and no other");
        }
    }
    check(was_tree, "the set grew past the boundary into a tree");
    check(small_after_clear, "and was small again once cleared");

    east_value_release(set);
    for (size_t k = 0; k < KEYS; k++) {
        check(pool[k]->ref_count == 1, "a released set gives every reference back");
        east_value_release(pool[k]);
    }
}

static void test_dict_model(void)
{
    /* Two equal keys and two values per slot: a replace must store the key and
     * value it is given and release the ones it replaces, as the tree does. */
    EastValue *key_pool[2][KEYS];
    EastValue *val_pool[2][KEYS];
    int held_key[KEYS]; /* which key object the dict holds, -1 when absent */
    int held_val[KEYS];
    for (size_t k = 0; k < KEYS; k++) {
        for (int w = 0; w < 2; w++) {
            key_pool[w][k] = east_integer((int64_t)k);
            val_pool[w][k] = east_integer((int64_t)(k * 2 + (size_t)w));
        }
        held_key[k] = -1;
        held_val[k] = -1;
    }
    EastValue *visited[2 * KEYS];
    size_t count = 0;
    bool was_tree = false;
    bool small_after_clear = false;
    EastValue *dict = east_dict_new(&east_integer_type, &east_integer_type);

    for (size_t step = 0; step < STEPS; step++) {
        if (step == STEPS / 2) {
            east_dict_clear(dict);
            for (size_t k = 0; k < KEYS; k++)
                held_key[k] = held_val[k] = -1;
            count = 0;
            small_after_clear = dict->data.dict.tree == NULL;
        }
        size_t k = rng() % KEYS;
        if (rng() % 10 < insert_tenths(step)) {
            int wk = (int)(rng() % 2);
            int wv = (int)(rng() % 2);
            east_dict_set(dict, key_pool[wk][k], val_pool[wv][k]);
            if (held_key[k] < 0) count++;
            held_key[k] = wk;
            held_val[k] = wv;
        } else if (rng() % 2) {
            bool deleted = east_dict_delete(dict, key_pool[0][k]);
            check(deleted == (held_key[k] >= 0), "a delete finds exactly the keys the dict holds");
            if (held_key[k] >= 0) count--;
            held_key[k] = held_val[k] = -1;
        } else {
            EastValue *popped = east_dict_pop(dict, key_pool[1][k]);
            if (held_key[k] >= 0) {
                check(popped == val_pool[held_val[k]][k], "a pop hands back the held value");
                check(popped->ref_count == 2, "with the reference the dict held");
                east_value_release(popped);
                count--;
            } else {
                check(popped == NULL, "a pop of an absent key hands back nothing");
            }
            held_key[k] = held_val[k] = -1;
        }
        was_tree = was_tree || dict->data.dict.tree != NULL;
        check(east_dict_len(dict) == count, "a dict's length is its entry count");
        size_t probe = rng() % KEYS;
        EastValue *found = NULL;
        bool present = east_dict_find(dict, key_pool[0][probe], &found);
        check(present == (held_key[probe] >= 0), "find answers as the model does");
        check(east_dict_has(dict, key_pool[1][probe]) == present, "and has agrees");
        if (present)
            check(found == val_pool[held_val[probe]][probe] &&
                      east_dict_get(dict, key_pool[0][probe]) == found,
                  "find and get hand back the held value");

        if (step % 97 == 0 || step == STEPS - 1) {
            size_t i = 0;
            for (size_t e = 0; e < KEYS; e++) {
                if (held_key[e] < 0) continue;
                check(i < east_dict_len(dict) &&
                          east_dict_key_at(dict, i) == key_pool[held_key[e]][e] &&
                          east_dict_val_at(dict, i) == val_pool[held_val[e]][e],
                      "a dict's entries index in key order, with the key and value last set");
                i++;
            }
            Visited seen = {visited, 0};
            east_dict_visit(dict, collect, &seen);
            check(seen.n == 2 * count, "a visit sees every key and value once");
            for (size_t e = 0; e < KEYS; e++)
                for (int w = 0; w < 2; w++) {
                    check(key_pool[w][e]->ref_count == 1 + (held_key[e] == w ? 1 : 0),
                          "a dict holds one reference to each key it keeps, and no other");
                    check(val_pool[w][e]->ref_count == 1 + (held_val[e] == w ? 1 : 0),
                          "a dict holds one reference to each value it keeps, and no other");
                }
        }
    }
    check(was_tree, "the dict grew past the boundary into a tree");
    check(small_after_clear, "and was small again once cleared");

    east_value_release(dict);
    for (size_t k = 0; k < KEYS; k++)
        for (int w = 0; w < 2; w++) {
            check(key_pool[w][k]->ref_count == 1 && val_pool[w][k]->ref_count == 1,
                  "a released dict gives every reference back");
            east_value_release(key_pool[w][k]);
            east_value_release(val_pool[w][k]);
        }
}

/* ---- 4: one collection, two representations ----------------------------- */

static void test_representations_agree(void)
{
    EastType *it = &east_integer_type;
    const size_t few = 40;
    EastValue *tree_set = east_set_new(it);
    EastValue *small_set = east_set_new(it);
    EastValue *tree_dict = east_dict_new(it, it);
    EastValue *small_dict = east_dict_new(it, it);
    for (size_t k = 0; k < 3 * EAST_SMALL_COLLECTION_MAX; k++) {
        EastValue *key = east_integer((int64_t)k);
        EastValue *val = east_integer((int64_t)(k * k));
        east_set_insert(tree_set, key);
        east_dict_set(tree_dict, key, val);
        if (k < few) {
            east_set_insert(small_set, key);
            east_dict_set(small_dict, key, val);
        }
        east_value_release(key);
        east_value_release(val);
    }
    for (size_t k = few; k < 3 * EAST_SMALL_COLLECTION_MAX; k++) {
        EastValue *key = east_integer((int64_t)k);
        east_set_delete(tree_set, key);
        east_dict_delete(tree_dict, key);
        east_value_release(key);
    }
    check(tree_set->data.set.tree != NULL && small_set->data.set.tree == NULL,
          "the shrunk set is still a tree, the other small");
    check(tree_dict->data.dict.tree != NULL && small_dict->data.dict.tree == NULL,
          "the shrunk dict is still a tree, the other small");
    check(east_value_equal(tree_set, small_set) && east_value_compare(tree_set, small_set) == 0,
          "a tree set and a small set of the same elements are equal and order equal");
    check(east_value_equal(tree_dict, small_dict) && east_value_compare(tree_dict, small_dict) == 0,
          "a tree dict and a small dict of the same entries are equal and order equal");
    char a[4096];
    char b[4096];
    east_value_print(tree_set, a, sizeof(a));
    east_value_print(small_set, b, sizeof(b));
    check(strcmp(a, b) == 0, "and print alike (set)");
    east_value_print(tree_dict, a, sizeof(a));
    east_value_print(small_dict, b, sizeof(b));
    check(strcmp(a, b) == 0, "and print alike (dict)");

    /* An element before all the others orders the small set first. */
    EastValue *extra = east_integer(-1);
    east_set_insert(small_set, extra);
    check(!east_value_equal(tree_set, small_set) && east_value_compare(small_set, tree_set) < 0,
          "and differ where their elements do");
    east_value_release(extra);

    east_value_release(tree_set);
    east_value_release(small_set);
    east_value_release(tree_dict);
    east_value_release(small_dict);
}

int main(void)
{
    east_type_of_type_init();

    printf("small collections gate (issue #1005)\n");
    test_representation();
    test_set_model();
    test_dict_model();
    test_representations_agree();

    if (failures == 0) {
        printf("GATE PASS: a Set or Dict of up to %d elements keeps them in its sorted arrays, "
               "and every operation agrees on both sides of the boundary (issue #1005)\n",
               EAST_SMALL_COLLECTION_MAX);
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
