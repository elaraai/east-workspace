# Design Document: Porting Generic Platform Functions to east-py

**Source:** TypeScript commits `581d0e4` → `484cf70` in `/home/crambelsoupy/src/east`
**Target:** Python package `east-py` at `/home/crambelsoupy/src/east-py/packages/east-py`

---

## 1. Overview

This document describes how to port generic (polymorphic) platform functions from the TypeScript East implementation to the Python east-py runtime. Generic platform functions allow platform authors to define type-parameterized functions similar to how builtins work.

### What Changed in TypeScript

| Component | Change | Port to Python? |
|-----------|--------|-----------------|
| `PlatformIR` | Added `type_parameters: EastTypeValue[]` field | Yes |
| `PlatformFunction` | Added `type_parameters`, `inputsFn`, `outputsFn` fields | Partially (only `type_parameters` needed) |
| `compile.ts` | Extended to call factory functions for generic platforms | Yes |
| `analyze.ts` | Extended to validate generic platform functions | No (IR already validated) |
| `block.ts` | Added `genericPlatform()` and `asyncGenericPlatform()` helpers | No (TypeScript API only) |

### Benefits

- Define a single platform function that works with any type (e.g., generic `log`, `serialize`, `cache`)
- Type parameters flow through to the implementation at runtime
- Enables type-dependent behavior in platform implementations (e.g., `printFor(T)`)
- Eliminates placeholder type hacks in Python implementations

---

## 1.1 Motivating Example: ALNS

The ALNS (Adaptive Large Neighborhood Search) implementation shows why this is needed.

### Current Hack - TypeScript (`east-py-datascience/src/alns/alns.ts`)

```typescript
// Creates a NEW platform function for each solution type!
export const alns_optimize = <S extends EastType>(solutionType: S) =>
    East.platform(
        "alns_optimize",
        [
            solutionType,                                           // initial_solution: S
            FunctionType([solutionType], FloatType),                // objective: S -> Float
            ArrayType(FunctionType([solutionType], solutionType)),  // destroy_operators
            ArrayType(FunctionType([solutionType], solutionType)),  // repair_operators
            ALNSConfigType,
        ],
        ALNSResultType(solutionType)
    );

// Usage - each call creates a different platform definition
ALNS.optimize(MySolutionType)(initial, objective, destroys, repairs, config)
ALNS.optimize(OtherSolutionType)(initial2, objective2, ...)  // Different platform!
```

### Current Hack - Python (`east-py-datascience/src/east_py_datascience/alns/alns.py`)

```python
# HACK: Use empty struct as placeholder since we don't know the actual type
_GenericSolutionType = StructType([])  # Wrong! Doesn't match actual types
_GenericObjectiveType = FunctionType([_GenericSolutionType], FloatType)
_GenericOperatorType = FunctionType([_GenericSolutionType], _GenericSolutionType)

alns_impl = [
    PlatformFunction(
        name="alns_optimize",
        inputs=[
            _GenericSolutionType,           # Placeholder - actual type unknown
            _GenericObjectiveType,          # Placeholder
            ArrayType(_GenericOperatorType),
            ArrayType(_GenericOperatorType),
            ALNSConfigType,
        ],
        output=ALNSResultType(_GenericSolutionType),  # Placeholder
        type="sync",
        fn=alns_optimize,
    ),
]
```

**Problems with current approach:**
1. TypeScript creates a new platform definition for each type instantiation
2. Python has no idea what the actual solution type is
3. Type validation is completely bypassed (relies on dynamic typing)
4. If Python needed type-dependent behavior, it would be impossible

### After - TypeScript with `genericPlatform`

```typescript
export const alns_optimize = East.genericPlatform(
    "alns_optimize",
    ["S"],  // Single type parameter
    [
        "S",                                 // initial_solution: S (string placeholder)
        FunctionType(["S"], FloatType),      // objective: S -> Float
        ArrayType(FunctionType(["S"], "S")), // destroy_operators: Array<S -> S>
        ArrayType(FunctionType(["S"], "S")), // repair_operators: Array<S -> S>
        ALNSConfigType,
    ],
    StructType({                             // Result with S substituted
        best_solution: "S",
        best_objective: FloatType,
        iterations: IntegerType,
        runtime: FloatType,
        success: BooleanType,
    })
);

// Usage - type args as array, then value args
// All calls use the SAME platform function with different type parameters
alns_optimize([MySolutionType], initial, objective, destroys, repairs, config)
alns_optimize([OtherSolutionType], initial2, objective2, ...)  // Same platform!
```

**Generated IR includes the type parameter:**
```json
{
  "type": "Platform",
  "value": {
    "name": "alns_optimize",
    "type_parameters": [{ "type": "Struct", "fields": { "x": { "type": "Float" }, ... } }],
    "arguments": [...],
    ...
  }
}
```

### After - Python with Generic Platform Function

```python
alns_impl = [
    GenericPlatformFunction(
        name="alns_optimize",
        type_parameters=["S"],
        type="sync",
        fn=lambda S: alns_optimize,
    ),
]
```

