/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The typed bridge (`Sheet Spec.md` §4.8) — factory internals, both arms.
 *
 * Everything the author writes is typed over the host's row `R` and the
 * driver's row `D`; everything on the wire is closed. This module joins the
 * two with compiled East functions that capture only data, bind handles and
 * the author's functions:
 *
 * - `projectRow` — `R` → the wire cells (the same projection the row source
 *   uses, so `encode` and `make` cannot disagree);
 * - `rowById` — the REAL source row by id: the captured collection or bind
 *   handle on the inline arm, the source's `page` at the row's offset on the
 *   paged arm. Built ONCE per sheet and shared by every wrapper;
 * - `draftDecode` — current cells over the existing field draft, preserving
 *   hidden values and retaining missing/invalid input without domain defaults;
 * - `bridgeCtx` — the wire context to `Sheet.Types.DraftContext(R, D)`;
 * - `bridgeReady` — a readiness batch to one `DraftContext` per check, its
 *   rows built once (#882);
 * - the rule cells and sub rows (#844) — a column's `level` / `actual` /
 *   `detail` accessors and the `subRows` mappers, each compiled once and
 *   called inside the row projection;
 * - a row's cells at the day — each column from data's, every column's marks
 *   and each meter's max and tone (east-workspace#1730), read over the row's
 *   entry or its draft, so they follow the draft — and a column from data's
 *   writes (#1559, `data-bridge.ts`).
 *
 * It is built from the columns as pass 1 described them (`describe.ts`, its
 * facts `column-meta.ts`'s), and the author's typed functions are wrapped in
 * their wire twins over it — a fill provider, a proposer, an arity rule, a
 * member check, an options rule, a custom kind's parse / print
 * (`wrap-bridge.ts`).
 *
 * On a GROUPED sheet (#740) the source row is the group `P` and the columns
 * are declared over the line `L` its lines field holds: `projectRow` /
 * `draftRow` / the patch run over `L`, `rowById` returns the group, and the
 * group half of the bridge ({@link SheetGroupBridge}) projects the group's
 * summary cells and ordered children. Internal child keys preserve identity
 * during local editing; the author's child arrays remain positional. A
 * source with LOOSE rows between its groups (#846) holds entries
 * `Sheet.Types.Entry(P, "lines")`: `rowById` returns the entry, a draft is
 * the entry's draft, and a loose row decodes as a row of `L` whose id is its
 * own.
 *
 * The bridge's modules are the one place a string ever names a field: inside
 * the factory, against the column list it has already validated.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    Expr,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    isTypeEqual,
    none,
    some,
    type DateTimeType,
    type EastType,
    type ExprType,
    type FunctionType,
    type StructType,
    type SubtypeExprOrValue,
    type VariantType,
} from "@elaraai/east";

import {
    SheetLineType,
    SheetLinkType,
    SheetRowType,
    SheetSubRowType,
    SheetContextTypeFor,
    SheetCheckContextTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetGroupContextTypeFor,
    SheetGroupCheckContextTypeFor,
    sheetLinesOf,
    type SheetContextType,
    type SheetReadFromType,
    type SheetReadyBatchType,
} from "./types.js";
import type { SheetSubRowsValue } from "./sub-rows.js";
import { SheetMembersType, SheetRegisterMembersType } from "./link.js";
import { buildDraftRowDecoder, buildDraftGroupDecoder, buildDraftEntryDecoder } from "./draft-bridge.js";
import { buildDraftContextBridge, buildReadyContexts } from "./context-bridge.js";
import { SheetDraftTypeFor } from "./transactions.js";
import { dedupeMembers, type SheetDriverValue, type SheetRegisterValue } from "./registers.js";
import { buildCellsAt, buildWriteData } from "./data-bridge.js";
import { SheetCellsType, cellOfFieldValue, cellOfPayload, projectCell, type SheetColumnMeta } from "./column-meta.js";
import { keyOfTextOrNone } from "../schedule/window.js";

// ============================================================================
// The bridge
// ============================================================================

/**
 * The resolved source the bridge reads real rows from: an inline Array, a
 * record's whole Dict read in key order (#1182), or a paged source, its
 * windows read by key when they are keyed. `keyType` is a keyed source's key.
 */
export type SheetBridgeSource =
    | { kind: "inline"; rows: ExprType<ArrayType<StructType>> }
    | { kind: "keyed"; rows: ExprType<DictType<EastType, EastType>>; keyType: EastType }
    | { kind: "paged"; source: ExprType<StructType>; keyed: boolean; keyType?: EastType | undefined };

/**
 * The group half of a bridge (#740) — the group's summary cells and child rows on
 * the wire.
 *
 * @internal
 */
export interface SheetGroupBridge {
    /** The field holding the lines — an `Array<L>`, a line addressed by its index. */
    linesField: string;
    /** The band's cells, the title first. */
    cellMetas: SheetColumnMeta[];
    /** `P` → the band's cells. */
    projectGroupCells: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `P` → its wire lines, in order, keyed by source identity. */
    projectLines: ExprType<FunctionType<[StructType], ArrayType<SheetLineType>>>;
    /** The group's row type `P` — the source row's, or on a source with loose rows its entries' group arm (#846). */
    groupType: StructType;
    /** Whether the source holds loose rows between its groups — entries `Sheet.Types.Entry(P, "lines")` (#846). */
    loose: boolean;
    /** A group's cells and lines over its `DraftGroup(P, "lines")` — the whole `draftDecode` without loose rows. */
    decodeGroup: ExprType<FunctionType<[SheetRowType, OptionType<StructType>, OptionType<SheetRowType>], StructType>>;
    /** A loose row's cells over its `Draft(L)`, its id field written from the row's id (#846). */
    decodeLoose?: ReturnType<typeof buildDraftRowDecoder> | undefined;
}

/**
 * The compiled bridge of one sheet — every wire function the root stores is
 * built from these.
 *
 * @remarks
 * `rowType` is the SOURCE row's type — the host's row on a flat sheet, the
 * group's on a grouped one, the entry `Sheet.Types.Entry(P, "lines")` on one
 * with loose rows (#846) — and `lineType` the type the columns are declared
 * over: the same type on a flat sheet, the line type on a grouped one. The
 * patch, the proposal, `projectRow` and `draftRow` run over `lineType`;
 * `rowById` and the edit type over `rowType`.
 *
 * @internal
 */
export interface SheetBridge {
    /** The source row's type — the host's row, the group's, or an entry of groups and loose rows. */
    rowType: EastType;
    /** The type the columns are declared over — the row, or the line. */
    lineType: StructType;
    /** The driver's row type (`NullType` without a driver). */
    driverType: EastType;
    /** `Sheet.Types.DraftContext(R, D)` — or `Context(P, "lines", D)` on a grouped sheet. */
    ctxType: StructType;
    /** `Sheet.Types.CheckContext(R)` — or `CheckContext(P, "lines")`. */
    checkCtxType: StructType;
    /** `Sheet.Types.Patch(L)`. */
    patchType: StructType;
    /** `Sheet.Types.Proposal(L)`. */
    proposalType: StructType;
    /** Constructor defaults, including read-only cells. */
    seedCells: SheetBridge["encodePatch"];
    /** `L` → the wire cells. */
    projectRow: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `L` → its sub rows, sources in declaration order (#844; `[]` without `subRows`). */
    projectSubRows: ExprType<FunctionType<[StructType], ArrayType<SheetSubRowType>>>;
    /** Decode one row into its complete field draft. */
    draftRow: ReturnType<typeof buildDraftRowDecoder>;
    /** Decode edited cells into the source row's draft, preserving the previous child identities. */
    draftDecode: ExprType<FunctionType<[SheetRowType, OptionType<EastType>, OptionType<SheetRowType>], EastType>>;
    /** `(id, offset)` → the real source row. */
    rowById: ExprType<FunctionType<[StringType, IntegerType], OptionType<EastType>>>;
    /** The wire context → the typed context. */
    bridgeCtx: ExprType<FunctionType<[SheetContextType], StructType>>;
    /** A readiness batch → one typed context per check, over rows built once (#882). */
    bridgeReady: ExprType<FunctionType<[typeof SheetReadyBatchType], ArrayType<StructType>>>;
    /** `Sheet.Types.Patch(L)` → the set fields as cells. */
    encodePatch: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** The group half — present on a grouped sheet. */
    group?: SheetGroupBridge;
    /** A row's cells at a day, over its draft or its entry: each column from data's, and every column's marks — present where a column reads any. */
    cellsAt?: ExprType<FunctionType<[typeof SheetReadFromType, DateTimeType], typeof SheetCellsType>>;
    /** A gesture's writes through the columns from data — its wire cells, the draft before it, the draft its cells decode to, and the day → the draft — present where a column from data writes. */
    writeData?: ExprType<FunctionType<[typeof SheetCellsType, OptionType<StructType>, StructType, DateTimeType], StructType>>;
}

/** The group declaration the bridge needs from the root (#740). */
export interface SheetBridgeGroupInput {
    /** The field holding the lines. */
    linesField: string;
    /** The band's cells, the title first. */
    cellMetas: SheetColumnMeta[];
}

/**
 * Binds a function once in the block a sheet is built in, and answers the
 * variable that names it there.
 *
 * @remarks
 * A wire function the root builds — a column's fill provider, a rule, a
 * check, the draft context — writes out in full every function of the
 * bridge it calls, and a sheet builds dozens of them, so a bridge written
 * into each would make a program many times the size it needs to be. Each of
 * the bridge's functions held once, the wire functions built after refer to
 * the block's variable instead. A sheet built in no block holds nothing.
 *
 * @internal
 */
export type SheetHold = <T extends EastType>(value: ExprType<T>) => ExprType<T>;

/** What the bridge needs from the root. */
export interface SheetBridgeInput {
    /** The source row's type — a struct, or on a source with loose rows the entry variant (#846). */
    rowType: EastType;
    idField: string | undefined;
    metas: SheetColumnMeta[];
    /** The columns from data: a row carries their rule cells over the row alone — a detail, a date's level and actual —
     *  never a member's cell, which is read at the Record's day. */
    dataMetas?: readonly SheetColumnMeta[];
    registers: Record<string, SheetRegisterValue>;
    driver: SheetDriverValue | undefined;
    source: SheetBridgeSource;
    group?: SheetBridgeGroupInput;
    subRows?: SheetSubRowsValue<StructType>;
    /** Binds each of the bridge's functions once in the block the sheet is
     *  built in ({@link SheetHold}); the functions are written where they are
     *  used without one. */
    hold?: SheetHold;
}

/**
 * The id of a row — the id field; on a source with loose rows (#846) the id
 * field of whichever arm the entry holds.
 */
function idOf(r: ExprType<EastType>, idField: string | undefined): ExprType<StringType> {
    if (idField === undefined) throw new Error("Sheet: a positional source needs `id` — the String field that identifies a row");
    if (Expr.type(r as Expr<EastType>).type === "Variant") {
        return (r as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>).match({
            group: (_$, g) => (g as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>,
            row: (_$, l) => (l as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>,
        });
    }
    return (r as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>;
}

/** A source of LOOSE rows between groups (#846): the entry variant `Sheet.Types.Entry(P, "lines")`. @internal */
export type SheetEntryVariant = VariantType<{ group: StructType; row: StructType }>;

/**
 * Compile the bridge for one sheet.
 *
 * @param input - The root's resolved declaration
 * @returns The bridge
 */
export function buildBridge(input: SheetBridgeInput): SheetBridge {
    const { rowType, idField, metas, registers, driver, source, group: groupInput, subRows } = input;
    // Each function held as it is built, so every one built after refers to it.
    const hold: SheetHold = input.hold ?? ((value) => value);
    const driverType: EastType = driver !== undefined ? driver.rowType : NullType;
    // A grouped sheet's columns are declared over the LINE type; its source
    // rows are groups — or, with loose rows between them (#846), entries of a
    // group or a row of the line type. A flat sheet's line type is its row type.
    const loose = rowType.type === "Variant";
    const groupType = loose ? (rowType as SheetEntryVariant).cases.group : rowType as StructType;
    const shape = groupInput !== undefined ? sheetLinesOf(groupType, groupInput.linesField) : undefined;
    const lineType = shape?.lineType ?? groupType;
    const lineIdField = shape === undefined ? idField : undefined;
    const ctxType = (groupInput !== undefined
        ? SheetGroupContextTypeFor(groupType, groupInput.linesField as never, driverType)
        : SheetContextTypeFor(lineType, driverType)) as unknown as StructType;
    const checkCtxType = (groupInput !== undefined
        ? SheetGroupCheckContextTypeFor(groupType, groupInput.linesField as never)
        : SheetCheckContextTypeFor(lineType)) as unknown as StructType;
    const patchType = SheetPatchTypeFor(lineType) as unknown as StructType;
    const proposalType = SheetProposalTypeFor(lineType) as unknown as StructType;
    // L → the wire cells. Registers are bound ONCE per body for the String
    // link form (the capture rule: data, never a spliced expression).
    const stringFormRegisters = [...new Set(metas.filter((m) => m.form === "string" && m.register !== undefined).map((m) => m.register!))];
    const projectRow = hold(East.function([lineType], SheetCellsType, ($, r) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!.members, SheetRegisterMembersType));
        }
        for (const m of metas) {
            $(cells.insert(m.key, projectCell(m, r, m.register !== undefined ? bound.get(m.register) : undefined)));
            for (const rc of m.ruleCells ?? []) {
                const rule = $.const(rc.fn);
                $(cells.insert(rc.key, cellOfFieldValue(rc.tag, rule(r), rc.optional)));
            }
        }
        for (const m of input.dataMetas ?? []) {
            for (const rc of m.ruleCells ?? []) {
                const rule = $.const(rc.fn);
                $(cells.insert(rc.key, cellOfFieldValue(rc.tag, rule(r), rc.optional)));
            }
        }
        return cells;
    })) as unknown as SheetBridge["projectRow"];
    const projectSubRows = hold(buildSubRowProjection(lineType, subRows));

    // (id, offset) → the real source row. Inline, the row at its offset
    // answers first — the renderer reads a resident row where it sits — and
    // otherwise the nearest match outward from there, so a row that a local
    // edit shifted is found in the steps it moved: a read is never a scan of
    // the collection, which made every context and every readiness check
    // quadratic in the rows (#859). The search starts inside the rows, so a
    // stale offset still finds the row. A keyed source — a record read whole
    // (#1182), or a keyed window — reads the row by its key.
    // A row's id is its key's text, as `Record.onApply` reads it; a text naming no key of the type names no row.
    const pagedKeyOf = source.kind === "paged" && source.keyed && source.keyType !== undefined && source.keyType.type !== "String"
        ? keyOfTextOrNone(source.keyType) : undefined;
    const rowById = hold((source.kind === "keyed"
        ? East.function([StringType, IntegerType], OptionType(rowType), ($, id, _offset) => {
            const rows = $.const(source.rows, DictType(source.keyType, rowType));
            const keyOf = $.const(keyOfTextOrNone(source.keyType));
            return keyOf(id).match({
                none: (_$2) => East.value(none, OptionType(rowType)),
                some: (_$2, key) => rows.tryGet(key),
            });
        })
        : source.kind === "inline"
        ? East.function([StringType, IntegerType], OptionType(rowType), ($, id, offset) => {
            const rows = $.const(source.rows as ExprType<ArrayType<EastType>>, ArrayType(rowType));
            const size = $.let(rows.size());
            const start = $.let(offset.less(0n).ifElse(() => 0n, () => offset.greaterEqual(size).ifElse(() => size.subtract(1n), () => offset)));
            const step = $.let(0n);
            $.while(start.subtract(step).greaterEqual(0n).or(() => start.add(step).less(size)), ($2) => {
                const below = $2.let(start.subtract(step));
                $2.if(below.greaterEqual(0n), ($3) => {
                    const r = $3.let(rows.get(below));
                    $3.if(idOf(r, idField).equal(id), ($4) => { $4.return(East.value(some(r), OptionType(rowType))); });
                });
                const above = $2.let(start.add(step));
                $2.if(step.greater(0n).and(() => above.less(size)), ($3) => {
                    const r = $3.let(rows.get(above));
                    $3.if(idOf(r, idField).equal(id), ($4) => { $4.return(East.value(some(r), OptionType(rowType))); });
                });
                $2.assign(step, step.add(1n));
            });
            return East.value(none, OptionType(rowType));
        })
        : East.function([StringType, IntegerType], OptionType(rowType), ($, id, offset) => {
            const src = $.const(source.source as unknown as ExprType<StructType<{ page: FunctionType<[IntegerType, IntegerType], OptionType<EastType>> }>>);
            const noRow = $.const(none, OptionType(rowType));
            const keyOf = pagedKeyOf !== undefined ? $.const(pagedKeyOf) : undefined;
            return src.page(offset, 1n).match({
                none: (_$) => noRow,
                some: (_$, win) => !source.keyed
                    ? (win as unknown as ExprType<ArrayType<EastType>>).firstMap((_$2, r) => idOf(r, idField).equal(id).ifElse(
                        (_$3) => East.value(some(r), OptionType(rowType)),
                        (_$3) => East.value(none, OptionType(rowType)),
                    ))
                    : keyOf === undefined
                        ? (win as unknown as ExprType<DictType<StringType, EastType>>).tryGet(id)
                        : keyOf(id).match({
                            none: (_$2) => noRow,
                            some: (_$2, key) => (win as unknown as ExprType<DictType<EastType, EastType>>).tryGet(key),
                        }),
            });
        })) as unknown as SheetBridge["rowById"]);

    // The driver lookup — the driver data folded once into a dictionary; a
    // driverless sheet's lookup is always `none` (its `D` is `Null`).
    const lookupDriver = hold(driver !== undefined
        ? East.function([StringType], OptionType(driverType), ($, k) => {
            const dict = $.const(
                driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => d),
                DictType(StringType, driverType),
            );
            return dict.tryGet(k);
        })
        : East.function([StringType], OptionType(driverType), ($, _k) => $.const(none, OptionType(driverType))));

    // The drafts: a line's cells over its draft (no id — a line's identity is
    // its place), and on a source with loose rows (#846) a loose row's, whose
    // id field is its own.
    // On a sheet with an action column, a read-only cell is read back too: an action's `updates` writes any field (#1477).
    const written = metas.some((m) => m.action !== undefined);
    const draftRow = hold(buildDraftRowDecoder(lineType, metas, registers, lineIdField, written));
    const looseRow = loose ? hold(buildDraftRowDecoder(lineType, metas, registers, idField, written)) : undefined;
    const decodeGroup = groupInput !== undefined
        ? hold(buildDraftGroupDecoder(groupType, groupInput.linesField, groupInput.cellMetas, draftRow, registers, idField, written))
        : undefined;
    const flatDraft = SheetDraftTypeFor(groupType) as StructType;
    const draftDecode = (decodeGroup === undefined
        ? hold(East.function([SheetRowType, OptionType(flatDraft), OptionType(SheetRowType)], flatDraft, ($, row, base, _previous) => {
            const decode = $.const(draftRow);
            return decode(row.id, row.cells, base);
        }))
        : looseRow !== undefined && groupInput !== undefined
            ? hold(buildDraftEntryDecoder(rowType as SheetEntryVariant, groupInput.linesField, decodeGroup, looseRow))
            : decodeGroup) as unknown as SheetBridge["draftDecode"];

    // The group half (#740).
    const groupProjections = groupInput !== undefined ? buildGroupBridge(groupType, groupInput, projectRow, projectSubRows) : undefined;
    const group = groupInput !== undefined && groupProjections !== undefined && shape !== undefined && decodeGroup !== undefined
        ? {
            ...groupProjections,
            projectGroupCells: hold(groupProjections.projectGroupCells),
            projectLines: hold(groupProjections.projectLines),
            groupType, loose, decodeGroup, decodeLoose: looseRow,
        }
        : undefined;

    const bridgeCtx = hold(buildDraftContextBridge(rowType, lineType, groupInput?.linesField, ctxType, driverType,
        rowById, draftDecode, draftRow, lookupDriver, looseRow));
    const bridgeReady = hold(buildReadyContexts(rowType, groupInput?.linesField, ctxType, driverType,
        rowById, draftDecode, lookupDriver, loose));

    // The columns from data, every column's marks (#1559) and each meter's max and tone (east-workspace#1730): read at the
    // Record's day over a row's draft or its entry, and a gesture's edits to the columns from data written over the draft —
    // a flat row's, as a Record's rows are.
    const dataMetas = input.dataMetas ?? [];
    const marked = metas.some((m) => m.mark !== undefined);
    if ((dataMetas.length > 0 || marked) && groupInput !== undefined) {
        throw new Error("Sheet: columns from data and marks are read over a flat row's draft — a grouped sheet draws neither");
    }
    const metered = metas.some((m) => m.meter !== undefined);
    if (metered && groupInput !== undefined) {
        throw new Error("Sheet: a meter's max and tone are read over a flat row's draft — a grouped sheet draws no meter");
    }
    // Each register columns from data are made from, its members once in the sheet's block: one column per key — and,
    // where they are keyed by another type than String, their keys at it, as the columns' functions take a member's key
    // (east-workspace#1747), each read back from the text it was printed as.
    const members = new Map(dataMetas.flatMap((m) => m.data?.from === "register" ? [m.data.register] : [])
        .map((name) => [name, hold(dedupeMembers(registers[name]!.members))] as const));
    const memberKeys = new Map([...members].flatMap(([name, held]) => {
        const keyType = registers[name]!.keyType;
        return keyType.type === "String" ? [] : [[name, hold(held.map((_$, member) => member.key.parse(keyType)) as ExprType<ArrayType<EastType>>)] as const];
    }));
    const cellsAt = dataMetas.length > 0 || marked || metered ? hold(buildCellsAt(lineType, metas, dataMetas, members, memberKeys)) : undefined;
    const writes = buildWriteData(lineType, dataMetas, members, memberKeys);
    const writeData = writes !== undefined ? hold(writes) : undefined;

    return {
        rowType, lineType, driverType, ctxType, checkCtxType, patchType, proposalType,
        projectRow, projectSubRows, draftDecode, draftRow, rowById,
        bridgeCtx: bridgeCtx as unknown as SheetBridge["bridgeCtx"],
        bridgeReady,
        encodePatch: hold(buildPatchCells(lineType, metas, registers)),
        seedCells: hold(buildPatchCells(lineType, metas, registers, false)),
        ...(group !== undefined ? { group } : {}),
        ...(cellsAt !== undefined ? { cellsAt } : {}),
        ...(writeData !== undefined ? { writeData } : {}),
    };
}

/** Project supplied constructor/proposal fields without inventing a complete row. @internal */
export function buildPatchCells(rowType: StructType, metas: readonly SheetColumnMeta[], registers: Record<string, SheetRegisterValue>, editableOnly = true): SheetBridge["encodePatch"] {
    const patchType = SheetPatchTypeFor(rowType) as StructType;
    const fields = rowType.fields;
    const stringFormRegisters = [...new Set(metas.filter(m => m.form === "string" && m.register !== undefined).map(m => m.register!))];
    return East.function([patchType], SheetCellsType, ($, patch) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const p = patch as unknown as Record<string, ExprType<OptionType<EastType>>>;
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!.members, SheetRegisterMembersType));
        }
        for (const m of metas) {
            if ((editableOnly && !m.editable) || m.derived !== undefined) continue;
            if (m.form === "array") {
                // The other half is `none` when the column names no other field.
                const otherKey = m.otherField;
                const own = $.let(p[m.field] as never, OptionType(SheetMembersType));
                const other = $.let((otherKey !== undefined ? p[otherKey] : none) as never, OptionType(SheetMembersType));
                $.if(own.hasTag("some").or(() => other.hasTag("some")), ($2) => {
                    const empty = $2.const([], SheetMembersType);
                    const ownVal = $2.let(own.match({ some: (_$, v) => v, none: (_$) => empty }), SheetMembersType);
                    const otherVal = $2.let(other.match({ some: (_$, v) => v, none: (_$) => empty }), SheetMembersType);
                    const link = m.ownHalf === "from"
                        ? $2.let({ from: ownVal, to: otherVal }, SheetLinkType)
                        : $2.let({ from: otherVal, to: ownVal }, SheetLinkType);
                    $2(cells.insert(m.key, cellOfPayload("Link", link as unknown as ExprType<EastType>)));
                });
                continue;
            }
            const field = $.let(p[m.field] as never, OptionType(fields[m.field] as EastType));
            $.if(field.hasTag("some"), ($2) => {
                const v = $2.let(field.unwrap("some") as never, fields[m.field] as EastType);
                const asRow = { [m.field]: v } as unknown as ExprType<StructType>;
                $2(cells.insert(m.key, projectCell(m, asRow, m.register !== undefined ? bound.get(m.register) : undefined)));
            });
        }
        return cells;
    }) as unknown as SheetBridge["encodePatch"];
}

