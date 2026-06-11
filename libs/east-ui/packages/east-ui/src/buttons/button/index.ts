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
    BooleanType,
    NullType,
    FunctionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, ColorSchemeType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    ButtonStyleType,
    ButtonVariantType,
    type ButtonStyle,
    type ButtonVariantLiteral,
    type IconPayload,
} from "./types.js";

// Re-export types
export {
    ButtonStyleType,
    ButtonVariantType,
    type ButtonStyle,
    type ButtonVariantLiteral,
    type IconPayload,
} from "./types.js";

// ============================================================================
// ButtonType — standalone mirror of the inline `Button` variant in component.ts
// ============================================================================

/**
 * Concrete struct type mirroring the inline `Button` variant defined in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`
 * because `Button`'s recursive `label: UIComp` field forces its main variant
 * to be defined inline in the recursive `UIComponentType` — this mirror
 * exposes the same shape as a standalone type for tooling.
 *
 * @remarks
 * Same pattern as `List.Types.List` and `Note.Types.Note` introduced in
 * Plan 1.3.
 *
 * @property label - Rich label (UIComponentType). Strings passed at the factory boundary are coerced to `Text.Root(s)`
 * @property startIcon - Optional leading icon (rendered before the label)
 * @property endIcon - Optional trailing icon (rendered after the label)
 * @property loadingText - Label text shown when `loading` is true (falls back to `label` when absent)
 * @property loadingIcon - Icon swapped in for the `startIcon` slot when `loading` is true (e.g. a spinner)
 * @property loading - Loading state — renderer adds a spinner + disables interaction
 * @property disabled - Disabled state — renderer greys out + blocks interaction
 * @property onClick - Click-handler callback (pure East function)
 * @property style - Optional visual-presentation sub-struct (presets + colour escape hatches)
 */
export const ButtonType: StructType<{
    label: UIComponentType,
    startIcon: OptionType<IconType>,
    endIcon: OptionType<IconType>,
    loadingText: OptionType<StringType>,
    loadingIcon: OptionType<IconType>,
    loading: OptionType<BooleanType>,
    disabled: OptionType<BooleanType>,
    onClick: OptionType<FunctionType<[], NullType>>,
    style: OptionType<ButtonStyleType>,
}> = StructType({
    label: UIComponentType,
    startIcon: OptionType(IconType),
    endIcon: OptionType(IconType),
    loadingText: OptionType(StringType),
    loadingIcon: OptionType(IconType),
    loading: OptionType(BooleanType),
    disabled: OptionType(BooleanType),
    onClick: OptionType(FunctionType([], NullType)),
    style: OptionType(ButtonStyleType),
});

/**
 * Type representing the Button component structure.
 */
export type ButtonType = typeof ButtonType;

// ============================================================================
// Button Factory
// ============================================================================

/**
 * Accepted input types for Button's `label` argument.
 *
 * @remarks
 * Plain `string` is coerced to `Text.Root(s)` at the factory boundary for
 * ergonomics — callers wanting rich content can pass any UIComponentType
 * expression (e.g. `Stack.HStack([...])`).
 */
export type ButtonLabelInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `Button.Root` — a single flat bag.
 *
 * @remarks
 * Content (`startIcon`, `endIcon`, `loadingText`, `loadingIcon`), state
 * (`loading`, `disabled`), behaviour (`onClick`) and the visual fields (from
 * {@link ButtonStyle} — `variant`, `colorPalette`, `size`, colour hatches) all
 * sit flat at the top level. The factory composes the visual fields into the
 * nested IR `style` struct internally.
 *
 * @property startIcon - Leading icon slot (rendered before the label)
 * @property endIcon - Trailing icon slot (rendered after the label)
 * @property loadingText - Label text shown when `loading` is true
 * @property loadingIcon - Icon shown in place of `startIcon` when `loading` is true
 * @property loading - Loading state — renderer shows a spinner and blocks clicks
 * @property disabled - Disabled state — renderer greys out and blocks clicks
 * @property onClick - Click-handler callback
 */
