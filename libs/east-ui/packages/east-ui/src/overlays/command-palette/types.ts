/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    ArrayType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import { IconType } from "../../display/icon/types.js";

// ============================================================================
// Command Item
// ============================================================================

/**
 * East StructType for a single command in a CommandPalette.
 *
 * @remarks
 * `keywords` are extra search targets used by the renderer's fuzzy
 * matcher (cmdk) — useful when the user might search by synonym
 * ("logs" matching a "Show audit trail" command).
 *
 * @property id - Stable identifier for the command (used in `recents` lookups)
 * @property label - Display label
 * @property icon - Optional leading icon
 * @property shortcut - Optional keyboard shortcut hint (e.g. `"⌘S"`)
 * @property group - Optional group label (commands sharing a `group` render under a heading)
 * @property keywords - Optional extra search targets
 * @property action - Callback invoked when the command is selected
 */
export const CommandType = StructType({
    id: StringType,
    label: StringType,
    icon: OptionType(IconType),
    shortcut: OptionType(StringType),
    group: OptionType(StringType),
    keywords: OptionType(ArrayType(StringType)),
    action: FunctionType([], NullType),
});

/**
 * Type alias for the Command struct.
 */
export type CommandType = typeof CommandType;

/**
 * TypeScript-side input shape for declaring a command.
 *
 * @property id - Stable identifier
 * @property label - Display label
 * @property icon - Optional leading icon
 * @property shortcut - Optional keyboard shortcut hint
 * @property group - Optional group label
 * @property keywords - Optional extra search targets
 * @property action - Callback invoked when the command is selected
 */
export interface CommandInput {
    /** Stable identifier for the command. */
    id: SubtypeExprOrValue<StringType>;
    /** Display label. */
    label: SubtypeExprOrValue<StringType>;
    /** Optional leading icon. */
    icon?: SubtypeExprOrValue<IconType>;
    /** Optional keyboard shortcut hint (e.g. `"⌘S"`). */
    shortcut?: SubtypeExprOrValue<StringType>;
    /** Optional group label. Commands sharing a group render under a heading. */
    group?: SubtypeExprOrValue<StringType>;
    /** Optional extra search targets. */
    keywords?: SubtypeExprOrValue<ArrayType<StringType>> | string[];
    /** Callback invoked when the command is selected. */
    action: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

// ============================================================================
// CommandPalette Style
// ============================================================================

/**
 * East StructType holding visual fields for `CommandPalette`.
 *
 * @property size - Dialog size (`xs` / `sm` / `md` / `lg`)
 * @property background - Explicit dialog background colour
 * @property borderColor - Explicit dialog border colour
 * @property inputBackground - Search-input background colour
 * @property inputColor - Search-input text colour
 * @property itemColor - Item text colour
 * @property selectedBackground - Highlighted-item background colour
 * @property selectedColor - Highlighted-item text colour
 * @property groupLabelColor - Group-label text colour
 */
export const CommandPaletteStyleType = StructType({
    size: OptionType(SizeType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    inputBackground: OptionType(StringType),
    inputColor: OptionType(StringType),
    itemColor: OptionType(StringType),
    selectedBackground: OptionType(StringType),
    selectedColor: OptionType(StringType),
    groupLabelColor: OptionType(StringType),
});

/**
 * Type alias for the CommandPalette style struct.
 */
export type CommandPaletteStyleType = typeof CommandPaletteStyleType;

/**
 * TypeScript interface for `CommandPalette` style options.
 */
export interface CommandPaletteStyle {
    /** Search-input placeholder text. */
    placeholder?: SubtypeExprOrValue<StringType>;
    /** Optional global trigger key (e.g. `mod+k`). */
    triggerKey?: SubtypeExprOrValue<StringType>;
    /** Controlled open state. */
    open?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired when the open state changes. */
    onOpenChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
    /** Dialog size. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit dialog background colour. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit dialog border colour. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Search-input background colour. */
    inputBackground?: SubtypeExprOrValue<StringType>;
    /** Search-input text colour. */
    inputColor?: SubtypeExprOrValue<StringType>;
    /** Item text colour. */
    itemColor?: SubtypeExprOrValue<StringType>;
    /** Highlighted-item background colour. */
    selectedBackground?: SubtypeExprOrValue<StringType>;
    /** Highlighted-item text colour. */
    selectedColor?: SubtypeExprOrValue<StringType>;
    /** Group-label text colour. */
    groupLabelColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// CommandPalette Type
// ============================================================================

/**
 * East StructType for `CommandPalette` — ⌘K-style command launcher.
 *
 * @remarks
 * `triggerKey` defaults to `"mod+k"` (⌘K on macOS, Ctrl+K elsewhere)
 * — apps can override with any combo string. `open` is controlled
 * state — apps that want to open the palette programmatically pass
 * a `Reactive.Root` boolean and the matching `onOpenChange`. With
 * `open` unset, the renderer manages local open/close internally.
 *
 * @property commands - The list of commands to surface
 * @property placeholder - Optional input placeholder (default `"Type a command..."`)
 * @property triggerKey - Optional keyboard chord (default `"mod+k"`)
 * @property open - Optional controlled open state
 * @property onOpenChange - Callback fired when the palette opens/closes
 * @property style - Optional visual style sub-struct
 */
export const CommandPaletteType = StructType({
    commands: ArrayType(CommandType),
    placeholder: OptionType(StringType),
    triggerKey: OptionType(StringType),
    open: OptionType(BooleanType),
    onOpenChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(CommandPaletteStyleType),
});

/**
 * Type alias for the CommandPalette struct.
 */
export type CommandPaletteType = typeof CommandPaletteType;
