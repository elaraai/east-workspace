#ifndef EAST_COMPILER_H
#define EAST_COMPILER_H

#include "builtins.h"
#include "env.h"
#include "eval_result.h"
#include "ir.h"
#include "platform.h"
#include "types.h"
#include "values.h"

#include <stdio.h>

/* Forward-declare source map (defined in type_of_type.h) */
typedef struct EastSourceMap EastSourceMap;

struct EastCompiledFn;

/* Custom invoke hook for foreign-runtime function values (e.g. a callback
 * into an embedding host runtime). When set on an EastCompiledFn, east_call
 * and IR_CALL dispatch to this function instead of evaluating `ir`. */
typedef EvalResult (*EastInvokeFn)(struct EastCompiledFn *self, EastValue **args, size_t n_args);

struct EastCompiledFn {
    IRNode *ir;
    Environment *captures;
    char **param_names;
    size_t num_params;
    PlatformRegistry *platform;
    BuiltinRegistry *builtins;
    EastValue *source_ir;      // original IR variant value for serialization
    EastType *fn_type;         // Function/AsyncFunction type (inputs + output), not owned
    EastSourceMap *source_map; // one reference (east_source_map_retain), released by
                               // east_compiled_fn_free; resolves loc_ids at error time
                               // and rides the beast2 source-map section (may be NULL)

    /* Foreign-runtime dispatch (e.g. a callback into an embedding host).
     * When `invoke` is non-NULL, east_call short-circuits IR evaluation and
     * delegates to it. `invoke_release` is called from east_compiled_fn_free
     * with `invoke_userdata` so the foreign runtime can free its handle.
     * NULL by default — pure East functions ignore this entirely. */
    EastInvokeFn invoke;
    void *invoke_userdata;
    void (*invoke_release)(void *userdata);

    /* The call frame's scope (retained): params at cells 0..num_params-1,
     * from the Function node this was compiled or evaluated from. NULL for a
     * function compiled from a bare body (east_compile_checked) or built by
     * a host, whose params then bind by name. */
    IRScope *scope;

    /* What the profiler prints for this function: the Let it was bound to
     * (owned copy, or NULL) and the Function node's loc_id. */
    char *name;
    int64_t loc_id;
};

/* ------------------------------------------------------------------ */
/*  Per-function profiler (a runner's --profile, EAST_PROFILE)         */
/* ------------------------------------------------------------------ */

/* One profiled function. Every closure evaluated from one Function node
 * shares its body, which is the entry's identity; every call of one platform
 * function, wherever it is called, is one entry named after it, so the time
 * spent inside it is not its caller's. A lazily read collection's segment
 * decodes are one entry too, named after the collection, so the time keyed
 * reads at random or a repeated scan spend decoding is not the reading
 * function's either; each decode is a call. Counts and nanoseconds accumulate
 * across calls; `self` excludes time spent in the East and platform functions
 * called from the body, and in the decodes its reads made, which its total
 * keeps.
 * A report taken while a call is under way counts it as a call, and its time
 * so far. The strings borrow the profiler's own copies and are valid until
 * east_profile_reset. */
typedef struct {
    const void *key;       /* the body, or the profiler's copy of the platform
                              function's name or the collection's label */
    const char *name;      /* the Let it was bound to, the platform function's
                              name, the collection's label, or NULL */
    bool platform;         /* a platform function */
    bool paged;            /* a lazily read collection's segment decodes */
    int64_t loc_id;        /* the Function node's site (0 for a platform function
                              or a collection) */
    int64_t call_loc_id;   /* the first Call or Platform node that invoked it, or
                              the first node whose read decoded (0 when only a
                              host called it) — what places a helper the
                              builder inlined at its call site and stamped with
                              the caller's location */
    const char *site;      /* loc_id as "file:line:column", resolved through the
                              source map its function carries, or NULL */
    const char *call_site; /* call_loc_id likewise, through its caller's map */
    uint64_t calls;
    uint64_t total_ns;
    uint64_t self_ns;
} EastProfileEntry;

/* The environment variables a runner's profile reads (east_profile_start). */
#define EAST_PROFILE_ENV "EAST_PROFILE"
#define EAST_PROFILE_INTERVAL_ENV "EAST_PROFILE_INTERVAL"

/* Arm or disarm the profiler on this thread. Off, a call costs one branch. */
void east_profile_enable(bool on);
bool east_profile_enabled(void);
/* The entries so far, sorted by self time descending, in a malloc'd array
 * the caller frees (NULL when nothing was profiled). */
EastProfileEntry *east_profile_report(size_t *count_out);
/* Drop every entry and the profiler's copies of their strings. */
void east_profile_reset(void);
/* Print the report so far to `out`: the top entries by self time, each with
 * its calls, self and total time and where it is. Taken while the profiler's
 * outermost call is under way, it says how long it has run. */
