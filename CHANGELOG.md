# Changelog

What changed for a user of the packages, release by release, with the
migration a breaking change needs. A release's page on GitHub lists its pull
requests; this file is the record of behaviour. Changes land under
*Unreleased* and move into the release's section when it is cut
(`docs/conventions/WIRE_MIGRATION.md` names the kinds of wire change).

## Unreleased

### east-c

- **east-c-datascience is a package beside the runner, not a build of it.**
  The OR-Tools, XGBoost and neural-network platform functions ship as
  `@elaraai/east-c-datascience` (with `@elaraai/east-c-datascience-linux-x64`),
  installed beside `@elaraai/east-c-cli`: the runner opens the package's
  libraries when a program names `east-c-datascience`, and the `east-c`
  launcher points it at them. libtorch is fetched at install
  (`east-c-datascience fetch-libtorch`; `EAST_LIBTORCH=skip` skips it), and
  OR-Tools and XGBoost run without it. `east-c version -p east-c-datascience`
  reports the package, its libraries and where it was found. A new Docker tier
  `east-c-datascience` (FROM `east-c`) carries both. For a build from source,
  `-DEAST_C_DATASCIENCE=ON` now produces the two libraries
  (`libeast-c-datascience`, `libeast-c-nn`), which the build tree's CLI opens;
  the CLI needs CMake 3.24. OR-Tools' pinned archive is the AlmaLinux 9 build,
  so the libraries load on the runner's glibc floor (2.34).
- `EAST_C_PACKAGE_PATH` names the directories a package library is looked for
  in, instead of the installed packages.
- `east_dict_load` (the C API): `east_dict_set` for pairs arriving in key
  order, loading a large dict's tree in a pass — what a platform function
  answering thousands of keyed results calls.

### east-py-datascience and east-c-datascience (the solver family)

- **Every solver result carries `build_time` and `solve_time` beside
  `wall_time`**, in seconds, defined the same way for every solver on both
  runners: the call's entry to the solver's start, inside the solver, and the
  whole call (so what is left is the write-back). A `google_or_cpsat_solve_all`
  entry carries them on its last solution, 0 on the others. The CP-SAT results
  (`CpSatResultType`, `CpSatColumnsResultType`) gain `best_bound`, the
  solver's proven bound on the objective, present when `optimal` or
  `feasible`. *Wire:* the result struct types gain fields, so a value stored
  under the old types (a task output kept in a dataset) is re-run, not read;
  nothing stored by e3 itself changes.
- A CP-SAT `seed` outside the solver's 32-bit range is refused, with the same
  message, on both runners (python set it unchecked).
- The exact-LP parity test runs SCIP beside Glop and HiGHS, with infinite
  bounds spelled `±1e20` and `±Infinity` alike; generated W1-shaped workloads
  (a 500- and a 33,526-variable LP, assignment models of 50, 300 and 600
  decisions) hold both runners to one answer, bit for bit.
- `bench/solvers.mjs` (east-py-datascience) measures the three times of each
  solver call on both runners at the requirements' sizes.

### The std random streams (breaking: every runtime's seeded stream)

- **One seeded stream on every runtime.** After `random_seed(s)`, every
  runtime now draws the same `random_uniform`, `random_range` and
  `random_normal` values, bit for bit; the first 1,000 of each are pinned in
  the Random suite every runtime replays. What changed: east-node-std's
  generator wraps at 64 bits as XorShift128+ does (it let a shifted word grow
  past 64 bits, parting from the other runtimes at the second draw), and its
  `random_normal` returns the polar method's first draw, as the others do
  (east-web-std, which ports east-node-std's generator, follows both); and
  the normal draw's logarithm on every runtime is one algorithm (fdlibm's,
  the one behind V8's `Math.log`) rather than the host's libm, which rounds a
  few inputs in a thousand differently from one host to the next. So a seeded
  east-node program draws a different sequence from this release, and a seeded
  east-py or east-c program a normal differing in its last bit now and then.
  *Migration:* a result that depends on the old draws is recomputed; nothing
  stored by e3 changes.

### east-py-datascience and east-c-datascience (XGBoost; breaking for pre-UBJSON blobs)

- **A model blob from before the UBJSON form (a cloudpickle) is refused by
  every XGBoost function, on every runner, naming the conversion**:
  `xgboost_resave(blob)` reads it — on the python runner, which alone reads a
  pickle — and writes the same model in the UBJSON form, its class labels and
  quantiles carried over; a UBJSON blob comes back as the library writes it
  again. The python runner used to read a pickle silently; east-c never did.
  *Migration:* re-save each such blob once with `xgboost_resave` on the
  python runner (the blobs an e3 dataset holds under the old `ModelBlobType`
  union need re-training or re-saving in any case, see above).
- A seeded, single-threaded fit (`random_state`, `n_jobs: 1`) writes the same
  UBJSON blob on both runners, byte for byte; the XGBoost suite holds both to
  the blob the python runner wrote.

### e3

- `STOCK_PLATFORMS_BY_RUNNER.east_c` lists `east-c-datascience`, and rack
  routing sends a runner listing it to the new `c-datascience` tier.
