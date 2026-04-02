# East Data Science Examples

Working code examples for common data science use cases.

---

## Table of Contents

- [Quick Start](#quick-start)
- [MADS (Derivative-Free Optimization)](#mads-derivative-free-optimization)
- [Optuna (Bayesian Optimization)](#optuna-bayesian-optimization)
- [SimAnneal (Simulated Annealing)](#simanneal-simulated-annealing)
- [ALNS (Adaptive Large Neighborhood Search)](#alns-adaptive-large-neighborhood-search)
- [Sklearn (Machine Learning Utilities)](#sklearn-machine-learning-utilities)
- [Scipy (Scientific Computing)](#scipy-scientific-computing)
- [XGBoost (Gradient Boosting)](#xgboost-gradient-boosting)
- [LightGBM (Fast Gradient Boosting)](#lightgbm-fast-gradient-boosting)
- [NGBoost (Probabilistic Gradient Boosting)](#ngboost-probabilistic-gradient-boosting)
- [Torch (Neural Networks)](#torch-neural-networks)
- [Lightning (PyTorch Lightning)](#lightning-pytorch-lightning)
- [GP (Gaussian Process)](#gp-gaussian-process)
- [MAPIE (Conformal Prediction)](#mapie-conformal-prediction)
- [Shap (Model Explainability)](#shap-model-explainability)
- [Optimization (Iterative Coordinate Descent)](#optimization-iterative-coordinate-descent)
- [GoogleOr (Google OR-Tools)](#googleor-google-or-tools)
- [PyMC (Bayesian Inference)](#pymc-bayesian-inference)
- [Simulation (Economic Ontology via DES)](#simulation-economic-ontology-via-des)

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

## ALNS (Adaptive Large Neighborhood Search)

### Basic Optimization

```typescript
import { East, StructType, ArrayType, FloatType, variant } from "@elaraai/east";
import { ALNS } from "@elaraai/east-py-datascience";

// Define your solution type
const SolutionType = StructType({
    values: ArrayType(FloatType),
    cost: FloatType,
});

const optimize = East.function([SolutionType], ALNS.Types.ResultType, ($, initial) => {
    // Objective: return the cost field
    const objective = East.function([SolutionType], FloatType, ($, solution) => {
        $.return(solution.cost);
    });

    // Destroy operator: partially destroy solution
    const destroy = East.function([SolutionType], SolutionType, ($, solution) => {
        $.return(solution);  // Identity for simplicity
    });

    // Repair operator: improve the solution
    const repair = East.function([SolutionType], SolutionType, ($, solution) => {
        const newCost = $.let(solution.cost.subtract(East.value(0.1)));
        $.return({
            values: solution.values,
            cost: newCost,
        });
    });

    // Configuration
    const config = $.let({
        stop: variant('some', variant('max_iterations', 100n)),
        acceptance: variant('none', null),  // default: simulated_annealing
        operator_selection: variant('none', null),  // default: roulette_wheel
        seed: variant('some', 42n),
    });

    // Run optimization - pass type parameter first
    const result = $.let(ALNS.optimize([SolutionType],
        initial,
        objective,
        [destroy],
        [repair],
        config
    ));

    $.return(result);
});
```

### Multiple Operators with Roulette Wheel Selection

```typescript
import { East, StructType, ArrayType, FloatType, variant } from "@elaraai/east";
import { ALNS } from "@elaraai/east-py-datascience";

const SolutionType = StructType({
    assignments: ArrayType(FloatType),
    cost: FloatType,
});

const optimizeWithMultipleOperators = East.function([SolutionType], ALNS.Types.ResultType, ($, initial) => {
    const objective = East.function([SolutionType], FloatType, ($, s) => $.return(s.cost));

    // Multiple destroy operators
    const randomDestroy = East.function([SolutionType], SolutionType, ($, s) => $.return(s));
    const greedyDestroy = East.function([SolutionType], SolutionType, ($, s) => $.return(s));

    // Multiple repair operators
    const greedyRepair = East.function([SolutionType], SolutionType, ($, s) => {
        $.return({ assignments: s.assignments, cost: s.cost.subtract(0.3) });
    });
    const randomRepair = East.function([SolutionType], SolutionType, ($, s) => {
        $.return({ assignments: s.assignments, cost: s.cost.subtract(0.1) });
    });

    const config = $.let({
        stop: variant('some', variant('max_iterations', 500n)),
        acceptance: variant('some', variant('simulated_annealing', {
            start_temperature: variant('some', 100.0),
            end_temperature: variant('some', 0.1),
            step: variant('some', 0.99),
        })),
        operator_selection: variant('some', variant('roulette_wheel', {
            scores: variant('some', [33n, 9n, 3n, 0n]),  // new_best, better, accepted, rejected
            decay: variant('some', 0.8),
        })),
        seed: variant('some', 42n),
    });

    const result = $.let(ALNS.optimize([SolutionType],
        initial,
        objective,
        [randomDestroy, greedyDestroy],
        [greedyRepair, randomRepair],
        config
    ));

    $.return(result);
});
```

### Stop on No Improvement

```typescript
import { East, StructType, FloatType, variant } from "@elaraai/east";
import { ALNS } from "@elaraai/east-py-datascience";

const SolutionType = StructType({ value: FloatType });

const optimizeWithEarlyStop = East.function([SolutionType], ALNS.Types.ResultType, ($, initial) => {
    const objective = East.function([SolutionType], FloatType, ($, s) => $.return(s.value));
    const destroy = East.function([SolutionType], SolutionType, ($, s) => $.return(s));
    const repair = East.function([SolutionType], SolutionType, ($, s) => $.return(s));

    const config = $.let({
        stop: variant('some', variant('no_improvement', 50n)),  // Stop after 50 iterations without improvement
        acceptance: variant('some', variant('hill_climbing', null)),  // Only accept improvements
        operator_selection: variant('none', null),
        seed: variant('some', 42n),
    });

    return $.return(ALNS.optimize([SolutionType], initial, objective, [destroy], [repair], config));
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
        stratify: variant('none', null),  // or variant('some', labels) for stratified split
        min_stratify_samples: variant('none', null),  // default 2; classes with fewer samples are rejected
    });
    const result = $.let(Sklearn.trainTestSplit(X, y, config));
    // result.rejected_indices contains indices of samples from rare classes (if stratify used)
    return $.return(result);
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
        stratify: variant('none', null),  // or variant('some', labels) for stratified split
        min_stratify_samples: variant('none', null),  // default 3; classes with fewer samples are rejected
    });
    const result = $.let(Sklearn.trainValTestSplit(X, Y, config));
    // result.rejected_indices contains indices of samples from rare classes (if stratify used)
    return $.return(result);
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

### Parameterized Regression Metrics

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const compute = East.function([], Sklearn.Types.MetricsResultType, $ => {
    const y_true = $.let([1.0, 2.0, 3.0, 4.0, 5.0]);
    const y_pred = $.let([1.1, 2.0, 2.9, 4.1, 5.0]);

    const results = $.let(Sklearn.computeMetrics(
        y_true,
        y_pred,
        [
            variant('mean_error', null),           // Bias: mean(pred - true)
            variant('pinball_loss', 0.5),          // Quantile loss (alpha=0.5 for median)
            variant('huber', 1.0),                 // Robust loss (delta=1.0)
            variant('mean_tweedie_deviance', 1.0), // Poisson deviance (power=1.0)
        ]
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

### RobustScaler

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const scale = East.function([], Sklearn.Types.MatrixType, $ => {
    const X_train = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [100.0, 200.0]]);  // Has outliers
    const X_test = $.let([[2.0, 3.0], [4.0, 5.0]]);

    const scaler = $.let(Sklearn.robustScalerFit(X_train));
    const X_scaled = $.let(Sklearn.robustScalerTransform(scaler, X_test));

    return $.return(X_scaled);
});
```

### Label Encoder

```typescript
import { East } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const encode = East.function([], Sklearn.Types.LabelVectorType, $ => {
    const labels = $.let([10n, 20n, 10n, 30n, 20n]);

    const encoder = $.let(Sklearn.labelEncoderFit(labels));
    const encoded = $.let(Sklearn.labelEncoderTransform(encoder, labels));
    // encoded: [0n, 1n, 0n, 2n, 1n]

    const decoded = $.let(Sklearn.labelEncoderInverseTransform(encoder, encoded));
    // decoded: [10n, 20n, 10n, 30n, 20n]

    return $.return(encoded);
});
```

### Gaussian Mixture Model (GMM)

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const cluster = East.function([], Sklearn.Types.LabelVectorType, $ => {
    const X = $.let([[1.0, 2.0], [1.5, 1.8], [5.0, 8.0], [8.0, 8.0], [1.0, 0.6], [9.0, 11.0]]);

    const config = $.let({
        n_components: variant('some', 2n),
        covariance_type: variant('some', variant('full', null)),
        max_iter: variant('some', 100n),
        n_init: variant('some', 1n),
        tol: variant('none', null),
        reg_covar: variant('none', null),
        random_state: variant('some', 42n),
    });

    const model = $.let(Sklearn.gmmFit(X, config));
    const labels = $.let(Sklearn.gmmPredict(model, X));
    const proba = $.let(Sklearn.gmmPredictProba(model, X));
    const bic = $.let(Sklearn.gmmBic(model, X));

    return $.return(labels);
});
```

### Probability Metrics (ROC AUC, Log Loss, Confusion Matrix)

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const metrics = East.function([], FloatType, $ => {
    const y_true = $.let([0n, 1n, 1n, 0n, 1n]);
    const y_proba = $.let([[0.9, 0.1], [0.2, 0.8], [0.3, 0.7], [0.8, 0.2], [0.1, 0.9]]);

    const auc = $.let(Sklearn.rocAucScore(y_true, y_proba, {
        multi_class: variant('some', variant('ovr', null)),
        average: variant('some', variant('macro', null)),
    }));

    const loss = $.let(Sklearn.logLoss(y_true, y_proba));

    const cm = $.let(Sklearn.confusionMatrix(y_true, $.let([0n, 1n, 1n, 0n, 1n])));
    // cm.matrix, cm.classes

    return $.return(auc);
});
```

### Class Weights

```typescript
import { East, variant } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

const weights = East.function([], Sklearn.Types.VectorType, $ => {
    const y = $.let([0n, 0n, 0n, 1n, 1n]);  // Imbalanced: 3 vs 2

    const w = $.let(Sklearn.computeClassWeight(variant('balanced', null), y));
    // w: balanced weights inversely proportional to class frequencies
    return $.return(w);
});
```

### Silhouette Score

```typescript
import { East, FloatType, IntegerType } from "@elaraai/east";
import { Sklearn, MatrixType, VectorType } from "@elaraai/east-py-datascience";

const evaluate = East.function([], FloatType, $ => {
    const X = $.let(East.Matrix.fromArray([
        [1.0, 1.0], [1.1, 0.9], [0.9, 1.1],
        [5.0, 5.0], [5.1, 4.9], [4.9, 5.1],
    ]));
    const labels = $.let([0n, 0n, 0n, 1n, 1n, 1n]);

    const score = $.let(Sklearn.silhouetteScore(X, labels));
    // score close to 1.0 means well-separated clusters
    return $.return(score);
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

### Histogram

```typescript
import { East, variant } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

const hist = East.function([], Scipy.Types.HistogramResultType, $ => {
    const data = $.let([1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0]);

    const config = $.let({
        bins: variant('some', 5n),
        bin_method: variant('none', null),
        range_min: variant('none', null),
        range_max: variant('none', null),
        density: variant('some', false),
        weights: variant('none', null),
    });

    const result = $.let(Scipy.histogram(data, config));
    // result.counts, result.bin_edges
    return $.return(result);
});
```

### Kernel Density Estimation (KDE)

```typescript
import { East, variant } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

const kde = East.function([], Scipy.Types.VectorType, $ => {
    const data = $.let([1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);

    const config = $.let({
        bandwidth: variant('some', variant('scott', null)),
        bandwidth_scalar: variant('none', null),
        weights: variant('none', null),
    });

    const model = $.let(Scipy.kdeFit(data, config));

    // Evaluate density at specific points
    const points = $.let([0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
    const densities = $.let(Scipy.kdeEvaluate(model, points));

    return $.return(densities);
});
```

### Percentile of Score

```typescript
import { East } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

const pctRank = East.function([], FloatType, $ => {
    const data = $.let([10.0, 20.0, 30.0, 40.0, 50.0]);
    const score = $.let(25.0);

    const rank = $.let(Scipy.statsPercentileOfScore(data, score));
    // rank: percentile rank of 25.0 in the dataset (0-100)
    return $.return(rank);
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
        gamma: variant('none', null),  // min loss reduction for split (default 0)
        random_state: variant('some', 42n),
        n_jobs: variant('none', null),
        sample_weight: variant('none', null),
        categorical_features: variant('none', null),  // column indices for categoricals
        max_cat_to_onehot: variant('none', null),
        max_cat_threshold: variant('none', null),
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
        gamma: variant('none', null),
        random_state: variant('some', 42n),
        n_jobs: variant('none', null),
        sample_weight: variant('none', null),
        categorical_features: variant('none', null),
        max_cat_to_onehot: variant('none', null),
        max_cat_threshold: variant('none', null),
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

## Lightning (PyTorch Lightning)

### Regression

```typescript
import { East, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

const train = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([
        [1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0],
        [5.0, 5.0], [6.0, 6.0], [7.0, 7.0], [8.0, 8.0],
    ]);
    const y = $.let([
        [2.0], [4.0], [6.0], [8.0], [10.0], [12.0], [14.0], [16.0],
    ]);

    const config = $.let({
        architecture: variant('mlp', { hidden_layers: [16n, 8n] }),
        output: variant('regression', null),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 100n),
        patience: variant('some', 10n),
        batch_size: variant('some', 4n),
        dropout: variant('some', 0.1),
        gradient_clip: variant('some', 1.0),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('none', null),
    });

    return $.return(Lightning.train(
        X, y, config,
        variant('none', null),  // masks
        variant('none', null),  // group_weights
        variant('none', null)   // conditions
    ));
});
```

### Binary Classification

```typescript
import { East, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

const train = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([
        [0.0, 0.0], [0.5, 0.5], [1.0, 1.0], [1.5, 1.5],
        [10.0, 10.0], [10.5, 10.5], [11.0, 11.0], [11.5, 11.5],
    ]);
    const y = $.let([
        [0.0], [0.0], [0.0], [0.0], [1.0], [1.0], [1.0], [1.0],
    ]);

    const config = $.let({
        architecture: variant('mlp', { hidden_layers: [16n] }),
        output: variant('binary', { pos_weight: variant('some', [1.0]) }),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 100n),
        patience: variant('some', 20n),
        batch_size: variant('some', 4n),
        dropout: variant('some', 0.0),
        gradient_clip: variant('some', 1.0),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('none', null),
    });

    return $.return(Lightning.train(
        X, y, config,
        variant('none', null),
        variant('none', null),
        variant('none', null)
    ));
});
```

### Multi-Head Classification

```typescript
import { East, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

// Multi-head: 2 heads × 3 classes each (e.g., additives with 84 time slots × 4 bins)
const train = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0], [0.0, 0.0]]);
    // Targets: (n_samples, n_heads * n_classes) = (4, 6)
    const y = $.let([
        [1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // head0=class0, head1=class1
        [0.0, 1.0, 0.0,  0.0, 0.0, 1.0],  // head0=class1, head1=class2
        [0.0, 0.0, 1.0,  1.0, 0.0, 0.0],  // head0=class2, head1=class0
        [1.0, 0.0, 0.0,  0.0, 1.0, 0.0],  // head0=class0, head1=class1
    ]);

    const config = $.let({
        architecture: variant('mlp', { hidden_layers: [32n, 16n] }),
        output: variant('multi_head', {
            n_heads: 2n,
            n_classes_per_head: 3n,
            class_weights: variant('none', null),
        }),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 100n),
        patience: variant('some', 20n),
        batch_size: variant('some', 2n),
        dropout: variant('some', 0.1),
        gradient_clip: variant('some', 1.0),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('none', null),
    });

    return $.return(Lightning.train(
        X, y, config,
        variant('none', null),
        variant('none', null),
        variant('none', null)
    ));
});
```

### Autoencoder with Encode/Decode

```typescript
import { East, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

const trainAutoencoder = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
        [1.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 1.0],
    ]);

    const config = $.let({
        architecture: variant('autoencoder', {
            encoder_layers: [8n],
            latent_dim: 2n,
            decoder_layers: [8n],
        }),
        output: variant('regression', null),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 100n),
        patience: variant('some', 20n),
        batch_size: variant('some', 4n),
        dropout: variant('some', 0.0),
        gradient_clip: variant('some', 1.0),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('none', null),
    });

    // Train autoencoder (X -> X reconstruction)
    return $.return(Lightning.train(
        X, X, config,
        variant('none', null),
        variant('none', null),
        variant('none', null)
    ));
});

// Extract and blend embeddings
const blendEmbeddings = East.function(
    [Lightning.Types.ModelBlobType],
    Lightning.Types.MatrixType,
    ($, model) => {
        const X_origins = $.let([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
        ]);

        // Encode to latent space
        const embeddings = $.let(Lightning.encode(model, X_origins));

        // Blend: 50/50 average of two embeddings
        const emb_A = $.let(embeddings.get(0n));
        const emb_B = $.let(embeddings.get(1n));
        const blend = $.let([
            emb_A.get(0n).multiply(0.5).add(emb_B.get(0n).multiply(0.5)),
            emb_A.get(1n).multiply(0.5).add(emb_B.get(1n).multiply(0.5)),
        ]);

        // Decode blended embedding
        const blend_matrix = $.let([blend]);
        const reconstructed = $.let(Lightning.decode(model, blend_matrix));

        return $.return(reconstructed);
    }
);
```

### Conv1D Temporal Autoencoder with Conditional Generation

```typescript
import { East, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

// Temporal autoencoder: 2 channels × 3 time steps × 2 classes = 12 features
const trainConditional = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([
        [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
        [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
        [0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
    ]);

    // Condition: 3-dim feature vector per sample (e.g., Stage 1 embeddings)
    const conditions = $.let([
        [1.0, 0.0, 0.5],
        [0.0, 1.0, 0.8],
        [1.0, 0.0, 0.5],
        [0.5, 0.5, 0.3],
    ]);

    const config = $.let({
        architecture: variant('conv1d', {
            n_channels: 2n,
            sequence_length: 3n,
            conv_channels: [8n],
            kernel_size: 3n,
            latent_dim: 4n,
            condition_dim: variant('some', 3n),
        }),
        output: variant('multi_head', {
            n_heads: 6n,  // n_channels * sequence_length
            n_classes_per_head: 2n,
            class_weights: variant('none', null),
        }),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 100n),
        patience: variant('some', 20n),
        batch_size: variant('some', 2n),
        dropout: variant('some', 0.0),
        gradient_clip: variant('some', 1.0),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('none', null),
    });

    // Train with conditions
    return $.return(Lightning.train(
        X, X, config,
        variant('none', null),           // masks
        variant('none', null),           // group_weights
        variant('some', conditions)      // conditions
    ));
});

// Predict with conditions and decode conditionally
const predictConditional = East.function(
    [Lightning.Types.ModelBlobType],
    Lightning.Types.MatrixType,
    ($, model) => {
        const X = $.let([
            [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
            [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        ]);
        const conditions = $.let([[1.0, 0.0, 0.5], [0.0, 1.0, 0.8]]);

        // Predict with conditions
        const predictions = $.let(Lightning.predict(
            model, X,
            variant('none', null),       // masks
            variant('some', conditions)  // conditions
        ));

        // Or: encode → decodeConditional
        const z = $.let(Lightning.encode(model, X));
        const decoded = $.let(Lightning.decodeConditional(model, z, conditions));

        return $.return(decoded);
    }
);
```

### Sequential (LSTM) Autoencoder

```typescript
import { East, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";

const trainLSTM = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([
        [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0],
        [0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
    ]);

    const config = $.let({
        architecture: variant('sequential', {
            n_channels: 2n,
            sequence_length: 3n,
            hidden_size: 16n,
            n_layers: 1n,
            cell_type: variant('lstm', null),  // or 'gru'
            latent_dim: 4n,
            bidirectional: true,
            condition_dim: variant('none', null),
        }),
        output: variant('multi_head', {
            n_heads: 6n,
            n_classes_per_head: 2n,
            class_weights: variant('none', null),
        }),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 100n),
        patience: variant('some', 20n),
        batch_size: variant('some', 2n),
        dropout: variant('some', 0.0),
        gradient_clip: variant('some', 1.0),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('none', null),
    });

    return $.return(Lightning.train(
        X, X, config,
        variant('none', null),
        variant('none', null),
        variant('none', null)
    ));
});
```

### Epoch Callback for Progress Logging

```typescript
import { East, FloatType, IntegerType, NullType, variant } from "@elaraai/east";
import { Lightning } from "@elaraai/east-py-datascience";
import { Console } from "@elaraai/east-node-std";

const trainWithCallback = East.function([], Lightning.Types.ResultType, $ => {
    const X = $.let([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]);
    const y = $.let([[2.0], [4.0], [6.0], [8.0]]);

    // Define epoch callback
    const callback = East.function(
        [IntegerType, FloatType, FloatType],
        NullType,
        ($, epoch, train_loss, val_loss) => {
            $(Console.log(
                East.value("Epoch ").concat(epoch.toString())
                    .concat(" - train: ").concat(train_loss.toString())
                    .concat(" val: ").concat(val_loss.toString())
            ));
            return $.return(null);
        }
    );

    const config = $.let({
        architecture: variant('mlp', { hidden_layers: [8n] }),
        output: variant('regression', null),
        learning_rate: variant('some', 0.01),
        max_epochs: variant('some', 50n),
        patience: variant('some', 10n),
        batch_size: variant('some', 2n),
        dropout: variant('none', null),
        gradient_clip: variant('none', null),
        weight_decay: variant('none', null),
        random_state: variant('some', 42n),
        epoch_callback: variant('some', callback),
    });

    return $.return(Lightning.train(
        X, y, config,
        variant('none', null),
        variant('none', null),
        variant('none', null)
    ));
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

## MAPIE (Conformal Prediction)

### Split Conformal Regression

```typescript
import { East, variant } from "@elaraai/east";
import { MAPIE } from "@elaraai/east-py-datascience";

// Train split conformal regressor with XGBoost base model
const train = East.function([], MAPIE.Types.MAPIERegressorBlobType, $ => {
    // Training data
    const X_train = $.let([[1.0], [2.0], [3.0], [4.0], [5.0]]);
    const y_train = $.let([1.5, 2.5, 3.5, 4.5, 5.5]);

    // Calibration data (separate from training)
    const X_calib = $.let([[2.5], [4.5]]);
    const y_calib = $.let([3.0, 5.0]);

    const config = $.let({
        base_model: variant('xgboost', {
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.1),
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 42n),
        }),
        method: variant('some', variant('split', null)),
        confidence_level: variant('some', 0.9),  // 90% prediction intervals
        cv_folds: variant('none', null),
        random_state: variant('some', 42n),
    });

    return $.return(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));
});

// Predict with intervals
const predictInterval = East.function(
    [MAPIE.Types.MAPIERegressorBlobType],
    MAPIE.Types.IntervalResultType,
    ($, model) => {
        const X_test = $.let([[1.5], [3.5], [5.5]]);
        const result = $.let(MAPIE.predictInterval(model, X_test));
        // result.lower, result.pred, result.upper
        return $.return(result);
    }
);
```

### Cross Conformal Regression

```typescript
import { East, variant } from "@elaraai/east";
import { MAPIE } from "@elaraai/east-py-datascience";

// Train cross conformal regressor (uses CV for calibration)
const trainCross = East.function([], MAPIE.Types.MAPIERegressorBlobType, $ => {
    const X_train = $.let([[1.0], [2.0], [3.0], [4.0], [5.0], [6.0], [7.0], [8.0]]);
    const y_train = $.let([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);

    // Calibration data combined with training for cross conformal
    const X_calib = $.let([[2.5], [4.5]]);
    const y_calib = $.let([3.0, 5.0]);

    const config = $.let({
        base_model: variant('lightgbm', {
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.1),
            num_leaves: variant('none', null),
            min_child_samples: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('some', 42n),
        }),
        method: variant('some', variant('cross', null)),  // Cross conformal
        confidence_level: variant('some', 0.9),
        cv_folds: variant('some', 5n),
        random_state: variant('some', 42n),
    });

    return $.return(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));
});
```

### Conformalized Quantile Regression (CQR)

```typescript
import { East, variant } from "@elaraai/east";
import { MAPIE } from "@elaraai/east-py-datascience";

// CQR produces adaptive intervals (wider where uncertainty is higher)
// Note: Internally uses HistGradientBoostingRegressor for CQR
const trainCQR = East.function([], MAPIE.Types.MAPIERegressorBlobType, $ => {
    const X_train = $.let([[1.0], [2.0], [3.0], [4.0], [5.0]]);
    const y_train = $.let([1.5, 2.5, 3.5, 4.5, 5.5]);
    const X_calib = $.let([[2.5], [4.5]]);
    const y_calib = $.let([3.0, 5.0]);

    const config = $.let({
        xgboost_config: {
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.1),
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 42n),
        },
        confidence_level: variant('some', 0.9),
        random_state: variant('some', 42n),
    });

    return $.return(MAPIE.trainCQR(X_train, y_train, X_calib, y_calib, config));
});
```

### Conformal Classification

```typescript
import { East, variant } from "@elaraai/east";
import { MAPIE } from "@elaraai/east-py-datascience";

// Train conformal classifier with prediction sets
const trainClassifier = East.function([], MAPIE.Types.MAPIEClassifierBlobType, $ => {
    // Training data
    const X_train = $.let([
        [1.0, 1.0], [1.5, 1.5], [2.0, 2.0], [2.5, 2.5],
        [5.0, 5.0], [5.5, 5.5], [6.0, 6.0], [6.5, 6.5],
    ]);
    const y_train = $.let([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n]);

    // Calibration data (need at least ceil(1/confidence_level) samples per class)
    const X_calib = $.let([
        [1.2, 1.2], [1.8, 1.8], [2.2, 2.2], [2.8, 2.8], [3.0, 3.0], [3.5, 3.5],
        [5.2, 5.2], [5.8, 5.8], [6.2, 6.2], [6.8, 6.8], [7.0, 7.0],
    ]);
    const y_calib = $.let([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n]);

    const config = $.let({
        base_model: variant('xgboost', {
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.1),
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 42n),
        }),
        method: variant('some', variant('lac', null)),  // LAC works for binary/multiclass
        confidence_level: variant('some', 0.9),
        random_state: variant('some', 42n),
    });

    return $.return(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));
});

// Predict with prediction sets
const predictSet = East.function(
    [MAPIE.Types.MAPIEClassifierBlobType],
    MAPIE.Types.PredictionSetResultType,
    ($, model) => {
        const X_test = $.let([[1.5, 1.5], [5.5, 5.5], [3.5, 3.5]]);
        const result = $.let(MAPIE.predictSet(model, X_test));
        // result.pred: predicted class
        // result.sets: prediction set membership (n_samples x n_classes)
        // result.probabilities: class probabilities
        // result.set_sizes: number of classes in each prediction set
        return $.return(result);
    }
);
```

### Multiclass Classification with APS

```typescript
import { East, variant } from "@elaraai/east";
import { MAPIE } from "@elaraai/east-py-datascience";

// APS (Adaptive Prediction Sets) works for multiclass only
const trainMulticlass = East.function([], MAPIE.Types.MAPIEClassifierBlobType, $ => {
    // 3-class classification
    const X_train = $.let([
        [1.0, 1.0], [1.5, 1.5], [2.0, 2.0],
        [5.0, 5.0], [5.5, 5.5], [6.0, 6.0],
        [9.0, 9.0], [9.5, 9.5], [10.0, 10.0],
    ]);
    const y_train = $.let([0n, 0n, 0n, 1n, 1n, 1n, 2n, 2n, 2n]);

    // Calibration data
    const X_calib = $.let([
        [1.2, 1.2], [1.8, 1.8], [2.2, 2.2], [2.8, 2.8],
        [5.2, 5.2], [5.8, 5.8], [6.2, 6.2], [6.8, 6.8],
        [9.2, 9.2], [9.8, 9.8], [10.2, 10.2],
    ]);
    const y_calib = $.let([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 2n, 2n, 2n]);

    const config = $.let({
        base_model: variant('lightgbm', {
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.1),
            num_leaves: variant('none', null),
            min_child_samples: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('some', 42n),
        }),
        method: variant('some', variant('aps', null)),  // APS for multiclass
        confidence_level: variant('some', 0.9),
        random_state: variant('some', 42n),
    });

    return $.return(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));
});
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

### TreeExplainer with XGBoost Quantile

```typescript
import { East, variant } from "@elaraai/east";
import { Shap, XGBoost } from "@elaraai/east-py-datascience";

// Train quantile model and explain with SHAP (uses median quantile for explanations)
const explainQuantile = East.function(
    [XGBoost.Types.ModelBlobType, Shap.Types.MatrixType],
    Shap.Types.FeatureImportanceType,
    ($, model, X) => {
        // TreeExplainer works with xgboost_quantile models
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

### Explaining MAPIE Uncertainty (Interval Width)

```typescript
import { East, variant } from "@elaraai/east";
import { Shap, MAPIE } from "@elaraai/east-py-datascience";

// Explain what drives prediction interval width in a MAPIE regressor
const explainUncertainty = East.function(
    [MAPIE.Types.MAPIERegressorBlobType, Shap.Types.MatrixType, Shap.Types.MatrixType],
    Shap.Types.FeatureImportanceType,
    ($, mapieModel, X_background, X_explain) => {
        // Create uncertainty predictor (predicts interval width instead of point prediction)
        const uncertaintyPredictor = $.let(MAPIE.uncertaintyPredictorRegressor(mapieModel));

        // Create KernelExplainer for the uncertainty predictor
        const explainer = $.let(Shap.kernelExplainerCreate(uncertaintyPredictor, X_background));

        const feature_names = $.let(["feature1", "feature2", "feature3"]);
        const shap_result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Feature importance shows which features increase/decrease uncertainty
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));
        return $.return(importance);
    }
);
```

### Explaining MAPIE Classifier Uncertainty (Set Size)

```typescript
import { East, variant } from "@elaraai/east";
import { Shap, MAPIE } from "@elaraai/east-py-datascience";

// Explain what drives prediction set size in a MAPIE classifier
const explainClassifierUncertainty = East.function(
    [MAPIE.Types.MAPIEClassifierBlobType, Shap.Types.MatrixType, Shap.Types.MatrixType],
    Shap.Types.FeatureImportanceType,
    ($, mapieModel, X_background, X_explain) => {
        // Create uncertainty predictor (predicts set size instead of class)
        const uncertaintyPredictor = $.let(MAPIE.uncertaintyPredictorClassifier(mapieModel));

        // Create KernelExplainer for the uncertainty predictor
        const explainer = $.let(Shap.kernelExplainerCreate(uncertaintyPredictor, X_background));

        const feature_names = $.let(["feature1", "feature2"]);
        const shap_result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Positive SHAP values = feature increases set size (more uncertainty)
        // Negative SHAP values = feature decreases set size (more certainty)
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));
        return $.return(importance);
    }
);
```

---

## Optimization (Iterative Coordinate Descent)

### Task-Worker Assignment

```typescript
import { East, FloatType, IntegerType, VectorType, variant } from "@elaraai/east";
import { Optimization } from "@elaraai/east-py-datascience";

const optimize = East.function([], Optimization.Types.ResultType, $ => {
    // 5 tasks, 3 workers. skill[task][worker] = match score.
    const skill = $.let([
        [3.0, 1.0, 2.0],   // task 0: best with worker 0
        [1.0, 3.0, 2.0],   // task 1: best with worker 1
        [2.0, 2.0, 3.0],   // task 2: best with worker 2
        [3.0, 2.0, 1.0],   // task 3: best with worker 0
        [1.0, 2.0, 3.0],   // task 4: best with worker 2
    ]);

    // Objective: total skill score for given assignment
    const objective = East.function(
        [VectorType(IntegerType)], FloatType,
        ($, assignments) => {
            const total = $.let(0.0);
            $.for(East.Array.range(0n, East.value(5n)), ($, i) => {
                const worker = $.let(assignments.get(i));
                const score = $.let(skill.get(i).get(worker));
                $.assign(total, total.add(score));
            });
            return $.return(total);
        }
    );

    // Each task can be assigned to worker 0, 1, or 2
    const spaces = $.let([
        new BigInt64Array([0n, 1n, 2n]),
        new BigInt64Array([0n, 1n, 2n]),
        new BigInt64Array([0n, 1n, 2n]),
        new BigInt64Array([0n, 1n, 2n]),
        new BigInt64Array([0n, 1n, 2n]),
    ]);

    const config = $.let({
        iterations: variant('some', 10n),
        samples: variant('some', 3n),
        initial: variant('some', variant('random', null)),
        order: variant('some', variant('sequential', null)),
        random_state: variant('some', 42n),
    });

    const result = $.let(Optimization.iterative(objective, spaces, config));
    // result.best_objective = 15.0 (each task assigned to best worker)
    return $.return(result);
});
```

### Simple Maximize with Defaults

```typescript
import { East, FloatType, IntegerType, VectorType, variant } from "@elaraai/east";
import { Optimization } from "@elaraai/east-py-datascience";

const optimize = East.function([], Optimization.Types.ResultType, $ => {
    // Maximize sum of parameter values
    const objective = East.function(
        [VectorType(IntegerType)], FloatType,
        ($, params) => {
            const total = $.let(0.0);
            $.for(East.Array.range(0n, params.length()), ($, i) => {
                $.assign(total, total.add(params.get(i).toFloat()));
            });
            return $.return(total);
        }
    );

    const spaces = $.let([
        new BigInt64Array([0n, 1n, 2n]),
        new BigInt64Array([0n, 1n, 2n]),
    ]);

    // All-none config: use all defaults
    const config = $.let({
        iterations: variant('none', null),
        samples: variant('none', null),
        initial: variant('none', null),
        order: variant('none', null),
        random_state: variant('none', null),
    });

    const result = $.let(Optimization.iterative(objective, spaces, config));
    // result.best_objective = 4.0 (finds [2, 2])
    return $.return(result);
});
```

---

## GoogleOr (Google OR-Tools)

### CP-SAT: Integer Optimization

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr, CpSatModelType, CpSatConfigType } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.CpSatResultType, $ => {
    // Maximize 2x + 3y subject to x + y <= 10, x,y in [0,10]
    const model = $.let({
        int_vars: [
            { name: "x", lower_bound: 0n, upper_bound: 10n },
            { name: "y", lower_bound: 0n, upper_bound: 10n },
        ],
        bool_vars: [
            { name: "_unused" },
        ],
        interval_vars: [
            { name: "_unused_iv", start: "x", size: "x", end: "x", is_present: variant('none', null) },
        ],
        constraints: [
            variant('linear', {
                expr: {
                    terms: [
                        { var: "x", coeff: 1n },
                        { var: "y", coeff: 1n },
                    ],
                    constant: 0n,
                },
                op: variant('less_equal', null),
                rhs: 10n,
            }),
        ],
        objective: variant('some', variant('maximize', {
            terms: [
                { var: "x", coeff: 2n },
                { var: "y", coeff: 3n },
            ],
            constant: 0n,
        })),
    }, CpSatModelType);

    const config = $.let({
        max_time_seconds: variant('none', null),
        num_workers: variant('none', null),
        log_search_progress: variant('none', null),
        seed: variant('some', 42n),
        max_solutions: variant('none', null),
    }, CpSatConfigType);

    const result = $.let(GoogleOr.cpsatSolve(model, config));
    // Optimal: x=0, y=10 -> objective 30
    return $.return(result);
});
```

### CP-SAT: All-Different Constraint

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr, CpSatModelType, CpSatConfigType } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.CpSatResultType, $ => {
    // 3 variables in [1,3], all must be different
    // Maximize a + 2b + 3c
    const model = $.let({
        int_vars: [
            { name: "a", lower_bound: 1n, upper_bound: 3n },
            { name: "b", lower_bound: 1n, upper_bound: 3n },
            { name: "c", lower_bound: 1n, upper_bound: 3n },
            { name: "_d", lower_bound: 0n, upper_bound: 0n },
        ],
        bool_vars: [
            { name: "_unused" },
        ],
        interval_vars: [
            { name: "_unused_iv", start: "_d", size: "_d", end: "_d", is_present: variant('none', null) },
        ],
        constraints: [
            variant('all_different', {
                vars: ["a", "b", "c"],
            }),
        ],
        objective: variant('some', variant('maximize', {
            terms: [
                { var: "a", coeff: 1n },
                { var: "b", coeff: 2n },
                { var: "c", coeff: 3n },
            ],
            constant: 0n,
        })),
    }, CpSatModelType);

    const config = $.let({
        max_time_seconds: variant('none', null),
        num_workers: variant('none', null),
        log_search_progress: variant('none', null),
        seed: variant('some', 42n),
        max_solutions: variant('none', null),
    }, CpSatConfigType);

    const result = $.let(GoogleOr.cpsatSolve(model, config));
    // Optimal: a=1, b=2, c=3 -> 1+4+9 = 14
    return $.return(result);
});
```

### Routing: TSP with Time Windows

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr, RoutingModelType, RoutingConfigType } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.RoutingResultType, $ => {
    // 4 cities, find shortest tour
    const model = $.let({
        distance_matrix: [
            [0n, 10n, 15n, 20n],
            [10n, 0n, 35n, 25n],
            [15n, 35n, 0n, 30n],
            [20n, 25n, 30n, 0n],
        ],
        num_vehicles: 1n,
        depot: 0n,
        demands: variant('some', [0n, 1n, 1n, 1n]),
        vehicle_capacities: variant('some', [100n]),
        time_matrix: variant('some', [
            [0n, 10n, 15n, 20n],
            [10n, 0n, 35n, 25n],
            [15n, 35n, 0n, 30n],
            [20n, 25n, 30n, 0n],
        ]),
        time_windows: variant('some', [
            { start: 0n, end: 1000n },
            { start: 0n, end: 1000n },
            { start: 0n, end: 1000n },
            { start: 0n, end: 1000n },
        ]),
        pickup_deliveries: variant('some', [
            { pickup: 1n, delivery: 2n },
        ]),
    }, RoutingModelType);

    const config = $.let({
        first_solution: variant('some', variant('path_cheapest_arc', null)),
        metaheuristic: variant('none', null),
        max_time_seconds: variant('some', 10.0),
    }, RoutingConfigType);

    const result = $.let(GoogleOr.routingSolve(model, config));
    // result.routes: array of vehicle routes
    // result.total_distance: total distance traveled
    return $.return(result);
});
```

### Linear Programming: LP

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr, LinearModelType, LinearConfigType } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.LinearResultType, $ => {
    // Maximize 3x + 2y subject to x + y <= 4, x,y in [0,3]
    const model = $.let({
        variables: [
            { name: "x", lower_bound: 0.0, upper_bound: 3.0, is_integer: false },
            { name: "y", lower_bound: 0.0, upper_bound: 3.0, is_integer: false },
        ],
        constraints: [
            {
                terms: [
                    { var: "x", coeff: 1.0 },
                    { var: "y", coeff: 1.0 },
                ],
                lower_bound: -1e20,
                upper_bound: 4.0,
            },
        ],
        objective: {
            terms: [
                { var: "x", coeff: 3.0 },
                { var: "y", coeff: 2.0 },
            ],
            maximize: true,
        },
    }, LinearModelType);

    const config = $.let({
        solver: variant('none', null),
        max_time_seconds: variant('none', null),
    }, LinearConfigType);

    const result = $.let(GoogleOr.linearSolve(model, config));
    // Optimal: x=3, y=1 -> objective 11
    return $.return(result);
});
```

### Linear Programming: MIP (Integer Variables)

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr, LinearModelType, LinearConfigType } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.LinearResultType, $ => {
    // Maximize 5x + 4y, x+y <= 5, x,y integer in [0,5]
    const model = $.let({
        variables: [
            { name: "x", lower_bound: 0.0, upper_bound: 5.0, is_integer: true },
            { name: "y", lower_bound: 0.0, upper_bound: 5.0, is_integer: true },
        ],
        constraints: [
            {
                terms: [
                    { var: "x", coeff: 1.0 },
                    { var: "y", coeff: 1.0 },
                ],
                lower_bound: -1e20,
                upper_bound: 5.0,
            },
        ],
        objective: {
            terms: [
                { var: "x", coeff: 5.0 },
                { var: "y", coeff: 4.0 },
            ],
            maximize: true,
        },
    }, LinearModelType);

    const config = $.let({
        solver: variant('none', null),
        max_time_seconds: variant('none', null),
    }, LinearConfigType);

    const result = $.let(GoogleOr.linearSolve(model, config));
    // Optimal: x=5, y=0 -> objective 25
    return $.return(result);
});
```

### Graph: Min-Cost Flow

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.MinCostFlowResultType, $ => {
    // Network: 0 -> 1 -> 3, 0 -> 2 -> 3
    // Supply at node 0, demand at node 3
    const input = $.let({
        start_nodes: [0n, 0n, 1n, 2n],
        end_nodes:   [1n, 2n, 3n, 3n],
        capacities:  [15n, 8n, 20n, 8n],
        unit_costs:  [4n,  4n, 2n,  6n],
        supplies:    [20n, 0n, 0n, -20n],
    });

    const result = $.let(GoogleOr.minCostFlow(input));
    // result.total_cost: minimum cost to route all supply to demand
    // result.flows: flow on each arc
    return $.return(result);
});
```

### Graph: Max Flow

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.MaxFlowResultType, $ => {
    // Diamond network: 0 -> 1, 0 -> 2, 1 -> 3, 2 -> 3
    const input = $.let({
        start_nodes: [0n, 0n, 1n, 2n],
        end_nodes:   [1n, 2n, 3n, 3n],
        capacities:  [10n, 10n, 10n, 10n],
        source: 0n,
        sink: 3n,
    });

    const result = $.let(GoogleOr.maxFlow(input));
    // result.total_flow = 20 (10 + 10 through two paths)
    return $.return(result);
});
```

### Graph: Linear Sum Assignment

```typescript
import { East, variant } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

const solve = East.function([], GoogleOr.Types.AssignmentResultType, $ => {
    // 3 workers, 3 tasks, cost matrix
    const input = $.let({
        costs: [
            [90n, 76n, 75n],
            [35n, 85n, 55n],
            [125n, 95n, 90n],
        ],
    });

    const result = $.let(GoogleOr.assignment(input));
    // Optimal: worker 0 -> task 1 (76), worker 1 -> task 0 (35), worker 2 -> task 2 (90) = 201
    // result.assignments: array of { worker, task, cost }
    return $.return(result);
});
```

---

## PyMC (Bayesian Inference)

### Bayesian Linear Regression

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { PyMC, PyMCRegressionConfigType, MatrixType } from "@elaraai/east-py-datascience";

const train = East.function(
    [MatrixType(FloatType), MatrixType(FloatType)],
    PyMC.Types.ModelBlobType,
    ($, X, Y) => {
        const config = $.let({
            prior: variant("none", null),
            likelihood: variant("none", null),
            include_intercept: variant("some", true),
            samples: variant("some", 1000n),
            tune: variant("some", 1000n),
            chains: variant("some", 2n),
            target_accept: variant("none", null),
        }, PyMCRegressionConfigType);
        return $.return(PyMC.trainRegression(X, Y, config));
    }
);

// Predict with trained model
const predict = East.function(
    [PyMC.Types.ModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType),
    ($, model, X) => {
        const config = $.let({
            layer: variant("none", null),
            n_samples: variant("some", 100n),
        });
        return $.return(PyMC.predict(model, X, config));
    }
);
```

### Hierarchical Bayesian Model

```typescript
import { East, FloatType, IntegerType, variant } from "@elaraai/east";
import { PyMC, PyMCHierarchicalConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";

const train = East.function(
    [MatrixType(FloatType), MatrixType(FloatType), VectorType(IntegerType)],
    PyMC.Types.ModelBlobType,
    ($, X, Y, groups) => {
        const config = $.let({
            prior: variant("none", null),
            likelihood: variant("none", null),
            pooling: variant("some", variant("partial", null)),
            samples: variant("some", 1000n),
            tune: variant("some", 1000n),
            chains: variant("some", 2n),
            target_accept: variant("none", null),
        }, PyMCHierarchicalConfigType);
        return $.return(PyMC.trainHierarchical(X, Y, groups, config));
    }
);

// Diagnostics
const diagnose = East.function(
    [PyMC.Types.ModelBlobType],
    PyMC.Types.PyMCDiagnosticsResultType,
    ($, model) => {
        const result = $.let(PyMC.diagnostics(model));
        // result.converged, result.n_divergences, result.warnings
        return $.return(result);
    }
);
```

---

## Simulation (Economic Ontology via DES)

### Single Economic Ontology Run

```typescript
import { East, StructType, VariantType, ArrayType, FloatType, DateTimeType, variant } from "@elaraai/east";
import { Simulation, SimulationConfigType } from "@elaraai/east-py-datascience";

const Resources = StructType({ cash: FloatType });
const Events = VariantType({ income: FloatType, expense: FloatType });
const ScheduledEvent = StructType({ date: DateTimeType, event: Events });
const ProcessResult = StructType({ state: Resources, events: ArrayType(ScheduledEvent) });

const simulate = East.function([], Simulation.Types.ResultType, ($) => {
    const process = East.function(
        [Resources, DateTimeType, Events],
        ProcessResult,
        ($, state, date, event) => {
            const empty = $.let([] as const, ArrayType(ScheduledEvent));
            return $.return(event.match({
                income: ($, amount) => ({
                    state: { cash: state.cash.add(amount) },
                    events: empty,
                }),
                expense: ($, amount) => ({
                    state: { cash: state.cash.subtract(amount) },
                    events: empty,
                }),
            }));
        }
    );

    const initialState = $.let({ cash: 1000.0 });
    const initialEvents = $.let([
        { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 500.0), Events) },
        { date: $.let(new Date("2025-01-15")), event: $.let(variant("expense", 200.0), Events) },
    ], ArrayType(ScheduledEvent));
    const config = $.let({
        max_events: variant("none", null),
        end_date: variant("none", null),
    }, SimulationConfigType);

    const result = $.let(Simulation.run(
        [Resources, Events],
        initialState, initialEvents, process, config,
    ));
    // result.final_state.cash => 1300.0
    // result.events_processed => 2n
    return $.return(result);
});
```

### Monte Carlo Trajectories

```typescript
import { East, StructType, VariantType, ArrayType, FloatType, DateTimeType, variant } from "@elaraai/east";
import { Simulation, SimulationTrajectoriesConfigType } from "@elaraai/east-py-datascience";

const Resources = StructType({ cash: FloatType });
const Events = VariantType({ income: FloatType, expense: FloatType });
const ScheduledEvent = StructType({ date: DateTimeType, event: Events });
const ProcessResult = StructType({ state: Resources, events: ArrayType(ScheduledEvent) });

const simulate = East.function([], Simulation.Types.TrajectoriesResultType, ($) => {
    const process = East.function(
        [Resources, DateTimeType, Events],
        ProcessResult,
        ($, state, date, event) => {
            const empty = $.let([] as const, ArrayType(ScheduledEvent));
            return $.return(event.match({
                income: ($, amount) => ({
                    state: { cash: state.cash.add(amount) },
                    events: empty,
                }),
                expense: ($, amount) => ({
                    state: { cash: state.cash.subtract(amount) },
                    events: empty,
                }),
            }));
        }
    );

    const initialState = $.let({ cash: 1000.0 });
    const initialEvents = $.let([
        { date: $.let(new Date("2025-01-01")), event: $.let(variant("income", 500.0), Events) },
        { date: $.let(new Date("2025-01-15")), event: $.let(variant("expense", 200.0), Events) },
    ], ArrayType(ScheduledEvent));
    const config = $.let({
        trajectories: 100n,
        seed: variant("some", 42n),
        max_events: variant("none", null),
        end_date: variant("some", new Date("2025-12-31")),
    }, SimulationTrajectoriesConfigType);

    const result = $.let(Simulation.runTrajectories(
        [Resources, Events],
        initialState, initialEvents, process, config,
    ));
    // result.trajectories.length() => 100n
    // result.trajectories.get(0n).final_state.cash
    return $.return(result);
});
```
