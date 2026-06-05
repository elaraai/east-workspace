/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link AccordionFactory | Accordion} — a stack of
 * collapsible panels, each with a header trigger and a body that expands and
 * collapses. Use it for FAQs, grouped settings, or any sectioned content where
 * the reader opens one part at a time.
 */

import { Accordion as AccordionFactory } from "../../disclosure/accordion/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Panel builder surfaced on the `<Accordion>` tag (mirrors the `Accordion` factory namespace). */
type AccordionBuilders = {
    Item: typeof AccordionFactory.Item;
    Types: typeof AccordionFactory.Types;
};

/**
 * Stack of collapsible panels — each header reveals its body on click. Allow
 * several panels open at once with `multiple`, let every panel close with
 * `collapsible`, and choose a visual treatment with `variant`. Panels are the
 * `items` prop, built with {@link AccordionFactory.Item | Accordion.Item};
 * remaining options follow `AccordionOptions`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Accordion, Box, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const faq = East.function([], UIComponentType, _$ => (
 *     <Accordion
 *         collapsible={true}
 *         items={[
 *             Accordion.Item("profile", "Profile Settings", [
 *                 <Box padding="4"><Text>Manage your profile and preferences.</Text></Box>,
 *             ]),
 *             Accordion.Item("security", "Security", [
 *                 <Box padding="4"><Text>Password and two-factor settings.</Text></Box>,
 *             ]),
 *         ]}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Accordion.Types` (the East data type, style struct, and variant
 * enum) and the {@link AccordionFactory.Item | Accordion.Item} panel builder —
 * one import gives both the tag and the item constructor. Desugars to
 * `Accordion.Root(items, options)`.
 */
export const Accordion: JsxTag<ValueProps<typeof AccordionFactory.Root, "items">> & AccordionBuilders =
    Object.assign(leaf(AccordionFactory.Root, "items"), {
        Item: AccordionFactory.Item,
        Types: AccordionFactory.Types,
    });
