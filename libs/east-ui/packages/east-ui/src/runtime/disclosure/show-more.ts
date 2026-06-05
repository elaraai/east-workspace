/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Disclosure `<Disclosure>` tag — truncated "show more" text. Text is the children. Maps to `Disclosure.Root`. */

import { Disclosure as DisclosureFactory } from "../../disclosure/show-more/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Disclosure lines={3n}>…long text…</Disclosure>` — truncated text with show-more toggle (text is children). Maps to `Disclosure.Root`. */
export const Disclosure: JsxTag<ContentProps<typeof DisclosureFactory.Root>> & { Types: typeof DisclosureFactory.Types } =
    Object.assign(content(DisclosureFactory.Root), { Types: DisclosureFactory.Types });
