/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { ColorSchemeType, SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    RadioGroupType,
    RadioGroupStyleType,
    RadioGroupOrientationType,
    RadioItemType,
    type RadioGroupStyle,
    type RadioItemInput,
} from "./types.js";

export {
    RadioGroupType,
    RadioGroupStyleType,
    RadioGroupOrientationType,
    RadioItemType,
    type RadioGroupStyle,
    type RadioItemInput,
} from "./types.js";

/**
 * Creates a `RadioGroup` component — single-select radio list with
 * optional rich item labels.
 *
 * @param value - Currently selected item value (empty string when none)
 * @param items - Array of items: each `{ value, label?, disabled? }`
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the RadioGroup component
 *
 * @remarks
 * Selection is controlled — pass `value` from State and the
 * `onChange` callback writes back. Items render in `vertical`
 * orientation by default; switch to `horizontal` via
 * `style.orientation`.
 *
 * @example
 * ```ts
 * import { East, StringType, NullType } from "@elaraai/east";
 * import { RadioGroup, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const choiceBind = $.let(State.bind([StringType], "choice", "yes"));
 *         const choice = $.let(choiceBind.read(), StringType);
 *         const onChange = $.const(East.function([StringType], NullType, ($, next) => {
 *             $(choiceBind.write(next));
 *         }));
 *         return RadioGroup.Root(
 *             choice,
 *             [
 *                 { value: "yes", label: "Yes" },
 *                 { value: "no", label: "No" },
 *                 { value: "maybe", label: "Maybe", disabled: true },
 *             ],
 *             { onChange, colorPalette: "blue" },
 *         );
 *     }));
 * });
 * ```
 */
function createRadioGroup(
    value: SubtypeExprOrValue<StringType>,
    items: RadioItemInput[],
    style?: RadioGroupStyle,
): ExprType<UIComponentType> {
    const itemsExpr = items.map(item => East.value({
        value: item.value,
        label: item.label !== undefined ? some(item.label) : none,
        disabled: item.disabled !== undefined ? some(item.disabled) : none,
    }, RadioItemType));

    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const orientationValue = style?.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation, null), RadioGroupOrientationType)
            : style.orientation)
        : undefined;

    const hasStyle = !!style && (
        colorPaletteValue !== undefined ||
        sizeValue !== undefined ||
        orientationValue !== undefined ||
        style.color !== undefined ||
        style.fillColor !== undefined ||
        style.borderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        orientation: orientationValue ? some(orientationValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        fillColor: style!.fillColor !== undefined ? some(style!.fillColor) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
    }, RadioGroupStyleType) : undefined;

    return East.value(variant("RadioGroup", {
        value,
        items: itemsExpr,
        name: style?.name !== undefined ? some(style.name) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        required: style?.required !== undefined ? some(style.required) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface RadioGroupNamespace {
    Root: typeof createRadioGroup;
    Types: {
        Root: typeof RadioGroupType;
        Style: typeof RadioGroupStyleType;
        Orientation: typeof RadioGroupOrientationType;
        Item: typeof RadioItemType;
    };
}

/**
 * `RadioGroup` namespace — single-select radio list primitive.
 *
 * @remarks
 * Use `RadioGroup.Root(value, items, options?)` to construct.
 * Access IR types via `RadioGroup.Types.Root`,
 * `RadioGroup.Types.Style`, `RadioGroup.Types.Item`,
 * `RadioGroup.Types.Orientation`.
 */
export const RadioGroup: RadioGroupNamespace = {
    Root: createRadioGroup,
    Types: {
        /**
         * East StructType for the `RadioGroup` value.
         *
         * @property value - Currently selected item value
         * @property items - Array of {@link RadioItemType} items
         * @property name - Optional radio-group name attribute
         * @property disabled - Optional group-wide disabled flag
         * @property required - Optional `required` form-attribute
         * @property onChange - Callback fired with the newly-selected `value`
         * @property style - Optional visual style sub-struct
         */
        Root: RadioGroupType,
        /**
         * East StructType holding visual fields for `RadioGroup`.
         *
         * @property colorPalette - Chakra colour palette for the radio fill
         * @property size - Radio size (`sm` / `md` / `lg`)
         * @property orientation - Layout orientation (`horizontal` / `vertical`)
         * @property color - Explicit text colour for item labels
         * @property fillColor - Explicit fill colour for the selected radio
         * @property borderColor - Explicit border colour for unselected radios
         */
        Style: RadioGroupStyleType,
        /**
         * Orientation variant for `RadioGroup` layout.
         *
         * @property horizontal - Items laid out in a row
         * @property vertical - Items laid out in a column
         */
        Orientation: RadioGroupOrientationType,
        /**
         * East StructType for an individual radio item.
         *
         * @property value - Canonical value emitted on selection
         * @property label - Optional display label
         * @property disabled - Optional per-item disabled flag
         */
        Item: RadioItemType,
    },
};