export interface ButtonOptions extends ButtonStyle {
    /** Leading icon slot (rendered before the label) */
    startIcon?: IconPayload | SubtypeExprOrValue<IconType>;
    /** Trailing icon slot (rendered after the label) */
    endIcon?: IconPayload | SubtypeExprOrValue<IconType>;
    /** Label text shown when `loading` is true (falls back to `label` when absent) */
    loadingText?: SubtypeExprOrValue<StringType>;
    /** Icon swapped in for the `startIcon` slot when `loading` is true */
    loadingIcon?: IconPayload | SubtypeExprOrValue<IconType>;
    /** Loading state — renderer shows a spinner and blocks interaction */
    loading?: SubtypeExprOrValue<BooleanType>;
    /** Disabled state — renderer greys out and blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Click-handler callback (zero-arg East function) */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

/**
 * Creates a Button component.
 *
 * @param label - String (coerced to `Text.Root(s)`) or any UIComponentType expression
 * @param options - A single flat options bag (content / state / behaviour /
 *   visual fields)
 * @returns An East expression representing the Button component
 *
 * @remarks
 * Button is an interactive component for triggering actions. It supports
 * rich labels, leading/trailing icons, a distinct loading state with
 * optional custom loading text + loading icon, colour escape hatches, and
 * five visual variants. Every option sits flat on the bag; the factory
 * composes the visual fields into the nested IR `style` struct internally.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Button, Stack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * // Simple primary action button
 * const save = East.function([], UIComponentType, _$ =>
 *     Button.Root("Save Changes", { variant: "solid", colorPalette: "blue" }),
 * );
 *
 * // Start + end icons + ghost variant with escape-hatch hover colour
 * const cta = East.function([], UIComponentType, _$ =>
 *     Button.Root("Continue", {
 *         startIcon: { prefix: "fas", name: "check" },
 *         endIcon: { prefix: "fas", name: "arrow-right" },
 *         variant: "ghost",
 *         hoverBackground: "#eef2ff",
 *     }),
 * );
 *
 * // Loading state with custom spinner icon + loading text
 * const submit = East.function([], UIComponentType, _$ =>
 *     Button.Root("Submit", {
 *         loading: true,
 *         loadingText: "Submitting…",
 *         loadingIcon: { prefix: "fas", name: "spinner" },
 *     }),
 * );
 *
 * // Rich label — HStack of Text children
 * const accept = East.function([], UIComponentType, _$ =>
 *     Button.Root(
 *         Stack.HStack([
 *             Text.Root("Accept"),
 *             Text.Root("→ log to MES", { color: "fg.muted" }),
 *         ]),
 *         { variant: "solid", colorPalette: "green" },
 *     ),
 * );
 * ```
 */
function createButton(
    label: ButtonLabelInput,
    options?: ButtonOptions,
): ExprType<UIComponentType> {
    const labelExpr: ExprType<UIComponentType> = typeof label === "string"
        ? Text.Root(label)
        : label as ExprType<UIComponentType>;

    const opts: ButtonOptions = options ?? {};
    const { startIcon, endIcon, loadingText, loadingIcon, loading, disabled, onClick, ...visual } = opts;
    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildButtonStyle(opts) : undefined;

    return East.value(variant("Button", {
        label: labelExpr,
        startIcon: startIcon ? some(toIconValue(startIcon)) : none,
        endIcon: endIcon ? some(toIconValue(endIcon)) : none,
        loadingText: loadingText !== undefined ? some(loadingText) : none,
        loadingIcon: loadingIcon ? some(toIconValue(loadingIcon)) : none,
        loading: loading !== undefined ? some(loading) : none,
        disabled: disabled !== undefined ? some(disabled) : none,
        onClick: onClick ? some(onClick) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildButtonStyle(style: ButtonStyle): ExprType<ButtonStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as ButtonVariantLiteral, null), ButtonVariantType)
            : style.variant)
        : undefined;

    const colorPaletteValue = style.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        hoverBackground: style.hoverBackground !== undefined ? some(style.hoverBackground) : none,
    }, ButtonStyleType);
}

