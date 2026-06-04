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
  `sortedcontainers.SortedSet`/`SortedDict` keyed by `_make_east_key`): a value you
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
new one. (One caveat that reshapes scope, expanded in §2.2/§7.1: those TS files are thin
adapters over the npm `sorted-btree` package — the B-tree is a *vendored dependency*, not
in-house East code, so there is nothing to "port" and the real choice is leverage-a-C-lib
vs hand-roll.)

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

### 2.2 Build vs leverage — and why the node layout is *gated*

**There is no in-house B-tree to port.** The earlier draft of §7.1 said "the algorithm
already exists, twice — port the TS reference." That is **false** and must not anchor the
work: `libs/east/src/containers/sortedmap.ts:5` and `sortedset.ts:5` both
`import sorted_btree from "sorted-btree"` — they are ~200-line *adapters* over the
third-party npm **`sorted-btree`** B+tree (v1.8.1 per `libs/east/package.json`, MIT, default
node size 32). The Python
side wraps `sortedcontainers` (a different third-party lib, not even a B-tree). **Zero**
split/merge/rebalance code lives in this repo. So the real choice is **leverage a C
library, port `sorted-btree` TS→C, or hand-roll** — and an adversarial survey scored the
candidates against the constraints that actually bind here (items are refcounted
`EastValue*`; comparator is `east_value_compare`; nodes must route through
`east_alloc`/`east_free`; the cycle collector must traverse + release children on *two*
death paths; no thread machinery; sorted bulk-load; vendorable license).

**Result — a genuinely close two-horse race:**

| Option | Allocator fit | GC fit | Cost / catch |
|---|---|---|---|
| **`tidwall/btree.c`** (leverage, MIT, single file) | drop-in *today* (arena is malloc-passthrough); `btree_new_with_allocator` routes nodes through our hooks | **its strongest axis** — `btree_ascend` = alloc-free O(n) traverse; `item_free = east_value_release` serves *both* death paths + overwrite/delete | 2 shims: size-prefix alloc wrapper (forward-arena), `-DBTREE_NOATOMICS`. `btree_load` is per-item-append, not one-shot |
| **Hand-roll** (we own the node struct) | **best possible** — calls 3-arg `east_realloc(ptr, old, new)` with the true `old_size`, so it's *future-arena-ready* (the arena is malloc today, §C3), no wrapper | **best possible** — direct node descent in `gc_traverse`; exact dual-death-path nulling | ~550 LOC incl. CLRS delete-borrow (the correctness minefield) + refcount-across-moves; fuzz under ASan |
| Port `sorted-btree` TS→C | by labor | by labor | ~1.7k LOC; buys only COW (§2.6), which we don't need yet |
| klib / libdict / sglib / tommyds | global or intrusive alloc (fork) | no/weak destructor; clashes with parallel-array Dict | port-required, not leverage |

**The prize, either way:** there is no rebalance code to "port." Leverage `tidwall` and you
never write split/merge/delete-borrow; hand-roll and that ~250 LOC *is* the cost of owning it.

**Reject the `sorted-btree` port:** it buys *structural* parity, and cross-backend
correctness needs only *order* parity (the comparator) + the flat sorted-array wire form
(§2.3) — the tree is invisible across the wire. Take it only if a persistent/COW East value
(§2.6) ever becomes the deciding factor; that is the one thing it has built in.

> **The `tidwall/btree.c` specifics below are from the survey, not yet verified against
> vendored source** (nothing `tidwall` is in this tree). Treat these as claims the gate
> confirms, not settled facts: `btree_new_with_allocator` routing nodes through our hooks;
> `item_free` firing on *every* teardown (free/clear/overwrite/delete) so one hook serves both
> death paths; `btree_ascend` being an alloc-free O(n) walk; `btree_load`'s append-if-greater
> semantics; the `-DBTREE_NOATOMICS` macro and its effect; `btree_clone`'s COW + the
> `item_clone` requirement. The `item_free`-serves-both-death-paths and `btree_load` claims are
> the load-bearing ones — the whole leverage case rests on them.

