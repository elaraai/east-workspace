# East Data Science

Data-science and ML platform functions for the East language. Hybrid
TypeScript + Python package:

- `src/` — TypeScript source (platform function type definitions).
- `src/east_py_datascience/` — Python source (platform function
  implementations).
- `test/` — TypeScript export-only specs (`*.spec.ts`); their IR is what
  the Python side runs.
- `tests/` — `test_compliance.py`, a pytest wrapper that replays that IR
  (one subprocess per IR file, through east-py's core runner).

## Commands

```bash
make build       # tsc
make test        # export the spec IR, then replay it with pytest
make test-export # export IR to /tmp/east-py-datascience (for the Python side)
make test-py     # replay already-exported IR (EAST_DATASCIENCE_IR_DIR overrides the dir)
make lint        # eslint + ruff
make typecheck   # mypy
```

The canonical full run is `make test-east-py-datascience EAST_QUIET=1` from
`libs/east-py` (export + replay through the core runner). After editing a
`.pyx`, run `make reinstall-east-py-datascience` there to rebuild the
extension; `.py` edits are live through the editable install.

See [`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

## Modules

### Shared helpers

- `_common.py` — `serialize` / `deserialize` (cloudpickle blobs),
  `extra_guard` (every module builds its `_check_<lib>_support()` from it),
  `option_tag` / `expect_case` (option and model-blob readers), and
  `quiet_warnings` (scoped `UserWarning` / `FutureWarning` filter for chatty
  fits). Reuse these; do not re-implement them per module.
- `_categorical.py` — categorical column handling shared by xgboost,
  lightgbm, mapie and shap (`categorical_config`, `prepare_categorical`,
  `apply_categorical`).

### Optimization

- **MADS** (`mads/`) — derivative-free blackbox optimization (PyNomadBBO).
- **Optuna** (`optuna/`) — Bayesian optimization with TPE sampler.
- **SimAnneal** (`simanneal/`) — simulated annealing for discrete optimization.
- **ALNS** (`alns/`) — adaptive large neighborhood search (generic over solution type).
- **Scipy** (`scipy/`) — scientific optimization, curve fitting, interpolation, statistics.
- **Optimization** (`optimization/`) — iterative coordinate descent.
- **GoogleOr** (`google_or/`) — Google OR-Tools — CP-SAT, vehicle routing, LP/MIP, min-cost flow, max flow, assignment.

### Machine learning

- **XGBoost** (`xgboost/`) — gradient boosting (regression, classification, quantile).
- **LightGBM** (`lightgbm/`) — fast gradient boosting with leaf-wise growth.
- **NGBoost** (`ngboost/`) — probabilistic gradient boosting with uncertainty.
- **Torch** (`torch/`) — neural networks with PyTorch (MLP).
- **Lightning** (`lightning/`) — PyTorch Lightning (MLP, autoencoder, conv1d, sequential, transformer); the torch classes live in `_models.py`, imported lazily so the package never loads torch at import.
- **GP** (`gp/`) — Gaussian Process regression.

### Bayesian inference

- **PyMC** (`pymc/`) — Bayesian linear regression, hierarchical models, multi-layer joint estimation.

### Causal inference

- **Causal** (`causal/`) — DoWhy backdoor effects + refuters, EconML LinearDML CATE, PyALE dose-response.

### ML utilities

- **Sklearn** (`sklearn/`) — preprocessing, metrics, data splitting, regressor chains.
- **MAPIE** (`mapie/`) — conformal prediction intervals.

### Simulation

- **Simulation** (`simulation/`) — economic ontology simulation via DES (single run).

### Explainability

- **Shap** (`shap/`) — SHAP values for model interpretation.

## Optional dependencies

Every module that wraps a third-party native library follows the
two-layer `find_spec` + lazy-import guard pattern in
[`../../../../docs/conventions/PYTHON_OPTIONAL_DEPS.md`](../../../../docs/conventions/PYTHON_OPTIONAL_DEPS.md).
Read that before adding a new module.

## Documentation maintenance

When changes affect the public API, keep these in sync:

### Adding a platform function

1. `SKILL.md` — add to the module's decision-tree branch.
2. `*.examples.ts` — add a working example (the search index is
   regenerated from these).

### Adding a new module

All of the above, plus:

1. `README.md` — add row to the appropriate Modules + Optional
   Dependencies tables.
2. `SKILL.md` — add row to the Available Modules table and a new
   decision-tree branch.
3. `CLAUDE.md` (this file) — add entry under the appropriate Modules
   subsection.

## See also

- [`SKILL.md`](SKILL.md) — authoring cheat-sheet. **Matches the
  `east:east-py-datascience` plugin skill — DO NOT EDIT casually.**
- [`STANDARDS.md`](STANDARDS.md) — TypeDoc + testing standards.
- [`../../../../docs/conventions/PYTHON_OPTIONAL_DEPS.md`](../../../../docs/conventions/PYTHON_OPTIONAL_DEPS.md)
  — declaring optional native deps and the import-guard pattern.
- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
  — TS↔East rules for the TS side of this hybrid package.
- [`../east-py/CLAUDE.md`](../east-py/CLAUDE.md) — core Python runtime
  architecture.
