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

import time

from east import variant
from east.runtime.platform import platform_function, platform_functions
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

from east_py_datascience.google_or.types import GoogleOrStatusType, _check_google_or_support

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
"""Construction heuristic used to build the initial routing solution.

Cases: ``path_cheapest_arc`` (default — greedily extend routes by cheapest
arc), ``savings`` (Clarke-Wright savings algorithm), ``christofides``
(Christofides approximation, TSP only), ``parallel_cheapest_insertion``
(insert cheapest unrouted node in parallel), ``local_cheapest_insertion``
(insert cheapest node locally), ``first_unbound_min_value`` (assign first
unbound variable to its minimum value).
"""

RoutingMetaheuristicType = VariantType(
    [
        ("greedy_descent", NullType),
        ("guided_local_search", NullType),
        ("simulated_annealing", NullType),
        ("tabu_search", NullType),
    ]
)
"""Local-search metaheuristic applied after the initial solution is built.

Cases: ``greedy_descent`` (accept only improvements), ``guided_local_search``
(penalize frequently used arcs to escape local optima), ``simulated_annealing``
(probabilistic acceptance with cooling), ``tabu_search`` (forbid recently
visited moves).
"""

RoutingTimeWindowType = StructType(
    [
        ("start", IntegerType),
        ("end", IntegerType),
    ]
)
"""Time window for a single routing node.

Fields: ``start`` (``Integer`` earliest arrival time), ``end`` (``Integer``
latest arrival time) in the same units as the time matrix.
"""

RoutingPickupDeliveryType = StructType(
    [
        ("pickup", IntegerType),
        ("delivery", IntegerType),
    ]
)
"""A paired pickup-and-delivery stop constraint.

Fields: ``pickup`` (``Integer`` node index), ``delivery`` (``Integer`` node
index) — must be served by the same vehicle in that order.
"""

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
"""Declarative description of a vehicle routing problem.

Fields: ``distance_matrix`` (``Array<Array<Integer>>`` N x N integer cost
matrix), ``num_vehicles`` (fleet size), ``depot`` (start/end node index for
all vehicles), ``demands`` (per-node demand — required together with
``vehicle_capacities`` for CVRP), ``vehicle_capacities`` (per-vehicle
capacity — length must match ``num_vehicles``), ``time_matrix``
(``Array<Array<Integer>>`` travel-time matrix — required together with
``time_windows`` for VRPTW), ``time_windows``
(``Array<RoutingTimeWindowType>`` per-node time constraints), ``pickup_deliveries``
(``Array<RoutingPickupDeliveryType>`` pickup-delivery pairs for VRPPD).
"""

RoutingConfigType = StructType(
    [
        ("first_solution", OptionType(RoutingFirstSolutionType)),
        ("metaheuristic", OptionType(RoutingMetaheuristicType)),
        ("max_time_seconds", OptionType(FloatType)),
    ]
)
"""Solver configuration for a routing solve call.

Fields: ``first_solution`` (construction heuristic, default
``path_cheapest_arc``), ``metaheuristic`` (local-search improvement
strategy), ``max_time_seconds`` (wall-clock time limit in seconds).
"""

RoutingRouteType = StructType(
    [
        ("vehicle", IntegerType),
        ("nodes", ArrayType(IntegerType)),
        ("distance", IntegerType),
    ]
)
"""The route assigned to one vehicle in a routing solution.

Fields: ``vehicle`` (``Integer`` vehicle index), ``nodes``
(``Array<Integer>`` ordered visit sequence including depot at start and
end), ``distance`` (``Integer`` total arc cost for this vehicle's route).
"""

RoutingResultType = StructType(
    [
        ("status", GoogleOrStatusType),
        ("total_distance", IntegerType),
        ("routes", ArrayType(RoutingRouteType)),
        ("wall_time", FloatType),
    ]
)
"""Result returned by ``google_or_routing_solve``.

Fields: ``status`` (``GoogleOrStatusType``), ``total_distance``
(``Integer`` sum of all vehicle route costs), ``routes``
(``Array<RoutingRouteType>`` one entry per vehicle), ``wall_time``
(``Float`` seconds).
"""



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


