# Beast2 v5 Specification — segment-terminated record stream

v5 makes bounded-memory encode/decode of large collections a property of the
container itself (issue #416). It removes v4's structural blockers — global
sections in fixed order, the global string table, the whole-value mutable
table, and count-prefixed containers — in favour of a **single-pass, tagged
record stream** with per-segment compression and an optional trailing index
for random access.

## Blob layout

```
magic[8]               0x89 "East" 0x0D 0x0A 0x05
type_section           well-known (id + hash) or structural (v4 type table)
source_map_section     varint(len) + stacks, filenames inline
value stream           frames carrying the logical value encoding
[index_section]        optional — per-segment offsets and element counts
[footer]               u64-LE index_section_offset + footer_magic[8]
```

The header sections and the index/footer are never compressed. Everything a
sequential reader needs arrives strictly before it is used; the value stream
self-terminates, so pipes and other non-seekable inputs work without the
trailing sections.

## Type section

```
varint(kind)
kind 0 (structural):       the v4 type-table section verbatim:
                           varint(byte_len) varint(root_idx) varint(count) entries…
kind 1 (well-known):       varint(id) u64-LE(content_hash)
kind 2 (well-known + fb):  varint(id) u64-LE(content_hash) + structural section
```

- The **structural** payload reuses the v4 type-table encoding byte-for-byte
  (see `../v4/SPEC.md` — entry grammar, tag bytes, recursion). It stays
  length-prefixed so a decoder-side content-hash skip-cache (issue #417)
  applies to custom types unchanged.
- The **well-known** forms name a schema by reference so decoders skip
  parsing it. `content_hash` is the FNV-1a 64-bit hash (offset basis
  `0xcbf29ce484222325`, prime `0x100000001b3`) of the schema's structural
  section bytes (including the leading length varint).

### Registry — a constant of the format

Ids are pinned; never renumber.

| id | schema | form |
|---|---|---|
| 1 | `IRType` | kind 1 |
| 2 | `EastTypeValueType` | kind 1 |

**The registry is part of the wire format, not a runtime extension point.**
The id set is fixed in each runtime (`v5/type-section.ts`, `v5/container.c`,
and east-py through the C bridge) and adding an id is a format change that
ships in all three together.

It is deliberately **not** open to downstream packages. If a package could
register an id, the same value would encode to different bytes depending on
which packages a process happened to import — and e3 content-addresses
beast2 bytes, so one logical value would land under two different hashes,
splitting caches and duplicating stored objects. An encode must be a pure
function of `(value, type, options)`, which requires the registry to be
constant. (Both current ids qualify precisely because every runtime has them
by construction, so no import can change the outcome.)

Consequences:

- A custom type — however large or recursive — always uses kind 0. The win is
  available to `IRType` and `EastTypeValueType` only. Large third-party
  schemas (e.g. east-ui's `UIComponentType`) get the per-process
  decoder skip-cache (issue #417) instead, which parses them once per process
  rather than never.
- Encoders recognize a well-known schema **by content** (hash of its
  structural bytes, then a full byte compare), so no encode call site names an
  id, and a hash collision can never mislabel an encode.
- Decoders compare the wire hash against their own schema for that id; a
  mismatch is a hard error naming both hashes (runtime version drift). The
  hash is a drift guard, not a security boundary — a forged hash only makes
  the decoder use its own registered schema, which the type-directed decoder
  bounds-checks like any wrong-type input.

### Kind 2 — decode-only, for forward compatibility

Nothing in this release emits kind 2. Decoders accept it so that a **later**
release can add a well-known id and decoders shipped now degrade gracefully:
an unknown id with a fallback parses the structural bytes exactly as kind 0,
and a known id whose hash disagrees also falls back rather than substituting
a drifted schema. An unknown id **without** a fallback (kind 1) is a hard
error telling the operator to upgrade.

Unlike v4, the type section is **exactly the root type closure**. v4 also
registered types discovered during the value walk (capture types, recursive
wrappers) because value-table entry headers referenced types by index; v5 has
no value table — all nested typing is contextual (from the root type and from
IR carried in-band) — so the question of value-walk-discovered types does not
arise (issue #416 verification item 1).

## Source map section

```
varint(payload_len)
varint(stack_count)                      entry 0 (empty stack) is implicit
repeat stack_count times:
  varint(frame_count)
  repeat: varint(filename_len) utf8  varint(line)  varint(column)
```

Filenames are inline UTF-8 (no string table). The section carries the map
that is known before encoding starts (an explicit `sourceMap` option, or the
root value's attached map). Maps discovered mid-stream travel as inline
deltas on function values (below). Stack ids are positions (header section
first, inline deltas appended in stream order), so `loc_id` integers inside
IR data round-trip unchanged.

## Value stream — frames

The value stream is a sequence of **frames**; the concatenation of the
decompressed frame payloads forms the logical value encoding.

```
frame:  varint(codec_id) varint(uncompressed_len) varint(payload_len) payload
```

- Codec ids: `0 = none` (payload_len MUST equal uncompressed_len),
  `1 = deflate` — raw DEFLATE per RFC 1951, the mandatory baseline (zlib in
  C, `node:zlib` in Node, `DecompressionStream("deflate-raw")` in browsers,
  stdlib `zlib` in Python), `2 = zstd` (reserved; readers that meet it fail
  with a clear message naming the codec). The codec is a per-frame writer
  choice — a blob may mix compressed and uncompressed frames. Writers store
  tiny or incompressible payloads with codec 0.
- A deflate frame MUST inflate to exactly `uncompressed_len` bytes.
  Decoders MUST reject frames declaring more than 1 GiB uncompressed
  (decompression-bomb guard).
- **Unit alignment**: a frame's payload must contain a whole number of
  logical units, where the units are: the root container tag; one root
  segment; the root terminator; or (for non-container roots) the entire
  value. A logical unit never spans frames — decoders inflate one frame at a
  time and never need cross-frame refill. Non-container roots (including
  `Ref` roots) are encoded as exactly one frame. Writers MUST NOT emit
  empty frames.
- Writers targeting paging emit the root tag and the terminator as their own
  frames and exactly one segment per frame, so every indexed frame decodes
  standalone as `varint(n) + n elements`.

## Value stream — logical encoding

Type-directed and positional, like v4, with these rules:

| Type | Encoding |
|---|---|
| Null | nothing |
| Boolean | u8 `0`/`1` |
| Integer, DateTime | zigzag varint (DateTime = ms since epoch) |
| Float | f64 little-endian |
| String | `varint(byte_len) + utf8` — **always inline, no dedup table**. Value-string repetition is per-segment compression's job. |
| Blob | `varint(len) + bytes` |
| Vector | `varint(len) + raw element buffer` |
| Matrix | `varint(rows) varint(cols) + raw element buffer` |
| Struct | fields in declaration order |
| Variant | `varint(case_idx)` + payload |
| Recursive | transparent (wrapper unwraps, ref delegates) |
| Array/Set/Dict/Ref | container tag (below) |
| Function/AsyncFunction | source-map delta + IR + captures (below) |

### Mutable containers — NEW/REF and segments

Every mutable container position starts with a tag byte:

```
0x00 NEW    define: register in the definition table, then content
0x01 REF    alias:  varint(delta), delta ≥ 1
```

- Definition indices are assigned at definition **start**, preorder — the
  root container (if any) is definition 0. Cycles decode by
  create-then-fill in a single pass: a REF met while its target is still
  being filled resolves to the (partially filled) object, and fills complete
  by end of stream.
- `REF delta` is **relative**: it names the container defined `delta`
  definitions before the current position (`definitions_so_far - delta`).
  Relative deltas make decoding independent of aliasing scope: a paging
  reader decoding one self-contained segment with a fresh table resolves the
  same deltas a sequential reader resolves with a global table. A delta that
  reaches past the visible definitions is a hard error.
- Content, by kind:
  - Array/Set/Dict: `repeat[ varint(n > 0) + n elements ] varint(0)` —
    **segment-terminated**, no totals. Dict elements are key/value pairs
    (`n` counts pairs). Segment counts are never 0 (the terminator is
    unambiguous; writers skip empty batches).
  - Ref: the single inner value (no segmenting).
- Multi-segment Set/Dict content merges with container semantics: Set
  segments union (structural equality), Dict segments insert with **later
  occurrences of a key winning** (update semantics). Decoders canonicalize
  multi-segment Set/Dict content to sorted order (the C runtime's btrees do
  this inherently). Nested containers written by these runtimes always use a
  single segment.

### Functions

```
varint(n_new_stacks)  [stack…]     source-map delta (stack format as header)
IR                                 the FunctionIR/AsyncFunctionIR value,
                                   type-directed via IRType
varint(capture_count)  captures    values typed by the IR's capture types
```

The source-map delta carries stacks of the stream's map that are not yet on
the wire — the map is adopted from the first function value that carries one
(header map first, if present). Location ids inside IR are plain integer
data; ids index the accumulated stack list (header + deltas, in order).
Functions whose attached map is not the stream's map emit a delta of 0 (their
locations resolve against the stream map, as in v4). Data values without
functions pay nothing; function values without new stacks pay one byte.

Self-contained streams (below) MUST NOT emit non-zero deltas — stacks are
whole-stream state. Writers fail loudly if a function would need one; pass
the map up front instead.

## Index section and footer (optional)

Written at close, append-only — nothing is backpatched:

```
index_section:  varint(flags)            bit 0: self_contained_segments
                varint(segment_count)
                repeat: varint(byte_offset_delta) varint(element_count)
footer[16]:     u64-LE(index_section_offset) footer_magic[8]
```

- `footer_magic = 0x89 "East" 0x0D 0x0A 0xF5`.
- Offsets are absolute wire offsets of each root segment's frame,
  delta-encoded (first entry from 0). `element_count` is the segment's
  element (or pair) count.
- **Streaming readers ignore it** — after the value stream self-terminates,
  the remaining bytes must be nothing or a well-formed, consistent
  index + footer (whole-stream strictness). Consequence: truncating a blob
  exactly at the index boundary yields a complete index-less stream (no
  value bytes are lost); any truncation that loses value bytes fails.
- **Paging readers** seek to EOF, verify the footer magic, load the index,
  then: `len()` in O(1) from the counts (exact for Array roots; an upper
  bound for Set/Dict roots, where cross-segment duplicates collapse on
  merge); row N → binary search → seek → decode ONE segment.
- `self_contained_segments` asserts that no REF delta and no source-map
  delta crosses a root-segment boundary, so each indexed segment decodes
  independently (and in parallel). Random access requires it; sequential
  decode is unaffected either way (relative deltas decode identically).
  Only blobs whose root is Array/Set/Dict may carry an index.

## Writer memory / reader memory

- A streaming writer holds one batch plus its identity map. In
  self-contained mode the map clears per segment — O(batch). In C, a
  container with refcount 1 at encode time cannot recur in the walk and
  never enters the identity map, so freshly built/decoded trees track O(1).
- A sequential whole-value reader is O(value). The segment iterator is
  O(segment) decoded state (plus one pointer per container definition in
  non-self-contained streams). A paging reader is O(segment) per access.

## Encoding algorithm (whole value)

1. Resolve the header source map (explicit option, else the root value's
   attached map, else none).
2. Write magic, type section, source map section.
3. Encode the value into logical bytes with a fresh definition table
   (single pass, no pre-walk); frame and append them. Container roots may
   split content across segments; non-container roots are one frame.
4. If indexed (container roots): emit tag / segment(s) / terminator as
   separate frames and append the index + footer.

## Decoding algorithm

1. Verify magic; read the type section (well-known: verify hash, take the
   registered schema; structural: parse) and the source map section.
2. Read frames; decode the logical stream type-directed, registering every
   NEW container (create-then-fill) and resolving REF deltas from the tail
   of the definition list.
3. At the root terminator (or end of a non-container root's frame): the
   current frame must be exactly exhausted, and the remaining wire bytes
   must be empty or a consistent index + footer.

## Compatibility

- v5 decoding ships behind the same entry points as v4 (magic dispatch);
  v4 blobs decode unchanged, indefinitely.
- Encoders default to v4 until the phase-2 flip (issue #416): e3
  content-addresses beast2 bytes, so changing the default changes object
  hashes — cache invalidation that needs an explicit, coordinated release.
- The streaming/paging APIs are v5-only (v4 cannot stream by construction).
