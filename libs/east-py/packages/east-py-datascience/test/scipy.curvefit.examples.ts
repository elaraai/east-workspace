/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, VectorType, variant, example } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

export const scipyCurveFit = example({
    keywords: ["scipy", "curveFit", "curve fitting", "custom function", "degradation", "sensor", "equipment", "exponential"],
    description: "Fit custom degradation curve to equipment sensor readings over time",
    fn: East.function([], BooleanType, ($) => {
        // Sensor output degrades: y = A * exp(-k * t) + baseline
        // A ≈ 80 (amplitude), k ≈ 0.5 (decay rate), baseline ≈ 15 (steady-state floor)
        // Data generated from: 80 * exp(-0.5 * t) + 15
        const time_points = $.let(East.Vector.fromArray([0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]));
        const sensor_readings = $.let(East.Vector.fromArray([95.0, 63.56, 44.30, 33.44, 27.81, 24.77, 23.18]));

        // Custom curve: f(t, params, fixed) = params[0] * exp(-params[1] * t) + params[2]
        const degradation_model = $.const(East.function(
            [FloatType, VectorType(FloatType), VectorType(FloatType)],
            FloatType,
            ($, t, params, _fixed) => {
                const amplitude = $.let(params.get(0n));
                const decay_rate = $.let(params.get(1n));
                const baseline = $.let(params.get(2n));
                $.return(amplitude.multiply(decay_rate.negate().multiply(t).exp()).add(baseline));
            }
        ));

        const config = $.let({
            max_iter: variant('some', 5000n),
            initial_guess: variant('some', East.Vector.fromArray([50.0, 0.3, 10.0])),
        });

        const result = $.let(Scipy.curveFit(
            variant('custom', {
                fn: degradation_model,
                n_params: 3n,
                param_bounds: variant('none', null),
                fixed_params: variant('none', null),
            }),
            time_points,
            sensor_readings,
            config
        ));

        return result.success;
    }),
    inputs: [],
    returns: true,
});
