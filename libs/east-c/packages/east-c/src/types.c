#include "east/types.h"
#include "east/type_of_type.h"
#include "east/serialization.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Primitive type singletons (ref_count = -1: never freed)           */
/* ------------------------------------------------------------------ */

EastType east_never_type = {.kind = EAST_TYPE_NEVER, .ref_count = -1, .type_id = 0, .data = {0}};
EastType east_null_type = {.kind = EAST_TYPE_NULL, .ref_count = -1, .type_id = 1, .data = {0}};
EastType east_boolean_type = {
    .kind = EAST_TYPE_BOOLEAN, .ref_count = -1, .type_id = 2, .data = {0}};
EastType east_integer_type = {
    .kind = EAST_TYPE_INTEGER, .ref_count = -1, .type_id = 3, .data = {0}};
EastType east_float_type = {.kind = EAST_TYPE_FLOAT, .ref_count = -1, .type_id = 4, .data = {0}};
EastType east_string_type = {.kind = EAST_TYPE_STRING, .ref_count = -1, .type_id = 5, .data = {0}};
EastType east_datetime_type = {
    .kind = EAST_TYPE_DATETIME, .ref_count = -1, .type_id = 6, .data = {0}};
EastType east_blob_type = {.kind = EAST_TYPE_BLOB, .ref_count = -1, .type_id = 7, .data = {0}};

/* ------------------------------------------------------------------ */
/*  Type arena + interning (mirrors TS types.ts hashCombine + intern)  */
/*                                                                     */
/*  Interned types are immortal (ref_count=-1), allocated from a       */
/*  page-based arena.  No individual frees, no cascade-release bugs.   */
/*  The arena is freed as a whole in east_type_registry_clear().       */
/* ------------------------------------------------------------------ */

static int64_t g_next_type_id = 8; /* 0-7 reserved for primitive singletons */

/* Page-based arena — stable pointers, never realloc'd */
#define TYPE_ARENA_PAGE_SIZE 4096
typedef struct TypeArenaPage {
    struct TypeArenaPage *next;
    size_t used;
    uint8_t data[TYPE_ARENA_PAGE_SIZE];
} TypeArenaPage;
static TypeArenaPage *g_type_arena = NULL;

static EastType *arena_alloc_type(EastTypeKind kind)
{
    TypeArenaPage *page = g_type_arena;
    while (page && page->used + sizeof(EastType) > TYPE_ARENA_PAGE_SIZE)
        page = page->next;
    if (!page) {
        page = calloc(1, sizeof(TypeArenaPage));
        page->next = g_type_arena;
        g_type_arena = page;
    }
    EastType *t = (EastType *)(page->data + page->used);
    page->used += sizeof(EastType);
    memset(t, 0, sizeof(EastType));
    t->kind = kind;
    t->ref_count = -1; /* immortal — east_type_retain/release are no-ops */
    t->type_id = g_next_type_id++;
    return t;
}


/* ---- Hash-based intern table (FNV-1a, open addressing) ---- */

static inline uint32_t hash_combine(uint32_t h, uint32_t v)
{
    return (h ^ v) * 0x01000193u;
}

static inline uint32_t hash_string(const char *s)
{
    uint32_t h = 2166136261u;
    while (*s) {
        h ^= (uint8_t)*s++;
        h *= 0x01000193u;
    }
    return h;
}

typedef struct {
    uint32_t hash;
    EastType *type;
} InternSlot;
static InternSlot *g_intern_table = NULL;
static int g_intern_mask = -1;
static int g_intern_count = 0;

static void intern_grow(void)
{
    int old_cap = g_intern_mask < 0 ? 0 : g_intern_mask + 1;
    int new_cap = old_cap ? old_cap * 2 : 64;
    int new_mask = new_cap - 1;
    InternSlot *nt = calloc(new_cap, sizeof(InternSlot));
    for (int i = 0; i < old_cap; i++)
        if (g_intern_table[i].type) {
            uint32_t h = g_intern_table[i].hash & (uint32_t)new_mask;
            while (nt[h].type)
                h = (h + 1) & (uint32_t)new_mask;
            nt[h] = g_intern_table[i];
        }
    free(g_intern_table);
    g_intern_table = nt;
    g_intern_mask = new_mask;
}

