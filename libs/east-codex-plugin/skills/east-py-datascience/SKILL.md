---
name: east-py-datascience
description: "Data science and machine learning platform functions for the East language (TypeScript types + directly-callable Python implementations). Use when writing East programs that need optimization (MADS, Optuna, SimAnneal, ALNS, Scipy, Optimization, GoogleOr), machine learning (XGBoost, LightGBM, NGBoost, Torch MLP, Lightning, GP), Bayesian inference (PyMC), causal inference (Causal: DoWhy, EconML DML, ALE), simulation (Simulation DES), ML utilities (Sklearn preprocessing, metrics, splits), conformal prediction (MAPIE), or model explainability (SHAP). Triggers for: (1) Writing East programs with @elaraai/east-py-datascience, (2) Derivative-free optimization with MADS, (3) Bayesian optimization with Optuna, (4) Discrete/combinatorial optimization with SimAnneal or ALNS, (5) Gradient boosting with XGBoost or LightGBM, (6) Probabilistic predictions with NGBoost or GP, (7) Neural networks with Torch MLP or Lightning, (8) Data… See the detailed scope below."
---

## Detailed skill scope

Data science and machine learning platform functions for the East language (TypeScript types + directly-callable Python implementations). Use when writing East programs that need optimization (MADS, Optuna, SimAnneal, ALNS, Scipy, Optimization, GoogleOr), machine learning (XGBoost, LightGBM, NGBoost, Torch MLP, Lightning, GP), Bayesian inference (PyMC), causal inference (Causal: DoWhy, EconML DML, ALE), simulation (Simulation DES), ML utilities (Sklearn preprocessing, metrics, splits), conformal prediction (MAPIE), or model explainability (SHAP). Triggers for: (1) Writing East programs with @elaraai/east-py-datascience, (2) Derivative-free optimization with MADS, (3) Bayesian optimization with Optuna, (4) Discrete/combinatorial optimization with SimAnneal or ALNS, (5) Gradient boosting with XGBoost or LightGBM, (6) Probabilistic predictions with NGBoost or GP, (7) Neural networks with Torch MLP or Lightning, (8) Data preprocessing and metrics with Sklearn, (9) Conformal prediction intervals with MAPIE, (10) Model explainability with Shap, (11) Iterative coordinate descent with Optimization, (12) Constraint programming, vehicle routing, LP/MIP, or graph algorithms with GoogleOr, (13) Bayesian regression, hierarchical models, and multi-layer estimation with PyMC, (14) Economic ontology simulation via discrete event simulation with Simulation, (15) One declarative causal experiment — naive vs adjusted effect, overlap, robustness, and an honesty verdict — with Causal.experiment, (16) Calling the east_py_datascience functions (xgboost_train_regressor, mads_optimize, …) from a project's own Python @East.platform_function, or inside an East.function body — the same object does both.

# East Data Science

Data science and machine learning platform functions for East: optimisation,
ML models, Bayesian and causal inference, simulation, preprocessing and
explainability. This is the platform's **Reason** layer — a model earns its
place by improving a decision (a forecast or optimisation that feeds a
`decision`), so wire its outputs toward one. The functions run on the python
runtime only: an e3 task needs a python runner (see Related skills).

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

## Quick Start

```typescript
import { East, FloatType, VectorType, none, some } from "@elaraai/east";
import { MADS } from "@elaraai/east-py-datascience";

// Tune feed rate and temperature to minimise a defect rate
export const tune = East.function([], MADS.Types.ResultType, $ => {
    const objective = $.const(East.function([VectorType(FloatType)], FloatType, ($, x) => {
        const feed = $.let(x.get(0n).subtract(5.0));
        const temp = $.let(x.get(1n).subtract(180.0));
        $.return(feed.multiply(feed).add(temp.multiply(temp).multiply(0.01)));
    }));
    const x0 = $.let(East.Vector.fromArray([8.0, 200.0]));
    const bounds = $.let({ lower: East.Vector.fromArray([1.0, 100.0]), upper: East.Vector.fromArray([10.0, 250.0]) });
    const config = $.let({
        max_bb_eval: some(100n), display_degree: some(0n), direction_type: none,
        initial_mesh_size: none, min_mesh_size: none, seed: some(42n),
    });
    $.return(MADS.optimize(objective, x0, bounds, none, config));   // none: no constraints
});
```

## Decision Tree: Which Module to Use