**The gate (decide here, before committing either path).** Vendor `tidwall/btree.c`,
compile it **`-DBTREE_NOATOMICS`** inside east-c (it otherwise pulls `stdatomic.h` for COW
refcounting — disallowed in the tree), confirm it links clean, **read the source to confirm the
six specifics above**, and bench `btree_load`-in-a-loop on the *real* sorted/dedup'd streams
(set-algebra merge output, canonical wire decode, Python bulk build). If all hold → **leverage**,
skip rebalance entirely. If any disappoints (atomics entangled, `item_free` doesn't cover a
teardown path, or per-item load too slow) → **hand-roll**; you wanted native arena-readiness and
a one-shot bulk-loader anyway. Everything in §2.4 below is **node-agnostic** — it is the same
diff regardless of which path the gate picks.

**Node layout — only authored under the hand-roll branch:**

```c
struct {
    BTreeNode *root;     // NULL == empty
    size_t     len;      // element/entry count (kept for O(1) size)
    EastType  *elem_type;            // set
    // dict: EastType *key_type, *val_type;
} set / dict;

// Split leaf vs internal: most nodes in a B-tree ARE leaves, so keeping child[]
// out of them saves (FANOUT+1) pointers per leaf — material at fanout 32–64.
struct BTreeLeaf {
    uint16_t   n;
    bool       leaf;                 // == true
    EastValue *keys[FANOUT];         // set; dict adds values[FANOUT] in lockstep
    // dict: EastValue *values[FANOUT];   // PARALLEL arrays — mirrors the existing
                                     // Dict {keys[]; values[]} shape so compare/wire
                                     // code (east_value_compare @values.c:1078, the
                                     // serializers) stays lockstep
};
struct BTreeInternal {
    uint16_t   n;
    bool       leaf;                 // == false
    EastValue *keys[FANOUT];         // dict: + values[FANOUT]
    BTreeNode *child[FANOUT + 1];
};
```

`keys[]`/`values[]` are arrays of `EastValue*` (8-byte pointers, exactly like today's
`items[]`); the pointee never moves, so rebalance `memmove`s of pointer slots are safe and
refcount-neutral. Honest memory note: a tree replaces the single `items[]` buffer (8·n bytes)
with ~`2n/FANOUT` half-full nodes — structural overhead is several× the flat array; the
small-collection inline (§5) is what claws that back for the common small case.

`Array`'s `{items; len; cap}` is unchanged. `len` on the tree handle preserves O(1)
`Size`/`length`.

**If leveraged (`tidwall`) instead:** there is *no* node layout to design — the tree is
opaque. The east-c-side work becomes (a) the two shims, (b) wiring `item_free =
east_value_release` (releases key *and* value for dict) into both teardown sites, (c)
`btree_ascend` for `gc_traverse`, (d) `btree_load` for the bulk paths. Set item = `EastValue*`
(elsize 8); dict item = a packed `struct { EastValue *key, *val; }` (elsize 16) ordered by
key — note this *changes* the Dict's parallel-array shape to interleaved, so the serializers
and compare path must read the element through an accessor, not `keys[i]`/`values[i]` directly.

### 2.3 The invariant that keeps the wire format byte-identical

**No serialization format changes.** beast/beast2/JSON/East-text/CSV all emit a Set/Dict
as a *sorted sequence* of elements. Today they `memcpy`-walk `items[0..len)`; with a
B-tree they do an **in-order traversal**, which yields the same elements in the same
order (because the tree is ordered by `east_value_compare`). So:

- The bytes on the wire are identical → content-addressed caching and cross-backend
  equality are preserved.
- Decoders already build by repeated insert (`beast.c:820`, `json.c` dict-insert `~1218`), so they
  need no format change — and they get **faster** (§2.4 item 5). With a bulk-loader the
  *binary canonical* formats (beast/beast2), whose stream is already sorted and dedup'd,
  decode in **O(n)** (fill leaves left-to-right, build the spine, validate adjacent order
  as you go). Hand-authorable *text* formats (JSON/CSV/East-text) are not guaranteed sorted,
  so they stay O(n log n) via sort-then-bulk-load (or repeated insert). The doc's earlier
  blanket "O(n²) → O(n log n)" undersold the binary path.

The tree is purely an **in-memory** representation. The serialized form stays a sorted
array.

### 2.4 Per-subsystem impact (the seven readers of the flat array)

1. **Membership / get** (`east_set_has`, `east_dict_get`, `sorted_search`): binary
   search → B-tree descent. Same O(log n) *comparisons*; with wide nodes, comparable
   locality. Rewrite the 4 call sites against the node API.
2. **Insert / upsert** (`east_set_insert`, `east_dict_set`): O(n) memmove → **O(log n)
   node insert + split**. *This is the win* — the §1.4 build goes O(K²) → O(K log K).