static EastType *intern_find(uint32_t hash, bool (*verify)(EastType *, const void *),
                             const void *ctx)
{
    if (!g_intern_table) return NULL;
    uint32_t h = hash & (uint32_t)g_intern_mask;
    for (;;) {
        if (!g_intern_table[h].type) return NULL;
        if (g_intern_table[h].hash == hash && verify(g_intern_table[h].type, ctx))
            return g_intern_table[h].type;
        h = (h + 1) & (uint32_t)g_intern_mask;
    }
}

static void intern_put(uint32_t hash, EastType *type)
{
    if (!g_intern_table || g_intern_count * 10 >= (g_intern_mask + 1) * 7) intern_grow();
    uint32_t h = hash & (uint32_t)g_intern_mask;
    while (g_intern_table[h].type)
        h = (h + 1) & (uint32_t)g_intern_mask;
    g_intern_table[h] = (InternSlot){hash, type};
    g_intern_count++;
}

/* ---- Recursive type intern (linear scan with east_type_equal) ---- */

static EastType **g_recursive_intern = NULL;
static size_t g_recursive_intern_len = 0;
static size_t g_recursive_intern_cap = 0;

EastType *east_recursive_type_intern(EastType *rec)
{
    if (!rec || rec->kind != EAST_TYPE_RECURSIVE) return rec;
    for (size_t i = 0; i < g_recursive_intern_len; i++) {
        if (east_type_equal(g_recursive_intern[i], rec))
            return g_recursive_intern[i]; /* return canonical pointer */
    }
    if (g_recursive_intern_len >= g_recursive_intern_cap) {
        g_recursive_intern_cap = g_recursive_intern_cap ? g_recursive_intern_cap * 2 : 8;
        g_recursive_intern =
            realloc(g_recursive_intern, g_recursive_intern_cap * sizeof(EastType *));
    }
    g_recursive_intern[g_recursive_intern_len++] = rec;
    return rec; /* this IS the canonical */
}

/* ---- Cleanup ---- */

/* Free heap-allocated children of an arena type (field names, arrays, etc.)
 * Does NOT free the type itself (it's arena-allocated). */
static void type_free_children(EastType *t)
{
    switch (t->kind) {
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < t->data.struct_.num_fields; i++)
            free(t->data.struct_.fields[i].name);
        free(t->data.struct_.fields);
        break;
    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < t->data.variant.num_cases; i++)
            free(t->data.variant.cases[i].name);
        free(t->data.variant.cases);
        free(t->data.variant.tag_slots);
        break;
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        free(t->data.function.inputs);
        break;
    default:
        break;
    }
}

void east_type_registry_clear(void)
{
    /* Purge the beast2 type-section cache first — its slots retain
     * arena-backed types (and type values) that the arena free below
     * invalidates regardless of refcount (#417). */
    east_beast2_type_cache_clear();

    /* Free type_of_type globals before arena (they hold refs to arena types) */
    east_type_of_type_free();

    /* Walk arena pages and free heap children of each type */
    for (TypeArenaPage *page = g_type_arena; page; page = page->next) {
        size_t offset = 0;
        while (offset + sizeof(EastType) <= page->used) {
            EastType *t = (EastType *)(page->data + offset);
            type_free_children(t);
            offset += sizeof(EastType);
        }
    }

    /* Free arena pages */
    TypeArenaPage *page = g_type_arena;
    while (page) {
        TypeArenaPage *next = page->next;
        free(page);
        page = next;
    }
    g_type_arena = NULL;

    free(g_intern_table);
    g_intern_table = NULL;
    g_intern_mask = -1;
    g_intern_count = 0;

    /* Recursive intern list — the array itself is heap-allocated, but the
     * wrapper entries it points to are arena types already reclaimed by the
     * page sweep above. Only the array needs freeing. */
    free(g_recursive_intern);
    g_recursive_intern = NULL;
    g_recursive_intern_len = 0;
    g_recursive_intern_cap = 0;

    g_next_type_id = 8;
}

