---
name: east-py
description: "East in Python (east-py): (A) East EXPRESSIONS — East functions written in python with East.function / East.asyncFunction, the block `b` (TypeScript's `$`), the TypeScript methods snake_cased, the standard library, East.compile; (B) East VALUES — East data as ordinary python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant/Ref/Blob) whose eager methods run in east-c under the same names. Use when writing python against east-py: (1) an East function in python (b.let/b.if_/b.for_, expression methods, the stdlib), (2) building and validating values (array/struct/variant/some/none, coerce_to/assert_value_of), (3) transforming values with eager methods (sort/map/filter/reduce/group_*/set algebra/dict merge), (4) scalar builtins via East.<Type>, (5) @East.platform_function to expose python to East, (6) beast2 files larger than memory, numpy/torch through EastVector/EastMatrix, (7) porting a plain-python POC into a platform function, (8) the east-py CLI — run, exec, convert, transpile, export-functions, lint, check, lsp, version, (9) exporting functions for TypeScript / e3 and importing TypeScript-authored ones (East.export_functions / East.import_function), (10) edit-time diagnostics (east-py lint, flake8 EAS codes, east-py check, east-py lsp), (11) JSON Schema contracts (json_schema_for, type_from_json_schema), (12) typed jq queries over East values (East.jq, and east.query's check_jq / evaluate_jq)."
---

# East.py — East expressions and East values in Python

`east-py` is the Python runtime for East: a Cython bridge to the native **east-c**
runtime, where IR compilation, the builtin library, execution and serialization
all run. Its two surfaces share one vocabulary — the TypeScript method names,
snake_cased:

