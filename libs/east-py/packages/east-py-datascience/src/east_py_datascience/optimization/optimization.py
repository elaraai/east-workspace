#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Iterative coordinate-descent optimization for East.

Provides discrete combinatorial optimization by iteratively optimizing each
element of a parameter vector over its candidate values.  Supports multi-start
sampling for better exploration of the search space.

Ported from the Julia IterativeDecisionAlgorithm (ArrayParameterSpace branch).

All three functions are implemented at C level via Cython PyCapsule callbacks;
there is no Python-callable wrapper.  Register them in your platform with the
``optimization_impl`` list.

``optimization_iterative``
    Signature: ``(objective: (params: Vector<Integer>) -> Float,
    spaces: Array<Vector<Integer>>, config: IterativeConfigType)
    -> IterativeResultType``

    Each objective call receives the full current parameter vector.
    Use when the objective is inseparable across dimensions.

``optimization_iterative_incremental``
    Signature: ``(objective: (params: Vector<Integer>, idx: Integer) -> Float,
    spaces: Array<Vector<Integer>>, config: IterativeConfigType)
    -> IterativeResultType``

    The objective receives the full parameter vector and a dimension index and
    must return only the contribution of that element.  The algorithm
    maintains running per-element sums so each sweep re-evaluates only
    the changed element, giving O(dims) evaluations per pass instead of
    O(dims * candidates).

``optimization_iterative_grouped``
    Signature: ``(objective: (params: Vector<Integer>, key: Integer) -> Float,
    spaces: Array<Vector<Integer>>, config: IterativeConfigType)
    -> IterativeResultType``

    Like incremental, but the objective receives a *group key* (the integer
    value itself) rather than a position index.  Contributions are tracked per
    unique value across all dimensions; useful when many positions share values
    and the contribution depends on the value, not the position.

``IterativeConfigType`` fields
    - ``iterations`` (``Option<Integer>``): coordinate-descent passes (default
      100).
    - ``samples`` (``Option<Integer>``): independent multi-start restarts
      (default 1); the best across all restarts is returned.
    - ``initial`` (``Option<InitialStrategyType>``): ``first`` (pick the first
      candidate per space, default) or ``random``.
    - ``order`` (``Option<EvaluationOrderType>``): ``sequential`` (default) or
      ``random`` - dimension visit order within each pass (iterative only).
    - ``random_state`` (``Option<Integer>``): RNG seed (default 42).
    - ``mode`` (``Option<ModeType>``): ``coordinate`` (default) or ``swap``
      - swap mode evaluates all pairwise position swaps instead of per-dimension
      candidate sweeps; suited to permutation problems.

``IterativeResultType`` fields
    - ``best_parameters`` (``Vector<Integer>``): optimal parameter vector.
    - ``best_objective`` (``Float``): objective value at the best parameters.
    - ``iterations`` (``Integer``): total coordinate-descent passes performed
      (summed across all restarts).
    - ``evaluations`` (``Integer``): total objective calls (summed across all
      restarts).
    - ``success`` (``Boolean``): true when at least one evaluation succeeded.
"""

from east.runtime.platform import PlatformFunction
from east.types.types import (
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StructType,
    VariantType,
    VectorType,
)

# ============================================================================
# Type Definitions (must match TypeScript exactly)
# ============================================================================

InitialStrategyType = VariantType(
    [
        ("first", NullType),
        ("random", NullType),
    ]
)
"""Starting-point strategy for each coordinate-descent restart.

Cases: ``first`` (pick the first candidate in each space, default),
``random`` (sample a random candidate per dimension).
"""

EvaluationOrderType = VariantType(
    [
        ("sequential", NullType),
        ("random", NullType),
    ]
)
"""Dimension visit order within each coordinate-descent pass (iterative only).

Cases: ``sequential`` (visit dimensions 0, 1, … n-1 in order, default),
``random`` (shuffle dimension order each pass).
"""

ModeType = VariantType(
    [
        ("coordinate", NullType),
        ("swap", NullType),
    ]
)
"""Search mode for the iterative optimizer.

Cases: ``coordinate`` (sweep each dimension over its candidate values,
default), ``swap`` (evaluate all pairwise position swaps - suited to
permutation problems).
"""

IterativeConfigType = StructType(
    [
        ("iterations", OptionType(IntegerType)),
        ("samples", OptionType(IntegerType)),
        ("initial", OptionType(InitialStrategyType)),
        ("order", OptionType(EvaluationOrderType)),
        ("random_state", OptionType(IntegerType)),
        ("mode", OptionType(ModeType)),
    ]
)
"""Configuration for iterative coordinate-descent optimization.

Fields: ``iterations`` (coordinate-descent passes per restart, default 100),
``samples`` (independent multi-start restarts; best result is returned,
default 1), ``initial`` (``InitialStrategyType``, default ``first``),
``order`` (``EvaluationOrderType``, default ``sequential``),
``random_state`` (RNG seed, default 42), ``mode`` (``ModeType``, default
``coordinate``).
"""

IterativeResultType = StructType(
    [
        ("best_parameters", VectorType(IntegerType)),
        ("best_objective", FloatType),
        ("iterations", IntegerType),
        ("evaluations", IntegerType),
        ("success", BooleanType),
    ]
)
"""Result from an iterative coordinate-descent run.

Fields: ``best_parameters`` (``Vector<Integer>`` - optimal parameter vector),
``best_objective`` (``Float`` - objective value at the best parameters),
``iterations`` (``Integer`` - total coordinate-descent passes summed across
all restarts), ``evaluations`` (``Integer`` - total objective calls summed
across all restarts), ``success`` (``Boolean`` - true when at least one
evaluation succeeded).
"""


# ============================================================================
# Platform Function Registration
# ============================================================================

from east_py_datascience.optimization._optimization_eastc import (
    optimization_iterative_capsule,
    optimization_iterative_grouped_capsule,  # group-based per-value variant
    optimization_iterative_incremental_capsule,  # incremental per-element variant
)

optimization_impl = [
    PlatformFunction(
        name="optimization_iterative",
        inputs=[
            FunctionType([VectorType(IntegerType)], FloatType),
            ArrayType(VectorType(IntegerType)),
            IterativeConfigType,
        ],
        output=IterativeResultType,
        type="sync",
        fn=None,
        c_callback=optimization_iterative_capsule,
    ),
    PlatformFunction(
        name="optimization_iterative_incremental",
        inputs=[
            FunctionType([VectorType(IntegerType), IntegerType], FloatType),
            ArrayType(VectorType(IntegerType)),
            IterativeConfigType,
        ],
        output=IterativeResultType,
        type="sync",
        fn=None,
        c_callback=optimization_iterative_incremental_capsule,
    ),
    PlatformFunction(
        name="optimization_iterative_grouped",
        inputs=[
            FunctionType([VectorType(IntegerType), IntegerType], FloatType),
            ArrayType(VectorType(IntegerType)),
            IterativeConfigType,
        ],
        output=IterativeResultType,
        type="sync",
        fn=None,
        c_callback=optimization_iterative_grouped_capsule,
    ),
]


__all__ = [
    # Platform implementation
    "optimization_impl",
    # Types
    "InitialStrategyType",
    "EvaluationOrderType",
    "ModeType",
    "IterativeConfigType",
    "IterativeResultType",
]
