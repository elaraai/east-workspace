/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    FloatType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { DensityType } from "../../style.js";
import { PlotGutterType } from "../../shared/plot-gutter.js";

/**
 * A cell reference on the calendar grid — what `onSelect` receives.
 *
 * @property week - The row's week label
 * @property day - The day column ("Mon" … "Sun")
 */
export const CalendarCellRefType = StructType({
    /** The row's week label */
    week: StringType,
    /** The day column ("Mon" … "Sun") */
    day: StringType,
});

/**
 * Type representing calendar cell references.
 */
export type CalendarCellRefType = typeof CalendarCellRefType;

/**
 * A resolved calendar cell.
 *
 * @remarks
 * One element per (week, day) the data covered; days with no cell render
 * the neutral `−` fill. `summary` / `delta` are the selection-footer facts
 * for this day, resolved from the accessors at authoring time.
 *
 * @property week - The row's week label (rows appear in first-appearance order)
 * @property day - The day column ("Mon" … "Sun", exact match)
 * @property value - The intensity / printed value
 * @property text - The cell text (formatted value)
 * @property summary - Optional selection-footer text for this day
 * @property delta - Optional signed change (renders as a pos/neg chip)
 */
export const CalendarCellType = StructType({
    /** The row's week label (rows appear in first-appearance order) */
    week: StringType,
    /** The day column ("Mon" … "Sun", exact match) */
    day: StringType,
    /** The intensity / printed value */
    value: FloatType,
    /** The cell text (formatted value) */
    text: StringType,
    /** Optional selection-footer text for this day */
    summary: OptionType(StringType),
    /** Optional signed change (renders as a pos/neg chip) */
    delta: OptionType(FloatType),
});

/**
 * Type representing resolved calendar cells.
 */
export type CalendarCellType = typeof CalendarCellType;

/**
 * East StructType for the Calendar component.
 *
 * @remarks
 * Day-of-week × week grid coloured by intensity — visualisation only: click
 * drills into a day (`onSelect` / the footer `action`), but there are no
 * events, no committed/proposed state, and no drag & drop.
 *
 * @property legend - Intensity caption (decodes the colour ramp)
 * @property cells - The resolved cells
 * @property domain - Optional explicit intensity domain (default: observed min/max)
 * @property actionLabel - Optional footer-right drill label
 * @property onAction - Optional footer-right drill callback (receives the selected cell)
 * @property onSelect - Optional cell-click callback
 * @property density - Optional density preset (comfortable | compact | condensed)
 */
export const CalendarRootType = StructType({
    /** Intensity caption (decodes the colour ramp) */
    legend: StringType,
    /** The resolved cells */
    cells: ArrayType(CalendarCellType),
    /** Optional explicit intensity domain (default: observed min/max) */
    domain: OptionType(StructType({
        /** Domain minimum */
        min: FloatType,
        /** Domain maximum */
        max: FloatType,
    })),
    /** Optional footer-right drill label */
    actionLabel: OptionType(StringType),
    /** Optional footer-right drill callback (receives the selected cell) */
    onAction: OptionType(FunctionType([CalendarCellRefType], NullType)),
    /** Optional cell-click callback */
    onSelect: OptionType(FunctionType([CalendarCellRefType], NullType)),
    /** Optional density preset (comfortable | compact | condensed); default comfortable */
    density: OptionType(DensityType),
    /** Shared plot gutter (#147) — pins the day grid to `[left, W−right]` so a Calendar stacked under a Chart lines up; `left` is the week-label column width */
    plotGutter: OptionType(PlotGutterType),
});

/**
 * Type representing the Calendar component.
 */
export type CalendarRootType = typeof CalendarRootType;
