/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a phone's toolbar's second row asks something (`Mobile Builder Frame
 * Spec.md` FR8): the band under the row, which `BuilderFrame` hands the row's
 * items.
 *
 * @packageDocumentation
 */

import { createContext } from "react";

/**
 * Where the row's items ask something (FR8, ruled 4 Nov 2026): the band under
 * the row, in the flow, what is below giving way. `null` while the frame is not
 * a phone's: an item with none draws what it asks where it stands.
 */
export const FrameSessionBand = createContext<HTMLElement | null>(null);
