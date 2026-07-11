/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Calendar` — a day-of-week × week grid coloured by intensity (forecast,
 * demand, OT exposure). **Visualisation only**: clicking drills into a day,
 * but the Calendar is not part of the Planner family — no events, no
 * committed/proposed state, no drag & drop. Takes one flat table with a
 * chart-style field encoding; the component owns the week (columns are
 * always Mon–Sun).
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    FloatType,
    type FunctionType,
    type NullType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { mapRows } from "../../shared/reify.js";
import { DensityType } from "../../style.js";
import type { DensityLiteral } from "../../style.js";
import { PlotGutterType } from "../../shared/plot-gutter.js";
import type { PlotGutter } from "../../shared/plot-gutter.js";
import {
    CalendarRootType,
    CalendarCellType,
    CalendarCellRefType,
} from "./types.js";

// Re-export types
export {
    CalendarRootType,
    CalendarCellType,
    CalendarCellRefType,
} from "./types.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Fields the `cell` mapper returns — one (week, day) cell, before defaults.
 *
 * @remarks
 * The mapper returns this plain object or a full
 * `ExprType<CalendarCellType>` when the row is already resolved.
 *
 * @property week - The row's week label (rows appear in first-appearance order)
 * @property day - The day column — `"Mon"` … `"Sun"`, exact match
 * @property value - The intensity (drives fill; printed via `text`)
 * @property text - Optional cell text (defaults to `East.print(value)`)
 * @property summary - Optional selection-footer text for this day
 * @property delta - Optional signed change (renders as a pos/neg chip)
 */
export interface CalendarCellFields {
    /** The row's week label (rows appear in first-appearance order). */
    week: SubtypeExprOrValue<StringType>;
    /** The day column — `"Mon"` … `"Sun"`, exact match. */
    day: SubtypeExprOrValue<StringType>;
    /** The intensity (drives fill; printed via `text`). */
    value: SubtypeExprOrValue<FloatType>;
    /** Optional cell text (defaults to `East.print(value)`). */
    text?: SubtypeExprOrValue<StringType>;
    /** Optional selection-footer text for this day. */
    summary?: SubtypeExprOrValue<StringType>;
    /** Optional signed change (renders as a pos/neg chip). */
    delta?: SubtypeExprOrValue<FloatType>;
}

/**
 * Configuration for {@link createCalendar}.
 *
 * @typeParam R - The day-row struct
 * @property cell - Cell row mapper (omit when rows are already resolved)
 * @property legend - Intensity caption (omitted by default; pass a string to caption the colour ramp)
 * @property domain - Optional explicit intensity domain (default: observed min/max)
 * @property actionLabel - Optional footer-right drill label
 * @property onAction - Optional drill callback (receives the selected cell)
 * @property onSelect - Optional cell-click callback
 */
export interface CalendarConfig<R extends StructType> {
    /** Cell row mapper; omit when `data` is already `ArrayType(Calendar.Types.Cell)`. */
    cell?: (day: ExprType<R>) => CalendarCellFields;
    /** Intensity caption (omitted by default; pass a string to caption the colour ramp). */
    legend?: SubtypeExprOrValue<StringType>;
    /** Optional explicit intensity domain (default: observed min/max). */
    domain?: { min: SubtypeExprOrValue<FloatType>; max: SubtypeExprOrValue<FloatType> };
    /** Optional footer-right drill label. */
    actionLabel?: SubtypeExprOrValue<StringType>;
    /** Optional drill callback (receives the selected cell). */
    onAction?: SubtypeExprOrValue<FunctionType<[CalendarCellRefType], NullType>>;
    /** Optional cell-click callback. */
    onSelect?: SubtypeExprOrValue<FunctionType<[CalendarCellRefType], NullType>>;
    /** Optional density preset (comfortable | compact | condensed). Default comfortable. */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Uniform sizing (#320): bound the component — a pixel number, `"fill"` (fill the parent box), or a CSS length; the whole component takes this height and scrolls within. */
    height?: SubtypeExprOrValue<StringType>;
    /** Uniform sizing (#320): max-height cap — a pixel number or CSS length; content-sized up to it. */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Shared plot gutter (#147) — pins the day grid to `[left, W−right]` (px) so a Calendar stacked under a Chart lines up; `left` is the week-label column width. Usually supplied by an enclosing `<AlignedStack>`. */
    plotGutter?: PlotGutter;
}

function buildRoot(
    data: SubtypeExprOrValue<ArrayType<StructType>>,
    config: CalendarConfig<StructType>,
): ExprType<UIComponentType> {
    const cellMapper = config.cell;
    const cells = cellMapper === undefined
        ? East.value(data as SubtypeExprOrValue<ArrayType<CalendarCellType>>, ArrayType(CalendarCellType))
        : mapRows(East.value(data) as ExprType<ArrayType<StructType>>, CalendarCellType, (row) => {
            const r: CalendarCellFields | ExprType<CalendarCellType> = cellMapper(row);
            if (r instanceof Expr) return East.value(r, CalendarCellType);
            const value = East.value(r.value, FloatType);
            return East.value({
                week: r.week,
                day: r.day,
                value,
                text: r.text !== undefined ? r.text : East.print(value),
                summary: r.summary !== undefined ? some(r.summary) : none,
                delta: r.delta !== undefined ? some(r.delta) : none,
            }, CalendarCellType);
        });

    const densityValue = config.density !== undefined
        ? (typeof config.density === "string"
            ? East.value(variant(config.density, null), DensityType)
            : config.density)
        : undefined;

    return East.value(variant("Calendar", {
        legend: config.legend ?? "",
        cells,
        domain: config.domain !== undefined
            ? some(East.value({ min: config.domain.min, max: config.domain.max },
                StructType({ min: FloatType, max: FloatType })))
            : none,
        actionLabel: config.actionLabel !== undefined ? some(config.actionLabel) : none,
        onAction: config.onAction !== undefined ? some(config.onAction) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        density: densityValue !== undefined ? some(densityValue) : none,
        height: config.height !== undefined ? some(config.height) : none,
        maxHeight: config.maxHeight !== undefined ? some(config.maxHeight) : none,
        plotGutter: config.plotGutter !== undefined
            ? some(East.value({
                left:  config.plotGutter.left  !== undefined ? some(config.plotGutter.left)  : none,
                right: config.plotGutter.right !== undefined ? some(config.plotGutter.right) : none,
            }, PlotGutterType))
            : none,
    }), UIComponentType);
}

/**
 * Creates a Calendar — a day-of-week × week intensity grid.
 *
 * @typeParam R - The day-table input
 * @param data - The day rows (one element per week × day cell; sparse is fine)
 * @param config - The Calendar configuration ({@link CalendarConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Calendar, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Calendar.Root(
 *         [{ week: "W37", day: "Mon", demand: 102.0 }],
 *         {
 *             cell: d => ({ week: d.week, day: d.day, value: d.demand }),
 *         },
 *     ),
 * );
 * ```
 */
