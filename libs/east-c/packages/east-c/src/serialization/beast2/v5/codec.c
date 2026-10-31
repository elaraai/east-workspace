/*
 * BEAST2 v5 value codec — single-pass logical encode/decode.
 *
 * Differences from the v4 codec (../v4/value_encode.c, ../v4/value_decode.c):
 * strings are inline (varint length + UTF-8, no string table); mutable
 * containers carry a NEW/REF tag with segment-terminated content instead of
 * value-table indices (aliasing via relative backref deltas, cycles decode
 * by create-then-fill); function values emit an inline source-map delta
 * before their IR. See libs/east/src/serialization/beast2/v5/SPEC.md.
 */

#include "internal_v5.h"

/* ================================================================== */
/*  Encode context — identity map with refcount-1 elision               */
/* ================================================================== */

void b2v5_enc_ctx_init(B2V5EncodeCtx *ctx, EastSourceMap *header_sm, bool self_contained)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->sm = header_sm;
    ctx->sm_emitted = (header_sm && header_sm->num_stacks > 0) ? header_sm->num_stacks : 1;
    ctx->self_contained = self_contained;
}

void b2v5_enc_ctx_free(B2V5EncodeCtx *ctx)
{
    free(ctx->map);
    ctx->map = NULL;
    ctx->map_mask = 0;
    ctx->map_count = 0;
    free(ctx->touched);
    ctx->touched = NULL;
    ctx->touched_count = 0;
    ctx->touched_cap = 0;
    for (size_t i = 0; ctx->translated && i <= ctx->translated_mask; i++) {
        if (!ctx->translated[i].ir) continue;
        east_value_release(ctx->translated[i].ir);
        east_value_release(ctx->translated[i].translated);
    }
    free(ctx->translated);
    ctx->translated = NULL;
    ctx->translated_mask = 0;
    ctx->translated_count = 0;
    for (size_t i = 0; i < ctx->translations_count; i++) {
        east_source_map_release(ctx->translations[i]->map);
        free(ctx->translations[i]->ids);
        free(ctx->translations[i]);
    }
    free(ctx->translations);
    ctx->translations = NULL;
    ctx->translations_count = 0;
    ctx->translations_cap = 0;
    free(ctx->stack_index);
    ctx->stack_index = NULL;
    ctx->stack_index_mask = 0;
    ctx->stack_index_count = 0;
    ctx->stacks_indexed = 0;
    east_source_map_release(ctx->merged);
    ctx->merged = NULL;
}

void b2v5_enc_ctx_defer(B2V5EncodeCtx *ctx)
{
    ctx->deferred = true;
    ctx->blob_map_at = ctx->sm ? B2V5_BLOB_MAP_HEADER : B2V5_BLOB_MAP_NOWHERE;
}

/* Records that slot `i` was filled, for the next element reset. */
static void enc_map_touch(B2V5EncodeCtx *ctx, int i)
{
    if (ctx->touched_count == ctx->touched_cap) {
        size_t cap = ctx->touched_cap ? ctx->touched_cap * 2 : 16;
        int *grown = realloc(ctx->touched, cap * sizeof(int));
        if (!grown) {
            ctx->touched_lost = true;
            return;
        }
        ctx->touched = grown;
        ctx->touched_cap = cap;
    }
    ctx->touched[ctx->touched_count++] = i;
}

static void enc_map_grow(B2V5EncodeCtx *ctx)
{
    int new_mask = ctx->map ? (ctx->map_mask * 2 + 1) : 63;
    Beast2PtrSlot *slots = calloc((size_t)new_mask + 1, sizeof(Beast2PtrSlot));
    if (!slots) return;
    /* Every entry moves, so the fills recorded against the old table are
     * recorded again against the new one. */
    ctx->touched_count = 0;
    if (ctx->map) {
        for (int i = 0; i <= ctx->map_mask; i++) {
            if (!ctx->map[i].key) continue;
            uint32_t h = b2_hash_ptr(ctx->map[i].key);
            int j = (int)(h & (uint32_t)new_mask);
            while (slots[j].key)
                j = (j + 1) & new_mask;
            slots[j] = ctx->map[i];
            enc_map_touch(ctx, j);
        }
        free(ctx->map);
    }
    ctx->map = slots;
    ctx->map_mask = new_mask;
}

static int64_t enc_map_find(B2V5EncodeCtx *ctx, EastValue *value)
{
    if (!ctx->map) return -1;
    uint32_t h = b2_hash_ptr((uintptr_t)value);
    int i = (int)(h & (uint32_t)ctx->map_mask);
    while (ctx->map[i].key) {
        if (ctx->map[i].key == (uintptr_t)value) return (int64_t)ctx->map[i].idx;
        i = (i + 1) & ctx->map_mask;
    }
    return -1;
}

static void enc_map_insert(B2V5EncodeCtx *ctx, EastValue *value, size_t idx)
{
    if (!ctx->map || ctx->map_count * 2 >= ctx->map_mask) enc_map_grow(ctx);
    if (!ctx->map) return; /* OOM: worst case the container re-encodes as NEW */
    uint32_t h = b2_hash_ptr((uintptr_t)value);
    int i = (int)(h & (uint32_t)ctx->map_mask);
    while (ctx->map[i].key) {
        if (ctx->map[i].key == (uintptr_t)value) return;
        i = (i + 1) & ctx->map_mask;
    }
    ctx->map[i].key = (uintptr_t)value;
    ctx->map[i].idx = idx;
    ctx->map_count++;
    enc_map_touch(ctx, i);
}

/* The most entries an element reset carries over. Only containers registered
 * before the first element survive a reset — the root of an indexed encode,
 * one at most — so this is never reached; past it, a surviving container
 * would be written again as NEW, a copy, which still decodes to the value. */
#define B2V5_KEPT_ACROSS_ELEMENTS 4

void b2v5_enc_ctx_begin_element(B2V5EncodeCtx *ctx)
{
    /* A kept entry is re-inserted rather than left in place: every other slot
     * of its probe run may be cleared here, and a lookup stops at the first
     * empty slot. */
    Beast2PtrSlot kept[B2V5_KEPT_ACROSS_ELEMENTS];
    size_t kept_n = 0;
    if (ctx->map) {
        size_t n = ctx->touched_lost ? (size_t)ctx->map_mask + 1 : ctx->touched_count;
        for (size_t t = 0; t < n; t++) {
            Beast2PtrSlot *slot = &ctx->map[ctx->touched_lost ? (int)t : ctx->touched[t]];
            if (!slot->key) continue;
            if (slot->idx < ctx->segment_base_def && kept_n < B2V5_KEPT_ACROSS_ELEMENTS)
                kept[kept_n++] = *slot;
            slot->key = 0;
        }
    }
    ctx->map_count = 0;
    ctx->touched_count = 0;
    ctx->touched_lost = false;
    for (size_t k = 0; k < kept_n; k++)
        enc_map_insert(ctx, (EastValue *)kept[k].key, kept[k].idx);
    ctx->segment_base_def = ctx->def_count;
}

void b2v5_enc_ctx_register(B2V5EncodeCtx *ctx, EastValue *value)
{
    size_t def = ctx->def_count++;
    if (value->ref_count != 1 || ctx->shared_inline) enc_map_insert(ctx, value, def);
}

/* Emit the NEW/REF tag for a container. Returns true when the caller must
 * encode the content (NEW), false when a REF alias was written. */
