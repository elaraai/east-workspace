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

import time
from typing import TYPE_CHECKING, Any

import numpy as np
from east import none, some, variant
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
    VectorType,
)
from east.types.values import EastArray, EastDict, EastStruct, EastVariant, EastVector

from east_py_datascience.google_or.types import GoogleOrStatusType, _check_google_or_support

if TYPE_CHECKING:
    from ortools.sat.python.cp_model import CpSolverStatus

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
"""Declaration of an integer decision variable for a CP-SAT model.

Fields: ``name`` (``String`` unique identifier), ``lower_bound``
(``Integer``), ``upper_bound`` (``Integer``).
"""

CpSatBoolVarType = StructType(
    [
        ("name", StringType),
    ]
)
"""Declaration of a boolean decision variable for a CP-SAT model.

Fields: ``name`` (``String`` unique identifier; the variable takes value
0 or 1).
"""

CpSatIntervalVarType = StructType(
    [
        ("name", StringType),
        ("start", StringType),
        ("size", StringType),
        ("end", StringType),
        ("is_present", OptionType(StringType)),
    ]
)
"""Declaration of an interval variable for scheduling constraints.

Fields: ``name`` (``String`` unique identifier), ``start`` / ``size`` /
``end`` (names of already-declared integer variables satisfying
``start + size == end``), ``is_present`` (name of a boolean variable that
gates whether this interval is active — omit for mandatory intervals).
"""

# --- Expressions and literals ---

CpSatLinearTermType = StructType(
    [
        ("var", StringType),
        ("coeff", IntegerType),
    ]
)
"""One term in a CP-SAT linear expression: ``coeff * var``.

Fields: ``var`` (``String`` variable name), ``coeff`` (``Integer``
coefficient).
"""

CpSatLinearExprType = StructType(
    [
        ("terms", ArrayType(CpSatLinearTermType)),
        ("constant", IntegerType),
    ]
)
"""A linear expression over CP-SAT variables plus an integer constant.

Fields: ``terms`` (``Array<CpSatLinearTermType>`` weighted variable
references), ``constant`` (``Integer`` additive offset, often 0).
"""

CpSatLiteralType = StructType(
    [
        ("var", StringType),
        ("negated", BooleanType),
    ]
)
"""A boolean literal (variable or its negation) in a CP-SAT constraint.

Fields: ``var`` (``String`` name of a boolean variable), ``negated``
(``Boolean`` — true means the logical negation of the variable is used).
"""

# --- Constraints ---

CpSatComparisonType = VariantType(
    [
        ("equal", NullType),
        ("not_equal", NullType),
        ("less_equal", NullType),
        ("greater_equal", NullType),
    ]
)
"""Comparison operator used in a ``linear`` CP-SAT constraint.

Cases: ``equal`` (``==``), ``not_equal`` (``!=``),
``less_equal`` (``<=``), ``greater_equal`` (``>=``).
"""

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
"""A CP-SAT constraint added to the model.

Cases:
- ``linear`` ``{expr, op, rhs}`` — linear expression compared to a constant
  (``equal``, ``not_equal``, ``less_equal``, ``greater_equal``).
- ``bool_or`` ``{literals}`` — at least one literal must be true.
- ``bool_and`` ``{literals}`` — all literals must be true.
- ``implication`` ``{if_literal, then_literal}`` — if ``if_literal`` is
  true, ``then_literal`` must also be true.
- ``exactly_k`` ``{vars, k}`` — exactly ``k`` of the named bool vars are
  true.
- ``at_most_k`` ``{vars, k}`` — at most ``k`` true.
- ``at_least_k`` ``{vars, k}`` — at least ``k`` true.
- ``all_different`` ``{vars}`` — all named int vars take distinct values.
- ``element`` ``{index_var, values, target_var}`` —
  ``target_var == values[index_var]``.
- ``no_overlap`` ``{intervals}`` — named interval vars do not overlap in
  time.
- ``cumulative`` ``{intervals, demands, capacity}`` — sum of active
  interval demands never exceeds ``capacity``.
- ``circuit`` ``{arcs}`` — each arc is ``{tail, head: Integer, literal:
  String}``; the active (literal=1) arcs form a Hamiltonian circuit.
"""

# --- Objective ---

