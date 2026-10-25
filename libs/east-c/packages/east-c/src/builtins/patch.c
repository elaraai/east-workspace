/*
 * Patch builtin functions: Diff, ApplyPatch, ComposePatch, InvertPatch.
 *
 * Implements the full East patch system with type-aware structural diffing.
 * Each patch is a Variant with cases:
 *   unchanged: Null
 *   replace: Struct{after: T, before: T}
 *   patch: <type-specific structural patch>  (containers only)
 */
#include "east/builtins.h"
#include "east/serialization.h"
#include "east/types.h"
#include "east/values.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ================================================================== */
/*  Type context: set by factory, read by impl                         */
/* ================================================================== */

static _Thread_local EastType *s_patch_type = NULL;
/* The concrete patch type (PatchType of the value type), passed as the second
 * type parameter. Patch builders construct variants by name with type==NULL;
 * after a patch is built, retype_patch() stamps the matching case index + type
 * onto each so consumers can resolve cases by index. */
static _Thread_local EastType *s_result_patch_type = NULL;

/* ================================================================== */
/*  Recursive types                                                    */
/* ================================================================== */

/* A recursive type is replace-only: its patch is `unchanged` or
 * `replace {before, after}` of the whole recursive value, at the wrapper and
 * at every reference back to it. That is the patch type every runtime
 * declares (PatchType in libs/east/src/patch/type_of_patch.ts and east-py's
 * types.py) and what the TypeScript runtime computes, so the values built
 * here conform to the type the IR carries on every runtime. (This runtime
 * used to unwrap a wrapper on its first encounter and patch its body
 * structurally, producing a `patch` case the declared type does not have —
 * TypeScript could not apply such a patch, and east-py refused to decode it;
 * #774.)
 *
 * Returns the type to dispatch on and sets *replace_only for a recursive
 * type (or a missing one). */
static EastType *resolve_type(EastType *t, bool *replace_only)
{
    *replace_only = !t || t->kind == EAST_TYPE_RECURSIVE;
    return t;
}

/* ================================================================== */
/*  Variant helpers                                                    */
/* ================================================================== */

static EastValue *mk_unchanged(void)
{
    return east_variant_new("unchanged", east_null(), NULL);
}

static EastValue *mk_replace(EastValue *before, EastValue *after)
{
    /* Field order MUST match the canonical PatchType declaration
     * (StructType({ before, after }) — declaration order is significant):
     * the text printer/parser, Equal, and beast2 pair type fields with
     * value fields positionally, so a value stored in any other order
     * prints/parses/compares with before and after swapped (#402). Only
     * ApplyPatch reads the fields by name and was immune. */
    const char *fn[] = {"before", "after"};
    EastValue *fv[] = {before, after};
    EastValue *s = east_struct_new(fn, fv, 2, NULL);
    EastValue *v = east_variant_new("replace", s, NULL);
    east_value_release(s);
    return v;
}

static EastValue *mk_patch_v(EastValue *inner)
{
    EastValue *v = east_variant_new("patch", inner, NULL);
    east_value_release(inner);
    return v;
}

static bool is_tag(EastValue *v, const char *tag)
{
    return v && v->kind == EAST_VAL_VARIANT && strcmp(east_variant_case_name(v), tag) == 0;
}

static EastValue *patch_payload(EastValue *v)
{
    return v->data.variant.value;
}

static EastValue *replace_before(EastValue *v)
{
    return east_struct_get_field(patch_payload(v), "before");
}

static EastValue *replace_after(EastValue *v)
{
    return east_struct_get_field(patch_payload(v), "after");
}

/* ================================================================== */
/*  Apply conflicts                                                    */
/* ================================================================== */

/* Signals a conflict — a patch that does not match the value it is applied
 * to — in the TypeScript reference's words (apply.ts), so a program that
 * catches or reports one reads the same on every runtime. Returns NULL for
 * the caller to return. */
static EastValue *apply_conflict(const char *fmt, ...)
{
    va_list ap;
    va_list again;
    va_start(ap, fmt);
    va_copy(again, ap);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    char *msg = n >= 0 ? malloc((size_t)n + 1) : NULL;
    if (msg) {
        vsnprintf(msg, (size_t)n + 1, fmt, again);
        east_builtin_error(msg);
        free(msg);
    } else {
        east_builtin_error("Cannot apply patch - the patch does not match the value");
    }
    va_end(again);
    return NULL;
}

/* A value in East text for a conflict message; the caller frees it. */
static char *printed(EastValue *v, EastType *type)
{
    char *s = east_print_value(v, type);
    return s ? s : strdup("?");
}

/* Whether a `replace` checks its `before` against the value first. The
 * reference compares for every type but a recursive one, whose whole value is
 * the unit of change, and a function, which has no equality. */
static bool replace_verifies(EastType *type)
{
    if (!type) return false;
    switch (type->kind) {
    case EAST_TYPE_RECURSIVE:
    case EAST_TYPE_FUNCTION:
    case EAST_TYPE_ASYNC_FUNCTION:
        return false;
    default:
        return true;
    }
}

/* A `replace` whose `before` is not the value it is applied to. */
static EastValue *replace_conflict(EastValue *base, EastValue *before, EastType *type)
{
    switch (type->kind) {
    case EAST_TYPE_ARRAY:
        return apply_conflict("Cannot apply replace - base array does not match expected");
    case EAST_TYPE_SET:
        return apply_conflict("Cannot apply replace - base set does not match expected");
    case EAST_TYPE_DICT:
        return apply_conflict("Cannot apply replace - base dict does not match expected");
    case EAST_TYPE_STRUCT:
        return apply_conflict("Cannot apply replace - base struct does not match expected");
    case EAST_TYPE_VARIANT:
        return apply_conflict("Cannot apply replace - base variant does not match expected");
    case EAST_TYPE_REF:
        return apply_conflict("Cannot apply replace - base ref does not match expected");
    default: {
        char *expected = printed(before, type);
        char *found = printed(base, type);
        apply_conflict("Cannot apply replace - expected %s, found %s", expected, found);
        free(expected);
        free(found);
        return NULL;
    }
    }
}

/* ================================================================== */
/*  Forward declarations                                               */
/* ================================================================== */

static EastValue *do_diff(EastValue *before, EastValue *after, EastType *type);
static EastValue *do_apply(EastValue *base, EastValue *patch, EastType *type);
static EastValue *do_compose(EastValue *first, EastValue *second, EastType *type);
static EastValue *do_invert(EastValue *patch, EastType *type);

/* ================================================================== */
/*  DIFF: Array (trim, then a shortest edit script)                    */
/* ================================================================== */

/* The comparisons an Array diff's search of its middle may spend: the search
 * stops at ARRAY_DIFF_BUDGET / (m' + n') edits. The TypeScript reference's
 * ARRAY_DIFF_BUDGET (libs/east/src/patch/types.ts) is the same number, so the
 * two runtimes stop at the same bound and keep the same pairs (#1425). */
#define ARRAY_DIFF_BUDGET ((size_t)1 << 24)

/* The element comparisons the Array diffs on this thread have made: what
 * east_diff_array_compares() reads. */
static _Thread_local size_t s_array_diff_compares = 0;

size_t east_diff_array_compares(void)
{
    return s_array_diff_compares;
}

/* The element equality an Array diff aligns by, counted. */
static bool elements_equal(EastValue *x, EastValue *y)
{
    s_array_diff_compares++;
    return east_value_equal(x, y);
}

/* The pairs of positions an Array diff keeps from `before` and `after`: the
 * common start and end, kept whole, and the middle's matches, ascending —
 * before[before_idx[i]] kept as after[after_idx[i]]. */
typedef struct {
    size_t start; /* leading positions equal in both */
    size_t end;   /* trailing positions equal in both, after `start` */
    size_t count; /* the middle's matches */
    size_t *before_idx;
    size_t *after_idx;
} ArrayAlignment;