static bool b2v5_begin_container(ByteBuffer *buf, EastValue *value, B2V5EncodeCtx *ctx)
{
    int64_t found = enc_map_find(ctx, value);
    if (found >= 0) {
        byte_buffer_write_u8(buf, B2V5_TAG_REF);
        write_varint(buf, (uint64_t)(ctx->def_count - (size_t)found));
        if ((size_t)found < ctx->segment_base_def) ctx->cross_segment_ref = true;
        return false;
    }
    byte_buffer_write_u8(buf, B2V5_TAG_NEW);
    /* Refcount-1 elision inside: a container referenced exactly once, by a
     * chain of values each reached once, cannot be met again in this walk,
     * so it never needs a map entry. Its single owner may itself be shared,
     * though — a struct, variant or function value is encoded inline at
     * every reference, and so is the container it owns (a composed patch
     * carrying the same element in two operations, #774) — hence the
     * shared_inline gate. Immortal singletons use negative ref_count and are
     * tracked normally. */
    b2v5_enc_ctx_register(ctx, value);
    return true;
}

/* Enter an inline value (struct, variant, function): its containers must be
 * tracked when it, or an inline value above it, is referenced more than
 * once. Returns the state to restore on exit. */
static bool b2v5_enter_inline(B2V5EncodeCtx *ctx, EastValue *value)
{
    bool saved = ctx->shared_inline;
    if (value->ref_count != 1) ctx->shared_inline = true;
    return saved;
}

/* Enter a container's content: whatever is met inside is reached through a
 * container that is tracked or provably reached once. */
static bool b2v5_enter_container(B2V5EncodeCtx *ctx)
{
    bool saved = ctx->shared_inline;
    ctx->shared_inline = false;
    return saved;
}

/* ================================================================== */
/*  Closures' source maps                                               */
/* ================================================================== */

/* A blob has one map — its header's stacks, then each closure's delta — which
 * every closure decoded from it resolves against. A closure carries its IR
 * and its program's whole map: one of the stream's map writes its loc_ids as
 * they stand; one of another map is written with each where its stack stands
 * in the blob's map, found by content, the stacks the blob lacks added to it.
 * A self-contained stream writes its header before its elements, so a stack
 * its header lacks is written as 0, no location: a closure names its own
 * lines or none, never another program's. The mirror of TypeScript's
 * v5/codec.ts, byte for byte. */

/* A stack of the blob's map, by content. */
struct B2V5StackSlot {
    uint64_t hash;
    size_t id; /* 0: an empty slot */
};

/* A map's stacks, the empty sentinel included: a fresh map holds none until
 * its first stack lands. */
static size_t sm_size(const EastSourceMap *sm)
{
    return sm && sm->num_stacks > 0 ? sm->num_stacks : 1;
}

/* The blob's map: the stream's, or the copy closures of other maps added
 * their stacks to. */
static EastSourceMap *blob_map(const B2V5EncodeCtx *ctx)
{
    return ctx->merged ? ctx->merged : ctx->sm;
}

EastSourceMap *b2v5_enc_ctx_blob_map(const B2V5EncodeCtx *ctx)
{
    return blob_map(ctx);
}

static uint64_t fnv_mix(uint64_t h, uint8_t byte)
{
    return (h ^ byte) * 0x100000001b3ULL;
}

static uint64_t stack_hash(const EastLocation *frames, size_t count)
{
    uint64_t h = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < count; i++) {
        for (const char *p = frames[i].filename ? frames[i].filename : ""; *p; p++)
            h = fnv_mix(h, (uint8_t)*p);
        h = fnv_mix(h, 0);
        for (int b = 0; b < 8; b++)
            h = fnv_mix(h, (uint8_t)((uint64_t)frames[i].line >> (8 * b)));
        for (int b = 0; b < 8; b++)
            h = fnv_mix(h, (uint8_t)((uint64_t)frames[i].column >> (8 * b)));
    }
    return h;
}

static bool stack_equal(const EastLocation *a, size_t na, const EastLocation *b, size_t nb)
{
    if (na != nb) return false;
    for (size_t i = 0; i < na; i++) {
        if (a[i].line != b[i].line || a[i].column != b[i].column) return false;
        if (strcmp(a[i].filename ? a[i].filename : "", b[i].filename ? b[i].filename : "") != 0)
            return false;
    }
    return true;
}

/* The id of the blob's stack of this content: 0 for the empty stack, -1 when
 * the blob holds none — the first of two of one content, as TypeScript's map,
 * which holds each content once, gives it. */
static int64_t stack_find(const B2V5EncodeCtx *ctx, const EastLocation *frames, size_t count,
                          uint64_t hash)
{
    if (count == 0) return 0;
    const EastSourceMap *map = blob_map(ctx);
    if (!map || !ctx->stack_index) return -1;
    size_t j = (size_t)hash & ctx->stack_index_mask;
    while (ctx->stack_index[j].id) {
        const struct B2V5StackSlot *s = &ctx->stack_index[j];
        if (s->hash == hash &&
            stack_equal(map->stacks[s->id], map->stack_counts[s->id], frames, count))
            return (int64_t)s->id;
        j = (j + 1) & ctx->stack_index_mask;
    }
    return -1;
}

static bool stack_index_insert(B2V5EncodeCtx *ctx, uint64_t hash, size_t id)
{
    if (!ctx->stack_index || (ctx->stack_index_count + 1) * 2 > ctx->stack_index_mask + 1) {
        size_t cap = ctx->stack_index ? (ctx->stack_index_mask + 1) * 2 : 64;
        struct B2V5StackSlot *slots = calloc(cap, sizeof(*slots));
        if (!slots) return false;
        for (size_t i = 0; ctx->stack_index && i <= ctx->stack_index_mask; i++) {
            if (!ctx->stack_index[i].id) continue;
            size_t j = (size_t)ctx->stack_index[i].hash & (cap - 1);
            while (slots[j].id)
                j = (j + 1) & (cap - 1);
            slots[j] = ctx->stack_index[i];
        }
        free(ctx->stack_index);
        ctx->stack_index = slots;
        ctx->stack_index_mask = cap - 1;
    }
    size_t j = (size_t)hash & ctx->stack_index_mask;
    while (ctx->stack_index[j].id)
        j = (j + 1) & ctx->stack_index_mask;
    ctx->stack_index[j].hash = hash;
    ctx->stack_index[j].id = id;
    ctx->stack_index_count++;
    return true;
}

/* Indexes the stacks of the blob's map not yet indexed, each content once.
 * False on OOM. */
static bool stack_index_catch_up(B2V5EncodeCtx *ctx)
{
    const EastSourceMap *map = blob_map(ctx);
    size_t size = sm_size(map);
    for (size_t id = ctx->stacks_indexed > 1 ? ctx->stacks_indexed : 1; id < size; id++) {
        size_t count = map->stack_counts[id];
        if (count == 0) continue;
        uint64_t hash = stack_hash(map->stacks[id], count);
        if (stack_find(ctx, map->stacks[id], count, hash) < 0 && !stack_index_insert(ctx, hash, id))
            return false;
    }
    ctx->stacks_indexed = size;
    return true;
}

/* Appends a copy of a stack to `sm`, which gives it its next id. False on
 * OOM, `sm` as it was. */
