#ifndef EAST_DATASCIENCE_H
#define EAST_DATASCIENCE_H

/*
 * east-c-datascience: east-py-datascience's platform functions on the C
 * runtime, family by family — the same names, East types and semantics, so a
 * task moves between the runners by changing its runner and nothing else.
 *
 * The implementations are C++ (OR-Tools, XGBoost and libtorch are C++
 * libraries); this header is the C surface. It is a shared library the runner
 * opens at run time (east-c-cli/src/package_loader.c), which resolves these
 * entry points by name and binds the library's east-c calls to the runtime the
 * binary carries — so the library links none of east-c itself. Every other
 * symbol of the library is hidden.
 */

#include <east/platform.h>

#if defined(_WIN32)
#define EAST_DS_API __declspec(dllexport)
#elif defined(__GNUC__)
#define EAST_DS_API __attribute__((visibility("default")))
#else
#define EAST_DS_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Google OR-Tools, the whole family: google_or_cpsat_solve,
 * google_or_cpsat_solve_all, google_or_linear_solve, google_or_routing_solve,
 * google_or_min_cost_flow, google_or_max_flow, google_or_assignment,
 * google_or_min_cost_assignment. */
EAST_DS_API void east_datascience_register_google_or(PlatformRegistry *reg);

/* XGBoost, the whole family: xgboost_train_regressor, xgboost_train_classifier,
 * xgboost_train_quantile, xgboost_predict, xgboost_predict_class,
 * xgboost_predict_proba, xgboost_predict_quantile. */
EAST_DS_API void east_datascience_register_xgboost(PlatformRegistry *reg);

/* The neural-network family (#1357): nn_init, nn_train and nn_run, the
 * interpreter of docs/neural-networks.md on libtorch (CPU or CUDA by the
 * build linked). Registered always; the libtorch-linked library beside this
 * one (libeast-c-nn) is opened on the first call, so OR-Tools and XGBoost work
 * without libtorch, and an nn_* call without it fails naming the fetch. */
EAST_DS_API void east_datascience_register_nn(PlatformRegistry *reg);

/* Every family. */
EAST_DS_API void east_datascience_register_all(PlatformRegistry *reg);

/* The east-c version this library was built with: the runner refuses another. */
EAST_DS_API const char *east_datascience_version(void);

/* The library versions this build links, for `east-c version`. */
EAST_DS_API const char *east_datascience_ortools_version(void);
EAST_DS_API const char *east_datascience_xgboost_version(void);

/* The neural-network family's state, for `east-c version`: the libtorch it
 * runs on, or why nn_* calls fail. */
EAST_DS_API const char *east_datascience_nn_state(void);

#ifdef __cplusplus
}
#endif

#endif
