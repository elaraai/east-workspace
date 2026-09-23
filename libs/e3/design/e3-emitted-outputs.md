# Design: emitted outputs — sorted runs, assembled by e3

> Status: **accepted, in progress** · 2026-09-23
> Audience: e3, east, east-c and east-py maintainers.
> Epic #790; phases #791 (canonical form), #792 (runners), #793 (e3 assembly
> and the SDK cutover), #794 (manifest outputs), #795 (docs and cloud).
> Builds on [`e3-records-schema.md`](./e3-records-schema.md) (#786's segment
> layout and its content-defined cut rule). **Hard cutover:** packages are
> re-exported, and no compatibility decoders are kept; readers do not change,
> so every stored dataset stays readable.

## 1. Problem

A task that produces a large collection has to hold it whole somewhere. A
re-key through `partitionTask` + `merge` was reported peaking past 150 GB on a
184 GB host. The paths that hold a collection whole, and the one that makes
its bytes depend on how it was produced:

1. **A partition body returns its partial**, decoded. Nested rows decode to
   about 80× their wire size in east-c (reported: a 32.6 MB slice held 2.8 GB of
   partial). `targetPartitionBytes` sizes the input slice, not the output, and
   `--jobs` (the CPU count since 1.0.78) runs that many units at once.
2. **A runner encodes a returned collection into one buffer** before writing
   it (east-node's `writeOutput`, east-c-cli's `east_beast2_encode_paged` +
   `fwrite`) — a second whole copy.
3. **The emit sink refuses out-of-order Set/Dict keys** (#770, 1.0.78), which
   removed the only bounded route for a re-key or an unordered ingest (#519's
   spill sink, 1.0.60–1.0.77).
4. **The index build** collects each slice's entries into a local Dict.
5. **The cutting door decodes whole.** `cutDatasetObject` / `cutDatasetBlob` fall back to a
   whole-value decode when a blob's cuts break the key rule, and a spliced
   index build reaches it. Task outputs are adopted as written, so a spliced
   partition output keeps seam cuts no one-pass writer makes and hashes
   differently from the same value written in one pass.

## 2. Principles

- **P1 Bounded memory everywhere.** No runner, orchestrator or storage door
  holds a value, a partial or an output whole; memory is bounded by explicit
  caps, independent of data size, key order and decode expansion.
- **P2 Bytes are a function of content.** A stored collection's bytes do not
  depend on the runtime, the emission order, the partitioning, the spill cap,
  or which objects its entries share.
- **P3 Nothing is declared or guessed.** Authors state nothing about their
  data's order or size; there are no heuristics and no performance modes.
- **P4 One model.** Small results are returned; large collections are
  emitted, and the platform turns emissions into the canonical collection.
- **P5 #770's rule holds.** Value work runs on runners, byte work in the
  storage layer; e3-core plans and records.

## 3. The model

| API | Body | Output |
|---|---|---|
| `e3.task` | returns a value | the value — fits in memory |
| `e3.streamTask` | one sequential pass; emits | the canonical collection of the emissions |
| `e3.partitionTask` | per slice, in parallel; emits | the canonical collection of every slice's emissions |
| `e3.aggregateTask` | per slice; returns a small partial | the partials folded pairwise with `combine` |

- Emission order is free. An Array keeps emission order (partition order
  first); a Set or Dict is sorted by key.
- Equal keys fold with `merge` — a Dict's `(key, a, b) => value`, which must be
  associative because runs merge in trees — or `'union'` for a Set. Without a
  fold an equal key is an error naming it. This is the one thing an author
  states, and it is the output's meaning, not a property of the data.
- Assembly has no modes: disjoint partials concatenate, overlapping ones
  merge.
- Gone: returning bodies in `partitionTask`, the ascending-emission contract,
  splice-order errors, and `combine` on `partitionTask`.

## 4. Canonical form (beast2 v5, #791)

### 4.1 Aliasing is scoped per element

A self-contained segmented writer scoped `REF` per segment, so two elements
sharing a container were written with a back-reference only when they landed
in one segment — sharing between elements survived by the accident of where
segments fell, and the bytes depended on object identity. Writers now reset
the identity map at each root element (an O(1) reset). Every element's
encoding is context-free, which is what lets encoded elements be sorted,
merged and re-cut by byte copy. `REF` deltas are relative, so readers are
unchanged; sharing inside an element is kept. Task inputs decode frozen, so
sharing between elements was never observable downstream.

### 4.2 Keyed segmentation is the content rule, everywhere

#786's rule (`cdc/fnv1a64/256-1024-4096/1`) holds for every stored keyed
collection, not only records: the door that stores an output enforces it.

### 4.3 Seam repair

Concatenating sorted, disjoint pieces leaves each seam cut wherever the piece
ended, and the cutter's count restarts there, so the piece's first cuts may
not be the rule's either. Seam repair walks the segment geometry (fences and
counts), keeps every run of rule-consistent segments as a byte span, and at a
cut the rule would not make decodes from the last consistent cut, re-cuts with
the rule and re-encodes, until the re-cut lands on a stored cut — after which
the stored cuts are the rule's again. With ordinary keys that is a segment or
two per seam; keys that never hit a boundary re-cut up to the next hash cut,
costing more I/O but never more than one neighbourhood of memory. It replaces
every whole-value re-cut.

