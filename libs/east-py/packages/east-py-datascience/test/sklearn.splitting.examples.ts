/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

export const sklearnSplit = example({
    keywords: ["sklearn", "split", "train", "test", "stratification", "validation"],
    description: "Split operational dataset into train/test with stratification for model validation",
    fn: East.function([], BooleanType, ($) => {
        // Operational data: 2 features
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [3.0, 4.0],
            [5.0, 6.0],
            [7.0, 8.0],
            [9.0, 10.0],
        ]));
        const Y = $.let(East.Matrix.fromArray([[1.0], [2.0], [3.0], [4.0], [5.0]]));

        const config = $.let({
            split_sizes: [0.6, 0.4],
            random_state: variant('some', 42n),
            shuffle: variant('some', true),
            stratify: variant('none', null),
            overlap: variant('none', null),
            multi_overlap: variant('none', null),
            min_overlap: variant('none', null),
        }, Sklearn.Types.SplitConfigType);

        const result = $.let(Sklearn.split(X, Y, config));

        // 60/40 split of 5 samples → 3 train, 2 test
        return result.X_splits.get(0n).rows().equal(3n)
            .and(() => result.X_splits.get(1n).rows().equal(2n));
    }),
    inputs: [],
    returns: true,
});

export const sklearnOverlap = example({
    keywords: ["sklearn", "overlap", "feature", "distribution", "unseen", "category", "production"],
    description: "Check feature distribution overlap between training data and new production data",
    fn: East.function([], IntegerType, ($) => {
        // Reference (training) data with categorical column 0
        const X_ref = $.let(East.Matrix.fromArray([
            [0.0, 10.0],
            [1.0, 20.0],
            [0.0, 30.0],
            [1.0, 40.0],
        ]));

        // Production data with an unseen category (3.0) in column 0
        const X_prod = $.let(East.Matrix.fromArray([
            [0.0, 11.0],
            [3.0, 22.0],   // unseen category
            [1.0, 33.0],
        ]));
        const Y_prod = $.let(East.Matrix.fromArray([[1.0], [2.0], [3.0]]));

        const result = $.let(Sklearn.overlap(
            X_ref,
            [X_prod],
            [Y_prod],
            { cat_indices: East.Vector.fromArray([0n]) }
        ));

        // 1 row rejected (unseen category 3), 2 kept
        return result.X_filtered.get(0n).rows();
    }),
    inputs: [],
    returns: 2n,
});
