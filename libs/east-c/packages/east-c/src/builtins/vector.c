/*
 * Vector builtin functions.
 *
 * Vectors store homogeneous numeric data (float64, int64, or bool) in
 * a contiguous buffer (data.vector.data). The element type determines
 * how we index into the buffer.
 */
#include "east/builtins.h"
#include "east/compiler.h"
#include "east/values.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Helper: call a function value                                      */
/* ------------------------------------------------------------------ */
static EastValue *call_fn(EastValue *fn, EastValue **call_args, size_t nargs)
{
    EvalResult r = east_call(fn->data.function.compiled, call_args, nargs);
    if (r.status == EVAL_OK || r.status == EVAL_RETURN) return r.value;
    /* Propagate error from callback */
    if (r.error_message) {
        east_builtin_error(r.error_message);
    }
    eval_result_free(&r);
    return NULL;
}

/* ------------------------------------------------------------------ */
/* Helpers: read/write vector elements based on elem_type              */
/* ------------------------------------------------------------------ */
static EastValue *vec_get_elem(EastValue *vec, size_t i)
{
    EastType *et = vec->data.vector.elem_type;
    void *data = vec->data.vector.data;
    if (et->kind == EAST_TYPE_FLOAT) {
        return east_float(((double *)data)[i]);
    } else if (et->kind == EAST_TYPE_INTEGER) {
        return east_integer(((int64_t *)data)[i]);
    } else if (et->kind == EAST_TYPE_BOOLEAN) {
        return east_boolean(((bool *)data)[i]);
    }
    return east_null();
}

static void vec_set_elem(EastValue *vec, size_t i, EastValue *val)
{
    EastType *et = vec->data.vector.elem_type;
    void *data = vec->data.vector.data;
    if (et->kind == EAST_TYPE_FLOAT) {
        ((double *)data)[i] = val->data.float64;
    } else if (et->kind == EAST_TYPE_INTEGER) {
        ((int64_t *)data)[i] = val->data.integer;
    } else if (et->kind == EAST_TYPE_BOOLEAN) {
        ((bool *)data)[i] = val->data.boolean;
    }
}

static size_t elem_size(EastType *et)
{
    if (et->kind == EAST_TYPE_FLOAT) return sizeof(double);
    if (et->kind == EAST_TYPE_INTEGER) return sizeof(int64_t);
    if (et->kind == EAST_TYPE_BOOLEAN) return sizeof(bool);
    return sizeof(double);
}

/* --- implementations --- */

static EastValue *vector_length_impl(EastValue **args, size_t n)
{
    (void)n;
    return east_integer((int64_t)args[0]->data.vector.len);
}

static EastValue *vector_get_impl(EastValue **args, size_t n)
{
    (void)n;
    int64_t idx = args[1]->data.integer;
    size_t len = args[0]->data.vector.len;
    if (idx < 0 || (size_t)idx >= len) {
        char msg[128];
        snprintf(msg, sizeof(msg), "Vector index %lld out of bounds (length %zu)", (long long)idx,
                 len);
        east_builtin_error(msg);
        return NULL;
    }
    return vec_get_elem(args[0], (size_t)idx);
}

static EastValue *vector_set_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *vec = args[0];
    int64_t idx = args[1]->data.integer;
    size_t len = vec->data.vector.len;
    if (idx < 0 || (size_t)idx >= len) {
        char msg[128];
        snprintf(msg, sizeof(msg), "Vector index %lld out of bounds (length %zu)", (long long)idx,
                 len);
        east_builtin_error(msg);
        return NULL;
    }
    EastType *et = vec->data.vector.elem_type;
    EastValue *result = east_vector_new(et, len);
    memcpy(result->data.vector.data, vec->data.vector.data, len * elem_size(et));
    vec_set_elem(result, (size_t)idx, args[2]);
    return result;
}

static EastValue *vector_slice_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *vec = args[0];
    int64_t start = args[1]->data.integer;
    int64_t end = args[2]->data.integer;
    size_t len = vec->data.vector.len;
    if (start < 0 || end > (int64_t)len || start > end) {
        char msg[128];
        snprintf(msg, sizeof(msg), "Vector slice [%lld, %lld) out of bounds (length %zu)",
                 (long long)start, (long long)end, len);
        east_builtin_error(msg);
        return NULL;
    }
    if (start >= end) return east_vector_new(vec->data.vector.elem_type, 0);
    size_t count = (size_t)(end - start);
    EastValue *result = east_vector_new(vec->data.vector.elem_type, count);
    size_t es = elem_size(vec->data.vector.elem_type);
    memcpy(result->data.vector.data, (char *)vec->data.vector.data + (size_t)start * es,
           count * es);
    return result;
}

static EastValue *vector_concat_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *a = args[0];
    EastValue *b = args[1];
    size_t alen = a->data.vector.len;
    size_t blen = b->data.vector.len;
    EastValue *result = east_vector_new(a->data.vector.elem_type, alen + blen);
    size_t es = elem_size(a->data.vector.elem_type);
    memcpy(result->data.vector.data, a->data.vector.data, alen * es);
    memcpy((char *)result->data.vector.data + alen * es, b->data.vector.data, blen * es);
    return result;
}

/* The DECLARED type parameter is authoritative (#601): a builtin-produced
 * input array may carry a stale or Null elem-type label (an ArrayMap result),
 * and vec_set_elem against that label silently writes nothing. */
static EastValue *vector_from_array_with_type(EastValue **args, EastType *et)
{
    EastValue *arr = args[0];
    size_t len = east_array_len(arr);
    EastValue *result = east_vector_new(et, len);
    for (size_t i = 0; i < len; i++) {
        vec_set_elem(result, i, east_array_get(arr, i));
    }
    return result;
}
static EastValue *vector_from_array_float(EastValue **args, size_t n)
{
    (void)n;
    return vector_from_array_with_type(args, &east_float_type);
}
static EastValue *vector_from_array_int(EastValue **args, size_t n)
{
    (void)n;
    return vector_from_array_with_type(args, &east_integer_type);
}
static EastValue *vector_from_array_bool(EastValue **args, size_t n)
{
    (void)n;
    return vector_from_array_with_type(args, &east_boolean_type);
}

