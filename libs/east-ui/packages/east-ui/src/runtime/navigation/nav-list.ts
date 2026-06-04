/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<NavList>` tag — sectioned navigation list. Maps to `NavList.Root`. */

import { NavList as NavListFactory } from "../../navigation/nav-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<NavList sections={[NavList.Section(…)]} />` — sectioned nav list. Maps to `NavList.Root`. */
export const NavList: JsxTag<ValueProps<typeof NavListFactory.Root, "sections">> =
    leaf(NavListFactory.Root, "sections");
