/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typed author callbacks behind a closed renderer transport. @packageDocumentation */
import {
    ArrayType, AsyncFunctionType, BlobType, East, Expr, FunctionType, IntegerType,
    NullType, OptionType, StringType, StructType, none, some, toEastTypeValue, variant,
    type DictType, type EastType, type ExprType, type SubtypeExprOrValue, type VariantType,
} from "@elaraai/east";
import type { ResolvedRowSource } from "../../contracts/source.js";
import { SheetRowType, SheetPatchTypeFor, SheetReadyBatchType } from "./types.js";
import { buildPatchCells, type SheetBridge } from "./bridge.js";
import { SheetApplyResultType, SheetChangeSetTypeFor, SheetNewRowType, SheetNewGroupType, SheetReadinessType, SheetDraftTypeFor } from "./transactions.js";
import { SheetDraftEntryTypeFor, SheetDraftGroupTypeFor, SheetPatchEventTypeFor } from "./drafts.js";
import { SheetEditingType, SheetWireApplyType } from "./editing-types.js";
import { buildSheetSeed } from "./seed-bridge.js";
import { resolveSheetEdits, type SheetEditsInput } from "./edits.js";
import { buildInlineApply } from "../../contracts/editing.js";

/** Author editing behavior, erased only at the factory boundary. @internal */
export interface SheetEditingInput {
    edits?: SheetEditsInput;
    ready?: { row?: unknown; group?: unknown };
    newRow?: unknown;
    newGroup?: unknown;
    onPatch?: unknown;
    onApply?: unknown;
    onUpdate?: unknown;
    applyMode?: "batch" | "auto";
}

