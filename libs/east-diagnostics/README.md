# East Diagnostics

> East-aware diagnostic rules over the TypeScript checker

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Diagnostics** is the shared rule engine that catches East-specific
mistakes which plain TypeScript can't — the same checks surfaced to the agent at
write-time (the Claude plugin daemon) and to developers in the editor and CI
([`@elaraai/eslint-plugin-east`](../eslint-plugin-east)). The rules run against a
real `ts.Program`, so they are type-aware, not regex heuristics.

Every rule **self-gates on East-ness** — it fires only where there is genuine East
code (an East type/block, an `e3` construct, or an `@elaraai/*` import), so the set
is opt-in by installation and inert on plain TypeScript. There is no
package-identity allow/deny list; per-project suppression is the `disabled` option,
like any linter.

## Features

- **Shared rule set** - One engine, `runEastRules(ts, program, sourceFile, checker)`, reused across every surface.
- **Type-aware** - Rules consult the TypeScript checker (e.g. resolving `BlockBuilder`, variant contextual types).
- **No bundled compiler** - `typescript` is a peer dependency; the host's version is injected.
- **Diagnostics service** - `createDiagnosticsService()` resolves the nearest tsconfig, holds a warm `LanguageService`, and merges native type errors with the East rules for a file. Supports in-memory overlays for unsaved buffers.
- **Readable East type errors** - native TS assignability errors on East types are rewritten via east's structural type diff (`diffTypes`), so a mismatch deep inside a recursive type reads as one localized line instead of pages of restated generics. The project's own `@elaraai/east` is resolved at runtime, so the diff always matches the project's type semantics.
- **LSP server** - `runEastLsp()` serves the same diagnostics over the Language Server Protocol (stdio, zero dependencies), usable by Claude Code plugin `lspServers`, Neovim, or any LSP client.
- **tsserver plugin** - the `@elaraai/east-diagnostics/tsserver-plugin` entry decorates the editor's existing TypeScript language service (no second program), shipped to VS Code via the East UI Preview extension's `typescriptServerPlugins` contribution.

## Rules

### East-side idiom hygiene

- **`no-redundant-east-cast`** - Redundant TS type info on the value of `$.let`/`$.const` that the East type argument already governs — a cast (`as …`/`<…>`), `new Map<K,V>()` generics, or an `East.value(x, T)` wrapper.
- **`prefer-explicit-east-type`** - One-arg `$.let`/`$.const` on an under-determined value (`[]`, `{}`, `new Map()`).
- **`prefer-some-none`** - `variant("some"/"none", …)` instead of `some()` / `none`.
- **`no-handrolled-variant`** - A plain object literal where an East variant/option is expected — or, in a file that imports East, a `{ type, value }` literal with a string tag in any slot but a published API's own type (a declaration file's, like East's `Resolution`). A literal lacks the brand East tells a variant by.
- **`no-east-namespaced-type`** - `East.IntegerType` etc. instead of a bare import.
- **`prefer-let-const-over-east-value`** - `East.value(…)` declared or returned inside an `East.function` block.
- **`no-relative-src-import`** - Importing *another* package's internals via `../src/…` or a deep `@elaraai/x/src` path instead of its published name. (A package importing its **own** `src` relatively — e.g. a spec's `../src/index.js` — is exempt; it cannot import its own published name.)
- **`no-let-const-in-expression`** - `$.let`/`$.const` used anywhere other than a `const`/`let` initializer, a bare statement, a `return`, or a concise arrow body (e.g. a struct-field value, array element, call argument, or chain target buries the declaration in an expression).
- **`no-unexecuted-east-expression`** - A bare East expression statement that is never executed with `$( … )` or bound.
- **`no-reinlined-east-binding`** - An East `Expr` bound to a JS `const`/`let` and reused inside a block is re-inlined per use — bind it once with `$.let`/`$.const`.
- **`prefer-jsx-over-factory-call`** - In a `.tsx` file, a factory's `Foo.Root(...)` whose result is a JSX element — author it with the `<Foo>` tag instead.
- **`no-untracked-east-data`** - A bare JS `const` literal consumed in an East-typed position inside a block — bind it with `$.const`/`$.let`.

