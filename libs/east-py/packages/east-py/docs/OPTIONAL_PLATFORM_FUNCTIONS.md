# Design Document: Optional Platform Functions

**Source:** TypeScript commits `a2b652b8` → `10be69ca` in `/home/crambelsoupy/src/east`
**Target:** Python package `east-py` at `/home/crambelsoupy/src/east-py/packages/east-py`

---

## 1. Overview

This document describes how to port the optional platform functions feature to the Python east-py runtime. The feature allows platform function calls to be marked as optional, enabling compilation to succeed even when the platform function implementation is not provided. If an optional platform function is called at runtime without an implementation, it throws an error.

| Component | Current Python | Required Change |
|-----------|----------------|-----------------|
| `PlatformIRValue` | Has `async_: bool` | Add `optional: bool` field |
| `_compile_platform` | Throws on missing platform | Create runtime error stub for optional missing platforms |
| `PlatformFunction` | No optional field | No change needed (IR-only feature) |

---

## 2. Problem Statement

### Current Limitation in Python

The Python compiler (`east/runtime/compiler.py:828-834`) throws at compile time when a platform function is not found:

```python
# Non-generic: use platform map directly
if platform_name not in platform_fns:
    raise ValueError(
        f"Platform function '{platform_name}' not found. "
        f"Available platform functions: {', '.join(platform_fns.keys())}"
    )
```

This is problematic because:

1. **Partial compilation**: Users cannot compile IR that references platform functions that aren't available in the current environment
2. **Conditional usage**: Code paths that don't use certain platform functions still fail compilation
3. **Cross-environment portability**: IR serialized from TypeScript with optional platforms cannot be compiled in Python without all implementations

---

## 3. Design Decisions

### 3.1 Per-Platform Optionality (IR-level)

The optionality is stored per-platform in the IR, not as a compile-time option. This makes the optionality transportable across different runtimes.

```python
# Platform IR node with optional flag
platform_node = {
    "type": "Platform",
    "value": {
        "name": "analytics",
        "arguments": [...],
        "async": False,
        "optional": True,  # NEW: Compilation succeeds even without implementation
    }
}
```

### 3.2 Runtime Error Stubs

When a platform function is marked as optional but no implementation is provided, the compiler creates a stub function that throws an `EastError` at runtime:

```python
def missing_platform_stub(*args):
    raise EastError(
        f"Platform function '{name}' is not available",
        ir_location  # EastArray of location structs from Platform IR node
    )
```

**Error message format** (must match TypeScript exactly):
- Message: `Platform function '{name}' is not available`
- Location: The `location` field from the Platform IR node (EastArray of `{filename, line, column}` structs)

TypeScript equivalent:
```typescript
throw new EastError(`Platform function '${name}' is not available`, { location });
```

This allows:
- Compilation to succeed
- Code paths that don't call the missing function to work normally
- Clear error messages with source locations when the missing function is actually called

### 3.3 No Python API Changes

Unlike TypeScript, east-py does not have functions like `East.platform()` to define platform functions. Platform functions are defined directly as Python dicts. The `optional` flag is only read from IR - it's set by TypeScript when generating the IR.

---

## 4. Implementation Details

### 4.1 Changes to `east/types/ir.py`

**Update `PlatformIRValue` TypedDict (lines 363-371):**

```python
class PlatformIRValue(TypedDict):
    """Value inside Platform IR variant."""

    type: EastTypeValue
    location: EastArray
    name: str
    type_parameters: list[EastTypeValue]
    arguments: list[IR]
    async_: bool  # Named async_ to avoid keyword conflict; serialized as "async"
    optional: bool  # NEW: When true, compilation succeeds without implementation
```

### 4.2 Changes to `east/runtime/compiler.py`

**Modify `_compile_platform` (lines 805-892):**