/* ---- Intern verify helpers ---- */

typedef struct {
    EastTypeKind kind;
    EastType *elem;
} VerifyElemCtx;
static bool verify_elem(EastType *c, const void *ctx)
{
    const VerifyElemCtx *v = ctx;
    return c->kind == v->kind && c->data.element == v->elem;
}

typedef struct {
    EastType *key;
    EastType *val;
} VerifyDictCtx;
static bool verify_dict(EastType *c, const void *ctx)
{
    const VerifyDictCtx *v = ctx;
    return c->kind == EAST_TYPE_DICT && c->data.dict.key == v->key && c->data.dict.value == v->val;
}

typedef struct {
    const char **names;
    EastType **types;
    size_t count;
    EastTypeKind kind;
} VerifyFieldsCtx;
static bool verify_fields(EastType *c, const void *ctx)
{
    const VerifyFieldsCtx *v = ctx;
    if (c->kind != v->kind) return false;
    size_t n = v->kind == EAST_TYPE_STRUCT ? c->data.struct_.num_fields : c->data.variant.num_cases;
    if (n != v->count) return false;
    EastTypeField *fields =
        v->kind == EAST_TYPE_STRUCT ? c->data.struct_.fields : c->data.variant.cases;
    for (size_t i = 0; i < n; i++) {
        if (strcmp(fields[i].name, v->names[i]) != 0) return false;
        if (fields[i].type != v->types[i]) return false;
    }
    return true;
}

typedef struct {
    EastTypeKind kind;
    EastType **inputs;
    size_t ni;
    EastType *output;
} VerifyFnCtx;
static bool verify_fn(EastType *c, const void *ctx)
{
    const VerifyFnCtx *v = ctx;
    if (c->kind != v->kind || c->data.function.num_inputs != v->ni ||
        c->data.function.output != v->output)
        return false;
    for (size_t i = 0; i < v->ni; i++)
        if (c->data.function.inputs[i] != v->inputs[i]) return false;
    return true;
}

/* ------------------------------------------------------------------ */
/*  Constructors                                                       */
/* ------------------------------------------------------------------ */

static EastType *intern_elem_type(EastTypeKind kind, uint32_t tag, EastType *elem)
{
    uint32_t h = hash_combine(tag, (uint32_t)elem->type_id);
    VerifyElemCtx ctx = {kind, elem};
    EastType *cached = intern_find(h, verify_elem, &ctx);
    if (cached) return cached;
    EastType *t = arena_alloc_type(kind);
    t->data.element = elem; /* no retain — all types are immortal */
    intern_put(h, t);
    return t;
}

EastType *east_array_type(EastType *elem)
{
    return intern_elem_type(EAST_TYPE_ARRAY, 0x41, elem);
}
EastType *east_set_type(EastType *elem)
{
    return intern_elem_type(EAST_TYPE_SET, 0x53, elem);
}

EastType *east_dict_type(EastType *key, EastType *val)
{
    uint32_t h = hash_combine(0x44, (uint32_t)key->type_id);
    h = hash_combine(h, (uint32_t)val->type_id);
    VerifyDictCtx ctx = {key, val};
    EastType *cached = intern_find(h, verify_dict, &ctx);
    if (cached) return cached;
    EastType *t = arena_alloc_type(EAST_TYPE_DICT);
    t->data.dict.key = key;
    t->data.dict.value = val;
    intern_put(h, t);
    return t;
}

EastType *east_struct_type(const char **names, EastType **types, size_t count)
{
    /* Hash field names + child type_ids for intern lookup */
    uint32_t h = hash_combine(0x09, (uint32_t)count);
    for (size_t i = 0; i < count; i++) {
        h = hash_combine(h, hash_string(names[i]));
        h = hash_combine(h, (uint32_t)types[i]->type_id);
    }
    VerifyFieldsCtx ctx = {names, types, count, EAST_TYPE_STRUCT};
    EastType *cached = intern_find(h, verify_fields, &ctx);
    if (cached) return cached;

    EastType *t = arena_alloc_type(EAST_TYPE_STRUCT);
    EastTypeField *fields = NULL;
    if (count > 0) {
        fields = calloc(count, sizeof(EastTypeField));
        for (size_t i = 0; i < count; i++) {
            fields[i].name = strdup(names[i]);
            fields[i].type = types[i]; /* no retain — immortal children */
        }
    }
    t->data.struct_.fields = fields;
    t->data.struct_.num_fields = count;
    intern_put(h, t);
    return t;
}

