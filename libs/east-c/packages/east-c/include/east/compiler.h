#ifndef EAST_COMPILER_H
#define EAST_COMPILER_H

#include "builtins.h"
#include "env.h"
#include "eval_result.h"
#include "ir.h"
#include "platform.h"
#include "types.h"
#include "values.h"

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
/*  Per-function profiler (east-c run --profile)                       */
/* ------------------------------------------------------------------ */

/* One profiled function: every closure evaluated from one Function node
 * shares its body, which is the entry's identity. Counts and nanoseconds
 * accumulate across calls; `self` excludes time spent in East functions
 * called from the body. `name` borrows the profiler's own copy and is
 * valid until east_profile_reset. */
typedef struct {
    const IRNode *body;
    const char *name;
    int64_t loc_id;      /* the Function node's site */
    int64_t call_loc_id; /* the first Call node that invoked it (0 when only
                            a host called it) — what places a helper the
                            builder inlined at its call site and stamped with
                            the caller's location */
    uint64_t calls;
    uint64_t total_ns;
    uint64_t self_ns;
} EastProfileEntry;

/* Arm or disarm the profiler on this thread. Off, a call costs one branch. */
void east_profile_enable(bool on);
bool east_profile_enabled(void);
/* The entries so far, sorted by self time descending, in a malloc'd array
 * the caller frees (NULL when nothing was profiled). */
EastProfileEntry *east_profile_report(size_t *count_out);
/* Drop every entry and the profiler's copies of their names. */
void east_profile_reset(void);

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