// ============================================================================
// Sub rows (#844)
// ============================================================================

/**
 * Compile the sub-row sources into one projection over the line type: each
 * mapper is compiled ONCE as `East.function([L, T], SubRow)` and called in
 * an eager map over its field; the sources concatenate in declaration order.
 *
 * @param lineType - The type the columns are built over
 * @param subRows - The `subRows` declaration, if any
 * @returns `L` → its sub rows
 * @throws Error when the declaration was built over another type, or a key is not an array field
 */
export function buildSubRowProjection(lineType: StructType, subRows: SheetSubRowsValue<StructType> | undefined): SheetBridge["projectSubRows"] {
    const fields = lineType.fields as Record<string, EastType>;
    const mappers: { field: string; fn: ExprType<FunctionType<[StructType, EastType], SheetSubRowType>> }[] = [];
    if (subRows !== undefined) {
        if (!isTypeEqual(subRows.rowType, lineType)) {
            throw new Error("Sheet: `subRows` was built over a different type than the columns — pass the columns' type (a grouped sheet: the line type) to `Sheet.subRows(…)`");
        }
        for (const [field, map] of Object.entries(subRows.sources as Record<string, ((item: ExprType<EastType>, row: ExprType<StructType>) => SubtypeExprOrValue<SheetSubRowType>) | undefined>)) {
            if (map === undefined) continue;
            const t = fields[field] as { type?: string; value?: EastType } | undefined;
            if (t === undefined || t.type !== "Array" || t.value === undefined) {
                throw new Error(`Sheet: \`subRows\` names "${field}", which is ${t === undefined ? "not a field of the row type" : `a ${t.type} field`} — a sub-row source must be an Array field`);
            }
            mappers.push({ field, fn: East.function([lineType, t.value], SheetSubRowType, (_$, row, item) => map(item, row)) });
        }
    }
    return East.function([lineType], ArrayType(SheetSubRowType), ($, r) => {
        const row = r as unknown as Record<string, ExprType<ArrayType<EastType>>>;
        let all: ExprType<ArrayType<SheetSubRowType>> = $.const([], ArrayType(SheetSubRowType));
        for (const m of mappers) {
            const map = $.const(m.fn);
            const part = $.let(row[m.field]!.map((_$2, x) => map(r, x)), ArrayType(SheetSubRowType));
            all = mappers[0] === m ? part : $.let(all.concat(part), ArrayType(SheetSubRowType));
        }
        return all;
    }) as unknown as SheetBridge["projectSubRows"];
}

