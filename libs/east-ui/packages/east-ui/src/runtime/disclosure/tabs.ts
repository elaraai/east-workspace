/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure `<Tabs>` tag — tabbed content panels. Maps to `Tabs.Root`.
 *
 * The `Item` tab builder is attached to the tag, so a single `Tabs` import
 * gives both `<Tabs …/>` and `Tabs.Item(…)` — no separate factory import.
 */

import { Tabs as TabsFactory } from "../../disclosure/tabs/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Tab builder surfaced on the `<Tabs>` tag (mirrors the `Tabs` factory namespace). */
type TabsBuilders = {
    Item: typeof TabsFactory.Item;
};

/** `<Tabs items={[Tabs.Item(…)]} defaultValue="overview" variant="line" />` — tabbed panels. Maps to `Tabs.Root`. */
export const Tabs: JsxTag<ValueProps<typeof TabsFactory.Root, "items">> & TabsBuilders =
    Object.assign(leaf(TabsFactory.Root, "items"), {
        Item: TabsFactory.Item,
    });
