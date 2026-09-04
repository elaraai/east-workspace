# East Data Science Development Standards

**MANDATORY for all East Data Science development.**

This package contains platform functions with:
- **TypeScript**: Type definitions and tests (no runtime implementation)
- **Python**: Runtime implementations

---

## Module Structure

Each module (e.g., `mads`) has this structure:

```
src/
├── types.ts                    # Shared types (VectorType, MatrixType, etc.)
├── index.ts                    # Package exports
├── mads/
│   └── mads.ts                 # Types + platform function declarations
└── east_py_datascience/        # Python package
    ├── __init__.py             # Package exports + `platform`
    ├── _common.py              # Shared helpers (serialize, extra_guard, option_tag, ...)
    ├── types.py                # Shared types (must match TypeScript)
    └── mads/
        ├── __init__.py         # Module exports
        └── mads.py             # Types + implementations
test/
└── mads.spec.ts                # Export-only East tests; Python replays their IR
tests/
└── test_compliance.py          # pytest wrapper over the exported IR
```

---

## TypeScript

### Module File (`mads.ts`)

```typescript
import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    IntegerType,
    BooleanType,
    FloatType,
} from "@elaraai/east";
import { VectorType, ScalarObjectiveType } from "../types.js";

// Re-export shared types used by this module
export { VectorType, ScalarObjectiveType } from "../types.js";

// ===========================================
// Type Definitions
// ===========================================

export const MADSBoundsType = StructType({
    lower: VectorType,
    upper: VectorType,
});

export const MADSResultType = StructType({
    x_best: VectorType,
    f_best: FloatType,
    bb_eval: IntegerType,
    success: BooleanType,
});

// ===========================================
// Platform Functions
// ===========================================

export const mads_optimize = East.platform(
    "mads_optimize",
    [
        ScalarObjectiveType,
        VectorType,
        MADSBoundsType,
        OptionType(ArrayType(MADSConstraintType)),
        MADSConfigType,
    ],
    MADSResultType
);

// ===========================================
// Grouped Export
// ===========================================

export const MADSTypes = {
    VectorType,
    ScalarObjectiveType,
    BoundsType: MADSBoundsType,
    ConfigType: MADSConfigType,
    ResultType: MADSResultType,
} as const;

export const MADS = {
    optimize: mads_optimize,
    Types: MADSTypes,
} as const;
```

**Key points:**
- NO `Implementation` export (implementation is Python-only)
- NO `MADSImpl` export
- Types grouped in `MADSTypes`
- Functions and types grouped in `MADS`

### Package Index (`index.ts`)

```typescript
// MADS - Derivative-free optimization
export {
    MADS,
    mads_optimize,
    MADSTypes,
    VectorType,
    ScalarObjectiveType,
    MADSBoundsType,
    MADSConstraintType,
    MADSDirectionType,
    MADSConfigType,
    MADSResultType,
} from "./mads/mads.js";

// Shared types
export {
    VectorType as SharedVectorType,
    MatrixType,
    ScalarObjectiveType as SharedScalarObjectiveType,
} from "./types.js";
```

### Tests (`mads.spec.ts`)

```typescript
import { ArrayType, East, FloatType, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { MADS, MADSConstraintType } from "@elaraai/east-py-datascience";

describeEast("MADS platform functions", (test) => {
    test("optimize minimizes sum of squares", $ => {
        const objective = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            return $.return(x0.multiply(x0));
        });

        const x0 = $.let([0.5]);
        const bounds = $.let({ lower: [-1.0], upper: [1.0] });
        const config = $.let({
            max_bb_eval: variant('some', 100n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('none', null), config));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.f_best, East.value(0.1)));
    });
}, { exportOnly: true });
```

**Key points:**
- Specs live in `test/` and import the package by name (`@elaraai/east-py-datascience`)
- Import from `@elaraai/east-node-std` for `describeEast` and `Assert`
- NO `platformFns` option (no TypeScript implementation)
- MUST set `exportOnly: true` (tests export IR for Python to run)
- Tests written in East DSL using `$` block builder

---

## Python

### Types (MANDATORY)

Use types from `east.types.types`:

```python
from east.types.types import (
    ArrayType, FloatType, IntegerType, BooleanType, StringType,
    StructType, VariantType, FunctionType, OptionType,
)
```

