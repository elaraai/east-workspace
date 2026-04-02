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
│   ├── mads.ts                 # Types + platform function declarations
│   └── mads.spec.ts            # Tests (export-only)
└── east_py_datascience/        # Python package
    ├── __init__.py             # Package exports + datascience_platform
    ├── types.py                # Shared types (must match TypeScript)
    └── mads/
        ├── __init__.py         # Module exports
        └── mads.py             # Types + implementations
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
import { MADS, MADSConstraintType } from "./mads.js";

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

Use values from `east.types.values`:

```python
from east.types.values import (
    EastArray, EastStruct, EastVariant,
    is_east_variant,  # Use for checking option variants from deserialized IR
)
```

**IMPORTANT:** When working with `OptionType` values from deserialized IR, use `is_east_variant` NOT `is_east_option`. The IR deserializes options as `EastVariant` with `'some'` or `'none'` tags, not as `EastOption` instances.

```python
def _get_option(opt: EastVariant | None, default: Any) -> Any:
    """Extract value from Option variant, returning default if None."""
    if opt is None:
        return default
    if is_east_variant(opt) and opt.type == "some":
        return opt.value
    return default
```

### Module File (`mads.py`)

```python
"""MADS platform functions for East."""

from typing import Any, Callable

from east.runtime.platform import PlatformFunction
from east.types.types import (
    ArrayType, BooleanType, FloatType, IntegerType,
    OptionType, StructType, VariantType,
)
from east.types.values import EastArray, EastStruct, EastVariant, is_east_variant

from east_py_datascience.types import VectorType, ScalarObjectiveType

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

# ===========================================
# Implementation
# ===========================================

def mads_optimize_impl(
    objective_fn: Callable[[EastArray], float],
    x0: EastArray,
    bounds: EastStruct,
    constraints: EastVariant | None,
    config: EastStruct,
) -> EastStruct:
    """Run MADS optimization using PyNomadBBO."""
    import PyNomad

    # Convert East values to Python
    x0_list = list(x0)
    lb_list = list(bounds["lower"])
    ub_list = list(bounds["upper"])

    # ... implementation ...

    # Return East values
    return EastStruct({
        "x_best": EastArray(FloatType, [float(v) for v in x_best]),
        "f_best": float(f_best),
        "bb_eval": int(nb_evals),
        "success": success,
    })

# ===========================================
# Platform Function Registration
# ===========================================

mads_impl = [
    PlatformFunction(
        name="mads_optimize",
        inputs=[
            ScalarObjectiveType,
            VectorType,
            MADSBoundsType,
            OptionType(ArrayType(MADSConstraintType)),
            MADSConfigType,
        ],
        output=MADSResultType,
        type="sync",  # or "async"
        fn=mads_optimize_impl,
    ),
]

__all__ = [
    "mads_impl",
    "MADSBoundsType",
    "MADSResultType",
]
```

### Module `__init__.py`

```python
"""MADS platform functions for East Data Science."""

from east_py_datascience.mads.mads import (
    mads_impl,
    MADSBoundsType,
    MADSResultType,
)

__all__ = [
    "mads_impl",
    "MADSBoundsType",
    "MADSResultType",
]
```

### Package `__init__.py`

```python
"""East Data Science Platform Functions."""

from east_py_datascience.mads import mads_impl
from east_py_datascience.types import VectorType, MatrixType

__version__ = "0.1.0"

# Complete platform - pass to compile_async()
datascience_platform = [
    *mads_impl,
]

__all__ = [
    "__version__",
    "datascience_platform",
    "mads_impl",
    "VectorType",
    "MatrixType",
]
```

### Compliance Tests (`tests/test_compliance.py`)

Tests run exported IR from TypeScript:

```python
"""Compliance tests for East Data Science platform functions."""

import asyncio
import json
import os
from pathlib import Path

import pytest
from east.runtime.compiler import compile_async

from east_py_datascience import datascience_platform

EXPORT_DIR = Path(os.environ.get("EXPORT_TEST_IR", "/tmp/east-py-datascience"))


def get_test_files():
    """Get all exported test IR files."""
    if not EXPORT_DIR.exists():
        return []
    return list(EXPORT_DIR.glob("*.json"))


@pytest.mark.parametrize("ir_file", get_test_files(), ids=lambda f: f.stem)
def test_typescript_exported_ir(ir_file: Path, subtests):
    """Run tests exported from TypeScript."""
    with open(ir_file) as f:
        test_data = json.load(f)

    async def run_tests():
        for test in test_data["tests"]:
            with subtests.test(msg=test["name"]):
                compiled = await compile_async(test["ir"], datascience_platform)
                await compiled()

    asyncio.run(run_tests())
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
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:export` generates IR

### Python
- [ ] Types from `east.types.types`
- [ ] Values from `east.types.values`
- [ ] Types match TypeScript exactly
- [ ] `PlatformFunction` registration
- [ ] Module exports `{module}_impl` list
- [ ] Package exports `datascience_platform`
- [ ] `uv run pytest` passes
