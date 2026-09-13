# Design: East-aware diagnostics (editor + agent + CI)

## Goal

Give East code a single set of **East-specific diagnostics** that are:

- **Visible to developers in VS Code** — native squiggles + Problems panel +
  quick-fixes, identical in feel to TypeScript errors.
- **Fed to the agent preemptively** — injected at write-time (the
  `<east-code-review>` block) so a mistake is one local fix while intent is
  loaded, instead of the expensive build-time loop (build fails → re-read →
  re-locate → reconstruct → maybe MCP-search → fix → rebuild), where errors
  also compound into cascades.
- **Enforced in CI.**

…all from **one shared rule module**, so the rule logic is written once and
never diverges across surfaces.

This replaces the current `post-write` regex "code review", which has proven
false positives (flags valid `$.return(...)`; demands an optional type arg on
`$.let`) that make the agent "fix" correct code.

## What we measured (evidence, not assumption)

A real `ts.LanguageService` per package tsconfig, timing cold load and warm
(post-edit, incremental) diagnostics for a single edited file. TS 5.9.3.

| Package | Files in program | Cold (load+check) | Warm edit #1 | Warm edit #2 |
|---|---|---|---|---|
| east (core) | 173 | 2711 ms | 874 ms | 728 ms |
| east-ui (biggest) | 433 | 1531 ms | 405 ms | 383 ms |

→ Warm re-checks (0.4–0.9 s) fit a hook budget; cold load (1.5–2.7 s) must
happen in a **resident** process, never per-edit.

### Proven taxonomy (synthetic snippets, real checker verdicts)

| Pattern | Native verdict |
|---|---|
| `East.IntegerType` | **ERROR** `Property 'IntegerType' does not exist on type '{…}'` |
| `$.let("hello", IntegerType)` | **ERROR** `Argument of type 'string' is not assignable to 'bigint \| Expr<IntegerType>'` |
| `$.return(East.value(1n))` | no diagnostic — old hook **wrongly** flags |
| `$.let(East.value(1n))` (1-arg) | no diagnostic — old hook **wrongly** flags |
| `$.let([] as number[], ArrayType(FloatType))` | no diagnostic — redundant cast is a **non-type idiom** |

So: most old "checks" are already native type errors (free, and already shown
in the editor); the only thing the type checker can't see is **idioms** — the
home for the custom rules below. The `East.IntegerType` message also dumps the
entire `East` object type → diagnostics must be **truncated** when surfaced.

## Architecture: one rule module, three wrappers

The rule logic is engine-agnostic — a pure function over a parsed file and the
type checker. Write it once; wrap it for each surface.

```
                       ┌─────────────────────────────┐
                       │  east-diagnostics (shared)  │
                       │  (sourceFile, checker) =>    │
                       │        Diagnostic[]          │
                       └──────────────┬──────────────┘
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                          ▼
   tsserver plugin            headless daemon              CI harness
   (VS Code extension,        (LanguageService the         (LanguageService,
    contributes.              hook queries over a           run rules, exit
    typescriptServerPlugins)  socket; warmed at             non-zero on error)
            │                  SessionStart)                     │
            ▼                         ▼                          ▼
   developers see native      agent gets <east-code-review>  pnpm lint / CI gate
   squiggles + quick-fixes    injected at write-time
```

### Shared rule module (`east-diagnostics`)

- Pure: `runEastRules(sourceFile: ts.SourceFile, checker: ts.TypeChecker,
  options) => EastDiagnostic[]`. No I/O, no tsserver/eslint coupling.
- Each rule is a small AST visitor that may consult the checker
  (`getTypeAtLocation`, `getResolvedSignature`).
- Emits `{ start, length, messageText, category, code, fix? }`.
- Unit-tested with fixtures via a thin `ts.createProgram` harness.

### Wrapper 1 — tsserver plugin (the editor surface)

- A `ts.server.PluginModule` that proxies the host LanguageService and merges
  `runEastRules(...)` output into `getSemanticDiagnostics`, plus
  `getCodeFixesAtPosition` for rules that carry a fix.
- Shipped via a VS Code extension declaring **`contributes.typescriptServerPlugins`**
  so VS Code injects it into its own tsserver on install — no "use workspace
  TypeScript version" step, no per-project tsconfig edit. (Same mechanism as
  Angular / Vue / styled-components plugins.) The repo already ships
  `libs/east-ui/packages/east-ui-extension`, so there is precedent + infra.
- Result: developers see **heaps of East checks as native squiggles + Problems
  + quick-fixes**, only by installing the extension. This is the editor opt-in.

