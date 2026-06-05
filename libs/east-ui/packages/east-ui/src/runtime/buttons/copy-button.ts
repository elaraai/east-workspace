/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Button `<CopyButton>` tag — copies its child string to the clipboard. Maps to `CopyButton.Root`. */

import { CopyButton as CopyButtonFactory, type CopyButtonOptions } from "../../buttons/copy-button/index.js";
import { content, type JsxTag } from "../combinators.js";

/** `<CopyButton label="Copy">{token}</CopyButton>` — the child is the copied string. Maps to `CopyButton.Root`. */
export const CopyButton: JsxTag<CopyButtonOptions & { children: Parameters<typeof CopyButtonFactory.Root>[0] }> & { Types: typeof CopyButtonFactory.Types } =
    Object.assign(content(CopyButtonFactory.Root), { Types: CopyButtonFactory.Types });
