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

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    CommandPaletteType,
    CommandPaletteStyleType,
    CommandType,
    type CommandPaletteStyle,
    type CommandInput,
} from "./types.js";

export {
    CommandPaletteType,
    CommandPaletteStyleType,
    CommandType,
    type CommandPaletteStyle,
    type CommandInput,
} from "./types.js";

/**
 * Creates a `CommandPalette` — ⌘K-style command launcher.
 *
 * @param commands - Array of command items
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the CommandPalette
 *
 * @remarks
 * Default keyboard trigger is `"mod+k"` (⌘K / Ctrl+K). Each command
 * carries an `action` callback fired when the user selects it. Group
 * labels emerge from the `group` field — commands sharing a group
 * render under a heading.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { CommandPalette, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     const noop = $.const(East.function([], NullType, () => { /* run command *\/ }));
 *     return CommandPalette.Root(
 *         [
 *             { id: "save", label: "Save", shortcut: "⌘S", group: "File", action: noop },
 *             { id: "open", label: "Open…", shortcut: "⌘O", group: "File", action: noop },
 *             { id: "find", label: "Find in files", shortcut: "⌘⇧F", group: "Navigate", action: noop },
 *         ],
 *         { placeholder: "Type a command…" },
 *     );
 * });
 * ```
 */
function createCommandPalette(
    commands: CommandInput[],
    style?: CommandPaletteStyle,
): ExprType<UIComponentType> {
    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const hasStyle = !!style && (
        sizeValue !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.inputBackground !== undefined ||
        style.inputColor !== undefined ||
        style.itemColor !== undefined ||
        style.selectedBackground !== undefined ||
        style.selectedColor !== undefined ||
        style.groupLabelColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        size: sizeValue ? some(sizeValue) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        inputBackground: style!.inputBackground !== undefined ? some(style!.inputBackground) : none,
        inputColor: style!.inputColor !== undefined ? some(style!.inputColor) : none,
        itemColor: style!.itemColor !== undefined ? some(style!.itemColor) : none,
        selectedBackground: style!.selectedBackground !== undefined ? some(style!.selectedBackground) : none,
        selectedColor: style!.selectedColor !== undefined ? some(style!.selectedColor) : none,
        groupLabelColor: style!.groupLabelColor !== undefined ? some(style!.groupLabelColor) : none,
    }, CommandPaletteStyleType) : undefined;

    const commandsExpr = East.value(
        commands.map(c => East.value({
            id: c.id,
            label: c.label,
            icon: c.icon !== undefined ? some(c.icon) : none,
            shortcut: c.shortcut !== undefined ? some(c.shortcut) : none,
            group: c.group !== undefined ? some(c.group) : none,
            keywords: c.keywords !== undefined ? some(c.keywords) : none,
            action: c.action,
        }, CommandType)),
    );

    return East.value(variant("CommandPalette", {
        commands: commandsExpr,
        placeholder: style?.placeholder !== undefined ? some(style.placeholder) : none,
        triggerKey: style?.triggerKey !== undefined ? some(style.triggerKey) : none,
        open: style?.open !== undefined ? some(style.open) : none,
        onOpenChange: style?.onOpenChange ? some(style.onOpenChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface CommandPaletteNamespace {
    Root: typeof createCommandPalette;
    Types: {
        CommandPalette: typeof CommandPaletteType;
        Style: typeof CommandPaletteStyleType;
        Command: typeof CommandType;
    };
}

/**
 * `CommandPalette` namespace — ⌘K-style command launcher.
 *
 * @remarks
 * Use `CommandPalette.Root(commands, options?)`. Access IR types via
 * `CommandPalette.Types.CommandPalette`, `CommandPalette.Types.Style`,
 * and `CommandPalette.Types.Command`.
 */
export const CommandPalette: CommandPaletteNamespace = {
    /**
     * Creates a `CommandPalette`. See {@link createCommandPalette}.
     */
    Root: createCommandPalette,
    Types: {
        /**
         * East StructType for the `CommandPalette` value.
         *
         * @property commands - Array of command items
         * @property placeholder - Optional input placeholder
         * @property triggerKey - Optional keyboard chord (default `"mod+k"`)
         * @property open - Optional controlled open state
         * @property onOpenChange - Callback fired when the palette opens/closes
         * @property style - Optional visual style sub-struct
         */
        CommandPalette: CommandPaletteType,
        /**
         * East StructType holding visual fields for `CommandPalette`.
         *
         * @property size - Dialog size
         * @property background - Explicit dialog background colour
         * @property borderColor - Explicit dialog border colour
         * @property inputBackground - Search-input background colour
         * @property inputColor - Search-input text colour
         * @property itemColor - Item text colour
         * @property selectedBackground - Highlighted-item background colour
         * @property selectedColor - Highlighted-item text colour
         * @property groupLabelColor - Group-label text colour
         */
        Style: CommandPaletteStyleType,
        /**
         * East StructType for an individual command.
         *
         * @property id - Stable identifier
         * @property label - Display label
         * @property icon - Optional leading icon
         * @property shortcut - Optional keyboard shortcut hint
         * @property group - Optional group label
         * @property keywords - Optional extra search targets
         * @property action - Callback fired when the command is selected
         */
        Command: CommandType,
    },
};
