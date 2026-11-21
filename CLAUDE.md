# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## HARD RULE: read the whole file before editing it — or designing against it

Before editing ANY source file, you MUST have read that file **in its
entirety, recently** — meaning after its most recent change, including your
own earlier edits, merges, rebases, and formatter runs. Partial reads, grep
fragments, or a full read that predates a known change do not qualify. If a
file exceeds one Read call, read it in consecutive chunks until complete.
There is no "small edit" exception. When a tool result notes the file was
modified on disk since you last read it, that is a STOP: re-read the whole
file before the next edit to it.

The same requirement applies to **design-time reads**: before writing new
code that imports from, mirrors, or consumes a module — an API you call, a
precedent file you pattern on, a type you decode — read THAT file in full
first. Grep/sed are for *locating* files, never a substitute for reading
them; API shapes inferred from fragments have caused real regressions and
rework here. This is a hard requirement with no alternative.

## HARD RULE: East values through East

An East value is printed, read, compared, ordered, collected and typed
through East's utilities — never a JavaScript stand-in — and tested over
real, decoded East values. `printFor` / `parseFor`, `equalFor` / `compareFor`,
`SortedSet` / `SortedMap` for object keys, `ValueTypeOf<…>`, and
`variant()` / `some()` / `none` — never `String()`, `new Date(text)`, `===`,
`typeof`, a struct-keyed `Map` or a `{ type, value }` literal or cast. See
[`docs/conventions/EAST_TS_INTEROP.md`](docs/conventions/EAST_TS_INTEROP.md);
the UI packages' `make lint` fails on each of these.

## HARD RULE: never build a UI component from East UI components

An east-ui or e3-ui component is an **interface and a renderer**: its
factory computes one payload and returns it through its `EastUI.component`
carrier, and its React renderer constructs the UI in the browser. A factory
never composes other East UI components (`Box`, `Stack`, `Reactive`,
`SnapGrid`, `Dock`, `Library`, …) to build a component, and a payload never
carries a view built from them. A component made of parts reuses the parts'
interface types. A component draws no outer border — toolbars and footers
included — so a host can frame it or place it bare. A builder-style
renderer — one toolbar over a pane or two beside a main area, as Studio's
builder and the query builder are — is laid out with east-ui-components'
`BuilderFrame`, never by hand. See
[`docs/conventions/EAST_UI_PROP_PATTERNS.md`](docs/conventions/EAST_UI_PROP_PATTERNS.md).

## HARD RULE: no one-kind special cases in shared machinery

