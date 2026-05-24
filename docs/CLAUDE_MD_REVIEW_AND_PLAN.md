# CLAUDE.md Review and Consolidation Plan

**Date:** 2026-05-20
**Status:** Review + plan (decisions confirmed with project owner). Phases A-H
to follow.
**Scope:** All `CLAUDE.md` files across the east-workspace monorepo.

---

## 0. TL;DR

The monorepo (formed by combining six previously independent repos) has
**16 active `CLAUDE.md` files** with three structural problems:

1. **Tier confusion.** No rule for root vs lib vs package ownership; some
   libs have lib-level CLAUDE.md (east, east-c, east-py, e3), others
   don't (east-node, east-ui).
2. **Drift.** Stale `npm run` commands instead of `make`, broken relative
   refs (`/docs/DESIGN.md`, `../East/USAGE.md`), outdated package lists
   (`libs/east-py/CLAUDE.md` lists 2 packages; the lib has 5).
3. **Duplication.** The same "Examples system" instructions appear in
   **four** separate `test/CLAUDE.md` files; one of them
   (`east-py-datascience/test/CLAUDE.md`) is wrong-by-paste — it
   documents the TypeScript example flow for a directory whose tests are
   Python `pytest`.

The plan adopts a **strict three-tier structure** (root / lib / package),
extracts universal rules into a new `/docs/conventions/` directory using
`SCREAMING_SNAKE_CASE.md` filenames (the project convention for
"system-type, don't delete" docs — matches existing
`CHAKRA_CHARTS_REFERENCE.md`), deletes the design-token block in
`east-ui-components/CLAUDE.md` outright (canonical source is
`libs/east-ui/design/`), and adds a minimal `CLAUDE.md` to every package
that lacks one.

**SKILL.md is off-limits.** Six `SKILL.md` files back Claude Code plugin
skills (`east:east`, `east:e3`, `east:east-ui`, `east:east-node-std`,
`east:east-node-io`, `east:east-py-datascience`). Editing their content
risks breaking the plugin. CLAUDE.md files will *reference* them with a
"DO NOT EDIT casually" callout.

---

## 1. Document families in this monorepo

| File | Audience | Touched by this plan? | Notes |
|---|---|---|---|
| `README.md` | Humans (GitHub) | No | Public-facing per package. |
| `CONTRIBUTING.md` | Contributors | No | Public-facing. |
| `CLA.md`, `LICENSE.md` | Legal | No | — |
| **`CLAUDE.md`** | **Claude Code agent** | **YES — target** | Orientation document for an agent dropped into a directory. |
| **`SKILL.md`** | **Claude Code plugin** | **NO — off-limits** | Load-bearing for `east:*` plugin skills. |
| `STANDARDS.md` | Contributors + Claude | No (referenced) | Mandatory dev standards; CLAUDE.md should *point* to it. |
| `USAGE.md` | End-users of the package | No | Out of scope. |
| `VIEWER.md` | Feature-specific | No | Only in `libs/e3/` (TUI design). |
| `AGENTS.md` | Mixed | Yes — delete | Only in `libs/east/`; near-duplicate of CLAUDE.md. |
| `design/*.md`, `devdocs/*.md` | Designers + Claude | No (referenced) | Linked from CLAUDE.md where useful. |

### File naming convention used here

- **`SCREAMING_SNAKE_CASE.md`** for multi-word "system-type, don't delete"
  docs (rules, conventions, mandatory standards). E.g.
  `EAST_TS_INTEROP.md`. Matches the existing
  `libs/east-ui/packages/east-ui-components/docs/CHAKRA_CHARTS_REFERENCE.md`.
- **`ALLCAPS.md`** for single-word system docs (`README.md`, `CLAUDE.md`,
  `STANDARDS.md`, `SKILL.md`, `USAGE.md`).
- **`lowercase-kebab.md`** for topical content / design notes
  (`design/e3-core.md`, `docs/snapshot-format.md`).

---

## 2. Current inventory

### 2.1 Active `CLAUDE.md` files (16) + 1 stray