/* The entries a search's trace holds up to step d: d+1 at each step. */
static size_t trace_entries(int64_t d)
{
    return (size_t)((d + 1) * (d + 2) / 2);
}

/* The furthest x the search reached at `step` on `diagonal`, from that step's
 * row of the trace. */
static int64_t trace_reached(const int32_t *trace, int64_t step, int64_t diagonal)
{
    return trace[trace_entries(step - 1) + (size_t)((diagonal + step) / 2)];
}

/* Reads a shortest script's matches off the trace, walking back from the end
 * of the middle, as the TypeScript reference's walkBack (types.ts) does: at
 * step d the move is recomputed from step d-1's row by the search's own rule,
 * the run between where the move landed and the current point is matches, and
 * the walk goes on from the move's start; the run from (0, 0) is the last.
 * Returns false, with the error set, when the matches cannot be allocated. */
static bool walk_back(const int32_t *trace, int64_t steps, int64_t width, int64_t height,
                      size_t offset, ArrayAlignment *out)
{
    size_t count = (size_t)((width + height - steps) / 2);
    size_t *before_idx = count > 0 ? malloc(count * sizeof(size_t)) : NULL;
    size_t *after_idx = count > 0 ? malloc(count * sizeof(size_t)) : NULL;
    if (count > 0 && (!before_idx || !after_idx)) {
        free(before_idx);
        free(after_idx);
        east_builtin_error("out of memory");
        return false;
    }

    size_t i = count;
    int64_t x = width, y = height;
    for (int64_t d = steps; d > 0; d--) {
        int64_t k = x - y;
        bool down = k == -d || (k != d && trace_reached(trace, d - 1, k - 1) <
                                              trace_reached(trace, d - 1, k + 1));
        int64_t from = down ? k + 1 : k - 1;
        int64_t from_x = trace_reached(trace, d - 1, from);
        int64_t landed_x = down ? from_x : from_x + 1;
        while (x > landed_x) {
            x--;
            y--;
            i--;
            before_idx[i] = offset + (size_t)x;
            after_idx[i] = offset + (size_t)y;
        }
        x = from_x;
        y = from_x - from;
    }
    while (x > 0) {
        x--;
        y--;
        i--;
        before_idx[i] = offset + (size_t)x;
        after_idx[i] = offset + (size_t)y;
    }

    out->count = count;
    out->before_idx = before_idx;
    out->after_idx = after_idx;
    return true;
}

/* Finds a shortest edit script over the middle of a and b — a[offset ..
 * offset+width) and b[offset .. offset+height) — by Myers' greedy forward
 * algorithm, to at most `bound` edits, as the TypeScript reference's
 * shortestScript (types.ts) does, step for step.
 *
 * A point (x, y) has passed over the first x elements of the one and the first
 * y of the other, on diagonal k = x - y; a move right deletes an element of a,
 * a move down inserts one of b, and a run along the diagonal keeps each pair
 * of equal elements. v[k] is the furthest x reached on diagonal k. At each
 * step d, diagonal k is reached down from k+1 when k = -d, or when k != d and
 * v[k-1] < v[k+1], and right from k-1 otherwise — the move that reaches
 * further, and the insert where both reach as far — then runs on while its
 * elements are equal. v keeps x as computed, even past the middle's edge; only
 * cells inside it are compared. Each step's d+1 values are kept in the trace.
 * Every value fits 32 bits: a bound of 1 or more means a middle of at most
 * 2^24 elements, and with a bound of 0 the one step compares the middle's first
 * two elements, which the trim left unequal.
 *
 * Returns 1 with the matches in *out, 0 when no script of `bound` edits or
 * fewer exists, and -1, with the error set, when out of memory. */
static int shortest_script(EastValue **a, EastValue **b, size_t offset, int64_t width,
                           int64_t height, int64_t bound, ArrayAlignment *out)
{
    int64_t center = bound + 1;
    /* v[center + 1], diagonal 1, starts at 0: the first step's move down from it
     * starts the search at (0, 0). */
    int32_t *v = calloc((size_t)(2 * bound + 3), sizeof(int32_t));
    size_t capacity = trace_entries(bound);
    size_t cap = capacity < 1024 ? capacity : 1024;
    int32_t *trace = malloc(cap * sizeof(int32_t));
    if (!v || !trace) {
        free(v);
        free(trace);
        east_builtin_error("out of memory");
        return -1;
    }

    for (int64_t d = 0; d <= bound; d++) {
        size_t row = trace_entries(d - 1);
        size_t need = row + (size_t)d + 1;
        if (need > cap) {
            size_t grown = 2 * cap > need ? 2 * cap : need;
            if (grown > capacity) grown = capacity;
            int32_t *larger = realloc(trace, grown * sizeof(int32_t));
            if (!larger) {
                free(v);
                free(trace);
                east_builtin_error("out of memory");
                return -1;
            }
            trace = larger;
            cap = grown;
        }
        for (int64_t k = -d; k <= d; k += 2) {
            int64_t x = (k == -d || (k != d && v[center + k - 1] < v[center + k + 1]))
                            ? v[center + k + 1]
                            : v[center + k - 1] + 1;
            int64_t y = x - k;
            while (x < width && y < height &&
                   elements_equal(a[offset + (size_t)x], b[offset + (size_t)y])) {
                x++;
                y++;
            }
            v[center + k] = (int32_t)x;
            trace[row + (size_t)((k + d) / 2)] = (int32_t)x;
            if (x >= width && y >= height) {
                bool walked = walk_back(trace, d, width, height, offset, out);
                free(v);
                free(trace);
                return walked ? 1 : -1;
            }
        }
    }
    free(v);
    free(trace);
    return 0;
}

/* Aligns two arrays: the pairs of positions their diff keeps, as the
 * TypeScript reference's alignArrays (types.ts) finds them (#1425). Trims the
 * longest common start, then the longest common end of what it leaves, so the
 * two never overlap; over the middle between them, of m' and n' elements,
 * finds a shortest edit script to at most min(m' + n', 2^24 / (m' + n'))
 * edits, and past that bound pairs the middle by position, a pair whose two
 * elements are equal being a match. The search compares each cell of the
 * middle at most once, so the alignment makes at most 2^24 + m + n + 2
 * comparisons, and its trace holds at most 8,394,753 entries.
 *
 * Returns false, with the error set, when out of memory; the caller frees
 * out->before_idx and out->after_idx otherwise. */
static bool align_arrays(EastValue **a, size_t na, EastValue **b, size_t nb, ArrayAlignment *out)
{
    size_t start = 0;
    while (start < na && start < nb && elements_equal(a[start], b[start]))
        start++;
    size_t end = 0;
    while (end < na - start && end < nb - start && elements_equal(a[na - 1 - end], b[nb - 1 - end]))
        end++;

    out->start = start;
    out->end = end;
    out->count = 0;
    out->before_idx = NULL;
    out->after_idx = NULL;

    size_t width = na - start - end;
    size_t height = nb - start - end;
    /* Nothing in the middle matches: the other side is deleted or inserted whole. */
    if (width == 0 || height == 0) return true;

    size_t total = width + height;
    size_t quotient = ARRAY_DIFF_BUDGET / total;
    size_t bound = total < quotient ? total : quotient;
    int found = shortest_script(a, b, start, (int64_t)width, (int64_t)height, (int64_t)bound, out);
    if (found < 0) return false;
    if (found > 0) return true;

    /* Past the bound: the middle's k-th element of `before` with its k-th of `after`. */
    size_t shorter = width < height ? width : height;
    size_t *before_idx = malloc(shorter * sizeof(size_t));
    size_t *after_idx = malloc(shorter * sizeof(size_t));
    if (!before_idx || !after_idx) {
        free(before_idx);
        free(after_idx);
        east_builtin_error("out of memory");
        return false;
    }
    size_t count = 0;
    for (size_t k = 0; k < shorter; k++) {
        if (elements_equal(a[start + k], b[start + k])) {
            before_idx[count] = start + k;
            after_idx[count] = start + k;
            count++;
        }
    }
    out->count = count;
    out->before_idx = before_idx;
    out->after_idx = after_idx;
    return true;
}

