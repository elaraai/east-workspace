#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Write ``test/google_or.reference.generated.ts``: what the python runner
answers for the workloads ``test/google_or.spec.ts`` holds both runners to —
the exact LP on each backend (its vertex to the last bit of the backend's own
arithmetic), the W1-shaped LP in columns (500 variables, answered whole, on
Glop, HiGHS and SCIP; 33,526 variables, its objective, two sequential
weighted checksums over its assignments and sampled assignments, on HiGHS),
and the W1-shaped assignment models (50, 300 and 600 decisions) on CP-SAT
with one seeded worker. Each assignment model's optimum is proved unique
here (its solutions at the optimum enumerated), so the pinned assignment is
the one every host's search ends at.

Run from this package::

    uv run --package elaraai-east-py-datascience python tests/fixtures/make_google_or_reference.py

The models are generated here exactly as the spec's East functions generate
them — the same Park–Miller stream, drawn in the same order — so the
answers pinned are the answers to the models the spec builds. A change to a
generator is a change to both, then to this module.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from east import none, some, variant
from east.types.types import BooleanType, FloatType, IntegerType
from east.types.values import EastArray, EastDict, EastStruct, EastVector
from east_py_datascience.google_or.cpsat import (
    CpSatBoolVarType,
    CpSatComparisonType,
    CpSatConstraintType,
    CpSatIntervalVarType,
    CpSatIntVarType,
    CpSatLinearTermType,
    CpSatObjectiveType,
    cpsat_solve,
)
from east_py_datascience.google_or.linear import (
    LinearConstraintDefType,
    LinearSolverType,
    LinearTermType,
    LinearVarType,
    linear_solve,
    linear_solve_columns,
)

OUT = Path(__file__).resolve().parents[2] / "test" / "google_or.reference.generated.ts"


class Stream:
    """Park–Miller: x ← x·48271 mod (2³¹−1); integers in lo .. hi."""

    def __init__(self, seed: int) -> None:
        self.x = seed

    def draw(self, lo: int, hi: int) -> int:
        self.x = (self.x * 48271) % 2147483647
        return lo + self.x % (hi - lo + 1)


def lp_columns(n: int, seed: int) -> EastStruct:
    """The spec's `generatedLp`: n variables with supply (strided, 8 a row,
    bounded above), demand (6 a row, bounded below), period (50 a row, above)
    and resource (strided, 120 a row, above) rows; four terms a variable."""
    r = Stream(seed)
    S, D, P, R = (n + 7) // 8, (n + 5) // 6, (n + 49) // 50, (n + 119) // 120
    var_lower, var_upper, objective = [], [], []
    for k in range(n):
        var_lower.append(0.0)
        ub = float(r.draw(1, 5))
        var_upper.append(math.inf if k % 3 == 0 else ub)
        objective.append(float(r.draw(1, 10)))
    row_lower, row_upper, row_ptr, col_ix, coeff = [], [], [0], [], []

    def row(lower: float, upper: float, vars_: list[int]) -> None:
        row_lower.append(lower)
        row_upper.append(upper)
        for k in vars_:
            col_ix.append(k)
            coeff.append(1.0)
        row_ptr.append(len(col_ix))

    for s in range(S):
        upper = float(r.draw(20, 40))
        row(-math.inf, upper, [k for k in (s + S * j for j in range(8)) if k < n])
    for d in range(D):
        lower = float(r.draw(1, 3))
        row(lower, math.inf, [k for k in (6 * d + j for j in range(6)) if k < n])
    for p in range(P):
        upper = float(r.draw(100, 200))
        row(-math.inf, upper, [k for k in (50 * p + j for j in range(50)) if k < n])
    for q in range(R):
        upper = float(r.draw(200, 400))
        row(-math.inf, upper, [k for k in (q + R * j for j in range(120)) if k < n])
    f = lambda xs: EastVector.from_numpy(np.array(xs, dtype=np.float64), FloatType)  # noqa: E731
    i = lambda xs: EastVector.from_numpy(np.array(xs, dtype=np.int64), IntegerType)  # noqa: E731
    return EastStruct(
        {
            "var_lower": f(var_lower),
            "var_upper": f(var_upper),
            "var_integer": EastVector.from_numpy(np.zeros(n, dtype=np.bool_), BooleanType),
            "row_lower": f(row_lower),
            "row_upper": f(row_upper),
            "row_ptr": i(row_ptr),
            "col_ix": i(col_ix),
            "coeff": f(coeff),
            "objective": f(objective),
            "maximize": False,
        }
    )