static EastValue *vector_to_array_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *vec = args[0];
    size_t len = vec->data.vector.len;
    EastValue *result = east_array_new(vec->data.vector.elem_type);
    for (size_t i = 0; i < len; i++) {
        EastValue *elem = vec_get_elem(vec, i);
        east_array_push(result, elem);
        east_value_release(elem);
    }
    return result;
}

static EastValue *vector_to_matrix_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *vec = args[0];
    int64_t rows = args[1]->data.integer;
    int64_t cols = args[2]->data.integer;
    if (rows * cols != (int64_t)vec->data.vector.len) return east_null();
    EastValue *mat = east_matrix_new(vec->data.vector.elem_type, (size_t)rows, (size_t)cols);
    size_t es = elem_size(vec->data.vector.elem_type);
    memcpy(mat->data.matrix.data, vec->data.vector.data, vec->data.vector.len * es);
    return mat;
}

/* zeros/ones honor the DECLARED element type (#601): the impls were
 * Float-hardwired, so `VectorOnes` with T=Integer returned a Float-buffered
 * value that decoded as double-1.0 bit patterns. Zero bits coincide across
 * kinds, so zeros only mislabelled the element type. */
static EastValue *vector_zeros_with_type(EastValue **args, EastType *et)
{
    int64_t length = args[0]->data.integer;
    EastValue *result = east_vector_new(et, (size_t)length);
    memset(result->data.vector.data, 0, (size_t)length * elem_size(et));
    return result;
}
static EastValue *vector_zeros_float(EastValue **args, size_t n)
{
    (void)n;
    return vector_zeros_with_type(args, &east_float_type);
}
static EastValue *vector_zeros_int(EastValue **args, size_t n)
{
    (void)n;
    return vector_zeros_with_type(args, &east_integer_type);
}
static EastValue *vector_zeros_bool(EastValue **args, size_t n)
{
    (void)n;
    return vector_zeros_with_type(args, &east_boolean_type);
}

static EastValue *vector_ones_with_type(EastValue **args, EastType *et)
{
    int64_t length = args[0]->data.integer;
    EastValue *result = east_vector_new(et, (size_t)length);
    if (et->kind == EAST_TYPE_FLOAT) {
        double *data = (double *)result->data.vector.data;
        for (int64_t i = 0; i < length; i++)
            data[i] = 1.0;
    } else if (et->kind == EAST_TYPE_INTEGER) {
        int64_t *data = (int64_t *)result->data.vector.data;
        for (int64_t i = 0; i < length; i++)
            data[i] = 1;
    } else {
        bool *data = (bool *)result->data.vector.data;
        for (int64_t i = 0; i < length; i++)
            data[i] = true;
    }
    return result;
}
static EastValue *vector_ones_float(EastValue **args, size_t n)
{
    (void)n;
    return vector_ones_with_type(args, &east_float_type);
}
static EastValue *vector_ones_int(EastValue **args, size_t n)
{
    (void)n;
    return vector_ones_with_type(args, &east_integer_type);
}
static EastValue *vector_ones_bool(EastValue **args, size_t n)
{
    (void)n;
    return vector_ones_with_type(args, &east_boolean_type);
}

static EastValue *vector_fill_with_type(EastValue **args, EastType *et)
{
    int64_t length = args[0]->data.integer;
    EastValue *val = args[1];
    EastValue *result = east_vector_new(et, (size_t)length);
    for (int64_t i = 0; i < length; i++) {
        vec_set_elem(result, (size_t)i, val);
    }
    return result;
}
static EastValue *vector_fill_float(EastValue **args, size_t n)
{
    (void)n;
    return vector_fill_with_type(args, &east_float_type);
}
static EastValue *vector_fill_int(EastValue **args, size_t n)
{
    (void)n;
    return vector_fill_with_type(args, &east_integer_type);
}
static EastValue *vector_fill_bool(EastValue **args, size_t n)
{
    (void)n;
    return vector_fill_with_type(args, &east_boolean_type);
}

static EastValue *vector_map_with_type(EastValue **args, size_t n, EastType *out_type)
{
    (void)n;
    EastValue *vec = args[0];
    EastValue *fn = args[1];
    size_t len = vec->data.vector.len;
    EastValue *result = east_vector_new(out_type, len);
    for (size_t i = 0; i < len; i++) {
        EastValue *elem = vec_get_elem(vec, i);
        EastValue *idx = east_integer((int64_t)i);
        EastValue *call_args[] = {elem, idx};
        EastValue *mapped = call_fn(fn, call_args, 2);
        if (!mapped) {
            east_value_release(elem);
            east_value_release(idx);
            east_value_release(result);
            return NULL;
        }
        vec_set_elem(result, i, mapped);
        east_value_release(elem);
        east_value_release(idx);
        east_value_release(mapped);
    }
    return result;
}

static EastValue *vector_map_float(EastValue **args, size_t n)
{
    return vector_map_with_type(args, n, &east_float_type);
}
static EastValue *vector_map_int(EastValue **args, size_t n)
{
    return vector_map_with_type(args, n, &east_integer_type);
}
static EastValue *vector_map_bool(EastValue **args, size_t n)
{
    return vector_map_with_type(args, n, &east_boolean_type);
}

