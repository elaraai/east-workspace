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
#include "emit_sink.h"
#include "file_map.h"
#include "merge.h"

/* Exit with the parent (issue #770). Starts a detached watcher thread that
 * blocks reading stdin and terminates the process with _exit(1) when the
 * read returns end of file or an error. A runner calls it, before any work
 * starts, when its command line carries `--exit-with-parent` — a flag a
 * parent passes only when it gives the runner a stdin pipe it never writes
 * to, so the read blocks until that parent dies. The watcher touches no East
 * value, so the single-thread contract above holds. */
void east_exit_with_parent(void);

#endif
