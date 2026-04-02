# East Node IO tests

This test suite validates the I/O platform functions for the East language on Node.js.
It exists separately to the source code in ../src so tests exercise the public API as an external consumer would.

## Import methodology

**Tests import from the published package name `@elaraai/east-node-io`, not relative paths.** This ensures tests exercise the same public API that external consumers use.

Use the **namespaced exports** (`SQL`, `Storage`, `Transfer`, `NoSQL`, `Compression`, `Format`):

```ts
// ✅ CORRECT: Import from the package name using the namespaced API
import { SQL } from "@elaraai/east-node-io";

const conn = $.let(SQL.SQLite.connect(config));
$(SQL.SQLite.query(conn, "SELECT 1", []));
$(SQL.SQLite.close(conn));

// Access types through the namespace
const row = $.let(new Map(...), SQL.SQLite.Types.Row);

// Pass the Implementation to describeEast
describeEast("SQLite tests", (test) => { ... }, {
    platformFns: [...SQL.SQLite.Implementation, ...NodePlatform],
});
```

```ts
// ❌ WRONG: Never use relative imports to ../src
import { sqlite_connect, sqlite_query, sqlite_close, SqliteImpl } from "../src/sql/sqlite.js";
import { SqlRowType } from "../src/sql/types.js";
```

### Namespace reference

| Namespace | Sub-namespaces |
|-----------|---------------|
| `SQL` | `SQL.SQLite`, `SQL.Postgres`, `SQL.MySQL`, `SQL.Access` |
| `NoSQL` | `NoSQL.Redis`, `NoSQL.MongoDB` |
| `Storage` | `Storage.S3` |
| `Transfer` | `Transfer.FTP`, `Transfer.SFTP` |
| `Compression` | `Compression.Gzip`, `Compression.Zip`, `Compression.Tar` |
| `Format` | `Format.XLSX`, `Format.XML` |

Each sub-namespace provides: platform functions (e.g. `connect`, `query`, `close`), `Implementation` (for `platformFns`), and `Types` (e.g. `Types.Config`, `Types.Row`).

Some internal helpers (e.g. `ftp_close_all`, `sftp_close_all`, `mongodb_delete_many`, `mongodb_close_all`) are not yet in the namespace — import these as flat exports:

```ts
import { Transfer, ftp_close_all } from "@elaraai/east-node-io";
```

Tests are run with `tsx` directly from TypeScript (not compiled to JS first). The `@elaraai/east-node-io` import resolves through the package's `dist/` output, so `npm run build` must be run before tests.

## Examples system

Each spec file should have a companion `*.examples.ts` file (e.g. `array.spec.ts` → `array.examples.ts`). Examples serve two purposes: they are tested as part of the test suite, and they are extracted into a search index for AI agent context.

### Writing an examples file

**Imports**: Use the `@elaraai/east` package import (not relative `../src/index.js`). This is critical — examples are shown to agents as standalone code.

```ts
import { East, ArrayType, IntegerType, example } from "@elaraai/east";
import type { option } from "@elaraai/east"; // if needed for Map type args
```

**Structure**: Each example is an exported `const` using the `example()` helper:

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

**Fields**:
- `keywords`: API method names, type names, concepts. Used for search indexing.
- `description`: Human-readable, used as the test name.
- `fn`: An `East.function()` call — the same thing users would write.
- `inputs`: Arguments to call `fn` with. Use `[]` for zero-arg functions.
- `returns`: Expected return value. If omitted, the test just calls `fn(...inputs)` without asserting (use for side-effect-only examples).

### Rules for writing examples

1. **Use `$.let` and `$.const` with the East type as the second argument**. Don't use `East.value()` — use `$.const(value, Type)` for immutable and `$.let(value, Type)` for mutable:
   ```ts
   const a = $.const([1n, 2n, 3n], ArrayType(IntegerType));  // good
   const b = $.let([], ArrayType(IntegerType));               // good (mutable)
   const c = East.value([1n, 2n, 3n]);                        // avoid
   ```

2. **Use the actual spec file as reference**. The spec file has working, tested examples for every API method. Port the patterns directly — don't guess at method signatures.