static EastValue *vector_fold_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *vec = args[0];
    EastValue *init = args[1];
    EastValue *fn = args[2];
    size_t len = vec->data.vector.len;
    east_value_retain(init);
    EastValue *acc = init;
    for (size_t i = 0; i < len; i++) {
        EastValue *elem = vec_get_elem(vec, i);
        EastValue *idx = east_integer((int64_t)i);
        EastValue *call_args[] = {acc, elem, idx};
        EastValue *new_acc = call_fn(fn, call_args, 3);
        if (!new_acc) {
            east_value_release(acc);
            east_value_release(elem);
            east_value_release(idx);
            return NULL;
        }
        east_value_release(acc);
        east_value_release(elem);
        east_value_release(idx);
        acc = new_acc;
        east_value_retain(acc);
        east_value_release(new_acc);
    }
    return acc;
}

/* ------------------------------------------------------------------ */
/* Elementwise arithmetic, masks and sparse accumulators (#598).       */
/*                                                                     */
/* Reductions fold in index order, left to right — part of the         */
/* cross-runtime contract, since a reassociated float sum gives a      */
/* different last bit. Element comparisons delegate to                 */
/* east_value_compare / east_value_equal through stack-boxed           */
/* temporaries (no allocation), so the canonical total order stays     */
/* defined in one place.                                               */
/* ------------------------------------------------------------------ */

static bool require_numeric(const char *name, EastType *et)
{
    if (et && (et->kind == EAST_TYPE_FLOAT || et->kind == EAST_TYPE_INTEGER)) return true;
    char msg[96];
    snprintf(msg, sizeof(msg), "%s requires Float or Integer elements", name);
    east_builtin_error(msg);
    return false;
}

static bool require_same_len(size_t a, size_t b)
{
    if (a == b) return true;
    char msg[96];
    snprintf(msg, sizeof(msg), "Vector length mismatch (%zu vs %zu)", a, b);
    east_builtin_error(msg);
    return false;
}

static bool require_sparse(EastValue *ix, EastValue *v)
{
    if (ix->data.vector.len != v->data.vector.len) {
        char msg[96];
        snprintf(msg, sizeof(msg), "Sparse index and value lengths differ (%zu vs %zu)",
                 ix->data.vector.len, v->data.vector.len);
        east_builtin_error(msg);
        return false;
    }
    const int64_t *ixd = (const int64_t *)ix->data.vector.data;
    for (size_t i = 1; i < ix->data.vector.len; i++) {
        if (ixd[i] <= ixd[i - 1]) {
            east_builtin_error("Sparse index vector must be strictly ascending");
            return false;
        }
    }
    return true;
}

/* Box element i of a raw buffer as a stack scalar for east_value_compare. */
static void elem_box(EastType *et, const void *d, size_t i, EastValue *out)
{
    if (et->kind == EAST_TYPE_FLOAT) {
        out->kind = EAST_VAL_FLOAT;
        out->data.float64 = ((const double *)d)[i];
    } else if (et->kind == EAST_TYPE_INTEGER) {
        out->kind = EAST_VAL_INTEGER;
        out->data.integer = ((const int64_t *)d)[i];
    } else {
        out->kind = EAST_VAL_BOOLEAN;
        out->data.boolean = ((const bool *)d)[i];
    }
}

static int elem_cmp(EastType *et, const void *da, size_t ia, const void *db, size_t ib)
{
    EastValue a, b;
    elem_box(et, da, ia, &a);
    elem_box(et, db, ib, &b);
    return east_value_compare(&a, &b);
}

static int elem_cmp_scalar(EastType *et, const void *d, size_t i, EastValue *scalar)
{
    EastValue a;
    elem_box(et, d, i, &a);
    return east_value_compare(&a, scalar);
}

static bool elem_eq(EastType *et, const void *da, size_t ia, const void *db, size_t ib)
{
    EastValue a, b;
    elem_box(et, da, ia, &a);
    elem_box(et, db, ib, &b);
    return east_value_equal(&a, &b);
}

static EastValue *vector_scale_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorScale", et)) return NULL;
    size_t len = v->data.vector.len;
    EastValue *result = east_vector_new_uninit(et, len);
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *in = (const double *)v->data.vector.data;
        double *out = (double *)result->data.vector.data;
        double alpha = args[1]->data.float64;
        for (size_t i = 0; i < len; i++)
            out[i] = in[i] * alpha;
    } else {
        const int64_t *in = (const int64_t *)v->data.vector.data;
        int64_t *out = (int64_t *)result->data.vector.data;
        int64_t alpha = args[1]->data.integer;
        for (size_t i = 0; i < len; i++)
            out[i] = in[i] * alpha;
    }
    return result;
}

static EastValue *vector_sum_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorSum", et)) return NULL;
    size_t len = v->data.vector.len;
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *in = (const double *)v->data.vector.data;
        double acc = 0.0;
        for (size_t i = 0; i < len; i++)
            acc += in[i];
        return east_float(acc);
    }
    const int64_t *in = (const int64_t *)v->data.vector.data;
    int64_t acc = 0;
    for (size_t i = 0; i < len; i++)
        acc += in[i];
    return east_integer(acc);
}

static EastValue *vector_add_scaled_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *a = args[0];
    EastValue *b = args[1];
    EastType *et = a->data.vector.elem_type;
    if (!require_numeric("VectorAddScaled", et)) return NULL;
    if (!require_same_len(a->data.vector.len, b->data.vector.len)) return NULL;
    size_t len = a->data.vector.len;
    EastValue *result = east_vector_new_uninit(et, len);
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *ad = (const double *)a->data.vector.data;
        const double *bd = (const double *)b->data.vector.data;
        double *out = (double *)result->data.vector.data;
        double alpha = args[2]->data.float64;
        for (size_t i = 0; i < len; i++)
            out[i] = ad[i] + alpha * bd[i];
    } else {
        const int64_t *ad = (const int64_t *)a->data.vector.data;
        const int64_t *bd = (const int64_t *)b->data.vector.data;
        int64_t *out = (int64_t *)result->data.vector.data;
        int64_t alpha = args[2]->data.integer;
        for (size_t i = 0; i < len; i++)
            out[i] = ad[i] + alpha * bd[i];
    }
    return result;
}

