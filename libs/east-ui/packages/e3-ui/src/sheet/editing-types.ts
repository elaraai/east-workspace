/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Closed transport for typed Sheet transaction callbacks. @packageDocumentation */
import { ArrayType, BlobType, FunctionType, OptionType, StringType, StructType } from "@elaraai/east";
import { EditingSessionFields } from "@elaraai/east-ui/internal";
import { SheetNewRowType, SheetNewGroupType, SheetReadinessType } from "./transactions.js";
import { SheetEditsType } from "./edits.js";

export {
    EditingWireApplyType as SheetWireApplyType,
    EditingApplyModeType as SheetApplyModeType,
} from "@elaraai/east-ui/internal";

/** A constructor's exact field draft and its visible projection. @internal */
export const SheetSeedType = StructType({ draft: BlobType, row: BlobType });

/**
 * A field a new entry needs that no person can set in the sheet (#1536):
 * required — not an `Option` — and written by no column a person edits, nor
 * by the inspector's form, so only the app's `newRow` or `newGroup` gives it.
 *
 * @property field - The field's name
 * @property label - What the sheet calls it, as the inspector's form does: the hint's label, else its column's header, else its name spelled out
 * @internal
 */
export const SheetUnsettableType = StructType({ field: StringType, label: StringType });

/**
 * One sheet's editing declaration: the shared session's fields
 * (`EditingSessionFields`, #879) and the sheet's own — its structural edits,
 * its row and group constructors, the fields only they give, its readiness
 * checks, its driver column, the draft decoder and the row projection. Blobs
 * transport values at the exact schemas named; no hidden domain field is
 * discarded. `readyRow` takes one readiness batch (`SheetReadyBatchType`,
 * #882) and returns each check's result in the batch's order. `project`
 * (#1409) takes an entry as `entryType` bytes and its id, and answers the
 * wire row the source would show for it (`Sheet.Types.Row` bytes): what a
 * row the optimiser answers lands in the session as. `unsettable` (#1536)
 * names a new row's (a grouped sheet's line's, a loose row's) and a new
 * group's {@link SheetUnsettableType} fields, on a sheet that adds that kind
 * of entry — one that applies, is not read only and inserts it: a new entry
 * whose constructor leaves one empty is never drafted.
 *
 * @internal
 */
export const SheetEditingType = StructType({
    ...EditingSessionFields,
    edits: SheetEditsType,
    newRow: OptionType(FunctionType([SheetNewRowType], SheetSeedType)),
    newGroup: OptionType(FunctionType([SheetNewGroupType], SheetSeedType)),
    unsettable: StructType({ row: ArrayType(SheetUnsettableType), group: ArrayType(SheetUnsettableType) }),
    readyRow: OptionType(FunctionType([BlobType], ArrayType(SheetReadinessType))),
    readyGroup: OptionType(FunctionType([BlobType], SheetReadinessType)),
    driverColumn: OptionType(StringType),
    decode: FunctionType([BlobType, OptionType(BlobType), OptionType(BlobType)], BlobType),
    project: FunctionType([BlobType, StringType], BlobType),
});
