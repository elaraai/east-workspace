# Design Document: Location Stack Traces

**Source:** TypeScript commits `c76eb829` → `f50a8cf8` in `/home/crambelsoupy/src/east`
**Target:** Python package `east-py` at `/home/crambelsoupy/src/east-py/packages/east-py`

**Prerequisite:** This document assumes [FUNCTION_CAPTURES_SERIALIZATION.md](./FUNCTION_CAPTURES_SERIALIZATION.md) has been implemented first.

---

## 1. Overview

This document describes how to port the location stack trace feature to the Python east-py runtime. The feature changes location tracking from a single source location to a full call stack, enabling better error reporting.

| Component | Current Python | Required Change |
|-----------|----------------|-----------------|
| `LocationValue` | `TypedDict` with `filename`, `line`, `column` | No change to type itself |
| `location` field in IR | `LocationValue` (single) | `EastArray` (decoded from `ArrayType(LocationType)`) |
| `EastError.location` | `dict[str, Any]` (single) + `ir_stack` list | `EastArray` only (remove `ir_stack`) |
| `LocationType` | `StructType(...)` | No change |
| IR `location` fields in schema | `LocationType` | `ArrayType(LocationType)` |

---

## 2. Problem Statement

### Current Behavior

When an error occurs in East code, only a single location is captured:

```
test.east:42:15: Division by zero
```

The `EastError` class (`compiler.py:49-80`) already has an `ir_stack` field, but IR locations are single values, not arrays.

### New Behavior

Each IR node's `location` field becomes an array, capturing the full call stack at that point:

```
test.east:42:15: Division by zero
Stack trace:
  at helper.east:20:8
  at main.east:10:4
```

---

## 3. Design Decisions

### 3.1 Location Field Type Change

All `location` fields in IR change from `LocationValue` to `list[LocationValue]`:

```python
# Before (east/types/ir.py)
class ErrorIRValue(TypedDict):
    type: EastTypeValue
    location: LocationValue  # Single location
    message: IR

# After
class ErrorIRValue(TypedDict):
    type: EastTypeValue
    location: list[LocationValue]  # Array of locations
    message: IR
```

### 3.2 EastError Updates

Simplify `EastError` to match TypeScript - just `location` as a list, remove `ir_stack`:

```python
# Before
def __init__(self, message: str, location: dict[str, Any]):
    self.location = location  # Single location
    self.ir_stack = [location]  # Redundant stack

# After
def __init__(self, message: str, location: list[dict[str, Any]]):
    self.location = list(location)  # Just the list, no ir_stack
```

### 3.3 Error Propagation

When errors propagate through call sites, extend the location list:

```python
# Before
e.push_location(ir_location)  # Appends single location to ir_stack

# After
e.location.extend(ir_location)  # Extend location list directly
```

### 3.4 IR Deserialization Produces EastArray

When IR is decoded via BEAST2, the `IRType` schema determines the runtime types:

- `ArrayType(LocationType)` decodes to `EastArray` of `EastStruct`
- So `node["value"]["location"]` will be an `EastArray`, not a plain Python `list`

`EastError.location` should also use `EastArray` for consistency:

```python
# EastError stores the same type as IR
self.location: EastArray  # EastArray of LocationType structs
```

### 3.5 No Analyzer Changes

As with the captures feature, east-py has no analyzer. The location arrays in IR are produced by TypeScript and consumed as-is.

---

## 4. Implementation Details

### 4.1 Changes to `east/types/ir.py`

**Update all IR TypedDicts with `location` field (lines 53-371):**

The TypedDicts are type hints for documentation. At runtime, BEAST2 decodes these as `EastArray`. Update the hints to reflect the array type:

```python
# Change every occurrence of:
location: LocationValue

# To:
location: EastArray  # EastArray of LocationValue structs (decoded from ArrayType(LocationType))
```

