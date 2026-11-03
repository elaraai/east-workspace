/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Whether a pane's body is drawn in a phone's drawer (`Mobile Builder Frame
 * Spec.md` FR5): `BuilderFrame` says so to what its drawers hold, so a pane
 * draws its phone form there — a builder's inspector its fields at touch
 * size, each in a section of its own (`Mobile Sheet Spec.md` SH12).
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** `true` inside a phone's drawer; `false` in a pane at a side, or anywhere else. */
export const FrameDrawer = createContext(false);