static bool source_map_append(EastSourceMap *sm, const EastLocation *frames, size_t count)
{
    size_t n = sm_size(sm);
    EastLocation *copy = count > 0 ? calloc(count, sizeof(*copy)) : NULL;
    if (count > 0 && !copy) return false;
    for (size_t i = 0; i < count; i++) {
        copy[i].filename = strdup(frames[i].filename ? frames[i].filename : "");
        copy[i].line = frames[i].line;
        copy[i].column = frames[i].column;
        if (!copy[i].filename) {
            for (size_t j = 0; j < i; j++)
                free(copy[j].filename);
            free(copy);
            return false;
        }
    }
    EastLocation **stacks = realloc(sm->stacks, (n + 1) * sizeof(*stacks));
    if (stacks) sm->stacks = stacks;
    size_t *counts = stacks ? realloc(sm->stack_counts, (n + 1) * sizeof(*counts)) : NULL;
    if (counts) sm->stack_counts = counts;
    if (!stacks || !counts) {
        for (size_t j = 0; j < count; j++)
            free(copy[j].filename);
        free(copy);
        return false;
    }
    if (sm->num_stacks == 0) {
        sm->stacks[0] = NULL;
        sm->stack_counts[0] = 0;
    }
    sm->stacks[n] = copy;
    sm->stack_counts[n] = count;
    sm->num_stacks = n + 1;
    return true;
}

/* A map of the same stacks under the same ids, which an encode may add to.
 * NULL on OOM. */
static EastSourceMap *source_map_copy(const EastSourceMap *sm)
{
    EastSourceMap *copy = east_source_map_new();
    if (!copy) return NULL;
    for (size_t id = 1; id < sm_size(sm); id++) {
        if (!source_map_append(copy, sm->stacks[id], sm->stack_counts[id])) {
            east_source_map_release(copy);
            return NULL;
        }
    }
    return copy;
}

/* How a closure's loc_ids stand in the blob's map: NULL when they stand
 * where they are, as a closure of the stream's map's do; else the
 * translation, made once per map. A stack the blob holds is found by its
 * content. One it lacks is added, in its map's order, unless the stream is
 * self-contained: a segment decoded on its own sees only the header's
 * stacks, so the id is written as 0. A closure with no map was compiled from
 * a program whose map held no stack — TypeScript's empty map, whose loc_ids
 * stand as they are. NULL with ctx->failed set on OOM. */
static const B2V5Translation *blob_locations_of(B2V5EncodeCtx *ctx, EastSourceMap *sm)
{
    if (!sm || sm == ctx->sm) return NULL;
    for (size_t i = 0; i < ctx->translations_count; i++)
        if (ctx->translations[i]->map == sm)
            return ctx->translations[i]->ids ? ctx->translations[i] : NULL;

    if (ctx->translations_count == ctx->translations_cap) {
        size_t cap = ctx->translations_cap ? ctx->translations_cap * 2 : 4;
        B2V5Translation **grown = realloc(ctx->translations, cap * sizeof(*grown));
        if (!grown) goto oom;
        ctx->translations = grown;
        ctx->translations_cap = cap;
    }
    B2V5Translation *t = calloc(1, sizeof(*t));
    size_t n = sm_size(sm);
    int64_t *ids = calloc(n, sizeof(*ids));
    if (!t || !ids || !stack_index_catch_up(ctx)) {
        free(t);
        free(ids);
        goto oom;
    }
    bool identity = true;
    for (size_t id = 1; id < n; id++) {
        const EastLocation *frames = sm->stacks[id];
        size_t count = sm->stack_counts[id];
        uint64_t hash = stack_hash(frames, count);
        int64_t held = stack_find(ctx, frames, count, hash);
        if (held < 0 && (ctx->self_contained || !ctx->sm)) {
            held = 0;
        } else if (held < 0) {
            if (!ctx->merged) ctx->merged = source_map_copy(ctx->sm);
            held = ctx->merged ? (int64_t)sm_size(ctx->merged) : -1;
            if (held < 0 || !source_map_append(ctx->merged, frames, count) ||
                !stack_index_insert(ctx, hash, (size_t)held)) {
                free(t);
                free(ids);
                goto oom;
            }
            ctx->stacks_indexed = sm_size(ctx->merged);
        }
        ids[id] = held;
        if (held != (int64_t)id) identity = false;
    }
    t->map = sm;
    east_source_map_retain(sm);
    if (identity) {
        free(ids);
    } else {
        t->ids = ids;
        t->n = n;
    }
    ctx->translations[ctx->translations_count++] = t;
    return t->ids ? t : NULL;

oom:
    east_builtin_error("beast2 v5 encode: out of memory placing a closure's source map");
    ctx->failed = true;
    return NULL;
}

/* Where a closure's id stands in the blob's map. */
static int64_t translate_loc_id(const B2V5Translation *t, const EastValue *id)
{
    int64_t v = id && id->kind == EAST_VAL_INTEGER ? id->data.integer : 0;
    return v > 0 && (size_t)v < t->n ? t->ids[v] : 0;
}

/* The nodes one translation has copied, by the node: a node the IR shares —
 * a parameter its body reads — stays shared. */
typedef struct {
    const EastValue *node;
    EastValue *copy; /* one reference */
} B2V5NodeCopy;

typedef struct {
    B2V5NodeCopy *slots;
    size_t mask;
    size_t count;
} B2V5NodeCopies;

static EastValue *node_copies_find(const B2V5NodeCopies *done, const EastValue *node)
{
    if (!done->slots) return NULL;
    size_t j = b2_hash_ptr((uintptr_t)node) & done->mask;
    while (done->slots[j].node) {
        if (done->slots[j].node == node) return done->slots[j].copy;
        j = (j + 1) & done->mask;
    }
    return NULL;
}

static bool node_copies_insert(B2V5NodeCopies *done, const EastValue *node, EastValue *copy)
{
    if (!done->slots || (done->count + 1) * 2 > done->mask + 1) {
        size_t cap = done->slots ? (done->mask + 1) * 2 : 64;
        B2V5NodeCopy *slots = calloc(cap, sizeof(*slots));
        if (!slots) return false;
        for (size_t i = 0; done->slots && i <= done->mask; i++) {
            if (!done->slots[i].node) continue;
            size_t j = b2_hash_ptr((uintptr_t)done->slots[i].node) & (cap - 1);
            while (slots[j].node)
                j = (j + 1) & (cap - 1);
            slots[j] = done->slots[i];
        }
        free(done->slots);
        done->slots = slots;
        done->mask = cap - 1;
    }
    size_t j = b2_hash_ptr((uintptr_t)node) & done->mask;
    while (done->slots[j].node)
        j = (j + 1) & done->mask;
    done->slots[j].node = node;
    done->slots[j].copy = copy;
    east_value_retain(copy);
    done->count++;
    return true;
}

static void node_copies_free(B2V5NodeCopies *done)
{
    for (size_t i = 0; done->slots && i <= done->mask; i++)
        if (done->slots[i].node) east_value_release(done->slots[i].copy);
    free(done->slots);
}

static EastValue *copy_ir_child(B2V5NodeCopies *done, EastValue *item, const B2V5Translation *t);

/* A struct's copy, its loc_id where the translation puts it: a node's
 * fields, or a struct inside a node — a label, a case, a field. A node keeps
 * its type, its type parameters and a literal's value as they stand: types
 * hold no locations, and a literal is data. NULL on OOM. */
