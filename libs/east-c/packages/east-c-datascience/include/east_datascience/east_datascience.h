#ifndef EAST_DATASCIENCE_H
#define EAST_DATASCIENCE_H

/*
 * east-c-datascience: east-py-datascience's platform functions on the C
 * runtime, family by family — the same names, East types and semantics, so a
 * task moves between the runners by changing its runner and nothing else.
 *
 * The implementations are C++ (OR-Tools and XGBoost are C++ libraries); this
 * header is the C surface the CLI and the compliance runner register through.
 */

#include <east/platform.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Google OR-Tools, the whole family: google_or_cpsat_solve,
 * google_or_cpsat_solve_all, google_or_linear_solve, google_or_routing_solve,
 * google_or_min_cost_flow, google_or_max_flow, google_or_assignment,
 * google_or_min_cost_assignment. */
void east_datascience_register_google_or(PlatformRegistry *reg);

/* XGBoost, the whole family: xgboost_train_regressor, xgboost_train_classifier,
 * xgboost_train_quantile, xgboost_predict, xgboost_predict_class,
 * xgboost_predict_proba, xgboost_predict_quantile. */
void east_datascience_register_xgboost(PlatformRegistry *reg);

/* The neural-network family (#1357): nn_init, nn_train and nn_run, the
 * interpreter of docs/neural-networks.md on libtorch (CPU or CUDA by the
 * build linked). */
void east_datascience_register_nn(PlatformRegistry *reg);

/* Every family. */
void east_datascience_register_all(PlatformRegistry *reg);

/* The library versions this build links, for `east-c version`. */
const char *east_datascience_ortools_version(void);
const char *east_datascience_xgboost_version(void);

#ifdef __cplusplus
}
#endif

#endif
