/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Form `<Textarea value={…}>` tag — multi-line text entry. Maps to `Textarea.Root`. */

import { Textarea as TextareaFactory } from "../../forms/textarea/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Textarea value={…}>` — multi-line text input. Maps to `Textarea.Root`. */
export const Textarea: JsxTag<ValueProps<typeof TextareaFactory.Root, "value">> & { Types: typeof TextareaFactory.Types } =
    Object.assign(leaf(TextareaFactory.Root, "value"), { Types: TextareaFactory.Types });
