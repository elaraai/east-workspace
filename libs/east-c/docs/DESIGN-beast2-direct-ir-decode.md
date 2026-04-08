# Design: Direct Beast2 → IRNode Decode (Bypass EastValue IR Tree)

## Problem

The current beast2 IR decode pipeline has three phases:

```
beast2 bytes → EastValue IR tree → IRNode tree
               (310 ms)            (60 ms)
```

Phase 1 builds a complete EastValue variant/struct tree representing the IR. Phase 2 walks that tree and converts each node to an IRNode. The EastValue tree is a pure intermediate — it's created, walked once, then discarded.

Additionally, the type table phase converts every EastType* to an EastValue* via `east_type_to_value` (~190ms), solely so that `convert_ir` can convert them back via `type_cache_get` → `east_type_from_value`.

Total overhead: **~560ms** for a 2.27 MB IR file — all spent building and walking an intermediate tree that doesn't need to exist.

## Proposed Design

A new function `beast2_decode_ir_direct` that reads the beast2 binary and produces IRNodes directly, without creating any EastValue intermediate.

### Why This Works

The beast2 binary format for IR is fully deterministic:

1. The top-level IR is encoded as `east_ir_type` — a recursive variant with 34 cases
2. Each variant case has a fixed struct layout (fields in schema order)
3. Every field type is known statically from the case index
4. Type references are varint indices into the type table → resolve to `EastType*` directly
5. Nested IR nodes are recursive calls with the same structure

The binary is already structured as `varint(case_index) + field1 + field2 + ...` where each field's binary format is determined by its type in the schema. We can decode each case directly into the corresponding IRNode constructor call.

### Binary Format per IR Case

Every IR node in beast2 is encoded as:

```
[varint case_index]           ← variant tag (0-33)
[type field]                  ← varint index into type table
[location field]              ← array: varint(0) + varint(count) + {string_idx, zigzag, zigzag}*
[case-specific fields...]     ← depends on case_index
```

The case-specific fields use these primitive formats:
- **IR node**: recursive call to decode another IR node (variant)
- **IR array**: `varint(0) + varint(count) + node*` (array with backref protocol)
- **String**: `varint(string_table_index)` (with string table) or `varint(len) + bytes`
- **Integer**: `zigzag_varint`
- **Boolean**: single byte
- **Type reference**: `varint(type_table_index)`
- **Type array**: `varint(0) + varint(count) + varint(type_idx)*`
- **LiteralValue**: variant(case_idx) + payload (for IR_Value nodes)

### Case Index Mapping

The beast2 IR variant has 34 cases in this order (alphabetical in the TS source):

```
 0: As               →  (pass-through, just type + value)
 1: Assign           →  IR_ASSIGN
 2: AsyncFunction    →  IR_ASYNC_FUNCTION
 3: Block            →  IR_BLOCK
 4: Break            →  IR_BREAK
 5: Builtin          →  IR_BUILTIN
 6: Call             →  IR_CALL
 7: CallAsync        →  IR_CALL_ASYNC
 8: Continue         →  IR_CONTINUE
 9: Error            →  IR_ERROR
10: ForArray         →  IR_FOR_ARRAY
11: ForDict          →  IR_FOR_DICT
12: ForSet           →  IR_FOR_SET
13: Function         →  IR_FUNCTION
14: GetField         →  IR_GET_FIELD
15: IfElse           →  IR_IF_ELSE
16: Let              →  IR_LET
17: Match            →  IR_MATCH
18: NewArray         →  IR_NEW_ARRAY
19: NewDict          →  IR_NEW_DICT
20: NewMatrix        →  IR_NEW_MATRIX
21: NewRef           →  IR_NEW_REF
22: NewSet           →  IR_NEW_SET
23: NewVector        →  IR_NEW_VECTOR
24: Platform         →  IR_PLATFORM
25: Return           →  IR_RETURN
26: Struct           →  IR_STRUCT
27: TryCatch         →  IR_TRY_CATCH
28: UnwrapRecursive  →  IR_UNWRAP_RECURSIVE
29: Value            →  IR_VALUE
30: Variable         →  IR_VARIABLE
31: Variant          →  IR_VARIANT
32: While            →  IR_WHILE
33: WrapRecursive    →  IR_WRAP_RECURSIVE
```

