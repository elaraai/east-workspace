/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Badge>` tag — small status/label pill. Maps to `Badge.Root`. */

import { Badge as BadgeFactory } from "../../display/badge/index.js";
import { textLeaf, type TextProps, type JsxTag } from "../combinators.js";

/** `<Badge>` — small status/label pill. Maps to `Badge.Root`. */
export const Badge: JsxTag<TextProps<typeof BadgeFactory.Root>> = textLeaf(BadgeFactory.Root);
