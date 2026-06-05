/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typography `<Note>` tag — inline callout. Body is the children. Maps to `Note.Root`. */

import { Note as NoteFactory } from "../../typography/note/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/** `<Note tone="info">Heads up…</Note>` — inline callout (body is children). Maps to `Note.Root`. */
export const Note: JsxTag<ContentProps<typeof NoteFactory.Root>> & { Types: typeof NoteFactory.Types } =
    Object.assign(content(NoteFactory.Root), { Types: NoteFactory.Types });