```
Task → What do you need?
    │
    ├─ MADS (derivative-free continuous optimisation) → .optimize(objective, x0, bounds, constraints: Option, config)
    ├─ Optuna (Bayesian hyperparameter tuning) → .optimize()
    ├─ SimAnneal (discrete / combinatorial) → .optimize(), .optimizePermutation(), .optimizeSubset()
    ├─ ALNS (adaptive large neighbourhood search) → .optimize([SolutionType], initial, objective, destroys, repairs, config)
    │   — generic over the solution type S: define your own struct
    ├─ Optimization (iterative coordinate descent over integer vectors)
    │   ├─ .iterative(objective, paramSpaces, config) — the whole objective per move
    │   ├─ .iterativeIncremental(elementObjective, paramSpaces, config) — a per-element contribution, recomputed only
    │   │   where a move changed it (coordinate or swap mode)
    │   └─ .iterativeGrouped(groupObjective, paramSpaces, config) — contributions grouped by VALUE (employees, bins,
    │       vehicles): a move from A to B recomputes groups A and B
    ├─ GoogleOr (OR-Tools)
    │   ├─ CP-SAT → .cpsatSolve(), .cpsatSolveAll()
    │   ├─ Routing → .routingSolve() (TSP, CVRP, VRPTW, VRPPD)
    │   ├─ Linear → .linearSolve() (LP, MIP)
    │   └─ Graph → .minCostFlow(), .maxFlow(), .assignment() (dense cost matrix),
    │              .minCostAssignment() (sparse arcs, task capacity, opt-out penalty)
    ├─ Scipy
    │   ├─ Optimisation → .optimizeMinimize(), .optimizeMinimizeQuadratic(), .optimizeDualAnnealing()
    │   ├─ Statistics → .statsDescribe(), .statsPearsonr(), .statsSpearmanr(), .statsPercentile(), .statsPercentileOfScore(),
    │   │               .statsIqr(), .statsMedian(), .statsMad(), .statsRobust()
    │   ├─ Histogram / KDE → .histogram(), .kdeFit(), .kdeEvaluate()
    │   ├─ Curve fitting → .curveFit()
    │   └─ Interpolation → .interpolate1dFit(), .interpolate1dPredict()
    ├─ XGBoost → train .trainRegressor(), .trainClassifier(), .trainQuantile() · predict .predict(), .predictClass(),
    │            .predictProba(), .predictQuantile()
    ├─ LightGBM → train .trainRegressor(), .trainClassifier() · predict .predict(), .predictClass(), .predictProba()
    ├─ NGBoost (probabilistic boosting) → .trainRegressor() · .predict(), .predictDist()
    ├─ Torch (MLP) → train .mlpTrain(), .mlpTrainMulti() · predict .mlpPredict(), .mlpPredictMulti() · embeddings
    │                .mlpEncode(), .mlpDecode()
    ├─ Lightning (PyTorch Lightning)
    │   ├─ .train(X, y, config, masks, group_weights, conditions) · .predict(model, X, masks, conditions)
    │   ├─ Embeddings (autoencoders) → .encode(), .decode(), .decodeConditional()
    │   ├─ Generation (sequential models) → .generateSequence(model, prefix, condition: Option, config{n_steps,
    │   │   temperature (0 = argmax), return_probs}) — the generated steps, not the prefix
    │   ├─ Architectures → mlp · autoencoder · conv1d (temporal) · sequential (LSTM/GRU, temporal) · transformer (temporal)
    │   ├─ Output modes → regression (MSE) · binary (BCE; per-position pos_weights, masks) ·
    │   │                 multi_head (N CE heads; per-head class_weights, masks)
    │   └─ condition_dim for conditional generation in the temporal architectures; early stopping, gradient clipping,
    │       epoch callbacks, group_weights
    ├─ GP (Gaussian process regression) → .train() · .predict(), .predictStd()
    ├─ MAPIE (conformal prediction)
    │   ├─ Regression → .trainConformalRegressor(), .trainCQR() · classification → .trainConformalClassifier()
    │   ├─ Predict → .predictInterval(), .predictSet()
    │   └─ For SHAP → .uncertaintyPredictorRegressor(), .uncertaintyPredictorClassifier()
    ├─ Sklearn
    │   ├─ Splitting → .split() (N-way, stratify, overlap, multi_overlap) · overlap filtering → .overlap()
    │   ├─ Scaling → .standardScalerFit/Transform(), .minMaxScalerFit/Transform(), .robustScalerFit/Transform()
    │   ├─ Encoding → .labelEncoderFit/Transform/InverseTransform(), .ordinalEncoderFit/Transform()
    │   ├─ Class weights → .computeClassWeight()
    │   ├─ Metrics → .computeMetrics(), .computeMetricsMulti() · .computeClassificationMetrics(),
    │   │   .computeClassificationMetricsMulti() · .rocAucScore(), .logLoss(), .confusionMatrix()
    │   ├─ Multi-target → .regressorChainTrain(), .regressorChainPredict()
    │   └─ GMM clustering → .gmmFit(), .gmmPredict(), .gmmPredictProba(), .gmmScoreSamples(), .gmmSample(), .gmmBic(),
    │       .gmmAic() · .silhouetteScore()
    ├─ PyMC (Bayesian inference)
    │   ├─ Train → .trainRegression(), .trainHierarchical(), .trainMultiLayer() · predict → .predict(), .predictDistribution()
    │   └─ Posterior → .posteriorSummary(), .posteriorSamples() · diagnostics → .diagnostics(), .posteriorPredictiveCheck()
    ├─ Simulation (economic-ontology simulation by DES) → .run([R, E], initialState, initialEvents, process, config)
    ├─ Causal (one declarative experiment and an honesty verdict) — generic over the row struct: data is an
    │   Array<Struct> (fields = columns), the row type a type argument, config naming columns by field
    │   ├─ Did X change Y, and can I trust it? → .experiment([Row], data, config)
    │   │   (binary treatment; naive vs adjusted effect, confounder balance, propensity overlap, a placebo / E-value
    │   │   robustness check, and a verdict: causal / modest / adjustment_insufficient / non_identifiable_positivity /
    │   │   not_estimable; `adjusted` is none when the engine refuses. DoWhy / EconML / PyALE are internal.)
    │   └─ What real trial would confirm it? → .designValidation([Row], data, config, result, designConfig)
    │       (a randomised-trial recipe: sample size, split options, match-on categories, power curve, rationale)
    │   Honesty caveats: `causal` means robust to the OBSERVED backdoor set and the refuters that ran — NOT correctly
    │   signed, free of reverse causation or of unobserved confounding. overlap.support_strength (refused / thin /
    │   strong vs config.strong_overlap, default 0.55) tempers thin support to modest; opt-in config.evalue_floor folds
    │   a weak E-value (risk-ratio scale) into modest; opt-in config.expected_sign flags an implausibly signed effect
    │   (refutation.expected_sign_ok = some(false), verdict adjustment_insufficient). Clustered designs
    │   (bootstrap.cluster_column) cluster the placebo and the naive CI too.
    └─ Shap (explainability)
        ├─ Create → .treeExplainerCreate() (XGBoost only), .kernelExplainerCreate() (any model)
        ├─ Compute → .computeValues(), .featureImportance()
        └─ KernelExplainer takes XGBoost, LightGBM, NGBoost, GP, Torch, RegressorChain and MAPIE models
```

