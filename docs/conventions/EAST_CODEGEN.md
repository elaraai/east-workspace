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
- **Deterministic.** The same IR prints the same text; types hoist to
  `_tN` constants (deduplicated structurally), platform declarations to
  `_pN` (one per distinct signature), in first-use order.
- **Idiomatic.** The printed source is what an author would write: the
  `$` / `b` statement forms, expression methods, `East.value(v, T)` for
  constructions, host values (a `RegExp`, a CSV options object) where the
  surface takes them. The printer never invents surface: a spelling row
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
| `Assign` | `$.assign(x, v)` | `b.assign(x, v)` |
| `Return` / `Break` / `Continue` / `Error` | `$.return(v)` / `$.break(label)` / `$.continue(label)` / `$.error(m)` | `b.return_(v)` / `b.break_(label)` / `b.continue_(label)` / `b.error(m)` |
| Null-typed `IfElse` (statement) | `$.if(p, $ => {…}).elseIf(p, …).else(…)` | `b.if_(p, …).else_if(p, …).else_(…)` |
| Null-typed `Match` | `$.match(v, { case: ($, x) => {…} })` | `b.match_(v, {"case": …})` |
| `While` / `ForArray` / `ForSet` / `ForDict` | `$.while(p, ($, label) => {…})` / `$.for(coll, ($, value, key, label) => {…})` | `b.while_(…)` / `b.for_(…)` |
| Null-typed `TryCatch` | `$.try(…).catch(($, message, stack) => {…}).finally(…)` | `b.try_(…).catch(…).finally_(…)` |
| an expression in statement position | `$(expr)` | `b.do(expr)` |
| `Value` literal | `1n`, `1.5`, `"s"`, `true`, `null`, `new Date(…)`, `new Uint8Array([…])` | `1`, `1.5`, `'s'`, `True`, `None`, `datetime(…)`, `b'…'` |
| `Struct` / `Variant` / `NewArray` / `NewSet` / `NewDict` / `NewRef` / `NewVector` / `NewMatrix` | `East.value({…} / variant(c, v) / […] / new Set([…]) / new Map([…]) / ref(v) / new Float64Array([…]) / matrix(…), T)` | `East.value(…, T)` and the `East.new_*` constructors |
| `GetField` | `s.field` (or `s["odd-name"]`) | `s.field` |
| `Call` / `CallAsync` | `f(args)` | `f(args)` |
| expression `IfElse` (one predicate per node) | `p.ifElse($ => a, $ => b)` — more branches nest in the else arm | `East.if_else(…)` |
| expression `Match` | `v.match({ case: ($, x) => e })` | `v.match({…})` |
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
| `exprs` (TS) | slots the surface types `Expr`-only — the argument a free type parameter is inferred from (`merge<T2>(key, value: Expr<T2>, …)`); a literal there prints through `East.value` |
| `floatOnly` | stdlib constructors the surface declares for Float only (`East.Vector.zeros`); other element types print raw |
| `adapter` | a host-value argument shape: `regex` (`{R}` = pattern + flags, printed `new RegExp(p, f)` / `re.compile`), `csv` (`{C}` = the options struct, printed as an options object; dropped when every option is `none`) |

The two tables list the same builtins under each language's names; the
python name-parity test (`tests/test_ts_name_parity.py`) keeps the
surfaces aligned, and every builtin missing from a table is in that
printer's `RAW_ONLY`.

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

**Recipe — a python function in a TypeScript e3 task:**

```bash
east-py export-functions pricing.functions -o pricing.functions.beast2 -p east-py-std
```

```typescript
const score = East.importFunction("pricing", "score", FunctionType([RowType], FloatType));
const total = e3.task("total", [rows], East.function([ArrayType(RowType)], FloatType, ($, rs) => rs.map(($, r) => score(r)).sum()));
await e3.export(pkg, "out.zip", { functions: ["./pricing.functions.beast2"] });
// or: e3 workspace deploy . dev --from-source src/index.ts --functions ./pricing.functions.beast2
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

The IR carries variable names, but the builders write `_N` (TypeScript) and
`_fresh_name()` (python), so printed source reads `_3.add(_4)`. Carrying
authoring names into the IR is a **builder** change, not a wire change —
`VariableIR.name` is already a free string and the normalizer renames
canonically — tracked in #639.
