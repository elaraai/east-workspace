# east-c-datascience

east-py-datascience's platform functions on the C runtime, family by family:
the same names, East types and semantics, so a task moves between the runners
by changing its runner and nothing else, and the suites east-py-datascience's
specs export run here unchanged.

| Family | Functions | On |
|---|---|---|
| Google OR-Tools | `google_or_cpsat_solve`, `google_or_cpsat_solve_all`, `google_or_linear_solve` (Glop, SCIP, HiGHS by the same backend ids), `google_or_routing_solve`, `google_or_min_cost_flow`, `google_or_max_flow`, `google_or_assignment`, `google_or_min_cost_assignment` | OR-Tools' C++ API, the model built straight from the East values |
| XGBoost | `xgboost_train_regressor`, `xgboost_train_classifier`, `xgboost_train_quantile`, `xgboost_predict`, `xgboost_predict_class`, `xgboost_predict_proba`, `xgboost_predict_quantile` | XGBoost's C API; the model blob is XGBoost's own UBJSON model, so a model trained on one runner predicts on the other |
| NeuralNet | `nn_init`, `nn_train`, `nn_run` | The networks east-py-datascience states as data (`libs/east-py/packages/east-py-datascience/docs/neural-networks.md`) on libtorch, PyTorch's C++ library: the same kernels, optimiser and generator as the python interpreter, on the CPU or on CUDA by the libtorch build linked; a network's plan and its weights kept between calls |

## Build

The package is C++17 and built on request:

```bash
make fetch-ortools                    # the pinned prebuilt OR-Tools release, into build-deps/or-tools
make fetch-libtorch                   # the pinned libtorch release (CPU build), into build-deps/libtorch
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
libtorch is linked from a prebuilt install too (`scripts/fetch-libtorch.sh`,
the CPU build pinned by SHA-256 at the torch version of
`libs/east-py/uv.lock`); a CUDA build is chosen with `EAST_LIBTORCH_VARIANT`
and its SHA-256, and the neural networks then run on the GPU with no other
change.

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
answered. The neural-network suites hold every operation to the
specification's shapes and conventions, the two reference networks (a
transformer over ragged grouped sequences, a conditioned 1-D U-Net:
`test/nn.reference.generated.ts`, written by python from hand-written torch)
to torch's outputs within 1e-4 and their integer outputs exactly, and
`nn_train` to its history, early stopping and EMA.

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
- `src/nn/` — the neural-network family: `dtype.h` the element types and
  shapes, `plan.h/.cc` a `NetType` value resolved and checked (the twin of
  python's `_plan.py`), `torch_interp.h/.cc` the interpreter of every
  operation on libtorch, the parameter initialisations and the trainer (the
  twins of `_torch.py` and `nn_impl.py`), `nn.cc` the East boundary
  (`nn_init`, `nn_train`, `nn_run`) and the plan and weight caches.
- `third_party/` — XGBoost's release archive, pinned by SHA-256.
