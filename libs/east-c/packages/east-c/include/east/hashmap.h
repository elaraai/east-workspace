#ifndef EAST_HASHMAP_H
#define EAST_HASHMAP_H

#include <stdbool.h>
#include <stddef.h>

typedef struct {
    char *key;
    void *value;
    bool occupied;
} HashmapEntry;

typedef struct {
    HashmapEntry *entries;
    size_t capacity;
    size_t count;
    /* Deleted slots still occupying the table. Counted toward the load factor,
     * because probing stops only at a truly empty slot: a table churned by
     * insert/delete keeps `count` low while filling with tombstones, and once
     * none are empty the probe cannot terminate. */
    size_t tombstones;
} Hashmap;

Hashmap *hashmap_new(void);
void hashmap_free(Hashmap *map, void (*free_value)(void *));
void *hashmap_get(Hashmap *map, const char *key);
/* The hash of `key` as the table computes it, so a caller that looks the
 * same key up repeatedly (an IR node's builtin name, on every evaluation)
 * can hash once and probe with hashmap_get_hashed. */
size_t hashmap_hash(const char *key);
void *hashmap_get_hashed(Hashmap *map, const char *key, size_t hash);
void hashmap_set(Hashmap *map, const char *key, void *value);
bool hashmap_has(Hashmap *map, const char *key);
void hashmap_delete(Hashmap *map, const char *key, void (*free_value)(void *));
size_t hashmap_count(Hashmap *map);

// Iteration
typedef void (*HashmapIterFn)(const char *key, void *value, void *ctx);
void hashmap_iter(Hashmap *map, HashmapIterFn fn, void *ctx);

// Get all keys
char **hashmap_keys(Hashmap *map, size_t *out_count);

#endif
