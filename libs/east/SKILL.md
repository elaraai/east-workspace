---
name: east
description: "East programming language: a statically typed, expression-based language embedded in TypeScript, compiled to portable IR that runs on Node, C and Python. Use when (1) writing East functions (East.function / East.asyncFunction) and types (IntegerType, StringType, ArrayType, StructType, VariantType, …); (2) platform functions (East.platform / East.asyncPlatform); (3) compiling and running in-process with East.compile; (4) East expressions: arithmetic, strings, dates, collections, vectors and matrices, control flow; (5) East values from TypeScript: compareFor/equalFor, SortedMap/SortedSet, isValueOf, the East-text, JSON, CSV and beast2 codecs; (6) IR (.toIR, East.toSource) and running programs from the command line (east-node / east-c / east-py run, exec) or a runner unit in your own host; (7) calling python-authored functions or exporting for python (East.importFunction, East.exportFunctions); (8) east-node check / lsp; (9) collections larger than memory; (10) JSON Schema contracts; (11) typed jq (East.jq)."
---

# East Language

A statically typed, expression-based language embedded in TypeScript: you build
a program with a fluent API, and it compiles to portable IR that runs
in-process, or on the east-node, east-c and east-py runners.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index is the
API reference, printed from each example's IR in TypeScript or python, which
is why this skill lists methods without their signatures. Before writing or
changing East code:

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

Nothing is injected for you; the search is the step. (Python code working
with East values directly — eager methods, not an East function — is a
separate set, searched with `package: "east-values"`; the `east-py` skill
covers it.)

## Quick Start

