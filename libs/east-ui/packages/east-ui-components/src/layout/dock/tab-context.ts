/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The tab of a pane a part is drawn in (#1585): `DockPane` hands what each of
 * its tabs holds the tab's own way open, the one its tab on the row takes — so
 * a form an issue gone to asks a field of, behind another tab, opens the tab it
 * is drawn in, and the field shows to take the keyboard.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** The tab a part is drawn in, as the part opens it. */
export interface DockTabOpen {
    /**
     * Opens the tab where another is open, as its tab on the row does — told through the pane's `onTabChange` — and
     * leaves the focus where it is: what asked for the tab takes it as it shows.
     */
    readonly open: () => void;
}

/** The tab a part is drawn in; `undefined` outside a tab a pane draws. */
export const DockTab = createContext<DockTabOpen | undefined>(undefined);
