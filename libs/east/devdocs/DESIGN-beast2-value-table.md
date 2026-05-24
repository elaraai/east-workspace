# Design: Beast2 Value Table (Replacing Backref Protocol)

Status: **Draft — follow-up to [DESIGN-source-map.md](./DESIGN-source-map.md); pending approval before implementation**

## TL;DR

Beast2 currently uses a pointer-identity backref protocol for `Array`/`Set`/`Dict`/`Ref` values to preserve East's mutation/aliasing semantics. The protocol works per-runtime but defeats cross-runtime byte-identity: pointer identity is an implementation concept, and two runtimes can legitimately differ on which JS/C objects they share.

This design replaces backrefs with a **mutable value table** — a new beast2 section (v4) that holds each distinct mutable container exactly once, indexed by deterministic depth-first walk order. Values that contain mutable containers reference them by integer index instead of inline content or backref distance.

**Scope**: beast2 v4 wire format. No changes to the IR data model, no changes to the type/string tables, no changes to source maps (v3 work is a prerequisite).

**Outcome**: byte-identity across runtimes by construction (both TS and C walk the IR graph in the same order, assign the same indices, produce identical bytes). Simpler encoder/decoder implementations. Smaller wire format for graphs with heavy aliasing.

**Depends on**: [DESIGN-source-map.md](./DESIGN-source-map.md) landed first. v4 assumes v3 is the baseline.

**Status**: awaiting design approval before implementation begins.

## Audience and context

This document is a follow-up to the [source map separation design](./DESIGN-source-map.md). That doc should be read first — it establishes the background on East, multi-runtime architecture, and beast2, and describes how location data is being pulled out of IR nodes.

**This doc handles the remaining byte-identity gap**: how beast2 encodes user-level mutable container values (`Array`, `Set`, `Dict`, `Ref`), and why the current approach prevents cross-runtime byte-identity even after the source map work lands.

### What this doc covers

- Why beast2 currently uses a pointer-identity backref protocol for mutable types
- Why that approach can't produce byte-identical output across runtimes
- A replacement design: a dedicated mutable value table, indexed by deterministic walk order
- Wire format specification for beast2 v4 (assumes v3 source-map-separated is the baseline)
- Encoder two-pass algorithm (discovery + emission)
- Decoder resolution algorithm
- Edge cases: self-reference, cycles, nested refs, identical-content-distinct-instances
- Migration plan from v3 to v4

### Beast2 version progression

| Version | What it adds | Status |
|---|---|---|
| **v2** | type table, string table, value stream with backref protocol | current production |
| **v3** | adds `source_map_section`; IR nodes carry `loc_id` instead of inline location arrays; backref protocol still in use for user-level mutable values | proposed in [DESIGN-source-map.md](./DESIGN-source-map.md) |
| **v4** | adds `mutable_value_table_section`; backref protocol removed; all mutable containers go in the value table indexed by walk order | proposed in this doc |

Each version is a hard cutover from the previous. No transitional dual-version readers; consumers regenerate on deploy.

### Dependencies

This design assumes the source map separation design (v3) has already landed. Specifically:

- Beast2 is at v3 with a `source_map_section` carrying location stacks
- IR nodes carry `loc_id: IntegerType` instead of inline location arrays
- No remaining use of backrefs for location arrays

If v3 is not yet deployed, this follow-up is impossible to apply cleanly because location arrays and user values would still be sharing the same backref protocol — you can't remove half of it.

## What is the beast2 backref protocol?

(Recap for anyone who hasn't read the source map doc in detail.)

Beast2 is East's binary wire format. The current production format is **v2**. The source map design (DESIGN-source-map.md) introduces **v3** which adds a `source_map_section` and removes inline location arrays from IR nodes; v3 is the baseline this design assumes is already deployed. **v4** is what this design proposes.

For mutable container types — `Array`, `Set`, `Dict`, `Ref` — both v2 and v3 use a backreference protocol to preserve East's identity semantics. The rules are:

```
encoding of a mutable container value at byte offset P:
  varint(distance)        # 0 means inline first occurrence; >0 means backref

  if distance == 0:
    ... inline container data (count + elements) ...
    # encoder remembers: "value with pointer X was stored at offset P"

  if distance > 0:
    # this is a backref to an earlier inline occurrence
    # decoder looks up the value stored at offset (P - distance)
    # returns the same EastValue instance (aliasing preserved)
```

The encoder walks the value graph once, maintaining a `Map<EastValue pointer, byte offset>`. When it encounters a value whose pointer is already in the map, it emits a backref (the varint distance from the current buffer position to the stored offset). Otherwise it emits the value inline and records the new offset.

### Why preserve identity?

East distinguishes between:

```ts
const a = $.let([1n, 2n, 3n]);
const b = $.let([1n, 2n, 3n]);
// a and b are DIFFERENT array instances. Mutating a doesn't affect b.

const c = $.let([1n, 2n, 3n]);
const d = $.let(c);  // or: d = c
// c and d refer to the SAME array. Mutating c affects d.
```

`East.is(a, b) === false` (different instances)
`East.is(c, d) === true` (same instance)

When we serialize a value that contains both `a` and `b`, they must come out as two distinct arrays. When we serialize a value that contains both `c` and `d`, they must come out as one shared array, so that mutations remain visible to both.

The backref protocol handles this by preserving pointer identity: if the encoder sees the same pointer twice, both references decode to the same reconstructed value. If it sees two different pointers, they decode to two different values (even if their content is identical).

## The problem

The backref protocol works fine for *single-runtime* use (TS ↔ TS, C ↔ C). It breaks when you try to get **byte-identity across runtimes**.

### The root cause

"Pointer identity" is an implementation concept, not a data property.

- In TS, pointer identity means "same JS object reference" (what `===` returns)
- In C, pointer identity means "same C struct address" (what `==` returns on pointers)
- These are *entirely separate* notions of identity that happen to align in common cases but diverge in edge cases

When the compiler builds an East value that contains aliased arrays, the sharing pattern depends on how the compiler chose to construct the in-memory graph. Two compilers implementing the same East semantics can legitimately produce different pointer-sharing patterns for the same logical value. The spec doesn't (and arguably shouldn't) require a specific construction pattern.

