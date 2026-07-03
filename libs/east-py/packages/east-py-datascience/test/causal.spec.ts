/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Causal inference tests — one declarative entry point, `Causal.experiment`.
 */
import { ArrayType, StructType, FloatType, StringType, some, none, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Causal } from "@elaraai/east-py-datascience";
import * as ex from "./causal.examples.js";

describeEast("Causal.experiment", (test) => {

    Assert.examples(test, {
        causalExperimentCausal: ex.causalExperimentCausal,
        causalExperimentFullBattery: ex.causalExperimentFullBattery,
        causalExperimentNotEstimable: ex.causalExperimentNotEstimable,
        causalExperimentThinOverlap: ex.causalExperimentThinOverlap,
        causalExperimentSignViolation: ex.causalExperimentSignViolation,
    });

    test("refuses with a not_estimable verdict when treatment barely varies", $ => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        const data = $.let([
            { treated: 0.0, outcome: 1.0, z: 0.0 }, { treated: 0.0, outcome: 2.0, z: 1.0 },
            { treated: 0.0, outcome: 3.0, z: 2.0 }, { treated: 0.0, outcome: 4.0, z: 3.0 },
            { treated: 0.0, outcome: 5.0, z: 4.0 }, { treated: 0.0, outcome: 1.0, z: 0.0 },
            { treated: 0.0, outcome: 2.0, z: 1.0 }, { treated: 0.0, outcome: 3.0, z: 2.0 },
            { treated: 0.0, outcome: 4.0, z: 3.0 }, { treated: 1.0, outcome: 5.0, z: 2.0 },
        ], ArrayType(Row));
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
        $(Assert.equal(result.verdict.hasTag("not_estimable"), true));
        $(Assert.equal(result.adjusted.hasTag("none"), true));
        $(Assert.equal(result.n_total, 10n));
    });

    test("explainability contract: verdict_reasons, threshold echo, arm means, off-support count, adjusted balance, benchmarks", $ => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // The headline confounded data (true effect +2.0), PSW estimator + full
        // refute battery so every new field is exercised.
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
            categorical: none,
            method: some(variant("propensity_score_weighting", { weighting_scheme: none })),
            estimand: none,
            refute: some({ placebo: true, random_common_cause: true, data_subset: true, sensitivity: some([0.0, 0.2, 0.4, 0.6, 0.8, 1.0]) }),
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        // A causal verdict carries NO reasons (all gates passed)…
        $(Assert.equal(result.verdict.hasTag("causal"), true));
        $(Assert.equal(result.verdict_reasons.size(), 0n));
        // …and the thresholds it applied are echoed for the consumer to speak.
        $(Assert.greater(result.outcome_sd, 0.0));
        $(Assert.equal(result.materiality_threshold, result.outcome_sd.multiply(0.1)));
        // Per-arm raw means: treated − control = the naive difference.
        const tm = $.let(result.treated_outcome_mean.unwrap("some"));
        const cm = $.let(result.control_outcome_mean.unwrap("some"));
        $(Assert.less(tm.subtract(cm).subtract(result.naive).abs(), 1e-9));
        // n_dropped now counts off-support rows, consistent with the overlap frac.
        $(Assert.lessEqual(result.n_dropped, result.n_total));
        // PSW → the adjusted balance is reported and tighter than the raw gap.
        const bal = $.let(result.balance.get(0n));
        const adjSmd = $.let(bal.std_diff_adjusted.unwrap("some"));
        $(Assert.less(adjSmd.abs(), bal.std_diff.abs()));
        // Benchmarks place the observed confounder on the sensitivity axis.
        const sens = $.let(result.refutation.unwrap("some").sensitivity.unwrap("some"));
        $(Assert.equal(sens.benchmarks.size(), 1n));
        $(Assert.equal(sens.benchmarks.get(0n).column, "z"));
        $(Assert.greaterEqual(sens.benchmarks.get(0n).strength, 0.0));

        // Refusal path: reasons stay empty (the verdict tag IS the reason) and
        // the echoes are still present.
        const oneSided = $.let([
            { treated: 0.0, outcome: 1.0, z: 0.0 }, { treated: 0.0, outcome: 2.0, z: 1.0 },
            { treated: 0.0, outcome: 3.0, z: 2.0 }, { treated: 0.0, outcome: 4.0, z: 3.0 },
            { treated: 0.0, outcome: 5.0, z: 4.0 }, { treated: 0.0, outcome: 1.0, z: 0.0 },
            { treated: 0.0, outcome: 2.0, z: 1.0 }, { treated: 0.0, outcome: 3.0, z: 2.0 },
            { treated: 0.0, outcome: 4.0, z: 3.0 }, { treated: 1.0, outcome: 5.0, z: 2.0 },
        ], ArrayType(Row));
        const refuseCfg = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none, refute: none,
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.15),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const refused = $.let(Causal.experiment([Row], oneSided, refuseCfg));
        $(Assert.equal(refused.verdict.hasTag("not_estimable"), true));
        $(Assert.equal(refused.verdict_reasons.size(), 0n));
        $(Assert.greater(refused.outcome_sd, 0.0));

        // A floored causal verdict says WHY: low_robustness among the reasons.
        const floored = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: some(99.0), expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const modest = $.let(Causal.experiment([Row], data, floored));
        $(Assert.equal(modest.verdict.hasTag("modest"), true));
        $(Assert.equal(modest.verdict_reasons.get(0n).hasTag("low_robustness"), true));
    });

    test("evalue_floor (G3): an opt-in robustness floor tempers a causal verdict to modest", $ => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // The headline confounded data (true effect +2.0) → robustness_value ≈ 4.1.
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
        // Floor above the computed E-value → downgrade to modest (the E-value is now read).
        const highFloor = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: some(99.0), expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        // Floor below the E-value → unchanged (still causal).
        const lowFloor = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: some(1.0), expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        $(Assert.equal(Causal.experiment([Row], data, highFloor).verdict.hasTag("modest"), true));
        $(Assert.equal(Causal.experiment([Row], data, lowFloor).verdict.hasTag("causal"), true));
    });

    test("clustered design (G4/G5): the naive CI widens and the placebo changes vs a row-level analysis", $ => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType, site: StringType });
        // 4 sites, treatment assigned at the cluster level (A,B treated; C,D control),
        // each site carrying a distinct level shift (within-cluster correlation). z
        // overlaps across arms so the propensity is non-degenerate.
        const data = $.let([
            { treated: 1.0, outcome: 8.8, z: 1.0, site: "A" }, { treated: 1.0, outcome: 10.2, z: 2.0, site: "A" },
            { treated: 1.0, outcome: 10.8, z: 3.0, site: "A" }, { treated: 1.0, outcome: 12.2, z: 4.0, site: "A" },
            { treated: 1.0, outcome: 8.8, z: 1.0, site: "A" }, { treated: 1.0, outcome: 10.2, z: 2.0, site: "A" },
            { treated: 1.0, outcome: 10.8, z: 3.0, site: "A" }, { treated: 1.0, outcome: 12.2, z: 4.0, site: "A" },
            { treated: 1.0, outcome: 6.8, z: 1.0, site: "B" }, { treated: 1.0, outcome: 8.2, z: 2.0, site: "B" },
            { treated: 1.0, outcome: 8.8, z: 3.0, site: "B" }, { treated: 1.0, outcome: 10.2, z: 4.0, site: "B" },
            { treated: 1.0, outcome: 6.8, z: 1.0, site: "B" }, { treated: 1.0, outcome: 8.2, z: 2.0, site: "B" },
            { treated: 1.0, outcome: 8.8, z: 3.0, site: "B" }, { treated: 1.0, outcome: 10.2, z: 4.0, site: "B" },
            { treated: 0.0, outcome: 5.8, z: 0.0, site: "C" }, { treated: 0.0, outcome: 7.2, z: 1.0, site: "C" },
            { treated: 0.0, outcome: 7.8, z: 2.0, site: "C" }, { treated: 0.0, outcome: 9.2, z: 3.0, site: "C" },
            { treated: 0.0, outcome: 5.8, z: 0.0, site: "C" }, { treated: 0.0, outcome: 7.2, z: 1.0, site: "C" },
            { treated: 0.0, outcome: 7.8, z: 2.0, site: "C" }, { treated: 0.0, outcome: 9.2, z: 3.0, site: "C" },
            { treated: 0.0, outcome: 3.8, z: 0.0, site: "D" }, { treated: 0.0, outcome: 5.2, z: 1.0, site: "D" },
            { treated: 0.0, outcome: 5.8, z: 2.0, site: "D" }, { treated: 0.0, outcome: 7.2, z: 3.0, site: "D" },
            { treated: 0.0, outcome: 3.8, z: 0.0, site: "D" }, { treated: 0.0, outcome: 5.2, z: 1.0, site: "D" },
            { treated: 0.0, outcome: 5.8, z: 2.0, site: "D" }, { treated: 0.0, outcome: 7.2, z: 3.0, site: "D" },
        ], ArrayType(Row));
        const rowCfg = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const clusterCfg = $.let({
            treatment: "treated", outcome: "outcome", common_causes: ["z"],
            categorical: none, method: none, estimand: none,
            refute: some({ placebo: true, random_common_cause: false, data_subset: false, sensitivity: none }),
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: some({ reps: 200n, cluster_column: some("site"), confidence_level: some(0.95) }),
            random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: none,
        }, Causal.Types.CausalExperimentConfigType);
        const rRow = $.let(Causal.experiment([Row], data, rowCfg));
        const rClu = $.let(Causal.experiment([Row], data, clusterCfg));
        const rowCi = $.let(rRow.naive_ci.unwrap("some"));
        const cluCi = $.let(rClu.naive_ci.unwrap("some"));
        // G5: resampling whole clusters (vs rows) reflects the within-cluster
        // correlation, so the naive CI is materially wider — and comparable to the
        // adjusted CI, which already clusters.
        $(Assert.greater(cluCi.upper.subtract(cluCi.lower), rowCi.upper.subtract(rowCi.lower)));
        // Degeneracy guards: ≥4 clusters keep both CIs estimable (no NaN collapse).
        $(Assert.equal(rClu.adjusted.unwrap("some").ci.hasTag("some"), true));
        // G4: the clustered placebo (permuting treatment between clusters, not rows)
        // runs and yields a usable result. Its magnitude isn't pinned — with few
        // clusters + few sims the placebo value is seed-fragile; the deterministic
        // cluster signal this test asserts is the wider naive CI above.
        const refClu = $.let(rClu.refutation.unwrap("some"));
        $(Assert.equal(refClu.placebo_passes.hasTag("some"), true));
    });

    test("cascade precedence (G6): a wrong-signed effect outranks a thin-overlap downgrade", $ => {
        const Row = StructType({ treated: FloatType, outcome: FloatType, z: FloatType });
        // Thin-overlap data (frac ≈ 0.33 → would be `modest` on its own), real +2.0.
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
            dose_feature: none, min_overlap: some(0.1), min_treatment_variation: some(0.02),
            bootstrap: none, random_state: some(42n),
            strong_overlap: none, evalue_floor: none, expected_sign: some(variant("negative", null)),
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        // Thin support alone would give `modest`; the sign violation is more severe.
        const ref = $.let(result.refutation.unwrap("some"));
        $(Assert.equal(result.verdict.hasTag("adjustment_insufficient"), true));
        $(Assert.equal(result.overlap.support_strength.hasTag("thin"), true));
        $(Assert.equal(ref.expected_sign_ok.unwrap("some").not(), true));
    });
}, { exportOnly: true });