/* One `{key, offset, operation}` entry of an Array patch (consumes `op`). */
static void push_array_op(EastValue *ops, int64_t key, EastValue *op)
{
    const char *fn[] = {"key", "offset", "operation"};
    EastValue *fv[] = {east_integer(key), east_integer(0), op};
    EastValue *entry = east_struct_new(fn, fv, 3, NULL);
    east_array_push(ops, entry);
    east_value_release(fv[0]);
    east_value_release(fv[1]);
    east_value_release(op);
    east_value_release(entry);
}

/* Mirrors the TypeScript reference (diff.ts): between two matches, the
 * i-th deleted element is paired with the i-th inserted one as a single
 * `update` carrying the inner diff — the running length is unchanged by a
 * pair, so the delete/insert counts stay frozen across it — and only the
 * excess deletes and inserts are emitted as such. (This runtime used to emit
 * every delete and insert separately: the same values after apply, but a
 * different patch value from TypeScript's; #774.) The matches are
 * align_arrays': the walk covers the middle alone, and starting at the common
 * start with no delete or insert counted is where a walk over the start would
 * be, so every key is the whole array's. */
static EastValue *diff_array(EastValue *before, EastValue *after, EastType *type)
{
    /* The very same array is unchanged. Any other two are aligned, and the
     * alignment's trim finds two equal arrays unchanged in one pass. */
    if (before == after) return mk_unchanged();

    EastType *elem_type = type->data.element;
    size_t na = before->data.array.len;
    size_t nb = after->data.array.len;
    EastValue **a = before->data.array.items;
    EastValue **b = after->data.array.items;

    ArrayAlignment al;
    if (!align_arrays(a, na, b, nb, &al)) return NULL;
    size_t end_a = na - al.end;
    size_t end_b = nb - al.end;

    /* Build operations array */
    EastValue *ops = east_array_new(NULL);
    size_t ai = al.start, bi = al.start;
    int64_t delete_count = 0, insert_count = 0;

    for (size_t li = 0; li <= al.count; li++) {
        size_t match_a = (li < al.count) ? al.before_idx[li] : end_a;
        size_t match_b = (li < al.count) ? al.after_idx[li] : end_b;

        /* Paired delete + insert before this match → one update in place */
        size_t n_del = match_a - ai;
        size_t n_ins = match_b - bi;
        size_t pairs = n_del < n_ins ? n_del : n_ins;
        for (size_t i = 0; i < pairs; i++) {
            int64_t key = (int64_t)(ai + i) - delete_count + insert_count;
            EastValue *inner = do_diff(a[ai + i], b[bi + i], elem_type);
            if (!inner) {
                /* A nested diff failed — propagate */
                east_value_release(ops);
                free(al.before_idx);
                free(al.after_idx);
                return NULL;
            }
            EastValue *op = east_variant_new("update", inner, NULL);
            east_value_release(inner);
            push_array_op(ops, key, op);
        }
        ai += pairs;
        bi += pairs;

        /* Excess deletes before this match */
        while (ai < match_a) {
            int64_t key = (int64_t)ai - delete_count + insert_count;
            EastValue *del_val = a[ai];
            east_value_retain(del_val);
            EastValue *op = east_variant_new("delete", del_val, NULL);
            east_value_release(del_val);
            push_array_op(ops, key, op);
            delete_count++;
            ai++;
        }

        /* Excess inserts before this match */
        while (bi < match_b) {
            int64_t key = (int64_t)bi;
            EastValue *ins_val = b[bi];
            east_value_retain(ins_val);
            EastValue *op = east_variant_new("insert", ins_val, NULL);
            east_value_release(ins_val);
            push_array_op(ops, key, op);
            insert_count++;
            bi++;
        }

        /* Skip the matching element */
        if (li < al.count) {
            ai++;
            bi++;
        }
    }

    free(al.before_idx);
    free(al.after_idx);

    if (east_array_len(ops) == 0) {
        east_value_release(ops);
        return mk_unchanged();
    }

    return mk_patch_v(ops);
}

/* ================================================================== */
/*  DIFF: Set                                                          */
/* ================================================================== */

static EastValue *diff_set(EastValue *before, EastValue *after, EastType *type)
{
    if (east_value_equal(before, after)) return mk_unchanged();

    EastType *elem_type = type->data.element;

    /* Build dict of operations: key -> Variant{delete: Null, insert: Null} */
    EastValue *ops = east_dict_new(elem_type, NULL);
    size_t del_count = 0, ins_count = 0;

    /* Deletions: elements in before but not in after */
    for (size_t i = 0; i < before->data.set.len; i++) {
        EastValue *elem = east_set_at(before, i);
        if (!east_set_has(after, elem)) {
            EastValue *op = east_variant_new("delete", east_null(), NULL);
            east_dict_set(ops, elem, op);
            east_value_release(op);
            del_count++;
        }
    }

    /* Insertions: elements in after but not in before */
    for (size_t i = 0; i < after->data.set.len; i++) {
        EastValue *elem = east_set_at(after, i);
        if (!east_set_has(before, elem)) {
            EastValue *op = east_variant_new("insert", east_null(), NULL);
            east_dict_set(ops, elem, op);
            east_value_release(op);
            ins_count++;
        }
    }

    /* Everything replaced — normalize to replace. Matches the TS reference
     * (diff.ts), which requires only a non-empty before; after may be empty. */
    if (del_count == before->data.set.len && ins_count == after->data.set.len &&
        before->data.set.len > 0) {
        east_value_release(ops);
        return mk_replace(before, after);
    }

    if (east_dict_len(ops) == 0) {
        east_value_release(ops);
        return mk_unchanged();
    }

    return mk_patch_v(ops);
}

/* ================================================================== */
/*  DIFF: Dict                                                         */
/* ================================================================== */

static EastValue *diff_dict(EastValue *before, EastValue *after, EastType *type)
{
    if (east_value_equal(before, after)) return mk_unchanged();

    EastType *key_type = type->data.dict.key;
    EastType *val_type = type->data.dict.value;

    EastValue *ops = east_dict_new(key_type, NULL);
    size_t del_count = 0, ins_count = 0;

    /* Check before keys */
    for (size_t i = 0; i < before->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(before, i);
        EastValue *bval = east_dict_val_at(before, i);
        EastValue *aval = east_dict_get(after, key);
        if (!aval) {
            /* Deleted */
            EastValue *op = east_variant_new("delete", bval, NULL);
            east_dict_set(ops, key, op);
            east_value_release(op);
            del_count++;
        } else if (!east_value_equal(bval, aval)) {
            /* Updated */
            EastValue *vpatch = do_diff(bval, aval, val_type);
            if (!vpatch) {
                /* The value's diff failed — propagate */
                east_value_release(ops);
                return NULL;
            }
            EastValue *op = east_variant_new("update", vpatch, NULL);
            east_dict_set(ops, key, op);
            east_value_release(op);
            east_value_release(vpatch);
        }
    }

    /* Check after keys for insertions */
    for (size_t i = 0; i < after->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(after, i);
        if (!east_dict_has(before, key)) {
            EastValue *aval = east_dict_val_at(after, i);
            EastValue *op = east_variant_new("insert", aval, NULL);
            east_dict_set(ops, key, op);
            east_value_release(op);
            ins_count++;
        }
    }

    /* Everything replaced — normalize to replace. Matches the TS reference
     * (diff.ts), which requires only a non-empty before; after may be empty.
     * When every before-key is deleted there can be no updates, so ops holds
     * exactly the deletes + inserts. */
    if (del_count == before->data.dict.len && ins_count == after->data.dict.len &&
        before->data.dict.len > 0) {
        east_value_release(ops);
        return mk_replace(before, after);
    }

    if (east_dict_len(ops) == 0) {
        east_value_release(ops);
        return mk_unchanged();
    }

    return mk_patch_v(ops);
}

