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
import { usePlanDispatch, usePlanScale, type PlanElementRefValue } from "../context.js";
import { runStateKey } from "./SpanRow.js";
import { ElementOverlays } from "./ElementOverlays.js";

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
    rowKey: string;
    kind: BucketsKindValue;
    styles: Styles;
    storageKey: string;
}

/** One event chip — the `.chk` / `.pchip` resting looks + labelled tiles. */
function EventChip({ ev, styles, rowKey, storageKey }: {
    ev: BucketEventValue; styles: Styles; rowKey: string; storageKey: string;
}) {
    const dispatch = usePlanDispatch();
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
            data-state={stateKey}
            data-tone={ev.tone.type === "some" ? ev.tone.value.type : undefined}
            data-pulse={ev.animation.type === "some" && ev.animation.value.type === "pulse" ? "" : undefined}
            flex={hFill ? "1" : undefined}
            alignSelf={vFill ? "stretch" : undefined}
            height={vFill ? "auto" : undefined}
            justifyContent={justify}
            background={color !== undefined && !color.includes(".") ? color : undefined}
            backgroundColor={color !== undefined && color.includes(".") ? color : undefined}
            onClick={(e) => { e.stopPropagation(); dispatch({ t: "row.select", key: rowKey }); }}
        >
            {icon !== undefined && <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />}
            {label !== undefined ? label
                : icon !== undefined ? null
                : stateKey === "prop" ? (<><FontAwesomeIcon icon={faGripVertical} />plan</>)
                : <FontAwesomeIcon icon={faCheck} />}
        </Box>
    );
    return (
        <ElementOverlays elementRef={variant("event", { row: rowKey, event: ev.key }) as PlanElementRefValue}
            storageKey={`${storageKey}.${ev.key}`}>
            {chip}
        </ElementOverlays>
    );
}

/** The bucket-row plot content — the washed bucket × lane cell grid. */
export function BucketsRow({ rowKey, kind, styles, storageKey }: BucketsRowProps) {
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
    // (rendered as a spanning cell across all lanes).
    const cellEvents = new Map<string, BucketEventValue[]>();
    const fullCellEvents = new Map<number, BucketEventValue[]>();
    for (const ev of kind.events) {
        const bi = scale.bucketOf(ev.at);
        if (bi < 0) continue;
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
    const cellMarkers = new Map<string, MarkerValue>();
    for (const m of kind.markers) {
        const bi = scale.bucketOf(m.at);
        if (bi < 0) continue;
        const li = laneIndex(m.lane) ?? 0;
        cellMarkers.set(`${bi}:${li}`, m);
    }

    // Cell geometry — 2px horizontal / per-lane vertical insets approximating
    // the Planner's 1px 2px cell margins + 3px lane padding.
    const cellX = (bi: number) => {
        const b = scale.buckets[bi]!;
        return { left: `calc(${b.x0 * 100}% + 2px)`, width: `calc(${(b.x1 - b.x0) * 100}% - 4px)` };
    };
    const laneY = (li: number, span: number = 1) => ({
        top: `calc(${(li / laneCount) * 100}% + 2px)`,
        height: `calc(${(span / laneCount) * 100}% - 4px)`,
    });

    const renderCell = (bi: number, li: number | undefined, events: BucketEventValue[], span: number = 1) => {
        const marker = li !== undefined ? cellMarkers.get(`${bi}:${li}`) : undefined;
        const lane = li !== undefined ? lanes[li] : undefined;
        const caption = lane !== undefined && lane.label.type === "some" ? lane.label.value : undefined;
        const cell = (
            <Box css={styles.cell}
                data-plan-cell={`${bi}:${li ?? "full"}`}
                data-over={marker !== undefined ? marker.status.type : undefined}
                {...cellX(bi)}
                {...laneY(li ?? 0, li === undefined ? laneCount : span)}
                onClick={() => dispatch({ t: "row.select", key: rowKey })}
            >
                {caption !== undefined && <Box css={styles.laneLabel}>{caption}</Box>}
                {events.map((ev) => (
                    <EventChip key={ev.key} ev={ev} styles={styles} rowKey={rowKey} storageKey={storageKey} />
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

    const cells: ReactNode[] = [];
    for (let bi = 0; bi < scale.buckets.length; bi++) {
        const full = fullCellEvents.get(bi);
        if (full !== undefined) {
            // The mixed grammar: a lane-less event in a laned row takes the
            // whole cell across lanes.
            cells.push(renderCell(bi, undefined, full));
            continue;
        }
        for (let li = 0; li < laneCount; li++) {
            cells.push(renderCell(bi, li, cellEvents.get(`${bi}:${li}`) ?? []));
        }
    }
    return <>{cells}</>;
}