CpSatObjectiveType = VariantType(
    [
        ("minimize", CpSatLinearExprType),
        ("maximize", CpSatLinearExprType),
    ]
)
"""Optimization direction and linear expression for the CP-SAT objective.

Cases: ``minimize`` (``CpSatLinearExprType`` — minimize the expression),
``maximize`` (``CpSatLinearExprType`` — maximize the expression). Omit the
objective entirely for a pure feasibility problem.
"""

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
"""Complete declarative description of a CP-SAT model.

Fields: ``int_vars`` (``Array<CpSatIntVarType>`` integer decision variables),
``bool_vars`` (``Array<CpSatBoolVarType>`` boolean decision variables),
``interval_vars`` (``Array<CpSatIntervalVarType>`` scheduling intervals built
from int/bool vars), ``constraints`` (``Array<CpSatConstraintType>``),
``objective`` (``Option<CpSatObjectiveType>`` — omit for feasibility).
"""

# --- Config ---

CpSatHintType = StructType(
    [
        ("var", StringType),
        ("value", IntegerType),
    ]
)
"""One entry of a (partial) solution hint: a suggested value for one variable.

Fields: ``var`` (``String`` int/bool variable name; booleans hint 0/1),
``value`` (``Integer`` suggested solution value).
"""

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
        ("hints", OptionType(ArrayType(CpSatHintType))),
    ]
)
"""Solver configuration for a CP-SAT solve call.

Fields: ``max_time_seconds`` (wall-clock time limit), ``num_workers``
(parallel search threads), ``log_search_progress`` (emit solver log, default
false), ``seed`` (random seed), ``max_solutions`` (used by
``google_or_cpsat_solve_all`` to cap collected solutions, default 100),
``relative_gap_limit`` (declare optimality when proven gap <=
``best * this``, e.g. 0.005 for 0.5%), ``absolute_gap_limit`` (declare
optimality when proven gap <= this value in objective units),
``hints`` (``Option<Array<CpSatHintType>>`` — a partial solution hint to
warm-start the search, e.g. the previous solve's assignments). Hints are
advisory only: an infeasible, partial, or suboptimal hint never changes the
returned optimum, only the path to it. Entries naming unknown or interval
variables are ignored.
"""

# --- Result ---

CpSatResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("objective_value", OptionType(FloatType)),
        ("best_bound", OptionType(FloatType)),
        ("assignments", DictType(StringType, IntegerType)),
        ("build_time", FloatType),
        ("solve_time", FloatType),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_cpsat_solve`` and ``google_or_cpsat_solve_all``.

Fields: ``status`` (``GoogleOrStatusType``), ``objective_value``
(``Option<Float>`` — present when feasible or optimal), ``best_bound``
(``Option<Float>`` — the solver's proven bound on the objective, the objective
itself when optimal; present when feasible or optimal, so an answer under a
time or gap limit is within the configured gap of it), ``assignments``
(``Dict<String, Integer>`` mapping variable names to their integer values),
``build_time`` (``Float`` seconds from the call's entry to the solver's start), ``solve_time`` (``Float`` seconds inside the solver), ``wall_time`` (``Float`` seconds for the whole call, so what is left of it is the write-back).
"""

# --- The columnar form ---

CpSatModelColumnsType = StructType(
    [
        ("var_lower", VectorType(IntegerType)),
        ("var_upper", VectorType(IntegerType)),
        ("row_lower", VectorType(IntegerType)),
        ("row_upper", VectorType(IntegerType)),
        ("row_ptr", VectorType(IntegerType)),
        ("col_ix", VectorType(IntegerType)),
        ("coeff", VectorType(IntegerType)),
        (
            "objective",
            OptionType(
                StructType(
                    [
                        ("coeff", VectorType(IntegerType)),
                        ("maximize", BooleanType),
                    ]
                )
            ),
        ),
        ("names", OptionType(ArrayType(StringType))),
        ("interval_vars", ArrayType(CpSatIntervalVarType)),
        ("constraints", ArrayType(CpSatConstraintType)),
    ]
)
"""A CP-SAT model in columns: its variables by index and its linear
constraints by rows, as vectors.

