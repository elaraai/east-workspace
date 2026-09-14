/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Invocation-time inline application and binding-lifetime request replay. @packageDocumentation */
import {
    ArrayType, BlobType, DictType, East, FunctionType, NullType, OptionType,
    StringType, StructType, none, some, variant,
    type EastType, type ExprType,
} from "@elaraai/east";
import { SheetRequestStore } from "./request-store.js";
import { applySheet, SheetApplyResultType, SheetChangeSetTypeFor } from "./transactions.js";

/** Retain the payload before writing, including the target of an uncertain write. */
const RequestType = StructType({
    payload: BlobType,
    result: OptionType(SheetApplyResultType),
    expected: OptionType(BlobType),
});
const RequestsType = DictType(StringType, RequestType);

/**
 * Builds the inline onUpdate adapter over a live collection handle.
 *
 * A confirmed request replays before any stale-base check. A throwing write
 * leaves an unresolved request in the store: retries confirm the target by
 * reading it, and never repeat an uncertain mutation. The request table lives
 * in the same browser state store as the binding, surviving Sheet remounts.
 *
 * @internal
 * @param entryType - The exact domain schema
 * @param idField - The entry identity field
 * @param sourceId - Stable identity of the captured binding
 * @param read - Invocation-time collection reader
 * @param write - The author's whole-collection writer
 * @returns A closed Blob transport function for the typed apply callback
 */
export function buildInlineApply(
    entryType: EastType,
    idField: string,
    sourceId: ExprType<StringType>,
    read: ExprType<FunctionType>,
    write: ExprType<FunctionType>,
): ExprType<FunctionType<[BlobType], typeof SheetApplyResultType>> {
    const entry = entryType as StructType<Record<never, never>>;
    const _rowsType = ArrayType(entry);
    const batchType = SheetChangeSetTypeFor(entry);
    const apply = applySheet(entry, idField);
    return East.function([BlobType], SheetApplyResultType, ($, payload) => {
        const reader = $.const(read as ExprType<FunctionType<[], typeof _rowsType>>);
        const writer = $.const(write as ExprType<FunctionType<[typeof _rowsType], NullType>>);
        const transform = $.const(apply);
        const key = $.const(East.str`sheet.requests:${sourceId}`);
        const saved = $.const(SheetRequestStore.read(key));
        const requests = $.let(saved.match({ none: ($) => $.const(new Map(), RequestsType), some: (_$, blob) => blob.decodeBeast(RequestsType, "v2") }));
        const batch = $.const(payload.decodeBeast(batchType, "v2"));
        const recorded = $.const(requests.tryGet(batch.requestId));
        return recorded.match({
            some: ($, request) => East.equal(request.payload, payload).ifElse(
                (_$) => request.result.match({
                    some: (_$, result) => result,
                    none: ($) => {
                        // An uncertain writer is never invoked twice. Only
                        // the exact target establishes successful application.
                        const current = $.const(East.Blob.encodeBeast(reader(), "v2"));
                        return East.equal(request.expected, some(current)).ifElse(($) => {
                            const confirmed = $.const(variant("applied", { revision: none }), SheetApplyResultType);
                            $(requests.insertOrUpdate(batch.requestId, { payload, result: some(confirmed), expected: request.expected }, (_$, _old, next) => next));
                            $(SheetRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                            return confirmed;
                        }, ($) => $.error("The previous write has an unknown outcome — retry after its target is confirmed; it cannot be safely issued twice"));
                    },
                }),
                ($) => $.const(variant("conflict", [{ entry: "", row: none, field: none, message: "This request id already names a different batch" }]), SheetApplyResultType),
            ),
            none: ($) => {
                const unresolved = $.const(requests.toArray((_$, request) => request.result.hasTag("none")).filter((_$, pending) => pending).size());
                $.if(unresolved.greater(0n), ($) => {
                    $.error("This source already has an unresolved write — recover its original request before submitting another batch");
                });
                const current = $.const(reader());
                const applied = $.const(transform(current, batch, none));
                return applied.match({
                    conflict: ($, issues) => {
                        const result = $.const(variant("conflict", issues), SheetApplyResultType);
                        $(requests.insert(batch.requestId, { payload, result: some(result), expected: none }));
                        $(SheetRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                        return result;
                    },
                    applied: ($, rows) => {
                        const expected = $.const(some(East.Blob.encodeBeast(rows, "v2")), OptionType(BlobType));
                        $(requests.insert(batch.requestId, { payload, result: none, expected }));
                        $(SheetRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                        $(writer(rows));
                        const result = $.const(variant("applied", { revision: none }), SheetApplyResultType);
                        $(requests.insertOrUpdate(batch.requestId, { payload, result: some(result), expected }, (_$, _old, next) => next));
                        $(SheetRequestStore.write(key, East.Blob.encodeBeast(requests, "v2")));
                        return result;
                    },
                });
            },
        });
    });
}
