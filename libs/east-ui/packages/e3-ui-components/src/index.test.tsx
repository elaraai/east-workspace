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
import { ArrayType, East, OptionType, StringType, equalFor, none, some, variant } from "@elaraai/east";
import type { DataManifest } from "@elaraai/e3-types";
import { DecisionConstraintType, DiffBindingType, decisionBindPlatformFn } from "@elaraai/e3-ui/internal";
import {
    ClipboardImpl, DownloadImpl, OverlayImpl, ShareImpl, SliceApplyImpl, SliceImpl, StateImpl,
} from "@elaraai/east-ui-components";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import * as root from "./index.js";
import { RECOVERY_FIRST_MS, RECOVERY_MAX_MS, recoveryDelay, useQueryRecovery } from "./platform/recovery.js";
import { usePreviewControls } from "./components/preview-controls.js";
import { DecisionBindPlatform } from "./decision/handle-runtime.js";

describe("the package's root", () => {
    test("gives a host the recovery the previews' stages use, so its own reads recover as theirs do (#1062)", () => {
        expect(root.useQueryRecovery).toBe(useQueryRecovery);
        expect(root.recoveryDelay).toBe(recoveryDelay);
        expect([root.RECOVERY_FIRST_MS, root.RECOVERY_MAX_MS]).toEqual([RECOVERY_FIRST_MS, RECOVERY_MAX_MS]);
    });

    test("gives a host the handle its own header's controls act on a preview through (#1209)", () => {
        expect(root.usePreviewControls).toBe(usePreviewControls);
    });

    test("gives a host Decision.bind's implementation, so the platforms it lists from the exports bind decisions as UITaskPreview's do (#1222)", () => {
        expect(root.DecisionBindPlatform).toBe(DecisionBindPlatform);

        // UITaskPreview's list, from what the packages export by name.
        const manifest: DataManifest = { paths: [], functions: [], records: [], pages: [] };
        const platforms = [
            ...StateImpl, ...SliceImpl, ...SliceApplyImpl, ...OverlayImpl,
            ...ClipboardImpl, ...DownloadImpl, ...ShareImpl, ...root.DecisionBindPlatform,
            ...root.createScopedBindPlatform(manifest),
            ...root.createScopedPagedPlatform(manifest.pages),
            ...root.createScopedFuncPlatform(manifest.functions),
            ...root.createScopedRecordPlatform(manifest.records),
        ];
        const decisions = [{ source: [variant("field", "decisions")], patch: none, mode: variant("direct", null) }];
        const judgements = { source: [variant("field", "judgements")], patch: none, mode: variant("direct", null) };
        const opened = East.function([], OptionType(StringType), ($) => {
            const handle = $.let(decisionBindPlatformFn(
                [DecisionConstraintType],
                East.value(decisions, ArrayType(DiffBindingType)),
                East.value(judgements, DiffBindingType),
            ));
            $(handle.select("case-1"));
            $.return(handle.selected());
        });

        StateRuntime.initializeStore(new UIStore());
        expect(equalFor(OptionType(StringType))(East.compile(opened, platforms)(), some("case-1"))).toBe(true);

        // Without it, the same UI has no `decision_bind`.
        const without = platforms.filter(platform => !root.DecisionBindPlatform.includes(platform));
        expect(() => East.compile(opened, without)()).toThrow(/'decision_bind' is not available/);
    });
});
