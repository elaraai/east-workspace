# East Data Science Examples

Working code examples for common data science use cases.

---

## Table of Contents

- [Quick Start](#quick-start)
- [MADS (Derivative-Free Optimization)](#mads-derivative-free-optimization)
- [Optuna (Bayesian Optimization)](#optuna-bayesian-optimization)
- [SimAnneal (Simulated Annealing)](#simanneal-simulated-annealing)
- [Sklearn (Machine Learning Utilities)](#sklearn-machine-learning-utilities)
- [Scipy (Scientific Computing)](#scipy-scientific-computing)
- [XGBoost (Gradient Boosting)](#xgboost-gradient-boosting)
- [LightGBM (Fast Gradient Boosting)](#lightgbm-fast-gradient-boosting)
- [NGBoost (Probabilistic Gradient Boosting)](#ngboost-probabilistic-gradient-boosting)
- [Torch (Neural Networks)](#torch-neural-networks)
- [GP (Gaussian Process)](#gp-gaussian-process)
- [Shap (Model Explainability)](#shap-model-explainability)

---

## Quick Start

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { MADS } from "@elaraai/east-py-datascience";

// Define objective function: minimize sum of squares
const objective = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    return $.return(x0.multiply(x0).add(x1.multiply(x1)));
});

// Optimize
const optimize = East.function([], MADS.Types.ResultType, $ => {
    const x0 = $.let([0.5, 0.5]);
    const bounds = $.let({
        lower: [-1.0, -1.0],
        upper: [1.0, 1.0],
    });
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

---

## MADS (Derivative-Free Optimization)

### Unconstrained Optimization

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { MADS } from "@elaraai/east-py-datascience";

// Minimize Rosenbrock function
const rosenbrock = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    const term1 = $.let(East.value(100.0).multiply(x1.subtract(x0.multiply(x0)).pow(2.0)));
    const term2 = $.let(East.value(1.0).subtract(x0).pow(2.0));
    return $.return(term1.add(term2));
});

const optimize = East.function([], MADS.Types.ResultType, $ => {
    const x0 = $.let([-0.5, 0.5]);
    const bounds = $.let({
        lower: [-2.0, -2.0],
        upper: [2.0, 2.0],
    });
    const config = $.let({
        max_bb_eval: variant('some', 500n),
        display_degree: variant('some', 0n),
        direction_type: variant('none', null),
        initial_mesh_size: variant('none', null),
        min_mesh_size: variant('none', null),
        seed: variant('some', 42n),
    });

    return $.return(MADS.optimize(rosenbrock, x0, bounds, variant('none', null), config));
});
```

### Constrained Optimization

```typescript
import { East, FloatType, ArrayType, variant } from "@elaraai/east";
import { MADS, MADSConstraintType } from "@elaraai/east-py-datascience";

// Objective: minimize x^2 + y^2
const objective = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    return $.return(x0.multiply(x0).add(x1.multiply(x1)));
});

// Constraint: x + y >= 1 (reformulated as 1 - x - y <= 0)
const constraint = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    return $.return(East.value(1.0).subtract(x0).subtract(x1));
});

const optimize = East.function([], MADS.Types.ResultType, $ => {
    const x0 = $.let([0.5, 0.5]);
    const bounds = $.let({
        lower: [0.0, 0.0],
        upper: [2.0, 2.0],
    });
    const constraints = $.let([
        variant('pb', constraint),  // Progressive barrier constraint
    ], ArrayType(MADSConstraintType));
    const config = $.let({
        max_bb_eval: variant('some', 200n),
        display_degree: variant('some', 0n),
        direction_type: variant('none', null),
        initial_mesh_size: variant('none', null),
        min_mesh_size: variant('none', null),
        seed: variant('some', 42n),
    });

    return $.return(MADS.optimize(objective, x0, bounds, variant('some', constraints), config));
});
```

---

## Optuna (Bayesian Optimization)

### Float Parameter

```typescript
import { East, FloatType, ArrayType, variant } from "@elaraai/east";
import { Optuna, ParamSpaceType, NamedParamType } from "@elaraai/east-py-datascience";

// Objective: minimize (x - 2)^2
const objective = East.function(
    [ArrayType(NamedParamType)],
    FloatType,
    ($, params) => {
        const xParam = $.let(params.get(0n));
        const x = $.let(xParam.value.unwrap('float'));
        const diff = $.let(x.subtract(2.0));
        return $.return(diff.multiply(diff));
    }
);

const optimize = East.function([], Optuna.Types.StudyResultType, $ => {
    const search_space = $.let([
        {
            name: "x",
            kind: variant("float", null),
            low: variant("some", 0.0),
            high: variant("some", 5.0),
            choices: variant("none", null),
        },
    ], ArrayType(ParamSpaceType));

    const config = $.let({
        direction: variant("some", variant("minimize", null)),
        n_trials: 30n,
        random_state: variant("some", 42n),
        pruner: variant("none", null),
    });

    return $.return(Optuna.optimize(search_space, objective, config));
});
```

### Categorical Parameter

```typescript
import { East, FloatType, ArrayType, variant } from "@elaraai/east";
import { Optuna, ParamSpaceType, NamedParamType } from "@elaraai/east-py-datascience";

// Objective: score based on category selection
const objective = East.function(
    [ArrayType(NamedParamType)],
    FloatType,
    ($, params) => {
        const catParam = $.let(params.get(0n));
        const category = $.let(catParam.value.unwrap('string'));
        const score = $.let(10.0);
        $.if(East.equal(category, "optimal"), $ => {
            $.assign(score, 0.0);
        }).elseIf(East.equal(category, "good"), $ => {
            $.assign(score, 1.0);
        }).elseIf(East.equal(category, "bad"), $ => {
            $.assign(score, 5.0);
        });
        return $.return(score);
    }
);

const optimize = East.function([], Optuna.Types.StudyResultType, $ => {
    const search_space = $.let([
        {
            name: "strategy",
            kind: variant("categorical", null),
            low: variant("none", null),
            high: variant("none", null),
            choices: variant("some", [
                variant("string", "optimal"),
                variant("string", "good"),
                variant("string", "bad"),
            ]),
        },
    ], ArrayType(ParamSpaceType));

    const config = $.let({
        direction: variant("some", variant("minimize", null)),
        n_trials: 15n,
        random_state: variant("some", 42n),
        pruner: variant("none", null),
    });

    return $.return(Optuna.optimize(search_space, objective, config));
});
```

---

## SimAnneal (Simulated Annealing)

### Permutation Optimization

```typescript
import { East, FloatType, ArrayType, IntegerType, variant } from "@elaraai/east";
import { SimAnneal } from "@elaraai/east-py-datascience";

// Energy: sum of absolute differences between adjacent elements
const energy = East.function([ArrayType(IntegerType)], FloatType, ($, perm) => {
    const total = $.let(0.0);
    $.forArray(perm, ($, i, val) => {
        $.if(i.lessThan(perm.length().subtract(1n)), $ => {
            const next = $.let(perm.get(i.add(1n)));
            const diff = $.let(val.subtract(next).toFloat().abs());
            $.assign(total, total.add(diff));
        });
    });
    return $.return(total);
});

const optimize = East.function([], SimAnneal.Types.ResultType, $ => {
    const initial = $.let([0n, 3n, 1n, 4n, 2n]);
    const config = $.let({
        t_max: variant("some", 1000.0),
        t_min: variant("some", 1.0),
        steps: variant("some", 10000n),
        updates: variant("none", null),
        auto_schedule: variant("none", null),
        random_state: variant("some", 42n),
    });

    return $.return(SimAnneal.optimizePermutation(initial, energy, config));
});
```

### Subset Selection

```typescript
import { East, FloatType, ArrayType, BooleanType, variant } from "@elaraai/east";
import { SimAnneal } from "@elaraai/east-py-datascience";

// Energy: prefer selecting fewer items while maximizing value
const energy = East.function([ArrayType(BooleanType)], FloatType, ($, selection) => {
    const values = $.let([10.0, 20.0, 15.0, 25.0, 5.0]);
    const total = $.let(0.0);
    $.forArray(selection, ($, i, selected) => {
        $.if(selected, $ => {
            $.assign(total, total.subtract(values.get(i)));
        });
    });
    return $.return(total);
});

const optimize = East.function([], SimAnneal.Types.ResultType, $ => {
    const initial = $.let([false, false, false, false, false]);
    const config = $.let({
        t_max: variant("some", 100.0),
        t_min: variant("some", 0.1),
        steps: variant("some", 5000n),
        updates: variant("none", null),
        auto_schedule: variant("none", null),
        random_state: variant("some", 42n),
    });

    return $.return(SimAnneal.optimizeSubset(initial, energy, config));
});
```

---

## Sklearn (Machine Learning Utilities)

### Train/Test Split

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const split = East.function([], Sklearn.Types.SplitResultType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0], [9.0, 10.0]]);
    const y = $.let([1.0, 2.0, 3.0, 4.0, 5.0]);
    const config = $.let({
        test_size: variant('some', 0.2),
        random_state: variant('some', 42n),
        shuffle: variant('some', true),
    });
    return $.return(Sklearn.trainTestSplit(X, y, config));
});
```

### Train/Val/Test Split (3-way)

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const split = East.function([], Sklearn.Types.ThreeWaySplitResultType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0], [9.0, 10.0],
                     [11.0, 12.0], [13.0, 14.0], [15.0, 16.0], [17.0, 18.0], [19.0, 20.0]]);
    const Y = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0], [9.0, 10.0],
                     [11.0, 12.0], [13.0, 14.0], [15.0, 16.0], [17.0, 18.0], [19.0, 20.0]]);
    const config = $.let({
        val_size: variant('some', 0.15),
        test_size: variant('some', 0.15),
        random_state: variant('some', 42n),
        shuffle: variant('some', true),
    });
    return $.return(Sklearn.trainValTestSplit(X, Y, config));
});
```

### Regression Metrics

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const compute = East.function([], Sklearn.Types.MetricsResultType, $ => {
    const y_true = $.let([1.0, 2.0, 3.0, 4.0, 5.0]);
    const y_pred = $.let([1.1, 2.0, 2.9, 4.1, 5.0]);

    const results = $.let(Sklearn.computeMetrics(
        y_true,
        y_pred,
        [variant('mse', null), variant('r2', null), variant('mae', null)]
    ));
    return $.return(results);
});
```