**Key improvements:**
1. Single platform function definition works for all types
2. Python receives the actual type `S` at compile time (if needed)
3. No more placeholder type hacks
4. Type-dependent behavior is possible if needed (e.g., `fn=lambda S: make_impl(S)`)

---

## 2. TypeScript Changes Summary

### 2.1 IR Type Definition (`src/ir.ts`)

```typescript
// Before
Platform: StructType({ type: EastTypeType, location: LocationType, name: StringType,
                       arguments: ArrayType(ir), async: BooleanType })

// After
Platform: StructType({ type: EastTypeType, location: LocationType, name: StringType,
                       type_parameters: ArrayType(EastTypeType),  // NEW
                       arguments: ArrayType(ir), async: BooleanType })
```

### 2.2 Platform Function Definition (`src/platform.ts`)

```typescript
export type PlatformFunction = {
    name: string;
    inputs: EastTypeValue[];
    output: EastTypeValue;
    type: 'sync' | 'async';
    fn: (...args: any) => any;
    // NEW: Generic platform function fields
    type_parameters?: string[];
    inputsFn?: (...typeParams: EastTypeValue[]) => EastTypeValue[];  // For analysis only
    outputsFn?: (...typeParams: EastTypeValue[]) => EastTypeValue;   // For analysis only
}
```

**Note:** `inputsFn` and `outputsFn` are only used for TypeScript analysis/validation. Since Python assumes IR is already validated, we don't need these fields - just `type_parameters` to identify generic functions.

### 2.3 Compilation Changes (`src/compile.ts`)

- For generic platform functions, calls `platformFn.fn(...typeParams)` to get the actual evaluator
- For non-generic platform functions, uses the direct `platform[name]` lookup (backwards compatible)

---

## 3. Python Implementation Tasks

### 3.1 Update `east/types/ir.py` - Add type_parameters to PlatformIRValue

```python
class PlatformIRValue(TypedDict):
    """Value inside Platform IR variant."""

    type: EastTypeValue
    location: LocationValue
    name: str
    type_parameters: list[EastTypeValue]  # NEW
    arguments: list[IR]
    async_: bool
```

### 3.2 Update `east/runtime/platform.py` - Add GenericPlatformFunction

```python
from collections.abc import Callable
from typing import Any, Literal, TypedDict

from east.types.types import EastType


class PlatformFunction(TypedDict):
    """Non-generic platform function. Unchanged from before."""

    name: str
    inputs: list[EastType]
    output: EastType
    type: Literal["sync", "async"]
    fn: Callable[..., Any]  # fn(*args) -> result


class GenericPlatformFunction(TypedDict):
    """Generic platform function with type parameters.

    The `fn` field is a factory that receives type arguments and returns
    the actual implementation.
    """

    name: str
    """The name of the platform function (must match Platform IR node name)"""

    type_parameters: list[str]
    """Type parameter names (e.g., ["S", "T"])"""

    type: Literal["sync", "async"]
    """Whether the function is synchronous or asynchronous"""

    fn: Callable[..., Callable[..., Any]]
    """Factory: fn(*type_params) -> impl where impl(*args) -> result"""
```

### 3.3 Update `east/runtime/compiler.py` - Handle Generic Platform Functions

Modify `_compile_platform` to handle generic platform functions:

```python
def _compile_platform(
    node: IR,
    platform_fns: dict[str, Callable[..., Any]],
    async_platform_fns: set[str],
    platform_list: list[PlatformFunction | GenericPlatformFunction],
) -> tuple[Callable, bool]:
    """Compile a Platform IR node (platform function call)."""
    platform_struct = node["value"]
    platform_name = platform_struct["name"]
    ir_location = platform_struct["location"]

    # Get type parameters from IR (empty list for non-generic)
    type_params = platform_struct.get("type_parameters", [])

    # Look up platform function definition
    platform_def = next((p for p in platform_list if p["name"] == platform_name), None)

    # Get evaluator
    if type_params and platform_def and "type_parameters" in platform_def:
        # Generic: fn is a factory, call it with type params to get impl
        evaluator = platform_def["fn"](*type_params)
    else:
        # Non-generic: use platform map directly
        if platform_name not in platform_fns:
            raise ValueError(f"Platform function '{platform_name}' not found")
        evaluator = platform_fns[platform_name]

    # ... rest of compilation unchanged, uses `evaluator`
```

### 3.4 Update IR Builder - `east/ir/builders.py`

```python
def ir_platform(
    typ: EastTypeValue,
    loc: LocationValue,
    platform_name: str,
    arguments: list[IR],
    async_: bool = False,
    type_parameters: list[EastTypeValue] | None = None,  # NEW
) -> IR:
    """Create a Platform IR node."""
    from east.types.values import EastArray, EastVariant
    from east.types.type_of_type import EastTypeType

    args_array: EastArray = EastArray(IRType, arguments)
    type_params_array: EastArray = EastArray(
        EastTypeType,
        type_parameters if type_parameters else []
    )

    platform_struct = {
        "type": typ,
        "location": loc,
        "name": platform_name,
        "type_parameters": type_params_array,  # NEW
        "arguments": args_array,
        "async": async_,
    }
    return EastVariant("Platform", platform_struct)
```

