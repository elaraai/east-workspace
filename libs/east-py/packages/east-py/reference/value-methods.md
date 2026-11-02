# The East value classes' methods

Every eager method of `EastArray`, `EastSet`, `EastDict`, `EastVector`, `EastMatrix`, `EastBlob` and `EastStruct` / `EastVariant` / `EastRef`, the container generators, the `East.<Type>` namespaces, and the DateTime format codes. For a worked example over values, search the index with `package: "east-values"`. Part of the `east-py` skill.

## Contents

- EastArray — complete method surface
- EastSet — complete method surface
- EastDict — complete method surface
- EastVector — complete method surface
- EastMatrix — complete method surface
- EastBlob (a `bytes` subclass)
- EastStruct / EastVariant / EastRef
- Container generators (classmethods)
- East.<Type> namespaces — the builtins and the standard library
- DateTime format codes

## EastArray — complete method surface

Eager; results are live east-c-backed values that chain. `arr[i]`, `len(arr)`, `for x in arr`
work via the sequence protocol. Callback methods accept a python body — the block first, then
the arguments the table lists, so `fn(el)` is written `lambda b, el: …` — (built into a native
function) or a precompiled `East.function(...)` (a value: it takes no block); anything East cannot
express raises with the binding named. Result types come from the build, so `out`/`element_type` is optional — pass it
to PIN a type (a widening map, an Option payload) and a contradicting precompiled function raises
at the call. `.element_type` is the logical element type.

