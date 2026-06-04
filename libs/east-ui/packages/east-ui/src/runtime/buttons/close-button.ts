/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Button `<CloseButton>` tag — options-only close button (no children). Maps to `CloseButton.Root`. */

import { CloseButton as CloseButtonFactory, type CloseButtonOptions } from "../../buttons/close-button/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<CloseButton onClick={f} variant="ghost" />` — close button (no children). Maps to `CloseButton.Root`. */
export const CloseButton: JsxTag<CloseButtonOptions> = optionsTag(CloseButtonFactory.Root);
