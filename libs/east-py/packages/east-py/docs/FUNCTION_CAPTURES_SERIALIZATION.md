# Design Document: Function Captures Serialization

**Source:** TypeScript commits `74d53385` → `c76eb829` in `/home/crambelsoupy/src/east`
**Target:** Python package `east-py` at `/home/crambelsoupy/src/east-py/packages/east-py`

---

## 1. Overview

This document describes how to port the function captures serialization feature to the Python east-py runtime. The feature enables BEAST2 serialization of closures (functions with captured variables), which is currently forbidden.

| Component | Current Python | Required Change |
|-----------|----------------|-----------------|
| `EAST_IR_ATTR` | `"_east_ir"` (string) | Keep as-is |
| `EAST_CAPTURES_ATTR` | Does not exist | Add `"_east_captures"` |
| `CaptureAwareEnv` | Exists in `compiler.py` | Modify to support capture serialization |

---

## 2. Problem Statement

### Current Limitation in Python

BEAST2 serialization (`east/serialization/beast2.py:325-341`) explicitly rejects functions with captures:

```python
if ir["value"]["captures"]:
    capture_names = [c["value"]["name"] for c in ir["value"]["captures"]]
    raise RuntimeError(
        f"Cannot serialize closure with {len(capture_names)} captured variable(s): "
        f"{', '.join(capture_names)}. "
        "Only free functions (no captures) can be serialized."
    )
```

The limitation exists because:

1. **Missing capture values**: Only `EAST_IR_ATTR` (the IR) is stored on compiled functions. Capture *values* exist only in the Python closure.
2. **Empty context on decode**: `compile(ir, platform)` called with no capture context, so captured variables would raise `KeyError`.

---

## 3. Design Decisions

### 3.1 Capture Storage

Add a new attribute to store capture values alongside IR:

```python
# In east/runtime/compiler.py
EAST_CAPTURES_ATTR = "_east_captures"
```

Capture values are stored as a dict mapping variable names to their values:

```python
# On compiled function
fn._east_ir = original_ir
fn._east_captures = {"x": 42, "y": [1, 2, 3]}  # Captured values
```

### 3.2 Mutable Capture Boxing

When a mutable variable is captured by multiple closures, all must share the same mutable cell. Python already handles this via `CaptureAwareEnv` which delegates to parent environment.

For serialization, we need to track which captures are mutable so we can reconstruct the sharing:

```python
# Capture entry structure for serialization
capture_entry = {
    "value": actual_value,
    "mutable": is_mutable,  # From VariableIR.mutable field
}
```

### 3.3 No Analyzer Changes

Unlike TypeScript, east-py does not have an `analyze.py` module. IR received by east-py is assumed to be already analyzed by TypeScript. The `captured` and `mutable` fields on `VariableIR` nodes are already populated.

---

## 4. Implementation Details

### 4.1 Changes to `east/runtime/compiler.py`

**Add new constant (after line 22):**

```python
EAST_IR_ATTR = "_east_ir"
EAST_CAPTURES_ATTR = "_east_captures"  # NEW
```

**Modify `_compile_function` (lines 325-407):**

```python
def _compile_function(
    node: IR,
    platform_fns: dict[str, Callable[..., Any]],
    async_platform_fns: set[str],
    platform_list: list[PlatformFunction | GenericPlatformFunction],
) -> tuple[Callable, bool]:
    """Compile a Function IR node to a Python callable."""
    func_struct = node["value"]

    # ... existing body compilation code ...

    # Get captured variable info
    capture_vars = func_struct["captures"]
    capture_names = [cap["value"]["name"] for cap in capture_vars]

    # Store original IR for serialization
    original_ir = node

    def make_sync_fn(parent_env):
        # Capture values from parent environment for serialization
        capture_values = {}
        for cap_var in capture_vars:
            name = cap_var["value"]["name"]
            is_mutable = cap_var["value"]["mutable"]
            if name in parent_env:
                capture_values[name] = {
                    "value": parent_env[name],
                    "mutable": is_mutable,
                }

        def compiled_fn_sync(*args):
            # ... existing function body ...
            pass

        # Attach IR and captures for serialization
        setattr(compiled_fn_sync, EAST_IR_ATTR, original_ir)
        setattr(compiled_fn_sync, EAST_CAPTURES_ATTR, capture_values)  # NEW
        return compiled_fn_sync

    return FunctionFactory(make_sync_fn), False
```

**Same changes for `_compile_async_function` (lines 410-466).**

### 4.2 Changes to `east/serialization/beast2.py`

**Update imports (add at top):**

```python
from east.runtime.compiler import EAST_IR_ATTR, EAST_CAPTURES_ATTR
```

**Modify `encode_function` (lines 325-346):**

```python
def encode_function(val: Any, writer: BufferWriter, ctx: Beast2EncodeContext) -> None:
    ir = getattr(val, EAST_IR_ATTR, None)
    if ir is None:
        raise RuntimeError(
            "Cannot serialize function: no IR attached. "
            "Functions must be compiled from East IR to be serializable."
        )

    # Serialize the IR
    ir_encoder(ir, writer, ctx)

    # Serialize capture count and values
    captures = ir["value"]["captures"]
    capture_values = getattr(val, EAST_CAPTURES_ATTR, {})

    writer.write_varint(len(captures))

    for cap_var in captures:
        name = cap_var["value"]["name"]
        cap_type = cap_var["value"]["type"]

        if name not in capture_values:
            raise RuntimeError(
                f"Capture '{name}' not found in function's capture context"
            )

        cap_entry = capture_values[name]
        cap_value = cap_entry["value"]

        # Encode the capture value using its type
        cap_encoder = encode_beast2_value_to_buffer_for(cap_type, type_ctx)
        cap_encoder(cap_value, writer, ctx)
```

