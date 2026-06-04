/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography JSX tags — `<Text>`, `<Heading>`. Each wraps the matching
 * typography factory; text children become the value, style props are flat.
 */

import { Text as TextFactory } from "../typography/text/index.js";
import { Heading as HeadingFactory } from "../typography/heading/index.js";
import { Code as CodeFactory } from "../typography/code/index.js";
import { Mark as MarkFactory } from "../typography/mark/index.js";
import { textLeaf, type TextProps, type JsxTag } from "./combinators.js";

/** `<Text>` — body text. Maps to `Text.Root`. */
export const Text: JsxTag<TextProps<typeof TextFactory.Root>> = textLeaf(TextFactory.Root);

/** `<Heading>` — heading text. Maps to `Heading.Root`. */
export const Heading: JsxTag<TextProps<typeof HeadingFactory.Root>> = textLeaf(HeadingFactory.Root);

/** `<Code>` — inline code text. Maps to `Code.Root`. */
export const Code: JsxTag<TextProps<typeof CodeFactory.Root>> = textLeaf(CodeFactory.Root);

/** `<Mark>` — highlighted text. Maps to `Mark.Root`. */
export const Mark: JsxTag<TextProps<typeof MarkFactory.Root>> = textLeaf(MarkFactory.Root);
