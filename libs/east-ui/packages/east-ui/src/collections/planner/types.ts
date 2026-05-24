/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    VariantType,
    StringType,
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
    FunctionType
} from "@elaraai/east";

import { TableCellClickEventType, TableRowClickEventType, TableSortEventType } from "../table/types.js";

import {
    AlignType,
    ColorSchemeType,
    type ColorSchemeLiteral,
    type AlignLiteral,
} from "../../style.js";
import { StatusTokenType } from "../../style/interaction.js";

import {
    IconSizeType,
    type IconSizeLiteral,
} from "../../display/icon/types.js";

// Re-export Font Awesome types for convenience
export type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";

// Re-export shared content primitives under the Planner namespace
// for ergonomic discovery via `Planner.Types.*`.
export { AlignType, LabelInputType, type AlignLiteral, type LabelInput } from "../../style.js";

// Import shared types from table
import {
    TableVariantType,
    TableSizeType,
    type TableVariantLiteral,
    type TableSizeLiteral,
} from "../table/types.js";

// Re-export table types used by Planner
export {
    TableVariantType,
    TableSizeType,
    type TableVariantLiteral,
    type TableSizeLiteral,
} from "../table/types.js";

// ============================================================================
// Slot Mode Type
// ============================================================================

/**
 * Slot mode variant type - determines how events occupy slots.
 *
 * @property single - Each event occupies exactly one slot (start only)
 * @property span - Events span from start to end slot (inclusive)
 */
export const SlotModeType = VariantType({
    /** Each event occupies exactly one slot */
    single: NullType,
    /** Events span from start to end slot (inclusive) */
    span: NullType,
});

export type SlotModeType = typeof SlotModeType;

/**
 * String literal type for slot mode values.
 */
export type SlotModeLiteral = "single" | "span";

// ============================================================================
// Event Icon Type
// ============================================================================

/**
 * Icon configuration for Planner events.
 *
 * @property prefix - Font Awesome prefix (fas, far, fab, etc.)
 * @property name - Font Awesome icon name
 * @property align - Position within the event (start, center, end)
 * @property size - Icon size
 * @property color - Icon color (CSS color or Chakra token)
 * @property colorPalette - Color scheme for the icon
 */
export const EventIconType = StructType({
    prefix: StringType,
    name: StringType,
    align: OptionType(AlignType),
    size: OptionType(IconSizeType),
    color: OptionType(StringType),
    colorPalette: OptionType(ColorSchemeType),
});

export type EventIconType = typeof EventIconType;

/**
 * TypeScript interface for event icon input.
 */
export interface EventIcon {
    /** Font Awesome prefix (fas, far, fab, etc.) */
    prefix: string;
    /** Font Awesome icon name */
    name: string;
    /** Position within the event (start, center, end). Default: start */
    align?: SubtypeExprOrValue<AlignType> | AlignLiteral;
    /** Icon size */
    size?: SubtypeExprOrValue<IconSizeType> | IconSizeLiteral;
    /** Icon color (CSS color or Chakra token) */
    color?: SubtypeExprOrValue<StringType>;
    /** Color scheme for the icon */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
}

// NOTE: `PlannerEventType` is UIComp-coupled (it carries `tooltip` and
// `popover` UIComponent slots) and lives in `./index.ts` alongside the
// factory. types.ts stays UIComp-free so it can be imported by
// `component.ts` without a circular dependency.

// ============================================================================
// Callback Event Types
// ============================================================================

/**
 * Event data for event click events.
 *
 * @property rowIndex - Row index (0-based)
 * @property eventIndex - Event index within the row (0-based)
 * @property start - Start slot of the event
 * @property end - End slot of the event (same as start if single-slot mode)
 */
export const EventClickEventType = StructType({
    rowIndex: IntegerType,
    eventIndex: IntegerType,
    start: FloatType,
    end: FloatType,
});

export type EventClickEventType = typeof EventClickEventType;

/**
 * Event data for event drag (move) events.
 *
 * @property rowIndex - Row index (0-based)
 * @property eventIndex - Event index within the row (0-based)
 * @property previousStart - Previous start slot
 * @property previousEnd - Previous end slot
 * @property newStart - New start slot
 * @property newEnd - New end slot
 */
