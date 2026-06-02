# East collections: B-tree representation + full Python delegation

**Status:** proposal / design. Spans **east-c** (the value representation) and
**east-py** (how Python holds collection values). No wire-format change.

**One-line:** make east-c `Set`/`Dict` ordered **B-trees** (matching the TypeScript
reference, which already is one), which makes incremental upsert O(log n) instead
of O(n), which in turn lets east-py drop its Python-side collection stores and hold
**every** collection as a thin C-backed proxy — removing the "half Python / half
east-c" split and the bug class that lives on its seam.

---

## 0. The two questions this design answers

**Q1 — Set, or Set *and* Dict?**
**Both.** They share the identical flat-array representation and the identical O(n)
insert, and the workload that motivates the change (interleaved upsert) hits Dict
*harder* than Set. They should share one ordered B-tree implementation: a `Dict` is
a B-tree of `key → value`, a `Set` is the same tree carrying keys only (degenerate
value). `Array` is **not** affected (it is positional, already amortized-O(1) append).
`Vector`/`Matrix` are **not** affected (numpy buffers, already shared with east-c).

**Q2 — Does this let us fully delegate east-py collections to C and end the half-and-half?**
**Yes — that is the point.** The Python-side store exists for exactly one reason:
incremental building on a bare value, because the *current* C representation makes
per-element insertion O(n) (and per-op marshalling O(n²)). A B-tree removes that
reason: a C-backed proxy can do O(log n) in-place `insert`/`get`/`update`. Once that
is true, a freshly constructed east-py `Set`/`Dict` can be a **proxy from birth** with
no Python store — one representation everywhere. That deletes the seam (see §1.3) and
its bugs (e.g. `union_in_place`). `Array` can follow (lower priority — it has no O(n²)
problem); `Vector`/`Matrix` are already effectively C-shared via numpy.

---

## 1. Background

### 1.1 How east-c stores Set/Dict today — a sorted flat array

`libs/east-c/.../include/east/values.h`: a `set` is `{EastValue **items; size_t len;
size_t cap; EastType *elem_type}` and a `dict` is `{keys[]; values[]; len; cap; …}`.
The elements/keys are kept **sorted by East total order** in a single contiguous
buffer. `east_set_insert` (`values.c:389`) binary-searches the insertion point
(`sorted_search`, `values.c:369`) then `memmove`s the tail to make room — **O(n) per
single insert**. Dict insert is the same.

This is a deliberately **read-optimized** layout: O(log n) cache-friendly binary-search
membership, contiguous iteration, trivial serialization, and (potentially) a two-pointer
linear merge for set algebra. Its weakness is single-element insertion.

### 1.2 How east-py holds collections today — two representations

- **C-backed proxy** (`EastArrayProxy`/`EastSetProxy`/`EastDictProxy` in
  `east/_eastc_bridge.pyx`): a thin shell over a pointer to a live east-c value.
  Every op routes to C (`_proxy_set_add` → `east_set_insert`, etc.). This is what
  East hands a platform function, and what every eager method returns. *Shares east-c
  memory.*
- **Bare Python value** (`EastArray` subclasses `list`; `EastSet`/`EastDict` wrap
  `sortedcontainers.SortedSet`/`SortedDict` keyed by `make_east_key`): a value you
  construct in Python. Element ops run on the Python store; **algorithms** marshal
  the store into a temporary C value and call the builtin. *Python memory until it
  first crosses into east-c.*

The Python store is there because `sortedcontainers` gives ~O(√n) incremental insert,
whereas delegating each `add` through `_call_builtin` would marshal the **whole**
container per call (O(n²)), and even a per-element C insert into the flat array is O(n).

### 1.3 The seam, and the bug it breeds

Two representations means in-place, void-returning builtins only "land" when the
receiver is C-backed. `EastSet.union_in_place` delegated `SetUnionInPlace(self, …) →
Null`; on a **bare** set `_call_builtin` marshalled a throwaway copy, mutated it, and
discarded it — a silent no-op (fixed in `38eac45f` by branching on `_data is None`).
That entire bug class exists *only because there are two representations.* Unifying on
one (Q2) deletes it.

