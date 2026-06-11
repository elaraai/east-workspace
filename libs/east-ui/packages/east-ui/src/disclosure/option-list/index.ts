/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
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
import { Text } from "../../typography/text/index.js";
import {
    OptionListStyleType,
    type OptionListStyle,
} from "./types.js";

// Re-export types
export {
    OptionListStyleType,
    type OptionListStyle,
} from "./types.js";

// ============================================================================
// OptionListItemType — standalone mirror of the inline item sub-struct
// ============================================================================

/**
 * Standalone mirror of the inline `OptionList` item sub-struct. Used by the
 * factory to coerce plain objects / strings to rich `UIComponentType` nodes.
 *
 * @property id - Stable option identifier (emitted by `onSelect`)
 * @property label - Rich node for the primary row label
 * @property description - Optional rich node rendered under the label
 * @property trailing - Optional rich node rendered on the right (e.g. impact chip)
 * @property disabled - Disable selection / interaction for this row
 */
export const OptionListItemType: StructType<{
    id: StringType,
    label: UIComponentType,
    description: OptionType<UIComponentType>,
    trailing: OptionType<UIComponentType>,
    disabled: OptionType<BooleanType>,
}> = StructType({
    id: StringType,
    label: UIComponentType,
    description: OptionType(UIComponentType),
    trailing: OptionType(UIComponentType),
    disabled: OptionType(BooleanType),
});

export type OptionListItemType = typeof OptionListItemType;

// ============================================================================
// OptionListType — standalone mirror of the inline `OptionList` variant
// ============================================================================

/**
 * Standalone mirror of the inline `OptionList` variant in `component.ts`.
 * Used by renderers for `equalFor` memoization.
 *
 * @property options - Array of selectable options
 * @property selectedId - Currently-selected option id (optional)
 * @property onSelect - Callback fired with the option id when a row is chosen
 * @property style - Optional visual-only style sub-struct
 */
export const OptionListType: StructType<{
    options: ArrayType<OptionListItemType>,
    selectedId: OptionType<StringType>,
    onSelect: OptionType<FunctionType<[StringType], NullType>>,
    style: OptionType<OptionListStyleType>,
}> = StructType({
    options: ArrayType(OptionListItemType),
    selectedId: OptionType(StringType),
    onSelect: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(OptionListStyleType),
});

export type OptionListType = typeof OptionListType;

// ============================================================================
// OptionList Item Factory
// ============================================================================

type OptionListInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * TypeScript options bag for `OptionList.Option`.
 *
 * @property description - Optional secondary description (rich or string)
 * @property trailing - Optional trailing slot (rich or string) — e.g. impact chip
 * @property disabled - Disable selection / interaction for this row
 */
