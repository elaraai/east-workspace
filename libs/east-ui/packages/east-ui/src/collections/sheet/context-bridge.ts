/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Draft-aware callback contexts; no domain values are synthesized. @packageDocumentation */
import { ArrayType, BlobType, DictType, East, FunctionType, IntegerType, OptionType, StringType, StructType, none, some, variant, type BlockBuilder, type EastType, type ExprType, type SubtypeExprOrValue, type VariantType } from "@elaraai/east";
import { SheetContextType, SheetReadyBatchType } from "./types.js";
import { SheetDraftTypeFor } from "./transactions.js";
import { SheetDraftEntryTypeFor, SheetDraftGroupTypeFor } from "./drafts.js";
import type { SheetBridge } from "./bridge.js";

type RecordType = StructType;
/** A source that holds loose rows between its groups (#846): `Sheet.Types.Entry(P, "lines")`. */
type EntryVariant = VariantType<{ group: StructType; row: StructType }>;
/** A row's cells over its draft — the line decoder, or a loose row's, which writes the row's id. */
type DecodeRow = ExprType<FunctionType<[StringType, DictType<StringType, import("./types.js").SheetCellType>, OptionType<RecordType>], RecordType>>;

/**
 * Lift an authoritative value into supplied field drafts, preserving hidden
 * fields — a row, a group with its children, or an entry of a source with
 * loose rows (#846), each arm as its own.
 */
export function buildDraftLift(type: EastType, children?: string): ExprType<FunctionType<[EastType], EastType>> {
    if (type.type === "Variant") {
        const entry = type as EntryVariant;
        const draft = SheetDraftEntryTypeFor(entry, children) as unknown as EntryVariant;
        const liftGroup = buildDraftLift(entry.cases.group, children);
        const liftRow = buildDraftLift(entry.cases.row);
        return East.function([entry], draft, ($, value) => {
            const group = $.const(liftGroup);
            const row = $.const(liftRow);
            return value.match({
                group: ($2, g) => $2.const(variant("group", group(g) as ExprType<StructType>), draft),
                row: ($2, r) => $2.const(variant("row", row(r) as ExprType<StructType>), draft),
            });
        }) as unknown as ExprType<FunctionType<[EastType], EastType>>;
    }
    const record = type as StructType;
    const draft = (children === undefined ? SheetDraftTypeFor(record) : SheetDraftGroupTypeFor(record, children)) as StructType;
    const childType = children === undefined ? undefined : record.fields[children];
    const liftChild = childType?.type === "Array" && childType.value.type === "Struct" ? buildDraftLift(childType.value) : undefined;
    return East.function([record], draft, ($, value) => {
        const out: Record<string, unknown> = {};
        for (const field of Object.keys(record.fields)) {
            if (field === children && liftChild !== undefined) {
                const lift = $.const(liftChild);
                out[field] = (value[field] as ExprType<ArrayType<StructType>>).map((_$, row) => lift(row));
            } else out[field] = variant("value", value[field]);
        }
        return $.const(out as SubtypeExprOrValue<StructType>, draft);
    }) as unknown as ExprType<FunctionType<[EastType], EastType>>;
}

