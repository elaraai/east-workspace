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

import type { option } from "@elaraai/east";
import type { PlanBand, PlanRootValue } from "./model.js";
import { elementsIn, type WindowedSourceValue } from "@elaraai/east-ui-components/internal";
import { PLAN_GEOMETRY } from "./geometry.js";

/**
 * The decoded windowed arm — `paged`, or `pinned` with its revision and
 * refresh — the derived source at the canvas's blocks (#823). A source the
 * canvas composes over another — a paged `data` or a paged resource kind with
 * the event kinds' rows in every window (#1192, #1199) — names the snapshot of
 * the data its windows read apart from its revision, which moves too when its
 * windows are read again over the same data: new events placed on them, new
 * drafts. A key search's answer indexes the snapshot alone.
 */
export type PlanPagedSourceValue = WindowedSourceValue<PlanRootValue["rows"]> & {
    /** The snapshot of the data its windows read, `none` while it resolves; omitted, its revision is that snapshot. */
    readonly snapshot?: (() => option<string>) | undefined;
};

/** Source elements per window — the IR's, since its editing session reads an
 *  entry back from the very window the canvas paged it in (#880). */
export { PLAN_PAGE_SIZE } from "@elaraai/e3-ui/internal";

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
 * block and a window through the origin map (#823: each paged block pages on
 * its own, so demand follows the block the viewport is in). No layout
 * knowledge crosses the boundary.
 */
export type PlanViewport =
    | { kind: "row"; key: string }
    | {
        kind: "band";
        /** The block whose band it is (#823). */
        block: number;
        at: "head" | "tail";
        /** Pixels from the band's own top to the viewport center, when the
         *  caller knows them (`VirtualRows`' center report). Without them the
         *  driver can only name the window adjacent to the run — a far
         *  scrollbar drag then walks the gap instead of rebasing (#612). */
        px?: number | undefined;
    }
    /** A failed window's band — it names its own block and window (#811). */
    | { kind: "window"; block: number; w: number };

/** Elements the band covers, for its caption. */
export function bandElements(band: PlanBand): number {
    return Math.max(0, band.to - band.from + 1);
}

/** Re-exported so the renderer can size a band's own slot. */
export { elementsIn };