| Group | Methods |
|-------|----------------------|
| Access | `get(i[, default_fn(i)])` (errors when out of bounds — `arr[i]` is the pythonic read; TS `get(index, onMissing?)`) · `at(i)` · `get_or_default(i, default)` · `try_get(i) -> some/none` · `has(i)` · `size()`/`length()` · `get_keys(indices: EastArray)` |
| Reorder (new array) | `sort(by=None, *, reverse=False)` (TS `sort`; `sorted` is the deprecated spelling) · `reverse()` (`reversed` deprecated) |
| Slice & combine | `slice(start, end)` · `concat(other)` · `copy()` |
| Per-element | `map(fn(el), out=None)` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None)` · `for_each(fn(el)) -> None` — every element callback may also declare `(el, idx)` to receive the builtin's index |
| Reduce | `reduce(fn(acc, el), init)` (TS order; `fold(init, fn)` is the deprecated spelling) · `scan(fn(acc, el), init) -> Array` (running fold: one accumulator per element, seed not emitted, `scan(...)[n-1] == reduce(...)`) · `map_reduce(map_fn(el), reduce_fn(acc, m), out=None)` · `sum(fn=None)` · `mean(fn=None) -> float` (NaN when empty) · `maximum(by=None)` ❗empty · `minimum(by=None)` ❗empty (the ELEMENT — of `by(el)` when given — a tie keeps the first, like TS) · `every(pred=None) -> bool` · `some(pred=None) -> bool` (native short-circuit) |
| Group & index | `group_by(key(el)) -> Dict` · `group_reduce(key, init(gk), fold(acc, el)) -> Dict` · `group_size(key=None)` · `group_sum(key, fn=None)` · `group_mean(key, fn=None)` · `group_maximum/group_minimum(key, by=None)` (Dict of the ELEMENT per group, like TS — `group_find_maximum` is the index finder) · `group_every/group_some(key, pred)` · `group_find_all(key, value, by=None) -> Dict<K, Array<Integer>>` / `group_find_first(key, value, by=None) -> Dict<K, some/none>` (GLOBAL row indices; every group appears, so a group with no match maps to `[]` / `none`) · `group_find_maximum/group_find_minimum(key, by=None) -> Dict<K, Integer>` (the INDEX per group; a tie keeps the earliest) · `group_to_arrays(key, value=None)` · `group_to_sets(key, value=None)` · `group_to_dicts(key, key2, value=None, combine=None)` · `to_dict(key(el), value=None, combine=None) -> Dict` (duplicate key errors without `combine`) · `to_set(key=None) -> Set` · `unique() -> Set` |
| Search | `find_first(target, key=None) -> some/none` · `find_all(value, by=None) -> Array<Integer>` · `find_maximum/find_minimum(by=None) -> some(index)/none` · `find_sorted_first/last(target, key=None) -> int` · `find_sorted_range(target, key=None) -> {start,end}` · `first_map(fn(el)->some/none, out=None)` · `is_sorted(key=None) -> bool` |
| Flatten | `flat_map(fn(el)->arr, out=None)` (`flatten_to_array` deprecated) · `flatten_to_set(fn(el)->set, out=None)` · `flatten_to_dict(fn(el)->dict, combine=None)` (a duplicate key errors without `combine`) |
| Columnar | `to_columns(fields=None) -> dict` (numpy per numeric/bool column, `Option<Float>`→NaN, interned strings) · `EastArray.from_columns(element_type, columns)` *(static)* (C-side fill needs numpy columns — float64/int64/bool, `Option<Float>` as float64+NaN; python lists convert per cell) · `map_batches(fn(cols)->cols, out=None, batch_size=100_000)` |
| Convert | `to_tree(node, key(el[, i]), parent(el[, i])->some/none, build(el, i, children)) -> Array<node>` (flat parent-keyed rows → nested nodes of any depth, iterative — [Trees from flat rows](patterns.md#trees-from-flat-rows-and-recursion)) · `flatten_tree(children(el[, i])) -> Array<{path, node}>` (nested nodes back: every node with its path of indices, depth first, iterative) · `string_join(sep) -> str` (String arrays) · `to_vector() -> EastVector` (Float/Integer/Boolean elements, in order — east-c VectorFromArray; the expression method emits the same builtin) · `encode_csv(config=None, **options) -> EastBlob` (Array of structs; east-c ArrayEncodeCsv) |
| Mutate (in place, the TS names) | `push_last(item)` · `push_first(item)` · `append(array)` (ArrayAppend — a whole array, NOT one element) · `prepend(array)` · `pop_last()` · `pop_first()` · `update(i, item)` ❗bounds · `merge(i, value, update_fn(existing, incoming[, i]))` · `merge_all(array, merge_fn(existing, incoming[, i]))` · `clear()` · `sort_in_place(by=None)` · `reverse_in_place()` — plus the python protocol: `extend(iterable)` (bulk: one crossing; C-to-C for same-type East arrays, raw buffers for numpy) · `insert(i, item)` · `pop(i=-1)` · `remove(item)` · `count(value) -> int` · `index(value) -> int` |

## EastSet — complete method surface

Mutable, unique, **East-sorted**. `.element_type` is the element type; iteration / `to_array` /
`reduce` visit in East order. Every callback takes the block first (`lambda b, el: …`); the
signatures below list the arguments after it. **`map` and `filter_map` return an `EastDict`** keyed by the element
(Set→Set is `to_set`).

| Group | Methods |
|-------|---------|
| Access | `len(s)` · `value in s` · `has(value)` · `for el in s` |
| Algebra (vs another set) | `union(other)` · `intersection(other)` · `difference(other)` · `symmetric_difference(other)` · `is_subset_of(other) -> bool` · `is_superset_of(other) -> bool` · `is_disjoint_from(other) -> bool` (the TS names; `intersect`/`diff`/`sym_diff`/`is_subset`/`is_disjoint` are deprecated spellings) |
| Per-element | `map(fn(el)) -> Dict` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None) -> Dict` · `first_map(fn(el)->some/none, out=None)` · `to_set(fn(el), out=None)` · `to_array(key=None)` · `to_dict(key(el), value(el), combine=None)` (duplicate key errors without `combine`) · `to_tree(node, parent(el)->some/none, build(el, children)) -> Array<node>` (each element its own key) · `for_each(fn(el)) -> None` |
| Reduce | `reduce(fn(acc, el), init)` (TS order) · `scan(fn(acc, el), init) -> Array` (running fold in East order) · `map_reduce(fn(el), reduce(a,b))` (raises on empty) · `sum(fn=None)` · `mean(fn=None) -> float` · `every(pred=None)` · `some(pred=None)` (native short-circuit) |
| Group | `group_reduce(key(el), initial(gk), fold(acc, el)) -> Dict` · `group_size(key)` · `group_sum(key, fn=None)` · `group_mean(key, fn=None)` · `group_every/group_some(key, pred)` · `group_to_arrays/group_to_sets(key, value=None)` · `group_to_dicts(key, key2, value=None, combine=None)` · ⚠️ `group_fold(...)` is the DEPRECATED alias of `group_reduce` |
| Flatten | `flatten_to_array(fn(el)->arr, out=…)` (the TS Set name; `flat_map` is Array's and a deprecated spelling here) · `flatten_to_set(fn(el)->set, out=…)` · `flatten_to_dict(fn(el)->dict, combine=None)` (duplicate key errors without `combine`) |
| Mutate (in place) | `add(item)` · `insert(value)` (errors if present) · `try_insert(value) -> bool` (True if newly added) · `remove(item)` · `delete(value)` (errors if absent) · `try_delete(value) -> bool` · `discard(item)` · `union_in_place(other)` (adds all of `other`) · `clear()` · `copy()` |

## EastDict — complete method surface

Mutable, **East-sorted by key**. `.key_type` / `.value_type`. **Every Dict callback takes
the builtin's own `(value, key)` order — the TypeScript order** (the block first, as always):
`fn(b, value)` when the key is not needed, `fn(b, value, key)` when it is — for `map`,
`filter`, `first_map`, `to_*`, `flatten_to_*`, `map_reduce`, the projections of
`every`/`some`/`sum`/`mean` and `group_*`'s key/value projections alike; a fold step
(`reduce`/`scan`/`group_reduce`) is `fn(b, acc, value[, key])`; collision `combine` is
`combine(existing, incoming, key)` — for `union`/`union_in_place`/`to_dict` a 2-arg
`combine(existing, incoming)` is also accepted (a 3-arg one still receives the key).
`union`/`union_in_place` require `other` to have the same key AND value type (a
mismatch is refused); `merge_all` needs only the same KEYS and is generic
in `other`'s values; `merge` takes a single differently-typed value.

| Group | Methods |
|-------|---------|
| Access | `d[k]` · `k in d` · `has(k)` · `len(d)`/`size()` · `get(k)` ❗missing · `get(k, default)` (a value) / `get(k, fn(k))` (TS `onMissing`) · `get_or_default(k, default)` · `try_get(k) -> some/none` · `keys() -> Set` (TS; east-c DictKeys — `keys_set` deprecated) · `values()`/`items()` (python views) |
| Combine | `union(other, combine=None) -> Dict` (NEW dict, both inputs untouched; a shared key errors without `combine`) · `union_in_place(other, combine=None) -> None` · `merge_all(other, merge(existing, incoming[, key]), default(key)) -> None` (fold `other` into self in place; `default` seeds absent keys; **generic in `other`'s value type** — only the KEYS must match) · `merge(key, value, update_fn(existing, incoming[, key]), initial_fn=None) -> None` (ONE key, in place; `value` may be a different type — TS `merge`; `merge_key` deprecated) · `get_keys(keys: Set, fill(k)) -> Dict` |
| Per-entry | `map(fn(value[, key]), out=None)` · `filter(pred(value[, key]))` · `filter_map(fn(value[, key])->some/none, out=None)` · `first_map(fn(value[, key])->some/none, out=None)` · `for_each(fn(value[, key])) -> None` |
| Reduce | `reduce(fn(acc, value[, key]), init)` (TS order) · `scan(fn(acc, value[, key]), init) -> Array` (running fold in key order) · `map_reduce(map_fn(value[, key]), reduce_fn(a, b), out=None)` (raises on empty) · `sum(fn(value[, key])=None)` · `mean(fn(value[, key])=None) -> float` · `every(pred(value[, key])=None) -> bool` · `some(pred(value[, key])=None) -> bool` (native short-circuit) |
| Group | `group_reduce(key_fn(value[, key]), init_fn(gk), fold_fn(acc, value[, key]), key_out=None, acc_out=None) -> Dict` · `group_size(key_fn)` · `group_sum(key_fn, fn=None)` · `group_mean(key_fn, fn=None)` · `group_every/group_some(key_fn, pred(value[, key]))` · `group_to_arrays/group_to_sets(key_fn, value_fn=None)` · `group_to_dicts(key_fn, key2_fn, value_fn=None, combine=None)` · ⚠️ `group_fold(...)` is the DEPRECATED alias of `group_reduce` |
| Flatten | `flatten_to_array(fn(value[, key])->arr, out=None)` (the TS Dict name; `flat_map` is Array's and a deprecated spelling here) · `flatten_to_set(fn(value[, key])->set, out=None)` · `flatten_to_dict(fn(value[, key])->dict, combine=None)` (a duplicate key errors without `combine`) |
| Convert | `keys() -> Set` · `to_array(fn(value[, key]), out=None)` · `to_set(fn(value[, key]), out=None)` · `to_dict(key_fn, value_fn=None, combine=None, key_out=None, value_out=None)` (the value itself when `value_fn` is omitted; a duplicate key errors without `combine`) · `to_tree(node, parent(value[, key])->some/none, build(value, key, children)) -> Array<node>` (each entry's key its key) · `flatten_tree(children(value[, key])) -> Array<{path, node}>` (nested nodes back: every node with its path of keys, depth first, iterative) · `copy()` |
| Mutate (in place) | `d[k]=v` · `del d[k]` · `insert(k, v)` (errors if present) · `get_or_insert(k, fn(k))` · `insert_or_update(k, v, combine(existing, incoming, k))` · `update(k, v)` (TS; the read-modify-write `update(k, fn(current))` is deprecated) · `swap(k, v) -> prev` · `delete(k)` · `try_delete(k) -> bool` (`update`/`swap`/`delete` error on a missing key) · `pop(k, *default)` · `clear()` |
| Bulk (in place) | `update_many(keys, values, combine(existing, incoming)=None)` — the whole batch crosses once; a pure/precompiled `combine` resolves collisions C-to-C (dicts as hot-loop accumulators) |

## EastVector — complete method surface

Immutable 1-D numeric value: logical element type `Float`/`Integer`/`Boolean`,
backed by a contiguous NumPy buffer for zero-copy ML interop; `.element_type` is
fixed, while the storage `.dtype` may be any compatible width (f32, …). The
**arithmetic surface delegates to the east-c builtins** — reductions fold in
strict left-to-right index order and comparisons use East's total order (NaN
greatest, `-0.0 < 0.0`) — bit-identical across the TypeScript, C and python
runtimes, which numpy's reassociating reductions are not; free-form math goes via
`to_numpy()`/`to_torch()`. `set` and every transform return a NEW vector. Not
hashable, but a valid East Set/Dict key (ordered by value). Construct with the
`EastVector.*` classmethods ([Container generators](#container-generators-classmethods));
`from_numpy`/`from_torch` infer `element_type` from the dtype when omitted.
Structural access with an **expression** argument (inside a body) lifts the
vector as a constant and emits IR, like the eager collections.

| Group | Methods |
|-------|---------|
| Access | `get(i)` ❗bounds (promoted Python scalar) · `length() -> int` · `slice(start, end) -> EastVector` (half-open, contiguous copy) |
| Transform (returns new) | `set(i, v) -> EastVector` ❗bounds (original unchanged) · `concat(other) -> EastVector` (takes this vector's element type) |
| Arithmetic (east-c; Float/Integer elements) | `scale(alpha)` · `add_scaled(other, alpha)` (`self + alpha*other`) ❗len · `mul(other)` ❗len · `add_scalar(c)` · `abs()` · `clamp(lo, hi)` (East order) · `cum_sum()` (running sum, left to right) |
| Reduce (east-c; strict left-to-right order) | `sum()` (0 when empty) · `dot(other)` ❗len · `max()`/`min()` ❗empty (TS names; `maximum`/`minimum` deprecated) · `arg_max()`/`arg_min()` ❗empty (ties keep the first index; NaN is greatest) · `mean() -> float` (Integer widens per element; NaN when empty) |
| Masks & selection (east-c) | `eq(other)`/`lt(other)`/`gt(other)` ❗len `-> Vector<Boolean>` (East equality/order) · `mask.select(a, b)` ❗len (mask receiver) · `v.compress(mask)` ❗len · `mask.count_true() -> int` |
| Gather / scatter / search (east-c) | `gather(indices)` ❗bounds · `scatter_add(indices, src)` ❗len/bounds (duplicates accumulate in order) · `search_sorted(needles) -> Vector<Integer>` (leftmost insertion index; assumes sorted) |
| Sparse accumulators (east-c; `East.Vector.*`) | `sparse_axpy(ixA, vA, ixB, vB, alpha)` (union merge `vA + alpha*vB`; absent entries stay absent) ❗ascending/len · `sparse_from_pairs(ix, v)` (sorts + sums duplicates stably, in input order) ❗len · `sparse_filter_gt(ix, v, threshold)` ❗ascending/len — all return `Struct{ix: Vector<Integer>, v: Vector<T>}` with strictly ascending `ix`; every `ix`/`v` input takes a Vector OR an Array |
| Per-element (east-c; the native callback builtins) | `map(fn(el[, i]), out=None) -> EastVector` (VectorMap; Float/Integer/Boolean results) · `reduce(fn(acc, el[, i]), init)` (VectorFold, index order; `fold(init, fn)` is the deprecated spelling) — a body like every other callback, zero python per element |
| Convert | `to_array() -> EastArray` (promotes scalars; severs the zero-copy link) · `to_matrix(rows, cols) -> EastMatrix` (row-major reshape; `rows*cols == length`) |
| NumPy / torch | `to_numpy(dtype=None, copy=False) -> ndarray` (read-only view by default; a cast or `copy=True` is writeable) · `to_torch(dtype=None) -> torch.Tensor` (always a writeable copy) · `np.asarray(v)` via `__array__` · props `.dtype` (storage) / `.element_type` (logical) |

## EastMatrix — complete method surface

Immutable 2-D row-major numeric value on a contiguous NumPy buffer, with the
`EastVector` contract: logical `.element_type` apart from storage `.dtype`, the
arithmetic surface in east-c with the strict reduction order, free-form math via
`to_numpy()`/`to_torch()`, NEW matrices from `set` and every transform, not
hashable but a valid Set/Dict key, the `EastMatrix.*` classmethods to construct,
and an expression argument lifting the matrix as a constant.

| Group | Methods |
|-------|---------|
| Access | `get(r, c)` ❗bounds (Python scalar) · `rows() -> int` · `cols() -> int` (TS names; `num_rows`/`num_cols` deprecated) |
| Transform (returns new) | `set(r, c, v) -> EastMatrix` ❗bounds (original unchanged) · `transpose() -> EastMatrix` (new cols×rows, contiguous) |
| Arithmetic (east-c; Float/Integer elements) | `scale(alpha)` · `add_scaled(other, alpha)` ❗dims · `mul_elementwise(other)` ❗dims (Hadamard) |
| Reduce (east-c; ascending index order) | `row_sums() -> EastVector` (ascending column order per row) · `col_sums() -> EastVector` (ascending row order per column) · `vec_mul(v) -> EastVector` ❗cols≠len (row-by-vector dot products) |
| Rows & cols | `get_row(r) -> EastVector` ❗bounds (contiguous copy) · `get_col(c) -> EastVector` ❗bounds (contiguous copy) |
| Per-row (east-c) / per-element (DEPRECATED) | `map_rows(fn(row: EastVector[, i]) -> EastVector, out=None)` (the native MatrixMapRows — a body like every callback) · `map_elements(fn(el), out=None)` runs a python callback per element; it warns and will go — use the arithmetic surface or `to_numpy()` |
| Convert | `to_vector() -> EastVector` (row-major flatten) · `to_array() -> EastArray` (`Array<Array<el>>`, one inner array per row) · `to_rows() -> EastArray` (`Array<Vector<el>>`, one `EastVector` per row) |
| NumPy / torch | `to_numpy(dtype=None, copy=False) -> ndarray` (2-D; read-only view by default) · `to_torch(dtype=None) -> torch.Tensor` (writeable copy) · `np.asarray(m)` via `__array__` · props `.dtype` / `.element_type` |

## EastBlob (a `bytes` subclass)

`EastBlob(b"...")` constructs like `bytes` and carries the **full `bytes` API** plus East methods:

| Signature | Description |
|-----------|-------------|
| `size() -> int` | Byte length (== `len(blob)`) |
| `get_uint8(i) -> int` | Unsigned byte at `i` (0–255) |
| `.data -> bytes` | Raw payload |
| `decode_utf8() -> str` / `decode_utf16() -> str` | Text decode |
| `EastBlob.encode_beast2(value) -> EastBlob` *(static)* | Serialize an East value to BEAST2 (type inferred via `type_of`); `East.Blob.encode_beast(value, "v2")` is the builtin twin |
| `decode_beast(typ, version="v1") -> value` | The east-c BlobDecodeBeast / BlobDecodeBeast2 builtins (TS `decodeBeast`): `"v1"` is the original BEAST format, `"v2"` the beast2 family (any container version) |
| `decode_beast2(typ) -> value` | Decode BEAST2 as `typ` (the serialization-layer form) |
| `open_beast(typ) -> value` | The east-c BlobOpenBeast2 builtin (TS `openBeast`): an indexed beast2 `Array`/`Set`/`Dict` blob as a FROZEN paged proxy — the value a task's collection input opens as — whose `len`, keyed reads and iteration decode one segment; an index-less blob (what `encode_beast` writes) or a Ref-/function-bearing element shape decodes whole, frozen; mutation raises, `.copy()` gives a mutable value; a header of another type raises `cannot open a blob of type <wire> as <typ>` before any decode |
| `decode_csv(element_type, config=None, **options) -> EastArray` | Decode CSV rows into `Array<element_type>` (east-c decoder). Build `config` with `east.serialization.csv.csv_parse_config(...)`: by default **no field text is null** (empty field == empty string); opt in with `null_strings=[""]` (`none` for Option columns, error for required); `defaults={"qty": "0.0"}` gives per-column fallbacks for unparseable fields and constant-fill for absent columns; `skip_short_rows=True` drops ragged rows instead of erroring |

## EastStruct / EastVariant / EastRef

- **`EastStruct`** — frozen record; read fields by name: `s["price"]` or as an
  attribute, `s.price` (methods shadow same-named fields — item access always
  works). Build/transform with `struct({...}, StructType)`.
- **`EastVariant`** — frozen tagged value; `.type` is the case name, `.value` the payload.
  Build with `variant(case, value, T)` / `some` / `none`. Dispatch with the
  `.match({case: handler}, default=None)` method (handlers are bodies, `handler(b, payload)`;
  `default` is a `default(b)` body for the other cases — TS's partial match — or a plain
  value; the module-level `match(v, cases, default)` is equivalent) or
  `.match_tag(tag, handler, default)`. Also `get_tag()`, `has_tag(tag)`, and
  `unwrap(tag="some", on_other=None)` ❗ValueError on a different case unless the
  `on_other(b)` body answers — mirroring the TS variant expression surface, and the same
  shapes build inside a body. An option reads with the **same accessors as the
  expression surface** — `is_some()`, `is_none()`, `unwrap_or(default)` — so a
  decoded option needs no `opt.type == "some"` branch.
- **`EastRef`** — mutable cell: `get()` · `update(value)` (TS `RefUpdate`; `set` is the
  deprecated spelling, and the read-modify-write `update(fn(b, current))` is deprecated too —
  write `ref.update(f(ref.get()))`) · `merge(patch, combine(b, current, patch))`. Inside a
  body the expression twin is `East.ref(v)` with the same `get`/`update`/`merge`.

## Container generators (classmethods)

Eager factories are **classmethods** on the container classes (snake_case); their dual-mode
twins — usable inside a body — live on the `East.Array`/`East.Set`/`East.Dict`/
`East.Vector`/`East.Matrix` namespaces (`East.Array.range`, `East.Vector.zeros(T, n)`,
`East.Matrix.from_rows(rows)`, …). The namespace `generate`s take the **TypeScript argument
order** — `East.Array.generate(size, T, fn)`, `East.Set.generate(size, T, fn, on_conflict=None)`,
`East.Dict.generate(size, K, V, key_fn, value_fn, on_conflict=None)` — and, like TypeScript, a
key generated twice is a runtime error `Duplicate key <k> in set/dict` unless an `on_conflict`
handler is given (the pre-TS python order still works with a DeprecationWarning). Do not confuse them with
`East.new_array`/`new_set`/`new_dict`, which are the CONTROL-FLOW constructors: a fresh
loop-local collection built per evaluation inside a function.

| Signature | Example |
|-----------|---------|
| `EastArray.range(start, end, step=1)` | `EastArray.range(0, 5, 2)` → `[0, 2, 4]` |
| `EastArray.linspace(start, end, count)` | `EastArray.linspace(0., 1., 3)` → `[0.0, 0.5, 1.0]` |
| `EastArray.generate(count, fn(b, i), element_type=None)` | `EastArray.generate(3, lambda b, i: i*i, IntegerType)` |
| `EastSet.generate(n, fn(b, i), element_type=None, on_conflict=None)` | `EastSet.generate(4, lambda b, i: East.Integer.remainder(i, 2), IntegerType, lambda b, k: None)` — a duplicate ERRORS without `on_conflict` (TS) |
| `EastDict.generate(n, key_fn(b, i), value_fn(b, i), combine(b, x, y, k), key_type, value_type)` | `EastDict.generate(3, lambda b, i: i, lambda b, i: i*10, lambda b, x, y, k: x + y, IntegerType, IntegerType)` — `combine=None` makes a duplicate key an error (TS) |
| `EastVector.zeros/ones(element_type, length)` · `fill(element_type, length, value)` · `from_array(element_type, items)` · `from_numpy(array, element_type=None)` · `from_torch(tensor, element_type=None)` | `EastVector.zeros(FloatType, 3)` |
| `EastMatrix.zeros/ones(element_type, rows, cols)` · `fill(…, value)` · `from_array/from_rows(element_type, rows)` · `from_numpy(array, element_type=None)` · `from_torch(tensor, element_type=None)` | `EastMatrix.from_array(FloatType, [[1.,2.],[3.,4.]])` |

## East.<Type> namespaces — the builtins and the standard library

Scalars are plain Python, so their builtins are namespace functions — **complete** lists below.
Every one delegates to east-c, and every one is dual-mode: on plain values it runs now, on
expressions it emits IR. The `stdlib:` rows are the TypeScript standard library
(see [the stdlib](writing-east-functions.md#the-standard-library--the-typescript-easttype-functions)).

**`East.Float`** (f64)

| Signature | Notes |
|-----------|-------|
| `add(a,b)` · `subtract(a,b)` · `multiply(a,b)` · `divide(a,b)` · `remainder(a,b)` · `pow(base,exp)` | arithmetic |
| `negate(x)` · `abs(x)` · `sign(x)` · `sqrt(x)` · `exp(x)` · `log(x)` | unary / powers |
| `sin(x)` · `cos(x)` · `tan(x)` | trig |
| `to_integer(x) -> int` | raises on a non-integer float (e.g. `3.9`) |
| stdlib: `approx_equal(x, y, epsilon) -> bool` · `round_floor/round_ceil/round_half/round_trunc(x) -> int` | `round_half` ties away from zero |
| stdlib: `round_nearest/round_up/round_down/round_truncate(x, step)` · `round_to_decimals(x, decimals)` | step 0.0 returns `x`; NaN/±Infinity raise `Cannot round …` |
| stdlib: `print_fixed(x, decimals)` · `print_comma_seperated(x, decimals)` · `print_currency(x)` · `print_compact(x)` · `print_percentage(x, decimals)` | `"3.14"` · `"1,234.57"` · `"-$42.50"` · `"1.5M"` · `"12.34%"`; NaN/±Infinity raise `Cannot format …` |

**`East.Integer`** (i64)

| Signature | Notes |
|-----------|-------|
| `add(a,b)` · `subtract(a,b)` · `multiply(a,b)` · `divide(a,b)` · `remainder(a,b)` · `pow(base,exp)` | arithmetic (`divide` truncates) |
| `negate(x)` · `abs(x)` · `sign(x)` · `log(x, base)` | unary |
| `to_float(x) -> float` | widen to f64 |
| stdlib: `print_comma_seperated(x)` · `print_currency(x)` · `print_compact(x)` · `print_compact_si(x)` · `print_compact_computing(x)` · `print_ordinal(x)` · `print_percentage(x)` · `digit_count(x)` | `"1,234,567"` · `"$1,234"` · `"1.23M"` (K/M/B/T/Q) · `"1.23M"` (k/M/G/T/P) · `"1.17Mi"` (base 1024) · `"3rd"` · `"25%"` · `3` |
| stdlib: `round_nearest/round_up/round_down/round_truncate(x, step)` | step 0 returns `x`; `round_nearest(127, 10)` is `130` |

**`East.String`**

| Signature | Notes |
|-----------|-------|
| `concat(a, b)` · `repeat(s, n)` · `substring(s, start, end)` · `length(s) -> int` | build / measure |
| `upper_case(s)` · `lower_case(s)` · `trim(s)` · `trim_start(s)` · `trim_end(s)` | case / whitespace |
| `replace(s, find, replacement)` · `split(s, separator) -> Array<String>` | edit / tokenize |
| `contains(s, substring)` · `starts_with(s, prefix)` · `ends_with(s, suffix)` · `index_of(s, substring) -> int` | search (`-> bool`/`int`) |
| `regex_contains(s, pattern, flags="")` · `regex_index_of(s, pattern, flags="")` · `regex_replace(s, pattern, replacement, flags="")` | regex |
| `parse(typ, s)` ❗ · `print(typ, value) -> str` (the root `East.print(value[, typ])` is the same builtin, value first) | East **text** format; `parse` is a **strict whole-string** parser — trailing or leading junk raises (`"598-"`, `"$5"`, `"1.2.3"` all raise; in a body use `.try_parse(T)` for the optional form) |
| `parse_json(typ, s)` · `print_json(typ, value) -> str` / `print_json(value)` | East **JSON** (`Integer` encodes as a JSON *string*: `print_json(ArrayType(IntegerType), [1,2,3]) == '["1","2","3"]'`; an `Option` is `null` for `none` and the payload itself for `some` wherever the payload cannot be null — `print_json(OptionType(IntegerType), some(7)) == '"7"'` — and only `Option<Null>` / `Option<Option<T>>` keep the `{"type": …, "value": …}` object; a `DateTime` prints as `YYYY-MM-DDTHH:MM:SS.sss+00:00` and parses from any RFC 3339 date-time, as UTC); the one-argument form (TS `printJson(value)`) takes the value's own type |
| stdlib: `print_error(message, stack) -> str` | `"Error: <message>"` + one `[i] file line:column` per `{filename, line, column}` frame (TS `printError`) |

**`East.Blob`**

| Signature | Notes |
|-----------|-------|
| `encode_beast(value, version="v1", *, typ=None) -> EastBlob` | TS `East.Blob.encodeBeast`: `"v1"` the original BEAST format, `"v2"` the beast2 family; the type is the expression's declared type / `type_of(value)`, or `typ` to encode a plain value under a wider type |

**`East`** root: `East.str(*parts)` (TS `East.str` — the parts concatenated, non-String parts printed
in East text format: `East.str("n=", 5, "!")`), `East.print(value[, typ])` (TS `East.print` — the East
text format under the value's own type, or `typ`), `East.min(a, b)` / `East.max(a, b)` (`least`/`greatest`
under East's total order), `East.clamp(value, lo, hi)` and `East.jq(input, program, result_type)`
([Queries](control-flow-and-queries.md#queries--eastjq)) — all dual-mode.

**`East.DateTime`** (see [DateTime format codes](#datetime-format-codes))

| Signature | Notes |
|-----------|-------|
| `from_components(year, month=1, day=1, hour=0, minute=0, second=0, millisecond=0)` | construct (TS defaults: the trailing components are the first instant). An out-of-range component NORMALISES into the next one, it never raises: `(2024, 2, 31)` is `2024-03-02`, `(2024, 13, 1)` is `2025-01-01`, `(2023, 2, 29)` is `2023-03-01`. Range-checking the inputs does not catch it (31 February is all in range) — build the date and check `dt.get_month() == month` |
| `from_epoch_milliseconds(millis)` · `to_epoch_milliseconds(dt) -> int` | epoch round-trip |
| `get_year/get_month/get_day_of_month/get_day_of_week(dt) -> int` | `get_day_of_week`: Monday == 1 |
| `get_hour/get_minute/get_second/get_millisecond(dt) -> int` | components |
| `add_milliseconds(dt, millis)` · `subtract_milliseconds(dt, millis)` · `duration_milliseconds(a, b) -> int` | the raw builtin (`subtract` negates the amount, TS `subtractMilliseconds`): `duration` returns **a − b** (the expression METHOD `a.duration_milliseconds(b)` is the TS method, `b − a`) |
| `add_/subtract_{seconds,minutes,hours,days,weeks}(dt, n)` | unit sugar over `add_milliseconds` (an int or float `n`; an expression `n` scales inside the body, a Float after scaling) |
| `duration_{seconds,minutes,hours,days,weeks}(a, b) -> float` | unit sugar over `duration_milliseconds` |
| `print_formatted(dt, fmt) -> str` · `parse_formatted(s, fmt) -> datetime` | Day.js-style tokens (TS names; `print_format`/`parse_format` are deprecated spellings) |
| stdlib: `round_down_/round_up_/round_nearest_{millisecond,second,minute,hour,day,week}(dt, step)` | `step` units of the name; weeks align to Mondays (the reference Monday 1969-12-29) |
| stdlib: `round_down_month(dt, step)` · `round_down_year(dt, step)` | the first instant of the `step`-aligned month / year |

**`East.Boolean`**

| Signature | Notes |
|-----------|-------|
| `not_(x)` · `bit_and(a, b)` · `bit_or(a, b)` · `bit_xor(a, b)` | the BooleanNot / BooleanAnd / BooleanOr / BooleanXor builtins under the TypeScript names (`not`, `bitAnd`, `bitOr`, `bitXor`; `and_`/`or_`/`xor` are deprecated spellings) — both operands are values here, so there is nothing to short-circuit; the expression twins are `.not_()`, `.bit_and`, `.bit_or`, `.bit_xor`, and the short-circuit `.and_(fn(b))`/`.or_(fn(b))` take bodies |

**`East`** comparisons (East total order; element type `T` first): `compare(T, a, b) -> int`,
`equal/not_equal/less/less_equal/greater/greater_equal(T, a, b) -> bool`, and `is_(T, a, b) -> bool` (East `Is`: identity for a mutable container, value otherwise).

**`East`** structural diff/patch (any East type `T`; a patch is a value of `PatchType(T)`; every
function takes `T` explicitly — a type sampled from one value cannot describe both sides of a
variant diff):

| Signature | Notes |
|-----------|-------|
| `diff(T, before, after) -> patch` | The patch turning `before` into `after` |
| `apply_patch(T, value, patch) -> value` | Apply; `apply_patch(T, v, diff(T, v, w)) == w` |
| `compose_patch(T, first, second) -> patch` | One patch equal to applying `first` then `second` |
| `invert_patch(T, patch) -> patch` | The undo: applying patch then its inverse round-trips |

## DateTime format codes

`print_formatted(dt, fmt)` / `parse_formatted(s, fmt)` take a Day.js-style string; tokens match
greedily (longest-first), anything else is a literal, and `\` escapes the next char.
Examples for `2025-03-05 14:09:07.123` (a Wednesday):

| Code | Meaning | Ex | Code | Meaning | Ex |
|------|---------|----|------|---------|----|
| `YYYY` | 4-digit year | `2025` | `YY` | 2-digit year | `25` |
| `MMMM` | full month | `March` | `MMM` | short month | `Mar` |
| `MM` | month 01-12 | `03` | `M` | month 1-12 | `3` |
| `DD` | day 01-31 | `05` | `D` | day 1-31 | `5` |
| `dddd` | full weekday | `Wednesday` | `ddd` | short weekday | `Wed` |
| `dd` | min weekday | `We` | `HH` | hour 00-23 | `14` |
| `H` | hour 0-23 | `14` | `hh` | hour 01-12 | `02` |
| `h` | hour 1-12 | `2` | `mm` | minute 00-59 | `09` |
| `m` | minute 0-59 | `9` | `ss` | second 00-59 | `07` |
| `s` | second 0-59 | `7` | `SSS` | millisecond | `123` |
| `A` | AM/PM | `PM` | `a` | am/pm | `pm` |

```python
East.DateTime.print_formatted(dt, "YYYY-MM-DD HH:mm:ss.SSS")    # '2025-03-05 14:09:07.123'
East.DateTime.print_formatted(dt, "dddd, MMMM D, YYYY h:mm A")  # 'Wednesday, March 5, 2025 2:09 PM'
```
