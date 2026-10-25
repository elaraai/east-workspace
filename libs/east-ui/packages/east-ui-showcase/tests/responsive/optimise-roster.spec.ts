/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/** The Elara eye in the Roster (#1409, #1421): the eye's checks (`optimise-eye.ts`) over its example, in both themes. */

import { test } from "playwright/test";
import { OPTIMISE_BUILDERS, THEMES, checkEyeInFolds, checkRunFromEye, eyeTitle, runTitle } from "./optimise-eye";

for (const theme of THEMES) {
    test(eyeTitle("Roster", theme), ({ page }) => checkEyeInFolds(page, OPTIMISE_BUILDERS.Roster, theme));
    test(runTitle("Roster", theme), ({ page }) => checkRunFromEye(page, OPTIMISE_BUILDERS.Roster, theme));
}
