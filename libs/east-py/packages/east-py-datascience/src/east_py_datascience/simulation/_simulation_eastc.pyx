# cython: boundscheck=False, wraparound=False, cdivision=True
# cython: language_level=3
#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""C-level DES engine with pure-C event loop.

The entire event loop (heap operations + east_call) runs without the GIL.
"""

from cpython.pycapsule cimport PyCapsule_New
from libc.stddef cimport size_t
from libc.stdint cimport int64_t
from libc.stdlib cimport malloc, free
from libc.string cimport strdup

from east cimport _eastc


# ─── Pure C implementation (no GIL) ────────────────────────────────────

cdef extern from *:
    """
    #include <stdio.h>
    #include <stdlib.h>
    #include <string.h>
    #include "east/compiler.h"
    #include "east/values.h"
    #include "east/types.h"
    #include "east/builtins.h"

    /* ── Min-heap ──────────────────────────────────────────────────── */

    typedef struct {
        int64_t timestamp_ms;
        int counter;
        EastValue *scheduled_event;
    } HeapEntry;

    typedef struct {
        HeapEntry *entries;
        size_t size;
        size_t cap;
    } MinHeap;

    static MinHeap *heap_new(size_t initial_cap) {
        MinHeap *h = (MinHeap *)malloc(sizeof(MinHeap));
        h->entries = (HeapEntry *)malloc(initial_cap * sizeof(HeapEntry));
        h->size = 0;
        h->cap = initial_cap;
        return h;
    }

    static void heap_free(MinHeap *h) {
        for (size_t i = 0; i < h->size; i++)
            east_value_release(h->entries[i].scheduled_event);
        free(h->entries);
        free(h);
    }

    static void heap_sift_up(MinHeap *h, size_t i) {
        HeapEntry tmp;
        while (i > 0) {
            size_t parent = (i - 1) / 2;
            if (h->entries[parent].timestamp_ms > h->entries[i].timestamp_ms ||
                (h->entries[parent].timestamp_ms == h->entries[i].timestamp_ms &&
                 h->entries[parent].counter > h->entries[i].counter)) {
                tmp = h->entries[parent];
                h->entries[parent] = h->entries[i];
                h->entries[i] = tmp;
                i = parent;
            } else break;
        }
    }

    static void heap_sift_down(MinHeap *h, size_t i) {
        HeapEntry tmp;
        while (1) {
            size_t left = 2 * i + 1, right = 2 * i + 2, smallest = i;
            if (left < h->size &&
                (h->entries[left].timestamp_ms < h->entries[smallest].timestamp_ms ||
                 (h->entries[left].timestamp_ms == h->entries[smallest].timestamp_ms &&
                  h->entries[left].counter < h->entries[smallest].counter)))
                smallest = left;
            if (right < h->size &&
                (h->entries[right].timestamp_ms < h->entries[smallest].timestamp_ms ||
                 (h->entries[right].timestamp_ms == h->entries[smallest].timestamp_ms &&
                  h->entries[right].counter < h->entries[smallest].counter)))
                smallest = right;
            if (smallest != i) {
                tmp = h->entries[i];
                h->entries[i] = h->entries[smallest];
                h->entries[smallest] = tmp;
                i = smallest;
            } else break;
        }
    }

    static void heap_push(MinHeap *h, int64_t ts, int counter, EastValue *event) {
        if (h->size >= h->cap) {
            h->cap *= 2;
            h->entries = (HeapEntry *)realloc(h->entries, h->cap * sizeof(HeapEntry));
        }
        h->entries[h->size].timestamp_ms = ts;
        h->entries[h->size].counter = counter;
        h->entries[h->size].scheduled_event = event;
        east_value_retain(event);
        h->size++;
        heap_sift_up(h, h->size - 1);
    }

    static HeapEntry heap_pop(MinHeap *h) {
        HeapEntry top = h->entries[0];
        h->size--;
        if (h->size > 0) {
            h->entries[0] = h->entries[h->size];
            heap_sift_down(h, 0);
        }
        return top;
    }

    /* ── Single DES run (pure C, no GIL) ──────────────────────────── */

    static EvalResult des_run_single(
        EastValue *state,
        EastValue *initial_events,
        EastCompiledFn *compiled,
        int64_t max_events,
        int64_t end_date_ms,
        int has_end_date,
        EastType *output_type)
    {
        EvalResult err;
        err.status = EVAL_ERROR;
        err.value = NULL;
        err.label = NULL;
        err.error_message = NULL;
        err.locations = NULL;
        err.num_locations = 0;

        size_t n_initial = east_array_len(initial_events);
        MinHeap *heap = heap_new(n_initial + 64);
        int counter = 0;

        /* Seed heap with initial events */
        for (size_t i = 0; i < n_initial; i++) {
            EastValue *sched = east_array_get(initial_events, i);
            EastValue *dt_val = east_struct_get_field(sched, "date");
            int64_t ts = (dt_val && dt_val->kind == EAST_VAL_DATETIME) ? dt_val->data.datetime : 0;
            heap_push(heap, ts, counter++, sched);
        }

        east_value_retain(state);
        int64_t events_processed = 0;
        int64_t last_date_ms = 0;

        while (heap->size > 0 && events_processed < max_events) {
            HeapEntry entry = heap_pop(heap);
            int64_t ts = entry.timestamp_ms;
            EastValue *sched = entry.scheduled_event;

            if (has_end_date && ts > end_date_ms) {
                east_value_release(sched);
                break;
            }

            EastValue *event_date = east_struct_get_field(sched, "date");
            EastValue *event_val = east_struct_get_field(sched, "event");

            /* Call process_fn(state, date, event) */
            EastValue *call_args[3] = { state, event_date, event_val };
            EvalResult r = east_call(compiled, call_args, 3);

            if (r.status != EVAL_OK && r.status != EVAL_RETURN) {
                east_value_release(state);
                east_value_release(sched);
                heap_free(heap);
                return r;
            }

            /* Extract new state and follow-on events */
            EastValue *new_state = east_struct_get_field(r.value, "state");
            EastValue *new_events = east_struct_get_field(r.value, "events");

            east_value_retain(new_state);
            east_value_release(state);
            state = new_state;
            last_date_ms = ts;
            events_processed++;

            /* Schedule follow-on events */
            if (new_events && new_events->kind == EAST_VAL_ARRAY) {
                size_t n_new = east_array_len(new_events);
                for (size_t j = 0; j < n_new; j++) {
                    EastValue *ns = east_array_get(new_events, j);
                    EastValue *ndt = east_struct_get_field(ns, "date");
                    int64_t nts = (ndt && ndt->kind == EAST_VAL_DATETIME) ? ndt->data.datetime : 0;
                    heap_push(heap, nts, counter++, ns);
                }
            }

            east_value_release(r.value);
            east_value_release(sched);
        }

        heap_free(heap);

        /* Build result struct */
        const char *names[3] = { "final_state", "events_processed", "final_date" };
        EastValue *vals[3] = { state, east_integer(events_processed), east_datetime(last_date_ms) };
        EastValue *result = east_struct_new(names, vals, 3, output_type);
        return eval_ok(result);
    }

    """
    _eastc.EvalResult des_run_single(
        _eastc.EastValue *state,
        _eastc.EastValue *initial_events,
        _eastc.EastCompiledFn *compiled,
        int64_t max_events,
        int64_t end_date_ms,
        int has_end_date,
        _eastc.EastType *output_type) nogil


# ─── simulation_run ─────────────────────────────────────────────────────

cdef _eastc.EvalResult _simulation_run_impl(
        _eastc.EastValue **args, size_t num_args,
        _eastc.EastType **input_types, size_t num_input_types,
        _eastc.EastType *output_type) noexcept with gil:

    cdef _eastc.EvalResult err
    err.status = _eastc.EVAL_ERROR
    err.value = NULL
    err.label = NULL
    err.error_message = NULL
    err.locations = NULL
    err.num_locations = 0

    if num_args < 4:
        err.error_message = strdup(b"simulation_run requires 4 arguments")
        return err

    cdef _eastc.EastValue *state = args[0]
    cdef _eastc.EastValue *initial_events = args[1]
    cdef _eastc.EastValue *fn_val = args[2]
    cdef _eastc.EastValue *config = args[3]

    if fn_val.kind != _eastc.EAST_VAL_FUNCTION:
        err.error_message = strdup(b"simulation_run: third arg must be a function")
        return err

    cdef _eastc.EastCompiledFn *compiled = fn_val.data.function.compiled
    _eastc.east_set_thread_context(compiled.platform, compiled.builtins)

    # Extract config
    cdef int64_t max_events = 100000
    cdef int64_t end_date_ms = 0
    cdef int has_end_date = 0

    cdef _eastc.EastValue *opt_val
    opt_val = _eastc.east_struct_get_field(config, "max_events")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_INTEGER:
            max_events = opt_val.data.variant.value.data.integer

    opt_val = _eastc.east_struct_get_field(config, "end_date")
    if opt_val != NULL and opt_val.kind == _eastc.EAST_VAL_VARIANT:
        if opt_val.data.variant.value != NULL and opt_val.data.variant.value.kind == _eastc.EAST_VAL_DATETIME:
            end_date_ms = opt_val.data.variant.value.data.datetime
            has_end_date = 1

    cdef _eastc.EvalResult result
    with nogil:
        result = des_run_single(state, initial_events, compiled,
                                max_events, end_date_ms, has_end_date,
                                output_type)
    return result


# ─── Generic factory ────────────────────────────────────────────────────

cdef _eastc.PlatformFn _simulation_run_factory(
        _eastc.EastType **type_params, size_t num_type_params) noexcept with gil:
    return _simulation_run_impl


# ─── PyCapsule exports ──────────────────────────────────────────────────

simulation_run_capsule = PyCapsule_New(
    <void*>_simulation_run_factory, "east_generic_factory", NULL
)
