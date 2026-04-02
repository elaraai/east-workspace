/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PyMC Bayesian inference platform functions for East.
 *
 * Provides Bayesian linear regression, hierarchical models, and multi-layer
 * joint estimation with full posterior analysis using PyMC.
 * Uses cloudpickle for model serialization.
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    IntegerType,
    FloatType,
    BooleanType,
    BlobType,
    StringType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Enum Types
// ============================================================================

/**
 * Prior distribution type for PyMC parameters.
 */
export const PyMCPriorDistributionType = VariantType({
    /** Half-normal distribution (positive only) */
    halfnormal: NullType,
    /** Log-normal distribution */
    lognormal: NullType,
    /** Normal (Gaussian) distribution */
    normal: NullType,
    /** Half-Cauchy distribution (heavy tails, positive only) */
    halfcauchy: NullType,
    /** Exponential distribution */
    exponential: NullType,
    /** Uniform distribution */
    uniform: NullType,
    /** Horseshoe prior (sparsity-inducing) */
    horseshoe: NullType,
});

/**
 * Likelihood function type.
 */
export const PyMCLikelihoodType = VariantType({
    /** Normal (Gaussian) likelihood */
    normal: NullType,
    /** Student-t likelihood (robust to outliers) */
    studentt: NullType,
    /** Poisson likelihood (count data) */
    poisson: NullType,
});

/**
 * Pooling type for hierarchical models.
 */
export const PyMCPoolingType = VariantType({
    /** No pooling (independent per group) */
    none: NullType,
    /** Partial pooling (shared hyperpriors) */
    partial: NullType,
    /** Full pooling (all groups share same parameters) */
    full: NullType,
});

// ============================================================================
// Config Types
// ============================================================================

/**
 * Prior distribution parameters.
 */
export const PyMCPriorParamsType = StructType({
    /** Mean (for normal/lognormal) */
    mu: OptionType(MatrixType(FloatType)),
    /** Standard deviation */
    sigma: OptionType(MatrixType(FloatType)),
    /** Precision (for exponential rate) */
    tau: OptionType(FloatType),
    /** Lower bound (for uniform) */
    lower: OptionType(FloatType),
    /** Upper bound (for uniform) */
    upper: OptionType(FloatType),
});

/**
 * Prior specification combining distribution and parameters.
 */
export const PyMCPriorSpecType = StructType({
    /** Distribution type */
    distribution: PyMCPriorDistributionType,
    /** Distribution parameters */
    params: PyMCPriorParamsType,
});

/**
 * Configuration for Bayesian linear regression.
 */
export const PyMCRegressionConfigType = StructType({
    /** Prior specification for coefficients */
    prior: OptionType(PyMCPriorSpecType),
    /** Likelihood function */
    likelihood: OptionType(PyMCLikelihoodType),
    /** Whether to include intercept term (default true) */
    include_intercept: OptionType(BooleanType),
    /** Number of posterior samples (default 1000) */
    samples: OptionType(IntegerType),
    /** Number of tuning steps (default 1000) */
    tune: OptionType(IntegerType),
    /** Number of MCMC chains (default 2) */
    chains: OptionType(IntegerType),
    /** Target acceptance rate (default 0.8) */
    target_accept: OptionType(FloatType),
});

/**
 * Configuration for hierarchical models.
 */
export const PyMCHierarchicalConfigType = StructType({
    /** Prior specification for coefficients */
    prior: OptionType(PyMCPriorSpecType),
    /** Likelihood function */
    likelihood: OptionType(PyMCLikelihoodType),
    /** Pooling type (default partial) */
    pooling: OptionType(PyMCPoolingType),
    /** Number of posterior samples (default 1000) */
    samples: OptionType(IntegerType),
    /** Number of tuning steps (default 1000) */
    tune: OptionType(IntegerType),
    /** Number of MCMC chains (default 2) */
    chains: OptionType(IntegerType),
    /** Target acceptance rate (default 0.8) */
    target_accept: OptionType(FloatType),
});

/**
 * Layer specification for multi-layer models.
 */
export const PyMCLayerSpecType = StructType({
    /** Layer name */
    name: StringType,
    /** Input data name */
    input: StringType,
    /** Output data name */
    output: StringType,
    /** Parameter name for coefficients */
    parameter: StringType,
    /** Likelihood function */
    likelihood: OptionType(PyMCLikelihoodType),
});

