/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Draft-aware callback contexts; no domain values are synthesized. @packageDocumentation */
import { ArrayType, BlobType, DictType, East, FunctionType, IntegerType, OptionType, StringType, StructType, none, some, variant, type EastType, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { SheetContextType, SheetReadyBatchType } from "./types.js";
import { SheetDraftTypeFor } from "./transactions.js";
import { SheetDraftGroupTypeFor } from "./drafts.js";
import type { SheetBridge } from "./bridge.js";

type RecordType = StructType;

/** Lift an authoritative value into supplied field drafts, preserving hidden fields. */
export function buildDraftLift(type: StructType, children?: string): ExprType<FunctionType<[StructType], StructType>> {
    const draft = (children === undefined ? SheetDraftTypeFor(type) : SheetDraftGroupTypeFor(type, children)) as StructType;
    const childType = children === undefined ? undefined : type.fields[children];
    const liftChild = childType?.type === "Array" && childType.value.type === "Struct" ? buildDraftLift(childType.value) : undefined;
    return East.function([type], draft, ($, value) => {
        const out: Record<string, unknown> = {};
        for (const field of Object.keys(type.fields)) {
            if (field === children && liftChild !== undefined) {
                const lift = $.const(liftChild);
                out[field] = (value[field] as ExprType<ArrayType<StructType>>).map((_$, row) => lift(row));
            } else out[field] = variant("value", value[field]);
        }
        return $.const(out as SubtypeExprOrValue<StructType>, draft);
    });
}

/** Return the existing draft, or lift the exact authoritative entry if resident. */
export function buildDraftBase(rowType: StructType, field: string | undefined, rowById: SheetBridge["rowById"]) {
    const draftType = (field === undefined ? SheetDraftTypeFor(rowType) : SheetDraftGroupTypeFor(rowType, field)) as StructType;
    const lift = buildDraftLift(rowType, field);
    return East.function([DictType(StringType, BlobType), StringType, IntegerType], OptionType(draftType), ($, drafts, id, offset) => {
        const read = $.const(rowById);
        const supplied = $.const(lift);
        return drafts.tryGet(id).match({
            some: ($, bytes) => $.const(some(bytes.decodeBeast(draftType, "v2")), OptionType(draftType)),
            none: () => read(id, offset).match({
                none: ($) => $.const(none, OptionType(draftType)),
                some: ($, value) => $.const(some(supplied(value)), OptionType(draftType)),
            }),
        });
    });
}

/** Build a callback context from the current draft and a provisional cell edit. */
export function buildDraftContextBridge(
    rowType: StructType,
    lineType: StructType,
    field: string | undefined,
    ctxType: StructType,
    driverType: EastType,
    rowById: SheetBridge["rowById"],
    draftDecode: SheetBridge["draftDecode"],
    draftRow: ExprType<FunctionType<[StringType, DictType<StringType, import("./types.js").SheetCellType>, OptionType<RecordType>], RecordType>>,
    lookupDriver: ExprType<FunctionType>,
): SheetBridge["bridgeCtx"] {
    const rowDraft = SheetDraftTypeFor(lineType) as StructType;
    const entryDraft = (field === undefined ? SheetDraftTypeFor(rowType) : SheetDraftGroupTypeFor(rowType, field)) as StructType;
    const base = buildDraftBase(rowType, field, rowById);
    return East.function([SheetContextType], ctxType, ($, ctx) => {
        const readBase = $.const(base);
        const dec = $.const(draftRow);
        const decEntry = $.const(draftDecode);
        const lookup = $.const(lookupDriver as ExprType<FunctionType<[StringType], OptionType<EastType>>>);
        // Every resident row's current draft — a readiness batch builds its rows the same way (`buildReadyContexts`).
        const entries = $.const(ctx.rows.map((_$, wire, index) => decEntry(wire, readBase(ctx.drafts, wire.id, ctx.rowsOffset.add(index)), some(wire))), ArrayType(entryDraft));
        const driver = $.const(ctx.driver.match({ none: () => none, some: (_$, key) => lookup(key) }), OptionType(driverType));
        if (field === undefined) {
            const row = $.const(dec(ctx.rowId, ctx.row, readBase(ctx.drafts, ctx.rowId, ctx.offset)), rowDraft);
            const rows = $.const(entries.map((_$, entry, index) => ctx.rows.get(index).id.equal(ctx.rowId).ifElse(() => row, () => entry)));
            return $.const({ rowIndex: ctx.rowIndex, row, rows, group: none, partial: ctx.partial, driver, today: ctx.today } as SubtypeExprOrValue<StructType>, ctxType);
        }
        const group = $.const(ctx.rows.firstMap(($, wire, index) => wire.id.equal(ctx.rowId).ifElse(
            ($) => $.const(some(entries.get(index)), OptionType(entryDraft)),
            ($) => $.const(none, OptionType(entryDraft)),
        )), OptionType(entryDraft));
        const prior = $.const(group.match({
            none: () => none,
            some: (_$, value) => {
                const children = value[field] as ExprType<ArrayType<StructType>>;
                return ctx.rowIndex.greaterEqual(0n).and(() => ctx.rowIndex.less(children.size())).ifElse(
                    () => some(children.get(ctx.rowIndex)), () => none,
                );
            },
        }), OptionType(rowDraft));
        const row = $.const(dec("", ctx.row, prior), rowDraft);
        const edited = $.const(group.match({
            none: () => none,
            some: ($, value) => {
                const children = value[field] as ExprType<ArrayType<StructType>>;
                const updated = $.const(children.map((_$, child, index) => index.equal(ctx.rowIndex).ifElse(() => row, () => child)));
                const rows = $.const(ctx.rowIndex.equal(children.size()).ifElse(() => updated.concat([row]), () => updated));
                const result = $.const({ ...Object.fromEntries(Object.keys(rowType.fields).map(key => [key, key === field ? rows : value[key]])) } as SubtypeExprOrValue<StructType>, entryDraft);
                return some(result);
            },
        }), OptionType(entryDraft));
        const rows = $.const(edited.match({ none: ($) => $.const([], ArrayType(rowDraft)), some: (_$, value) => value[field] as ExprType<ArrayType<StructType>> }), ArrayType(rowDraft));
        const groups = $.const(entries.map((_$, entry, index) => ctx.rows.get(index).id.equal(ctx.rowId).ifElse(
            () => edited.match({ none: () => entry, some: (_$, value) => value }), () => entry,
        )));
        return $.const({ rowIndex: ctx.rowIndex, row, rows, group: edited, groups, partial: ctx.partial, driver, today: ctx.today } as SubtypeExprOrValue<StructType>, ctxType);
    });
}

/**
 * Build a readiness batch's typed contexts (#882): the rows are built once,
 * then there is one context per check over them, in the checks' order.
 *
 * @remarks
 * A check's row is the draft built at its place: the row's own cells over
 * its own draft. A wire context substitutes its provisional row into the
 * rows it builds ({@link buildDraftContextBridge}). For a check, that would
 * put back the very draft it replaces, so every context shares the rows
 * unchanged. On a grouped sheet a check's `group` is its group's draft,
 * `rows` that group's lines and `groups` the batch's rows. Every check of a
 * batch reads the same rows, so a check that edits them in place changes
 * what the checks after it see.
 *
 * @param rowType - The source row's type (a grouped sheet: the group's)
 * @param field - A grouped sheet's lines field
 * @param ctxType - The typed context — `DraftContext(R, D)`, or `DraftContext(P, "lines", D)`
 * @param driverType - The driver's row type
 * @param rowById - The real source row by id and offset
 * @param draftDecode - A row's cells over its draft
 * @param lookupDriver - The driver row by key
 * @returns The batch → one typed context per check
 */
export function buildReadyContexts(
    rowType: StructType,
    field: string | undefined,
    ctxType: StructType,
    driverType: EastType,
    rowById: SheetBridge["rowById"],
    draftDecode: SheetBridge["draftDecode"],
    lookupDriver: ExprType<FunctionType>,
): SheetBridge["bridgeReady"] {
    const entryDraft = (field === undefined ? SheetDraftTypeFor(rowType) : SheetDraftGroupTypeFor(rowType, field)) as StructType;
    const base = buildDraftBase(rowType, field, rowById);
    return East.function([SheetReadyBatchType], ArrayType(ctxType), ($, batch) => {
        const readBase = $.const(base);
        const decEntry = $.const(draftDecode);
        const lookup = $.const(lookupDriver as ExprType<FunctionType<[StringType], OptionType<EastType>>>);
        // The rows, once for every check — as a wire context builds its `entries`.
        const entries = $.const(batch.rows.map((_$, wire, index) => decEntry(wire, readBase(batch.drafts, wire.id, batch.rowsOffset.add(index)), some(wire))), ArrayType(entryDraft));
        return batch.checks.map(($, check) => {
            const driver = $.const(check.driver.match({ none: () => none, some: (_$, key) => lookup(key) }), OptionType(driverType));
            if (field === undefined) {
                return $.const({ rowIndex: check.index, row: entries.get(check.index), rows: entries, group: none, partial: batch.partial, driver, today: batch.today } as SubtypeExprOrValue<StructType>, ctxType);
            }
            const group = $.const(entries.get(check.index), entryDraft);
            const lines = $.const(group[field] as ExprType<ArrayType<StructType>>);
            const line = $.const(check.line.unwrap("some"));
            return $.const({ rowIndex: line, row: lines.get(line), rows: lines, group: some(group), groups: entries, partial: batch.partial, driver, today: batch.today } as SubtypeExprOrValue<StructType>, ctxType);
        }) as unknown as ExprType<ArrayType<StructType>>;
    }) as unknown as SheetBridge["bridgeReady"];
}
