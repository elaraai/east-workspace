/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Bucket rows (`Plan Spec.md` §4·K2) — the Planner `.pcell` grid, verbatim:
 * one washed sub-cell per bucket × lane (lanes stack; `lane: none` in a laned
 * row takes the full cell — the mixed grammar), content flowing inline from
 * the left: the per-cell lane caption, then the event chips. The resting
 * looks are the Planner's — a solid ink ✓ chip for confirmed/actual, the
 * grip-prefixed dashed `plan` chip for proposals; labelled tiles keep the
 * lifecycle axis. A marker rings its CELL (`data-over`) and pins the corner
 * status icon, whose message is its accessible name and the canvas's one
 * tooltip (#816).
 *
 * A tile is a button named by its label, bucket, lane and state (#819) — the
 * ✓ and dashed `plan` chips say their state only by look.
 *
 * A tile is never wider than the room its cell leaves it — the cell's, less
 * its lane caption: the tiles sit in a box of their own beside it — and draws
 * its icon and its label — a labelled tile's, or a resting proposal's `plan` —
 * each whole or not at all (#1266): the recipe lays them on one line and moves
 * off it what has no room there. A hidden or ellipsized label is said by its
 * hover, in the canvas's tooltip.
 *
 * A cell with more tiles than it has room for shows the tiles that fit, each
 * drawn whole, and a `+n` chip whose menu lists the rest (#1267,
 * `BucketCell.tsx`): a folded tile is out of the row's walk, which reaches the
 * chip in its place.
 *
 * On a row whose series declares a move's fields (#825) a tile moves to
 * another bucket, or another row of its item type; it has one instant, so no
 * end to drag. An event kind's tile moves its event (#1196), and wears the
 * brand tint in a brand border while its drafts change it (`data-draft`).
 */

import { useContext, useMemo, type ReactNode } from "react";
import { Box, useChakraContext } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCheck, faCircle, faCircleCheck, faCircleInfo, faCircleXmark, faGripVertical, faTriangleExclamation,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { resolveColor } from "@elaraai/east-ui-components/internal";
import { usePlanDispatch, usePlanScale, type PlanElementRefValue } from "../context.js";
import { runStateKey, type PlanRowMove } from "./SpanRow.js";
import { usePlanElementSelect } from "./element-select.js";
import { usePlanElementOverlap } from "./element-overlap.js";
import { PlanDraftedContext, usePlanElementDrafted } from "./element-draft.js";
import { BucketCell, type BucketCellTile } from "./BucketCell.js";
import { usePlanMovable } from "../edit/movable.js";
import type { PlanMovable } from "../edit/store.js";
import type { PlanBucket } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { appendAll } from "../reductions.js";
import { tileName } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";
import { PLAN_CELL_INSET } from "../geometry.js";

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

/** One event chip — the `.chk` / `.pchip` resting looks + labelled tiles. */
function EventChip({ ev, styles, rowKey, rowId, ctx, bucket, lane, move, folded }: {
    ev: BucketEventValue; styles: Styles; rowKey: string; rowId: PlanRowId; ctx?: boolean | undefined;
    /** The bucket the tile renders in — its place in the row's time order (#819). */
    bucket: PlanBucket;
    /** Its lane's caption, when the lane has one. */
    lane: string | undefined;
    /** How it moves (#825). */
    move: PlanRowMove | undefined;
    /** Folded into its cell's `+n` (#1267): out of sight, and out of the row's walk. */
    folded: boolean;
}) {
    const system = useChakraContext();
    const scale = usePlanScale();
    const words = usePlanWords();
    const ref = variant("event", { row: rowId, event: ev.key }) as PlanElementRefValue;
    // An event's tile selects its event (#1197); any other tile, its row.
    const select = usePlanElementSelect(rowKey, ev.key, ref);
    // An event in an overlap pair wears the warn ring (#1198).
    const overlap = usePlanElementOverlap(ev.key);
    // An event its drafts changed wears the brand tint in a brand border (#1196).
    const drafted = usePlanElementDrafted(ev.key);
    const label = ev.label.type === "some" ? ev.label.value : undefined;
    // A tile has one instant — its extent is that instant twice.
    const movable = useMemo<PlanMovable | undefined>(() => (move !== undefined
        ? { rowKey, key: ev.key, label: label ?? ev.key, kind: "tile", span: { start: ev.at, end: ev.at }, items: move.items, resize: false }
        : undefined), [move, rowKey, ev, label]);
    const { handle, carried } = usePlanMovable(movable);
    const icon = ev.icon.type === "some" ? ev.icon.value : undefined;
    const stateKey = runStateKey(ev.state);
    const stretch = ev.stretch.type === "some" ? ev.stretch.value.type : undefined;
    const hFill = stretch === "horizontal" || stretch === "both";
    const vFill = stretch === "vertical" || stretch === "both";
    const justify = ev.content.type === "some" && ev.content.value.horizontal.type === "some"
        ? ev.content.value.horizontal.value.type : undefined;
    const color = ev.color.type === "some" ? ev.color.value : undefined;
    return (
        <Box css={styles.tile}
            data-event={ev.key}
            data-plan-frac={bucket.x0.toFixed(4)}
            // Focusable: Enter opens its popover (#816), and the row's Tab
            // walk reaches it (#819).
            tabIndex={-1}
            role="button"
            aria-label={tileName(ev, bucket, lane, scale, words)}
            data-ctx={ctx === true ? "" : undefined}
            data-state={stateKey}
            data-tone={ev.tone.type === "some" ? ev.tone.value.type : undefined}
            data-overlap={overlap ? "" : undefined}
            data-draft={drafted ? "" : undefined}
            data-folded={folded ? "" : undefined}
            data-pulse={ev.animation.type === "some" && ev.animation.value.type === "pulse" ? "" : undefined}
            flex={hFill ? "1" : undefined}
            // Stretch is a style PROP and outranks the recipe: in a strip
            // neither is set, or a `vertical` tile fills the lane instead of
            // dropping to the `tile[data-ctx]` 7px mark (#591).
            alignSelf={vFill && ctx !== true ? "stretch" : undefined}
            height={vFill && ctx !== true ? "auto" : undefined}
            justifyContent={justify}
            // A theme token or raw CSS — the system says which (#817).
            background={color !== undefined ? resolveColor(system, color) : undefined}
            {...handle}
            // Carried by the keyboard (#825) — dimmed as a dragged origin is.
            data-dragging={carried ? "" : undefined}
            data-selected={select.selected ? "" : undefined}
            aria-pressed={select.selectable ? select.selected : undefined}
            onClick={select.onClick}
        >
            {icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} data-plan-icon="" />}
            {label !== undefined ? <Box as="span" css={styles.tileLabel} data-plan-label="">{label}</Box>
                : icon !== undefined ? null
                : stateKey === "prop" ? (
                    <>
                        <FontAwesomeIcon icon={faGripVertical} data-plan-icon="" />
                        <Box as="span" css={styles.tileLabel} data-plan-label="">{words.m.planChip()}</Box>
                    </>
                )
                : <FontAwesomeIcon icon={faCheck} data-plan-icon="" />}
        </Box>
    );
}

/** The bucket-row plot content — the washed bucket × lane cell grid. */
export function BucketsRow({ rowKey, rowId, kind, styles, ctx, move }: BucketsRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    // The events a draft changed: a drafted tile's border sizes it, so its cell measures again (#1267).
    const drafted = useContext(PlanDraftedContext);
    const lanes = kind.lanes;
    const laneCount = Math.max(1, lanes.length);
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

    // Cell geometry — the cell inset each side, horizontally and per lane,
    // approximating the Planner's 1px 2px cell margins + 3px lane padding; a
    // link meets the cell by the same inset (#1258).
    const cellX = (b: PlanBucket) => (
        { left: `calc(${b.x0 * 100}% + ${PLAN_CELL_INSET}px)`, width: `calc(${(b.x1 - b.x0) * 100}% - ${2 * PLAN_CELL_INSET}px)` }
    );
    const laneY = (li: number, span: number = 1) => ({
        top: `calc(${(li / laneCount) * 100}% + ${PLAN_CELL_INSET}px)`,
        height: `calc(${(span / laneCount) * 100}% - ${2 * PLAN_CELL_INSET}px)`,
    });

    const renderCell = (b: PlanBucket, li: number | undefined, events: BucketEventValue[], span: number = 1) => {
        const bi = b.index;
        const cellKey = `${bi}:${li ?? "full"}`;
        const marker = worstMarker(li !== undefined ? cellMarkers.get(`${bi}:${li}`) ?? [] : bucketMarkers(bi));
        const lane = li !== undefined ? lanes[li] : undefined;
        const caption = lane !== undefined && lane.label.type === "some" ? lane.label.value : undefined;
        // Each tile drawn folded or not, and named for the chip's menu as a reader hears it (#819).
        const tiles = events.map((ev): BucketCellTile => {
            const tileLane = laneCaption(ev.lane);
            return {
                key: ev.key,
                name: tileName(ev, b, tileLane, scale, words),
                draw: (folded) => (
                    <EventChip key={ev.key} ev={ev} styles={styles} rowKey={rowKey} rowId={rowId} ctx={ctx}
                        bucket={b} lane={tileLane} move={move} folded={folded} />
                ),
            };
        });
        // What sizes the tiles: each one's key, label, icon and state, and whether a draft changed it.
        const signature = events.map((ev) => [
            ev.key, ev.label.type === "some" ? ev.label.value : "", ev.icon.type === "some" ? ev.icon.value.name : "",
            runStateKey(ev.state), drafted.has(ev.key) ? "draft" : "",
        ].join("\u0000")).join("\u0001");
        return (
            <Box as="span" key={`c${cellKey}`} display="contents">
                <BucketCell styles={styles} rowKey={rowKey} cellKey={cellKey}
                    place={{ ...cellX(b), ...laneY(li ?? 0, li === undefined ? laneCount : span) }}
                    over={marker !== undefined ? marker.status.type : undefined}
                    caption={caption !== undefined && ctx !== true ? <Box css={styles.laneLabel}>{caption}</Box> : null}
                    tiles={tiles}
                    marker={marker !== undefined ? (
                        <Box css={styles.markerIcon} data-status={marker.status.type}
                            data-marker={cellKey} role="img" aria-label={marker.message}>
                            <FontAwesomeIcon icon={STATUS_ICON[marker.status.type] ?? faCircleInfo} />
                        </Box>
                    ) : null}
                    // A context strip's tiles are marks with no text: they never fold.
                    folds={events.length > 1 && ctx !== true}
                    frac={b.x0} bucket={scale.bucketText(b)} lane={caption} words={words}
                    onClick={() => dispatch({ t: "row.select", key: rowKey })}
                    signature={signature} />
            </Box>
        );
    };

    // ── Occupied-only mounting (#616) ─────────────────────────────────────
    // A cell per bucket × lane is O(buckets × lanes) DOM whether or not
    // anything is in it — 500 hour buckets used to mount 500+ divs per row.
    // For an EQUAL-bucKET lane with no caption, the empty-cell wash paints as
    // ONE gradient band (`cellWash`) and real cells mount only where content,
    // a caption or a marker exists. A captioned lane prints its caption in
    // every cell (the Planner `.bl`), and unequal buckets (month / quarter,
    // low counts) keep the full grid — both fall back to mounting all.
    const n = scale.buckets.length;
    const w0 = n > 0 ? scale.buckets[0]!.x1 - scale.buckets[0]!.x0 : 0;
    const uniform = n > 1 && scale.buckets.every((b) => Math.abs((b.x1 - b.x0) - w0) < 1e-9);
    const laneCaptioned = (li: number): boolean => {
        const lane = lanes[li];
        return lane !== undefined && lane.label.type === "some";
    };
    const cells: ReactNode[] = [];
    for (let li = 0; li < laneCount; li++) {
        if (uniform && !laneCaptioned(li)) {
            cells.push(
                <Box key={`wash-${li}`} css={styles.cellWash} data-plan-cellwash={li}
                    {...laneY(li)}
                    style={{
                        backgroundImage: `repeating-linear-gradient(to right, transparent 0 2px, var(--chakra-colors-bg-panel) 2px calc(100% / ${n} - 2px), transparent calc(100% / ${n} - 2px) calc(100% / ${n}))`,
                    }} />,
            );
        }
    }
    const mountBucket = (b: PlanBucket, occupiedOnly: boolean) => {
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
            if (!occupied && (occupiedOnly || (uniform && !laneCaptioned(li)))) continue;
            cells.push(renderCell(b, li, events));
        }
    };
    for (const b of scale.buckets) mountBucket(b, false);
    // Overscan cells (#619) — occupied ONLY, always: the wash and the caption
    // grid belong to the window; an overscan cell exists to slide real
    // content in under a brush pan.
    for (const [bi, b] of bucketByIndex) {
        if (bi < 0 || bi >= scale.buckets.length) mountBucket(b, true);
    }
    return <>{cells}</>;
}
