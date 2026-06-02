# Design Document: Porting Vector and Matrix Types to east-py

**Source:** TypeScript commit `f62f4a8` in `/home/crambelsoupy/src/east`
**Design spec:** `/home/crambelsoupy/src/east/devdocs/VECTOR_MATRIX_TYPES.md`
**Target:** Python package `east-py` at `/home/crambelsoupy/src/east-py/packages/east-py`

---

## 1. Overview

This document describes how to port the TypeScript `VectorType` and `MatrixType` to the Python east-py runtime. These are first-class numeric array types optimized for data science workloads, backed by NumPy arrays for zero-copy interop with ML libraries.

### Why

East programs combining general-purpose code with ML operations suffer from O(n) conversion overhead between `EastArray` (Python lists) and NumPy arrays at every ML function boundary. Vector and Matrix types eliminate this by storing data in contiguous NumPy arrays from the start.

### What's Being Ported

| Component | TypeScript | Python |
|-----------|-----------|--------|
| Type definitions | `VectorType`, `MatrixType` | `VectorType()`, `MatrixType()` constructors |
| Runtime values | `Float64Array`/`BigInt64Array`/`Uint8Array`, `matrix<T>` | `EastVector` (np.ndarray), `EastMatrix` (np.ndarray) |
| Builtins | 28 builtins (13 Vector + 15 Matrix) | 28 factory builtins |
| IR nodes | `NewVector`, `NewMatrix` | Compiler dispatch cases |
| Serialization | JSON, BEAST2, East text | JSON, BEAST2, East text |
| Comparison | `equal`, `compare`, `is` | `equal_for`, `compare_for`, `is_for` |
| Patch system | `diff`, `apply`, `compose`, `invert` | Patch operations for Vector/Matrix |

---

## 2. File Structure

Modified and new files:

```
east/
├── types/
│   ├── types.py              # MODIFY: Add VectorType, MatrixType
│   └── values.py             # MODIFY: Add EastVector, EastMatrix classes
├── builtins/
│   ├── __init__.py           # MODIFY: Import new modules
│   ├── vector.py             # NEW: 13 vector builtin factories
│   └── matrix.py             # NEW: 15 matrix builtin factories
├── runtime/
│   └── compiler.py           # MODIFY: Add NewVector, NewMatrix compilation
├── serialization/
│   ├── json.py               # MODIFY: Vector/Matrix encode/decode
│   ├── beast2.py             # MODIFY: Vector/Matrix binary encode/decode
│   ├── east_printer.py       # MODIFY: Vector/Matrix text printing
│   └── east_parser.py        # MODIFY: Vector/Matrix text parsing
├── utils/
│   └── ordering.py           # MODIFY: Vector/Matrix comparison/equality
├── patch/
│   ├── diff.py               # MODIFY: Vector/Matrix diff
│   ├── apply.py              # MODIFY: Vector/Matrix apply
│   ├── compose.py            # MODIFY: Vector/Matrix compose
│   ├── invert.py             # MODIFY: Vector/Matrix invert
│   └── type_of_patch.py      # MODIFY: Vector/Matrix patch types
└── __init__.py               # MODIFY: Export new types
```

---

## 3. Implementation Tasks

### 3.1 Add Type Definitions (`east/types/types.py`)

Add `VectorType` and `MatrixType` following the pattern of `ArrayType`:

```python
class VectorTypeDef(TypedDict):
    """Vector type - contiguous numeric array (1D)."""
    type: Literal["Vector"]
    value: EastType  # Element type (must be Float, Integer, or Boolean)


class MatrixTypeDef(TypedDict):
    """Matrix type - contiguous numeric array (2D, row-major)."""
    type: Literal["Matrix"]
    value: EastType  # Element type (must be Float, Integer, or Boolean)
```

Type constructors with element type validation:

```python
_VECTOR_ELEMENT_TYPES = frozenset({"Float", "Integer", "Boolean"})


def VectorType(element_type: EastType) -> EastVariant[EastType]:
    """Create a vector type.

    Args:
        element_type: Type of vector elements (must be Float, Integer, or Boolean)

    Returns:
        Vector type

    Raises:
        TypeError: If element_type is not Float, Integer, or Boolean
    """
    if element_type.type not in _VECTOR_ELEMENT_TYPES:
        from east.serialization.east_printer import print_type
        raise TypeError(
            f"Vector element type must be Float, Integer, or Boolean, got {print_type(element_type)}"
        )
    return EastVariant("Vector", element_type)


def MatrixType(element_type: EastType) -> EastVariant[EastType]:
    """Create a matrix type.

    Args:
        element_type: Type of matrix elements (must be Float, Integer, or Boolean)

    Returns:
        Matrix type

    Raises:
        TypeError: If element_type is not Float, Integer, or Boolean
    """
    if element_type.type not in _VECTOR_ELEMENT_TYPES:
        from east.serialization.east_printer import print_type
        raise TypeError(
            f"Matrix element type must be Float, Integer, or Boolean, got {print_type(element_type)}"
        )
    return EastVariant("Matrix", element_type)
```

Type predicates:

```python
def is_vector_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is a Vector type."""
    return typ.type == "Vector"


def is_matrix_type(typ: EastType) -> TypeGuard[EastVariant[EastType]]:
    """Check if a type is a Matrix type."""
    return typ.type == "Matrix"
```

Type aliases:

```python
VectorTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Vector types. Value is the element type."""

MatrixTypeAlias: TypeAlias = EastVariant[EastType]
"""Type alias for Matrix types. Value is the element type."""
```

**Additional updates required in `types.py`:**

1. **`is_immutable_type()`** - Add `is_vector_type` and `is_matrix_type` to the mutable exclusion list (Vector/Matrix are mutable like Array):
   ```python
   if (
       is_array_type(typ) or is_set_type(typ) or is_dict_type(typ) or is_ref_type(typ)
       or is_vector_type(typ) or is_matrix_type(typ)  # NEW
       or is_function_type(typ) or is_async_function_type(typ)
   ):
       return False
   ```

