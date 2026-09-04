#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""ALNS platform functions for East.

Provides Adaptive Large Neighborhood Search optimization using the alns library
for East programs running in Python.

ALNS is designed for combinatorial optimization problems where:
- Solutions are discrete structures (schedules, routes, assignments)
- Domain-specific destroy/repair operators can be defined
- The objective function may be complex or black-box
- Local search alone gets stuck in local minima
"""

import importlib.util
from collections.abc import Callable
from typing import Any

from east.runtime.platform import generic_platform_function, platform_functions
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
)
from east.types.values import EastArray, EastStruct, EastVariant, is_east_variant

# ============================================================================
# Type Definitions
# ============================================================================

# Simulated annealing config
SimulatedAnnealingConfigType = StructType(
    [
        ("start_temperature", OptionType(FloatType)),
        ("end_temperature", OptionType(FloatType)),
        ("step", OptionType(FloatType)),
    ]
)
"""Temperature schedule parameters for the simulated-annealing acceptance criterion.

Fields: ``start_temperature`` (initial temperature, default 100.0),
``end_temperature`` (cooling stops here, default 0.01),
``step`` (multiplicative cooling factor per iteration, default 0.99).
"""

# Record-to-record config
RecordToRecordConfigType = StructType(
    [
        ("threshold", OptionType(FloatType)),
    ]
)
"""Configuration for the record-to-record acceptance criterion.

Fields: ``threshold`` (accept candidates whose objective is within this
absolute distance of the best-known objective, default 0.05).
"""

# Acceptance criterion variant
AcceptanceCriterionType = VariantType(
    [
        ("simulated_annealing", SimulatedAnnealingConfigType),
        ("hill_climbing", NullType),
        ("record_to_record", RecordToRecordConfigType),
    ]
)
"""Candidate-acceptance policy used inside the ALNS loop.

Cases: ``simulated_annealing`` ``{start_temperature (100.0),
end_temperature (0.01), step (0.99)}`` (default — probabilistic acceptance
with geometric cooling), ``hill_climbing`` (accept only strict
improvements), ``record_to_record`` ``{threshold (0.05)}`` (accept when
within threshold of the best).
"""

# Roulette wheel config
RouletteWheelConfigType = StructType(
    [
        ("scores", OptionType(ArrayType(IntegerType))),
        ("decay", OptionType(FloatType)),
    ]
)
"""Configuration for roulette-wheel operator-selection weight updates.

Fields: ``scores`` (reward points for each outcome — new global best,
better than current, accepted, rejected — default [33, 9, 3, 0]),
``decay`` (exponential decay factor applied to existing weights each
iteration, default 0.8).
"""

# Operator selection variant
OperatorSelectionType = VariantType(
    [
        ("roulette_wheel", RouletteWheelConfigType),
    ]
)
"""Strategy for selecting destroy/repair operators each iteration.

Cases: ``roulette_wheel`` ``{scores ([33,9,3,0]), decay (0.8)}`` (the only
currently supported strategy; weights are updated proportionally to
outcome scores).
"""

# Stop criterion variant
StopCriterionType = VariantType(
    [
        ("max_iterations", IntegerType),
        ("max_runtime", FloatType),
        ("no_improvement", IntegerType),
    ]
)
"""Termination criterion for the ALNS loop.

Cases: ``max_iterations`` (``Integer`` — stop after N iterations, default
1000), ``max_runtime`` (``Float`` — stop after N wall-clock seconds),
``no_improvement`` (``Integer`` — stop after N consecutive iterations with
no improvement to the global best).
"""

# ALNS configuration
ALNSConfigType = StructType(
    [
        ("stop", OptionType(StopCriterionType)),
        ("acceptance", OptionType(AcceptanceCriterionType)),
        ("operator_selection", OptionType(OperatorSelectionType)),
        ("seed", OptionType(IntegerType)),
    ]
)
"""Top-level configuration for an ALNS run.