### Wrapper 2 — headless daemon (the agent surface)

- Resident process holding `Map<tsconfigPath, ts.LanguageService>`; per request
  returns native sem+syn diagnostics for the file **plus** `runEastRules(...)`.
- `PostToolUse(Edit|Write)` hook = thin client: gate (isEast project + .ts/.tsx/.js
  + file imports `@elaraai/east`) → connect (autostart if absent) → send file →
  format `<east-code-review>` → inject. Self-limits to ~3 s; **silent no-op if
  not warm** so it never blocks.
- `SessionStart` spawns the daemon detached and preloads the project at cwd, so
  first edits are warm. (Why a daemon: a LS plugin lights up the editor's
  tsserver, but the hook can't attach to that private process; and per-edit
  `tsc` pays the 1.5–2.7 s cold cost every time.)

#### Daemon specifics (monorepo)

- Confirmed: standalone tsconfigs, **no** project references / `composite` /
  `paths`. Cross-package `@elaraai/*` types resolve via pnpm workspace symlinks
  → the dep's built `dist/src/index.d.ts` (`skipLibCheck: true`). **Deps must be
  built** or every import errors → detect once, degrade to a single notice.
- Per edited file: nearest enclosing `tsconfig.json` = project key. The parsed
  tsconfig's `fileNames` set the Program (respects each package's
  include/exclude). A just-created file outside that set is added to an ad-hoc
  "opened files" list merged into `getScriptFileNames`.
- PostToolUse fires after the write (file on disk) → invalidate the file's
  version, LanguageService re-reads from disk.
- Scope diagnostics to the edited file; truncate each message (~300 chars).
- Use the **project's own `typescript`** (resolve from the project dir) so the
  agent sees exactly what the dev/CI see.

### Wrapper 3 — CI harness

- `tsc` does **not** load LS plugins, so CI `tsc --noEmit` won't see the custom
  rules. A tiny harness builds a `LanguageService` (or reuses the daemon in
  `--check` mode), runs `runEastRules` across the project's files, prints
  `file:line` violations, exits non-zero on error-severity. Wire into
  `pnpm lint`. Native type errors stay covered by the existing `tsc` build.

## Rule catalog (locked)

Native type errors (mismatched literals, missing members like
`East.IntegerType`, wrong arity) are **not rules** — they come free from the
checker, show in the editor today, and are surfaced to the agent by the daemon.
The custom rules cover *valid TS that is bad East idiom*:

| Rule | Status | Flags | Basis |
|---|---|---|---|
| `no-redundant-east-cast` | ✅ done | `as T` / `<T>` on the **value** arg of `$.let`/`$.const` **when the East type arg is present** (fix: remove cast) | block.ts:1805/1809 — `NoInfer<T>` makes the 2nd arg drive inference; the cast is dead |
| `prefer-explicit-east-type` | ✅ done | one-arg `$.let`/`$.const` on an under-determined raw value (`[]`, `{}`, `new Map()`, `new Set()`); `all-raw-values` opt-in | `[East module signatures]`; let-2nd-arg nudge, scoped |
| `prefer-some-none` | ✅ done | `variant("some"\|"none", …)` instead of `some()` / `none` | interop §3 / `[never hand-roll variants]` |
| `no-handrolled-variant` | ✅ done | object literal where a variant/option is **contextually** expected | interop §3 / `[never hand-roll variants]` |
| `no-let-const-in-expression` | ✅ done | `$.let`/`$.const` used inline (arg, chain, operand) instead of bound to a `const` | legacy #12, generalized |
| `prefer-let-const-over-east-value` | ✅ done | `const x = East.value(…)` inside an `East.function` block | interop §4 |
| `no-relative-src-import` | ✅ done | `../src/…` or `@elaraai/*/src` imports instead of the package name | EXAMPLES_AUTHORING §2 |
| `no-east-namespaced-type` | ✅ done | `East.IntegerType` etc. — clear message vs the giant native error | already a native error |
| `no-unexecuted-east-expression` | ✅ done | a bare expression statement whose type is an East `Expr` (no `$(…)`, no bind) — has no effect | "called fn without `$()`" + "bare `East.value()`" gotchas; 0 native diagnostics |

**Dropped:**
- `prefer-compareFor` — SortedMap/SortedSet are not part of the East-authoring surface.
- `no-ts-helpers-in-east` — **evaluated and rejected.** A declaration returning an
  East `Expr` is structurally identical to every east-ui factory (`Button.Root`)
  *and* to legitimate user UI-composition helpers (`const statusBadge = (l) =>
  Badge.Root(…)`), which are good practice. No reliable signal separates the
  data-builder antipattern from valid composition; the common bad form (helpers
  returning raw values/`variant(…)`) is undetectable. Kept as a human-review item.

