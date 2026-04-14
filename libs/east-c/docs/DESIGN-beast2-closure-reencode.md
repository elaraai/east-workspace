# Design: Beast2 Closure Re-encode

## Status

**Three bugs fixed, one C-side remnant, byte-identity blocked only by a TS-side issue.**

1. ✅ Closures now survive decode→re-encode (were being silently dropped). Done in the `09292d1a` fix.
2. ✅ Stale Recursive wrapper pointers after `read_type_table_section` intern fixup — the C decoder was leaving compound types (Function/Struct/Variant) holding the pre-intern Recursive wrapper pointer while `types[rec_idx]` got swapped to the canonical. On the profiler's second decode this caused the encoder to see TWO distinct Recursive pointers and emit the entire UI recursive tree TWICE in the flat type table. Fixed by adding a pass-4 canonicalization that rebuilds compound types with canonical children (see `type_table.c:440-560`).
3. ✅ C decoder was silently dropping location array backreferences (`ir_decode.c` old code hit `if (dist > 0) return;`). Fixed by adding a `Beast2LocRefs` offset→locations map threaded through the IR decode recursion; inline locations are registered on first sight and resolved on backref with a deep copy (including `strdup`'d filenames). This recovered ~320KB of body content on the benchmark blob.
4. ❌ TS `visitET` encoder uses object-identity dedup instead of structural (`beast2-type-table.ts:132-201`); `StructType`/`VariantType` in `types.ts:281,301` don't intern. TS produces 16 structurally-duplicate type entries that C's pointer dedup merges away. This is the entire remaining byte-identity gap (~86KB).

**Current state of the benchmark round-trip** (`/tmp/ui.beast2` → decode → encode → `/tmp/ui_reencoded.beast2`):

| | TS original | C (before fixes) | C (after fix #2) | C (after fix #3) |
|---|---|---|---|---|
| Total size | 2,701,300 | 2,296,679 | 2,295,928 | **2,614,874** |
| Diff from TS | — | −404,621 | −405,372 | **−86,426** |
| Type table section length | 1342 B | 1837 B | 1086 B | 1086 B |
| Type table entry count | 78 | 96 | 60 | 60 |
| Structurally-duplicate type entries | 16 | 35 | 0 | 0 |

Byte-identity still fails, but all known C-side bugs are fixed. The remaining 86 KB gap is driven entirely by TS bug #4: TS's type table has 16 redundant entries (10 copies of `Optional<String>`, 3 copies of `Optional<Style>`, etc.), which also inflates every subsequent varint type-index in the body. Once TS is fixed to dedupe structurally, C is already producing the canonical encoding.

Compliance: **1538/1538 east-c tests pass** after all three fixes.

See [Bug #2: Stale Recursive pointers after intern fixup](#bug-2-stale-recursive-pointers-after-intern-fixup) and [Bug #3: Location backreferences silently dropped](#bug-3-location-backreferences-silently-dropped) for diagnosis details.

## Problem

The east-c beast2 encoder was silently dropping closure IR during re-encode. Specifically:

1. The east-c CLI runner executes a task → produces a result value containing closures (e.g. a UI component with `onClick` handlers)
2. The CLI calls `east_beast2_encode_full(result, type)` to write the output
3. For each closure in the result, the encoder checks `fn->source_ir` (an `EastValue*` representation of the function's IR)
4. When the closure was created via `b2ir_decode_node` (direct beast2→IRNode decode path), `source_ir` was `NULL`, so the encoder silently wrote nothing and moved on
5. Result: a 2.58MB beast2 blob with 1640 closures got re-encoded as **32KB of garbled bytes** that neither the C nor WASM decoder could read back

### Why `source_ir` was NULL

The C codebase has two IR representations:

- **`EastValue*` (typed as `IRType`)** — the IR as an East variant tree (self-describing, what TS uses). Stored in `EastCompiledFn.source_ir`.
- **`IRNode*`** — a more compact struct-based representation optimized for execution. Stored in `EastCompiledFn.ir` (body only).

For execution performance, `b2ir_decode_node` decodes directly from beast2 bytes to `IRNode*`, skipping the `EastValue*` intermediate. But the encoder only knew how to write from `EastValue*`, so it couldn't re-encode closures that came from the direct-decode path.

## Fix

### 1. Store IRNode on compiled function for re-encoding

Added `source_ir_node` field to `EastCompiledFn`:

```c
struct EastCompiledFn {
    IRNode *ir;                 // body IR for execution
    // ...
    EastValue *source_ir;       // EastValue IR tree (from compile path)
    IRNode *source_ir_node;     // IRNode tree (from beast2 decode path) — NEW
};
```

Populated from two places:
- `compiler.c` IR_FUNCTION eval — when the compiler creates a closure from an IRNode, it retains the node as `source_ir_node`
- `beast2/value_decode.c` function value decode — when beast2 decodes a function value, it retains the decoded IRNode as `source_ir_node` (previously released)

### 2. New encoder: write IR directly from IRNode

Added `b2ir_encode_node(ByteBuffer*, IRNode*, Beast2EncodeCtx*)` in `beast2/ir_encode.c` — the inverse of `b2ir_decode_node`. Covers all 34 IR cases. Writes the same wire format as encoding an `EastValue` typed as `IRType`.

### 3. Wire up in function value encode path

`beast2/value_encode.c` EAST_TYPE_FUNCTION case now handles both paths:

```c
if (fn->source_ir) {
    // Existing path: encode from EastValue tree
    beast2_encode_value(buf, fn->source_ir, east_ir_type, ctx);
    // ... extract captures from source_ir variant tree
} else if (fn->source_ir_node) {
    // New path: encode from IRNode tree
    b2ir_encode_node(buf, fn->source_ir_node, ctx);
    // ... extract captures from source_ir_node->data.function
}
```

## File split

`beast2.c` (3796 lines) was split into `beast2/` subdirectory for maintainability. All files <800 lines:

| File | Lines | Contents |
|---|---|---|
| `beast2/internal.h` | 283 | Shared declarations, types, constants |
| `beast2/tags.c` | 71 | Tag byte constants, low-level helpers |
| `beast2/string_table.c` | 131 | String table encode/decode |
| `beast2/type_table.c` | 521 | Flat type table (DFS encoder, decoder, hash maps) |
| `beast2/backref.c` | 214 | Backreference context (encode + decode) |
| `beast2/dedup.c` | 247 | Value dedup via byte-range hashing |
| `beast2/value_encode.c` | ~340 | Type-directed value encoder |
| `beast2/value_decode.c` | 485 | Type-directed value decoder |
| `beast2/full.c` | 197 | Full-format entry points (`east_beast2_encode_full` etc) |
| `beast2/ir_decode.c` | 706 | `b2ir_decode_node` + helpers |
| `beast2/ir_encode.c` | 632 | `b2ir_encode_node` + helpers (NEW) |

Cross-file helpers prefixed with `b2_` (e.g. `b2_write_float64_le`, `b2_read_string_varint`). Static helpers within one file keep their original names.

## Verification

**Before fix** (C re-encodes TS-produced blob with 1640 closures):

```
File: /tmp/ui.beast2 (2701300 bytes, 2.58 MB)
=== Decode ===
  1 iterations: 86.8 ms/call
=== Encode ===
  re-encoded size: 32381 bytes (0.03 MB)   # closures dropped
```

WASM decode of re-encoded bytes:
```
beast2_decode_ir_node: unknown IR case 99
beast2_decode_ir_node: unknown IR case 50
...
WASM decode FAILED: memory access out of bounds
```

**After fix**:

```
File: /tmp/ui.beast2 (2701300 bytes, 2.58 MB)
=== Decode ===
  1 iterations: 87.9 ms/call
=== Encode ===
  re-encoded size: 2296679 bytes (2.19 MB)   # closures preserved
```

WASM decode of re-encoded bytes:
```
C-encoded blob: 2296679 bytes
WASM decode OK, type: Grid
```

Compliance tests: 46/46 Beast v2 tests pass, including closure round-trip cases.

## Known issue: encode is not canonical

**The re-encoded blob is 2.19MB, not the original 2.58MB.** Semantic equivalence is preserved (WASM decodes successfully, structure is correct), but the bytes are NOT identical. This matters for content-addressed storage (e3 hashes task outputs for dedup and cache invalidation).

**The core invariant** that must hold: given a value + type, the encoder must produce identical bytes every time, regardless of how the value was constructed. Encode and decode MUST remain independent. The encoder should never need to know that a value "came from a decode" — that would be terrible architecture.

If this invariant holds, byte identity comes for free: encoding the same logical value always produces the same bytes.

### Observed difference

| | Original (TS) | Re-encoded (C) |
|---|---|---|
| Total size | 2,701,300 bytes | 2,296,679 bytes |
| Type table section length | 1342 bytes | 1837 bytes |
| Type count in type table | 78 | 96 |

The C re-encoded blob has a **larger type table with 18 extra type entries** but a **smaller overall file**. This means the C encoder is not canonical — two valid encodings of the same value differ.

### Root cause

`flat_tt_add_et` uses **pointer-identity** deduplication. This only produces canonical output if structurally identical types are guaranteed to have identical pointers everywhere in the codebase. That guarantee is broken in at least one of these ways:

1. **Decoder interning is incomplete.** `read_type_table_section` reconstructs `EastType*` objects from the wire format via the type constructors. The type constructors have interning, so structurally identical types SHOULD get the same pointer. But if the decoder bypasses interning (e.g., constructs types directly without going through the canonical constructor path), distinct pointers for structurally identical types leak out.

2. **Walk order differs.** Even with perfect pointer dedup, the order in which types are added to `flat_tt` depends on the walk order through the value graph. If the IRNode walk visits types in order A, B, D, C while the original TS walk was A, B, C, D, the type table has the same entries but in different positions → different wire bytes.

Both issues violate the "encode must be canonical" invariant. Both need to be fixed in the encoder/interning, NOT by smuggling decode state into the encoder.

### How to reproduce

```bash
# 1. Generate the 2.58MB benchmark blob with 1640 closures
cd libs/east
npx tsx contrib/examples/beast2_v2_benchmark.ts
# Writes /tmp/ui.beast2 (TS-encoded)

# 2. Build east-c
cd ../east-c
make build

# 3. Build the profiler
gcc -O2 -o /tmp/profile_beast2 \
  packages/east-c/scripts/profile_beast2_decode.c \
  -Ipackages/east-c/include \
  -Lbuild/packages/east-c -least-c \
  -lm -lpthread \
  /usr/lib/x86_64-linux-gnu/libpcre2-8.so.0

# 4. Run decode → re-encode
/tmp/profile_beast2 /tmp/ui.beast2 1
# Prints size of /tmp/ui_reencoded.beast2

# 5. Compare
cmp -l /tmp/ui.beast2 /tmp/ui_reencoded.beast2 | head
# Differences start at byte 9 (type table section length varint)

# 6. Compare structure
python3 -c "
import struct
with open('/tmp/ui.beast2','rb') as f: orig = f.read()
with open('/tmp/ui_reencoded.beast2','rb') as f: new = f.read()
def varint(data, off):
    v = 0; s = 0
    while True:
        b = data[off]; off += 1
        v |= (b & 0x7f) << s
        if not (b & 0x80): break
        s += 7
    return v, off
o = n = 8
o_tt_len, o2 = varint(orig, o); n_tt_len, n2 = varint(new, n)
print(f'TT section len: orig={o_tt_len} new={n_tt_len}')
o_root, o2 = varint(orig, o2); n_root, n2 = varint(new, n2)
print(f'root_idx: orig={o_root} new={n_root}')
o_count, o2 = varint(orig, o2); n_count, n2 = varint(new, n2)
print(f'type count: orig={o_count} new={n_count}')
"
# Expected output:
# TT section len: orig=1342 new=1837
# root_idx: orig=0 new=0
# type count: orig=78 new=96
```

### Fixing it

Encode must remain independent of decode. The fix is to make encode canonical:

**Fix 1: Guarantee decoder interning is complete**

Audit `read_type_table_section` and verify that EVERY reconstructed `EastType*` is canonical — i.e., structurally equivalent types always return the same pointer, whether they were constructed during decode, during IR conversion, or from user code. The existing type constructors have interning, but the decoder must route every type construction through them (not directly allocate `EastType` objects).

If this is already the case, instrument `flat_tt_add_et` to log when two entries in the flat table are structurally equivalent but have different pointers — that's the smoking gun.

**Fix 2: Make walk order deterministic and match TS**

The flat type table is built in walk order: `flat_tt_add_et` is called as the encoder descends into the value graph. The order of additions becomes the type table indices in the wire format.

For canonical output:
- The walk order must be deterministic (currently it is — depth-first in struct field order, variant case order, etc.)
- It must match the TS encoder's walk order exactly (currently it may not, particularly for IR encoding where the walk happens over IRNode fields instead of EastValue struct fields)

The fix is probably not "make C walk the same as TS" — it's "pick ONE canonical walk order and enforce it in both TS and C". The two implementations must agree on what the canonical encoding is. Pick the order from the beast2 spec (or define it in the spec if undefined) and enforce it in both runtimes.

**Fix 3: Test**

Add a round-trip test to the compliance suite: `encode(decode(bytes)) == bytes` for the benchmark blob and any other non-trivial case. This would catch any future regression in canonicality.

### What works now (semantic equivalence)

For use cases that don't require byte identity:
- **Extension decoding** — the VS Code extension reads east-c task outputs and decodes them via WASM. Re-encoded blobs decode successfully, produce the right UI structure, closures are callable.
- **WASM backend** — end-to-end flow works: e3 task → east-c CLI output → extension download → WASM decode → render.

For use cases that require byte identity:
- **Content-addressed storage** — e3 uses SHA256 hashes of task outputs for dedup and cache invalidation. Non-identical round-trip means different runs produce different hashes even with the same logical output. This is a **bug** for e3 and needs to be fixed.
- **Deterministic builds** — if any system relies on reproducible beast2 bytes, this breaks it.

## Related files

- `libs/east-c/packages/east-c/src/serialization/beast2/value_encode.c` — function value encode with dual source_ir/source_ir_node path
- `libs/east-c/packages/east-c/src/serialization/beast2/value_decode.c` — function value decode that retains source_ir_node
- `libs/east-c/packages/east-c/src/serialization/beast2/ir_encode.c` — new `b2ir_encode_node` (inverse of `b2ir_decode_node`)
- `libs/east-c/packages/east-c/src/compiler.c` — IR_FUNCTION eval retains source_ir_node
- `libs/east-c/packages/east-c/include/east/compiler.h` — `source_ir_node` field on `EastCompiledFn`
- `libs/east-c/packages/east-c/scripts/profile_beast2_decode.c` — profiler writes re-encoded blob to `/tmp/ui_reencoded.beast2` for inspection
- `libs/east/contrib/examples/beast2_v2_benchmark.ts` — generates the `/tmp/ui.beast2` test blob with 1640 closures
