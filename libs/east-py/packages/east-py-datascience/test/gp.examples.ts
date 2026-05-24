/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, variant, example } from "@elaraai/east";
import { GP } from "@elaraai/east-py-datascience";

export const gpTrainPredict = example({
    keywords: ["gp", "train", "predict", "predictStd", "gaussian process", "uncertainty", "degradation", "confidence band"],
    description: "Model equipment degradation with uncertainty — get mean prediction and confidence band",
    fn: East.function([], IntegerType, ($) => {
        // Features: operating_hours (single feature for degradation curve)
        // Target: remaining_useful_life (%)
        const X_train = $.let(East.Matrix.fromArray([
            [100.0],
            [500.0],
            [1000.0],
            [2000.0],
            [3000.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([95.0, 85.0, 70.0, 45.0, 20.0]));

        const config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 2n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        }, GP.Types.GPConfigType);

        const model = $.let(GP.train(X_train, y_train, config));

        // Predict at new inspection points
        const X_new = $.let(East.Matrix.fromArray([
            [750.0],    // between training points — lower uncertainty
            [4000.0],   // beyond training range — higher uncertainty
        ]));

        // Get mean prediction and uncertainty (std)
        const result = $.let(GP.predictStd(model, X_new));

        // Uncertainty at extrapolated point should exceed in-range point
        // Return std vector length (2 predictions)
        return result.std.length();
    }),
    inputs: [],
    returns: 2n,
});
