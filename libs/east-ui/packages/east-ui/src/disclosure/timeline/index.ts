/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    DateTimeType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, OrientationType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    StepStatusType,
    type StepStatusLiteral,
} from "../steps/types.js";
import {
    TimelineStyleType,
    type TimelineStyle,
} from "./types.js";

// Re-export types
export {
    TimelineStyleType,
    type TimelineStyle,
} from "./types.js";

// ============================================================================
// TimelineItemType — standalone mirror of the inline item sub-struct
// ============================================================================

export const TimelineItemType: StructType<{
    title: UIComponentType,
    timestamp: OptionType<DateTimeType>,
    description: OptionType<UIComponentType>,
    indicator: OptionType<IconType>,
    badgeLabel: OptionType<StringType>,
    status: StepStatusType,
}> = StructType({
    title: UIComponentType,
    timestamp: OptionType(DateTimeType),
    description: OptionType(UIComponentType),
    indicator: OptionType(IconType),
    badgeLabel: OptionType(StringType),
    status: StepStatusType,
});

export type TimelineItemType = typeof TimelineItemType;

// ============================================================================
// TimelineType — standalone mirror of the inline `Timeline` variant
// ============================================================================

export const TimelineType: StructType<{
    items: ArrayType<TimelineItemType>,
    style: OptionType<TimelineStyleType>,
}> = StructType({
    items: ArrayType(TimelineItemType),
    style: OptionType(TimelineStyleType),
});

export type TimelineType = typeof TimelineType;

// ============================================================================
// Timeline Item Factory
// ============================================================================

type TimelineInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Timeline.Item`.
 *
 * @property timestamp - Optional event timestamp
 * @property description - Optional rich description
 * @property indicator - Optional icon for the timeline marker
 * @property badge - Optional rich badge (e.g. a `Badge.Root`)
 */
export interface TimelineItemOptions {
    timestamp?: SubtypeExprOrValue<DateTimeType>;
    description?: TimelineInput;
    indicator?: { prefix: string; name: string } | SubtypeExprOrValue<IconType>;
    /** Optional short badge label (e.g. `"auto-commit"`) */
    badgeLabel?: SubtypeExprOrValue<StringType>;
}

/**
 * Creates a Timeline item.
 *
 * @param title - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param status - Status literal or expression
 * @param options - Optional timestamp + description + indicator + badge
 * @returns An East expression representing the Timeline item
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Timeline, Badge } from "@elaraai/east-ui";
 *
 * const entry = Timeline.Item("Commit 8fe2… approved", "completed", {
 *     timestamp: new Date("2025-03-17T14:22:00Z"),
 *     description: "Approved by cmorrison@elara.ai",
 *     indicator: { prefix: "fas", name: "check" },
 *     badge: Badge.Root("auto-commit", { colorPalette: "green" }),
 * });
 * ```
 */
function createTimelineItem(
    title: TimelineInput,
    status: StepStatusLiteral | SubtypeExprOrValue<StepStatusType>,
    options?: TimelineItemOptions,
): ExprType<TimelineItemType> {
    const titleExpr: ExprType<UIComponentType> = typeof title === "string"
        ? Text.Root(title)
        : title as ExprType<UIComponentType>;

    const statusValue = typeof status === "string"
        ? East.value(variant(status as StepStatusLiteral, null), StepStatusType)
        : status as ExprType<StepStatusType>;

    const descriptionValue = options?.description !== undefined
        ? (typeof options.description === "string"
            ? Text.Root(options.description)
            : options.description as ExprType<UIComponentType>)
        : undefined;

    const indicatorValue = options?.indicator && typeof (options.indicator as { prefix?: unknown }).prefix === "string"
        ? East.value({
            prefix: (options.indicator as { prefix: string }).prefix,
            name: (options.indicator as { name: string }).name,
            label: none,
            style: none,
        }, IconType)
        : (options?.indicator as SubtypeExprOrValue<IconType> | undefined);

    return East.value({
        title: titleExpr,
        timestamp: options?.timestamp !== undefined ? some(options.timestamp) : none,
        description: descriptionValue ? some(descriptionValue) : none,
        indicator: indicatorValue ? some(indicatorValue) : none,
        badgeLabel: options?.badgeLabel !== undefined ? some(options.badgeLabel) : none,
        status: statusValue,
    }, TimelineItemType);
}

// ============================================================================
// Timeline Root Factory
// ============================================================================

/**
 * TypeScript options bag for `Timeline.Root`.
 */
export interface TimelineOptions {
    style?: TimelineStyle;
}

