/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East Data Science - ML and optimization platform functions for East.
 *
 * This package provides data science capabilities for East programs:
 * - MADS: Derivative-free blackbox optimization (PyNomadBBO)
 * - Optuna: Bayesian optimization with TPE sampler
 * - SimAnneal: Discrete optimization with Simulated Annealing
 *
 * @packageDocumentation
 */

// MADS - Derivative-free optimization
export {
    MADS,
    mads_optimize,
    MADSTypes,
    VectorType,
    ScalarObjectiveType,
    MADSBoundsType,
    MADSConstraintType,
    MADSDirectionType,
    MADSConfigType,
    MADSResultType,
} from "./mads/mads.js";

// Optuna - Bayesian optimization
export {
    Optuna,
    optuna_optimize,
    OptunaTypes,
    ParamValueType,
    ParamSpaceKindType,
    ParamSpaceType,
    NamedParamType,
    OptimizationDirectionType,
    PrunerType,
    OptunaStudyConfigType,
    TrialResultType,
    StudyResultType,
    ObjectiveFunctionType,
} from "./optuna/optuna.js";

// SimAnneal - Discrete optimization
export {
    SimAnneal,
    simanneal_optimize,
    simanneal_optimize_permutation,
    simanneal_optimize_subset,
    SimAnnealTypes,
    DiscreteStateType,
    EnergyFunctionType,
    MoveFunctionType,
    PermutationEnergyType,
    SubsetEnergyType,
    AnnealConfigType,
    AnnealResultType,
} from "./simanneal/simanneal.js";

// Sklearn - ML utilities
export {
    Sklearn,
    sklearn_split,
    sklearn_overlap,
    OverlapConfigType,
    OverlapResultType,
    sklearn_standard_scaler_fit,
    sklearn_standard_scaler_transform,
    sklearn_min_max_scaler_fit,
    sklearn_min_max_scaler_transform,
    sklearn_compute_metrics,
    sklearn_compute_metrics_multi,
    sklearn_compute_classification_metrics,
    sklearn_compute_classification_metrics_multi,
    sklearn_regressor_chain_train,
    sklearn_regressor_chain_predict,
    // GMM
    sklearn_gmm_fit,
    sklearn_gmm_predict,
    sklearn_gmm_predict_proba,
    sklearn_gmm_score_samples,
    sklearn_gmm_sample,
    sklearn_gmm_bic,
    sklearn_gmm_aic,
    GMMCovarianceType,
    GMMConfigType,
    SklearnTypes,
    SplitConfigType,
    SplitResultType,
    SklearnModelBlobType,
    RegressorChainBaseConfigType,
    RegressorChainConfigType,
    // Flexible metrics types
    RegressionMetricType,
    MetricResultType,
    MetricsResultType,
    MetricAggregationType,
    MultiMetricsConfigType,
    MultiMetricResultType,
    MultiMetricsResultType,
    ClassificationMetricType,
    ClassificationAverageType,
    ClassificationMetricsConfigType,
    ClassificationMetricResultType,
    ClassificationMetricResultsType,
    MultiClassificationConfigType,
    MultiClassificationMetricResultType,
    MultiClassificationMetricResultsType,
} from "./sklearn/sklearn.js";

// Scipy - Scientific computing
export {
    Scipy,
    scipy_curve_fit,
    scipy_stats_describe,
    scipy_stats_pearsonr,
    scipy_stats_spearmanr,
    scipy_stats_percentileofscore,
    scipy_interpolate_1d_fit,
    scipy_interpolate_1d_predict,
    scipy_optimize_minimize,
    scipy_optimize_minimize_quadratic,
    scipy_histogram,
    scipy_kde_fit,
    scipy_kde_evaluate,
    ScipyTypes,
    OptimizeMethodType,
    InterpolationKindType,
    HistogramBinMethodType,
    KdeBandwidthMethodType,
    OptimizeConfigType,
    InterpolateConfigType,
    HistogramConfigType,
    KdeConfigType,
    ParamBoundsType,
    CustomCurveFunctionType,
    CurveFunctionType,
    CurveFitConfigType,
    QuadraticConfigType,
    StatsDescribeResultType,
    CorrelationResultType,
    HistogramResultType,
    KdeResultType,
    CurveFitResultType,
    OptimizeResultType,
    ScipyModelBlobType,
} from "./scipy/scipy.js";

