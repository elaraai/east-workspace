/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the frame shows while a paged source, or the lens, reads: the footer's loading line, the cold load the skeleton
 * covers, and a read in flight after it.
 *
 * @packageDocumentation
 */

import { useMemo, useRef, useState } from "react";
import type { SheetBodyItem } from "./model.js";
import type { SheetLoadingLine } from "./Footer.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetLoadingFacts } from "./parts.js";

/**
 * Says how the sheet's reads stand (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @returns The loading line and the frame's loading facts
 */
export function useSheetReading(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody) {
    const { decodedRows, lensWanted, pagedSource, rowPx } = sheetDecode;
    const { lens, lensDrawn, pagesReady, pagesStandIn, paging, standingIn } = sheetSession;
    const { body } = sheetBody;
    // Under the lens (#1349): whether it is still reading, and why it could not place the narrowing's rows — beside
    // the rows it drew, or beside the pages that stand in while it reads.
    const lensLoading = lens.loading;
    // The stretches the lens reads (#1398): what the line names and the runs it draws mark busy — never one it is not reading.
    const lensReading = lens.reading;
    // Whether the view shows a stretch the lens has not read (#1398, CL3), as the frame's every report says — the scroll on
    // its way, and at rest before the lens has heard it, too: the lens hears the view and reads there only once it rests,
    // but the view waits for what it shows from the moment it shows it, so the line's reveal clock runs from then.
    const [lensAwaits, setLensAwaits] = useState(false);
    const lensAwaitsNow = useRef(false);
    const lensAwaiting = lensDrawn && lensAwaits;
    const lensSourceError = lens.sourceError;
    const lensError = lens.error;
    // A source that failed before anything landed: nothing else to show (#853) — the pages', or the lens's
    // placement of the narrowing's rows with no rows drawn and none standing in (#1349).
    const sourceFailure = paging.error ?? (lensWanted && !pagesStandIn ? lensError : undefined);
    // What the footer's loading line says (#1398, CL3): a read that failed — a window's or a stretch's, else the
    // source's own — then a narrowing's rows read while the last ones stand in, then the elements in flight: the
    // pages' nearest the view, or the lens's first stretch it reads.
    const line = useMemo<SheetLoadingLine | undefined>(() => {
        if (pagedSource === undefined) return undefined;
        const failed = body.find((it) => it.kind === "failed");
        if (failed?.kind === "failed") return { kind: "failed", from: failed.failure.from, to: failed.failure.to, reason: failed.failure.error };
        const reason = sourceFailure ?? (lensDrawn ? lensSourceError : pagesStandIn ? lensError : paging.sourceError);
        if (reason !== undefined) return { kind: "failed", from: undefined, to: undefined, reason };
        if (standingIn) return { kind: "filtering" };
        if (lensDrawn) {
            if (!lensLoading && !lensAwaiting) return undefined;
            // The stretch the lens reads first — a jump's, else the nearest the view — never a band it is not reading: one far
            // from the view, or one its placement has still to place; none named while the view waits for the lens to hear it.
            const bands = body.filter((it): it is Extract<SheetBodyItem, { kind: "band" }> => it.kind === "band");
            const at = lensReading.find((from) => bands.some((it) => it.band.from === from));
            const reading = at === undefined ? undefined : bands.find((it) => it.band.from === at);
            return reading !== undefined ? { kind: "loading", from: reading.band.from, to: reading.band.to } : { kind: "loading", from: undefined, to: undefined };
        }
        // A window the view shows, never one read ahead of it: nothing on screen waits for that.
        if (!paging.viewLoading) return undefined;
        return { kind: "loading", from: paging.reading?.from, to: paging.reading?.to };
    }, [pagedSource, body, sourceFailure, lensDrawn, lensSourceError, pagesStandIn, lensError, paging.sourceError, standingIn, lensLoading, lensAwaiting, lensReading, paging.viewLoading, paging.reading]);
    // Cold load (#1398, CL5): a paged source with nothing drawn yet and no failure to say — the frame's skeleton
    // covers it at the rows' pitch. After it, a read the view waits for leaves everything live and the grid busy: a
    // scroll far from the rows, every window it shows still on its way, draws the runs there and is never covered.
    const cold = pagedSource === undefined ? undefined
        : decodedRows === undefined && !lensDrawn && !pagesReady && !paging.landedOnce && !pagesStandIn && sourceFailure === undefined;
    const busy = cold === false && (standingIn || (lensDrawn ? lensLoading || lensAwaiting : paging.viewLoading));
    const loadingFacts = useMemo<SheetLoadingFacts>(() => ({ cold, busy, pitch: rowPx }), [cold, busy, rowPx]);
    return { busy, cold, lensAwaitsNow, lensReading, line, loadingFacts, setLensAwaits, sourceFailure };
}

/** What {@link useSheetReading} gives the parts after it. */
export type SheetReading = ReturnType<typeof useSheetReading>;
