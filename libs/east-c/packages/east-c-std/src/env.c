/*
 * Environment platform functions for East.
 *
 * Mirrors east-node-std's Env module (same platform name and types): the IR
 * carries the variable NAME; the value comes from the process environment at
 * runtime, so credentials never appear in content-addressed IR.
 */

#include "east_std/east_std.h"
#include <east/values.h>
#include <east/eval_result.h>
#include <stdlib.h>

/* env_get(name: String) -> Option<String>
 * some(value) when the variable is set (including the empty string),
 * none when it is not set. */
static EvalResult env_get(EastValue **args, size_t num_args, EastType **input_types,
                          size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;

    const char *name = args[0]->data.string.data;
    const char *value = getenv(name);
    if (value == NULL) {
        return eval_ok(east_variant_new("none", east_null(), output_type));
    }
    EastValue *str = east_string(value);
    EastValue *opt = east_variant_new("some", str, output_type);
    east_value_release(str);
    return eval_ok(opt);
}

void east_std_register_env(PlatformRegistry *reg)
{
    platform_registry_add(reg, "env_get", env_get, false);
}
