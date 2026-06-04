/*
 * Proves the tidwall/btree.c ordered B-tree can hold east-c's refcounted
 * EastValue* elements correctly, so the Set/Dict representation can be migrated
 * onto it. The integration points it exercises:
 *
 *   - node allocation routed through east_alloc/east_free;
 *   - east_value_compare as the node comparator (the item is an EastValue*);
 *   - item_free = east_value_release releasing every element on teardown,
 *     delete, and replace.
 *
 * The subtle, non-obvious contract: on delete and on a replacing set, the
 * library copies the removed element into a spare, calls item_free on it, then
 * RETURNS that spare. So with item_free = east_value_release the tree releases
 * the value itself — a caller must transfer ownership in and must never release
 * the returned element again (that would double-free).
 *
 * Built -DBTREE_NOATOMICS so no <stdatomic.h> is pulled in: east-c never shares
 * tree nodes across threads (GC tracking lists are thread-local), so the atomic
 * refcount the library uses only for copy-on-write clones is pure overhead.
 *
 * Run under ASan/LSan: a leak (a missed release) or a double-free (an
 * over-release) fails the gate. It exercises the library integration only;
 * cycle-collector traversal of tree nodes is covered once EAST_VAL_SET/DICT
 * actually carry a tree.
 */
#include <east/east.h>
#include <east/arena.h>

#include "btree.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

/* item = EastValue* (8 bytes); a,b point at EastValue* slots. */
static int cmp_ev(const void *a, const void *b, void *udata)
{
    (void)udata;
    return east_value_compare(*(EastValue *const *)a, *(EastValue *const *)b);
}

/* the one hook that serves teardown AND delete AND replace. */
static void free_ev(const void *item, void *udata)
{
    (void)udata;
    east_value_release(*(EastValue *const *)item);
}

/* east_realloc is 3-arg (ptr, old, new); btree wants 2-arg. Never actually
 * called by btree.c ("(void)realloc_; // realloc not used"), but the signature
 * requires a non-NULL function. old_size is ignored by the current arena. */
static void *east_realloc2(void *p, size_t n)
{
    return east_realloc(p, 0, n);
}

struct collect {
    EastValue **out;
    size_t n;
};

static bool collect_cb(const void *item, void *udata)
{
    struct collect *c = (struct collect *)udata;
    c->out[c->n++] = *(EastValue *const *)item;
    return true; /* keep scanning */
}

static struct btree *new_tree(size_t fanout)
{
    struct btree *bt = btree_new_with_allocator(east_alloc, east_realloc2, east_free,
                                                sizeof(EastValue *), fanout, cmp_ev, NULL);
    assert(bt);
    btree_set_item_callbacks(bt, NULL, free_ev);
    return bt;
}

/* a {day: <int>} struct value — a compound, type-dependent key (structs compare
 * by field name then field value). Returns ref=1, transferring to the caller. */
static EastValue *make_day(long day)
{
    EastValue *d = east_integer(day); /* ref=1 */
    const char *names[1] = {"day"};
    EastValue *vals[1] = {d};
    EastValue *s = east_struct_new(names, vals, 1, NULL); /* retains d */
    east_value_release(d);                                /* struct owns it now */
    return s;
}