The function needs to handle three cases:
1. Platform found - use it (current behavior)
2. Platform missing, not optional - throw at compile time (current behavior)
3. Platform missing, optional - create runtime error stub (NEW)

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
    is_optional = platform_struct["optional"]  # Required field in IR

    # Get type parameters from IR
    type_params = list(platform_struct.get("type_parameters", []))

    # Look up platform function definition
    platform_def = next((p for p in platform_list if p["name"] == platform_name), None)

    # Determine the evaluator
    platform_fn = None

    if type_params and platform_def and "type_parameters" in platform_def:
        # Generic: fn is a factory, call it with type params to get impl
        if platform_def["fn"]:
            platform_fn = platform_def["fn"](*type_params)
        elif not is_optional:
            raise ValueError(
                f"Generic platform function '{platform_name}' has no implementation"
            )
    else:
        # Non-generic: use platform map directly
        if platform_name in platform_fns:
            platform_fn = platform_fns[platform_name]
        elif not is_optional:
            raise ValueError(
                f"Platform function '{platform_name}' not found. "
                f"Available platform functions: {', '.join(platform_fns.keys())}"
            )

    # NEW: Create runtime error stub for missing optional platforms
    if platform_fn is None:
        def missing_platform_stub(*args):
            raise EastError(
                f"Platform function '{platform_name}' is not available",
                ir_location
            )
        platform_fn = missing_platform_stub

    # Rest of function unchanged - compile arguments and create evaluator
    # ...
```

### 4.3 Full `_compile_platform` Implementation

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
    is_optional = platform_struct["optional"]

    # Get type parameters from IR (empty list for non-generic, for backwards compat)
    type_params = list(platform_struct.get("type_parameters", []))

    # Look up platform function definition
    platform_def = next((p for p in platform_list if p["name"] == platform_name), None)

    # Determine the evaluator
    platform_fn = None

    if type_params and platform_def and "type_parameters" in platform_def:
        # Generic: fn is a factory, call it with type params to get impl
        if platform_def.get("fn"):
            platform_fn = platform_def["fn"](*type_params)
        elif not is_optional:
            raise ValueError(
                f"Generic platform function '{platform_name}' has no implementation"
            )
    else:
        # Non-generic: use platform map directly
        if platform_name in platform_fns:
            platform_fn = platform_fns[platform_name]
        elif not is_optional:
            raise ValueError(
                f"Platform function '{platform_name}' not found. "
                f"Available platform functions: {', '.join(platform_fns.keys())}"
            )

    # Create runtime error stub for missing optional platforms
    # NOTE: Error message must match TypeScript exactly:
    #   TypeScript: throw new EastError(`Platform function '${name}' is not available`, { location });
    #   Python:     raise EastError(f"Platform function '{name}' is not available", location)
    if platform_fn is None:
        def make_missing_stub():
            # Capture name and location in closure
            captured_name = platform_name
            captured_location = ir_location  # EastArray from platform_struct["location"]

            def missing_platform_stub(*args):
                raise EastError(
                    f"Platform function '{captured_name}' is not available",
                    captured_location
                )
            return missing_platform_stub

        platform_fn = make_missing_stub()

    # Use the async field from the IR node
    is_async_fn = platform_struct.get("async", platform_name in async_platform_fns)

    # Compile arguments
    arg_info = []
    any_arg_async = False
    for arg in platform_struct["arguments"]:
        arg_fn, arg_is_async = _compile_ir(arg, platform_fns, async_platform_fns, platform_list)
        arg_info.append((arg_fn, arg_is_async))
        if arg_is_async:
            any_arg_async = True

    if is_async_fn or any_arg_async:
        async def call_platform_async(env):
            args = []
            for arg_fn, arg_is_async in arg_info:
                if isinstance(arg_fn, FunctionFactory):
                    arg = arg_fn.make(env)
                elif arg_is_async:
                    arg = await arg_fn(env)
                else:
                    arg = arg_fn(env)
                if isinstance(arg, FunctionFactory):
                    arg = arg.make(env)
                args.append(arg)

            try:
                if is_async_fn:
                    return await platform_fn(*args)
                return platform_fn(*args)
            except EastError as e:
                e.location.extend(ir_location)
                raise
            except Exception as e:
                raise _wrap_exception_with_location(e, ir_location) from e

        return call_platform_async, True

    def call_platform_sync(env):
        args = []
        for arg_fn, _ in arg_info:
            if isinstance(arg_fn, FunctionFactory):
                arg = arg_fn.make(env)
            else:
                arg = arg_fn(env)
                if isinstance(arg, FunctionFactory):
                    arg = arg.make(env)
            args.append(arg)
        try:
            return platform_fn(*args)
        except EastError as e:
            e.location.extend(ir_location)
            raise
        except Exception as e:
            raise _wrap_exception_with_location(e, ir_location) from e

    return call_platform_sync, False
```

---

## 5. Behavior Examples

### 5.1 Required Platform (default) - Missing

```python
# IR with required platform (optional: False)
ir = variant("Platform", {
    "name": "log",
    "arguments": [...],
    "async": False,
    "optional": False,  # Required field - always present
})

# Compile without providing implementation
compile(ir, platform=[])
# Raises: ValueError("Platform function 'log' not found...")
```

