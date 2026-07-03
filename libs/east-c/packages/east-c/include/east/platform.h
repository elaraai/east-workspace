#ifndef EAST_PLATFORM_H
#define EAST_PLATFORM_H

#include "eval_result.h"
#include "hashmap.h"
#include <stdbool.h>
#include <stddef.h>

typedef EvalResult (*PlatformFn)(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type);
typedef PlatformFn (*GenericPlatformFactory)(EastType **type_params, size_t num_type_params);

typedef struct {
    const char *name;
    PlatformFn fn;
    bool is_async;
    /** Declared signature for the compile-time IR cross-check
     *  (east_compile_checked). NULL output_type ⇒ untyped registration,
     *  which is never checked. Types are retained by the registry. */
    EastType **input_types;
    size_t num_input_types;
    EastType *output_type;
} PlatformFunction;

typedef struct {
    const char *name;
    GenericPlatformFactory factory;
    bool is_async;
} GenericPlatformFunction;

typedef struct PlatformRegistry {
    Hashmap *functions;         // name -> PlatformFunction*
    Hashmap *generic_functions; // name -> GenericPlatformFunction*
    /** Optional hook called before each platform function invocation.
     *  Used by Python bindings to set dispatch context. Receives the
     *  registry so bindings can keep per-registry dispatch state. */
    void (*pre_call)(struct PlatformRegistry *reg, const char *name, EastType **type_params,
                     size_t num_type_params);

    /** Optional hook called at the start of platform_registry_free — lets
     *  bindings drop per-registry dispatch state with the same lifetime as
     *  the registry itself. */
    void (*on_free)(struct PlatformRegistry *reg);

    /** Refcount. Initial value 1; release calls platform_registry_free
     *  when count reaches 0. */
    int ref_count;
} PlatformRegistry;

PlatformRegistry *platform_registry_new(void);
void platform_registry_add(PlatformRegistry *reg, const char *name, PlatformFn fn, bool is_async);

/** Register a concrete platform function together with its declared East
 *  signature. Every IR Platform node resolving to a typed entry is validated
 *  against these types by east_compile_checked / east_compile before
 *  execution. The registry retains the types. Passing NULL output_type is
 *  equivalent to platform_registry_add (unchecked). */
void platform_registry_add_typed(PlatformRegistry *reg, const char *name, PlatformFn fn,
                                 bool is_async, EastType **input_types, size_t num_input_types,
                                 EastType *output_type);
void platform_registry_add_generic(PlatformRegistry *reg, const char *name,
                                   GenericPlatformFactory factory, bool is_async);
PlatformFn platform_registry_get(PlatformRegistry *reg, const char *name, EastType **type_params,
                                 size_t num_tp);

/** Look up a concrete (non-generic) registry entry by name. Returns NULL if
 *  the name is unregistered or registered only as a generic factory. */
PlatformFunction *platform_registry_lookup(PlatformRegistry *reg, const char *name);
void platform_registry_free(PlatformRegistry *reg);

void platform_registry_retain(PlatformRegistry *reg);
void platform_registry_release(PlatformRegistry *reg);

#endif