**Modify `decode_function` (lines 691-709):**

```python
def decode_function(
    buffer: bytes, offset: int, ctx: Beast2DecodeContext
) -> tuple[Any, int]:
    # Decode the IR
    ir, new_offset = ir_decoder(buffer, offset, ctx)

    if ir["type"] != "Function":
        raise RuntimeError(f"Expected Function IR, got {ir['type']} at offset {offset}")

    # Decode capture count
    captures = ir["value"]["captures"]
    capture_count, new_offset = read_varint(buffer, new_offset)

    if capture_count != len(captures):
        raise RuntimeError(
            f"Capture count mismatch: IR has {len(captures)}, data has {capture_count}"
        )

    # Decode capture values and build initial environment
    capture_env = {}
    for cap_var in captures:
        name = cap_var["value"]["name"]
        cap_type = cap_var["value"]["type"]

        cap_decoder = decode_beast2_value_for(cap_type, type_ctx, options)
        cap_value, new_offset = cap_decoder(buffer, new_offset, ctx)
        capture_env[name] = cap_value

    # Compile with capture environment
    from east.runtime.compiler import _compile_ir

    compiled, _ = _compile_ir(ir, platform_fns, async_platform_fns, platform)

    # If it's a FunctionFactory, create the function with capture environment
    if isinstance(compiled, FunctionFactory):
        fn = compiled.make(capture_env)
    else:
        fn = compiled

    return (fn, new_offset)
```

**Same changes for `encode_async_function` (lines 354-375) and `decode_async_function` (lines 722-744).**

### 4.3 Export Updates

**In `east/serialization/beast2.py` `__all__` (line 884):**

```python
__all__ = [
    # ... existing exports ...
    "EAST_IR_ATTR",
    "EAST_CAPTURES_ATTR",  # NEW
]
```

---

## 5. Wire Format

### Previous Format (Free Functions Only)

```
[IR encoded as IRType variant]
```

### New Format (All Functions)

```
[IR encoded as IRType variant]
[varint: capture count]
[capture value 0 encoded using captures[0].type]
[capture value 1 encoded using captures[1].type]
...
[capture value N-1 encoded using captures[N-1].type]
```

For free functions (no captures), capture count is 0 and no values follow.

---

## 6. Shared Identity Semantics

### When Sharing IS Preserved

```python
# Struct containing array and closure that captures it
# BEAST2 backreference tracking preserves identity
arr = EastArray(IntegerType, [1, 2])
push_fn = ...  # closure capturing arr

data = {"arr": arr, "push": push_fn}
# Serialize and deserialize
decoded = decode_beast2(data_bytes, DataType)
decoded["push"](3)  # Modifies decoded["arr"]!
```

### When Sharing is NOT Preserved

```python
# Two separate closures capturing same variable
# Each serializes its own copy - relationship lost
counter = 0
get_fn = ...  # captures counter
set_fn = ...  # captures counter

data = {"get": get_fn, "set": set_fn}
# After round-trip, get and set have independent copies
```

---

## 7. File Changes Summary

| File | Change |
|------|--------|
| `east/runtime/compiler.py:22` | Add `EAST_CAPTURES_ATTR = "_east_captures"` |
| `east/runtime/compiler.py:325-407` | Modify `_compile_function` to attach captures |
| `east/runtime/compiler.py:410-466` | Modify `_compile_async_function` to attach captures |
| `east/serialization/beast2.py:27` | Import `EAST_CAPTURES_ATTR` |
| `east/serialization/beast2.py:325-346` | Modify `encode_function` to serialize captures |
| `east/serialization/beast2.py:354-375` | Modify `encode_async_function` to serialize captures |
| `east/serialization/beast2.py:691-709` | Modify `decode_function` to deserialize captures |
| `east/serialization/beast2.py:722-744` | Modify `decode_async_function` to deserialize captures |
| `east/serialization/beast2.py:884` | Add `EAST_CAPTURES_ATTR` to `__all__` |

---

## 8. Implementation Tasks

### Phase 1: Compiler Changes

- [ ] Add `EAST_CAPTURES_ATTR = "_east_captures"` constant
- [ ] Modify `_compile_function` to capture values from parent_env
- [ ] Attach `EAST_CAPTURES_ATTR` to compiled functions
- [ ] Same changes for `_compile_async_function`

### Phase 2: BEAST2 Encoder Changes

- [ ] Import `EAST_CAPTURES_ATTR`
- [ ] Remove closure rejection check in `encode_function`
- [ ] Encode capture count as varint after IR
- [ ] Encode each capture value using its type from VariableIR
- [ ] Same changes for `encode_async_function`

### Phase 3: BEAST2 Decoder Changes

- [ ] Decode capture count and validate against IR
- [ ] Decode capture values using types from IR
- [ ] Build capture environment dict
- [ ] Pass capture environment to `FunctionFactory.make()`
- [ ] Same changes for `decode_async_function`

### Phase 4: Testing

- [ ] Add tests for basic closure serialization
- [ ] Add tests for nested closures
- [ ] Add tests for mutable captures
- [ ] Add tests for shared identity (struct with array + closure)
- [ ] Run compliance tests after TypeScript exports

---
