/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ArrayType,
    type SubtypeExprOrValue,
    BooleanType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import type { UIComponentType } from "../../component.js";

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
 * The chrome a Dock draws around itself.
 *
 * @property card  - Its own bordered, rounded panel (the default)
 * @property shell - No panel of its own, only the rule along its inner edge:
 *   a pane inside a host's frame, beside the content it serves
 */
export const DockSurfaceType = VariantType({
    card: NullType,
    shell: NullType,
});
export type DockSurfaceType = typeof DockSurfaceType;

/**
 * Presentation + behaviour configuration for a Dock. Every field optional;
 * the renderer falls back to a horizontal sidebar that pins to the `start`
 * edge, `44px` rail, keep-mounted body.
 *
 * @property orientation - Axis it collapses along (default `horizontal`)
 * @property side        - Edge the rail pins to → the collapse control's direction (default `start`)
 * @property expandedSize - Size ALONG the axis when expanded (px or %, e.g. `"25%"`)
 * @property railSize    - Size when collapsed — the icon rail (default `44px`)
 * @property icon        - Font Awesome icon name in the collapsed rail's tile
 * @property label       - The pane's name: its one tab when it has no tabs, the rail's label, and the controls' accessible name
 * @property badge       - Optional count or short label in the collapsed rail
 * @property persist     - Where the uncontrolled collapsed state is persisted (default `none`)
 * @property keepMounted - Keep the body mounted while collapsed to preserve its scroll / drag / search state (default `true`)
 * @property lazy        - Mount the body only on first expand (default `false`)
 * @property animated    - Smoothly transition the size between rail and expanded (default `false`)
 * @property surface     - `card` (default) draws its own panel; `shell` only the rule along its inner edge
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
    surface: OptionType(DockSurfaceType),
});
export type DockStyleType = typeof DockStyleType;

/** String shorthand for {@link DockOrientationType}. */
export type DockOrientationLiteral = "horizontal" | "vertical";
/** String shorthand for {@link DockSideType}. */
export type DockSideLiteral = "start" | "end";
/** String shorthand for {@link DockPersistType}. */
export type DockPersistLiteral = "none" | "local" | "session";
/** String shorthand for {@link DockSurfaceType}. */
export type DockSurfaceLiteral = "card" | "shell";

/**
 * TypeScript style interface for {@link DockStyleType} — the flat config bag.
 */
export interface DockStyle {
    /** Axis it collapses along (default `horizontal`). */
    orientation?: SubtypeExprOrValue<DockOrientationType> | DockOrientationLiteral;
    /** Edge the rail pins to → the collapse control's direction (default `start`). */
    side?: SubtypeExprOrValue<DockSideType> | DockSideLiteral;
    /** Size along the axis when expanded (px or %, e.g. `"25%"`). */
    expandedSize?: SubtypeExprOrValue<StringType>;
    /** Size when collapsed — the icon rail (default `44px`). */
    railSize?: SubtypeExprOrValue<StringType>;
    /** Font Awesome icon name in the collapsed rail's tile. */
    icon?: SubtypeExprOrValue<StringType>;
    /** The pane's name: its one tab when it has no `tabs`, the rail's label, and the controls' accessible name. */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional count or short label in the collapsed rail. */
    badge?: SubtypeExprOrValue<StringType>;
    /** Where the uncontrolled collapsed state is persisted (default `none`). */
    persist?: SubtypeExprOrValue<DockPersistType> | DockPersistLiteral;
    /** Keep the body mounted while collapsed to preserve its state (default `true`). */
    keepMounted?: SubtypeExprOrValue<BooleanType>;
    /** Mount the body only on first expand (default `false`). */
    lazy?: SubtypeExprOrValue<BooleanType>;
    /** Smoothly transition the size between rail and expanded (default `false`). */
    animated?: SubtypeExprOrValue<BooleanType>;
    /** `card` (default) draws its own panel; `shell` only the rule along its inner edge, for a pane inside a host's frame. */
    surface?: SubtypeExprOrValue<DockSurfaceType> | DockSurfaceLiteral;
}

/**
 * One tab of a Dock's tab row.
 *
 * @property key - The tab's identity
 * @property label - Its name in the tab row
 * @property body - What the pane shows while the tab is open
 */
export interface DockTabInput {
    /** The tab's identity. */
    key: SubtypeExprOrValue<StringType>;
    /** Its name in the tab row. */
    label: SubtypeExprOrValue<StringType>;
    /** What the pane shows while the tab is open. */
    body: SubtypeExprOrValue<ArrayType<UIComponentType>>;
}

/**
 * Dock options — passed to `Dock.Root(children, opts)`. Extends
 * {@link DockStyle} with the collapsed-state behaviour fields and the tabs.
 */
export interface DockOptions extends DockStyle {
    /**
     * The pane's tabs, each with its own body, in the tab row's order. The
     * first is open to begin with, and the pane keeps every tab's body
     * mounted, so each keeps its state. Given, the Dock's children are not
     * shown; omitted, the tab row holds the `label` alone over the children.
     */
    tabs?: DockTabInput[];
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
