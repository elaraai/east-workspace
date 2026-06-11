/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Causal inference platform function tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Causal, CausalEffectConfigType, CausalDMLConfigType, CausalALEConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./causal.examples.js";

describeEast("Causal platform functions", (test) => {

    Assert.examples(test, {
        causalEffectLinear: ex.causalEffectLinear,
        causalEffectPropensityAtt: ex.causalEffectPropensityAtt,
        causalRefuteSensitivity: ex.causalRefuteSensitivity,
        causalDmlCate: ex.causalDmlCate,
        causalAleDoseResponse: ex.causalAleDoseResponse,
    });

    test("linear regression recovers confounded effect", $ => {
        // y = 2*t + 3*z (+/- 0.03); treatment assigned more often at high z.
        // Columns: [t, y, z, batch]
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.2)));
        $(Assert.equal(result.n_samples, 16n));
        $(Assert.equal(result.n_treated, 8n));
        $(Assert.equal(result.n_control, 8n));
    });

    test("propensity weighting att with overlap trim", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('propensity_score_weighting', {
                weighting_scheme: variant('some', variant('ips_stabilized_weight', null)),
            })),
            target_units: variant('some', variant('att', null)),
            trim: variant('some', variant('overlap', null)),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.5)));
    });

    test("propensity weighting ate with bounds trim and raw weights", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('propensity_score_weighting', {
                weighting_scheme: variant('some', variant('ips_weight', null)),
            })),
            target_units: variant('some', variant('ate', null)),
            trim: variant('some', variant('bounds', { lower: 0.05, upper: 0.95 })),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.5)));
    });

    test("cluster bootstrap confidence interval", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('some', {
                reps: 50n,
                cluster_column: variant('some', "batch"),
                confidence_level: variant('some', 0.95),
            }),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        $.match(result.ci, {
            some: ($, ci) => {
                $(Assert.lessEqual(ci.lower, ci.upper));
                $(Assert.greater(ci.upper, East.value(1.5)));
                $(Assert.less(ci.lower, East.value(2.5)));
            },
            none: $ => $(Assert.fail(East.value("Expected bootstrap CI"))),
        });
    });

    test("categorical confounder is one-hot encoded", $ => {
        // y = 2*t + 1.0*[cat=1] + 2.0*[cat=2] (+/- 0.05); treatment more
        // likely at higher cat. Columns: [t, y, cat]
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.05, 0.0], [0.0, -0.03, 0.0], [0.0, 0.01, 0.0], [1.0, 2.04, 0.0], [1.0, 1.97, 0.0],
            [0.0, 1.02, 1.0], [0.0, 0.97, 1.0], [1.0, 3.05, 1.0], [1.0, 2.96, 1.0], [1.0, 3.01, 1.0],
            [0.0, 2.03, 2.0], [0.0, 1.96, 2.0], [1.0, 4.02, 2.0], [1.0, 3.99, 2.0], [1.0, 4.05, 2.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "cat"],
            treatment: "t",
            outcome: "y",
            common_causes: ["cat"],
            categorical: variant('some', ["cat"]),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect(data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.2)));
    });

    test("placebo treatment refuter drives effect to zero", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute(data, config, variant('placebo_treatment', {
            num_simulations: variant('some', 20n),
        })));
        $(Assert.less(result.estimated_effect.subtract(East.value(2.0)).abs(), East.value(0.2)));
        $(Assert.equal(result.new_effects.length(), 1n));
        $(Assert.less(result.new_effects.get(0n).abs(), East.value(0.6)));
    });

    test("random common cause refuter leaves effect unchanged", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute(data, config, variant('random_common_cause', {
            num_simulations: variant('some', 10n),
        })));
        $(Assert.less(result.new_effects.get(0n).subtract(result.estimated_effect).abs(), East.value(0.3)));
    });

    test("data subset refuter is stable", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute(data, config, variant('data_subset', {
            subset_fraction: variant('some', 0.8),
            num_simulations: variant('some', 10n),
        })));
        $(Assert.less(result.new_effects.get(0n).subtract(result.estimated_effect).abs(), East.value(0.3)));
    });

    test("unobserved confounder sensitivity curve", $ => {
        const data = $.let(East.Matrix.fromArray([
            [0.0, 0.32, 0.1, 0.0], [1.0, 2.62, 0.2, 0.0],
            [0.0, 0.58, 0.2, 1.0], [1.0, 2.88, 0.3, 1.0],
            [0.0, 0.93, 0.3, 2.0], [1.0, 3.22, 0.4, 2.0],
            [0.0, 1.18, 0.4, 3.0], [1.0, 3.53, 0.5, 3.0],
            [0.0, 1.52, 0.5, 4.0], [1.0, 3.81, 0.6, 4.0],
            [0.0, 1.79, 0.6, 5.0], [1.0, 4.07, 0.7, 5.0],
            [0.0, 2.13, 0.7, 6.0], [1.0, 4.43, 0.8, 6.0],
            [0.0, 2.38, 0.8, 7.0], [1.0, 4.71, 0.9, 7.0],
        ]));
        const config = $.let({
            columns: ["t", "y", "z", "batch"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute(data, config, variant('unobserved_common_cause', {
            effect_strengths: [0.0, 0.2, 0.4],
        })));
        $(Assert.equal(result.new_effects.length(), 3n));
        // Zero strength leaves the estimate unchanged
        $(Assert.less(result.new_effects.get(0n).subtract(result.estimated_effect).abs(), East.value(0.05)));
        // Stronger simulated confounding erodes the estimated effect
        $(Assert.less(result.new_effects.get(2n), result.new_effects.get(0n)));
    });

    test("dml recovers effect with linear nuisances", $ => {
        // Y = 1.5*T + 2*loyalty (+/- 0.02); T rises with loyalty.
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
        const X = $.let(East.Matrix.fromArray([
            [0.2], [0.4], [0.6], [0.8], [0.3], [0.5], [0.7], [0.9],
            [0.1], [0.3], [0.5], [0.7], [0.2], [0.4], [0.6], [0.8],
            [0.9], [0.7], [0.5], [0.3], [0.8], [0.6], [0.4], [0.2],
        ]));
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
        }, CausalDMLConfigType);

        const model = $.let(Causal.dmlTrain(Y, T, X, variant('some', W), config));
        const cate = $.let(Causal.dmlEffect(model, X));
        const ate = $.let(Causal.dmlAte(model, X));

        $(Assert.equal(cate.length(), 24n));
        $(Assert.less(ate.ate.subtract(East.value(1.5)).abs(), East.value(0.3)));
        $(Assert.lessEqual(ate.lower, ate.ate));
        $(Assert.lessEqual(ate.ate, ate.upper));
    });

    test("dml discrete treatment with gradient boosting and linear nuisances", $ => {
        // Y = 2*T + z (+/- 0.03); binary T more likely at high z.
        const Y = $.let(East.Vector.fromArray([
            0.12, 0.21, 0.33, 0.38, 0.52, 0.61, 0.73, 0.79, 0.91, 1.02,
            2.31, 2.42, 2.48, 2.63, 2.69, 2.81, 2.92, 2.98, 3.12, 3.21,
        ]));
        const T = $.let(East.Vector.fromArray([
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
        ]));
        const X = $.let(East.Matrix.fromArray([
            [0.1], [0.2], [0.3], [0.4], [0.5], [0.6], [0.7], [0.8], [0.9], [1.0],
            [0.3], [0.4], [0.5], [0.6], [0.7], [0.8], [0.9], [1.0], [1.1], [1.2],
        ]));
        const config = $.let({
            model_y: variant('some', variant('gradient_boosting', {
                n_estimators: variant('some', 50n),
                learning_rate: variant('some', 0.1),
                max_depth: variant('some', 2n),
            })),
            model_t: variant('some', variant('linear', null)),
            discrete_treatment: variant('some', true),
            cv_folds: variant('some', 2n),
            confidence_level: variant('some', 0.95),
            random_state: variant('some', 42n),
        }, CausalDMLConfigType);

        const model = $.let(Causal.dmlTrain(Y, T, X, variant('none', null), config));
        const ate = $.let(Causal.dmlAte(model, X));
        $(Assert.less(ate.ate.subtract(East.value(2.0)).abs(), East.value(0.8)));
    });

    test("ale dose-response rises with the true slope", $ => {
        // rate = 2*setpoint + ambient; ambient correlated with setpoint.
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
        }, CausalALEConfigType);

        const result = $.let(Causal.ale(data, config));
        const last = $.let(result.effect.get(result.effect.length().subtract(1n)));
        $(Assert.greater(last.subtract(result.effect.get(0n)), East.value(0.5)));
        $(Assert.equal(result.grid.length(), result.effect.length()));
        $.match(result.lower, {
            some: ($, lower) => $(Assert.equal(lower.length(), result.effect.length())),
            none: $ => $(Assert.fail(East.value("Expected ALE confidence interval"))),
        });
    });

    test("ale without confidence interval", $ => {
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
            include_ci: variant('some', false),
            confidence_level: variant('none', null),
            emulator: variant('some', {
                n_estimators: variant('some', 100n),
                learning_rate: variant('some', 0.1),
                max_depth: variant('none', null),
                min_samples_leaf: variant('some', 2n),
            }),
            random_state: variant('some', 42n),
        }, CausalALEConfigType);

        const result = $.let(Causal.ale(data, config));
        $.match(result.lower, {
            some: $ => $(Assert.fail(East.value("Expected no CI"))),
            none: () => {},
        });
    });

    test("error: column count mismatch", $ => {
        const data = $.let(East.Matrix.fromArray([[1.0, 2.0], [0.0, 1.0]]));
        const config = $.let({
            columns: ["t", "y", "z"],
            treatment: "t",
            outcome: "y",
            common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('none', null),
            target_units: variant('none', null),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('none', null),
        }, CausalEffectConfigType);

        $(Assert.throws(Causal.effect(data, config), /causal_effect.*2 columns.*3 column names/));
    });
}, { exportOnly: true });
