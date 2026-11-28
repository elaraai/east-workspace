/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Bucket rows (`Plan Spec.md` §4·K2), to the task tiles' spec (#1735): a cell
 * per day × lane, the day's room in the lane's — a day's rule its last pixel,
 * a lane 24 of room and its rule (`lanes.ts`), the rules drawn under the row
 * by `GridSeparators` — every edge on a whole pixel of the plot the row
 * measures before it paints. `lane: none` in a laned row takes the whole day
 * across the lanes — the mixed grammar. A cell's tiles stand in its slots —
 * the day whole, halves or quarters, from five three and a `+n` chip whose
 * menu lists the rest (`BucketCell.tsx`) — 20 tall, 2px inside every rule. A
 * marker rings its CELL (`data-over`) and pins the corner status icon, whose
 * message is its accessible name and the canvas's one tooltip (#816).
 *
 * A tile is a button named by its label, bucket, lane and state (#819). Its
 * parts — its lock, its icon, its label — stand from its left, 6px in, each
 * whole or not at all, dropped from the end where the tile has no room for
 * them (#1266): the recipe lays them on one line and moves off it what has no
 * room there, and its hover says a hidden label in the canvas's tooltip. An
 * observed tile is done: the check its icon (ruled 23 Nov 2026). A resting
 * proposal with nothing to say draws its grip and `plan`; a confirmed one the
 * check in its ink.
 *
 * On a row whose series declares a move's fields (#825) a tile moves to
 * another bucket, or another row of its item type; it has one instant, so no
 * end to drag. An event kind's tile moves its event (#1196), and wears the
 * brand tint in a brand border while its drafts change it (`data-draft`). A
 * locked tile (#1541, U9) leads with a lock and takes no move.
 *
 * Every part is a plain element of its slot's class, made once a theme
 * (`useSlotClass`, #1780): a tile mounting works no style out. Where its author
 * stands a tile's parts across is the recipe's (`data-justify`); its author's
 * colour is the tile's own style, over every look the recipe gives it.
 */

import { Fragment, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useChakraContext } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCheck, faCircle, faCircleCheck, faCircleInfo, faCircleXmark, faGripVertical, faLock, faTriangleExclamation,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { resolveColor, useSlotClass } from "@elaraai/east-ui-components/internal";
import { usePlanDispatch, usePlanGeometry, usePlanScale, type PlanElementRefValue } from "../context.js";
import { runStateKey, type PlanRowMove } from "./SpanRow.js";
import { usePlanElementSelect } from "./element-select.js";
import { usePlanElementOverlap } from "./element-overlap.js";
import { usePlanElementBounded, usePlanElementConflicted, usePlanElementDrafted } from "./element-draft.js";
import { usePlanElementOp } from "./element-optimise.js";
import { BucketCell, type BucketCellTile } from "./BucketCell.js";
import { usePlanMovable } from "../edit/movable.js";
import { laneBand, laneRooms, laneSpan } from "./lanes.js";
import { dayRoom } from "./bucket-slots.js";
import { useLaidOutSize } from "../../shared/use-laid-out-size.js";
import type { PlanMovable } from "../edit/store.js";
import type { PlanBucket } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { appendAll } from "../reductions.js";
import { tileName } from "../a11y.js";
import { statusAttributes } from "../../shared/status.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;
type BucketsKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "buckets" }>["value"];
type BucketEventValue = BucketsKindValue["events"][number];
type MarkerValue = BucketsKindValue["markers"][number];
type LaneRef = BucketEventValue["lane"];

/** Status tag → paired FA icon — mirrors the Planner marker so a Plan cell
 *  marker reads the same as a Planner one. */
const STATUS_ICON: Record<string, IconDefinition> = {
    success: faCircleCheck,
    warning: faTriangleExclamation,
    danger:  faCircleXmark,
    info:    faCircleInfo,
    neutral: faCircle,
};

export interface BucketsRowProps {
    /** R2 context strip (#591) — render this row's marks at strip size. */
    ctx?: boolean | undefined;

    rowKey: string;
    /** The row's id — what an element click names the row by (#822). */
    rowId: PlanRowId;
    kind: BucketsKindValue;
    styles: Styles;
    /** How its tiles move (#825) — `undefined` when they do not. */
    move?: PlanRowMove | undefined;
}

/** One tile (#1735): at its slot of its cell, its state's look, its parts from its left. */
function EventChip({ ev, styles, rowKey, rowId, ctx, bucket, lane, move, folded, place }: {
    ev: BucketEventValue; styles: Styles; rowKey: string; rowId: PlanRowId; ctx?: boolean | undefined;
    /** The bucket the tile renders in — its place in the row's time order (#819). */
    bucket: PlanBucket;
    /** Its lane's caption, when the lane has one. */
    lane: string | undefined;
    /** How it moves (#825). */
    move: PlanRowMove | undefined;
    /** Folded into its cell's `+n` (#1267): out of sight, and out of the row's walk. */
    folded: boolean;
    /** Where it stands in its cell — its slot (`BucketCell`); none for a mark across the cell, which the recipe places. */
    place: CSSProperties | undefined;
}) {
    const system = useChakraContext();
    const scale = usePlanScale();
    const words = usePlanWords();
    const slot = useSlotClass();
    const ref = variant("event", { row: rowId, event: ev.key }) as PlanElementRefValue;
    // An event's tile selects its event (#1197); any other tile, its row.
    const select = usePlanElementSelect(rowKey, ev.key, ref);
    // An event in an overlap pair wears the warn ring (#1198).
    const overlap = usePlanElementOverlap(ev.key);
    // An event its drafts changed wears the brand tint in a brand border (#1196).
    const drafted = usePlanElementDrafted(ev.key);
    const conflict = usePlanElementConflicted(ev.key);
    // An event whose row breaks its kind's bounds wears the warn ring too, stored or changed (#1585).
    const bounds = usePlanElementBounded(ev.key);
    // What a run of the optimiser did to its event (#1409, R17), while it is still the run's draft.
    const op = usePlanElementOp(ev.key);
    const optimised = drafted ? op : undefined;
    const label = ev.label.type === "some" ? ev.label.value : undefined;
    // A tile has one instant — its extent is that instant twice.
    // A locked tile takes no move (#1541, U9).
    const movable = useMemo<PlanMovable | undefined>(() => (move !== undefined && !ev.locked
        ? { rowKey, key: ev.key, label: label ?? ev.key, kind: "tile", span: { start: ev.at, end: ev.at }, items: move.items, resize: false, lane: getSomeorUndefined(ev.lane) }
        : undefined), [move, rowKey, ev, label]);
    const { handle, carried } = usePlanMovable(movable);
    const icon = ev.icon.type === "some" ? ev.icon.value : undefined;
    const stateKey = runStateKey(ev.state);
    // An observed tile is done (ruled 23 Nov 2026): the check its icon. One in progress, observed too, keeps its own look.
    const done = ev.state.type === "actual";
    const progress = ev.state.type === "in-progress";
    // Across, a tile fills its slot whatever it asks (#1735): only a stretch down is the tile's to say.
    const stretch = ev.stretch.type === "some" ? ev.stretch.value.type : undefined;
    const vFill = stretch === "vertical" || stretch === "both";
    const justify = ev.content.type === "some" && ev.content.value.horizontal.type === "some"
        ? ev.content.value.horizontal.value.type : undefined;
    const color = ev.color.type === "some" ? ev.color.value : undefined;
    return (
        <div className={slot(styles.tile)}
            data-event={ev.key}
            data-plan-frac={bucket.x0.toFixed(4)}
            // Focusable: Enter opens its popover (#816), and the row's Tab
            // walk reaches it (#819).
            tabIndex={-1}
            role="button"
            aria-label={tileName(ev, bucket, lane, scale, words)}
            data-ctx={ctx === true ? "" : undefined}
            data-state={stateKey}
            data-done={done ? "" : undefined}
            data-progress={progress ? "" : undefined}
            // Its slot of its cell — computed geometry — and its author's colour, a theme token or raw CSS, which the
            // system says (#817): its own, over its state's look and every other the recipe's layer gives it.
            style={color !== undefined ? { ...place, background: resolveColor(system, color) } : place}
            // Its status (#1541): its tone's ring, and the open ring a tentative one draws as.
            {...statusAttributes(getSomeorUndefined(ev.status))}
            data-overlap={overlap ? "" : undefined}
            data-draft={drafted ? "" : undefined}
            data-conflict={conflict ? "" : undefined}
            data-bounds={bounds ? "" : undefined}
            data-op={optimised?.op}
            data-fill={optimised !== undefined ? "own" : undefined}
            title={optimised?.provenance}
            data-folded={folded ? "" : undefined}
            data-locked={ev.locked ? "" : undefined}
            data-pulse={ev.animation.type === "some" && ev.animation.value.type === "pulse" ? "" : undefined}
            // A tile fills its slot across (#1735); stretched down, its lane's room, 2px inside its rules — never in a
            // strip, where it is the `tile[data-ctx]` 7px mark (#591).
            data-stretch={vFill && ctx !== true ? "" : undefined}
            data-justify={justify}
            {...handle}
            // Carried by the keyboard (#825) — dimmed as a dragged origin is.
            data-dragging={carried ? "" : undefined}
            data-selected={select.selected ? "" : undefined}
            aria-pressed={select.selectable ? select.selected : undefined}
            onClick={select.onClick}
        >
            {/* Its lock (#1541, U9), its first part: the last a tile short of room gives up. */}
            {ev.locked && <FontAwesomeIcon icon={faLock} data-plan-lock="" />}
            {/* Done, the check is its icon (#1735): a quarter with no room for its label keeps it. */}
            {done ? <FontAwesomeIcon icon={faCheck} data-plan-icon="" data-plan-done="" />
                : icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} data-plan-icon="" />}
            {label !== undefined ? <span className={slot(styles.tileLabel)} data-plan-label="">{label}</span>
                : done || icon !== undefined ? null
                : stateKey === "prop" ? (
                    <>
                        <FontAwesomeIcon icon={faGripVertical} data-plan-icon="" />
                        <span className={slot(styles.tileLabel)} data-plan-label="">{words.m.planChip()}</span>
                    </>
                )
                : <FontAwesomeIcon icon={faCheck} data-plan-icon="" />}
        </div>
    );
}

/** The bucket-row plot content — the day × lane cells, their tiles in slots (#1735). */
export function BucketsRow({ rowKey, rowId, kind, styles, ctx, move }: BucketsRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const geometry = usePlanGeometry();
    const slot = useSlotClass();
    const lanes = kind.lanes;
    const laneCount = Math.max(1, lanes.length);
    // The plot as laid out, before the browser paints (#1735): every cell's edge on one of its whole pixels.
    const measureRef = useRef<HTMLDivElement | null>(null);
    const size = useLaidOutSize(measureRef, true);
    // The plot is its row less the row's rule: the lanes share the row's height.
    const rooms = useMemo(() => (size === undefined ? undefined : laneRooms(size.height + 1, laneCount)), [size, laneCount]);
    // Lane key → index; absent/unknown lane ⇒ the full-cell mixed grammar.
    const laneIndex = (lane: LaneRef): number | undefined => {
        if (lanes.length === 0 || lane.type === "none") return undefined;
        const i = lanes.findIndex((l) => l.key === lane.value);
        return i >= 0 ? i : undefined;
    };
    // A tile's own lane caption — what its accessible name says (#819), even
    // in a spanned bucket where its lane has no row of its own.
    const laneCaption = (lane: LaneRef): string | undefined => {
        const li = laneIndex(lane);
        const l = li !== undefined ? lanes[li] : undefined;
        return l !== undefined && l.label.type === "some" ? l.label.value : undefined;
    };

    // Group events + markers by (bucket, lane); lane: none ⇒ the full cell
    // (rendered as a spanning cell across all lanes). RENDER bucketing
    // (#619): overscan events land in overscan cells (out-of-range indices),
    // clipped at rest and revealed by a brush pan; interactions still speak
    // the window's `bucketOf`.
    const bucketByIndex = new Map<number, PlanBucket>();
    const renderIndexOf = (at: PlanInstantValue): number | undefined => {
        const b = scale.renderBucketOf(at);
        if (b === undefined) return undefined;
        bucketByIndex.set(b.index, b);
        return b.index;
    };
    const cellEvents = new Map<string, BucketEventValue[]>();
    const fullCellEvents = new Map<number, BucketEventValue[]>();
    for (const ev of kind.events) {
        const bi = renderIndexOf(ev.at);
        if (bi === undefined) continue;
        const li = laneIndex(ev.lane);
        if (li === undefined && lanes.length > 0) {
            const list = fullCellEvents.get(bi);
            if (list !== undefined) list.push(ev);
            else fullCellEvents.set(bi, [ev]);
        } else {
            const key = `${bi}:${li ?? 0}`;
            const list = cellEvents.get(key);
            if (list !== undefined) list.push(ev);
            else cellEvents.set(key, [ev]);
        }
    }
    const cellMarkers = new Map<string, MarkerValue[]>();
    for (const m of kind.markers) {
        const bi = renderIndexOf(m.at);
        if (bi === undefined) continue;
        const li = laneIndex(m.lane) ?? 0;
        const list = cellMarkers.get(`${bi}:${li}`);
        if (list !== undefined) list.push(m);
        else cellMarkers.set(`${bi}:${li}`, [m]);
    }
    // Two markers on one cell: the WORST status wins the ring and the corner
    // icon — a cell has exactly one of each, and hiding a danger under an
    // info would be the wrong resolution in every canvas (#615).
    const MARKER_RANK: Record<string, number> = { neutral: 0, info: 1, success: 2, warning: 3, danger: 4 };
    const worstMarker = (ms: readonly MarkerValue[]): MarkerValue | undefined =>
        ms.length === 0 ? undefined : ms.reduce((a, b) =>
            ((MARKER_RANK[b.status.type] ?? 0) > (MARKER_RANK[a.status.type] ?? 0) ? b : a));
    // The spanning full-cell shows the whole BUCKET's markers — a lane-less
    // event taking the cell must not hide a lane's marker with it (#615).
    const bucketMarkers = (bi: number): MarkerValue[] => {
        const out: MarkerValue[] = [];
        for (let li = 0; li < laneCount; li++) appendAll(out, cellMarkers.get(`${bi}:${li}`) ?? []);
        return out;
    };

    // A cell is the day's room in its lane's (#1735): from the day's start to the pixel before its rule — every day's
    // end rounded to a whole pixel of the plot — and from its lane's top through its room; a tile stands centred in it,
    // on a whole pixel. Unmeasured (jsdom), by their shares of the plot.
    const cellX = (b: PlanBucket): CSSProperties => {
        if (size === undefined) return { left: `${b.x0 * 100}%`, width: `calc(${(b.x1 - b.x0) * 100}% - 1px)` };
        const room = dayRoom(b.x0, b.x1, size.width);
        return { left: `${room.left}px`, width: `${room.width}px` };
    };
    const laneY = (li: number, span: number = 1): CSSProperties => {
        const band = rooms === undefined ? undefined : laneSpan(rooms, li, span);
        if (band === undefined) {
            const share = laneBand(li, laneCount, span);
            return { top: `${share.top * 100}%`, height: `calc(${share.height * 100}% - 1px)` };
        }
        return { top: `${band.top}px`, height: `${band.height}px`, "--plan-tile-top": `${Math.floor((band.height - geometry.tile) / 2)}px` } as CSSProperties;
    };

    const renderCell = (b: PlanBucket, li: number | undefined, events: BucketEventValue[], span: number = 1) => {
        const bi = b.index;
        const cellKey = `${bi}:${li ?? "full"}`;
        const marker = worstMarker(li !== undefined ? cellMarkers.get(`${bi}:${li}`) ?? [] : bucketMarkers(bi));
        // The lane's caption is said by the cell's chip and its tiles' names; its gutter line draws it (#1680's review).
        const lane = li !== undefined ? lanes[li] : undefined;
        const caption = lane !== undefined && lane.label.type === "some" ? lane.label.value : undefined;
        // Each tile drawn at its slot or folded, and named for the chip's menu as a reader hears it (#819).
        const tiles = events.map((ev): BucketCellTile => {
            const tileLane = laneCaption(ev.lane);
            return {
                key: ev.key,
                name: tileName(ev, b, tileLane, scale, words),
                draw: (folded, place) => (
                    <EventChip key={ev.key} ev={ev} styles={styles} rowKey={rowKey} rowId={rowId} ctx={ctx}
                        bucket={b} lane={tileLane} move={move} folded={folded} place={place} />
                ),
            };
        });
        return (
            <Fragment key={`c${cellKey}`}>
                <BucketCell styles={styles} rowKey={rowKey} cellKey={cellKey}
                    place={{ ...cellX(b), ...laneY(li ?? 0, li === undefined ? laneCount : span) }}
                    over={marker !== undefined ? marker.status.type : undefined}
                    tiles={tiles}
                    marker={marker !== undefined ? (
                        <div className={slot(styles.markerIcon)} data-status={marker.status.type}
                            data-marker={cellKey} role="img" aria-label={marker.message}>
                            <FontAwesomeIcon icon={STATUS_ICON[marker.status.type] ?? faCircleInfo} />
                        </div>
                    ) : null}
                    // A context strip's tiles are marks with no text: they never fold. Any other cell's tiles stand
                    // in its slots, and fold where it has none for them — a lone tile too, where it has no room (#1276).
                    folds={events.length > 0 && ctx !== true}
                    // The day's pitch in whole pixels — its room and its rule — so every tile stands 2px inside its rules,
                    // whichever way the day's edges round.
                    pitch={size === undefined ? undefined : dayRoom(b.x0, b.x1, size.width).width + 1}
                    frac={b.x0} bucket={scale.bucketText(b)} lane={caption} words={words}
                    onClick={() => dispatch({ t: "row.select", key: rowKey })} />
            </Fragment>
        );
    };

    // ── Occupied-only mounting (#616) ─────────────────────────────────────
    // A cell per bucket × lane is O(buckets × lanes) DOM whether or not
    // anything is in it — 500 hour buckets used to mount 500+ divs per row. A
    // cell draws no wash of its own (#1735): the rules under the row are the
    // grid, so a cell mounts only where content or a marker is — a lane's
    // caption is its gutter line's (#1680's review), never a cell's.
    const cells: ReactNode[] = [
        <div key="measure" ref={measureRef} className={slot(styles.cellsMeasure)} data-plan-cells-measure="" aria-hidden="true" />,
    ];
    const mountBucket = (b: PlanBucket) => {
        const bi = b.index;
        const full = fullCellEvents.get(bi);
        if (full !== undefined) {
            // The mixed grammar: a lane-less event in a laned row takes the
            // whole cell across lanes. Lane-assigned chips in the SAME bucket
            // still render — they flow after the spanning chips, in lane
            // order. Their lane position is not representable inside a
            // spanned bucket, but a dropped event is worse than a
            // repositioned one (#615).
            const laned: BucketEventValue[] = [];
            for (let li = 0; li < laneCount; li++) appendAll(laned, cellEvents.get(`${bi}:${li}`) ?? []);
            cells.push(renderCell(b, undefined, [...full, ...laned]));
            return;
        }
        for (let li = 0; li < laneCount; li++) {
            const events = cellEvents.get(`${bi}:${li}`) ?? [];
            const occupied = events.length > 0 || (cellMarkers.get(`${bi}:${li}`)?.length ?? 0) > 0;
            if (!occupied) continue;
            cells.push(renderCell(b, li, events));
        }
    };
    for (const b of scale.buckets) mountBucket(b);
    // Overscan cells (#619): an overscan cell exists to slide real content in under a brush pan.
    for (const [bi, b] of bucketByIndex) {
        if (bi < 0 || bi >= scale.buckets.length) mountBucket(b);
    }
    return <>{cells}</>;
}