**Affected TypedDicts:**
- `ErrorIRValue` (line 57)
- `TryCatchIRValue` (line 65)
- `ValueIRValue` (line 77)
- `VariableIRValue` (line 86)
- `LetIRValue` (line 95)
- `AssignIRValue` (line 103)
- `AsIRValue` (line 112)
- `FunctionIRValue` (line 121)
- `AsyncFunctionIRValue` (line 130)
- `CallIRValue` (line 140)
- `CallAsyncIRValue` (line 149)
- `NewRefIRValue` (line 158)
- `NewArrayIRValue` (line 166)
- `NewSetIRValue` (line 174)
- `NewDictIRValue` (line 189)
- `StructIRValue` (line 204)
- `GetFieldIRValue` (line 213)
- `VariantIRValue` (line 222)
- `BlockIRValue` (line 230)
- `IfElseIRValue` (line 245)
- `MatchIRValue` (line 262)
- `UnwrapRecursiveIRValue` (line 271)
- `WrapRecursiveIRValue` (line 279)
- `WhileIRValue` (line 288)
- `ForArrayIRValue` (line 298)
- `ForSetIRValue` (line 310)
- `ForDictIRValue` (line 321)
- `ReturnIRValue` (line 333)
- `ContinueIRValue` (line 341)
- `BreakIRValue` (line 349)
- `BuiltinIRValue` (line 357)
- `PlatformIRValue` (line 367)

**Update `IRLabelValue` (line 38-42):**

```python
# Before
class IRLabelValue(TypedDict):
    name: str
    location: LocationValue

# After
class IRLabelValue(TypedDict):
    name: str
    location: list[LocationValue]
```

### 4.2 Changes to `east/types/type_of_type.py`

**Update `IRLabelType` (lines 147-152):**

```python
# Before
IRLabelType = StructType(
    [
        ("name", StringType),
        ("location", LocationType),
    ]
)

# After
IRLabelType = StructType(
    [
        ("name", StringType),
        ("location", ArrayType(LocationType)),
    ]
)
```

**Update `IRType` definition (lines 198+):**

Every IR variant that has a `location` field must change from `LocationType` to `ArrayType(LocationType)`:

```python
# Before (in each variant)
("location", LocationType),

# After
("location", ArrayType(LocationType)),
```

### 4.3 Changes to `east/runtime/compiler.py`

**Update `EastError` class (lines 49-80):**

```python
from east.types.values import EastArray

class EastError(Exception):
    """Exception for East errors that preserves IR source locations."""

    def __init__(self, message: str, location: EastArray):
        self.message = message
        self.location = location  # EastArray of LocationType structs
        super().__init__(message)

    def __str__(self) -> str:
        """Format error with location and stack trace."""
        if len(self.location) == 0:
            return self.message

        loc = self.location[0]
        header = f"{loc['filename']}:{loc['line']}:{loc['column']}: {self.message}"

        if len(self.location) <= 1:
            return header

        lines = [header, "Stack trace:"]
        for frame in self.location[1:]:
            lines.append(f"  at {frame['filename']}:{frame['line']}:{frame['column']}")

        return "\n".join(lines)
```

**Update `_wrap_exception_with_location` (lines 83-92):**

```python
def _wrap_exception_with_location(exc: Exception, location: EastArray) -> EastError:
    """Wrap or augment an exception with IR source location."""
    if isinstance(exc, EastError):
        exc.location.extend(location)
        return exc
    return EastError(str(exc), location)
```

**Update all error propagation sites:**

Replace all occurrences of:
```python
e.push_location(ir_location)
```

With:
```python
e.location.extend(ir_location)
```

This affects:
- `_compile_builtin` (lines 528-529)
- `_compile_while` (lines 690-691)
- `_compile_let` (lines 746-747, 760-761)
- `_compile_platform` (lines 832-833)
- `_compile_call` (lines 1134-1135, 1154-1155)
- `_compile_call_async` (lines 1210-1211)
- `_compile_forarray` (lines 1621-1622)
- `_compile_forset` (lines 1726-1727)
- `_compile_fordict` (lines 1832-1833)

### 4.4 Changes to `east/ir/builders.py`

**Update `location` helper (lines 42-53):**

```python
from east.types.values import EastArray
from east.types.type_of_type import LocationType

# Keep original for single location creation
def location(filename: str, line: int, column: int) -> LocationValue:
    return {"filename": filename, "line": line, "column": column}

def location_stack(*locations: tuple[str, int, int]) -> EastArray:
    """Create a location stack (EastArray of locations).

    Args:
        locations: Varargs of (filename, line, column) tuples

    Returns:
        EastArray of LocationValue structs
    """
    return EastArray(LocationType, [location(f, l, c) for f, l, c in locations])
```

