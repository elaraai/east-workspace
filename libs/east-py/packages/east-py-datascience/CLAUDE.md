# East Data Science

East Data Science provides data science and ML platform functions for the East language.

## Purpose

East Data Science enables East programs to use ML and optimization algorithms by providing:

- **Platform Functions**: TypeScript type definitions that compile to East IR
- **Python Runtime**: Python implementations that execute the platform functions
- **Testing Infrastructure**: Tests written in East (TypeScript) that export IR and run on Python

## Structure

This is a hybrid TypeScript + Python package:

- `/src` - TypeScript source code (platform function type definitions)
- `/src/east_py_datascience` - Python source code (platform function implementations)
- `/tests` - Python tests that run exported IR from TypeScript tests

## Development

### TypeScript (Type Definitions)

```bash
npm run build      # Compile TypeScript to JavaScript
npm run test       # Run tests (runs compiled .js - requires build first)
npm run lint       # Check code quality with ESLint
npm run test:export # Export test IR to /tmp/east-py-datascience
```

### Python (Runtime Implementations)

```bash
uv run pytest      # Run Python tests
uv run pytest -v   # Run with verbose output
```

## Standards

**All development MUST follow the mandatory standards defined in [STANDARDS.md](./STANDARDS.md).**

## Python Conventions

### Optional Dependencies

Each module that depends on a third-party library MUST:

1. **Declare the dependency in `pyproject.toml`** as an optional dependency group named after the module:
   ```toml
   [project.optional-dependencies]
   mads = ["PyNomadBBO>=4.4.0"]
   google-or = ["ortools>=9.9"]
   ```
   Also add to the `all` group.

2. **Two-layer import guard** in each module:

   **Layer 1: Module-level `find_spec` check** — fast guard that avoids import overhead:
   ```python
   import importlib.util

   _HAS_MYMODULE_SUPPORT = importlib.util.find_spec("library") is not None

   def _check_mymodule_support() -> None:
       """Check if mymodule support is available."""
       if not _HAS_MYMODULE_SUPPORT:
           raise NotImplementedError(
               "MyModule support requires the 'mymodule' extra. "
               "Add east-py-datascience[mymodule] to your pyproject.toml dependencies."
           )
   ```

   **Layer 2: Bare lazy imports** inside each implementation function:
   ```python
   def my_impl_function(args):
       _check_mymodule_support()
       from library import something
       # ... use the library ...
   ```

   - Every impl function calls `_check_*_support()` first, then bare-imports (no `try/except ImportError`)
   - The `_check_*_support()` guard already raises `NotImplementedError` if the package is missing, so `try/except ImportError` inside functions is redundant
   - Do NOT import third-party optional libraries at module top level
   - Core dependencies (numpy, east-py) may be imported at the top level

3. **Add mypy overrides** in `pyproject.toml` for both the external library and the module:
   ```toml
   [[tool.mypy.overrides]]
   module = ["ortools", "ortools.*"]
   ignore_missing_imports = true

   [[tool.mypy.overrides]]
   module = ["east_py_datascience.google_or.*"]
   ignore_errors = true
   ```

## Modules

### Optimization
- **MADS** (`mads/` — `mads.ts` / `mads.py`): Derivative-free blackbox optimization using PyNomadBBO
- **Optuna** (`optuna/` — `optuna.ts` / `optuna.py`): Bayesian optimization with TPE sampler
- **SimAnneal** (`simanneal/` — `simanneal.ts` / `simanneal.py`): Simulated annealing for discrete optimization
- **ALNS** (`alns/` — `alns.ts` / `alns.py`): Adaptive large neighborhood search (generic over solution type)
- **Scipy** (`scipy/` — `scipy.ts` / `scipy_impl.py`): Scientific optimization, curve fitting, interpolation, statistics
- **Optimization** (`optimization/` — `optimization.ts` / `optimization.py`): Iterative coordinate descent optimization
- **GoogleOr** (`google_or/` — `google_or.ts` / `cpsat.py`, `routing.py`, `linear.py`, `graph.py`): Google OR-Tools — CP-SAT, vehicle routing, LP/MIP, min-cost flow, max flow, assignment

### Machine Learning
- **XGBoost** (`xgboost/` — `xgboost.ts` / `xgboost_impl.py`): Gradient boosting (regression, classification, quantile)
- **LightGBM** (`lightgbm/` — `lightgbm.ts` / `lightgbm_impl.py`): Fast gradient boosting with leaf-wise growth
- **NGBoost** (`ngboost/` — `ngboost.ts` / `ngboost_impl.py`): Probabilistic gradient boosting with uncertainty
- **Torch** (`torch/` — `torch.ts` / `torch_impl.py`): Neural networks with PyTorch (MLP)
- **Lightning** (`lightning/` — `lightning.ts` / `lightning_impl.py`): PyTorch Lightning neural networks (MLP, autoencoder, conv1d, sequential, transformer)
- **GP** (`gp/` — `gp.ts` / `gp_impl.py`): Gaussian Process regression

### Bayesian Inference
- **PyMC** (`pymc/` — `pymc.ts` / `pymc_impl.py`): Bayesian linear regression, hierarchical models, multi-layer joint estimation

### ML Utilities
- **Sklearn** (`sklearn/` — `sklearn.ts` / `sklearn.py`): Preprocessing, metrics, data splitting, regressor chains
- **MAPIE** (`mapie/` — `mapie.ts` / `mapie_impl.py`): Conformal prediction intervals

### Simulation
- **Simulation** (`simulation/` — `simulation.ts` / `simulation_impl.py`): Economic ontology simulation via DES (single run, Monte Carlo trajectories)

### Explainability
- **Shap** (`shap/` — `shap.ts` / `shap_impl.py`): SHAP values for model interpretation

## Exported Object JSDoc Requirements

Every method on a grouped export object (e.g., `Scipy`, `MADS`, `PyMC`, `Simulation`) MUST have a JSDoc `@example` block showing a complete working East function. Examples should follow the pattern:

```typescript
/**
 * Description of the function.
 *
 * @example
 * ```ts
 * import { East, FloatType, variant } from "@elaraai/east";
 * import { Module, SomeConfigType } from "@elaraai/east-py-datascience";
 *
 * const myFn = East.function(
 *     [/* input types */],
 *     /* return type */,
 *     ($, /* params */) => {
 *         const config = $.let({ /* ... */ }, SomeConfigType);
 *         return $.return(Module.method(/* args */));
 *     }
 * );
 * ```
 */
```

## Documentation Maintenance

When making changes, keep all documentation files in sync:

### Adding a New Platform Function
1. `reference/api.md` — add to the module's Functions table and Types table
2. `reference/examples.md` — add a working code example
3. `SKILL.md` — add to the module's decision tree branch
4. `src/east_py_datascience/reference/api.md` — keep in sync with `reference/api.md`

### Adding a New Module
All of the above, plus:
1. `README.md` — add row to the appropriate Modules table and Optional Dependencies table
2. `SKILL.md` — add row to the Available Modules table and add a new decision tree branch
3. `CLAUDE.md` — add entry under the appropriate Modules subsection
