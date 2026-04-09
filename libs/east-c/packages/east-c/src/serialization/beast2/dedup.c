/*
 * BEAST2 value dedup — byte-range based content hashing for struct/variant
 * de-duplication during decode.
 */

#include "internal.h"

/*
 * Full-content hash using wyhash-style mixing.
 *
 * Hashes ALL bytes (not just head/tail), so collisions are extremely rare
 * (~2^-64). This eliminates nearly all memcmp calls in dedup_find at the
 * cost of reading all bytes during hashing — a net win because the memcmp
 * cascade from collisions was far more expensive.
 */
static inline uint64_t wymix(uint64_t a, uint64_t b)
{
    __uint128_t r = (__uint128_t)a * b;
    return (uint64_t)(r >> 64) ^ (uint64_t)r;
}

static inline uint64_t wyread8(const uint8_t *p) { uint64_t v; memcpy(&v, p, 8); return v; }
static inline uint64_t wyread4(const uint8_t *p) { uint32_t v; memcpy(&v, p, 4); return v; }

uint64_t hash_byte_range(const uint8_t *data, size_t len, uintptr_t type_ptr)
{
    const uint64_t s0 = 0xa0761d6478bd642fULL;
    const uint64_t s1 = 0xe7037ed1a0b428dbULL;
    const uint64_t s2 = 0x8ebc6af09c88c6e3ULL;
    const uint64_t s3 = 0x589965cc75374cc3ULL;

    uint64_t seed = s0 ^ type_ptr;
    const uint8_t *p = data;
    uint64_t a, b;

    if (len <= 16) {
        if (len >= 4) {
            a = (wyread4(p) << 32) | wyread4(p + ((len >> 3) << 2));
            b = (wyread4(p + len - 4) << 32) | wyread4(p + len - 4 - ((len >> 3) << 2));
        } else if (len > 0) {
            a = ((uint64_t)p[0] << 16) | ((uint64_t)p[len >> 1] << 8) | p[len - 1];
            b = 0;
        } else {
            a = b = 0;
        }
    } else if (len <= 48) {
        a = wymix(wyread8(p) ^ s1, wyread8(p + 8) ^ seed);
        b = wymix(wyread8(p + len - 16) ^ s2, wyread8(p + len - 8) ^ seed);
        if (len > 32) {
            a ^= wymix(wyread8(p + 16) ^ s3, wyread8(p + 24) ^ seed);
        }
    } else {
        /* Process 48-byte chunks */
        uint64_t see1 = seed, see2 = seed;
        size_t i = len;
        while (i > 48) {
            seed = wymix(wyread8(p) ^ s1, wyread8(p + 8) ^ seed);
            see1 = wymix(wyread8(p + 16) ^ s2, wyread8(p + 24) ^ see1);
            see2 = wymix(wyread8(p + 32) ^ s3, wyread8(p + 40) ^ see2);
            p += 48;
            i -= 48;
        }
        seed ^= see1 ^ see2;
        /* Process remaining bytes */
        a = wymix(wyread8(p + i - 16) ^ s1, wyread8(p + i - 8) ^ seed);
        b = wymix(wyread8(p + i - 48) ^ s2, wyread8(p + i - 40) ^ seed);
    }

    uint64_t h = wymix(s1 ^ len, wymix(a ^ s1, b ^ seed));
    return h ? h : 1;
}

