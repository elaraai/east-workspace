# Design: Source Map Separation

Status: **Draft — pending approval before implementation**

## TL;DR

Every East IR node currently carries an inline `location: ArrayType(LocationType)` — a source-code call stack captured at AST build time. This causes wire-format size bloat, impossible cross-runtime byte-identity, and fragile transformation passes.

This design removes inline locations from IR nodes. Each IR node gets a `loc_id: IntegerType` instead — an opaque integer referencing a sidecar `SourceMap` that holds the actual location stacks, content-deduplicated.

**Scope**: IR data model change + beast2 v3 wire format + TS compile context + C/Python runtime updates. Does NOT remove beast2's backref protocol for user-level mutable values (see follow-up [DESIGN-beast2-value-table.md](./DESIGN-beast2-value-table.md)).

**Outcome**: smaller wire format for IR-heavy workloads, byte-identity across runtimes for IR content, matches industry-standard compiler design (LLVM/Rust/MLIR/Swift all separate source locations from IR).

**Status**: awaiting design approval before implementation begins.

## Audience and context

This document is written for someone who has not been deep in the beast2 serialization work. It starts from background, explains the current problem, then proposes a solution.

### What is East?

East is an embedded, statically-typed programming language designed to run on the Elara platform. It's a TypeScript-hosted DSL: users write East code using a fluent TypeScript API, and the compiler builds an **Intermediate Representation (IR)** tree that can be:

- Executed in-process via a TypeScript tree-walking interpreter (`@elaraai/east` core)
- Serialized to a binary format called **beast2** and shipped to other runtimes
- Executed in the C runtime (`libs/east-c`) via its own tree-walking interpreter
- Executed in the Python runtime (`libs/east-py`) via yet another interpreter

The key design constraint is that **all runtimes must agree on the semantics of East programs exactly**. Tests live in a compliance suite that exports TS-compiled IR to JSON, then runs it on C and Python runtimes and verifies identical results.

### What is IR?

East's IR is a tree of nodes, each representing an operation. There are 34 kinds of IR nodes: `Let`, `Assign`, `Call`, `Block`, `If`, `Variable`, `Function`, `ForArray`, `TryCatch`, `Variant`, etc. Each node has:

- A **kind tag** (which of the 34)
- A **type** (the East type this node produces)
- Kind-specific fields (e.g. `Let` has a variable sub-node and a value sub-node)
- **A `location` field** — an array of `{filename, line, column}` tuples representing the JavaScript call stack captured when the node was built

The IR is the "narrow waist" of East: once you have it, every runtime can execute it, serialize it, JSON-encode it, or display it in a debugger.

### What are locations used for?

Pure debugging. When an East program hits a runtime error (array out of bounds, type mismatch, etc.), the runtime reports the error with a source location so the developer knows where in their TypeScript source the IR came from. They never affect program semantics.

Because the TS compiler uses `new Error().stack` to capture the JS call stack at build time, each IR node's location is a **stack** of frames, not just one — it includes the full chain from user code up through any helper functions. Renders like:

```
Error: Array index 5 out of bounds (length 3)
  at myapp.ts 42:15
  at lib.ts 10:5
  at helper.ts 22:8
```

### What is beast2?

Beast2 is East's binary wire format. It encodes an arbitrary East value (including IR trees) into a compact byte stream that any runtime can decode back into an equivalent value. Current version is v2.

A beast2 v2 blob has four sections:
```
magic bytes (8B)    | "East" + version marker
type table          | flat dedupe table of all EastType instances in the value
string table        | flat dedupe table of all distinct strings
value stream        | the actual value data, referencing the tables by index
```

Types are deduped across the whole blob (one entry per unique type). Strings are deduped across the whole blob (one entry per unique string). But **mutable container instances** (Array, Set, Dict, Ref) use a different mechanism: they are written **inline**, with a backreference protocol — the first occurrence is inline, subsequent occurrences of the *same JS object pointer* are encoded as a varint-distance backref. This preserves East's mutation/aliasing semantics: two references to the same array must still be the same array after decode, or mutations won't propagate as expected.

### The existing location serialization

Because every IR node has `location: ArrayType(LocationType)`, and that type is a normal mutable `ArrayType`, each location stack gets serialized via the backref protocol: the first occurrence is inline, subsequent identical-pointer occurrences are backrefs.

As it happens, the TS compiler's `valueOrExprToAstTyped` helper passes its `location` default-arg down to recursive calls, so sibling IR nodes built in the same expression share the same JS `Location[]` array by pointer identity. This is why the TS beast2 encoder is able to dedupe location data via backrefs — it's exploiting an implementation detail of how the compiler built the IR.

## The problem

There are four distinct problems with the current approach, in increasing order of severity:

### 1. Size bloat in the wire format

Every IR node carries a location stack. A typical benchmark (`libs/east/contrib/examples/beast2_v2_benchmark.ts`) produces a UI tree with ~1,640 closures containing thousands of IR nodes, each with a stack of several frames. The current beast2 v2 wire format is **2,701,044 bytes (2.7 MB)** for this benchmark.

Measurements from this session's debugging work:

- When C's beast2 decoder was dropping location backrefs (early bug), the re-encoded blob was 2,295,928 bytes — i.e., location data in the re-encoded version was missing ~405 KB of the content TS encoded.
- After fixing the decoder to follow location backrefs and copy them, re-encode grew to 2,614,874 bytes — still 86 KB shy of TS's original because C's encoder always writes locations inline (no backref emission), while TS backref-compresses them.

Concrete takeaway: in this benchmark, location data accounts for roughly **400-500 KB (15-20%) of the wire format**, and the beast2 v2 backref protocol is compressing it by roughly 60-80 KB beyond what an inline-every-time encoder would produce. The exact numbers depend on how much sharing exists in the source graph; the order of magnitude is tens to hundreds of KB per realistic workload.

### 2. Semantic ambiguity

The IR schema says `location: ArrayType(LocationType)`, meaning East's type system treats location stacks as **mutable arrays**. But in practice:

- The TS compiler shares a single `Location[]` array across multiple sibling IR nodes via default-arg passing.
- Mutating the array on one IR node would surprise-mutate its siblings.
- No one actually mutates location arrays, because it'd be nonsensical ("mutate a line number to what?").