- **East expressions** — East *functions* written in python, as the TypeScript
  `east` skill writes them. `East.function(param_types, out, body)` runs `body`
  ONCE over typed expression proxies (the block `b` first — TypeScript's `$`),
  records IR, and east-c compiles it. Every East type has an expression class
  (`ArrayExpression`, `IntegerExpression`, …) mirroring `libs/east/src/expr/*.ts`
  method for method, plus the standard library (`East.Integer.print_compact`,
  `East.DateTime.round_down_week`, …) and the statements (`b.let`, `b.if_`,
  `b.while_`, `b.for_`, `b.match_`, `b.try_`, `b.return_`). What East cannot
  express raises at build time — there is no interpreter behind it.
- **East values** — the data. `EastArray`/`EastSet`/`EastDict`/`EastVector`/
  `EastMatrix`/`EastStruct`/`EastVariant`/`EastRef`/`EastBlob` are handles into
  the east-c value slab; scalars are plain `int`/`float`/`str`/`bool`/`datetime`.
  Their **eager methods** — the same names — run in east-c now, and chain.
  `@East.platform_function` exposes a python function to East.

They meet twice: a **callback** handed to an eager method (`items.map(lambda b,
r: …)`) is an East function body — captured once, compiled, run natively per
element, never per-element python — and an `East.function` is a plain callable
on values that every eager method accepts. (The TypeScript DSL: the `east`
skill. ML and optimisation platform functions: `east-py-datascience`.)

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

The index holds two separate sets of python, for two different jobs:

- **East functions written in python** (East expressions: `East.function`, the
  block `b`). Search with `language: "python"`; every core example comes back
  printed as python.
- **Python working with East values directly** (the eager methods on
  `EastArray`, `EastDict`, …, outside any `East.function`, as a platform
  function or script does). Search with `package: "east-values"`. Each of these
  is generated from a core example's IR and checked to give that example's
  result. A search that does not name `east-values` never returns them.

Nothing is injected for you; the search is the step.

## Quick Start

```python
from east import East, ArrayType, FloatType, StringType, StructType, array, struct

LineItem = StructType([("name", StringType), ("price", FloatType)])   # types take PAIRS

# ── East EXPRESSIONS: an East function — the block `b` first, then the parameters ──
@East.function([ArrayType(LineItem), FloatType], StringType)
def receipt(b, items, fx):
    total = b.let(0.0)                                   # $.let
    def add(b, r, _i):                                   # a body: the block, then the callback's arguments
        b.assign(total, total + r.price * fx)            # $.assign
    b.for_(items, add)                                   # $.for
    b.if_(total > 1000.0,                                # $.if … $.return
          lambda b: b.return_(East.str("big order: ", East.Float.print_currency(total))))
    return East.str("total: ", East.Float.print_currency(total))   # East.str`…`; the stdlib is the TS one

# ── East VALUES: East data as ordinary python; eager methods run NOW in east-c ──
items = array(LineItem, [{"name": "a", "price": 1}, {"name": "b", "price": 2.0}])  # coerced + validated
dear  = items.filter(lambda b, r: r.price >= 2.0).sort(lambda b, r: r.price)        # callbacks are bodies
receipt(items, 1.5)                                   # "total: $4.50" — an artifact is a callable on values
East.Float.sqrt(2.0); East.String.upper_case("hi")    # scalar builtins live on East.<Type>

# ── Expose python to East — typed, validated, auto-collected ──
@East.platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    return items.map(lambda b, r: struct({"name": r.name, "price": r.price * fx_rate}, LineItem))

platform = East.platform_functions(__name__)   # pass to East.compile(fn, platform=…) to register
```

## The two surfaces

| | East expressions | East values |
|---|---|---|
| What you hold | typed expression proxies: `IntegerExpression`, `ArrayExpression`, … (the TS `IntegerExpr`, `ArrayExpr`, …) | runtime data: `int`/`float`/`str`/`bool`/`datetime`, `EastArray`, `EastDict`, `EastStruct`, `EastVariant`, … |
| Where | inside an `East.function` / `East.asyncFunction` body, a statement body, and EVERY callback handed to an eager method | everywhere else — a `@East.platform_function` body, a script, a test |
| A method call | records an IR node (`xs.map(f)` is `ArrayMap`); the body runs ONCE, at build time | executes now in east-c (`xs.map(f)` runs the loop natively) and returns a live value |
| Names | the TypeScript names, snake_cased (`push_last`, `flatten_to_set`, `print_formatted`); python-idiom spellings (`fold`, `sorted`, `keys_set`, `upper`, …) are DEPRECATED aliases that warn | the same names — the eager class and the expression class agree method for method |
| Scalars | methods on the expression (`x.abs()`, `s.upper_case()`, `d.add_days(1)`) — or the `East.<Type>` namespace | the `East.<Type>` namespaces only (you cannot add methods to `float`/`str`) |
| Conditionals / loops | `East.if_else`, `b.if_`, `b.while_`, `b.for_`, `East.while_`/`for_` — python `if`/`while` collapse to a `bool` before the build sees them | plain python |
| An option | `.is_some()` / `.is_none()` / `.unwrap_or(d)` / `.match({…})` | an `EastVariant` — the SAME accessors, plus `.type` / `.value` / `.unwrap(tag)` |
| Errors | an operation East cannot express raises `ExpressionError` at BUILD time, naming the binding or method | a runtime `EastError` / `EastTypeError` |

A body's parameters are expressions already. A python scalar or `datetime` inside
a body lifts to a literal; `East.value(v, T)` / `b.const(v)` lift anything else
(TS `East.value` / `$.const`); an East COLLECTION an `East.function` body closes
over is snapshot into the IR as a literal of its contents, rebuilt wherever the
body reads it — `t = b.const(table)` builds it once per call, and `.bind(table)`
as a trailing parameter keeps it live. The other way, an artifact is a plain
callable on values, every eager method accepts one (a VALUE takes no block),
and one called inside another body is a call of its inline Function node — see
[Python values vs East expressions](reference/patterns.md#python-values-vs-east-expressions).

## Decision Tree: What Do You Need?

Each leaf names the section holding the whole surface for it; [Reference files](#reference-files) says which file holds each section.

```
Task → What do you need?
    │
    ├─ A. Write an East function in python — East expressions (the `east` skill's twin, name for name)
    │   ├─ Types (PAIRS, not a dict) → IntegerType · FloatType · StringType · BooleanType · DateTimeType · BlobType · NullType ·
    │   │   ArrayType(T) · SetType(K) · DictType(K, V) · RefType(T) · VectorType(T) · MatrixType(T) (T ∈ Float/Integer/Boolean) ·
    │   │   StructType([("f", T), …]) · VariantType([("case", T), …]) · OptionType(T) · recursive_type(lambda self: …) ·
    │   │   FunctionType(I, O) · AsyncFunctionType(I, O)                                 → "Type System Summary"
    │   ├─ Author → East.function([T…], Out, lambda b, x: …) · @East.function([T…], Out) def f(b, x) · East.asyncFunction ·
    │   │   ❗ out is required · a pure one is a callable on values · f.bind(table) pre-binds trailing parameters BY REFERENCE
    │   │                                                                        → "Declare, implement, build, compile"
    │   ├─ Statements on the block `b` (TS `$`) → b.let · b.const · b.assign · b.do · b.return_ · b.error · b.if_ … .else_if … .else_ ·
    │   │   b.while_ · b.for_ · b.break_ / b.continue_ · b.match_ · b.try_ … .catch … .finally_ · East.block(lambda b: …)
    │   │                                                                        → "Every body takes the block first"
    │   ├─ Methods and operators (the TS methods, snake_cased) ❗ // % ** / on an Integer RAISE, with the fix-it
    │   │                                                                        → "The expression surface, type by type"
    │   ├─ The standard library, dual-mode → East.Integer / Float / DateTime / String / Blob / Boolean .* · East.str · East.print ·
    │   │   East.min / max / clamp · East.equal / less / compare(T, a, b) → "The standard library" and "East.<Type> namespaces"
    │   ├─ The next step depends on the last (worklist · BFS · fixpoint · replay) → b.while_ / b.for_, or the expression forms
    │   │   East.while_ / for_ / if_else / let / block / try_catch · East.new_array / new_set / new_dict accumulators ·
    │   │   East.break_ / continue_ / label → "Control flow — the expression forms", "Sequential logic that stays in east-c"
    │   ├─ Nest flat parent-keyed rows (any depth) → xs.to_tree(Node, key, parent, build) — not recursion, which is for
    │   │   shallow depths                                                     → "Trees from flat rows, and recursion"
    │   ├─ Flatten nested data back to {path, node} rows, depth first → xs.flatten_tree(children) (an Array's or a Dict's)
    │   │                                                                      → "Trees from flat rows, and recursion"
    │   ├─ Query a value with jq → East.jq(input, "jq", result_type) ❗ result_type is required, and types the result ·
    │   │   a dict of inputs is read as an e3 root                              → "Queries — East.jq"
    │   ├─ What a body may capture — and what it refuses, naming the binding → "What a body may reference"
    │   ├─ Call python from a body → the @East.platform_function you hold IS the Platform node (no declaration) · East.platform /
    │   │   asyncPlatform / genericPlatform only for one implemented elsewhere · East.compile(fn, platform=East.platform_functions(__name__))
    │   │                                                                        → "Declare, implement, build, compile", "Platform functions"
    │   ├─ Make it fast → data stays in East · chain · bind shared work with b.const · b.const a captured table, .bind big ones
    │   │                                                                        → "Performance — the levers, ranked"
    │   ├─ IR ↔ python → to_python_source · east-py transpile · compile_from_beast2 / json / east / value · east-c ir …  → "IR ↔ python"
    │   ├─ Refusals at edit time → east-py lint · flake8 --select EAS · east-py lsp; TYPE errors → east-py check
    │   │                                                                        → "Diagnostics at edit time"
    │   └─ Across languages → east_functions = {"name": fn} · East.import_function · East.link_imports · east-py export-functions
    │                                                                            → "Cross-language functions"
    │
    ├─ B. Work with East values — the eager runtime (the same names, run NOW in east-c; results stay C-side and chain)
    │   ├─ Build one → array · struct · variant · some / none · east_ref · EastBlob(b"…") · EastVector / EastMatrix (numpy) ·
    │   │   coerce_to(value, T) (type-driven: int→Float, dict→Struct, 1-D numpy→Array) · validate at a python ↔ East boundary with
    │   │   assert_value_of ❗ · explain_value_of · is_value_of · type_of                → "Construction & validation"
    │   ├─ Transform → map · filter · reduce · scan · sort · group_* · to_dict · to_tree · set algebra · dict union / merge · …, each callback
    │   │   an East function body — and keep the data in East: never down-convert to list/dict/set, loop, and rebuild
    │   │   → "Work in East values", "Eager callbacks", then "EastArray — complete method surface" and its siblings
    │   ├─ Generate → EastArray.range / linspace / generate · EastSet / EastDict.generate · EastVector / EastMatrix.zeros / ones /
    │   │   fill / from_array / from_numpy / from_torch                                    → "Container generators"
    │   ├─ Scalars (float / int / str / bool / datetime take no methods) → East.Float / Integer / String / DateTime / Boolean.* ·
    │   │   East.less / compare / equal(T, a, b) — never python's str / re / datetime / // / < for these
    │   │                                                        → "East.<Type> namespaces", "Scalars: use the `East.<Type>` utilities"
    │   ├─ Diff / patch two values → East.diff / apply_patch / compose_patch / invert_patch(T, …) → "East.<Type> namespaces"
    │   ├─ Query one with jq → East.jq(value, "jq", T) runs now · evaluate_jq(program, value, input_type=T) · check_jq checks
    │   │   without running                                                    → "Queries — East.jq"
    │   ├─ A JSON contract another system validates against → json_schema_for · type_from_json_schema   → "A JSON contract"
    │   ├─ A collection file larger than memory → write_beast2_file · open_beast2_file (a read-only East collection value) ·
    │   │   write_beast2_file_parallel · splice_beast2_files · Beast2ManifestWriter · open_beast2_pages_for  → "Beast2 streaming"
    │   ├─ Logic genuinely needs python (numpy, a model, a solver) → to_columns · from_columns · map_batches · update_many ·
    │   │   extend · to_numpy / to_torch                                                   → "Columnar escape hatches"
    │   └─ Let East call python → @East.platform_function · @East.generic_platform_function · @memoize → "Platform functions"
    │
    ├─ C. Cross between them → a body's parameters are expressions · python scalars and datetimes lift · East.value(v, T) /
    │   b.const(v) · a captured East collection is a build-time SNAPSHOT, a literal rebuilt at each read (an eager callback
    │   refuses it) — b.const(table) builds it once per call, .bind(table) keeps it live · an East function is a callable on
    │   values, and a VALUE takes no block · east.runtime.compiler.eager_stats() shows how a hot call ran
    │                                                                   → "Python values vs East expressions", "Performance"
    │
    └─ D. Run a program from the shell → east-py run (IR + input files → a result) · exec (a unit: the runner protocol e3
        speaks) · convert (a beast2 value → East text) · version · where its time goes: --profile / EAST_PROFILE=1
                                                                                                  → "The east-py CLI"
```

## Type System Summary

Every East type has an expression class (what a body holds — the TS
`IntegerExpr`/`ArrayExpr`/… twins, from `east.expression.expr`) and a python
value (what you hold outside). Scalars are plain python objects, so their
builtins live on the `East.<Type>` namespaces; the rest are `East*` containers
that carry their element type and have eager methods. Only
`EastArray`/`EastSet`/`EastDict`/`EastRef` mutate in place — `EastStruct`,
`EastVariant`, `EastVector` and `EastMatrix` are immutable (`set` returns a new
tensor).

| East type | Expression class (in a body) | Python value (eager) | Mutability |
|-----------|------------------------------|----------------------|------------|
| `NullType` | `NullExpression` | `None` (validates); the canonical value is the `east_null` sentinel | Immutable |
| `BooleanType` | `BooleanExpression` | `bool` | Immutable |
| `IntegerType` | `IntegerExpression` | `int` (i64) | Immutable |
| `FloatType` | `FloatExpression` | `float` (f64) | Immutable |
| `StringType` | `StringExpression` | `str` | Immutable |
| `DateTimeType` | `DateTimeExpression` | `datetime.datetime` (UTC) | Immutable |
| `BlobType` | `BlobExpression` | `EastBlob` (a `bytes` subclass); `.data` is `bytes` | Immutable |
| `ArrayType(T)` | `ArrayExpression` | `EastArray` (indexable, iterable) | **Mutable** |
| `SetType(K)` | `SetExpression` | `EastSet` (East-sorted) | **Mutable** |
| `DictType(K, V)` | `DictExpression` | `EastDict` (East-sorted by key) | **Mutable** |
| `VectorType(T)` | `VectorExpression` | `EastVector`; 1-D numpy buffer via `.to_numpy()` | Immutable |
| `MatrixType(T)` | `MatrixExpression` | `EastMatrix`; 2-D row-major numpy buffer via `.to_numpy()` | Immutable |
| `StructType([("field", T), …])` | `StructExpression` (`r.field` / `r["field"]`) | `EastStruct` (`s["name"]` / `s.name`) | Immutable (frozen) |
| `VariantType([("case", T), …])` | `VariantExpression` | `EastVariant` (`.type` tag, `.value`; compared **by case name**) | Immutable (frozen) |
| `RefType(T)` | `RefExpression` | `EastRef` (cell; `.get()` / `.update(v)` / `.merge()`) | **Mutable** |
| `FunctionType(I, O)` / `AsyncFunctionType(I, O)` | `FunctionExpression` / `AsyncFunctionExpression` (callable in a body) | an `East.function` artifact / `EastFunction` | Immutable |
| `recursive_type(…)` / a diverging body | `RecursiveExpression` / `NeverExpression` | the wrapped value / — | — |

`VectorType`/`MatrixType` elements are `FloatType`, `IntegerType` or `BooleanType`;
a narrower numpy dtype (f32, …) is canonicalized to East's width (Float→f64,
Integer→i64, Boolean→u8) crossing into east-c. `PatchType(T)` (from
`east.types.types`) is the type of a structural patch of a `T`.

## East values — the eager runtime

### Work in East values — don't round-trip through Python

Inside a `@East.platform_function`, or any east-py code over runtime data, **do
the work with the East values you were handed and their chained eager methods.
Never down-convert to a python `list`/`dict`/`set`, loop in the interpreter, and
rebuild an East value** — the most common way east-py gets used badly, and it
changes both cost and correctness:

- **Speed.** An eager method hands the value's pointer to the native builtin
  with no copy and returns a new handle, so
  `a.filter(...).group_by(...).map(...)` runs traversal, allocation, ordering and
  set/dict algebra in C and the data never leaves it. Down-converting is an O(n)
  decode, an interpreter loop and an O(n) re-encode, every time. (A tensor's
  `to_numpy()` is a zero-copy view; a python element loop is not.)
- **Correctness.** East methods use East's *total order* and equality (right
  for floats and NaN, mixed types, variants by name) and keep Sets and Dicts
  deterministically ordered; `sorted()`, a bare `dict` or `set()` get these
  subtly wrong and diverge from the other runtimes.
- **Intermediates too, not just the boundary.** The failure is the *sandwich* —
  East in → python `list`/`dict` logic → East out. If the logic is
  East-expressible (mapping, filtering, grouping, joining, reducing, set/dict
  algebra), every intermediate stays an east-c value. Prefer the declarative
  reducers (`reduce`/`map_reduce`/`group_reduce`/`to_dict(..., combine=…)`) over
  ANY hand-rolled accumulation: a reducer is one native call, while a manual loop
  — python, or repeated `EastRef`/`EastDict` updates — pays an FFI crossing per
  element. Cross to numpy/torch only for work East cannot express, and wrap the
  result back. Bare scalars stay plain python — an East `Float` *is* a `float`;
  don't wrap a running sum in an `EastRef`.
- **Chain, don't stage.** Each method returns a live east-c value: keep piping
  (`arr.filter(...).to_dict(...).map(...)`) rather than binding intermediates to
  python names and re-wrapping them. Cross to python only at the edges — a
  scalar for `East.Float.*` math, a buffer via `to_numpy()`/`to_torch()`.
- **Scalars and dates** — see [Scalars](reference/patterns.md#scalars-use-the-easttype-utilities-for-consistency--above-all-string--datetime):
  the `East.<Type>` utilities for anything whose semantics diverge, and ALWAYS
  `East.DateTime.*` for dates.

| Instead of (pure Python) | Write (East values) |
|---|---|
| `[dict(r) for r in items]` then Python loops | keep `items` as the `EastArray`; `.map`/`.filter`/`.group_by`/`.reduce` |
| `sorted(items, key=…)` / `sorted(list(arr))` | `items.sort(lambda b, r: …)` (East order, in C) |
| `{r["k"]: r for r in items}` | `items.to_dict(lambda b, r: r["k"])` |
| `set(a) & set(b)` / `set(a) - set(b)` | `a.intersection(b)` / `a.difference(b)` |
| `EastArray(T, [f(x) for x in arr])` | `arr.map(f)` (pin `out=` for a widening map) |
| a `for` loop that sums/accumulates | `arr.reduce(lambda b, acc, x: …, init)` / `arr.map_reduce(…)` |
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
        .group_by(lambda b, r: r["region"])                                       # Dict<region, Array<row>>
        .map(lambda b, rows: rows.reduce(lambda b, acc, r: acc + r["amount"], 0.0)) # Dict<region, total>
        .to_array(lambda b, total, region: struct({"region": region, "total": total}, Row)))
```

### Eager callbacks are East function bodies

An eager method and its expression twin are ONE builtin with two entry points:
`xs.map(f)` on an `EastArray` runs `ArrayMap` in east-c now; on an
`ArrayExpression` it records the `ArrayMap` node. The callback is a body either
way, and an eager callback slot takes exactly two kinds of function:

1. **A python body, captured automatically** — the block first, then the
   builtin's callback arguments (`lambda b, el: …`; trailing arguments may be
   omitted, the block cannot), built as an `East.function` against the builtin's
   declared signature. The whole expression surface is available; east-c
   compiles it, and the loop AND the body run natively, zero python per element.
   Every transform is pure, so a `record → legs → values` descent, or a
   `group_by` + `to_dict(combine=)` + `sort` aggregate, is ONE compiled function
   with no materialised intermediate:

   ```python
   rows    = EastBlob(csv_bytes).decode_csv(Row)          # C-backed Array<Row>
   amounts = rows.map(lambda b, r: r.price * r.qty)          # a body -> native
   hot     = rows.filter(lambda b, r: (r.sku == "A-1") & (r.price > 100.0))
   total   = rows.reduce(lambda b, acc, r: acc + r.price, 0.0) # multi-param bodies too
   by_sku  = rows.group_by(lambda b, r: r.sku)               # fully native grouping
   top     = rows.sort(lambda b, r: -r.price)
   spend   = rows.to_dict(key=lambda b, r: r.sku,
                          value=lambda b, r: r.price * r.qty,
                          combine=lambda b, x, y: x + y)
   ```

2. **A precompiled East function** — `East.function(...)`, a `.bind(...)`
   result, or one compiled elsewhere (`compile_from_beast2/json/east`, or
   `compile_from_value` for IR built with `east.ir.builders`). Its native
   function value passes **straight through** every eager method — the loop runs
   entirely in east-c, and the output type comes from its own signature (no
   `out=`, no sampling; an `out=` or declared type that contradicts it raises
   `EastTypeError` at the call). An artifact is **dual-mode**: on values it runs
   natively, and inside another body it is a call of its inline Function node
   (`East.function([Row], FloatType, lambda b, r: amount(r) * 1.1)`), whose
   field reads still narrow a column projection.
   A compiled value (a `.bind` result) cannot re-run a body, so a body that CALLS
   one lowers to an IR `Call`: the callee rides as a hidden bound parameter, and
   loop, body and callee all run in east-c. `FunctionType` PARAMETERS are
   first-class — callable in the body, bindable with function values (calling an
   `AsyncFunctionType` value in a sync body is a named `ExpressionError`):

   ```python
   amount = East.function([Row], FloatType, lambda b, r: r.price * r.qty)
   for blob in batches:
       out = blob.decode_csv(Row).map(amount)          # reuse — no rebuild
                                                       # (a VALUE takes no block)
   step = East.function([FloatType, Row], FloatType,   # fold arity
                        lambda b, acc, r: acc + r.price)
   k = compile_from_beast2(bytes_)                     # compiled in TS

   conv = East.function([Row, TableT], FloatType,
                        lambda b, r, t: t.get_or_default(r.sku, 0.0))
   rows.map(conv.bind(table))   # bind a live side-table BY REFERENCE
   ```

Anything else in a callback slot RAISES — there is no third kind. The
callback-free operations (`sort`, `unique`, `union`/`intersection`/`difference`,
`concat`, `group_by`, `to_dict`/`to_set`, `find_sorted_*`) always run the whole
loop in east-c. The TypeScript compliance corpus is replayed through these eager
methods, builtin by builtin, and must give the compiled programs' answers.

## Reference files

Read the one a task needs; each holds its sections whole.

| File | Sections |
|---|---|
| [reference/writing-east-functions.md](reference/writing-east-functions.md) | Declare, implement, build, compile · Every body takes the block first · The expression surface, type by type · The standard library |
| [reference/control-flow-and-queries.md](reference/control-flow-and-queries.md) | Control flow — the expression forms · Queries — `East.jq` · What a body may reference |
| [reference/performance.md](reference/performance.md) | Performance — the levers, ranked |
| [reference/ir-and-diagnostics.md](reference/ir-and-diagnostics.md) | IR ↔ python · Diagnostics at edit time |
| [reference/cross-language.md](reference/cross-language.md) | Cross-language functions |
| [reference/values-construction-and-json.md](reference/values-construction-and-json.md) | Construction & validation · A JSON contract for a type |
| [reference/value-methods.md](reference/value-methods.md) | EastArray / EastSet / EastDict / EastVector / EastMatrix / EastBlob / EastStruct, EastVariant, EastRef method surfaces · Container generators · East.&lt;Type&gt; namespaces · DateTime format codes |
| [reference/beast2.md](reference/beast2.md) | Beast2 streaming |
| [reference/columns-and-platform-functions.md](reference/columns-and-platform-functions.md) | Columnar escape hatches · Platform functions · What is NOT east-c |
| [reference/cli.md](reference/cli.md) | The east-py CLI |
| [reference/patterns.md](reference/patterns.md) | Python values vs East expressions · The canonical platform function · Project-owned platform module · Memoize · Fork-parallel export · Keyed lookups in a big file · Sequential logic that stays in east-c · Trees from flat rows, and recursion · Sort uses East's total order · Scalars: use the `East.<Type>` utilities · torch interop |

## Sharp edges

- **Every body takes the block first** — `lambda b, x: …` / `def f(b, x)`, never
  `lambda x: …` — an `East.function` body, a builtin's callback, a branch, a
  loop, a `.match` handler alike. A function VALUE (a compiled `East.function`, a
  `.bind` result) takes none. Name the block `_b` when unused.
- **Type constructors take PAIRS, not a dict** (unlike TypeScript):
  `StructType([("name", StringType), ("price", FloatType)])`,
  `VariantType([("ok", T), ("err", E)])`.
- **A `@East.platform_function` must return an East value.** Plain python (a
  `dict`, a `list` of dicts) fails output validation — build it with
  `array`/`struct`/`variant`, or `coerce_to(raw, OutputType)` at the return.
- **One name, two surfaces.** A body holds EXPRESSIONS; what a platform function
  is handed, or iteration yields, is the eager surface — the same vocabulary,
  options included: read a decoded option with `.unwrap_or(d)` / `.match({…})` /
  `.is_some()`, never a hand-rolled `opt.type == "some"` branch.
- **The two `duration` spellings differ in sign**: the METHOD `a.duration_days(b)`
  is `b − a` (the TypeScript method); `East.DateTime.duration_days(a, b)` is the
  raw builtin, `a − b`.
- **`EastDict.get(k)` errors on a missing key**, like `d[k]` and TypeScript;
  `get(k, default)` is the python convenience, `get(k, lambda b, k: …)`
  TypeScript's `onMissing` body.
- **`append` takes an ARRAY**; one element is `push_last`. A Set or Dict spells
  the array flattening `flatten_to_array`; only an Array has `flat_map`.
- **Task inputs arrive frozen**: mutating one raises `cannot mutate a frozen
  value (task inputs are immutable) — copy first`; `.copy()` gives a mutable
  value. Keyed gets and iteration on a paged input stay O(segment) through the
  proxy, and frozen collections compare by value under `Is`. The same frozen
  paged value comes from `blob.open_beast(T)` and from `fs_open_beast` in
  **east-py-std**; an input e3 stages as a manifest directory opens the same
  way, reading only the segment files a read lands in.
- **A callback East cannot express RAISES**, eager paths included, naming the
  binding — a body reaching for python (`random.…`, `len`, a mutable capture,
  `nonlocal`) or one that only looks East-native (an f-string, which would
  constant-fold the proxy; an off-surface method). Build strings with
  `East.str(...)` or `+`; genuine python work is an explicit loop outside.
- **Read a captured East collection with `.get(expr)` /
  `.get_or_default(expr, d)` / `.try_get(expr)`** — `[expr]` on a captured
  constant does not build IR (python coerces the index via `__index__`).
- **A python set has no order of its own.** Under a Set type
  (`b.const({"a", "b"}, SetType(StringType))`, `East.new_set(T, {…})`) its
  elements are built in East's order of `T`, the order an `EastSet` keeps, so
  the IR is the same in every process; a list keeps the order it is written in.
  A python set holding a traced value (`{some(x)}`) has nothing to order by and
  is refused — write a list.
- **Genuinely-python loops cross the boundary once** — `to_columns()` /
  `EastArray.from_columns` / `map_batches`, never a platform call or a decode per
  element.

## Related skills

- **east** — the TypeScript `East.function` DSL, this surface's twin name for
  name (`$` is `b`, camelCase is snake_case): one type system and one IR, a
  program prints from one into the other (`east-py transpile` / `east-node
  transpile`), and a function exported from one is imported by the other
  (`east-py export-functions` ↔ `East.importFunction`).
- **east-py-datascience** — python platform functions for ML and optimisation
  (XGBoost, LightGBM, Optuna, MADS, PyMC, SHAP, Torch, GoogleOR, Simulation): the
  home once a platform-function POC needs a real model or solver.
- **east-py-std** / **east-py-io** — the platform functions of the python runtime
  (Console/FileSystem/Fetch/Crypto/Time/Random and the strict large-JSON reader;
  SQL/NoSQL/S3/FTP/SFTP/XLSX/XML/compression), each exported under its own name
  and callable with East values or inside a body. Their TypeScript siblings are
  **east-node-std** / **east-node-io**.
- **e3** — run East functions as durable, content-addressed dataflow tasks; wire
  a project's python module with a `{ custom: 'platform_module' }` platform.
- **east-project** — scaffold (`--platform`) and package a project-owned
  platform module; **e3-create** — a dedicated python platform package
  (`--python-packages=<name>`, a uv workspace member with its own derived e3
  environment); **east-design** — start there with a goal but no architecture.
