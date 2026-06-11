/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    BooleanType,
    FunctionType,
    NullType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { DensityType, SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { IconType } from "../icon/types.js";
import {
    EditableChipStyleType,
    type EditableChipOptions,
} from "./types.js";

export {
    EditableChipStyleType,
    type EditableChipOptions,
} from "./types.js";

// ============================================================================
// EditableChipType — standalone mirror of the inline variant
// ============================================================================

/**
 * East StructType for an EditableChip value — mirrors the inline
 * `EditableChip` variant in `component.ts`.
 *
 * @remarks
 * Main struct holds the rich `label` (UIComponent), an optional trigger
 * icon (defaults to `faChevronDown` in the renderer), state
 * (`disabled`), behaviour (`onClick`), and a `style` sub-struct.
 *
 * @property label - Rich label (UIComponent) — e.g. `"Service level · 85%"`
 * @property trigger - Optional trailing icon (defaults to `faChevronDown`)
 * @property disabled - Disabled state
 * @property onClick - Click callback
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property style - Optional visual style sub-struct
 */
export const EditableChipType: StructType<{
    label: UIComponentType,
    trigger: OptionType<IconType>,
    disabled: OptionType<BooleanType>,
    onClick: OptionType<FunctionType<[], NullType>>,
    density: OptionType<DensityType>,
    style: OptionType<EditableChipStyleType>,
}> = StructType({
    label: UIComponentType,
    trigger: OptionType(IconType),
    disabled: OptionType(BooleanType),
    onClick: OptionType(FunctionType([], NullType)),
    density: OptionType(DensityType),
    style: OptionType(EditableChipStyleType),
});

/** Type alias for EditableChipType. */
export type EditableChipType = typeof EditableChipType;

// ============================================================================
// Helpers
// ============================================================================

function buildEditableChipStyle(options: EditableChipOptions | undefined): ExprType<EditableChipStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.size !== undefined
        || options.borderRadius !== undefined
        || options.color !== undefined
        || options.background !== undefined
        || options.borderColor !== undefined
        || options.triggerIconColor !== undefined;
    if (!hasAny) return undefined;

    const sizeValue = options.size !== undefined
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), SizeType)
            : options.size)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        borderRadius: options.borderRadius !== undefined ? some(options.borderRadius) : none,
        color: options.color !== undefined ? some(options.color) : none,
        background: options.background !== undefined ? some(options.background) : none,
        borderColor: options.borderColor !== undefined ? some(options.borderColor) : none,
        triggerIconColor: options.triggerIconColor !== undefined ? some(options.triggerIconColor) : none,
    }, EditableChipStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates an EditableChip component value — a clickable label chip used to
 * surface editable context / assumptions.
 *
 * @param label - Rich label (UIComponent)
 * @param options - Optional `trigger` / `disabled` / `onClick` + visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * When `trigger` is absent, the renderer substitutes a `faChevronDown`
 * icon. Consumed by ContextSelector / AssumptionsBar patterns — the
 * `onClick` callback typically opens a popover / picker authored by the
 * consumer.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { EditableChip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     const onClick = $.const(East.function([], NullType, _ => {}));
 *     return EditableChip.Root(Text.Root("Service level · 85%"), { onClick });
 * });
 * ```
 */
function createEditableChip(
    label: SubtypeExprOrValue<UIComponentType>,
    options?: EditableChipOptions,
): ExprType<UIComponentType> {
    const styleValue = buildEditableChipStyle(options);
    const densityValue = options?.density !== undefined
        ? (typeof options.density === "string"
            ? East.value(variant(options.density, null), DensityType)
            : options.density)
        : undefined;

    return East.value(variant("EditableChip", {
        label,
        trigger: options?.trigger !== undefined ? some(options.trigger as SubtypeExprOrValue<IconType>) : none,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
        onClick: options?.onClick !== undefined ? some(options.onClick) : none,
        density: densityValue ? some(densityValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface EditableChipNamespace {
    Root: typeof createEditableChip;
    Types: {
        EditableChip: typeof EditableChipType;
        Style: typeof EditableChipStyleType;
    };
}

/**
 * EditableChip — clickable label chip that surfaces editable context.
 *
 * @remarks
 * Use `EditableChip.Root(label, options?)`. Consumed by ContextSelector /
 * AssumptionsBar patterns.
 */
export const EditableChip: EditableChipNamespace = {
    /**
     * Creates an EditableChip component value.
     *
     * @param label - Rich label (UIComponent)
     * @param options - Optional `trigger` / `disabled` / `onClick` + visual style
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { EditableChip, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return EditableChip.Root(Text.Root("Scenario: Q4 forecast"), { disabled: true });
     * });
     * ```
     */
    Root: createEditableChip,
    Types: {
        /**
         * East StructType for an EditableChip value — the serialisable IR
         * shape mirroring the inline `EditableChip` variant in
         * `component.ts`.
         *
         * @property label - Rich label (UIComponent)
         * @property trigger - Optional trailing icon (defaults to `faChevronDown`)
         * @property disabled - Disabled state
         * @property onClick - Click callback
         * @property density - Density override shared with `ChipRail` / `Trace`
         * @property style - Optional visual style sub-struct
         */
        EditableChip: EditableChipType,
        /**
         * East StructType holding every visual field for an EditableChip.
         *
         * @property size - Size preset (sm / md / lg)
         * @property color - Explicit text colour override
         * @property background - Explicit background override
         * @property borderColor - Explicit border colour override
         * @property triggerIconColor - Explicit trigger icon colour override
         */
        Style: EditableChipStyleType,
    },
};
