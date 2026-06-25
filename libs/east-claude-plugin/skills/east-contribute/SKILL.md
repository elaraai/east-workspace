---
name: east-contribute
description: "Contribute a change to the East monorepo (elaraai/east-workspace) from a GitHub issue, end-to-end and to repo standard. Use when: (1) the user gives a GitHub issue number or URL for elaraai/east-workspace and asks to design/implement/fix it ('work on issue #42', 'implement this issue', 'fix #37'), (2) making any code change INSIDE the monorepo libs (east, east-node, east-c, east-py, e3, east-ui, or the dev-tooling: east-diagnostics, eslint-plugin-east, tsserver-plugin-east, east-claude-plugin) where you must follow the repo conventions/STANDARDS, the examples↔tests contract, East diagnostics, and the CI gates, (3) triaging which lib(s)/skills an issue affects and avoiding duplication of an existing capability, (4) taking a monorepo change from branch → implementation → build/test/lint + diagnostics → PR. NOT for building an application WITH East — use east-design / east-project for that."
---

# East Monorepo Contributor Workflow (issue → PR)

Drive a GitHub issue from `elaraai/east-workspace` to a **verified, convention-compliant pull request** that resolves it. This skill is for contributing to the **monorepo itself** — fixing/extending `east`, `east-node`, `east-c`, `east-py`, `e3`, `east-ui`, and the dev-tooling libs — not for building an app with East.

You are a maintainer of a large, diverse, multi-language platform (TypeScript + Python + C). The dominant failure modes are: re-deriving a fix the issue already specifies, **duplicating a capability that already exists**, shipping East code that type-checks but breaks East idioms, and missing a CI gate (examples↔tests parity, regenerated plugin index, version drift). This skill exists to prevent those.

## When this skill vs others

| Situation | Skill |
|---|---|
| "Fix / implement issue #N in east-workspace", change monorepo source | **east-contribute** (this) |
| "Build an app / I have a goal" — design a solution with East | east-design → east-project |
| Per-API how-to while implementing | the per-package skill: `east`, `e3`, `east-node-std`, `east-node-io`, `east-py*`, `east-ui`, `e3-ui` |

## Inputs

An **issue number or URL** (e.g. `#42`, `https://github.com/elaraai/east-workspace/issues/42`). If `gh` is unavailable or the user pasted the body, work from the pasted text.

```bash
gh issue view <n> --repo elaraai/east-workspace          # read the WHOLE issue
gh label list --repo elaraai/east-workspace              # taxonomy (most issues are unlabelled)
```

## The loop

```
0 UNDERSTAND   read the whole issue; honor its scope (Acceptance criteria / Ship-this-release; leave Defer items)
1 TRIAGE       map issue → lib(s) → per-package skill(s); compute the CI blast radius
2 DISCOVER     check the feature register — does this capability already exist? (anti-duplication)
3 TOOLING      ensure East diagnostics are live; know the REAL gate is `make lint`
4 REPRODUCE    bugs: run the repro, confirm the root cause BEFORE editing. features: design to the issue's design
5 IMPLEMENT    edit src WITH TypeDoc; obey the East interop rules absolutely
6 EAST CODE    every public method touched gets a spec test AND an example() (HARD RULE)
7 VERIFY       make build → make test → make lint → address every diagnostic → downstream libs
8 SYNC         update SKILL.md/docs if public API changed; regenerate + commit the plugin index/.build
9 PR           branch → commit → PR linking the issue — ONLY after the user approves the push
```

Do not skip 0, 2, or 7. The issue body usually already names the exact root-cause file and the intended fix — start there, don't re-derive. Implement to the stated scope and **no further** (honor `Defer` checklists).

---

## 0. Understand — read the whole issue