3. **Every example must have a `returns` value if it returns a non-null type**. If `returns` is omitted, `assertEast.examples` wraps the call as a statement `$(ex.fn(...ex.inputs))` — this fails if the return type isn't `NullType`. Either:
   - Provide `returns` with the correct expected value, or
   - Make the fn return `NullType` if it's a side-effect-only example.

4. **TypeScript type annotations on `returns`**: When the return value has union types that TypeScript can't infer (e.g. `Map` with `option` values mixing `some` and `none`), add explicit type args on the JS value:
   ```ts
   returns: new Map<bigint, option<bigint>>([[0n, some(3n)], [1n, none]]),
   ```
   Import `option` as a type: `import type { option } from "@elaraai/east";`

5. **Verify `returns` values match the fn logic**. Compute the expected output by hand or check the corresponding spec test. Wrong `returns` values cause test failures.

6. **Zero-arg functions**: Most examples use `fn: East.function([], ReturnType, ($) => { ... })` with `inputs: []`. Use function args only when the example is specifically about parameterized functions.

7. **One example per concept**. Cover each API method with a focused example. Don't combine multiple unrelated operations.

8. **HARD RULE: Every distinct expression method or stdlib method tested in a spec file MUST have a corresponding example in its examples file.** No exceptions. Do not skip methods because they seem internal, low-level, or serialization-heavy. If the spec tests `foo.bar()`, there must be an example for `bar`. This applies to all spec files — encoding/decoding methods, equality aliases, serialization, CSV parsing, everything.

### Wiring examples into spec files

In the spec file, import the examples and use `assert.examples()` to register them as tests. Place each `assert.examples()` call **before the related test section**:

```ts
import * as ex from "./array.examples.js";

await describe("Array", (test) => {
    assert.examples(test, { arraySize: ex.arraySize, arrayGet: ex.arrayGet });

    test("Array ops", $ => {
        // existing detailed tests...
    });

    assert.examples(test, { arraySort: ex.arraySort, arraySortByKey: ex.arraySortByKey });

    test("Sorting", $ => {
        // existing detailed tests...
    });
});
```

The examples object keys are just for identification — pass the subset of examples relevant to the test section that follows.

### How `assert.examples()` works

Defined in `platforms.spec.ts` on the `assertEast` object. For each example:
- If `returns` is defined: calls `fn(...inputs)`, stores result in `$.let`, asserts `equal(result, returns)`
- If `returns` is undefined: calls `$(fn(...inputs))` as a statement (return type must be `NullType`)

### Files that need examples

The following spec files need companion `*.examples.ts` files created:

- `array.spec.ts` → `array.examples.ts` (done)
- `boolean.spec.ts` → `boolean.examples.ts`
- `integer.spec.ts` → `integer.examples.ts`
- `float.spec.ts` → `float.examples.ts`
- `string.spec.ts` → `string.examples.ts`
- `struct.spec.ts` → `struct.examples.ts`
- `variant.spec.ts` → `variant.examples.ts`
- `dict.spec.ts` → `dict.examples.ts`
- `set.spec.ts` → `set.examples.ts`
- `blob.spec.ts` → `blob.examples.ts`
- `datetime.spec.ts` → `datetime.examples.ts`
- `function.spec.ts` → `function.examples.ts`
- `block.spec.ts` → `block.examples.ts`
- `ref.spec.ts` → `ref.examples.ts`
- `recursive.spec.ts` → `recursive.examples.ts`
- `patch.spec.ts` → `patch.examples.ts`
- `vector.spec.ts` → `vector.examples.ts`
- `matrix.spec.ts` → `matrix.examples.ts`

### Workflow for adding examples to a new spec file

1. Read the spec file thoroughly to understand every tested API method
2. Create the `*.examples.ts` file with `@elaraai/east` imports
3. For each API method/concept tested, create an `example()` export porting patterns from the spec
4. In the spec file: add `import * as ex from "./<name>.examples.js";`
5. Add `assert.examples(test, { ... })` calls before each relevant test section
6. Run `make build && make test` to verify