EastType *east_variant_type(const char **names, EastType **types, size_t count)
{
    /* Sort names+types alphabetically BEFORE hashing (matching TS VariantType) */
    /* Use temporary sorted arrays */
    const char **sorted_names = count > 0 ? malloc(count * sizeof(char *)) : NULL;
    EastType **sorted_types = count > 0 ? malloc(count * sizeof(EastType *)) : NULL;
    if (count > 0) {
        /* Build temp array, sort it */
        typedef struct {
            const char *n;
            EastType *t;
        } NTP;
        NTP *tmp = malloc(count * sizeof(NTP));
        for (size_t i = 0; i < count; i++) {
            tmp[i].n = names[i];
            tmp[i].t = types[i];
        }
        for (size_t i = 1; i < count; i++) {
            NTP key = tmp[i];
            size_t j = i;
            while (j > 0 && strcmp(tmp[j - 1].n, key.n) > 0) {
                tmp[j] = tmp[j - 1];
                j--;
            }
            tmp[j] = key;
        }
        for (size_t i = 0; i < count; i++) {
            sorted_names[i] = tmp[i].n;
            sorted_types[i] = tmp[i].t;
        }
        free(tmp);
    }

    uint32_t h = hash_combine(0x08, (uint32_t)count);
    for (size_t i = 0; i < count; i++) {
        h = hash_combine(h, hash_string(sorted_names[i]));
        h = hash_combine(h, (uint32_t)sorted_types[i]->type_id);
    }
    VerifyFieldsCtx ctx = {sorted_names, sorted_types, count, EAST_TYPE_VARIANT};
    EastType *cached = intern_find(h, verify_fields, &ctx);
    if (cached) {
        free(sorted_names);
        free(sorted_types);
        return cached;
    }

    EastType *t = arena_alloc_type(EAST_TYPE_VARIANT);
    EastTypeField *cases = NULL;
    if (count > 0) {
        cases = calloc(count, sizeof(EastTypeField));
        for (size_t i = 0; i < count; i++) {
            cases[i].name = strdup(sorted_names[i]);
            cases[i].type = sorted_types[i];
        }
    }
    t->data.variant.cases = cases;
    t->data.variant.num_cases = count;

    // Build tag→idx hash side-table. Open addressing, linear probe, load
    // factor ≤ 0.5. Capacity is the next power of two ≥ 2*count (min 2).
    // The slots alias cases[i].name (not owned) so no extra allocation per
    // case-name. Cleaned up in the type destructor alongside `cases`.
    if (count > 0) {
        size_t cap = 2;
        while (cap < count * 2)
            cap <<= 1;
        struct EastVariantCaseSlot *slots = calloc(cap, sizeof(struct EastVariantCaseSlot));
        for (size_t i = 0; i < count; i++) {
            uint32_t nh = hash_string(cases[i].name);
            size_t probe = (size_t)nh & (cap - 1);
            while (slots[probe].name != NULL)
                probe = (probe + 1) & (cap - 1);
            slots[probe].name = cases[i].name;
            slots[probe].name_hash = nh;
            slots[probe].idx = i;
        }
        t->data.variant.tag_slots = slots;
        t->data.variant.tag_slots_mask = cap - 1;
    } else {
        t->data.variant.tag_slots = NULL;
        t->data.variant.tag_slots_mask = 0;
    }

    intern_put(h, t);
    free(sorted_names);
    free(sorted_types);
    return t;
}