Use values from `east.types.values`, and the constructors from `east`:

```python
from east import none, some, variant
from east.types.values import EastArray, EastMatrix, EastStruct, EastVariant, EastVector
```

### Reading and building East values (MANDATORY)

Options and variants arrive as `EastVariant`. Read them through the value
API — never by inspecting `.type == "some"` by hand, and never with
`is_east_option`:

```python
max_iter = int(config["max_iter"].unwrap_or(100))        # Option<Integer>
weights = config["weights"].unwrap_or(None)               # Option<Matrix<Float>> -> EastMatrix | None
kernel = option_tag(config["kernel"], "rbf")              # Option<Variant> -> its case name
payload = expect_case(model_blob, "xgboost_regressor", "xgboost_predict")  # model-blob guard
```

Build results with the constructors: `some(x)` / `none` for options,
`variant(case, value, Type)` for variants (the type validates the case and
coerces the payload; the runtime class `EastVariant(case, value)` is fine when
the payload is already an East value), `EastStruct({...})`,
`EastVector(FloatType, np_array)`, `EastMatrix(FloatType, np_2d)`. Never
hand-roll a `{"type", "value"}` dict. Let `@platform_function(output=...)`
validate the result; do not re-check it.

`east_py_datascience._common` holds the helpers every module shares:
`serialize` / `deserialize` (cloudpickle blobs), `extra_guard` (the
optional-extra check each module builds its `_check_<lib>_support()` from),
`option_tag`, `expect_case`, and `quiet_warnings` (a scoped `UserWarning` /
`FutureWarning` filter for chatty fits). `_categorical` holds the categorical
column handling the tree models share. Reuse them; do not re-implement them
per module.

Errors: raise with the platform function's name in the message
(`"xgboost_predict: Expected xgboost_regressor, got xgboost_classifier"`) and
let programming errors propagate. Wrap a third-party call in
`except Exception` only to add that context — never to swallow it, and never
around your own conversions.

### Module File (`mads.py`)

```python
"""MADS platform functions for East."""

from collections.abc import Callable

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, BooleanType, FloatType, IntegerType, OptionType, StructType
from east.types.values import EastStruct, EastVariant, EastVector

from east_py_datascience._common import extra_guard
from east_py_datascience.types import ScalarObjectiveType, VectorType

# ===========================================
# Type Definitions (must match TypeScript)
# ===========================================

MADSBoundsType = StructType([
    ("lower", VectorType),
    ("upper", VectorType),
])

MADSResultType = StructType([
    ("x_best", VectorType),
    ("f_best", FloatType),
    ("bb_eval", IntegerType),
    ("success", BooleanType),
])

# Layer 1 of PYTHON_OPTIONAL_DEPS.md: probe once at import, raise at call time.
_check_mads_support = extra_guard("PyNomad", "mads", "MADS")

# ===========================================
# Implementation
# ===========================================


@platform_function(
    name="mads_optimize",
    inputs=[
        ScalarObjectiveType,
        VectorType,
        MADSBoundsType,
        OptionType(ArrayType(MADSConstraintType)),
        MADSConfigType,
    ],
    output=MADSResultType,
)
def mads_optimize(
    objective_fn: Callable[[EastVector], float],
    x0: EastVector,
    bounds: EastStruct,
    constraints: EastVariant,
    config: EastStruct,
) -> EastStruct:
    """Run MADS optimization using PyNomadBBO.

    The docstring documents every East field of every argument, the result
    shape, and the errors raised (see the existing modules for the style).
    """
    _check_mads_support()
    import PyNomad  # layer 2: the native import lives inside the function

    x0_np = x0.to_numpy()
    lower = bounds["lower"].to_numpy()
    upper = bounds["upper"].to_numpy()
    constraint_fns = constraints.unwrap_or([])
    max_bb_eval = int(config["max_bb_eval"].unwrap_or(100))

    # ... implementation ...

    return EastStruct({
        "x_best": EastVector(FloatType, np.asarray(x_best, dtype=np.float64)),
        "f_best": float(f_best),
        "bb_eval": int(nb_evals),
        "success": success,
    })


# ===========================================
# Platform Function Registration
# ===========================================

# Collected from the @platform_function decorations above.
mads_impl = platform_functions(__name__)

__all__ = [
    "mads_impl",
    "mads_optimize",
    "MADSBoundsType",
    "MADSResultType",
]
```

