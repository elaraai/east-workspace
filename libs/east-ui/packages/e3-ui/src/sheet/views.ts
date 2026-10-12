/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>`'s saved views (#1183, `Sheet Builder Spec.md` decision 10,
 * SB11): a whole-value bind handle of `Array<Sheet.Types.View>` (local) or `Array<Sheet.Types.RecordView>` (indexed), kept where
 * the app keeps it — per viewer in `State`, or shared in a dataset — read as
 * the sheet's views, and written with every change to them.
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
import { SheetRecordViewType, SheetViewType } from "./types.js";

/** The views' bind handle as the sheet reads and writes it. */
type ViewsHandle<T extends EastType> = ExprType<StructType<{
    read: FunctionType<[], ArrayType<T>>;
    write: FunctionType<[ArrayType<T>], NullType>;
}>>;

/**
 * The sheet's views and their write-back, from its `views` handle (SB11).
 *
 * @param handle - A whole-value State or Data bind handle of local or record views
 * @returns The views, read through the handle, and the write the sheet calls with every change to them
 * @throws Error when the handle does not read and write one of the supported view types
 * @internal
 */
export function viewsOf(handle: unknown): {
    views?: ExprType<ArrayType<SheetViewType>>;
    onViewsChange?: ExprType<FunctionType<[ArrayType<SheetViewType>], NullType>>;
    recordViews?: ExprType<ArrayType<SheetRecordViewType>>;
    onRecordViewsChange?: ExprType<FunctionType<[ArrayType<SheetRecordViewType>], NullType>>;
} {
    const type = Expr.type(handle as Expr) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const read = fields["read"];
    const write = fields["write"];
    const accepts = (viewType: EastType): boolean => {
        const array = ArrayType(viewType);
        return read !== undefined && read.type === "Function" && read.inputs.length === 0 && isTypeEqual(read.output, array)
            && write !== undefined && write.type === "Function" && write.inputs.length === 1 && isTypeEqual(write.inputs[0]!, array) && write.output.type === "Null";
    };
    if (accepts(SheetRecordViewType)) {
        const views = handle as ViewsHandle<SheetRecordViewType>;
        return { recordViews: views.read(), onRecordViewsChange: views.write };
    }
    if (accepts(SheetViewType)) {
        const views = handle as ViewsHandle<SheetViewType>;
        return { views: views.read(), onViewsChange: views.write };
    }
    throw new Error("Sheet: `views` must be a bind handle of Array<Sheet.Types.View> for a local Slice, or Array<Sheet.Types.RecordView> for a record Slice — use State.bind for viewer-specific views or Data.bind to share them");
}
