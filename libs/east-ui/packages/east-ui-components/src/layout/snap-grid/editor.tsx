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
 * under the last. The three resize handles are the canvas's own pointer
 * handling, snapping live: a resize lands nowhere. The selection is the
 * host's bound `ui` state, or the canvas's own.
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
 * {@link SNAP_GRID_HOST_RANK}, and the history item last.
 *
 * A pane beside the canvas asks it for a change through the bound `ui`
 * (#996): a request for a tile's span, row, height or alignment is taken as
 * one gesture, by the rules the handles and drags keep, and written back
 * `none`. A screen asks it for an Apply through the bound `apply` (#998): the
 * canvas applies its drafts as its history item does, and answers under the
 * id asked once they land or cannot. The history shortcuts work anywhere in
 * the frame, the panes too.
 *
 * @packageDocumentation
 */

import {
    Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState,
    type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
    type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { Box, chakra, Menu as ChakraMenu, useSlotRecipe, VisuallyHidden, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faCheck, faEye, faMinus, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SnapGrid } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import type { ToolbarItem } from "../../toolbar/index.js";
import { ChipMenu } from "../../toolbar/chip-menu.js";
import { BuilderFrame, type BuilderFramePane } from "../builder-frame/index.js";
import { historyToolbarItem } from "../../editing/history-item.js";
import type { HistoryAction } from "../../editing/HistoryBar.js";
import { historyShortcut } from "../../editing/shortcuts.js";
import type { EditIssue, EditSession } from "../../editing/session.js";
import { sessionErrorText } from "../../editing/messages.js";
import {
    useDragLayerOptional, useDragTarget, useDropCell, useDragEventChip,
    type DragEventValue, type DragPayload, type DropCellOptions, type DropVeto,
} from "../../dnd/drag-layer";
import { useIRCanDrop, type CanDropFn } from "../../dnd/ir-can-drop";
import { useSnapGridEditing, type SnapGridDraftMark } from "./use-snap-grid-editing.js";
import { useSnapGridWords, type SnapGridWords } from "./messages.js";
import {
    MAX_HEIGHT, MAX_TILES, SNAP_GRID_COLUMNS, dropAt, heightAt, heldSpan, joinStops, landingOf, neighbourOf, rowsOf, spanAt, startColumn,
    type SnapGridBox, type SnapGridDrop, type SnapGridRowModel, type SnapGridTile,
} from "./model.js";
import type { SnapGridEditorCell, SnapGridEditorValue } from "./index.js";

// A tile's and a design width's icons are Font Awesome names from the data;
// register the free-solid set so they resolve by name (idempotent).
library.add(fas);

type Styles = Record<string, SystemStyleObject>;

/** The design width and zoom a host holds — the bound `view`'s value. */
type ViewState = ValueTypeOf<typeof SnapGrid.Types.ViewState>;

/** An Apply a host asks for, and the canvas's answer — the bound `apply`'s value. */
type ApplyState = ValueTypeOf<typeof SnapGrid.Types.ApplyState>;

/** Which edge a resize handle drags. */
type ResizeKind = "span" | "height" | "both";

/** The zoom's range and step. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

/**
 * The fold order of the canvas's own toolbar items (#995, #1229), lowest
 * first: the grid chip, then the width readout, then the saved time, then the
 * widths to their icons; then the zoom into the View chip with the widths
 * hidden into its menu, one bundle; then the value's start items. A host's own
 * items fold after them, from {@link SNAP_GRID_HOST_RANK}, and the history
 * item after all, at its own rank.
 */
const RANK_GRID = 10;
const RANK_READOUT = 20;
const RANK_SAVED = 30;
const RANK_WIDTHS = 40;
const RANK_VIEW = 50;
const RANK_START = 60;

/** The first rank a host's own toolbar items fold at — after every step of the canvas's own, before the history item's. */
export const SNAP_GRID_HOST_RANK = 70;

/** The zoom's fold into the View chip and the widths' into its menu: one bundle, applied together. */
const VIEW_BUNDLE = "snap-grid.view";

/**
 * Why the drafts cannot land, in the canvas's words: the first issue the
 * session holds, else its error, else its status line — the stale source's,
 * or the canvas's own when nothing else says.
 */
function refusalOf<W>(session: EditSession<W>, words: SnapGridWords): string {
    const readiness = session.readiness;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    if (issues.length > 0) return issues[0]!.message;
    if (session.error !== undefined) return sessionErrorText(session.error, words);
    if (session.stale) return words.m.historyStatus({ status: "stale" });
    return session.status === "idle" ? words.m.applyRefused() : words.m.historyStatus({ status: session.status });
}

/** A design width in whole px, when it is one — what the readout prints. */
function pxOf(width: string | undefined): number | undefined {
    const px = width === undefined ? undefined : /^(\d+(?:\.\d+)?)px$/.exec(width);
    return px ? Number(px[1]) : undefined;
}

/** A resize while the pointer holds its handle — what the tile draws until it lets go. */
interface ResizePreview {
    /** The tile's key. */
    key: string;
    /** The row it sits in. */
    row: string;
    /** The span it would take. */
    span?: number | undefined;
    /** The height it would take — `null` its content's own. */
    height?: number | null | undefined;
    /** Another tile's bottom edge it snapped to, in px from the row's top. */
    guide?: number | undefined;
}

/** Where a drag last rested over a row — the drop a row coordinate names, read back at the drop. */
interface Resting {
    /** The coordinate's row key. */
    row: string;
    /** The coordinate's slot — the pointed column. */
    slot: string;
    /** Where it lands. */
    drop: SnapGridDrop;
}

/** Marks what a drag resting over a cell would do — drawn by CSS, set without a render. */
type Hover = (el: HTMLElement | null, drop: SnapGridDrop, payload: DragPayload) => void;

/** The tiles of a row element — its direct tile children, in order. */
function tilesIn(row: Element): HTMLElement[] {
    return [...row.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-snap-grid-tile"));
}

/** A box, as the model reads one. */
function boxOf(el: Element): SnapGridBox {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** A row's gap between columns in client px — its CSS gap through the canvas's zoom. */
function clientGap(row: HTMLElement, box: SnapGridBox): number {
    const scale = row.offsetWidth > 0 ? box.width / row.offsetWidth : 1;
    return (Number.parseFloat(getComputedStyle(row).columnGap) || 0) * scale;
}

/** A brand line with the "+" badge on it. */
function InsertLine({ css, styles, attr }: { css: SystemStyleObject | undefined; styles: Styles; attr: "insert" | "gap" }) {
    return (
        <Box css={css} aria-hidden {...(attr === "insert" ? { "data-snap-grid-insert-line": "" } : { "data-snap-grid-gap-line": "" })}>
            <Box as="span" css={styles.rule} />
            <Box as="span" css={styles.badge}><FontAwesomeIcon icon={faPlus} /></Box>
            <Box as="span" css={styles.rule} />
        </Box>
    );
}

// ============================================================================
// Tile
// ============================================================================

interface TileProps {
    tile: SnapGridTile;
    cell: SnapGridEditorCell;
    surface: string;
    /** Its first column — the drag grammar's `from.slot`. */
    start: number;
    /** Its row's number, from 1. */
    rowNumber: number;
    styles: Styles;
    words: SnapGridWords;
    storageKey: string;
    selected: boolean;
    /** The canvas's one tab stop. */
    tabStop: boolean;
    mark: SnapGridDraftMark | undefined;
    /** It moves: the session takes a gesture. */
    movable: boolean;
    /** Its height is edited. */
    heights: boolean;
    preview: ResizePreview | undefined;
    onSelect: (key: string) => void;
    onResizeStart: (e: ReactPointerEvent, key: string, kind: ResizeKind) => void;
    onRemove: (key: string) => void;
    register: (key: string, el: HTMLElement | null) => void;
    /** Draws the tile's content, when the host does — else its East content. */
    renderContent: ((cell: SnapGridEditorCell) => ReactNode) | undefined;
}

const SnapGridTileBox = memo(function SnapGridTileBox(p: TileProps) {
    const { tile, cell, styles, words, register } = p;
    const m = words.m;
    const key = tile.key;
    const from = useMemo(() => ({ surface: p.surface, row: tile.row, slot: String(p.start), event: key }), [p.surface, tile.row, p.start, key]);
    const ghost = useMemo(() => <Box css={styles.ghost}>{tile.label}</Box>, [styles.ghost, tile.label]);
    const drag = useDragEventChip(from, ghost, !p.movable, tile.label);
    const dragRef = drag?.ref;
    const ref = useCallback((el: HTMLElement | null) => {
        dragRef?.(el);
        register(key, el);
    }, [dragRef, register, key]);
    const span = p.preview?.span ?? tile.span;
    const height = p.preview !== undefined && p.preview.height !== undefined ? p.preview.height : tile.height;
    const style = { "--snap-grid-span": String(span) } as CSSProperties;
    const frameStyle: CSSProperties | undefined = height === null || height === undefined ? undefined : { height: `${height}px` };
    const { onResizeStart, onRemove, onSelect } = p;
    return (
        <Box
            {...drag}
            ref={ref}
            css={styles.tile}
            style={style}
            role={drag?.role ?? "button"}
            tabIndex={p.tabStop ? 0 : -1}
            aria-label={m.tileName({ label: tile.label, span: words.number(span), row: words.number(p.rowNumber) })}
            data-snap-grid-tile={key}
            data-align={cell.align.type}
            data-selected={p.selected ? "" : undefined}
            data-pending={p.mark === "pending" ? "" : undefined}
            data-incomplete={p.mark === "incomplete" ? "" : undefined}
            data-invalid={p.mark === "invalid" ? "" : undefined}
            data-draggable={drag !== undefined ? "" : undefined}
            onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onSelect(key); }}
        >
            <Box css={styles.frame} style={frameStyle} data-frame={cell.frame ? "" : undefined}>
                {p.renderContent !== undefined ? p.renderContent(cell)
                    : cell.content !== undefined ? <EastChakraComponent value={cell.content} storageKey={`${p.storageKey}.${cell.key}`} />
                        : null}
            </Box>
            {p.selected && (
                <>
                    <Box as="span" css={styles.handle} data-handle="top-left" aria-hidden />
                    <Box as="span" css={styles.handle} data-handle="top-right" aria-hidden />
                    <Box as="span" css={styles.handle} data-handle="bottom-left" aria-hidden />
                    {p.heights && (
                        <Box as="span" css={styles.handle} data-handle="both" title={m.bothHandle()} aria-hidden
                            onPointerDown={(e: ReactPointerEvent) => onResizeStart(e, key, "both")} />
                    )}
                    <Box as="span" css={styles.handle} data-handle="span" title={m.spanHandle()} aria-hidden
                        onPointerDown={(e: ReactPointerEvent) => onResizeStart(e, key, "span")} />
                    {p.heights && (
                        <Box as="span" css={styles.handle} data-handle="height" title={m.heightHandle()} aria-hidden
                            onPointerDown={(e: ReactPointerEvent) => onResizeStart(e, key, "height")} />
                    )}
                    <chakra.button type="button" css={styles.remove} aria-label={m.remove()} title={m.remove()} data-snap-grid-remove=""
                        onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
                        onKeyDown={(e: ReactKeyboardEvent) => e.stopPropagation()}
                        onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onRemove(key); }}>
                        <FontAwesomeIcon icon={faTrashCan} />
                    </chakra.button>
                </>
            )}
            <InsertLine css={styles.insertBefore} styles={styles} attr="insert" />
            <InsertLine css={styles.insertAfter} styles={styles} attr="insert" />
        </Box>
    );
});

// ============================================================================
// Row, gap and end zone — the drop cells
// ============================================================================

interface RowProps {
    row: SnapGridRowModel;
    index: number;
    surface: string;
    veto: DropVeto;
    styles: Styles;
    words: SnapGridWords;
    resting: MutableRefObject<Resting | undefined>;
    hover: Hover;
    /** A height drag's snapped edge in this row, in px from its top. */
    guide: number | undefined;
    children: ReactNode;
}

/** A row: a continuous cell naming, where a drag rests, a place beside a tile or a new row above or below. */
const SnapGridRowCell = memo(function SnapGridRowCell(p: RowProps) {
    const { row, index, surface, resting, words, hover } = p;
    const el = useRef<HTMLElement | null>(null);
    const coord = useMemo(() => ({ surface, row: row.key, slot: "1" }), [surface, row.key]);
    const resolve = useCallback((x: number, y: number) => {
        const node = el.current;
        if (node === null) return coord;
        const box = boxOf(node);
        const drop = dropAt(index, box, tilesIn(node).map(boxOf), x, y);
        if (drop.kind === "gap") return { surface, row: "", slot: String(drop.at) };
        const gap = clientGap(node, box);
        const column = (box.width - (SNAP_GRID_COLUMNS - 1) * gap) / SNAP_GRID_COLUMNS;
        const pointed = Math.min(SNAP_GRID_COLUMNS, Math.max(1, Math.floor((x - box.left) / (column + gap)) + 1));
        const at = { surface, row: row.key, slot: String(pointed) };
        resting.current = { row: at.row, slot: at.slot, drop };
        return at;
    }, [coord, surface, row.key, index, resting]);
    const options = useMemo<DropCellOptions>(() => ({
        // A keyboard drag rests before each tile and after the last.
        stops: () => {
            const node = el.current;
            if (node === null) return [];
            return joinStops(tilesIn(node).map(boxOf), clientGap(node, boxOf(node)));
        },
        name: (at) => {
            if (at.row === "") return words.m.newRow({ row: words.number(Number(at.slot) + 1) });
            const drop = resting.current?.drop;
            const beside = drop?.kind === "join" ? row.tiles[drop.pos] : undefined;
            return beside !== undefined
                ? words.m.besideTile({ label: beside.label, row: words.number(index + 1) })
                : words.m.rowEnd({ row: words.number(index + 1) });
        },
        onHover: (x, y, payload) => {
            const node = el.current;
            if (node === null) return;
            const drop = dropAt(index, boxOf(node), tilesIn(node).map(boxOf), x, y);
            hover(node, drop, payload);
        },
    }), [words, resting, row.tiles, index, hover]);
    const dropRef = useDropCell(coord, false, p.veto, resolve, options);
    const ref = useCallback((node: HTMLElement | null) => {
        el.current = node;
        dropRef(node);
    }, [dropRef]);
    return (
        <Box ref={ref} css={p.styles.row} data-snap-grid-row={row.key} data-snap-grid-row-index={index}>
            <InsertLine css={p.styles.edgeBefore} styles={p.styles} attr="gap" />
            <InsertLine css={p.styles.edgeAfter} styles={p.styles} attr="gap" />
            {p.guide !== undefined && <Box css={p.styles.guide} style={{ top: `${p.guide}px` }} aria-hidden data-snap-grid-guide="" />}
            {p.children}
        </Box>
    );
});

interface GapProps {
    /** The gap's index: `0` above the first row, the row count below the last. */
    index: number;
    first: boolean;
    /** The end zone — the gap below the last row. */
    end: boolean;
    surface: string;
    veto: DropVeto;
    styles: Styles;
    words: SnapGridWords;
    hover: Hover;
}

/** A gap between rows, or the end zone below them: a drop there makes a new row. */
const SnapGridGapCell = memo(function SnapGridGapCell(p: GapProps) {
    const { index, surface, words, hover, styles } = p;
    const el = useRef<HTMLElement | null>(null);
    const coord = useMemo(() => ({ surface, row: "", slot: String(index) }), [surface, index]);
    const options = useMemo<DropCellOptions>(() => ({
        name: () => words.m.newRow({ row: words.number(index + 1) }),
        onHover: (_x, _y, payload) => hover(el.current, { kind: "gap", at: index }, payload),
    }), [words, index, hover]);
    const dropRef = useDropCell(coord, false, p.veto, undefined, options);
    const ref = useCallback((node: HTMLElement | null) => {
        el.current = node;
        dropRef(node);
    }, [dropRef]);
    if (p.end) {
        return (
            <Box ref={ref} css={styles.endZone} data-snap-grid-end="" data-snap-grid-gap={index}>
                <Box css={styles.endZoneBox}>
                    <Box as="span" css={styles.endZoneRest}>{words.m.endZoneRest()}</Box>
                    <Box as="span" css={styles.endZoneDragging}>{words.m.endZoneDragging()}</Box>
                    <Box as="span" css={styles.endZoneTarget}>{words.m.endZoneTarget()}</Box>
                </Box>
            </Box>
        );
    }
    return (
        <Box ref={ref} css={styles.gap} data-first={p.first ? "" : undefined} data-snap-grid-gap={index}>
            <InsertLine css={styles.gapLine} styles={styles} attr="gap" />
        </Box>
    );
});

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
}

