/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<EditableChip>` tag — see the export's JSDoc.
 */

import { EditableChip as EditableChipFactory } from "../../display/editable-chip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * EditableChip — a chip that reads as an adjustable assumption or scenario
 * setting, carrying a pencil-style trigger to signal it is editable. Wire
 * `onClick` to open an editor or cycle a value; set `disabled` to lock it. The
 * label content is the child; colour slots and the trigger-icon colour are flat
 * props ({@link EditableChipOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, NullType } from "@elaraai/east";
 * import { EditableChip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const assumption = East.function([], UIComponentType, $ => {
 *     const onClick = $.const(East.function([], NullType, _ => {}));
 *     return <EditableChip onClick={onClick}><Text>Scenario: Q4 forecast</Text></EditableChip>;
 * });
 * ```
 *
 * @remarks
 * Carries `EditableChip.Types` — the East data type and the style struct.
 * Desugars to `EditableChip.Root(label, options)`.
 */
export const EditableChip: JsxTag<ContentProps<typeof EditableChipFactory.Root>> & { Types: typeof EditableChipFactory.Types } =
    Object.assign(content(EditableChipFactory.Root), { Types: EditableChipFactory.Types });
