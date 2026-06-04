---
name: east-py
description: "Use East runtime values as plain Python data and call Python from East. Use when writing Python (not the TypeScript DSL) against the east-py runtime. Triggers for: (1) Constructing/validating East values in Python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant, variant()/some/none/struct/array, coerce_to/assert_value_of), (2) Transforming values with eager methods that delegate to the east-c builtins (sort/map/filter/fold/concat/set-algebra/dict-merge/etc.), (3) Scalar builtins via the East.<Type> namespaces (East.Float.sqrt, East.String.split, East.DateTime.print_format, East.less), (4) Exposing a Python function to East with @platform_function (output validation, sync/async), (5) NumPy/torch interop through EastVector/EastMatrix to_numpy()/to_torch(), (6) Porting a plain-Python data-science POC into an East platform function."
---

# East.py — values as data, and the platform on-ramp

`east-py` is the Python runtime for East: a Cython bridge to the native **east-c**
runtime. You don't re-implement East in Python — you use East *values* as ordinary
Python data, call their **eager methods** (which delegate to the east-c builtins
and execute immediately), and expose Python functions to East with a decorator.

This skill is for writing **Python** against the runtime. (For the TypeScript
`East.function` DSL, use the `east` skill; for ML/optimization platform functions,
`east-py-datascience`.)

## Quick Start

