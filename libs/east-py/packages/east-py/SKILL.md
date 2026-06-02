---
name: east-py
description: "Use East runtime values as plain Python data and call Python from East. Use when writing Python (not the TypeScript DSL) against the east-py runtime. Triggers for: (1) Constructing/validating East values in Python (EastArray/Set/Dict/Vector/Matrix/Struct/Variant, variant()/some/none/struct/array, coerce_to/assert_value_of), (2) Transforming values with eager methods that delegate to the east-c builtins (sort/map/filter/fold/concat/set-algebra/dict-merge/etc.), (3) Scalar builtins via the East.<Type> namespaces (East.Float.sqrt, East.String.split, East.DateTime.print_format, East.less), (4) Exposing a Python function to East with @platform_function (output validation, sync/async), (5) NumPy/torch interop through EastVector.data / EastMatrix.data, (6) Porting a plain-Python data-science POC into an East platform function."
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
    │   ├─ Array of structs from dicts → array(ElemType, [dict, ...])  (coerces + validates)
    │   ├─ A struct (reorder/coerce to a type) → struct({...}, StructType)
    │   ├─ A tagged value / option → variant(case, value, typ) / some(x) / none
    │   ├─ Numeric buffer for ML → EastVector(FloatType, np_array) / EastMatrix(...)
    │   └─ Anything, from native Python, type-driven → coerce_to(value, typ)
    │
    ├─ Validate a value at a boundary
    │   ├─ Raise on mismatch (path-pinpointed) → assert_value_of(value, typ)
    │   ├─ List every problem → explain_value_of(value, typ)
    │   └─ Boolean check → is_value_of(value, typ)
    │
    ├─ Transform a value (eager — runs now in east-c)
    │   ├─ Array: sort/sorted/concat/slice/reverse/unique/to_set/to_dict/map/filter/fold/group_by/...
    │   ├─ Set: union/intersect/diff/sym_diff/is_subset/map/filter/reduce/to_array/...
    │   ├─ Dict: merge/map/filter/reduce/keys_set/...  (get/has/insert via [] / in)
    │   └─ Vector/Matrix: structural ops in numpy; arithmetic → numpy/torch on .data
    │
    ├─ A primitive (Float/Integer/String/DateTime/Boolean) builtin
    │   └─ East.<Type>.<op>(value, ...)   e.g. East.Integer.pow(2, 10), East.String.split(s, ",")
    │
    └─ Let East call your Python function
        └─ @platform_function(inputs=[...], output=...)  +  platform_functions(__name__)
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

## API Reference

### Construction & validation (`from east import ...`)

| Signature | Description | Example |
|-----------|-------------|---------|
| **Ergonomic constructors** |
| `array(elem: EastType, items, *, validate=True) -> EastArray` | Array; each item coerced to `elem` | `array(LineItem, [{"name":"a","price":1}])` |
| `struct(fields: dict, typ: StructType\|None=None) -> EastStruct` | Struct; reorders/coerces to `typ` | `struct({"price":1,"name":"a"}, LineItem)` |
| `variant(case: str, value, typ: VariantType\|None=None) -> EastVariant` | Tagged value; validates against `typ` | `variant("rgb", {...}, Color)` |
| `some(value) -> EastVariant` / `none: EastVariant` | Option variants | `some(5)` / `none` |
| `match(v, cases: dict, default=None)` | Dispatch on a variant's tag | `match(v, {"some": lambda x: x})` |
| **Validation / coercion** ❗ raise `EastTypeError` |
| `coerce_to(value, typ: EastType, *, path="$") -> EastValue` | Canonicalize to a bridge-ready value, type-driven | `coerce_to([1,2], VectorType(FloatType))` |
| `assert_value_of(value, typ, *, path="$") -> value` ❗ | Validate; raise path-pinpointed `EastTypeError` | `assert_value_of(s, LineItem)` |
| `explain_value_of(value, typ) -> list[(path, reason)]` | All mismatches (empty == conforms) | `explain_value_of(s, LineItem)` |
| `is_value_of(value, typ) -> bool` | Boolean conformance check | `is_value_of(v, ArrayType(LineItem))` |
| `type_of(value) -> EastType` | Infer the East type of a value | `type_of(items)` |

### EastArray methods (representative; all delegate to east-c)

