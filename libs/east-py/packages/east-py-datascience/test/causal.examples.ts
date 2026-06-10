/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, variant, example } from "@elaraai/east";
import { Causal } from "@elaraai/east-py-datascience";

export const causalEffectLinear = example({
    keywords: ["causal", "effect", "backdoor", "linear regression", "ate", "confounder", "adjustment", "dowhy", "observational", "upgrade"],
    description: "Estimate the causal effect of a machine upgrade on yield from observational data, adjusting for operator skill (backdoor linear regression ATE)",
    fn: East.function([], BooleanType, ($) => {
        // Skilled operators were upgraded first, so the raw upgrade/yield
        // association is confounded by skill. True upgrade effect: +2.0.
        // Columns: [upgraded, yield, skill]
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1], [0.0, 0.58, 0.2], [0.0, 0.93, 0.3], [0.0, 1.18, 0.4],
            [0.0, 1.52, 0.5], [0.0, 1.79, 0.6], [0.0, 2.13, 0.7], [0.0, 2.38, 0.8],
            [1.0, 2.62, 0.2], [1.0, 2.88, 0.3], [1.0, 3.22, 0.4], [1.0, 3.53, 0.5],
            [1.0, 3.81, 0.6], [1.0, 4.07, 0.7], [1.0, 4.43, 0.8], [1.0, 4.71, 0.9],
        ]));

        const config = $.let({
            columns: ["upgraded", "yield", "skill"],
            treatment: "upgraded",
            outcome: "yield",
            common_causes: ["skill"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, Causal.Types.CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        // Adjusted estimate recovers the true +2.0 effect
        return result.effect.subtract(East.value(2.0)).abs().less(0.2);
    }),
    inputs: [],
    returns: true,
});

export const causalEffectPropensityAtt = example({
    keywords: ["causal", "att", "propensity score weighting", "ips", "stabilized", "overlap", "trim", "cluster bootstrap", "confidence interval", "campaign"],
    description: "Effect of a promotion campaign on the stores that ran it (propensity-weighted ATT) with overlap trimming and a store-clustered bootstrap CI",
    fn: East.function([], BooleanType, ($) => {
        // Three weekly rows per store - weeks within a store are correlated,
        // so the bootstrap resamples whole stores. True campaign lift: +2.0.
        // Columns: [ran_campaign, sales, traffic, store]
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.61, 0.2, 0.0], [0.0, 0.64, 0.2, 0.0], [1.0, 2.58, 0.2, 0.0],
            [0.0, 0.92, 0.3, 1.0], [1.0, 2.93, 0.3, 1.0], [1.0, 2.87, 0.3, 1.0],
            [0.0, 1.22, 0.4, 2.0], [0.0, 1.18, 0.4, 2.0], [1.0, 3.24, 0.4, 2.0],
            [0.0, 1.49, 0.5, 3.0], [1.0, 3.52, 0.5, 3.0], [1.0, 3.47, 0.5, 3.0],
            [0.0, 1.81, 0.6, 4.0], [1.0, 3.78, 0.6, 4.0], [1.0, 3.83, 0.6, 4.0],
            [0.0, 2.11, 0.7, 5.0], [1.0, 4.08, 0.7, 5.0], [1.0, 4.13, 0.7, 5.0],
            [0.0, 2.42, 0.8, 6.0], [1.0, 4.39, 0.8, 6.0], [1.0, 4.37, 0.8, 6.0],
            [0.0, 0.33, 0.1, 7.0], [0.0, 0.28, 0.1, 7.0], [1.0, 2.33, 0.1, 7.0],
        ]));

        const config = $.let({
            columns: ["ran_campaign", "sales", "traffic", "store"],
            treatment: "ran_campaign",
            outcome: "sales",
            common_causes: ["traffic"],
            categorical: variant('none', null),
            method: variant('some', variant('propensity_score_weighting', {
                weighting_scheme: variant('some', variant('ips_stabilized_weight', null)),
            })),
            target_units: variant('some', variant('att', null)),
            trim: variant('some', variant('overlap', null)),
            bootstrap: variant('some', {
                reps: 50n,
                cluster_column: variant('some', "store"),
                confidence_level: variant('some', 0.95),
            }),
            random_state: variant('some', 42n),
        }, Causal.Types.CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        // ATT near the true +2.0, with a store-clustered bootstrap CI attached
        return result.effect.subtract(East.value(2.0)).abs().less(0.5);
    }),
    inputs: [],
    returns: true,
});

