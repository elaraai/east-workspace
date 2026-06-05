/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<RadioGroup>` tag — single-select radio list. Maps to `RadioGroup.Root`. */

import { RadioGroup as RadioGroupFactory, type RadioGroupStyle } from "../../forms/radio-group/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<RadioGroup value={…} items={[…]} onChange={…} />` — single-select radio list. Maps to `RadioGroup.Root`. */
export const RadioGroup: JsxTag<RadioGroupStyle> & { Types: typeof RadioGroupFactory.Types } =
    Object.assign(optionsTag(RadioGroupFactory.Root), { Types: RadioGroupFactory.Types });