Fields: ``stop`` (termination criterion, default ``max_iterations`` 1000),
``acceptance`` (candidate-acceptance policy, default ``simulated_annealing``
with defaults), ``operator_selection`` (default ``roulette_wheel`` with
defaults), ``seed`` (NumPy RNG seed for operator selection and acceptance
randomness, default 42).
"""


def ALNSResultType(solution_type: Any) -> StructType:
    """Create ALNS result type for a given solution type.

    Fields: ``best_solution`` (``S`` best solution found),
    ``best_objective`` (``Float`` objective at that solution),
    ``iterations`` (``Integer`` total iterations completed),
    ``runtime`` (``Float`` wall-clock seconds),
    ``success`` (``Boolean`` true when ALNS completed normally; false on
    exception, in which case the initial solution is returned with
    ``best_objective = inf``).
    """
    return StructType(
        [
            ("best_solution", solution_type),
            ("best_objective", FloatType),
            ("iterations", IntegerType),
            ("runtime", FloatType),
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


def _get_enum_tag(variant: EastVariant) -> str:
    """Get the tag name of a variant."""
    return variant.type



# Lazy import guard for optional dependency
_HAS_ALNS_SUPPORT = importlib.util.find_spec("alns") is not None


def _check_alns_support() -> None:
    """Check if alns support is available."""
    if not _HAS_ALNS_SUPPORT:
        raise NotImplementedError(
            "Alns support requires the 'alns' extra. "
            "Add east-py-datascience[alns] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


@generic_platform_function(
    name="alns_optimize",
    type_parameters=["S"],
    is_async=False,
    inputs=[
        "S",
        FunctionType(["S"], FloatType),
        ArrayType(FunctionType(["S"], "S")),
        ArrayType(FunctionType(["S"], "S")),
        ALNSConfigType,
    ],
    output=ALNSResultType("S"),
    type_erased=True,
)
def alns_optimize(
    initial_solution: Any,
    objective_fn: Callable[[Any], float],
    destroy_operators: EastArray,
    repair_operators: EastArray,
    config: EastStruct,
) -> EastStruct:
    """Run Adaptive Large Neighborhood Search optimization.

    Generic over the solution type ``S`` - the caller supplies East callables
    for objective evaluation, destruction, and repair; this function drives the
    ALNS meta-heuristic via the ``alns`` library. Operator selection weights
    are updated by roulette-wheel scoring; the acceptance criterion controls
    which candidate solutions are retained.

    Type contract for ``S``:
        - ``initial_solution``, ``destroy_operators[i](s)``, and
          ``repair_operators[i](s)`` all produce values of the same East type
          ``S``.
        - ``objective_fn(s)`` returns a ``Float`` (lower = better).
        - Type safety is enforced at the TypeScript/IR level; ``alns_optimize``
          receives plain East values at runtime.

    Args:
        initial_solution: ``S`` - starting solution; any East value type (struct,
            variant, vector, etc.) that your operators can consume and produce.
        objective_fn: ``Function<[S], Float>`` (callable) - evaluates the
            objective for a given solution; called once per accepted state.
            Lower objective values are considered better.
        destroy_operators: ``Array<Function<[S], S>>`` (``EastArray``) - each
            callable partially destroys the current solution.  Must contain at
            least one operator.
        repair_operators: ``Array<Function<[S], S>>`` (``EastArray``) - each
            callable repairs a destroyed solution back into feasibility.  Must
            contain at least one operator.
        config: ``ALNSConfigType`` (``EastStruct``) with fields:

            - ``stop`` (``Option<StopCriterionType>``): termination rule, one of:

                - ``max_iterations`` (``Integer``): stop after N iterations
                  (default 1000).
                - ``max_runtime`` (``Float``): stop after N seconds.
                - ``no_improvement`` (``Integer``): stop after N iterations
                  with no improvement.

            - ``acceptance`` (``Option<AcceptanceCriterionType>``): candidate
              acceptance policy, one of:

                - ``simulated_annealing`` ``{start_temperature (100.0),
                  end_temperature (0.01), step (0.99)}``: probabilistic
                  acceptance (default).
                - ``hill_climbing`` - only accept strict improvements.
                - ``record_to_record`` ``{threshold (0.05)}``: accept when
                  objective is within ``threshold`` of the record.

            - ``operator_selection`` (``Option<OperatorSelectionType>``):
              currently only ``roulette_wheel`` ``{scores ([33,9,3,0]),
              decay (0.8)}``.  Scores correspond to (new global best,
              better than current, accepted, rejected).
            - ``seed`` (``Option<Integer>``): NumPy RNG seed for operator
              selection and acceptance randomness (default 42).

    Returns:
        ``ALNSResultType(S)`` (``EastStruct``): ``best_solution`` (``S``),
        ``best_objective`` (``Float``), ``iterations`` (``Integer`` total
        iterations completed), ``runtime`` (``Float`` wall-clock seconds),
        ``success`` (``Boolean`` true when the alns library completed
        normally; false on exception, in which case ``initial_solution``
        is returned with ``best_objective = inf``).

    Raises:
        NotImplementedError: the ``alns`` extra is not installed.
    """
    _check_alns_support()
    import alns
    import numpy as np
    from alns.accept import (
        HillClimbing,
        RecordToRecordTravel,
        SimulatedAnnealing,
    )
    from alns.select import RouletteWheel
    from alns.stop import MaxIterations, MaxRuntime, NoImprovement

    # Create random state
    seed = int(_get_option(config.get("seed"), 42))
    rng = np.random.default_rng(seed)

    # Wrap solution in State class (required by alns library)
    class SolutionState:
        def __init__(self, solution: Any):
            self.solution = solution
            self._objective: float | None = None

        def objective(self) -> float:
            if self._objective is None:
                self._objective = objective_fn(self.solution)
            return self._objective

    # Wrap destroy operators (S -> S)
    # Note: alns library passes rng to operators, but East operators manage
    # their own randomness via platform functions. The seed in config ensures
    # reproducibility at the ALNS level (operator selection, acceptance).
    def make_destroy(destroy_fn: Callable[[Any], Any]) -> Callable:
        def destroy(state: SolutionState, rng: Any) -> SolutionState:
            destroyed = destroy_fn(state.solution)
            return SolutionState(destroyed)

        return destroy

    # Wrap repair operators (S -> S)
    def make_repair(repair_fn: Callable[[Any], Any]) -> Callable:
        def repair(state: SolutionState, rng: Any) -> SolutionState:
            repaired = repair_fn(state.solution)
            return SolutionState(repaired)

        return repair

    # Build ALNS instance
    alns_instance = alns.ALNS(rng)

    for i, destroy_fn in enumerate(destroy_operators):
        alns_instance.add_destroy_operator(
            make_destroy(destroy_fn), name=f"destroy_{i}"
        )

    for i, repair_fn in enumerate(repair_operators):
        alns_instance.add_repair_operator(make_repair(repair_fn), name=f"repair_{i}")

    # Configure acceptance criterion
    accept_config = _get_option(config.get("acceptance"), None)
    if accept_config is None or _get_enum_tag(accept_config) == "simulated_annealing":
        sa_config = accept_config.value if accept_config else {}
        start_temp = float(
            _get_option(
                sa_config.get("start_temperature") if sa_config else None, 100.0
            )
        )
        end_temp = float(
            _get_option(sa_config.get("end_temperature") if sa_config else None, 0.01)
        )
        step = float(_get_option(sa_config.get("step") if sa_config else None, 0.99))
        accept = SimulatedAnnealing(start_temp, end_temp, step)
    elif _get_enum_tag(accept_config) == "hill_climbing":
        accept = HillClimbing()
    elif _get_enum_tag(accept_config) == "record_to_record":
        rtr_config = accept_config.value
        threshold = float(_get_option(rtr_config.get("threshold"), 0.05))
        accept = RecordToRecordTravel(threshold)
    else:
        # Default to simulated annealing
        accept = SimulatedAnnealing(100.0, 0.01, 0.99)

    # Configure operator selection
    select_config = _get_option(config.get("operator_selection"), None)
    rw_config = select_config.value if select_config else {}
    scores_raw = _get_option(
        rw_config.get("scores") if rw_config else None, [33, 9, 3, 0]
    )
    scores = [int(s) for s in scores_raw] if isinstance(scores_raw, EastArray) else list(scores_raw)
    decay = float(_get_option(rw_config.get("decay") if rw_config else None, 0.8))
    num_destroy = len(destroy_operators)
    num_repair = len(repair_operators)
    select = RouletteWheel(scores, decay, num_destroy, num_repair)

    # Configure stopping criterion
    stop_config = _get_option(config.get("stop"), None)
    if stop_config is None or _get_enum_tag(stop_config) == "max_iterations":
        max_iter = int(stop_config.value) if stop_config else 1000
        stop = MaxIterations(max_iter)
    elif _get_enum_tag(stop_config) == "max_runtime":
        max_time = float(stop_config.value)
        stop = MaxRuntime(max_time)
    elif _get_enum_tag(stop_config) == "no_improvement":
        max_iter = int(stop_config.value)
        stop = NoImprovement(max_iter)
    else:
        # Default to max iterations
        stop = MaxIterations(1000)

    # Run optimization with error handling
    initial_state = SolutionState(initial_solution)
    try:
        result = alns_instance.iterate(initial_state, select, accept, stop)
        best_state = result.best_state
        statistics = result.statistics

        return EastStruct(
            {
                "best_solution": best_state.solution,
                "best_objective": float(best_state.objective()),
                "iterations": int(len(statistics.objectives)),
                "runtime": float(statistics.total_runtime),
                "success": True,
            }
        )
    except Exception:
        # Return failure result with initial solution
        return EastStruct(
            {
                "best_solution": initial_solution,
                "best_objective": float("inf"),
                "iterations": 0,
                "runtime": 0.0,
                "success": False,
            }
        )


# Collected from the @generic_platform_function decoration above.
alns_impl = platform_functions(__name__)


__all__ = [
    # Platform implementation
    "alns_impl",
    # Types
    "SimulatedAnnealingConfigType",
    "RecordToRecordConfigType",
    "AcceptanceCriterionType",
    "RouletteWheelConfigType",
    "OperatorSelectionType",
    "StopCriterionType",
    "ALNSConfigType",
    "ALNSResultType",
]