## 5. Primitives

| Primitive | Status | Contract |
|---|---|---|
| Writer | exists | ascending entries in; canonical segments out |
| Run former (#792) | new | entries in any order; buffers encoded entries up to a byte cap (keys kept decoded to compare); adaptive stable sort by (key, emission order), O(n) on sorted input; equal keys folded or refused; each full buffer written as a sorted canonical run |
| Merge | exists | k sorted blobs, ranged, folding in input order, out to one canonical blob |
| Seam repair (#791) | new | disjoint canonical pieces, in key order, out to canonical segmentation |

TypeScript (east, and east-node for anything touching files) and C (east-c,
which east-py binds) implement each one, pinned to each other byte for byte.

## 6. Runners (#792)

- `run --emit set|dict` writes through the run former. The unit's output is one
  run, written to `-o`, or a **run set** — `-o` holds a small `$runs` value
  naming `<output>.runs/<n>.beast2` in emission order.
- `run --emit array` writes through the plain writer; order is emission order.
- A returned collection is written segment by segment through the writer.
- A runner never merges its own runs, and never checks emission order.
- Caps: `EAST_EMIT_RUN_BYTES` (64 MiB, counting key and value bytes) and
  `EAST_EMIT_RUN_ELEMENTS`, with the same defaults and accounting on every
  runtime, so the same emissions produce the same runs everywhere.

## 7. Assembly (#793)

Every emitting execution is a plan, a map and an assembly:

- **plan** — one unit for a `streamTask`; one per slice for a `partitionTask` or
  an index build;
- **map** — the units run and emit; each output is one run or a run set;
- **assemble** — gather every run of every unit; group the runs whose key
  ranges overlap; merge each overlapping group with the ranged merge units
  (the #770 fan-in tree); concatenate the disjoint results in key order and
  repair each seam. Arrays concatenate in partition order.

"Always sort" is the only policy, and it costs nothing for data already in
order: ordered emission yields disjoint runs, which become the output's
segments directly (§8), while unordered emission yields overlapping runs,
which merge. Nothing detects order and nothing switches.

e3 merges the runs, not the runner: one pass fewer, merges in parallel even
for a `streamTask`, a unit's scratch holds only its runs, and on e3-cloud the
merges are separate short units within Lambda's time and disk limits.
`aggregateTask` keeps the pairwise fold of today's combine template.

## 8. Storage (#794)

- Every collection output is a manifest of segment objects, as records are.
  Assembling disjoint runs costs manifest entries plus the repaired seam
  segments — no byte copy — and an unchanged segment deduplicates.
- east-c and east-py open manifest inputs lazily, as east-node does, so no
  manifest input is spliced for them.
- Scratch defaults to disk, inside the repository, so runs never sit in RAM on
  a tmpfs temp directory. `E3_SCRATCH_DIR` still overrides.
- The door never decodes a collection whole.

## 9. Decisions

1. e3 merges the runs; a runner never merges its own.
2. Aggregation is its own API, `e3.aggregateTask`.
3. Every collection output is stored as a manifest.
4. `merge` must be associative everywhere.
5. Key order is never declared: no order flag, and no arity detection — every
   emitting body has one shape.

## 10. Rejected

- **Smaller partitions.** The only knob sizes the input; a body whose output
  outgrows its input stays unbounded, and a partition is at least one segment.
- **An e3-core sort over small chunks** (emit pairs, carve, sort each chunk in
  a unit, merge). No runner change, but each chunk is held decoded, so memory
  still grows with the decode expansion; more passes and processes.
- **Declaring order** (`order: 'any'`). It asks the author for something only
  the data decides.
- **Streaming while keys ascend, sorting only after the first out-of-order
  key.** A mode switch the run former does not need once disjoint runs cost
  nothing to assemble.
- **Emit or return chosen by the body's declared arity.** Breaks under rest
  parameters and wrappers.
- **An order-preserving key encoding**, so merges compare bytes. Keys are
  small and decoding them is cheap; a new encoding for every type is not.
- **Keyed datasets as permanent runs, compacted later.** One value would hash
  differently depending on how it was written, which breaks caching.

## 11. Cutover

Packages are re-exported: task shapes and metadata change and no old decoder
is kept. Caches invalidate once — task hashes change, and bytes change where
elements shared containers. Readers are unchanged, so every stored dataset
stays readable.
