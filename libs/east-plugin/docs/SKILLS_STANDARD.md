# Skills Documentation Standard

**This document defines the MANDATORY standards for creating skill documentation in East repositories.**

An agent following this standard will produce documentation that:
1. Enables accurate code generation by Claude Code
2. Integrates with the east-plugin search index
3. Is verified by TypeScript compilation in CI

---

## Table of Contents

- [File Structure](#file-structure)
- [SKILL.md Format](#skillmd-format)
- [Reference Files](#reference-files)
- [Example Files](#example-files)
- [API Signature Tables](#api-signature-tables)
- [TypeScript Configuration](#typescript-configuration)
- [Checklist](#checklist)

---

## File Structure

Every package MUST have this structure:

```
package-root/
├── SKILL.md                      # High-level overview (<500 lines)
├── reference/
│   ├── <topic>.md                # API reference with YAML frontmatter
│   ├── <topic>.example.ts        # Testable examples for that topic
│   └── ...
├── src/                          # Source code
├── tests/                        # Unit tests (source of truth for examples)
├── tsconfig.json                 # Must include reference/*.example.ts
└── package.json                  # Must exclude reference/ from npm package
```

---

## SKILL.md Format

SKILL.md is the entry point that Claude Code loads when the skill is activated.

**Requirements:**
- Keep under 500 lines (Claude has context limits)
- Provide decision tree for common tasks
- Link to reference files for details
- Include quick start example

**Template:**

```markdown
---
name: <skill-name>
description: "<One sentence description. Triggers for: (1) ..., (2) ..., (3) ...>"
---

# <Package Name>

<One paragraph description of what this package does.>

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

## Reference Documentation

- **[<Topic>](./reference/<topic>.md)** - <Description>
- **[<Topic>](./reference/<topic>.md)** - <Description>

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

---

## Reference Files

Each reference file covers ONE topic and MUST have YAML frontmatter.

**Requirements:**
- One file per logical topic (e.g., `array-operations.md`, `filesystem.md`)
- YAML frontmatter with title, keywords, summary, examples
- API signature table (see [API Signature Tables](#api-signature-tables))
- Link to corresponding `.example.ts` file

**Template:**

```markdown
---
title: <Topic Title>
keywords:
  - <keyword1>
  - <keyword2>
  - <ExactFunctionName>
  - <ExactTypeName>
summary: >
  <2-3 sentence description of what this topic covers.>
examples:
  - <topic>.example.ts
---

## <Topic Title>

<Brief introduction.>

### <Subsection>

**Operations:**

| Signature | Description | Example |
|-----------|-------------|---------|
| **<Category>** |
| `methodName(arg: Type): ReturnType` | Description | `instance.methodName(value)` |
| `methodName(arg: Type): ReturnType` **❗** | Description (can throw) | `instance.methodName(value)` |

See [<topic>.example.ts](./<topic>.example.ts) for working examples.

### <Another Subsection>

...
```

**Keyword guidelines:**
- Include exact API names: `East.function`, `$.let`, `ArrayType`, `FileSystem.readFile`
- Include common synonyms: `array`/`list`, `dict`/`map`/`object`
- Include action verbs: `sum`, `filter`, `map`, `query`, `read`, `write`
- Include problem terms: `aggregate`, `transform`, `optimize`, `train`

---

## Example Files

Each reference file SHOULD have a corresponding `.example.ts` file.

**Requirements:**
- Use real imports from the package (e.g., `from "@elaraai/east"`)
- Export named functions/constants (no default exports)
- Include comments explaining each example
- Must compile with `tsc` (verified in CI)
- Follow patterns from the package's unit tests

**Template:**

```typescript
// reference/<topic>.example.ts
import { East, IntegerType, ArrayType, StringType } from "@elaraai/<package>";

// Example: <Description of what this demonstrates>
export const exampleName = East.function(
    [ArrayType(IntegerType)],
    IntegerType,
    ($, arr) => {
        $.return(arr.sum());
    }
);

// Example: <Another example>
export const anotherExample = East.function(
    [StringType],
    StringType,
    ($, text) => {
        const upper = $.let(text.upperCase());
        $.return(upper);
    }
);
```

**Finding correct patterns:**
1. Check the package's unit tests (`tests/*.spec.ts`) for working examples
2. Check the package's SKILL.md for the API overview
3. Use the same import patterns as the test files

---

## API Signature Tables

Every reference file MUST include signature tables. **Precise argument names and types are critical** for agents to generate correct code.

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
  "include": ["src/**/*.ts", "reference/**/*.example.ts"]
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
  "include": ["src/**/*.ts", "reference/**/*.example.ts"]
}
```

**Exclude reference/ from npm package:**

In `package.json`:
```json
{
  "files": ["dist", "src", "SKILL.md"]
}
```

Or in `.npmignore`:
```
reference/
```

---

## Checklist

Before committing skill documentation:

### SKILL.md
- [ ] Under 500 lines
- [ ] Has YAML frontmatter with `name` and `description`
- [ ] Includes quick start example
- [ ] Has decision tree for common tasks
- [ ] Links to all reference files

### Reference Files
- [ ] One file per logical topic
- [ ] YAML frontmatter with `title`, `keywords`, `summary`, `examples`
- [ ] Keywords include exact API names AND common synonyms
- [ ] API signature tables with all required columns
- [ ] Signatures include argument names and exact types
- [ ] Throwing operations marked with **❗**
- [ ] Links to corresponding `.example.ts` file

### Example Files
- [ ] Uses real package imports (`from "@elaraai/<package>"`)
- [ ] Named exports only (no default exports)
- [ ] Comments explaining each example
- [ ] Patterns match unit test files
- [ ] Compiles with `tsc` (run `npm run build` to verify)

### Configuration
- [ ] `tsconfig.json` includes `reference/**/*.example.ts`
- [ ] `tsconfig.json` has path mapping for package imports
- [ ] `package.json` excludes `reference/` from published package

---

## Sources of Truth

When creating documentation, reference these in order:

| What to check | Where to find it |
|---------------|------------------|
| API overview and structure | Existing `SKILL.md` |
| Correct function signatures | Source `.d.ts` files or TypeDoc |
| Working code patterns | Unit tests (`tests/*.spec.ts`) |
| Import patterns | Unit test imports |
| Type names and generics | Source type definitions |

**The unit tests are the ultimate source of truth** - if an example doesn't match the test patterns, the example is wrong.
