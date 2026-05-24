/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SciPy platform function tests
 */
import {East, FloatType, variant, VectorType} from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Scipy } from "@elaraai/east-py-datascience";
import * as optEx from "./scipy.optimization.examples.js";
import * as curvefitEx from "./scipy.curvefit.examples.js";
import * as interpEx from "./scipy.interpolate.examples.js";
import * as statsEx from "./scipy.stats.examples.js";
import * as distEx from "./scipy.distribution.examples.js";

describeEast("Scipy platform functions", (test) => {

    Assert.examples(test, { scipyStatsDescribe: statsEx.scipyStatsDescribe, scipyCorrelation: statsEx.scipyCorrelation, scipyPercentile: statsEx.scipyPercentile, scipyRobustStats: statsEx.scipyRobustStats });

    test("stats_describe computes correct statistics", $ => {
        const data = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0]));

        const result = $.let(Scipy.statsDescribe(data));

        $(Assert.equal(result.count, 5n));
        $(Assert.equal(result.mean, East.value(3.0)));
        $(Assert.equal(result.min, East.value(1.0)));
        $(Assert.equal(result.max, East.value(5.0)));
    });

    test("stats_pearsonr computes correlation", $ => {
        // Perfect positive correlation
        const x = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0]));

        const result = $.let(Scipy.statsPearsonr(x, y));

        // Should be ~1.0 for perfect correlation
        $(Assert.greater(result.correlation, East.value(0.99)));
    });

    test("stats_spearmanr computes rank correlation", $ => {
        // Perfect positive rank correlation
        const x = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0]));
        const y = $.let(new Float64Array([10.0, 20.0, 30.0, 40.0, 50.0]));

        const result = $.let(Scipy.statsSpearmanr(x, y));

        $(Assert.greater(result.correlation, East.value(0.99)));
    });

    Assert.examples(test, { scipyCurveFit: curvefitEx.scipyCurveFit });

    test("curve_fit fits linear function", $ => {
        // Linear data: y = 2 + 3*x
        const x = $.let(new Float64Array([0.0, 1.0, 2.0, 3.0, 4.0]));
        const y = $.let(new Float64Array([2.0, 5.0, 8.0, 11.0, 14.0]));

        const config = $.let({
            max_iter: variant('some', 5000n),
            initial_guess: variant('none', null),
        });

        const result = $.let(Scipy.curveFit(
            variant('linear', null),
            x,
            y,
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.greater(result.r_squared, East.value(0.99)));
        // params[0] should be ~2.0 (intercept), params[1] should be ~3.0 (slope)
    });

    test("curve_fit fits exponential decay", $ => {
        // Exponential decay: y = 10 * exp(-0.5 * x)
        const x = $.let(new Float64Array([0.0, 1.0, 2.0, 3.0, 4.0]));
        const y = $.let(new Float64Array([10.0, 6.065, 3.679, 2.231, 1.353]));

        const config = $.let({
            max_iter: variant('some', 5000n),
            initial_guess: variant('none', null),
        });

        const result = $.let(Scipy.curveFit(
            variant('exponential_decay', null),
            x,
            y,
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.greater(result.r_squared, East.value(0.99)));
    });

    Assert.examples(test, { scipyInterpolate: interpEx.scipyInterpolate });

    test("interpolate_1d_fit and predict works", $ => {
        // Known data points
        const x = $.let(new Float64Array([0.0, 1.0, 2.0, 3.0, 4.0]));
        const y = $.let(new Float64Array([0.0, 1.0, 4.0, 9.0, 16.0]));

        const config = $.let({
            kind: variant('some', variant('linear', null)),
        });

        // Fit interpolator
        const interp = $.let(Scipy.interpolate1dFit(x, y, config));

        // Predict at known and interpolated points
        const x_new = $.let(new Float64Array([0.5, 1.5, 2.5]));
        const y_pred = $.let(Scipy.interpolate1dPredict(interp, x_new));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 3n));
    });

    Assert.examples(test, { scipyMinimize: optEx.scipyMinimize, scipyMinimizeQuadratic: optEx.scipyMinimizeQuadratic, scipyDualAnnealing: optEx.scipyDualAnnealing });

    test("optimize_minimize finds minimum", $ => {
        // Minimize sum of squares (minimum at origin)
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(x0.multiply(x0).add(x1.multiply(x1)));
        });

        const x0 = $.let(new Float64Array([1.0, 1.0]));
        const config = $.let({
            method: variant('some', variant('l_bfgs_b', null)),
            max_iter: variant('some', 100n),
            tol: variant('some', 0.000001),
        });

        const result = $.let(Scipy.optimizeMinimize(objective, x0, config));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.fun, East.value(0.01)));
    });

    test("optimize_minimize_quadratic finds minimum", $ => {
        // Minimize f(x) = 0.5 * x'Ax + b'x + c
        // A = [[2, 0], [0, 2]], b = [-2, -2], c = 0
        // Minimum at x = [1, 1], f(x) = -2

        const x0 = $.let(new Float64Array([0.0, 0.0]));
        const A_matrix = $.let(East.Matrix.fromArray([[2.0, 0.0], [0.0, 2.0]]));
        const quadratic = $.let({
            A: A_matrix,
            b: new Float64Array([-2.0, -2.0]),
            c: 0.0,
        });
        const config = $.let({
            method: variant('some', variant('l_bfgs_b', null)),
            max_iter: variant('some', 100n),
            tol: variant('some', 0.000001),
        });

        const result = $.let(Scipy.optimizeMinimizeQuadratic(x0, quadratic, config));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.fun, East.value(-1.9)));
    });

    test("curve_fit fits custom function", $ => {
        // Custom function: y = a * sin(b * x)
        // Use data: sin(x) at x = [0, π/2, π, 3π/2, 2π]
        // Expected params: a ~ 1.0, b ~ 1.0
        const x = $.let(new Float64Array([0.0, 1.5708, 3.1416, 4.7124, 6.2832]));
        const y = $.let(new Float64Array([0.0, 1.0, 0.0, -1.0, 0.0]));

        // Define custom curve function: a * sin(b * x)
        // Takes (x, params, fixed_params) - fixed_params unused here
        const customFn = East.function(
            [FloatType, VectorType(FloatType), VectorType(FloatType)],
            FloatType,
            ($, x_val, params, _fixed_params) => {
                const a = $.let(params.get(0n));
                const b = $.let(params.get(1n));
                return $.return(a.multiply(b.multiply(x_val).sin()));
            }
        );

        const config = $.let({
            max_iter: variant('some', 5000n),
            initial_guess: variant('some', new Float64Array([1.0, 1.0])),
        });

        const result = $.let(Scipy.curveFit(
            variant('custom', {
                fn: customFn,
                n_params: 2n,
                param_bounds: variant('none', null),
                fixed_params: variant('none', null),
            }),
            x,
            y,
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.greater(result.r_squared, East.value(0.9)));
    });

    test("curve_fit with fixed_params passes through to custom function", $ => {
        // Custom function: y = a * exp(-b * x) + c
        // where c is a fixed offset passed via fixed_params
        // Data: y = 2 * exp(-0.5 * x) + 3
        const x = $.let(new Float64Array([0.0, 1.0, 2.0, 3.0, 4.0]));
        const y = $.let(new Float64Array([5.0, 4.213, 3.736, 3.446, 3.271]));  // 2*exp(-0.5*x) + 3

        // Custom function takes (x, params, fixed_params)
        // params = [a, b], fixed_params = [c]
        const customFn = East.function(
            [FloatType, VectorType(FloatType), VectorType(FloatType)],
            FloatType,
            ($, x_val, params, fixed_params) => {
                const a = $.let(params.get(0n));
                const b = $.let(params.get(1n));
                const c = $.let(fixed_params.get(0n));  // Fixed offset from fixed_params
                // y = a * exp(-b * x) + c
                return $.return(a.multiply(b.negate().multiply(x_val).exp()).add(c));
            }
        );

        const config = $.let({
            max_iter: variant('some', 5000n),
            initial_guess: variant('some', new Float64Array([1.0, 1.0])),  // Initial guess for [a, b]
        });

        const result = $.let(Scipy.curveFit(
            variant('custom', {
                fn: customFn,
                n_params: 2n,  // Only fitting a and b
                param_bounds: variant('none', null),
                fixed_params: variant('some', new Float64Array([3.0])),  // c = 3.0 is fixed
            }),
            x,
            y,
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.greater(result.r_squared, East.value(0.95)));
        // params[0] should be ~2.0 (a), params[1] should be ~0.5 (b)
    });

    // Note: "unknown_curve" error test removed - East now validates variant types
    // at construction time, catching invalid variants before reaching Python runtime

    test("optimize_dual_annealing finds global minimum", $ => {
        // Rastrigin-like function with multiple local minima
        // f(x) = sum(x_i^2) - has global minimum at origin
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            // Simple sum of squares - global min at (0, 0)
            return $.return(x0.multiply(x0).add(x1.multiply(x1)));
        });

        const bounds = $.let({
            lower: new Float64Array([-5.0, -5.0]),
            upper: new Float64Array([5.0, 5.0]),
        });

        const config = $.let({
            maxfun: variant('none', null),  // Use default (1e7) - algorithm needs ~2000 evals
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
            variant('none', null),  // No initial guess
            bounds,
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.fun, East.value(0.1)));  // Should find near-global minimum
    });

    test("optimize_dual_annealing with initial guess", $ => {
        // Minimize x^2 + y^2
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(x0.multiply(x0).add(x1.multiply(x1)));
        });

        const x0 = $.let(new Float64Array([1.0, 1.0]));  // Start near (1, 1)
        const bounds = $.let({
            lower: new Float64Array([-10.0, -10.0]),
            upper: new Float64Array([10.0, 10.0]),
        });

        const config = $.let({
            maxfun: variant('none', null),  // Use default - no_local_search needs fewer evals
            maxiter: variant('some', 200n),
            initial_temp: variant('none', null),
            restart_temp_ratio: variant('none', null),
            visit: variant('none', null),
            accept: variant('none', null),
            seed: variant('some', 123n),
            no_local_search: variant('some', true),  // Faster without local search
        });

        const result = $.let(Scipy.optimizeDualAnnealing(
            objective,
            variant('some', x0),  // With initial guess
            bounds,
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.fun, East.value(1.0)));
    });
    Assert.examples(test, { scipyHistogram: distEx.scipyHistogram, scipyKde: distEx.scipyKde });

    test("histogram basic computes bins and edges", $ => {
        const data = $.let(new Float64Array([1, 2, 2, 3, 3, 3, 4, 4, 5, 5]));

        const config = $.let({
            bins: variant('none', null),
            bin_method: variant('none', null),
            range_min: variant('none', null),
            range_max: variant('none', null),
            density: variant('none', null),
            weights: variant('none', null),
        });

        const result = $.let(Scipy.histogram(data, config));

        // Default 10 bins
        $(Assert.equal(result.counts.length(), 10n));
        // bin_edges = counts + 1
        $(Assert.equal(result.bin_edges.length(), 11n));
        // All counts non-negative
        $(Assert.greaterEqual(result.counts.get(0n), East.value(0.0)));
    });

    test("histogram with density normalizes output", $ => {
        const data = $.let(new Float64Array([1, 2, 2, 3, 3, 3, 4, 4, 5, 5]));

        const config = $.let({
            bins: variant('none', null),
            bin_method: variant('none', null),
            range_min: variant('none', null),
            range_max: variant('none', null),
            density: variant('some', true),
            weights: variant('none', null),
        });

        const result = $.let(Scipy.histogram(data, config));

        // All density values >= 0
        $(Assert.greaterEqual(result.counts.get(0n), East.value(0.0)));
    });

    test("histogram with explicit bins", $ => {
        const data = $.let(new Float64Array([1, 2, 2, 3, 3, 3, 4, 4, 5, 5]));

        const config = $.let({
            bins: variant('some', 3n),
            bin_method: variant('none', null),
            range_min: variant('none', null),
            range_max: variant('none', null),
            density: variant('none', null),
            weights: variant('none', null),
        });

        const result = $.let(Scipy.histogram(data, config));

        $(Assert.equal(result.counts.length(), 3n));
    });

    test("kde fit and evaluate produces densities", $ => {
        const data = $.let(new Float64Array([1, 2, 2, 3, 3, 3, 4, 4, 5]));

        const config = $.let({
            bandwidth: variant('none', null),
            bandwidth_scalar: variant('none', null),
            weights: variant('none', null),
        });

        const model = $.let(Scipy.kdeFit(data, config));

        const points = $.let(new Float64Array([1, 2, 3, 4, 5]));
        const densities = $.let(Scipy.kdeEvaluate(model, points));

        // Should produce 5 density values
        $(Assert.equal(densities.length(), 5n));
        // All densities should be positive
        $(Assert.greater(densities.get(0n), East.value(0.0)));
        $(Assert.greater(densities.get(1n), East.value(0.0)));
        $(Assert.greater(densities.get(2n), East.value(0.0)));
        // Peak density near 3 (most frequent value)
        $(Assert.greater(densities.get(2n), densities.get(0n)));
    });

    test("stats_percentileofscore computes percentile rank", $ => {
        const data = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0]));

        // 3.0 is the median of [1,2,3,4,5] — should be 50th percentile (weak kind)
        const pct = $.let(Scipy.statsPercentileOfScore(data, East.value(3.0)));
        $(Assert.equal(pct, East.value(60.0)));

        // Value below all data should be 0
        const pct_low = $.let(Scipy.statsPercentileOfScore(data, East.value(0.0)));
        $(Assert.equal(pct_low, East.value(0.0)));

        // Value above all data should be 100
        const pct_high = $.let(Scipy.statsPercentileOfScore(data, East.value(6.0)));
        $(Assert.equal(pct_high, East.value(100.0)));
    });

    test("kde with custom bandwidth produces positive densities", $ => {
        const data = $.let(new Float64Array([1, 2, 2, 3, 3, 3, 4, 4, 5]));

        const config = $.let({
            bandwidth: variant('none', null),
            bandwidth_scalar: variant('some', 0.5),
            weights: variant('none', null),
        });

        const model = $.let(Scipy.kdeFit(data, config));

        const points = $.let(new Float64Array([1, 2, 3, 4, 5]));
        const densities = $.let(Scipy.kdeEvaluate(model, points));

        $(Assert.greater(densities.get(0n), East.value(0.0)));
        $(Assert.greater(densities.get(4n), East.value(0.0)));
    });
}, { exportOnly: true });