### Struct Field Layout per Case

Every case struct starts with `type` (EastTypeType) and `location` ([Location]).
The remaining fields are case-specific. Here's the complete field map:

```
 0: As              → type, location, value:IR
 1: Assign          → type, location, variable:IR, value:IR
 2: AsyncFunction   → type, location, captures:[IR], parameters:[IR], body:IR
 3: Block           → type, location, statements:[IR]
 4: Break           → type, location, label:{name:String, location:[Location]}
 5: Builtin         → type, location, builtin:String, type_parameters:[Type], arguments:[IR]
 6: Call            → type, location, function:IR, arguments:[IR]
 7: CallAsync       → type, location, function:IR, arguments:[IR]
 8: Continue        → type, location, label:{name:String, location:[Location]}
 9: Error           → type, location, message:IR
10: ForArray        → type, location, array:IR, label:Label, key:IR, value:IR, body:IR
11: ForDict         → type, location, dict:IR, label:Label, key:IR, value:IR, body:IR
12: ForSet          → type, location, set:IR, label:Label, key:IR, body:IR
13: Function        → type, location, captures:[IR], parameters:[IR], body:IR
14: GetField        → type, location, field:String, struct:IR
15: IfElse          → type, location, ifs:[{predicate:IR, body:IR}], else_body:IR
16: Let             → type, location, variable:IR, value:IR
17: Match           → type, location, variant:IR, cases:[{case:String, variable:IR, body:IR}]
18: NewArray        → type, location, values:[IR]
19: NewDict         → type, location, values:[{key:IR, value:IR}]
20: NewMatrix       → type, location, values:[IR], rows:Integer, cols:Integer
21: NewRef          → type, location, value:IR
22: NewSet          → type, location, values:[IR]
23: NewVector       → type, location, values:[IR]
24: Platform        → type, location, name:String, type_parameters:[Type], arguments:[IR], async:Boolean, optional:Boolean
25: Return          → type, location, value:IR
26: Struct          → type, location, fields:[{name:String, value:IR}]
27: TryCatch        → type, location, try_body:IR, catch_body:IR, message:IR, stack:IR, finally_body:IR
28: UnwrapRecursive → type, location, value:IR
29: Value           → type, location, value:LiteralValue
30: Variable        → type, location, name:String, mutable:Boolean, captured:Boolean
31: Variant         → type, location, case:String, value:IR
32: While           → type, location, predicate:IR, label:Label, body:IR
33: WrapRecursive   → type, location, value:IR
```

### Helper Binary Decoders Needed

These read from `(data, len, *offset)` and return C values directly:

```c
// Already exist in binary_utils.c:
uint64_t read_varint(data, offset);
int64_t  read_zigzag(data, offset);
double   read_float64_le(data, offset);

// New helpers for the direct decoder:
EastType *read_type_ref(data, offset, types, type_count);    // varint → types[idx]
char     *read_string_ref(data, offset, string_table);       // varint → strdup(table[idx])
IRNode   *decode_ir_node(data, len, offset, types, ...);     // recursive
IRNode  **decode_ir_array(data, len, offset, types, ..., *n);// array of IR nodes
EastType**decode_type_array(data, len, offset, types, ..., *n);// array of types
EastLocation *decode_locations(data, len, offset, ..., *n);  // location array
char     *decode_label(data, len, offset, string_table);     // label struct → name string
EastValue*decode_literal(data, len, offset, ...);            // LiteralValue variant → EastValue
IRVariable decode_variable(data, len, offset, ...);          // Variable IR → IRVariable struct
```

### Handling Beast2 Protocol Features

**Struct dedup**: Not needed. The direct decoder produces IRNodes, which aren't deduped. Struct dedup was only useful for EastValue sharing (saves memory in the intermediate tree). IRNodes are distinct heap objects by design.

