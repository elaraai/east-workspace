/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { createContext, useContext } from "react";

/**
 * Render density for a `Slice.*` affordance:
 *   - `compact` — one-row rail form (chips + `+M more`), inside a chrome rail.
 *   - `focused` — standalone configuration surface (full editor / rail + footer).
 *   - `editor` — inside the sectioned `Slice.Edit` editor: the terminal
 *     surface. Nothing folds (every chip shows, wrapping) and nothing opens
 *     a further popover — `SliceEditPopover` renders as an inline disclosure.
 */
export type SliceDensity = "compact" | "focused" | "editor";

/**
 * Provided by `Slice.Frame` (= `compact`) so affordances placed in its eyebrow
 * render compact without the developer threading a flag. Defaults to `focused`
 * for standalone use.
 */
export const SliceDensityContext = createContext<SliceDensity>("focused");

/**
 * Effective density for an affordance: an explicit IR `density` override wins,
 * else the surrounding `Slice.Frame` context, else `focused`.
 */
export function useSliceDensity(override?: SliceDensity): SliceDensity {
    const ctx = useContext(SliceDensityContext);
    return override ?? ctx;
}
