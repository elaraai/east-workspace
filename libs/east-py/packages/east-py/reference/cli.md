# The east-py CLI

Part of the `east-py` skill.

`east-py` (the `east-py-cli` package) runs East IR with python platform
functions — the runner e3 drives for `runtime: 'east-py'` — and carries the
authoring tools:

```bash
east-py run prog.beast2 -p east-py-std -i a.beast2 -i b.json -o out.beast2   # -v: timings, peak memory
east-py run prog.beast2 -p east-py-std --profile   # time per East and platform function
east-py exec unit.beast2                        # one unit: the runner protocol e3 speaks
east-py convert value.beast2                    # a beast2 value as East text (-o value.east to write it)
east-py transpile prog.beast2 -o prog.py        # IR → a python module that rebuilds it
east-py export-functions pricing -o pricing.functions.beast2 -p east-py-std
east-py lint src/ ; east-py check src/ ; east-py lsp
east-py version -p east-py-std                  # the runner's version, and each package's
```

| Command | Does |
|---|---|
| `run <ir> [-p PACKAGE]… [-i FILE]… [-o FILE] [--decode lazy\|whole] [-v] [--profile]` | Compiles an IR file (`.beast2`, `.beast`, `.east` or `.json`) and calls it with one `-i` file per parameter, in order, each decoded by its extension to the parameter's type and FROZEN (a task input is immutable). An indexed beast2 collection input opens lazily, whatever it weighs — mapped, one segment decoded at a time, and decoded whole, once, when an operation the pager cannot serve first needs it — and a manifest file opens as the collection it names; `--decode whole` (east-c's and east-node's flag too) decodes every input before the program runs instead. `-o` writes the result in its extension's format (a collection as canonical indexed beast2); without it the result prints as East text. `-v` adds timings, peak memory and how each input was read: a lazy input's segment reads, or the resident memory a whole decode added |
| `exec <unit> [-v] [--profile]` | The runner protocol: one unit file says what to run — a program over its inputs, read as its `decode` says (as `run --decode`), or a merge of an output's parts — and where; the output is written by its kind and a result recorded. Exit 0 when it succeeded, 1 when it failed (the message and locations also go to stderr), 2 when the unit cannot be read or the result written. Relative paths in the unit are relative to its directory |
| `convert <file> [-o FILE.east] [-v]` | Decodes a beast2 value (its header names the type) and prints it as East text, or writes it to a `.east` file |
| `transpile <ir> [-o FILE] [--name NAME] [-p PACKAGE]…` | IR as a python module rebuilding it (`--name` binds it, default `main`; each `-p` prints its calls as that package's own functions) — [IR ↔ python](ir-and-diagnostics.md#ir--python-east-py-transpile-and-the-east-c-ir-toolbox) |
| `export-functions <module> -o FILE [-p PACKAGE]… [--name NAME] [--package-version V] [--only NAME]…` | A module's (a dotted name, or a `.py` path) `east_functions` as a function manifest; every platform call must be provided by a `-p` package; `--name` defaults to the module's top-level name, the version to the installed distribution's (else `0.0.0`); `--only` exports just those, building only them and what they call (a sibling that does not build fails nothing). `--batch FILE` in place of `-o`/`-p`/`--only` writes several manifests from one import, FILE a beast2 batch (`FunctionExportBatchType`: each entry's `output`, `packages` and `only`) — what `e3.export` runs per workspace package — [Cross-language functions](cross-language.md#cross-language-functions-east-py-export-functions-and-eastimport_function) |
| `lint [paths…] [--format text\|json] [--disable RULE]… [--exclude DIR]… [--list-rules]` | The rules (default path `.`); exit 1 on any finding, a warning included, 2 on a usage error — [Diagnostics](ir-and-diagnostics.md#diagnostics-at-edit-time--east-py-lint-east-py-check-flake8-east-py-lsp) |
| `check <targets…> [--format text\|json] [--only-if-enabled]` | The build's own errors; exit 1 on any |
| `lsp [--probe]` | The Language Server over stdio (needs `pygls`); `--probe` reports whether it can start here |
| `version [-p PACKAGE]…` | The `east-py-cli` and `east-py` versions (and the Cython extensions loaded), and each package's version and function count |

A `-p` package is a python module name (`east-py-std` imports `east_py_std`)
exporting a top-level `platform` list; a project's own module is loaded the same
way (see [Project-owned platform module](patterns.md#project-owned-platform-module-calling-your-python-from-e3)).
`run` and `exec` take `--exit-with-parent`: exit once stdin reaches end of file,
for a parent that holds a stdin pipe it never writes to.

**Profiling.** `run` and `exec` take `--profile`, east-c's profiler and report:
after the work (and after a failure's error), every East function and platform
function it called, by self time, with its calls, its total time and where it
is — the `file:line:column` it was written at and, for a helper called inside
another body, where it was called. A platform function (torch, a solver) is an
entry of its own, so its time is not its caller's, and so is each input read
lazily, named as `-v` names it (`input 1`): the segments its reads decode, a
call each — keyed reads at random beyond the segments the runner keeps, or a
scan repeated, show there, not in the reading function's self time. `EAST_PROFILE=1` profiles
without the flag — e3 hands its environment to the runner, so a task's report
lands in its log (`e3 task logs`) — and `EAST_PROFILE_INTERVAL=N` prints the
profile so far every N seconds while the work runs. A python function linked
into a TypeScript task carries its locations through the manifest, so the
report names its python lines.
