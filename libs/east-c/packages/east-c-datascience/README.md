# east-c-datascience

east-py-datascience's platform functions on the C runtime, family by family:
the same names, East types and semantics, so a task moves between the runners
by changing its runner and nothing else, and the suites east-py-datascience's
specs export run here unchanged.

| Family | Functions | On |
|---|---|---|
| Google OR-Tools | `google_or_cpsat_solve`, `google_or_cpsat_solve_all`, `google_or_linear_solve` (Glop, SCIP, HiGHS by the same backend ids), `google_or_routing_solve`, `google_or_min_cost_flow`, `google_or_max_flow`, `google_or_assignment`, `google_or_min_cost_assignment` | OR-Tools' C++ API, the model built straight from the East values |
| XGBoost | `xgboost_train_regressor`, `xgboost_train_classifier`, `xgboost_train_quantile`, `xgboost_predict`, `xgboost_predict_class`, `xgboost_predict_proba`, `xgboost_predict_quantile`, `xgboost_resave` | XGBoost's C API; the model blob is XGBoost's own UBJSON model, so a model trained on one runner predicts on the other — and a seeded, single-threaded fit writes the same bytes on both. A blob from before the UBJSON form (a cloudpickle) is refused, naming `xgboost_resave`, which rewrites it on the python runner |
| NeuralNet | `nn_init`, `nn_train`, `nn_run` | The networks east-py-datascience states as data (`libs/east-py/packages/east-py-datascience/docs/neural-networks.md`) on libtorch, PyTorch's C++ library: the same kernels, optimiser and generator as the python interpreter, on the CPU or on CUDA by the libtorch build linked; a network's plan and its weights kept between calls |

## Install

The package ships beside the runner, as the runner itself does
([`docs/npm-runner-distribution.md`](../../docs/npm-runner-distribution.md)):

- **`@elaraai/east-c-datascience`** — the package a project adds beside
  `@elaraai/east-c-cli`. Its command `east-c-datascience` fetches libtorch
  (`fetch-libtorch [--variant cpu|cu128] [--force] [--archive <zip>]`) and
  prints the libraries' directory (`path`).