Variable ``i`` has the domain ``[var_lower[i], var_upper[i]]`` (a boolean is
``[0, 1]``). Linear constraint ``r`` holds its sum in ``[row_lower[r],
row_upper[r]]`` (an open side is the Integer's min or max) and its terms are
``coeff[k] * variable(col_ix[k])`` for ``k`` in ``row_ptr[r] .. row_ptr[r +
1]``; so ``row_ptr`` has one more entry than there are rows, starts at 0 and
ends at the term count. The objective, when there is one, is ``coeff[i] *
variable(i)`` summed, minimized or maximized. The other constraint kinds and
the interval variables stay as ``CpSatModelType`` has them, over named
variables: ``names`` gives variable ``i`` its name, and is ``none`` when
nothing names one.
"""

CpSatColumnsHintType = StructType(
    [
        ("index", VectorType(IntegerType)),
        ("value", VectorType(IntegerType)),
    ]
)
"""A partial solution hint by variable index: ``value[k]`` for variable ``index[k]``."""

CpSatColumnsConfigType = StructType(
    [
        ("max_time_seconds", OptionType(FloatType)),
        ("num_workers", OptionType(IntegerType)),
        ("log_search_progress", OptionType(BooleanType)),
        ("seed", OptionType(IntegerType)),
        ("relative_gap_limit", OptionType(FloatType)),
        ("absolute_gap_limit", OptionType(FloatType)),
        ("hints", OptionType(CpSatColumnsHintType)),
    ]
)
"""Solver configuration for a columnar CP-SAT solve: ``CpSatConfigType``'s
fields, with the hint by variable index and no ``max_solutions`` (the columnar
form solves for one solution)."""

CpSatColumnsResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("objective_value", OptionType(FloatType)),
        ("best_bound", OptionType(FloatType)),
        ("values", VectorType(IntegerType)),
        ("build_time", FloatType),
        ("solve_time", FloatType),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_cpsat_solve_columns``: the variables' values
by index (``Vector<Integer>``, empty unless ``optimal`` or ``feasible``)
beside the ``status``, ``objective_value``, ``best_bound`` and the times of
``CpSatResultType``."""


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


def _status_tag(status_code: "CpSolverStatus") -> str:
    """The ``GoogleOrStatusType`` case for an OR-Tools solver status code."""
    from ortools.sat.python import cp_model

    status_map: dict[CpSolverStatus, str] = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "model_invalid",
        cp_model.UNKNOWN: "not_solved",
    }
    return status_map.get(status_code, "not_solved")


