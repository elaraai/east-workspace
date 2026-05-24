/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StringType,
    StructType,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    StickyBoundaryType,
    StickyStyleType,
    type StickyOptions,
} from "./types.js";

/**
 * The East struct that mirrors the `Sticky` variant's payload registered
 * inline in `src/component.ts`. Exposed for renderer equality + typing
 * (e.g. `equalFor(Sticky.Types.Sticky)`); the main variant itself lives
 * inline in `UIComponentType` so the `content: UIComponentType` recursive
 * reference resolves.
 */
export const StickyType = StructType({
    content: UIComponentType,
    offset: OptionType(StringType),
    boundary: OptionType(StickyBoundaryType),
    style: OptionType(StickyStyleType),
});
export type StickyType = typeof StickyType;

// Re-export types
export {
    StickyBoundaryType,
    StickyStyleType,
    type StickyBoundaryLiteral,
    type StickyStyle,
    type StickyOptions,
} from "./types.js";

/**
 * Sticky container primitive — semantic wrapper over CSS `position: sticky`.
 *
 * @remarks
 * `Sticky.Root(content, { offset?, boundary?, style? })` wraps a single UI
 * component and sticks it at the given offset inside its parent scroll
 * ancestor (default) or the viewport. See `StickyBoundaryType` for the
 * `boundary` options.
 *
 * @example
 * ```ts
 * import { Sticky, Box, Heading } from "@elaraai/east-ui";
 *
 * Sticky.Root(Heading.Root("Section header"), {
 *     offset: "0",
 *     boundary: "parent",
 *     style: { background: "bg.surface", shadowColor: "shadows.raised" },
 * });
 * ```
 */
function createSticky(
    content: SubtypeExprOrValue<UIComponentType>,
    options?: StickyOptions,
): ExprType<UIComponentType> {
    const content_expr = East.value(content, UIComponentType);

    const boundaryValue = options?.boundary
        ? (typeof options.boundary === "string"
            ? East.value(variant(options.boundary, null), StickyBoundaryType)
            : options.boundary)
        : undefined;

    return East.value(variant("Sticky", {
        content: content_expr,
        offset: options?.offset ? variant("some", options.offset) : variant("none", null),
        boundary: boundaryValue ? variant("some", boundaryValue) : variant("none", null),
        style: options?.style
            ? variant("some", East.value({
                background: options.style.background ? variant("some", options.style.background) : variant("none", null),
                borderColor: options.style.borderColor ? variant("some", options.style.borderColor) : variant("none", null),
                shadowColor: options.style.shadowColor ? variant("some", options.style.shadowColor) : variant("none", null),
            }, StickyStyleType))
            : variant("none", null),
    }), UIComponentType);
}

/**
 * Sticky namespace.
 *
 * @remarks
 * `Sticky.Root(content, opts)` creates a sticky region. Types are exposed
 * via `Sticky.Types`.
 */
export const Sticky = {
    Root: createSticky,
    Types: {
        /** The East struct for the `Sticky` variant payload — used by the renderer's memoisation. */
        Sticky: StickyType,
        Boundary: StickyBoundaryType,
        Style: StickyStyleType,
    },
} as const;
