/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.Builder`'s saved views (#1183, `Sheet Builder Spec.md` decision 10,
 * SB11): a whole-value bind handle of `Array<Sheet.Types.View>`, kept where
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
import { SheetViewType } from "./types.js";

/** The views' bind handle as the builder reads and writes it. */
type ViewsHandle = ExprType<StructType<{
    read: FunctionType<[], ArrayType<SheetViewType>>;
    write: FunctionType<[ArrayType<SheetViewType>], NullType>;
}>>;

/**
 * The sheet's views and their write-back, from the builder's `views` handle (SB11).
 *
 * @param handle - A whole-value bind handle of `Array<Sheet.Types.View>`: `State.bind` or `Data.bind`
 * @returns The views, read through the handle, and the write the sheet calls with every change to them
 * @throws Error when the handle does not read and write `Array<Sheet.Types.View>`
 * @internal
 */
export function viewsOf(handle: unknown): {
    views: ExprType<ArrayType<SheetViewType>>;
    onViewsChange: ExprType<FunctionType<[ArrayType<SheetViewType>], NullType>>;
} {
    const type = Expr.type(handle as Expr) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const read = fields["read"];
    const write = fields["write"];
    const viewsType = ArrayType(SheetViewType);
    const reads = read !== undefined && read.type === "Function" && read.inputs.length === 0 && isTypeEqual(read.output, viewsType);
    const writes = write !== undefined && write.type === "Function" && write.inputs.length === 1 && isTypeEqual(write.inputs[0]!, viewsType) && write.output.type === "Null";
    if (!reads || !writes) {
        throw new Error("Sheet.Builder: `views` must be a bind handle of Array<Sheet.Types.View> — State.bind([ArrayType(Sheet.Types.View)], key, []) to keep them per viewer, or Data.bind over a dataset to share them");
    }
    const views = handle as ViewsHandle;
    return { views: views.read(), onViewsChange: views.write };
}
