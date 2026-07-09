/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Box, HoverCard, Popover, Portal, Tooltip, useSlotRecipe } from "@chakra-ui/react";
import {
    useReactTable, getCoreRowModel, createColumnHelper,
    type ColumnDef, type ColumnSizingState, type Updater,
} from "@tanstack/react-table";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faGripVertical, faCircleCheck, faTriangleExclamation, faCircleXmark, faCircleInfo, faCircle,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { equalFor, match, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Planner } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { EastChakraComponent } from "../../component";
import {
    getHeaderCellStyle, getCellStyle, useColumnSizeVars,
    ColumnDividerBar, ColumnResizeHandle,
} from "../shared/column-pinning";
import { useDensityHeights } from "../shared/helpers";
import { useReviewController, DecisionButtons, ReviewFoot, DECISION_WIDTH } from "../shared/review";
import { useDragTarget, useDropCell, useDragEventChip, useDragEventEdge, type DragEventValue, type DragMeta, type DragPayload, type CellCoord } from "../../dnd/drag-layer";
import { useIRCanDrop, canDropAllows, type CanDropFn } from "../../dnd/ir-can-drop";
import { DensityProvider } from "../../contracts/density";
import { usePlotGutter, gutterPx } from "../../contracts/plot-gutter.js";

const plannerRootEqual = equalFor(Planner.Types.Root);

/** East Planner root value (the `Planner` variant's data). */
export type PlannerRootValue = ValueTypeOf<typeof Planner.Types.Root>;
/** East Planner row value. */
export type PlannerRowValue = ValueTypeOf<typeof Planner.Types.Row>;
/** East Planner event value. */
export type PlannerEventValue = ValueTypeOf<typeof Planner.Types.Event>;
/** East Planner column value. */
export type PlannerColumnValue = ValueTypeOf<typeof Planner.Types.Column>;
/** East Planner slot coordinate value. */
export type PlannerSlotValue = ValueTypeOf<typeof Planner.Types.Slot>;
/** East Planner review-config value (the optional decision column + foot). */
export type PlannerReviewValue = ValueTypeOf<typeof Planner.Types.Review>;

export interface EastChakraPlannerProps {
    /** The Planner root value. */
    value: PlannerRootValue;
    /** Storage key for persisting layout state. Omit for ephemeral state. */
    storageKey: string;
}

/** Persisted left-pane layout — column widths + pinned (frozen) column ids. */
interface PlannerPersistedState {
    columnSizing: ColumnSizingState;
}

// ============================================================================
// Pure helpers — derive the axis columns + map a slot to a column index.
// ============================================================================

interface AxisColumn { key: string; label: string }
type RecipeStyles = Record<string, Record<string, unknown>>;
type StateKey = "committed" | "proposedAdded" | "proposedModel" | "proposedRemoved" | "rejected";

/** Status tag → paired FontAwesome icon — mirrors the shared `feedback/status`
 *  PAIRED_ICONS so a Planner marker reads the same as a Status elsewhere. */
const STATUS_ICON: Record<string, IconDefinition> = {
    success: faCircleCheck,
    warning: faTriangleExclamation,
    danger:  faCircleXmark,
    info:    faCircleInfo,
    neutral: faCircle,
};

/** The density → recipe `size` mapping (mirrors Table / Gantt). */
function sizeFromDensity(value: PlannerRootValue): "sm" | "md" | "lg" {
    const d = getSomeorUndefined(value.density)?.type;
    if (d === "compact") return "sm";
    if (d === "comfortable") return "lg";
    return "md";
}

function eventSlots(value: PlannerRootValue): PlannerSlotValue[] {
    const out: PlannerSlotValue[] = [];
    for (const row of value.rows) {
        for (const ev of row.events) {
            out.push(ev.slot);
            const end = getSomeorUndefined(ev.endSlot);
            if (end !== undefined) out.push(end);
        }
    }
    return out;
}

/** The ordered axis columns, derived from the range (or the data). */
function deriveColumns(value: PlannerRootValue): AxisColumn[] {
    const scale = value.axis.scale.type;
    const range = getSomeorUndefined(value.axis.range);
    const slots = eventSlots(value);

    if (scale === "number") {
        let min = 1, max = 1;
        const r = range !== undefined
            ? (match(range, { number: (v) => v, time: () => undefined, ordinal: () => undefined }, undefined) as { min: number; max: number } | undefined)
            : undefined;
        if (r) { min = r.min; max = r.max; } else {
            const ns = slots.map((s) => match(s, { number: (n) => n, time: () => 0, ordinal: () => 0 }, 0));
            min = ns.length ? Math.floor(Math.min(...ns)) : 1;
            max = ns.length ? Math.ceil(Math.max(...ns)) : 1;
        }
        const cols: AxisColumn[] = [];
        for (let n = min; n <= max; n++) cols.push({ key: `n:${n}`, label: String(n) });
        return cols;
    }

    if (scale === "ordinal") {
        let labels: string[] = [];
        if (range !== undefined) {
            labels = match(range, { ordinal: (v) => v, number: () => [], time: () => [] }, []) as string[];
        } else {
            const seen = new Set<string>();
            for (const s of slots) {
                const o = match(s, { ordinal: (x) => x, number: () => "", time: () => "" }, "") as string;
                if (o && !seen.has(o)) { seen.add(o); labels.push(o); }
            }
        }
        return labels.map((l) => ({ key: `o:${l}`, label: l }));
    }

    // time → month columns
    let minD: Date, maxD: Date;
    const rt = range !== undefined
        ? (match(range, { time: (v) => v, number: () => undefined, ordinal: () => undefined }, undefined) as { min: Date; max: Date } | undefined)
        : undefined;
    if (rt) { minD = rt.min; maxD = rt.max; } else {
        const ts = slots.map((s) => match(s, { time: (d) => d.getTime(), number: () => 0, ordinal: () => 0 }, 0)).filter((t) => t > 0);
        minD = ts.length ? new Date(Math.min(...ts)) : new Date(0);
        maxD = ts.length ? new Date(Math.max(...ts)) : new Date(0);
    }
    const cols: AxisColumn[] = [];
    const d = new Date(minD.getFullYear(), minD.getMonth(), 1);
    while (d <= maxD) {
        cols.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString("en-US", { month: "short" }) });
        d.setMonth(d.getMonth() + 1);
    }
    return cols.length ? cols : [{ key: "t:0", label: "" }];
}

/** Map a slot to its axis-column index (−1 if off-grid). */
function slotToCol(slot: PlannerSlotValue, cols: AxisColumn[]): number {
    const key = match(slot, {
        number: (n) => `n:${Math.round(n)}`,
        ordinal: (s) => `o:${s}`,
        time: (d) => `${d.getFullYear()}-${d.getMonth()}`,
    }, "");
    return cols.findIndex((c) => c.key === key);
}

