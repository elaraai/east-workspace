/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, StructType, FloatType, BooleanType, variant, example } from "@elaraai/east";
import { Causal } from "@elaraai/east-py-datascience";

// The effect/refute/ale functions are generic over the row struct: they take an
// `Array<Struct>` (fields are the columns) and the row type is passed as the
// type argument, e.g. `Causal.effect([RowType], data, config)`.

export const causalEffectLinear = example({
    keywords: ["causal", "effect", "backdoor", "linear regression", "ate", "confounder", "adjustment", "dowhy", "observational", "upgrade"],
    description: "Estimate the causal effect of a machine upgrade on yield from observational data, adjusting for operator skill (backdoor linear regression ATE)",
    fn: East.function([], BooleanType, ($) => {
        // Skilled operators were upgraded first, so the raw upgrade/yield
        // association is confounded by skill. True upgrade effect: +2.0.
        const RowType = StructType({ upgraded: FloatType, yield: FloatType, skill: FloatType });
        const data = $.let([
            { upgraded: 0.0, yield: 0.32, skill: 0.1 }, { upgraded: 0.0, yield: 0.58, skill: 0.2 },
            { upgraded: 0.0, yield: 0.93, skill: 0.3 }, { upgraded: 0.0, yield: 1.18, skill: 0.4 },
            { upgraded: 0.0, yield: 1.52, skill: 0.5 }, { upgraded: 0.0, yield: 1.79, skill: 0.6 },
            { upgraded: 0.0, yield: 2.13, skill: 0.7 }, { upgraded: 0.0, yield: 2.38, skill: 0.8 },
            { upgraded: 1.0, yield: 2.62, skill: 0.2 }, { upgraded: 1.0, yield: 2.88, skill: 0.3 },
            { upgraded: 1.0, yield: 3.22, skill: 0.4 }, { upgraded: 1.0, yield: 3.53, skill: 0.5 },
            { upgraded: 1.0, yield: 3.81, skill: 0.6 }, { upgraded: 1.0, yield: 4.07, skill: 0.7 },
            { upgraded: 1.0, yield: 4.43, skill: 0.8 }, { upgraded: 1.0, yield: 4.71, skill: 0.9 },
        ], ArrayType(RowType));

        const config = $.let({
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

        const result = $.let(Causal.effect([RowType], data, config));
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
        const RowType = StructType({ ran_campaign: FloatType, sales: FloatType, traffic: FloatType, store: FloatType });
        const data = $.let([
            { ran_campaign: 0.0, sales: 0.61, traffic: 0.2, store: 0.0 }, { ran_campaign: 0.0, sales: 0.64, traffic: 0.2, store: 0.0 }, { ran_campaign: 1.0, sales: 2.58, traffic: 0.2, store: 0.0 },
            { ran_campaign: 0.0, sales: 0.92, traffic: 0.3, store: 1.0 }, { ran_campaign: 1.0, sales: 2.93, traffic: 0.3, store: 1.0 }, { ran_campaign: 1.0, sales: 2.87, traffic: 0.3, store: 1.0 },
            { ran_campaign: 0.0, sales: 1.22, traffic: 0.4, store: 2.0 }, { ran_campaign: 0.0, sales: 1.18, traffic: 0.4, store: 2.0 }, { ran_campaign: 1.0, sales: 3.24, traffic: 0.4, store: 2.0 },
            { ran_campaign: 0.0, sales: 1.49, traffic: 0.5, store: 3.0 }, { ran_campaign: 1.0, sales: 3.52, traffic: 0.5, store: 3.0 }, { ran_campaign: 1.0, sales: 3.47, traffic: 0.5, store: 3.0 },
            { ran_campaign: 0.0, sales: 1.81, traffic: 0.6, store: 4.0 }, { ran_campaign: 1.0, sales: 3.78, traffic: 0.6, store: 4.0 }, { ran_campaign: 1.0, sales: 3.83, traffic: 0.6, store: 4.0 },
            { ran_campaign: 0.0, sales: 2.11, traffic: 0.7, store: 5.0 }, { ran_campaign: 1.0, sales: 4.08, traffic: 0.7, store: 5.0 }, { ran_campaign: 1.0, sales: 4.13, traffic: 0.7, store: 5.0 },
            { ran_campaign: 0.0, sales: 2.42, traffic: 0.8, store: 6.0 }, { ran_campaign: 1.0, sales: 4.39, traffic: 0.8, store: 6.0 }, { ran_campaign: 1.0, sales: 4.37, traffic: 0.8, store: 6.0 },
            { ran_campaign: 0.0, sales: 0.33, traffic: 0.1, store: 7.0 }, { ran_campaign: 0.0, sales: 0.28, traffic: 0.1, store: 7.0 }, { ran_campaign: 1.0, sales: 2.33, traffic: 0.1, store: 7.0 },
        ], ArrayType(RowType));

        const config = $.let({
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

        const result = $.let(Causal.effect([RowType], data, config));
        // ATT near the true +2.0, with a store-clustered bootstrap CI attached
        return result.effect.subtract(East.value(2.0)).abs().less(0.5);
    }),
    inputs: [],
    returns: true,
});

export const causalEffectConfounding = example({
    keywords: ["causal", "effect", "confounding", "confounding by indication", "sign flip", "naive", "adjusted", "selection", "experiment"],
    description: "Confounding by indication: an optional slow-cure step is applied to weaker incoming material, so the raw difference in bond strength is negative while the like-for-like (adjusted) effect is positive — the sign flip the Experiment surface visualises",
    fn: East.function([], BooleanType, ($) => {
        // slow_cure is applied preferentially to low incoming_grade batches.
        // Raw average bond_strength of cured batches is LOWER; adjusting for
        // incoming_grade reveals the true positive effect of the cure.
        const RowType = StructType({ slow_cure: FloatType, bond_strength: FloatType, incoming_grade: FloatType });
        const data = $.let([
            // un-cured batches: strong incoming material, no cure
            { slow_cure: 0.0, bond_strength: 9.0, incoming_grade: 9.0 }, { slow_cure: 0.0, bond_strength: 8.6, incoming_grade: 8.5 },
            { slow_cure: 0.0, bond_strength: 8.2, incoming_grade: 8.0 }, { slow_cure: 0.0, bond_strength: 7.7, incoming_grade: 7.5 },
            { slow_cure: 0.0, bond_strength: 7.3, incoming_grade: 7.0 }, { slow_cure: 0.0, bond_strength: 6.8, incoming_grade: 6.5 },
            { slow_cure: 0.0, bond_strength: 6.4, incoming_grade: 6.0 }, { slow_cure: 0.0, bond_strength: 5.9, incoming_grade: 5.5 },
            // cured batches: weak incoming material, +2.0 cure lift
            { slow_cure: 1.0, bond_strength: 7.1, incoming_grade: 5.0 }, { slow_cure: 1.0, bond_strength: 6.6, incoming_grade: 4.5 },
            { slow_cure: 1.0, bond_strength: 6.2, incoming_grade: 4.0 }, { slow_cure: 1.0, bond_strength: 5.8, incoming_grade: 3.5 },
            { slow_cure: 1.0, bond_strength: 5.3, incoming_grade: 3.0 }, { slow_cure: 1.0, bond_strength: 4.9, incoming_grade: 2.5 },
            { slow_cure: 1.0, bond_strength: 4.4, incoming_grade: 2.0 }, { slow_cure: 1.0, bond_strength: 4.0, incoming_grade: 1.5 },
        ], ArrayType(RowType));

        const baseConfig = {
            treatment: "slow_cure",
            outcome: "bond_strength",
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        } as const;

        // adjusted: control for the incoming grade (the backdoor)
        const adjusted = $.let(Causal.effect([RowType], data, $.let({
            ...baseConfig, common_causes: ["incoming_grade"],
        }, Causal.Types.CausalEffectConfigType)));
        // naive: no adjustment at all (empty backdoor set) — the raw cured-vs-uncured
        // difference, which is confounded because slow-cure went to weaker material.
        const naive = $.let(Causal.effect([RowType], data, $.let({
            ...baseConfig, common_causes: [],
        }, Causal.Types.CausalEffectConfigType)));

        // The sign flip: naive < 0 < adjusted.
        return naive.effect.less(0.0).and(() => adjusted.effect.greater(0.0));
    }),
    inputs: [],
    returns: true,
});

export const causalRefuteSensitivity = example({
    keywords: ["causal", "refute", "placebo", "permute", "unobserved confounder", "sensitivity", "tipping curve", "robustness", "validation"],
    description: "Refute an estimated effect: placebo treatment should drive it to zero, and an unobserved-confounder sensitivity curve shows how strong hidden confounding must be to overturn it",
    fn: East.function([], BooleanType, ($) => {
        // Binary treatment confounded by z; true effect +2.0.
        const RowType = StructType({ t: FloatType, y: FloatType, z: FloatType });
        const data = $.let([
            { t: 0.0, y: 0.32, z: 0.1 }, { t: 0.0, y: 0.58, z: 0.2 }, { t: 0.0, y: 0.93, z: 0.3 }, { t: 0.0, y: 1.18, z: 0.4 },
            { t: 0.0, y: 1.52, z: 0.5 }, { t: 0.0, y: 1.79, z: 0.6 }, { t: 0.0, y: 2.13, z: 0.7 }, { t: 0.0, y: 2.38, z: 0.8 },
            { t: 1.0, y: 2.62, z: 0.2 }, { t: 1.0, y: 2.88, z: 0.3 }, { t: 1.0, y: 3.22, z: 0.4 }, { t: 1.0, y: 3.53, z: 0.5 },
            { t: 1.0, y: 3.81, z: 0.6 }, { t: 1.0, y: 4.07, z: 0.7 }, { t: 1.0, y: 4.43, z: 0.8 }, { t: 1.0, y: 4.71, z: 0.9 },
        ], ArrayType(RowType));

        const config = $.let({
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
        const placebo = $.let(Causal.refute([RowType], data, config, variant('placebo_treatment', {
            num_simulations: variant('some', 20n),
        })));

        // Sensitivity: simulate hidden confounders of increasing strength -
        // the effect at each strength traces a tipping curve
        const sensitivity = $.let(Causal.refute([RowType], data, config, variant('unobserved_common_cause', {
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
        const RowType = StructType({ setpoint: FloatType, ambient: FloatType, rate: FloatType });
        const data = $.let([
            { setpoint: 0.05, ambient: 0.21, rate: 0.31 }, { setpoint: 0.10, ambient: 0.27, rate: 0.47 }, { setpoint: 0.15, ambient: 0.24, rate: 0.54 }, { setpoint: 0.20, ambient: 0.33, rate: 0.73 },
            { setpoint: 0.25, ambient: 0.29, rate: 0.79 }, { setpoint: 0.30, ambient: 0.38, rate: 0.98 }, { setpoint: 0.35, ambient: 0.41, rate: 1.11 }, { setpoint: 0.40, ambient: 0.37, rate: 1.17 },
            { setpoint: 0.45, ambient: 0.46, rate: 1.36 }, { setpoint: 0.50, ambient: 0.52, rate: 1.52 }, { setpoint: 0.55, ambient: 0.48, rate: 1.58 }, { setpoint: 0.60, ambient: 0.57, rate: 1.77 },
            { setpoint: 0.65, ambient: 0.61, rate: 1.91 }, { setpoint: 0.70, ambient: 0.58, rate: 1.98 }, { setpoint: 0.75, ambient: 0.66, rate: 2.16 }, { setpoint: 0.80, ambient: 0.72, rate: 2.32 },
            { setpoint: 0.85, ambient: 0.69, rate: 2.39 }, { setpoint: 0.90, ambient: 0.77, rate: 2.57 }, { setpoint: 0.95, ambient: 0.81, rate: 2.71 }, { setpoint: 1.00, ambient: 0.78, rate: 2.78 },
        ], ArrayType(RowType));

        const config = $.let({
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

        const result = $.let(Causal.ale([RowType], data, config));
        // Centered effect rises across the grid - a positive dose-response
        const last = $.let(result.effect.get(result.effect.length().subtract(1n)));
        return last.subtract(result.effect.get(0n)).greater(0.5);
    }),
    inputs: [],
    returns: true,
});
