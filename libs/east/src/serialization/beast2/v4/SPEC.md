# Beast2 v4 Specification

## Blob layout

```
magic_bytes[8]              0x89 "East" 0x0D 0x0A 0x04
type_table_section          flat array of unique EastType entries, varint-indexed
string_table_section        flat array of unique strings, varint-indexed
source_map_section          bespoke format: location stacks for IR debugging
value_table_section         ALL mutable containers (Array/Set/Dict/Ref), varint-indexed
value_stream                root value, type-directed positional encoding
```

All five tables/sections are **global** — shared across the entire blob. Every section is always present (empty if unused).

## Tables

### Type table
- Every unique `EastType` in the value gets one entry.
- Referenced by `varint(type_idx)` from value table entries.
- Section format: `varint(byte_length) varint(root_type_idx) varint(count) [entries...]`

### String table
- Every unique string value gets one entry.
- Referenced by `varint(string_idx)` from value stream, value table entries, and source map.
- Section format: `varint(byte_length) varint(count) [varint(str_byte_len) utf8_bytes...]`

### Source map
- Location stacks for IR debugging. Bespoke format (not type-directed).
- Referenced by `loc_id` fields on IR nodes.
- Auto-extracted from function values via `EAST_SOURCE_MAP_SYMBOL` during encoding.
- Section format: `varint(byte_length) varint(stack_count) [varint(frame_count) [varint(filename_str_idx) varint(line) varint(column)]...]`
- Filenames reference the string table for dedup.
- `stack_count=0` when no source map is available. Entry 0 (the empty stack sentinel) is not written — it's implicit.

### Value table
- **Every** mutable container instance (Array, Set, Dict, Ref) reachable from the root value.
- This includes IR-internal arrays (captures, parameters, arguments, statements).
- Identity-keyed: same JS object = same table entry. Different objects with identical content = different entries.
- Entries stored in depth-first walk order (parents before children).
- Referenced by `varint(value_table_idx)` wherever a mutable type appears.

## Value table section format

```
varint(section_byte_length)
varint(entry_count)
repeated entry_count times:
  varint(entry_byte_length)   byte length of the rest of this entry (for skip in two-pass decode)
  uint8(kind_tag)             0x0A=Array, 0x0B=Dict, 0x0C=Set, 0x0D=Ref
  varint(elem_type_idx)       type table index (Dict: key_type_idx, val_type_idx)
  varint(element_count)       Array/Set: element count, Dict: pair count (Ref: omitted, always 1)
  [element data...]           type-directed encoding per element
```

Elements inside the value table use the **same encoding rules** as the value stream:
- Primitives, Structs, Variants: inline type-directed encoding
- Mutable containers: `varint(value_table_idx)` — reference to another table entry
- Functions: inline (IR + captures), captures may reference value table entries

## Value stream

The root value is encoded using type-directed positional encoding:
- Primitives: inline (varint, zigzag, float64, string_idx, etc.)
- Struct: fields in declaration order, each encoded by its type
- Variant: `varint(case_idx)` + case value encoded by case type
- Recursive: transparent — wrapper unwraps, ref delegates to wrapper
- Mutable container (Array/Set/Dict/Ref): `varint(value_table_idx)`
- Function: IR encoded inline + `varint(capture_count)` + capture values by type
- Vector/Matrix: inline numeric buffer (not in value table)

**No special cases.** In particular, `EastTypeType` values (type annotations on IR nodes) are encoded as regular variants — NOT as type table indices. This ensures uniform encoding across the value stream and value table, and simplifies multi-runtime implementations. (v2/v3 used a special type-table-index encoding for EastTypeType positions; v4 removes this.)

## Encoding algorithm

### Phase 1: Walk — build value table and register types
Walk the entire value graph depth-first, collecting all mutable containers.
The walker follows the type schema to know which fields to recurse into.
The walker also registers Recursive type wrappers in the type table builder during the walk (so refs can resolve during encoding).
For Functions: walk the IR body (as an EastTypeValue variant tree via `IRType`) AND walk capture values (unwrapped from the boxed/value variant).

```
walk(value, type):
  if type is Array/Set/Dict/Ref:
    if value already in identity_map: return
    identity_map[value] = next_index++
    table.push({ kind, type, value })
    recurse into children by element type
  if type is Struct: recurse each field
  if type is Variant: recurse case value
  if type is Recursive(wrapper): register in type table, recurse inner
  if type is Recursive(ref): recurse via saved wrapper inner
  if type is Function: walk IR via IRType, then walk capture VALUES by capture types
  else: return (primitive, Vector, Matrix)
```

### Phase 2: Encode value table entries (FIRST)
For each entry, buffer the encoded bytes (kind_tag + type info + elements), then write `varint(entry_byte_length)` + buffered bytes.
Encoding uses a single unified encoder (`buildEncoder`) that handles both user values and IR values.
The encoder shares a `typeCtx` from setup time, so recursive types resolve correctly.
Types and strings are discovered lazily during this phase.

### Phase 3: Encode value stream
Encode the root value using the same unified encoder.
Mutable containers emit `varint(table_index)`, everything else is inline.

