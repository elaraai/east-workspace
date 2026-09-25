/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Closed transport for typed Sheet transaction callbacks. @packageDocumentation */
import { ArrayType, AsyncFunctionType, BlobType, BooleanType, EastTypeType, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, VariantType } from "@elaraai/east";
import { SheetApplyResultType, SheetNewRowType, SheetNewGroupType, SheetReadinessType } from "./transactions.js";

import { SheetEditsType } from "./edits.js";

/** A synchronous or asynchronous authoritative source apply callback. @internal */
export const SheetWireApplyType = VariantType({
    sync: FunctionType([BlobType], SheetApplyResultType),
    async: AsyncFunctionType([BlobType], SheetApplyResultType),
});
/** A constructor's exact field draft and its visible projection. @internal */
export const SheetSeedType = StructType({ draft: BlobType, row: BlobType });
/** Submission policy; both arms use the same serial checked protocol. */
export const SheetApplyModeType = VariantType({ batch: NullType, auto: NullType });
/**
 * Codec and callbacks for one source-bound editing session. Blobs transport
 * values at the exact schemas below; no hidden domain field is discarded.
 * `readyRow` takes one readiness batch (`SheetReadyBatchType`, #882) and
 * returns each check's result in the batch's order.
 * @internal
 */
export const SheetEditingType = StructType({
    sourceId: StringType,
    edits: SheetEditsType,
    entryType: EastTypeType,
    idField: OptionType(StringType),
    draftType: EastTypeType,
    children: OptionType(StringType),
    keyed: BooleanType,
    snapshot: OptionType(BlobType),
    newRow: OptionType(FunctionType([SheetNewRowType], SheetSeedType)),
    newGroup: OptionType(FunctionType([SheetNewGroupType], SheetSeedType)),
    readyRow: OptionType(FunctionType([BlobType], ArrayType(SheetReadinessType))),
    readyGroup: OptionType(FunctionType([BlobType], SheetReadinessType)),
    driverColumn: OptionType(StringType),
    readEntry: FunctionType([StringType, IntegerType], OptionType(BlobType)),
    decode: FunctionType([BlobType, OptionType(BlobType), OptionType(BlobType)], BlobType),
    onPatch: OptionType(FunctionType([BlobType], NullType)),
    onApply: OptionType(SheetWireApplyType),
    mode: SheetApplyModeType,
});