static EastValue *vector_mul_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *a = args[0];
    EastValue *b = args[1];
    EastType *et = a->data.vector.elem_type;
    if (!require_numeric("VectorMul", et)) return NULL;
    if (!require_same_len(a->data.vector.len, b->data.vector.len)) return NULL;
    size_t len = a->data.vector.len;
    EastValue *result = east_vector_new_uninit(et, len);
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *ad = (const double *)a->data.vector.data;
        const double *bd = (const double *)b->data.vector.data;
        double *out = (double *)result->data.vector.data;
        for (size_t i = 0; i < len; i++)
            out[i] = ad[i] * bd[i];
    } else {
        const int64_t *ad = (const int64_t *)a->data.vector.data;
        const int64_t *bd = (const int64_t *)b->data.vector.data;
        int64_t *out = (int64_t *)result->data.vector.data;
        for (size_t i = 0; i < len; i++)
            out[i] = ad[i] * bd[i];
    }
    return result;
}

static EastValue *vector_add_scalar_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorAddScalar", et)) return NULL;
    size_t len = v->data.vector.len;
    EastValue *result = east_vector_new_uninit(et, len);
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *in = (const double *)v->data.vector.data;
        double *out = (double *)result->data.vector.data;
        double c = args[1]->data.float64;
        for (size_t i = 0; i < len; i++)
            out[i] = in[i] + c;
    } else {
        const int64_t *in = (const int64_t *)v->data.vector.data;
        int64_t *out = (int64_t *)result->data.vector.data;
        int64_t c = args[1]->data.integer;
        for (size_t i = 0; i < len; i++)
            out[i] = in[i] + c;
    }
    return result;
}

static EastValue *vector_dot_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *a = args[0];
    EastValue *b = args[1];
    EastType *et = a->data.vector.elem_type;
    if (!require_numeric("VectorDot", et)) return NULL;
    if (!require_same_len(a->data.vector.len, b->data.vector.len)) return NULL;
    size_t len = a->data.vector.len;
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *ad = (const double *)a->data.vector.data;
        const double *bd = (const double *)b->data.vector.data;
        double acc = 0.0;
        for (size_t i = 0; i < len; i++)
            acc += ad[i] * bd[i];
        return east_float(acc);
    }
    const int64_t *ad = (const int64_t *)a->data.vector.data;
    const int64_t *bd = (const int64_t *)b->data.vector.data;
    int64_t acc = 0;
    for (size_t i = 0; i < len; i++)
        acc += ad[i] * bd[i];
    return east_integer(acc);
}

/* Shared extremum scan: the index of the best element, ties keeping the
 * first occurrence. `want` is the east_value_compare sign that replaces the
 * current best (+1 for max, -1 for min). */
static bool vector_best_index(const char *name, EastValue *v, int want, size_t *out)
{
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric(name, et)) return false;
    if (v->data.vector.len == 0) {
        east_builtin_error("Cannot reduce empty Vector");
        return false;
    }
    const void *d = v->data.vector.data;
    size_t best = 0;
    for (size_t i = 1; i < v->data.vector.len; i++) {
        if (elem_cmp(et, d, i, d, best) == want) best = i;
    }
    *out = best;
    return true;
}

static EastValue *vector_max_impl(EastValue **args, size_t n)
{
    (void)n;
    size_t best;
    if (!vector_best_index("VectorMax", args[0], 1, &best)) return NULL;
    return vec_get_elem(args[0], best);
}

static EastValue *vector_min_impl(EastValue **args, size_t n)
{
    (void)n;
    size_t best;
    if (!vector_best_index("VectorMin", args[0], -1, &best)) return NULL;
    return vec_get_elem(args[0], best);
}

static EastValue *vector_arg_max_impl(EastValue **args, size_t n)
{
    (void)n;
    size_t best;
    if (!vector_best_index("VectorArgMax", args[0], 1, &best)) return NULL;
    return east_integer((int64_t)best);
}

static EastValue *vector_arg_min_impl(EastValue **args, size_t n)
{
    (void)n;
    size_t best;
    if (!vector_best_index("VectorArgMin", args[0], -1, &best)) return NULL;
    return east_integer((int64_t)best);
}

static EastValue *vector_mean_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorMean", et)) return NULL;
    size_t len = v->data.vector.len;
    double acc = 0.0;
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *in = (const double *)v->data.vector.data;
        for (size_t i = 0; i < len; i++)
            acc += in[i];
    } else {
        const int64_t *in = (const int64_t *)v->data.vector.data;
        for (size_t i = 0; i < len; i++)
            acc += (double)in[i];
    }
    return east_float(acc / (double)len);
}

static EastValue *vector_cum_sum_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorCumSum", et)) return NULL;
    size_t len = v->data.vector.len;
    EastValue *result = east_vector_new_uninit(et, len);
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *in = (const double *)v->data.vector.data;
        double *out = (double *)result->data.vector.data;
        double acc = 0.0;
        for (size_t i = 0; i < len; i++) {
            acc += in[i];
            out[i] = acc;
        }
    } else {
        const int64_t *in = (const int64_t *)v->data.vector.data;
        int64_t *out = (int64_t *)result->data.vector.data;
        int64_t acc = 0;
        for (size_t i = 0; i < len; i++) {
            acc += in[i];
            out[i] = acc;
        }
    }
    return result;
}

static EastValue *vector_abs_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorAbs", et)) return NULL;
    size_t len = v->data.vector.len;
    EastValue *result = east_vector_new_uninit(et, len);
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *in = (const double *)v->data.vector.data;
        double *out = (double *)result->data.vector.data;
        for (size_t i = 0; i < len; i++)
            out[i] = in[i] < 0.0 ? -in[i] : in[i];
    } else {
        const int64_t *in = (const int64_t *)v->data.vector.data;
        int64_t *out = (int64_t *)result->data.vector.data;
        for (size_t i = 0; i < len; i++)
            out[i] = in[i] < 0 ? -in[i] : in[i];
    }
    return result;
}