Concrete example: a helper function constructs a shared array:

```ts
function makeRow(): number[] { return [0, 0, 0]; }

const matrix = [makeRow(), makeRow(), makeRow()];
```

- TS: each `makeRow()` call produces a distinct JS array. The matrix has three distinct inner arrays, no sharing. Backref protocol: each inner array is inline, no backrefs.
- C, depending on construction: might intern the return value, causing all three to share one pointer. Backref protocol: first inline, two backrefs. **Different wire format for the same logical value.**

The matrix decodes correctly in both cases (three distinct arrays vs one shared array both have observable differences only if someone mutates, and the program may or may not do that), but the wire bytes are different. SHA256 of the blob differs. Content-addressed storage fragments.

### Why this matters

e3 uses SHA256 of beast2 blobs for content-addressed task output storage. Two runtimes producing the same logical output should get the same hash. With the current backref protocol, that requires coordinating on specific pointer-sharing patterns — which is both implementation-entangled and impossible for ambiguous cases.

After the source map work lands, location data is no longer affected by this problem (it's deduplicated via a content-keyed sidecar). But user-level `Array`/`Set`/`Dict`/`Ref` values still go through the backref protocol, so cross-runtime byte-identity for values containing mutable containers is still impossible.

## Prior art

How other serialization formats handle aliasing and byte-identity:

### Cap'n Proto

Cap'n Proto uses a **segment-and-pointer** architecture. A message is divided into segments (contiguous regions of 8-byte words). Values inside a segment are laid out at known offsets. Pointers between values are offsets within a segment or (for inter-segment references) tagged far pointers. Shared sub-structures are encoded as pointers to the same offset.

The encoding is built by the message builder as it constructs the value graph: when you "orphan" a value into the builder, it allocates space and records the offset. Copying a reference to that same orphan produces a pointer to the same offset. Distinct construction produces distinct offsets.

**Key property**: pointer sharing is explicit in the API. The builder knows which values are being aliased because the user tells it via the API shape, not by dumb pointer equality.

**Key property**: the wire format is completely deterministic given the order in which the builder was called. Two runtimes making the same sequence of API calls produce identical bytes.

### FlatBuffers

FlatBuffers has a similar builder-based approach but without explicit sharing — each vector/table is serialized independently. Sharing sub-structures requires manual serialization (building the shared part once, reusing the offset). FlatBuffers doesn't natively support "two references to one thing"; users have to handle it manually.

Not a good fit for East because East's semantics *require* sharing to be automatically handled.

### Protocol Buffers

Protobuf has no concept of reference sharing in the wire format. Every occurrence of a value is encoded fully. If two fields reference the same struct, both fields get serialized copies. After decode, they're two distinct objects even if they started out as one.

Protobuf's answer is "don't need aliasing in the data model" — which works for its use case (RPC messages) but doesn't work for East (East has true mutable references).

### Apache Arrow

Arrow uses a **dictionary encoding** for repeated values: the writer builds a dictionary (table of unique values) and the value stream references dictionary entries by index. The dictionary is deduplicated by content, not by pointer — it's an optimization, not a semantic feature.

Arrow's dictionary approach inspires this design, but Arrow dedupes by content (which would break East's mutation semantics). The East adaptation uses **identity-keyed** dedup during the encoder's walk instead.

### Java serialization

Java's built-in `ObjectOutputStream` mechanism uses a **handle table** to deduplicate object references inline in the stream. The actual wire format uses two tag bytes: `TC_OBJECT` (0x73) introduces a new object whose handle is implicitly assigned in encounter order, and `TC_REFERENCE` (0x71) followed by an absolute handle ID references an already-assigned object.

The simplified algorithm (eliding the many tag-byte variants Java actually uses) is:

```
write_value(v):
  if v in handle_table:
    emit TC_REFERENCE
    emit handle_table[v]            # 4-byte handle ID
  else:
    new_handle = next_handle++
    handle_table[v] = new_handle
    emit TC_OBJECT
    emit serialized_form(v)         # implicitly assigns the new_handle
```

**Key property**: identity tracking happens *during* the write. The encoder walks the graph, assigning handles in first-encounter order. Two encoders walking the same graph in the same order produce identical handle sequences. The handle assignment is implicit (every TC_OBJECT increments a counter); only references write the handle.

This is the closest prior art to what this design proposes for beast2 — though beast2 v4 lifts the references into a dedicated table section rather than interleaving them with object encodings. The two formats differ in how they lay out the bytes (Java is fully streaming and inline; beast2 is sectioned), but the underlying identity-tracking discipline is the same.

## Proposed design

### Overview

Replace the backref protocol with a **mutable value table** that lives as a new section in the beast2 wire format. All distinct `Array`/`Set`/`Dict`/`Ref` instances reachable from the root value go into this table, indexed in depth-first walk order. Values that contain mutable containers reference them by index instead of by inline storage or backref distance.

**Key claims**:

1. **Determinism**: if two runtimes walk the value graph in the same order (which they do — both walk depth-first in struct field order and variant case sort order), they produce identical tables and identical indices. Byte-identity is achieved by construction.

2. **Simpler wire format**: no more distance varints. Value references are a single varint index into the mutable value table. Encoder doesn't need to track "where did I put this value" — it just assigns indices.

3. **Decouples from pointer identity**: the encoder's dedup key is still "pointer identity during walk" (because we're preserving aliasing, not content-deduping), but the wire format no longer exposes that concept. The wire format just references "value at index N in the mutable value table" with no reference to how the encoder decided two values were the same instance.