### StandardScaler

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const scale = East.function([], Sklearn.Types.MatrixType, $ => {
    const X_train = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]);
    const X_test = $.let([[2.0, 3.0], [4.0, 5.0]]);

    const scaler = $.let(Sklearn.standardScalerFit(X_train));
    const X_scaled = $.let(Sklearn.standardScalerTransform(scaler, X_test));

    return $.return(X_scaled);
});
```

### RobustScaler (Outlier-Resistant)

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const scale = East.function([], Sklearn.Types.MatrixType, $ => {
    // Data with outliers
    const X_train = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [100.0, 200.0]]);
    const X_test = $.let([[2.0, 3.0], [4.0, 5.0]]);

    const scaler = $.let(Sklearn.robustScalerFit(X_train));
    const X_scaled = $.let(Sklearn.robustScalerTransform(scaler, X_test));

    return $.return(X_scaled);
});
```

### LabelEncoder

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const encode = East.function([], Sklearn.Types.LabelVectorType, $ => {
    // Labels with gaps: 2, 5, 2, 8, 5
    const y = $.let([2n, 5n, 2n, 8n, 5n]);

    const encoder = $.let(Sklearn.labelEncoderFit(y));

    // Transform: 2->0, 5->1, 8->2
    const y_encoded = $.let(Sklearn.labelEncoderTransform(encoder, y));

    // Inverse transform back to original
    const y_original = $.let(Sklearn.labelEncoderInverseTransform(encoder, y_encoded));

    return $.return(y_encoded);
});
```

### OrdinalEncoder

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const encode = East.function([], Sklearn.Types.MatrixType, $ => {
    // Categorical features encoded as floats
    const X = $.let([
        [1.0, 10.0],  // category A, category X
        [2.0, 20.0],  // category B, category Y
        [3.0, 10.0],  // category C, category X
        [1.0, 20.0],  // category A, category Y
    ]);

    const encoder = $.let(Sklearn.ordinalEncoderFit(X));
    const X_encoded = $.let(Sklearn.ordinalEncoderTransform(encoder, X));
    // Result: [[0,0], [1,1], [2,0], [0,1]]

    return $.return(X_encoded);
});
```

