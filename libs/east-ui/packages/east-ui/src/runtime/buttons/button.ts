/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Button>` tag — see the export's JSDoc.
 */

import {
    Button as ButtonFactory,
    type ButtonOptions,
    type ButtonLabelInput,
} from "../../buttons/button/index.js";
import { content, type JsxTag } from "../combinators.js";

/**
 * Action button — triggers a behaviour on click. Supports rich labels,
 * leading/trailing icons, a distinct loading state, colour escape hatches, and
 * five visual variants (solid / subtle / outline / ghost / plain). The label is
 * the child; every option is a flat prop ({@link ButtonOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const save = East.function([], UIComponentType, _$ => (
 *     <Button variant="solid" colorPalette="blue" onClick={onSave}>Save Changes</Button>
 * ));
 * ```
 *
 * @remarks
 * Carries `Button.Types` — the East data type, the style struct, and the
 * variant enum. Desugars to `Button.Root(label, options)`.
 */
export const Button: JsxTag<ButtonOptions & { children: ButtonLabelInput }> & { Types: typeof ButtonFactory.Types } =
    Object.assign(content(ButtonFactory.Root), { Types: ButtonFactory.Types });
