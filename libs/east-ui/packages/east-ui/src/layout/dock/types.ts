/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

/**
 * The axis a {@link DockStyleType} collapses along.
 *
 * @property horizontal - Collapses its width to a vertical rail (a sidebar)
 * @property vertical   - Collapses its height to a horizontal rail (a tray)
 */
export const DockOrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});
export type DockOrientationType = typeof DockOrientationType;

/**
 * Which edge the collapsed rail pins to — also sets the toggle chevron
 * direction.
 *
 * @property start - Leading edge (left when horizontal, top when vertical)
 * @property end   - Trailing edge (right when horizontal, bottom when vertical)
 */
export const DockSideType = VariantType({
    start: NullType,
    end: NullType,
});
export type DockSideType = typeof DockSideType;

/**
 * Where the uncontrolled collapsed state is persisted, keyed by the dock's
 * structural storage key.
 *
 * @property none    - Not persisted (resets on reload)
 * @property local   - `localStorage` (survives reload + browser restart)
 * @property session - `sessionStorage` (survives reload, cleared with the tab)
 */
export const DockPersistType = VariantType({
    none: NullType,
    local: NullType,
    session: NullType,
});
export type DockPersistType = typeof DockPersistType;

/**
 * Presentation + behaviour configuration for a Dock. Every field optional;
 * the renderer falls back to a horizontal sidebar that pins to the `start`
 * edge, `44px` rail, keep-mounted body.
 *
 * @property orientation - Axis it collapses along (default `horizontal`)
 * @property side        - Edge the rail pins to → chevron direction (default `start`)
 * @property expandedSize - Size ALONG the axis when expanded (px or %, e.g. `"25%"`)
 * @property railSize    - Size when collapsed — the icon rail (default `44px`)
 * @property icon        - Font Awesome icon name shown on the rail + header
 * @property label       - Header title (expanded) + rail tooltip / accessible name (collapsed)
 * @property badge       - Optional count/label shown on the rail + header
 * @property persist     - Where the uncontrolled collapsed state is persisted (default `none`)
 * @property keepMounted - Keep the body mounted while collapsed to preserve its scroll / drag / search state (default `true`)
 * @property lazy        - Mount the body only on first expand (default `false`)
 * @property animated    - Smoothly transition the size between rail and expanded (default `false`)
 */
export const DockStyleType = StructType({
    orientation: OptionType(DockOrientationType),
    side: OptionType(DockSideType),
    expandedSize: OptionType(StringType),
    railSize: OptionType(StringType),
    icon: OptionType(StringType),
    label: OptionType(StringType),
    badge: OptionType(StringType),
    persist: OptionType(DockPersistType),
    keepMounted: OptionType(BooleanType),
    lazy: OptionType(BooleanType),
    animated: OptionType(BooleanType),
});
export type DockStyleType = typeof DockStyleType;

/** String shorthand for {@link DockOrientationType}. */
export type DockOrientationLiteral = "horizontal" | "vertical";
/** String shorthand for {@link DockSideType}. */
export type DockSideLiteral = "start" | "end";
/** String shorthand for {@link DockPersistType}. */
export type DockPersistLiteral = "none" | "local" | "session";

/**
 * TypeScript style interface for {@link DockStyleType} — the flat config bag.
 */
export interface DockStyle {
    /** Axis it collapses along (default `horizontal`). */
    orientation?: SubtypeExprOrValue<DockOrientationType> | DockOrientationLiteral;
    /** Edge the rail pins to → chevron direction (default `start`). */
    side?: SubtypeExprOrValue<DockSideType> | DockSideLiteral;
    /** Size along the axis when expanded (px or %, e.g. `"25%"`). */
    expandedSize?: SubtypeExprOrValue<StringType>;
    /** Size when collapsed — the icon rail (default `44px`). */
    railSize?: SubtypeExprOrValue<StringType>;
    /** Font Awesome icon name shown on the rail + header. */
    icon?: SubtypeExprOrValue<StringType>;
    /** Header title (expanded) + rail tooltip / accessible name (collapsed). */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional count/label shown on the rail + header. */
    badge?: SubtypeExprOrValue<StringType>;
    /** Where the uncontrolled collapsed state is persisted (default `none`). */
    persist?: SubtypeExprOrValue<DockPersistType> | DockPersistLiteral;
    /** Keep the body mounted while collapsed to preserve its state (default `true`). */
    keepMounted?: SubtypeExprOrValue<BooleanType>;
    /** Mount the body only on first expand (default `false`). */
    lazy?: SubtypeExprOrValue<BooleanType>;
    /** Smoothly transition the size between rail and expanded (default `false`). */
    animated?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Dock options — passed to `Dock.Root(children, opts)`. Extends
 * {@link DockStyle} with the collapsed-state behaviour fields.
 */
export interface DockOptions extends DockStyle {
    /**
     * Collapsed state. Synced on change (forms convention), so a
     * `State.bind`-driven value controls the dock reactively; omit for
     * uncontrolled toggling via the built-in control.
     */
    collapsed?: SubtypeExprOrValue<BooleanType>;
    /** Uncontrolled initial collapsed state (default `false`). */
    defaultCollapsed?: SubtypeExprOrValue<BooleanType>;
    /** Callback invoked with the new collapsed state when the user toggles. */
    onCollapsedChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
}
