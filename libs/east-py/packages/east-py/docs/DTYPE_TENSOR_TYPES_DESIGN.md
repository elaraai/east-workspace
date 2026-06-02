# DTYPE_TENSOR_TYPES_DESIGN — storage dtype for Vector / Matrix

Handover design for **PR #1** of a two-PR effort. This PR adds a **storage DType**
to East's `Vector` and `Matrix` types across all three implementations (east TS,
east-c, east-py) plus serialization and the compliance suite. It is a
self-contained, cross-language change that must land as **one PR**.

The follow-on production work (Python value ergonomics, eager C-backed methods,
the ad-hoc platform-function on-ramp) is in `EAST_PY_VALUE_PRODUCTION_PLAN.md` and
**depends on this PR being merged first**.

> This doc was adversarially reviewed against the real code; the file:line change
> surface below is verified, but **the enumerated lists are a starting point — the
> authoritative completeness check is the greps mandated in each section.** Two
> repo docs are stale and must be ignored as guides: east-py's
> `VECTOR_MATRIX_TYPES_DESIGN.md` (describes a pure-Python runtime that no longer
> exists — east-py delegates to east-c via a Cython bridge) and east-py's
> `CLAUDE.md` ("pure-Python compiler + 212 builtins").

---

## 0. Goal, scope, non-goals

**Goal.** Let `Vector`/`Matrix` store numeric buffers at a chosen precision
(f32, f16/bf16, narrow ints) for half-or-less memory and **true zero-copy** numpy/
torch interop — without disturbing East's scalar arithmetic.

**The model in one line.** `Vector`/`Matrix` carry a **DType** (physical storage)
in their type; the **logical element** (Float / Integer / Boolean) is *derived*;
reads *promote* storage→logical, writes *round* logical→storage.

**Hard invariants:**
1. **Scalars untouched.** `Float` stays f64, `Integer` i64 (bigint), `Boolean`
   unchanged. The whole scalar/expression/arithmetic/builtin layer does not change.
2. **Back-compat.** `VectorType(FloatType)` ≡ `VectorType(F64)` (same interned
   object). Existing `Vector<Float/Integer/Boolean>` keep identical meaning; existing
   serialized JSON IR and beast2 data decode unchanged.
3. **One PR, three languages** (the compliance corpus is exported from TS and run
   through east-c and the east-py bridge in lockstep).

**Initial DType coverage.** Implement and test **F64, F32, I64, Bool** first (native
typed arrays; promote/round is identity or a free widen). *Declare* all 10 cases now
so case indices never move; leave F16/BF16/I8/I16/I32/U8 **routed-but-stubbed** (see
§7-L10 for the required stub contract).

