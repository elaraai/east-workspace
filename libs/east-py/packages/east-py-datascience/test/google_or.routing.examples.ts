/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

export const routingSolveVRP = example({
    keywords: ["google or", "routing", "routingSolve", "VRP", "vehicle routing", "delivery", "depot", "distance"],
    description: "Route delivery vehicles from a depot to customer locations minimizing total distance",
    fn: East.function([IntegerType], BooleanType, ($, n_vehicles) => {
        // 5 locations: depot (0) + 4 customers. 2 vehicles.
        // Distance matrix (symmetric):
        //   depot  c1  c2  c3  c4
        //     0    10  15  20  25
        //    10     0  35  25  30
        //    15    35   0  30  20
        //    20    25  30   0  10
        //    25    30  20  10   0
        const model = $.let({
            distance_matrix: [
                [0n, 10n, 15n, 20n, 25n],
                [10n, 0n, 35n, 25n, 30n],
                [15n, 35n, 0n, 30n, 20n],
                [20n, 25n, 30n, 0n, 10n],
                [25n, 30n, 20n, 10n, 0n],
            ],
            num_vehicles: n_vehicles,
            depot: 0n,
            demands: variant('some', [0n, 1n, 2n, 3n, 1n]),
            vehicle_capacities: variant('some', [5n, 5n]),
            time_matrix: variant('none', null),
            time_windows: variant('none', null),
            pickup_deliveries: variant('none', null),
        }, GoogleOr.Types.RoutingModelType);

        const config = $.let({
            first_solution: variant('some', variant('path_cheapest_arc', null)),
            metaheuristic: variant('none', null),
            max_time_seconds: variant('some', 10.0),
        }, GoogleOr.Types.RoutingConfigType);

        const result = $.let(GoogleOr.routingSolve(model, config));

        // Should have routes for both vehicles, total distance > 0
        return result.total_distance.greaterThan(0n);
    }),
    inputs: [2n],
    returns: true,
});

export const routingSolveWithTimeWindows = example({
    keywords: ["google or", "routing", "routingSolve", "time windows", "VRPTW", "field technician", "service call"],
    description: "Route field technicians to service calls within customer-specified time windows",
    fn: East.function([], BooleanType, ($) => {
        // 4 locations: depot (0) + 3 service calls. 1 technician.
        // Each service call has a time window when the customer is available.
        const model = $.let({
            distance_matrix: [
                [0n, 10n, 15n, 20n],
                [10n, 0n, 25n, 30n],
                [15n, 25n, 0n, 10n],
                [20n, 30n, 10n, 0n],
            ],
            num_vehicles: 1n,
            depot: 0n,
            demands: variant('some', [0n, 1n, 1n, 1n]),
            vehicle_capacities: variant('some', [10n]),
            time_matrix: variant('some', [
                [0n, 10n, 15n, 20n],
                [10n, 0n, 25n, 30n],
                [15n, 25n, 0n, 10n],
                [20n, 30n, 10n, 0n],
            ]),
            time_windows: variant('some', [
                { start: 0n, end: 1000n },   // depot: always open
                { start: 0n, end: 50n },      // customer 1: morning
                { start: 20n, end: 80n },     // customer 2: midday
                { start: 30n, end: 100n },    // customer 3: afternoon
            ]),
            pickup_deliveries: variant('none', null),
        }, GoogleOr.Types.RoutingModelType);

        const config = $.let({
            first_solution: variant('some', variant('path_cheapest_arc', null)),
            metaheuristic: variant('none', null),
            max_time_seconds: variant('some', 10.0),
        }, GoogleOr.Types.RoutingConfigType);

        const result = $.let(GoogleOr.routingSolve(model, config));

        return result.total_distance.greaterThan(0n);
    }),
    inputs: [],
    returns: true,
});

export const routingSolvePickupDelivery = example({
    keywords: ["google or", "routing", "routingSolve", "pickup", "delivery", "VRPPD", "courier", "pairing"],
    description: "Plan courier routes with paired pickup and delivery locations",
    fn: East.function([], BooleanType, ($) => {
        // 5 locations: depot (0), pickup A (1), delivery A (2), pickup B (3), delivery B (4)
        // Courier must pick up before delivering for each pair.
        const model = $.let({
            distance_matrix: [
                [0n, 8n, 15n, 12n, 20n],
                [8n, 0n, 10n, 18n, 25n],
                [15n, 10n, 0n, 20n, 12n],
                [12n, 18n, 20n, 0n, 8n],
                [20n, 25n, 12n, 8n, 0n],
            ],
            num_vehicles: 1n,
            depot: 0n,
            demands: variant('some', [0n, 1n, -1n, 1n, -1n]),
            vehicle_capacities: variant('some', [2n]),
            time_matrix: variant('some', [
                [0n, 8n, 15n, 12n, 20n],
                [8n, 0n, 10n, 18n, 25n],
                [15n, 10n, 0n, 20n, 12n],
                [12n, 18n, 20n, 0n, 8n],
                [20n, 25n, 12n, 8n, 0n],
            ]),
            time_windows: variant('some', [
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
            ]),
            pickup_deliveries: variant('some', [
                { pickup: 1n, delivery: 2n },
                { pickup: 3n, delivery: 4n },
            ]),
        }, GoogleOr.Types.RoutingModelType);

        const config = $.let({
            first_solution: variant('some', variant('path_cheapest_arc', null)),
            metaheuristic: variant('none', null),
            max_time_seconds: variant('some', 10.0),
        }, GoogleOr.Types.RoutingConfigType);

        const result = $.let(GoogleOr.routingSolve(model, config));

        return result.total_distance.greaterThan(0n);
    }),
    inputs: [],
    returns: true,
});
