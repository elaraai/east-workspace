/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    StructType,
    OptionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";

/**
 * Standalone East type for `AlignedStack` data — mirrors the inline arm in
 * `component.ts` (which spells `children` with the recursion `node`). Used by the
 * renderer for `equalFor` + `ValueTypeOf`.
 *
 * @property children - The stacked lane components
 * @property gutter - The imposed gutter (`auto` | `fixed{left,right}`)
 * @property style - Optional box-model style
 */
export const AlignedStackType: StructType<{
    children: ArrayType<UIComponentType>,
    gutter: OptionType<AlignedGutterType>,
    style: OptionType<AlignedStackStyleType>,
}> = StructType({
    children: ArrayType(UIComponentType),
    gutter: OptionType(AlignedGutterType),
    style: OptionType(AlignedStackStyleType),
});
export type AlignedStackType = typeof AlignedStackType;
import { AlignedStackStyleType, type AlignedStackStyle } from "./types.js";
import {
    PlotGutterType,
    AlignedGutterType,
    type PlotGutter,
} from "../../shared/plot-gutter.js";

export { AlignedStackStyleType, type AlignedStackStyle } from "./types.js";
export { PlotGutterType, AlignedGutterType, type PlotGutter } from "../../shared/plot-gutter.js";

/** Options for {@link createAlignedStack} — the gutter mode plus the box-model style fields (flattened, like `Stack`). */
export interface AlignedStackOptions extends AlignedStackStyle {
    /**
     * The gutter imposed on every child: an explicit `{ left, right }` (px
     * recommended), or `"auto"` to measure the max gutter the children need.
     * Omit to impose nothing (children keep their own gutters).
     */
    gutter?: PlotGutter | "auto";
}

/** Build the `AlignedGutterType` value (`auto` | `fixed{left,right}`) from the input. */
function resolveGutter(g: PlotGutter | "auto" | undefined): ExprType<AlignedGutterType> | undefined {
    if (g === undefined) return undefined;
    if (g === "auto") return East.value(variant("auto", null), AlignedGutterType);
    const gutter = East.value({
        left:  g.left  !== undefined ? some(g.left)  : none,
        right: g.right !== undefined ? some(g.right) : none,
    }, PlotGutterType);
    return East.value(variant("fixed", gutter), AlignedGutterType);
}

/**
 * Build an `<AlignedStack>` — a vertical stack of axis/lane components (Chart,
 * Trace, Calendar, …) that share one horizontal plot gutter so their data lanes
 * line up on a common x. The gutter is published to the children via context; a
 * child's own `plotGutter` prop still wins over the inherited value (#147).
 *
 * @param children - The stacked lane components
 * @param options - The {@link AlignedStackOptions} (`gutter` + box-model style)
 * @returns An `AlignedStack` {@link UIComponentType} value
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { AlignedStack, Chart, UIComponentType } from "@elaraai/east-ui";
 *
 * const aligned = East.function([], UIComponentType, ($) =>
 *     AlignedStack.Root([
 *         Chart.Root(Chart.Line(rows, { x: r => r.day, y: r => r.value })),
 *         // …a Trace / Planner on the same day axis…
 *     ], { gutter: { left: "48px", right: "12px" }, gap: "8px" }));
 * ```
 */
function createAlignedStack(
    children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: AlignedStackOptions,
): ExprType<UIComponentType> {
    const gutter = resolveGutter(options?.gutter);
    const hasStyle = options !== undefined &&
        (options.gap !== undefined || options.width !== undefined ||
         options.height !== undefined || options.minHeight !== undefined);
    return East.value(variant("AlignedStack", {
        children,
        gutter: gutter !== undefined ? some(gutter) : none,
        style: hasStyle
            ? some(East.value({
                gap:       options!.gap       !== undefined ? some(options!.gap)       : none,
                width:     options!.width     !== undefined ? some(options!.width)     : none,
                height:    options!.height    !== undefined ? some(options!.height)    : none,
                minHeight: options!.minHeight !== undefined ? some(options!.minHeight) : none,
            }, AlignedStackStyleType))
            : none,
    }), UIComponentType);
}

/**
 * `AlignedStack` — vertically stacks axis/lane components on a shared plot gutter.
 *
 * @remarks
 * Use `AlignedStack.Root(children, { gutter })`. Types via `.Types`.
 */
export const AlignedStack = {
    /** Build an AlignedStack (see {@link createAlignedStack}). */
    Root: createAlignedStack,
    Types: {
        /** The AlignedStack data struct. */
        AlignedStack: AlignedStackType,
        /** The `{ left, right }` plot-gutter struct. */
        PlotGutter: PlotGutterType,
        /** The `auto | fixed` gutter mode. */
        Gutter: AlignedGutterType,
        /** The AlignedStack style struct. */
        Style: AlignedStackStyleType,
    },
} as const;