export interface OptionListOptionOptions {
    /** Optional secondary description (rich or string) */
    description?: OptionListInput;
    /** Optional trailing slot (rich or string) — e.g. impact chip */
    trailing?: OptionListInput;
    /** Disable selection / interaction for this row */
    disabled?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates an OptionList option.
 *
 * @param id - Stable identifier emitted via `onSelect`
 * @param label - String (coerced to `Text.Root(s)`) or UIComponentType
 * @param options - Optional description / trailing slot / disabled flag
 * @returns An East expression representing the OptionList option
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { OptionList, Badge } from "@elaraai/east-ui";
 *
 * const opt = OptionList.Option("alt-2", "Shift batch to 06:00", {
 *     description: "+0.8h idle, −£312 overtime",
 *     trailing: Badge.Root("−£312", { colorPalette: "green" }),
 * });
 * ```
 */
function createOptionListOption(
    id: SubtypeExprOrValue<StringType>,
    label: OptionListInput,
    options?: OptionListOptionOptions,
): ExprType<OptionListItemType> {
    const labelExpr: ExprType<UIComponentType> = typeof label === "string"
        ? Text.Root(label)
        : label as ExprType<UIComponentType>;

    const descriptionValue = options?.description !== undefined
        ? (typeof options.description === "string"
            ? Text.Root(options.description)
            : options.description as ExprType<UIComponentType>)
        : undefined;

    const trailingValue = options?.trailing !== undefined
        ? (typeof options.trailing === "string"
            ? Text.Root(options.trailing)
            : options.trailing as ExprType<UIComponentType>)
        : undefined;

    return East.value({
        id: id,
        label: labelExpr,
        description: descriptionValue ? some(descriptionValue) : none,
        trailing: trailingValue ? some(trailingValue) : none,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
    }, OptionListItemType);
}

// ============================================================================
// OptionList Root Factory
// ============================================================================

/**
 * TypeScript options bag for `OptionList.Root`.
 *
 * @property selectedId - Currently-selected option id
 * @property onSelect - Callback fired with the option id when a row is chosen
 * @property itemColor - Option label colour
 * @property itemHoverBackground - Row hover background colour
 * @property selectedBackground - Selected-row background colour
 * @property borderColor - List border colour
 * @property impactColor - Trailing impact / metric colour
 */
export interface OptionListOptions extends OptionListStyle {
    /** Currently-selected option id */
    selectedId?: SubtypeExprOrValue<StringType>;
    /** Callback fired with the option id when a row is chosen */
    onSelect?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
}

/**
 * Creates an OptionList — a keyboard-navigable list of selectable options.
 *
 * @param options - Array of options (created with `OptionList.Option`)
 * @param opts - Optional `selectedId` / `onSelect` / `style`
 * @returns An East expression representing the OptionList component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { OptionList, UIComponentType } from "@elaraai/east-ui";
 *
 * const alternatives = East.function([], UIComponentType, _$ =>
 *     OptionList.Root([
 *         OptionList.Option("alt-1", "Keep current plan", {
 *             description: "+£0 overtime, 2 unmet shifts",
 *         }),
 *         OptionList.Option("alt-2", "Shift batch to 06:00", {
 *             description: "+0.8h idle, −£312 overtime",
 *         }),
 *     ], { selectedId: "alt-1" }),
 * );
 * ```
 */
function createOptionListRoot(
    options: SubtypeExprOrValue<ArrayType<OptionListItemType>>,
    opts?: OptionListOptions,
): ExprType<UIComponentType> {
    const { selectedId, onSelect, ...visual } = opts ?? {};

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildOptionListStyle(visual) : undefined;

    return East.value(variant("OptionList", {
        options: options as never,
        selectedId: selectedId !== undefined ? some(selectedId) : none,
        onSelect: onSelect !== undefined ? some(onSelect) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildOptionListStyle(style: OptionListStyle): ExprType<OptionListStyleType> {
    return East.value({
        itemColor: style.itemColor !== undefined ? some(style.itemColor) : none,
        itemHoverBackground: style.itemHoverBackground !== undefined ? some(style.itemHoverBackground) : none,
        selectedBackground: style.selectedBackground !== undefined ? some(style.selectedBackground) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        impactColor: style.impactColor !== undefined ? some(style.impactColor) : none,
    }, OptionListStyleType);
}

/**
 * OptionList primitive — keyboard-navigable list of selectable options.
 *
 * @remarks
 * Use for alternatives lists (shift-optimiser what-if), selectable driver
 * lists, or any surface that renders a picker over a small-to-medium set
 * of rows with rich labels / descriptions / trailing chips.
 */
export const OptionList = {
    /**
     * Creates an OptionList container.
     *
     * @param options - Array of options
     * @param opts - Optional `selectedId` / `onSelect` / `style`
     *
     * @example
     * ```ts
     * OptionList.Root([
     *     OptionList.Option("alt-1", "Keep current plan"),
     *     OptionList.Option("alt-2", "Shift batch to 06:00"),
     * ], { selectedId: "alt-1" });
     * ```
     */
    Root: createOptionListRoot,
    /**
     * Creates an OptionList option.
     *
     * @param id - Stable identifier emitted via `onSelect`
     * @param label - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param options - Optional description / trailing / disabled
     */
    Option: createOptionListOption,
    Types: {
        /**
         * East StructType for an OptionList value — mirrors the inline
         * `OptionList` variant in `component.ts`.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `OptionList.Types.OptionList` without reaching into module
         * internals.
         *
         * @property options - Array of option rows (see `Option`)
         * @property selectedId - Optional currently-selected option id
         * @property onSelect - Optional callback invoked with the selected id
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        OptionList: OptionListType,
        /**
         * East StructType for an OptionList option row.
         *
         * @remarks
         * Each option carries a stable `id` (emitted via `onSelect`), a
         * rich `label` + optional `description` + optional `trailing`
         * slot (e.g. an impact chip), and a `disabled` flag.
         *
         * @property id - Stable option identifier (emitted via `onSelect`)
         * @property label - Rich node for the primary row label
         * @property description - Optional rich node rendered under the label
         * @property trailing - Optional rich node rendered on the right (e.g. impact chip)
         * @property disabled - Disable selection / interaction for this row
         */
        Option: OptionListItemType,
        /**
         * East StructType holding every visual field for an OptionList.
         *
         * @remarks
         * Mirror of `OptionListStyleType` from `./types.js`. Covers item
         * text colour, hover / selected backgrounds, the border colour
         * between rows, and the trailing impact-chip colour slot.
         *
         * @property itemColor - Default row text colour
         * @property itemHoverBackground - Background applied on hover
         * @property selectedBackground - Background applied to the selected row
         * @property borderColor - Divider colour between rows
         * @property impactColor - Colour of the trailing impact chip / accent
         */
        Style: OptionListStyleType,
    },
} as const;