### Compute Class Weights

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const weights = East.function([], Sklearn.Types.VectorType, $ => {
    // Imbalanced classes: more 0s than 1s
    const y = $.let([0n, 0n, 0n, 0n, 1n, 1n]);

    const class_weights = $.let(Sklearn.computeClassWeight(
        variant('balanced', null),
        y
    ));

    return $.return(class_weights);
});
```

### Confusion Matrix

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const confusion = East.function([], Sklearn.Types.ConfusionMatrixResultType, $ => {
    const y_true = $.let([0n, 0n, 1n, 1n, 2n, 2n]);
    const y_pred = $.let([0n, 1n, 1n, 1n, 2n, 0n]);

    const result = $.let(Sklearn.confusionMatrix(y_true, y_pred));
    // result.matrix: [[1,1,0], [0,2,0], [1,0,1]]
    // result.classes: [0, 1, 2]

    return $.return(result);
});
```

### ROC AUC Score

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const rocAuc = East.function([], Sklearn.Types.FloatType, $ => {
    const y_true = $.let([0n, 0n, 1n, 1n]);
    // Probability matrix: each row is [P(class=0), P(class=1)]
    const y_proba = $.let([
        [0.9, 0.1],
        [0.8, 0.2],
        [0.3, 0.7],
        [0.1, 0.9],
    ]);

    const config = $.let({
        multi_class: variant('some', variant('ovr', null)),
        average: variant('some', variant('macro', null)),
    });

    const score = $.let(Sklearn.rocAucScore(y_true, y_proba, config));

    return $.return(score);
});
```

### Log Loss

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const loss = East.function([], Sklearn.Types.FloatType, $ => {
    const y_true = $.let([0n, 0n, 1n, 1n]);
    const y_proba = $.let([
        [0.9, 0.1],
        [0.8, 0.2],
        [0.3, 0.7],
        [0.1, 0.9],
    ]);

    const log_loss = $.let(Sklearn.logLoss(y_true, y_proba));

    return $.return(log_loss);
});
```

