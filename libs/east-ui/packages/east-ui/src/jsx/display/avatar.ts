/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Avatar>` tag — options-only avatar (no children). Maps to `Avatar.Root`. */

import { Avatar as AvatarFactory, type AvatarStyle } from "../../display/avatar/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Avatar src={…} name={…} size="md" />` — avatar (no children). Maps to `Avatar.Root`. */
export const Avatar: JsxTag<AvatarStyle> = optionsTag(AvatarFactory.Root);