```python
from east import (EastArray, StructType, StringType, FloatType, East,
                  array, struct, coerce_to, platform_function, platform_functions, ArrayType)

LineItem = StructType([("name", StringType), ("price", FloatType)])

# 1. Construct + validate East values from native Python (dicts are coerced)
items = array(LineItem, [{"name": "a", "price": 1}, {"name": "b", "price": 2.0}])

# 2. Eager methods run NOW (delegating to east-c) and chain
dear = items.filter(lambda r: r["price"] >= 2.0).sorted(key=lambda r: r["price"])

# 3. Primitive builtins live on East.<Type> namespaces (can't add methods to float/str)
East.Float.sqrt(2.0)
East.String.upper_case("hi")

# 4. Expose a Python function to East — typed, validated, auto-collected
@platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    return items.map(lambda r: struct({"name": r["name"], "price": r["price"] * fx_rate}, LineItem))

platform = platform_functions(__name__)   # pass to compile() to register
```

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Build an East value from Python data
    │   ├─ Array of structs from dicts → array(ElemType, [dict, ...])   (coerces + validates each)
    │   ├─ One struct (reorder/coerce keys to a type) → struct({...}, StructType)
    │   ├─ Tagged value / option
    │   │   ├─ Named case → variant(case, value, VariantType)
    │   │   └─ Optional → some(x) / none
    │   ├─ Numeric buffer for ML/tensors → EastVector(FloatType, np_1d) / EastMatrix(FloatType, np_2d)
    │   ├─ A ref cell → east_ref(value)
    │   ├─ Generate (range/zeros/…) → classmethods: EastArray.range / EastVector.zeros / …  (NOT East.Array.*)
    │   └─ Anything, type-driven (int→Float, dict→Struct, …) → coerce_to(value, typ)
    │
    ├─ Validate a value at a Python↔East boundary
    │   ├─ Raise on mismatch, path-pinpointed → assert_value_of(value, typ)   ❗EastTypeError
    │   ├─ List every problem (empty == conforms) → explain_value_of(value, typ)
    │   ├─ Boolean check → is_value_of(value, typ)
    │   └─ Infer a value's type → type_of(value)
    │
    ├─ Transform a value (eager — runs NOW in east-c; results stay C-side and chain)
    │   ├─ Array<T>      → access · sort/sorted/reverse · slice/concat · map/filter/filter_map/for_each ·
    │   │                  fold/map_reduce · group_by/to_dict/to_set/unique · find_*/first_map/is_sorted ·
    │   │                  flatten_to_* · string_join/copy · (mutate) append/extend/insert/pop/remove/clear
    │   ├─ Set<T>        → union/intersect/diff/sym_diff/is_subset/is_disjoint · map(→Dict)/filter/reduce ·
    │   │                  to_array/to_dict/group_fold · (mutate) add/remove/discard/clear
    │   ├─ Dict<K,V>     → d[k]/get/has · merge · map(value)/filter(key,value)/reduce(acc,key,value) ·
    │   │                  keys_set/to_array/to_set/group_fold · (mutate) d[k]=v/update/insert_or_update/pop
    │   ├─ Vector/Matrix → get/set(→new)/slice/concat/map/fold · transpose/get_row/get_col · to_array/to_matrix
    │   └─ Blob          → size/get_uint8 · decode_utf8/utf16 · encode_beast2/decode_beast2/decode_csv
    │
    ├─ A scalar/primitive builtin (you can't method-call a float/int/str/bool/datetime)
    │   ├─ Numeric → East.Float.<op> / East.Integer.<op>
    │   ├─ Text → East.String.<op>
    │   ├─ Time → East.DateTime.<op>
    │   ├─ Logic → East.Boolean.<op>
    │   └─ Compare / order (East total order) → East.less / compare / equal / …(T, a, b)
    │
    ├─ Hand a buffer to numpy / torch → EastVector/EastMatrix .to_numpy()/.to_torch()   (no arithmetic methods)
    │
    └─ Let East call your Python function
        ├─ Concrete types → @platform_function(inputs=[…], output=…)  +  platform_functions(__name__)
        └─ Type-parameterized → @generic_platform_function(type_parameters=[…], is_async=…)
```

## Core Concepts

- **Values are plain Python data.** Containers (`EastArray`/`EastSet`/`EastDict`/
  `EastVector`/`EastMatrix`/`EastStruct`/`EastVariant`/`EastRef`/`EastBlob`) carry
  their East element types; scalars are plain `int`/`float`/`str`/`bool`/`datetime`
  (East `Float` *is* a Python `float`, `Integer` *is* a Python `int`, …).
- **Eager methods delegate to east-c.** `arr.sort()` / `arr.map(fn)` run immediately
  in the native runtime — no IR, no compile. Collection results come back as live
  east-c-backed values, so `arr.map(f).filter(g).sorted()` stays C-side.
- **Methods vs namespaces.** You can't attach methods to Python's `float`/`int`/
  `str`/`bool`/`datetime`, so their builtins live on the `East.<Type>` namespaces.
  Everything else (the containers + `EastBlob`) has real methods.
- **Ordering is East's total order**, not Python's — `arr.sort()` sorts by East
  semantics (correct for floats/NaN, mixed types). Never assume Python `<`.

## Type System Summary

Every East type has a Python representation. Scalars are plain Python objects (so their
builtins live on `East.<Type>` namespaces, never as methods); everything else is an
`East*` container that carries its element type and has real eager methods. Only
`EastArray`/`EastSet`/`EastDict`/`EastRef` mutate in place — `EastStruct`,
`EastVariant`, `EastVector`, and `EastMatrix` are immutable value types (transform
by building a new value; `set` returns a new tensor).

| East Type | Python value | Mutability |
|-----------|--------------|------------|
| `NullType` | `None` (validates); canonical value is the `EastNull` sentinel (`east_null`) | Immutable |
| `BooleanType` | `bool` | Immutable |
| `IntegerType` | `int` (i64) | Immutable |
| `FloatType` | `float` (f64) | Immutable |
| `StringType` | `str` | Immutable |
| `DateTimeType` | `datetime.datetime` (UTC) | Immutable |
| `BlobType` | `EastBlob` (a `bytes` subclass); `.data` is `bytes` | Immutable |
| `ArrayType(T)` | `EastArray` (indexable, iterable) | **Mutable** |
| `SetType(K)` | `EastSet` (East-sorted) | **Mutable** |
| `DictType(K, V)` | `EastDict` (East-sorted by key) | **Mutable** |
| `VectorType(T)` | `EastVector`; 1-D numpy buffer via `.to_numpy()` | Immutable |
| `MatrixType(T)` | `EastMatrix`; 2-D row-major numpy buffer via `.to_numpy()` | Immutable |
| `StructType({...})` | `EastStruct` (index by field name: `s["name"]`) | Immutable (frozen) |
| `VariantType({...})` | `EastVariant` (`.type` tag, `.value`; compared **by case name**) | Immutable (frozen) |
| `RefType(T)` | `EastRef` (cell; `.get()` / `.set()` / `.update()`) | **Mutable** |
| `FunctionType(I, O)` / `AsyncFunctionType(I, O)` | `EastFunction` | Immutable |

`VectorType`/`MatrixType` element types are `FloatType`, `IntegerType`, or `BooleanType`;
the runtime backing numpy dtype may be narrower (e.g. f32), and the bridge canonicalizes
to East's storage width (Float→f64, Integer→i64, Boolean→u8) crossing into east-c.

## API Reference

### Construction & validation (`from east import ...`)

| Signature | Description | Example |
|-----------|-------------|---------|
| **Ergonomic constructors** |
| `array(element_type, items, *, validate=True) -> EastArray` | Each item coerced/validated to `element_type` (dict→struct, int→Float, …); `validate=False` stores as-is | `array(LineItem, [{"name":"a","price":1}])` |
| `struct(fields: dict, typ: StructType\|None=None) -> EastStruct` | Reorders/coerces keys to `typ` (else infers from fields) | `struct({"price":1,"name":"a"}, LineItem)` |
| `variant(case: str, value, typ: VariantType\|None=None) -> EastVariant` | Tagged value; validates `value` against case `case` (matched **by name**); read back via `.type`/`.value` | `variant("named", "red", Color)` |
| `some(value) -> EastVariant` / `none` | Option `some`; `none` is a **constant**, not a function | `some(5)` / `none` |
| `match(v, cases: dict, default=None)` | Dispatch on `v.type`; the handler is **always** called `handler(v.value)` — the `none` arm must be `lambda v: …`, not `lambda: …` | `match(o, {"some": lambda x: x, "none": lambda v: -1})` |
| `east_ref(value) -> EastRef` | Make a mutable ref cell (same as `EastRef(value)`) | `east_ref(0)` |
| **Validation / coercion** — raise `EastTypeError` (`expected X, got Y (at $.path)`) |
| `coerce_to(value, typ, *, path="$") -> EastValue` | Canonicalize any Python value to a bridge-ready East value, type-driven | `coerce_to([1.,2.], VectorType(FloatType))` |
| `assert_value_of(value, typ, *, path="$") -> value` ❗ | Validate; return value, or raise path-pinpointed `EastTypeError` on first mismatch | `assert_value_of(s, LineItem)` |
| `explain_value_of(value, typ) -> list[(path, reason)]` | Every mismatch; `[]` == conforms | `explain_value_of(s, LineItem)` |
| `is_value_of(value, typ) -> bool` | Boolean conformance check | `is_value_of(items, ArrayType(LineItem))` |
| `type_of(value) -> EastType` | Infer the East type of a value | `type_of(items)` |

Container constructors are also direct: `EastArray(elem, items=None)`, `EastSet(elem, items=None)`,
`EastDict(key, value, items=None)`, `EastVector(elem, data=None, length=0)`,
`EastMatrix(elem, data=None, rows=0, cols=0)`, `EastRef(value)`.

### EastArray — complete method surface

Eager; results are live east-c-backed values that chain. `arr[i]`, `len(arr)`, `for x in arr`
work via the sequence protocol. Callbacks receive **decoded East values** and their return is
coerced to the East result type — pass `out`/`element_type` when the result type can't be sampled
from the first element (empty input, or a widening map). `.element_type` is the logical element type.

| Group | Methods (signatures) |
|-------|----------------------|
| Access | `get(i)` · `get_or_default(i, default)` · `try_get(i) -> some/none` · `has(i)` · `get_keys(indices: EastArray)` |
| Reorder | `sort(*, key=None, reverse=False) -> None` (in place) · `sorted(key=None, *, reverse=False)` · `reverse() -> None` · `reversed()` |
| Slice & combine | `slice(start, end)` · `concat(other)` · `copy()` |
| Per-element | `map(fn(el), out=None)` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None)` · `for_each(fn(el)) -> None` |
| Reduce | `fold(initial, fn(acc, el))` · `map_reduce(map_fn(el), reduce_fn(acc, m), out=None)` |
| Group & index | `group_by(key(el)) -> Dict` · `to_dict(key(el), value=None, combine=None) -> Dict` · `to_set(key=None) -> Set` · `unique() -> Set` |
| Search | `find_first(target, key=None) -> some/none` · `find_sorted_first/last(target, key=None) -> int` · `find_sorted_range(target, key=None) -> {start,end}` · `first_map(fn(el)->some/none, out=None)` · `is_sorted(key=None) -> bool` |
| Flatten | `flatten_to_array(fn(el)->arr, out=None)` · `flatten_to_set(fn(el)->arr, out=None)` · `flatten_to_dict(fn(el)->dict, combine=None)` |
| Convert | `string_join(sep) -> str` (String arrays) |
| Mutate (in place) | `append(item)` · `extend(items)` · `insert(i, item)` · `pop(i=-1)` · `remove(item)` · `clear()` · `count(value) -> int` · `index(value) -> int` |

### EastSet — complete method surface

Mutable, unique, **East-sorted**. `.element_type` is the element type; iteration / `to_array` /
`reduce` visit in East order. **`map` and `filter_map` return an `EastDict`** keyed by the element
(Set→Set is `to_set`).

| Group | Methods |
|-------|---------|
| Access | `len(s)` · `value in s` · `has(value)` · `for el in s` |
| Algebra (vs another set) | `union(other)` · `intersect(other)` · `diff(other)` · `sym_diff(other)` · `is_subset(other) -> bool` · `is_disjoint(other) -> bool` |
| Per-element | `map(fn(el)) -> Dict` · `filter(pred(el))` · `filter_map(fn(el)->some/none, out=None) -> Dict` · `first_map(fn(el)->some/none, out=None)` · `to_set(fn(el), out=None)` · `to_array(key=None)` · `to_dict(key(el), value(el), combine=None)` · `for_each(fn(el)) -> None` |
| Reduce | `reduce(initial, fn(acc, el))` · `map_reduce(fn(el), reduce(a,b))` (raises on empty) |
| Group | `group_fold(key(el), initial(gk), fold(acc, el)) -> Dict` |
| Flatten | `flatten_to_array(fn(el)->arr, out=…)` · `flatten_to_set(fn(el)->set, out=…)` · `flatten_to_dict(fn(el)->dict, combine)` — **pin `out`; the no-`out` inference path is broken** |
| Mutate (in place) | `add(item)` · `insert(value)` (alias) · `remove(item)` · `delete(value)` · `discard(item)` · `union_in_place(other)` (adds all of `other`) · `clear()` · `copy()` |

### EastDict — complete method surface

Mutable, **East-sorted by key**. `.key_type` / `.value_type`. **Callback arities differ:**
`map` takes `fn(value)` (no key); `filter`/`first_map`/`to_*`/`flatten_to_*`/`group_fold`/`map_reduce`
take `fn(key, value)`; `reduce` takes `fn(acc, key, value)`; collision `combine` is
`combine(existing, incoming, key)` (3-arg) **except `merge`'s is `combine(existing, incoming)` (2-arg)**.

| Group | Methods |
|-------|---------|
| Access | `d[k]` · `k in d` · `has(k)` · `len(d)`/`size()` · `get(k, default=None)` · `get_or_default(k, default)` · `try_get(k) -> some/none` · `keys()`/`values()`/`items()` |
| Combine | `merge(other, combine(existing, incoming)=None)` · `get_keys(keys: Set, fill(k)) -> Dict` |
| Per-entry | `map(fn(value), out=None)` · `filter(pred(key, value))` · `filter_map(fn(key, value)->some/none, out=None)` · `first_map(fn(key, value)->some/none, out=None)` · `for_each(fn(key, value)) -> None` |
| Reduce | `reduce(initial, fn(acc, key, value))` · `map_reduce(map_fn(key, value), reduce_fn(a, b), out=None)` (raises on empty) |
| Group | `group_fold(key_fn(key, value), init_fn(gk), fold_fn(acc, key, value), key_out=None, acc_out=None) -> Dict` |
| Flatten | `flatten_to_array(fn(key, value)->arr)` · `flatten_to_set(fn(key, value)->set)` · `flatten_to_dict(fn(key, value)->dict, combine(existing, incoming, key))` |
| Convert | `keys_set() -> Set` · `to_array(fn(key, value), out=None)` · `to_set(fn(key, value), out=None)` · `to_dict(key_fn, value_fn, combine(existing, incoming, new_key), key_out=None, value_out=None)` · `copy()` |
| Mutate (in place) | `d[k]=v` · `del d[k]` · `insert(k, v)` · `get_or_insert(k, fn(k))` · `insert_or_update(k, v, combine(existing, incoming, k))` · `update(k, fn(current))` · `swap(k, v) -> prev` · `delete(k)` · `try_delete(k) -> bool` · `pop(k, *default)` · `clear()` |

### EastVector / EastMatrix (the numpy boundary)

Carry a **logical** element type (`Float`/`Integer`/`Boolean`); reach the backing numpy buffer via
`to_numpy(dtype=None, copy=False)` (a read-only view by default — a cast or `copy=True` is
writeable) or `to_torch(dtype=None)`, with `.dtype` the runtime storage dtype (may be f32) and
`.element_type` the logical type. **No arithmetic methods** — do tensor math via
`to_numpy()`/`to_torch()` (`m.to_torch()`) and wrap the result back with the constructor or the
`from_numpy(array, element_type=None)` / `from_torch(tensor, element_type=None)` classmethods —
`element_type` is **inferred** from the array's dtype kind (float→`Float`, int→`Integer`,
bool→`Boolean`) when omitted, so `EastVector.from_numpy(arr)` just works.

