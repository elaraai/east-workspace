/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import {
    SliceAffordanceType,
    type SliceAffordanceLiteral,
} from "../../contracts/slice-affordances.js";

/** Footer behaviour for a `Slice.Frame`. */
export type SliceFrameFooter =
    /** Frame-supplied derived count ("N of M · −P%"). The default. */
    | undefined
    /** No footer. */
    | false
    /** A custom footer node (e.g. `Slice.Summary`, paging). */
    | SubtypeExprOrValue<UIComponentType>;

/** A single eyebrow affordance — a `"filter" | "search" | …` literal or a variant expression. */
export type SliceFrameAffordance = SliceAffordanceLiteral | SubtypeExprOrValue<SliceAffordanceType>;

/** Options for `Slice.Frame.Root`. */
export interface SliceFrameOptions {
    /** The bound slice (from `Slice.bind`); config drives the affordances' data, data the footer. */
    slice: SubtypeExprOrValue<SliceBindType>;
    /**
     * Eyebrow affordances, in order. Plain strings or variant expressions —
     * exactly like `state` on `CardOptions`. They render as labelled blocks in
     * a bar that reflows: one inline row when it fits, stacked labelled rows
     * when it doesn't. Omit or pass `[]` for a chrome-less body (no eyebrow).
     */
    affordances?: SliceFrameAffordance[];
    /** Eyebrow meta (freshness chip, secondary action), pinned to the right of the bar. */
    meta?: SubtypeExprOrValue<UIComponentType>;
    /** Footer: omit for the derived count, `false` to hide, or a custom node. */
    footer?: SliceFrameFooter;
    /**
     * Offer a chevron that collapses the eyebrow to a one-line summary of the
     * active narrowing (and expands back to the editable bar). Default `true`.
     */
    collapsible?: boolean;
    /** Start collapsed (only meaningful when `collapsible`). Default `false`. */
    defaultCollapsed?: boolean;
}

/**
 * Creates a `Slice.Frame` — the container that houses one slice consumer. The
 * `body` is whatever you want to show over the narrowed data (a
 * `Collections.Table` / `Chart.*` / `Stat` rendered from
 * `Slice.apply.where(slice.read(), cfg, data)`). The frame wraps it in the
 * canonical chassis: an eyebrow holding the affordances you list in
 * `options.affordances` as labelled blocks in a bar that reflows (one inline
 * row when it fits, stacked labelled rows when it doesn't; optionally
 * collapsible to a summary), plus a derived-count footer. Editing happens in a
 * `Slice.Edit` popover, so the frame never changes height when an affordance opens.
 *
 * You choose the affordances explicitly — a table frame is typically
 * `["filter", "search"]`, a chart frame `["breakdown"]`. Pass `[]` (or omit) to
 * get the chrome-less Embed shape (body only).
 *
 * @param body    - The consumer visual to house (any `UIComponentType`)
 * @param options - The bound `slice`, eyebrow `affordances`, right-zone `meta`, and `footer` mode
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```ts
 * Reactive.Root(East.function([], UIComponentType, $ => {
 *     const slice = $.let(Slice.bind([EventType], "events", cfg, Slice.state(), rows, none));
 *     const narrowed = $.let(Slice.apply.where([EventType], slice.read(), cfg, rows));
 *     return Slice.Frame.Root(Table.Root(narrowed, columns), {
 *         slice,
 *         affordances: ["filter", "search"],
 *     });
 * }));
 * ```
 */
function createSliceFrame(
    body: SubtypeExprOrValue<UIComponentType>,
    options: SliceFrameOptions,
): ExprType<UIComponentType> {
    const affordances = (options.affordances ?? []).map(a =>
        typeof a === "string" ? variant(a, null) : a,
    );
    return East.value(variant("SliceFrame", {
        slice: options.slice,
        body,
        affordances: East.value(affordances, ArrayType(SliceAffordanceType)),
        meta: options.meta !== undefined ? some(options.meta) : none,
        footer: options.footer === false
            ? variant("hidden", null)
            : options.footer === undefined
                ? variant("derived", null)
                : variant("custom", options.footer),
        collapsible: options.collapsible ?? true,
        defaultCollapsed: options.defaultCollapsed ?? false,
    }), UIComponentType);
}

/** `Slice.Frame` — the slice consumer container. */
export const SliceFrame = {
    Root: createSliceFrame,
} as const;
