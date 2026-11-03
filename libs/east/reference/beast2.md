# Binary serialization (beast2)

beast2, the binary form every runtime and e3 store, and collections larger than memory. Part of the `east` skill.

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
| `new Beast2RunSorter(T, openRun, { merge } \| { union })` | Elements in ANY order in, sorted canonical runs out (a key added twice folds with `merge(key, acc, value)`, or `union` for a Set; without one it throws); then `mergeBeast2For(T, { merge } \| { union })(runs, sink)` writes the value. Memory is one run, then one segment per run. A run closes at `RUN_MAX_COUNT` elements or `RUN_MAX_BYTES`, platform constants, so every runtime writes the same runs. A fold whose values do not grow — `merge` over a bounded value type (Null, Boolean, Integer, Float, DateTime, Structs and Variants of those), or `union` — folds each key's values as they are added, in a table of at most `FOLD_TABLE_MAX_KEYS` keys and `FOLD_TABLE_MAX_KEY_BYTES` that spills into the open run, so few keys make one small run |
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
