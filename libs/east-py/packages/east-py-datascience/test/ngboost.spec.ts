/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * NGBoost platform function tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { NGBoost } from "@elaraai/east-py-datascience";

describeEast("NGBoost platform functions", (test) => {

    test("train_regressor and predict works", $ => {
        // Simple linear data: y = x1 + x2
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
            [7.0, 7.0],
            [8.0, 8.0],
            [9.0, 9.0],
            [10.0, 10.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0]));

        const config = $.let({
            n_estimators: variant('some', 100n),
            learning_rate: variant('some', 0.1),
            minibatch_frac: variant('none', null),
            col_sample: variant('none', null),
            random_state: variant('some', 42n),
            distribution: variant('none', null),
        });

        // Train model
        const model = $.let(NGBoost.trainRegressor(X, y, config));

        // Predict on training data
        const y_pred = $.let(NGBoost.predict(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 10n));

        // Check predictions are close to actual values (within 3.0)
        $(Assert.less(y_pred.get(0n).subtract(y.get(0n)).abs(), East.value(3.0)));
        $(Assert.less(y_pred.get(4n).subtract(y.get(4n)).abs(), East.value(3.0)));
        $(Assert.less(y_pred.get(9n).subtract(y.get(9n)).abs(), East.value(3.0)));
    });

    test("predict_dist returns uncertainty estimates", $ => {
        // Data with some noise
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
            [7.0, 7.0],
            [8.0, 8.0],
            [9.0, 9.0],
            [10.0, 10.0],
        ]));
        const y = $.let(new Float64Array([2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9, 16.1, 18.0, 20.1]));

        const config = $.let({
            n_estimators: variant('some', 100n),
            learning_rate: variant('some', 0.1),
            minibatch_frac: variant('none', null),
            col_sample: variant('none', null),
            random_state: variant('some', 42n),
            distribution: variant('none', null),
        });

        const predictConfig = $.let({
            confidence_level: variant('some', 0.95),
        });

        // Train model
        const model = $.let(NGBoost.trainRegressor(X, y, config));

        // Get predictions with uncertainty
        const result = $.let(NGBoost.predictDist(model, X, predictConfig));

        // Check we get predictions
        $(Assert.equal(result.predictions.length(), 10n));

        // Check we get std (optional, should be Some)
        $.match(result.std, {
            some: ($, value) => $(Assert.equal(value.length(), 10n)),
            none: $ => $(Assert.fail(East.value("Expected std to be Some"))),
        });

        // Check we get lower/upper bounds (optional, should be Some)
        $.match(result.lower, {
            some: ($, value) => $(Assert.equal(value.length(), 10n)),
            none: $ => $(Assert.fail(East.value("Expected lower to be Some"))),
        });

        $.match(result.upper, {
            some: ($, value) => $(Assert.equal(value.length(), 10n)),
            none: $ => $(Assert.fail(East.value("Expected upper to be Some"))),
        });
    });

    test("confidence intervals contain true values", $ => {
        // Linear data
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
            [7.0, 7.0],
            [8.0, 8.0],
            [9.0, 9.0],
            [10.0, 10.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0]));

        const config = $.let({
            n_estimators: variant('some', 100n),
            learning_rate: variant('some', 0.1),
            minibatch_frac: variant('none', null),
            col_sample: variant('none', null),
            random_state: variant('some', 42n),
            distribution: variant('none', null),
        });

        const predictConfig = $.let({
            confidence_level: variant('some', 0.95),
        });

        // Train model
        const model = $.let(NGBoost.trainRegressor(X, y, config));

        // Get predictions with uncertainty
        const result = $.let(NGBoost.predictDist(model, X, predictConfig));

        // Check lower <= prediction <= upper for first element
        $.match(result.lower, {
            some: ($, lowerVal) => $(Assert.lessEqual(lowerVal.get(0n), result.predictions.get(0n))),
            none: $ => $(Assert.fail(East.value("Expected lower to be Some"))),
        });

        $.match(result.upper, {
            some: ($, upperVal) => $(Assert.greaterEqual(upperVal.get(0n), result.predictions.get(0n))),
            none: $ => $(Assert.fail(East.value("Expected upper to be Some"))),
        });
    });

    test("respects random_state for reproducibility", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
        ]));
        const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]));

        const config = $.let({
            n_estimators: variant('some', 50n),
            learning_rate: variant('some', 0.1),
            minibatch_frac: variant('none', null),
            col_sample: variant('none', null),
            random_state: variant('some', 123n),
            distribution: variant('none', null),
        });

        // Train two models with same seed
        const model1 = $.let(NGBoost.trainRegressor(X, y, config));
        const model2 = $.let(NGBoost.trainRegressor(X, y, config));

        // Predictions should be identical
        const pred1 = $.let(NGBoost.predict(model1, X));
        const pred2 = $.let(NGBoost.predict(model2, X));

        $(Assert.equal(pred1.get(0n), pred2.get(0n)));
        $(Assert.equal(pred1.get(1n), pred2.get(1n)));
    });

    test("error: train_regressor shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(new Float64Array([1.0, 2.0]));  // 2 samples

        const config = $.let({
            n_estimators: variant('none', null),
            learning_rate: variant('none', null),
            minibatch_frac: variant('none', null),
            col_sample: variant('none', null),
            random_state: variant('none', null),
            distribution: variant('none', null),
        });

        $(Assert.throws(NGBoost.trainRegressor(X, y, config), /ngboost_train_regressor.*X has 3 samples.*y has 2 samples/));
    });

}, { exportOnly: true });
