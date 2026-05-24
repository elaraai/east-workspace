# Design: WASM Direct Memory Bridge (Replace Beast2 Marshalling)

## Problem

The WASM bridge serializes every value crossing the C↔JS boundary through beast2 encode/decode:

```
JS → beast2 encode (TS) → bytes → beast2 decode (C) → EastValue*   [input]
EastValue* → beast2 encode (C) → bytes → beast2 decode (TS) → JS   [output]
```

This is:
1. **Broken** — C and TS beast2 implementations disagree on recursive type encoding, causing trailing bytes errors on complex types (e.g., the 27-case recursive UIType with 1640 closures)
2. **Slow** — full beast2 encode + decode for every function call result, every platform function argument, and every callback return value
3. **Fragile** — any beast2 encoding difference between C and TS causes silent data corruption or crashes

## Proposed Design

Read `EastValue*` structs directly from WASM linear memory in JS. No serialization.

### EastValue Struct Layout (WASM32)

```
Offset  Size  Field
+0      4     kind (EastValueKind enum, int32)
+4      4     ref_count (int32)
+8      4     gc_next (ptr, ignored by JS)
+12     4     gc_prev (ptr, ignored by JS)
+16     4     gc_refs (int32, ignored by JS)
+20     1     gc_tracked (bool, ignored by JS)
+21     3     padding
+24     4     iter_lock (int32, ignored by JS)
+28     24    data union (varies by kind)
```

Total: 52 bytes. Header (28 bytes) + data union (24 bytes).

### EastValueKind Enum

```
0: EAST_VAL_NULL
1: EAST_VAL_BOOLEAN
2: EAST_VAL_INTEGER
3: EAST_VAL_FLOAT
4: EAST_VAL_STRING
5: EAST_VAL_DATETIME
6: EAST_VAL_BLOB
7: EAST_VAL_ARRAY
8: EAST_VAL_SET
9: EAST_VAL_DICT
10: EAST_VAL_STRUCT
11: EAST_VAL_VARIANT
12: EAST_VAL_REF
13: EAST_VAL_FUNCTION
14: EAST_VAL_VECTOR
15: EAST_VAL_MATRIX
```

### Data Union Layout by Kind

**Scalars** (read directly):
```
BOOLEAN:   +28: u8 (0 or 1)
INTEGER:   +28: i64 (8 bytes, little-endian)
FLOAT:     +28: f64 (8 bytes, little-endian)
DATETIME:  +28: i64 (epoch millis)
```

**String/Blob** (pointer + length):
```
STRING:    +28: ptr(char*), +32: u32(len)     → TextDecoder on HEAPU8 slice
BLOB:      +28: ptr(u8*),   +32: u32(len)     → Uint8Array slice
```

**Collections** (pointer-to-pointer arrays):
```
ARRAY/SET: +28: ptr(EastValue**items), +32: u32(len), +36: u32(cap), +40: ptr(elem_type)
DICT:      +28: ptr(EastValue**keys), +32: ptr(EastValue**values), +36: u32(len), +40: u32(cap)
STRUCT:    +28: ptr(char**field_names), +32: ptr(EastValue**field_values), +36: u32(num_fields)
VARIANT:   +28: ptr(EastValue*value), +32: ptr(EastType*type), +36: u32(case_idx), +40: ptr(case_tag)
REF:       +28: ptr(EastValue*value)
```

**Vectors/Matrices** (typed arrays):
```
VECTOR:    +28: ptr(data), +32: u32(len), +36: ptr(elem_type)
MATRIX:    +28: ptr(data), +32: u32(rows), +36: u32(cols), +40: ptr(elem_type)
```

### Approach A: C Accessor Functions (Recommended)

Export thin C accessor functions that return values or pointers. JS calls these
via the WASM module interface — one call per field access, but each call is
trivial (a pointer dereference, no serialization).

