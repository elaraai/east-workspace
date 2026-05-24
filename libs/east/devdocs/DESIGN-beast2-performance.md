# Beast2 v4 Performance Analysis

## Overview

Beast2 v4 is the binary serialization format for East values, including functions with IR and closures. This document captures profiling results comparing the TS (Node.js) and C runtimes on a realistic workload: a UI component tree with 20 dashboards and 1640 closures.

## Benchmark Setup

### Generating test data

```bash
cd libs/east
npx tsx contrib/examples/beast2_v2_benchmark.ts
```

This produces:
- `/tmp/ui.beast2` — 651KB UI component tree (value blob)
- `/tmp/ui_fn.beast2` — 543KB IR function blob (function returning the UI tree)

### Running TS benchmark

```bash
cd libs/east
npx tsx contrib/examples/beast2_v2_benchmark.ts
```

Outputs encode/decode/IR pipeline timings with CPU profiles (`beast2_*.cpuprofile`).

### Running C benchmark

```bash
cd libs/east-c

# Build profiler
gcc -O2 -g -o /tmp/profile_beast2 \
  -I packages/east-c/include \
  packages/east-c/scripts/profile_beast2_decode.c \
  -L build/packages/east-c -least-c \
  -L build/packages/east-c-std -least-c-std \
  -lm -lpthread -lcurl $(pkg-config --libs libpcre2-8 2>/dev/null || echo /usr/lib/x86_64-linux-gnu/libpcre2-8.so.0)

# Value decode + re-encode
/tmp/profile_beast2 /tmp/ui.beast2 10

# IR decode + compile + execute
/tmp/profile_beast2 --ir /tmp/ui_fn.beast2 10

# perf profiling (Linux)
perf record -g -o /tmp/perf.data /tmp/profile_beast2 --ir /tmp/ui_fn.beast2 20
perf report -i /tmp/perf.data --stdio --no-children -g none
```

## Results (2026-04-14)

### Value encode/decode (651KB UI tree, no functions)

| | TS | C | Speedup |
|---|---|---|---|
| Encode | 263 ms | 39 ms | **6.7x** |
| Decode | 154 ms | 62 ms | **2.5x** |

### IR decode + compile + execute (543KB, 1640 closures)

| Phase | TS | C | Notes |
|---|---|---|---|
| Beast2 decode | 57 ms | 81 ms | C includes lazy convert_ir |
| Compile | 86 ms | ~0 ms | C uses tree-walking (no compile step) |
| Execute | 7 ms | 231 ms | TS JIT-compiles to native JS closures |
| **Total** | **140 ms** | **312 ms** | TS faster end-to-end |

Note: TS `analyzeIR` (static analysis) takes 12,194 ms but is NOT needed for decoded IR — it was already valid when encoded. The beast2 decoder casts directly to `AnalyzedIR`.

### C perf profile breakdown

```
east_gc_collect:     45.4%  ┐
gc_traverse:         32.6%  │ 96.3% GC
subtract_ref:        10.0%  │
rescue_visit:         8.3%  ┘
beast2_decode:        0.5%
convert_ir:           0.2%
eval_ir:              ~2%
malloc/free:          0.7%
```

**96% of C execution time is garbage collection.** The cycle collector traverses the entire object graph on every collection. With 1640 closures creating thousands of temporary values, GC dominates.

## Architecture

### Beast2 v4 blob layout

```
magic[8]              0x89 "East" 0x0D 0x0A 0x04
type_table_section    all unique EastType entries
string_table_section  all unique strings
source_map_section    location stacks for IR debugging (global)
value_table_section   all mutable containers (Array/Set/Dict/Ref)
value_stream          root value, type-directed encoding
```

All five sections are **global** — shared across the entire blob. See `libs/east/src/serialization/beast2/SPEC.md` for the complete specification.

### Key design decisions

1. **Unified encoder/decoder**: One `beast2_encode_value`/`beast2_decode_value` handles all types including function IR. No separate IR encoder/decoder (SPEC Rule #1).

2. **Lazy IRNode conversion**: Beast2-decoded functions store the `source_ir` (EastValue variant tree) and defer `convert_ir` to the first `east_call`. This makes decode as fast as possible.

3. **loc_id on IRNode**: IRNode stores `int64_t loc_id` instead of `EastLocation*` arrays. Resolution to filename/line/column happens lazily at error-printing time via the source map.

4. **Source map propagation**: The source map is discovered from function values during the value table walk and written to the blob's global source map section. Decoded functions receive the source map from the decode context.

## Optimization opportunities

### C GC (highest impact)

The cycle collector (`east_gc_collect`) is the dominant bottleneck. Options:
- **Generational GC**: Track young/old generations, only collect young objects frequently
- **Reduce GC frequency**: Trigger less often (e.g., only when allocation pressure is high)
- **Arena allocation for IR evaluation**: Temporary values during eval could use an arena freed at function return, avoiding individual refcount/GC overhead
- **Immutable value interning**: Integers, strings, and other immutable values could be interned to reduce allocation

### C decode performance

Currently fast (0.5% of total), but could be further optimized:
- **Struct dedup**: Already implemented via byte-range hashing (wyhash). Hit rates are high for IR type annotations.
- **Value table pre-allocation**: Pass 1 pre-allocates, pass 2 fills in reverse order. Could potentially merge into single pass for simple cases.

### TS decode performance

- **GC pressure**: 63% of decode time is GC. Could reduce by pooling BufferReader instances or using typed arrays more efficiently.
- **analyzeIR skip**: Already skipped for decoded IR. If accidentally called, it adds 12+ seconds.
