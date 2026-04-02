/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, VectorType, variant, example } from "@elaraai/east";
import { Scipy } from "@elaraai/east-py-datascience";

export const scipyMinimize = example({
    keywords: ["scipy", "optimizeMinimize", "minimize", "pump", "energy", "operating point", "L-BFGS-B"],
    description: "Find pump operating point (pressure, flow) that minimizes energy consumption",
    fn: East.function([FloatType, FloatType], BooleanType, ($, initial_pressure, initial_flow) => {
        // Energy model: power = (pressure - 50)^2 + 2*(flow - 30)^2
        // Optimal operating point: pressure=50, flow=30
        const objective = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                const pressure = $.let(x.get(0n));
                const flow = $.let(x.get(1n));
                const p_err = $.let(pressure.subtract(50.0));
                const f_err = $.let(flow.subtract(30.0));
                $.return(p_err.multiply(p_err).add(f_err.multiply(f_err).multiply(2.0)));
            }
        ));

        const x0 = $.let(East.Vector.fromArray([initial_pressure, initial_flow]));
        const config = $.let({
            method: variant('some', variant('l_bfgs_b', null)),
            max_iter: variant('some', 100n),
            tol: variant('some', 0.000001),
        });

        const result = $.let(Scipy.optimizeMinimize(objective, x0, config));

        return result.success;
    }),
    inputs: [70.0, 20.0],
    returns: true,
});

export const scipyMinimizeQuadratic = example({
    keywords: ["scipy", "optimizeMinimizeQuadratic", "quadratic", "blending", "cost allocation", "raw materials"],
    description: "Solve quadratic cost allocation for blending 3 raw materials to meet spec",
    fn: East.function([], BooleanType, ($) => {
        // Blending cost: f(x) = 0.5 * x'Ax + b'x + c
        // A = interaction costs between materials
        // b = base cost per material
        // Minimum gives optimal blend ratios
        const x0 = $.let(East.Vector.fromArray([1.0, 1.0, 1.0]));
        const A_matrix = $.let(East.Matrix.fromArray([
            [4.0, 1.0, 0.5],
            [1.0, 6.0, 1.0],
            [0.5, 1.0, 8.0],
        ]));
        const quadratic = $.let({
            A: A_matrix,
            b: East.Vector.fromArray([-10.0, -8.0, -6.0]),
            c: 0.0,
        });
        const config = $.let({
            method: variant('some', variant('l_bfgs_b', null)),
            max_iter: variant('some', 100n),
            tol: variant('some', 0.000001),
        });

        const result = $.let(Scipy.optimizeMinimizeQuadratic(x0, quadratic, config));

        return result.success;
    }),
    inputs: [],
    returns: true,
});

export const scipyDualAnnealing = example({
    keywords: ["scipy", "optimizeDualAnnealing", "dual annealing", "global optimization", "multi-modal", "calibration"],
    description: "Find global optimum for a multi-modal equipment calibration function",
    fn: East.function([], BooleanType, ($) => {
        // Calibration error with multiple local minima:
        // f(x,y) = (x-3)^2 + (y-2)^2 + 5*sin(x*y)
        // Global minimum near (3, 2) but local traps from sin term
        const objective = $.const(East.function(
            [VectorType(FloatType)], FloatType,
            ($, x) => {
                const x0 = $.let(x.get(0n));
                const x1 = $.let(x.get(1n));
                const quad = $.let(x0.subtract(3.0).multiply(x0.subtract(3.0))
                    .add(x1.subtract(2.0).multiply(x1.subtract(2.0))));
                const wave = $.let(x0.multiply(x1).sin().multiply(5.0));
                $.return(quad.add(wave));
            }
        ));

        const bounds = $.let({
            lower: East.Vector.fromArray([-5.0, -5.0]),
            upper: East.Vector.fromArray([10.0, 10.0]),
        });

        const config = $.let({
            maxfun: variant('none', null),
            maxiter: variant('some', 500n),
            initial_temp: variant('none', null),
            restart_temp_ratio: variant('none', null),
            visit: variant('none', null),
            accept: variant('none', null),
            seed: variant('some', 42n),
            no_local_search: variant('none', null),
        });

        const result = $.let(Scipy.optimizeDualAnnealing(
            objective,
            variant('none', null),
            bounds,
            config
        ));

        return result.success;
    }),
    inputs: [],
    returns: true,
});
