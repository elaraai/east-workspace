/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PyMC Bayesian inference platform function tests
 */
import { East, variant, ArrayType } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { PyMC, PyMCLayerSpecType } from "@elaraai/east-py-datascience";
import * as ex from "./pymc.examples.js";

describeEast("PyMC platform functions", (test) => {

    Assert.examples(test, { pymcRegression: ex.pymcRegression, pymcHierarchical: ex.pymcHierarchical, pymcMultiLayer: ex.pymcMultiLayer, pymcPosteriorPredictiveCheck: ex.pymcPosteriorPredictiveCheck });

    test("train regression and predict", $ => {
        // Simple linear: y = 2*x + 1
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
            [11.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainRegression(X, Y, config));
        const predict_config = $.let({
            layer: variant('none', null),
            n_samples: variant('some', 50n),
        });
        const predictions = $.let(PyMC.predict(model, X, predict_config));

        // Should return 5x1 matrix
        $(Assert.equal(predictions.rows(), 5n));
        $(Assert.equal(predictions.cols(), 1n));
        // Predictions should be close to observed (within tolerance for low samples)
        $(Assert.less(predictions.get(0n, 0n).subtract(East.value(3.0)).abs(), East.value(3.0)));
        $(Assert.less(predictions.get(4n, 0n).subtract(East.value(11.0)).abs(), East.value(5.0)));
    });

    test("posterior summary returns parameter info", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
            [11.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainRegression(X, Y, config));
        const summary = $.let(PyMC.posteriorSummary(model));

        // Should have at least one parameter summary (beta)
        $(Assert.greaterEqual(summary.length(), 1n));
    });

    test("diagnostics returns convergence info", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
            [11.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainRegression(X, Y, config));
        const diag = $.let(PyMC.diagnostics(model));

        // With 1 chain, rhat is not meaningful but should still return
        $(Assert.greaterEqual(diag.n_divergences, 0n));
    });

    test("predict distribution returns posterior samples", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [2.0],
            [4.0],
            [6.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', false),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainRegression(X, Y, config));
        const predict_config = $.let({
            layer: variant('none', null),
            n_samples: variant('some', 20n),
        });
        const dist = $.let(PyMC.predictDistribution(model, X, predict_config));

        // Should return (n_samples * n_targets) x n_obs or similar shape
        $(Assert.greater(dist.rows(), 0n));
        $(Assert.greater(dist.cols(), 0n));
    });

    test("posterior predictive check", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
            [11.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainRegression(X, Y, config));
        const ppc = $.let(PyMC.posteriorPredictiveCheck(model, X, Y));

        // Should return 1 fit result (1 target column)
        $(Assert.equal(ppc.length(), 1n));
        // MAE should be reasonable
        $(Assert.greaterEqual(ppc.get(0n).mae, East.value(0.0)));
    });

    test("posterior samples returns matrix", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [3.0],
            [5.0],
            [7.0],
            [9.0],
            [11.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainRegression(X, Y, config));
        const samples = $.let(PyMC.posteriorSamples(model, East.value("beta"), 50n));

        // Should return matrix of samples
        $(Assert.equal(samples.rows(), 50n));
        $(Assert.greater(samples.cols(), 0n));
    });

    test("train hierarchical model", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0],
            [2.0],
            [3.0],
            [4.0],
            [5.0],
            [6.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [2.0],
            [4.0],
            [6.0],
            [3.0],
            [5.0],
            [7.0],
        ]));
        const groups = $.let(new BigInt64Array([0n, 0n, 0n, 1n, 1n, 1n]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            pooling: variant('some', variant('partial', null)),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        const model = $.let(PyMC.trainHierarchical(X, Y, groups, config));
        const predict_config = $.let({
            layer: variant('none', null),
            n_samples: variant('some', 50n),
        });
        const predictions = $.let(PyMC.predict(model, X, predict_config));

        $(Assert.equal(predictions.rows(), 6n));
        $(Assert.equal(predictions.cols(), 1n));
    });

    test("train multi-layer model", $ => {
        const data = $.let([
            {
                name: East.value("X"),
                data: East.Matrix.fromArray([
                    [1.0, 0.5],
                    [2.0, 1.0],
                    [3.0, 1.5],
                    [4.0, 2.0],
                    [5.0, 2.5],
                ]),
            },
            {
                name: East.value("Y"),
                data: East.Matrix.fromArray([
                    [3.0],
                    [5.0],
                    [7.0],
                    [9.0],
                    [11.0],
                ]),
            },
        ]);

        const layers = $.let([
            {
                name: East.value("layer1"),
                input: East.value("X"),
                output: East.value("Y"),
                parameter: East.value("beta"),
                likelihood: variant('none' as const, null),
            },
        ], ArrayType(PyMCLayerSpecType));

        const config = $.let({
            layers,
            priors: variant('none', null),
            masks: variant('none', null),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
            force_full_mcmc: variant('some', true),
            fallback_l1_alpha: variant('none', null),
        });

        const model = $.let(PyMC.trainMultiLayer(data, config));
        const predict_config = $.let({
            layer: variant('some', East.value("layer1")),
            n_samples: variant('some', 50n),
        });
        const predictions = $.let(PyMC.predict(model, East.Matrix.fromArray([
            [1.0, 0.5],
            [2.0, 1.0],
        ]), predict_config));

        $(Assert.equal(predictions.rows(), 2n));
    });

    test("error: shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0], [2.0], [3.0]]));  // 3 samples
        const Y = $.let(East.Matrix.fromArray([[1.0], [2.0]]));  // 2 samples

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('none', null),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        });

        $(Assert.throws(PyMC.trainRegression(X, Y, config), /pymc_train_regression.*3 samples.*2 samples/));
    });
}, { exportOnly: true });
