/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, ArrayType, StructType, variant, example } from "@elaraai/east";
import { ALNS } from "@elaraai/east-py-datascience";

// Route plan: leg distances between consecutive delivery stops
const RoutePlanType = StructType({
    leg_distances: ArrayType(FloatType),
    total_distance: FloatType,
});

export const alnsOptimizeBasic = example({
    keywords: ["alns", "optimize", "destroy", "repair", "delivery", "route", "adaptive large neighborhood search"],
    description: "Improve a delivery route plan by removing and reinserting stops to reduce total distance",
    fn: East.function([FloatType], BooleanType, ($, initial_cost) => {
        const initial = $.let({
            leg_distances: [8.0, 5.0, 12.0, 3.0, 7.0],
            total_distance: initial_cost,
        });

        // Objective: minimize total route distance
        const objective = $.const(East.function([RoutePlanType], FloatType, ($, plan) => {
            return plan.total_distance;
        }));

        // Destroy: zero out the longest leg (remove that stop from the route)
        const remove_longest_leg = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const longest = $.let(plan.leg_distances.reduce(($, best, d) =>
                d.greaterThan(best).ifElse(() => d, () => best), 0.0));
            const after_removal = $.let(plan.leg_distances.map(($, d) =>
                d.subtract(longest).abs().lessThan(0.001).ifElse(() => 0.0, () => d)
            ));
            $.return({ leg_distances: after_removal, total_distance: plan.total_distance });
        }));

        // Repair: replace removed legs (zeros) with a shorter connection, recompute total
        const reinsert_shorter = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const repaired = $.let(plan.leg_distances.map(($, d) =>
                d.lessThan(0.01).ifElse(() => 2.0, () => d)
            ));
            const new_total = $.let(repaired.reduce(($, acc, d) => acc.add(d), 0.0));
            $.return({ leg_distances: repaired, total_distance: new_total });
        }));

        const config = $.let({
            stop: variant('some', variant('max_iterations', 20n)),
            acceptance: variant('none', null),
            operator_selection: variant('none', null),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize(
            [RoutePlanType], initial, objective,
            [remove_longest_leg], [reinsert_shorter], config
        ));

        return result.success;
    }),
    inputs: [35.0],
    returns: true,
});

export const alnsOptimizeMultiOperator = example({
    keywords: ["alns", "optimize", "multiple operators", "roulette wheel", "scheduling", "work orders"],
    description: "Schedule work orders with worst-removal and shrink-long destroy, short-insert and medium-insert repair",
    fn: East.function([], BooleanType, ($) => {
        const initial = $.let({
            leg_distances: [10.0, 15.0, 6.0, 20.0, 9.0],
            total_distance: 60.0,
        });

        const objective = $.const(East.function([RoutePlanType], FloatType, ($, plan) => {
            return plan.total_distance;
        }));

        // Destroy strategy 1: remove the longest leg
        const remove_worst = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const longest = $.let(plan.leg_distances.reduce(($, best, d) =>
                d.greaterThan(best).ifElse(() => d, () => best), 0.0));
            const after = $.let(plan.leg_distances.map(($, d) =>
                d.subtract(longest).abs().lessThan(0.001).ifElse(() => 0.0, () => d)
            ));
            $.return({ leg_distances: after, total_distance: plan.total_distance });
        }));

        // Destroy strategy 2: halve all legs above a threshold
        const shrink_long_legs = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const after = $.let(plan.leg_distances.map(($, d) =>
                d.greaterThan(8.0).ifElse(() => d.multiply(0.5), () => d)
            ));
            const new_total = $.let(after.reduce(($, acc, d) => acc.add(d), 0.0));
            $.return({ leg_distances: after, total_distance: new_total });
        }));

        // Repair strategy 1: replace zeros with short connections (2.0)
        const insert_short = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const repaired = $.let(plan.leg_distances.map(($, d) =>
                d.lessThan(0.01).ifElse(() => 2.0, () => d)
            ));
            const new_total = $.let(repaired.reduce(($, acc, d) => acc.add(d), 0.0));
            $.return({ leg_distances: repaired, total_distance: new_total });
        }));

        // Repair strategy 2: replace zeros with medium connections (5.0)
        const insert_medium = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const repaired = $.let(plan.leg_distances.map(($, d) =>
                d.lessThan(0.01).ifElse(() => 5.0, () => d)
            ));
            const new_total = $.let(repaired.reduce(($, acc, d) => acc.add(d), 0.0));
            $.return({ leg_distances: repaired, total_distance: new_total });
        }));

        // Roulette wheel selects operators based on past performance
        const config = $.let({
            stop: variant('some', variant('max_iterations', 50n)),
            acceptance: variant('none', null),
            operator_selection: variant('some', variant('roulette_wheel', {
                scores: variant('some', [33n, 9n, 3n, 0n]),
                decay: variant('some', 0.8),
            })),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize(
            [RoutePlanType], initial, objective,
            [remove_worst, shrink_long_legs],
            [insert_short, insert_medium],
            config
        ));

        return result.success;
    }),
    inputs: [],
    returns: true,
});

export const alnsOptimizeWithAcceptance = example({
    keywords: ["alns", "optimize", "simulated annealing", "acceptance", "fleet", "assignment"],
    description: "Optimize fleet assignment using simulated annealing acceptance to escape local optima",
    fn: East.function([FloatType, FloatType], BooleanType, ($, start_temp, end_temp) => {
        const initial = $.let({
            leg_distances: [6.0, 9.0, 4.0, 11.0, 7.0],
            total_distance: 37.0,
        });

        const objective = $.const(East.function([RoutePlanType], FloatType, ($, plan) => {
            return plan.total_distance;
        }));

        // Destroy: zero out the longest leg
        const remove_longest = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const longest = $.let(plan.leg_distances.reduce(($, best, d) =>
                d.greaterThan(best).ifElse(() => d, () => best), 0.0));
            const after = $.let(plan.leg_distances.map(($, d) =>
                d.subtract(longest).abs().lessThan(0.001).ifElse(() => 0.0, () => d)
            ));
            $.return({ leg_distances: after, total_distance: plan.total_distance });
        }));

        // Repair: replace zeros with shorter connections
        const reinsert = $.const(East.function([RoutePlanType], RoutePlanType, ($, plan) => {
            const repaired = $.let(plan.leg_distances.map(($, d) =>
                d.lessThan(0.01).ifElse(() => 3.0, () => d)
            ));
            const new_total = $.let(repaired.reduce(($, acc, d) => acc.add(d), 0.0));
            $.return({ leg_distances: repaired, total_distance: new_total });
        }));

        // Simulated annealing: accept worse solutions early on to escape local optima
        const config = $.let({
            stop: variant('some', variant('max_iterations', 30n)),
            acceptance: variant('some', variant('simulated_annealing', {
                start_temperature: variant('some', start_temp),
                end_temperature: variant('some', end_temp),
                step: variant('some', 0.95),
            })),
            operator_selection: variant('none', null),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize(
            [RoutePlanType], initial, objective,
            [remove_longest], [reinsert], config
        ));

        return result.success;
    }),
    inputs: [50.0, 0.1],
    returns: true,
});
