# Design: Beast2 Closure Re-encode

## Status

**Partially fixed.** Closures now survive decode→re-encode (were being silently dropped). Byte-identical round-trip is NOT yet achieved — see [Known Issue](#known-issue-byte-identity) below.

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

## Known issue: byte identity

**The re-encoded blob is 2.19MB, not the original 2.58MB.** Semantic equivalence is preserved (WASM decodes successfully, structure is correct), but the bytes are NOT identical. This matters for content-addressed storage (e3 hashes task outputs for dedup and cache invalidation).

### Observed difference

| | Original (TS) | Re-encoded (C) |
|---|---|---|
| Total size | 2,701,300 bytes | 2,296,679 bytes |
| Type table section length | 1342 bytes | 1837 bytes |
| Type count in type table | 78 | 96 |

The C re-encoded blob has a **larger type table with 18 extra type entries** but a **smaller overall file**. This suggests the C encoder is:
1. Creating additional type entries that should dedupe with existing ones (pointer-identity dedup in `flat_tt_add_et` is missing some equivalent types)
2. More aggressive about something (string table dedup? backreferences?) that offsets the type table bloat

### Suspected root cause

`flat_tt_add_et` uses **pointer-identity** deduplication. When the C decoder reconstructs types from a decoded beast2 blob, the resulting `EastType*` pointers may not match what TS's original encode pass would produce, even if they're structurally identical.

Specifically: during decode, `read_type_table_section` builds `EastType*` objects from the wire format. These go through the type constructors (which have interning), so in theory structurally identical types should get the same pointer. But:

- If TS encoded types in DFS order A, B, C, D and C re-encodes in order A, B, D, C (because the walk order through IRNodes differs from TS's walk through EastValue)
- Or if the C decoder creates a type that later gets interned with a different type constructed from the IR walk
- The flat type table pointer dedup will miss some equivalences

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

### Ideas for a fix

**Option A: Replay decoded type table on re-encode**

During `east_beast2_decode_*`, cache the decoded type table (the raw bytes or the parsed entry list). During re-encode, if the source blob is available, reuse the same type table layout instead of rebuilding via `flat_tt_add_et`. Pros: byte-identical. Cons: requires tracking the source blob through the value lifetime, and only works for values that came from decode (not values constructed fresh).

**Option B: Interning-aware type reconstruction**

Fix `read_type_table_section` to guarantee that structurally identical types produce pointer-identical `EastType*`. This would require the decoder to walk the type table bottom-up and canonicalize each entry through the type constructors before building parent types. Pros: fixes the underlying dedup bug. Cons: harder to implement, need to verify no regressions in existing interning.

**Option C: Walk order fix**

Make the C re-encoder walk types in the same order as the TS encoder. The TS encoder walks values first, then types at variant/struct boundaries. The C re-encoder should match this walk order exactly. Pros: no changes to interning. Cons: requires understanding the exact TS walk order and matching it precisely in C.

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
