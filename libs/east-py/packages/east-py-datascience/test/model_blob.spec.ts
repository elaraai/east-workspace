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
    "lightgbm_regressor", "min_max_scaler", "ngboost_regressor",
    "ordinal_encoder", "regressor_chain", "robust_scaler", "scipy_interp_1d",
    "scipy_kde", "shap_kernel_explainer", "shap_tree_explainer", "standard_scaler",
    "xgboost_classifier", "xgboost_quantile", "xgboost_regressor",
];

test("ModelBlobType carries exactly the canonical 18 cases", () => {
    assert.deepEqual(Object.keys(ModelBlobType.cases).sort(), EXPECTED_CASES);
});

test("ModelBlobType beast2 type-descriptor is byte-stable (TS reference)", () => {
    // Encoding the type-as-value and hashing it pins the canonical structural identity.
    const bytes = encodeBeast2For(EastTypeType)(toEastTypeValue(ModelBlobType));
    const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

    // The TS (reference-implementation) hash, over the v5 container — the
    // encoder default since elaraai/east-workspace#416. Re-pinned when the
    // `torch_mlp` and `lightning` cases left the union with their modules
    // (elaraai/east-workspace#1357): a blob stored under the earlier union no
    // longer matches this type. (What has not been re-measured here is east-c
    // encoding a natively *constructed* ModelBlobType: that path depends on
    // east-c interning structurally-equal composite sub-types the way the TS
    // constructors do — elaraai/east-workspace#83.)
    assert.equal(hash, "910bf176a84a3e27b43457cb5c05b199193a1060063a30a4418824c49ac757a7");
});
