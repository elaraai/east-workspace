/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/** The Elara eye in the Sheet (#1409, #1418): the eye's checks (`optimise-eye.ts`) over its example, in both themes. */

import { test } from "playwright/test";
import { OPTIMISE_BUILDERS, THEMES, checkEyeInFolds, checkRunFromEye, eyeTitle, runTitle } from "./optimise-eye";

for (const theme of THEMES) {
    test(eyeTitle("Sheet", theme), ({ page }) => checkEyeInFolds(page, OPTIMISE_BUILDERS.Sheet, theme));
    test(runTitle("Sheet", theme), ({ page }) => checkRunFromEye(page, OPTIMISE_BUILDERS.Sheet, theme));
}
