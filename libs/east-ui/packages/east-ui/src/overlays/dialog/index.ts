/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType, OptionType,
    StructType,
    ArrayType,
    variant,
    some,
    none,
    NullType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    DialogSizeType,
    DialogPlacementType,
    DialogScrollBehaviorType,
    DialogMotionPresetType,
    DialogRoleType,
    DialogStyleType,
    type DialogStyle
} from "./types.js";

// Re-export types
export {
    DialogSizeType,
    DialogPlacementType,
    DialogScrollBehaviorType,
    DialogMotionPresetType,
    DialogRoleType,
    DialogStyleType,
    type DialogStyle,
} from "./types.js";
export type { DialogSizeLiteral, DialogPlacementLiteral, DialogScrollBehaviorLiteral, DialogMotionPresetLiteral, DialogRoleLiteral } from "./types.js";

// ============================================================================
// Dialog Type
// ============================================================================

/**
 * East StructType for Dialog component.
 *
 * @remarks
 * Dialog is a modal overlay with a trigger and body content.
 * The trigger can be any UI component, and body contains UI children.
 *
 * @property trigger - The UI component that opens the dialog
 * @property body - Array of UI components for dialog content
 * @property title - Optional dialog title
 * @property description - Optional dialog description
 * @property style - Optional style configuration
 */
export const DialogType: StructType<{
    trigger: UIComponentType,
    body: ArrayType<UIComponentType>,
    eyebrow: OptionType<StringType>,
    title: OptionType<StringType>,
    description: OptionType<StringType>,
    style: OptionType<DialogStyleType>,
}> = StructType({
    trigger: UIComponentType,
    body: ArrayType(UIComponentType),
    eyebrow: OptionType(StringType),
    title: OptionType(StringType),
    description: OptionType(StringType),
    style: OptionType(DialogStyleType),
});

/**
 * Type alias for DialogType.
 */
export type DialogType = typeof DialogType;

// ============================================================================
// Dialog Open Input Type
// ============================================================================

/**
 * East StructType for programmatic dialog opening.
 *
 * @remarks
 * This type is used with {@link dialog_open} to programmatically open a dialog
 * without a trigger element. Unlike {@link DialogType}, this does not include
 * a trigger property.
 *
 * @property body - Array of UI components for dialog content
 * @property title - Optional dialog title
 * @property description - Optional dialog description
 * @property style - Optional style configuration
 */
export const DialogOpenInputType: StructType<{
    body: ArrayType<UIComponentType>,
    eyebrow: OptionType<StringType>,
    title: OptionType<StringType>,
    description: OptionType<StringType>,
    style: OptionType<DialogStyleType>,
}> = StructType({
    body: ArrayType(UIComponentType),
    eyebrow: OptionType(StringType),
    title: OptionType(StringType),
    description: OptionType(StringType),
    style: OptionType(DialogStyleType),
});

/**
 * Type alias for DialogOpenInputType.
 */
export type DialogOpenInputType = typeof DialogOpenInputType;

// ============================================================================
// Dialog Function
// ============================================================================

/**
 * Creates a Dialog component with a trigger and body content.
 *
 * @param body - Array of UI components for dialog content
 * @param options - Required `trigger` + optional `eyebrow` / `title` /
 *   `description` / visual style fields
 * @returns An East expression representing the dialog component
 *
 * @remarks
 * Dialog is a modal window that appears above the main content.
 * It captures focus and prevents interaction with the underlying page.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Dialog, Button, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Dialog.Root([Text.Root("Dialog content here")], {
 *         trigger: Button.Root("Open Dialog"),
 *         title: "My Dialog",
 *     });
 * });
 * ```
 */
export interface DialogOptions extends DialogStyle {
    /** The UI component that opens the dialog — required. */
    trigger: SubtypeExprOrValue<UIComponentType>;
}

function createDialog(
    body: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options: DialogOptions,
): ExprType<UIComponentType> {
    const { trigger, ...style } = options;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), DialogSizeType)
            : style.size)
        : undefined;

    const placementValue = style.placement
        ? (typeof style.placement === "string"
            ? East.value(variant(style.placement, null), DialogPlacementType)
            : style.placement)
        : undefined;

    const scrollBehaviorValue = style.scrollBehavior
        ? (typeof style.scrollBehavior === "string"
            ? East.value(variant(style.scrollBehavior, null), DialogScrollBehaviorType)
            : style.scrollBehavior)
        : undefined;

    const motionPresetValue = style.motionPreset
        ? (typeof style.motionPreset === "string"
            ? East.value(variant(style.motionPreset, null), DialogMotionPresetType)
            : style.motionPreset)
        : undefined;

    const roleValue = style.role
        ? (typeof style.role === "string"
            ? East.value(variant(style.role, null), DialogRoleType)
            : style.role)
        : undefined;

    const hasStyle = sizeValue || placementValue || scrollBehaviorValue || motionPresetValue || roleValue ||
        style.onOpenChange !== undefined || style.onExitComplete !== undefined ||
        style.onEscapeKeyDown !== undefined || style.onInteractOutside !== undefined;

    return East.value(variant("Dialog", {
        trigger: trigger,
        body: body,
        eyebrow: style.eyebrow !== undefined ? some(style.eyebrow) : none,
        title: style.title !== undefined ? some(style.title) : none,
        description: style.description !== undefined ? some(style.description) : none,
        style: hasStyle
            ? some(East.value({
                size: sizeValue ? some(sizeValue) : none,
                placement: placementValue ? some(placementValue) : none,
                scrollBehavior: scrollBehaviorValue ? some(scrollBehaviorValue) : none,
                motionPreset: motionPresetValue ? some(motionPresetValue) : none,
                role: roleValue ? some(roleValue) : none,
                onOpenChange: style.onOpenChange !== undefined ? some(style.onOpenChange) : none,
                onExitComplete: style.onExitComplete !== undefined ? some(style.onExitComplete) : none,
                onEscapeKeyDown: style.onEscapeKeyDown !== undefined ? some(style.onEscapeKeyDown) : none,
                onInteractOutside: style.onInteractOutside !== undefined ? some(style.onInteractOutside) : none,
            }, DialogStyleType))
            : none,
    }), UIComponentType);
}