Issue bodies are highly structured. **Bugs**: `## Symptom` + a runnable reproduction + `## Root cause` (often citing the exact `file:guard`) + `## Fix` (sometimes two options) + `## Workaround`. **Features**: `## Summary` / `## Motivation` / `## Decision (design)` (concrete types/code) / `## Backward compatibility` / `## Scope / phasing` (a `Ship in this release` vs `Defer` checklist) / `## Acceptance criteria`. Some issues titled `Design:` want a **design/spec PR, not code** — produce the design, don't over-build.

Decide the deliverable type up front: **bug fix**, **feature (to acceptance criteria)**, **test-only** (the issue says "pure test addition; no product code"), or **design proposal**.

## 1. Triage — issue → lib(s) → skills

Title prefixes are literal scopes. Map to the directory, then load the per-package skill before coding.

| Prefix / area | Directory | Per-package skill |
|---|---|---|
| `east:` (core language) | `libs/east` | `east` |
| `east-node:` std / io | `libs/east-node/packages/east-node-{std,io}` | `east-node-std` / `east-node-io` |
| `east-py:` | `libs/east-py/packages/east-py{,-std,-io,-datascience}` | `east-py` / `east-py-std` / `east-py-io` / `east-py-datascience` |
| `e3` | `libs/e3` | `e3` |
| `east-ui` / `causal` | `libs/east-ui/packages/{east-ui,e3-ui}` | `east-ui` / `e3-ui` |
| `east-c` | `libs/east-c` | **no per-API skill** — read `libs/east-c/CLAUDE.md`, use `make compliance` |
| dev-tooling | `libs/{east-diagnostics,eslint-plugin-east,tsserver-plugin-east,east-claude-plugin}` | none — read the lib's README/CLAUDE.md |

**Blast radius (run the union locally — CI will).** A change to a core lib triggers downstream workflows via `paths:` filters:

- `libs/east` → tests for east, east-node, e3, east-c, east-py, east-ui, diagnostics
- `libs/east-node` → east-node, e3, east-c, east-py, east-ui
- `libs/e3` → e3, east-ui · `libs/east-c` → east-c, east-py · `libs/east-py` → east-py, e3
- any `libs/**/SKILL.md` or `libs/**/*.examples.ts(x)` → **plugin-artifacts** (regenerates the search index)
- **every PR** → `version-drift` (`make check-version`)

Heuristic: always `make build` the union; run a downstream lib's **tests** when your change touches exported types or IR (anything `make test-export` would emit), otherwise the directly-edited lib's tests suffice plus a root `make build`.

## 2. Discover — the feature register (don't duplicate)

**Before writing new code, confirm the capability doesn't already exist somewhere in the platform.** Mandatory — the same primitive often already lives in a sibling lib, and silent duplication is the most expensive mistake here. There is no single hand-maintained catalog (deliberately — it would rot against the sources below). The register is a **procedure** over the authoritative, low-staleness sources, plus the ownership map.