### Classification Metrics with Cohen's Kappa Weights

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const metrics = East.function([], Sklearn.Types.ClassificationMetricResultsType, $ => {
    const y_true = $.let([0n, 0n, 1n, 1n, 2n, 2n]);
    const y_pred = $.let([0n, 1n, 1n, 1n, 2n, 1n]);

    const config = $.let({
        average: variant('some', variant('macro', null)),
    });

    // Use quadratic weights for ordinal labels (0 < 1 < 2)
    const results = $.let(Sklearn.computeClassificationMetrics(
        y_true,
        y_pred,
        [
            variant('accuracy', null),
            variant('f1', null),
            variant('cohen_kappa', variant('quadratic', null)),  // Weighted kappa
        ],
        config
    ));

    return $.return(results);
});
```

### Gaussian Mixture Model (Clustering)

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const cluster = East.function([], Sklearn.Types.ModelBlobType, $ => {
    // Two clusters of 2D data
    const X = $.let(East.Matrix.fromArray([
        [1.0, 1.0], [1.1, 1.1], [0.9, 0.9],
        [5.0, 5.0], [5.1, 5.1], [4.9, 4.9],
    ]));

    const config = $.let({
        n_components: variant('some', 2n),
        covariance_type: variant('none', null),
        max_iter: variant('some', 100n),
        n_init: variant('some', 1n),
        tol: variant('none', null),
        reg_covar: variant('none', null),
        random_state: variant('some', 42n),
    });

    return $.return(Sklearn.gmmFit(X, config));
});

const predict = East.function(
    [Sklearn.Types.ModelBlobType, Sklearn.Types.MatrixType],
    Sklearn.Types.VectorType,
    ($, model, X_new) => {
        // Predict cluster labels
        const labels = $.let(Sklearn.gmmPredict(model, X_new));
        return $.return(labels);
    }
);
```

