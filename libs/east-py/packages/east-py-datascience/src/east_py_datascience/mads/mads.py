#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MADS platform functions for East.

Provides derivative-free blackbox optimization using the NOMAD MADS algorithm
via PyNomadBBO for East programs running in Python.

MADS is designed for difficult optimization problems where:
- Functions have no exploitable derivatives
- Evaluations are computationally expensive
- Functions may be contaminated by noise
- Functions may fail for some feasible points
"""

import importlib.util
from collections.abc import Callable
from typing import Any

from east.runtime.platform import PlatformFunction
from east.types.types import (
    ArrayType,
    BooleanType,
    FloatType,
    IntegerType,
    OptionType,
    StructType,
    VariantType,
    VectorType,
)
from east.types.values import EastStruct, EastVariant, EastVector, is_east_variant

from east_py_datascience.types import ScalarObjectiveType

# ============================================================================
# Type Definitions
# ============================================================================

# MADS optimization bounds
MADSBoundsType = StructType(
    [
        ("lower", VectorType(FloatType)),
        ("upper", VectorType(FloatType)),
    ]
)

# MADS constraint type (variant where tag indicates kind)
MADSConstraintType = VariantType(
    [
        ("eb", ScalarObjectiveType),  # Extreme barrier
        ("pb", ScalarObjectiveType),  # Progressive barrier
    ]
)

# MADS direction type
MADSDirectionType = VariantType(
    [
        ("ortho_2n", StructType([])),
        ("ortho_n_plus_1", StructType([])),
        ("lt_2n", StructType([])),
        ("single", StructType([])),
    ]
)

# MADS configuration
MADSConfigType = StructType(
    [
        ("max_bb_eval", OptionType(IntegerType)),
        ("display_degree", OptionType(IntegerType)),
        ("direction_type", OptionType(MADSDirectionType)),
        ("initial_mesh_size", OptionType(FloatType)),
        ("min_mesh_size", OptionType(FloatType)),
        ("seed", OptionType(IntegerType)),
    ]
)

# MADS single-objective result
MADSResultType = StructType(
    [
        ("x_best", VectorType(FloatType)),
        ("f_best", FloatType),
        ("bb_eval", IntegerType),
        ("success", BooleanType),
    ]
)


# ============================================================================
# Helper Functions
# ============================================================================


def _get_option(opt: EastVariant | None, default: Any) -> Any:
    """Extract value from Option variant, returning default if None.

    Note: The runtime creates EastVariant instances, not EastOption instances,
    even for Option types. So we check the tag directly rather than using
    is_east_option().
    """
    if opt is None:
        return default
    if is_east_variant(opt) and opt.type == "some":
        return opt.value
    return default


def _get_direction_name(direction: EastVariant) -> str:
    """Get NOMAD direction type string from variant."""
    direction_map = {
        "ortho_2n": "ORTHO 2N",
        "ortho_n_plus_1": "ORTHO N+1",
        "lt_2n": "LT 2N",
        "single": "SINGLE",
    }
    return direction_map.get(direction.type, "ORTHO 2N")



# Lazy import guard for optional dependency
_HAS_MADS_SUPPORT = importlib.util.find_spec("PyNomad") is not None


def _check_mads_support() -> None:
    """Check if mads support is available."""
    if not _HAS_MADS_SUPPORT:
        raise NotImplementedError(
            "Mads support requires the 'mads' extra. "
            "Add east-py-datascience[mads] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


def mads_optimize_impl(
    objective_fn: Callable[[EastVector], float],
    x0: EastVector,
    bounds: EastStruct,
    constraints: EastVariant | None,
    config: EastStruct,
) -> EastStruct:
    """Run MADS single-objective optimization using PyNomadBBO.

    Args:
        objective_fn: Objective function to minimize (Vector -> Float)
        x0: Initial starting point
        bounds: Lower and upper bounds for each dimension
        constraints: Optional array of constraint functions
        config: Optimization configuration

    Returns:
        EastStruct with x_best, f_best, bb_eval, success
    """
    _check_mads_support()
    import numpy as np
    import PyNomad

    # Convert East vectors to Python lists (EastVector is not iterable; use .data)
    x0_list = x0.data.tolist()
    lb_list = bounds["lower"].data.tolist()
    ub_list = bounds["upper"].data.tolist()
    dim = len(x0_list)

    # Extract constraints if provided
    constraint_list: list[EastVariant] = []
    if is_east_variant(constraints) and constraints.type == "some":
        constraint_list = list(constraints.value)

    # Build blackbox function for PyNomad
    def bb(x: Any) -> int:
        try:
            # Extract coordinates into East vector
            x_vec = EastVector(
                FloatType,
                np.array([x.get_coord(i) for i in range(x.size())], dtype=np.float64),
            )

            # Evaluate objective
            f = objective_fn(x_vec)
            outputs = [str(f)]

            # Evaluate each constraint (variant value is the function)
            for constraint in constraint_list:
                c_fn = constraint.value  # The function is the variant value
                c_val = c_fn(x_vec)
                outputs.append(str(c_val))

            raw_bbo = " ".join(outputs)
            x.setBBO(raw_bbo.encode("UTF-8"))
            return 1
        except Exception:
            return 0

    # Build output type string: OBJ followed by constraint types
    output_types = ["OBJ"]
    for constraint in constraint_list:
        kind = constraint.type  # The variant tag indicates eb or pb
        output_types.append("EB" if kind == "eb" else "PB")

    # Build NOMAD parameters
    params = [
        f"DIMENSION {dim}",
        f"BB_OUTPUT_TYPE {' '.join(output_types)}",
        f"MAX_BB_EVAL {_get_option(config.get('max_bb_eval'), 100)}",
        f"DISPLAY_DEGREE {_get_option(config.get('display_degree'), 0)}",
    ]

    # Optional direction type
    direction = _get_option(config.get("direction_type"), None)
    if direction is not None:
        params.append(f"DIRECTION_TYPE {_get_direction_name(direction)}")

    # Optional mesh sizes
    mesh_size = _get_option(config.get("initial_mesh_size"), None)
    if mesh_size is not None:
        params.append(f"INITIAL_MESH_SIZE {mesh_size}")

    min_mesh = _get_option(config.get("min_mesh_size"), None)
    if min_mesh is not None:
        params.append(f"MIN_MESH_SIZE {min_mesh}")

    # Optional seed
    seed = _get_option(config.get("seed"), None)
    if seed is not None:
        params.append(f"SEED {seed}")

    # Run optimization
    # Returns dict with: x_best, f_best, h_best, nb_evals, nb_iters, run_flag, stop_reason
    result = PyNomad.optimize(bb, x0_list, lb_list, ub_list, params)

    x_best = result.get("x_best", x0_list)
    f_best = result.get("f_best", float("inf"))
    nb_evals = result.get("nb_evals", 0)
    run_flag = result.get("run_flag", -1)

    # run_flag >= 0 means success (found feasible point)
    success = run_flag >= 0 and f_best != float("inf")

    return EastStruct(
        {
            "x_best": EastVector(
                FloatType, np.array([float(v) for v in x_best], dtype=np.float64)
            ),
            "f_best": float(f_best),
            "bb_eval": int(nb_evals),
            "success": success,
        }
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

mads_impl = [
    PlatformFunction(
        name="mads_optimize",
        inputs=[
            ScalarObjectiveType,
            VectorType(FloatType),
            MADSBoundsType,
            OptionType(ArrayType(MADSConstraintType)),
            MADSConfigType,
        ],
        output=MADSResultType,
        type="sync",
        fn=mads_optimize_impl,
    ),
]


__all__ = [
    # Platform implementation
    "mads_impl",
    # Types
    "MADSBoundsType",
    "MADSConstraintType",
    "MADSDirectionType",
    "MADSConfigType",
    "MADSResultType",
]
