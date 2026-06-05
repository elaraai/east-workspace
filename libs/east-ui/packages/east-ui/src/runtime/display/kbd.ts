/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Kbd>` tag — see the export's JSDoc.
 */

import { Kbd as KbdFactory } from "../../display/kbd/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Kbd — renders a keyboard key or chord as styled key-cap pills, for
 * documenting shortcuts (⌘K, Ctrl+Shift+P). The required `keys` array is the
 * prop, one entry per cap, joined with separators; `variant`, `colorPalette`,
 * and `size` tune the look ({@link KbdStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Kbd, UIComponentType } from "@elaraai/east-ui";
 *
 * const shortcut = East.function([], UIComponentType, _$ => (
 *     <Kbd keys={["⌘", "K"]} />
 * ));
 * ```
 *
 * @remarks
 * Carries `Kbd.Types` — the East data type and the style struct. Desugars to
 * `Kbd.Root(keys, options)`.
 */
export const Kbd: JsxTag<ValueProps<typeof KbdFactory.Root, "keys">> & { Types: typeof KbdFactory.Types } =
    Object.assign(leaf(KbdFactory.Root, "keys"), { Types: KbdFactory.Types });
