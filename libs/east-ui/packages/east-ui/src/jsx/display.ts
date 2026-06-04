/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Display JSX tags — `<Badge>`, `<Tag>`. Each wraps the matching display
 * factory; the displayed value is the tag's text children and the option/style
 * props (variant, colorPalette, size, …) sit flat.
 */

import { Badge as BadgeFactory, Tag as TagFactory } from "../display/index.js";
import { textLeaf, type TextProps, type JsxTag } from "./combinators.js";

/** `<Badge>` — small status/label pill. Maps to `Badge.Root`. */
export const Badge: JsxTag<TextProps<typeof BadgeFactory.Root>> = textLeaf(BadgeFactory.Root);

/** `<Tag>` — keyword/chip with optional close affordance. Maps to `Tag.Root`. */
export const Tag: JsxTag<TextProps<typeof TagFactory.Root>> = textLeaf(TagFactory.Root);
