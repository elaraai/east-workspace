---
name: east-py-datascience
description: "Data science and machine learning platform functions for the East language (TypeScript types + directly-callable Python implementations). Use when writing East programs that need optimization (MADS, Optuna, SimAnneal, Scipy, Optimization, GoogleOr), machine learning (XGBoost, LightGBM, NGBoost, Torch MLP, Lightning, GP), Bayesian inference (PyMC), causal inference (Causal: DoWhy, EconML DML, ALE), simulation (Simulation DES), ML utilities (Sklearn preprocessing, metrics, splits), conformal prediction (MAPIE), or model explainability (SHAP). Triggers for: (1) Writing East programs with @elaraai/east-py-datascience, (2) Derivative-free optimization with MADS, (3) Bayesian optimization with Optuna, (4) Discrete/combinatorial optimization with SimAnneal, (5) Gradient boosting with XGBoost or LightGBM, (6) Probabilistic predictions with NGBoost or GP, (7) Neural networks with Torch MLP or Lightning, (8) Data preprocessing and metrics with Sklearn, (9) Conformal prediction intervals with MAPIE, (10) Model explainability with Shap, (11) Iterative coordinate descent with Optimization, (12) Constraint programming, vehicle routing, LP/MIP, or graph algorithms with GoogleOr, (13) Bayesian regression, hierarchical models, and multi-layer estimation with PyMC, (14) Economic ontology simulation via discrete event simulation with Simulation, (15) Causal effect estimation, refutation, CATE, and dose-response with Causal, (16) Calling the east_py_datascience *_impl functions directly from a project's own Python @platform_function."
---

# East Data Science

Data science and machine learning platform functions for the East language. Provides optimization, ML models, preprocessing, and explainability. This is the platform's **Reason** layer — these models earn their place by improving a decision (a forecast or optimization that feeds a `decision`), so wire their outputs toward one.

## Quick Start

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { MADS } from "@elaraai/east-py-datascience";

// Define objective function
const objective = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    return $.return(x0.multiply(x0).add(x1.multiply(x1)));
});

