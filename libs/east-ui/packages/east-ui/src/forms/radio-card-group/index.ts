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
    RadioCardGroupType,
    RadioCardGroupStyleType,
    RadioCardGroupOrientationType,
    RadioCardItemType,
    type RadioCardGroupStyle,
} from "./types.js";

export {
    RadioCardGroupType,
    RadioCardGroupStyleType,
    RadioCardGroupOrientationType,
    RadioCardItemType,
    type RadioCardGroupStyle,
    type RadioCardItemInput,
} from "./types.js";

/**
 * Creates a `RadioCardGroup` component — single-select card list with
 * label + optional description per card.
 *
 * @param options - Required `value` + `items` (each `{ value, label,
 *   description?, disabled? }`), optional styling + behaviour configuration
 * @returns An East expression representing the RadioCardGroup component
 *
 * @example
 * ```ts
 * import { East, StringType, NullType } from "@elaraai/east";
 * import { RadioCardGroup, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const planBind = $.let(State.bind([StringType], "plan", "starter"));
 *         const plan = $.let(planBind.read(), StringType);
 *         const onChange = $.const(East.function([StringType], NullType, ($, next) => {
 *             $(planBind.write(next));
 *         }));
 *         return RadioCardGroup.Root({
 *             value: plan,
 *             items: [
 *                 { value: "starter", label: "Starter", description: "Up to 5 users" },
 *                 { value: "team", label: "Team", description: "Up to 50 users" },
 *                 { value: "business", label: "Business", description: "Unlimited" },
 *             ],
 *             onChange,
 *             colorPalette: "blue",
 *         });
 *     }));
 * });
 * ```
 */
function createRadioCardGroup(
    options: RadioCardGroupStyle,
): ExprType<UIComponentType> {
    const { value, items } = options;

    const itemsExpr = items.map(item => East.value({
        value: item.value,
        label: item.label,
        description: item.description !== undefined ? some(item.description) : none,
        disabled: item.disabled !== undefined ? some(item.disabled) : none,
    }, RadioCardItemType));

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
            ? East.value(variant(options.orientation, null), RadioCardGroupOrientationType)
            : options.orientation)
        : undefined;

    const hasStyle = (
        colorPaletteValue !== undefined ||
        sizeValue !== undefined ||
        orientationValue !== undefined ||
        options.color !== undefined ||
        options.descriptionColor !== undefined ||
        options.cardBackground !== undefined ||
        options.selectedCardBackground !== undefined ||
        options.selectedBorderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        orientation: orientationValue ? some(orientationValue) : none,
        color: options.color !== undefined ? some(options.color) : none,
        descriptionColor: options.descriptionColor !== undefined ? some(options.descriptionColor) : none,
        cardBackground: options.cardBackground !== undefined ? some(options.cardBackground) : none,
        selectedCardBackground: options.selectedCardBackground !== undefined ? some(options.selectedCardBackground) : none,
        selectedBorderColor: options.selectedBorderColor !== undefined ? some(options.selectedBorderColor) : none,
    }, RadioCardGroupStyleType) : undefined;

    return East.value(variant("RadioCardGroup", {
        value,
        items: itemsExpr,
        name: options.name !== undefined ? some(options.name) : none,
        disabled: options.disabled !== undefined ? some(options.disabled) : none,
        required: options.required !== undefined ? some(options.required) : none,
        onChange: options.onChange ? some(options.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface RadioCardGroupNamespace {
    Root: typeof createRadioCardGroup;
    Types: {
        Root: typeof RadioCardGroupType;
        Style: typeof RadioCardGroupStyleType;
        Orientation: typeof RadioCardGroupOrientationType;
        Item: typeof RadioCardItemType;
    };
}

/**
 * `RadioCardGroup` namespace — single-select card-style radio list.
 *
 * @remarks
 * Use `RadioCardGroup.Root({ value, items, ... })` to construct.
 * Each item carries a label + optional description; cards are
 * mutually exclusive selections styled as bordered surfaces.
 */
export const RadioCardGroup: RadioCardGroupNamespace = {
    Root: createRadioCardGroup,
    Types: {
        /**
         * East StructType for the `RadioCardGroup` value.
         *
         * @property value - Currently selected card value
         * @property items - Array of {@link RadioCardItemType} cards
         * @property name - Optional radio-group name attribute
         * @property disabled - Optional group-wide disabled flag
         * @property required - Optional `required` form-attribute
         * @property onChange - Callback fired with the newly-selected `value`
         * @property style - Optional visual style sub-struct
         */
        Root: RadioCardGroupType,
        /**
         * East StructType holding visual fields for `RadioCardGroup`.
         *
         * @property colorPalette - Chakra palette for selected card
         * @property size - Card size
         * @property orientation - Layout orientation
         * @property color - Primary label colour
         * @property descriptionColor - Description line colour
         * @property cardBackground - Unselected card bg
         * @property selectedCardBackground - Selected card bg
         * @property selectedBorderColor - Selected card border
         */
        Style: RadioCardGroupStyleType,
        /**
         * Orientation variant for `RadioCardGroup` layout.
         *
         * @property horizontal - Cards laid out in a row
         * @property vertical - Cards laid out in a column
         */
        Orientation: RadioCardGroupOrientationType,
        /**
         * East StructType for an individual radio card.
         *
         * @property value - Canonical value emitted on selection
         * @property label - Primary label
         * @property description - Optional secondary description
         * @property disabled - Optional per-item disabled flag
         */
        Item: RadioCardItemType,
    },
};
