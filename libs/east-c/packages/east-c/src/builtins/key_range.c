/*
 * The range builtins (#1616) — see key_range.h.
 */
#include "key_range.h"
#include "east/key_bound.h"
#include "east/serialization.h"
#include "east/values.h"
#include <stdlib.h>
#include <string.h>

/* The type parameters of the range builtin being called: set by its factory
 * immediately before its impl runs, and borrowed from the call's IR node. */
static _Thread_local EastType *s_key_type = NULL;
static _Thread_local EastType *s_from_type = NULL; /* a prefix builtin's P */
static _Thread_local EastType *s_to_type = NULL;

/* A bound as a test of a key reads it: its value, and its type. */
typedef struct {
    EastValue *value;
    const EastType *type;
} Bound;

/* "Is this key at or past the bound?" — false, then true, over keys in order. */
static bool at_or_past(EastValue *key, void *ctx)
{
    const Bound *bound = (const Bound *)ctx;
    return east_key_bound_compare(key, bound->value, bound->type) >= 0;
}

/* "Is this key past the bound?" — past every key that equals it on the fields
 * it gives. */
static bool past(EastValue *key, void *ctx)
{
    const Bound *bound = (const Bound *)ctx;
    return east_key_bound_compare(key, bound->value, bound->type) > 0;
}

/* Whether a bound of this type is taken; posts its refusal when it is not. */
static bool bound_taken(EastKeyBoundName name, EastType *key, EastType *type)
{
    if (east_key_bound_accepts(name, key, type)) return true;
    if (!key) {
        east_builtin_error("a key range is missing its key's type");
        return false;
    }
    char *refusal = east_key_bound_refusal(name, key, type);
    east_builtin_error(refusal ? refusal : "out of memory");
    free(refusal);
    return false;
}

/* A collection that still reads from its pager — a task's input, a lazily
 * opened file, a range of one: its range is a view the pager serves, which
 * reads nothing until it is read. */
static bool reads_from_pager(const EastValue *collection)
{
    return collection && collection->kind == EAST_VAL_PAGED &&
           collection->data.paged.hydrated == NULL;
}

/* The run of a Dict or a Set held in memory between two tests of its keys, as
 * a new collection; NULL with a builtin error posted when it cannot be had. A
 * paged collection that was decoded whole is the collection it decoded to. */
static EastValue *range_between(EastValue *collection, EastKeyTest from, void *from_ctx,
                                EastKeyTest to, void *to_ctx)
{
    collection = east_paged_hydrated(collection);
    EastValue *range;
    if (collection && collection->kind == EAST_VAL_DICT) {
        range = east_dict_range(collection, from, from_ctx, to, to_ctx);
    } else if (collection && collection->kind == EAST_VAL_SET) {
        range = east_set_range(collection, from, from_ctx, to, to_ctx);
    } else {
        east_builtin_error("a key range reads a Dict or a Set");
        return NULL;
    }
    if (!range) east_builtin_error("out of memory");
    return range;
}

/* Whether an option is `some`, with its value. */
static bool option_some(EastValue *option, EastValue **value)
{
    if (!option || option->kind != EAST_VAL_VARIANT) return false;
    const char *tag = east_variant_case_name(option);
    if (!tag || strcmp(tag, "some") != 0) return false;
    *value = option->data.variant.value;
    return true;
}

/* (collection, from: Option<F>, to: Option<T>) */
static EastValue *key_range_impl(EastValue **args, size_t n)
{
    EastType *key = s_key_type;
    EastType *from_type = s_from_type;
    EastType *to_type = s_to_type;
    if (n < 3) {
        east_builtin_error("a key range takes a collection and its two bounds");
        return NULL;
    }
    if (!bound_taken(EAST_KEY_BOUND_FROM, key, from_type) ||
        !bound_taken(EAST_KEY_BOUND_TO, key, to_type))
        return NULL;
    Bound from = {NULL, from_type};
    Bound to = {NULL, to_type};
    bool has_from = option_some(args[1], &from.value);
    bool has_to = option_some(args[2], &to.value);
    if (reads_from_pager(args[0]))
        return east_beast2_open_paged_range(args[0], has_from ? from.value : NULL, from_type, false,
                                            has_to ? to.value : NULL, to_type, false);
    return range_between(args[0], has_from ? at_or_past : NULL, &from, has_to ? at_or_past : NULL,
                         &to);
}

/* (collection, prefix: P) */
static EastValue *key_prefix_impl(EastValue **args, size_t n)
{
    EastType *key = s_key_type;
    EastType *type = s_from_type;
    if (n < 2) {
        east_builtin_error("a prefix takes a collection and the prefix");
        return NULL;
    }
    if (!bound_taken(EAST_KEY_BOUND_PREFIX, key, type)) return NULL;
    if (reads_from_pager(args[0]))
        return east_beast2_open_paged_range(args[0], args[1], type, false, args[1], type, true);
    Bound prefix = {args[1], type};
    return range_between(args[0], at_or_past, &prefix, past, &prefix);
}

BuiltinImpl east_key_range_builtin(EastType *key, EastType *from, EastType *to)
{
    s_key_type = key;
    s_from_type = from;
    s_to_type = to;
    return key_range_impl;
}

BuiltinImpl east_key_prefix_builtin(EastType *key, EastType *prefix)
{
    s_key_type = key;
    s_from_type = prefix;
    s_to_type = NULL;
    return key_prefix_impl;
}