def _build_model_and_solve(
    fn: str,
    start_time: float,
    model_data: EastStruct,
    config: EastStruct,
    solution_callback: Any = None,
) -> tuple[Any, dict[str, Any], "CpSolverStatus", float, float]:
    """Build a CP-SAT model from declarative data and solve it.

    Returns (solver, vars_by_name, status_code, build_time, solve_time):
    ``build_time`` from ``start_time`` (the platform call's entry) to the
    solver's start, ``solve_time`` inside the solver.
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
        is_present = v["is_present"].unwrap_or(None)
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
    objective_opt = model_data["objective"].unwrap_or(None)
    if objective_opt is not None:
        obj_tag = objective_opt.type
        obj_expr = _build_linear_expr(vars_by_name, objective_opt.value)
        if obj_tag == "minimize":
            model.minimize(obj_expr)
        else:
            model.maximize(obj_expr)

    # Partial solution hint (advisory: seeds the search, never the optimum).
    # Unknown names are skipped - a previous solve's assignments may name
    # variables that dropped out of this model - as are interval variables
    # (not hintable; only their underlying int/bool vars are). Duplicate
    # names collapse to the last entry so the hint proto stays valid.
    hints = config["hints"].unwrap_or(None)
    if hints is not None:
        hint_by_name: dict[str, int] = {}
        for h in hints:
            hint_by_name[h.get("var")] = int(h.get("value"))
        for name, value in hint_by_name.items():
            var = vars_by_name.get(name)
            if var is None or isinstance(var, cp_model.IntervalVar):
                continue
            model.add_hint(var, value)

    # Configure solver
    solver = cp_model.CpSolver()
    max_time = config["max_time_seconds"].unwrap_or(None)
    if max_time is not None:
        solver.parameters.max_time_in_seconds = float(max_time)

    num_workers = config["num_workers"].unwrap_or(None)
    if num_workers is not None:
        solver.parameters.num_workers = int(num_workers)

    log_progress = config["log_search_progress"].unwrap_or(None)
    if log_progress is not None:
        solver.parameters.log_search_progress = bool(log_progress)

    seed = config["seed"].unwrap_or(None)
    if seed is not None:
        seed = int(seed)
        if not -2**31 <= seed < 2**31:
            raise RuntimeError(
                f"{fn}: seed {seed} is outside the solver's 32-bit range (-2147483648 .. 2147483647)"
            )
        solver.parameters.random_seed = seed

    rel_gap = config["relative_gap_limit"].unwrap_or(None)
    if rel_gap is not None:
        solver.parameters.relative_gap_limit = float(rel_gap)

    abs_gap = config["absolute_gap_limit"].unwrap_or(None)
    if abs_gap is not None:
        solver.parameters.absolute_gap_limit = float(abs_gap)

    # Solve: the build ends where the solver starts
    build_time = time.perf_counter() - start_time
    solve_start = time.perf_counter()
    if solution_callback is not None:
        solver.parameters.enumerate_all_solutions = True
        solution_callback.set_vars(vars_by_name)
        status_code = solver.solve(model, solution_callback)
    else:
        status_code = solver.solve(model)
    solve_time = time.perf_counter() - solve_start

    return solver, vars_by_name, status_code, build_time, solve_time


def _extract_assignments(solver: Any, vars_by_name: dict[str, Any]) -> EastDict:
    """Extract variable assignments from a solved model (interval vars have no value)."""
    from ortools.sat.python import cp_model

    assignments: EastDict = EastDict(StringType, IntegerType)
    for name, var in vars_by_name.items():
        if not isinstance(var, cp_model.IntervalVar):
            assignments[name] = int(solver.value(var))
    return assignments


@platform_function(
    name="google_or_cpsat_solve",
    inputs=[CpSatModelType, CpSatConfigType],
    output=CpSatResultType,
)
def cpsat_solve(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a CP-SAT model and return the single best solution found.

    Builds an OR-Tools CP-SAT model from the declarative ``model_data``
    description, applies the solver configuration, and returns the first
    feasible or optimal solution found.

    Args:
        model_data: ``CpSatModelType`` (``EastStruct``) with fields:

            - ``int_vars`` (``Array<CpSatIntVarType>``): integer decision
              variables; each ``{name: String, lower_bound: Integer,
              upper_bound: Integer}``.
            - ``bool_vars`` (``Array<CpSatBoolVarType>``): boolean decision
              variables; each ``{name: String}``.
            - ``interval_vars`` (``Array<CpSatIntervalVarType>``): optional
              interval variables for scheduling; each ``{name, start, size,
              end: String, is_present: Option<String>}`` where string fields
              name already-declared int/bool vars.
            - ``constraints`` (``Array<CpSatConstraintType>``): constraint
              list; each is a variant - ``linear``, ``bool_or``,
              ``bool_and``, ``implication``, ``exactly_k``, ``at_most_k``,
              ``at_least_k``, ``all_different``, ``element``, ``no_overlap``,
              ``cumulative``, ``circuit``.
            - ``objective`` (``Option<CpSatObjectiveType>``): either
              ``minimize`` or ``maximize`` wrapping a ``CpSatLinearExprType``
              ``{terms: Array<{var, coeff: Integer}>, constant: Integer}``.

        config: ``CpSatConfigType`` (``EastStruct``) with fields:

            - ``max_time_seconds`` (``Option<Float>``): wall-clock time limit.
            - ``num_workers`` (``Option<Integer>``): parallel search threads.
            - ``log_search_progress`` (``Option<Boolean>``): emit CP-SAT
              solver log (default false).
            - ``seed`` (``Option<Integer>``): random seed for the solver.
            - ``max_solutions`` (``Option<Integer>``): ignored by this
              function (used by :func:`cpsat_solve_all`).
            - ``relative_gap_limit`` (``Option<Float>``): declare
              optimality when proven gap <= this fraction (e.g. 0.005).
            - ``absolute_gap_limit`` (``Option<Float>``): declare
              optimality when proven gap <= this value in objective units.
            - ``hints`` (``Option<Array<CpSatHintType>>``): partial solution
              hint - ``{var: String, value: Integer}`` entries suggesting a
              start, e.g. the previous solve's assignments (booleans hint
              0/1). Advisory only: never changes the returned optimum, only
              the path to it. Entries naming unknown or interval variables
              are ignored.

    Returns:
        ``CpSatResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType`` - ``optimal``, ``feasible``,
        ``infeasible``, ``not_solved``, or ``model_invalid``),
        ``objective_value`` (``Option<Float>`` - present when feasible or
        optimal), ``assignments`` (``Dict<String, Integer>`` - variable
        name to value for all int/bool vars), ``build_time`` (``Float`` seconds from the call's entry to the solver's start), ``solve_time`` (``Float`` seconds inside the solver), ``wall_time`` (``Float`` seconds for the whole call, so what is left of it is the write-back).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
    """
    _check_google_or_support()
    from ortools.sat.python import cp_model

    start_time = time.perf_counter()
    solver, vars_by_name, status_code, build_time, solve_time = _build_model_and_solve(
        "google_or_cpsat_solve", start_time, model_data, config
    )

    assignments: EastDict = EastDict(StringType, IntegerType)
    obj_value: EastVariant = none
    best_bound: EastVariant = none
    if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        assignments = _extract_assignments(solver, vars_by_name)
        obj_value = some(float(solver.objective_value))
        best_bound = some(float(solver.best_objective_bound))

    return EastStruct(
        {
            "status": variant(_status_tag(status_code), None, GoogleOrStatusType),
            "objective_value": obj_value,
            "best_bound": best_bound,
            "assignments": assignments,
            "build_time": build_time,
            "solve_time": solve_time,
            "wall_time": time.perf_counter() - start_time,
        }
    )