### 1.4 The workload that breaks the flat array — interleaved upsert

The dominant way real East programs build a Dict/Set is **derive-and-insert with a
read in the middle** — group-by / aggregate / dedup:

```
m = new Map()
for event:
    if m.has(key):  m.update(key, merge(m.get(key), event))   // READ then WRITE
    else:           m.insert(key, seed(event))                // INSERT
use(m)
```

Real example — `east-twe/src/transformation/snapshot.ts:314`:

```typescript
$.if(snapshot.has(key).not(), $ => {
    $(snapshot.insert(key, { …seed… }));        // first event for this key
}).else($ => {
    const curr = $.let(snapshot.get(key));       // read current
    /* per-field: sum kl, MIN chill, LAST set_temp, OR air, count n_events … */
    $(snapshot.update(key, { …merged… }));        // write merged back
});
```

This is **interleaved**: the loop queries the growing map every iteration to decide
insert-vs-merge. On the flat array each `insert` is an O(n) shift → building a K-key
map is **O(K²)**. The "builder trick" (append unsorted, sort once at the end) **cannot
apply** — a mid-loop `has`/`get` needs the structure sorted *now*. `snapshot.ts` is
saturated with this pattern; it is how developers naturally aggregate, and for complex
per-field merges a hand-rolled loop is clearer than any single fold. So this is the
common case, not a corner.

### 1.5 The reference backend already solved this

`libs/east/src/containers/sortedmap.ts:12` — *"A sorted map implementation using a
**B-tree** data structure"* — and `sortedset.ts:15` likewise. The TypeScript reference
runtime, which defines canonical East semantics, gives O(log n) `insert`/`get`/`has`.
**east-c's flat array is the outlier.** Moving east-c to a B-tree *converges* the
backends on the representation the language was designed around; it does not invent a
new one.

---

## 2. east-c changes

### 2.1 Decision: an ordered B-tree (not red-black, not skip-list, not hash)

- **B-tree** (wide, contiguous nodes — fanout ~16–64 keys/node) keeps O(log n) ordered
  ops while preserving cache locality far better than a pointer-per-element binary tree
  or a skip-list's tower nodes — directly addressing the only real downside of leaving
  the flat array.
- **Ordered** (by `east_value_compare`) — required: East collections must iterate and
  serialize in canonical total order across backends. A hash map cannot give that.
- Same comparator (`east_value_compare`, `values.c`) at every node → the tree's
  **in-order traversal is exactly the canonical sorted order, by construction.** This
  is the load-bearing invariant that keeps the wire format unchanged (§2.3).

### 2.2 Node layout

A `set`/`dict` value's union member becomes a handle to a B-tree:

```c
struct {
    BTreeNode *root;     // NULL == empty
    size_t     len;      // element/entry count (kept for O(1) size)
    EastType  *elem_type;            // set
    // dict: EastType *key_type, *val_type;
} set / dict;

struct BTreeNode {
    uint16_t   n;                    // keys in this node
    bool       leaf;
    EastValue *keys[FANOUT];         // (set) / dict: keys[] + values[]
    BTreeNode *child[FANOUT + 1];    // internal nodes only
};
```

`Array`'s `{items; len; cap}` is unchanged. `len` on the tree handle preserves O(1)
`Size`/`length`.

### 2.3 The invariant that keeps the wire format byte-identical

**No serialization format changes.** beast/beast2/JSON/East-text/CSV all emit a Set/Dict
as a *sorted sequence* of elements. Today they `memcpy`-walk `items[0..len)`; with a
B-tree they do an **in-order traversal**, which yields the same elements in the same
order (because the tree is ordered by `east_value_compare`). So:

- The bytes on the wire are identical → content-addressed caching and cross-backend
  equality are preserved.
