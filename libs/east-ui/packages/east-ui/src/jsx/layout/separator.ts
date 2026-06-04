/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<Separator>` tag — divider line (no children). Maps to `Separator.Root`. */

import { Separator as SeparatorFactory, type SeparatorStyle } from "../../layout/separator/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Separator orientation="horizontal" />` — divider line. Maps to `Separator.Root`. */
export const Separator: JsxTag<SeparatorStyle> = optionsTag(SeparatorFactory.Root);
