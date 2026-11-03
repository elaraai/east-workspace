/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a phone's frame draws what main's or a pane's popovers open: the
 * bottom panel, in the flow above the pane strip, as the Sheet's action bar
 * stands (`Mobile Builder Frame Spec.md` FR9, `Mobile Sheet Spec.md` SH9). A
 * frame takes it with `phonePanel`; with none — a wider frame, a frame that
 * does not take it, or no frame — a popover opens as it does elsewhere. A pane
 * open over the builder has a slot of its own, under what it holds.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** The slot the region around it opens its popovers in, while the frame is a phone's and takes the panel; `null` otherwise. */
export const FrameBottomPanel = createContext<HTMLElement | null>(null);
