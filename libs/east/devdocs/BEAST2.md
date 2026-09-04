# Beast2 Binary Format Specification

## Overview

Beast2 is East's self-describing binary serialization format. A beast2 blob encodes a type schema and a value conforming to that schema, enabling any East value — including functions with closures capturing recursive types — to be serialized, transmitted, and deserialized across TypeScript, C, and Python runtimes.

## Design Goals

1. **Compact** — every unique sub-type is defined once in a flat table, referenced by varint index; every unique string is stored once in a string table
2. **Fast decode** — flat type table parsed in a single pass; string table enables O(1) index lookup instead of per-string UTF-8 decode; known-type decode reuses pre-built decoders
3. **Self-describing** — the type schema is embedded, enabling decode without external schema
4. **Unified type table** — one table serves the type header, function IR type annotations, and capture types
5. **Cross-runtime** — identical byte-level format across TypeScript, C, and Python (via C)

## Inspirations

- **WASM type section** — flat indexed type array with forward references for recursion
- **JVM constant pool** — layered interning table with integer indices
- **FlatBuffers binary schema** — type definitions referenced by integer index
- **CBOR shared references** (tag 28/29) — integer-indexed deduplication

---

## 1. File Layout

A beast2 blob has four sections:

```
Offset   Section          Description
──────   ───────          ───────────
0        Magic            8 bytes
8        Type table       varint header_byte_length + root_index + entries
...      String table     varint header_byte_length + count + UTF-8 strings
...      Value data       type-driven positional encoding (strings as varint indices)
```

### Magic Bytes

```
0x89 0x45 0x61 0x73 0x74 0x0D 0x0A 0x02
 │    ├──── "East" ────┤  ├─CRLF─┤   │
 │                                    └── format version (0x02)
 └── invalid UTF-8 marker (like PNG)
```

- `0x89` prevents accidental text interpretation
- `"East"` is human-readable in hex dumps
- `\r\n` detects line-ending corruption
- `0x02` identifies this format version

### Type Table Section

```
[varint]    header_byte_length       total bytes of type table section (everything below)
[varint]    root_type_index          index of the root type
[varint]    entry_count              number of type table entries
[entries]   entry_0 ... entry_N-1    type definitions (tag byte + parameters)
```

`header_byte_length` counts the bytes from (and including) `root_type_index` through the last entry byte. This enables the decoder to skip the entire type table by reading one varint and adding it to the current offset.

### String Table Section

```
[varint]    header_byte_length       total bytes of string table section (everything below)
[varint]    string_count             number of unique strings
[entries]   string_0 string_1 ...    each: varint(byte_length) + UTF-8 bytes
```

All string values in the value data are encoded as varint indices into this table (not inline UTF-8). The string table is populated lazily during a two-pass encoding: the value is first encoded to a temp buffer (discovering strings), then the header is written with the complete table. On decode, the entire string table is read into an array, and every string position in the value stream is a single varint index → `stringTable[idx]`.

This deduplicates repeated strings (e.g., source file paths in IR location annotations) and replaces expensive per-string UTF-8 decode with a cheap array index lookup on the hot decode path.

### Value Data Section

Immediately follows the string table. Type-driven positional encoding with no inline type tags. See Section 4.

---

## 2. Type Table

The type table is a flat array where each entry defines a unique type. All type references — struct field types, variant case types, array element types, function parameter types, function IR type annotations, capture types — are varint indices into this single table.

### 2.1 Entry Format

Each entry is a tag byte (0x00–0x12) followed by type-specific parameters:

```
Tag   Type           Parameters
───── ────────────── ──────────────────────────────────────────────────
0x00  Null           (none)
0x01  String         (none)
0x02  Integer        (none)
0x03  Float          (none)
0x04  Boolean        (none)
0x05  DateTime       (none)
0x06  Blob           (none)
0x07  Never          (none)

0x08  Variant        varint(case_count)
                       [varint(name_byte_len) utf8_bytes varint(type_idx)] × case_count
0x09  Struct         varint(field_count)
                       [varint(name_byte_len) utf8_bytes varint(type_idx)] × field_count
0x0A  Array          varint(element_idx)
0x0B  Dict           varint(key_idx) varint(value_idx)
0x0C  Set            varint(element_idx)
0x0D  Ref            varint(inner_idx)
0x0E  Vector         varint(element_idx)
0x0F  Matrix         varint(element_idx)
0x10  Function       varint(input_count) [varint(input_idx)] × input_count  varint(output_idx)
0x11  AsyncFunction  varint(input_count) [varint(input_idx)] × input_count  varint(output_idx)
0x12  Recursive      varint(inner_idx)
```