/* ================================================================== */
/*  DIFF: Struct                                                       */
/* ================================================================== */

static EastValue *diff_struct(EastValue *before, EastValue *after, EastType *type)
{
    if (east_value_equal(before, after)) return mk_unchanged();

    size_t nf = type->data.struct_.num_fields;
    const char **names = malloc(nf * sizeof(char *));
    EastValue **patches = malloc(nf * sizeof(EastValue *));
    bool all_unchanged = true;

    for (size_t i = 0; i < nf; i++) {
        names[i] = type->data.struct_.fields[i].name;
        EastType *ft = type->data.struct_.fields[i].type;
        EastValue *bval = before->data.struct_.field_values[i];
        EastValue *aval = after->data.struct_.field_values[i];
        patches[i] = do_diff(bval, aval, ft);
        if (!patches[i]) {
            /* A field's diff failed — propagate */
            for (size_t j = 0; j < i; j++)
                east_value_release(patches[j]);
            free(names);
            free(patches);
            return NULL;
        }
        if (!is_tag(patches[i], "unchanged")) all_unchanged = false;
    }

    if (all_unchanged) {
        for (size_t i = 0; i < nf; i++)
            east_value_release(patches[i]);
        free(names);
        free(patches);
        return mk_unchanged();
    }

    EastValue *s = east_struct_new(names, patches, nf, NULL);
    for (size_t i = 0; i < nf; i++)
        east_value_release(patches[i]);
    free(names);
    free(patches);
    return mk_patch_v(s);
}

/* ================================================================== */
/*  DIFF: Variant                                                      */
/* ================================================================== */

static EastValue *diff_variant(EastValue *before, EastValue *after, EastType *type)
{
    if (east_value_equal(before, after)) return mk_unchanged();

    const char *btag = east_variant_case_name(before);
    const char *atag = east_variant_case_name(after);

    if (strcmp(btag, atag) != 0) return mk_replace(before, after);

    /* Same case — find the case type and diff values */
    EastType *case_type = NULL;
    for (size_t i = 0; i < type->data.variant.num_cases; i++) {
        if (strcmp(type->data.variant.cases[i].name, btag) == 0) {
            case_type = type->data.variant.cases[i].type;
            break;
        }
    }

    EastValue *vp = do_diff(before->data.variant.value, after->data.variant.value, case_type);
    if (!vp) return NULL; /* the case's diff failed — propagate */
    if (is_tag(vp, "unchanged")) {
        east_value_release(vp);
        return mk_unchanged();
    }

    EastValue *inner = east_variant_new(btag, vp, NULL);
    east_value_release(vp);
    return mk_patch_v(inner);
}

/* ================================================================== */
/*  DIFF: Ref                                                          */
/* ================================================================== */

static EastValue *diff_ref(EastValue *before, EastValue *after, EastType *type)
{
    if (before == after) return mk_unchanged();
    EastValue *bv = before->data.ref.value;
    EastValue *av = after->data.ref.value;
    if (east_value_equal(bv, av)) return mk_unchanged();

    EastType *inner_type = type->data.element;
    EastValue *p = do_diff(bv, av, inner_type);
    if (!p) return NULL; /* the referenced value's diff failed — propagate */
    if (is_tag(p, "unchanged")) {
        east_value_release(p);
        return mk_unchanged();
    }
    return mk_patch_v(p);
}

/* ================================================================== */
/*  DIFF: Main dispatch                                                */
/* ================================================================== */

static EastValue *do_diff(EastValue *before, EastValue *after, EastType *type)
{
    bool replace_only;
    EastType *rt = resolve_type(type, &replace_only);

    if (replace_only || !rt) {
        EastValue *result =
            east_value_equal(before, after) ? mk_unchanged() : mk_replace(before, after);
        return result;
    }

    EastValue *result;
    switch (rt->kind) {
    case EAST_TYPE_ARRAY:
        result = diff_array(before, after, rt);
        break;
    case EAST_TYPE_SET:
        result = diff_set(before, after, rt);
        break;
    case EAST_TYPE_DICT:
        result = diff_dict(before, after, rt);
        break;
    case EAST_TYPE_STRUCT:
        result = diff_struct(before, after, rt);
        break;
    case EAST_TYPE_VARIANT:
        result = diff_variant(before, after, rt);
        break;
    case EAST_TYPE_REF:
        result = diff_ref(before, after, rt);
        break;
    default:
        /* Primitives, functions, vectors, matrices — replace only */
        result = east_value_equal(before, after) ? mk_unchanged() : mk_replace(before, after);
        break;
    }

    return result;
}

/* ================================================================== */
/*  APPLY: Array                                                       */
/* ================================================================== */

static EastValue *apply_array(EastValue *base, EastValue *patch_val, EastType *type)
{
    /* patch_val is an array of {key, offset, operation} structs */
    EastType *elem_type = type->data.element;

    /* Deep copy base into a mutable array */
    EastValue *result = east_array_new(base->data.array.elem_type);
    for (size_t i = 0; i < base->data.array.len; i++)
        east_array_push(result, base->data.array.items[i]);

    /* A delete or update addresses the element at key + offset; an insert
     * lands at key. Every operation is checked against the array as it stands
     * at that point, as the reference does. */
    size_t nops = patch_val->data.array.len;
    for (size_t i = 0; i < nops; i++) {
        EastValue *entry = patch_val->data.array.items[i];
        EastValue *key_v = east_struct_get_field(entry, "key");
        EastValue *offset_v = east_struct_get_field(entry, "offset");
        EastValue *op = east_struct_get_field(entry, "operation");
        int64_t key = key_v->data.integer;
        int64_t offset = offset_v ? offset_v->data.integer : 0;
        int64_t pos = key + offset;
        int64_t len = (int64_t)result->data.array.len;

        const char *op_tag = east_variant_case_name(op);
        if (strcmp(op_tag, "delete") == 0) {
            if (pos < 0 || pos >= len) {
                east_value_release(result);
                return apply_conflict("Cannot delete at index %lld - array length is %lld",
                                      (long long)pos, (long long)len);
            }
            EastValue *held = result->data.array.items[pos];
            if (!east_value_equal(held, op->data.variant.value)) {
                char *expected = printed(op->data.variant.value, elem_type);
                char *found = printed(held, elem_type);
                apply_conflict("Cannot delete at index %lld - expected %s, found %s",
                               (long long)pos, expected, found);
                free(expected);
                free(found);
                east_value_release(result);
                return NULL;
            }
            east_value_release(held);
            memmove(&result->data.array.items[pos], &result->data.array.items[pos + 1],
                    (result->data.array.len - pos - 1) * sizeof(EastValue *));
            result->data.array.len--;
        } else if (strcmp(op_tag, "insert") == 0) {
            if (key < 0 || key > len) {
                east_value_release(result);
                return apply_conflict("Cannot insert at index %lld - array length is %lld",
                                      (long long)key, (long long)len);
            }
            EastValue *val = op->data.variant.value;
            if (result->data.array.len >= result->data.array.cap) {
                size_t new_cap = result->data.array.cap ? result->data.array.cap * 2 : 4;
                result->data.array.items =
                    realloc(result->data.array.items, new_cap * sizeof(EastValue *));
                result->data.array.cap = new_cap;
            }
            size_t p = (size_t)key;
            memmove(&result->data.array.items[p + 1], &result->data.array.items[p],
                    (result->data.array.len - p) * sizeof(EastValue *));
            result->data.array.items[p] = val;
            east_value_retain(val);
            result->data.array.len++;
        } else if (strcmp(op_tag, "update") == 0) {
            if (pos < 0 || pos >= len) {
                east_value_release(result);
                return apply_conflict("Cannot update at index %lld - array length is %lld",
                                      (long long)pos, (long long)len);
            }
            EastValue *old = result->data.array.items[pos];
            EastValue *updated = do_apply(old, op->data.variant.value, elem_type);
            if (!updated) {
                east_value_release(result);
                return NULL;
            }
            east_value_release(old);
            result->data.array.items[pos] = updated;
        }
    }
    return result;
}