**Backreferences**: Not needed for the IR variant itself (IR is a tree, not a DAG at the top level). However, arrays within the IR (e.g., `[IR]` fields) use the array backref protocol (`varint(distance)` or `varint(0) + varint(count) + elements`). Since we don't create EastValue arrays, we skip the backref check — just read `varint(distance)`, if 0 then read inline, otherwise error (IR arrays shouldn't backreference).

Actually, **backreferences CAN appear** in IR arrays when the same array appears multiple times (e.g., shared empty arrays). The safe approach: read the distance varint, if > 0 report an error or fall back to a simple copy. In practice, IR arrays are unique per node.

**String table**: Strings in the IR (variable names, field names, labels) are encoded as varint indices into the string table. `read_string_ref` does `strdup(string_table->strings[idx])`.

### Location Decoding

Locations are encoded as `Array(Struct({filename: String, line: Integer, column: Integer}))`. In beast2 binary:

```
varint(0)          ← backref distance (0 = inline)
varint(count)      ← number of locations
for each location:
  varint(string_idx) ← filename from string table
  zigzag(line)       ← line number
  zigzag(column)     ← column number
```

### LiteralValue Decoding (for IR_Value nodes)

The `value` field of IR_Value is a `LiteralValueType` variant with 7 cases:

```
0: Null      → east_null()
1: Boolean   → 1 byte → east_boolean()
2: Integer   → zigzag → east_integer()
3: Float     → 8 bytes LE → east_float()
4: String    → string_ref → east_string()
5: DateTime  → zigzag → east_datetime()
6: Blob      → varint(len) + bytes → east_blob()
```

