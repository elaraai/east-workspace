/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Diff showcase — realistic Data.bindStaged + Diff editing scenes wrapped as
 * UI tasks and bundled into `east-ui-showcase-diff@<pkg.version>`.
 *
 * Each example combines form components (Slider / Input / Switch) with a
 * Diff panel surfacing pending edits for sign-off. The `e3.input(...)`
 * datasets are forwarded as `extras` so the deployed workspace has them
 * available at render time.
 *
 * Run via `make start-diff` or `make diff`.
 */

import * as examples from '@elaraai/e3-ui/examples/diff/diff';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const {
    // workforce-policy
    maxWeeklyHoursInput,
    overtimeThresholdInput,
    restGapHoursInput,
    holidayPenaltyInput,
    // service-config
    serviceNameInput,
    replicasInput,
    autoScaleInput,
    regionInput,
    deployAfterInput,
    // roster table
    rosterInput,
    // pricing rules
    listPriceInput,
    discountPctInput,
    minOrderQtyInput,
    currencyCodeInput,
    // pricing rules — also reused by density-variant examples
    // (`diffEditorVariants` — PRICING RULES COMPACT / CONDENSED rows)
    // collection-shape editors
    featureFlagsInput,
    regionalPricesInput,
    deploymentStatusInput,
    // merge-conflict demo (single Float, drives `mergeConflictDemo`)
    mergeDemoHoursInput,
    // overlay-mode patch inputs (PatchType(T) defaulting to `unchanged`)
    maxWeeklyHoursPatchInput,
    regionalPricesPatchInput,
    rosterPatchInput,
    // overlay-mode patch input that DEFAULTS to a non-trivial stale patch
    // (used by `diffOverlayVariants`'s REGIONAL PRICING OVERLAY DRIFT row to demonstrate the drifted-patch
    // case in the Diff card).
    regionalPricesDriftPatchInput,
} = examples;

export default await buildShowcasePackage('diff', pkgInfo.version, examples, {
    extras: [
        maxWeeklyHoursInput,
        overtimeThresholdInput,
        restGapHoursInput,
        holidayPenaltyInput,
        serviceNameInput,
        replicasInput,
        autoScaleInput,
        regionInput,
        deployAfterInput,
        rosterInput,
        listPriceInput,
        discountPctInput,
        minOrderQtyInput,
        currencyCodeInput,
        featureFlagsInput,
        regionalPricesInput,
        deploymentStatusInput,
        mergeDemoHoursInput,
        maxWeeklyHoursPatchInput,
        regionalPricesPatchInput,
        rosterPatchInput,
        regionalPricesDriftPatchInput,
    ],
});
