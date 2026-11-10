/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pane a part of a builder is drawn in (#1585): `BuilderFrame` hands what
 * each of its panes holds the pane's own way open, the one its rail takes — so
 * a form an issue gone to asks a field of opens the collapsed pane it is drawn
 * in, and the field shows to take the keyboard.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** The pane a part is drawn in, as the part opens it. */
export interface FramePaneOpen {
    /**
     * Opens the pane where it is collapsed, as its rail does — the viewer's doing, kept where the pane persists — and
     * leaves the focus where it is: what asked for the pane takes it as it shows. On a phone's frame its view opens, as
     * its strip tab opens it.
     */
    readonly open: () => void;
}

/** The pane a part is drawn in; `undefined` outside a pane the frame draws. */
export const FramePane = createContext<FramePaneOpen | undefined>(undefined);
