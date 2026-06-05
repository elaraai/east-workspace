/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Icon>` tag — Font Awesome icon (no children). Maps to `Icon.Root`. */

import { Icon as IconFactory, type IconStyle } from "../../display/icon/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Icon prefix="fas" name="check" size="lg" />` — icon (no children). Maps to `Icon.Root`. */
export const Icon: JsxTag<IconStyle> & { Types: typeof IconFactory.Types } =
    Object.assign(optionsTag(IconFactory.Root), { Types: IconFactory.Types });