static void beast2_dedup_grow(Beast2DecodeCtx *ctx)
{
    int old_cap = ctx->dedup_mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2DedupSlot *new_slots = calloc((size_t)new_cap, sizeof(Beast2DedupSlot));
    if (!new_slots) return;

    for (int i = 0; i < old_cap; i++) {
        if (ctx->dedup_slots[i].hash != 0) {
            uint32_t h = (uint32_t)(ctx->dedup_slots[i].hash) & (uint32_t)new_mask;
            while (new_slots[h].hash != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = ctx->dedup_slots[i];
        }
    }
    free(ctx->dedup_slots);
    ctx->dedup_slots = new_slots;
    ctx->dedup_mask = new_mask;
}

EastValue *beast2_dedup_find(Beast2DecodeCtx *ctx, uint64_t hash,
                              const uint8_t *data, size_t byte_start,
                              size_t byte_len, EastType *type)
{
    (void)data; (void)byte_start; /* no longer needed — full-content hash is sufficient */
    uint32_t h = (uint32_t)(hash) & (uint32_t)ctx->dedup_mask;
    for (;;) {
        if (ctx->dedup_slots[h].hash == 0) return NULL;
        if (ctx->dedup_slots[h].hash == hash &&
            ctx->dedup_slots[h].byte_len == byte_len &&
            ctx->dedup_slots[h].type == type) {
            return ctx->dedup_slots[h].value;
        }
        h = (h + 1) & (uint32_t)ctx->dedup_mask;
    }
}

void beast2_dedup_add(Beast2DecodeCtx *ctx, uint64_t hash,
                       size_t byte_start, size_t byte_len,
                       EastType *type, EastValue *value)
{
    if (ctx->dedup_count * 10 >= (ctx->dedup_mask + 1) * 7)
        beast2_dedup_grow(ctx);

    uint32_t h = (uint32_t)(hash) & (uint32_t)ctx->dedup_mask;
    while (ctx->dedup_slots[h].hash != 0)
        h = (h + 1) & (uint32_t)ctx->dedup_mask;
    ctx->dedup_slots[h].hash = hash;
    ctx->dedup_slots[h].byte_start = byte_start;
    ctx->dedup_slots[h].byte_len = byte_len;
    ctx->dedup_slots[h].type = type;
    east_value_retain(value);  /* dedup table owns a reference */
    ctx->dedup_slots[h].value = value;
    ctx->dedup_count++;
}

#ifdef BEAST2_PROFILE_DEDUP
double beast2_clock_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e6 + ts.tv_nsec / 1e3;
}

/* Find or create a per-type stats entry. Returns pointer to the stats slot. */
static inline typeof(((Beast2DecodeCtx*)0)->type_stats[0]) *
beast2_type_stats_get(Beast2DecodeCtx *ctx, EastType *type)
{
    uint32_t h = (uint32_t)((uintptr_t)type * 0x45d9f3bU) & (uint32_t)ctx->type_stats_mask;
    for (;;) {
        if (ctx->type_stats[h].type == type)
            return &ctx->type_stats[h];
        if (ctx->type_stats[h].type == NULL) {
            /* New entry */
            ctx->type_stats[h].type = type;
            ctx->type_stats_count++;
            /* Grow at 70% load */
            if (ctx->type_stats_count * 10 >= (ctx->type_stats_mask + 1) * 7) {
                int old_cap = ctx->type_stats_mask + 1;
                int new_cap = old_cap * 2;
                int new_mask = new_cap - 1;
                typeof(ctx->type_stats) new_table = calloc(new_cap, sizeof(ctx->type_stats[0]));
                for (int i = 0; i < old_cap; i++) {
                    if (ctx->type_stats[i].type) {
                        uint32_t nh = (uint32_t)((uintptr_t)ctx->type_stats[i].type * 0x45d9f3bU) & (uint32_t)new_mask;
                        while (new_table[nh].type) nh = (nh + 1) & (uint32_t)new_mask;
                        new_table[nh] = ctx->type_stats[i];
                    }
                }
                free(ctx->type_stats);
                ctx->type_stats = new_table;
                ctx->type_stats_mask = new_mask;
                /* Re-lookup after grow */
                h = (uint32_t)((uintptr_t)type * 0x45d9f3bU) & (uint32_t)ctx->type_stats_mask;
                while (ctx->type_stats[h].type != type)
                    h = (h + 1) & (uint32_t)ctx->type_stats_mask;
            }
            return &ctx->type_stats[h];
        }
        h = (h + 1) & (uint32_t)ctx->type_stats_mask;
    }
}

