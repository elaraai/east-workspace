---
name: east-py
description: "East in Python: (A) East EXPRESSIONS — write East functions in Python with East.function / East.asyncFunction, the block `b` (TypeScript's `$`), one expression class per East type with the TypeScript methods in snake_case, the standard library (East.Integer.print_compact, East.Float.round_to_decimals, East.DateTime.round_down_week, East.str), East.platform + East.compile, and IR ↔ python codegen; (B) East VALUES — East runtime data as ordinary Python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant/Ref/Blob) whose eager methods run in east-c under the SAME names, validation/coercion, beast2 files, numpy/torch, and @East.platform_function to expose Python to East. Use when writing Python (not the TypeScript DSL) against east-py. Triggers for: (1) Writing an East function in Python (East.function, b.let/b.if_/b.for_, expression methods, the stdlib), (2) Constructing/validating East values (array/struct/variant/some/none, coerce_to/assert_value_of), (3) Transforming values with eager methods (sort/map/filter/reduce/group_*/set algebra/dict merge), (4) Scalar builtins and the stdlib via East.<Type>, (5) @East.platform_function, (6) beast2 files and numpy/torch through EastVector/EastMatrix, (7) Porting a plain-Python data-science POC into an East platform function, (8) Printing IR as python (east-py transpile), (9) Exporting East functions for TypeScript / e3 tasks and importing TypeScript-authored ones (East.export_functions / East.import_function, east-py export-functions), (10) Diagnosing East bodies at edit time — the build's refusals as lint (east-py lint, flake8 EAS codes, east-py lsp)."
---

# East.py — East expressions and East values in Python

`east-py` is the Python runtime for East: a Cython bridge to the native **east-c**
runtime (IR compilation, the builtin library, execution and serialization all run in
east-c). It has **two surfaces** that share **one vocabulary** — the TypeScript method
names, snake_cased:

- **East expressions** — write East *functions* in Python, exactly as the TypeScript
  `east` skill does. `East.function(param_types, out, body)` runs `body` ONCE over typed
  expression proxies (the block `b` first — TypeScript's `$`), records IR, and east-c
  compiles it. Every East type has an expression class (`ArrayExpression`,
  `DictExpression`, `IntegerExpression`, …) mirroring `libs/east/src/expr/*.ts` method
  for method, plus the standard library (`East.Integer.print_compact`,
  `East.DateTime.round_down_week`, …) and the statement set (`b.let`, `b.if_`,
  `b.while_`, `b.for_`, `b.match_`, `b.try_`, `b.return_`). Anything East cannot express
  raises at build time — there is no interpreter behind it.
- **East values** — the *data*: `EastArray`/`EastSet`/`EastDict`/`EastVector`/
  `EastMatrix`/`EastStruct`/`EastVariant`/`EastRef`/`EastBlob` are handles into the
  east-c value slab; scalars are plain `int`/`float`/`str`/`bool`/`datetime`. Their
  **eager methods** — the same names — execute immediately in east-c and chain;
  `@East.platform_function` exposes a Python function to East.

They meet in two places. A **callback** handed to an eager method
(`items.map(lambda b, r: …)`) is an East function body: captured once, compiled, and
run natively per element — never per-element Python. And an `East.function` artifact
is a plain callable on values, accepted by every eager method. (For the TypeScript DSL
use the `east` skill; for ML/optimization platform functions, `east-py-datascience`.)

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
| An option | `.is_some()` / `.unwrap_or(d)` / `.match({…})` | an `EastVariant`: `.type == "some"`, `.value`, `.unwrap()`, `.match({…})` |
| Errors | an operation East cannot express raises `ExpressionError` at BUILD time, naming the binding or method | a runtime `EastError` / `EastTypeError` |

A body's parameters are expressions already; a python scalar or `datetime` inside a body
lifts to a literal, `East.value(v, T)` / `b.const(v)` lift anything else explicitly (TS
`East.value` / `$.const`); an East COLLECTION closed over by an `East.function` body is
snapshot into the IR (to keep it live, `.bind(table)` it as a trailing parameter). In the
other direction an artifact is a plain callable on values, every eager method accepts one
(a VALUE takes no block), and referencing one inside another body splices it in — see
[Python values vs East expressions](#python-values-vs-east-expressions).

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ A. WRITE AN EAST FUNCTION IN PYTHON — East expressions (the `east` skill's twin, name for name)
    │   ├─ Define a type (PAIRS, not a dict) → IntegerType · FloatType · StringType · BooleanType · DateTimeType · BlobType · NullType ·
    │   │   ArrayType(T) · SetType(K) · DictType(K, V) · RefType(T) · VectorType(T) · MatrixType(T) (T ∈ Float/Integer/Boolean) ·
    │   │   StructType([("f", T), …]) · VariantType([("case", T), …]) · OptionType(T) · recursive_type(lambda self: …) ·
    │   │   FunctionType(I, O) · AsyncFunctionType(I, O) · PatchType(T)
    │   ├─ Author → East.function([T…], Out, lambda b, x: …) · @East.function([T…], Out) def f(b, x) · East.asyncFunction(…)  ❗out is required
    │   │   ├─ a pure body compiles immediately → f(values) runs natively · xs.map(f) · f.bind(table) pre-binds trailing params BY REFERENCE
    │   │   ├─ a platform call inside → East.platform(name, inputs, output) / East.asyncPlatform · optional=True · East.genericPlatform(name, ["T"], …)
    │   │   ├─ implement it in python → @East.platform_function(inputs=[…], output=…[, name=]) — paired with the declaration BY NAME (the def's, or name=)
    │   │   ├─ compile with the implementations → East.compile(fn, platform=East.platform_functions(__name__)) / East.compileAsync (analyzed first; a
    │   │   │   declaration no implementation matches is a named EastError)
    │   │   └─ spelled INSIDE a body → an inline Function EXPRESSION (bind it with b.const, hand it to a slot, or call it — a Call node)
    │   ├─ Block statements — the block `b` a body receives FIRST (TS `$`); a bare `lambda x:` is refused
    │   │   ├─ Variables → b.let(value[, T]) (mutable) · b.const(value[, T]) · b.assign(var, value)
    │   │   ├─ Execute → b.do(expr) ($(expr)) · b.return_(value) · b.error(msg)
    │   │   ├─ Control flow → b.if_(pred, fn).else_if(pred, fn).else_(fn) · b.while_(pred, fn(b, label)) · b.for_(coll, fn(b, v, i, label)) ·
    │   │   │   b.break_(label) / b.continue_(label) · b.match_(v, {case: fn(b, x)})
    │   │   ├─ Errors → b.try_(fn).catch(fn(b, message, stack)).finally_(fn)
    │   │   └─ Statements inside an EXPRESSION form (a callback, an if_else arm) → East.block(lambda b: …)
    │   ├─ Expression operations (the TypeScript methods, snake_cased — the full tables are under “The expression surface, type by type”)
    │   │   ├─ Boolean → & | ^ ~ (never and/or/not/if) · .bit_and(y) .bit_or(y) .bit_xor(y) .not_() · short-circuit .and_(fn(b)) .or_(fn(b)) ·
    │   │   │            .if_else(fn(b), fn(b)) · East.if_else(cond, value, …, otherwise) (one IfElse node) · .equals/.equal/.eq .not_equals/.ne
    │   │   ├─ Integer → + - * (unary -) · .add .subtract .multiply .divide .remainder .pow (+ .plus .minus .times .div .mod .rem .modulo) ·
    │   │   │            .abs .sign .negate .log(base) · .to_float() · == != < <= > >= (.less_than/.lt … .greater_equal/.ge) ·
    │   │   │            ❗ // % ** / RAISE at build time with fix-its (#624): .divide · .remainder · .pow · .to_float() / y
    │   │   ├─ Float → + - * / ** (unary -) · the same named math · .sqrt .exp .log .sin .cos .tan · .to_integer() ❗non-integral ·
    │   │   │          Float → Integer is the stdlib: East.Float.round_floor/round_ceil/round_trunc/round_half(x) (math.floor/ceil/trunc(x) build them;
    │   │   │          .floor()/.ceil()/.trunc()/.round() are deprecated aliases; round_half = ties AWAY from zero — python round() raises)
    │   │   ├─ String → + (concat) · .concat .repeat .substring .upper_case .lower_case .trim .trim_start .trim_end · .replace .split ·
    │   │   │           .length .starts_with .ends_with .contains .index_of · .parse(T) ❗ .parse_json(T) .try_parse(T)→Option ·
    │   │   │           .encode_utf8 .encode_utf16 · .regex_contains/.regex_index_of/.regex_replace(pat, …, flags=) · East.str(…) — never an f-string
    │   │   ├─ DateTime → .get_year/.get_month/.get_day_of_month/.get_day_of_week/.get_hour/.get_minute/.get_second/.get_millisecond ·
    │   │   │             .add_/subtract_{milliseconds,seconds,minutes,hours,days,weeks}(n) · .duration_{…}(other) ❗ a.duration_days(b) = b − a ·
    │   │   │             .to_epoch_milliseconds() · .print_formatted("YYYY-MM-DD") · a python datetime literal lifts
    │   │   ├─ Blob → .size .get_uint8 · .decode_utf8 .decode_utf16 · .decode_beast(T, version) · .decode_csv(RowT, config=)
    │   │   ├─ Array → Read .size .length .has .get(i[, on_missing(b, i)]) ❗ .at .try_get .get_keys · xs[i] (a negative LITERAL index raises) ·
    │   │   │          Mutate (yield Null/Boolean — b.do it or East.block it) .update .push_last .pop_last .push_first .pop_first .append(array) .prepend(array) ·
    │   │   │            .merge .merge_all .clear .sort_in_place .reverse_in_place ·
    │   │   │          Transform .copy .slice .concat .sort .reverse .map .filter .filter_map .flat_map ·
    │   │   │          Search .find_first .find_all .first_map .is_sorted .find_sorted_first/last/range ·
    │   │   │          Reduce .reduce(fn, init) .scan(fn, init) .every .some .sum .mean .maximum .minimum .find_maximum .find_minimum ·
    │   │   │          Convert .string_join .to_set .to_dict .flatten_to_set .flatten_to_dict .encode_csv .to_vector .unique ·
    │   │   │          Group .group_by .group_reduce .group_size .group_sum .group_mean .group_minimum .group_maximum ·
    │   │   │            .group_to_arrays/sets/dicts .group_every .group_some .group_find_all/first/maximum/minimum · effect .for_each
    │   │   ├─ Set → .size .has · .insert .try_insert .delete .try_delete .clear .union_in_place · .copy .union .intersection .difference ·
    │   │   │        .symmetric_difference .is_subset_of .is_superset_of .is_disjoint_from · .filter .filter_map .map(→Dict) .for_each .first_map ·
    │   │   │        .reduce .scan .every .some .sum .mean · .to_array .to_set .to_dict .flatten_to_array .flatten_to_set .flatten_to_dict · .group_*
    │   │   ├─ Dict (callbacks are (value, key)) → .size .has .get(k[, on_missing(b, k)]) ❗ .get_or_default .try_get .keys .get_keys · d[k] ·
    │   │   │        .insert .insert_or_update .update .merge .get_or_insert .delete .try_delete .pop .swap .clear .union_in_place .merge_all ·
    │   │   │        .copy .union .map .filter .filter_map .for_each .first_map · .reduce .scan .every .some .sum .mean ·
    │   │   │        .to_array .to_set .to_dict .flatten_to_array .flatten_to_set .flatten_to_dict · .group_*
    │   │   ├─ Vector → .length .get · .set(→new) · .slice .concat .map .reduce · .scale .add_scaled .mul .add_scalar .abs .clamp .cum_sum ·
    │   │   │           .sum .dot .max .min .arg_max .arg_min .mean ❗empty · .eq/.lt/.gt → mask · mask.select(a, b) · data.compress(mask) ·
    │   │   │           mask.count_true() · .gather .scatter_add .search_sorted · .to_array .to_matrix
    │   │   ├─ Matrix → .rows .cols .get .get_row .get_col · .set(→new) · .transpose · .scale .add_scaled .mul_elementwise ·
    │   │   │           .row_sums .col_sums .vec_mul(v) · .to_vector .to_array .to_rows · .map_rows
    │   │   ├─ Struct → r.field / r["field"] · build with a dict literal {"k": expr, …} or struct({…}, T)
    │   │   ├─ Variant → .match({case: fn(b, x)}, default=fn(b)) · .match_tag(tag, fn, default) · .unwrap(tag="some", on_other=None) ❗ ·
    │   │   │            .has_tag .get_tag · Option: .is_some .is_none .unwrap_or(d) · build with some(expr) / none / variant(case, payload)
    │   │   ├─ Ref → East.ref(v) · .get() · .update(v) · .merge(v, fn(b, current, patch))
    │   │   └─ Function → a Function-typed parameter or a b.const(East.function(…)) is callable in the body (a Call node)
    │   ├─ Standard library (East.<Type>.*, dual-mode: on values or in a body)
    │   │   ├─ Integer → East.Integer.print_comma_seperated · print_currency · print_compact/_si/_computing · print_ordinal · print_percentage ·
    │   │   │            digit_count · round_nearest/up/down/truncate(x, step)
    │   │   ├─ Float → East.Float.approx_equal · round_floor/ceil/half/trunc · round_nearest/up/down/truncate(x, step) · round_to_decimals ·
    │   │   │          print_fixed · print_comma_seperated · print_currency · print_compact · print_percentage
    │   │   ├─ DateTime → East.DateTime.from_components · from_epoch_milliseconds · parse_formatted · print_formatted ·
    │   │   │             round_down/up/nearest_{millisecond,second,minute,hour,day,week} · round_down_month · round_down_year
    │   │   ├─ String → East.String.print_json(value) · print_error(message, stack) · Blob → East.Blob.encode_beast(value, "v1"|"v2")
    │   │   ├─ Array → East.Array.range · linspace · generate(size, T, fn) · Set → East.Set.generate(size, K, fn, on_conflict=) ·
    │   │   │          Dict → East.Dict.generate(size, K, V, key_fn, value_fn, on_conflict=)   (a duplicate key ERRORS without a handler)
    │   │   └─ Vector → East.Vector.zeros · ones · fill · from_array · sparse_axpy · sparse_from_pairs · sparse_filter_gt ·
    │   │              Matrix → East.Matrix.zeros · ones · fill · from_array · from_rows
    │   ├─ Root helpers → East.str(*parts) (TS East.str`…`) · East.print(value[, T]) (East text) · East.min/max(a, b) · East.clamp(x, lo, hi) · greatest/least ·
    │   │   East.equal/not_equal/less/less_equal/greater/greater_equal/compare(T, a, b) · East.value(v, T) · East.as_(v, T) · East.error(msg) ·
    │   │   East.wrap_recursive(v, R) / expr.unwrap() · East.builtin(name, [T…], [args], out) (the few with no named spelling)
    │   ├─ Control flow, expression forms → East.if_else(cond, v, …, otherwise) · East.while_(state, cond, body) · East.for_(coll, state, body) ·
    │   │   East.block(a, b, …) · East.let(value, fn(b, bound)) · East.try_catch(body, handler, finally_=) · East.new_array/new_set/new_dict/new_vector/new_matrix
    │   ├─ Body rules — what a body may reference
    │   │   ├─ Its parameters · python scalar / datetime constants (they lift) · East types · the East namespace · struct/variant/some/none ·
    │   │   │   other East.function artifacts (they splice in) · compiled / .bind functions (a Call) · helper lambdas two levels deep
    │   │   ├─ ❗ Anything else RAISES naming the binding: random.…, np.…, len/str, an f-string (constant-folds the proxy), a mutable python
    │   │   │   capture, `nonlocal x; x += 1` — for genuine python work write a python loop OUTSIDE the body
    │   │   ├─ ❗ A closed-over East COLLECTION: an East.function body SNAPSHOTS it (built once, later mutations unseen); an eager callback
    │   │   │   REFUSES it — .bind(table) keeps it live · read a snapshot with .get(expr)/.get_or_default/.try_get, never [expr]
    │   │   ├─ Reuse a python variable to share work → ONE Let (build-time CSE); loop invariants hoist out of callbacks; cse=False builds
    │   │   │   exactly what the body spells
    │   │   └─ Captures are CACHED per (code, bindings, signature) — a lambda whose captures change per call re-builds every call:
    │   │       hoist an East.function and .bind the varying value
    │   ├─ Sequential logic — the next step depends on the LAST (worklist · BFS · fixpoint · replay) — see Key Patterns
    │   │   ├─ Statements (TS `$`) → b.let/b.const locals · b.while_ / b.for_ · b.do(acc.push_last(x)) · b.assign(i, i + 1)
    │   │   ├─ Expression forms → East.while_(state, cond, body) · East.for_(coll, state, body): state = a dict of fields (read s.f) or one
    │   │   │   value; the body RETURNS the next state with the SAME fields and types ❗ · branch with East.if_else · keep a field → s.f ·
    │   │   │   change one → {**s, "k": …} · Array body(b, s, el[, i]) · Set body(b, s, el) · Dict body(b, s, k, v)
    │   │   ├─ Leave / skip → East.break_(state=, label=) · East.continue_(state=, label=) as an if_else arm (the state COMMITS before the
    │   │   │   jump) · East.label("outer") on an outer loop lets an inner one break all the way out
    │   │   ├─ Accumulate IN PLACE → East.new_array/new_set/new_dict (fresh per evaluation) · .push_last / .insert / .insert_or_update ·
    │   │   │   ❗ a bare mutation LINE is evaluated at build time and thrown away — the build raises; b.do(…) or East.block(mutation, result) ·
    │   │   │   ❗ mutating a CAPTURED collection raises (a loop SEED is exempt — rebuilt per call)
    │   │   └─ Sequence / bind / cell / catch → East.block(a, b, …) · East.let(value, fn(b, bound)) · East.ref(v) .get()/.update(v)/.merge ·
    │   │       East.try_catch(body(b), handler(b, message[, stack]), finally_=) (both arms one East type)
    │   ├─ IR ↔ python → to_python_source(fn) · `east-py transpile prog.json -o prog.py` · compile_from_beast2/json/east (a function compiled
    │   │   elsewhere — pass it to any eager method) · compile_from_value (IR built with east.ir.builders) · `east-c ir normalize|diff|convert`
    │   ├─ The build's refusals at EDIT time → `east-py lint src/` (exit 1 on any finding; `--format json`, `--disable RULE`, `# noqa`) ·
    │   │   `flake8 --select EAS` (the plugin) · `east-py lsp` (an editor) — nine rules, each the build's own message (see Diagnostics)
    │   └─ Across languages → the package's root module declares `east_functions = {"name": fn}`; an e3 task names it with East.importFunction and
    │       e3.export exports + links a uv-workspace package by itself (`east-py export-functions pkg -o pkg.functions.beast2 -p east-py-std` only for a
    │       package built elsewhere) · East.import_function(pkg, name, FunctionType) to call a TypeScript-authored one (`east-node export-functions`) ·
    │       East.link_imports(fn, [manifests]) before compiling in-process
    │
    ├─ B. WORK WITH EAST VALUES — the eager runtime (the same names; executes NOW in east-c; results stay C-side and chain)
    │   ├─ Build an East value from python data
    │   │   ├─ Array of structs from dicts → array(ElemType, [dict, …])   (coerces + validates each)
    │   │   ├─ One struct (reorder/coerce keys to a type) → struct({…}, StructType)
    │   │   ├─ Tagged value / option → variant(case, value, VariantType) · some(x) / none
    │   │   ├─ Numeric buffer for ML/tensors → EastVector(FloatType, np_1d) / EastMatrix(FloatType, np_2d) · from_numpy / from_torch
    │   │   ├─ A ref cell → east_ref(value) · Raw bytes → EastBlob(b"…")   (a bytes subclass; decode_csv/beast2/utf8 live on it)
    │   │   ├─ Generate → EastArray.range / linspace / generate · EastSet.generate · EastDict.generate · EastVector.zeros/ones/fill/from_array ·
    │   │   │   EastMatrix.zeros/ones/fill/from_array/from_rows   (East.Array/Set/Dict/Vector/Matrix.* are the dual-mode twins)
    │   │   └─ Anything, type-driven (int→Float, dict→Struct, np 1-D→Array, …) → coerce_to(value, typ)
    │   ├─ Validate a value at a python↔East boundary
    │   │   ├─ Raise on mismatch, path-pinpointed → assert_value_of(value, typ)   ❗EastTypeError
    │   │   ├─ List every problem (empty == conforms) → explain_value_of(value, typ)
    │   │   ├─ Boolean check → is_value_of(value, typ)
    │   │   └─ Infer a value's type → type_of(value)
    │   ├─ Transform a value (every callback is an East function body: the block first — fn(b, el), or fn(b, el, idx) for the builtin's index)
    │   │   ├─ Array<T>
    │   │   │   ├─ Access → get(i[, fn(b, i)]) ❗bounds · at(i) · get_or_default(i, d) · try_get(i) · has(i) · get_keys(idxs) · size()/length() ·
    │   │   │   │            arr[i] (pythonic) · len() · iterate
    │   │   │   ├─ Reorder → sort(by=, reverse=) (new array) · reverse() (new) · sort_in_place(by=) · reverse_in_place()
    │   │   │   ├─ Slice & combine → slice(start, end) · concat(other) · copy()
    │   │   │   ├─ Per-element → map(fn, out=) · filter(pred) · filter_map(fn, out=) · for_each(fn)
    │   │   │   ├─ Reduce → reduce(fn, init) · scan(fn, init) (running fold → Array, one per element) · map_reduce(map_fn, reduce_fn, out=) ·
    │   │   │   │            sum(fn=) · mean(fn=) · maximum(by=) ❗empty · minimum(by=) ❗empty (the ELEMENT, like TS) · every(pred=) · some(pred=)
    │   │   │   ├─ Search → find_first(target, key=) · find_all(value, by=) · find_maximum(by=)/find_minimum(by=) → some(i)/none ·
    │   │   │   │            find_sorted_first/last/range(target, key=) · first_map(fn, out=) · is_sorted(key=)
    │   │   │   ├─ Group → group_by(key) · group_reduce(key, init, fold) · group_size(key=) · group_sum(key, fn=) · group_mean(key, fn=) ·
    │   │   │   │            group_maximum/minimum(key, by=) (the ELEMENT per group, like TS) · group_every/some(key, pred) ·
    │   │   │   │            group_find_all(key, value, by=)/group_find_first(key, value, by=) → indices per group ·
    │   │   │   │            group_find_maximum/minimum(key, by=) → the INDEX per group (ties keep the earliest) ·
    │   │   │   │            group_to_arrays(key, value=) · group_to_sets(key, value=) · group_to_dicts(key, key2, value=, combine=)
    │   │   │   ├─ Convert → to_dict(key, value=, combine=) ❗dup w/o combine · to_set(key=) · unique() · string_join(sep) ·
    │   │   │   │            to_vector() ❗non-numeric · encode_csv(config=) → Blob · flat_map(fn, out=) · flatten_to_set(fn, out=) ·
    │   │   │   │            flatten_to_dict(fn, combine=) ❗dup w/o combine
    │   │   │   ├─ Columnar → to_columns(fields=) · EastArray.from_columns(T, cols) · map_batches(fn, out=, batch_size=)
    │   │   │   └─ Mutate (in place, the TS names) → push_last(v) · push_first(v) · append(array) · prepend(array) · pop_last() · pop_first() ·
    │   │   │                update(i, v) · merge(i, v, fn) · merge_all(array, fn) · clear() ·
    │   │   │                python protocol: extend(iterable) (bulk, one crossing) · insert · pop · remove · arr[i]=v
    │   │   ├─ Set<K>
    │   │   │   ├─ Access → len(s) · value in s · has(value) · iterate (East order)
    │   │   │   ├─ Algebra → union · intersection · difference · symmetric_difference · is_subset_of · is_superset_of · is_disjoint_from · union_in_place
    │   │   │   ├─ Per-element → map(fn)→Dict · filter(pred) · filter_map(fn)→Dict · first_map(fn) · for_each(fn)
    │   │   │   ├─ Reduce → reduce(fn, init) · scan(fn, init) (running fold → Array) · map_reduce(fn, reduce) ❗empty ·
    │   │   │   │            sum(fn=) · mean(fn=) · every(pred=) · some(pred=)
    │   │   │   ├─ Group → group_reduce(key, init, fold) · group_size(key) · group_sum(key, fn=) · group_mean(key, fn=) ·
    │   │   │   │            group_every/some(key, pred) · group_to_arrays/sets(key, value=) · group_to_dicts(key, key2, value=, combine=)
    │   │   │   ├─ Convert → to_array(key=) · to_set(fn) · to_dict(key, value, combine=) ❗dup w/o combine
    │   │   │   ├─ Flatten → flatten_to_array(fn, out=) (the TS Set name; only Array spells it flat_map) · flatten_to_set(fn, out=) ·
    │   │   │   │            flatten_to_dict(fn, combine=) ❗dup w/o combine
    │   │   │   └─ Mutate (in place) → add · insert ❗exists · try_insert(v)→bool · remove · delete ❗missing · try_delete(v)→bool · discard · clear · copy()
    │   │   ├─ Dict<K,V>  (callbacks, after the block, take the builtin's own TS order: fn(b, v) or fn(b, v, k) · a fold step is fn(b, acc, v[, k]))
    │   │   │   ├─ Access → d[k] · get(k) ❗missing · get(k, default) / get(k, fn(b, k)) (TS onMissing) · get_or_default(k, d) · try_get(k) ·
    │   │   │   │            has(k) · len()/size() · keys() → Set (TS; east-c DictKeys) · values()/items() (python views)
    │   │   │   ├─ Combine → union(other, combine=) ❗shared key w/o combine (pure) · union_in_place(other, combine=) ·
    │   │   │   │            merge(key, value, update_fn, initial_fn=) (ONE key, in place; TS `merge`) · get_keys(keys, fill)
    │   │   │   ├─ Per-entry → map(fn, out=) · filter(pred) · filter_map(fn, out=) · first_map(fn, out=) · for_each(fn)
    │   │   │   ├─ Reduce → reduce(fn, init) · scan(fn, init) (running fold → Array, key order) · map_reduce(map_fn, reduce_fn, out=) ❗empty ·
    │   │   │   │            sum(fn=) · mean(fn=) · every(pred=) · some(pred=)
    │   │   │   ├─ Group → group_reduce(key_fn, init_fn, fold_fn) · group_size(key_fn) · group_sum(key_fn, fn=) · group_mean(key_fn, fn=) ·
    │   │   │   │            group_every/some(key_fn, pred) · group_to_arrays/sets(key_fn, value_fn=) · group_to_dicts(key_fn, key2_fn, value_fn=, combine=)
    │   │   │   ├─ Flatten → flatten_to_array(fn, out=) (the TS Dict name) · flatten_to_set(fn, out=) · flatten_to_dict(fn, combine=) ❗dup w/o combine
    │   │   │   ├─ Convert → keys() · to_array(fn, out=) · to_set(fn, out=) · to_dict(key_fn, value_fn=, combine=)
    │   │   │   └─ Mutate (in place) → d[k]=v · insert ❗exists · get_or_insert(k, fn) · insert_or_update(k, v, combine) · update(k, v) ❗missing ·
    │   │   │                swap ❗missing · delete ❗missing / try_delete · pop · clear · merge_all(other, merge, default) ·
    │   │   │                (bulk) update_many(keys, values, combine=)
    │   │   ├─ Vector / Matrix → get/set(→new)/slice/concat · rows()/cols() · transpose/get_row/get_col · to_array/to_vector/to_matrix/to_rows ·
    │   │   │   │                 to_numpy(copy=False)/to_torch() · from_numpy/from_torch/zeros/ones/fill ·
    │   │   │   │                 Vector map(fn(b, el[, i])) · reduce(fn(b, acc, el[, i]), init) · Matrix map_rows(fn(b, row[, i]))
    │   │   │   ├─ Elementwise arithmetic (east-c; #598) → scale(α) · add_scaled(other, α) · mul(other) · add_scalar(c) · abs() · clamp(lo, hi) ·
    │   │   │   │            cum_sum() — Matrix: scale · add_scaled · mul_elementwise
    │   │   │   ├─ Reductions (strict left-to-right order, cross-runtime) → sum() · dot(other) · max/min() ❗empty · arg_max/arg_min() ❗empty ·
    │   │   │   │            mean()→Float · Matrix: row_sums() · col_sums() · vec_mul(v)
    │   │   │   ├─ Masks & selection → eq/lt/gt(other)→Vector<Boolean> · mask.select(a, b) · v.compress(mask) · mask.count_true() ·
    │   │   │   │            gather(idxs) · scatter_add(idxs, src) · search_sorted(needles)
    │   │   │   └─ Sparse accumulators (Struct{ix, v}; strictly ascending ix; every ix/v input takes a Vector OR an Array, #601) →
    │   │   │                East.Vector.sparse_axpy(ixA, vA, ixB, vB, α) (union merge, vA + α·vB) · East.Vector.sparse_from_pairs(ix, v)
    │   │   │                (sorts + sums duplicates, stable) · East.Vector.sparse_filter_gt(ix, v, threshold) · seed → arr.to_vector() ·
    │   │   │                East.Vector.zeros/ones(T, n) · East.Vector.fill(T, n, value)
    │   │   ├─ Struct        → s["field"] or s.field (methods shadow same-named fields) · items()/keys()/values()
    │   │   ├─ Variant       → .type/.get_tag() · .has_tag(tag) · .unwrap(tag="some", on_other=fn(b)) ❗ · .match({case: fn(b, x)}, default=fn(b)) ·
    │   │   │                  .match_tag(tag, fn, default)
    │   │   ├─ Ref           → get() · update(value) (TS; `set` deprecated) · merge(patch, combine(b, current, patch))
    │   │   └─ Blob          → size/get_uint8/.data · decode_utf8/utf16 · decode_beast(T, version="v1"|"v2") · encode_beast2/decode_beast2 ·
    │   │                      decode_csv(row_type, csv_parse_config(null_strings=…, defaults=…, …)) or decode_csv(row_type, null_strings=…)
    │   ├─ Diff / patch two values of one type (East's structural patch algebra; all four take T first)
    │   │   ├─ Compute a patch → East.diff(T, before, after)   (patch type is PatchType(T))
    │   │   ├─ Apply it → East.apply_patch(T, value, patch)
    │   │   ├─ Combine two patches → East.compose_patch(T, first, second)
    │   │   └─ Reverse one → East.invert_patch(T, patch)
    │   ├─ A scalar builtin (you can't method-call a float/int/str/bool/datetime)
    │   │   ├─ Numeric → East.Float.<op> / East.Integer.<op> · Text → East.String.<op> · Time → East.DateTime.<op> · Logic → East.Boolean.<op>
    │   │   ├─ Compare / order (East total order) → East.less / compare / equal / …(T, a, b) · East.min/max(a, b) · East.clamp(x, lo, hi)
    │   │   └─ The stdlib (branch A) on plain values → East.Integer.print_compact(1234567) → "1.23M" · East.Float.print_currency(x) · …
    │   ├─ Hand a buffer to numpy / torch → EastVector/EastMatrix .to_numpy()/.to_torch()
    │   │   (the East arithmetic surface above covers elementwise/reduction/sparse work with the cross-runtime order contract)
    │   ├─ A collection FILE that does not fit in memory (beast2 v5) — start MANAGED:
    │   │   ├─ Write → write_beast2_file(path, T, value)  (any size; re-batched into segments)
    │   │   │   ├─ streaming producer → open_beast2_file(path, T, mode="w") as w: w.write(batch)
    │   │   │   ├─ N CPUs on one table → write_beast2_file_parallel(path, T, partitions, produce)
    │   │   │   │   (build the expensive context BEFORE the call; forked children inherit it COW on Linux/macOS)
    │   │   │   └─ merge shard files yourself → splice_beast2_files(path, T, sources) — byte copy, no re-encode
    │   │   ├─ Read → open_beast2_file(path) as f — a first-class READ-ONLY East collection VALUE (a Beast2*File subclasses
    │   │   │   EastArray/EastDict/EastSet, #560): isinstance/type_of answer, mutation raises, and it feeds East functions directly
    │   │   │   (T optional: the header supplies it; declare T to VALIDATE it at open; don't know the type? → read_beast2_type(path)):
    │   │   │   ├─ whole table → f.load()      (decodes inside east-c; input memory = one segment)
    │   │   │   ├─ join against it from a body → East.function([RowT, TableT], T, …).bind(f) — keyed reads answer from the pager,
    │   │   │   │   ONE frame per hit/miss, nothing materialised (EAST_PAGED_CACHE_BYTES tunes the segment cache)
    │   │   │   ├─ Array point reads → f[i] · f.get/get_or_default/try_get/has · f.slice(a,b) · f.get_keys(rows)
    │   │   │   ├─ Dict keyed reads → f[k] ❗KeyError · f.get/get_or_default/try_get/has · k in f · f.get_keys(keys, fill)
    │   │   │   ├─ Set membership → x in f · f.has(x)
    │   │   │   ├─ Array sorted search → f.find_sorted_first/last/range(target) — GLOBAL insertion indices; no key= projection
    │   │   │   ├─ whole-file compute → the FULL eager read surface runs on f directly: map · filter · filter_map · first_map · reduce ·
    │   │   │   │   map_reduce · sum · mean · maximum · minimum · every · some · find_* · is_sorted · to_set/unique · to_dict · to_array ·
    │   │   │   │   to_columns · map_batches · string_join · flatten_* · the group_* family · Set algebra — segment folds, east-c per
    │   │   │   │   segment, results == f.load() exactly (f.segments() is a DEPRECATED alias, #560)
    │   │   │   └─ wide rows, few columns read → column projection (#599) is INFERRED from the callback's IR (each segment decodes to
    │   │   │       exactly the struct fields it reads); declare it instead → open_beast2_file(path, project=NARROW)
    │   │   └─ Buffer-level (you hold the bytes, not a path):
    │   │       ├─ Beast2Writer(T, stream) per-batch · encode_beast2_segments_for(T)(batches)
    │   │       ├─ for b in iter_beast2_segments_for(T)(source)  — O(segment); source: bytes/mmap/stream
    │   │       ├─ decode_beast2_with_header_for(T)(blob)  — whole, v4 AND v5
    │   │       ├─ open_beast2_pages_for(T)(source) — .element(n)/.segment(i), ONE segment each ❗borrows the buffer — keep it alive
    │   │       └─ read_beast2_index(T, blob) -> (segments, elements) — totals without decoding
    │   ├─ Logic genuinely needs python (numpy / a model / a solver) → to_columns()/EastArray.from_columns · map_batches ·
    │   │   EastDict.update_many(keys, values, combine) · extend — O(columns)/O(batches) crossings, not O(rows × fields)
    │   └─ Let East call your python function
    │       ├─ Concrete types → @East.platform_function(inputs=[…], output=…)  +  East.platform_functions(__name__)
    │       ├─ Type-parameterized → @East.generic_platform_function(type_parameters=[…], is_async=…)
    │       └─ Cache a pure, expensive one (dev/test) → @memoize above @East.platform_function; inert until configure_memo(dir) / EAST_MEMO_DIR
    │
    └─ C. CROSSING BETWEEN THEM
        ├─ A python value inside a body → parameters are expressions already · scalars/datetimes lift · East.value(v, T) / b.const(v) ·
        │   a closed-over East collection = build-time SNAPSHOT (an eager callback refuses it)
        ├─ A large side table inside a body → declare it as a trailing parameter + fn.bind(table) (by reference, live, zero-copy)
        ├─ An East function on values → f(values) runs natively · xs.map(f) (a VALUE takes no block) · compile_from_beast2/json/east
        ├─ A callback in an eager method → it IS a body (captured, compiled; a body East cannot express RAISES naming the binding)
        ├─ A dual-mode construct → East.if_else · East.while_/for_ · struct/variant/some/none · every East.<Type>.* function — eager on
        │   values, IR on expressions; one body serves both
        └─ See how a hot call ran → east.runtime.compiler.eager_stats() (function_direct · c_to_py_decodes · beast2_*)
```

## Type System Summary

Every East type has an expression class (what you hold inside a body — the TS
`IntegerExpr`/`ArrayExpr`/… twins, exported from `east.expression.expr`) and a python
value (what you hold outside). Scalars are plain Python objects, so their builtins live
on the `East.<Type>` namespaces; everything else is an `East*` container that carries its
element type and has real eager methods. Only `EastArray`/`EastSet`/`EastDict`/`EastRef`
mutate in place — `EastStruct`, `EastVariant`, `EastVector`, and `EastMatrix` are
immutable value types (`set` returns a new tensor).

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

`VectorType`/`MatrixType` element types are `FloatType`, `IntegerType`, or `BooleanType`;
the runtime backing numpy dtype may be narrower (e.g. f32), and the bridge canonicalizes
to East's storage width (Float→f64, Integer→i64, Boolean→u8) crossing into east-c.

## East expressions — writing East functions in Python

A python body becomes East IR by being CAPTURED: it runs ONCE against typed
expression proxies (exactly like the TypeScript `East.function` builder),
east-c compiles the recorded IR, and from then on only the compiled function
executes. There is no interpreter path behind it — a body East cannot express
raises at build time, so the same source always costs and means the same
thing.

### Declare, implement, build, compile — the four authoring calls

Four calls, the TypeScript names, name for name. Two are about **platform
functions** — python the East program calls out to — and are paired **by
name**; two are about **East functions**, the program itself:

| Step | Call | What it is |
|---|---|---|
| **Declare** a platform function's signature | `East.platform(name, inputs, output)` (`East.asyncPlatform`, `East.genericPlatform`) | a handle a body CALLS — it emits the `Platform` node; nothing runs here |
| **Implement** it in python | `@East.platform_function(inputs=…, output=…)` (`@East.generic_platform_function`; `East.platform_functions(__name__)` collects a module's) | the host side: a plain python function over East VALUES, its result validated against `output`; its name — the `def`'s, or `name=` — MUST equal the declaration's |
| **Build** an East function | `East.function(inputs, out, body)` / `@East.function(inputs, out)` (`East.asyncFunction`) | runs `body` once over expression proxies and records IR; a pure one is already callable |
| **Compile** with the implementations | `East.compile(fn, platform=[…])` (`East.compileAsync`) | analyzes the IR against the implementations — a declaration no implementation matches by name is `Platform function '<name>' not found` — and returns the native callable |

An `East.function` has no name of its own: it is a VALUE, called through the
binding that holds it (`score(x)`, `rows.map(score)`), stored in a struct or
an array, exported under its module-level name (`east_functions = {"score":
score}`) — its IR carries its parameters' names (#639), never its own,
exactly as in TypeScript. A platform function is the opposite: the name IS
the pairing, on every runtime.

```python
from east import East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType

Row = StructType([("sku", StringType), ("qty", IntegerType)])

# BUILD — `out` is REQUIRED and enforced; every body takes the block `b` first
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * 1.5)
score({"sku": "a", "qty": 2})            # 3.0 — a pure artifact is a callable on values

# DECLARE — the handle a body calls; its name pairs it with the implementation
log = East.platform("t.log", [StringType], NullType)
greet = East.function([StringType], NullType,
                      lambda b, name: log(East.String.concat("hello ", name)))
greet("bob")                             # EastError: Platform function 't.log' is not
                                         #   available — compile with East.compile(fn, platform=[...])

# IMPLEMENT — python over East values; `name=` because "t.log" is not an identifier
@East.platform_function(inputs=[StringType], output=NullType, name="t.log")
def log_line(line):
    print(line)

# COMPILE — pair the declaration with its implementation, by name
run = East.compile(greet, platform=East.platform_functions(__name__))
run("bob")                               # prints "hello bob"
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

total_decl = East.platform("total", [Rows], FloatType)      # what an East body calls
report = East.function([Rows], StringType,
                       lambda b, rows: East.str("total: ", East.Float.print_currency(total_decl(rows))))
East.compile(report, platform=East.platform_functions(__name__))(rows)   # "total: $9.00"
```

Each call in detail:

| Call | Builds | Notes |
|---|---|---|
| `East.function(param_types, out, body)` | a `Function` artifact | `param_types` is a LIST (`[]` for none); the body takes the block first — `lambda b, x: …` / `def f(b, x)`, as EVERY body does (`lambda x: …` is refused with the fix-it); `out` is required, and a body whose expression has another type raises naming both; with `body` omitted it is a DECORATOR |
| `East.asyncFunction(param_types, out, body)` | an `AsyncFunction` artifact | for bodies calling async platform declarations; compile with `East.compileAsync` |
| `East.platform(name, inputs, output, optional=False)` | a declaration handle | callable INSIDE a body (emits the `Platform` node); calling one outside raises `expression-level`; `East.genericPlatform(name, ["T"], inputs, output)` is the type-parameterised form |
| `East.asyncPlatform(name, inputs, output)` | an async declaration | calling it from a SYNC body is a build error naming `East.asyncFunction` |
| `East.compile(fn, platform=[])` / `East.compileAsync(...)` | a native callable | takes an artifact or a raw IR value; the IR is analyzed against `platform` first (`east.ir.analyze`, the TS `analyzeIR`): a signature mismatch or a missing implementation is an `EastError` naming the call — unless the declaration is `optional=True`, which compiles to a stub that raises at the call (TS parity) |

A **pure** artifact needs no compile step: it is already a native callable,
`.bind(*values)` pre-binds trailing parameters by reference (#399), and
referencing it inside another body splices its expression into that build
(#470/#561). A platform-declaring artifact stays first-class (composable,
serializable) but raises until `East.compile` pairs it with implementations.
`East.function(...)` spelled INSIDE a body is not an artifact but the inline
`Function` node as a Function-typed expression — bind it with `b.const`, hand
it to a callback slot, or call it (a `Call`; inside `East.asyncFunction`,
calling an async one is a `CallAsync`).

**Error locations (#626).** A build records the python frames that built
each node, so a runtime error inside the function names the authoring site:
`EastError.location` is the stack — the lambda's `file:line:column` first,
then the `East.function(...)` call and its callers — and a platform-signature
mismatch at `East.compile` names the offending call the same way. The map
rides the function's beast2 encoding, so the error reads the same after
export to east-c or east-node. Paths are relative to the working directory;
`set_location_base_path(dir)` (from `east`) pins the base for reproducible
fixtures. An error raised inside a callback that a *builtin* invokes
(`arr.map(...)` and friends) resolves to the builtin's call site, on every
runner.

### Every body takes the block first — the TypeScript `$` twin (#627)

A TypeScript body receives `$` and appends STATEMENTS to it. A python body
receives **`b`** — the block — as its FIRST parameter and does the same.
EVERY body does, always — an `East.function` body, a builtin's callback, a
branch, a loop, a handler — exactly as every TypeScript body is `($, …) =>
…`: a `lambda x: …` that leaves it out is refused with the fix-it, and a
body that uses the block as if it were the element fails on the block's
first use. Every branch, loop and handler body receives ITS OWN block
first, then what the construct hands it, so which block a statement belongs
to is always written down — and a statement on any other block is a
build-time error. Python `None` returned from a body is TypeScript's "no
return"; the `east_null` sentinel is an explicit `null`:

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
detected`, as in TypeScript; a statement on an OUTER block from inside a
nested body, or on a block whose body has returned, raises naming it (the
TypeScript `no-cross-block-builder` lint is a hard error here). Every other IR
node kind has a spelling too, so any program TypeScript can build, python can
build name for name: `East.value(v, T)` (a typed literal / struct / list /
dict), `East.as_(v, T)` (an explicit widening `As`), `East.wrap_recursive(v, R)`
and `expr.unwrap()` on a recursive-typed expression, `East.builtin(name, [T…],
[args], out)` (a raw builtin, for the few with no named spelling —
`east.codegen.RAW_ONLY`).

**The analyzer.** Every build (and every `East.compile`) runs
`east.ir.analyze.analyze_ir` — the python twin of TypeScript's `analyzeIR`:
scope, exact-type rules (a `Let`/`Assign`/argument/element/field must have
exactly its slot's type, subtyping spelled with `As`), divergence rules and
node well-formedness, with the TypeScript messages and the python
`file:line:column` of the node. A body that cannot pass it never compiles.

### The expression surface, type by type

One class per East type in `east.expression.expr`, each mirroring its
`libs/east/src/expr/<type>.ts` twin: the same methods under the snake_cased
name, the same builtin and argument order behind each one, and — where
TypeScript has alias spellings (`plus`/`minus`/…, `eq`/`equal`/`equals`) — the
same aliases. `tests/test_ts_name_parity.py` pins this against the TypeScript
sources: every TypeScript method exists here, on the expression class AND on
the eager value class (for a scalar, whose python value takes no methods, the
eager twin is the `East.<Type>` function of the same name, value first:
`d.add_days(n)` ↔ `East.DateTime.add_days(d, n)`), and every python-only
name is declared with its reason (a deprecated python-idiom alias, a python
protocol twin, or a convenience). Python differs from TypeScript in exactly the places
the language forces: operators where they agree (`+ - * / ** & | ^ ~`, the
comparisons), keyword-mangled `and_`/`or_`/`not_`, a trailing underscore on
`as_`, and keyword arguments (`out=`, `key=`, `combine=`) where TypeScript
overloads.

| Type | Operators | Methods (the TypeScript names) |
|---|---|---|
| **Boolean** | `&` `\|` `^` `~` — never `and`/`or`/`not`/`if` (python collapses them to `bool`) · `==` `!=` | `.bit_and(y) .bit_or(y) .bit_xor(y) .not_()` (the builtins — both operands evaluate) · `.and_(fn(b))` `.or_(fn(b))` (TS `and`/`or`: SHORT-CIRCUIT, the other operand is a body) · `.if_else(fn(b), fn(b))` (TS `ifElse`; `East.if_else(cond, value, …, otherwise)` is the value form — pairs then the else, one `IfElse` node) · `.equals/.equal/.eq` `.not_equals/.not_equal/.ne` |
| **Integer** | `+` `-` `*` and unary `-`; `==` `!=` `<` `<=` `>` `>=` (East total order) · ❗ `//` `%` `**` `/` RAISE at build time with the fix-it (#624): python floors/takes the divisor's sign/promotes a negative exponent where East truncates/takes the dividend's sign/yields 0 — spell `.divide(y)` / `East.Integer.divide`, `.remainder(y)` / `East.Integer.remainder`, `.pow(y)` / `East.Integer.pow`, `.to_float() / y` | `.add .subtract .multiply .divide .remainder .pow` (a Float argument widens `self`, like TS; aliases `.plus .sub .minus .mul .times .div .mod .rem .modulo`) · `.negate() .abs() .sign() .log(base)` · `.to_float()` · `.less_than/.less/.lt .greater_than/.greater/.gt .less_than_or_equal/.less_equal/.lte/.le .greater_than_or_equal/.greater_equal/.gte/.ge .equals/.equal/.eq .not_equals/.not_equal/.ne` |
| **Float** | `+` `-` `*` `/` `**` and unary `-`; comparisons · ❗ `//` `%` RAISE (`.remainder(y)` / `East.Float.remainder`) · `math.floor/ceil/trunc(x)` build the stdlib `East.Float.round_floor/round_ceil/round_trunc`; python `round(x)` raises (its tie rule differs — `East.Float.round_half(x)`) | the same named arithmetic and aliases (an Integer argument widens) · `.negate .abs .sign .sqrt .exp .log .sin .cos .tan` · `.to_integer()` ❗ errors at run time on a non-integral/NaN/infinite value · Float → Integer rounding is the stdlib `East.Float.round_floor/round_ceil/round_trunc/round_half(x)` (`round_half` = ties AWAY from zero; `.floor() .ceil() .trunc() .round()` are deprecated aliases) · comparisons as Integer |
| **String** | `+` (concat); comparisons | `.concat(s) .repeat(n) .substring(a, b) .upper_case() .lower_case() .trim() .trim_start() .trim_end()` · `.replace(old, new) .split(sep)` · `.length() .starts_with(p) .ends_with(s) .contains(s) .index_of(s)` · `.parse(T)` ❗ (strict whole-string) `.parse_json(T)` · `.try_parse(T) -> Option<T>` (none on any failure) · `.encode_utf8() .encode_utf16()` · `.regex_contains(pat, flags="") .regex_index_of(pat, flags="") .regex_replace(pat, repl, flags="")` (the builtins TypeScript has no method for) · never an f-string (it would constant-fold the proxy) — `East.str(…)` or `+` |
| **DateTime** | comparisons; a python `datetime` literal lifts as a DateTime | `.get_year() .get_month() .get_day_of_month() .get_day_of_week()` (Monday = 1) `.get_hour() .get_minute() .get_second() .get_millisecond()` · `.add_milliseconds(n) .add_seconds .add_minutes .add_hours .add_days .add_weeks` and `.subtract_milliseconds … .subtract_weeks` (an Integer or Float `n`) · `.duration_milliseconds(other) -> Integer`, `.duration_seconds/minutes/hours/days/weeks(other) -> Float` ❗ `a.duration_days(b)` is `b − a` (positive when `b` is later — the TS method; the namespace `East.DateTime.duration_milliseconds(a, b)` is the raw builtin, `a − b`) · `.to_epoch_milliseconds()` · `.print_formatted(fmt)` (Day.js tokens) |
| **Blob** | comparisons | `.size() .get_uint8(i)` · `.decode_utf8() .decode_utf16()` · `.decode_beast(T, version="v1")` (`"v2"` = the beast2 family) · `.decode_csv(RowT, config=None, **options)` |
| **Array** | `xs[i]` (a negative LITERAL index raises — spell `xs.get(xs.size() - 1)`); comparisons | Read `.size() .length() .has(i) .get(i[, on_missing(b, i)])` ❗bounds `.at(i) .try_get(i) .get_keys(idxs)` · Mutate (yield Null / Boolean, sequence with `East.block` or `b.do`) `.update(i, v) .push_last(v) .pop_last() .push_first(v) .pop_first() .append(array) .prepend(array) .merge(i, v, fn) .merge_all(array, fn) .clear() .sort_in_place(by=) .reverse_in_place()` · Transform `.copy() .slice(a, b) .concat(other) .sort(by=, reverse=) .reverse() .map(fn, out=) .filter(fn) .filter_map(fn, out=) .flat_map(fn, out=)` · Search `.find_first(target, key=) .find_all(v, by=) .first_map(fn, out=) .is_sorted(key=) .find_sorted_first/last/range(target, key=)` · Reduce `.reduce(fn(acc, el[, i]), init) .scan(fn, init) .every(pred=) .some(pred=) .sum(fn=) .mean(fn=) .maximum(by=) .minimum(by=)` ❗empty `.find_maximum(by=) .find_minimum(by=)` · Convert `.string_join(sep) .to_set(key=) .to_dict(key, value=, combine=) .flatten_to_set(fn) .flatten_to_dict(fn, combine=) .encode_csv(config=) .to_vector() .unique()` · Group `.group_by(key) .group_reduce(key, init, fold) .group_size(key=) .group_sum(key, fn=) .group_mean(key, fn=) .group_maximum/.group_minimum(key, by=) .group_to_arrays/.group_to_sets(key, value=) .group_to_dicts(key, key2, value=, combine=) .group_every/.group_some(key, pred) .group_find_all/.group_find_first(key, v, by=) .group_find_maximum/.group_find_minimum(key, by=)` · effect `.for_each(fn)` |
| **Set** | comparisons | Read `.size() .has(v)` · Mutate `.insert(v)` ❗exists `.try_insert(v)→Boolean .delete(v)` ❗absent `.try_delete(v)→Boolean .clear() .union_in_place(other)` · Set ops `.copy() .union(o) .intersection(o) .difference(o) .symmetric_difference(o) .is_subset_of(o) .is_superset_of(o) .is_disjoint_from(o)` · Transform `.filter(fn) .filter_map(fn, out=)→Dict .map(fn, out=)→Dict .for_each(fn) .first_map(fn, out=)` · Reduce `.reduce(fn(acc, el), init) .scan(fn, init) .every .some .sum .mean` · Convert `.to_array(fn=) .to_set(fn) .to_dict(key, value, combine=) .flatten_to_array(fn) .flatten_to_set(fn) .flatten_to_dict(fn, combine=)` (a Set spells it `flatten_to_array` in TypeScript — only an Array has `flat_map`) · Group `.group_reduce .group_size .group_sum .group_mean .group_to_arrays .group_to_sets .group_to_dicts .group_every .group_some` |
| **Dict** | `d[k]` ❗missing; comparisons · every callback is **`(value, key)`** — `fn(b, v)` or `fn(b, v, k)`; a fold step `fn(b, acc, v[, k])`; a collision handler `combine(b, existing, incoming[, key])` | Read `.size() .has(k) .get(k[, on_missing(b, k)])` ❗missing `.get_or_default(k, d) .try_get(k) .keys()→Set .get_keys(keys, fill)` · Mutate `.insert(k, v)` ❗exists `.insert_or_update(k, v, combine) .update(k, v)` ❗missing `.merge(k, v, update_fn, initial_fn=) .get_or_insert(k, fn) .delete(k)` ❗ `.try_delete(k)→Boolean .pop(k) .swap(k, v) .clear() .union_in_place(o, combine) .merge_all(o, update, init)` · Transform `.copy() .union(o, combine=) .map(fn, out=) .filter(fn) .filter_map(fn, out=) .for_each(fn) .first_map(fn, out=)` · Reduce `.reduce(fn, init) .scan(fn, init) .every .some .sum .mean` · Convert `.to_array(fn, out=) .to_set(fn, out=) .to_dict(key, value=, combine=) .flatten_to_array(fn) .flatten_to_set(fn) .flatten_to_dict(fn, combine=)` · Group `.group_reduce .group_size .group_sum .group_mean .group_to_arrays .group_to_sets .group_to_dicts .group_every .group_some` |
| **Vector** | comparisons | Read `.length() .get(i)` ❗bounds · `.set(i, v)` (a NEW vector) · Transform `.slice(a, b) .concat(o) .map(fn(el[, i]), out=) .reduce(fn(acc, el[, i]), init)` · Arithmetic (Float/Integer) `.scale(α) .add_scaled(o, α) .mul(o) .add_scalar(c) .abs() .clamp(lo, hi) .cum_sum()` · Reduce (strict left-to-right) `.sum() .dot(o) .max() .min() .arg_max() .arg_min() .mean()` ❗ empty: `sum()==0`, the rest raise · Masks `.eq(o) .lt(o) .gt(o)` → `Vector<Boolean>`, `mask.select(a, b)`, `data.compress(mask)`, `mask.count_true()` · `.gather(idxs) .scatter_add(idxs, src) .search_sorted(needles)` · Convert `.to_array() .to_matrix(rows, cols)` |
| **Matrix** | comparisons | `.rows() .cols() .get(r, c) .get_row(r) .get_col(c)` ❗bounds · `.set(r, c, v)` (a NEW matrix) · `.transpose()` · `.scale(α) .add_scaled(o, α) .mul_elementwise(o)` · `.row_sums() .col_sums() .vec_mul(v)` ❗ cols ≠ `v.length()` · `.to_vector() .to_array() .to_rows()` · `.map_rows(fn(row[, i]))` |
| **Struct** | `r.field` / `r["field"]` (both build IR, both work on real rows) | build a row with a dict literal `{"k": expr, …}` or `struct({…}, T)` (dual-mode) |
| **Variant** | — | `.match({case: fn(b, payload)}, default=fn(b))` (TS's partial match; the arms must agree on one East type — a `some(x)` arm types its `none` sibling) · `.match_tag(tag, fn, default)` · `.unwrap(tag="some", on_other=None)` ❗ · `.has_tag(tag) .get_tag()` · Option: `.is_some() .is_none() .unwrap_or(d)` · build with `some(expr)` / `none` / `variant(case, payload)`, typed from context (the build's declared output, a typed `if_else` sibling, a declared struct field, or an `out=` pin) |
| **Ref** | — | `East.ref(v)` builds one · `.get()` · `.update(v)` (TS `RefUpdate`; `.set` and the read-modify-write `update(fn)` are deprecated — write `r.update(f(r.get()))`) · `.merge(v, fn(b, current, patch))` |
| **Function** | `f(x, …)` — a `Call` node (a `CallAsync` inside an async body) | a Function-typed parameter or a `b.const(East.function(…))` is callable in the body; `FunctionType` parameters bind with `.bind(fn_value)` |

The expression methods accept the eager keywords — `out=` (`map`, `filter_map`,
`map_reduce`, `flat_map`, `flatten_to_set`, `to_array`, `to_set`), `key_out=`/
`value_out=` (`to_dict`), `key_out=`/`acc_out=` (`group_reduce`), `pred=`, `key=`,
`value_fn=` — and an `out=`-family pin also TYPES the callback's build, so a
pinned callback can build a general variant without any other context. Result
types come from the build, never from a data sample, so `out=` is optional
everywhere and an EMPTY collection derives exactly what a full one derives.
`some`/`every`/`first_map` compile to the native short-circuiting FirstMap
scans (`some([])` is False, `every([])` True). An unsupported method raises
`ExpressionError` NAMING the supported set.

### The standard library — the TypeScript `East.<Type>.*` functions

Every namespace carries the East standard library — the TypeScript
`libs/east/src/expr/libs/*.ts` functions, body for body, under their names
snake_cased (`printCompact` → `print_compact`; the TS misspelling
`printCommaSeperated` is kept as `print_comma_seperated`, with
`print_comma_separated` as a python twin). Every stdlib function is an
`East.function` built on first use: called on plain values it runs natively,
referenced inside a body it splices in like any artifact:

```python
@East.function([IntegerType, FloatType, DateTimeType], StringType)
def label(b, n, x, d):
    return East.str(East.Integer.print_compact(n), " / ",          # "1.23M"
                    East.Float.print_currency(x), " @ ",           # "$1,234.57"
                    East.DateTime.print_formatted(East.DateTime.round_down_hour(d, 6), "HH:mm"))
```

The outputs are the TypeScript outputs exactly — a Float prints with its
point (`East.Float.print_percentage(1.0, 0)` is `"100.0%"`), the Integer
compact forms carry two decimals below ten units (`print_compact(1500)` is
`"1.50K"`), and `round_nearest`'s Integer half-step truncates
(`round_nearest(17, 5)` is `20`). The full tables are under
[East.<Type> namespaces](#easttype-namespaces--the-builtins-and-the-standard-library).

| Namespace | Functions |
|---|---|
| `East.Integer` | `print_comma_seperated(x)` `print_currency(x)` `print_compact(x)` (K/M/B/T/Q) `print_compact_si(x)` (k/M/G/T/P) `print_compact_computing(x)` (base 1024) `print_ordinal(x)` `print_percentage(x)` `digit_count(x)` `round_nearest/round_up/round_down/round_truncate(x, step)` |
| `East.Float` | `approx_equal(x, y, eps)` `round_floor/round_ceil/round_half/round_trunc(x)→int` `round_nearest/round_up/round_down/round_truncate(x, step)` `round_to_decimals(x, n)` `print_fixed(x, n)` `print_comma_seperated(x, n)` `print_currency(x)` `print_compact(x)` `print_percentage(x, n)` (NaN/±Infinity raise `Cannot round/format …`) |
| `East.DateTime` | `from_components(year, month=1, …)` `from_epoch_milliseconds(ms)` `parse_formatted(s, fmt)` `round_down_/round_up_/round_nearest_{millisecond,second,minute,hour,day,week}(dt, step)` `round_down_month(dt, step)` `round_down_year(dt, step)` |
| `East.String` | `print_json(value)` (or `print_json(T, value)`) `print_error(message, stack)` |
| `East.Blob` | `encode_beast(value, version="v1", typ=None)` |
| `East.Array` / `East.Set` / `East.Dict` | `range(start, end, step=1)` `linspace(a, b, n)` `generate(size, T, fn)` · `generate(size, K, fn, on_conflict=None)` · `generate(size, K, V, key_fn, value_fn, on_conflict=None)` — the TypeScript argument order; a key generated twice is a runtime error `Duplicate key <k> in set/dict` without a handler |
| `East.Vector` / `East.Matrix` | `zeros ones fill from_array sparse_axpy sparse_from_pairs sparse_filter_gt` · `zeros ones fill from_array from_rows` |
| `East` root | `East.str(*parts)` (TS `East.str`\`…\` — the parts concatenated, non-String parts printed) · `East.print(value[, T])` (East text under the value's own type) · `East.min(a, b)` `East.max(a, b)` `East.clamp(x, lo, hi)` (`greatest`/`least` under East's total order) · `East.equal/not_equal/less/less_equal/greater/greater_equal/compare(T, a, b)` · `East.value(v, T)` `East.as_(v, T)` `East.error(msg)` |

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

- Its own parameters, plain scalar constants (closure
  floats/ints/strings/datetimes bake in — the same value per element either
  way), East types/values (`east_null` included), the `East` builtin
  namespace, `East.if_else`, the `struct`/`variant`/`some`/`none`
  constructors (dual-mode: they build IR when handed expression fields),
  **East.function artifacts** (dual-mode: they re-run their source at any
  nesting depth, #470), **compiled East function values** (`.bind` results,
  `compile_from_*` functions — a CALL on one lowers to a native IR Call,
  #561), and — two wrapper levels deep, enough for helper lambdas that
  compose a callback — other python functions that pass the same rules.
- Anything else RAISES an `ExpressionError` **naming the binding**: a module
  reference (`random.…`, `np.…`), a python builtin (`len`, `str`), a mutable
  python capture, closure mutation (`nonlocal x; x += 1`). A closed-over
  East *collection* raises in an eager callback too — a capture snapshots,
  `.bind` stays live, and which one you meant must be your choice, not the
  library's: use an explicit `East.function` to snapshot a side-table or
  `.bind(table)` to keep it live. For genuine python semantics write an
  explicit `for` loop. Side effects therefore never get lost or silently
  doubled: the body runs once, at build time, or not at all.
- Arithmetic follows East types exactly: no implicit Integer↔Float mixing
  (`.to_float()` / `.to_integer()` convert) and `/` is Float division.
- Captures are CACHED (#422): an eager callback whose code object, captured
  bindings and declared signature match a previous call reuses the compiled
  function — so the per-group aggregate shape,
  `group_to_arrays(key).to_array(lambda b, es, k: {…aggregates over es…})`,
  builds each inner lambda once, not once per group (this exact shape
  measured 145 s of pure re-building before the cache). ⚠️ A lambda whose
  CAPTURES change per call (`lambda b, r: r.v > g` inside a loop over `g`)
  re-builds every time, because each capture value bakes into a different
  function — hoist an `East.function(...)` and pass the varying value as a
  bound parameter instead.

### Performance — the levers, ranked

The whole point of the machinery is that **data stays in east-c and python
never runs per element**. In order of impact:

1. **Keep values East end-to-end.** `EastArray`/`EastSet`/`EastDict` are
   C-backed; every eager method (`map`/`filter`/`group_by`/`sort`/set
   algebra/dict merge/…) runs the loop natively regardless of how deeply
   nested the element type is — nesting costs nothing extra because the
   structure never round-trips through python. The moment you call
   `list(...)`/`dict(...)` or iterate in python you pay a per-element
   boxing crossing — convert at most once, at the very end.
2. **Let the callbacks build**, and chain on the results —
   a chain of `map`/`filter`/`reduce` stays native between steps.
   Return a dict literal (`lambda b, r: {"a": …, "b": …}`) to compute every
   derived column in ONE pass instead of one `map` per column. **Reuse a
   python variable to share work** (build-time CSE): assigning
   `fields = r.data.split("|")` and reading `fields` for 30 columns
   compiles to ONE `Let` — the split runs once per row, not 30×
   (~2.5× on that shape). Sharing the *variable* is what dedupes;
   re-calling `.split()` per column re-emits the split. Loop-invariant
   subexpressions hoist out of nested lambdas to the function body the same
   way — including a derived value read only ONCE inside a callback
   (#602), so `table = derive(rec)` before a `.map` runs once, not per
   element. `East.function(..., cse=False)` switches the pass off and builds
   exactly the IR the body spells — what the transpiler emits.
3. **Side tables: capture small ones, `bind` big ones.** Two spellings with
   opposite contracts — never conflate them:

   - **Closure capture (snapshot).** An East collection captured by an
     `East.function` body is snapshot into its IR: hoisted and
     identity-deduped so it builds **once per compiled function** and every
     per-element lookup runs in C — ideal for lookup tables up to ~10⁴–10⁵
     entries. The snapshot's build cost and memory ride the function (a
     1M-entry dict costs ~10 s to snapshot), and later mutations are **not**
     seen. (Only an EXPLICIT build snapshots: an eager method's callback
     refuses a mutable collection capture rather than pick for you.)
   - **`East.function(...).bind(table)` (by reference, live).** Declare the
     table as a trailing parameter and pre-bind it: C-level partial application
     retains the value's live pointer — **zero copy, O(1) bind at any size**
     (1M entries: ~0.1 ms), per-row cost matches the hoisted case, and the
     function **observes later mutations** (the explicit opt-in to live
     semantics). Rebinding gives independent callables; the unbound function
     stays usable; binding a wrong-typed value raises `TypeError`.

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

   Function *parameters* always cross the bridge **by reference** (zero copy,
   any size, any nesting depth) — `bind` is what lets eager methods use a
   parameter-taking function where the callback signature is fixed.

4. **Hoist `East.function(...)` out of python loops** and reuse it —
   re-building is cheap but not free; the artifact is a plain callable and
   every eager method accepts it.
5. **When logic must stay python, go columnar** (the values section): one
   boundary crossing per column/batch instead of per row × field, then
   come back to East values with `from_columns`/`extend`.
6. **See how a hot call ran** with
   `east.runtime.compiler.eager_stats()` — `function_direct` counts callbacks
   that rode a precompiled function value straight in, `c_to_py_decodes`
   counts values boxed C→python (an eager method quietly decoding a whole
   collection shows up here), and the `beast2_*` counters report column
   projection. There is no per-element python counter because there is no
   per-element python path: an eager callback builds or it raises.

### IR ↔ python: `east-py transpile` and the `east-c ir` toolbox (#627)

Any East IR — an `East.function` artifact, or a `.json` / `.beast2` export
from TypeScript, east-c or east-node — prints as an idiomatic python module
that REBUILDS it through the surface above:

```python
from east.codegen import to_python_source
print(to_python_source(classify))        # `@East.function(..., cse=False)` / `def main(b, …)`
```

```bash
east-py transpile program.json -o program.py --name main   # the same, from a file
east-c ir normalize program.json -o canonical.json         # the canonical form
east-c ir diff a.json b.beast2                             # first difference, or "identical"
east-c ir convert program.json -o program.beast2           # json <-> beast2, source map intact
```

The contract, pinned by `tests/conformance` over the whole compliance corpus
and every exported `*.examples.ts` example: `build(print(IR))` equals `IR`
under `east-c ir normalize` (loc_ids stripped, variables and labels renamed
in the TypeScript lowering's order, captures recomputed, recursive type ids
renumbered — the one normalizer, in libeast-c, reached from python as
`east.runtime._compiler_eastc.normalize_ir` / `diff_ir`). The TypeScript
printer is its twin (`East.toSource`, `east-node transpile`), and the
three-way sweep pins the pair: IR → python → IR → TypeScript → IR, every
leg equal, over the same corpus (`docs/conventions/EAST_CODEGEN.md`). Builtins print
through the spelling table `east.codegen.spellings` (operators only where the
exactness table permits — `+ - *` on numbers, `/` on Floats, comparisons,
`& | ^ ~` on Booleans, `+` on Strings; named `East.<Type>.*` / method
spellings elsewhere; `East.builtin(...)` for `RAW_ONLY`), and the eager
compliance replay derives its rows from the same table. A function referenced
as a VALUE in the IR (`$.let(East.DateTime.roundDownWeek)`) prints as the
inline `@East.function` it is — the IR carries the body, not the name.

### Diagnostics at edit time — `east-py lint`, flake8, `east-py lsp` (#638)

Everything the strict surface refuses at build time — a body without the
block, `//` on an expression, an f-string over one, `if` on one, a callback
reaching for `np` — is also a **rule**: `east.diagnostics` reads a file's
`ast`, finds the East bodies (an `East.function` body and everything nested
in it; an eager callback on an East value; a `@East.platform_function`'s East
inputs), and says at edit time what the build would say — **one message, two
moments**: every rule's text IS the refusal the build raises for the same
code, pinned by building the very source the rules read
(`tests/diagnostics`). Three surfaces, one engine; the python twin of
`@elaraai/east-diagnostics`:

```bash
east-py lint src/                         # file:line:col: category [rule] message — exit 1 on any finding
east-py lint src/ --format json           # the findings as records
east-py lint src/ --disable no-deprecated-alias --exclude fixtures
east-py lint --list-rules                 # EAS001 … EAS009
flake8 --select EAS src/                  # the same rules inside flake8 (east-py-cli registers the plugin)
east-py lsp                               # a Language Server over stdio — pip install 'east-py-cli[lsp]'
```

| Rule | Flags | What the build says |
|---|---|---|
| `body-takes-block-first` (EAS001) | `lambda x: …`, a body whose parameter count is not the declared count plus the block, `b.price`, `x + b` | `a body takes the block first` |
| `no-operator-fork` (EAS002) | `//` `%` `**` on an expression, `xs[-1]` | the #624 texts — `East.Integer.divide` / `remainder` / `pow`, `xs.get(xs.size() - 1)` |
| `no-python-formatting` (EAS003) | `f"{x}"`, `str(x)`, `print(x)`, `format(x)`, `"{}".format(x)`, `"%d" % x` | `f-strings / str() cannot be traced … East.String.print(T, value)` |
| `no-python-boolean` (EAS004) | `if`/`while`/`assert`/`and`/`or`/`not`/`x if c else y` on an expression, `in`, `for … in xs`, `len`/`int`/`float`/`bool`/`sum`/`sorted`/`max`… over one | `python \`if/and/or/not\` cannot be traced …` (`iteration`, `len()`, …) |
| `no-python-round` (EAS005) | `round(x)` on a Float expression | `East.Float.round_half(x) rounds half away from zero …` |
| `no-python-work` (EAS006) | an EAGER callback loading a module (`np`, `math`), a python builtin the capture does not admit (all but `abs`/`bool`/`isinstance`), a name imported from the standard library or an installed package that has no East form (`from math import floor`; a constant like `pi` lifts), a mutable East collection, or a `def` doing any of those (a clean macro `def` is fine) | `the callback cannot be captured automatically: it references np …` |
| `no-statement-on-outer-block` (EAS007) | `b.if_(p, lambda _b: b.assign(…))` — a statement on an enclosing body's block | `b.assign() was called on an OUTER block …` |
| `no-deprecated-alias` (EAS008, warning) | `.fold`, `.lower`, `East.Boolean.and_`, … (read off the surface's own deprecation docstrings) | `.fold() is deprecated: the spelling is .reduce() (the TypeScript name)` |
| `no-discarded-expression` (EAS009) | a bare `acc.push_last(x)` / `East.error(…)` / `xs.size()` line in a body | `.push_last() was evaluated and thrown away … b.do(…)` |

A file that does not import `east` is never diagnosed; a line ending in
`# noqa` (or `# noqa: EAS002` / `# noqa: no-operator-fork`) is skipped;
`.venv`, `node_modules`, `build`, `tests` are not walked. The rules are
syntactic (which names hold expressions, what python does to them) — the
build's type checking is not repeated, so a clean lint is necessary, not
sufficient, and `make lint` runs it over every east-py package's own East
bodies.

### Cross-language functions: `east-py export-functions` and `East.import_function` (#628)

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
east_functions = {"score": score}          # name -> East.function artifact (closed values only:
                                           # no captures, no .bind results, no unresolved imports)
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

Unlinked, the reference is a `Platform` node named `east.importFunction` —
compiling it raises naming that platform. `East.export_functions(pkg,
version, {…}, providers)` / `encode_function_manifest` are the API behind
the CLI; the TypeScript names are the same in camelCase. Contract and
runner rules: `docs/conventions/EAST_CODEGEN.md` §6.

## East values — the eager runtime

### Work in East values — don't round-trip through Python

Inside a `@East.platform_function` (or any east-py code over runtime data), **do the
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
  `East.DateTime.*` for date/time (UTC; `print_formatted`/`parse_formatted` Day.js
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
particular, prefer the declarative reducers (`reduce`/`map_reduce`/`group_reduce`/
`to_dict(..., combine=…)`) over *any* hand-rolled accumulation loop: the reducer
makes **one** native call that iterates and accumulates in C, whereas a manual
loop — Python **or** repeated `EastRef`/`EastDict` updates — pays a separate FFI
crossing per element (no faster than pure Python, usually slower). Reach for a
Python/numpy intermediate only when the work genuinely isn't East-expressible (a
real numpy/scipy/torch/solver op) — cross via `to_numpy()`/`to_torch()`
(zero-copy for tensors) and wrap the result back. Bare scalars stay plain Python
— an East `Float` *is* a `float`; don't wrap a running sum in an `EastRef`.

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
`xs.map(f)` on an `EastArray` invokes `ArrayMap` in east-c now, where the same call
on an `ArrayExpression` records the `ArrayMap` node. The callback is the same
thing on both: a body. Every eager callback method takes exactly two kinds of
function:

1. **A python body — captured automatically.** The method builds it as an
   `East.function` body — the block first, then the builtin's callback
   arguments (`lambda b, el: …`; trailing arguments may be omitted, the
   block cannot) — against the builtin's declared signature. The whole
   expression surface above is available in it; east-c compiles it, and the
   loop AND the body execute natively, zero python per element (~5× the old
   per-element callback on a 300k-row map, and it composes with chaining).
   Every transform is pure, so a whole `record → legs → values` descent — or
   a `group_by` + `to_dict(combine=)` + `sort` aggregate — is ONE compiled
   function with no materialised intermediate between stages:

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

2. **A precompiled East function** — `East.function(param_types, out, fn)`
   builds now and returns a reusable compiled callable (hoist compilation
   out of a loop, or share one body across call sites). A precompiled
   function — including a `.bind(...)` result — passes its native function
   value **straight through every eager method** (#409): the loop runs
   entirely in east-c with zero per-element python, and the output type
   comes from its own signature, so no `out=` and no sampling. If you DO
   pass `out=` (or the method has a declared type) and the signature
   contradicts it, the call raises `EastTypeError` immediately (#467).
   Artifacts are also **dual-mode** (#470): called with plain values they
   execute natively; referenced inside another body they re-run their
   source and splice into that build — so they compose
   (`East.function([Row], FloatType, lambda b, r: amount(r) * 1.1)`). A
   `.bind(...)` result (or any compiled function value) cannot re-run its
   body — instead a body that CALLS one lowers the call to the IR
   `Call` node (#561): the callee rides as a hidden bound parameter and the
   loop, the body and the callee all execute inside east-c. `FunctionType`
   PARAMETERS are first-class — callable in the body and bindable with
   function values (calling an `AsyncFunctionType` value in a sync body
   raises a named `ExpressionError`). Compiled East functions loaded from
   elsewhere (`compile_from_beast2/json/east`, or `compile_from_value` for a
   homoiconic IR value built with `east.ir.builders`) are accepted the same
   way:

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
   rows.map(conv.bind(table))   # bind a live side-table BY REFERENCE (#399)
   ```

Anything else in a callback slot RAISES — there is no third kind. The
callback-free ops (`sort`, `unique`, `union`/`intersection`/`difference`,
`concat`, `group_by`, `to_dict`/`to_set`, `find_sorted_*`) always run the
whole loop in east-c. The eager compliance replay (`tests/test_compliance_eager.py`)
runs the whole TypeScript compliance corpus a second time through these eager
methods, builtin by builtin, and requires the same answers the compiled programs
give — the two entry points agree over every builtin in the corpus.

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
| Convert | `string_join(sep) -> str` (String arrays) · `to_vector() -> EastVector` (Float/Integer/Boolean elements, in order — east-c VectorFromArray; the expression method emits the same builtin, #601) · `encode_csv(config=None, **options) -> EastBlob` (Array of structs; east-c ArrayEncodeCsv) |
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
| Per-element | `map(fn(el)) -> Dict` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None) -> Dict` · `first_map(fn(el)->some/none, out=None)` · `to_set(fn(el), out=None)` · `to_array(key=None)` · `to_dict(key(el), value(el), combine=None)` (duplicate key errors without `combine`) · `for_each(fn(el)) -> None` |
| Reduce | `reduce(fn(acc, el), init)` (TS order) · `scan(fn(acc, el), init) -> Array` (running fold in East order) · `map_reduce(fn(el), reduce(a,b))` (raises on empty) · `sum(fn=None)` · `mean(fn=None) -> float` · `every(pred=None)` · `some(pred=None)` (native short-circuit) |
| Group | `group_reduce(key(el), initial(gk), fold(acc, el)) -> Dict` · `group_size(key)` · `group_sum(key, fn=None)` · `group_mean(key, fn=None)` · `group_every/group_some(key, pred)` · `group_to_arrays/group_to_sets(key, value=None)` · `group_to_dicts(key, key2, value=None, combine=None)` · ⚠️ `group_fold(...)` is the DEPRECATED alias of `group_reduce` (#535) |
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
mismatch is refused, #529); `merge_all` needs only the same KEYS and is generic
in `other`'s values; `merge` takes a single differently-typed value.

| Group | Methods |
|-------|---------|
| Access | `d[k]` · `k in d` · `has(k)` · `len(d)`/`size()` · `get(k)` ❗missing · `get(k, default)` (a value) / `get(k, fn(k))` (TS `onMissing`) · `get_or_default(k, default)` · `try_get(k) -> some/none` · `keys() -> Set` (TS; east-c DictKeys — `keys_set` deprecated) · `values()`/`items()` (python views) |
| Combine | `union(other, combine=None) -> Dict` (NEW dict, both inputs untouched; a shared key errors without `combine`) · `union_in_place(other, combine=None) -> None` · `merge_all(other, merge(existing, incoming[, key]), default(key)) -> None` (fold `other` into self in place; `default` seeds absent keys; **generic in `other`'s value type** — only the KEYS must match) · `merge(key, value, update_fn(existing, incoming[, key]), initial_fn=None) -> None` (ONE key, in place; `value` may be a different type — TS `merge`; `merge_key` deprecated) · `get_keys(keys: Set, fill(k)) -> Dict` |
| Per-entry | `map(fn(value[, key]), out=None)` · `filter(pred(value[, key]))` · `filter_map(fn(value[, key])->some/none, out=None)` · `first_map(fn(value[, key])->some/none, out=None)` · `for_each(fn(value[, key])) -> None` |
| Reduce | `reduce(fn(acc, value[, key]), init)` (TS order) · `scan(fn(acc, value[, key]), init) -> Array` (running fold in key order) · `map_reduce(map_fn(value[, key]), reduce_fn(a, b), out=None)` (raises on empty) · `sum(fn(value[, key])=None)` · `mean(fn(value[, key])=None) -> float` · `every(pred(value[, key])=None) -> bool` · `some(pred(value[, key])=None) -> bool` (native short-circuit) |
| Group | `group_reduce(key_fn(value[, key]), init_fn(gk), fold_fn(acc, value[, key]), key_out=None, acc_out=None) -> Dict` · `group_size(key_fn)` · `group_sum(key_fn, fn=None)` · `group_mean(key_fn, fn=None)` · `group_every/group_some(key_fn, pred(value[, key]))` · `group_to_arrays/group_to_sets(key_fn, value_fn=None)` · `group_to_dicts(key_fn, key2_fn, value_fn=None, combine=None)` · ⚠️ `group_fold(...)` is the DEPRECATED alias of `group_reduce` (#535) |
| Flatten | `flatten_to_array(fn(value[, key])->arr, out=None)` (the TS Dict name; `flat_map` is Array's and a deprecated spelling here) · `flatten_to_set(fn(value[, key])->set, out=None)` · `flatten_to_dict(fn(value[, key])->dict, combine=None)` (a duplicate key errors without `combine`) |
| Convert | `keys() -> Set` · `to_array(fn(value[, key]), out=None)` · `to_set(fn(value[, key]), out=None)` · `to_dict(key_fn, value_fn=None, combine=None, key_out=None, value_out=None)` (the value itself when `value_fn` is omitted; a duplicate key errors without `combine`) · `copy()` |
| Mutate (in place) | `d[k]=v` · `del d[k]` · `insert(k, v)` (errors if present) · `get_or_insert(k, fn(k))` · `insert_or_update(k, v, combine(existing, incoming, k))` · `update(k, v)` (TS; the read-modify-write `update(k, fn(current))` is deprecated) · `swap(k, v) -> prev` · `delete(k)` · `try_delete(k) -> bool` (`update`/`swap`/`delete` error on a missing key) · `pop(k, *default)` · `clear()` |
| Bulk (in place) | `update_many(keys, values, combine(existing, incoming)=None)` — the whole batch crosses once; a pure/precompiled `combine` resolves collisions C-to-C (dicts as hot-loop accumulators) |

### EastVector — complete method surface

Immutable 1-D numeric value — logical element type `Float`/`Integer`/`Boolean`, backed by a
contiguous NumPy buffer for zero-copy ML interop. The logical `.element_type` is fixed; the storage
`.dtype` may be any compatible width (e.g. f32). The **arithmetic surface delegates to the east-c
builtins** (#598): reductions fold in strict left-to-right index order and comparisons use East's
total order (NaN greatest, `-0.0 < 0.0`) — bit-identical across the TS, C and Python runtimes,
which numpy's reassociating reductions are not. Free-form math beyond it goes via
`to_numpy()`/`to_torch()`. **Immutable:** `set`/transform return a NEW vector; the original is
unchanged. **Not hashable**, but valid as an East Set/Dict key (ordered by value). Construct via
the `EastVector.*` classmethods (see [Container generators](#container-generators-classmethods));
`from_numpy`/`from_torch` infer `element_type` from the array dtype when omitted. Structural access
methods called with an **expression** argument (inside a body) lift the vector as a
constant and emit IR, like the eager collections.

| Group | Methods |
|-------|---------|
| Access | `get(i)` ❗bounds (promoted Python scalar) · `length() -> int` · `slice(start, end) -> EastVector` (half-open, contiguous copy) |
| Transform (returns new) | `set(i, v) -> EastVector` ❗bounds (original unchanged) · `concat(other) -> EastVector` (takes this vector's element type) |
| Arithmetic (east-c; Float/Integer elements) | `scale(alpha)` · `add_scaled(other, alpha)` (`self + alpha*other`) ❗len · `mul(other)` ❗len · `add_scalar(c)` · `abs()` · `clamp(lo, hi)` (East order) · `cum_sum()` (running sum, left to right) |
| Reduce (east-c; strict left-to-right order) | `sum()` (0 when empty) · `dot(other)` ❗len · `max()`/`min()` ❗empty (TS names; `maximum`/`minimum` deprecated) · `arg_max()`/`arg_min()` ❗empty (ties keep the first index; NaN is greatest) · `mean() -> float` (Integer widens per element; NaN when empty) |
| Masks & selection (east-c) | `eq(other)`/`lt(other)`/`gt(other)` ❗len `-> Vector<Boolean>` (East equality/order) · `mask.select(a, b)` ❗len (mask receiver) · `v.compress(mask)` ❗len · `mask.count_true() -> int` |
| Gather / scatter / search (east-c) | `gather(indices)` ❗bounds · `scatter_add(indices, src)` ❗len/bounds (duplicates accumulate in order) · `search_sorted(needles) -> Vector<Integer>` (leftmost insertion index; assumes sorted) |
| Sparse accumulators (east-c; `East.Vector.*`) | `sparse_axpy(ixA, vA, ixB, vB, alpha)` (union merge `vA + alpha*vB`; absent entries stay absent) ❗ascending/len · `sparse_from_pairs(ix, v)` (sorts + sums duplicates stably, in input order) ❗len · `sparse_filter_gt(ix, v, threshold)` ❗ascending/len — all return `Struct{ix: Vector<Integer>, v: Vector<T>}` with strictly ascending `ix`; every `ix`/`v` input takes a Vector OR an Array (#601) |
| Per-element (east-c; the native callback builtins) | `map(fn(el[, i]), out=None) -> EastVector` (VectorMap; Float/Integer/Boolean results) · `reduce(fn(acc, el[, i]), init)` (VectorFold, index order; `fold(init, fn)` is the deprecated spelling) — a body like every other callback, zero python per element |
| Convert | `to_array() -> EastArray` (promotes scalars; severs the zero-copy link) · `to_matrix(rows, cols) -> EastMatrix` (row-major reshape; `rows*cols == length`) |
| NumPy / torch | `to_numpy(dtype=None, copy=False) -> ndarray` (read-only view by default; a cast or `copy=True` is writeable) · `to_torch(dtype=None) -> torch.Tensor` (always a writeable copy) · `np.asarray(v)` via `__array__` · props `.dtype` (storage) / `.element_type` (logical) |

### EastMatrix — complete method surface

Immutable 2-D row-major numeric value — logical element type `Float`/`Integer`/`Boolean`, backed by
a contiguous NumPy buffer. Logical `.element_type` is separate from storage `.dtype` (a Float matrix
may be stored f32). Same contract as `EastVector`: the arithmetic surface delegates to east-c
(#598) with the strict left-to-right reduction order; free-form math goes via
`to_numpy()`/`to_torch()`. **Immutable** (`set`/transform return a NEW matrix), **not hashable**
but valid as an East Set/Dict key. Construct via the `EastMatrix.*` classmethods (see
[Container generators](#container-generators-classmethods)); `from_numpy`/`from_torch` infer
`element_type` from the array dtype when omitted. Structural access methods called with an
expression argument lift the matrix as a constant and emit IR.

| Group | Methods |
|-------|---------|
| Access | `get(r, c)` ❗bounds (Python scalar) · `rows() -> int` · `cols() -> int` (TS names; `num_rows`/`num_cols` deprecated) |
| Transform (returns new) | `set(r, c, v) -> EastMatrix` ❗bounds (original unchanged) · `transpose() -> EastMatrix` (new cols×rows, contiguous) |
| Arithmetic (east-c; Float/Integer elements) | `scale(alpha)` · `add_scaled(other, alpha)` ❗dims · `mul_elementwise(other)` ❗dims (Hadamard) |
| Reduce (east-c; ascending index order) | `row_sums() -> EastVector` (ascending column order per row) · `col_sums() -> EastVector` (ascending row order per column) · `vec_mul(v) -> EastVector` ❗cols≠len (row-by-vector dot products) |
| Rows & cols | `get_row(r) -> EastVector` ❗bounds (contiguous copy) · `get_col(c) -> EastVector` ❗bounds (contiguous copy) |
| Per-row (east-c) / per-element (DEPRECATED, #625) | `map_rows(fn(row: EastVector[, i]) -> EastVector, out=None)` (the native MatrixMapRows — a body like every callback) · `map_elements(fn(el), out=None)` runs a python callback per element; it warns and will go — use the arithmetic surface or `to_numpy()` |
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
  shapes build inside a body.
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
| `parse_json(typ, s)` · `print_json(typ, value) -> str` / `print_json(value)` | East **JSON** (`Integer` encodes as a JSON *string*: `print_json(ArrayType(IntegerType), [1,2,3]) == '["1","2","3"]'`); the one-argument form (TS `printJson(value)`) takes the value's own type |
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
| `from_components(year, month=1, day=1, hour=0, minute=0, second=0, millisecond=0)` | construct (TS defaults: the trailing components are the first instant) |
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
`equal/not_equal/less/less_equal/greater/greater_equal(T, a, b) -> bool`.

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
| `write_beast2_file(path, T, value, *, codec="deflate", segment_rows=None)` | One call writes a collection of any size as one indexed v5 file, re-batched into managed-size segments (Array slices; Dict/Set split along sorted order, so segments stay key-disjoint). Managed batching is BYTE-adaptive (#560): a probe seeds rows-per-segment toward ~2 MiB of wire output (capped at 8192 rows), refined from real output, so wide rows still yield right-sized segments; an explicit `segment_rows` pins the row grain instead |
| `open_beast2_file(path, T, mode="w", *, codec=, segment_rows=)` | Streaming managed writer: `.write()` takes East collections **or** python builtins (list/dict/set), any size, re-batched internally (byte-adaptively, as above); `.segments` counts them |
| `open_beast2_file(path, T=None)` | Read: returns the root-kind flavor — `Beast2ArrayFile` / `Beast2DictFile` / `Beast2SetFile` — a first-class READ-ONLY East collection VALUE (#560): each subclasses `EastArray`/`EastDict`/`EastSet`, so `isinstance`/`type_of` answer, every eager method works (streamed overrides below; the rest via iteration), mutation raises, and the file binds into functions / passes into compiled calls by reference — keyed reads inside the compiled body answer from the pager, one frame per hit/miss, through a BYTE-budgeted segment cache (`EAST_PAGED_CACHE_BYTES`). `close()` DEFERS while a bind still holds the value. `T` is optional (the self-describing header supplies it — also exposed as `f.wire_type`); a declared `T` is validated against the header, so a mismatch fails at open instead of decoding garbage |
| `read_beast2_type(source) -> EastType` | The root type embedded in any beast2-full blob (v4 **and** v5), from a path or buffer, no value decoded — regenerate loaders from artifacts alone, or inspect a file you know nothing about |
| `write_beast2_file_parallel(path, T, partitions, produce, *, processes=, strategy="auto", codec=, segment_rows=, keep_shards=False, verify=False)` | Partitioned parallel write to ONE file: `produce(partition)` runs per worker and returns that partition's batches (or one collection = one batch); each worker writes a private shard and the shards splice **in partition order**, incrementally, as they finish. `strategy="auto"` forks on Linux/macOS — whatever `produce` closes over is inherited copy-on-write, so build the expensive context before the call (and call before starting threads) — and runs inline on Windows: byte-identical output either way. Any worker failure (exception or signal) fails the whole call with the worker's traceback and leaves nothing behind |
| `splice_beast2_files(path, T, sources, *, verify=False) -> (segments, elements)` | Merge indexed v5 files into one by **byte copy** — east-c parses the container geometry, `os.sendfile` moves the segment frames, nothing decodes or re-encodes. `sources` may be a lazy generator (shards splice as they complete, in order = row order). Every source must be v5 + indexed + self-contained with an identical type section; refusals name the offending path and leave no destination. Output is indistinguishable from one writer given the same batches; `verify=True` re-walks it with east-c's strict sequential reader |
| `f.load()` | The whole collection, decoded entirely inside east-c off the mmap — input-side memory stays one segment at any file size (also the mutable escape hatch, like `f.copy()`) |
| `f.segments()` | DEPRECATED alias (#560) — the file IS its collection value, so the eager methods, keyed reads and `load()` subsume the raw segment scan; still works (warning) for per-batch migration code |
| `len(f)` · `f.segment_count` · `f.self_contained` · `f.indexed` | O(1) from the trailing index — counts are exact for every root kind (Set/Dict segments are disjoint ranges of the canonical value) |
| Array: `f[i]` / `f[a:b]` · `f.get(i)` ❗bounds · `f.get_or_default(i, d)` · `f.try_get(i)` → `some`/`none` · `f.has(i)` · `f.slice(a, b)` · `f.get_keys(rows)` | Same names, signatures and error semantics as `EastArray`; every point read decodes only the owning segment, `get_keys` decodes each owning segment once |
| Dict: `f[k]` ❗KeyError · `f.get(k[, default | fn(k)])` · `f.get_or_default(k, d)` · `f.try_get(k)` → `some`/`none` · `f.has(k)` / `k in f` · `f.get_keys(keys, fill)` · `f.items()/values()` and iteration (streaming) · `f.keys()` (the Set — native per-segment union) · `f.size()` — Set: `x in f` / `f.has(x)` | Keyed reads (#481 W2): east-c binary-searches the segment *fences* — each segment's first key, decoded from a bounded probe of the frame's prefix and cached — then decodes ONLY the owning segment (a small LRU keeps hot segments). `get_keys` merges the sorted keys against the fences so each owning segment decodes once, and calls `fill` per missing key. Disjoint ascending segments are the v5 wire contract; the first keyed read still verifies the fences, and a corrupt (or pre-contract) blob raises `segments are not disjoint ascending key ranges` instead of reporting false misses |
| Array sorted search: `f.find_sorted_first/last(target)` → global index · `f.find_sorted_range(target)` → `{start, end}` | Same contract as the eager `EastArray` builtins over the whole file — the fences pick the boundary segment, its in-segment search adds the segment's base, and only that segment decodes. No `key=` projection (the file pages by element order); pair with `f.slice(start, end)` to fetch the matching rows |
| Compute (#481 W4): `f.map/filter/filter_map/first_map/reduce/scan/map_reduce/sum/mean/maximum/minimum/every/some/find_first/find_all/find_maximum/find_minimum/is_sorted/to_set/unique/to_dict/to_array/to_columns/map_batches/string_join/flat_map (Array) / flatten_to_array (Set, Dict)/flatten_to_set/dict/for_each` · the full `group_*` family (including `group_find_all/first/maximum/minimum`, whose indices are rebased to GLOBAL rows) · Set algebra (`union/intersection/difference/symmetric_difference/is_subset_of/is_superset_of/is_disjoint_from`) | The whole eager read surface, one segment decoded at a time: each segment runs the ordinary eager method — bodies build, precompiled functions pass through — and partials combine through east-c containers in stream order. Order-dependent folds thread ONE accumulator and grouped folds SEED each segment's init from the running per-group accumulators, so results equal `load()` exactly, float ordering included. Array `(el, idx)` callbacks see GLOBAL row indices, and so do the indices `find_*`/`group_find_*` report; `first_map`/`some`/`every`/`is_superset_of` stop decoding at the answer. Dict/Set compute streams disjointness-verified segments (a corrupt blob fails loudly, like keyed reads). Re-keyed collisions in `to_dict`/`flatten_to_dict`/`group_to_dicts` combine left-associatively in stream order — use an associative `combine`. `sort`/`reverse`/`copy`/`concat`/`union` stay off the file (they materialize the whole collection — `load()` first) |
| Column projection (#599, finishing #481 W3) — INFERRED: automatic on the compute family above; EXPLICIT: `open_beast2_file(path, project=NARROW)` | The compute family builds its callbacks FIRST and decodes each segment to exactly the struct fields the IR reads (skipped fields are parsed-and-hopped through the inflated bytes, never built into values — value materialisation, not byte-walking, dominates decode cost). Struct fields subset by name at ANY depth; a subtree used any way other than a further field read stays whole, so every comparison and builtin sees full values and results are unchanged. Dict KEYS and Set elements never narrow (they order the container). Runner-opened task inputs get the same inference from the compiled body's loop IR — no API change at either site. Non-inferable cases decode whole and are COUNTED in `eager_stats()` (`beast2_segments_projected/whole`, `beast2_projection_declined_*` by reason: a callback that cannot build, the element escaping whole, a `.bind` function with no source to rebuild, an unpageable blob) — an inferred optimisation that silently stops applying is an invisible cliff. The explicit form serves the subset from EVERY read (point reads, keyed gets, `load()`); `project` must be a subset of the wire type — a missing field raises `ValueError` naming it and the wire's fields — while a declared `T` keeps its exact meaning; `find_sorted_*` refuse under it (the file sorts by whole elements). Cache rule: a segment decoded under one mask is never served to an operation needing more. Zero wire change — every blob stays readable by every runtime |
| Degraded blobs | v4 file → clear refusal (`decode_beast2_with_header_for` still decodes v4 whole); index-less v5 → `segments()`/`load()` work, random access refuses; non-self-contained → point reads refuse |

```python
from east.serialization.beast2 import open_beast2_file, write_beast2_file

write_beast2_file(path, rows_t, rows)             # any size, one call

with open_beast2_file(path) as f:                 # self-describing: type from the
    row = f[1_234_567]                            #   header (f.wire_type); pass rows_t
    totals = f.group_sum(lambda b, r: r["sku"],   #   instead to VALIDATE it at open
                         lambda b, r: r["qty"])   # whole-file compute: segment folds,
    top = f.maximum(by=lambda b, r: r["qty"])     #   never materialized, == load() exactly
    table = f.load()                              # whole table when you truly need it

# The file IS a collection value (#560): bind it into a function and the
# compiled body's keyed reads answer from the pager — one frame per lookup.
with open_beast2_file("table.beast2") as t:       # Dict<String, Float>
    lookup = East.function([StringType, DictType(StringType, FloatType)], FloatType,
                           lambda b, k, d: d.get_or_default(k, 0.0)).bind(t)
    joined = rows.map(lambda b, r: r.v + lookup(r.k))   # loop + callee + pager: all east-c
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

**Put the logic in the platform function, not a pure-Python shim.** Don't
write pure-Python helpers over `list`/`dict` and give a `@East.platform_function`
that only converts-and-delegates to them. A `@East.platform_function` is *just* a
typed, validated Python function — its one added cost is validating the declared
output, which is a **feature** — so a separate untyped helper layer buys nothing
and costs you: **testability** (the typed `inputs`/`output` is the contract you
test against; untyped helpers surface bugs as silent corruption instead of a
named `EastTypeError`), **migratability** (a platform function over East values
is the portable unit — it moves to an e3 task, another runtime, or a TS `East`
mirror unchanged), **a forced sandwich** (a helper that speaks `list`/`dict`
makes the function convert East→Python on the way in and back on the way
out), and **blurred purity** (East platform functions should be *pure in their
East inputs* — that is what makes them memoisable). Factoring out small
functions for reuse is fine — just have them **take and return East values**
so the East types flow through; pay the output-validation cost only at the
real East↔Python edge, and never call a platform function per element inside
a loop.

### Platform functions

| Signature | Description |
|-----------|-------------|
| `@East.platform_function(*, inputs, output, name=None, validate_output=True, validate_input=False)` | Register a Python fn; infers sync/async from the def; validates output against `output`; paired with the `East.platform(name, …)` declaration by name (the def's, or `name=`). Also importable bare: `from east import platform_function` |
| `@East.generic_platform_function(*, type_parameters, name=None, is_async=False)` | Type-parameterized factory: the decorated fn is `fn(platform, *type_params) -> impl`; `is_async` is **explicit** (not inferred) |
| `East.platform_functions(module) -> list` | Collects every decorated fn in `module` (pass `__name__`). Two consumers: `East.compile()` for in-process use, and a package's top-level `platform` list that `east-py run -p <module>` (and the e3 `{ custom }` runner) loads |
| `@memoize` / `@memoize(salt="…")` / `memoized = memoize(fn, salt="…")` | Content-addressed memo over ONE platform function. Apply **above** `@East.platform_function` (or inline on an imported one). Key = sha256(name + salts + per-input digests of the with-header BEAST2 encodings via the declared input types); value = with-header BEAST2 of the output, decoded via the declared output type. Inert by default |
| `configure_memo(directory, salt="")` | Activate (`None` deactivates) memoization for `@memoize` functions; overrides `EAST_MEMO_DIR` / `EAST_MEMO_SALT` env vars. Bump `salt` to invalidate after code edits — input-derived keys can't see them |

### What is NOT east-c (the honest list)

Almost everything above delegates to native builtins — these are the paths
that still run python, so you can reason about cost and semantics:

- **`EastMatrix.map_elements`** is DEPRECATED (#625): it ran a python
  callback per element, the one shape the strict surface removes, so it
  warns and will go. (`Vector.map`/`reduce` and `Matrix.map_rows` are the
  native VectorMap/VectorFold/MatrixMapRows builtins.) Use the
  arithmetic/reduction/mask/sparse methods, which delegate to the east-c
  builtins (#598), or `to_numpy`/`to_torch` for free-form math.
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
                                                                    #    the collection capture (#625):
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
    for chunk in chunk_ranges(start, count, 8192):   # writer re-batches into segments
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
    hot = orders.get_keys(wanted_ids, lambda b, k: default_order)   # each owning segment
    if candidate_id in orders:                      #   decodes once for the whole batch
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

- **Every body takes the block first** — `lambda b, x: …` / `def f(b, x)`,
  never `lambda x: …` (refused with the fix-it) — an `East.function` body, a
  builtin's callback, a branch, a loop, a `.match` handler alike, exactly as
  every TypeScript body is `($, …) => …`. A function VALUE (a compiled
  `East.function`, a `.bind` result) takes none. Name the block `_b` when the
  body does not use it.
- **Type constructors take PAIRS, not a dict** (unlike the TS DSL):
  `StructType([("name", StringType), ("price", FloatType)])` /
  `VariantType([("ok", T), ("err", E)])`.
- **`@East.platform_function` output must be an East value.** Returning plain Python
  (a `dict`, a `list` of dicts) fails output validation — build with
  `array`/`struct`/`variant` or `coerce_to(raw, OutputType)` at the return
  boundary.
- **One name, two surfaces.** Inside any body you hold EXPRESSIONS (an option
  has `.is_some()` / `.unwrap_or(default)`); decoded East values — what a
  `@East.platform_function` is handed, or what iteration yields — are the eager
  surface, where an option is an `EastVariant` with `.type` / `.value` /
  `.unwrap(tag)` and **no** `.unwrap_or`: branch on `opt.type == "some"` and
  read `opt.value`. Both are real; what does not exist is a callback that
  silently runs on the second.
- **The two `duration` spellings differ in sign**: the expression METHOD
  `a.duration_days(b)` is `b − a` (the TypeScript method); the namespace
  function `East.DateTime.duration_days(a, b)` is the raw builtin, `a − b`.
- **`EastDict.get(k)` errors on a missing key**, like `d[k]` and like
  TypeScript; `get(k, default)` (a value) is the python convenience, and
  `get(k, lambda b, k: …)` is TypeScript's `onMissing` body — both build IR.
- **`append` takes an ARRAY** (TS `append`); one element is `push_last`.
  A Set or Dict spells the array flattening `flatten_to_array` (TypeScript);
  only an Array has `flat_map`.
- **Genuinely-Python loops cross the boundary once** —
  `to_columns()` / `EastArray.from_columns` / `map_batches`, never a platform
  call or a decode per element.
- **Task inputs arrive frozen.** Runner-decoded values reaching a
  `@East.platform_function` are zero-copy proxies over the frozen C value:
  mutating one raises `cannot mutate a frozen value (task inputs are
  immutable) — copy first` — call `.copy()` to derive a mutable value.
  Keyed gets / iteration on a lazily-opened (paged) input stay O(segment)
  through the proxy; frozen collections compare by value under `Is`.
- **A callback East cannot express RAISES** — everywhere, eager paths
  included, with the offending binding NAMED. That covers both halves: a
  body reaching for python (`random.…`, `len`, a mutable capture, `nonlocal
  x; x += 1`) and one that looks East-native but is not (an f-string, which
  would constant-fold the proxy into the result; an off-surface method).
  The alternative it replaces — quietly dropping the loop to per-element
  python — had no symptom except the job taking hours. Build strings with
  `East.str(...)` or `+`; write an explicit `for` loop for genuine python work.
- **A captured East collection is read with `.get(expr)` /
  `.get_or_default(expr, d)` / `.try_get(expr)`** — the `[expr]` subscript
  spelling does not build IR on a captured constant (python coerces the index
  via `__index__` and the build bails).

## Related skills

`east-py` is the Python runtime: East expressions AND East values in Python, plus the
`@East.platform_function` on-ramp. Load the skill that matches what you are adding:

- **east** — the TypeScript `East.function` DSL. The expression surface here is its
  twin name for name (`$` is `b`, `camelCase` is `snake_case`); the two share the same
  type system and IR, a program prints from one into the other (`east-py transpile` /
  `east-node transpile`), and a function exported from one is imported by the other
  (`east-py export-functions` ↔ `East.importFunction`).
- **east-py-datascience** — Python platform functions for ML and optimization (XGBoost, LightGBM,
  Optuna, MADS, PyMC, SHAP, Torch, GoogleOR, Simulation). The home once a `@East.platform_function`
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