```c
// New file: wasm_api_read.c (or added to wasm_api.c)

EMSCRIPTEN_KEEPALIVE int east_wasm_value_kind(uintptr_t ptr) {
    return ((EastValue *)ptr)->kind;
}

EMSCRIPTEN_KEEPALIVE int east_wasm_get_bool(uintptr_t ptr) {
    return ((EastValue *)ptr)->data.boolean ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int64_t east_wasm_get_integer(uintptr_t ptr) {
    // For WASM32, return as two i32s or use BigInt integration
    return ((EastValue *)ptr)->data.integer;
}

EMSCRIPTEN_KEEPALIVE double east_wasm_get_float(uintptr_t ptr) {
    return ((EastValue *)ptr)->data.float64;
}

EMSCRIPTEN_KEEPALIVE int64_t east_wasm_get_datetime(uintptr_t ptr) {
    return ((EastValue *)ptr)->data.datetime;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_get_string_ptr(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.string.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_get_string_len(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.string.len;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_get_blob_ptr(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.blob.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_get_blob_len(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.blob.len;
}

// Collections
EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_collection_len(uintptr_t ptr) {
    EastValue *v = (EastValue *)ptr;
    switch (v->kind) {
    case EAST_VAL_ARRAY: return (uint32_t)v->data.array.len;
    case EAST_VAL_SET:   return (uint32_t)v->data.set.len;
    case EAST_VAL_DICT:  return (uint32_t)v->data.dict.len;
    default: return 0;
    }
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_array_get(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.array.len) return 0;
    return (uintptr_t)v->data.array.items[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_set_get(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.set.len) return 0;
    return (uintptr_t)v->data.set.items[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_dict_key(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.dict.len) return 0;
    return (uintptr_t)v->data.dict.keys[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_dict_value(uintptr_t ptr, uint32_t idx) {
    EastValue *v = (EastValue *)ptr;
    if (idx >= v->data.dict.len) return 0;
    return (uintptr_t)v->data.dict.values[idx];
}

// Struct
EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_struct_num_fields(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.struct_.num_fields;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_struct_field_name(uintptr_t ptr, uint32_t idx) {
    // Returns pointer to null-terminated C string
    return (uintptr_t)((EastValue *)ptr)->data.struct_.field_names[idx];
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_struct_field_value(uintptr_t ptr, uint32_t idx) {
    return (uintptr_t)((EastValue *)ptr)->data.struct_.field_values[idx];
}

// Variant
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_variant_tag(uintptr_t ptr) {
    // Returns pointer to null-terminated C string (the case tag)
    return (uintptr_t)((EastValue *)ptr)->data.variant.case_tag;
}

EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_variant_value(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.variant.value;
}

// Ref
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_ref_get(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.ref.value;
}

// Vector (returns pointer to raw data array — caller reads based on elem type)
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_vector_data(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.vector.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_vector_len(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.vector.len;
}

// Matrix
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_matrix_data(uintptr_t ptr) {
    return (uintptr_t)((EastValue *)ptr)->data.matrix.data;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_matrix_rows(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.matrix.rows;
}

EMSCRIPTEN_KEEPALIVE uint32_t east_wasm_matrix_cols(uintptr_t ptr) {
    return (uint32_t)((EastValue *)ptr)->data.matrix.cols;
}

// Lifecycle
EMSCRIPTEN_KEEPALIVE void east_wasm_value_release(uintptr_t ptr) {
    east_value_release((EastValue *)ptr);
}
```

### Approach B: Direct HEAPU8 Reading (Alternative)

Read struct fields directly from JS using known byte offsets:

```typescript
const KIND_OFFSET = 0;
const DATA_OFFSET = 28;

function readValue(mod: EastWasmModule, ptr: number): unknown {
    const kind = mod.HEAPU32[ptr >> 2];  // kind at offset 0
    switch (kind) {
    case 0: return null;                  // NULL
    case 1: return mod.HEAPU8[ptr + DATA_OFFSET] !== 0;  // BOOLEAN
    case 2: {                             // INTEGER
        const lo = mod.HEAPU32[(ptr + DATA_OFFSET) >> 2];
        const hi = mod.HEAP32[(ptr + DATA_OFFSET + 4) >> 2];
        return BigInt(lo) | (BigInt(hi) << 32n);
    }
    case 3: return mod.HEAPF64[(ptr + DATA_OFFSET) >> 3];  // FLOAT
    case 4: {                             // STRING
        const dataPtr = mod.HEAPU32[(ptr + DATA_OFFSET) >> 2];
        const len = mod.HEAPU32[(ptr + DATA_OFFSET + 4) >> 2];
        return new TextDecoder().decode(mod.HEAPU8.subarray(dataPtr, dataPtr + len));
    }
    // ... etc
    }
}
```