3. **Set algebra** (`set_ops.c`: union/intersect/diff/sym_diff/subset/disjoint): today
   every op **builds its result via repeated `east_set_insert`** into a fresh set
   (`set_ops.c:123-173`) — and since each insert is an O(result) memmove, `union` is
   actually **O((n+m)²)**, intersect/diff are O(n·(log m + result)). The previous draft said
   "B-tree forfeits the O(n+m) two-pointer merge … worse vs the array's theoretical best."
   **That is wrong, and it inverts the conclusion.** With a **bulk-loader** (§2.2/§C6) the
   right shape is: *dual in-order cursor over both trees → a single sorted/dedup'd merged
   stream → bulk-load a fresh tree in O(n+m)*. That **equals** the array's theoretical best,
   not worse — the only thing that would lose the O(n+m) is naïve per-element insert into the
   result (O(k log k)), which the design explicitly forbids for algebra. Refinements the doc
   must state: (a) **skew-aware intersect/diff** — when `n ≪ m`, probe the smaller tree into
   the larger (O(n log m)) instead of a full O(n+m) merge; (b) **pure vs in-place are
   different ops** — pure `union` bulk-loads a fresh tree (inputs untouched, value semantics),
   while `union_in_place` inserts each element of `b` into `a` (O(m·log(n+m)), mutating `a`);
   the current code conflates them. subset/disjoint stay O(min)-ish early-exit cursor walks.
4. **Serializers** (beast `660/673`, beast2 `value_table.c:270/283`, JSON `277`,
   East-text `434`, CSV `175`): contiguous walk → in-order traversal. Mechanical;
   wire output unchanged (§2.3).
5. **Wire decode** (`beast.c:820`, `json.c`): already per-element insert → **O(n)** for the
   binary canonical formats via bulk-load (stream already sorted), **O(n log n)** for the
   hand-authorable text formats (§2.3). A straight win on every deserialize.