export const EventDragEventType = StructType({
    rowIndex: IntegerType,
    eventIndex: IntegerType,
    previousStart: FloatType,
    previousEnd: FloatType,
    newStart: FloatType,
    newEnd: FloatType,
});

export type EventDragEventType = typeof EventDragEventType;

/**
 * Edge variant for resize events.
 *
 * @property start - The start edge was dragged
 * @property end - The end edge was dragged
 */
export const ResizeEdgeType = VariantType({
    start: NullType,
    end: NullType,
});

export type ResizeEdgeType = typeof ResizeEdgeType;

/**
 * Event data for event resize events.
 *
 * @property rowIndex - Row index (0-based)
 * @property eventIndex - Event index within the row (0-based)
 * @property previousStart - Previous start slot
 * @property previousEnd - Previous end slot
 * @property newStart - New start slot
 * @property newEnd - New end slot
 * @property edge - Which edge was dragged (start or end)
 */
export const EventResizeEventType = StructType({
    rowIndex: IntegerType,
    eventIndex: IntegerType,
    previousStart: FloatType,
    previousEnd: FloatType,
    newStart: FloatType,
    newEnd: FloatType,
    edge: ResizeEdgeType,
});

export type EventResizeEventType = typeof EventResizeEventType;

/**
 * Event data for event add events.
 *
 * @property rowIndex - Row index (0-based)
 * @property slot - Slot where the event should be added
 */
export const EventAddEventType = StructType({
    rowIndex: IntegerType,
    slot: FloatType,
});

export type EventAddEventType = typeof EventAddEventType;

/**
 * Event data for event delete events.
 *
 * @property rowIndex - Row index (0-based)
 * @property eventIndex - Event index within the row (0-based)
 * @property start - Start slot of the event
 * @property end - End slot of the event
 */
export const EventDeleteEventType = StructType({
    rowIndex: IntegerType,
    eventIndex: IntegerType,
    start: FloatType,
    end: FloatType,
});

export type EventDeleteEventType = typeof EventDeleteEventType;

// ============================================================================
// Boundary Type
// ============================================================================

/**
 * Boundary data for Planner - vertical lines at specific slot positions.
 *
 * @remarks
 * Boundaries are vertical lines that span the full height of the chart
 * at a specific x (slot) position. Useful for marking deadlines, milestones,
 * or other significant points.
 *
 * @property x - The slot position for the boundary line
 * @property stroke - Line color (CSS color value)
 * @property strokeWidth - Line width in pixels
 * @property strokeDash - Dash pattern (e.g., "4 2" for dashed line)
 * @property strokeOpacity - Line opacity (0-1)
 */
export const PlannerBoundaryType = StructType({
    x: FloatType,
    stroke: OptionType(StringType),
    strokeWidth: OptionType(FloatType),
    strokeDash: OptionType(StringType),
    strokeOpacity: OptionType(FloatType),
});

/**
 * Type representing the Planner boundary structure.
 */
export type PlannerBoundaryType = typeof PlannerBoundaryType;

/**
 * TypeScript interface for Planner boundary input.
 *
 * @remarks
 * Accepts both static values and East expressions.
 */
export interface PlannerBoundary {
    /** The slot position for the boundary line */
    x: SubtypeExprOrValue<FloatType>;
    /** Line color (CSS color value) */
    stroke?: SubtypeExprOrValue<StringType>;
    /** Line width in pixels */
    strokeWidth?: SubtypeExprOrValue<FloatType>;
    /** Dash pattern (e.g., "4 2" for dashed line) */
    strokeDash?: SubtypeExprOrValue<StringType>;
    /** Line opacity (0-1) */
    strokeOpacity?: SubtypeExprOrValue<FloatType>;
}

// ============================================================================
// Style Type
// ============================================================================

