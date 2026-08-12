/*
 * Type-aware comparison builtins.
 *
 * Mirrors TS comparison.ts: isFor, equalFor, compareFor.
 * Each factory captures the type parameter via thread-local;
 * the implementation dispatches based on the type tree.
 */
#include "east/builtins.h"
#include "east/serialization.h" /* east_paged_hydrated for frozen lazy Is */
#include "east/types.h"
#include "east/values.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/*  Cycle detection context (mirrors TS ValueContext)                   */
/*                                                                     */
/*  Tracks visited (a, b) pointer pairs to handle circular references  */
/*  in mutable container types (Array, Dict, Ref, Struct, Variant).    */
/* ------------------------------------------------------------------ */

typedef struct {
    struct {
        EastValue *a;
        EastValue *b;
    } *pairs;
    size_t len, cap;
} CycleCtx;

static void cycle_init(CycleCtx *c)
{
    c->pairs = NULL;
    c->len = 0;
    c->cap = 0;
}
static void cycle_free(CycleCtx *c)
{
    free(c->pairs);
}

/* Returns true if this pair was already visited (cycle detected) */
static bool cycle_check_and_mark(CycleCtx *c, EastValue *a, EastValue *b)
{
    for (size_t i = 0; i < c->len; i++)
        if (c->pairs[i].a == a && c->pairs[i].b == b) return true;
    if (c->len >= c->cap) {
        c->cap = c->cap ? c->cap * 2 : 8;
        c->pairs = realloc(c->pairs, c->cap * sizeof(c->pairs[0]));
    }
    c->pairs[c->len].a = a;
    c->pairs[c->len].b = b;
    c->len++;
    return false;
}

/* ------------------------------------------------------------------ */
/*  isFor — identity comparison (TS Object.is semantics)               */
/*  Mutable types: pointer identity. Immutable: value.                 */
/*  Struct/Variant: recursive per-field isFor. Function: throws.       */
/*  Frozen collections (#539) are value types — the Blob precedent:    */
/*  both operands frozen compares by deep value.                       */
/* ------------------------------------------------------------------ */

static bool equal_for(EastType *type, EastValue *a, EastValue *b);

static bool is_for(EastType *type, EastValue *a, EastValue *b)
{
    if (a == b) return true;
    if (!a || !b) return false;

    switch (type->kind) {
    case EAST_TYPE_ARRAY:
    case EAST_TYPE_SET:
    case EAST_TYPE_DICT:
    case EAST_TYPE_VECTOR:
    case EAST_TYPE_MATRIX:
        /* Both frozen: deep value equality. Any mutable operand keeps
         * identity semantics (the a == b fast path above). Frozen lazy
         * values hydrate first — equal_for walks the eager representation. */
        if (east_value_frozen(a) && east_value_frozen(b)) {
            if (a->kind == EAST_VAL_PAGED) {
                EastValue *h = east_paged_hydrated(a);
                if (h) a = h;
            }
            if (b->kind == EAST_VAL_PAGED) {
                EastValue *h = east_paged_hydrated(b);
                if (h) b = h;
            }
            return equal_for(type, a, b);
        }
        return false;
    case EAST_TYPE_REF:
        /* A Ref is the explicit identity cell — frozen or not, its
         * meaningful relation is identity. */
        return false;
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return false;
    case EAST_TYPE_NEVER:
        return false;
    case EAST_TYPE_NULL:
        return true;
    case EAST_TYPE_BOOLEAN:
        return a->data.boolean == b->data.boolean;
    case EAST_TYPE_INTEGER:
        return a->data.integer == b->data.integer;
    case EAST_TYPE_FLOAT:
        if (isnan(a->data.float64)) return isnan(b->data.float64);
        return a->data.float64 == b->data.float64;
    case EAST_TYPE_STRING:
        return a->data.string.len == b->data.string.len &&
               memcmp(a->data.string.data, b->data.string.data, a->data.string.len) == 0;
    case EAST_TYPE_DATETIME:
        return a->data.datetime == b->data.datetime;
    case EAST_TYPE_BLOB:
        return a->data.blob.len == b->data.blob.len &&
               (a->data.blob.len == 0 ||
                memcmp(a->data.blob.data, b->data.blob.data, a->data.blob.len) == 0);
    case EAST_TYPE_STRUCT:
        for (size_t i = 0; i < type->data.struct_.num_fields; i++)
            if (!is_for(type->data.struct_.fields[i].type, a->data.struct_.field_values[i],
                        b->data.struct_.field_values[i]))
                return false;
        return true;
    case EAST_TYPE_VARIANT: {
        const char *an = east_variant_case_name(a);
        const char *bn = east_variant_case_name(b);
        if (strcmp(an, bn) != 0) return false;
        for (size_t i = 0; i < type->data.variant.num_cases; i++)
            if (strcmp(type->data.variant.cases[i].name, an) == 0)
                return is_for(type->data.variant.cases[i].type, a->data.variant.value,
                              b->data.variant.value);
        return false;
    }
    case EAST_TYPE_RECURSIVE:
        return is_for(type->data.recursive.node, a, b);
    default:
        return false;
    }
}

