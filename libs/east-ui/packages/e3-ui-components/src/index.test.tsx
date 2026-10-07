/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What a host reaches through the package's root. The root is imported when
 * the file loads, since loading every renderer of the package takes longer than
 * a test is given.
 */

import { describe, test, expect } from "vitest";
import { hasExtensionRenderer } from "@elaraai/east-ui-components";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as root from "./index.js";
import { RECOVERY_FIRST_MS, RECOVERY_MAX_MS, recoveryDelay, useQueryRecovery } from "./platform/recovery.js";
import { usePreviewControls } from "./components/preview-controls.js";

describe("the package's root", () => {
    test("gives a host the recovery the previews' stages use, so its own reads recover as theirs do (#1062)", () => {
        expect(root.useQueryRecovery).toBe(useQueryRecovery);
        expect(root.recoveryDelay).toBe(recoveryDelay);
        expect([root.RECOVERY_FIRST_MS, root.RECOVERY_MAX_MS]).toEqual([RECOVERY_FIRST_MS, RECOVERY_MAX_MS]);
    });

    test("gives a host the handle its own header's controls act on a preview through (#1209)", () => {
        expect(root.usePreviewControls).toBe(usePreviewControls);
    });

    test("registers the Flowchart's renderer against its carrier as it loads, so a host's `<Flowchart>` draws (#1243)", () => {
        expect(root.EastChakraFlowchart).toBeDefined();
        expect(hasExtensionRenderer(Flowchart.Component.name)).toBe(true);
    });
});