### `no-redundant-east-cast` (the new one) — precise spec

```ts
let: (<T>(expr: SubtypeExprOrValue<NoInfer<T>>, type: T) => ExprType<T>)   // 2-arg: type drives inference, cast on value is dead
   & (<V>(expr: V) => ExprType<TypeOf<V>>)                                  // 1-arg: East type inferred FROM value, a cast matters
```

- Match `CallExpression` whose callee resolves (via the checker, not just text)
  to `BlockBuilder.let` / `BlockBuilder.const`.
- If `arguments.length >= 2` **and** `arguments[0]` is an `AsExpression` or
  `TypeAssertionExpression` → warn + offer a fix that unwraps to the inner expr.
- Caught: `$.let([] as number[], ArrayType(FloatType))`. Not caught:
  `$.let([] as number[])` (1-arg — the cast is load-bearing there).

### `prefer-explicit-east-type` (let-2nd-arg, without the old noise)

- Target one-argument `$.let`/`$.const`.
- Via the checker, classify arg0: **raw JS value** (1-arg `<V>` overload) vs
  **already an East `Expr`**.
- Warn only for raw JS values, most strongly for under-determined ones; **stay
  silent when arg0 is an East expression** — `SKILLS_STANDARD.md` shows
  `$.let(arr.sum())` as correct, so a blanket rule re-creates the old noise.
- Config: `severity` (hint/warn), `rawValuesOnly` (default true) vs `always`.

## Build phases

1. ✅ **`east-diagnostics` shared module** + fixture tests — 9 rules.
2. ✅ **Daemon + thin PostToolUse client** — `daemon/server.js` (warm
   LanguageService over a Unix socket) + `hooks/diagnose.js` (lazy-spawns,
   degrades silently). Native diagnostics + shared rules, headless for the agent.
   The legacy regex `post-write.ts` is **deleted** — `diagnose.js` replaces it in
   `hooks.json`, which retires the old false positives (so the original "Phase 0,
   strip the bad checks" is moot).
3. ✅ **SessionStart warming** — `warmDaemon(cwd)` spawns the daemon early.
4. + 5. ✅ **Editor + CI via `@elaraai/eslint-plugin-east`** (`libs/eslint-plugin-east`).
   One type-aware ESLint rule (`east/east-rules`) bridges to `runEastRules` via
   typescript-eslint `parserServices` (`program` + checker). Surfaces in the
   editor through the ESLint VS Code extension **and** in CI through
   `eslint`/`pnpm lint` — one artifact, no tsserver plugin / VS Code extension
   (declined). The tsserver-LS-plugin route was evaluated and dropped (CJS/ESM +
   VS-Code-only verification; ESLint covers both surfaces with far less risk).
   Native TS errors stay `tsc`'s job; the plugin only surfaces East idioms.
6. **Grow the catalog** — remaining idiom rules. **Adoption:** wiring
   `east/east-rules` into the monorepo's own eslint configs would surface any
   pre-existing violations — audit per package before turning it on as a gate.

## Test strategy ("similar things to the badly working hooks")

Fixtures under `test/diagnostics-fixtures/`, asserted against the shared module:

- `East.IntegerType` → 1 error (native).
- `$.let("x", IntegerType)` → 1 error (native mismatch).
- `$.return(expr)` → **0** (regression guard for old false positive).
- `$.let(expr)` 1-arg on an East expr → **0** (regression guard).
- plain TS helper + East in one file → **0** unless a real type error.
- `$.let([] as number[], ArrayType(FloatType))` → 1 custom warning;
  `$.let([] as number[])` → **0**.
- `variant("some", x)` → 1 `prefer-some-none`.

Plus a budget test: warm `diagnose()` < ~1.5 s on east-ui.

## Risks / edge cases

- **Deps unbuilt** → import errors everywhere; detect once, single notice.
- **Huge messages** → truncate (proven necessary).
- **Excluded / brand-new file** → ad-hoc open in the daemon.
- **CI** → remember `tsc` won't load the LS plugin; the harness is the enforcer
  for custom rules.
- **Editor** → the extension's `typescriptServerPlugins` contribution avoids the
  workspace-TS-version caveat.
- **Daemon** → single-threaded request queue per project; idle-timeout to free
  memory; client respawns on stale socket.
- **TS version drift** → resolve `typescript` from the edited project.
