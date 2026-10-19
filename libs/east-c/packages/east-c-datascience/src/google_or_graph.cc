/*
 * The graph algorithms: google_or_min_cost_flow, google_or_max_flow,
 * google_or_assignment and google_or_min_cost_assignment on OR-Tools'
 * SimpleMinCostFlow, SimpleMaxFlow and SimpleLinearSumAssignment.
 */
#include "google_or.h"

#include "ortools/graph/assignment.h"
#include "ortools/graph/max_flow.h"
#include "ortools/graph/min_cost_flow.h"

#include <algorithm>
#include <string>
#include <vector>

namespace
{

using namespace east_ds;
using operations_research::SimpleLinearSumAssignment;
using operations_research::SimpleMaxFlow;
using operations_research::SimpleMinCostFlow;

/* A flow result: the status, the objective and the per-arc flows. */
EvalResult flow_result(EastType *out, const char *fn, const char *total_field, const char *tag,
                       int64_t total, const std::vector<int64_t> &flows, double wall_time)
{
    StructBuilder r(out, fn);
    r.set("status", status(field_type(out, "status", fn), tag));
    r.set(total_field, east_integer(total));
    r.set("flows", integer_array(field_type(out, "flows", fn), flows, fn));
    r.set("wall_time", east_float(wall_time));
    return eval_ok(r.build());
}

EvalResult min_cost_flow(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_min_cost_flow";
    if (num_args != 1) throw Error(msg(fn, "takes a network"));
    Clock::time_point t0 = now();
    EastValue *input = args[0];
    std::vector<int64_t> start_nodes = integers(field(input, "start_nodes", fn), fn);
    std::vector<int64_t> end_nodes = integers(field(input, "end_nodes", fn), fn);
    std::vector<int64_t> capacities = integers(field(input, "capacities", fn), fn);
    std::vector<int64_t> unit_costs = integers(field(input, "unit_costs", fn), fn);
    std::vector<int64_t> supplies = integers(field(input, "supplies", fn), fn);
    size_t n =
        std::min({start_nodes.size(), end_nodes.size(), capacities.size(), unit_costs.size()});

    SimpleMinCostFlow smcf;
    for (size_t i = 0; i < n; i++)
        smcf.AddArcWithCapacityAndUnitCost(static_cast<int>(start_nodes[i]),
                                           static_cast<int>(end_nodes[i]), capacities[i],
                                           unit_costs[i]);
    for (size_t i = 0; i < supplies.size(); i++)
        smcf.SetNodeSupply(static_cast<int>(i), supplies[i]);

    SimpleMinCostFlow::Status st = smcf.Solve();
    double wall_time = seconds_since(t0);
    if (st == SimpleMinCostFlow::OPTIMAL || st == SimpleMinCostFlow::FEASIBLE) {
        std::vector<int64_t> flows(static_cast<size_t>(smcf.NumArcs()));
        for (size_t i = 0; i < flows.size(); i++)
            flows[i] = smcf.Flow(static_cast<int>(i));
        return flow_result(out, fn, "total_cost",
                           st == SimpleMinCostFlow::OPTIMAL ? "optimal" : "feasible",
                           smcf.OptimalCost(), flows, wall_time);
    }
    return flow_result(out, fn, "total_cost",
                       st == SimpleMinCostFlow::INFEASIBLE ? "infeasible" : "not_solved", 0, {},
                       wall_time);
}

EvalResult max_flow(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_max_flow";
    if (num_args != 1) throw Error(msg(fn, "takes a network"));
    Clock::time_point t0 = now();
    EastValue *input = args[0];
    std::vector<int64_t> start_nodes = integers(field(input, "start_nodes", fn), fn);
    std::vector<int64_t> end_nodes = integers(field(input, "end_nodes", fn), fn);
    std::vector<int64_t> capacities = integers(field(input, "capacities", fn), fn);
    int source = static_cast<int>(as_integer(field(input, "source", fn), fn));
    int sink = static_cast<int>(as_integer(field(input, "sink", fn), fn));
    size_t n = std::min({start_nodes.size(), end_nodes.size(), capacities.size()});

    SimpleMaxFlow smf;
    for (size_t i = 0; i < n; i++)
        smf.AddArcWithCapacity(static_cast<int>(start_nodes[i]), static_cast<int>(end_nodes[i]),
                               capacities[i]);

    SimpleMaxFlow::Status st = smf.Solve(source, sink);
    double wall_time = seconds_since(t0);
    if (st == SimpleMaxFlow::OPTIMAL) {
        std::vector<int64_t> flows(static_cast<size_t>(smf.NumArcs()));
        for (size_t i = 0; i < flows.size(); i++)
            flows[i] = smf.Flow(static_cast<int>(i));
        return flow_result(out, fn, "total_flow", "optimal", smf.OptimalFlow(), flows, wall_time);
    }
    return flow_result(out, fn, "total_flow", "not_solved", 0, {}, wall_time);
}

/* An assignment result: the status, the total and the matched pairs. */
struct Match {
    int64_t worker, task, cost;
};

EvalResult assignment_result(EastType *out, const char *fn, const char *tag, int64_t total,
                             const std::vector<Match> &matches, double wall_time)
{
    EastType *matches_t = field_type(out, "assignments", fn);
    EastType *match_t = element_type(matches_t, fn);
    EastValue *array_value = array(matches_t, fn, matches.size());
    for (const Match &m : matches) {
        StructBuilder match(match_t, fn);
        match.set("worker", east_integer(m.worker));
        match.set("task", east_integer(m.task));
        match.set("cost", east_integer(m.cost));
        push(array_value, match.build());
    }
    StructBuilder r(out, fn);
    r.set("status", status(field_type(out, "status", fn), tag));
    r.set("total_cost", east_integer(total));
    r.set("assignments", array_value);
    r.set("wall_time", east_float(wall_time));
    return eval_ok(r.build());
}

EvalResult assignment(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_assignment";
    if (num_args != 1) throw Error(msg(fn, "takes a cost matrix"));
    Clock::time_point t0 = now();
    EastValue *costs = field(args[0], "costs", fn);
    size_t num_workers = length(costs, fn);
    if (num_workers == 0) return assignment_result(out, fn, "optimal", 0, {}, seconds_since(t0));

    SimpleLinearSumAssignment solver;
    for (size_t worker = 0; worker < num_workers; worker++) {
        EastValue *row = at(costs, worker);
        for (size_t task = 0, m = length(row, fn); task < m; task++)
            solver.AddArcWithCost(static_cast<int>(worker), static_cast<int>(task),
                                  as_integer(at(row, task), fn));
    }

    SimpleLinearSumAssignment::Status st = solver.Solve();
    double wall_time = seconds_since(t0);
    if (st == SimpleLinearSumAssignment::OPTIMAL) {
        std::vector<Match> matches;
        int64_t total = 0;
        for (int worker = 0; worker < solver.NumNodes(); worker++) {
            int64_t cost = solver.AssignmentCost(worker);
            total += cost;
            matches.push_back({worker, solver.RightMate(worker), cost});
        }
        return assignment_result(out, fn, "optimal", total, matches, wall_time);
    }
    return assignment_result(
        out, fn, st == SimpleLinearSumAssignment::INFEASIBLE ? "infeasible" : "not_solved", 0, {},
        wall_time);
}

EvalResult min_cost_assignment(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "google_or_min_cost_assignment";
    if (num_args != 1) throw Error(msg(fn, "takes the candidate arcs"));
    Clock::time_point t0 = now();
    EastValue *input = args[0];
    std::vector<int64_t> arc_workers = integers(field(input, "workers", fn), fn);
    std::vector<int64_t> arc_tasks = integers(field(input, "tasks", fn), fn);
    std::vector<int64_t> arc_costs = integers(field(input, "costs", fn), fn);

    if (!(arc_workers.size() == arc_tasks.size() && arc_tasks.size() == arc_costs.size()))
        throw Error(msg(fn, "workers, tasks and costs must be parallel arrays of equal length; "
                            "got " +
                                std::to_string(arc_workers.size()) + ", " +
                                std::to_string(arc_tasks.size()) + " and " +
                                std::to_string(arc_costs.size()) + "."));
    for (size_t i = 0; i < arc_workers.size(); i++)
        if (arc_workers[i] < 0 || arc_tasks[i] < 0)
            throw Error(msg(fn, "worker and task ids must be non-negative 0-based indices."));

    EastValue *penalty_opt = some_value(field(input, "unassigned_penalty", fn), fn);
    EastValue *capacity_opt = some_value(field(input, "task_capacity", fn), fn);
    std::vector<int64_t> penalties, capacities;
    if (penalty_opt) penalties = integers(penalty_opt, fn);
    if (capacity_opt) capacities = integers(capacity_opt, fn);

    /* A worker with no legal arc still occupies a slot in the network, so the
     * counts span the penalty and capacity arrays as well as the arcs. */
    int64_t num_workers = penalty_opt ? static_cast<int64_t>(penalties.size()) : 0;
    for (int64_t w : arc_workers)
        num_workers = std::max(num_workers, w + 1);
    int64_t num_tasks = capacity_opt ? static_cast<int64_t>(capacities.size()) : 0;
    for (int64_t t : arc_tasks)
        num_tasks = std::max(num_tasks, t + 1);

    if (penalty_opt && static_cast<int64_t>(penalties.size()) < num_workers)
        throw Error(msg(fn, "unassigned_penalty has " + std::to_string(penalties.size()) +
                                " entries but the arcs reference " + std::to_string(num_workers) +
                                " workers."));
    if (capacity_opt) {
        if (static_cast<int64_t>(capacities.size()) < num_tasks)
            throw Error(msg(fn, "task_capacity has " + std::to_string(capacities.size()) +
                                    " entries but the arcs reference " + std::to_string(num_tasks) +
                                    " tasks."));
        for (int64_t c : capacities)
            if (c < 0) throw Error(msg(fn, "task_capacity entries must be non-negative."));
    }

    if (num_workers == 0) return assignment_result(out, fn, "optimal", 0, {}, seconds_since(t0));

    /* Node layout: source 0 | workers [1, task_base) | tasks [task_base, sink) | sink */
    int task_base = static_cast<int>(1 + num_workers);
    int sink = static_cast<int>(task_base + num_tasks);

    SimpleMinCostFlow smcf;
    for (int64_t worker = 0; worker < num_workers; worker++)
        smcf.AddArcWithCapacityAndUnitCost(0, static_cast<int>(1 + worker), 1, 0);
    std::vector<int> arc_ids;
    arc_ids.reserve(arc_workers.size());
    for (size_t i = 0; i < arc_workers.size(); i++)
        arc_ids.push_back(smcf.AddArcWithCapacityAndUnitCost(
            static_cast<int>(1 + arc_workers[i]), static_cast<int>(task_base + arc_tasks[i]), 1,
            arc_costs[i]));
    for (int64_t task = 0; task < num_tasks; task++)
        smcf.AddArcWithCapacityAndUnitCost(static_cast<int>(task_base + task), sink,
                                           capacity_opt ? capacities[static_cast<size_t>(task)] : 1,
                                           0);
    if (penalty_opt)
        for (int64_t worker = 0; worker < num_workers; worker++)
            smcf.AddArcWithCapacityAndUnitCost(static_cast<int>(1 + worker), sink, 1,
                                               penalties[static_cast<size_t>(worker)]);
    smcf.SetNodeSupply(0, num_workers);
    smcf.SetNodeSupply(sink, -num_workers);

    SimpleMinCostFlow::Status st = smcf.Solve();
    double wall_time = seconds_since(t0);
    if (st == SimpleMinCostFlow::OPTIMAL || st == SimpleMinCostFlow::FEASIBLE) {
        std::vector<Match> matches;
        for (size_t i = 0; i < arc_ids.size(); i++)
            if (smcf.Flow(arc_ids[i]) > 0)
                matches.push_back({arc_workers[i], arc_tasks[i], arc_costs[i]});
        return assignment_result(out, fn, st == SimpleMinCostFlow::OPTIMAL ? "optimal" : "feasible",
                                 smcf.OptimalCost(), matches, wall_time);
    }
    return assignment_result(out, fn,
                             st == SimpleMinCostFlow::INFEASIBLE ? "infeasible" : "not_solved", 0,
                             {}, wall_time);
}

} // namespace

namespace east_ds
{

void register_google_or_graph(PlatformRegistry *reg)
{
    platform_registry_add(reg, "google_or_min_cost_flow", &platform_call<min_cost_flow>, false);
    platform_registry_add(reg, "google_or_max_flow", &platform_call<max_flow>, false);
    platform_registry_add(reg, "google_or_assignment", &platform_call<assignment>, false);
    platform_registry_add(reg, "google_or_min_cost_assignment", &platform_call<min_cost_assignment>,
                          false);
}

} // namespace east_ds
