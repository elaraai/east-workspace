/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<Collapsible>` tag — single open/close region. Body is the children. Maps to `Collapsible.Root`. */

import { Collapsible as CollapsibleFactory } from "../../disclosure/collapsible/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Collapsible trigger="Why?" defaultOpen>…content…</Collapsible>` — open/close region (content is children). Maps to `Collapsible.Root`. */
export const Collapsible: JsxTag<ContentProps<typeof CollapsibleFactory.Root>> =
    content(CollapsibleFactory.Root);
