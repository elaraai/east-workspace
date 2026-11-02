# Key patterns

Part of the `east-py` skill.

## Contents

- Python values vs East expressions
- The canonical platform function
- Project-owned platform module (calling your Python from e3)
- Memoize expensive pure stages (dev/test harnesses)
- Fork-parallel export of a huge table (one file out)
- Keyed lookups against a file too big to load
- Sequential logic that stays in east-c (worklist / replay)
- Trees from flat rows, and recursion
- Sort uses East's total order
- Scalars: use the `East.<Type>` utilities for consistency — above all String & DateTime
- torch interop (in a torch-having package, inline — no helpers)


## Python values vs East expressions

The `east` skill's first rule, in python: a body's PARAMETERS are expressions;
a python value used inside a body must lift. Scalars lift on their own; a
collection must be an explicit choice.

```python
RATES = EastDict(StringType, FloatType, {"AUD": 0.65})   # python-side East value
CUTOFF = 100

@East.function([Row], FloatType)
def usd(b, r):
    return East.if_else(r.amount > CUTOFF,                # a scalar constant lifts (TS East.value)
                        r.amount * RATES.get_or_default(r.ccy, 1.0),   # an EXPLICIT build snapshots the dict: a literal, rebuilt per call
                        0.0)

rows.map(lambda b, r: r.amount * RATES.get_or_default(r.ccy, 1.0))   # ❌ an eager callback REFUSES
                                                                    #    the collection capture:
conv = East.function([Row, DictType(StringType, FloatType)], FloatType,
                     lambda b, r, t: r.amount * t.get_or_default(r.ccy, 1.0))
rows.map(conv.bind(RATES))                                          # ✅ bind it: live, zero-copy
```

## The canonical platform function

```python
from east import East, FloatType, StringType, StructType, ArrayType, struct

LineItem = StructType([("name", StringType), ("price", FloatType)])   # Struct<String, Float>

@East.platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    # items: an east-c-backed array with eager methods; row["price"] is a plain float
    return items.map(lambda b, row: struct(
        {"name": row["name"], "price": row["price"] * fx_rate},   # plain f64 * f64
        LineItem,                                                 # tag + validate the result
    ))
```
`.map` builds the lambda into an East function — the loop and the row construction run
in east-c, with `fx_rate` baked in as a constant; `struct(..., LineItem)` is dual-mode, so
the same spelling builds the row here and on plain values; the decorator validates the
`Array<LineItem>` result — a named `EastTypeError` instead of silent corruption.

## Project-owned platform module (calling your Python from e3)

To call a Python platform function from an **e3 task**, package it so `east-py
run -p <module>` can load it: each module ends with `<name>_impl =
East.platform_functions(__name__)`, and the package `__init__.py` aggregates them into
a top-level `platform` list (the same shape as east-py-std / east-py-datascience).

```python
# platform_module/forecast.py
@East.platform_function(inputs=[ArrayType(FloatType)], output=FloatType,
                   name="my_project.forecast")   # dotted "<project>.<fn>"; MUST byte-match
def forecast(history):                            # the TS East.platform(...) declaration
    return sum(history) / len(history) if history else 0.0
forecast_impl = East.platform_functions(__name__)

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

## Memoize expensive pure stages (dev/test harnesses)

```python
from east import East, configure_memo, memoize

@memoize                      # eligibility — the author asserts purity
@East.platform_function(inputs=[ArrayType(RowType), ConfigType], output=ModelType)
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

## Fork-parallel export of a huge table (one file out)

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
    for chunk in chunk_ranges(start, count, 8192):   # writer cuts the canonical segments
        yield compute_rows(lookups, chunk)           # eager methods + East functions: native

write_beast2_file_parallel(
    "orders.beast2", ArrayType(ROW),
    partitions=row_ranges(total_records, shards=13),  # partition order = row order
    produce=produce,
    processes=13,          # a worker failure kills the rest, cleans up, re-raises
)

# Consumers — e.g. the table's @East.platform_function loader — see ONE file, no
# catalog, no shard names, and read it at one segment of memory:
@East.platform_function(inputs=[StringType], output=ArrayType(ROW))
def load_orders(path):
    with open_beast2_file(path, ArrayType(ROW)) as f:
        return f.load()    # or compute on f directly, never holding the table
