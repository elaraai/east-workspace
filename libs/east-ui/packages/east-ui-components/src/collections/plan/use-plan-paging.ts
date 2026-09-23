/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The paged canvas's vocabulary (#577) — the page size, the failed-band floor,
 * the decoded source type and the viewport report — shared by the paging
 * driver, the window reader and the chrome.
 *
 * The driver itself is framework-free since #815: `controller/paging.ts` holds
 * the ledger and the residency as plain state, and the canvas controller owns
 * it. (This module held the React hook that sequenced them through four
 * effects that set each other's state.)
 *
 * @packageDocumentation
 */

import type { PlanBand, PlanRootValue } from "./model.js";
import { elementsIn } from "./window-ledger.js";
import { PLAN_GEOMETRY } from "./geometry.js";

/** The decoded `paged` arm — the derived source at the canvas-row type. */
export type PlanPagedSourceValue = Extract<PlanRootValue["rows"], { type: "paged" }>["value"];

/** Source elements per window. */
export const PLAN_PAGE_SIZE = 200;

/** The shortest a failed window's band renders (#811) — its reason and its
 *  Retry must stay legible even in a short last window, or before any window
 *  has taught the ledger its geometry. The geometry table's entry (#817); the
 *  same at every density. */
export const FAILED_BAND_MIN_PX = PLAN_GEOMETRY.default.failedBandMin;

export type { PlanBand, PlanWindowFailure } from "./model.js";

/**
 * Where the viewport is, in the caller's own terms.
 *
 * @remarks
 * `VirtualRows` reports a mounted range in BODY-ITEM indices, and the body is
 * the canvas's business — it interleaves gap bands under a links focus, hides
 * collapsed subtrees, pins rows above the scroll. So the canvas says which ROW
 * (or which band) the viewport is over, and the driver maps that back to a
 * window through the origin map. No layout knowledge crosses the boundary.
 */
export type PlanViewport =
    | { kind: "row"; key: string }
    | {
        kind: "band";
        at: "head" | "tail";
        /** Pixels from the band's own top to the viewport center, when the
         *  caller knows them (`VirtualRows`' center report). Without them the
         *  driver can only name the window adjacent to the run — a far
         *  scrollbar drag then walks the gap instead of rebasing (#612). */
        px?: number | undefined;
    }
    /** A failed window's band — it names its own window (#811). */
    | { kind: "window"; w: number };

/** Elements the band covers, for its caption. */
export function bandElements(band: PlanBand): number {
    return Math.max(0, band.to - band.from + 1);
}

/** Re-exported so the renderer can size a band's own slot. */
export { elementsIn };
