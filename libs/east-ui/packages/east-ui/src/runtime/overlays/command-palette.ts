/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<CommandPalette>` tag — searchable command list. Maps to `CommandPalette.Root`. */

import { CommandPalette as CommandPaletteFactory } from "../../overlays/command-palette/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<CommandPalette commands={[CommandPalette.Command(…)]} placeholder="…" />` — searchable command list. Maps to `CommandPalette.Root`. */
export const CommandPalette: JsxTag<ValueProps<typeof CommandPaletteFactory.Root, "commands">> & { Types: typeof CommandPaletteFactory.Types } =
    Object.assign(leaf(CommandPaletteFactory.Root, "commands"), { Types: CommandPaletteFactory.Types });