- Decoders already build by repeated insert (`beast.c:820`, `json.c:~1909`), so they
  need no format change — and they get **faster** (O(n²) → O(n log n), §2.4 item 5).

The tree is purely an **in-memory** representation. The serialized form stays a sorted
array.

### 2.4 Per-subsystem impact (the seven readers of the flat array)

1. **Membership / get** (`east_set_has`, `east_dict_get`, `sorted_search`): binary
   search → B-tree descent. Same O(log n) *comparisons*; with wide nodes, comparable
   locality. Rewrite the 4 call sites against the node API.
2. **Insert / upsert** (`east_set_insert`, `east_dict_set`): O(n) memmove → **O(log n)
   node insert + split**. *This is the win* — the §1.4 build goes O(K²) → O(K log K).
3. **Set algebra** (`set_ops.c`: union/intersect/diff/sym_diff/subset/disjoint): today
   these are `iterate a; east_set_has(b, …); east_set_insert(result, …)` (`set_ops.c:123-186`),
   i.e. O(n log m) with O(n²) `union`. They become tree-merge: in-order-walk both,
   merge into a fresh tree. Honest cost: a B-tree forfeits the *potential* O(n+m)
   two-pointer array merge (which is not currently implemented anyway). Net vs today:
   roughly neutral-to-better; vs the array's theoretical best: worse.
4. **Serializers** (beast `660/673`, beast2 `value_table.c:270/283`, JSON `277`,
   East-text `434`, CSV `175`): contiguous walk → in-order traversal. Mechanical;
   wire output unchanged (§2.3).
5. **Wire decode** (`beast.c:820`, `json.c`): already per-element insert → today O(n²),
   **becomes O(n log n)** — a straight win on every deserialize.
6. **GC** (`gc.c:139` `gc_traverse`, `gc.c:208` `gc_destroy_contents`, release at
   `values.c:836`): scanning one flat `items[]` becomes traversing tree nodes, and the
   **nodes themselves are heap allocations the GC must track and free.** *Highest-risk
   change* — novel pointer topology in the cycle collector is exactly where the prior
   "e3 reactive orphan" / function-body GC bugs lived. Must be designed first and
   fuzzed hard.
7. **Iteration builtins** (~60 `Map`/`Filter`/`Reduce`/`ForEach`/`FirstMap`/`GroupFold`
   across `set_ops.c`/`dict_ops.c`): `items[i]` indexing → an in-order cursor. Broad but
   mechanical. The `iter_lock` mutation guard (`set_ops.c:32`) adapts from index-stability
   to cursor-invalidation.

### 2.5 Cross-backend correctness

The tree is ordered by the *same* `east_value_compare` (incl. `-0 < +0`, NaN-greatest,
kind-rank at `values.c:1056`). In-order traversal therefore reproduces the exact total
order the wire format and equality already assume. This must be asserted in the
compliance suite (the existing 1461-test core suite replays IR and checks ordering +
byte-identical serialization), and ideally property-tested: *for random inserts in any
order, traversal order == sorted(values, east_value_compare)*.

### 2.6 What is explicitly out of scope here

- **Persistence / structural sharing.** This design proposes an **in-place, mutable**
  B-tree (matches the in-place `$.let(new Map())` workload of §1.4). It does *not* give
  cheap O(log n) copy-on-write for "keep the old version" updates (pattern 2 / e3
  content-addressed snapshots). If/when that workload is real, a *persistent* B-tree
  is a follow-on (the node layout above is compatible with later path-copying). Noted,
  not built.

---

## 3. east-py changes — full delegation (the half-and-half goes away)

### 3.1 Why the Python store can now be removed

It existed solely to make incremental building cheap on a bare value (§1.2). With an
east-c B-tree, a C-backed proxy does `add`/`insert`/`update`/`get`/`has` in O(log n)
directly on the live value. The Python `sortedcontainers` store is no longer buying
anything the C value can't.

### 3.2 The change