def exact_lp() -> EastStruct:
    """The spec's EXACT_LP: maximise 3x + 2y with x + y ≤ 4, x and y in [0, 3] — x = 3, y = 1, 11."""

    def var(name: str) -> EastStruct:
        return EastStruct(
            {"name": name, "lower_bound": 0.0, "upper_bound": 3.0, "is_integer": False}
        )

    def term(name: str, c: float) -> EastStruct:
        return EastStruct({"var": name, "coeff": c})

    return EastStruct(
        {
            "variables": EastArray(LinearVarType, [var("x"), var("y")]),
            "constraints": EastArray(
                LinearConstraintDefType,
                [
                    EastStruct(
                        {
                            "terms": EastArray(LinearTermType, [term("x", 1.0), term("y", 1.0)]),
                            "lower_bound": -1e20,
                            "upper_bound": 4.0,
                        }
                    )
                ],
            ),
            "objective": EastStruct(
                {
                    "terms": EastArray(LinearTermType, [term("x", 3.0), term("y", 2.0)]),
                    "maximize": True,
                }
            ),
        }
    )


def linear_config(backend: str) -> EastStruct:
    return EastStruct(
        {
            "solver": some(variant(backend, None, LinearSolverType)),
            "max_time_seconds": none,
            "relative_gap_limit": none,
            "hints": none,
        }
    )


def highs_config() -> EastStruct:
    return linear_config("highs")


def weighted_sum(values: np.ndarray, modulus: int) -> float:
    """The spec's `weightedSum`: Σ values[i] · ((7919·i mod modulus) + 1), in index order."""
    acc = 0.0
    for idx, v in enumerate(values.tolist()):
        acc = acc + v * float((7919 * idx) % modulus + 1)
    return acc


def assignment_model(n: int, seed: int) -> EastStruct:
    """The spec's `generatedAssignment`: n decisions over 5 slots, each in one
    slot, a slot's weighted load an integer variable bounded by the capacity,
    a minimised cost with a constant."""
    r = Stream(seed)
    M = 5
    cap = (13 * n + 9) // 10
    int_vars = [
        EastStruct({"name": f"load{m}", "lower_bound": 0, "upper_bound": cap}) for m in range(M)
    ]
    bool_vars, constraints, obj_terms, weights = [], [], [], []

    def term(var: str, c: int) -> EastStruct:
        return EastStruct({"var": var, "coeff": c})

    def linear(terms: list[EastStruct], op: str, rhs: int):
        return variant(
            "linear",
            EastStruct(
                {
                    "expr": EastStruct(
                        {"terms": EastArray(CpSatLinearTermType, terms), "constant": 0}
                    ),
                    "op": variant(op, None, CpSatComparisonType),
                    "rhs": rhs,
                }
            ),
            CpSatConstraintType,
        )

    for i in range(n):
        weights.append(r.draw(1, 9))
        terms = []
        for m in range(M):
            name = f"x{i}_{m}"
            bool_vars.append(EastStruct({"name": name}))
            terms.append(term(name, 1))
            obj_terms.append(term(name, r.draw(1, 200000)))
        constraints.append(linear(terms, "equal", 1))
    for m in range(M):
        terms = [term(f"x{i}_{m}", weights[i]) for i in range(n)]
        terms.append(term(f"load{m}", -1))
        constraints.append(linear(terms, "equal", 0))
        obj_terms.append(term(f"load{m}", 2))
    return EastStruct(
        {
            "int_vars": EastArray(CpSatIntVarType, int_vars),
            "bool_vars": EastArray(CpSatBoolVarType, bool_vars),
            "interval_vars": EastArray(CpSatIntervalVarType, []),
            "constraints": EastArray(CpSatConstraintType, constraints),
            "objective": some(
                variant(
                    "minimize",
                    EastStruct({"terms": EastArray(CpSatLinearTermType, obj_terms), "constant": 7}),
                    CpSatObjectiveType,
                )
            ),
        }
    )


def optima(model: EastStruct, optimum: float, limit: int = 2) -> int:
    """How many assignments of `model` attain `optimum`, up to `limit`: the
    model again in CP-SAT with its objective held to the optimum, its solutions
    enumerated (one worker, the search run to its end)."""
    from ortools.sat.python import cp_model

    m = cp_model.CpModel()
    v: dict = {}
    for iv in model["int_vars"]:
        v[iv["name"]] = m.new_int_var(int(iv["lower_bound"]), int(iv["upper_bound"]), iv["name"])
    for bv in model["bool_vars"]:
        v[bv["name"]] = m.new_bool_var(bv["name"])

    def expr(e: EastStruct):
        return sum(int(t["coeff"]) * v[t["var"]] for t in e["terms"]) + int(e["constant"])

    for c in model["constraints"]:
        assert c.type == "linear", c.type
        lin = c.value
        e, rhs = expr(lin["expr"]), int(lin["rhs"])
        op = lin["op"].type
        if op == "equal":
            m.add(e == rhs)
        elif op == "not_equal":
            m.add(e != rhs)
        elif op == "less_equal":
            m.add(e <= rhs)
        else:
            m.add(e >= rhs)
    objective = model["objective"].value
    assert objective.type == "minimize", objective.type
    m.add(expr(objective.value) == int(round(optimum)))

    class Stop(cp_model.CpSolverSolutionCallback):
        def __init__(self) -> None:
            super().__init__()
            self.count = 0

        def on_solution_callback(self) -> None:
            self.count += 1
            if self.count >= limit:
                self.stop_search()

    solver = cp_model.CpSolver()
    solver.parameters.enumerate_all_solutions = True
    solver.parameters.num_workers = 1
    solver.parameters.max_time_in_seconds = 600
    stop = Stop()
    status = solver.solve(m, stop)
    assert status == cp_model.OPTIMAL or stop.count >= limit, solver.status_name(status)
    return stop.count