| Signature | Description | Example |
|-----------|-------------|---------|
| `sort(*, key=None, reverse=False) -> None` | In-place, East order | `arr.sort()` |
| `sorted(key=None, *, reverse=False) -> EastArray` | New sorted array (chainable) | `arr.sorted(key=lambda r: r["price"])` |
| `map(fn, out=None) -> EastArray` | Apply `fn(element)`; result type sampled | `arr.map(lambda x: x*2)` |
| `filter(predicate) -> EastArray` | Keep where `predicate(element)` is True | `arr.filter(lambda x: x>0)` |
| `fold(initial, fn) -> value` | Left-fold `fn(acc, element)` | `arr.fold(0, lambda a,x: a+x)` |
| `concat(other) -> EastArray` / `slice(start, end) -> EastArray` | Append / sub-range | `arr.concat(b)` / `arr.slice(0, 3)` |
| `unique() -> EastSet` / `to_set(key=None) -> EastSet` | Distinct / projected set | `arr.unique()` |
| `to_dict(key, value, combine=None) -> EastDict` | Index into a dict | `arr.to_dict(lambda r: r["name"], lambda r: r)` |
| `group_by(key) -> EastDict` | Bucket by `key(element)` | `arr.group_by(lambda w: w[0])` |
| `get(i)` / `has(i)` / `try_get(i)` | Element access (or use `arr[i]`, `len`) | `arr.try_get(2)` |

(`EastSet`: `union`/`intersect`/`diff`/`sym_diff`/`is_subset`/`is_disjoint`/`map`/
`filter`/`reduce`/`to_array`. `EastDict`: `merge`/`map`/`filter`/`reduce`/`keys_set`;
`get`/`has`/`insert` via `d[k]` / `k in d` / `d[k]=v`.)

### Vector / Matrix (numpy boundary)

| Signature | Description | Example |
|-----------|-------------|---------|
| `EastVector(elem, np_array)` / `.data` | 1-D numeric buffer; `.data` is numpy | `EastVector(FloatType, np.array([1.,2.]))` |
| `v.get(i)` / `v.length()` / `v.slice(a,b)` / `v.to_array()` | Structural (numpy) | `v.get(0)` |
| `EastMatrix(elem, np_2d)` / `.data` / `.transpose()` / `.get_row(r)` | 2-D row-major; `.data` is numpy | `EastMatrix(FloatType, X)` |

> No vector/matrix **arithmetic** methods — do tensor math with numpy/torch on
> `.data` (`torch.from_numpy(m.data)`). The backing dtype may be f32 at runtime;
> the bridge canonicalizes to the East storage width crossing into east-c.

### East.<Type> scalar namespaces

| Namespace | Ops | Example |
|-----------|-----|---------|
| `East.Float` | sqrt/exp/log/sin/cos/tan/pow/abs/sign/negate/remainder/to_integer (+arith) | `East.Float.sqrt(2.0)` |
| `East.Integer` | pow/log/abs/sign/negate/remainder/to_float (+arith) | `East.Integer.pow(2, 10)` |
| `East.String` | split/substring/upper_case/lower_case/contains/starts_with/ends_with/replace/trim*/index_of/regex_* | `East.String.split(s, ",")` |
| `East.DateTime` | get_year/month/.../add_milliseconds/from_components/to_epoch_milliseconds/print_format/parse_format | `East.DateTime.print_format(dt, "YYYY-MM-DD")` |
| `East.Boolean` | not_/and_/or_/xor | `East.Boolean.xor(a, b)` |
| `East` | compare/equal/not_equal/less/less_equal/greater/greater_equal `(T, a, b)` | `East.less(IntegerType, 1, 2)` |

### Platform functions

| Signature | Description | Example |
|-----------|-------------|---------|
| `@platform_function(*, inputs, output, name=None, validate_output=True, validate_input=False)` | Register a Python fn; infers sync/async; validates output | see Key Patterns |
| `@generic_platform_function(*, type_parameters, name=None, is_async=False)` | Type-parameterized factory variant | `@generic_platform_function(type_parameters=["S"])` |
| `platform_functions(module) -> list` | The functions decorated in a module | `platform_functions(__name__)` |

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
t   = torch.from_numpy(mat.data)                  # .data is the contiguous numpy buffer
out = EastMatrix(FloatType, model(t).detach().cpu().numpy())   # bridge canonicalizes dtype
```