---

## 4. Serialization Compatibility

The Platform IR node serialization format changes to include `type_parameters`:

**Before (JSON):**
```json
{
  "type": "Platform",
  "value": {
    "type": { "type": "Null" },
    "location": { "filename": "test.ts", "line": 10, "column": 5 },
    "name": "log",
    "arguments": [...],
    "async": false
  }
}
```

**After (JSON):**
```json
{
  "type": "Platform",
  "value": {
    "type": { "type": "Null" },
    "location": { "filename": "test.ts", "line": 10, "column": 5 },
    "name": "log",
    "type_parameters": [{ "type": "String" }],
    "arguments": [...],
    "async": false
  }
}
```

### Backwards Compatibility

- Old IR without `type_parameters` should work (default to empty list)
- Use `platform_struct.get("type_parameters", [])` in compiler

---

## 5. Example Usage: ALNS

### 5.1 TypeScript Definition (`east-py-datascience/src/alns/alns.ts`)

```typescript
import { East, StructType, ArrayType, FunctionType, FloatType, IntegerType, BooleanType } from "@elaraai/east";

export const alns_optimize = East.genericPlatform(
    "alns_optimize",
    ["S"],  // Type parameter for solution type
    [
        "S",                                 // initial_solution: S
        FunctionType(["S"], FloatType),      // objective: S -> Float
        ArrayType(FunctionType(["S"], "S")), // destroy_operators: Array<S -> S>
        ArrayType(FunctionType(["S"], "S")), // repair_operators: Array<S -> S>
        ALNSConfigType,
    ],
    StructType({
        best_solution: "S",
        best_objective: FloatType,
        iterations: IntegerType,
        runtime: FloatType,
        success: BooleanType,
    })
);

// Usage in East code:
alns_optimize([MySolutionType], initial, objective, destroyOps, repairOps, config)
```

### 5.2 Python Definition (`east-py-datascience/src/east_py_datascience/alns/alns.py`)

```python
alns_impl = [
    GenericPlatformFunction(
        name="alns_optimize",
        type_parameters=["S"],
        type="sync",
        fn=lambda S: alns_optimize,
    ),
]
```

That's it. The factory receives type parameters and returns the implementation. Since ALNS doesn't need type-dependent behavior, it just ignores `S` and returns the existing impl.

### 5.3 Generated IR

When TypeScript compiles `alns_optimize([MySolutionType], ...)`:

```json
{
  "type": "Platform",
  "value": {
    "name": "alns_optimize",
    "type_parameters": [{ "type": "Struct", "fields": { "x": { "type": "Float" }, "y": { "type": "Float" } } }],
    "arguments": [...],
    "type": { "type": "Struct", "fields": { "best_solution": ..., "best_objective": ..., ... } },
    "async": false
  }
}
```

### 5.4 At Compile Time (Python)

1. Compiler sees `type_parameters = [{ "type": "Struct", "fields": {...} }]`
2. Looks up platform definition, finds `type_parameters = ["S"]`
3. Calls `fn(S)` which returns `alns_optimize`
4. Uses that evaluator for the call with the value arguments

---

## 6. Implementation Order

1. **Phase 1: IR Type Update**
   - [ ] Update `PlatformIRValue` in `east/types/ir.py` to add `type_parameters`
   - [ ] Update `ir_platform` builder in `east/ir/builders.py`

2. **Phase 2: Platform Function Definition Update**
   - [ ] Add `GenericPlatformFunction` TypedDict to `east/runtime/platform.py`

3. **Phase 3: Compiler Update**
   - [ ] Modify `_compile_platform` in `east/runtime/compiler.py`
   - [ ] Handle factory pattern for generic platform functions
   - [ ] Maintain backwards compatibility for non-generic functions

**Note:** No analysis module or separate tests needed. IR is already validated by TypeScript, and compliance tests will automatically cover this.

---

## 7. Validation Checklist

- [ ] `PlatformIRValue` includes `type_parameters: list[EastTypeValue]`
- [ ] `GenericPlatformFunction` TypedDict added to `east/runtime/platform.py`
- [ ] Compiler calls `fn(*type_params)` for `GenericPlatformFunction`
- [ ] Non-generic `PlatformFunction` continues to work (backwards compatible)
- [ ] IR deserialization handles `type_parameters` field
- [ ] Empty `type_parameters` defaults correctly for old IR
- [ ] Async generic platform functions work correctly

---

## 8. TypeScript Reference Files

For implementation reference, see:

- `src/ir.ts:265-269` - PlatformIR type definition
- `src/platform.ts:18-28` - PlatformFunction type with generic fields
- `src/compile.ts:1091-1119` - Generic platform compilation
- `src/expr/block.ts:1246-1538` - genericPlatform/asyncGenericPlatform helpers (TypeScript API, not needed in Python)
- `src/platform.spec.ts` - Test cases for generic platform functions
