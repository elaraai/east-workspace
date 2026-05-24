/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

export const scipyHistogram = example({
    keywords: ["scipy", "histogram", "distribution", "throughput", "bin", "frequency", "volume"],
    description: "Build histogram of daily throughput volumes to visualize distribution",
    fn: East.function([], IntegerType, ($) => {
        // Daily throughput volumes over 20 days
        const daily_volumes = $.let(East.Vector.fromArray([
            150.0, 165.0, 142.0, 178.0, 155.0, 190.0, 160.0, 145.0, 172.0, 168.0,
            158.0, 180.0, 148.0, 175.0, 162.0, 185.0, 153.0, 170.0, 164.0, 188.0,
        ]));

        const config = $.let({
            bins: variant('some', 5n),
            bin_method: variant('none', null),
            range_min: variant('none', null),
            range_max: variant('none', null),
            density: variant('none', null),
            weights: variant('none', null),
        });

        const result = $.let(Scipy.histogram(daily_volumes, config));

        // 5 bins requested → 5 counts, 6 bin edges
        return result.bin_edges.length();
    }),
    inputs: [],
    returns: 6n,
});

export const scipyKde = example({
    keywords: ["scipy", "kdeFit", "kdeEvaluate", "kernel density", "demand", "density estimation", "distribution"],
    description: "Estimate demand density from sparse historical observations, evaluate at grid points",
    fn: East.function([], BooleanType, ($) => {
        // Sparse historical demand observations (bimodal: low-demand and high-demand clusters)
        const observations = $.let(East.Vector.fromArray([
            10.0, 12.0, 11.0, 13.0, 9.0,
            45.0, 48.0, 47.0, 50.0, 46.0,
        ]));

        const config = $.let({
            bandwidth: variant('none', null),
            bandwidth_scalar: variant('none', null),
            weights: variant('none', null),
        });

        const model = $.let(Scipy.kdeFit(observations, config));

        // Evaluate density at grid points spanning the demand range
        const eval_points = $.let(East.Vector.fromArray([5.0, 10.0, 25.0, 45.0, 55.0]));
        const densities = $.let(Scipy.kdeEvaluate(model, eval_points));

        // Density at cluster centers (10, 45) should be higher than between (25)
        return densities.get(1n).greaterThan(densities.get(2n));
    }),
    inputs: [],
    returns: true,
});
