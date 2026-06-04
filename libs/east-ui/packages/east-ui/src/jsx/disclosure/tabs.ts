/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<Tabs>` tag — tabbed content panels. Maps to `Tabs.Root`. */

import { Tabs as TabsFactory } from "../../disclosure/tabs/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Tabs items={[Tabs.Item(…)]} defaultValue="overview" variant="line" />` — tabbed panels. Maps to `Tabs.Root`. */
export const Tabs: JsxTag<ValueProps<typeof TabsFactory.Root, "items">> =
    leaf(TabsFactory.Root, "items");
