---
name: east-py
description: "East in Python (east-py): (A) East EXPRESSIONS — East functions written in python with East.function / East.asyncFunction, the block `b` (TypeScript's `$`), the TypeScript methods snake_cased, the standard library, East.compile; (B) East VALUES — East data as ordinary python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant/Ref/Blob) whose eager methods run in east-c under the same names. Use when writing python against east-py: (1) an East function in python (b.let/b.if_/b.for_, expression methods, the stdlib), (2) building and validating values (array/struct/variant/some/none, coerce_to/assert_value_of), (3) transforming values with eager methods (sort/map/filter/reduce/group_*/set algebra/dict merge), (4) scalar builtins via East.(Type), (5) @East.platform_function to expose python to East, (6) beast2 files larger than memory, numpy/torch through EastVector/EastMatrix, (7) porting a plain-python POC into a platform… See the detailed scope below."
---

## Detailed skill scope

East in Python (east-py): (A) East EXPRESSIONS — East functions written in python with East.function / East.asyncFunction, the block `b` (TypeScript's `$`), the TypeScript methods snake_cased, the standard library, East.compile; (B) East VALUES — East data as ordinary python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant/Ref/Blob) whose eager methods run in east-c under the same names. Use when writing python against east-py: (1) an East function in python (b.let/b.if_/b.for_, expression methods, the stdlib), (2) building and validating values (array/struct/variant/some/none, coerce_to/assert_value_of), (3) transforming values with eager methods (sort/map/filter/reduce/group_*/set algebra/dict merge), (4) scalar builtins via East.<Type>, (5) @East.platform_function to expose python to East, (6) beast2 files larger than memory, numpy/torch through EastVector/EastMatrix, (7) porting a plain-python POC into a platform function, (8) the east-py CLI — run, exec, convert, transpile, export-functions, lint, check, lsp, version, (9) exporting functions for TypeScript / e3 and importing TypeScript-authored ones (East.export_functions / East.import_function), (10) edit-time diagnostics (east-py lint, flake8 EAS codes, east-py check, east-py lsp), (11) JSON Schema contracts (json_schema_for, type_from_json_schema).

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

1. Call `search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

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
over is snapshot into the IR (`.bind(table)` it as a trailing parameter to keep it
live). The other way, an artifact is a plain callable on values, every eager
method accepts one (a VALUE takes no block), and one referenced inside another
body splices in — see [Python values vs East expressions](#python-values-vs-east-expressions).

## Decision Tree: What Do You Need?

Each leaf names the section holding the whole surface for it.

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
    │   ├─ What a body may capture — and what it refuses, naming the binding → "What a body may reference"
    │   ├─ Call python from a body → the @East.platform_function you hold IS the Platform node (no declaration) · East.platform /
    │   │   asyncPlatform / genericPlatform only for one implemented elsewhere · East.compile(fn, platform=East.platform_functions(__name__))
    │   │                                                                        → "Declare, implement, build, compile", "Platform functions"
    │   ├─ Make it fast → data stays in East · chain · CSE by reusing a python variable · capture small tables, .bind big ones
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
    │   ├─ A JSON contract another system validates against → json_schema_for · type_from_json_schema   → "A JSON contract"
    │   ├─ A collection file larger than memory → write_beast2_file · open_beast2_file (a read-only East collection value) ·
    │   │   write_beast2_file_parallel · splice_beast2_files · Beast2ManifestWriter · open_beast2_pages_for  → "Beast2 streaming"
    │   ├─ Logic genuinely needs python (numpy, a model, a solver) → to_columns · from_columns · map_batches · update_many ·
    │   │   extend · to_numpy / to_torch                                                   → "Columnar escape hatches"
    │   └─ Let East call python → @East.platform_function · @East.generic_platform_function · @memoize → "Platform functions"
    │
    ├─ C. Cross between them → a body's parameters are expressions · python scalars and datetimes lift · East.value(v, T) /
    │   b.const(v) · a captured East collection is a build-time SNAPSHOT (an eager callback refuses it), .bind(table) keeps it
    │   live · an East function is a callable on values, and a VALUE takes no block · east.runtime.compiler.eager_stats()
    │   shows how a hot call ran                                       → "Python values vs East expressions", "Performance"
    │
    └─ D. Run a program from the shell → east-py run (IR + input files → a result) · exec (a unit: the runner protocol e3
        speaks) · convert (a beast2 value → East text) · version                                  → "The east-py CLI"
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

## East expressions — writing East functions in Python

A python body becomes East IR by being CAPTURED: it runs ONCE against typed
expression proxies, exactly like the TypeScript builder; east-c compiles the
recorded IR, and from then on only the compiled function runs. A body East
cannot express raises at build time, so the same source always costs and means
the same thing.

### Declare, implement, build, compile — the four authoring calls

The TypeScript names, name for name. Two are about **platform functions** —
python the program calls out to, paired **by name** — and two about **East
functions**, the program itself:

| Step | Call | What it is |
|---|---|---|
| **Implement** a platform function in python | `@East.platform_function(inputs=…, output=…)` (`@East.generic_platform_function(type_parameters=, inputs=, output=)`; `East.platform_functions(__name__)` collects a module's) | the host side AND the body's spelling: a plain python function over East VALUES, its result validated against `output` — and, called inside a body, the `Platform` node with this very signature. Its name — the `def`'s, or `name=` — is what every runtime pairs the call with |
| **Declare** one implemented elsewhere | `East.platform(name, inputs, output)` (`East.asyncPlatform`, `East.genericPlatform`, `East.asyncGenericPlatform`) | a handle a body CALLS — it emits the `Platform` node; nothing runs here. For a function implemented in another package or runtime; a python implementation you hold needs no declaration |
| **Build** an East function | `East.function(inputs, out, body)` / `@East.function(inputs, out)` (`East.asyncFunction`) | runs `body` once over expression proxies and records IR; a pure one is already callable |
| **Compile** with the implementations | `East.compile(fn, platform=[…])` (`East.compileAsync`) | analyzes the IR against the implementations — a declaration no implementation matches by name is `Platform function '<name>' not found` — and returns the native callable |

An `East.function` has no name of its own: it is a VALUE, called through the
binding that holds it (`score(x)`, `rows.map(score)`), stored in a struct or an
array, exported under a name (`east_functions = {"score": score}`) — its IR
carries its parameters' names, never its own, as in TypeScript. A platform
function is the opposite: the name IS the pairing, on every runtime.

```python
from east import East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType
from east_py_std import fs_read_file, platform as std

Row = StructType([("sku", StringType), ("qty", IntegerType)])

# BUILD — `out` is REQUIRED and enforced; every body takes the block `b` first
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * 1.5)
score({"sku": "a", "qty": 2})            # 3.0 — a pure artifact is a callable on values

# IMPLEMENT — python over East values; `name=` because "t.log" is not an identifier.
# The decorated function is DUAL-MODE: log_line("x") runs the python;
# inside a body, log_line(name) IS the Platform node 't.log' with this signature.
@East.platform_function(inputs=[StringType], output=NullType, name="t.log")
def log_line(line):
    print(line)

greet = East.function([StringType], NullType,
                      lambda b, name: log_line(East.String.concat("hello ", name)))
greet("bob")                             # EastError: Platform function 't.log' is not
                                         #   available — compile with East.compile(fn, platform=[...])

# COMPILE — the implementation, by name (the same record the decorator registered)
run = East.compile(greet, platform=East.platform_functions(__name__))
run("bob")                               # prints "hello bob"

# A stock implementation is called the same way — no East.platform line restates it
first = East.function([StringType], StringType, lambda b, path: fs_read_file(path).split("\n").get(0))
East.compile(first, platform=std)("hosts.txt")

# DECLARE — only for a function implemented elsewhere (another package or runtime):
remote = East.platform("t.remote", [StringType], NullType)
```

**An East function inside a platform function.** The implementation is
ordinary python over East values, and an `East.function` is a callable on
values that every eager method accepts — so that is how the implementation
does its East work, with the loop and the body running in east-c:

```python
Rows = ArrayType(Row)

@East.platform_function(inputs=[Rows], output=FloatType)    # its name: "total", the def's
def total(rows):
    return rows.map(score).sum()          # `score` from above — an East function on values

report = East.function([Rows], StringType,                  # `total(rows)` in the body IS the
                       lambda b, rows: East.str("total: ",  #   Platform node — no declaration
                                                East.Float.print_currency(total(rows))))