static EastValue *copy_ir_struct(B2V5NodeCopies *done, EastValue *s, const B2V5Translation *t,
                                 bool node, bool literal)
{
    size_t nf = s->data.struct_.num_fields;
    const char **names = malloc((nf ? nf : 1) * sizeof(*names));
    EastValue **values = calloc(nf ? nf : 1, sizeof(*values));
    bool ok = names && values;
    for (size_t i = 0; ok && i < nf; i++) {
        names[i] = east_struct_field_name(s, i);
        EastValue *field = s->data.struct_.field_values[i];
        if (strcmp(names[i], "loc_id") == 0) {
            values[i] = east_integer(translate_loc_id(t, field));
        } else if (node &&
                   (strcmp(names[i], "type") == 0 || strcmp(names[i], "type_parameters") == 0 ||
                    (literal && strcmp(names[i], "value") == 0))) {
            east_value_retain(field);
            values[i] = field;
        } else {
            values[i] = copy_ir_child(done, field, t);
        }
        ok = values[i] != NULL;
    }
    EastValue *copy = ok ? east_struct_new_owned(names, values, nf, s->data.struct_.type) : NULL;
    if (!copy && values) {
        for (size_t i = 0; i < nf; i++)
            if (values[i]) east_value_release(values[i]);
    }
    free(names);
    free(values);
    return copy;
}

/* A node's copy, made once per node. NULL on OOM. */
static EastValue *copy_ir_node(B2V5NodeCopies *done, EastValue *node, const B2V5Translation *t)
{
    EastValue *hit = node_copies_find(done, node);
    if (hit) {
        east_value_retain(hit);
        return hit;
    }
    EastValue *fields = node->data.variant.value;
    if (!fields || fields->kind != EAST_VAL_STRUCT) {
        east_value_retain(node);
        return node;
    }
    bool literal = strcmp(east_variant_case_name(node), "Value") == 0;
    EastValue *copied = copy_ir_struct(done, fields, t, true, literal);
    if (!copied) return NULL;
    EastValue *copy =
        node->data.variant.case_idx != SIZE_MAX
            ? east_variant_new_idx(node->data.variant.case_idx, copied, node->data.variant.type)
            : east_variant_new(east_variant_case_name(node), copied, node->data.variant.type);
    east_value_release(copied);
    if (copy && !node_copies_insert(done, node, copy)) {
        east_value_release(copy);
        copy = NULL;
    }
    return copy;
}

static EastValue *copy_ir_child(B2V5NodeCopies *done, EastValue *item, const B2V5Translation *t)
{
    switch (item->kind) {
    case EAST_VAL_ARRAY: {
        size_t n = item->data.array.len;
        EastValue *arr = east_array_new_with_capacity(item->data.array.elem_type, n);
        for (size_t i = 0; arr && i < n; i++) {
            EastValue *copy = copy_ir_child(done, item->data.array.items[i], t);
            if (!copy) {
                east_value_release(arr);
                return NULL;
            }
            east_array_push(arr, copy);
            east_value_release(copy);
        }
        return arr;
    }
    case EAST_VAL_VARIANT:
        return copy_ir_node(done, item, t);
    case EAST_VAL_STRUCT:
        return copy_ir_struct(done, item, t, false, false);
    default:
        east_value_retain(item);
        return item;
    }
}

/* A closure's IR with its loc_ids where its stacks stand in the blob's map,
 * made once per IR and translation (borrowed: the context holds it). NULL
 * with ctx->failed set on OOM. */
static EastValue *translated_ir(B2V5EncodeCtx *ctx, EastValue *ir, const B2V5Translation *t)
{
    uintptr_t key = (uintptr_t)ir ^ ((uintptr_t)t << 1);
    if (ctx->translated) {
        size_t j = b2_hash_ptr(key) & ctx->translated_mask;
        while (ctx->translated[j].ir) {
            if (ctx->translated[j].ir == ir && ctx->translated[j].translation == t)
                return ctx->translated[j].translated;
            j = (j + 1) & ctx->translated_mask;
        }
    }
    if (!ctx->translated || (ctx->translated_count + 1) * 2 > ctx->translated_mask + 1) {
        size_t cap = ctx->translated ? (ctx->translated_mask + 1) * 2 : 64;
        B2V5TranslatedIR *slots = calloc(cap, sizeof(*slots));
        if (!slots) goto oom;
        for (size_t i = 0; ctx->translated && i <= ctx->translated_mask; i++) {
            if (!ctx->translated[i].ir) continue;
            uintptr_t k =
                (uintptr_t)ctx->translated[i].ir ^ ((uintptr_t)ctx->translated[i].translation << 1);
            size_t j = b2_hash_ptr(k) & (cap - 1);
            while (slots[j].ir)
                j = (j + 1) & (cap - 1);
            slots[j] = ctx->translated[i];
        }
        free(ctx->translated);
        ctx->translated = slots;
        ctx->translated_mask = cap - 1;
    }
    B2V5NodeCopies done = {0};
    EastValue *copy = copy_ir_node(&done, ir, t);
    node_copies_free(&done);
    if (!copy) goto oom;
    size_t j = b2_hash_ptr(key) & ctx->translated_mask;
    while (ctx->translated[j].ir)
        j = (j + 1) & ctx->translated_mask;
    east_value_retain(ir);
    ctx->translated[j] = (B2V5TranslatedIR){ir, t, copy};
    ctx->translated_count++;
    return copy;

oom:
    east_builtin_error("beast2 v5 encode: out of memory placing a closure's source map");
    ctx->failed = true;
    return NULL;
}

/* Writes a closure's source-map delta. A self-contained stream writes none.
 * A deferred encode writes its first closure's — every stack the blob's map
 * holds so far — and none after it, the stacks later closures bring being
 * left to b2v5_enc_ctx_finish_blob_map; with a header holding the map, none
 * at all. Any other stream writes the stacks of the blob's map not yet
 * written. */
static void write_stacks_delta(B2V5EncodeCtx *ctx, ByteBuffer *buf)
{
    EastSourceMap *map = blob_map(ctx);
    size_t size = sm_size(map);
    if (ctx->self_contained || (ctx->deferred && ctx->blob_map_at != B2V5_BLOB_MAP_NOWHERE)) {
        write_varint(buf, 0);
        return;
    }
    if (ctx->deferred) {
        ctx->blob_map_start = buf->len;
        write_varint(buf, (uint64_t)(size - 1));
        if (map) b2v5_write_stacks(buf, map, 1, size);
        ctx->blob_map_end = buf->len;
        ctx->blob_map_written = size;
        ctx->blob_map_at = B2V5_BLOB_MAP_DELTA;
        ctx->sm_emitted = size;
        return;
    }
    if (size <= ctx->sm_emitted) {
        write_varint(buf, 0);
        return;
    }
    write_varint(buf, (uint64_t)(size - ctx->sm_emitted));
    b2v5_write_stacks(buf, map, ctx->sm_emitted, size);
    ctx->sm_emitted = size;
}

ByteBuffer *b2v5_enc_ctx_finish_blob_map(B2V5EncodeCtx *ctx, ByteBuffer *logical)
{
    EastSourceMap *map = blob_map(ctx);
    size_t size = sm_size(map);
    if (ctx->blob_map_at != B2V5_BLOB_MAP_DELTA || !map || size == ctx->blob_map_written)
        return logical;
    ByteBuffer *out = byte_buffer_new(logical->len + 256);
    if (!out) return NULL;
    byte_buffer_write_bytes(out, logical->data, ctx->blob_map_start);
    write_varint(out, (uint64_t)(size - 1));
    b2v5_write_stacks(out, map, 1, size);
    byte_buffer_write_bytes(out, logical->data + ctx->blob_map_end,
                            logical->len - ctx->blob_map_end);
    return out;
}

/* ================================================================== */
/*  Encode                                                              */
/* ================================================================== */

