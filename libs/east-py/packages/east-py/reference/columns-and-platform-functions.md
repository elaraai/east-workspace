# Columnar escape hatches, platform functions, and what is not east-c

Part of the `east-py` skill.

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
acc.update_many(keys, values, combine=lambda b, cur, new: cur + new)  # one crossing,
                                                            # combine builds -> collisions in C
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
list. Composition rule: **East functions for East-expressible transforms,
columns/batches for the genuinely-python remainder.**

**Put the logic in the platform function, not a pure-python shim.** A
`@East.platform_function` is just a typed, validated python function; its one
added cost, validating the declared output, is a feature. A separate helper layer
over `list`/`dict` that the platform function converts into and out of costs
**testability** (the typed `inputs`/`output` is the contract you test; untyped
helpers turn bugs into silent corruption instead of a named `EastTypeError`),
**portability** (a platform function over East values moves to an e3 task,
another runtime or a TypeScript mirror unchanged), a **forced sandwich**
(East→python on the way in, back on the way out) and **purity** (a platform
function pure in its East inputs is memoisable). Small reusable functions are
fine — have them take and return East values, pay output validation only at the
real East↔python edge, and never call a platform function per element in a loop.

## Platform functions

| Signature | Description |
|-----------|-------------|
| `@East.platform_function(*, inputs, output, name=None, is_async=None, validate_output=True, validate_input=False)` | Register a Python fn; infers sync/async from the def (`is_async=` declares it when they differ — a function East calls asynchronously on every runtime whose python is a plain `def`); validates output against `output`. DUAL-MODE: called with values it runs the python (an async def's coroutine, to await); called inside an `East.function` / `East.asyncFunction` body it emits the `Platform` node with this signature — an async one inside a sync body is the build-time error. Paired at compile by name (the def's, or `name=`). Also importable bare: `from east import platform_function` |
| `@East.generic_platform_function(*, type_parameters, name=None, is_async=False, inputs=None, output=None, type_erased=False)` | Type-parameterized factory: the decorated fn is `fn(platform, *type_params) -> impl`; `is_async` is **explicit** (not inferred). With `inputs=`/`output=` (placeholders allowed anywhere: `output="T"`, `output=ArrayType("T")`) it is dual-mode too: `fs_open_beast(DictType(K, V), path)` in a body — the type arguments first, as TypeScript reads — emits the generic node; without them a body call is a build error naming what to declare. `type_erased=True` when the implementation ignores the type arguments (it reads the values): the decorated fn IS the implementation, python calls it directly (`causal_experiment(rows, config)`) and the factory the runtime binds is derived |
| a platform function RETURNING a lazy value | A `@platform_function` may return a paged hold — an `open_beast2_file(...)` value, `open_paged_file(T, path)` (a C-owned mapping), `fs_open_beast(...)`'s result — and the compiled body keeps its O(segment) cost model: the C value crosses the return seam by pointer (checked against the declared output type, never re-marshalled through python), and nothing python-side has to outlive it: the mapping is the value's own. The mirror of a paged ARGUMENT crossing in |
| `East.platform_functions(module) -> list` | Collects every decorated fn in `module` (pass `__name__`). Two consumers: `East.compile()` for in-process use, and a package's top-level `platform` list that `east-py run -p <module>` (and the e3 `{ custom }` runner) loads |
| `@memoize` / `@memoize(salt="…")` / `memoized = memoize(fn, salt="…")` | Content-addressed memo over ONE platform function. Apply **above** `@East.platform_function` (or inline on an imported one). Key = sha256(name + salts + per-input digests of the with-header BEAST2 encodings via the declared input types); value = with-header BEAST2 of the output, decoded via the declared output type. Inert by default |
| `configure_memo(directory, salt="")` | Activate (`None` deactivates) memoization for `@memoize` functions; overrides `EAST_MEMO_DIR` / `EAST_MEMO_SALT` env vars. Bump `salt` to invalidate after code edits — input-derived keys can't see them |

## What is NOT east-c

Nearly everything above delegates to native builtins. What still runs python,
so you can reason about cost and semantics:

- **`EastMatrix.map_elements`** — DEPRECATED: a python callback per element,
  the one shape the strict surface removes; it warns and will go. Use the
  arithmetic / reduction / mask / sparse methods, `map_rows`, or
  `to_numpy()`/`to_torch()`. (`Vector.map`/`reduce` and `Matrix.map_rows` are the
  native VectorMap / VectorFold / MatrixMapRows builtins.)
- **`Dict.get_or_insert`** composes membership and get python-side so `fn` runs
  only on a miss (lazier than East's strict default). The other singles
  (`insert`/`update`/`swap`/`delete`/`try_delete`/`insert_or_update`) are the
  native builtins, error messages included.
- **Reduction sugar** — `mean`, `group_mean`, `group_size`, …: several native
  passes, zero python per element, but not one fused builtin (as in TypeScript).
- **Boundary utilities** — `coerce_to`/`assert_value_of`/`type_of`, `variant`/
  `struct` validation, `match()` dispatch, `compare_for`/`make_east_key`: python
  walkers, by design — they are the python↔East edge.
- **Iteration** — `for x in arr` / `list(arr)` boxes per element (lazily, under
  East's iteration lock, so mutating during the loop raises `Cannot modify …
  during iteration`, as an East for-loop does); cross once with
  `to_columns`/`to_numpy` instead.
