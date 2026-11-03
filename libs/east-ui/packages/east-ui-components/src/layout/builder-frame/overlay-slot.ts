/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a phone's frame draws a view over the whole builder (`Mobile Builder
 * Frame Spec.md` FR7, `Mobile Filters Spec.md` SL3): the frame's overlay
 * slot, over every region, which `BuilderFrame` hands its toolbar's items. A
 * toolbar item that opens a full-height view on a phone — the rail's Filters
 * view — portals it there; with none (a wider frame, or no frame), it opens
 * as it does elsewhere.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** The phone's overlay slot, while the frame is a phone's; `null` otherwise. */
export const FrameOverlaySlot = createContext<HTMLElement | null>(null);