- **`@elaraai/east-c-datascience-linux-x64`** — its optional dependency, gated
  on os/cpu. `lib/` holds `libeast-c-datascience.so` (OR-Tools, XGBoost and
  the neural-network stubs), `libeast-c-nn.so` (the libtorch half, opened by
  the first `nn_*` call) and every library they load, built on the runner's
  glibc floor (AlmaLinux 9: glibc 2.34, GCC 11's libstdc++). Its postinstall
  fetches the pinned libtorch into `libtorch/` beside `lib/`, verified by
  SHA-256 (`EAST_LIBTORCH=skip` leaves it out; `EAST_LIBTORCH_VARIANT=cu128`
  takes the CUDA build). OR-Tools and XGBoost need none of it, and an `nn_*`
  call without it fails naming the fetch.

```bash
npm install @elaraai/east-c-cli @elaraai/east-c-datascience
npx east-c-datascience fetch-libtorch      # when the install ran no scripts
npx east-c version -p east-c-datascience   # the package, its libraries, where it was found
```

The `east-c` launcher points the binary at the installed libraries
(`EAST_C_PACKAGE_PATH`). A binary run without the launcher — the Docker tiers
symlink it, for its 2 ms start — looks in `EAST_C_PACKAGE_PATH`, beside itself
in a flat `node_modules` (`../east-c-datascience-linux-x64/lib`), under
`/usr/local/lib/east-c/east-c-datascience/lib` (where the
`east-c-datascience` image, FROM `east-c`, links the package) and in the build
tree (`packages/east-c-cli/src/package_loader.c`). A library built for another
east-c version is refused: install the same version of both packages.

## Build

The package is C++17 and built on request, as two shared libraries that link
none of east-c: the CLI and the compliance runner link the whole runtime and
export it, and the libraries bind to it when opened, so one runtime lives in
the process (CMake ≥ 3.24).

```bash
make fetch-ortools                    # the pinned prebuilt OR-Tools release, into build-deps/or-tools
make fetch-libtorch                   # the pinned libtorch release (CPU build), into build-deps/libtorch
make build EAST_C_DATASCIENCE=ON      # east-c, std, the CLI and this package's libraries
./build/packages/east-c-cli/east-c version -p datascience
make stage-datascience                # build/stage-datascience/lib as the npm package ships it
make check-datascience-floor          # … every file held to the glibc floor (passes for a build on it)
```

OR-Tools is linked from a prebuilt install — its release archives run to 55 MB
a platform and its source build to most of an hour — as east-c-std links the
system libcurl. `scripts/fetch-ortools.sh` pins one release per platform by
its SHA-256 (Linux x86_64 today: the AlmaLinux 9 archive, whose libraries need
glibc 2.34 and `GLIBCXX_3.4.29`, the runner's floor, so they load wherever
the runner does; another platform names its own install through
`CMAKE_PREFIX_PATH` or `ortools_DIR`). XGBoost builds from its release
archive under `third_party/`, CPU only, as a static library, so no build
downloads anything (`scripts/check-native-sources.mjs` at the workspace root).
libtorch is linked from a prebuilt install too (`scripts/fetch-libtorch.sh`,
pinned by version and SHA-256 in `scripts/libtorch-pins.json` at the torch
version of `libs/east-py/uv.lock`); a CUDA build is chosen with
`EAST_LIBTORCH_VARIANT` and its SHA-256, and the neural networks then run on
the GPU with no other change.

With the package built, the CLI takes `-p east-c-datascience` (or
`datascience`) beside `-p std`, and a unit whose runner lists
`east-c-datascience` (e3's `{ runtime: 'east-c', platforms: ['east-c-std',
'east-c-datascience'] }`) runs its platform functions here. A binary that
finds no package refuses the name, saying how to install it; one that finds
the package but no libtorch runs OR-Tools and XGBoost, and refuses `nn_*`
calls naming the fetch.

`scripts/stage-datascience.sh` stages what the per-platform npm package
ships: the two libraries with their installed rpaths (`$ORIGIN`;
`$ORIGIN/../libtorch/lib`) and every library they load that is neither the
system's nor libtorch's, under its soname, so the directory is complete
wherever the runner's glibc floor admits; `scripts/check-glibc-floor.mjs`
(workspace root) then holds every file to the floor — glibc 2.34,
`GLIBCXX_3.4.29`, `CXXABI_1.3.13`. The release builds the package in an
AlmaLinux 9 container (`.github/workflows/release.yml`, `publish-c-datascience`),
and `test-east-c.yml` installs the packed packages in a clean `node:22-slim`
and runs the suites through them.

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
specification's shapes and conventions, the reference networks (a transformer
over ragged grouped sequences, a conditioned 1-D U-Net, and the small
selection, time-grid and rotary families: `test/nn.reference.generated.ts`,
written by python from hand-written torch) to torch's outputs within 1e-4 and
their integer outputs exactly, the `segments` and `key_sets` attention paths
to the dense mask's answer within 1e-5, and `nn_train` to its history, early
stopping, its EMA and warm-up, one AdamW step with a weight decay per
parameter group as torch's optimiser takes it, the weights after an epoch in
the seeded shuffle's order (`test/nn.train.reference.generated.ts`, the python
runner's answer), the weighted validation, the epoch-stepped schedules and a
recomputed module's training.

## Layout

- `include/east_datascience/east_datascience.h` — the C surface the runner
  resolves by name when it opens the library: each family's registration,
  `east_datascience_register_all`, the east-c version it was built with, the
  library versions and the neural-network family's state (its libtorch, or
  why `nn_*` calls fail). Everything else is hidden.
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
  (`nn_init`, `nn_train`, `nn_run`) and the plan and weight caches — these
  three in `libeast-c-nn`, the libtorch-linked library; `nn_entry.h` the table
  it hands over, `nn_stub.cc` the stubs in `libeast-c-datascience` that open
  it on the first call.
- `third_party/` — XGBoost's release archive, pinned by SHA-256.
- `package.json`, `bin/east-c-datascience.mjs` — the npm package
  `@elaraai/east-c-datascience` and its command; `npm/fetch-libtorch.mjs` the
  libtorch fetch the per-platform package runs at install (and the command
  later), reading `scripts/libtorch-pins.json`. The per-platform package's
  manifest and README are generated at release
  (`scripts/emit-east-c-platform-manifest.mjs --package datascience`).
