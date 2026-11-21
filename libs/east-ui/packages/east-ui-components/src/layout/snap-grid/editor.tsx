/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SnapGrid's editing canvas (#990) — the builder's page of tiles. Every
 * gesture is a draft of the shared editing session, which the history item at
 * the end of the canvas's toolbar undoes, redoes, discards and applies.
 *
 * Moves and card drops go through the shared drag layer — pointer and
 * keyboard pickup, the ⊘ veto, edge scrolling and the announcements: each row
 * is a continuous cell that names where a drag rests (beside a tile, or a new
 * row above or below it), a gap cell sits above each row, and the end zone
 * under the last. The three resize handles are the canvas's own, snapping
 * live: a resize lands nowhere. A resize is its pointer's (`followPointer`,
 * `../../pointer/`): that pointer's moves alone snap it, and it ends once —
 * landed by that pointer's release, or let go of, landing nothing, as the
 * browser takes the pointer back, as a mouse moves with its button no longer
 * held, as the window loses the page, and at Esc. The selection is the host's
 * bound `ui` state, or the canvas's own.
 *
 * The canvas is the builder's frame (#995), laid out by the shared
 * `BuilderFrame` (#1125): one toolbar across its width — the host's start
 * items, the grid chip and the time the source last confirmed an Apply; then
 * the width readout, the zoom, the history item, the design widths and the
 * host's end items — and under it the panes beside the canvas column, where
 * the selection bar names the selected tile over the grid panel. A pane is a
 * host renderer's (a pane the frame draws, or an element of its own), or the
 * value's East pane, placed as it is. The design width and the zoom are the
 * host's bound `view`, or the canvas's own.
 *
 * A row short of room folds on one ladder (#1229): the grid chip, the readout
 * and the saved time go, the widths fold to their icons, then the zoom folds
 * into one View chip as the widths hide — its menu holding Zoom out, the zoom
 * and Zoom in, then the widths as a choice of one — and last of the canvas's
 * own steps the value's start items go; a host's own items fold from
 * `SNAP_GRID_HOST_RANK`, and the history item last.
 *
 * A pane beside the canvas asks it for a change through the bound `ui`
 * (#996): a request for a tile's span, row, height or alignment — a field of
 * its entry, a copy of it, or an entry to add after it (#1672, #1673) — is
 * taken as one gesture, by the rules the handles and drags keep, and written
 * back `none`. A screen asks it for an Apply through the bound `apply` (#998): the
 * canvas applies its drafts as its history item does, and answers under the
 * id asked once they land or cannot. The history shortcuts work anywhere in
 * the frame, the panes too.
 *
 * A host's own sessions edited beside the tiles — a page's starting filters
 * (#1673) — join the canvas's under one history ({@link SnapGridJoined}): the
 * canvas's gestures and the host's are its steps, in the order they were made,
 * and the history item, its keys and a screen's Apply act on it; each session
 * keeps its banners, named. What edits them the host draws over the grid
 * (`head`), a band between the selection bar and the grid, outside the
 * canvas's zoom and keys. What the host says over the canvas — a mode it is
 * in, linking two tiles say — stands in the frame's banners slot after its
 * sessions' (`banners`), as every builder's banners do.
 *
 * In a frame of 560 px or narrower the canvas draws its phone form by itself
 * ({@link SnapGridPhoneCanvas}, `Studio Mobile Spec.md`): one column of tiles,
 * pick then place, the same session and gestures. Its toolbar is then the host's
 * items and the history; a host adds the page's head and Add a component through
 * `phone`, and its band over the grid stands under the page's head.
 *
 * At a design width under a phone's 480 px — a host's Mobile — the canvas lays
 * the page out as a phone shows it, as the page itself does there: every tile
 * the full width, in reading order, its height given way to what it holds, and
 * no column ruler. A tile is selected and edited there — its pane, its bar,
 * up and down through the column — but its span and its place are the wider
 * layout's, which a phone only stacks: nothing drags or resizes, and a card
 * lands only between rows, a row of its own.
 *
 * Its parts are drawn apart: a tile (`./editor-tile.tsx`), the drop cells
 * (`./editor-cells.tsx`) and the toolbar (`./editor-toolbar.tsx`).
 *
 * @packageDocumentation
 */

import {
    Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState,
    type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { Box, useSlotRecipe, VisuallyHidden } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faCheck } from "@fortawesome/free-solid-svg-icons";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SnapGrid } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import type { ToolbarItem } from "../../toolbar/index.js";
import { BuilderFrame, type BuilderFramePane } from "../builder-frame/index.js";
import { NARROW_FRAME } from "../builder-frame/place.js";
import { useContainerWidth } from "../../contracts/adaptive.js";
import { SnapGridPhoneCanvas, type SnapGridPhoneOptions, type SnapGridPlacing } from "./phone.js";
import { SnapGridPhoneIssues } from "./phone-issues.js";
import { historyToolbarItem } from "../../editing/history-item.js";
import { SessionBanners } from "../../editing/banners.js";
import type { HistoryAction } from "../../editing/HistoryBar.js";
import type { EditHistory } from "../../editing/history.js";
import { historyShortcut } from "../../editing/shortcuts.js";
import type { EditIssue, EditSession } from "../../editing/session.js";
import { sessionErrorText } from "../../editing/messages.js";
import { useDragLayerOptional, useDragTarget, type DragEventValue, type DropVeto } from "../../dnd/drag-layer";
import { useIRCanDrop, type CanDropFn } from "../../dnd/ir-can-drop";
import { followPointer } from "../../pointer/follow-pointer.js";
import { useSnapGridEditing, type SnapGridJoined } from "./use-snap-grid-editing.js";
import { useSnapGridWords, type SnapGridWords } from "./messages.js";
import {
    MAX_HEIGHT, MAX_TILES, SNAP_GRID_COLUMNS, SNAP_GRID_STACKED_BELOW, heightAt, heldSpan, landingOf, neighbourOf, rowsOf, spanAt, startColumn,
    type SnapGridDrop,
} from "./model.js";
import type { SnapGridEditorCell, SnapGridEditorValue } from "./index.js";
import { contentHeight } from "./natural.js";
import { SnapGridGapCell, SnapGridRowCell, boxOf, clientGap, tilesIn, type Hover, type Resting, type SnapGridStyles } from "./editor-cells.js";
import { SnapGridTileBox, type ResizeKind, type ResizePreview, type SnapGridTileAction } from "./editor-tile.js";
import { useCanvasToolbar, type ViewState } from "./editor-toolbar.js";

// A tile's and a design width's icons are Font Awesome names from the data;
// register the free-solid set so they resolve by name (idempotent).
library.add(fas);

/** An Apply a host asks for, and the canvas's answer — the bound `apply`'s value. */
type ApplyState = ValueTypeOf<typeof SnapGrid.Types.ApplyState>;

/**
 * Why the drafts cannot land, in the canvas's words: the first issue the
 * session — or the history over it and its host's — holds, else its error,
 * else its status line: the stale source's, or the canvas's own when nothing
 * else says.
 */
function refusalOf<W>(session: EditSession<W> | EditHistory<W>, words: SnapGridWords): string {
    const readiness = session.readiness;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    if (issues.length > 0) return issues[0]!.message;
    if (session.error !== undefined) return sessionErrorText(session.error, words);
    if (session.stale) return words.m.historyStatus({ status: "stale" });
    if (session.carrying) return words.m.historyStatus({ status: "carrying" });
    if (session.unsettled > 0) return words.m.applySettleFirst({ n: session.unsettled, count: words.number(session.unsettled) });
    return session.status === "idle" ? words.m.applyRefused() : words.m.historyStatus({ status: session.status });
}

/** A design width in whole px, when it is one — what the readout prints. */
function pxOf(width: string | undefined): number | undefined {
    const px = width === undefined ? undefined : /^(\d+(?:\.\d+)?)px$/.exec(width);
    return px ? Number(px[1]) : undefined;
}

// ============================================================================
// The canvas
// ============================================================================

/** Props of {@link SnapGridEditor}. */
export interface SnapGridEditorProps {
    /** The canvas's value, its `editing` declared — a SnapGrid's, or one a host renderer builds. */
    value: SnapGridEditorValue;
    /** Storage key prefix for the session and the cells' content state. */
    storageKey: string;
    /** Items a host adds to the canvas's toolbar, before the history item. */
    toolbarItems?: ReadonlyArray<ToolbarItem | false | null | undefined> | undefined;
    /**
     * The host's own toolbar items, as React: `start` after the value's start
     * items, leading the row; `end` after the value's end items, closing it.
     */
    toolbar?: {
        start?: ReadonlyArray<ToolbarItem | false | null | undefined> | undefined;
        end?: ReadonlyArray<ToolbarItem | false | null | undefined> | undefined;
    } | undefined;
    /**
     * The panes beside the canvas, as React — in place of the value's: each a
     * pane the frame draws, or an element placed as it is ({@link BuilderFramePane}).
     */
    panes?: { start?: BuilderFramePane | undefined; end?: BuilderFramePane | undefined } | undefined;
    /** Draws a tile's content, as React — in place of its East content. */
    renderContent?: ((cell: SnapGridEditorCell) => ReactNode) | undefined;
    /** What a host says of the page on a phone, and does there ({@link SnapGridPhoneOptions}). The canvas's phone form needs none. */
    phone?: SnapGridPhoneOptions | undefined;
    /**
     * Told when the selected tile's Edit is pressed, with its key: the host
     * shows what edits what the tile shows (#1672). Omitted, the tile draws no
     * Edit.
     */
    onEdit?: ((key: string) => void) | undefined;
    /**
     * Over the grid: what the host draws there — what edits its own sessions,
     * a page's starting filters (#1673) — a band between the selection bar and
     * the grid, and on a phone under the page's head.
     */
    head?: ReactNode | undefined;
    /**
     * The host's own sessions under one history with the canvas's (#1673);
     * omitted, the canvas's session is its history.
     */
    joined?: SnapGridJoined | undefined;
    /**
     * What the host says over the canvas — a mode it is in, linking two tiles
     * say (#1673) — in the frame's banners slot under the toolbar, after its
     * sessions' banners; on a phone, in the footer with them.
     */
    banners?: ReactNode | undefined;
    /**
     * What the host does to the selected tile, by its key: on the tile's frame
     * beside Edit, Duplicate and Remove — a builder's actions there, never in a
     * menu of what the tile shows (#1673). Omitted, the tile draws its own.
     */
    tileActions?: ((key: string) => readonly SnapGridTileAction[]) | undefined;
}

/**
 * The SnapGrid's editing canvas — rendered for a SnapGrid whose `editing` is
 * declared (see the module docs).
 *
 * @param props - The value, its storage key and any host toolbar items
 * @returns The canvas
 */
export const SnapGridEditor = memo(function SnapGridEditor({ value, storageKey, toolbarItems, toolbar, panes, renderContent, phone: phoneOptions, onEdit, head, joined, banners: hostBanners, tileActions }: SnapGridEditorProps) {
    const words = useSnapGridWords();
    const m = words.m;
    const recipe = useSlotRecipe({ key: "snapGrid" });
    const phoneStyles = useSlotStyles("snapGridPhone");
    const surfaceTag = getSomeorUndefined(value.surface)?.type ?? "card";
    const styles = useMemo(() => recipe({ variant: "tiles", surface: surfaceTag }) as SnapGridStyles, [recipe, surfaceTag]);
    const editing = useSnapGridEditing(value, storageKey, joined);
    const {
        session, subject, key: canvasKey, available, tiles, cells, marks, creates, heights, move, rowTo, align, add, resize, height, remove, field, duplicate, insert,
        action: sessionAction,
    } = editing;

    // ── A phone's frame: the canvas's phone form, by itself at 560px and narrower ──
    // Hidden, as under a preview, it stays what it was: its tiles' state is kept.
    const widthRef = useRef<HTMLDivElement | null>(null);
    const frameWidth = useContainerWidth(widthRef);
    const wasPhone = useRef(false);
    const phone = frameWidth > 0 ? frameWidth <= NARROW_FRAME : wasPhone.current;
    wasPhone.current = phone;
    const [ownPlacing, setOwnPlacing] = useState<SnapGridPlacing | undefined>(undefined);
    const placing = phoneOptions?.onPlacing !== undefined ? phoneOptions.placing : ownPlacing;
    const onPlacing = phoneOptions?.onPlacing ?? setOwnPlacing;

    // ── When the source last confirmed an Apply ──────────────────────────
    // An Apply is confirmed when the session — or the history over it and its
    // host's — leaves `reconciling` for `idle`, heard from it itself, since
    // both can pass within one render; a Discard clears the time, as it clears
    // the drafts.
    const [savedAt, setSavedAt] = useState<Date | undefined>(undefined);
    // How many a Save carried: what a phone's band says once it lands (ST36).
    const carried = useRef(0);
    useEffect(() => {
        let was = subject.status;
        return subject.subscribe(() => {
            if (was !== "applying" && subject.status === "applying") carried.current = subject.pending;
            if (was === "reconciling" && subject.status === "idle") setSavedAt(new Date());
            was = subject.status;
        });
    }, [subject]);
    const action = useCallback((a: HistoryAction) => {
        if (a === "discard") setSavedAt(undefined);
        sessionAction(a);
    }, [sessionAction]);
    const rows = useMemo(() => rowsOf(tiles), [tiles]);
    const cellOf = useMemo(() => new Map(cells.map((c) => [c.key, c] as const)), [cells]);
    // What the drag layer's callbacks read — always this render's.
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const tilesRef = useRef(tiles);
    tilesRef.current = tiles;

    // ── The selection — the host's bound state, or the canvas's own ─────
    const bound = value.ui.type === "some" ? value.ui.value : undefined;
    const readUi = useCallback(() => (bound === undefined ? undefined : bound.read()), [bound]);
    const { result: boundRead } = useTrackedEvaluation(readUi);
    const [ownSelected, setOwnSelected] = useState<string | null>(null);
    const boundUi = boundRead.ok ? boundRead.value : undefined;
    const held = bound === undefined ? ownSelected
        : boundUi !== undefined && boundUi.selected.type === "some" ? boundUi.selected.value : null;
    const selected = held !== null && cellOf.has(held) ? held : null;
    // A change a pane asks for (#996) — taken below, once the tiles are known.
    const request = boundUi !== undefined && boundUi.request.type === "some" ? boundUi.request.value : undefined;
    const select = useCallback((key: string | null) => {
        if (bound === undefined) {
            setOwnSelected(key);
            return;
        }
        try {
            bound.write({ selected: key === null ? none : some(key), request: none });
        } catch (err) {
            console.error("[SnapGrid] ui state write failed:", err);
        }
    }, [bound]);

    // ── What the live region says ────────────────────────────────────────
    const [said, setSaid] = useState("");
    // The same words twice are said twice: a trailing space makes them news.
    const announce = useCallback((text: string) => setSaid((prev) => (prev === text ? `${text} ` : text)), []);

    // ── The tiles' elements, for focus ───────────────────────────────────
    const tileEls = useRef(new Map<string, HTMLElement>());
    const register = useCallback((key: string, el: HTMLElement | null) => {
        if (el !== null) tileEls.current.set(key, el);
        else tileEls.current.delete(key);
    }, []);
    const focusTile = useCallback((key: string) => tileEls.current.get(key)?.focus(), []);

    // ── The drag surface ─────────────────────────────────────────────────
    const layer = useDragLayerOptional();
    const dragging = layer?.active ?? false;
    const ownId = useId();
    const surface = getSomeorUndefined(value.id) ?? `snap-grid${ownId}`;
    const canDropFn = useMemo(() => getSomeorUndefined(value.canDrop) as CanDropFn | undefined, [value.canDrop]);
    const irVeto = useIRCanDrop(canDropFn);
    // Whether the canvas stands stacked, as a phone shows the page: this render's, for the drag layer's callbacks.
    const stackedRef = useRef(false);
    // A row holding its most tiles takes no other: the ⊘ stage. Stacked, a row's columns are the wider layout's, and a
    // drop lands only between rows. Then the host's word.
    const veto = useCallback<DropVeto>((event) => {
        const into = event.type === "add" ? event.value.into : event.type === "move" ? event.value.to : undefined;
        if (stackedRef.current && into !== undefined && into.row !== "") return false;
        if (into !== undefined && into.row !== "") {
            const moving = event.type === "move" && event.value.from.event.type === "some" ? event.value.from.event.value : undefined;
            const row = rowsRef.current.find((r) => r.key === into.row);
            if (row !== undefined && !row.tiles.some((t) => t.key === moving) && row.tiles.length >= MAX_TILES) return false;
        }
        return irVeto?.(event) ?? true;
    }, [irVeto]);
    const resting = useRef<Resting | undefined>(undefined);
    /** The drop a coordinate names: a gap by its index, a row by where the drag last rested in it, or its pointed column. */
    const dropOf = useCallback((at: { row: string; slot: string }): SnapGridDrop | undefined => {
        if (at.row === "") {
            const gap = Number(at.slot);
            return Number.isInteger(gap) && gap >= 0 ? { kind: "gap", at: gap } : undefined;
        }
        const last = resting.current;
        if (last !== undefined && last.row === at.row && last.slot === at.slot) return last.drop;
        const r = rowsRef.current.findIndex((row) => row.key === at.row);
        const column = Number(at.slot);
        if (r < 0 || !Number.isFinite(column)) return undefined;
        // Beside the tile whose middle the pointed column has not passed.
        let from = 0;
        const row = rowsRef.current[r]!;
        const pos = row.tiles.findIndex((t) => {
            const past = column - 0.5 < from + t.span / 2;
            from += t.span;
            return past;
        });
        return { kind: "join", row: r, pos: pos < 0 ? row.tiles.length : pos };
    }, []);
    const onDrag = useCallback((event: DragEventValue): boolean => {
        if (event.type === "add") {
            const drop = dropOf(event.value.into);
            return drop !== undefined && add({ library: event.value.from.library, key: event.value.from.key }, drop) !== undefined;
        }
        if (event.type === "move") {
            const key = event.value.from.event.type === "some" ? event.value.from.event.value : undefined;
            const drop = dropOf(event.value.to);
            return key !== undefined && drop !== undefined && move(key, drop);
        }
        return false;
    }, [dropOf, add, move]);
    const target = useMemo(() => (available ? {
        id: surface,
        sources: [...value.sources],
        kinds: { add: creates, move: true },
        onDrag,
    } : null), [available, surface, value.sources, creates, onDrag]);
    useDragTarget(target);

    const rowsEl = useRef<HTMLDivElement | null>(null);
    /** Mark what a drop where the drag rests would do: the line beside a tile, the line between rows, the end zone — or nothing, beside itself. */
    const hover = useCallback<Hover>((el, drop, payload) => {
        const root = rowsEl.current;
        if (root === null || el === null) return;
        for (const t of root.querySelectorAll("[data-snap-grid-insert]")) t.removeAttribute("data-snap-grid-insert");
        const moving = payload.kind === "event" ? payload.from.event : undefined;
        const landing = landingOf(rowsRef.current, drop, moving);
        if (landing.kind !== "place") {
            el.setAttribute("data-snap-grid-drop", "none");
            return;
        }
        if (drop.kind === "join") {
            el.setAttribute("data-snap-grid-drop", "join");
            const beside = tilesIn(el);
            if (drop.pos < beside.length) beside[drop.pos]!.setAttribute("data-snap-grid-insert", "before");
            else beside[beside.length - 1]?.setAttribute("data-snap-grid-insert", "after");
            return;
        }
        if (!el.hasAttribute("data-snap-grid-row")) {
            el.removeAttribute("data-snap-grid-drop");
            return;
        }
        // A row's top band is the gap above it, its bottom band the gap below — the end zone's, under the last.
        const index = Number(el.getAttribute("data-snap-grid-row-index"));
        el.setAttribute("data-snap-grid-drop", drop.at === index ? "before" : drop.at >= rowsRef.current.length ? "end" : "after");
    }, []);
    // A drag that ended leaves no mark behind.
    useEffect(() => {
        const root = rowsEl.current;
        if (dragging || root === null) return;
        for (const t of root.querySelectorAll("[data-snap-grid-insert]")) t.removeAttribute("data-snap-grid-insert");
        for (const t of root.querySelectorAll("[data-snap-grid-drop]")) t.removeAttribute("data-snap-grid-drop");
    }, [dragging]);

    // ── The resize handles — the canvas's own, each resize its pointer's ──
    const [preview, setPreview] = useState<ResizePreview | undefined>(undefined);
    // What lets go of the resize in flight, landing nothing; `undefined` while none is. One at a time: a new press lets
    // go of one whose end was never heard, as Esc does, and as the canvas going does.
    const dropResize = useRef<(() => void) | undefined>(undefined);
    useEffect(() => () => dropResize.current?.(), []);
    const onResizeStart = useCallback((e: ReactPointerEvent, key: string, kind: ResizeKind) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const handle = e.currentTarget as HTMLElement;
        const tileEl = handle.closest<HTMLElement>("[data-snap-grid-tile]");
        const rowEl = tileEl?.parentElement ?? null;
        const frameEl = tileEl?.firstElementChild instanceof HTMLElement ? tileEl.firstElementChild : null;
        const tile = tilesRef.current.find((t) => t.key === key);
        if (tileEl === null || rowEl === null || frameEl === null || tile === undefined) return;
        const rowBox = boxOf(rowEl);
        const gap = clientGap(rowEl, rowBox);
        const left = tileEl.getBoundingClientRect().left;
        // A height is in layout px: the pointer's travel through the zoom.
        const scaleY = frameEl.offsetHeight > 0 ? frameEl.getBoundingClientRect().height / frameEl.offsetHeight : 1;
        const h0 = frameEl.offsetHeight;
        // Its content's own height — where a height drag stops, and returns it to its content's. Read with its height let
        // go: the height it stands at would hold every shorter one off.
        const natural = contentHeight(frameEl);
        const siblings = tilesIn(rowEl).filter((el) => el !== tileEl)
            .map((el) => (el.firstElementChild instanceof HTMLElement ? el.firstElementChild.offsetHeight : 0));
        const y0 = e.clientY;
        let last: ResizePreview | undefined;
        const at = (ev: PointerEvent): ResizePreview => {
            const next: ResizePreview = { key, row: tile.row };
            if (kind !== "height") next.span = heldSpan(tilesRef.current, key, spanAt(ev.clientX, left, rowBox.width, gap));
            if (kind !== "span") {
                const rest = heightAt(h0 + (ev.clientY - y0) / scaleY, natural, tile.minHeight, siblings);
                next.height = rest.height;
                next.guide = rest.guide;
            }
            return next;
        };
        const onMove = (ev: PointerEvent) => {
            const next = at(ev);
            if (last !== undefined && next.span === last.span && next.height === last.height && next.guide === last.guide) return;
            last = next;
            setPreview(next);
        };
        const finish = (commit: boolean) => {
            dropResize.current = undefined;
            setPreview(undefined);
            if (!commit || last === undefined) return;
            if (kind === "span") {
                if (last.span !== undefined) resize(key, last.span);
            } else {
                height(key, last.height ?? null, kind === "both" ? last.span : undefined);
            }
        };
        dropResize.current?.();
        // The handle holds the pointer, so its cursor stands wherever the pointer goes. The resize follows the pointer at
        // the window (`followPointer`): its end is heard though the handle goes under it — the selection let go, the tile
        // drawn again — and no other pointer's move or lift over the handle is the resize's.
        handle.setPointerCapture?.(e.pointerId);
        const stop = followPointer(e, { move: onMove, up: () => finish(true), cancel: () => finish(false) });
        dropResize.current = () => {
            stop();
            finish(false);
        };
    }, [resize, height]);

    // ── A change a pane asks for (#996, #1672) — one gesture, then written back ─
    useEffect(() => {
        if (request === undefined || bound === undefined) return;
        const tile = tilesRef.current.find((t) => t.key === request.key);
        const change = request.change;
        // A copy, and an entry added, is selected in its tile's place; any other change leaves the selection as it is.
        let selecting = bound.read().selected;
        if (tile !== undefined) {
            switch (change.type) {
                case "span":
                    resize(tile.key, Number(change.value));
                    break;
                case "row":
                    rowTo(tile.key, Number(change.value));
                    break;
                case "height": {
                    // As a height drag: a least height floors it, else its content's
                    // height, where it returns to auto; never past the most.
                    const asked = change.value.type === "some" ? Number(change.value.value) : null;
                    const frame = tileEls.current.get(tile.key)?.firstElementChild;
                    const natural = frame instanceof HTMLElement && frame.offsetHeight > 0 ? contentHeight(frame) : undefined;
                    const kept = asked === null ? null
                        : tile.minHeight !== undefined ? Math.max(tile.minHeight, Math.min(MAX_HEIGHT, asked))
                            : natural !== undefined && asked <= natural ? null
                                : Math.min(MAX_HEIGHT, asked);
                    height(tile.key, kept);
                    break;
                }
                case "align":
                    align(tile.key, change.value.type);
                    break;
                case "field":
                    field(tile.key, change.value.name, change.value.value);
                    break;
                case "duplicate": {
                    const copy = duplicate(tile.key);
                    if (copy !== undefined) {
                        selecting = some(copy);
                        announce(m.announceDuplicated({ label: tile.label }));
                    }
                    break;
                }
                case "add": {
                    const added = insert(tile.key, change.value);
                    if (added !== undefined) {
                        selecting = some(added.key);
                        announce(m.announceAdded({ label: added.label }));
                    }
                    break;
                }
            }
        }
        try {
            bound.write({ selected: selecting, request: none });
        } catch (err) {
            console.error("[SnapGrid] ui state write failed:", err);
        }
    }, [request, bound, resize, rowTo, height, align, field, duplicate, insert, announce, m]);

    // ── An Apply a screen asks for (#998) — the drafts applied, then answered ─
    const applyBind = value.apply.type === "some" ? value.apply.value : undefined;
    const readApply = useCallback(() => (applyBind === undefined ? undefined : applyBind.read()), [applyBind]);
    const { result: applyRead } = useTrackedEvaluation(readApply);
    const asked = applyRead.ok && applyRead.value !== undefined && applyRead.value.type === "asked" ? applyRead.value.value : undefined;
    useEffect(() => {
        if (asked === undefined || applyBind === undefined) return;
        let live = true;
        let started = false;
        // Whether the Apply started here has returned. Until it has, a change
        // of the subject is one of the Apply's own steps — a history accepts
        // every session's drafts, telling its readers, before any session
        // sends — never a refusal.
        let sent = false;
        let answered = false;
        const answer = (state: ApplyState) => {
            answered = true;
            try {
                applyBind.write(state);
            } catch (err) {
                console.error("[SnapGrid] apply state write failed:", err);
            }
        };
        // At every change of the session — or of the history over it and its
        // host's: an Apply running is waited out; with no draft left, the
        // drafts landed; once, the drafts are applied as the history item
        // applies them — a request of unknown outcome retried; otherwise they
        // cannot land, and the canvas says why: one that could not start, or
        // the one started here, once it has returned.
        const step = () => {
            if (!live || answered || subject.status === "applying" || subject.status === "reconciling") return;
            if (subject.pending === 0) {
                answer(variant("applied", asked));
            } else if (!started && (subject.status === "unknown" || subject.canApply)) {
                started = true;
                void subject.apply().finally(() => {
                    sent = true;
                    step();
                });
            } else if (!started || sent) {
                answer(variant("refused", { id: asked, reason: refusalOf(subject, words) }));
            }
        };
        const unsubscribe = subject.subscribe(step);
        step();
        return () => {
            live = false;
            unsubscribe();
        };
    }, [asked, applyBind, subject, words]);

    const onRemove = useCallback((key: string) => {
        const label = tilesRef.current.find((t) => t.key === key)?.label ?? key;
        if (!remove(key)) return;
        announce(m.announceRemoved({ label }));
        select(null);
    }, [remove, announce, m, select]);
    // A copy after it, selected (#1672).
    const onDuplicate = useCallback((key: string) => {
        const label = tilesRef.current.find((t) => t.key === key)?.label ?? key;
        const copy = duplicate(key);
        if (copy === undefined) return;
        announce(m.announceDuplicated({ label }));
        select(copy);
    }, [duplicate, announce, m, select]);

    // ── The keyboard ─────────────────────────────────────────────────────
    // The history shortcuts, anywhere in the frame — a pane's controls too;
    // a key typed into a field, or one a pane took, stays its own.
    const onFrameKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.defaultPrevented || dragging) return;
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
        const historyKey = historyShortcut(e);
        if (historyKey === undefined) return;
        e.preventDefault();
        action(historyKey);
    };
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        // A drag carried by the keyboard takes the keys while it lasts.
        if (e.defaultPrevented || dragging) return;
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
        const tileEl = t.closest<HTMLElement>("[data-snap-grid-tile]");
        // A key pressed in a tile's content is the content's.
        if (tileEl !== null && tileEl !== t) return;
        const current = selected ?? tileEl?.getAttribute("data-snap-grid-tile") ?? undefined;
        const tile = current !== undefined ? tiles.find((x) => x.key === current) : undefined;
        switch (e.key) {
            case "Escape":
                // A resize in flight is let go of first, landing nothing: the selection stands.
                if (dropResize.current !== undefined) {
                    e.preventDefault();
                    dropResize.current();
                    return;
                }
                if (selected === null) return;
                e.preventDefault();
                select(null);
                announce(m.announceCleared());
                return;
            case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": {
                const arrow = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down";
                const next = tile === undefined ? tiles[0]?.key : neighbourOf(rows, tile.key, arrow, stacked);
                const to = next !== undefined ? tiles.find((x) => x.key === next) : undefined;
                if (to === undefined) return;
                e.preventDefault();
                select(to.key);
                focusTile(to.key);
                announce(m.announceSelected({ label: to.label }));
                return;
            }
            case "[": case "]": {
                // Stacked, its span is the wider layout's: the keys leave it.
                if (tile === undefined || stacked) return;
                e.preventDefault();
                const span = heldSpan(tiles, tile.key, tile.span + (e.key === "]" ? 1 : -1));
                if (resize(tile.key, span)) announce(m.announceSpan({ label: tile.label, span: words.number(span) }));
                return;
            }
            case "Delete": case "Backspace":
                if (tile === undefined) return;
                e.preventDefault();
                onRemove(tile.key);
                return;
            default:
                return;
        }
    };

    // A click on the canvas itself clears the selection — never the click a drag ends with.
    const downAt = useRef<{ x: number; y: number } | null>(null);
    const onPointerDown = (e: ReactPointerEvent) => { downAt.current = { x: e.clientX, y: e.clientY }; };
    const onClick = (e: ReactMouseEvent) => {
        if ((e.target as HTMLElement).closest("[data-snap-grid-tile]") !== null) return;
        const d = downAt.current;
        if (d !== null && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) return;
        if (selected !== null) select(null);
    };

    const onIssue = useCallback((issue: EditIssue) => {
        const tile = tilesRef.current.find((t) => t.id === issue.entry);
        if (tile === undefined) return;
        select(tile.key);
        focusTile(tile.key);
    }, [select, focusTile]);
    // A tile as the page shows it, in the frame's banners and its conflicts' cards: its label — `Breakdown bars` — else its id.
    const tileWhere = useCallback((issue: EditIssue) => tilesRef.current.find((t) => t.id === issue.entry)?.label ?? issue.entry, []);
    // An issue of the host's own session in the host's words (#1673); one of the canvas's by its tile.
    const where = useCallback((issue: EditIssue) => {
        const of = joined?.history.sourceOf(issue);
        const held = of === undefined || of === canvasKey ? undefined : joined?.sessions.find((s) => s.key === of);
        return held === undefined ? tileWhere(issue) : held.where?.(issue) ?? issue.entry;
    }, [joined, canvasKey, tileWhere]);
    // On a phone an inspector pane the frame draws takes an Issues tab, which the second row's Issues opens (ST7, D9).
    const [phoneTab, setPhoneTab] = useState<string | undefined>(undefined);
    const hostEnd = panes?.end;
    const issuesDock = phone && hostEnd !== undefined && !("element" in hostEnd) ? hostEnd : undefined;
    const openIssues = () => { setPhoneTab("issues"); issuesDock?.onCollapsedChange?.(false); };
    const history = historyToolbarItem({ session: subject, words, editing: false, onAction: action, onIssue, where, onOpenIssues: issuesDock === undefined ? undefined : openIssues });

    // ── The ruler: the selected tile's columns ───────────────────────────
    const guides = value.guides;
    const on = useMemo(() => {
        if (selected === null) return undefined;
        for (const row of rows) {
            const tile = row.tiles.find((t) => t.key === selected);
            if (tile === undefined) continue;
            const first = startColumn(row.tiles, selected);
            const span = preview?.key === selected && preview.span !== undefined ? preview.span : tile.span;
            return { first, last: first + span - 1 };
        }
        return undefined;
    }, [selected, rows, preview]);

    // ── The design width and the zoom — the host's bound view, or the canvas's own ──
    const viewBind = value.view.type === "some" ? value.view.value : undefined;
    const readView = useCallback(() => (viewBind === undefined ? undefined : viewBind.read()), [viewBind]);
    const { result: viewRead } = useTrackedEvaluation(readView);
    const [ownView, setOwnView] = useState<ViewState>({ width: none, zoom: none });
    const view: ViewState = viewBind === undefined ? ownView
        : viewRead.ok && viewRead.value !== undefined ? viewRead.value : { width: none, zoom: none };
    const setView = useCallback((next: ViewState) => {
        if (viewBind === undefined) {
            setOwnView(next);
            return;
        }
        try {
            viewBind.write(next);
        } catch (err) {
            console.error("[SnapGrid] view state write failed:", err);
        }
    }, [viewBind]);
    const width = parseCssSize(getSomeorUndefined(view.width) ?? getSomeorUndefined(value.width));
    const zoom = getSomeorUndefined(view.zoom) ?? getSomeorUndefined(value.zoom) ?? 1;
    // The design width is the most the grid lays out at: a narrower column
    // lays it out at the column's width, a wider one centres it at its own.
    const canvasStyle: CSSProperties = { ...(width !== undefined ? { maxWidth: width, marginInline: "auto" } : {}), ...(zoom !== 1 ? { zoom } : {}) };
    const widthPx = pxOf(width);
    // A design width under a phone's lays the page out as a phone shows it (see the module docs).
    const stacked = widthPx !== undefined && widthPx < SNAP_GRID_STACKED_BELOW;
    stackedRef.current = stacked;
    const tabStop = selected ?? tiles[0]?.key;

    // ── The toolbar: the host's start items, the canvas's own, the history item, the host's end items ──
    const items = useCanvasToolbar({ value, storageKey, words, styles, phone, view, setView, width, widthPx, zoom, savedAt, history, toolbar, toolbarItems });

    // ── The selection bar: the selected tile's icon, name and meta ──────
    const selectedCell = selected !== null ? cellOf.get(selected) : undefined;
    const selectedIcon = selectedCell !== undefined ? getSomeorUndefined(selectedCell.icon) : undefined;
    const selectedMeta = selectedCell !== undefined ? getSomeorUndefined(selectedCell.meta) : undefined;
    // A SnapGrid's own East panes draw themselves: each is placed as it is.
    const eastPaneStart = getSomeorUndefined(value.panes.start);
    const eastPaneEnd = getSomeorUndefined(value.panes.end);
    const paneStart: BuilderFramePane | undefined = panes?.start ?? (eastPaneStart !== undefined
        ? { element: <EastChakraComponent value={eastPaneStart} storageKey={`${storageKey}.pane.start`} /> } : undefined);
    const issuesCount = subject.unsettled + (subject.readiness.type === "ready" ? subject.issues.length : subject.readiness.value.length);
    const paneEnd: BuilderFramePane | undefined = issuesDock !== undefined ? {
        ...issuesDock,
        tab: phoneTab ?? issuesDock.tabs?.[0]?.key,
        onTabChange: setPhoneTab,
        tabs: [...(issuesDock.tabs ?? []), {
            key: "issues", label: m.phoneIssues(), count: words.number(issuesCount),
            body: <SnapGridPhoneIssues session={subject} rows={rows} words={words} where={where} />,
        }],
    } : panes?.end ?? (eastPaneEnd !== undefined
        ? { element: <EastChakraComponent value={eastPaneEnd} storageKey={`${storageKey}.pane.end`} /> } : undefined);

    // What the source holds of each tile's span: a span drafted away from it is a dirty value on a phone (ST16).
    const savedSpans = useMemo(() => {
        const spans = new Map<string, number>();
        for (const cell of value.cells) spans.set(cell.key, Number(cell.span));
        return spans;
    }, [value.cells]);
    const conflicted = useCallback((id: string) => session.conflicts.has(id), [session.conflicts]);
    const choose = issuesDock === undefined ? undefined : openIssues;
    // Each session's banners act on it alone (`EditHistory.actOn`), the host's named.
    const actOn = (key: string, a: HistoryAction) => {
        if (a === "discard") setSavedAt(undefined);
        joined?.history.actOn(key, a);
    };
    const sessionBanners = joined === undefined
        ? <SessionBanners session={session} words={words} onAction={action} where={tileWhere} onChoose={choose} />
        : (
            <>
                <SessionBanners session={session} words={words} onAction={(a) => actOn(canvasKey, a)} where={tileWhere} onChoose={choose} />
                {joined.sessions.map((held) => (
                    <SessionBanners key={held.key} session={held.session} words={words} name={held.name} where={held.where} onAction={(a) => actOn(held.key, a)} onChoose={choose} />
                ))}
            </>
        );
    // The host's own after its sessions'.
    const banners = <>{sessionBanners}{hostBanners}</>;

    return (
        <Box
            ref={widthRef}
            css={styles.editor}
            data-snap-grid=""
            data-snap-grid-editor=""
            data-surface={surfaceTag}
            height={parseCssSize(getSomeorUndefined(value.height))}
            maxHeight={parseCssSize(getSomeorUndefined(value.maxHeight))}
        >
            <BuilderFrame storageKey={`${storageKey}.frame`} toolbar={items} start={paneStart} end={paneEnd} onKeyDown={onFrameKeyDown} phonePanel phoneViews
                banners={phone ? undefined : banners}
                footer={phone ? <>{banners}{savedAt !== undefined && subject.pending === 0 && carried.current > 0 && (
                    <Box css={phoneStyles.saved} role="status" data-snap-grid-saved-band=""><Box as="span" css={phoneStyles.savedCheck} aria-hidden><FontAwesomeIcon icon={faCheck} /></Box>{m.phoneSaved({ n: carried.current, count: words.number(carried.current) })}</Box>
                )}</> : undefined}>
                {phone ? (
                    <SnapGridPhoneCanvas rows={rows} cellOf={cellOf} savedSpans={savedSpans} selected={selected} select={select} available={available} conflicted={conflicted}
                        words={words} storageKey={storageKey} renderContent={renderContent} register={register} options={phoneOptions} placing={placing} onPlacing={onPlacing}
                        move={move} add={add} resize={resize} remove={onRemove} head={head} />
                ) : (
                <Box css={styles.column} data-snap-grid-main="">
                    <Box css={styles.selectionBar} data-snap-grid-selection="">
                        {selectedCell !== undefined ? (
                            <>
                                {selectedIcon !== undefined && (
                                    <Box as="span" css={styles.selectionIcon}><FontAwesomeIcon icon={["fas", selectedIcon as IconName]} /></Box>
                                )}
                                <Box as="span" css={styles.selectionName}>{tiles.find((t) => t.key === selected)?.label ?? selected}</Box>
                                {selectedMeta !== undefined && <Box as="span" css={styles.selectionMeta}>{selectedMeta}</Box>}
                            </>
                        ) : (
                            <>
                                <Box as="span" css={styles.selectionEmpty}>{m.noSelection()}</Box>
                                <Box as="span" css={styles.selectionHint}>{m.noSelectionHint()}</Box>
                            </>
                        )}
                    </Box>
                    {/* What the host draws over the grid: outside the canvas's zoom, its keys and its clicks (#1673). */}
                    {head !== undefined && <Box css={styles.pageHead} data-snap-grid-head="">{head}</Box>}
                    <Box css={styles.viewport} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onClick={onClick}>
                        <Box css={styles.canvas} style={canvasStyle} role="group" aria-label={m.canvasLabel()} data-snap-grid-canvas=""
                            data-stacked={stacked ? "" : undefined}>
                            {guides && !stacked && (
                                <Box css={styles.ruler} aria-hidden data-snap-grid-ruler="">
                                    {Array.from({ length: SNAP_GRID_COLUMNS }, (_, i) => (
                                        <Box key={i} css={styles.rulerMark} data-on={on !== undefined && i + 1 >= on.first && i + 1 <= on.last ? "" : undefined}>
                                            {words.number(i + 1)}
                                        </Box>
                                    ))}
                                </Box>
                            )}
                            {guides && !stacked && (
                                <Box css={styles.bands} aria-hidden data-snap-grid-bands="">
                                    {Array.from({ length: SNAP_GRID_COLUMNS }, (_, i) => <Box key={i} css={styles.band} />)}
                                </Box>
                            )}
                            <Box ref={rowsEl} css={styles.rows} data-snap-grid-rows="">
                                {rows.map((row, i) => (
                                    <Fragment key={row.key}>
                                        <SnapGridGapCell index={i} first={i === 0} end={false} surface={surface} veto={veto} styles={styles} words={words} hover={hover} />
                                        <SnapGridRowCell row={row} index={i} surface={surface} veto={veto} styles={styles} words={words}
                                            resting={resting} hover={hover} guide={preview?.row === row.key ? preview.guide : undefined}>
                                            {row.tiles.map((tile) => (
                                                <SnapGridTileBox
                                                    key={tile.key}
                                                    tile={tile}
                                                    cell={cellOf.get(tile.key)!}
                                                    surface={surface}
                                                    start={startColumn(row.tiles, tile.key)}
                                                    rowNumber={i + 1}
                                                    styles={styles}
                                                    words={words}
                                                    storageKey={storageKey}
                                                    selected={tile.key === selected}
                                                    tabStop={tile.key === tabStop}
                                                    mark={marks.get(tile.key)}
                                                    conflict={session.conflicts.has(tile.id)}
                                                    movable={available && !stacked}
                                                    heights={heights}
                                                    stacked={stacked}
                                                    preview={preview?.key === tile.key ? preview : undefined}
                                                    onSelect={select}
                                                    onResizeStart={onResizeStart}
                                                    onRemove={onRemove}
                                                    onDuplicate={onDuplicate}
                                                    onEdit={onEdit}
                                                    actions={tile.key === selected ? tileActions?.(tile.key) : undefined}
                                                    register={register}
                                                    renderContent={renderContent}
                                                />
                                            ))}
                                        </SnapGridRowCell>
                                    </Fragment>
                                ))}
                                <SnapGridGapCell index={rows.length} first={rows.length === 0} end surface={surface} veto={veto} styles={styles} words={words} hover={hover} />
                            </Box>
                        </Box>
                    </Box>
                </Box>
                )}
            </BuilderFrame>
            <VisuallyHidden role="status" aria-live="polite" aria-atomic="true" data-snap-grid-announce="">{said}</VisuallyHidden>
        </Box>
    );
});
