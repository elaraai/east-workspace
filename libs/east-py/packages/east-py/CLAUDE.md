# east-py

Python runtime for the East programming language. Implements the East type
system in Python and bridges to the native **east-c** runtime via Cython for
IR compilation, the builtin library, execution, and serialization (the
`_eastc` bridge — `runtime/compiler.py:5-9`). East values are usable as plain
Python data with eager methods that delegate to the east-c builtins. Enables
East IR to be compiled and executed in Python environments.

> The older "pure-Python compiler + 212 builtins" framing is stale — do not
> reintroduce it; builtins are not ported to Python.

## Commands

`make build`, `make test`, `make lint`, `make typecheck`, `make check`,
`make repl`, `make coverage` from this directory. See
[`../../../../docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

Pytest-specific invocations when you need them:

```bash
uv run pytest tests/builtins/test_builtins.py -v
uv run pytest tests/builtins/test_builtins.py::test_array_map -v
uv run pytest -k "array"
```

## Architecture

### Homoiconic type system

**Everything is an East value, including types themselves.**

- Types are East variants with cases like "Integer", "Array", "Function".
- IR nodes are East values (variants conforming to IRType).
- This enables cross-language serialization of both data AND code.

All structured data uses two base classes:

- **`EastStruct`** — Product types (records with named fields),
  immutable.
- **`EastVariant`** — Sum types (tagged unions), immutable.

### Module layers

1. **`east/types/`** — foundation type system
   - `type_system.py` — core type definitions (`EastType`, `ArrayType`,
     `DictType`, …)
   - `primitives.py` — `Null`, `Boolean`, `Integer`, `Float`, `String`,
     `Blob`, `DateTime`
   - `containers.py` — `Array`, `Set`, `Dict` (mutable collections with
     deterministic ordering)
   - `structural.py` — `Struct`, `Variant`, `Function` types
   - `ref.py` — `Ref` type (mutable reference cells)

2. **`east/ir/`** — intermediate representation
   - `builders.py` — helpers for building IR nodes (`ir_value`,
     `ir_function`, …)
   - `analyze.py` — type checking, validation, async propagation analysis

3. **`east/runtime/`** — execution engine
   - `compiler.py` — compiles IR to native Python functions using
     environment-passing style
   - `platform.py` — platform function integration API

4. **`east/builtins/`** — 212+ builtin functions
   - Auto-register on import via registry pattern
   - Generic builtins receive type parameters as trailing arguments

5. **`east/serialization/`** — parsing and printing
   - `east_parser.py` / `east_printer.py` — East text format
   - `json.py` — JSON encoding/decoding
   - `beast2.py` — Binary East format
   - `csv.py` — CSV encoding/decoding

6. **`east/datetime_format/`** — datetime formatting
   - `parse.py` / `print.py` — parse/print datetime with format strings
   - `tokenize.py` — format string tokenization

### Compilation pipeline

```
East IR (as East values)
    ↓
_compile_ir() — dispatches to node-specific compilers
    ↓
Python functions — use environment-passing style (env dict → result)
```

Key patterns:
- Compiled functions take `env: dict[str, Any]` and return values.
- Async propagation is computed bottom-up during compilation (from
  `FunctionType.platforms`).
- Platform functions (host environment interface) vs Builtins (pure
  functions).

### Important invariants

1. **Immutability.** `EastStruct` and `EastVariant` are frozen. Only
   `Array`, `Set`, `Dict`, and `Ref` are mutable.
2. **Container ordering.** Sets and Dicts maintain sorted order using
   East's total ordering for deterministic behavior.
3. **Type-value correspondence.** Every East value carries its type
   (`value._east_type`, `arr.element_type`, …).
4. **Type-driven operations.** Parsing, serialization, and many
   operations require the target type.

### Builtin registry pattern

Builtins auto-register when their module is imported:

```python
# In builtins/array.py
def array_length(arr: EastArray, T: Any) -> int:
    return len(arr)

register_builtin("Array.Length", array_length)
```

Generic builtins receive type parameters as trailing arguments (e.g.
`array_get(arr, index, T)`).

### Error handling

Try-catch-finally at the IR level with explicit message and stack
variables. All IR nodes carry location information (filename, line,
column) for error reporting.

## Cython acceleration

Hot paths have optional Cython (`*.pyx`) acceleration modules that
compile automatically at install time via setuptools. If gcc is
unavailable, the package falls back to pure Python.

### Pattern

For any `foo.py` that needs acceleration:

1. Create `_foo_cy.pyx` sibling with `cpdef`/`cdef` typed equivalents.
2. Add import shim at the bottom of `foo.py`:
   `with contextlib.suppress(ImportError): from ._foo_cy import ...`
3. `setup.py` auto-discovers all `.pyx` files — no script changes
   needed.

### Accelerated modules

| Module | Cython file | What's accelerated |
|---|---|---|
| `types/values.py` | `_values_cy.pyx` | `CyEastStruct`, `CyEastVariant` cdef classes with direct C member access |
| `serialization/binary_utils.py` | `_binary_utils_cy.pyx` | `read_varint`, `read_zigzag`, `read_float64_le`, `read_string_utf8_varint` |
| `serialization/beast2.py` | `_beast2_cy.pyx` | `decode_beast2_value_for` — full BEAST2 decoder |
| `serialization/csv.py` | `_csv_cy.pyx` | `decode_csv_for`, `encode_csv_for` — CSV row parsing |

### Key conventions

- cdef classes (`CyEastStruct`, `CyEastVariant`) must have
  `__class_getitem__` for generic subscripting.
- Use `cpdef` for functions callable from both Python and Cython
  closures.
- Class swaps (e.g. `EastStruct = CyEastStruct`) happen in `values.py`
  — use `is_east_struct()` / `is_east_variant()` instead of
  `isinstance()` checks.
- `make build-cython` rebuilds extensions during development without
  reinstalling.

## Type checking

mypy is configured for gradual typing (`disallow_untyped_defs = false`)
because East is dynamically typed. Several error codes are disabled to
accommodate runtime type flexibility. See `pyproject.toml` for details.

## Testing patterns

- `pytest` with verbose output.
- Tests organized by module: `tests/builtins/`, `tests/types/`,
  `tests/serialization/`, etc.
- Coverage target: 84% (current).
- Run specific tests with `-k` keyword matching or by specifying test
  file/function paths.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../../../east/CLAUDE.md`](../../../east/CLAUDE.md) — TS reference
  implementation. This package must pass the same compliance suite.
