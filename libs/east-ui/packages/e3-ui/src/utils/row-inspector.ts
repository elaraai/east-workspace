/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An author's own UI for one row in an inspector, on the wire: the Sheet's
 * own Details (SB58, #1188) and a Plan event kind's own inspector (PB60,
 * #1197). The author writes a typed East function over the row and a writer
 * of the edited row; it crosses to the renderer wrapped over bytes, so a
 * payload is one type whatever the rows hold.
 *
 * @packageDocumentation
 */

import {
    BlobType, East, Expr, FunctionType, NullType, isTypeEqual,
    type EastType, type ExprType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";

/**
 * An author's own UI for one row, on the wire: the row as bytes, and the
 * writer that takes the edited row back as bytes, to what the inspector shows
 * in place of its form.
 */
export const RowInspectorType = FunctionType([BlobType, FunctionType([BlobType], NullType)], UIComponentType);

/** Type representing {@link RowInspectorType}. */
export type RowInspectorType = typeof RowInspectorType;

/**
 * Checks an author's `(row, update) => UIComponentType` against the row type,
 * then wraps it so the row and the edited row cross as bytes. The author's
 * function is captured as it is and called only where the renderer draws it,
 * never here.
 *
 * @param fn - The author's function
 * @param rowType - The row type
 * @param refusal - What a function of another type is refused with, naming the option
 * @returns The wrapped function
 * @throws {Error} With `refusal` when the function is not `(Row, (Row) => Null) => UIComponentType`
 */
export function rowInspector(fn: unknown, rowType: StructType, refusal: string): ExprType<RowInspectorType> {
    const update = FunctionType([rowType], NullType);
    const author = East.value(fn as SubtypeExprOrValue<FunctionType>) as ExprType<FunctionType>;
    const t = Expr.type(author as unknown as Expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const fits = t.type === "Function" && t.inputs?.length === 2 && isTypeEqual(t.inputs[0]!, rowType) && isTypeEqual(t.inputs[1]!, update)
        && t.output !== undefined && isTypeEqual(t.output, UIComponentType);
    if (!fits) throw new Error(refusal);
    return East.function([BlobType, FunctionType([BlobType], NullType)], UIComponentType, ($, bytes, write) => {
        const draw = $.const(author as unknown as ExprType<FunctionType<[StructType, FunctionType<[StructType], NullType>], UIComponentType>>);
        const row = $.const(bytes.decodeBeast(rowType, "v2"));
        const typed = $.const(East.function([rowType], NullType, ($2, edited) => { $2(write(East.Blob.encodeBeast(edited, "v2"))); }));
        return draw(row, typed);
    });
}