- `EastSet` / `EastDict` constructed in Python allocate a **live east-c B-tree** and
  return a **proxy** (the existing `EastSetProxy`/`EastDictProxy` become the *only*
  representation; the `SortedSet`/`SortedDict`-backed bare classes are removed).
- All element ops route to C (`_proxy_set_add`, `_proxy_dict_set`, …) — already written.
- The bare-vs-proxy branching disappears: no `_data is None` checks, no marshal-on-first-
  use, no `_ev`-deferred validation seam. **One representation.** The `union_in_place`
  class of bug is structurally impossible.
- `array(T, items)` / `EastSet(T, items)` / `EastDict(K, V, items)` bulk-build the tree
  in C in one pass (sort-and-bulk-load, O(n log n)) rather than per-element from Python.

### 3.3 The cost: per-op FFI

Each `s.add(x)` is now one Python→C call (marshal one element + a C B-tree insert)
rather than a pure-Python `SortedSet.add`. FFI overhead is ~tens of ns/op. Trade-off:

- **Large / interleaved-upsert collections** (the §1.4 workload): O(log n) C insert
  dominates the FFI constant; *vastly* faster than today's O(n²) bare path and faster
  than the Python store.
- **Tiny collections / never-crossed scratch**: FFI overhead is a small constant tax
  vs pure Python. Acceptable — and the correctness/uniformity win (one representation,
  shared memory, no seam) is worth it. (If a hot tiny-collection path ever shows up,
  a small-inline optimization in east-c — §5 — absorbs it.)

### 3.4 Array, Vector, Matrix

- **Array**: east-c arrays are already amortized-O(1) append, so there is no O(n²)
  problem to fix; delegation here is *optional* and lower priority. Keeping `EastArray`
  as a `list` subclass retains the full native Python sequence API for free. Recommend:
  delegate later, for uniformity, only once Set/Dict have proven the path.
- **Vector / Matrix**: already a numpy buffer shared with east-c via `.data` (the bridge
  canonicalizes dtype at the boundary). No change.

### 3.5 Lifetime

Proxies already do `_proxy_retain` / `_proxy_type_retain` / `__del__` → `_proxy_release`.
Making *every* constructed Set/Dict a proxy extends that discipline to all of them; the
interplay with east-c's GC (which now also owns B-tree nodes) is the thing to validate
(refcount + cycle-collector cooperation), and is the east-py-side mirror of §2.4-6.

### 3.6 What gets deleted