def one_worker_config() -> EastStruct:
    return EastStruct(
        {
            "max_time_seconds": some(60.0),
            "num_workers": some(1),
            "log_search_progress": none,
            "seed": some(1),
            "max_solutions": none,
            "relative_gap_limit": none,
            "absolute_gap_limit": none,
            "hints": none,
        }
    )


def ts_float(x: float) -> str:
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    return repr(float(x))


def main() -> None:
    parts = [
        "/**\n * Copyright (c) 2025 Elara AI Pty Ltd\n * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.\n */\n",
        "// Generated by tests/fixtures/make_google_or_reference.py — do not edit. What the\n"
        "// python runner answers for the generated workloads of google_or.spec.ts, as\n"
        "// East literals: both runners are held to them.\n\n",
    ]

    exact = {}
    for backend in ("glop", "highs", "scip"):
        result = linear_solve(exact_lp(), linear_config(backend))
        assert result["status"].type == "optimal", (backend, result["status"])
        exact[backend] = (
            result["objective_value"].value,
            result["assignments"]["x"],
            result["assignments"]["y"],
        )
    parts.append(
        "/** The exact LP (3x + 2y, x + y ≤ 4, x and y in [0, 3]) on each backend: its objective\n"
        " *  and its vertex to the last bit of the backend's own arithmetic. */\n"
        "export const lpExact = {\n"
        + "".join(
            f"    {b}: {{ objective: {ts_float(o)}, x: {ts_float(x)}, y: {ts_float(y)} }},\n"
            for b, (o, x, y) in exact.items()
        )
        + "};\n\n"
    )

    for backend, name in (("highs", "lpSmall"), ("glop", "lpSmallGlop"), ("scip", "lpSmallScip")):
        small = linear_solve_columns(lp_columns(500, 7), linear_config(backend))
        assert small["status"].type == "optimal", (backend, small["status"])
        values = small["values"].to_numpy()
        parts.append(
            f"/** The 500-variable LP on {backend}: its objective and every assignment. */\n"
            f"export const {name} = {{\n    objective: {ts_float(small['objective_value'].value)},\n"
            f"    values: new Float64Array([{', '.join(ts_float(float(v)) for v in values)}]),\n}};\n\n"
        )

    large = linear_solve_columns(lp_columns(33526, 7), highs_config())
    assert large["status"].type == "optimal", large["status"]
    values = large["values"].to_numpy()
    sample = [
        0,
        1,
        2,
        3,
        5,
        8,
        13,
        21,
        34,
        55,
        89,
        144,
        233,
        377,
        610,
        987,
        1597,
        2584,
        4181,
        6765,
        10946,
        17711,
        28657,
        33525,
    ]
    parts.append(
        "/** The 33,526-variable LP on HiGHS: its objective, two weighted checksums over its\n"
        " *  assignments in index order (weights (7919·i mod 7) + 1 and (7919·i mod 101) + 1), and\n"
        " *  sampled assignments. */\n"
        f"export const lpLarge = {{\n    variables: {len(values)}n,\n    objective: {ts_float(large['objective_value'].value)},\n"
        f"    checksum7: {ts_float(weighted_sum(values, 7))},\n    checksum101: {ts_float(weighted_sum(values, 101))},\n"
        "    sample: ["
        + ", ".join(f"[{i}n, {ts_float(float(values[i]))}]" for i in sample)
        + "] as Array<[bigint, number]>,\n};\n\n"
    )

    for n in (50, 300, 600):
        model = assignment_model(n, 3)
        result = cpsat_solve(model, one_worker_config())
        assert result["status"].type == "optimal", (n, result["status"])
        count = optima(model, result["objective_value"].value)
        assert count == 1, f"the {n}-decision model has more than one optimum; widen the costs"
        assignments: EastDict = result["assignments"]
        entries = ", ".join(f'["{k}", {int(v)}n]' for k, v in assignments.items())
        parts.append(
            f"/** The assignment model of {n} decisions on CP-SAT, one worker, seed 1: its optimum (unique, proved) and every assignment. */\n"
            f"export const assignment{n} = {{\n    objective: {ts_float(result['objective_value'].value)},\n"
            f"    assignments: new Map<string, bigint>([{entries}]),\n}};\n\n"
        )
        print(
            f"assignment {n}: objective {result['objective_value'].value} (unique), solve {result['solve_time']:.3f} s"
        )

    OUT.write_text("".join(parts))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
