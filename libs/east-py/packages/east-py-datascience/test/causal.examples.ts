/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, StructType, FloatType, BooleanType, some, none, variant, example } from "@elaraai/east";
import { Causal } from "@elaraai/east-py-datascience";

// `Causal.experiment` is the single declarative entry point. It is generic over
// the row struct (fields = columns); the binary treatment column and the
// confounders are named in the config. The result carries the naive vs adjusted
// effect, confounder balance, propensity overlap, a robustness check, and an
// honesty `verdict` — `adjusted` is `none` when the engine refuses.

export const causalExperimentCausal = example({
    keywords: ["causal", "experiment", "verdict", "backdoor", "adjusted", "naive", "confounding", "overlap", "honesty"],
    description: "Causal.experiment recovers a real effect from confounded data: the raw difference (~3.0) overstates the true effect, but adjusting for the confounder z recovers ~2.0 and the verdict is 'causal' (overlap holds, placebo passes).",
    fn: East.function([], BooleanType, ($) => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // Treated rows skew to higher z (confounding) but both arms span z — so
        // a like-for-like comparison exists. True treatment effect: +2.0.
        const data = $.let([
            { treated: 0.0, outcome: 1.3, z: 0.0 }, { treated: 0.0, outcome: 1.6, z: 1.0 },
            { treated: 0.0, outcome: 3.1, z: 2.0 }, { treated: 0.0, outcome: 3.8, z: 3.0 },
            { treated: 0.0, outcome: 5.5, z: 4.0 }, { treated: 0.0, outcome: 0.7, z: 0.0 },
            { treated: 0.0, outcome: 2.2, z: 1.0 }, { treated: 0.0, outcome: 2.9, z: 2.0 },
            { treated: 0.0, outcome: 4.4, z: 3.0 }, { treated: 0.0, outcome: 4.5, z: 4.0 },
            { treated: 1.0, outcome: 4.25, z: 1.0 }, { treated: 1.0, outcome: 4.65, z: 2.0 },
            { treated: 1.0, outcome: 6.15, z: 3.0 }, { treated: 1.0, outcome: 6.75, z: 4.0 },
            { treated: 1.0, outcome: 8.45, z: 5.0 }, { treated: 1.0, outcome: 3.85, z: 1.0 },
            { treated: 1.0, outcome: 5.35, z: 2.0 }, { treated: 1.0, outcome: 5.95, z: 3.0 },
            { treated: 1.0, outcome: 7.05, z: 4.0 }, { treated: 1.0, outcome: 7.55, z: 5.0 },
        ], ArrayType(Row));
        const config = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none,
            min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        // The verdict is top-tier `causal` AND rests on solid common support — the
        // frac clears the 0.55 strong-overlap gate (asserted below), so this example
        // also guards against a future estimator drift silently re-grading it to `modest`.
        return result.verdict.hasTag("causal")
            .and(() => result.overlap.support_strength.hasTag("strong"))
            .and(() => result.overlap.common_support_frac.greater(0.55));
    }),
    inputs: [],
    returns: true,
});

export const causalExperimentFullBattery = example({
    keywords: ["causal", "experiment", "refutation", "robustness", "placebo", "random common cause", "data subset", "sensitivity", "dose-response", "ale", "trust"],
    description: "Causal.experiment with the full robustness battery + a dose-response curve: the config turns on every refutation check (placebo, random_common_cause, data_subset, an unobserved-confounder sensitivity sweep) and names a dose_feature, so the result's `refutation` and `dose_response` are fully populated — the data behind the surface's 'Can we trust it?' and 'How much?' tabs.",
    fn: East.function([], BooleanType, ($) => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // Same confounded data as the headline example (true effect +2.0).
        const data = $.let([
            { treated: 0.0, outcome: 1.3, z: 0.0 }, { treated: 0.0, outcome: 1.6, z: 1.0 },
            { treated: 0.0, outcome: 3.1, z: 2.0 }, { treated: 0.0, outcome: 3.8, z: 3.0 },
            { treated: 0.0, outcome: 5.5, z: 4.0 }, { treated: 0.0, outcome: 0.7, z: 0.0 },
            { treated: 0.0, outcome: 2.2, z: 1.0 }, { treated: 0.0, outcome: 2.9, z: 2.0 },
            { treated: 0.0, outcome: 4.4, z: 3.0 }, { treated: 0.0, outcome: 4.5, z: 4.0 },
            { treated: 1.0, outcome: 4.25, z: 1.0 }, { treated: 1.0, outcome: 4.65, z: 2.0 },
            { treated: 1.0, outcome: 6.15, z: 3.0 }, { treated: 1.0, outcome: 6.75, z: 4.0 },
            { treated: 1.0, outcome: 8.45, z: 5.0 }, { treated: 1.0, outcome: 3.85, z: 1.0 },
            { treated: 1.0, outcome: 5.35, z: 2.0 }, { treated: 1.0, outcome: 5.95, z: 3.0 },
            { treated: 1.0, outcome: 7.05, z: 4.0 }, { treated: 1.0, outcome: 7.55, z: 5.0 },
        ], ArrayType(Row));
        const config = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            // Every robustness check on, plus an unobserved-confounder sweep.
            refute: some({
                placebo: true, random_common_cause: true, data_subset: true,
                sensitivity: some([0.0, 0.5, 1.0]),
            }),
            dose_feature: some("z"),
            min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        const ref = $.let(result.refutation.unwrap("some"));
        // Verdict still causal AND every requested check populated its field.
        return result.verdict.hasTag("causal")
            .and(() => ref.random_cc_within_ci.hasTag("some"))
            .and(() => ref.data_subset_effect.hasTag("some"))
            .and(() => ref.sensitivity.hasTag("some"))
            .and(() => result.dose_response.hasTag("some"));
    }),
    inputs: [],
    returns: true,
});