/* ================================================================== */
/*  APPLY: Set                                                         */
/* ================================================================== */

static EastValue *apply_set(EastValue *base, EastValue *patch_val, EastType *type)
{
    /* patch_val is a dict: key -> Variant{delete, insert} */
    EastValue *result = east_set_new(base->data.set.elem_type);

    /* Copy existing elements */
    for (size_t i = 0; i < base->data.set.len; i++)
        east_set_insert(result, east_set_at(base, i));

    /* Apply operations: a delete names an element the set holds, an insert
     * one it does not. */
    EastType *elem_type = type->data.element;
    for (size_t i = 0; i < patch_val->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(patch_val, i);
        EastValue *op = east_dict_val_at(patch_val, i);
        const char *tag = east_variant_case_name(op);
        if (strcmp(tag, "delete") == 0) {
            if (!east_set_has(result, key)) {
                char *shown = printed(key, elem_type);
                apply_conflict("Cannot delete key %s - key does not exist", shown);
                free(shown);
                east_value_release(result);
                return NULL;
            }
            east_set_delete(result, key);
        } else if (strcmp(tag, "insert") == 0) {
            if (east_set_has(result, key)) {
                char *shown = printed(key, elem_type);
                apply_conflict("Cannot insert key %s - key already exists", shown);
                free(shown);
                east_value_release(result);
                return NULL;
            }
            east_set_insert(result, key);
        }
    }
    return result;
}

/* ================================================================== */
/*  APPLY: Dict                                                        */
/* ================================================================== */

static EastValue *apply_dict(EastValue *base, EastValue *patch_val, EastType *type)
{
    EastType *key_type = type->data.dict.key;
    EastType *val_type = type->data.dict.value;

    /* Deep copy base */
    EastValue *result = east_dict_new(base->data.dict.key_type, base->data.dict.val_type);
    for (size_t i = 0; i < base->data.dict.len; i++)
        east_dict_set(result, east_dict_key_at(base, i), east_dict_val_at(base, i));

    /* Apply operations: a delete names a key the dict holds with exactly the
     * value it holds, an insert a key it does not hold, an update a key it
     * does. */
    for (size_t i = 0; i < patch_val->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(patch_val, i);
        EastValue *op = east_dict_val_at(patch_val, i);
        const char *tag = east_variant_case_name(op);
        EastValue *held = east_dict_get(result, key);

        if (strcmp(tag, "delete") == 0) {
            if (!held) {
                char *shown = printed(key, key_type);
                apply_conflict("Cannot delete key %s - key does not exist", shown);
                free(shown);
                east_value_release(result);
                return NULL;
            }
            if (!east_value_equal(held, op->data.variant.value)) {
                char *shown = printed(key, key_type);
                char *expected = printed(op->data.variant.value, val_type);
                char *found = printed(held, val_type);
                apply_conflict("Cannot delete key %s - expected value %s, found %s", shown,
                               expected, found);
                free(shown);
                free(expected);
                free(found);
                east_value_release(result);
                return NULL;
            }
            east_dict_delete(result, key);
        } else if (strcmp(tag, "insert") == 0) {
            if (held) {
                char *shown = printed(key, key_type);
                char *found = printed(held, val_type);
                apply_conflict("Cannot insert key %s - key already exists with value %s", shown,
                               found);
                free(shown);
                free(found);
                east_value_release(result);
                return NULL;
            }
            east_dict_set(result, key, op->data.variant.value);
        } else if (strcmp(tag, "update") == 0) {
            if (!held) {
                char *shown = printed(key, key_type);
                apply_conflict("Cannot update key %s - key does not exist", shown);
                free(shown);
                east_value_release(result);
                return NULL;
            }
            EastValue *updated = do_apply(held, op->data.variant.value, val_type);
            if (!updated) {
                east_value_release(result);
                return NULL;
            }
            east_dict_set(result, key, updated);
            east_value_release(updated);
        }
    }
    return result;
}

/* ================================================================== */
/*  APPLY: Struct                                                      */
/* ================================================================== */

static EastValue *apply_struct(EastValue *base, EastValue *patch_val, EastType *type)
{
    size_t nf = type->data.struct_.num_fields;
    const char **names = malloc(nf * sizeof(char *));
    EastValue **vals = malloc(nf * sizeof(EastValue *));

    for (size_t i = 0; i < nf; i++) {
        names[i] = type->data.struct_.fields[i].name;
        EastType *ft = type->data.struct_.fields[i].type;
        EastValue *bval = base->data.struct_.field_values[i];
        EastValue *fp = east_struct_get_field(patch_val, names[i]);
        vals[i] = do_apply(bval, fp, ft);
        if (!vals[i]) {
            /* A field's patch conflicted — propagate */
            for (size_t j = 0; j < i; j++)
                east_value_release(vals[j]);
            free(names);
            free(vals);
            return NULL;
        }
    }

    EastValue *result = east_struct_new(names, vals, nf, NULL);
    for (size_t i = 0; i < nf; i++)
        east_value_release(vals[i]);
    free(names);
    free(vals);
    return result;
}

/* ================================================================== */
/*  APPLY: Variant                                                     */
/* ================================================================== */

static EastValue *apply_variant(EastValue *base, EastValue *patch_val, EastType *type)
{
    /* patch_val is a variant(caseName, casePatch), and patches the value of
     * that case only */
    const char *case_name = east_variant_case_name(patch_val);
    EastValue *case_patch = patch_val->data.variant.value;
    const char *base_case = east_variant_case_name(base);
    if (strcmp(case_name, base_case) != 0)
        return apply_conflict("Cannot apply patch for case %s to variant with case %s", case_name,
                              base_case);

    /* Find case type */
    EastType *case_type = NULL;
    for (size_t i = 0; i < type->data.variant.num_cases; i++) {
        if (strcmp(type->data.variant.cases[i].name, case_name) == 0) {
            case_type = type->data.variant.cases[i].type;
            break;
        }
    }

    EastValue *new_val = do_apply(base->data.variant.value, case_patch, case_type);
    if (!new_val) return NULL;
    EastValue *result = east_variant_new(case_name, new_val, NULL);
    east_value_release(new_val);
    return result;
}

/* ================================================================== */
/*  APPLY: Ref                                                         */
/* ================================================================== */

static EastValue *apply_ref(EastValue *base, EastValue *patch_val, EastType *type)
{
    EastType *inner_type = type->data.element;
    EastValue *old = base->data.ref.value;
    EastValue *updated = do_apply(old, patch_val, inner_type);
    if (!updated) return NULL;
    EastValue *result = east_ref_new(updated);
    east_value_release(updated);
    return result;
}

/* ================================================================== */
/*  APPLY: Main dispatch                                               */
/* ================================================================== */

static EastValue *do_apply(EastValue *base, EastValue *patch, EastType *type)
{
    if (!patch || !base) {
        east_value_retain(base);
        return base;
    }

    if (is_tag(patch, "unchanged")) {
        east_value_retain(base);
        return base;
    }

    if (is_tag(patch, "replace")) {
        /* A replace names the value it replaces; applied to any other it is a
         * conflict, not a write. */
        if (replace_verifies(type) && !east_value_equal(base, replace_before(patch)))
            return replace_conflict(base, replace_before(patch), type);
        EastValue *after = replace_after(patch);
        east_value_retain(after);
        return after;
    }

    if (!is_tag(patch, "patch")) {
        east_value_retain(base);
        return base;
    }

    EastValue *patch_val = patch_payload(patch);
    bool replace_only;
    EastType *rt = resolve_type(type, &replace_only);

    /* Every apply below returns NULL on a conflict, with the error set. */
    EastValue *result;
    if (replace_only || !rt) {
        east_value_retain(base);
        result = base;
    } else {
        switch (rt->kind) {
        case EAST_TYPE_ARRAY:
            result = apply_array(base, patch_val, rt);
            break;
        case EAST_TYPE_SET:
            result = apply_set(base, patch_val, rt);
            break;
        case EAST_TYPE_DICT:
            result = apply_dict(base, patch_val, rt);
            break;
        case EAST_TYPE_STRUCT:
            result = apply_struct(base, patch_val, rt);
            break;
        case EAST_TYPE_VARIANT:
            result = apply_variant(base, patch_val, rt);
            break;
        case EAST_TYPE_REF:
            result = apply_ref(base, patch_val, rt);
            break;
        default:
            east_value_retain(base);
            result = base;
            break;
        }
    }

    return result;
}