/** Return the existing draft, or lift the exact authoritative entry if resident. */
export function buildDraftBase(rowType: EastType, field: string | undefined, rowById: SheetBridge["rowById"]) {
    const draftType = SheetDraftEntryTypeFor(rowType, field) as EastType;
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
    rowType: EastType,
    lineType: StructType,
    field: string | undefined,
    ctxType: StructType,
    driverType: EastType,
    rowById: SheetBridge["rowById"],
    draftDecode: SheetBridge["draftDecode"],
    draftRow: DecodeRow,
    lookupDriver: ExprType<FunctionType>,
    looseRow?: DecodeRow,
): SheetBridge["bridgeCtx"] {
    const rowDraft = SheetDraftTypeFor(lineType) as StructType;
    const entryDraft = SheetDraftEntryTypeFor(rowType, field) as EastType;
    const base = buildDraftBase(rowType, field, rowById);
    // A source with loose rows (#846): a group's draft is its entry's group arm.
    const groupDraft = (looseRow !== undefined && field !== undefined ? SheetDraftGroupTypeFor((rowType as EntryVariant).cases.group, field) : entryDraft) as StructType;
    return East.function([SheetContextType], ctxType, ($, ctx) => {
        const readBase = $.const(base);
        const dec = $.const(draftRow);
        const decEntry = $.const(draftDecode);
        const lookup = $.const(lookupDriver as ExprType<FunctionType<[StringType], OptionType<EastType>>>);
        // Every resident row's current draft — a readiness batch builds its rows the same way (`buildReadyContexts`).
        const entries = $.const(ctx.rows.map((_$, wire, index) => decEntry(wire, readBase(ctx.drafts, wire.id, ctx.rowsOffset.add(index)), some(wire))), ArrayType(entryDraft));
        const driver = $.const(ctx.driver.match({ none: () => none, some: (_$, key) => lookup(key) }), OptionType(driverType));
        if (field === undefined) {
            const row = $.const(dec(ctx.rowId, ctx.row, readBase(ctx.drafts, ctx.rowId, ctx.offset) as ExprType<OptionType<StructType>>), rowDraft);
            const rows = $.const(entries.map((_$, entry, index) => ctx.rows.get(index).id.equal(ctx.rowId).ifElse(() => row, () => entry)));
            return $.const({ rowIndex: ctx.rowIndex, row, rows, group: none, partial: ctx.partial, driver, today: ctx.today } as SubtypeExprOrValue<StructType>, ctxType);
        }
        // On a source with loose rows (#846) the entries are variants: a group's draft is its entry's group arm.
        const asEntries = entries as unknown as ExprType<ArrayType<EntryVariant>>;
        /** A line's context: the line as it would be over its prior draft, its group's lines with it in place, every group. */
        const lineContext = ($2: BlockBuilder<EastType>) => {
            const group = $2.const(ctx.rows.firstMap(($3, wire, index) => wire.id.equal(ctx.rowId).ifElse(
                ($4) => looseRow === undefined
                    ? $4.const(some(entries.get(index)), OptionType(groupDraft))
                    : $4.const(asEntries.get(index).match({ group: (_$5, g) => some(g), row: () => none }), OptionType(groupDraft)),
                ($4) => $4.const(none, OptionType(groupDraft)),
            )), OptionType(groupDraft));
            const prior = $2.const(group.match({
                none: () => none,
                some: (_$, value) => {
                    const children = value[field] as ExprType<ArrayType<StructType>>;
                    return ctx.rowIndex.greaterEqual(0n).and(() => ctx.rowIndex.less(children.size())).ifElse(
                        () => some(children.get(ctx.rowIndex)), () => none,
                    );
                },
            }), OptionType(rowDraft));
            const row = $2.const(dec("", ctx.row, prior), rowDraft);
            const edited = $2.const(group.match({
                none: () => none,
                some: ($, value) => {
                    const children = value[field] as ExprType<ArrayType<StructType>>;
                    const updated = $.const(children.map((_$, child, index) => index.equal(ctx.rowIndex).ifElse(() => row, () => child)));
                    const rows = $.const(ctx.rowIndex.equal(children.size()).ifElse(() => updated.concat([row]), () => updated));
                    const result = $.const({ ...Object.fromEntries(Object.keys(groupDraft.fields).map(key => [key, key === field ? rows : value[key]])) } as SubtypeExprOrValue<StructType>, groupDraft);
                    return some(result);
                },
            }), OptionType(groupDraft));
            const rows = $2.const(edited.match({ none: ($) => $.const([], ArrayType(rowDraft)), some: (_$, value) => value[field] as ExprType<ArrayType<StructType>> }), ArrayType(rowDraft));
            const groups = looseRow === undefined
                ? $2.const(entries.map((_$, entry, index) => ctx.rows.get(index).id.equal(ctx.rowId).ifElse(() => edited.match({ none: () => entry, some: (_$3, value) => value }), () => entry)))
                : $2.const(asEntries.filterMap((_$, entry, index) => entry.match({
                    group: (_$3, g) => some(ctx.rows.get(index).id.equal(ctx.rowId).ifElse(() => edited.match({ none: () => g, some: (_$4, value) => value }), () => g)),
                    row: () => none,
                })) as unknown as ExprType<ArrayType<StructType>>, ArrayType(groupDraft));
            return $2.const({ rowIndex: ctx.rowIndex, row, rows, group: edited, groups, partial: ctx.partial, driver, today: ctx.today } as SubtypeExprOrValue<StructType>, ctxType);
        };
        if (looseRow === undefined) return lineContext($ as unknown as BlockBuilder<EastType>);
        // A LOOSE row (#846) — no line address: its own draft over its cells,
        // among the resident loose rows, beside every group.
        const decLoose = $.const(looseRow);
        return ctx.line.match({
            some: ($2) => lineContext($2 as unknown as BlockBuilder<EastType>),
            none: ($2) => {
                const own = $2.const(readBase(ctx.drafts, ctx.rowId, ctx.offset).match({
                    none: () => none,
                    some: (_$, entry) => (entry as unknown as ExprType<EntryVariant>).match({ row: (_$2, r) => some(r), group: () => none }),
                }), OptionType(rowDraft));
                const row = $2.const(decLoose(ctx.rowId, ctx.row, own), rowDraft);
                const asEntry = $2.const(variant("row", row), entryDraft as unknown as EntryVariant);
                const edited = $2.const(asEntries.map((_$, entry, index) => ctx.rows.get(index).id.equal(ctx.rowId).ifElse(() => asEntry, () => entry)), ArrayType(entryDraft as unknown as EntryVariant));
                const rows = $2.const(edited.filterMap((_$, entry) => entry.match({ row: (_$2, r) => some(r), group: () => none })) as unknown as ExprType<ArrayType<StructType>>, ArrayType(rowDraft));
                const groups = $2.const(edited.filterMap((_$, entry) => entry.match({ group: (_$2, g) => some(g), row: () => none })) as unknown as ExprType<ArrayType<StructType>>, ArrayType(groupDraft));
                // Its index among the loose rows: the loose rows before it in `rows`.
                const rowIndex = $2.const(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, wire) => wire.band.hasTag("none")).size());
                return $2.const({ rowIndex, row, rows, group: none, groups, partial: ctx.partial, driver, today: ctx.today } as SubtypeExprOrValue<StructType>, ctxType);
            },
        });
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
 * `rows` that group's lines and `groups` the batch's groups; a LOOSE row's
 * (#846) has no group, and its `rows` are the batch's loose rows. Every check
 * of a batch reads the same rows, so a check that edits them in place changes
 * what the checks after it see.
 *
 * @param rowType - The source row's type (a grouped sheet: the group's; with loose rows, the entry)
 * @param field - A grouped sheet's lines field
 * @param ctxType - The typed context — `DraftContext(R, D)`, or `DraftContext(P, "lines", D)`
 * @param driverType - The driver's row type
 * @param rowById - The real source row by id and offset
 * @param draftDecode - A row's cells over its draft
 * @param lookupDriver - The driver row by key
 * @param loose - Whether the source holds loose rows between its groups (#846)
 * @returns The batch → one typed context per check
 */
export function buildReadyContexts(
    rowType: EastType,
    field: string | undefined,
    ctxType: StructType,
    driverType: EastType,
    rowById: SheetBridge["rowById"],
    draftDecode: SheetBridge["draftDecode"],
    lookupDriver: ExprType<FunctionType>,
    loose = false,
): SheetBridge["bridgeReady"] {
    const entryDraft = SheetDraftEntryTypeFor(rowType, field) as EastType;
    const base = buildDraftBase(rowType, field, rowById);
    const groupDraft = (loose && field !== undefined ? SheetDraftGroupTypeFor((rowType as EntryVariant).cases.group, field) : entryDraft) as StructType;
    const rowDraft = (loose ? SheetDraftTypeFor((rowType as EntryVariant).cases.row) : entryDraft) as StructType;
    return East.function([SheetReadyBatchType], ArrayType(ctxType), ($, batch) => {
        const readBase = $.const(base);
        const decEntry = $.const(draftDecode);
        const lookup = $.const(lookupDriver as ExprType<FunctionType<[StringType], OptionType<EastType>>>);
        // The rows, once for every check — as a wire context builds its `entries`.
        const entries = $.const(batch.rows.map((_$, wire, index) => decEntry(wire, readBase(batch.drafts, wire.id, batch.rowsOffset.add(index)), some(wire))), ArrayType(entryDraft));
        if (field === undefined || !loose) {
            return batch.checks.map(($, check) => {
                const driver = $.const(check.driver.match({ none: () => none, some: (_$, key) => lookup(key) }), OptionType(driverType));
                if (field === undefined) {
                    return $.const({ rowIndex: check.index, row: entries.get(check.index), rows: entries, group: none, partial: batch.partial, driver, today: batch.today } as SubtypeExprOrValue<StructType>, ctxType);
                }
                const group = $.const(entries.get(check.index), entryDraft);
                const lines = $.const((group as ExprType<StructType>)[field] as ExprType<ArrayType<StructType>>);
                const line = $.const(check.line.unwrap("some"));
                return $.const({ rowIndex: line, row: lines.get(line), rows: lines, group: some(group), groups: entries, partial: batch.partial, driver, today: batch.today } as SubtypeExprOrValue<StructType>, ctxType);
            }) as unknown as ExprType<ArrayType<StructType>>;
        }
        // Loose rows between the groups (#846): the groups and the loose rows,
        // and each entry's index among the loose rows — counted once for the batch.
        const asEntries = entries as unknown as ExprType<ArrayType<EntryVariant>>;
        const groups = $.const(asEntries.filterMap((_$, entry) => entry.match({ group: (_$2, g) => some(g), row: () => none })) as unknown as ExprType<ArrayType<StructType>>, ArrayType(groupDraft));
        const looseRows = $.const(asEntries.filterMap((_$, entry) => entry.match({ row: (_$2, r) => some(r), group: () => none })) as unknown as ExprType<ArrayType<StructType>>, ArrayType(rowDraft));
        const looseAt = $.let([], ArrayType(IntegerType));
        const counted = $.let(0n);
        $.for(batch.rows, ($2, wire) => {
            $2(looseAt.pushLast(counted));
            $2.if(wire.band.hasTag("none"), ($3) => { $3.assign(counted, counted.add(1n)); });
        });
        return batch.checks.map(($, check) => {
            const driver = $.const(check.driver.match({ none: () => none, some: (_$, key) => lookup(key) }), OptionType(driverType));
            return check.line.match({
                none: ($2) => {
                    const at = $2.const(looseAt.get(check.index));
                    return $2.const({ rowIndex: at, row: looseRows.get(at), rows: looseRows, group: none, groups, partial: batch.partial, driver, today: batch.today } as SubtypeExprOrValue<StructType>, ctxType);
                },
                some: ($2, line) => {
                    const group = $2.const(asEntries.get(check.index).unwrap("group"), groupDraft);
                    const lines = $2.const(group[field] as ExprType<ArrayType<StructType>>);
                    return $2.const({ rowIndex: line, row: lines.get(line), rows: lines, group: some(group), groups, partial: batch.partial, driver, today: batch.today } as SubtypeExprOrValue<StructType>, ctxType);
                },
            });
        }) as unknown as ExprType<ArrayType<StructType>>;
    }) as unknown as SheetBridge["bridgeReady"];
}