4. **Preserves East's mutation semantics**: distinct container instances get distinct table entries (even if their content is identical). Aliased instances share a single table entry. The decoder produces the same instance-sharing graph.

### Wire format (beast2 v4)

Bump the version byte from `0x03` to `0x04`. Section layout:

```
magic bytes (8B)            | "East" + version 0x04
type_table_section          | unchanged since v2
string_table_section        | unchanged since v2
source_map_section          | from v3 (unchanged; uses its own bespoke wire format)
mutable_value_table_section | NEW in v4
value_stream                | root value; uses value table refs for mutable containers
```

**Important**: the `source_map_section` is unchanged from v3 and does NOT use the v4 mutable value table, even though its contents logically include `ArrayType` values (the stacks and the outer array of stacks). This is because:

- The source map section must be decodable without the mutable value table being loaded (simpler dependency order)
- The source map's bespoke wire format (as defined in the v3 design doc) is already content-only, with no backref protocol in play — it's unaffected by the v3 → v4 transition
- Keeping it unchanged simplifies the v3 → v4 migration: any code that reads/writes the source_map_section in v3 works identically in v4

Only the `value_stream` and the new `mutable_value_table_section` use the new identity-keyed table. Everything else (type table, string table, source map) is unchanged.

### `mutable_value_table_section`

```
varint(section_byte_length)
varint(entry_count)
repeated entry_count times:
  uint8(kind_tag)          # 0x0A Array | 0x0C Set | 0x0B Dict | 0x0D Ref
  <type info — varies by kind_tag, see below>
  varint(element_count)    # Array/Set: num elements; Dict: num pairs; Ref: always 1
  ... element data ...     # see "Element encoding" below
```

**Per-kind type info headers:**

| kind_tag | Header after tag |
|---|---|
| `0x0A` Array | `varint(element_type_idx)` (index into type table) |
| `0x0C` Set | `varint(element_type_idx)` |
| `0x0D` Ref | `varint(element_type_idx)` |
| `0x0B` Dict | `varint(key_type_idx), varint(val_type_idx)` |

**Element encoding per kind:**

| kind_tag | Element stream |
|---|---|
| `0x0A` Array | `element_count` elements, each encoded as `<element>` (see "Element encoding inside a table entry" below) |
| `0x0C` Set | `element_count` elements in the canonical sort order, each `<element>` |
| `0x0B` Dict | `element_count` key-value pairs **interleaved**: `<key0> <val0> <key1> <val1> ...` in canonical key sort order |
| `0x0D` Ref | Exactly one `<element>` (the referenced value) |

**Entry ordering**: entries are stored in the order they are *first encountered* during the walk (see "Walk order specification" below). The walk visits each distinct mutable container exactly once; repeat visits (detected via pointer identity) reuse the existing index without creating a new entry.

### Element encoding inside a table entry

An element of a mutable container can itself be a mutable container (an Array of Arrays), a primitive, a Struct, a Variant, a Function, etc. The encoding rules are:

- **Primitives** (Null, Boolean, Integer, Float, String, DateTime, Blob): encoded inline using the same type-directed encoding as the current beast2 value stream.
- **Struct**: inline struct contents (each field encoded by type).
- **Variant**: inline `varint(case_idx)` + inline case value.
- **Function**: inline IR body + captures (same as current).
- **Array / Set / Dict / Ref** (nested mutable container): encoded as `varint(mutable_value_table_idx)` — a reference back into the table. First occurrences are always in the table itself, so references from within the table can only point forward or backward to already-emitted entries. The decoder's `values` array is filled progressively.

This means the mutable value table is **self-referential**: a table entry can reference other table entries by index. The encoder walks in a specific order to ensure forward references are valid.

### Value stream in v4

The root value is encoded at the start of the `value_stream` section. Its encoding rules are the same as v3 for non-mutable types (primitives, Struct, Variant, Function). When the root value (or any nested field) is a mutable container, it's encoded as `varint(mutable_value_table_idx)` — a reference to the table entry.

Net result: the value stream becomes simpler — no more backref distance calculations, no more inline mutable container data. Just type-directed encoding of immutable content plus varint indices for mutable containers.

### Example

Consider this East value:

```ts
const row = [1n, 2n, 3n];
const matrix = [row, row, [4n, 5n, 6n]];
```

`matrix` is an Array of Arrays. Two of its three elements reference the same `row` instance; the third is a distinct array.

**Current v3 encoding (backref protocol)**:

```
matrix array:
  varint(0)          # first occurrence, inline
  varint(3)          # 3 elements
  element 0:
    varint(0)        # row, first occurrence
    varint(3)        # 3 elements
    zigzag(1) zigzag(2) zigzag(3)
  element 1:
    varint(<distance to element 0's inline start>)  # backref
  element 2:
    varint(0)        # new array [4,5,6], inline
    varint(3)
    zigzag(4) zigzag(5) zigzag(6)
```

This requires the encoder to compute correct distances during the walk — both TS and C implementations must compute the same distance, which depends on exact byte-offset tracking during serialization.

**New v4 encoding (value table)**:

Mutable value table:
```
entry 0: Array(Integer), 3 elements: [zigzag(1), zigzag(2), zigzag(3)]    # row
entry 1: Array(Integer), 3 elements: [zigzag(4), zigzag(5), zigzag(6)]    # [4,5,6]
entry 2: Array(Array(Integer)), 3 elements:
  element 0: varint(0)   # reference to entry 0 (row)
  element 1: varint(0)   # reference to entry 0 (row)
  element 2: varint(1)   # reference to entry 1
```

Value stream:
```
varint(2)            # root is mutable_value_table entry 2
```

**Both runtimes produce identical bytes** as long as they walk the value graph in the same order and assign indices in the same first-encounter order.

### Walk order specification

The walk order must be defined precisely because it determines table index assignment — if two runtimes walk in different orders, they produce different (non-byte-identical) outputs. These rules apply to both the encoder's initial walk and the spec:

