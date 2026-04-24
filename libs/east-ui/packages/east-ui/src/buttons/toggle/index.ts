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
    BooleanType,
    FunctionType,
    NullType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType } from "../../style.js";
import { IconType } from "../../display/icon/types.js";
import { Text } from "../../typography/text/index.js";
import {
    ToggleStyleType,
    ButtonVariantType,
    type ToggleStyle,
    type ToggleOptions,
    type ButtonVariantLiteral,
} from "./types.js";

// Re-export types
export {
    ToggleStyleType,
    type ToggleStyle,
    type ToggleOptions,
} from "./types.js";

// ============================================================================
// ToggleType — standalone mirror of the inline `Toggle` variant in component.ts
// ============================================================================

/**
 * Concrete struct mirroring the inline `Toggle` variant defined in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`
 * because Toggle's recursive `label: UIComp` field forces its main variant
 * to be defined inline in the recursive `UIComponentType`.
 *
 * @remarks
 * Same pattern as `List.Types.List`, `Note.Types.Note`, and
 * `Button.Types.Button` — mirror exposes the shape as a standalone type for
 * tooling.
 *
 * @property label - Toggle label (UIComponentType — strings coerced to `Text.Root(s)`)
 * @property icon - Optional leading icon
 * @property pressed - Current pressed state (required)
 * @property disabled - Disabled state
 * @property onChange - Callback invoked with the new pressed value
 * @property style - Visual-presentation sub-struct
 */
export const ToggleType: StructType<{
    label: UIComponentType,
    icon: OptionType<IconType>,
    pressed: BooleanType,
    disabled: OptionType<BooleanType>,
    onChange: OptionType<FunctionType<[BooleanType], NullType>>,
    style: OptionType<ToggleStyleType>,
}> = StructType({
    label: UIComponentType,
    icon: OptionType(IconType),
    pressed: BooleanType,
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(ToggleStyleType),
});

/**
 * Type representing the Toggle component structure.
 */
export type ToggleType = typeof ToggleType;

// ============================================================================
// Toggle Factory
// ============================================================================

type ToggleLabelInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates a Toggle — a two-state pressable affordance, typically used in
 * toolbars ("show gridlines", "auto-refresh", etc.). Distinct from `Switch`
 * (a binary-settings input) and `Checkbox`.
 *
 * @param label - String (coerced to `Text.Root(s)`) or any UIComponentType expression
 * @param pressed - Current pressed state (required — Toggle has no internal state)
 * @param options - Main-level fields plus optional `style` sub-struct
 * @returns An East expression representing the Toggle component
 *
 * @remarks
 * The renderer emits `aria-pressed={pressed}` and `data-pressed={pressed}` so
 * themes / CSS can distinguish the pressed state. `onChange` is invoked with
 * the new value (`!pressed`) on click — callers typically wire this to
 * `State.bind` inside a `Reactive.Root` body.
 *
 * Per the Type-shape convention: content + state + behaviour at top level;
 * visual presentation inside `options.style`.
 *
 * @example
 * ```ts
 * import { East, BooleanType, NullType } from "@elaraai/east";
 * import { Reactive, State, Toggle, UIComponentType } from "@elaraai/east-ui";
 *
 * const gridlinesToggle = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const bind = $.let(State.bind([BooleanType], "gridlines", false));
 *         const pressed = $.let(bind.read());
 *         const onChange = $.const(East.function([BooleanType], NullType, ($, next) => {
 *             $(bind.write(next));
 *         }));
 *         return Toggle.Root("Show gridlines", pressed, { onChange });
 *     })),
 * );
 * ```
 */
function createToggle(
    label: ToggleLabelInput,
    pressed: SubtypeExprOrValue<BooleanType>,
    options?: ToggleOptions,
): ExprType<UIComponentType> {
    const labelExpr: ExprType<UIComponentType> = typeof label === "string"
        ? Text.Root(label)
        : label as ExprType<UIComponentType>;

    const iconValue = options?.icon
        ? East.value({
            prefix: options.icon.prefix,
            name: options.icon.name,
            label: none,
            style: none,
        }, IconType)
        : undefined;

    const styleValue = options?.style ? buildToggleStyle(options.style) : undefined;

    return East.value(variant("Toggle", {
        label: labelExpr,
        icon: iconValue ? some(iconValue) : none,
        pressed,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
        onChange: options?.onChange ? some(options.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildToggleStyle(style: ToggleStyle): ExprType<ToggleStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant as ButtonVariantLiteral, null), ButtonVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        pressedBackground: style.pressedBackground !== undefined ? some(style.pressedBackground) : none,
        pressedColor: style.pressedColor !== undefined ? some(style.pressedColor) : none,
    }, ToggleStyleType);
}

/**
 * Toggle primitive — two-state pressable affordance.
 *
 * @remarks
 * Use `Toggle.Root(label, pressed, options?)` to create a toggle, or access
 * `Toggle.Types.Toggle` for the East type.
 */
export const Toggle = {
    /**
     * Creates a Toggle component.
     *
     * @param label - String (coerced to `Text.Root(s)`) or any UIComponentType expression
     * @param pressed - Current pressed state (required)
     * @param options - Main-level fields plus optional `style` sub-struct
     * @returns An East expression representing the Toggle component
     *
     * @remarks
     * Emits `aria-pressed` and `data-pressed` on the rendered button. See
     * {@link createToggle} for a full `Reactive.Root` example.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Toggle, UIComponentType } from "@elaraai/east-ui";
     *
     * const presentational = East.function([], UIComponentType, _$ =>
     *     Toggle.Root("Show gridlines", true, {
     *         icon: { prefix: "fas", name: "table-cells" },
     *         style: { variant: "subtle", size: "sm" },
     *     }),
     * );
     * ```
     */
    Root: createToggle,
    Types: {
        /**
         * The concrete East type for Toggle component data — mirrors the
         * inline `Toggle` variant in `component.ts`.
         *
         * @property label - Rich label (UIComponentType)
         * @property icon - Optional leading icon
         * @property pressed - Current pressed state
         * @property disabled - Disabled state
         * @property onChange - Callback invoked with the new pressed value
         * @property style - Visual-presentation sub-struct
         */
        Toggle: ToggleType,
        /**
         * Visual-only style struct for Toggle. See {@link ToggleStyleType}.
         */
        Style: ToggleStyleType,
        /**
         * Variant enum shared with Button (`solid` / `subtle` / `outline` / `ghost` / `plain`).
         */
        Variant: ButtonVariantType,
    },
} as const;
