# East-Py Data Science Package Design

## Overview

`east-py-data-science` is a Python package providing platform functions for data science and machine learning operations in the East programming language. It enables East programs to train models, make predictions, perform optimization, and compute feature importance using industry-standard libraries.

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
packages/
└── east-py-data-science/
    ├── pyproject.toml
    ├── README.md
    └── east_py_data_science/
        ├── __init__.py           # Main exports, python_data_science_platform
        ├── types.py              # Shared type definitions
        ├── helpers.py            # _get_option, conversion helpers
        ├── scikit.py             # scikit-learn operations
        ├── xgboost_impl.py       # XGBoost gradient boosting
        ├── lightgbm_impl.py      # LightGBM gradient boosting
        ├── ngboost_impl.py       # NGBoost probabilistic predictions
        ├── optuna_impl.py        # Hyperparameter optimization
        ├── shap_impl.py          # Feature importance/explainability
        ├── scipy_impl.py         # Scientific computing utilities
        ├── torch_impl.py         # PyTorch neural networks
        ├── gp_impl.py            # Gaussian Process regression
        └── mads_impl.py          # MADS derivative-free optimization
```

## Dependencies

```toml
[project]
dependencies = [
    "east-py",
    # Core ML
    "scikit-learn>=1.3.0",
    "scipy>=1.11.0",
    # ONNX support
    "onnx>=1.14.0",
    "onnxruntime>=1.15.0",
    "skl2onnx>=1.15.0",
    # Gradient boosting
    "xgboost>=2.0.0",
    "lightgbm>=4.0.0",
    "ngboost>=0.5.0",
    "onnxmltools>=1.11.0",  # For XGBoost/LightGBM ONNX export
    # Hyperparameter optimization
    "optuna>=3.0.0",
    # Explainability
    "shap>=0.42.0",
    # Serialization fallback
    "cloudpickle>=2.2.0",
]

[project.optional-dependencies]
torch = ["torch>=2.0.0"]
gp = ["gpflow>=2.9.0", "tensorflow>=2.12.0"]
mads = ["PyNomadBBO>=2.0.0"]
```

## Module Documentation

1. [Shared Types](./01_types.md) - Core type definitions and helpers
2. [Scikit-Learn](./02_scikit.md) - Preprocessing, model selection, metrics
3. [XGBoost](./03_xgboost.md) - Gradient boosting for regression/classification
4. [LightGBM](./04_lightgbm.md) - Fast gradient boosting
5. [NGBoost](./05_ngboost.md) - Probabilistic predictions with uncertainty
6. [Optuna](./06_optuna.md) - Hyperparameter optimization
7. [SHAP](./07_shap.md) - Feature importance and explainability
8. [SciPy](./08_scipy.md) - Scientific computing utilities
9. [PyTorch](./09_torch.md) - Neural network models
10. [Gaussian Process](./10_gp.md) - GP regression with uncertainty
11. [MADS](./11_mads.md) - Derivative-free blackbox optimization (PyNomadBBO)

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

The package uses helper functions for East type handling:

```python
from east.types.values import is_east_variant  # For checking deserialized options

def _get_option(value, default):
    """Extract value from Option variant or return default.

    Note: Use is_east_variant (not is_east_option) because deserialized IR
    uses EastVariant with 'some'/'none' tags, not EastOption instances.
    """
    if is_east_variant(value) and value.type == "some":
        return value.value
    return default

def _get_enum_tag(variant: EastVariant) -> str:
    """Get the tag name from an enum-style EastVariant."""
    return variant.type
```

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