| Type | Methods |
|------|---------|
| `EastVector` | `get(i)` · `set(i, v) -> EastVector` · `length()` · `slice(start, end)` · `concat(other)` · `map(fn(el), out=None)` · `fold(initial, fn(acc, el))` · `to_array()` · `to_matrix(rows, cols)` · numpy/torch `to_numpy(dtype=,copy=)`/`to_torch(dtype=)`/`from_numpy(array, element_type=None)`/`from_torch(tensor, element_type=None)` · props `.dtype`/`.element_type` |
| `EastMatrix` | `get(r, c)` · `set(r, c, v) -> EastMatrix` · `get_row(r) -> Vector` · `get_col(c) -> Vector` · `num_rows()`/`num_cols()` · `transpose()` · `map_elements(fn(el), out=None)` · `map_rows(fn(row_vector), out=None)` · `to_rows() -> Array<Vector>` · `to_array()` · `to_vector()` · numpy/torch `to_numpy(dtype=,copy=)`/`to_torch(dtype=)`/`from_numpy(array, element_type=None)`/`from_torch(tensor, element_type=None)` · props `.dtype`/`.element_type`/`.rows`/`.cols` |

### EastBlob (a `bytes` subclass)

`EastBlob(b"...")` constructs like `bytes` and carries the **full `bytes` API** plus East methods:

| Signature | Description |
|-----------|-------------|
| `size() -> int` | Byte length (== `len(blob)`) |
| `get_uint8(i) -> int` | Unsigned byte at `i` (0–255) |
| `.data -> bytes` | Raw payload |
| `decode_utf8() -> str` / `decode_utf16() -> str` | Text decode |
| `EastBlob.encode_beast2(value) -> EastBlob` *(static)* | Serialize an East value to BEAST2 (type inferred via `type_of`) |
| `decode_beast2(typ) -> value` | Decode BEAST2 as `typ` |
| `decode_csv(element_type, config=None) -> EastArray` | Decode CSV rows into `Array<element_type>` |

### EastStruct / EastVariant / EastRef

- **`EastStruct`** — frozen record; read fields by name: `s["price"]`. Build/transform with
  `struct({...}, StructType)`.
- **`EastVariant`** — frozen tagged value; `.type` is the case name, `.value` the payload.
  Build with `variant(case, value, T)` / `some` / `none`; dispatch with `match`.
- **`EastRef`** — mutable cell: `get()` · `set(value)` · `update(fn(current))` ·
  `merge(patch, combine(current, patch))` (delegates to east-c `RefMerge`). Use `set`/`update`
  for a bare local `EastRef`; `merge` is for refs East passes a platform function.