/* ------------------------------------------------------------------ */
/*  equal_for — deep equality with cycle detection                     */
/*  Function: always true. Float: Object.is (NaN==NaN, +0!=-0).       */
/* ------------------------------------------------------------------ */

static bool equal_for_impl(EastType *type, EastValue *a, EastValue *b, CycleCtx *ctx);

static bool equal_for_impl(EastType *type, EastValue *a, EastValue *b, CycleCtx *ctx)
{
    if (a == b) return true;
    if (!a || !b) return false;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
        return false;
    case EAST_TYPE_NULL:
        return true;
    case EAST_TYPE_BOOLEAN:
        return a->data.boolean == b->data.boolean;
    case EAST_TYPE_INTEGER:
        return a->data.integer == b->data.integer;
    case EAST_TYPE_FLOAT:
        if (isnan(a->data.float64)) return isnan(b->data.float64);
        if (isnan(b->data.float64)) return false;
        if (a->data.float64 == 0.0 && b->data.float64 == 0.0)
            return signbit(a->data.float64) == signbit(b->data.float64);
        return a->data.float64 == b->data.float64;
    case EAST_TYPE_STRING:
        return a->data.string.len == b->data.string.len &&
               memcmp(a->data.string.data, b->data.string.data, a->data.string.len) == 0;
    case EAST_TYPE_DATETIME:
        return a->data.datetime == b->data.datetime;
    case EAST_TYPE_BLOB:
        return a->data.blob.len == b->data.blob.len &&
               (a->data.blob.len == 0 ||
                memcmp(a->data.blob.data, b->data.blob.data, a->data.blob.len) == 0);
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return true;

    case EAST_TYPE_VECTOR: {
        if (a->data.vector.len != b->data.vector.len) return false;
        size_t n = a->data.vector.len;
        size_t esize = (type->data.element->kind == EAST_TYPE_FLOAT)     ? sizeof(double)
                       : (type->data.element->kind == EAST_TYPE_BOOLEAN) ? sizeof(bool)
                                                                         : sizeof(int64_t);
        return n == 0 || memcmp(a->data.vector.data, b->data.vector.data, n * esize) == 0;
    }
    case EAST_TYPE_MATRIX: {
        if (a->data.matrix.rows != b->data.matrix.rows ||
            a->data.matrix.cols != b->data.matrix.cols)
            return false;
        size_t n = a->data.matrix.rows * a->data.matrix.cols;
        size_t esize = (type->data.element->kind == EAST_TYPE_FLOAT)     ? sizeof(double)
                       : (type->data.element->kind == EAST_TYPE_BOOLEAN) ? sizeof(bool)
                                                                         : sizeof(int64_t);
        return n == 0 || memcmp(a->data.matrix.data, b->data.matrix.data, n * esize) == 0;
    }

    case EAST_TYPE_REF:
        if (cycle_check_and_mark(ctx, a, b)) return true;
        return equal_for_impl(type->data.element, a->data.ref.value, b->data.ref.value, ctx);

    case EAST_TYPE_ARRAY:
        if (cycle_check_and_mark(ctx, a, b)) return true;
        if (a->data.array.len != b->data.array.len) return false;
        for (size_t i = 0; i < a->data.array.len; i++)
            if (!equal_for_impl(type->data.element, a->data.array.items[i], b->data.array.items[i],
                                ctx))
                return false;
        return true;

    case EAST_TYPE_SET:
        if (a->data.set.len != b->data.set.len) return false;
        for (size_t i = 0; i < a->data.set.len; i++)
            if (!equal_for_impl(type->data.element, east_set_at(a, i), east_set_at(b, i), ctx))
                return false;
        return true;

    case EAST_TYPE_DICT:
        if (cycle_check_and_mark(ctx, a, b)) return true;
        if (a->data.dict.len != b->data.dict.len) return false;
        for (size_t i = 0; i < a->data.dict.len; i++) {
            if (!equal_for_impl(type->data.dict.key, east_dict_key_at(a, i), east_dict_key_at(b, i),
                                ctx))
                return false;
            if (!equal_for_impl(type->data.dict.value, east_dict_val_at(a, i),
                                east_dict_val_at(b, i), ctx))
                return false;
        }
        return true;

    case EAST_TYPE_STRUCT:
        if (cycle_check_and_mark(ctx, a, b)) return true;
        for (size_t i = 0; i < type->data.struct_.num_fields; i++)
            if (!equal_for_impl(type->data.struct_.fields[i].type, a->data.struct_.field_values[i],
                                b->data.struct_.field_values[i], ctx))
                return false;
        return true;

    case EAST_TYPE_VARIANT: {
        /* Compare by case name — values may have narrower variant types
         * (East subtyping), so case_idx can differ from the comparison type. */
        const char *an = east_variant_case_name(a);
        const char *bn = east_variant_case_name(b);
        if (strcmp(an, bn) != 0) return false;
        if (cycle_check_and_mark(ctx, a, b)) return true;
        for (size_t i = 0; i < type->data.variant.num_cases; i++) {
            if (strcmp(type->data.variant.cases[i].name, an) == 0)
                return equal_for_impl(type->data.variant.cases[i].type, a->data.variant.value,
                                      b->data.variant.value, ctx);
        }
        return false;
    }

    case EAST_TYPE_RECURSIVE:
        return equal_for_impl(type->data.recursive.node, a, b, ctx);

    default:
        return false;
    }
}

