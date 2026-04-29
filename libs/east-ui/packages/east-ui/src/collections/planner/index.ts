/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    StructType,
    ArrayType,
    DictType,
    StringType,
    FloatType,
    OptionType,
    FunctionType,
    variant,
    IntegerType,
    NullType,
    type TypeOf,
    some,
    none,
    toEastTypeValue,
    type EastType,
    type EastTypeValue,
    LiteralValueType,
    isTypeValueEqual,
} from "@elaraai/east";
import {
    TableCellClickEventType,
    TableRowClickEventType,
    TableSortEventType,
} from "../table/types.js";
import { EventAddEventType } from "./types.js";
import { StatusTokenType } from "../../style/interaction.js";

import {
    ColorSchemeType,
    FontWeightType,
    FontStyleType,
    SizeType,
    AlignType,
    LabelInputType,
    type ColorSchemeLiteral,
    type AlignLiteral,
    type LabelInput,
} from "../../style.js";
import { IconSizeType } from "../../display/icon/types.js";
import { UIComponentType, OverlayInputType } from "../../component.js";
import {
    TableCellType,
    TableColumnType,
    type TableColumnConfig,
    TableCellRenderContextType,
} from "../table/index.js";
import { Text } from "../../typography/index.js";

import {
    PlannerStyleType,
    SlotModeType,
    TableVariantType,
    TableSizeType,
    type PlannerStyle,
    EventClickEventType,
    EventDragEventType,
    EventResizeEventType,
    EventDeleteEventType,
    PlannerBoundaryType,
    EventIconType,
    type EventIcon,
} from "./types.js";

// Re-export types
export {
    PlannerStyleType,
    SlotModeType,
    type PlannerStyle,
    type SlotModeLiteral,
    EventClickEventType,
    EventDragEventType,
    EventResizeEventType,
    EventDeleteEventType,
    ResizeEdgeType,
    PlannerBoundaryType,
    type PlannerBoundary,
    EventIconType,
    type EventIcon,
} from "./types.js";

// PlannerEventType is UIComp-coupled and defined further down in this file;
// it gets re-exported through the namespace + this barrel.

// ============================================================================
// Planner Event Type (UIComp-coupled — lives here, not in types.ts)
// ============================================================================

/**
 * East StructType for a Planner event.
 *
 * @remarks
 * Represents an event that occupies one or more slots. In `single` mode
 * only `start` is used; in `span` mode `start` and `end` define the
 * inclusive range.
 *
 * Two rich-content slots:
 * - `tooltip` — hover-triggered, a Chakra Tooltip wraps the event bar.
 * - `popover` — click-triggered, a Chakra Popover wraps the event bar.
 *
 * `overlays` paints additional UIComponents (badges, icons, status
 * chips) at axis-aligned positions inside the event bar — same axis
 * pattern as Matrix overlays.
 *
 * @property start - Start slot (or single slot if mode=single)
 * @property end - End slot (only used if mode=span)
 * @property label - Optional rich label (text + alignment + typography)
 * @property icon - Optional icon configuration
 * @property colorPalette - Optional color scheme for the event background
 * @property background - Optional background/fill colour (overrides colorPalette)
 * @property stroke - Optional stroke/border colour (overrides colorPalette)
 * @property opacity - Optional opacity (0-1)
 * @property overlays - Per-event overlay annotations
 * @property tooltip - Optional rich tooltip content (hover-triggered, UIComponent)
 * @property popover - Optional rich popover content (click-triggered, UIComponent)
 */
export const PlannerEventType: StructType<{
    start: FloatType,
    end: OptionType<FloatType>,
    label: OptionType<LabelInputType>,
    icon: OptionType<EventIconType>,
    colorPalette: OptionType<ColorSchemeType>,
    background: OptionType<StringType>,
    stroke: OptionType<StringType>,
    opacity: OptionType<FloatType>,
    overlays: ArrayType<OverlayInputType>,
    tooltip: OptionType<UIComponentType>,
    popover: OptionType<UIComponentType>,
}> = StructType({
    start: FloatType,
    end: OptionType(FloatType),
    label: OptionType(LabelInputType),
    icon: OptionType(EventIconType),
    colorPalette: OptionType(ColorSchemeType),
    background: OptionType(StringType),
    stroke: OptionType(StringType),
    opacity: OptionType(FloatType),
    overlays: ArrayType(OverlayInputType),
    tooltip: OptionType(UIComponentType),
    popover: OptionType(UIComponentType),
});

export type PlannerEventType = typeof PlannerEventType;

// ============================================================================
// Planner Row Type
// ============================================================================

/**
 * East type for an Planner row.
 *
 * @remarks
 * Each row has table cells (displayed on the left) and events (displayed on the right as slots).
 *
 * @property cells - Dict of column key to cell content (same as Table)
 * @property events - Array of events
 */
export const PlannerRowType: StructType<{
    cells: DictType<StringType, typeof TableCellType>,
    events: ArrayType<PlannerEventType>,
}> = StructType({
    cells: DictType(StringType, TableCellType),
    events: ArrayType(PlannerEventType),
});

/**
 * Type representing the Planner row structure.
 */
export type PlannerRowType = typeof PlannerRowType;

// ============================================================================
// Planner Root Type
// ============================================================================

