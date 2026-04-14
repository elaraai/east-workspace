# Beast2 Issues

Critical evaluation of `libs/east-c/packages/east-c/src/serialization/beast2/*` after a full read of all 11 source files (3,817 lines). Issues are grouped by severity and tagged with the file:line they occur at.

## Headline issue (drives the byte-identity bug)

### #1 — Pointer dedup ≠ structural dedup, but C makes them equal

**File**: `type_table.c:91-99` (`flat_tt_et_find`), `type_table.c:175-273` (`flat_tt_add_et`)

The C type table dedup uses pointer identity:
```c
int flat_tt_et_find(Beast2FlatTypeTable *t, EastType *type) {
    uintptr_t key = (uintptr_t)type;
    ...
}
```

Because `types.c` interns ALL type constructors (`east_array_type`, `east_struct_type`, `east_function_type`, …) via `intern_find`/`intern_put`, structurally identical types share the same `EastType*`. So in C, **pointer dedup IS structural dedup** — there is no way for two structurally equivalent types to occupy two table entries.

**The TS reference encoder behaves differently.** `libs/east/src/types.ts:281,301` — `StructType` and `VariantType` constructors do NOT intern (`return assignTypeId({ type: "Struct", fields });`). They return a fresh JS object every call, with a fresh `type_id`. `OptionType(StringType)` is `VariantType({ none: NullType, some: StringType })`, so each invocation produces a new object.

In `beast2-type-table.ts:132-201`, `TypeTableBuilder.visitET` dedupes via `etMap` (object identity) and `etvMap` (object identity). It does NOT consult `tidMap` (structural type_id) on the ET path. So 12 separate `Optional<String>` calls in a Style struct produce **12 separate type table entries**.

**Reproduction** (verified by Python script over `/tmp/ui.beast2` and `/tmp/ui_reencoded.beast2`):
- ORIG (TS-encoded): 78 entries, 16 structurally redundant → 62 unique
- NEW (C-encoded):   96 entries,  0 structurally redundant → 96 unique

