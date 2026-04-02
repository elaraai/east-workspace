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
from libc.stdlib cimport malloc, free, rand, srand
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


# ─── PyCapsule export ───────────────────────────────────────────────────

optimization_iterative_capsule = PyCapsule_New(
    <void*>_optimization_iterative_impl, "east_platform_fn", NULL
)
