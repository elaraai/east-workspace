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

import time
from typing import Any

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
from east.types.values import EastDict, EastStruct, EastVariant, EastVector

from east_py_datascience.google_or.types import GoogleOrStatusType, _check_google_or_support

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
"""Declaration of a decision variable for an LP or MIP model.

Fields: ``name`` (``String`` unique identifier), ``lower_bound``
(``Float``), ``upper_bound`` (``Float``), ``is_integer`` (``Boolean`` —
true triggers MIP mode for the whole model).
"""

LinearTermType = StructType(
    [
        ("var", StringType),
        ("coeff", FloatType),
    ]
)
"""One term in a linear expression: ``coeff * var``.

Fields: ``var`` (``String`` variable name), ``coeff`` (``Float``
coefficient).
"""

LinearConstraintDefType = StructType(
    [
        ("terms", ArrayType(LinearTermType)),
        ("lower_bound", FloatType),
        ("upper_bound", FloatType),
    ]
)
"""A linear constraint expressed as a range: ``lower_bound <= expr <= upper_bound``.

Fields: ``terms`` (``Array<LinearTermType>``), ``lower_bound`` (``Float``),
``upper_bound`` (``Float`` — set equal to ``lower_bound`` for an equality
constraint).
"""

LinearObjectiveType = StructType(
    [
        ("terms", ArrayType(LinearTermType)),
        ("maximize", BooleanType),
    ]
)
"""Objective function for an LP or MIP model.

Fields: ``terms`` (``Array<LinearTermType>`` linear expression to optimize),
``maximize`` (``Boolean`` — true maximizes, false minimizes).
"""

LinearModelType = StructType(
    [
        ("variables", ArrayType(LinearVarType)),
        ("constraints", ArrayType(LinearConstraintDefType)),
        ("objective", LinearObjectiveType),
    ]
)
"""Complete declarative description of a linear or mixed-integer program.

Fields: ``variables`` (``Array<LinearVarType>`` decision variables),
``constraints`` (``Array<LinearConstraintDefType>``),
``objective`` (``LinearObjectiveType``). Any variable with ``is_integer =
true`` promotes the problem to MIP.
"""

LinearSolverType = VariantType(
    [
        ("glop", NullType),
        ("scip", NullType),
        ("highs", NullType),
    ]
)
"""Backend solver to use for the linear or MIP problem.

Cases: ``glop`` (Google Simplex LP — pure LP only), ``scip`` (SCIP
mixed-integer programming), ``highs`` (HiGHS LP/MIP). Defaults to ``glop``
for pure-LP models and ``scip`` for MIP models when omitted.
"""

LinearHintType = StructType(
    [
        ("var", StringType),
        ("value", FloatType),
    ]
)
"""One entry of a (partial) solution hint: a suggested value for one variable.

Fields: ``var`` (``String`` variable name), ``value`` (``Float`` suggested
solution value).
"""

LinearConfigType = StructType(
    [
        ("solver", OptionType(LinearSolverType)),
        ("max_time_seconds", OptionType(FloatType)),
        ("relative_gap_limit", OptionType(FloatType)),
        ("hints", OptionType(ArrayType(LinearHintType))),
    ]
)
"""Solver configuration for a linear solve call.

Fields: ``solver`` (backend override, auto-selected if omitted),
``max_time_seconds`` (time limit; converted to milliseconds internally),
``relative_gap_limit`` (stop with status OPTIMAL once the proven relative MIP
gap ``(best - bound) / |best|`` <= this, e.g. ``0.01`` for 1%). The gap limit
is MIP-only (OR-Tools ``RELATIVE_MIP_GAP``, honoured by SCIP/CBC); it is ignored
for a pure-LP (Glop) solve, which has no branch-and-bound gap.
``hints`` (``Option<Array<LinearHintType>>`` — a partial solution hint to
warm-start the search, e.g. the previous epoch's solution in a
receding-horizon loop). Hints are advisory only: an infeasible, partial, or
suboptimal hint never changes the returned optimum, only the path to it.
Entries naming unknown variables are ignored (variables may drop out between
re-solves). Honoured by backends with hint support (SCIP); hint-less
backends (Glop) ignore it.
"""

LinearResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("objective_value", OptionType(FloatType)),
        ("assignments", DictType(StringType, FloatType)),
        ("build_time", FloatType),
        ("solve_time", FloatType),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_linear_solve``.