### Container generators (classmethods)

east-py exposes **no** `East.Array`/`East.Set`/`East.Dict`/`East.Vector`/`East.Matrix` namespaces
(the only `East.<X>` namespaces are the scalar ones below). Factories are **classmethods** on the
container classes (snake_case):

| Signature | Example |
|-----------|---------|
| `EastArray.range(start, end, step=1)` | `EastArray.range(0, 5, 2)` → `[0, 2, 4]` |
| `EastArray.linspace(start, end, count)` | `EastArray.linspace(0., 1., 3)` → `[0.0, 0.5, 1.0]` |
| `EastArray.generate(count, fn(i), element_type=None)` | `EastArray.generate(3, lambda i: i*i, IntegerType)` |
| `EastSet.generate(n, fn(i), element_type=None)` | `EastSet.generate(4, lambda i: i % 2, IntegerType)` |
| `EastDict.generate(n, key_fn(i), value_fn(i), combine, key_type, value_type)` | `EastDict.generate(3, lambda i:i, lambda i:i*10, None, IntegerType, IntegerType)` |
| `EastVector.zeros/ones(element_type, length)` · `fill(element_type, length, value)` · `from_array(element_type, items)` | `EastVector.zeros(FloatType, 3)` |
| `EastMatrix.zeros/ones(element_type, rows, cols)` · `fill(…, value)` · `from_array/from_rows(element_type, rows)` | `EastMatrix.from_array(FloatType, [[1.,2.],[3.,4.]])` |