**Tag ordering**: Tags serve as direct array indices into dispatch tables (19 entries, 0x00–0x12) for zero-branch decoding. Primitives (0x00–0x07) are grouped first. Within primitives, Null is 0x00 because it is the most frequent (appears in every Option type and variant payload). Among compounds, Variant (0x08) and Struct (0x09) are first because they are the most common compound constructors.

**Field/case names in type table entries**: These are stored inline as UTF-8 strings within the type table (NOT in the string table). The string table only holds value-level strings.

**Field ordering**: Struct fields preserve their definition order (field order is significant in East's structural type system). Variant cases are sorted alphabetically by name (enforced by `VariantType()` at construction time).

### 2.2 Recursion

Entry tag `0x12` (Recursive) declares a recursive type wrapper. Its `inner_idx` parameter is a **forward reference** to the inner type definition. The inner type (or its descendants) may reference the Recursive entry's own index, forming the cycle.

**Why forward?** The encoder performs a DFS that visits leaves before compounds. When it encounters a Recursive wrapper, it allocates the wrapper's index immediately, then recurses into the inner type. The inner type's children (which aren't the self-reference) get lower indices. The inner type itself gets a higher index. So the wrapper always has a lower index than its inner type.

**Decoder handling**: The decoder pre-allocates all `entry_count` slots. When it encounters a `0x12` entry:
1. Create a recursive type wrapper (C: `east_recursive_type_new()`)
2. Store it at `table[i]`
3. Record the pending fixup `(i, inner_idx)`

After all entries are decoded, apply fixups in order: for each `(wrapper_idx, inner_idx)`, set `table[wrapper_idx].inner = table[inner_idx]` and finalize.

### 2.3 Type Identity and Deduplication

The encoder maintains an identity map from type objects to table indices:
- **TypeScript**: `Map` keyed by object identity + `type_id` (a hash-based integer assigned at construction time via `stamp()` in `types.ts`). The `type_id` provides fast cross-object lookup when identity fails (e.g., independently constructed identical types).
- **C**: Open-addressing hash table keyed by `EastType*` pointer. Types are pointer-interned after construction.

When the encoder visits a type already in the map, it returns the existing index. This guarantees each unique type appears exactly once in the table.

### 2.4 Entry Ordering

Entries are written in **DFS post-order** from the root type: leaves first, then their parents. This means:
- Primitives referenced by the root type get the lowest indices (often 0–7)
- Common sub-types like `Option(String)` = `Variant(none: Null, some: String)` get low indices
- The root type has the highest index (or near-highest if Recursive wrappers are involved)

Low indices encode as 1-byte varints (0–127). Since frequently-referenced types naturally get low indices, most type references in the table are 1 byte.

---

## 3. String Table

The string table deduplicates all string values in the value data. Every position in the value stream where a String type is expected contains a varint index into the string table, rather than an inline UTF-8 string.

### 3.1 Encoding

During encoding, the string table is populated lazily (same two-pass approach as the type table):
1. The value is encoded to a temporary buffer. Each String value encountered is added to a `Map<string, number>` (string → index). The index is the insertion order.
2. After encoding completes, the string table section is written: `[varint header_byte_length] [varint count] [entries...]` where each entry is `[varint byte_length] [UTF-8 bytes]`.
3. The final blob is assembled: magic + type table + string table + value data.

### 3.2 Decoding

The decoder reads the entire string table into a `string[]` array before processing value data. Each String position in the value stream reads a varint index and returns `stringTable[idx]`.

**Bounds checking**: If the index is out of range, the decoder throws `"String table index N out of bounds"`.

### 3.3 Scope

The string table covers ALL strings in the value data, including:
- Direct String-typed values
- Strings inside IR nodes (variable names, source file paths, builtin names)
- Strings inside struct/variant fields of the value tree

Field and case names in the **type table** are NOT in the string table — they are stored inline in the type table entries.

---

## 4. Value Encoding

Value encoding is purely positional — no type tags in the stream. The decoder walks the type tree and reads bytes according to each type constructor's encoding.

### 4.1 Primitive Encodings

| Type | Encoding |
|------|----------|
| Null | 0 bytes (no output) |
| Boolean | 1 byte: `0x00` = false, `0x01` = true |
| Integer | signed zigzag varint |
| Float | 8 bytes, IEEE 754 double, little-endian |
| String | `varint(string_table_index)` |
| DateTime | signed zigzag varint (epoch milliseconds) |
| Blob | `varint(byte_length)` + raw bytes |

### 4.2 Compound Encodings

| Type | Encoding |
|------|----------|
| Struct | fields concatenated in definition order, no delimiters |
| Variant | `varint(case_index)` + case value (case_index per alphabetical case ordering) |
| Vector | `varint(element_count)` + packed typed array bytes |
| Matrix | `varint(rows)` + `varint(cols)` + packed typed array bytes |

### 4.3 Mutable Container Backreferences

Mutable containers (Array, Set, Dict, Ref) use a backreference protocol that preserves aliasing and supports circular references:

**First occurrence** (inline):
```
varint(0)                    marker: this is an inline definition
[content bytes]              the container's contents
```
The byte offset of the content (after the `varint(0)`) is recorded in a refs map.

**Subsequent occurrence** (backreference):
```
varint(N)                    where N > 0: byte distance back to the content offset
```

**Content encoding per type**:
- Array: `varint(element_count)` + elements
- Set: `varint(element_count)` + elements
- Dict: `varint(entry_count)` + `[key value]` pairs
- Ref: inner value (no count — a Ref wraps exactly one value)

### 4.4 Function Encoding

See Section 5.

---

## 5. Function Encoding

Functions are East's most complex serialization case. A function value consists of IR (intermediate representation) plus captured values.

### 5.1 Wire Format

At a function position in the value stream:

```
[beast2-encoded IR]       IR tree encoded via IRType schema
[varint]                  capture_count
[beast2-encoded value]    capture_0 (type from IR capture list)
[beast2-encoded value]    capture_1
...
```

### 5.2 IR Type Deduplication (Unified Table)

Each IR node contains type annotations (variable types, expression result types, etc.). These are `EastTypeValue` objects — values of the `EastTypeType` type.

**Key mechanism**: The encoder detects `EastTypeType` schema positions by comparing the position's `type_id` against the known `type_id` of `EastTypeValueType`. At these positions, instead of encoding the type value as a full variant tree, it writes a varint table index. Types are added lazily — if not already in the table, they are added on the fly.

**Encoding**: The IR is encoded using a module-level singleton encoder built from `toEastTypeValue(IRType)`. When this encoder hits an `EastTypeType` position, it:
1. Checks if the type value is in the table (by identity or `type_id`)
2. If not, adds it via `TypeTableBuilder.addETV()`
3. Writes `varint(table_index)`

**Decoding**: The IR decoder reads varint indices at `EastTypeType` positions and looks up `typeTable[idx]` to restore the original `EastTypeValue` objects.

**Key benefit**: A recursive UI component type referenced by 50 function signatures is stored once in the type table. Without this, it would be stored once per function.

### 5.3 Captures

After the IR, the encoder writes `varint(capture_count)` followed by each captured value. Capture types come from the IR's capture list (`ir.value.captures[i].value.type`). Capture encoders/decoders are built lazily and cached by type identity.

The decoder reads each capture, builds a `RuntimeContext` with the captures (boxed if mutable, value if immutable), and compiles the IR into a callable function with the captures injected.

### 5.4 Two-Pass Encoding

Encoding uses a two-pass approach:

**Pass 1** — Encode the value to a temporary buffer. During this pass:
- Type annotations in function IR are discovered and added to the type table
- String values are discovered and added to the string table
- The type table builder is cloned per-call (base table from root type + per-call additions)

**Pass 2** — Write the final blob: `magic + type_table(complete) + string_table(complete) + value_data(from pass 1)`

---

## 6. Decoding Algorithm

### 6.1 Self-Describing Decode

Used by `decodeBeast2()`. Reads magic, type table, string table, builds a value decoder from the root type, decodes the value.

### 6.2 Known-Type Decode

Used by `decodeBeast2For(type)`. Pre-builds a value decoder closure tree once (at factory creation). Per-call: reads magic, type table (needed for IR type restoration in functions), string table, decodes value using pre-built decoder.

### 6.3 Type Table Decoding

Single-pass with post-fixup for recursive types:

```
decode_type_table(data, count):
    table = new EastTypeValue[count]
    fixups = []
    
    for i in 0..count-1:
        tag = read_u8(data)
        table[i] = ENTRY_PARSERS[tag](data)  // direct array index dispatch
        if tag == 0x12:  // Recursive
            fixups.push((i, inner_idx))
    
    // Reconstruct EastTypeValue tree with Recursive(depth) refs
    reconstruct(parsed_entries, root_idx) → EastTypeValue[]
```

The reconstruction phase converts the flat table back into an `EastTypeValue` tree. Recursive entries are converted to proper `Recursive(depth)` self-references using a depth stack that tracks compound type nesting.

### 6.4 Frozen Decode

Decoders accept a frozen mode — `decodeBeast2(data, { frozen: true })` / a `frozen` option on `decodeBeast2For` in TypeScript, `east_beast2_decode_full_frozen` in C, `load_frozen_value` in Python — that constructs every value in the tree deeply immutable **at decode time**; nothing is re-walked after the fact. Every runner decodes task inputs this way: task inputs are immutable, on all runtimes, always.

- **Construction-time freezing.** Each container, struct, variant, date, vector, and matrix is frozen as it is built. TypeScript uses `Object.freeze` plus a WeakSet brand (`markFrozen` / `isFrozenValue`) for values `Object.freeze` cannot cover (typed arrays throw on freeze; pager-backed lazy values hydrate through their own internals). C carries a per-value `frozen` flag, inherited by nested allocations and checked by every mutating builtin; Python inherits the C flag through the bridge.
- **Functions stay mutable.** A Function/AsyncFunction subtree (IR + captures) always decodes unfrozen — captures are closure-owned state, and the IR is stamped in place when the decoded function is finalized. The frozen flag is cleared for the subtree and restored after.
- **Mutation is an error.** Every mutating builtin on a frozen value fails with `cannot mutate a frozen value (task inputs are immutable) — copy first`, uniformly across runtimes; `.copy()` is the escape hatch.
- **Value semantics under `Is`.** Two frozen Array/Set/Dict/Vector/Matrix values compare by deep value equality under East `Is` (the Blob precedent — a frozen collection is a value, not a mutable cell). A frozen Ref remains an identity cell. `equalFor` / `compareFor` / print / encode are byte-for-byte unchanged.
- **Frozen lazy opens.** `openBeast2LazyFor(type, { frozen: true })` (TS) / `east_beast2_open_paged_frozen` (C) / `open_paged_value(..., frozen=True)` (Python) open segmented blobs pager-backed **and** frozen: each segment decodes frozen on demand, mutation is refused before any hydration, and the lazy shape gate collapses to excluding only Ref- and function-bearing element shapes (unfrozen, any nested Array/Set/Dict/Vector/Matrix element forces an eager decode, because East mutates those in place through read-out elements).
- **Where paged values come from.** A paged value enters a program four ways, all frozen: a runner-opened task input (the size threshold, or `--stream`); the `BlobOpenBeast2` builtin (`blob.openBeast(T)` / `blob.open_beast(T)`), whose value retains the Blob it aliases; the std family's generic platform call `fs_open_beast<T>` (`FileSystem.openBeast(T, path)`), whose value owns a mapping of the file on east-c and east-py and a descriptor with positioned reads on Node; and a platform function returning one (python's `open_beast2_file` / `open_paged_file` holds cross the return seam by pointer). In C the bytes behind a paged value are its own (`east_beast2_open_paged`), a retained owner's (`east_beast2_open_paged_owned`), or a host's released through a callback fired exactly once when the value dies (`east_beast2_open_paged_external`); in TypeScript a `Beast2SyncRangeReader` serves the tail, the head and each decoded frame by positioned reads, so the wire bytes never sit on the heap whole. Every runner maps a lazily opened input the same way.

---

## 7. Varint Encoding

Beast2 uses unsigned LEB128 varints (same as Protobuf):

| Value range | Bytes |
|-------------|-------|
| 0–127 | 1 |
| 128–16383 | 2 |
| 16384–2097151 | 3 |

Signed integers (Integer, DateTime) use zigzag encoding: `(n << 1) ^ (n >> 63)`, then encoded as unsigned varint.

**Decode optimization**: The `readZigzag` decoder uses a fast path for values fitting in ≤4 varint bytes (±67M). These are decoded entirely in Number arithmetic with a single `BigInt()` conversion at the end, avoiding intermediate BigInt allocations. Most IR integers (indices, line numbers) hit this path.

---

## 8. Examples

### 8.1 Simple Type: `Array(Struct({ name: String, status: Option(String) }))`

Where `Option(T) = Variant({ none: Null, some: T })`.

**Type table** (DFS post-order):

```
Index  Tag    Definition
─────  ────   ──────────
0      0x00   Null
1      0x01   String
2      0x08   Variant(2): "none"→0, "some"→1
3      0x09   Struct(2): "name"→1, "status"→2
4      0x0A   Array(3)

root_type_index = 4
```

### 8.2 Recursive Type

`Recursive(self => Variant({ leaf: Null, branch: Struct({ children: Array(self), value: Integer }) }))`

**Type table**:

```
Index  Tag    Definition
─────  ────   ──────────
0      0x12   Recursive(inner=5)         ← wrapper allocated first
1      0x02   Integer
2      0x0A   Array(0)                   ← Array(Recursive@0)
3      0x09   Struct(2): "children"→2, "value"→1
4      0x00   Null
5      0x08   Variant(2): "branch"→3, "leaf"→4

root_type_index = 0
```

### 8.3 Function with Captures

Type: `FunctionType([IntegerType], IntegerType)`

**Type table**:
```
Index  Tag    Definition
─────  ────   ──────────
0      0x02   Integer
1      0x10   Function(inputs=[0], output=0)

root_type_index = 1
```

**String table**: Contains source file paths, variable names, builtin names from the IR.

**Value data**: `[beast2-encoded IR with type indices] [varint: capture_count] [capture values...]`

---

## 9. Cross-Runtime Implementation Notes

### TypeScript

- **Type table encoder**: DFS walker with `Map<EastType, number>` (identity) + `Map<number, number>` (`type_id` → index) for cross-object dedup via `toEastTypeValue` cache
- **Type table decoder**: Pre-allocate array, single pass, fixup list for Recursive entries, depth-based reconstruction to `EastTypeValue`
- **Value encoder/decoder**: Closure-compiler pattern — `buildEncoder`/`buildDecoder` build a tree of closures, one per type node, at factory creation time. Reused for every encode/decode call.
- **IR handling**: Module-level singleton encoder/decoder built from `toEastTypeValue(IRType)`. `EastTypeType` positions detected by `type_id` comparison — transparent, no separate IR substitution step.
- **String table**: Encoder uses `Map<string, number>` (lazy discovery during value encoding). Decoder reads into `string[]` for O(1) index access.

### C

- **Type table encoder**: DFS walker with open-addressing hash table keyed by `EastType*` pointer
- **Type table decoder**: Pre-allocate array, single pass, use `east_recursive_type_new()` / `east_recursive_type_set()` for fixups
- **Value decoder**: Tree-walking decode functions
- **String table**: Read into array of `east_string_t` pointers

### Python

- No changes — all beast2 operations delegate to C via Cython bindings

---

## 10. Design Decisions and Rationale

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Type reference | Varint index into flat table | Maximum dedup; 1 byte for common types (indices 0–127) |
| Tag byte size | Fixed 1 byte (0x00–0x12) | Only 19 constructors; used as direct array index, not switch/case |
| Tag dispatch | Fixed-index function table | Tag byte indexes directly into `decoder_table[tag]()` — one indexed load + indirect call, zero branches |
| Tag ordering | Frequency within category | Primitives 0x00–0x07, compounds 0x08–0x11, special 0x12 |
| Recursion | Forward-ref + post-fixup | Single-pass decode, no backpatching, clean for C/TS/Py |
| Type table position | Before string table and value data | Must be available before decoding functions in value stream |
| String table | Separate section after type table | Deduplicates repeated strings; O(1) decode vs O(n) UTF-8 parse; lazily populated during two-pass encoding |
| String scope | Value data only (not type table names) | Type table field/case names appear once per unique type; value strings repeat across functions |
| Header skip | `header_byte_length` varint | O(1) skip for both type table and string table sections |
| Unified type table | Single table for header + IR | Eliminates redundancy for types shared between schema and functions |
| IR type detection | `type_id` comparison against `EastTypeValueType` | Zero-cost detection at encode/decode time; no separate IR substitution step |
| Value encoding | Unchanged from beast v1 (except strings) | Orthogonal to type header; minimal migration cost |
| Struct field ordering | Definition order | Field order is significant in East's structural type system |
| Variant case ordering | Alphabetical | Enforced by VariantType() constructor; deterministic encoding |
| Zigzag fast path | Number arithmetic for ≤4 byte varints | Avoids intermediate BigInt allocations for common small values |

---

## 11. Implementation Status

### TypeScript (libs/east) — Complete

Beast2 v2 fully implemented with flat type table, string table, two-pass encoding, and recursive type support:

- **EastTypeValue Recursive representation:** id-based refs with `VariantType({ ref: IntegerType, wrapper: StructType({ id: IntegerType, inner: type }) })`. `ref(type_id)` is a context-independent self-reference. `wrapper({id: type_id, inner})` defines the recursive type. The `id` is the RecursiveType's `type_id` from `assignTypeId()`.
- **RecursiveType interning:** `RecursiveType()` constructor interns structurally identical types via `isTypeEqual`, ensuring the same structure always gets the same `type_id` and therefore the same wrapper id in ETVs.
- **Caching:** `toEastTypeValue` caches results when no RecursiveType is on the conversion stack. Inside a recursive scope, results contain `ref(id)` that must stay inside their enclosing wrapper. Outside, RecursiveTypes are fetched from cache as complete `wrapper({id, inner})` values. This ensures `ref(id)` only appears inside wrapper inner types, never standalone.
- **Closure builders:** All closure-compiler-style builders (`comparison.ts`, `beast2.ts`, `json.ts`, `east.ts`, `fuzz.ts`, `patch/diff.ts`) use `Map<bigint, handler>` keyed by wrapper id. Wrapper case: `typeCtx.set(id, ret)`, recurse into `inner`. Ref case: `typeCtx.get(id)`.
- **Type equality:** `isTypeValueEqual` is a hand-written recursive comparator (not `equalFor(EastTypeValueType)`) that handles `ref(N)` ≡ `wrapper({id=N, inner})` when ids match — they denote the same recursive type.
- **Type table dedup:** `TypeTableBuilder` deduplicates across ET and ETV paths via `tidMap` (type_id → table index). ETVs are always stamped with their source EastType's `type_id`. The Recursive entry registers its `type_id` in `tidMap` during `visitET`. Verified: `addETV` after `add` produces zero duplicate entries.
- **Byte-level verification:** ET path (pointer-based, matching C) and ETV path (value-based, for IR annotations) produce identical type table bytes for recursive types.
- 2986 tests pass (40 unit + 39 type-table + 25 ETV + compliance suite)
- Benchmark: 2.58 MB encoded size, 322ms encode, 304ms decode (20 dashboards, 1640 closures)

### C (libs/east-c) — Remaining Work

The C runtime has the flat type table encoder/decoder and string table implemented. It compiles clean and passes ~1586/1594 compliance tests for non-recursive data types. Remaining:

1. **`type_of_type.c`:** Update to produce `Recursive(variant("wrapper", struct({id: Integer, inner: type})))` and `Recursive(variant("ref", Integer))` instead of `Recursive(Integer)`. The `id` value should be a unique identifier for each recursive type (analogous to TS's `type_id` from `assignTypeId()`).

2. **IR type substitution:** The beast2 encoder's IR type substitution detects `EastTypeType` positions and writes varint table indices. With the new `EastTypeType` definition (Recursive case changed from `IntegerType` to `VariantType({ref: IntegerType, wrapper: StructType({id: IntegerType, inner: type})})`), the IR binary encoding changes. The C decoder must handle the new format.

3. **Re-export test IR:** Run `make test-export` from `libs/east` to regenerate compliance test IR with the new format, then re-run C compliance tests.

4. **Type table byte ordering is unchanged:** Both C and TS produce wrapper-first DFS post-order entries. The binary type table format (tag bytes + varint indices) is identical. Only the IR type annotation encoding within function values changed.

### Type Table Byte Ordering

Both runtimes produce **wrapper-first** ordering for recursive types:

```
ET path (C):  Recursive wrapper allocated first → DFS into inner → wrapper filled
ETV path (TS): Recursive(wrapper({id, inner})) encountered → allocate wrapper first → DFS into inner → wrapper filled
```

Both produce:
```
[0] Recursive(inner=N)    ← wrapper at low index
[1] Integer               ← leaf types
...
[N] Variant(...)          ← inner type at high index
root_type_index = 0
```
