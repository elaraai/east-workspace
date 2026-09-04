# Python optional dependencies

**Applies to:** every Python package in this monorepo that consumes
heavy native libraries (numpy, scipy, pytorch, ortools, xgboost,
PyNomadBBO, pymongo, redis, …). Today that's
`libs/east-py/packages/east-py-datascience` and
`libs/east-py/packages/east-py-io`; expect the list to grow.

This pattern keeps the core package importable when an optional native
library isn't installed, without sprinkling `try/except ImportError`
throughout every implementation function.

---

## 1. Declare extras in `pyproject.toml`

Each module that depends on a third-party library declares an optional
extras group **named after the module**:

```toml
[project.optional-dependencies]
mads      = ["PyNomadBBO>=4.4.0"]
google-or = ["ortools>=9.9"]
xgboost   = ["xgboost>=2.0"]
optuna    = ["optuna>=3.5"]

# Convenience: install everything
all = [
    "PyNomadBBO>=4.4.0",
    "ortools>=9.9",
    "xgboost>=2.0",
    "optuna>=3.5",
]
```

Users install only what they need:

```bash
uv add east-py-datascience[xgboost,optuna]
```

---

## 2. Two-layer import guard

Each module that wraps an optional library uses **two layers**:

### Layer 1 — module-level `find_spec` check

Fast: avoids paying import cost at module load. Gate behind a single
`_check_*_support()` helper that raises a clear `NotImplementedError`:

```python
import importlib.util

_HAS_XGBOOST_SUPPORT = importlib.util.find_spec("xgboost") is not None


def _check_xgboost_support() -> None:
    """Raise if the xgboost extra isn't installed."""
    if not _HAS_XGBOOST_SUPPORT:
        raise NotImplementedError(
            "XGBoost support requires the 'xgboost' extra. "
            "Add east-py-datascience[xgboost] to your dependencies."
        )
```

**Check for a package-local helper before hand-writing that.**
`east-py-datascience` builds the same guard from one line —
`_check_xgboost_support = extra_guard("xgboost", "xgboost", "XGBoost")`
(`east_py_datascience._common.extra_guard`), which runs the `find_spec` probe
at import and returns the checker. `east-py-io` has no such helper, so it
spells the guard out as above. Follow the package you are editing.

### Layer 2 — bare lazy imports inside each impl function

Inside each implementation function, call the guard first, then **bare
import** the library (no `try/except ImportError` — the guard already
handled the missing-package case):

```python
def xgboost_fit(...):
    _check_xgboost_support()
    from xgboost import XGBRegressor
    # ... use it ...
```

Rules:

- Every impl function calls `_check_*_support()` first.
- No `try/except ImportError` inside functions — redundant with the
  guard.
- Never import the optional library at module top level. Module load
  must succeed without it.
- Core deps (`numpy`, `east-py` itself) may import at top level.

---

## 3. Mypy overrides

mypy can't resolve imports for libraries the developer hasn't
installed. Add an override in `pyproject.toml` for the external library:

```toml
[[tool.mypy.overrides]]
module = ["xgboost", "xgboost.*"]
ignore_missing_imports = true
```

A few libraries assemble their public names at import time (a lazy or star
re-export), so `ignore_missing_imports` leaves mypy seeing an empty module and
every attribute becomes an error. Those need `follow_imports = "skip"` instead
— see the list in `east-py-datascience/pyproject.toml`.

**Do not silence your own wrapper module.** An `ignore_errors = true` override
on `east_py_datascience.*` / `east_py_io.*` turns the type checker off for the
code you just wrote, which is exactly where the boundary bugs live. Type the
wrapper and let `make typecheck` cover it.

---

## 4. Checklist when adding a new optional-dep module

1. Add the dep to `[project.optional-dependencies]` under a group named
   after the module. Add to `all` too.
2. Write `_HAS_<MODULE>_SUPPORT` and `_check_<module>_support()` at the
   top of the module.
3. In every impl function: call the guard, then bare-import inside
   the function body.
4. Add a `[[tool.mypy.overrides]]` block for the library
   (`ignore_missing_imports`; `follow_imports = "skip"` if its names are
   assembled at import time). Never `ignore_errors` your own module.
5. Update the parent package's CLAUDE.md `## Modules` table.
6. Run `make typecheck` and `make lint` from `libs/east-py`.