/**
 * Named prior specification.
 */
export const PyMCNamedPriorType = StructType({
    /** Parameter name this prior applies to */
    name: StringType,
    /** Prior specification */
    prior: PyMCPriorSpecType,
});

/**
 * Named boolean mask.
 */
export const PyMCNamedMaskType = StructType({
    /** Parameter name this mask applies to */
    name: StringType,
    /** Boolean mask matrix (true = estimate, false = fix to zero) */
    mask: MatrixType(BooleanType),
});

/**
 * Configuration for multi-layer joint estimation.
 */
export const PyMCMultiLayerConfigType = StructType({
    /** Layer specifications */
    layers: ArrayType(PyMCLayerSpecType),
    /** Named priors for parameters */
    priors: OptionType(ArrayType(PyMCNamedPriorType)),
    /** Named masks for parameter sparsity */
    masks: OptionType(ArrayType(PyMCNamedMaskType)),
    /** Number of posterior samples (default 1000) */
    samples: OptionType(IntegerType),
    /** Number of tuning steps (default 1000) */
    tune: OptionType(IntegerType),
    /** Number of MCMC chains (default 2) */
    chains: OptionType(IntegerType),
    /** Target acceptance rate (default 0.8) */
    target_accept: OptionType(FloatType),
    /** Force full MCMC even for large models (default false) */
    force_full_mcmc: OptionType(BooleanType),
    /** L1 regularization alpha for fallback (default 0.01) */
    fallback_l1_alpha: OptionType(FloatType),
});

/**
 * Named data for multi-layer models.
 */
export const PyMCNamedDataType = StructType({
    /** Data name */
    name: StringType,
    /** Data matrix */
    data: MatrixType(FloatType),
});

/**
 * Prediction configuration.
 */