East.compile(report, platform=East.platform_functions(__name__))(rows)   # "total: $9.00"
```

Each call in detail:

| Call | Builds | Notes |
|---|---|---|
| `East.function(param_types, out, body)` | a `Function` artifact | `param_types` is a LIST (`[]` for none); the body takes the block first — `lambda b, x: …` / `def f(b, x)`, as EVERY body does (`lambda x: …` is refused with the fix-it); `out` is required, and a body whose expression has another type raises naming both; with `body` omitted it is a DECORATOR |
| `East.asyncFunction(param_types, out, body)` | an `AsyncFunction` artifact | for bodies calling async platform declarations; compile with `East.compileAsync` |
| `East.platform(name, inputs, output, optional=False)` | a declaration handle | callable INSIDE a body (emits the `Platform` node); calling one outside raises `expression-level`; `East.genericPlatform(name, ["T"], inputs, output)` is the type-parameterised form (`East.asyncGenericPlatform` the async one). Needed only for a function implemented elsewhere: a `@East.platform_function` you hold emits the same node itself |
| `East.asyncPlatform(name, inputs, output)` | an async declaration | calling it from a SYNC body is a build error naming `East.asyncFunction` |
| `East.compile(fn, platform=[])` / `East.compileAsync(...)` | a native callable | takes an artifact or a raw IR value; the IR is analyzed against `platform` first (`east.ir.analyze`, the TS `analyzeIR`): a signature mismatch or a missing implementation is an `EastError` naming the call — unless the declaration is `optional=True`, which compiles to a stub that raises at the call (TS parity) |

A **pure** artifact needs no compile step: it is already a native callable,
`.bind(*values)` pre-binds trailing parameters by reference, and referencing it
inside another body splices it into that build — in ITS OWN frame, so a body
that appends statements (`b.let`, `b.if_`) becomes a `Block` where it is
spliced, and an artifact used as an `East.if_else` arm evaluates only when that
arm is taken. An effect-only artifact whose value the caller DISCARDS is
therefore the build's "evaluated and thrown away" error — spell it
`b.do(push(xs))` / `East.block(push(xs), result)`, as with any mutation. An
artifact that calls platform functions stays first-class (composable,
serializable) but raises until `East.compile` pairs it with implementations.
`East.function(...)` spelled INSIDE a body is the inline `Function` node, a
Function-typed expression: bind it with `b.const`, hand it to a callback slot,
or call it (a `Call`; in an `East.asyncFunction`, calling an async one is a
`CallAsync`).

**Error locations.** A build records the python frames that built each node,
so a runtime error names its authoring site: `EastError.location` is the stack —
the lambda's `file:line:column` first, then the `East.function(...)` call and
its callers — and a platform-signature mismatch at `East.compile` names the call
the same way. The map rides the function's beast2 encoding, so the error reads
the same on east-c or east-node. Paths are relative to the working directory;
`set_location_base_path(dir)` (from `east`) pins the base for reproducible
fixtures. An error inside a callback a builtin invokes (`arr.map(...)` and
friends) resolves to the builtin's call site, on every runner.
`set_location_capture(False)` (from `east`) builds without recording any
locations: there is then no stack walk per node, and an error raised by such a
function carries no location. Binding names are read separately and keep
working. The TypeScript twin is `setLocationCapture`.

### Every body takes the block first — the TypeScript `$` twin

A TypeScript body receives `$` and appends statements to it; a python body
receives **`b`**, the block, as its FIRST parameter and does the same. EVERY
body does — an `East.function` body, a builtin's callback, a branch, a loop, a
handler — exactly as every TypeScript body is `($, …) => …`: `lambda x: …` is
refused with the fix-it, a body that uses the block as the element fails on the
block's first use, and each nested body receives ITS OWN block first, so a
statement on any other block is a build-time error. Python `None` returned from a
body is TypeScript's "no return"; the `east_null` sentinel is an explicit `null`:

```python
from east import East, IntegerType, StringType

@East.function([IntegerType], StringType)
def classify(b, n):
    acc = b.let(0)                                     # $.let — reassignable
    limit = b.const(n * 2)                             # $.const
    def loop(b, label):                                # $.while body: (b, label)
        b.if_(acc >= limit, lambda b: b.break_(label))
        b.assign(acc, acc + 1)                         # $.assign
    b.while_(True, loop)
    b.if_(acc > 10, lambda b: b.return_("big")) \
        .else_if(acc > 5, lambda b: b.return_("mid")) \
        .else_(lambda b: b.return_("small"))           # every arm returns → Never