/** The drag-grammar slot key for an axis column (#269) — the axis
 *  coordinate printed canonically: ordinal → the label, number → its decimal
 *  form, time → the column instant's ISO form. A bucket composes in with
 *  `":"` (`"wed"` / `"wed:am"`), per `contracts/drag.ts`. */
function axisSlotKey(col: AxisColumn, scale: string): string {
    if (scale === "number" || scale === "ordinal") return col.key.slice(2);
    // time — month columns keyed `${y}-${m}`; print the month start instant.
    const parts = col.key.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    if (y !== undefined && m !== undefined && Number.isFinite(y) && Number.isFinite(m)) {
        return new Date(Date.UTC(y, m, 1)).toISOString();
    }
    return col.key;
}

/** Compose the bucket into the slot key (`"wed:am"`). */
function compositeSlotKey(axisKey: string, bucket: string | undefined): string {
    return bucket !== undefined ? `${axisKey}:${bucket}` : axisKey;
}

/** Map an event's audit state to its recipe `state` variant key. */
function stateKey(state: ValueTypeOf<typeof Planner.Types.State>): StateKey {
    return match(state, {
        committed: () => "committed" as StateKey,
        rejected: () => "rejected" as StateKey,
        proposed: (flavour) => match(flavour, {
            added: () => "proposedAdded" as StateKey,
            model: () => "proposedModel" as StateKey,
            removed: () => "proposedRemoved" as StateKey,
        }, "proposedAdded" as StateKey),
    }, "committed" as StateKey);
}