### GMM Model Selection (BIC/AIC)

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const selectModel = East.function([], Sklearn.Types.ModelBlobType, $ => {
    const X = $.let(East.Matrix.fromArray([
        [1.0, 1.0], [1.1, 1.1], [0.9, 0.9],
        [5.0, 5.0], [5.1, 5.1], [4.9, 4.9],
    ]));

    // Fit with 2 components
    const config2 = $.let({
        n_components: variant('some', 2n),
        covariance_type: variant('none', null),
        max_iter: variant('some', 100n),
        n_init: variant('some', 1n),
        tol: variant('none', null),
        reg_covar: variant('none', null),
        random_state: variant('some', 42n),
    });
    const model2 = $.let(Sklearn.gmmFit(X, config2));

    // Compare BIC scores (lower is better)
    const bic2 = $.let(Sklearn.gmmBic(model2, X));
    const aic2 = $.let(Sklearn.gmmAic(model2, X));

    return $.return(model2);
});
```

---

## Scipy (Scientific Computing)

### Curve Fitting

```typescript
import { East, variant } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

const fit = East.function([], Scipy.Types.CurveFitResultType, $ => {
    const x = $.let([0.0, 1.0, 2.0, 3.0, 4.0]);
    const y = $.let([1.0, 2.7, 7.4, 20.1, 54.6]);  // Exponential growth

    const curve_fn = $.let(variant('exponential_growth', null));
    const config = $.let({
        max_iter: variant('some', 5000n),
        initial_guess: variant('none', null),
    });

    return $.return(Scipy.curveFit(curve_fn, x, y, config));
});
```

### Optimization

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

// Minimize Rosenbrock
const objective = East.function([Scipy.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    const term1 = $.let(East.value(100.0).multiply(x1.subtract(x0.multiply(x0)).pow(2.0)));
    const term2 = $.let(East.value(1.0).subtract(x0).pow(2.0));
    return $.return(term1.add(term2));
});

const minimize = East.function([], Scipy.Types.OptimizeResultType, $ => {
    const x0 = $.let([0.0, 0.0]);
    const config = $.let({
        method: variant('some', variant('l_bfgs_b', null)),
        max_iter: variant('some', 1000n),
        tol: variant('some', 1e-8),
    });

    return $.return(Scipy.optimizeMinimize(objective, x0, config));
});
```

### Dual Annealing (Global Optimization)

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

// Minimize Rastrigin function (has many local minima)
const objective = East.function([Scipy.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    const A = $.let(10.0);
    const term0 = $.let(x0.multiply(x0).subtract(A.multiply(x0.multiply(6.283185).cos())));
    const term1 = $.let(x1.multiply(x1).subtract(A.multiply(x1.multiply(6.283185).cos())));
    return $.return(A.multiply(2.0).add(term0).add(term1));
});

