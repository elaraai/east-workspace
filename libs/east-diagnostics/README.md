# East Diagnostics

> East-aware diagnostic rules over the TypeScript checker

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Diagnostics** is the shared rule engine that catches East-specific
mistakes which plain TypeScript can't — the same checks surfaced to the agent at
write-time (the Claude plugin daemon) and to developers in the editor and CI
([`@elaraai/eslint-plugin-east`](../eslint-plugin-east)). The rules run against a
real `ts.Program`, so they are type-aware, not regex heuristics.

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
- **`no-handrolled-variant`** - A plain object literal where an East variant/option is expected.
- **`no-east-namespaced-type`** - `East.IntegerType` etc. instead of a bare import.
- **`prefer-let-const-over-east-value`** - `East.value(…)` declared or returned inside an `East.function` block.
- **`no-relative-src-import`** - Importing `../src/…` instead of the published package name.
- **`no-let-const-in-expression`** - `$.let`/`$.const` used anywhere other than a `const`/`let` initializer, a bare statement, a `return`, or a concise arrow body (e.g. a struct-field value, array element, call argument, or chain target buries the declaration in an expression).
- **`no-unexecuted-east-expression`** - A bare East expression statement that is never executed with `$( … )` or bound.
- **`no-reinlined-east-binding`** - An East `Expr` bound to a JS `const`/`let` and reused inside a block is re-inlined per use — bind it once with `$.let`/`$.const`.
- **`prefer-jsx-over-factory-call`** - In a `.tsx` file, a factory's `Foo.Root(...)` whose result is a JSX element — author it with the `<Foo>` tag instead.
- **`no-untracked-east-data`** - A bare JS `const` literal consumed in an East-typed position inside a block — bind it with `$.const`/`$.let`.

### Host-vs-East

These share one principle: **inside an East block the code must be East all the way down, and the host language may *declare* an East/e3 program but never *compute* its data-dependent IR, keys, or values.**

- **`no-host-in-east-block`** - Inside an East block, any host-language construct: a host call (a local TS helper, a JS builtin, a JS Array method), a TS closure/function *declaration*, a host operator on East operands (`a + b`, `cond ? a : b`, `&&`/`||`), host index access (`arr[i]` on a JS value), a JS `for`/`while`/`if` that emits IR, or host string interpolation. (East method chains, `$.*`, `East.*`/`Expr.*`, `variant`/`some`/`none`, `East.str`, and any `@elaraai/*` call are East and never flagged.)
- **`no-module-scope-east-macro`** - A module-scope TS helper whose every return builds East values/IR (`variant`/`some`/`none`/`East.value`/an `Expr` chain) or a composite string key (`(o, l) => `${o}|${l}``) — make it a real `East.function`, or model the data with typed keys / nested East structures.
- **`no-compile-time-data-injection`** - Build-time data ingestion (a `node:fs` import/call, `JSON.parse`, `process.env`) at module scope — load data at runtime via `e3.input` / datasets / platform tasks. (A genuine seed-time bootstrap with no East-side reader is an accepted warning.)

## Usage

```typescript
import * as ts from "typescript";
import { runEastRules, createDiagnosticsService } from "@elaraai/east-diagnostics";

// Pure: run the rules over one source file you already have a program + checker for.
const diagnostics = runEastRules(ts, program, sourceFile, checker, { disabled: ["prefer-some-none"] });

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
