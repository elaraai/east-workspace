/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's names for the shared editing contract (`contracts/editing.ts`,
 * #879) — each one the `Editing` namespace's own value (`Sheet.apply` is
 * `Editing.apply`, `Sheet.Types.ChangeSet` is `Editing.Types.ChangeSet`) — and
 * the transaction types only a sheet has: a new row's destination among a
 * group's children, and the `newRow` / `newGroup` contexts.
 *
 * @packageDocumentation
 */
import { IntegerType, StringType, StructType, VariantType } from "@elaraai/east";
import { EditingPlacementType } from "../../contracts/editing.js";

export {
    EditingPositionType as SheetPositionType,
    EditingPlacementType as SheetEntryPlacementType,
    EditingFieldIssueType as SheetFieldIssueType,
    EditingReadinessType as SheetReadinessType,
    EditingIssueType as SheetIssueType,
    EditingBatchReadinessType as SheetBatchReadinessType,
    EditingOriginType as SheetOriginType,
    EditingApplyResultType as SheetApplyResultType,
    EditingDraftFieldType as SheetDraftFieldType,
    EditingDraftTypeFor as SheetDraftTypeFor,
    EditingBaseTypeFor as SheetBaseTypeFor,
    EditingChangeTypeFor as SheetChangeTypeFor,
    EditingChangeSetTypeFor as SheetChangeSetTypeFor,
    EditingAppliedTypeFor as SheetAppliedTypeFor,
    applyEditing as applySheet,
    type EditingDraftOf as SheetDraftOf,
} from "../../contracts/editing.js";

/**
 * A new row's destination: a top-level entry's placement, or a position among
 * a group's children.
 *
 * @property entry - A top-level entry, at its placement
 * @property child - A child row of the group with this id, at this index
 */
export const SheetRowDestinationType = VariantType({
    entry: EditingPlacementType,
    child: StructType({ group: StringType, index: IntegerType }),
});

/**
 * What a `newRow` constructor is told.
 *
 * @property destination - Where the new row goes
 */
export const SheetNewRowType = StructType({ destination: SheetRowDestinationType });

/**
 * What a `newGroup` constructor is told.
 *
 * @property place - Where the new group goes
 */
export const SheetNewGroupType = StructType({ place: EditingPlacementType });
