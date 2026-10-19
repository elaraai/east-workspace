/*
 * The C surface: each family's registration, and the library versions.
 */
#include <east_datascience/east_datascience.h>

#ifndef EAST_DATASCIENCE_ORTOOLS_VERSION
#define EAST_DATASCIENCE_ORTOOLS_VERSION "unknown"
#endif
#ifndef EAST_DATASCIENCE_XGBOOST_VERSION
#define EAST_DATASCIENCE_XGBOOST_VERSION "unknown"
#endif

namespace east_ds
{
void register_google_or_linear(PlatformRegistry *reg);
void register_google_or_cpsat(PlatformRegistry *reg);
void register_google_or_routing(PlatformRegistry *reg);
void register_google_or_graph(PlatformRegistry *reg);
void register_xgboost(PlatformRegistry *reg);
} // namespace east_ds

extern "C" void east_datascience_register_google_or(PlatformRegistry *reg)
{
    east_ds::register_google_or_linear(reg);
    east_ds::register_google_or_cpsat(reg);
    east_ds::register_google_or_routing(reg);
    east_ds::register_google_or_graph(reg);
}

extern "C" void east_datascience_register_xgboost(PlatformRegistry *reg)
{
    east_ds::register_xgboost(reg);
}

extern "C" void east_datascience_register_all(PlatformRegistry *reg)
{
    east_datascience_register_google_or(reg);
    east_datascience_register_xgboost(reg);
}

extern "C" const char *east_datascience_ortools_version(void)
{
    return EAST_DATASCIENCE_ORTOOLS_VERSION;
}

extern "C" const char *east_datascience_xgboost_version(void)
{
    return EAST_DATASCIENCE_XGBOOST_VERSION;
}