function toIconValue(
    input: IconPayload | SubtypeExprOrValue<IconType>,
): ExprType<IconType> {
    if (isIconPayload(input)) {
        return East.value({
            name: input.name,
            prefix: input.prefix,
            label: none,
            style: none,
        }, IconType) as ExprType<IconType>;
    }
    return input as ExprType<IconType>;
}

function isIconPayload(x: unknown): x is IconPayload {
    return typeof x === "object"
        && x !== null
        && typeof (x as { prefix?: unknown }).prefix === "string"
        && typeof (x as { name?: unknown }).name === "string"
        && !("toIR" in (x as Record<string, unknown>));
}

/**
 * Button primitive — interactive trigger for actions.
 *
 * @remarks
 * Use `Button.Root(label, options)` to create a button, or access
 * `Button.Types.Button` for the East type.
 *
 * content + state + behaviour are on the main
 * struct; visual presentation lives inside `style: ButtonStyleType`.
 */
export const Button = {
    /**
     * Creates a Button component.
     *
     * @param label - String (coerced to `Text.Root(s)`) or any UIComponentType expression
     * @param options - Main-level fields plus optional `style` sub-struct
     * @returns An East expression representing the Button component
     *
     * @remarks
     * Button is an interactive component for triggering actions. It supports
     * rich labels, leading/trailing icons, a distinct loading state with
     * optional custom loading text + loading icon, colour escape hatches, and
     * five visual variants (solid / subtle / outline / ghost / plain).
     *
     * Every option sits flat on the bag; the factory composes the visual fields
     * into the nested IR `style` struct internally.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Button, Stack, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * // Primary action button
     * const save = East.function([], UIComponentType, _$ =>
     *     Button.Root("Save Changes", { variant: "solid", colorPalette: "blue" }),
     * );
     *
     * // Start + end icons + ghost variant with hover escape-hatch
     * const cta = East.function([], UIComponentType, _$ =>
     *     Button.Root("Continue", {
     *         startIcon: { prefix: "fas", name: "check" },
     *         endIcon: { prefix: "fas", name: "arrow-right" },
     *         variant: "ghost",
     *         hoverBackground: "#eef2ff",
     *     }),
     * );
     *
     * // Loading state with custom spinner icon + loading text
     * const submit = East.function([], UIComponentType, _$ =>
     *     Button.Root("Submit", {
     *         loading: true,
     *         loadingText: "Submitting…",
     *         loadingIcon: { prefix: "fas", name: "spinner" },
     *     }),
     * );
     *
     * // Rich UIComp label — HStack of Text children
     * const accept = East.function([], UIComponentType, _$ =>
     *     Button.Root(
     *         Stack.HStack([
     *             Text.Root("Accept"),
     *             Text.Root("→ log to MES", { color: "fg.muted" }),
     *         ]),
     *         { variant: "solid", colorPalette: "green" },
     *     ),
     * );
     * ```
     */
    Root: createButton,
    Types: {
        /**
         * The concrete East type for Button component data — mirrors the inline
         * `Button` variant in `component.ts`.
         *
         * @remarks
         * Use this for `equalFor` + `ValueTypeOf` in renderers.
         *
         * @property label - Rich label (UIComponentType)
         * @property startIcon - Optional leading icon slot
         * @property endIcon - Optional trailing icon slot
         * @property loadingText - Label text shown when `loading` is true
         * @property loadingIcon - Icon swapped in for `startIcon` when `loading` is true
         * @property loading - Loading state
         * @property disabled - Disabled state
         * @property onClick - Click handler
         * @property style - Visual-presentation sub-struct
         */
        Button: ButtonType,
        /**
         * Visual-only style struct for Button. See {@link ButtonStyleType}.
         */
        Style: ButtonStyleType,
        /**
         * Variant enum for Button visual presets.
         *
         * @property solid - Solid filled button (default primary action)
         * @property subtle - Subtle/light background button
         * @property outline - Outlined button with border
         * @property ghost - Transparent button, visible on hover
         * @property plain - Unadorned pressable text
         */
        Variant: ButtonVariantType,
    },
} as const;
