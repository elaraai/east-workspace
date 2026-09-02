# East ↔ Python interop rules

**Applies to:** any Python code that produces or consumes East values
(`east-py`, `east-py-std`, `east-py-io`, `east-py-datascience`).

These rules exist because East values have *runtime representations* and
*semantics* that do not match plain Python intuition:

- East has a **total ordering** on every type (including `Float`, with `NaN`
  placed deterministically); Python `<` / `>` / `sorted` / `==` do not honour it.
- East variants are `EastVariant` objects, not `{"type", "value"}` dicts.
- East `Struct`/`Option`/container values require structural validation at a
  Python↔East boundary, or they corrupt downstream.
- East `Integer` is **i64** (a Python `int` is arbitrary-precision — math that
  exceeds i64 diverges); East `Float` is **f64**.
- The eager value methods are a thin facade over the native **east-c** builtins;
  re-implementing a builtin in Python is a maintenance + divergence hazard.

Violating these causes silent type drift, NaN/ordering bugs, integer overflow
mismatches, and variant-tag confusion. Each section has **Do** / **Don't**.

---

## 1. Use East comparisons, not raw `<` / `==` / `sorted`

`compare_for` / `equal_for` / `less_for` (and `make_east_key` for sorting) from
`east` compute East's total order; raw Python operators do not (NaN handling,
mixed types, type-specific rules).

### Do
```python
from east import compare_for, equal_for, less_for, make_east_key, FloatType, IntegerType

less_for(FloatType)(a, b)
equal_for(IntegerType)(x, y)
arr.sort()                              # EastArray.sort already uses East order (ArraySortDefault)
sorted(py_list, key=make_east_key(FloatType))   # when you must sort a plain list
```

### Don't
```python
a < b                                   # Python float compare — wrong NaN/-0.0 placement
sorted(list(arr))                       # Python default ordering — wrong for floats/NaN/mixed
x == y                                  # use equal_for(T) for East equality semantics
```

---

## 2. Build variants with `variant()` / `some` / `none` — never a dict

East variants are `EastVariant` objects. A hand-rolled `{"type": ..., "value":
...}` dict is **not** a variant (`is_east_variant` rejects it, and it won't
marshal). This mirrors the workspace-wide "never hand-roll variants" rule.

### Do
```python
from east import variant, some, none, match
v = variant("rgb", {"r": 1, "g": 2, "b": 3}, Color)   # validates the case + value
opt = some(5)                                          # / none
match(opt, {"some": lambda x: x + 1}, default=0)
```

### Don't
```python
{"type": "some", "value": 5}            # not an EastVariant
```

---

## 3. Eager methods marshal to east-c — never reimplement a builtin in Python

The value methods (`sort`, `map`, `concat`, set-algebra, dict-merge, …) and the
`East.<Type>` namespaces delegate to the native east-c builtins. Do **not**
reimplement a builtin's algorithm in Python — east-c is the single, tested
source of those semantics. (The callback ops `map`/`filter`/`fold` run the
*user's lambda* in Python, but still drive the loop through east-c; that's not a
reimplementation — there's no east-c algorithm to reuse.)

### Do
```python
arr.sorted()                            # ArraySortDefault, in east-c
s1.union(s2)                            # SetUnion, in east-c
East.String.upper_case(s)               # StringUpperCase, in east-c
```

### Don't
```python
EastSet(t, sorted(set(a) | set(b)))     # reimplementing SetUnion in Python — drift risk
"".join(sorted(s))                      # bypasses east-c String semantics
```

---

## 4. Validate / coerce at the Python↔East boundary

Values crossing into East (platform-function inputs/outputs, constructed data)
must conform to the declared type, or they corrupt downstream with a cryptic
error. Use the coercion layer; let `@East.platform_function` validate outputs.

### Do
```python
from east import coerce_to, assert_value_of
items = coerce_to(raw_rows, ArrayType(LineItem))   # int→Float, dict→Struct (reordered), …
assert_value_of(result, output_type)               # path-pinpointed EastTypeError on mismatch

@East.platform_function(inputs=[...], output=ArrayType(LineItem))   # validates the result for you
def f(...): ...
```

### Don't
```python
EastStruct({"price": 1})                # raw int where Float is declared — silent corruption
```

Integer-vs-Float is decided from the **declared type**, never inferred (Python
has no bigint/float split): a Float-intended `3` is coerced to `3.0`.

---

## 5. Scalars are plain Python; their builtins live on `East.<Type>`

East `Float`/`Integer`/`String`/`Boolean`/`DateTime` *are* the corresponding
Python types — you cannot attach methods to them, so their builtins are namespace
functions. Plain arithmetic that is bit-identical to East (e.g. `a + b` on floats)
is fine; use the namespace where semantics differ (i64 overflow, integer
division/remainder sign, transcendentals, string/datetime/regex/json).

### Do
```python
East.Float.sqrt(x)
East.Integer.divide(a, b)               # i64 truncating division (not Python //)
East.DateTime.print_format(dt, "YYYY-MM-DD")
```

### Don't
```python
import math; math.sqrt(x)               # not guaranteed identical to East FloatSqrt
a // b                                  # Python floor division ≠ East IntegerDivide for negatives
```

---

## 6. Vector/Matrix: logical element vs runtime dtype

`EastVector`/`EastMatrix` carry a **logical** element type (`Float`/`Integer`/
`Boolean`); the backing numpy buffer (`.data`) may use any compatible storage
dtype (e.g. f32 for zero-copy torch interop). Reads promote to the logical
scalar; the bridge canonicalizes to the East storage width crossing into east-c.

### Do
```python
EastVector(FloatType, np.asarray(x, dtype=np.float32))   # f32 storage, logical Float — OK
torch.from_numpy(mat.data)                                # .data is the contiguous numpy buffer
EastMatrix(FloatType, model_output.numpy())               # no manual astype — bridge canonicalizes
```

### Don't
```python
EastVector(FloatType, np.array([1, 2], dtype=np.int64))   # int storage for a Float vector — rejected
```

---

## 7. Frozen values: value-`Is`, copy-first mutation

Task inputs always decode **deeply frozen** (and `load_frozen_value` /
`freeze_value` produce frozen values directly). The frozen flag lives on
the east-c value and is enforced by the native builtins the eager methods
delegate to — two semantics change, nothing else:

- **East `Is` compares frozen collections by value.** `Is` on two frozen
  Array/Set/Dict/Vector/Matrix values is deep value equality (the Blob
  precedent — a frozen collection is a value, not a mutable cell). A frozen
  `Ref` remains an identity cell. `equal_for` / `compare_for` / print /
  encode are unchanged.
- **Mutation raises** `cannot mutate a frozen value (task inputs are
  immutable) — copy first`. `.copy()` is the escape hatch.
