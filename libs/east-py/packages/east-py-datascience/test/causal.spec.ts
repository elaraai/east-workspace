/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Causal inference platform function tests
 */
import { East, ArrayType, StructType, FloatType, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Causal, CausalEffectConfigType, CausalDMLConfigType, CausalALEConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./causal.examples.js";

// Shared fixtures — the effect/refute functions are generic over the row struct,
// so the data is an `Array<Struct>` (fields = columns) and the row type is passed
// as the type argument: `Causal.effect([RowTZB], data, config)`.
const RowTZB = StructType({ t: FloatType, y: FloatType, z: FloatType, batch: FloatType });
// y = 2*t + 3*z (+/- 0.03); treatment assigned more often at high z.
const tzbRows = [
    { t: 0.0, y: 0.32, z: 0.1, batch: 0.0 }, { t: 1.0, y: 2.62, z: 0.2, batch: 0.0 },
    { t: 0.0, y: 0.58, z: 0.2, batch: 1.0 }, { t: 1.0, y: 2.88, z: 0.3, batch: 1.0 },
    { t: 0.0, y: 0.93, z: 0.3, batch: 2.0 }, { t: 1.0, y: 3.22, z: 0.4, batch: 2.0 },
    { t: 0.0, y: 1.18, z: 0.4, batch: 3.0 }, { t: 1.0, y: 3.53, z: 0.5, batch: 3.0 },
    { t: 0.0, y: 1.52, z: 0.5, batch: 4.0 }, { t: 1.0, y: 3.81, z: 0.6, batch: 4.0 },
    { t: 0.0, y: 1.79, z: 0.6, batch: 5.0 }, { t: 1.0, y: 4.07, z: 0.7, batch: 5.0 },
    { t: 0.0, y: 2.13, z: 0.7, batch: 6.0 }, { t: 1.0, y: 4.43, z: 0.8, batch: 6.0 },
    { t: 0.0, y: 2.38, z: 0.8, batch: 7.0 }, { t: 1.0, y: 4.71, z: 0.9, batch: 7.0 },
];

const RowSAR = StructType({ setpoint: FloatType, ambient: FloatType, rate: FloatType });
const sarRows = [
    { setpoint: 0.05, ambient: 0.21, rate: 0.31 }, { setpoint: 0.10, ambient: 0.27, rate: 0.47 }, { setpoint: 0.15, ambient: 0.24, rate: 0.54 }, { setpoint: 0.20, ambient: 0.33, rate: 0.73 },
    { setpoint: 0.25, ambient: 0.29, rate: 0.79 }, { setpoint: 0.30, ambient: 0.38, rate: 0.98 }, { setpoint: 0.35, ambient: 0.41, rate: 1.11 }, { setpoint: 0.40, ambient: 0.37, rate: 1.17 },
    { setpoint: 0.45, ambient: 0.46, rate: 1.36 }, { setpoint: 0.50, ambient: 0.52, rate: 1.52 }, { setpoint: 0.55, ambient: 0.48, rate: 1.58 }, { setpoint: 0.60, ambient: 0.57, rate: 1.77 },
    { setpoint: 0.65, ambient: 0.61, rate: 1.91 }, { setpoint: 0.70, ambient: 0.58, rate: 1.98 }, { setpoint: 0.75, ambient: 0.66, rate: 2.16 }, { setpoint: 0.80, ambient: 0.72, rate: 2.32 },
    { setpoint: 0.85, ambient: 0.69, rate: 2.39 }, { setpoint: 0.90, ambient: 0.77, rate: 2.57 }, { setpoint: 0.95, ambient: 0.81, rate: 2.71 }, { setpoint: 1.00, ambient: 0.78, rate: 2.78 },
];

describeEast("Causal platform functions", (test) => {

    Assert.examples(test, {
        causalEffectLinear: ex.causalEffectLinear,
        causalEffectPropensityAtt: ex.causalEffectPropensityAtt,
        causalEffectConfounding: ex.causalEffectConfounding,
        causalRefuteSensitivity: ex.causalRefuteSensitivity,
        causalDmlCate: ex.causalDmlCate,
        causalAleDoseResponse: ex.causalAleDoseResponse,
    });

    test("linear regression recovers confounded effect", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect([RowTZB], data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.2)));
        $(Assert.equal(result.n_samples, 16n));
        $(Assert.equal(result.n_treated, 8n));
        $(Assert.equal(result.n_control, 8n));
    });

    test("propensity weighting att with overlap trim", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('propensity_score_weighting', {
                weighting_scheme: variant('some', variant('ips_stabilized_weight', null)),
            })),
            target_units: variant('some', variant('att', null)),
            trim: variant('some', variant('overlap', null)),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect([RowTZB], data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.5)));
    });

    test("propensity weighting ate with bounds trim and raw weights", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('propensity_score_weighting', {
                weighting_scheme: variant('some', variant('ips_weight', null)),
            })),
            target_units: variant('some', variant('ate', null)),
            trim: variant('some', variant('bounds', { lower: 0.05, upper: 0.95 })),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect([RowTZB], data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.5)));
    });

    test("cluster bootstrap confidence interval", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
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

        const result = $.let(Causal.effect([RowTZB], data, config));
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
        // y = 2*t + 1.0*[cat=1] + 2.0*[cat=2] (+/- 0.05); treatment more likely at higher cat.
        const RowTYCat = StructType({ t: FloatType, y: FloatType, cat: FloatType });
        const data = $.let([
            { t: 0.0, y: 0.05, cat: 0.0 }, { t: 0.0, y: -0.03, cat: 0.0 }, { t: 0.0, y: 0.01, cat: 0.0 }, { t: 1.0, y: 2.04, cat: 0.0 }, { t: 1.0, y: 1.97, cat: 0.0 },
            { t: 0.0, y: 1.02, cat: 1.0 }, { t: 0.0, y: 0.97, cat: 1.0 }, { t: 1.0, y: 3.05, cat: 1.0 }, { t: 1.0, y: 2.96, cat: 1.0 }, { t: 1.0, y: 3.01, cat: 1.0 },
            { t: 0.0, y: 2.03, cat: 2.0 }, { t: 0.0, y: 1.96, cat: 2.0 }, { t: 1.0, y: 4.02, cat: 2.0 }, { t: 1.0, y: 3.99, cat: 2.0 }, { t: 1.0, y: 4.05, cat: 2.0 },
        ], ArrayType(RowTYCat));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["cat"],
            categorical: variant('some', ["cat"]),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.effect([RowTYCat], data, config));
        $(Assert.less(result.effect.subtract(East.value(2.0)).abs(), East.value(0.2)));
    });

    test("placebo treatment refuter drives effect to zero", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute([RowTZB], data, config, variant('placebo_treatment', {
            num_simulations: variant('some', 20n),
        })));
        $(Assert.less(result.estimated_effect.subtract(East.value(2.0)).abs(), East.value(0.2)));
        $(Assert.equal(result.new_effects.length(), 1n));
        $(Assert.less(result.new_effects.get(0n).abs(), East.value(0.6)));
    });

    test("random common cause refuter leaves effect unchanged", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute([RowTZB], data, config, variant('random_common_cause', {
            num_simulations: variant('some', 10n),
        })));
        $(Assert.less(result.new_effects.get(0n).subtract(result.estimated_effect).abs(), East.value(0.3)));
    });

    test("data subset refuter is stable", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute([RowTZB], data, config, variant('data_subset', {
            subset_fraction: variant('some', 0.8),
            num_simulations: variant('some', 10n),
        })));
        $(Assert.less(result.new_effects.get(0n).subtract(result.estimated_effect).abs(), East.value(0.3)));
    });

    test("unobserved confounder sensitivity curve", $ => {
        const data = $.let(tzbRows, ArrayType(RowTZB));
        const config = $.let({
            treatment: "t", outcome: "y", common_causes: ["z"],
            categorical: variant('none', null),
            method: variant('some', variant('linear_regression', null)),
            target_units: variant('some', variant('ate', null)),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('some', 42n),
        }, CausalEffectConfigType);

        const result = $.let(Causal.refute([RowTZB], data, config, variant('unobserved_common_cause', {
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
        const data = $.let(sarRows, ArrayType(RowSAR));
        const config = $.let({
            outcome: "rate", feature: "setpoint",
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

        const result = $.let(Causal.ale([RowSAR], data, config));
        const last = $.let(result.effect.get(result.effect.length().subtract(1n)));
        $(Assert.greater(last.subtract(result.effect.get(0n)), East.value(0.5)));
        $(Assert.equal(result.grid.length(), result.effect.length()));
        $.match(result.lower, {
            some: ($, lower) => $(Assert.equal(lower.length(), result.effect.length())),
            none: $ => $(Assert.fail(East.value("Expected ALE confidence interval"))),
        });
    });

    test("ale without confidence interval", $ => {
        const data = $.let(sarRows, ArrayType(RowSAR));
        const config = $.let({
            outcome: "rate", feature: "setpoint",
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

        const result = $.let(Causal.ale([RowSAR], data, config));
        $.match(result.lower, {
            some: $ => $(Assert.fail(East.value("Expected no CI"))),
            none: () => {},
        });
    });

    test("error: referenced column not found in the row struct", $ => {
        const Row = StructType({ a: FloatType, b: FloatType });
        const data = $.let([{ a: 1.0, b: 2.0 }, { a: 0.0, b: 1.0 }], ArrayType(Row));
        const config = $.let({
            treatment: "t", outcome: "b", common_causes: ["a"],
            categorical: variant('none', null),
            method: variant('none', null),
            target_units: variant('none', null),
            trim: variant('none', null),
            bootstrap: variant('none', null),
            random_state: variant('none', null),
        }, CausalEffectConfigType);

        $(Assert.throws(Causal.effect([Row], data, config), /causal_effect.*not found/));
    });
}, { exportOnly: true });