### East.<Type> scalar namespaces

Scalars are plain Python, so their builtins are namespace functions — **complete** lists below.
Every one delegates to east-c.

**`East.Float`** (f64): `add(a,b)` `subtract(a,b)` `multiply(a,b)` `divide(a,b)` `remainder(a,b)`
`pow(base,exp)` `negate(x)` `abs(x)` `sign(x)` `sqrt(x)` `exp(x)` `log(x)` `sin(x)` `cos(x)` `tan(x)`
`to_integer(x) -> int` (raises on a non-integer float, e.g. `3.9`).

**`East.Integer`** (i64): `add(a,b)` `subtract(a,b)` `multiply(a,b)` `divide(a,b)` (truncating)
`remainder(a,b)` `pow(base,exp)` `negate(x)` `abs(x)` `sign(x)` `log(x, base)` `to_float(x) -> float`.

**`East.String`**

| Signature | Notes |
|-----------|-------|
| `concat(a, b)` · `repeat(s, n)` · `substring(s, start, end)` · `length(s) -> int` | build / measure |
| `upper_case(s)` · `lower_case(s)` · `trim(s)` · `trim_start(s)` · `trim_end(s)` | case / whitespace |
| `replace(s, find, replacement)` · `split(s, separator) -> Array<String>` | edit / tokenize |
| `contains(s, substring)` · `starts_with(s, prefix)` · `ends_with(s, suffix)` · `index_of(s, substring) -> int` | search (`-> bool`/`int`) |
| `regex_contains(s, pattern, flags="")` · `regex_index_of(s, pattern, flags="")` · `regex_replace(s, pattern, replacement, flags="")` | regex |
| `parse(typ, s)` · `print(typ, value) -> str` | East **text** format |
| `parse_json(typ, s)` · `print_json(typ, value) -> str` | East **JSON** (`Integer` encodes as a JSON *string*: `print_json(ArrayType(IntegerType), [1,2,3]) == '["1","2","3"]'`) |