/** Format a slot for the now-line hint. */
function formatSlot(slot: PlannerSlotValue): string {
    return match(slot, {
        number: (n) => String(n),
        ordinal: (s) => s,
        time: (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    }, "");
}

// ============================================================================
// Event chip (with optional popover / hovercard + conflict marker)
// ============================================================================

/** A content-alignment tag → its flexbox value. */
const CONTENT_ALIGN: Record<string, "flex-start" | "center" | "flex-end"> = {
    start: "flex-start", center: "center", end: "flex-end",
};

/**
 * Per-event `tone` tint (#120 item 3) — overrides ONLY fill / text / border
 * colour, so the state's border-style + text-decoration (the committed /
 * proposed / removed / rejected audit cues) survive a recolour. Data-driven per
 * event (the sanctioned dynamic exception), using the shared status tokens.
 */
const TONE_TINT: Record<string, Record<string, unknown>> = {
    success: { background: "bg.success.subtle", color: "{colors.status.pos}",  borderColor: "{colors.status.pos}"  },
    warning: { background: "bg.warning.subtle", color: "{colors.status.warn}", borderColor: "{colors.status.warn}" },
    danger:  { background: "bg.danger.subtle",  color: "{colors.status.neg}",  borderColor: "{colors.status.neg}"  },
    info:    { background: "bg.info.subtle",    color: "{colors.status.info}", borderColor: "{colors.status.info}" },
    neutral: { background: "transparent",        color: "fg.default",           borderColor: "border.strong"        },
};

/**
 * Derive the per-event geometry CSS (stretch fill + content alignment) from an
 * event's `stretch` / `content` fields. Inline (not a recipe variant) because it
 * is data-driven per event — the sanctioned dynamic exception to the
 * recipe-only rule (the enumerable styling — tone / animation / row hover — all
 * lives on the recipe).
 */
function eventGeom(event: PlannerEventValue, shape: "point" | "span", inLane: boolean): Record<string, unknown> {
    const stretch = getSomeorUndefined(event.stretch)?.type;
    const content = getSomeorUndefined(event.content);
    const contentH = content ? getSomeorUndefined(content.horizontal)?.type : undefined;
    const contentV = content ? getSomeorUndefined(content.vertical)?.type : undefined;
    const geom: Record<string, unknown> = {};
    if (stretch === "horizontal" || stretch === "both") geom.width = "100%";
    if (stretch === "vertical" || stretch === "both") geom.height = "100%";
    // Content alignment inside the tile (visible once the tile is larger than its
    // label — i.e. when stretched): horizontal → justifyContent, vertical → alignItems.
    if (contentH) geom.justifyContent = CONTENT_ALIGN[contentH];
    if (contentV) geom.alignItems = CONTENT_ALIGN[contentV];
    // Vertical placement of a point tile within its container.
    //  - In a FLAT cell: default top-left (a normal tile sits at the top of a
    //    taller/mixed cell, aligned with the first bucket lane beside it).
    //  - In a BUCKET LANE: the lane is one `unitH` band, so centre the tile to
    //    line it up with the lane's vertically-centred AM/PM label.
    // `content.vertical` overrides either default. Span bars own their own
    // vertical placement (the absolute wrapper centres them), so leave them be.
    if (shape === "point") {
        if (contentV) geom.alignSelf = CONTENT_ALIGN[contentV];
        else if (!inLane) geom.alignSelf = "flex-start";
    }
    return geom;
}

/** A droppable Planner region (#269) — one flat cell, bucket lane, or span
 *  cell, registered as its OWN drag destination so the valid / active / ⊘
 *  stages mark exactly the cell under the pointer (the Roster behaviour).
 *  Pass `slot: undefined` to render without registering (DnD off, or a
 *  bucketed parent cell whose lanes register instead). */
function PlannerDropCell({ surface, row, slot, vetoFor, children, ...rest }: {
    surface?: string | undefined;
    row?: string | undefined;
    slot?: string | undefined;
    vetoFor?: ((coord: CellCoord) => (payload: DragPayload) => boolean) | undefined;
} & React.ComponentProps<typeof Box>) {
    const coord = useMemo<CellCoord | null>(
        () => (surface !== undefined && row !== undefined && slot !== undefined ? { surface, row, slot } : null),
        [surface, row, slot],
    );
    const veto = useMemo(() => (coord !== null && vetoFor !== undefined ? vetoFor(coord) : undefined), [coord, vetoFor]);
    const dropRef = useDropCell(coord, false, veto);
    return <Box ref={dropRef} {...rest}>{children}</Box>;
}

/** The chip's drag-grammar context (#269) — present only when the Planner is
 *  a registered target AND the tile is draggable (proposed + keyed). */
export interface PlannerChipDnd {
    surface: string;
    row: string;
    /** The tile's slot key (bucket composed in). */
    slot: string;
    /** The tile's stable identity (the authored `event.key`). */
    event: string;
    /** The span end's slot key (Span tiles — enables edge resize). */
    endSlot?: string | undefined;
}

function EventChip({ event, eventStyle, gripStyle, shape, inLane = false, dnd }: {
    event: PlannerEventValue;
    eventStyle: Record<string, unknown>;
    gripStyle: Record<string, unknown> | undefined;
    shape: "point" | "span";
    /** True when the chip sits in a bucket lane (centre it) vs a flat cell (top-left). */
    inLane?: boolean;
    /** Drag-grammar wiring — undefined ⇒ the tile is inert (#269). */
    dnd?: PlannerChipDnd | undefined;
}) {
    const popover = getSomeorUndefined(event.popover);
    const hovercard = getSomeorUndefined(event.hovercard);
    const sk = stateKey(event.state);
    const showGrip = sk === "proposedAdded" || sk === "proposedModel" || sk === "proposedRemoved";

    // Only PROPOSED tiles drag (committed history never drags — the Roster
    // rule), and only with a stable authored `key` to name in cell refs.
    const from = useMemo(() => (dnd && showGrip
        ? { surface: dnd.surface, row: dnd.row, slot: dnd.slot, event: dnd.event }
        : null), [dnd, showGrip]);
    const dragGhost = useMemo(() => <span>{event.label}</span>, [event.label]);
    const onChipPointerDown = useDragEventChip(from, dragGhost, from === null);
    // Span edges resize through the shared runtime (#268): 6px hot zones on
    // each edge of a proposed span bar.
    const startEdgeDown = useDragEventEdge(from, "start", dragGhost, from === null || shape !== "span");
    const endEdgeFrom = useMemo(() => (from && dnd?.endSlot !== undefined
        ? { ...from, slot: dnd.endSlot } : from), [from, dnd]);
    const endEdgeDown = useDragEventEdge(endEdgeFrom, "end", dragGhost, endEdgeFrom === null || shape !== "span");

    // With a grip, tighten the left inset so the handle sits as close to the
    // edge as the 3px top/bottom padding (the default 8px reads lop-sided).
    // `geom` carries the data-driven stretch/content overrides (item 1).
    const chipCss = { ...eventStyle, ...eventGeom(event, shape, inLane), ...(showGrip ? { paddingInlineStart: "3px" } : {}), ...(from ? { position: "relative" as const } : {}) };
    const chip = (
        <Box css={chipCss} data-slot="event" data-state={sk}
            onPointerDown={onChipPointerDown}
            {...(from && onChipPointerDown ? { "data-draggable": "" } : {})}>
            {showGrip && <Box as="span" css={gripStyle} data-slot="grip"><FontAwesomeIcon icon={faGripVertical} /></Box>}
            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" minW={0}>{event.label}</Box>
            {shape === "span" && startEdgeDown && (
                <Box as="span" position="absolute" left="-3px" top="0" bottom="0" width="6px" cursor="ew-resize"
                    onPointerDown={(e: React.PointerEvent) => { e.stopPropagation(); startEdgeDown(e); }} data-resize-edge="start" />
            )}
            {shape === "span" && endEdgeDown && (
                <Box as="span" position="absolute" right="-3px" top="0" bottom="0" width="6px" cursor="ew-resize"
                    onPointerDown={(e: React.PointerEvent) => { e.stopPropagation(); endEdgeDown(e); }} data-resize-edge="end" />
            )}
        </Box>
    );

    if (popover === undefined && hovercard === undefined) return chip;

    const hoverBody = hovercard !== undefined ? (
        <Portal>
            <HoverCard.Positioner>
                <HoverCard.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                    <EastChakraComponent value={hovercard} storageKey="planner.hovercard" />
                </HoverCard.Content>
            </HoverCard.Positioner>
        </Portal>
    ) : null;
    const popBody = popover !== undefined ? (
        <Portal>
            <Popover.Positioner>
                <Popover.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                    <Popover.Body padding={0}>
                        <EastChakraComponent value={popover} storageKey="planner.popover" />
                    </Popover.Body>
                </Popover.Content>
            </Popover.Positioner>
        </Portal>
    ) : null;

    // popover (click) + hovercard (hover) may coexist on one chip — hover
    // previews, click pins. Stack the two triggers on the same chip via nested
    // `asChild` (the canonical Ark pattern) so both machines drive it.
    if (popover !== undefined && hovercard !== undefined) {
        return (
            <Popover.Root positioning={{ placement: "top" }}>
                <HoverCard.Root openDelay={150} positioning={{ placement: "top" }}>
                    <Popover.Trigger asChild>
                        <HoverCard.Trigger asChild>{chip}</HoverCard.Trigger>
                    </Popover.Trigger>
                    {hoverBody}
                </HoverCard.Root>
                {popBody}
            </Popover.Root>
        );
    }
    if (hovercard !== undefined) {
        return (
            <HoverCard.Root openDelay={150} positioning={{ placement: "top" }}>
                <HoverCard.Trigger asChild>{chip}</HoverCard.Trigger>
                {hoverBody}
            </HoverCard.Root>
        );
    }
    return (
        <Popover.Root positioning={{ placement: "top" }}>
            <Popover.Trigger asChild>{chip}</Popover.Trigger>
            {popBody}
        </Popover.Root>
    );
}

// ============================================================================
// Main renderer
// ============================================================================

/** Renders an East Planner value as a CSS-grid scheduling surface. */
export const EastChakraPlanner = memo(function EastChakraPlanner({ value, storageKey }: EastChakraPlannerProps) {
    const densityTag = getSomeorUndefined(value.density)?.type;
    const size = sizeFromDensity(value);
    const recipe = useSlotRecipe({ key: "planner" });
    const tableRecipe = useSlotRecipe({ key: "table" });
    // Opt-in row-hover affordance (#120 item 5) — the recipe `rowHover` variant
    // adds the `_hover` outline to the `row` slot, so no inline hover styling.
    const rowHoverOn = getSomeorUndefined(value.rowHover) === true;
    const base = useMemo(() => recipe({ size, rowHover: rowHoverOn } as Record<string, unknown>) as unknown as RecipeStyles, [recipe, size, rowHoverOn]);
    // Header cells reuse the shared `table` columnHeader chrome (solid wash +
    // strong bottom rule) — one source across Table / Gantt / Planner / Matrix.
    const headerCellStyle = useMemo(() => (tableRecipe({ size }) as unknown as RecipeStyles).columnHeader ?? {}, [tableRecipe, size]);

    // Fixed, density-driven heights from the shared `sizes.density` tokens — the
    // SAME source the Table rows and Gantt header consume. Every slot row (each
    // bucket, or a non-bucketed cell) is `unitH` tall, so AM/PM/EV never differ.
    const { header: headerH, row: unitH } = useDensityHeights(size);

    const shape: "point" | "span" = value.variant.type === "span" ? "span" : "point";
    const cols = useMemo(() => deriveColumns(value), [value]);
    const buckets = value.axis.buckets;
    const nCols = Math.max(cols.length, 1);

    // Resolve the `event` slot once per state (applied per event below).
    const stateStyles = useMemo(() => {
        const keys: StateKey[] = ["committed", "proposedAdded", "proposedModel", "proposedRemoved", "rejected"];
        const out = {} as Record<StateKey, Record<string, unknown>>;
        for (const k of keys) out[k] = (recipe({ size, shape, state: k } as Record<string, unknown>) as unknown as RecipeStyles).event ?? {};
        return out;
    }, [recipe, size, shape]);

    const statusStyles = useMemo(() => {
        const out: Record<string, RecipeStyles> = {};
        for (const s of ["success", "warning", "danger", "info", "neutral"]) out[s] = recipe({ size, status: s } as Record<string, unknown>) as unknown as RecipeStyles;
        return out;
    }, [recipe, size]);

    // The pulse animation string from the recipe (`animation: pulse`), applied
    // additively to the resolved event style with an explicit reduced-motion guard
    // so opted-out users see no motion regardless of how the recipe is resolved.
    const pulseStyle = useMemo(() => {
        const ev = (recipe({ size, shape, animation: "pulse" } as Record<string, unknown>) as unknown as RecipeStyles).event ?? {};
        return { animation: ev.animation, "@media (prefers-reduced-motion: reduce)": { animation: "none" } } as Record<string, unknown>;
    }, [recipe, size, shape]);

    // Row selection (interactive-state pattern).
    const onSelectRow = useMemo(() => getSomeorUndefined(value.onSelectRow), [value.onSelectRow]);
    const [selected, setSelected] = useState<number | undefined>(undefined);
    useEffect(() => { setSelected(undefined); }, [value]);
    const selectRow = useCallback((rowIndex: number) => {
        setSelected(rowIndex);
        if (onSelectRow) queueMicrotask(() => onSelectRow({ rowIndex: BigInt(rowIndex) }));
    }, [onSelectRow]);

    // ── Opt-in DnD target role (#269) ─────────────────────────────────────
    // Presence-gated on `onDrag` (a Planner without it is exactly as before):
    // ONE continuous drop registration over the grid; the destination
    // resolves at pointer position from the cells' / bucket lanes' data
    // attributes (`data-drop-row` / `data-drop-slot`, the composite slot-key
    // encoding from contracts/drag.ts). Drops land as optimistic
    // `proposed(added)` tiles; committed history never drags.
    const onDragFn = useMemo(() => getSomeorUndefined(value.onDrag), [value.onDrag]);
    const canDropFn = useMemo(() => getSomeorUndefined(value.canDrop) as CanDropFn | undefined, [value.canDrop]);
    const surfaceId = value.id;
    const scaleTag = value.axis.scale.type;
    const dndActive = onDragFn !== undefined;

    const [localAdds, setLocalAdds] = useState<Map<number, PlannerEventValue[]>>(() => new Map());
    useEffect(() => { setLocalAdds(new Map()); }, [value]);

    // slot string → the slot coordinate value for optimistic tiles.
    const slotFromKey = useCallback((slotKey: string): { slot: PlannerSlotValue; bucket: string | undefined } | undefined => {
        // The bucket (if declared) composes in after the last ":" — except time
        // axes, whose ISO form itself carries ":" and ends with "Z".
        let axisKey = slotKey;
        let bucket: string | undefined;
        const lastColon = slotKey.lastIndexOf(":");
        if (lastColon > 0 && !slotKey.endsWith("Z")) {
            const candidateBucket = slotKey.slice(lastColon + 1);
            if (buckets.some(b => b.key === candidateBucket)) {
                axisKey = slotKey.slice(0, lastColon);
                bucket = candidateBucket;
            }
        }
        if (scaleTag === "number") {
            const n = Number(axisKey);
            return Number.isFinite(n) ? { slot: variant("number", n) as PlannerSlotValue, bucket } : undefined;
        }
        if (scaleTag === "ordinal") return { slot: variant("ordinal", axisKey) as PlannerSlotValue, bucket };
        const d = new Date(axisKey);
        return Number.isNaN(d.getTime()) ? undefined : { slot: variant("time", d) as PlannerSlotValue, bucket };
    }, [scaleTag, buckets]);

    // Per-cell drop registration (each flat cell / bucket lane / span cell is
    // its own destination, like Roster) — the valid / active / ⊘ stages mark
    // the EXACT cell, not the surface. The standard IR-canDrop bridge builds
    // the per-cell veto from the cell's own coordinate.
    const vetoFor = useIRCanDrop(canDropFn);

    const handleGrammarDrop = useCallback((event: DragEventValue, meta?: DragMeta) => {
        // Re-check the IR veto with the real event before mutating (the hover
        // veto already gated the ⊘ stage; sink removes are always valid).
        if ((event.type === "add" || event.type === "move" || event.type === "resize") && !canDropAllows(canDropFn, event)) return;
        if (event.type === "add") {
            const rowIndex = Number(event.value.into.row);
            const resolved = slotFromKey(event.value.into.slot);
            if (Number.isFinite(rowIndex) && resolved !== undefined) {
                const tile: PlannerEventValue = {
                    key: some(`local:${event.value.from.library}:${event.value.from.key}:${event.value.into.slot}`),
                    slot: resolved.slot,
                    endSlot: none,
                    bucket: resolved.bucket !== undefined ? some(resolved.bucket) : none,
                    label: meta?.label ?? event.value.from.key,
                    state: variant("proposed", variant("added", null)),
                    popover: none,
                    stretch: none,
                    content: none,
                    tone: none,
                    color: none,
                    colorPalette: none,
                    animation: none,
                    hovercard: none,
                } as PlannerEventValue;
                setLocalAdds(prev => {
                    const nextMap = new Map(prev);
                    nextMap.set(rowIndex, [...(nextMap.get(rowIndex) ?? []), tile]);
                    return nextMap;
                });
            }
        }
        if (onDragFn) queueMicrotask(() => onDragFn(event));
    }, [onDragFn, canDropFn, slotFromKey]);

    const targetConfig = useMemo(() => (dndActive ? {
        id: surfaceId,
        sources: [...value.sources],
        kinds: { add: true, move: true, remove: true, resize: shape === "span" },
        onDrag: handleGrammarDrop,
    } : null), [dndActive, surfaceId, value.sources, handleGrammarDrop, shape]);
    useDragTarget(targetConfig);

    // ── Review chrome (optional) ──────────────────────────────────────────
    // The per-row Approve/Reject decision column + the batch foot, on the shared
    // review pieces (`../shared/review`): the optimistic decisions controller,
    // the `button`-recipe Approve/Reject pair, and the `commitBar` foot. The
    // shared `reviewChrome` recipe carries the column geometry + the quiet
    // status dot; the renderer only adds sticky pinning.
    const review = useMemo(() => getSomeorUndefined(value.review), [value.review]);
    const approvals = useMemo(() => value.rows.map((row) => row.approval), [value]);
    const reviewController = useReviewController(review, approvals);
    const hasReview = reviewController !== undefined;
    const chromeRecipe = useSlotRecipe({ key: "reviewChrome" });
    const chrome = useMemo(() => chromeRecipe({ size }) as unknown as RecipeStyles, [chromeRecipe, size]);
    const dotStyles = useMemo(() => {
        const out: Record<string, Record<string, unknown>> = {};
        for (const s of ["success", "warning", "danger", "info", "neutral"]) out[s] = (chromeRecipe({ size, status: s } as Record<string, unknown>) as unknown as RecipeStyles).statusDot ?? {};
        return out;
    }, [chromeRecipe, size]);

    // ── Left pane IS a Table ──────────────────────────────────────────────
    // Reuse the shared column machinery (Table / Gantt) so the left columns
    // resize + pin identically. Visual styling stays on the planner recipe
    // slots (spec-locked); only width / pin / chrome come from TanStack.
    const columnHelper = useMemo(() => createColumnHelper<PlannerRowValue>(), []);
    // No column pinning in the Planner: the whole left pane is sticky-left
    // (frozen) as one unit and the timeline scroll is isolated to the grid, so
    // pinning a column is meaningless. Headers carry only a resize handle —
    // no pin / sort. Sizing uses getTotalSize().
    const hasFrozen = false;
    const columns = useMemo<ColumnDef<PlannerRowValue, string>[]>(
        () => value.columns.map((col, i) => {
            const width = getSomeorUndefined(col.width);
            const alignEnd = getSomeorUndefined(col.align)?.type === "end";
            // Identity (first) column carries name + sublabel; the rest are
            // tighter data columns. Each is a fixed, resizable width.
            const sizePx = width ? (parseInt(width, 10) || 150) : (i === 0 ? 150 : 110);
            return columnHelper.accessor((row) => row.cells.get(col.key)?.value ?? "", {
                id: col.key,
                header: col.header,
                enableSorting: false,
                size: sizePx,
                minSize: 60,
                // meta.width truthy keeps the column a fixed width in getCellStyle
                // (no table-style flex-stretch); the pane sums these widths.
                meta: { columnKey: col.key, width: width ?? `${sizePx}px`, alignEnd },
            });
        }),
        [value.columns, columnHelper],
    );

    const { state: persistedState, setState: setPersistedState } = usePersistedState<PlannerPersistedState>(
        storageKey, { columnSizing: {} },
    );
    const columnSizing = persistedState.columnSizing;
    const setColumnSizing = useCallback((updater: Updater<ColumnSizingState>) => {
        setPersistedState((prev) => ({
            ...prev,
            columnSizing: typeof updater === "function" ? updater(prev.columnSizing) : updater,
        }));
    }, [setPersistedState]);

    const table = useReactTable({
        data: value.rows,
        columns,
        state: { columnSizing },
        onColumnSizingChange: setColumnSizing,
        getCoreRowModel: getCoreRowModel(),
        enableSorting: false,
        enableColumnResizing: true,
        columnResizeMode: "onChange",
    });
    const columnSizeVars = useColumnSizeVars(table);
    const leftColumns = table.getVisibleLeafColumns();
    const headerCells = table.getHeaderGroups()[0]?.headers ?? [];

    // Left pane width = the exact sum of the (resizable) column widths — no
    // floor, no stretch — so it never grows wider than the columns need and
    // resizing a column resizes the pane. The timeline keeps `1fr`.
    const leftPaneWidth = `${table.getTotalSize()}px`;
    // Slots keep a minimum width (IR `slotMinWidth`, default 56px); when the axis
    // can't fit, the surface scrolls horizontally (the left pane stays pinned).
    // `minmax(min, 1fr)` grows to fill but never squeezes below `min`.
    const slotMin = getSomeorUndefined(value.slotMinWidth) ?? "56px";
    const slotMinPx = parseInt(slotMin, 10) || 56;
    const slotTemplate = `repeat(${nCols}, minmax(${slotMin}, 1fr))`;
    const stickyLeft = { position: "sticky" as const, left: 0, zIndex: 1, background: "bg.surface" };
    const stickyLeftHeader = { ...stickyLeft, zIndex: 2, background: "bg.panel" };
    // The review chrome hangs a fixed-width decision column off the right of the
    // grid, pinned (sticky-right) the way the left pane is pinned-left, so it
    // stays visible while the timeline scrolls.
    const gridTemplate = hasReview ? `${leftPaneWidth} 1fr ${DECISION_WIDTH}` : `${leftPaneWidth} 1fr`;
    const gridMinWidth = hasReview
        ? `calc(${leftPaneWidth} + ${nCols * slotMinPx}px + ${DECISION_WIDTH})`
        : `calc(${leftPaneWidth} + ${nCols * slotMinPx}px)`;
    const stickyRight = { position: "sticky" as const, right: 0, zIndex: 1, background: "bg.surface" };
    const stickyRightHeader = { ...stickyRight, zIndex: 2, background: "bg.panel" };

    // Shared plot gutter (#147) — own field wins over an enclosing <AlignedStack>'s
    // context. When active the timeline grid is pinned to [left, W−right]: the
    // frozen channel pane is scaled to `left` (the column size-vars are scaled so
    // the inner cells match the outer track), the outer grid gains a trailing
    // right-gutter track, slots fill flush (minmax 0), and horizontal scroll is
    // dropped so the lane is exactly the container width. The day axis then lines
    // up under a stacked Chart. (Acceptance case: Chart over Planner.)
    const ctxGutter = usePlotGutter();
    const ownGutter = getSomeorUndefined(value.plotGutter);
    const gLeft = (ownGutter ? getSomeorUndefined(ownGutter.left) : undefined) ?? ctxGutter?.left;
    const gRight = (ownGutter ? getSomeorUndefined(ownGutter.right) : undefined) ?? ctxGutter?.right;
    const gutterActive = gLeft !== undefined || gRight !== undefined;
    const gRightCol = gRight ?? "0px";
    const gLeftPx = gutterPx(gLeft);
    const totalLeftPx = table.getTotalSize();
    const frozenScale = (gutterActive && gLeftPx !== undefined && totalLeftPx > 0) ? gLeftPx / totalLeftPx : 1;
    const effectiveSizeVars = frozenScale !== 1
        ? Object.fromEntries(Object.entries(columnSizeVars).map(([k, v]) =>
            [k, typeof v === "string" && v.endsWith("px") ? `${parseFloat(v) * frozenScale}px` : v]))
        : columnSizeVars;
    const effectiveLeftPane = gLeft ?? leftPaneWidth;
    const outerCols = gutterActive
        ? (hasReview ? `${effectiveLeftPane} 1fr ${DECISION_WIDTH} ${gRightCol}` : `${effectiveLeftPane} 1fr ${gRightCol}`)
        : gridTemplate;
    const rightSlotCols = gutterActive ? `repeat(${nCols}, minmax(0, 1fr))` : slotTemplate;
    const outerMinWidth = gutterActive ? undefined : gridMinWidth;

    const now = getSomeorUndefined(value.now);
    const nowCol = now !== undefined ? slotToCol(now, cols) : -1;

    // The resolved chip style: the state grammar, then the optional `tone` tint
    // (colours only), then the optional `pulse` animation (#120 item 3).
    const eventStyleFor = (ev: PlannerEventValue) => {
        let style = stateStyles[stateKey(ev.state)];
        const tone = getSomeorUndefined(ev.tone)?.type;
        if (tone !== undefined && TONE_TINT[tone] !== undefined) style = { ...style, ...TONE_TINT[tone] };
        // Optional brand-colour override (#148) — tints fill/text/border to match a
        // paired Chart series, keeping the state's border-style + strike-through.
        // A raw `color` token wins over `colorPalette`; both win over `tone`.
        const rawColor = getSomeorUndefined(ev.color);
        const pal = getSomeorUndefined(ev.colorPalette)?.type;
        if (rawColor !== undefined) {
            style = { ...style, background: "transparent", color: rawColor, borderColor: rawColor };
        } else if (pal !== undefined) {
            style = { ...style, colorPalette: pal, background: "colorPalette.subtle", color: "colorPalette.fg", borderColor: "colorPalette.solid" };
        }
        if (getSomeorUndefined(ev.animation)?.type === "pulse") style = { ...style, ...pulseStyle };
        return style;
    };

    const cellEvents = (row: PlannerRowValue, colIndex: number, bucketKey?: string) =>
        row.events.filter((ev) => {
            if (slotToCol(ev.slot, cols) !== colIndex) return false;
            const b = getSomeorUndefined(ev.bucket);
            return bucketKey === undefined ? b === undefined : b === bucketKey;
        });

    // All events in a column, regardless of bucket — used to decide per-cell
    // bucketing (cellEvents with no bucketKey returns only the *bucketless* ones).
    const columnEvents = (row: PlannerRowValue, colIndex: number) =>
        row.events.filter((ev) => slotToCol(ev.slot, cols) === colIndex);

    // The conflict marker wraps the whole cell (spec). Conflicts are declared
    // parallel to events (row.markers), each locating its own cell by slot.
    const cellMarker = (row: PlannerRowValue, colIndex: number) => {
        for (const m of row.markers) {
            if (slotToCol(m.slot, cols) === colIndex) return m;
        }
        return undefined;
    };

    const groups = useMemo(() => {
        const out: { label: string | undefined; rows: { row: PlannerRowValue; index: number }[] }[] = [];
        value.rows.forEach((row, index) => {
            const g = getSomeorUndefined(row.group);
            const last = out[out.length - 1];
            if (last && last.label === g) last.rows.push({ row, index });
            else out.push({ label: g, rows: [{ row, index }] });
        });
        return out;
    }, [value.rows]);

    // Rows with an accidental same-cell mix (#120 item 6): a cell holding BOTH a
    // bucketed and a bucketless event. Such a row shows an "N/A" lane in every
    // bucketed cell so the orphan surfaces (labelled) instead of vanishing.
    const rowNeedsNA = useMemo(() => {
        const set = new Set<number>();
        if (buckets.length > 0) {
            value.rows.forEach((row, ri) => {
                const mixed = cols.some((_c, ci) =>
                    row.events.some((ev) => slotToCol(ev.slot, cols) === ci && getSomeorUndefined(ev.bucket) !== undefined) &&
                    row.events.some((ev) => slotToCol(ev.slot, cols) === ci && getSomeorUndefined(ev.bucket) === undefined));
                if (mixed) set.add(ri);
            });
        }
        return set;
    }, [value.rows, cols, buckets]);

    useEffect(() => {
        if (rowNeedsNA.size > 0) {
            console.warn(`[Planner] ${rowNeedsNA.size} row(s) have a bucketless event sharing a bucketed cell — rendered in an "N/A" lane. Give the event a bucket, or move it to its own column.`);
        }
    }, [rowNeedsNA]);

    // Bucketing is decided PER CELL (`cellBucketed`), not per row (#120 item 6): a
    // cell renders the bucket sub-grid iff the axis declares buckets AND this cell
    // carries ≥1 bucketed event. So within one row a bucketed column (am/pm) and a
    // flat column coexist, and a bucketless event lands in its column's flat cell
    // instead of vanishing (the old per-row test dropped it whenever the row had
    // any other bucketed event).
    // A row is "bucketed" if it carries ≥1 bucketed event anywhere. Within a
    // bucketed row every cell keeps the am/pm rhythm EXCEPT a cell that holds
    // only a bucketless event (that one renders flat) — so an EMPTY column still
    // shows the (empty) lanes and the grid stays even (no stub-flat gap, #120).
    const rowHasBucket = (row: PlannerRowValue) =>
        buckets.length > 0 && row.events.some((ev) => getSomeorUndefined(ev.bucket) !== undefined);
    const cellBucketed = (row: PlannerRowValue, colIndex: number) => {
        if (!rowHasBucket(row)) return false;
        const cev = columnEvents(row, colIndex);
        if (cev.length === 0) return true; // empty cell in a bucketed row → keep the rhythm
        return cev.some((ev) => getSomeorUndefined(ev.bucket) !== undefined);
    };

    // The synthetic orphan lane key (item 6) — when a single cell accidentally
    // mixes a bucketed + a bucketless event, the bucketless one(s) land here.
    const NA_BUCKET = { key: "__na__", label: "N/A" };

    // Render a single timeline cell's body. `needsNA` is row-level: if ANY cell in
    // the row mixes a bucketed + a bucketless event, every bucketed cell in the row
    // gains a trailing "N/A" lane (holding that cell's orphan bucketless events, if
    // any) so the bucket sub-grid stays aligned across the row and nothing is
    // silently dropped.
    // The chip's drag-grammar context (#269) — proposed + keyed tiles only.
    const chipDnd = (ev: PlannerEventValue, rowIndex: number, colIndex: number, bucketKey?: string): PlannerChipDnd | undefined => {
        if (!dndActive) return undefined;
        const key = getSomeorUndefined(ev.key);
        if (key === undefined) return undefined;
        const col = cols[colIndex];
        if (col === undefined) return undefined;
        const endSlotVal = getSomeorUndefined(ev.endSlot);
        const endCol = endSlotVal !== undefined ? cols[slotToCol(endSlotVal, cols)] : undefined;
        return {
            surface: surfaceId,
            row: String(rowIndex),
            slot: compositeSlotKey(axisSlotKey(col, scaleTag), bucketKey),
            event: key,
            endSlot: endCol !== undefined ? axisSlotKey(endCol, scaleTag) : undefined,
        };
    };

    const renderCellBody = (row: PlannerRowValue, rowIndex: number, colIndex: number, needsNA: boolean) => {
        if (!cellBucketed(row, colIndex)) {
            return cellEvents(row, colIndex).map((ev, i) => (
                <EventChip key={i} event={ev} eventStyle={eventStyleFor(ev)} gripStyle={base.grip} shape="point"
                    dnd={chipDnd(ev, rowIndex, colIndex)} />
            ));
        }
        // Bucketed cells are a vertical sub-grid; the cell box itself carries
        // `bucketedCell` (grid + flat 2px inset), so no extra wrapper here.
        const lanes = needsNA ? [...buckets, NA_BUCKET] : buckets;
        return lanes.map((bk) => {
            const isNA = bk.key === NA_BUCKET.key;
            const laneEvents = isNA ? cellEvents(row, colIndex, undefined) : cellEvents(row, colIndex, bk.key);
            // The N/A orphan lane renders exactly like a declared bucket lane —
            // same padding / positioning / label gutter — the "N/A" label is the
            // only marker (the dev-time warning surfaces the accident in code).
            const laneSlot = !isNA && cols[colIndex] !== undefined
                ? compositeSlotKey(axisSlotKey(cols[colIndex]!, scaleTag), bk.key)
                : undefined;
            return (
                <PlannerDropCell key={bk.key} css={base.bucket} data-slot="bucket" data-na={isNA ? "" : undefined} height={`${unitH}px`}
                    surface={surfaceId} row={String(rowIndex)} slot={dndActive ? laneSlot : undefined} vetoFor={vetoFor}
                    {...(dndActive && laneSlot !== undefined
                        ? { "data-drop-row": String(rowIndex), "data-drop-slot": laneSlot }
                        : {})}>
                    <Box css={base.bucketLabel} data-slot="bucketLabel">{bk.label}</Box>
                    {laneEvents.map((ev, i) => (
                        <EventChip key={i} event={ev} eventStyle={eventStyleFor(ev)} gripStyle={base.grip} shape="point" inLane
                            dnd={chipDnd(ev, rowIndex, colIndex, isNA ? undefined : bk.key)} />
                    ))}
                </PlannerDropCell>
            );
        });
    };

    const plannerContent = (
        <Box css={base.root} {...(gutterActive ? { width: "100%" } : {})}>
            {/* Header: left data-column headers (Table chrome) + right slot axis. */}
            <Box css={base.header} data-slot="header" display="grid" gridTemplateColumns={outerCols} minWidth={outerMinWidth} height={`${headerH}px`}>
                <Box css={stickyLeftHeader} display="flex" width="100%" style={effectiveSizeVars}>
                    {headerCells.map((header) => (
                        <Box
                            key={header.id}
                            css={headerCellStyle}
                            data-slot="colHeader"
                            position="relative"
                            display="flex"
                            alignItems="center"
                            justifyContent={header.column.columnDef.meta?.alignEnd ? "flex-end" : "flex-start"}
                            style={getHeaderCellStyle(header, hasFrozen, columnSizing, false)}
                        >
                            {/* Label only — no pin/sort; the timeline scroll is grid-isolated. */}
                            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" minW={0}>
                                {header.column.columnDef.header as string}
                            </Box>
                            <ColumnResizeHandle header={header} />
                        </Box>
                    ))}
                </Box>
                <Box position="relative" display="grid" gridTemplateColumns={rightSlotCols}>
                    {cols.map((c, ci) => (
                        <Box
                            key={c.key}
                            css={{ ...headerCellStyle, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
                            data-slot="headerCell"
                        >
                            {c.label}
                            {ci < cols.length - 1 && <ColumnDividerBar />}
                        </Box>
                    ))}
                    {nowCol >= 0 && (
                        <Box css={base.nowLine} left={`calc(${nowCol} * (100% / ${nCols}))`} />
                    )}
                </Box>
                {hasReview && review && (
                    <Box css={{ ...chrome.decisionHeader, ...stickyRightHeader }} data-slot="decisionHeader">
                        {review.columnLabel}
                    </Box>
                )}
                {/* Trailing right-gutter spacer (#147): the header band's `bg.panel`
                    wash fills the whole outer grid, so without this it bleeds into the
                    `gRightCol` gutter track past where the day columns end. Painting the
                    surface colour over the gutter track stops the wash at W−right, level
                    with the column cells (whose bottom rule already stops there). */}
                {gutterActive && <Box data-slot="headerGutter" aria-hidden="true" background="bg.surface" />}
            </Box>

            {/* Body: group-head rows + data rows. */}
            {groups.map((group, gi) => (
                <Box key={gi}>
                    {group.label !== undefined && (
                        <Box css={base.groupHead} data-slot="groupHead" minWidth={outerMinWidth} display="grid" gridTemplateColumns={outerCols}>
                            <Box css={{ ...stickyLeft, ...base.groupHeadCell, background: "bg.panel" }} data-slot="groupHeadCell">{group.label}</Box>
                        </Box>
                    )}
                    {group.rows.map(({ row: rowBase, index }) => {
                        // Optimistic drops (#269) — locally-added proposed tiles
                        // merge into the row until the value prop reconciles.
                        const rowAdds = localAdds.get(index);
                        const row = rowAdds !== undefined && rowAdds.length > 0
                            ? { ...rowBase, events: [...rowBase.events, ...rowAdds] }
                            : rowBase;
                        const rowStatusTag = hasReview ? getSomeorUndefined(row.status)?.type : undefined;
                        // Per-cell bucketing (#120 item 6) — each cell decides flat
                        // vs sub-grid independently; `needsNA` adds the orphan lane
                        // to this row's bucketed cells when a same-cell mix exists.
                        const needsNA = rowNeedsNA.has(index);
                        return (
                        <Box
                            key={index}
                            css={base.row}
                            position="relative"
                            display="grid"
                            gridTemplateColumns={outerCols}
                            minWidth={outerMinWidth}
                            onClick={onSelectRow ? () => selectRow(index) : undefined}
                            cursor={onSelectRow ? "pointer" : undefined}
                        >
                            {/* Selection — a single brand outline around the whole row (over
                                both panes), not per-cell boxes. */}
                            {selected === index && (
                                <Box position="absolute" inset="0" pointerEvents="none" zIndex={4}
                                    borderWidth="2px" borderColor="{colors.brand.600}" borderRadius="2px" />
                            )}
                            {/* Trailing right-gutter mask (#147): the row's full-width bottom rule
                                (base.row) otherwise extends into the `right` gutter past the day
                                columns. `bottom:-1px` paints the surface colour over both the gutter
                                strip and that 1px rule, so the separator stops at W−right. */}
                            {gutterActive && (
                                <Box position="absolute" top="0" bottom="-1px" right="0" width={gRightCol}
                                    background="bg.surface" pointerEvents="none" zIndex={3} aria-hidden="true" />
                            )}
                            {/* Left pane — widths/pin from TanStack, styling from planner slots. */}
                            <Box css={stickyLeft} display="flex" width="100%" style={effectiveSizeVars}>
                                {leftColumns.map((column, ci) => {
                                    const columnKey = column.columnDef.meta?.columnKey ?? column.id;
                                    const cellData = row.cells.get(columnKey);
                                    const sub = cellData ? getSomeorUndefined(cellData.sublabel) : undefined;
                                    const alignEnd = column.columnDef.meta?.alignEnd === true;
                                    // The quiet status dot rides the identity (first) column, just
                                    // before the name — one flag per row, never a per-cell ring.
                                    const showDot = ci === 0 && rowStatusTag !== undefined;
                                    return (
                                        <Box
                                            key={column.id}
                                            css={base.rowHeader}
                                            data-slot="rowHeader"
                                            style={getCellStyle({ column }, hasFrozen, columnSizing, false)}
                                        >
                                            {/* The name/sub stretch to the full column width (so they stay
                                                bounded), and alignment lives in each line's own flex
                                                justification. End-aligned values sit flush-right while short,
                                                but once they outgrow the column the inner span fills it and
                                                truncates with a trailing ellipsis — the leading (most
                                                significant) part of "6.0 / 8.0 h" survives, never the tail. */}
                                            <Box css={base.rowHeaderName} data-slot="rowHeaderName"
                                                display="flex" justifyContent={alignEnd ? "flex-end" : "flex-start"}>
                                                {showDot && rowStatusTag !== undefined && <Box as="span" css={dotStyles[rowStatusTag]} data-slot="statusDot" />}
                                                <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" minW={0}>{cellData?.value ?? ""}</Box>
                                            </Box>
                                            {sub !== undefined && <Box css={base.rowHeaderSub} data-slot="rowHeaderSub" textAlign={alignEnd ? "right" : "left"}>{sub}</Box>}
                                        </Box>
                                    );
                                })}
                            </Box>
                            {/* Right pane — the slot/bucket timeline (unchanged). */}
                            <Box position="relative" display="grid" gridTemplateColumns={rightSlotCols}>
                                {shape === "point" && cols.map((c, ci) => {
                                    const marker = cellMarker(row, ci);
                                    const mStyle = marker ? statusStyles[marker.status.type] ?? statusStyles.info : undefined;
                                    const past = nowCol > 0 && ci < nowCol;
                                    // Only the past/future boundary tints the background: past (locked) cells
                                    // carry a light grey wash, the open future stays clear. Empty vs booked
                                    // future cells render identically — the event chip (and bucket tray) is the
                                    // only marker of a booking. The wash reads `bg.muted` directly because
                                    // Chakra's slot recipe doesn't surface a single-property slot via a spread.
                                    let cellCss: Record<string, unknown> = past
                                        ? { ...base.cell, background: "bg.muted" }
                                        : { ...base.cell };
                                    // Per-cell bucketing — this cell is a sub-grid
                                    // iff it holds a bucketed event, else a flat
                                    // unitH cell (so a flat column can sit beside a
                                    // bucketed one in the same row).
                                    // Flat cells use `minHeight` (not a fixed height) so
                                    // they STRETCH to the grid row height when another cell
                                    // in the row is bucketed (taller) — otherwise the flat
                                    // cell, its background wash, and any marker ring come up
                                    // short of the row. The grid row stretches its items.
                                    if (cellBucketed(row, ci)) cellCss = { ...cellCss, ...base.bucketedCell };
                                    else cellCss = { ...cellCss, minHeight: `${unitH}px` };
                                    if (ci === cols.length - 1) cellCss = { ...cellCss, borderRightWidth: "0" };
                                    // Anchor the marker ring/icon to THIS cell (not the timeline pane).
                                    cellCss = { ...cellCss, position: "relative" };
                                    const cellSlot = axisSlotKey(c, scaleTag);
                                    const cellRegisters = dndActive && !cellBucketed(row, ci);
                                    return (
                                        <PlannerDropCell key={c.key} data-slot="cell" data-past={past ? "" : undefined} css={cellCss}
                                            surface={surfaceId} row={String(index)} slot={cellRegisters ? cellSlot : undefined} vetoFor={vetoFor}
                                            {...(cellRegisters ? { "data-drop-row": String(index), "data-drop-slot": cellSlot } : {})}>
                                            {renderCellBody(row, index, ci, needsNA)}
                                            {marker && mStyle && <Box css={mStyle.markerRing} data-slot="markerRing" />}
                                            {marker && mStyle && (
                                                <Tooltip.Root openDelay={150}>
                                                    <Tooltip.Trigger asChild>
                                                        <Box css={mStyle.markerIcon} data-slot="markerIcon">
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
                                        </PlannerDropCell>
                                    );
                                })}
                                {shape === "span" && (
                                    <>
                                        {/* Span timeline cells carry the density `unitH` so the row
                                            has a real height (the bar fills it) rather than collapsing
                                            to the old fixed 22px (#120 item 2). */}
                                        {cols.map((c) => (<PlannerDropCell key={c.key} css={base.cell} height={`${unitH}px`}
                                            surface={surfaceId} row={String(index)} slot={dndActive ? axisSlotKey(c, scaleTag) : undefined} vetoFor={vetoFor}
                                            {...(dndActive ? { "data-drop-row": String(index), "data-drop-slot": axisSlotKey(c, scaleTag) } : {})} />))}
                                        {row.events.map((ev, i) => {
                                            const start = slotToCol(ev.slot, cols);
                                            if (start < 0) return null;
                                            const endSlot = getSomeorUndefined(ev.endSlot);
                                            const end = endSlot !== undefined ? slotToCol(endSlot, cols) : start;
                                            const span = Math.max(end, start) - start + 1;
                                            // The wrapper now spans the full cell height (top:0/bottom:0)
                                            // and centres the bar; no horizontal padding, so the coloured
                                            // bar reaches both column edges (the chip keeps its own
                                            // interior 0 8px from the recipe) (#120 item 2).
                                            return (
                                                <Box key={i} position="absolute" top="0" bottom="0" display="flex" alignItems="center"
                                                    left={`calc(${start} * (100% / ${nCols}))`} width={`calc(${span} * (100% / ${nCols}))`}
                                                    pointerEvents={dndActive ? undefined : "none"}>
                                                    <EventChip event={ev} eventStyle={eventStyleFor(ev)} gripStyle={base.grip} shape="span"
                                                        dnd={chipDnd(ev, index, start)} />
                                                </Box>
                                            );
                                        })}
                                    </>
                                )}
                                {nowCol >= 0 && (
                                    <>
                                        <Box css={base.nowLine} data-slot="nowLine" left={`calc(${nowCol} * (100% / ${nCols}))`} />
                                        <Box css={base.nowHint} left={`calc(${nowCol} * (100% / ${nCols}))`} title={`now · ${now ? formatSlot(now) : ""}`} />
                                    </>
                                )}
                            </Box>
                            {reviewController !== undefined && (
                                <Box
                                    css={{ ...chrome.decisionCol, ...stickyRight }}
                                    data-slot="decisionCol"
                                    data-status={rowStatusTag}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <DecisionButtons rowIndex={index} controller={reviewController} />
                                </Box>
                            )}
                        </Box>
                        );
                    })}
                </Box>
            ))}
        </Box>
    );

    // The batch foot is the shared `ReviewFoot` on the `commitBar` recipe (the
    // same block the Diff + DecisionQueue commit bars use), pinned outside the
    // horizontally scrolling grid so it stays full-width under the plan.
    const foot = reviewController !== undefined && reviewController.showFoot
        ? <ReviewFoot controller={reviewController} storageKey={storageKey} />
        : null;

    const surface = foot !== null
        ? <Box display="flex" flexDirection="column" width="100%">{plannerContent}{foot}</Box>
        : plannerContent;

    // A density set on the planner cascades to display components rendered in
    // its cells and event chips, matching the Table behaviour.
    return densityTag !== undefined
        ? <DensityProvider value={densityTag}>{surface}</DensityProvider>
        : surface;
}, (prev, next) => plannerRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
