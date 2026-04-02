# East-py Performance Profile

14 xlarge test functions (arrays, dicts, loops, variants, structs, sorting, strings). BEAST2 format, all Cython extensions active. Times in seconds.

## Cumulative phase totals (BEAST2, xlarge)

| Phase | Baseline | +Cython Ordering | +Monolithic Decoder | +Closure Opts |
|---|---|---|---|---|
| Deserialize | 1.88s | 1.81s (-4%) | 0.76s (-58%) | 0.76s (unchanged) |
| Compile | 0.35s | 0.34s (-2%) | 0.34s (unchanged) | 0.34s (unchanged) |
| Execute | 0.17s | 0.17s (-2%) | 0.17s (unchanged) | **0.10s (-35%)** |
| **Total** | **2.40s** | **2.32s (-4%)** | **1.27s (-45%)** | **1.20s (-5%)** |

Wall-clock totals for closure opts measured via `time.perf_counter()` A/B test (5 runs, median of 4).

---

## 1. Cython Ordering (`_ordering_cy.pyx`)

`CyEastKey` cdef class with C-level `tp_richcompare`, primitive comparers via `libc.math`, accelerated `compare_for`/`equal_for`/`is_for` factories.

**-4% total.** Best on ordering-heavy workloads: `complex_sort` -8%, `deep_struct` -17%.

## 2. Monolithic BEAST2 Decoder (`_beast2_cy.pyx` rewrite)

Single recursive `cdef decode_value()` replacing closure-per-type factory. Inline C reads, `PyUnicode_DecodeUTF8`, `memcpy` for float64, per-type caches.

**-58% deserialization, -45% total.** Best: `dict_struct_keys` -98%, `dict_lookup_stress` -60%, `string_stress` -54%.

## 3. Compiler Runtime Closure Optimizations

- **In-place loop vars** — `forarray/forset/fordict` sync+async set loop vars directly in env dict, restore after loop. Eliminates ~106k dict copies + propagation scans.
- **Builtin codegen** — `gen_builtin_sync` uses `exec()` at compile time to produce closures with direct positional args. 117 compile-time calls serve 25k runtime calls.
- **Dispatch dict** — `_compile_ir` uses dict lookup instead of 34-entry if/elif chain.

**-35% execute phase, -5% total.** Deser and compile unchanged.

Note: struct/variant codegen rejected — compile-to-runtime ratio inverted (8k+ exec() calls for ~2k runtime calls).
