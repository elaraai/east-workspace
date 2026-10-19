/*
 * google_or_routing_solve: vehicle routing (TSP, CVRP, VRPTW, VRPPD) on
 * OR-Tools' routing library, built straight from the East model.
 */
#include "google_or.h"

#include "ortools/constraint_solver/routing.h"
#include "ortools/constraint_solver/routing_enums.pb.h"
#include "ortools/constraint_solver/routing_index_manager.h"
#include "ortools/constraint_solver/routing_parameters.h"
#include "ortools/constraint_solver/routing_parameters.pb.h"

#include <string>
#include <vector>

namespace
{

using namespace east_ds;
using operations_research::Assignment;
using operations_research::FirstSolutionStrategy;
using operations_research::LocalSearchMetaheuristic;
using operations_research::RoutingDimension;
using operations_research::RoutingIndexManager;
using operations_research::RoutingModel;
using operations_research::RoutingSearchParameters;
using operations_research::RoutingSearchStatus;

const char *const FN = "google_or_routing_solve";

using Matrix = std::vector<std::vector<int64_t> >;

Matrix matrix(EastValue *rows)
{
    Matrix out;
    size_t n = length(rows, FN);
    out.reserve(n);
    for (size_t i = 0; i < n; i++)
        out.push_back(integers(at(rows, i), FN));
    return out;
}

FirstSolutionStrategy::Value first_solution(EastValue *strategy)
{
    if (!strategy) return FirstSolutionStrategy::PATH_CHEAPEST_ARC;
    const char *tag = case_of(strategy, FN);
    if (std::strcmp(tag, "savings") == 0) return FirstSolutionStrategy::SAVINGS;
    if (std::strcmp(tag, "christofides") == 0) return FirstSolutionStrategy::CHRISTOFIDES;
    if (std::strcmp(tag, "parallel_cheapest_insertion") == 0)
        return FirstSolutionStrategy::PARALLEL_CHEAPEST_INSERTION;
    if (std::strcmp(tag, "local_cheapest_insertion") == 0)
        return FirstSolutionStrategy::LOCAL_CHEAPEST_INSERTION;
    if (std::strcmp(tag, "first_unbound_min_value") == 0)
        return FirstSolutionStrategy::FIRST_UNBOUND_MIN_VALUE;
    return FirstSolutionStrategy::PATH_CHEAPEST_ARC;
}

bool metaheuristic(EastValue *choice, LocalSearchMetaheuristic::Value *out)
{
    if (!choice) return false;
    const char *tag = case_of(choice, FN);
    if (std::strcmp(tag, "greedy_descent") == 0) {
        *out = LocalSearchMetaheuristic::GREEDY_DESCENT;
    } else if (std::strcmp(tag, "guided_local_search") == 0) {
        *out = LocalSearchMetaheuristic::GUIDED_LOCAL_SEARCH;
    } else if (std::strcmp(tag, "simulated_annealing") == 0) {
        *out = LocalSearchMetaheuristic::SIMULATED_ANNEALING;
    } else if (std::strcmp(tag, "tabu_search") == 0) {
        *out = LocalSearchMetaheuristic::TABU_SEARCH;
    } else {
        return false;
    }
    return true;
}

EvalResult routing_solve(EastValue **args, size_t num_args, EastType *out)
{
    if (num_args != 2) throw Error(msg(FN, "takes a model and a config"));
    Clock::time_point t0 = now();
    EastValue *model_data = args[0];
    EastValue *config = args[1];
    EastType *status_t = field_type(out, "status", FN);
    EastType *routes_t = field_type(out, "routes", FN);
    EastType *route_t = element_type(routes_t, FN);
    EastType *nodes_t = field_type(route_t, "nodes", FN);

    Matrix distance = matrix(field(model_data, "distance_matrix", FN));
    int num_vehicles = static_cast<int>(as_integer(field(model_data, "num_vehicles", FN), FN));
    int depot = static_cast<int>(as_integer(field(model_data, "depot", FN), FN));
    int num_nodes = static_cast<int>(distance.size());

    RoutingIndexManager manager(num_nodes, num_vehicles, RoutingIndexManager::NodeIndex(depot));
    RoutingModel routing(manager);

    auto node_of = [&](int64_t index) -> size_t {
        return static_cast<size_t>(manager.IndexToNode(index).value());
    };
    int transit = routing.RegisterTransitCallback(
        [&](int64_t from, int64_t to) -> int64_t { return distance[node_of(from)][node_of(to)]; });
    routing.SetArcCostEvaluatorOfAllVehicles(transit);

    /* Capacities: a dimension of the demands, when both are given. */
    EastValue *demands_opt = some_value(field(model_data, "demands", FN), FN);
    EastValue *capacities_opt = some_value(field(model_data, "vehicle_capacities", FN), FN);
    std::vector<int64_t> demands, capacities;
    if (demands_opt && capacities_opt) {
        demands = integers(demands_opt, FN);
        capacities = integers(capacities_opt, FN);
        int demand = routing.RegisterUnaryTransitCallback(
            [&](int64_t from) -> int64_t { return demands[node_of(from)]; });
        routing.AddDimensionWithVehicleCapacity(demand, 0, capacities, true, "Capacity");
    }

    /* Time windows: a dimension of the travel times, when both are given. */
    EastValue *time_matrix_opt = some_value(field(model_data, "time_matrix", FN), FN);
    EastValue *time_windows_opt = some_value(field(model_data, "time_windows", FN), FN);
    Matrix times;
    if (time_matrix_opt && time_windows_opt) {
        times = matrix(time_matrix_opt);
        int time = routing.RegisterTransitCallback(
            [&](int64_t from, int64_t to) -> int64_t { return times[node_of(from)][node_of(to)]; });
        size_t n = length(time_windows_opt, FN);
        int64_t max_time = 0;
        for (size_t i = 0; i < n; i++) {
            int64_t end = as_integer(field(at(time_windows_opt, i), "end", FN), FN);
            if (end > max_time) max_time = end;
        }
        routing.AddDimension(time, max_time, max_time, false, "Time");
        const RoutingDimension &dimension = routing.GetDimensionOrDie("Time");
        for (size_t i = 0; i < n; i++) {
            EastValue *tw = at(time_windows_opt, i);
            int64_t index =
                manager.NodeToIndex(RoutingIndexManager::NodeIndex(static_cast<int>(i)));
            dimension.CumulVar(index)->SetRange(as_integer(field(tw, "start", FN), FN),
                                                as_integer(field(tw, "end", FN), FN));
        }
    }

    /* Pickup and delivery pairs, each served by one vehicle in that order. */
    if (EastValue *pairs = some_value(field(model_data, "pickup_deliveries", FN), FN)) {
        for (size_t i = 0, n = length(pairs, FN); i < n; i++) {
            EastValue *pd = at(pairs, i);
            int64_t pickup = manager.NodeToIndex(RoutingIndexManager::NodeIndex(
                static_cast<int>(as_integer(field(pd, "pickup", FN), FN))));
            int64_t delivery = manager.NodeToIndex(RoutingIndexManager::NodeIndex(
                static_cast<int>(as_integer(field(pd, "delivery", FN), FN))));
            routing.AddPickupAndDelivery(pickup, delivery);
            routing.solver()->AddConstraint(routing.solver()->MakeEquality(
                routing.VehicleVar(pickup), routing.VehicleVar(delivery)));
        }
    }

    RoutingSearchParameters params = operations_research::DefaultRoutingSearchParameters();
    params.set_first_solution_strategy(
        first_solution(some_value(field(config, "first_solution", FN), FN)));
    LocalSearchMetaheuristic::Value meta;
    if (metaheuristic(some_value(field(config, "metaheuristic", FN), FN), &meta))
        params.set_local_search_metaheuristic(meta);
    if (EastValue *max_time = some_value(field(config, "max_time_seconds", FN), FN))
        params.mutable_time_limit()->set_seconds(static_cast<int64_t>(as_float(max_time, FN)));

    /* The build ends where the solver starts. */
    double build_time = seconds_since(t0);
    Clock::time_point t1 = now();
    const Assignment *solution = routing.SolveWithParameters(params);
    double solve_time = seconds_since(t1);

    if (!solution) {
        StructBuilder r(out, FN);
        r.set("status", status(status_t, "not_solved"));
        r.set("total_distance", east_integer(0));
        r.set("routes", array(routes_t, FN));
        r.set("build_time", east_float(build_time));
        r.set("solve_time", east_float(solve_time));
        r.set("wall_time", east_float(seconds_since(t0)));
        return eval_ok(r.build());
    }

    EastValue *routes = array(routes_t, FN, static_cast<size_t>(num_vehicles));
    int64_t total_distance = 0;
    for (int vehicle = 0; vehicle < num_vehicles; vehicle++) {
        std::vector<int64_t> nodes;
        int64_t route_distance = 0;
        int64_t index = routing.Start(vehicle);
        while (!routing.IsEnd(index)) {
            nodes.push_back(static_cast<int64_t>(node_of(index)));
            int64_t previous = index;
            index = solution->Value(routing.NextVar(index));
            route_distance += routing.GetArcCostForVehicle(previous, index, vehicle);
        }
        nodes.push_back(static_cast<int64_t>(node_of(index)));
        total_distance += route_distance;
        StructBuilder route(route_t, FN);
        route.set("vehicle", east_integer(vehicle));
        route.set("nodes", integer_array(nodes_t, nodes, FN));
        route.set("distance", east_integer(route_distance));
        push(routes, route.build());
    }

    const char *tag = "not_solved";
    switch (routing.status()) {
    case RoutingSearchStatus::ROUTING_SUCCESS:
        tag = "feasible";
        break;
    case RoutingSearchStatus::ROUTING_OPTIMAL:
        tag = "optimal";
        break;
    case RoutingSearchStatus::ROUTING_INFEASIBLE:
        tag = "infeasible";
        break;
    default:
        break;
    }

    StructBuilder r(out, FN);
    r.set("status", status(status_t, tag));
    r.set("total_distance", east_integer(total_distance));
    r.set("routes", routes);
    r.set("build_time", east_float(build_time));
    r.set("solve_time", east_float(solve_time));
    r.set("wall_time", east_float(seconds_since(t0)));
    return eval_ok(r.build());
}

} // namespace

namespace east_ds
{

void register_google_or_routing(PlatformRegistry *reg)
{
    platform_registry_add(reg, "google_or_routing_solve", &platform_call<routing_solve>, false);
}

} // namespace east_ds