/**
 * Standalone East StructType mirror of the inline `Planner` variant in
 * `component.ts`.
 *
 * @remarks
 * main carries content (`rows` / `columns` / `frozen`),
 * timeline configuration (`slotMode` / `minSlot` / `maxSlot` /
 * `stepSize` / `slotLabel` / `boundaries`), structured state
 * (`rowStatus`), and behaviour (callbacks); `style` carries visual
 * fields only. Per-event hover-tooltip and click-popover are now
 * UIComponent slots on each event itself (`event.tooltip`,
 * `event.popover`) — no root-level `eventPopover` callback.
 *
 * @property rows - Array of Planner rows
 * @property columns - Array of column definitions (same as Table)
 * @property frozen - Column keys to freeze (pin left)
 * @property slotMode - Slot mode (single / span)
 * @property minSlot - Optional min slot override
 * @property maxSlot - Optional max slot override
 * @property stepSize - Step size for snapping
 * @property slotLabel - Custom slot label function
 * @property boundaries - Vertical boundary lines at specific slot positions
 * @property rowStatus - Row-status callback `(rowIndex) => StatusToken`
 * @property onCellClick - Cell click callback
 * @property onCellDoubleClick - Cell double-click callback
 * @property onRowClick - Row click callback
 * @property onRowDoubleClick - Row double-click callback
 * @property onSortChange - Sort change callback
 * @property onEventClick - Event click callback
 * @property onEventDoubleClick - Event double-click callback
 * @property onEventDrag - Event drag callback (presence enables drag)
 * @property onEventResize - Event resize callback (presence enables resize)
 * @property onEventAdd - Empty-slot click callback (presence enables add)
 * @property onEventEdit - Context-menu edit callback (presence enables edit)
 * @property onEventDelete - Context-menu delete callback (presence enables delete)
 * @property style - Optional visual style sub-struct
 */
export const PlannerRootType: StructType<{
    rows: ArrayType<PlannerRowType>,
    columns: ArrayType<typeof TableColumnType>,
    frozen: ArrayType<StringType>,
    slotMode: OptionType<SlotModeType>,
    minSlot: OptionType<FloatType>,
    maxSlot: OptionType<FloatType>,
    stepSize: OptionType<FloatType>,
    slotLabel: OptionType<FunctionType<[FloatType], StringType>>,
    boundaries: OptionType<ArrayType<PlannerBoundaryType>>,
    rowStatus: OptionType<FunctionType<[IntegerType], StatusTokenType>>,
    onCellClick: OptionType<FunctionType<[TableCellClickEventType], NullType>>,
    onCellDoubleClick: OptionType<FunctionType<[TableCellClickEventType], NullType>>,
    onRowClick: OptionType<FunctionType<[TableRowClickEventType], NullType>>,
    onRowDoubleClick: OptionType<FunctionType<[TableRowClickEventType], NullType>>,
    onSortChange: OptionType<FunctionType<[TableSortEventType], NullType>>,
    onEventClick: OptionType<FunctionType<[EventClickEventType], NullType>>,
    onEventDoubleClick: OptionType<FunctionType<[EventClickEventType], NullType>>,
    onEventDrag: OptionType<FunctionType<[EventDragEventType], NullType>>,
    onEventResize: OptionType<FunctionType<[EventResizeEventType], NullType>>,
    onEventAdd: OptionType<FunctionType<[EventAddEventType], NullType>>,
    onEventEdit: OptionType<FunctionType<[EventClickEventType], NullType>>,
    onEventDelete: OptionType<FunctionType<[EventDeleteEventType], NullType>>,
    style: OptionType<PlannerStyleType>,
}> = StructType({
    rows: ArrayType(PlannerRowType),
    columns: ArrayType(TableColumnType),
    frozen: ArrayType(StringType),
    slotMode: OptionType(SlotModeType),
    minSlot: OptionType(FloatType),
    maxSlot: OptionType(FloatType),
    stepSize: OptionType(FloatType),
    slotLabel: OptionType(FunctionType([FloatType], StringType)),
    boundaries: OptionType(ArrayType(PlannerBoundaryType)),
    rowStatus: OptionType(FunctionType([IntegerType], StatusTokenType)),
    onCellClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
    onCellDoubleClick: OptionType(FunctionType([TableCellClickEventType], NullType)),
    onRowClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
    onRowDoubleClick: OptionType(FunctionType([TableRowClickEventType], NullType)),
    onSortChange: OptionType(FunctionType([TableSortEventType], NullType)),
    onEventClick: OptionType(FunctionType([EventClickEventType], NullType)),
    onEventDoubleClick: OptionType(FunctionType([EventClickEventType], NullType)),
    onEventDrag: OptionType(FunctionType([EventDragEventType], NullType)),
    onEventResize: OptionType(FunctionType([EventResizeEventType], NullType)),
    onEventAdd: OptionType(FunctionType([EventAddEventType], NullType)),
    onEventEdit: OptionType(FunctionType([EventClickEventType], NullType)),
    onEventDelete: OptionType(FunctionType([EventDeleteEventType], NullType)),
    style: OptionType(PlannerStyleType),
});

/**
 * Type representing the Planner structure.
 */
export type PlannerRootType = typeof PlannerRootType;

// ============================================================================
// Event Input Interface
// ============================================================================

/**
 * TypeScript interface for the ergonomic input passed to {@link createEvent}
 * (`Planner.Event`).
 *
 * @remarks
 * The factory normalises this flat input into a fully-shaped East
 * `PlannerEventType` value — wrapping each optional field in its
 * `OptionType` envelope and converting variant string literals
 * (`"blue"`, `"start"`, `"bold"`) to East variant values.
 *
 * Every field accepts either a plain JS value or an East expression
 * via {@link SubtypeExprOrValue}.
 *
 * @property start - Start slot (or single slot if mode=single)
 * @property end - End slot (only used if mode=span)
 * @property label - Optional rich label (text + alignment + typography)
 * @property icon - Optional Font Awesome icon configuration
 * @property colorPalette - Color scheme for the event background
 * @property background - Explicit background/fill colour (overrides colorPalette)
 * @property stroke - Explicit stroke/border colour (overrides colorPalette)
 * @property opacity - Opacity (0-1)
 * @property overlays - Axis-aligned UIComponent overlays painted inside the bar
 * @property tooltip - Hover-triggered rich tooltip content (UIComponent)
 * @property popover - Click-triggered rich popover content (UIComponent), coexists with `onEventClick`
 */