### Host-vs-East

These share one principle: **inside an East block the code must be East all the way down, and the host language may *declare* an East/e3 program but never *compute* its data-dependent IR, keys, or values.**

- **`no-host-in-east-block`** - Inside an East block, any host-language construct: a host call (a local TS helper, a JS builtin, a JS Array method), a TS closure/function *declaration*, a host operator on East operands (`a + b`, `cond ? a : b`, `&&`/`||`), host index access (`arr[i]` on a JS value), a JS `for`/`while`/`if` that emits IR, or host string interpolation. (East method chains, `$.*`, `East.*`/`Expr.*`, `variant`/`some`/`none`, `East.str`, and any `@elaraai/*` call are East and never flagged.)
- **`no-module-scope-east-macro`** - A module-scope TS helper whose every return builds East IR (an `Expr` chain, `East.value`, `variant`/`some` over an `Expr`), or a composite string key (`(o, l) => `${o}|${l}``) that feeds East data — make it a real `East.function`, or model the data with typed keys / nested East structures. A helper building decoded values over host data (a renderer's handler, a test's fixture) and a host storage key are host code, and pass.
- **`no-compile-time-data-injection`** - Build-time data ingestion (a `node:fs` import/call, `JSON.parse`, `process.env`) at module scope — load data at runtime via `e3.input` / datasets / platform tasks. (A genuine seed-time bootstrap with no East-side reader is an accepted warning.)
- **`no-compile-time-seed-data`** - Host-computed data passed as the seed (3rd arg) of `e3.input(name, type, variant('value', seed))` — a `new Map()`/array filled in place by host `for`-loops, or an object literal of host calls (`num(cfg.x)`, `BigInt(...)`) — bakes a build-time snapshot into the deployed program. The default must be a small *authored constant* (a literal, an empty/literal `Map`/`Set`/array/struct, or an East value `variant`/`some`/`none`/`East.value`) or omitted; load real/bulk data at runtime (a `BlobType` input parsed with `blob.decodeCsv(…)` in an `e3.task`, a platform `FileSystem.readFile`, or `e3.record` + `e3.mutation`).

### Deploy/runtime-failure classes that type-check clean

- **`require-runner-platforms`** - An `e3.task` calling PROJECT-declared platform functions (`East.platform("proj.x", …)` stubs) whose options declare no `runner.platforms` `{ custom: … }` entry — fails only at dataflow runtime with "Platform function … is not available".
- **`no-cross-block-builder`** - A nested East callback emitting bindings via an OUTER block's `$` (`xs.map((_$, x) => { $.let(…) })`) — the binding lands in the wrong block.
- **`no-state-outside-reactive`** - east-ui `State.*` outside a `<Reactive>` builder — the UI function becomes async at analysis time and is rejected at deploy.
- **`prefer-const-ui-callbacks`** - An `East.function` handler written inline in a JSX prop — rebuilt each render, and `equalFor` can't distinguish function values, so memoized renderers miss the swap. Bind once with `$.const`.
- **`no-dynamic-bind-path`** - A `Data.bind` / `State.bind` / `Navigation.bind` key computed from an East value — bind keys must be IR-build constants or the binding is missing from the `ui()` manifest.
- **`no-build-time-clock`** - `Date.now()` / argless `new Date()` at module scope of East/e3 source — the BUILD clock gets baked into the deployed program.
- **`no-handrolled-value-type-mirror`** - A hand-authored `interface Foo {…}` mirroring an in-scope East type value `FooType`, an `as { type: …; value: … }` assertion, or a `*Like` interface or type literal over East types — derive it with `ValueTypeOf<typeof FooType>` so it can't drift, and narrow a decoded union on its tag. A factory's options interface (`SubtypeExprOrValue<…>` members) is an input, not a mirror, and passes.
- **`no-host-comparison-on-east-values`** - `===`/`<` on decoded East values, and a sort comparator that subtracts them — use `equalFor(T)` / `compareFor(T)`, or `Object.is(a, b)` where you mean the same object (a memo, a cache).
- **`require-example-returns`** - An `example()` without `returns` (for a non-`NullType`/`UIComponentType` output) — the harness runs the fn as a bare statement and the assertion false-passes.
- **`no-duplicate-definition-name`** - Two same-kind e3 definitions sharing a name string in one file — they collide at deploy time.
- **`no-inline-credentials`** - A literal string credential (`password`, `secretAccessKey`, `token`, …, directly or wrapped in `some(…)`/`variant("some", …)`) in East/e3 source — the IR is content-addressed, exported, and replicated, so a secret in it is effectively unredactable. Use `Env.get("NAME")` (east-node-std) and supply the value per environment. Credentials paired with a localhost host/endpoint (test containers) are exempt.