export const causalExperimentNotEstimable = example({
    keywords: ["causal", "experiment", "verdict", "not_estimable", "refuse", "honesty", "treatment variation"],
    description: "Causal.experiment REFUSES when the treatment barely varies: with only one treated unit against nine controls (below min_treatment_variation), the estimand can't be formed and the verdict is 'not_estimable' — adjusted is none.",
    fn: East.function([], BooleanType, ($) => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        const data = $.let([
            { treated: 0.0, outcome: 1.0, z: 0.0 }, { treated: 0.0, outcome: 2.0, z: 1.0 },
            { treated: 0.0, outcome: 3.0, z: 2.0 }, { treated: 0.0, outcome: 4.0, z: 3.0 },
            { treated: 0.0, outcome: 5.0, z: 4.0 }, { treated: 0.0, outcome: 1.0, z: 0.0 },
            { treated: 0.0, outcome: 2.0, z: 1.0 }, { treated: 0.0, outcome: 3.0, z: 2.0 },
            { treated: 0.0, outcome: 4.0, z: 3.0 }, { treated: 1.0, outcome: 5.0, z: 2.0 },
        ], ArrayType(Row));
        // The minority arm is 10% of rows; min_treatment_variation 0.15 ⇒ refuse.
        const config = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none,
            min_overlap: some(0.1), min_treatment_variation: some(0.15),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        return result.verdict.hasTag("not_estimable");
    }),
    inputs: [],
    returns: true,
});

export const causalExperimentThinOverlap = example({
    keywords: ["causal", "experiment", "verdict", "modest", "overlap", "support_strength", "thin", "positivity", "common support", "honesty"],
    description: "Causal.experiment tempers a fragile result: a real +2.0 effect rests on thin common support (only the treated and control z-ranges barely overlap), so even though the effect is material and its CI clears zero, the verdict is 'modest' (not 'causal') and `overlap.support_strength` is 'thin' — the honest signal that the comparison rests on little like-for-like data.",
    fn: East.function([], BooleanType, ($) => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // Controls span z∈[0,5], treated span z∈[4,9] — they overlap only on [4,5],
        // so common support is thin (~0.33, between min_overlap 0.10 and strong_overlap
        // 0.55). True treatment effect +2.0.
        const data = $.let([
            { treated: 0.0, outcome: 0.2, z: 0.0 }, { treated: 0.0, outcome: -0.1, z: 0.0 },
            { treated: 0.0, outcome: 1.2, z: 1.0 }, { treated: 0.0, outcome: 0.9, z: 1.0 },
            { treated: 0.0, outcome: 2.2, z: 2.0 }, { treated: 0.0, outcome: 1.9, z: 2.0 },
            { treated: 0.0, outcome: 3.2, z: 3.0 }, { treated: 0.0, outcome: 2.9, z: 3.0 },
            { treated: 0.0, outcome: 4.2, z: 4.0 }, { treated: 0.0, outcome: 3.9, z: 4.0 },
            { treated: 0.0, outcome: 5.2, z: 5.0 }, { treated: 0.0, outcome: 4.9, z: 5.0 },
            { treated: 1.0, outcome: 6.1, z: 4.0 }, { treated: 1.0, outcome: 5.9, z: 4.0 },
            { treated: 1.0, outcome: 7.1, z: 5.0 }, { treated: 1.0, outcome: 6.9, z: 5.0 },
            { treated: 1.0, outcome: 8.1, z: 6.0 }, { treated: 1.0, outcome: 7.9, z: 6.0 },
            { treated: 1.0, outcome: 9.1, z: 7.0 }, { treated: 1.0, outcome: 8.9, z: 7.0 },
            { treated: 1.0, outcome: 10.1, z: 8.0 }, { treated: 1.0, outcome: 9.9, z: 8.0 },
            { treated: 1.0, outcome: 11.1, z: 9.0 }, { treated: 1.0, outcome: 10.9, z: 9.0 },
        ], ArrayType(Row));
        const config = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none,
            min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        // An adjusted estimate exists, but thin support tempers the verdict to modest.
        return result.verdict.hasTag("modest")
            .and(() => result.adjusted.hasTag("some"))
            .and(() => result.overlap.support_strength.hasTag("thin"))
            .and(() => result.overlap.common_support_frac.less(0.55));
    }),
    inputs: [],
    returns: true,
});

