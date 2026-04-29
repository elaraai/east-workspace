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
    RadioCardGroupType,
    RadioCardGroupStyleType,
    RadioCardGroupOrientationType,
    RadioCardItemType,
    type RadioCardGroupStyle,
    type RadioCardItemInput,
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
 * @param value - Currently selected card value (empty string when none)
 * @param items - Array of card entries `{ value, label, description?, disabled? }`
 * @param style - Optional styling + behaviour configuration
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
 *         return RadioCardGroup.Root(
 *             plan,
 *             [
 *                 { value: "starter", label: "Starter", description: "Up to 5 users" },
 *                 { value: "team", label: "Team", description: "Up to 50 users" },
 *                 { value: "business", label: "Business", description: "Unlimited" },
 *             ],
 *             { onChange, colorPalette: "blue" },
 *         );
 *     }));
 * });
 * ```
 */
function createRadioCardGroup(
    value: SubtypeExprOrValue<StringType>,
    items: RadioCardItemInput[],
    style?: RadioCardGroupStyle,
): ExprType<UIComponentType> {
    const itemsExpr = items.map(item => East.value({
        value: item.value,
        label: item.label,
        description: item.description !== undefined ? some(item.description) : none,
        disabled: item.disabled !== undefined ? some(item.disabled) : none,
    }, RadioCardItemType));

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
            ? East.value(variant(style.orientation, null), RadioCardGroupOrientationType)
            : style.orientation)
        : undefined;

    const hasStyle = !!style && (
        colorPaletteValue !== undefined ||
        sizeValue !== undefined ||
        orientationValue !== undefined ||
        style.color !== undefined ||
        style.descriptionColor !== undefined ||
        style.cardBackground !== undefined ||
        style.selectedCardBackground !== undefined ||
        style.selectedBorderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        orientation: orientationValue ? some(orientationValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        descriptionColor: style!.descriptionColor !== undefined ? some(style!.descriptionColor) : none,
        cardBackground: style!.cardBackground !== undefined ? some(style!.cardBackground) : none,
        selectedCardBackground: style!.selectedCardBackground !== undefined ? some(style!.selectedCardBackground) : none,
        selectedBorderColor: style!.selectedBorderColor !== undefined ? some(style!.selectedBorderColor) : none,
    }, RadioCardGroupStyleType) : undefined;

    return East.value(variant("RadioCardGroup", {
        value,
        items: itemsExpr,
        name: style?.name !== undefined ? some(style.name) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        required: style?.required !== undefined ? some(style.required) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
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
 * Use `RadioCardGroup.Root(value, items, options?)` to construct.
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
