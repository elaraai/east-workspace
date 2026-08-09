---
name: east-py
description: "Use East runtime values as the working data in Python — prefer their chained eager methods (native east-c, faster + standardised) over converting to pure-Python list/dict/set — and call Python from East. Use when writing Python (not the TypeScript DSL) against the east-py runtime. Triggers for: (1) Constructing/validating East values in Python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant, variant()/some/none/struct/array, coerce_to/assert_value_of), (2) Transforming values with eager methods that delegate to the east-c builtins (sort/map/filter/fold/concat/set-algebra/dict-merge/etc.), (3) Scalar builtins via the East.<Type> namespaces (East.Float.sqrt, East.String.split, East.DateTime.print_format, East.less), (4) Exposing a Python function to East with @platform_function (output validation, sync/async), (5) NumPy/torch interop through EastVector/EastMatrix to_numpy()/to_torch(), (6) Porting a plain-Python data-science POC into an East platform function."
---

# East.py — values as data, and the platform on-ramp

`east-py` is the Python runtime for East: a Cython bridge to the native **east-c**
runtime. You don't re-implement East in Python — you use East *values* as ordinary
Python data, call their **eager methods** (which delegate to the east-c builtins
and execute immediately), and expose Python functions to East with a decorator.

This skill is for writing **Python** against the runtime. (For the TypeScript
`East.function` DSL, use the `east` skill; for ML/optimization platform functions,
`east-py-datascience`.)

## Work in East values — don't round-trip through Python

Inside a `@platform_function` (or any east-py code over runtime data), **do the
work with the East values you were handed and their chained eager methods. Do
not down-convert to a Python `list`/`dict`/`set`, loop in the interpreter, and
rebuild an East value** — that is the single most common way east-py gets used
badly. This is not a style preference; it changes the cost and the correctness.

- **Speed.** `EastArray`/`EastSet`/`EastDict` are handles into the shared east-c
  value slab. An eager method hands that pointer to the native builtin with no
  copy and returns a new handle, so `a.filter(...).group_by(...).map(...)` runs
  the container machinery — traversal, allocation, ordering, set/dict algebra —
  in C, and the data never leaves it. Down-converting is the opposite: an O(n)
  decode to Python, an interpreter loop, then an O(n) re-encode — every round
  trip copies the whole collection. (Tensors are the same: `to_numpy()` is a
  zero-copy view; a Python element loop is not.)
- **Correctness + standardisation.** East methods use East's *total order* and
  equality (right for floats/NaN, mixed types, variants-by-name) and keep Sets/
  Dicts deterministically ordered. `sorted()`, a bare `dict`, or `set()` get
  these subtly wrong and diverge from the C / TS / other runtimes.
- **Scalars + dates.** The same rule covers primitives. East scalars *are* Python
  scalars, but use the `East.<Type>` utilities (and `East.less`/`compare`/`equal`)
  for anything whose semantics diverge — integer division/overflow (`Integer` is
  i64, Python `int` is unbounded), `to_integer`/rounding, **all** ordering and
  equality, string case/trim/split/`replace`/regex — and **always**
  `East.DateTime.*` for date/time (UTC; `print_format`/`parse_format` Day.js
  tokens), never Python `datetime` arithmetic / `strftime` / `timedelta` / `<`.

**Chain, don't stage.** Each collection method returns a live east-c value —
keep piping (`arr.filter(...).to_dict(...).map(...)`) instead of binding
intermediates to Python names and re-wrapping them. Cross back to Python only at
the edges: a scalar for `East.Float.*`/`East.String.*` math, or a numpy/torch
buffer via `to_numpy()`/`to_torch()`.

**This applies to *intermediates*, not just the input/output boundary.** The
failure mode is the *sandwich* — East input → convert to Python → run the logic
over `list`/`dict`/`set` → convert back to an East output. If the logic is
East-expressible (mapping, filtering, grouping, joining, reducing, set/dict
algebra), do the whole thing in East so every intermediate stays an east-c value
produced by an east-c method — never materialised, never manually looped. In
particular, prefer the declarative reducers (`fold`/`map_reduce`/`group_fold`/
`to_dict(..., combine=…)`) over *any* hand-rolled accumulation loop: the reducer
makes **one** native call that iterates and accumulates in C, whereas a manual
loop — Python **or** repeated `EastRef`/`EastDict` updates — pays a separate FFI
crossing per element (no faster than pure Python, usually slower). Reach for a
Python/numpy intermediate only when the work genuinely isn't East-expressible (a
real numpy/scipy/torch/solver op) — cross via `to_numpy()`/`to_torch()`
(zero-copy for tensors) and wrap the result back. Bare scalars stay plain Python
— an East `Float` *is* a `float`; don't wrap a running sum in an `EastRef`.