**Trade-offs:**
- Approach A: More WASM calls but **zero layout assumptions** — works even if struct layout changes, compiler pads differently, etc.
- Approach B: Fewer calls but **fragile** — breaks if field offsets change due to padding, compiler flags, or struct modifications.

**Recommendation: Approach A.** The accessor functions are trivial (single pointer dereference) so the WASM call overhead is minimal. And it's completely immune to layout changes.

### Integration: Modified Call Flow

**Current (beast2 marshalling):**
```
east_wasm_call(handle, ...) → C executes → beast2_encode_full → bytes → beast2_decode → JS value
```

**Proposed (pointer return + accessor):**
```
east_wasm_call_ptr(handle, ...) → C executes → return EastValue* pointer
JS calls accessors to read fields on demand
```

New C function:
```c
EMSCRIPTEN_KEEPALIVE uintptr_t east_wasm_call_ptr(uint32_t handle) {
    EastCompiledFn *fn = g_handles[handle].fn;
    EvalResult result = east_call(fn, NULL, 0);
    if (result.status == EVAL_ERROR) { /* set error */ return 0; }
    // Caller is responsible for calling east_wasm_value_release when done
    return (uintptr_t)result.value;
}
```

**TS side:**
```typescript
function wrapHandle(handle, inputTypes, outputType) {
    return (...args) => {
        let resultPtr: number;
        if (args.length === 0) {
            resultPtr = mod._east_wasm_call_ptr(handle);
        } else {
            // Encode args (still beast2 for now — or use pointer-based input too)
            resultPtr = mod._east_wasm_call_ptr_with_args(handle, argsPtr, argsLen);
        }
        if (resultPtr === 0) throw new Error(getLastError());
        const result = readValueFromPtr(mod, resultPtr);
        mod._east_wasm_value_release(resultPtr);
        return result;
    };
}
```

The `readValueFromPtr` function recursively walks the EastValue tree using the
accessor functions, building native JS objects:

```typescript
function readValueFromPtr(mod: EastWasmModule, ptr: number): unknown {
    const kind = mod._east_wasm_value_kind(ptr);
    switch (kind) {
    case 0: return null;
    case 1: return mod._east_wasm_get_bool(ptr) !== 0;
    case 2: return mod._east_wasm_get_integer(ptr);  // returns BigInt via WASM i64
    case 3: return mod._east_wasm_get_float(ptr);
    case 4: {
        const strPtr = mod._east_wasm_get_string_ptr(ptr);
        const strLen = mod._east_wasm_get_string_len(ptr);
        return mod.UTF8ToString(strPtr, strLen);
    }
    case 7: { // ARRAY
        const len = mod._east_wasm_collection_len(ptr);
        const arr = new Array(len);
        for (let i = 0; i < len; i++) {
            arr[i] = readValueFromPtr(mod, mod._east_wasm_array_get(ptr, i));
        }
        return arr;
    }
    case 10: { // STRUCT
        const nf = mod._east_wasm_struct_num_fields(ptr);
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < nf; i++) {
            const namePtr = mod._east_wasm_struct_field_name(ptr, i);
            const name = mod.UTF8ToString(namePtr);
            const valPtr = mod._east_wasm_struct_field_value(ptr, i);
            obj[name] = readValueFromPtr(mod, valPtr);
        }
        return new EastStruct(obj);  // or plain object
    }
    case 11: { // VARIANT
        const tagPtr = mod._east_wasm_variant_tag(ptr);
        const tag = mod.UTF8ToString(tagPtr);
        const valPtr = mod._east_wasm_variant_value(ptr);
        return variant(tag, readValueFromPtr(mod, valPtr));
    }
    // ... etc for all kinds
    }
}
```