/**
 * East StructType holding every visual field for a Planner.
 *
 * @remarks
 * Visual-only. Content (`rows` / `columns` / `frozen`),
 * structured state (`rowStatus`), behaviour callbacks (`on*`), and
 * timeline configuration (`slotMode` / `minSlot` / `maxSlot` /
 * `stepSize` / `slotLabel` / `boundaries`) live on the main
 * `Planner` variant in `index.ts`, not in this struct.
 *
 * Drag / resize / add / delete behaviour is driven by callback
 * presence on main (Matrix-style) — there is no `readOnly` flag.
 * Row hover is always on — there is no `interactive` flag.
 *
 * @property height - CSS height for the Planner container
 * @property variant - Table variant (line or outline)
 * @property size - Table size (sm, md, lg)
 * @property striped - Whether to show zebra stripes on rows
 * @property stickyHeader - Whether the header sticks when scrolling
 * @property showColumnBorder - Whether to show borders between columns
 * @property slotMinWidth - Min width per slot (CSS value, default `"60px"`)
 * @property colorPalette - Default color scheme for events
 * @property slotLineStroke - Vertical grid line color
 * @property slotLineWidth - Vertical grid line width in pixels
 * @property slotLineDash - Vertical grid line dash pattern
 * @property slotLineOpacity - Vertical grid line opacity (0-1)
 * @property gridColor - Explicit grid colour
 * @property nowMarkerColor - Explicit now-marker colour
 * @property headerBackground - Header row background
 * @property headerColor - Header row text colour
 * @property eventBorderRadius - CSS border-radius for event bars (default `"4px"`)
 * @property labelColor - Default text colour for per-event labels (per-event `label.color` overrides)
 * @property labelFontSize - Default CSS `font-size` for per-event labels (per-event `label.fontSize` overrides)
 * @property labelFontWeight - Default CSS `font-weight` for per-event labels (per-event `label.fontWeight` overrides)
 */
export const PlannerStyleType = StructType({
    // Table styling (reused from Table)
    height: OptionType(StringType),
    variant: OptionType(TableVariantType),
    size: OptionType(TableSizeType),
    striped: OptionType(BooleanType),
    stickyHeader: OptionType(BooleanType),
    showColumnBorder: OptionType(BooleanType),

    // Visual-only Planner fields
    slotMinWidth: OptionType(StringType),
    colorPalette: OptionType(ColorSchemeType),

    // Slot line styling (vertical grid lines)
    slotLineStroke: OptionType(StringType),
    slotLineWidth: OptionType(FloatType),
    slotLineDash: OptionType(StringType),
    slotLineOpacity: OptionType(FloatType),

    // Root chrome colour slots
    gridColor: OptionType(StringType),
    nowMarkerColor: OptionType(StringType),
    headerBackground: OptionType(StringType),
    headerColor: OptionType(StringType),

    // Visual parity with Matrix — event chrome + label defaults.
    eventBorderRadius: OptionType(StringType),
    labelColor: OptionType(StringType),
    labelFontSize: OptionType(StringType),
    labelFontWeight: OptionType(StringType),
});

/**
 * Type representing the Planner style structure.
 */
export type PlannerStyleType = typeof PlannerStyleType;

/**
 * TypeScript interface for Planner styling input.
 *
 * @remarks
 * Accepts both static values and East expressions.
 */
