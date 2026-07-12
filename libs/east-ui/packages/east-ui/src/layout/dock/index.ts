/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    BooleanType,
    FunctionType,
    NullType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    DockStyleType,
    DockOrientationType,
    DockSideType,
    DockPersistType,
    type DockStyle,
    type DockOptions,
} from "./types.js";

// Re-export types
export {
    DockStyleType,
    DockOrientationType,
    DockSideType,
    DockPersistType,
    type DockStyle,
    type DockOptions,
} from "./types.js";

// ============================================================================
// DockType — standalone mirror of the inline `Dock` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `Dock` variant in `component.ts`.
 * Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property body - The expanded content (UIComps) — kept mounted across collapse by default
 * @property collapsed - Collapsed state (synced on change; omit for uncontrolled toggling)
 * @property defaultCollapsed - Uncontrolled initial collapsed state
 * @property onCollapsedChange - Callback invoked with the new collapsed state
 * @property style - Presentation + behaviour sub-struct
 */
export const DockType: StructType<{
    body: ArrayType<UIComponentType>,
    collapsed: OptionType<BooleanType>,
    defaultCollapsed: OptionType<BooleanType>,
    onCollapsedChange: OptionType<FunctionType<[BooleanType], NullType>>,
    style: OptionType<DockStyleType>,
}> = StructType({
    body: ArrayType(UIComponentType),
    collapsed: OptionType(BooleanType),
    defaultCollapsed: OptionType(BooleanType),
    onCollapsedChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(DockStyleType),
});

export type DockType = typeof DockType;

// ============================================================================
// Dock Factory
// ============================================================================

/** Resolve a variant string shorthand (or pass a value/expression through). */
function orientationValue(v: NonNullable<DockStyle["orientation"]>): SubtypeExprOrValue<DockOrientationType> {
    return typeof v === "string" ? East.value(variant(v, null), DockOrientationType) : v;
}
function sideValue(v: NonNullable<DockStyle["side"]>): SubtypeExprOrValue<DockSideType> {
    return typeof v === "string" ? East.value(variant(v, null), DockSideType) : v;
}
function persistValue(v: NonNullable<DockStyle["persist"]>): SubtypeExprOrValue<DockPersistType> {
    return typeof v === "string" ? East.value(variant(v, null), DockPersistType) : v;
}

/**
 * Creates a Dock — an inline panel that collapses along one axis to a compact
 * icon rail and expands back to its full content, without leaving the
 * document flow (siblings reflow; it never overlays).
 *
 * @param children - The expanded content (UIComps)
 * @param options - Optional collapsed-state / behaviour / presentation fields
 * @returns An East expression representing the Dock component
 *
 * @remarks
 * The in-flow, collapse-to-rail sibling of `Expandable` (which does the
 * opposite — a CSS takeover that fills the app container). A Dock stays an
 * ordinary flex child: collapsed, it shrinks to `railSize` and the freed
 * space is reclaimed by its siblings — so it can sit beside a drop target (a
 * `Planner`, a board) and tuck away without covering it. Arbitrarily nestable;
 * each dock keyed by its own structural storage key. Drive it from state with
 * `collapsed` + `onCollapsedChange`, or omit both for uncontrolled toggling
 * (optionally `persist`ed). Distinct from the disclosure `Collapsible`
 * (trigger + content show/hide) and `Dialog` / `Drawer` (portalled overlays).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Box, Dock, Text, UIComponentType } from "@elaraai/east-ui/internal";
 *
 * const sidebar = East.function([], UIComponentType, _$ =>
 *     Dock.Root(
 *         [Box.Root([Text.Root("Bookings library")], { padding: "3" })],
 *         { icon: "book", label: "Bookings", expandedSize: "25%" },
 *     ),
 * );
 * ```
 */
function createDock(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: DockOptions,
): ExprType<UIComponentType> {
    const hasStyle = options !== undefined && (
        options.orientation !== undefined || options.side !== undefined
        || options.expandedSize !== undefined || options.railSize !== undefined
        || options.icon !== undefined || options.label !== undefined || options.badge !== undefined
        || options.persist !== undefined || options.keepMounted !== undefined
        || options.lazy !== undefined || options.animated !== undefined
    );
    const styleValue = hasStyle
        ? East.value({
            orientation: options.orientation !== undefined ? some(orientationValue(options.orientation)) : none,
            side: options.side !== undefined ? some(sideValue(options.side)) : none,
            expandedSize: options.expandedSize !== undefined ? some(options.expandedSize) : none,
            railSize: options.railSize !== undefined ? some(options.railSize) : none,
            icon: options.icon !== undefined ? some(options.icon) : none,
            label: options.label !== undefined ? some(options.label) : none,
            badge: options.badge !== undefined ? some(options.badge) : none,
            persist: options.persist !== undefined ? some(persistValue(options.persist)) : none,
            keepMounted: options.keepMounted !== undefined ? some(options.keepMounted) : none,
            lazy: options.lazy !== undefined ? some(options.lazy) : none,
            animated: options.animated !== undefined ? some(options.animated) : none,
        }, DockStyleType)
        : undefined;

    return East.value(variant("Dock", {
        body: children,
        collapsed: options?.collapsed !== undefined ? some(options.collapsed) : none,
        defaultCollapsed: options?.defaultCollapsed !== undefined ? some(options.defaultCollapsed) : none,
        onCollapsedChange: options?.onCollapsedChange ? some(options.onCollapsedChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Dock primitive — an inline panel that collapses along an axis to an icon
 * rail, staying in the document flow.
 *
 * @remarks
 * Use `Dock.Root(children, opts)`. Types are exposed via `Dock.Types`.
 */
export const Dock = {
    /**
     * Creates a Dock component.
     *
     * @param children - The expanded content (UIComps)
     * @param options - Optional collapsed-state / behaviour / presentation fields
     * @returns An East expression representing the Dock component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Box, Dock, Text, UIComponentType } from "@elaraai/east-ui/internal";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Dock.Root(
     *         [Box.Root([Text.Root("Bookings library")], { padding: "3" })],
     *         { icon: "book", label: "Bookings", expandedSize: "25%" },
     *     ),
     * );
     * ```
     */
    Root: createDock,
    Types: {
        /**
         * The concrete East type for Dock — mirrors the inline `Dock` variant
         * in `component.ts`.
         */
        Dock: DockType,
        /** Presentation + behaviour config struct for Dock. */
        Style: DockStyleType,
        /** Collapse-axis variant (`horizontal` / `vertical`). */
        Orientation: DockOrientationType,
        /** Rail-edge variant (`start` / `end`). */
        Side: DockSideType,
        /** Persistence variant (`none` / `local` / `session`). */
        Persist: DockPersistType,
    },
} as const;
