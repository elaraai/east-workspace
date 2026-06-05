/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { CopyButton as CopyButtonFactory, type CopyButtonOptions } from "../../buttons/copy-button/index.js";
import { content, type JsxTag } from "../combinators.js";

/**
 * Copies a string to the clipboard and flashes a confirmation — for API
 * keys, share links, tokens, or any value the user needs to grab. The
 * child is the string that gets copied (not a visible label); set `label`
 * for a labelled button or omit it for an icon-only affordance. Every
 * option is a flat prop ({@link CopyButtonOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { CopyButton, UIComponentType } from "@elaraai/east-ui";
 *
 * const copy = East.function([], UIComponentType, _$ => (
 *     <CopyButton label="Copy link" timeout="1500" variant="outline" colorPalette="blue">
 *         https://elara.ai/share/abc123
 *     </CopyButton>
 * ));
 * ```
 *
 * @remarks
 * `timeout` controls how long the "Copied!" state lingers, and
 * `successColor` tints it. Carries `CopyButton.Types`. Desugars to
 * `CopyButton.Root(value, options)`.
 */
export const CopyButton: JsxTag<CopyButtonOptions & { children: Parameters<typeof CopyButtonFactory.Root>[0] }> & { Types: typeof CopyButtonFactory.Types } =
    Object.assign(content(CopyButtonFactory.Root), { Types: CopyButtonFactory.Types });