// ============================================================================
// Dialog Open Platform Function
// ============================================================================

/**
 * Platform function to programmatically open a dialog.
 *
 * @remarks
 * Opens a dialog without requiring a trigger element. The dialog content,
 * title, description, and style are specified in the {@link DialogOpenInputType} parameter.
 * Pass `Dialog.Implementation` to `ir.compile()` to enable this functionality.
 *
 * @param input - The dialog configuration including body content and style
 * @returns Null
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { Dialog, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const showAlert = East.function([], NullType, $ => {
 *     $(Dialog.open(East.value({
 *         body: [Text.Root("Are you sure?")],
 *         title: variant("some", "Confirm"),
 *         description: variant("none", null),
 *         style: variant("none", null),
 *     }, Dialog.Types.OpenInput)));
 * });
 * ```
 */
export const dialog_open = East.platform(
    "dialog_open", 
    [DialogOpenInputType], 
    NullType,
    {
        optional: true
    }
);

/**
 * Dialog component for modal overlays.
 *
 * @remarks
 * Use `Dialog.Root(body, { trigger, ... })` to create a dialog, or access `Dialog.Types` for East types.
 */
export const Dialog = {
    /**
     * Creates a Dialog component with a trigger and body content.
     *
     * @param body - Array of UI components for dialog content
     * @param options - Required `trigger` + optional `eyebrow` / `title` /
     *   `description` / visual style fields
     * @returns An East expression representing the dialog component
     *
     * @remarks
     * Dialog is a modal window that appears above the main content.
     * It captures focus and prevents interaction with the underlying page.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Dialog, Button, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Dialog.Root([Text.Root("Dialog content here")], {
     *         trigger: Button.Root("Open Dialog"),
     *         title: "My Dialog",
     *     });
     * });
     * ```
     */
    Root: createDialog,
    /**
     * Platform function to programmatically open a dialog.
     *
     * @remarks
     * Opens a dialog without requiring a trigger element. Pass `Dialog.Implementation`
     * to `ir.compile()` to enable this functionality.
     *
     * @example
     * ```ts
     * import { East, NullType, variant } from "@elaraai/east";
     * import { Dialog, Text } from "@elaraai/east-ui";
     *
     * const showAlert = East.function([], NullType, $ => {
     *     $(Dialog.open(East.value({
     *         body: [Text.Root("Are you sure?")],
     *         title: variant("some", "Confirm"),
     *         description: variant("none", null),
     *         style: variant("none", null),
     *     }, Dialog.Types.OpenInput)));
     * });
     * ```
     */
    open: dialog_open,
    Types: {
        /**
         * East StructType for Dialog component.
         *
         * @remarks
         * Dialog is a modal overlay with a trigger and body content.
         * The trigger can be any UI component, and body contains UI children.
         *
         * @property trigger - The UI component that opens the dialog
         * @property body - Array of UI components for dialog content
         * @property title - Optional dialog title
         * @property description - Optional dialog description
         * @property style - Optional style configuration
         */
        Dialog: DialogType,
        /**
         * Style type for Dialog component.
         *
         * @property size - Dialog size variant
         * @property placement - Vertical positioning
         * @property scrollBehavior - Scroll behavior
         * @property motionPreset - Animation style
         * @property role - ARIA role
         */
        Style: DialogStyleType,
        /**
         * Size variant type for Dialog component.
         *
         * @property xs - Extra small (24rem max width)
         * @property sm - Small (28rem max width)
         * @property md - Medium (32rem max width)
         * @property lg - Large (42rem max width)
         * @property xl - Extra large (56rem max width)
         * @property cover - Full viewport with padding
         * @property full - Full viewport width
         */
        Size: DialogSizeType,
        /**
         * Placement variant type for Dialog component.
         *
         * @property center - Center of viewport
         * @property top - Top of viewport
         * @property bottom - Bottom of viewport
         */
        Placement: DialogPlacementType,
        /**
         * Scroll behavior variant type for Dialog component.
         *
         * @property inside - Content scrolls inside dialog
         * @property outside - Positioner handles scrolling
         */
        ScrollBehavior: DialogScrollBehaviorType,
        /**
         * Motion preset variant type for Dialog component.
         *
         * @property scale - Scale and fade animation
         * @property slide-in-bottom - Slide from bottom
         * @property slide-in-top - Slide from top
         * @property slide-in-left - Slide from left
         * @property slide-in-right - Slide from right
         * @property none - No animation
         */
        MotionPreset: DialogMotionPresetType,
        /**
         * ARIA role variant type for Dialog component.
         *
         * @property dialog - Standard dialog role
         * @property alertdialog - Alert dialog role for confirmations
         */
        Role: DialogRoleType,
        /**
         * East StructType for programmatic dialog opening.
         *
         * @remarks
         * Use this type with {@link Dialog.open} to programmatically open a dialog
         * without a trigger element.
         *
         * @property body - Array of UI components for dialog content
         * @property title - Optional dialog title
         * @property description - Optional dialog description
         * @property style - Optional style configuration
         */
        OpenInput: DialogOpenInputType,
    },
} as const;
