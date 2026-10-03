---
name: east
description: "East programming language - a statically typed, expression-based language embedded in TypeScript, compiled to portable IR that runs on Node, C and Python. Use when: (1) writing East functions with East.function() / East.asyncFunction(), (2) defining types (IntegerType, StringType, ArrayType, StructType, VariantType, ...), (3) platform functions with East.platform() / East.asyncPlatform(), (4) compiling and running in-process with East.compile(), (5) East expressions: arithmetic, strings, dates, collections, vectors and matrices, control flow, (6) working with East values from TypeScript: compareFor/equalFor, SortedMap/SortedSet, isValueOf, the East-text, JSON, CSV and beast2 codecs, (7) serializing IR (.toIR(), encodeEastIR) and printing it back as source (East.toSource, east-node transpile), (8) running a program from the command line (east-node / east-c / east-py run, exec, east-c ir), or a runner-protocol unit in a host of… See the detailed scope below."
---

## Detailed skill scope

East programming language - a statically typed, expression-based language embedded in TypeScript, compiled to portable IR that runs on Node, C and Python. Use when: (1) writing East functions with East.function() / East.asyncFunction(), (2) defining types (IntegerType, StringType, ArrayType, StructType, VariantType, ...), (3) platform functions with East.platform() / East.asyncPlatform(), (4) compiling and running in-process with East.compile(), (5) East expressions: arithmetic, strings, dates, collections, vectors and matrices, control flow, (6) working with East values from TypeScript: compareFor/equalFor, SortedMap/SortedSet, isValueOf, the East-text, JSON, CSV and beast2 codecs, (7) serializing IR (.toIR(), encodeEastIR) and printing it back as source (East.toSource, east-node transpile), (8) running a program from the command line (east-node / east-c / east-py run, exec, east-c ir), or a runner-protocol unit in a host of your own, such as a browser's worker (executeUnit over a UnitIO, InMemoryUnitIO), (9) calling a function authored in python, or exporting one for python (East.importFunction, East.exportFunctions, east-node export-functions), (10) checking that a module's East functions build (east-node check, east-node lsp), (11) collections larger than memory (Beast2ElementWriter, openBeast2PagesFor, blob.openBeast), (12) JSON Schema contracts (jsonSchemaFor, typeFromJsonSchema), (13) asking a question of a value in typed jq (East.jq, checkJq, evaluateJq).

# East Language

