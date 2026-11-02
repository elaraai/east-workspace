# IR and diagnostics

Printing IR as python (`east-py transpile`), the `east-c ir` toolbox, and the edit-time checks (`east-py lint`, `check`, flake8, `lsp`). Part of the `east-py` skill.

## Contents

- IR ↔ python: `east-py transpile` and the `east-c ir` toolbox
- Diagnostics at edit time — `east-py lint`, `east-py check`, flake8, `east-py lsp`

## IR ↔ python: `east-py transpile` and the `east-c ir` toolbox

Any East IR — an `East.function` artifact, or a `.json` / `.beast2` export from
TypeScript, east-c or east-node — prints as an idiomatic python module that
REBUILDS it through the surface above:

```python
from east.codegen import to_python_source
print(to_python_source(classify))        # `@East.function(...)` / `def main(b, …)`
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

## Diagnostics at edit time — `east-py lint`, `east-py check`, flake8, `east-py lsp`

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
  pylsp are the editor paths that need no East-specific server; the Claude Code
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
| `no-reinlined-east-binding` (EAS026, warning) | a python local holding an EXPRESSION (`n = xs.size()`, not a `b.let`/`b.const` binding) read more than once in one body, or read inside a per-element callback, a loop body or a nested function below the body that bound it | each read re-emits — and re-evaluates — the expression: bind it once, `n = b.const(xs.size())`, where it is needed (the TypeScript rule of the same name) |

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
mistake is one rule's to report).
