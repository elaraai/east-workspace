/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The alignment contract, mechanically (`Plan Spec.md` §3): every body row is
 * one two-column grid — the fixed gutter cell and a plot of `n` buckets — so
 * every kind aligns by construction. The shell renders the gutter identity
 * vocabulary (name / id / sub / value / meta / swatches / status / caret, one
 * grid of caret, name and value slot, a level's indent the caret's cell and
 * its gap), the plot's bucket grid lines, and the shared now / cursor
 * hairlines; the kind renderer supplies the plot content.
 *
 * It is also a treegrid ROW (#819): `role="row"` at its level, selected and
 * expanded as it is, its gutter the `rowheader` and its plot a `gridcell`,
 * with its share of the canvas's one tab stop (`root/grid.ts`).
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { variant } from "@elaraai/east";
import { Box, useChakraContext } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faLink, faUpRightAndDownLeftFromCenter } from "@fortawesome/free-solid-svg-icons";
import {
    getSomeorUndefined, useDropCell, useDragLayerOptional, type CellCoord, type DragEventValue, type DragPayload, type DropCellOptions,
} from "@elaraai/east-ui-components";
import { proposeAt, spanFracs, unitsBetween } from "../../shared/time/drag.js";
import { NowLine } from "../../shared/time/now-line.js";
import { slotOfEnd, slotOfInstant } from "../../shared/time/slot.js";
import { fromPlanSlot, toPlanSlot } from "../slot.js";
import { spanWords } from "../edit/movable.js";
import { usePlanEdit, type PlanProposal } from "../edit/store.js";
import { holdsKey, movedCandidate } from "../edit/use-carry.js";
import { itemCandidate, itemRef, type PlanCandidateGesture, type PlanVeto } from "../edit/candidate.js";
import type { PlanEventDrop } from "../edit/event-drag.js";
import { LoadingWash, resolveColor } from "@elaraai/east-ui-components/internal";
import { usePlanCursor, usePlanDispatch, usePlanGeometry, usePlanScale } from "../context.js";
import { rowItemKey, type PlanRowValue } from "../model.js";
import { usePlanWords } from "../words.js";
import type { PlanGridRow } from "../root/grid.js";
import type { PlanDraftMark } from "../use-plan-editing.js";
import { PLAN_EVENT_ELEMENT_SELECTOR } from "./element-select.js";
import { laneBand, laneIndexAt, laneRooms, laneRulesPath } from "./lanes.js";
import { PlanStatusIcon } from "./StatusIcon.js";
import { dayRulesPath } from "../../shared/time/rules.js";
import { useLaidOutSize } from "../../shared/use-laid-out-size.js";

type Styles = Record<string, Record<string, unknown>>;

/** Indent per nesting level, in px (#1749): the caret's cell and the gap
 *  after it, so a member's words start where its parent's do — a row that
 *  folds has its caret's cell, a leaf none, its name at its level's indent. */
export const INDENT_PX = 20;

/**
 * A laned row's lane, as its gutter line draws it (#1680's review): its caption. The row places the line in the lane's
 * room, on the whole pixels its cells stand on (`laneRooms`, #1735).
 */
export interface PlanGutterLane {
    /** Its caption; `undefined` for a lane that has none. */
    readonly caption: string | undefined;
}

/**
 * Whether a gutter line stands alone in a room of an even height (#1735), which the recipe stands its words a pixel low
 * in (`data-plan-even-room`): the canvas's 11px face has a 13px glyph box, which no line centres on a whole pixel in an
 * even room (#1638) — a pixel over the line starts it a whole number of pixels under the room's top.
 *
 * @param room - The room's height, in px
 * @returns The attribute's value: `""` in an even room, else none
 */
function evenRoom(room: number): "" | undefined {
    return room % 2 === 0 ? "" : undefined;
}

/** A row with no lanes. */
const NO_LANES: readonly { readonly key: string }[] = [];

/**
 * The plot's rules, O(1) DOM per row (#616): one SVG the plot's laid-out size,
 * its lines on whole pixels (#1735) — each day's rule its last pixel, the last
 * day's the plot's own edge (`shared/time/rules.ts`), so every day has the
 * same room — over a buckets row's lane rules, drawn first so they lie under
 * the day rules. A 100-row × 500-bucket canvas is 100 SVGs, never 50,000
 * lines. Laid out before the browser paints; where nothing lays it out
 * (jsdom), it draws no line.
 *
 * @param props.lanes - A buckets row's lanes, whose rules it draws under the day rules; none for any other row
 */
export function GridSeparators({ styles, lanes = 0 }: { styles: Styles; lanes?: number }) {
    const scale = usePlanScale();
    const ref = useRef<HTMLDivElement | null>(null);
    const drawn = scale.buckets.length > 1 || lanes > 1;
    const size = useLaidOutSize(ref, drawn);
    const width = size?.width;
    const height = size?.height;
    const days = useMemo(() => (width === undefined || height === undefined ? "" : dayRulesPath(scale.buckets, width, height)),
        [scale.buckets, width, height]);
    // The plot is its row less the row's rule: the lanes share the row's height.
    const laneLines = useMemo(() => (width === undefined || height === undefined || lanes < 2 ? "" : laneRulesPath(laneRooms(height + 1, lanes), width)),
        [lanes, width, height]);
    if (!drawn) return null;
    return (
        <Box ref={ref} css={styles.gridSep} data-plan-axisline data-plan-gridsep>
            {width !== undefined && height !== undefined && (
                <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
                    {laneLines !== "" && <path d={laneLines} data-plan-lane-rules="" />}
                    {days !== "" && <path d={days} data-plan-day-rules="" />}
                </svg>
            )}
        </Box>
    );
}

/**
 * A row's DnD drop registration — present only when the canvas is a drag
 * target AND this row's KIND accepts drops (see `DROPPABLE_KINDS`): a library
 * card, where the row's series declares `edit.create`, and a moved run, chip,
 * tile or mark of the row's item type, where it declares a move's fields
 * (#825); and, on an event kind's row, the event kinds' drags (#1196).
 */