export const causalRefuteSensitivity = example({
    keywords: ["causal", "refute", "placebo", "permute", "unobserved confounder", "sensitivity", "tipping curve", "robustness", "validation"],
    description: "Refute an estimated effect: placebo treatment should drive it to zero, and an unobserved-confounder sensitivity curve shows how strong hidden confounding must be to overturn it",
    fn: East.function([], BooleanType, ($) => {
        // Binary treatment confounded by z; true effect +2.0.
        // Columns: [t, y, z]
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1], [0.0, 0.58, 0.2], [0.0, 0.93, 0.3], [0.0, 1.18, 0.4],
            [0.0, 1.52, 0.5], [0.0, 1.79, 0.6], [0.0, 2.13, 0.7], [0.0, 2.38, 0.8],
            [1.0, 2.62, 0.2], [1.0, 2.88, 0.3], [1.0, 3.22, 0.4], [1.0, 3.53, 0.5],
            [1.0, 3.81, 0.6], [1.0, 4.07, 0.7], [1.0, 4.43, 0.8], [1.0, 4.71, 0.9],
        ]));

        const config = $.let({
            columns: ["t", "y", "z"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, Causal.Types.CausalEffectConfigType);

        // Placebo: permuted treatment - effect should vanish
        const placebo = $.let(Causal.refute(data, config, variant('placebo_treatment', {
            num_simulations: variant('some', 20n),
        })));

        // Sensitivity: simulate hidden confounders of increasing strength -
        // the effect at each strength traces a tipping curve
        const sensitivity = $.let(Causal.refute(data, config, variant('unobserved_common_cause', {
            effect_strengths: [0.0, 0.2, 0.4],
        })));

        const placeboNearZero = $.let(placebo.new_effects.get(0n).abs().less(0.6));
        const curveDecreases = $.let(
            sensitivity.new_effects.get(2n).less(sensitivity.new_effects.get(0n)));
        return placeboNearZero.and(() => curveDecreases);
    }),
    inputs: [],
    returns: true,
});

