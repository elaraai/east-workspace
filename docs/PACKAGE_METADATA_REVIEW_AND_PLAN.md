# Package metadata review and plan

**Date:** 2026-05-20
**Scope:** `README.md`, `LICENSE.md` / `LICENSE`, `CONTRIBUTING.md`, `CLA.md`
across every package and lib in the east-workspace monorepo.
**Status:** Proposal. Companion to
[`CLAUDE_MD_REVIEW_AND_PLAN.md`](CLAUDE_MD_REVIEW_AND_PLAN.md) which
covered the agent-facing docs; this one covers the public-facing
package metadata that ships to npm / PyPI / VS Marketplace.

---

## 0. TL;DR

The monorepo has **29 README.md, 24 LICENSE.md/LICENSE, 14
CONTRIBUTING.md, 14 CLA.md** files. Quality, completeness, and
consistency vary widely because they were inherited from six
previously-independent repos.

Four cross-cutting problems:

1. **Pre-monorepo URLs everywhere.** READMEs link at the old per-lib
   GitHub repos (`github.com/elaraai/east-node`,
   `github.com/elaraai/east-py`, etc.) that no longer exist as
   separate repos. One file uses a typo'd org name
   (`elara-ai` vs `elaraai`).
2. **License declaration drift.** Three license models coexist (**Dual
   AGPL-3.0/Commercial**, **BSL 1.1**, and **hybrid TS-AGPL + Py-BSL**)
   but the way each is declared in README + LICENSE + package.json
   varies — sometimes a badge, sometimes a paragraph, sometimes a
   single-line summary. Two npm packages reference `LICENSE` but the
   file is missing entirely.
3. **Missing files at the package level.** Eight packages with
   `package.json` lack `CONTRIBUTING.md` / `CLA.md`. Seven packages
   lack `README.md` entirely or have a 22-line stub. Two npm-published
   packages (`east-node-io`, `east-node-std`) have no `LICENSE` file
   at all — they reference one that doesn't exist.
4. **Duplicated content with drift.** The "Ecosystem" block appears
   in 10+ READMEs with slightly different e3 CLI command names. The
   workspace root README and `libs/east/README.md` are identical for
   the first 240 lines.

The plan: a canonical template per file type, a license configuration
matrix that resolves which package gets which license, and a
per-package gap list.

---

## 1. File-family overview