const minimize = East.function([], Scipy.Types.DualAnnealResultType, $ => {
    const bounds = $.let({
        lower: [-5.12, -5.12],
        upper: [5.12, 5.12],
    });
    const config = $.let({
        maxfun: variant('some', 1000n),
        maxiter: variant('some', 1000n),
        initial_temp: variant('none', null),
        restart_temp_ratio: variant('none', null),
        visit: variant('none', null),
        accept: variant('none', null),
        seed: variant('some', 42n),
        no_local_search: variant('none', null),
    });

    return $.return(Scipy.optimizeDualAnnealing(objective, variant('none', null), bounds, config));
});
```

---

## XGBoost (Gradient Boosting)

### Regression

```typescript
import { East, variant } from "@elaraai/east";
import { XGBoost } from "@elaraai/east-py-datascience";

const train = East.function([], XGBoost.Types.ModelBlobType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
    const y = $.let([1.0, 2.0, 3.0, 4.0]);
    const config = $.let({
        n_estimators: variant('some', 100n),
        max_depth: variant('some', 3n),
        learning_rate: variant('some', 0.1),
        min_child_weight: variant('none', null),
        subsample: variant('none', null),
        colsample_bytree: variant('none', null),
        reg_alpha: variant('none', null),
        reg_lambda: variant('none', null),
        random_state: variant('some', 42n),
        n_jobs: variant('none', null),
        sample_weight: variant('none', null),
    });
    return $.return(XGBoost.trainRegressor(X, y, config));
});
```

### Quantile Regression (Prediction Intervals)

```typescript
import { East, variant } from "@elaraai/east";
import { XGBoost } from "@elaraai/east-py-datascience";

// Train quantile regressor for 80% prediction interval + median
const trainQuantile = East.function([], XGBoost.Types.ModelBlobType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0], [9.0, 10.0]]);
    const y = $.let([2.0, 4.0, 6.0, 8.0, 10.0]);
    const config = $.let({
        quantiles: [0.1, 0.5, 0.9],  // 80% prediction interval + median
        n_estimators: variant('some', 100n),
        max_depth: variant('some', 3n),
        learning_rate: variant('some', 0.1),
        min_child_weight: variant('none', null),
        subsample: variant('none', null),
        colsample_bytree: variant('none', null),
        reg_alpha: variant('none', null),
        reg_lambda: variant('none', null),
        random_state: variant('some', 42n),
        n_jobs: variant('none', null),
        sample_weight: variant('none', null),
    });
    return $.return(XGBoost.trainQuantile(X, y, config));
});

// Predict quantiles
const predictQuantile = East.function(
    [XGBoost.Types.ModelBlobType, XGBoost.Types.MatrixType],
    XGBoost.Types.XGBoostQuantilePredictResultType,
    ($, model, X_new) => {
        const result = $.let(XGBoost.predictQuantile(model, X_new));
        return $.return(result);
    }
);
```

---

## LightGBM (Fast Gradient Boosting)

### Classification

```typescript
import { East, variant } from "@elaraai/east";
import { LightGBM } from "@elaraai/east-py-datascience";

const train = East.function([], LightGBM.Types.ModelBlobType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
    const y = $.let([0n, 0n, 1n, 1n]);
    const config = $.let({
        n_estimators: variant('some', 50n),
        max_depth: variant('some', 5n),
        learning_rate: variant('some', 0.1),
        num_leaves: variant('some', 31n),
        min_child_samples: variant('none', null),
        subsample: variant('none', null),
        colsample_bytree: variant('none', null),
        reg_alpha: variant('none', null),
        reg_lambda: variant('none', null),
        random_state: variant('some', 42n),
        n_jobs: variant('none', null),
    });
    return $.return(LightGBM.trainClassifier(X, y, config));
});
```

---

## NGBoost (Probabilistic Gradient Boosting)

### Probabilistic Predictions

```typescript
import { East, variant } from "@elaraai/east";
import { NGBoost } from "@elaraai/east-py-datascience";

