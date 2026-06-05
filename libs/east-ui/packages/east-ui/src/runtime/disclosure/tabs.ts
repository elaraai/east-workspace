/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link TabsFactory | Tabs} — tabbed content panels
 * where one trigger reveals its panel at a time. Use it to split a surface into
 * peer views (Overview / Features / Pricing, or Account / Security / Billing)
 * that share the same space and switch instantly.
 */

import { Tabs as TabsFactory } from "../../disclosure/tabs/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Tab builder surfaced on the `<Tabs>` tag (mirrors the `Tabs` factory namespace). */
type TabsBuilders = {
    Item: typeof TabsFactory.Item;
    Types: typeof TabsFactory.Types;
};

/**
 * Tabbed panels — one trigger shows its panel at a time. Set the starting tab
 * with `defaultValue` (or drive it from state with `value` + `onValueChange`),
 * pick an indicator style with `variant`, and stretch triggers to equal width
 * with `fitted`. Tabs are the `items` prop, built with
 * {@link TabsFactory.Item | Tabs.Item} (trigger is text or any rich node, and
 * each item carries its panel body). Remaining options follow `TabsOptions`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Tabs, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const panels = East.function([], UIComponentType, _$ => (
 *     <Tabs
 *         defaultValue="overview"
 *         variant="line"
 *         items={[
 *             Tabs.Item("overview", "Overview", [
 *                 <Box padding="4"><Text>The default content panel.</Text></Box>,
 *             ]),
 *             Tabs.Item("features", "Features", [
 *                 <Box padding="4"><Text>Explore our features here.</Text></Box>,
 *             ]),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Tabs.Types` (the East data type, style struct, and variant enum) and
 * the {@link TabsFactory.Item | Tabs.Item} tab builder — one import gives both
 * the tag and the item constructor. Desugars to `Tabs.Root(items, options)`.
 */
export const Tabs: JsxTag<ValueProps<typeof TabsFactory.Root, "items">> & TabsBuilders =
    Object.assign(leaf(TabsFactory.Root, "items"), {
        Item: TabsFactory.Item,
        Types: TabsFactory.Types,
    });