size_t east_variant_type_case_idx(const EastType *type, const char *tag)
{
    if (!type || type->kind != EAST_TYPE_VARIANT || !tag) return SIZE_MAX;
    const struct EastVariantCaseSlot *slots = type->data.variant.tag_slots;
    if (!slots) return SIZE_MAX;
    size_t mask = type->data.variant.tag_slots_mask;
    uint32_t nh = hash_string(tag);
    size_t probe = (size_t)nh & mask;
    // Linear probe over a slot table sized to load ≤ 0.5, so this terminates
    // in O(1) expected and always in O(capacity) worst case.
    for (size_t step = 0; step <= mask; step++) {
        const struct EastVariantCaseSlot *s = &slots[(probe + step) & mask];
        if (s->name == NULL) return SIZE_MAX;
        if (s->name_hash == nh && strcmp(s->name, tag) == 0) return s->idx;
    }
    return SIZE_MAX;
}

EastType *east_ref_type(EastType *inner)
{
    return intern_elem_type(EAST_TYPE_REF, 0x52, inner);
}
EastType *east_vector_type(EastType *elem)
{
    return intern_elem_type(EAST_TYPE_VECTOR, 0x56, elem);
}
EastType *east_matrix_type(EastType *elem)
{
    return intern_elem_type(EAST_TYPE_MATRIX, 0x4d, elem);
}

static EastType *function_type_impl(EastTypeKind kind, uint32_t kind_tag, EastType **inputs,
                                    size_t num_inputs, EastType *output)
{
    uint32_t h = hash_combine(kind_tag, (uint32_t)num_inputs);
    for (size_t i = 0; i < num_inputs; i++)
        h = hash_combine(h, (uint32_t)inputs[i]->type_id);
    h = hash_combine(h, (uint32_t)output->type_id);
    VerifyFnCtx ctx = {kind, inputs, num_inputs, output};
    EastType *cached = intern_find(h, verify_fn, &ctx);
    if (cached) return cached;

    EastType *t = arena_alloc_type(kind);
    EastType **inp = NULL;
    if (num_inputs > 0) {
        inp = calloc(num_inputs, sizeof(EastType *));
        for (size_t i = 0; i < num_inputs; i++)
            inp[i] = inputs[i]; /* no retain — immortal children */
    }
    t->data.function.inputs = inp;
    t->data.function.num_inputs = num_inputs;
    t->data.function.output = output; /* no retain — immortal */
    intern_put(h, t);
    return t;
}

EastType *east_function_type(EastType **inputs, size_t num_inputs, EastType *output)
{
    return function_type_impl(EAST_TYPE_FUNCTION, 0x46, inputs, num_inputs, output);
}

EastType *east_async_function_type(EastType **inputs, size_t num_inputs, EastType *output)
{
    return function_type_impl(EAST_TYPE_ASYNC_FUNCTION, 0x61, inputs, num_inputs, output);
}

EastType *east_recursive_type_new(void)
{
    EastType *t = arena_alloc_type(EAST_TYPE_RECURSIVE);
    t->data.recursive.node = NULL;
    return t;
}

void east_recursive_type_set(EastType *rec, EastType *node)
{
    if (!rec || rec->kind != EAST_TYPE_RECURSIVE) return;
    /* NOTE: we do NOT retain node here because the inner type tree
     * contains self-references back to rec, forming a cycle. Both the
     * wrapper and the inner tree are arena-immortal, so the cycle needs
     * no cleanup — the arena reclaims everything in
     * east_type_registry_clear(). */
    rec->data.recursive.node = node;
}

/* ------------------------------------------------------------------ */
/*  Ref counting                                                       */
/* ------------------------------------------------------------------ */

void east_type_retain(EastType *t)
{
    if (!t) return;
    if (t->ref_count < 0) return; /* singleton -- never freed */
    __atomic_add_fetch(&t->ref_count, 1, __ATOMIC_RELAXED);
}