| File | Purpose | Audience | Ships to npm/PyPI? | Currently in repo |
|---|---|---|---|---|
| `README.md` | Marketing + Quick Start + reference | Users (developers) | **Yes** | 29 active + workspace root |
| `LICENSE.md` | Full legal license text | Users + lawyers | **Yes** | 24 |
| `LICENSE` (no ext) | Marketplace / npm short summary | Users (where `LICENSE.md` isn't picked up) | Yes for VS Marketplace | 1 (east-ui-extension) |
| `CONTRIBUTING.md` | How to contribute + CLA pointer | Outside contributors | Yes (but rarely read) | 14 |
| `CLA.md` | Contributor License Agreement text | Outside contributors | Yes | 14 |
| `CLA-template.md` (potential) | Template for the CLA | — | — | not present |

---

## 2. License configuration audit

This is the most important section — the project has three license
models and several configuration bugs (npm packages whose `license`
field points at a file that doesn't exist).

### 2.1 The three license models

| Model | What it means | Used by |
|---|---|---|
| **Dual AGPL-3.0 / Commercial** | AGPL-3.0 for open-source use; commercial license available from Elara AI | The user-facing language and UI surfaces |
| **BSL 1.1 (Business Source License)** | Free for non-production use; commercial license required for production; converts to AGPL-3.0 four years post-release | Server-side and operational tooling |
| **Hybrid TS=AGPL-3.0 / Py=BSL 1.1** | TypeScript surface AGPL-3.0; Python implementation BSL 1.1 | `east-py-datascience` only — because the TS types are a thin client but the Python impls represent the commercial value |

### 2.2 Canonical license assignment (proposed)

Resolved from current `LICENSE.md` content + README badges + project
intent. Some packages currently disagree with this — see §2.3 for
those.

| Package | License | Rationale |
|---|---|---|
| `@elaraai/east` | **Dual AGPL/Commercial** | User-facing language SDK |
| `@elaraai/east-node-std` | **Dual AGPL/Commercial** | User-facing platform |
| `@elaraai/east-node-io` | **Dual AGPL/Commercial** | User-facing I/O platform |
| `@elaraai/east-node-cli` | **Dual AGPL/Commercial** | User-facing CLI |
| `east-c` (binary release) | **BSL 1.1** | Performance runtime; commercial use needs license |
| `east-c-cli` (binary release) | **BSL 1.1** | Same |
| `east-c-std` (binary release) | **BSL 1.1** | Same |
| `east-py` (PyPI) | **BSL 1.1** | Python runtime; same model as east-c |
| `east-py-std` (PyPI) | **BSL 1.1** | Python platform |
| `east-py-io` (PyPI) | **BSL 1.1** | Python I/O |
| `east-py-cli` (PyPI) | **BSL 1.1** | Python CLI |
| `@elaraai/east-py-datascience` | **Hybrid (TS=AGPL, Py=BSL)** | Hybrid package per existing badges |
| `@elaraai/e3` | **Dual AGPL/Commercial** | User-facing SDK |
| `@elaraai/e3-types` | **Dual AGPL/Commercial** | Public type definitions |
| `@elaraai/e3-cli` | **BSL 1.1** | Operational tool |
| `@elaraai/e3-core` | **BSL 1.1** | Server engine |
| `@elaraai/e3-api-client` | **BSL 1.1** | Server-coupling client |
| `@elaraai/e3-api-server` | **BSL 1.1** | Server |
| `@elaraai/e3-api-tests` | **BSL 1.1** | Server compliance |
| `@elaraai/east-ui` | **Dual AGPL/Commercial** | User-facing UI library |
| `@elaraai/east-ui-components` | **Dual AGPL/Commercial** | User-facing renderer |
| `east-ui-preview` (VS Marketplace) | **Dual AGPL/Commercial** | User-facing extension |
| `@elaraai/e3-ui` | **Dual AGPL/Commercial** | User-facing |
| `@elaraai/e3-ui-components` | **Dual AGPL/Commercial** | User-facing |
| `@elaraai/east-ui-showcase` | **Dual AGPL/Commercial** (internal) | Dev tool; all `@elaraai/*` deps are Dual AGPL — must be AGPL-compatible |
| `@elaraai/e3-ui-showcase` | **Dual AGPL/Commercial** (internal) | Dev tool; all `@elaraai/*` deps are Dual AGPL |
| `east-ui-extension/webview` | **Dual AGPL/Commercial** (internal) | Build-time split of east-ui-extension; same license as parent |
| `e3-integration-tests` (test/integration) | **BSL 1.1** (internal) | Primarily exercises BSL packages (e3-api-server, e3-cli, e3-core, e3-api-tests) |
| `e3-fuzz` (test/fuzz) | **BSL 1.1** (internal) | Primarily exercises BSL packages (e3-cli, e3-core) |

### 2.3 Current state vs canonical (where they disagree)

These are the configuration bugs to fix:

| Package | Today | Canonical | Action |
|---|---|---|---|
| `@elaraai/east-node-io` | **No LICENSE file**; `package.json` says `"license": "SEE LICENSE IN LICENSE"` (broken ref) | Dual AGPL/Commercial | **Create `LICENSE.md`** matching east-node lib root |
| `@elaraai/east-node-std` | **No LICENSE file**; same broken ref | Dual AGPL/Commercial | **Create `LICENSE.md`** matching east-node lib root |
| `@elaraai/east-node-cli/LICENSE.md` | Heading: `# DUAL LICENSING` | Dual AGPL/Commercial | **Normalize heading** to match the canonical Dual License template |
| `libs/east/LICENSE.md` | Heading: `# Dual License` | Same | **Normalize heading** |
| `libs/east-ui/*/LICENSE.md` (6 files) | Heading: `# DUAL LICENSING` | Same | **Normalize heading** |
| `libs/east-py-datascience/LICENSE.md` | Heading: `# Licensing` | Hybrid | Confirm hybrid wording is current; normalize heading |
| `libs/east-ui/packages/east-ui-extension/LICENSE` (no ext) | One-line marketplace summary | Keep alongside LICENSE.md | **Keep** — VS Marketplace requires this short form |
| All other `LICENSE` (no ext) files | Don't exist | — | **Optionally add** for npm display, but `LICENSE.md` already works |
| `libs/east-py/packages/east-py/pyproject.toml` | `license = "LicenseRef-Proprietary"` | BSL 1.1 (the actual file is BSL) | **Change** to `license = { file = "LICENSE.md" }` — matches the other east-py packages |

### 2.4 LICENSE.md filename: stick with `.md`?

Some publish surfaces (PyPI, npm) prefer `LICENSE` without extension.
Currently the monorepo uses `LICENSE.md` consistently (with one
exception — east-ui-extension also has a short `LICENSE` for VS
Marketplace).

**Recommendation:** keep `LICENSE.md` as the canonical file. PyPI and
npm accept it via the `license = { file = "LICENSE.md" }` /
`"license"` package.json reference. The VS Marketplace exception
(short `LICENSE` + full `LICENSE.md`) stays.

### 2.5 Where the canonical license body lives

For repeatable consistency, the actual legal text should live in ONE
place per license model and packages should symlink or copy from it:

```
docs/license-templates/                       (NEW)
├── DUAL_AGPL_COMMERCIAL.md                   (canonical Dual License)
├── BSL_1_1.md                                (canonical BSL 1.1)
└── HYBRID_TS_AGPL_PY_BSL.md                  (canonical hybrid)
```

Packages still need a copy at their own `LICENSE.md` path (the file
ships in the published artifact), but the template lives once.

---

## 3. README.md review

### 3.1 Canonical template (published-package README)

This is the structure every npm/PyPI-published package's README must
follow. Derived from `east-node-io` and `east-ui` which are the most
polished examples.

```markdown
# <Display Name>

> <One-line tagline>

[![License](badge)](LICENSE.md)
[![Node Version](badge)](https://nodejs.org)
[badges for npm version, downloads, etc. as appropriate]

**<Display Name>** provides <one-paragraph what-and-why>, linking to
[East](https://github.com/elaraai/east-workspace) and any sibling.

## Features

- **Feature 1**: …
- **Feature 2**: …
- …

> **No emoji bullets.** Several existing READMEs use 🔒/🎯/🚀-style
> feature lists; remove them when touching a file. Plain
> `- **Bold**: description` is the standard.

## Installation

```bash
npm install @elaraai/<pkg> @elaraai/east   # or pip / curl-and-tar / VSIX
```

[Optional: Python-extras subsection — only east-py-* packages]

## Quick Start

[At least one runnable code example; multiple if the package has
distinct domains (SQL/Storage/Transfer for east-node-io, etc.)]

## <Reference section>

[Tables / lists enumerating the public API surface — e.g. "Platform
Functions" for east-node-io, "Component Categories" for east-ui]

## Development

```bash
make build      # or pnpm / uv / cmake commands
make test
make lint
```

## Documentation

- [USAGE.md](USAGE.md) — if present
- [Standards](STANDARDS.md) — if present
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE.md)

## License

<Dual AGPL or BSL or Hybrid wording per §2.1>

## Ecosystem

<Shared snippet — see §3.3>

## Links

- **Website**: https://elaraai.com/
- **Repository**: https://github.com/elaraai/east-workspace
- **Issues**: https://github.com/elaraai/east-workspace/issues
- **Email**: support@elara.ai

## About Elara

<Shared snippet — see §3.3>

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
```

### 3.2 Minimal template (internal / not-published packages)

For showcases, test runners, internal build splits. No marketing
section needed.

```markdown
# <Display name>

<One-line purpose. Note "Internal — not published.">

## Usage / Commands

```bash
make build
make test
```

## See also

- [Parent lib README](../README.md)
```

### 3.3 Code examples — pull from `.examples.ts` bodies

**README code samples should not be invented from scratch.** Every
package with East code already has a test suite of `*.examples.ts`
files that are compiled, type-checked, and verified to produce the
expected outputs. When you need a Quick Start snippet, pick the
relevant `example()` and **paste its `fn:` body** (the
`East.function(...)` call) into the README. Drop the `example()`
wrapper, keywords, description, inputs, and returns — those exist
for the test framework, not for human readers.

#### Pattern

Source file `array.examples.ts`:

```ts
export const arrayReduce = example({
    keywords: ["array", "ArrayType", "reduce", "fold", "aggregation"],
    description: "Reduce an array to a single value with an initial accumulator",
    fn: East.function([], IntegerType, ($) => {
        const a = $.const([1n, 2n, 3n], ArrayType(IntegerType));
        return a.reduce(($, acc, x) => acc.add(x), 10n);
    }),
    inputs: [],
    returns: 16n,
});
```

What goes into the README:

````markdown
```ts
import { East, ArrayType, IntegerType } from "@elaraai/east";

East.function([], IntegerType, ($) => {
    const a = $.const([1n, 2n, 3n], ArrayType(IntegerType));
    return a.reduce(($, acc, x) => acc.add(x), 10n);
});
```
````

The README adds the `import` line (matching what a user would
write) but copies the `East.function(...)` body verbatim. That
locks the README to a tested-and-passing example — when the API
changes, the test fails first and you update both in lockstep.

#### Where to find examples per package

| Package | `.examples.ts` count | Pick examples for README from |
|---|---|---|
| `libs/east` | 19 (one per spec file under `test/`) | `array`, `dict`, `struct`, `variant` (basic primer); `function`, `block` (control flow) |
| `libs/east-node/packages/east-node-std` | 8 | `console`, `fs`, `fetch`, `crypto`, `time` (one Quick Start each, or a single combined) |
| `libs/east-node/packages/east-node-io` | 14 | SQL/Storage/NoSQL/Transfer/Format (mirror the README's existing 4-section Quick Start) |
| `libs/east-py/packages/east-py-datascience` | 28 | Optimization (MADS, Optuna), ML (XGBoost), Bayesian (PyMC) — pick one per ML category section |
| `libs/east-ui/packages/east-ui` | 100 | Layout (`Stack`, `Box`), forms (`Input`, `Checkbox` Reactive), display (`Badge`, `Stat`), interactive (`Button` Reactive counter) |
| `libs/east-ui/packages/e3-ui` | 2 | Both — they're the canonical first-class UI examples |

Packages WITHOUT `.examples.ts` (e3-core, e3-api-server, etc.) keep
hand-written examples in the README, but should still cross-link to
the design docs for context.

#### Skill.md as a secondary source

For the 6 packages with a `SKILL.md` file
(`east`, `e3`, `east-ui`, `east-node-std`, `east-node-io`,
`east-py-datascience`), the SKILL.md is the **plugin authoring
cheat-sheet** — concise decision trees, common patterns, "when to
reach for which API". Some of that content fits well in the README:

- **README "Quick Start" prose**: borrow the one-paragraph intro
  framing each section uses in SKILL.md.
- **README "Features" / category tables**: SKILL.md often has a
  "When to use" decision tree — the leaves of that tree map
  directly to README feature bullets.
- **README "Common patterns" sub-section** (optional): pull a few
  high-value patterns from SKILL.md without copying the whole file.

The full SKILL.md still belongs only as a plugin asset (`east:*`).
The README should not *be* a copy of SKILL.md — it should
**reference** SKILL.md at the bottom under a "See also" section
when the package has one.

### 3.4 Shared snippets (extract to single source)

Two blocks appear in 10+ READMEs and have drifted. Move to a shared
source so they update in lockstep.

#### `docs/snippets/ECOSYSTEM.md`

The "Ecosystem" cross-link block. Currently inconsistent on e3 CLI
command names (some say `e3 init`/`e3 run`/`e3 logs`, others say
`e3 repo`/`e3 workspace`/`e3 start`/`e3 logs`). Source-of-truth
should be a single file that every README's release script
re-injects.

#### `docs/snippets/ABOUT_ELARA.md`

The "About Elara" paragraph. Currently identical-ish across READMEs
but slight whitespace / wording drift.

> Note: GitHub README injection at publish time is a build-script
> concern, not a runtime concern. Either generate
> `README.md` at publish via a Makefile step, or accept the
> duplication as the cost of standalone discoverability and audit
> drift periodically.

### 3.5 Repo URL fixes (universal)

Every pre-monorepo URL needs to point at the unified workspace.

| Stale form | Canonical form |
|---|---|
| `github.com/elaraai/east-node` | `github.com/elaraai/east-workspace/tree/main/libs/east-node` |
| `github.com/elaraai/east-py` | `github.com/elaraai/east-workspace/tree/main/libs/east-py` |
| `github.com/elaraai/east-ui` | `github.com/elaraai/east-workspace/tree/main/libs/east-ui` |
| `github.com/elaraai/e3` | `github.com/elaraai/east-workspace/tree/main/libs/e3` |
| `github.com/elaraai/east-node/issues` | `github.com/elaraai/east-workspace/issues` |
| `github.com/elaraai/east-py/issues` | `github.com/elaraai/east-workspace/issues` |
| `github.com/elaraai/east-ui/issues` | `github.com/elaraai/east-workspace/issues` |
| `github.com/elara-ai/East` (typo) | `github.com/elaraai/east-workspace/tree/main/libs/east` |
| `github.com/elara-ai/east-py` (typo) | `github.com/elaraai/east-workspace/tree/main/libs/east-py` |

**Confirm with project owner:** is `elaraai/east-workspace` the right
monorepo name? If different, sub in that here.

### 3.6 Per-README gap analysis

Legend: **✅** acceptable as-is · **🟡** minor drift / standardize ·
**🟠** content gap (significant) · **🔴** missing or broken

| README | Lines | License decl? | Repo URLs | Ecosystem block? | Status |
|---|---|---|---|---|---|
| `/README.md` (workspace root) | 340 | ✅ | 🔴 stale | ✅ | 🟡 normalize URLs + decide vs `libs/east/README.md` |
| `libs/east/README.md` | 293 | ✅ | 🔴 stale | ✅ | 🟠 first 240 lines duplicate the workspace root; decide which is canonical and dedup |
| `libs/east-c/README.md` | 119 | ✅ | 🔴 stale | 🔴 missing | 🟡 add ecosystem block + standard footer |
| `libs/east-node/README.md` | 109 | ✅ | 🔴 stale | 🟡 partial | 🟡 normalize |
| `libs/east-py/README.md` | 146 | ✅ | 🔴 stale (`elara-ai` typo) | ✅ | 🟠 fix typo URLs, normalize |
| `libs/e3/README.md` | 122 | ✅ | 🔴 stale | ✅ | 🟡 normalize URLs |
| `libs/east-ui/README.md` | 81 | ✅ | 🔴 stale | 🔴 missing | 🟡 add ecosystem + normalize |
| `libs/east-node/packages/east-node-cli/README.md` | 157 | ✅ | 🔴 stale | ✅ | 🟡 normalize URLs |
| `libs/east-node/packages/east-node-io/README.md` | 259 | ✅ | 🔴 stale | ✅ | 🟡 normalize URLs (model README otherwise) |
| `libs/east-node/packages/east-node-std/README.md` | 162 | ✅ | 🔴 stale | ✅ | 🟡 normalize URLs |
| `libs/east-py/packages/east-py/README.md` | 241 | ✅ | 🔴 stale (`elara-ai` typo) | ✅ | 🟠 fix typo, normalize URLs |
| `libs/east-py/packages/east-py-cli/README.md` | 131 | ✅ | 🔴 stale | ✅ | 🟡 normalize |
| `libs/east-py/packages/east-py-io/README.md` | 209 | ✅ | 🔴 stale | ✅ | 🟡 normalize |
| `libs/east-py/packages/east-py-std/README.md` | 195 | ✅ | 🔴 stale | ✅ | 🟡 normalize |
| `libs/east-py/packages/east-py-datascience/README.md` | 199 | ✅ hybrid badges | 🔴 stale | ✅ | 🟡 normalize URLs; confirm hybrid wording matches §2.1 |
| `libs/e3/packages/e3/README.md` | 102 | ✅ | 🔴 stale | ✅ | 🟡 normalize URLs |
| `libs/e3/packages/e3-api-client/README.md` | 171 | check | 🔴 stale | check | review |
| `libs/e3/packages/e3-api-server/README.md` | 271 | check | 🔴 stale | check | review |
| `libs/e3/packages/e3-api-tests/README.md` | 100 | ✅ BSL | 🔴 stale | ✅ | 🟡 normalize URLs |
| `libs/e3/packages/e3-cli/README.md` | 193 | check | 🔴 stale | check | review |
| `libs/e3/packages/e3-core/README.md` | 106 | check | 🔴 stale | check | review |
| `libs/e3/packages/e3-types/README.md` | 65 | check | 🔴 stale | check | review |
| `libs/east-ui/packages/east-ui/README.md` | 107 | ✅ | 🔴 stale | 🔴 missing | 🟡 add ecosystem + normalize |
| `libs/east-ui/packages/east-ui-components/README.md` | 129 | ✅ | 🔴 stale | 🔴 missing | 🟡 add ecosystem + normalize |
| `libs/east-ui/packages/east-ui-extension/README.md` | 80 | ✅ | 🔴 stale | 🔴 missing | 🟡 add ecosystem + normalize (this one ships to VS Marketplace) |
| `libs/east-ui/packages/e3-ui/README.md` | 81 | check | 🔴 stale | check | review |
| `libs/east-ui/packages/e3-ui-components/README.md` | 132 | ✅ | 🔴 stale | 🔴 missing | 🟡 normalize |
| `libs/east-ui/packages/e3-ui-showcase/README.md` | 22 | 🟠 BSL one-liner | none | 🔴 missing | 🟠 minimal — apply §3.2 template since not published |

### 3.7 Missing README.md (7 files to CREATE)

Per the user's prior decision "one CLAUDE.md per package even minimal"
the same standard should apply here, modulated by whether the package
publishes:

| Package | Publishes? | Template | Action |
|---|---|---|---|
| `libs/east-c/packages/east-c` | Binary release | Published-package template (§3.1) | **CREATE** |
| `libs/east-c/packages/east-c-cli` | Binary release | Published-package template | **CREATE** |
| `libs/east-c/packages/east-c-std` | Binary release | Published-package template | **CREATE** |
| `libs/east-ui/packages/east-ui-showcase` | No (dev tool) | Minimal template (§3.2) | **CREATE** |
| `libs/east-ui/packages/east-ui-extension/webview` | No (build artifact) | Minimal | **CREATE** (very short — internal build split) |
| `libs/e3/test/integration` | No (test runner) | Minimal | **CREATE** |
| `libs/e3/test/fuzz` | No (test runner) | Minimal | **CREATE** |

---

## 4. LICENSE review

### 4.1 Missing LICENSE files (2 — both published to npm, broken refs)

| Package | Status | Action |
|---|---|---|
| `libs/east-node/packages/east-node-io` | `package.json` references `LICENSE` but file doesn't exist | **CREATE `LICENSE.md`** with canonical Dual License text + fix package.json `"license"` field to `"SEE LICENSE IN LICENSE.md"` (or SPDX `AGPL-3.0-or-later`) |
| `libs/east-node/packages/east-node-std` | Same | Same |

### 4.2 Missing LICENSE.md (packages without LICENSE)

**Every package needs a LICENSE**, even non-published ones — the
monorepo is in version control and contributors need legal
permission to use, modify, and share the source. The license of a
non-published package is constrained by the licenses of its
dependencies (AGPL is copyleft; BSL has its own restrictions).

| Package | License | Reasoning | Action |
|---|---|---|---|
| `libs/east-c/packages/east-c` | BSL 1.1 | Matches lib root | **CREATE LICENSE.md** with canonical BSL 1.1 |
| `libs/east-c/packages/east-c-cli` | BSL 1.1 | Same | **CREATE** |
| `libs/east-c/packages/east-c-std` | BSL 1.1 | Same | **CREATE** |
| `libs/east-ui/packages/east-ui-showcase` | Dual AGPL/Commercial | Deps: `east`, `east-ui`, `east-ui-components` (all Dual AGPL) | **CREATE** with canonical Dual License |
| `libs/east-ui/packages/e3-ui-showcase` | Dual AGPL/Commercial | Deps: all Dual AGPL (east, east-ui, e3, e3-ui, …) | **CREATE** |
| `libs/east-ui/packages/east-ui-extension/webview` | Dual AGPL/Commercial | Build-time split of east-ui-extension; matches parent | **CREATE** |
| `libs/e3/test/integration` | BSL 1.1 | Primarily exercises BSL packages (e3-api-server, e3-cli, e3-core, e3-api-tests) | **CREATE** |
| `libs/e3/test/fuzz` | BSL 1.1 | Primarily exercises BSL packages (e3-cli, e3-core) | **CREATE** |

### 4.2.1 Dependency-constrained license rules

For any *new* package in this monorepo, derive its minimum license
constraint from its `@elaraai/*` dependencies:

| Has AGPL dep? | Has BSL dep? | Minimum license |
|---|---|---|
| Yes | No | **Dual AGPL/Commercial** (or stricter) |
| No | Yes | **BSL 1.1** (or stricter) |
| Yes | Yes | **Dual AGPL/Commercial** with explicit BSL-section commercial coverage — needs legal sign-off |
| No | No (only external deps) | Free choice |

A package can ALWAYS be stricter than its deps require (e.g. a BSL
package depending only on AGPL deps is still legal — BSL covers
the AGPL constraint via its commercial-only-after-X-years term).
It can never be more permissive.

### 4.3 LICENSE.md heading normalization

Current headings vary (`# Dual License`, `# DUAL LICENSING`, `# Business Source License 1.1`, `# Licensing`). Standardize:

| License model | Canonical heading |
|---|---|
| Dual AGPL/Commercial | `# Dual License — AGPL-3.0 / Commercial` |
| BSL 1.1 | `# Business Source License 1.1` |
| Hybrid TS-AGPL / Py-BSL | `# Dual License — AGPL-3.0 (TypeScript) / BSL 1.1 (Python)` |

### 4.4 package.json `license` field normalization

Currently every npm package has `"license": "SEE LICENSE IN LICENSE"`
(referencing a file that may not exist). Replace with SPDX
identifiers where possible:

| Package | Proposed `"license"` field |
|---|---|
| Dual AGPL packages | `"AGPL-3.0-or-later"` (SPDX) — explicitly **single-license**, since the commercial alternative is offered separately and not via the npm metadata |
| BSL 1.1 packages | `"BUSL-1.1"` (SPDX) |
| Hybrid (east-py-datascience) | `"SEE LICENSE IN LICENSE.md"` — no clean SPDX for hybrid |

This avoids the current broken `"SEE LICENSE IN LICENSE"` (missing
file extension), works with npm's automatic license display, and
keeps the actual legal text in `LICENSE.md` for both human and
legal review.

### 4.5 pyproject.toml `license` field

Currently mixed:

- 5 east-py packages: `license = { file = "LICENSE.md" }` ✅
- `east-py/packages/east-py`: `license = "LicenseRef-Proprietary"` 🟠 inconsistent

Normalize all to `license = { file = "LICENSE.md" }`. The
`LicenseRef-Proprietary` SPDX identifier is correct for newer PEP
639 conformance but mismatches the file-based form used by siblings
— pick one.

**Recommendation:** use `license = { file = "LICENSE.md" }`
consistently (PEP 621 form). Revisit when PEP 639 is more broadly
adopted by uv/pip.

---

## 5. CONTRIBUTING.md and CLA.md review

### 5.1 Current state

CONTRIBUTING.md present at every lib root + several east-ui/east-node
packages. 13 of 14 files have **identical content** with one
adapted paragraph (Dual AGPL wording vs BSL/Dual combination
wording). The `e3/CONTRIBUTING.md` variant exists for the
BSL-heavy e3 lib.

CLA.md: 14 files, all 25-26 lines. (Did not diff exhaustively but
likely the same — these are legal templates.)

### 5.2 Canonical CONTRIBUTING.md templates

**Template A — Dual AGPL/Commercial libs** (currently in east, east-node, east-ui, east-c, east-py — though east-c is BSL so this is partly mismatched). Use the existing `libs/east/CONTRIBUTING.md` body, parameterized only by project name.

**Template B — BSL-dominant libs** (currently e3). Use the existing `libs/e3/CONTRIBUTING.md` body, parameterized.

These should live in `docs/contributing-templates/` and be
copied into each lib at release-prep time (or just kept manually in
lockstep — these files rarely change).

### 5.3 Missing CONTRIBUTING.md and CLA.md (8 packages)

Per "one per published package" rule:

| Package | Publishes? | Action |
|---|---|---|
| `libs/e3/packages/e3` | npm | **CREATE** (Template A — e3 SDK is dual-licensed per §2.2) |
| `libs/e3/packages/e3-types` | npm | **CREATE** (Template A) |
| `libs/e3/packages/e3-cli` | npm | **CREATE** (Template B — BSL) |
| `libs/e3/packages/e3-core` | npm | **CREATE** (Template B — BSL) |
| `libs/e3/packages/e3-api-client` | npm | **CREATE** (Template B — BSL) |
| `libs/e3/packages/e3-api-server` | npm | **CREATE** (Template B — BSL) |
| `libs/e3/packages/e3-api-tests` | npm | **CREATE** (Template B — BSL) |
| `libs/east-py/packages/east-py-datascience` | npm + PyPI | **CREATE** (custom — hybrid model) |
| `libs/east-ui/packages/east-ui-showcase` | No | **Skip** |
| `libs/east-ui/packages/e3-ui-showcase` | No | **Skip** |
| `libs/e3/test/integration`, `test/fuzz` | No | **Skip** |

### 5.4 Pre-monorepo URL fixes in CONTRIBUTING.md

CONTRIBUTING.md mentions "Fork the repository" — if the project still
expects forks of individual libs, those instructions need updating
to fork `east-workspace` instead.

---

## 6. Shared structure proposal

```
/docs/license-templates/                       (NEW)
├── DUAL_AGPL_COMMERCIAL.md                    canonical Dual License body
├── BSL_1_1.md                                 canonical BSL 1.1 body
└── HYBRID_TS_AGPL_PY_BSL.md                   canonical hybrid body

/docs/contributing-templates/                  (NEW)
├── CONTRIBUTING_DUAL_LICENSE.md               Template A
├── CONTRIBUTING_BSL.md                        Template B
└── CLA.md                                     single canonical CLA text

/docs/snippets/                                (NEW)
├── ECOSYSTEM.md                               cross-link block
└── ABOUT_ELARA.md                             company description block

/docs/README_TEMPLATE_PUBLISHED.md             (NEW) — published-package skeleton
/docs/README_TEMPLATE_INTERNAL.md              (NEW) — non-published skeleton
```

Per the
[`feedback_system_docs_uppercase`](../.claude/projects/...) rule,
single-word system docs stay `ALLCAPS.md`. Multi-word system docs
(`README_TEMPLATE_PUBLISHED.md`, `DUAL_AGPL_COMMERCIAL.md`) use
`SCREAMING_SNAKE_CASE.md`.

---

## 7. Execution phases

**Phase A — Fix the legally-load-bearing bugs (do first)**

1. Create missing `LICENSE.md` for `east-node-io` and `east-node-std`
   with canonical Dual License body.
2. Audit and confirm canonical license-per-package mapping from §2.2
   with project owner.
3. Update `package.json` `license` fields across all packages to
   SPDX identifiers (or `"SEE LICENSE IN LICENSE.md"`).
4. Normalize `pyproject.toml` `license` for east-py packages.

**Phase B — Extract shared text**

5. Create `docs/license-templates/` with three canonical bodies.
6. Create `docs/contributing-templates/` with two CONTRIBUTING
   templates + canonical CLA.
7. Create `docs/snippets/ECOSYSTEM.md` and `ABOUT_ELARA.md`.

**Phase C — Per-LICENSE.md normalization**

8. Replace every existing `LICENSE.md` body with the canonical
   template from §6 (keeping per-package copyright dates).
9. Normalize headings per §4.3.

**Phase D — README fixes (universal)**

10. Replace all pre-monorepo URLs with the canonical
    `east-workspace` paths per §3.4 (including the `elara-ai` typo).
11. Inject the canonical Ecosystem and About Elara blocks where
    missing or drifted.
12. Normalize license declaration wording to match §4.3 headings.

**Phase E — README per-package refinements**

13. Resolve `libs/east/README.md` vs `/README.md` duplication —
    decision needed: either (a) keep both, with the workspace one
    being a superset, or (b) make `libs/east/README.md` the
    canonical and have `/README.md` be a thin "this is a monorepo,
    see the libs" landing page.
14. Add missing READMEs for east-c packages (binary releases) using
    the published template.
15. Apply the minimal template to e3-ui-showcase, east-ui-showcase
    (currently 22 / partial lines).

**Phase F — Create missing CONTRIBUTING and CLA**

16. Add CONTRIBUTING + CLA to each of the 7 e3 packages and
    east-py-datascience (per §5.3).
17. Update CONTRIBUTING.md "Fork the repository" instructions to
    reference `east-workspace`.

**Phase G — Final verification**

18. Confirm every npm package has `package.json` → `license` field
    that resolves to an existing file (or SPDX identifier).
19. Confirm every PyPI package has `pyproject.toml` license intact.
20. Run a markdown link check; ensure no `github.com/elaraai/east-*`
    (non-workspace) URLs remain.
21. Confirm VS Marketplace's expectations for the extension package
    (LICENSE vs LICENSE.md, README badges).
22. Spot-check a `make build` + dry-run publish to confirm
    license metadata flows through correctly.

---

## 8. Open questions for the project owner

These need a call before executing:

1. **Monorepo URL.** What's the canonical GitHub repo? This plan
   assumes `github.com/elaraai/east-workspace`. Confirm or
   substitute.
2. **License assignments in §2.2.** The mapping was inferred from
   existing LICENSE headers + README badges + my best understanding
   of which packages are commercial-value-bearing. Sign off needed
   on the full table before mass-rewriting LICENSE.md bodies.
3. **east-ui-extension VS Marketplace listing.** Confirm the
   marketplace requires the dual `LICENSE` + `LICENSE.md` setup
   currently in place. Otherwise simplify.
4. **e3-ui-showcase and east-ui-showcase license.** Currently one
   has a BSL one-liner README, the other has DUAL LICENSING in
   LICENSE.md. If they're internal-only (not published), they don't
   need a public license declaration at all — drop or mark
   "Internal".
5. **east-py-datascience hybrid wording.** The current
   `LICENSE.md` heading is `# Licensing` (vague). Should the
   canonical heading explicitly call out the split, or keep it
   generic?
6. **README duplication.** `/README.md` and `libs/east/README.md`
   share 240 lines. Which is canonical and what's the policy for
   the other?
7. **Snippet injection strategy.** Generate at publish time, or
   maintain by hand? Generating is more correct but adds a
   build-script dependency; manual is simpler but drifts.
8. **CLA assistant integration.** CONTRIBUTING.md says "the CLA
   Assistant bot will automatically comment on your PR". Confirm
   the bot is installed on the monorepo, not on the
   pre-monorepo separate repos.

---

## 9. Out of scope (mentioned for completeness)

- **`pyproject.toml` metadata** beyond the `license` field (project
  name, version, classifiers, etc.). May warrant its own audit.
- **`package.json` metadata** beyond the `license` field
  (description, keywords, repository, homepage, bugs). Many of
  these currently point at pre-monorepo URLs too. Could be folded
  in here or kept separate.
- **GitHub Issue / PR templates** under `.github/`. Not reviewed
  here.
- **CHANGELOG.md** — none in the repo today. Out of scope but worth
  a follow-up plan.
