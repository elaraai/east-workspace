/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows' scroll: what it reports to the paging or the lens, the open editor laid over its cell, the frame's widths and
 * the number column's, the band and the line that stick under the header, a keyboard move's reveal of its column, and the
 * slide of the rows a fold or an opening moves.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isLooseRow, itemPx, stickyRows } from "./model.js";
import type { SheetViewport } from "./paging.js";
import { selectionRect } from "./sheet-state.js";
import { NUMBER_PX } from "./gutter.js";
import { SheetEditor } from "./Editor.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetOpenEditor } from "./use-open-editor.js";
import type { SheetReading } from "./use-reading.js";
import type { SheetRing } from "./use-ring.js";
import { elementUnder, keyOfItem, mountedBoxes, openKeysOf, spanOf } from "./items.js";

const NOTHING: ReadonlySet<string> = new Set();

/** How long rows slide after a gesture that folds or opens (ms) — a little past the slide itself. */
const MOVE_MS = 320;

/**
 * Lays the rows out in their scroll, and follows it (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetOpenEditor - The styles and the open editor
 * @param sheetReading - The loading line and the frame's loading facts
 * @param sheetRing - The strip, the active cell and the hint
 * @returns The viewport's report, the editor's node, the sticky rows, the sizes and the motion
 */