void east_profile_print(FILE *out);
/* Arm the profiler on this thread for a runner's work: when `on` (its
 * --profile) or when EAST_PROFILE is set to anything but "" or "0". With
 * EAST_PROFILE_INTERVAL=N, a number of seconds greater than 0, the report so
 * far is printed to stderr every N seconds while the work runs; an interval
 * that is not one is said on stderr and ignored. Returns whether it armed. */
bool east_profile_start(bool on);
/* A runner's epilogue after east_profile_start armed the profiler: disarm
 * it, print the report to `out` and drop it. Nothing when the profiler was
 * not armed, or this already ran — so a runner's success and failure paths
 * may both call it. */
void east_profile_finish(FILE *out);
/* A lazily read collection's decode of a segment, or of the whole collection,
 * begins and ends: the pager brackets each with these, so the decode is a call
 * of the entry named `label` (a runner names its inputs "input N", as its -v
 * account does; NULL is "paged collection"), placed by the first node whose
 * read decoded. Off, each costs one branch. */
void east_profile_paged_enter(const char *label);
void east_profile_paged_exit(void);

// Top-level API
EastCompiledFn *east_compile(IRNode *ir, PlatformRegistry *platform, BuiltinRegistry *builtins);

/* east_compile with platform-signature validation reporting. Every Platform
 * node in `ir` whose registry entry carries declared types
 * (platform_registry_add_typed) is cross-checked against the IR's declared
 * argument/output types. On mismatch returns NULL and, when `error_out` is
 * non-NULL, sets *error_out to a malloc'd message identical to the TypeScript
 * reference analyzer's error text (caller frees). east_compile performs the
 * same validation but discards the message. */
EastCompiledFn *east_compile_checked(IRNode *ir, PlatformRegistry *platform,
                                     BuiltinRegistry *builtins, char **error_out);
/* Compile a Function / AsyncFunction NODE: the body with the platform check
 * of east_compile_checked, plus the node's parameter names, its scope and
 * its function type, so east_call binds arguments into resolved cells. */
EastCompiledFn *east_compile_fn(IRNode *fn_node, PlatformRegistry *platform,
                                BuiltinRegistry *builtins, char **error_out);
EvalResult east_call(EastCompiledFn *fn, EastValue **args, size_t num_args);
void east_compiled_fn_free(EastCompiledFn *fn);

/* The error an East call nested too deeply raises — identical across the TS,
 * C and Python runtimes (compliance-tested), so runaway recursion is one
 * catchable East error everywhere rather than a crash (#948). */
#define EAST_CALL_DEPTH_MSG "call stack exhausted: East calls nested too deeply"

/* The most of a thread's stack East calls use: a thread with a larger stack
 * gives them only what an 8 MiB stack (a POSIX main thread's) does, so runaway
 * recursion is refused at the same depth on every platform. east-c's Windows
 * executables reserve 1 GiB (the top-level CMakeLists.txt) for the builtins
 * that recurse over deep values; East calls given all of it ran a runaway
 * recursion a gigabyte deep before refusing it. */
#define EAST_STACK_BUDGET (8u * 1024u * 1024u)

/* Whether this thread's stack is too far used for another East call: the
 * stack pointer is within the headroom kept above the thread's stack limit,
 * or a stack larger than EAST_STACK_BUDGET is used beyond what the budget
 * allows. Always false on a stack whose bounds are unknown or that is not the
 * thread's own (a fiber). Checked at every East call (stack_guard.c). */
bool east_stack_exhausted(void);

/* Build a function VALUE backed by a foreign-runtime invoke hook (e.g. a
 * Python callable). `invoke` is called with (self, args, n); read your handle
 * from `self->invoke_userdata`. `invoke_release` runs once when the value is
 * freed. `fn_type` is borrowed (not owned). Returns a function EastValue the
 * caller owns (NULL on allocation failure). */
EastValue *east_foreign_function(EastInvokeFn invoke, void *userdata,
                                 void (*invoke_release)(void *userdata), EastType *fn_type);

// Internal evaluation
EvalResult eval_ir(IRNode *node, Environment *env, PlatformRegistry *platform,
                   BuiltinRegistry *builtins);

// Access the current platform/builtins registries (valid during east_call)
PlatformRegistry *east_current_platform(void);
BuiltinRegistry *east_current_builtins(void);

// Set thread-local platform/builtins for worker threads (call before beast2 decode)
void east_set_thread_context(PlatformRegistry *p, BuiltinRegistry *b);

// Read thread-local platform/builtins (for save/restore around context switches)
void east_get_thread_context(PlatformRegistry **out_p, BuiltinRegistry **out_b);

// Set thread-local source map for loc_id resolution (call before eval_ir / east_call).
// Borrowed: the caller keeps the map alive while it is current. Closures created
// while a map is current take their own reference to it (see EastCompiledFn).
void east_set_source_map(const EastSourceMap *sm);

// Read the thread-local source map, so a caller that installs one around a
// compile can restore what was current (a compile may run inside east_call —
// a platform function building a program — and must not clobber its map).
const EastSourceMap *east_get_source_map(void);

#endif
