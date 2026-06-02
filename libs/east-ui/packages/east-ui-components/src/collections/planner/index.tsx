/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Popover, Portal, Tooltip, useSlotRecipe } from "@chakra-ui/react";
import {
    useReactTable, getCoreRowModel, createColumnHelper,
    type ColumnDef, type ColumnSizingState, type Updater,
} from "@tanstack/react-table";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faGripVertical, faCircleCheck, faTriangleExclamation, faCircleXmark, faCircleInfo, faCircle,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { equalFor, match, type ValueTypeOf } from "@elaraai/east";
import { Planner } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { EastChakraComponent } from "../../component";
import {
    getHeaderCellStyle, getCellStyle, useColumnSizeVars,
    ColumnDividerBar, ColumnResizeHandle,
} from "../shared/column-pinning";
import { useDensityHeights } from "../shared/helpers";

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
// Event chip (with optional popover + conflict marker)
// ============================================================================

function EventChip({ event, eventStyle, gripStyle }: {
    event: PlannerEventValue;
    eventStyle: Record<string, unknown>;
    gripStyle: Record<string, unknown> | undefined;
}) {
    const popover = getSomeorUndefined(event.popover);
    const sk = stateKey(event.state);
    const showGrip = sk === "proposedAdded" || sk === "proposedModel" || sk === "proposedRemoved";

    // With a grip, tighten the left inset so the handle sits as close to the
    // edge as the 3px top/bottom padding (the default 8px reads lop-sided).
    const chip = (
        <Box css={showGrip ? { ...eventStyle, paddingInlineStart: "3px" } : eventStyle} data-slot="event" data-state={sk}>
            {showGrip && <Box as="span" css={gripStyle} data-slot="grip"><FontAwesomeIcon icon={faGripVertical} /></Box>}
            <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" minW={0}>{event.label}</Box>
        </Box>
    );
    if (popover === undefined) return chip;
    return (
        <Popover.Root positioning={{ placement: "top" }}>
            <Popover.Trigger asChild>{chip}</Popover.Trigger>
            <Portal>
                <Popover.Positioner>
                    <Popover.Content padding="14px 16px" minW="240px" maxW="360px" fontSize="13px">
                        <Popover.Body padding={0}>
                            <EastChakraComponent value={popover} storageKey="planner.popover" />
                        </Popover.Body>
                    </Popover.Content>
                </Popover.Positioner>
            </Portal>
        </Popover.Root>
    );
}

// ============================================================================
// Main renderer
// ============================================================================

