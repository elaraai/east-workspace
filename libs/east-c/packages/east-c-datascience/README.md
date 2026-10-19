# east-c-datascience

east-py-datascience's platform functions on the C runtime, family by family:
the same names, East types and semantics, so a task moves between the runners
by changing its runner and nothing else, and the suites east-py-datascience's
specs export run here unchanged.

| Family | Functions | On |
|---|---|---|
| Google OR-Tools | `google_or_cpsat_solve`, `google_or_cpsat_solve_all`, `google_or_linear_solve` (Glop, SCIP, HiGHS by the same backend ids), `google_or_routing_solve`, `google_or_min_cost_flow`, `google_or_max_flow`, `google_or_assignment`, `google_or_min_cost_assignment` | OR-Tools' C++ API, the model built straight from the East values |
| XGBoost | `xgboost_train_regressor`, `xgboost_train_classifier`, `xgboost_train_quantile`, `xgboost_predict`, `xgboost_predict_class`, `xgboost_predict_proba`, `xgboost_predict_quantile` | XGBoost's C API; the model blob is XGBoost's own UBJSON model, so a model trained on one runner predicts on the other |
| NeuralNet | `nn_init`, `nn_run` (`nn_train` stays in torch) | A CPU interpreter in IEEE double of the networks east-py-datascience states as data (`libs/east-py/packages/east-py-datascience/docs/neural-networks.md`): every operation of the specification, forward only; attention over key lists; a network's plan and its weights kept between calls |

## Build

The package is C++17 and built on request:

```bash
make fetch-ortools                    # the pinned prebuilt OR-Tools release, into build-deps/or-tools
make build EAST_C_DATASCIENCE=ON      # east-c, std, the CLI and this package
./build/packages/east-c-cli/east-c version -p datascience
```

OR-Tools is linked from a prebuilt install — its release archives run to 55 MB
a platform and its source build to most of an hour — as east-c-std links the
system libcurl. `scripts/fetch-ortools.sh` pins one release per platform by
its SHA-256 (Linux x86_64 today; another platform names its own install
through `CMAKE_PREFIX_PATH` or `ortools_DIR`). XGBoost builds from its release
archive under `third_party/`, CPU only, as a static library, so no build
downloads anything (`scripts/check-native-sources.mjs` at the workspace root).

With the package built, the CLI takes `-p east-c-datascience` (or
`datascience`) beside `-p std`, and a unit whose runner lists
`east-c-datascience` (e3's `{ runtime: 'east-c', platforms: ['east-c-std',
'east-c-datascience'] }`) runs its platform functions here. A build without
the package refuses the name, saying how to build it.

## Tests

The compliance suites are east-py-datascience's own: its specs export their
IR (`make -C libs/east-py test-export`, into `EAST_DATASCIENCE_IR_DIR`), and
the suites of the families implemented here run through
`test_datascience_compliance` — east-c-std's runner, registering this package
beside std:

```bash
make -C ../../../east-py test-export
make test-east-c-datascience
```

Those suites hold both runners to the same fixtures: exact where a solver is
deterministic (an LP's status, objective and solution on every backend, a
single-worker CP-SAT solve, a network's flows), the status and objective where
it is not (multi-worker CP-SAT), and tolerance where floating point may differ
(a model trained on each runner from the same data and seed). The XGBoost
suite also predicts from model blobs the python runner trained and wrote
(`test/fixtures/xgboost_interchange.json`), and must answer what that runner
answered. The neural-network suite holds every operation to the
specification's shapes and conventions, and the two reference networks (a
transformer over ragged grouped sequences, a conditioned 1-D U-Net:
`test/nn.reference.generated.ts`, written by python from hand-written torch)
to torch's outputs within 2e-3, their integer outputs exactly.

## Layout

- `include/east_datascience/east_datascience.h` — the C surface: each
  family's registration, `east_datascience_register_all`, the library
  versions.
- `src/value_util.h` — reading East values and building results from C++: a
  body throws `east_ds::Error` and `platform_call` answers it as the East
  error; results are built in the type the IR declares for the call.
- `src/google_or_*.cc` — the OR-Tools family, one file per solver.
- `src/xgboost.cc` — the XGBoost family, the categorical encoding and the
  blob forms.
- `src/nn/` — the neural-network family: `tensor.h` a dense tensor of one
  element type with broadcasting walks, `plan.h/.cc` a `NetType` value
  resolved and checked (the twin of python's `_plan.py`), `interp.h/.cc` the
  CPU interpreter of every operation and the parameter initialisations,
  `nn.cc` the East boundary (`nn_init`, `nn_run`) and the plan and weight
  caches.
- `third_party/` — XGBoost's release archive, pinned by SHA-256.