static EastValue *vector_clamp_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastValue *lo = args[1];
    EastValue *hi = args[2];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("VectorClamp", et)) return NULL;
    size_t len = v->data.vector.len;
    const void *in = v->data.vector.data;
    EastValue *result = east_vector_new_uninit(et, len);
    /* Comparisons stay on east_value_compare (NaN greatest, -0 < +0); only
     * the writes are hoisted to typed pointers. */
    if (et->kind == EAST_TYPE_FLOAT) {
        const double *vf = (const double *)in;
        double *of = (double *)result->data.vector.data;
        double flo = lo->data.float64;
        double fhi = hi->data.float64;
        for (size_t i = 0; i < len; i++) {
            if (elem_cmp_scalar(et, in, i, lo) < 0)
                of[i] = flo;
            else if (elem_cmp_scalar(et, in, i, hi) > 0)
                of[i] = fhi;
            else
                of[i] = vf[i];
        }
    } else {
        const int64_t *vz = (const int64_t *)in;
        int64_t *oz = (int64_t *)result->data.vector.data;
        int64_t zlo = lo->data.integer;
        int64_t zhi = hi->data.integer;
        for (size_t i = 0; i < len; i++) {
            if (elem_cmp_scalar(et, in, i, lo) < 0)
                oz[i] = zlo;
            else if (elem_cmp_scalar(et, in, i, hi) > 0)
                oz[i] = zhi;
            else
                oz[i] = vz[i];
        }
    }
    return result;
}

static EastValue *vector_gather_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *v = args[0];
    EastValue *idx = args[1];
    EastType *et = v->data.vector.elem_type;
    size_t len = v->data.vector.len;
    size_t count = idx->data.vector.len;
    const int64_t *ixd = (const int64_t *)idx->data.vector.data;
    size_t es = elem_size(et);
    EastValue *result = east_vector_new_uninit(et, count);
    for (size_t j = 0; j < count; j++) {
        int64_t i = ixd[j];
        if (i < 0 || (size_t)i >= len) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Vector index %lld out of bounds (length %zu)", (long long)i,
                     len);
            east_builtin_error(msg);
            east_value_release(result);
            return NULL;
        }
        memcpy((char *)result->data.vector.data + j * es,
               (const char *)v->data.vector.data + (size_t)i * es, es);
    }
    return result;
}

static EastValue *vector_scatter_add_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *dst = args[0];
    EastValue *idx = args[1];
    EastValue *src = args[2];
    EastType *et = dst->data.vector.elem_type;
    if (!require_numeric("VectorScatterAdd", et)) return NULL;
    if (!require_same_len(idx->data.vector.len, src->data.vector.len)) return NULL;
    size_t len = dst->data.vector.len;
    size_t count = idx->data.vector.len;
    const int64_t *ixd = (const int64_t *)idx->data.vector.data;
    EastValue *result = east_vector_new_uninit(et, len);
    memcpy(result->data.vector.data, dst->data.vector.data, len * elem_size(et));
    for (size_t j = 0; j < count; j++) {
        int64_t i = ixd[j];
        if (i < 0 || (size_t)i >= len) {
            char msg[128];
            snprintf(msg, sizeof(msg), "Vector index %lld out of bounds (length %zu)", (long long)i,
                     len);
            east_builtin_error(msg);
            east_value_release(result);
            return NULL;
        }
        if (et->kind == EAST_TYPE_FLOAT) {
            ((double *)result->data.vector.data)[i] += ((const double *)src->data.vector.data)[j];
        } else {
            ((int64_t *)result->data.vector.data)[i] += ((const int64_t *)src->data.vector.data)[j];
        }
    }
    return result;
}

static EastValue *vector_search_sorted_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *haystack = args[0];
    EastValue *needles = args[1];
    EastType *et = haystack->data.vector.elem_type;
    size_t hlen = haystack->data.vector.len;
    size_t count = needles->data.vector.len;
    const void *hd = haystack->data.vector.data;
    const void *nd = needles->data.vector.data;
    EastValue *result = east_vector_new_uninit(&east_integer_type, count);
    int64_t *out = (int64_t *)result->data.vector.data;
    for (size_t j = 0; j < count; j++) {
        size_t lo = 0;
        size_t hi = hlen;
        while (lo < hi) {
            size_t mid = lo + (hi - lo) / 2;
            if (elem_cmp(et, hd, mid, nd, j) < 0) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        out[j] = (int64_t)lo;
    }
    return result;
}

/* Shared mask builder for VectorEq / VectorLt / VectorGt: `want` is the
 * east_value_compare sign that sets the mask (0 with `eq` for equality). */
static EastValue *vector_mask_impl(EastValue *a, EastValue *b, bool eq, int want)
{
    if (!require_same_len(a->data.vector.len, b->data.vector.len)) return NULL;
    EastType *et = a->data.vector.elem_type;
    size_t len = a->data.vector.len;
    const void *ad = a->data.vector.data;
    const void *bd = b->data.vector.data;
    EastValue *result = east_vector_new_uninit(&east_boolean_type, len);
    bool *out = (bool *)result->data.vector.data;
    for (size_t i = 0; i < len; i++) {
        out[i] = eq ? elem_eq(et, ad, i, bd, i) : elem_cmp(et, ad, i, bd, i) == want;
    }
    return result;
}

static EastValue *vector_eq_impl(EastValue **args, size_t n)
{
    (void)n;
    return vector_mask_impl(args[0], args[1], true, 0);
}

static EastValue *vector_lt_impl(EastValue **args, size_t n)
{
    (void)n;
    return vector_mask_impl(args[0], args[1], false, -1);
}

static EastValue *vector_gt_impl(EastValue **args, size_t n)
{
    (void)n;
    return vector_mask_impl(args[0], args[1], false, 1);
}

