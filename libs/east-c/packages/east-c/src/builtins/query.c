/*
 * The Query builtin (#1041): a jq query as East.jq emits it. Its arguments
 * are the query's program and a root's input names (a constant the SDK that
 * checked the query wrote) and the query's translation, an East function of
 * its inputs; the builtin gives the translation, so calling it runs the
 * query. Nothing here reads the query: every runtime runs the translation.
 */
#include "east/builtins.h"
#include "east/values.h"

static EastValue *query_impl(EastValue **args, size_t n)
{
    (void)n;
    east_value_retain(args[1]);
    return args[1];
}

static BuiltinImpl query_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return query_impl;
}

void east_register_query_builtins(BuiltinRegistry *reg)
{
    builtin_registry_register(reg, "Query", query_factory);
}
