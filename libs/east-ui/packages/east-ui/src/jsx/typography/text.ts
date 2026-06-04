/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Text>` tag — body text. Maps to `Text.Root`. */

import { Text as TextFactory } from "../../typography/text/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Text>` — body text. Maps to `Text.Root`. */
export const Text: JsxTag<ContentProps<typeof TextFactory.Root>> = content(TextFactory.Root);
