---
name: east
description: "East programming language - a statically typed, expression-based language embedded in TypeScript. Use when writing East programs with @elaraai/east. Triggers for: (1) Writing East functions with East.function() or East.asyncFunction(), (2) Defining types (IntegerType, StringType, ArrayType, StructType, VariantType, etc.), (3) Using platform functions with East.platform() or East.asyncPlatform(), (4) Compiling East programs with East.compile(), (5) Working with East expressions (arithmetic, collections, control flow), (6) Serializing East IR with .toIR() and EastIR.fromJSON(), (7) Standard library operations (formatting, rounding, generation)."
---

# East Language

A statically typed, expression-based programming language embedded in TypeScript. Write programs using a fluent API, compile to portable IR.

## Quick Start

```typescript
// Types and helpers are direct imports (NOT East.IntegerType)
import { East, IntegerType, StringType, ArrayType, NullType } from "@elaraai/east";

// 1. Define platform functions (East.platform)
const log = East.platform("log", [StringType], NullType);
const platform = [log.implement(console.log)];

// 2. Define East function (East.function)
const sumArray = East.function([ArrayType(IntegerType)], IntegerType, ($, arr) => {
    const total = $.let(arr.sum());
    $(log(East.str`Sum: ${total}`));
    $.return(total);
});

// 3. Compile and execute (East.compile)
const compiled = East.compile(sumArray, platform);
compiled([1n, 2n, 3n]);  // logs "Sum: 6", returns 6n
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Create East Expressions (East.*)
    │   ├─ From TypeScript value → East.value(tsValue) or East.value(tsValue, Type)
    │   ├─ String interpolation → East.str`Hello ${name}!`
    │   └─ Inside function body → $.let(value), $.const(value)
    │
    ├─ Define a Type (import from package, NOT East.*)
    │   ├─ Primitive → IntegerType, FloatType, StringType, BooleanType, DateTimeType, BlobType, NullType
    │   ├─ Collection → ArrayType(T), SetType(K), DictType(K, V), RefType(T)
    │   ├─ Numeric → VectorType(T), MatrixType(T) where T is FloatType, IntegerType, or BooleanType
    │   ├─ Compound → StructType({...}), VariantType({...}), RecursiveType(...)
    │   ├─ Function → FunctionType<I, O>, AsyncFunctionType<I, O>
    │   └─ Patch → PatchType(T) (compute patch type for any East type)
    │
    ├─ Create TypeScript Values for East Types
    │   ├─ NullType → null
    │   ├─ BooleanType → true, false
    │   ├─ IntegerType → 42n (bigint literal)
    │   ├─ FloatType → 3.14 (number literal)
    │   ├─ StringType → "hello"
    │   ├─ DateTimeType → new Date("2025-01-01T00:00:00Z")
    │   ├─ BlobType → new Uint8Array([...])
    │   ├─ ArrayType(T) → [1n, 2n, 3n]
    │   ├─ SetType(K) → new Set([1n, 2n, 3n])
    │   ├─ DictType(K, V) → new Map([["a", 1n], ["b", 2n]])
    │   ├─ StructType({...}) → { field1: value1, field2: value2 }
    │   ├─ VariantType({...}) (use helpers from package)
    │   │   ├─ Option type → some(value), none  ← preferred for Option/Maybe
    │   │   └─ Other variants → variant("caseName", value)
    │   ├─ VectorType(FloatType) → new Float64Array([1.0, 2.0, 3.0])
    │   ├─ VectorType(IntegerType) → new BigInt64Array([1n, 2n, 3n])
    │   ├─ VectorType(BooleanType) → new Uint8ClampedArray([1, 0, 1])
    │   ├─ MatrixType(FloatType) → matrix(Float64Array.from([1.0, 2.0, 3.0, 4.0]), 2, 2)
    │   ├─ MatrixType(IntegerType) → matrix(BigInt64Array.from([1n, 2n, 3n, 4n]), 2, 2)
    │   ├─ MatrixType(BooleanType) → matrix(Uint8ClampedArray.from([1, 0, 0, 1]), 2, 2)
    │   └─ RefType(T) (use helper from package) → ref(value)
    │
    ├─ Write a Function (East.*)
    │   ├─ Synchronous → East.function([inputs], output, ($, ...args) => { ... })
    │   └─ Asynchronous → East.asyncFunction([inputs], output, ($, ...args) => { ... })
    │
    ├─ Compile and Execute (East.*)
    │   ├─ Sync function → East.compile(fn, platform)
    │   └─ Async function → East.compileAsync(fn, platform)
    │
    ├─ Use Platform Effects (East.*)
    │   ├─ Sync effect → East.platform("name", [inputs], output).implement(fn)
    │   └─ Async effect → East.asyncPlatform("name", [inputs], output).implement(fn)
    │
    ├─ Block Operations ($)
    │   ├─ Variables → $.let(value), $.const(value), $.assign(var, value)
    │   ├─ Execute → $(expr), $.return(value), $.error(message)
    │   ├─ Control Flow → $.if(...), $.while(...), $.for(...), $.match(...), $.matchTag(...)
    │   └─ Error Handling → $.try(...).catch(...).finally(...)
    │
    ├─ Expression Operations
    │   ├─ Boolean
    │   │   ├─ Logic → .and($=>), .or($=>), .not(), .ifElse($=>,$=>)
    │   │   ├─ Bitwise → .bitAnd(), .bitOr(), .bitXor()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne()
    │   ├─ Integer
    │   │   ├─ Math → .add()/.plus(), .subtract()/.sub()/.minus(), .multiply()/.mul()/.times(), .divide()/.div(), .remainder()/.mod()/.rem()/.modulo(), .pow(), .abs(), .sign(), .negate(), .log()
    │   │   ├─ Convert → .toFloat()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne(), .lessThan()/.less()/.lt(), .greaterThan()/.greater()/.gt(), .lessThanOrEqual()/.lessEqual()/.lte()/.le(), .greaterThanOrEqual()/.greaterEqual()/.gte()/.ge()
    │   ├─ Float
    │   │   ├─ Math → .add()/.plus(), .subtract()/.sub()/.minus(), .multiply()/.mul()/.times(), .divide()/.div(), .remainder()/.mod()/.rem()/.modulo(), .pow(), .abs(), .sign(), .negate()
    │   │   ├─ Advanced → .sqrt(), .exp(), .log(), .sin(), .cos(), .tan()
    │   │   ├─ Convert → .toInteger()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne(), .lessThan()/.less()/.lt(), .greaterThan()/.greater()/.gt(), .lessThanOrEqual()/.lessEqual()/.lte()/.le(), .greaterThanOrEqual()/.greaterEqual()/.gte()/.ge()
    │   ├─ String
    │   │   ├─ Transform → .concat(), .repeat(), .substring(), .upperCase(), .lowerCase(), .trim(), .trimStart(), .trimEnd()
    │   │   ├─ Replace → .replace(), .replaceAll(), .split()
    │   │   ├─ Query → .length(), .startsWith(), .endsWith(), .contains(), .indexOf(), .charAt()
    │   │   ├─ Parse → .parse(), .parseJson()
    │   │   ├─ Encode → .encodeUtf8(), .encodeUtf16()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne(), .lessThan()/.less()/.lt(), .greaterThan()/.greater()/.gt(), .lessThanOrEqual()/.lessEqual()/.lte()/.le(), .greaterThanOrEqual()/.greaterEqual()/.gte()/.ge()
    │   ├─ DateTime
    │   │   ├─ Components → .getYear(), .getMonth(), .getDayOfMonth(), .getDayOfWeek(), .getHour(), .getMinute(), .getSecond(), .getMillisecond()
    │   │   ├─ Arithmetic → .addDays(), .subtractDays(), .addHours(), .subtractHours(), .addMinutes(), .addSeconds(), .addMilliseconds(), .addWeeks()
    │   │   ├─ Duration → .durationDays(), .durationHours(), .durationMinutes(), .durationSeconds(), .durationMilliseconds(), .durationWeeks() ❗ a.durationDays(b) = b − a (positive when b is later)
    │   │   ├─ Convert → .toEpochMilliseconds(), .printFormatted()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne(), .lessThan()/.less()/.lt(), .greaterThan()/.greater()/.gt(), .lessThanOrEqual()/.lessEqual()/.lte()/.le(), .greaterThanOrEqual()/.greaterEqual()/.gte()/.ge()
    │   ├─ Blob
    │   │   ├─ Read → .size(), .getUint8()
    │   │   ├─ Decode → .decodeUtf8(), .decodeUtf16(), .decodeBeast(), .decodeCsv(rowType, { nullStrings: [] by default (empty field == empty string; opt in for none), defaults: per-column fallback/constant-fill, skipShortRows: drop ragged rows instead of erroring, trimFields, … })
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne()
    │   ├─ Array
    │   │   ├─ Read → .size(), .length(), .has(), .get(), .at(), .tryGet(), .getKeys()
    │   │   ├─ Mutate → .update(), .pushLast(), .popLast(), .pushFirst(), .popFirst(), .append(), .prepend(), .clear(), .sortInPlace(), .reverseInPlace()
    │   │   ├─ Transform → .copy(), .slice(), .concat(), .sort(), .reverse(), .map(), .filter(), .filterMap(), .flatMap()
    │   │   ├─ Search → .findFirst(), .findAll(), .firstMap(), .isSorted()
    │   │   ├─ Reduce → .reduce(), .scan(), .every(), .some(), .sum(), .mean(), .maximum(), .minimum(), .findMaximum(), .findMinimum()
    │   │   ├─ Convert → .stringJoin(), .toSet(), .toDict(), .flattenToSet(), .flattenToDict(), .encodeCsv()
    │   │   ├─ Group → .groupReduce(), .groupSize(), .groupSum(), .groupMean(), .groupMinimum(), .groupMaximum(), .groupToArrays(), .groupToSets(), .groupToDicts(), .groupEvery(), .groupSome()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne()
    │   ├─ Set
    │   │   ├─ Read → .size(), .has()
    │   │   ├─ Mutate → .insert(), .tryInsert(), .delete(), .tryDelete(), .clear(), .unionInPlace()
    │   │   ├─ Set Ops → .copy(), .union(), .intersection(), .difference(), .symmetricDifference(), .isSubsetOf(), .isSupersetOf(), .isDisjointFrom()
    │   │   ├─ Transform → .filter(), .filterMap(), .map(), .forEach(), .firstMap()
    │   │   ├─ Reduce → .reduce(), .scan(), .every(), .some(), .sum(), .mean()
    │   │   ├─ Convert → .toArray(), .toSet(), .toDict(), .flattenToArray(), .flattenToSet(), .flattenToDict()
    │   │   ├─ Group → .groupReduce(), .groupSize(), .groupSum(), .groupMean(), .groupToArrays(), .groupToSets(), .groupToDicts(), .groupEvery(), .groupSome()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne()
    │   ├─ Dict
    │   │   ├─ Read → .size(), .has(), .get(), .tryGet(), .keys(), .getKeys()
    │   │   ├─ Mutate → .insert(), .insertOrUpdate(), .update(), .merge() (ONE key, like Array/Ref .merge), .getOrInsert(), .delete(), .tryDelete(), .pop(), .swap(), .clear(), .unionInPlace(), .mergeAll()
    │   │   ├─ Transform → .copy(), .union() (pure whole-dict; east-py spells it union too — .merge() there is the deprecated alias, #527), .map(), .filter(), .filterMap(), .forEach(), .firstMap()
    │   │   ├─ Reduce → .reduce(), .scan(), .every(), .some(), .sum(), .mean()
    │   │   ├─ Convert → .toArray(), .toSet(), .toDict(), .flattenToArray(), .flattenToSet(), .flattenToDict()
    │   │   ├─ Group → .groupReduce(), .groupSize(), .groupSum(), .groupMean(), .groupToArrays(), .groupToSets(), .groupToDicts(), .groupEvery(), .groupSome()
    │   │   └─ Compare → .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne()
    │   ├─ Vector
    │   │   ├─ Read → .length(), .get()
    │   │   ├─ Functional update → .set() (returns a new vector)
    │   │   ├─ Transform → .slice(), .concat(), .map(), .reduce()
    │   │   ├─ Arithmetic (Float/Integer elements) → .scale(), .addScaled(), .mul(), .addScalar(), .abs(), .clamp(), .cumSum()
    │   │   ├─ Reduce (left-to-right index order) → .sum(), .dot(), .max(), .min(), .argMax(), .argMin(), .mean() ❗ empty vector: sum()==0, max/min/argMax/argMin raise
    │   │   ├─ Masks (Vector<Boolean>) → .eq(), .lt(), .gt(), then mask.select(a, b), data.compress(mask), mask.countTrue()
    │   │   ├─ Gather / scatter / search → .gather(indices), .scatterAdd(indices, src), .searchSorted(needles) (receiver sorted ascending; leftmost insertion point)
    │   │   └─ Convert → .toArray(), .toMatrix()
    │   ├─ Matrix
    │   │   ├─ Read → .rows(), .cols(), .get(), .getRow(), .getCol()
    │   │   ├─ Functional update → .set() (returns a new matrix)
    │   │   ├─ Transform → .transpose()
    │   │   ├─ Arithmetic (Float/Integer elements) → .scale(), .addScaled(), .mulElementwise()
    │   │   ├─ Reduce → .rowSums(), .colSums(), .vecMul(v) ❗ cols must equal v.length()
    │   │   └─ Convert → .toVector(), .toArray()
    │   ├─ Struct → .fieldName (direct property access)
    │   ├─ Variant → .match(), .matchTag(), .unwrap(), .hasTag(), .getTag(), .equals()/.equal()/.eq(), .notEquals()/.notEqual()/.ne()
    │   └─ Ref → .get(), .update(), .merge()
    │
    ├─ Standard Library (East.*)
    │   ├─ Integer → East.Integer.printCommaSeperated(), .roundNearest(), .printOrdinal()
    │   ├─ Float → East.Float.roundToDecimals(), .printCurrency(), .printCompact()
    │   ├─ DateTime → East.DateTime.fromComponents(), .roundDownDay(), .parseFormatted()
    │   ├─ Array → East.Array.range(), .linspace(), .generate()
    │   ├─ Set → East.Set.generate()
    │   ├─ Dict → East.Dict.generate()
    │   ├─ Blob → East.Blob.encodeBeast(), blob.decodeCsv(), array.encodeCsv()
    │   ├─ Vector → East.Vector.zeros(), .ones(), .fill(), .fromArray(), .sparseAxpy(), .sparseFromPairs(), .sparseFilterGt() (sparse pairs are {ix: Vector<Integer>, v: Vector<T>}, ix strictly ascending)
    │   ├─ Matrix → East.Matrix.zeros(), .ones(), .fill(), .fromArray()
    │   └─ String → East.String.printJson(), East.String.printError()
    │
    ├─ Comparisons (East.*)
    │   ├─ Equality → East.equal()/.equals()/.eq(), East.notEqual()/.notEquals()/.ne()
    │   ├─ Ordering → East.less()/.lessThan()/.lt(), East.greater()/.greaterThan()/.gt()
    │   ├─ Bounds → East.lessEqual()/.lte()/.le(), East.greaterEqual()/.gte()/.ge()
    │   ├─ Identity → East.is() (identity for mutable collections; FROZEN collections — task inputs — compare by value; East.equal() for value equality)
    │   └─ Utilities → East.min(), East.max(), East.clamp()
    │
    ├─ Conversion (East.*)
    │   └─ To string → East.print(expr)
    │
    ├─ Patch Operations (East.*)
    │   ├─ Compute diff → East.diff(before, after) → returns patch
    │   ├─ Apply patch → East.applyPatch(value, patch) → returns patched value
    │   ├─ Compose patches → East.composePatch(first, second, type) → returns combined patch
    │   └─ Invert patch → East.invertPatch(patch, type) → returns undo patch
    │
    └─ Serialization
        ├─ IR → fn.toIR(), ir.toJSON(), EastIR.fromJSON(data).compile(platform)
        ├─ Data, INSIDE an East function → East.Blob.encodeBeast(value, 'v2'), blob.decodeBeast(type, 'v2')
        └─ Data, from TypeScript (host side, `@elaraai/east`) — see "Binary serialization (beast2)"
            ├─ Whole value → encodeBeast2For(T)(value) / decodeBeast2For(T)(blob)
            │   └─ Don't know the type? → decodeBeast2(blob) → { type, value }
            ├─ Collection too big for memory
            │   ├─ Write → new Beast2Writer(T, sink); w.write(batch); w.finish()  — memory is ONE batch; Set/Dict batches must ascend in East key order
            │   │   └─ already in memory → encodeBeast2SegmentsFor(T)(batches)
            │   ├─ Read a batch at a time → iterBeast2SegmentsFor(T)(blob)   — O(segment)
            │   └─ Read whole (segments concatenate) → decodeBeast2For(T)(blob)
            ├─ Random access by row → openBeast2PagesFor(T)(blob) → .elementCount, .segment(i), .element(row), .slice(offset, limit), .get(key)
            └─ In a browser → same sync API works (portable inflate); decodeBeast2ForAsync(T)(blob) is faster for large blobs
```

