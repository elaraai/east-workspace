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
- The table is **canonical**: one type, one section, on every runtime, and
  whether the type was built in code or is an `EastTypeValue` read back off
  the wire (issue #770). The rules — post-order in declaration order, a
  Recursive wrapper indexed before its body, one entry per distinct entry
  bytes, wrappers deduplicated up to their naming — are the v4 type table's
  and are stated there. This is what lets an encoder recognise a well-known
  schema by content, and what makes a blob's content hash a function of its
  value alone.
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
  `1 = deflate` — raw DEFLATE per RFC 1951, the mandatory baseline, `2 = zstd`
  (reserved; readers that meet it fail with a clear message naming the
  codec). Any inflate reads a deflate frame: zlib in C and Python, Node's
  zlib, and in browsers a portable inflate on the sync decode path or
  `DecompressionStream("deflate-raw")` on the async one. Writers do NOT use a
  platform deflate — they use the deterministic encoder below, so compressed
  frames are byte-identical in every runtime.
- The codec is a per-frame writer choice, and a blob may mix compressed and
  uncompressed frames. A writer asked for deflate compresses each frame whose
  logical length is at least 64 bytes and keeps the result when it is
  strictly shorter than the logical bytes; every other frame, and every frame
  of a writer asked for no compression, is codec 0. Stored collections are
  written with deflate.
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
  standalone as `varint(n) + n elements`. The root tag frame and the
  terminator frame are then the same four bytes, `00 01 01 00`: a codec-0
  frame whose one payload byte is the NEW tag, or the `varint(0)`
  terminator.

## Deterministic DEFLATE encoder

A general-purpose deflate picks its own match finder and Huffman trees, so the
same input compresses to different valid streams under different libraries.
e3 content-addresses beast2 bytes, so every runtime encodes with this one
algorithm, whose output is a pure function of the input (TypeScript
`v5/deflate.ts`; east-c `v5/deflate.c`, which east-py reaches through the C
bridge):

- **One block**, `BFINAL = 1`, `BTYPE = 01`: the fixed Huffman codes of RFC
  1951 §3.2.6, never dynamic trees. The block ends with symbol 256, and the
  final partial byte is padded with zero bits.
- **Window** 32768 bytes; matches of 3 to 258 bytes.
- **Hash** of the three bytes at position `i`:
  `((b[i] << 10) ^ (b[i+1] << 5) ^ b[i+2]) & 0x7FFF`. The last two positions
  of the input are never hashed.
- **Chains.** `head[h]` holds the most recent position with hash `h`, and
  `prev[i]` the position `head[h]` held before `i` was inserted. Inserting
  position `i` (when `i + 3 ≤ n`) sets `prev[i] = head[h]; head[h] = i`.
- **Greedy matching.** At position `pos`, walk the chain from `head[h]`,
  examining at most 32 candidates and stopping at the first more than 32768
  bytes back. A candidate's length is the common prefix of the input at the
  candidate and at `pos`, capped at `min(258, n − pos)`. A candidate replaces
  the best so far only when it is **strictly** longer, so among equal lengths
  the nearest wins; the walk stops early at a match of the cap.
- **Emit.** A best length of 3 or more is a length/distance pair (RFC 1951
  §3.2.5 codes and extra bits); every position the match covers is inserted,
  and `pos` advances by the length. Otherwise the byte at `pos` is a literal,
  `pos` is inserted, and `pos` advances by one.

What is pinned is the symbol stream; how an implementation reaches it (word-
at-a-time compares, pre-reversed codes, rejecting a candidate by its byte at
the best length) is free, and each runtime's tests hold its fast path to a
bit-at-a-time reference. It compresses less than zlib and that is the price of
determinism. Frames are compressed independently, so a writer may compress
them in parallel.

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
- **Set/Dict content is the canonical value, split at segment boundaries.**
  East Set/Dict values are total-order-canonical in every runtime, and the
  wire holds exactly that value: elements (Set) / keys (Dict) MUST be
  strictly ascending in East total order within each segment, consecutive
  segments MUST be disjoint ascending ranges (`last(segment i) <
  first(segment i+1)`), and no element/key repeats anywhere in a stream
  (strict ascent implies this; it also outlaws duplicates within a single
  segment). Multi-segment Set/Dict content is therefore **concatenation**,
  exactly like Array roots. This applies to root and nested containers
  alike (nested containers written by these runtimes always use a single
  segment). Writers enforce it — encoders emit canonical order regardless
  of the source container's iteration order, and streaming writers reject
  out-of-order batches. Decoders validate it and reject violations as
  malformed, like any other corruption; a blob holding unsorted or
  duplicated Set/Dict content is not the encoding of any East value.
  Streams whose element order is genuinely data belong in an Array typed
  as such.

### Aliasing scope in a self-contained collection

A writer of self-contained segments (below) scopes aliasing per **root
element** — an Array element, a Set element, or a Dict key/value pair: the
definition table it looks containers up in starts empty at every root
element, so no REF reaches a container another root element defined. Sharing
inside an element is kept; sharing between elements is written out as
separate definitions. (A Set element or Dict key is an immutable type and
holds no container, so between elements only Array elements and Dict values
can ever have shared one.)

Two properties follow, and both are load-bearing:

- **An element's logical bytes depend on the element alone** — never on its
  neighbours, or on which of their objects it shares. A collection's bytes
  are fixed by its elements' own encodings, however the elements were
  produced, grouped or ordered on the way, which is what lets every writer
  of one collection agree on its content hash.
- **An encoded element is context-free**, so it can move between segments —
  sorted, merged, re-cut — by byte copy, without re-encoding.

Readers are unaffected: REF deltas are relative, so a reader resolves them
the same way whatever scope the writer used. Blobs written before this rule
scoped aliasing per root segment — an element could REF a container an
earlier element of its segment defined — and remain valid, since
`self_contained_segments` promises only that no REF crosses a segment
(below). A tool that moves encoded elements by byte copy therefore checks,
as it walks each element, that no REF reaches outside it, and re-encodes the
segment when one does.

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
  then: `len()` in O(1) from the counts (exact for every root kind —
  Set/Dict segments are disjoint ranges of the canonical value); row N →
  binary search → seek → decode ONE segment. Set/Dict rows address the
  canonical sorted order; readers verify the per-segment first-key fences
  ascend strictly before trusting it, and keyed lookup binary-searches the
  fences. Implemented in all three runtimes: `openBeast2PagesFor` (TS),
  `east_beast2_pages_*` (C), `open_beast2_pages_for` (Python). A paged
  segment decodes against an EMPTY definition table — REF deltas are
  relative, so a self-contained segment resolves identically, and a blob
  whose `self_contained` flag lies trips the delta bounds check instead of
  silently resolving to the wrong container.
- `self_contained_segments` asserts that no REF delta and no source-map
  delta crosses a root-segment boundary, so each indexed segment decodes
  independently (and in parallel). Writers that set it also scope aliasing
  per root element (see *Aliasing scope in a self-contained collection*), a
  stronger promise no reader relies on. Random access requires the flag;
  sequential decode is unaffected either way (relative deltas decode
  identically). Only blobs whose root is Array/Set/Dict may carry an index.

## Segmentation rules

Where a collection's root segments end is not part of what a reader
validates — any segmentation decodes to the same value — but it decides the
bytes, so a store that addresses segments individually needs it to be a rule.
Each rule has an id, which a segment manifest records (below). Every writer of
a stored collection cuts by the current rules, and no encoder option changes
them; the earlier rules are listed because stored manifests name them.

### Fence bytes

A key's (Dict) or element's (Set) **fence bytes** are its logical encoding
alone: no header, container or index, encoded against a fresh definition
table so no container REF can fire. They depend on the key and nothing else,
and they are what the keyed rule hashes and what a manifest stores as a
segment's first key.

### Logical size

An element's **logical size** is the length of its logical encoding as a
writer of self-contained segments produces it, with aliasing scoped to the
element (see *Aliasing scope in a self-contained collection*), so it depends
on the element alone. A Dict element is a key/value pair, and its size is the
key's and the value's together. Sizes are measured before compression, so the
codec never enters a cut.

### `cdc/keyed/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2` — Set and Dict roots, and `cdc/array/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2` — Array roots

The two rules are one test over different bytes. An element's **hash input**
is its fence bytes under a Set or Dict root — the key alone, so updating a
Dict value never moves a cut — and its logical encoding under an Array root,
which has no key.

- The **boundary hash** of a byte string is the low 32-bit word of its FNV-1a
  64-bit hash (offset basis and prime as in *Type section*), mixed by
  murmur3's 32-bit finalizer. The low word evolves on its own, since the
  prime's 2^40 term never reaches it, so it runs in 32-bit arithmetic:

  ```
  h = 0x84222325                                  the offset basis's low word
  for each byte x:  h = (h XOR x) × 0x1b3 mod 2^32  the prime's low word
  h = h XOR (h >> 16);  h = h × 0x85ebca6b mod 2^32
  h = h XOR (h >> 13);  h = h × 0xc2b2ae35 mod 2^32
  h = h XOR (h >> 16)
  ```

  Over raw bytes: `""` hashes to `0x2c773e2c`, `"a"` to `0xa3eabd3f`, and
  `"foobar"` to `0x1f341994`.
- Walk the elements in canonical order, with `c` elements and `b` logical
  bytes in the open segment. The first element opens segment 0. Each later
  element, whose hash input hashes to `h`:
  - starts a new segment when `c ≥ 4096` or `b ≥ 8 MiB`;
  - otherwise joins the open segment when `c < 256` and `b < 64 KiB`;
  - otherwise starts a new segment when `h < max(2^22, ⌊b × 4096 / c⌋)`, and
    joins the open one when not.

  An element that starts a segment leaves `c = 1` and `b` its size; one that
  joins adds one to `c` and its size to `b`.
- The threshold is one element in 1024 until the open segment's average
  element size, `b / c`, passes 1 KiB, and rises with that average after, so
  a segment holds about 1024 narrow elements or about 1 MiB of wide ones. An
  average of 1 MiB or more makes every element a boundary.
- So every segment but the last holds at least 256 elements or at least
  64 KiB, and at most 4096 elements. A segment closes once it holds 8 MiB, so
  it passes that by at most its last element, and an element wider than
  8 MiB is a segment of its own. The last segment holds what is left.
- A cut falls *before* the deciding element, so a keyed segment's first key
  is the key that decided its boundary, and a keyed segmentation can be
  checked from its fences, counts and logical sizes alone. An Array
  segmentation cannot: the bytes that decided it are whole elements, which no
  fence carries.
- Where a cut falls depends only on the elements since the previous cut, so
  an edit moves the cuts after it only as far as the first cut the old and
  the new value share. The rule is a pure function of the value: nothing
  about the writer — the codec, the compressed size, how the elements were
  produced or batched — enters it.

### Earlier rules

Writers no longer cut by these. A manifest may name one; a store writing to
such a collection lays it out again under the current rule rather than
re-cutting part of it, since a re-cut region lines up with the segments
around it only when both were cut by one rule.

- `cdc/fnv1a64/256-1024-4096/1` — Set and Dict roots. A boundary key was one
  whose fence bytes' FNV-1a 64-bit hash had its low 10 bits zero, and a
  segment held 256 to 4096 elements, cut before a boundary key; the last held
  what was left.
- `pos/1000-2MiB/1` — Array roots. Segments of at most 1000 elements, refined
  toward 2 MiB of written wire bytes each. Where a cut fell depended on every
  element before it, so one edit moved every later cut.

## Segment manifests

A collection can be stored as one standalone blob per root segment plus a
manifest naming them in order. Equal values then name equal segments, and a
one-row edit re-cuts one of them. The TypeScript runtime pages a manifest
directly (`Beast2Pages` over a `Beast2ManifestSource`); east-c and east-py are
handed the segments spliced back into one blob.

- A **segment blob** for segment `i` of a segmented, indexed,
  self-contained blob is: the blob's header bytes up to and including the root
  tag frame, segment `i`'s frame byte-for-byte, the terminator frame, and an
  index of that one segment plus the footer. Splicing a manifest's segments
  back under their shared header reproduces the single-blob form exactly.
- The **manifest** is a v5 blob whose root type is the struct

  ```
  kind:    String      "$segments"
  level:   Integer     0 — entries name segment blobs (nesting is reserved)
  type:    EastType    the root collection type
  rule:    String      the id of the rule the segments were cut under
  header:  String      the store hash of the header bytes the segments share
  entries: Array<{ hash: String, fence: Blob, count: Integer, bytes: Integer }>
  ```

  with, per segment: the segment blob's store hash, its first key's fence
  bytes (empty for an Array root), its element (pair) count, and its size in
  bytes.
- A reader recognises a manifest by its root type's exact field names, in
  that order, and then by `kind`. A struct of the same shape with another
  `kind` is not a manifest.
- **On disk**, a manifest at `path` names its segments as the sibling files
  `path.segments/<hash>.beast2`. A runner that opens manifests pages through
  such a file, reading only the segments it touches.

## Writer memory / reader memory

- A writer of the canonical segments holds one open segment of encoded
  elements; a writer handed its segments as batches holds one batch. Either
  holds an identity map, which in self-contained mode clears per root element
  — O(element). In C, a container with refcount 1 at encode time cannot recur
  in the walk and never enters the identity map, so freshly built/decoded
  trees track O(1).
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
- Encoders write v5 by default (issue #416 phase 2), in all three runtimes at
  once. e3 content-addresses beast2 bytes, so the flip changed every object
  hash — cache invalidation, which is why it shipped as one coordinated
  release rather than per-runtime.
- The streaming/paging APIs are v5-only (v4 cannot stream by construction).
