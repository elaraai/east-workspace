/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<EditableChip>` tag — inline-editable chip. Maps to `EditableChip.Root`. */

import { EditableChip as EditableChipFactory } from "../../display/editable-chip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<EditableChip>` — chip whose label is its single child. Maps to `EditableChip.Root`. */
export const EditableChip: JsxTag<ContentProps<typeof EditableChipFactory.Root>> & { Types: typeof EditableChipFactory.Types } =
    Object.assign(content(EditableChipFactory.Root), { Types: EditableChipFactory.Types });
