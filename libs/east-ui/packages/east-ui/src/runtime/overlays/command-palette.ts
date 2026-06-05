/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<CommandPalette>` tag — see the export's JSDoc. */

import { CommandPalette as CommandPaletteFactory } from "../../overlays/command-palette/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * CommandPalette — a ⌘K-style searchable launcher overlaying a fuzzy-filtered
 * list of commands. Use it as a fast keyboard-first way to jump anywhere or run
 * any action in an application. Each command carries a `label`, an optional
 * `shortcut`, a `group` heading, extra `keywords` for synonym search, and an
 * `action` to run on select; the array is the `commands` prop. The opening
 * chord (`triggerKey`), placeholder text, controlled `open` / `onOpenChange`,
 * and colour overrides are flat props ({@link CommandPaletteStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType } from "@elaraai/east";
 * import { CommandPalette, UIComponentType } from "@elaraai/east-ui";
 *
 * const launcher = East.function([], UIComponentType, $ => {
 *     const run = $.const(East.function([], NullType, (_$) => { }));
 *     return (
 *         <CommandPalette placeholder="Search commands…" commands={[
 *             { id: "go.home", label: "Go to Home", shortcut: "G H", group: "Navigate", action: run },
 *             { id: "act.run", label: "Run scenario", shortcut: "⌘↵", group: "Actions", action: run },
 *             { id: "set.theme", label: "Toggle theme", group: "Settings", action: run },
 *         ]} />
 *     );
 * });
 * ```
 *
 * @remarks
 * Carries `CommandPalette.Types` — the East data type, the style struct, and
 * `CommandPalette.Types.Command` (the per-command struct). The `commands` array
 * is the value prop. For a controlled ⌘K open, pair `open` / `onOpenChange`
 * with a `Hotkey` inside `<Reactive>`. Desugars to
 * `CommandPalette.Root(commands, options)`.
 */
export const CommandPalette: JsxTag<ValueProps<typeof CommandPaletteFactory.Root, "commands">> & { Types: typeof CommandPaletteFactory.Types } =
    Object.assign(leaf(CommandPaletteFactory.Root, "commands"), { Types: CommandPaletteFactory.Types });
