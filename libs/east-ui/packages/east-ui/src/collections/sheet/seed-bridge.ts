/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Explicit creation defaults, retaining omitted fields as missing. @packageDocumentation */
import { ArrayType, East, FunctionType, OptionType, StructType, none, variant, type EastType, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { SheetRowType, SheetLineType, SheetPatchTypeFor } from "./types.js";
import { SheetSeedType } from "./editing-types.js";
import { SheetDraftFieldType, SheetDraftTypeFor } from "./transactions.js";
import { SheetDraftGroupTypeFor } from "./drafts.js";
import { buildDraftLift } from "./context-bridge.js";
import type { SheetBridge } from "./bridge.js";

/** Wrap a constructor once; its field draft and cells come from the same invocation. @internal */
export function buildSheetSeed(
    input: StructType,
    rowType: StructType,
    author: ExprType<FunctionType<[StructType], StructType>>,
    cellsOf: SheetBridge["encodePatch"],
    children?: { field: string; project: SheetBridge["projectRow"] },
): ExprType<FunctionType<[StructType], typeof SheetSeedType>> {
    const patchType = SheetPatchTypeFor(rowType) as StructType;
    const draftType = (children === undefined ? SheetDraftTypeFor(rowType) : SheetDraftGroupTypeFor(rowType, children.field)) as StructType;
    const childFieldType = children === undefined ? undefined : rowType.fields[children.field];
    const childType = childFieldType?.type === "Array" && childFieldType.value.type === "Struct" ? childFieldType.value : undefined;
    const liftChild = childType === undefined ? undefined : buildDraftLift(childType);
    return East.function([input], SheetSeedType, ($, context) => {
        const create = $.const(author);
        const project = $.const(cellsOf);
        const patch = $.const(create(context), patchType);
        const fields: Record<string, unknown> = {};
        let lines = $.const([], ArrayType(SheetLineType));
        for (const [field, type] of Object.entries(rowType.fields)) {
            const supplied = patch[field] as ExprType<OptionType<EastType>>;
            if (field === children?.field && childType !== undefined && liftChild !== undefined) {
                const rows = $.const((supplied as ExprType<OptionType<ArrayType<StructType>>>).match({
                    none: ($) => $.const([], ArrayType(childType)), some: (_$, value) => value,
                }), ArrayType(childType));
                const lift = $.const(liftChild);
                const projectRow = $.const(children.project);
                fields[field] = rows.map((_$, row) => lift(row));
                lines = $.const(rows.map((_$, row, index) => ({ key: East.str`seed:${index}`, cells: projectRow(row) })), ArrayType(SheetLineType));
            } else {
                const draftField = SheetDraftFieldType(type);
                fields[field] = supplied.match({
                    none: ($) => $.const(variant("missing", null), draftField),
                    some: ($, value) => $.const(variant("value", value), draftField),
                });
            }
        }
        const draft = $.const(fields as SubtypeExprOrValue<StructType>, draftType);
        const row = $.const({ id: "", owned: false, cells: project(patch), lines, band: none }, SheetRowType);
        return { draft: East.Blob.encodeBeast(draft, "v2"), row: East.Blob.encodeBeast(row, "v2") };
    });
}
