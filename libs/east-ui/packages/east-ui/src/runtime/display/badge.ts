/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Badge>` tag — small status/label pill. Maps to `Badge.Root`. */

import { Badge as BadgeFactory } from "../../display/badge/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Badge>` — small status/label pill. Maps to `Badge.Root`. */
export const Badge: JsxTag<ContentProps<typeof BadgeFactory.Root>> & { Types: typeof BadgeFactory.Types } =
    Object.assign(content(BadgeFactory.Root), { Types: BadgeFactory.Types });