The decorator registers the function under its East name with the declared
input and output types; the platform coerces the arguments to East values on
the way in and validates the result on the way out. Functions generic over a
type parameter use `@generic_platform_function` (see `causal_impl.py`);
C-level implementations register a `PlatformFunction(..., c_callback=capsule)`
entry directly (see `optimization.py`).

### Module `__init__.py`

```python
"""MADS platform functions for East Data Science."""

from east_py_datascience.mads.mads import (
    MADSBoundsType,
    MADSResultType,
    mads_impl,
    mads_optimize_impl,
)

__all__ = [
    # Platform registration
    "mads_impl",
    # Directly-callable implementation (reusable from a project's own platform function)
    "mads_optimize_impl",
    # East type definitions
    "MADSBoundsType",
    "MADSResultType",
]
```

### Package `__init__.py`

```python
"""East Data Science Platform Functions."""

from importlib.metadata import PackageNotFoundError, version

from east_py_datascience.mads import mads_impl
from east_py_datascience.types import MatrixType, VectorType

try:
    __version__ = version("elaraai-east-py-datascience")
except PackageNotFoundError:  # a source checkout that is not installed
    __version__ = "0.0.0"

# Complete platform - pass to compile_async()
platform = [
    *mads_impl,
]

__all__ = [
    "__version__",
    "platform",
    "mads_impl",
    "VectorType",
    "MatrixType",
]
```

The version comes from the installed distribution metadata, so `pyproject.toml`
is the single place it is declared.

### Compliance Tests (`tests/test_compliance.py`)

The TypeScript specs are export-only: `pnpm run test:export` writes one IR
file per spec to `/tmp/east-py-datascience`. Python replays them through
east-py's core runner (`packages/east-py/tests/test_compliance.py -p
east_py_datascience`), which registers this package's `platform` and asserts
every exported test; a message pinned by a spec (`Assert.throws(..., /regex/)`)
must keep its wording on the Python side.

`tests/test_compliance.py` is a thin pytest wrapper: one parametrized case per
IR file, each run in a subprocess so a native crash in one library cannot
take the rest down. It reads `EAST_DATASCIENCE_IR_DIR` (default
`/tmp/east-py-datascience`) and skips when nothing has been exported.

```bash
cd libs/east-py && make test-east-py-datascience EAST_QUIET=1   # export + replay (the canonical run)
cd libs/east-py/packages/east-py-datascience && make test        # the same, through pytest
```

---

## Type Correspondence

Types MUST match exactly between TypeScript and Python:

| TypeScript | Python |
|------------|--------|
| `ArrayType(FloatType)` | `ArrayType(FloatType)` |
| `StructType({ a: T })` | `StructType([("a", T)])` |
| `VariantType({ tag: T })` | `VariantType([("tag", T)])` |
| `OptionType(T)` | `OptionType(T)` |
| `FunctionType([A], R)` | `FunctionType([A], R)` |

---

## Compliance Checklist

### TypeScript
- [ ] No `Implementation` export (Python-only)
- [ ] Types grouped in `{Module}Types`
- [ ] Module object has `Types` property
- [ ] Tests use `{ exportOnly: true }`
- [ ] Tests import from `@elaraai/east-node-std`
- [ ] `make build` passes
- [ ] `make lint` passes
- [ ] `make test-export` generates IR

### Python
- [ ] Types from `east.types.types`; values from `east.types.values`
- [ ] Types match TypeScript exactly
- [ ] Every impl carries `@platform_function`; the module exports
      `platform_functions(__name__)` as `{module}_impl`
- [ ] Options read with `unwrap_or` / `option_tag`; model blobs with `expect_case`
- [ ] Optional native imports inside the function, behind an `extra_guard`
- [ ] Every public function has a docstring covering its East fields, result and errors
- [ ] Package `__init__.py` exports `platform` and re-exports the module
- [ ] `make lint` and `make typecheck` pass (from `libs/east-py`)
- [ ] `make test-east-py-datascience` passes (from `libs/east-py`)
