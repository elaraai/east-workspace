/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What each row is handed beside its cells: the drop it takes and the grip that moves it, the seam above it and its
 * inserts, a folded gutter's menu, a band's mixed pick, and what a run of rows not read yet says and retries.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDragLayerOptional, type CellCoord, type DragEventValue, type DragPayload } from "@elaraai/east-ui-components";
import { recordSliceNoun } from "@elaraai/east-ui-components/internal";
import { SHEET_PAGE_SIZE } from "./paging.js";
import { slotAt, type SheetRowDrop } from "./drop.js";
import type { InsertionActions, InsertSeam } from "./Insertion.js";
import { insertsLoose, groupInsertionSide } from "./insertion-gesture.js";
import type { SheetRowAction } from "./Rows.js";
import type { SheetHost } from "./parts.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetGestures } from "./use-gestures.js";
import type { SheetReading } from "./use-reading.js";
import type { SheetRing } from "./use-ring.js";
import type { SheetScroll } from "./use-scroll.js";

/**
 * The sheet's drops as they stand (#1187): what the rows' shared
 * {@link SheetRowDrop} and the sheet's drop target call — made afresh each
 * render, read through a ref, so neither changes for it.
 */
export interface SheetDropApi {
    /** Whether the drop a candidate event makes lands. */
    canDrop: (event: DragEventValue) => boolean;
    /** What the ghost says where a drag rests. */
    caption: (coord: CellCoord, payload: DragPayload) => string | undefined;
    /** Where it rests, as the announcements name it. */
    name: (coord: CellCoord, payload: DragPayload) => string;
    /** A drag rests over a row that takes it: the seam, or the row, lights. */
    hover: (el: HTMLElement, coord: CellCoord, payload: DragPayload) => void;
    /** A completed drag: run as one transaction — `false` when nothing changed. */
    drop: (event: DragEventValue) => boolean;
}

/**
 * Builds what the rows are handed beside their cells (see the module docs).
 *
 * @param host - What the frame hands the parts
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetGestures - The history's runner, the discard and the insertion
 * @param sheetReading - The loading line and the frame's loading facts
 * @param sheetRing - The strip, the active cell and the hint
 * @param sheetScroll - The scroll's report, the sticky rows, the sizes and the motion
 * @returns The rows' drop, seams, inserts, decisions and runs
 */
