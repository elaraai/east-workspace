# Control flow, jq, and what a body may reference

The expression forms of control flow, `East.jq`, and the captures a body accepts or refuses. Part of the `east-py` skill.

## Contents

- Control flow — the expression forms (`East.while_`, `East.for_`, …)
- Queries — `East.jq`
- What a body may reference

## Control flow — the expression forms (`East.while_`, `East.for_`, …)

Prefer the collection methods: `map`/`filter`/`reduce`/`group_reduce`
express most work and are the fastest thing in the runtime. Reach here when
the next step **depends on the last** — a worklist, a BFS, a fixpoint, a
topological replay — which no data-parallel method can express. The
statement forms above (`b.while_`, `b.for_`) build the same nodes; these are
their EXPRESSION twins, usable inside a callback or a one-expression body.

Python cannot overload `=`, and `while`/`if` collapse to a `bool` before any
build sees them. That is the constraint that produced `East.if_else`, and the
answer is the same shape: **`while_` is to `while` what `if_else` is to `if`**.
The body is a pure function of the state that RETURNS the next state, and the
state struct IS the loop's local variables:

```python
total = East.while_({"i": 0, "acc": 0},
                    cond=lambda b, s: s.i < n,
                    body=lambda b, s: {"acc": s.acc + s.i, "i": s.i + 1}).acc

# `East.if_else` is the `if`; a field left as `s.field` is the empty else;
# `{**s, …}` changes one field and keeps the rest
East.for_(rows, {"n": 0, "hi": 0.0},
          lambda b, s, r: {"n": s.n + 1,
                           "hi": East.if_else(r.price > s.hi, r.price, s.hi)})
```

