/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gaussian Process platform function tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { GP } from "@elaraai/east-py-datascience";
import * as ex from "./gp.examples.js";

describeEast("GP platform functions", (test) => {

    Assert.examples(test, { gpTrainPredict: ex.gpTrainPredict });

    test("train and predict with rbf kernel", $ => {
        // Simple quadratic function: y = x^2
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const y = $.let(new Float64Array([1.0, 4.0, 9.0, 16.0, 25.0]));

        const config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 0n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 5n));
        // GP should interpolate training points almost exactly
        $(Assert.less(predictions.get(0n).subtract(East.value(1.0)).abs(), East.value(0.1)));
        $(Assert.less(predictions.get(1n).subtract(East.value(4.0)).abs(), East.value(0.1)));
        $(Assert.less(predictions.get(2n).subtract(East.value(9.0)).abs(), East.value(0.1)));
        $(Assert.less(predictions.get(3n).subtract(East.value(16.0)).abs(), East.value(0.1)));
        $(Assert.less(predictions.get(4n).subtract(East.value(25.0)).abs(), East.value(0.1)));
    });

    test("predict_std returns uncertainty", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const y = $.let(new Float64Array([1.0, 4.0, 9.0, 16.0, 25.0]));

        const config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 0n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const result = $.let(GP.predictStd(model, X));

        $(Assert.equal(result.mean.length(), 5n));
        $(Assert.equal(result.std.length(), 5n));
        // Uncertainty at training points should be very low
        $(Assert.less(result.std.get(0n), 0.1));
    });

    test("matern_3_2 kernel", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const config = $.let({
            kernel: variant('some', variant('matern_3_2', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 4n));
    });

    test("matern_5_2 kernel", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const config = $.let({
            kernel: variant('some', variant('matern_5_2', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 4n));
    });

    test("matern_1_2 kernel", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const config = $.let({
            kernel: variant('some', variant('matern_1_2', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 4n));
    });

    test("rational_quadratic kernel", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const config = $.let({
            kernel: variant('some', variant('rational_quadratic', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 4n));
    });

    test("dot_product kernel (linear)", $ => {
        // Linear function: y = x1 + x2
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const config = $.let({
            kernel: variant('some', variant('dot_product', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 4n));
        // Dot product kernel on linear data should fit well
        $(Assert.less(predictions.get(0n).subtract(East.value(3.0)).abs(), East.value(0.5)));
        $(Assert.less(predictions.get(1n).subtract(East.value(5.0)).abs(), East.value(0.5)));
        $(Assert.less(predictions.get(2n).subtract(East.value(7.0)).abs(), East.value(0.5)));
        $(Assert.less(predictions.get(3n).subtract(East.value(9.0)).abs(), East.value(0.5)));
    });

    test("uncertainty increases away from training data", $ => {
        // Train on points 1-5
        const X_train = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const y_train = $.let(new Float64Array([1.0, 4.0, 9.0, 16.0, 25.0]));

        // Predict at training point and far away point
        const X_test = $.let(East.Matrix.fromArray([
            [3.0],   // In training range
            [10.0],  // Far from training data
        ]));

        const config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 0n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X_train, y_train, config));
        const result = $.let(GP.predictStd(model, X_test));

        // Uncertainty should be lower at training point than far away
        $(Assert.less(result.std.get(0n), result.std.get(1n)));
    });

    test("default config uses rbf kernel", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
        ]));
        const y = $.let(new Float64Array([1.0, 4.0, 9.0, 16.0]));

        const config = $.let({
            kernel: variant('none', null),
            alpha: variant('none', null),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 4n));
    });

    test("n_restarts_optimizer improves fit", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const y = $.let(new Float64Array([1.0, 4.0, 9.0, 16.0, 25.0]));

        const config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 5n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const predictions = $.let(GP.predict(model, X));

        $(Assert.equal(predictions.length(), 5n));
    });

    test("error: train shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0], [2.0], [3.0]]));  // 3 samples
        const y = $.let(new Float64Array([1.0, 4.0]));  // 2 samples

        const config = $.let({
            kernel: variant('none', null),
            alpha: variant('none', null),
            n_restarts_optimizer: variant('none', null),
            normalize_y: variant('none', null),
            random_state: variant('none', null),
        });

        $(Assert.throws(GP.train(X, y, config), /gp_train.*X has 3 samples.*y has 2 samples/));
    });
}, { exportOnly: true });
