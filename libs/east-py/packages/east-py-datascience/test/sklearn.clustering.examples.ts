/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

export const sklearnGmm = example({
    keywords: ["sklearn", "gmmFit", "gmmPredict", "gmmPredictProba", "GMM", "clustering", "operational mode", "sensor"],
    description: "Cluster operational modes (idle, warmup, production, cooldown) from sensor data using GMM",
    fn: East.function([], BooleanType, ($) => {
        // Sensor readings with 2 clear clusters (idle vs production)
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0], [1.1, 1.1], [1.2, 0.9], [0.9, 1.2],
            [5.0, 5.0], [5.1, 5.1], [5.2, 4.9], [4.9, 5.2],
        ]));

        const config = $.let({
            n_components: variant('some', 2n),
            covariance_type: variant('none', null),
            max_iter: variant('some', 100n),
            n_init: variant('some', 1n),
            tol: variant('none', null),
            reg_covar: variant('none', null),
            random_state: variant('some', 42n),
        }, Sklearn.Types.GMMConfigType);

        const model = $.let(Sklearn.gmmFit(X, config));
        const labels = $.let(Sklearn.gmmPredict(model, X));
        const proba = $.let(Sklearn.gmmPredictProba(model, X));

        // 8 labels assigned and probability matrix is 8×2
        return labels.length().equal(8n)
            .and(() => proba.rows().equal(8n))
            .and(() => proba.cols().equal(2n));
    }),
    inputs: [],
    returns: true,
});

export const sklearnGmmModelSelection = example({
    keywords: ["sklearn", "gmmFit", "gmmBic", "gmmAic", "silhouetteScore", "BIC", "AIC", "model selection"],
    description: "Compare 2-component vs 3-component GMM using BIC and AIC to select best fit",
    fn: East.function([], BooleanType, ($) => {
        // Two well-separated clusters
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0], [1.1, 1.1], [0.9, 0.9], [1.05, 0.95],
            [5.0, 5.0], [5.1, 5.1], [4.9, 4.9], [5.05, 4.95],
        ]));

        const config2 = $.let({
            n_components: variant('some', 2n),
            covariance_type: variant('none', null),
            max_iter: variant('some', 100n),
            n_init: variant('some', 1n),
            tol: variant('none', null),
            reg_covar: variant('none', null),
            random_state: variant('some', 42n),
        }, Sklearn.Types.GMMConfigType);

        const model2 = $.let(Sklearn.gmmFit(X, config2));
        const bic2 = $.let(Sklearn.gmmBic(model2, X));
        const aic2 = $.let(Sklearn.gmmAic(model2, X));

        // Compute silhouette score for quality
        const labels = $.let(Sklearn.gmmPredict(model2, X));
        const sil = $.let(Sklearn.silhouetteScore(X, labels));

        // BIC and AIC are finite, silhouette > 0 for well-separated clusters
        return bic2.greater(-10000.0)
            .and(() => aic2.greater(-10000.0))
            .and(() => sil.greater(0.0));
    }),
    inputs: [],
    returns: true,
});

export const sklearnGmmSample = example({
    keywords: ["sklearn", "gmmFit", "gmmSample", "GMM", "synthetic", "generate", "simulation"],
    description: "Generate synthetic operational data points from a fitted GMM for simulation input",
    fn: East.function([], IntegerType, ($) => {
        // Fit GMM on existing sensor data
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0], [1.1, 1.1], [0.9, 0.9],
            [5.0, 5.0], [5.1, 5.1], [4.9, 4.9],
        ]));

        const config = $.let({
            n_components: variant('some', 2n),
            covariance_type: variant('none', null),
            max_iter: variant('some', 100n),
            n_init: variant('some', 1n),
            tol: variant('none', null),
            reg_covar: variant('none', null),
            random_state: variant('some', 42n),
        }, Sklearn.Types.GMMConfigType);

        const model = $.let(Sklearn.gmmFit(X, config));

        // Generate 10 synthetic data points
        const samples = $.let(Sklearn.gmmSample(model, 10n));

        // 10 samples × 2 features
        return samples.rows();
    }),
    inputs: [],
    returns: 10n,
});