The `sortedcontainers` import and the `SortedSet`/`SortedDict` stores; the bare-class
element-op implementations; the `is None`-branching in mutators; the bare↔proxy
marshalling discrepancy. `collections.py` shrinks; the [memory-model two-forms
distinction](#) collapses to one form.

---

## 4. Sequencing

1. **east-c B-tree for Set + Dict** behind the unchanged value API and unchanged wire
   format. Gate: full core compliance (1461) including byte-identical serialization +
   ordering property tests; GC fuzzing.
2. **east-py delegation**: Set/Dict construct as proxies; remove the Python stores and
   the seam. Gate: east-py core suite + downstream (std/io/datascience) green; the
   `union_in_place`-class tests become trivially satisfied.
3. **(optional) Array delegation** for full uniformity.

Each phase is independently shippable and revertible; phase 1 stands alone as an east-c
performance fix even if phase 2 is deferred.

---

## 5. Open questions

- **B-tree fanout / node size** — tune for the cache line and the typical key (struct
  keys like `{day}` vs scalar keys). Bench against real `snapshot.ts`-shaped workloads.
- **Small-collection inline** — keep a tiny set/dict (≤ N) as an inline sorted array
  inside the value, promoting to a tree only past a threshold, to erase FFI/allocation
  overhead for the common small case (§3.3). This preserves the array's wins where they
  matter and the tree's where they matter.
- **Persistent variant** (§2.6) — if e3 content-addressing wants cheap immutable
  "with-one-more-element" snapshots (pattern 2), design path-copying on this node layout.
- **Set-algebra** — decide whether to invest in a good B-tree bulk-merge, or to keep the
  array form *only* as a transient for union/intersect (build tree → flatten → merge →
  rebuild). Measure before optimizing.

---

## 6. Summary

- **Q1: Set and Dict** become one shared ordered **B-tree** in east-c. Array stays
  positional; Vector/Matrix stay numpy.
- **Q2: Yes** — the B-tree is precisely what unblocks **full delegation**: east-py
  Set/Dict become C-backed proxies from construction, ending the half-Python/half-C
  split and deleting the seam-bug class.
- The change **aligns east-c with the TS reference** (already a B-tree), keeps the wire
  format **byte-identical**, turns the dominant interleaved-upsert workload from O(n²)
  into O(n log n), and makes deserialization faster as a bonus. The real costs are the
  GC node-ownership rewrite (highest risk), the breadth of iteration-builtin edits, and
  per-op FFI on tiny collections — all bounded, and addressed by phasing + an optional
  small-inline optimization.

---

## 7. Implementation handover (start here)

A fresh implementer should read this section, then §1–§2, then the TS reference below,
before touching code.

### 7.1 Read first — port, don't invent

The algorithm already exists, twice. **Port the TypeScript reference B-tree to C:**
- `libs/east/src/containers/sortedmap.ts` — the canonical ordered map B-tree (insert,
  get, delete, split/merge, iteration). This is the spec.
- `libs/east/src/containers/sortedset.ts` — the set form.
- `east-py`'s current `sortedcontainers` usage and the TS `*.spec.ts` files show the
  expected behaviour and edge cases.

Your C B-tree must order by `east_value_compare` (`libs/east-c/.../src/values.c`,
incl. `-0 < +0`, NaN-greatest, kind-rank at `values.c:1056`). Verify in-order traversal
== `sorted(values, east_value_compare)` as a property test.

### 7.2 Build / test / leak loop

east-py builds east-c via `add_subdirectory` of the monorepo `libs/east-c` directly
(the `_vendor/` copy is only for packaged wheels — ignore it in dev). So the loop is:

```bash
# 1. east-c on its own (fast inner loop)
cd libs/east-c && make test            # test-east-c + test-east-c-std (compliance)
cd libs/east-c && make leak-check      # VALGRIND — mandatory for the GC/node work
# 2. rebuild east-py against the changed east-c + bridge, then gate
cd libs/east-py && make reinstall-east-py   # rebuilds Cython exts + relinks east-c
cd libs/east-py && make test-east-py        # the 1461-test core compliance suite
# 3. cross-backend wire/ordering must stay byte-identical
cd libs/east-py && make test-east-py-std    # (needs IR fixtures: cd libs/east-node && make test-export-std; see §7.6)
```

`make reinstall-east-py` is **required** after any change to the value
representation/package structure — the scikit-build editable install hardcodes a
module→file map that goes stale otherwise (this is why a plain rebuild can fail to pick
up new/renamed modules).

### 7.3 east-c files to change (the seven readers — §2.4)

| Concern | File(s) |
|---|---|
| value struct (set/dict union member) | `libs/east-c/.../include/east/values.h` (~line 45-75) |
| insert / get / has / `sorted_search` | `src/values.c` (`east_set_insert` 389, `east_dict_set` ~530, `sorted_search` 369, `east_set_has` 419, `east_dict_get` 549) |
| set algebra | `src/builtins/set_ops.c` (`set_union_impl` 123 …) |
| dict ops + iteration | `src/builtins/dict_ops.c` |
| serializers (emit in-order; wire unchanged) | `src/serialization/beast.c` (660/673), `serialization/value_table.c` (270/283), `json.c` (277), `east_printer.c` (434), `csv.c` (175) |
| **GC (highest risk)** | `src/gc.c` (`gc_traverse` 139, `gc_destroy_contents` 208) + release at `values.c:836` |
| equality / compare | `src/values.c` (`east_value_equal` 941, `east_value_compare` 1135) |

### 7.4 east-py bridge surface (for phase 2)

To expose new/changed east-c functions to Python and route proxy ops:
- `east/_eastc.pxd` — Cython declarations of the east-c functions (add any new B-tree
  entry points here).
- `east/_eastc_bridge.pyx` — `py_value_to_c` / `c_to_py` marshalling; the proxy classes
  `EastSetProxy` (~1501), `EastDictProxy` (~1564); the per-op shims `_proxy_set_add`
  (1285), `_proxy_dict_set` (1322); `c_to_py` builds proxies (set proxy at ~529).
- Phase-2 work: make `EastSet`/`EastDict` *construct* a live C value and return a proxy
  (remove the `sortedcontainers`-backed bare classes in
  `east/types/values/collections.py`); bulk-build path in `array()`/`EastSet(…items)`.
- **Note the recent refactor:** `east/types/values.py` is now a **package**
  (`east/types/values/{_helpers,primitives,structural,collections,tensor,guards,validation}.py`,
  re-exported by `__init__.py`). `collections.py` holds `EastArray/EastSet/EastDict`.

### 7.5 Invariants you must NOT break

- **Wire format is byte-identical.** The tree is in-memory only; every serializer still
  emits a sorted sequence. Two equal collections must serialize identically across
  TS/Python/C (content-addressing depends on it).
- **Value API signatures** (the builtins, the east-py public surface incl. private
  `_call_builtin`/`_key_cache`/`_intern_keys`) stay the same.
- **East total order** is the single comparator everywhere (`east_value_compare`).
- The `union_in_place` seam fix (`east/types/values/collections.py`, commit `38eac45f`)
  is the worked example of the bug class phase 2 eliminates — read it to understand the
  seam you're removing.

### 7.6 Gates that must stay green

- `libs/east-c`: `make test` + `make leak-check` (no valgrind regressions — the GC work
  *will* surface leaks/double-frees here first).
- `libs/east-py`: `make test-east-py` (1461/1461), `make test-east-py-std` (119),
  `make test-east-py-io` (227, needs services + `cd libs/east-node && make test-export-io`),
  `make test-east-py-datascience` (375). For std/io the IR fixtures come from
  `cd libs/east-node && make test-export-{std,io}` (note the `/tmp` → `$TMPDIR` path
  quirk: copy the exported dir to `$TMPDIR/east-node-*` if the test can't find it).
- `make lint` + `make typecheck` clean.

### 7.7 Suggested order of operations

1. **Vertical slice, east-c only:** implement the B-tree + `east_set_insert`/`has`/`get`
   on it, with a temporary `to_flat`/`from_flat` adapter so the *other* six subsystems
   keep reading a flat array (build tree → flatten for serialize/GC/iterate). Get
   `make test` + `make leak-check` green. This proves the node algorithm + ordering in
   isolation.
2. Migrate serializers + iteration to in-order traversal (drop the adapter); re-gate +
   leak-check. Property-test traversal-order == compare-order.
3. Migrate GC to own/free nodes (the risk step — fuzz + valgrind hard).
4. Migrate set algebra to tree-merge.
5. **Phase 2 (east-py):** flip `EastSet`/`EastDict` construction to proxies, delete the
   Python stores, re-gate the full east-py + downstream suites. The `union_in_place`
   branch and the bare-vs-proxy logic in `collections.py` get deleted here.
6. **Phase 3 (optional):** Array delegation; small-inline optimization (§5).

### 7.8 Context pointers

- This design + its rationale live in this file; the **two-forms memory model** and the
  full reasoning are in the conversation that produced it (the bare-vs-proxy distinction,
  the O(n²) interleaved-upsert analysis grounded in `east-twe/src/transformation/snapshot.ts`).
- The motivating workload is `snapshot.ts`-shaped group-by/upsert (§1.4) — use it (or a
  synthetic K-key aggregation loop) as the performance benchmark to prove O(K²) → O(K log K).
- Current branch: `east-py-value-production` (the values.py→package refactor + the
  `union_in_place` fix are already there; PR #15).
