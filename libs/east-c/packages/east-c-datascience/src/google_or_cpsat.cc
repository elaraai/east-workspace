/*
 * google_or_cpsat_solve, google_or_cpsat_solve_all and
 * google_or_cpsat_solve_columns: CP-SAT models built straight from the East
 * model through OR-Tools' CpModelBuilder — every constraint kind
 * east-py-datascience's CpSatConstraintType names, and the columnar form, its
 * variables by index and its linear constraints by rows.
 */
#include "google_or.h"

#include "ortools/sat/cp_model.h"
#include "ortools/sat/cp_model.pb.h"
#include "ortools/sat/cp_model_solver.h"
#include "ortools/sat/model.h"
#include "ortools/sat/sat_parameters.pb.h"
#include "ortools/util/time_limit.h"

#include <atomic>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace
{

using namespace east_ds;
using operations_research::Domain;
using operations_research::sat::BoolVar;
using operations_research::sat::CpModelBuilder;
using operations_research::sat::CpSolverResponse;
using operations_research::sat::CpSolverStatus;
using operations_research::sat::IntervalVar;
using operations_research::sat::IntVar;
using operations_research::sat::LinearExpr;
using operations_research::sat::SatParameters;

/* A declared variable: an integer, a boolean, or an interval. */
struct Named {
    enum Kind { INT, BOOL, INTERVAL } kind;
    IntVar i;
    BoolVar b;
    IntervalVar iv;
};

/* The model as it is built: the builder, and its variables by name. */
struct Build {
    const char *fn;
    CpModelBuilder model;
    std::unordered_map<std::string, Named> vars;

    const Named &lookup(EastValue *name_value) const
    {
        std::string name(as_string(name_value, fn));
        auto it = vars.find(name);
        if (it == vars.end()) throw Error(msg(fn, "unknown variable '" + name + "'"));
        return it->second;
    }

    /* A variable in a linear expression: an integer or a boolean. */
    LinearExpr expr_of(EastValue *name_value) const
    {
        const Named &v = lookup(name_value);
        if (v.kind == Named::INT) return LinearExpr(v.i);
        if (v.kind == Named::BOOL) return LinearExpr(v.b);
        throw Error(msg(fn, "interval variable '" + std::string(as_string(name_value, fn)) +
                                "' cannot appear in a linear expression"));
    }

    /* A boolean literal: the variable, or its negation. */
    BoolVar literal(EastValue *lit) const
    {
        EastValue *name_value = field(lit, "var", fn);
        const Named &v = lookup(name_value);
        if (v.kind != Named::BOOL)
            throw Error(msg(fn, "'" + std::string(as_string(name_value, fn)) +
                                    "' is not a boolean variable"));
        return as_boolean(field(lit, "negated", fn), fn) ? v.b.Not() : v.b;
    }

    IntervalVar interval(EastValue *name_value) const
    {
        const Named &v = lookup(name_value);
        if (v.kind != Named::INTERVAL)
            throw Error(msg(fn, "'" + std::string(as_string(name_value, fn)) +
                                    "' is not an interval variable"));
        return v.iv;
    }

    /* sum(coeff_i * var_i) + constant */
    LinearExpr linear(EastValue *expr) const
    {
        LinearExpr result;
        EastValue *terms = field(expr, "terms", fn);
        for (size_t i = 0, n = length(terms, fn); i < n; i++) {
            EastValue *term = at(terms, i);
            LinearExpr var = expr_of(field(term, "var", fn));
            var *= as_integer(field(term, "coeff", fn), fn);
            result += var;
        }
        int64_t constant = as_integer(field(expr, "constant", fn), fn);
        if (constant != 0) result += LinearExpr(constant);
        return result;
    }

    LinearExpr sum_of(EastValue *names) const
    {
        LinearExpr result;
        for (size_t i = 0, n = length(names, fn); i < n; i++)
            result += expr_of(at(names, i));
        return result;
    }

    /* The interval variables, each over declared variables. */
    void add_intervals(EastValue *interval_vars)
    {
        for (size_t i = 0, n = length(interval_vars, fn); i < n; i++) {
            EastValue *v = at(interval_vars, i);
            std::string name(as_string(field(v, "name", fn), fn));
            LinearExpr start = expr_of(field(v, "start", fn));
            LinearExpr size = expr_of(field(v, "size", fn));
            LinearExpr end = expr_of(field(v, "end", fn));
            IntervalVar iv;
            if (EastValue *present = some_value(field(v, "is_present", fn), fn)) {
                const Named &p = lookup(present);
                if (p.kind != Named::BOOL)
                    throw Error(msg(fn, "'" + std::string(as_string(present, fn)) +
                                            "' is not a boolean variable"));
                iv = model.NewOptionalIntervalVar(start, size, end, p.b).WithName(name);
            } else {
                iv = model.NewIntervalVar(start, size, end).WithName(name);
            }
            Named named{Named::INTERVAL, IntVar(), BoolVar(), iv};
            vars[name] = named;
        }
    }

    void add_constraints(EastValue *constraints)
    {
        for (size_t i = 0, n = length(constraints, fn); i < n; i++)
            add_constraint(at(constraints, i));
    }

    void add_constraint(EastValue *constraint)
    {
        const char *tag = case_of(constraint, fn);
        EastValue *data = payload(constraint);
        if (std::strcmp(tag, "linear") == 0) {
            LinearExpr expr = linear(field(data, "expr", fn));
            int64_t rhs = as_integer(field(data, "rhs", fn), fn);
            const char *op = case_of(field(data, "op", fn), fn);
            if (std::strcmp(op, "equal") == 0)
                model.AddEquality(expr, rhs);
            else if (std::strcmp(op, "not_equal") == 0)
                model.AddNotEqual(expr, rhs);
            else if (std::strcmp(op, "less_equal") == 0)
                model.AddLessOrEqual(expr, rhs);
            else if (std::strcmp(op, "greater_equal") == 0)
                model.AddGreaterOrEqual(expr, rhs);
            else
                throw Error(msg(fn, std::string("unknown comparison '") + op + "'"));
        } else if (std::strcmp(tag, "bool_or") == 0 || std::strcmp(tag, "bool_and") == 0) {
            std::vector<BoolVar> literals;
            EastValue *lits = field(data, "literals", fn);
            for (size_t i = 0, n = length(lits, fn); i < n; i++)
                literals.push_back(literal(at(lits, i)));
            if (tag[5] == 'o')
                model.AddBoolOr(literals);
            else
                model.AddBoolAnd(literals);
        } else if (std::strcmp(tag, "implication") == 0) {
            model.AddImplication(literal(field(data, "if_literal", fn)),
                                 literal(field(data, "then_literal", fn)));
        } else if (std::strcmp(tag, "exactly_k") == 0 || std::strcmp(tag, "at_most_k") == 0 ||
                   std::strcmp(tag, "at_least_k") == 0) {
            LinearExpr total = sum_of(field(data, "vars", fn));
            int64_t k = as_integer(field(data, "k", fn), fn);
            if (tag[0] == 'e')
                model.AddEquality(total, k);
            else if (tag[3] == 'm')
                model.AddLessOrEqual(total, k);
            else
                model.AddGreaterOrEqual(total, k);
        } else if (std::strcmp(tag, "all_different") == 0) {
            std::vector<LinearExpr> exprs;
            EastValue *names = field(data, "vars", fn);
            for (size_t i = 0, n = length(names, fn); i < n; i++)
                exprs.push_back(expr_of(at(names, i)));
            model.AddAllDifferent(exprs);
        } else if (std::strcmp(tag, "element") == 0) {
            std::vector<int64_t> values = integers(field(data, "values", fn), fn);
            model.AddElement(expr_of(field(data, "index_var", fn)), values,
                             expr_of(field(data, "target_var", fn)));
        } else if (std::strcmp(tag, "no_overlap") == 0) {
            std::vector<IntervalVar> intervals;
            EastValue *names = field(data, "intervals", fn);
            for (size_t i = 0, n = length(names, fn); i < n; i++)
                intervals.push_back(interval(at(names, i)));
            model.AddNoOverlap(intervals);
        } else if (std::strcmp(tag, "cumulative") == 0) {
            EastValue *names = field(data, "intervals", fn);
            std::vector<int64_t> demands = integers(field(data, "demands", fn), fn);
            size_t n = length(names, fn);
            if (demands.size() != n)
                throw Error(msg(fn, "cumulative: " + std::to_string(n) + " intervals but " +
                                        std::to_string(demands.size()) + " demands"));
            auto cumulative =
                model.AddCumulative(LinearExpr(as_integer(field(data, "capacity", fn), fn)));
            for (size_t i = 0; i < n; i++)
                cumulative.AddDemand(interval(at(names, i)), LinearExpr(demands[i]));
        } else if (std::strcmp(tag, "circuit") == 0) {
            auto circuit = model.AddCircuitConstraint();
            EastValue *arcs = field(data, "arcs", fn);
            for (size_t i = 0, n = length(arcs, fn); i < n; i++) {
                EastValue *arc = at(arcs, i);
                EastValue *name_value = field(arc, "literal", fn);
                const Named &v = lookup(name_value);
                if (v.kind != Named::BOOL)
                    throw Error(msg(fn, "'" + std::string(as_string(name_value, fn)) +
                                            "' is not a boolean variable"));
                circuit.AddArc(static_cast<int>(as_integer(field(arc, "tail", fn), fn)),
                               static_cast<int>(as_integer(field(arc, "head", fn), fn)), v.b);
            }
        } else {
            throw Error(msg(fn, std::string("unknown constraint '") + tag + "'"));
        }
    }
};

const char *status_tag(CpSolverStatus st)
{
    switch (st) {
    case CpSolverStatus::OPTIMAL:
        return "optimal";
    case CpSolverStatus::FEASIBLE:
        return "feasible";
    case CpSolverStatus::INFEASIBLE:
        return "infeasible";
    case CpSolverStatus::MODEL_INVALID:
        return "model_invalid";
    default:
        return "not_solved";
    }
}

bool solved(CpSolverStatus st)
{
    return st == CpSolverStatus::OPTIMAL || st == CpSolverStatus::FEASIBLE;
}

/* The solver parameters a config asks for (CpSatConfigType's and
 * CpSatColumnsConfigType's share these fields). */
SatParameters sat_params(EastValue *config, const char *fn)
{
    SatParameters params;
    if (EastValue *v = some_value(field(config, "max_time_seconds", fn), fn))
        params.set_max_time_in_seconds(as_float(v, fn));
    if (EastValue *v = some_value(field(config, "num_workers", fn), fn))
        params.set_num_workers(static_cast<int>(as_integer(v, fn)));
    if (EastValue *v = some_value(field(config, "log_search_progress", fn), fn))
        params.set_log_search_progress(as_boolean(v, fn));
    if (EastValue *v = some_value(field(config, "seed", fn), fn))
        params.set_random_seed(static_cast<int>(as_integer(v, fn)));
    if (EastValue *v = some_value(field(config, "relative_gap_limit", fn), fn))
        params.set_relative_gap_limit(as_float(v, fn));
    if (EastValue *v = some_value(field(config, "absolute_gap_limit", fn), fn))
        params.set_absolute_gap_limit(as_float(v, fn));
    return params;
}

/* One solution's assignments, every int and bool variable, in C++ data: the
 * observer may run off the calling thread, and East values are built on it. */
using Assignments = std::vector<std::pair<std::string, int64_t> >;

Assignments assignments_of(const CpSolverResponse &response, const Build &build)
{
    Assignments out;
    out.reserve(build.vars.size());
    for (const auto &[name, v] : build.vars) {
        if (v.kind == Named::INT)
            out.emplace_back(name, SolutionIntegerValue(response, v.i));
        else if (v.kind == Named::BOOL)
            out.emplace_back(name, SolutionBooleanValue(response, v.b) ? 1 : 0);
    }
    return out;
}

/* Builds the model from the East value and the solver parameters from the
 * config; `enumerate` (solve_all) collects every feasible solution the solver
 * finds, up to `max_solutions`. */
struct Solved {
    CpSolverResponse response;
    double wall_time;
    std::vector<std::pair<Assignments, double> > collected; /* assignments, objective */
};

Solved build_and_solve(const char *fn, EastValue *model_data, EastValue *config, bool enumerate,
                       size_t max_solutions)
{
    Build build{fn, CpModelBuilder(), {}};

    EastValue *int_vars = field(model_data, "int_vars", fn);
    for (size_t i = 0, n = length(int_vars, fn); i < n; i++) {
        EastValue *v = at(int_vars, i);
        std::string name(as_string(field(v, "name", fn), fn));
        int64_t lb = as_integer(field(v, "lower_bound", fn), fn);
        int64_t ub = as_integer(field(v, "upper_bound", fn), fn);
        Named named{Named::INT, build.model.NewIntVar(Domain(lb, ub)).WithName(name), BoolVar(),
                    IntervalVar()};
        build.vars[name] = named;
    }
    EastValue *bool_vars = field(model_data, "bool_vars", fn);
    for (size_t i = 0, n = length(bool_vars, fn); i < n; i++) {
        std::string name(as_string(field(at(bool_vars, i), "name", fn), fn));
        Named named{Named::BOOL, IntVar(), build.model.NewBoolVar().WithName(name), IntervalVar()};
        build.vars[name] = named;
    }
    build.add_intervals(field(model_data, "interval_vars", fn));
    build.add_constraints(field(model_data, "constraints", fn));

    if (EastValue *objective = some_value(field(model_data, "objective", fn), fn)) {
        LinearExpr expr = build.linear(payload(objective));
        if (is_case(objective, "minimize", fn))
            build.model.Minimize(expr);
        else
            build.model.Maximize(expr);
    }

    /* A partial hint: unknown names and interval variables skipped, a name
     * given twice collapsed to its last value. */
    if (EastValue *hints = some_value(field(config, "hints", fn), fn)) {
        std::vector<std::pair<std::string, int64_t> > order;
        std::unordered_map<std::string, size_t> index;
        for (size_t i = 0, n = length(hints, fn); i < n; i++) {
            EastValue *h = at(hints, i);
            std::string name(as_string(field(h, "var", fn), fn));
            int64_t value = as_integer(field(h, "value", fn), fn);
            auto it = index.find(name);
            if (it == index.end()) {
                index[name] = order.size();
                order.emplace_back(name, value);
            } else {
                order[it->second].second = value;
            }
        }
        for (const auto &[name, value] : order) {
            auto it = build.vars.find(name);
            if (it == build.vars.end()) continue;
            if (it->second.kind == Named::INT)
                build.model.AddHint(it->second.i, value);
            else if (it->second.kind == Named::BOOL)
                build.model.AddHint(it->second.b, value != 0);
        }
    }

    SatParameters params = sat_params(config, fn);
    if (enumerate) params.set_enumerate_all_solutions(true);

    operations_research::sat::Model model;
    Solved result;
    std::atomic<bool> stop(false);
    if (enumerate) {
        model.GetOrCreate<operations_research::TimeLimit>()->RegisterExternalBooleanAsLimit(&stop);
        model.Add(
            operations_research::sat::NewFeasibleSolutionObserver([&](const CpSolverResponse &r) {
                if (result.collected.size() >= max_solutions) {
                    stop = true;
                    return;
                }
                result.collected.emplace_back(assignments_of(r, build), r.objective_value());
            }));
    }
    model.Add(operations_research::sat::NewSatParameters(params));

    Clock::time_point t0 = now();
    result.response = operations_research::sat::SolveCpModel(build.model.Build(), &model);
    result.wall_time = seconds_since(t0);
    if (!enumerate || (result.collected.empty() && solved(result.response.status())))
        result.collected.emplace_back(assignments_of(result.response, build),
                                      result.response.objective_value());
    return result;
}

/* A CpSatResultType value of the declared type. */
EastValue *result_struct(EastType *result_t, const char *fn, const char *status_tag,
                         const Assignments *assignments, double objective, double wall_time)
{
    EastType *status_t = field_type(result_t, "status", fn);
    EastType *objective_t = field_type(result_t, "objective_value", fn);
    EastType *assignments_t = field_type(result_t, "assignments", fn);
    EastValue *dict_value = dict(assignments_t, fn);
    if (assignments)
        for (const auto &[name, value] : *assignments)
            dict_put(dict_value, string(name), east_integer(value));
    StructBuilder r(result_t, fn);
    r.set("status", status(status_t, status_tag));
    r.set("objective_value",
          assignments ? some(objective_t, east_float(objective)) : none(objective_t));
    r.set("assignments", dict_value);
    r.set("wall_time", east_float(wall_time));
    return r.build();
}

EvalResult cpsat_solve(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_cpsat_solve";
    if (num_args != 2) throw Error(msg(fn, "takes a model and a config"));
    Solved result = build_and_solve(fn, args[0], args[1], false, 0);
    CpSolverStatus st = result.response.status();
    return eval_ok(result_struct(out, fn, status_tag(st),
                                 solved(st) ? &result.collected[0].first : nullptr,
                                 result.collected[0].second, result.wall_time));
}

EvalResult cpsat_solve_all(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_cpsat_solve_all";
    if (num_args != 2) throw Error(msg(fn, "takes a model and a config"));
    int64_t max_solutions = 100;
    if (EastValue *v = some_value(field(args[1], "max_solutions", fn), fn))
        max_solutions = as_integer(v, fn);
    Solved result = build_and_solve(fn, args[0], args[1], true,
                                    max_solutions < 0 ? 0 : static_cast<size_t>(max_solutions));
    EastType *result_t = element_type(out, fn);
    EastValue *results = array(out, fn, result.collected.size());
    /* Every solution the observer collected is `feasible`; the one the solver
     * answered with instead (none observed, the fallback) carries its status.
     * The last carries the whole solve's time, the rest 0. */
    bool from_observer = !(result.collected.size() == 1 && solved(result.response.status()));
    for (size_t i = 0; i < result.collected.size(); i++) {
        bool last = i + 1 == result.collected.size();
        const char *tag = from_observer ? "feasible" : status_tag(result.response.status());
        push(results, result_struct(result_t, fn, tag, &result.collected[i].first,
                                    result.collected[i].second, last ? result.wall_time : 0.0));
    }
    return eval_ok(results);
}

/* The columnar form: the variables by index and the linear constraints by
 * rows, from the vectors; the other constraint kinds and the intervals over
 * the variables `names` names; the variables' values by index. */
EvalResult cpsat_solve_columns(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_cpsat_solve_columns";
    if (num_args != 2) throw Error(msg(fn, "takes a model and a config"));
    EastValue *model_data = args[0];
    EastValue *config = args[1];
    EastType *status_t = field_type(out, "status", fn);
    EastType *objective_t = field_type(out, "objective_value", fn);

    std::vector<int64_t> var_lower = vector_integers(field(model_data, "var_lower", fn), fn);
    std::vector<int64_t> var_upper = vector_integers(field(model_data, "var_upper", fn), fn);
    std::vector<int64_t> row_lower = vector_integers(field(model_data, "row_lower", fn), fn);
    std::vector<int64_t> row_upper = vector_integers(field(model_data, "row_upper", fn), fn);
    std::vector<int64_t> row_ptr = vector_integers(field(model_data, "row_ptr", fn), fn);
    std::vector<int64_t> col_ix = vector_integers(field(model_data, "col_ix", fn), fn);
    std::vector<int64_t> coeff = vector_integers(field(model_data, "coeff", fn), fn);

    size_t n_vars = var_lower.size();
    if (var_upper.size() != n_vars)
        throw Error(msg(fn, "var_lower has " + std::to_string(n_vars) +
                                " entries but var_upper has " + std::to_string(var_upper.size())));
    size_t n_rows = row_lower.size();
    if (row_upper.size() != n_rows)
        throw Error(msg(fn, "row_lower has " + std::to_string(n_rows) +
                                " entries but row_upper has " + std::to_string(row_upper.size())));
    check_rows(fn, n_vars, row_ptr, col_ix, coeff.size(), n_rows);

    Build build{fn, CpModelBuilder(), {}};
    std::vector<IntVar> vars(n_vars);
    for (size_t i = 0; i < n_vars; i++)
        vars[i] = build.model.NewIntVar(Domain(var_lower[i], var_upper[i]));
    for (size_t r = 0; r < n_rows; r++) {
        LinearExpr expr;
        for (int64_t k = row_ptr[r]; k < row_ptr[r + 1]; k++)
            expr += LinearExpr::Term(vars[static_cast<size_t>(col_ix[static_cast<size_t>(k)])],
                                     coeff[static_cast<size_t>(k)]);
        build.model.AddLinearConstraint(expr, Domain(row_lower[r], row_upper[r]));
    }

    if (EastValue *objective = some_value(field(model_data, "objective", fn), fn)) {
        std::vector<int64_t> obj = vector_integers(field(objective, "coeff", fn), fn);
        if (obj.size() != n_vars)
            throw Error(msg(fn, "the objective has " + std::to_string(obj.size()) +
                                    " coefficients but there are " + std::to_string(n_vars) +
                                    " variables"));
        LinearExpr expr;
        for (size_t i = 0; i < n_vars; i++)
            if (obj[i] != 0) expr += LinearExpr::Term(vars[i], obj[i]);
        if (as_boolean(field(objective, "maximize", fn), fn))
            build.model.Maximize(expr);
        else
            build.model.Minimize(expr);
    }

    /* The named constraints and intervals, over the variables `names` names. */
    EastValue *interval_vars = field(model_data, "interval_vars", fn);
    EastValue *constraints = field(model_data, "constraints", fn);
    if (EastValue *names = some_value(field(model_data, "names", fn), fn)) {
        size_t count = length(names, fn);
        if (count != n_vars)
            throw Error(msg(fn, "names has " + std::to_string(count) + " entries but there are " +
                                    std::to_string(n_vars) + " variables"));
        for (size_t i = 0; i < n_vars; i++) {
            Named named{Named::INT, vars[i], BoolVar(), IntervalVar()};
            build.vars[std::string(as_string(at(names, i), fn))] = named;
        }
    } else if (length(interval_vars, fn) > 0 || length(constraints, fn) > 0) {
        throw Error(
            msg(fn, "the interval variables and constraints name variables, but names is none"));
    }
    build.add_intervals(interval_vars);
    build.add_constraints(constraints);

    /* A partial hint by index: an index outside the model dropped, one given
     * twice kept at its last value. */
    if (EastValue *hints = some_value(field(config, "hints", fn), fn)) {
        std::vector<int64_t> index = vector_integers(field(hints, "index", fn), fn);
        std::vector<int64_t> value = vector_integers(field(hints, "value", fn), fn);
        std::vector<std::pair<int64_t, int64_t> > kept;
        std::unordered_map<int64_t, size_t> at_index;
        for (size_t k = 0; k < index.size() && k < value.size(); k++) {
            if (index[k] < 0 || index[k] >= static_cast<int64_t>(n_vars)) continue;
            auto it = at_index.find(index[k]);
            if (it == at_index.end()) {
                at_index[index[k]] = kept.size();
                kept.emplace_back(index[k], value[k]);
            } else {
                kept[it->second].second = value[k];
            }
        }
        for (const auto &[i, v] : kept)
            build.model.AddHint(vars[static_cast<size_t>(i)], v);
    }

    operations_research::sat::Model model;
    model.Add(operations_research::sat::NewSatParameters(sat_params(config, fn)));
    Clock::time_point t0 = now();
    CpSolverResponse response = operations_research::sat::SolveCpModel(build.model.Build(), &model);
    double wall_time = seconds_since(t0);

    std::vector<int64_t> values;
    EastValue *objective_value = nullptr;
    if (solved(response.status())) {
        values.resize(n_vars);
        for (size_t i = 0; i < n_vars; i++)
            values[i] = SolutionIntegerValue(response, vars[i]);
        objective_value = some(objective_t, east_float(response.objective_value()));
    } else {
        objective_value = none(objective_t);
    }

    StructBuilder r(out, fn);
    r.set("status", status(status_t, status_tag(response.status())));
    r.set("objective_value", objective_value);
    r.set("values", integer_vector(values));
    r.set("wall_time", east_float(wall_time));
    return eval_ok(r.build());
}

} // namespace

namespace east_ds
{

void register_google_or_cpsat(PlatformRegistry *reg)
{
    platform_registry_add(reg, "google_or_cpsat_solve", &platform_call<cpsat_solve>, false);
    platform_registry_add(reg, "google_or_cpsat_solve_all", &platform_call<cpsat_solve_all>, false);
    platform_registry_add(reg, "google_or_cpsat_solve_columns", &platform_call<cpsat_solve_columns>,
                          false);
}

} // namespace east_ds