export interface PlanRowDrop {
    /** The canvas's DnD surface — its declared id, or one of its own when it declares none (#825). */
    surface: string;
    /** Whether a card reaches `data`'s rows — from the canvas's own library panel's tabs (#1259), or from a Library
     *  beside it that its `sources` lists under its declared `id`; with neither, a row of `data`'s that only takes
     *  cards registers no cell. */
    cards: boolean;
    /** The libraries whose cards land on `data`'s rows: the panel's author tabs', and the `sources` its `id` names. */
    libraries: ReadonlySet<string>;
    /** Whether `data`'s session takes a gesture now (#880): its rows take moves, and cards. */
    data: boolean;
    /** The Plan's veto over what a drop would do (`canDrop`, #1541 U7), asked of
     *  what the drag's CURRENT bucket would make of it on one of `data`'s rows —
     *  its duplicate flag included — its refusal's words the ghost's. */
    canDrop?: PlanVeto | undefined;
    /** The event kinds' drag and drop (#1196): what lands on their rows, its verdict and the ghost's words. */
    events?: PlanEventDrop | undefined;
}

export interface RowShellProps {
    row: PlanRowValue;
    styles: Styles;
    /** Grid template (`"var(--plan-gutter-w) 1fr"`, the canvas's) — one source for every band. */
    gridTemplate: string;
    /** Row height (px) — fixed per kind (`model.rowHeight`). */
    height: number;
    /** Nesting depth (gutter indent). */
    depth: number;
    selected: boolean;
    /** The caret state for nesting parents (undefined ⇒ no caret). */
    caret?: { collapsed: boolean } | undefined;
    /** Caret click: the subtree's fold — a caret only folds (#1680's review).
     *  The WHOLE gutter cell is the click target (the group-strip convention —
     *  a 14px caret is not a tree affordance); the plot keeps selection. */
    onCaretClick?: (() => void) | undefined;
    /** Table-row emphasis (K5: header wash / footer 2px top rule). */
    emphasis?: "header" | "footer" | undefined;
    /** Suppress the bucket grid lines (rows drawing their own canvas). */
    noGrid?: boolean;
    /** Row-scoped focus controls (R1 links / R2 expand) — ghost buttons over
     *  the gutter line's value slot, links then expand, shown on the row's
     *  hover, focus and selection and while one is pressed, which wears the
     *  brand tint (`Plan links.html`, #1258, #1749). An expandable chart's
     *  spark ↔ chart is its expand control's (#1680's review). */
    controls?: ReadonlyArray<{ kind: "links" | "expand"; active: boolean; onClick: () => void }> | undefined;
    /** A laned row's lanes (#1680's review): a gutter line each, the lane's height, its caption in the value slot. */
    lanes?: readonly PlanGutterLane[] | undefined;
    /** The gutter's lines stack from the row's top, the name on the row's first line where any one-line row's is (#1750)
     *  — a row taller than its lines, which would centre them in its height. A strip, and a row open on its render,
     *  keep their own layout. */
    gutterTop?: boolean | undefined;
    /** A value axis the row's plot scales against, down the gutter's value slot (#1750): its tick labels, each on its
     *  tick's y. The row's kind draws it; the shell gives it the cell. */
    gutterAxis?: ReactNode;
    /** What the row's plot draws, named down its gutter under the row's lines (#1750) — a chart's legend. The row's
     *  kind draws it, where it has room; the shell gives it the cell, and leaves out the meta and the swatches, which
     *  stood in for it. */
    gutterLegend?: ReactNode;
    /** The labels of the rows it nests under, outermost first, where a links focus gathers it (#1680's review): its sub
     *  line says them, then its own sub — which tells two rows of one name apart. */
    path?: readonly string[] | undefined;
    /** The expand render's axis treatment inside this row (R2; default keep). */
    axisMode?: "dim" | "off" | undefined;
    /** R2 (#591) — the focused row's developer render, mounted INSIDE this
     *  row's plot cell beneath the row's own marks. Its presence is what makes
     *  the row (and so its gutter) tall. */
    expandBody?: ReactNode;
    /** R2 — content for the space the grown gutter cell opens up. */
    expandGutter?: ReactNode;
    /** R2 — the row's NATURAL kind height: the band its own marks keep at the
     *  top while the render fills the remainder. */
    bandHeight?: number | undefined;
    /** R2 context strip (#591) — this row is not the focus, so it compresses
     *  to 16px and its marks to 7px on the same axis. Never removed: order,
     *  scroll position and the status survive, and the strip itself is the
     *  return click target. */
    ctx?: boolean | undefined;
    /** A strip that keeps its value and its status as they are in the value slot — a pinned row a links focus does not
     *  gather (#1680's review). */
    keep?: boolean | undefined;
    /** DnD drop registration for this row's plot. Absent ⇒ the row registers
     *  no cell, so it is never a destination and never lights up. */
    drop?: PlanRowDrop | undefined;
    /** The row's draft mark (#880) — a draft of its entry changed it: the
     *  Sheet's pending wash, and incomplete or invalid while a check refuses
     *  the entry. */
    draft?: PlanDraftMark | undefined;
    /** The row's grid plumbing (#819) — its written position, its share of
     *  the tab stop, and its focus handler (`usePlanGridRow`). */
    grid: PlanGridRow;
    /** `aria-expanded` (#819): whether its section, chart or expand render is
     *  open — absent for a row with nothing to open. */
    expandedState?: boolean | undefined;
    /** The row is the last visible member of an open group — it carries the
     *  group's closing rule (#949). */
    groupEnd?: boolean | undefined;
    /** Its events are unread (#1398, CL2): the region wash lies under what its plot holds, on the canvas's reveal clock,
     *  and the plot is busy — never an empty row while its cells are on their way. */
    unread?: boolean | undefined;
    children: ReactNode;
}

