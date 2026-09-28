/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's names for the shared editing contract's draft entries
 * (`contracts/editing.ts`, #879) — groups carrying their rows, loose rows
 * beside them — and for the `onPatch` event. Each is the `Editing` namespace's
 * own value: `Sheet.Types.Entry` is `Editing.Types.Entry`.
 *
 * @packageDocumentation
 */
export {
    type EditingChildrenField as SheetChildrenField,
    type EditingChildOf as SheetChildOf,
    type EditingDraftGroupOf as SheetDraftGroupOf,
    type EditingDraftEntryOf as SheetDraftEntryOf,
    EditingDraftGroupTypeFor as SheetDraftGroupTypeFor,
    EditingEntryTypeFor as SheetEntryTypeFor,
    EditingDraftEntryTypeFor as SheetDraftEntryTypeFor,
    EditingPatchEventTypeFor as SheetPatchEventTypeFor,
    EditingDraftChangeTypeFor as SheetDraftChangeTypeFor,
} from "../../contracts/editing.js";
