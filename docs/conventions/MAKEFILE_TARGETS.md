# Makefile targets (canonical)

**Applies to:** every directory with a `Makefile` in this monorepo
(root and each `libs/<lib>/`).

The canonical interface to this monorepo is `make`, not `npm run` or
`pnpm run`. Every `CLAUDE.md` should reference `make` targets; raw
`pnpm`, `cmake`, `ctest`, or `uv` invocations should appear only when
debugging Makefile output.

---

## 1. Why not `npm run`?

This monorepo is a pnpm workspace. Per-package `npm` scripts are not
used — pnpm coordinates builds in topological order across the
workspace. `npm run build` in a package directory may work, may not,
and won't pick up local workspace deps the way pnpm does. **Always
use `make`.**

---

## 2. Root-level targets

Run from the workspace root (`/home/crambelsoupy/src/east-workspace/`):

| Target | What it does |
|---|---|
| `make install` | `pnpm install` + `uv sync` (east-py) + `cmake` config (east-c). One-shot setup. |
| `make build` | Build every TS package in topological order. |
| `make test` | Run every TS test suite. |
| `make lint` | Lint every package. |
| `make services-up` | Start Docker services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin) for integration tests. |
| `make services-down` | Stop the services. |
| `make services-status` | Show service status. |
| `make test-export` | Export IR JSON from east + east-node + east-py for cross-runtime compliance tests, each corpus into its directory under the checkout's `tmp/` (§4). Required before east-c/east-py/east-web compliance runs. |
| `make test-all` | `services-up` + `test-export` + `test` + east-web compliance + east-c tests + east-py tests + `services-down`. |
| `make clean` | Remove all build artifacts. |

---

## 3. Lib-level targets

The same target names work from each `libs/<lib>/` root and act on just
that lib. Example:

```bash
cd libs/east && make build      # builds only east
cd libs/east && make test       # tests only east
cd libs/e3 && make help         # lists e3-specific extras (e.g. `make test-integration-shard`)
```

Lib-specific extras (run `make help` in each):

| Lib | Notable extras |
|---|---|
| `libs/east` | `make test-export` (the describeEast suites as IR, into `EAST_TEST_IR_DIR`), `make export-examples` (every example as IR, into `EAST_EXAMPLES_IR_DIR`) |
| `libs/e3` | `make test-packages` and `make test-integration` (the two halves of `make test`), `make test-integration-shard SHARD=n` (one of the three integration shards CI runs side by side), `make e2e-stack` (the local stack the environment e2e installs), `make install-job` (the Windows job launcher) |
| `libs/east-c` | `make unit` (ctest gates), `make test-east-c`, `make test-east-c-std`, `make leak-check-all` (ASan/LSan), `make bench-cli` (the interpreter, emit-sink and paged-read benchmarks the CLI is profiled on) |
| `libs/east-web` | `make test-compliance` (east-node-std's exported compliance suite over east-web-std, from `EAST_NODE_STD_IR`; `make test` exports it first) |
| `libs/east-py` | `make typecheck` (mypy), `make check` (lint + typecheck + test), `make coverage`, `make test-conformance` (IR → python → IR round trip over the exported corpus + examples, #627); in `packages/east-py`, `make test-file FILE=…` (one test file, or any pytest arguments, against the exported corpora) |
| `libs/east-ui` | `make test-export` (east-ui's suites as IR, into `EAST_UI_TEST_IR`), `make design` (serve the design system's read-only download, `app_design_system/`, on :5174), `make east-ui-examples-html-<key>` (per-example HTML snapshot), `make east-ui-examples-html-all`, `make test-group GROUP=components\|ir\|rest` (one of the three test groups CI runs side by side; together they run every package's tests once), `make test-responsive` (the showcase's Playwright suite over the built showcase, exactly as CI runs it; `SHARD=n/8` runs one CI shard) |

**Every `make build` type-checks.** A package built by `tsc` type-checks as
it builds. A package bundled by vite or esbuild strips types without
checking them, so its `build` script runs `tsc` first — over its sources,
tests and scripts (`tsconfig.typecheck.json` in `east-ui-components` and
`e3-ui-components`; `tsconfig.json` in `east-ui-showcase`, the extension
webview and the `create-*` entries). A type error anywhere in the package
fails `make build`. A new bundled package does the same (#589).

---

## 4. Shared paths (`paths.mk`)

The root `paths.mk` holds the paths every Makefile shares, so no script,
spec or test works one out itself (#1114):

- `REPO_ROOT`, the checkout's root;
- each exported test corpus, under the checkout's own `tmp/` (gitignored):
  `EAST_TEST_IR_DIR`, `EAST_EXAMPLES_IR_DIR`, `EAST_NODE_STD_IR`,
  `EAST_NODE_IO_IR`, `EAST_DATASCIENCE_IR_DIR`, `EAST_UI_TEST_IR` and
  `E3_UI_SHOWCASE_TEST_IR`;
- `EAST_NODE_CLI`, the checkout's own east-node CLI, which east-py's
  three-way sweep runs.

The root Makefile and every lib's include it (`include paths.mk`, `include
../../paths.mk`; a package's, `include ../../../../paths.mk`). Each variable
is exported to the recipes, and a value already in the environment wins. So
two checkouts on one machine each export and gate against their own corpora.

Nothing else defaults a path. A `test:export` script refuses to run without
its variable, and a spec or test that reads a corpus skips without it (or
fails, where it never skips), saying to run it through make. A new corpus
gets its variable in `paths.mk`.

---

## 5. When to use `pnpm` directly

Almost never. The exceptions:

- `pnpm install <new-dep>` to add a dependency to a package.
- `pnpm -r run <script>` if you need a script that isn't wrapped by a
  Makefile target.
- Debugging: `pnpm --filter @elaraai/foo run bar` to isolate one
  package's behaviour.

Everything else flows through `make`.

---

## 6. Adding a new target

When you add a new make target to a lib's Makefile, also:

1. Make the `help` target list it.
2. If it applies workspace-wide, plumb it through the root Makefile.
3. Update this file.