/* ================================================================== */
/*  COMPOSE helpers                                                    */
/* ================================================================== */

static EastValue *compose_struct(EastValue *first, EastValue *second, EastType *type)
{
    size_t nf = type->data.struct_.num_fields;
    const char **names = malloc(nf * sizeof(char *));
    EastValue **vals = malloc(nf * sizeof(EastValue *));
    bool all_unchanged = true;

    for (size_t i = 0; i < nf; i++) {
        names[i] = type->data.struct_.fields[i].name;
        EastType *ft = type->data.struct_.fields[i].type;
        EastValue *fp1 = east_struct_get_field(first, names[i]);
        EastValue *fp2 = east_struct_get_field(second, names[i]);
        vals[i] = do_compose(fp1, fp2, ft);
        if (!vals[i]) {
            /* Conflict in a field compose — propagate */
            for (size_t j = 0; j < i; j++)
                east_value_release(vals[j]);
            free(names);
            free(vals);
            return NULL;
        }
        if (!is_tag(vals[i], "unchanged")) all_unchanged = false;
    }

    if (all_unchanged) {
        for (size_t i = 0; i < nf; i++)
            east_value_release(vals[i]);
        free(names);
        free(vals);
        return mk_unchanged();
    }

    EastValue *s = east_struct_new(names, vals, nf, NULL);
    for (size_t i = 0; i < nf; i++)
        east_value_release(vals[i]);
    free(names);
    free(vals);
    return mk_patch_v(s);
}

static EastValue *compose_variant(EastValue *first, EastValue *second, EastType *type)
{
    const char *c1 = east_variant_case_name(first);
    const char *c2 = east_variant_case_name(second);
    if (strcmp(c1, c2) != 0) {
        /* Different cases — can't compose structurally */
        east_builtin_error("Cannot compose patches for different variant cases");
        return NULL;
    }

    EastType *case_type = NULL;
    for (size_t i = 0; i < type->data.variant.num_cases; i++) {
        if (strcmp(type->data.variant.cases[i].name, c1) == 0) {
            case_type = type->data.variant.cases[i].type;
            break;
        }
    }

    EastValue *composed =
        do_compose(first->data.variant.value, second->data.variant.value, case_type);
    if (!composed) return NULL;
    if (is_tag(composed, "unchanged")) {
        east_value_release(composed);
        return mk_unchanged();
    }

    EastValue *inner = east_variant_new(c1, composed, NULL);
    east_value_release(composed);
    return mk_patch_v(inner);
}

static EastValue *compose_ref(EastValue *first, EastValue *second, EastType *type)
{
    EastType *inner_type = type->data.element;
    EastValue *composed = do_compose(first, second, inner_type);
    if (!composed) return NULL;
    if (is_tag(composed, "unchanged")) {
        east_value_release(composed);
        return mk_unchanged();
    }
    return mk_patch_v(composed);
}

static EastValue *compose_set(EastValue *first, EastValue *second, EastType *type)
{
    /* Merge operations by key */
    EastType *elem_type = type->data.element;
    EastValue *result = east_dict_new(elem_type, NULL);

    /* Add all from first */
    for (size_t i = 0; i < first->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(first, i);
        EastValue *op1 = east_dict_val_at(first, i);
        EastValue *op2 = east_dict_get(second, key);
        if (op2) {
            const char *t1 = east_variant_case_name(op1);
            const char *t2 = east_variant_case_name(op2);
            if ((strcmp(t1, "insert") == 0 && strcmp(t2, "delete") == 0) ||
                (strcmp(t1, "delete") == 0 && strcmp(t2, "insert") == 0)) {
                /* Cancel out — don't add to result */
            } else {
                /* Same-key op pair with no coherent composition (matches the
                 * TS reference, which conflicts rather than guessing). */
                east_builtin_error("Cannot compose patches - conflicting operations on key");
                east_value_release(result);
                return NULL;
            }
        } else {
            east_dict_set(result, key, op1);
        }
    }

    /* Add from second that aren't in first */
    for (size_t i = 0; i < second->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(second, i);
        if (!east_dict_has(first, key)) east_dict_set(result, key, east_dict_val_at(second, i));
    }

    if (east_dict_len(result) == 0) {
        east_value_release(result);
        return mk_unchanged();
    }
    return mk_patch_v(result);
}

static EastValue *compose_dict(EastValue *first, EastValue *second, EastType *type)
{
    EastType *key_type = type->data.dict.key;
    EastType *val_type = type->data.dict.value;
    EastValue *result = east_dict_new(key_type, NULL);

    /* Process first dict */
    for (size_t i = 0; i < first->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(first, i);
        EastValue *op1 = east_dict_val_at(first, i);
        EastValue *op2 = east_dict_get(second, key);
        if (!op2) {
            east_dict_set(result, key, op1);
            continue;
        }

        const char *t1 = east_variant_case_name(op1);
        const char *t2 = east_variant_case_name(op2);

        if (strcmp(t1, "insert") == 0 && strcmp(t2, "delete") == 0) {
            /* Cancel out — don't add */
        } else if (strcmp(t1, "insert") == 0 && strcmp(t2, "update") == 0) {
            /* Apply update to inserted value */
            EastValue *new_val =
                do_apply(op1->data.variant.value, op2->data.variant.value, val_type);
            if (!new_val) {
                east_value_release(result);
                return NULL;
            }
            EastValue *new_op = east_variant_new("insert", new_val, NULL);
            east_dict_set(result, key, new_op);
            east_value_release(new_op);
            east_value_release(new_val);
        } else if (strcmp(t1, "delete") == 0 && strcmp(t2, "insert") == 0) {
            /* Delete then insert = update(replace(old, new)) */
            EastValue *rp = mk_replace(op1->data.variant.value, op2->data.variant.value);
            EastValue *new_op = east_variant_new("update", rp, NULL);
            east_dict_set(result, key, new_op);
            east_value_release(new_op);
            east_value_release(rp);
        } else if (strcmp(t1, "update") == 0 && strcmp(t2, "delete") == 0) {
            /* Update then delete: op2 carries the post-update value; undo the
             * update on it so the composed delete records the original value
             * (compose(diff(v1,v2), diff(v2,v3)) == diff(v1,v3)). */
            EastValue *inv = do_invert(op1->data.variant.value, val_type);
            if (!inv) {
                east_value_release(result);
                return NULL;
            }
            EastValue *orig = do_apply(op2->data.variant.value, inv, val_type);
            east_value_release(inv);
            if (!orig) {
                east_value_release(result);
                return NULL;
            }
            EastValue *new_op = east_variant_new("delete", orig, NULL);
            east_dict_set(result, key, new_op);
            east_value_release(new_op);
            east_value_release(orig);
        } else if (strcmp(t1, "update") == 0 && strcmp(t2, "update") == 0) {
            /* Compose the updates */
            EastValue *composed =
                do_compose(op1->data.variant.value, op2->data.variant.value, val_type);
            if (!composed) {
                east_value_release(result);
                return NULL;
            }
            EastValue *new_op = east_variant_new("update", composed, NULL);
            east_dict_set(result, key, new_op);
            east_value_release(new_op);
            east_value_release(composed);
        } else {
            /* Same-key op pair with no coherent composition (matches the
             * TS reference, which conflicts rather than guessing). */
            east_builtin_error("Cannot compose patches - conflicting operations on key");
            east_value_release(result);
            return NULL;
        }
    }

    /* Add from second that aren't in first */
    for (size_t i = 0; i < second->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(second, i);
        if (!east_dict_has(first, key)) east_dict_set(result, key, east_dict_val_at(second, i));
    }

    if (east_dict_len(result) == 0) {
        east_value_release(result);
        return mk_unchanged();
    }
    return mk_patch_v(result);
}