```typescript
// Types and helpers are direct imports (NOT East.IntegerType)
import { East, IntegerType, StringType, ArrayType, NullType } from "@elaraai/east";

// 1. Declare a platform function (an effect the host implements)
const log = East.platform("log", [StringType], NullType);
const platform = [log.implement(console.log)];

// 2. Define an East function
const sumArray = East.function([ArrayType(IntegerType)], IntegerType, ($, arr) => {
    const total = $.let(arr.sum());
    $(log(East.str`Sum: ${total}`));
    $.return(total);
});

// 3. Compile and execute
const compiled = East.compile(sumArray, platform);
compiled([1n, 2n, 3n]);  // logs "Sum: 6", returns 6n
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Create East expressions (East.*)
    │   ├─ From a TypeScript value → East.value(tsValue) or East.value(tsValue, Type)
    │   ├─ String interpolation → East.str`Hello ${name}!`
    │   └─ Inside a function body → $.let(value), $.const(value)
    │
    ├─ Define a type (import from the package, NOT East.*)
    │   ├─ Primitive → IntegerType, FloatType, StringType, BooleanType, DateTimeType, BlobType, NullType
    │   ├─ Collection → ArrayType(T), SetType(K), DictType(K, V), RefType(T)
    │   ├─ Numeric → VectorType(T), MatrixType(T), T one of FloatType, IntegerType, BooleanType
    │   ├─ Compound → StructType({...}), VariantType({...}), OptionType(T), RecursiveType(self => ...)
    │   ├─ Function → FunctionType([inputs], output), AsyncFunctionType([inputs], output)
    │   └─ Patch → PatchType(T) (the patch type of any type); dictPatchOpsType(V) / setPatchOpsType(E)
    │       for the op a touched key carries, when building a sparse key-addressed change set yourself
    │
    ├─ Write TypeScript values of East types
    │   ├─ NullType → null · BooleanType → true · IntegerType → 42n (bigint) · FloatType → 3.14
    │   ├─ StringType → "hello" · DateTimeType → new Date("2025-01-01T00:00:00Z") · BlobType → new Uint8Array([...])
    │   ├─ ArrayType(T) → [1n, 2n] · SetType(K) → new Set([1n]) · DictType(K, V) → new Map([["a", 1n]])
    │   │   (a Set or Dict with struct keys → new SortedSet(values, compareFor(K)) / new SortedMap(entries, compareFor(K)))
    │   ├─ StructType({...}) → { field1: value1, field2: value2 }
    │   ├─ VariantType({...}) → variant("caseName", value); an Option → some(value), none
    │   ├─ VectorType(FloatType | IntegerType | BooleanType) → Float64Array | BigInt64Array | Uint8ClampedArray
    │   ├─ MatrixType(T) → matrix(Float64Array.from([1, 2, 3, 4]), 2, 2)   (rows, cols)
    │   └─ RefType(T) → ref(value)
    │
    ├─ Write a function → East.function([inputs], output, ($, ...args) => ...) · async: East.asyncFunction
    ├─ Compile and run in-process → East.compile(fn, platform) · async: East.compileAsync(fn, platform)
    ├─ Declare an effect → East.platform("name", [inputs], output).implement(fn) · async: East.asyncPlatform
    │
    ├─ Block operations ($)
    │   ├─ Variables → $.let(value), $.const(value), $.assign(variable, value)
    │   ├─ Execute → $(expr), $.return(value), $.error(message)
    │   ├─ Control flow → $.if(...), $.while(...), $.for(...), $.match(...), $.matchTag(...)
    │   └─ Errors → $.try(...).catch(...).finally(...)
    │
    ├─ Expression operations — every type compares with .equal()/.notEqual(), and ordered types with
    │   .less()/.greater()/.lessEqual()/.greaterEqual() (aliases: .equals()/.eq(), .notEquals()/.ne(),
    │   .lessThan()/.lt(), .greaterThan()/.gt(), .lessThanOrEqual()/.lte()/.le(), .greaterThanOrEqual()/.gte()/.ge())
    │   ├─ Boolean → .and($=>), .or($=>), .not(), .ifElse($=>,$=>), .bitAnd(), .bitOr(), .bitXor()
    │   ├─ Integer → .add()/.plus(), .subtract()/.sub()/.minus(), .multiply()/.mul()/.times(), .divide()/.div(),
    │   │   .remainder()/.mod()/.rem()/.modulo(), .pow(), .abs(), .sign(), .negate(), .log(), .toFloat()
    │   ├─ Float → the Integer math, .sqrt(), .exp(), .log(), .sin(), .cos(), .tan(), .toInteger()
    │   ├─ String → .concat(), .repeat(), .substring(), .upperCase(), .lowerCase(), .trim(), .trimStart(), .trimEnd(),
    │   │   .replace(), .replaceAll(), .split(), .length(), .startsWith(), .endsWith(), .contains(), .indexOf(),
    │   │   .charAt(), .parse(), .parseJson(), .encodeUtf8(), .encodeUtf16()
    │   ├─ DateTime → .getYear(), .getMonth(), .getDayOfMonth(), .getDayOfWeek(), .getHour(), .getMinute(),
    │   │   .getSecond(), .getMillisecond(), .addDays(), .subtractDays(), .addHours(), .subtractHours(), .addMinutes(),
    │   │   .addSeconds(), .addMilliseconds(), .addWeeks(), .durationDays(), .durationHours(), .durationMinutes(),
    │   │   .durationSeconds(), .durationMilliseconds(), .durationWeeks() ❗ a.durationDays(b) = b − a (positive when
    │   │   b is later), .toEpochMilliseconds(), .printFormatted()
    │   ├─ Blob → .size(), .getUint8(), .decodeUtf8(), .decodeUtf16(), .decodeBeast(T),
    │   │   .decodeCsv(rowType, { nullStrings (default [] — an empty field is an empty string; opt in for none),
    │   │   defaults (per-column fallbacks), skipShortRows (drop ragged rows rather than fail), trimFields, … }),
    │   │   .openBeast(ArrayType(T) | SetType(K) | DictType(K, V)) — a huge collection, opened lazily (reference/beast2.md)
    │   ├─ Array
    │   │   ├─ Read → .size(), .length(), .has(), .get(), .at(), .tryGet(), .getKeys()
    │   │   ├─ Mutate → .update(), .pushLast(), .popLast(), .pushFirst(), .popFirst(), .append(), .prepend(),
    │   │   │   .clear(), .sortInPlace(), .reverseInPlace()
    │   │   ├─ Transform → .copy(), .slice(), .concat(), .sort(), .reverse(), .map(), .filter(), .filterMap(), .flatMap()
    │   │   ├─ Search → .findFirst(), .findAll(), .firstMap(), .isSorted()
    │   │   ├─ Reduce → .reduce(), .scan(), .every(), .some(), .sum(), .mean(), .maximum(), .minimum(),
    │   │   │   .findMaximum(), .findMinimum()
    │   │   ├─ Convert → .stringJoin(), .toSet(), .toDict(), .flattenToSet(), .flattenToDict(), .encodeCsv()
    │   │   ├─ Group → .groupReduce(), .groupSize(), .groupSum(), .groupMean(), .groupMinimum(), .groupMaximum(),
    │   │   │   .groupToArrays(), .groupToSets(), .groupToDicts(), .groupEvery(), .groupSome()
    │   │   └─ Tree → .toTree(Node, key, parent, build) — flat parent-keyed rows to nested nodes;
    │   │       .flattenTree(children) — nested nodes back to { path, node } rows, depth first (reference/trees-and-recursion.md)
    │   ├─ Set
    │   │   ├─ Read and mutate → .size(), .has(), .insert(), .tryInsert(), .delete(), .tryDelete(), .clear(), .unionInPlace()
    │   │   ├─ Set ops → .copy(), .union(), .intersection(), .difference(), .symmetricDifference(), .isSubsetOf(),
    │   │   │   .isSupersetOf(), .isDisjointFrom()
    │   │   └─ Set and Dict alike → transform .map(), .filter(), .filterMap(), .forEach(), .firstMap();
    │   │       reduce .reduce(), .scan(), .every(), .some(), .sum(), .mean();
    │   │       convert .toArray(), .toSet(), .toDict(), .flattenToArray(), .flattenToSet(), .flattenToDict(),
    │   │       .toTree(Node, parent, build) (an element / a key is its own key; Dict callbacks take (value, key));
    │   │       Dict only: .flattenTree(children), the nodes back again (reference/trees-and-recursion.md);
    │   │       group .groupReduce(), .groupSize(), .groupSum(), .groupMean(), .groupToArrays(), .groupToSets(),
    │   │       .groupToDicts(), .groupEvery(), .groupSome()
    │   ├─ Dict → .size(), .has(), .get(), .tryGet(), .keys(), .getKeys(), .insert(), .insertOrUpdate(), .update(),
    │   │   .merge() (ONE key, as Array's and Ref's), .getOrInsert(), .delete(), .tryDelete(), .pop(), .swap(),
    │   │   .clear(), .unionInPlace(), .mergeAll(), .copy(), .union() (whole dicts; in east-py .merge() is its
    │   │   deprecated alias), and the Set-and-Dict operations above
    │   ├─ Vector → .length(), .get(), .set() (a new vector), .slice(), .concat(), .map(), .reduce(),
    │   │   .scale(), .addScaled(), .mul(), .addScalar(), .abs(), .clamp(), .cumSum(), .sum(), .dot(), .max(), .min(),
    │   │   .argMax(), .argMin(), .mean() ❗ empty: sum() is 0, max/min/argMax/argMin raise;
    │   │   masks (Vector<Boolean>) .eq()/.lt()/.gt() → mask.select(a, b), data.compress(mask), mask.countTrue();
    │   │   .gather(indices), .scatterAdd(indices, src), .searchSorted(needles), .toArray(), .toMatrix()
    │   ├─ Matrix → .rows(), .cols(), .get(), .getRow(), .getCol(), .set() (a new matrix), .transpose(),
    │   │   .scale(), .addScaled(), .mulElementwise(), .rowSums(), .colSums(), .vecMul(v) ❗ cols = v.length(),
    │   │   .toVector(), .toArray()
    │   ├─ Struct → .fieldName
    │   ├─ Variant → .match(), .matchTag(), .unwrap(), .hasTag(), .getTag()
    │   └─ Ref → .get(), .update(), .merge()
    │
    ├─ Standard library (East.*)
    │   ├─ Integer → East.Integer.printCommaSeperated(), .roundNearest(), .printOrdinal()
    │   ├─ Float → East.Float.roundToDecimals(), .printCurrency(), .printCompact()
    │   ├─ DateTime → East.DateTime.fromComponents(), .roundDownDay(), .parseFormatted()
    │   │   (fromComponents normalises an out-of-range component into the next — (2024, 2, 31) is 2024-03-02 —
    │   │    so validate by round-tripping getMonth(), not by range-checking)
    │   ├─ Array → East.Array.range(), .linspace(), .generate() · Set → East.Set.generate() · Dict → East.Dict.generate()
    │   ├─ Blob → East.Blob.encodeBeast() · String → East.String.printJson(), East.String.printError()
    │   ├─ Vector → East.Vector.zeros(), .ones(), .fill(), .fromArray(), .sparseAxpy(), .sparseFromPairs(),
    │   │   .sparseFilterGt() (sparse pairs are {ix: Vector<Integer>, v: Vector<T>}, ix strictly ascending)
    │   └─ Matrix → East.Matrix.zeros(), .ones(), .fill(), .fromArray()
    │
    ├─ Compare and convert (East.*) → East.equal(), East.notEqual(), East.less(), East.greater(), East.lessEqual(),
    │   East.greaterEqual() (and their aliases), East.min(), East.max(), East.clamp(), East.print(expr);
    │   East.is() is identity for mutable collections — frozen ones (task inputs) compare by value
    ├─ Patches (East.*) → East.diff(before, after), East.applyPatch(value, patch),
    │   East.composePatch(first, second, type), East.invertPatch(patch, type)
    ├─ Build East over types you are handed (a library, a generator) → East.field(v, name, T?), East.fields(v, names?),
    │   East.struct(T, fields), East.withField(v, name, x), East.inCase(T, name, x), East.patchesFor(T): each name
    │   checked as the program builds → reference/values-in-typescript.md
    │
    ├─ Ask a question of a value in jq → East.jq(input, program, resultType), checked when the program
    │   builds → reference/queries.md
    ├─ Work with East values from TypeScript → reference/values-in-typescript.md (comparators, SortedMap, codecs)
    ├─ Run a program from the shell → reference/runners-and-ir.md (east-node / east-c / east-py run, exec, east-c ir)
    ├─ Run a runner-protocol unit in a host of your own (a browser's worker) → executeUnit(unit, io, { platforms })
    │   over an InMemoryUnitIO (reference/runners-and-ir.md)
    ├─ IR ↔ source → fn.toIR(), encodeEastIR, East.toSource(fn), east-node transpile
    ├─ A function written in python (or another package) → East.importFunction; yours for python → East.exportFunctions
    ├─ Check that a module builds → east-node check (tsc cannot see the build's own errors)
    ├─ A JSON contract for a type → jsonSchemaFor(T) · back from a vendored schema → typeFromJsonSchema(schema)
    └─ Data larger than memory → reference/beast2.md; inside a body blob.openBeast(T),
        and a file on the runner's disk FileSystem.openBeast(T, path) (east-node-std / east-c-std / east-py-std)
        └─ A loop over a lazy input (a large task input, an openBeast) decodes only the fields its body reads:
            read the row through fields (row.total, $.for(row.lines, …)), not bound whole ($.let(row));
            a runner's -v says "paged loops: N segments decoded to the fields read, M in full"
```