### Input Marshalling (JS → C)

For function arguments going JS → C, two options:

**Option A: Keep beast2 for inputs.** Input marshalling works correctly today for
non-recursive types. The broken path is C→TS (output), not TS→C (input). Fix
output first, inputs later.

**Option B: Add C value constructors.** Export functions like:
```c
uintptr_t east_wasm_make_integer(int64_t val);
uintptr_t east_wasm_make_string(const char *data, size_t len);
uintptr_t east_wasm_make_array(uintptr_t *items, size_t count, uintptr_t elem_type);
uintptr_t east_wasm_make_struct(const char **names, uintptr_t *values, size_t count);
uintptr_t east_wasm_make_variant(const char *tag, uintptr_t value);
```

**Recommendation: Option A first** — fix the broken output path, then inputs
can follow the same pattern later if needed.

### Platform Functions (JS callbacks from C)

Platform function arguments also use beast2 marshalling. The same accessor
approach works: instead of beast2-encoding arguments in C, pass EastValue*
pointers to JS and let JS read them with accessors.

This requires changing the platform bridge protocol:
```
Current:  C beast2-encodes args → JS beast2-decodes → calls JS fn → JS beast2-encodes result → C beast2-decodes
Proposed: C passes EastValue* ptrs → JS reads via accessors → calls JS fn → JS returns via beast2 (or constructors)
```

**Recommendation: Phase this.** Fix function results first, then platform args.

### Function Values in Results

When the result contains function values (EAST_VAL_FUNCTION), the direct reader
can't return a callable JS function from a C pointer. For these, use the existing
handle mechanism — allocate a handle for the C function and return a JS wrapper:

```typescript
case 13: { // FUNCTION
    const handleId = allocHandle(ptr);
    return wrapFunctionHandle(handleId);
}
```

### Lifecycle / GC

The key change: `east_wasm_call_ptr` returns a **live EastValue pointer** that
JS must release when done. The `readValueFromPtr` function eagerly copies all
scalar data (integers, strings, etc.) into JS values, so after reading, the
EastValue can be released immediately.

For lazy reading (e.g., streaming large arrays), JS would need to hold the
pointer and release it explicitly. But eager reading is simpler and correct.

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| **east_wasm_call result** | Beast2 bytes | EastValue* pointer |
| **Result reading** | `decodeBeast2For(outputType)` | `readValueFromPtr(mod, ptr)` |
| **Type needed for output?** | Yes (drives beast2 decode) | No (kind field is self-describing) |
| **Recursive types** | Broken (C/TS beast2 mismatch) | Works (just pointer chasing) |
| **Function results** | Beast2 cannot encode functions | Handle-based wrapping |
| **Input marshalling** | Beast2 (unchanged for now) | Beast2 (unchanged for now) |
| **Platform args C→JS** | Beast2 | Pointer-based (phase 2) |

### File Changes

| File | Change |
|------|--------|
| `packages/east-c-wasm/src/wasm_api.c` | Add ~30 accessor functions + `east_wasm_call_ptr` |
| `packages/east-c-wasm/src/common.ts` | Add `readValueFromPtr`, modify `wrapHandle` to use pointer path |
| `packages/east-c-wasm/src/common.ts` | Keep beast2 path as fallback for inputs |

### Performance Impact

For the UI benchmark (recursive variant tree with 1640 closures):
- **Before**: Broken (trailing bytes error)
- **After**: Works, with ~1 WASM call per value node in the result tree

Each WASM accessor call is ~5-10ns (function pointer lookup + single dereference).
For a result tree with ~50K nodes, that's ~0.5ms — negligible compared to the
~60ms decode + ~5ms execute.

### Verification

1. Existing WASM compliance tests (53 tests) — must still pass
2. New test: compile and execute `/tmp/ui_fn.beast2` via WASM, verify correct output
3. Profile: WASM benchmark script timing for compile + execute + result read