static EastValue *vector_select_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *mask = args[0];
    EastValue *a = args[1];
    EastValue *b = args[2];
    if (!require_same_len(mask->data.vector.len, a->data.vector.len)) return NULL;
    if (!require_same_len(a->data.vector.len, b->data.vector.len)) return NULL;
    EastType *et = a->data.vector.elem_type;
    size_t len = mask->data.vector.len;
    size_t es = elem_size(et);
    const bool *md = (const bool *)mask->data.vector.data;
    EastValue *result = east_vector_new_uninit(et, len);
    for (size_t i = 0; i < len; i++) {
        const void *src = md[i] ? a->data.vector.data : b->data.vector.data;
        memcpy((char *)result->data.vector.data + i * es, (const char *)src + i * es, es);
    }
    return result;
}

static EastValue *vector_compress_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *mask = args[0];
    EastValue *v = args[1];
    if (!require_same_len(mask->data.vector.len, v->data.vector.len)) return NULL;
    EastType *et = v->data.vector.elem_type;
    size_t len = mask->data.vector.len;
    size_t es = elem_size(et);
    const bool *md = (const bool *)mask->data.vector.data;
    size_t count = 0;
    for (size_t i = 0; i < len; i++) {
        if (md[i]) count++;
    }
    EastValue *result = east_vector_new_uninit(et, count);
    size_t j = 0;
    for (size_t i = 0; i < len; i++) {
        if (md[i]) {
            memcpy((char *)result->data.vector.data + j * es,
                   (const char *)v->data.vector.data + i * es, es);
            j++;
        }
    }
    return result;
}

static EastValue *vector_count_true_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *mask = args[0];
    const bool *md = (const bool *)mask->data.vector.data;
    int64_t count = 0;
    for (size_t i = 0; i < mask->data.vector.len; i++) {
        if (md[i]) count++;
    }
    return east_integer(count);
}

/* The Struct{ix, v} sparse-accumulator result. Takes ownership of ix/v. */
static EastValue *sparse_result(EastValue *ix, EastValue *v, EastType *elem)
{
    const char *names[2] = {"ix", "v"};
    EastType *types[2] = {east_vector_type(&east_integer_type), east_vector_type(elem)};
    EastType *st = east_struct_type(names, types, 2);
    EastValue *fields[2] = {ix, v};
    EastValue *result = east_struct_new(names, fields, 2, st);
    east_value_release(ix);
    east_value_release(v);
    return result;
}

static EastValue *sparse_axpy_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *ix_a = args[0];
    EastValue *v_a = args[1];
    EastValue *ix_b = args[2];
    EastValue *v_b = args[3];
    EastValue *alpha = args[4];
    EastType *et = v_a->data.vector.elem_type;
    if (!require_numeric("SparseAxpy", et)) return NULL;
    if (!require_sparse(ix_a, v_a) || !require_sparse(ix_b, v_b)) return NULL;
    size_t na = ix_a->data.vector.len;
    size_t nb = ix_b->data.vector.len;
    const int64_t *ia = (const int64_t *)ix_a->data.vector.data;
    const int64_t *ib = (const int64_t *)ix_b->data.vector.data;

    size_t count = 0;
    size_t i = 0, j = 0;
    while (i < na && j < nb) {
        if (ia[i] < ib[j])
            i++;
        else if (ib[j] < ia[i])
            j++;
        else {
            i++;
            j++;
        }
        count++;
    }
    count += (na - i) + (nb - j);

    EastValue *out_ix = east_vector_new_uninit(&east_integer_type, count);
    EastValue *out_v = east_vector_new_uninit(et, count);
    int64_t *oix = (int64_t *)out_ix->data.vector.data;
    bool is_float = et->kind == EAST_TYPE_FLOAT;
    const double *af = (const double *)v_a->data.vector.data;
    const double *bf = (const double *)v_b->data.vector.data;
    const int64_t *az = (const int64_t *)v_a->data.vector.data;
    const int64_t *bz = (const int64_t *)v_b->data.vector.data;
    double *of = (double *)out_v->data.vector.data;
    int64_t *oz = (int64_t *)out_v->data.vector.data;
    double alpha_f = is_float ? alpha->data.float64 : 0.0;
    int64_t alpha_z = is_float ? 0 : alpha->data.integer;

    i = 0;
    j = 0;
    size_t k = 0;
    while (i < na && j < nb) {
        if (ia[i] < ib[j]) {
            oix[k] = ia[i];
            if (is_float)
                of[k] = af[i];
            else
                oz[k] = az[i];
            i++;
        } else if (ib[j] < ia[i]) {
            oix[k] = ib[j];
            if (is_float)
                of[k] = alpha_f * bf[j];
            else
                oz[k] = alpha_z * bz[j];
            j++;
        } else {
            oix[k] = ia[i];
            if (is_float)
                of[k] = af[i] + alpha_f * bf[j];
            else
                oz[k] = az[i] + alpha_z * bz[j];
            i++;
            j++;
        }
        k++;
    }
    for (; i < na; i++, k++) {
        oix[k] = ia[i];
        if (is_float)
            of[k] = af[i];
        else
            oz[k] = az[i];
    }
    for (; j < nb; j++, k++) {
        oix[k] = ib[j];
        if (is_float)
            of[k] = alpha_f * bf[j];
        else
            oz[k] = alpha_z * bz[j];
    }
    return sparse_result(out_ix, out_v, et);
}

typedef struct {
    int64_t ix;
    size_t pos;
} SparsePairSlot;

/* Order by index, then original position — a deterministic stable sort, so
 * equal indices accumulate in input order (the float contract). */
static int sparse_pair_cmp(const void *pa, const void *pb)
{
    const SparsePairSlot *a = (const SparsePairSlot *)pa;
    const SparsePairSlot *b = (const SparsePairSlot *)pb;
    if (a->ix < b->ix) return -1;
    if (a->ix > b->ix) return 1;
    if (a->pos < b->pos) return -1;
    if (a->pos > b->pos) return 1;
    return 0;
}

