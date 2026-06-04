# Design Document: Porting the Patch System to east-py

**Source:** TypeScript commits `bcf9d20` → `93c1c0b` in `/home/crambelsoupy/src/east`
**Target:** Python package `east-py` at `/home/crambelsoupy/src/east-py/packages/east-py`

---

## 1. Overview

This document describes how to port the TypeScript patch system to the Python east-py runtime. The patch system provides four operations for computing and applying differences between East values:

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `diff_for(type)` | `(before, after) → patch` | Compute difference |
| `apply_for(type)` | `(base, patch) → value` | Apply patch |
| `compose_for(type)` | `(first, second) → combined` | Combine patches |
| `invert_for(type)` | `(patch) → inverse` | Reverse patch |

---

## 2. File Structure

Create a new `east/patch/` module mirroring the TypeScript structure:

```
east/
├── patch/
│   ├── __init__.py          # Module exports
│   ├── types.py              # Context classes, ConflictError, LCS algorithm
│   ├── diff.py               # diff_for implementation
│   ├── apply.py              # apply_for implementation
│   ├── compose.py            # compose_for implementation
│   ├── invert.py             # invert_for implementation
│   └── type_of_patch.py      # PatchType constructor
├── builtins/
│   └── patch.py              # NEW: Register Diff, ApplyPatch, etc.
└── ...
```

---

## 3. Implementation Tasks

### 3.1 Create `east/patch/types.py`

Define context classes and utilities following the pattern in `east/utils/ordering.py`:

```python
"""Patch system types and utilities."""

from dataclasses import dataclass, field
from typing import Any, Callable

from east.types.types import EastType


class ConflictError(Exception):
    """Raised when patch operations encounter conflicts."""
    pass


@dataclass
class DiffContext:
    """Context for building diff handlers with recursive type support."""
    diff: list[Callable[[Any, Any], Any]] = field(default_factory=list)
    types: list[EastType] = field(default_factory=list)
    equal: list[Callable[[Any, Any], bool]] = field(default_factory=list)


@dataclass
class ApplyContext:
    """Context for building apply handlers with recursive type support."""
    apply: list[Callable[[Any, Any], Any]] = field(default_factory=list)
    types: list[EastType] = field(default_factory=list)
    equal: list[Callable[[Any, Any], bool]] = field(default_factory=list)
    print: list[Callable[[Any], str]] = field(default_factory=list)


@dataclass
class ComposeContext:
    """Context for building compose handlers with recursive type support."""
    compose: list[Callable[[Any, Any], Any]] = field(default_factory=list)
    apply: list[Callable[[Any, Any], Any]] = field(default_factory=list)
    invert: list[Callable[[Any], Any]] = field(default_factory=list)
    types: list[EastType] = field(default_factory=list)
    equal: list[Callable[[Any, Any], bool]] = field(default_factory=list)
    print: list[Callable[[Any], str]] = field(default_factory=list)


@dataclass
class InvertContext:
    """Context for building invert handlers with recursive type support."""
    invert: list[Callable[[Any], Any]] = field(default_factory=list)
    types: list[EastType] = field(default_factory=list)
    equal: list[Callable[[Any, Any], bool]] = field(default_factory=list)


def compute_lcs(
    before: list,
    after: list,
    equal: Callable[[Any, Any], bool]
) -> tuple[list[int], list[int]]:
    """Compute Longest Common Subsequence indices.

    Returns:
        Tuple of (before_indices, after_indices) for matching elements.
    """
    m, n = len(before), len(after)

    # Build DP table
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if equal(before[i - 1], after[j - 1]):
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    # Backtrack to find indices
    before_indices: list[int] = []
    after_indices: list[int] = []
    i, j = m, n

    while i > 0 and j > 0:
        if equal(before[i - 1], after[j - 1]):
            before_indices.insert(0, i - 1)
            after_indices.insert(0, j - 1)
            i -= 1
            j -= 1
        elif dp[i - 1][j] > dp[i][j - 1]:
            i -= 1
        else:
            j -= 1

    return before_indices, after_indices
```

### 3.2 Create `east/patch/diff.py`

Follow the pattern of `east/utils/ordering.py:equal_for`:

```python
"""diff_for - Compute difference between two East values."""

from typing import Any, Callable

from east.types.types import (
    EastType,
    is_null_type, is_boolean_type, is_integer_type, is_float_type,
    is_string_type, is_datetime_type, is_blob_type, is_array_type,
    is_set_type, is_dict_type, is_struct_type, is_variant_type,
    is_ref_type, is_recursive_type, is_function_type, is_never_type,
)
from east.types.values import EastVariant, EastArray, EastSet, EastDict
from east.utils.ordering import equal_for, is_for, compare_for
from east.patch.types import DiffContext, compute_lcs


def diff_for(
    type_val: EastType,
    ctx: DiffContext | None = None
) -> Callable[[Any, Any], Any]:
    """Create a diff function for a given type.

    Args:
        type_val: The East type to create a diff function for
        ctx: Context for recursive type handling (internal)

    Returns:
        A function (before, after) -> patch
    """
    if ctx is None:
        ctx = DiffContext()

    if is_never_type(type_val):
        def diff_never(_before, _after):
            raise RuntimeError("Cannot diff values of type Never")
        return diff_never

    # Primitives: unchanged or replace
    if (is_null_type(type_val) or is_boolean_type(type_val) or
        is_integer_type(type_val) or is_float_type(type_val) or
        is_string_type(type_val) or is_datetime_type(type_val) or
        is_blob_type(type_val)):

        equal = equal_for(type_val)

        def diff_primitive(before, after):
            if equal(before, after):
                return EastVariant("unchanged", None)
            return EastVariant("replace", {"before": before, "after": after})

        return diff_primitive

    if is_array_type(type_val):
        # ... (see TypeScript implementation for full logic)
        pass

    # ... implement remaining types following TypeScript patterns
```

**Key differences from TypeScript:**

1. Use `EastVariant("unchanged", None)` instead of `variant("unchanged", null)`
2. Use `EastDict` and `EastSet` instead of `SortedMap`/`SortedSet`
3. Access type fields via `type_val["value"]` or `type_val.value` depending on structure
4. Use `equal_for` from `east.utils.ordering` (already exists)

### 3.3 Create `east/patch/apply.py`

```python
"""apply_for - Apply a patch to an East value."""

from typing import Any, Callable

from east.types.types import EastType, is_array_type, ...
from east.types.values import EastVariant, EastArray, EastSet, EastDict, EastStruct
from east.utils.ordering import equal_for, compare_for
from east.serialization.east_printer import print_value  # For error messages
from east.patch.types import ApplyContext, ConflictError


def apply_for(
    type_val: EastType,
    ctx: ApplyContext | None = None
) -> Callable[[Any, Any], Any]:
    """Create an apply function for a given type.

    Args:
        type_val: The East type
        ctx: Context for recursive type handling (internal)

    Returns:
        A function (base, patch) -> patched_value

    Raises:
        ConflictError: If the patch conflicts with the base value
    """
    if ctx is None:
        ctx = ApplyContext()

    # ... implement following TypeScript patterns
```

### 3.4 Create `east/patch/compose.py` and `east/patch/invert.py`

Similar structure to diff and apply.

### 3.5 Create `east/patch/type_of_patch.py`

```python
"""PatchType - Compute the patch type for a given East type."""

from east.types.types import (
    EastType, NullType, IntegerType,
    StructType, VariantType, ArrayType, DictType,
    is_null_type, is_array_type, is_dict_type, is_struct_type,
    is_variant_type, is_ref_type, is_recursive_type,
)


def PatchType(type_val: EastType, ctx: dict | None = None) -> EastType:
    """Construct the patch type for a given East type.

    Args:
        type_val: The East type to compute patch type for
        ctx: Context for caching recursive types

    Returns:
        The patch type (a VariantType with unchanged/replace/patch cases)
    """
    if ctx is None:
        ctx = {}

    # Check cache for recursive types
    type_id = id(type_val)
    if type_id in ctx:
        return ctx[type_id]

    # Primitives: unchanged | replace
    if type_val["type"] in ("Never", "Null", "Boolean", "Integer",
                            "Float", "String", "DateTime", "Blob"):
        return VariantType([
            ("unchanged", NullType),
            ("replace", StructType([
                ("before", type_val),
                ("after", type_val)
            ])),
        ])

    if is_array_type(type_val):
        element_type = type_val["value"]
        element_patch = PatchType(element_type, ctx)
        operation_type = VariantType([
            ("delete", element_type),
            ("insert", element_type),
            ("update", element_patch),
        ])
        entry_type = StructType([
            ("key", IntegerType),
            ("offset", IntegerType),
            ("operation", operation_type),
        ])
        return VariantType([
            ("unchanged", NullType),
            ("replace", StructType([("before", type_val), ("after", type_val)])),
            ("patch", ArrayType(entry_type)),
        ])

    # ... implement remaining types
```