const train = East.function([], NGBoost.Types.ModelBlobType, $ => {
    const X = $.let([[1.0], [2.0], [3.0], [4.0], [5.0]]);
    const y = $.let([2.1, 3.9, 6.2, 7.8, 10.1]);
    const config = $.let({
        n_estimators: variant('some', 100n),
        learning_rate: variant('some', 0.01),
        minibatch_frac: variant('none', null),
        col_sample: variant('none', null),
        random_state: variant('some', 42n),
        distribution: variant('some', variant('normal', null)),
    });
    return $.return(NGBoost.trainRegressor(X, y, config));
});

const predictWithUncertainty = East.function(
    [NGBoost.Types.ModelBlobType],
    NGBoost.Types.NGBoostPredictResultType,
    ($, model) => {
        const X_test = $.let([[1.5], [2.5], [3.5]]);
        const config = $.let({
            confidence_level: variant('some', 0.95),
        });
        return $.return(NGBoost.predictDist(model, X_test, config));
    }
);
```

---

## Torch (Neural Networks)

### MLP Training

```typescript
import { East, variant } from "@elaraai/east";
import { Torch } from "@elaraai/east-py-datascience";

const train = East.function([], Torch.Types.TorchTrainOutputType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
    const y = $.let([3.0, 7.0, 11.0, 15.0]);

    const mlp_config = $.let({
        hidden_layers: [32n, 16n],
        activation: variant('some', variant('relu', null)),
        output_activation: variant('none', null),
        dropout: variant('some', 0.1),
        output_dim: variant('none', null),
    });

    const train_config = $.let({
        epochs: variant('some', 100n),
        batch_size: variant('some', 4n),
        learning_rate: variant('some', 0.01),
        loss: variant('none', null),
        optimizer: variant('none', null),
        early_stopping: variant('some', 10n),
        validation_split: variant('some', 0.2),
        random_state: variant('some', 42n),
    });

    return $.return(Torch.mlpTrain(X, y, mlp_config, train_config));
});
```

### Multi-Output MLP

```typescript
import { East, variant } from "@elaraai/east";
import { Torch } from "@elaraai/east-py-datascience";

const train = East.function([], Torch.Types.TorchTrainOutputType, $ => {
    const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
    const Y = $.let([[3.0, 1.0], [7.0, 2.0], [11.0, 3.0], [15.0, 4.0]]);

    const mlp_config = $.let({
        hidden_layers: [32n, 16n],
        activation: variant('some', variant('relu', null)),
        output_activation: variant('none', null),
        dropout: variant('some', 0.1),
        output_dim: variant('none', null),
    });

    const train_config = $.let({
        epochs: variant('some', 100n),
        batch_size: variant('some', 4n),
        learning_rate: variant('some', 0.01),
        loss: variant('none', null),
        optimizer: variant('none', null),
        early_stopping: variant('some', 10n),
        validation_split: variant('some', 0.2),
        random_state: variant('some', 42n),
    });

    return $.return(Torch.mlpTrainMulti(X, Y, mlp_config, train_config));
});

const predict = East.function([Torch.Types.ModelBlobType], Torch.Types.MatrixType, ($, model) => {
    const X_test = $.let([[2.0, 3.0], [4.0, 5.0]]);
    return $.return(Torch.mlpPredictMulti(model, X_test));
});
```

### Autoencoder Encode/Decode

```typescript
import { East, variant } from "@elaraai/east";
import { Torch } from "@elaraai/east-py-datascience";

