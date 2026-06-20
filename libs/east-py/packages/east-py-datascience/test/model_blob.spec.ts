/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * Combined ModelBlobType — examples wiring + cross-runtime type parity.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EastTypeType, toEastTypeValue, encodeBeast2For } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { ModelBlobType } from "@elaraai/east-py-datascience";
import * as ex from "./model_blob.examples.js";

describeEast("Combined ModelBlobType", (test) => {
    Assert.examples(test, { modelBlobUnion: ex.modelBlobUnion });
}, { exportOnly: true });

/** Every case the canonical union must carry, single-sourced from the per-library unions. */
const EXPECTED_CASES = [
    "gaussian_mixture", "gp_regressor", "label_encoder", "lightgbm_classifier",
    "lightgbm_regressor", "lightning", "min_max_scaler", "ngboost_regressor",
    "ordinal_encoder", "regressor_chain", "robust_scaler", "scipy_interp_1d",
    "scipy_kde", "shap_kernel_explainer", "shap_tree_explainer", "standard_scaler",
    "torch_mlp", "xgboost_classifier", "xgboost_quantile", "xgboost_regressor",
];

test("ModelBlobType carries exactly the canonical 20 cases", () => {
    assert.deepEqual(Object.keys(ModelBlobType.cases).sort(), EXPECTED_CASES);
});

test("ModelBlobType beast2 type-descriptor is byte-stable (TS reference)", () => {
    // Encoding the type-as-value and hashing it pins the canonical structural identity.
    const bytes = encodeBeast2For(EastTypeType)(toEastTypeValue(ModelBlobType));
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

    // The TS (reference-implementation) hash. The structural type is identical
    // across the TS and Python (east-c) runtimes, but east-c currently encodes the
    // XGBoost cases differently — each repeats an `Option<Vector<Integer>>` field and
    // east-c does not yet intern structurally-equal composite sub-types the way the TS
    // constructors do (it emits `84aaec7f…` instead). When east-c gains that interning
    // (elaraai/east-workspace#83), the runtimes converge on this value.
    assert.equal(hash, "02fff35cc5345cb78e3475eb78cf2ccb635c0e052595051f13e44da3c7de2c0a");
});