2. **`is_data_type()`** - Add Vector/Matrix as data types (they're serializable):
   ```python
   if is_ref_type(typ) or is_array_type(typ) or is_set_type(typ) or is_dict_type(typ):
       return True
   if is_vector_type(typ) or is_matrix_type(typ):  # NEW
       return True
   ```

3. **`type_equal()`** - Add Vector/Matrix equality:
   ```python
   if is_vector_type(t1):
       if is_vector_type(t2):
           return VectorType(type_equal(t1.value, t2.value, r1, r2))
       raise TypeMismatchError(...)

   if is_matrix_type(t1):
       if is_matrix_type(t2):
           return MatrixType(type_equal(t1.value, t2.value, r1, r2))
       raise TypeMismatchError(...)
   ```

4. **`is_type_equal()`** - Add Vector/Matrix:
   ```python
   if is_vector_type(t1):
       return is_vector_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)

   if is_matrix_type(t1):
       return is_matrix_type(t2) and is_type_equal(t1.value, t2.value, r1, r2)
   ```

5. **`is_subtype()`** - Add Vector/Matrix (invariant, like Array):
   ```python
   if is_vector_type(t1):
       return is_vector_type(t2) and is_type_equal(t1.value, t2.value)

   if is_matrix_type(t1):
       return is_matrix_type(t2) and is_type_equal(t1.value, t2.value)
   ```

6. **`type_union()`** - Add Vector/Matrix (invariant):
   ```python
   if is_vector_type(t1):
       if is_vector_type(t2):
           return VectorType(type_equal(t1.value, t2.value))
       raise TypeMismatchError(...)

   if is_matrix_type(t1):
       if is_matrix_type(t2):
           return MatrixType(type_equal(t1.value, t2.value))
       raise TypeMismatchError(...)
   ```

7. **`type_intersect()`** - Add Vector/Matrix (invariant):
   ```python
   if is_vector_type(t1):
       if is_vector_type(t2):
           return VectorType(type_equal(t1.value, t2.value))
       raise TypeMismatchError(...)

   if is_matrix_type(t1):
       if is_matrix_type(t2):
           return MatrixType(type_equal(t1.value, t2.value))
       raise TypeMismatchError(...)
   ```

8. **`recursive_type()` / `replace_markers()`** - Add Vector/Matrix (push to type_ctx like Array):
   ```python
   if is_vector_type(t):
       return EastVariant("Vector", replace_markers(t.value, stack_depth + 1))
   if is_matrix_type(t):
       return EastVariant("Matrix", replace_markers(t.value, stack_depth + 1))
   ```

9. **`__all__`** - Add all new exports.

---

### 3.2 Add Value Classes (`east/types/values.py`)

Add `EastVector` and `EastMatrix` classes backed by NumPy arrays.

#### Element Type to NumPy dtype Mapping

```python
import numpy as np

# Element type name -> NumPy dtype
EAST_ELEMENT_TO_DTYPE: dict[str, np.dtype] = {
    "Float": np.dtype(np.float64),
    "Integer": np.dtype(np.int64),
    "Boolean": np.dtype(np.bool_),
}
```

#### EastVector

```python
class EastVector:
    """East vector - contiguous 1D numeric array backed by NumPy.

    Represents a 1D array of Float, Integer, or Boolean values stored in a
    contiguous NumPy array for zero-copy interop with ML libraries.

    Attributes:
        data: The underlying NumPy array (1D)
        element_type: The East element type (FloatType, IntegerType, or BooleanType)
    """

    __slots__ = ("data", "element_type", "_hash")

    def __init__(self, element_type: "EastType", data: np.ndarray | None = None, length: int = 0):
        """Create a vector.

        Args:
            element_type: East element type
            data: Optional NumPy array (used directly, not copied)
            length: Length for zero-initialized vector (used if data is None)
        """
        self.element_type = element_type
        if data is not None:
            self.data = data
        else:
            dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]
            self.data = np.zeros(length, dtype=dtype)
        self._hash: int | None = None

    def __len__(self) -> int:
        return len(self.data)

    def __repr__(self) -> str:
        return f"EastVector({self.element_type.type}, {self.data!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, EastVector):
            return NotImplemented
        return (self.element_type.type == other.element_type.type
                and len(self.data) == len(other.data)
                and np.array_equal(self.data, other.data))

    def __hash__(self) -> int:
        raise TypeError("EastVector is mutable and cannot be hashed")
```

#### EastMatrix

```python
class EastMatrix:
    """East matrix - contiguous 2D numeric array backed by NumPy (row-major).

    Represents a 2D array of Float, Integer, or Boolean values stored in a
    contiguous row-major NumPy array for zero-copy interop with ML libraries.

    Attributes:
        data: The underlying NumPy array (2D, C-order/row-major)
        element_type: The East element type (FloatType, IntegerType, or BooleanType)
        rows: Number of rows
        cols: Number of columns
    """

    __slots__ = ("data", "element_type", "rows", "cols", "_hash")

    def __init__(
        self,
        element_type: "EastType",
        data: np.ndarray | None = None,
        rows: int = 0,
        cols: int = 0,
    ):
        """Create a matrix.

        Args:
            element_type: East element type
            data: Optional NumPy array (2D row-major, used directly)
            rows: Number of rows (used if data is None)
            cols: Number of columns (used if data is None)
        """
        self.element_type = element_type
        if data is not None:
            if data.ndim == 1:
                # Flat array - reshape to 2D
                self.data = data.reshape(rows, cols)
            else:
                self.data = data
            self.rows = self.data.shape[0]
            self.cols = self.data.shape[1] if self.data.ndim > 1 else 0
        else:
            dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]
            self.data = np.zeros((rows, cols), dtype=dtype, order="C")
            self.rows = rows
            self.cols = cols
        self._hash: int | None = None

    def __repr__(self) -> str:
        return f"EastMatrix({self.element_type.type}, {self.rows}x{self.cols}, {self.data!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, EastMatrix):
            return NotImplemented
        return (self.element_type.type == other.element_type.type
                and self.rows == other.rows
                and self.cols == other.cols
                and np.array_equal(self.data, other.data))

    def __hash__(self) -> int:
        raise TypeError("EastMatrix is mutable and cannot be hashed")
```

#### Type Guard Functions

```python
def is_east_vector(value: Any) -> TypeGuard[EastVector]:
    """Check if a value is an EastVector."""
    return isinstance(value, EastVector)


def is_east_matrix(value: Any) -> TypeGuard[EastMatrix]:
    """Check if a value is an EastMatrix."""
    return isinstance(value, EastMatrix)
```

**Note:** NumPy is already a dependency of east-py (used by ML platform functions in east-py-datascience). Add `import numpy as np` at module level in `values.py`. If numpy is an optional dependency, guard the import with a try/except and raise a clear error.

---

### 3.3 Create Vector Builtins (`east/builtins/vector.py`)

Create 13 vector builtin factories following the pattern in `east/builtins/array.py`:

```python
"""Vector builtin functions.

These are factory builtins that take type parameters at compile time.
"""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from east.runtime.platform import PlatformFunction

from east.builtins.registry import register_builtin
from east.runtime.compiler import EastError
from east.types.types import EastType, FloatType
from east.types.values import EAST_ELEMENT_TO_DTYPE, EastArray, EastMatrix, EastVector, east_null


def vector_length_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector], int]:
    def vector_length(vec: EastVector) -> int:
        return len(vec)
    return vector_length


def vector_get_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector, int], Any]:
    is_boolean = T.type == "Boolean"

    def vector_get(vec: EastVector, index: int) -> Any:
        if index < 0 or index >= len(vec.data):
            raise EastError(
                f"Vector index {index} out of bounds for length {len(vec.data)}",
                {"filename": "", "line": 0, "column": 0},
            )
        val = vec.data[index]
        if is_boolean:
            return bool(val)
        return val.item()  # Convert numpy scalar to Python scalar
    return vector_get


def vector_set_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector, int, Any], Any]:
    def vector_set(vec: EastVector, index: int, value: Any) -> Any:
        if index < 0 or index >= len(vec.data):
            raise EastError(
                f"Vector index {index} out of bounds for length {len(vec.data)}",
                {"filename": "", "line": 0, "column": 0},
            )
        vec.data[index] = value
        return east_null
    return vector_set


def vector_slice_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector, int, int], EastVector]:
    def vector_slice(vec: EastVector, start: int, end: int) -> EastVector:
        return EastVector(vec.element_type, vec.data[start:end].copy())
    return vector_slice


def vector_concat_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector, EastVector], EastVector]:
    def vector_concat(a: EastVector, b: EastVector) -> EastVector:
        return EastVector(a.element_type, np.concatenate([a.data, b.data]))
    return vector_concat


def vector_from_array_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastArray], EastVector]:
    dtype = EAST_ELEMENT_TO_DTYPE[T.type]

    def vector_from_array(arr: EastArray) -> EastVector:
        return EastVector(T, np.array(list(arr), dtype=dtype))
    return vector_from_array


def vector_to_array_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector], EastArray]:
    is_boolean = T.type == "Boolean"

    def vector_to_array(vec: EastVector) -> EastArray:
        if is_boolean:
            return EastArray(T, [bool(x) for x in vec.data])
        return EastArray(T, [x.item() for x in vec.data])
    return vector_to_array


def vector_to_matrix_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastVector, int, int], EastMatrix]:
    def vector_to_matrix(vec: EastVector, rows: int, cols: int) -> EastMatrix:
        if rows * cols != len(vec.data):
            raise EastError(
                f"Cannot reshape vector of length {len(vec.data)} to {rows}x{cols} matrix",
                {"filename": "", "line": 0, "column": 0},
            )
        return EastMatrix(vec.element_type, vec.data.copy().reshape(rows, cols))
    return vector_to_matrix


def vector_zeros_for(
    _platform: "list[PlatformFunction]",
) -> Callable[[int], EastVector]:
    def vector_zeros(length: int) -> EastVector:
        return EastVector(FloatType, np.zeros(length, dtype=np.float64))
    return vector_zeros


def vector_ones_for(
    _platform: "list[PlatformFunction]",
) -> Callable[[int], EastVector]:
    def vector_ones(length: int) -> EastVector:
        return EastVector(FloatType, np.ones(length, dtype=np.float64))
    return vector_ones


def vector_fill_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[int, Any], EastVector]:
    dtype = EAST_ELEMENT_TO_DTYPE[T.type]

    def vector_fill(length: int, value: Any) -> EastVector:
        return EastVector(T, np.full(length, value, dtype=dtype))
    return vector_fill


def vector_map_for(
    _platform: "list[PlatformFunction]", T: EastType, T2: EastType
) -> Callable[[EastVector, Callable], EastVector]:
    dtype = EAST_ELEMENT_TO_DTYPE[T2.type]
    is_boolean_in = T.type == "Boolean"

    def vector_map(vec: EastVector, fn: Callable) -> EastVector:
        results = []
        for i in range(len(vec.data)):
            elem = bool(vec.data[i]) if is_boolean_in else vec.data[i].item()
            results.append(fn(elem, i))
        return EastVector(T2, np.array(results, dtype=dtype))
    return vector_map


def vector_fold_for(
    _platform: "list[PlatformFunction]", T: EastType, T2: EastType
) -> Callable[[EastVector, Any, Callable], Any]:
    is_boolean = T.type == "Boolean"

    def vector_fold(vec: EastVector, init: Any, fn: Callable) -> Any:
        acc = init
        for i in range(len(vec.data)):
            elem = bool(vec.data[i]) if is_boolean else vec.data[i].item()
            acc = fn(acc, elem, i)
        return acc
    return vector_fold


# Register all vector builtins
register_builtin("VectorLength", vector_length_for)
register_builtin("VectorGet", vector_get_for)
register_builtin("VectorSet", vector_set_for)
register_builtin("VectorSlice", vector_slice_for)
register_builtin("VectorConcat", vector_concat_for)
register_builtin("VectorFromArray", vector_from_array_for)
register_builtin("VectorToArray", vector_to_array_for)
register_builtin("VectorToMatrix", vector_to_matrix_for)
register_builtin("VectorZeros", vector_zeros_for)
register_builtin("VectorOnes", vector_ones_for)
register_builtin("VectorFill", vector_fill_for)
register_builtin("VectorMap", vector_map_for)
register_builtin("VectorFold", vector_fold_for)
```

---

### 3.4 Create Matrix Builtins (`east/builtins/matrix.py`)

Create 15 matrix builtin factories:

```python
"""Matrix builtin functions.

These are factory builtins that take type parameters at compile time.
"""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from east.runtime.platform import PlatformFunction

from east.builtins.registry import register_builtin
from east.runtime.compiler import EastError
from east.types.types import ArrayType, EastType, FloatType
from east.types.values import EAST_ELEMENT_TO_DTYPE, EastArray, EastMatrix, EastVector, east_null


def matrix_rows_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix], int]:
    def matrix_rows(mat: EastMatrix) -> int:
        return mat.rows
    return matrix_rows


def matrix_cols_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix], int]:
    def matrix_cols(mat: EastMatrix) -> int:
        return mat.cols
    return matrix_cols


def matrix_get_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix, int, int], Any]:
    is_boolean = T.type == "Boolean"

    def matrix_get(mat: EastMatrix, row: int, col: int) -> Any:
        if row < 0 or row >= mat.rows or col < 0 or col >= mat.cols:
            raise EastError(
                f"Matrix index ({row}, {col}) out of bounds for {mat.rows}x{mat.cols} matrix",
                {"filename": "", "line": 0, "column": 0},
            )
        val = mat.data[row, col]
        if is_boolean:
            return bool(val)
        return val.item()
    return matrix_get


def matrix_set_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix, int, int, Any], Any]:
    def matrix_set(mat: EastMatrix, row: int, col: int, value: Any) -> Any:
        if row < 0 or row >= mat.rows or col < 0 or col >= mat.cols:
            raise EastError(
                f"Matrix index ({row}, {col}) out of bounds for {mat.rows}x{mat.cols} matrix",
                {"filename": "", "line": 0, "column": 0},
            )
        mat.data[row, col] = value
        return east_null
    return matrix_set


def matrix_get_row_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix, int], EastVector]:
    def matrix_get_row(mat: EastMatrix, row: int) -> EastVector:
        if row < 0 or row >= mat.rows:
            raise EastError(
                f"Matrix row {row} out of bounds for {mat.rows}x{mat.cols} matrix",
                {"filename": "", "line": 0, "column": 0},
            )
        return EastVector(mat.element_type, mat.data[row].copy())
    return matrix_get_row


def matrix_get_col_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix, int], EastVector]:
    def matrix_get_col(mat: EastMatrix, col: int) -> EastVector:
        if col < 0 or col >= mat.cols:
            raise EastError(
                f"Matrix column {col} out of bounds for {mat.rows}x{mat.cols} matrix",
                {"filename": "", "line": 0, "column": 0},
            )
        return EastVector(mat.element_type, mat.data[:, col].copy())
    return matrix_get_col


def matrix_to_vector_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix], EastVector]:
    def matrix_to_vector(mat: EastMatrix) -> EastVector:
        return EastVector(mat.element_type, mat.data.ravel(order="C").copy())
    return matrix_to_vector


def matrix_from_array_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastArray], EastMatrix]:
    dtype = EAST_ELEMENT_TO_DTYPE[T.type]

    def matrix_from_array(arr: EastArray) -> EastMatrix:
        if len(arr) == 0:
            return EastMatrix(T, np.empty((0, 0), dtype=dtype))
        # Validate rectangular (non-jagged)
        cols = len(arr[0])
        for i, row in enumerate(arr):
            if len(row) != cols:
                raise EastError(
                    f"Jagged array: row 0 has {cols} columns but row {i} has {len(row)}",
                    {"filename": "", "line": 0, "column": 0},
                )
        rows = len(arr)
        data = np.array([list(row) for row in arr], dtype=dtype)
        return EastMatrix(T, data, rows, cols)
    return matrix_from_array


def matrix_to_array_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix], EastArray]:
    is_boolean = T.type == "Boolean"

    def matrix_to_array(mat: EastMatrix) -> EastArray:
        inner_type = ArrayType(T) if False else T  # Element type for inner arrays
        rows = []
        for r in range(mat.rows):
            if is_boolean:
                row = EastArray(T, [bool(mat.data[r, c]) for c in range(mat.cols)])
            else:
                row = EastArray(T, [mat.data[r, c].item() for c in range(mat.cols)])
            rows.append(row)
        return EastArray(ArrayType(T), rows)
    return matrix_to_array


def matrix_transpose_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[EastMatrix], EastMatrix]:
    def matrix_transpose(mat: EastMatrix) -> EastMatrix:
        transposed = np.ascontiguousarray(mat.data.T)
        return EastMatrix(mat.element_type, transposed)
    return matrix_transpose


def matrix_zeros_for(
    _platform: "list[PlatformFunction]",
) -> Callable[[int, int], EastMatrix]:
    def matrix_zeros(rows: int, cols: int) -> EastMatrix:
        return EastMatrix(FloatType, np.zeros((rows, cols), dtype=np.float64))
    return matrix_zeros


def matrix_ones_for(
    _platform: "list[PlatformFunction]",
) -> Callable[[int, int], EastMatrix]:
    def matrix_ones(rows: int, cols: int) -> EastMatrix:
        return EastMatrix(FloatType, np.ones((rows, cols), dtype=np.float64))
    return matrix_ones


def matrix_fill_for(
    _platform: "list[PlatformFunction]", T: EastType
) -> Callable[[int, int, Any], EastMatrix]:
    dtype = EAST_ELEMENT_TO_DTYPE[T.type]

    def matrix_fill(rows: int, cols: int, value: Any) -> EastMatrix:
        return EastMatrix(T, np.full((rows, cols), value, dtype=dtype))
    return matrix_fill


def matrix_map_elements_for(
    _platform: "list[PlatformFunction]", T: EastType, T2: EastType
) -> Callable[[EastMatrix, Callable], EastMatrix]:
    dtype = EAST_ELEMENT_TO_DTYPE[T2.type]
    is_boolean_in = T.type == "Boolean"

    def matrix_map_elements(mat: EastMatrix, fn: Callable) -> EastMatrix:
        results = []
        for r in range(mat.rows):
            for c in range(mat.cols):
                elem = bool(mat.data[r, c]) if is_boolean_in else mat.data[r, c].item()
                results.append(fn(elem, r, c))
        data = np.array(results, dtype=dtype).reshape(mat.rows, mat.cols)
        return EastMatrix(T2, data)
    return matrix_map_elements


def matrix_map_rows_for(
    _platform: "list[PlatformFunction]", T: EastType, T2: EastType
) -> Callable[[EastMatrix, Callable], EastMatrix]:
    def matrix_map_rows(mat: EastMatrix, fn: Callable) -> EastMatrix:
        row_vecs = []
        for r in range(mat.rows):
            row_vec = EastVector(mat.element_type, mat.data[r].copy())
            result_vec = fn(row_vec, r)
            row_vecs.append(result_vec.data)
        if not row_vecs:
            dtype = EAST_ELEMENT_TO_DTYPE[T2.type]
            return EastMatrix(T2, np.empty((0, 0), dtype=dtype))
        data = np.stack(row_vecs)
        return EastMatrix(T2, data)
    return matrix_map_rows


# Register all matrix builtins
register_builtin("MatrixRows", matrix_rows_for)
register_builtin("MatrixCols", matrix_cols_for)
register_builtin("MatrixGet", matrix_get_for)
register_builtin("MatrixSet", matrix_set_for)
register_builtin("MatrixGetRow", matrix_get_row_for)
register_builtin("MatrixGetCol", matrix_get_col_for)
register_builtin("MatrixToVector", matrix_to_vector_for)
register_builtin("MatrixFromArray", matrix_from_array_for)
register_builtin("MatrixToArray", matrix_to_array_for)
register_builtin("MatrixTranspose", matrix_transpose_for)
register_builtin("MatrixZeros", matrix_zeros_for)
register_builtin("MatrixOnes", matrix_ones_for)
register_builtin("MatrixFill", matrix_fill_for)
register_builtin("MatrixMapElements", matrix_map_elements_for)
register_builtin("MatrixMapRows", matrix_map_rows_for)
```

---

### 3.5 Update Builtin Registration (`east/builtins/__init__.py`)

Add imports to trigger registration:

```python
from east.builtins import (  # noqa: F401
    array,
    blob,
    boolean,
    comparison,
    datetime_ops,
    dict_ops,
    float_ops,
    integer,
    matrix,      # NEW
    patch,
    ref_ops,
    set_ops,
    string,
    vector,      # NEW
)
```

---

### 3.6 Add Compiler Support (`east/runtime/compiler.py`)

Add `NewVector` and `NewMatrix` to the `_compile_ir()` dispatcher, following the `NewArray` pattern:

```python
elif tag == "NewVector":
    ir_value = node.value
    element_type = ir_value["type"].value  # The element type from VectorType
    dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]

    # Compile element value IR nodes
    elements_info = []
    any_async = False
    for val_ir in ir_value["values"]:
        fn, is_async = _compile_ir(val_ir, platform_fns, async_platform_fns, platform_list)
        elements_info.append((fn, is_async))
        if is_async:
            any_async = True

    if any_async:
        async def newvector_async(env, _elements_info=elements_info, _element_type=element_type, _dtype=dtype):
            vals = []
            for elem_fn, elem_is_async in _elements_info:
                val = await elem_fn(env) if elem_is_async else elem_fn(env)
                vals.append(val)
            return EastVector(_element_type, np.array(vals, dtype=_dtype))
        return newvector_async, True

    element_fns = tuple(fn for fn, _ in elements_info)

    def newvector_sync(env, _element_fns=element_fns, _element_type=element_type, _dtype=dtype):
        vals = [f(env) for f in _element_fns]
        return EastVector(_element_type, np.array(vals, dtype=_dtype))
    return newvector_sync, False


elif tag == "NewMatrix":
    ir_value = node.value
    element_type = ir_value["type"].value  # The element type from MatrixType
    dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]
    rows = ir_value["rows"]  # int (bigint from IR)
    cols = ir_value["cols"]  # int (bigint from IR)

    # Compile element value IR nodes (flat list in row-major order)
    elements_info = []
    any_async = False
    for val_ir in ir_value["values"]:
        fn, is_async = _compile_ir(val_ir, platform_fns, async_platform_fns, platform_list)
        elements_info.append((fn, is_async))
        if is_async:
            any_async = True

    if any_async:
        async def newmatrix_async(env, _elements_info=elements_info, _element_type=element_type,
                                   _dtype=dtype, _rows=rows, _cols=cols):
            vals = []
            for elem_fn, elem_is_async in _elements_info:
                val = await elem_fn(env) if elem_is_async else elem_fn(env)
                vals.append(val)
            data = np.array(vals, dtype=_dtype).reshape(_rows, _cols)
            return EastMatrix(_element_type, data, _rows, _cols)
        return newmatrix_async, True

    element_fns = tuple(fn for fn, _ in elements_info)

    def newmatrix_sync(env, _element_fns=element_fns, _element_type=element_type,
                        _dtype=dtype, _rows=rows, _cols=cols):
        vals = [f(env) for f in _element_fns]
        data = np.array(vals, dtype=_dtype).reshape(_rows, _cols)
        return EastMatrix(_element_type, data, _rows, _cols)
    return newmatrix_sync, False
```

**Imports to add at top of compiler.py:**
```python
import numpy as np
from east.types.values import EastVector, EastMatrix, EAST_ELEMENT_TO_DTYPE
```

---

### 3.7 JSON Serialization (`east/serialization/json.py`)

#### Encoding

Follow the pattern used for Array encoding. Vector serializes as a flat JSON array, Matrix as nested arrays:

```python
# In to_json_for() or equivalent encoder factory:

if is_vector_type(type_val):
    element_type = type_val.value
    element_encoder = to_json_for(element_type, type_ctx, marker_map)
    is_boolean = element_type.type == "Boolean"

    def encode_vector(value: EastVector, ctx=None):
        result = []
        for i in range(len(value.data)):
            elem = bool(value.data[i]) if is_boolean else value.data[i].item()
            result.append(element_encoder(elem, ctx))
        return result
    return encode_vector


if is_matrix_type(type_val):
    element_type = type_val.value
    element_encoder = to_json_for(element_type, type_ctx, marker_map)
    is_boolean = element_type.type == "Boolean"

    def encode_matrix(value: EastMatrix, ctx=None):
        result = []
        for r in range(value.rows):
            row = []
            for c in range(value.cols):
                elem = bool(value.data[r, c]) if is_boolean else value.data[r, c].item()
                row.append(element_encoder(elem, ctx))
            result.append(row)
        return result
    return encode_matrix
```

#### Decoding

```python
# In from_json_for() or equivalent decoder factory:

if is_vector_type(type_val):
    element_type = type_val.value
    element_decoder = from_json_for(element_type, type_ctx, marker_map)
    dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]

    def decode_vector(json_val, ctx=None):
        if not isinstance(json_val, list):
            raise ValueError(f"Expected array for Vector, got {type(json_val)}")
        values = [element_decoder(item, ctx) for item in json_val]
        return EastVector(element_type, np.array(values, dtype=dtype))
    return decode_vector


if is_matrix_type(type_val):
    element_type = type_val.value
    element_decoder = from_json_for(element_type, type_ctx, marker_map)
    dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]

    def decode_matrix(json_val, ctx=None):
        if not isinstance(json_val, list):
            raise ValueError(f"Expected nested array for Matrix, got {type(json_val)}")
        if len(json_val) == 0:
            return EastMatrix(element_type, np.empty((0, 0), dtype=dtype))
        rows = len(json_val)
        cols = len(json_val[0])
        flat_values = []
        for r in range(rows):
            if len(json_val[r]) != cols:
                raise ValueError(f"Jagged matrix: row 0 has {cols} columns but row {r} has {len(json_val[r])}")
            for c in range(cols):
                flat_values.append(element_decoder(json_val[r][c], ctx))
        data = np.array(flat_values, dtype=dtype).reshape(rows, cols)
        return EastMatrix(element_type, data, rows, cols)
    return decode_matrix
```

**Note:** Vectors and Matrices do NOT support backreferences or cyclic references (they contain only primitives). This simplifies the implementation compared to Array.

---

### 3.8 BEAST2 Binary Serialization (`east/serialization/beast2.py`)

The BEAST2 format for Vector/Matrix uses raw binary data for maximum performance:

#### Element Type to Bytes Mapping

```python
_ELEMENT_BYTES = {"Float": 8, "Integer": 8, "Boolean": 1}

_ELEMENT_DTYPE = {
    "Float": np.dtype("<f8"),   # little-endian float64
    "Integer": np.dtype("<i8"),  # little-endian int64
    "Boolean": np.dtype(np.uint8),
}
```

#### Encoding

```python
# In beast2 encoder:

if is_vector_type(type_val):
    element_type_name = type_val.value.type

    def encode_vector(value: EastVector, writer, ctx):
        writer.write_varint(len(value.data))
        # Write raw bytes directly from NumPy buffer
        raw = value.data.tobytes()
        writer.write_bytes(raw)
    return encode_vector


if is_matrix_type(type_val):
    element_type_name = type_val.value.type

    def encode_matrix(value: EastMatrix, writer, ctx):
        writer.write_varint(value.rows)
        writer.write_varint(value.cols)
        # Write raw bytes from flattened data (already row-major)
        raw = value.data.tobytes()
        writer.write_bytes(raw)
    return encode_matrix
```

#### Decoding

```python
# In beast2 decoder:

if is_vector_type(type_val):
    element_type = type_val.value
    dtype = _ELEMENT_DTYPE[element_type.type]
    bytes_per_element = _ELEMENT_BYTES[element_type.type]

    def decode_vector(buffer, offset, ctx):
        length, new_offset = read_varint(buffer, offset)
        byte_len = length * bytes_per_element
        raw = buffer[new_offset:new_offset + byte_len]
        data = np.frombuffer(raw, dtype=dtype).copy()  # Copy to make writable
        if element_type.type == "Boolean":
            data = data.astype(np.bool_)
        return EastVector(element_type, data), new_offset + byte_len
    return decode_vector


if is_matrix_type(type_val):
    element_type = type_val.value
    dtype = _ELEMENT_DTYPE[element_type.type]
    bytes_per_element = _ELEMENT_BYTES[element_type.type]

    def decode_matrix(buffer, offset, ctx):
        rows, offset1 = read_varint(buffer, offset)
        cols, offset2 = read_varint(buffer, offset1)
        total = rows * cols
        byte_len = total * bytes_per_element
        raw = buffer[offset2:offset2 + byte_len]
        data = np.frombuffer(raw, dtype=dtype).copy().reshape(rows, cols)
        if element_type.type == "Boolean":
            data = data.astype(np.bool_)
        return EastMatrix(element_type, data, rows, cols), offset2 + byte_len
    return decode_matrix
```

**Performance note:** This achieves near zero-copy deserialization. The only copy is the `.copy()` call to make the buffer writable (NumPy arrays from `frombuffer` are read-only by default). For truly zero-copy, the buffer could be memory-mapped, but copy is safer for mutation.

---

### 3.9 East Text Format (`east/serialization/east_printer.py` and `east_parser.py`)

#### Printing Types

```python
# In print_type():
if is_vector_type(type_val):
    return f".Vector {print_type(type_val.value, stack)}"

if is_matrix_type(type_val):
    return f".Matrix {print_type(type_val.value, stack)}"
```

#### Printing Values

```python
# In print_value() or value printer factory:
if is_vector_type(type_val):
    element_type = type_val.value
    is_boolean = element_type.type == "Boolean"
    element_printer = value_printer_for(element_type)

    def print_vector(value: EastVector) -> str:
        parts = []
        for i in range(len(value.data)):
            elem = bool(value.data[i]) if is_boolean else value.data[i].item()
            parts.append(element_printer(elem))
        return f"vec[{', '.join(parts)}]"
    return print_vector


if is_matrix_type(type_val):
    element_type = type_val.value
    is_boolean = element_type.type == "Boolean"
    element_printer = value_printer_for(element_type)

    def print_matrix(value: EastMatrix) -> str:
        row_parts = []
        for r in range(value.rows):
            elem_parts = []
            for c in range(value.cols):
                elem = bool(value.data[r, c]) if is_boolean else value.data[r, c].item()
                elem_parts.append(element_printer(elem))
            row_parts.append(f"[{', '.join(elem_parts)}]")
        return f"mat[{', '.join(row_parts)}]"
    return print_matrix
```

#### Parsing Types

```python
# In parse_type():
if token == ".Vector":
    advance()
    element_type = parse_type()
    return VectorType(element_type)

if token == ".Matrix":
    advance()
    element_type = parse_type()
    return MatrixType(element_type)
```

#### Parsing Values

```python
# In parse_value():
if token == "vec":
    advance()
    expect("[")
    elements = []
    while current_token() != "]":
        elements.append(parse_element_value(element_type))
        if current_token() == ",":
            advance()
    expect("]")
    dtype = EAST_ELEMENT_TO_DTYPE[element_type.type]
    return EastVector(element_type, np.array(elements, dtype=dtype))

if token == "mat":
    advance()
    expect("[")
    rows = []
    while current_token() != "]":
        expect("[")
        row = []
        while current_token() != "]":
            row.append(parse_element_value(element_type))
            if current_token() == ",":
                advance()
        expect("]")
        rows.append(row)
        if current_token() == ",":
            advance()
    expect("]")
    # ... build EastMatrix from rows
```

---

### 3.10 Ordering and Comparison (`east/utils/ordering.py`)

#### Identity Check (`is_for`)

Vector and Matrix use identity comparison (like Array):

```python
# In is_for():
if is_vector_type(type_val) or is_matrix_type(type_val):
    def is_identity(a, b):
        return a is b
    return is_identity
```

#### Structural Equality (`equal_for`)

```python
# In equal_for():
if is_vector_type(type_val):
    def equal_vector(a: EastVector, b: EastVector) -> bool:
        return (len(a.data) == len(b.data)
                and np.array_equal(a.data, b.data))
    return equal_vector

if is_matrix_type(type_val):
    def equal_matrix(a: EastMatrix, b: EastMatrix) -> bool:
        return (a.rows == b.rows
                and a.cols == b.cols
                and np.array_equal(a.data, b.data))
    return equal_matrix
```

#### Comparison (`compare_for`)

Lexicographic comparison - Vector by length then elements, Matrix by (rows, cols, data):

```python
# In compare_for():
if is_vector_type(type_val):
    def compare_vector(a: EastVector, b: EastVector) -> int:
        # Compare lengths first
        if len(a.data) != len(b.data):
            return -1 if len(a.data) < len(b.data) else 1
        # Lexicographic element comparison
        for i in range(len(a.data)):
            if a.data[i] < b.data[i]:
                return -1
            if a.data[i] > b.data[i]:
                return 1
        return 0
    return compare_vector

if is_matrix_type(type_val):
    def compare_matrix(a: EastMatrix, b: EastMatrix) -> int:
        # Compare shape first
        if a.rows != b.rows:
            return -1 if a.rows < b.rows else 1
        if a.cols != b.cols:
            return -1 if a.cols < b.cols else 1
        # Lexicographic element comparison (row-major)
        flat_a = a.data.ravel()
        flat_b = b.data.ravel()
        for i in range(len(flat_a)):
            if flat_a[i] < flat_b[i]:
                return -1
            if flat_a[i] > flat_b[i]:
                return 1
        return 0
    return compare_matrix
```

---

### 3.11 Patch System Updates (`east/patch/`)

Vector and Matrix use **replace-only** patch semantics (like Function types), since element-level patching of contiguous numeric arrays is not practical.

#### `type_of_patch.py`

```python
if is_vector_type(type_val) or is_matrix_type(type_val):
    return VariantType([
        ("unchanged", NullType),
        ("replace", StructType([("before", type_val), ("after", type_val)])),
    ])
```

#### `diff.py`

```python
if is_vector_type(type_val) or is_matrix_type(type_val):
    equal = equal_for(type_val)

    def diff_vector_matrix(before, after):
        if equal(before, after):
            return EastVariant("unchanged", None)
        return EastVariant("replace", EastStruct({"before": before, "after": after}))
    return diff_vector_matrix
```

#### `apply.py`

```python
if is_vector_type(type_val) or is_matrix_type(type_val):
    equal = equal_for(type_val)

    def apply_vector_matrix(base, patch):
        if patch.type == "unchanged":
            return base
        if patch.type == "replace":
            if not equal(base, patch.value["before"]):
                raise ConflictError("Cannot apply replace - base does not match expected before")
            return patch.value["after"]
        raise ConflictError(f"Unknown patch case: {patch.type}")
    return apply_vector_matrix
```

#### `compose.py`

```python
if is_vector_type(type_val) or is_matrix_type(type_val):
    equal = equal_for(type_val)

    def compose_vector_matrix(first, second):
        if first.type == "unchanged":
            return second
        if second.type == "unchanged":
            return first
        # Both are replace - chain them
        return EastVariant("replace", EastStruct({
            "before": first.value["before"],
            "after": second.value["after"],
        }))
    return compose_vector_matrix
```

#### `invert.py`

```python
if is_vector_type(type_val) or is_matrix_type(type_val):
    def invert_vector_matrix(patch):
        if patch.type == "unchanged":
            return patch
        if patch.type == "replace":
            return EastVariant("replace", EastStruct({
                "before": patch.value["after"],
                "after": patch.value["before"],
            }))
        raise ValueError(f"Unknown patch case: {patch.type}")
    return invert_vector_matrix
```

---

### 3.12 Default Values (`east/types/defaults.py` or equivalent)

If the codebase has a `default_for` function that creates default values for types:

```python
if is_vector_type(type_val):
    dtype = EAST_ELEMENT_TO_DTYPE[type_val.value.type]
    return EastVector(type_val.value, np.empty(0, dtype=dtype))

if is_matrix_type(type_val):
    dtype = EAST_ELEMENT_TO_DTYPE[type_val.value.type]
    return EastMatrix(type_val.value, np.empty((0, 0), dtype=dtype))
```

---

### 3.13 IR Analysis (`east/ir/analyze.py`)

If the codebase has IR analysis/validation, add cases for `NewVector` and `NewMatrix`:

```python
elif tag == "NewVector":
    # Validate type is VectorType
    ir_type = node.value["type"]
    if ir_type.type != "Vector":
        raise AnalysisError(f"NewVector IR node has non-Vector type: {ir_type.type}")
    # Visit all value IR nodes
    for val_ir in node.value["values"]:
        visit(val_ir)

elif tag == "NewMatrix":
    # Validate type is MatrixType
    ir_type = node.value["type"]
    if ir_type.type != "Matrix":
        raise AnalysisError(f"NewMatrix IR node has non-Matrix type: {ir_type.type}")
    # Visit all value IR nodes
    for val_ir in node.value["values"]:
        visit(val_ir)
```

---

### 3.14 Type Serialization (`EastTypeType`)

The homoiconic type representation (`EastTypeType`) needs Vector and Matrix cases. If `east/types/type_of_type.py` or an equivalent exists:

```python
# EastTypeType = RecursiveType(type => VariantType({
#   ... existing types ...
#   "Vector": type,  // element type
#   "Matrix": type,  // element type
# }));
```

The `toEastTypeValue` and `expandTypeValue` functions need cases:

```python
if is_vector_type(t):
    return EastVariant("Vector", to_type_value(t.value, type_ctx))

if is_matrix_type(t):
    return EastVariant("Matrix", to_type_value(t.value, type_ctx))
```

And the reverse:

```python
if type_value.type == "Vector":
    return VectorType(expand_type_value(type_value.value, type_ctx))

if type_value.type == "Matrix":
    return MatrixType(expand_type_value(type_value.value, type_ctx))
```

---

### 3.15 Module Exports (`east/__init__.py`)

Add new exports:

```python
from east.types.types import VectorType, MatrixType, is_vector_type, is_matrix_type
from east.types.values import EastVector, EastMatrix, is_east_vector, is_east_matrix
```

---

## 4. Key Implementation Details

### 4.1 NumPy dtype Mapping

| Element Type | NumPy dtype | Python scalar type | Notes |
|-------------|-------------|-------------------|-------|
| `FloatType` | `np.float64` | `float` | Standard 64-bit float |
| `IntegerType` | `np.int64` | `int` | 64-bit signed integer |
| `BooleanType` | `np.bool_` | `bool` | Must convert via `bool()` on read |

**Important:** When reading Boolean elements from NumPy, always convert with `bool()` since NumPy returns `np.bool_` which is not Python `bool`.

### 4.2 Row-Major Storage

Matrix data is stored in C-order (row-major), matching NumPy's default. Element at `(row, col)` is at flat index `row * cols + col`. This means:
- `np.zeros((rows, cols))` creates the right layout
- `data.ravel(order="C")` flattens correctly for MatrixToVector
- `data.reshape(rows, cols)` works for VectorToMatrix
- `np.ascontiguousarray(data.T)` creates a properly laid out transpose

### 4.3 Copy Semantics

Following the TypeScript implementation:
- **VectorSlice**, **VectorConcat**: Return copies (new arrays)
- **VectorToMatrix**, **MatrixToVector**: Return copies (reshape copies data)
- **MatrixGetRow**, **MatrixGetCol**: Return copies (not views)
- **MatrixTranspose**: Returns copy
- **VectorFromArray**, **MatrixFromArray**: Copy from East collections to NumPy
- **VectorToArray**, **MatrixToArray**: Copy from NumPy to East collections

### 4.4 Mutability

Vector and Matrix are **mutable** (like Array), supporting `VectorSet` and `MatrixSet`. They:
- Cannot be used as Set keys or Dict keys
- Are excluded from `is_immutable_type()`
- Use identity (`is`) comparison, not structural equality, for `is_for`
- Use structural equality for `equal_for`

### 4.5 BEAST2 Zero-Copy Potential

The BEAST2 binary format stores Vector/Matrix data as raw bytes (not per-element encoding). This enables near-zero-copy deserialization:
- Vector: `varint(length) + raw_bytes(length * sizeof(element))`
- Matrix: `varint(rows) + varint(cols) + raw_bytes(rows * cols * sizeof(element))`

**No backreferences** are needed for Vector/Matrix (unlike Array/Dict) since they contain only primitive numeric data and cannot be cyclic.

### 4.6 Error Handling

All bounds-checking errors should raise `EastError` (from `east.runtime.compiler`) with location info, following the pattern used by other builtins:

```python
raise EastError(
    f"Vector index {index} out of bounds for length {len(vec.data)}",
    {"filename": "", "line": 0, "column": 0},
)
```

The compiler's builtin handler will extend the location with the call site information.

---

## 5. Testing Strategy

Tests are validated via the compliance test infrastructure in `tests/test_compliance.py`, which runs IR exported from TypeScript tests through the Python runtime.

**To run vector/matrix tests after implementation:**

```bash
# In the TypeScript east repo, export test IR:
cd /home/crambelsoupy/src/east && npm run test:export

# Run compliance tests in east-py:
cd /home/crambelsoupy/src/east-py/packages/east-py
uv run pytest tests/test_compliance.py -v -k "vector or matrix"
```

The TypeScript `test/vector.spec.ts` (~225 lines, ~25 tests) and `test/matrix.spec.ts` (~206 lines, ~20 tests) use `describeEast` which exports IR to `/tmp/east-test-ir/`. The Python compliance runner loads these IR files and validates:

- Vector creation (zeros, ones, fill, fromArray)
- Vector element access (get, set, bounds checking)
- Vector operations (slice, concat)
- Vector conversions (toArray, toMatrix)
- Vector higher-order (map, fold)
- Vector element types (Float, Integer, Boolean)
- Matrix creation (zeros, ones, fill, fromArray)
- Matrix element access (get, set, bounds checking)
- Matrix row/column operations (getRow, getCol)
- Matrix transformations (transpose, toVector, toArray)
- Matrix element types (Float, Integer, Boolean)
- Serialization round-trips (JSON, BEAST2, East text)
- Comparison operations (equal, compare)

No separate Python test files need to be written.

---

## 6. Implementation Order

1. **Phase 1: Types and Values**
   - [ ] `east/types/types.py` - Type definitions, constructors, predicates, type operations
   - [ ] `east/types/values.py` - EastVector, EastMatrix classes

2. **Phase 2: Ordering and Comparison**
   - [ ] `east/utils/ordering.py` - equal_for, compare_for, is_for for Vector/Matrix

3. **Phase 3: Compiler**
   - [ ] `east/runtime/compiler.py` - NewVector, NewMatrix compilation

4. **Phase 4: Builtins**
   - [ ] `east/builtins/vector.py` - 13 vector builtin factories
   - [ ] `east/builtins/matrix.py` - 15 matrix builtin factories
   - [ ] `east/builtins/__init__.py` - Import registration

5. **Phase 5: Serialization**
   - [ ] `east/serialization/json.py` - JSON encode/decode
   - [ ] `east/serialization/beast2.py` - Binary encode/decode
   - [ ] `east/serialization/east_printer.py` - Text format printing
   - [ ] `east/serialization/east_parser.py` - Text format parsing

6. **Phase 6: Patch System**
   - [ ] `east/patch/type_of_patch.py` - Patch type for Vector/Matrix
   - [ ] `east/patch/diff.py` - Diff operation
   - [ ] `east/patch/apply.py` - Apply operation
   - [ ] `east/patch/compose.py` - Compose operation
   - [ ] `east/patch/invert.py` - Invert operation

7. **Phase 7: IR and Exports**
   - [ ] `east/ir/analyze.py` - IR analysis (if applicable)
   - [ ] Type serialization (EastTypeType extension)
   - [ ] `east/__init__.py` - Module exports

8. **Phase 8: Compliance Validation**
   - [ ] Export IR from TypeScript: `npm run test:export`
   - [ ] Run: `uv run pytest tests/test_compliance.py -v -k "vector or matrix"`

---

## 7. Estimated Scope

| Component | Estimated Lines | Files |
|-----------|----------------|-------|
| Type system (`types.py`) | ~100 new + ~80 modified | 1 |
| Value classes (`values.py`) | ~120 | 1 |
| Vector builtins | ~200 | 1 (new) |
| Matrix builtins | ~250 | 1 (new) |
| Compiler | ~80 | 1 |
| JSON serialization | ~80 | 1 |
| BEAST2 serialization | ~60 | 1 |
| East text format | ~80 | 2 |
| Ordering | ~60 | 1 |
| Patch system | ~60 | 5 |
| IR/exports/misc | ~40 | 3 |
| **Total** | **~1,200 lines** | **~18 files** |

---

## 8. Validation Checklist

- [ ] VectorType and MatrixType constructors validate element types (Float, Integer, Boolean only)
- [ ] EastVector backed by NumPy 1D array with correct dtype
- [ ] EastMatrix backed by NumPy 2D array (row-major) with correct dtype
- [ ] All 13 vector builtins registered and functional
- [ ] All 15 matrix builtins registered and functional
- [ ] Bounds checking on all get/set operations
- [ ] Boolean elements properly converted between np.bool_ and Python bool
- [ ] VectorToMatrix validates rows*cols == length
- [ ] MatrixFromArray validates rectangular (non-jagged) input
- [ ] JSON serialization: Vector as flat array, Matrix as nested array
- [ ] BEAST2 serialization: raw binary with varint length/shape headers
- [ ] East text format: `vec[...]` and `mat[[...], [...]]`
- [ ] Type system: Vector/Matrix are mutable, not immutable
- [ ] Type system: invariant subtyping (like Array)
- [ ] Comparison: identity for `is`, structural for `equal`, lexicographic for `compare`
- [ ] Patch: replace-only semantics for both types
- [ ] Compiler handles NewVector and NewMatrix IR nodes (sync and async)
- [ ] All compliance tests pass
