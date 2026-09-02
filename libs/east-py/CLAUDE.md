# east-py

Python runtime for the East language, plus data-science and I/O platform
functions. uv workspace; self-contained under `libs/east-py/`.

## Packages

| Package | Purpose |
|---|---|
| `packages/east-py` | Core Python runtime — the East type system, the `East.function` expression builders, the east-c bridge (compile, builtins, serialization). See `packages/east-py/CLAUDE.md` for architecture. |
| `packages/east-py-std` | Standard platform functions (console, fs, path, crypto, time, random). |
| `packages/east-py-io` | I/O platform functions — SQL/NoSQL databases, S3, file formats, compression. |
| `packages/east-py-datascience` | ML and optimization platform functions (XGBoost, Optuna, PyMC, SHAP, etc.). |
| `packages/east-py-cli` | Command-line entry point. |

## Commands

```bash
make install       # uv sync (run once after pulling)
make test          # All Python tests
make lint          # ruff lint
make typecheck     # mypy
make check         # lint + typecheck + test
```

See `../../docs/conventions/MAKEFILE_TARGETS.md` for the full target list.

## Workspace

uv workspace, single `uv.lock` at this lib's root. Cross-package deps use
`{ workspace = true }` in each `pyproject.toml`.

## See also

- `../../docs/conventions/PYTHON_OPTIONAL_DEPS.md` — declaring optional
  native deps and the `find_spec` + lazy-import guard pattern.
- `packages/east-py-datascience/SKILL.md` — matches the
  `east:east-py-datascience` plugin skill — **DO NOT EDIT casually**.
- `packages/east-py-std/SKILL.md` / `packages/east-py-io/SKILL.md` — match
  the `east:east-py-std` / `east:east-py-io` plugin skills (Python-only,
  like `east:east-py`) — **DO NOT EDIT casually**.
- `packages/east-py/CLAUDE.md` — core runtime architecture
  (homoiconic type system, layer map, Cython acceleration).