## Type System Summary

| Type | `ValueTypeOf<Type>` | Mutability |
|------|---------------------|------------|
| `NullType` | `null` | Immutable |
| `BooleanType` | `boolean` | Immutable |
| `IntegerType` | `bigint` | Immutable |
| `FloatType` | `number` | Immutable |
| `StringType` | `string` | Immutable |
| `DateTimeType` | `Date` | Immutable |
| `BlobType` | `Uint8Array` | Immutable |
| `ArrayType<T>` | `ValueTypeOf<T>[]` | **Mutable** |
| `SetType<K>` | `Set<ValueTypeOf<K>>` | **Mutable** |
| `DictType<K, V>` | `Map<ValueTypeOf<K>, ValueTypeOf<V>>` | **Mutable** |
| `RefType<T>` | `ref<ValueTypeOf<T>>` | **Mutable** |
| `VectorType<FloatType>` | `Float64Array` | Immutable |
| `VectorType<IntegerType>` | `BigInt64Array` | Immutable |
| `VectorType<BooleanType>` | `Uint8ClampedArray` | Immutable |
| `MatrixType<T>` | `matrix<TypedArray>` | Immutable |
| `StructType<Fields>` | `{...}` | Immutable |
| `VariantType<Cases>` | `variant` | Immutable |
| `FunctionType<I, O>` | Function | Immutable |
| `PatchType<T>` | `variant` | Immutable |