static bool equal_for(EastType *type, EastValue *a, EastValue *b)
{
    CycleCtx ctx;
    cycle_init(&ctx);
    bool result = equal_for_impl(type, a, b, &ctx);
    cycle_free(&ctx);
    return result;
}

/* ------------------------------------------------------------------ */
/*  compare_for — total ordering with cycle detection                  */
/*  Function: 0. Float: NaN>all, -0<+0.                               */
/* ------------------------------------------------------------------ */

static int compare_for_impl(EastType *type, EastValue *a, EastValue *b, CycleCtx *ctx);

static int compare_for_impl(EastType *type, EastValue *a, EastValue *b, CycleCtx *ctx)
{
    if (a == b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    switch (type->kind) {
    case EAST_TYPE_NEVER:
        return 0;
    case EAST_TYPE_NULL:
        return 0;
    case EAST_TYPE_BOOLEAN:
        return a->data.boolean == b->data.boolean ? 0 : (a->data.boolean ? 1 : -1);
    case EAST_TYPE_INTEGER:
        return a->data.integer < b->data.integer ? -1 : (a->data.integer > b->data.integer ? 1 : 0);
    case EAST_TYPE_FLOAT: {
        double x = a->data.float64, y = b->data.float64;
        if (isnan(x)) return isnan(y) ? 0 : 1;
        if (isnan(y)) return -1;
        if (x == 0.0 && y == 0.0) {
            int sx = signbit(x), sy = signbit(y);
            return sx == sy ? 0 : (sx ? -1 : 1);
        }
        return x < y ? -1 : (x > y ? 1 : 0);
    }
    case EAST_TYPE_STRING: {
        size_t la = a->data.string.len, lb = b->data.string.len;
        size_t mn = la < lb ? la : lb;
        int c = mn > 0 ? memcmp(a->data.string.data, b->data.string.data, mn) : 0;
        if (c != 0) return c < 0 ? -1 : 1;
        return la < lb ? -1 : (la > lb ? 1 : 0);
    }
    case EAST_TYPE_DATETIME:
        return a->data.datetime < b->data.datetime ? -1
                                                   : (a->data.datetime > b->data.datetime ? 1 : 0);
    case EAST_TYPE_BLOB: {
        size_t la = a->data.blob.len, lb = b->data.blob.len;
        size_t mn = la < lb ? la : lb;
        int c = mn > 0 ? memcmp(a->data.blob.data, b->data.blob.data, mn) : 0;
        if (c != 0) return c < 0 ? -1 : 1;
        return la < lb ? -1 : (la > lb ? 1 : 0);
    }
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return 0;

    case EAST_TYPE_VECTOR: {
        size_t la = a->data.vector.len, lb = b->data.vector.len;
        size_t mn = la < lb ? la : lb;
        if (type->data.element->kind == EAST_TYPE_FLOAT) {
            double *da = (double *)a->data.vector.data, *db = (double *)b->data.vector.data;
            for (size_t i = 0; i < mn; i++) {
                double x = da[i], y = db[i];
                if (isnan(x)) {
                    if (!isnan(y)) return 1;
                    continue;
                }
                if (isnan(y)) return -1;
                if (x == 0.0 && y == 0.0) {
                    int sx = signbit(x), sy = signbit(y);
                    if (sx != sy) return sx ? -1 : 1;
                    continue;
                }
                if (x < y) return -1;
                if (x > y) return 1;
            }
        } else if (type->data.element->kind == EAST_TYPE_INTEGER) {
            int64_t *da = (int64_t *)a->data.vector.data, *db = (int64_t *)b->data.vector.data;
            for (size_t i = 0; i < mn; i++) {
                if (da[i] < db[i]) return -1;
                if (da[i] > db[i]) return 1;
            }
        } else {
            bool *da = (bool *)a->data.vector.data, *db = (bool *)b->data.vector.data;
            for (size_t i = 0; i < mn; i++) {
                if (da[i] != db[i]) return da[i] ? 1 : -1;
            }
        }
        return la < lb ? -1 : (la > lb ? 1 : 0);
    }
    case EAST_TYPE_MATRIX: {
        if (a->data.matrix.rows != b->data.matrix.rows)
            return a->data.matrix.rows < b->data.matrix.rows ? -1 : 1;
        if (a->data.matrix.cols != b->data.matrix.cols)
            return a->data.matrix.cols < b->data.matrix.cols ? -1 : 1;
        size_t n = a->data.matrix.rows * a->data.matrix.cols;
        if (type->data.element->kind == EAST_TYPE_FLOAT) {
            double *da = (double *)a->data.matrix.data, *db = (double *)b->data.matrix.data;
            for (size_t i = 0; i < n; i++) {
                double x = da[i], y = db[i];
                if (isnan(x)) {
                    if (!isnan(y)) return 1;
                    continue;
                }
                if (isnan(y)) return -1;
                if (x == 0.0 && y == 0.0) {
                    int sx = signbit(x), sy = signbit(y);
                    if (sx != sy) return sx ? -1 : 1;
                    continue;
                }
                if (x < y) return -1;
                if (x > y) return 1;
            }
        } else if (type->data.element->kind == EAST_TYPE_INTEGER) {
            int64_t *da = (int64_t *)a->data.matrix.data, *db = (int64_t *)b->data.matrix.data;
            for (size_t i = 0; i < n; i++) {
                if (da[i] < db[i]) return -1;
                if (da[i] > db[i]) return 1;
            }
        } else {
            bool *da = (bool *)a->data.matrix.data, *db = (bool *)b->data.matrix.data;
            for (size_t i = 0; i < n; i++) {
                if (da[i] != db[i]) return da[i] ? 1 : -1;
            }
        }
        return 0;
    }

    case EAST_TYPE_REF:
        if (cycle_check_and_mark(ctx, a, b)) return 0;
        return compare_for_impl(type->data.element, a->data.ref.value, b->data.ref.value, ctx);

    case EAST_TYPE_ARRAY: {
        if (cycle_check_and_mark(ctx, a, b)) return 0;
        size_t la = a->data.array.len, lb = b->data.array.len;
        size_t mn = la < lb ? la : lb;
        for (size_t i = 0; i < mn; i++) {
            int c = compare_for_impl(type->data.element, a->data.array.items[i],
                                     b->data.array.items[i], ctx);
            if (c != 0) return c;
        }
        return la < lb ? -1 : (la > lb ? 1 : 0);
    }

    case EAST_TYPE_SET: {
        size_t la = a->data.set.len, lb = b->data.set.len;
        size_t mn = la < lb ? la : lb;
        for (size_t i = 0; i < mn; i++) {
            int c = compare_for_impl(type->data.element, east_set_at(a, i), east_set_at(b, i), ctx);
            if (c != 0) return c;
        }
        return la < lb ? -1 : (la > lb ? 1 : 0);
    }

    case EAST_TYPE_DICT: {
        if (cycle_check_and_mark(ctx, a, b)) return 0;
        size_t la = a->data.dict.len, lb = b->data.dict.len;
        size_t mn = la < lb ? la : lb;
        for (size_t i = 0; i < mn; i++) {
            int c = compare_for_impl(type->data.dict.key, east_dict_key_at(a, i),
                                     east_dict_key_at(b, i), ctx);
            if (c != 0) return c;
            c = compare_for_impl(type->data.dict.value, east_dict_val_at(a, i),
                                 east_dict_val_at(b, i), ctx);
            if (c != 0) return c;
        }
        return la < lb ? -1 : (la > lb ? 1 : 0);
    }

    case EAST_TYPE_STRUCT: {
        for (size_t i = 0; i < type->data.struct_.num_fields; i++) {
            int c =
                compare_for_impl(type->data.struct_.fields[i].type, a->data.struct_.field_values[i],
                                 b->data.struct_.field_values[i], ctx);
            if (c != 0) return c;
        }
        return 0;
    }

    case EAST_TYPE_VARIANT: {
        /* Compare by case name (values may have narrower types) */
        const char *an = east_variant_case_name(a);
        const char *bn = east_variant_case_name(b);
        int nc = strcmp(an, bn);
        if (nc != 0) return nc < 0 ? -1 : 1;
        for (size_t i = 0; i < type->data.variant.num_cases; i++)
            if (strcmp(type->data.variant.cases[i].name, an) == 0)
                return compare_for_impl(type->data.variant.cases[i].type, a->data.variant.value,
                                        b->data.variant.value, ctx);
        return 0;
    }

    case EAST_TYPE_RECURSIVE:
        return compare_for_impl(type->data.recursive.node, a, b, ctx);

    default:
        return 0;
    }
}

static int compare_for(EastType *type, EastValue *a, EastValue *b)
{
    CycleCtx ctx;
    cycle_init(&ctx);
    int result = compare_for_impl(type, a, b, &ctx);
    cycle_free(&ctx);
    return result;
}

/* ------------------------------------------------------------------ */
/*  Builtin implementations + factories                                */
/* ------------------------------------------------------------------ */

static _Thread_local EastType *s_is_type = NULL;
static _Thread_local EastType *s_eq_type = NULL;
static _Thread_local EastType *s_neq_type = NULL;
static _Thread_local EastType *s_lt_type = NULL;
static _Thread_local EastType *s_le_type = NULL;
static _Thread_local EastType *s_gt_type = NULL;
static _Thread_local EastType *s_ge_type = NULL;

/* Fallback to type-unaware when type is NULL (shouldn't happen, but safe) */
static EastValue *builtin_is(EastValue **args, size_t n)
{
    (void)n;
    return s_is_type ? east_boolean(is_for(s_is_type, args[0], args[1]))
                     : east_boolean(args[0] == args[1]);
}
static EastValue *builtin_equal(EastValue **args, size_t n)
{
    (void)n;
    return s_eq_type ? east_boolean(equal_for(s_eq_type, args[0], args[1]))
                     : east_boolean(east_value_equal(args[0], args[1]));
}
static EastValue *builtin_not_equal(EastValue **args, size_t n)
{
    (void)n;
    return s_neq_type ? east_boolean(!equal_for(s_neq_type, args[0], args[1]))
                      : east_boolean(!east_value_equal(args[0], args[1]));
}
static EastValue *builtin_less(EastValue **args, size_t n)
{
    (void)n;
    return s_lt_type ? east_boolean(compare_for(s_lt_type, args[0], args[1]) < 0)
                     : east_boolean(east_value_compare(args[0], args[1]) < 0);
}
static EastValue *builtin_less_equal(EastValue **args, size_t n)
{
    (void)n;
    return s_le_type ? east_boolean(compare_for(s_le_type, args[0], args[1]) <= 0)
                     : east_boolean(east_value_compare(args[0], args[1]) <= 0);
}
static EastValue *builtin_greater(EastValue **args, size_t n)
{
    (void)n;
    return s_gt_type ? east_boolean(compare_for(s_gt_type, args[0], args[1]) > 0)
                     : east_boolean(east_value_compare(args[0], args[1]) > 0);
}
static EastValue *builtin_greater_equal(EastValue **args, size_t n)
{
    (void)n;
    return s_ge_type ? east_boolean(compare_for(s_ge_type, args[0], args[1]) >= 0)
                     : east_boolean(east_value_compare(args[0], args[1]) >= 0);
}

static BuiltinImpl is_factory(EastType **tp, size_t ntp)
{
    s_is_type = ntp > 0 ? tp[0] : NULL;
    return builtin_is;
}
static BuiltinImpl equal_factory(EastType **tp, size_t ntp)
{
    s_eq_type = ntp > 0 ? tp[0] : NULL;
    return builtin_equal;
}
static BuiltinImpl not_equal_factory(EastType **tp, size_t ntp)
{
    s_neq_type = ntp > 0 ? tp[0] : NULL;
    return builtin_not_equal;
}
static BuiltinImpl less_factory(EastType **tp, size_t ntp)
{
    s_lt_type = ntp > 0 ? tp[0] : NULL;
    return builtin_less;
}
static BuiltinImpl less_equal_factory(EastType **tp, size_t ntp)
{
    s_le_type = ntp > 0 ? tp[0] : NULL;
    return builtin_less_equal;
}
static BuiltinImpl greater_factory(EastType **tp, size_t ntp)
{
    s_gt_type = ntp > 0 ? tp[0] : NULL;
    return builtin_greater;
}
static BuiltinImpl greater_equal_factory(EastType **tp, size_t ntp)
{
    s_ge_type = ntp > 0 ? tp[0] : NULL;
    return builtin_greater_equal;
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

void east_register_comparison_builtins(BuiltinRegistry *reg)
{
    builtin_registry_register(reg, "Is", is_factory);
    builtin_registry_register(reg, "Equal", equal_factory);
    builtin_registry_register(reg, "NotEqual", not_equal_factory);
    builtin_registry_register(reg, "Less", less_factory);
    builtin_registry_register(reg, "LessEqual", less_equal_factory);
    builtin_registry_register(reg, "Greater", greater_factory);
    builtin_registry_register(reg, "GreaterEqual", greater_equal_factory);
}
