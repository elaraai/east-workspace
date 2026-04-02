/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, ArrayType, VectorType, variant, example } from "@elaraai/east";
import { MADS } from "@elaraai/east-py-datascience";

export const madsOptimizeProcessParams = example({
    keywords: ["mads", "optimize", "derivative-free", "blackbox", "manufacturing", "defect rate", "process tuning"],
    description: "Tune machine feed rate and temperature to minimize defect rate in a manufacturing process",
    fn: East.function([FloatType, FloatType], BooleanType, ($, initial_feed_rate, initial_temp) => {
        // Defect rate model: quadratic around optimal feed_rate=5.0, temp=180.0
        // defect(fr, t) = (fr - 5)^2 + 0.01*(t - 180)^2
        const objective = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                const feed_rate = $.let(x.get(0n));
                const temperature = $.let(x.get(1n));
                const feed_err = $.let(feed_rate.subtract(5.0));
                const temp_err = $.let(temperature.subtract(180.0));
                $.return(feed_err.multiply(feed_err).add(temp_err.multiply(temp_err).multiply(0.01)));
            }
        ));

        const x0 = $.let(East.Vector.fromArray([initial_feed_rate, initial_temp]));

        const bounds = $.let({
            lower: East.Vector.fromArray([1.0, 100.0]),
            upper: East.Vector.fromArray([10.0, 250.0]),
        });

        const config = $.let({
            max_bb_eval: variant('some', 100n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('none', null), config));

        return result.success;
    }),
    inputs: [8.0, 200.0],
    returns: true,
});

export const madsOptimizeWithConstraints = example({
    keywords: ["mads", "optimize", "constraints", "eb", "pb", "warehouse", "layout", "floor area"],
    description: "Optimize warehouse layout dimensions subject to floor area and aisle width constraints",
    fn: East.function([FloatType], BooleanType, ($, max_floor_area) => {
        // Minimize wasted space: objective = -(width * depth) (negate to maximize usable area)
        // but penalize aspect ratios far from square
        const objective = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                const width = $.let(x.get(0n));
                const depth = $.let(x.get(1n));
                const area = $.let(width.multiply(depth));
                // Penalize non-square layouts: (width - depth)^2
                const aspect_penalty = $.let(width.subtract(depth).multiply(width.subtract(depth)).multiply(0.1));
                // Minimize: negative area + aspect penalty
                $.return(area.negate().add(aspect_penalty));
            }
        ));

        // EB constraint: width * depth <= max_floor_area → width*depth - max_floor_area <= 0
        const floor_area_constraint = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                const width = $.let(x.get(0n));
                const depth = $.let(x.get(1n));
                $.return(width.multiply(depth).subtract(max_floor_area));
            }
        ));

        // PB constraint: minimum aisle width (width >= 10) → 10 - width <= 0
        const aisle_constraint = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                $.return(East.value(10.0).subtract(x.get(0n)));
            }
        ));

        const x0 = $.let(East.Vector.fromArray([15.0, 15.0]));

        const bounds = $.let({
            lower: East.Vector.fromArray([5.0, 5.0]),
            upper: East.Vector.fromArray([50.0, 50.0]),
        });

        const constraints = $.let([
            variant('eb', floor_area_constraint),
            variant('pb', aisle_constraint),
        ], ArrayType(MADS.Types.ConstraintType));

        const config = $.let({
            max_bb_eval: variant('some', 200n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('some', constraints), config));

        return result.success;
    }),
    inputs: [500.0],
    returns: true,
});

export const madsOptimizeWithBounds = example({
    keywords: ["mads", "optimize", "bounds", "delivery", "vehicle", "speed", "route deviation", "safety"],
    description: "Optimize delivery vehicle speed and route deviation within safety limits",
    fn: East.function([FloatType, FloatType], BooleanType, ($, min_speed, max_speed) => {
        // Minimize fuel + time cost: fuel ∝ speed^2, time ∝ 1/speed, deviation adds distance
        // cost(speed, deviation) = 0.01*speed^2 + 100/speed + deviation^2
        const objective = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                const speed = $.let(x.get(0n));
                const deviation = $.let(x.get(1n));
                const fuel_cost = $.let(speed.multiply(speed).multiply(0.01));
                const time_cost = $.let(East.value(100.0).divide(speed));
                const detour_cost = $.let(deviation.multiply(deviation));
                $.return(fuel_cost.add(time_cost).add(detour_cost));
            }
        ));

        // Start at mid-range speed, zero deviation
        const x0 = $.let(East.Vector.fromArray([
            min_speed.add(max_speed).divide(2.0),
            5.0,
        ]));

        // Speed bounded by safety limits, deviation bounded [0, 20]
        const bounds = $.let({
            lower: East.Vector.fromArray([min_speed, 0.0]),
            upper: East.Vector.fromArray([max_speed, 20.0]),
        });

        const config = $.let({
            max_bb_eval: variant('some', 150n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('none', null), config));

        return result.success;
    }),
    inputs: [30.0, 120.0],
    returns: true,
});