export function useSheetScroll(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine, sheetEffects: SheetEffects, sheetOpenEditor: SheetOpenEditor,
    sheetReading: SheetReading, sheetRing: SheetRing) {
    const {
        bandPx, blanks, group, gutterPx, phoneFrame, pinPx, rowNumbers, rowPx, setFramePx, setNumberPx, setViewPx,
        viewport,
    } = sheetDecode;
    const { folds, geometry, lens, lensDrawn, paging, rows, total, ui } = sheetSession;
    const { body, endPosition } = sheetBody;
    const { viewportRef } = sheetMachine;
    const { editorFocus, revealSeq } = sheetEffects;
    const {
        edit, editBadge, editCombobox, editDate, editGhost, editMeta, editResolve, editWhenLevel, linkGhostText,
        linkView, onEditorBlur, onEditorBrowse, onEditorChange, onEditorKey, onEditorPick, onHalfDown, styles,
    } = sheetOpenEditor;
    const { lensAwaitsNow, setLensAwaits } = sheetReading;
    const { ringCellRef } = sheetRing;
    // ── Viewport → the driver (paged), or the lens (#1349) ────────────────
    const reportViewport = paging.reportViewport;
    const lensReport = lens.reportViewport;
    const reportRange = useCallback((
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
        shown?: { startIndex: number; endIndex: number },
    ) => {
        // Under the lens, whether the items the view shows hold a stretch it has not read — said at once, from every
        // report: the view waits for it from the moment it shows it (#1398, CL3).
        let awaits = false;
        if (lensDrawn) {
            const lo = shown?.startIndex ?? range.startIndex;
            const hi = shown?.endIndex ?? range.endIndex;
            for (let i = lo; i <= hi && !awaits; i++) awaits = body[i]?.kind === "band";
        }
        if (awaits !== lensAwaitsNow.current) {
            lensAwaitsNow.current = awaits;
            setLensAwaits(awaits);
        }
        if (lensDrawn) {
            // The record's rows the mounted items stand for, from the first's to the last's: the lens reads the segments they meet.
            let from: number | undefined;
            let to: number | undefined;
            for (let i = range.startIndex; i <= range.endIndex && from === undefined; i++) from = body[i] !== undefined ? spanOf(body[i]!)?.from : undefined;
            for (let i = range.endIndex; i >= range.startIndex && to === undefined; i--) to = body[i] !== undefined ? spanOf(body[i]!)?.to : undefined;
            if (from !== undefined && to !== undefined) lensReport(from, to, isScrolling);
            return;
        }
        const mid = Math.floor((range.startIndex + range.endIndex) / 2);
        const item = body[center?.index ?? mid] ?? body[range.startIndex];
        if (item === undefined) return;
        // The source elements the view shows (#1398): the rows' own, a band's edge where it meets the view — its
        // bottom above the rows, its top below them — and, under the view's centre, the band's element there.
        let from: number | undefined;
        let to: number | undefined;
        const take = (p: number) => { from = from === undefined || p < from ? p : from; to = to === undefined || p > to ? p : to; };
        for (let i = range.startIndex; i <= range.endIndex; i++) {
            const it = body[i];
            if (it === undefined || it.kind === "proposal") continue;
            if (it.kind === "band") {
                if (i === center?.index) take(elementUnder(it, center.withinPx) ?? it.band.from);
                else take(it.band.at === "head" ? it.band.to : it.band.from);
            } else if (it.kind === "failed") take(it.failure.from);
            else take(it.position);
        }
        const shows = from !== undefined && to !== undefined ? { from, to } : undefined;
        let at: SheetViewport;
        if (item.kind === "band") at = item.band.at === "reading" ? { kind: "row", offset: item.band.from, shows } : { kind: "band", at: item.band.at, px: center?.withinPx, shows };
        else if (item.kind === "failed") at = { kind: "row", offset: item.failure.from, shows };
        else at = { kind: "row", offset: item.position, shows };
        reportViewport(at, isScrolling);
    }, [body, reportViewport, lensDrawn, lensReport, lensAwaitsNow, setLensAwaits]);

    // ── Rows ──────────────────────────────────────────────────────────────
    const rect = selectionRect(ui);
    const editorNode = useMemo<ReactNode>(() => edit !== null && editMeta !== undefined
        ? (
            <SheetEditor
                styles={styles}
                kind={editMeta.kind}
                value={edit.val}
                date={editDate}
                seed={edit.seeded && edit.val.length === 1 ? edit.val : undefined}
                ghost={linkView !== undefined ? linkGhostText : editGhost}
                resolve={editResolve}
                badge={editBadge}
                error={edit.err}
                focus={editorFocus}
                ariaLabel={editMeta.header}
                link={linkView}
                options={editCombobox?.options}
                highlighted={editCombobox?.highlighted}
                browse={editCombobox?.browse}
                onPick={onEditorPick}
                onBrowse={onEditorBrowse}
                whenLevel={editWhenLevel}
                onChange={onEditorChange}
                onKey={onEditorKey}
                onBlur={onEditorBlur}
                onHalfDown={onHalfDown}
            />
        )
        : null, [edit, editMeta, editDate, styles, editGhost, editResolve, editBadge, editorFocus, onEditorChange, onEditorKey, onEditorBlur, linkView, linkGhostText, onHalfDown, editCombobox, onEditorPick, onEditorBrowse, editWhenLevel]);
    // What a row in the range and the edited row are handed, held still while
    // they are the same — a hover elsewhere renders neither (#858).
    const rangeCols = useMemo(() => ({ c0: rect.c0, c1: rect.c1 }), [rect.c0, rect.c1]);
    const editC = edit !== null ? edit.c : undefined;
    const editorAt = useMemo(() => (editC !== undefined ? { c: editC, node: editorNode } : undefined), [editC, editorNode]);
    // ── The sticky band (#740, G1) — which band sits under the header at the scroll offset ──
    // The same heights the paged driver measures windows by (#855).
    const sizeOf = useCallback((i: number): number => {
        const item = body[i];
        return item === undefined ? rowPx : itemPx(item, geometry);
    }, [body, rowPx, geometry]);
    // A row keeps its place on screen when a window lands above it at a height
    // its estimate missed (#878) — the frame anchors the scroll on it. An
    // unloaded band never anchors: rows landing below it move its top.
    const anchorable = useCallback((i: number): boolean => body[i]?.kind !== "band", [body]);
    viewportRef.current = viewport;
    // The header pins in the frame, which scrolls its own rows: the band and
    // the line that stick under it are read off it.
    const pinnedFrame = viewport?.frame ?? null;
    // The frame's widths (`use-decode.ts`), measured before the first paint: a sheet
    // that folds its gutter never paints the gutter it folds.
    const viewFrame = viewport?.frame;
    useLayoutEffect(() => {
        if (viewFrame === undefined || typeof ResizeObserver === "undefined") return;
        const measure = () => { setViewPx(viewFrame.clientWidth); setFramePx(viewFrame.offsetWidth); };
        const observer = new ResizeObserver(measure);
        observer.observe(viewFrame);
        measure();
        return () => observer.disconnect();
    }, [viewFrame, setFramePx, setViewPx]);
    // The Row column shown or hidden puts the window back at its start (SH2): once it is laid out, for the browser re-snaps
    // the scroll to the column it rested on as the tracks change.
    const rowNumbersWere = useRef(rowNumbers);
    useLayoutEffect(() => {
        if (rowNumbersWere.current === rowNumbers) return;
        rowNumbersWere.current = rowNumbers;
        if (viewFrame !== undefined) viewFrame.scrollLeft = 0;
    }, [rowNumbers, viewFrame]);
    // The widest number each of the gutter's numbers can show: a row's — a
    // flat sheet's blank padding and a proposal's among them — a band's, a
    // loose row's and a line's; and, apart, a line's with its sub rows'
    // chevron before it. A group folded or not loaded yet counts as it will
    // show, so the column holds still as the viewer folds and scrolls.
    const widest = useMemo(() => {
        let plain = Math.max(total ?? 0, endPosition) + (group === undefined ? blanks + ui.appended : 0);
        let chevron = 0;
        if (group !== undefined) {
            for (const g of rows) {
                if (isLooseRow(g)) continue;
                plain = Math.max(plain, g.lines.length + (blanks > 0 ? 1 : 0));
                g.lines.forEach((line, j) => { if (line.subRows.length > 0) chevron = Math.max(chevron, j + 1); });
            }
        }
        if (ui.sugg !== null && ui.sugg.rows.length > 0) for (const it of body) if (it.kind === "proposal") plain = Math.max(plain, it.number);
        return { plain, chevron };
    }, [total, endPosition, group, blanks, ui.appended, ui.sugg, rows, body]);
    // The number column's width: those numbers as the rows draw them (the
    // probe in the card), measured before the first paint, and again whenever
    // the probe changes size — its face landing, or the grid drawn again after
    // it was hidden.
    const [numberProbe, setNumberProbe] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        if (numberProbe === null) return undefined;
        const measure = () => {
            let px = NUMBER_PX;
            for (const n of numberProbe.children) px = Math.max(px, Math.ceil(n.getBoundingClientRect().width));
            setNumberPx(px);
        };
        measure();
        if (typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(numberProbe);
        return () => observer.disconnect();
    }, [numberProbe, widest.plain, widest.chevron, setNumberPx]);
    // What sticks under the header is read off the MOUNTED rows
    // (`stickyRows`): the band of the group whose lines scroll under it, and
    // under the band the open line whose sub rows scroll under that. The
    // line's copy follows the scroll through its own style, so a frame never
    // re-renders the sheet for it — only a change of line does.
    const headerRef = useRef<HTMLDivElement | null>(null);
    const stickyLineRef = useRef<HTMLDivElement | null>(null);
    const stickyLineTop = useRef(0);
    const [stickyAt, setStickyAt] = useState<number | undefined>(undefined);
    const [stickyLineAt, setStickyLineAt] = useState<number | undefined>(undefined);
    useEffect(() => {
        const el = pinnedFrame;
        if (el === null || group === undefined) {
            setStickyAt(undefined);
            setStickyLineAt(undefined);
            return;
        }
        let frame = 0;
        const update = () => {
            frame = 0;
            const head = headerRef.current;
            if (head === null) return;
            const frameBox = head.getBoundingClientRect();
            const bandCopy = head.querySelector<HTMLElement>("[data-slot=stickyBand]");
            const found = stickyRows(body, mountedBoxes(el), frameBox.bottom, bandCopy !== null ? bandCopy.getBoundingClientRect().height : bandPx, rowPx);
            setStickyAt(found.band);
            setStickyLineAt(found.line?.index);
            if (found.line === undefined) return;
            stickyLineTop.current = found.line.top - frameBox.top;
            if (stickyLineRef.current !== null) stickyLineRef.current.style.top = `${stickyLineTop.current}px`;
        };
        const onScroll = () => { if (frame === 0) frame = requestAnimationFrame(update); };
        update();
        el.addEventListener("scroll", onScroll, { passive: true });
        // Rows that slid after a fold or an opening have landed: read them again.
        el.addEventListener("transitionend", onScroll);
        return () => {
            el.removeEventListener("scroll", onScroll);
            el.removeEventListener("transitionend", onScroll);
            if (frame !== 0) cancelAnimationFrame(frame);
        };
    }, [pinnedFrame, body, group, bandPx, rowPx]);
    // A line that has just begun to stick: its copy takes the top the scroll found for it before it paints.
    useLayoutEffect(() => {
        if (stickyLineRef.current !== null) stickyLineRef.current.style.top = `${stickyLineTop.current}px`;
    }, [stickyLineAt]);
    // The ring's cell in view after a keyboard move (#860). The frame brings
    // the ring's ROW in; what it cannot is the column — the rows scroll
    // sideways inside the card. The column's header cell says where the column
    // is: it is always mounted, and it shares the column's box. The gutter is
    // sticky, so the columns show right of it.
    useEffect(() => {
        if (revealSeq === 0) return;
        const view = viewportRef.current;
        if (view === null) return;
        const { col } = ringCellRef.current;
        const frame = view.frame;
        const head = headerRef.current?.querySelectorAll<HTMLElement>('[data-slot="headerCell"]')[col];
        if (head !== undefined) {
            const box = frame.getBoundingClientRect();
            const left = box.left + frame.clientLeft + (phoneFrame ? pinPx : gutterPx);
            const right = box.left + frame.clientLeft + frame.clientWidth;
            const cell = head.getBoundingClientRect();
            if (cell.left < left) frame.scrollLeft -= left - cell.left;
            else if (cell.right > right) frame.scrollLeft += Math.min(cell.right - right, cell.left - left);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a keyboard move is the trigger; the ring and the frame are read as they are then
    }, [revealSeq]);
    /**
     * Bring a sticking line out from under its copy: the rows
     * scroll until the line's own row sits just under the band, where the
     * copy was, so a press on the copy lands on the line in view (the ring,
     * the editor) and closing its sub rows leaves it where it stood. With
     * `closing`, the press closes the group's every line (⌥): the open sub
     * rows above this line are about to leave too, so the scroll takes them
     * off ahead of time.
     */
    const revealLine = useCallback((at: number, closing: boolean) => {
        const el = pinnedFrame;
        const head = headerRef.current;
        if (el === null || head === null) return;
        const boxes = mountedBoxes(el);
        // The line's top: its own row's, else worked back from the first row mounted after it.
        let top = boxes.get(at)?.top;
        if (top === undefined) {
            let k = at + 1;
            while (k < body.length && !boxes.has(k)) k++;
            const next = boxes.get(k);
            if (next === undefined) return;
            top = next.top;
            for (let j = at; j < k; j++) top -= sizeOf(j);
        }
        let leaving = 0;
        if (closing) for (let j = at - 1; j >= 0 && body[j]!.kind !== "group"; j--) if (body[j]!.kind === "subRow") leaving += boxes.get(j)?.height ?? sizeOf(j);
        const bandCopy = head.querySelector<HTMLElement>("[data-slot=stickyBand]");
        el.scrollTop += top - (head.getBoundingClientRect().bottom + (bandCopy !== null ? bandCopy.getBoundingClientRect().height : 0)) - leaving;
    }, [pinnedFrame, body, sizeOf]);

    // A gesture that folds or opens (a chevron, Space, ⇧Space,
    // ⌥, fold-all) moves rows. The virtual rows are keyed by identity, so a row
    // that moves keeps its element: for a moment after such a gesture the rows
    // slide to their new places (`data-moving` on the root) and the rows it
    // brings into view — a line's sub rows, an unfolded group's lines — drop in
    // one after another. A gesture is a change of the folds on the same view:
    // the lens, a view switch and a scroll move nothing.
    const itemKey = useCallback((i: number): string => keyOfItem(body[i], i), [body]);
    const openKeys = useMemo(() => openKeysOf(body), [body]);
    /** What the last committed render had open, under which folds and view. */
    const seenRef = useRef<{ folds: ReadonlyMap<string, boolean>; tab: string | null; open: ReadonlySet<string> } | undefined>(undefined);
    const seen = seenRef.current;
    const gesture = seen !== undefined && seen.folds !== folds && seen.tab === ui.tabs.active;
    /** What the gesture opened: the rows under these keys arrive. */
    const arriving = useMemo(() => (gesture && seen !== undefined ? new Set([...openKeys].filter((k) => !seen.open.has(k))) : NOTHING), [gesture, seen, openKeys]);
    const [movingSince, setMovingSince] = useState(0);
    useLayoutEffect(() => {
        const was = seenRef.current;
        seenRef.current = { folds, tab: ui.tabs.active, open: openKeys };
        if (was !== undefined && was.folds !== folds && was.tab === ui.tabs.active) setMovingSince(performance.now());
    }, [folds, ui.tabs.active, openKeys]);
    useEffect(() => {
        if (movingSince === 0) return;
        const t = setTimeout(() => setMovingSince(0), MOVE_MS);
        return () => clearTimeout(t);
    }, [movingSince]);
    const moving = gesture || movingSince !== 0;
    return {
        anchorable, arriving, editorAt, headerRef, itemKey, moving, rangeCols, rect, reportRange, revealLine,
        setNumberProbe, sizeOf, stickyAt, stickyLineAt, stickyLineRef, widest,
    };
}

/** What {@link useSheetScroll} gives the parts after it. */
export type SheetScroll = ReturnType<typeof useSheetScroll>;