### Host code holding decoded East values

A renderer, a runtime or a test holds East values once East has decoded them,
and each rule here flags a JavaScript stand-in for one of East's utilities.
Each stand-in type-checks clean, and several hid real bugs in the renderers
(#960, #962).
A value is recognised by where its type comes from — a `ValueTypeOf` struct, a
member carrying `[variant_symbol]`, a `SortedSet` / `SortedMap`, or a field,
payload or element read out of one — never by a name list. `hostValueRuleNames`
names the set (with `no-host-comparison-on-east-values`,
`no-handrolled-value-type-mirror`, `no-handrolled-variant` and
`prefer-some-none`), for a caller running only these with `only`.

- **`no-host-print-of-east-values`** - `String(x)`, `x.toString()`, `` `${x}` ``, `JSON.stringify(x)`, `x.toISOString()` on a value JavaScript prints differently from East — a Float, a DateTime, a Blob, a struct, a variant, a collection. Use `printFor(T)`, or the locale formatters for a person. A String, an Integer and a Boolean print the same either way, and a number written as a CSS length (`` `${w}px` ``) is style, not a print.
- **`no-host-parse-to-east-values`** - `BigInt(s)`, `Number(s)`, `parseFloat(s)`, `parseInt(s)`, `new Date(s)`, `Date.parse(s)` or `JSON.parse(s)` reading text into an East slot — an East function value's argument, a variant's payload, a struct's field. Use `parseFor(T)` and act on its `success`. Text written in the source is its author's, save a zoneless date-time, which `new Date` reads in local time.
- **`no-js-type-dispatch-on-east-values`** - `typeof x` or `x instanceof C` on an East value — dispatch on its East type (`isValueOf(x, T)`) or its variant tag.
- **`no-js-collection-for-east-collection`** - A JavaScript `Set` / `Map` keyed by structs, variants or DateTimes landing in an East Set, Dict or variant payload — it finds a key by identity, so an equal key never finds its entry. Use `SortedSet` / `SortedMap` with `compareFor(K)`. String, Integer, Float and Boolean keys are East's own idiom and pass.

## Usage

```typescript
import * as ts from "typescript";
import { runEastRules, createDiagnosticsService, hostValueRuleNames } from "@elaraai/east-diagnostics";

// Pure: run the rules over one source file you already have a program + checker for.
const diagnostics = runEastRules(ts, program, sourceFile, checker, { disabled: ["prefer-some-none"] });

// Only the rules over host code holding decoded East values.
const hostValues = runEastRules(ts, program, sourceFile, checker, { only: hostValueRuleNames });

// Or let the service resolve the project and merge native + rule diagnostics.
const service = createDiagnosticsService();
const text = service.diagnoseText("/path/to/file.ts"); // "" when clean
```

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
