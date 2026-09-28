/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Closed transport for typed Sheet transaction callbacks. @packageDocumentation */
import { ArrayType, BlobType, FunctionType, OptionType, StringType, StructType } from "@elaraai/east";
import { EditingSessionFields } from "../../contracts/editing.js";
import { SheetNewRowType, SheetNewGroupType, SheetReadinessType } from "./transactions.js";
import { SheetEditsType } from "./edits.js";

export {
    EditingWireApplyType as SheetWireApplyType,
    EditingApplyModeType as SheetApplyModeType,
} from "../../contracts/editing.js";

/** A constructor's exact field draft and its visible projection. @internal */
export const SheetSeedType = StructType({ draft: BlobType, row: BlobType });

/**
 * One sheet's editing declaration: the shared session's fields
 * (`EditingSessionFields`, #879) and the sheet's own — its structural edits,
 * its row and group constructors, its readiness checks, its driver column and
 * the draft decoder. Blobs transport values at the exact schemas named; no
 * hidden domain field is discarded. `readyRow` takes one readiness batch
 * (`SheetReadyBatchType`, #882) and returns each check's result in the
 * batch's order.
 *
 * @internal
 */
export const SheetEditingType = StructType({
    ...EditingSessionFields,
    edits: SheetEditsType,
    newRow: OptionType(FunctionType([SheetNewRowType], SheetSeedType)),
    newGroup: OptionType(FunctionType([SheetNewGroupType], SheetSeedType)),
    readyRow: OptionType(FunctionType([BlobType], ArrayType(SheetReadinessType))),
    readyGroup: OptionType(FunctionType([BlobType], SheetReadinessType)),
    driverColumn: OptionType(StringType),
    decode: FunctionType([BlobType, OptionType(BlobType), OptionType(BlobType)], BlobType),
});
