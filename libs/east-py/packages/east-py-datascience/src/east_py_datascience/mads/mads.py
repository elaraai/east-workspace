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

from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
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
"""Per-dimension bounds for the MADS search domain.

Fields: ``lower`` (``Vector<Float>`` lower bounds per dimension),
``upper`` (``Vector<Float>`` upper bounds per dimension).
"""

# MADS constraint type (variant where tag indicates kind)
MADSConstraintType = VariantType(
    [
        ("eb", ScalarObjectiveType),  # Extreme barrier
        ("pb", ScalarObjectiveType),  # Progressive barrier
    ]
)
"""A single NOMAD constraint with its handling strategy.

Cases: ``eb`` (``Function<[Vector<Float>], Float>`` - extreme barrier; trial
rejected when value > 0), ``pb`` (``Function<[Vector<Float>], Float>`` -
progressive barrier; violations accumulated in barrier parameter).
"""

# MADS direction type
MADSDirectionType = VariantType(
    [
        ("ortho_2n", NullType),
        ("ortho_n_plus_1", NullType),
        ("lt_2n", NullType),
        ("single", NullType),
    ]
)
"""Poll direction strategy for NOMAD's mesh exploration.

Cases: ``ortho_2n`` (2n orthogonal directions, default), ``ortho_n_plus_1``
(n+1 directions), ``lt_2n`` (less than 2n, dynamic), ``single`` (one
direction per poll).
"""

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
"""Solver configuration for a MADS run.

Fields: ``max_bb_eval`` (maximum blackbox evaluations, default 100),
``display_degree`` (NOMAD verbosity 0-4, default 0 silent),
``direction_type`` (poll direction strategy, default ``ortho_2n``),
``initial_mesh_size`` (Delta^0, default NOMAD heuristic),
``min_mesh_size`` (termination mesh size Delta_min),
``seed`` (NOMAD random seed for reproducibility).
"""

# MADS single-objective result
MADSResultType = StructType(
    [
        ("x_best", VectorType(FloatType)),
        ("f_best", FloatType),
        ("bb_eval", IntegerType),
        ("success", BooleanType),
    ]
)
"""Outcome of a MADS single-objective optimization run.

Fields: ``x_best`` (``Vector<Float>`` best feasible point found),
``f_best`` (``Float`` objective value at that point),
``bb_eval`` (``Integer`` total blackbox evaluations consumed),
``success`` (``Boolean`` true when a feasible solution was found and
``f_best != inf``).
"""


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


@platform_function(
    name="mads_optimize",
    inputs=[
        ScalarObjectiveType,
        VectorType(FloatType),
        MADSBoundsType,
        OptionType(ArrayType(MADSConstraintType)),
        MADSConfigType,
    ],
    output=MADSResultType,
)
def mads_optimize_impl(
    objective_fn: Callable[[EastVector], float],
    x0: EastVector,
    bounds: EastStruct,
    constraints: EastVariant | None,
    config: EastStruct,
) -> EastStruct:
    """Run MADS single-objective derivative-free optimization via PyNomadBBO.

    Minimizes ``objective_fn`` over a bounded continuous domain using the
    Mesh Adaptive Direct Search (NOMAD) algorithm. Constraint functions are
    evaluated as part of the blackbox and handled via extreme-barrier or
    progressive-barrier strategies.

    Args:
        objective_fn: ``Function<[Vector<Float>], Float>`` (callable) -
            blackbox to minimize; receives the current point as a
            ``Vector<Float>`` and returns a scalar.
        x0: ``Vector<Float>`` (``EastVector``) - initial starting point;
            length sets the problem dimension.
        bounds: ``MADSBoundsType`` (``EastStruct``) with fields:

            - ``lower`` (``Vector<Float>``): per-dimension lower bounds.
            - ``upper`` (``Vector<Float>``): per-dimension upper bounds.

        constraints: ``Option<Array<MADSConstraintType>>`` (``EastVariant``) -
            optional constraint functions.  Each ``MADSConstraintType`` is a
            variant:

            - ``eb`` (``Function<[Vector<Float>], Float>``): extreme-barrier
              constraint; trial is rejected whenever the function value > 0.
            - ``pb`` (``Function<[Vector<Float>], Float>``): progressive-barrier
              constraint; violations are summed into the barrier parameter.

        config: ``MADSConfigType`` (``EastStruct``) with fields:

            - ``max_bb_eval`` (``Option<Integer>``): maximum blackbox
              evaluations (default 100).
            - ``display_degree`` (``Option<Integer>``): NOMAD verbosity level
              0-4 (default 0, silent).
            - ``direction_type`` (``Option<MADSDirectionType>``): poll
              direction strategy - ``ortho_2n`` (default), ``ortho_n_plus_1``,
              ``lt_2n``, or ``single``.
            - ``initial_mesh_size`` (``Option<Float>``): initial mesh size
              parameter Delta^0 (default NOMAD heuristic).
            - ``min_mesh_size`` (``Option<Float>``): termination mesh size
              Delta_min.
            - ``seed`` (``Option<Integer>``): NOMAD random seed for
              reproducible runs.

    Returns:
        ``MADSResultType`` (``EastStruct``): ``x_best`` (``Vector<Float>``
        best feasible point), ``f_best`` (``Float`` objective at that point),
        ``bb_eval`` (``Integer`` total evaluations consumed), ``success``
        (``Boolean`` true when a feasible solution was found and
        ``f_best != inf``).

    Raises:
        NotImplementedError: the ``mads`` extra (PyNomadBBO) is not installed.
    """
    _check_mads_support()
    import numpy as np
    import PyNomad

    # Convert East vectors to Python lists via the read-only numpy view
    x0_list = x0.to_numpy().tolist()
    lb_list = bounds["lower"].to_numpy().tolist()
    ub_list = bounds["upper"].to_numpy().tolist()
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

mads_impl = platform_functions(__name__)


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