## Key Patterns

### TypeScript Values vs East Expressions

TypeScript values and East expressions are different. East methods only work on East expressions.

```typescript
// WRONG - Cannot call East methods on TypeScript values
const THRESHOLD = 100n;  // This is a TypeScript bigint
East.function([IntegerType], BooleanType, ($, x) => {
    $.return(x.greaterThan(THRESHOLD));  // ERROR: THRESHOLD has no .greaterThan()
});

// CORRECT - Wrap TypeScript values with East.value()
const THRESHOLD = 100n;
East.function([IntegerType], BooleanType, ($, x) => {
    $.return(x.greaterThan(East.value(THRESHOLD)));  // OK
});

// ALSO CORRECT - Use $.const() inside the function
East.function([IntegerType], BooleanType, ($, x) => {
    const threshold = $.const(THRESHOLD);  // Creates East expression
    $.return(x.greaterThan(threshold));    // OK
});
```

**Rule**: Function parameters are already East expressions. External TypeScript values must be wrapped with `East.value()` or bound with `$.const()`.

### Creating Variant Values
```typescript
import { variant, some, none, ref } from "@elaraai/east";

// Option types - use some() and none helpers (preferred)
const hasValue = some(42n);      // { type: "some", value: 42n }
const noValue = none;            // { type: "none", value: null }

// AVOID: variant("some", ...) and variant("none", ...) for Option types
// const hasValue = variant("some", 42n);  // works but use some() instead
// const noValue = variant("none", null);  // works but use none instead

// Other variant types - use variant()
const success = variant("ok", "done");
const failure = variant("error", "failed");

// Mutable references - use ref()
const counter = ref(0n);
```

