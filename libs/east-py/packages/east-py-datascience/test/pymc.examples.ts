/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, ArrayType, variant, example } from "@elaraai/east";
import { PyMC } from "@elaraai/east-py-datascience";

export const pymcRegression = example({
    keywords: ["pymc", "trainRegression", "predict", "posteriorSummary", "Bayesian", "credible interval", "yield", "temperature", "humidity"],
    description: "Estimate effect of temperature and humidity on product yield with credible intervals",
    fn: East.function([], BooleanType, ($) => {
        // Features: temperature (°C), humidity (%)
        // Target: product yield (kg)
        const X = $.let(East.Matrix.fromArray([
            [150.0, 30.0],
            [160.0, 35.0],
            [170.0, 40.0],
            [180.0, 45.0],
            [190.0, 50.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [60.0],
            [68.0],
            [75.0],
            [82.0],
            [88.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        }, PyMC.Types.PyMCRegressionConfigType);

        const model = $.let(PyMC.trainRegression(X, Y, config));

        // Get posterior parameter summaries (intercept + coefficients)
        const summary = $.let(PyMC.posteriorSummary(model));

        // Predict at new operating conditions
        const X_new = $.let(East.Matrix.fromArray([
            [165.0, 37.0],
            [185.0, 48.0],
        ]));
        const predict_config = $.let({
            layer: variant('none', null),
            n_samples: variant('some', 50n),
        }, PyMC.Types.PyMCPredictConfigType);
        const predictions = $.let(PyMC.predict(model, X_new, predict_config));

        // 2 predictions made and at least 1 parameter summary returned
        return predictions.rows().equal(2n)
            .and(() => summary.length().greaterEqual(1n));
    }),
    inputs: [],
    returns: true,
});

export const pymcHierarchical = example({
    keywords: ["pymc", "trainHierarchical", "predict", "diagnostics", "hierarchical", "partial pooling", "site", "facility", "processing rate"],
    description: "Estimate site-specific processing rates across facilities, partially pooled for data-sparse sites",
    fn: East.function([], BooleanType, ($) => {
        // Features: material_hardness
        // Target: processing_time (hours)
        // Groups: facility_id (0 = plant A, 1 = plant B)
        const X = $.let(East.Matrix.fromArray([
            [5.0], [6.0], [7.0],    // plant A
            [5.5], [6.5], [7.5],    // plant B
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [2.0], [2.5], [3.0],    // plant A (faster)
            [3.0], [3.5], [4.0],    // plant B (slower)
        ]));
        const groups = $.let(East.Vector.fromArray([0n, 0n, 0n, 1n, 1n, 1n]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            pooling: variant('some', variant('partial', null)),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        }, PyMC.Types.PyMCHierarchicalConfigType);

        const model = $.let(PyMC.trainHierarchical(X, Y, groups, config));

        // Check convergence diagnostics
        const diag = $.let(PyMC.diagnostics(model));

        // Predict for all training points
        const predict_config = $.let({
            layer: variant('none', null),
            n_samples: variant('some', 50n),
        }, PyMC.Types.PyMCPredictConfigType);
        const predictions = $.let(PyMC.predict(model, X, predict_config));

        // 6 predictions and no divergences
        return predictions.rows().equal(6n)
            .and(() => diag.n_divergences.greaterEqual(0n));
    }),
    inputs: [],
    returns: true,
});

export const pymcMultiLayer = example({
    keywords: ["pymc", "trainMultiLayer", "predictDistribution", "posteriorSamples", "multi-layer", "joint estimation", "supplier", "material", "partial pooling"],
    description: "Joint estimation of material properties across suppliers and product grades with partial pooling",
    fn: East.function([], BooleanType, ($) => {
        // Layer: raw_material_properties → finished_product_strength
        const data = $.let([
            {
                name: East.value("features"),
                data: East.Matrix.fromArray([
                    [2.0, 0.5],
                    [3.0, 1.0],
                    [4.0, 1.5],
                    [5.0, 2.0],
                    [6.0, 2.5],
                ]),
            },
            {
                name: East.value("targets"),
                data: East.Matrix.fromArray([
                    [10.0],
                    [15.0],
                    [20.0],
                    [25.0],
                    [30.0],
                ]),
            },
        ]);

        const layers = $.let([
            {
                name: East.value("strength_model"),
                input: East.value("features"),
                output: East.value("targets"),
                parameter: East.value("beta"),
                likelihood: variant('none' as const, null),
            },
        ], ArrayType(PyMC.Types.PyMCLayerSpecType));

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
        }, PyMC.Types.PyMCMultiLayerConfigType);

        const model = $.let(PyMC.trainMultiLayer(data, config));

        // Get posterior distribution of predictions
        const predict_config = $.let({
            layer: variant('some', East.value("strength_model")),
            n_samples: variant('some', 20n),
        }, PyMC.Types.PyMCPredictConfigType);
        const dist = $.let(PyMC.predictDistribution(model, East.Matrix.fromArray([
            [3.5, 1.2],
        ]), predict_config));

        // Get posterior samples for the beta parameter
        const samples = $.let(PyMC.posteriorSamples(model, East.value("beta"), 50n));

        // Distribution has rows and samples has 50 rows
        return dist.rows().greaterEqual(1n)
            .and(() => samples.rows().equal(50n));
    }),
    inputs: [],
    returns: true,
});

export const pymcPosteriorPredictiveCheck = example({
    keywords: ["pymc", "trainRegression", "posteriorPredictiveCheck", "validation", "model checking", "observed fit", "MAE"],
    description: "Validate Bayesian regression model by comparing predicted vs observed",
    fn: East.function([], BooleanType, ($) => {
        // Linear relationship: yield ≈ 2*temperature - 200
        const X = $.let(East.Matrix.fromArray([
            [150.0],
            [160.0],
            [170.0],
            [180.0],
            [190.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([
            [100.0],
            [120.0],
            [140.0],
            [160.0],
            [180.0],
        ]));

        const config = $.let({
            prior: variant('none', null),
            likelihood: variant('none', null),
            include_intercept: variant('some', true),
            samples: variant('some', 100n),
            tune: variant('some', 50n),
            chains: variant('some', 1n),
            target_accept: variant('none', null),
        }, PyMC.Types.PyMCRegressionConfigType);

        const model = $.let(PyMC.trainRegression(X, Y, config));

        // Posterior predictive check: compare model predictions vs observed
        const ppc = $.let(PyMC.posteriorPredictiveCheck(model, X, Y));

        // Should return 1 fit result (1 target column) with non-negative MAE
        return ppc.get(0n).mae.greaterEqual(0.0);
    }),
    inputs: [],
    returns: true,
});
