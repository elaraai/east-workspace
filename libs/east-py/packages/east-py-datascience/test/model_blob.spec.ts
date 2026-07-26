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

    // The TS (reference-implementation) hash, over the v5 container — the
    // encoder default since elaraai/east-workspace#416. east-c reproduces these
    // 609 bytes exactly when it decodes and re-encodes them, so the two runtimes
    // now agree on this type's canonical wire form. (What has not been
    // re-measured here is east-c encoding a natively *constructed* ModelBlobType:
    // that path depends on east-c interning structurally-equal composite
    // sub-types the way the TS constructors do — elaraai/east-workspace#83.)
    assert.equal(hash, "2992ba0ab10d18461b4cdde700cbe3c66abf49dfeb4abb679962742eb87468eb");
});
