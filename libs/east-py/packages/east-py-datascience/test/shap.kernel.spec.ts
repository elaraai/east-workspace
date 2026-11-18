/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SHAP's KernelExplainer, as the platform runs it: every feature given its
 * value, the same each run, and a large background summarised. And the
 * categorical encoding it replays for each of its synthetic rows.
 */
import { East, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { GP, Shap, XGBoost } from "@elaraai/east-py-datascience";

/** Twenty rows of twelve features, each varying on its own (17, a prime above every step, keeps each varying), and a target every feature moves. */
const twelve = Array.from({ length: 20 }, (_, i) => Array.from({ length: 12 }, (_, j) => ((i * (j + 3) + 2 * j) % 17) / 4));
const target = twelve.map((row) => row.reduce((sum, x, j) => sum + (j + 1) * x, 0));
const twelveNames = Array.from({ length: 12 }, (_, j) => `f${j}`);
/** Five of them the background, and four the rows explained. */
const twelveBackground = twelve.slice(0, 5);
const twelveExplained = twelve.slice(5, 9);

/** Rows of two numeric features and a categorical one of three categories, a background past the hundred rows a kernel explainer is given. */
const wide = Array.from({ length: 150 }, (_, i) => [i % 10, (i * 3) % 7, i % 3]);
/** The first thirty rows train: category 1 adds 6, so the trees split on the categorical feature. */
const trainRows = wide.slice(0, 30);
const trainTarget = trainRows.map(([a, b, kind]) => a! + 2 * b! + (kind === 1 ? 6 : 0));
/** Six rows explained. */
const wideExplained = wide.slice(0, 6);
/** An XGBoost regressor whose third feature is categorical, of three categories. */
const categoricalConfig: ValueTypeOf<typeof XGBoost.Types.XGBoostConfigType> = {
    n_estimators: some(30n),
    max_depth: some(3n),
    learning_rate: some(0.3),
    min_child_weight: none,
    subsample: none,
    colsample_bytree: none,
    reg_alpha: none,
    reg_lambda: none,
    gamma: none,
    random_state: some(42n),
    n_jobs: none,
    sample_weight: none,
    categorical_features: some(new BigInt64Array([2n])),
    categorical_n: some(new BigInt64Array([3n])),
    max_cat_to_onehot: none,
    max_cat_threshold: none,
    scale_pos_weight: none,
};

describeEast("SHAP KernelExplainer: every feature, the same each run, a large background summarised", (test) => {

    test("a kernel explainer gives each of twelve features its value, which add up to the prediction, and the same each run", $ => {
        const X = $.let(East.Matrix.fromArray(twelve));
        const y = $.let(East.Vector.fromArray(target));
        const config = $.let({
            kernel: some(variant('rbf', null)),
            alpha: some(1e-6),
            n_restarts_optimizer: some(0n),
            normalize_y: some(true),
            random_state: some(42n),
        }, GP.Types.GPConfigType);
        const model = $.let(GP.train(X, y, config));
        const background = $.let(East.Matrix.fromArray(twelveBackground));
        const explained = $.let(East.Matrix.fromArray(twelveExplained));
        const explainer = $.let(Shap.kernelExplainerCreate(model, background));
        const names = $.let(twelveNames);

        const first = $.let(Shap.computeValues(explainer, explained, names));
        // shap's default selects ten features in each row and gives that row's
        // other two exactly 0: every value of every row is given here
        $(Assert.greater(first.shap_values.unwrap('matrix_2d').toVector().abs().min(), 1e-9));
        // Each row's values and the base value add up to its prediction
        const summed = $.let(first.shap_values.unwrap('matrix_2d').rowSums().addScalar(first.base_value.unwrap('single')));
        $(Assert.lessEqual(summed.addScaled(GP.predict(model, explained), -1.0).abs().max(), 1e-6));
        // Past eleven features the coalitions are sampled: seeded, the same each run
        const again = $.let(Shap.computeValues(explainer, explained, names));
        $(Assert.equal(again.shap_values.unwrap('matrix_2d'), first.shap_values.unwrap('matrix_2d')));
    });

    test("interventional mode over categorical features explains against a seeded sample of a background past a hundred rows, the same each run", $ => {
        const X = $.let(East.Matrix.fromArray(trainRows));
        const y = $.let(East.Vector.fromArray(trainTarget));
        const config = $.let(categoricalConfig, XGBoost.Types.XGBoostConfigType);
        const model = $.let(XGBoost.trainRegressor(X, y, config));
        const background = $.let(East.Matrix.fromArray(wide));
        const explained = $.let(East.Matrix.fromArray(wideExplained));
        const names = $.let(["a", "b", "kind"]);

        const first = $.let(Shap.computeValues(Shap.treeExplainerCreate(variant('interventional', { model, background })), explained, names));
        const summed = $.let(first.shap_values.unwrap('matrix_2d').rowSums().addScalar(first.base_value.unwrap('single')));
        $(Assert.lessEqual(summed.addScaled(XGBoost.predict(model, explained), -1.0).abs().max(), 1e-4));
        const again = $.let(Shap.computeValues(Shap.treeExplainerCreate(variant('interventional', { model, background })), explained, names));
        $(Assert.equal(again.shap_values.unwrap('matrix_2d'), first.shap_values.unwrap('matrix_2d')));
    });

    test("a categorical code is read as its whole number, and one outside the categories, or no number, as missing", $ => {
        const X = $.let(East.Matrix.fromArray(trainRows));
        const y = $.let(East.Vector.fromArray(trainTarget));
        const config = $.let(categoricalConfig, XGBoost.Types.XGBoostConfigType);
        const model = $.let(XGBoost.trainRegressor(X, y, config));
        // One row of each code: 1.7, 1, -0.5, 0, 7, -2 and NaN
        const predicted = $.let(XGBoost.predict(model, East.Matrix.fromArray([
            [4.0, 5.0, 1.7], [4.0, 5.0, 1.0], [4.0, 5.0, -0.5], [4.0, 5.0, 0.0], [4.0, 5.0, 7.0], [4.0, 5.0, -2.0], [4.0, 5.0, NaN],
        ])));
        // 1.7 is category 1, as -0.5 is category 0: each its whole number, toward zero
        $(Assert.equal(predicted.get(0n), predicted.get(1n)));
        $(Assert.equal(predicted.get(2n), predicted.get(3n)));
        // 7 and -2 are no category, and NaN no number: each missing
        $(Assert.equal(predicted.get(4n), predicted.get(6n)));
        $(Assert.equal(predicted.get(5n), predicted.get(6n)));
    });
}, { exportOnly: true });