static EastValue *compose_array(EastValue *first, EastValue *second, EastType *type)
{
    /* Concatenate operations */
    EastValue *result = east_array_new(NULL);
    for (size_t i = 0; i < first->data.array.len; i++)
        east_array_push(result, first->data.array.items[i]);
    for (size_t i = 0; i < second->data.array.len; i++)
        east_array_push(result, second->data.array.items[i]);

    if (east_array_len(result) == 0) {
        east_value_release(result);
        return mk_unchanged();
    }
    return mk_patch_v(result);
}

/* ================================================================== */
/*  COMPOSE: Main dispatch                                             */
/* ================================================================== */

static EastValue *do_compose(EastValue *first, EastValue *second, EastType *type)
{
    if (!first || !second) return mk_unchanged();

    /* unchanged + X = X, X + unchanged = X */
    if (is_tag(first, "unchanged")) {
        east_value_retain(second);
        return second;
    }
    if (is_tag(second, "unchanged")) {
        east_value_retain(first);
        return first;
    }

    /* replace + replace = replace(first.before, second.after) */
    if (is_tag(first, "replace") && is_tag(second, "replace")) {
        return mk_replace(replace_before(first), replace_after(second));
    }

    /* replace + patch = replace(first.before, apply(first.after, second)) */
    if (is_tag(first, "replace") && is_tag(second, "patch")) {
        EastValue *applied = do_apply(replace_after(first), second, type);
        if (!applied) return NULL;
        EastValue *result = mk_replace(replace_before(first), applied);
        east_value_release(applied);
        return result;
    }

    /* patch + replace = replace(apply_inverse(second.before), second.after)
     * Simplified: just compute replace(invert_apply(first, second.before), second.after)
     * Actually: we invert first, apply to second.before to get original before */
    if (is_tag(first, "patch") && is_tag(second, "replace")) {
        EastValue *inv = do_invert(first, type);
        if (!inv) return NULL;
        EastValue *original = do_apply(replace_before(second), inv, type);
        east_value_release(inv);
        if (!original) return NULL;
        EastValue *result = mk_replace(original, replace_after(second));
        east_value_release(original);
        return result;
    }

    /* patch + patch: type-specific compose */
    if (is_tag(first, "patch") && is_tag(second, "patch")) {
        bool replace_only;
        EastType *rt = resolve_type(type, &replace_only);
        EastValue *result;

        if (replace_only || !rt) {
            result = mk_unchanged();
        } else {
            EastValue *p1 = patch_payload(first);
            EastValue *p2 = patch_payload(second);
            switch (rt->kind) {
            case EAST_TYPE_ARRAY:
                result = compose_array(p1, p2, rt);
                break;
            case EAST_TYPE_SET:
                result = compose_set(p1, p2, rt);
                break;
            case EAST_TYPE_DICT:
                result = compose_dict(p1, p2, rt);
                break;
            case EAST_TYPE_STRUCT:
                result = compose_struct(p1, p2, rt);
                break;
            case EAST_TYPE_VARIANT:
                result = compose_variant(p1, p2, rt);
                break;
            case EAST_TYPE_REF:
                result = compose_ref(p1, p2, rt);
                break;
            default:
                result = mk_unchanged();
                break;
            }
        }
        return result;
    }

    return mk_unchanged();
}

/* ================================================================== */
/*  INVERT helpers                                                     */
/* ================================================================== */

static EastValue *invert_array(EastValue *patch_val, EastType *type)
{
    EastType *elem_type = type->data.element;
    size_t n = patch_val->data.array.len;
    EastValue *result = east_array_new(NULL);

    /* Reverse order and invert each operation */
    for (size_t i = n; i > 0; i--) {
        EastValue *entry = patch_val->data.array.items[i - 1];
        EastValue *key_v = east_struct_get_field(entry, "key");
        EastValue *offset_v = east_struct_get_field(entry, "offset");
        EastValue *op = east_struct_get_field(entry, "operation");
        const char *tag = east_variant_case_name(op);

        EastValue *new_op;
        if (strcmp(tag, "delete") == 0) {
            new_op = east_variant_new("insert", op->data.variant.value, NULL);
        } else if (strcmp(tag, "insert") == 0) {
            new_op = east_variant_new("delete", op->data.variant.value, NULL);
        } else if (strcmp(tag, "update") == 0) {
            EastValue *inv = do_invert(op->data.variant.value, elem_type);
            new_op = east_variant_new("update", inv, NULL);
            east_value_release(inv);
        } else {
            new_op = east_variant_new(tag, op->data.variant.value, NULL);
        }

        const char *fn[] = {"key", "offset", "operation"};
        EastValue *fv[] = {key_v, offset_v, new_op};
        EastValue *new_entry = east_struct_new(fn, fv, 3, NULL);
        east_array_push(result, new_entry);
        east_value_release(new_op);
        east_value_release(new_entry);
    }
    return mk_patch_v(result);
}

static EastValue *invert_set(EastValue *patch_val, EastType *type)
{
    EastType *elem_type = type->data.element;
    EastValue *result = east_dict_new(elem_type, NULL);

    for (size_t i = 0; i < patch_val->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(patch_val, i);
        EastValue *op = east_dict_val_at(patch_val, i);
        const char *tag = east_variant_case_name(op);
        EastValue *new_op;
        if (strcmp(tag, "delete") == 0) {
            new_op = east_variant_new("insert", east_null(), NULL);
        } else if (strcmp(tag, "insert") == 0) {
            new_op = east_variant_new("delete", east_null(), NULL);
        } else {
            new_op = east_variant_new(tag, op->data.variant.value, NULL);
        }
        east_dict_set(result, key, new_op);
        east_value_release(new_op);
    }

    if (east_dict_len(result) == 0) {
        east_value_release(result);
        return mk_unchanged();
    }
    return mk_patch_v(result);
}

static EastValue *invert_dict(EastValue *patch_val, EastType *type)
{
    EastType *key_type = type->data.dict.key;
    EastType *val_type = type->data.dict.value;
    EastValue *result = east_dict_new(key_type, NULL);

    for (size_t i = 0; i < patch_val->data.dict.len; i++) {
        EastValue *key = east_dict_key_at(patch_val, i);
        EastValue *op = east_dict_val_at(patch_val, i);
        const char *tag = east_variant_case_name(op);
        EastValue *new_op;
        if (strcmp(tag, "delete") == 0) {
            new_op = east_variant_new("insert", op->data.variant.value, NULL);
        } else if (strcmp(tag, "insert") == 0) {
            new_op = east_variant_new("delete", op->data.variant.value, NULL);
        } else if (strcmp(tag, "update") == 0) {
            EastValue *inv = do_invert(op->data.variant.value, val_type);
            new_op = east_variant_new("update", inv, NULL);
            east_value_release(inv);
        } else {
            new_op = east_variant_new(tag, op->data.variant.value, NULL);
        }
        east_dict_set(result, key, new_op);
        east_value_release(new_op);
    }

    if (east_dict_len(result) == 0) {
        east_value_release(result);
        return mk_unchanged();
    }
    return mk_patch_v(result);
}

static EastValue *invert_struct(EastValue *patch_val, EastType *type)
{
    size_t nf = type->data.struct_.num_fields;
    const char **names = malloc(nf * sizeof(char *));
    EastValue **vals = malloc(nf * sizeof(EastValue *));
    bool all_unchanged = true;

    for (size_t i = 0; i < nf; i++) {
        names[i] = type->data.struct_.fields[i].name;
        EastType *ft = type->data.struct_.fields[i].type;
        EastValue *fp = east_struct_get_field(patch_val, names[i]);
        vals[i] = do_invert(fp, ft);
        if (!is_tag(vals[i], "unchanged")) all_unchanged = false;
    }

    if (all_unchanged) {
        for (size_t i = 0; i < nf; i++)
            east_value_release(vals[i]);
        free(names);
        free(vals);
        return mk_unchanged();
    }

    EastValue *s = east_struct_new(names, vals, nf, NULL);
    for (size_t i = 0; i < nf; i++)
        east_value_release(vals[i]);
    free(names);
    free(vals);
    return mk_patch_v(s);
}

