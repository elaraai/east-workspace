/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, example, some, none } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

export const minCostFlowSupplyChain = example({
    keywords: ["google or", "minCostFlow", "supply chain", "network flow", "transport cost", "factory", "distribution"],
    description: "Route goods from factories through distribution centers to stores minimizing transport cost",
    fn: East.function([], BooleanType, ($) => {
        // Network: 2 factories (0,1) -> 2 DCs (2,3) -> 2 stores (4,5)
        // Factory 0 supplies 20, Factory 1 supplies 15
        // Store 4 demands 18, Store 5 demands 17
        const input = $.let({
            start_nodes: [0n, 0n, 1n, 1n, 2n, 2n, 3n, 3n],
            end_nodes:   [2n, 3n, 2n, 3n, 4n, 5n, 4n, 5n],
            capacities:  [15n, 15n, 15n, 15n, 20n, 20n, 20n, 20n],
            unit_costs:  [4n,  6n,  5n,  3n,  2n,  7n,  8n,  1n],
            supplies:    [20n, 15n, 0n, 0n, -18n, -17n],
        });

        const result = $.let(GoogleOr.minCostFlow(input));

        // Total cost should be positive, 8 arcs in the flow
        return result.total_cost.greaterThan(0n);
    }),
    inputs: [],
    returns: true,
});

export const maxFlowNetwork = example({
    keywords: ["google or", "maxFlow", "maximum flow", "throughput", "warehouse", "conveyor", "network capacity"],
    description: "Find maximum throughput through a warehouse conveyor network",
    fn: East.function([], IntegerType, ($) => {
        // Conveyor network: source (0) -> stations (1,2,3) -> sink (4)
        // Bottleneck analysis: find max packages/hour through the system
        const input = $.let({
            start_nodes: [0n, 0n, 1n, 1n, 2n, 3n],
            end_nodes:   [1n, 2n, 3n, 4n, 3n, 4n],
            capacities:  [15n, 10n, 8n, 10n, 5n, 12n],
            source: 0n,
            sink: 4n,
        });

        const result = $.let(GoogleOr.maxFlow(input));

        // 0→1 (15): split 10 via 1→4, 5 via 1→3→4
        // 0→2 (10): 5 via 2→3→4 (2→3 cap 5)
        // Total: 10 + 5 + 5 = 20
        return result.total_flow;
    }),
    inputs: [],
    returns: 20n,
});

export const assignmentWorkerTask = example({
    keywords: ["google or", "assignment", "worker", "task", "cost matrix", "one-to-one", "matching", "Hungarian"],
    description: "Assign workers to tasks minimizing total cost with one-to-one matching",
    fn: East.function([], IntegerType, ($) => {
        // 4 workers, 4 tasks. Cost[worker][task]:
        // Worker 0: electrician — cheap for wiring (task 0), expensive for plumbing
        // Worker 1: plumber — cheap for pipes (task 1)
        // Worker 2: generalist — moderate at everything
        // Worker 3: carpenter — cheap for framing (task 3)
        const input = $.let({
            costs: [
                [10n, 80n, 50n, 70n],   // electrician
                [70n, 15n, 60n, 80n],   // plumber
                [40n, 45n, 35n, 40n],   // generalist
                [60n, 75n, 55n, 20n],   // carpenter
            ],
        });

        const result = $.let(GoogleOr.assignment(input));

        // Optimal: worker 0→task 0 (10), worker 1→task 1 (15),
        //          worker 2→task 2 (35), worker 3→task 3 (20) = 80
        return result.total_cost;
    }),
    inputs: [],
    returns: 80n,
});

export const minCostAssignmentUnassignedPenalty = example({
    keywords: ["google or", "minCostAssignment", "sparse", "bipartite", "unassigned penalty", "opt-out", "vessel", "tank", "berth", "contention", "scarce capacity"],
    description: "Land vessels into scarce tanks over fenced candidates, leaving one at demurrage",
    fn: East.function([], IntegerType, ($) => {
        // 4 vessels compete for 3 tanks, one vessel per tank. Each vessel is
        // fenced to the tanks it can physically reach, so only 6 of the 12
        // (vessel, tank) pairs are legal — the arcs below, not a dense matrix.
        // Anything left on the water costs 100 in demurrage.
        const input = $.let({
            workers: [0n, 0n, 1n, 2n, 3n, 3n],
            tasks:   [0n, 1n, 0n, 1n, 1n, 2n],
            costs:   [10n, 40n, 20n, 30n, 60n, 50n],
            unassigned_penalty: some([100n, 100n, 100n, 100n]),
            task_capacity: some([1n, 1n, 1n]),
        }, GoogleOr.Types.MinCostAssignmentInputType);

        const result = $.let(GoogleOr.minCostAssignment(input));

        // 3 tanks for 4 vessels, so exactly one waits. Vessel 1 only reaches
        // tank 0, and yielding it to vessel 0 (10 vs 20) is the cheapest drop:
        // 0→0 (10), 2→1 (30), 3→2 (50), vessel 1 unassigned (100) = 190.
        return result.total_cost;
    }),
    inputs: [],
    returns: 190n,
});

export const minCostAssignmentTaskCapacity = example({
    keywords: ["google or", "minCostAssignment", "task capacity", "many-to-one", "crew", "bay", "shared slot", "sparse arcs", "must assign"],
    description: "Allocate maintenance crews to bays that each hold several crews",
    fn: East.function([], IntegerType, ($) => {
        // 5 crews into 2 bays: bay 0 holds 3 crews, bay 1 holds 2.
        // Every crew can use either bay, at a travel cost per (crew, bay).
        // No unassigned_penalty — every crew must get a bay or the plan fails.
        const input = $.let({
            workers: [0n, 0n, 1n, 1n, 2n, 2n, 3n, 3n, 4n, 4n],
            tasks:   [0n, 1n, 0n, 1n, 0n, 1n, 0n, 1n, 0n, 1n],
            costs:   [5n, 9n, 6n, 3n, 4n, 8n, 7n, 2n, 3n, 10n],
            unassigned_penalty: none,
            task_capacity: some([3n, 2n]),
        }, GoogleOr.Types.MinCostAssignmentInputType);

        const result = $.let(GoogleOr.minCostAssignment(input));

        // Capacity is exactly 5, so both bays fill. Bay 1 goes to the two crews
        // that gain most from it (crew 3 saves 5, crew 1 saves 3):
        // 1→1 (3), 3→1 (2), 0→0 (5), 2→0 (4), 4→0 (3) = 17.
        return result.total_cost;
    }),
    inputs: [],
    returns: 17n,
});
