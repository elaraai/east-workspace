#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Vehicle routing solver platform functions for East.

Provides vehicle routing problem (VRP) solving using Google OR-Tools' routing
library for East programs running in Python.

Supports:
- Traveling Salesman Problem (TSP) — single vehicle, all nodes
- Capacitated VRP (CVRP) — vehicles with capacity limits
- VRP with Time Windows (VRPTW) — time constraints per node
- VRP with Pickup and Delivery (VRPPD) — paired pickup/delivery stops
"""

import importlib.util
import time

from east.runtime.platform import PlatformFunction
from east.types.types import (
    ArrayType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StructType,
    VariantType,
)
from east.types.values import EastArray, EastStruct, EastVariant

from east_py_datascience.google_or.types import GoogleOrStatusType, _get_option

# ============================================================================
# Type Definitions
# ============================================================================

RoutingFirstSolutionType = VariantType(
    [
        ("path_cheapest_arc", NullType),
        ("savings", NullType),
        ("christofides", NullType),
        ("parallel_cheapest_insertion", NullType),
        ("local_cheapest_insertion", NullType),
        ("first_unbound_min_value", NullType),
    ]
)

RoutingMetaheuristicType = VariantType(
    [
        ("greedy_descent", NullType),
        ("guided_local_search", NullType),
        ("simulated_annealing", NullType),
        ("tabu_search", NullType),
    ]
)

RoutingTimeWindowType = StructType(
    [
        ("start", IntegerType),
        ("end", IntegerType),
    ]
)

RoutingPickupDeliveryType = StructType(
    [
        ("pickup", IntegerType),
        ("delivery", IntegerType),
    ]
)

RoutingModelType = StructType(
    [
        ("distance_matrix", ArrayType(ArrayType(IntegerType))),
        ("num_vehicles", IntegerType),
        ("depot", IntegerType),
        ("demands", OptionType(ArrayType(IntegerType))),
        ("vehicle_capacities", OptionType(ArrayType(IntegerType))),
        ("time_matrix", OptionType(ArrayType(ArrayType(IntegerType)))),
        ("time_windows", OptionType(ArrayType(RoutingTimeWindowType))),
        ("pickup_deliveries", OptionType(ArrayType(RoutingPickupDeliveryType))),
    ]
)

RoutingConfigType = StructType(
    [
        ("first_solution", OptionType(RoutingFirstSolutionType)),
        ("metaheuristic", OptionType(RoutingMetaheuristicType)),
        ("max_time_seconds", OptionType(FloatType)),
    ]
)

RoutingRouteType = StructType(
    [
        ("vehicle", IntegerType),
        ("nodes", ArrayType(IntegerType)),
        ("distance", IntegerType),
    ]
)

RoutingResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_distance", IntegerType),
        ("routes", ArrayType(RoutingRouteType)),
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


def _get_first_solution_strategy(strategy: EastVariant | None) -> int:
    """Map RoutingFirstSolution variant to OR-Tools enum."""
    from ortools.constraint_solver import routing_enums_pb2

    if strategy is None:
        return routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC

    strategy_map = {
        "path_cheapest_arc": routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC,
        "savings": routing_enums_pb2.FirstSolutionStrategy.SAVINGS,
        "christofides": routing_enums_pb2.FirstSolutionStrategy.CHRISTOFIDES,
        "parallel_cheapest_insertion": routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION,
        "local_cheapest_insertion": routing_enums_pb2.FirstSolutionStrategy.LOCAL_CHEAPEST_INSERTION,
        "first_unbound_min_value": routing_enums_pb2.FirstSolutionStrategy.FIRST_UNBOUND_MIN_VALUE,
    }
    return strategy_map.get(
        strategy.type,
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC,
    )


def _get_metaheuristic(metaheuristic: EastVariant | None) -> int | None:
    """Map RoutingMetaheuristic variant to OR-Tools enum."""
    from ortools.constraint_solver import routing_enums_pb2

    if metaheuristic is None:
        return None

    metaheuristic_map = {
        "greedy_descent": routing_enums_pb2.LocalSearchMetaheuristic.GREEDY_DESCENT,
        "guided_local_search": routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH,
        "simulated_annealing": routing_enums_pb2.LocalSearchMetaheuristic.SIMULATED_ANNEALING,
        "tabu_search": routing_enums_pb2.LocalSearchMetaheuristic.TABU_SEARCH,
    }
    return metaheuristic_map.get(metaheuristic.type)


def routing_solve_impl(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a vehicle routing problem.

    Args:
        model_data: Routing model (distances, vehicles, constraints)
        config: Solver configuration (strategy, metaheuristic, time limit)

    Returns:
        EastStruct with status, total_distance, routes, wall_time
    """
    _check_google_or_support()
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2

    start_time = time.perf_counter()

    # Extract model data
    distance_matrix_data = model_data.get("distance_matrix")
    num_vehicles = int(model_data.get("num_vehicles"))
    depot = int(model_data.get("depot"))
    num_nodes = len(distance_matrix_data)

    # Build distance matrix as nested list
    distance_matrix: list[list[int]] = []
    for row in distance_matrix_data:
        distance_matrix.append([int(v) for v in row])

    # Create routing index manager and model
    manager = pywrapcp.RoutingIndexManager(num_nodes, num_vehicles, depot)
    routing = pywrapcp.RoutingModel(manager)

    # Distance callback
    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Capacity constraints
    demands = _get_option(model_data.get("demands"), None)
    capacities = _get_option(model_data.get("vehicle_capacities"), None)
    if demands is not None and capacities is not None:
        demands_list = [int(d) for d in demands]
        capacities_list = [int(c) for c in capacities]

        def demand_callback(from_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            return demands_list[from_node]

        demand_callback_index = routing.RegisterUnaryTransitCallback(
            demand_callback
        )
        routing.AddDimensionWithVehicleCapacity(
            demand_callback_index,
            0,  # no slack
            capacities_list,
            True,  # start cumul to zero
            "Capacity",
        )

    # Time windows
    time_matrix_data = _get_option(model_data.get("time_matrix"), None)
    time_windows = _get_option(model_data.get("time_windows"), None)
    if time_matrix_data is not None and time_windows is not None:
        time_matrix: list[list[int]] = []
        for row in time_matrix_data:
            time_matrix.append([int(v) for v in row])

        def time_callback(from_index: int, to_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return time_matrix[from_node][to_node]

        time_callback_index = routing.RegisterTransitCallback(time_callback)

        # Determine max time from time windows
        max_time = 0
        for tw in time_windows:
            end = int(tw.get("end"))
            if end > max_time:
                max_time = end

        routing.AddDimension(
            time_callback_index,
            max_time,  # allow waiting
            max_time,  # max time per vehicle
            False,  # don't force start cumul to zero
            "Time",
        )

        time_dimension = routing.GetDimensionOrDie("Time")
        for i, tw in enumerate(time_windows):
            index = manager.NodeToIndex(i)
            time_dimension.CumulVar(index).SetRange(
                int(tw.get("start")), int(tw.get("end"))
            )

    # Pickup and delivery
    pickup_deliveries = _get_option(model_data.get("pickup_deliveries"), None)
    if pickup_deliveries is not None:
        for pd in pickup_deliveries:
            pickup_index = manager.NodeToIndex(int(pd.get("pickup")))
            delivery_index = manager.NodeToIndex(int(pd.get("delivery")))
            routing.AddPickupAndDelivery(pickup_index, delivery_index)
            routing.solver().Add(
                routing.VehicleVar(pickup_index)
                == routing.VehicleVar(delivery_index)
            )

    # Search parameters
    search_params = pywrapcp.DefaultRoutingSearchParameters()

    first_solution = _get_option(config.get("first_solution"), None)
    search_params.first_solution_strategy = _get_first_solution_strategy(
        first_solution
    )

    metaheuristic = _get_option(config.get("metaheuristic"), None)
    meta_value = _get_metaheuristic(metaheuristic)
    if meta_value is not None:
        search_params.local_search_metaheuristic = meta_value

    max_time = _get_option(config.get("max_time_seconds"), None)
    if max_time is not None:
        search_params.time_limit.FromSeconds(int(max_time))

    # Solve
    solution = routing.SolveWithParameters(search_params)
    wall_time = time.perf_counter() - start_time

    if solution is None:
        return EastStruct(
            {
                "status": EastVariant("not_solved", None),
                "total_distance": 0,
                "routes": EastArray(RoutingRouteType, []),
                "wall_time": wall_time,
            }
        )

    # Extract routes
    routes: list[EastStruct] = []
    total_distance = 0

    for vehicle_id in range(num_vehicles):
        route_nodes: list[int] = []
        route_distance = 0
        index = routing.Start(vehicle_id)

        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            route_nodes.append(node)
            previous_index = index
            index = solution.Value(routing.NextVar(index))
            route_distance += routing.GetArcCostForVehicle(
                previous_index, index, vehicle_id
            )

        # Add end node
        route_nodes.append(manager.IndexToNode(index))
        total_distance += route_distance

        routes.append(
            EastStruct(
                {
                    "vehicle": vehicle_id,
                    "nodes": EastArray(IntegerType, route_nodes),
                    "distance": route_distance,
                }
            )
        )

    # Determine status
    status_code = routing.status()
    if status_code == routing_enums_pb2.RoutingSearchStatus.ROUTING_SUCCESS:
        status = EastVariant("feasible", None)
    elif (
        status_code
        == routing_enums_pb2.RoutingSearchStatus.ROUTING_OPTIMAL
    ):
        status = EastVariant("optimal", None)
    elif (
        status_code
        == routing_enums_pb2.RoutingSearchStatus.ROUTING_INFEASIBLE
    ):
        status = EastVariant("infeasible", None)
    else:
        status = EastVariant("not_solved", None)

    return EastStruct(
        {
            "status": status,
            "total_distance": total_distance,
            "routes": EastArray(RoutingRouteType, routes),
            "wall_time": wall_time,
        }
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

routing_impl = [
    PlatformFunction(
        name="google_or_routing_solve",
        inputs=[RoutingModelType, RoutingConfigType],
        output=RoutingResultType,
        type="sync",
        fn=routing_solve_impl,
    ),
]


__all__ = [
    # Platform implementation
    "routing_impl",
    # Types
    "RoutingFirstSolutionType",
    "RoutingMetaheuristicType",
    "RoutingTimeWindowType",
    "RoutingPickupDeliveryType",
    "RoutingModelType",
    "RoutingConfigType",
    "RoutingRouteType",
    "RoutingResultType",
]