void east_type_release(EastType *t)
{
    if (!t) return;
    if (t->ref_count == -1) return; /* singleton -- never freed */

    if (__atomic_sub_fetch(&t->ref_count, 1, __ATOMIC_ACQ_REL) > 0) return;

    /* ref_count reached 0 -- free children then the node itself */
    switch (t->kind) {
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_REF:
    case EAST_TYPE_VECTOR:
    case EAST_TYPE_MATRIX:
        east_type_release(t->data.element);
        break;

    case EAST_TYPE_DICT:
        east_type_release(t->data.dict.key);
        east_type_release(t->data.dict.value);
        break;

    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < t->data.struct_.num_fields; i++) {
            free(t->data.struct_.fields[i].name);
            east_type_release(t->data.struct_.fields[i].type);
        }
        free(t->data.struct_.fields);
        break;

    case EAST_TYPE_VARIANT:
        for (size_t i = 0; i < t->data.variant.num_cases; i++) {
            free(t->data.variant.cases[i].name);
            east_type_release(t->data.variant.cases[i].type);
        }
        free(t->data.variant.cases);
        free(t->data.variant.tag_slots);
        break;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        for (size_t i = 0; i < t->data.function.num_inputs; i++) {
            east_type_release(t->data.function.inputs[i]);
        }
        free(t->data.function.inputs);
        east_type_release(t->data.function.output);
        break;

    case EAST_TYPE_RECURSIVE:
        /* Recursive wrappers are arena-allocated and immortal
         * (ref_count == -1), so they can never reach this switch —
         * the singleton check above always returns first. */
        return;

    default:
        /* primitives have no children to release */
        break;
    }

    free(t);
}

/* ------------------------------------------------------------------ */
/*  Structural equality                                                */
/* ------------------------------------------------------------------ */

/*
 * Recursive type comparison needs cycle detection.  Self-references in
 * the inner tree point back to the Recursive wrapper, creating cycles.
 * We maintain an assumption stack: when entering a Recursive pair, we
 * assume (a, b) are equal and push them.  If we re-encounter the same
 * pair via self-references, we return true (co-inductive reasoning).
 */

typedef struct {
    EastType **pairs_a;
    EastType **pairs_b;
    size_t depth;
    size_t cap;
} TypeEqualCtx;

static bool type_equal_ctx(EastType *a, EastType *b, TypeEqualCtx *ctx)
{
    if (a == b) return true;
    if (!a || !b) return false;
    if (a->kind != b->kind) return false;

    /* Check assumption stack — if we're already comparing this pair,
     * it means we've reached a cycle and the types are co-inductively equal. */
    for (size_t i = 0; i < ctx->depth; i++) {
        if (ctx->pairs_a[i] == a && ctx->pairs_b[i] == b) return true;
    }

    switch (a->kind) {
    /* Primitives: kind match is sufficient */
    case EAST_TYPE_NEVER:
    case EAST_TYPE_NULL:
    case EAST_TYPE_BOOLEAN:
    case EAST_TYPE_INTEGER:
    case EAST_TYPE_FLOAT:
    case EAST_TYPE_STRING:
    case EAST_TYPE_DATETIME:
    case EAST_TYPE_BLOB:
        return true;

    /* Single element types */
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_REF:
    case EAST_TYPE_VECTOR:
    case EAST_TYPE_MATRIX:
        return type_equal_ctx(a->data.element, b->data.element, ctx);

    case EAST_TYPE_DICT:
        return type_equal_ctx(a->data.dict.key, b->data.dict.key, ctx) &&
               type_equal_ctx(a->data.dict.value, b->data.dict.value, ctx);

    case EAST_TYPE_STRUCT:
        if (a->data.struct_.num_fields != b->data.struct_.num_fields) return false;
        for (size_t i = 0; i < a->data.struct_.num_fields; i++) {
            if (strcmp(a->data.struct_.fields[i].name, b->data.struct_.fields[i].name) != 0)
                return false;
            if (!type_equal_ctx(a->data.struct_.fields[i].type, b->data.struct_.fields[i].type,
                                ctx))
                return false;
        }
        return true;

    case EAST_TYPE_VARIANT:
        if (a->data.variant.num_cases != b->data.variant.num_cases) return false;
        for (size_t i = 0; i < a->data.variant.num_cases; i++) {
            if (strcmp(a->data.variant.cases[i].name, b->data.variant.cases[i].name) != 0)
                return false;
            if (!type_equal_ctx(a->data.variant.cases[i].type, b->data.variant.cases[i].type, ctx))
                return false;
        }
        return true;

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        if (a->data.function.num_inputs != b->data.function.num_inputs) return false;
        for (size_t i = 0; i < a->data.function.num_inputs; i++) {
            if (!type_equal_ctx(a->data.function.inputs[i], b->data.function.inputs[i], ctx))
                return false;
        }
        return type_equal_ctx(a->data.function.output, b->data.function.output, ctx);

    case EAST_TYPE_RECURSIVE: {
        /* Push assumption that (a, b) are equal, then compare inner nodes.
         * Self-references back to a/b will hit the assumption stack check
         * above, terminating the recursion. */
        if (ctx->depth >= ctx->cap) {
            ctx->cap = ctx->cap ? ctx->cap * 2 : 8;
            ctx->pairs_a = realloc(ctx->pairs_a, ctx->cap * sizeof(EastType *));
            ctx->pairs_b = realloc(ctx->pairs_b, ctx->cap * sizeof(EastType *));
        }
        ctx->pairs_a[ctx->depth] = a;
        ctx->pairs_b[ctx->depth] = b;
        ctx->depth++;
        bool result = type_equal_ctx(a->data.recursive.node, b->data.recursive.node, ctx);
        ctx->depth--;
        return result;
    }
    }

    return false;
}