void b2v5_encode_value(ByteBuffer *buf, EastValue *value, EastType *type, B2V5EncodeCtx *ctx)
{
    if (!type || ctx->failed) return;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
        break;

    case EAST_TYPE_NULL:
        break;

    case EAST_TYPE_BOOLEAN:
        byte_buffer_write_u8(buf, value->data.boolean ? 1 : 0);
        break;

    case EAST_TYPE_INTEGER:
        write_zigzag(buf, value->data.integer);
        break;

    case EAST_TYPE_FLOAT:
        b2_write_float64_le(buf, value->data.float64);
        break;

    case EAST_TYPE_STRING: {
        size_t slen = value->data.string.len;
        write_varint(buf, (uint64_t)slen);
        byte_buffer_write_bytes(buf, (const uint8_t *)value->data.string.data, slen);
        break;
    }

    case EAST_TYPE_DATETIME:
        write_zigzag(buf, value->data.datetime);
        break;

    case EAST_TYPE_BLOB: {
        size_t blen = value->data.blob.len;
        write_varint(buf, (uint64_t)blen);
        if (blen > 0) byte_buffer_write_bytes(buf, value->data.blob.data, blen);
        break;
    }

    case EAST_TYPE_ARRAY: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        bool outer = b2v5_enter_container(ctx);
        size_t n = value->data.array.len;
        EastType *elem = type->data.element;
        if (n > 0) {
            write_varint(buf, (uint64_t)n);
            for (size_t i = 0; i < n && !ctx->failed; i++)
                b2v5_encode_value(buf, value->data.array.items[i], elem, ctx);
        }
        write_varint(buf, 0);
        ctx->shared_inline = outer;
        break;
    }

    case EAST_TYPE_SET: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        bool outer = b2v5_enter_container(ctx);
        size_t n = value->data.set.len;
        EastType *elem = type->data.element;
        if (n > 0) {
            write_varint(buf, (uint64_t)n);
            for (size_t i = 0; i < n && !ctx->failed; i++)
                b2v5_encode_value(buf, east_set_at(value, i), elem, ctx);
        }
        write_varint(buf, 0);
        ctx->shared_inline = outer;
        break;
    }

    case EAST_TYPE_DICT: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        bool outer = b2v5_enter_container(ctx);
        size_t n = value->data.dict.len;
        EastType *kt = type->data.dict.key;
        EastType *vt = type->data.dict.value;
        if (n > 0) {
            write_varint(buf, (uint64_t)n);
            for (size_t i = 0; i < n && !ctx->failed; i++) {
                b2v5_encode_value(buf, east_dict_key_at(value, i), kt, ctx);
                b2v5_encode_value(buf, east_dict_val_at(value, i), vt, ctx);
            }
        }
        write_varint(buf, 0);
        ctx->shared_inline = outer;
        break;
    }

    case EAST_TYPE_REF: {
        if (!b2v5_begin_container(buf, value, ctx)) break;
        bool outer = b2v5_enter_container(ctx);
        b2v5_encode_value(buf, value->data.ref.value, type->data.element, ctx);
        ctx->shared_inline = outer;
        break;
    }

    case EAST_TYPE_STRUCT: {
        bool outer = b2v5_enter_inline(ctx, value);
        size_t nf = type->data.struct_.num_fields;
        for (size_t i = 0; i < nf && !ctx->failed; i++) {
            EastType *ftype = type->data.struct_.fields[i].type;
            EastValue *fval = (value->kind == EAST_VAL_STRUCT && i < value->data.struct_.num_fields)
                                  ? value->data.struct_.field_values[i]
                                  : NULL;
            if (fval) {
                b2v5_encode_value(buf, fval, ftype, ctx);
            } else {
                EastValue *null_val = east_null();
                b2v5_encode_value(buf, null_val, ftype, ctx);
                east_value_release(null_val);
            }
        }
        ctx->shared_inline = outer;
        break;
    }

    case EAST_TYPE_VARIANT: {
        bool outer = b2v5_enter_inline(ctx, value);
        /* Tag lookup mirrors the v4 encoder: the case_tag string is
         * authoritative; the stored case_idx is a fallback for type-less
         * variants (see ../v4/value_encode.c for the full rationale). */
        const char *tag = value->data.variant.case_tag;
        size_t ci = SIZE_MAX;
        if (tag) {
            ci = east_variant_type_case_idx(type, tag);
        }
        if (ci == SIZE_MAX) {
            ci = value->data.variant.case_idx;
        }
        if (ci >= type->data.variant.num_cases) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                     "beast2 v5 encode: variant value has no resolvable case "
                     "(case_idx=%zu, case_tag=%s) for type with %zu cases",
                     value->data.variant.case_idx, tag ? tag : "(null)",
                     type->data.variant.num_cases);
            east_builtin_error(msg);
            ctx->failed = true;
            return;
        }
        write_varint(buf, (uint64_t)ci);
        b2v5_encode_value(buf, value->data.variant.value, type->data.variant.cases[ci].type, ctx);
        ctx->shared_inline = outer;
        break;
    }

    case EAST_TYPE_VECTOR: {
        EastType *elem_type = type->data.element;
        size_t vlen = value->data.vector.len;
        write_varint(buf, (uint64_t)vlen);
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.vector.data,
                                    vlen * sizeof(double));
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.vector.data,
                                    vlen * sizeof(int64_t));
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.vector.data,
                                    vlen * sizeof(bool));
        }
        break;
    }

    case EAST_TYPE_MATRIX: {
        EastType *elem_type = type->data.element;
        size_t rows = value->data.matrix.rows;
        size_t cols = value->data.matrix.cols;
        write_varint(buf, (uint64_t)rows);
        write_varint(buf, (uint64_t)cols);
        size_t count = rows * cols;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.matrix.data,
                                    count * sizeof(double));
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.matrix.data,
                                    count * sizeof(int64_t));
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            byte_buffer_write_bytes(buf, (const uint8_t *)value->data.matrix.data,
                                    count * sizeof(bool));
        }
        break;
    }

    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node) {
            b2v5_encode_value(buf, value, type->data.recursive.node, ctx);
        }
        break;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        EastCompiledFn *fn = value->data.function.compiled;
        if (!fn || !fn->source_ir) {
            east_builtin_error("beast2 v5 encode: cannot serialize function without source IR");
            ctx->failed = true;
            return;
        }
        if (!east_ir_type) east_type_of_type_init();
        bool outer = b2v5_enter_inline(ctx, value);

        /* A stream with no map yet takes the first closure's that carries one,
         * whose stacks then stand where they are; any other closure's loc_ids
         * are written where its stacks stand in the blob's map. */
        if (fn->source_map && !ctx->sm && !ctx->self_contained) {
            ctx->sm = fn->source_map;
            ctx->sm_emitted = 1; /* only the implicit empty sentinel is "on the wire" */
        }
        const B2V5Translation *translation = blob_locations_of(ctx, fn->source_map);
        if (ctx->failed) return;
        write_stacks_delta(ctx, buf);

        /* IR as a plain EastValue variant tree, then captures (same shapes as
         * the v4 encoder — Function struct: type=0, loc_id=1, captures=2). A
         * translated IR is written for every closure of its IR and map alike,
         * so its containers are tracked: the next closure REFs them, as it
         * would its own IR's. */
        if (translation) {
            EastValue *ir = translated_ir(ctx, fn->source_ir, translation);
            if (!ir) return;
            bool inside = ctx->shared_inline;
            ctx->shared_inline = true;
            b2v5_encode_value(buf, ir, east_ir_type, ctx);
            ctx->shared_inline = inside;
        } else {
            b2v5_encode_value(buf, fn->source_ir, east_ir_type, ctx);
        }
        if (ctx->failed) return;

        EastValue *fn_struct = fn->source_ir->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2);
        size_t ncaps =
            (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;
        write_varint(buf, (uint64_t)ncaps);

        for (size_t i = 0; i < ncaps && !ctx->failed; i++) {
            EastValue *cap_var = caps_arr->data.array.items[i];
            EastValue *cap_s = cap_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(cap_s, 2); /* name */
            EastValue *type_v = east_struct_get_field_idx(cap_s, 0); /* type */
            bool is_mutable = false;
            EastValue *mut_v = east_struct_get_field_idx(cap_s, 3); /* mutable */
            if (mut_v && mut_v->kind == EAST_VAL_BOOLEAN) is_mutable = mut_v->data.boolean;

            const char *cap_name = name_v->data.string.data;
            EastType *cap_type = east_type_from_value(type_v);

            EastValue *cap_val = env_get(fn->captures, cap_name);
            if (cap_val && is_mutable && cap_val->kind == EAST_VAL_REF) {
                EastValue *inner = east_ref_get(cap_val);
                b2v5_encode_value(buf, inner, cap_type, ctx);
                east_value_release(inner);
            } else if (cap_val) {
                b2v5_encode_value(buf, cap_val, cap_type, ctx);
            } else {
                /* ncaps was already written from the IR's declaration list;
                 * silently skipping an unbound capture would leave the wire
                 * short one value and desync every later read. */
                char msg[160];
                snprintf(msg, sizeof(msg),
                         "beast2 v5 encode: closure capture '%s' has no bound value "
                         "(declared in the IR but absent from the captures environment)",
                         cap_name ? cap_name : "(null)");
                east_builtin_error(msg);
                ctx->failed = true;
            }

            if (cap_type) east_type_release(cap_type);
        }
        ctx->shared_inline = outer;
        break;
    }
    }
}

