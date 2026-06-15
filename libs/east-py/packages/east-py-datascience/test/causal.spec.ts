/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Causal inference tests — one declarative entry point, `Causal.experiment`.
 */
import { ArrayType, StructType, FloatType, some, none } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Causal } from "@elaraai/east-py-datascience";
import * as ex from "./causal.examples.js";

describeEast("Causal.experiment", (test) => {

    Assert.examples(test, {
        causalExperimentCausal: ex.causalExperimentCausal,
        causalExperimentFullBattery: ex.causalExperimentFullBattery,
        causalExperimentNotEstimable: ex.causalExperimentNotEstimable,
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
        }, Causal.Types.CausalExperimentConfigType);
        const result = $.let(Causal.experiment([Row], data, config));
        $(Assert.equal(result.verdict.hasTag("not_estimable"), true));
        $(Assert.equal(result.adjusted.hasTag("none"), true));
        $(Assert.equal(result.n_total, 10n));
    });
});