### String Interpolation
```typescript
// East.str`` creates a StringExpr from a template
// Only East expressions can be interpolated, NOT plain TypeScript values

const MY_CONSTANT = 100n;  // TypeScript value

East.function([IntegerType], StringType, ($, x) => {
    // CORRECT - x is already an East expression (function parameter)
    const msg1 = $.let(East.str`Value: ${x}`);

    // CORRECT - wrap TypeScript constant with East.value()
    const msg2 = $.let(East.str`Threshold: ${East.value(MY_CONSTANT)}`);

    // CORRECT - use $.const() to create East expression first
    const threshold = $.const(MY_CONSTANT);
    const msg3 = $.let(East.str`Threshold: ${threshold}`);

    // WRONG - cannot interpolate plain TypeScript values
    // const msg4 = $.let(East.str`Threshold: ${MY_CONSTANT}`);  // ERROR

    $.return(msg1);
});
```

### Error Handling
```typescript
$.try($ => {
    $.assign(result, arr.get(index));
}).catch(($, message, stack) => {
    $.assign(result, -1n);
}).finally($ => {
    // cleanup
});
```

### Platform Function Implementations
```typescript
// Platform implementations are raw TypeScript functions that receive/return the
// `ValueTypeOf<Type>` for each East type — see the Type System Summary table
// above (Integer→bigint, Float→number, String→string, Boolean→boolean,
// DateTime→Date, Blob→Uint8Array, Struct→plain object, Array→array, Dict→Map,
// Set→Set, Variant→variant()). Build them with `variant()`/`some`/`none` etc.

// Sync platform - regular TypeScript function
const log = East.platform("log", [StringType], NullType);
const timeNs = East.platform("time_ns", [], IntegerType);

// Async platform - async TypeScript function
const fetchStatus = East.asyncPlatform("fetch_status", [StringType], StringType);

// Implementations receive/return TypeScript values matching East types
const platform = [
    log.implement(console.log),                          // (msg: string) => void
    timeNs.implement(() => process.hrtime.bigint()),     // () => bigint
    fetchStatus.implement(async (url: string) => {       // async function OK
        const response = await fetch(url);
        return `${response.status}`;
    }),
];

// In East code: NO await needed - async is handled automatically
const myFn = East.asyncFunction([StringType], NullType, ($, url) => {
    const t1 = $.let(timeNs());
    const status = $.let(fetchStatus(url));  // no await, just call it
    const t2 = $.let(timeNs());
    $(log(East.str`Fetched in ${t2.subtract(t1)} ns, status: ${status}`));
});

// Compile async functions with East.compileAsync
const compiled = East.compileAsync(myFn, platform);
await compiled("https://example.com");  // await at the outer TypeScript level

// `{ optional: true }` lets a function compile with NO implementation (it throws
// at runtime if called unimplemented) — useful for declaring an interface:
const maybe = East.platform("maybe", [StringType], StringType, { optional: true });
```