// XGBoost - Gradient boosting
export {
    XGBoost,
    xgboost_train_regressor,
    xgboost_train_classifier,
    xgboost_train_quantile,
    xgboost_predict,
    xgboost_predict_class,
    xgboost_predict_proba,
    xgboost_predict_quantile,
    XGBoostTypes,
    XGBoostConfigType,
    XGBoostQuantileConfigType,
    XGBoostQuantilePredictResultType,
    XGBoostModelBlobType,
} from "./xgboost/xgboost.js";

// LightGBM - Fast gradient boosting
export {
    LightGBM,
    lightgbm_train_regressor,
    lightgbm_train_classifier,
    lightgbm_predict,
    lightgbm_predict_class,
    lightgbm_predict_proba,
    LightGBMTypes,
    LightGBMConfigType,
    LightGBMModelBlobType,
} from "./lightgbm/lightgbm.js";

// NGBoost - Probabilistic gradient boosting
export {
    NGBoost,
    ngboost_train_regressor,
    ngboost_predict,
    ngboost_predict_dist,
    NGBoostTypes,
    NGBoostDistributionType,
    NGBoostConfigType,
    NGBoostPredictConfigType,
    NGBoostPredictResultType,
    NGBoostModelBlobType,
} from "./ngboost/ngboost.js";

// SHAP - Model explainability
export {
    Shap,
    shap_tree_explainer_create,
    shap_kernel_explainer_create,
    shap_compute_values,
    shap_feature_importance,
    ShapTypes,
    ShapResultType,
    FeatureImportanceType,
    ShapModelBlobType,
    AnyModelBlobType,
    StringVectorType,
} from "./shap/shap.js";

// Torch - PyTorch neural networks
export {
    Torch,
    torch_mlp_train,
    torch_mlp_predict,
    TorchTypes,
    TorchActivationType,
    TorchLossType,
    TorchOptimizerType,
    TorchMLPConfigType,
    TorchTrainConfigType,
    TorchTrainResultType,
    TorchTrainOutputType,
    TorchModelBlobType,
} from "./torch/torch.js";

// GP - Gaussian Process regression
export {
    GP,
    gp_train,
    gp_predict,
    gp_predict_std,
    GPTypes,
    GPKernelType,
    GPConfigType,
    GPPredictResultType,
    GPModelBlobType,
} from "./gp/gp.js";

// PyMC - Bayesian inference
export {
    PyMC,
    pymc_train_regression,
    pymc_train_hierarchical,
    pymc_train_multi_layer,
    pymc_predict,
    pymc_predict_distribution,
    pymc_posterior_summary,
    pymc_posterior_samples,
    pymc_diagnostics,
    pymc_posterior_predictive_check,
    PyMCTypes,
    PyMCPriorDistributionType,
    PyMCLikelihoodType,
    PyMCPoolingType,
    PyMCPriorParamsType,
    PyMCPriorSpecType,
    PyMCRegressionConfigType,
    PyMCHierarchicalConfigType,
    PyMCLayerSpecType,
    PyMCNamedPriorType,
    PyMCNamedMaskType,
    PyMCMultiLayerConfigType,
    PyMCNamedDataType,
    PyMCPredictConfigType,
    PyMCParameterEstimateType,
    PyMCParameterSummaryType,
    PyMCParameterDiagType,
    PyMCDiagnosticsResultType,
    PyMCObservedFitType,
    PyMCModelBlobType,
} from "./pymc/pymc.js";