### 3.6 Create `east/builtins/patch.py`

Register the builtins following the pattern in `east/builtins/comparison.py`:

```python
"""Patch builtin functions."""

from typing import TYPE_CHECKING, Callable, Any

if TYPE_CHECKING:
    from east.runtime.platform import PlatformFunction

from east.builtins.registry import register_builtin
from east.runtime.compiler import EastError
from east.types.types import EastType
from east.patch.diff import diff_for
from east.patch.apply import apply_for
from east.patch.compose import compose_for
from east.patch.invert import invert_for
from east.patch.types import ConflictError


def _diff(
    _platform: "list[PlatformFunction]",
    T: EastType,
    _P: EastType,  # PatchType - computed by caller
) -> Callable[[Any, Any], Any]:
    """Factory for diff operation."""
    return diff_for(T)


def _apply_patch(
    _platform: "list[PlatformFunction]",
    T: EastType,
    _P: EastType,
) -> Callable[[Any, Any], Any]:
    """Factory for apply operation with error wrapping."""
    apply_fn = apply_for(T)

    def apply_with_error(base: Any, patch: Any) -> Any:
        try:
            return apply_fn(base, patch)
        except ConflictError as e:
            # Note: Location is added by the compiler's builtin handler
            raise EastError(str(e), {"filename": "", "line": 0, "column": 0})

    return apply_with_error


def _compose_patch(
    _platform: "list[PlatformFunction]",
    T: EastType,
    _P: EastType,
) -> Callable[[Any, Any], Any]:
    """Factory for compose operation with error wrapping."""
    compose_fn = compose_for(T)

    def compose_with_error(first: Any, second: Any) -> Any:
        try:
            return compose_fn(first, second)
        except ConflictError as e:
            raise EastError(str(e), {"filename": "", "line": 0, "column": 0})

    return compose_with_error


def _invert_patch(
    _platform: "list[PlatformFunction]",
    T: EastType,
    _P: EastType,
) -> Callable[[Any], Any]:
    """Factory for invert operation."""
    return invert_for(T)


# Register builtins
register_builtin("Diff", _diff)
register_builtin("ApplyPatch", _apply_patch)
register_builtin("ComposePatch", _compose_patch)
register_builtin("InvertPatch", _invert_patch)
```

### 3.7 Update `east/builtins/__init__.py`

Add import to ensure patch builtins are registered:

```python
# Add to existing imports
from east.builtins import patch  # noqa: F401 - Import for side effect
```

### 3.8 Update `east/__init__.py`

Export patch module:

```python
# Add to exports
from east.patch import (
    diff_for,
    apply_for,
    compose_for,
    invert_for,
    PatchType,
    ConflictError,
)
```

---

## 4. Key Implementation Details

### 4.1 Context Pattern for Recursive Types

The TypeScript implementation uses arrays of handlers pushed/popped during traversal. Port this directly:

```python
def diff_for(type_val: EastType, ctx: DiffContext | None = None):
    if ctx is None:
        ctx = DiffContext()

    if is_array_type(type_val):
        # Placeholder for forward reference
        ret = None

        def diff_array(before, after):
            # Use closure over `ret`, `element_diff`, etc.
            ...

        ret = diff_array

        # Build context BEFORE recursing
        array_equal = equal_for(type_val, ctx.equal)
        ctx.diff.append(ret)
        ctx.types.append(type_val)
        ctx.equal.append(array_equal)

        # Now recurse into element type
        element_diff = diff_for(type_val["value"], ctx)

        # Pop after recursion
        ctx.diff.pop()
        ctx.types.pop()
        ctx.equal.pop()

        return ret
```

