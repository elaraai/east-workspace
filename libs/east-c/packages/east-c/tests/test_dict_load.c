/*
 * Gate for east_dict_load: a dict loaded pair by pair in key order — the
 * tree's bulk load once past the small collection — is the dict set pair by
 * pair, whatever the order of either: the same length, every key found with
 * its value, equal and ordered alike, a replaced key's old value released;
 * and loading out of order is correct too, only slower. Across the small
 * boundary (EAST_SMALL_COLLECTION_MAX) both ways. Runs under ASan/LSan in the
 * leak check's tree, where a missed release shows.
 */
#include <east/east.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void check(bool ok, const char *what)
{
    if (!ok) {
        fprintf(stderr, "FAIL: %s\n", what);
        failures++;
    }
}

static EastValue *key_of(size_t i)
{
    char buf[32];
    snprintf(buf, sizeof buf, "k%06zu", i);
    return east_string(buf);
}

/* A dict of n entries k000000.., built by `put` in the order `order` gives. */
static EastValue *build(size_t n, void (*put)(EastValue *, EastValue *, EastValue *),
                        size_t (*order)(size_t, size_t))
{
    EastValue *d = east_dict_new(&east_string_type, &east_integer_type);
    for (size_t j = 0; j < n; j++) {
        size_t i = order(j, n);
        EastValue *k = key_of(i);
        EastValue *v = east_integer((int64_t)i);
        put(d, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return d;
}

static size_t in_order(size_t j, size_t n)
{
    (void)n;
    return j;
}
static size_t reversed(size_t j, size_t n)
{
    return n - 1 - j;
}
static size_t strided(size_t j, size_t n)
{
    return (j * 7919) % n; /* a permutation when n is coprime with 7919 */
}

static void same(EastValue *a, EastValue *b, size_t n, const char *what)
{
    char msg[128];
    snprintf(msg, sizeof msg, "%s: length %zu", what, n);
    check(east_dict_len(a) == n && east_dict_len(b) == n, msg);
    snprintf(msg, sizeof msg, "%s: equal", what);
    check(east_value_equal(a, b), msg);
    for (size_t i = 0; i < n; i++) {
        EastValue *k = key_of(i);
        EastValue *va = NULL, *vb = NULL;
        bool fa = east_dict_find(a, k, &va), fb = east_dict_find(b, k, &vb);
        east_value_release(k);
        if (!(fa && fb && va && vb && va->data.integer == (int64_t)i &&
              vb->data.integer == (int64_t)i)) {
            snprintf(msg, sizeof msg, "%s: key %zu found with its value", what, i);
            check(false, msg);
            return;
        }
    }
    for (size_t i = 0; i < n; i++) {
        if (!east_value_equal(east_dict_key_at(a, i), east_dict_key_at(b, i))) {
            snprintf(msg, sizeof msg, "%s: ordered alike at %zu", what, i);
            check(false, msg);
            return;
        }
    }
}

int main(void)
{
    east_type_of_type_init();
    const size_t sizes[] = {1,
                            7,
                            EAST_SMALL_COLLECTION_MAX - 1,
                            EAST_SMALL_COLLECTION_MAX,
                            EAST_SMALL_COLLECTION_MAX + 1,
                            3001};
    for (size_t s = 0; s < sizeof sizes / sizeof sizes[0]; s++) {
        size_t n = sizes[s];
        EastValue *by_set = build(n, east_dict_set, in_order);
        EastValue *loaded = build(n, east_dict_load, in_order);
        same(by_set, loaded, n, "loaded in order");
        EastValue *loaded_reversed = build(n, east_dict_load, reversed);
        same(by_set, loaded_reversed, n, "loaded reversed");
        EastValue *loaded_strided = build(n, east_dict_load, strided);
        same(by_set, loaded_strided, n, "loaded strided");
        east_value_release(by_set);
        east_value_release(loaded);
        east_value_release(loaded_reversed);
        east_value_release(loaded_strided);
    }

    /* A replaced key: the old value is released, the new one stands. */
    {
        size_t n = EAST_SMALL_COLLECTION_MAX + 10;
        EastValue *d = build(n, east_dict_load, in_order);
        EastValue *k = key_of(5);
        EastValue *v = east_integer(-5);
        east_dict_load(d, k, v);
        EastValue *found = NULL;
        check(east_dict_find(d, k, &found) && found && found->data.integer == -5,
              "a replaced key holds the new value");
        check(east_dict_len(d) == n, "a replaced key does not grow the dict");
        east_value_release(k);
        east_value_release(v);
        east_value_release(d);
    }

    if (failures == 0) printf("dict_load: ok\n");
    return failures ? 1 : 0;
}
