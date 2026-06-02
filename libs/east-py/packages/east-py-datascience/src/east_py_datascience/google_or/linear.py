#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Linear programming / MIP solver platform functions for East.

Provides linear and mixed-integer programming using Google OR-Tools' linear
solver (wrapping Glop, SCIP, HiGHS) for East programs running in Python.

LP/MIP is designed for continuous and mixed optimization problems where:
- Variables are continuous (float) or integer
- Constraints are linear inequalities/equalities
- Objective is a linear function to minimize or maximize
- Problems include resource allocation, blending, transportation, planning
"""

import importlib.util
import time
from typing import Any

from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)
from east.types.values import EastDict, EastStruct, EastVariant

from east_py_datascience.google_or.types import GoogleOrStatusType, _get_option

# ============================================================================
# Type Definitions
# ============================================================================

LinearVarType = StructType(
    [
        ("name", StringType),
        ("lower_bound", FloatType),
        ("upper_bound", FloatType),
        ("is_integer", BooleanType),
    ]
)

LinearTermType = StructType(
    [
        ("var", StringType),
        ("coeff", FloatType),
    ]
)

LinearConstraintDefType = StructType(
    [
        ("terms", ArrayType(LinearTermType)),
        ("lower_bound", FloatType),
        ("upper_bound", FloatType),
    ]
)

LinearObjectiveType = StructType(
    [
        ("terms", ArrayType(LinearTermType)),
        ("maximize", BooleanType),
    ]
)

LinearModelType = StructType(
    [
        ("variables", ArrayType(LinearVarType)),
        ("constraints", ArrayType(LinearConstraintDefType)),
        ("objective", LinearObjectiveType),
    ]
)

LinearSolverType = VariantType(
    [
        ("glop", NullType),
        ("scip", NullType),
        ("highs", NullType),
    ]
)

LinearConfigType = StructType(
    [
        ("solver", OptionType(LinearSolverType)),
        ("max_time_seconds", OptionType(FloatType)),
    ]
)

LinearResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("objective_value", OptionType(FloatType)),
        ("assignments", DictType(StringType, FloatType)),
        ("wall_time", FloatType),
    ]
)



# Lazy import guard for optional dependency
_HAS_GOOGLE_OR_SUPPORT = importlib.util.find_spec("ortools") is not None


def _check_google_or_support() -> None:
    """Check if google_or support is available."""
    if not _HAS_GOOGLE_OR_SUPPORT:
        raise NotImplementedError(
            "Google_Or support requires the 'google-or' extra. "
            "Add east-py-datascience[google-or] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


def _detect_solver_id(
    solver_opt: EastVariant | None, has_integers: bool
) -> str:
    """Determine which solver backend to use."""
    if solver_opt is not None:
        solver_map = {
            "glop": "GLOP_LINEAR_PROGRAMMING",
            "scip": "SCIP_MIXED_INTEGER_PROGRAMMING",
            "highs": "HIGHS_MIXED_INTEGER_PROGRAMMING",
        }
        return solver_map.get(
            solver_opt.type,
            "SCIP_MIXED_INTEGER_PROGRAMMING"
            if has_integers
            else "GLOP_LINEAR_PROGRAMMING",
        )
    # Auto-detect: use MIP solver if any integer variables
    if has_integers:
        return "SCIP_MIXED_INTEGER_PROGRAMMING"
    return "GLOP_LINEAR_PROGRAMMING"


@platform_function(
    name="google_or_linear_solve",
    inputs=[LinearModelType, LinearConfigType],
    output=LinearResultType,
)
def linear_solve_impl(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a linear programming / MIP problem.

    Args:
        model_data: Linear model (variables, constraints, objective)
        config: Solver configuration (solver backend, time limit)

    Returns:
        EastStruct with status, objective_value, assignments, wall_time
    """
    _check_google_or_support()
    from ortools.linear_solver import pywraplp

    start_time = time.perf_counter()

    # Detect if any integer variables
    variables_data = model_data.get("variables")
    has_integers = any(bool(v.get("is_integer")) for v in variables_data)

    # Select solver
    solver_opt = _get_option(config.get("solver"), None)
    solver_id = _detect_solver_id(solver_opt, has_integers)
    solver = pywraplp.Solver.CreateSolver(solver_id)

    if solver is None:
        wall_time = time.perf_counter() - start_time
        return EastStruct(
            {
                "status": EastVariant("model_invalid", None),
                "objective_value": EastVariant("none", None),
                "assignments": EastDict(StringType, FloatType),
                "wall_time": wall_time,
            }
        )

    # Create variables
    vars_by_name: dict[str, Any] = {}
    for v in variables_data:
        name = v.get("name")
        lb = float(v.get("lower_bound"))
        ub = float(v.get("upper_bound"))
        is_int = bool(v.get("is_integer"))
        if is_int:
            vars_by_name[name] = solver.IntVar(lb, ub, name)
        else:
            vars_by_name[name] = solver.NumVar(lb, ub, name)

    # Add constraints
    for c in model_data.get("constraints"):
        terms = c.get("terms")
        lb = float(c.get("lower_bound"))
        ub = float(c.get("upper_bound"))
        ct = solver.Constraint(lb, ub)
        for term in terms:
            var_name = term.get("var")
            coeff = float(term.get("coeff"))
            ct.SetCoefficient(vars_by_name[var_name], coeff)

    # Set objective
    objective_data = model_data.get("objective")
    objective = solver.Objective()
    for term in objective_data.get("terms"):
        var_name = term.get("var")
        coeff = float(term.get("coeff"))
        objective.SetCoefficient(vars_by_name[var_name], coeff)

    if bool(objective_data.get("maximize")):
        objective.SetMaximization()
    else:
        objective.SetMinimization()

    # Time limit
    max_time = _get_option(config.get("max_time_seconds"), None)
    if max_time is not None:
        solver.SetTimeLimit(int(float(max_time) * 1000))

    # Solve
    result_status = solver.Solve()
    wall_time = time.perf_counter() - start_time

    # Map status
    status_map = {
        pywraplp.Solver.OPTIMAL: "optimal",
        pywraplp.Solver.FEASIBLE: "feasible",
        pywraplp.Solver.INFEASIBLE: "infeasible",
        pywraplp.Solver.UNBOUNDED: "not_solved",
        pywraplp.Solver.ABNORMAL: "not_solved",
        pywraplp.Solver.NOT_SOLVED: "not_solved",
    }
    status_tag = status_map.get(result_status, "not_solved")
    status = EastVariant(status_tag, None)

    if result_status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        assignments = EastDict(StringType, FloatType)
        for name, var in vars_by_name.items():
            assignments[name] = float(var.solution_value())
        obj_value: EastVariant = EastVariant(
            "some", float(objective.Value())
        )
    else:
        assignments = EastDict(StringType, FloatType)
        obj_value = EastVariant("none", None)

    return EastStruct(
        {
            "status": status,
            "objective_value": obj_value,
            "assignments": assignments,
            "wall_time": wall_time,
        }
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

linear_impl = platform_functions(__name__)


__all__ = [
    # Platform implementation
    "linear_impl",
    # Types
    "LinearVarType",
    "LinearTermType",
    "LinearConstraintDefType",
    "LinearObjectiveType",
    "LinearModelType",
    "LinearSolverType",
    "LinearConfigType",
    "LinearResultType",
]