static EastValue *sparse_from_pairs_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *ix = args[0];
    EastValue *v = args[1];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("SparseFromPairs", et)) return NULL;
    if (ix->data.vector.len != v->data.vector.len) {
        char msg[96];
        snprintf(msg, sizeof(msg), "Sparse index and value lengths differ (%zu vs %zu)",
                 ix->data.vector.len, v->data.vector.len);
        east_builtin_error(msg);
        return NULL;
    }
    size_t len = ix->data.vector.len;
    const int64_t *ixd = (const int64_t *)ix->data.vector.data;
    SparsePairSlot *order = NULL;
    if (len > 0) {
        order = malloc(len * sizeof(SparsePairSlot));
        if (!order) {
            east_builtin_error("out of memory");
            return NULL;
        }
        for (size_t i = 0; i < len; i++) {
            order[i].ix = ixd[i];
            order[i].pos = i;
        }
        qsort(order, len, sizeof(SparsePairSlot), sparse_pair_cmp);
    }
    size_t count = 0;
    for (size_t i = 0; i < len; i++) {
        if (i == 0 || order[i].ix != order[i - 1].ix) count++;
    }
    EastValue *out_ix = east_vector_new_uninit(&east_integer_type, count);
    EastValue *out_v = east_vector_new_uninit(et, count);
    int64_t *oix = (int64_t *)out_ix->data.vector.data;
    bool is_float = et->kind == EAST_TYPE_FLOAT;
    const double *vf = (const double *)v->data.vector.data;
    const int64_t *vz = (const int64_t *)v->data.vector.data;
    double *of = (double *)out_v->data.vector.data;
    int64_t *oz = (int64_t *)out_v->data.vector.data;
    size_t k = 0;
    for (size_t i = 0; i < len; i++) {
        size_t p = order[i].pos;
        if (i == 0 || order[i].ix != order[i - 1].ix) {
            oix[k] = order[i].ix;
            if (is_float)
                of[k] = vf[p];
            else
                oz[k] = vz[p];
            k++;
        } else {
            if (is_float)
                of[k - 1] += vf[p];
            else
                oz[k - 1] += vz[p];
        }
    }
    free(order);
    return sparse_result(out_ix, out_v, et);
}

static EastValue *sparse_filter_gt_impl(EastValue **args, size_t n)
{
    (void)n;
    EastValue *ix = args[0];
    EastValue *v = args[1];
    EastValue *threshold = args[2];
    EastType *et = v->data.vector.elem_type;
    if (!require_numeric("SparseFilterGt", et)) return NULL;
    if (!require_sparse(ix, v)) return NULL;
    size_t len = ix->data.vector.len;
    const void *vd = v->data.vector.data;
    size_t count = 0;
    for (size_t i = 0; i < len; i++) {
        if (elem_cmp_scalar(et, vd, i, threshold) > 0) count++;
    }
    EastValue *out_ix = east_vector_new_uninit(&east_integer_type, count);
    EastValue *out_v = east_vector_new_uninit(et, count);
    const int64_t *ixd = (const int64_t *)ix->data.vector.data;
    int64_t *oix = (int64_t *)out_ix->data.vector.data;
    size_t es = elem_size(et);
    size_t k = 0;
    for (size_t i = 0; i < len; i++) {
        if (elem_cmp_scalar(et, vd, i, threshold) > 0) {
            oix[k] = ixd[i];
            memcpy((char *)out_v->data.vector.data + k * es, (const char *)vd + i * es, es);
            k++;
        }
    }
    return sparse_result(out_ix, out_v, et);
}

/* --- typed factory functions that use type params for construction --- */
/* The constructors have no input vector to read an element type from, so the
 * factory picks a per-kind impl from tp[0] — the same dispatch the
 * vector_map factory uses for its output type (#601). */

static BuiltinImpl vector_zeros_typed_factory(EastType **tp, size_t ntp)
{
    if (ntp >= 1 && tp[0]) {
        if (tp[0]->kind == EAST_TYPE_INTEGER) return vector_zeros_int;
        if (tp[0]->kind == EAST_TYPE_BOOLEAN) return vector_zeros_bool;
    }
    return vector_zeros_float;
}

static BuiltinImpl vector_ones_typed_factory(EastType **tp, size_t ntp)
{
    if (ntp >= 1 && tp[0]) {
        if (tp[0]->kind == EAST_TYPE_INTEGER) return vector_ones_int;
        if (tp[0]->kind == EAST_TYPE_BOOLEAN) return vector_ones_bool;
    }
    return vector_ones_float;
}

static BuiltinImpl vector_fill_typed_factory(EastType **tp, size_t ntp)
{
    if (ntp >= 1 && tp[0]) {
        if (tp[0]->kind == EAST_TYPE_INTEGER) return vector_fill_int;
        if (tp[0]->kind == EAST_TYPE_BOOLEAN) return vector_fill_bool;
    }
    return vector_fill_float;
}

/* --- factory functions --- */

static BuiltinImpl vector_length_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_length_impl;
}
static BuiltinImpl vector_get_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_get_impl;
}
static BuiltinImpl vector_set_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_set_impl;
}
static BuiltinImpl vector_slice_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_slice_impl;
}
static BuiltinImpl vector_concat_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_concat_impl;
}
static BuiltinImpl vector_from_array_factory(EastType **tp, size_t ntp)
{
    if (ntp >= 1 && tp[0]) {
        if (tp[0]->kind == EAST_TYPE_INTEGER) return vector_from_array_int;
        if (tp[0]->kind == EAST_TYPE_BOOLEAN) return vector_from_array_bool;
    }
    return vector_from_array_float;
}
static BuiltinImpl vector_to_array_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_to_array_impl;
}
static BuiltinImpl vector_to_matrix_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_to_matrix_impl;
}
static BuiltinImpl vector_map_factory(EastType **tp, size_t ntp)
{
    /* tp[0]=input elem, tp[1]=output elem */
    if (ntp >= 2 && tp[1]) {
        if (tp[1]->kind == EAST_TYPE_INTEGER) return vector_map_int;
        if (tp[1]->kind == EAST_TYPE_BOOLEAN) return vector_map_bool;
    }
    return vector_map_float;
}
static BuiltinImpl vector_fold_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return vector_fold_impl;
}

