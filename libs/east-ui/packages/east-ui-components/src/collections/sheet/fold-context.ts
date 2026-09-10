/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The seam between the toolbar's ladder and the tab strip's: the strip folds
 * its own tabs, and when it is at its floor — the whole-sheet tab, the
 * active tab, `+n`, `+ TAB` — and still overflows, it says so here, and the
 * toolbar climbs a rung (the count line goes, then the context label, then
 * the active tab's name ellipsises). `measureKey` changes on every rung, so
 * the strip re-measures after each and reports again while it still
 * overflows — the ladder climbs to where it fits in one pre-paint pass.
 */

import { createContext } from "react";

export interface SheetTabsFold {
    /** The strip is at its fold floor; `overflowing` says whether it still overflows. */
    onOverflow: (overflowing: boolean) => void;
    /** Changes whenever the toolbar's own ladder moves — a re-measure trigger. */
    measureKey: number;
}

export const SheetTabsFoldContext = createContext<SheetTabsFold | null>(null);