1. **Start at the root value**. If the root is a mutable container, allocate index 0 for it before recursing into its children.

2. **For each compound value, visit children in this exact order**:

   | Kind | Walk order |
   |---|---|
   | **Struct** | Fields in declaration order (the order in the schema). |
   | **Variant** | The variant's case is determined by its `case_idx`; walk the case's payload only (no action for the case_idx itself — it's just an integer on the wire). If the case payload is a struct, recurse into its fields in declaration order. |
   | **Array** | Elements in index order (0, 1, 2, ..., n-1). |
   | **Set** | Elements in East's canonical sorted order for the element type (same order produced by `East.Set.toArray`). Both runtimes share this sort, so walk order is deterministic. |
   | **Dict** | Key-value pairs in East's canonical sorted order for the key type. For each pair, walk the key first, then the value. |
   | **Ref** | The single held value. |
   | **Vector** / **Matrix** | **Do not recurse**. These are inline numeric buffers with no nested mutable containers (element types are restricted to `Float`/`Integer`/`Boolean`). They are NOT entered into the mutable value table — they're encoded inline everywhere, same as primitives. |
   | **Function** | The function is encoded inline (not in the value table). During the walk, recurse into the function's IR body and then into each capture value in capture declaration order — mutable containers referenced from captures or from IR literals DO go in the table. |

3. **Pointer-identity dedup during walk**: the encoder maintains an identity map `Map<opaque pointer, index>`. When the walk reaches a mutable container, it checks the map by pointer identity:
   - **Already present**: the walk does NOT create a new entry or recurse; it records the existing index as the reference for the current position and returns.
   - **Not present**: allocate the next available index, immediately record in the map (before recursing, to handle self-reference cycles), create an empty entry in the table, then recursively process the container's children, populating the entry as children are walked.

4. **Depth-first**: recursion proceeds into children before moving to siblings. A child's mutable containers can be assigned earlier indices than their parent's siblings.

**Key sort order for Sets and Dicts (critical for determinism):**

East defines a total order over all comparable types (see `libs/east/src/containers/sortedmap.ts` and `sortedset.ts` — the `compare` functions). The spec mandates that both runtimes use this same order. Concretely:

- **Integer, Float, DateTime, Boolean**: numeric / natural order
- **String**: Unicode code-point lexicographic (byte-wise UTF-8 is equivalent for BMP)
- **Blob**: byte-wise lexicographic
- **Struct**: field-by-field in declaration order, using each field type's order
- **Variant**: case-index first, then the case value
- **Ref, Array, Set, Dict**: not allowed as map/set keys (type system enforces)

The encoder iterates `Set` and `Dict` containers in this order, regardless of how they're stored in memory. Both TS and C runtimes already implement sorted containers, so this is locking in existing behavior rather than introducing a new sort.

This walk order is **already used by both TS and C** in the current beast2 encoders, so no runtime behavior change is required for the walk itself — only the wire format representation.

### Encoder algorithm

```
function encode_v4(root_value, root_type):
  type_table = build_type_table(root_value, root_type)
  string_table = StringTable()
  source_map = ... # from v3
  value_table = []
  index_map = Map<pointer, int>()  # identity-keyed

  # First pass: walk the value graph, populate value_table and index_map
  walk(root_value, root_type):
    if value is a mutable container:
      if value in index_map:
        return index_map[value]  # already assigned
      idx = len(value_table)
      index_map[value] = idx
      entry = ValueTableEntry(kind=type(value).kind, type_idx=..., elements=[])
      value_table.append(entry)  # reserve the slot
      for each child in iterate_children(value):
        child_idx_or_inline = walk(child, child_type)
        entry.elements.append(child_idx_or_inline)
      return idx
    else:
      # immutable content — encoded inline in its parent
      return InlineValue(value)

  root_reference = walk(root_value, root_type)

  # Second pass: write the wire format
  write_magic_bytes()
  write_type_table_section(type_table)
  write_string_table_section(string_table)
  write_source_map_section(source_map)
  write_mutable_value_table_section(value_table)
  write_value_stream(root_reference, string_table, type_table, ...)
```

**Key observation**: the encoder is effectively two-pass, just like the current v2/v3 encoders already are for the type and string tables. The extra pass over mutable values is cheap — each mutable container is visited exactly once.

### Decoder algorithm

The decoder does two passes over the mutable value table section:

1. **Pass 1** — header-only scan. Read each entry's header (kind_tag + type info + element_count), allocate an empty container of the right shape, save the start offset of the entry's element stream for pass 2. Skip past the elements without decoding them.
2. **Pass 2** — fill. Seek back to the first entry's element offset and decode each entry's elements, resolving any nested value-table-index references against the pre-allocated containers from pass 1.

Pre-allocation in pass 1 is what makes cycle-handling work: by the time pass 2 decodes an element that references an earlier-or-later entry, that entry's container already exists (just not yet filled).

```
function decode_v4(bytes):
  verify_magic_and_version(bytes, version=0x04)
  offset = 8
  type_table = read_type_table_section(bytes, &offset)
  string_table = read_string_table_section(bytes, &offset)
  source_map = read_source_map_section(bytes, &offset)

  # Mutable value table header
  section_len = read_varint(bytes, &offset)
  section_start = offset                       # remember for bounds checking
  entry_count = read_varint(bytes, &offset)

  # Pass 1: read headers, pre-allocate empty containers, remember offsets
  values = [None] * entry_count
  element_offsets = [0] * entry_count          # byte offset where each entry's elements start
  entry_kinds = [0] * entry_count              # kind_tag for each entry
  entry_counts = [0] * entry_count             # element_count for each entry
  entry_types = [None] * entry_count           # type info for each entry

  for i in 0..entry_count:
    kind_tag = read_uint8(bytes, &offset)
    type_info = read_type_info(kind_tag, bytes, &offset)
    count = read_varint(bytes, &offset)

    entry_kinds[i] = kind_tag
    entry_types[i] = type_info
    entry_counts[i] = count
    element_offsets[i] = offset                # offset AFTER the header, pointing at first element
    values[i] = allocate_empty_container(kind_tag, type_info, count)

    # Skip over this entry's elements without decoding
    skip_elements(bytes, &offset, count, type_info)

  assert offset == section_start + section_len, "mutable value table length mismatch"

  # Pass 2: fill elements. Seek back to each entry's start offset.
  for i in 0..entry_count:
    fill_offset = element_offsets[i]
    container = values[i]
    for j in 0..entry_counts[i]:
      child = read_element(bytes, &fill_offset, entry_kinds[i], entry_types[i], values)
      container.append_or_set(j, child)
    # fill_offset now equals the start of entry i+1's elements, but we use
    # element_offsets for the next iteration — no dependency on fill_offset carrying over

  # The reader's main offset should be at the end of the section after pass 1
  # (pass 2 used local fill_offset variables and did not advance the main offset)

  # Read the value stream (at main offset, which is now past the mutable value table section)
  root = read_root_value(bytes, &offset, type_table, string_table, source_map, values)

  return root

# read_element handles both primitives/structs/etc (inline) and nested
# mutable containers (single varint index into the values[] array):
function read_element(bytes, &offset, parent_kind, type_info, values):
  if element_type_is_mutable_container(type_info):
    idx = read_varint(bytes, &offset)
    return values[idx]                         # may be empty (partially filled) at this point
  else:
    return decode_inline(bytes, &offset, type_info)
```

Notes on the pseudocode:

- **`skip_elements` in pass 1** needs to know each element's encoded byte length. For primitives, that's type-directed (e.g. varint reads self-size). For nested mutable container references, it's a single varint (the index). For inline structs, it recursively skips each field. This is mechanical but must match the encoder's output exactly.

- **Alternative for simpler decoders**: instead of skipping and re-seeking, pass 1 can pre-allocate all containers in one scan (reading just the headers) and pass 2 is a fresh read from the first entry's start. The key is having `values[i]` already allocated before any element-decode tries to use it, which is what enables cycle handling.

- **Single-pass optimization**: if the wire format guarantees that nested references only point to already-emitted entries (i.e., no forward references), the decoder can skip pass 1 and decode entries in order, resolving references on the fly. This is almost but not quite true for v4: self-references and cycles require forward references to exist. Two-pass is simpler and handles all cases.

### Edge cases

#### 1. Self-reference cycles

```ts
const r = $.let(null, RefType(RefType(NullType)));
r.set(r);  // r references itself
```

The walk sees `r` on entry, creates table entry 0, recurses into the Ref's contents... which is `r` again. The pointer map says "entry 0 exists", so the child element becomes `varint(0)` — a reference to the enclosing entry. Pre-allocation in the decoder makes this work: entry 0's container exists before its contents are filled, so the self-reference resolves correctly.

#### 2. Mutually-referential cycles

```ts
const a = $.let({}, DictType(StringType, RefType(...)));
const b = $.let({}, DictType(StringType, RefType(...)));
a["b"] = b;
b["a"] = a;
```

Walk from `a`: create entry 0 (a), recurse into elements. Element `a["b"]` is `b`: create entry 1, recurse into elements. Element `b["a"]` is `a`: already in map, becomes reference to entry 0. Both entries are filled; decode pre-allocates both before filling.

#### 3. Identical-content-distinct-instances

```ts
const a = [1n, 2n, 3n];
const b = [1n, 2n, 3n];  # distinct instance
const root = { first: a, second: b };
```

Walk sees `a` (entry 0), then `b` (entry 1 — different pointer). Both entries have identical content but distinct indices. Aliasing is preserved: decode produces two distinct arrays, matching East's semantics.

**Key property**: entries are *identity-keyed* during encode, not content-keyed. Content-dedup would break mutation semantics.

#### 4. Root is a mutable container

The root value itself is an `Array`. Walk creates entry 0 (the root), recurses, writes table. The value stream contains `varint(0)` — a reference to entry 0. Decoder reads the value stream, sees the index, returns `values[0]`.

#### 5. Root is immutable but contains mutable children

The root is a Struct whose fields include an Array. Walk enters the struct, processes the Array field (creates entry 0). Value stream writes the struct inline; the Array field is encoded as `varint(0)`. Decoder reads the struct inline, resolves the Array field reference to the table.

#### 6. No mutable containers in the entire value

The mutable value table section has `entry_count = 0`. The value stream is all inline. Decoder skips an empty table and reads the value stream as normal.

Concrete example: encoding `{ name: "Alice", age: 30n }` (a plain struct of primitives). Wire format:

```
type_table_section         — contains Struct{name: String, age: Integer}
string_table_section       — contains "Alice"
source_map_section         — empty (no IR content)
mutable_value_table_section:
  varint(section_byte_length = 1)  — minimal
  varint(entry_count = 0)
value_stream:
  <inline struct>
    <string index 0>       — "Alice"
    <zigzag(30)>           — age
```

The mutable value table adds 2 bytes of overhead (length + count, both zero). Non-issue.

#### 7. Function containing Refs that close over the function (mutual cycle through a function)

```ts
const r = $.let(null, RefType(FunctionType([], NullType)));
const f = East.function([], NullType, ($) => {
  // captures r; when called, reads its own future-self from r
  $.return($.const(null, NullType));
});
r.set(f);  // r now holds f; f's captures include r; cycle: r → f → r
```

Walk order: start at some root that reaches both `r` and `f`. Suppose we reach `r` first:

1. `r` is a mutable container (Ref): create entry 0 in the value table, mark `r → 0` in the identity map, then recurse into the Ref's held value.
2. The held value is `f`, a function. **Functions are inline, not in the value table.** But we still walk into `f`'s captures to find nested mutable containers.
3. `f`'s captures include `r`. Pointer-identity check on `r` finds it in the map (index 0). No new entry, no further recursion. The capture encodes `r` as `varint(0)` — a reference to the already-allocated entry 0 in the value table.
4. Walk exits. Entry 0 is populated: it holds an inline encoding of `f`, which in turn has a capture that references `varint(0)`.

The wire format has one table entry (for `r`) and `f` is inline inside that entry. The self-reference resolves because entry 0 was pre-allocated before the recursive walk.

**Why functions don't need to be in the value table for this to work**: the identity map tracks ALL encountered values by pointer, including functions. Re-encountering the same function during a walk finds it in the map. For functions specifically, "already in the map" means "we're currently walking inside this function" — encoding it as `varint(0)` would be wrong (it'd point to the outer Ref, not to the function). To avoid this, the walk distinguishes: the identity map stores `pointer → (table_idx | INLINE_IN_PROGRESS)`. If a walk re-encounters a function that's `INLINE_IN_PROGRESS`, it's a structural cycle the spec doesn't support — error out. (East doesn't actually produce this pattern in practice; functions don't self-reference via captures in normal compiled code.)

#### 8. Vector and Matrix inside a mutable container

```ts
const rows = [East.Vector.fromArray([1.0, 2.0, 3.0]), East.Vector.fromArray([4.0, 5.0])];
```

`rows` is an `Array(Vector(Float))`. The Array is a mutable container — entry 0 in the value table. Each Vector element is encoded **inline** within the Array's element stream (Vectors are NOT in the value table per the walk order spec). Decode reads the Array entry, sees two inline Vector elements, allocates each Vector inline.

This means Vectors and Matrices with identical content are encoded multiple times rather than shared — a slight size loss but much simpler, and aligns with how Vector/Matrix work conceptually (they're numeric buffers, not first-class identity containers).

### Interaction with source map (v3 design)

The mutable value table and the source map are **independent sections**. Source map stores location stacks, content-keyed. Mutable value table stores mutable container instances, identity-keyed. They don't overlap semantically.

Section order: source map comes before mutable value table, because IR content (which contains `loc_id` references) may appear inside mutable values (e.g. an Array of IR nodes). When decoding a mutable value table entry that contains an IR `loc_id`, the decoder needs the source map already loaded to render locations (in error scenarios) — but this resolution only happens at error time, not during normal decode.

### Migration plan (TS first, then C)

Assumes the source map design has landed (v3 is the current baseline). **Hard cutover, no transitional dual-version support.** Steps:

1. **Add `MutableValueTable` class and walker** in a new TS module (`libs/east/src/serialization/beast2-value-table.ts`). Library-only change; no consumer updates yet. Includes the depth-first walk, identity-keyed dedup, and table emission.

2. **Replace v3 encoder with v4** in `libs/east/src/serialization/beast2.ts`. The encoder now always emits v4. Bump magic version byte to `0x04`. Delete the old backref protocol code (`ctx.refs: Map<object, number>`, distance calculations, the inline-or-backref dispatch in Array/Set/Dict/Ref encoders).

3. **Replace v3 decoder with v4**. The decoder reads the new `mutable_value_table_section` and resolves value table indices instead of backref distances. Delete the old backref decoder code.

4. **Round-trip tests**: verify `decode(encode(v)) === v` for a wide variety of inputs, including cycles and self-references (see "Test strategy").

5. **Regenerate compliance test IR JSON files** — JSON IR export isn't directly affected (the JSON format is wire-format-independent), but any test fixtures derived from beast2 v3 blobs need refreshing.

6. **Port to C runtime** — implement v4 encode/decode in `libs/east-c/packages/east-c/src/serialization/beast2/`. Delete `backref.c` entirely. Delete the backref pointer-tracking fields in `Beast2EncodeCtx` / `Beast2DecodeCtx`. Add the value table encoder/decoder.

7. **Port to Python runtime** — same changes in `libs/east-py/packages/east-py/east/serialization/beast2.py`.

8. **Verify byte-identity** — round-trip the benchmark blob through TS and C, verify `cmp /tmp/ts.beast2 /tmp/c.beast2 == 0`.

9. **Wipe and regenerate any cached beast2 storage** — e3 task output cache, WASM decoder bundles, etc. v3 blobs are no longer readable. This is a one-time deploy step, not ongoing migration.

### Things that get simpler

After v4 lands:

- **No more backref distance calculations**. Encoders don't compute "offset from current buffer position to stored offset"; they just emit varint indices.
- **No more `beast2_enc_ctx` pointer map in encoder contexts**. The walk's identity map is its own data structure, and after the walk it's discarded.
- **No more `beast2_dec_ctx` offset→value map in decoder contexts**. The decoder's values array serves the same purpose with a simpler index-based lookup.
- **No more dead-code paths for "what if the backref distance is invalid"**. A varint index is bounds-checked against the table length; that's the only validation needed.
- **No more "closure IR inside closure body" reentry concerns**. Currently nested `beast2_encode_value` calls create fresh encode contexts to avoid cross-closure backref resolution. In v4, the whole walk is one table, so nested values can reference entries at any level.
- **Simpler testing**: round-trip equivalence for any `(value, type)` pair is a single test harness; cross-runtime byte-identity is a single `cmp` command.

### Things that get harder

- **Two-pass encode**: the current encoder is streaming-ish (writes bytes as it walks). V4 requires building the full table in memory before writing. For very large values this doubles memory usage during encode. In practice, East values are all in memory already (the encoder has full access to them), so this is not a real constraint.

- **Two-pass decode**: the decoder must pre-allocate containers before filling them, to handle cycles. Similar memory cost but still O(N) in the number of mutable containers.

- **Out-of-order value stream**: the value stream no longer directly contains all the value data; some of it lives in the table. Readers that want to "skip" a section (e.g. for lazy loading) need to understand that mutable values are referenced externally.

None of these are blockers; they're just different trade-offs from the current streaming approach.

## Non-goals

- **Change the type table or string table.** They're fine as-is. The v4 change is only about the value encoding for mutable containers.
- **Content-dedup user-level mutable values.** This design is explicitly identity-keyed. Content-dedup would break East's mutation semantics (as discussed in the source map doc). User values that happen to have identical content but different instances stay as distinct table entries.
- **Change how primitives, structs, variants, functions are encoded.** Only Array/Set/Dict/Ref get the new treatment. Everything else continues to be inline in the value stream.
- **Support streaming encode/decode.** The existing format already isn't fully streaming (it has a header with tables that must be built first). V4 extends this: mutable containers are also in tables.
- **Optimize for compression ratio beyond byte-identity.** Some value graphs will encode larger in v4 than v3 (e.g. a flat array with no sharing becomes a table entry plus a root reference instead of just inline data). That's an acceptable cost for the determinism win.

## Open questions

### Q1: Single combined value table or per-type tables?

- **Option A — Single combined table**: all mutable values go into one `mutable_value_table`, with per-entry tag bytes identifying the kind (`0x0A` Array, `0x0C` Set, `0x0B` Dict, `0x0D` Ref).
- **Option B — Per-type tables**: separate sections for `array_table`, `set_table`, `dict_table`, `ref_table`. Each with its own header and entries.

**Trade-off**: Option A is simpler and matches the existing type table pattern (which is a single table of heterogeneous entries). Option B might compact slightly better for large numbers of one type, but fragments the wire format.

**Proposal**: Option A (single combined table).

### Q2: What is the "element_type_idx" field on table entries?

Each table entry header includes the element type (or key+value types for dicts). Do we:

- **Option A — Store the type index in every entry**: redundant but self-describing.
- **Option B — Only store kind tag; element types are inferred from context**: the decoder figures out the element type from the surrounding schema when resolving a reference.

**Proposal**: Option A. Self-describing table entries are simpler to decode and debug. The overhead is one varint per entry — negligible.

### Q3: Should Function values use the value table?

Currently, Function values are encoded inline in the value stream (the function body IR + captures). They're not mutable containers — a function is more like a struct in terms of identity.

But two references to the same function *should* decode to the same function. Do we:

- **Option A — Leave functions inline**: two references to the same function decode as two different function objects (identical behavior but distinct identity). This is the current behavior; user code that relies on function identity is rare.
- **Option B — Put functions in the value table**: functions get identity preservation like mutable containers.

**Proposal**: Option A for now. Functions are immutable from East's perspective, and the equality test is `East.is(f, g)` which is always true if they're structurally equivalent. Preserving pointer identity for functions is not a hard requirement. If it becomes one later, we can add them to the table in v5.

### Q4: What about legacy backref-protocol support? — **RESOLVED: hard cutover, no v3 support**

Resolved per project preference: hard cutover. The v4 decoder reads v4 only. There is no v3-fallback path. v3 blobs in storage are stale and must be regenerated on deploy.

Rationale: a v3-reader living in a v4 codebase is dead code that has to be tested and maintained, with the only benefit being a transitional grace period that's not needed at this project's scale.

### Q5: Migration path for in-flight e3 task outputs — **RESOLVED: wipe and regenerate**

Resolved: wipe the e3 task output cache on v4 deploy. First run of each task populates fresh v4 blobs. Same model as the source map design.

Rationale: e3 task outputs are by definition regenerable from their inputs. The cache is a cache, not a source of truth. A cold cache for the first deploy after v4 lands is acceptable downtime and avoids dual-format complexity.

## Estimated scope

| Area | Files | LOC |
|---|---|---|
| `libs/east/src/serialization/beast2-value-table.ts` (new) | 1 | ~400 |
| `libs/east/src/serialization/beast2.ts` (v4 encoder/decoder) | 1 | ~300 |
| TS tests (round-trip, identity preservation, cycles, edge cases) | 1-2 | ~300 |
| `libs/east-c/packages/east-c/src/serialization/beast2/value_table.c` (new) | 1 | ~500 |
| `libs/east-c/packages/east-c/src/serialization/beast2/value_encode.c` (v4 rewrite) | 1 | ~250 (net reduction) |
| `libs/east-c/packages/east-c/src/serialization/beast2/value_decode.c` (v4 rewrite) | 1 | ~250 (net reduction) |
| Remove `backref.c` (entire file becomes obsolete) | 1 | -214 |
| `libs/east-c/docs/DESIGN-beast2-closure-reencode.md` (close out) | 1 | ~50 |
| BEAST2.md spec update | 1 | ~150 |

**Total**: ~1800 lines net change. Roughly 1-2 days of focused work on TS, 1-2 days on C.

## Benefits after landing

1. **Cross-runtime byte-identity by construction** for any East value containing mutable containers. Given the same logical value, TS and C encoders produce identical bytes. `cmp /tmp/ts.beast2 /tmp/c.beast2` returns 0.

2. **Simpler encoder/decoder implementations**. Backref distance math, offset tracking, and pointer-identity tracking during encode all go away. Replaced with a straightforward walk + index lookup.

3. **Smaller wire format for value graphs with heavy aliasing**. Repeated references to the same container become single-varint indices (typically 1-2 bytes) vs backref distance varints (1-5 bytes).

4. **Determinism is a property of the wire format, not of implementation details**. Two valid runtimes cannot diverge on encoding output for the same logical value. This makes the spec more useful as a correctness target.

5. **Unblocks future wire format work**. Any future optimization (e.g. block-level compression, dictionary encoding for struct fields) can be added on top of a clean foundation instead of bolted onto the existing backref protocol.

6. **Cleaner C code**: the `backref.c`, `dedup.c` files and all related pointer-tracking code in `value_encode.c` / `value_decode.c` become obsolete. Replaced by a simple walk + table.

## What this replaces

After v4 lands, these are deleted:

- **TS**: `ctx.refs: Map<object, number>` in beast2 encoder/decoder contexts
- **TS**: Backref distance calculations in `encodeBeast2For` and `decodeBeast2For`
- **TS**: The inline-or-backref protocol for Array/Set/Dict/Ref encoding
- **C**: `Beast2EncodeCtx.slots` (the pointer→offset hash table)
- **C**: `Beast2DecodeCtx.slots` (the offset→value hash table)
- **C**: `beast2_enc_ctx_find` / `_add`, `beast2_dec_ctx_find` / `_add` functions
- **C**: The entire `backref.c` file
- **C**: Nested-encode-ctx logic in `value_encode.c` (each closure currently creates a fresh context to avoid cross-closure backref resolution; in v4 the whole walk is one table)
- **Spec**: All BEAST2.md text describing the backref protocol

## Risks

1. **Wire format break**. v3 and v4 are incompatible — there is no shared subset, no dual-version reader, no transitional period. Any v3-encoded blob in storage becomes unreadable after v4 deploys. Mitigation: project policy is hard cutover; e3 cache wipe + regenerate on deploy is the explicit plan. All other consumers (compliance fixtures, WASM bundle, IDE plugin if any) are rebuilt as part of the same deploy.

2. **Two-pass decode cost**. Decoder must pre-allocate then fill, costing one extra iteration. Mitigation: on typical blob sizes the extra pass is negligible compared to the total decode time.

3. **Walk order ambiguity**. If the spec doesn't define walk order tightly enough, runtimes could drift. Mitigation: explicit walk-order specification with test vectors, and the walk rules mirror the existing (already-consistent) encoder walk — so this is locking in existing behavior, not inventing a new order.

4. **Cycles with Functions**. Functions closing over mutable values that close over the function can create cycles. Current beast2 handles this with backrefs. v4 needs explicit handling in the walk — Functions are inline so when we recurse into a function's captures, we may hit a mutable container that references back to the function's capture list. Mitigation: pre-allocate table slots before recursing, just like we do for mutable containers.

5. **Size regression for shallow values with no mutable containers**. A value like `{name: "Alice", age: 30n}` has zero mutable container instances. V4 adds an empty mutable_value_table_section (2-byte overhead: varint(1) for the section length, varint(0) for entry_count). For tiny blobs this is a measurable percentage; for any realistic blob it's zero. Mitigation: none needed — the overhead is trivial.

6. **Bugs in the new walk implementation**. The walk logic is similar to current encoders but not identical, and bugs can cause infinite loops on cycles or wrong table population order. Mitigation: comprehensive unit tests with cycle cases (see "Test strategy"), shared test vectors between TS and C runtimes.

## Test strategy

Each of these must pass before merging:

1. **Walk order unit tests**: for each value kind (Struct, Variant, Array, Set, Dict, Ref, Function), verify the walker visits children in the spec-defined order. Use a simple instrumented walker that records `visit(pointer, index)` events.

2. **Round-trip tests**: for a wide range of value shapes (primitives, nested structs, arrays of arrays, dicts of refs, cycles, self-references), verify `decode(encode(v))` is structurally equal to `v` AND preserves aliasing (`East.is(decoded.a, decoded.b)` matches `East.is(v.a, v.b)` for every pair).

3. **Cycle tests**:
   - Self-reference: a Ref that holds itself, round-trip.
   - Mutual cycle: two Dicts that reference each other.
   - Function cycle: a Ref holding a function whose captures include the Ref.
   - Deep cycle: a chain of 100+ Refs terminating in a back-reference to an early element.

4. **Identity preservation tests**: construct values with explicit aliasing (`a = [1,2,3]; root = {x: a, y: a}`) and verify the decoded value has `decoded.x === decoded.y` (same pointer), vs. `a = [1,2,3]; b = [1,2,3]; root = {x: a, y: b}` which should decode to two distinct arrays.

5. **Cross-runtime byte-identity test (the key success criterion)**: pick a rich benchmark value that exercises the full type system, encode it on TS and on C, verify `cmp ts.beast2 c.beast2 == 0`. Add to CI.

6. **Spec-conformance test vectors**: a set of small hand-crafted value graphs with their expected v4 wire bytes (documented as golden files). Both runtimes decode and re-encode, comparing byte-for-byte. This catches divergence the benchmark might miss.

7. **Fuzzer**: generate random value graphs (with occasional cycles), round-trip them through both encoders and decoders, cross-check results. Run for extended periods as a soak test.

8. **Size regression tests**: measure encoded blob sizes for a standard set of benchmark values; fail if any value's v4 blob is more than, say, 10% larger than its v3 equivalent.

9. **Migration tests**: verify a v3 decoder rejects a v4 blob with a clear error message. Verify a v4 decoder can still read v3 blobs during the transition period.

10. **Compliance suite**: existing compliance tests (runnable on all three runtimes) should all pass with v4 wire format. Any compliance test whose output changes is a regression to investigate.

## Explicit dependency on source map design

This design **requires the source map design to land first**. Reasons:

1. **v3 is the baseline for v4's section ordering**. The `source_map_section` appears in v3 between the string table and the value stream; v4 adds `mutable_value_table_section` after the source map but before the value stream. The section order is meaningful for decoder passes.

2. **IR serialization changes in v3 must be in place**. After v3, IR nodes carry `loc_id` varints — no more inline location arrays using the backref protocol. V4 can cleanly remove the backref protocol because locations no longer need it. Without v3, we'd be deleting a mechanism that locations still depend on.

3. **Cleanup ordering**. Removing backref protocol code in v4 without first moving locations off it would leave the codebase half-migrated. V3's source map work is a prerequisite for that cleanup.

In principle the two designs could be implemented and tested in parallel, but the final merge must land v3 first.
