# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""C-level iterative coordinate descent optimization.

Calls east_call directly for the objective function, avoiding Python
overhead in the inner optimization loop.
"""

from cpython.pycapsule cimport PyCapsule_New
from libc.stddef cimport size_t
from libc.stdint cimport int64_t
from libc.stdlib cimport malloc, free, realloc, rand, srand
from libc.string cimport strdup, memcpy
from libc.math cimport INFINITY

from east cimport _eastc


# ─── Implementation ────────────────────────────────────────────────────

cdef _eastc.EvalResult _optimization_iterative_impl(
        _eastc.EastValue **args, size_t num_args,
        _eastc.EastType **input_types, size_t num_input_types,
        _eastc.EastType *output_type) noexcept with gil:
    """C-level iterative coordinate descent.

    args[0] = objective_fn: Function(Vector<Integer>) -> Float
    args[1] = parameter_spaces: Array<Vector<Integer>>
    args[2] = config: Struct{iterations, samples, initial, order, random_state, mode}
    """
    cdef _eastc.EvalResult err
    err.status = _eastc.EVAL_ERROR
    err.value = NULL
    err.label = NULL
    err.error_message = NULL
    err.locations = NULL
    err.num_locations = 0

    if num_args < 3 or args[0] == NULL or args[1] == NULL or args[2] == NULL:
        err.error_message = strdup(b"optimization_iterative requires 3 arguments")
        return err

    cdef _eastc.EastValue *fn_val = args[0]
    cdef _eastc.EastValue *spaces_val = args[1]
    cdef _eastc.EastValue *config_val = args[2]

    if fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        err.error_message = strdup(b"optimization_iterative: first arg must be a function")
        return err
    if spaces_val.kind != _eastc.EAST_VAL_ARRAY:
        err.error_message = strdup(b"optimization_iterative: second arg must be an array")
        return err

    cdef _eastc.EastCompiledFn *compiled = fn_val.data.function.compiled
    cdef size_t n_dims = _eastc.east_array_len(spaces_val)

    # Extract config options
    cdef int max_iterations = 100
    cdef int num_samples = 1
    cdef bint use_random_init = False
    cdef bint use_random_order = False
    cdef bint use_swap = False
    cdef unsigned int seed = 42

    # Parse config struct fields
    cdef _eastc.EastValue *opt_val
    cdef _eastc.EastValue *inner_val

    opt_val = _eastc.east_struct_get_field(config_val, "iterations")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            max_iterations = <int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "samples")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            num_samples = <int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "random_state")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            seed = <unsigned int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "initial")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            # Check if inner variant tag is "random"
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b'r':  # "random"
                    use_random_init = True

    opt_val = _eastc.east_struct_get_field(config_val, "order")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b'r':  # "random"
                    use_random_order = True

    opt_val = _eastc.east_struct_get_field(config_val, "mode")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b's':  # "swap"
                    use_swap = True

    srand(seed)

    # Set thread context for east_call
    _eastc.east_set_thread_context(compiled.platform, compiled.builtins)

    # Get element type from first space's vector
    cdef _eastc.EastType *elem_type = &_eastc.east_integer_type
    cdef _eastc.EastValue *space0
    if n_dims > 0:
        space0 = _eastc.east_array_get(spaces_val, 0)
        if space0 != NULL and space0.kind == _eastc.EAST_VAL_VECTOR:
            elem_type = space0.data.vector.elem_type

    # Allocate space info: for each dim, store pointer to space vector
    cdef _eastc.EastValue **spaces = <_eastc.EastValue**>malloc(n_dims * sizeof(_eastc.EastValue*))
    if spaces == NULL:
        err.error_message = strdup(b"optimization_iterative: out of memory")
        return err

    cdef size_t i
    for i in range(n_dims):
        spaces[i] = _eastc.east_array_get(spaces_val, i)

    cdef double global_best_obj = -INFINITY
    cdef _eastc.EastValue *global_best_params = NULL
    cdef int total_iterations = 0
    cdef int total_evaluations = 0

    cdef _eastc.EastValue *params
    cdef _eastc.EvalResult call_result
    cdef double obj, best_obj
    cdef bint changed
    cdef size_t j, n_candidates
    cdef int64_t saved_val, candidate_val
    cdef int sample_idx, iter_idx
    cdef int64_t *param_data
    cdef _eastc.EastValue *sp
    cdef int64_t *sp_data
    cdef size_t sp_len
    cdef _eastc.EastValue *sample_best
    cdef int64_t current_best_val

    for sample_idx in range(num_samples):
        # Create initial parameter vector
        params = _eastc.east_vector_new(elem_type, n_dims)
        if params == NULL:
            free(spaces)
            err.error_message = strdup(b"optimization_iterative: vector alloc failed")
            return err

        # Initialize params
        param_data = <int64_t*>params.data.vector.data
        if use_swap:
            # Swap mode: init with sorted candidates, then Fisher-Yates shuffle
            sp = spaces[0]
            sp_data = <int64_t*>sp.data.vector.data
            sp_len = sp.data.vector.len
            # Copy sorted candidates
            for i in range(n_dims):
                if i < sp_len:
                    param_data[i] = sp_data[i]
            # Sort (insertion sort — small n)
            for i in range(1, n_dims):
                saved_val = param_data[i]
                j = i
                while j > 0 and param_data[j - 1] > saved_val:
                    param_data[j] = param_data[j - 1]
                    j -= 1
                param_data[j] = saved_val
            # Fisher-Yates shuffle if random init
            if use_random_init:
                for i in range(n_dims - 1, 0, -1):
                    j = rand() % (i + 1)
                    saved_val = param_data[i]
                    param_data[i] = param_data[j]
                    param_data[j] = saved_val
        else:
            for i in range(n_dims):
                sp = spaces[i]
                sp_data = <int64_t*>sp.data.vector.data
                sp_len = sp.data.vector.len
                if use_random_init and sp_len > 0:
                    param_data[i] = sp_data[rand() % sp_len]
                elif sp_len > 0:
                    param_data[i] = sp_data[0]

        # Evaluate initial
        call_result = _eastc.east_call(compiled, &params, 1)
        if call_result.status != _eastc.EVAL_OK and call_result.status != _eastc.EVAL_RETURN:
            _eastc.east_value_release(params)
            free(spaces)
            return call_result
        best_obj = call_result.value.data.float64
        _eastc.east_value_release(call_result.value)
        total_evaluations += 1

        # Save best params for this sample
        sample_best = _eastc.east_vector_new(elem_type, n_dims)
        memcpy(sample_best.data.vector.data, param_data, n_dims * sizeof(int64_t))

        for iter_idx in range(max_iterations):
            changed = False

            if use_swap:
                for i in range(n_dims):
                    for j in range(i + 1, n_dims):
                        # Swap
                        saved_val = param_data[i]
                        param_data[i] = param_data[j]
                        param_data[j] = saved_val

                        call_result = _eastc.east_call(compiled, &params, 1)
                        if call_result.status != _eastc.EVAL_OK and call_result.status != _eastc.EVAL_RETURN:
                            _eastc.east_value_release(params)
                            _eastc.east_value_release(sample_best)
                            if global_best_params != NULL:
                                _eastc.east_value_release(global_best_params)
                            free(spaces)
                            return call_result
                        obj = call_result.value.data.float64
                        _eastc.east_value_release(call_result.value)
                        total_evaluations += 1

                        if obj > best_obj:
                            best_obj = obj
                            memcpy(sample_best.data.vector.data, param_data, n_dims * sizeof(int64_t))
                            changed = True
                        else:
                            # Undo swap
                            param_data[j] = param_data[i]
                            param_data[i] = saved_val
            else:
                # Coordinate descent
                for i in range(n_dims):
                    sp = spaces[i]
                    sp_data = <int64_t*>sp.data.vector.data
                    sp_len = sp.data.vector.len
                    current_best_val = param_data[i]

                    for j in range(sp_len):
                        candidate_val = sp_data[j]
                        param_data[i] = candidate_val

                        call_result = _eastc.east_call(compiled, &params, 1)
                        if call_result.status != _eastc.EVAL_OK and call_result.status != _eastc.EVAL_RETURN:
                            _eastc.east_value_release(params)
                            _eastc.east_value_release(sample_best)
                            if global_best_params != NULL:
                                _eastc.east_value_release(global_best_params)
                            free(spaces)
                            return call_result
                        obj = call_result.value.data.float64
                        _eastc.east_value_release(call_result.value)
                        total_evaluations += 1

                        if obj > best_obj:
                            best_obj = obj
                            memcpy(sample_best.data.vector.data, param_data, n_dims * sizeof(int64_t))
                            current_best_val = candidate_val
                            changed = True

                    param_data[i] = current_best_val

            total_iterations += 1
            if not changed:
                break

        # Update global best
        if best_obj > global_best_obj:
            global_best_obj = best_obj
            if global_best_params != NULL:
                _eastc.east_value_release(global_best_params)
            global_best_params = sample_best
        else:
            _eastc.east_value_release(sample_best)

        _eastc.east_value_release(params)

    free(spaces)

    # Build result struct
    cdef const char **field_names = <const char**>malloc(5 * sizeof(const char*))
    cdef _eastc.EastValue **field_values = <_eastc.EastValue**>malloc(5 * sizeof(_eastc.EastValue*))

    field_names[0] = "best_parameters"
    field_names[1] = "best_objective"
    field_names[2] = "iterations"
    field_names[3] = "evaluations"
    field_names[4] = "success"

    if global_best_params != NULL:
        field_values[0] = global_best_params
    else:
        field_values[0] = _eastc.east_vector_new(elem_type, 0)
    field_values[1] = _eastc.east_float(global_best_obj if global_best_params != NULL else 0.0)
    field_values[2] = _eastc.east_integer(total_iterations)
    field_values[3] = _eastc.east_integer(total_evaluations)
    field_values[4] = _eastc.east_boolean(global_best_params != NULL)

    cdef _eastc.EastValue *result = _eastc.east_struct_new(
        field_names, field_values, 5, output_type)

    free(field_names)
    free(field_values)

    return _eastc.eval_ok(result)


# ─── Inline C for incremental pthread worker ──────────────────────────

cdef extern from *:
    """
    #include <pthread.h>
    #include <stdlib.h>
    #include <string.h>
    #include <math.h>
    #include "east/compiler.h"
    #include "east/values.h"
    #include "east/eval_result.h"

    /* xorshift32 — deterministic per-thread PRNG */
    static unsigned int _incr_rand(unsigned int *state) {
        unsigned int x = *state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *state = x;
        return x;
    }

    typedef struct {
        /* shared read-only */
        EastCompiledFn *compiled;
        EastValue      **spaces;
        size_t           n_dims;
        EastType        *elem_type;
        int              max_iterations;
        int              use_random_init;
        int              use_swap;
        unsigned int     seed;
        PlatformRegistry *platform;
        BuiltinRegistry  *builtins;
        /* per-thread output */
        double       best_obj;
        EastValue   *best_params;
        int          iterations;
        int          evaluations;
        int          had_error;
        EvalResult   error_result;
    } IncrSampleWork;

    /* Evaluate element contribution: fn(params, idx) -> float */
    static double _eval_elem(EastCompiledFn *compiled, EastValue *params,
                             EastValue *idx_val, int64_t idx, EvalResult *err) {
        idx_val->data.integer = idx;
        EastValue *call_args[2] = { params, idx_val };
        EvalResult r = east_call(compiled, call_args, 2);
        if (r.status != EVAL_OK && r.status != EVAL_RETURN) {
            *err = r;
            return 0.0;
        }
        double val = r.value->data.float64;
        east_value_release(r.value);
        err->status = EVAL_OK;
        return val;
    }

    static void *_incr_sample_worker(void *arg) {
        IncrSampleWork *w = (IncrSampleWork *)arg;
        east_set_thread_context(w->platform, w->builtins);

        size_t n = w->n_dims;
        unsigned int rng = w->seed;

        EastValue *params = east_vector_new(w->elem_type, n);
        if (!params) {
            w->had_error = 1;
            w->error_result = eval_error("incremental: vector alloc failed");
            return NULL;
        }
        int64_t *pdata = (int64_t *)params->data.vector.data;

        double *contribs = (double *)malloc(n * sizeof(double));
        if (!contribs) {
            east_value_release(params);
            w->had_error = 1;
            w->error_result = eval_error("incremental: alloc failed");
            return NULL;
        }

        /* scratch index value — mutated in place */
        EastValue *idx_val = east_integer(0);
        EvalResult tmp_err;
        tmp_err.status = EVAL_OK;

        /* initialise parameters */
        if (w->use_swap) {
            EastValue *sp0 = w->spaces[0];
            int64_t *sp_data = (int64_t *)sp0->data.vector.data;
            size_t sp_len = sp0->data.vector.len;
            for (size_t i = 0; i < n; i++)
                pdata[i] = (i < sp_len) ? sp_data[i] : 0;
            /* insertion sort */
            for (size_t i = 1; i < n; i++) {
                int64_t v = pdata[i];
                size_t j = i;
                while (j > 0 && pdata[j - 1] > v) { pdata[j] = pdata[j - 1]; j--; }
                pdata[j] = v;
            }
            if (w->use_random_init) {
                for (size_t i = n - 1; i > 0; i--) {
                    size_t j = _incr_rand(&rng) % (i + 1);
                    int64_t t = pdata[i]; pdata[i] = pdata[j]; pdata[j] = t;
                }
            }
        } else {
            for (size_t i = 0; i < n; i++) {
                EastValue *sp = w->spaces[i];
                int64_t *sp_data = (int64_t *)sp->data.vector.data;
                size_t sp_len = sp->data.vector.len;
                if (w->use_random_init && sp_len > 0)
                    pdata[i] = sp_data[_incr_rand(&rng) % sp_len];
                else if (sp_len > 0)
                    pdata[i] = sp_data[0];
            }
        }

        /* compute initial contributions */
        double total = 0.0;
        for (size_t i = 0; i < n; i++) {
            tmp_err.status = EVAL_OK;
            contribs[i] = _eval_elem(w->compiled, params, idx_val, (int64_t)i, &tmp_err);
            if (tmp_err.status != EVAL_OK) goto error;
            total += contribs[i];
            w->evaluations++;
        }

        double best_obj = total;
        EastValue *sample_best = east_vector_new(w->elem_type, n);
        memcpy(sample_best->data.vector.data, pdata, n * sizeof(int64_t));

        /* optimisation loop */
        for (int iter = 0; iter < w->max_iterations; iter++) {
            int changed = 0;

            if (w->use_swap) {
                for (size_t i = 0; i < n; i++) {
                    for (size_t j = i + 1; j < n; j++) {
                        double old_ci = contribs[i], old_cj = contribs[j];

                        /* swap */
                        int64_t tmp = pdata[i]; pdata[i] = pdata[j]; pdata[j] = tmp;

                        tmp_err.status = EVAL_OK;
                        double new_ci = _eval_elem(w->compiled, params, idx_val,
                                                   (int64_t)i, &tmp_err);
                        if (tmp_err.status != EVAL_OK) {
                            east_value_release(sample_best);
                            goto error;
                        }
                        w->evaluations++;

                        tmp_err.status = EVAL_OK;
                        double new_cj = _eval_elem(w->compiled, params, idx_val,
                                                   (int64_t)j, &tmp_err);
                        if (tmp_err.status != EVAL_OK) {
                            east_value_release(sample_best);
                            goto error;
                        }
                        w->evaluations++;

                        double new_total = total - old_ci - old_cj + new_ci + new_cj;
                        if (new_total > best_obj) {
                            best_obj = new_total;
                            total = new_total;
                            contribs[i] = new_ci;
                            contribs[j] = new_cj;
                            memcpy(sample_best->data.vector.data, pdata,
                                   n * sizeof(int64_t));
                            changed = 1;
                        } else {
                            /* undo swap */
                            pdata[j] = pdata[i]; pdata[i] = tmp;
                        }
                    }
                }
            } else {
                /* coordinate descent */
                for (size_t i = 0; i < n; i++) {
                    EastValue *sp = w->spaces[i];
                    int64_t *sp_data = (int64_t *)sp->data.vector.data;
                    size_t sp_len = sp->data.vector.len;

                    double old_contrib = contribs[i];
                    int64_t best_val = pdata[i];
                    double best_contrib = old_contrib;

                    for (size_t c = 0; c < sp_len; c++) {
                        pdata[i] = sp_data[c];
                        tmp_err.status = EVAL_OK;
                        double new_contrib = _eval_elem(w->compiled, params,
                                                        idx_val, (int64_t)i, &tmp_err);
                        if (tmp_err.status != EVAL_OK) {
                            east_value_release(sample_best);
                            goto error;
                        }
                        w->evaluations++;

                        double new_total = total - old_contrib + new_contrib;
                        if (new_total > best_obj) {
                            best_obj = new_total;
                            best_val = sp_data[c];
                            best_contrib = new_contrib;
                            changed = 1;
                        }
                    }

                    pdata[i] = best_val;
                    total = total - old_contrib + best_contrib;
                    contribs[i] = best_contrib;

                    if (changed)
                        memcpy(sample_best->data.vector.data, pdata,
                               n * sizeof(int64_t));
                }
            }

            w->iterations++;
            if (!changed) break;
        }

        w->best_obj = best_obj;
        w->best_params = sample_best;
        east_value_release(params);
        east_value_release(idx_val);
        free(contribs);
        return NULL;

    error:
        east_value_release(params);
        east_value_release(idx_val);
        free(contribs);
        w->had_error = 1;
        w->error_result = tmp_err;
        return NULL;
    }
    """
    ctypedef struct IncrSampleWork:
        _eastc.EastCompiledFn *compiled
        _eastc.EastValue **spaces
        size_t n_dims
        _eastc.EastType *elem_type
        int max_iterations
        int use_random_init
        int use_swap
        unsigned int seed
        _eastc.PlatformRegistry *platform
        _eastc.BuiltinRegistry *builtins
        double best_obj
        _eastc.EastValue *best_params
        int iterations
        int evaluations
        int had_error
        _eastc.EvalResult error_result

    void *_incr_sample_worker(void *arg) nogil

    ctypedef unsigned long pthread_t
    int pthread_create(pthread_t *thread, void *attr,
                       void *(*start_routine)(void*), void *arg) nogil
    int pthread_join(pthread_t thread, void **retval) nogil


# ─── Incremental implementation ───────────────────────────────────────

cdef _eastc.EvalResult _optimization_iterative_incremental_impl(
        _eastc.EastValue **args, size_t num_args,
        _eastc.EastType **input_types, size_t num_input_types,
        _eastc.EastType *output_type) noexcept with gil:
    """Incremental iterative optimisation with per-element contributions
    and multi-threaded sample parallelism."""
    cdef _eastc.EvalResult err
    err.status = _eastc.EVAL_ERROR
    err.value = NULL
    err.label = NULL
    err.error_message = NULL
    err.locations = NULL
    err.num_locations = 0

    if num_args < 3 or args[0] == NULL or args[1] == NULL or args[2] == NULL:
        err.error_message = strdup(b"iterative_incremental requires 3 arguments")
        return err

    cdef _eastc.EastValue *fn_val = args[0]
    cdef _eastc.EastValue *spaces_val = args[1]
    cdef _eastc.EastValue *config_val = args[2]

    if fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        err.error_message = strdup(b"iterative_incremental: arg 0 must be function")
        return err
    if spaces_val.kind != _eastc.EAST_VAL_ARRAY:
        err.error_message = strdup(b"iterative_incremental: arg 1 must be array")
        return err

    cdef _eastc.EastCompiledFn *compiled = fn_val.data.function.compiled
    cdef size_t n_dims = _eastc.east_array_len(spaces_val)

    # ── parse config ──────────────────────────────────────────────────
    cdef int max_iterations = 100
    cdef int num_samples = 1
    cdef bint use_random_init = False
    cdef bint use_swap = False
    cdef unsigned int seed = 42

    cdef _eastc.EastValue *opt_val
    cdef _eastc.EastValue *inner_val

    opt_val = _eastc.east_struct_get_field(config_val, "iterations")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            max_iterations = <int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "samples")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            num_samples = <int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "random_state")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            seed = <unsigned int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "initial")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b'r':
                    use_random_init = True

    opt_val = _eastc.east_struct_get_field(config_val, "mode")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b's':
                    use_swap = True

    # ── extract spaces ────────────────────────────────────────────────
    cdef _eastc.EastType *elem_type = &_eastc.east_integer_type
    cdef _eastc.EastValue *space0
    if n_dims > 0:
        space0 = _eastc.east_array_get(spaces_val, 0)
        if space0 != NULL and space0.kind == _eastc.EAST_VAL_VECTOR:
            elem_type = space0.data.vector.elem_type

    cdef _eastc.EastValue **spaces = <_eastc.EastValue**>malloc(n_dims * sizeof(_eastc.EastValue*))
    if spaces == NULL:
        err.error_message = strdup(b"iterative_incremental: out of memory")
        return err
    cdef size_t i
    for i in range(n_dims):
        spaces[i] = _eastc.east_array_get(spaces_val, i)

    # ── allocate sample work units ────────────────────────────────────
    cdef IncrSampleWork *work = <IncrSampleWork*>malloc(num_samples * sizeof(IncrSampleWork))
    if work == NULL:
        free(spaces)
        err.error_message = strdup(b"iterative_incremental: out of memory")
        return err

    cdef int s
    for s in range(num_samples):
        work[s].compiled = compiled
        work[s].spaces = spaces
        work[s].n_dims = n_dims
        work[s].elem_type = elem_type
        work[s].max_iterations = max_iterations
        work[s].use_random_init = use_random_init
        work[s].use_swap = use_swap
        work[s].seed = seed + <unsigned int>s
        work[s].platform = compiled.platform
        work[s].builtins = compiled.builtins
        work[s].best_obj = -INFINITY
        work[s].best_params = NULL
        work[s].iterations = 0
        work[s].evaluations = 0
        work[s].had_error = 0

    # ── run samples ───────────────────────────────────────────────────
    for s in range(num_samples):
        _incr_sample_worker(&work[s])

    # ── collect results ───────────────────────────────────────────────
    cdef double global_best_obj = -INFINITY
    cdef _eastc.EastValue *global_best_params = NULL
    cdef int total_iterations = 0
    cdef int total_evaluations = 0
    cdef int k

    for s in range(num_samples):
        if work[s].had_error:
            for k in range(num_samples):
                if k != s and work[k].best_params != NULL:
                    _eastc.east_value_release(work[k].best_params)
            err = work[s].error_result
            free(work)
            free(spaces)
            return err

        total_iterations += work[s].iterations
        total_evaluations += work[s].evaluations

        if work[s].best_obj > global_best_obj:
            if global_best_params != NULL:
                _eastc.east_value_release(global_best_params)
            global_best_obj = work[s].best_obj
            global_best_params = work[s].best_params
        elif work[s].best_params != NULL:
            _eastc.east_value_release(work[s].best_params)

    free(work)
    free(spaces)

    # ── build result struct ───────────────────────────────────────────
    cdef const char **field_names = <const char**>malloc(5 * sizeof(const char*))
    cdef _eastc.EastValue **field_values = <_eastc.EastValue**>malloc(5 * sizeof(_eastc.EastValue*))

    field_names[0] = "best_parameters"
    field_names[1] = "best_objective"
    field_names[2] = "iterations"
    field_names[3] = "evaluations"
    field_names[4] = "success"

    if global_best_params != NULL:
        field_values[0] = global_best_params
    else:
        field_values[0] = _eastc.east_vector_new(elem_type, 0)
    field_values[1] = _eastc.east_float(global_best_obj if global_best_params != NULL else 0.0)
    field_values[2] = _eastc.east_integer(total_iterations)
    field_values[3] = _eastc.east_integer(total_evaluations)
    field_values[4] = _eastc.east_boolean(global_best_params != NULL)

    cdef _eastc.EastValue *result = _eastc.east_struct_new(
        field_names, field_values, 5, output_type)

    free(field_names)
    free(field_values)

    return _eastc.eval_ok(result)


# ─── Inline C for grouped pthread worker ──────────────────────────────

cdef extern from *:
    """
    #include <pthread.h>
    #include <stdlib.h>
    #include <string.h>
    #include <math.h>
    #include "east/compiler.h"
    #include "east/values.h"
    #include "east/eval_result.h"

    /* Forward declarations from incremental block */
    static unsigned int _incr_rand(unsigned int *state);
    static double _eval_elem(EastCompiledFn *compiled, EastValue *params,
                             EastValue *idx_val, int64_t idx, EvalResult *err);

    typedef struct {
        /* shared read-only */
        EastCompiledFn *compiled;
        EastValue      **spaces;
        size_t           n_dims;
        EastType        *elem_type;
        int              max_iterations;
        int              use_random_init;
        int              use_swap;
        unsigned int     seed;
        PlatformRegistry *platform;
        BuiltinRegistry  *builtins;
        /* unique group values (shared read-only) */
        int64_t         *group_keys;
        size_t           n_groups;
        /* per-thread output */
        double       best_obj;
        EastValue   *best_params;
        int          iterations;
        int          evaluations;
        int          had_error;
        EvalResult   error_result;
    } GroupSampleWork;

    /* Find index of value in group_keys array, or -1 */
    static int _find_group(int64_t *keys, size_t n, int64_t val) {
        for (size_t i = 0; i < n; i++)
            if (keys[i] == val) return (int)i;
        return -1;
    }

    static void *_grouped_sample_worker(void *arg) {
        GroupSampleWork *w = (GroupSampleWork *)arg;
        east_set_thread_context(w->platform, w->builtins);

        size_t n = w->n_dims;
        size_t ng = w->n_groups;
        unsigned int rng = w->seed;

        EastValue *params = east_vector_new(w->elem_type, n);
        if (!params) {
            w->had_error = 1;
            w->error_result = eval_error("grouped: vector alloc failed");
            return NULL;
        }
        int64_t *pdata = (int64_t *)params->data.vector.data;

        double *gcontribs = (double *)malloc(ng * sizeof(double));
        if (!gcontribs) {
            east_value_release(params);
            w->had_error = 1;
            w->error_result = eval_error("grouped: alloc failed");
            return NULL;
        }

        EastValue *idx_val = east_integer(0);
        EvalResult tmp_err;
        tmp_err.status = EVAL_OK;

        /* initialise parameters (same as incremental) */
        if (w->use_swap) {
            EastValue *sp0 = w->spaces[0];
            int64_t *sp_data = (int64_t *)sp0->data.vector.data;
            size_t sp_len = sp0->data.vector.len;
            for (size_t i = 0; i < n; i++)
                pdata[i] = (i < sp_len) ? sp_data[i] : 0;
            for (size_t i = 1; i < n; i++) {
                int64_t v = pdata[i];
                size_t j = i;
                while (j > 0 && pdata[j - 1] > v) { pdata[j] = pdata[j - 1]; j--; }
                pdata[j] = v;
            }
            if (w->use_random_init) {
                for (size_t i = n - 1; i > 0; i--) {
                    size_t j = _incr_rand(&rng) % (i + 1);
                    int64_t t = pdata[i]; pdata[i] = pdata[j]; pdata[j] = t;
                }
            }
        } else {
            for (size_t i = 0; i < n; i++) {
                EastValue *sp = w->spaces[i];
                int64_t *sp_data = (int64_t *)sp->data.vector.data;
                size_t sp_len = sp->data.vector.len;
                if (w->use_random_init && sp_len > 0)
                    pdata[i] = sp_data[_incr_rand(&rng) % sp_len];
                else if (sp_len > 0)
                    pdata[i] = sp_data[0];
            }
        }

        /* compute initial group contributions */
        double total = 0.0;
        for (size_t g = 0; g < ng; g++) {
            tmp_err.status = EVAL_OK;
            gcontribs[g] = _eval_elem(w->compiled, params, idx_val,
                                       w->group_keys[g], &tmp_err);
            if (tmp_err.status != EVAL_OK) goto error;
            total += gcontribs[g];
            w->evaluations++;
        }

        double best_obj = total;
        EastValue *sample_best = east_vector_new(w->elem_type, n);
        memcpy(sample_best->data.vector.data, pdata, n * sizeof(int64_t));

        /* optimisation loop */
        for (int iter = 0; iter < w->max_iterations; iter++) {
            int changed = 0;

            if (w->use_swap) {
                for (size_t i = 0; i < n; i++) {
                    for (size_t j = i + 1; j < n; j++) {
                        int64_t val_i = pdata[i], val_j = pdata[j];
                        if (val_i == val_j) continue;  /* same group, no effect */

                        int gi = _find_group(w->group_keys, ng, val_i);
                        int gj = _find_group(w->group_keys, ng, val_j);
                        double old_gi = gcontribs[gi], old_gj = gcontribs[gj];

                        /* swap */
                        pdata[i] = val_j; pdata[j] = val_i;

                        tmp_err.status = EVAL_OK;
                        double new_gi = _eval_elem(w->compiled, params, idx_val,
                                                   val_i, &tmp_err);
                        if (tmp_err.status != EVAL_OK) {
                            east_value_release(sample_best);
                            goto error;
                        }
                        w->evaluations++;

                        tmp_err.status = EVAL_OK;
                        double new_gj = _eval_elem(w->compiled, params, idx_val,
                                                   val_j, &tmp_err);
                        if (tmp_err.status != EVAL_OK) {
                            east_value_release(sample_best);
                            goto error;
                        }
                        w->evaluations++;

                        double new_total = total - old_gi - old_gj + new_gi + new_gj;
                        if (new_total > best_obj) {
                            best_obj = new_total;
                            total = new_total;
                            gcontribs[gi] = new_gi;
                            gcontribs[gj] = new_gj;
                            memcpy(sample_best->data.vector.data, pdata,
                                   n * sizeof(int64_t));
                            changed = 1;
                        } else {
                            /* undo swap */
                            pdata[i] = val_i; pdata[j] = val_j;
                        }
                    }
                }
            } else {
                /* coordinate descent */
                for (size_t i = 0; i < n; i++) {
                    EastValue *sp = w->spaces[i];
                    int64_t *sp_data = (int64_t *)sp->data.vector.data;
                    size_t sp_len = sp->data.vector.len;

                    int64_t old_val = pdata[i];
                    int g_old = _find_group(w->group_keys, ng, old_val);
                    double saved_old_contrib = gcontribs[g_old];

                    int64_t best_val = old_val;
                    /* track best contributions for both affected groups */
                    double best_old_g = saved_old_contrib;
                    double best_new_g = 0.0;
                    int best_g_new_idx = -1;

                    for (size_t c = 0; c < sp_len; c++) {
                        int64_t cand = sp_data[c];
                        if (cand == pdata[i] && cand == old_val) {
                            /* no change from current best or original — already evaluated */
                        }
                        pdata[i] = cand;

                        int g_new = _find_group(w->group_keys, ng, cand);

                        double trial_total;
                        if (g_new == g_old) {
                            /* same group: recompute just that one group */
                            tmp_err.status = EVAL_OK;
                            double gc = _eval_elem(w->compiled, params, idx_val,
                                                    cand, &tmp_err);
                            if (tmp_err.status != EVAL_OK) {
                                east_value_release(sample_best);
                                goto error;
                            }
                            w->evaluations++;
                            trial_total = total - saved_old_contrib + gc;
                            if (trial_total > best_obj) {
                                best_obj = trial_total;
                                best_val = cand;
                                best_old_g = gc;
                                best_g_new_idx = -1;  /* same group */
                                changed = 1;
                            }
                        } else {
                            /* different groups: recompute both */
                            tmp_err.status = EVAL_OK;
                            double gc_old = _eval_elem(w->compiled, params, idx_val,
                                                        old_val, &tmp_err);
                            if (tmp_err.status != EVAL_OK) {
                                east_value_release(sample_best);
                                goto error;
                            }
                            w->evaluations++;

                            tmp_err.status = EVAL_OK;
                            double gc_new = _eval_elem(w->compiled, params, idx_val,
                                                        cand, &tmp_err);
                            if (tmp_err.status != EVAL_OK) {
                                east_value_release(sample_best);
                                goto error;
                            }
                            w->evaluations++;

                            trial_total = total - saved_old_contrib - gcontribs[g_new]
                                          + gc_old + gc_new;
                            if (trial_total > best_obj) {
                                best_obj = trial_total;
                                best_val = cand;
                                best_old_g = gc_old;
                                best_new_g = gc_new;
                                best_g_new_idx = g_new;
                                changed = 1;
                            }
                        }
                    }

                    /* apply best for this position */
                    pdata[i] = best_val;
                    gcontribs[g_old] = best_old_g;
                    if (best_g_new_idx >= 0)
                        gcontribs[best_g_new_idx] = best_new_g;
                    /* recalc total from contributions */
                    total = 0.0;
                    for (size_t g = 0; g < ng; g++) total += gcontribs[g];

                    if (changed)
                        memcpy(sample_best->data.vector.data, pdata,
                               n * sizeof(int64_t));
                }
            }

            w->iterations++;
            if (!changed) break;
        }

        w->best_obj = best_obj;
        w->best_params = sample_best;
        east_value_release(params);
        east_value_release(idx_val);
        free(gcontribs);
        return NULL;

    error:
        east_value_release(params);
        east_value_release(idx_val);
        free(gcontribs);
        w->had_error = 1;
        w->error_result = tmp_err;
        return NULL;
    }
    """
    ctypedef struct GroupSampleWork:
        _eastc.EastCompiledFn *compiled
        _eastc.EastValue **spaces
        size_t n_dims
        _eastc.EastType *elem_type
        int max_iterations
        int use_random_init
        int use_swap
        unsigned int seed
        _eastc.PlatformRegistry *platform
        _eastc.BuiltinRegistry *builtins
        int64_t *group_keys
        size_t n_groups
        double best_obj
        _eastc.EastValue *best_params
        int iterations
        int evaluations
        int had_error
        _eastc.EvalResult error_result

    void *_grouped_sample_worker(void *arg) nogil


# ─── Grouped implementation ───────────────────────────────────────────

cdef _eastc.EvalResult _optimization_iterative_grouped_impl(
        _eastc.EastValue **args, size_t num_args,
        _eastc.EastType **input_types, size_t num_input_types,
        _eastc.EastType *output_type) noexcept with gil:
    """Group-based iterative optimisation with per-value contributions
    and multi-threaded sample parallelism."""
    cdef _eastc.EvalResult err
    err.status = _eastc.EVAL_ERROR
    err.value = NULL
    err.label = NULL
    err.error_message = NULL
    err.locations = NULL
    err.num_locations = 0

    if num_args < 3 or args[0] == NULL or args[1] == NULL or args[2] == NULL:
        err.error_message = strdup(b"iterative_grouped requires 3 arguments")
        return err

    cdef _eastc.EastValue *fn_val = args[0]
    cdef _eastc.EastValue *spaces_val = args[1]
    cdef _eastc.EastValue *config_val = args[2]

    if fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        err.error_message = strdup(b"iterative_grouped: arg 0 must be function")
        return err
    if spaces_val.kind != _eastc.EAST_VAL_ARRAY:
        err.error_message = strdup(b"iterative_grouped: arg 1 must be array")
        return err

    cdef _eastc.EastCompiledFn *compiled = fn_val.data.function.compiled
    cdef size_t n_dims = _eastc.east_array_len(spaces_val)

    # ── parse config (same as incremental) ────────────────────────────
    cdef int max_iterations = 100
    cdef int num_samples = 1
    cdef bint use_random_init = False
    cdef bint use_swap = False
    cdef unsigned int seed = 42

    cdef _eastc.EastValue *opt_val
    cdef _eastc.EastValue *inner_val

    opt_val = _eastc.east_struct_get_field(config_val, "iterations")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            max_iterations = <int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "samples")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            num_samples = <int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "random_state")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            seed = <unsigned int>opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config_val, "initial")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b'r':
                    use_random_init = True

    opt_val = _eastc.east_struct_get_field(config_val, "mode")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        inner_val = opt_val.data.variant.value
        if inner_val != NULL and inner_val.kind == _eastc.EAST_VAL_VARIANT:
            if inner_val.data.variant.case_tag != NULL:
                if inner_val.data.variant.case_tag[0] == b's':
                    use_swap = True

    # ── extract spaces ────────────────────────────────────────────────
    cdef _eastc.EastType *elem_type = &_eastc.east_integer_type
    cdef _eastc.EastValue *sp0
    if n_dims > 0:
        sp0 = _eastc.east_array_get(spaces_val, 0)
        if sp0 != NULL and sp0.kind == _eastc.EAST_VAL_VECTOR:
            elem_type = sp0.data.vector.elem_type

    cdef _eastc.EastValue **spaces = <_eastc.EastValue**>malloc(n_dims * sizeof(_eastc.EastValue*))
    if spaces == NULL:
        err.error_message = strdup(b"iterative_grouped: out of memory")
        return err
    cdef size_t i, j, g
    for i in range(n_dims):
        spaces[i] = _eastc.east_array_get(spaces_val, i)

    # ── collect unique group keys from all spaces ─────────────────────
    cdef int64_t *group_keys = <int64_t*>malloc(1024 * sizeof(int64_t))
    cdef size_t n_groups = 0
    cdef size_t group_cap = 1024
    cdef int64_t *sp_data
    cdef size_t sp_len
    cdef bint found

    for i in range(n_dims):
        sp_data = <int64_t*>spaces[i].data.vector.data
        sp_len = spaces[i].data.vector.len
        for j in range(sp_len):
            found = False
            for g in range(n_groups):
                if group_keys[g] == sp_data[j]:
                    found = True
                    break
            if not found:
                if n_groups >= group_cap:
                    group_cap *= 2
                    group_keys = <int64_t*>realloc(group_keys, group_cap * sizeof(int64_t))
                group_keys[n_groups] = sp_data[j]
                n_groups += 1

    # ── allocate sample work units ────────────────────────────────────
    cdef GroupSampleWork *work = <GroupSampleWork*>malloc(num_samples * sizeof(GroupSampleWork))
    if work == NULL:
        free(spaces)
        free(group_keys)
        err.error_message = strdup(b"iterative_grouped: out of memory")
        return err

    cdef int s
    for s in range(num_samples):
        work[s].compiled = compiled
        work[s].spaces = spaces
        work[s].n_dims = n_dims
        work[s].elem_type = elem_type
        work[s].max_iterations = max_iterations
        work[s].use_random_init = use_random_init
        work[s].use_swap = use_swap
        work[s].seed = seed + <unsigned int>s
        work[s].platform = compiled.platform
        work[s].builtins = compiled.builtins
        work[s].group_keys = group_keys
        work[s].n_groups = n_groups
        work[s].best_obj = -INFINITY
        work[s].best_params = NULL
        work[s].iterations = 0
        work[s].evaluations = 0
        work[s].had_error = 0

    # ── run samples ───────────────────────────────────────────────────
    for s in range(num_samples):
        _grouped_sample_worker(&work[s])

    # ── collect results ───────────────────────────────────────────────
    cdef double global_best_obj = -INFINITY
    cdef _eastc.EastValue *global_best_params = NULL
    cdef int total_iterations = 0
    cdef int total_evaluations = 0
    cdef int k

    for s in range(num_samples):
        if work[s].had_error:
            for k in range(num_samples):
                if k != s and work[k].best_params != NULL:
                    _eastc.east_value_release(work[k].best_params)
            err = work[s].error_result
            free(work)
            free(spaces)
            free(group_keys)
            return err

        total_iterations += work[s].iterations
        total_evaluations += work[s].evaluations

        if work[s].best_obj > global_best_obj:
            if global_best_params != NULL:
                _eastc.east_value_release(global_best_params)
            global_best_obj = work[s].best_obj
            global_best_params = work[s].best_params
        elif work[s].best_params != NULL:
            _eastc.east_value_release(work[s].best_params)

    free(work)
    free(spaces)
    free(group_keys)

    # ── build result struct ───────────────────────────────────────────
    cdef const char **field_names = <const char**>malloc(5 * sizeof(const char*))
    cdef _eastc.EastValue **field_values = <_eastc.EastValue**>malloc(5 * sizeof(_eastc.EastValue*))

    field_names[0] = "best_parameters"
    field_names[1] = "best_objective"
    field_names[2] = "iterations"
    field_names[3] = "evaluations"
    field_names[4] = "success"

    if global_best_params != NULL:
        field_values[0] = global_best_params
    else:
        field_values[0] = _eastc.east_vector_new(elem_type, 0)
    field_values[1] = _eastc.east_float(global_best_obj if global_best_params != NULL else 0.0)
    field_values[2] = _eastc.east_integer(total_iterations)
    field_values[3] = _eastc.east_integer(total_evaluations)
    field_values[4] = _eastc.east_boolean(global_best_params != NULL)

    cdef _eastc.EastValue *result = _eastc.east_struct_new(
        field_names, field_values, 5, output_type)

    free(field_names)
    free(field_values)

    return _eastc.eval_ok(result)


# ─── PyCapsule exports ────────────────────────────────────────────────

optimization_iterative_capsule = PyCapsule_New(
    <void*>_optimization_iterative_impl, "east_platform_fn", NULL
)

optimization_iterative_incremental_capsule = PyCapsule_New(
    <void*>_optimization_iterative_incremental_impl, "east_platform_fn", NULL
)

optimization_iterative_grouped_capsule = PyCapsule_New(
    <void*>_optimization_iterative_grouped_impl, "east_platform_fn", NULL
)
