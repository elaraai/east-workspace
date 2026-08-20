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
 * status icon with the message tooltip.
 */

import type { ReactNode } from "react";
import { Box, Portal, Tooltip } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCheck, faCircle, faCircleCheck, faCircleInfo, faCircleXmark, faGripVertical, faTriangleExclamation,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { runStateKey } from "./SpanRow.js";
import { ElementOverlays } from "./ElementOverlays.js";
import type { PlanBucket } from "../scale.js";

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
    kind: BucketsKindValue;
    styles: Styles;
    storageKey: string;
}

/** One event chip — the `.chk` / `.pchip` resting looks + labelled tiles. */
function EventChip({ ev, styles, rowKey, storageKey, ctx }: {
    ev: BucketEventValue; styles: Styles; rowKey: string; storageKey: string; ctx?: boolean | undefined;
}) {
    const dispatch = usePlanDispatch();
    const { onElementClick } = usePlanResolvers();
    const ref = variant("event", { row: rowKey, event: ev.key }) as PlanElementRefValue;
    const label = ev.label.type === "some" ? ev.label.value : undefined;
    const icon = ev.icon.type === "some" ? ev.icon.value : undefined;
    const stateKey = runStateKey(ev.state);
    const stretch = ev.stretch.type === "some" ? ev.stretch.value.type : undefined;
    const hFill = stretch === "horizontal" || stretch === "both";
    const vFill = stretch === "vertical" || stretch === "both";
    const justify = ev.content.type === "some" && ev.content.value.horizontal.type === "some"
        ? ev.content.value.horizontal.value.type : undefined;
    const color = ev.color.type === "some" ? ev.color.value : undefined;
    const chip = (
        <Box css={styles.tile}
            data-event={ev.key}
            data-ctx={ctx === true ? "" : undefined}
            data-state={stateKey}
            data-tone={ev.tone.type === "some" ? ev.tone.value.type : undefined}
            data-pulse={ev.animation.type === "some" && ev.animation.value.type === "pulse" ? "" : undefined}
            flex={hFill ? "1" : undefined}
            alignSelf={vFill ? "stretch" : undefined}
            height={vFill ? "auto" : undefined}
            justifyContent={justify}
            background={color !== undefined && !color.includes(".") ? color : undefined}
            backgroundColor={color !== undefined && color.includes(".") ? color : undefined}
            onClick={(e) => {
                e.stopPropagation();
                dispatch({ t: "row.select", key: rowKey });
                onElementClick?.(ref);
            }}
        >
            {icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />}
            {label !== undefined ? label
                : icon !== undefined ? null
                : stateKey === "prop" ? (<><FontAwesomeIcon icon={faGripVertical} />plan</>)
                : <FontAwesomeIcon icon={faCheck} />}
        </Box>
    );
    return (
        <ElementOverlays elementRef={ref} styles={styles}
            storageKey={`${storageKey}.${ev.key}`}>
            {chip}
        </ElementOverlays>
    );
}

