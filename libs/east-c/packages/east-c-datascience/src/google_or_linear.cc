/*
 * google_or_linear_solve: linear and mixed-integer programs on OR-Tools'
 * MPSolver (Glop, SCIP, HiGHS), built straight from the East model — the
 * same backend ids as east-py-datascience's, so a model solves on the same
 * solver on either runner.
 */
#include "google_or.h"

#include "ortools/linear_solver/linear_solver.h"

#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace
{

using namespace east_ds;
using operations_research::MPConstraint;
using operations_research::MPObjective;
using operations_research::MPSolver;
using operations_research::MPSolverParameters;
using operations_research::MPVariable;

const char *const FN = "google_or_linear_solve";

/* The backend: the config's choice, else SCIP for a model with an integer
 * variable and Glop for a pure LP (east-py-datascience's rule). */
std::string solver_id(EastValue *solver_opt, bool has_integers)
{
    if (solver_opt) {
        const char *tag = case_of(solver_opt, FN);
        if (std::strcmp(tag, "glop") == 0) return "GLOP_LINEAR_PROGRAMMING";
        if (std::strcmp(tag, "scip") == 0) return "SCIP_MIXED_INTEGER_PROGRAMMING";
        if (std::strcmp(tag, "highs") == 0) return "HIGHS_MIXED_INTEGER_PROGRAMMING";
    }
    return has_integers ? "SCIP_MIXED_INTEGER_PROGRAMMING" : "GLOP_LINEAR_PROGRAMMING";
}

const char *status_tag(MPSolver::ResultStatus st)
{
    switch (st) {
    case MPSolver::OPTIMAL:
        return "optimal";
    case MPSolver::FEASIBLE:
        return "feasible";
    case MPSolver::INFEASIBLE:
        return "infeasible";
    default:
        return "not_solved";
    }
}

EvalResult linear_solve(EastValue **args, size_t num_args, EastType *out)
{
    if (num_args != 2) throw Error(msg(FN, "takes a model and a config"));
    Clock::time_point t0 = now();
    EastValue *model = args[0];
    EastValue *config = args[1];
    EastType *status_t = field_type(out, "status", FN);
    EastType *objective_t = field_type(out, "objective_value", FN);
    EastType *assignments_t = field_type(out, "assignments", FN);

    EastValue *variables = field(model, "variables", FN);
    size_t num_vars = length(variables, FN);
    bool has_integers = false;
    for (size_t i = 0; i < num_vars; i++)
        if (as_boolean(field(at(variables, i), "is_integer", FN), FN)) has_integers = true;

    std::string id = solver_id(some_value(field(config, "solver", FN), FN), has_integers);
    std::unique_ptr<MPSolver> solver(MPSolver::CreateSolver(id));
    if (!solver) {
        StructBuilder r(out, FN);
        r.set("status", status(status_t, "model_invalid"));
        r.set("objective_value", none(objective_t));
        r.set("assignments", dict(assignments_t, FN));
        r.set("wall_time", east_float(seconds_since(t0)));
        return eval_ok(r.build());
    }

    /* The variables, by name: a name declared twice is its last declaration. */
    std::unordered_map<std::string, MPVariable *> vars;
    vars.reserve(num_vars);
    for (size_t i = 0; i < num_vars; i++) {
        EastValue *v = at(variables, i);
        std::string name(as_string(field(v, "name", FN), FN));
        double lb = as_float(field(v, "lower_bound", FN), FN);
        double ub = as_float(field(v, "upper_bound", FN), FN);
        bool is_int = as_boolean(field(v, "is_integer", FN), FN);
        vars[name] = is_int ? solver->MakeIntVar(lb, ub, name) : solver->MakeNumVar(lb, ub, name);
    }
    auto lookup = [&](EastValue *name_value) -> MPVariable * {
        std::string name(as_string(name_value, FN));
        auto it = vars.find(name);
        if (it == vars.end()) throw Error(msg(FN, "unknown variable '" + name + "'"));
        return it->second;
    };

    EastValue *constraints = field(model, "constraints", FN);
    for (size_t i = 0, n = length(constraints, FN); i < n; i++) {
        EastValue *c = at(constraints, i);
        MPConstraint *ct = solver->MakeRowConstraint(as_float(field(c, "lower_bound", FN), FN),
                                                     as_float(field(c, "upper_bound", FN), FN));
        EastValue *terms = field(c, "terms", FN);
        for (size_t j = 0, m = length(terms, FN); j < m; j++) {
            EastValue *term = at(terms, j);
            ct->SetCoefficient(lookup(field(term, "var", FN)),
                               as_float(field(term, "coeff", FN), FN));
        }
    }

    EastValue *objective_data = field(model, "objective", FN);
    MPObjective *objective = solver->MutableObjective();
    EastValue *objective_terms = field(objective_data, "terms", FN);
    for (size_t j = 0, m = length(objective_terms, FN); j < m; j++) {
        EastValue *term = at(objective_terms, j);
        objective->SetCoefficient(lookup(field(term, "var", FN)),
                                  as_float(field(term, "coeff", FN), FN));
    }
    if (as_boolean(field(objective_data, "maximize", FN), FN))
        objective->SetMaximization();
    else
        objective->SetMinimization();

    if (EastValue *max_time = some_value(field(config, "max_time_seconds", FN), FN))
        solver->SetTimeLimit(
            absl::Milliseconds(static_cast<int64_t>(as_float(max_time, FN) * 1000.0)));

    /* The MIP gap is a solve parameter; a pure-LP backend ignores it. */
    MPSolverParameters params;
    if (EastValue *gap = some_value(field(config, "relative_gap_limit", FN), FN))
        params.SetDoubleParam(MPSolverParameters::RELATIVE_MIP_GAP, as_float(gap, FN));

    /* A partial hint: unknown names skipped, a name given twice collapsed to
     * its last value. Only SCIP takes one (OR-Tools 9.15's HiGHS interface
     * faults on a hint; Glop has no use for one). */
    if (EastValue *hints = some_value(field(config, "hints", FN), FN);
        hints && id.rfind("SCIP", 0) == 0) {
        std::vector<std::pair<std::string, double> > order;
        std::unordered_map<std::string, size_t> index;
        for (size_t i = 0, n = length(hints, FN); i < n; i++) {
            EastValue *h = at(hints, i);
            std::string name(as_string(field(h, "var", FN), FN));
            double value = as_float(field(h, "value", FN), FN);
            auto it = index.find(name);
            if (it == index.end()) {
                index[name] = order.size();
                order.emplace_back(name, value);
            } else {
                order[it->second].second = value;
            }
        }
        std::vector<std::pair<const MPVariable *, double> > hint;
        for (const auto &[name, value] : order) {
            auto it = vars.find(name);
            if (it != vars.end()) hint.emplace_back(it->second, value);
        }
        if (!hint.empty()) solver->SetHint(std::move(hint));
    }

    MPSolver::ResultStatus result_status = solver->Solve(params);
    double wall_time = seconds_since(t0);

    EastValue *assignments = dict(assignments_t, FN);
    EastValue *objective_value = nullptr;
    if (result_status == MPSolver::OPTIMAL || result_status == MPSolver::FEASIBLE) {
        for (const auto &[name, var] : vars)
            dict_put(assignments, string(name), east_float(var->solution_value()));
        objective_value = some(objective_t, east_float(objective->Value()));
    } else {
        objective_value = none(objective_t);
    }

    StructBuilder r(out, FN);
    r.set("status", status(status_t, status_tag(result_status)));
    r.set("objective_value", objective_value);
    r.set("assignments", assignments);
    r.set("wall_time", east_float(wall_time));
    return eval_ok(r.build());
}

/* The columnar form: the same solve, the model built from the vectors. */
EvalResult linear_solve_columns(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_linear_solve_columns";
    if (num_args != 2) throw Error(msg(fn, "takes a model and a config"));
    Clock::time_point t0 = now();
    EastValue *model = args[0];
    EastValue *config = args[1];
    EastType *status_t = field_type(out, "status", fn);
    EastType *objective_t = field_type(out, "objective_value", fn);

    std::vector<double> var_lower = vector_floats(field(model, "var_lower", fn), fn);
    std::vector<double> var_upper = vector_floats(field(model, "var_upper", fn), fn);
    std::vector<bool> var_integer = vector_booleans(field(model, "var_integer", fn), fn);
    std::vector<double> row_lower = vector_floats(field(model, "row_lower", fn), fn);
    std::vector<double> row_upper = vector_floats(field(model, "row_upper", fn), fn);
    std::vector<int64_t> row_ptr = vector_integers(field(model, "row_ptr", fn), fn);
    std::vector<int64_t> col_ix = vector_integers(field(model, "col_ix", fn), fn);
    std::vector<double> coeff = vector_floats(field(model, "coeff", fn), fn);
    std::vector<double> objective = vector_floats(field(model, "objective", fn), fn);
    bool maximize = as_boolean(field(model, "maximize", fn), fn);

    size_t n_vars = var_lower.size();
    if (var_upper.size() != n_vars || var_integer.size() != n_vars || objective.size() != n_vars)
        throw Error(msg(fn, "var_lower, var_upper, var_integer and objective must have one entry "
                            "per variable; got " +
                                std::to_string(n_vars) + ", " + std::to_string(var_upper.size()) +
                                ", " + std::to_string(var_integer.size()) + " and " +
                                std::to_string(objective.size())));
    size_t n_rows = row_lower.size();
    if (row_upper.size() != n_rows)
        throw Error(msg(fn, "row_lower has " + std::to_string(n_rows) +
                                " entries but row_upper has " + std::to_string(row_upper.size())));
    check_rows(fn, n_vars, row_ptr, col_ix, coeff.size(), n_rows);

    bool has_integers = false;
    for (bool b : var_integer)
        has_integers = has_integers || b;
    std::string id = solver_id(some_value(field(config, "solver", fn), fn), has_integers);
    std::unique_ptr<MPSolver> solver(MPSolver::CreateSolver(id));
    if (!solver) {
        StructBuilder r(out, fn);
        r.set("status", status(status_t, "model_invalid"));
        r.set("objective_value", none(objective_t));
        r.set("values", float_vector({}));
        r.set("wall_time", east_float(seconds_since(t0)));
        return eval_ok(r.build());
    }

    std::vector<MPVariable *> vars(n_vars);
    for (size_t i = 0; i < n_vars; i++)
        vars[i] = var_integer[i] ? solver->MakeIntVar(var_lower[i], var_upper[i], "")
                                 : solver->MakeNumVar(var_lower[i], var_upper[i], "");
    for (size_t r = 0; r < n_rows; r++) {
        MPConstraint *ct = solver->MakeRowConstraint(row_lower[r], row_upper[r]);
        for (int64_t k = row_ptr[r]; k < row_ptr[r + 1]; k++)
            ct->SetCoefficient(vars[static_cast<size_t>(col_ix[static_cast<size_t>(k)])],
                               coeff[static_cast<size_t>(k)]);
    }
    MPObjective *obj = solver->MutableObjective();
    for (size_t i = 0; i < n_vars; i++)
        if (objective[i] != 0.0) obj->SetCoefficient(vars[i], objective[i]);
    if (maximize)
        obj->SetMaximization();
    else
        obj->SetMinimization();

    if (EastValue *max_time = some_value(field(config, "max_time_seconds", fn), fn))
        solver->SetTimeLimit(
            absl::Milliseconds(static_cast<int64_t>(as_float(max_time, fn) * 1000.0)));
    MPSolverParameters params;
    if (EastValue *gap = some_value(field(config, "relative_gap_limit", fn), fn))
        params.SetDoubleParam(MPSolverParameters::RELATIVE_MIP_GAP, as_float(gap, fn));

    /* A partial hint by index: an index outside the model dropped, one given
     * twice kept at its last value; SCIP alone takes one. */
    if (EastValue *hints = some_value(field(config, "hints", fn), fn);
        hints && id.rfind("SCIP", 0) == 0) {
        std::vector<int64_t> index = vector_integers(field(hints, "index", fn), fn);
        std::vector<double> value = vector_floats(field(hints, "value", fn), fn);
        std::vector<std::pair<const MPVariable *, double> > hint;
        std::unordered_map<int64_t, size_t> at;
        for (size_t k = 0; k < index.size() && k < value.size(); k++) {
            if (index[k] < 0 || index[k] >= static_cast<int64_t>(n_vars)) continue;
            auto it = at.find(index[k]);
            if (it == at.end()) {
                at[index[k]] = hint.size();
                hint.emplace_back(vars[static_cast<size_t>(index[k])], value[k]);
            } else {
                hint[it->second].second = value[k];
            }
        }
        if (!hint.empty()) solver->SetHint(std::move(hint));
    }

    MPSolver::ResultStatus result_status = solver->Solve(params);
    double wall_time = seconds_since(t0);

    std::vector<double> values;
    EastValue *objective_value = nullptr;
    if (result_status == MPSolver::OPTIMAL || result_status == MPSolver::FEASIBLE) {
        values.resize(n_vars);
        for (size_t i = 0; i < n_vars; i++)
            values[i] = vars[i]->solution_value();
        objective_value = some(objective_t, east_float(obj->Value()));
    } else {
        objective_value = none(objective_t);
    }

    StructBuilder r(out, fn);
    r.set("status", status(status_t, status_tag(result_status)));
    r.set("objective_value", objective_value);
    r.set("values", float_vector(values));
    r.set("wall_time", east_float(wall_time));
    return eval_ok(r.build());
}

} // namespace

namespace east_ds
{

void register_google_or_linear(PlatformRegistry *reg)
{
    platform_registry_add(reg, "google_or_linear_solve", &platform_call<linear_solve>, false);
    platform_registry_add(reg, "google_or_linear_solve_columns",
                          &platform_call<linear_solve_columns>, false);
}

} // namespace east_ds