export function useSheetRowParts(host: SheetHost, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody, sheetMachine: SheetMachine, sheetEffects: SheetEffects, sheetGestures: SheetGestures,
    sheetReading: SheetReading, sheetRing: SheetRing, sheetScroll: SheetScroll) {
    const {
        canInsertGroups, canInsertRows, capabilities, chrome, folded, group, hostGrid, keyed, loose, noun, viewport,
        words,
    } = sheetDecode;
    const { canEdit, draftOf, editingState, lens, lensDrawn, paging, rows, ui } = sheetSession;
    const { blankLineRowOf, body, rowOf, rowSpace } = sheetBody;
    const { ctx } = sheetMachine;
    const { cardRef } = sheetEffects;
    const { anchorFor, onInsert } = sheetGestures;
    const { lensReading } = sheetReading;
    const { anchorR, wr } = sheetRing;
    const { headerRef } = sheetScroll;
    // ── Drag and drop: what the rows hold (#1187) ─────────────────────────
    // With the frame's drops, every row is a drop target on the sheet's
    // surface, and a row, a line or a band its grip moves: one object every
    // row shares, held still while the frame's drops are, its functions reading the
    // plans the sheet makes (`dropApi`, in `use-drops.ts`), so no row renders again for a
    // drag. A sheet that takes no gesture now — read only, or between an
    // Apply's request and its answer — takes no drop either.
    const dropHost = host.drop;
    const dragActive = useDragLayerOptional()?.active === true;
    // No drop target and no grip while a run's call is out (R2).
    const dropOn = dropHost !== undefined && canEdit && editingState.available;
    const dropApi = useRef<SheetDropApi | undefined>(undefined);
    const rowDrop = useMemo<SheetRowDrop | undefined>(() => (dropHost === undefined ? undefined : {
        surface: dropHost.surface,
        canDrop: (event) => dropApi.current?.canDrop(event) ?? false,
        slotAt: (payload, rect, clientY) => slotAt(dropHost, payload, rect, clientY),
        options: {
            caption: (coord, payload) => dropApi.current?.caption(coord, payload),
            name: (coord, payload) => dropApi.current?.name(coord, payload) ?? "",
        },
        hover: (el, coord, payload) => dropApi.current?.hover(el, coord, payload),
    }), [dropHost]);
    // What a grip moves (SB44): flat and loose rows where they keep no key order, lines, and groups.
    const moveRowsOn = dropOn && capabilities.moveRows.type !== "none";
    const movesRows = moveRowsOn && !keyed;
    const movesLines = moveRowsOn;
    const movesGroups = dropOn && capabilities.moveGroups;
    const [insertPreview, setInsertPreview] = useState<{ r: number; kind: "row" | "group"; side: "gutter" | "body" } | undefined>(undefined);
    const canInsert = canEdit && editingState.available && (canInsertRows || canInsertGroups);
    // A drag in flight owns the gutter: no seam offers its chips under it — nor
    // does a folded gutter, whose rows' menus hold the inserts (#1215), nor a
    // host's grid, which has no gutter (#1531).
    const seamsOn = canInsert && !dragActive && !folded && hostGrid === undefined;
    /** What the seam above row `r` offers, and what each chip previews. */
    const insertActions = useCallback((r: number, side: "gutter" | "body"): InsertionActions => {
        const anchor = anchorFor(r, "before");
        const ordered = anchor.child !== undefined || anchor.tail === true || !keyed;
        // Above a band, or beside a loose row, the row chip inserts a loose row (#846) — a row, not a line.
        const looseRow = loose && insertsLoose(anchor, rows);
        return {
            ordered, groupOrdered: !keyed,
            line: group !== undefined && !looseRow, noun: noun.singular,
            row: canInsertRows && (group === undefined || anchor.entry !== undefined || looseRow) ? () => onInsert("row", r, "before") : undefined,
            group: canInsertGroups ? () => onInsert("group", r, "before") : undefined,
            preview: kind => {
                if (kind === undefined || (kind === "row" ? !ordered : keyed)) { setInsertPreview(undefined); return; }
                if (kind === "row") { setInsertPreview({ r, kind, side }); return; }
                const parent = rows.find(row => row.id === anchor.entry);
                if (parent === undefined) { setInsertPreview(undefined); return; }
                const gside = groupInsertionSide(parent, anchor);
                const next = rows[rows.indexOf(parent) + 1];
                const target = gside === "before" ? rowOf(parent.id) : next === undefined ? blankLineRowOf(parent.id) : rowOf(next.id);
                setInsertPreview(target === undefined ? undefined : { r: target, kind, side });
            },
        };
    }, [canInsertRows, canInsertGroups, anchorFor, keyed, group, loose, noun, onInsert, rows, rowOf, blankLineRowOf]);
    // The hovered seam. Its chips are drawn once, in the card's insertion
    // layer, placed from the seam's and the gutter's boxes on the screen: the
    // layer sits over every row and under the pinned header, so nothing a row
    // holds (its editor, its ring, the row above) ever covers them.
    const [seam, setSeam] = useState<InsertSeam | undefined>(undefined);
    const seamHitRef = useRef<HTMLElement | null>(null);
    const insertLayerRef = useRef<HTMLDivElement | null>(null);
    const onSeamEnter = useCallback((r: number, side: "gutter" | "body", hit: HTMLElement) => {
        const card = cardRef.current;
        const gutter = hit.closest<HTMLElement>("[data-slot=gutter]");
        if (card === null || gutter === null) return;
        const cardBox = card.getBoundingClientRect();
        const hitBox = hit.getBoundingClientRect();
        const gutterBox = gutter.getBoundingClientRect();
        seamHitRef.current = hit;
        // The chips sit wholly below the column header: the seam above the first row lies on its edge.
        const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? -Infinity;
        const top = Math.max(hitBox.top + hitBox.height / 2, headerBottom + 12) - cardBox.top;
        // The chips: 8 px into the gutter's actions column — wherever the number column beside it ends — else from the gutter edge.
        const actions = side === "gutter" ? gutter.querySelector<HTMLElement>(":scope > [data-slot=fillSlot]") : null;
        setSeam({ r, side, top, left: (actions !== null ? actions.getBoundingClientRect().left + 8 : gutterBox.right) - cardBox.left });
        insertActions(r, side).preview?.(canInsertRows ? "row" : "group");
    }, [insertActions, canInsertRows, cardRef, headerRef]);
    /** The pointer left the seam or its chips: they stay while it moves between the two. */
    const onSeamLeave = useCallback((to: EventTarget | null) => {
        if (to instanceof Node && (insertLayerRef.current?.contains(to) === true || seamHitRef.current?.contains(to) === true)) return;
        seamHitRef.current = null;
        setSeam(undefined);
        setInsertPreview(undefined);
    }, []);
    // A scroll moves the rows from under the chips, and a change of rows moves the seam: either way the chips go until the pointer finds a seam again.
    // The scroll is the frame's, either way. A drag starting takes them too (#1187).
    useEffect(() => { setSeam(undefined); setInsertPreview(undefined); }, [body, dragActive]);
    useEffect(() => {
        if (viewport === null) return;
        const hide = () => { setSeam(undefined); setInsertPreview(undefined); };
        const frame = viewport.frame;
        frame.addEventListener("scroll", hide, { passive: true });
        return () => { frame.removeEventListener("scroll", hide); };
    }, [viewport]);
    // A row draws its own seam from primitives and this one stable handler,
    // so hovering a seam, or a gesture anywhere, never hands every row a new
    // element (#858).
    const seamEnterRef = useRef(onSeamEnter);
    seamEnterRef.current = onSeamEnter;
    const onRowSeamEnter = useCallback((r: number, side: "gutter" | "body", hit: HTMLElement) => seamEnterRef.current(r, side, hit), []);
    // Whether a body item shows an action button in the gutter's actions column: a proposal's ✓ ×, an anchor's → fill, a draft's × discard.
    const hasDecisions = useCallback((i: number): boolean => {
        const it = body[i];
        if (it === undefined) return false;
        if (it.kind === "proposal") return true;
        const r = rowSpace.rowOf[i] ?? -1;
        // The copilot's → sits on its anchor — a real row, or the blank line being typed on.
        if ((it.kind === "real" || it.kind === "blank") && anchorR === r && ui.sugg !== null && ui.sugg.fill.size > 0) return true;
        if (it.kind === "real") return draftOf(it.group?.row.id ?? it.row.id, it.group?.key).discardable;
        if (it.kind === "group") return draftOf(it.row.id).discardable;
        return false;
    }, [body, rowSpace, anchorR, ui.sugg, draftOf]);
    /** The seam above body item `i` takes the gutter unless an action sits in the actions column on either side of it. */
    const seamSide = useCallback((i: number): "gutter" | "body" => (hasDecisions(i) || hasDecisions(i - 1) ? "body" : "gutter"), [hasDecisions]);
    /**
     * A folded gutter's inserts at a row (#1215): what the insertion strip
     * offers with the row selected, in its words — above and below it (in
     * key order, one to add), and a new group where the sheet takes one.
     */
    const insertsAt = (r: number): SheetRowAction[] => {
        if (!canEdit || !editingState.available) return [];
        const ordered = !keyed || anchorFor(r, "before").child !== undefined;
        const out: SheetRowAction[] = [];
        if (canInsertRows && ordered) out.push({ value: "insertAbove", label: words.m.insertAbove(), run: () => onInsert("row", r, "before") });
        if (canInsertRows && (group === undefined || loose || rows.length > 0)) out.push({ value: "insertBelow", label: words.m.insertBelow({ ordered }), run: () => onInsert("row", r, "after") });
        if (canInsertGroups) out.push({ value: "insertGroup", label: words.m.insertNewGroup({ noun: noun.singular }), run: () => onInsert("group", r, "after") });
        return out;
    };
    // Read as a row's menu opens, so no row renders again for it (#858).
    const insertsRef = useRef(insertsAt);
    insertsRef.current = insertsAt;
    const rowInserts = useCallback((r: number) => insertsRef.current(r), []);
    const foldedInserts = folded && canInsert ? rowInserts : undefined;

    // A group's band is "mixed" while some, not all, of its lines are picked (the band's checkbox goes indeterminate).
    const bandMixed = useCallback((r: number, picked: boolean): boolean => {
        if (wr === null || picked) return false;
        const g = ctx.groupAt?.(r);
        return g?.lines !== undefined && !(g.lines.r1 < wr.r0 || g.lines.r0 > wr.r1);
    }, [wr, ctx]);
    // What the rail counts each source in where it has no label of its own (#1345): the rows in the sheet's word for
    // them — a grouped sheet's groups' — and each other source in the word the frame gives it.
    const hostNouns = host.nouns;
    const railNouns = useMemo(() => (chrome === undefined ? undefined : Object.fromEntries(chrome.slice.parts.flatMap((part) => (part.label.type === "some" ? []
        : [[part.source, part.source === "rows" ? (group !== undefined ? noun.plural : words.m.railRows()) : hostNouns?.get(part.source) ?? part.source] as const])))),
    [chrome, group, noun, words.m, hostNouns]);
    // What the loading line and a failed run name the rows by: what the rail counts them in (#1398).
    const rowsSource = chrome?.slice.parts.find((part) => part.source === "rows");
    const rowsNoun = rowsSource === undefined ? (group !== undefined ? noun.plural : words.m.railRows()) : recordSliceNoun(rowsSource, railNouns, words.locale);
    // A failed read's Retry: the lens's segment, or the paged window (#853, #1349).
    const retryRead = lensDrawn ? lens.retry : paging.retry;
    // Whether a run's own reads are in flight (#1398): a stretch under the lens while the lens reads its segment (#1349) —
    // never one it is not reading, far from the view or still to be placed; a paged run while one of the windows it
    // stands for is — never because another, read ahead elsewhere, is.
    const pendingWindows = paging.pending;
    const runLoading = useCallback((band: { at: string; from: number; to: number }): boolean => (band.at === "reading"
        ? lensReading.includes(band.from)
        : pendingWindows.some((w) => w * SHEET_PAGE_SIZE <= band.to && (w + 1) * SHEET_PAGE_SIZE - 1 >= band.from)), [pendingWindows, lensReading]);
    return {
        bandMixed, dragActive, dropApi, dropHost, dropOn, foldedInserts, insertActions, insertLayerRef, insertPreview,
        movesGroups, movesLines, movesRows, onRowSeamEnter, onSeamLeave, railNouns, retryRead, rowDrop, rowsNoun,
        runLoading, seam, seamSide, seamsOn,
    };
}

/** What {@link useSheetRowParts} gives the parts after it. */
export type SheetRowParts = ReturnType<typeof useSheetRowParts>;