// ============================================================================
// The group half (#740)
// ============================================================================

/**
 * Compile a group's summary cells and ordered children into wire rows.
 *
 * @param rowType - The group's row type
 * @param input - The child field and summary cell metadata
 * @param projectRow - Child row to wire cells
 * @param projectSubRows - Child row to its sub rows
 * @returns The group half
 */
function buildGroupBridge(
    rowType: StructType,
    input: SheetBridgeGroupInput,
    projectRow: SheetBridge["projectRow"],
    projectSubRows: SheetBridge["projectSubRows"],
): Pick<SheetGroupBridge, "linesField" | "cellMetas" | "projectGroupCells" | "projectLines"> {
    const { linesField, cellMetas } = input;
    const linesType = rowType.fields[linesField] as ArrayType<StructType>;
    const projectGroupCells = East.function([rowType], SheetCellsType, ($, p) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        for (const m of cellMetas) $(cells.insert(m.key, projectCell(m, p, undefined)));
        return cells;
    }) as SheetGroupBridge["projectGroupCells"];
    const projectLines = East.function([rowType], ArrayType(SheetLineType), ($, p) => {
        const project = $.const(projectRow);
        const subRowsOf = $.const(projectSubRows);
        const lines = $.const(p[linesField] as ExprType<ArrayType<StructType>>, linesType);
        return lines.map((_$, line, index) => East.value({ key: East.print(index), cells: project(line), subRows: subRowsOf(line) }, SheetLineType));
    }) as SheetGroupBridge["projectLines"];
    return { linesField, cellMetas, projectGroupCells, projectLines };
}
