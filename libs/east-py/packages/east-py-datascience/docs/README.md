# East-Py Data Science Package Design

## Overview

`east-py-datascience` is a Python package providing platform functions for data science and machine learning operations in the East programming language. It enables East programs to train models, make predictions, perform optimization, and compute feature importance using industry-standard libraries.

## Design Principles

1. **East Type System Compliance**: All inputs/outputs use East types (`EastArray`, `EastStruct`, `EastVariant`, `EastBlob`)
2. **ONNX-First Serialization**: Models are serialized to ONNX format where possible for portability and inference
3. **Per-Model-Type Variants**: `ModelBlobType` uses specific variant cases per model type for type safety
4. **Configuration via Structs**: Use `StructType` with `OptionType` for optional parameters
5. **Sync Operations**: ML operations are computationally intensive but CPU-bound, so use `type="sync"`
6. **Native Fallback**: For models that can't export to ONNX (GPflow, Optuna, SHAP), use cloudpickle

## Architecture

### Model Serialization Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                     Model Training                               │
├─────────────────────────────────────────────────────────────────┤
│  sklearn, xgboost, lightgbm, pytorch  │  gpflow, optuna, shap  │
│              ↓                         │           ↓            │
│     Convert to ONNX                    │   cloudpickle         │
│              ↓                         │           ↓            │
│      EastBlob (onnx)                   │   EastBlob (data)     │
│              ↓                         │           ↓            │
│   EastVariant("model_type", ...)       │   EastVariant(...)    │
└─────────────────────────────────────────────────────────────────┘
```

### Per-Model-Type Variants

Instead of a generic `ModelBlobType` with string tags, we use specific variant cases:

```python
ModelBlobType = VariantType([
    ("standard_scaler", StructType([("onnx", BlobType), ("n_features", IntegerType)])),
    ("xgboost_regressor", StructType([("onnx", BlobType), ("n_features", IntegerType)])),
    ("xgboost_classifier", StructType([("onnx", BlobType), ("n_features", IntegerType), ("n_classes", IntegerType)])),
    ("lightgbm_regressor", StructType([("onnx", BlobType), ("n_features", IntegerType)])),
    ("lightgbm_classifier", StructType([("onnx", BlobType), ("n_features", IntegerType), ("n_classes", IntegerType)])),
    ("ngboost_regressor", StructType([("onnx", BlobType), ("n_features", IntegerType), ("distribution", DistributionType)])),
    ("torch_mlp", StructType([("onnx", BlobType), ("n_features", IntegerType), ("hidden_layers", ArrayType(IntegerType)), ("output_dim", IntegerType)])),
    ("gp_regressor", StructType([("data", BlobType), ("kernel", GPKernelType), ("n_features", IntegerType)])),
    ("scipy_interp_1d", StructType([("data", BlobType), ("kind", InterpolationKindType)])),
    ("shap_kernel_explainer", StructType([("data", BlobType), ("n_features", IntegerType)])),
])
```

This provides:
- **Type safety**: East compiler knows exactly what fields each model type has
- **Pattern matching**: East code can match on model type variants
- **Self-documenting**: The type definition documents the structure of each model

### ONNX vs Native Format

| Library | Format | Reason |
|---------|--------|--------|
| sklearn | ONNX | Full skl2onnx support |
| XGBoost | ONNX | Good ONNX support |
| LightGBM | ONNX | Good ONNX support |
| PyTorch | ONNX | Native torch.onnx.export |
| NGBoost | ONNX | Uses sklearn base |
| GPflow | Native | No ONNX support for GP models |
| Optuna | Native | Stateful study objects |
| SHAP | Native | Explainers hold model references |
| SciPy | Native | Interpolators not ONNX-compatible |

### Optuna API Design

Platform functions can receive East functions as arguments. When the input type includes
a `FunctionType`, the platform function receives a compiled Python callable that it can
invoke directly.

For Optuna, we define an objective function type and pass it to the optimizer:

```python
# Objective function type
ObjectiveFunctionType = FunctionType(
    [ArrayType(NamedHyperparamType)],  # params input
    FloatType                           # score output
)

# Platform function receives the East function as a callable
PlatformFunction(
    name="optuna_optimize",
    inputs=[ArrayType(HyperparamSpaceType), ObjectiveFunctionType, OptunaStudyConfigType],
    output=StudyResultType,
    ...
)
```

The implementation simply calls the objective function:

```python
def optuna_optimize_impl(search_space, objective_fn, config):
    # objective_fn is a compiled Python callable
    def wrapped_objective(trial):
        params = suggest_params_from_trial(trial, search_space)
        return objective_fn(params)  # Call East function directly

    study.optimize(wrapped_objective, n_trials=config["n_trials"])
```

East code defines the objective as a normal function:

```east
let objective = fn(params) -> Float {
    let model = train_model(params);
    evaluate(model)
};