## Data and Types

Data is East tensors: features `MatrixType(FloatType)` (rows × features),
targets `VectorType(FloatType)`, class labels `VectorType(IntegerType)`; the
predictions come back as vectors. Build them with
`East.Matrix.fromArray([[…], […]])` and `East.Vector.fromArray([…])` in
TypeScript, `EastMatrix` / `EastVector` (numpy) in python. The package
re-exports East's constructors as `VectorType` / `SharedVectorType` and
`SharedMatrixType`.

Each module's own types are under `Module.Types.*` — and at the top level
under a prefixed name (`MADSConfigType`, `XGBoostModelBlobType`, …):

```typescript
import { MADS, Optuna, ALNS, Sklearn, XGBoost, ModelBlobType } from "@elaraai/east-py-datascience";

MADS.Types.BoundsType          // { lower, upper } vectors
MADS.Types.ConfigType          // every field an Option: some(v) / none
MADS.Types.ConstraintType      // variant eb / pb over a constraint function
MADS.Types.ResultType          // { x_best, f_best, success, … }
Optuna.Types.ParamSpaceType    // one parameter's search space
Optuna.Types.StudyResultType
ALNS.Types.ConfigType          // and ALNS.Types.ResultType, over the solution type
Sklearn.Types.SplitConfigType
XGBoost.Types.ModelBlobType    // a trained model
ModelBlobType                  // the union of every library's model blob, for an arbitrary trained model
                               // (AnyModelBlobType is the SHAP explainer's input union)
```

A model blob round-trips: what a train function returns is exactly what the
predict and explain functions take — store it in a dataset, pass it between
tasks, or hand it to `Shap`.

## Common Patterns

### Train and predict

```typescript
const fit = East.function([], VectorType(FloatType), $ => {
    const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [2.0, 1.0], [3.0, 4.0], [4.0, 3.0]]));
    const y = $.let(East.Vector.fromArray([3.0, 3.0, 7.0, 7.0]));
    const config = $.let({                       // every field an Option: some(value) / none
        n_estimators: some(100n), max_depth: some(3n), learning_rate: none, min_child_weight: none,
        subsample: none, colsample_bytree: none, reg_alpha: none, reg_lambda: none, gamma: none,
        random_state: some(42n), n_jobs: none, sample_weight: none, categorical_features: none,
        categorical_n: none, max_cat_to_onehot: none, max_cat_threshold: none, scale_pos_weight: none,
    }, XGBoost.Types.XGBoostConfigType);
    const model = $.let(XGBoost.trainRegressor(X, y, config));
    $.return(XGBoost.predict(model, X));
});
```

