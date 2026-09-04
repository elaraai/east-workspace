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

from collections.abc import Callable
from typing import Any

from east.runtime.platform import generic_platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BooleanType,
    EastType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StructType,
    VariantType,
)
from east.types.values import EastArray, EastStruct

from east_py_datascience._common import extra_guard

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


def ALNSResultType(solution_type: EastType) -> EastType:
    """Create ALNS result type for a given solution type.

    Fields: ``best_solution`` (``S`` best solution found),
    ``best_objective`` (``Float`` objective at that solution),
    ``iterations`` (``Integer`` total iterations completed),
    ``runtime`` (``Float`` wall-clock seconds),
    ``success`` (``Boolean`` - always true; kept for the result contract. A
    failure inside an operator or the objective raises instead of being
    reported here).
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


_check_alns_support = extra_guard("alns", "alns", "ALNS")


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
        ``success`` (``Boolean`` - always true; kept for the result contract).

    Raises:
        NotImplementedError: the ``alns`` extra is not installed.
        Exception: whatever an operator or the objective raised - a failure
            in user code propagates rather than being reported as
            ``success = false``.
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
    seed = int(config["seed"].unwrap_or(42))
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

    # Acceptance criterion (default: simulated annealing with its defaults)
    acceptance = config["acceptance"].unwrap_or(None)
    if acceptance is None or acceptance.type == "simulated_annealing":
        sa = None if acceptance is None else acceptance.value
        start_temp = 100.0 if sa is None else float(sa["start_temperature"].unwrap_or(100.0))
        end_temp = 0.01 if sa is None else float(sa["end_temperature"].unwrap_or(0.01))
        step = 0.99 if sa is None else float(sa["step"].unwrap_or(0.99))
        accept = SimulatedAnnealing(start_temp, end_temp, step)
    elif acceptance.type == "hill_climbing":
        accept = HillClimbing()
    elif acceptance.type == "record_to_record":
        accept = RecordToRecordTravel(float(acceptance.value["threshold"].unwrap_or(0.05)))
    else:
        raise ValueError(f"alns_optimize: unknown acceptance criterion {acceptance.type!r}")

    # Operator selection (roulette wheel is the only strategy)
    selection = config["operator_selection"].unwrap_or(None)
    roulette = None if selection is None else selection.value
    scores = [33, 9, 3, 0]
    decay = 0.8
    if roulette is not None:
        scores = [int(s) for s in roulette["scores"].unwrap_or(scores)]
        decay = float(roulette["decay"].unwrap_or(decay))
    select = RouletteWheel(scores, decay, len(destroy_operators), len(repair_operators))

    # Stopping criterion (default: 1000 iterations)
    stop_config = config["stop"].unwrap_or(None)
    if stop_config is None or stop_config.type == "max_iterations":
        stop = MaxIterations(1000 if stop_config is None else int(stop_config.value))
    elif stop_config.type == "max_runtime":
        stop = MaxRuntime(float(stop_config.value))
    elif stop_config.type == "no_improvement":
        stop = NoImprovement(int(stop_config.value))
    else:
        raise ValueError(f"alns_optimize: unknown stop criterion {stop_config.type!r}")

    result = alns_instance.iterate(SolutionState(initial_solution), select, accept, stop)
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