**Update all IR builder functions to accept `EastArray`:**

```python
# Before
def ir_value(typ: EastTypeValue, loc: LocationValue, value: Any) -> IR:

# After
def ir_value(typ: EastTypeValue, loc: EastArray, value: Any) -> IR:
```

Affected functions:
- `ir_value` (line 95)
- `ir_variable` (line 115)
- `ir_builtin` (line 140)
- `ir_platform` (line 172)
- `ir_function` (line 209)
- `ir_async_function` (line 241)
- `ir_call_async` (line 273)
- `ir_new_ref` (line 301)
- `ir_block` (line 325)
- `ir_ifelse` (line 346)
- `ir_while` (line 379)
- `ir_trycatch` (line 404)

---

## 5. Wire Format Changes

### Before (Single Location)

```
location: {
  filename: String,
  line: Integer,
  column: Integer,
}
```

### After (Location Array)

```
location: [
  { filename: String, line: Integer, column: Integer },
  { filename: String, line: Integer, column: Integer },
  ...
]
```

This is a **breaking change** to the IR wire format. All serialized IR must be regenerated after TypeScript updates.

---

## 6. File Changes Summary

| File | Line(s) | Change |
|------|---------|--------|
| `east/types/ir.py` | 38-42 | `IRLabelValue.location` → `EastArray` |
| `east/types/ir.py` | 53-371 | All `*IRValue.location` → `EastArray` |
| `east/types/type_of_type.py` | 147-152 | `IRLabelType.location` → `ArrayType(LocationType)` |
| `east/types/type_of_type.py` | 198+ | All IR variant `location` → `ArrayType(LocationType)` |
| `east/runtime/compiler.py` | 49-80 | `EastError`: remove `ir_stack`, `location` becomes `EastArray` |
| `east/runtime/compiler.py` | 83-92 | `_wrap_exception_with_location` takes `EastArray` |
| `east/runtime/compiler.py` | various | Replace `e.push_location(x)` with `e.location.extend(x)` |
| `east/ir/builders.py` | 42-53 | Keep `location`, add `location_stack` helper |
| `east/ir/builders.py` | various | All builders take `EastArray` for location |

---

## 7. Implementation Tasks

### Phase 1: Type Definition Updates

- [ ] Update `IRLabelValue.location` to `EastArray` in `ir.py`
- [ ] Update all IR TypedDict `location` fields to `EastArray`
- [ ] Update `IRLabelType` to use `ArrayType(LocationType)` in `type_of_type.py`
- [ ] Update `IRType` variant definitions to use `ArrayType(LocationType)`

### Phase 2: Error Handling Updates

- [ ] Update `EastError.__init__` to accept `EastArray`
- [ ] Remove `ir_stack` field, use only `location`
- [ ] Replace `push_location` with direct `location.extend()`
- [ ] Update `_wrap_exception_with_location` signature
- [ ] Update all error propagation call sites

### Phase 3: Builder Updates

- [ ] Add `location_stack` helper function that returns `EastArray`
- [ ] Update all IR builder function signatures to take `EastArray`
- [ ] Update tests that use builders

### Phase 4: Testing

- [ ] Run existing tests (expect failures until TypeScript IR regenerated)
- [ ] Regenerate test IR from TypeScript after TS changes
- [ ] Run compliance tests
- [ ] Add specific stack trace tests

---

## 8. Testing Strategy

After implementation:

```bash
# Run tests (may fail until IR regenerated)
uv run pytest tests/ -v

# After TypeScript updates and IR export:
cd /home/crambelsoupy/src/east && npm run test:export
cd /home/crambelsoupy/src/east-py/packages/east-py
uv run pytest tests/test_compliance.py -v

# Test error formatting specifically
uv run pytest tests/ -v -k "error"
```

---

## 9. Example Output

### Before

```
test.east:42:15: Cannot convert NaN to integer
```

### After

```
test.east:42:15: Cannot convert NaN to integer
Stack trace:
  at helper.east:28:12
  at process.east:20:8
  at main.east:10:4
```
