/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<Accordion>` tag — collapsible panels. Maps to `Accordion.Root`. */

import { Accordion as AccordionFactory } from "../../disclosure/accordion/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Accordion items={[Accordion.Item(…)]} multiple collapsible variant="enclosed" />` — collapsible panels. Maps to `Accordion.Root`. */
export const Accordion: JsxTag<ValueProps<typeof AccordionFactory.Root, "items">> =
    leaf(AccordionFactory.Root, "items");