bool east_type_equal(EastType *a, EastType *b)
{
    if (a == b) return true;
    if (!a || !b) return false;
    if (a->kind != b->kind) return false;

    /* For non-recursive types, no ctx needed — but we use the ctx path
     * uniformly so that any nested Recursive types are handled correctly. */
    TypeEqualCtx ctx = {NULL, NULL, 0, 0};
    bool result = type_equal_ctx(a, b, &ctx);
    free(ctx.pairs_a);
    free(ctx.pairs_b);
    return result;
}

/* ------------------------------------------------------------------ */
/*  Printing                                                           */
/* ------------------------------------------------------------------ */

int east_type_print(EastType *t, char *buf, size_t buf_size)
{
    if (!t) return snprintf(buf, buf_size, "(null)");

    switch (t->kind) {
    case EAST_TYPE_NEVER:
        return snprintf(buf, buf_size, "Never");
    case EAST_TYPE_NULL:
        return snprintf(buf, buf_size, "Null");
    case EAST_TYPE_BOOLEAN:
        return snprintf(buf, buf_size, "Boolean");
    case EAST_TYPE_INTEGER:
        return snprintf(buf, buf_size, "Integer");
    case EAST_TYPE_FLOAT:
        return snprintf(buf, buf_size, "Float");
    case EAST_TYPE_STRING:
        return snprintf(buf, buf_size, "String");
    case EAST_TYPE_DATETIME:
        return snprintf(buf, buf_size, "DateTime");
    case EAST_TYPE_BLOB:
        return snprintf(buf, buf_size, "Blob");

    case EAST_TYPE_ARRAY: {
        char inner[256];
        east_type_print(t->data.element, inner, sizeof(inner));
        return snprintf(buf, buf_size, "Array<%s>", inner);
    }

    case EAST_TYPE_SET: {
        char inner[256];
        east_type_print(t->data.element, inner, sizeof(inner));
        return snprintf(buf, buf_size, "Set<%s>", inner);
    }

    case EAST_TYPE_VECTOR: {
        char inner[256];
        east_type_print(t->data.element, inner, sizeof(inner));
        return snprintf(buf, buf_size, "Vector<%s>", inner);
    }

    case EAST_TYPE_MATRIX: {
        char inner[256];
        east_type_print(t->data.element, inner, sizeof(inner));
        return snprintf(buf, buf_size, "Matrix<%s>", inner);
    }

    case EAST_TYPE_REF: {
        char inner[256];
        east_type_print(t->data.element, inner, sizeof(inner));
        return snprintf(buf, buf_size, "Ref<%s>", inner);
    }

    case EAST_TYPE_DICT: {
        char kbuf[256], vbuf[256];
        east_type_print(t->data.dict.key, kbuf, sizeof(kbuf));
        east_type_print(t->data.dict.value, vbuf, sizeof(vbuf));
        return snprintf(buf, buf_size, "Dict<%s, %s>", kbuf, vbuf);
    }

    case EAST_TYPE_STRUCT: {
        int written = snprintf(buf, buf_size, "Struct { ");
        for (size_t i = 0; i < t->data.struct_.num_fields; i++) {
            char fbuf[256];
            east_type_print(t->data.struct_.fields[i].type, fbuf, sizeof(fbuf));
            if (i > 0) {
                written += snprintf(buf + written,
                                    buf_size > (size_t)written ? buf_size - written : 0, ", ");
            }
            written += snprintf(buf + written, buf_size > (size_t)written ? buf_size - written : 0,
                                "%s: %s", t->data.struct_.fields[i].name, fbuf);
        }
        written +=
            snprintf(buf + written, buf_size > (size_t)written ? buf_size - written : 0, " }");
        return written;
    }

    case EAST_TYPE_VARIANT: {
        int written = snprintf(buf, buf_size, "Variant { ");
        for (size_t i = 0; i < t->data.variant.num_cases; i++) {
            char cbuf[256];
            east_type_print(t->data.variant.cases[i].type, cbuf, sizeof(cbuf));
            if (i > 0) {
                written += snprintf(buf + written,
                                    buf_size > (size_t)written ? buf_size - written : 0, " | ");
            }
            written += snprintf(buf + written, buf_size > (size_t)written ? buf_size - written : 0,
                                "%s: %s", t->data.variant.cases[i].name, cbuf);
        }
        written +=
            snprintf(buf + written, buf_size > (size_t)written ? buf_size - written : 0, " }");
        return written;
    }

    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION: {
        const char *prefix = (t->kind == EAST_TYPE_ASYNC_FUNCTION) ? "AsyncFunction" : "Function";
        int written = snprintf(buf, buf_size, "%s(", prefix);
        for (size_t i = 0; i < t->data.function.num_inputs; i++) {
            char ibuf[256];
            east_type_print(t->data.function.inputs[i], ibuf, sizeof(ibuf));
            if (i > 0) {
                written += snprintf(buf + written,
                                    buf_size > (size_t)written ? buf_size - written : 0, ", ");
            }
            written += snprintf(buf + written, buf_size > (size_t)written ? buf_size - written : 0,
                                "%s", ibuf);
        }
        char obuf[256];
        east_type_print(t->data.function.output, obuf, sizeof(obuf));
        written += snprintf(buf + written, buf_size > (size_t)written ? buf_size - written : 0,
                            ") -> %s", obuf);
        return written;
    }

    case EAST_TYPE_RECURSIVE:
        if (t->data.recursive.node) {
            return snprintf(buf, buf_size, "Recursive(...)");
        }
        return snprintf(buf, buf_size, "Recursive(empty)");
    }

    return snprintf(buf, buf_size, "Unknown");
}

