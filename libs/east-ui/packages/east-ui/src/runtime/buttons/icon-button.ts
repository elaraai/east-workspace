/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Button `<IconButton>` tag — icon-only button (no children). Maps to `IconButton.Root`. */

import { IconButton as IconButtonFactory, type IconButtonOptions } from "../../buttons/icon-button/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<IconButton prefix="fas" name="trash" label="Delete" onClick={f} variant="ghost" />` — icon-only button. Maps to `IconButton.Root`. */
export const IconButton: JsxTag<IconButtonOptions> & { Types: typeof IconButtonFactory.Types } =
    Object.assign(optionsTag(IconButtonFactory.Root), { Types: IconButtonFactory.Types });
