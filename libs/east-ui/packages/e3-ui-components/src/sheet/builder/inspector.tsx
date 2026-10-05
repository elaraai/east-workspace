/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector pane (`Sheet Builder Spec.md` §7, §9.9): the sheet builder's
 * end pane, its tabs Details · Issues — the selected row's every field, and
 * the batch's issues.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import type { BuilderFrameDock } from "@elaraai/east-ui-components";
import type { SheetInspectorTabWord } from "../messages.js";
import type { SheetWords } from "../words.js";

/** The inspector's tabs, in order. */
const INSPECTOR_TABS: readonly SheetInspectorTabWord[] = ["details", "issues"];

/** The inspector open: the Calendar's 320px (§8). */
const INSPECTOR_SIZE = "320px";

/**
 * The inspector pane, as `BuilderFrame` draws it: its name and icon, its
 * tabs, its width, and its collapsed state kept per viewer (SB24).
 *
 * @param words - The sheet's words
 * @returns The pane
 */
export function useSheetInspector(words: SheetWords): BuilderFrameDock {
    const { m } = words;
    return useMemo((): BuilderFrameDock => ({
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        tabs: INSPECTOR_TABS.map((tab) => ({ key: tab, label: m.inspectorTab({ tab }), body: null })),
    }), [m]);
}