// Optimize
const optimize = East.function([], MADS.Types.ResultType, $ => {
    const x0 = $.let([0.5, 0.5]);
    const bounds = $.let({ lower: [-1.0, -1.0], upper: [1.0, 1.0] });
    const config = $.let({
        max_bb_eval: variant('some', 100n),
        display_degree: variant('some', 0n),
        direction_type: variant('none', null),
        initial_mesh_size: variant('none', null),
        min_mesh_size: variant('none', null),
        seed: variant('some', 42n),
    });
    return $.return(MADS.optimize(objective, x0, bounds, variant('none', null), config));
});
```

## Decision Tree: Which Module to Use

```
Task → What do you need?
    │
    ├─ MADS (derivative-free continuous optimization)
    │   └─ .optimize()
    │
    ├─ Optuna (Bayesian hyperparameter tuning)
    │   └─ .optimize()
    │
    ├─ SimAnneal (discrete/combinatorial optimization)
    │   └─ .optimize(), .optimizePermutation(), .optimizeSubset()
    │
    ├─ ALNS (adaptive large neighborhood search)
    │   └─ .optimize([SolutionType], initial, objective, destroys, repairs, config)
    │   └─ Generic over solution type S - define your own struct
    │
    ├─ Optimization (iterative coordinate descent)
    │   └─ .iterative(objective, paramSpaces, config)
    │
    ├─ GoogleOr (Google OR-Tools)
    │   ├─ CP-SAT → .cpsatSolve(), .cpsatSolveAll()
    │   ├─ Routing → .routingSolve() (TSP, CVRP, VRPTW, VRPPD)
    │   ├─ Linear → .linearSolve() (LP, MIP)
    │   └─ Graph → .minCostFlow(), .maxFlow(), .assignment()
    │
    ├─ Scipy
    │   ├─ Optimization → .optimizeMinimize(), .optimizeMinimizeQuadratic(), .optimizeDualAnnealing()
    │   ├─ Statistics → .statsDescribe(), .statsPearsonr(), .statsSpearmanr(), .statsPercentile(), .statsPercentileOfScore(), .statsIqr(), .statsMedian(), .statsMad(), .statsRobust()
    │   ├─ Histogram/KDE → .histogram(), .kdeFit(), .kdeEvaluate()
    │   ├─ Curve Fitting → .curveFit()
    │   └─ Interpolation → .interpolate1dFit(), .interpolate1dPredict()
    │
    ├─ XGBoost (gradient boosting)
    │   ├─ Train → .trainRegressor(), .trainClassifier(), .trainQuantile()
    │   └─ Predict → .predict(), .predictClass(), .predictProba(), .predictQuantile()
    │
    ├─ LightGBM (fast gradient boosting)
    │   ├─ Train → .trainRegressor(), .trainClassifier()
    │   └─ Predict → .predict(), .predictClass(), .predictProba()
    │
    ├─ NGBoost (probabilistic gradient boosting)
    │   ├─ Train → .trainRegressor()
    │   └─ Predict → .predict(), .predictDist()
    │
    ├─ Torch (neural networks)
    │   ├─ Train → .mlpTrain(), .mlpTrainMulti()
    │   ├─ Predict → .mlpPredict(), .mlpPredictMulti()
    │   └─ Embeddings → .mlpEncode(), .mlpDecode()
    │
    ├─ Lightning (PyTorch Lightning neural networks)
    │   ├─ Train → .train(X, y, config, masks, group_weights, conditions)
    │   ├─ Predict → .predict(model, X, masks, conditions)
    │   ├─ Embeddings → .encode(), .decode(), .decodeConditional() (autoencoder only)
    │   ├─ Architectures:
    │   │   ├─ mlp: simple feedforward
    │   │   ├─ autoencoder: encoder → latent → decoder
    │   │   ├─ conv1d: 1D convolutional autoencoder (temporal)
    │   │   ├─ sequential: LSTM/GRU autoencoder (temporal)
    │   │   └─ transformer: attention-based autoencoder (temporal)
    │   ├─ Output modes:
    │   │   ├─ regression: MSE loss
    │   │   ├─ binary: BCE loss, per-position pos_weights (VectorType), masks
    │   │   └─ multi_head: N independent CE heads, per-head class_weights, masks
    │   ├─ Conditional generation: condition_dim in temporal architectures
    │   └─ Features: early stopping, gradient clipping, epoch callbacks, group_weights
    │
    ├─ GP (Gaussian Process regression)
    │   ├─ Train → .train()
    │   └─ Predict → .predict(), .predictStd()
    │
    ├─ MAPIE (conformal prediction intervals)
    │   ├─ Regression → .trainConformalRegressor(), .trainCQR()
    │   ├─ Classification → .trainConformalClassifier()
    │   ├─ Predict → .predictInterval(), .predictSet()
    │   └─ SHAP integration → .uncertaintyPredictorRegressor(), .uncertaintyPredictorClassifier()
    │
    ├─ Sklearn (preprocessing, metrics & clustering)
    │   ├─ Splitting → .split() (N-way with stratify, overlap, multi_overlap)
    │   ├─ Overlap filtering → .overlap()
    │   ├─ Scaling → .standardScalerFit/Transform(), .minMaxScalerFit/Transform(), .robustScalerFit/Transform()
    │   ├─ Encoding → .labelEncoderFit/Transform/InverseTransform(), .ordinalEncoderFit/Transform()
    │   ├─ Class weights → .computeClassWeight()
    │   ├─ Regression metrics → .computeMetrics(), .computeMetricsMulti()
    │   ├─ Classification metrics → .computeClassificationMetrics(), .computeClassificationMetricsMulti()
    │   ├─ Probability metrics → .rocAucScore(), .logLoss(), .confusionMatrix()
    │   ├─ Multi-target → .regressorChainTrain(), .regressorChainPredict()
    │   ├─ GMM clustering → .gmmFit(), .gmmPredict(), .gmmPredictProba(), .gmmScoreSamples(), .gmmSample(), .gmmBic(), .gmmAic()
    │   └─ Clustering evaluation → .silhouetteScore()
    │
    ├─ PyMC (Bayesian inference)
    │   ├─ Train → .trainRegression(), .trainHierarchical(), .trainMultiLayer()
    │   ├─ Predict → .predict(), .predictDistribution()
    │   ├─ Posterior → .posteriorSummary(), .posteriorSamples()
    │   └─ Diagnostics → .diagnostics(), .posteriorPredictiveCheck()
    │
    ├─ Simulation (economic ontology simulation via DES)
    │   └─ Single run → .run([R, E], initialState, initialEvents, process, config)
    │
    ├─ Causal (causal inference: effects, refutation, CATE, dose-response)
    │   ├─ Effect estimate → .effect(data, config) (backdoor linear_regression /
    │   │   propensity_score_weighting; ate/att/atc; overlap or bounds trim;
    │   │   cluster bootstrap CI)
    │   ├─ Refutation → .refute(data, config, refuter) (placebo_treatment,
    │   │   random_common_cause, data_subset, unobserved_common_cause sensitivity)
    │   ├─ Heterogeneous effects (EconML LinearDML) → .dmlTrain(Y, T, X, W, config),
    │   │   .dmlEffect(model, X) (per-row CATE), .dmlAte(model, X) (ATE + CI)
    │   └─ Dose-response → .ale(data, config) (accumulated local effects, CI bands)
    │
    └─ Shap (model explainability)
        ├─ Create → .treeExplainerCreate() (XGBoost only), .kernelExplainerCreate() (any model)
        ├─ Compute → .computeValues(), .featureImportance()
        └─ Supports → TreeExplainer: XGBoost; KernelExplainer: XGBoost, LightGBM, NGBoost, GP, Torch, RegressorChain, MAPIE