A statically typed, expression-based language embedded in TypeScript: you build
a program with a fluent API, and it compiles to portable IR that runs
in-process, or on the east-node, east-c and east-py runners.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

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
    │   │   .openBeast(ArrayType(T) | SetType(K) | DictType(K, V)) — a huge collection, opened lazily (below)
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
    │   │   └─ Tree → .toTree(Node, key, parent, build) — flat parent-keyed rows to nested nodes (below)
    │   ├─ Set
    │   │   ├─ Read and mutate → .size(), .has(), .insert(), .tryInsert(), .delete(), .tryDelete(), .clear(), .unionInPlace()
    │   │   ├─ Set ops → .copy(), .union(), .intersection(), .difference(), .symmetricDifference(), .isSubsetOf(),
    │   │   │   .isSupersetOf(), .isDisjointFrom()
    │   │   └─ Set and Dict alike → transform .map(), .filter(), .filterMap(), .forEach(), .firstMap();
    │   │       reduce .reduce(), .scan(), .every(), .some(), .sum(), .mean();
    │   │       convert .toArray(), .toSet(), .toDict(), .flattenToArray(), .flattenToSet(), .flattenToDict(),
    │   │       .toTree(Node, parent, build) (an element / a key is its own key; Dict callbacks take (value, key));
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
    │   │   (fromComponents NORMALISES an out-of-range component into the next — (2024, 2, 31) is 2024-03-02 —
    │   │    so validate by round-tripping getMonth(), not by range-checking)
    │   ├─ Array → East.Array.range(), .linspace(), .generate() · Set → East.Set.generate() · Dict → East.Dict.generate()
    │   ├─ Blob → East.Blob.encodeBeast() · String → East.String.printJson(), East.String.printError()
    │   ├─ Vector → East.Vector.zeros(), .ones(), .fill(), .fromArray(), .sparseAxpy(), .sparseFromPairs(),
    │   │   .sparseFilterGt() (sparse pairs are {ix: Vector<Integer>, v: Vector<T>}, ix strictly ascending)
    │   └─ Matrix → East.Matrix.zeros(), .ones(), .fill(), .fromArray()
    │
    ├─ Compare and convert (East.*) → East.equal(), East.notEqual(), East.less(), East.greater(), East.lessEqual(),
    │   East.greaterEqual() (and their aliases), East.min(), East.max(), East.clamp(), East.print(expr);
    │   East.is() is identity for mutable collections — FROZEN ones (task inputs) compare by value
    ├─ Patches (East.*) → East.diff(before, after), East.applyPatch(value, patch),
    │   East.composePatch(first, second, type), East.invertPatch(patch, type)
    │
    ├─ Ask a question of a value in jq → East.jq(input, program, resultType), checked when the program
    │   builds → "Queries (typed jq)"
    ├─ Work with East values from TypeScript → "Values in TypeScript" (comparators, SortedMap, codecs)
    ├─ Run a program from the shell → "Runners" (east-node / east-c / east-py run, exec, east-c ir)
    ├─ Run a runner-protocol unit in a host of your own (a browser's worker) → executeUnit(unit, io, { platforms })
    │   over an InMemoryUnitIO ("Units in a host of your own")
    ├─ IR ↔ source → fn.toIR(), encodeEastIR, East.toSource(fn), east-node transpile
    ├─ A function written in python (or another package) → East.importFunction; yours for python → East.exportFunctions
    ├─ Check that a module BUILDS → east-node check (tsc cannot see the build's own errors)
    ├─ A JSON contract for a type → jsonSchemaFor(T) · back from a vendored schema → typeFromJsonSchema(schema)
    └─ Data larger than memory → "Binary serialization (beast2)"; inside a body blob.openBeast(T),
        and a file on the runner's disk FileSystem.openBeast(T, path) (east-node-std / east-c-std / east-py-std)
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

### Trees from flat rows, and recursion

`toTree` builds nested data — any depth, your own node type — from rows that
name their key and their parent's key. `build` runs once per row, children
first; the result is the roots in source order.

```typescript
const Row = StructType({ id: StringType, parent: OptionType(StringType), name: StringType });
const Node = RecursiveType(self => StructType({ name: StringType, children: ArrayType(self) }));

const nest = East.function([ArrayType(Row)], ArrayType(Node), ($, rows) =>
    rows.toTree(Node, ($, r) => r.id, ($, r) => r.parent, ($, r, _i, children) => ({ name: r.name, children })));
```

- A row whose parent is `none` is a root, and so is an orphan (its parent key
  is not in the rows). A repeated key ❗ `toTree: duplicate key <key>`; a cycle
  ❗ `toTree: cycle through key <key>` — both before any `build`.
- A non-recursive `Node` folds bottom-up: `IntegerType` with
  `children.sum().add(1n)` is each root's subtree size.
- **Recursion** — a function calling itself through a captured variable
  (`$.let(fn, FunctionType(...))`, then `$.assign(fn, East.function(...))`) —
  is for shallow depths, in the hundreds. Deeper, a call ❗
  `call stack exhausted: East calls nested too deeply`, a catchable error on
  every runtime. Walk deep data with `$.while` or `toTree`, which is iterative;
  the C and Python runtimes still bound a recursive VALUE's depth to tens of
  thousands of levels.

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

## Values in TypeScript

Host-side functions for East values — build time, no expression, no IR. Each
takes the type and returns a function (`compareFor(T)(a, b)`).

| Signature | Description |
|-----------|-------------|
| **Comparing** |
| `compareFor(T)(a, b): -1 \| 0 \| 1` | East's total order — the order sets, dicts and `.sort()` use (NaN last) |
| `equalFor(T)`, `notEqualFor(T)`, `lessFor(T)`, `lessEqualFor(T)`, `greaterFor(T)`, `greaterEqualFor(T)` | The comparisons as East defines them: by value, NaN equal to itself and −0 apart from 0, variants by case name. Never `===`, `<` or a comparator of your own |
| `isFor(T)(a, b)` | East's `Is`: value for immutable types, identity for mutable containers — but two frozen collections by value, and a `Ref` always by identity |
| `new SortedMap(entries?, compareFor(K))` · `new SortedSet(values?, compareFor(K))` | `Map` / `Set` in East order — what decoders return |
| **Types** |
| `isValueOf(value, T)` | Whether a TypeScript value is a value of `T` |
| `printType(T)` · `isTypeEqual(a, b)` · `isSubtype(a, b)` | Print a type in East text; compare types |
| `diffTypes(actual, expected)` → `renderTypeDiff(diffs)` | The differences between two types, each with its path |
| `defaultValue(T)` · `minimalValue(T)` | A value of `T`: its default, and its least |
| **Codecs** — each `…For(T)` builds a codec for one type |
| `printFor(T)(value)` · `parseFor(T)(text)` | East text, the literal syntax `.east` files hold. `parseFor` returns `{ success, value \| error, position }`; `parseInferred(text)` returns `[type, value]` |
| `toJSONFor(T)(value)` · `fromJSONFor(T)(json)` | East JSON as a JavaScript value (`encodeJSONFor` / `decodeJSONFor` as bytes): lossless — an Integer a quoted decimal, a Blob hex, a flat Option (see JSON Schema) |
| `encodeCsvFor(StructT, config?)(rows)` · `decodeCsvFor(StructT, config?)(blob)` | An array of structs ↔ CSV bytes |
| `encodeBeast2For(T)(value)` · `decodeBeast2For(T)(blob)` | beast2, the binary form every runtime and e3 store — see below |

## Queries (typed jq)

`East.jq` asks a question of a value in jq, inside an East body. The program is
parsed, type-checked against the input's East type and translated to ordinary
IR when the function is built, so it runs on every runner; a mistake is a
`QueryError` at build time, with the checker's sentence, span and fixes. The
language is jq 1.8 over East values: `libs/east/devdocs/QUERY.md` in the East
repository says what each builtin does, and every place East differs from jq.

```typescript
const Order = StructType({ id: IntegerType, total: FloatType });

const bigOrders = East.function([ArrayType(Order)], ArrayType(IntegerType), ($, orders) =>
    East.jq(orders, "[.[] | select(.total > 1000) | .id]", ArrayType(IntegerType)));

// An object of inputs is read as an e3 root: `.orders` is that input alone, so a lazy one stays lazy.
const revenue = East.function([ArrayType(Order)], FloatType, ($, orders) =>
    East.jq({ orders }, ".orders | map(.total) | add", FloatType));
```

| Signature | Description | Example |
|-----------|-------------|---------|
| **In an East body** |
| `East.jq<T>(input: Expr \| { [name: string]: Expr }, program: string, resultType: T): ExprType<T>` **❗** | The query's result, an expression of `resultType`: the outputs' type `T` for a query that gives exactly one output, `Option<T>` for at most one, `Array<T>` for any number. Throws `QueryError` when the query does not check, or checks to another type | `East.jq(orders, "map(.total)", ArrayType(FloatType)).sum()` |
| **Host-side** |
| `checkJq(program: string, input: EastType, options?: { root?: boolean, tooling?: boolean }): CheckJqResult` | The checker: `query` (the checked `QueryType`, or `null`), `diagnostics` (each a code, a span, one sentence, suggestions and fixes), `elementType`, `multiplicity` (`"one"`, `"maybe"` or `"many"`) | `checkJq(".orders[0].totl", Root).diagnostics[0].message` |
| `completeJq(text: string, offset: number, input: EastType, options?): JqCompletions \| null` | The completions at a cursor, from the type there: fields, cases, variables, builtins | `completeJq(".orders[0].to", 13, Root)` |
| `printJq(program: JqNode, options?: { layout?: "line" \| "pipeline" }): PrintedJq` | A program's canonical text, and its nodes' spans; `pipeline` puts each top-level stage on a line of its own | `printJq(checked.query.value.program).text` |
| `translateJq(checked: CheckJqResult, options?: { maxOutputs?: number, tooling?: boolean }): JqTranslation` **❗** | The translation: `fn()`, an East function of the inputs the query reads (`inputs`), and its `resultType` | `East.compile(translateJq(checked).fn(), [])` |
| `evaluateJq(program: string \| CheckJqResult, input: unknown, options?: { inputType?, root?, tooling?, platform? }): unknown` **❗** | Checks, translates, compiles (cached) and runs a query over a TypeScript value. Throws `QueryError`: the checker's diagnostics, or one `runtime` diagnostic at the node that raised | `evaluateJq("[.[] \| .id]", orders, { inputType: ArrayType(Order) })` |
| `splitJq(checked: CheckJqResult, options?: { maxOutputs?: number }): JqSplit` | A query checked as an e3 root, split over one dataset's pieces for an e3 split call: `piece()` each piece runs, the `output` kind its outputs combine by (`array`, `set`, `dict` with `merge()`, `fold` with `zero` and `combine()`), and `then()` over the result; or, `kind: "whole"`, why it runs as one unit. QUERY.md §17.1 | `splitJq(checkJq(".orders \| group_by(.region) \| map(length)", Root, { root: true })).output.kind` |

- **The values are East's.** A Dict is an object keyed by its key type, so
  `.byId[1035]` looks up an Integer key; a variant reads as `{type, value}`,
  and `select(.status.type == "shipped")` narrows it; an Option is `null` or
  its value. `.name` on a struct that lacks the field is an error (`.name?`
  gives `null`), and so is comparing values of two types.
- **A lookup can miss**, so `.[i]` and `.[k]` give an `Option`, and
  `first(f)` gives at most one output, so its result type is `Option<T>`.
- **In code a query is a call of the `Query` builtin**, which carries the
  program as written beside its translation: every runtime runs it as any
  builtin, and `East.toSource` prints it back as `East.jq(…)`.

## Runners: running a program from the command line

A program's IR runs on any of three runners, which take the same arguments.
Write it with `writeFileSync("prog.beast2", encodeEastIR(fn.toIR()))` — which
keeps its source map, so errors name your lines — or `fn.toIR().toJSON()`.

```bash
east-node run prog.beast2 -p @elaraai/east-node-std -i a.beast2 -i b.beast2 -o out.beast2   # -v: timing and peak memory
east-c    run prog.beast2 -p east-c-std -i a.beast2 -o out.beast2 [--profile]             # native; --profile: time per function
east-py   run prog.beast2 -p east-py-std -i a.beast2 -o out.beast2                        # python (the east-py skill)
```

- Each `-i` is one argument, in parameter order, and each `-p` loads one
  platform package (east-node needs at least one); `-o` writes the result,
  else it is printed. IR and values may be `.beast2`, `.beast`, `.east` or
  `.json`.
- `exec <unit>` is the runner protocol e3 speaks: it runs one unit file — a
  program over its inputs, a merge of an output's parts, or the intake of a
  delivered collection — writes the output by its kind and records a result;
  exit 0 when it succeeded, 1 when it failed.
- `version [-p <package>…]` prints the runner's version and each package's.
- east-c also has `convert <file> [-o <file>] [--type <east-type>]`, a value
  from one format to another, and the IR toolbox: `ir normalize` (the canonical
  form — the round-trip equality contract), `ir diff a b` (the first structural
  difference) and `ir convert` (JSON ↔ beast2, the source map kept).
- east-node also has `transpile`, `check`, `lsp` and `export-functions`, below;
  east-py has the python twins, and `lint`.

### Units in a host of your own: `executeUnit` and `UnitIO`

east-node's `exec` is a file wrapper around `executeUnit`, the one TypeScript
unit runner, which does a unit's work over a `UnitIO` rather than a file
system — so a host with none runs units too: e3-web runs them in a browser's
Web Workers. east-c has the same shape (`east/unit.h`).

| Signature | Description |
|-----------|-------------|
| `executeUnit(unit: Unit, io: UnitIO, options: ExecuteUnitOptions): Promise<UnitResult>` | Does the unit's work — a run, a merge or an intake — over `io`, writing its output there by its kind, and returns the result, which the host writes where `unit.result` says if it keeps it. A failure is the result's `outcome`, `failed` with its message and source locations, never a throw |
| `options.platforms(name: string): readonly PlatformFunction[] \| Promise<…>` | Each package the unit lists, asked once, in the unit's order, before the work begins; a throw fails the unit with its message |
| `options.resident?: () => number` · `options.peakBytes?: () => bigint` | The host's memory gauges. Without `resident`, what reading a lazy input whole weighs and what decoding an input whole added both come to 0; without `peakBytes`, the result's `peakBytes` is 0, as a browser's is |
| `options.report?: UnitRunReport` | Hears how a run unit's inputs open and what reading them came to: the account `exec -v` prints |
| `UnitIO` | The unit's files, by the paths it names: `read`, `size`, `readRange`, `segment(path, fetch)`, `list`, `makeDirectory`, `write` — every one synchronous, since compiled East reads a lazy input without awaiting |
| `new InMemoryUnitIO(files?: Iterable<[path: string, bytes: Uint8Array]>)` | A `UnitIO` in memory, for a host with no file system: given every file the unit names, segments included; `.files` then holds them and every file the unit wrote |
| `UnitType` · `UnitResultType` | The unit and its result as East types, for a host that keeps them as beast2 |

- The unit's thread grant (`threads`) caps the frame pool for the rest of the
  process: a grant of one frames every output inline.
- A unit whose host places segments as they are read (`fetch: true`) has
  `io.segment` asked for each segment of a staged manifest before it is read.
  `InMemoryUnitIO` holds every segment already, so its unit says `fetch: false`,
  and a segment it does not hold fails at once, as any absent file does.

```typescript
import { East, IntegerType, InMemoryUnitIO, decodeBeast2For, encodeBeast2For, encodeEastIR, executeUnit, variant, type Unit } from "@elaraai/east";

const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));

// A unit names its files by path: here, the program, its one input and its output.
const unit: Unit = {
    work: variant("run", {
        program: "program.beast2",
        inputs: ["x.beast2"],
        output: variant("value", "out.beast2"),
        decode: variant("lazy", null),
    }),
    platforms: [],          // the platform packages it needs, each resolved by `options.platforms`
    threads: 1n,
    fetch: false,           // every segment it reads is in the IO already
    result: "result.beast2",
};
const io = new InMemoryUnitIO([
    ["program.beast2", encodeEastIR(double.toIR())],
    ["x.beast2", encodeBeast2For(IntegerType)(21n)],
]);
const result = await executeUnit(unit, io, { platforms: () => [] });
// result.outcome: ok, or failed with its message and source locations; a failure is never thrown
decodeBeast2For(IntegerType)(io.read("out.beast2"));   // 42n
```

## IR → source: `East.toSource` and `east-node transpile`

Any IR — yours, or one exported from python — prints back as a module whose
`East.function(...)` rebuilds the same IR (equal under `east-c ir normalize`).

```typescript
const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
console.log(East.toSource(double));
// import { East, … IntegerType } from "@elaraai/east";
// export const main = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
```

```bash
east-node transpile double.beast2 -o double.ts                  # any runtime's IR
east-node transpile ./ir/ -o ./ts/ --rebuild ./rebuilt/          # a directory, and the IR each module builds back
east-py transpile double.beast2 -o double.py                     # the python twin
```

- Statements print as the `$`-forms, a bound value as `$.let(value, T)`, an
  Option as `some(v)` / `none`, other values as `East.value(v, T)`, builtins as
  their methods; one with no method spelling prints as
  `East.builtin(name, [T...], [args], out)`, which rebuilds. `East.as(v, T)` and
  `East.wrapRecursive(v, T)` spell the `As` and `WrapRecursive` nodes.
- A platform call prints as its library spells it when you pass the library:
  `East.toSource(fn, { libraries: { "@elaraai/east-node-io": await import("@elaraai/east-node-io") } })`.
  Without it the call hoists to a declaration named after the function
  (`const tar_create = East.asyncPlatform("tar_create", …)`). The printer finds
  the handles in the module's exports — each handle `East.platform` returns
  carries its `name`, `inputs`, `output` and `async`, and
  `isPlatformDeclaration(x)` tells one from a function.
- Variables keep the names you wrote, read by the TypeScript compiler (an
  optional peer); without it, or in a browser, they print as `_N`, as does a
  slot the body did not name (`($, x) =>` for a `(value, index)` callback).
- The contract and the round-trip suites: `docs/conventions/EAST_CODEGEN.md`.

## Checking that a module builds: `east-node check`

`tsc` type-checks the TypeScript around a program, not the program: East's own
refusals — a body whose type differs from the declared output, a capture the
builder refuses, an `IRAnalysisError` — happen when `East.function` runs, at
import.

```bash
east-node check dist/index.js                 # every broken function, at its line
east-node check dist/index.js --format json   # the records `east-py check --format json` emits
east-node lsp                                 # the diagnostics over stdio (needs @elaraai/east-diagnostics)
```

It reports **every** broken function, not the first. Importing a module runs
it, so `EAST_CHECK=1` is set meanwhile, and a module should skip import-time
work when it sees it. Edit-time idiom checks are separate:
`@elaraai/tsserver-plugin-east` in the editor, `@elaraai/eslint-plugin-east`'s
`east/east-rules` in `make lint`.

## Cross-language functions: `East.importFunction` / `East.exportFunctions`

A function authored in python (with its `East.function`) is called from a
TypeScript body by name, and the other way round; the deployed program is pure
IR. Functions travel as a **manifest** — their IR, declared types and platform
dependencies. In an e3 project `e3.export` builds and links manifests itself
(see **e3**); by hand:

```bash
east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std     # python side
east-node export-functions dist/maths.js -o maths.functions.beast2               # reads the module's `eastFunctions`
```

```typescript
const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));   // typed, callable
const total = East.function([ArrayType(RowType)], FloatType, ($, rows) => rows.map(($, r) => score(r)).sum());

// in-process: link, then compile — linkImports returns a sync or async function's IR
const { ir } = East.linkImports(total, [East.decodeFunctionManifest(readFileSync("pricing.functions.beast2"))]);
new EastIR(ir as FunctionIR).compile([])(rows);

// export TypeScript functions for python to import
writeFileSync("maths.functions.beast2", East.encodeFunctionManifest(East.exportFunctions("maths", "1.0.0", { double, halve })));
```

- The declared type must equal the exported type **exactly** — a mismatch is a
  build error naming both. Unlinked, the reference is a `Platform` node named
  `east.importFunction`, so compiling it without linking fails loudly.
- Only closed values export: no captures, and no unresolved imports of their own.
- The imported function's platform calls must be provided by the consuming
  runner (stock families count across runtimes: `east-py-std` ≡
  `@elaraai/east-node-std` ≡ `east-c-std`). See `docs/conventions/EAST_CODEGEN.md`.

## A JSON contract for a type: `jsonSchemaFor` / `typeFromJsonSchema`

`East.String.printJson` writes East JSON, lossless and self-describing.
`jsonSchemaFor(T)` emits the JSON Schema of exactly that encoding, so a third
party can validate a payload before sending it; `typeFromJsonSchema` goes the
other way. Both are host-side, like `compareFor`.

```typescript
writeFileSync("contract.schema.json", JSON.stringify(jsonSchemaFor(ArrayType(ReadingType), { draft: "draft-07" }), null, 2));
const T = typeFromJsonSchema(JSON.parse(readFileSync("partner.schema.json", "utf-8")));
```

| Signature | Description |
|-----------|-------------|
| `jsonSchemaFor(type, options?: { draft }): JsonSchema` | The schema of `type`'s East JSON. `draft`: `"2020-12"` (default), `"draft-07"` or `"openapi-3.0"`. Throws on `Never`, `Function`, `AsyncFunction` |
| `typeFromJsonSchema(schema): EastType` | The type a schema describes. Throws `JsonSchemaUnsupportedError`, with the RFC 6901 pointer, on a keyword East cannot express (`allOf`, `not`, `if`/`then`/`else`, `anyOf`, an open record, …) |
| `EAST_JSON_PATTERNS` | The lexical forms of East JSON's scalars (`integer`, `blob`, `floatSpecials`), for a reader enforcing exactly what the schema says |

- **An `Option<T>` is `null` or `T`'s own encoding** wherever `T` can never
  encode as `null` (`none` → `null`, `some(7n)` → `"7"`; a struct field is
  `"note": null` or `"note": "x"`, and an absent key is still an error). Only
  `Option<Null>` and `Option<Option<T>>` keep the tagged
  `{"type": …, "value": …}` object. A `Recursive` payload is judged by what it
  wraps. The rule is a total function of the type, the same on every runtime,
  and the tagged object under a flat Option is refused by the payload's decoder
  (`expected string, got {"type":"none","value":null}`).
- **A `DateTime` is `format: "date-time"`**: every decoder reads any RFC 3339
  date-time — `Z` or any offset (read as UTC), `t`/`z` in either case, any
  fractional digits (past the millisecond dropped, never rounded), a leap second
  as the Unix time its fields add up to — in years 0001–9999. `printJson`
  writes one form: UTC, three fractional digits, `+00:00`.
- **Other scalars are described as the encoder emits them**: an `Integer` a
  quoted i64 decimal, a `Blob` lowercase hex (`parseJson` also takes uppercase,
  which the contract does not), so a producer that validates never sends what
  the strict reader rejects. The patterns spell digits `[0-9]`, so python and
  JavaScript validators accept the same strings.
- **The document is deterministic and identical across languages** (east-py's
  `json_schema_for` emits the same bytes), and its `x-east-type` annotations
  make the inverse exact: `Set` vs `Array`, `Dict` vs an array of pairs, a flat
  Option vs any `oneOf`. A foreign schema without them converts by a
  documented structural mapping; `nullable: true`, `["string", "null"]` and a
  `oneOf` of null and one schema read as an Option, and a
  `format: "date-time"` string as a `DateTime`.
- **Recursion binds one `RecursiveType` per cycle group**; definitions that
  need two binders are refused, naming them.
- To READ a JSON document larger than memory under a contract, use `Json.open`
  / `Json.next` from **east-node-std** (and its east-py-std and east-c-std twins).

## Binary serialization (beast2)

Inside a body the builtins are `East.Blob.encodeBeast(value, 'v2')` and
`blob.decodeBeast(type, 'v2')`; the functions below are the **host-side**
TypeScript API for the same format. Blobs are self-describing, and a decoder
reads any container version its type was written in.

| Signature | Description |
|-----------|-------------|
| **Whole values** |
| `encodeBeast2For(T, opts?): (value) => Uint8Array` | `opts.version` (`5` default, `4` for legacy readers); `opts.codec` (`"deflate"` \| `"none"`) and `opts.index` for v5 |
| `decodeBeast2For(T, opts?): (blob) => ValueTypeOf<T>` | Any container version, in every runtime and browser. The blob's header type must be `T`, or a subtype whose variant cases line up with `T`'s (a `none` reads as any `Option`); any other is refused — `beast2: cannot decode a blob of type … as …`, the words east-c and east-py use. `opts.platform` for decoded functions |
| `decodeBeast2(blob)` → `{ type, value }` | Without knowing the type |
| `decodeBeast2ForAsync(T)` | The same, decompressing through the platform's `DecompressionStream` — faster for large blobs in a browser |
| `encodeEastIR(ir)` · `decodeEastIR(blob)` | A program with its source map |
| **Collections larger than memory** (v5) |
| `new Beast2ElementWriter(T, sink, opts?)` | The canonical writer: `.add(element)` one Array/Set element or Dict `[key, value]` — Set elements and Dict keys strictly ascending in East order — and the content-defined cut rule places the segments, so the bytes are a function of the value, identical from east-c and east-py, and a one-row edit re-cuts only the segments around it. Memory is one segment; `.finish()` writes the last, the terminator and the index. `sink` is `(bytes) => void`, or `{ segment(s) }` for one standalone segment blob at a time (`s`: `{ count, fence, logicalBytes, blob }`, under `writer.header`) |
| `encodeBeast2PagedFor(T)(value)` | One value in memory through the element writer; plain `Map`/`Set` inputs are sorted first |
| `new Beast2RunSorter(T, openRun, { merge } \| { union })` | Elements in ANY order in, sorted canonical runs out (a key added twice folds with `merge(key, acc, value)`, or `union` for a Set; without one it throws); then `mergeBeast2For(T, { merge } \| { union })(runs, sink)` writes the value. Memory is one run, then one segment per run. A run closes at `RUN_MAX_COUNT` elements or `RUN_MAX_BYTES`, platform constants, so every runtime writes the same runs |
| `mergeBeast2For(T, opts?)(sources, sink)` | Sorted collections — blobs, range readers or manifests — into their union's blob or manifest, segment by segment; a key several hold folds in input order; `opts.from` / `opts.to` merge a key range |
| `recutBeast2For(T)(pieces, sink)` | A collection in pieces, some already written, into its canonical segments: a segment the whole shares with its piece is carried unread (`sink.carried`), the rest re-cut (`sink.written`) |
| `intakeBeast2For(T)(delivery, sink, opts?)` | A collection from outside — a `Beast2SyncRangeReader` over a v4 or v5 blob whose header names exactly `T` — through the Writer into a `Beast2ManifestSink`, a segment at a time: each row is walked by its type, the Writer's own bytes go on as they stand, and any other row is decoded and written again. `opts.segments` takes in the index's segments `[from, to)`, a piece of a large delivery. Refuses another type, a malformed segment or one over `RUN_MAX_BYTES`, a row that does not decode, and keys that do not ascend, with `Beast2IntakeError` in the words every runner uses. What e3's intake units run, on every runner |
| `new Beast2Writer(T, sink)` · `encodeBeast2SegmentsFor(T)(batches)` | Segments of your own choosing: one per non-empty batch, Set/Dict batches in ascending order |
| `iterBeast2SegmentsFor(T)(blob)` | One decoded segment at a time |
| `openBeast2PagesFor(T)(source)` | Random access: `.elementCount` and `.segmentCount` in O(1); `.segment(i)`, `.element(row)`, `.slice(offset, limit)` and `.get(key)` decode only the segments they touch |
| `openBeast2LazyFor(T, { frozen? })(source)` | An ordinary `SortedMap` / `SortedSet` / array served from the index, a segment at a time — what `blob.openBeast` and `FileSystem.openBeast` return, frozen. `isBeast2LazySafe(T, { frozen })`: only `Ref`- and function-bearing shapes decode whole |
| `Beast2SyncRangeReader` — `{ size, read(offset, length) }` | Positioned reads, wherever a blob goes, so a file's bytes never sit on the heap whole; `readBeast2Extents` / `readBeast2ExtentsRanged` (HTTP, S3) read the geometry |
| **Segment manifests** — one object per segment plus a manifest naming them: how e3 stores a collection |
| `new Beast2ManifestWriter(T, { object(hash, bytes), manifest(bytes) })` | The canonical manifest directory: the header, each segment as it is cut (named by its SHA-256, `<manifest>.segments/<hash>.beast2` on disk), then the manifest; east-c and east-py write the same |
| `readBeast2Manifest(source)` | The manifest a blob holds (`{ kind, level, type, rule, header, entries: [{ hash, fence, count, bytes }] }`), or `null`; `manifestElementCount` / `manifestByteSize` total it |
| `{ manifest, segment(i) }` (`Beast2ManifestSource`) | A manifest-held collection wherever a blob goes; `segment(i)` is called only for a segment a read decodes |
| `spliceBeast2Segments(head, segments)` | A manifest's segments spliced back into one blob, a chunk at a time, decoding nothing and holding only the segment in hand — how e3-api-client downloads a collection. Throws on a segment that is not a segmented, indexed v5 collection, or was written under another header |
| `sha256Hex(bytes)` | SHA-256 in lowercase hex, pure TypeScript |

```typescript
import { ArrayType, StructType, StringType, IntegerType,
         Beast2ElementWriter, iterBeast2SegmentsFor, openBeast2PagesFor, decodeBeast2For } from "@elaraai/east";

const Rows = ArrayType(StructType({ id: IntegerType, name: StringType }));

const out = createWriteStream("rows.beast2");
const writer = new Beast2ElementWriter(Rows, bytes => out.write(bytes));
for (const row of rows) writer.add(row);            // never whole in memory
writer.finish();

const blob = new Uint8Array(readFileSync("rows.beast2"));
decodeBeast2For(Rows)(blob);                        // whole: segments concatenate
for (const segment of iterBeast2SegmentsFor(Rows)(blob)) consume(segment);   // a segment at a time
openBeast2PagesFor(Rows)(blob).element(4_000_000);  // one row: decodes ONE segment
```

- Set and Dict segments hold the canonical value — strictly ascending,
  disjoint, no duplicate keys — so writers refuse out-of-order elements and
  decoders refuse a non-canonical blob as corrupt.
- **One encoding per value**: the element writer and `encodeBeast2PagedFor` cut
  by the same rule in every runtime, so equal values are equal bytes and share
  segments in a content-addressed store. `Beast2Writer` writes the batches you
  give it, which every reader also reads.
- Streaming and paging are v5 only. The writer's segments are self-contained,
  with an index, which paging and parallel decode need: pass
  `{ selfContained: false }` only when aliasing must span segments. `write()`
  skips an empty batch, so a segment count is never zero.
- Inside a body, `blob.openBeast(T)` and `FileSystem.openBeast(T, path)` hand
  back the frozen lazy value a runner gives a large task input: keyed reads and
  `$.for` cost one segment, mutation is refused (`.copy()` first), and the
  header type is checked against `T` first. `East.Blob.encodeBeast` writes no
  index, so a paged blob comes from the writers above or a runner's output.

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