/**
 * Creates a Timeline — an ordered list of time-stamped events.
 *
 * @param items - Array of timeline items (created with `Timeline.Item`)
 * @param options - Optional visual-presentation `style`
 * @returns An East expression representing the Timeline component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Timeline, UIComponentType } from "@elaraai/east-ui";
 *
 * const audit = East.function([], UIComponentType, _$ =>
 *     Timeline.Root([
 *         Timeline.Item("Created plan", "completed", {
 *             timestamp: new Date("2025-03-17T09:00:00Z"),
 *         }),
 *         Timeline.Item("Approved plan", "completed", {
 *             timestamp: new Date("2025-03-17T09:15:00Z"),
 *         }),
 *         Timeline.Item("Executed plan", "active", {
 *             timestamp: new Date("2025-03-17T10:00:00Z"),
 *         }),
 *     ], { style: { orientation: "vertical" } }),
 * );
 * ```
 */
function createTimelineRoot(
    items: SubtypeExprOrValue<ArrayType<TimelineItemType>>,
    options?: TimelineOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildTimelineStyle(options.style) : undefined;

    return East.value(variant("Timeline", {
        items: items as never,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildTimelineStyle(style: TimelineStyle): ExprType<TimelineStyleType> {
    const orientationValue = style.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), OrientationType)
            : style.orientation)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        orientation: orientationValue ? some(orientationValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        connectorColor: style.connectorColor !== undefined ? some(style.connectorColor) : none,
        indicatorColor: style.indicatorColor !== undefined ? some(style.indicatorColor) : none,
        pendingColor: style.pendingColor !== undefined ? some(style.pendingColor) : none,
        activeColor: style.activeColor !== undefined ? some(style.activeColor) : none,
        completedColor: style.completedColor !== undefined ? some(style.completedColor) : none,
        errorColor: style.errorColor !== undefined ? some(style.errorColor) : none,
        skippedColor: style.skippedColor !== undefined ? some(style.skippedColor) : none,
    }, TimelineStyleType);
}

/**
 * Timeline primitive — ordered list of time-stamped events.
 *
 * @remarks
 * Reuses `StepStatusType` with `Steps` for per-item status.
 */
export const Timeline = {
    /**
     * Creates a Timeline container.
     *
     * @param items - Array of timeline items
     * @param options - Optional `style`
     *
     * @example
     * ```ts
     * Timeline.Root([
     *     Timeline.Item("Event A", "completed"),
     *     Timeline.Item("Event B", "active"),
     * ]);
     * ```
     */
    Root: createTimelineRoot,
    /**
     * Creates a Timeline item.
     *
     * @param title - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param status - Status literal or expression
     * @param options - Optional timestamp + description + indicator + badge
     */
    Item: createTimelineItem,
    Types: {
        /**
         * East StructType for a Timeline value — mirrors the inline
         * `Timeline` variant in `component.ts`.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `Timeline.Types.Timeline` without reaching into module
         * internals. Items are wrapped in a separate struct exposed as
         * `Types.Item`.
         *
         * @property items - Array of TimelineItems (see `Item`)
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Timeline: TimelineType,
        /**
         * East StructType for a Timeline item.
         *
         * @remarks
         * Each item carries content (title / description), an optional
         * timestamp, an optional explicit indicator icon (overrides the
         * default paired icon chosen by `status`), an optional badge
         * label, and a required `status` driving colour + paired icon per
         * §0.3.
         *
         * @property title - Item title (UIComponent)
         * @property timestamp - Optional DateTime rendered next to the title
         * @property description - Optional description (UIComponent)
         * @property indicator - Optional explicit icon (overrides the default paired icon)
         * @property badgeLabel - Optional short badge label rendered alongside the title
         * @property status - Step status (shared with `Steps`) — drives paired icon + colour
         */
        Item: TimelineItemType,
        /**
         * East StructType holding every visual field for a Timeline.
         *
         * @remarks
         * Mirror of `TimelineStyleType` from `./types.js`. Covers
         * orientation / size presets plus seven colour slots
         * (connector + one per status value). Renderers apply these
         * alongside the default palette driven by `item.status`.
         *
         * @property orientation - Horizontal / vertical axis
         * @property size - Size preset (sm / md / lg)
         * @property connectorColor - Colour of the line between indicators
         * @property indicatorColor - Default indicator colour (fallback when status-specific is unset)
         * @property pendingColor - Indicator colour for `pending` status
         * @property activeColor - Indicator colour for `active` status
         * @property completedColor - Indicator colour for `completed` status
         * @property errorColor - Indicator colour for `error` status
         * @property skippedColor - Indicator colour for `skipped` status
         */
        Style: TimelineStyleType,
        /**
         * Shared step-status variant used by Steps and Timeline.
         *
         * @remarks
         * Mirror of `StepStatusType` from `../steps/types.js`. Drives the
         * default paired icon + colour per §0.3.
         *
         * @property pending - Not started / queued
         * @property active - Currently in progress
         * @property completed - Finished successfully
         * @property error - Failed / errored
         * @property skipped - Skipped intentionally
         */
        Status: StepStatusType,
    },
} as const;
