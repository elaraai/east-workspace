/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a phone's frame puts the footer's loading line (`Mobile Builder Frame
 * Spec.md` R5): the start of the toolbar's second row. `BuilderFrame` hands
 * its footer the row's status slot; a {@link LoadingLine} under it draws
 * itself there, in its short form, and leaves a marker in the footer, which
 * the frame then does not show (FR1). While the line shows, the history's
 * phone form leaves the row's start to it — its count steps aside (the
 * `editHistory` recipe's `summary`).
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/** The phone's session row's status slot, while the frame is a phone's; `null` otherwise. */
export const SessionRowSlot = createContext<HTMLElement | null>(null);

/**
 * Where the row's items ask something (FR8, ruled 4 Nov 2026): the band under
 * the row, in the flow, what is below giving way. `null` while the frame is not
 * a phone's: an item with none draws what it asks where it stands.
 */
export const FrameSessionBand = createContext<HTMLElement | null>(null);