classify(3)                                            # "mid"
```

A one-statement body is a `lambda b: …`; a longer one is a `def` written
just before the statement that uses it. Name the block `_b` when the body
does not use it.

| Body | Spelling |
|---|---|
| `East.function` / `East.asyncFunction` body | `lambda b, x: …`, `def f(b, x)` — the block plus exactly the function's parameters; `lambda x: …` is refused (`a body takes the block first`) |
| a builtin's callback (`xs.map(...)`, `reduce`, …) | `xs.map(lambda b, el, i: …)` — the block, then the builtin's callback signature (map's `(element, index)`; `xs.reduce(lambda b, acc, el, i: …, 0)`; a Dict's `(value, key)`); trailing parameters may be omitted, the block cannot |
| a statement construct's body (`b.if_`/`.else_if`/`.else_`, `b.match_`, `b.while_`, `b.for_`, `b.try_`/`.catch`/`.finally_`) and `East.block(fn)` | `b.for_(xs, lambda b, v, i, label: …)`, `b.match_(v, {"some": lambda b, x: …})`, `East.block(lambda b: …)` |
| an expression form's handler (`.match({...})`, `East.try_catch`, `East.let`, the `East.while_`/`for_` bodies, `.and_`/`.or_`/`.if_else`) | bodies too: `v.match({"some": lambda b, x: …})`, `East.try_catch(lambda b: …, lambda b, msg: …)` — statements inside them go in `East.block(lambda b: …)`; `East.if_else` arms are expressions, not bodies |
| a function VALUE — a compiled `East.function`, a `.bind` result, a Function-typed expression, a platform declaration | takes NO block: a slot invokes what it holds body-style and the value drops the block, so `xs.map(amount)` and `xs.map(lambda b, el: amount(el))` both work (TS: an `Expr<FunctionType>` wherever a `($, …) => …` is accepted); a value declaring fewer parameters than the slot passes takes the prefix |

| Statement | Emits | Notes |
|---|---|---|
| `b.let(value[, type])` / `b.const(value[, type])` | `Let` (Null) | the variable, mutable / not; a declared `type` widens a narrower literal (a `Variable` of a subtype gets an `As`) |
| `b.assign(var, value)` | `Assign` (Null) | `var` must come from `b.let` — a python `x = …` rebinds the NAME and changes nothing |
| `b.return_([value])` | `Return` (Never) | checked against the declared output; a `do` of the same expression just before is not duplicated |
| `b.if_(pred, fn).else_if(pred, fn).else_(fn)` | `IfElse` (Null; Never when every arm diverges) | each `fn(b)` runs in its own frame; a branch ending in a non-Null value pads with `null`; a body may return the chain itself (`lambda b: b.if_(…)`) |
| `b.match_(variant, {case: fn(b, data)})` | `Match` (Null) | a case without a handler does nothing |
| `b.while_(pred, fn)` / `b.for_(coll, fn)` | `While` / `ForArray`/`ForSet`/`ForDict` (Null) | `fn(b, label)`; Array `fn(b, value, index, label)`, Set `fn(b, key, label)`, Dict `fn(b, value, key, label)` |
| `b.break_(label)` / `b.continue_(label)` | `Break` / `Continue` (Never) | the loop's `label` is what the body received; a bare `East.break_()` (the expression form's jump) inside a statement loop targets it too |
| `b.try_(fn).catch(fn(b, message, stack)).finally_(fn)` | `TryCatch` (Null) | `.catch` at most once; Never when both bodies diverge |
| `b.do(expr)` | the expression as a statement | `$(expr)` — a platform call or mutation evaluated for its effect; a bare `arr.push_last(x)` line is thrown away, and the build says so |
| `b.error(msg)` | `Error` (Never) | `$.error` — raise now; `East.error(msg)` is the expression twin (return it, or use it as an `if_else` arm) |
| `East.block(fn)` | `Block` | the EXPRESSION form: `fn(b)`'s statements, then the value it returns (a block returning nothing must diverge) |

A statement after one that never completes raises `Unreachable statement
detected`, as in TypeScript; a statement on an OUTER block from inside a nested
body, or on a block whose body has returned, raises naming it (TypeScript's
`no-cross-block-builder` lint is a hard error here). Every other IR node kind has
a spelling too, so any program TypeScript can build, python builds name for
name: `East.value(v, T)` (a typed literal / struct / list / dict), `East.as_(v,
T)` (an explicit widening `As`), `East.wrap_recursive(v, R)` and `expr.unwrap()`
on a recursive-typed expression, and `East.builtin(name, [T…], [args], out)` (a
raw builtin, for the few with no named spelling — `east.codegen.RAW_ONLY`).

**The analyzer.** Every build and every `East.compile` runs
`east.ir.analyze.analyze_ir`, the twin of TypeScript's `analyzeIR`: scope, exact
types (a `Let`/`Assign`/argument/element/field has exactly its slot's type;
subtyping is spelled with `As`), divergence and node well-formedness, with the
TypeScript messages at the python `file:line:column`. A body that fails it never
compiles.

### The expression surface, type by type

One class per East type in `east.expression.expr`, each the twin of
`libs/east/src/expr/<type>.ts`: the same methods snake_cased, the same builtin
and argument order behind each, and the same aliases where TypeScript has them
(`plus`/`minus`/…, `eq`/`equal`/`equals`). Every TypeScript method exists on the
expression class AND on the eager value class (a scalar's eager twin is the
`East.<Type>` function of the same name, value first: `d.add_days(n)` ↔
`East.DateTime.add_days(d, n)`), and each python-only name is a deprecated
python-idiom alias, a python protocol twin, or a convenience. Python departs from
TypeScript only where the language forces it: operators where they agree (`+ - *
/ ** & | ^ ~`, the comparisons), `and_`/`or_`/`not_`, `as_`, and keyword
arguments (`out=`, `key=`, `combine=`) where TypeScript overloads.

| Type | Operators | Methods (the TypeScript names) |
|---|---|---|
| **Boolean** | `&` `\|` `^` `~` — never `and`/`or`/`not`/`if` (python collapses them to `bool`) · `==` `!=` | `.bit_and(y) .bit_or(y) .bit_xor(y) .not_()` (the builtins — both operands evaluate) · `.and_(fn(b))` `.or_(fn(b))` (TS `and`/`or`: SHORT-CIRCUIT, the other operand is a body) · `.if_else(fn(b), fn(b))` (TS `ifElse`; `East.if_else(cond, value, …, otherwise)` is the value form — pairs then the else, one `IfElse` node) · `.equals/.equal/.eq` `.not_equals/.not_equal/.ne` |
| **Integer** | `+` `-` `*` and unary `-`; `==` `!=` `<` `<=` `>` `>=` (East total order) · ❗ `//` `%` `**` `/` RAISE at build time with the fix-it: python floors/takes the divisor's sign/promotes a negative exponent where East truncates/takes the dividend's sign/yields 0 — spell `.divide(y)` / `East.Integer.divide`, `.remainder(y)` / `East.Integer.remainder`, `.pow(y)` / `East.Integer.pow`, `.to_float() / y` | `.add .subtract .multiply .divide .remainder .pow` (a Float argument widens `self`, like TS; aliases `.plus .sub .minus .mul .times .div .mod .rem .modulo`) · `.negate() .abs() .sign() .log(base)` · `.to_float()` · `.less_than/.less/.lt .greater_than/.greater/.gt .less_than_or_equal/.less_equal/.lte/.le .greater_than_or_equal/.greater_equal/.gte/.ge .equals/.equal/.eq .not_equals/.not_equal/.ne` |
| **Float** | `+` `-` `*` `/` `**` and unary `-`; comparisons · ❗ `//` `%` RAISE (`.remainder(y)` / `East.Float.remainder`) · `math.floor/ceil/trunc(x)` build the stdlib `East.Float.round_floor/round_ceil/round_trunc`; python `round(x)` raises (its tie rule differs — `East.Float.round_half(x)`) | the same named arithmetic and aliases (an Integer argument widens) · `.negate .abs .sign .sqrt .exp .log .sin .cos .tan` · `.to_integer()` ❗ errors at run time on a non-integral/NaN/infinite value · Float → Integer rounding is the stdlib `East.Float.round_floor/round_ceil/round_trunc/round_half(x)` (`round_half` = ties AWAY from zero; `.floor() .ceil() .trunc() .round()` are deprecated aliases) · comparisons as Integer |
| **String** | `+` (concat); comparisons | `.concat(s) .repeat(n) .substring(a, b) .upper_case() .lower_case() .trim() .trim_start() .trim_end()` · `.replace(old, new) .split(sep)` · `.length() .starts_with(p) .ends_with(s) .contains(s) .index_of(s)` · `.parse(T)` ❗ (strict whole-string) `.parse_json(T)` · `.try_parse(T) -> Option<T>` (none on any failure) · `.encode_utf8() .encode_utf16()` · `.regex_contains(pat, flags="") .regex_index_of(pat, flags="") .regex_replace(pat, repl, flags="")` (the builtins TypeScript has no method for) · never an f-string (it would constant-fold the proxy) — `East.str(…)` or `+` |
| **DateTime** | comparisons; a python `datetime` literal lifts as a DateTime | `.get_year() .get_month() .get_day_of_month() .get_day_of_week()` (Monday = 1) `.get_hour() .get_minute() .get_second() .get_millisecond()` · `.add_milliseconds(n) .add_seconds .add_minutes .add_hours .add_days .add_weeks` and `.subtract_milliseconds … .subtract_weeks` (an Integer or Float `n`) · `.duration_milliseconds(other) -> Integer`, `.duration_seconds/minutes/hours/days/weeks(other) -> Float` ❗ `a.duration_days(b)` is `b − a` (positive when `b` is later — the TS method; the namespace `East.DateTime.duration_milliseconds(a, b)` is the raw builtin, `a − b`) · `.to_epoch_milliseconds()` · `.print_formatted(fmt)` (Day.js tokens) |
| **Blob** | comparisons | `.size() .get_uint8(i)` · `.decode_utf8() .decode_utf16()` · `.decode_beast(T, version="v1")` (`"v2"` = the beast2 family) · `.open_beast(T)` (TS `openBeast`: an indexed beast2 `Array`/`Set`/`Dict` blob as a FROZEN paged value — `size`, keyed reads and `for_` decode one segment; an index-less blob or a Ref-/function-bearing element shape decodes whole; the header's type must equal `T`, checked before any decode) · `.decode_csv(RowT, config=None, **options)` |
| **Array / Set / Dict / Vector / Matrix** | `xs[i]` (a negative LITERAL index raises — spell `xs.get(xs.size() - 1)`) · `d[k]` ❗missing · comparisons | The eager surface, name for name and signature for signature — [EastArray](#eastarray--complete-method-surface) · [EastSet](#eastset--complete-method-surface) · [EastDict](#eastdict--complete-method-surface) · [EastVector](#eastvector--complete-method-surface) · [EastMatrix](#eastmatrix--complete-method-surface) — less what only a value has: the python protocol (Array `insert`/`remove`/`count`/`index`, Set `add`/`remove`/`discard`, Dict `values`/`items`), the columnar hatches (`to_columns`, `from_columns`, `map_batches`, `update_many`), the numpy/torch bridges, the classmethod generators (`East.Array.range` and kin are their twins) and the deprecated `map_elements`. A mutator yields Null or Boolean — sequence it with `b.do` or `East.block`. A Dict callback is `(value, key)`: `fn(b, v)` or `fn(b, v, k)`, a fold step `fn(b, acc, v[, k])`, a collision handler `combine(b, existing, incoming[, key])` |
| **Struct** | `r.field` / `r["field"]` (both build IR, both work on real rows) | build a row with a dict literal `{"k": expr, …}` or `struct({…}, T)` (dual-mode) |
| **Variant** | — | `.match({case: fn(b, payload)}, default=fn(b))` (TS's partial match; the arms must agree on one East type — a `some(x)` arm types its `none` sibling) · `.match_tag(tag, fn, default)` · `.unwrap(tag="some", on_other=None)` ❗ · `.has_tag(tag) .get_tag()` · Option: `.is_some() .is_none() .unwrap_or(d)` · build with `some(expr)` / `none` / `variant(case, payload)`, typed from context (the build's declared output, a typed `if_else` sibling, a declared struct field, or an `out=` pin) |
| **Ref** | — | `East.ref(v)` builds one · `.get()` · `.update(v)` (TS `RefUpdate`; `.set` and the read-modify-write `update(fn)` are deprecated — write `r.update(f(r.get()))`) · `.merge(v, fn(b, current, patch))` |
| **Function** | `f(x, …)` — a `Call` node (a `CallAsync` inside an async body) | a Function-typed parameter or a `b.const(East.function(…))` is callable in the body; `FunctionType` parameters bind with `.bind(fn_value)` |

The expression methods take the eager keywords — `out=` (`map`, `filter_map`,
`map_reduce`, `flat_map`, `flatten_to_set`, `to_array`, `to_set`), `key_out=` /
`value_out=` (`to_dict`), `key_out=` / `acc_out=` (`group_reduce`), `pred=`,
`key=`, `value_fn=` — and an `out=`-family pin also TYPES the callback's build, so
a pinned callback can build a general variant with no other context. Result
types come from the build, never a data sample: `out=` is optional everywhere,
and an EMPTY collection derives what a full one does. `some`/`every`/`first_map`
compile to the native short-circuiting FirstMap scans (`some([])` is False,
`every([])` True). An unsupported method raises `ExpressionError` naming the
supported set.

### The standard library — the TypeScript `East.<Type>.*` functions

Every namespace carries the East standard library — TypeScript's
`libs/east/src/expr/libs/*.ts`, body for body, snake_cased (`printCompact` →
`print_compact`; the TS misspelling `printCommaSeperated` stays
`print_comma_seperated`, with `print_comma_separated` as a python twin). Each is
an `East.function` built on first use: on plain values it runs natively, inside a
body it splices in like any artifact:

```python
@East.function([IntegerType, FloatType, DateTimeType], StringType)
def label(b, n, x, d):
    return East.str(East.Integer.print_compact(n), " / ",          # "1.23M"
                    East.Float.print_currency(x), " @ ",           # "$1,234.57"
                    East.DateTime.print_formatted(East.DateTime.round_down_hour(d, 6), "HH:mm"))
```

The outputs are TypeScript's exactly — a Float prints with its point
(`East.Float.print_percentage(1.0, 0)` is `"100.0%"`), the Integer compact forms
carry two decimals below ten units (`print_compact(1500)` is `"1.50K"`), and
`round_nearest`'s Integer half-step truncates (`round_nearest(17, 5)` is `20`).
Every function, with its outputs, is in
[East.<Type> namespaces](#easttype-namespaces--the-builtins-and-the-standard-library);
the dual-mode generators (`East.Array.range`, `East.Set.generate`,
`East.Vector.zeros`, …) are in [Container generators](#container-generators-classmethods).

### Control flow — the expression forms (`East.while_`, `East.for_`, …)

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
[Key Patterns](#sequential-logic-that-stays-in-east-c-worklist--replay).

| Call | Emits | Notes |
|---|---|---|
| `East.if_else(cond, value, …, otherwise)` | `IfElse` | cond/value pairs then the else — an if/elif/else chain is ONE node; exactly one arm evaluates |
| `East.while_(state, cond, body, label=…)` | `While` | `cond(b, s) -> Boolean`, `body(b, s) -> next state` |
| `East.for_(coll, state, body, label=…)` | `ForArray`/`ForSet`/`ForDict` | Array `body(b, s, el[, i])`, Set `body(b, s, el)`, Dict `body(b, s, k, v)` |
| `East.block(a, b, …)` | `Block` | evaluates in order, yields the last — the sequencing point for mutators (`East.block(lambda b: …)` is the statement form) |
| `East.let(value, fn)` | `Let` | `fn(b, bound)` — bind once, use many times (explicit CSE inside a loop) |
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
`EastArray(T)` works too — a loop's seed is built fresh per call — but
anywhere ELSE in a function a captured collection is a build-time snapshot
shared by every call, and mutating one raises rather than leaking state
between calls.

### What a body may reference

- Its own parameters; plain scalar constants (closure floats / ints / strings /
  datetimes bake in — the same value per element either way); East types and
  values (`east_null` included); the `East` namespace, `East.if_else` included;
  the `struct`/`variant`/`some`/`none` constructors (dual-mode: they build IR
  when handed expression fields); **East.function artifacts** (dual-mode: they
  re-run their source at any nesting depth); **compiled East function values**
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

### Performance — the levers, ranked

The point of the machinery: **data stays in east-c and python never runs per
element**.

1. **Keep values East end-to-end.** `EastArray`/`EastSet`/`EastDict` are
   C-backed, and every eager method runs its loop natively however deeply the
   element type nests. `list(...)`/`dict(...)` or a python loop pays a boxing
   crossing per element — convert at most once, at the very end.
2. **Let the callbacks build, and chain on the results** — a chain of
   `map`/`filter`/`reduce` stays native between steps. Return a dict literal
   (`lambda b, r: {"a": …, "b": …}`) to derive every column in ONE pass. **Reuse
   a python variable to share work** (build-time CSE): `fields =
   r.data.split("|")` read for 30 columns compiles to ONE `Let` — the split runs
   once per row (re-calling `.split()` per column re-emits it). Loop-invariant
   subexpressions hoist out of nested lambdas to the function body, a value read
   once inside a callback included, so `table = derive(rec)` before a `.map` runs
   once. A hoist never leaves a guard: a subexpression shared inside `b.try_` /
   `East.try_catch` binds inside that body, so `s.try_parse(T)` still answers
   `none` when CSE'd. `East.function(..., cse=False)` switches the pass off and
   builds exactly what the body spells (what the transpiler emits).
3. **Side tables: capture small ones, `bind` big ones** — opposite contracts:
   - **Capture (snapshot).** A collection captured by an `East.function` body
     is snapshot into its IR — hoisted and identity-deduped, so it builds **once
     per compiled function** and each lookup runs in C. Right for tables up to
     ~10⁴–10⁵ entries; the snapshot's build cost and memory ride the function (a
     1M-entry dict takes ~10 s), and later mutations are **not** seen. Only an
     EXPLICIT build snapshots: an eager callback refuses a mutable capture.
   - **`East.function(...).bind(table)` (by reference, live).** Declare the
     table as a trailing parameter and pre-bind it: zero copy, O(1) at any size
     (1M entries: ~0.1 ms), the per-row cost of the hoisted case, and the
     function **sees later mutations**. Rebinding gives independent callables,
     the unbound function stays usable, and a wrong-typed value raises
     `TypeError`.

   ```python
   fx = EastDict(StringType, FloatType, rates)          # small table → capture
   to_usd = East.function([Row], FloatType,             # (the EXPLICIT build
       lambda b, r: r.amount * fx.get_or_default(r.ccy, 1.0))   # opts into snapshot)

   TableT = DictType(StringType, FloatType)             # huge table → bind
   conv = East.function([Row, TableT], FloatType,
       lambda b, r, t: r.amount * t.get_or_default(r.ccy, 1.0))
   rows.map(conv.bind(big_table))                       # loop + lookup stay in east-c
   conv.bind(t1, t2)  # multi-table: binds the TRAILING parameters in order
   ```

   Function *parameters* always cross by reference (zero copy, any size, any
   depth); `bind` is what lets an eager method use a parameter-taking function
   where the callback signature is fixed.
4. **Hoist `East.function(...)` out of python loops** and reuse it — building
   is cheap, not free.
5. **When logic must stay python, go columnar** — one crossing per column or
   batch instead of per row × field, then back with `from_columns`/`extend`
   ([Columnar escape hatches](#columnar-escape-hatches--when-the-logic-must-stay-python)).
6. **See how a hot call ran** — `east.runtime.compiler.eager_stats()`:
   `function_direct` counts callbacks that rode a precompiled function value
   straight in, `c_to_py_decodes` counts values boxed C→python (an eager method
   quietly decoding a whole collection shows here), and the `beast2_*` counters
   report column projection. There is no per-element python counter because
   there is no per-element python path.

### IR ↔ python: `east-py transpile` and the `east-c ir` toolbox

Any East IR — an `East.function` artifact, or a `.json` / `.beast2` export from
TypeScript, east-c or east-node — prints as an idiomatic python module that
REBUILDS it through the surface above:

```python
from east.codegen import to_python_source
print(to_python_source(classify))        # `@East.function(..., cse=False)` / `def main(b, …)`
```

```bash
east-py transpile program.json -o program.py --name main   # the same, from a file
east-py transpile program.json -p east-py-std -p east-py-io   # platform calls print as the packages' own
                                                              # functions and named types, not restated declarations
east-c ir normalize program.json -o canonical.json         # the canonical form
east-c ir diff a.json b.beast2                             # first difference, or "identical"
east-c ir convert program.json -o program.beast2           # json <-> beast2, source map intact
```

- **The contract:** `build(print(IR))` equals `IR` under `east-c ir normalize`
  (location ids stripped, variables and labels renamed in the TypeScript
  lowering's order, captures recomputed, recursive type ids renumbered — one
  normalizer, in libeast-c). The TypeScript printer (`East.toSource`, `east-node
  transpile`) is its twin: IR → python → IR → TypeScript → IR is equal at every
  leg, over the whole compliance corpus and every example
  (`docs/conventions/EAST_CODEGEN.md`).
- **Builtins print through one spelling table** (`east.codegen.spellings`):
  operators only where they are exact — `+ - *` on numbers, `/` on Floats, the
  comparisons, `& | ^ ~` on Booleans, `+` on Strings — named `East.<Type>.*` or
  method spellings elsewhere, and `East.builtin(...)` for `RAW_ONLY`.
- **A function used as a VALUE** (`$.let(East.DateTime.roundDownWeek)`) prints
  as the inline `@East.function` it is — the IR carries the body, not the name.
- **A platform call** prints as a hoisted `East.platform(...)` declaration — or,
  given the implementing packages
  (`to_python_source(ir, providers=providers_for(["east_py_std"]))`, `east-py
  transpile -p east-py-std`), as `from east_py_std import fs_read_file` and the
  call itself, with a type the package names (`GzipOptionsType`) printed by its
  name; the plugin's example index is rendered this way. A provider is used only
  where its declared signature IS the node's, so a drifted signature keeps the
  declaration rather than printing a wrong import. A package whose function is
  implemented in C exports the DECLARATION under the same name
  (`simulation_run`, `optimization_iterative`), which a body calls identically.

### Diagnostics at edit time — `east-py lint`, `east-py check`, flake8, `east-py lsp`

Everything the build refuses — a body without the block, `//` on an
expression, an f-string over one, `if` on one, a callback reaching for `np` — is
also a **rule** in `east.diagnostics` (the python twin of
`@elaraai/east-diagnostics`). The rules read a file's `ast`, find its East bodies
(an `East.function` body and everything nested in it, an eager callback on an
East value, a `@East.platform_function`'s East inputs), and say at edit time what
the build would say: every rule's message IS the build's refusal for the same
code, pinned by building the very source the rules read.

Two tiers, at two costs. The **rules** read the `ast` — instant, and useful even
on a file that does not parse. The **check** runs the build — the only type
checker a python East body has, since East's type checker IS the builder — at
the cost of importing the module.

```bash
east-py lint src/                         # file:line:col: category [rule] message — exit 1 on any finding
east-py lint src/ --format json           # the findings as records
east-py lint src/ --disable no-deprecated-alias --exclude fixtures
east-py lint --list-rules                 # every rule, with its EAS code
east-py check src/                        # the BUILD's errors — a file, a directory, or a module; --format json
flake8 --select EAS src/                  # the same rules inside flake8 (east-py-cli registers the plugin)
east-py lsp                               # a Language Server over stdio, both tiers (--probe: can it start here?)
# pylsp                                   # python-lsp-server runs the rules too (east-py-cli registers the plugin)
```

- **`east-py check`** imports each target — a `.py` file, a directory (walked
  as `lint` walks it) or a dotted module name, each executed afresh — builds
  every East function in it, and reports EVERY failure at its authoring line: a
  body whose type differs from the declared `out`, a callback the capture
  refuses, an `IRAnalysisError`. Importing runs the module, so `EAST_CHECK=1` is
  set for the duration — skip import-time work when you see it.
  `--only-if-enabled` honours the project's opt-in (below), as the plugin's read
  hook does, so the hook and the language server agree.
- **`east-py lsp`** (needs `pygls`) runs the rules on every change and the build
  tier on **open** (debounced) and **save** (at once), on one long-lived worker
  thread, and only when the project opts in: the build reads the module from
  DISK, so on an unsaved buffer it would report the saved version's errors. A
  save evicts the module from the warm process, so its importers are checked
  against the new version. Pyright/Pylance has no plugin API, so flake8 and
  pylsp are the editor paths that need no East-specific server; the Codex
  plugin launches the project's own `east-py lsp` for `.py` files, and falls back
  to `east-py lint` per change when that server cannot start.

The rules — `east-py lint --list-rules` prints them:
| Rule | Flags | What the build says |
|---|---|---|
| `body-takes-block-first` (EAS001) | `lambda x: …`, a body whose parameter count is not the declared count plus the block, `b.price`, `x + b` | `a body takes the block first` |
| `no-operator-fork` (EAS002) | `//` `%` `**` on an expression, `xs[-1]` | the operator-fork texts — `East.Integer.divide` / `remainder` / `pow`, `xs.get(xs.size() - 1)` |
| `no-python-formatting` (EAS003) | `f"{x}"`, `str(x)`, `print(x)`, `format(x)`, `"{}".format(x)`, `"%d" % x` | `f-strings / str() cannot be traced … East.String.print(T, value)` |
| `no-python-boolean` (EAS004) | `if`/`while`/`assert`/`and`/`or`/`not`/`x if c else y` on an expression, `in`, `for … in xs`, `len`/`int`/`float`/`bool`/`sum`/`sorted`/`max`… over one | `python \`if/and/or/not\` cannot be traced …` (`iteration`, `len()`, …) |
| `no-python-round` (EAS005) | `round(x)` on a Float expression | `East.Float.round_half(x) rounds half away from zero …` |
| `no-python-work` (EAS006) | an EAGER callback loading a module (`np`, `math`), a python builtin the capture does not admit (all but `abs`/`bool`/`isinstance`), a name imported from the standard library or an installed package that has no East form (`from math import floor`; a constant like `pi` lifts), a mutable East collection, or a `def` doing any of those (a clean macro `def` is fine) | `the callback cannot be captured automatically: it references np …` |
| `no-statement-on-outer-block` (EAS007) | `b.if_(p, lambda _b: b.assign(…))` — a statement on an enclosing body's block | `b.assign() was called on an OUTER block …` |
| `no-deprecated-alias` (EAS008, warning) | `.fold`, `.lower`, `East.Boolean.and_`, … (read off the surface's own deprecation docstrings) | `.fold() is deprecated: the spelling is .reduce() (the TypeScript name)` |
| `no-discarded-expression` (EAS009) | a bare `acc.push_last(x)` / `East.error(…)` / `xs.size()` line in a body | `.push_last() was evaluated and thrown away … b.do(…)` |
| `prefer-some-none` (EAS010, warning) | `variant("some", x)` / `variant("none", None)` | use `some(value)` / `none` |
| `no-handrolled-variant` (EAS011, warning) | a `{"type": …, "value": …}` dict | `variant("Tag", value, Type)` — the encoder needs what it constructs |
| `prefer-explicit-east-type` (EAS012) | `b.let([])` / `b.let([1, 2])` / `b.const(list())` — a bare python list, set or tuple, empty or not | `cannot lift python value of type list …` — pass the East type: `b.let([], ArrayType(IntegerType))`, or build it with `East.new_array` |
| `no-let-const-in-expression` (EAS013, warning) | `b.let` / `b.const` buried in a call argument, an element, a chain target (a tuple of declarations is fine) | give the declaration its own statement |
| `no-untracked-east-data` (EAS014, suggestion) | a plain python list/dict local reaching an expression's method | `b.const(rows, Type)` — a local carries no East type and re-inlines |
| `no-redundant-east-cast` (EAS015, warning) | `b.let(East.value(x, T), T)` | pass the value and type to `b.let` directly |
| `prefer-let-const-over-east-value` (EAS016, suggestion) | `East.value(...)` assigned or returned inside a body | `b.const(value, Type)` — `East.value` erases the type at the binding |
| `no-host-comparison-on-east-values` (EAS017) | `<` / `>` on a decoded VARIANT or OPTION outside a body — it raises `TypeError` (`==` is structural and fine; a decoded Integer is an `int`) | `compare_for(T)` / `less_for(T)`, `make_east_key(T)` for `sorted` |
| `no-module-scope-east-macro` (EAS018, warning) | a module-scope helper a body calls to build IR, or to assemble a composite `f"{a}|{b}"` key | make it an `East.function`; model typed / nested East data |
| `no-build-time-clock` (EAS019, warning) | `datetime.now()` / `time.time()` at module scope (a script's `if __name__ == "__main__":` is not module scope) | author the constant, or read the clock at runtime — a platform function, or `east_py_std`'s `time_now()` in a body |
| `no-inline-credentials` (EAS020, warning) | a literal `password` / `token` / `secret_access_key` (a localhost sibling host, a header NAME like `X-Api-Key`, and a `${TEMPLATE}` are exempt) | read it at runtime: `east_py_std`'s `env_get("VAR")` in a body, `os.environ` in a platform function — IR is content-addressed and replicated |
| `no-compile-time-data-injection` (EAS021, warning) | `open()` / `json.load` / `Path.read_text` / `os.environ` at module import, when the result REACHES East (a body reads it, or a boundary call takes it) | load at runtime: an e3 input, a dataset, a platform function |
| `no-python-east-data` (EAS022, warning) | East rows assembled by a module-scope comprehension or loop, then handed to a body | write the rows out, or produce them at runtime |
| `no-python-string-building` (EAS023, warning) | an f-string assembling an East string CONSTANT — a regex, a template, a key | spell the constant out |
| `no-derived-struct-fields` (EAS024, warning) | `Derived = StructType([… for f in Other.value])` | a type declaration is a wire format — spell the fields |
| `no-python-data-work` (EAS025, warning) | a python helper doing parse / strip / null-check / coerce work on an EXPRESSION a body hands it | express it in East, where it runs on every row |

Configure it once in the project's `pyproject.toml`; every surface reads it, and
`east-py lint`'s own flags add to it:

```toml
[tool.east-py]
check = true                       # let an EDITOR run the build tier (off by default)
disable = ["no-deprecated-alias"]  # rules to skip
exclude = ["fixtures", "vendor"]   # extra directory names not to walk
```

`check` is off unless a project asks: the rules READ a file, the build RUNS it,
and an editor should not import someone's modules on save because a language
server happened to be installed. `east-py check` on the command line is consent
in itself and ignores the setting. Unreadable configuration falls back to the
defaults — a diagnostics tool must never stop a project building.

A file that does not import `east` is never diagnosed; a line ending in `# noqa`
(or `# noqa: EAS002` / `# noqa: no-operator-fork`) is skipped; `.venv`, `venv`,
`node_modules`, `dist`, `build`, `.git`, `__pycache__`, `tests` and `test` are not
walked. The rules are syntactic, so a clean `lint` is necessary, not sufficient —
the type errors live behind `east-py check`. The rules are disjoint (each
mistake is one rule's to report). One TypeScript rule has no python twin on
purpose: `no-reinlined-east-binding` warns that a JS `const` holding an `Expr`
re-inlines it at each use, but the python build's CSE binds a reused python local
to ONE `Let`, so the hazard does not exist here.

### Cross-language functions: `east-py export-functions` and `East.import_function`

A python `East.function` is *called* from a TypeScript e3 task — and a
TypeScript one from python — as pure IR: no python at run time, no platform
bridge. The functions travel as a **function manifest** (each function's IR,
declared type and platform dependencies with the package providing each);
the importer names the function and declares its type; linking checks the
type exactly and embeds the IR. Declare them on the package's root module:

```python
# packages/pricing/src/pricing/__init__.py — the package's root module
from east import East
from east.types.types import FloatType, StructType, IntegerType

Row = StructType([("qty", IntegerType), ("price", FloatType)])
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)
east_functions = {"score": score}          # name -> East.function artifact. CLOSED values: the
                                           # exported IR must BIND every name it reads. A build's
                                           # own hoisted constants — a captured lookup table, a
                                           # stdlib format string — ride along and close over
                                           # nothing; a .bind result (no IR of its own) and
                                           # an unresolved import are refused, and a genuinely free
                                           # variable is refused BY NAME
```

```typescript
// the e3 task, in TypeScript (see the e3 skill) — the reference is all there is to write:
// e3.export finds `pricing` in the uv workspace, exports it (east-py export-functions, in the
// project's .venv) and links; the providers come from the task's runner
const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));
await e3.export(pkg, "out.zip");
```

For a package built elsewhere (published, another repo), or to link
in-process, write the manifest where the package lives and pass it:

```bash
east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std
#   -p names the platform package implementing each platform call the functions make;
#   a call no package provides fails the export (the manifest records the provider)
#   → e3.export(pkg, "out.zip", { functions: ["./pricing.functions.beast2"] })
```

The other direction, in python:

```python
manifest = East.decode_function_manifest(Path("maths.functions.beast2").read_bytes())  # east-node export-functions wrote it
double = East.import_function("maths", "double", FunctionType([IntegerType], IntegerType))
user = East.function([IntegerType], IntegerType, lambda b, x: double(x) + 1)   # callable in a body
ir, imports = East.link_imports(user, [manifest])       # exact type check; the IR embedded as a Let
compile_from_value(ir, [])(20)                          # 41 — pure IR, runs on any runner
```

Unlinked, the reference is a `Platform` node named `east.importFunction`, and
compiling it raises naming that platform. `East.export_functions(pkg, version,
{…}, providers)` and `East.encode_function_manifest` are the API behind the CLI,
and `East.platform_dependencies(fn)` lists the platform functions an artifact
calls, in first-use order (unresolved imports skipped). Each also answers to its
TypeScript camelCase name (`East.exportFunctions`, `East.linkImports`, …). The
contract and the runner rules: `docs/conventions/EAST_CODEGEN.md`.

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
- **Scalars and dates** — see [Scalars](#scalars-use-the-easttype-utilities-for-consistency--above-all-string--datetime):
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
   natively, and inside another body it re-runs its source in its own frame and
   splices in (`East.function([Row], FloatType, lambda b, r: amount(r) * 1.1)`).
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

### Construction & validation (`from east import ...`)

| Signature | Description | Example |
|-----------|-------------|---------|
| **Ergonomic constructors** |
| `array(element_type, items, *, validate=True) -> EastArray` | Each item coerced/validated to `element_type` (dict→struct, int→Float, …); `validate=False` stores as-is | `array(LineItem, [{"name":"a","price":1}])` |
| `struct(fields: dict, typ: StructType\|None=None) -> EastStruct` | Reorders/coerces keys to `typ` (else infers from fields); dual-mode — a field holding an expression (at any depth) builds Struct IR instead | `struct({"price":1,"name":"a"}, LineItem)` |
| `variant(case: str, value, typ: VariantType\|None=None) -> EastVariant` | Tagged value; validates `value` against case `case` (matched **by name**); read back via `.type`/`.value`; dual-mode — an expression payload builds Variant IR, typed by `typ` or by context | `variant("named", "red", Color)` |
| `some(value) -> EastVariant` / `none` | Option `some`; `none` is a **constant**, not a function | `some(5)` / `none` |
| `match(v, cases: dict, default=None)` | Dispatch on `v.type`; the handler is a body, **always** called `handler(b, v.value)` — the `none` arm is `lambda b, v: …`, not `lambda: …`; `default` is a `default(b)` body for the cases without a handler (a plain value is returned as is) | `match(o, {"some": lambda b, x: x, "none": lambda b, v: -1})` |
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

### A JSON contract for a type — `json_schema_for` / `type_from_json_schema`

`East.String.print_json` writes **East JSON**, lossless and self-describing.
`json_schema_for(T)` emits the JSON Schema of exactly that encoding, so another
system can validate a payload before sending it; `type_from_json_schema` goes the
other way. Host-side functions, like `compare_for` — no expression, no IR:

```python
import json
from pathlib import Path

from east import ArrayType, IntegerType, StringType, StructType
from east.serialization import json_schema_for, type_from_json_schema

Reading = StructType([("sensor", StringType), ("litres", IntegerType)])
Path("contract.schema.json").write_text(
    json.dumps(json_schema_for(ArrayType(Reading), draft="draft-07"), indent=2))

T = type_from_json_schema(json.loads(Path("partner.schema.json").read_text()))
```

| Signature | Notes |
|-----------|-------|
| `json_schema_for(typ, draft="2020-12") -> JsonSchema` | `draft`: `"2020-12"`, `"draft-07"` or `"openapi-3.0"`, as a consumer's validator pins. `Never`, `Function` and `AsyncFunction` raise `TypeError` naming what has no JSON form |
| `type_from_json_schema(schema) -> EastType` ❗ | Raises `JsonSchemaUnsupportedError` — its `.pointer` the RFC 6901 location, also in the message — on what East cannot express: `allOf`, `not`, `if`/`then`/`else`, `anyOf`, `patternProperties`, `prefixItems`, a union of more than one type, an open record, an optional property, an untagged `oneOf`, a non-local `$ref`, a cycle of definitions no single definition breaks |
| `EAST_JSON_PATTERNS` | The lexical forms of East JSON's scalars — `.integer` `.blob` `.float_specials` (TypeScript: `floatSpecials`) — so a reader enforces exactly what the schema describes. A DateTime has none: its form is `format: "date-time"` |

- **An `Option<T>` is `null` or `T`'s own encoding** wherever `T` can never
  encode as `null`: `none` → `null`, `some(7)` → `"7"`, a struct field
  `"note": null` or `"note": "x"` (an absent key is still an error). Only
  `Option<Null>` and `Option<Option<T>>` keep the tagged `{"type": …, "value":
  …}` object, which keeps `some(none)` apart from `none`; a recursive payload is
  judged by what it wraps. The rule is a total function of the type, applied by
  every codec and reader and by `json_schema_for` (a flat Option is `oneOf
  [null, T]` annotated `x-east-type: "Option"`), and the tagged object under a
  flat Option is refused by the payload's own decoder (`expected string, got
  {"type":"none","value":null}`).
- **A `DateTime` is `format: "date-time"`**: every decoder, on every runtime,
  reads any RFC 3339 date-time — `Z` or any offset (the instant is UTC), `t`/`z`
  in either case, any fractional digits (past the millisecond dropped, never
  rounded, so `isoformat()`'s microseconds read to the millisecond), a leap
  second as the Unix time its fields add up to — in years 0001–9999, the range
  every runtime holds. `print_json` writes UTC, three fractional digits, `+00:00`.
- **Other scalars are described as the encoder emits them**: an `Integer` is a
  quoted i64 decimal, a `Blob` lowercase hex (`parse_json` also takes uppercase,
  which the contract does not), so a producer that validates cannot send what a
  strict reader rejects. Every pattern spells digits `[0-9]` — python's `\d`
  matches any Unicode digit — so validators here and in JavaScript agree.
- **The document is deterministic and byte-identical to TypeScript's
  `jsonSchemaFor`** (key order, `$defs` names in first-encounter order, variant
  case order). Its `x-east-type` annotations make the inverse exact — `Set` vs
  `Array`, `Dict` vs an array of pairs, a flat Option vs any other `oneOf`. A
  foreign schema without them converts under a structural mapping that does not
  promise to round-trip: `format: "date-time"` reads as a `DateTime` (any other
  `format` is a `String`), and `nullable: true`, `["string", "null"]` and a
  `oneOf` of null and one schema read as an Option.
- **Recursion binds one `recursive_type` per cycle group**: definitions that
  reference each other convert when every cycle passes through one definition,
  the binder; three that each reference the other two need two binders and are
  refused, naming them.
- To READ a document larger than memory under this contract: `json_open` /
  `json_next` in **east-py-std**.

### EastArray — complete method surface

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
| Convert | `to_tree(node, key(el[, i]), parent(el[, i])->some/none, build(el, i, children)) -> Array<node>` (flat parent-keyed rows → nested nodes of any depth, iterative — [Trees from flat rows](#trees-from-flat-rows-and-recursion)) · `string_join(sep) -> str` (String arrays) · `to_vector() -> EastVector` (Float/Integer/Boolean elements, in order — east-c VectorFromArray; the expression method emits the same builtin) · `encode_csv(config=None, **options) -> EastBlob` (Array of structs; east-c ArrayEncodeCsv) |
| Mutate (in place, the TS names) | `push_last(item)` · `push_first(item)` · `append(array)` (ArrayAppend — a whole array, NOT one element) · `prepend(array)` · `pop_last()` · `pop_first()` · `update(i, item)` ❗bounds · `merge(i, value, update_fn(existing, incoming[, i]))` · `merge_all(array, merge_fn(existing, incoming[, i]))` · `clear()` · `sort_in_place(by=None)` · `reverse_in_place()` — plus the python protocol: `extend(iterable)` (bulk: one crossing; C-to-C for same-type East arrays, raw buffers for numpy) · `insert(i, item)` · `pop(i=-1)` · `remove(item)` · `count(value) -> int` · `index(value) -> int` |

### EastSet — complete method surface

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

### EastDict — complete method surface

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
| Convert | `keys() -> Set` · `to_array(fn(value[, key]), out=None)` · `to_set(fn(value[, key]), out=None)` · `to_dict(key_fn, value_fn=None, combine=None, key_out=None, value_out=None)` (the value itself when `value_fn` is omitted; a duplicate key errors without `combine`) · `to_tree(node, parent(value[, key])->some/none, build(value, key, children)) -> Array<node>` (each entry's key its key) · `copy()` |
| Mutate (in place) | `d[k]=v` · `del d[k]` · `insert(k, v)` (errors if present) · `get_or_insert(k, fn(k))` · `insert_or_update(k, v, combine(existing, incoming, k))` · `update(k, v)` (TS; the read-modify-write `update(k, fn(current))` is deprecated) · `swap(k, v) -> prev` · `delete(k)` · `try_delete(k) -> bool` (`update`/`swap`/`delete` error on a missing key) · `pop(k, *default)` · `clear()` |
| Bulk (in place) | `update_many(keys, values, combine(existing, incoming)=None)` — the whole batch crosses once; a pure/precompiled `combine` resolves collisions C-to-C (dicts as hot-loop accumulators) |

### EastVector — complete method surface

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

### EastMatrix — complete method surface

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

### EastBlob (a `bytes` subclass)

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

### EastStruct / EastVariant / EastRef

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

### Container generators (classmethods)

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

### East.<Type> namespaces — the builtins and the standard library

Scalars are plain Python, so their builtins are namespace functions — **complete** lists below.
Every one delegates to east-c, and every one is dual-mode: on plain values it runs now, on
expressions it emits IR. The `stdlib:` rows are the TypeScript standard library
(see [the stdlib](#the-standard-library--the-typescript-easttype-functions)).

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
under East's total order) and `East.clamp(value, lo, hi)` — all dual-mode.

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

### DateTime format codes

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

### Beast2 streaming — bounded-memory collections (`from east.serialization.beast2 import ...`)

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
| `Beast2RunSorter(T, open_run, *, merge=None, union=False, codec="deflate", parallel=False)` | A Set's or Dict's elements in ANY order in, sorted canonical runs out: `.add(el)` encodes at once; at `RUN_MAX_COUNT` elements or `RUN_MAX_BYTES` it sorts the run — stably, so a key's values keep the order they came in — folds a repeated key (`merge`, a compiled `(K, V, V) -> V` East function, for a Dict; `union=True` for a Set; neither: it raises) and writes the run to `open_run(run)` (anything with `write(bytes)` and `close()`) as its value's canonical blob. `.finish()` writes the last run; `.runs` counts them. The runs are the ones east-c and TypeScript write; a sink's exception comes back out of the call that wrote the run; a key repeated across runs is the merge's to fold |
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

### Columnar escape hatches — when the logic must stay python

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

### Platform functions

| Signature | Description |
|-----------|-------------|
| `@East.platform_function(*, inputs, output, name=None, is_async=None, validate_output=True, validate_input=False)` | Register a Python fn; infers sync/async from the def (`is_async=` declares it when they differ — a function East calls asynchronously on every runtime whose python is a plain `def`); validates output against `output`. DUAL-MODE: called with values it runs the python (an async def's coroutine, to await); called inside an `East.function` / `East.asyncFunction` body it emits the `Platform` node with this signature — an async one inside a sync body is the build-time error. Paired at compile by name (the def's, or `name=`). Also importable bare: `from east import platform_function` |
| `@East.generic_platform_function(*, type_parameters, name=None, is_async=False, inputs=None, output=None, type_erased=False)` | Type-parameterized factory: the decorated fn is `fn(platform, *type_params) -> impl`; `is_async` is **explicit** (not inferred). With `inputs=`/`output=` (placeholders allowed anywhere: `output="T"`, `output=ArrayType("T")`) it is dual-mode too: `fs_open_beast(DictType(K, V), path)` in a body — the type arguments first, as TypeScript reads — emits the generic node; without them a body call is a build error naming what to declare. `type_erased=True` when the implementation ignores the type arguments (it reads the values): the decorated fn IS the implementation, python calls it directly (`causal_experiment(rows, config)`) and the factory the runtime binds is derived |
| a platform function RETURNING a lazy value | A `@platform_function` may return a paged hold — an `open_beast2_file(...)` value, `open_paged_file(T, path)` (a C-owned mapping), `fs_open_beast(...)`'s result — and the compiled body keeps its O(segment) cost model: the C value crosses the return seam by pointer (checked against the declared output type, never re-marshalled through python), and nothing python-side has to outlive it: the mapping is the value's own. The mirror of a paged ARGUMENT crossing in |
| `East.platform_functions(module) -> list` | Collects every decorated fn in `module` (pass `__name__`). Two consumers: `East.compile()` for in-process use, and a package's top-level `platform` list that `east-py run -p <module>` (and the e3 `{ custom }` runner) loads |
| `@memoize` / `@memoize(salt="…")` / `memoized = memoize(fn, salt="…")` | Content-addressed memo over ONE platform function. Apply **above** `@East.platform_function` (or inline on an imported one). Key = sha256(name + salts + per-input digests of the with-header BEAST2 encodings via the declared input types); value = with-header BEAST2 of the output, decoded via the declared output type. Inert by default |
| `configure_memo(directory, salt="")` | Activate (`None` deactivates) memoization for `@memoize` functions; overrides `EAST_MEMO_DIR` / `EAST_MEMO_SALT` env vars. Bump `salt` to invalidate after code edits — input-derived keys can't see them |

### What is NOT east-c

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

## The east-py CLI

`east-py` (the `east-py-cli` package) runs East IR with python platform
functions — the runner e3 drives for `runtime: 'east-py'` — and carries the
authoring tools:

```bash
east-py run prog.beast2 -p east-py-std -i a.beast2 -i b.json -o out.beast2   # -v: timings, peak memory
east-py exec unit.beast2                        # one unit: the runner protocol e3 speaks
east-py convert value.beast2                    # a beast2 value as East text (-o value.east to write it)
east-py transpile prog.beast2 -o prog.py        # IR → a python module that rebuilds it
east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std
east-py lint src/ ; east-py check src/ ; east-py lsp
east-py version -p east-py-std                  # the runner's version, and each package's
```

| Command | Does |
|---|---|
| `run <ir> [-p PACKAGE]… [-i FILE]… [-o FILE] [--decode lazy\|whole] [-v]` | Compiles an IR file (`.beast2`, `.beast`, `.east` or `.json`) and calls it with one `-i` file per parameter, in order, each decoded by its extension to the parameter's type and FROZEN (a task input is immutable). An indexed beast2 collection input opens lazily, whatever it weighs — mapped, one segment decoded at a time, and decoded whole, once, when an operation the pager cannot serve first needs it — and a manifest file opens as the collection it names; `--decode whole` (east-c's and east-node's flag too) decodes every input before the program runs instead. `-o` writes the result in its extension's format (a collection as canonical indexed beast2); without it the result prints as East text. `-v` adds timings, peak memory and how each input was read: a lazy input's segment reads, or the resident memory a whole decode added |
| `exec <unit> [-v]` | The runner protocol: one unit file says what to run — a program over its inputs, read as its `decode` says (as `run --decode`), or a merge of an output's parts — and where; the output is written by its kind and a result recorded. Exit 0 when it succeeded, 1 when it failed (the message and locations also go to stderr), 2 when the unit cannot be read or the result written. Relative paths in the unit are relative to its directory |
| `convert <file> [-o FILE.east] [-v]` | Decodes a beast2 value (its header names the type) and prints it as East text, or writes it to a `.east` file |
| `transpile <ir> [-o FILE] [--name NAME] [-p PACKAGE]…` | IR as a python module rebuilding it (`--name` binds it, default `main`; each `-p` prints its calls as that package's own functions) — [IR ↔ python](#ir--python-east-py-transpile-and-the-east-c-ir-toolbox) |
| `export-functions <module> -o FILE [-p PACKAGE]… [--name NAME] [--package-version V] [--only NAME]…` | A module's (a dotted name, or a `.py` path) `east_functions` as a function manifest; every platform call must be provided by a `-p` package; `--name` defaults to the module's top-level name, the version to the installed distribution's (else `0.0.0`); `--only` exports just those — [Cross-language functions](#cross-language-functions-east-py-export-functions-and-eastimport_function) |
| `lint [paths…] [--format text\|json] [--disable RULE]… [--exclude DIR]… [--list-rules]` | The rules (default path `.`); exit 1 on any finding, a warning included, 2 on a usage error — [Diagnostics](#diagnostics-at-edit-time--east-py-lint-east-py-check-flake8-east-py-lsp) |
| `check <targets…> [--format text\|json] [--only-if-enabled]` | The build's own errors; exit 1 on any |
| `lsp [--probe]` | The Language Server over stdio (needs `pygls`); `--probe` reports whether it can start here |
| `version [-p PACKAGE]…` | The `east-py-cli` and `east-py` versions (and the Cython extensions loaded), and each package's version and function count |

A `-p` package is a python module name (`east-py-std` imports `east_py_std`)
exporting a top-level `platform` list; a project's own module is loaded the same
way (see [Project-owned platform module](#project-owned-platform-module-calling-your-python-from-e3)).
`run` and `exec` take `--exit-with-parent`: exit once stdin reaches end of file,
for a parent that holds a stdin pipe it never writes to.

## Key Patterns

### Python values vs East expressions

The `east` skill's first rule, in python: a body's PARAMETERS are expressions;
a python value used inside a body must lift. Scalars lift on their own; a
collection must be an explicit choice.

```python
RATES = EastDict(StringType, FloatType, {"AUD": 0.65})   # python-side East value
CUTOFF = 100

@East.function([Row], FloatType)
def usd(b, r):
    return East.if_else(r.amount > CUTOFF,                # a scalar constant lifts (TS East.value)
                        r.amount * RATES.get_or_default(r.ccy, 1.0),   # an EXPLICIT build snapshots the dict
                        0.0)

rows.map(lambda b, r: r.amount * RATES.get_or_default(r.ccy, 1.0))   # ❌ an eager callback REFUSES
                                                                    #    the collection capture:
conv = East.function([Row, DictType(StringType, FloatType)], FloatType,
                     lambda b, r, t: r.amount * t.get_or_default(r.ccy, 1.0))
rows.map(conv.bind(RATES))                                          # ✅ bind it: live, zero-copy
```

### The canonical platform function

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

### Project-owned platform module (calling your Python from e3)

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

### Memoize expensive pure stages (dev/test harnesses)

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

### Keyed lookups against a file too big to load

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

### Sequential logic that stays in east-c (worklist / replay)

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

### Trees from flat rows, and recursion

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
- **Recursion** — a function calling itself through a captured variable — is
  for shallow depths, in the hundreds. Deeper, a call ❗ `call stack exhausted:
  East calls nested too deeply`, a catchable `EastError` on every runtime. Walk
  deep data with `b.while_` or `to_tree`; a recursive VALUE's depth is still
  bounded, at tens of thousands of levels, by east-c's recursive collect and
  free.

### Sort uses East's total order

```python
# WRONG — Python's default ordering (incorrect for floats/NaN, mixed, type-specific)
sorted(list(arr))

# CORRECT — East total order, in east-c (the TypeScript names)
arr.sort()                        # new array
arr.sort_in_place()               # in place
arr.sort(lambda b, r: r["x"])     # by a projection, still East-ordered
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
East.DateTime.print_formatted(dt, "YYYY-MM-DD HH:mm:ss")   # Day.js tokens, not dt.strftime("%Y-…")
East.Float.print_currency(total)                         # "$1,234.57" — the stdlib, same in TS

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
