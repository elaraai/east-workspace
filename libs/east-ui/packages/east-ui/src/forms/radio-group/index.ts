/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
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
 * @param options - Required `value` + `items` (each `{ value, label?,
 *   disabled? }`), optional styling + behaviour configuration
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
 *         return RadioGroup.Root({
 *             value: choice,
 *             items: [
 *                 { value: "yes", label: "Yes" },
 *                 { value: "no", label: "No" },
 *                 { value: "maybe", label: "Maybe", disabled: true },
 *             ],
 *             onChange,
 *             colorPalette: "blue",
 *         });
 *     }));
 * });
 * ```
 */
function createRadioGroup(
    options: RadioGroupStyle,
): ExprType<UIComponentType> {
    const { value, items } = options;

    const itemsExpr = Array.isArray(items)
        ? items.map(item => East.value({
            value: item.value,
            label: item.label !== undefined ? some(item.label) : none,
            disabled: item.disabled !== undefined ? some(item.disabled) : none,
        }, RadioItemType))
        : items;

    const colorPaletteValue = options.colorPalette
        ? (typeof options.colorPalette === "string"
            ? East.value(variant(options.colorPalette, null), ColorSchemeType)
            : options.colorPalette)
        : undefined;

    const sizeValue = options.size
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), SizeType)
            : options.size)
        : undefined;

    const orientationValue = options.orientation
        ? (typeof options.orientation === "string"
            ? East.value(variant(options.orientation, null), RadioGroupOrientationType)
            : options.orientation)
        : undefined;

    const hasStyle = (
        colorPaletteValue !== undefined ||
        sizeValue !== undefined ||
        orientationValue !== undefined ||
        options.color !== undefined ||
        options.fillColor !== undefined ||
        options.borderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        orientation: orientationValue ? some(orientationValue) : none,
        color: options.color !== undefined ? some(options.color) : none,
        fillColor: options.fillColor !== undefined ? some(options.fillColor) : none,
        borderColor: options.borderColor !== undefined ? some(options.borderColor) : none,
    }, RadioGroupStyleType) : undefined;

    return East.value(variant("RadioGroup", {
        value,
        items: itemsExpr,
        name: options.name !== undefined ? some(options.name) : none,
        disabled: options.disabled !== undefined ? some(options.disabled) : none,
        required: options.required !== undefined ? some(options.required) : none,
        onChange: options.onChange ? some(options.onChange) : none,
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
 * Use `RadioGroup.Root({ value, items, ... })` to construct.
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