These DO create EastValue objects (they're runtime values, not IR metadata). These use normal heap allocation (not arena).

### Function/AsyncFunction and source_ir

The `convert_ir` path currently stores `source_ir` on function IRNodes for re-serialization. The direct decoder does NOT create an EastValue IR tree, so there's no source_ir to store. `source_ir` will be NULL for directly-decoded functions.

This means functions decoded via the direct path cannot be re-serialized to beast2 using `fn->source_ir`. This is acceptable:
- The CLI doesn't re-serialize IR
- The WASM API doesn't re-serialize IR  
- Beast2 encoding checks `if (!fn->source_ir) break;` and handles the NULL case

### Variable Decoding

Variable IR nodes (used in Let, Function captures/parameters) have fields:
```
type, location, name:String, mutable:Boolean, captured:Boolean
```

The decoder reads these and produces an `IRVariable` struct:
```c
typedef struct { char *name; bool mutable; bool captured; } IRVariable;
```

For Let nodes, the variable field is a full IR_Variable node (variant case 30). The decoder reads the variant tag (30), skips the type and location, and extracts name/mutable/captured.

### Integration: Top-level IR Files

```c
// In beast2.c — east_beast2_decode_ir:
IRNode *east_beast2_decode_ir(const uint8_t *data, size_t len, EastValue **ir_value_out)
{
    // 1. Read type table → EastType*[] (existing, fast, ~1ms)
    TypeTableResult tt = read_type_table_section(data, len, &offset);
    
    // 2. Read string table (existing, fast, ~0.2ms)
    Beast2StringTableDec st = read_string_table_section(data, len, &offset);
    
    // 3. Decode IR directly to IRNode (NEW — replaces decode_value + ir_from_value)
    IRNode *ir = beast2_decode_ir_node(data, len, &offset,
                                        tt.types, tt.count, &st);
    
    // No EastValue tree, no arena, no convert_ir, no type_values
    type_table_result_free(&tt);
    string_table_dec_free(&st);
    
    if (ir_value_out) *ir_value_out = NULL;  // No IR value available
    return ir;
}
```

### Integration: Function Closures in Data Values

Beast2 data files (`east_beast2_decode_full`, `east_beast2_decode_auto`) can contain
function closures (EAST_TYPE_FUNCTION). Each closure has a nested IR body that
currently goes through the full EastValue → convert_ir path. The direct decoder
handles these too.

The FUNCTION case in `beast2_decode_value` (currently line ~2176) changes from:

```c
// Before: decode IR as EastValue, convert to IRNode
Beast2DecodeCtx ir_dctx;
beast2_dec_ctx_init(&ir_dctx);
ir_dctx.string_table = ctx->string_table;
ir_dctx.global_type_table = ctx->global_type_table;
ir_dctx.global_types = ctx->global_types;
ir_dctx.global_type_table_size = ctx->global_type_table_size;
EastValue *ir_value = beast2_decode_value(data, len, offset, east_ir_type, &ir_dctx);
beast2_dec_ctx_free(&ir_dctx);
// ... extract captures from ir_value ...
IRNode *ir_node = east_ir_from_value_with_types(ir_value, ...);
fn->source_ir = ir_value;
```

to:

```c
// After: decode IR directly to IRNode
IRNode *ir_node = beast2_decode_ir_node(data, len, offset,
                                         ctx->global_types,
                                         ctx->global_type_table_size,
                                         ctx->string_table);
// No nested decode context, no EastValue IR tree, no convert_ir
fn->source_ir = NULL;  // Direct decode has no EastValue source
```

This is actually the **most important** use case — the 2.27 MB benchmark has
1640 closures, each triggering the nested IR decode + convert_ir. This is where
most of the 310ms decode + 60ms conversion time comes from.

**Capture values** after the IR body still use the normal `beast2_decode_value`
path (they're data values, not IR). The capture type references now come from
the IRNode's function parameters/captures rather than from the EastValue IR tree.
The direct decoder extracts capture variable info (name, type index, mutable)
during IR decode and returns it alongside the IRNode, so the FUNCTION case
can decode capture values with the correct types.

### What Can Be Removed

Once the direct decoder is working:
- `east_type_to_value` calls from the beast2 decode path
- `type_values` array in TypeTableResult (for beast2 path)
- The arena allocator for IR decode (no EastValue tree to arena-allocate)
- `east_ir_from_value_with_types` call from the beast2 path
- The `type_cache_get` / `type_cache_init_with_table` machinery (for beast2 path)
- The nested `Beast2DecodeCtx ir_dctx` in the FUNCTION case

The JSON path continues to use `convert_ir` and `east_ir_from_value` unchanged.

## File Changes

| File | Change |
|------|--------|
| `src/serialization/beast2.c` | New `beast2_decode_ir_node` function (~400 lines, one case per IR node). Modify `east_beast2_decode_ir` to call it directly. |
| `src/serialization/beast2.c` | `read_type_table_section`: skip `type_values` construction |
| `include/east/serialization.h` | No API change — `east_beast2_decode_ir` signature unchanged |
| `src/type_of_type.c` | No change — `convert_ir` and `east_ir_from_value` remain for JSON path |

## Expected Performance Impact

For the 2.27 MB IR benchmark:

| Phase | Before | After | Savings |
|-------|--------|-------|---------|
| Type table (EastType*) | ~1 ms | ~1 ms | 0 |
| Type table (EastValue*) | ~190 ms | 0 ms | **190 ms** |
| String table | ~0.2 ms | ~0.2 ms | 0 |
| Decode to EastValue tree | ~310 ms | 0 ms | **310 ms** |
| convert_ir (EastValue→IRNode) | ~60 ms | 0 ms | **60 ms** |
| Direct decode to IRNode | 0 ms | ~20 ms (est.) | - |
| **Total decode** | **~560 ms** | **~20 ms** | **~540 ms** |

The direct decoder should be ~20ms because:
- It reads the same bytes as beast2_decode_value (~310ms) but skips all EastValue allocation, GC tracking, retain/release, dedup hashing, and backref tracking
- It calls IRNode constructors directly (same work as convert_ir at ~60ms, but without the EastValue→EastType conversion overhead)
- String table lookups + strdup are the main remaining cost

## Verification

1. `make test-east-c` — 1430 compliance tests (beast2 round-trip included)
2. `REBUILD=1 make leak-check` — ASAN leak tests
3. `make test-east-c-wasm` — WASM compliance tests
4. CLI benchmark: `east-c run /tmp/ui_fn.beast2 -v`
5. Compare output values between old and new decode paths
