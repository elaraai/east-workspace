# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""C-level parallel_map using pthreads for true parallelism.

Calls east_call directly from C threads without the GIL, enabling
genuine parallel execution of East functions compiled by east-c.
"""

from cpython.pycapsule cimport PyCapsule_New
from libc.stddef cimport size_t
from libc.stdlib cimport malloc, free
from libc.string cimport strdup

from east cimport _eastc


# ─── Inline C for pthread worker ────────────────────────────────────────

cdef extern from *:
    """
    #include <pthread.h>
    #include <stdlib.h>
    #include "east/compiler.h"
    #include "east/values.h"

    typedef struct {
        EastCompiledFn *fn;
        EastValue **inputs;
        EastValue **outputs;
        EvalResult *errors;
        size_t start;
        size_t end;
        PlatformRegistry *platform;
        BuiltinRegistry *builtins;
    } ParallelMapWork;

    static void *_parallel_map_worker(void *arg) {
        ParallelMapWork *w = (ParallelMapWork *)arg;
        east_set_thread_context(w->platform, w->builtins);
        for (size_t i = w->start; i < w->end; i++) {
            EastValue *elem = w->inputs[i];
            EvalResult r = east_call(w->fn, &elem, 1);
            if (r.status == EVAL_OK || r.status == EVAL_RETURN) {
                w->outputs[i] = r.value;
            } else {
                w->outputs[i] = NULL;
                w->errors[i] = r;
            }
        }
        return NULL;
    }
    """
    ctypedef struct ParallelMapWork:
        _eastc.EastCompiledFn *fn
        _eastc.EastValue **inputs
        _eastc.EastValue **outputs
        _eastc.EvalResult *errors
        size_t start
        size_t end
        _eastc.PlatformRegistry *platform
        _eastc.BuiltinRegistry *builtins

    void *_parallel_map_worker(void *arg) nogil

    ctypedef unsigned long pthread_t
    int pthread_create(pthread_t *thread, void *attr,
                       void *(*start_routine)(void*), void *arg) nogil
    int pthread_join(pthread_t thread, void **retval) nogil


# ─── Implementation ────────────────────────────────────────────────────

cdef int _get_num_workers(size_t array_len) noexcept:
    import os
    cdef int n = os.cpu_count() or 4
    if <size_t>n > array_len:
        n = <int>array_len
    return n


cdef _eastc.EvalResult _parallel_map_impl(
        _eastc.EastValue **args, size_t num_args,
        _eastc.EastType **input_types, size_t num_input_types,
        _eastc.EastType *output_type) noexcept with gil:
    """C-level parallel_map: maps a function over an array using pthreads."""
    cdef _eastc.EvalResult err
    err.status = _eastc.EVAL_ERROR
    err.value = NULL
    err.label = NULL
    err.error_message = NULL
    err.locations = NULL
    err.num_locations = 0

    if num_args < 2 or args[0] == NULL or args[1] == NULL:
        err.error_message = strdup(b"parallel_map requires 2 arguments")
        return err

    cdef _eastc.EastValue *arr_val = args[0]
    cdef _eastc.EastValue *fn_val = args[1]

    if arr_val.kind != _eastc.EAST_VAL_ARRAY:
        err.error_message = strdup(b"parallel_map: first argument must be an array")
        return err
    if fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        err.error_message = strdup(b"parallel_map: second argument must be a function")
        return err

    cdef size_t arr_len = _eastc.east_array_len(arr_val)
    cdef _eastc.EastCompiledFn *compiled = fn_val.data.function.compiled
    cdef _eastc.PlatformRegistry *platform = compiled.platform
    cdef _eastc.BuiltinRegistry *builtins = compiled.builtins

    # Get the output element type from the output type (Array<R> → R)
    cdef _eastc.EastType *out_arr_type = output_type
    cdef _eastc.EastType *elem_type = NULL
    if out_arr_type != NULL and out_arr_type.kind == _eastc.EAST_TYPE_ARRAY:
        elem_type = out_arr_type.data.element

    if elem_type == NULL:
        err.error_message = strdup(b"parallel_map: cannot determine output element type")
        return err

    if arr_len == 0:
        return _eastc.eval_ok(_eastc.east_array_new(elem_type))

    # Allocate work arrays
    cdef _eastc.EastValue **inputs = <_eastc.EastValue**>malloc(arr_len * sizeof(_eastc.EastValue*))
    cdef _eastc.EastValue **outputs = <_eastc.EastValue**>malloc(arr_len * sizeof(_eastc.EastValue*))
    cdef _eastc.EvalResult *errors = <_eastc.EvalResult*>malloc(arr_len * sizeof(_eastc.EvalResult))
    if inputs == NULL or outputs == NULL or errors == NULL:
        free(inputs)
        free(outputs)
        free(errors)
        err.error_message = strdup(b"parallel_map: out of memory")
        return err

    cdef size_t i, j
    for i in range(arr_len):
        inputs[i] = _eastc.east_array_get(arr_val, i)
        outputs[i] = NULL

    cdef int num_workers = _get_num_workers(arr_len)
    cdef pthread_t *threads = NULL
    cdef ParallelMapWork *work = NULL
    cdef size_t chunk, remainder, offset
    cdef _eastc.EvalResult r
    cdef _eastc.EvalResult first_err

    if num_workers <= 1 or arr_len <= 4:
        # Sequential — no thread overhead
        _eastc.east_set_thread_context(platform, builtins)
        for i in range(arr_len):
            r = _eastc.east_call(compiled, &inputs[i], 1)
            if r.status != _eastc.EVAL_OK and r.status != _eastc.EVAL_RETURN:
                for j in range(i):
                    if outputs[j] != NULL:
                        _eastc.east_value_release(outputs[j])
                free(inputs)
                free(outputs)
                free(errors)
                return r
            outputs[i] = r.value
    else:
        # Parallel execution with pthreads
        threads = <pthread_t*>malloc(num_workers * sizeof(pthread_t))
        work = <ParallelMapWork*>malloc(num_workers * sizeof(ParallelMapWork))
        if threads == NULL or work == NULL:
            free(threads)
            free(work)
            free(inputs)
            free(outputs)
            free(errors)
            err.error_message = strdup(b"parallel_map: out of memory for threads")
            return err

        chunk = arr_len // num_workers
        remainder = arr_len % num_workers
        offset = 0

        for i in range(<size_t>num_workers):
            work[i].fn = compiled
            work[i].inputs = inputs
            work[i].outputs = outputs
            work[i].errors = errors
            work[i].platform = platform
            work[i].builtins = builtins
            work[i].start = offset
            work[i].end = offset + chunk + (1 if i < remainder else 0)
            offset = work[i].end

        # Release GIL and run threads
        with nogil:
            for i in range(<size_t>num_workers):
                pthread_create(&threads[i], NULL, _parallel_map_worker, &work[i])
            for i in range(<size_t>num_workers):
                pthread_join(threads[i], NULL)

        free(threads)
        free(work)

        # Check for errors
        for i in range(arr_len):
            if outputs[i] == NULL:
                for j in range(arr_len):
                    if outputs[j] != NULL:
                        _eastc.east_value_release(outputs[j])
                first_err = errors[i]
                free(inputs)
                free(outputs)
                free(errors)
                return first_err

    # Build result array
    cdef _eastc.EastValue *result_arr = _eastc.east_array_new(elem_type)
    for i in range(arr_len):
        _eastc.east_array_push(result_arr, outputs[i])
        _eastc.east_value_release(outputs[i])

    free(inputs)
    free(outputs)
    free(errors)
    return _eastc.eval_ok(result_arr)


cdef _eastc.PlatformFn _parallel_map_factory(
        _eastc.EastType **type_params, size_t num_type_params) noexcept with gil:
    """GenericPlatformFactory for parallel_map."""
    return _parallel_map_impl


# ─── PyCapsule export ───────────────────────────────────────────────────
# Wrap the C factory function pointer so parallel.py can pass it to the bridge.

parallel_map_factory_capsule = PyCapsule_New(
    <void*>_parallel_map_factory, "east_generic_factory", NULL
)
