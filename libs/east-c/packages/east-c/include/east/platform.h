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
     *  Used by Python bindings to set dispatch context. */
    void (*pre_call)(const char *name, EastType **type_params, size_t num_type_params);

    /** Refcount. Initial value 1; release calls platform_registry_free
     *  when count reaches 0. */
    int ref_count;
} PlatformRegistry;

PlatformRegistry *platform_registry_new(void);
void platform_registry_add(PlatformRegistry *reg, const char *name, PlatformFn fn, bool is_async);
void platform_registry_add_generic(PlatformRegistry *reg, const char *name,
                                   GenericPlatformFactory factory, bool is_async);
PlatformFn platform_registry_get(PlatformRegistry *reg, const char *name, EastType **type_params,
                                 size_t num_tp);
void platform_registry_free(PlatformRegistry *reg);

void platform_registry_retain(PlatformRegistry *reg);
void platform_registry_release(PlatformRegistry *reg);

#endif