/** Renders an East Planner value as a CSS-grid scheduling surface. */
export const EastChakraPlanner = memo(function EastChakraPlanner({ value, storageKey }: EastChakraPlannerProps) {
    const size = sizeFromDensity(value);
    const recipe = useSlotRecipe({ key: "planner" });
    const tableRecipe = useSlotRecipe({ key: "table" });
    const base = useMemo(() => recipe({ size }) as unknown as RecipeStyles, [recipe, size]);
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

    // Row selection (interactive-state pattern).
    const onSelectRow = useMemo(() => getSomeorUndefined(value.onSelectRow), [value.onSelectRow]);
    const [selected, setSelected] = useState<number | undefined>(undefined);
    useEffect(() => { setSelected(undefined); }, [value]);
    const selectRow = useCallback((rowIndex: number) => {
        setSelected(rowIndex);
        if (onSelectRow) queueMicrotask(() => onSelectRow({ rowIndex: BigInt(rowIndex) }));
    }, [onSelectRow]);

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
    const gridMinWidth = `calc(${leftPaneWidth} + ${nCols * slotMinPx}px)`;
    const stickyLeft = { position: "sticky" as const, left: 0, zIndex: 1, background: "bg.surface" };
    const stickyLeftHeader = { ...stickyLeft, zIndex: 2, background: "bg.panel" };

    const now = getSomeorUndefined(value.now);
    const nowCol = now !== undefined ? slotToCol(now, cols) : -1;

    const eventStyleFor = (ev: PlannerEventValue) => stateStyles[stateKey(ev.state)];

    const cellEvents = (row: PlannerRowValue, colIndex: number, bucketKey?: string) =>
        row.events.filter((ev) => {
            if (slotToCol(ev.slot, cols) !== colIndex) return false;
            const b = getSomeorUndefined(ev.bucket);
            return bucketKey === undefined ? b === undefined : b === bucketKey;
        });

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

    const renderCellBody = (row: PlannerRowValue, colIndex: number) => {
        if (buckets.length === 0) {
            return cellEvents(row, colIndex).map((ev, i) => (
                <EventChip key={i} event={ev} eventStyle={eventStyleFor(ev)} gripStyle={base.grip} />
            ));
        }
        // Bucketed cells are a vertical sub-grid; the cell box itself carries
        // `bucketedCell` (grid + flat 2px inset), so no extra wrapper here.
        return buckets.map((bk) => (
            <Box key={bk.key} css={base.bucket} data-slot="bucket" height={`${unitH}px`}>
                <Box css={base.bucketLabel} data-slot="bucketLabel">{bk.label}</Box>
                {cellEvents(row, colIndex, bk.key).map((ev, i) => (
                    <EventChip key={i} event={ev} eventStyle={eventStyleFor(ev)} gripStyle={base.grip} />
                ))}
            </Box>
        ));
    };

    return (
        <Box css={base.root}>
            {/* Header: left data-column headers (Table chrome) + right slot axis. */}
            <Box css={base.header} data-slot="header" display="grid" gridTemplateColumns={`${leftPaneWidth} 1fr`} minWidth={gridMinWidth} height={`${headerH}px`}>
                <Box css={stickyLeftHeader} display="flex" width="100%" style={columnSizeVars}>
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
                <Box position="relative" display="grid" gridTemplateColumns={slotTemplate}>
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
            </Box>

            {/* Body: group-head rows + data rows. */}
            {groups.map((group, gi) => (
                <Box key={gi}>
                    {group.label !== undefined && (
                        <Box css={base.groupHead} data-slot="groupHead" minWidth={gridMinWidth} display="grid" gridTemplateColumns={`${leftPaneWidth} 1fr`}>
                            <Box css={{ ...stickyLeft, ...base.groupHeadCell, background: "bg.panel" }} data-slot="groupHeadCell">{group.label}</Box>
                        </Box>
                    )}
                    {group.rows.map(({ row, index }) => (
                        <Box
                            key={index}
                            css={base.row}
                            position="relative"
                            display="grid"
                            gridTemplateColumns={`${leftPaneWidth} 1fr`}
                            minWidth={gridMinWidth}
                            onClick={onSelectRow ? () => selectRow(index) : undefined}
                            cursor={onSelectRow ? "pointer" : undefined}
                        >
                            {/* Selection — a single brand outline around the whole row (over
                                both panes), not per-cell boxes. */}
                            {selected === index && (
                                <Box position="absolute" inset="0" pointerEvents="none" zIndex={4}
                                    borderWidth="2px" borderColor="{colors.brand.600}" borderRadius="2px" />
                            )}
                            {/* Left pane — widths/pin from TanStack, styling from planner slots. */}
                            <Box css={stickyLeft} display="flex" width="100%" style={columnSizeVars}>
                                {leftColumns.map((column) => {
                                    const columnKey = column.columnDef.meta?.columnKey ?? column.id;
                                    const cellData = row.cells.get(columnKey);
                                    const sub = cellData ? getSomeorUndefined(cellData.sublabel) : undefined;
                                    const alignEnd = column.columnDef.meta?.alignEnd === true;
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
                                                <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" minW={0}>{cellData?.value ?? ""}</Box>
                                            </Box>
                                            {sub !== undefined && <Box css={base.rowHeaderSub} data-slot="rowHeaderSub" textAlign={alignEnd ? "right" : "left"}>{sub}</Box>}
                                        </Box>
                                    );
                                })}
                            </Box>
                            {/* Right pane — the slot/bucket timeline (unchanged). */}
                            <Box position="relative" display="grid" gridTemplateColumns={slotTemplate}>
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
                                    if (buckets.length > 0) cellCss = { ...cellCss, ...base.bucketedCell };
                                    else cellCss = { ...cellCss, height: `${unitH}px` };
                                    if (ci === cols.length - 1) cellCss = { ...cellCss, borderRightWidth: "0" };
                                    // Anchor the marker ring/icon to THIS cell (not the timeline pane).
                                    cellCss = { ...cellCss, position: "relative" };
                                    return (
                                        <Box key={c.key} data-slot="cell" data-past={past ? "" : undefined} css={cellCss}>
                                            {renderCellBody(row, ci)}
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
                                        </Box>
                                    );
                                })}
                                {shape === "span" && (
                                    <>
                                        {cols.map((c) => (<Box key={c.key} css={base.cell} />))}
                                        {row.events.map((ev, i) => {
                                            const start = slotToCol(ev.slot, cols);
                                            if (start < 0) return null;
                                            const endSlot = getSomeorUndefined(ev.endSlot);
                                            const end = endSlot !== undefined ? slotToCol(endSlot, cols) : start;
                                            const span = Math.max(end, start) - start + 1;
                                            return (
                                                <Box key={i} position="absolute" top="50%" transform="translateY(-50%)" paddingX="8px"
                                                    left={`calc(${start} * (100% / ${nCols}))`} width={`calc(${span} * (100% / ${nCols}))`}>
                                                    <EventChip event={ev} eventStyle={eventStyleFor(ev)} gripStyle={base.grip} />
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
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}, (prev, next) => plannerRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
