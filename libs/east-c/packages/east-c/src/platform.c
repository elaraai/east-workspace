/*
 * Platform function registry implementation.
 *
 * Maps function names to PlatformFn pointers (concrete) or
 * GenericPlatformFactory functions (type-parameterised).
 */
#include "east/platform.h"
#include "east/hashmap.h"
#include <stdlib.h>
#include <string.h>

PlatformRegistry *platform_registry_new(void)
{
    PlatformRegistry *reg = calloc(1, sizeof(PlatformRegistry));
    if (!reg) return NULL;
    reg->functions = hashmap_new();
    reg->generic_functions = hashmap_new();
    reg->ref_count = 1;
    return reg;
}

static void platform_function_free(void *v)
{
    PlatformFunction *pf = v;
    if (!pf) return;
    for (size_t i = 0; i < pf->num_input_types; i++)
        east_type_release(pf->input_types[i]);
    free(pf->input_types);
    east_type_release(pf->output_type);
    free(pf);
}

void platform_registry_add(PlatformRegistry *reg, const char *name, PlatformFn fn, bool is_async)
{
    platform_registry_add_typed(reg, name, fn, is_async, NULL, 0, NULL);
}

void platform_registry_add_typed(PlatformRegistry *reg, const char *name, PlatformFn fn,
                                 bool is_async, EastType **input_types, size_t num_input_types,
                                 EastType *output_type)
{
    if (!reg || !name) return;
    platform_function_free(hashmap_get(reg->functions, name));
    PlatformFunction *pf = calloc(1, sizeof(PlatformFunction));
    if (!pf) return;
    pf->name = name;
    pf->fn = fn;
    pf->is_async = is_async;
    if (input_types && num_input_types > 0) {
        pf->input_types = calloc(num_input_types, sizeof(EastType *));
        if (pf->input_types) {
            for (size_t i = 0; i < num_input_types; i++) {
                pf->input_types[i] = input_types[i];
                east_type_retain(input_types[i]);
            }
            pf->num_input_types = num_input_types;
        }
    }
    if (output_type) {
        pf->output_type = output_type;
        east_type_retain(output_type);
    }
    hashmap_set(reg->functions, name, pf);
}

void platform_registry_add_generic(PlatformRegistry *reg, const char *name,
                                   GenericPlatformFactory factory, bool is_async)
{
    if (!reg || !name) return;
    free(hashmap_get(reg->generic_functions, name));
    GenericPlatformFunction *gf = calloc(1, sizeof(GenericPlatformFunction));
    if (!gf) return;
    gf->name = name;
    gf->factory = factory;
    gf->is_async = is_async;
    hashmap_set(reg->generic_functions, name, gf);
}

PlatformFn platform_registry_get(PlatformRegistry *reg, const char *name, EastType **type_params,
                                 size_t num_tp)
{
    if (!reg || !name) return NULL;

    /* Try concrete functions first. */
    PlatformFunction *pf = hashmap_get(reg->functions, name);
    if (pf) return pf->fn;

    /* Try generic functions. */
    GenericPlatformFunction *gf = hashmap_get(reg->generic_functions, name);
    if (gf) return gf->factory(type_params, num_tp);

    return NULL;
}

PlatformFunction *platform_registry_lookup(PlatformRegistry *reg, const char *name)
{
    if (!reg || !name) return NULL;
    return hashmap_get(reg->functions, name);
}

static void free_pf(void *v)
{
    free(v);
}

void platform_registry_free(PlatformRegistry *reg)
{
    if (!reg) return;
    if (reg->on_free) reg->on_free(reg);
    hashmap_free(reg->functions, platform_function_free);
    hashmap_free(reg->generic_functions, free_pf);
    free(reg);
}

void platform_registry_retain(PlatformRegistry *reg)
{
    if (!reg) return;
    reg->ref_count++;
}

void platform_registry_release(PlatformRegistry *reg)
{
    if (!reg) return;
    if (--reg->ref_count > 0) return;
    platform_registry_free(reg);
}