static EastValue *invert_variant(EastValue *patch_val, EastType *type)
{
    const char *case_name = east_variant_case_name(patch_val);
    EastType *case_type = NULL;
    for (size_t i = 0; i < type->data.variant.num_cases; i++) {
        if (strcmp(type->data.variant.cases[i].name, case_name) == 0) {
            case_type = type->data.variant.cases[i].type;
            break;
        }
    }

    EastValue *inv = do_invert(patch_val->data.variant.value, case_type);
    if (is_tag(inv, "unchanged")) {
        east_value_release(inv);
        return mk_unchanged();
    }

    EastValue *inner = east_variant_new(case_name, inv, NULL);
    east_value_release(inv);
    return mk_patch_v(inner);
}

static EastValue *invert_ref(EastValue *patch_val, EastType *type)
{
    EastType *inner_type = type->data.element;
    EastValue *inv = do_invert(patch_val, inner_type);
    if (is_tag(inv, "unchanged")) {
        east_value_release(inv);
        return mk_unchanged();
    }
    return mk_patch_v(inv);
}

/* ================================================================== */
/*  INVERT: Main dispatch                                              */
/* ================================================================== */

static EastValue *do_invert(EastValue *patch, EastType *type)
{
    if (!patch) return mk_unchanged();

    if (is_tag(patch, "unchanged")) return mk_unchanged();

    if (is_tag(patch, "replace")) return mk_replace(replace_after(patch), replace_before(patch));

    if (!is_tag(patch, "patch")) return mk_unchanged();

    EastValue *patch_val = patch_payload(patch);
    bool replace_only;
    EastType *rt = resolve_type(type, &replace_only);

    EastValue *result;
    if (replace_only || !rt) {
        result = mk_unchanged();
    } else {
        switch (rt->kind) {
        case EAST_TYPE_ARRAY:
            result = invert_array(patch_val, rt);
            break;
        case EAST_TYPE_SET:
            result = invert_set(patch_val, rt);
            break;
        case EAST_TYPE_DICT:
            result = invert_dict(patch_val, rt);
            break;
        case EAST_TYPE_STRUCT:
            result = invert_struct(patch_val, rt);
            break;
        case EAST_TYPE_VARIANT:
            result = invert_variant(patch_val, rt);
            break;
        case EAST_TYPE_REF:
            result = invert_ref(patch_val, rt);
            break;
        default:
            result = mk_unchanged();
            break;
        }
    }

    return result;
}

/* ================================================================== */
/*  Top-level implementations                                          */
/* ================================================================== */

/* Stamp the concrete patch type onto the freshly-built variants of a patch
 * value, guided by `type` (the patch type for this position). The patch
 * builders construct variants by name with type==NULL; this sets case_idx +
 * embedded type so consumers (e.g. the east-py decoder) resolve cases by index.
 *
 * Originals embedded in the patch (replace's before/after, delete/insert
 * payloads) already carry their own non-NULL types — the type!=NULL gate stops
 * the walk there, so shared values are never mutated. Containers are traversed
 * only to reach nested variants; they decode from the threaded type, not an
 * embedded one. */
static void retype_patch(EastValue *v, EastType *type)
{
    if (!v || !type) return;
    while (type->kind == EAST_TYPE_RECURSIVE)
        type = type->data.recursive.node;

    switch (v->kind) {
    case EAST_VAL_VARIANT: {
        if (v->data.variant.type != NULL) return; /* original — already typed */
        if (type->kind != EAST_TYPE_VARIANT) return;
        size_t idx = east_variant_type_case_idx(type, v->data.variant.case_tag);
        if (idx == SIZE_MAX) return;
        v->data.variant.case_idx = idx;
        v->data.variant.case_tag =
            type->data.variant.cases[idx].name; /* outlives caller's literal */
        v->data.variant.type = type;
        east_type_retain(type);
        retype_patch(v->data.variant.value, type->data.variant.cases[idx].type);
        return;
    }
    case EAST_VAL_STRUCT: {
        if (type->kind != EAST_TYPE_STRUCT) return;
        for (size_t i = 0; i < v->data.struct_.num_fields; i++) {
            const char *fname = east_struct_field_name(v, i);
            EastType *ft = NULL;
            for (size_t j = 0; j < type->data.struct_.num_fields; j++) {
                if (strcmp(type->data.struct_.fields[j].name, fname) == 0) {
                    ft = type->data.struct_.fields[j].type;
                    break;
                }
            }
            retype_patch(v->data.struct_.field_values[i], ft);
        }
        return;
    }
    case EAST_VAL_DICT: {
        if (type->kind != EAST_TYPE_DICT) return;
        EastType *vt = type->data.dict.value;
        size_t len = east_dict_len(v);
        for (size_t i = 0; i < len; i++)
            retype_patch(east_dict_val_at(v, i), vt);
        return;
    }
    case EAST_VAL_ARRAY: {
        if (type->kind != EAST_TYPE_ARRAY) return;
        EastType *et = type->data.element;
        size_t len = east_array_len(v);
        for (size_t i = 0; i < len; i++)
            retype_patch(east_array_get(v, i), et);
        return;
    }
    case EAST_VAL_REF:
        if (type->kind == EAST_TYPE_REF) retype_patch(v->data.ref.value, type->data.element);
        return;
    default:
        return;
    }
}

static EastValue *patch_diff_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *result = do_diff(args[0], args[1], s_patch_type);
    if (result && s_result_patch_type) retype_patch(result, s_result_patch_type);
    return result;
}

static EastValue *patch_apply_impl(EastValue **args, size_t n)
{
    (void)n;
    return do_apply(args[0], args[1], s_patch_type);
}

static EastValue *patch_compose_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *result = do_compose(args[0], args[1], s_patch_type);
    if (result && s_result_patch_type) retype_patch(result, s_result_patch_type);
    return result;
}

static EastValue *patch_invert_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *result = do_invert(args[0], s_patch_type);
    if (result && s_result_patch_type) retype_patch(result, s_result_patch_type);
    return result;
}

/* ================================================================== */
/*  Factory functions                                                  */
/* ================================================================== */

static BuiltinImpl diff_factory(EastType **tp, size_t ntp)
{
    s_patch_type = (ntp > 0) ? tp[0] : NULL;
    s_result_patch_type = (ntp > 1) ? tp[1] : NULL;
    return patch_diff_impl;
}

static BuiltinImpl apply_patch_factory(EastType **tp, size_t ntp)
{
    s_patch_type = (ntp > 0) ? tp[0] : NULL;
    return patch_apply_impl;
}

static BuiltinImpl compose_patch_factory(EastType **tp, size_t ntp)
{
    s_patch_type = (ntp > 0) ? tp[0] : NULL;
    s_result_patch_type = (ntp > 1) ? tp[1] : NULL;
    return patch_compose_impl;
}

static BuiltinImpl invert_patch_factory(EastType **tp, size_t ntp)
{
    s_patch_type = (ntp > 0) ? tp[0] : NULL;
    s_result_patch_type = (ntp > 1) ? tp[1] : NULL;
    return patch_invert_impl;
}

/* ================================================================== */
/*  Registration                                                       */
/* ================================================================== */

void east_register_patch_builtins(BuiltinRegistry *reg)
{
    builtin_registry_register(reg, "Diff", diff_factory);
    builtin_registry_register(reg, "ApplyPatch", apply_patch_factory);
    builtin_registry_register(reg, "ComposePatch", compose_patch_factory);
    builtin_registry_register(reg, "InvertPatch", invert_patch_factory);
}
