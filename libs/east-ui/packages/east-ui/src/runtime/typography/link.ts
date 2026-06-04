/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Link href={…}>` tag — hyperlink; the link text is its child. Maps to `Link.Root`. */

import { Link as LinkFactory } from "../../typography/link/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Link href={…}>` — hyperlink (required `href`); the link text is its child. Maps to `Link.Root`. */
export const Link: JsxTag<ContentProps<typeof LinkFactory.Root>> = content(LinkFactory.Root);