### 5.2 Optional Platform - Missing

```python
# IR with optional platform
ir = variant("Platform", {
    "name": "analytics",
    "arguments": [...],
    "async": False,
    "optional": True,
})

# Compile without providing implementation - SUCCEEDS
fn = compile(function_ir, platform=[])

# Calling code path that uses analytics - THROWS at runtime
fn()
# Raises: EastError("Platform function 'analytics' is not available", location)
```

### 5.3 Optional Platform - Code Path Not Taken

```python
# IR: if (condition) { analytics(data) } else { return data }
# analytics is optional

fn = compile(function_ir, platform=[])

# If condition is false, analytics is never called - WORKS
result = fn(data, condition=False)  # Returns data successfully
```

### 5.4 Optional Platform - Provided

```python
# IR with optional platform
ir = variant("Platform", {
    "name": "analytics",
    "arguments": [...],
    "async": False,
    "optional": True,
})

# Compile WITH implementation - works like normal platform
fn = compile(function_ir, platform=[
    {"name": "analytics", "fn": my_analytics_impl, ...}
])

fn()  # Calls my_analytics_impl successfully
```

---

## 6. Wire Format Compatibility

### IR Serialization

The `optional` field is part of the Platform IR node and is serialized/deserialized with standard East value serialization. The IRType in TypeScript has been updated:

```typescript
// TypeScript IRType definition
Platform: StructType({
  type: EastTypeType,
  location: ArrayType(LocationType),
  name: StringType,
  type_parameters: ArrayType(EastTypeType),
  arguments: ArrayType(ir),
  async: BooleanType,
  optional: BooleanType,  // NEW
})
```

Python's beast2 deserializer will automatically handle this when deserializing IR from TypeScript, as it uses type-driven deserialization.

### Type Alignment

The `optional` field is a **required boolean** in the Platform IR struct type, matching TypeScript exactly:

```typescript
// TypeScript IRType
Platform: StructType({ ..., optional: BooleanType })
```

```python
# Python PlatformIRValue
class PlatformIRValue(TypedDict):
    ...
    optional: bool  # Required field, not Optional[bool]
```

Access directly as `platform_struct["optional"]` - no default needed since the field is always present in valid IR.

---

## 7. File Changes Summary

| File | Change |
|------|--------|
| `east/types/ir.py:363-371` | Add `optional: bool` to `PlatformIRValue` TypedDict |
| `east/runtime/compiler.py:805-892` | Modify `_compile_platform` to create runtime stubs for optional missing platforms |

---

## 8. Implementation Tasks

### Phase 1: IR Type Update

- [ ] Add `optional: bool` field to `PlatformIRValue` TypedDict
- [ ] Update docstring to explain the field's purpose

### Phase 2: Compiler Changes

- [ ] Read `optional` flag directly from Platform IR node (`platform_struct["optional"]`)
- [ ] For `optional: False` (required) missing platforms: keep existing compile-time error
- [ ] For `optional: True` missing platforms: create runtime error stub instead of throwing
- [ ] Ensure stub raises `EastError` with:
  - Message: `Platform function '{name}' is not available` (must match TypeScript exactly)
  - Location: `platform_struct["location"]` (EastArray from IR node)

### Phase 3: Testing

- [ ] Add test: required platform missing throws at compile time
- [ ] Add test: optional platform missing compiles successfully
- [ ] Add test: calling missing optional platform throws at runtime
- [ ] Add test: code path not using missing optional platform works
- [ ] Add test: optional platform with implementation works normally
- [ ] Add test: async optional platform (missing and provided)
- [ ] Add test: generic optional platform (missing and provided)
- [ ] Run compliance tests after TypeScript exports updated IR

---

## 9. TypeScript Reference

The TypeScript implementation uses a `PlatformOptions` interface:

```typescript
interface PlatformOptions {
  /** When true, compilation succeeds even if platform function is not provided. */
  optional?: boolean;
}

// Usage
const analytics = East.platform("analytics", [StringType], NullType, { optional: true });
```

The `optional` flag flows through:
1. `platform()` / `asyncPlatform()` / `genericPlatform()` / `asyncGenericPlatform()` API
2. PlatformAST node
3. `ast_to_ir()` conversion
4. PlatformIR node (what east-py receives)

Python only needs to handle step 4 - reading and acting on the `optional` field in the IR.