## Types and their values

| Type | TypeScript value (`ValueTypeOf<Type>`) | Mutable |
|------|-----------------------------------------|---------|
| `NullType` · `BooleanType` · `IntegerType` · `FloatType` · `StringType` | `null` · `boolean` · `bigint` · `number` · `string` | no |
| `DateTimeType` · `BlobType` | `Date` · `Uint8Array` | no |
| `ArrayType<T>` | `ValueTypeOf<T>[]` | **yes** |
| `SetType<K>` · `DictType<K, V>` | `Set` · `Map`; decoded, a `SortedSet` · `SortedMap` in East order | **yes** |
| `RefType<T>` | `ref<ValueTypeOf<T>>` | **yes** |
| `VectorType<Float \| Integer \| Boolean>` | `Float64Array` · `BigInt64Array` · `Uint8ClampedArray` | no |
| `MatrixType<T>` | `matrix<TypedArray>` | no |
| `StructType<Fields>` | a plain object | no |
| `VariantType<Cases>` · `OptionType<T>` · `PatchType<T>` | `variant` (build with `variant()`, `some()`, `none`) | no |
| `FunctionType<I, O>` | a function | no |

A decoded Set or Dict — anything `decodeBeast2For`, `fromJSONFor` or a runner
gives you — is a `SortedSet` / `SortedMap`, ordered and looked up by East
comparison, so a struct key finds its entry by value. A plain `Map` keyed by
objects looks up by identity: build one with struct keys as
`new SortedMap(entries, compareFor(KeyType))`, never with a comparator of your
own.

