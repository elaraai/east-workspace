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
    EastSourceMap *source_map; // owned, for loc_id resolution at error time (may be NULL)

    /* Foreign-runtime dispatch (e.g. a callback into an embedding host).
     * When `invoke` is non-NULL, east_call short-circuits IR evaluation and
     * delegates to it. `invoke_release` is called from east_compiled_fn_free
     * with `invoke_userdata` so the foreign runtime can free its handle.
     * NULL by default — pure East functions ignore this entirely. */
    EastInvokeFn invoke;
    void *invoke_userdata;
    void (*invoke_release)(void *userdata);
};

// Top-level API
EastCompiledFn *east_compile(IRNode *ir, PlatformRegistry *platform, BuiltinRegistry *builtins);
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

// Set thread-local source map for loc_id resolution (call before eval_ir / east_call)
void east_set_source_map(const EastSourceMap *sm);

#endif