So the de facto invariant is "locations are frozen by convention", but this invariant is nowhere expressed in the type system or the spec. It's just an implicit assumption that happens to work today and is fragile to anyone poking at it.

### 3. Byte-identity across runtimes is impossible without hacks

For e3's content-addressed task output storage, we want **byte-identity**: given the same logical East value, TS's beast2 encoder and C's beast2 encoder should produce identical bytes. Then `SHA256(beast2_blob)` gives a stable content hash regardless of which runtime produced it.

The current backref mechanism defeats this:

- **TS encoder** detects sharing by *JS pointer identity*. It only emits a backref if it literally sees the same JS array instance twice.
- **C encoder** has no equivalent — the C IRNode data model does not share location arrays across nodes. Every node has its own owned copy. C writes every location inline, always.

Net effect on the benchmark (measured this session): TS emits a 2,701,044-byte blob using location backref dedup. C, re-encoding the same logical IR after decoding, produces:
- **2,295,928 bytes** (smaller — C's early decoder dropped location backrefs entirely)
- **2,614,874 bytes** (after decoder fix — C now preserves and re-emits locations inline, but doesn't emit backrefs itself, so is 86 KB larger than TS)
- **2,954,332 bytes** (after Phase 2 C refactor to preserve sub-node Variable/Label locations — now 253 KB *larger* than TS because C emits every location inline while TS still uses backrefs)

None of these are "bugs" in either encoder — they're different valid encodings of the same value. Making them match requires either:

- Teaching C to replicate TS's pointer-sharing quirks (requires refcounted location arrays in the C IR, which couples the C runtime to a TS implementation detail), or
- Teaching TS to stop deduping (drops the current compression, bloats all existing TS-encoded blobs), or
- Defining a per-field content-dedup rule in the spec and updating both encoders to respect it (works, but adds a special case to the wire format for a specific field).

### 4. Transformation passes are fragile

Any future IR pass (constant folding, inlining, DCE, etc.) has to decide how to handle locations when rewriting nodes. Do child nodes inherit from parent? Does the new node get a fresh stack? Can you merge stacks? This adds a dimension of decision-making to every pass that has nothing to do with the pass's actual job.

## Prior art

How other compiler infrastructure handles source locations:

**LLVM**: `SourceLocation` is a 32-bit opaque ID. Backed by a `SourceManager` that maps IDs to actual file/line/column data. IR instructions carry one `SourceLocation`. The `SourceManager` is a single shared lookup table owned by the compilation unit. Debug info (DWARF) is emitted as a separate section with its own encoding, independent of IR serialization.

**Rust (rustc)**: `Span` is a 32-bit packed structure `(offset, length, context_id)`. A `SourceMap` owns the actual source file contents. AST/HIR/MIR nodes carry Spans. Span resolution (mapping offset back to file/line/col) happens lazily when diagnostics are rendered.

**MLIR**: `Location` is an immutable interned attribute. Any two `FileLineColLoc` attributes with the same `(file, line, col)` are the exact same object (one pointer) because the attribute system interns by content. IR operations carry a single location attribute. Attributes are allocated in a per-context pool.

**Swift**: `SourceLoc` is a pointer into a source buffer held by the `SourceManager`. AST nodes carry `SourceRange` (a pair of `SourceLoc`s). Everything resolves through the source manager.

**Clang**: Inherits LLVM's `SourceLocation`. Adds per-TU (translation unit) source managers.

**The common pattern**: a lightweight opaque ID on IR nodes, a separate sidecar data structure that owns the actual source content, and lazy resolution when diagnostics are needed. None of these systems inline location data into IR nodes the way East currently does.

## Proposed design

### Overview

1. **Introduce `SourceMap`** — a new data structure that owns all distinct location stacks for a compilation unit. Stores stacks in an array, indexed by an opaque integer ID.
2. **Replace `location: ArrayType(LocationType)` on every IR node with `loc_id: IntegerType`** — an integer referencing an entry in the SourceMap.
3. **Pair the IR with its SourceMap** — compiled programs become `{ source_map, ir }` instead of just `ir`.
4. **Beast2 v3** adds a new `source_map_section` that holds the map in wire form, after the type and string table sections.
5. **Runtime resolution** — diagnostics that need to print a source location look up `loc_id` in the SourceMap.

### Concrete before/after

Consider this East program:

```ts
const fn = East.function([IntegerType], IntegerType, ($, x) => {
  const y = $.let(x.add(1n));
  return y.multiply(2n);
});
```

**Before** (simplified IR representation as a tree):

```
Function
├─ location: [myapp.ts:42:15, helpers.ts:10:5]
├─ body: Block
│   ├─ location: [myapp.ts:42:15, helpers.ts:10:5]
│   ├─ stmts[0]: Let
│   │   ├─ location: [myapp.ts:43:20, helpers.ts:10:5]
│   │   ├─ variable: Variable
│   │   │   ├─ location: [myapp.ts:43:20, helpers.ts:10:5]
│   │   │   └─ name: "y"
│   │   └─ value: Builtin(add)
│   │       ├─ location: [myapp.ts:43:26, helpers.ts:10:5]
│   │       └─ args: [Variable(x), Value(1n)]
│   └─ stmts[1]: Return
│       ├─ location: [myapp.ts:44:10, helpers.ts:10:5]
│       └─ value: Builtin(multiply)
│           ├─ location: [myapp.ts:44:19, helpers.ts:10:5]
│           └─ args: [Variable(y), Value(2n)]
```

Notice how each node carries its full location stack. Some locations are identical, some differ by one frame. On the wire, TS currently backrefs the identical pointer instances; C cannot reproduce this without inheriting TS's pointer semantics.

**After**:

```
SourceMap:
  0: []
  1: [myapp.ts:42:15, helpers.ts:10:5]
  2: [myapp.ts:43:20, helpers.ts:10:5]
  3: [myapp.ts:43:26, helpers.ts:10:5]
  4: [myapp.ts:44:10, helpers.ts:10:5]
  5: [myapp.ts:44:19, helpers.ts:10:5]

IR:
Function
├─ loc_id: 1
├─ body: Block
│   ├─ loc_id: 1
│   ├─ stmts[0]: Let
│   │   ├─ loc_id: 2
│   │   ├─ variable: Variable
│   │   │   ├─ loc_id: 2
│   │   │   └─ name: "y"
│   │   └─ value: Builtin(add)
│   │       ├─ loc_id: 3
│   │       └─ args: [Variable(x, loc_id: 2), Value(1n, loc_id: 3)]
│   └─ stmts[1]: Return
│       ├─ loc_id: 4
│       └─ value: Builtin(multiply)
│           ├─ loc_id: 5
│           └─ args: [Variable(y, loc_id: 4), Value(2n, loc_id: 5)]
```

The IR tree is smaller (each node has one int instead of a stack), the SourceMap holds each unique stack exactly once, and both runtimes can produce the same bytes by walking the IR in the same deterministic order and assigning IDs in first-occurrence order.

### SourceMap data structure

```ts
// libs/east/src/location.ts

/** Reserved sentinel: resolve(0n) === [], the "no/unknown location" id.
 *  intern_stack([]) always returns UNKNOWN_LOC_ID and never allocates. */
export const UNKNOWN_LOC_ID: bigint = 0n;

export class SourceMap {
  /** Location stacks, indexed by Number(loc_id). stacks[0] is always the
   *  empty stack, pre-populated at construction, never re-allocated. */
  private readonly stacks: Location[][] = [[]];
  /** Content key → loc_id for dedup during construction. Empty stacks
   *  short-circuit in intern_stack and never enter this map. */
  private readonly intern = new Map<string, bigint>();

  /** Intern a location stack. Returns a stable loc_id (bigint).
   *  Equal content (same filenames, lines, columns, in order) returns the
   *  same id. The empty stack always maps to UNKNOWN_LOC_ID (0n). */
  intern_stack(stack: Location[]): bigint {
    if (stack.length === 0) return UNKNOWN_LOC_ID;
    // Content key: filename|line|column per frame, separated by \n
    // (\n cannot appear in a filename on any platform we support).
    const key = stack.map(l => `${l.filename}|${l.line}|${l.column}`).join('\n');
    const existing = this.intern.get(key);
    if (existing !== undefined) return existing;
    const id = BigInt(this.stacks.length);
    this.stacks.push(stack);
    this.intern.set(key, id);
    return id;
  }

  /** Resolve a loc_id to its stack. Returns [] for UNKNOWN_LOC_ID or any
   *  out-of-range id (never throws — renders as "unknown" in diagnostics).
   *  Internally converts the bigint id to a JS number for array indexing;
   *  this is safe because loc_ids are always small positive integers. */
  resolve(loc_id: bigint): readonly Location[] {
    return this.stacks[Number(loc_id)] ?? [];
  }

  /** Total number of entries, including the reserved empty entry at index 0. */
  get size(): bigint { return BigInt(this.stacks.length); }

  /** Iterate all entries in loc_id order (for serialization).
   *  The first entry is always the empty stack. */
  entries(): readonly Location[][] { return this.stacks; }
}
```

Key properties:
- **Content-deduped**: two stacks with byte-equal frames (same filenames, same line/column values, in the same order) get the same id
- **Stable within a compilation**: ids are assigned in first-encounter order — two runs of the same compile with the same call patterns produce identical id assignments
- **Empty stack is always id 0**: `UNKNOWN_LOC_ID = 0`, `stacks[0] = []`. Calling `resolve(0)` or `resolve(<out-of-range>)` returns `[]`; no exceptions

### New compile-time context API

The current location-capture API is:

```ts
// location.ts
export function get_location(): Location[] { ... }

// usage in expr/*.ts
statements.push({
  ast_type: "Let",
  type: NullType,
  location: get_location(),
  ...
});
```

The new API:

```ts
// location.ts
let _currentMap: SourceMap | null = null;

/** Run `fn` with `map` as the current scope's source map. Re-entrant: the
 *  prior map (which may be null) is restored on exit. */
export function with_source_map<T>(map: SourceMap, fn: () => T): T {
  const prev = _currentMap;
  _currentMap = map;
  try { return fn(); }
  finally { _currentMap = prev; }
}

/** Capture current stack frames and intern them into the current source map.
 *  If called outside any `with_source_map` scope, returns UNKNOWN_LOC_ID (0n)
 *  silently — this is the "tool or test built an AST directly without going
 *  through compile" path, where no source map is available and locations
 *  can't be preserved. */
export function get_location_id(): bigint {
  if (!_currentMap) return UNKNOWN_LOC_ID;
  const stack = capture_stack_frames();
  return _currentMap.intern_stack(stack);
}

// usage in expr/*.ts
statements.push({
  ast_type: "Let",
  type: NullType,
  loc_id: get_location_id(),
  ...
});
```

The module-level `_currentMap` is a scoped context, not a true global — `with_source_map` saves and restores the prior value on stack exit, so re-entry (e.g. a compile that calls a helper that builds its own IR) is safe.

**Where `with_source_map` gets wired up:**

- **`East.compile(...)` in `src/compile.ts`** — the public compile entry point. This is where a new `SourceMap` is created and wrapped around the compile body. After the compile completes, the map is attached to the returned `EastCompiledFn`.
- **Expression builders (`East.function`, `$.let`, `$.const`, etc.)** do NOT wrap their own `with_source_map` calls. They inherit the enclosing scope's current map via the module-level state. An `East.function` built outside any `East.compile` call (e.g. in a test that directly inspects the AST) just gets `UNKNOWN_LOC_ID` on every node, which renders as `<unknown>` in diagnostics — acceptable degradation, not an error.

**Why module-level instead of threading a map parameter through every API?** There are ~500 call sites of `get_location()` across 20+ expression builder files. Changing all of them to accept and pass a `SourceMap` parameter would be a much larger refactor. A scoped module-level context is the minimum-churn path.

**Trade-off**: this is module-level mutable state. It requires East compiles to be single-threaded (which they are in practice). If that assumption ever changes, we'd migrate to Node.js's `AsyncLocalStorage` — which has the same `run(store, callback)` shape but is async-context-aware — with no change to the call-site API.

**Graceful degradation**: `get_location_id()` returning `UNKNOWN_LOC_ID` when no map is active (rather than throwing) means test tools, schema introspection, and any other path that builds AST outside `East.compile` still works. They just lose location info, which they never had anyway. This choice avoids a class of footguns where "now every AST builder has to be wrapped" becomes an unstated precondition.

### AST changes

Every AST variant type changes `location: Location[]` to `loc_id: bigint`:

```ts
// libs/east/src/ast.ts

// Before:
export type LetAST = {
  ast_type: "Let",
  type: EastType,
  location: Location[],
  variable: VariableAST,
  value: AST,
};

// After:
export type LetAST = {
  ast_type: "Let",
  type: EastType,
  loc_id: bigint,    // matches East's IntegerType → bigint convention everywhere else
  variable: VariableAST,
  value: AST,
};
```

Same for every AST case (~20 types).

**Why `bigint`?** Consistency with how East represents integers everywhere else:

- The IR schema field is `loc_id: IntegerType`, which maps to `bigint` at the East value level (matching existing fields like `NewMatrixIR.rows: bigint`, `LocationValue.line: bigint`, `LocationValue.column: bigint`)
- The public East API for integer-typed parameters is `bigint` (e.g. `East.Matrix.zeros(rows: bigint, cols: bigint, ...)`)
- Using `bigint` in the AST avoids a coercion at the AST → IR boundary
- Using `bigint` avoids a class of "did you mean === or did you mean ==" bugs in any code that compares loc_ids
- The two existing `number` fields in `ast.ts` (`NewMatrixAST.rows`, `NewMatrixAST.cols`) are outliers that pre-date this convention; they're not a load-bearing pattern to follow

For `loc_id` specifically:
- **AST**: `loc_id: bigint`
- **IR schema**: `loc_id: IntegerType` (maps to `bigint` at the East value level)
- **SourceMap class**: API takes/returns `bigint` (internal storage uses a regular JS array indexed by `Number(id)` for performance, but API surface is bigint)
- **Wire format**: varint (no JS type at all — just bytes)
- **No boundary conversion needed**: AST and IR both use `bigint`, matched

The internal SourceMap can convert `bigint` → `number` at the lookup site for array indexing (the values are bounded well below 2³¹, so this is safe), but the *API* of SourceMap uses `bigint` consistently with the rest of East:

```ts
export class SourceMap {
  private readonly stacks: Location[][] = [[]];
  private readonly intern = new Map<string, bigint>();

  intern_stack(stack: Location[]): bigint {
    if (stack.length === 0) return UNKNOWN_LOC_ID;
    const key = stack.map(l => `${l.filename}|${l.line}|${l.column}`).join('\n');
    const existing = this.intern.get(key);
    if (existing !== undefined) return existing;
    const id = BigInt(this.stacks.length);
    this.stacks.push(stack);
    this.intern.set(key, id);
    return id;
  }

  resolve(loc_id: bigint): readonly Location[] {
    return this.stacks[Number(loc_id)] ?? [];
  }

  get size(): bigint { return BigInt(this.stacks.length); }
  entries(): readonly Location[][] { return this.stacks; }
}

export const UNKNOWN_LOC_ID: bigint = 0n;
```

### IR schema changes

`libs/east/src/ir.ts`:

```ts
// Before:
export const IRType = RecursiveType(ir => VariantType({
  Let: StructType({
    type: EastTypeType,
    location: ArrayType(LocationType),
    variable: ir,
    value: ir,
  }),
  Variable: StructType({
    type: EastTypeType,
    location: ArrayType(LocationType),
    name: StringType,
    mutable: BooleanType,
    captured: BooleanType,
  }),
  // ... 32 more cases ...
}));

// After:
export const IRType = RecursiveType(ir => VariantType({
  Let: StructType({
    type: EastTypeType,
    loc_id: IntegerType,
    variable: ir,
    value: ir,
  }),
  Variable: StructType({
    type: EastTypeType,
    loc_id: IntegerType,
    name: StringType,
    mutable: BooleanType,
    captured: BooleanType,
  }),
  // ... 32 more cases ...
}));

/** Pairs an IR tree with its source map. */
export const CompiledIRType = StructType({
  source_map: SourceMapType,
  ir: IRType,
});

/** A location stack: the map stores an array of these. */
export const LocationStackType = ArrayType(LocationType);

export const SourceMapType = StructType({
  stacks: ArrayType(LocationStackType),
});
```

The `IRLabelType` (used in Break/Continue/While/For_*) similarly swaps:

```ts
// Before:
export const IRLabelType = StructType({
  name: StringType,
  location: ArrayType(LocationType),
});

// After:
export const IRLabelType = StructType({
  name: StringType,
  loc_id: IntegerType,
});
```

### Compile entry point

`libs/east/src/compile.ts` wraps its body in the context:

```ts
// Before:
export function compile(ast: AST, ...): CompiledFn {
  // ... builds IR, executes, etc ...
}

// After:
export function compile(ast: AST, ...): CompiledFn {
  const sourceMap = new SourceMap();
  return with_source_map(sourceMap, () => {
    // ... builds IR, executes, etc ...
    // Result carries the source map:
    return { ...compiled, source_map: sourceMap };
  });
}
```

### Error reporting

Error types currently carry `locations: Location[]` (pre-resolved at throw time). This stays the same; the resolution happens at throw time, using the currently-active SourceMap:

```ts
// Before:
throw new EastError("...", node.location);

// After:
throw new EastError("...", _currentMap!.resolve(node.loc_id));
```

The error object itself doesn't carry a `loc_id`. Pre-resolving at throw time keeps errors self-contained and usable by catchers that don't have access to the map.

### Beast2 v3 wire format

Bump the version byte from `0x02` to `0x03`. New section layout:

```
magic bytes (8B)       | includes version 0x03
type_table_section     | unchanged from v2
string_table_section   | unchanged from v2
source_map_section     | NEW
value_stream           | IR nodes emit loc_id as varint (was location array)
```

**The `source_map_section` has its own self-contained wire format** — it does NOT go through the generic type-directed value encoder. This is a deliberate choice to keep the section independent of the main value encoding path (which has the backref protocol in v3 and the mutable value table in v4):

```
source_map_section:
  varint(section_byte_length)            # standard section length prefix
  varint(stack_count)                    # number of location stacks
  repeated stack_count times:
    varint(frame_count)                  # frames in this stack
    repeated frame_count times:
      varint(filename_string_idx)        # filename via string table
      zigzag(line)
      zigzag(column)
```

**Why a bespoke wire format instead of reusing the type-directed encoder:**

- **Section independence**: the type-directed encoder for `ArrayType` uses either the v3 backref protocol or (in v4) the mutable value table. Both would create ordering dependencies between sections that don't need to exist. A bespoke wire format for the source map keeps it self-contained — the decoder can read the section with only the string table already loaded, regardless of v3/v4.

- **Simpler decode**: no backref distances to resolve, no forward table references to pre-allocate. Just count + inline content.

- **Same wire format in v3 and v4**: the source map section is identical across versions (only the magic version byte differs). Less implementation churn for the v3 → v4 migration.

- **`SourceMap` is still a first-class East value**: `SourceMapType` is exported from `ir.ts` and can be constructed, introspected, and reflected on by East code using the normal value APIs. The wire format for "SourceMap in beast2 section" is just a more compact specialization of "SourceMap in an arbitrary East value position". If an East program serializes a `SourceMapType` value *outside* of the dedicated section (e.g. as part of a larger struct), it goes through the normal type-directed encoder with whatever protocol that uses (backref in v3, value table in v4).

**Filenames reference the string table** — common filenames cost only a varint index in the source map section, not a full filename per frame. Entries are stored in loc_id order: `loc_id = 0` is always the empty stack and comes first; `loc_id = 1` is the first non-empty stack the encoder interned, etc.

IR node encoding in v3:

```
Before (v2):
  varint(case_idx)
  type_idx varint
  location_array_bytes  // varint(0)+varint(N)+frames, or varint(distance)
  ... case fields ...

After (v3):
  varint(case_idx)
  type_idx varint
  varint(loc_id)        // single varint, no more location array
  ... case fields ...
```

Net saving per IR node: a location stack was 2-N bytes depending on backref/inline/length; a loc_id is 1-2 bytes. For a typical IR node the savings are ~5-50 bytes, multiplied by 82k nodes in the benchmark = substantial.

### Backward compatibility

**Hard cutover** — no transitional dual-version support. Beast2 v2 is deprecated; v3 encoders emit v3 only, v3 decoders read v3 only. v2-encoded blobs in storage are stale and must be regenerated:

- e3 task output cache: wipe on deploy, regenerate on first run
- Compliance test IR JSON fixtures: regenerated by `npm run test:export`
- WASM decoder bundle: rebuild with v3-only decoder
- Any other consumers: rebuild

Rationale: maintaining a v2 reader inside a v3 codebase is dead code that has to be tested and kept correct, with the only benefit being avoiding a one-time regenerate step. The codebase is small enough and the consumers are well-known enough that a clean break is cheaper than a transition window.

### C runtime changes

After TS is done, the C runtime mirrors the changes.

**Data model** (`libs/east-c/packages/east-c/include/east/ir.h`):

```c
// Before:
struct IRNode {
    IRNodeKind kind;
    int ref_count;
    EastType *type;
    EastLocation *locations;  // owned stack
    size_t num_locations;
    union { ... } data;
};

// After:
struct IRNode {
    IRNodeKind kind;
    int ref_count;
    EastType *type;
    int32_t loc_id;           // opaque id into the companion SourceMap
    union { ... } data;
};

/* Source map: array of location stacks, indexed by loc_id.
 * stacks[0] is always the empty stack (the UNKNOWN_LOC_ID sentinel). */
typedef struct {
    EastLocation **stacks;     // array of location stacks
    size_t *stack_sizes;       // length of each stack
    size_t count;              // total entries (includes stacks[0] = [])
    int ref_count;             // shared between EastCompiledFn instances
} EastSourceMap;

EastSourceMap *east_source_map_new(void);
void east_source_map_retain(EastSourceMap *map);
void east_source_map_release(EastSourceMap *map);
const EastLocation *east_source_map_resolve(
    EastSourceMap *map, int32_t loc_id, size_t *out_count);
```

**Where the SourceMap lives at runtime**:

- Each `EastCompiledFn` gets a `EastSourceMap *source_map;` field. The map is refcount-shared so sibling functions from one compilation reference one map object.
- The `Beast2DecodeCtx` gains a `EastSourceMap *active_source_map;` field populated when the decoder reads a `source_map_section`. When the decoder constructs an `EastCompiledFn`, it retains the active map and attaches it.
- When a user calls `east_call(fn, args, ...)`, the eval loop receives `fn->source_map` via an explicit parameter (no thread-local / global state needed in C). Nested `eval_ir` calls pass it through.

**Error reporting path** (`compiler.c`):

```c
// Before:
static EvalResult eval_error_at(const char *msg, IRNode *node) {
    EvalResult r = { .status = EVAL_ERROR, .error_message = strdup(msg) };
    if (node && node->locations && node->num_locations > 0) {
        r.locations = east_locations_dup(node->locations, node->num_locations);
        r.num_locations = node->num_locations;
    }
    return r;
}

// After:
static EvalResult eval_error_at(const char *msg, IRNode *node, EastSourceMap *map) {
    EvalResult r = { .status = EVAL_ERROR, .error_message = strdup(msg) };
    if (node && map) {
        size_t n = 0;
        const EastLocation *stack = east_source_map_resolve(map, node->loc_id, &n);
        if (n > 0) {
            r.locations = east_locations_dup(stack, n);
            r.num_locations = n;
        }
    }
    return r;
}
```

Every `eval_*` helper gains a `EastSourceMap *map` parameter. This is mechanical (passed through the call chain) and is local to `compiler.c`.

**`type_of_type.c` role clarification**: this file implements the **EastValue variant tree → IRNode** conversion. It's invoked by the JSON decode path: `json.c` decodes JSON → EastValue via the `IRType` schema, then `type_of_type.c:east_ir_from_value` converts the variant-tree form to `IRNode*`. With the source map design:

- The JSON file's top-level structure becomes `{source_map, ir}` instead of bare IR.
- A new function `east_compiled_ir_from_value(EastValue *compiled_ir_val) -> EastCompiledFn` (or similar) reads both pieces.
- The source map is constructed from the decoded `source_map` struct and attached to the result.
- `east_ir_from_value` gains an optional `EastSourceMap *map` parameter; it threads `loc_id` onto IRNodes directly from the decoded `IR.loc_id` field.

**Dead code removal**: the interim Phase 2 refactor done in this session (adding `IRVariable.locations`, `IRLabel.locations`, `b2ir_loc_refs` helper in the decoder, `b2ir_variable_steal_locations`, etc.) all becomes **dead code** in the SourceMap world because the IRNode no longer carries inline location stacks. These fields and helpers will be removed as part of the C-side cleanup. See "Migration plan" step 13.

### Python runtime changes

`libs/east-py/packages/east-py/east/serialization/beast2.py` implements beast2 decode/encode for the Python runtime. It needs the same v3 format updates as the C runtime:

- A `SourceMap` class mirroring the TS one (`stacks: list[list[Location]]`, `intern_stack`, `resolve`)
- Beast2 v3 decoder reads the `source_map_section` and attaches a `SourceMap` to decoded `CompiledIR` values
- Beast2 v3 encoder writes the source map + `loc_id` varints in IR nodes
- Python IR interpreter (if present) threads `SourceMap` through evaluation for error reporting, resolving `loc_id` at error construction time

The Python implementation is typically the smallest — Python's dynamic typing lets the SourceMap just be a list-of-lists with a dict for intern. Expect ~100-200 LOC of changes in `beast2.py` plus additions in any Python error-reporting code.

### JSON IR format (compliance test export)

The `npm run test:export` script exports TS-compiled IR to JSON files that the C and Python runtimes consume for compliance testing. Top-level structure changes:

```json
// Before:
{
  "type": "Function",
  "location": [{"filename": "...", "line": 1, "column": 1}],
  "captures": [],
  "parameters": [{"type": "Variable", "location": [...], "name": "x", ...}],
  "body": { ... }
}

// After:
{
  "source_map": {
    "stacks": [
      [],
      [{"filename": "...", "line": 1, "column": 1}],
      [{"filename": "...", "line": 2, "column": 5}]
    ]
  },
  "ir": {
    "type": "Function",
    "loc_id": 1,
    "captures": [],
    "parameters": [{"type": "Variable", "loc_id": 2, "name": "x", ...}],
    "body": { ... }
  }
}
```

The compliance test runner (`test_compliance.c` on the C side, equivalent on the Python side) reads both sections and constructs an `EastSourceMap` + an IRNode tree.

## Migration plan

16 steps: TS core first, then beast2, then C and Python runtimes. Each step should leave the tree in a buildable, testable state; compliance tests should pass (or only fail in known, documented ways) at every step.

### TS side — core library

1. **Add `SourceMap` class, `with_source_map`, `get_location_id`** in `location.ts`. Library-only change; no callers updated. Build and verify nothing breaks. Write unit tests for `SourceMap` (intern idempotence, empty-stack sentinel, content equality).
2. **Update `ir.ts` schema**: add `loc_id: IntegerType` field on every IR variant case **alongside** the existing `location: ArrayType(LocationType)` field. Both coexist during migration. Also add new `SourceMapType` and `LocationStackType`. The IR type is now overspecified; consumers can use either field until everyone is migrated.
3. **Update AST types in `ast.ts`**: add `loc_id: bigint` field on every AST variant type alongside existing `location: Location[]`. Both coexist.
4. **Update expression builders (`src/expr/*.ts`)** one file at a time to populate both `location` and `loc_id` on every AST node they emit. ~500 mechanical edits. End state: every builder produces both fields.
5. **Wrap `East.compile` in `with_source_map`**: at the public compile entry point, allocate a new `SourceMap`, wrap the compile body in `with_source_map(map, () => ...)`, and attach the map to the returned `EastCompiledFn`. Expression builders automatically pick up the context via the module-level scope.
6. **Update AST → IR conversion** (inside `compile.ts` or wherever AST→IR happens) to write the `loc_id` field on constructed IR nodes, copied from the AST node's `loc_id`.
7. **Remove the old `location` field** from AST types and from `ir.ts`. TypeScript will flag every remaining consumer; fix each.
8. **Update error reporting** in `compile.ts`, `ast.ts`, and any other error-path code to resolve `loc_id` via the currently-active `SourceMap` at throw time. The error objects continue to carry `locations: Location[]` (pre-resolved) for backwards compatibility with catchers that don't have a `SourceMap` at hand.

### TS side — serialization

9. **Update JSON IR export** (`npm run test:export` pipeline) to emit `{source_map, ir}` at the top level. Decide between nesting structure (Q5) before implementing.
10. **Update beast2 encoder to v3**: add `source_map_section` between string table and value stream; IR node encoder writes `varint(loc_id)` instead of the inline location array. Bump magic byte to `0x03`.
11. **Drop v2 decoder code from `beast2.ts`**. Hard cutover — no dual-version dispatch. The v3 decoder is the only decoder. Any test fixtures or stored blobs in v2 format must be regenerated.
12. **Run the full TS test suite**. Fix any regressions. Regenerate compliance test IR JSON fixtures (`libs/east-c/tests/...`) via `npm run test:export`.

### C side

13. **Revert the dead Phase 2 refactor** (if implemented in the interim): remove `IRVariable.locations`/`IRLabel.locations` fields, `b2ir_loc_refs` helper, `b2ir_read_location_stack`, `b2ir_variable_steal_locations`, `b2ir_label_steal_locations`, and the sub-node location preservation logic in every case of `b2ir_decode_node_ctx`. All of this becomes dead code in the SourceMap world.
14. **Update C IR data model**: `ir.h` struct `IRNode` replaces `EastLocation *locations; size_t num_locations;` with `int32_t loc_id;`. New struct `EastSourceMap { EastLocation **stacks; size_t *stack_sizes; size_t count; }`. `EastCompiledFn` gets a `SourceMap *source_map;` field pointing to the map owned by the decoded value.
15. **Update C runtime consumers**:
    - `ir.c` constructors and `ir_node_release` to handle the new field
    - `compiler.c` eval loop — `EvalResult.locations` is populated by resolving `node->loc_id` via a thread-local "current source map" or via a context-passed `EastSourceMap *` parameter (resolve at error throw time)
    - `type_of_type.c` (the EastValue-variant-tree → IRNode converter used by the JSON decode path) to read the new `{source_map, ir}` top-level shape and thread the `EastSourceMap` through to the constructed IRNodes
    - `beast2/ir_decode.c` and `beast2/ir_encode.c` to handle v3 wire format (read/write the `source_map_section`, read/write `loc_id` varints instead of location arrays)
16. **Run C compliance tests** with regenerated IR JSONs. All should pass. Verify byte-identity on the benchmark: `cmp /tmp/ts.beast2 /tmp/c.beast2` should return 0 for IR-heavy content.

### Python side

17. **Update `libs/east-py/packages/east-py/east/serialization/beast2.py`** to match v3 format. Same changes conceptually: `source_map_section` decode, `loc_id` in IR node decode, `EastSourceMap` equivalent in Python. Python runtime error reporting resolves `loc_id` via the map.

### Docs and cleanup

18. **Update `devdocs/BEAST2.md`** to document v3 wire format. Remove all references to v2.
19. **Update `libs/east-c/docs/DESIGN-beast2-closure-reencode.md`** to reference this design and close out the Phase 1/2 discussions (they're superseded).

## Test strategy

Each of these must pass before merging:

1. **SourceMap unit tests**: intern idempotence (interning the same stack twice returns the same id), empty stack always maps to `UNKNOWN_LOC_ID`, out-of-range resolve returns `[]`, content equality (stacks with identical frames but distinct JS arrays get the same id), ordering (ids are assigned in first-encounter order).

2. **Compile + error reporting tests**: compile an East program with a deliberate runtime error (array out of bounds, etc.), verify the error's `locations` field resolves to the right source line. Cover all IR cases that emit errors (Assign, Call, Builtin, etc.).

3. **Round-trip tests**: for a wide variety of IR trees (small, medium, large), verify `decode(encode(ir))` produces a structurally equal IR with the same effective source info.

4. **Beast2 byte-identity test (the key success criterion)**: regenerate the benchmark blob from `libs/east/contrib/examples/beast2_v2_benchmark.ts` with v3 encoder, decode it in C, re-encode in C, verify `cmp` returns 0. Add this as a CI gate.

5. **Compliance suite passes on all three runtimes** (TS, C, Python) after the regenerated IR JSONs.

6. **Version compatibility tests**: v2 decoder + v2 blob ✓, v3 decoder + v2 blob ✓ (transitional), v3 decoder + v3 blob ✓, v3 decoder + v4-or-later blob should fail cleanly with a version error.

7. **Graceful degradation test**: build an AST node outside any `with_source_map` scope, verify `loc_id = 0` is populated and diagnostics render as `<unknown>` without throwing.

8. **Transformation pass test**: write a trivial IR transformation (constant fold or similar) that creates new IR nodes, verify the new nodes carry through parent `loc_id` or use `UNKNOWN_LOC_ID` cleanly. Validates the assertion that future transformation passes are simpler.

## Rollback plan

If implementation reveals a blocker after the TS core changes land (steps 1-8), we can:

- Restore the old `location: Location[]` field on AST and IR types from git history
- Leave the new `SourceMap`/`with_source_map`/`get_location_id` machinery in place but unused (they're library-only additions, zero runtime cost)
- Revert step-wise: beast2 v3 → v2 encoder change is a single file; AST/IR type removals are mechanical
- Regenerate IR JSON fixtures from the reverted TS
- Leave C-side work in a `work-in-progress` branch until TS stabilises

Since every migration step leaves the tree buildable, partial rollback is always possible. The most expensive thing to revert is the ~500 expression-builder call-site edits, but git preserves them perfectly.

## Non-goals

Things this design intentionally does NOT attempt:

- **Change how locations are captured.** We're still parsing `Error.stack` at AST-construction time. The capture mechanism stays the same, only the storage changes.
- **Make locations optional at compile time.** You can't currently disable location capture for "production builds", and this design doesn't add that. The SourceMap just becomes smaller if all call sites happen to produce empty stacks.
- **Support multiple concurrent compilations in one process.** East compile is single-threaded. If that changes, we'd migrate to `AsyncLocalStorage`, but that's not in scope now.
- **Remove the beast2 backref protocol for user-level mutable values.** The existing pointer-identity backref mechanism for `Array`/`Set`/`Dict`/`Ref` user values continues to work as-is under this design. A follow-up design ([DESIGN-beast2-value-table.md](./DESIGN-beast2-value-table.md)) addresses replacing those backrefs with a mutable value table for full byte-identity across all East values, not just IR locations.
- **Change East's mutability semantics.** User-level `ArrayType(T)` values still have identity-preserving semantics. This design only affects how location arrays (a special case of "frozen by convention debug data") are stored.
- **Solve content-addressed storage for e3 as a design goal.** Byte-identity is an outcome of this design (for IR content specifically), but the primary motivation is architectural cleanup.

## Relation to other designs

This design is the **first half** of a two-part effort to make the beast2 wire format fully byte-identical across runtimes:

1. **This doc (source map separation)** — removes inline location stacks from IR nodes. Addresses the IR-specific location-sharing problem via a sidecar SourceMap. After this lands, byte-identity is achieved for all *IR content* (which is most of the e3 task output story).

2. **[DESIGN-beast2-value-table.md](./DESIGN-beast2-value-table.md) (follow-up)** — replaces beast2's pointer-identity backref protocol with a mutable value table. Addresses the remaining byte-identity gap for user-level `Array`/`Set`/`Dict`/`Ref` values. Depends on this design landing first (conceptually — the two changes can be prototyped in parallel but the value table design assumes the source map is already separated out).

The two designs are independent in implementation but share a philosophical direction: replace implicit pointer-identity tricks in the wire format with explicit, content-addressed tables that any runtime can produce identically from identical input.

## Open questions (please weigh in before implementation starts)

### Q1: Scoped context (`with_source_map`) or explicit parameter threading?

The design proposes `with_source_map(map, () => ...)` wrapping a module-level `_currentMap`. This is a scoped context — re-entry is safe because the prior value is saved/restored.

**Alternative**: thread `SourceMap` as an explicit parameter through every AST builder. `$.const(value)` becomes `$.const(value, $.sourceMap)` or similar. No module-level state.

**Trade-off**: explicit threading is architecturally purer but touches every function signature in `expr/*.ts`. Module-level context is minimum churn.

**My recommendation**: module-level context for this refactor. Can revisit if it causes concrete problems.

### Q2: Where does `SourceMap` live at runtime?

Three options:

- **a) Per-compiled-function**: each `EastCompiledFn` owns its own `SourceMap`. Two functions from the same file get independent maps (with duplicated entries).
- **b) Per-compile-context**: a single shared `SourceMap` is passed alongside the IR to any consumer. Entities that reference IR (like `EastCompiledFn`) hold a reference to the shared map.
- **c) Top-level `CompiledProgram`**: introduce a new type that wraps `{source_map, ir}` at the top of the compilation result.

**My recommendation**: **(a) per-compiled-function** for simplicity. Small duplication across sibling functions is acceptable — the SourceMap is typically a few hundred entries, not megabytes.

### Q3: Error objects carry `Location[]` or `(loc_id, source_map)`?

**Pre-resolve at throw time (proposed)**: errors store `locations: Location[]` that's been resolved via the currently-active SourceMap.

**Defer resolution (alternative)**: errors store `loc_id` and require access to a SourceMap at render time.

**My recommendation**: pre-resolve. Errors flow out of the compiled function's scope, and the SourceMap may not be at hand where the error is caught (especially across runtime boundaries like FFI or serialized errors).

### Q4: Beast2 v3 migration strategy — **RESOLVED: hard cutover**

Resolved per project preference: hard cutover, no dual-version support. v2 readers are dropped from the codebase the same PR that introduces v3. All consumers regenerate on deploy. No transitional period.

This simplifies the codebase substantially: no v2-vs-v3 dispatch in decoders, no test fixtures duplicated for both versions, no documentation of how the two interact.

### Q5: Is `CompiledIRType` exposed as an East type for reflective use? — **RESOLVED: YES**

Confirmed: `SourceMapType` and `CompiledIRType` are first-class East types, exported from `libs/east/src/ir.ts` alongside `IRType`. This means:

- East code can introspect a compiled IR bundle via `East.value(compiled, CompiledIRType)` and get back a struct of `{source_map: SourceMap, ir: IR}`.
- The beast2 wire format for both `SourceMapType` and `CompiledIRType` falls out automatically from the existing type-directed encoder/decoder infrastructure — the only thing the encoder needs to know is the section positioning (source_map comes before the value stream). The *contents* of the source map section are encoded/decoded using the same type-directed path as any other `StructType({ stacks: ArrayType(ArrayType(LocationType)) })` value.
- Any tool that manipulates IR (pretty printer, transformation pass, error reporter) can accept a `CompiledIR` value and have full access to both halves.

Consequence: the runtime (C, Python, TS) doesn't need a separate "SourceMap" concept at the data-model level beyond what the type system already gives you. The C `EastSourceMap` struct is just an efficient in-memory representation of the decoded East `SourceMapType` value — equivalent to how `EastCompiledFn` is an in-memory view of a decoded `FunctionType` value.

## Estimated scope

| Area | Files | LOC changed |
|---|---|---|
| `libs/east/src/location.ts` | 1 | ~150 |
| `libs/east/src/ast.ts` | 1 | ~80 |
| `libs/east/src/ir.ts` | 1 | ~100 |
| `libs/east/src/expr/*.ts` | ~20 | ~500 (mechanical: `location: get_location()` → `loc_id: get_location_id()`) |
| `libs/east/src/compile.ts` | 1 | ~100 |
| `libs/east/src/serialization/beast2.ts` | 1 | ~200 |
| `libs/east/src/serialization/beast2-type-table.ts` | 1 | ~20 |
| JSON IR export/import | 2-3 | ~60 |
| TS tests | 5-10 | ~100 |
| **C side** | ~8 | ~500 (net reduction — lots of Phase 2 code removed) |

**Total**: ~1800 lines changed across ~40 files. Roughly 1-2 full days of focused work, split over TS first then C.

## Benefits after landing

1. **Byte-identity across runtimes by construction**. Both TS and C encoders produce the same bytes from the same logical IR, because the SourceMap is content-deduped and indexed by deterministic walk order. `cmp /tmp/ts.beast2 /tmp/c.beast2` returns 0.

2. **Smaller wire format**. IR nodes lose their inline location stacks; each carries a 1-2 byte `loc_id`. The SourceMap section holds each unique stack once. Estimated 15-25% reduction in beast2 blob size for IR-heavy workloads.

3. **Cleaner IR data model**. IR nodes are pure logic. Source info is metadata. Matches industry-standard compiler design.

4. **Easier transformation passes**. A transformation pass copies `loc_id` through (or assigns a new one), without worrying about stack semantics or pointer sharing.

5. **Removes the Phase 2 C refactor cruft**. Everything I added (IRVariable.locations, IRLabel, steal_locations helpers, loc_refs decoder table) becomes dead code and is deleted.

6. **Sets up for future features**. Location-stripping for production builds, lazy source map loading, remote error reporting, separate debug info files — all become trivially implementable because locations are already first-class separable data.

## What this replaces

After this design lands, these become dead code and are deleted:

- `location: ArrayType(LocationType)` field on every IR variant case
- `location: Location[]` field on every AST variant type
- Beast2 v2 location backref resolution (TS encoder's pointer-identity map for location arrays)
- All C-side Phase 2 work around locations:
  - `IRVariable.locations` / `IRVariable.num_locations` fields
  - `IRLabel` struct (or its location fields)
  - `Beast2LocRefs` helper in `ir_decode.c`
  - `b2ir_read_location_stack` function
  - `b2ir_variable_steal_locations`, `b2ir_label_steal_locations` helpers
  - The sub-node Variable/Label location preservation logic in every case of `b2ir_decode_node_ctx`
- Beast2 v2 format support (after the deprecation window)

## Risks

1. **Migration bugs**: IR schema change is a breaking wire-format change. Existing beast2 blobs and JSON IR exports are stale until regenerated. If any consumer runs with mismatched versions, it errors out. Mitigation: the transitional period where decoders accept both v2 and v3.

2. **Scoped context correctness**: `with_source_map` relies on stack discipline. If a compile path stashes a callback to run later (outside the `with_source_map` scope), `get_location_id()` will throw. Mitigation: find any such call sites in testing; convert them to capture `currentSourceMap()` at definition time.

3. **Error reporting coverage**: any error that currently reports a location must be updated to resolve via the map. Missing one = silent loss of error location. Mitigation: the AST/IR types no longer have a `location` field after step 7; TypeScript errors catch all remaining call sites.

4. **Multi-threaded future**: the module-level context assumption is future-fragile. Mitigation: if/when East adds parallel compile, migrate to `AsyncLocalStorage` — same API shape, just pluggable storage.

5. **Existing e3 task cache invalidation**: all cached beast2 blobs become stale on first v3 deployment. Mitigation: e3 re-encodes on next run; cache warms up over a deploy or two.
