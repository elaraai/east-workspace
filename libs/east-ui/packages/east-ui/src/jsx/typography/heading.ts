/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Heading>` tag — heading text. Maps to `Heading.Root`. */

import { Heading as HeadingFactory } from "../../typography/heading/index.js";
import { textLeaf, type TextProps, type JsxTag } from "../combinators.js";

/** `<Heading>` — heading text. Maps to `Heading.Root`. */
export const Heading: JsxTag<TextProps<typeof HeadingFactory.Root>> = textLeaf(HeadingFactory.Root);