/* ------------------------------------------------------------------ */
/*  Kind name helper                                                   */
/* ------------------------------------------------------------------ */

const char *east_type_kind_name(EastTypeKind kind)
{
    switch (kind) {
    case EAST_TYPE_NEVER:
        return "Never";
    case EAST_TYPE_NULL:
        return "Null";
    case EAST_TYPE_BOOLEAN:
        return "Boolean";
    case EAST_TYPE_INTEGER:
        return "Integer";
    case EAST_TYPE_FLOAT:
        return "Float";
    case EAST_TYPE_STRING:
        return "String";
    case EAST_TYPE_DATETIME:
        return "DateTime";
    case EAST_TYPE_BLOB:
        return "Blob";
    case EAST_TYPE_ARRAY:
        return "Array";
    case EAST_TYPE_SET:
        return "Set";
    case EAST_TYPE_DICT:
        return "Dict";
    case EAST_TYPE_STRUCT:
        return "Struct";
    case EAST_TYPE_VARIANT:
        return "Variant";
    case EAST_TYPE_REF:
        return "Ref";
    case EAST_TYPE_VECTOR:
        return "Vector";
    case EAST_TYPE_MATRIX:
        return "Matrix";
    case EAST_TYPE_FUNCTION:
        return "Function";
    case EAST_TYPE_ASYNC_FUNCTION:
        return "AsyncFunction";
    case EAST_TYPE_RECURSIVE:
        return "Recursive";
    }
    return "Unknown";
}