// Lightning - PyTorch Lightning neural networks
export {
    Lightning,
    lightning_train,
    lightning_predict,
    lightning_encode,
    lightning_decode,
    LightningTypes,
    LightningOutputType,
    LightningArchitectureType,
    LightningEpochCallbackType,
    LightningConfigType,
    LightningResultType,
    LightningModelBlobType,
    Tensor3DBoolType,
} from "./lightning/lightning.js";

// MAPIE - Conformal prediction intervals
export {
    MAPIE,
    mapie_train_conformal_regressor,
    mapie_train_cqr,
    mapie_predict_interval,
    mapie_train_conformal_classifier,
    mapie_predict_set,
    MAPIETypes,
    ConformalMethodType,
    BaseModelType,
    MAPIEConfigType,
    MAPIECQRConfigType,
    ClassificationMethodType,
    BaseClassifierType,
    MAPIEClassifierConfigType,
    MAPIERegressorBlobType,
    MAPIEClassifierBlobType,
    IntervalResultType,
    PredictionSetResultType,
} from "./mapie/mapie.js";

// ALNS - Adaptive Large Neighborhood Search
export {
    ALNS,
    alns_optimize,
    ALNSTypes,
    SimulatedAnnealingConfigType,
    RecordToRecordConfigType,
    AcceptanceCriterionType,
    RouletteWheelConfigType,
    OperatorSelectionType,
    StopCriterionType,
    ALNSConfigType,
    ALNSResultType,
} from "./alns/alns.js";

// Optimization - Iterative coordinate descent
export {
    Optimization,
    optimization_iterative,
    optimization_iterative_incremental,
    OptimizationTypes,
    ParameterVectorType,
    IterativeObjectiveType,
    ElementObjectiveType,
    ParameterSpacesType,
    InitialStrategyType,
    EvaluationOrderType,
    IterativeConfigType,
    IterativeResultType,
} from "./optimization/optimization.js";

// Google OR-Tools - Constraint programming, routing, LP, graph algorithms
export {
    GoogleOr,
    GoogleOrTypes,
    google_or_cpsat_solve,
    google_or_cpsat_solve_all,
    google_or_routing_solve,
    google_or_linear_solve,
    google_or_min_cost_flow,
    google_or_max_flow,
    google_or_assignment,
    GoogleOrStatusType,
    CpSatIntVarType,
    CpSatBoolVarType,
    CpSatIntervalVarType,
    CpSatLinearTermType,
    CpSatLinearExprType,
    CpSatLiteralType,
    CpSatComparisonType,
    CpSatConstraintType,
    CpSatObjectiveType,
    CpSatModelType,
    CpSatConfigType,
    CpSatResultType,
    RoutingFirstSolutionType,
    RoutingMetaheuristicType,
    RoutingTimeWindowType,
    RoutingPickupDeliveryType,
    RoutingModelType,
    RoutingConfigType,
    RoutingRouteType,
    RoutingResultType,
    LinearVarType,
    LinearTermType,
    LinearConstraintDefType,
    LinearObjectiveType,
    LinearModelType,
    LinearSolverType,
    LinearConfigType,
    LinearResultType,
    MinCostFlowInputType,
    MinCostFlowResultType,
    MaxFlowInputType,
    MaxFlowResultType,
    AssignmentInputType,
    AssignmentMatchType,
    AssignmentResultType,
} from "./google_or/google_or.js";

// Simulation - Discrete event simulation (REA economic modeling)
export {
    Simulation,
    simulation_run,
    simulation_run_trajectories,
    SimulationTypes,
    SimulationConfigType,
    SimulationResultType,
    SimulationTrajectoriesConfigType,
    SimulationTrajectoriesResultType,
} from "./simulation/simulation.js";

// Shared types
export {
    VectorType as SharedVectorType,
    MatrixType as SharedMatrixType,
    ScalarObjectiveType as SharedScalarObjectiveType,
    VectorObjectiveType,
} from "./types.js";