**Non-goals (this PR):** elementwise tensor arithmetic builtins (none exist in east-c;
numpy is the engine — see the production plan); changing scalar `Float`; the Python
ergonomics/eager-method work (PR #2).

---

## 1. The DType model

### 1.1 The DType set, and the case-index table the wire actually uses

DType is an East value — a nullary `VariantType` — so the type stays homoiconic.
**Declare all 10 cases now and only ever append new ones.** But note: `VariantType`
**sorts cases alphabetically on construction** (TS `types.ts:325-326`; east-c
`east_variant_type` re-sorts in `types.c:343-430`), and a variant value encodes its
case as a **varint of the *sorted* index**. So the **wire index is the alphabetical
position**, regardless of declaration order. **Pin this exact table in all three
languages — it is the most error-prone byte-level constant in the change (L4):**

| tag  | wire index (alphabetical) |
|------|----|
| BF16 | 0 |
| Bool | 1 |
| F16  | 2 |
| F32  | 3 |
| F64  | 4 |
| I16  | 5 |
| I32  | 6 |
| I64  | 7 |
| I8   | 8 |
| U8   | 9 |

> Internal enum ordering may differ per language (e.g. an east-c `EastDType` enum
> may be declared `F64,F32,…`), **as long as the serialized case index matches the
> table above.** Provide an explicit `EastDType ↔ wire-index` map in each language;
> never hardcode a guessed index.

Everything precision-related derives from one table (replaces the scattered
`Float→8/Integer→8/Boolean→1` literals):

| DType | logical elem | storage (np / C / JS) | bytes | get (storage→logical) | set (logical→storage) |
|------|--------------|------------------------|-------|------------------------|------------------------|
| F64  | Float   | float64 / double / Float64Array       | 8 | identity | identity |
| F32  | Float   | float32 / float  / Float32Array       | 4 | widen f32→f64 (free) | `(float)` / `Math.fround` |
| BF16 | Float   | uint16 bits / Uint16Array             | 2 | decode | round |
| F16  | Float   | uint16 bits / Uint16Array             | 2 | decode | round |
| I64  | Integer | int64 / int64_t / BigInt64Array       | 8 | identity (bigint) | identity |
| I32  | Integer | int32 / Int32Array                    | 4 | `BigInt(n)` | `Number(b)` + range check |
| I16  | Integer | int16 / Int16Array                    | 2 | `BigInt` | `Number` + range check |
| I8   | Integer | int8  / Int8Array                     | 1 | `BigInt` | `Number` + range check |
| U8   | Integer | uint8 / Uint8Array                    | 1 | `BigInt` | `Number` + range check |
| Bool | Boolean | bool(1) / Uint8ClampedArray           | 1 | `v != 0` | `v ? 1 : 0` |

`dtypeElement(dtype)` → Float (F*/BF16) / Integer (I*/U8) / Boolean (Bool).
**Default DType for a logical element** (back-compat): `Float→F64`, `Integer→I64`,
`Boolean→Bool`.

### 1.2 Read/write/compare semantics (must match across languages)
- `get(i)` returns the **logical** scalar promoted from storage. `VectorGet`/
  `MatrixGet` keep their logical return type → existing `assert.equal(v.get(0n),1.0)`
  tests still type-check and pass (the back-compat lever).
- `set(i,v)` rounds logical→storage. Narrow-int out-of-range **throws `EastError`**
  — pin the message format (e.g. `"Vector value <n> out of range for dtype I8"`) so
  cross-runtime `assert.throws(/pattern/)` tests are deterministic (`platforms.spec.ts:
  ~399`).
- `map`/`mapRows` output DType: default to the logical-default DType (Float→F64)
  unless an explicit dtype overload is given. Document.
- **Equality/ordering** (`equalFor`/`compareFor`; defines East's total order for
  SortedSet/SortedMap and compliance) MUST compute on **promoted logical values**,
  not raw storage bytes. **Canonicalize NaN to a single bit pattern (`0x7FF8…`) on
  decode** — pick one and pin it across the three runtimes, else f32 NaN payloads
  diverge. Preserve the existing f64 `-0.0`/NaN rules after promotion.

---

## 2. Authoritative TS API

```ts
import { VectorType, MatrixType, F32, F64, I64, Bool, FloatType } from "@elaraai/east";
const v32 = VectorType(F32);           // v.get(i) is a Float (f64)
VectorType(FloatType)                  // === VectorType(F64)  (same interned object)
$.const("v", new Float32Array([1,2,3]));   // expr/ast.ts maps Float32Array → VectorType(F32)
East.Vector.zeros(10n, F32);           // explicit dtype overload; no-dtype default stays F64
v32.get(0n)        // FloatExpr (f64), promoted
v32.set(0n, 3.14)  // rounds → nearest f32
```
`F16…Bool` are exported interned DType singletons parallel to `FloatType`. The
constructor's `toDType(arg)` accepts a DType **or** a legacy scalar type, resolving
legacy→DType **before** interning so `VectorType(FloatType) === VectorType(F64)`.

> **DType interning (underspecified — implementer must define):** mirror the existing
> `type_id_symbol`/`type_id` interning pattern in `types.ts` so each `F32` etc. is a
> deduped singleton with a stable `dtype_id`; Vector/Matrix intern on
> `hashCombine(0x56|0x4d, dtype_id)`.

---

## 3. Change surface — east (TypeScript, AUTHORITATIVE)

> TS defines the DType enum, the wire encoding, and the promote/round semantics;
> east-c/east-py mirror. Paths under `libs/east/src/`. **The `.element → .dtype`
> rename produces compile errors at exactly 40 non-spec sites — `grep '\.element\b'
> src/` is the authoritative completeness check; the lists below are not exhaustive.**

### 3.1 New DType value + type (`types.ts`, `type_of_type.ts`)
- Interned `DType` static value (§2) + a `DTypeType` homoiconic `VariantType` with the
  10 nullary cases; a `DTypeValue` union beside `EastTypeValue`; export the singletons.
- One source-of-truth `DTYPE_INFO` table (§1.1) replacing the `Float→8 …` literals.

### 3.2 Type rep + constructors (`types.ts:577-601`)
- `VectorType<D>`/`MatrixType<D>` carry **`dtype`** (rename `element→dtype`). Constructor
  `toDType` accepts legacy `EastType` or DType; resolve legacy→DType **before** hashing.

### 3.3 Predicates/unification/printing (`types.ts`)
- Update Vector/Matrix sites to read `dtype`, using `dtypeElement(dtype)` where a logical
  element is needed: `:424-426`, `:719-720`, `:759-760`, `:1025-1036`, `:1296-1299`
  (printType → `.Vector F32`, print-only), `:1405-1408`, `:1568-1579`, `:1740-1748`,
  `:1911-1919`, `:2061-2069`, `:2228-2236`.

### 3.4 Value↔buffer mapping (`types.ts`)
- `ValueTypeOf` `:824-831` and `EastTypeOf` `:855-857`: **the conditional-type match keys
  must change from logical types (`VectorType<FloatType>`) to DType singletons
  (`VectorType<F64>`, `VectorType<F32>`, …)**, mapping each to its typed array via a single
  `DTypeToArray<D>` helper (don't fan out branches — `:823` "keep TS fast").
- **Runtime `eastTypeOf` `:878-918` only infers `Uint8ClampedArray→VectorType(Boolean)`
  today** (no F64/I64 runtime branch); adding F32 etc. is a new runtime branch and
  collides with the U8↔Blob concern (L7). Keep U8 out of runtime inference.
- `isValueOf` `:1200-1210`: switch on `DTYPE_INFO[type.dtype].ctor` (`value instanceof
  ctor`; Matrix `value.data instanceof ctor`).

### 3.5 Homoiconic encoding (`type_of_type.ts`) — the load-bearing JSON change
- `:71-72` `EastTypeType` schema: `"Vector": DTypeType, "Matrix": DTypeType`. **Case
  indices are computed by alphabetical sort: Matrix=9, Vector=18 (non-adjacent). The
  change is payload-only, so these indices do not move — but derive them from the sort,
  never hardcode** (this drives L4 in east-c/east-py).
- `:239-248` `toEastTypeValue` → `variant("Vector", dtypeToValue(type.dtype))`.
- **`:292-293` `fromImpl` — THE back-compat decode rule (see §6).** Must branch on the
  child variant tag: a legacy child tag (`Float/Integer/Boolean`) → `VectorType(default
  DType)`; a DType child tag (`F64/F32/…`) → `VectorType(dtypeFromValue(t.value))`.
- `:399-400` `isTypeValueEqualImpl` → compare DType tags. `:699-700`,`:724-727`
  `expandTypeValue` → Vector/Matrix child is a leaf DType, no recursion.

### 3.6 Comparison (`comparison.ts`)
- `:53-58` `isFor` (identity) unchanged. `:149-170` `equalFor` / `:886-913` `compareFor`:
  `elem = dtypeElement(type.value)`, **decode storage→logical before comparing** (fixes the
  existing raw-`x[i]`/bool-not-converted behavior; required for F16/BF16 bit storage).

### 3.7 Expr builders + AST (`expr/vector.ts`, `expr/matrix.ts`, `expr/ast.ts`, `expr/block.ts`, `expr/libs/*`)
- **In `expr/vector.ts`/`matrix.ts` the `element_type` field is the *logical* element**
  (it feeds `type_parameters:[this.element_type]` — the builtin's logical `"T"` — and
  `VectorType(this.element_type)`). **Decision: store `dtype` on the builder; at every
  `type_parameters` slot and every logical-return-type slot pass `dtypeElement(this.dtype)`;
  use the raw `dtype` only for `VectorType(...)`/storage-allocation.** A blanket "rename
  element_type→dtype" is wrong here — `type_parameters` is a *logical* site. (~61
  `element_type` refs across the two files.)
- `ast.ts:56-83` typed-array→AST: add `Float32Array→VectorType(F32)`, `Int32Array→I32`,
  …; F64/I64/Bool keep current mapping. `:327-355` typed walk rounds per DType.
- **`expr/block.ts:78,80`** `new VectorExpr((ast.type as any).element,…)` / `MatrixExpr` —
  AST→Expr reconstruction; update to the new field.
- `expr/libs/vector.ts`/`matrix.ts`: `zeros/ones/fill/fromArray/fromRows` gain an optional
  dtype arg (default F64/I64/Bool from the value element).

### 3.8 Builtins, generic substitution, analyze, compile
- **`builtins.ts:1289-1304` `applyTypeParameters`** (the generic type-substitution engine —
  **outside** the §-old `1066-1218` range) builds `{type:"Vector", element:…}`. After the
  rename it must produce the dtype-bearing type; left unchanged → `Vector` with `element:
  undefined` → **buffer corruption for every generic builtin returning a tensor.** The
  builtin signature table (`:1066-1218`) keeps the logical `"T"`; the DType rides on the
  value's type (already passed to impls as a trailing `EastTypeValue`) — no new IR field.
- **`ast_to_ir.ts:995,1013`** `(ast.type as VectorType).element` → `dtypeElement(dtype)`.
- `analyze.ts:1756-1818`: element-exactness compares element **values** (logical) against
  `dtypeElement(node.value.type.value)`, NOT the DType. (Wrong → rejects every F32 vector.)
- `compile.ts`: `createTypedArray`/`allocateTypedArray` (`:1285-1309`) → `DTYPE_INFO[dtype]
  .ctor`; `NewVector`/`NewMatrix` (`:952-991`) round logical→storage; builtin impls
  (`:3203+`) apply get-promote/set-round/per-dtype alloc.

### 3.9 IR (`ir.ts`) — no new field
`NewVectorIR`/`NewMatrixIR` (`:294-306`, schema `:348-349`) carry `type: EastTypeValue`;
the DType rides inside `type`.

### 3.10 Serialization (TS) — see §6
- **JSON (the gating corpus):** the decode change is the `type_of_type.ts:292-293`
  child-tag branch (§3.5/§6). Value encoders/decoders `json.ts:423-447,921-989` (incl.
  `_createTypedArray` `:980-991`) derive ctor/width from the DType; values stay logical
  numbers/bools.
- **beast2 (binary):** `type-table.ts` — **pull Vector/Matrix OUT of the shared
  single-type-child branch** at encode `:191-194`, dispatch `:557-558`, build `:697-703`;
  the param becomes a **raw varint DType wire-index (§1.1 table), decoded directly to a
  DType singleton — do NOT `visitET` it** (it is not an `EastType`). Tag bytes `0x0E/0x0F`
  stay frozen. Value width: the **decode** sites `index.ts:410,422` switch to a DType→width
  table; the **encode** side `:225-236` already writes `value.buffer` verbatim and needs no
  width literal, BUT it relies on the typed array already being the right storage dtype.
  Version: `index.ts:47` magic byte + the version plumbing (§6).
- **East text:** value `vec[...]`/`mat[...]` parsers `east.ts:1475,1520` derive ctor from the
  DType; **type round-trip is via the homoiconic path** (`printTypeValue`/`fromImpl`), NOT a
  `.Vector`-grammar parser — `types.ts:1297-1299` is print-only diagnostics with no parser.
  (Do not look for a `.Vector Float` type parser to extend; it does not exist.)

---

## 4. Change surface — east-c (the runtime)

> Paths under `libs/east-c/packages/east-c`. east-c mirrors the TS wire/IR/type-of-type
> encoding byte-for-byte; internal representation may differ. **`grep -rn 'elem_size\|
> sizeof(double)\|sizeof(int64_t)' src/` is the authoritative width-site check.**

### 4.1 New foundation (`include/east/types.h` + new `src/dtype.c`)
```c
typedef enum { EAST_DTYPE_F64, EAST_DTYPE_F32, EAST_DTYPE_F16, EAST_DTYPE_BF16,
  EAST_DTYPE_I64, EAST_DTYPE_I32, EAST_DTYPE_I16, EAST_DTYPE_I8,
  EAST_DTYPE_U8, EAST_DTYPE_BOOL } EastDType;
```
plus `east_dtype_width`, `east_dtype_logical_kind`, `east_dtype_from_logical_kind`,
`east_dtype_promote`, `east_dtype_round`, **and an `EastDType ↔ wire-index` map matching
§1.1** (the enum order above is NOT the wire order). `east_dtype_width` returns a fixed `1`
for Bool (not `sizeof(bool)`).

**Width-hardcode sites to route through `east_dtype_width` (verified; not exhaustive —
grep):** `values.c:149-163` (`elem_size_for_type`, canonical — delete), `vector.c:60-66`
+ local callers `vector.c:124,138,180`, `matrix.c:32-38` + callers, `value_encode.c:131,
134,137,152,155,158`, `value_decode.c:199-206,226-233`, **`json.c:1398,1462,2429,2499`
(FOUR blocks)**, **`east_parser.c:1150,1205,2187,2234` (FOUR blocks)**.

### 4.2 Type node (`include/east/types.h:45-90`, `src/types.c`)
- Add a dedicated union arm `struct { EastType *element; EastDType dtype; } tensor;` for
  Vector/Matrix. **`element` MUST be the first member (union offset 0)** so existing
  `data.element` reads (and the bridge's `.pxd` `element` accessor) keep aliasing. Assert
  `sizeof(EastType)` unchanged with `_Static_assert` (the 4-pointer function/variant arm
  dominates; the `tensor` arm is smaller — verified safe).
- `east_vector_type`/`east_matrix_type` (`types.c:454-461`) gain a `dtype` param; **fold
  dtype into BOTH the intern hash (`intern_elem_type` `:281-291`) AND the verify predicate
  (`verify_elem` `:223-227`)** — else `VectorType(F32)`/`VectorType(F64)` collide to one
  interned type (L2). Back-compat wrapper derives dtype from element kind. Update equality
  `:790-795`, printing `:905-915`, cycle walkers `:523-528,577-586,683-689`.

### 4.3 Value (`include/east/values.h:91-101`, `src/values.c`, builtins)
- Add `EastDType dtype;` to the `vector`/`matrix` value arms (`element` first, offset-0).
- `east_vector_new`/`east_matrix_new` (`values.c:729-771`) gain a `dtype` param and size
  buffers `len * east_dtype_width(dtype)`. **Every caller threads a dtype** (grep
  `east_vector_new`/`east_matrix_new`: `vector.c`, `matrix.c`, `json.c`, `east_parser.c`,
  compiler, …) — and the bridge prototypes (§5).
- get/set: route `vec_get_elem`/`vec_set_elem` (`vector.c:33-45,47-58`) and `mat_get_elem`/
  `mat_set_elem` (`matrix.c:40-49,51-62`) through promote/round.
- **`vector_zeros_impl`/`ones`/`fill` (`vector.c:185-194,196-205,207-222`) and the matrix
  equivalents (`matrix.c:243-250,252-262,264-280`) IGNORE their type-param today** (hardcode
  `&east_float_type`/`sizeof(double)`); they must be **plumbed to read the dtype/type-param**,
  not merely have a width swapped. `IR_NEW_VECTOR/MATRIX` direct casts (`compiler.c:966-1000,
  1002-1036`) round per dtype.
- Equality/compare (`values.c:973-988` equal; `:1177-1187` vec-compare, `:1189-1201`
  mat-compare): width from dtype AND **compare on promoted logical values** (replace raw
  `memcmp` — `:978,987,1183,1197`) to match TS (L8). Value printing `:1366-1389/1391-1421`
  switches via promote.

### 4.4 Serialization + type-of-type (C) — wire-critical
- **JSON:** encoders `json.c:340-410` (read `(double*)data` by kind → must promote per
  dtype); decoders — the four width blocks in §4.1. The **back-compat decode rule** (§6) is
  in `type_of_type.c` (below), not here.
- **type-of-type (the homoiconic payload — MOST error-prone):** the Vector/Matrix payload
  is defined in the `names[]`/`types[]` arrays at **`type_of_type.c:228-255` — specifically
  the `Vector→rec`/`Matrix→rec` entries at `:251-252`** (NOT `:343-344`, which are the
  `c_new_vector`/`c_new_matrix` *IR-node* structs). Change `rec` → the new `DTypeType`
  variant. Encode `:984-995` and decode **`:646-661` (TT_VECTOR/TT_MATRIX)** must branch on
  the child tag: legacy `Float/Integer/Boolean` → default DType (back-compat); DType tag →
  use directly. Build the `DTypeType` singleton in the type-of-type init (near `:228`).
- **beast2:** `type_table.c` — **split Vector/Matrix out of the shared single-child branch**
  at encode `:210-218`, Phase-1 parse `:329-331`, Phase-2 build `:405-408` (else
  `east_vector_type(types[dtypeIdx])` indexes the type array OOB); the param is a raw
  DType wire-index. **Value-encode width is NOT frozen** — `value_encode.c:124-161` (vec
  124-140, mat 142-161) branches on logical kind and writes `vlen*sizeof(double)`; it must
  use `east_dtype_width(dtype)` or it over-reads an f32 buffer. `value_decode.c:192-243`
  likewise. Version dispatch: §6.
- east-text printer `east_printer.c:549-587,589-635` + type `:712-718`; parser
  `east_parser.c`. legacy `beast.c` (155/716/915) keeps throwing — leave.

### 4.5 type-of-type py↔C are NOT line-for-line mirrors
`type_of_type.py:96` has `("Recursive", IntegerType)` while `type_of_type.c:247` has a
Variant — they already diverge on a different case. Only the **case order and wire indices**
must agree across py/C/TS, not the structural payloads of unrelated cases.

---

## 5. Change surface — east-py (small — it's a bridge)

> east-py delegates compile/execute/serialize to east-c via Cython (`runtime/compiler.py:
> 5-9`, `beast2.py:31-36`). **Do not** reimplement beast2/json/runtime in Python.

- **`east/_eastc.pxd`**: add `EastDType dtype` to the `vector`/`matrix` value-data structs
  (`:237-245`) and the tensor type arm. For `cdef extern from` structs Cython uses **by-name**
  field access — **field order is irrelevant**; only the new field's name+type must match
  (the L1/L5 "offset must match" framing is overstated — what matters is name/type, and that
  C keeps `element` at offset 0). **Also update the `east_vector_new`/`east_matrix_new`
  prototypes (`:320-321`)** to the new dtype-taking signatures, and **add `BuiltinImpl` +
  `builtin_registry_get`** only if PR #2 needs them (not this PR).
- **`east/_eastc_bridge.pyx`** — the itemsize contract (load-bearing):
  - c→py `_c_vector_to_py` (`:598-607`, memcpy `:606`) / `_c_matrix_to_py` (`:610-622`, memcpy
    `:620`): choose the numpy dtype from the **storage DType** and `memcpy n*east_dtype_width`;
    the resulting `EastVector`/`EastMatrix` holds the **storage-dtype** numpy array (true
    zero-copy f32). `.element_type` is the logical type.
  - py→c `_py_vector_to_c` (`:1070-1082`, memcpy `:1080`) / `_py_matrix_to_c` (`:1085-1099`,
    memcpy `:1097`): pass the dtype to `east_vector_new/new`; the numpy array's itemsize must
    equal `east_dtype_width(dtype)`. **Without this fix, a `Vector<F32>` (4-byte C buffer)
    read into a float64 numpy array memcpys `n*8` → 2× over-read.**
  - TT mirror (`:213/218`, `:763/768`): track the payload-shape change.
- **`east/types/values.py`**: `EAST_ELEMENT_TO_DTYPE` (`:163-167`) becomes a **DType→numpy**
  map agreeing with `east_dtype_width`; **extend `EastVector.__slots__` (`:182`) / `EastMatrix
  .__slots__` (`:236`) for the storage-dtype attribute**, and **fix `EastVector.__eq__`
  (`:209-217`) / `EastMatrix.__eq__` to compare on promoted logical values** (an f32-vs-f64
  `.data` won't be `np.array_equal` even when logically equal — L8 at the Python layer).
  `is_value_of` for Vector/Matrix checks dtype↔buffer (fixes audit BUG-3 — see production
  plan). Add construction dtype/contiguity guards.
- **`east/types/type_of_type.py:79-119`**: mirror the new DType case order (§1.1 table) and the
  Vector/Matrix payload (child = DTypeType).

> **Bridge-corruption guard:** Cython does not validate the `.pxd` against the C headers, so a
> mismatch is a silent **runtime** memory corruption (not a compile error), surfacing only in
> Step 3's corpus run. Add a smoke test that reads one F32 vector through the bridge **before**
> the full corpus, and consider a `_Static_assert(offsetof(...))` mirror in a C test.

---

## 6. Serialization & wire format — the migration contract (two surfaces)

**The compliance corpus is JSON, not beast2** (`test_compliance.c:266` `east_json_decode`;
`test_compliance.py:122` `compile_from_json`; `test:export` writes `JSON.stringify`). So
there are **two distinct back-compat surfaces**, and the gating one is JSON:

**Surface 1 — JSON / homoiconic type-of-type (THE gating one).** A Vector type serializes as
`{"type":"Vector","value":{"type":"Float","value":null}}` today. The new encoder emits
`{"type":"Vector","value":{"type":"F64",...}}`. **The load-bearing back-compat decode rule
(TS `type_of_type.ts:292-293`; east-c `type_of_type.c:646-661`; east-py
`type_of_type.py`):** branch on the child variant tag — `Float/Integer/Boolean` → default
DType (`F64/I64/Bool`); `F64/F32/I64/…` → that DType. There is **no version byte in JSON**;
tag disambiguation is the only lever. This is what keeps the frozen-fixture (§9.2) and all
existing JSON IR decoding.

**Surface 2 — beast2 binary (round-trip test only, NOT the corpus).** Frozen: tag bytes
`0x0E/0x0F`; value byte-layout `len+rawBytes`; F64/I64/Bool value bytes are byte-identical.
Changed: the type-table param (type-child-index → raw DType wire-index, split out of the
shared branch — §4.4); the value **width derivation** inside the encoder/decoder (logical-kind
→ `east_dtype_width`). **Version dispatch must be BUILT — it does not exist today:**
- TS `verifyMagic` (`index.ts:49-58`) returns `void` and **hard-rejects** any non-`0x04`
  8-byte magic. To support `0x05`: change `verifyMagic` to **accept `0x04||0x05` and return
  the version**; add `version` to `DecodeContext` (`index.ts:82-90`); thread it through the
  three decode entry points (`index.ts:742,812,842`) into `readTypeTableSection`/the static
  `ENTRY_PARSERS` so `parseSingleParam(TAG_VECTOR/MATRIX)` picks v4 (type-child) vs v5
  (DType-index) parsing.
- east-c does a whole-8-byte `memcmp(data, BEAST2_MAGIC, 8)` returning NULL on mismatch at
  **`full.c:126,185,235,298`**; accept both `0x04` and `0x05` and thread the version into
  `read_type_table_section` (`type_table.c`). Bump `BEAST2_MAGIC[7]` (`tags.c:34`) /
  `MAGIC_BYTES` (`index.ts:47`) to `0x05` for new encoders.
- Fix stale version comments while here: `index.ts:44`, `beast2.md:~194` ("currently 1"),
  `beast2/SPEC.md:6,114`.

> **Decision to confirm (§10):** whether beast2 binary back-compat with pre-existing `0x04`
> blobs is even in scope. The JSON tag-sniff (Surface 1) is mandatory regardless; the beast2
> version plumbing (Surface 2) is only needed if old binary data must decode. If not in scope,
> a hard version cut is simpler — but say so explicitly.

East-text and JSON values stay logical decimals/bools — no value-wire change.

---

## 7. Landmines (consolidated)

- **L1 — Struct ABI / aliasing.** Put `dtype` in the `tensor` union arm with `element` as the
  **first** member (offset 0) so `data.element` keeps aliasing; assert `sizeof(EastType)`/
  `sizeof(EastValue)` unchanged. For the `.pxd`, `cdef extern` uses by-name access — match
  field **name+type**, not offset.
- **L2 — Interning** (TS `hashCombine`; C `intern_elem_type` + `verify_elem`): fold dtype into
  hash AND verify, resolving legacy→DType before hashing.
- **L3 — Width hardcodes:** grep-mandated (§4.1); json.c/east_parser.c each have **4** blocks.
- **L4 — Wire case-index order is alphabetical** (§1.1 table); supply an explicit map per
  language, never hardcode a guessed index. type-of-type case indices: Matrix=9, Vector=18.
- **L5 — Bridge itemsize:** numpy array must be the **storage** dtype on both sides (§5).
- **L6 — bigint↔number narrow ints:** `get` widens to BigInt; `set` `Number()`+range-check,
  **throw with a pinned message** on overflow.
- **L7 — U8↔Blob collision** (`Uint8Array` is how Blob is runtime-inferred): keep U8 out of
  runtime type-inference; valid only with an explicit `VectorType(U8)` target. Defer U8.
- **L8 — Compare on promoted logical values**, not raw bytes; canonicalize NaN (§1.2). Applies
  in TS, east-c (`values.c` memcmp sites), AND the Python `EastVector.__eq__`.
- **L9 — F16/BF16 have no native typed array** (`Uint16Array` bits + encode/decode). Ship
  F32/F64/I64/Bool first.
- **L10 — Stub contract for unimplemented dtypes:** keep them out of the corpus (L-test gate),
  and make any stubbed dtype **throw loudly** (not silently no-op/corrupt) if one reaches
  promote/round — so an accidental corpus entry fails rather than corrupts.
- **L11 — Stale docs:** east-py `CLAUDE.md` + `VECTOR_MATRIX_TYPES_DESIGN.md` describe a
  pure-Python runtime that no longer exists.

---

## 8. Implementation order (within the one PR) + gates

> Dependency reality: **TS is authoritative → east-c mirrors → east-py bridge links east-c
> source** (`east-py` `make install` recompiles east-c into the Cython extension). TS (`libs/
> east`) has **no** dependency on the east-c native build. `test:export` runs `rm -rf
> /tmp/east-test-ir` first, so `/tmp` is **not** a durable freeze — the only durable copy is the
> committed fixture.
>
> **Per-lib gate discipline:** the test gates below are the correctness floor; ALSO run each
> touched lib's lint before moving on — `libs/east`: `make lint`; `libs/east-c`: `make lint`;
> `libs/east-py`: `make check` (= lint + typecheck + test). Every step must be green in its own
> lib before the next.

**Step 0 — Freeze the legacy corpus FIRST (committed JSON fixture).**
```
mkdir -p libs/east-c/packages/east-c/tests/fixtures/legacy-ir
cd libs/east && make test-export
cp /tmp/east-test-ir/Vector.json /tmp/east-test-ir/Matrix.json \
   ../east-c/packages/east-c/tests/fixtures/legacy-ir/
git add libs/east-c/packages/east-c/tests/fixtures/legacy-ir   # must be committed
```

**Step 1 — east (TS), authoritative.** §3 in full + new specs (§9). Gate:
```
cd libs/east && make build && make test && make test-export
```
TS green AND new corpus (incl. `VectorDType.json`) emitted. **TS green before touching C.**

**Step 2 — east-c.** §4 in full, incl. the JSON child-tag back-compat rule. Gate (run from
`libs/east-c`; the legacy-ir path is relative to that cwd):
```
cd libs/east-c && make build && make test-east-c
./packages/east-c/scripts/run_compliance.sh packages/east-c/tests/fixtures/legacy-ir
make leak-check        # ASAN over the new corpus (/tmp/east-test-ir)
```
New corpus AND frozen legacy fixture pass; no leaks.

**Step 3 — east-py bridge.** §5. Gate (lib-level target — the real compliance gate, matching
CI):
```
cd libs/east-py && make install && make test-east-py
```
Every parametrized compliance file (incl. `VectorDType`) green through the bridge.

**Step 4 — Full cross-lib gate.**
```
cd <repo root> && make test-export && make test-all
```

> Between Step 1 and Step 2 `make test-all` is **red by construction** (new corpus vs old
> engine) — do not push a half-state to a green-expecting CI. All-or-nothing, strictly ordered.

---

## 9. Test strategy

### 9.1 New specs (corpus flows for free — runners glob `*.json`)
Add `libs/east/test/vector_dtype.spec.ts` + `matrix_dtype.spec.ts`
(`describeEast("VectorDType",…)`). Cover: (1) **back-compat default** — `Vector.zeros(3n)` ⇒
F64; explicit-F64 ≡ default-F64; (2) **F32 round-trip exact** (`set 1.5/0.25/3.0` then
`assert.equal`); (3) **F32 get-promotion** (`get().add(0.5)` in the f64 layer); (4) **F32
set-rounding** (`set 0.1` then `assert.between`); (5) I64+Bool under explicit DType; (6)
Matrix variants + `getRow/getCol/transpose/toVector` preserve DType; (7) **beast2 + JSON
round-trip of the DType** (forces the encoders to carry it — mirror `blob.beast2.spec.ts`);
(8) a stubbed dtype (e.g. F16) **throws** if used (L10).

### 9.2 Back-compat — two distinct proofs (relabeled)
- **(a) Behavioral parity (re-exported):** the *unchanged* `vector.spec.ts`/`matrix.spec.ts`,
  re-exported from the changed TS, still pass on C and py. This tests **new→new** (the JSON now
  carries `{type:F64}`) — it proves default-DType behaves like the old Float vector, **not**
  wire back-compat.
- **(b) Wire back-compat (frozen old JSON):** run the **new** east-c against the **committed
  Step-0 fixture** (`{"type":"Vector","value":{"type":"Float",…}}`) → proves old serialized JSON
  decodes via the §6 child-tag rule. **Add as an explicit CI step** in `test-east-c.yml`,
  pointing at the **committed** dir (decoupled from the artifact export, which re-exports from
  the PR's own TS):
  ```yaml
  - run: ./packages/east-c/scripts/run_compliance.sh \
         packages/east-c/tests/fixtures/legacy-ir build/packages/east-c/test_compliance
  ```
  This is the only thing that tests old bytes; without it wire back-compat is silently untested.

---

## 10. Decisions to confirm against TS authority
1. **Field name** `element → dtype` on TS `VectorType`/`MatrixType` (recommended; forces
   call-site review). east-c keeps a derived logical `element` (offset 0) + `dtype`.
2. **beast2 binary back-compat scope.** JSON tag-sniff (§6 Surface 1) is mandatory. The beast2
   `0x04→0x05` version plumbing (Surface 2) is needed **only if** pre-existing binary blobs must
   decode — confirm in/out of scope; if out, take a hard version cut and say so.
3. **`map`/`mapRows` output dtype** default = logical-default (Float→F64) unless an overload.
4. **Initial dtype set** = {F32,F64,I64,Bool}; all 10 cases declared (frozen §1.1 order);
   F16/BF16/I8/I16/I32/U8 gated out of the corpus and throwing-if-used (L10).
5. **U8** runtime-inference participation (Blob collision, L7) — likely defer.
6. **NaN canonical bit pattern** (§1.2/L8) and the **narrow-int overflow error message**
   (§1.2/L6) — pin both so cross-runtime tests are deterministic.
