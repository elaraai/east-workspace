/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (`Sheet Builder Spec.md` §7, §9.7): the sheet builder's
 * start pane, its tabs Rows · Registers · Columns — what the builder offers
 * to drag into the sheet, and the columns a viewer shows and hides.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import type { BuilderFrameDock } from "@elaraai/east-ui-components";
import type { SheetLibraryTabWord } from "../messages.js";
import type { SheetWords } from "../words.js";

/** The library's tabs, in order. */
const LIBRARY_TABS: readonly SheetLibraryTabWord[] = ["rows", "registers", "columns"];

/** The library open: the Calendar's 272px (§8). */
const LIBRARY_SIZE = "272px";

/**
 * The library pane, as `BuilderFrame` draws it: its name and icon, its tabs,
 * its width, and its collapsed state kept per viewer (SB24).
 *
 * @param words - The sheet's words
 * @returns The pane
 */
export function useSheetLibrary(words: SheetWords): BuilderFrameDock {
    const { m } = words;
    return useMemo((): BuilderFrameDock => ({
        label: m.libraryPane(),
        icon: "layer-group",
        size: LIBRARY_SIZE,
        persist: "local",
        tabs: LIBRARY_TABS.map((tab) => ({ key: tab, label: m.libraryTab({ tab }), body: null })),
    }), [m]);
}