## Key patterns

### TypeScript values vs East expressions

East methods exist only on East expressions — `THRESHOLD.greaterThan(x)` is a
TypeScript error, a bigint having none. Function parameters already are
expressions. A method's **argument** may be a TypeScript value of the right
type (`x.greaterThan(100n)`, `arr.get(0n)`), but an `East.str` interpolation
takes only expressions and plain strings: wrap any other value with
`East.value()`, or bind it once with `$.const()`.

```typescript
const THRESHOLD = 100n;  // a TypeScript bigint

East.function([IntegerType], StringType, ($, x) => {
    const over = $.let(x.greaterThan(THRESHOLD));          // OK: an argument may be a TypeScript value
    // East.str`Threshold: ${THRESHOLD}`                   // ERROR: interpolation takes expressions and strings
    const threshold = $.const(THRESHOLD);                  // bind it once as an expression…
    $.if(over, $ => $.return(East.str`${x} is over ${threshold}`));
    $.return(East.str`Threshold: ${East.value(THRESHOLD)}`);   // …or wrap it where it is used
});
```

### Variants, options and refs

```typescript
import { variant, some, none, ref } from "@elaraai/east";

const hasValue = some(42n);             // an Option: some()/none, never variant("some", …)
const noValue = none;
const failure = variant("error", "failed");   // any other variant
const counter = ref(0n);                // a mutable reference
```