The callback-free ops (`sort`/`sorted`, `unique`, `union`/`intersect`/`diff`,
`concat`, `group_by`, `merge`, `to_dict`/`to_set`, `find_sorted_*`) always run
the whole loop in east-c. And `map`/`filter`/`fold`/… callbacks are **traced
into native East kernels automatically when the lambda is pure** (see
[Kernels](#kernels--pure-lambdas-run-natively-ir-push-down)) — a lambda like
`lambda r: r.price * r.qty` never executes per element; a lambda that does real
python work falls back to the per-element callback path, which still beats a
hand-rolled Python loop.

### Anti-patterns → do this instead

| Instead of (pure Python) | Write (East values) |
|---|---|
| `[dict(r) for r in items]` then Python loops | keep `items` as the `EastArray`; `.map`/`.filter`/`.group_by`/`.fold` |
| `sorted(items, key=…)` / `sorted(list(arr))` | `items.sorted(key=…)` (East order, in C) |
| `{r["k"]: r for r in items}` | `items.to_dict(lambda r: r["k"])` |
| `set(a) & set(b)` / `set(a) - set(b)` | `a.intersect(b)` / `a.diff(b)` |
| `EastArray(T, [f(x) for x in arr])` | `arr.map(f)` (pin `out=` for a widening map) |
| a `for` loop that sums/accumulates | `arr.fold(init, lambda acc, x: …)` / `arr.map_reduce(…)` |
| a helper that takes/returns `list`/`dict`/`set` | a helper over East values, or inline the eager chain |

```python
# WRONG — decodes the whole array to Python, loops in the interpreter,
# re-encodes, and uses Python's ordering (wrong for floats/NaN, non-deterministic)
def totals_by_region(items):
    acc = {}
    for r in [dict(x) for x in items]:
        acc[r["region"]] = acc.get(r["region"], 0.0) + r["amount"]
    return array(Row, [{"region": k, "total": v} for k, v in sorted(acc.items())])

# CORRECT — stays C-side, East-ordered, no round trip
def totals_by_region(items):
    return (items
        .group_by(lambda r: r["region"])                                    # Dict<region, Array<row>>
        .map(lambda rows: rows.fold(0.0, lambda acc, r: acc + r["amount"])) # Dict<region, total>
        .to_array(lambda region, total: struct({"region": region, "total": total}, Row)))
```

## Kernels — pure lambdas run natively (IR push-down)

Eager callback methods accept three kinds of function, all with the same
syntax, fastest first:

1. **A pure python lambda — traced automatically.** The method calls your
   lambda ONCE with typed expression proxies (exactly like a TS
   `East.function` builder); the whole builtin surface records East IR —
   field access, arithmetic, comparisons, boolean algebra, string/datetime
   methods, every `East.<Type>.*` namespace call, captured East collections
   (trace-time snapshots hoisted to build-once constants — explicit
   `kernel()` only), option construct/consume
   (`some`/`none`/`.is_some`/`.unwrap_or`/`.match`) and
   `.try_parse(T) -> Option<T>` — east-c compiles it, and the loop AND the
   kernel execute natively, zero python per element (~5× a per-element
   callback on a 300k-row map, and it composes with chaining).

   Collection methods on traced expressions are a **closed, enumerated
   surface** (an unsupported method raises `KernelTraceError` naming it;
   with no loop IR these ARE the kernel language's iteration constructs).
   Nested lambdas trace recursively and may reference outer parameters;
   `some`/`every`/`first_map` compile to the native short-circuiting
   FirstMap scans, so traced and eager forms have identical early-exit
   execution:

   - **Array**: `map` `filter` `filter_map` `first_map` `fold` `scan`
     `map_reduce` `flatten_to_array` `flatten_to_set` `to_dict` `to_set`
     `unique` `group_by` `sorted` `is_sorted` `some` `every` `string_join`
     `concat` `slice` `reversed` `copy` `get_keys` `size` `has` `get`
     `get_or_default` `try_get` `sum` `mean` `maximum` `minimum`
     `[index_expr]`
   - **Set**: `map` `filter` `filter_map` `first_map` `map_reduce` `scan`
     `flatten_to_array` `flatten_to_set` `to_array` `to_dict` `union`
     `intersect` `diff` `sym_diff` `is_subset` `is_superset_of` `is_disjoint`
     `copy` `size` `has` `reduce` `sum` `mean` `every` `some`
   - **Dict**: `map` `filter` `filter_map` `first_map` `map_reduce` `scan`
     `flatten_to_array` `flatten_to_set` `to_array` `to_set` `to_dict`
     `keys_set` `get_keys` `copy` `size` `has` `get` `get_or_default`
     `try_get` `reduce` `sum` `mean` `every` `some` `[key_expr]`

   Mutators and side-effecting methods are deliberately absent (the kernel
   language is pure), so a whole `record → legs → values` descent — or a
   `group_by` + `to_dict(combine=)` + `sorted` aggregate — is ONE kernel,
   with no materialised intermediate between stages. Methods that
   exist only on proxies (e.g. `.substring`) need `out=` on `map` (type
   inference otherwise samples the lambda on a decoded python value):

   ```python
   rows    = EastBlob(csv_bytes).decode_csv(Row)          # C-backed Array<Row>
   amounts = rows.map(lambda r: r.price * r.qty)          # traced -> native
   hot     = rows.filter(lambda r: (r.sku == "A-1") & (r.price > 100.0))
   total   = rows.fold(0.0, lambda acc, r: acc + r.price) # multi-param traces too
   by_sku  = rows.group_by(lambda r: r.sku)               # fully native grouping
   top     = rows.sorted(key=lambda r: -r.price)
   spend   = rows.to_dict(key=lambda r: r.sku,
                          value=lambda r: r.price * r.qty,
                          combine=lambda a, b: a + b)
   ```

2. **A precompiled kernel** — `east.kernel(param_types, fn)` traces now and
   returns a reusable compiled callable (it also raises `KernelTraceError`
   instead of silently falling back — use it when you need to *know* you're
   native, or to hoist compilation out of a loop). A precompiled kernel —
   including a `.bind(...)` result — passes its native function value
   **straight through every eager method** (#409): the loop runs entirely in
   east-c with zero per-element python, and the output type comes from the
   kernel's own signature, so no `out=` and no sampling. If you DO pass
   `out=` (or the method has a declared type) and the kernel's signature
   contradicts it, the call raises `EastTypeError` immediately — both types
   are known statically, and a mislabelled result would corrupt far from the
   cause (#467). Kernels are also **dual-mode** (#470): called with plain
   values they execute natively; referenced inside another `kernel()` lambda
   or a pure wrapper they re-run their source and splice into that trace —
   so kernels compose (`kernel(Row, lambda r: amount(r) * 1.1)`), and every
   grouping/sugar method runs them with zero per-element python
   (`.bind(...)` results are the exception: native everywhere, but not
   re-traceable inside another trace). Compiled East
   functions loaded from elsewhere (`compile_from_beast2/json/east`, or
   `compile_from_value` for a homoiconic IR value built with
   `east.ir.builders`) are accepted the same way:

   ```python
   from east import kernel, where, FloatType

   amount = kernel(Row, lambda r: r.price * r.qty)     # compile once
   for blob in batches:
       out = blob.decode_csv(Row).map(amount)          # reuse — no re-trace

   step = kernel([FloatType, Row], lambda acc, r: acc + r.price)  # fold arity
   k = compile_from_beast2(bytes_)                     # kernel compiled in TS

   conv = kernel([Row, TableT], lambda r, t: t.get_or_default(r.sku, 0.0))
   rows.map(conv.bind(table))   # bind a live side-table BY REFERENCE (#399):
                                # zero-copy at any size, mutations observed,
                                # still native — see "Maximum performance" #3
   ```

3. **Any other python callable** — runs per element exactly as before
   (east-c drives the loop and calls back into python each iteration).

**Tracing rules** (what makes a lambda "pure" enough to trace):

- Reference only the lambda's parameters, plain scalar constants
  (closure floats/ints/strings are baked — same value per element either
  way), East types/values (`east_null` included), the `East` builtin
  namespace, `where`/`some`/`none`, **precompiled `kernel()` results**
  (dual-mode: they re-trace from their source, at any nesting depth,
  #470), and — two wrapper levels deep, enough for helper lambdas that
  compose a callback — other lambdas that pass the same rules. Any
  other module reference (`random.…`, `np.…`), mutable closure, arbitrary
  callable, or closure mutation
  (`nonlocal x; x += 1`) **disables tracing** — the python path runs and
  semantics are exactly today's. A closed-over East *collection* also
  disables auto-tracing (tracing snapshots it, which would diverge from
  live per-element semantics) — capture side-tables in an explicit
  `kernel()`, which opts into the snapshot. Side effects therefore never
  get lost: an impure lambda runs per element; a traced lambda ran once,
  at trace time (type inference likewise never runs an impure lambda
  against proxies — it samples on a real element instead).
- Python won't let a library overload `and`/`or`/`not`/`if`, so traced
  kernels use `&`, `|`, `~` (parenthesised, pandas-style) and
  `where(cond, then, otherwise)` for conditionals. `where` is dual-mode:
  eager on plain values, an East `IfElse` on traced expressions — the same
  lambda works on both paths.
- Arithmetic follows East types exactly: no implicit Integer↔Float mixing
  (`.to_float()` / `.to_integer()` convert), `//` is East IntegerDivide,
  `/` is Float division. Struct fields read as attributes or items
  (`r.price` / `r["price"]` — both trace, and both work on real rows).
- Each eager call re-traces (compilation is tens of µs — amortised over the
  loop); hoist a `kernel(...)` if you call the same lambda in a tight
  python loop.

### Maximum performance — the levers, ranked

The whole point of the kernel machinery is that **data stays in east-c and
python never runs per element**. In order of impact:

1. **Keep values East end-to-end.** `EastArray`/`EastSet`/`EastDict` are
   C-backed; every eager method (`map`/`filter`/`group_by`/`sorted`/set
   algebra/dict merge/…) runs the loop natively regardless of how deeply
   nested the element type is — nesting costs nothing extra because the
   structure never round-trips through python. The moment you call
   `list(...)`/`dict(...)` or iterate in python you pay a per-element
   boxing crossing — convert at most once, at the very end.
2. **Let pure lambdas trace** (form 1 above), and chain on the results —
   a chain of traced `map`/`filter`/`fold` stays native between steps.
   Return a dict literal (`lambda r: {"a": …, "b": …}`) to compute every
   derived column in ONE pass instead of one `map` per column. **Reuse a
   python variable to share work** (trace-time CSE): assigning
   `fields = r.data.split("|")` and reading `fields` for 30 columns
   compiles to ONE `Let` — the split runs once per row, not 30×
   (~2.5× on that shape). Sharing the *variable* is what dedupes;
   re-calling `.split()` per column re-emits the split. Loop-invariant
   shared subexpressions hoist out of nested lambdas to the kernel body
   the same way.
3. **Side tables: capture small ones, `bind` big ones.** Two spellings with
   opposite contracts — never conflate them:

   - **Closure capture (snapshot).** A captured East collection is snapshot
     into the kernel's IR at trace time: hoisted and identity-deduped so it
     builds **once per compiled kernel** and every per-element lookup runs
     in C — ideal for lookup tables up to ~10⁴–10⁵ entries. The snapshot's
     build cost and memory ride the kernel (a 1M-entry dict costs ~10 s to
     snapshot), and later mutations are **not** seen.
   - **`kernel(...).bind(table)` (by reference, live).** Declare the table
     as a trailing parameter and pre-bind it: C-level partial application
     retains the value's live pointer — **zero copy, O(1) bind at any size**
     (1M entries: ~0.1 ms), per-row cost matches the hoisted case, and the
     kernel **observes later mutations** (the explicit opt-in to live
     semantics). Rebinding gives independent callables; the unbound kernel
     stays usable; binding a wrong-typed value raises `TypeError`.

   ```python
   fx = EastDict(StringType, FloatType, rates)          # small table → capture
   to_usd = kernel(Row, lambda r: r.amount * fx.get_or_default(r.ccy, 1.0))

   TableT = DictType(StringType, FloatType)             # huge table → bind
   conv = kernel([Row, TableT], lambda r, t: r.amount * t.get_or_default(r.ccy, 1.0))
   rows.map(conv.bind(big_table))                       # loop + lookup stay in east-c
   conv.bind(t1, t2)  # multi-table: binds the TRAILING parameters in order
   ```

   Kernel *parameters* always cross the bridge **by reference** (zero copy,
   any size, any nesting depth) — `bind` is what lets eager methods use a
   parameter-taking kernel where the callback signature is fixed.

4. **Hoist `kernel(...)` out of python loops** and reuse it — re-tracing is
   cheap but not free; a precompiled kernel is a plain callable and every
   eager method accepts it.
5. **When logic must stay python, go columnar** (next section): one
   boundary crossing per column/batch instead of per row × field, then
   come back to East values with `from_columns`/`extend`.
6. **Verify you're actually native** with
   `east.runtime.compiler.eager_stats()` — a snapshot of
   `kernel_direct` / `pushdown_traced` / `trampoline_calls` counters. A hot
   `rows.map(k)` that bumps `trampoline_calls` by `len(rows)` is running
   per-element python; the delta should be zero for kernels and traced
   lambdas.

`kernel()` raises `KernelTraceError` instead of silently falling back —
use it in hot paths so a lambda that drifts off the traceable surface
fails loud instead of quietly running per element. (Since #398 the tracer
constructs homoiconic IR values and compiles them with no serialization
round-trip, so trace+compile is ~1.5× faster than the earlier wire-format
path — speculative auto-tracing is cheap enough to just leave on.)

## Columnar escape hatches — when the logic must stay python

When per-element logic genuinely needs python (numpy, a model, an external
library), don't touch rows one at a time — cross the boundary **once per
column** instead of once per row × field:

```python
cols = rows.to_columns()          # {"price": np.float64[...], "qty": np.int64[...],
                                  #  "sku": [str, ...] (interned), ...} — one crossing/column
amount = cols["price"] * cols["qty"].astype(np.float64)     # vectorised numpy
out = EastArray.from_columns(Out, {"sku": cols["sku"], "amount": amount})

result = rows.map_batches(f, out=Out, batch_size=50_000)    # f sees columnar chunks;
                                                            # batches may shrink (filter-like)

acc = EastDict(StringType, FloatType)                       # dicts as accumulators:
acc.update_many(keys, values, combine=lambda cur, new: cur + new)  # one crossing,
                                                            # combine traces -> collisions in C
arr.extend(np_array)                                        # bulk push, one crossing

solver_input = coerce_to(                                   # struct fields take 1-D numpy
    {"start_nodes": np_i64, "capacities": np_i64, ...},     # columns directly: each
    MinCostFlowInputType)                                   # Array<Int/Float/Bool> fills C-side
```

`Float`/`Integer`/`Boolean` columns move through numpy buffers filled in C
(`Option<Float>` ↔ float64 with NaN for `none`); `String` columns box once
through a bounded intern table (repeated categories/ids come back as the
same python object); other field types fall back to boxed lists. The same
contract governs the INPUT direction: `from_columns`/`coerce_to` fill C-side
only when a numeric column arrives as a numpy array of the matching dtype
(float64/int64/bool; float64-with-NaN for `Option<Float>`) — a plain python
list converts per cell, so `np.asarray(col)` first when the source is a
list. Composition rule: **kernels for East-expressible transforms,
columns/batches for the genuinely-python remainder.**

### Put the logic in the platform function, not a pure-Python shim

Don't write pure-Python helpers over `list`/`dict` and give a `@platform_function`
that only converts-and-delegates to them. A `@platform_function` is *just* a
typed, validated Python function — its one added cost is validating the declared
output, which is a **feature** — so a separate untyped helper layer buys nothing
and costs you:

- **Testability** — the typed `inputs`/`output` is the contract you test against;
  a pile of untyped `list`/`dict` helpers has none, so bugs surface as silent
  corruption instead of a named `EastTypeError`.
- **Migratability** — a platform function over East values is the portable unit;
  it moves to an e3 task, another runtime, or a TS `East` mirror unchanged.
  Pure-Python-collection helpers are Python-only and must be rewritten.
- **A forced sandwich** — a helper that speaks `list`/`dict` makes the function
  convert East→Python on the way in and back on the way out — the exact round
  trip above.
- **Blurred purity** — East platform functions should be *pure in their East
  inputs* (that is what makes them memoisable / cacheable); a web of mixed pure
  and side-effecting helpers makes that impossible to reason about. Keep the
  transformation on East values inside the function and isolate any real effects.

Factoring out small functions for reuse is fine — just have them **take and
return East values** so the East types flow through. They needn't each be
`@platform_function`s (pay the output-validation cost only at the real
East↔Python edge — and never call a platform function per element inside a loop;
that is the loop anti-pattern again).

## Quick Start

```python
from east import (EastArray, StructType, StringType, FloatType, East,
                  array, struct, coerce_to, platform_function, platform_functions, ArrayType)

LineItem = StructType([("name", StringType), ("price", FloatType)])

# 1. Construct + validate East values from native Python (dicts are coerced)
items = array(LineItem, [{"name": "a", "price": 1}, {"name": "b", "price": 2.0}])

# 2. Eager methods run NOW (delegating to east-c) and chain
dear = items.filter(lambda r: r["price"] >= 2.0).sorted(key=lambda r: r["price"])

# 3. Primitive builtins live on East.<Type> namespaces (can't add methods to float/str)
East.Float.sqrt(2.0)
East.String.upper_case("hi")

# 4. Expose a Python function to East — typed, validated, auto-collected
@platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    return items.map(lambda r: struct({"name": r["name"], "price": r["price"] * fx_rate}, LineItem))

platform = platform_functions(__name__)   # pass to compile() to register
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Build an East value from Python data
    │   ├─ Array of structs from dicts → array(ElemType, [dict, ...])   (coerces + validates each)
    │   ├─ One struct (reorder/coerce keys to a type) → struct({...}, StructType)
    │   ├─ Tagged value / option
    │   │   ├─ Named case → variant(case, value, VariantType)
    │   │   └─ Optional → some(x) / none
    │   ├─ Numeric buffer for ML/tensors → EastVector(FloatType, np_1d) / EastMatrix(FloatType, np_2d)
    │   ├─ A ref cell → east_ref(value)
    │   ├─ Raw bytes → EastBlob(b"...")   (a bytes subclass; decode_csv/beast2/utf8 live on it)
    │   ├─ Generate (range/zeros/…) → classmethods: EastArray.range / EastVector.zeros / …  (NOT East.Array.*)
    │   └─ Anything, type-driven (int→Float, dict→Struct, np 1-D→Array, …) → coerce_to(value, typ)
    │
    ├─ Validate a value at a Python↔East boundary
    │   ├─ Raise on mismatch, path-pinpointed → assert_value_of(value, typ)   ❗EastTypeError
    │   ├─ List every problem (empty == conforms) → explain_value_of(value, typ)
    │   ├─ Boolean check → is_value_of(value, typ)
    │   └─ Infer a value's type → type_of(value)
    │
    ├─ Transform a value (eager — runs NOW in east-c; results stay C-side and chain;
    │   pure lambdas trace into NATIVE kernels — see “Kernels” — and east.kernel()/where()/greatest()/least() author them explicitly)
    │   ├─ Array<T>  (element callbacks take fn(el) — or fn(el, idx) when declared, the builtin's index)
    │   │   ├─ Access → get(i) ❗bounds · get_or_default(i, d) · try_get(i) · has(i) · get_keys(idxs) · arr[i] (pythonic) · len() · iterate
    │   │   ├─ Reorder → sort(key=, reverse=) (in place) · sorted(key=, reverse=) · reverse() · reversed()
    │   │   ├─ Slice & combine → slice(start, end) · concat(other) · copy()
    │   │   ├─ Per-element → map(fn, out=) · filter(pred) · filter_map(fn, out=) · for_each(fn)
    │   │   ├─ Reduce → fold(init, fn) · scan(init, fn) (running fold → Array, one per element) ·
    │   │   │            map_reduce(map_fn, reduce_fn, out=) · sum(fn=) · mean(fn=) ·
    │   │   │            maximum(by=) ❗empty · minimum(by=) ❗empty · every(pred=) · some(pred=)
    │   │   ├─ Search → find_first(target, key=) · find_all(value, by=) · find_maximum(by=)/find_minimum(by=) → some(i)/none ·
    │   │   │            find_sorted_first/last/range(target, key=) · first_map(fn, out=) · is_sorted(key=)
    │   │   ├─ Group → group_by(key) · group_reduce(key, init, fold) · group_size(key=) · group_sum(key, fn=) ·
    │   │   │            group_mean(key, fn=) · group_maximum/minimum(key, by=) ❗returns the projected VALUE per
    │   │   │            group, not the row/index (find_maximum finds the index) · group_every/some(key, pred) ·
    │   │   │            group_find_all(key, value, by=)/group_find_first(key, value, by=) → indices per group ·
    │   │   │            group_find_maximum/minimum(key, by=) → the INDEX per group (ties keep the earliest) ·
    │   │   │            group_to_arrays(key, value=) · group_to_sets(key, value=) · group_to_dicts(key, key2, value=, combine=)
    │   │   ├─ Convert → to_dict(key, value=, combine=) ❗dup w/o combine · to_set(key=) · unique() · string_join(sep) ·
    │   │   │            flatten_to_array/set/dict (flatten_to_dict ❗dup w/o combine)
    │   │   ├─ Columnar → to_columns(fields=) · EastArray.from_columns(T, cols) · map_batches(fn, out=, batch_size=)
    │   │   ├─ Mutate (in place) → append · extend (bulk, one crossing) · insert · pop · remove · clear · arr[i]=v
    │   │   └─ Generate → EastArray.range(n) · .linspace(a, b, n) · .generate(n, fn)
    │   ├─ Set<K>
    │   │   ├─ Access → len(s) · value in s · has(value) · iterate (East order)
    │   │   ├─ Algebra → union · intersect · diff · sym_diff · is_subset · is_superset_of · is_disjoint · union_in_place
    │   │   ├─ Per-element → map(fn)→Dict · filter(pred) · filter_map(fn)→Dict · first_map(fn) · for_each(fn)
    │   │   ├─ Reduce → reduce(init, fn) · scan(init, fn) (running fold → Array) · map_reduce(fn, reduce) ❗empty ·
    │   │   │            sum(fn=) · mean(fn=) · every(pred=) · some(pred=)
    │   │   ├─ Group → group_fold(key, init, fold) · group_size(key) · group_sum(key, fn=) · group_mean(key, fn=) ·
    │   │   │            group_every/some(key, pred) · group_to_arrays/sets(key, value=) · group_to_dicts(key, key2, value=, combine=)
    │   │   ├─ Convert → to_array(key=) · to_set(fn) · to_dict(key, value, combine=) ❗dup w/o combine
    │   │   ├─ Flatten → flatten_to_array(fn, out=) · flatten_to_set(fn, out=) · flatten_to_dict(fn, combine=) ❗dup w/o combine
    │   │   └─ Mutate (in place) → add · insert ❗exists · try_insert(v)→bool · remove · delete ❗missing ·
    │   │                          try_delete(v)→bool · discard · clear · copy()
    │   ├─ Dict<K,V>  (callbacks: map=fn(v)|fn(v,k) · filter/first_map/to_*/flatten_*/group_fold=fn(k,v) · reduce=fn(acc,k,v))
    │   │   ├─ Access → d[k] · get(k, default=None) · get_or_default(k, d) · try_get(k) · has(k) · len() ·
    │   │   │            keys()/values()/items() (python views — TS's `keys` is keys_set())
    │   │   ├─ Combine → union(other, combine=) ❗shared key w/o combine (pure; `merge` = deprecated alias #527) · union_in_place(other, combine=) · merge_key(key, value, update, initial=) (ONE key, in place) · get_keys(keys, fill)
    │   │   ├─ Per-entry → map(fn, out=) · filter(pred) · filter_map(fn, out=) · first_map(fn, out=) · for_each(fn)
    │   │   ├─ Reduce → reduce(init, fn) · scan(init, fn) (running fold → Array, key order) ·
    │   │   │            map_reduce(map_fn, reduce_fn, out=) ❗empty · sum(fn=) · mean(fn=) · every(pred=) · some(pred=)
    │   │   ├─ Group → group_fold(key_fn, init_fn, fold_fn) · group_size(key_fn) · group_sum(key_fn, fn=) ·
    │   │   │            group_mean(key_fn, fn=) · group_every/some(key_fn, pred) ·
    │   │   │            group_to_arrays/sets(key_fn, value_fn) · group_to_dicts(key_fn, key2_fn, value_fn, combine=)
    │   │   ├─ Flatten → flatten_to_array(fn) · flatten_to_set(fn) · flatten_to_dict(fn, combine=) ❗dup w/o combine
    │   │   ├─ Convert → keys_set() · to_array(fn, out=) · to_set(fn, out=) · to_dict(key_fn, value_fn, combine)
    │   │   └─ Mutate (in place) → d[k]=v · insert ❗exists · get_or_insert(k, fn) · insert_or_update(k, v, combine) ·
    │   │                          update(k, fn) ❗missing · swap ❗missing · delete ❗missing/try_delete · pop · clear ·
    │   │                          merge_all(other, merge, default) (fold other in) · (bulk) update_many(keys, values, combine=)
    │   ├─ Vector/Matrix → get/set(→new)/slice/concat/map/fold · transpose/get_row/get_col ·
    │   │                   to_array/to_vector/to_matrix/to_rows · to_numpy(copy=False)/to_torch() ·
    │   │                   from_numpy/from_torch/zeros/ones/fill
    │   ├─ Struct        → s["field"] or s.field (methods shadow same-named fields) · items()/keys()/values()
    │   ├─ Variant       → .type/.get_tag() · .has_tag(tag) · .unwrap(tag) ❗ · .match({case: handler}, default=)
    │   ├─ Ref           → get() · set(value) · update(fn(current)) · merge(patch, combine)
    │   └─ Blob          → size/get_uint8/.data · decode_utf8/utf16 · encode_beast2/decode_beast2 ·
    │                      decode_csv(row_type, csv_parse_config(null_strings=…, defaults=…, …))
    │
    ├─ Diff / patch two values of one type (East's structural patch algebra)
    │   ├─ Compute a patch → East.diff(before, after)   (patch type is PatchType(T))
    │   ├─ Apply it → East.apply_patch(value, patch)
    │   ├─ Combine two patches → East.compose_patch(T, first, second)
    │   └─ Reverse one → East.invert_patch(T, patch)
    │
    ├─ A scalar/primitive builtin (you can't method-call a float/int/str/bool/datetime)
    │   ├─ Numeric → East.Float.<op> / East.Integer.<op>
    │   ├─ Text → East.String.<op>
    │   ├─ Time → East.DateTime.<op>
    │   ├─ Logic → East.Boolean.<op>
    │   └─ Compare / order (East total order) → East.less / compare / equal / …(T, a, b)
    │
    ├─ Run custom per-element logic natively (IR push-down — build East kernels from python)
    │   ├─ Pure lambda in ANY eager callback → traced automatically (nothing to import; falls back if impure)
    │   ├─ Author a reusable/must-be-native kernel → east.kernel(param_types, fn)   ❗KernelTraceError if untraceable
    │   │   (multi-param: kernel([acc_t, elem_t], lambda acc, r: …) for fold-shaped callbacks)
    │   ├─ Use a LARGE side-table in a kernel → declare it as a trailing parameter + k.bind(table)
    │   │   (by reference: zero-copy at any size, LIVE — mutations observed; small tables just capture = snapshot)
    │   ├─ Pass a precompiled kernel (incl. a .bind result) to any eager method → native loop, no out=, no sampling
    │   │   (a kernel contradicting a declared out= raises EastTypeError at the call — #467; kernels also COMPOSE:
    │   │    reference one inside another kernel() lambda or a pure wrapper and it splices into that trace — #470)
    │   ├─ Check whether a hot call ran natively → east.runtime.compiler.eager_stats() (trampoline/kernel/pushdown counters)
    │   ├─ What traces (the expression surface inside kernels)
    │   │   ├─ Struct fields → r.price / r["price"] · build rows with dict literals {"k": expr, …}
    │   │   ├─ Arithmetic → + - * / // % ** · unary - · .abs() · .to_float()/.to_integer() · .sign() ·
    │   │   │                .sqrt()/.exp()/.log()/.sin()/.cos()/.tan() (Float) · .log()/.sign() (Integer)
    │   │   ├─ Compare → == != < <= > >= (East total order, any comparable type) · greatest(a, b) · least(a, b)
    │   │   ├─ Boolean → & | ^ ~ (never and/or/not/if) · where(cond, then, otherwise)
    │   │   ├─ String → + (concat) · .contains/.starts_with/.ends_with · .upper()/.lower() · .strip()/.lstrip()/.rstrip() ·
    │   │   │            .length() · .split(sep) · .replace(old, new) · .substring(a, b) · .index_of(s) · .repeat(n) ·
    │   │   │            .regex_contains/.regex_index_of(pat, flags=) · .regex_replace(pat, repl, flags=) · .encode_utf8/16 ·
    │   │   │            .try_parse(T) -> Option<T> (strict whole-string parse; none on any failure)
    │   │   ├─ DateTime → .get_year/month/day_of_month/day_of_week/hour/minute/second/millisecond() ·
    │   │   │              .to_epoch_milliseconds() · .add_/subtract_{milliseconds,seconds,minutes,hours,days,weeks}(n) ·
    │   │   │              .duration_{milliseconds,seconds,minutes,hours,days,weeks}(other) · .print_format("YYYY-MM-DD")
    │   │   ├─ Option → .is_some()/.is_none() · .unwrap_or(default) · construct with some(expr) / none (in where branches)
    │   │   ├─ Variant → .get_tag() · .has_tag(tag) · .match({case: handler}) · .unwrap(tag) ❗ ·
    │   │   │             construct with variant(case, payload) under a typed context
    │   │   ├─ Collections → the FULL closed surface enumerated in [Kernels](#kernels--pure-lambdas-run-natively-ir-push-down)
    │   │   │                 (#452) — that list is the ONE registry, pinned against `_TRACED_SURFACE`; highlights:
    │   │   │                 map · filter · filter_map · fold · scan · map_reduce · flatten_to_array/set ·
    │   │   │                 to_dict · to_set · unique · group_by · sorted · is_sorted · some · every ·
    │   │   │                 sum · mean · maximum/minimum (Array) · reduce (Set/Dict) ·
    │   │   │                 string_join · concat · slice · reversed · copy · get_keys · the Set algebra ·
    │   │   │                 keys_set · to_array · size · has · get ❗ · [i|k expr] ❗ · get_or_default · try_get ·
    │   │   │                 first_map(fn, out=) → Option (early exit: Array/Set fn(el), Dict fn(k,v))
    │   │   │                 (inner lambdas trace recursively, may reference outer params; some([])=False, every([])=True;
    │   │   │                  some/every/first_map short-circuit natively — identical to the eager path; an unsupported
    │   │   │                  method raises KernelTraceError NAMING the supported set)
    │   │   ├─ Namespace builtins → every East.<Type>.<op>(…) with a traced argument emits IR (same ops as eager)
    │   │   ├─ Captured East constants → a closed-over EastArray/EastSet/EastDict/EastStruct becomes a build-once
    │   │   │   SNAPSHOT (hoisted + identity-deduped; not live — big tables belong in params, see .get/.try_get)
    │   │   │   ❗ read a capture with .get(expr)/.get_or_default(expr, d)/.try_get(expr) — the [expr] subscript
    │   │   │   spelling does NOT trace (python coerces the index via __index__ and the trace bails)
    │   │   └─ Shared subexpressions → REUSE the python variable (fields = r.data.split("|"); read it N times)
    │   │       → compiles to one Let, work runs once per row; loop-invariants hoist out of nested lambdas too
    │   ├─ Conditionals → where(cond, then, otherwise) — dual-mode (East IfElse traced — exactly ONE branch evaluates)
    │   ├─ Load a kernel compiled elsewhere (e.g. TS, serialized) → compile_from_beast2/json/east — pass to any eager method
    │   ├─ Compile IR you built programmatically (east.ir.builders values) → compile_from_value — no serialization round-trip
    │   └─ Logic genuinely needs python (numpy/models) → to_columns/from_columns · map_batches ·
    │       EastDict.update_many(keys, values, combine) · extend — O(columns)/O(batches) crossings, not O(rows × fields)
    │
    ├─ Hand a buffer to numpy / torch → EastVector/EastMatrix .to_numpy()/.to_torch()   (no arithmetic methods)
    │
    ├─ A collection FILE that does not fit in memory (beast2 v5) — start MANAGED:
    │   ├─ Write → write_beast2_file(path, T, value)  (any size; re-batched into segments)
    │   │   ├─ streaming producer → open_beast2_file(path, T, mode="w") as w: w.write(batch)
    │   │   ├─ N CPUs on one table → write_beast2_file_parallel(path, T, partitions, produce)
    │   │   │   (build the expensive context BEFORE the call; forked children inherit it COW on
    │   │   │    Linux/macOS, Windows runs the same contract inline — output is ONE file either way)
    │   │   └─ merge shard files yourself → splice_beast2_files(path, T, sources) — byte copy, no re-encode
    │   │       (shards are for CPUs and live minutes; segments are for memory and live forever)
    │   ├─ Read → open_beast2_file(path) as f — owns the mmap, mirrors the collection
    │   │   (T optional: the header supplies it; declare T to VALIDATE it at open;
    │   │    don't know a file's type? → read_beast2_type(path) — works on v4 too):
    │   │   ├─ whole table → f.load()      (decodes inside east-c; input memory = one segment)
    │   │   ├─ scan → for batch in f.segments():  — process each batch NATIVELY (eager methods)
    │   │   ├─ Array point reads → f[i] · f.get/get_or_default/try_get/has · f.slice(a,b) · f.get_keys(rows)
    │   │   ├─ Dict keyed reads → f[k] ❗KeyError · f.get/get_or_default/try_get/has · k in f ·
    │   │   │   f.get_keys(keys, fill)   (fence search in east-c; ONE segment decodes per lookup)
    │   │   ├─ Set membership → x in f · f.has(x)
    │   │   ├─ Array sorted search → f.find_sorted_first/last/range(target) — GLOBAL insertion
    │   │   │   indices; no key= projection (the file pages by element order)
    │   │   └─ whole-file compute → the FULL eager read surface runs on f directly: map · filter ·
    │   │       filter_map · first_map · fold · map_reduce · sum · mean · maximum · minimum ·
    │   │       every · some · find_first/all/maximum/minimum · is_sorted · to_set/unique ·
    │   │       to_dict · to_array · to_columns · map_batches · string_join · flatten_* ·
    │   │       the group_* family · Set algebra — segment folds, east-c per segment,
    │   │       results == f.load() exactly (the file is never materialized)
    │   └─ Buffer-level (you hold the bytes, not a path):
    │       ├─ Beast2Writer(T, stream) per-batch · encode_beast2_segments_for(T)(batches)
    │       ├─ for b in iter_beast2_segments_for(T)(source)  — O(segment); source: bytes/mmap/stream
    │       ├─ decode_beast2_with_header_for(T)(blob)  — whole, v4 AND v5 (segments concatenate; non-canonical Set/Dict wire rejected as corrupt)
    │       ├─ open_beast2_pages_for(T)(source) — .element(n)/.segment(i), ONE segment each;
    │       │   ❗borrows the buffer — keep it alive (open_beast2_file owns it for you)
    │       └─ read_beast2_index(T, blob) -> (segments, elements) — totals without decoding
    │
    └─ Let East call your Python function
        ├─ Concrete types → @platform_function(inputs=[…], output=…)  +  platform_functions(__name__)
        ├─ Type-parameterized → @generic_platform_function(type_parameters=[…], is_async=…)
        └─ Cache a pure, expensive one (dev/test) → @memoize above @platform_function;
           inert until configure_memo(dir) / EAST_MEMO_DIR — e3 is the production cache
```

## What is NOT east-c (the honest list)

Almost everything above delegates to native builtins — these are the paths
that still run python, so you can reason about cost and semantics:

- **The per-element trampoline** — any impure/untraceable callback: east-c
  drives the loop, python runs per element (by design; `eager_stats()` shows
  it).
- **`EastVector`/`EastMatrix` `map`/`fold`/`map_elements`/`map_rows`** run in
  python (the tensor surface does its real math via `to_numpy`/`to_torch`).
- **`Dict.get_or_insert`** composes membership + get python-side so `fn` is
  only called on a miss (deliberately lazier than East's strict default
  expression). The other singles (`insert`/`update`/`swap`/`delete`/
  `try_delete`/`insert_or_update`) are the native builtins — including their
  error semantics (`insert` on an existing key and `delete`/`update`/`swap`
  on a missing one raise East's messages).
- **Reduction sugar** — `mean`, `group_mean`, `group_size`, …: several
  native passes, zero python per element, but not a single fused builtin
  (mirrors the TS composition).
- **Boundary utilities** — `coerce_to`/`assert_value_of`/`type_of`,
  `variant`/`struct` validation, `match()` dispatch, and the
  `compare_for`/`make_east_key` ordering helpers are python walkers (that is
  their job: the python↔East edge).
- **Iteration** — `for x in arr` / `list(arr)` boxes per element (lazily:
  elements decode as you go, and East's iteration lock is held, so mutating
  during a loop raises `Cannot modify … during iteration` exactly like an
  East for-loop); cross once with `to_columns`/`to_numpy` instead.

## Sharp edges

- **Type constructors take PAIRS, not a dict** (unlike the TS DSL):
  `StructType([("name", StringType), ("price", FloatType)])` /
  `VariantType([("ok", T), ("err", E)])`.
- **`@platform_function` output must be an East value.** Returning plain Python
  (a `dict`, a `list` of dicts) fails output validation — build with
  `array`/`struct`/`variant` or `coerce_to(raw, OutputType)` at the return
  boundary.
- **Two lambda surfaces.** A pure lambda kernel-traces into east-c — inside it
  you hold traced expressions (options: `.is_some()` / `.unwrap_or(default)`).
  An untraceable lambda runs as a per-element **Python callback over decoded
  values** — there an option is an `EastVariant` with `.type` / `.value` /
  `.unwrap(tag)` and **no** `.unwrap_or`; branch on `opt.type == "some"` and
  read `opt.value`.
- **`EastDict.get(k, default=None)` is a boundary convenience** — inside a
  `kernel()` lambda use `get_or_default(k, default)` / `try_get(k)` instead;
  a `None` default cannot lift into IR.
- **Genuinely-Python loops cross the boundary once** —
  `to_columns()` / `EastArray.from_columns` / `map_batches`, never a platform
  call or a decode per element.

## Core Concepts

- **Values are plain Python data.** Containers (`EastArray`/`EastSet`/`EastDict`/
  `EastVector`/`EastMatrix`/`EastStruct`/`EastVariant`/`EastRef`/`EastBlob`) carry
  their East element types; scalars are plain `int`/`float`/`str`/`bool`/`datetime`
  (East `Float` *is* a Python `float`, `Integer` *is* a Python `int`, …).
- **Eager methods delegate to east-c.** `arr.sort()` / `arr.map(fn)` run immediately
  in the native runtime. Collection results come back as live east-c-backed values,
  so `arr.map(f).filter(g).sorted()` stays C-side.
- **Pure lambdas become native kernels.** Callback methods trace pure lambdas into
  East IR (once, at call time) and run loop + kernel entirely in east-c; impure
  lambdas keep exact per-element python semantics. `east.kernel(...)` compiles one
  explicitly (loud on untraceable) and `east.where(cond, a, b)` is the traced
  conditional.
- **Methods vs namespaces.** You can't attach methods to Python's `float`/`int`/
  `str`/`bool`/`datetime`, so their builtins live on the `East.<Type>` namespaces.
  Everything else (the containers + `EastBlob`) has real methods.
- **Ordering is East's total order**, not Python's — `arr.sort()` sorts by East
  semantics (correct for floats/NaN, mixed types). Never assume Python `<`.

## Type System Summary

Every East type has a Python representation. Scalars are plain Python objects (so their
builtins live on `East.<Type>` namespaces, never as methods); everything else is an
`East*` container that carries its element type and has real eager methods. Only
`EastArray`/`EastSet`/`EastDict`/`EastRef` mutate in place — `EastStruct`,
`EastVariant`, `EastVector`, and `EastMatrix` are immutable value types (transform
by building a new value; `set` returns a new tensor).

| East Type | Python value | Mutability |
|-----------|--------------|------------|
| `NullType` | `None` (validates); canonical value is the `EastNull` sentinel (`east_null`) | Immutable |
| `BooleanType` | `bool` | Immutable |
| `IntegerType` | `int` (i64) | Immutable |
| `FloatType` | `float` (f64) | Immutable |
| `StringType` | `str` | Immutable |
| `DateTimeType` | `datetime.datetime` (UTC) | Immutable |
| `BlobType` | `EastBlob` (a `bytes` subclass); `.data` is `bytes` | Immutable |
| `ArrayType(T)` | `EastArray` (indexable, iterable) | **Mutable** |
| `SetType(K)` | `EastSet` (East-sorted) | **Mutable** |
| `DictType(K, V)` | `EastDict` (East-sorted by key) | **Mutable** |
| `VectorType(T)` | `EastVector`; 1-D numpy buffer via `.to_numpy()` | Immutable |
| `MatrixType(T)` | `EastMatrix`; 2-D row-major numpy buffer via `.to_numpy()` | Immutable |
| `StructType([("field", T), …])` | `EastStruct` (index by field name: `s["name"]`) | Immutable (frozen) |
| `VariantType([("case", T), …])` | `EastVariant` (`.type` tag, `.value`; compared **by case name**) | Immutable (frozen) |
| `RefType(T)` | `EastRef` (cell; `.get()` / `.set()` / `.update()`) | **Mutable** |
| `FunctionType(I, O)` / `AsyncFunctionType(I, O)` | `EastFunction` | Immutable |

`VectorType`/`MatrixType` element types are `FloatType`, `IntegerType`, or `BooleanType`;
the runtime backing numpy dtype may be narrower (e.g. f32), and the bridge canonicalizes
to East's storage width (Float→f64, Integer→i64, Boolean→u8) crossing into east-c.

## API Reference

### Construction & validation (`from east import ...`)

| Signature | Description | Example |
|-----------|-------------|---------|
| **Ergonomic constructors** |
| `array(element_type, items, *, validate=True) -> EastArray` | Each item coerced/validated to `element_type` (dict→struct, int→Float, …); `validate=False` stores as-is | `array(LineItem, [{"name":"a","price":1}])` |
| `struct(fields: dict, typ: StructType\|None=None) -> EastStruct` | Reorders/coerces keys to `typ` (else infers from fields) | `struct({"price":1,"name":"a"}, LineItem)` |
| `variant(case: str, value, typ: VariantType\|None=None) -> EastVariant` | Tagged value; validates `value` against case `case` (matched **by name**); read back via `.type`/`.value` | `variant("named", "red", Color)` |
| `some(value) -> EastVariant` / `none` | Option `some`; `none` is a **constant**, not a function | `some(5)` / `none` |
| `match(v, cases: dict, default=None)` | Dispatch on `v.type`; the handler is **always** called `handler(v.value)` — the `none` arm must be `lambda v: …`, not `lambda: …` | `match(o, {"some": lambda x: x, "none": lambda v: -1})` |
| `east_ref(value) -> EastRef` | Make a mutable ref cell (same as `EastRef(value)`) | `east_ref(0)` |
| **Validation / coercion** — raise `EastTypeError` (`expected X, got Y (at $.path)`) |
| `coerce_to(value, typ, *, path="$") -> EastValue` | Canonicalize any Python value to a bridge-ready East value, type-driven; a 1-D numpy array fills `Array<Float/Integer/Boolean>` C-side in one bulk crossing (hand struct fields numpy columns directly) | `coerce_to({"qty": np_i64}, InputType)` |
| `assert_value_of(value, typ, *, path="$") -> value` ❗ | Validate; return value, or raise path-pinpointed `EastTypeError` on first mismatch | `assert_value_of(s, LineItem)` |
| `explain_value_of(value, typ) -> list[(path, reason)]` | Every mismatch; `[]` == conforms | `explain_value_of(s, LineItem)` |
| `is_value_of(value, typ) -> bool` | Boolean conformance check | `is_value_of(items, ArrayType(LineItem))` |
| `type_of(value) -> EastType` | Infer the East type of a value | `type_of(items)` |

Container constructors are also direct: `EastArray(elem, items=None)`, `EastSet(elem, items=None)`,
`EastDict(key, value, items=None)`, `EastVector(elem, data=None, length=0)`,
`EastMatrix(elem, data=None, rows=0, cols=0)`, `EastRef(value)`.

### EastArray — complete method surface

Eager; results are live east-c-backed values that chain. `arr[i]`, `len(arr)`, `for x in arr`
work via the sequence protocol. Callback methods accept a python lambda (pure → traced into a
native kernel; impure → per-element python) or a precompiled `east.kernel(...)`. Python-path
callbacks receive **decoded East values** and their return is coerced to the East result type —
pass `out`/`element_type` when the result type can't be sampled from the first element (empty
input, or a widening map). `.element_type` is the logical element type.

| Group | Methods |
|-------|----------------------|
| Access | `get(i)` (errors when out of bounds — `arr[i]` is the pythonic read) · `get_or_default(i, default)` · `try_get(i) -> some/none` · `has(i)` · `get_keys(indices: EastArray)` |
| Reorder | `sort(*, key=None, reverse=False) -> None` (in place) · `sorted(key=None, *, reverse=False)` · `reverse() -> None` · `reversed()` |
| Slice & combine | `slice(start, end)` · `concat(other)` · `copy()` |
| Per-element | `map(fn(el), out=None)` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None)` · `for_each(fn(el)) -> None` — every element callback may also declare `(el, idx)` to receive the builtin's index |
| Reduce | `fold(initial, fn(acc, el))` · `scan(initial, fn(acc, el)) -> Array` (running fold: one accumulator per element, seed not emitted, `scan(...)[n-1] == fold(...)`) · `map_reduce(map_fn(el), reduce_fn(acc, m), out=None)` · `sum(fn=None)` · `mean(fn=None) -> float` (NaN when empty) · `maximum(by=None)` ❗empty · `minimum(by=None)` ❗empty · `every(pred=None) -> bool` · `some(pred=None) -> bool` (native short-circuit) |
| Group & index | `group_by(key(el)) -> Dict` · `group_reduce(key, init(gk), fold(acc, el)) -> Dict` · `group_size(key=None)` · `group_sum(key, fn=None)` · `group_mean(key, fn=None)` · `group_maximum/group_minimum(key, by=None)` (Dict of the projected VALUE per group — `find_maximum` is the index finder) · `group_every/group_some(key, pred)` · `group_find_all(key, value, by=None) -> Dict<K, Array<Integer>>` / `group_find_first(key, value, by=None) -> Dict<K, some/none>` (GLOBAL row indices; every group appears, so a group with no match maps to `[]` / `none`) · `group_find_maximum/group_find_minimum(key, by=None) -> Dict<K, Integer>` (the INDEX per group; a tie keeps the earliest) · `group_to_arrays(key, value=None)` · `group_to_sets(key, value=None)` · `group_to_dicts(key, key2, value=None, combine=None)` · `to_dict(key(el), value=None, combine=None) -> Dict` (duplicate key errors without `combine`) · `to_set(key=None) -> Set` · `unique() -> Set` |
| Search | `find_first(target, key=None) -> some/none` · `find_all(value, by=None) -> Array<Integer>` · `find_maximum/find_minimum(by=None) -> some(index)/none` · `find_sorted_first/last(target, key=None) -> int` · `find_sorted_range(target, key=None) -> {start,end}` · `first_map(fn(el)->some/none, out=None)` · `is_sorted(key=None) -> bool` |
| Flatten | `flatten_to_array(fn(el)->arr, out=None)` · `flatten_to_set(fn(el)->arr, out=None)` · `flatten_to_dict(fn(el)->dict, combine=None)` (a duplicate key errors without `combine`) |
| Columnar | `to_columns(fields=None) -> dict` (numpy per numeric/bool column, `Option<Float>`→NaN, interned strings) · `EastArray.from_columns(element_type, columns)` *(static)* (C-side fill needs numpy columns — float64/int64/bool, `Option<Float>` as float64+NaN; python lists convert per cell) · `map_batches(fn(cols)->cols, out=None, batch_size=100_000)` |
| Convert | `string_join(sep) -> str` (String arrays) |
| Mutate (in place) | `append(item)` · `extend(items)` (bulk: one crossing; C-to-C for same-type East arrays, raw buffers for numpy) · `insert(i, item)` · `pop(i=-1)` · `remove(item)` · `clear()` · `count(value) -> int` · `index(value) -> int` |

### EastSet — complete method surface

Mutable, unique, **East-sorted**. `.element_type` is the element type; iteration / `to_array` /
`reduce` visit in East order. **`map` and `filter_map` return an `EastDict`** keyed by the element
(Set→Set is `to_set`).

| Group | Methods |
|-------|---------|
| Access | `len(s)` · `value in s` · `has(value)` · `for el in s` |
| Algebra (vs another set) | `union(other)` · `intersect(other)` · `diff(other)` · `sym_diff(other)` · `is_subset(other) -> bool` · `is_superset_of(other) -> bool` · `is_disjoint(other) -> bool` |
| Per-element | `map(fn(el)) -> Dict` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None) -> Dict` · `first_map(fn(el)->some/none, out=None)` · `to_set(fn(el), out=None)` · `to_array(key=None)` · `to_dict(key(el), value(el), combine=None)` (duplicate key errors without `combine`) · `for_each(fn(el)) -> None` |
| Reduce | `reduce(initial, fn(acc, el))` · `scan(initial, fn(acc, el)) -> Array` (running fold in East order) · `map_reduce(fn(el), reduce(a,b))` (raises on empty) · `sum(fn=None)` · `mean(fn=None) -> float` · `every(pred=None)` · `some(pred=None)` (native short-circuit) |
| Group | `group_fold(key(el), initial(gk), fold(acc, el)) -> Dict` · `group_size(key)` · `group_sum(key, fn=None)` · `group_mean(key, fn=None)` · `group_every/group_some(key, pred)` · `group_to_arrays/group_to_sets(key, value=None)` · `group_to_dicts(key, key2, value=None, combine=None)` |
| Flatten | `flatten_to_array(fn(el)->arr, out=…)` · `flatten_to_set(fn(el)->set, out=…)` · `flatten_to_dict(fn(el)->dict, combine=None)` (duplicate key errors without `combine`) — **pin `out`; the no-`out` inference path is broken** |
| Mutate (in place) | `add(item)` · `insert(value)` (errors if present) · `try_insert(value) -> bool` (True if newly added) · `remove(item)` · `delete(value)` (errors if absent) · `try_delete(value) -> bool` · `discard(item)` · `union_in_place(other)` (adds all of `other`) · `clear()` · `copy()` |

### EastDict — complete method surface

Mutable, **East-sorted by key**. `.key_type` / `.value_type`. **Callback arities differ:**
`map` takes `fn(value)` (no key); `filter`/`first_map`/`to_*`/`flatten_to_*`/`group_fold`/`map_reduce`
and the predicates/projections of `every`/`some`/`sum`/`mean` take `fn(key, value)`;
`reduce` takes `fn(acc, key, value)`; collision `combine` is
`combine(existing, incoming, key)` — for `union`/`union_in_place`/`merge` a 2-arg
`combine(existing, incoming)` is also accepted (a 3-arg one still receives the key).
`union`/`union_in_place` require `other` to have the same key AND value type (a
mismatch is refused, #529); `merge_all` needs only the same KEYS and is generic
in `other`'s values; `merge_key` takes a single differently-typed value.

| Group | Methods |
|-------|---------|
| Access | `d[k]` · `k in d` · `has(k)` · `len(d)`/`size()` · `get(k, default=None)` · `get_or_default(k, default)` · `try_get(k) -> some/none` · `keys()`/`values()`/`items()` |
| Combine | `union(other, combine=None) -> Dict` (NEW dict, both inputs untouched; a shared key errors without `combine`) · `union_in_place(other, combine=None) -> None` · `merge_all(other, merge(existing, incoming[, key]), default(key)) -> None` (fold `other` into self in place; `default` seeds absent keys; **generic in `other`'s value type** — only the KEYS must match) · `merge_key(key, value, update(existing, incoming[, key]), initial=None) -> None` (ONE key, in place; `value` may be a different type — TS's `DictExpr.merge`) · `get_keys(keys: Set, fill(k)) -> Dict` · ⚠️ `merge(other, combine=None)` is the DEPRECATED alias of `union` (#527) |
| Per-entry | `map(fn(value), out=None)` (a two-arg `fn(value, key)` also accepted) · `filter(pred(key, value))` · `filter_map(fn(key, value)->some/none, out=None)` · `first_map(fn(key, value)->some/none, out=None)` · `for_each(fn(key, value)) -> None` |
| Reduce | `reduce(initial, fn(acc, key, value))` · `scan(initial, fn(acc, key, value)) -> Array` (running fold in key order) · `map_reduce(map_fn(key, value), reduce_fn(a, b), out=None)` (raises on empty) · `sum(fn(key, value)=None)` · `mean(fn(key, value)=None) -> float` · `every(pred(key, value)=None) -> bool` · `some(pred(key, value)=None) -> bool` (native short-circuit) |
| Group | `group_fold(key_fn(key, value), init_fn(gk), fold_fn(acc, key, value), key_out=None, acc_out=None) -> Dict` · `group_size(key_fn)` · `group_sum(key_fn, fn=None)` · `group_mean(key_fn, fn=None)` · `group_every/group_some(key_fn, pred(key, value))` · `group_to_arrays/group_to_sets(key_fn, value_fn)` · `group_to_dicts(key_fn, key2_fn, value_fn, combine=None)` |
| Flatten | `flatten_to_array(fn(key, value)->arr)` · `flatten_to_set(fn(key, value)->set)` · `flatten_to_dict(fn(key, value)->dict, combine=None)` (a duplicate key errors without `combine`) |
| Convert | `keys_set() -> Set` · `to_array(fn(key, value), out=None)` · `to_set(fn(key, value), out=None)` · `to_dict(key_fn, value_fn, combine(existing, incoming, new_key), key_out=None, value_out=None)` · `copy()` |
| Mutate (in place) | `d[k]=v` · `del d[k]` · `insert(k, v)` (errors if present) · `get_or_insert(k, fn(k))` · `insert_or_update(k, v, combine(existing, incoming, k))` · `update(k, fn(current))` · `swap(k, v) -> prev` · `delete(k)` · `try_delete(k) -> bool` (`update`/`swap`/`delete` error on a missing key) · `pop(k, *default)` · `clear()` |
| Bulk (in place) | `update_many(keys, values, combine(existing, incoming)=None)` — the whole batch crosses once; a pure/precompiled `combine` resolves collisions C-to-C (dicts as hot-loop accumulators) |

### EastVector — complete method surface

Immutable 1-D numeric value — logical element type `Float`/`Integer`/`Boolean`, backed by a
contiguous NumPy buffer for zero-copy ML interop. The logical `.element_type` is fixed; the storage
`.dtype` may be any compatible width (e.g. f32). **No arithmetic methods** — do tensor math via
`to_numpy()`/`to_torch()` and wrap the result back. **Immutable:** `set`/transform return a NEW
vector; the original is unchanged. **Not hashable**, but valid as an East Set/Dict key (ordered by
value). Construct via the `EastVector.*` classmethods (see [Container generators](#container-generators-classmethods)); `from_numpy`/`from_torch` infer `element_type` from the array dtype when omitted.

| Group | Methods |
|-------|---------|
| Access | `get(i)` (promoted Python scalar) · `length() -> int` · `slice(start, end) -> EastVector` (half-open, contiguous copy) |
| Transform (returns new) | `set(i, v) -> EastVector` (original unchanged) · `concat(other) -> EastVector` (takes this vector's element type) |
| Per-element | `map(fn(el), out=None) -> EastVector` (runs in Python, not delegated; pin `out` to fix result element type / storage dtype) |
| Reduce | `fold(initial, fn(acc, el))` (left fold in Python; returns `initial` if empty) |
| Convert | `to_array() -> EastArray` (promotes scalars; severs the zero-copy link) · `to_matrix(rows, cols) -> EastMatrix` (row-major reshape; `rows*cols == length`) |
| NumPy / torch | `to_numpy(dtype=None, copy=False) -> ndarray` (read-only view by default; a cast or `copy=True` is writeable) · `to_torch(dtype=None) -> torch.Tensor` (always a writeable copy) · `np.asarray(v)` via `__array__` · props `.dtype` (storage) / `.element_type` (logical) |

### EastMatrix — complete method surface

Immutable 2-D row-major numeric value — logical element type `Float`/`Integer`/`Boolean`, backed by
a contiguous NumPy buffer. Logical `.element_type` is separate from storage `.dtype` (a Float matrix
may be stored f32). Same contract as `EastVector`: **no arithmetic** (use `to_numpy()`/`to_torch()`),
**immutable** (`set`/transform return a NEW matrix), **not hashable** but valid as an East Set/Dict
key. Construct via the `EastMatrix.*` classmethods (see [Container generators](#container-generators-classmethods)); `from_numpy`/`from_torch` infer `element_type` from the array dtype when omitted.

| Group | Methods |
|-------|---------|
| Access | `get(r, c)` (Python scalar) · `num_rows() -> int` · `num_cols() -> int` |
| Transform (returns new) | `set(r, c, v) -> EastMatrix` (original unchanged) · `transpose() -> EastMatrix` (new cols×rows, contiguous) |
| Rows & cols | `get_row(r) -> EastVector` (contiguous copy) · `get_col(c) -> EastVector` (contiguous copy) |
| Per-element & per-row | `map_elements(fn(el), out=None) -> EastMatrix` (row-major, no row/col index) · `map_rows(fn(row: EastVector), out=None) -> EastMatrix` (returned rows must share one width) |
| Convert | `to_vector() -> EastVector` (row-major flatten) · `to_array() -> EastArray` (`Array<Array<el>>`, one inner array per row) · `to_rows() -> EastArray` (`Array<Vector<el>>`, one `EastVector` per row) |
| NumPy / torch | `to_numpy(dtype=None, copy=False) -> ndarray` (2-D; read-only view by default) · `to_torch(dtype=None) -> torch.Tensor` (writeable copy) · `np.asarray(m)` via `__array__` · props `.dtype` / `.element_type` / `.rows` / `.cols` |

### EastBlob (a `bytes` subclass)

`EastBlob(b"...")` constructs like `bytes` and carries the **full `bytes` API** plus East methods:

| Signature | Description |
|-----------|-------------|
| `size() -> int` | Byte length (== `len(blob)`) |
| `get_uint8(i) -> int` | Unsigned byte at `i` (0–255) |
| `.data -> bytes` | Raw payload |
| `decode_utf8() -> str` / `decode_utf16() -> str` | Text decode |
| `EastBlob.encode_beast2(value) -> EastBlob` *(static)* | Serialize an East value to BEAST2 (type inferred via `type_of`) |
| `decode_beast2(typ) -> value` | Decode BEAST2 as `typ` |
| `decode_csv(element_type, config=None) -> EastArray` | Decode CSV rows into `Array<element_type>` (east-c decoder). Build `config` with `east.serialization.csv.csv_parse_config(...)`: by default **no field text is null** (empty field == empty string); opt in with `null_strings=[""]` (`none` for Option columns, error for required); `defaults={"qty": "0.0"}` gives per-column fallbacks for unparseable fields and constant-fill for absent columns |

### Beast2 streaming — bounded-memory collections (`from east.serialization.beast2 import ...`)

Beast2 v5 encodes a large Array/Set/Dict as an append-only segment stream:
writer memory is one batch (never the whole collection), decoders accept v4
and v5 through the same entry points, and each batch becomes one
independently decodable segment. Use for exports too big to hold, or to
re-read a huge file one batch at a time.

**Managed files — start here (`open_beast2_file` / `write_beast2_file`, #481).**
Path in, East values out — the file is self-describing, so reads need no
declared type (writes do; declaring one on a read validates it at open). The
file object owns the fd + mmap (closes on `with`-exit), east-c does all byte
work, and segment sizing is managed — no buffers, iterators, or batch sizes
in user code. The read flavor mirrors the root collection's read surface
name-for-name.

| Signature | Description |
|-----------|-------------|
| `write_beast2_file(path, T, value, *, codec="deflate", segment_rows=None)` | One call writes a collection of any size as one indexed v5 file, re-batched into managed-size segments (Array slices; Dict/Set split along sorted order, so segments stay key-disjoint) |
| `open_beast2_file(path, T, mode="w", *, codec=, segment_rows=)` | Streaming managed writer: `.write()` takes East collections **or** python builtins (list/dict/set), any size, re-batched internally; `.segments` counts them |
| `open_beast2_file(path, T=None)` | Read: returns the root-kind flavor — `Beast2ArrayFile` / `Beast2DictFile` / `Beast2SetFile`. `T` is optional (the self-describing header supplies it — also exposed as `f.wire_type`); a declared `T` is validated against the header, so a mismatch fails at open instead of decoding garbage |
| `read_beast2_type(source) -> EastType` | The root type embedded in any beast2-full blob (v4 **and** v5), from a path or buffer, no value decoded — regenerate loaders from artifacts alone, or inspect a file you know nothing about |
| `write_beast2_file_parallel(path, T, partitions, produce, *, processes=, strategy="auto", codec=, segment_rows=, keep_shards=False, verify=False)` | Partitioned parallel write to ONE file: `produce(partition)` runs per worker and returns that partition's batches (or one collection = one batch); each worker writes a private shard and the shards splice **in partition order**, incrementally, as they finish. `strategy="auto"` forks on Linux/macOS — whatever `produce` closes over is inherited copy-on-write, so build the expensive context before the call (and call before starting threads) — and runs inline on Windows: byte-identical output either way. Any worker failure (exception or signal) fails the whole call with the worker's traceback and leaves nothing behind |
| `splice_beast2_files(path, T, sources, *, verify=False) -> (segments, elements)` | Merge indexed v5 files into one by **byte copy** — east-c parses the container geometry, `os.sendfile` moves the segment frames, nothing decodes or re-encodes. `sources` may be a lazy generator (shards splice as they complete, in order = row order). Every source must be v5 + indexed + self-contained with an identical type section; refusals name the offending path and leave no destination. Output is indistinguishable from one writer given the same batches; `verify=True` re-walks it with east-c's strict sequential reader |
| `f.load()` | The whole collection, decoded entirely inside east-c off the mmap — input-side memory stays one segment at any file size |
| `f.segments()` | Yield one decoded collection per segment (process each batch with the native eager methods — never element-by-element from python) |
| `len(f)` · `f.segment_count` · `f.self_contained` · `f.indexed` | O(1) from the trailing index — counts are exact for every root kind (Set/Dict segments are disjoint ranges of the canonical value) |
| Array: `f[i]` / `f[a:b]` · `f.get(i)` ❗bounds · `f.get_or_default(i, d)` · `f.try_get(i)` → `some`/`none` · `f.has(i)` · `f.slice(a, b)` · `f.get_keys(rows)` | Same names, signatures and error semantics as `EastArray`; every point read decodes only the owning segment, `get_keys` decodes each owning segment once |
| Dict: `f[k]` ❗KeyError · `f.get(k, default=None)` · `f.get_or_default(k, d)` · `f.try_get(k)` → `some`/`none` · `f.has(k)` / `k in f` · `f.get_keys(keys, fill)` · `f.items()/keys()/values()` (streaming) · `f.keys_set()` (native per-segment union) · `f.size()` — Set: `x in f` / `f.has(x)` | Keyed reads (#481 W2): east-c binary-searches the segment *fences* — each segment's first key, decoded from a bounded probe of the frame's prefix and cached — then decodes ONLY the owning segment (a small LRU keeps hot segments). `get_keys` merges the sorted keys against the fences so each owning segment decodes once, and calls `fill` per missing key. Disjoint ascending segments are the v5 wire contract; the first keyed read still verifies the fences, and a corrupt (or pre-contract) blob raises `segments are not disjoint ascending key ranges` instead of reporting false misses |
| Array sorted search: `f.find_sorted_first/last(target)` → global index · `f.find_sorted_range(target)` → `{start, end}` | Same contract as the eager `EastArray` builtins over the whole file — the fences pick the boundary segment, its in-segment search adds the segment's base, and only that segment decodes. No `key=` projection (the file pages by element order); pair with `f.slice(start, end)` to fetch the matching rows |
| Compute (#481 W4): `f.map/filter/filter_map/first_map/fold/scan/map_reduce/sum/mean/maximum/minimum/every/some/find_first/find_all/find_maximum/find_minimum/is_sorted/to_set/unique/to_dict/to_array/to_columns/map_batches/string_join/flatten_to_array/set/dict/for_each` · the full `group_*` family (including `group_find_all/first/maximum/minimum`, whose indices are rebased to GLOBAL rows) · Set algebra (`union/intersect/diff/sym_diff/is_subset/is_superset_of/is_disjoint`) | The whole eager read surface, one segment decoded at a time: each segment runs the ordinary eager method — pure lambdas trace to kernels, precompiled kernels pass through — and partials combine through east-c containers in stream order. Order-dependent folds thread ONE accumulator and grouped folds SEED each segment's init from the running per-group accumulators, so results equal `load()` exactly, float ordering included. Array `(el, idx)` callbacks see GLOBAL row indices, and so do the indices `find_*`/`group_find_*` report; `first_map`/`some`/`every`/`is_superset_of` stop decoding at the answer. Dict/Set compute streams disjointness-verified segments (a corrupt blob fails loudly, like keyed reads). Re-keyed collisions in `to_dict`/`flatten_to_dict`/`group_to_dicts` combine left-associatively in stream order — use an associative `combine`. `sorted`/`reversed`/`copy`/`concat`/`merge` stay off the file (they materialize the whole collection — `load()` first) |
| Degraded blobs | v4 file → clear refusal (`decode_beast2_with_header_for` still decodes v4 whole); index-less v5 → `segments()`/`load()` work, random access refuses; non-self-contained → point reads refuse |

```python
from east.serialization.beast2 import open_beast2_file, write_beast2_file

write_beast2_file(path, rows_t, rows)             # any size, one call

with open_beast2_file(path) as f:                 # self-describing: type from the
    row = f[1_234_567]                            #   header (f.wire_type); pass rows_t
    totals = f.group_sum(lambda r: r["sku"],      #   instead to VALIDATE it at open
                         lambda r: r["qty"])      # whole-file compute: segment folds,
    top = f.maximum(by=lambda r: r["qty"])        #   never materialized, == load() exactly
    for batch in f.segments():                    # custom folds still stream batches
        consume(batch)                            #   (process each NATIVELY, never per row)
    table = f.load()                              # whole table when you truly need it
```

**Pick the right pair first — `_for` is NOT the same format as `_with_header_for`:**

| Signature | Description |
|-----------|-------------|
| `encode_beast2_with_header_for(T, *, version=None)` / `decode_beast2_with_header_for(T)` | **The one you want.** The full, self-describing container: magic + type schema + value. Encode writes the current default container (v5); pass `version=4` only for a reader that predates v5. Decode accepts v4 **and** v5 — it never needs a version |
| `encode_beast2_for(T)` / `decode_beast2_for(T)` | **Headerless** — raw type-directed bytes, no magic and no schema, so the reader must already know `T` exactly, and mutable containers (Array/Set/Dict/Ref) are rejected outright. Note this name means the *full container* in the TypeScript API (`encodeBeast2For`) — the two languages disagree, so do not port a call site by name |

| Signature | Description |
|-----------|-------------|
| `Beast2Writer(T, stream, *, codec="deflate", self_contained=True, index=True)` | Streaming writer (context manager): `.write(batch)` appends one segment per non-empty batch of `T`; `.close()` writes the terminator + paging index; `.segments` counts batches. Set/Dict batches must arrive in strict ascending East (key) order — segment content is the canonical value, so pre-sort into batches (what `open_beast2_file(mode="w")` does for you) or model arrival order as an Array. **Keep both defaults unless you know otherwise** — `index` writes the trailing offsets and `self_contained` keeps each segment independently decodable; together they are exactly what `open_beast2_pages_for` needs, and turning either off silently forfeits random access. `codec="none"` skips deflate: right for already-compressed payloads or maximum write throughput |
| `encode_beast2_segments_for(T, **opts) -> (batches) -> bytes` | In-memory convenience over the writer — one segment per non-empty batch |
| `encode_beast2_v5_for(T, *, codec="deflate", index=False) -> (value) -> bytes` | Whole-value v5 encode (any root type); decode with `decode_beast2_with_header_for` |
| `iter_beast2_segments_for(T) -> (source) -> iterator` | Yield one decoded collection per segment, O(segment) memory; `source` is bytes / `mmap` / binary stream |
| `decode_beast2_with_header_for(T) -> (blob) -> value` | Whole decode of v4 **or** v5 blobs (segments concatenate; Set/Dict wire must hold the canonical value — sorted, disjoint segments — and non-canonical blobs are rejected as corrupt) |
| `read_beast2_index(T, blob) -> (segments, elements) \| None` | O(1) totals from a v5 blob's trailing index |
| `open_beast2_pages_for(T) -> (source) -> Beast2Pages` | Random access: `.segment_count` `.element_count` `.self_contained` `.counts`, `.segment(i)`, `.element(row)` (also `len()`/`[]`). Seeks via the index and decodes ONE segment — O(segment), not O(blob). ❗Needs a blob written with `index=True` **and** `self_contained=True` (both default); `.element()` is Array roots only. ❗Borrows the source buffer — keep it alive (and an mmap open) for the pages' lifetime, or use `open_beast2_file`, which owns it |

**Batch size (buffer-level `Beast2Writer` only — the managed writer re-batches
for you).** A batch is simultaneously your memory ceiling, one segment, one
compression window, and the granularity of random access. ~1000 rows is a good
default: measured on 5000 struct rows, one row per batch costs **4x the bytes**
of 1000-per-batch (79,418 vs 20,066), and the curve is flat past ~100.
`write()` takes a batch, never a row — accumulate and flush yourself (or let
`open_beast2_file(..., mode="w")` do exactly that).

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

### EastStruct / EastVariant / EastRef

- **`EastStruct`** — frozen record; read fields by name: `s["price"]` or as an
  attribute, `s.price` (methods shadow same-named fields — item access always
  works). Build/transform with `struct({...}, StructType)`.
- **`EastVariant`** — frozen tagged value; `.type` is the case name, `.value` the payload.
  Build with `variant(case, value, T)` / `some` / `none`. Dispatch with the
  `.match({case: handler}, default=None)` method (handlers are `handler(payload)`;
  the module-level `match(v, cases, default)` is equivalent). Also `get_tag()`,
  `has_tag(tag)`, and `unwrap(tag)` ❗ValueError on a different case — mirroring
  the TS variant expr surface, and the same shapes trace inside kernels.
- **`EastRef`** — mutable cell: `get()` · `set(value)` · `update(fn(current))` ·
  `merge(patch, combine(current, patch))` (delegates to east-c `RefMerge`). Use `set`/`update`
  for a bare local `EastRef`; `merge` is for refs East passes a platform function.

### Container generators (classmethods)

east-py exposes **no** `East.Array`/`East.Set`/`East.Dict`/`East.Vector`/`East.Matrix` namespaces
(the only `East.<X>` namespaces are the scalar ones below). Factories are **classmethods** on the
container classes (snake_case):

| Signature | Example |
|-----------|---------|
| `EastArray.range(start, end, step=1)` | `EastArray.range(0, 5, 2)` → `[0, 2, 4]` |
| `EastArray.linspace(start, end, count)` | `EastArray.linspace(0., 1., 3)` → `[0.0, 0.5, 1.0]` |
| `EastArray.generate(count, fn(i), element_type=None)` | `EastArray.generate(3, lambda i: i*i, IntegerType)` |
| `EastSet.generate(n, fn(i), element_type=None)` | `EastSet.generate(4, lambda i: i % 2, IntegerType)` |
| `EastDict.generate(n, key_fn(i), value_fn(i), combine, key_type, value_type)` | `EastDict.generate(3, lambda i:i, lambda i:i*10, None, IntegerType, IntegerType)` |
| `EastVector.zeros/ones(element_type, length)` · `fill(element_type, length, value)` · `from_array(element_type, items)` · `from_numpy(array, element_type=None)` · `from_torch(tensor, element_type=None)` | `EastVector.zeros(FloatType, 3)` |
| `EastMatrix.zeros/ones(element_type, rows, cols)` · `fill(…, value)` · `from_array/from_rows(element_type, rows)` · `from_numpy(array, element_type=None)` · `from_torch(tensor, element_type=None)` | `EastMatrix.from_array(FloatType, [[1.,2.],[3.,4.]])` |

### East.<Type> scalar namespaces

Scalars are plain Python, so their builtins are namespace functions — **complete** lists below.
Every one delegates to east-c.

**`East.Float`** (f64)

| Signature | Notes |
|-----------|-------|
| `add(a,b)` · `subtract(a,b)` · `multiply(a,b)` · `divide(a,b)` · `remainder(a,b)` · `pow(base,exp)` | arithmetic |
| `negate(x)` · `abs(x)` · `sign(x)` · `sqrt(x)` · `exp(x)` · `log(x)` | unary / powers |
| `sin(x)` · `cos(x)` · `tan(x)` | trig |
| `to_integer(x) -> int` | raises on a non-integer float (e.g. `3.9`) |

**`East.Integer`** (i64)

| Signature | Notes |
|-----------|-------|
| `add(a,b)` · `subtract(a,b)` · `multiply(a,b)` · `divide(a,b)` · `remainder(a,b)` · `pow(base,exp)` | arithmetic (`divide` truncates) |
| `negate(x)` · `abs(x)` · `sign(x)` · `log(x, base)` | unary |
| `to_float(x) -> float` | widen to f64 |

**`East.String`**

| Signature | Notes |
|-----------|-------|
| `concat(a, b)` · `repeat(s, n)` · `substring(s, start, end)` · `length(s) -> int` | build / measure |
| `upper_case(s)` · `lower_case(s)` · `trim(s)` · `trim_start(s)` · `trim_end(s)` | case / whitespace |
| `replace(s, find, replacement)` · `split(s, separator) -> Array<String>` | edit / tokenize |
| `contains(s, substring)` · `starts_with(s, prefix)` · `ends_with(s, suffix)` · `index_of(s, substring) -> int` | search (`-> bool`/`int`) |
| `regex_contains(s, pattern, flags="")` · `regex_index_of(s, pattern, flags="")` · `regex_replace(s, pattern, replacement, flags="")` | regex |
| `parse(typ, s)` ❗ · `print(typ, value) -> str` | East **text** format; `parse` is a **strict whole-string** parser — trailing or leading junk raises (`"598-"`, `"$5"`, `"1.2.3"` all raise; in kernels use `.try_parse(T)` for the optional form) |
| `parse_json(typ, s)` · `print_json(typ, value) -> str` | East **JSON** (`Integer` encodes as a JSON *string*: `print_json(ArrayType(IntegerType), [1,2,3]) == '["1","2","3"]'`) |

**`East.DateTime`** (see [DateTime format codes](#datetime-format-codes))

| Signature | Notes |
|-----------|-------|
| `from_components(year, month, day, hour, minute, second, millisecond)` | construct |
| `from_epoch_milliseconds(millis)` · `to_epoch_milliseconds(dt) -> int` | epoch round-trip |
| `get_year/get_month/get_day_of_month/get_day_of_week(dt) -> int` | `get_day_of_week`: Monday == 1 |
| `get_hour/get_minute/get_second/get_millisecond(dt) -> int` | components |
| `add_milliseconds(dt, millis)` · `duration_milliseconds(a, b) -> int` | `duration` returns **a − b** |
| `add_/subtract_{seconds,minutes,hours,days,weeks}(dt, n)` | unit sugar over `add_milliseconds` (int or float `n`) |
| `duration_{seconds,minutes,hours,days,weeks}(a, b) -> float` | unit sugar over `duration_milliseconds` |
| `print_format(dt, fmt) -> str` · `parse_format(s, fmt) -> datetime` | Day.js-style tokens |

**`East.Boolean`**

| Signature | Notes |
|-----------|-------|
| `not_(x)` · `and_(a, b)` · `or_(a, b)` · `xor(a, b)` | logical |

**`East`** comparisons (East total order; element type `T` first): `compare(T, a, b) -> int`,
`equal/not_equal/less/less_equal/greater/greater_equal(T, a, b) -> bool`.

**`East`** structural diff/patch (any East type `T`; a patch is a value of `PatchType(T)`):

| Signature | Notes |
|-----------|-------|
| `diff(before, after) -> patch` | The patch turning `before` into `after` (types inferred) |
| `apply_patch(value, patch) -> value` | Apply; `apply_patch(v, diff(v, w)) == w` |
| `compose_patch(T, first, second) -> patch` | One patch equal to applying `first` then `second` |
| `invert_patch(T, patch) -> patch` | The undo: applying patch then its inverse round-trips |

### DateTime format codes

`print_format(dt, fmt)` / `parse_format(s, fmt)` take a Day.js-style string; tokens match
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
East.DateTime.print_format(dt, "YYYY-MM-DD HH:mm:ss.SSS")    # '2025-03-05 14:09:07.123'
East.DateTime.print_format(dt, "dddd, MMMM D, YYYY h:mm A")  # 'Wednesday, March 5, 2025 2:09 PM'
```

### Platform functions

| Signature | Description |
|-----------|-------------|
| `@platform_function(*, inputs, output, name=None, validate_output=True, validate_input=False)` | Register a Python fn; infers sync/async from the def; validates output against `output` |
| `@generic_platform_function(*, type_parameters, name=None, is_async=False)` | Type-parameterized factory: the decorated fn is `fn(platform, *type_params) -> impl`; `is_async` is **explicit** (not inferred) |
| `platform_functions(module) -> list` | Collects every decorated fn in `module` (pass `__name__`). Two consumers: `compile()` for in-process use, and a package's top-level `platform` list that `east-py run -p <module>` (and the e3 `{ custom }` runner) loads |
| `@memoize` / `@memoize(salt="…")` / `memoized = memoize(fn, salt="…")` | Content-addressed memo over ONE platform function. Apply **above** `@platform_function` (or inline on an imported one). Key = sha256(name + salts + per-input digests of the with-header BEAST2 encodings via the declared input types); value = with-header BEAST2 of the output, decoded via the declared output type. Inert by default |
| `configure_memo(directory, salt="")` | Activate (`None` deactivates) memoization for `@memoize` functions; overrides `EAST_MEMO_DIR` / `EAST_MEMO_SALT` env vars. Bump `salt` to invalidate after code edits — input-derived keys can't see them |

## Key Patterns

### The canonical platform function

```python
from east import (FloatType, StringType, StructType, ArrayType,
                  platform_function, struct)

LineItem = StructType([("name", StringType), ("price", FloatType)])   # Struct<String, Float>

@platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    # items: an east-c-backed array with eager methods; row["price"] is a plain float
    return items.map(lambda row: struct(
        {"name": row["name"], "price": row["price"] * fx_rate},   # plain f64 * f64
        LineItem,                                                 # tag + validate the result
    ))
```
`.map` runs the lambda in Python (the callback *is* the work); `struct(..., LineItem)`
validates each row; the decorator validates the `Array<LineItem>` result — a named
`EastTypeError` instead of silent corruption.

### Project-owned platform module (calling your Python from e3)

To call a Python platform function from an **e3 task**, package it so `east-py
run -p <module>` can load it: each module ends with `<name>_impl =
platform_functions(__name__)`, and the package `__init__.py` aggregates them into
a top-level `platform` list (the same shape as east-py-std / east-py-datascience).

```python
# platform_module/forecast.py
@platform_function(inputs=[ArrayType(FloatType)], output=FloatType,
                   name="my_project.forecast")   # dotted "<project>.<fn>"; MUST byte-match
def forecast(history):                            # the TS East.platform(...) declaration
    return sum(history) / len(history) if history else 0.0
forecast_impl = platform_functions(__name__)

# platform_module/__init__.py
from .forecast import forecast_impl
platform = [*forecast_impl]                        # what `east-py run -p platform_module` loads
```

The e3 task wires it with `{ runtime: "east-py", platforms: [{ custom:
"platform_module" }, "east-py-std"] }`. East code needs a TS `East.platform(
"my_project.forecast", [...], ...)` **declaration** with the identical name (no
codegen). Add native deps (numpy, …) to `pyproject.toml` and run `uv sync`. See
**east-project** for the full scaffold (`--platform`) and the setuptools
packaging; **e3** for the runner.

### Memoize expensive pure stages (dev/test harnesses)

```python
from east import configure_memo, memoize, platform_function

@memoize                      # eligibility — the author asserts purity
@platform_function(inputs=[ArrayType(RowType), ConfigType], output=ModelType)
def train_model(rows, config): ...

# A test harness flips the whole package on with one call (or EAST_MEMO_DIR):
configure_memo("/tmp/my_project", salt="v1")    # None deactivates
loaded = memoize(other_pkg.load_csv, salt=file_digest)   # inline, per-call salt
```

The platform-function boundary is the cache boundary, e3-style: hit = decode the
stored BEAST2 blob via the declared output type (skipping the body entirely),
miss = compute + atomic save. Only mark functions **pure in their East inputs** —
a hit on a function that writes files/rows/requests silently drops those effects.
Stochastic fits memoize their first realization. Code edits don't change keys —
bump the salt. Inert with no directory configured: under e3, the dataflow's
content-addressed task cache is the real memo and this stays off.

### Fork-parallel export of a huge table (one file out)

The shape for "N CPUs on one table": build the expensive shared context once,
let forked workers inherit it copy-on-write, and ship a single indexed file —
consumers never learn the export was parallel. (Windows runs the same contract
inline, sequentially; the output is byte-identical either way.)

```python
from east.serialization.beast2 import open_beast2_file, write_beast2_file_parallel

ROW = StructType([("order_id", StringType), ("qty", IntegerType), ("total", FloatType)])

lookups = load_reference_tables()          # multi-GB keyed dicts: built ONCE, pre-fork,
                                           # inherited COW — never pickled, never rebuilt

def produce(span):                         # runs in the worker process
    start, count = span                    # yield batches of any size — the managed
    for chunk in chunk_ranges(start, count, 8192):   # writer re-batches into segments
        yield compute_rows(lookups, chunk)           # eager methods + kernels: native

write_beast2_file_parallel(
    "orders.beast2", ArrayType(ROW),
    partitions=row_ranges(total_records, shards=13),  # partition order = row order
    produce=produce,
    processes=13,          # a worker failure kills the rest, cleans up, re-raises
)

# Consumers — e.g. the table's @platform_function loader — see ONE file, no
# catalog, no shard names, and read it at one segment of memory:
@platform_function(inputs=[StringType], output=ArrayType(ROW))
def load_orders(path):
    with open_beast2_file(path, ArrayType(ROW)) as f:
        return f.load()    # or stream f.segments() and never hold the table
```

Shards produced by your own process topology (or on another machine)? Merge
them directly — same one-writer output guarantee, pure byte copy:

```python
splice_beast2_files("orders.beast2", ArrayType(ROW), sorted(shard_paths), verify=True)
```

### Keyed lookups against a file too big to load

A reference table exported as a Dict file answers point reads without ever
being held in memory: east-c fence-searches the segment index and decodes
one segment per lookup, so a sparse join against a multi-GB file stays
cheap. (A *dense* pass over most keys is still better as whole-file compute
— `f.group_sum(...)`, `f.filter(...)`, any read method directly on the file
— or a `segments()` scan for a custom fold.)

```python
from east.serialization.beast2 import open_beast2_file

with open_beast2_file("orders.beast2") as orders:   # Dict<String, Order>, type from header
    order = orders[order_id]                        # fence search → ONE segment decode
    hot = orders.get_keys(wanted_ids, lambda k: default_order)   # each owning segment
    if candidate_id in orders:                      #   decodes once for the whole batch
        ...

# A sorted Array file answers range queries the same way — global insertion
# indices, then slice exactly the covered rows:
with open_beast2_file("events.beast2") as events:   # Array<Event> sorted by timestamp
    span = events.find_sorted_range(cutoff_event)
    window = events.slice(span["start"], span["end"])
```

### Sort uses East's total order

```python
# WRONG — Python's default ordering (incorrect for floats/NaN, mixed, type-specific)
sorted(list(arr))

# CORRECT — East total order, in east-c
arr.sorted()                      # new array
arr.sort()                        # in place
arr.sorted(key=lambda r: r["x"])  # by a projection, still East-ordered
```

### Scalars: use the `East.<Type>` utilities for consistency — above all String & DateTime

East scalars *are* Python scalars, so Python operators run on them — but the
`East.<Type>` namespaces (and `East.less`/`compare`/`equal`) are the standardised
ops that give the **same** answer in Python, C, TS, and cached e3 tasks. Python's
`str` methods, `re`, `datetime`, `strftime`, `//`, and `<` drift by
engine / locale / timezone; the East functions do not. Use them for anything with
divergent semantics — and **always** for strings and dates.

```python
# String — East.String.*, not Python str/re: split edge cases, the regex engine,
# trim's whitespace set, and JSON encoding all differ from Python
East.String.split("a,b,c", ",")               # East semantics, not str.split
East.String.regex_replace(s, r"\d+", "#")     # East regex engine, not Python re
East.String.trim(s)                           # East's whitespace set
East.String.print_json(IntegerType, 5)        # '"5"' — Integer is a JSON *string* in East

# DateTime — East.DateTime.* only. East DateTime is UTC; tokens are Day.js, not strftime
East.DateTime.add_milliseconds(dt, 86_400_000)          # +1 day, not dt + timedelta(days=1)
East.DateTime.duration_milliseconds(a, b)               # a − b (ms), standardised
East.DateTime.get_day_of_week(dt)                        # Monday == 1, not dt.weekday() (== 0)
East.DateTime.print_format(dt, "YYYY-MM-DD HH:mm:ss")   # Day.js tokens, not dt.strftime("%Y-…")

# Ordering / equality — East total order (NaN-correct, mixed types, variants-by-name)
East.less(FloatType, a, b)                     # not  a < b   /  sorted(...)
# Integer is i64 — divide truncates; Python's unbounded int can overflow i64
East.Integer.divide(7, 2)                      # 3
# (you also can't method-call a Python float/str — the ops live on the namespace)
East.Float.sqrt(2.0)                           # not (2.0).sqrt()
```


### torch interop (in a torch-having package, inline — no helpers)

```python
import torch, numpy as np
t   = mat.to_torch()                              # writeable torch copy of the buffer
out = EastMatrix(FloatType, model(t).detach().cpu().numpy())   # bridge canonicalizes dtype
```

## Related skills

`east-py` is the Python runtime: East values as plain Python data plus the `@platform_function`
on-ramp. Load the skill that matches what you are adding:

- **east** — the TypeScript `East.function` DSL. Use it to *author* East programs (types,
  expression builders, `East.compile`); use `east-py` to run/inspect values and write Python
  platform functions. The two share the same type system and IR.
- **east-py-datascience** — Python platform functions for ML and optimization (XGBoost, LightGBM,
  Optuna, MADS, PyMC, SHAP, Torch, GoogleOR, Simulation). The home once a `@platform_function`
  POC needs a real model or solver.
- **east-py-std** / **east-py-io** — the platform functions on the Python runtime:
  Console/FileSystem/Fetch/Crypto/Time/Random, and SQL/NoSQL/S3/FTP/SFTP/XLSX/XML/compression —
  each `*_impl` directly callable with East values. (Their TypeScript authoring siblings are
  **east-node-std** / **east-node-io**.)
- **e3** — run compiled East functions as durable, content-addressed dataflow tasks; wire a
  project-owned Python platform module via a `{ custom: 'platform_module' }` task runner.
- **east-project** — scaffold (`--platform`) and package a project-owned platform module (the
  `*_impl` → `platform` aggregation, `east-py run -p`, dotted names, the TS declaration mirror).
- **e3-create** — scaffold a *dedicated* Python platform package with `--python-packages=<name>`
  (a uv workspace member, its own auto-derived e3 environment) instead of the single `--platform` module.
- **east-design** — start here when you have a goal but no architecture yet.
