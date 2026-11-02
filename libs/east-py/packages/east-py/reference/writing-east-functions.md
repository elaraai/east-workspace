# Writing East functions in Python

The four authoring calls, the block `b` and its statements, the expression surface type by type, and the standard library. Part of the `east-py` skill.

## Contents

- Declare, implement, build, compile — the four authoring calls
- Every body takes the block first — the TypeScript `$` twin
- The expression surface, type by type
- The standard library — the TypeScript `East.<Type>.*` functions

A python body becomes East IR by being CAPTURED: it runs ONCE against typed
expression proxies, exactly like the TypeScript builder; east-c compiles the
recorded IR, and from then on only the compiled function runs. A body East
cannot express raises at build time, so the same source always costs and means
the same thing.

## Declare, implement, build, compile — the four authoring calls

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
`.bind(*values)` pre-binds trailing parameters by reference, and calling it
inside another body is a `Call` of its inline `Function` node — TypeScript's
shape — so it runs in ITS OWN frame: a `b.return_` returns from it, an
artifact used as an `East.if_else` arm evaluates only when that arm is taken,
an error inside it names its own lines, and a profile lists it as an entry of
its own, placed where it was written and where it was called. (One called with
arguments narrower than its parameters — a column projection's narrowed rows —
re-runs its source in its own frame and splices in instead.) An artifact that
mutates or raises, called and DISCARDED, is the build's "evaluated and thrown
away" error — spell it `b.do(push(xs))` / `East.block(push(xs), result)`, as
with any mutation. An artifact that calls platform functions stays first-class
(composable, serializable) but raises until `East.compile` pairs it with
implementations.
`East.function(...)` spelled INSIDE a body is the inline `Function` node, a
Function-typed expression: bind it with `b.const`, hand it to a callback slot,
or call it (a `Call`; in an `East.asyncFunction`, calling an async one is a
`CallAsync`).

**Error locations.** A build records the python frames that built each node,
so a runtime error names its authoring site: `EastError.location` is the stack —
the lambda's `file:line:column` first, then any helper between, then the
`East.function(...)` call — and a platform-signature mismatch at `East.compile`
names the call the same way. The stack stops at that call: the code that
imported or called the module is not recorded. A recorded path is relative to
its file's project root, the nearest directory above it holding a
`pyproject.toml`, so a function's IR is the same whichever module imported it
and whatever directory the process ran in. A file in no project is relative to
the working directory, and `set_location_base_path(dir)` (from `east`) pins one
base for every path, for reproducible fixtures (`None` restores the default);
`east-py check` names a refusal's frames relative to the working directory, as
an editor opens them. The map rides the function's beast2 encoding, so the
error reads the same on east-c or east-node. An error inside a callback a
builtin invokes (`arr.map(...)` and friends) resolves to the builtin's call
site, on every runner.
`set_location_capture(False)` (from `east`) builds without recording any
locations: there is then no stack walk per node, and an error raised by such a
function carries no location. Binding names are read separately and keep
working. The TypeScript twin is `setLocationCapture`.

## Every body takes the block first — the TypeScript `$` twin

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

## The expression surface, type by type

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
| **Array / Set / Dict / Vector / Matrix** | `xs[i]` (a negative LITERAL index raises — spell `xs.get(xs.size() - 1)`) · `d[k]` ❗missing · comparisons | The eager surface, name for name and signature for signature — [EastArray](value-methods.md#eastarray--complete-method-surface) · [EastSet](value-methods.md#eastset--complete-method-surface) · [EastDict](value-methods.md#eastdict--complete-method-surface) · [EastVector](value-methods.md#eastvector--complete-method-surface) · [EastMatrix](value-methods.md#eastmatrix--complete-method-surface) — less what only a value has: the python protocol (Array `insert`/`remove`/`count`/`index`, Set `add`/`remove`/`discard`, Dict `values`/`items`), the columnar hatches (`to_columns`, `from_columns`, `map_batches`, `update_many`), the numpy/torch bridges, the classmethod generators (`East.Array.range` and kin are their twins) and the deprecated `map_elements`. A mutator yields Null or Boolean — sequence it with `b.do` or `East.block`. A Dict callback is `(value, key)`: `fn(b, v)` or `fn(b, v, k)`, a fold step `fn(b, acc, v[, k])`, a collision handler `combine(b, existing, incoming[, key])` |
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

## The standard library — the TypeScript `East.<Type>.*` functions

Every namespace carries the East standard library — TypeScript's
`libs/east/src/expr/libs/*.ts`, body for body, snake_cased (`printCompact` →
`print_compact`; the TS misspelling `printCommaSeperated` stays
`print_comma_seperated`, with `print_comma_separated` as a python twin). Each is
an `East.function` built on first use: on plain values it runs natively, inside a
body it is a call of its inline Function node like any artifact — as
TypeScript's is:

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
[East.<Type> namespaces](value-methods.md#easttype-namespaces--the-builtins-and-the-standard-library);
the dual-mode generators (`East.Array.range`, `East.Set.generate`,
`East.Vector.zeros`, …) are in [Container generators](value-methods.md#container-generators-classmethods).