```

Shards produced by your own process topology (or on another machine)? Merge
them directly — a pure byte copy, nothing re-encoded:

```python
splice_beast2_files("orders.beast2", ArrayType(ROW), sorted(shard_paths), verify=True)
```

## Keyed lookups against a file too big to load

A reference table exported as a Dict file answers point reads without ever
being held in memory: east-c fence-searches the segment index and decodes
one segment per lookup, so a sparse join against a multi-GB file stays
cheap. (A *dense* pass over most keys is still better as whole-file compute
— `f.group_sum(...)`, `f.filter(...)`, any read method directly on the file.)

```python
from east.serialization.beast2 import open_beast2_file

with open_beast2_file("orders.beast2") as orders:   # Dict<String, Order>; Order = Struct{id, total}
    order = orders[order_id]                        # fence search → ONE segment decode
    hot = orders.get_keys(wanted_ids,               # each owning segment decodes once;
                          lambda b, k: {"id": k, "total": 0.0})   # `fill` is a body (a python dict
    if candidate_id in orders:                      #   captured from outside is refused)
        ...

# A sorted Array file answers range queries the same way — global insertion
# indices, then slice exactly the covered rows:
with open_beast2_file("events.beast2") as events:   # Array<Event> sorted by timestamp
    span = events.find_sorted_range(cutoff_event)
    window = events.slice(span["start"], span["end"])
```

## Sequential logic that stays in east-c (worklist / replay)

When the next step depends on the last — a worklist, a BFS, a fixpoint, a
topological replay — no `map`/`filter`/`group_reduce` expresses it, and a
python loop over decoded rows is the whole job's cost. The statement surface
threads the state through the loop natively, so the whole thing is ONE
compiled function. Two rules carry most of the weight. **Accumulate in
place** — a collection threaded through a state is rebuilt every iteration,
so `order.concat(...)` is O(n²) over the loop where `order.push_last(...)` is
O(1). And **a mutation is a statement** — `b.do(acc.push_last(x))` in a
statement body, `East.block(acc.push_last(x), result)` in an expression body;
a bare `acc.push_last(x)` line is evaluated at build time and thrown away
(the build raises rather than compile a loop that silently does nothing).

```python
from east import ArrayType, DictType, East, IntegerType, StringType

Node, Edges = StringType, DictType(StringType, ArrayType(StringType))
Indeg = DictType(StringType, IntegerType)

# Kahn's algorithm — ONE compiled function, the TypeScript `$` shape: a
# worklist the loop appends to, a cursor into it, and per-node successors
# decremented in place.
@East.function([ArrayType(Node), Edges, Indeg], ArrayType(Node))
def topo_order(b, roots, succ, indeg):
    ready = b.const(roots.copy())          # task inputs arrive frozen: copy
    remaining = b.const(indeg.copy())
    order = b.const(East.new_array(Node))
    i = b.let(0)

    def step(b, label):
        node = b.const(ready.get(i))
        b.do(order.push_last(node))

        def visit(b, v):
            b.do(remaining.insert_or_update(v, -1, lambda _b, old, d: old + d))
            b.if_(remaining.get(v) == 0, lambda b: b.do(ready.push_last(v)))

        b.for_(succ.get_or_default(node, East.new_array(Node)), visit)
        b.assign(i, i + 1)

    b.while_(i < ready.size(), step)
    return order

@East.platform_function(inputs=[ArrayType(Node), Edges, Indeg], output=ArrayType(Node))
def replay_order(roots, succ, indeg):
    return topo_order(roots, succ, indeg)
```

The same algorithm as EXPRESSION forms — a state struct threaded through
`East.while_`/`East.for_`, the shape that fits inside a one-expression
callback:

```python
topo_order = East.function(
    [ArrayType(Node), Edges, Indeg], ArrayType(Node),
    lambda b, roots, succ, indeg: East.while_(
        {"ready": roots.copy(), "indeg": indeg.copy(),
         "order": East.new_array(Node), "i": 0},
        cond=lambda b, s: s.i < s.ready.size(),
        body=lambda b, s: East.let(s.ready.get(s.i), lambda b, node: East.block(
            s.order.push_last(node),
            East.for_(
                succ.get_or_default(node, East.new_array(Node)),
                {**s, "i": s.i + 1},                      # inner loop's state
                lambda b, t, v: East.block(
                    t.indeg.insert_or_update(v, -1, lambda b, old, d: old + d),
                    East.if_else(t.indeg.get(v) == 0,     # newly ready?
                                 East.block(t.ready.push_last(v), t),
                                 t))))),                  # else: unchanged
    ).order)

