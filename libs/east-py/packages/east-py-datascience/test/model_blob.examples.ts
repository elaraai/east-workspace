/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, variant, example } from "@elaraai/east";
import { ModelBlobType } from "@elaraai/east-py-datascience";

export const modelBlobUnion = example({
    keywords: ["ModelBlobType", "model blob", "model artifact", "variant", "union", "combined", "cross-runtime", "platform module"],
    description: "Declare the canonical ModelBlobType union for an arbitrary trained-model artifact",
    fn: East.function([], ModelBlobType, ($) => {
        // Any per-library model fits the one combined union — here a Gaussian Process regressor.
        const model = $.let(variant("gp_regressor", {
            data: new Uint8Array([1, 2, 3]),
            n_features: 4n,
            kernel_type: "rbf",
        }), ModelBlobType);
        return model;
    }),
    inputs: [],
    returns: variant("gp_regressor", { data: new Uint8Array([1, 2, 3]), n_features: 4n, kernel_type: "rbf" }),
});