export interface PlannerStyle<ColumnKeys extends string = string> {
    /** Column keys to freeze (pin left). Frozen columns appear first and stay visible during horizontal scroll. */
    frozen?: ColumnKeys[];
    /** CSS height for the Planner container (e.g., "500px", "100%") */
    height?: SubtypeExprOrValue<StringType>;
    /** Table variant (line or outline) */
    variant?: SubtypeExprOrValue<TableVariantType> | TableVariantLiteral;
    /** Table size (sm, md, lg) */
    size?: SubtypeExprOrValue<TableSizeType> | TableSizeLiteral;
    /** Whether to show zebra stripes on rows */
    striped?: SubtypeExprOrValue<BooleanType>;
    /** Whether the header sticks when scrolling */
    stickyHeader?: SubtypeExprOrValue<BooleanType>;
    /** Whether to show borders between columns */
    showColumnBorder?: SubtypeExprOrValue<BooleanType>;
    /** Slot mode: single or span (default: span) */
    slotMode?: SubtypeExprOrValue<SlotModeType> | SlotModeLiteral;
    /** Optional min slot override (else derived from data) */
    minSlot?: SubtypeExprOrValue<FloatType>;
    /** Optional max slot override (else derived from data) */
    maxSlot?: SubtypeExprOrValue<FloatType>;
    /** Step size for snapping (e.g., 0.25 for quarter steps, 0.5 for half steps) */
    stepSize?: SubtypeExprOrValue<FloatType>;
    /** Custom slot label function */
    slotLabel?: SubtypeExprOrValue<FunctionType<[FloatType], StringType>>;
    /** Min width per slot (CSS value, default "60px") */
    slotMinWidth?: SubtypeExprOrValue<StringType>;
    /** Default color scheme for events */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Vertical grid line color */
    slotLineStroke?: SubtypeExprOrValue<StringType>;
    /** Vertical grid line width in pixels */
    slotLineWidth?: SubtypeExprOrValue<FloatType>;
    /** Vertical grid line dash pattern (e.g., "4 2") */
    slotLineDash?: SubtypeExprOrValue<StringType>;
    /** Vertical grid line opacity (0-1) */
    slotLineOpacity?: SubtypeExprOrValue<FloatType>;
    /** Array of boundary lines at specific slot positions */
    boundaries?: PlannerBoundary[];
    /** Callback triggered when a cell is clicked */
    onCellClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>;
    /** Callback triggered when a cell is double-clicked */
    onCellDoubleClick?: SubtypeExprOrValue<FunctionType<[TableCellClickEventType], NullType>>;
    /** Callback triggered when a row is clicked */
    onRowClick?: SubtypeExprOrValue<FunctionType<[TableRowClickEventType], NullType>>;
    /** Callback triggered when a row is double-clicked */
    onRowDoubleClick?: SubtypeExprOrValue<FunctionType<[TableRowClickEventType], NullType>>;
    /** Callback triggered when sorting changes */
    onSortChange?: SubtypeExprOrValue<FunctionType<[TableSortEventType], NullType>>;
    /** Callback triggered when an event is clicked */
    onEventClick?: SubtypeExprOrValue<FunctionType<[EventClickEventType], NullType>>;
    /** Callback triggered when an event is double-clicked */
    onEventDoubleClick?: SubtypeExprOrValue<FunctionType<[EventClickEventType], NullType>>;
    /** Callback triggered when an event is dragged/moved */
    onEventDrag?: SubtypeExprOrValue<FunctionType<[EventDragEventType], NullType>>;
    /** Callback triggered when an event is resized */
    onEventResize?: SubtypeExprOrValue<FunctionType<[EventResizeEventType], NullType>>;
    /** Callback triggered when adding a new event (click on empty slot) */
    onEventAdd?: SubtypeExprOrValue<FunctionType<[EventAddEventType], NullType>>;
    /** Callback triggered when editing an event (via context menu) */
    onEventEdit?: SubtypeExprOrValue<FunctionType<[EventClickEventType], NullType>>;
    /** Callback triggered when deleting an event (via context menu) */
    onEventDelete?: SubtypeExprOrValue<FunctionType<[EventDeleteEventType], NullType>>;
    /** Explicit colour for the timeline grid lines. */
    gridColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the now-marker line. */
    nowMarkerColor?: SubtypeExprOrValue<StringType>;
    /** Explicit background for the header row. */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour for the header row. */
    headerColor?: SubtypeExprOrValue<StringType>;
    /** Row-status callback: `(rowIndex) => StatusToken`; renderer tints the row. */
    rowStatus?: SubtypeExprOrValue<FunctionType<[IntegerType], StatusTokenType>>;
    /** CSS border-radius for event bars. Default `"2px"`. */
    eventBorderRadius?: SubtypeExprOrValue<StringType>;
    /** Default text colour for per-event labels. Default `"white"`. Per-event `label.color` overrides. */
    labelColor?: SubtypeExprOrValue<StringType>;
    /** Default CSS `font-size` for per-event labels. Default `"0.75rem"`. Per-event `label.fontSize` overrides. */
    labelFontSize?: SubtypeExprOrValue<StringType>;
    /** Default CSS `font-weight` for per-event labels. Default `"600"`. Per-event `label.fontWeight` overrides. */
    labelFontWeight?: SubtypeExprOrValue<StringType>;
}