/** One canvas body row — gutter + plot on the shared template. */
export function RowShell({
    row, styles, gridTemplate, height, depth, selected,
    caret, onCaretClick, emphasis, noGrid,
    controls, lanes: gutterLanes, gutterTop, gutterAxis, gutterLegend, path, axisMode, ctx, keep, drop, draft, children,
    expandBody, expandGutter, bandHeight, grid, expandedState, groupEnd, unread,
}: RowShellProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const cursor = usePlanCursor();
    const system = useChakraContext();
    const geometry = usePlanGeometry();
    const words = usePlanWords();
    const gutter = row.gutter;
    // One flag, spread onto every slot that has a collapsed state. The slots
    // own the styling (`&[data-ctx]` in the recipe) — this only says which
    // elements are in a strip.
    const ctxAttr = ctx === true ? "" : undefined;
    const keepAttr = ctx === true && keep === true ? "" : undefined;
    // The row is EXPANDED when it carries a render. Everything the expanded
    // state changes — the tint, the top-aligned tall gutter, the banded plot —
    // keys off this one flag.
    const expanded = expandBody !== undefined;
    const expandedAttr = expanded ? "" : undefined;
    const own = gutter.sub.type === "some" ? gutter.sub.value : undefined;
    // A gathered row's sub line: what it nests under, then its own sub (#1680's review).
    const sub = path !== undefined && path.length > 0 ? words.m.focusPath({ path, sub: own }) : own;
    // A legend down the gutter says what the meta and the swatches stood in for (#1750): neither draws beside it.
    const meta = gutter.meta.type === "some" && gutterLegend === undefined ? gutter.meta.value : undefined;
    const swatches = gutterLegend === undefined ? gutter.swatches : [];
    const value = gutter.value.type === "some" ? gutter.value.value : undefined;
    const isId = gutter.id;
    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
    // The band an expanded row's own marks keep at the top — its natural kind
    // height, which the focused row is always handed.
    const band = bandHeight ?? geometry.row;

    // ── DnD drop cell ─────────────────────────────────────────────────────
    // The PLOT is the drop target, and its coordinate resolves from the
    // pointer at drop time (the Gantt's continuous-surface pattern). Two
    // things differ from the Gantt, both because of what a Plan row is:
    //
    //  - the ROW needs no virtualizer band math — a Plan row key IS its data
    //    key, and this component already is that row;
    //  - registration is PER ROW rather than one cell over the whole body,
    //    because a Plan's rows are heterogeneous. Which kinds accept a drop
    //    is a per-row question (`DROPPABLE_KINDS`), and the valid / active /
    //    ⊘ treatment has to land on the row the pointer is over rather than
    //    washing the entire canvas.
    //
    // The SLOT is the bucket under the drag, named by its start instant — the
    // canvas's own vocabulary for "where on the axis" (a `cell` element ref
    // reports the same bucket instant, not an index), spelled per the axis
    // arm by the shared encoding (`toPlanSlot`, #631): a Z-less ISO instant,
    // a decimal, or the ordinal value.
    //
    // A MOVED element (#825) lands by where it was grabbed: its drag moves it
    // by the buckets the pointer crossed since the press (the canvas's edit
    // store holds the press), so the slot is the bucket of its NEW start — or,
    // for an end dragged, of that end — and the landing band spans the extent
    // it would take. A row takes one only when its items are the element's
    // item type (`accepts`); any other row is no destination at all.
    //
    // An event kind's row (#1196) takes the event kinds' drags instead: a
    // template or a backlog card at the bucket under the pointer, an author's
    // card on the event under it, and an event's element by its kind — and the
    // event kinds judge each, say what lands where on the ghost, and size the
    // band (`edit/event-drag.ts`).
    const edit = usePlanEdit();
    const store = edit?.store;
    const moves = row.edits.move.type === "some" ? row.edits.move.value : undefined;
    // An event kind's row (#1196): the resource it stands for, which the event
    // kinds' drags land on — their verdict, the ghost's words and the band.
    const events = drop?.events;
    const eventTarget = useMemo(() => events?.target(row), [events, row]);
    const plotElRef = useRef<HTMLElement | null>(null);
    /** The pointer as a window fraction of this row's plot. */
    const fracAt = useCallback((clientX: number): number => {
        const rect = plotElRef.current?.getBoundingClientRect();
        return rect !== undefined && rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    }, []);
    // The lanes an event kind's tiles sit in on this row (#1541, U1): a drop lands in the one the pointer is over.
    const lanes = eventTarget !== undefined && row.kind.type === "buckets" ? row.kind.value.lanes : NO_LANES;
    /** The lane of this row a pointer is in, and its place among the row's; none on a row with no lanes, and for a drag the keyboard carries. */
    const laneAt = useCallback((clientY: number, keyboard: boolean): { readonly key: string; readonly index: number } | undefined => {
        const rect = plotElRef.current?.getBoundingClientRect();
        const index = keyboard || rect === undefined || rect.height <= 0 ? undefined : laneIndexAt((clientY - rect.top) / rect.height, lanes.length);
        return index === undefined ? undefined : { key: lanes[index]!.key, index };
    }, [lanes]);
    /** Where a moved element lands on this row, with the pointer at `clientX`, in `lane` — told to the store, with the units it moved by. */
    const landing = useCallback((clientX: number, lane: string | undefined) => {
        const grab = store?.grab;
        if (store === undefined || grab === null || grab === undefined) return undefined;
        const frac = fracAt(clientX);
        const span = proposeAt(scale, grab.movable.span, grab.mode, grab.grabFrac, frac, store.shift);
        store.propose({ rowKey: row.key, span, units: unitsBetween(scale, grab.grabFrac, frac, store.shift), fine: store.shift, lane });
        return { grab, span };
    }, [store, scale, fracAt, row.key]);
    /** The event element under a point in this row's plot — where an author's card lands (#1196, PB63), and Connect's line ends (#1541, U10). */
    const eventNodeAt = useCallback((clientX: number, clientY: number): Element | undefined => {
        const hit = document.elementFromPoint(clientX, clientY)?.closest(PLAN_EVENT_ELEMENT_SELECTOR);
        return hit === null || hit === undefined || plotElRef.current?.contains(hit) !== true ? undefined : hit;
    }, []);
    /** The event element under a point in this row's plot, by its key. */
    const eventAt = useCallback((clientX: number, clientY: number): string | undefined => {
        const hit = eventNodeAt(clientX, clientY);
        if (hit === undefined) return undefined;
        return hit.getAttribute("data-run") ?? hit.getAttribute("data-event") ?? hit.getAttribute("data-chip") ?? hit.getAttribute("data-mark") ?? undefined;
    }, [eventNodeAt]);
    const resolveCoord = useCallback((clientX: number, clientY: number, payload: DragPayload, keyboard: boolean): CellCoord => {
        const surface = drop?.surface ?? "";
        // The bucket under the pointer, by the shared frac→bucket resolver (#617): the exact right edge closes into the
        // last bucket; a truncated axis's uncovered remainder is NO bucket (#618) — the slot stays empty and `dropVeto`
        // refuses it, so a drop past the truncation point can never land at a wrong instant.
        const slotHere = (): string => {
            const bi = scale.bucketAtFrac(fracAt(clientX));
            const bucket = bi >= 0 ? scale.buckets[bi] : undefined;
            return bucket !== undefined ? toPlanSlot(bucket.start) : "";
        };
        // Connect held (#1541, U10): an element's drag ends at the event under the pointer, and moves nothing — the
        // coordinate names that event, at the bucket the pointer is in.
        if (payload.kind !== "item" && eventTarget !== undefined && events?.connecting === true) {
            const slot = slotHere();
            const event = eventAt(clientX, clientY);
            // The draft line follows the pointer wherever the drag rests on the row, and snaps to the event the link may
            // end at: told here, where every step of the pointer is resolved, landing or not.
            const grab = store?.grab;
            const lands = grab !== null && grab !== undefined && events.connect(grab.movable, event).allowed;
            store?.drawTo({ x: clientX, y: clientY, onto: lands ? eventNodeAt(clientX, clientY) : undefined });
            return event !== undefined ? { surface, row: row.key, slot, event } : { surface, row: row.key, slot };
        }
        if (payload.kind !== "item") {
            const at = landing(clientX, laneAt(clientY, keyboard)?.key);
            if (at === undefined) return { surface, row: row.key, slot: "" };
            const slot = at.grab.mode === "end" ? slotOfEnd(scale, at.span.end) : slotOfInstant(scale, at.span.start);
            return { surface, row: row.key, slot };
        }
        // A card rests in the lane the pointer is over (#1541, U1): what the event kinds judge it by, and land it in.
        if (store !== undefined && eventTarget !== undefined) store.cardLane = { row: row.key, lane: laneAt(clientY, keyboard)?.key };
        const slot = slotHere();
        // An author's card lands on the event under the pointer (#1196): the coordinate names it.
        const event = eventTarget !== undefined && events?.landsOnEvent(payload.from.library) === true ? eventAt(clientX, clientY) : undefined;
        return event !== undefined ? { surface, row: row.key, slot, event } : { surface, row: row.key, slot };
    }, [scale, drop?.surface, row.key, landing, laneAt, fracAt, eventTarget, events, eventAt, eventNodeAt, store]);
    /** The landing the store holds for this row, when the drag rests on it — what the event kinds judge an element by. */
    const landingHere = useCallback((): PlanProposal | undefined => {
        const proposal = store?.proposal;
        return proposal !== null && proposal !== undefined && proposal.rowKey === row.key ? proposal : undefined;
    }, [store, row.key]);
    /**
     * Whether this row takes what is dragged at all — a card where its series
     * makes one, an element of its item type; on an event kind's row, the
     * event kinds' cards and elements (#1196).
     */
    const accepts = useCallback((payload: DragPayload): boolean => {
        if (payload.kind === "item") {
            return (eventTarget !== undefined && events?.takesCard(payload.from.library) === true)
                || (row.edits.drop && drop?.cards === true && drop.libraries.has(payload.from.library));
        }
        const grab = store?.grab;
        if (grab === null || grab === undefined) return false;
        // The press armed what is dragged: the same element, from its row.
        if (payload.from.event !== grab.movable.key || payload.from.row !== grab.movable.rowKey) return false;
        // An event kind's element lands on the event kinds' rows, by its kind (#1196).
        if (events?.isEvent(grab.movable) === true) {
            return eventTarget !== undefined && (payload.kind !== "edge" || row.key === grab.movable.rowKey);
        }
        if (moves === undefined || drop?.data !== true) return false;
        // An end moves along its own row only (the layer holds an edge there too).
        return payload.kind === "edge" ? row.key === grab.movable.rowKey : moves.items === grab.movable.items;
    }, [store, moves, row.edits.drop, row.key, drop, eventTarget, events]);
    // The registered coord is the row at its FIRST bucket: it is what the
    // drag-start sweep asks about, before the drag rests anywhere. A row the
    // predicate can only ever refuse never lights up as a candidate, instead of
    // promising a drop and taking it back on hover. It is only the opening
    // AFFORDANCE — the layer asks again at every point the drag rests, and once
    // more of the event it delivers, so a predicate that discriminates on the
    // slot resolves per bucket.
    const firstSlot = scale.buckets[0] !== undefined ? toPlanSlot(scale.buckets[0].start) : "";
    const dropCoord = useMemo<CellCoord | null>(
        () => (drop !== undefined ? { surface: drop.surface, row: row.key, slot: firstSlot } : null),
        [drop, row.key, firstSlot],
    );
    /** Why the Plan's `canDrop` refuses a card landing on this row of `data`'s, at a slot — on an item, where it lands on one. */
    const cardRefusal = useCallback((from: { readonly library: string; readonly key: string }, slot: string, onto: string | undefined, duplicate: boolean): string | undefined =>
        drop?.canDrop?.refusal(itemCandidate(
            variant("add", { duplicate }) as PlanCandidateGesture, row.id.value.series, variant("card", { library: from.library, key: from.key }),
            { row: row.id, start: slot === "" ? undefined : fromPlanSlot(scale.kind, slot) },
            onto === undefined ? undefined : itemRef(row.key, onto))),
    [drop, row, scale]);
    /**
     * Why the Plan's `canDrop` refuses what a drag event would do on this row of `data`'s (#1541, U7); `undefined` where it
     * lands. A moved element is asked where the drag holds it here — or, before it rests here, where the event's bucket
     * would put it, by the buckets between its press and that bucket, as a pointer there would.
     */
    const dataRefusal = useCallback((candidate: DragEventValue): string | undefined => {
        const veto = drop?.canDrop;
        if (veto === undefined) return undefined;
        if (candidate.type === "add") {
            const into = candidate.value.into;
            return cardRefusal(candidate.value.from, into.slot, getSomeorUndefined(into.event), candidate.value.duplicate);
        }
        const grab = store?.grab;
        if (grab === null || grab === undefined) return undefined;
        let to = landingHere();
        if (to === undefined) {
            const slot = candidate.type === "move" ? candidate.value.to.slot : candidate.type === "resize" ? candidate.value.event.slot : "";
            const bucket = scale.buckets.find((b) => toPlanSlot(b.start) === slot);
            if (bucket === undefined) return undefined;
            to = { rowKey: row.key, span: proposeAt(scale, grab.movable.span, grab.mode, grab.grabFrac, (bucket.x0 + bucket.x1) / 2, false) };
        }
        const moved = movedCandidate(grab.movable, to);
        return moved === undefined ? undefined : veto.refusal(moved);
    }, [drop, store, landingHere, scale, row.key, cardRefusal]);
    const dropVeto = useCallback((candidate: DragEventValue): boolean => {
        if (drop === undefined) return true;
        // No bucket under the drag (past a truncated axis's coverage), or a
        // moved element with no press to land by — structurally not a
        // destination, before any predicate is asked.
        const slot = candidate.type === "add" ? candidate.value.into.slot
            : candidate.type === "move" ? candidate.value.to.slot
                : candidate.type === "resize" ? candidate.value.event.slot : "-";
        if (slot === "") return false;
        // Connect held (#1541, U10): the event kinds judge the link the drag would draw to the event it rests on.
        if (eventTarget !== undefined && events?.connecting === true && candidate.type === "move") {
            const grab = store?.grab;
            return grab !== null && grab !== undefined && events.isEvent(grab.movable)
                && events.connect(grab.movable, getSomeorUndefined(candidate.value.to.event)).allowed;
        }
        // A row's items keep their keys unique (#825): an element from another
        // row lands here only when none of this row's elements has its key.
        if (candidate.type === "move" && candidate.value.from.row !== row.key
            && candidate.value.from.event.type === "some" && holdsKey(row, candidate.value.from.event.value)) return false;
        // An event kind's row is the event kinds' to judge (#1196): a card at the
        // bucket — or on the event — under the pointer, an element where the
        // landing put it (before it rests here, by the kinds alone).
        if (eventTarget !== undefined && events !== undefined) {
            if (candidate.type === "add") {
                const into = candidate.value.into;
                return events.card(row, candidate.value.from, into.slot, getSomeorUndefined(into.event)).allowed;
            }
            const grab = store?.grab;
            if (grab === null || grab === undefined || !events.isEvent(grab.movable)) return false;
            return events.element(row, grab.movable, landingHere()).allowed;
        }
        return dataRefusal(candidate) === undefined;
    }, [drop, row, eventTarget, events, store, landingHere, dataRefusal]);
    /**
     * What the ghost says while the drag rests here (#1187): on an event kind's row, what lands where, or why not
     * (#1196); on one of `data`'s, why the Plan's `canDrop` refuses it (#1541, U7).
     */
    const caption = useCallback((coord: CellCoord, payload: DragPayload, _allowed?: boolean, duplicate = false): string | undefined => {
        if (eventTarget === undefined || events === undefined) {
            if (drop?.canDrop === undefined) return undefined;
            // A card is asked as the verdict asks it: a copy where Alt is held.
            if (payload.kind === "item") return cardRefusal(payload.from, coord.slot, coord.event, duplicate);
            const grab = store?.grab;
            const to = landingHere();
            const moved = grab === null || grab === undefined || to === undefined ? undefined : movedCandidate(grab.movable, to);
            return moved === undefined ? undefined : drop.canDrop.refusal(moved);
        }
        if (payload.kind === "item") return events.card(row, payload.from, coord.slot, coord.event).caption;
        const grab = store?.grab;
        if (grab === null || grab === undefined || !events.isEvent(grab.movable)) return undefined;
        // Connect held (#1541, U10): the link it would draw to the event under the pointer, or why not.
        if (events.connecting) return events.connect(grab.movable, coord.event).caption;
        return events.element(row, grab.movable, landingHere()).caption;
    }, [eventTarget, events, row, store, landingHere, drop, cardRefusal]);

    // ── The landing band ──────────────────────────────────────────────────
    // While a card is over this row, show WHERE it would come to rest. The
    // band spans the bucket `resolveCoord` names, so the preview and the drop
    // cannot disagree — they read the same geometry from the same rect.
    //
    // Positioned by writing the style DIRECTLY, never through React state: the
    // layer tells the row each time the drag rests over it (a pointer move, a
    // keyboard step), and routing that through state would re-render this row
    // (and, through the shared reducer, the whole canvas) on every one.
    // Whether the band is VISIBLE is not decided here at all — the recipe
    // shows it only inside `[data-drop-active]`, which the drag layer sets on
    // exactly the destination cell and never sets on a refused one, so a
    // vetoed row shows no landing band for free.
    const dragActive = useDragLayerOptional()?.active === true;
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewTextRef = useRef<HTMLSpanElement | null>(null);
    /** The band's height on a row with lanes (#1541, U1): the lane a drop lands in, or — none named — the whole row. */
    const bandIn = useCallback((el: HTMLElement, lane: number | undefined) => {
        if (lanes.length === 0) return;
        const band = lane === undefined ? laneBand(0, lanes.length, lanes.length) : laneBand(lane, lanes.length);
        el.style.top = `${band.top * 100}%`;
        el.style.height = `${band.height * 100}%`;
    }, [lanes]);
    const positionPreview = useCallback((clientX: number, clientY: number, payload: DragPayload, keyboard: boolean) => {
        const el = previewRef.current;
        if (el === null) return;
        // An author's card lands on an event, and Connect on one: neither in a lane.
        const lane = payload.kind === "item" && events?.landsOnEvent(payload.from.library) === true ? undefined : laneAt(clientY, keyboard);
        bandIn(el, events?.connecting === true ? undefined : lane?.index);
        if (payload.kind !== "item" && eventTarget !== undefined && events?.connecting === true) {
            // Connect held (#1541, U10): the band spans the event the link would end at — none under the pointer, it
            // stays where it was, on a cell the verdict leaves inactive.
            const grab = store?.grab;
            const span = grab === null || grab === undefined ? undefined : events.connect(grab.movable, eventAt(clientX, clientY)).span;
            if (previewTextRef.current !== null) previewTextRef.current.textContent = "";
            if (span === undefined) return;
            const { left, right } = spanFracs(scale, span);
            el.style.left = `${left * 100}%`;
            el.style.width = `${(right - left) * 100}%`;
            return;
        }
        if (payload.kind !== "item") {
            // A moved element: the extent it would take, labelled with it.
            const at = landing(clientX, lane?.key);
            if (at === undefined || edit === null) return;
            const { left, right } = spanFracs(scale, at.span);
            el.style.left = `${left * 100}%`;
            el.style.width = `${(right - left) * 100}%`;
            if (previewTextRef.current !== null) previewTextRef.current.textContent = spanWords(scale, at.grab.movable, at.span, words);
            return;
        }
        if (previewTextRef.current !== null) previewTextRef.current.textContent = "";
        // The same resolver the drop coordinate reads (#617) — the preview and
        // the drop cannot disagree. No bucket ⇒ the band stays where it was
        // (the cell is not active there anyway — `dropVeto` refused it).
        const bi = scale.bucketAtFrac(fracAt(clientX));
        const bucket = bi >= 0 ? scale.buckets[bi] : undefined;
        if (bucket === undefined) return;
        // On an event kind's row (#1196) the band spans what the drop makes —
        // a template's event for its duration, a backlog event for its own — or
        // the event an author's card lands on.
        const event = eventTarget !== undefined && events?.landsOnEvent(payload.from.library) === true ? eventAt(clientX, clientY) : undefined;
        const span = eventTarget !== undefined ? events?.card(row, payload.from, toPlanSlot(bucket.start), event).span : undefined;
        if (span !== undefined) {
            const { left, right } = spanFracs(scale, span);
            el.style.left = `${left * 100}%`;
            el.style.width = `${(right - left) * 100}%`;
            return;
        }
        el.style.left = `${bucket.x0 * 100}%`;
        el.style.width = `${(bucket.x1 - bucket.x0) * 100}%`;
    }, [scale, landing, laneAt, bandIn, fracAt, edit, words, eventTarget, events, eventAt, row, store]);

    // A keyboard drag rests at bucket centres, the announcements name the row
    // and its bucket — or, for a moved element, the span it would take — in
    // the canvas's words, and wherever the drag rests over the row, its
    // landing band follows.
    const dropOptions = useMemo<DropCellOptions>(() => ({
        stops: () => {
            const rect = plotElRef.current?.getBoundingClientRect();
            if (rect === undefined || rect.width <= 0) return [];
            return scale.buckets.map((b) => rect.left + ((b.x0 + b.x1) / 2) * rect.width);
        },
        name: (coord, payload) => {
            // An event kind's row is named by the resource it stands for (#1196) — a way
            // of drawing after a resource's first is labelled with its kinds' names.
            const label = (eventTarget !== undefined ? events?.where(row) : undefined) ?? gutter.label;
            const proposal = store?.proposal;
            if (payload.kind !== "item" && store?.grab != null && proposal != null && proposal.rowKey === row.key) {
                return words.m.list({ parts: [label, spanWords(scale, store.grab.movable, proposal.span, words)] });
            }
            const bucket = scale.buckets.find((b) => toPlanSlot(b.start) === coord.slot);
            return bucket !== undefined
                ? words.m.list({ parts: [label, scale.bucketText(bucket)] })
                : label;
        },
        onHover: positionPreview,
        accepts,
        caption,
    }), [scale, words, gutter.label, positionPreview, accepts, caption, store, row, eventTarget, events]);
    // The keyboard carry (#825) lands here: the landing band at the extent it
    // would take, lit — or refused — as a drag's destination is.
    const noSubscribe = useCallback(() => () => undefined, []);
    const carry = useSyncExternalStore(store?.subscribe ?? noSubscribe, () => store?.carryOn(row.key) ?? null);
    // Placed the way a pointer drag places it — written, not rendered — so the
    // two never fight over the band.
    useLayoutEffect(() => {
        const el = previewRef.current;
        if (carry === null || el === null) return;
        const { left, right } = spanFracs(scale, carry.to.span);
        el.style.left = `${left * 100}%`;
        el.style.width = `${(right - left) * 100}%`;
        // A keyboard carry names no lane: the band is the row's.
        bandIn(el, undefined);
        if (previewTextRef.current !== null) previewTextRef.current.textContent = spanWords(scale, carry.movable, carry.to.span, words);
    }, [carry, scale, words, bandIn]);
    const dropRef = useDropCell(dropCoord, false, dropVeto, resolveCoord, dropOptions);
    // One ref doing two jobs: the layer's registration, and the rect
    // `resolveCoord` measures the pointer against.
    const plotRef = useCallback((el: HTMLDivElement | null) => {
        plotElRef.current = el;
        dropRef(el);
    }, [dropRef]);

    // ── The gutter line (§3; #1749) ───────────────────────────────────────
    // One grid: the caret's cell on a row that folds — a leaf has none, its
    // name at its level's indent (`data-leaf`) — the name — the label, then the
    // meta inline — and the value slot, the row's status at its start and its
    // value at its end, on every row. So every status and value stands at one
    // x, down the canvas; only the name gives way. The row's controls take no
    // cell: they stand over the value slot, links then expand, each in its
    // place whether the row has the other or not.
    const control = (kind: "links" | "expand"): ReactNode => {
        const c = controls?.find((one) => one.kind === kind);
        if (c === undefined) return <Box as="span" />;
        return (
            <Box
                as="button"
                css={styles.rowControl}
                tabIndex={-1}
                data-plan-control={c.kind}
                data-active={c.active ? "" : undefined}
                aria-label={c.kind === "links" ? words.m.linksControl() : words.m.expandControl()}
                aria-pressed={c.active}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); c.onClick(); }}
            >
                <FontAwesomeIcon icon={c.kind === "links" ? faLink : faUpRightAndDownLeftFromCenter} />
            </Box>
        );
    };
    // The value slot's two parts. The status is its tone's icon, which its name says (#819); the value is always
    // there, whole or not drawn. A strip drops its value and shrinks its status, but for a pinned row a links focus
    // does not gather (`keep`).
    const statusCell = <PlanStatusIcon tone={statusTone} styles={styles} ctx={ctxAttr} keep={keepAttr} />;
    const valueCell = <Box as="span" css={styles.gutterValue} data-ctx={ctxAttr} data-keep={keepAttr} data-plan-gutter="value">{value}</Box>;
    // Row controls (R1/R2), over the value slot of a row that has one — on its hover, focus and selection, and while
    // one of them is pressed: the focal row of an open focus (`data-focal`). Each is named by the canvas's tooltip
    // (`root/overlays.tsx`); a control click never selects or toggles the row. Out of the tab order: the row's Tab walk
    // reaches them (#819).
    const controlsCell = controls === undefined || controls.length === 0 ? null : (
        <Box as="span" css={styles.rowControls} data-ctx={ctxAttr} data-plan-controls data-focal={controls.some((c) => c.active) ? "" : undefined}>
            {control("links")}{control("expand")}
        </Box>
    );
    // A leaf folds nothing: no caret's cell, and its lines say so, for the grid without one.
    const leafAttr = caret === undefined ? "" : undefined;
    const caretCell = caret === undefined ? null : (
        <Box as="span" css={styles.caret} data-collapsed={caret.collapsed ? "" : undefined}>
            <FontAwesomeIcon icon={faCaretDown} />
        </Box>
    );
    const nameCell = (
        <Box as="span" css={styles.gutterNameCell} data-plan-gutter="title">
            <Box as="span" css={styles.gutterLabel} data-plan-gutter="label">{gutter.label}</Box>
            {meta !== undefined && <Box as="span" css={styles.gutterMeta} data-ctx={ctxAttr} data-plan-gutter="meta">{meta}</Box>}
        </Box>
    );
    // A laned row (#1680's review): a gutter line per lane, the lane's height, its caption in the value slot — the
    // name's on the first, the sub on the second — in place of a caption in every cell.
    const laned = gutterLanes !== undefined && gutterLanes.length > 1 && ctx !== true && !expanded
        && gutterLanes.some((lane) => lane.caption !== undefined) ? gutterLanes : undefined;
    // Each lane's room, on the whole pixels its cells stand on (#1735): a lane line in it, the line a pixel low in an even
    // one. A buckets row's name line alone in its room — no sub, no swatches — the same: the room is the row less its rule.
    const rooms = laned === undefined ? undefined : laneRooms(height, laned.length);
    const nameRoom = row.kind.type === "buckets" && ctx !== true && !expanded && sub === undefined && gutter.swatches.length === 0
        ? evenRoom(height - 1) : undefined;

    return (
        <Box
            ref={grid.ref}
            css={styles.row}
            style={{ gridTemplateColumns: gridTemplate, height: `${height}px` }}
            role="row"
            aria-level={depth + 1}
            aria-selected={selected}
            aria-expanded={expandedState}
            tabIndex={grid.tabIndex}
            onFocus={grid.onFocus}
            data-plan-item={rowItemKey(row.key)}
            data-plan-row={row.key}
            data-plan-kind={row.kind.type}
            data-collapsible={caret !== undefined && ctx !== true ? "" : undefined}
            // The height the model laid the row out at — a layout spec holds
            // the rendered height to it, kind by kind (#817).
            data-plan-h={height}
            data-selected={selected ? "" : undefined}
            data-group-end={groupEnd === true ? "" : undefined}
            data-emphasis={emphasis}
            data-ctx={ctxAttr}
            data-expanded={expandedAttr}
            // A drafted row (#880) — the Sheet's marks.
            data-draft={draft !== undefined ? "" : undefined}
            data-incomplete={draft === "incomplete" ? "" : undefined}
            data-invalid={draft === "invalid" ? "" : undefined}
            // A strip's whole job is to be the way back — clicking one returns
            // to all rows rather than selecting the row underneath.
            onClick={() => dispatch(ctx === true
                ? { t: "focus.clear" }
                : { t: "row.select", key: row.key })}
            cursor="pointer"
        >
            <Box
                css={styles.gutterCell}
                role="rowheader"
                data-expanded={expandedAttr}
                // From the row's top (#1750): its name where a one-line row's stands, and with a sub line, both where a
                // two-line row's do.
                data-plan-gutter-top={gutterTop === true && ctx !== true && !expanded ? (sub !== undefined ? "sub" : "") : undefined}
                style={{ paddingLeft: `${12 + depth * INDENT_PX}px` }}
                onClick={onCaretClick !== undefined && ctx !== true
                    ? (e: React.MouseEvent) => { e.stopPropagation(); onCaretClick(); }
                    : undefined}
            >
                {laned !== undefined ? laned.map((lane, i) => (
                    // A lane's line, laid over the cell where its cells sit: the name's line first, with the row's
                    // status and its controls, the sub on the second, and each lane's caption in its value slot — the
                    // first's, where it has none, the row's value.
                    <Box key={i} css={styles.gutterLane} data-ctx={ctxAttr} data-leaf={leafAttr} data-plan-gutter={i === 0 ? "name" : "lane"}
                        data-plan-even-room={rooms?.[i] === undefined ? undefined : evenRoom(rooms[i].room)}
                        style={{ left: `${12 + depth * INDENT_PX}px`, top: `${rooms?.[i]?.top ?? 0}px`, height: `${rooms?.[i]?.room ?? 0}px` }}>
                        {i === 0 ? caretCell : caret !== undefined && <Box as="span" />}
                        {i === 0 ? nameCell : (
                            <Box as="span" css={styles.gutterNameCell}>
                                {i === 1 && sub !== undefined && <Box as="span" css={styles.gutterMeta} data-plan-gutter="sub">{sub}</Box>}
                            </Box>
                        )}
                        <Box as="span" css={styles.gutterSlot} data-plan-gutter="slot">
                            {i === 0 && statusCell}
                            {i === 0 && lane.caption === undefined ? valueCell
                                : <Box as="span" css={styles.gutterLaneCaption} data-plan-lane={i}>{lane.caption}</Box>}
                            {i === 0 && controlsCell}
                        </Box>
                    </Box>
                )) : (
                    <>
                        <Box css={styles.gutterName} data-id={isId ? "" : undefined} data-ctx={ctxAttr} data-leaf={leafAttr} data-plan-gutter="name"
                            data-plan-even-room={nameRoom}>
                            {caretCell}
                            {nameCell}
                            <Box as="span" css={styles.gutterSlot} data-plan-gutter="slot">
                                {statusCell}
                                {valueCell}
                                {controlsCell}
                            </Box>
                        </Box>
                        {sub !== undefined && <Box css={styles.gutterSub} data-ctx={ctxAttr} data-leaf={leafAttr} data-plan-gutter="sub">{sub}</Box>}
                    </>
                )}
                {swatches.length > 0 && (
                    <Box display="flex" gap="7px" marginTop="1px">
                        {swatches.map((s, i) => (
                            <Box key={i} as="span" css={styles.gutterSwatch} data-ctx={ctxAttr}>
                                <Box as="i" background={resolveColor(system, s.color)} />
                                {s.label}
                            </Box>
                        ))}
                    </Box>
                )}
                {/* R2 — the space the grown gutter opens up is the author's
                    (`expandGutter`), below the row's own identity lines. */}
                {expandGutter !== undefined && (
                    <Box css={styles.expandGutterBody} data-plan-expandgutter>{expandGutter}</Box>
                )}
                {gutterLegend}
                {gutterAxis}
            </Box>
            <Box
                ref={plotRef}
                css={styles.plot}
                role="gridcell"
                // What a pressed element measures its grab against (#825).
                data-plan-plot
                data-axis={axisMode}
                // The keyboard carry's destination (#825), staged as a drag's is.
                data-drop-active={carry !== null && !carry.refused ? "" : undefined}
                data-drop-invalid={carry !== null && carry.refused ? "" : undefined}
                // Its events still to land (#1398, CL2): busy, washed under what it holds.
                aria-busy={unread === true ? true : undefined}
                data-plan-unread={unread === true ? "" : undefined}
                onPointerMove={(e) => {
                    // While a drag is in flight the landing band IS the readout
                    // (the layer positions it), so the hairline would only add a
                    // second, competing mark.
                    if (dragActive) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (rect.width <= 0) return;
                    // Display-only chrome — a direct DOM write through the
                    // cursor channel, never the reducer: dispatching here
                    // committed the whole canvas once per pointer event (#609).
                    cursor.move((e.clientX - rect.left) / rect.width);
                }}
                onPointerLeave={() => { if (!dragActive) cursor.leave(); }}
                // A click on the plot names the bucket it fell in (#1197) — first,
                // so what was clicked in it selects the row after, the bucket kept.
                // An event's element selects its event instead; a strip is the way back.
                onClickCapture={(e: React.MouseEvent) => {
                    if (ctx === true || (e.target as Element).closest(PLAN_EVENT_ELEMENT_SELECTOR) !== null) return;
                    const bi = scale.bucketAtFrac(fracAt(e.clientX));
                    const bucket = bi >= 0 ? scale.buckets[bi] : undefined;
                    if (bucket !== undefined) dispatch({ t: "row.select", key: row.key, at: bucket.start });
                }}
            >
                {/* Under everything the plot draws after it — the rules, the marks, the now line (#1398, CL2). */}
                {unread === true && <LoadingWash />}
                {noGrid !== true && (
                    <GridSeparators styles={styles}
                        // A buckets row's lane rules lie under its day rules (#1735); a strip's and an expanded row's none.
                        lanes={row.kind.type === "buckets" && ctx !== true && !expanded ? row.kind.value.lanes.length : 0} />
                )}
                {drop !== undefined && (
                    <Box ref={previewRef} css={styles.dropPreview} data-plan-drop-preview>
                        {/* A moved element's span, where the band draws it (#825). */}
                        <Box as="span" ref={previewTextRef} css={styles.dropPreviewText} data-plan-drop-preview-text />
                    </Box>
                )}
                {/* Expanded: the row's own marks hold a band at the top (they
                    position against it, so a 20px bar in a 200px row does not
                    drift to the middle), and the render takes the rest. */}
                {expanded ? (
                    <>
                        <Box css={styles.expandRowBand} style={{ height: `${band}px` }}>{children}</Box>
                        <Box css={styles.expandRenderBody} data-plan-expandrender
                            style={{ top: `${band + 2}px` }}>
                            {expandBody}
                        </Box>
                    </>
                ) : children}
                {/* The shared hairline — positioned by the body's ONE
                    `--plan-cursor-x` variable and shown only under
                    `[data-plan-cursor]` (#609): a pointermove writes a style,
                    renders nothing. Strips carry no hairline. */}
                {ctx !== true && <Box css={styles.cursorLine} data-plan-cursorline />}
                {scale.nowFrac !== undefined && <NowLine styles={styles} at={scale.nowFrac} data-plan-axisline data-plan-now />}
            </Box>
        </Box>
    );
}
