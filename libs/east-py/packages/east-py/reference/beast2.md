# Beast2 streaming: collections larger than memory

`write_beast2_file` / `open_beast2_file`, parallel writes and splicing, the writers and page readers. Part of the `east-py` skill.

## Beast2 streaming — bounded-memory collections (`from east.serialization.beast2 import ...`)

Beast2 v5 encodes a large Array/Set/Dict as an append-only stream of
independently decodable segments: writer memory is one segment, never the whole
collection, and the decoders read v4 and v5 through the same entry points. The
canonical writers — the managed file writer, `Beast2ElementWriter`,
`encode_beast2_paged_for` — cut segments by one content-defined rule, the same in
TypeScript and east-c, so a value's bytes are its own whoever writes them;
`Beast2Writer` makes each batch you give it a segment instead.

**Managed files — start here (`open_beast2_file` / `write_beast2_file`).** Path
in, East values out. The file is self-describing, so a read needs no declared
type (a write does; a type declared on a read is validated at open). The file
object owns the fd and the mmap (closed on `with`-exit), east-c does every byte,
and the segments are the canonical ones — no buffers, iterators or batch sizes in
your code. The read flavour mirrors the root collection's read surface name for
name.

| Signature | Description |
|-----------|-------------|
| `write_beast2_file(path, T, value, *, codec="deflate")` | One call writes a collection of any size as one indexed v5 file — the value's canonical blob: segments where the content-defined cut rule places them, bounded in elements and bytes (wide rows never pile into one), key-disjoint for a Dict/Set. The bytes TypeScript and east-c write, and what `encode_beast2_paged_for(T)(value)` returns |
| `open_beast2_file(path, T, mode="w", *, codec=)` | The streaming writer: `.write()` takes East collections or python `list`/`dict`/`set` batches of any size, which add up to one canonical blob (a Set/Dict batch continues strictly ascending from the last); `.segments` counts the segments closed so far |
| `open_beast2_file(path, T=None, *, project=None)` | The read: `Beast2ArrayFile` / `Beast2DictFile` / `Beast2SetFile`, a READ-ONLY East collection VALUE subclassing `EastArray`/`EastDict`/`EastSet` — `isinstance`/`type_of` answer, every eager method works (streamed, below), mutation raises, and it binds into functions or passes into compiled calls by reference, where keyed reads answer from the pager, one frame per hit or miss, through a byte-budgeted segment cache (`EAST_PAGED_CACHE_BYTES`); `close()` defers while a bind holds it. `T` is optional (the header supplies it, also as `f.wire_type`); a declared `T` is checked against the header at open, never decoded as garbage |
| `read_beast2_type(source) -> EastType` | The root type of any beast2 blob (v4 or v5), from a path or a buffer, nothing decoded — for a file you know nothing about |
| `write_beast2_file_parallel(path, T, partitions, produce, *, processes=, strategy="auto", codec=, keep_shards=False, verify=False)` | N workers, ONE file: `produce(partition)` returns that partition's batches (or one collection); each worker writes a shard cut canonically from its start, and the shards splice **in partition order** as they finish. `strategy="auto"` forks on Linux/macOS — what `produce` closes over is inherited copy-on-write, so build the expensive context before the call (and before starting threads) — and runs inline on Windows, byte-identically. Any worker failure fails the call with the worker's traceback and leaves nothing behind |
| `splice_beast2_files(path, T, sources, *, verify=False) -> (segments, elements)` | Merges indexed v5 files by **byte copy** — east-c parses the geometry, `os.sendfile` moves the frames, nothing re-encodes. `sources` may be a lazy generator (spliced as they complete, in row order). Each must be v5, indexed and self-contained with an identical type section; a refusal names the path and leaves no destination. `verify=True` re-walks the result with east-c's strict reader |
| `f.load()` | The whole collection, decoded in east-c off the mmap — input memory stays one segment at any size; also the mutable escape hatch, like `f.copy()` |
| `f.segments()` | DEPRECATED — the file IS its collection value; still works (with a warning) for per-batch migration code |
| `len(f)` · `f.segment_count` · `f.self_contained` · `f.indexed` | O(1) from the trailing index, exact for every root kind |
| Array: `f[i]` / `f[a:b]` · `f.get(i)` ❗bounds · `f.get_or_default(i, d)` · `f.try_get(i)` · `f.has(i)` · `f.slice(a, b)` · `f.get_keys(rows)` | `EastArray`'s names, signatures and errors; a point read decodes only the owning segment, `get_keys` each owning segment once |
| Dict: `f[k]` ❗KeyError · `f.get(k[, default \| fn(k)])` · `f.get_or_default(k, d)` · `f.try_get(k)` · `f.has(k)` / `k in f` · `f.get_keys(keys, fill)` · `f.items()` / `values()` / iteration (streaming) · `f.keys()` (the Set) · `f.size()` — Set: `x in f` / `f.has(x)` | east-c binary-searches the segment *fences* (each segment's first key, from a bounded probe, cached), then decodes ONLY the owning segment (a small LRU keeps hot ones); `get_keys` merges the sorted keys against the fences and calls `fill` per missing key. The first keyed read verifies the fences: a corrupt or pre-contract blob raises `segments are not disjoint ascending key ranges` instead of reporting false misses |
| Array sorted search: `f.find_sorted_first/last(target)` → a global index · `f.find_sorted_range(target)` → `{start, end}` | `EastArray`'s contract over the whole file, only the boundary segment decoded; no `key=` projection (the file pages in element order) — pair with `f.slice(start, end)` |
| Compute: `map` `filter` `filter_map` `first_map` `reduce` `scan` `map_reduce` `sum` `mean` `maximum` `minimum` `every` `some` `find_*` `is_sorted` `to_set` `unique` `to_dict` `to_array` `to_columns` `map_batches` `string_join` `flat_map` (Array) / `flatten_to_array` (Set, Dict) `flatten_to_set` `flatten_to_dict` `for_each`, the whole `group_*` family, Set algebra | Each segment runs the ordinary eager method, and partials combine in east-c in stream order: order-dependent folds thread ONE accumulator and grouped folds seed each segment from the running per-group accumulators, so results equal `load()` exactly, float order included. Array `(el, idx)` callbacks, and the indices `find_*` / `group_find_*` report, are GLOBAL; `first_map`/`some`/`every`/`is_superset_of` stop decoding at the answer. Dict/Set compute streams disjointness-verified segments. A re-keyed collision (`to_dict`, `flatten_to_dict`, `group_to_dicts`) combines left-associatively in stream order — use an associative `combine`. `sort`/`reverse`/`copy`/`concat`/`union` materialize the collection — `load()` first |
| Column projection — INFERRED on the compute family; EXPLICIT with `open_beast2_file(path, project=NARROW)` | The compute family builds its callbacks FIRST and decodes each segment to just the struct fields their IR reads (the rest are hopped over, never built — building values, not walking bytes, is what decoding costs). Fields subset by name at any depth; a subtree used any other way stays whole, so results never change; Dict keys and Set elements never narrow. Runner-opened task inputs infer the same from the body's loop IR. What cannot be inferred decodes whole and is COUNTED in `eager_stats()` (`beast2_segments_projected/whole`, `beast2_projection_declined_*` by reason) — a projection that silently stopped applying would be an invisible cliff. The explicit form serves the subset to EVERY read (point reads, keyed gets, `load()`); `project` must be a subset of the wire type (a missing field raises `ValueError` naming it), a declared `T` keeps its meaning, and `find_sorted_*` refuse under it. A segment decoded under one mask is never served to a read needing more. No wire change |
| Degraded blobs | v4 → refused (`decode_beast2_with_header_for` still decodes it whole); index-less v5 → `load()` works, random access refuses; not self-contained → point reads refuse |
| **Manifest directories** — one object per segment plus a manifest naming them: how e3 stores a collection, and stages a task input |
| `Beast2ManifestWriter(T, path, *, codec="deflate")` | The canonical writer (a context manager): `.add(el)` / `.add_all(batch)`, as `Beast2ElementWriter` takes them; each segment goes to `<path>.segments/<sha256>.beast2`, a standalone blob under the shared header, and `.close()` writes the manifest to `path` — the directory TypeScript's `Beast2ManifestWriter` and east-c write. A writer left by an exception writes no manifest; `.segments` counts them; east-c does every byte, hashing included |
| `load_beast2_manifest(path, T=None)` ❗ | The whole collection, segment by segment in east-c — the value its segments spliced into one blob decode to. `ValueError` when `path` holds no manifest, the types differ, or a segment is missing or malformed |
| `read_beast2_manifest(source)` | The manifest — `kind`, `level`, `type`, `rule`, `header`, `entries` (each `{hash, fence, count, bytes}`) — or `None`; a blob holding a value is read no further than its type section |

```python
from east.serialization.beast2 import open_beast2_file, write_beast2_file

write_beast2_file(path, rows_t, rows)             # any size, one call

with open_beast2_file(path) as f:                 # self-describing: type from the
    row = f[1_234_567]                            #   header (f.wire_type); pass rows_t
    totals = f.group_sum(lambda b, r: r["sku"],   #   instead to VALIDATE it at open
                         lambda b, r: r["qty"])   # whole-file compute: segment folds,
    top = f.maximum(by=lambda b, r: r["qty"])     #   never materialized, == load() exactly
    table = f.load()                              # whole table when you truly need it

# The file IS a collection value: bind it into a function and the
# compiled body's keyed reads answer from the pager — one frame per lookup.
with open_beast2_file("table.beast2") as t:       # Dict<String, Float>
    lookup = East.function([StringType, DictType(StringType, FloatType)], FloatType,
                           lambda b, k, d: d.get_or_default(k, 0.0)).bind(t)
    joined = rows.map(lambda b, r: r.v + lookup(r.k))   # loop + callee + pager: all east-c
```

**Buffer level — you hold bytes, not a path. `_for` is NOT `_with_header_for`:**

| Signature | Description |
|-----------|-------------|
| `encode_beast2_with_header_for(T, *, version=None)` / `decode_beast2_with_header_for(T)` | **The one you want**: the self-describing container — magic, type schema, value. Encode writes the current default container (v5; `version=4` only for a reader that predates it); decode reads v4 and v5, whole (Set/Dict segments must hold the canonical value — sorted, disjoint — or the blob is rejected as corrupt). ❗The header's type must be `T`, or a subtype whose variant cases line up with `T`'s (a `none` reads as any `Option`), else `ValueError: beast2: cannot decode a blob of type … as …` before anything decodes — the words TypeScript and east-c use |
| `encode_beast2_for(T)` / `decode_beast2_for(T)` | **Headerless** type-directed bytes: the reader must know `T` exactly, and mutable containers (Array/Set/Dict/Ref) are refused. In TypeScript `encodeBeast2For` is the FULL container — do not port a call site by name |
| `Beast2ElementWriter(T, stream, *, codec="deflate", parallel=False)` | The canonical writer (a context manager): `.add(el)` — an Array/Set element or a Dict `(key, value)` pair — and `.add_all(batch)` (the loop in east-c); Set elements and Dict keys strictly ascending in East order. Segments fall where the cut rule places them — the bytes the managed writer, TypeScript and east-c write; memory is one open segment; `.close()` writes the last segment, the terminator and the index; `.segments` counts the closed ones. An element that does not ascend, or fails to encode, raises and leaves the writer as it was |
| `encode_beast2_paged_for(T, *, codec="deflate") -> (value) -> bytes` | A whole collection through the canonical writer — the write side of `open_beast2_pages_for` |
| `Beast2RunSorter(T, open_run, *, merge=None, union=False, codec="deflate", parallel=False)` | A Set's or Dict's elements in ANY order in, sorted canonical runs out: `.add(el)` encodes at once; at `RUN_MAX_COUNT` elements or `RUN_MAX_BYTES` it sorts the run — stably, so a key's values keep the order they came in — folds a repeated key (`merge`, a compiled `(K, V, V) -> V` East function, for a Dict; `union=True` for a Set; neither: it raises) and writes the run to `open_run(run)` (anything with `write(bytes)` and `close()`) as its value's canonical blob. `.finish()` writes the last run; `.runs` counts them. A fold whose values do not grow — `merge` over a bounded value type (Null, Boolean, Integer, Float, DateTime, Structs and Variants of those), or `union` — folds each key's values as they are added, in a table of at most `FOLD_TABLE_MAX_KEYS` keys and `FOLD_TABLE_MAX_KEY_BYTES` that spills into the open run, so few keys make one small run. The runs are the ones east-c and TypeScript write; a sink's exception comes back out of the call that wrote the run; a key repeated across runs is the merge's to fold |
| `Beast2Writer(T, stream, *, codec="deflate", self_contained=True, index=True, parallel=False)` | Segments of your choosing (a context manager): `.write(batch)` appends one segment per non-empty batch; `.close()` writes the terminator and the index; `.segments` counts. Set/Dict batches must ascend strictly across the stream. **Keep both defaults** — `index` and `self_contained` are what `open_beast2_pages_for` needs, and turning either off silently forfeits random access. `codec="none"` for already-compressed payloads or raw write throughput |
| `encode_beast2_segments_for(T, **opts) -> (batches) -> bytes` | In-memory `Beast2Writer`: one segment per non-empty batch |
| `encode_beast2_v5_for(T, *, codec="deflate", index=False) -> (value) -> bytes` | A whole value of any root type as v5; decode with `decode_beast2_with_header_for` |
| `iter_beast2_segments_for(T) -> (source) -> iterator` | One decoded collection per segment, O(segment) memory; `source` is bytes, an `mmap` or a binary stream |
| `read_beast2_index(T, blob) -> (segments, elements) \| None` | O(1) totals from a v5 blob's trailing index |
| `open_beast2_pages_for(T) -> (source) -> Beast2Pages` | Random access: `.segment_count` `.element_count` `.self_contained` `.counts`, `.segment(i)`, `.element(row)` (also `len()` / `[]`), each decoding ONE segment. ❗Needs `index=True` and `self_contained=True` (the defaults); `.element()` is for Array roots. ❗Borrows the buffer — keep it (and an mmap) alive for the pages' lifetime, or use `open_beast2_file`, which owns it |

**Batch size (`Beast2Writer` only — the canonical writers cut by the rule).** A
batch is at once your memory ceiling, one segment, one compression window and
the granularity of random access. ~1000 rows is a good default: one row per
batch costs about 4× the bytes, and the curve is flat past ~100. `write()` takes
a batch, never a row — accumulate and flush yourself, or hand rows to
`Beast2ElementWriter`, which needs no batch at all.

```python
import mmap
from east.serialization.beast2 import (
    Beast2Writer, iter_beast2_segments_for, open_beast2_pages_for,
)
rows_t = ArrayType(row_type)

with open(path, "wb") as f, Beast2Writer(rows_t, f) as w:
    for batch in produce_batches():          # each an EastArray(row_type, ...)
        w.write(batch)                       # O(batch) memory, one segment each

# Sequential re-read. mmap, NOT .read() — .read() pulls the whole file in and
# throws away the bounded-memory property you just paid for.
with open(path, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
    for batch in iter_beast2_segments_for(rows_t)(mm):
        consume(batch)                       # O(segment) decoded at a time

    # Or jump straight to a row — decodes only the segment that owns it.
    pages = open_beast2_pages_for(rows_t)(mm)
    row = pages.element(1_234_567)
```