export interface EventInput {
    /** Start slot (or single slot if mode=single) */
    start: SubtypeExprOrValue<FloatType>;
    /** End slot (only used if mode=span) */
    end?: SubtypeExprOrValue<FloatType>;
    /** Optional rich label (text + alignment + typography) */
    label?: LabelInput;
    /** Optional Font Awesome icon configuration */
    icon?: EventIcon;
    /** Color scheme for the event background */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Explicit background/fill colour (overrides colorPalette) */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit stroke/border colour (overrides colorPalette) */
    stroke?: SubtypeExprOrValue<StringType>;
    /** Opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Axis-aligned UIComponent overlays painted inside the bar */
    overlays?: PlannerOverlayInput[];
    /** Hover-triggered rich tooltip content (UIComponent) */
    tooltip?: SubtypeExprOrValue<UIComponentType>;
    /** Click-triggered rich popover content (UIComponent). Coexists with `onEventClick`. */
    popover?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * TypeScript interface for a Planner event overlay — UIComponent painted
 * at an axis-aligned position inside the event bar.
 *
 * @remarks
 * Mirrors the Matrix overlay pattern. Defaults (when align /
 * verticalAlign omitted) are `"center"` / `"center"`. Pointer events
 * pass through the overlay so drag / click / popover triggers still hit
 * the bar.
 *
 * @property content - The UIComponent painted at the chosen corner
 * @property align - Horizontal alignment (start / center / end). Default `"center"`.
 * @property verticalAlign - Vertical alignment (start / center / end). Default `"center"`.
 */
export interface PlannerOverlayInput {
    /** The UIComponent painted at the chosen corner */
    content: SubtypeExprOrValue<UIComponentType>;
    /** Horizontal alignment (start / center / end). Default `"center"`. */
    align?: AlignLiteral | SubtypeExprOrValue<AlignType>;
    /** Vertical alignment (start / center / end). Default `"center"`. */
    verticalAlign?: AlignLiteral | SubtypeExprOrValue<AlignType>;
}

// ============================================================================
// Event Factory Function
// ============================================================================

/**
 * Builds a single Planner event East value from an ergonomic TS input.
 *
 * @param input - Event configuration ({@link EventInput})
 * @returns An East expression of {@link PlannerEventType}
 *
 * @remarks
 * Use inside the `events` callback of {@link createPlanner}. The callback
 * returns `SubtypeExprOrValue<ArrayType<PlannerEventType>>`, so callers
 * pass either an East-side ArrayExpr (e.g. mapping over an East array
 * field) or a plain JS array of values built by this factory. The
 * factory normalises optional fields (`label` / `icon` / `colorPalette`
 * / `tooltip` / `popover` / `overlays`) into their `OptionType`
 * envelopes and converts variant string literals (`"blue"`, `"start"`,
 * `"bold"`) to East variant values — so callers don't have to reach
 * for `some` / `none` / `variant(...)` directly.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Planner, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ => {
 *     return Planner.Root(
 *         [{ name: "Alice", start: 1.0, end: 4.0 }],
 *         ["name"],
 *         row => [Planner.Event({
 *             start: row.start,
 *             end: row.end,
 *             label: { value: "Task", color: "white" },
 *             colorPalette: "blue",
 *         })],
 *     );
 * });
 * ```
 */
function createEvent(input: EventInput): ExprType<PlannerEventType> {
    // Build event colorPalette
    const colorPaletteValue = input.colorPalette
        ? (typeof input.colorPalette === "string"
            ? East.value(variant(input.colorPalette as any, null), ColorSchemeType)
            : input.colorPalette)
        : undefined;

    // Build label object if provided
    let labelValue = undefined;
    if (input.label) {
        const labelAlignValue = input.label.align
            ? (typeof input.label.align === "string"
                ? East.value(variant(input.label.align, null), AlignType)
                : input.label.align)
            : undefined;

        const labelVerticalAlignValue = input.label.verticalAlign
            ? (typeof input.label.verticalAlign === "string"
                ? East.value(variant(input.label.verticalAlign, null), AlignType)
                : input.label.verticalAlign)
            : undefined;

        const labelFontWeightValue = input.label.fontWeight
            ? (typeof input.label.fontWeight === "string"
                ? East.value(variant(input.label.fontWeight as any, null), FontWeightType)
                : input.label.fontWeight)
            : undefined;

        const labelFontStyleValue = input.label.fontStyle
            ? (typeof input.label.fontStyle === "string"
                ? East.value(variant(input.label.fontStyle as any, null), FontStyleType)
                : input.label.fontStyle)
            : undefined;

        const labelFontSizeValue = input.label.fontSize
            ? (typeof input.label.fontSize === "string"
                ? East.value(variant(input.label.fontSize as any, null), SizeType)
                : input.label.fontSize)
            : undefined;

        labelValue = East.value({
            value: input.label.value,
            align: labelAlignValue ? variant("some", labelAlignValue) : variant("none", null),
            verticalAlign: labelVerticalAlignValue ? variant("some", labelVerticalAlignValue) : variant("none", null),
            color: input.label.color ? variant("some", input.label.color) : variant("none", null),
            fontWeight: labelFontWeightValue ? variant("some", labelFontWeightValue) : variant("none", null),
            fontStyle: labelFontStyleValue ? variant("some", labelFontStyleValue) : variant("none", null),
            fontSize: labelFontSizeValue ? variant("some", labelFontSizeValue) : variant("none", null),
        }, LabelInputType);
    }

    // Build icon object if provided
    let iconValue = undefined;
    if (input.icon) {
        const iconAlignValue = input.icon.align
            ? (typeof input.icon.align === "string"
                ? East.value(variant(input.icon.align, null), AlignType)
                : input.icon.align)
            : undefined;

        const iconSizeValue = input.icon.size
            ? (typeof input.icon.size === "string"
                ? East.value(variant(input.icon.size as any, null), IconSizeType)
                : input.icon.size)
            : undefined;

        const iconColorPaletteValue = input.icon.colorPalette
            ? (typeof input.icon.colorPalette === "string"
                ? East.value(variant(input.icon.colorPalette as any, null), ColorSchemeType)
                : input.icon.colorPalette)
            : undefined;

        iconValue = East.value({
            prefix: input.icon.prefix,
            name: input.icon.name,
            align: iconAlignValue ? variant("some", iconAlignValue) : variant("none", null),
            size: iconSizeValue ? variant("some", iconSizeValue) : variant("none", null),
            color: input.icon.color ? variant("some", input.icon.color) : variant("none", null),
            colorPalette: iconColorPaletteValue ? variant("some", iconColorPaletteValue) : variant("none", null),
        }, EventIconType);
    }

    const overlays = (input.overlays ?? []).map(o => {
        const align = o.align !== undefined
            ? (typeof o.align === "string"
                ? East.value(variant(o.align as AlignLiteral, null), AlignType)
                : o.align)
            : East.value(variant("center", null), AlignType);
        const verticalAlign = o.verticalAlign !== undefined
            ? (typeof o.verticalAlign === "string"
                ? East.value(variant(o.verticalAlign as AlignLiteral, null), AlignType)
                : o.verticalAlign)
            : East.value(variant("center", null), AlignType);
        return East.value({ content: o.content, align, verticalAlign }, OverlayInputType);
    });

    return East.value({
        start: input.start,
        end: input.end ? variant("some", input.end) : variant("none", null),
        label: labelValue ? variant("some", labelValue) : variant("none", null),
        icon: iconValue ? variant("some", iconValue) : variant("none", null),
        colorPalette: colorPaletteValue ? variant("some", colorPaletteValue) : variant("none", null),
        background: input.background ? variant("some", input.background) : variant("none", null),
        stroke: input.stroke ? variant("some", input.stroke) : variant("none", null),
        opacity: input.opacity ? variant("some", input.opacity) : variant("none", null),
        overlays,
        tooltip: input.tooltip !== undefined ? some(input.tooltip) : none,
        popover: input.popover !== undefined ? some(input.popover) : none,
    }, PlannerEventType);
}

// ============================================================================
// Column Configuration
// ============================================================================

// Helper types to extract struct fields from array data type
type ExtractStructFields<T> = T extends ArrayType<infer S>
    ? S extends StructType
    ? S["fields"]
    : never
    : never;

type ExtractElement<T> = T extends ArrayType<infer E> ? E : never;

// Helper type to extract the row element type from an array type (always StructType due to constraint)
type ExtractRowType<T> = T extends ArrayType<infer S>
    ? S extends StructType
    ? S
    : StructType
    : StructType;

type DataFields<T extends SubtypeExprOrValue<ArrayType<StructType>>> = ExtractStructFields<TypeOf<T>>;

type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> = ExtractElement<TypeOf<T>>;

type DataRowType<T extends SubtypeExprOrValue<ArrayType<StructType>>> = ExtractRowType<TypeOf<T>>;

// Column specification can be array of keys or object config
type ColumnSpec<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    | (keyof DataFields<NoInfer<T>>)[]
    | { [K in keyof DataFields<NoInfer<T>>]?: TableColumnConfig<DataFields<NoInfer<T>>[K], DataRowType<NoInfer<T>>> };

// Every key in the data struct is a valid column key. Deriving from T (rather
// than the columns object) keeps inference reliable when the column configs
// contain render functions or complex field types.
type DataFieldKeys<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    Extract<keyof DataFields<NoInfer<T>>, string>;

// ============================================================================
// Main Planner Factory
// ============================================================================

/**
 * Creates an Planner component following the Table/Gantt pattern.
 *
 * @typeParam T - The struct type of each data row
 * @param data - Array of data structs
 * @param columns - Column specification for the left-side table columns
 * @param events - Function to extract events from each row
 * @param style - Optional Planner styling
 * @returns An East expression representing the Planner component
 *
 * @example
 * ```ts
 * import { East, IntegerType, StringType } from "@elaraai/east";
 * import { Planner, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Planner.Root(
 *         [
 *             { name: "Alice", start: 1n, end: 3n },
 *             { name: "Bob", start: 2n, end: 5n },
 *         ],
 *         ["name"],
 *         row => [{ start: row.start, end: row.end }],
 *         {
 *             slotLabel: East.function([IntegerType], StringType, ($, slot) => {
 *                 return East.str`Day ${slot}`;
 *             }),
 *         }
 *     );
 * });
 * ```
 */
function createPlanner<
    T extends SubtypeExprOrValue<ArrayType<StructType>>,
    C extends ColumnSpec<T> = ColumnSpec<T>,
>(
    data: T,
    columns: C,
    events: (row: ExprType<RowElement<T>>) => SubtypeExprOrValue<ArrayType<PlannerEventType>>,
    style?: PlannerStyle<DataFieldKeys<T>>
): ExprType<UIComponentType> {
    const data_expr = East.value(data) as ExprType<ArrayType<StructType>>;
    const field_types = Expr.type(data_expr).value.fields;

    // Normalize columns to object format
    // dataType: the original field type from the data struct
    // valueType: the type after applying value function (computed during row mapping)
    const columnEntries = Array.isArray(columns)
        ? (columns as string[]).map(key => [key, undefined] as const)
        : Object.entries(columns);

    const columns_obj = Object.fromEntries(columnEntries.map(([key, config]) => {
        const fieldType = field_types[key as keyof typeof field_types] as EastType;
        return [key, {
            ...config,
            dataType: toEastTypeValue(fieldType),
        }];
    })) as Record<string, TableColumnConfig & { dataType: EastTypeValue; valueType: EastTypeValue }>;

    // Map each data row to an PlannerRow with cells and events
    const rows_mapped = data_expr.map(($, datum) => {
        // Build cells dict (same as Table)
        const cells = $.let(new Map(), DictType(StringType, StructType({
            value: LiteralValueType,
            content: OptionType(UIComponentType)
        })));

        for (const [col_key, col_config] of Object.entries(columns_obj)) {
            const field_value = (datum as any)[col_key];
            const field_type = field_types[col_key];

            // Get cell value: use custom value function if provided, otherwise use field value directly
            let cellValue;
            if ((col_config as any).value) {
                const customValue = East.value((col_config as any).value(field_value, datum as any));
                const customValueType = Expr.type(customValue) as EastType;
                cellValue = variant(customValueType.type as any, customValue);
            } else {
                cellValue = variant(field_type.type, field_value);
            }

            // get the value type tag from cellValue
            const valueTypeTag = cellValue.type as string;

            // check that the type is a valid LiteralValueType (primitive) tag
            if (valueTypeTag !== "Null" && valueTypeTag !== "Boolean" && valueTypeTag !== "Integer" &&
                valueTypeTag !== "Float" && valueTypeTag !== "String" && valueTypeTag !== "DateTime" &&
                valueTypeTag !== "Blob") {
                throw new Error(`Column "${col_key}" has value type "${valueTypeTag}" which is not a valid column type. Complex types require a value function that returns a primitive type.`);
            }

            // get the valueType as EastTypeValue
            const valueType = variant(valueTypeTag, null) as EastTypeValue;

            // if valueType in columns_obj is already defined, check it matches
            if (col_config.valueType !== undefined) {
                if (!isTypeValueEqual(col_config.valueType, valueType)) {
                    throw new Error(`Column "${col_key}" has inconsistent value types across rows: expected "${col_config.valueType.type}" but got "${valueTypeTag}"`);
                }
            } else {
                // set the valueType for this column
                (col_config as any).valueType = valueType;
            }

            const content = col_config.render
                ? none
                : some(East.value(
                    Text.Root(East.str`${field_value}`, {
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }),
                    UIComponentType
                ));

            $(cells.insert(col_key, {
                value: cellValue,
                content,
            }));
        }

        // Get events from the row using the events function. The callback
        // returns a `SubtypeExprOrValue<ArrayType<PlannerEventType>>` — either
        // an East-side ArrayExpr (e.g. `row.events.map(...)`) or a plain JS
        // array of `ExprType<PlannerEventType>` values produced by
        // `Planner.Event(...)`. Both forms are accepted directly by East.value
        // when constructing the row struct.
        const row_events = $.let(events(datum as any), ArrayType(PlannerEventType));

        return East.value({
            cells: cells,
            events: row_events,
        }, PlannerRowType);
    });

    // Create columns array from the columns config
    const columns_mapped: SubtypeExprOrValue<ArrayType<typeof TableColumnType>> = [];
    for (const [key, config] of Object.entries(columns_obj)) {
        columns_mapped.push({
            key: key,
            dataType: config.dataType,
            valueType: config.valueType,
            header: config?.header !== undefined ? some(config.header) : some(key) as any,
            width: config?.width !== undefined ? some(config.width) : none as any,
            minWidth: config?.minWidth !== undefined ? some(config.minWidth) : none as any,
            maxWidth: config?.maxWidth !== undefined ? some(config.maxWidth) : none as any,
            render: config?.render
                ? some(East.value(config.render, FunctionType([TableCellRenderContextType], UIComponentType)))
                : none as any,
        });
    }

    // Reorder columns: frozen first, then the rest
    const frozenKeys = (style?.frozen ?? []) as string[];
    const frozenSet = new Set(frozenKeys);
    const columnsByKey = new Map(columns_mapped.map(c => [(c as any).key as string, c]));
    const orderedColumns: typeof columns_mapped = [
        ...frozenKeys.filter(key => columnsByKey.has(key)).map(key => columnsByKey.get(key)!),
        ...columns_mapped.filter(c => !frozenSet.has((c as any).key as string)),
    ];

    const columns_expr = East.value(orderedColumns, ArrayType(TableColumnType));
    const frozen_expr = East.value(frozenKeys, ArrayType(StringType));

    // Build style value
    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), TableVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), TableSizeType)
            : style.size)
        : undefined;

    const slotModeValue = style?.slotMode
        ? (typeof style.slotMode === "string"
            ? East.value(variant(style.slotMode, null), SlotModeType)
            : style.slotMode)
        : undefined;

    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette as any, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const hasVisualStyle = !!style && (
        style.height !== undefined ||
        style.variant !== undefined ||
        style.size !== undefined ||
        style.striped !== undefined ||
        style.stickyHeader !== undefined ||
        style.showColumnBorder !== undefined ||
        style.slotMinWidth !== undefined ||
        style.colorPalette !== undefined ||
        style.slotLineStroke !== undefined ||
        style.slotLineWidth !== undefined ||
        style.slotLineDash !== undefined ||
        style.slotLineOpacity !== undefined ||
        style.gridColor !== undefined ||
        style.nowMarkerColor !== undefined ||
        style.headerBackground !== undefined ||
        style.headerColor !== undefined ||
        style.eventBorderRadius !== undefined ||
        style.labelColor !== undefined ||
        style.labelFontSize !== undefined ||
        style.labelFontWeight !== undefined
    );

    const styleValue = hasVisualStyle ? East.value({
        height: style!.height ? some(style!.height) : none,
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        striped: style!.striped !== undefined ? some(style!.striped) : none,
        stickyHeader: style!.stickyHeader !== undefined ? some(style!.stickyHeader) : none,
        showColumnBorder: style!.showColumnBorder !== undefined ? some(style!.showColumnBorder) : none,
        slotMinWidth: style!.slotMinWidth ? some(style!.slotMinWidth) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        slotLineStroke: style!.slotLineStroke ? some(style!.slotLineStroke) : none,
        slotLineWidth: style!.slotLineWidth !== undefined ? some(style!.slotLineWidth) : none,
        slotLineDash: style!.slotLineDash ? some(style!.slotLineDash) : none,
        slotLineOpacity: style!.slotLineOpacity !== undefined ? some(style!.slotLineOpacity) : none,
        gridColor: style!.gridColor !== undefined ? some(style!.gridColor) : none,
        nowMarkerColor: style!.nowMarkerColor !== undefined ? some(style!.nowMarkerColor) : none,
        headerBackground: style!.headerBackground !== undefined ? some(style!.headerBackground) : none,
        headerColor: style!.headerColor !== undefined ? some(style!.headerColor) : none,
        eventBorderRadius: style!.eventBorderRadius !== undefined ? some(style!.eventBorderRadius) : none,
        labelColor: style!.labelColor !== undefined ? some(style!.labelColor) : none,
        labelFontSize: style!.labelFontSize !== undefined ? some(style!.labelFontSize) : none,
        labelFontWeight: style!.labelFontWeight !== undefined ? some(style!.labelFontWeight) : none,
    }, PlannerStyleType) : undefined;

    const boundariesValue = style?.boundaries
        ? some(style.boundaries.map(b => East.value({
            x: b.x,
            stroke: b.stroke ? some(b.stroke) : none,
            strokeWidth: b.strokeWidth !== undefined ? some(b.strokeWidth) : none,
            strokeDash: b.strokeDash ? some(b.strokeDash) : none,
            strokeOpacity: b.strokeOpacity !== undefined ? some(b.strokeOpacity) : none,
        }, PlannerBoundaryType)))
        : none;

    return East.value(variant("Planner", {
        rows: rows_mapped,
        columns: columns_expr,
        frozen: frozen_expr,
        slotMode: slotModeValue ? some(slotModeValue) : none,
        minSlot: style?.minSlot !== undefined ? some(style.minSlot) : none,
        maxSlot: style?.maxSlot !== undefined ? some(style.maxSlot) : none,
        stepSize: style?.stepSize !== undefined ? some(style.stepSize) : none,
        slotLabel: style?.slotLabel ? some(style.slotLabel) : none,
        boundaries: boundariesValue,
        rowStatus: style?.rowStatus !== undefined
            ? some(East.value(style.rowStatus, FunctionType([IntegerType], StatusTokenType)))
            : none,
        onCellClick: style?.onCellClick ? some(style.onCellClick) : none,
        onCellDoubleClick: style?.onCellDoubleClick ? some(style.onCellDoubleClick) : none,
        onRowClick: style?.onRowClick ? some(style.onRowClick) : none,
        onRowDoubleClick: style?.onRowDoubleClick ? some(style.onRowDoubleClick) : none,
        onSortChange: style?.onSortChange ? some(style.onSortChange) : none,
        onEventClick: style?.onEventClick ? some(style.onEventClick) : none,
        onEventDoubleClick: style?.onEventDoubleClick ? some(style.onEventDoubleClick) : none,
        onEventDrag: style?.onEventDrag ? some(style.onEventDrag) : none,
        onEventResize: style?.onEventResize ? some(style.onEventResize) : none,
        onEventAdd: style?.onEventAdd ? some(style.onEventAdd) : none,
        onEventEdit: style?.onEventEdit ? some(style.onEventEdit) : none,
        onEventDelete: style?.onEventDelete ? some(style.onEventDelete) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

// ============================================================================
// Namespace Export
// ============================================================================

/** Type for the Planner namespace */
interface PlannerNamespace {
    Root: typeof createPlanner;
    Event: typeof createEvent;
    Types: {
        Root: typeof PlannerRootType;
        Row: typeof PlannerRowType;
        Event: typeof PlannerEventType;
        Label: typeof LabelInputType;
        EventIcon: typeof EventIconType;
        Align: typeof AlignType;
        Style: typeof PlannerStyleType;
        SlotMode: typeof SlotModeType;
        Boundary: typeof PlannerBoundaryType;
        ClickEvent: typeof EventClickEventType;
        DragEvent: typeof EventDragEventType;
        ResizeEvent: typeof EventResizeEventType;
        AddEvent: typeof EventAddEventType;
        DeleteEvent: typeof EventDeleteEventType;
        Column: typeof TableColumnType;
        Cell: typeof TableCellType;
    };
}

/**
 * Planner namespace for creating integer-slot-based scheduling components.
 *
 * @remarks
 * Planner displays rows with integer-based events (slots).
 * Each row has table columns on the left and a slot grid with events on the right.
 * The API follows the Table/Gantt pattern for column configuration.
 */
export const Planner: PlannerNamespace = {
    /**
     * Creates an Planner component following the Table/Gantt pattern.
     *
     * @typeParam T - The struct type of each data row
     * @param data - Array of data structs
     * @param columns - Column specification for the left-side table columns
     * @param events - Function to extract events from each row
     * @param style - Optional Planner styling
     * @returns An East expression representing the Planner component
     *
     * @remarks
     * Planner displays rows with integer-based events (slots).
     * Each row has table columns on the left and a slot grid with events on the right.
     * The slot range is derived from event data with optional min/max overrides.
     *
     * @example
     * ```ts
     * import { East, IntegerType, StringType } from "@elaraai/east";
     * import { Planner, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Planner.Root(
     *         [
     *             { name: "Alice", start: 1n, end: 3n },
     *             { name: "Bob", start: 2n, end: 5n },
     *         ],
     *         ["name"],
     *         row => [Planner.Event({ start: row.start, end: row.end })],
     *         {
     *             slotLabel: East.function([IntegerType], StringType, ($, slot) => {
     *                 return East.str`Day ${slot}`;
     *             }),
     *         }
     *     );
     * });
     * ```
     */
    Root: createPlanner,
    /**
     * Builds a single Planner event East value from an ergonomic TS input.
     *
     * @param input - Event configuration ({@link EventInput})
     * @returns An East expression of {@link PlannerEventType}
     *
     * @remarks
     * Use inside the `events` callback of `Planner.Root`. The callback's
     * return type is `SubtypeExprOrValue<ArrayType<PlannerEventType>>`,
     * so callers pass an East-side ArrayExpr or a JS array of values
     * built by this factory. The factory normalises optional fields
     * (`label` / `icon` / `colorPalette` / `tooltip` / `popover` /
     * `overlays`) into their `OptionType` envelopes and converts variant
     * string literals (`"blue"`, `"start"`, `"bold"`) to East variant
     * values — flat TS input in, fully-shaped East value out.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Planner, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ => {
     *     return Planner.Root(
     *         [{ name: "Alice", start: 1.0, end: 4.0 }],
     *         ["name"],
     *         row => [Planner.Event({
     *             start: row.start,
     *             end: row.end,
     *             label: { value: "Task", color: "white" },
     *             colorPalette: "blue",
     *         })],
     *     );
     * });
     * ```
     */
    Event: createEvent,
    Types: {
        /**
         * East StructType for the entire Planner value — the root IR.
         *
         * @remarks
         * The main struct carries content (`rows` / `columns`
         * / `frozen`), timeline configuration, structured state
         * (`rowStatus`), and behaviour callbacks; visual-only fields live
         * inside the optional `style` sub-struct ({@link PlannerStyleType}).
         *
         * @property rows - Array of Planner rows ({@link PlannerRowType})
         * @property columns - Array of column definitions (shared with Table)
         * @property frozen - Column keys to freeze (pin left)
         * @property slotMode - Slot mode (single / span)
         * @property minSlot - Optional min slot override
         * @property maxSlot - Optional max slot override
         * @property stepSize - Step size for snapping
         * @property slotLabel - Custom slot label function
         * @property boundaries - Vertical boundary lines
         * @property rowStatus - Row-status callback `(rowIndex) => StatusToken`
         * @property onCellClick - Cell click callback
         * @property onCellDoubleClick - Cell double-click callback
         * @property onRowClick - Row click callback
         * @property onRowDoubleClick - Row double-click callback
         * @property onSortChange - Sort change callback
         * @property onEventClick - Event click callback
         * @property onEventDoubleClick - Event double-click callback
         * @property onEventDrag - Event drag callback (presence enables drag)
         * @property onEventResize - Event resize callback (presence enables resize)
         * @property onEventAdd - Empty-slot click callback (presence enables add)
         * @property onEventEdit - Context-menu edit callback
         * @property onEventDelete - Context-menu delete callback
         * @property style - Optional visual style sub-struct
         */
        Root: PlannerRootType,
        /**
         * East StructType for a single Planner row.
         *
         * @remarks
         * Each row pairs `cells` (the dict of column-keyed table cells,
         * shared with the Table primitive) with `events` (the array of
         * Planner-event values painted on the row's slot grid).
         *
         * @property cells - Dict of column key to cell content (shared with Table)
         * @property events - Array of events ({@link PlannerEventType})
         */
        Row: PlannerRowType,
        /**
         * East StructType for a single Planner event — the row's slot bar.
         *
         * @remarks
         * Every optional field is wrapped in `OptionType`. Use the
         * {@link createEvent | `Planner.Event`} factory to construct
         * values from a flat TS interface; the factory handles the
         * `some` / `none` / `variant(...)` envelopes for you.
         *
         * @property start - Start slot (or single slot if mode=single)
         * @property end - End slot (only used if mode=span)
         * @property label - Optional rich label (text + alignment + typography)
         * @property icon - Optional Font Awesome icon configuration
         * @property colorPalette - Color scheme for the event background
         * @property background - Explicit fill colour override
         * @property stroke - Explicit stroke colour override
         * @property opacity - Opacity (0-1)
         * @property overlays - Axis-aligned UIComponent overlays
         * @property tooltip - Hover-triggered rich tooltip (UIComponent)
         * @property popover - Click-triggered rich popover (UIComponent)
         */
        Event: PlannerEventType,
        /**
         * Rich label configuration for Planner events — re-export of the
         * shared {@link LabelInputType} from `@elaraai/east-ui` for ergonomic
         * discovery via `Planner.Types.Label`.
         *
         * @property value - The label text (required)
         * @property align - Horizontal position within the event (start, center, end)
         * @property verticalAlign - Vertical position within the event (start, center, end)
         * @property color - Text color
         * @property fontWeight - Font weight
         * @property fontStyle - Font style
         * @property fontSize - Font size
         */
        Label: LabelInputType,
        /**
         * Icon configuration for Planner events.
         *
         * @property prefix - Font Awesome prefix (fas, far, fab, etc.)
         * @property name - Font Awesome icon name
         * @property align - Position within the event (start, center, end)
         * @property size - Icon size
         * @property color - Icon color
         * @property colorPalette - Color scheme for the icon
         */
        EventIcon: EventIconType,
        /**
         * Axis alignment variant — re-export of the shared {@link AlignType}
         * from `@elaraai/east-ui` for ergonomic discovery via `Planner.Types.Align`.
         *
         * @property start - Align to the start (left / top)
         * @property center - Align to center
         * @property end - Align to the end (right / bottom)
         */
        Align: AlignType,
        /**
         * East StructType holding every visual field for a Planner.
         *
         * @remarks
         * Visual-only. Mirror of {@link PlannerStyleType} —
         * exposed on the namespace so consumers can reference the IR
         * style type via `Planner.Types.Style`.
         *
         * @property height - CSS height for the Planner container
         * @property variant - Table variant (line / outline)
         * @property size - Table size (sm / md / lg)
         * @property striped - Whether to show zebra stripes on rows
         * @property stickyHeader - Whether the header sticks when scrolling
         * @property showColumnBorder - Whether to show borders between columns
         * @property slotMinWidth - Min width per slot (CSS value, default `"60px"`)
         * @property colorPalette - Default color scheme for events
         * @property slotLineStroke - Vertical grid line colour
         * @property slotLineWidth - Vertical grid line width in pixels
         * @property slotLineDash - Vertical grid line dash pattern
         * @property slotLineOpacity - Vertical grid line opacity (0-1)
         * @property gridColor - Explicit grid colour
         * @property nowMarkerColor - Explicit now-marker colour
         * @property headerBackground - Header row background
         * @property headerColor - Header row text colour
         * @property eventBorderRadius - CSS border-radius for event bars
         * @property labelColor - Default text colour for per-event labels
         * @property labelFontSize - Default CSS font-size for per-event labels
         * @property labelFontWeight - Default CSS font-weight for per-event labels
         */
        Style: PlannerStyleType,
        /**
         * Slot mode variant — controls how events occupy the slot grid.
         *
         * @remarks
         * Use string literals (`"single"` / `"span"`) at call sites; the
         * factory normalises them into East variant values.
         *
         * @property single - Each event occupies exactly one slot (start only)
         * @property span - Events span from start to end (inclusive)
         */
        SlotMode: SlotModeType,
        /**
         * East StructType for a vertical boundary line at a specific
         * slot position — typically used to mark deadlines / milestones
         * on the timeline.
         *
         * @remarks
         * Boundaries are rendered as full-height vertical lines on the
         * slot grid. Stroke / dash / opacity all default to sensible
         * values when omitted.
         *
         * @property x - Slot position for the boundary line
         * @property stroke - Line colour
         * @property strokeWidth - Line width in pixels
         * @property strokeDash - Dash pattern (e.g. `"4 2"`)
         * @property strokeOpacity - Line opacity (0-1)
         */
        Boundary: PlannerBoundaryType,
        /**
         * East StructType for the event payload of `onEventClick` /
         * `onEventDoubleClick` / `onEventEdit` callbacks.
         *
         * @property rowIndex - Row index (0-based)
         * @property eventIndex - Event index within the row (0-based)
         * @property start - Start slot of the event
         * @property end - End slot of the event (same as start for single-slot mode)
         */
        ClickEvent: EventClickEventType,
        /**
         * East StructType for the event payload of `onEventDrag`.
         *
         * @remarks
         * The renderer fires this when a user finishes dragging an event
         * to a new position. Both previous and new slot positions are
         * provided so the consumer can validate / undo / persist as
         * needed.
         *
         * @property rowIndex - Row index (0-based)
         * @property eventIndex - Event index within the row (0-based)
         * @property previousStart - Slot position before the drag
         * @property previousEnd - End slot before the drag
         * @property newStart - New start slot after the drag
         * @property newEnd - New end slot after the drag
         */
        DragEvent: EventDragEventType,
        /**
         * East StructType for the event payload of `onEventResize`.
         *
         * @remarks
         * Same shape as `DragEvent` plus an `edge` discriminator marking
         * which edge (start / end) was dragged.
         *
         * @property rowIndex - Row index (0-based)
         * @property eventIndex - Event index within the row (0-based)
         * @property previousStart - Slot position before the resize
         * @property previousEnd - End slot before the resize
         * @property newStart - New start slot after the resize
         * @property newEnd - New end slot after the resize
         * @property edge - Which edge was dragged (start / end)
         */
        ResizeEvent: EventResizeEventType,
        /**
         * East StructType for the event payload of `onEventAdd`.
         *
         * @remarks
         * Renderer fires this when a user clicks an unoccupied slot —
         * the callback's presence on `onEventAdd` is what enables the
         * empty-slot affordance in the first place.
         *
         * @property rowIndex - Row index (0-based)
         * @property slot - Slot the user clicked
         */
        AddEvent: EventAddEventType,
        /**
         * East StructType for the event payload of `onEventDelete`.
         *
         * @property rowIndex - Row index (0-based)
         * @property eventIndex - Event index within the row (0-based)
         * @property start - Start slot of the deleted event
         * @property end - End slot of the deleted event
         */
        DeleteEvent: EventDeleteEventType,
        /**
         * East StructType for a table column definition — re-export of
         * the shared {@link TableColumnType} so consumers can reference
         * column shape via `Planner.Types.Column`.
         *
         * @property key - The column key (field name)
         * @property dataType - Original data field type
         * @property valueType - Sortable / display value type after value-fn
         * @property header - Optional header text
         * @property width - Optional CSS width
         * @property minWidth - Optional CSS min-width
         * @property maxWidth - Optional CSS max-width
         * @property render - Optional render function for cell content
         */
        Column: TableColumnType,
        /**
         * East StructType for a table cell — re-export of the shared
         * {@link TableCellType} so consumers can reference the cell
         * shape via `Planner.Types.Cell`.
         *
         * @property value - The literal cell value (used for sorting)
         * @property content - Optional pre-rendered UIComponent body
         */
        Cell: TableCellType,
    },
};