export const PyMCPredictConfigType = StructType({
    /** Layer name to predict from (for multi-layer models) */
    layer: OptionType(StringType),
    /** Number of posterior samples to use for prediction (default 100) */
    n_samples: OptionType(IntegerType),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Individual parameter estimate with diagnostics.
 */
export const PyMCParameterEstimateType = StructType({
    /** Row index in parameter matrix */
    index_row: IntegerType,
    /** Column index in parameter matrix */
    index_col: IntegerType,
    /** Posterior mean */
    mean: FloatType,
    /** Posterior median */
    median: FloatType,
    /** Posterior standard deviation */
    sd: FloatType,
    /** Lower 95% credible interval */
    ci_lower: FloatType,
    /** Upper 95% credible interval */
    ci_upper: FloatType,
    /** R-hat convergence diagnostic */
    rhat: FloatType,
    /** Effective sample size */
    ess: FloatType,
});

/**
 * Summary for one named parameter.
 */
export const PyMCParameterSummaryType = StructType({
    /** Parameter name */
    parameter: StringType,
    /** Number of rows */
    shape_rows: IntegerType,
    /** Number of columns */
    shape_cols: IntegerType,
    /** Per-element estimates */
    estimates: ArrayType(PyMCParameterEstimateType),
});

/**
 * Diagnostics for one parameter.
 */
export const PyMCParameterDiagType = StructType({
    /** Parameter name */
    parameter: StringType,
    /** Maximum R-hat across elements */
    rhat_max: FloatType,
    /** Minimum ESS across elements */
    ess_min: FloatType,
    /** Number of divergent transitions */
    n_divergent: IntegerType,
});

/**
 * Overall diagnostics result.
 */
export const PyMCDiagnosticsResultType = StructType({
    /** Whether all diagnostics indicate convergence */
    converged: BooleanType,
    /** Total number of divergent transitions */
    n_divergences: IntegerType,
    /** Per-parameter diagnostics */
    parameters: ArrayType(PyMCParameterDiagType),
    /** Warning messages */
    warnings: ArrayType(StringType),
});

/**
 * Observed fit metrics for posterior predictive checks.
 */
export const PyMCObservedFitType = StructType({
    /** Target column name or index */
    name: StringType,
    /** Mean absolute error */
    mae: FloatType,
    /** Pearson correlation */
    correlation: FloatType,
    /** 95% credible interval coverage */
    coverage_95: FloatType,
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized PyMC models.
 */
export const PyMCModelBlobType = VariantType({
    /** Bayesian linear regression model */
    pymc_regression: StructType({
        /** Cloudpickle serialized model data */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of target columns */
        n_targets: IntegerType,
        /** Whether intercept is included */
        include_intercept: BooleanType,
    }),
    /** Hierarchical Bayesian model */
    pymc_hierarchical: StructType({
        /** Cloudpickle serialized model data */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of target columns */
        n_targets: IntegerType,
        /** Number of groups */
        n_groups: IntegerType,
    }),
    /** Multi-layer joint estimation model */
    pymc_multi_layer: StructType({
        /** Cloudpickle serialized model data */
        data: BlobType,
        /** Layer names */
        layer_names: ArrayType(StringType),
        /** Parameter names */
        parameter_names: ArrayType(StringType),
    }),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Train a Bayesian linear regression model.
 *
 * @param X - Feature matrix (n_samples x n_features)
 * @param Y - Target matrix (n_samples x n_targets)
 * @param config - Regression configuration
 * @returns Trained PyMC model blob
 */
export const pymc_train_regression = East.platform(
    "pymc_train_regression",
    [MatrixType(FloatType), MatrixType(FloatType), PyMCRegressionConfigType],
    PyMCModelBlobType
);

/**
 * Train a hierarchical Bayesian model.
 *
 * @param X - Feature matrix (n_samples x n_features)
 * @param Y - Target matrix (n_samples x n_targets)
 * @param groups - Group assignments per sample
 * @param config - Hierarchical configuration
 * @returns Trained PyMC model blob
 */
export const pymc_train_hierarchical = East.platform(
    "pymc_train_hierarchical",
    [MatrixType(FloatType), MatrixType(FloatType), VectorType(IntegerType), PyMCHierarchicalConfigType],
    PyMCModelBlobType
);

/**
 * Train a multi-layer joint estimation model.
 *
 * @param data - Array of named data matrices
 * @param config - Multi-layer configuration
 * @returns Trained PyMC model blob
 */
export const pymc_train_multi_layer = East.platform(
    "pymc_train_multi_layer",
    [ArrayType(PyMCNamedDataType), PyMCMultiLayerConfigType],
    PyMCModelBlobType
);

/**
 * Make point predictions (posterior mean).
 *
 * @param model - Trained PyMC model blob
 * @param X - Feature matrix
 * @param config - Prediction configuration
 * @returns Predicted values matrix
 */
export const pymc_predict = East.platform(
    "pymc_predict",
    [PyMCModelBlobType, MatrixType(FloatType), PyMCPredictConfigType],
    MatrixType(FloatType)
);

/**
 * Make predictions returning full posterior distribution.
 *
 * Returns matrix where each row is a posterior sample prediction.
 *
 * @param model - Trained PyMC model blob
 * @param X - Feature matrix
 * @param config - Prediction configuration
 * @returns Posterior predictive samples matrix
 */
export const pymc_predict_distribution = East.platform(
    "pymc_predict_distribution",
    [PyMCModelBlobType, MatrixType(FloatType), PyMCPredictConfigType],
    MatrixType(FloatType)
);

/**
 * Get posterior parameter summaries.
 *
 * @param model - Trained PyMC model blob
 * @returns Array of parameter summaries
 */
export const pymc_posterior_summary = East.platform(
    "pymc_posterior_summary",
    [PyMCModelBlobType],
    ArrayType(PyMCParameterSummaryType)
);

/**
 * Extract raw posterior samples for a named parameter.
 *
 * @param model - Trained PyMC model blob
 * @param param_name - Parameter name
 * @param n_samples - Number of samples to return
 * @returns Matrix of posterior samples
 */
export const pymc_posterior_samples = East.platform(
    "pymc_posterior_samples",
    [PyMCModelBlobType, StringType, IntegerType],
    MatrixType(FloatType)
);

/**
 * Run convergence diagnostics on a trained model.
 *
 * @param model - Trained PyMC model blob
 * @returns Diagnostics result
 */
export const pymc_diagnostics = East.platform(
    "pymc_diagnostics",
    [PyMCModelBlobType],
    PyMCDiagnosticsResultType
);

/**
 * Posterior predictive check against observed data.
 *
 * @param model - Trained PyMC model blob
 * @param X - Feature matrix
 * @param Y_observed - Observed target matrix
 * @returns Array of fit metrics per target
 */
export const pymc_posterior_predictive_check = East.platform(
    "pymc_posterior_predictive_check",
    [PyMCModelBlobType, MatrixType(FloatType), MatrixType(FloatType)],
    ArrayType(PyMCObservedFitType)
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for PyMC functions.
 */
export const PyMCTypes = {
    /** Prior distribution type */
    PyMCPriorDistributionType,
    /** Likelihood type */
    PyMCLikelihoodType,
    /** Pooling type */
    PyMCPoolingType,
    /** Prior parameters */
    PyMCPriorParamsType,
    /** Prior specification */
    PyMCPriorSpecType,
    /** Regression configuration */
    PyMCRegressionConfigType,
    /** Hierarchical configuration */
    PyMCHierarchicalConfigType,
    /** Layer specification */
    PyMCLayerSpecType,
    /** Named prior */
    PyMCNamedPriorType,
    /** Named mask */
    PyMCNamedMaskType,
    /** Multi-layer configuration */
    PyMCMultiLayerConfigType,
    /** Named data */
    PyMCNamedDataType,
    /** Prediction configuration */
    PyMCPredictConfigType,
    /** Parameter estimate */
    PyMCParameterEstimateType,
    /** Parameter summary */
    PyMCParameterSummaryType,
    /** Parameter diagnostics */
    PyMCParameterDiagType,
    /** Diagnostics result */
    PyMCDiagnosticsResultType,
    /** Observed fit metrics */
    PyMCObservedFitType,
    /** Model blob type */
    ModelBlobType: PyMCModelBlobType,
} as const;

/**
 * PyMC Bayesian inference.
 *
 * Provides Bayesian linear regression, hierarchical models, and multi-layer
 * joint estimation with full posterior analysis.
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { PyMC } from "@elaraai/east-py-datascience";
 *
 * const train = East.function([], PyMC.Types.ModelBlobType, $ => {
 *     const X = $.let([[1.0], [2.0], [3.0], [4.0]]);
 *     const Y = $.let([[2.0], [4.0], [6.0], [8.0]]);
 *     const config = $.let({
 *         prior: variant('none', null),
 *         likelihood: variant('none', null),
 *         include_intercept: variant('some', true),
 *         samples: variant('some', 100n),
 *         tune: variant('some', 50n),
 *         chains: variant('some', 1n),
 *         target_accept: variant('none', null),
 *     });
 *     return $.return(PyMC.trainRegression(X, Y, config));
 * });
 * ```
 */
export const PyMC = {
    /**
     * Train a Bayesian linear regression model.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { PyMC, PyMCRegressionConfigType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [MatrixType(FloatType), MatrixType(FloatType)],
     *     PyMC.Types.ModelBlobType,
     *     ($, X, Y) => {
     *         const config = $.let({
     *             prior: variant("none", null),
     *             likelihood: variant("none", null),
     *             include_intercept: variant("some", true),
     *             samples: variant("some", 1000n),
     *             tune: variant("some", 1000n),
     *             chains: variant("some", 2n),
     *             target_accept: variant("none", null),
     *         }, PyMCRegressionConfigType);
     *         return $.return(PyMC.trainRegression(X, Y, config));
     *     }
     * );
     * ```
     */
    trainRegression: pymc_train_regression,
    /**
     * Train a hierarchical Bayesian model.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, variant } from "@elaraai/east";
     * import { PyMC, PyMCHierarchicalConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [MatrixType(FloatType), MatrixType(FloatType), VectorType(IntegerType)],
     *     PyMC.Types.ModelBlobType,
     *     ($, X, Y, groups) => {
     *         const config = $.let({
     *             prior: variant("none", null),
     *             likelihood: variant("none", null),
     *             pooling: variant("some", variant("partial", null)),
     *             samples: variant("some", 1000n),
     *             tune: variant("some", 1000n),
     *             chains: variant("some", 2n),
     *             target_accept: variant("none", null),
     *         }, PyMCHierarchicalConfigType);
     *         return $.return(PyMC.trainHierarchical(X, Y, groups, config));
     *     }
     * );
     * ```
     */
    trainHierarchical: pymc_train_hierarchical,
    /**
     * Train a multi-layer joint estimation model.
     *
     * @example
     * ```ts
     * import { East, ArrayType, variant } from "@elaraai/east";
     * import { PyMC, PyMCMultiLayerConfigType, PyMCNamedDataType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [ArrayType(PyMCNamedDataType)],
     *     PyMC.Types.ModelBlobType,
     *     ($, data) => {
     *         const config = $.let({
     *             layers: [{
     *                 name: "layer1",
     *                 input: "X",
     *                 output: "Y",
     *                 parameter: "beta",
     *                 likelihood: variant("none", null),
     *             }],
     *             priors: variant("none", null),
     *             masks: variant("none", null),
     *             samples: variant("some", 1000n),
     *             tune: variant("some", 1000n),
     *             chains: variant("some", 2n),
     *             target_accept: variant("none", null),
     *             force_full_mcmc: variant("none", null),
     *             fallback_l1_alpha: variant("none", null),
     *         }, PyMCMultiLayerConfigType);
     *         return $.return(PyMC.trainMultiLayer(data, config));
     *     }
     * );
     * ```
     */
    trainMultiLayer: pymc_train_multi_layer,
    /**
     * Make point predictions (posterior mean).
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { PyMC, PyMCPredictConfigType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const predict = East.function(
     *     [PyMC.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         const config = $.let({
     *             layer: variant("none", null),
     *             n_samples: variant("some", 100n),
     *         }, PyMCPredictConfigType);
     *         return $.return(PyMC.predict(model, X, config));
     *     }
     * );
     * ```
     */
    predict: pymc_predict,
    /**
     * Make predictions returning full posterior distribution.
     *
     * Returns matrix where each row is a posterior sample prediction.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { PyMC, PyMCPredictConfigType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const predictDist = East.function(
     *     [PyMC.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         const config = $.let({
     *             layer: variant("none", null),
     *             n_samples: variant("some", 200n),
     *         }, PyMCPredictConfigType);
     *         return $.return(PyMC.predictDistribution(model, X, config));
     *     }
     * );
     * ```
     */
    predictDistribution: pymc_predict_distribution,
    /**
     * Get posterior parameter summaries.
     *
     * @example
     * ```ts
     * import { East, ArrayType } from "@elaraai/east";
     * import { PyMC } from "@elaraai/east-py-datascience";
     *
     * const getSummary = East.function(
     *     [PyMC.Types.ModelBlobType],
     *     ArrayType(PyMC.Types.PyMCParameterSummaryType),
     *     ($, model) => {
     *         return $.return(PyMC.posteriorSummary(model));
     *     }
     * );
     * ```
     */
    posteriorSummary: pymc_posterior_summary,
    /**
     * Extract raw posterior samples for a named parameter.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, StringType } from "@elaraai/east";
     * import { PyMC, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const getSamples = East.function(
     *     [PyMC.Types.ModelBlobType, StringType, IntegerType],
     *     MatrixType(FloatType),
     *     ($, model, paramName, nSamples) => {
     *         return $.return(PyMC.posteriorSamples(model, paramName, nSamples));
     *     }
     * );
     * ```
     */
    posteriorSamples: pymc_posterior_samples,
    /**
     * Run convergence diagnostics on a trained model.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { PyMC } from "@elaraai/east-py-datascience";
     *
     * const diagnose = East.function(
     *     [PyMC.Types.ModelBlobType],
     *     PyMC.Types.PyMCDiagnosticsResultType,
     *     ($, model) => {
     *         const result = $.let(PyMC.diagnostics(model));
     *         // result.converged, result.n_divergences, result.warnings
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    diagnostics: pymc_diagnostics,
    /**
     * Posterior predictive check against observed data.
     *
     * @example
     * ```ts
     * import { East, FloatType, ArrayType } from "@elaraai/east";
     * import { PyMC, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const check = East.function(
     *     [PyMC.Types.ModelBlobType, MatrixType(FloatType), MatrixType(FloatType)],
     *     ArrayType(PyMC.Types.PyMCObservedFitType),
     *     ($, model, X, Y_observed) => {
     *         const result = $.let(PyMC.posteriorPredictiveCheck(model, X, Y_observed));
     *         // Each element has: name, mae, correlation, coverage_95
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    posteriorPredictiveCheck: pymc_posterior_predictive_check,
    /** Type definitions */
    Types: PyMCTypes,
} as const;
