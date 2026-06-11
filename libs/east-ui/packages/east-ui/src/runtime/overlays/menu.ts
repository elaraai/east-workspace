/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Menu>` tag — see the export's JSDoc. */

import { Menu as MenuFactory, type MenuOptions } from "../../overlays/menu/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Item + group label + separator builders carried alongside the `<Menu>` tag. */
type MenuBuilders = {
    Item: typeof MenuFactory.Item;
    GroupLabel: typeof MenuFactory.GroupLabel;
    Separator: typeof MenuFactory.Separator;
    Types: typeof MenuFactory.Types;
};

/**
 * Menu — a dropdown of discrete actions opened from a `trigger`. Reach for it as
 * the canonical row-end "kebab" overflow or an account menu: a short list of
 * commands, with optional disabled entries and `Menu.Separator` dividers between
 * groups. The `items` array and `placement` are flat props ({@link MenuOptions});
 * unlike {@link Popover} the body is a fixed list of items, not arbitrary UI.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { IconButton, Menu, UIComponentType } from "@elaraai/east-ui";
 *
 * const overflow = East.function([], UIComponentType, _$ => (
 *     <Menu
 *         trigger={<IconButton prefix="fas" name="ellipsis" label="More" variant="ghost" size="sm" />}
 *         items={[
 *             Menu.GroupLabel("Actions"),
 *             Menu.Item("edit", "Edit · rename", { icon: "pen" }),
 *             Menu.Item("duplicate", "Duplicate", { icon: "copy", command: "⌘D" }),
 *             Menu.Separator(),
 *             Menu.Item("archive", "Archive", { icon: "trash", destructive: true }),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Menu.Types` and the `Menu.Item(value, label, options?)` /
 * `Menu.GroupLabel(label)` / `Menu.Separator()` item builders for the
 * `items` array. Desugars to `Menu.Root(options)`.
 */
export const Menu: JsxTag<MenuOptions> & MenuBuilders = Object.assign(optionsTag(MenuFactory.Root), {
    Item: MenuFactory.Item,
    GroupLabel: MenuFactory.GroupLabel,
    Separator: MenuFactory.Separator,
    Types: MenuFactory.Types,
});
