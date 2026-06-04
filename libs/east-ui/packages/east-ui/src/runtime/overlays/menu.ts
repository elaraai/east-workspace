/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Menu>` tag — dropdown menu. Maps to `Menu.Root`. */

import { Menu as MenuFactory, type MenuOptions } from "../../overlays/menu/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Item + separator builders carried alongside the `<Menu>` tag. */
type MenuBuilders = {
    Item: typeof MenuFactory.Item;
    Separator: typeof MenuFactory.Separator;
    Types: typeof MenuFactory.Types;
};

/**
 * `<Menu trigger={Button.Root("Actions")} items={[Menu.Item(…)]} placement="bottom-start" />`
 * — dropdown menu. Maps to `Menu.Root`. Build the `items` array with the carried
 * `Menu.Item` / `Menu.Separator` builders.
 */
export const Menu: JsxTag<MenuOptions> & MenuBuilders = Object.assign(optionsTag(MenuFactory.Root), {
    Item: MenuFactory.Item,
    Separator: MenuFactory.Separator,
    Types: MenuFactory.Types,
});
