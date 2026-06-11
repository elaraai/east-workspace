# create

Project scaffolding for the East ecosystem — the `npm create` initializers.

```bash
npm create @elaraai/e3   my-project    # BSL-1.1 · Node + Python · durable execution
npm create @elaraai/east my-project    # AGPL-3.0 · Node-only
```

Pass `.` to scaffold into the current directory, or `-- --install` to install
dependencies as part of scaffolding.

Run interactively, `npm create @elaraai/e3` prompts for what to include:

- **Tests** — `src/index.spec.ts` and the `test` scripts (default: yes).
- **UI** — `east-ui` + `e3-ui` and a `ui()` decision surface in `src/surface.tsx`
  (default: no).
- **Runners** — which East runtimes to wire in: `east-node`, `east-c`, `east-py`
  (default: all three; dropping `east-py` removes the Python project, tests, and
  `uv` steps).

Each is also a flag for non-interactive / CI use: `--tests`/`--no-tests`,
`--ui`/`--no-ui`, `--runners=east-node,east-c,east-py`. Passing any of them skips
the prompts.

## Layout

| Package | Published | Purpose |
|---|---|---|
| [`scaffold-core`](packages/scaffold-core) | no (private) | Shared scaffold logic + the CLI runner |
| [`create-e3`](packages/create-e3) | `@elaraai/create-e3` | `npm create @elaraai/e3` |
| [`create-east`](packages/create-east) | `@elaraai/create-east` | `npm create @elaraai/east` |
| [`templates/`](templates) | shipped as data inside the create-* packages | The e3 / east project skeletons |

## How it works

- Templates are committed with `workspace:*` dependency specifiers as the
  source of truth. On emit, the scaffolder rewrites them to `^<version>` using
  the create package's **own** version (the monorepo release version), so a
  generated project pins a known-good, mutually-compatible `@elaraai/*` set —
  exactly the transform pnpm applies at publish time.
- Dotfiles are stored without the leading dot (`gitignore`, npm publish mangles
  a real `.gitignore`) and written back on emit.
- Each `create-*` bin is esbuild-bundled with `scaffold-core` inlined and its
  one template tree copied in, so the published package is self-contained and
  dependency-free.

Templates are intentionally **not** pnpm workspace members; the
[`test-create`](../../.github/workflows/test-create.yml) workflow validates a
scaffolded project on Linux/macOS/Windows.

## Develop

```bash
pnpm --filter @elaraai/scaffold-core --filter @elaraai/create-e3 --filter @elaraai/create-east run build
pnpm --filter @elaraai/scaffold-core run test
```