Fields: ``status`` (``GoogleOrStatusType``), ``objective_value``
(``Option<Float>`` — present when feasible or optimal), ``assignments``
(``Dict<String, Float>`` mapping variable names to solution values),
``build_time`` (``Float`` seconds from the call's entry to the solver's start), ``solve_time`` (``Float`` seconds inside the solver), ``wall_time`` (``Float`` seconds for the whole call, so what is left of it is the write-back).
"""

LinearModelColumnsType = StructType(
    [
        ("var_lower", VectorType(FloatType)),
        ("var_upper", VectorType(FloatType)),
        ("var_integer", VectorType(BooleanType)),
        ("row_lower", VectorType(FloatType)),
        ("row_upper", VectorType(FloatType)),
        ("row_ptr", VectorType(IntegerType)),
        ("col_ix", VectorType(IntegerType)),
        ("coeff", VectorType(FloatType)),
        ("objective", VectorType(FloatType)),
        ("maximize", BooleanType),
    ]
)
"""A linear program in columns, the form a solver takes in bulk.

Variable ``i`` has the bounds ``[var_lower[i], var_upper[i]]`` and is integer
when ``var_integer[i]``. Constraint ``r`` holds its sum in
``[row_lower[r], row_upper[r]]`` (an unbounded side is ``-1e20`` or ``1e20``)
and its terms are ``coeff[k] * variable(col_ix[k])`` for ``k`` in
``row_ptr[r] .. row_ptr[r + 1]``; so ``row_ptr`` has one more entry than there
are rows, starts at 0 and ends at the term count. The objective is
``objective[i] * variable(i)`` summed, maximized when ``maximize``. The vectors
cross between the East runtime and the solver whole — to numpy without a copy,
then into OR-Tools in bulk — where ``LinearModelType`` crosses an element at a
time.
"""

LinearColumnsHintType = StructType(
    [
        ("index", VectorType(IntegerType)),
        ("value", VectorType(FloatType)),
    ]
)
"""A partial solution hint by variable index: ``value[k]`` for variable ``index[k]``."""

LinearColumnsConfigType = StructType(
    [
        ("solver", OptionType(LinearSolverType)),
        ("max_time_seconds", OptionType(FloatType)),
        ("relative_gap_limit", OptionType(FloatType)),
        ("hints", OptionType(LinearColumnsHintType)),
    ]
)
"""Solver configuration for a columnar linear solve: ``LinearConfigType``'s
fields, with the hint by variable index. A hint reaches the backend that takes
one (SCIP); Glop and HiGHS ignore it."""

LinearColumnsResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("objective_value", OptionType(FloatType)),
        ("values", VectorType(FloatType)),
        ("build_time", FloatType),
        ("solve_time", FloatType),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_linear_solve_columns``: the variables' values
by index (``Vector<Float>``, empty unless ``optimal`` or ``feasible``) beside
the ``status``, ``objective_value`` and the times of ``LinearResultType``.
"""


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
def linear_solve(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a linear programming or mixed-integer programming problem.

    Automatically selects a solver backend (Glop for pure LP, SCIP for MIP)
    unless overridden in ``config``. Variables with ``is_integer = true``
    trigger MIP mode.

    Args:
        model_data: ``LinearModelType`` (``EastStruct``) with fields:

            - ``variables`` (``Array<LinearVarType>``): decision variables;
              each ``{name: String, lower_bound: Float, upper_bound: Float,
              is_integer: Boolean}``.
            - ``constraints`` (``Array<LinearConstraintDefType>``): linear
              constraints; each ``{terms: Array<{var: String, coeff: Float}>,
              lower_bound: Float, upper_bound: Float}`` (set ``lower_bound``
              and ``upper_bound`` equal for equality constraints).
            - ``objective`` (``LinearObjectiveType``): ``{terms:
              Array<{var: String, coeff: Float}>, maximize: Boolean}``.

        config: ``LinearConfigType`` (``EastStruct``) with fields:

            - ``solver`` (``Option<LinearSolverType>``): backend to use -
              ``glop`` (Simplex LP), ``scip`` (MIP via SCIP), or ``highs``
              (LP/MIP via HiGHS); defaults to ``glop`` for pure-LP models
              and ``scip`` for MIP models.
            - ``max_time_seconds`` (``Option<Float>``): time limit in seconds
              (converted to milliseconds for the OR-Tools solver).
            - ``relative_gap_limit`` (``Option<Float>``): stop with status
              OPTIMAL once the proven relative MIP gap
              ``(best - bound) / |best|`` is at or below this (e.g. ``0.01``
              for 1%). MIP only (OR-Tools ``RELATIVE_MIP_GAP``); ignored for a
              pure-LP (Glop) solve.
            - ``hints`` (``Option<Array<LinearHintType>>``): partial solution
              hint - ``{var: String, value: Float}`` entries suggesting a
              (near-feasible) start, e.g. the previous solve's solution.
              Advisory only: never changes the returned optimum, only the
              path to it. Entries naming unknown variables are ignored;
              backends without hint support (Glop) ignore the whole hint.

    Returns:
        ``LinearResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType`` - ``optimal``, ``feasible``,
        ``infeasible``, or ``not_solved``), ``objective_value``
        (``Option<Float>`` - present when feasible or optimal),
        ``assignments`` (``Dict<String, Float>`` - variable name to solution
        value), ``build_time`` (``Float`` seconds from the call's entry to the solver's start), ``solve_time`` (``Float`` seconds inside the solver), ``wall_time`` (``Float`` seconds for the whole call, so what is left of it is the write-back).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
        RuntimeError: the requested solver backend is unavailable in the
            installed OR-Tools build (returns ``model_invalid`` status instead
            of raising).
    """
    _check_google_or_support()
    from ortools.linear_solver import pywraplp

    start_time = time.perf_counter()

    # Detect if any integer variables
    variables_data = model_data.get("variables")
    has_integers = any(bool(v.get("is_integer")) for v in variables_data)

    # Select solver
    solver_opt = config["solver"].unwrap_or(None)
    solver_id = _detect_solver_id(solver_opt, has_integers)
    solver = pywraplp.Solver.CreateSolver(solver_id)

    if solver is None:
        build_time = time.perf_counter() - start_time
        return EastStruct(
            {
                "status": variant("model_invalid", None, GoogleOrStatusType),
                "objective_value": none,
                "assignments": EastDict(StringType, FloatType),
                "build_time": build_time,
                "solve_time": 0.0,
                "wall_time": time.perf_counter() - start_time,
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
    max_time = config["max_time_seconds"].unwrap_or(None)
    if max_time is not None:
        solver.SetTimeLimit(int(float(max_time) * 1000))

    # Relative MIP optimality-gap early stop. Passing default parameters is
    # equivalent to Solve() with none set; the pure-LP Glop backend ignores the
    # gap (no branch-and-bound), so this is a no-op for LP.
    params = pywraplp.MPSolverParameters()
    rel_gap = config["relative_gap_limit"].unwrap_or(None)
    if rel_gap is not None:
        params.SetDoubleParam(params.RELATIVE_MIP_GAP, float(rel_gap))

    # Partial solution hint (advisory: guides the search, never the optimum).
    # Unknown names are skipped - in a receding-horizon loop the previous
    # solution may name variables that dropped out of this epoch's model.
    # Duplicate names collapse to the last entry.
    hints = config["hints"].unwrap_or(None)
    if hints is not None and solver_id.startswith("SCIP"):
        hint_by_name: dict[str, float] = {}
        for h in hints:
            hint_by_name[h.get("var")] = float(h.get("value"))
        hint_vars = []
        hint_values = []
        for name, value in hint_by_name.items():
            var = vars_by_name.get(name)
            if var is None:
                continue
            hint_vars.append(var)
            hint_values.append(value)
        if hint_vars:
            solver.SetHint(hint_vars, hint_values)

    # Solve: the build ends where the solver starts
    build_time = time.perf_counter() - start_time
    solve_start = time.perf_counter()
    result_status = solver.Solve(params)
    solve_time = time.perf_counter() - solve_start

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
    status = variant(status_tag, None, GoogleOrStatusType)

    assignments: EastDict = EastDict(StringType, FloatType)
    obj_value: EastVariant = none
    if result_status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        for name, var in vars_by_name.items():
            assignments[name] = float(var.solution_value())
        obj_value = some(float(objective.Value()))

    return EastStruct(
        {
            "status": status,
            "objective_value": obj_value,
            "assignments": assignments,
            "build_time": build_time,
            "solve_time": solve_time,
            "wall_time": time.perf_counter() - start_time,
        }
    )


def _columns_error(fn: str, what: str) -> RuntimeError:
    return RuntimeError(f"{fn}: {what}")


def _check_rows(fn: str, n_vars: int, row_ptr: np.ndarray, col_ix: np.ndarray,
                n_coeff: int, n_rows: int) -> None:
    """The row structure every columnar model must have, refused by name."""
    if len(row_ptr) != n_rows + 1:
        raise _columns_error(
            fn, f"row_ptr has {len(row_ptr)} entries but there are {n_rows} rows: it needs {n_rows + 1}"
        )
    if len(row_ptr) > 0 and (row_ptr[0] != 0 or int(row_ptr[-1]) != len(col_ix)):
        raise _columns_error(
            fn, f"row_ptr must start at 0 and end at the term count {len(col_ix)}, "
            f"got {int(row_ptr[0])} and {int(row_ptr[-1])}"
        )
    if len(row_ptr) > 1 and bool((np.diff(row_ptr) < 0).any()):
        raise _columns_error(fn, "row_ptr must not decrease")
    if len(col_ix) != n_coeff:
        raise _columns_error(
            fn, f"col_ix has {len(col_ix)} entries but coeff has {n_coeff}: one coefficient per term"
        )
    if len(col_ix) > 0 and (bool((col_ix < 0).any()) or bool((col_ix >= n_vars).any())):
        raise _columns_error(fn, f"col_ix names a variable outside 0 .. {n_vars - 1}")


@platform_function(
    name="google_or_linear_solve_columns",
    inputs=[LinearModelColumnsType, LinearColumnsConfigType],
    output=LinearColumnsResultType,
)
def linear_solve_columns(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a linear or mixed-integer program given in columns.

    The same solve as :func:`linear_solve`, from the columnar form: the model's
    vectors cross to numpy without a copy and OR-Tools takes them in bulk (the
    model builder's sparse fill, then the linear solver loads the model whole),
    so nothing crosses the bridge an element at a time. The backend is chosen
    as :func:`linear_solve` chooses it.

    Args:
        model_data: ``LinearModelColumnsType`` (``EastStruct``) - the variables'
            bounds and integrality by index, the constraints by rows
            (``row_lower``, ``row_upper``, and the terms ``col_ix``/``coeff``
            cut by ``row_ptr``), the objective's coefficients by variable and
            ``maximize``.
        config: ``LinearColumnsConfigType`` (``EastStruct``) - ``solver``,
            ``max_time_seconds`` and ``relative_gap_limit`` as
            ``LinearConfigType`` has them, and ``hints`` (``Option<{index:
            Vector<Integer>, value: Vector<Float>}>``) by variable index -
            advisory, handed to SCIP only; an index outside the variables is
            ignored, an index given twice collapses to its last value.

    Returns:
        ``LinearColumnsResultType`` (``EastStruct``): ``status``,
        ``objective_value`` (``Option<Float>``), ``values`` (``Vector<Float>``
        - every variable's value by index when feasible or optimal, else
        empty), ``build_time`` (``Float`` seconds from the call's entry to the solver's start), ``solve_time`` (``Float`` seconds inside the solver), ``wall_time`` (``Float`` seconds for the whole call, so what is left of it is the write-back).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools, scipy) is not
            installed.
        RuntimeError: the vectors do not describe one model - a bounds vector
            of another length than the others, ``row_ptr`` not one longer than
            the rows, not starting at 0, not ending at the term count or
            decreasing, ``col_ix`` naming a variable outside the model.
    """
    _check_google_or_support()
    import importlib

    from ortools.linear_solver import linear_solver_pb2, pywraplp
    from scipy.sparse import csr_matrix

    # Loaded by name: a static import of this module makes mypy resolve the
    # ortools package, which does not declare its pywraplp submodule.
    model_builder = importlib.import_module("ortools.linear_solver.python.model_builder")

    fn = "google_or_linear_solve_columns"
    start_time = time.perf_counter()

    # The vectors cross to numpy as views; the model builder's bulk fill takes
    # writable buffers, so each is copied once, whole (a memcpy, not a crossing
    # per element).
    def column(name: str, dtype: type) -> np.ndarray:
        return np.array(model_data[name].to_numpy(dtype=dtype), dtype=dtype)

    var_lower = column("var_lower", np.float64)
    var_upper = column("var_upper", np.float64)
    var_integer = column("var_integer", np.bool_)
    row_lower = column("row_lower", np.float64)
    row_upper = column("row_upper", np.float64)
    row_ptr = column("row_ptr", np.int64)
    col_ix = column("col_ix", np.int64)
    coeff = column("coeff", np.float64)
    objective = column("objective", np.float64)
    maximize = bool(model_data["maximize"])

    n_vars = len(var_lower)
    if not len(var_upper) == len(var_integer) == len(objective) == n_vars:
        raise _columns_error(
            fn, f"var_lower, var_upper, var_integer and objective must have one entry per variable; "
            f"got {n_vars}, {len(var_upper)}, {len(var_integer)} and {len(objective)}"
        )
    n_rows = len(row_lower)
    if len(row_upper) != n_rows:
        raise _columns_error(
            fn, f"row_lower has {n_rows} entries but row_upper has {len(row_upper)}"
        )
    _check_rows(fn, n_vars, row_ptr, col_ix, len(coeff), n_rows)

    has_integers = bool(var_integer.any())
    solver_opt = config["solver"].unwrap_or(None)
    solver_id = _detect_solver_id(solver_opt, has_integers)
    solver = pywraplp.Solver.CreateSolver(solver_id)
    if solver is None:
        build_time = time.perf_counter() - start_time
        return EastStruct(
            {
                "status": variant("model_invalid", None, GoogleOrStatusType),
                "objective_value": none,
                "values": EastVector(FloatType, np.zeros(0, dtype=np.float64)),
                "build_time": build_time,
                "solve_time": 0.0,
                "wall_time": time.perf_counter() - start_time,
            }
        )

    # The model, filled in bulk from the vectors, then handed to the solver whole
    builder = model_builder.Model()
    builder.helper.fill_model_from_sparse_data(
        var_lower, var_upper, objective, row_lower, row_upper,
        csr_matrix((coeff, col_ix, row_ptr), shape=(n_rows, n_vars)),
    )
    for i in np.flatnonzero(var_integer):
        builder.helper.set_var_integrality(int(i), True)
    builder.helper.set_maximize(maximize)
    proto = builder.export_to_proto()

    # A partial hint, advisory: a variable given twice keeps its last value, an
    # index outside the model is dropped. Only SCIP takes one.
    hints = config["hints"].unwrap_or(None)
    if hints is not None and solver_id.startswith("SCIP"):
        index = hints["index"].to_numpy(dtype=np.int64)
        value = hints["value"].to_numpy(dtype=np.float64)
        kept: dict[int, float] = {}
        for i, v in zip(index.tolist(), value.tolist(), strict=False):
            if 0 <= i < n_vars:
                kept[i] = v
        if kept:
            proto.solution_hint.var_index.extend(kept.keys())
            proto.solution_hint.var_value.extend(kept.values())

    load_error = solver.LoadModelFromProto(proto)
    if load_error:
        raise _columns_error(fn, f"the solver refused the model - {load_error}")

    max_time = config["max_time_seconds"].unwrap_or(None)
    if max_time is not None:
        solver.SetTimeLimit(int(float(max_time) * 1000))
    params = pywraplp.MPSolverParameters()
    rel_gap = config["relative_gap_limit"].unwrap_or(None)
    if rel_gap is not None:
        params.SetDoubleParam(params.RELATIVE_MIP_GAP, float(rel_gap))

    build_time = time.perf_counter() - start_time
    solve_start = time.perf_counter()
    result_status = solver.Solve(params)
    solve_time = time.perf_counter() - solve_start

    status_map = {
        pywraplp.Solver.OPTIMAL: "optimal",
        pywraplp.Solver.FEASIBLE: "feasible",
        pywraplp.Solver.INFEASIBLE: "infeasible",
    }
    status_tag = status_map.get(result_status, "not_solved")

    values = np.zeros(0, dtype=np.float64)
    obj_value: EastVariant = none
    if result_status in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        # The solution read back whole, through the response proto
        response = linear_solver_pb2.MPSolutionResponse()
        solver.FillSolutionResponseProto(response)
        values = np.fromiter(response.variable_value, dtype=np.float64, count=len(response.variable_value))
        obj_value = some(float(solver.Objective().Value()))

    return EastStruct(
        {
            "status": variant(status_tag, None, GoogleOrStatusType),
            "objective_value": obj_value,
            "values": EastVector(FloatType, values),
            "build_time": build_time,
            "solve_time": solve_time,
            "wall_time": time.perf_counter() - start_time,
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
    "LinearHintType",
    "LinearConfigType",
    "LinearResultType",
    "LinearModelColumnsType",
    "LinearColumnsHintType",
    "LinearColumnsConfigType",
    "LinearColumnsResultType",
]