/* ================================================================== */
/*  Decode context                                                      */
/* ================================================================== */

void b2v5_dec_ctx_init(B2V5DecodeCtx *ctx, EastSourceMap *sm)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->sm = sm;
}

void b2v5_dec_ctx_free(B2V5DecodeCtx *ctx)
{
    free(ctx->defs);
    free(ctx->def_plans);
    ctx->defs = NULL;
    ctx->def_plans = NULL;
    ctx->def_count = 0;
    ctx->def_cap = 0;
}

bool b2v5_dec_ctx_push(B2V5DecodeCtx *ctx, EastValue *container)
{
    if (ctx->def_count == ctx->def_cap) {
        size_t new_cap = ctx->def_cap ? ctx->def_cap * 2 : 64;
        EastValue **defs = realloc(ctx->defs, new_cap * sizeof(EastValue *));
        if (!defs) return false;
        ctx->defs = defs;
        if (ctx->proj_active) {
            const void **plans = realloc(ctx->def_plans, new_cap * sizeof(const void *));
            if (!plans) return false;
            ctx->def_plans = plans;
        }
        ctx->def_cap = new_cap;
    }
    if (ctx->proj_active) ctx->def_plans[ctx->def_count] = ctx->cur_shape;
    ctx->defs[ctx->def_count++] = container;
    return true;
}

/* ================================================================== */
/*  Decode                                                              */
/* ================================================================== */

static EastValue *b2v5_decode_value_inner(const uint8_t *data, size_t len, size_t *offset,
                                          EastType *type, B2V5DecodeCtx *ctx);

EastValue *b2v5_decode_value(const uint8_t *data, size_t len, size_t *offset, EastType *type,
                             B2V5DecodeCtx *ctx)
{
    if (ctx->depth >= BEAST2_MAX_DEPTH) return NULL;
    ctx->depth++;
    /* Function subtrees never decode frozen: the IR is stamped in place
     * before compiling, and captured values stay mutable (a closure owns its
     * own state). Containers a capture merely aliases from the frozen graph
     * resolve by REF and keep their brand. */
    bool was_frozen = ctx->frozen;
    bool function =
        type && (type->kind == EAST_TYPE_FUNCTION || type->kind == EAST_TYPE_ASYNC_FUNCTION);
    size_t weight = ctx->weight;
    if (function) ctx->frozen = false;
    EastValue *result = b2v5_decode_value_inner(data, len, offset, type, ctx);
    ctx->frozen = was_frozen;
    /* A function weighs a constant: nothing its IR or captures built counts. */
    if (function) ctx->weight = weight + B2V5_WEIGHT_FUNCTION;
    ctx->depth--;
    return result;
}

/* Read a container tag. Returns 1 and sets *aliased (retained) for REF,
 * 0 for NEW, -1 for corruption (or a projection-shape mismatch). */
int b2v5_read_container_tag(const uint8_t *data, size_t len, size_t *offset, B2V5DecodeCtx *ctx,
                            EastValue **aliased)
{
    *aliased = NULL;
    if (*offset >= len) return -1;
    uint8_t tag = data[(*offset)++];
    if (tag == B2V5_TAG_NEW) return 0;
    if (tag != B2V5_TAG_REF) return -1;
    uint64_t delta;
    if (!read_varint_checked(data, len, offset, &delta)) return -1;
    if (delta < 1 || delta > ctx->def_count) {
        char msg[128];
        snprintf(msg, sizeof(msg),
                 "beast2 v5: container backref delta %llu out of range (%zu definitions visible)",
                 (unsigned long long)delta, ctx->def_count);
        east_builtin_error(msg);
        return -1;
    }
    size_t def_idx = ctx->def_count - (size_t)delta;
    if (ctx->proj_active && ctx->def_plans[def_idx] != ctx->cur_shape) {
        /* The target decoded under a different shape than this reference
         * site needs (narrowed differently, or parsed-and-skipped) — serving
         * it would hand back a value whose layout disagrees with the type
         * label. The caller falls back to a whole decode. */
        east_builtin_error(B2V5_PROJ_ALIAS_MSG);
        return -1;
    }
    EastValue *target = ctx->defs[def_idx];
    if (!target) return -1;
    east_value_retain(target);
    *aliased = target;
    return 1;
}

/* Accept `next` into the running strict-ascent state. The wire must hold
 * the canonical value — a non-ascending element/key is corruption, never
 * data to repair. Takes ownership decisions away from the caller: on
 * failure `next` is untouched (caller still releases it). */
bool b2v5_order_accept(B2V5OrderCheck *order, EastValue *next, bool is_dict)
{
    if (order->prev && east_value_compare(order->prev, next) >= 0) {
        east_builtin_error(is_dict
                               ? "beast2 v5: Dict keys are not strictly ascending in East order — "
                                 "the wire must hold the canonical value (corrupt or pre-contract "
                                 "blob)"
                               : "beast2 v5: Set elements are not strictly ascending in East order "
                                 "— the wire must hold the canonical value (corrupt or "
                                 "pre-contract blob)");
        return false;
    }
    if (order->prev) east_value_release(order->prev);
    order->prev = next;
    east_value_retain(next);
    return true;
}