@platform_function(
    name="google_or_routing_solve",
    inputs=[RoutingModelType, RoutingConfigType],
    output=RoutingResultType,
)
def routing_solve_impl(
    model_data: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Solve a vehicle routing problem using OR-Tools' routing library.

    Supports TSP (single vehicle), CVRP (capacity constraints), VRPTW (time
    windows), and VRPPD (pickup-and-delivery pairs). Constraints are added
    only when the corresponding optional fields in ``model_data`` are present.

    Args:
        model_data: ``RoutingModelType`` (``EastStruct``) with fields:

            - ``distance_matrix`` (``Array<Array<Integer>>``): square N x N
              integer distance matrix where entry [i][j] is the cost of
              traveling from node i to node j.
            - ``num_vehicles`` (``Integer``): fleet size.
            - ``depot`` (``Integer``): index of the depot node (start/end of
              every vehicle route).
            - ``demands`` (``Option<Array<Integer>>``): per-node demand (index
              matches matrix rows); required when ``vehicle_capacities`` is
              also set.
            - ``vehicle_capacities`` (``Option<Array<Integer>>``): per-vehicle
              capacity; length must match ``num_vehicles``.
            - ``time_matrix`` (``Option<Array<Array<Integer>>>``): travel time
              matrix; must be set together with ``time_windows`` to activate
              the time-window dimension.
            - ``time_windows`` (``Option<Array<RoutingTimeWindowType>>``):
              per-node ``{start, end: Integer}`` time window constraints.
            - ``pickup_deliveries``
              (``Option<Array<RoutingPickupDeliveryType>>``): pairs of node
              indices ``{pickup, delivery: Integer}`` that must be served by
              the same vehicle with pickup before delivery.

        config: ``RoutingConfigType`` (``EastStruct``) with fields:

            - ``first_solution`` (``Option<RoutingFirstSolutionType>``):
              construction heuristic - ``path_cheapest_arc`` (default),
              ``savings``, ``christofides``,
              ``parallel_cheapest_insertion``,
              ``local_cheapest_insertion``, ``first_unbound_min_value``.
            - ``metaheuristic`` (``Option<RoutingMetaheuristicType>``):
              improvement strategy - ``greedy_descent``,
              ``guided_local_search``, ``simulated_annealing``,
              ``tabu_search``.
            - ``max_time_seconds`` (``Option<Float>``): wall-clock time limit
              in seconds.

    Returns:
        ``RoutingResultType`` (``EastStruct``): ``status``
        (``GoogleOrStatusType``), ``total_distance`` (``Integer`` sum over
        all vehicle routes), ``routes`` (``Array<RoutingRouteType>`` - one
        per vehicle; each ``{vehicle: Integer, nodes: Array<Integer>,
        distance: Integer}`` including the return to depot), ``wall_time``
        (``Float`` seconds).

    Raises:
        NotImplementedError: the ``google-or`` extra (ortools) is not installed.
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
    demands = model_data["demands"].unwrap_or(None)
    capacities = model_data["vehicle_capacities"].unwrap_or(None)
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
    time_matrix_data = model_data["time_matrix"].unwrap_or(None)
    time_windows = model_data["time_windows"].unwrap_or(None)
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
    pickup_deliveries = model_data["pickup_deliveries"].unwrap_or(None)
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

    first_solution = config["first_solution"].unwrap_or(None)
    search_params.first_solution_strategy = _get_first_solution_strategy(
        first_solution
    )

    metaheuristic = config["metaheuristic"].unwrap_or(None)
    meta_value = _get_metaheuristic(metaheuristic)
    if meta_value is not None:
        search_params.local_search_metaheuristic = meta_value

    max_time = config["max_time_seconds"].unwrap_or(None)
    if max_time is not None:
        search_params.time_limit.FromSeconds(int(max_time))

    # Solve
    solution = routing.SolveWithParameters(search_params)
    wall_time = time.perf_counter() - start_time

    if solution is None:
        return EastStruct(
            {
                "status": variant("not_solved", None, GoogleOrStatusType),
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
        status = variant("feasible", None, GoogleOrStatusType)
    elif (
        status_code
        == routing_enums_pb2.RoutingSearchStatus.ROUTING_OPTIMAL
    ):
        status = variant("optimal", None, GoogleOrStatusType)
    elif (
        status_code
        == routing_enums_pb2.RoutingSearchStatus.ROUTING_INFEASIBLE
    ):
        status = variant("infeasible", None, GoogleOrStatusType)
    else:
        status = variant("not_solved", None, GoogleOrStatusType)

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

routing_impl = platform_functions(__name__)


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