**Search order** (each step widens coverage past the previous step's blind spots):

1. **Example index** (auto-generated, CI-enforced) — MCP tool `mcp__plugin_east_east__search_east_examples` (a.k.a. `search_east_examples`); try 2–3 keyword phrasings, optional `package` filter. Covers `east`, `east-node-std`, `east-node-io`, `east-py-datascience`, `east-ui`, `e3-ui` (+ a few hand-written `e3` stubs).
2. **Per-lib `SKILL.md` API tables** — the designated per-package API registry; catches APIs with no `example()` yet. `rg -i "<symbol>" libs/**/SKILL.md`. (For `e3`, the SKILL.md is more complete than the index.)
3. **Export barrels + built `.d.ts`** (compiler truth — the ONLY step that reaches the index/SKILL blind-spot libs: `east-c`, `east-node-cli`, `e3-*` internals, `east-py-std/io`, dev-tooling):
   ```bash
   rg -n "export (const|function|class|interface|type) <Name>" libs/*/src/index.ts libs/*/packages/*/src/index.ts
   rg -n "\.<method>\(" libs/*/src libs/*/packages/*/src        # expression/stdlib methods not in barrels
   ```
4. **In-flight work** — don't duplicate an open issue/PR:
   ```bash
   gh search issues --repo elaraai/east-workspace "<capability>" --state all
   gh search prs    --repo elaraai/east-workspace "<capability>" --state all
   ```
5. **The issue's own root-cause pointer** — if it cites `file:symbol`, start there.

**Capability-ownership map** — which lib owns a concern, and how to confirm coverage. It routes to the sources above (never restates signatures) and explicitly covers the libs the index/SKILL.md miss:

| Capability domain | Owning lib / package | Skill | Confirm via |
|---|---|---|---|
| Language core: types, expressions, collections, variants | `libs/east` | `east` | index / SKILL |
| File / HTTP / time / crypto (Node) | `east-node-std` | `east-node-std` | index / SKILL |
| SQL / NoSQL / S3 / formats / transfer | `east-node-io` | `east-node-io` | index / SKILL |
| Durable dataflow, datasets, CLI, content-addressing | `libs/e3` (e3-core/cli/types/api-*) | `e3` | SKILL + grep `libs/e3/packages/*/src` |
| ML / optimization / Bayesian / simulation (Python) | `east-py-datascience` | `east-py-datascience` | index / SKILL |
| Python runtime / std / io | `east-py{,-std,-io}` | `east-py*` | SKILL + grep (not indexed) |
| C runtime / IR execution / serialization | `libs/east-c` | — | grep `libs/east-c/**/src` + headers; `make compliance` |
| UI components / tags / dashboards / decision surfaces | `east-ui`, `e3-ui` | `east-ui` / `e3-ui` | index / SKILL |
| Dev tooling: diagnostics, eslint/tsserver plugin, scaffolds, Claude plugin | `east-diagnostics`, `eslint-plugin-east`, `tsserver-plugin-east`, `create`, `east-claude-plugin` | — | grep that lib's `src` + README |

If a near-match exists, **extend/reuse it** rather than adding a parallel implementation. If a genuinely new capability is needed, place it in the lib that owns the concern (dependency order: `east` → `east-node`/`e3`/`east-ui`; `east-c`/`east-py` consume exported IR). **Record what you searched in the PR body** so review can see duplication was checked. Adding a capability = "register" it: add the `example()` (auto-flows into the index via CI — §6/§8), update the lib SKILL.md table, and add a row here only if a new package/domain appeared.

## 3. Tooling — make East diagnostics real

Plain `tsc` cannot see East idiom mistakes (hand-rolled variants, `some/none`, redundant casts, untracked data, JSX-vs-factory, …). Those are caught by **east-diagnostics**, surfaced three ways: the Claude plugin LSP (injects an `<east-code-review>` block after edits), `@elaraai/tsserver-plugin-east` (editor squiggles), and `@elaraai/eslint-plugin-east`'s `east/east-rules` in CI (`make lint`).

**Critical caveats — do not assume the squiggles will save you:**
- The auto-injection only fires for files that (a) end `.ts/.tsx/.js`, (b) literally contain the import substring `@elaraai/east`, and (c) sit in a detected East project. **At the monorepo root it may not fire at all.**
- Diagnostics on **first-party `libs/*/src/`** are intentionally **skipped** (lib factories legitimately use the flagged patterns). That is exactly where most issue fixes live — so for a typical fix you get **no squiggles**.
- Therefore: **the authoritative pre-commit gate is `make lint`** (runs `east/east-rules` over a real TS program) plus `make build` (native type errors). Treat a clean `make lint` + `make build` + every injected `<east-code-review>` item fixed as the gate. **Never silence a diagnostic** by adding it to `disabled` — fix the code.

A project wires the tooling via `tsconfig.json` `compilerOptions.plugins: [{ "name": "@elaraai/tsserver-plugin-east" }]` + the eslint plugin with type-aware linting (`projectService: true`). Scaffolds from `npm create @elaraai/{e3,east}` ship both preconfigured — never re-add. (In VS Code, the tsconfig plugin loads only when the **workspace** TypeScript version is selected.)

The 13 active East rules to satisfy (README lists 12; `no-untracked-east-data` is also active): `no-redundant-east-cast`, `prefer-explicit-east-type`, `prefer-some-none`, `no-handrolled-variant`, `no-east-namespaced-type`, `prefer-let-const-over-east-value`, `no-relative-src-import`, `no-let-const-in-expression`, `no-unexecuted-east-expression`, `no-reinlined-east-binding`, `no-east-data-builder-helper`, `prefer-jsx-over-factory-call`, `no-untracked-east-data`.

## 4. Reproduce (bugs) / design (features)

**Bug:** run the issue's reproduction and confirm the failure *before* editing — it proves the claimed root cause and prevents a wrong fix. Put a scratch repro under the owning lib's `test/` (or a temp file) using that lib's import convention (§6) so you don't trip `no-relative-src-import`.

**Feature:** implement the issue's `## Decision (design)` as written; don't invent an alternative API. If the design is ambiguous, ask rather than guess.

## 5. Implement — src + TypeDoc + interop rules

Edit the source. **Every public API you add or change MUST carry a TypeDoc comment** (the #1 mandatory gate in every `STANDARDS.md`): present tense, verb-first; `@param name - description` and `@returns description` with **no types** (TS infers them); `@typeParam`; `{@link Symbol}`; `@internal`/`@deprecated` as needed.

`@throws` form is keyed on location: **expression classes** (`src/expr/`, `src/expr/libs/`) use prose `@throws East runtime error if …`; **regular classes** use `@throws {ErrorType} …`; **east-node platform fns** use `@throws {EastError}` with the exact user-facing message.

`@example` form is also keyed on location: **expression classes** use the full `East.function(...) → East.compile(...) → execution` flow with inline `// result` comments and one `const compiled =`, and must be validated with the `east_compile` MCP tool until they compile; **regular classes** use plain realistic usage (no `compile()`).

### East interop (absolute — these break silently, invisible to tsc)

**TypeScript** (`docs/conventions/EAST_TS_INTEROP.md`):
- Runtime type check: `isValueOf(v, T)` — never `typeof`/`instanceof`. (Integer is `bigint`, variants are tagged structs, DateTime is not a JS `Date`.)
- Equality/order: `equalFor(T)` / `lessFor(T)` / `compareFor(T)` — never `===`/`<`/`>`. Sorted containers: `new SortedMap(compareFor(KeyType))`, `arr.sort(compareFor(T))`.
- Construct variants/options: `variant("Tag", data)` / `some(x)` / `none` — **never** hand-roll `{ tag, data }`. (No exceptions.)
- Declare vars in an `East.function` block with `$.const(value, Type)` (immutable) / `$.let(value, Type)` (mutable). The 2nd arg is the **East type, not a name** — there is no name parameter. Prefer these over `East.value()`. Wrap external TS values with `East.value()`/`$.const()` before calling East methods on them.

**Python** (`docs/conventions/EAST_PY_INTEROP.md`):
- `compare_for`/`equal_for`/`less_for`, `make_east_key(T)` for `sorted(...)` — never raw `<`/`==`/`sorted`.
- `variant("case", value, Type)` / `some` / `none` — never a `{"type","value"}` dict; read deserialized options with `is_east_variant` (`opt.type == "some"/"none"`), **not** `is_east_option`.
- **Never reimplement an east-c builtin** — delegate (`arr.sorted()`, `s1.union(s2)`, `East.String.upper_case(s)`, `East.Integer.divide(a,b)`, `East.Float.sqrt(x)`). Python `//` ≠ East IntegerDivide.
- Coerce/validate at the boundary: `coerce_to(raw, Type)` / `assert_value_of(result, output_type)`; let `@platform_function(output=...)` validate. Integer-vs-Float comes from the **declared** type (a Float-intended `3` → `3.0`).

**Python optional native deps** (`docs/conventions/PYTHON_OPTIONAL_DEPS.md`): module-level `find_spec` guard + `_check_<mod>_support()` raising `NotImplementedError`; **bare-import the native lib inside each impl function** (no top-level import, no `try/except ImportError`); add the extras group + two `[[tool.mypy.overrides]]` blocks; update the parent package's CLAUDE.md `## Modules` table.

### Development rules (hard — non-negotiable; the silent ones reviewers miss)

These break nothing at first and rot later. They are not style preferences — each one shipped as a real bug in this repo.

- **Decode/value TS types: DERIVE from the East type, never hand-roll.** When an East type exists (`Foo.Types.Bar`, `BarType`), type its decoded JS shape as `ValueTypeOf<typeof Foo.Types.Bar>` (or `ValueTypeOf<typeof BarType>`, index a list with `[number]`). **Never** hand-author a parallel `interface BarValue { … }` mirror, and never invent local aliases like `type Opt<T> = {type;value}` / `type Var<K,V> = {type:K;value:V}` to stand in for `OptionType`/`VariantType`. A hand-rolled mirror silently drifts the moment the East type gains a field — a renderer's hand-rolled `ConfigValue` missed three new config fields this way and nobody's compiler complained. The host-app renderer convention (`east-ui-components/CLAUDE.md`) is explicit: props are typed `ValueTypeOf<typeof Foo.Types.Foo>`.
- **Variants/options: CONSTRUCT with `variant()` / `some` / `none`, TYPE with `ValueTypeOf`.** Never a `{ type, value }` object literal (it lacks the encoder symbol the runtime needs — see `[[never-hand-roll-variants]]`), never a hand-rolled variant *type*. This applies in TS *and* in factory/renderer code that builds East values to pass to a component.
- **Styling (east-ui-components / e3-ui-components renderers): theme recipes ONLY, zero inline styles.** All styling flows through `theme/recipes` (`useRecipe`) / `theme/slot-recipes` (`useSlotRecipe`) via the call-once-then-spread-slot idiom. **Never** `style={{…}}` and **never** inline Chakra style props (`bg` / `color` / `p` / `gap` / `fontFamily` / `minW` / `borderColor`…) — they bypass the design system and rot against `design/`. If a styled element has no recipe, **add a slot recipe** encoding the `libs/east-ui/design/spec.css` tokens (semantic tokens like `bg.surface`, `border.subtle`, `bg.brand.subtle` — never raw hex/px). Genuinely-dynamic data bindings (`width={pct}`, `bg={toneToken(kind)}`) are the only inline exception. Pre-existing inline-style debt nearby is not licence to add more — flag it, don't replicate it.
- **Before trusting a downstream type error, rebuild the chain.** A renderer type-checking a *stale* `dist` of its IR package (because the IR build `noEmitOnError`-aborted on an unrelated example) will silently miss new fields. After changing an IR type, build the IR package to **success** before believing the renderer compiles (see §7's stale-tree rule).

## 6. East code in examples + tests (HARD RULE)

**Every distinct public method exercised by a `*.spec.ts` MUST have a matching `example()` export in the sibling `*.examples.ts`** (name-locked: `array.spec.ts` ↔ `array.examples.ts`, same dir). Examples are both CI-tested and extracted into the plugin search index — a missing example breaks the index-in-sync CI check.

**Import discipline (the one contradiction to get right):**
- **Core `libs/east` `*.spec.ts`** import from `../src/index.js` (a package cannot import its own published name). This is the *only* place `../src` is correct; the `no-relative-src-import` rule does not fire there because diagnostics skip first-party `src/`.
- **Core `libs/east` `*.examples.ts`** AND **all downstream** (`east-node-*`, `east-ui`, `e3-ui`) spec **and** examples import the **published name** (`@elaraai/east`, `@elaraai/east-node-std`, …). Never `../src` in downstream.

`example({ keywords, description, fn, inputs, returns })`: `keywords` (search terms — API names, types, concepts), `description` (also the test name), `fn` (an `East.function(...)`), `inputs` (`[]` for zero-arg), `returns` (**hand-verify it**). **Omit `returns` only** for `NullType` (side-effect) or `UIComponentType` — omitting it elsewhere makes the harness run `fn` as a bare statement and the assertion false-passes. Wire with named keys, placed before the related test: `assert.examples(test, { arrayGet: ex.arrayGet })` (downstream uses `Assert.examples`). Import examples with the `.js` extension: `import * as ex from "./array.examples.js";`.

Copyable skeleton (downstream package; for core `east` keep the `@elaraai/east` import in the examples file too):

```ts
import { East, ArrayType, IntegerType, example } from "@elaraai/east";

export const arraySum = example({
    keywords: ["array", "ArrayType", "sum"],
    description: "sums an array of integers",     // becomes the test name
    fn: East.function([], IntegerType, ($) => {
        const a = $.const([1n, 2n, 3n], ArrayType(IntegerType)); // explicit East type
        return a.sum();
    }),
    inputs: [],
    returns: 6n,                                   // hand-verified; omit ONLY for NullType/UIComponentType
});
```

**Per-lib test conventions** (read the lib's `STANDARDS.md` for specifics):
- **east**: one file per type at `test/<name>.spec.ts`; `import { describeEast as describe, assertEast as assert } from "./platforms.spec.js"`; bodies are East functions; `assert.equal/notEqual/throws` via `$(...)`.
- **east-node** (std/io): co-located `src/<mod>.spec.ts`; `import { describeEast, Assert } from "./test.js"`; pass platform impls via `{ platformFns: ModuleImpl }`; public modules use the **Grouped Export Object** (`{ ...fns, Implementation } as const`); use `East.compileAsync()` if any impl is async.
- **e3**: co-located `src/<x>.spec.ts` with `node:test` + `node:assert`; **real filesystem only — never mock fs**; fresh `mkdtempSync` per test, cleaned in `afterEach` even on failure; cover happy/edge/error/atomicity/round-trip; atomic writes = temp-file + rename (retry transient Windows `EPERM/EACCES/EBUSY/EEXIST`).
- **east-py-datascience** (hybrid TS+Python): TS holds **types + tests only**, Python holds impl — and the East types must match **exactly** across both. TS specs set `{ exportOnly: true }`, import `describeEast`/`Assert` from `@elaraai/east-node-std`, no `platformFns`. Its **examples are `*.examples.ts` (TS), not Python.** Plain `east-py`/`east-py-std`/`east-py-io` are skill-file-only with pytest tests and **no `*.examples` requirement**.
- **east-ui / e3-ui**: two layers — public JSX **tags** (`@elaraai/east-ui`) desugar to the **same IR** as internal **factories** (`@elaraai/east-ui/internal`). Every compilable `@example` is mirrored by an `example()` in `*.examples.tsx` wired via `Assert.examples`. Omit `returns` for `UIComponentType`; **all `State.*` must live inside `<Reactive>`'s inner builder** (else the fn becomes async and the analyzer rejects it); store callbacks in `$.const`. **Visual verification is mandatory**: after a component/example change, `cd libs/east-ui && make east-ui-examples-html-<key>` and Read the PNG. e3-ui follows east-ui's `STANDARDS.md` verbatim.

## 7. Verify — the gate

**Always `make`, never `npm run`/`pnpm run`.** (The "Before committing" checklists inside the `STANDARDS.md` files literally say `npm run test`/`npm run lint` — that wording is **superseded** by the monorepo `make` convention.) Raw pnpm only for `pnpm install <dep>`, `pnpm -r run`, or `pnpm --filter … run …` while debugging.

```bash
make build      # ALWAYS before test — tests resolve imports through each package's dist/; stale dist = stale test
make test
make lint       # the authoritative East-idiom gate (east/east-rules) + ruff + clang-format
# scope to one lib while iterating:
cd libs/<lib> && make build && make test && make lint
cd libs/<lib> && make help        # lib-specific extras (e3: make fuzz; east-c: make compliance; east-py: make typecheck/check/coverage)
```

- **Local `dist/` is gitignored + built locally — a stale tree FAKES regressions.** Each package's `dist/` lags the *pulled source*, so a half-built tree throws phantom errors in files you never touched: a new export missing from `east/dist`, an `implicit-any` on a test `$`, a `value is not iterable` in beast2 serialization, an unresolved import. **When a build/test fails in a file you did not edit, suspect a stale tree FIRST** — don't blame your change. Before concluding anything is broken: **clean-rebuild the entire dependency chain** (`make clean && make build`, or at minimum `rm -rf` the `dist/` + `*.tsbuildinfo` of east → east-node → e3 → east-ui and rebuild them *in order*), and run **`pnpm install`** (a declared dep like `leaflet` may be unfetched). Then prove any remaining failure is pre-existing by stashing your diff (`git stash`) and re-running — a failure identical with your changes absent is not yours.
- **Integration tests** (east-node-io, east-py-io) need Docker: `make services-up` … `make services-down` (or `make test-all` for the full sweep).
- **east-c / east-py compliance** replay TS-exported IR — run `make test-export` first (root export → `/tmp/east-test-ir/`; datascience exports to `/tmp/east-py-datascience`). Then `cd libs/east-c && make compliance` / `cd libs/east-py && make check`.
- **Address every injected `<east-code-review>` diagnostic** and every downstream lib in the blast radius.
- **Cross-platform**: CI runs east/east-c/east-py/east-node-std/create on ubuntu + macos-14 + windows-latest under Git Bash. Don't assume Linux-only paths, `/tmp`, `MAX_PATH`, or `cmd.exe` shell.

## 8. Sync docs + regenerate the plugin index

If you changed public API: update that lib's `SKILL.md` API tables + decision tree **and** the companion `*.examples.ts`, in lockstep. Keep `SKILL.md` self-contained (three-column `Signature | Description | Example`, bold category headers, `❗` on throwing ops, no links to sibling `reference/` files). **Coordinate before editing a lib `SKILL.md` — they back the published plugin skills (the plugin symlinks to them).**

If you touched **any** `libs/**/SKILL.md`, `*.examples.ts(x)`, or the plugin `lib/hooks/mcp`, regenerate and **commit** the artifacts (CI `plugin-artifacts` fails on a diff):

```bash
cd libs/east-claude-plugin && make index && make build   # regenerates index.json + .build/
# commit BOTH libs/east-claude-plugin/index.json AND libs/east-claude-plugin/.build/ (.build/ IS git-tracked)
```

(Authoring a *new plugin-native skill* like this one is directory-based: drop `skills/<name>/SKILL.md`, add it to the repo-root `CLAUDE.md` "plugin-native" list; do **not** edit `plugin.json`/`marketplace.json`/`index.config.json`, and it does not feed the search index.)

## 9. Branch → commit → PR (only after approval)

Implement and verify first. Then **stop and present the branch/commit/PR plan**; run `git`/`gh` only when the user explicitly approves the push (harness rule: commit/push only when asked).

- **Start from a fresh `main` by default.** Before beginning a new issue, `git checkout main && git pull`, *then* branch off it — otherwise you risk starting on a stale or already-merged feature branch you previously worked on, silently building/testing against a tree behind `origin`. (After pulling, the local `dist/` lags the fresher source, so clean-rebuild per §7.) **Exception:** when the developer explicitly tells you to continue on the current working branch — e.g. to add a change to an open PR — stay on it: do NOT `checkout main` / `pull` / `reset`, just keep committing to that branch.

- **Branch** off main: `elaraai/<type>/<slug>` (e.g. `elaraai/fix/e3-statestore-windows-rename-retry`). Never commit to main.
- **Commit**: Conventional Commits with a lib scope — `fix(e3): …`, `feat(east-ui): …`, `test(e3): …`, `chore(east-claude-plugin): …`. Reference the issue in the body (`Fixes #N`). End every commit with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **PR**: `gh pr create` with a body mirroring the issue's sections (`## Summary` / `## Root cause` / `## Fix` / `## Test` / `## Scope`) and **`Closes #<n>`** so merge auto-closes it. End the PR body with the Generated-with-Claude-Code line. Note in the body what you searched in §2 (anti-duplication) and which downstream libs you verified.

```bash
git checkout -b elaraai/fix/<slug>
git commit            # message per above
gh pr create --repo elaraai/east-workspace --title "fix(<lib>): …" --body "…Closes #<n>…"
```

## Common traps

- **A new client-side UI platform function won't reach `ui()` tasks.** When you add an interactive platform function to **east-ui-components** (a `State.bind` / `nav_bind` / `Slice.bind` style runtime — e.g. `src/platform/nav/index.ts`), it self-registers at module load via `registerPlatformImplementation(MyImpl)`. That only populates east-ui-components' **registry** (`getRegisteredPlatformImplementations`), which **east-ui's own** reactive hooks read — so it works in a standalone east-ui preview/spec and looks done. But **e3-ui-components renders `ui()` tasks through HARD-CODED platform arrays that do NOT read that registry.** A function you forget to add there throws **`Platform function 'X' is not available`** (Region: `tasks.<task>.output.ReactiveComponent.<Component>`) — but *only* inside an e3 `ui()` task, so component/preview tests pass and the gap ships silently.
  - **Fix — add `...MyImpl` to BOTH explicit arrays in `libs/east-ui/packages/e3-ui-components/src`:**
    - `components/UITaskPreview.tsx` — the `scopedPlatforms` memo (`[...StateImpl, ...createScopedBindPlatform(manifest), ...createScopedFuncPlatform(…), ...createScopedRecordPlatform(…), ...OverlayImpl]`).
    - `hooks/useDatasetValue.ts` — `[...StateImpl, ...BindPlatform, ...OverlayImpl]`.
  - Import the impl from `@elaraai/east-ui-components/platform`. **Manifest-scoped** functions (data/func/record) go in via their `createScoped*(manifest…)` builder; **browser-local-state** functions (State, nav, overlay, slice) go in **unscoped**, alongside `...StateImpl` / `...OverlayImpl`.
  - Grep guard before you call a UI platform fn done: `rg -n "MyImpl" libs/east-ui/packages/e3-ui-components/src` must hit `UITaskPreview.tsx` **and** `useDatasetValue.ts`, not just the registering module.
  - **Also rebuild + reinstall the `east-ui-preview` VS Code extension** — its webview bundles e3-ui-components, so a deployed package using the new fn renders blank / errors until the extension itself ships the array change. A version bump alone is not enough.

## Do NOT

- **Bump versions.** All `@elaraai/*` share one version; `version-drift` (`make check-version`) fails on any drift. Releases are a separate `make set-version` / `chore: release vX.Y.Z` flow — not issue work.
- **Edit `e3-cloud` (east-aws)** — it's a separate closed-source repo. A fix reaches it only after a workspace release + lockstep update; say so in the PR rather than trying to change it.
- **Implement past the issue's scope** — honor `Defer` checklists.
- **Silence diagnostics** instead of fixing them; **mock the filesystem** in e3 tests; **hand-edit a lib `SKILL.md`** without coordinating.

## Related skills

- **east-design** / **east-project** — for building *with* East (the opposite direction from this skill).
- **east**, **e3**, **east-node-std**, **east-node-io**, **east-py***, **east-ui**, **e3-ui** — the per-package API skills; load the one for the lib you're changing.
- **Canonical docs** (read the authoritative source, don't rely on this summary): `docs/conventions/{EAST_TS_INTEROP,EAST_PY_INTEROP,EXAMPLES_AUTHORING,MAKEFILE_TARGETS,PYTHON_OPTIONAL_DEPS,SKILLS_STANDARD}.md` and each `libs/<lib>/STANDARDS.md` + `CLAUDE.md`.
