/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MADS platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require PyNomadBBO to be installed in the Python environment.
 * The tests define East functions that call MADS optimization and verify results.
 */
import {ArrayType, East, FloatType, variant, VectorType} from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { MADS, MADSConstraintType } from "@elaraai/east-py-datascience";
import * as ex from "./mads.examples.js";

describeEast("MADS platform functions", (test) => {

    Assert.examples(test, { madsOptimizeProcessParams: ex.madsOptimizeProcessParams, madsOptimizeWithConstraints: ex.madsOptimizeWithConstraints, madsOptimizeWithBounds: ex.madsOptimizeWithBounds });

    test("optimize minimizes sum of squares", $ => {
        // Define objective: minimize sum of squares (minimum at origin)
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            // x[0]^2 + x[1]^2 + x[2]^2
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            const x2 = $.let(x.get(2n));
            return $.return(
                x0.multiply(x0)
                    .add(x1.multiply(x1))
                    .add(x2.multiply(x2))
            );
        });

        // Starting point
        const x0 = $.let(new Float64Array([0.71, 0.51, 0.51]));

        // Bounds
        const bounds = $.let({
            lower: new Float64Array([-1.0, -1.0, -1.0]),
            upper: new Float64Array([1.0, 1.0, 1.0]),
        });

        // Config
        const config = $.let({
            max_bb_eval: variant('some', 100n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        // Run optimization
        const result = $.let(MADS.optimize(objective, x0, bounds, variant('none', null), config));

        // Verify success
        $(Assert.equal(East.less(result.f_best, 0.1), true));
        $(Assert.equal(result.success, true));
        $(Assert.greater(result.bb_eval, 0n));
    });

    test("optimize with constraints", $ => {
        // Minimize x[0] subject to x[0]^2 + x[1]^2 >= 1 (outside unit circle)
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            return $.return(x.get(0n));
        });

        // Constraint: 1 - x[0]^2 - x[1]^2 <= 0 (must be outside unit circle)
        const constraint = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(
                East.value(1.0)
                    .subtract(x0.multiply(x0))
                    .subtract(x1.multiply(x1))
            );
        });

        const x0 = $.let(new Float64Array([2.0, 0.0]));
        const bounds = $.let({
            lower: new Float64Array([-5.0, -5.0]),
            upper: new Float64Array([5.0, 5.0]),
        });

        // Use extreme barrier constraint
        const constraints = $.let([variant('eb', constraint)], ArrayType(MADSConstraintType));

        const config = $.let({
            max_bb_eval: variant('some', 200n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('some', constraints), config));

        // The minimum of x[0] on the unit circle boundary is -1
        $(Assert.equal(result.success, true));
        $(Assert.less(result.f_best, East.value(0.0))); // Should be negative (around -1)
    });

    test("optimize respects seed for reproducibility", $ => {
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            return $.return(x0.multiply(x0));
        });

        const x0 = $.let(new Float64Array([0.5]));
        const bounds = $.let({
            lower: new Float64Array([-1.0]),
            upper: new Float64Array([1.0]),
        });

        const config = $.let({
            max_bb_eval: variant('some', 50n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 123n),
        });

        // Run twice with same seed
        const result1 = $.let(MADS.optimize(objective, x0, bounds, variant('none', null), config));
        const result2 = $.let(MADS.optimize(objective, x0, bounds, variant('none', null), config));

        // Results should be identical with same seed
        $(Assert.equal(result1.f_best, result2.f_best));
    });

    test("optimize with progressive barrier constraint", $ => {
        // Minimize x[0] subject to x[0] >= 0.5 (using PB constraint)
        // Constraint: 0.5 - x[0] <= 0
        // Minimum is at x[0] = 0.5
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            return $.return(x.get(0n));
        });

        const constraint = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            return $.return(East.value(0.5).subtract(x.get(0n)));
        });

        const x0 = $.let(new Float64Array([1.0]));
        const bounds = $.let({
            lower: new Float64Array([0.0]),
            upper: new Float64Array([2.0]),
        });

        // Use progressive barrier constraint (allows temporary violations)
        const constraints = $.let([variant('pb', constraint)], ArrayType(MADSConstraintType));

        const config = $.let({
            max_bb_eval: variant('some', 100n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('some', constraints), config));

        // Should find minimum at x = 0.5, f = 0.5
        $(Assert.equal(result.success, true));
        $(Assert.less(result.f_best, East.value(0.6)));
    });

    test("optimize with multiple constraints", $ => {
        // Minimize -x[0] - x[1] (maximize x[0] + x[1])
        // Subject to: x[0]^2 + x[1]^2 <= 1 (inside unit circle)
        //             x[0] >= 0, x[1] >= 0 (first quadrant)
        // Optimum at (1/sqrt(2), 1/sqrt(2)) ≈ (0.707, 0.707) with f ≈ -1.414
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(x0.negate().subtract(x1));
        });

        // Constraint 1: x[0]^2 + x[1]^2 - 1 <= 0 (inside unit circle)
        const c1 = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(x0.multiply(x0).add(x1.multiply(x1)).subtract(1.0));
        });

        // Constraint 2: -x[0] <= 0 (x[0] >= 0)
        const c2 = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            return $.return(x.get(0n).negate());
        });

        // Constraint 3: -x[1] <= 0 (x[1] >= 0)
        const c3 = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            return $.return(x.get(1n).negate());
        });

        const x0 = $.let(new Float64Array([0.5, 0.5]));
        const bounds = $.let({
            lower: new Float64Array([-1.0, -1.0]),
            upper: new Float64Array([1.0, 1.0]),
        });

        // Mix of eb and pb constraints
        const constraints = $.let([
            variant('eb', c1),  // Unit circle - extreme barrier
            variant('eb', c2),  // x >= 0 - extreme barrier
            variant('eb', c3),  // y >= 0 - extreme barrier
        ], ArrayType(MADSConstraintType));

        const config = $.let({
            max_bb_eval: variant('some', 300n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('some', constraints), config));

        // Minimum should be around -1.414 (at 45 degrees on unit circle)
        $(Assert.equal(result.success, true));
        $(Assert.less(result.f_best, East.value(-1.3)));
    });

    test("optimize with mixed eb and pb constraints", $ => {
        // Minimize x[0] + x[1]
        // Subject to: x[0]^2 + x[1]^2 >= 0.25 (outside small circle) - EB strict
        //             x[0] + x[1] <= 2 (sum constraint) - PB relaxed
        const objective = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(x0.add(x1));
        });

        // EB constraint: 0.25 - x[0]^2 - x[1]^2 <= 0 (outside circle of radius 0.5)
        const c_eb = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(East.value(0.25).subtract(x0.multiply(x0)).subtract(x1.multiply(x1)));
        });

        // PB constraint: x[0] + x[1] - 2 <= 0 (sum <= 2)
        const c_pb = East.function([VectorType(FloatType)], FloatType, ($, x) => {
            const x0 = $.let(x.get(0n));
            const x1 = $.let(x.get(1n));
            return $.return(x0.add(x1).subtract(2.0));
        });

        const x0 = $.let(new Float64Array([1.0, 0.0]));
        const bounds = $.let({
            lower: new Float64Array([-2.0, -2.0]),
            upper: new Float64Array([2.0, 2.0]),
        });

        const constraints = $.let([
            variant('eb', c_eb),  // Must be outside small circle
            variant('pb', c_pb),  // Soft constraint on sum
        ], ArrayType(MADSConstraintType));

        const config = $.let({
            max_bb_eval: variant('some', 200n),
            display_degree: variant('some', 0n),
            direction_type: variant('none', null),
            initial_mesh_size: variant('none', null),
            min_mesh_size: variant('none', null),
            seed: variant('some', 42n),
        });

        const result = $.let(MADS.optimize(objective, x0, bounds, variant('some', constraints), config));

        // Minimum is on the circle at 225 degrees: (-0.5/sqrt(2), -0.5/sqrt(2)) ≈ -0.707
        $(Assert.equal(result.success, true));
        $(Assert.less(result.f_best, East.value(0.0)));  // Should be negative
    });
}, { exportOnly: true });