int main(void)
{
    enum { N = 1000, FANOUT = 32 };
    int failures = 0;

    /* Insert N distinct integers in a shuffled, non-sorted order. 7919 is prime
     * and coprime to 1000, so i*7919 % N is a permutation. Each value's
     * construction ref (=1) transfers to the tree. */
    struct btree *bt = new_tree(FANOUT);
    for (long i = 0; i < N; i++) {
        long k = (i * 7919) % N;
        EastValue *v = east_integer(k); /* ref=1, GC-tracked */
        const void *replaced = btree_set(bt, &v);
        assert(replaced == NULL); /* all distinct -> never a replace */
        assert(!btree_oom(bt));
    }
    if (btree_count(bt) != N) {
        printf("FAIL insert count: %zu != %d\n", btree_count(bt), N);
        failures++;
    }

    /* in-order traversal == canonical sorted order */
    EastValue **seen = malloc(N * sizeof *seen);
    struct collect c = {seen, 0};
    btree_ascend(bt, NULL, collect_cb, &c);
    if (c.n != (size_t)N) {
        printf("FAIL ascend count: %zu != %d\n", c.n, N);
        failures++;
    }
    for (size_t i = 1; i < c.n; i++) {
        if (east_value_compare(seen[i - 1], seen[i]) >= 0) {
            printf("FAIL ascend not strictly sorted at %zu\n", i);
            failures++;
            break;
        }
    }
    free(seen);

    /* get present / absent */
    EastValue *probe = east_integer(500);
    if (btree_get(bt, &probe) == NULL) {
        printf("FAIL get present\n");
        failures++;
    }
    east_value_release(probe);
    EastValue *absent = east_integer(N + 10);
    if (btree_get(bt, &absent) != NULL) {
        printf("FAIL get absent\n");
        failures++;
    }
    east_value_release(absent);

    /* delete the 500 evens. item_free releases each removed value in the
     * library; we must NOT release the returned spare (that would double-free). */
    for (long k = 0; k < N; k += 2) {
        EastValue *key = east_integer(k);
        const void *removed = btree_delete(bt, &key);
        assert(removed != NULL); /* present */
        east_value_release(key); /* our lookup key (NOT the stored value) */
        assert(!btree_oom(bt));
    }
    if (btree_count(bt) != N / 2) {
        printf("FAIL delete count: %zu != %d\n", btree_count(bt), N / 2);
        failures++;
    }

    /* overwrite: set an existing key with a NEW equal-compare value. The old
     * stored value is item_free'd (released); the new one's ref transfers in. */
    {
        EastValue *dup = east_integer(1); /* odd -> still present */
        const void *replaced = btree_set(bt, &dup);
        assert(replaced != NULL); /* replaced -> old returned + item_free'd */
    }
    if (btree_count(bt) != N / 2) {
        printf("FAIL overwrite count: %zu != %d\n", btree_count(bt), N / 2);
        failures++;
    }

    /* btree_load: bulk-load a second tree from an ascending stream. */
    struct btree *bt2 = new_tree(FANOUT);
    for (long k = 0; k < N; k++) {
        EastValue *v = east_integer(k);
        btree_load(bt2, &v);
        assert(!btree_oom(bt2));
    }
    if (btree_count(bt2) != N) {
        printf("FAIL load count: %zu != %d\n", btree_count(bt2), N);
        failures++;
    }
    EastValue **seen2 = malloc(N * sizeof *seen2);
    struct collect c2 = {seen2, 0};
    btree_ascend(bt2, NULL, collect_cb, &c2);
    for (size_t i = 1; i < c2.n; i++) {
        if (east_value_compare(seen2[i - 1], seen2[i]) >= 0) {
            printf("FAIL load not sorted at %zu\n", i);
            failures++;
            break;
        }
    }
    free(seen2);

    /* compound, type-dependent keys: {day: k} structs inserted shuffled must
     * ascend in canonical order — exercises the SAME comparator on a compound
     * value (struct: field name then field value), not just scalars. */
    struct btree *bt3 = new_tree(FANOUT);
    for (long i = 0; i < N; i++) {
        long k = (i * 7919) % N;
        EastValue *s = make_day(k);
        const void *replaced = btree_set(bt3, &s);
        assert(replaced == NULL);
        assert(!btree_oom(bt3));
    }
    EastValue **seen3 = malloc(N * sizeof *seen3);
    struct collect c3 = {seen3, 0};
    btree_ascend(bt3, NULL, collect_cb, &c3);
    if (c3.n != (size_t)N) {
        printf("FAIL struct ascend count: %zu != %d\n", c3.n, N);
        failures++;
    }
    for (size_t i = 1; i < c3.n; i++) {
        if (east_value_compare(seen3[i - 1], seen3[i]) >= 0) {
            printf("FAIL struct keys not sorted at %zu\n", i);
            failures++;
            break;
        }
    }
    if (c3.n == (size_t)N) {
        EastValue *lo = east_struct_get_field(seen3[0], "day");
        EastValue *hi = east_struct_get_field(seen3[N - 1], "day");
        if (!lo || lo->data.integer != 0 || !hi || hi->data.integer != N - 1) {
            printf("FAIL struct min/max key ordering\n");
            failures++;
        }
    }
    free(seen3);

    /* teardown: item_free releases every remaining element. ASan/LSan is the
     * oracle for leaks (a missed release) and double-frees (an over-release). */
    btree_free(bt);
    btree_free(bt2);
    btree_free(bt3);

    if (failures == 0) {
        printf("GATE PASS: btree.c integrates with east-c "
               "(east_alloc + east_value_compare on scalar AND compound {struct} keys "
               "+ item_free teardown/delete/replace + ascend + load, -DBTREE_NOATOMICS)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
