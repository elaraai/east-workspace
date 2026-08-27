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
| `make test-export` | Export IR JSON from east + east-node + east-py for cross-runtime compliance tests. Required before east-c/east-py compliance runs. |
| `make test-all` | `services-up` + `test-export` + `test` + east-c tests + east-py tests + `services-down`. |
| `make clean` | Remove all build artifacts. |

---

## 3. Lib-level targets

The same target names work from each `libs/<lib>/` root and act on just
that lib. Example:

```bash
cd libs/east && make build      # builds only east
cd libs/east && make test       # tests only east
cd libs/e3 && make help         # lists e3-specific extras (e.g. `make fuzz`)
```

Lib-specific extras (run `make help` in each):

| Lib | Notable extras |
|---|---|
| `libs/e3` | `make fuzz` (Virtual Idiot fuzz; also `fuzz-quick`, `fuzz-stress`) |
| `libs/east-c` | `make unit` (ctest gates), `make test-east-c`, `make test-east-c-std`, `make leak-check-all` (ASan/LSan) |
| `libs/east-py` | `make typecheck` (mypy), `make check` (lint + typecheck + test), `make coverage`, `make test-conformance` (IR → python → IR round trip over the exported corpus + examples, #627) |
| `libs/east-ui` | `make design` (serve `app_design_system/` on :5174), `make east-ui-examples-html-<key>` (per-example HTML snapshot), `make east-ui-examples-html-all` |

---

## 4. When to use `pnpm` directly

Almost never. The exceptions:

- `pnpm install <new-dep>` to add a dependency to a package.
- `pnpm -r run <script>` if you need a script that isn't wrapped by a
  Makefile target.
- Debugging: `pnpm --filter @elaraai/foo run bar` to isolate one
  package's behaviour.

Everything else flows through `make`.

---

## 5. Adding a new target

When you add a new make target to a lib's Makefile, also:

1. Make the `help` target list it.
2. If it applies workspace-wide, plumb it through the root Makefile.
3. Update this file.
