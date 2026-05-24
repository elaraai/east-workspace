/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { Text } from "../../typography/text/index.js";
import {
    DisclosureStyleType,
    type DisclosureOptions,
} from "./types.js";

// Re-export types
export {
    DisclosureStyleType,
    type DisclosureStyle,
    type DisclosureOptions,
} from "./types.js";

// ============================================================================
// DisclosureType — standalone mirror of the inline `Disclosure` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `Disclosure` variant in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property text - Truncatable text (typically Text.Root; UIComp)
 * @property lines - Number of visible lines before truncation (default: 3)
 * @property moreLabel - Label for the expand trigger (default: "show more")
 * @property lessLabel - Label for the collapse trigger (default: "show less")
 * @property style - Visual-presentation sub-struct
 */
export const DisclosureType: StructType<{
    text: UIComponentType,
    lines: OptionType<IntegerType>,
    moreLabel: OptionType<StringType>,
    lessLabel: OptionType<StringType>,
    style: OptionType<DisclosureStyleType>,
}> = StructType({
    text: UIComponentType,
    lines: OptionType(IntegerType),
    moreLabel: OptionType(StringType),
    lessLabel: OptionType(StringType),
    style: OptionType(DisclosureStyleType),
});

export type DisclosureType = typeof DisclosureType;

// ============================================================================
// Disclosure Factory
// ============================================================================

type DisclosureTextInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates a Disclosure (show-more) component — text-truncation primitive
 * distinct from Collapsible (open/close arbitrary region).
 *
 * @param text - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param options - Config (`lines` / `moreLabel` / `lessLabel`) + optional `style`
 * @returns An East expression representing the Disclosure component
 *
 * @remarks
 * Renders the text clamped to `lines` (default 3) with a "show more"
 * toggle that flips to "show less" on expand. Used by `ActionCard.rationale`,
 * `DriverList` narratives, and other long-form prose.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Disclosure, UIComponentType } from "@elaraai/east-ui";
 *
 * const rationale = East.function([], UIComponentType, _$ =>
 *     Disclosure.Root(
 *         "Long rationale text that wraps across many lines…",
 *         { lines: 3n },
 *     ),
 * );
 * ```
 */
function createDisclosure(
    text: DisclosureTextInput,
    options?: DisclosureOptions,
): ExprType<UIComponentType> {
    const textExpr: ExprType<UIComponentType> = typeof text === "string"
        ? Text.Root(text)
        : text as ExprType<UIComponentType>;

    const styleValue = options?.style
        ? East.value({
            color: options.style.color !== undefined ? some(options.style.color) : none,
            triggerColor: options.style.triggerColor !== undefined ? some(options.style.triggerColor) : none,
        }, DisclosureStyleType)
        : undefined;

    return East.value(variant("Disclosure", {
        text: textExpr,
        lines: options?.lines !== undefined ? some(options.lines) : none,
        moreLabel: options?.moreLabel !== undefined ? some(options.moreLabel) : none,
        lessLabel: options?.lessLabel !== undefined ? some(options.lessLabel) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Disclosure (show-more) primitive — text-truncation with "show more" toggle.
 *
 * @remarks
 * Use `Disclosure.Root(text, options)`.
 */
export const Disclosure = {
    /**
     * Creates a Disclosure (show-more) component.
     *
     * @param text - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param options - Config + optional `style`
     * @returns An East expression representing the Disclosure component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Disclosure, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Disclosure.Root("Long text…", { lines: 3n, moreLabel: "Read more" }),
     * );
     * ```
     */
    Root: createDisclosure,
    Types: {
        /**
         * The concrete East type for Disclosure — mirrors the inline
         * `Disclosure` variant in `component.ts`.
         */
        Disclosure: DisclosureType,
        /**
         * Visual-only style struct for Disclosure.
         */
        Style: DisclosureStyleType,
    },
} as const;