let result = optuna_optimize(search_space, objective, config);
```

## Package Structure

```
packages/east-py-datascience/
├── pyproject.toml
├── src/                            # TypeScript: platform declarations + types (one dir per library)
├── test/                           # TypeScript: export-only specs (*.spec.ts)
├── tests/test_compliance.py        # Python: replays the exported IR
└── src/east_py_datascience/        # Python package
    ├── __init__.py                 # Main exports, `platform`
    ├── types.py                    # Shared type definitions
    ├── _common.py                  # serialize/deserialize, extra_guard, option_tag, expect_case, quiet_warnings
    ├── _categorical.py             # Categorical column handling shared by the tree models
    ├── sklearn/                    # One package per library: <lib>/<lib>_impl.py + __init__.py
    ├── xgboost/
    ├── lightgbm/
    ├── lightning/                  # lightning_impl.py + _models.py (torch classes, imported lazily)
    ├── optimization/               # optimization.py + _optimization_eastc.pyx (Cython, C-level loop)
    └── ...                         # see CLAUDE.md for the full module list
```

## Dependencies

The only core runtime dependency is numpy (plus `elaraai-east-py`). Every
library is an optional extra — `east-py-datascience[xgboost]`, `[lightning]`,
`[causal]`, ... or `[all]` — declared in `pyproject.toml`; each module guards
its extra with `extra_guard` and imports the library inside the platform
function (see `docs/conventions/PYTHON_OPTIONAL_DEPS.md`).

## Module Documentation

Per-module documentation lives in each implementation's docstrings (every
platform function documents its East fields, return shape and errors) and in
`SKILL.md`, which backs the `east:east-py-datascience` plugin skill.

## Usage Example (East Code)

```east
// Train XGBoost model
let config = {
    n_estimators: some(100),
    max_depth: some(6),
    learning_rate: some(0.1),
    random_state: some(42),
    // ... other fields are none
};

let model = xgboost_train_regressor(X_train, y_train, config);

// Make predictions - model is an EastVariant with ONNX blob inside
let predictions = xgboost_predict(model, X_test);

// Get feature importance
let importance = xgboost_feature_importance(model, feature_names);

// Model can be persisted directly (it's already serialized as ONNX)
// No separate save/load needed - just store the variant
```

## Helper Functions

`east_py_datascience._common` holds the helpers every module shares; options
are read through the `EastVariant` API rather than by inspecting tags:

```python
from east_py_datascience._common import (
    deserialize,     # cloudpickle blob -> object
    expect_case,     # model-blob guard: the payload when the case matches, else a named RuntimeError
    extra_guard,     # build a module's `_check_<lib>_support()` for an optional extra
    option_tag,      # case name of an Option<Variant> config field, or a default
    quiet_warnings,  # scoped UserWarning / FutureWarning filter around chatty fits
    serialize,       # object -> cloudpickle EastBlob
)

max_iter = int(config["max_iter"].unwrap_or(100))       # Option<Integer>
weights = config["weights"].unwrap_or(None)              # Option<Matrix<Float>> -> EastMatrix | None
kernel = option_tag(config["kernel"], "rbf")             # Option<Variant> -> "rbf" | "matern_3_2" | ...
payload = expect_case(model_blob, "xgboost_regressor", "xgboost_predict")
```

Results are built with the constructors from `east` — `some(x)` / `none`,
`variant(case, value, Type)` — and `EastStruct` / `EastVector` / `EastMatrix`;
never a hand-rolled `{"type", "value"}` dict.

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create package structure
- [ ] Implement types.py with per-model-type ModelBlobType
- [ ] Implement helpers.py with conversion utilities
- [ ] Set up ONNX serialization helpers
- [ ] Set up pyproject.toml with dependencies

### Phase 2: Scikit-Learn Module
- [ ] `sklearn_train_test_split`
- [ ] `sklearn_standard_scaler_fit` (ONNX output)
- [ ] `sklearn_standard_scaler_transform`
- [ ] `sklearn_cross_val_score`
- [ ] `sklearn_metrics_regression`
- [ ] `sklearn_metrics_classification`

### Phase 3: Gradient Boosting
- [ ] XGBoost: train (ONNX output), predict
- [ ] LightGBM: train (ONNX output), predict
- [ ] NGBoost: train (ONNX output), predict_dist

### Phase 4: Optimization
- [ ] Optuna: create_study, suggest_params, complete_trial, get_best

### Phase 5: Explainability
- [ ] SHAP: kernel_explainer_create, compute_values, feature_importance

### Phase 6: Scientific Computing
- [ ] SciPy: stats_describe, pearsonr, spearmanr, interpolate_1d

### Phase 7: Deep Learning (Optional)
- [ ] PyTorch: mlp_train (ONNX output), mlp_predict

### Phase 8: Gaussian Processes (Optional)
- [ ] GPflow: train (native format), predict with uncertainty

### Phase 9: Testing & Documentation
- [ ] Unit tests for each module
- [ ] Integration tests with East IR
- [ ] ONNX inference tests