| # | Path | Lines | Tier | Verdict |
|---|---|---|---|---|
| 1 | `/CLAUDE.md` (root) | 96 | root | **EDIT** — add plugin-skills callout + conventions pointer. |
| 2 | `libs/east/CLAUDE.md` | 121 | lib | **EDIT** — replace `npm run` with `make`; drop semantics block (it's in SKILL.md/devdocs). |
| 3 | `libs/east-c/CLAUDE.md` | 64 | lib | **EDIT** — replace raw `cmake/ctest` with `make`. |
| 4 | `libs/east-py/CLAUDE.md` | 48 | lib | **EDIT** — fix package list (lists 2 packages; should list 5). |
| 5 | `libs/e3/CLAUDE.md` | 80 | lib | **KEEP** — model file. |
| 6 | `libs/east-node/packages/east-node-cli/CLAUDE.md` | 56 | pkg | **REPLACE** with minimal stub. |
| 7 | `libs/east-node/packages/east-node-io/CLAUDE.md` | 138 | pkg | **EDIT + SPLIT** — `isValueOf` to convention doc. |
| 8 | `libs/east-node/packages/east-node-std/CLAUDE.md` | 46 | pkg | **REPLACE** with minimal stub. |
| 9 | `libs/east-node/packages/east-node-io/test/CLAUDE.md` | 181 | test | **DELETE** — content → convention doc; namespace table → README. |
| 10 | `libs/east-node/packages/east-node-std/test/CLAUDE.md` | 162 | test | **DELETE** — content → convention doc. |
| 11 | `libs/east-py/packages/east-py/CLAUDE.md` | 164 | pkg | **EDIT** — trim dev-command section; keep architecture. |
| 12 | `libs/east-py/packages/east-py-datascience/CLAUDE.md` | 170 | pkg | **EDIT + SPLIT** — optional-deps to convention doc. |
| 13 | `libs/east-py/packages/east-py-datascience/test/CLAUDE.md` | 162 | test | **DELETE** — wrong-by-paste (TS guide in Python pytest dir). |
| 14 | `libs/east-ui/packages/east-ui/CLAUDE.md` | 705 | pkg | **EDIT + SPLIT** — file-tree to docs/; fix broken refs. |
| 15 | `libs/east-ui/packages/east-ui/test/CLAUDE.md` | 287 | test | **TRIM** — drop shared content; keep UI-specific Reactive.Root rules. |
| 16 | `libs/east-ui/packages/east-ui-components/CLAUDE.md` | 521 | pkg | **EDIT + DELETE TOKENS** — design dump → pointer to `libs/east-ui/design/`. |
| — | `libs/east/AGENTS.md` | 120 | lib | **DELETE** — near-duplicate of CLAUDE.md. |

(`libs/east-py/.venv/.../xarray/tests/CLAUDE.md` is vendored; not ours.)

### 2.2 Packages without a `CLAUDE.md` today (17)

Per the "one CLAUDE.md per package, even minimal" decision, every package
gets a stub:

- `libs/east-c/packages/{east-c, east-c-std}` (2)
- `libs/east-node/` (lib-level)
- `libs/east-py/packages/{east-py-cli, east-py-io, east-py-std}` (3)
- `libs/e3/packages/{e3, e3-api-client, e3-api-server, e3-api-tests, e3-cli, e3-core, e3-types}` (7)
- `libs/east-ui/` (lib-level)
- `libs/east-ui/packages/{east-ui-extension, east-ui-showcase, e3-ui, e3-ui-components, e3-ui-showcase}` (5)

---

## 3. Problems found

### 3.1 Stale `npm run` commands

Canonical interface is `make build`, `make test`, `make lint` (works in
every lib root per the workspace convention). But:

| File | Lines |
|---|---|
| `libs/east/CLAUDE.md` | 47-49 |
| `libs/east-node/packages/east-node-cli/CLAUDE.md` | 28-30 |
| `libs/east-node/packages/east-node-io/CLAUDE.md` | 32-35 |
| `libs/east-node/packages/east-node-std/CLAUDE.md` | 27-30 |
| `libs/east-ui/packages/east-ui/CLAUDE.md` | 145-147 |
| `libs/east-ui/packages/east-ui-components/CLAUDE.md` | 231-235 |
| `libs/east-py/packages/east-py-datascience/CLAUDE.md` | 25-37 (mixed `npm run` + `uv run`) |

### 3.2 Stale references

- `libs/east-ui/packages/east-ui/CLAUDE.md`:
  - L138, L152: refer to `/docs/DESIGN.md` (deleted per git status).
  - L600: `See [East's USAGE.md](../East/USAGE.md)` — wrong case + path
    (east lib has no USAGE.md).
- `libs/east-py/CLAUDE.md`: lists only `east-py` and `east-py-io`; the
  lib actually has 5 packages.
- `libs/east-node/packages/east-node-io/test/CLAUDE.md`: lines 131-150
  list East-core spec files (array, boolean, integer, …) that don't
  exist in this directory — copy-pasted from the wrong source.

### 3.3 Duplicated content

The "Examples system" section appears four times, near-identical:

| File | Lines | Status |
|---|---|---|
| `libs/east-node/packages/east-node-std/test/CLAUDE.md` | 36-161 | canonical |
| `libs/east-node/packages/east-node-io/test/CLAUDE.md` | 56-180 | adds namespace table |
| `libs/east-py/packages/east-py-datascience/test/CLAUDE.md` | 36-161 | wrong-by-paste (Python dir) |
| `libs/east-ui/packages/east-ui/test/CLAUDE.md` | 41-286 | adds UI-specific rules |

### 3.4 Misallocated content

- `isValueOf()` rules (east-node-io/CLAUDE.md L49-130) — universal TS↔East
  interop rule, applies to east-ui too.
- Design tokens (east-ui-components/CLAUDE.md L5-217) — canonical source
  is `libs/east-ui/design/`. The CSS dump is stale duplicate.
- Optional Python deps pattern (east-py-datascience/CLAUDE.md L44-97) —
  generic; east-py-io needs it too.

### 3.5 Stray `AGENTS.md`

`libs/east/AGENTS.md` (120 lines) — opens identically to
`libs/east/CLAUDE.md`. Stale duplicate from a prior AGENTS.md convention.

---

## 4. Target structure

```
/CLAUDE.md                                  TIER 1 — root
├── libs/<lib>/CLAUDE.md                    TIER 2 — lib (one per lib)
└── libs/<lib>/packages/<pkg>/CLAUDE.md     TIER 3 — package (one per package)

/docs/conventions/                          NEW — workspace-wide rules (SCREAMING_SNAKE)
├── EAST_TS_INTEROP.md
├── EXAMPLES_AUTHORING.md
├── PYTHON_OPTIONAL_DEPS.md
└── MAKEFILE_TARGETS.md

libs/east-ui/packages/east-ui/docs/         topical, kebab-case
└── component-layout.md                     extracted file-tree + base variant list
```

**Test-level `CLAUDE.md` is eliminated** — except the trimmed east-ui one
which retains UI-specific Reactive.Root rules.

### 4.1 Tier rules

| Tier | Owns | Forbidden |
|---|---|---|
| Root | Monorepo layout, top-level `make` targets, plugin-skills callout, conventions pointer | Per-lib commands, per-package detail |
| Lib | Lib's purpose, package table, lib-specific concepts, pointers to lib's STANDARDS.md / SKILL.md / design/ | Generic monorepo info |
| Package | Only package-unique guidance (architecture, gotchas) | Restating root/lib info; testing standards (those go in STANDARDS.md) |

---

## 5. Decisions confirmed with user

(Answers given via AskUserQuestion rounds before the plan was committed.)

| Topic | Decision |
|---|---|
| Naming for shared rule docs | `SCREAMING_SNAKE_CASE.md` |
| `libs/east/AGENTS.md` | Delete |
| `east-py-datascience/test/CLAUDE.md` | Delete (wrong-by-paste) |
| `east-node-std/test/CLAUDE.md`, `east-node-io/test/CLAUDE.md` | Delete; content → `EXAMPLES_AUTHORING.md`; namespace table → east-node-io README |
| `east-ui/test/CLAUDE.md` | Trim to UI-specific rules |
| `east-node-io/CLAUDE.md` | Extract `isValueOf` → `EAST_TS_INTEROP.md` |
| `east-py-datascience/CLAUDE.md` | Extract optional-deps → `PYTHON_OPTIONAL_DEPS.md` |
| `east-ui/CLAUDE.md` | Trim + extract file-tree to `docs/component-layout.md`; fix broken refs |
| `east-ui-components/CLAUDE.md` design tokens | **Delete entirely**; point to `libs/east-ui/design/` (canonical) + Makefile targets |
| `east-node-cli/CLAUDE.md`, `east-node-std/CLAUDE.md` | Replace with minimal stubs |
| Four new shared docs | Create all four |
| Lib-level east-node and east-ui CLAUDE.md | Create both |
| Package coverage | **One CLAUDE.md per package, even minimal** |

---

## 6. Templates

### 6.1 Root template (excerpt)

```markdown
# East Monorepo

pnpm + uv + cmake workspace.

## Plugin skills (DO NOT EDIT WITHOUT INTENT)
SKILL.md files back the `east:*` plugin skills. Editing them changes
plugin behaviour.
- libs/east/SKILL.md
- libs/e3/SKILL.md
- libs/east-ui/packages/east-ui/SKILL.md
- libs/east-node/packages/east-node-std/SKILL.md
- libs/east-node/packages/east-node-io/SKILL.md
- libs/east-py/packages/east-py-datascience/SKILL.md

## Conventions (shared across libs)
- /docs/conventions/EAST_TS_INTEROP.md
- /docs/conventions/EXAMPLES_AUTHORING.md
- /docs/conventions/PYTHON_OPTIONAL_DEPS.md
- /docs/conventions/MAKEFILE_TARGETS.md
```

### 6.2 Lib template (~30-50 lines)

```markdown
# <lib name>

<one-paragraph purpose>

## Packages
| Package | Purpose |
|---|---|

## Lib-specific concepts
<glossary — only if needed>

## See also
- STANDARDS.md
- SKILL.md (matches `east:<lib>` plugin skill — DO NOT EDIT casually)
- design/
- ../../docs/conventions/
```

### 6.3 Package stub (~15-25 lines)

```markdown
# <package name>

<one-line purpose. README covers usage; this file is agent orientation.>

## Package-unique guidance
<the actual reason this file exists>

## See also
- ../CLAUDE.md
- ../../STANDARDS.md
```

When there's no "Package-unique guidance" to write, the stub is just the
header + a "see also" pointing to lib-level CLAUDE.md.

---

## 7. Shared content extraction

### 7.1 `/docs/conventions/EAST_TS_INTEROP.md`

Sources: east-node-io/CLAUDE.md L49-130; memory entries
`[Use compareFor for SortedMap/SortedSet]`,
`[Never hand-roll variants]`, `[Use East comparisons]`.

Sections: `isValueOf()` rules; `compareFor` / `equalFor` / `lessFor`;
`variant()` / `some()` / `none`; `$.let` / `$.const` with explicit type.

### 7.2 `/docs/conventions/EXAMPLES_AUTHORING.md`

Sources: the four duplicated "Examples system" blocks.

Sections: spec↔examples pairing; `example()` helper; the 8 authoring
rules; `assert.examples()` wiring; UI-specific delta (Reactive.Root,
omit `returns` for UIComponentType); **explicit note: east-py-datascience
tests are pytest — this guide does NOT apply.**

### 7.3 `/docs/conventions/PYTHON_OPTIONAL_DEPS.md`

Sources: east-py-datascience/CLAUDE.md L44-97.

Sections: pyproject.toml extras; two-layer `find_spec` + lazy import
guard; mypy overrides.

### 7.4 `/docs/conventions/MAKEFILE_TARGETS.md`

Sources: scattered across root + lib CLAUDE.md files.

Sections: root-level targets (build/test/lint/test-all/services-*);
lib-level targets (same names work in each lib); why `npm run` is wrong
(no per-package npm scripts; pnpm is the workspace manager).

### 7.5 NOT extracted: design tokens

The CSS-variable dump in `east-ui-components/CLAUDE.md` (~150 lines) is
**deleted, not extracted**. Canonical source is `libs/east-ui/design/`
(HTML files); `make design` serves it; `make design-html-all` snapshots
to `dist-design/`. The CLAUDE.md will carry a 5-line pointer block, not
a copy of the tokens.

---

## 8. Per-file change list

### Tier 1 (root)

| File | Action |
|---|---|
| `/CLAUDE.md` | EDIT — add Plugin-skills callout + Conventions pointer block; keep existing structure. |

### Tier 2 (lib-level)

| File | Action |
|---|---|
| `libs/east/CLAUDE.md` | EDIT — `make` not `npm run`; trim semantics block. Target ~50 lines. |
| `libs/east/AGENTS.md` | DELETE. |
| `libs/east-c/CLAUDE.md` | EDIT — `make` not raw `cmake`. |
| `libs/east-node/CLAUDE.md` | CREATE — ~30 lines: package table + EAST_TS_INTEROP pointer + SKILL.md callout. |
| `libs/east-py/CLAUDE.md` | EDIT — fix package list (all 5); reference PYTHON_OPTIONAL_DEPS.md + MAKEFILE_TARGETS.md. |
| `libs/east-ui/CLAUDE.md` | CREATE — ~40 lines: IR→renderer→showcase trio; pointer to `design/` + Makefile design targets; SKILL.md callout. |
| `libs/e3/CLAUDE.md` | KEEP. |

### Tier 3 (package-level)

| File | Action |
|---|---|
| `libs/east-c/packages/east-c/CLAUDE.md` | CREATE (stub). |
| `libs/east-c/packages/east-c-std/CLAUDE.md` | CREATE (stub). |
| `libs/east-node/packages/east-node-cli/CLAUDE.md` | REPLACE with stub. |
| `libs/east-node/packages/east-node-io/CLAUDE.md` | EDIT — `isValueOf` → EAST_TS_INTEROP; namespace table → README. ~30 lines. |
| `libs/east-node/packages/east-node-std/CLAUDE.md` | REPLACE with stub. |
| `libs/east-py/packages/east-py/CLAUDE.md` | EDIT — trim dev-command section. ~100 lines. |
| `libs/east-py/packages/east-py-cli/CLAUDE.md` | CREATE (stub). |
| `libs/east-py/packages/east-py-datascience/CLAUDE.md` | EDIT — optional-deps → PYTHON_OPTIONAL_DEPS; keep modules table. ~80 lines. |
| `libs/east-py/packages/east-py-io/CLAUDE.md` | CREATE — references PYTHON_OPTIONAL_DEPS. |
| `libs/east-py/packages/east-py-std/CLAUDE.md` | CREATE (stub). |
| `libs/e3/packages/e3/CLAUDE.md` | CREATE (stub). |
| `libs/e3/packages/e3-api-client/CLAUDE.md` | CREATE — points at `design/e3-api.md`. |
| `libs/e3/packages/e3-api-server/CLAUDE.md` | CREATE — points at `design/e3-api.md`. |
| `libs/e3/packages/e3-api-tests/CLAUDE.md` | CREATE (stub). |
| `libs/e3/packages/e3-cli/CLAUDE.md` | CREATE — points at `design/e3-cli.md` + `USAGE.md`. |
| `libs/e3/packages/e3-core/CLAUDE.md` | CREATE — points at `design/e3-core.md`. |
| `libs/e3/packages/e3-types/CLAUDE.md` | CREATE (stub). |
| `libs/east-ui/packages/east-ui/CLAUDE.md` | EDIT — extract file-tree → `docs/component-layout.md`; fix broken refs. ~250 lines. |
| `libs/east-ui/packages/east-ui/test/CLAUDE.md` | TRIM — drop shared content; link to EXAMPLES_AUTHORING. ~150 lines. |
| `libs/east-ui/packages/east-ui-components/CLAUDE.md` | EDIT — delete token dump (replace with `design/` pointer); keep React patterns. ~250 lines. |
| `libs/east-ui/packages/east-ui-extension/CLAUDE.md` | CREATE — VS Code webview, CSP, font hosting. |
| `libs/east-ui/packages/east-ui-showcase/CLAUDE.md` | CREATE — snapshot pipeline, `dist-examples`. |
| `libs/east-ui/packages/e3-ui/CLAUDE.md` | CREATE — first-class UI in e3. |
| `libs/east-ui/packages/e3-ui-components/CLAUDE.md` | CREATE — e3-specific renderers. |
| `libs/east-ui/packages/e3-ui-showcase/CLAUDE.md` | CREATE (stub). |

### Test-level

| File | Action |
|---|---|
| `libs/east-node/packages/east-node-std/test/CLAUDE.md` | DELETE. |
| `libs/east-node/packages/east-node-io/test/CLAUDE.md` | DELETE (after moving namespace table to README). |
| `libs/east-py/packages/east-py-datascience/test/CLAUDE.md` | DELETE. |
| `libs/east-ui/packages/east-ui/test/CLAUDE.md` | TRIM (above). |

### New shared docs

| File | Action |
|---|---|
| `/docs/conventions/EAST_TS_INTEROP.md` | CREATE. |
| `/docs/conventions/EXAMPLES_AUTHORING.md` | CREATE. |
| `/docs/conventions/PYTHON_OPTIONAL_DEPS.md` | CREATE. |
| `/docs/conventions/MAKEFILE_TARGETS.md` | CREATE. |
| `libs/east-ui/packages/east-ui/docs/component-layout.md` | CREATE (extracted; kebab-case). |

---

## 9. Execution phases

| Phase | What | Risk |
|---|---|---|
| A | Safe corrections (npm→make, delete AGENTS.md + wrong test file, fix refs, fix east-py pkg list) | Low |
| B | Create the 4 convention docs + update root CLAUDE.md | Low |
| C | Delete duplicated test CLAUDE.md files; trim east-ui test | Low after Phase B (no info loss; convention docs already exist) |
| D | Split heavy package files (east-ui, east-ui-components, east-node-io, east-py-datascience) | Medium — most content shuffle |
| E | Replace east-node-cli/std CLAUDE.md with minimal stubs | Low |
| F | Create missing lib-level CLAUDE.md (east-node, east-ui) | Low |
| G | Add stub CLAUDE.md to every undocumented package (17 files) | Low |
| H | Cross-check relative links; verify no "Examples system" duplication remains | Low |

---

## 10. Verification

1. **Link integrity.** `npx markdown-link-check '**/CLAUDE.md'` —
   every relative link resolves.
2. **`make` reachability.** From each lib root, `make help` lists
   `build / test / lint`.
3. **SKILL.md unchanged.** `git diff` each `SKILL.md` — must be zero.
4. **No duplicated "Examples system" text.**
   `grep -r "Examples system" libs/` returns only the
   `/docs/conventions/EXAMPLES_AUTHORING.md` match (plus the trimmed
   east-ui test CLAUDE.md UI delta header).
5. **east-ui design pointer.** `make design` serves on :5174;
   `make design-html-all` produces `dist-design/`.
6. **Every package has a CLAUDE.md.** Every dir containing a
   `package.json` (excluding `node_modules`) has a CLAUDE.md sibling.

---

## 11. Estimated net change

Before:
- 16 active `CLAUDE.md` files
- ~3000 lines total
- 0 shared conventions docs
- 17 packages with no CLAUDE.md

After:
- ~33 `CLAUDE.md` files (one per package, by-tier)
- ~2000 lines total in CLAUDE.md (many are 15-line stubs)
- 4 shared `SCREAMING_SNAKE_CASE` convention docs (~400 lines)
- 1 extracted lowercase-kebab content doc (~150 lines)
- 1 deleted duplicate (`AGENTS.md`)
- 3 deleted wrong/duplicated test files (~500 lines deleted)
- 0 packages without orientation

Net: same total orientation content, organized by tier, with shared rules
in one place, no duplication, every package covered, and SKILL.md
clearly marked as plugin-load-bearing.

---

## 12. Out of scope (suggested separate plans)

- **STANDARDS.md consolidation.** 7 files total ~3700 lines with
  significant TypeDoc + testing-standards overlap. Bigger blast radius
  than CLAUDE.md — referenced from public CONTRIBUTING.md flows.
- **README.md uniformity.** Multiple per-package READMEs predate the
  monorepo merge; quality varies.