#### Project-owned platform functions (calling your own code from e3)

The `East.compile(fn, platform)` flow above is the **in-process** path. To call a
platform function from an **e3 task** instead, you don't call `compile` — you
**default-export the `PlatformFunction[]` as your package's `./platform` subpath**,
and the e3 runner loads it. Two rules then apply:

- Name it **dotted `"<project>.<fn>"`**, and the name in the `East.platform(...)`
  declaration must **byte-match** the implementation (and the Python impl, if you
  also implement it there).
- The e3 task references it via `{ runtime: "east-node", platforms: [{ custom:
  "@elaraai/<project>" }] }` (the package's own scoped name).

See **east-project** for the full wiring (the `./platform` export, the
`--platform` scaffold) and **e3** for the task runner; **east-py** for the Python
sibling (`@platform_function`).

### Binary serialization (beast2)

`East.Blob.encodeBeast(value, 'v2')` is the builtin you call **inside** an East
function. The functions below are the **host-side TypeScript** API for the same
format — you call them from ordinary TypeScript, not from an East body.

Blobs are self-describing and the container version is sniffed on read, so a
decoder built for a type reads any version that type was written in. There is
no call-site change to adopt a newer container.

| Signature | Description |
|-----------|-------------|
| **Whole value** |
| `encodeBeast2For(T, opts?): (value) => Uint8Array` | Curried encoder. `opts.version` picks the container (`5` default, `4` for legacy readers); `opts.codec` (`"deflate"` default \| `"none"`) and `opts.index` apply to v5 |
| `decodeBeast2For(T, opts?): (blob) => ValueTypeOf<T>` | Curried decoder; accepts **any** container version and works in every runtime (browsers use a portable inflate). `opts.platform` supplies platform fns for decoded East functions |
| `decodeBeast2(blob, opts?): { type, value }` | Decode without knowing the type — reads the type embedded in the blob |
| `decodeBeast2ForAsync(T, opts?): (blob) => Promise<…>` | Same as `decodeBeast2For`, but decompresses via the platform's native `DecompressionStream` — an optional speed-up for large blobs in browsers |
| `encodeEastIR(eastIR)` / `decodeEastIR(blob)` | A program plus its source map, so `loc_id`s stay resolvable across processes |
| **Collections larger than memory** (v5) |
| `new Beast2Writer(T, sink, opts?)` | Append-only writer. `.write(batch)` emits one segment per non-empty batch — peak memory is ONE batch, never the collection; `.finish()` writes the terminator and paging index; `.segments` counts batches. `sink` is `(bytes: Uint8Array) => void`. Set/Dict batches must arrive in strict ascending East (key) order — segment content is the canonical value, so pre-sort, or model arrival order as an Array |
| `encodeBeast2SegmentsFor(T, opts?): (batches) => Uint8Array` | In-memory convenience over the writer |
| `encodeBeast2PagedFor(T, opts?): (value) => Uint8Array` | Encode ONE whole collection value segmented + indexed — the write-side sibling of `openBeast2PagesFor`, for values that will be read paged later. Batches adapt to `opts.targetSegmentBytes` of wire output (capped at `opts.batchSize` elements), so wide rows still yield right-sized segments. Same wire form as the writer; bytes differ from the whole-value encode of the same value |
| `iterBeast2SegmentsFor(T, opts?): (blob) => Generator` | Yields one decoded collection per segment — O(segment) decoded memory |
| `openBeast2PagesFor(T, opts?): (blob) => Beast2Pages` | Random access: `.elementCount` and `.segmentCount` are O(1) from the trailing index; `.segment(i)`, `.element(row)` (Array roots) and `.slice(offset, limit)` (every root kind — Set/Dict windows address the canonical sorted order; clamps like `Array.slice`) decode only the segments they touch; `.get(key)` looks up one Set element / Dict value via the verified segment fences |

**Example:**
```typescript
import { createWriteStream } from "node:fs";
import {
    ArrayType, StructType, StringType, IntegerType,
    Beast2Writer, iterBeast2SegmentsFor, openBeast2PagesFor, decodeBeast2For,
} from "@elaraai/east";

const Rows = ArrayType(StructType({ id: IntegerType, name: StringType }));

// Write a collection that never exists in memory in full.
const out = createWriteStream("rows.beast2");
const writer = new Beast2Writer(Rows, bytes => out.write(bytes));
for (const batch of batches) writer.write(batch);   // one segment each
writer.finish();

const blob = new Uint8Array(readFileSync("rows.beast2"));

// Read it whole — segments concatenate on decode.
decodeBeast2For(Rows)(blob);                        // all rows

// Or a batch at a time, holding only one segment.
for (const segment of iterBeast2SegmentsFor(Rows)(blob)) consume(segment);

// Or address a single row without decoding the rest.
const pages = openBeast2PagesFor(Rows)(blob);
pages.elementCount;                                 // O(1), from the index
pages.element(4_000_000);                           // decodes ONE segment
```

**Notes:**
- Segments always **concatenate** — for Set/Dict the wire holds the canonical
  value (strictly ascending, disjoint segments, no duplicate keys), so writers
  reject out-of-order batches and decoders reject non-canonical blobs as
  corrupt. Encoders sort plain `Map`/`Set` inputs, so the same logical value
  always produces the same bytes.
- `write()` skips empty batches, so a segment count is never zero.
- Streaming and paging are v5-only — v4 cannot be appended to, by construction.
- The writer defaults to self-contained segments plus an index, which is what
  makes `openBeast2PagesFor` and parallel decode possible; pass
  `{ selfContained: false }` only if you need aliasing to span segments.

## Related skills

East is the language inside every other skill's `East.function` bodies. East itself is pure — load the skill that matches the capability you're adding:

- **east-node-std** — side effects on Node: files, HTTP (`Fetch`), crypto, time, random.
- **east-node-io** — databases (SQL / NoSQL), S3, FTP / SFTP, XLSX / XML, compression.
- **east-py-datascience** — optimization, ML, Bayesian inference, simulation.
- **east-ui** — typed UI components returning `UIComponentType`.
- **e3** — run East functions as durable, content-addressed dataflow tasks.
- **east-project** — author a project-owned platform function (`East.platform(...).implement(...)`) and wire it into an e3 task via the `./platform` export.
- **e3-create** — scaffold a project (and its custom-platform packages) with `npm create @elaraai/{e3,east}`.
- **east-design** — when you have a goal but no architecture yet (start here).