### Optimisation

The objective is an East function of the decision vector —
`East.function([VectorType(FloatType)], FloatType, …)` — bound with `$.const`
and passed with the start point, the bounds and the config; the result
carries `x_best` and `f_best` (see the Quick Start).

## Calling from Python (the functions directly)

The platform functions are exported from `east_py_datascience` as **plain
callables over East values** — no IR, no compile — and, the same objects,
callable inside an `East.function` body, where the call is the `Platform`
node with the declared signature. A project's own `@East.platform_function`
imports and calls them (the preferred way to use lightning / torch / xgboost
/ sklearn from project python); a python East body calls them the same way and
compiles against the package's `platform` list:

```python
from east import East, FloatType, MatrixType, VectorType, coerce_to, none, some
from east_py_datascience import xgboost_predict, xgboost_train_regressor
from east_py_datascience.xgboost import XGBoostConfigType

@East.platform_function(inputs=[MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType)],
                        output=VectorType(FloatType))
def forecast(X_train, y_train, X_new):
    config = coerce_to({
        "n_estimators": some(200), "max_depth": some(4), "learning_rate": some(0.05),
        "min_child_weight": none, "subsample": none, "colsample_bytree": none,
        "reg_alpha": none, "reg_lambda": none, "gamma": none,
        "random_state": some(42), "n_jobs": none, "sample_weight": none,
        "categorical_features": none, "categorical_n": none,
        "max_cat_to_onehot": none, "max_cat_threshold": none,
        "scale_pos_weight": none,   # the binary class-imbalance weight (classifiers)
    }, XGBoostConfigType)
    model = xgboost_train_regressor(X_train, y_train, config)   # a model blob, East in and out
    return xgboost_predict(model, X_new)
```

Rules:

- **Inputs are East values, not numpy**: `EastMatrix` / `EastVector` for data,
  an `EastStruct` config built with `coerce_to(dict, ConfigType)` — every
  `Option` field spelled `some(value)` or `none` (a plain value or `None` is
  refused) — and `variant(case, value, Type)` for a variant.
- **Config and blob types live in each submodule**
  (`east_py_datascience.xgboost.XGBoostConfigType`, `…XGBoostModelBlobType`),
  mirroring the TypeScript `Module.Types.*`.
- **Names are the platform names** (`xgboost_train_regressor`,
  `mads_optimize`, …), except GoogleOr's, exported without the `google_or_`
  prefix: `cpsat_solve`, `cpsat_solve_all`, `routing_solve`, `linear_solve`,
  `min_cost_flow`, `max_flow`, `assignment`, `min_cost_assignment`.
- **Inside an East body**: `East.function([...], ..., lambda b, X, y, cfg:
  xgboost_predict(xgboost_train_regressor(X, y, cfg), X))` — the calls are
  `Platform` nodes; `East.compile(fn, platform=east_py_datascience.platform)`
  runs it (the list the e3 python runner registers).
- **The generic ones take the type argument FIRST in a body**, as TypeScript
  reads: `causal_experiment(RowType, rows, config)`,
  `alns_optimize(SolutionType, initial, objective, destroy, repair, config)`.
  From python they take the values alone (`causal_experiment(rows, config)`):
  they read the values, not the type.
- **`simulation_run` and `optimization_iterative*` run in C**, so there is no
  python to call: the name exports the declaration, and a body calls it the
  same way — `simulation_run(Resources, Events, state, events, process,
  config)`.
- Optional dependencies gate at call time: a function raises
  `NotImplementedError` naming the missing extra (`east-py-datascience[causal]`).

For the East-value API (eager methods, `coerce_to`, `to_numpy` / `to_torch`,
`@East.platform_function`), load the **east-py** skill.

## Related skills

- **e3** — **required to run these**: they need the python runtime, so wrap each
  call in an `e3.task` with a python runner (`{ runner: { runtime: 'east-py',
  platforms: ['east-py-datascience'] } }` — the typed runner resolves east-py
  from the project's `.venv`, no `uv run` wrapper needed). They do not run on
  the Node or C runtimes.
- **east** — the language for objective functions, configs and results.
- **east-py** — the python runtime: East values as plain python data, eager
  methods, and the `@East.platform_function` on-ramp the direct calls live in.
- **east-ontology** — the decisions these models improve are the `decision`
  nodes of the business's economic ontology.
- **east-design** — place the forecast or optimisation in a decision-oriented
  architecture.