export const causalExperimentSignViolation = example({
    keywords: ["causal", "experiment", "verdict", "adjustment_insufficient", "expected_sign", "reverse causation", "sign", "prior", "honesty"],
    description: "Causal.experiment flags an implausibly-signed effect: the data show a robust +2.0 effect, but the caller supplies a domain prior that the effect should be NEGATIVE (`expected_sign`). A confident effect pointing the wrong way is a reverse-causation / reactive-assignment signal the refuters can't catch, so the verdict is 'adjustment_insufficient' and `refutation.expected_sign_ok` is some(false).",
    fn: East.function([], BooleanType, ($) => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // Same confounded data as the headline example (true effect +2.0, positive).
        const data = $.let([
            { treated: 0.0, outcome: 1.3, z: 0.0 }, { treated: 0.0, outcome: 1.6, z: 1.0 },
            { treated: 0.0, outcome: 3.1, z: 2.0 }, { treated: 0.0, outcome: 3.8, z: 3.0 },
            { treated: 0.0, outcome: 5.5, z: 4.0 }, { treated: 0.0, outcome: 0.7, z: 0.0 },
            { treated: 0.0, outcome: 2.2, z: 1.0 }, { treated: 0.0, outcome: 2.9, z: 2.0 },
            { treated: 0.0, outcome: 4.4, z: 3.0 }, { treated: 0.0, outcome: 4.5, z: 4.0 },
            { treated: 1.0, outcome: 4.25, z: 1.0 }, { treated: 1.0, outcome: 4.65, z: 2.0 },
            { treated: 1.0, outcome: 6.15, z: 3.0 }, { treated: 1.0, outcome: 6.75, z: 4.0 },
            { treated: 1.0, outcome: 8.45, z: 5.0 }, { treated: 1.0, outcome: 3.85, z: 1.0 },
            { treated: 1.0, outcome: 5.35, z: 2.0 }, { treated: 1.0, outcome: 5.95, z: 3.0 },
            { treated: 1.0, outcome: 7.05, z: 4.0 }, { treated: 1.0, outcome: 7.55, z: 5.0 },
        ], ArrayType(Row));
        // The prior says the effect should DECREASE the outcome; the data say it increases.
        const config = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none,
            min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: some(variant("negative", null)),
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        const ref = $.let(result.refutation.unwrap("some"));
        return result.verdict.hasTag("adjustment_insufficient")
            .and(() => ref.expected_sign_ok.unwrap("some").not());
    }),
    inputs: [],
    returns: true,
});

// `Causal.designValidation` turns a finished experiment into the recipe for a
// real controlled trial that would confirm it — how many units, the split, and
// which categories to match the groups on — plus a "chance of detecting it" power
// curve. The size `basis` follows the verdict: a clear effect is sized to itself
// (`detect_observed`); the refusal cases size to a materiality threshold instead.
export const causalDesignValidationConfirm = example({
    keywords: ["causal", "design", "validation", "experiment", "trial", "power", "sample size", "randomise", "confirm", "rct"],
    description: "Causal.designValidation on a 'causal' verdict returns a confirmatory randomised-trial recipe: the basis is detect_observed (sized to the observed effect), at least one split option with a positive head-count, and the match-on categories taken from the imbalanced confounders.",
    fn: East.function([], BooleanType, ($) => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // Confounded data with a clear true effect (+2.0) → verdict 'causal'.
        const data = $.let([
            { treated: 0.0, outcome: 1.3, z: 0.0 }, { treated: 0.0, outcome: 1.6, z: 1.0 },
            { treated: 0.0, outcome: 3.1, z: 2.0 }, { treated: 0.0, outcome: 3.8, z: 3.0 },
            { treated: 0.0, outcome: 5.5, z: 4.0 }, { treated: 0.0, outcome: 0.7, z: 0.0 },
            { treated: 0.0, outcome: 2.2, z: 1.0 }, { treated: 0.0, outcome: 2.9, z: 2.0 },
            { treated: 0.0, outcome: 4.4, z: 3.0 }, { treated: 0.0, outcome: 4.5, z: 4.0 },
            { treated: 1.0, outcome: 4.25, z: 1.0 }, { treated: 1.0, outcome: 4.65, z: 2.0 },
            { treated: 1.0, outcome: 6.15, z: 3.0 }, { treated: 1.0, outcome: 6.75, z: 4.0 },
            { treated: 1.0, outcome: 8.45, z: 5.0 }, { treated: 1.0, outcome: 3.85, z: 1.0 },
            { treated: 1.0, outcome: 5.35, z: 2.0 }, { treated: 1.0, outcome: 5.95, z: 3.0 },
            { treated: 1.0, outcome: 7.05, z: 4.0 }, { treated: 1.0, outcome: 7.55, z: 5.0 },
        ], ArrayType(Row));
        const config = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none,
            min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        const designConfig = $.let({
            alpha: none, target_power: none, materiality: none, treated_shares: none,
        }, Causal.Types.DesignConfigType);
        const design = $.let(Causal.designValidation([Row], data, config, result, designConfig));
        return design.basis.hasTag("detect_observed")
            .and(() => design.options.get(0n).n_total.greater(0n));
    }),
    inputs: [],
    returns: true,
});
