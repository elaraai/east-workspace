# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

East.py is a Python runtime for the East programming language. It provides a complete implementation of the East type system, IR compiler, 212+ builtin functions, and serialization formats. The codebase enables East IR to be compiled and executed in Python environments.

## Development Commands

### Setup
```bash
make install          # First-time setup: install dependencies and pre-commit hooks
```

### Testing
```bash
make test             # Run full test suite (980 tests)
uv run pytest tests/builtins/test_builtins.py -v   # Run specific test file
uv run pytest tests/builtins/test_builtins.py::test_array_map -v  # Run single test
uv run pytest -k "array"  # Run tests matching keyword
```

### Code Quality
```bash
make lint             # Run ruff linter
make lint-fix         # Auto-fix linting issues
make format           # Format code with ruff
make typecheck        # Type check with mypy
make check            # Run all checks (lint + typecheck + test)
```

### Other
```bash
make repl             # Start Python REPL with east loaded
make coverage         # Generate HTML coverage report (htmlcov/index.html)
make clean            # Clean build artifacts and cache
```

## Architecture

### Homoiconic Type System

The most important architectural concept: **everything is an East value**, including types themselves. The type system is homoiconic.

- Types are East variants with cases like "Integer", "Array", "Function"
- IR nodes are East values (variants conforming to IRType)
- This enables cross-language serialization of both data AND code

All structured data uses two base classes:
- **EastStruct** - Product types (records with named fields), immutable
- **EastVariant** - Sum types (tagged unions), immutable

### Module Layers

The codebase follows a layered architecture:

1. **east/types/** - Foundation type system
   - `type_system.py` - Core type definitions (EastType, ArrayType, DictType, etc.)
   - `primitives.py` - Null, Boolean, Integer, Float, String, Blob, DateTime
   - `containers.py` - Array, Set, Dict (mutable collections with deterministic ordering)
   - `structural.py` - Struct, Variant, Function types
   - `ref.py` - Ref type (mutable reference cells)

2. **east/ir/** - Intermediate representation
   - `builders.py` - Helper functions for building IR nodes (ir_value, ir_function, etc.)
   - `analyze.py` - Type checking, validation, and async propagation analysis

3. **east/runtime/** - Execution engine
   - `compiler.py` - Compiles IR to native Python functions using environment-passing style
   - `platform.py` - Platform function integration API

4. **east/builtins/** - 212+ builtin functions
   - Auto-register on import via registry pattern
   - Generic builtins receive type parameters as trailing arguments

5. **east/serialization/** - Parsing and printing
   - `east_parser.py` / `east_printer.py` - East text format
   - `json.py` - JSON encoding/decoding
   - `beast2.py` - Binary East format
   - `csv.py` - CSV encoding/decoding

6. **east/datetime_format/** - DateTime formatting
   - `parse.py` / `print.py` - Parse/print datetime with format strings
   - `tokenize.py` - Format string tokenization

### Compilation Pipeline

```
East IR (as East values)
    ↓
_compile_ir() - Dispatches to node-specific compilers
    ↓
Python functions - Use environment-passing style (env dict → result)
```

**Key patterns:**
- Compiled functions take `env: dict[str, Any]` and return values
- Async propagation is computed bottom-up during compilation (from FunctionType.platforms)
- Platform functions (host environment interface) vs Builtins (pure functions)

### Important Invariants

1. **Immutability** - EastStruct and EastVariant are frozen. Only Array, Set, Dict, and Ref are mutable.
2. **Container ordering** - Sets and Dicts maintain sorted order using East's total ordering for deterministic behavior
3. **Type-value correspondence** - Every East value carries its type (`value._east_type`, `arr.element_type`, etc.)
4. **Type-driven operations** - Parsing, serialization, and many operations require the target type

### Builtin Registry Pattern

Builtins auto-register when their module is imported:

```python
# In builtins/array.py
def array_length(arr: EastArray, T: Any) -> int:
    return len(arr)

register_builtin("Array.Length", array_length)
```

Generic builtins receive type parameters as trailing arguments (e.g., `array_get(arr, index, T)`).

### Error Handling

The system uses try-catch-finally at the IR level with explicit message and stack variables. All IR nodes carry location information (filename, line, column) for error reporting.

## Cython Acceleration

Hot paths have optional Cython (`*.pyx`) acceleration modules that compile automatically at install time via setuptools. If gcc is unavailable, the package falls back to pure Python.

### Pattern

For any `foo.py` that needs acceleration:
1. Create `_foo_cy.pyx` sibling with `cpdef`/`cdef` typed equivalents
2. Add import shim at bottom of `foo.py`: `with contextlib.suppress(ImportError): from ._foo_cy import ...`
3. `setup.py` auto-discovers all `.pyx` files — no script changes needed

### Accelerated Modules

| Module | Cython file | What's accelerated |
|--------|------------|-------------------|
| `types/values.py` | `_values_cy.pyx` | `CyEastStruct`, `CyEastVariant` cdef classes with direct C member access |
| `serialization/binary_utils.py` | `_binary_utils_cy.pyx` | `read_varint`, `read_zigzag`, `read_float64_le`, `read_string_utf8_varint` |
| `serialization/beast2.py` | `_beast2_cy.pyx` | `decode_beast2_value_for` — full BEAST2 decoder |
| `serialization/csv.py` | `_csv_cy.pyx` | `decode_csv_for`, `encode_csv_for` — CSV row parsing and struct construction |

### Key Conventions

- cdef classes (`CyEastStruct`, `CyEastVariant`) must have `__class_getitem__` for generic subscripting
- Use `cpdef` for functions callable from both Python and Cython closures
- Class swaps (e.g. `EastStruct = CyEastStruct`) happen in `values.py` — use `is_east_struct()`/`is_east_variant()` instead of `isinstance()` checks
- `make build-cython` rebuilds extensions during development without reinstalling

## Type Checking Configuration

mypy is configured for gradual typing (`disallow_untyped_defs = false`) because East is dynamically typed. Several error codes are disabled to accommodate runtime type flexibility. See pyproject.toml for details.

## Testing Patterns

- Use `pytest` with verbose output
- Tests are organized by module: `tests/builtins/`, `tests/types/`, `tests/serialization/`, etc.
- Coverage target: 84% (current)
- Run specific tests with `-k` keyword matching or by specifying test file/function paths