/** Validate a behavior prop against its exact East signature. */
function callback(value: unknown, input: EastType, output: EastType, name: string, allowAsync: boolean): ExprType<EastType> {
    const fn = East.value(value as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(fn as Expr<EastType>) as EastType;
    if ((type.type !== "Function" && !(allowAsync && type.type === "AsyncFunction")) ||
        !("inputs" in type) || type.inputs.length !== 1 || type.inputs[0] !== input || type.output !== output) {
        throw new Error(`Sheet: ${name} must be an East ${allowAsync ? "sync/async " : ""}function with this sheet's exact event and result types`);
    }
    return fn;
}

/**
 * Captures source identity, codecs and authoritative callbacks for one Sheet.
 * @internal
 * @param source - Resolved rows, retaining the live handle when provided
 * @param bridge - The typed column bridge
 * @param idField - Positional entry identity field
 * @param input - Author editing behavior
 * @param driverColumn - The lookup field used to resolve a row readiness context
 * @returns The closed transaction transport stored in the root IR
 */
export function buildSheetEditing(source: ResolvedRowSource, bridge: SheetBridge, idField: string | undefined, input: SheetEditingInput, driverColumn?: string): ExprType<typeof SheetEditingType> {
    const edits = resolveSheetEdits(input.edits, bridge.group !== undefined, source.kind === "paged" && source.collectionType.type === "Dict");
    // The entry: a row, a group — or, with loose rows between the groups
    // (#846), `Sheet.Types.Entry(P, "lines")`. The algorithm treats it
    // opaquely; its runtime East type is exact.
    const rowType = bridge.rowType as StructType<Record<never, never>>;
    const rowsType = ArrayType(rowType);
    const field = bridge.group?.linesField;
    const groupType = bridge.group?.groupType ?? rowType;
    const draftType = SheetDraftEntryTypeFor(rowType, field);
    const eventType = SheetPatchEventTypeFor(rowType, field);
    const batchType = SheetChangeSetTypeFor(rowType as StructType<Record<never, never>>);
    // A keyed paged source's key type (#880). The shared session speaks keyed
    // batches over it — `ChangeSet(R, K)` — while the author's `onApply` takes
    // the Sheet's own `ChangeSet(R)`; a paged batch is checked by revision,
    // which both spell alike, so the wrapper below restates the one as the other.
    const keyType = source.kind === "paged" && source.collectionType.type === "Dict"
        ? (source.collectionType as DictType<EastType, EastType>).key : undefined;
    const wireBatchType = keyType !== undefined ? SheetChangeSetTypeFor(rowType as StructType<Record<never, never>>, keyType) : batchType;
    const toAuthorBatch = keyType === undefined ? undefined : East.function([wireBatchType], batchType, ($, wire) => {
        const base = $.let(variant("revision", ""), batchType.fields.base);
        $.match(wire.base as unknown as ExprType<VariantType<{ revision: StringType; snapshot: EastType }>>, {
            revision: ($2, revision) => { $2.assign(base, variant("revision", revision)); },
            snapshot: ($2) => { $2.error("Sheet: a keyed paged source's batch is checked by its revision, never a snapshot"); },
        });
        return $.let({ requestId: wire.requestId, base, label: wire.label, changes: wire.changes }, batchType);
    });
    if (input.onApply !== undefined && input.onUpdate !== undefined) throw new Error("Sheet: choose onApply or the inline onUpdate adapter, not both");
    if (input.onUpdate !== undefined && (source.kind !== "inline" || source.live === undefined)) {
        throw new Error("Sheet: onUpdate requires data={liveHandle} so each batch reads the latest collection — pass the handle itself or provide onApply");
    }
    if (input.applyMode === "auto" && input.onApply === undefined && input.onUpdate === undefined) throw new Error("Sheet: applyMode auto requires onApply or a live onUpdate binding");
    if (source.kind === "paged" && input.onApply !== undefined) {
        const fields = (Expr.type(source.source) as StructType).fields;
        if (fields.revision === undefined || fields.refresh === undefined) throw new Error("Sheet: mutable paged editing requires revision and refresh with committed-revision acknowledgement — provide both lifecycle methods");
    }
    const live = source.kind === "inline" ? source.live : undefined;
    const reader = live !== undefined ? live.read as ExprType<FunctionType<[], typeof rowsType>> : undefined;
    const authorApply = input.onApply !== undefined ? callback(input.onApply, batchType, SheetApplyResultType, "onApply", true) : undefined;
    const sourceId = source.kind === "paged" ? source.source.id as ExprType<StringType>
        : reader !== undefined ? East.print(East.Blob.encodeBeast(reader, "v2"))
        : authorApply !== undefined ? East.print(East.Blob.encodeBeast(authorApply, "v2"))
        : East.value("readonly-inline", StringType);
    const readEntry = East.function([StringType, IntegerType], OptionType(BlobType), ($, id, offset) => {
        const read = $.const(bridge.rowById);
        return read(id, offset).match({
            none: ($) => $.const(none, OptionType(BlobType)),
            some: ($, row) => $.const(some(East.Blob.encodeBeast(row, "v2")), OptionType(BlobType)),
        });
    });
    const decode = East.function([BlobType, OptionType(BlobType), OptionType(BlobType)], BlobType, ($, rowBlob, payload, previousBlob) => {
        const row = $.const(rowBlob.decodeBeast(SheetRowType, "v2"));
        const base = $.const(payload.match({ none: () => none, some: (_$, blob) => some(blob.decodeBeast(draftType, "v2")) }), OptionType(draftType));
        const previous = $.const(previousBlob.match({ none: () => none, some: (_$, blob) => some(blob.decodeBeast(SheetRowType, "v2")) }), OptionType(SheetRowType));
        const decoder = $.const(bridge.draftDecode);
        return East.Blob.encodeBeast(decoder(row, base, previous), "v2");
    });
    let onApply: ExprType<typeof SheetWireApplyType> | undefined;
    if (reader !== undefined && input.onUpdate !== undefined) {
        const writer = callback(input.onUpdate, rowsType, NullType, "onUpdate", false);
        onApply = East.value(variant("sync", buildInlineApply(rowType, idField!, sourceId, reader, writer as ExprType<FunctionType>)), SheetWireApplyType);
    } else if (authorApply !== undefined) {
        const async = (Expr.type(authorApply as Expr<EastType>) as EastType).type === "AsyncFunction";
        if (async) {
            const fn = authorApply as ExprType<AsyncFunctionType<[typeof batchType], typeof SheetApplyResultType>>;
            const wrap = East.asyncFunction([BlobType], SheetApplyResultType, ($, blob) => {
                const apply = $.const(fn);
                if (toAuthorBatch === undefined) return apply(blob.decodeBeast(batchType, "v2"));
                const restate = $.const(toAuthorBatch);
                return apply(restate(blob.decodeBeast(wireBatchType, "v2")));
            });
            onApply = East.value(variant("async", wrap), SheetWireApplyType);
        } else {
            const fn = authorApply as ExprType<FunctionType<[typeof batchType], typeof SheetApplyResultType>>;
            const wrap = East.function([BlobType], SheetApplyResultType, ($, blob) => {
                const apply = $.const(fn);
                if (toAuthorBatch === undefined) return apply(blob.decodeBeast(batchType, "v2"));
                const restate = $.const(toAuthorBatch);
                return apply(restate(blob.decodeBeast(wireBatchType, "v2")));
            });
            onApply = East.value(variant("sync", wrap), SheetWireApplyType);
        }
    }
    const authorPatch = input.onPatch !== undefined ? callback(input.onPatch, eventType, NullType, "onPatch", false) : undefined;
    const onPatch = authorPatch !== undefined ? East.function([BlobType], NullType, ($, blob) => {
        const observe = $.const(authorPatch as ExprType<FunctionType<[EastType], NullType>>);
        $(observe(blob.decodeBeast(eventType, "v2")));
    }) : undefined;
    if (input.newGroup !== undefined && bridge.group === undefined) throw new Error("Sheet: newGroup requires a group declaration");
    const rowConstructor = input.newRow === undefined ? undefined : callback(input.newRow, SheetNewRowType, bridge.patchType, "newRow", false);
    const groupConstructor = input.newGroup === undefined ? undefined : callback(input.newGroup, SheetNewGroupType, SheetPatchTypeFor(groupType), "newGroup", false);
    const newRow = rowConstructor === undefined ? undefined : buildSheetSeed(SheetNewRowType, bridge.lineType,
        rowConstructor as ExprType<FunctionType<[StructType], StructType>>, bridge.seedCells);
    const newGroup = groupConstructor === undefined || bridge.group === undefined ? undefined : buildSheetSeed(SheetNewGroupType, groupType,
        groupConstructor as ExprType<FunctionType<[StructType], StructType>>, buildPatchCells(groupType, bridge.group.cellMetas, {}, false),
        { field: bridge.group.linesField, project: bridge.projectRow });
    const readyGroupExpr = input.ready?.group;
    if (readyGroupExpr !== undefined && field === undefined) throw new Error("Sheet: ready.group requires a group declaration");
    // A group's check takes its DraftGroup; the renderer sends the entry's
    // draft — on a source with loose rows (#846), the group arm of it.
    const groupDraft = bridge.group?.loose === true && field !== undefined ? SheetDraftGroupTypeFor(groupType, field as never) : draftType;
    const authorGroup = readyGroupExpr === undefined ? undefined : callback(readyGroupExpr, groupDraft, SheetReadinessType, "ready.group", false);
    const readyGroup = authorGroup === undefined ? undefined : East.function([BlobType], SheetReadinessType, ($, blob) => {
        const check = $.const(authorGroup as ExprType<FunctionType<[EastType], typeof SheetReadinessType>>);
        if (groupDraft === draftType) return check(blob.decodeBeast(draftType, "v2"));
        const entry = $.const(blob.decodeBeast(draftType, "v2") as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>);
        return check(entry.unwrap("group"));
    });
    let readyRow: ExprType<FunctionType<[BlobType], ArrayType<typeof SheetReadinessType>>> | undefined;
    if (input.ready?.row !== undefined) {
        const fn = East.value(input.ready.row as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const type = Expr.type(fn as Expr<EastType>) as EastType;
        const rowDraft = SheetDraftTypeFor(bridge.lineType);
        if (type.type !== "Function" || type.inputs.length !== 2 || type.inputs[0] !== rowDraft || type.inputs[1] !== bridge.ctxType || type.output !== SheetReadinessType) {
            throw new Error("Sheet: ready.row must be an East function over this row's Draft and this sheet's DraftContext, returning Readiness");
        }
        // One call per evaluation (#882): the batch's rows are built once, and
        // each check's result returns in the batch's order. A check that
        // throws fails its own row alone — the rest still report.
        readyRow = East.function([BlobType], ArrayType(SheetReadinessType), ($, blob) => {
            const contexts = $.const(bridge.bridgeReady);
            const check = $.const(fn as ExprType<FunctionType<[StructType, StructType], typeof SheetReadinessType>>);
            const typed = $.const(contexts(blob.decodeBeast(SheetReadyBatchType, "v2")));
            return typed.map(($, context) => {
                const result = $.let(variant("ready", null), SheetReadinessType);
                $.try(($) => {
                    $.assign(result, check(context.row as ExprType<StructType>, context));
                }).catch(($, message) => {
                    $.assign(result, variant("invalid", [{ field: "", message: East.str`Row readiness failed: ${message}` }]));
                });
                return result;
            });
        });
    }
    return East.value({
        edits,
        readyRow: readyRow === undefined ? none : some(readyRow),
        readyGroup: readyGroup === undefined ? none : some(readyGroup),
        driverColumn: driverColumn === undefined ? none : some(driverColumn),
        newRow: newRow === undefined ? none : some(newRow),
        newGroup: newGroup === undefined ? none : some(newGroup),
        sourceId, entryType: toEastTypeValue(rowType), draftType: toEastTypeValue(draftType),
        idField: idField !== undefined ? some(idField) : none,
        children: field !== undefined ? some(field) : none,
        // A keyed paged source's key type (#880): its entries sort by key, a
        // reconcile seeks an entry by its key's `.east` literal, and its
        // batches arrive keyed (restated for the author above).
        keyType: keyType !== undefined ? some(toEastTypeValue(keyType)) : none,
        snapshot: source.kind === "inline" ? some(East.Blob.encodeBeast(source.rows, "v2")) : none,
        readEntry, decode, onApply: onApply !== undefined ? some(onApply) : none,
        onPatch: onPatch !== undefined ? some(onPatch) : none,
        mode: variant(input.applyMode ?? "batch", null),
    }, SheetEditingType);
}