/* The arithmetic/mask/sparse impls read their element type from the argument
 * vectors at call time, so one pass-through factory serves them all. */
#define VECTOR_SIMPLE_FACTORY(name)                                                                \
    static BuiltinImpl name##_factory(EastType **tp, size_t ntp)                                   \
    {                                                                                              \
        (void)tp;                                                                                  \
        (void)ntp;                                                                                 \
        return name##_impl;                                                                        \
    }

VECTOR_SIMPLE_FACTORY(vector_scale)
VECTOR_SIMPLE_FACTORY(vector_sum)
VECTOR_SIMPLE_FACTORY(vector_add_scaled)
VECTOR_SIMPLE_FACTORY(vector_mul)
VECTOR_SIMPLE_FACTORY(vector_add_scalar)
VECTOR_SIMPLE_FACTORY(vector_dot)
VECTOR_SIMPLE_FACTORY(vector_max)
VECTOR_SIMPLE_FACTORY(vector_min)
VECTOR_SIMPLE_FACTORY(vector_arg_max)
VECTOR_SIMPLE_FACTORY(vector_arg_min)
VECTOR_SIMPLE_FACTORY(vector_mean)
VECTOR_SIMPLE_FACTORY(vector_cum_sum)
VECTOR_SIMPLE_FACTORY(vector_abs)
VECTOR_SIMPLE_FACTORY(vector_clamp)
VECTOR_SIMPLE_FACTORY(vector_gather)
VECTOR_SIMPLE_FACTORY(vector_scatter_add)
VECTOR_SIMPLE_FACTORY(vector_search_sorted)
VECTOR_SIMPLE_FACTORY(vector_eq)
VECTOR_SIMPLE_FACTORY(vector_lt)
VECTOR_SIMPLE_FACTORY(vector_gt)
VECTOR_SIMPLE_FACTORY(vector_select)
VECTOR_SIMPLE_FACTORY(vector_compress)
VECTOR_SIMPLE_FACTORY(vector_count_true)
VECTOR_SIMPLE_FACTORY(sparse_axpy)
VECTOR_SIMPLE_FACTORY(sparse_from_pairs)
VECTOR_SIMPLE_FACTORY(sparse_filter_gt)

/* --- registration --- */

void east_register_vector_builtins(BuiltinRegistry *reg)
{
    builtin_registry_register(reg, "VectorLength", vector_length_factory);
    builtin_registry_register(reg, "VectorGet", vector_get_factory);
    builtin_registry_register(reg, "VectorSet", vector_set_factory);
    builtin_registry_register(reg, "VectorSlice", vector_slice_factory);
    builtin_registry_register(reg, "VectorConcat", vector_concat_factory);
    builtin_registry_register(reg, "VectorFromArray", vector_from_array_factory);
    builtin_registry_register(reg, "VectorToArray", vector_to_array_factory);
    builtin_registry_register(reg, "VectorToMatrix", vector_to_matrix_factory);
    builtin_registry_register(reg, "VectorZeros", vector_zeros_typed_factory);
    builtin_registry_register(reg, "VectorOnes", vector_ones_typed_factory);
    builtin_registry_register(reg, "VectorFill", vector_fill_typed_factory);
    builtin_registry_register(reg, "VectorMap", vector_map_factory);
    builtin_registry_register(reg, "VectorFold", vector_fold_factory);
    builtin_registry_register(reg, "VectorScale", vector_scale_factory);
    builtin_registry_register(reg, "VectorSum", vector_sum_factory);
    builtin_registry_register(reg, "VectorAddScaled", vector_add_scaled_factory);
    builtin_registry_register(reg, "VectorMul", vector_mul_factory);
    builtin_registry_register(reg, "VectorAddScalar", vector_add_scalar_factory);
    builtin_registry_register(reg, "VectorDot", vector_dot_factory);
    builtin_registry_register(reg, "VectorMax", vector_max_factory);
    builtin_registry_register(reg, "VectorMin", vector_min_factory);
    builtin_registry_register(reg, "VectorArgMax", vector_arg_max_factory);
    builtin_registry_register(reg, "VectorArgMin", vector_arg_min_factory);
    builtin_registry_register(reg, "VectorMean", vector_mean_factory);
    builtin_registry_register(reg, "VectorCumSum", vector_cum_sum_factory);
    builtin_registry_register(reg, "VectorAbs", vector_abs_factory);
    builtin_registry_register(reg, "VectorClamp", vector_clamp_factory);
    builtin_registry_register(reg, "VectorGather", vector_gather_factory);
    builtin_registry_register(reg, "VectorScatterAdd", vector_scatter_add_factory);
    builtin_registry_register(reg, "VectorSearchSorted", vector_search_sorted_factory);
    builtin_registry_register(reg, "VectorEq", vector_eq_factory);
    builtin_registry_register(reg, "VectorLt", vector_lt_factory);
    builtin_registry_register(reg, "VectorGt", vector_gt_factory);
    builtin_registry_register(reg, "VectorSelect", vector_select_factory);
    builtin_registry_register(reg, "VectorCompress", vector_compress_factory);
    builtin_registry_register(reg, "VectorCountTrue", vector_count_true_factory);
    builtin_registry_register(reg, "SparseAxpy", sparse_axpy_factory);
    builtin_registry_register(reg, "SparseFromPairs", sparse_from_pairs_factory);
    builtin_registry_register(reg, "SparseFilterGt", sparse_filter_gt_factory);
}