### Phase 4: Assemble blob
Write sections in order: magic, type table, string table, source map, value table, value stream.
Source map filenames must be added to the string table BEFORE writing the string table section.
The source map section is written to a temporary buffer first (to discover filenames), then the string table and source map sections are written in order.

## Decoding algorithm

1. Read magic bytes, verify version (0x04)
2. Read type table section → `typeTable: EastTypeValue[]`
3. Read string table section → `string[]: string[]`
4. Read source map section (uses string table for filenames) → `SourceMap`
5. Read value table section (two-pass):
   - **Pass 1 (allocate)**: For each entry, read `varint(entry_byte_length)`, read kind_tag + type info to pre-allocate an empty container (Array/Set/Dict/Ref), then skip to next entry using the byte length. All containers are pushed to `mutableValues[]`.
   - **Pre-build decoders**: Build decoders for ALL Recursive wrapper types in the decoded type table into a shared `decTypeCtx`. This ensures cross-recursive-type references resolve (e.g., IR nodes referencing EastTypeType).
   - **Cache decoders**: Cache element decoders by type index to avoid rebuilding for each entry.
   - **Pass 2 (fill, reverse order)**: Fill entries in REVERSE order (children before parents). For each entry, create a fresh BufferReader at the entry's recorded offset, read kind_tag + type info + elements. Mutable container elements resolve via `mutableValues[varint()]`. Reverse order ensures parent entries (e.g., functions) see fully-populated child entries when compiled.
6. Read value stream: type-directed decoding using pre-built `valueDecoder`. Mutable containers → `mutableValues[varint()]`.

## Critical rules

### 1. One encoder, one decoder
There is no separate "IR encoder" vs "user encoder". The same `buildEncoder(type)` function handles all types uniformly. When it encounters a mutable container type, it emits a value table index. When it encounters a struct/variant, it encodes inline. This applies whether the value is user data, IR, or a mix.

### 2. Encode and decode are completely independent
The encoder and decoder must not share internal state. Each is self-contained:
- **Encoder** works from source types (in-memory `EastType` objects with source-level recursive IDs). It builds encoder closures from these types and uses them to write bytes.
- **Decoder** works from decoded types (read from the blob's type table section, with position-based recursive IDs). It builds decoder closures from these types and uses them to read bytes.
- **The wire format is the only contract between them.** Both agree on byte layout, section ordering, and encoding rules — NOT on internal state like recursive type IDs or closure trees.
- Recursive type IDs are NOT stable across encode/decode. The type table serialization assigns position-based IDs that differ from the source-level counter-based IDs. The encoder's `typeCtx` (keyed by source IDs) and the decoder's `typeCtx` (keyed by decoded IDs) must never be shared or mixed.
- Consequence: you can encode on one machine/runtime and decode on another. No ambient state, no process-level singletons shared between encode and decode paths.

### 3. Tables are global and always present
All five sections (type table, string table, source map, value table, value stream) are always present in the blob, even if empty. All tables are global — shared across the entire blob. There is no per-function or per-section scoping of table entries.

### 4. The wire format is the source of truth
When decoding, build all decoders from the decoded type table entries — not from any pre-existing in-memory types. The decoded types are the ground truth for the blob's contents. Pre-built decoders from source types may be used for the value stream (where the caller specifies the expected type), but value table entries must be decoded using their self-describing type info from the blob.

### 5. Source map ownership
The source map is created during `East.function()` / `East.asyncFunction()` body execution (via `ensure_source_map`). It is stored on the FunctionExpr via `SourceMapSymbol`. When `toIR()` is called, the source map is transferred to the `EastIR` object. When the function is compiled, the source map is attached to the compiled function via `EAST_SOURCE_MAP_SYMBOL`. During beast2 encoding, the source map is auto-extracted from the function value and written to the source_map_section.

## File structure

```
beast2/v4/
  container.ts           the v4 codec: buildEncoder/buildDecoder closure
                         factories, value-table read/write, encodeBeast2V4For,
                         decodeBeast2V4For, decodeBeast2V4
  type-table.ts          TypeTableBuilder, read/write type table section
                         (also reused verbatim by the v5 structural type section)
  string-table.ts        read/write string table section
  sourcemap-table.ts     read/write source map section
  value-table.ts         walk, buildValueTable, buildIndexMap, isMutableType
  SPEC.md                this file
```

Version-agnostic entry points (`encodeBeast2For`, `decodeBeast2For`,
`decodeBeast2`, …) live in `../index.ts` and dispatch on the magic's version
byte — see `../SPEC.md` for the magic registry and version policy.

The encoder in `container.ts` uses a single `buildEncoder(type)` factory that produces a closure tree. The factory is called ONCE per root type at setup time, producing reusable encoders. The setup-time `typeCtx` is reused by the value table entry writer for consistent recursive type resolution. Mutable containers always emit `varint(table_index)` via the `EncodeContext.indexMap`. The value table walker in `value-table.ts` uses the same type-directed walk to discover all mutable values before encoding begins, and registers Recursive type wrappers in the type table builder during the walk.
