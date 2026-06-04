/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Menu>` tag — dropdown menu. Maps to `Menu.Root`. */

import { Menu as MenuFactory, type MenuOptions } from "../../overlays/menu/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Menu trigger={Button.Root("Actions")} items={[Menu.Item(…)]} placement="bottom-start" />` — dropdown menu. Maps to `Menu.Root`. */
export const Menu: JsxTag<MenuOptions> = optionsTag(MenuFactory.Root);
