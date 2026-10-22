/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>`'s saved views (#1183, #1345, `Sheet Builder Spec.md` decision
 * 10, SB11): a whole-value bind handle of `Array<Sheet.Types.RecordView>`,
 * each view every source's narrowing by name, kept where the app keeps it —
 * per viewer in `State`, or shared in a dataset — read as the sheet's views,
 * and written with every change to them.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    Expr,
    isTypeEqual,
    type EastType,
    type ExprType,
    type FunctionType,
    type NullType,
    type StructType,
} from "@elaraai/east";
import { SheetRecordViewType } from "./types.js";

/** The views' bind handle as the sheet reads and writes it. */
type ViewsHandle = ExprType<StructType<{
    read: FunctionType<[], ArrayType<SheetRecordViewType>>;
    write: FunctionType<[ArrayType<SheetRecordViewType>], NullType>;
}>>;

/**
 * The sheet's views and their write-back, from its `views` handle (SB11).
 *
 * @param handle - A whole-value State or Data bind handle of `Array<Sheet.Types.RecordView>`
 * @returns The views, read through the handle, and the write the sheet calls with every change to them
 * @throws Error when the handle does not read and write `Array<Sheet.Types.RecordView>`
 * @internal
 */
export function viewsOf(handle: unknown): {
    views: ExprType<ArrayType<SheetRecordViewType>>;
    onViewsChange: ExprType<FunctionType<[ArrayType<SheetRecordViewType>], NullType>>;
} {
    const type = Expr.type(handle as Expr) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const read = fields["read"];
    const write = fields["write"];
    const array = ArrayType(SheetRecordViewType);
    const accepted = read !== undefined && read.type === "Function" && read.inputs.length === 0 && isTypeEqual(read.output, array)
        && write !== undefined && write.type === "Function" && write.inputs.length === 1 && isTypeEqual(write.inputs[0]!, array) && write.output.type === "Null";
    if (!accepted) {
        throw new Error("Sheet: `views` must be a bind handle of Array<Sheet.Types.RecordView> — each view every source's narrowing, by name (Sheet.Types.View went with the local Slice, #1345) — use State.bind for viewer-specific views or Data.bind to share them");
    }
    const views = handle as ViewsHandle;
    return { views: views.read(), onViewsChange: views.write };
}
