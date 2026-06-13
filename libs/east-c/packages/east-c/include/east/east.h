#ifndef EAST_H
#define EAST_H

/*
 * THREADING CONTRACT (single-thread-per-arena).
 *
 * The east-c runtime is NOT thread-safe and must be driven from a single
 * thread per process/arena (the Python bindings rely on the GIL to enforce
 * this). EastValue/EastType/IRNode carry __atomic_* reference counts, but
 * the atomics protect only the counters — the surrounding data structures
 * are unsynchronized:
 *
 *   - the value slab free-list (value_slab.c) is a plain process global;
 *   - GC tracking is _Thread_local while east_gc_untrack runs from release;
 *   - the type intern table and recursive-intern table are unsynchronized;
 *   - east_ir_from_value's ir_type_cache is a mutated/freed process global.
 *
 * Concurrent alloc/free from two threads races the free-list (double-alloc
 * / use-after-free) and corrupts the GC lists. If a multi-threaded embedding
 * is ever required, these structures must be made thread-safe first — the
 * atomic refcounts alone are NOT sufficient.
 */

// Umbrella header for the east-c library
#include "types.h"
#include "values.h"
#include "ir.h"
#include "compiler.h"
#include "builtins.h"
#include "platform.h"
#include "hashmap.h"
#include "env.h"
#include "serialization.h"

#endif