function createCalendar<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: CalendarConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    return buildRoot(data, config as unknown as CalendarConfig<StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Calendar component namespace.
 *
 * @remarks
 * `Calendar.Root(data, config)` builds the grid from one flat day table.
 * Visualisation only — pair it with a `Slice.Range` in the surrounding
 * chrome if the time window needs to narrow.
 */
export const Calendar = {
    /**
     * Creates a Calendar — a day-of-week × week intensity grid.
     *
     * @typeParam R - The day-table input
     * @param data - The day rows (one element per week × day cell; sparse is fine)
     * @param config - The Calendar configuration ({@link CalendarConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Cells fill with brand-scale intensity normalised over the visible
     * values (or the explicit `domain`); missing (week, day) combinations
     * render the neutral `−` fill. Selecting a cell shows its `summary` /
     * `delta` in the footer next to the drill `action`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Calendar, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Calendar.Root(
     *         [{ week: "W37", day: "Mon", demand: 102.0 }],
     *         {
     *             title: "Forecasted demand · SE region",
     *             cell: d => ({ week: d.week, day: d.day, value: d.demand }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createCalendar,
    Types: {
        /**
         * East StructType for the Calendar component.
         *
         * @remarks
         * The resolved grid; see {@link CalendarRootType} for per-field docs.
         *
         * @property legend - Intensity caption
         * @property cells - The resolved cells
         * @property domain - Optional explicit intensity domain
         * @property actionLabel - Optional footer-right drill label
         * @property onAction - Optional drill callback
         * @property onSelect - Optional cell-click callback
         */
        Calendar: CalendarRootType,
        /**
         * A resolved calendar cell.
         *
         * @property week - The row's week label
         * @property day - The day column
         * @property value - The intensity / printed value
         * @property text - The cell text
         * @property summary - Optional selection-footer text
         * @property delta - Optional signed change
         */
        Cell: CalendarCellType,
        /**
         * A cell reference — what `onSelect` / `onAction` receive.
         *
         * @property week - The row's week label
         * @property day - The day column
         */
        CellRef: CalendarCellRefType,
    },
} as const;