```

## Common Types

| Type | Definition | Description |
|------|------------|-------------|
| `VectorType` | `ArrayType(FloatType)` | 1D array of floats (e.g., `[1.0, 2.0, 3.0]`) |
| `MatrixType` | `ArrayType(ArrayType(FloatType))` | 2D array of floats (e.g., `[[1.0, 2.0], [3.0, 4.0]]`) |
| `LabelVectorType` | `ArrayType(IntegerType)` | Class labels as integers (e.g., `[0n, 1n, 0n, 2n]`) |
| `ModelBlobType` | `BlobType` | Serialized model (opaque, pass to predict functions) |

## Available Modules

| Module | Import | Purpose |
|--------|--------|---------|
| MADS | `import { MADS } from "@elaraai/east-py-datascience"` | Derivative-free blackbox optimization |
| Optuna | `import { Optuna } from "@elaraai/east-py-datascience"` | Bayesian optimization (hyperparameter tuning) |
| SimAnneal | `import { SimAnneal } from "@elaraai/east-py-datascience"` | Simulated annealing (permutation/subset) |
| ALNS | `import { ALNS } from "@elaraai/east-py-datascience"` | Adaptive Large Neighborhood Search (generic over solution type) |
| Scipy | `import { Scipy } from "@elaraai/east-py-datascience"` | Statistics, optimization, interpolation |
| XGBoost | `import { XGBoost } from "@elaraai/east-py-datascience"` | Gradient boosting (regression/classification/quantile) |
| LightGBM | `import { LightGBM } from "@elaraai/east-py-datascience"` | Fast gradient boosting |
| NGBoost | `import { NGBoost } from "@elaraai/east-py-datascience"` | Probabilistic gradient boosting |
| Torch | `import { Torch } from "@elaraai/east-py-datascience"` | Neural networks (MLP) |
| Lightning | `import { Lightning } from "@elaraai/east-py-datascience"` | PyTorch Lightning neural networks |
| GP | `import { GP } from "@elaraai/east-py-datascience"` | Gaussian Process regression |
| MAPIE | `import { MAPIE } from "@elaraai/east-py-datascience"` | Conformal prediction intervals |
| Sklearn | `import { Sklearn } from "@elaraai/east-py-datascience"` | Preprocessing, metrics, data splitting |
| Shap | `import { Shap } from "@elaraai/east-py-datascience"` | Model explainability (SHAP values) |
| Optimization | `import { Optimization } from "@elaraai/east-py-datascience"` | Iterative coordinate descent optimization |
| GoogleOr | `import { GoogleOr } from "@elaraai/east-py-datascience"` | OR-Tools: CP-SAT, routing, LP/MIP, graph algorithms |
| PyMC | `import { PyMC } from "@elaraai/east-py-datascience"` | Bayesian regression, hierarchical models, multi-layer estimation |
| Simulation | `import { Simulation } from "@elaraai/east-py-datascience"` | Economic ontology simulation via DES |
| Causal | `import { Causal } from "@elaraai/east-py-datascience"` | Causal inference: DoWhy backdoor effects + refuters, EconML LinearDML CATE, ALE dose-response |

## Accessing Types

```typescript
import { MADS, Optuna, Sklearn, XGBoost, ALNS } from "@elaraai/east-py-datascience";

// Access types via Module.Types.TypeName
MADS.Types.VectorType          // ArrayType(FloatType)
MADS.Types.BoundsType          // StructType({ lower, upper })
MADS.Types.ResultType          // StructType({ x_best, f_best, ... })

