/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Canonical combined model-blob union.
 *
 * @packageDocumentation
 */

import { VariantType } from "@elaraai/east";
import { SklearnModelBlobType } from "./sklearn/sklearn.js";
import { ScipyModelBlobType } from "./scipy/scipy.js";
import { XGBoostModelBlobType } from "./xgboost/xgboost.js";
import { LightGBMModelBlobType } from "./lightgbm/lightgbm.js";
import { NGBoostModelBlobType } from "./ngboost/ngboost.js";
import { ShapModelBlobType } from "./shap/shap.js";
import { TorchModelBlobType } from "./torch/torch.js";
import { GPModelBlobType } from "./gp/gp.js";
import { LightningModelBlobType } from "./lightning/lightning.js";

/**
 * The canonical union of every serializable model artifact across the package,
 * matching the Python `east_py_datascience.types.ModelBlobType`. Declare it for
 * any field or platform-function signature that carries an arbitrary trained
 * model (the project-owned platform-module pattern), instead of re-spelling a
 * 20-case variant in each consumer.
 *
 * Single-sourced from the per-library blob unions ({@link XGBoostModelBlobType},
 * {@link SklearnModelBlobType}, …) so it cannot drift from them; variant cases
 * are order-normalized, so composition order is free.
 *
 * Distinct from {@link AnyModelBlobType}, which is the SHAP-kernel-explainer
 * input union (it adds `mapie_*` cases and omits the scaler/encoder/scipy/
 * lightning/shap cases) — that one is not a substitute for this canonical union.
 *
 * The structural type is identical across the TS and Python (east-c) runtimes
 * and validates by case name at the runtime boundary. The beast2 type-descriptor
 * bytes currently differ between the runtimes for the XGBoost cases (each repeats
 * an `Option<Vector<Integer>>` field) because east-c does not yet intern
 * structurally-equal composite sub-types the way the TS reference does
 * (elaraai/east-workspace#83); the TS value here is the canonical one.
 */
export const ModelBlobType = VariantType({
    ...SklearnModelBlobType.cases,
    ...ScipyModelBlobType.cases,
    ...XGBoostModelBlobType.cases,
    ...LightGBMModelBlobType.cases,
    ...NGBoostModelBlobType.cases,
    ...ShapModelBlobType.cases,
    ...TorchModelBlobType.cases,
    ...GPModelBlobType.cases,
    ...LightningModelBlobType.cases,
});
