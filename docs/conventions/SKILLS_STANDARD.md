# Skills Documentation Standard

**This document defines the MANDATORY standards for creating skill documentation in East repositories.**

An agent following this standard will produce documentation that:
1. Enables accurate code generation by Claude Code
2. Integrates with the east-claude-plugin search index
3. Is verified by TypeScript compilation in CI

---

## Table of Contents

- [File Structure](#file-structure)
- [SKILL.md Format](#skillmd-format)
- [API Signature Tables](#api-signature-tables)
- [Examples and the Search Index](#examples-and-the-search-index)
- [TypeScript Configuration](#typescript-configuration)
- [Checklist](#checklist)

---

## File Structure

Each skill is backed by a single self-contained `SKILL.md` at the package
root. Detailed API surface and worked examples live **inline** in that
file; runnable examples live in the test suite as `*.examples.ts` and are
extracted into the plugin search index.

```
package-root/
├── SKILL.md                      # The whole skill: overview, decision tree, API tables, patterns
├── src/                          # Source code
├── test/ (or tests/)             # Unit tests + *.examples.ts (source of truth for examples)
├── tsconfig.json
└── package.json
```

There is **no** sibling `reference/` directory. The plugin installs only
`SKILL.md`, so anything a consumer needs must be reachable from inside
`SKILL.md` itself — relative links to sibling files (`./reference/...`,
`./USAGE.md`) break once the skill is dereferenced into the install cache.

---

## SKILL.md Format

SKILL.md is the entry point that Claude Code loads when the skill is activated.

**Requirements:**
- Keep it focused (Claude has context limits — aim under ~500 lines of prose)
- Carry the mandatory "Before writing code" section (below) right after the
  intro paragraph — the plugin's tests fail a skill without it
- Provide a decision tree for common tasks
- Inline the API surface (signature tables) and key patterns — do not link out to sibling files
- Include a quick start example

**Template:**

```markdown
---
name: <skill-name>
description: "<One sentence description. Triggers for: (1) ..., (2) ..., (3) ...>"
---

# <Package Name>

<One paragraph description of what this package does.>

## Before writing code — search the example index

<The mandatory section, verbatim from [the section below](#the-before-writing-code-section).>

## Quick Start

```typescript
import { ... } from "@elaraai/<package>";

// Minimal working example
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ <Category 1>
    │   ├─ <Task> → <Solution>
    │   └─ <Task> → <Solution>
    │
    ├─ <Category 2>
    │   └─ ...
```

## API Reference

<Inline signature tables — see [API Signature Tables](#api-signature-tables).>

## Key Patterns

### <Pattern Name>
```typescript
// Show correct usage
```

### <Common Mistake>
```typescript
// WRONG
...

// CORRECT
...
```
```

### The "Before writing code" section

Every skill carries this section, verbatim, right after its intro paragraph.
The plugin injects nothing into the agent's context (#654): the search is the
step, and the section is where the agent reads that at the moment it matters.

```markdown
## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.
```

---

## API Signature Tables

Inline the API surface directly in `SKILL.md`. **Precise argument names and types are critical** for agents to generate correct code.

### Table Format

Use this consistent three-column format:

```markdown
| Signature | Description | Example |
|-----------|-------------|---------|
| **Category Name** |
| `methodName(arg: ArgType): ReturnType` | What it does | `obj.methodName(value)` |
| `methodName(arg: ArgType): ReturnType` **❗** | What it does (can throw) | `obj.methodName(value)` |
```

### East Type System

**Function parameters vs method arguments:**

| Context | Type Pattern | Example |
|---------|--------------|---------|
| Function params | Always expressions | `($, x: IntegerExpr, arr: ArrayExpr<IntegerType>)` |
| Method args | `ExprType<T> \| ValueTypeOf<T>` | `arr.get(0n)` or `arr.get(indexExpr)` |
| External constants | Must wrap with `East.value()` or `$.const()` | `x.greaterThan(East.value(100n))` |

**Type mappings:**

| East Type | Expression Type | TypeScript Value (`ValueTypeOf<T>`) |
|-----------|-----------------|-------------------------------------|
| `IntegerType` | `IntegerExpr` | `bigint` |
| `FloatType` | `FloatExpr` | `number` |
| `StringType` | `StringExpr` | `string` |
| `BooleanType` | `BooleanExpr` | `boolean` |
| `DateTimeType` | `DateTimeExpr` | `Date` |
| `BlobType` | `BlobExpr` | `Uint8Array` |
| `ArrayType(T)` | `ArrayExpr<T>` | `ValueTypeOf<T>[]` |
| `SetType(K)` | `SetExpr<K>` | `Set<ValueTypeOf<K>>` |
| `DictType(K, V)` | `DictExpr<K, V>` | `Map<ValueTypeOf<K>, ValueTypeOf<V>>` |
| `StructType({...})` | `StructExpr<{...}>` | `{...}` (object) |
| `VariantType({...})` | `VariantExpr<{...}>` | `variant` (use `some()`, `none`, `variant()`) |
| `RefType(T)` | `RefExpr<T>` | `ref<ValueTypeOf<T>>` |

**BlockBuilder (`$`) operations:**

| Category | Method | Description |
|----------|--------|-------------|
| **Variables** | `$.let(value)` | Declare mutable variable, returns expression |
| | `$.let(value, Type)` | Declare with explicit type |
| | `$.const(value)` | Declare immutable variable |
| | `$.assign(variable, value)` | Reassign mutable variable |
| **Execute** | `$(expr)` | Execute expression (for side effects) |
| | `$.return(value)` | Return value (required in every function) |
| | `$.error(message)` | Throw error |
| **Control Flow** | `$.if(cond, $ => {...})` | Conditional (then branch) |
| | `$.if(cond, $ => {...}, $ => {...})` | Conditional (then + else) |
| | `$.while($ => cond, $ => {...})` | While loop |
| | `$.for(array, ($, elem, index) => {...})` | For-each loop |
| | `$.match(variant, { case: ($, val) => {...} })` | Pattern match on variant |
| **Error Handling** | `$.try($ => {...}).catch(($, msg, stack) => {...})` | Try-catch |
| | `.finally($ => {...})` | Finally block (chainable) |

**Note**: `$.let()` and `$.const()` do NOT take a name string:
```typescript
const total = $.let(arr.sum());           // CORRECT
const total = $.let("total", arr.sum());  // WRONG
```

### Signature Rules

1. **Always include argument names** - `(path: StringExpr)` not `(StringExpr)`
2. **Use exact type names** - `IntegerExpr`, not `number`
3. **Show union types** - `(index: IntegerExpr | bigint)`
4. **Show generic parameters** - `ArrayExpr<T>`, `DictExpr<K, V>`
5. **Mark optional arguments** - `(encoding?: StringExpr)`
6. **Show callback signatures** - `(fn: (elem: T) => U)`
7. **Use ❗ for throwing operations** - `get(...): T` **❗**
8. **Group by category** - Use bold headers like `| **Read Operations** |`

---

## Examples and the Search Index

Worked examples are **not** maintained as static prose files. They live in
the test suite as `*.examples.ts` companions to each `*.spec.ts`, following
[`EXAMPLES_AUTHORING.md`](./EXAMPLES_AUTHORING.md). They are tested in CI and
extracted into the east-claude-plugin search index (`index.json`,
regenerated by the `plugin-artifacts` workflow), which surfaces them to
agents via the `search_east_examples` MCP tool. A program example (east,
east-node-std, east-node-io, east-py-datascience) is stored as its IR and
printed in TypeScript and python on demand; a JSX-authored UI example is
stored as its source and is TypeScript only (#654).

This means:

- Every distinct API method exercised in a spec gets an `example()` export
  in the companion `*.examples.ts` — that is what makes it discoverable.
- `SKILL.md` carries short, illustrative snippets inline (quick start, key
  patterns). It does **not** link out to a separate examples file.
- When you add or change public API, update the `*.examples.ts` (for the
  index) and the `SKILL.md` API tables / decision tree — not a `reference/`
  folder.

**Finding correct patterns:**
1. Check the package's unit tests (`*.spec.ts`) and their `*.examples.ts`
2. Check the package's `SKILL.md` for the API overview
3. Use the same import patterns as the test files

---

## TypeScript Configuration

Example files use the same import paths as end users (e.g., `from "@elaraai/east"`). To compile against local source, use **path mapping**.

**Add to tsconfig.json:**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@elaraai/<this-package>": ["./src/index.ts"]
    }
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**For packages with dependencies** (e.g., `east-node-std` depends on `east`):

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@elaraai/east": ["../../east/src/index.ts"],
      "@elaraai/east-node-std": ["./src/index.ts"]
    }
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

---

## Checklist

Before committing skill documentation:

### SKILL.md
- [ ] Focused length (aim under ~500 lines of prose)
- [ ] Has YAML frontmatter with `name` and `description`
- [ ] Carries the "Before writing code" section verbatim, after the intro
- [ ] Includes quick start example
- [ ] Has decision tree for common tasks
- [ ] API signature tables inlined (no links to sibling `reference/` files)
- [ ] No relative links to sibling assets that aren't bundled with the skill

### API Signature Tables (inline)
- [ ] Grouped by logical category with bold headers
- [ ] API signature tables with all required columns
- [ ] Signatures include argument names and exact types
- [ ] Throwing operations marked with **❗**

### Examples (`*.examples.ts`)
- [ ] Every distinct API method exercised in a spec has an `example()` export
- [ ] Uses real package imports (`from "@elaraai/<package>"`)
- [ ] Patterns match unit test files
- [ ] Compiles and passes in CI (so the search index regenerates cleanly)

### Configuration
- [ ] `tsconfig.json` includes the test suite (`test/**/*.ts`)
- [ ] `tsconfig.json` has path mapping for package imports

---

## Sources of Truth

When creating documentation, reference these in order:

| What to check | Where to find it |
|---------------|------------------|
| API overview and structure | Existing `SKILL.md` |
| Correct function signatures | Source `.d.ts` files or TypeDoc |
| Working code patterns | Unit tests (`*.spec.ts`) and their `*.examples.ts` |
| Import patterns | Unit test imports |
| Type names and generics | Source type definitions |

**The unit tests are the ultimate source of truth** - if an example doesn't match the test patterns, the example is wrong.
