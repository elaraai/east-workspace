/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<RadioCardGroup>` tag — single-select card list. Maps to `RadioCardGroup.Root`. */

import { RadioCardGroup as RadioCardGroupFactory, type RadioCardGroupStyle } from "../../forms/radio-card-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<RadioCardGroup value={…} items={[…]} onChange={…} />` — single-select card list (label + description per card). Maps to `RadioCardGroup.Root`. */
export const RadioCardGroup: JsxTag<RadioCardGroupStyle> = optionsTag(RadioCardGroupFactory.Root);