/** The bucket-row plot content — the washed bucket × lane cell grid. */
export function BucketsRow({ rowKey, kind, styles, storageKey, ctx }: BucketsRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const lanes = kind.lanes;
    const laneCount = Math.max(1, lanes.length);
    // Lane key → index; absent/unknown lane ⇒ the full-cell mixed grammar.
    const laneIndex = (lane: LaneRef): number | undefined => {
        if (lanes.length === 0 || lane.type === "none") return undefined;
        const i = lanes.findIndex((l) => l.key === lane.value);
        return i >= 0 ? i : undefined;
    };

    // Group events + markers by (bucket, lane); lane: none ⇒ the full cell
    // (rendered as a spanning cell across all lanes). RENDER bucketing
    // (#619): overscan events land in overscan cells (out-of-range indices),
    // clipped at rest and revealed by a brush pan; interactions still speak
    // the window's `bucketOf`.
    const bucketByIndex = new Map<number, PlanBucket>();
    const renderIndexOf = (at: Date): number | undefined => {
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
        for (let li = 0; li < laneCount; li++) out.push(...(cellMarkers.get(`${bi}:${li}`) ?? []));
        return out;
    };

    // Cell geometry — 2px horizontal / per-lane vertical insets approximating
    // the Planner's 1px 2px cell margins + 3px lane padding.
    const cellX = (b: PlanBucket) => (
        { left: `calc(${b.x0 * 100}% + 2px)`, width: `calc(${(b.x1 - b.x0) * 100}% - 4px)` }
    );
    const laneY = (li: number, span: number = 1) => ({
        top: `calc(${(li / laneCount) * 100}% + 2px)`,
        height: `calc(${(span / laneCount) * 100}% - 4px)`,
    });

    const renderCell = (b: PlanBucket, li: number | undefined, events: BucketEventValue[], span: number = 1) => {
        const bi = b.index;
        const marker = worstMarker(li !== undefined ? cellMarkers.get(`${bi}:${li}`) ?? [] : bucketMarkers(bi));
        const lane = li !== undefined ? lanes[li] : undefined;
        const caption = lane !== undefined && lane.label.type === "some" ? lane.label.value : undefined;
        const cell = (
            <Box css={styles.cell}
                data-plan-cell={`${bi}:${li ?? "full"}`}
                data-over={marker !== undefined ? marker.status.type : undefined}
                {...cellX(b)}
                {...laneY(li ?? 0, li === undefined ? laneCount : span)}
                onClick={() => dispatch({ t: "row.select", key: rowKey })}
            >
                {caption !== undefined && ctx !== true && <Box css={styles.laneLabel}>{caption}</Box>}
                {events.map((ev) => (
                    <EventChip key={ev.key} ev={ev} styles={styles} rowKey={rowKey} storageKey={storageKey} ctx={ctx} />
                ))}
                {marker !== undefined && (
                    <Tooltip.Root openDelay={150}>
                        <Tooltip.Trigger asChild>
                            <Box css={styles.markerIcon} data-status={marker.status.type}>
                                <FontAwesomeIcon icon={STATUS_ICON[marker.status.type] ?? faCircleInfo} />
                            </Box>
                        </Tooltip.Trigger>
                        <Portal>
                            <Tooltip.Positioner>
                                <Tooltip.Content>{marker.message}</Tooltip.Content>
                            </Tooltip.Positioner>
                        </Portal>
                    </Tooltip.Root>
                )}
            </Box>
        );
        return <Box as="span" key={`c${bi}:${li ?? "full"}`} display="contents">{cell}</Box>;
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
    // The wash spans the RENDER bounds (#620): the #619 overscan periods wear
    // the same empty-cell wash, clipped at rest, so a brush pan reveals washed
    // cells rather than bare row. Uniform buckets ⇒ the overscan tiles at the
    // same width, so the tile is 1/(window + overscan periods) of the wider
    // element and the phase still lands on bucket edges.
    const nOver = n + scale.overscan.length;
    const washSpan = scale.renderMax - scale.renderMin;
    for (let li = 0; li < laneCount; li++) {
        if (uniform && !laneCaptioned(li)) {
            cells.push(
                <Box key={`wash-${li}`} css={styles.cellWash} data-plan-cellwash={li}
                    {...laneY(li)}
                    style={{
                        left: `${(scale.renderMin * 100).toFixed(4)}%`,
                        width: `${(washSpan * 100).toFixed(4)}%`,
                        backgroundImage: `repeating-linear-gradient(to right, transparent 0 2px, var(--chakra-colors-bg-panel) 2px calc(100% / ${nOver} - 2px), transparent calc(100% / ${nOver} - 2px) calc(100% / ${nOver}))`,
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
            for (let li = 0; li < laneCount; li++) laned.push(...(cellEvents.get(`${bi}:${li}`) ?? []));
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