**`East.DateTime`** (see [DateTime format codes](#datetime-format-codes))

| Signature | Notes |
|-----------|-------|
| `from_components(year, month, day, hour, minute, second, millisecond)` | construct |
| `from_epoch_milliseconds(millis)` · `to_epoch_milliseconds(dt) -> int` | epoch round-trip |
| `get_year/get_month/get_day_of_month/get_day_of_week(dt) -> int` | `get_day_of_week`: Monday == 1 |
| `get_hour/get_minute/get_second/get_millisecond(dt) -> int` | components |
| `add_milliseconds(dt, millis)` · `duration_milliseconds(a, b) -> int` | `duration` returns **a − b** |
| `print_format(dt, fmt) -> str` · `parse_format(s, fmt) -> datetime` | Day.js-style tokens |

**`East.Boolean`**: `not_(x)` `and_(a, b)` `or_(a, b)` `xor(a, b)`.

**`East`** comparisons (East total order; element type `T` first): `compare(T, a, b) -> int`,
`equal/not_equal/less/less_equal/greater/greater_equal(T, a, b) -> bool`.

### DateTime format codes

`print_format(dt, fmt)` / `parse_format(s, fmt)` take a Day.js-style string; tokens match
greedily (longest-first), anything else is a literal, and `\` escapes the next char.
Examples for `2025-03-05 14:09:07.123` (a Wednesday):

| Code | Meaning | Ex | Code | Meaning | Ex |
|------|---------|----|------|---------|----|
| `YYYY` | 4-digit year | `2025` | `YY` | 2-digit year | `25` |
| `MMMM` | full month | `March` | `MMM` | short month | `Mar` |
| `MM` | month 01-12 | `03` | `M` | month 1-12 | `3` |
| `DD` | day 01-31 | `05` | `D` | day 1-31 | `5` |
| `dddd` | full weekday | `Wednesday` | `ddd` | short weekday | `Wed` |
| `dd` | min weekday | `We` | `HH` | hour 00-23 | `14` |
| `H` | hour 0-23 | `14` | `hh` | hour 01-12 | `02` |
| `h` | hour 1-12 | `2` | `mm` | minute 00-59 | `09` |
| `m` | minute 0-59 | `9` | `ss` | second 00-59 | `07` |
| `s` | second 0-59 | `7` | `SSS` | millisecond | `123` |
| `A` | AM/PM | `PM` | `a` | am/pm | `pm` |

```python
East.DateTime.print_format(dt, "YYYY-MM-DD HH:mm:ss.SSS")    # '2025-03-05 14:09:07.123'
East.DateTime.print_format(dt, "dddd, MMMM D, YYYY h:mm A")  # 'Wednesday, March 5, 2025 2:09 PM'
```

### Platform functions

| Signature | Description |
|-----------|-------------|
| `@platform_function(*, inputs, output, name=None, validate_output=True, validate_input=False)` | Register a Python fn; infers sync/async from the def; validates output against `output` |
| `@generic_platform_function(*, type_parameters, name=None, is_async=False)` | Type-parameterized factory: the decorated fn is `fn(platform, *type_params) -> impl`; `is_async` is **explicit** (not inferred) |
| `platform_functions(module) -> list` | Collects every decorated fn in `module` (pass `__name__`) for `compile()` |

## Key Patterns

### The canonical platform function

```python
from east import (FloatType, StringType, StructType, ArrayType,
                  platform_function, struct)

LineItem = StructType([("name", StringType), ("price", FloatType)])   # Struct<String, Float>

@platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    # items: an east-c-backed array with eager methods; row["price"] is a plain float
    return items.map(lambda row: struct(
        {"name": row["name"], "price": row["price"] * fx_rate},   # plain f64 * f64
        LineItem,                                                 # tag + validate the result
    ))
```
`.map` runs the lambda in Python (the callback *is* the work); `struct(..., LineItem)`
validates each row; the decorator validates the `Array<LineItem>` result — a named
`EastTypeError` instead of silent corruption.

### Sort uses East's total order

```python
# WRONG — Python's default ordering (incorrect for floats/NaN, mixed, type-specific)
sorted(list(arr))

# CORRECT — East total order, in east-c
arr.sorted()                      # new array
arr.sort()                        # in place
arr.sorted(key=lambda r: r["x"])  # by a projection, still East-ordered
```

### Scalars: namespaces, not methods

```python
# WRONG — you cannot add methods to Python's float/str
(2.0).sqrt()
# CORRECT — the East.<Type> namespace (delegates to east-c)
East.Float.sqrt(2.0)
East.String.split("a,b,c", ",")
```

### torch interop (in a torch-having package, inline — no helpers)

```python
import torch, numpy as np
t   = mat.to_torch()                              # writeable torch copy of the buffer
out = EastMatrix(FloatType, model(t).detach().cpu().numpy())   # bridge canonicalizes dtype
```

## Related skills

`east-py` is the Python runtime: East values as plain Python data plus the `@platform_function`
on-ramp. Load the skill that matches what you are adding:

- **east** — the TypeScript `East.function` DSL. Use it to *author* East programs (types,
  expression builders, `East.compile`); use `east-py` to run/inspect values and write Python
  platform functions. The two share the same type system and IR.
- **east-py-datascience** — Python platform functions for ML and optimization (XGBoost, LightGBM,
  Optuna, MADS, PyMC, SHAP, Torch, GoogleOR, Simulation). The home once a `@platform_function`
  POC needs a real model or solver.
- **east-node-std** / **east-node-io** — the TypeScript-side siblings of the `east-py-std` /
  `east-py-io` packages: Console/FileSystem/Fetch/Crypto/Time/Random, and SQL/NoSQL/S3/FTP/SFTP/
  XLSX/XML/compression. Use the TS skills on Node; use the `east-py-*` packages on the Python runtime.
- **e3** — run compiled East functions as durable, content-addressed dataflow tasks.
- **east-design** — start here when you have a goal but no architecture yet.
