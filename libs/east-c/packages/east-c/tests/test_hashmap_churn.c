/*
 * Regression gate: a hashmap churned by insert/delete must not fill with
 * tombstones and hang.
 *
 * hashmap_delete leaves a tombstone and decrements `count`, while hashmap_set
 * grew on `count` alone. A workload of N inserts each followed by a delete
 * therefore kept `count` near zero, never resized, and steadily turned every
 * slot into a tombstone. find_index stops only at a truly EMPTY slot, so once
 * none remained it probed forever — an infinite loop, not a crash, from an
 * entirely ordinary sequence of calls.
 *
 * The reachable instance was the JSON reader's handle registry
 * (east-c-std/src/json.c), which is the only hashmap_delete caller in the tree:
 * a program that opened and closed more than the table's capacity of JSON
 * readers wedged. The bound below is well past the initial capacity of 16 and
 * runs in milliseconds when the accounting is right.
 *
 * Every assertion here would loop rather than fail if the fix regressed, so the
 * test binary is registered with a ctest TIMEOUT.
 */
#include <east/hashmap.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL: ");                                                             \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            return 1;                                                                              \
        }                                                                                          \
    } while (0)

int main(void)
{
    /* 1. Insert-then-delete, far past the initial capacity. This is the shape
     *    that hung: one live entry at a time, thousands of tombstones. */
    Hashmap *map = hashmap_new();
    CHECK(map != NULL, "hashmap_new returned NULL");

    for (int i = 0; i < 5000; i++) {
        char key[32];
        snprintf(key, sizeof key, "handle-%d", i);
        int *value = malloc(sizeof(int));
        CHECK(value != NULL, "out of memory");
        *value = i;
        hashmap_set(map, key, value);

        void *got = hashmap_get(map, key);
        CHECK(got != NULL, "key %s must be present right after set", key);
        CHECK(*(int *)got == i, "key %s must read back its own value", key);

        hashmap_delete(map, key, free);
        CHECK(hashmap_get(map, key) == NULL, "key %s must be gone after delete", key);
    }
    CHECK(hashmap_count(map) == 0, "every key was deleted, so count must be 0, got %zu",
          hashmap_count(map));

    /* 2. The table must still work afterwards, and must not have grown without
     *    bound: rehashing a churned table clears tombstones in place. */
    hashmap_set(map, "live", (void *)(size_t)42);
    CHECK(hashmap_get(map, "live") == (void *)(size_t)42, "the table must still store keys");
    CHECK(map->capacity <= 64, "a churned table must be rehashed, not grown (capacity %zu)",
          map->capacity);
    hashmap_free(map, NULL);

    /* 3. Interleaved churn: a live working set alongside heavy deletion, which
     *    is what a long-lived registry actually looks like. */
    map = hashmap_new();
    CHECK(map != NULL, "hashmap_new returned NULL");
    for (int i = 0; i < 5000; i++) {
        char key[32];
        snprintf(key, sizeof key, "k%d", i);
        hashmap_set(map, key, (void *)(size_t)(i + 1));
        if (i >= 8) {
            char old[32];
            snprintf(old, sizeof old, "k%d", i - 8);
            hashmap_delete(map, old, NULL);
        }
    }
    CHECK(hashmap_count(map) == 8, "the working set must be 8 entries, got %zu",
          hashmap_count(map));
    for (int i = 4992; i < 5000; i++) {
        char key[32];
        snprintf(key, sizeof key, "k%d", i);
        CHECK(hashmap_get(map, key) == (void *)(size_t)(i + 1), "%s must still be live", key);
    }
    hashmap_free(map, NULL);

    printf("hashmap churn: ok\n");
    return 0;
}
