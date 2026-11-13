/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pane a part of a builder is drawn in (#1585): `BuilderFrame` hands what
 * each of its panes holds the pane's own way open and closed, the one its rail
 * and its collapse take — so a form an issue gone to asks a field of opens the
 * collapsed pane it is drawn in, and the field shows to take the keyboard; and
 * a phone's list that sends the viewer to main closes the view it is drawn in.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** The pane a part is drawn in, as the part opens and closes it. */
export interface FramePaneHandle {
    /**
     * Opens the pane where it is collapsed, as its rail does — the viewer's doing, kept where the pane persists — and
     * leaves the focus where it is: what asked for the pane takes it as it shows. On a phone's frame its view opens, as
     * its strip tab opens it, and the focus moves into it.
     */
    readonly open: () => void;
    /**
     * Closes the pane where it is open, as its collapse does — the viewer's doing — and, from inside it, gives the focus
     * back to its rail, or on a phone's frame to its strip tab.
     */
    readonly close: () => void;
}

/** The pane a part is drawn in; `undefined` outside a pane the frame draws. */
export const FramePane = createContext<FramePaneHandle | undefined>(undefined);
