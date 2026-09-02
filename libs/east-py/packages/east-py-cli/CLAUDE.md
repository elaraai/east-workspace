# east-py-cli

Command-line interface for running East IR programs with the Python
runtime. Loads platform functions from any installed Python package
following the entry-point convention.

`cli.py` holds every subcommand (`run`, `transpile`, `export-functions`,
`convert`, `version`, and the #638 pair `lint` / `lsp`). `flake8.py` is the
flake8 checker the `flake8.extension` entry point `EAS` registers, `lsp.py`
the Language Server over `east.diagnostics` (`pygls` is the optional `lsp`
extra; `lsp_diagnostics` is the protocol-shaped payload and needs none).
`tests/test_lint.py` pins the three surfaces; `tests/test_transpile.py` /
`test_export_functions.py` the codegen ones.

## See also

- [`../east-py/CLAUDE.md`](../east-py/CLAUDE.md) — core Python runtime.
- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`README.md`](README.md) — public-facing usage.