bool b2v5_decode_elements_into(EastValue *container, EastType *container_type, uint64_t n,
                               const uint8_t *data, size_t len, size_t *offset, B2V5DecodeCtx *ctx,
                               B2V5OrderCheck *order)
{
    switch (container_type->kind) {
    case EAST_TYPE_ARRAY: {
        EastType *elem = container_type->data.element;
        for (uint64_t j = 0; j < n; j++) {
            EastValue *val = b2v5_decode_value(data, len, offset, elem, ctx);
            if (!val) return false; /* silent skip = truncation + desync (#287) */
            east_array_push(container, val);
            east_value_release(val);
        }
        return true;
    }
    case EAST_TYPE_SET: {
        EastType *elem = container_type->data.element;
        for (uint64_t j = 0; j < n; j++) {
            EastValue *val = b2v5_decode_value(data, len, offset, elem, ctx);
            if (!val) return false;
            if (order && !b2v5_order_accept(order, val, false)) {
                east_value_release(val);
                return false;
            }
            east_set_insert(container, val);
            east_value_release(val);
        }
        return true;
    }
    case EAST_TYPE_DICT: {
        EastType *kt = container_type->data.dict.key;
        EastType *vt = container_type->data.dict.value;
        for (uint64_t j = 0; j < n; j++) {
            EastValue *k = b2v5_decode_value(data, len, offset, kt, ctx);
            if (!k) return false;
            if (order && !b2v5_order_accept(order, k, true)) {
                east_value_release(k);
                return false;
            }
            EastValue *v = b2v5_decode_value(data, len, offset, vt, ctx);
            if (!v) {
                east_value_release(k);
                return false;
            }
            east_dict_set(container, k, v);
            east_value_release(k);
            east_value_release(v);
        }
        return true;
    }
    default:
        return false;
    }
}

/* Decode a NEW container's segment-terminated content into `container`. */
static bool b2v5_decode_container_content(EastValue *container, EastType *type, const uint8_t *data,
                                          size_t len, size_t *offset, B2V5DecodeCtx *ctx)
{
    B2V5OrderCheck order = {0};
    B2V5OrderCheck *op =
        (type->kind == EAST_TYPE_SET || type->kind == EAST_TYPE_DICT) ? &order : NULL;
    bool ok = true;
    for (;;) {
        uint64_t n;
        if (!read_varint_checked(data, len, offset, &n)) {
            ok = false;
            break;
        }
        if (n == 0) break;
        /* Each element costs at least one byte — except for zero-width
         * element types (Array<Null>), where only the absolute cap applies. */
        if (!b2_container_count_within_bounds(n, type, len - *offset)) {
            ok = false;
            break;
        }
        if (!b2v5_decode_elements_into(container, type, n, data, len, offset, ctx, op)) {
            ok = false;
            break;
        }
    }
    b2v5_order_check_dispose(&order);
    return ok;
}

