# EAST_PY_VALUE_PRODUCTION_PLAN — using East values as plain Python data

Handover plan for the **Python production work** (PR #2 onward) that makes East
runtime values pleasant and safe to use as **plain Python data**, gives them an
**eager fluent method API backed by the east-c builtins**, and turns a plain-Python
data-science POC into an **ad-hoc platform function** with minimal ceremony.

**Depends on `DTYPE_TENSOR_TYPES_DESIGN.md` (PR #1) being merged first.** Several
items here assume the dtype model exists (zero-copy f32 torch interop; the
`Vector/Matrix` dtype-aware `is_value_of`). Where an item is unblocked without it,
it is marked **[independent]**.

> Architectural ground truth: east-py is a **Cython bridge to east-c**, not a
> parallel Python runtime (`runtime/compiler.py:5-9`). All IR compilation, builtin
> resolution, execution, and serialization happen in east-c. The package
> `CLAUDE.md`'s "pure-Python compiler + 212 builtins" description is **stale** — do
> not port builtins to Python.

The four strands:
- **A** — values as data, safely (exports, ergonomic+validating construction, runtime
  type-check/coerce, `EastTypeError`).
- **B** — eager fluent methods that execute **now** and marshal to the east-c
  builtins (NOT an IR builder; NOT a Python reimplementation).
- **C** — the `@platform_function` on-ramp + the worked `flow_matching.py` migration.
- **D** — docs / SKILL.

---

## 0. The North Star

Today, to call a plain-Python data-science POC from East you must **rewrite it** as
an East function using the IR DSL. The goal is to delete that rewrite: write the POC
in ordinary Python using East *values* as the data containers and their eager
methods as the operations, then wrap it as a platform function (Python impl,
East-typed signature) with a thin decorator. The POC *is* the platform-function body.

Two distinctions that govern every design choice here:
1. **Eager, not IR.** `arr.group_by(k).sort()` computes immediately on in-memory data
   and returns a new value (like pandas `.groupby`), unlike the TS
   `East.function(($)=>arr.groupBy())` path which builds IR and compiles later.
2. **Marshal to C, never reimplement.** Eager methods route through the existing
   python↔c bridge into the optimized east-c builtins. We do not maintain builtin
   logic in Python.

---

## 1. Bug audit — fix as issues (independent; do these first)

All confirmed by running the package. File:line in `east/types/values.py` unless
noted. BUG-3 overlaps PR #1 (the dtype work fixes it properly).

| ID | Sev | Site | Issue | Fix |
|----|-----|------|-------|-----|
| **BUG-1** | CRIT | `:1316-1338` | `type_of()` raises on **every real `EastVariant`** — `CyEastVariant` is neither `dict` nor `EastStruct`, so it falls through to `raise TypeError`. Breaks `type_of` on any struct/array/dict containing a variant. | Add an explicit `isinstance(value, EastVariant)` branch **before** the dict fallback: `return VariantType([(value.type, type_of(value.value))])` (single-case; lossy by nature — document). |
| **BUG-2** | HIGH | `:1180-1203` | `is_value_of` matches struct fields **positionally**, so `EastStruct({'b':…,'a':…})` fails against `StructType([('a',…),('b',…)])` — but the C bridge `_py_struct_to_c` (`_eastc_bridge.pyx:1022`) keys by **name** and marshals it fine. Validator stricter than the runtime it guards. | Name-key the struct branch (look up `value[field_name]`); reject only on missing field / type mismatch, not order. |
| **BUG-3** | HIGH | `:1116-1121` | Vector/Matrix `is_value_of` ignores element type **and** numpy dtype — `Vector<Integer>` validates as `Vector<Float>`. | Folded into PR #1: check `value.dtype` (storage DType) against the type's DType. Until then, at least compare `element_type` + numpy `dtype`. |
| **BUG-4** | MED | `:1112` vs `:1295` | Blob asymmetry: `is_value_of` accepts `bytearray`, `type_of` rejects it. | Broaden `type_of` to `(bytes, bytearray)` and coerce to `EastBlob` (preferred for strand A). |
| **BUG-5** | MED | `:850-905` | `EastSome`/`EastNone` build plain `EastVariant`, never `EastOption`, so `is_east_option` is dead. | Route `some`/`none` through one representation; either drop `EastOption`/`is_east_option` or make the helpers produce it. |
| **BUG-6** | LOW | `:1055-1061,1206-1219` | `is_east_variant` returns True for a 2-key dict, then `is_value_of`'s Variant branch crashes on `value.type` (dicts have no `.type`). | Drop dict support in `is_east_variant`, or use `value["type"]` in the Variant branch. Aligns with banning hand-rolled variants. |
| **BUG-7** | LOW | `:1313-1315` | `type_of` of a cyclic ref infinite-loops (no visited set; `is_value_of` has one). | Add a `nodes_visited` guard to `type_of`. |

**Cross-layer inconsistency to resolve while here:** the validator is simultaneously
*stricter* (struct order, BUG-2) and *looser* (vector dtype, BUG-3) than the C bridge
it guards. The `coerce_to` entrypoint (§2.3) produces canonical, bridge-ready values
and resolves both at the source.

---

## 2. Strand A — values as data, safely [independent]

### 2.1 Export surface (the single biggest blocker)
`east/__init__.py` exports only `CYTHON_EXTENSIONS`; `east/types/__init__.py` exports
nothing. A plain-Python user cannot `from east import EastArray, IntegerType,
is_value_of`. **Populate a curated public surface** (mirror `libs/east/src/index.ts`'s
flat re-export): the value classes (`EastArray/Set/Dict/Struct/Variant/Vector/Matrix/
Ref/Blob/Null`), the type constructors + `is_*_type` guards, `is_value_of`/`type_of`,
the ordering fns (`compare_for/equal_for/less_for/make_east_key` from `utils/ordering`),
plus the new constructors/validators below. Ship `py.typed` is already present.

### 2.2 Ergonomic + validating constructors
No `variant()`/`some`/`none`/`match()` exist in east-py (the workspace rule "never
hand-roll variants — always `variant()`/`some()`/`none`" has no Python equivalent; and
`EastVariant.__eq__`/`type_of` currently *accept* the forbidden 2-key
`{"type":…,"value":…}` dict shape — tighten that). Add, and export:

```python
def variant(case: str, value: EastValue, typ: EastType | None = None) -> EastVariant:
    """If typ (a VariantType) is given, validate case ∈ cases and value conforms."""

def some(value: EastValue) -> EastVariant: ...
none: EastVariant = EastVariant("none", east_null)        # a value, not a call

def match(v: EastVariant, cases: dict[str, Callable[[Any], R]],
          default: R | None = None) -> R:                 # the one true gap vs TS
    f = cases.get(v.type); return default if f is None else f(v.value)

def struct(fields: dict[str, EastValue], typ: EastType | None = None) -> EastStruct:
    """If typ given, reorder fields to the type's order + coerce/validate (fixes BUG-2)."""

def array(element_type: EastType, items: Iterable, *, validate: bool = True) -> EastArray:
    """Coerce each item via coerce_to(item, element_type)."""
```
Result: the painful `Array<Struct>` construction becomes
`array(T, [{"name":"a","age":1}, …])` (dicts coerced+validated), pandas-ergonomic, and
bridge-ready.

### 2.3 Runtime validation / coercion / errors (the heart of strand A)
What exists: `is_value_of(value, type) -> bool`, `type_of`, the `is_east_*` TypeGuards.
What's missing — add and export:

```python
class EastTypeError(EastError):
    """Value/type validation failure at a Python<->East boundary (path-pinpointed)."""
    def __init__(self, message, *, value=None, expected: EastType|None=None, path="$"): ...

def assert_value_of(value, typ, *, path="$") -> EastValue:
    """Validate; raise EastTypeError with a reason. Returns value."""

def explain_value_of(value, typ) -> list[tuple[str, str]]:
    """[(json-path, reason), …]; empty == conforms. e.g. ("$.rows[2].score","expected Float, got int")"""

def coerce_to(value: object, typ: EastType, *, path="$") -> EastValue:
    """Best-effort canonicalization driven by the DECLARED type:
       int->Float, list->EastArray(elem), dict->EastStruct(name-keyed+reordered to type),
       bytes/bytearray->EastBlob, list/np.ndarray->Vector/Matrix at the type's DType.
       Raise EastTypeError on the irreconcilable. Produces bridge-ready values."""
```
> **PR #1 coupling:** `coerce_to`'s `list/np.ndarray → Vector/Matrix` branch reads the
> type's **DType** (a PR #1 feature). This one sub-path is **not** `[independent]` — pre-PR#1
> it must fall back to today's `element_type`→numpy-dtype mapping (mirror BUG-3's interim).
> The rest of `coerce_to` and all of strand A are dtype-free.
`coerce_to` is the linchpin: it makes a value the C bridge will accept without surprise
(name-keyed struct per BUG-2; correct-dtype Vector per BUG-3/PR #1), and lets POC authors
write native Python and get a validated East value at the boundary (strand C).

**Note on Integer-vs-Float (parity with TS):** TS `isValueOf` Integer requires `bigint`;
Python has no split, so a Float-intended `3` (an `int`) silently passes as Integer. Always
decide Integer-vs-Float from the **declared type** in `coerce_to`, never from `type_of`
inference alone.

---

## 3. Strand B — the full eager value surface

**Scope: a full mirror of the East builtin library**, exposed eagerly on the Python value
objects — 1:1 with the TS namespaces, not a curated subset. §3.1-3.5 are the runtime
machinery (how a call reaches east-c); §3.6-3.8 are the delivery (how the whole surface is
generated, what it looks like per value, and a worked example).

### 3.1 What already exists (verified)
- A **name→impl builtin dispatch table in east-c, reachable with no IR compile**:
  `builtin_registry_get(reg, "ArraySort", type_params, n)` → flat
  `EastValue*(*)(EastValue**, size_t)` (`east-c builtins/registry.c:39`, `builtins.h:11`;
  undotted names `"ArraySort"`, `"ArrayConcat"`, …). The populated registry global
  (`_builtins`) lives in **`east/runtime/_compiler_eastc.pyx`** and is **lazily** initialized
  by `_ensure_runtime()` (→ `east_register_all_builtins`); nothing initializes it until the
  first compile. `_eastc.pxd` already exposes `east_current_builtins()` and
  `east_set_thread_context`, but **not** `builtin_registry_get` or the `BuiltinImpl` typedef.
- A **zero-copy C-backed proxy system**: `EastArrayProxy`/`EastSetProxy`/`EastDictProxy`
  hold a live `EastValue*` and route ops through east-c (`_eastc_bridge.pyx:1370+`);
  `py_value_to_c` short-circuits proxies with no copy (`:853-868`). So chained C results
  stay C-side. (Note: the *existing* `EastArrayProxy.sort()` at `:1454` fakes it with
  Python `list.sort` — wrong ordering + slow; this is the thing to replace.)

### 3.2 The `call_builtin` shim (the unlock; ~40 lines Cython)
A `call_builtin(name, type_param_py_types, args_with_types)` that: calls `_ensure_runtime()`
to guarantee the registry is initialized, gets the registry via the already-exposed
`east_current_builtins()`, builds all C args first (proxies → zero copy), looks up the builtin,
calls it, marshals the result back (collections → proxy). **Put the shim in
`east/runtime/_compiler_eastc.pyx`** (where `_builtins` lives) — or, if in `_eastc_bridge.pyx`,
obtain the registry only via `east_current_builtins()`, never by reaching across modules.
Requires adding **both `builtin_registry_get` AND the `BuiltinImpl` typedef** to `_eastc.pxd`.

> **Caveat — back-to-back factory/impl:** some east-c factories stash thread-local
> context the impl reads immediately (e.g. `array_try_get_factory` sets `_option_ctx`,
> `array.c:1305`). The shim must build args, then `builtin_registry_get` (factory),
> then `bfn(...)` (impl) with **no Python allocation in between** — mirror
> `compiler.c:701-734`.

### 3.3 What to C-back vs keep in Python/numpy (verdict)

| Class | Examples | Decision |
|------|----------|----------|
| **C-back (the win)** | `sort`, `unique`/`to_set`, `concat`, `slice`, `reverse`, `flatten`, `contains`, set union/intersect/diff, dict bucketing | No callback, or callback is a cheap key while heavy work stays in C |
| **C-back (cheap-key callback)** | `group_by` | needs a target builtin — see note; bucketing stays in C |
| **Python / numpy** | `map`, `filter`, `fold`/`reduce` | the callback **is** the whole cost — routing to C is N GIL crossings + 2N conversions, a net loss |
| **numpy** | Vector/Matrix arithmetic (add/dot/matmul/sum/…) | east-c has **no** vector/matrix arithmetic builtins; numpy on the (now dtype-correct, zero-copy) buffers is strictly better |

> **`group_by` has no plain C target today** — east-c has `ArrayGroupFold` (`array.c:1596`),
> which requires *two* callbacks (key_fn + fold_fn), re-triggering the per-element GIL cost.
> Pick one: (a) add a new `ArrayGroupBy` C builtin (collect-into-array, no fold — same shape as
> `ArraySortDefault` in §3.5), recommended; or (b) use `ArrayGroupFold` with an
> identity-append fold and accept the second crossing. Don't bind `.group_by` until the target
> is named.
>
> **Why keeping `map`/`filter`/`fold` in Python does NOT violate "never reimplement":** the rule
> bans duplicating a **builtin algorithm** in Python. For these, the "algorithm" is the *user's
> own Python callback* — there is no reusable C algorithm beyond a loop, and routing each element
> through the `invoke` hook costs N GIL re-entries + 2N conversions. Python is the only sane home,
> not a reimplementation. `sort`/`group_by`/`unique`/set-algebra **do** have C-side algorithms and
> are correctly C-backed — the split is principled.

### 3.4 The callback story
`_py_function_to_c` (`_eastc_bridge.pyx:1102`, raise at `:1126`) rejects a plain Python lambda
("no IR attached"), so a lambda cannot be serialized into a C function arg. But
`EastCompiledFn.invoke` (a foreign-callback hook, `east-c compiler.h:38`, honored by
`east_call` before IR eval at `compiler.c:1183`) **can** wrap a Python lambda as a C-callable.
The platform bridge `_python_platform_fn` (`_platform_bridge.pyx:119`) is a *pattern* template,
**not** a drop-in: its `PlatformFn` signature `(args, n, inputs, n_in, output)` differs from
`EastInvokeFn` `(self, args, n)` (`compiler.h:20`) — the invoke callback gets `self` (carrying
the captured Python lambda via `invoke_userdata`) and no input/output type args, so a new
callback shape must be written. Use the invoke hook **only** for cheap-key ops (`sort`/
`group_by`) where the heavy work stays in C; never for `map`/`filter`.

### 3.5 One small piece of new east-c
`ArraySort` always requires a key_fn (`array.c:494`). Add a `ArraySortDefault` builtin (sort
by east's total order via `east_value_compare`, no key_fn) so the common `.sort()` is pure
C-cheap. **New C, not a Python reimplementation.**

### 3.6 The full surface, manifest-driven (delivery = Alt C)

**Nobody hand-writes a builtin signature or wrapper.** The TS compiler already carries a
complete, machine-readable manifest of every builtin (`east/src/builtins.ts:9-33`):
```ts
type BuiltinType = { type_parameters: string[], inputs: (string|EastType)[], output: string|EastType }
const Builtins: Record<BuiltinName, BuiltinType> = { ArraySort:{...}, FloatSqrt:{...}, ArrayMap:{...}, … }
```
**Single source of truth.** A small TS script dumps `Builtins` → a committed/shipped
`builtins.json` (regenerated when east-c/TS builtins change — same pattern as the plugin's
`index.json`). east-py loads it. From each manifest entry, four things derive mechanically:
1. **Naming** — strip the receiver prefix: `"ArraySort"`→`arr.sort()`; `"FloatSqrt"`→
   `East.Float.sqrt()`; `"StringSplit"`→`East.String.split()`.
2. **Type-params** — unify `inputs` (with `"T"`/`"P"` holes) against the runtime arg types
   (mostly `T = receiver.element_type`; patch's `"P"` is the computed patch-type of `T`, via
   east-py's existing `type_of_patch`).
3. **Output decode** — substitute resolved params into `output` → the result type to marshal back.
4. **Routing** — an `inputs` entry that is a `FunctionType` ⇒ callback ⇒ **Python**; an all-scalar
   signature ⇒ native-Python shortcut (bit-identical, skip marshalling); else ⇒ `call_builtin` to
   east-c. (Comparison `Is/Equal/Less/…` and the serialization builtins
   `BlobEncodeBeast2/StringEncodeUtf8/…` **reuse east-py's existing layers** — `compare_for`/
   `equal_for`/`less_for` in `utils/ordering.py`, and the beast2/json/csv Cython encoders — rather
   than a fresh `call_builtin`.)

**Delivery = Alt C: a runtime manifest-driven dispatcher + generated `.pyi` stubs.**
- *Runtime:* one dispatcher (no per-builtin code). Custom value classes implement `__getattr__`
  (and `East.Float`/`East.String`/… are dispatching namespace objects) that looks up the builtin
  in the manifest, resolves params, routes per (4), and decodes the result. ~150 lines total.
- *Static types:* a generated `east/*.pyi` stub (from the same manifest) declares every method/
  namespace signature so mypy/pyright/IDE autocomplete work, with no bodies. CI checks
  `stub == fresh-from-manifest` so it can't drift.
- The runtime engine (`call_builtin` §3.2, the param resolver, the callback router) is shared; the
  `.pyi` is pure typing. Bootstrap order: get the dispatcher green first (Alt A), then layer the
  generated stubs.

**Methods vs namespaces (the Python-type constraint):** you cannot add methods to Python's
built-in `float`/`str`/`int`/`bool`/`datetime`. So:
- **Custom classes → methods**: `EastArray/Set/Dict/Vector/Matrix/Ref`, and **`EastBlob`**
  (a `bytes` subclass we control) → `blob.decode_utf8()`.
- **Python-native scalars → `East.<Type>.*` namespace functions**: `East.Float.sqrt(x)`,
  `East.Integer.pow(a,b)`, `East.String.upper_case(s)`, `East.DateTime.print_format(dt, fmt)`,
  `East.Boolean.xor(a,b)` — exact mirror of the TS static namespaces.

**Replace BOTH fake sorts** while wiring the dispatcher: `EastArrayProxy.sort()`
(`_eastc_bridge.pyx:1454`) AND **`EastArray.sort()` (`values.py:392`)** — both call Python
`list.sort` today (Python ordering, NOT East `compare_for`; wrong for floats/NaN/mixed, violating
the "use East comparisons" rule). Both route to `call_builtin("ArraySortDefault", …)`.

### 3.7 Per-value surface map (what the manifest yields)

| East value | Python type | Surface | Representative ops (full set = the manifest) |
|---|---|---|---|
| Array | `EastArray` | methods | sort/reverse/concat/slice/unique→to_set/to_dict/has/get/find_*/is_sorted/group_by/flatten_*; map/filter/fold (Python); generate/range/linspace; encode_csv |
| Set | `EastSet` | methods | union/intersect/diff/sym_diff/is_subset/is_disjoint/has/insert/delete/to_array·dict; map/filter/reduce (Python) |
| Dict | `EastDict` | methods | get/get_or_default/try_get/insert/update/swap/merge/pop/keys/union/to_array·set; map/filter/reduce (Python) |
| Vector | `EastVector` | methods | length/get/set/slice/concat/to_array·matrix/zeros/ones/fill; map/fold (Python); **arithmetic → numpy** |
| Matrix | `EastMatrix` | methods | rows/cols/get/set/get_row·col/transpose/to_vector·array·rows/from_array·rows/zeros/ones/fill; **arithmetic → numpy** |
| Blob | `EastBlob` | methods | size/get_uint8/decode_utf8·utf16·csv·beast2/encode_beast2 (reuse serialization layer) |
| Ref | `EastRef` | methods | get/update/merge |
| Float | `float` | `East.Float.*` | sqrt/log/exp/sin/cos/tan/sign/pow/remainder/to_integer (+add/sub/… mirrored but native-Python) |
| Integer | `int` | `East.Integer.*` | pow/log/sign/remainder/to_float (+arithmetic mirrored, native-Python) |
| String | `str` | `East.String.*` | split/substring/index_of/contains/starts_with/ends_with/repeat/replace/trim*/upper·lower_case/regex_*/parse·print_json/parse/print |
| Boolean | `bool` | `East.Boolean.*` | and/or/xor/not (native-Python) |
| DateTime | `datetime` | `East.DateTime.*` | parse·print_format/from_components/get_year·month·…/add·duration_milliseconds/to·from_epoch_milliseconds |
| (any) | — | `East.compare/equal/less(T,a,b)` | the `Is/Equal/Less/…` builtins → reuse `compare_for`/`equal_for`/`less_for` |

### 3.8 Worked example — `array.map` of `struct.float * float`, as a platform function

Exercises the trickiest routing (a callback builtin → Python) and shows that *inside* the
callback you work with plain Python scalars:

```python
from east import (FloatType, StringType, StructType, ArrayType,
                  EastArray, EastStruct, struct, platform_function)

LineItem = StructType([("name", StringType), ("price", FloatType)])   # Struct<String, Float>

@platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    """Scale every line item's price by fx_rate. Callable from East as a platform fn."""
    # items : EastArray[EastStruct] (C-backed, lazy-decoded) ; fx_rate : float (East Float IS f64)
    return items.map(lambda row: struct(
        {"name":  row["name"],                # plain str, passed through
         "price": row["price"] * fx_rate},    # plain f64 * f64 — native Python multiply
        LineItem,                             # tag + validate the result struct
    ))
```
- `items.map(fn)` — `ArrayMap.inputs` has a `FunctionType` ⇒ **callback ⇒ runs in Python** (a loop
  applying `fn`, collecting a new `EastArray`); not marshalled to C (the work *is* the lambda — not
  a "reimplementation", there's no C algorithm to reuse).
- Inside the lambda `row` is an `EastStruct`; `row["price"]`/`row["name"]` are already **plain
  Python `float`/`str`** → `row["price"] * fx_rate` is ordinary Python arithmetic, **bit-identical
  to East `FloatMultiply`**. The East-ness lives at the container boundaries, not the scalar math.
- `struct({...}, LineItem)` builds + validates the result struct (reorders/coerces; `EastTypeError`
  on mismatch). `.map` infers the output element type from the tagged results (or pass `out=LineItem`).
- The decorator validates the return is `Array<LineItem>` via `is_value_of` → a named `EastError`
  instead of silent corruption.
- Chain a C op to see the split: `items.map(…).sort()` → `.map` runs in Python, **`.sort()`
  marshals to `call_builtin("ArraySortDefault", [LineItem], …)`** and sorts in east-c by East's total
  struct order (correct NaN/-0), not Python `list.sort`. A custom key (`.sort(key=lambda r: r["price"])`)
  uses the cheap-key `invoke`-hook path (key projection in Python, sort in C).

This is the canonical SKILL example (strand D).

---

## 4. Strand C — the ad-hoc platform-function on-ramp

### 4.1 Today's boundary is fast but unsafe
`register_platform_functions` (`_platform_bridge.pyx:263-321`) reads only `name`/`type`/`fn`
— the `inputs`/`output` you declare are **never validated**. Values are structurally *pulled*
by `py_value_to_c`; a slightly-wrong output dies with a cryptic `KeyError`/`AttributeError`,
and a wrong scalar is **silently coerced** (corrupt data, no error). `is_value_of` sits one
import away, unused.

### 4.2 The `@platform_function` decorator
Additive sugar over the existing `PlatformFunction` TypedDict (emits the same dict; nothing
downstream changes). It: infers sync/async from the function; auto-collects into the module's
platform list (kills the two-`__init__`-hop boilerplate); and **validates in/out with
`is_value_of` → a named `EastError`** instead of silent corruption.

```python
@platform_function(inputs=[VectorType(F32)], output=VectorType(F32))   # validate=True default
def zscore(v): ...
```
Ship **output validation on-by-default** (catches the silent-corruption case; cheap vs the
impl). **Input validation opt-in** (`validate=False`) — it's an O(n) Python re-walk of values
the bridge already converted; the right long-term home is inside the bridge/east-c single pass.
Keep a `generic_platform_function` variant for the factory convention (`_platform_bridge.pyx:
206-208`).

### 4.3 Torch interop — NO helpers; inline at the call site
The numeric glue is **not** a library surface (your "no trivial helpers" rule, and core
east-py must not import torch). `EastVector.data`/`EastMatrix.data` are already numpy. With
PR #1's dtype model, an f32-backed `Vector<F32>` makes `torch.from_numpy(mat.data)` **genuinely
zero-copy, no cast**. So the platform-function body (which lives in the torch-having package,
not core) just does, inline:
```python
t      = torch.from_numpy(mat.data)                 # zero-copy (f32 store via PR #1)
arr3d  = np.stack([m.data for m in array_of_matrix]) # batch axis, inline
out    = EastMatrix(F32, y.detach().cpu().contiguous().numpy())
```
The only real, non-trivial support items: construction **dtype/contiguity guards** on
`EastVector`/`EastMatrix` (a safety check, delivered by PR #1), and a **documented recipe**
(prose) for "model weights as a Blob via `torch.save(BytesIO)`".

### 4.4 The worked migration (proving ground)
The reference POC is a torch flow-matching sampler, `flow_sample()`, at
**`/home/crambelsoupy/src/east-twe/python/flow_poc/flow_matching.py`** (a **separate repo**,
`east-twe` — not in this monorepo; the implementing agent must clone/path it, or substitute any
existing torch POC in `east-py-datascience`). It wraps into one decorated function whose body
**imports the unmodified POC**. Self-contained example (assumes PR #1's f32 dtype + the `@platform_function`
decorator from §4.2):

```python
import io, json, numpy as np, torch
from east import BlobType, IntegerType, F32, I64, VectorType, MatrixType, ArrayType
from east import EastVector, EastMatrix, EastArray, platform_function
from flow_matching import FlowNet, FlowConfig, flow_sample      # the UNMODIFIED POC

@platform_function(
    inputs=[
        BlobType,                              # weights (ema state_dict pickle)
        BlobType,                              # config.json bytes
        ArrayType(MatrixType(F32)),            # cond_dyn   B x (T x D_d)
        MatrixType(F32),                       # static_num B x D_sn
        MatrixType(I64),                       # static_cat B x D_sc
        ArrayType(MatrixType(F32)),            # y_obs      B x (T x D_t)
        ArrayType(MatrixType(F32)),            # obs_mask
        MatrixType(F32),                       # valid_mask B x T
        VectorType(F32), VectorType(F32),      # target_mean, target_std (D_t)
        IntegerType, IntegerType,              # n_steps, n_samples
    ],
    output=ArrayType(ArrayType(MatrixType(F32))),   # samples x batch x (T x D_t)
)
def sample_forecast(weights, config, cond_dyn, static_num, static_cat,
                    y_obs, obs_mask, valid_mask, target_mean, target_std,
                    n_steps, n_samples):
    cfg = json.loads(bytes(config))
    sd = torch.load(io.BytesIO(bytes(weights)), map_location="cpu")
    sd = sd.get("ema", sd) if isinstance(sd, dict) else sd
    model = FlowNet(**_model_kwargs(cfg)); model.load_state_dict(sd); model.eval()

    stack = lambda arr: torch.from_numpy(np.stack([m.data for m in arr]))   # inline; zero-copy f32
    samples = flow_sample(                       # the UNMODIFIED POC call
        model, n_steps=int(n_steps),
        cond_dyn=stack(cond_dyn), static_num=torch.from_numpy(static_num.data),
        static_cat=torch.from_numpy(static_cat.data),
        y_obs=stack(y_obs), obs_mask=stack(obs_mask),
        valid_mask=torch.from_numpy(valid_mask.data),
        n_samples=int(n_samples), device="cpu",
        target_norm=(torch.from_numpy(target_mean.data), torch.from_numpy(target_std.data)),
    )                                            # -> [n_samples, B, T, D_t]
    a = samples.detach().cpu().contiguous().numpy()
    return EastArray(ArrayType(MatrixType(F32)), [
        EastArray(MatrixType(F32), [EastMatrix(F32, a[s, b]) for b in range(a.shape[1])])
        for s in range(a.shape[0])
    ])
```
~30 lines of glue around an unmodified `import`. (Reproduce this in the SKILL. The
`astype(np.float64)` wart in the pre-PR#1 version disappears here because `EastMatrix(F32, …)`
honestly stores f32 — the whole point of PR #1.)

---

## 5. Strand D — docs / SKILL
- **New `east:east-py` SKILL** (`packages/east-py/SKILL.md` — the package ships none today),
  Python-first (the datascience SKILL is TS-only). Quick Start (construct a value, run one
  eager method, no IR), a decision tree (data→construct / transform→eager method / East-calls-
  your-Python→platform fn), API tables (the per-value surface map of §3.7), Key Patterns incl. the
  WRONG/CORRECT `sort` pair, the methods-vs-namespaces rule, **the canonical `convert_prices`
  example (§3.8)**, and the ad-hoc-platform how-to. Respect `SKILLS_STANDARD.md`; companion
  `*.examples.py` (flag the index pipeline currently extracts `*.examples.ts` — needs a
  `plugin-artifacts` decision).
- **New `docs/conventions/EAST_PY_INTEROP.md`** (SCREAMING_SNAKE_CASE; the Python sibling of
  `EAST_TS_INTEROP.md`): use `compare_for`/`equal_for` not raw `<`/`==`; construct variants
  with `variant()`/`some`/`none` not `{tag,data}`; **eager methods marshal to east-c builtins,
  never reimplement in Python** (the strand-B linchpin rule, and the standing fix-target for
  `EastArray.sort`).
- **Docstring cleanup** in `values.py`: strip/upgrade the narrate-the-obvious one-liners
  (`:347-395`, `:545-589`, `:672-701`, `:1016-1051`); make `sort`'s docstring tell the truth;
  document validating construction. Sweep hardcoded counts in `README.md:24,31`.
- Optional internal `devdocs/EAGER_VALUE_METHODS_DESIGN.md` for the strand-B `call_builtin`
  implementation detail.

---

## 6. Build sequence (after PR #1 merges)
1. **A-foundation [independent]:** BUG-1/2/4/5/6/7, exports, `variant/some/none/match/struct/
   array`, `coerce_to`/`assert_value_of`/`explain_value_of`/`EastTypeError`. Highest leverage —
   unblocks B and C. (BUG-3 lands with PR #1.)
2. **B-eager surface (manifest-driven full mirror, Alt C):**
   (i) export `Builtins` (`east/src/builtins.ts:33`) → committed `builtins.json` (TS script, CI-regen);
   (ii) the `call_builtin` shim (`.pxd` exposes `builtin_registry_get` + `BuiltinImpl`; uses
   `_ensure_runtime()` + `east_current_builtins()`) + new east-c builtins `ArraySortDefault` (and
   `ArrayGroupBy` if `.group_by` is in scope);
   (iii) the runtime manifest dispatcher (param resolver + routing: C-back / Python-callback /
   native-scalar / reuse ordering+serialization layers) on the value classes + `East.*` namespaces;
   (iv) generated `.pyi` stubs from the manifest (+ CI drift check);
   (v) replace both fake sorts (`values.py:392`, `_eastc_bridge.pyx:1454`).
   Bootstrap the dispatcher (Alt A) green first, then layer the `.pyi`.
3. **C-platform on-ramp:** `@platform_function` (+ generic variant), the torch-interop recipe
   (inline, no helpers), the `flow_matching.py` migration as the proving ground.
4. **D-docs/SKILL.**

Each can be its own PR. Strand A is the gate; B and C are parallelizable after it.

### Gate discipline (mandatory)
**For every `libs/<x>` you modify, run that lib's gate and do not proceed until green.** Use
`make check` where it exists (lint + typecheck + test), else `make lint` + the lib's test target.

| Strand | Libs touched | Gate(s) — run in each, green before moving on |
|---|---|---|
| **A** | `libs/east-py` | `cd libs/east-py && make check` (= lint+typecheck+test) |
| **B** | `libs/east` (manifest export) · `libs/east-c` (new builtins) · `libs/east-py` (bridge+dispatcher+.pyi) | east: `make lint && make test`; east-c: `make build && make lint && make test-east-c && make leak-check`; east-py: `make install && make check && make test-east-py` |
| **C** | `libs/east-py` · `libs/east-py/packages/east-py-datascience` (the platform fn + torch glue live here, not core) | east-py: `make check`; datascience: `cd libs/east-py/packages/east-py-datascience && make lint && make test` |
| **D** | docs + `libs/east-claude-plugin` (SKILL/index) | regenerate the plugin index if `*.examples.*` change (see `plugin-artifacts`); no compile gate |

Cross-cutting: after any strand, the repo-wide correctness gate is `make test-export && make test-all`
from the root (it runs east + east-c + east-py compliance). **Strand B is not done until all three of
its libs are green** — an east-py-only run will miss the new east-c builtin and the manifest export.