A variant is built with `variant()`, `some()` or `none` — never a
`{ type, value }` literal, which lacks the marker the encoders read. Variants are
encoded, compared and validated by case **name**.

### Error handling

```typescript
$.try($ => {
    $.assign(result, arr.get(index));
}).catch(($, message, stack) => {
    $.assign(result, -1n);
}).finally($ => { /* cleanup */ });
```

### Platform functions

An implementation is a plain TypeScript function over the `ValueTypeOf` of each
East type (table above). A body calls an async platform function with no
`await`; the host awaits the compiled function.

```typescript
const log = East.platform("log", [StringType], NullType);
const timeNs = East.platform("time_ns", [], IntegerType);
const fetchStatus = East.asyncPlatform("fetch_status", [StringType], StringType);

const platform = [
    log.implement(console.log),                          // (msg: string) => void
    timeNs.implement(() => process.hrtime.bigint()),     // () => bigint
    fetchStatus.implement(async (url: string) => `${(await fetch(url)).status}`),
];

const myFn = East.asyncFunction([StringType], NullType, ($, url) => {
    const t1 = $.let(timeNs());
    const status = $.let(fetchStatus(url));              // no await in East
    $(log(East.str`Fetched in ${timeNs().subtract(t1)} ns, status: ${status}`));
});
await East.compileAsync(myFn, platform)("https://example.com");

// { optional: true } compiles without an implementation, and throws if called
const maybe = East.platform("maybe", [StringType], StringType, { optional: true });
```

**In an e3 task** nothing calls `compile`: default-export the
`PlatformFunction[]` as your package's `./platform` subpath, name each function
dotted `"<project>.<fn>"` (byte-identical in the declaration and every
implementation, python's included), and list the package in the task's runner,
`{ runtime: "east-node", platforms: [{ custom: "@scope/<project>" }] }`. The
wiring is **east-project**'s; the task runner is **e3**'s; python's
`@platform_function` is **east-py**'s.

## Reference files

Read the one a task needs; each is complete on its subject.

| File | Holds |
|---|---|
| [reference/values-in-typescript.md](reference/values-in-typescript.md) | Comparators (`compareFor`, `equalFor`, …), `SortedMap`/`SortedSet`, type utilities, the East-text, JSON, CSV and beast2 codecs; building programs over names and types held as values (`East.field`, `East.withField`, `East.patchesFor`) |
| [reference/trees-and-recursion.md](reference/trees-and-recursion.md) | `toTree`, `flattenTree`, rollups, and the depth limits of recursion |
| [reference/queries.md](reference/queries.md) | `East.jq` in a body, and `checkJq` / `evaluateJq` / `splitJq` on the host |
| [reference/runners-and-ir.md](reference/runners-and-ir.md) | `east-node` / `east-c` / `east-py` `run` and `exec`, `executeUnit` over a `UnitIO`, `East.toSource` and `east-node transpile`, `east-node check` |
| [reference/cross-language-and-json-schema.md](reference/cross-language-and-json-schema.md) | `East.importFunction` / `East.exportFunctions`, and `jsonSchemaFor` / `typeFromJsonSchema` |
| [reference/beast2.md](reference/beast2.md) | `encodeBeast2For` / `decodeBeast2For`, paged and streaming writers, `openBeast2PagesFor`, `blob.openBeast` |

## Related skills

East is the language inside every other skill's `East.function` bodies; East
itself is pure. Load the skill for the capability you're adding:

- **east-node-std** — Node effects: files, HTTP (`Fetch`), crypto, time, random,
  and `Json.open` / `Json.next` for a document too large to decode whole.
- **east-node-io** — databases (SQL / NoSQL), S3, FTP / SFTP, XLSX / XML, compression.
- **east-py** and **east-py-datascience** — the python runtime; optimization,
  ML, Bayesian inference, simulation.
- **east-ui** — typed UI components returning `UIComponentType`.
- **e3** — run East functions as durable, content-addressed dataflow tasks.
- **east-project** — author a project-owned platform function and wire it into
  an e3 task; **e3-create** — scaffold a project.
- **east-design** — when you have a goal but no architecture yet (start here).
