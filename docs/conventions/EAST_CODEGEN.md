# East codegen: IR ↔ source, in both languages

**Applies to:** `libs/east/src/codegen/` (TypeScript: `East.toSource`,
`east-node transpile`), `libs/east-py/packages/east-py/east/codegen/`
(python: `to_python_source`, `east-py transpile`), the cross-language
function surface (`libs/east/src/functions.ts`, `east/functions.py`:
`East.exportFunctions` / `importFunction` / `linkImports` and their python
twins, the `export-functions` CLIs, `e3.export`'s `functions` option), and
the conformance suites that pin them (`libs/east/src/codegen/codegen.spec.ts`,
`libs/east-py/packages/east-py/tests/conformance/`).

East has one IR and two authoring surfaces. A printer turns the IR back
into the surface of either language — idiomatic builder source that a
person can read, edit and rebuild — so a program authored in TypeScript
can continue in python and back. This document is the contract the two
printers share, the mapping from IR constructs to source in each
language, and how the round trips are checked.

---

## 1. The contract

For every well-formed IR value whose root is a `Function` / `AsyncFunction`
(or the `Block[Let…, Function]` a python build with hoisted constants emits):

```
build(print(IR)) ≡ IR        under east-c's normalizer
```

- **`≡` is `east-c ir normalize`.** Normalization erases what the two
  builders legitimately differ on: `loc_id`s (source positions), variable
  and label names (renamed canonically in binding order), recursive type
  ids (renumbered), captures (recomputed). Everything else — node kinds,
  types, builtin names and type parameters, argument order, literal
  values, block structure — must come back byte-identical. The python
  suites reach the normalizer through the east-c bridge (`diff_ir`,
  `normalize_ir`); the TypeScript spec applies the same erasure in
  TypeScript (`canonical()` in the spec).
- **Total or loud.** Every node kind prints, or the printer raises
  `Unprintable` naming the node and where it sits (a statement in
  expression position, a jump to no loop, a `NewVector` of expressions,
  a `finally` on an expression `TryCatch`). A builtin the surface has no
  spelling for is never unprintable: it prints through the raw form
  (`East.builtin(name, [T...], [args], out)`) and is listed in the
  printer's `RAW_ONLY` set — a **ratchet** the tests pin, which may only
  shrink as spellings are added.
- **Deterministic, and laid out.** The same IR prints the same text. Every
  type prints inline where it is used (`$.let(new Map([…]),
  DictType(IntegerType, StringType))`, as an author writes it); a recursive
  type hoists to a `_tN` constant (deduplicated structurally); platform
  declarations hoist to `_pN` (one per distinct signature), in first-use
  order; a closure-free function called where it stands (the `Call` of a
  Function literal a TypeScript artifact leaves at its call) hoists to a
  `_fN` constant in TypeScript and is called by name, as the source called
  it — python prints it inline, `East.function(…)(x)`, because a python
  artifact called inside another body splices its body into the caller
  (#470) rather than emitting a `Call`. The source is written as a **layout
  document** (`codegen/doc.ts`, `east/codegen/doc.py`: Wadler's algebra as
  prettier and black realise it — text, line breaks, indentation, groups)
  and rendered once, top down: a group prints on one line when its
  contents and what follows on that line fit 100 columns (ruff's
  `line-length` here), and breaks every line of its own otherwise, its
  nested groups then taking their own turn. So a literal, an argument list
  or a struct / variant / parameter-list type that does not fit breaks one
  entry per line with a trailing comma; a TypeScript call hugs a trailing
  callback (`xs.map(($, x) => {` stays on its line, the body breaks
  inside) or a sole literal, and a concise arrow that does not fit breaks
  after its `=>`; python hugs a sole literal argument (`StructType([`) and
  lays a run of operands at one precedence level out as one group breaking
  before each operator, dropping the parentheses precedence allows
  (`((a + b) + c)` is `a + b + c`); a chain of three or more calls that
  does not fit prints one call per line (in parentheses after a python
  `return`); and a block body inside a plain argument breaks the call out
  (`$.const(` / the call / `)`), as prettier does. `width` (`Infinity` /
  `math.inf` for one construct per line) is an option of both printers.
- **Self-contained and minimal.** A printed module imports exactly the
  names it uses, from the package root (`@elaraai/east` / `east`): a walk
  over every type it spells collects the constructors (`typeConstructors` /
  `type_constructors`, case for case with `typeSource`), and the literal
  printer the helpers (`variant`, `some`, `none`, `ref`, `matrix`,
  `east_null`). A function whose body is one expression prints as the
  concise form — `($, x) => x.multiply(2n)`, `lambda b: x` for a nested
  python function — and as a block / decorated `def` otherwise.
- **Idiomatic.** The printed source is what an author would write: the
  `$` / `b` statement forms, expression methods, constructions as host
  literals wherever the surface types the position or the literal types
  itself (a binding, a method's value slot, a call argument, a declared
  return; a callback returning a struct), `East.value(v, T)` only where the
  type would otherwise be lost (a callback returning `none`, an empty
  collection, a `variant` or a `some` — alone, `some(x)` builds a one-case
  variant), `.unwrap()` for the match `unwrap` lowers to, host values (a
  `RegExp`, a CSV options object) where the surface takes them. The printer never invents surface: a spelling row
  exists only for a method the surface actually has, in the argument
  order the surface actually emits.

## 2. The construct mapping

Both surfaces are the same design (a block parameter first, one
expression class per East type, TypeScript names in snake_case for
python), so the mapping is one table.

| IR node | TypeScript (`$`) | python (`b`) |
|---|---|---|
| `Function([T…], O, body)` | `East.function([T…], O, ($, p…) => { … })` | `@East.function([T…], O)` on `def _fN(b, p…)` |
| `AsyncFunction` | `East.asyncFunction(…)` | `@East.async_function(…)` |
| `Block` | the body's statements; a last expression is `return`ed | the def's statements; a last expression is `return`ed |
| `Let` (immutable / mutable) | `const x = $.const(v)` / `$.let(v)` | `x = b.const(v)` / `b.let(v)` |
| `Let` with a widening `As` | `$.const(v, T)` | `b.const(v, T)` |
| `Let` of a construction (Struct / Variant / NewArray / NewSet / NewDict / …) | the host literal, the type on the binding: `const d = $.let(new Map([…]), T)`, `$.const(some(v), T)` — printed by `literalFor(T)`, a factory over the type like `compareFor`, so the one type governs every nested position and a construction inside prints bare (`new Map([["a", new Set([1n])]])`) | `d = b.let({…}, T)`, `b.const(some(v), T)` — a dict literal only when its keys are literals (python hashes them), otherwise `East.new_dict`; a set always `East.new_set` (a python set literal iterates in hash order and would lose the element order the IR carries) |
| `Assign` | `$.assign(x, v)` | `b.assign(x, v)` |
| `Return` / `Break` / `Continue` / `Error` | `$.return(v)` / `$.break(label)` / `$.continue(label)` / `$.error(m)` | `b.return_(v)` / `b.break_(label)` / `b.continue_(label)` / `b.error(m)` |
| Null-typed `IfElse` (statement) | `$.if(p, $ => {…}).elseIf(p, …).else(…)` | `b.if_(p, …).else_if(p, …).else_(…)` |
| Null-typed `Match` | `$.match(v, { case: ($, x) => {…} })` | `b.match_(v, {"case": …})` |
| `While` / `ForArray` / `ForSet` / `ForDict` | `$.while(p, ($, label) => {…})` / `$.for(coll, ($, value, key, label) => {…})` | `b.while_(…)` / `b.for_(…)` |
| Null-typed `TryCatch` | `$.try(…).catch(($, message, stack) => {…}).finally(…)` | `b.try_(…).catch(…).finally_(…)` |
| an expression in statement position | `$(expr)` | `b.do(expr)` |
| `Value` literal | `1n`, `1.5`, `"s"`, `true`, `null`, `new Date(…)`, `new Uint8Array([…])` | `1`, `1.5`, `'s'`, `True`, `None`, `datetime(…)`, `b'…'` |
| `Struct` / `Variant` / `NewArray` / `NewSet` / `NewDict` / `NewRef` / `NewVector` / `NewMatrix` | the host literal `{…}` / `variant(c, v)` / `[…]` / `new Set([…])` / `new Map([…])` (`new Map()` when empty — `new Map([])` is a `Map<unknown, unknown>` to the compiler; an empty set stays `new Set([])`, a `Set<never>`) / `ref(v)` / `new Float64Array([…])` / `matrix(…)`, an Option case `some(v)` / `none` — bare in a position the surface types (`xs.concat([1n, 2n])`, `f({ a: 1n })`, a `$.return`, a declared output) and, in a callback's return (its type is inferred from the value), bare when the literal types itself — a struct, a non-empty collection of such — and `East.value(…, T)` otherwise (`none`, `[]`, a `variant`, a `some`) | the python literal `{…}` / `[…]` / `some(v)` / `none` / `variant(c, v)`, bare in a typed position (an assignment, a `b.return_`, a declared return, a call argument) and, in a method's argument or a callback's return, bare when the value lifts on its own — a struct of scalars and expressions; a python list or dict has no element type without a hint — else `East.value(…, T)` / the `East.new_*` constructor (a set always) |
| `GetField` | `s.field` (or `s["odd-name"]`) | `s.field` |
| `Call` / `CallAsync` | `f(args)`; a closure-free Function literal called where it stands hoists to `const _fN = East.function(…)` and is called `_fN(args)` | `f(args)`; a Function literal called where it stands stays inline, `East.function(…)(args)` (an artifact call splices, #470) |
| expression `IfElse` (one predicate per node) | `p.ifElse($ => a, $ => b)` — more branches nest in the else arm | `East.if_else(…)` |
| expression `Match` | `v.match({ case: ($, x) => e })`; the match `unwrap` lowers to — one arm returns its variable, every other errors `Variant does not have case <it>` — prints `v.unwrap()` / `v.unwrap("case")` | `v.match({…})`; the `unwrap` match `v.unwrap()` / `v.unwrap('case')` |
| expression `TryCatch` (no finally) | `Expr.tryCatch(body, ($, message, stack) => e)` | `East.try_catch(…)` |
| expression `Block` | `Expr.block($ => { …; return e; })` | `East.block(…)` |
| `As` / `WrapRecursive` / `UnwrapRecursive` | `East.as(v, T)` / `East.wrapRecursive(v, T)` / `v.unwrap()` | `East.as_(v, T)` / `East.wrap_recursive(v, T)` / `v.unwrap()` |
| `Platform` | `_pN = East.platform(name, [T…], O)`; `_pN(args)`; generic: `East.genericPlatform(…)` called `_pN([T…], args)` | `_pN = East.platform(…)`; `_pN(args)` |
| `Builtin` with a spelling row | the row (`{0}.add({1})`, `East.print({0})`, …) | the row (`{0}.add({1})`, `East.print({0})`, …) |
| `Builtin` without a row | `East.builtin(name, [T…], [args], out)` | `East.builtin(name, [T…], [args], out)` |
| `StringConcat` chains | `.concat(…)` — `East.str\`…\`` builds the same chain | `.concat(…)` — `East.str` builds the same chain |

Two printer-specific rules:

- **Bodies whose type the builder infers** (a callback, an `Expr.block`, an
  expression arm) always `return` their last node. A last *statement* is
  returned as the `$.` form it evaluates to (`return $.assign(a, b)`): the
  builder recognizes the statement it already pushed and does not push it
  twice, so the IR is unchanged. A `finally` chain returns nothing, so a
  try/catch/finally there is bound first and the binding returned.
- **Null bodies** (a branch, loop, case, try, catch, finally): the builder
  pads a body whose last statement is not Null-typed with a `Value null`,
  so that null is not printed — rebuilding restores it. A `Value null`
  after a Null-typed statement is the body's own `return null;` and prints
  as one.

Argument order is the *surface's*, not the IR's, per row:
`a.durationMilliseconds(b)` emits `DateTimeDurationMilliseconds(b, a)` in
both languages, so the row is `{1}.durationMilliseconds({0})`.

## 3. Spelling tables

Each printer owns one table — `libs/east/src/codegen/spellings.ts`
(`SPELLINGS`) and `east/codegen/spellings.py` (`SPELLINGS`, whose rows are
derived from the namespace methods' own builtin-name constants). A row is a
template over `{0}`… (arguments, IR order), `{T0}`… (type parameters),
plus flags:

| Flag | Meaning |
|---|---|
| `callbacks` | slots printed as `($, …) => …` / `lambda b, …: …` bodies when the IR holds a `Function` node |
| `exprs` (TS) | slots the surface types `Expr`-only (`merge<T2>(key, value: Expr<T2>, …)`); a literal there prints through `East.value` |
| `inferred` (TS) | slots whose East type the surface infers from the argument — an unconstrained type parameter (`reduce<T2>(fn, init: T2)`); a construction prints bare there only when it types itself (`0n`, `{ a: x }`; not `[]`, `none`) |
| `floatOnly` | stdlib constructors the surface declares for Float only (`East.Vector.zeros`); other element types print raw |
| `adapter` | a host-value argument shape: `regex` (`{R}` = pattern + flags, printed `new RegExp(p, f)` / `re.compile`), `csv` (`{C}` = the options struct, printed as an options object; dropped when every option is `none`) |

The two tables list the same builtins under each language's names; the
python name-parity test (`tests/test_ts_name_parity.py`) keeps the
surfaces aligned, every builtin missing from a table is in that
printer's `RAW_ONLY`, and `libs/east/src/codegen/spellings.spec.ts` reads
the TypeScript signatures with the compiler and checks every slot of every
row: `exprs` are the `Expr`-only parameters, `inferred` the unconstrained
type parameters, and everything else accepts a value under a type the
surface supplies (`SubtypeExprOrValue`) — a slot the signatures do not
settle fails the spec.

## 4. The round trips

Three suites, one contract:

| Suite | Direction | Corpus |
|---|---|---|
| `libs/east/src/codegen/codegen.spec.ts` | IR → TypeScript → IR (+ executes on east-node) | hand-written coverage of every node kind; every exported example (`/tmp/east-examples-ir`); every compliance program (`/tmp/east-test-ir`) |
| `tests/conformance/test_ts_py_roundtrip.py` | IR → python → IR (+ executes on east-c; every corpus program's compliance run compared with the original's) | the same |
| `tests/conformance/test_three_way_sweep.py` | IR₁ → python → IR₂ → TypeScript (`east-node transpile --rebuild`) → IR₃, `IR₁ ≡ IR₂ ≡ IR₃` (+ IR₃ executes on east-c) | the same |

The corpora are exported once from TypeScript (`make test-export`, `npm run
export:examples` in `libs/east`) and read by every suite from
`EAST_TEST_IR_DIR` / `EAST_EXAMPLES_IR_DIR`. Locally a missing corpus SKIPS
the leg; CI sets `EAST_CONFORMANCE_REQUIRED=1` (and `EAST_SWEEP_REQUIRED=1`
for the three-way sweep, which also needs the east-node CLI at
`EAST_NODE_CLI`), under which a missing corpus is a failure — a leg that
silently skipped is how a round trip went unrun before.

## 5. Recipes

**TypeScript → python.** Write the IR, print it as python, edit, rebuild:

```typescript
import { encodeEastIR } from "@elaraai/east";
writeFileSync("program.beast2", encodeEastIR(fn.toIR()));       // any East function
```

```bash
east-py transpile program.beast2 -o program.py --name main       # to_python_source, from a file
python -c 'import program; print(program.main.compile()(3))'     # the python surface from here on
```

**python → TypeScript.** The IR of a python `East.function` artifact is its
`_east_ir` value (what the conformance suites read); write it, print it as
TypeScript, prove the rebuild:

```python
from east.serialization.json import encode_json_for
from east.types.type_of_type import IRType
Path("program.json").write_bytes(encode_json_for(IRType)(fn._east_ir))
```

```bash
east-node transpile program.json -o program.ts                          # East.toSource, from a file
east-node transpile program.json -o program.ts --rebuild check.beast2   # and the IR the module builds
east-c ir diff program.json check.beast2                                # "identical" under the normalizer
```

In code, `East.toSource(fn)` (TypeScript) and `to_python_source(fn)`
(python) print a built function directly.

**Adding a spelling.** Add the surface method first (both languages, name
parity), then the row in each table (argument order = the surface's), and
delete the builtin from `RAW_ONLY` — the ratchet fails until you do. Run
all three suites.

## 6. Cross-language functions: export, import, link

A function authored in one language is *called* from expression code in
the other, and the deployed program is pure IR — no python (or node) at
run time. Three pieces, name for name in both languages:

| Step | TypeScript | python |
|---|---|---|
| Export a package's functions as a **manifest** | `East.exportFunctions(pkg, version, { name: fn }, { providers })` → `East.encodeFunctionManifest` · CLI `east-node export-functions <module.js> -o <file> [-p <platform-package>…]` (reads the module's `eastFunctions`) | `East.export_functions(pkg, version, {"name": fn}, providers)` → `East.encode_function_manifest` · CLI `east-py export-functions <module> -o <file> [-p <platform-package>…]` (reads the module's `east_functions`) |
| Refer to an exported function | `East.importFunction(pkg, name, FunctionType([...], Out))` — a callable function expression | `East.import_function(pkg, name, FunctionType([...], Out))` |
| Resolve the references | `East.linkImports(fn, manifests)` → `{ ir, imports }` — what `e3.export(pkg, out, { functions })` runs on every task, function and mutation | `East.link_imports(fn, manifests)` → `(ir, imports)` |

The **manifest** (`FunctionManifestType`, fields declared alphabetically in
both languages so the wire layout cannot depend on declaration order) holds,
per function: its IR (loc_ids zeroed — a manifest has no source map), its
declared `FunctionType`, and its **platform dependencies** — every platform
function the IR calls, with the signature the IR emits and the package that
*provides* it (the exporter records the provider from its `-p` packages, and
refuses to export a dependency no package provides). Only closed values
export: a closure over an enclosing body, a python `.bind` result (no IR of
its own), or a function that itself holds an unresolved import is refused —
exports do not chain (v1).

An **unresolved import** is a `Platform` node named `east.importFunction`
whose two arguments are the package and function names — no new IR node
kind, and loud: compiling it unlinked fails naming that platform. Both
printers spell it back as `East.importFunction(...)` / `East.import_function(...)`.

**Linking** finds every such node, resolves it against the manifest whose
`package` matches, checks the declared type equals the exported type
*exactly* (a mismatch names both types), and embeds the exported IR as a
`Let`-bound constant at the top of the importing function's body; a use
inside a nested function captures the binding, so the nested functions'
`captures` lists grow. The result is self-contained IR — the same on every
runner — and the resolved imports' platform dependencies are returned for
the caller to validate. `e3.export` validates them against the owning
task's runner: the provider must be listed by name or through its stock
family (`east-py-std` ≡ `@elaraai/east-node-std` ≡ `east-c-std`;
`east-py-io` ≡ `@elaraai/east-node-io` — the compliance suites pin that a
family implements one contract per runtime); a custom-command runner is
trusted; a mismatch is a build error naming the task, the import, the
platform function and the runner's packages.

**Self-resolving imports (#652).** `e3.export` produces the manifests
itself for every imported package that is a member of the uv workspace the
export runs in: the package is found the way a `{ custom }` platform is
(the governing `uv.lock` above the working directory, by PEP 503 canonical
name, local sources only), and `east-py export-functions <package> --name
<package> [-p provider…]` runs in the member's directory — the `east-py` of
the nearest `.venv` above it, else `east-py` on PATH, `EAST_PY` naming it
outright — with the member's `src/` and directory on `PYTHONPATH`, so the
package's root module (declaring `east_functions`) imports whether or not it
is installed. The providers are the importing owner's runner: a stock
platform maps to its python family member, a `{ custom }` name passes
through on an east-py runner. A manifest given in `functions:` wins for its
package; a referenced package that is neither given nor a local member is
an export error naming the import and both ways out. `e3-cli`'s `e3 export`
/ `workspace deploy --from-source` inherit this; `--functions` is for
manifests built elsewhere.

**Recipe — a python function in a TypeScript e3 task:**

```python
# packages/pricing/src/pricing/__init__.py
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)
east_functions = {"score": score}
```

```typescript
const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));
const total = e3.task("total", [rows], East.function([ArrayType(RowType)], FloatType, ($, rs) => rs.map(($, r) => score(r)).sum()));
await e3.export(pkg, "out.zip");                 // `pricing` is a workspace member: exported and linked here
// or: e3 workspace deploy . dev --from-source src/index.ts
// a package built elsewhere: east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std
//   → e3.export(pkg, "out.zip", { functions: ["./pricing.functions.beast2"] })
```

The pinned evidence: `libs/east/src/functions.spec.ts` and
`tests/test_functions_export_import.py` (each language against itself),
`libs/e3/packages/e3/src/functions-link.spec.ts` (the export-time link and
runner check), and the cross-import pair — python importing a manifest
`east-node export-functions` wrote (`tests/conformance/test_cross_import.py`,
in the CI sweep job) and TypeScript importing the checked-in python
manifest `libs/east/test/fixtures/py-functions.beast2`
(`src/functions.crossimport.spec.ts`; the python test keeps the fixture
current, `EAST_UPDATE_FIXTURES=1` rewrites it). The cross-language stem
(`libs/east/test/crosslang.examples.ts` ↔ `tests/conformance/test_cross_language_stem.py`)
pins that the same program authored in either language is the same IR.

## 7. Where the source names went

The IR carries a name on every variable, and since #639 the builders write
the **authoring names** there, in both languages and with no new API:

| Variable | TypeScript reads it from | python reads it from |
|---|---|---|
| a body's parameters (`($, items, threshold) => …`, a callback's `($, x, i)`, a loop's `($, value, key, label)`, a match arm's `($, radius)`, a catch's `($, message, stack)`) | the function's own source text (`Function.prototype.toString`), parsed by the TypeScript compiler | its signature (`inspect.signature`) |
| a `$.let` / `$.const` binding (`const total = $.let(0n)`) | the authoring file, parsed by the TypeScript compiler: the declaration whose initializer is the call at the location the source map already resolves (`bindingNameAt`) | the authoring file, parsed by `ast`: the assignment whose value is the call the frame is executing, matched by the call's exact span (`binding_name_here`) |

Neither side matches patterns against text. The TypeScript side needs the
`typescript` package at run time — an **optional peer dependency** of
`@elaraai/east`, required lazily from node on the first build (about 100 ms
and 45 MB once per process; nothing where it is absent, as in a browser,
where every variable stays `_N`). A call inside another call's arguments,
or one with a further call chained onto it (`$.let(0n).add(1n)`),
initializes nothing and stays unnamed.

Names are **unique within their scope chain**. The compilers resolve
variables lexically, so sibling bodies reuse a name freely — three
callbacks each naming their element `x` are three `x`s — but a name still
in scope from an enclosing body takes a `_2`, `_3`… suffix: an alias to the
outer variable used inside the inner body (`const outer = x; xs.map(($, x)
=> x.add(outer))`) would otherwise resolve to the inner one. Every body is
a scope (`ast_to_ir`'s scope chain; python's frame stack, a body's
parameters registered for the frame about to open). Where no name can be
read — a slot the body did not declare (`($, x) => …` for a `(value, index)`
callback), destructuring, a `*args` body, a browser bundle, a REPL line
that is gone — the builder's fresh name stands: `_N` (TypeScript) or
`__nN` (python). A `$`/`b` block parameter is never a variable.

The printers keep every name that is an identifier, so printed source
reads `total.add(item.multiply(index))`; TypeScript's `_N` survives a trip
through python and back. The other builder's fresh spelling (python's
`__nN` seen from TypeScript, and any name a scope already uses — the
block parameter included) prints as `v_N` from one module-wide counter
that starts above any `v_N` the IR holds, in both printers, so **print →
build → print is the identity** in both languages: the corpus tests pin
`build(print(IR)) ≡ IR`, and `codegen.spec.ts` / `naming.spec.ts` /
`test_authoring_names.py` pin that the second print equals the first. The
normalizer still renames canonically, so `≡` never depended on this.

Helpers: `libs/east/src/naming.ts` (`parameterNames`, `bindingNameAt`) and
`east/expression/naming.py` (`parameter_names`, `binding_name_here`,
`authored_name`, `reset_names`).