# any carried state — a forward fill is a `for_` whose state remembers the last value
forward_fill = East.function(
    [ArrayType(StringType)], ArrayType(StringType),
    lambda b, cells: East.for_(
        cells, {"last": "", "out": East.new_array(StringType)},
        lambda b, s, cell: East.let(
            East.if_else(cell == "", s.last, cell),
            lambda b, v: East.block(s.out.push_last(v), {"last": v, "out": s.out}))).out)
```

To stop early, put `East.break_(state)` in an `if_else` arm — the state
argument commits before the jump, so the answer survives; `East.label(...)` on
an outer loop lets an inner one break all the way out. Reach for all of this
only when the work is genuinely sequential: a `group_reduce` or a `reduce` is
both shorter and faster when it fits.

## Trees from flat rows, and recursion

`to_tree` builds nested data — any depth, your own node type — from rows that
name their key and their parent's key. `build` runs once per row, children
first; the result is the roots in source order. The walk is iterative, in
east-c, on values and in a body alike:

```python
from east import ArrayType, OptionType, StringType, StructType, recursive_type

Row = StructType([("id", StringType), ("parent", OptionType(StringType)), ("name", StringType)])
Node = recursive_type(lambda self: StructType([("name", StringType), ("children", ArrayType(self))]))

roots = rows.to_tree(Node,
                     lambda b, r: r.id,
                     lambda b, r: r.parent,
                     lambda b, r, _i, children: {"name": r.name, "children": children})
```

- A row whose parent is `none` is a root, and so is an orphan (its parent key
  is not in the rows). A repeated key ❗ `toTree: duplicate key <key>`; a cycle
  ❗ `toTree: cycle through key <key>` — both before any `build`.
- A non-recursive `Node` folds bottom-up: `IntegerType` with
  `children.sum() + 1` is each root's subtree size. A Set's element and a
  Dict's key are their own keys, so those take no `key`.

`flatten_tree` is the way back: every node of nested data, each with its path
of keys (a Dict's) or indices (an Array's) from its root, depth first — each
node before its descendants, siblings in key or array order. `children` names a
node's children, of the collection's own type:

```python
from east import DictType, FloatType, StringType, StructType, recursive_type

Part = recursive_type(lambda self: StructType([("name", StringType), ("cost", FloatType), ("parts", DictType(StringType, self))]))

nodes = parts.flatten_tree(lambda b, part: part.unwrap().parts)
# an Array of {path, node}: ["pump"], ["pump", "motor"], ["pump", "motor", "rotor"], ["pump", "seal"]
```

- An Array of `{path, node}`, not a Dict keyed by path: a Dict key is
  immutable, and a path is an Array. `to_tree` over it, keyed by `path` and
  parented by `path` less its last step, rolls the tree up at every root.
- `children` runs once per node, in the result's order. Each path is an array
  of its own, so a chain n deep holds n(n+1)/2 path elements.
- **Recursion** — a function calling itself through a captured variable — is
  for shallow depths, in the hundreds. Deeper, a call ❗ `call stack exhausted:
  East calls nested too deeply`, a catchable `EastError` on every runtime. Walk
  deep data with `b.while_`, `to_tree` or `flatten_tree`; a recursive VALUE's depth is still
  bounded, at tens of thousands of levels, by east-c's recursive collect and
  free.

## Sort uses East's total order

```python
# WRONG — Python's default ordering (incorrect for floats/NaN, mixed, type-specific)
sorted(list(arr))

# CORRECT — East total order, in east-c (the TypeScript names)
arr.sort()                        # new array
arr.sort_in_place()               # in place
arr.sort(lambda b, r: r["x"])     # by a projection, still East-ordered
```

## Scalars: use the `East.<Type>` utilities for consistency — above all String & DateTime

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
East.DateTime.print_formatted(dt, "YYYY-MM-DD HH:mm:ss")   # Day.js tokens, not dt.strftime("%Y-…")
East.Float.print_currency(total)                         # "$1,234.57" — the stdlib, same in TS

# Ordering / equality — East total order (NaN-correct, mixed types, variants-by-name)
East.less(FloatType, a, b)                     # not  a < b   /  sorted(...)
# Integer is i64 — divide truncates; Python's unbounded int can overflow i64
East.Integer.divide(7, 2)                      # 3
# (you also can't method-call a Python float/str — the ops live on the namespace)
East.Float.sqrt(2.0)                           # not (2.0).sqrt()
```

## torch interop (in a torch-having package, inline — no helpers)

```python
import torch, numpy as np
t   = mat.to_torch()                              # writeable torch copy of the buffer
out = EastMatrix(FloatType, model(t).detach().cpu().numpy())   # bridge canonicalizes dtype
```