@platform_function(
    name="google_or_cpsat_solve_all",
    inputs=[CpSatModelType, CpSatConfigType],
    output=ArrayType(CpSatResultType),
)
def cpsat_solve_all(
    model_data: EastStruct,
    config: EastStruct,
) -> EastArray:
    """Solve a CP-SAT model and collect all feasible solutions up to a limit.

    Installs a solution callback on the CP-SAT solver so that every solution
    found during search is captured. Stops after ``max_solutions`` solutions
    or when the solver exhausts the search space.

    Args:
        model_data: ``CpSatModelType`` (``EastStruct``) - same schema as
            :func:`cpsat_solve`.
        config: ``CpSatConfigType`` (``EastStruct``) - same schema as
            :func:`cpsat_solve`; ``max_solutions`` (``Option<Integer>``)
            caps the number of solutions collected (default 100).

    Returns:
        ``Array<CpSatResultType>`` (``EastArray``) - one entry per solution
        found; each entry has ``status`` ``feasible``, ``objective_value``
        (``Option<Float>``), ``assignments`` (``Dict<String, Integer>``), and
        ``wall_time`` (``Float``, set on the last element to total elapsed
        time).  Returns an empty array when the model is infeasible.

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
    """
    _check_google_or_support()
    from ortools.sat.python import cp_model

    max_solutions = int(config["max_solutions"].unwrap_or(100))

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

            assignments: EastDict = EastDict(StringType, IntegerType)
            for name, var in self._vars_by_name.items():
                if not isinstance(var, cp_model.IntervalVar):
                    assignments[name] = int(self.value(var))

            solutions.append(
                EastStruct(
                    {
                        "status": variant("feasible", None, GoogleOrStatusType),
                        "objective_value": some(float(self.objective_value)),
                        "best_bound": none,
                        "assignments": assignments,
                        "build_time": 0.0,
                        "solve_time": 0.0,
                        "wall_time": 0.0,
                    }
                )
            )
            self._count += 1

    callback = SolutionCollector()

    start_time = time.perf_counter()
    solver, vars_by_name, status_code, build_time, solve_time = _build_model_and_solve(
        "google_or_cpsat_solve_all", start_time, model_data, config, solution_callback=callback
    )
    # Re-solve with callback if we haven't collected solutions yet
    if not solutions and status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Fallback: return the single solution from the solver
        solutions.append(
            EastStruct(
                {
                    "status": variant(_status_tag(status_code), None, GoogleOrStatusType),
                    "objective_value": some(float(solver.objective_value)),
                    "best_bound": none,
                    "assignments": _extract_assignments(solver, vars_by_name),
                    "build_time": 0.0,
                    "solve_time": 0.0,
                    "wall_time": 0.0,
                }
            )
        )

    # The last solution carries the call's times and the solver's bound
    if solutions:
        last = solutions[-1]
        solutions[-1] = EastStruct(
            {
                "status": last.get("status"),
                "objective_value": last.get("objective_value"),
                "best_bound": some(float(solver.best_objective_bound)),
                "assignments": last.get("assignments"),
                "build_time": build_time,
                "solve_time": solve_time,
                "wall_time": time.perf_counter() - start_time,
            }
        )

    return EastArray(CpSatResultType, solutions)


