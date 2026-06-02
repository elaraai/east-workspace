#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""CP-SAT solver platform functions for East.

Provides constraint programming with SAT-based solving using Google OR-Tools'
CP-SAT solver for East programs running in Python.

CP-SAT is designed for discrete optimization problems where:
- Decision variables are integer or boolean
- Constraints include linear, logical, cardinality, scheduling
- Problems include rostering, sequencing, scheduling, bin packing
- Optimality proofs are desired (exact solver)
"""

import contextlib
import importlib.util
import time
from typing import Any

from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)
from east.types.values import EastArray, EastDict, EastStruct, EastVariant

from east_py_datascience.google_or.types import GoogleOrStatusType, _get_option

# ============================================================================
# Type Definitions
# ============================================================================

# --- Variable definitions ---

CpSatIntVarType = StructType(
    [
        ("name", StringType),
        ("lower_bound", IntegerType),
        ("upper_bound", IntegerType),
    ]
)

CpSatBoolVarType = StructType(
    [
        ("name", StringType),
    ]
)

CpSatIntervalVarType = StructType(
    [
        ("name", StringType),
        ("start", StringType),
        ("size", StringType),
        ("end", StringType),
        ("is_present", OptionType(StringType)),
    ]
)

# --- Expressions and literals ---

CpSatLinearTermType = StructType(
    [
        ("var", StringType),
        ("coeff", IntegerType),
    ]
)

CpSatLinearExprType = StructType(
    [
        ("terms", ArrayType(CpSatLinearTermType)),
        ("constant", IntegerType),
    ]
)

CpSatLiteralType = StructType(
    [
        ("var", StringType),
        ("negated", BooleanType),
    ]
)

# --- Constraints ---

CpSatComparisonType = VariantType(
    [
        ("equal", NullType),
        ("not_equal", NullType),
        ("less_equal", NullType),
        ("greater_equal", NullType),
    ]
)

CpSatConstraintType = VariantType(
    [
        # Linear: expr op rhs
        (
            "linear",
            StructType(
                [
                    ("expr", CpSatLinearExprType),
                    ("op", CpSatComparisonType),
                    ("rhs", IntegerType),
                ]
            ),
        ),
        # Logical
        (
            "bool_or",
            StructType(
                [
                    ("literals", ArrayType(CpSatLiteralType)),
                ]
            ),
        ),
        (
            "bool_and",
            StructType(
                [
                    ("literals", ArrayType(CpSatLiteralType)),
                ]
            ),
        ),
        (
            "implication",
            StructType(
                [
                    ("if_literal", CpSatLiteralType),
                    ("then_literal", CpSatLiteralType),
                ]
            ),
        ),
        # Cardinality
        (
            "exactly_k",
            StructType(
                [
                    ("vars", ArrayType(StringType)),
                    ("k", IntegerType),
                ]
            ),
        ),
        (
            "at_most_k",
            StructType(
                [
                    ("vars", ArrayType(StringType)),
                    ("k", IntegerType),
                ]
            ),
        ),
        (
            "at_least_k",
            StructType(
                [
                    ("vars", ArrayType(StringType)),
                    ("k", IntegerType),
                ]
            ),
        ),
        # Combinatorial
        (
            "all_different",
            StructType(
                [
                    ("vars", ArrayType(StringType)),
                ]
            ),
        ),
        (
            "element",
            StructType(
                [
                    ("index_var", StringType),
                    ("values", ArrayType(IntegerType)),
                    ("target_var", StringType),
                ]
            ),
        ),
        # Scheduling
        (
            "no_overlap",
            StructType(
                [
                    ("intervals", ArrayType(StringType)),
                ]
            ),
        ),
        (
            "cumulative",
            StructType(
                [
                    ("intervals", ArrayType(StringType)),
                    ("demands", ArrayType(IntegerType)),
                    ("capacity", IntegerType),
                ]
            ),
        ),
        # Sequencing
        (
            "circuit",
            StructType(
                [
                    (
                        "arcs",
                        ArrayType(
                            StructType(
                                [
                                    ("tail", IntegerType),
                                    ("head", IntegerType),
                                    ("literal", StringType),
                                ]
                            )
                        ),
                    ),
                ]
            ),
        ),
    ]
)

# --- Objective ---

CpSatObjectiveType = VariantType(
    [
        ("minimize", CpSatLinearExprType),
        ("maximize", CpSatLinearExprType),
    ]
)

# --- Model ---

CpSatModelType = StructType(
    [
        ("int_vars", ArrayType(CpSatIntVarType)),
        ("bool_vars", ArrayType(CpSatBoolVarType)),
        ("interval_vars", ArrayType(CpSatIntervalVarType)),
        ("constraints", ArrayType(CpSatConstraintType)),
        ("objective", OptionType(CpSatObjectiveType)),
    ]
)

# --- Config ---

CpSatConfigType = StructType(
    [
        ("max_time_seconds", OptionType(FloatType)),
        ("num_workers", OptionType(IntegerType)),
        ("log_search_progress", OptionType(BooleanType)),
        ("seed", OptionType(IntegerType)),
        ("max_solutions", OptionType(IntegerType)),
        # Stop with status OPTIMAL once (best - lower_bound) / |best| <= this.
        # e.g. 0.005 -> stop at 0.5% proven gap.
        ("relative_gap_limit", OptionType(FloatType)),
        # Stop with status OPTIMAL once (best - lower_bound) <= this (in objective units).
        ("absolute_gap_limit", OptionType(FloatType)),
    ]
)

# --- Result ---

CpSatResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("objective_value", OptionType(FloatType)),
        ("assignments", DictType(StringType, IntegerType)),
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


def _resolve_literal(vars_by_name: dict[str, Any], literal: EastStruct) -> Any:
    """Resolve a CpSatLiteral to a CP-SAT literal (possibly negated)."""
    var = vars_by_name[literal.get("var")]
    if literal.get("negated"):
        return var.Not()
    return var


def _build_linear_expr(vars_by_name: dict[str, Any], expr: EastStruct) -> Any:
    """Build a CP-SAT linear expression from a CpSatLinearExpr struct."""
    from ortools.sat.python import cp_model

    result = cp_model.LinearExpr.Sum([])
    terms = expr.get("terms")
    for term in terms:
        var_name = term.get("var")
        coeff = int(term.get("coeff"))
        result += coeff * vars_by_name[var_name]
    constant = int(expr.get("constant"))
    if constant != 0:
        result += constant
    return result


def _add_constraint(
    model: Any, vars_by_name: dict[str, Any], constraint: EastVariant
) -> None:
    """Add a single constraint to the CP-SAT model."""
    tag = constraint.type
    data = constraint.value

    if tag == "linear":
        expr = _build_linear_expr(vars_by_name, data.get("expr"))
        op = data.get("op")
        rhs = int(data.get("rhs"))
        op_tag = op.type
        if op_tag == "equal":
            model.Add(expr == rhs)
        elif op_tag == "not_equal":
            model.Add(expr != rhs)
        elif op_tag == "less_equal":
            model.Add(expr <= rhs)
        elif op_tag == "greater_equal":
            model.Add(expr >= rhs)

    elif tag == "bool_or":
        literals = [
            _resolve_literal(vars_by_name, lit) for lit in data.get("literals")
        ]
        model.AddBoolOr(literals)

    elif tag == "bool_and":
        literals = [
            _resolve_literal(vars_by_name, lit) for lit in data.get("literals")
        ]
        model.AddBoolAnd(literals)

    elif tag == "implication":
        if_lit = _resolve_literal(vars_by_name, data.get("if_literal"))
        then_lit = _resolve_literal(vars_by_name, data.get("then_literal"))
        model.AddImplication(if_lit, then_lit)

    elif tag == "exactly_k":
        var_names = list(data.get("vars"))
        k = int(data.get("k"))
        bool_vars = [vars_by_name[name] for name in var_names]
        model.Add(sum(bool_vars) == k)

    elif tag == "at_most_k":
        var_names = list(data.get("vars"))
        k = int(data.get("k"))
        bool_vars = [vars_by_name[name] for name in var_names]
        model.Add(sum(bool_vars) <= k)

    elif tag == "at_least_k":
        var_names = list(data.get("vars"))
        k = int(data.get("k"))
        bool_vars = [vars_by_name[name] for name in var_names]
        model.Add(sum(bool_vars) >= k)

    elif tag == "all_different":
        var_names = list(data.get("vars"))
        int_vars = [vars_by_name[name] for name in var_names]
        model.AddAllDifferent(int_vars)

    elif tag == "element":
        index_var = vars_by_name[data.get("index_var")]
        values = [int(v) for v in data.get("values")]
        target_var = vars_by_name[data.get("target_var")]
        model.AddElement(index_var, values, target_var)

    elif tag == "no_overlap":
        interval_names = list(data.get("intervals"))
        intervals = [vars_by_name[name] for name in interval_names]
        model.AddNoOverlap(intervals)

    elif tag == "cumulative":
        interval_names = list(data.get("intervals"))
        intervals = [vars_by_name[name] for name in interval_names]
        demands = [int(d) for d in data.get("demands")]
        capacity = int(data.get("capacity"))
        model.AddCumulative(intervals, demands, capacity)

    elif tag == "circuit":
        arcs_data = data.get("arcs")
        arcs = []
        for arc in arcs_data:
            tail = int(arc.get("tail"))
            head = int(arc.get("head"))
            literal = vars_by_name[arc.get("literal")]
            arcs.append((tail, head, literal))
        model.AddCircuit(arcs)


def _map_status(status_code: int) -> EastVariant:
    """Map OR-Tools status code to GoogleOrStatus variant."""
    from ortools.sat.python import cp_model

    status_map = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "model_invalid",
        cp_model.UNKNOWN: "not_solved",
    }
    tag = status_map.get(status_code, "not_solved")
    return EastVariant(tag, None)


def _build_model_and_solve(
    model_data: EastStruct,
    config: EastStruct,
    solution_callback: Any = None,
) -> tuple[Any, Any, float]:
    """Build a CP-SAT model from declarative data and solve it.

    Returns (solver, status_code, wall_time).
    """
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    vars_by_name: dict[str, Any] = {}

    # Create integer variables
    for v in model_data.get("int_vars"):
        name = v.get("name")
        lb = int(v.get("lower_bound"))
        ub = int(v.get("upper_bound"))
        vars_by_name[name] = model.new_int_var(lb, ub, name)

    # Create boolean variables
    for v in model_data.get("bool_vars"):
        name = v.get("name")
        vars_by_name[name] = model.new_bool_var(name)

    # Create interval variables
    for v in model_data.get("interval_vars"):
        name = v.get("name")
        start = vars_by_name[v.get("start")]
        size = vars_by_name[v.get("size")]
        end = vars_by_name[v.get("end")]
        is_present = _get_option(v.get("is_present"), None)
        if is_present is not None:
            present_var = vars_by_name[is_present]
            vars_by_name[name] = model.new_optional_interval_var(
                start, size, end, present_var, name
            )
        else:
            vars_by_name[name] = model.new_interval_var(start, size, end, name)

    # Add constraints
    for c in model_data.get("constraints"):
        _add_constraint(model, vars_by_name, c)

    # Set objective
    objective_opt = _get_option(model_data.get("objective"), None)
    if objective_opt is not None:
        obj_tag = objective_opt.type
        obj_expr = _build_linear_expr(vars_by_name, objective_opt.value)
        if obj_tag == "minimize":
            model.Minimize(obj_expr)
        else:
            model.Maximize(obj_expr)

    # Configure solver
    solver = cp_model.CpSolver()
    max_time = _get_option(config.get("max_time_seconds"), None)
    if max_time is not None:
        solver.parameters.max_time_in_seconds = float(max_time)

    num_workers = _get_option(config.get("num_workers"), None)
    if num_workers is not None:
        solver.parameters.num_workers = int(num_workers)

    log_progress = _get_option(config.get("log_search_progress"), None)
    if log_progress is not None:
        solver.parameters.log_search_progress = bool(log_progress)

    seed = _get_option(config.get("seed"), None)
    if seed is not None:
        solver.parameters.random_seed = int(seed)

    rel_gap = _get_option(config.get("relative_gap_limit"), None)
    if rel_gap is not None:
        solver.parameters.relative_gap_limit = float(rel_gap)

    abs_gap = _get_option(config.get("absolute_gap_limit"), None)
    if abs_gap is not None:
        solver.parameters.absolute_gap_limit = float(abs_gap)

    # Solve
    start_time = time.perf_counter()
    if solution_callback is not None:
        solver.parameters.enumerate_all_solutions = True
        solution_callback.set_vars(vars_by_name)
        status_code = solver.solve(model, solution_callback)
    else:
        status_code = solver.solve(model)
    wall_time = time.perf_counter() - start_time

    return solver, vars_by_name, status_code, wall_time


def _extract_assignments(
    solver: Any, vars_by_name: dict[str, Any]
) -> EastDict:
    """Extract variable assignments from a solved model."""
    assignments = EastDict(StringType, IntegerType)
    for name, var in vars_by_name.items():
        # Skip interval variables (they don't have direct values)
        with contextlib.suppress(AttributeError, TypeError):
            assignments[name] = int(solver.value(var))
    return assignments


@platform_function(
    name="google_or_cpsat_solve",
    inputs=[CpSatModelType, CpSatConfigType],
    output=CpSatResultType,
)
def cpsat_solve_impl(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a CP-SAT model and return the best solution.

    Args:
        model_data: Declarative model (variables, constraints, objective)
        config: Solver configuration

    Returns:
        EastStruct with status, objective_value, assignments, wall_time
    """
    _check_google_or_support()
    from ortools.sat.python import cp_model

    solver, vars_by_name, status_code, wall_time = _build_model_and_solve(
        model_data, config
    )

    # Extract results
    status = _map_status(status_code)

    if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assignments = _extract_assignments(solver, vars_by_name)
        obj_value: EastVariant = EastVariant(
            "some", float(solver.objective_value)
        )
    else:
        assignments = EastDict(StringType, IntegerType)
        obj_value = EastVariant("none", None)

    return EastStruct(
        {
            "status": status,
            "objective_value": obj_value,
            "assignments": assignments,
            "wall_time": wall_time,
        }
    )