The two encoders disagree on TWO things at once:
1. **Dedup strategy** — TS uses object identity, C uses structural identity (via interning).
2. **Walk reach** — C produces 34 unique types that TS never adds to the table at all (see Issue #2).

### #2 — C IR walk surfaces 34 type entries that TS does not (open question)

**File**: `ir_encode.c:147-587` (`b2ir_encode_node`)

Every IR node carries `node->type`, and `b2ir_encode_node` calls `b2ir_write_type(buf, node->type, ctx)` for almost every case. Each such call may insert a new type into `flat_tt_add_et`.

Where TS does this via `visitETV` it has cross-path `tidMap` dedup against types added by `visitET`. C lacks an analogous cross-path mechanism — *but* doesn't strictly need one because pointer dedup is already structural. So the extra 34 entries are NOT a dedup failure; they are types that the IRNode walk surfaces and the EastValue walk does not.

Hypothesis: TS's IR encoder skips some type slots in its variant schema (e.g., `IR_VARIABLE` may not encode a redundant type field where the position is implied by context). C's IR encoder writes a type for every IR sub-node unconditionally.

**Action required**: audit the TS IR encoder schema (`libs/east/src/serialization/beast2.ts` and `type_of_type.ts`) and compare with `ir_encode.c`'s case-by-case emission. Identify which type slots TS omits.

## Correctness issues (potential bugs)

### #3 — Function value encode silently writes nothing if both IR sources are NULL

**File**: `value_encode.c:228`

```c
EastCompiledFn *fn = value->data.function.compiled;
if (!fn || (!fn->source_ir && !fn->source_ir_node)) break;
```

`break` exits the switch case. Zero bytes written. The blob is now structurally invalid (the type table promises a function here, the body has nothing). The decoder will mis-parse the rest of the stream.

This is the regression class the closure-reencode fix was designed to prevent. The fix added the `source_ir_node` path; the silent-write-nothing fallback is still here. Should at least `fprintf(stderr, ...)` and ideally surface a hard error from the encoder API.

### #4 — `b2ir_write_type` writes 0 for NULL types, aliasing to whatever's at index 0

**File**: `ir_encode.c:13-26`

```c
static void b2ir_write_type(ByteBuffer *buf, EastType *type, Beast2EncodeCtx *ctx) {
    if (!type || !ctx->flat_type_table) {
        write_varint(buf, 0);
        return;
    }
    ...
}
```

Index 0 is the FIRST entry in the type table — typically the recursive root. NULL `type` silently substitutes that. Bug magnet for IR Variable nodes / capture types whose type wasn't propagated. Better: emit an explicit error or use a sentinel index.

### #5 — IR `As` node has no encoder inverse

**File**: `ir_encode.c:160-166` (the `// Note: There is no IR_AS kind in the C IR` comment)

Decoder case 0 (`As`) re-types the inner node: `result->type = type` overwrites whatever the inner had. Encoder has no way to round-trip this — every node encodes with its native kind, dropping any `As` wrapper. Documented but is a fidelity loss.

**Impact on byte-identity**: if the TS-encoded blob contains `As` IR nodes, C re-encode produces a structurally different IR tree (and almost certainly different bytes).

### #6 — Struct encode trusts field order positionally

**File**: `value_encode.c:125-141`

```c
case EAST_TYPE_STRUCT: {
    size_t nf = type->data.struct_.num_fields;
    for (size_t i = 0; i < nf; i++) {
        EastType *ftype = type->data.struct_.fields[i].type;
        EastValue *fval = (value->kind == EAST_VAL_STRUCT && i < value->data.struct_.num_fields)
                        ? value->data.struct_.field_values[i] : NULL;
```

Indexes by position, not by name. If a struct value's fields were ever in a different order than the type's schema (e.g., produced by an interop layer), the encoder silently writes wrong values. No assertion that names match. Should at least debug-assert.

### #7 — `beast2_dedup_find` no longer compares bytes

**File**: `dedup.c:94-109`

```c
EastValue *beast2_dedup_find(Beast2DecodeCtx *ctx, uint64_t hash, ...) {
    (void)data; (void)byte_start; /* no longer needed — full-content hash is sufficient */
    ...
    if (ctx->dedup_slots[h].hash == hash &&
        ctx->dedup_slots[h].byte_len == byte_len &&
        ctx->dedup_slots[h].type == type) {
        return ctx->dedup_slots[h].value;
    }
```

Hash collisions are ~2⁻⁶⁴, which is effectively zero per call but at scale (e.g., a million dedup entries) gets non-trivial. The previous code did `memcmp` to confirm. Removing it trades correctness for ~10ns/lookup. For content-addressed storage and decode determinism, hash-only matching is risky.

**Recommendation**: keep the `data`/`byte_start`/`byte_len` parameters and re-add the memcmp on hash hit.

### #8 — Type table parse mismatch is silently swallowed

**File**: `type_table.c:343-347`

```c
if (*offset != header_end) {
    fprintf(stderr, "beast2: type table size mismatch: expected %zu, got %zu\n", header_end, *offset);
}
*offset = header_end;
```

A size mismatch indicates a corrupt or version-mismatched blob. Code prints to stderr and forces the offset forward. Downstream decode now reads garbage. Should return an error from `read_type_table_section` and propagate it up.

### #9 — IR `IfElse` chain build has confusing release pattern

**File**: `ir_decode.c:432-456`

```c
IRNode *chain = else_b;
for (int64_t i = (int64_t)count - 1; i >= 0; i--) {
    IRNode *node = ir_if_else(type, preds[i], bodies[i], chain);
    if (preds[i]) ir_node_release(preds[i]);
    if (bodies[i]) ir_node_release(bodies[i]);
    if (chain && chain != else_b) ir_node_release(chain);
    chain = node;
}
if (else_b) ir_node_release(else_b);
```

The retain/release pattern around `else_b` and intermediate `chain` nodes is hard to reason about without reading `ir_if_else`'s retain semantics. Worth a focused audit. May or may not leak.

### #10 — IR `Match` case body has dead retain/release pair

**File**: `ir_decode.c:495-501`

```c
cases[i].body = body;
if (body) ir_node_retain(body);
if (body) ir_node_release(body);
```

A retain immediately followed by a release. Net ref count change: zero. Either both are wrong (and the body is now under-retained for its storage in `cases[i].body`) or both are dead code. Confusing as-is.

## Architecture / fragility issues

### #11 — Encoder canonicality couples to `east_type_from_value` interning

**File**: `type_table.c:489-506` (`flat_tt_add_etv`)

```c
EastType *type = east_type_from_value(etv);
if (!type) return 0;
size_t idx = flat_tt_add_et(t, type);
```

The encoder's structural-dedup correctness depends on `east_type_from_value` returning the same `EastType*` for two structurally-equivalent ETVs. This works today, but it's a cross-cutting dependency: a bug in `east_type_from_value` interning would silently de-canonicalize the encoder.

### #12 — Dead `type_values` field in `TypeTableResult`

**File**: `internal.h:138-143`, `type_table.c:466`, `type_table.c:277-284`

```c
typedef struct {
    EastType *root_type;
    EastType **types;
    EastValue **type_values; /* always NULL after recent commits */
    size_t count;
} TypeTableResult;
```

Set to NULL in `read_type_table_section`. `type_table_result_free` iterates over it. Carried by `Beast2DecodeCtx.global_type_table` (also dead). Should be removed entirely.

### #13 — Per-closure encode contexts split backref state

**File**: `value_encode.c:236-247, 285-294`

```c
Beast2EncodeCtx ir_ctx;
beast2_enc_ctx_init(&ir_ctx);
ir_ctx.string_table = ctx->string_table;
ir_ctx.flat_type_table = ctx->flat_type_table;
beast2_encode_value(buf, fn->source_ir, east_ir_type, &ir_ctx);
beast2_enc_ctx_free(&ir_ctx);
```

Each closure encode gets a fresh context (so backref slots reset), while string and type tables are shared. If the TS encoder uses one context throughout, this is a wire-format divergence: closure-internal arrays/refs cannot backreference outer values, and outer values cannot backreference into closure-internal data.

**Action required**: verify against TS encoder behaviour. If TS does the same closure-isolation, this is fine; if not, it's a bug.

### #14 — Hardcoded 4096-slot dedup table on every decode

**File**: `backref.c:90-111`

```c
ctx->dedup_mask = 4095;  /* initial capacity 4096 */
ctx->dedup_slots = calloc((size_t)(ctx->dedup_mask + 1), sizeof(Beast2DedupSlot));
```

`Beast2DedupSlot` is ~40 bytes, so this is ~160KB allocated for every decode regardless of input size. Wastes memory on small blobs. Should start small and grow.

## Lower-priority observations

### #15 — `beast2_backref_error` prints up to 20 ref offsets but may scan many empty slots

**File**: `backref.c:189-214`

Linear scan over all `mask + 1` slots to print up to 20 known offsets. On a populated 1M-slot decode context that's a million-iteration scan to find 20 entries. Cosmetic only.

### #16 — `b2_write_float64_le` assumes host is little-endian

**File**: `tags.c:42-49`

```c
void b2_write_float64_le(ByteBuffer *buf, double val) {
    uint8_t bytes[8];
    memcpy(bytes, &val, 8);
    /* On big-endian systems this would need byte-swapping. */
    byte_buffer_write_bytes(buf, bytes, 8);
}
```

Acknowledged in the comment. Fine for x86/ARM-LE deployment targets, would need to be revisited if we ever build for BE platforms. Same applies to vector/matrix bulk-copy in `value_encode.c:171-208`.

### #17 — `string_table_enc_grow` re-finds empty slot but doesn't re-validate dedup

**File**: `string_table.c:71-92`

```c
if (t->count * 10 >= (t->mask + 1) * 7) {
    string_table_enc_grow(t);
    /* Re-find empty slot after grow */
    h = hash & (uint32_t)t->mask;
    while (t->slots[h].hash != 0) h = (h + 1) & (uint32_t)t->mask;
}
```

Correct as written (we already know the string isn't in the table because we exited the dedup loop on a 0 slot before deciding to grow), but the comment doesn't make this invariant clear. Easy to break in a future edit.

## Walk-order observations (relevant to byte identity)

The C type table walks DFS through children in field order:
- **Struct**: `for i in 0..nf: flat_tt_add_et(fields[i].type)` (`type_table.c:218-234`)
- **Variant**: `for i in 0..nc: flat_tt_add_et(cases[i].type)` (`type_table.c:237-253`)
- **Function**: inputs left-to-right, then output (`type_table.c:256-269`)
- **Compound containers**: element first (`type_table.c:198-205`)

TS does the same in `beast2-type-table.ts:132-201`. Walk order should match if the value graphs match.

The remaining concern is **walk reach**: which types each side discovers. This is the open question in #2.

## Summary of fix paths

For the byte-identity goal, three options:

**Option A — Fix TS to be canonical** (per design doc intent):
1. Add interning to `StructType` and `VariantType` in `libs/east/src/types.ts`.
2. Add `tidMap` (structural) dedup to `TypeTableBuilder.visitET` in `libs/east/src/serialization/beast2-type-table.ts`.
3. Verify cross-path dedup between `visitET` and `visitETV` is bidirectional.
4. C requires no changes if all types intern.

Result: Existing TS-encoded blobs in storage get new hashes. One-time migration cost. Future encodes are stable across runtimes.

**Option B — Fix C to match TS's non-canonical encoding**:
1. Track encode-side type identity by something other than interned `EastType*`.
2. Walk the original source value's type tree positionally; emit each encountered type even when structurally equivalent.

Result: Existing TS hashes preserved. C encoder becomes intentionally non-canonical. Wrong direction per the design doc.

**Option C — Audit walk reach first** (Issue #2):
1. Compare `ir_encode.c` case-by-case against the TS IR encoder schema.
2. Identify which type slots TS skips that C emits.
3. Decide whether the 34 extra C entries are a separable bug.

**Recommended order**: C → A.

## Files audited

| File | Lines | Key responsibility |
|---|---|---|
| `internal.h` | 283 | Shared types, struct decls, helper signatures |
| `tags.c` | 71 | Tag bytes, kind→tag map, magic, float64-LE helpers |
| `string_table.c` | 131 | Open-addressing string dedup table |
| `type_table.c` | 521 | Flat type table (encoder DFS, decoder, hash maps) |
| `backref.c` | 214 | Encode/decode contexts, backreference protocol |
| `dedup.c` | 247 | Wymix-style content hashing for value dedup |
| `value_encode.c` | 333 | Type-directed value encoder |
| `value_decode.c` | 485 | Type-directed value decoder |
| `ir_encode.c` | 632 | Direct IRNode → beast2 encoder (`b2ir_encode_node`) |
| `ir_decode.c` | 706 | Direct beast2 → IRNode decoder (`b2ir_decode_node`) |
| `full.c` | 194 | Full-format entry points |

**Total: 3,817 lines.**