static EastValue *b2v5_decode_value_inner(const uint8_t *data, size_t len, size_t *offset,
                                          EastType *type, B2V5DecodeCtx *ctx)
{
    if (!type) return NULL;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
        return NULL;

    case EAST_TYPE_NULL:
        return east_null();

    case EAST_TYPE_BOOLEAN: {
        if (*offset >= len) return NULL;
        bool val = data[(*offset)++] != 0;
        ctx->weight += B2V5_WEIGHT_SCALAR;
        return east_boolean(val);
    }

    case EAST_TYPE_INTEGER: {
        int64_t val;
        if (!read_zigzag_checked(data, len, offset, &val)) return NULL;
        ctx->weight += B2V5_WEIGHT_SCALAR;
        return east_integer(val);
    }

    case EAST_TYPE_FLOAT: {
        if (*offset + 8 > len) return NULL;
        double val = b2_read_float64_le(data, offset);
        ctx->weight += B2V5_WEIGHT_SCALAR;
        return east_float(val);
    }

    case EAST_TYPE_STRING: {
        /* Straight from the chunk: the value constructor copies the bytes
         * it keeps (inline for short strings), so no scratch copy. */
        size_t slen;
        const uint8_t *bytes = b2_read_string_view(data, len, offset, &slen);
        if (!bytes) return NULL;
        ctx->weight += b2v5_weight_string(slen);
        return east_string_len((const char *)bytes, slen);
    }

    case EAST_TYPE_DATETIME: {
        int64_t millis;
        if (!read_zigzag_checked(data, len, offset, &millis)) return NULL;
        ctx->weight += B2V5_WEIGHT_SCALAR;
        return east_datetime(millis);
    }

    case EAST_TYPE_BLOB: {
        uint64_t blen;
        if (!read_varint_checked(data, len, offset, &blen)) return NULL;
        if (blen > len - *offset) return NULL;
        EastValue *val = east_blob(data + *offset, (size_t)blen);
        *offset += (size_t)blen;
        ctx->weight += B2V5_WEIGHT_BLOB + (size_t)blen;
        return val;
    }

    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_DICT: {
        EastValue *aliased;
        int tag = b2v5_read_container_tag(data, len, offset, ctx, &aliased);
        if (tag < 0) return NULL;
        if (tag == 1) return aliased;

        EastValue *container;
        if (type->kind == EAST_TYPE_ARRAY) {
            container = east_array_new(type->data.element);
        } else if (type->kind == EAST_TYPE_SET) {
            container = east_set_new(type->data.element);
        } else {
            container = east_dict_new(type->data.dict.key, type->data.dict.value);
        }
        if (!container) return NULL;
        /* The frozen brand goes on at construction — the decode fill below
         * uses the raw value helpers, which the brand does not guard. */
        if (ctx->frozen) east_value_set_frozen(container);
        /* Register at definition start so cycles resolve (create-then-fill). */
        if (!b2v5_dec_ctx_push(ctx, container)) {
            east_value_release(container);
            return NULL;
        }
        if (!b2v5_decode_container_content(container, type, data, len, offset, ctx)) {
            east_value_release(container);
            return NULL;
        }
        ctx->weight += b2v5_weight_container(type->kind, b2v5_container_len(container));
        return container;
    }

    case EAST_TYPE_REF: {
        EastValue *aliased;
        int tag = b2v5_read_container_tag(data, len, offset, ctx, &aliased);
        if (tag < 0) return NULL;
        if (tag == 1) return aliased;

        EastValue *cell = east_ref_new(east_null());
        if (!cell) return NULL;
        ctx->weight += B2V5_WEIGHT_NODE;
        if (ctx->frozen) east_value_set_frozen(cell);
        if (!b2v5_dec_ctx_push(ctx, cell)) {
            east_value_release(cell);
            return NULL;
        }
        EastValue *inner = b2v5_decode_value(data, len, offset, type->data.element, ctx);
        if (!inner) {
            east_value_release(cell);
            return NULL;
        }
        east_ref_set(cell, inner);
        east_value_release(inner);
        return cell;
    }

    case EAST_TYPE_STRUCT: {
        size_t nf = type->data.struct_.num_fields;
        const char *inline_names[B2V5_STRUCT_SCRATCH];
        EastValue *inline_values[B2V5_STRUCT_SCRATCH];
        const char **names = inline_names;
        EastValue **values = inline_values;
        bool heap = nf > B2V5_STRUCT_SCRATCH;
        if (heap) {
            names = malloc(nf * sizeof(char *));
            values = malloc(nf * sizeof(EastValue *));
            if (!names || !values) {
                free(names);
                free(values);
                return NULL;
            }
        }

        for (size_t i = 0; i < nf; i++) {
            names[i] = type->data.struct_.fields[i].name;
            EastType *ftype = type->data.struct_.fields[i].type;
            values[i] = b2v5_decode_value(data, len, offset, ftype, ctx);
            if (!values[i]) {
                for (size_t j = 0; j < i; j++) {
                    east_value_release(values[j]);
                }
                if (heap) {
                    free(names);
                    free(values);
                }
                return NULL;
            }
        }

        /* The struct takes over the fields' references. */
        EastValue *result = east_struct_new_owned(names, values, nf, type);
        if (!result) {
            for (size_t i = 0; i < nf; i++)
                east_value_release(values[i]);
        }
        if (heap) {
            free(names);
            free(values);
        }
        ctx->weight += B2V5_WEIGHT_NODE + 8 * nf;
        return result;
    }

    case EAST_TYPE_VARIANT: {
        uint64_t case_idx;
        if (!read_varint_checked(data, len, offset, &case_idx)) return NULL;
        if (case_idx >= type->data.variant.num_cases) return NULL;

        EastType *case_type = type->data.variant.cases[case_idx].type;
        EastValue *case_value = b2v5_decode_value(data, len, offset, case_type, ctx);
        if (!case_value) return NULL;

        EastValue *result = east_variant_new_idx((size_t)case_idx, case_value, type);
        east_value_release(case_value);
        /* A case with no payload is a value the type shares: it weighs nothing. */
        if (case_value != &east_null_value) ctx->weight += B2V5_WEIGHT_NODE;
        return result;
    }

    case EAST_TYPE_VECTOR: {
        EastType *elem_type = type->data.element;
        uint64_t vlen;
        if (!read_varint_checked(data, len, offset, &vlen)) return NULL;

        size_t elem_size = 0;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            elem_size = sizeof(double);
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            elem_size = sizeof(int64_t);
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            elem_size = sizeof(bool);
        } else {
            return NULL; /* vectors are numeric/boolean only */
        }

        if (vlen > (len - *offset) / elem_size) return NULL;

        EastValue *vec = east_vector_new(elem_type, (size_t)vlen);
        if (!vec) return NULL;
        if (ctx->frozen) east_value_set_frozen(vec);

        size_t byte_count = (size_t)vlen * elem_size;
        memcpy(vec->data.vector.data, data + *offset, byte_count);
        *offset += byte_count;
        ctx->weight += B2V5_WEIGHT_VECTOR + b2v5_weight_elements(elem_type, (size_t)vlen);
        return vec;
    }

    case EAST_TYPE_MATRIX: {
        EastType *elem_type = type->data.element;
        uint64_t rows, cols;
        if (!read_varint_checked(data, len, offset, &rows)) return NULL;
        if (!read_varint_checked(data, len, offset, &cols)) return NULL;

        size_t elem_size = 0;
        if (elem_type->kind == EAST_TYPE_FLOAT) {
            elem_size = sizeof(double);
        } else if (elem_type->kind == EAST_TYPE_INTEGER) {
            elem_size = sizeof(int64_t);
        } else if (elem_type->kind == EAST_TYPE_BOOLEAN) {
            elem_size = sizeof(bool);
        } else {
            return NULL; /* matrices are numeric/boolean only */
        }

        size_t max_elems = (len - *offset) / elem_size;
        if (rows > 0 && cols > max_elems / rows) return NULL;

        EastValue *mat = east_matrix_new(elem_type, (size_t)rows, (size_t)cols);
        if (!mat) return NULL;
        if (ctx->frozen) east_value_set_frozen(mat);

        size_t byte_count = (size_t)rows * (size_t)cols * elem_size;
        memcpy(mat->data.matrix.data, data + *offset, byte_count);
        *offset += byte_count;
        ctx->weight +=
            B2V5_WEIGHT_MATRIX + b2v5_weight_elements(elem_type, (size_t)rows * (size_t)cols);
        return mat;
    }

    case EAST_TYPE_RECURSIVE:
        if (type->data.recursive.node) {
            return b2v5_decode_value(data, len, offset, type->data.recursive.node, ctx);
        }
        return NULL;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        if (!east_ir_type) east_type_of_type_init();

        /* 1. Inline source-map delta. */
        uint64_t n_new;
        if (!read_varint_checked(data, len, offset, &n_new)) return NULL;
        if (n_new > 0) {
            if (!ctx->sm) return NULL;
            if (!b2v5_append_stacks(ctx->sm, data, len, offset, n_new)) return NULL;
        }

        /* 2. Decode IR as regular EastValue variant tree. */
        EastValue *ir_value = b2v5_decode_value(data, len, offset, east_ir_type, ctx);
        if (!ir_value) return NULL;

        /* 3. Extract capture/param info from the EastValue IR (same field
         *    indices as the v4 decoder: captures=2, parameters=3; Variable
         *    name=2, type=0). */
        EastValue *fn_struct = ir_value->data.variant.value;
        EastValue *caps_arr = east_struct_get_field_idx(fn_struct, 2);
        EastValue *params_arr = east_struct_get_field_idx(fn_struct, 3);

        size_t ncaps_ir =
            (caps_arr && caps_arr->kind == EAST_VAL_ARRAY) ? caps_arr->data.array.len : 0;
        size_t nparams =
            (params_arr && params_arr->kind == EAST_VAL_ARRAY) ? params_arr->data.array.len : 0;

        uint64_t ncaps;
        if (!read_varint_checked(data, len, offset, &ncaps)) {
            east_value_release(ir_value);
            return NULL;
        }
        if (ncaps != ncaps_ir) {
            east_value_release(ir_value);
            return NULL;
        }

        /* 4. Decode capture values using types from the EastValue IR. */
        Environment *captures_env = env_new(NULL);

        for (uint64_t i = 0; i < ncaps; i++) {
            EastValue *cap_var = caps_arr->data.array.items[i];
            EastValue *cap_s = cap_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(cap_s, 2);
            EastValue *type_v = east_struct_get_field_idx(cap_s, 0);

            const char *cap_name = name_v->data.string.data;
            EastType *cap_type = east_type_from_value(type_v);

            EastValue *cap_val = b2v5_decode_value(data, len, offset, cap_type, ctx);
            if (cap_type) east_type_release(cap_type);
            if (!cap_val) {
                env_release(captures_env);
                east_value_release(ir_value);
                return NULL;
            }

            env_set(captures_env, cap_name, cap_val);
            east_value_release(cap_val);
        }

        /* 5. Extract param names. */
        char **param_names = nparams > 0 ? calloc(nparams, sizeof(char *)) : NULL;
        for (size_t i = 0; i < nparams; i++) {
            EastValue *par_var = params_arr->data.array.items[i];
            EastValue *par_s = par_var->data.variant.value;
            EastValue *name_v = east_struct_get_field_idx(par_s, 2);
            param_names[i] = strdup(name_v->data.string.data);
        }

        /* 6. Build EastCompiledFn (IR body set lazily on first east_call). */
        EastCompiledFn *fn = calloc(1, sizeof(EastCompiledFn));
        if (!fn) {
            env_release(captures_env);
            east_value_release(ir_value);
            for (size_t i = 0; i < nparams; i++)
                free(param_names[i]);
            free(param_names);
            return NULL;
        }

        fn->ir = NULL; /* lazy — converted from source_ir on first call */
        fn->captures = captures_env;
        fn->param_names = param_names;
        fn->num_params = nparams;
        fn->platform = east_current_platform();
        if (fn->platform) platform_registry_retain(fn->platform);
        fn->builtins = east_current_builtins();
        fn->source_ir = ir_value;

        /* Share the stream's source map: the closure takes its own reference
         * (released with the function), so it still resolves — and re-encodes
         * — its loc_ids after the decode, reader or pager that read the map
         * off the wire has been torn down. */
        fn->source_map = ctx->sm;
        east_source_map_retain(ctx->sm);

        return east_function_value(fn);
    }
    }

    return NULL;
}