6. **GC** (`gc.c:139` `gc_traverse`, `gc.c:196` `gc_destroy_contents`, and the *refcount*
   release path at `values.c:836`/`:844`). **The previous draft mis-framed this as the
   "highest-risk … novel pointer topology in the cycle collector, where the e3-reactive-orphan
   / closure GC bugs lived." That analogy is wrong and will send an implementer hunting the
   wrong failure mode.** The truth, read against `gc.c`:
   - **B-tree nodes are *not* `EastValue`s and must *never* be GC-tracked** — no
     `gc_next`/`ref_count`/`gc_gen`. They are internal structure uniquely owned by one
     container value, *exactly like today's flat `items[]` buffer*. Adding them to the
     tracking list is a category error.
   - The cycle collector sees the **identical `EastValue → EastValue` edge set**.
     `gc_traverse` simply descends node pointers (pure structure) to reach the same
     `keys[]`/`values[]` children it visits today (`gc.c:148-159`). No reachability subtlety,
     no sharing, acyclic by construction — the *opposite* of the closure case (raw
     `Environment*`, the phase-2-skip / phase-3-follow asymmetry) that bred the orphan bug.
   - **The actual risk is mundane and valgrind-shaped**, on two fronts: **(i) two death
     paths**, not one — the refcount path (`east_value_release` SET/DICT case,
     `values.c:836`/`:844`, the *common* death) **and** the cycle-collector path
     (`gc_destroy_contents`, which additionally **nulls the root** for idempotency, mirroring
     today's `items=NULL`) must *both* learn to release every child then free every node, and
     stay in sync; **(ii) OOM mid-split** — a node split that fails allocation must not leave a
     half-linked tree or a leaked node (today's `east_set_insert` just `return`s on realloc
     failure; the tree path needs an explicit unwind). Leverage (`tidwall`) collapses (i) to a
     one-line `item_free = east_value_release` hook that fires on every teardown; hand-roll
     writes a recursive `btree_destroy(root, release)` dropped into each death site. Either
     way: fuzz + valgrind, but for *memory hygiene*, not collector correctness.
7. **Iteration builtins** (~60 `Map`/`Filter`/`Reduce`/`ForEach`/`FirstMap`/`GroupFold`
   across `set_ops.c`/`dict_ops.c`): `items[i]` indexing → an in-order cursor. Broad but
   mechanical. **Cursor model — pick the path-stack cursor, not re-descend-by-key.** The
   `iter_lock` guard (`set_ops.c:32`, the `int iter_lock` on `EastValue`) already *forbids*
   mutation during East-level iteration, so a cheap path-stack cursor (node + index per level)
   is safe and gives O(n) iteration; we do not need (or want) the O(n log n) re-descend-from-root
   cursor that survives mutation. Keep `iter_lock` exactly as is — it changes meaning from
   "indices are stable" to "the parked node pointers stay valid," but the guarantee it
   enforces (no structural change mid-walk) is identical. Under leverage, `btree_ascend`'s
   internal cursor replaces the hand-written one and `iter_lock` still guards above it.

### 2.5 Cross-backend correctness

The tree is ordered by the *same* `east_value_compare` (`values.c:1078`; `-0 < +0` and
NaN-greatest in `cmp_double` @1056, cross-kind `kind_rank` @1007). In-order traversal therefore reproduces the exact total
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
  not built. **This is the one axis where the rejected options pay off:** porting
  `sorted-btree` ships freeze/COW built-in, and `tidwall/btree.c` has `btree_clone`
  (copy-on-write) — *but* under leverage that path is a refcount footgun: COW node
  materialization `memcpy`s the element, so you **must** install `item_clone =
  east_value_retain` or the shared `EastValue*` is unretained and underflows on first node
  teardown. If persistence becomes the deciding factor, re-open the build-vs-leverage gate
  (§2.2) with C8 weighted heavily; until then, in-place only.

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
- **The "all element ops already route to C" claim is only half true** — and the half that
  isn't is the whole phase-2 east-c-bridge diff. The *point* ops do route through C
  (`_proxy_set_add`→`east_set_insert`, `_proxy_dict_set`→`east_dict_set`, contains/get/remove).
  But the **iteration and clear shims dereference the flat layout directly from Cython**:
  `_proxy_set_iter` reads `s.data.set.items[i]` (`_eastc_bridge.pyx:1308`), `_proxy_dict_items`
  reads `d.data.dict.keys[i]`/`.values[i]` (`:1340-1341`), and the set-`clear` shim walks
  `s.data.set.items[i]` to release (`:1537-1539`). Those **break** under a B-tree — you cannot
  index a tree. So phase 2 is *not* "flip construction + delete stores"; it also needs **new C
  ordered-iteration/export entry points** (a cursor, or an `east_set_to_array`/`east_dict_to_arrays`
  export, or a `for_each` callback) that the shims call instead of touching internals, plus the
  `.pxd` struct mirror (`east/_eastc.pxd`) updated or *bypassed* so Cython never names the node
  layout. `_proxy_set_len`/`_proxy_dict_len` survive (the `len` stays on the handle, §2.2).
  (The `EastArray` proxy's heavy `.data.array.items[i]` use at `:1217-1279` is **fine** — Array
  is not changing, §3.4.)
- The bare-vs-proxy branching disappears: no `_data is None` checks, no marshal-on-first-
  use, no `_ev`-deferred validation seam. **One representation.** The `union_in_place`
  class of bug is structurally impossible.
- **API-parity audit before deleting the bare classes.** `EastSet`/`EastDict` currently
  *wrap* a `SortedSet`/`SortedDict` by delegation (`self._data`), and expose Python
  conveniences (set operators `&`/`|`/`-`, `__iter__`/`__contains__`/`__len__`, ordering,
  `repr`, pickling) through that delegation. The proxy must reproduce every behavior
  downstream code (std/io/datascience) actually relies on, or those break silently —
  enumerate and cover them, don't assume parity.
- `array(T, items)` / `EastSet(T, items)` / `EastDict(K, V, items)` bulk-build the tree
  in C in one pass (sort-and-bulk-load, O(n log n) — or O(n) when the caller's input is
  already sorted) rather than per-element from Python.

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
Making *every* constructed Set/Dict a proxy extends that discipline to all of them. Two
things to validate — and the first is sharper than "refcount + cycle-collector cooperation":

- **Thread-locality is a latent lifetime bomb that phase 2 *amplifies*.** The GC tracking
  lists are `_Thread_local` (`gc.c:21/30/39`), and `alloc_value` auto-tracks **every** container
  on whatever thread constructs it (`values.c:52`). `east_value_release` calls `east_gc_untrack`
  on whatever thread drops the last ref (`values.c:808`), which unlinks the node from **that
  thread's** list. So a value *constructed on thread A* but *last-released on thread B* — e.g. a
  proxy whose `__del__` runs on a different Python thread than the one that built it — unlinks
  from B's list a node that lives in A's, corrupting both. Refcounts themselves are atomic
  (`__atomic_*`, `values.c:798/805`), so this is purely a *tracking-list* hazard. Today it is
  rare because most container values are born and die inside one C evaluation; **proxy-everywhere
  makes container lifetime Python-driven for *all* Set/Dict**, multiplying the exposure. The
  design must either assert+document a **single-thread-per-value invariant** (confirm east-py
  pins east-c value work to one thread, incl. GC-triggering allocations and proxy `__del__`), or
  make GC tracking thread-aware. This is the real §3.5 risk — name it, don't let "validate the
  interplay" paper over it.
- **Refcount keeps Python-held values alive across collection.** A proxy holds a real ref
  (`_proxy_retain`→`ref_count++`), and the cycle collector seeds `gc_refs = ref_count` then only
  subtracts *internal* edges — so a Python-held value always nets `gc_refs > 0` and is rescued.
  That cooperation is correct as-is; the node-ownership change does **not** alter it (nodes
  aren't tracked — §2.4-6), so this is the east-py-side mirror of the *memory-hygiene* risk, not
  a collector-correctness one.

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

- **Build vs leverage** (the gate, §2.2) — the live decision. Compile `tidwall/btree.c`
  `-DBTREE_NOATOMICS` inside east-c and bench `btree_load` on real streams; that result picks
  leverage vs hand-roll. Confirm `sglib`'s license (LGPL would be a blocker) only if the gate
  somehow reopens the long tail.
- **B-tree fanout / node size** — the de-facto spec (`sorted-btree`, the lib the TS reference
  runs) defaults to **32** items/node (valid range 4..256); `tidwall` defaults similarly. Start
  at 32 and tune for the cache line and the typical key (struct keys like `{day}` vs scalar
  keys). Bench against real `snapshot.ts`-shaped workloads.
- **Small-collection inline** — keep a tiny set/dict (≤ N) as an inline sorted array
  inside the value, promoting to a tree only past a threshold, to erase FFI/allocation
  overhead for the common small case (§3.3). **This matters more than first credited:** a
  half-full fanout-32 node carries real slack, so a 2-entry dict in a tree node wastes most
  of it — the inline form is the antidote, and under leverage it lives *outside* the vendored
  tree (promote into `btree_*` only past the threshold).
- **Bulk-load is a shared primitive, not just an algebra concern** — the same
  sorted-stream→tree loader serves set algebra (§2.4-3), binary wire decode (§2.4-5), and
  Python bulk construction (§3.2). Build it once; it is the single most leveraged piece of new
  code (and the one `btree_load` axis where the leverage path is only *partial*, §2.2).
- **Persistent variant** (§2.6) — if e3 content-addressing wants cheap immutable
  "with-one-more-element" snapshots (pattern 2), design path-copying on this node layout
  (hand-roll) or wire `btree_clone` + `item_clone = east_value_retain` (`tidwall`).
- ~~**Set-algebra**~~ **(resolved, §2.4-3)** — dual-cursor merge → sorted stream → bulk-load,
  O(n+m); skew-aware probe when sizes are lopsided. No "array transient" rebuild needed.

---

## 6. Summary

- **Q1: Set and Dict** become one shared ordered **B-tree** in east-c. Array stays
  positional; Vector/Matrix stay numpy.
- **Q2: Yes** — the B-tree is precisely what unblocks **full delegation**: east-py
  Set/Dict become C-backed proxies from construction, ending the half-Python/half-C
  split and deleting the seam-bug class.
- The change **converges east-c with the TS reference on *ordered-tree* semantics** (the TS
  reference itself isn't an in-house B-tree — it vendors the npm `sorted-btree` B+tree; cross-
  backend correctness needs *order* parity via the comparator, not structural parity), keeps
  the wire format **byte-identical**, turns the dominant interleaved-upsert workload from O(n²)
  into O(n log n), and makes deserialization faster (O(n) binary / O(n log n) text) as a bonus.
- The real costs, corrected by the review: **(1)** the build-vs-leverage decision (§2.2) —
  `tidwall/btree.c` is the one viable leverage path (2 shims) and retires the rebalance code;
  hand-roll wins the allocator + GC axes at ~550 LOC; gate on a compile+bench check. **(2)** the
  GC work is *memory hygiene across two death paths + OOM-mid-split*, **not** the cycle-collector-
  topology risk the draft feared (nodes are never tracked; the edge set is unchanged). **(3)** the
  breadth of iteration-builtin edits + the east-py bridge's direct flat-layout dereferences
  (`_proxy_set_iter`/`_proxy_dict_items`/clear) that need new C iteration entry points. **(4)** a
  thread-locality lifetime hazard that proxy-everywhere amplifies (§3.5). **(5)** per-op FFI on
  tiny collections. All bounded, addressed by phasing + the small-inline optimization.

---

## 7. Implementation handover (start here)

A fresh implementer should read this section, then §1–§2, then the TS reference below,
before touching code.

### 7.1 Read first — decide build-vs-leverage; there is **no in-house B-tree to port**

An earlier draft said "the algorithm already exists, twice — port the TS reference." **It does
not.** `libs/east/src/containers/sortedmap.ts:5` and `sortedset.ts:5` both
`import sorted_btree from "sorted-btree"` — they are thin *adapters* over the third-party npm
**`sorted-btree`** B+tree; there is no split/merge/rebalance in this repo. The Python side
wraps `sortedcontainers`. So:

1. **First, run the gate (§2.2)** and pick *leverage `tidwall/btree.c`* vs *hand-roll*. That
   decision determines whether §2.2's node layout is yours to author at all.
2. **The "spec" is the *order*, not an algorithm.** Any comparator-correct ordered tree is
   conformant, because the wire form is a sorted array and cross-backend equality compares
   bytes — *structure is invisible across the wire*. Do **not** chase structural parity with
   `sorted-btree`.
3. Your tree (owned or vendored) must order by `east_value_compare`
   (`libs/east-c/.../src/values.c:1078`; `-0 < +0` / NaN-greatest in `cmp_double` @1056,
   cross-kind `kind_rank` @1007).
   **Property test:** in-order traversal == `sorted(values, east_value_compare)` for random
   insert orders. The TS `*.spec.ts` and `east-py`'s `sortedcontainers` usage pin the expected
   *behaviours* (duplicate-insert error, overwrite-on-`dict.set`, delete-absent, iteration order)
   — note these are enforced at east-c's **builtin** layer (`set_insert_impl` already
   `east_set_has`-checks and errors, `set_ops.c:58`), not by the tree, so they are independent of
   which path the gate picks.

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
| value struct (set/dict union member) | `libs/east-c/.../include/east/values.h` (`set`/`dict` at lines 62-75) — handle-to-tree (hand-roll) or opaque `btree*` (leverage) |
| vendored tree (leverage path only) | new `src/vendor/btree.{c,h}` + the alloc/`-DBTREE_NOATOMICS` shims + `item_free` wiring (§2.2) |
| insert / get / has / `sorted_search` | `src/values.c` (`east_set_insert` 389, `east_dict_set` **500**, `sorted_search` 369, `east_set_has` 419, `east_set_delete` 427, `east_dict_get` 549, `east_dict_delete` 566) |
| set algebra (build result via **bulk-load**, not repeated insert) | `src/builtins/set_ops.c` (`set_union_impl` 123, `set_intersect_impl` 136, `set_diff_impl` 148, `set_sym_diff_impl` 160, `set_union_in_place_impl` 112) |
| dict ops + iteration | `src/builtins/dict_ops.c` |
| serializers (emit in-order; wire unchanged) | `src/serialization/beast.c` (660/673), `serialization/beast2/value_table.c` (270/283), `json.c` (277), `east_printer.c` (434), `csv.c` (175) |
| **GC — both death paths + traverse** (memory hygiene, *not* collector topology — §2.4-6) | `src/gc.c` (`gc_traverse` 139, `gc_destroy_contents` **196**) **and the co-equal refcount path** `east_value_release` SET/DICT case at `values.c:836`/`:844` |
| equality / compare (the single total order) | `src/values.c` (`east_value_equal` 898, `east_value_compare` 1078, `kind_rank` 1007) |
| new C iteration/export entry points (for the bridge — §7.4) | `src/values.c` (cursor / `east_set_to_array` / `east_dict_to_arrays` / `for_each`) + `include/east/values.h` |

### 7.4 east-py bridge surface (for phase 2)

To expose new/changed east-c functions to Python and route proxy ops:
- `east/_eastc.pxd` — Cython declarations of the east-c functions **and the `EastValue`
  struct mirror**. The `.pxd` currently re-declares the `set`/`dict` union members (`items`,
  `keys`, `values`, `len`) so the bridge can index them; under a B-tree those members change
  (or vanish under leverage). **Update the mirror or — better — stop mirroring the node layout
  and route through the new C iteration entry points** so Cython never names a tree internal.
- `east/_eastc_bridge.pyx` — `py_value_to_c` / `c_to_py` marshalling; the proxy classes
  `EastSetProxy` (~1501), `EastDictProxy` (~1564); the per-op shims `_proxy_set_add`
  (1285), `_proxy_dict_set` (1322); `c_to_py` builds proxies (set proxy at ~529).
  **These shims dereference the flat layout directly and *break* under a B-tree — rewrite
  them against the new C entry points:** `_proxy_set_iter` (`:1303-1309`, reads
  `s.data.set.items[i]`), `_proxy_dict_items` (`:1335-1343`, reads `d.data.dict.keys[i]`/
  `.values[i]`), and the set-`clear` shim (`:1537-1539`). The point ops (`_proxy_set_add`,
  `_proxy_dict_set`, contains/get/remove) already go through C and need no change; the Array
  proxy's `.data.array.items[i]` use (`:1217-1279`) stays (Array is unchanged).
- Phase-2 work: make `EastSet`/`EastDict` *construct* a live C value and return a proxy
  (remove the `sortedcontainers`-backed bare classes in
  `east/types/values/collections.py`); bulk-build path in `array()`/`EastSet(…items)`;
  the API-parity audit (§3.2) before deleting the bare classes.
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

0. **The gate (§2.2):** vendor `tidwall/btree.c`, compile `-DBTREE_NOATOMICS` inside east-c,
   confirm clean link, and bench `btree_load` on a real sorted stream. Outcome picks
   **leverage** vs **hand-roll** — and *only then* is §2.2's node layout yours to write.
1. **Vertical slice, east-c only:** stand up the tree (owned or vendored) behind
   `east_set_insert`/`has`/`get`, with a temporary `to_flat`/`from_flat` adapter so the
   *other* subsystems keep reading a flat array (build tree → flatten for serialize/GC/iterate).
   Get `make test` + `make leak-check` green. Proves the ordering in isolation. **Build the
   bulk-loader here** — it is the shared primitive everything downstream needs (§5).
2. Migrate serializers + iteration to in-order traversal (drop the adapter); re-gate +
   leak-check. Property-test traversal-order == compare-order.
3. Migrate **both death paths** (`east_value_release` SET/DICT case *and* `gc_destroy_contents`,
   nulling the root in the latter) + `gc_traverse` to walk the tree. Under leverage this is the
   `item_free`/`btree_ascend` wiring; under hand-roll a recursive `btree_destroy`. Add the
   OOM-mid-split unwind. Fuzz + valgrind — for memory hygiene, not collector correctness (§2.4-6).
4. Migrate set algebra to **dual-cursor merge → bulk-load** (O(n+m)), skew-aware probe for
   lopsided sizes; split pure `union` (fresh) from `union_in_place` (insert b into a) (§2.4-3).
5. **Phase 2 (east-py):** flip `EastSet`/`EastDict` construction to proxies; **add the new C
   iteration entry points and rewrite `_proxy_set_iter`/`_proxy_dict_items`/clear + the `.pxd`
   mirror** against them (§7.4); run the API-parity audit; delete the Python stores; assert the
   single-thread-per-value invariant (§3.5). Re-gate full east-py + downstream. The
   `union_in_place` branch and the bare-vs-proxy logic in `collections.py` get deleted here.
6. **Phase 3 (optional):** Array delegation; small-inline optimization (§5).

### 7.8 Context pointers

- This design + its rationale live in this file; the **two-forms memory model** and the
  full reasoning are in the conversation that produced it (the bare-vs-proxy distinction,
  the O(n²) interleaved-upsert analysis grounded in `east-twe/src/transformation/snapshot.ts`).
- The motivating workload is `snapshot.ts`-shaped group-by/upsert (§1.4) — use it (or a
  synthetic K-key aggregation loop) as the performance benchmark to prove O(K²) → O(K log K).
- Current branch: `east-py-value-production` (the values.py→package refactor + the
  `union_in_place` fix are already there; PR #15).