Shared machinery — the path every kind, column or component goes through,
such as the Sheet's editor, candidates, parse, menu and state machine —
never gains a branch that changes what it returns or accepts for one kind
(`meta.kind === "person"` inside a shared path), and never round-trips an
identity through display text (key → label → member: two members may show
one label). When a new kind needs behaviour the shared path lacks,
generalise the shared path for **every** kind; where it is app logic the
data cannot express, add a developer `FunctionType` prop (a custom kind's
`parse` / `print`, an `options` rule, `newKey`) — never when the data
already says it (a register's `label` and `aliases`); otherwise stop and
ask. An arm per kind in a dispatch that is by kind by design (the parse,
the text a kind prints, the editor a kind mounts) is fine. Before every
commit, grep the diff for `kind === "` and justify each hit. See
[`docs/conventions/EAST_UI_PROP_PATTERNS.md`](docs/conventions/EAST_UI_PROP_PATTERNS.md).

## HARD RULE: behaviour lives in shared, tested layers — components render

A component — a builder, a tag's renderer or its factory — keeps what it
draws and its own words. Every rule it follows is a call into a shared,
exhaustively tested layer: a data change, an edit, a record's read or write,
narrowing and filtering, search, paging, keys, a requery or latest-wins
token, a run layout. **Before writing any code**, find the layer that already
does it, lowest first, and reuse or extend it there: East's utilities
(`libs/east`); east-ui's `src/runtime/`, `src/contracts/` and its key-search
grammar (`src/collections/value-tree/key-search.ts`); east-ui-components'
`src/platform/`, `src/editing/` (proved by the `proof:editing` harness),
`src/pointer/` and `src/collections/key-search/`; e3-ui's `src/schedule/`,
`src/bind/` and `src/utils/`; e3-ui-components' `src/shared/`. A change that
reaches more than one component is written once, in the layer, with its
tests, before any component calls it: the same adaptation made in sibling
components side by side is the fault itself, even with a helper beside them.
Grep the siblings for the same thing hand-rolled and move each copy onto the
layer in the same change. The editing core's proof sets the bar for this
machinery: exhaustive tests of the layer, not a component's examples. A pull
request names the layer it changed and what runs on it.

## What this repo is

The **East monorepo** — a pnpm + uv + cmake workspace containing all
open-source East language packages. Formed by combining several previously
independent repos.

## Repo layout

All libraries live under `libs/`:

```
libs/
├── east/                # Core language — @elaraai/east
├── east-node/           # Node.js platform — east-node-std, east-node-io, east-node-cli
├── east-web/            # Browser platform — east-web-std (east-node-std's API, for a page's workers)
├── east-c/              # C runtime (CMake)
├── east-py/             # Python runtime + datascience + I/O (uv workspace)
├── e3/                  # Execution engine — e3-types, e3, e3-core, e3-api-client, e3-cli, e3-api-server, e3-rack (rack protocol, shared hub and rack task runner), e3-api-tests, e3-web (e3 in a browser)
├── east-ui/             # UI components — east-ui, east-ui-components, e3-ui, e3-ui-components, e3-ui-cli, showcases
├── east-plugin/         # Shared agent plugin runtime — the skill catalog (symlinked from libs), the example index, hooks, MCP search server, the assembler; east-claude-plugin/ and east-codex-plugin/ are the two hosts' plugin sources
└── east-claude-plugin/  # Claude Code plugin source — manifest, hook/MCP entry points, install scripts (east-codex-plugin/ is Codex's)
```

Top-level (non-`libs/`):
- `docker/` — `images/` (published `ghcr.io/elaraai/{e3,east-node}` runtime images), `services/` (test-backend compose), `tests/` (image validation)
- `scripts/` — monorepo release tooling (`publish-npm.mjs`, `set-*-version.mjs`, …)
- `.claude-plugin/marketplace.json` — marketplace root; lists the `east` plugin as its npm package (`@elaraai/east-claude-plugin`) so an install added as `elaraai/east-workspace` keeps updating; the published catalog is `elaraai/plugins`

Root config:
- `pnpm-workspace.yaml` — workspace package globs
- `package.json` — root scripts (`pnpm -r build/test/lint`)
- `.npmrc` — pnpm config
- `docker/services/docker-compose.yml` — test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
- `Makefile` — top-level orchestration
- `east.code-workspace` — VS Code multi-root workspace

`e3-cloud` (east-aws) is closed source — separate repo `elaraai/e3-cloud`.

## Commands

Always use `make` (not `npm run`). See
[`docs/conventions/MAKEFILE_TARGETS.md`](docs/conventions/MAKEFILE_TARGETS.md)
for the full target list. Quick reference:

```bash
make install            # one-shot setup
make build              # build all TS packages
make test               # run all TS tests
make lint               # lint all packages
make services-up        # Docker services for integration tests
make test-all           # services + test-export + all test suites
make clean
```

Each lib has its own `Makefile` mirroring these targets:

```bash
cd libs/east && make build
cd libs/e3 && make help
```

## Plugin skills (DO NOT EDIT WITHOUT INTENT)

The following `SKILL.md` files back Claude Code plugin skills
(`east:east`, `east:e3`, `east:e3-create`, `east:east-ui`, `east:e3-ui`,
`east:e3-ui-cli`, `east:east-node-std`, `east:east-node-io`, `east:east-py`,
`east:east-py-std`, `east:east-py-io`, `east:east-py-datascience`).
Editing them changes plugin behaviour — coordinate before touching. The
skill catalog (`libs/east-plugin/skills/<name>/SKILL.md`) holds **symlinks**
to these files, so the lib copy is the single source of truth; both plugins
are assembled from it at build time (`make -C libs/east-plugin package`, into
`libs/east-plugin/marketplace/`, never committed — the release publishes them
to npm as `@elaraai/east-claude-plugin` and `@elaraai/east-codex-plugin`, and
the `elaraai/plugins` catalog lists them); the search index
(`libs/east-plugin/index.json`) is regenerated from each lib's `*.examples.ts`
and must be re-run when these change (see the `plugin-artifacts` workflow). `east:east-py`, `east:east-py-std`, and
`east:east-py-io` are **skill-file-only** for now — no `*.examples.py` are
indexed. `east:e3-ui-cli` and `east:e3-create` are indexed via hand-written
`index.static.json` stubs (the `e3` precedent) — their CLI surface is not
East-expression code, so they have no `*.examples.ts`.

- `libs/east/SKILL.md`
- `libs/e3/SKILL.md`
- `libs/create/SKILL.md` (`east:e3-create` — the `npm create @elaraai/{e3,east}` scaffolder)
- `libs/east-ui/packages/east-ui/SKILL.md`
- `libs/east-ui/packages/e3-ui/SKILL.md`
- `libs/east-ui/packages/e3-ui-cli/SKILL.md`
- `libs/east-node/packages/east-node-std/SKILL.md`
- `libs/east-node/packages/east-node-io/SKILL.md`
- `libs/east-py/packages/east-py/SKILL.md`
- `libs/east-py/packages/east-py-std/SKILL.md`
- `libs/east-py/packages/east-py-io/SKILL.md`
- `libs/east-py/packages/east-py-datascience/SKILL.md`

Further skills are **plugin-native** (not a lib API), with `SKILL.md`
files living in the skill catalog under `libs/east-plugin/skills/`:

- `east:east-project` (`skills/east-project/SKILL.md`) — project scaffolding
  + lifecycle, via the published initializers `npm create @elaraai/e3` /
  `npm create @elaraai/east` (see `libs/create`).
- `east:east-design` (`skills/east-design/SKILL.md`) — solution architecture
  *before* coding: discovery questions, capability→skill mapping, example
  searches, and a design doc that hands off to `east-project` + the
  per-package skills.
- `east:east-ontology` (`skills/east-ontology/SKILL.md`) — build an Economic
  Ontology of a business (resources/activities/KPIs/decisions/objectives/
  policies) and render it with the e3-ui `Ontology` editor: elicitation
  methodology, the node/link model, and `OntologyType` encoding.
- `east:east-contribute` (`skills/east-contribute/SKILL.md`) — contribute a
  change to *this monorepo* from a GitHub issue (elaraai/east-workspace):
  triage → lib(s)/skills, anti-duplication "feature register" discovery,
  ensure East diagnostics/`tsserver-plugin-east` are live (the real gate is
  `make lint`), the examples↔tests East-code contract, the full
  build/test/lint loop + CI gates, and issue → branch → PR conventions.

## Workspace conventions

These docs hold rules that apply across multiple libs. Per the project
naming convention, they use `SCREAMING_SNAKE_CASE.md` to signal
"system-type, don't delete".

- [`docs/conventions/EAST_TS_INTEROP.md`](docs/conventions/EAST_TS_INTEROP.md)
  — `isValueOf`, `compareFor`, `variant()`, `$.let`/`$.const` rules, and
  printing, reading, collecting, typing and testing decoded East values —
  with the lint rule that enforces each.
- [`docs/conventions/EAST_PY_INTEROP.md`](docs/conventions/EAST_PY_INTEROP.md)
  — Python sibling: `compare_for`/`equal_for`, `variant()`/`some`/`none`, eager
  methods delegate to east-c, `coerce_to`/`assert_value_of` at the boundary.
- [`docs/conventions/EXAMPLES_AUTHORING.md`](docs/conventions/EXAMPLES_AUTHORING.md)
  — the `*.spec.ts` ↔ `*.examples.ts` pattern.
- [`docs/conventions/PYTHON_OPTIONAL_DEPS.md`](docs/conventions/PYTHON_OPTIONAL_DEPS.md)
  — `find_spec` + lazy import guard pattern.
- [`docs/conventions/MAKEFILE_TARGETS.md`](docs/conventions/MAKEFILE_TARGETS.md)
  — canonical `make` targets.
- [`docs/conventions/BROWSER_FLOOR.md`](docs/conventions/BROWSER_FLOOR.md)
  — code a browser runs names no built-in newer than ES2023, for iPhones
  back to iOS 16.4: what is newer, the lint rule and East's suite on an
  engine without them that hold it, and how to read one where the engine
  has it.
- [`docs/conventions/BEAST2_WIRE_VERSION.md`](docs/conventions/BEAST2_WIRE_VERSION.md)
  — where the beast2 container version is declared, what it guarantees
  (readers accept every released version; writers are lockstep), and why the
  environment e2e uses a local stand-in registry rather than the last release.
- [`docs/conventions/WIRE_MIGRATION.md`](docs/conventions/WIRE_MIGRATION.md)
  — how e3's wires change: packages are re-exported; a release that changes a
  stored form ships a repository upgrade step, which upgrades a repository an
  older release wrote in place; what e3 keeps and ships names the release that
  wrote it; no reader keeps a decoder for an earlier form; and the list of
  frozen wires.
- [`docs/conventions/E3_BACKEND_SEAMS.md`](docs/conventions/E3_BACKEND_SEAMS.md)
  — every e3 mechanism goes through the interfaces a backend implements
  (`StorageBackend`, `TaskRunner`, `ExecutionStateStore`, `TransferBackend`,
  the route factories' seams), so e3-cloud and e3-web implement their own and
  share the logic, routes and tests; shared logic never lives under
  `storage/local/`, and the portable entries it is reached through reach
  nothing of Node; a store's tests are a contract suite every backend runs,
  a route's are e3-api-tests.
- [`docs/conventions/SKILLS_STANDARD.md`](docs/conventions/SKILLS_STANDARD.md)
  — mandatory structure for `SKILL.md` + reference/example files.
- [`docs/conventions/EAST_UI_PROP_PATTERNS.md`](docs/conventions/EAST_UI_PROP_PATTERNS.md)
  — a component is an interface (payload + carrier) and a renderer that
  builds it in the browser, never composed from East UI components;
  east-ui data-vs-behavior prop rule: behavior props are pass-through
  `FunctionType` (never invoked at build time; capture only data +
  bind-handles); factories reify mapper callbacks via `shared/reify.ts`,
  never splice.

## Dependency management

- **TypeScript packages**: pnpm workspaces with `workspace:*`. Cross-package
  deps are local symlinks — no registry needed for development. pnpm
  rewrites `workspace:*` to actual versions at publish time.
- **Python packages** (east-py): uv workspace, self-contained under
  `libs/east-py/`.
- **C packages** (east-c): CMake, self-contained under `libs/east-c/`.

## Dependency order

pnpm topologically orders workspace scripts automatically. For reference:

1. **east** — core, no `@elaraai` deps
2. **east-node** — depends on east
3. **east-web** — depends on east
4. **east-c** — no `@elaraai` deps
5. **east-py** — east-py-datascience depends on east, east-node-std
6. **e3** — depends on east, east-node-std, east-web-std (e3-web)
7. **east-ui** — depends on east, east-node-std, e3-*

## Standards

Each lib has its own `STANDARDS.md` for mandatory dev standards (TypeDoc,
testing, code quality). CLAUDE.md files MUST reference STANDARDS.md, not
duplicate it.

## Key conventions

- Node 22 (`.nvmrc`), pnpm 10.x (`packageManager` in package.json)
- TypeScript side by side: `tsc` is TypeScript 7 (`"typescript-7":
  "npm:typescript@7.0.2"`); `"typescript"` is the compiler API, 6.0
  (`"npm:@typescript/typescript6@6.0.2"`), for what imports it — typescript-eslint,
  east-diagnostics and its plugins, East's names (`src/naming.ts`). Vite 8 (Rolldown)
  bundles; declarations come from `tsc`.
- `make build` / `make test` / `make lint` work in every lib directory
- `@elaraai/*` packages use `"beta"` dist-tag for pre-releases,
  `"latest"` for stable
- Per-lib CLAUDE.md has package-specific orientation; package-level
  CLAUDE.md is stub-or-detailed depending on whether unique guidance
  exists
- GitHub Actions: per-lib test workflows with `paths` filters; single
  publish workflow
