/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure `<Accordion>` tag — collapsible panels. Maps to `Accordion.Root`.
 *
 * The `Item` panel builder is attached to the tag, so a single `Accordion`
 * import gives both `<Accordion …/>` and `Accordion.Item(…)` — no separate
 * factory import.
 */

import { Accordion as AccordionFactory } from "../../disclosure/accordion/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** Panel builder surfaced on the `<Accordion>` tag (mirrors the `Accordion` factory namespace). */
type AccordionBuilders = {
    Item: typeof AccordionFactory.Item;
};

/** `<Accordion items={[Accordion.Item(…)]} multiple collapsible variant="enclosed" />` — collapsible panels. Maps to `Accordion.Root`. */
export const Accordion: JsxTag<ValueProps<typeof AccordionFactory.Root, "items">> & AccordionBuilders =
    Object.assign(leaf(AccordionFactory.Root, "items"), {
        Item: AccordionFactory.Item,
    });