export const causalDmlCate = example({
    keywords: ["causal", "dml", "double machine learning", "lineardml", "econml", "cate", "heterogeneous", "treatment effect", "nuisance", "discount"],
    description: "Heterogeneous effect of a price discount on demand with LinearDML - nuisance models residualize treatment and outcome, giving per-customer CATE and an ATE confidence interval",
    fn: East.function([], BooleanType, ($) => {
        // Continuous treatment (discount depth), confounded by loyalty (in W).
        // X holds effect modifiers. True average effect: +1.5 per discount unit.
        const Y = $.let(East.Vector.fromArray([
            0.43, 0.86, 1.32, 1.74, 2.21, 2.63, 3.08, 3.52,
            0.82, 1.27, 1.69, 2.16, 2.58, 3.05, 3.46, 3.91,
            0.25, 0.68, 1.12, 1.57, 2.02, 2.44, 2.91, 3.34,
        ]));
        const T = $.let(East.Vector.fromArray([
            0.15, 0.31, 0.48, 0.62, 0.81, 0.95, 1.12, 1.28,
            0.28, 0.45, 0.59, 0.77, 0.92, 1.10, 1.24, 1.41,
            0.03, 0.19, 0.35, 0.52, 0.67, 0.83, 1.01, 1.15,
        ]));
        // Effect modifier: customer size
        const X = $.let(East.Matrix.fromArray([
            [0.2], [0.4], [0.6], [0.8], [0.3], [0.5], [0.7], [0.9],
            [0.1], [0.3], [0.5], [0.7], [0.2], [0.4], [0.6], [0.8],
            [0.9], [0.7], [0.5], [0.3], [0.8], [0.6], [0.4], [0.2],
        ]));
        // Confounder: loyalty
        const W = $.let(East.Matrix.fromArray([
            [0.1], [0.2], [0.3], [0.4], [0.5], [0.6], [0.7], [0.8],
            [0.2], [0.3], [0.4], [0.5], [0.6], [0.7], [0.8], [0.9],
            [0.1], [0.2], [0.3], [0.4], [0.5], [0.6], [0.7], [0.8],
        ]));

        const config = $.let({
            model_y: variant('some', variant('linear', null)),
            model_t: variant('some', variant('linear', null)),
            discrete_treatment: variant('none', null),
            cv_folds: variant('some', 2n),
            confidence_level: variant('some', 0.95),
            random_state: variant('some', 42n),
        }, Causal.Types.CausalDMLConfigType);

        const model = $.let(Causal.dmlTrain(Y, T, X, variant('some', W), config));
        const cate = $.let(Causal.dmlEffect(model, X));
        const ate = $.let(Causal.dmlAte(model, X));

        // One CATE per customer; ATE near the true +1.5
        const lengthOk = $.let(cate.length().equal(24n));
        return lengthOk.and(() => ate.ate.subtract(East.value(1.5)).abs().less(0.4));
    }),
    inputs: [],
    returns: true,
});

export const causalAleDoseResponse = example({
    keywords: ["causal", "ale", "accumulated local effects", "dose response", "lever", "correlated features", "partial dependence", "setpoint", "confidence interval"],
    description: "ALE dose-response curve of a temperature setpoint on process rate - robust to correlated covariates where partial dependence is biased",
    fn: East.function([], BooleanType, ($) => {
        // Setpoint is correlated with ambient temperature; ALE isolates the
        // local effect of the setpoint itself. True slope: +2.0 per unit.
        // Columns: [setpoint, ambient, rate]
        const data = $.let(East.Matrix.fromArray([
            [0.05, 0.21, 0.31], [0.10, 0.27, 0.47], [0.15, 0.24, 0.54], [0.20, 0.33, 0.73],
            [0.25, 0.29, 0.79], [0.30, 0.38, 0.98], [0.35, 0.41, 1.11], [0.40, 0.37, 1.17],
            [0.45, 0.46, 1.36], [0.50, 0.52, 1.52], [0.55, 0.48, 1.58], [0.60, 0.57, 1.77],
            [0.65, 0.61, 1.91], [0.70, 0.58, 1.98], [0.75, 0.66, 2.16], [0.80, 0.72, 2.32],
            [0.85, 0.69, 2.39], [0.90, 0.77, 2.57], [0.95, 0.81, 2.71], [1.00, 0.78, 2.78],
        ]));

        const config = $.let({
            columns: ["setpoint", "ambient", "rate"],
            outcome: "rate",
            feature: "setpoint",
            categorical: variant('none', null),
            grid_size: variant('some', 5n),
            include_ci: variant('some', true),
            confidence_level: variant('some', 0.95),
            emulator: variant('some', {
                n_estimators: variant('some', 200n),
                learning_rate: variant('some', 0.1),
                max_depth: variant('none', null),
                min_samples_leaf: variant('some', 2n),
            }),
            random_state: variant('some', 42n),
        }, Causal.Types.CausalALEConfigType);

        const result = $.let(Causal.ale(data, config));
        // Centered effect rises across the grid - a positive dose-response
        const last = $.let(result.effect.get(result.effect.length().subtract(1n)));
        return last.subtract(result.effect.get(0n)).greater(0.5);
    }),
    inputs: [],
    returns: true,
});