@platform_function(
    name="google_or_cpsat_solve_columns",
    inputs=[CpSatModelColumnsType, CpSatColumnsConfigType],
    output=CpSatColumnsResultType,
)
def cpsat_solve_columns(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a CP-SAT model given in columns and return the best solution.

    The same solve as :func:`cpsat_solve`, from the columnar form: the
    variables' domains and the linear rows cross to numpy without a copy and
    fill the model's proto in bulk; the other constraint kinds and the interval
    variables are added as :func:`cpsat_solve` adds them, over the variables
    ``names`` names.

    Args:
        model_data: ``CpSatModelColumnsType`` (``EastStruct``) - ``var_lower``
            and ``var_upper`` (``Vector<Integer>``, a domain per variable),
            the linear rows (``row_lower``, ``row_upper``, and the terms
            ``col_ix``/``coeff`` cut by ``row_ptr``), ``objective``
            (``Option<{coeff: Vector<Integer>, maximize: Boolean}>``),
            ``names`` (``Option<Array<String>>``, one per variable when any
            constraint or interval below names one), ``interval_vars`` and
            ``constraints`` as ``CpSatModelType`` has them.
        config: ``CpSatColumnsConfigType`` (``EastStruct``) -
            ``CpSatConfigType``'s fields but ``max_solutions``, and ``hints``
            (``Option<{index: Vector<Integer>, value: Vector<Integer>}>``) by
            variable index - advisory; an index outside the variables is
            ignored, an index given twice collapses to its last value.

    Returns:
        ``CpSatColumnsResultType`` (``EastStruct``): ``status``,
        ``objective_value`` (``Option<Float>``), ``values`` (``Vector<Integer>``
        - every variable's value by index when feasible or optimal, else
        empty), ``build_time`` (``Float`` seconds from the call's entry to the solver's start), ``solve_time`` (``Float`` seconds inside the solver), ``wall_time`` (``Float`` seconds for the whole call, so what is left of it is the write-back).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
        RuntimeError: the vectors do not describe one model (see
            :func:`linear_solve_columns`), ``names`` has another count than the
            variables, or a constraint names a variable while ``names`` is
            ``none``.
    """
    _check_google_or_support()
    from ortools.sat.python import cp_model

    fn = "google_or_cpsat_solve_columns"
    start_time = time.perf_counter()

    fn = "google_or_cpsat_solve_columns"

    var_lower = model_data["var_lower"].to_numpy(dtype=np.int64)
    var_upper = model_data["var_upper"].to_numpy(dtype=np.int64)
    row_lower = model_data["row_lower"].to_numpy(dtype=np.int64)
    row_upper = model_data["row_upper"].to_numpy(dtype=np.int64)
    row_ptr = model_data["row_ptr"].to_numpy(dtype=np.int64)
    col_ix = model_data["col_ix"].to_numpy(dtype=np.int64)
    coeff = model_data["coeff"].to_numpy(dtype=np.int64)

    n_vars = len(var_lower)
    if len(var_upper) != n_vars:
        raise RuntimeError(f"{fn}: var_lower has {n_vars} entries but var_upper has {len(var_upper)}")
    n_rows = len(row_lower)
    if len(row_upper) != n_rows:
        raise RuntimeError(f"{fn}: row_lower has {n_rows} entries but row_upper has {len(row_upper)}")
    from east_py_datascience.google_or.linear import _check_rows

    _check_rows(fn, n_vars, row_ptr, col_ix, len(coeff), n_rows)

    model = cp_model.CpModel()
    proto = model.proto
    for lb, ub in zip(var_lower.tolist(), var_upper.tolist(), strict=True):
        proto.variables.add().domain.extend([lb, ub])
    for r in range(n_rows):
        ct = proto.constraints.add().linear
        lo, hi = int(row_ptr[r]), int(row_ptr[r + 1])
        ct.vars.extend(col_ix[lo:hi].tolist())
        ct.coeffs.extend(coeff[lo:hi].tolist())
        ct.domain.extend([int(row_lower[r]), int(row_upper[r])])
    variables = [cp_model.IntVar(proto, i) for i in range(n_vars)]

    objective_opt = model_data["objective"].unwrap_or(None)
    if objective_opt is not None:
        obj_coeff = objective_opt["coeff"].to_numpy(dtype=np.int64)
        if len(obj_coeff) != n_vars:
            raise RuntimeError(
                f"{fn}: the objective has {len(obj_coeff)} coefficients but there are {n_vars} variables"
            )
        nonzero = np.flatnonzero(obj_coeff)
        expr = cp_model.LinearExpr.weighted_sum(
            [variables[i] for i in nonzero.tolist()], obj_coeff[nonzero].tolist()
        )
        if bool(objective_opt["maximize"]):
            model.maximize(expr)
        else:
            model.minimize(expr)

    # The named constraints and intervals, over the variables `names` names
    names_opt = model_data["names"].unwrap_or(None)
    interval_vars = model_data["interval_vars"]
    constraints = model_data["constraints"]
    vars_by_name: dict[str, Any] = {}
    if names_opt is not None:
        names = list(names_opt)
        if len(names) != n_vars:
            raise RuntimeError(f"{fn}: names has {len(names)} entries but there are {n_vars} variables")
        for name, var in zip(names, variables, strict=True):
            vars_by_name[name] = var
    elif len(interval_vars) > 0 or len(constraints) > 0:
        raise RuntimeError(f"{fn}: the interval variables and constraints name variables, but names is none")
    for v in interval_vars:
        name = v.get("name")
        start = vars_by_name[v.get("start")]
        size = vars_by_name[v.get("size")]
        end = vars_by_name[v.get("end")]
        is_present = v["is_present"].unwrap_or(None)
        if is_present is not None:
            vars_by_name[name] = model.new_optional_interval_var(
                start, size, end, vars_by_name[is_present], name
            )
        else:
            vars_by_name[name] = model.new_interval_var(start, size, end, name)
    for c in constraints:
        _add_constraint(model, vars_by_name, c)

    hints = config["hints"].unwrap_or(None)
    if hints is not None:
        index = hints["index"].to_numpy(dtype=np.int64)
        value = hints["value"].to_numpy(dtype=np.int64)
        kept: dict[int, int] = {}
        for i, v in zip(index.tolist(), value.tolist(), strict=False):
            if 0 <= i < n_vars:
                kept[i] = v
        for i, v in kept.items():
            model.add_hint(variables[i], v)

    solver = cp_model.CpSolver()
    max_time = config["max_time_seconds"].unwrap_or(None)
    if max_time is not None:
        solver.parameters.max_time_in_seconds = float(max_time)
    num_workers = config["num_workers"].unwrap_or(None)
    if num_workers is not None:
        solver.parameters.num_workers = int(num_workers)
    log_progress = config["log_search_progress"].unwrap_or(None)
    if log_progress is not None:
        solver.parameters.log_search_progress = bool(log_progress)
    seed = config["seed"].unwrap_or(None)
    if seed is not None:
        seed = int(seed)
        if not -2**31 <= seed < 2**31:
            raise RuntimeError(
                f"{fn}: seed {seed} is outside the solver's 32-bit range (-2147483648 .. 2147483647)"
            )
        solver.parameters.random_seed = seed
    rel_gap = config["relative_gap_limit"].unwrap_or(None)
    if rel_gap is not None:
        solver.parameters.relative_gap_limit = float(rel_gap)
    abs_gap = config["absolute_gap_limit"].unwrap_or(None)
    if abs_gap is not None:
        solver.parameters.absolute_gap_limit = float(abs_gap)

    build_time = time.perf_counter() - start_time
    solve_start = time.perf_counter()
    status_code = solver.solve(model)
    solve_time = time.perf_counter() - solve_start

    values = np.zeros(0, dtype=np.int64)
    obj_value: EastVariant = none
    best_bound: EastVariant = none
    if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # The solution read back whole: the response's values, the columnar
        # variables first, in index order
        solution = solver.response_proto.solution
        values = np.fromiter(solution, dtype=np.int64, count=len(solution))[:n_vars]
        obj_value = some(float(solver.objective_value))
        best_bound = some(float(solver.best_objective_bound))

    return EastStruct(
        {
            "status": variant(_status_tag(status_code), None, GoogleOrStatusType),
            "objective_value": obj_value,
            "best_bound": best_bound,
            "values": EastVector(IntegerType, values),
            "build_time": build_time,
            "solve_time": solve_time,
            "wall_time": time.perf_counter() - start_time,
        }
    )


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
    "CpSatHintType",
    "CpSatConfigType",
    "CpSatResultType",
    "CpSatModelColumnsType",
    "CpSatColumnsHintType",
    "CpSatColumnsConfigType",
    "CpSatColumnsResultType",
]