@platform_function(
    name="google_or_cpsat_solve_all",
    inputs=[CpSatModelType, CpSatConfigType],
    output=ArrayType(CpSatResultType),
)
def cpsat_solve_all_impl(
    model_data: EastStruct,
    config: EastStruct,
) -> EastArray:
    """Solve a CP-SAT model and return all feasible solutions found.

    Uses a solution callback to collect multiple solutions up to max_solutions.

    Args:
        model_data: Declarative model (variables, constraints, objective)
        config: Solver configuration (max_solutions controls limit)

    Returns:
        Array of CpSatResult structs, one per solution found
    """
    _check_google_or_support()
    from ortools.sat.python import cp_model

    max_solutions = int(_get_option(config.get("max_solutions"), 100))

    # Collect solutions via callback
    solutions: list[EastStruct] = []

    class SolutionCollector(cp_model.CpSolverSolutionCallback):
        def __init__(self) -> None:
            super().__init__()
            self._count = 0
            self._vars_by_name: dict[str, Any] = {}

        def set_vars(self, vars_by_name: dict[str, Any]) -> None:
            self._vars_by_name = vars_by_name

        def on_solution_callback(self) -> None:
            if self._count >= max_solutions:
                self.StopSearch()
                return

            assignments = EastDict(StringType, IntegerType)
            for name, var in self._vars_by_name.items():
                with contextlib.suppress(AttributeError, TypeError):
                    assignments[name] = int(self.Value(var))

            obj_value: EastVariant = EastVariant(
                "some", float(self.ObjectiveValue())
            )

            solutions.append(
                EastStruct(
                    {
                        "status": EastVariant("feasible", None),
                        "objective_value": obj_value,
                        "assignments": assignments,
                        "wall_time": 0.0,
                    }
                )
            )
            self._count += 1

    callback = SolutionCollector()

    solver, vars_by_name, status_code, wall_time = _build_model_and_solve(
        model_data, config, solution_callback=callback
    )
    # Re-solve with callback if we haven't collected solutions yet
    if not solutions and status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Fallback: return the single solution from the solver
        assignments = _extract_assignments(solver, vars_by_name)
        obj_value_single: EastVariant = EastVariant(
            "some", float(solver.objective_value)
        )
        solutions.append(
            EastStruct(
                {
                    "status": _map_status(status_code),
                    "objective_value": obj_value_single,
                    "assignments": assignments,
                    "wall_time": wall_time,
                }
            )
        )

    # Update wall_time on the last solution
    if solutions:
        last = solutions[-1]
        solutions[-1] = EastStruct(
            {
                "status": last.get("status"),
                "objective_value": last.get("objective_value"),
                "assignments": last.get("assignments"),
                "wall_time": wall_time,
            }
        )

    return EastArray(CpSatResultType, solutions)


# ============================================================================
# Platform Function Registration
# ============================================================================

cpsat_impl = platform_functions(__name__)


__all__ = [
    # Platform implementation
    "cpsat_impl",
    # Types
    "CpSatIntVarType",
    "CpSatBoolVarType",
    "CpSatIntervalVarType",
    "CpSatLinearTermType",
    "CpSatLinearExprType",
    "CpSatLiteralType",
    "CpSatComparisonType",
    "CpSatConstraintType",
    "CpSatObjectiveType",
    "CpSatModelType",
    "CpSatConfigType",
    "CpSatResultType",
]