// Train autoencoder: 4 features -> 8 -> 2 (bottleneck) -> 8 -> 4 features
const trainAutoencoder = East.function([], Torch.Types.TorchTrainOutputType, $ => {
    const X = $.let([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]);

    const mlp_config = $.let({
        hidden_layers: [8n, 2n, 8n],  // Bottleneck at index 1
        activation: variant('some', variant('relu', null)),
        output_activation: variant('some', variant('softmax', null)),
        dropout: variant('none', null),
        output_dim: variant('none', null),
    });

    const train_config = $.let({
        epochs: variant('some', 100n),
        batch_size: variant('some', 2n),
        learning_rate: variant('some', 0.01),
        loss: variant('some', variant('kl_div', null)),
        optimizer: variant('some', variant('adam', null)),
        early_stopping: variant('some', 20n),
        validation_split: variant('some', 0.2),
        random_state: variant('some', 42n),
    });

    return $.return(Torch.mlpTrainMulti(X, X, mlp_config, train_config));
});

// Extract embeddings and blend them
const blendOrigins = East.function([Torch.Types.ModelBlobType], Torch.Types.MatrixType, ($, model) => {
    const X_origins = $.let([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
    ]);

    // Extract bottleneck embeddings (layer_index=1)
    const embeddings = $.let(Torch.mlpEncode(model, X_origins, 1n));

    // Compute 50/50 blend embedding
    const emb_A = $.let(embeddings.get(0n));
    const emb_B = $.let(embeddings.get(1n));
    const blend_emb = $.let([
        emb_A.get(0n).multiply(0.5).add(emb_B.get(0n).multiply(0.5)),
        emb_A.get(1n).multiply(0.5).add(emb_B.get(1n).multiply(0.5)),
    ]);

    // Decode blended embedding
    const blend_matrix = $.let([blend_emb]);
    const reconstructed = $.let(Torch.mlpDecode(model, blend_matrix, 1n));

    return $.return(reconstructed);
});
```

---

## GP (Gaussian Process)

### GP with Uncertainty

```typescript
import { East, variant } from "@elaraai/east";
import { GP } from "@elaraai/east-py-datascience";

const train = East.function([], GP.Types.ModelBlobType, $ => {
    const X = $.let([[1.0], [2.0], [3.0], [4.0], [5.0]]);
    const y = $.let([1.0, 4.0, 9.0, 16.0, 25.0]);  // y = x^2
    const config = $.let({
        kernel: variant('some', variant('rbf', null)),
        alpha: variant('some', 1e-10),
        n_restarts_optimizer: variant('some', 5n),
        normalize_y: variant('some', true),
        random_state: variant('some', 42n),
    });
    return $.return(GP.train(X, y, config));
});

const predictWithStd = East.function(
    [GP.Types.ModelBlobType],
    GP.Types.GPPredictResultType,
    ($, model) => {
        const X_test = $.let([[1.5], [2.5], [3.5]]);
        return $.return(GP.predictStd(model, X_test));
    }
);
```

---

## Shap (Model Explainability)

### TreeExplainer with XGBoost

```typescript
import { East, variant } from "@elaraai/east";
import { Shap, XGBoost } from "@elaraai/east-py-datascience";

const explain = East.function(
    [XGBoost.Types.ModelBlobType, Shap.Types.MatrixType],
    Shap.Types.FeatureImportanceType,
    ($, model, X) => {
        const explainer = $.let(Shap.treeExplainerCreate(model));
        const feature_names = $.let(["feature1", "feature2"]);
        const shap_result = $.let(Shap.computeValues(explainer, X, feature_names));
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));
        return $.return(importance);
    }
);
```

### KernelExplainer with RegressorChain

```typescript
import { East, variant } from "@elaraai/east";
import { Shap, Sklearn } from "@elaraai/east-py-datascience";

const explainChain = East.function(
    [Sklearn.Types.ModelBlobType, Shap.Types.MatrixType, Shap.Types.MatrixType],
    Shap.Types.FeatureImportanceType,
    ($, model, X_background, X_explain) => {
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const shap_result = $.let(Shap.computeValues(explainer, X_explain, feature_names));
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));
        return $.return(importance);
    }
);
```
