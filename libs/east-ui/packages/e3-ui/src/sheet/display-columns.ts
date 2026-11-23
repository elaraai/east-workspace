/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's display columns (east-workspace#1726): read-only cells that
 * draw a row's numbers with east-ui's own parts — a series as a Trace's one
 * track (`Record.column.trace`), or as a Sparkline's line or area
 * (`Record.column.sparkline`). Each takes the row type first, as every
 * column builder does ({@link column}), and only captures: the build
 * describes, checks and bridges it as it does any column (`bridge.ts`,
 * `root.ts`). A Record draws them; a Sheet refuses them.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type SubtypeExprOrValue,
    type ArrayType,
    type FloatType,
    type OptionType,
    type StringType,
    type StructType,
} from "@elaraai/east";

import type { SparklineStyle, TraceOptions, TraceScaleType } from "@elaraai/east-ui/internal";
import { column, type SheetColumn, type SheetColumnBaseConfig, type SheetValueConfig } from "./columns.js";

/**
 * Config for `Record.column.trace` (east-workspace#1728) — a row's series of
 * numbers as one track of value-coloured steps, drawn with east-ui's Trace,
 * read only. It sits on an `Array<Float>` field or its Option, or reads any
 * field through `value`.
 *
 * @remarks
 * Each step is a value of the series, coloured by its place in the row's own
 * min and max — or, given `domain`, in one scale every row shares. The steps
 * stretch to the column's width; each says its label, its value and whether it
 * is measured or predicted on hover. A row whose series is `none` or empty
 * shows `absent`. Copy puts the numbers, comma-separated.
 *
 * @property header - The header line
 * @property sub - The second header line
 * @property width - CSS width (default 240px)
 * @property detail - The cell's detail, over the row
 * @property mark - Words on the cell, or a lock, over the row and the Record's day
 * @property now - The step the now-line stands before: steps before it measured, from it on predicted (Trace's `now`)
 * @property axis - Each step's label, said in its tooltip; a row never draws the ruler
 * @property scale - Trace's colours: `"brand"` (the default) or `"diverge"`, or an expression of `Trace.Types.Scale`; `"categorical"` is refused, colouring tracks apart where a cell has one
 * @property future - How predicted steps draw: `"ghost"` (the default), `"hatch"` or `"fade"`, or an expression of `Trace.Types.Future`
 * @property domain - One scale for every row, `[min, max]`, each bound a Float or an expression of one: the same value takes the same colour on every row, and a value past either end that end's. Without it each row is coloured over its own min and max. Literal bounds must have the min below the max; bounds an expression gives whose max is not past their min place nothing, each row then over its own
 * @property absent - The words for a row whose series is `none` or empty (default "—")
 */
export interface RecordTraceConfig<R extends StructType>
    extends Pick<SheetColumnBaseConfig<R, ArrayType<FloatType>>, "header" | "sub" | "width" | "detail" | "mark">,
        // Trace's own: what the cell's Trace is drawn with.
        Pick<TraceOptions, "now" | "axis" | "future" | "domain"> {
    /** Trace's colours: brand, or diverging about the midpoint — a cell has one track, so never categorical. */
    scale?: "brand" | "diverge" | SubtypeExprOrValue<TraceScaleType>;
    /** The words for a row whose series is `none` or empty. */
    absent?: SubtypeExprOrValue<StringType>;
}

/**
 * A trace column — `Record.column.trace(R, cfg)` (east-workspace#1728): a
 * row's series as one track of value-coloured steps, with a now-line between
 * the measured and the predicted, read only. Sits on an `Array<Float>` /
 * `Option<Array<Float>>` field; with `value`, a read of any field.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type
 * @param config - The column's options ({@link RecordTraceConfig})
 * @returns The column, for the Record's `columns`
 */
export function trace<R extends StructType>(rowType: R, config: RecordTraceConfig<R> & SheetValueConfig<R, ArrayType<FloatType>>): SheetColumn<R, EastType>;
export function trace<R extends StructType>(rowType: R, config?: RecordTraceConfig<R>): SheetColumn<R, ArrayType<FloatType> | OptionType<ArrayType<FloatType>>>;
export function trace<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "trace", config);
}

/**
 * Config for `Record.column.sparkline` (east-workspace#1729) — a row's series
 * of numbers as a line or an area across the cell, drawn with east-ui's
 * Sparkline, read only. It sits on an `Array<Float>` field or its Option, or
 * reads any field through `value`.
 *
 * @remarks
 * Each line runs over its row's own min and max — or, given `domain`, over one
 * vertical scale every row shares, so their heights compare. Its hover names
 * the series: its last value and its range. A row whose series is `none` or
 * empty shows `absent`. Copy puts the numbers, comma-separated. The line takes
 * the Record's colour, in both themes: a sparkline column has none of its own.
 *
 * @property header - The header line
 * @property sub - The second header line
 * @property width - CSS width (default 120px)
 * @property detail - The cell's detail, over the row
 * @property mark - Words on the cell, or a lock, over the row and the Record's day
 * @property type - `"line"` (the default) or `"area"`, or an expression of `Sparkline.Types.ChartType`
 * @property domain - One vertical scale for every row, `[min, max]`, each bound a Float or an expression of one: a value past either end is drawn at that end. Literal bounds must have the min below the max; bounds an expression gives whose max is not past their min place nothing, each row then over its own
 * @property absent - The words for a row whose series is `none` or empty (default "—")
 */
export interface RecordSparklineConfig<R extends StructType>
    extends Pick<SheetColumnBaseConfig<R, ArrayType<FloatType>>, "header" | "sub" | "width" | "detail" | "mark">,
        // Sparkline's own: what the cell's Sparkline is drawn with.
        Pick<SparklineStyle, "type" | "domain"> {
    /** The words for a row whose series is `none` or empty. */
    absent?: SubtypeExprOrValue<StringType>;
}

/**
 * A sparkline column — `Record.column.sparkline(R, cfg)` (east-workspace#1729):
 * a row's series as a line or an area across the cell, read only. Sits on an
 * `Array<Float>` / `Option<Array<Float>>` field; with `value`, a read of any
 * field.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type
 * @param config - The column's options ({@link RecordSparklineConfig})
 * @returns The column, for the Record's `columns`
 */
export function sparkline<R extends StructType>(rowType: R, config: RecordSparklineConfig<R> & SheetValueConfig<R, ArrayType<FloatType>>): SheetColumn<R, EastType>;
export function sparkline<R extends StructType>(rowType: R, config?: RecordSparklineConfig<R>): SheetColumn<R, ArrayType<FloatType> | OptionType<ArrayType<FloatType>>>;
export function sparkline<R extends StructType>(rowType: R, config: object = {}): SheetColumn<R, EastType> {
    return column(rowType, "sparkline", config);
}
