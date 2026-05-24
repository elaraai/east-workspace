/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, variant, example } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

export const scipyInterpolate = example({
    keywords: ["scipy", "interpolate1dFit", "interpolate1dPredict", "interpolation", "speed", "throughput", "predict"],
    description: "Build interpolation model from measured speed-vs-throughput data, predict at intermediate speeds",
    fn: East.function([], IntegerType, ($) => {
        // Measured conveyor speed (m/min) vs throughput (units/hr)
        const measured_speeds = $.let(East.Vector.fromArray([10.0, 20.0, 30.0, 40.0, 50.0]));
        const measured_throughput = $.let(East.Vector.fromArray([120.0, 230.0, 310.0, 370.0, 400.0]));

        const config = $.let({
            kind: variant('some', variant('linear', null)),
        });

        const interp_model = $.let(Scipy.interpolate1dFit(measured_speeds, measured_throughput, config));

        // Predict throughput at speeds we haven't measured
        const query_speeds = $.let(East.Vector.fromArray([15.0, 25.0, 35.0]));
        const predicted = $.let(Scipy.interpolate1dPredict(interp_model, query_speeds));

        // Should produce 3 interpolated throughput values
        return predicted.length();
    }),
    inputs: [],
    returns: 3n,
});