/**
 * The SnapGrid's editing canvas — rendered for a SnapGrid whose `editing` is
 * declared (see the module docs).
 *
 * @param props - The value, its storage key and any host toolbar items
 * @returns The canvas
 */
export const SnapGridEditor = memo(function SnapGridEditor({ value, storageKey, toolbarItems, toolbar, panes, renderContent }: SnapGridEditorProps) {
    const words = useSnapGridWords();
    const m = words.m;
    const recipe = useSlotRecipe({ key: "snapGrid" });
    const surfaceTag = getSomeorUndefined(value.surface)?.type ?? "card";
    const styles = useMemo(() => recipe({ variant: "tiles", surface: surfaceTag }) as Styles, [recipe, surfaceTag]);
    // The toolbar's zoom and design widths are the shared stepper and seg strip.
    const stepperRecipe = useSlotRecipe({ key: "stepper" });
    const stepper = useMemo(() => stepperRecipe({ tone: "neutral", size: "sm" }) as Styles, [stepperRecipe]);
    const segRecipe = useSlotRecipe({ key: "seg" });
    const seg = useMemo(() => segRecipe() as Styles, [segRecipe]);
    // The View chip's menu is the theme's: its items' leading icons and its group labels.
    const menuRecipe = useSlotRecipe({ key: "menu" });
    const menu = useMemo(() => menuRecipe() as Styles, [menuRecipe]);
    const editing = useSnapGridEditing(value, storageKey);
    const { session, available, tiles, cells, marks, creates, heights, move, rowTo, align, add, resize, height, remove, action: sessionAction } = editing;

    // ── When the source last confirmed an Apply ──────────────────────────
    // An Apply is confirmed when the session leaves `reconciling` for `idle`
    // — heard from the session itself, since both can pass within one render;
    // a Discard clears the time, as it clears the drafts.
    const [savedAt, setSavedAt] = useState<Date | undefined>(undefined);
    useEffect(() => {
        let was = session.status;
        return session.subscribe(() => {
            if (was === "reconciling" && session.status === "idle") setSavedAt(new Date());
            was = session.status;
        });
    }, [session]);
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
    // A row holding its most tiles takes no other: the ⊘ stage. Then the host's word.
    const veto = useCallback<DropVeto>((event) => {
        const into = event.type === "add" ? event.value.into : event.type === "move" ? event.value.to : undefined;
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
            return drop !== undefined && add({ library: event.value.from.library, key: event.value.from.key }, drop);
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

    // ── The resize handles — the canvas's own pointer handling ───────────
    const [preview, setPreview] = useState<ResizePreview | undefined>(undefined);
    /** Each tile's content height, taken the last time it was auto — where a height drag returns it to auto. */
    const naturals = useRef(new Map<string, number>());
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
        if (tile.height === undefined) naturals.current.set(key, h0);
        const natural = naturals.current.get(key) ?? h0;
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
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onUp);
            handle.removeEventListener("pointercancel", onCancel);
            setPreview(undefined);
            if (!commit || last === undefined) return;
            if (kind === "span") {
                if (last.span !== undefined) resize(key, last.span);
            } else {
                height(key, last.height ?? null, kind === "both" ? last.span : undefined);
            }
        };
        const onUp = () => finish(true);
        const onCancel = () => finish(false);
        handle.setPointerCapture?.(e.pointerId);
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onCancel);
    }, [resize, height]);

    // Each auto tile's content height, kept fresh — what a height a pane asks
    // for is held to, as a height drag is.
    useEffect(() => {
        for (const tile of tiles) {
            if (tile.height !== undefined) continue;
            const frame = tileEls.current.get(tile.key)?.firstElementChild;
            if (frame instanceof HTMLElement && frame.offsetHeight > 0) naturals.current.set(tile.key, frame.offsetHeight);
        }
    });

    // ── A change a pane asks for (#996) — one gesture, then written back ─
    useEffect(() => {
        if (request === undefined || bound === undefined) return;
        const tile = tilesRef.current.find((t) => t.key === request.key);
        const change = request.change;
        if (tile !== undefined) {
            if (change.type === "span") {
                resize(tile.key, Number(change.value));
            } else if (change.type === "row") {
                rowTo(tile.key, Number(change.value));
            } else if (change.type === "height") {
                // As a height drag: a least height floors it, else its content's
                // height, where it returns to auto; never past the most.
                const asked = change.value.type === "some" ? Number(change.value.value) : null;
                const natural = naturals.current.get(tile.key);
                const kept = asked === null ? null
                    : tile.minHeight !== undefined ? Math.max(tile.minHeight, Math.min(MAX_HEIGHT, asked))
                        : natural !== undefined && asked <= natural ? null
                            : Math.min(MAX_HEIGHT, asked);
                height(tile.key, kept);
            } else {
                align(tile.key, change.value.type);
            }
        }
        try {
            bound.write({ selected: bound.read().selected, request: none });
        } catch (err) {
            console.error("[SnapGrid] ui state write failed:", err);
        }
    }, [request, bound, resize, rowTo, height, align]);

    // ── An Apply a screen asks for (#998) — the drafts applied, then answered ─
    const applyBind = value.apply.type === "some" ? value.apply.value : undefined;
    const readApply = useCallback(() => (applyBind === undefined ? undefined : applyBind.read()), [applyBind]);
    const { result: applyRead } = useTrackedEvaluation(readApply);
    const asked = applyRead.ok && applyRead.value !== undefined && applyRead.value.type === "asked" ? applyRead.value.value : undefined;
    useEffect(() => {
        if (asked === undefined || applyBind === undefined) return;
        let started = false;
        let answered = false;
        const answer = (state: ApplyState) => {
            answered = true;
            try {
                applyBind.write(state);
            } catch (err) {
                console.error("[SnapGrid] apply state write failed:", err);
            }
        };
        // At every change of the session: an Apply running is waited out;
        // with no draft left, the drafts landed; once, the drafts are applied
        // as the history item applies them — a request of unknown outcome
        // retried; otherwise they cannot land, and the canvas says why.
        const step = () => {
            if (answered || session.status === "applying" || session.status === "reconciling") return;
            if (session.pending === 0) {
                answer(variant("applied", asked));
            } else if (!started && (session.status === "unknown" || session.canApply)) {
                started = true;
                void session.apply();
            } else {
                answer(variant("refused", { id: asked, reason: refusalOf(session, words) }));
            }
        };
        const unsubscribe = session.subscribe(step);
        step();
        return () => { unsubscribe(); };
    }, [asked, applyBind, session, words]);

    const onRemove = useCallback((key: string) => {
        const label = tilesRef.current.find((t) => t.key === key)?.label ?? key;
        if (!remove(key)) return;
        announce(m.announceRemoved({ label }));
        select(null);
    }, [remove, announce, m, select]);

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
                if (selected === null) return;
                e.preventDefault();
                select(null);
                announce(m.announceCleared());
                return;
            case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": {
                const arrow = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down";
                const next = tile === undefined ? tiles[0]?.key : neighbourOf(rows, tile.key, arrow);
                const to = next !== undefined ? tiles.find((x) => x.key === next) : undefined;
                if (to === undefined) return;
                e.preventDefault();
                select(to.key);
                focusTile(to.key);
                announce(m.announceSelected({ label: to.label }));
                return;
            }
            case "[": case "]": {
                if (tile === undefined) return;
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
    const history = historyToolbarItem({ session, words, editing: false, onAction: action, onIssue });

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
    const zoomTo = (to: number) => setView({ width: view.width, zoom: some(Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, to)) * 10) / 10) });
    // The design width is the most the grid lays out at: a narrower column
    // lays it out at the column's width, a wider one centres it at its own.
    const canvasStyle: CSSProperties = { ...(width !== undefined ? { maxWidth: width, marginInline: "auto" } : {}), ...(zoom !== 1 ? { zoom } : {}) };
    const tabStop = selected ?? tiles[0]?.key;

    // ── The toolbar: the host's start items, the canvas's own, the history item, the host's end items ──
    const widthPx = pxOf(width);
    const zoomControl = (
        <Box css={stepper.root} role="group" aria-label={m.zoomLabel()} data-snap-grid-zoom="">
            <chakra.button type="button" css={stepper.button} aria-label={m.zoomOut()} title={m.zoomOut()}
                disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom - ZOOM_STEP)}>
                <FontAwesomeIcon icon={faMinus} />
            </chakra.button>
            <Box as="output" css={stepper.value}>{words.percent(zoom)}</Box>
            <chakra.button type="button" css={stepper.button} aria-label={m.zoomIn()} title={m.zoomIn()}
                disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom + ZOOM_STEP)}>
                <FontAwesomeIcon icon={faPlus} />
            </chakra.button>
        </Box>
    );
    const widthsGroup = (iconsOnly: boolean) => (
        <Box css={seg.root} role="group" aria-label={m.widthsLabel()} data-snap-grid-widths="">
            {value.widths.map((preset, i) => {
                const icon = getSomeorUndefined(preset.icon);
                const pressed = parseCssSize(preset.width) === width;
                return (
                    <chakra.button key={i} type="button" css={seg.item} data-state={pressed ? "on" : "off"} aria-pressed={pressed}
                        {...(iconsOnly ? { "aria-label": preset.label, title: preset.label } : {})}
                        onClick={() => setView({ width: some(preset.width), zoom: view.zoom })}>
                        {icon !== undefined && <Box as="span" css={styles.widthIcon}><FontAwesomeIcon icon={["fas", icon as IconName]} /></Box>}
                        {(!iconsOnly || icon === undefined) && <span>{preset.label}</span>}
                    </chakra.button>
                );
            })}
        </Box>
    );
    // The zoom and the widths folded into one chip (#1229): Zoom out, the zoom
    // and Zoom in — which leave the menu open — then the widths as a choice of one.
    const openWidth = String(value.widths.findIndex((preset) => parseCssSize(preset.width) === width));
    const viewChip = (
        <ChipMenu label={m.viewLabel()} icon={faEye} caret data="data-snap-grid-view" onSelect={(picked) => {
            if (picked === "zoom-out") zoomTo(zoom - ZOOM_STEP);
            else if (picked === "zoom-in") zoomTo(zoom + ZOOM_STEP);
        }}>
            <ChakraMenu.Item value="zoom-out" closeOnSelect={false} disabled={zoom <= ZOOM_MIN}>
                <Box as="span" css={menu.itemIndicator}><FontAwesomeIcon icon={faMinus} /></Box>
                {m.zoomOut()}
            </ChakraMenu.Item>
            <Box css={menu.itemGroupLabel} aria-live="polite" data-snap-grid-view-zoom="">{words.percent(zoom)}</Box>
            <ChakraMenu.Item value="zoom-in" closeOnSelect={false} disabled={zoom >= ZOOM_MAX}>
                <Box as="span" css={menu.itemIndicator}><FontAwesomeIcon icon={faPlus} /></Box>
                {m.zoomIn()}
            </ChakraMenu.Item>
            {value.widths.length > 0 && (
                <>
                    <ChakraMenu.Separator />
                    <Box css={menu.itemGroupLabel}>{m.widthsLabel()}</Box>
                    <ChakraMenu.RadioItemGroup value={openWidth} onValueChange={(d) => {
                        const preset = value.widths[Number(d.value)];
                        if (preset !== undefined) setView({ width: some(preset.width), zoom: view.zoom });
                    }}>
                        {value.widths.map((preset, i) => (
                            <ChakraMenu.RadioItem key={i} value={String(i)}>
                                <Box as="span" css={menu.itemIndicator}>{String(i) === openWidth && <FontAwesomeIcon icon={faCheck} />}</Box>
                                {preset.label}
                            </ChakraMenu.RadioItem>
                        ))}
                    </ChakraMenu.RadioItemGroup>
                </>
            )}
        </ChipMenu>
    );
    const items: ReadonlyArray<ToolbarItem | false | null | undefined> = [
        // The value's start items go last of the canvas's own steps (#1229).
        ...value.toolbar.start.map((node, i): ToolbarItem => ({
            key: `start-${i}`, side: "start", rank: RANK_START,
            forms: [<EastChakraComponent value={node} storageKey={`${storageKey}.toolbar.start.${i}`} />, null],
        })),
        ...(toolbar?.start ?? []),
        { key: "grid", side: "start", forms: [<Box as="span" css={styles.chip} data-snap-grid-chip="">{m.gridChip()}</Box>, null], rank: RANK_GRID },
        savedAt !== undefined && {
            key: "saved", side: "start", rank: RANK_SAVED, version: savedAt.getTime(),
            forms: [<Box as="span" css={styles.saved} data-snap-grid-saved="">{m.saved({ time: words.time(savedAt) })}</Box>, null],
        },
        widthPx !== undefined && {
            key: "readout", side: "end", rank: RANK_READOUT, version: widthPx,
            forms: [<Box as="span" css={styles.readout} data-snap-grid-readout="">{m.widthReadout({ px: words.bare(widthPx) })}</Box>, null],
        },
        { key: "zoom", side: "end", forms: [zoomControl, viewChip], rank: RANK_VIEW, bundle: VIEW_BUNDLE, version: zoom },
        { key: "rule", side: "end", forms: [<Box as="span" css={styles.divider} aria-hidden />] },
        ...(toolbarItems ?? []),
        history,
        value.widths.length > 0 && {
            key: "widths", side: "end", forms: [widthsGroup(false), widthsGroup(true), null],
            rank: [RANK_WIDTHS, RANK_VIEW], bundle: [undefined, VIEW_BUNDLE], version: width,
        },
        ...value.toolbar.end.map((node, i): ToolbarItem => ({
            key: `end-${i}`, side: "end",
            forms: [<EastChakraComponent value={node} storageKey={`${storageKey}.toolbar.end.${i}`} />],
        })),
        ...(toolbar?.end ?? []),
    ];

    // ── The selection bar: the selected tile's icon, name and meta ──────
    const selectedCell = selected !== null ? cellOf.get(selected) : undefined;
    const selectedIcon = selectedCell !== undefined ? getSomeorUndefined(selectedCell.icon) : undefined;
    const selectedMeta = selectedCell !== undefined ? getSomeorUndefined(selectedCell.meta) : undefined;
    // A SnapGrid's own East panes draw themselves: each is placed as it is.
    const eastPaneStart = getSomeorUndefined(value.panes.start);
    const eastPaneEnd = getSomeorUndefined(value.panes.end);
    const paneStart: BuilderFramePane | undefined = panes?.start ?? (eastPaneStart !== undefined
        ? { element: <EastChakraComponent value={eastPaneStart} storageKey={`${storageKey}.pane.start`} /> } : undefined);
    const paneEnd: BuilderFramePane | undefined = panes?.end ?? (eastPaneEnd !== undefined
        ? { element: <EastChakraComponent value={eastPaneEnd} storageKey={`${storageKey}.pane.end`} /> } : undefined);

    return (
        <Box
            css={styles.editor}
            data-snap-grid=""
            data-snap-grid-editor=""
            data-surface={surfaceTag}
            height={parseCssSize(getSomeorUndefined(value.height))}
            maxHeight={parseCssSize(getSomeorUndefined(value.maxHeight))}
        >
            <BuilderFrame storageKey={`${storageKey}.frame`} toolbar={items} start={paneStart} end={paneEnd} onKeyDown={onFrameKeyDown}>
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
                    <Box css={styles.viewport} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onClick={onClick}>
                        <Box css={styles.canvas} style={canvasStyle} role="group" aria-label={m.canvasLabel()} data-snap-grid-canvas="">
                            {guides && (
                                <Box css={styles.ruler} aria-hidden data-snap-grid-ruler="">
                                    {Array.from({ length: SNAP_GRID_COLUMNS }, (_, i) => (
                                        <Box key={i} css={styles.rulerMark} data-on={on !== undefined && i + 1 >= on.first && i + 1 <= on.last ? "" : undefined}>
                                            {words.number(i + 1)}
                                        </Box>
                                    ))}
                                </Box>
                            )}
                            {guides && (
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
                                                    movable={available}
                                                    heights={heights}
                                                    preview={preview?.key === tile.key ? preview : undefined}
                                                    onSelect={select}
                                                    onResizeStart={onResizeStart}
                                                    onRemove={onRemove}
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
            </BuilderFrame>
            <VisuallyHidden role="status" aria-live="polite" aria-atomic="true" data-snap-grid-announce="">{said}</VisuallyHidden>
        </Box>
    );
});