void beast2_dedup_print_stats(Beast2DecodeCtx *ctx)
{
    fprintf(stderr, "\n=== Beast2 Dedup Stats ===\n");
    fprintf(stderr, "Total: hits=%d misses=%d bytes_hashed=%zu\n",
            ctx->dedup_hits, ctx->dedup_misses, ctx->dedup_bytes_hashed);

    /* Collect and sort per-type stats by time descending */
    int n = 0;
    for (int i = 0; i <= ctx->type_stats_mask; i++) {
        if (ctx->type_stats[i].type) n++;
    }
    if (n == 0) return;

    /* Flatten into array for sorting */
    typedef struct { EastType *type; int hits; int misses; size_t bytes; double time_us; } Entry;
    Entry *entries = malloc(n * sizeof(Entry));
    int ei = 0;
    for (int i = 0; i <= ctx->type_stats_mask; i++) {
        if (ctx->type_stats[i].type) {
            entries[ei].type = ctx->type_stats[i].type;
            entries[ei].hits = ctx->type_stats[i].hits;
            entries[ei].misses = ctx->type_stats[i].misses;
            entries[ei].bytes = ctx->type_stats[i].bytes_hashed;
            entries[ei].time_us = ctx->type_stats[i].time_us;
            ei++;
        }
    }
    /* Simple insertion sort by time descending */
    for (int i = 1; i < n; i++) {
        Entry tmp = entries[i];
        int j = i - 1;
        while (j >= 0 && entries[j].time_us < tmp.time_us) {
            entries[j + 1] = entries[j];
            j--;
        }
        entries[j + 1] = tmp;
    }

    fprintf(stderr, "\nPer-type dedup breakdown (sorted by time):\n");
    fprintf(stderr, "%-12s %8s %8s %12s %10s  %s\n",
            "TYPE_KIND", "HITS", "MISSES", "BYTES", "TIME_MS", "TYPE_PTR");
    double total_time = 0;
    for (int i = 0; i < n; i++) total_time += entries[i].time_us;
    for (int i = 0; i < n; i++) {
        const char *kind_name = east_type_kind_name(entries[i].type->kind);
        fprintf(stderr, "%-12s %8d %8d %12zu %10.1f  %p",
                kind_name,
                entries[i].hits, entries[i].misses,
                entries[i].bytes,
                entries[i].time_us / 1000.0,
                (void*)entries[i].type);
        /* For struct/variant, print brief type info */
        if (entries[i].type->kind == EAST_TYPE_STRUCT && entries[i].type->data.struct_.num_fields > 0) {
            fprintf(stderr, "  {%s", entries[i].type->data.struct_.fields[0].name);
            if (entries[i].type->data.struct_.num_fields > 1)
                fprintf(stderr, ", %s", entries[i].type->data.struct_.fields[1].name);
            if (entries[i].type->data.struct_.num_fields > 2)
                fprintf(stderr, ", ...[%zu fields]", entries[i].type->data.struct_.num_fields);
            fprintf(stderr, "}");
        } else if (entries[i].type->kind == EAST_TYPE_VARIANT && entries[i].type->data.variant.num_cases > 0) {
            fprintf(stderr, "  |%s", entries[i].type->data.variant.cases[0].name);
            if (entries[i].type->data.variant.num_cases > 1)
                fprintf(stderr, "|%s", entries[i].type->data.variant.cases[1].name);
            if (entries[i].type->data.variant.num_cases > 2)
                fprintf(stderr, "|...[%zu cases]", entries[i].type->data.variant.num_cases);
        }
        fprintf(stderr, "  (%.1f%%)\n", entries[i].time_us * 100.0 / total_time);
    }
    fprintf(stderr, "Total dedup time: %.1f ms\n", total_time / 1000.0);
    free(entries);
}
#endif