Optuna.Types.ParamSpaceType    // Parameter definition
Optuna.Types.StudyResultType   // Optimization result

ALNS.Types.ConfigType          // ALNS configuration
ALNS.Types.ResultType          // Result with "S" placeholder for solution type

Sklearn.Types.SplitConfigType  // Train/test split config
XGBoost.Types.ModelBlobType    // Trained model
```

## Common Patterns

### Train and Predict

```typescript
// 1. Prepare data
const X = $.let([[...], [...], ...]);
const y = $.let([...]);

// 2. Configure and train
const config = $.let({ /* options with variant('some', value) or variant('none', null) */ });
const model = $.let(Module.train(X, y, config));

// 3. Predict
const predictions = $.let(Module.predict(model, X_test));
```

### Optimization

```typescript
// 1. Define objective function
const objective = East.function([VectorType], FloatType, ($, x) => {
    // compute and return objective value
});

// 2. Set bounds and config
const bounds = $.let({ lower: [...], upper: [...] });
const config = $.let({ /* options */ });

// 3. Optimize
const result = $.let(Module.optimize(objective, x0, bounds, config));
// result.x_best, result.f_best
```

## Calling from Python (direct `*_impl` functions)

Every platform function has a Python implementation in the `east_py_datascience`
package that is a **plain callable taking and returning East values** — no IR,
no compile. A project's own `@platform_function` can import and call them
directly (the preferred way to use lightning/torch/xgboost/sklearn/etc. from
project Python code). Each module re-exports its functions from its package:

```python
from east import (EastMatrix, EastVector, FloatType, MatrixType, VectorType,
                  coerce_to, platform_function)
from east_py_datascience.xgboost import (
    XGBoostConfigType, xgboost_train_regressor_impl, xgboost_predict_impl)

@platform_function(inputs=[MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType)],
                   output=VectorType(FloatType))
def forecast(X_train, y_train, X_new):
    # Build the config struct from a plain dict - coerce_to fills Option fields
    config = coerce_to({
        "n_estimators": 200, "max_depth": 4, "learning_rate": 0.05,
        "min_child_weight": None, "subsample": None, "colsample_bytree": None,
        "reg_alpha": None, "reg_lambda": None, "gamma": None,
        "random_state": 42, "n_jobs": None, "sample_weight": None,
        "categorical_features": None, "categorical_n": None,
        "max_cat_to_onehot": None, "max_cat_threshold": None,
    }, XGBoostConfigType)
    model = xgboost_train_regressor_impl(X_train, y_train, config)   # East blob in/out
    return xgboost_predict_impl(model, X_new)
```

Rules:

- **Inputs are East values, not numpy** — `EastMatrix`/`EastVector` for data,
  `EastStruct` configs (build with `coerce_to(dict, ConfigType)` — plain
  `None`/scalars coerce to the `Option` fields), `EastVariant` for variants
  (`variant('some', x)` / option fields via `coerce_to`).
- **Config and blob types are defined Python-side** in each
  `east_py_datascience.<module>` (e.g. `XGBoostConfigType`,
  `XGBoostModelBlobType`) — mirror images of the TS `Module.Types.*`.
- **Model blobs round-trip**: the variant blob a train function returns is
  exactly what the predict/explain functions accept — store it, pass it
  between platform functions, or hand it to `Shap`.
- **Registering everything instead**: `from east_py_datascience import platform`
  and pass it to `compile_async()` to wire all functions to East IR (this is
  what the e3 Python runner does).
- Optional deps gate at call time: functions raise `NotImplementedError`
  naming the missing extra (e.g. `east-py-datascience[causal]`).

For the East-value API itself (eager methods, `coerce_to`, `to_numpy`/`to_torch`,
`@platform_function`), load the **east-py** skill.

## Related skills

- **e3** — **required to run these**: they need the Python runtime, so wrap each in an `e3.task` with a Python runner (`{ runner: ['uv','run','east-py','run','-p','east-py-datascience'] }`). They do not run on the default Node / C runtime.
- **east** — the language for objective functions, configs, and result handling.
- **east-py** — the Python runtime: East values as plain Python data, eager methods, and the `@platform_function` on-ramp — pairs with the direct `*_impl` calls above.
- **east-ontology** — the decisions these models improve are the `decision` nodes of the business's economic ontology.
- **east-design** — place the forecast / optimization in a decision-oriented architecture.