This lowers to a `Ref` holding the state, a `While`/`For*` node whose body is
one `RefUpdate`, and a final read — the whole loop runs inside east-c. Every
construct is dual-mode like `East.if_else`: outside a build it runs the plain
python loop, so one body serves both a callback and a direct call on plain
East values. A worked example is in
[Key Patterns](patterns.md#sequential-logic-that-stays-in-east-c-worklist--replay).

| Call | Emits | Notes |
|---|---|---|
| `East.if_else(cond, value, …, otherwise)` | `IfElse` | cond/value pairs then the else — an if/elif/else chain is ONE node; exactly one arm evaluates |
| `East.while_(state, cond, body, label=…)` | `While` | `cond(b, s) -> Boolean`, `body(b, s) -> next state` |
| `East.for_(coll, state, body, label=…)` | `ForArray`/`ForSet`/`ForDict` | Array `body(b, s, el[, i])`, Set `body(b, s, el)`, Dict `body(b, s, k, v)` |
| `East.block(a, b, …)` | `Block` | evaluates in order, yields the last — the sequencing point for mutators (`East.block(lambda b: …)` is the statement form) |
| `East.let(value, fn)` | `Let` | `fn(b, bound)` — bind once, use many times, inside an expression body (`b.const` is the statement form) |
| `East.ref(v)` | `NewRef` | a cell — `.get()` / `.update(v)` / `.merge(v, fn(b, current, patch))` |
| `East.label(name=None)` | — | names a loop, for `break_`/`continue_` from a NESTED one |
| `East.break_(state=…, label=…)` / `East.continue_(state=…, label=…)` | `Break` / `Continue` | leave / next iteration, optionally committing a last state |
| `East.try_catch(body, handler, finally_=None)` | `TryCatch` | `body(b)`, `handler(b, message[, stack])`, same East type as `body` |
| `East.new_array/new_set/new_dict(…)` | `NewArray`/`NewSet`/`NewDict` | a FRESH collection per evaluation — the loop accumulator |
| `East.new_vector(T, values)` / `East.new_matrix(T, rows, cols, values)` | `NewVector`/`NewMatrix` | a fresh tensor from scalar expressions |

**Accumulate in place.** Threading a collection through the state rebuilds it
every iteration (`order.concat(…)` copies — O(n²) over the loop). The
mutators extend it in O(1). Each returns what its EAGER twin returns, so
sequence with `East.block`; a mutation written as a bare statement is
evaluated and thrown away, and the build says so rather than compiling a
loop that silently does nothing:

```python
counts = East.for_(rows, {"counts": East.new_dict(StringType, IntegerType)},
                   lambda b, s, r: East.block(
                       s.counts.insert_or_update(r.sku, 1, lambda b, x, y: x + y),
                       s)).counts
```

⚠️ Seed accumulators with `East.new_array/new_set/new_dict`. A captured
`EastArray(T)` works too — a captured collection is a snapshot of its
contents, rebuilt wherever the body reads it, so a seed is fresh per call —
but mutating one anywhere ELSE changes a copy nothing else sees, and the
build raises rather than compile a mutation that persists nowhere.

## Queries — `East.jq`

`East.jq(input, program, result_type)` is a jq query as East code: the jq is
parsed, checked against the input's East type and translated to ordinary East
IR when the program is built — loops, `Match`, the builtins — so it runs
wherever East runs, with no interpreter. In a body it is a call of the `Query`
builtin, which carries the program as written beside its translation and gives
the translation, so `to_python_source` prints it back as `East.jq(…)`. It is
the twin of TypeScript's `East.jq` and builds the same IR. Dual-mode, like the
standard library: in a body it builds the call; on values it compiles the
translation (once per query and input type) and runs it now.

```python
from east import East, ArrayType, FloatType, IntegerType, StructType, array

Order = StructType([("id", IntegerType), ("total", FloatType)])
orders = array(Order, [{"id": 1, "total": 250.0}, {"id": 2, "total": 1200.0}])

# in a body: an expression of `result_type` (here an ArrayExpression), so its methods chain
count_big = East.function([ArrayType(Order)], IntegerType,
                          lambda b, orders: East.jq(orders, "[.[] | select(.total > 1000) | .id]",
                                                    ArrayType(IntegerType)).size())
count_big(orders)                                   # 1

East.jq(orders, "map(.total) | add", FloatType)     # 1450.0 — on values, run now

# several inputs: a dict, checked as an e3 root — `.orders` reads the `orders` input alone
East.jq({"orders": orders, "limit": 1000.0},
        ".limit as $l | [.orders[] | select(.total > $l) | .id]", ArrayType(IntegerType))   # [2]
```

| | |
|---|---|
| ❗ `result_type` | Required: the outputs' type for a query that gives one output (`length`, `[…]`, `reduce`), an `Option` of it for at most one (`first(f)`), an `Array` of it for any number (`.[] \| .id`). The query must check to exactly it, or the build raises `type_mismatch: the query gives Array<Float>, not the Integer it was given.` |
| A query that does not check | `QueryError` when the program is built (a `QueryBuildError`, an `ExpressionError` too), its diagnostics each `jq <line>:<column>: <message>`: `unknown_field: .totl is not a field of Struct{id: Integer, total: Float}. Did you mean .total?` |
| An error the query raises | `error(v)`, an integer `% 0`, a date that does not parse: an East runtime error located in the jq text (`jq 1:5`), which `b.try_` catches; on values, a `QueryError` with one `runtime` diagnostic |
| The input's type | In a body, the expression's; on values, `type_of(value)`. Where that is narrower than the type meant (a variant's is its one case), run `evaluate_jq(program, value, input_type=T)` |
| The language | jq 1.8 over East's types: Dict keys of any type, DateTime a type (an ISO literal compares with it), Integers exact, a variant read as `{type, value}`. Every departure is listed in `libs/east/devdocs/QUERY.md` §13 |
| Host tools (`from east.query import …`) | `check_jq(program, input_type, root=False)`, without building: the program as written (`.program`, a `JqType` tree whose constants are typed East values; `None` when it does not check), the type it was checked against (`.input_type`), its `.element_type` and `.multiplicity` (`"one"` / `"maybe"` / `"many"`; `None` when it does not check), the datasets a root query reads (`.reads`) and its `.diagnostics`. A query's types are never stored: check the program against its data wherever they are needed · `evaluate_jq(program, value, input_type=T)`: a query whose input type is data · `translate_jq(checked)` · `parse_jq` / `print_jq` / `lex_jq` · `QueryError` |

## What a body may reference

- Its own parameters; plain scalar constants (closure floats / ints / strings /
  datetimes bake in — the same value per element either way); East types and
  values (`east_null` included); the `East` namespace, `East.if_else` included;
  the `struct`/`variant`/`some`/`none` constructors (dual-mode: they build IR
  when handed expression fields); **East.function artifacts** (dual-mode: a
  call of their inline Function node at any nesting depth); **compiled East function values**
  (`.bind` results, `compile_from_*` functions — a CALL on one lowers to a native
  IR `Call`); and, two wrapper levels deep — enough for helper lambdas that
  compose a callback — other python functions that pass the same rules.
- Anything else RAISES an `ExpressionError` **naming the binding**: a module
  (`random.…`, `np.…`), a python builtin (`len`, `str`), a mutable python
  capture, closure mutation (`nonlocal x; x += 1`). A closed-over East
  *collection* raises in an eager callback too — a capture snapshots, `.bind`
  stays live, and which you meant is your choice: an explicit `East.function`
  snapshots a side table, `.bind(table)` keeps it live. For genuine python
  semantics write an explicit python loop outside the body. Side effects are
  therefore never lost or silently doubled: the body runs once, at build time, or
  not at all.
- Arithmetic follows East types exactly: no implicit Integer↔Float mixing
  (`.to_float()` / `.to_integer()` convert), and `/` is Float division.
- Captures are CACHED: an eager callback whose code object, captured bindings
  and declared signature match an earlier call reuses its compiled function, so
  the per-group aggregate `group_to_arrays(key).to_array(lambda b, es, k: {…})`
  builds each inner lambda once, not once per group. ⚠️ A lambda whose CAPTURES
  change per call (`lambda b, r: r.v > g` in a python loop over `g`) rebuilds
  every call, since each capture bakes into a different function — hoist an
  `East.function(...)` and pass the varying value as a bound parameter.