### 4.2 Variant Construction

Use `EastVariant` from `east.types.values`:

```python
from east.types.values import EastVariant, EastStruct

# Patch cases
unchanged = EastVariant("unchanged", None)
replace = EastVariant("replace", EastStruct({"before": before, "after": after}))
patch = EastVariant("patch", operations)
```

### 4.3 Collection Types

Use the East collection types:

| TypeScript | Python |
|------------|--------|
| `SortedMap` | `EastDict` |
| `SortedSet` | `EastSet` |
| `[]` (array) | `EastArray` |

```python
from east.types.values import EastDict, EastSet, EastArray

# Creating a new dict for patch operations
operations = EastDict(key_type, operation_type)
operations[key] = EastVariant("delete", value)
```

### 4.4 Error Messages

Use `print_value` from serialization for error messages:

```python
from east.serialization.east_printer import print_value

def apply_primitive(base, patch):
    if patch["type"] == "replace":
        if not equal(base, patch["value"]["before"]):
            raise ConflictError(
                f"Cannot apply replace - expected {print_value(patch['value']['before'], type_val)}, "
                f"found {print_value(base, type_val)}"
            )
        return patch["value"]["after"]
```

### 4.5 Type Checking

Use the type predicates from `east.types.types`:

```python
from east.types.types import (
    is_array_type,
    is_dict_type,
    is_struct_type,
    # etc.
)

if is_array_type(type_val):
    element_type = type_val["value"]  # Access element type
```

---

## 5. Testing Strategy

Tests are validated via the compliance test infrastructure in `tests/test_compliance.py`, which runs IR exported from TypeScript tests through the Python runtime.

**To run patch tests after implementation:**

```bash
# In the TypeScript east repo, export test IR:
cd /home/crambelsoupy/src/east && npm run test:export

# Run compliance tests in east-py:
cd /home/crambelsoupy/src/east-py/packages/east-py
uv run pytest tests/test_compliance.py -v -k "patch"
```

The TypeScript `test/patch.spec.ts` (1,887 lines) uses `describeEast` which exports IR to `/tmp/east-test-ir/`. The Python compliance runner loads these IR files and executes them against the Python runtime, validating:

- All primitive type patches
- Array LCS diffing with offset tracking
- Set/Dict key operations
- Struct field patches
- Variant case handling
- Recursive type replace semantics
- Conflict error scenarios
- Algebraic properties (roundtrip, invert, compose)

No separate Python test files need to be written.

---

## 6. Implementation Order

1. **Phase 1: Core Types**
   - [ ] `east/patch/types.py` - Context classes, ConflictError, LCS
   - [ ] `east/patch/__init__.py` - Module exports

2. **Phase 2: Diff Operation**
   - [ ] `east/patch/diff.py` - Start with primitives, then collections

3. **Phase 3: Apply Operation**
   - [ ] `east/patch/apply.py`

4. **Phase 4: Invert and Compose**
   - [ ] `east/patch/invert.py`
   - [ ] `east/patch/compose.py`

5. **Phase 5: Type Constructor**
   - [ ] `east/patch/type_of_patch.py`

6. **Phase 6: Builtin Registration**
   - [ ] `east/builtins/patch.py`
   - [ ] Update `east/builtins/__init__.py`
   - [ ] Update `east/__init__.py`

7. **Phase 7: Compliance Validation**
   - [ ] Export IR from TypeScript: `npm run test:export`
   - [ ] Run: `uv run pytest tests/test_compliance.py -v -k "patch"`

---

## 7. Validation Checklist

- [ ] All primitive types: Null, Boolean, Integer, Float, String, DateTime, Blob
- [ ] Array with LCS-based diffing and correct offset tracking
- [ ] Set with key-based insert/delete operations
- [ ] Dict with key-based insert/delete/update operations
- [ ] Struct with per-field patches
- [ ] Variant with same-case patch vs cross-case replace
- [ ] Ref with inner value patching
- [ ] Recursive types with replace-only semantics
- [ ] Function types with replace-only semantics
- [ ] ConflictError raised for all conflict scenarios
- [ ] Normalization: empty patches collapse to unchanged
- [ ] All algebraic properties hold
