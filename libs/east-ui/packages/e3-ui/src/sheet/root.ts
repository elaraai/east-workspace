/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sheet's root — assembles the grid's whole root ({@link SheetRootType},
 * `Sheet Spec.md` §4.6), which `<Sheet>`'s payload carries (`sheet.ts`):
 * resolves the row source (both arms), describes every column against the
 * row type (`describe.ts`), compiles the typed bridge (§4.8, `bridge.ts`),
 * builds each column's wire value (its kind, `column-kind.ts`), compiles
 * `onUpdate` into the checked batch adapter (§4.7), and refuses every mistake
 * naming the column and the remedy. The options it reads are `options.ts`'s.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type StructType,
    type SubtypeExprOrValue,
    type VariantType,
    East,
    Expr,
    ArrayType,
    BooleanType,
    DictType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    isTypeEqual,
    printType,
    toEastTypeValue,
    some,
    none,
} from "@elaraai/east";

import { DensityType, StatusValueType } from "@elaraai/east-ui";
import {
    CarriedEntryType,
    RecordSlicesChromeType,
    buildCarriedRowSource,
    resolveRowSource,
    resolveTag,
    type DataRowType,
    type PagedSource,
} from "@elaraai/east-ui/internal";
import {
    SheetRootType,
    SheetRowType,
    SheetRowsCollectionType,
    SheetRegisterType,
    SheetDriverType,
    SheetColumnType,
    SheetSuggestType,
    SheetRecordViewType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetNarrowType,
    SheetGroupType,
    SheetGroupCellType,
    SheetNounType,
    SheetMarkCellsType,
    SHEET_TITLE_CELL,
    sheetLinesOf,
    type SheetLinesField,
    type SheetLineOf,
    type SheetEntryOf,
} from "./types.js";
import { buildBridge, type SheetBridge, type SheetHold } from "./bridge.js";
import type { SheetColumnMeta } from "./column-meta.js";
import { describeColumn, describeGroupCell } from "./describe.js";
import { wrapProposer, wrapProvider } from "./wrap-bridge.js";
import { buildKind, optionOf, ruleCellKey } from "./column-kind.js";
import type { SheetColumn, SheetColumnSpec } from "./columns.js";
import { RECORD_COLUMN_KINDS } from "./record-columns.js";
import { dedupeMembers, groupMembers, type SheetRegisterValue } from "./registers.js";
import type { SheetAnyOptions, SheetEntriesOptions, SheetGroupedOptions, SheetIndexedOptions, SheetOptions } from "./options.js";
import { buildSheetEditing } from "./editing-bridge.js";
import { unsettableFields } from "./fields.js";
import { orderedRowSource, type OrderedRowSource } from "../utils/ordered-source.js";
import { scheduleLastKey } from "../schedule/window.js";
import { checkOneKeyRule, newKeyOf } from "../utils/record-kind.js";

// ============================================================================
// What only e3-ui's own factories pass, and a handle of rows
// ============================================================================

/**
 * What only e3-ui's own factories pass a sheet's root, never an author's prop
 * (#1182): a record's rows, as `<Sheet record>` reads them, and the
 * narrowing's chrome `<Sheet slice>` checked (#1345).
 *
 * @internal
 */
export interface SheetInternalOptions {
    /** The rows are a record's whole Dict, read in key order: a keyed inline source, as a keyed paged one is. */
    keyOrdered?: boolean;
    /** The Apply over the session's keyed batches as they come, `ChangeSet(R, K)`: a record's `Record.onApply(record, { keyed: true })`. */
    applyKeyed?: unknown;
    /** The session's source identity, when the factory names it: a record, or one entry of it, or the `rows` source's record. */
    sourceId?: SubtypeExprOrValue<StringType>;
    /** The narrowing's chrome: one rail over the sheet's `Slice.bindRecords`, checked by `<Sheet>`. */
    slice?: SubtypeExprOrValue<OptionType<RecordSlicesChromeType>>;
    /** Binds each of the bridge's functions once in the block the sheet is built in, for every wire function built
     *  from it to refer to (`<Sheet>`'s block); without it each is written where it is used. */
    hold?: SheetHold;
    /** The columns may be the Record's kinds — title, person, boolean, toggle, cycle, age, audit — which only the Record's grid draws: `<Record>`'s build. */
    recordKinds?: boolean;
    /** The inspector's hints, when `<Sheet>` shows the pane — `fields` a row's, `groupFields` a group's: what its form lets a person set on a new entry (#1536). Left out, the sheet has no inspector. */
    inspector?: { fields?: Readonly<Record<string, unknown>> | undefined; groupFields?: Readonly<Record<string, unknown>> | undefined };
    /**
     * The field of a record's entries — its rows, a grouped sheet's groups — that holds each one's key, checked against
     * the record (`<Sheet record keyField>`): the session keeps a new entry's key in it, so no person sets it and no
     * constructor need give it.
     */
    keyField?: string | undefined;
    /**
     * A record's entry's key, built from the entry by the app (`<Sheet record rowKey>`): the sheet makes a new entry — a
     * row, a grouped sheet's group — under the key its entry builds, and moves an entry to another as an edit changes
     * what its key reads. One way a new entry's key is decided, the sheet's `newKey` the other: never both.
     */
    rowKey?: unknown;
}

/** A whole-value bind handle (`State.bind` / `Data.bind`) over `Array<R>` — accepted as `data`; `R` a row struct, or an entry `Sheet.Types.Entry(P, "lines")` (#846). */
export interface SheetBindHandle<R extends EastType> {
    /** The handle's read. */
    read: (...args: never[]) => ExprType<ArrayType<R>>;
}

// ============================================================================
// Root
// ============================================================================

/**
 * Creates the sheet's root alone — the grid, its rows and its session
 * ({@link SheetRootType}) that `<Sheet>`'s payload carries — for the root's
 * own specs, which read it whole. It takes the rows, the columns and the
 * sheet's own options as `<Sheet data>` takes them, form for form, and
 * refuses what `<Sheet>` refuses of them.
 *
 * @remarks
 * `id` is required on a positional source. `onUpdate` is refused on the
 * paged arm; edit paged rows with onApply over a pinned source — one that
 * names its snapshot (`Data.bindPaged`'s handle). A `Dict` inline is refused:
 * a sorted map would sit rows in key order, not the planner's.
 *
 * With `group` (#740) the rows are GROUPS: `columns` are declared over the
 * line type the group's lines field holds, `onUpdate` rebuilds the groups
 * with their lines inside. onPatch observes one gesture; onApply confirms an
 * atomic checked batch. Rows of the line type may stand between the groups
 * (#846): pass entries `Sheet.Types.Entry(GroupType, "lines")` — a group, or
 * a LOOSE row, drawn as a plain row numbered in the groups' sequence — with
 * an `id` that both types carry.
 *
 * @param data - The rows: an `Array<R>` value or expression, a whole-value bind handle, or a paged source
 * @param columns - The columns, keyed by the row's fields ({@link SheetColumnSpec})
 * @param options - Everything else ({@link SheetOptions})
 * @returns An East expression of {@link SheetRootType}
 * @internal
 */
export function createSheetRoot<P extends StructType, F extends SheetLinesField<P>>(
    data: NoInfer<SubtypeExprOrValue<ArrayType<SheetEntryOf<P, F>>> | SheetBindHandle<SheetEntryOf<P, F>> | PagedSource<ArrayType<SheetEntryOf<P, F>>> | PagedSource<DictType<StringType, SheetEntryOf<P, F>>>>,
    columns: SheetColumnSpec<SheetLineOf<P, F>>,
    options: SheetEntriesOptions<P, F>,
): ExprType<SheetRootType>;
/** GROUPED rows — an `Array<P>` value or expression of groups. */
export function createSheetRoot<T extends SubtypeExprOrValue<ArrayType<StructType>>, F extends SheetLinesField<DataRowType<T>>>(
    data: T,
    columns: SheetColumnSpec<SheetLineOf<DataRowType<T>, F>>,
    options: SheetGroupedOptions<DataRowType<T>, F>,
): ExprType<SheetRootType>;
/** GROUPED rows over a whole-value bind handle of groups. */
export function createSheetRoot<P extends StructType, F extends SheetLinesField<P>>(
    data: SheetBindHandle<P>,
    columns: SheetColumnSpec<SheetLineOf<P, F>>,
    options: SheetGroupedOptions<P, F>,
): ExprType<SheetRootType>;
/** GROUPED rows over a paged source of groups. */
export function createSheetRoot<P extends StructType, F extends SheetLinesField<P>>(
    data: PagedSource<ArrayType<P>> | PagedSource<DictType<StringType, P>>,
    columns: SheetColumnSpec<SheetLineOf<P, F>>,
    options: SheetGroupedOptions<P, F>,
): ExprType<SheetRootType>;
/** The inline arm — an `Array<R>` value or expression. */
export function createSheetRoot<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    columns: SheetColumnSpec<DataRowType<T>>,
    options: SheetOptions<DataRowType<T>>,
): ExprType<SheetRootType>;
/** A whole-value bind handle retains its live reader for atomic onUpdate. */
export function createSheetRoot<R extends StructType>(
    data: SheetBindHandle<R>,
    columns: SheetColumnSpec<R>,
    options: SheetOptions<R>,
): ExprType<SheetRootType>;
/** The PAGED arm — positional (`Array<R>` windows) or keyed (`Dict<String, R>` windows, the key is the id). */
export function createSheetRoot<R extends StructType>(
    data: PagedSource<ArrayType<R>> | PagedSource<DictType<StringType, R>>,
    columns: SheetColumnSpec<R>,
    options?: SheetOptions<R>,
): ExprType<SheetRootType>;
/** Indexed windows retain their secondary order and edit by original primary key. */
export function createSheetRoot<K extends EastType, R extends StructType, P extends EastType, IK extends EastType>(
    data: OrderedRowSource<K, R, P, IK>, columns: SheetColumnSpec<R>, options?: SheetIndexedOptions<K, R>,
): ExprType<SheetRootType>;
export function createSheetRoot(
    data: unknown,
    columns: unknown,
    options?: unknown,
): ExprType<SheetRootType> {
    return heldRoot(data, columns, options, {});
}

/**
 * Creates a sheet's root with the options only e3-ui's own factories pass
 * (#1182): what {@link createSheetRoot} builds, with a record's whole Dict
 * read in key order, the keyed Apply that commits to it, and the session's
 * source identity.
 *
 * @param data - The rows, as {@link createSheetRoot} takes them; with `keyOrdered`, a Dict or a bind handle of one
 * @param columns - The columns, keyed by the row's fields
 * @param options - The sheet's options, as {@link createSheetRoot} takes them
 * @param internal - The factory's own options
 * @returns An East expression of {@link SheetRootType}
 * @throws Error for everything {@link createSheetRoot} refuses, and for a key-ordered sheet over anything but a Dict
 * @internal
 */
export function createSheetRootWith(
    data: unknown,
    columns: unknown,
    options: unknown,
    internal: SheetInternalOptions,
): ExprType<SheetRootType> {
    return heldRoot(data, columns, options, internal);
}

/**
 * A sheet's root, built in a block of its own that holds each of its bridge's
 * functions once ({@link SheetHold}): a root built alone has no block of its
 * caller's to hold them in.
 */
function heldRoot(data: unknown, columns: unknown, options: unknown, internal: SheetInternalOptions): ExprType<SheetRootType> {
    return Expr.block(($) => {
        const hold = internal.hold ?? (<T extends EastType>(value: ExprType<T>): ExprType<T> => $.const(value) as ExprType<T>);
        return buildSheet(data, columns, options, { ...internal, hold }).root;
    }) as ExprType<SheetRootType>;
}

/**
 * One build of a sheet: its root, and the bridge it was compiled with —
 * what `<Sheet>` builds its templates' seeds and cards over (#1183), so a
 * template's draft and the cells its card shows come from the very code
 * `newRow`'s do.
 *
 * @internal
 */
export interface SheetBuild {
    /** The sheet's root. */
    root: ExprType<SheetRootType>;
    /** The typed bridge the root was compiled with. */
    bridge: SheetBridge;
    /** The declared columns, each described against the type they are declared over — the row, or a grouped sheet's line: what the inspector reads its fields through (#1188). A column from data is among `data` instead. */
    metas: readonly SheetColumnMeta[];
    /** The columns from data, described: each a family of wire columns, one per member of a register or field of a struct. */
    data: readonly SheetColumnMeta[];
    /** The registers' names — the declared ones, and the driver's under its column: what a `reference` hint in the inspector may name (#1188). */
    registers: readonly string[];
    /** A keyed source's key type — a record's own, a keyed paged source's String — whose rows' ids are its keys' text; `undefined` for an Array source, whose rows are keyed by their id field (#1409). */
    keyType: EastType | undefined;
    /** The field of a record's entries that holds each one's key, where the sheet was told one ({@link SheetInternalOptions.keyField}). */
    keyField: string | undefined;
}

/**
 * Builds a sheet for `<Sheet>` (#1183): {@link createSheetRootWith}'s root,
 * with the bridge it was compiled with.
 *
 * @param data - The rows, as {@link createSheetRootWith} takes them
 * @param columns - The columns, keyed by the row's fields
 * @param options - The sheet's options
 * @param internal - The factory's own options
 * @returns The root and its bridge
 * @throws Error for everything {@link createSheetRootWith} refuses
 * @internal
 */
export function createSheetBuild(
    data: unknown,
    columns: unknown,
    options: unknown,
    internal: SheetInternalOptions,
): SheetBuild {
    return buildSheet(data, columns, options, internal);
}

/** The sheet's payload and its bridge, built and checked. */
function buildSheet(
    data: unknown,
    columns: unknown,
    options?: unknown,
    internal: SheetInternalOptions = {},
): SheetBuild {
    const opts = (options ?? {}) as SheetAnyOptions;
    // The removed options, named (#1536) — a plain JS caller would otherwise lose them silently; a Record names them as its own.
    if ("applyMode" in opts) {
        throw new Error("Sheet: `applyMode` is removed (#1536) — every edit waits for Save: the changes are drafts, undone, redone, discarded or saved together");
    }
    if ("newRowId" in opts) {
        throw new Error("Sheet: `newRowId` is removed (#1536) — a new row's key is the app's `newKey`, an East function from the keys taken to a new one; without it, one is made");
    }
    const incoming = resolveRowSource(data, "Sheet");
    const ordered = incoming.kind === "ordered" ? orderedRowSource(incoming, "Sheet") : undefined;
    const resolved = ordered?.resolved ?? incoming;
    // The source's rows: structs — or, with LOOSE rows between the groups
    // (#846), entries `Sheet.Types.Entry(P, "lines")`: a group, or a row of
    // the line type.
    const rowType = resolved.elementType;
    const loose = rowType.type === "Variant";
    const arms = loose ? (rowType as VariantType).cases as Record<string, EastType> : undefined;
    if (arms !== undefined && (Object.keys(arms).length !== 2 || arms["group"]?.type !== "Struct" || arms["row"]?.type !== "Struct")) {
        throw new Error(`Sheet: rows must be structs, or entries of a group or a row — Sheet.Types.Entry(GroupType, "lines") — got a variant of ${Object.keys(arms).join(", ")}`);
    }
    if (!loose && rowType.type !== "Struct") {
        throw new Error(`Sheet: rows must be structs — got ${rowType.type}`);
    }
    // Grouped rows (#740): the group is the row; the columns are over its lines.
    const groupDecl = opts.group;
    if (arms !== undefined && groupDecl === undefined) {
        throw new Error("Sheet: entries of groups and loose rows need their group declared — pass `group={Sheet.group(GroupType, \"lines\", …)}` over the entries' group type");
    }
    if (arms !== undefined && groupDecl !== undefined && !isTypeEqual(groupDecl.rowType, arms["group"]!)) {
        throw new Error("Sheet: `group` was built over a different type than the entries' groups — pass the same StructType to `Sheet.Types.Entry(…)` and `Sheet.group(…)`");
    }
    if (arms === undefined && groupDecl !== undefined && groupDecl.rowType !== rowType) {
        throw new Error("Sheet: `group` was built over a different row type than `data` holds — pass the same StructType to `Sheet.group(…)`");
    }
    // The group's type: the row, or the entries' group arm as the declaration holds it.
    const groupType = groupDecl !== undefined ? groupDecl.rowType : rowType as StructType;
    const shape = groupDecl !== undefined ? sheetLinesOf(groupType, groupDecl.lines) : undefined;
    const lineType = shape?.lineType ?? groupType;
    if (arms !== undefined && groupDecl !== undefined && !isTypeEqual(lineType, arms["row"]!)) {
        throw new Error(`Sheet: an entry's loose row must be of the line type \`${groupDecl.lines}\` holds — build the entries' type with Sheet.Types.Entry(GroupType, "${groupDecl.lines}")`);
    }
    const collectionTag = (resolved.collectionType as { type: string }).type;
    // A record's whole Dict, read in key order (#1182), comes from e3-ui's own
    // factories; an author's inline Dict is still refused.
    const keyOrdered = internal.keyOrdered === true;
    if (keyOrdered && collectionTag !== "Dict") {
        throw new Error(`Sheet: a key-ordered sheet reads a Dict — a record's entries, in key order — and this source holds ${printType(resolved.collectionType)}`);
    }
    if (resolved.kind === "inline" && collectionTag !== "Array" && !keyOrdered) {
        throw new Error(
            "Sheet: a dictionary's rows sit in key order, not the planner's — pass an Array<R> (or a bind handle of one), " +
            "or page a keyed source (`Data.bindPaged` over the Dict)",
        );
    }
    const keyed = collectionTag === "Dict" && (resolved.kind === "paged" || keyOrdered);
    const keyType = keyed ? resolved.keyType : undefined;
    // Whether the sheet adds entries of a kind: it writes somewhere, the author has not made it read only, and its edits
    // insert them.
    const writes = opts.onApply !== undefined || opts.onUpdate !== undefined || internal.applyKeyed !== undefined;
    const adds = (what: "insertRows" | "insertGroups"): boolean => writes && opts.readOnly !== true && opts.edits?.[what] !== false;
    // A new entry — a row, or a group, never a group's line, keyed within it — takes the source's key: the app's, from
    // `newKey`; else a UUID the renderer mints for a String key, and one past the largest for an Integer one (#1182,
    // #1536, #1549). Any other key needs `newKey`.
    const entry = groupDecl === undefined ? "row" : "group";
    // A new entry's key is decided one way: built from the entry (`rowKey`, which a sheet over a record takes), or made
    // from the keys taken (`newKey`).
    checkOneKeyRule("Sheet", { rowKey: internal.rowKey, newKey: opts.newKey });
    const decided = opts.newKey !== undefined || internal.rowKey !== undefined;
    // How the app decides a new entry's key, as a refusal says it: a sheet over a record may build it from the entry.
    const decide = `${internal.applyKeyed !== undefined ? `\`rowKey\`, building a new ${entry}'s key from the ${entry}, or ` : ""}\`newKey\`, an East function from the keys taken to a new one`;
    if (keyType !== undefined && keyType.type !== "String" && keyType.type !== "Integer" && !decided
        && (groupDecl === undefined ? adds("insertRows") : adds("insertGroups"))) {
        throw new Error(
            `Sheet: the ${entry}s are keyed by ${printType(keyType)}, and a new ${entry}'s key is made only for a String key or an Integer one — ` +
            `pass ${decide}, or \`edits={{ ${groupDecl === undefined ? "insertRows" : "insertGroups"}: false }}\``,
        );
    }
    // The app's `newKey` on the wire: over the keys' text, as the rows' ids are, as every builder's is.
    const appKey = opts.newKey === undefined ? undefined : newKeyOf(keyType ?? StringType, "Sheet", opts.newKey);
    // With no `newKey`, an Integer key is one past the largest (#1549), as the Plan's is: of every key taken — the rows the
    // sheet has read, its drafts and what its gesture made — and, paging the record's own entries, of the last key they
    // hold: until that read lands no key is made, and the gesture is refused, saying so. With no key at all, the first is
    // 1. An index's window ends at the last of its own order, and a narrowing at the last it keeps: neither says the
    // record's largest key, so a sheet that adds rows over one takes the app's `newKey`.
    const unsaid = incoming.kind === "ordered" ? "an index's window" : incoming.kind === "paged" && incoming.query ? "a narrowing" : undefined;
    if (keyType?.type === "Integer" && !decided && unsaid !== undefined
        && (groupDecl === undefined ? adds("insertRows") : adds("insertGroups"))) {
        throw new Error(
            `Sheet: the ${entry}s are keyed by Integer and read through ${unsaid}, which can't say the record's largest key — a new ${entry}'s is one past it — ` +
            `pass ${decide}, or \`edits={{ ${groupDecl === undefined ? "insertRows" : "insertGroups"}: false }}\``,
        );
    }
    const integerKey = decided || keyType?.type !== "Integer" || unsaid !== undefined ? undefined : (() => {
        // The record's own entries, paged, end at its largest key.
        const lastKey = incoming.kind === "paged"
            ? scheduleLastKey(incoming.source as unknown as ExprType<EastType>, IntegerType)
            : undefined;
        return East.function([SetType(StringType)], StringType, ($, taken) => {
            const largest = $.let(taken.reduce(($2, most, id) => {
                const key = $2.const(id.parse(IntegerType));
                return East.less(most, key).ifElse(() => key, () => most);
            }, 0n), IntegerType);
            if (lastKey !== undefined) {
                const last = $.const(lastKey);
                $.match(last(), {
                    some: ($2, read) => {
                        $2.match(read, {
                            some: ($3, text) => {
                                const key = $3.const(text.parse(IntegerType));
                                $3.if(East.less(largest, key), ($4) => { $4.assign(largest, key); });
                            },
                        });
                    },
                    // The record's last key still read, the largest is not known: a key past the keys taken alone may be one it holds.
                    none: ($2) => { $2.error("the record's last key is still being read — try again in a moment"); },
                });
            }
            return East.print(largest.add(1n));
        });
    })();
    const newKey = appKey ?? integerKey;
    const fields = groupType.fields as Record<string, EastType>;
    const idField = opts.id as string | undefined;
    if (!keyed && idField === undefined) {
        throw new Error("Sheet: `id` is required — the String field that identifies a row (a keyed paged source needs none: its key is the id)");
    }
    if (idField !== undefined) {
        const t = fields[idField];
        if (t === undefined || (t as { type: string }).type !== "String") {
            throw new Error(`Sheet: \`id\` must name a String field of the row — "${idField}" is ${t === undefined ? "not a field" : (t as { type: string }).type}`);
        }
        // A loose row is an entry too (#846): its id field is its identity.
        const own = loose ? (lineType.fields as Record<string, EastType>)[idField] : undefined;
        if (loose && (own === undefined || own.type !== "String")) {
            throw new Error(`Sheet: \`id\` must name a String field of both the group type and the line type — a loose row is an entry, identified like a group; "${idField}" is ${own === undefined ? "not a field" : own.type} of the line type`);
        }
    }

    // Pass 1 — every column against the row type (a grouped sheet: the line type).
    const columnEntries = Object.entries(columns as Record<string, SheetColumn<StructType, EastType> | undefined>)
        .filter((e): e is [string, SheetColumn<StructType, EastType>] => e[1] !== undefined);
    if (columnEntries.length === 0) throw new Error("Sheet: declare at least one column");
    for (const [key, col] of columnEntries) {
        if (internal.recordKinds !== true && RECORD_COLUMN_KINDS.has(col.kind)) {
            throw new Error(`Sheet: column "${key}" is a ${col.kind} column, which a Record draws and a Sheet does not — show a system of records' rows with <Record>`);
        }
        // Columns from data and marks meet the Sheet's fill providers, driver, grouped lines and proposals, which know no members yet.
        if (internal.recordKinds !== true && (col.config.each !== undefined || col.config.mark !== undefined)) {
            throw new Error(`Sheet: column "${key}" ${col.config.each !== undefined ? "makes its columns from data, with `each`," : "has a `mark`,"} which a Record draws and a Sheet does not yet — show a system of records' rows with <Record>`);
        }
        if (col.config.each !== undefined && col.config.header !== undefined) {
            throw new Error(`Sheet: column "${key}" makes its columns from data, which take no \`header\` — a member's name heads each of its columns: a register member's label, or the header \`each\` gives a struct's field`);
        }
        if (col.rowType === undefined || col.rowType === lineType) continue;
        throw new Error(groupDecl !== undefined && col.rowType === groupType
            ? `Sheet: column "${key}" was built over the group's row type — columns are declared over the line type \`${groupDecl.lines}\` holds (Sheet.column.${col.kind}(LineType, …))`
            : `Sheet: column "${key}" was built over a different row type than the sheet's — pass the same StructType to Sheet.column.${col.kind}(RowType, …) and \`data\``);
    }
    // Each declared register's key type, by name — the driver's, keyed by String, under its column: what a column over a
    // register holds one member's key as (east-workspace#1747).
    const registerKeys = new Map<string, EastType>(Object.entries(opts.registers ?? {}).map(([name, register]) => [name, register.keyType]));
    if (opts.driver !== undefined) registerKeys.set(opts.driver.column, StringType);
    // Every column, described in the columns map's order; a column from data's cells are read at the Record's day, so
    // its row carries none of them, and the session reaches its field through its own functions.
    const described = columnEntries.map(([key, col]) => describeColumn(key, col, lineType, registerKeys));
    const metas = described.filter((m) => m.data === undefined);
    const dataMetas = described.filter((m) => m.data !== undefined);
    const metaByKey = new Map(metas.map((m) => [m.key, m]));
    // A record's key field is its session's to keep: a column over it shows the key and takes no edit, and no column
    // writes it another way. On a grouped sheet the field is the group's, and its band cells are held to this below.
    const keyField = internal.keyField;
    for (const m of keyField !== undefined && groupDecl === undefined ? described : []) {
        if (m.otherField === keyField || (m.data !== undefined && m.field === keyField)) {
            throw new Error(`Sheet: column "${m.key}" writes "${keyField}", the \`keyField\` — a row's key is kept in it by the sheet, and no column writes it`);
        }
        if (m.field === keyField) m.editable = false;
    }
    for (const m of described) {
        if (m.otherField !== undefined && metaByKey.has(m.otherField)) {
            throw new Error(`Sheet: link column "${m.key}" names "${m.otherField}" as its other half, which is also a column — a half's field is written through the link column, never on its own`);
        }
        // A flat row's id is its identity — and so is a loose row's (#846).
        if ((groupDecl === undefined || loose) && m.field === idField) throw new Error(`Sheet: the id field "${idField}" cannot also be a column`);
    }

    // The driver — a lookup column on a String field.
    const driver = opts.driver;
    if (driver !== undefined) {
        const dm = metaByKey.get(driver.column);
        if (dm === undefined || dm.kind !== "lookup") {
            throw new Error(`Sheet: the driver column "${driver.column}" must be a \`Sheet.column.lookup\` column — ${dm === undefined ? "it is not a column" : `it is a ${dm.kind} column`}`);
        }
        dm.register = driver.column;
    }
    for (const m of described) {
        if (m.kind === "lookup" && (driver === undefined || m.key !== driver.column)) {
            throw new Error(`Sheet: column "${m.key}" is a lookup column, which is the driver column — declare \`driver={Sheet.driver("${m.key}", …)}\`, or use \`Sheet.column.reference\` for a plain register lookup`);
        }
        if (m.driverType !== undefined && (driver === undefined || driver.rowType !== m.driverType)) {
            throw new Error(`Sheet: column "${m.key}" was built over a driver row type that is not this sheet's driver's — pass the same type to \`Sheet.column.${m.kind}(RowType, DriverType, …)\` and \`Sheet.driver(…)\`${driver === undefined ? " (the sheet declares no driver)" : ""}`);
        }
    }

    // Registers — by name, plus the driver's under its column name, and each cycle over a variant's steps under its own.
    const registers: Record<string, SheetRegisterValue> = { ...(opts.registers ?? {}) };
    if (driver !== undefined) registers[driver.column] = driver.register;
    for (const m of described) {
        if (m.steps === undefined) continue;
        if (registers[m.register!] !== undefined) throw new Error(`Sheet: \`registers\` declares "${m.register}", the name column "${m.key}"'s steps take — name the register another way`);
        registers[m.register!] = { members: m.steps.members, keyType: StringType };
    }
    for (const m of described) {
        if (m.register !== undefined && registers[m.register] === undefined) {
            throw new Error(`Sheet: column "${m.key}" names register "${m.register}", which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
        }
        // A column from data's members and its groups' heads are registers too.
        if (m.data?.from !== "register") continue;
        for (const [option, name] of [["each", m.data.register], ["groups", m.data.groups]] as const) {
            if (name !== undefined && registers[name] === undefined) {
                throw new Error(`Sheet: column "${m.key}" names register "${name}" in \`${option}\`, which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
            }
        }
    }

    // The band's cells (#740) — the title first, then each cell under its line column.
    let cellMetas: SheetColumnMeta[] | undefined;
    if (groupDecl !== undefined) {
        const cfg = groupDecl.config;
        const titleType = fields[cfg.title];
        if (titleType === undefined || (titleType as { type: string }).type !== "String") {
            throw new Error(`Sheet: \`group.title\` must name a String field of the row — "${cfg.title}" is ${titleType === undefined ? "not a field" : (titleType as { type: string }).type}`);
        }
        cellMetas = [describeGroupCell(SHEET_TITLE_CELL, { kind: "text", field: cfg.title, config: {} }, groupType, registerKeys)];
        for (const [key, cell] of Object.entries(cfg.cells ?? {})) {
            if (cell === undefined) continue;
            const under = metaByKey.get(key);
            if (under === undefined) {
                throw new Error(`Sheet: band cell "${key}" is not a declared column — \`group.cells\` is keyed by the line columns the cells sit under (${[...metaByKey.keys()].join(", ")})`);
            }
            const meta = describeGroupCell(key, cell, groupType, registerKeys);
            // Under an action column (#1474) a band shows the group's own status — a word, never an action.
            if (under.kind === "action") {
                if (meta.kind !== "enum" && meta.kind !== "text" && meta.kind !== "stamped") {
                    throw new Error(`Sheet: band cell "${key}" is a ${meta.kind} cell under an action column — a band shows its group's status there: an enum, text or stamped cell`);
                }
            } else if (meta.payloadType !== under.payloadType) {
                throw new Error(`Sheet: band cell "${key}" is a ${meta.kind} cell (${(meta.payloadType as { type: string }).type}) under a ${under.kind} column (${(under.payloadType as { type: string }).type}) — a band cell's payload must match the column it sits under`);
            }
            if (meta.register !== undefined && registers[meta.register] === undefined) {
                throw new Error(`Sheet: band cell "${key}" names register "${meta.register}", which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
            }
            cellMetas.push(meta);
        }
        for (const m of keyField !== undefined ? cellMetas : []) if (m.field === keyField) m.editable = false;
    }

    // The fields only the app gives a new entry (#1536), on a sheet that adds that kind of entry: a row's — a line's, a
    // loose row's — and a group's. The session sets an entry's id field itself (a flat row's, a loose row's, a line's
    // beside loose rows) and a group's lines. A sheet that applies nothing drafts what it likes.
    const hinted = internal.inspector;
    // And a record's key field, which it keeps the entry's key in: a row's, or on a grouped sheet a group's.
    const lineLeave = new Set([
        ...(idField !== undefined && (groupDecl === undefined || loose) && idField in lineType.fields ? [idField] : []),
        ...(keyField !== undefined && groupDecl === undefined ? [keyField] : []),
    ]);
    const unsettable = {
        row: adds("insertRows") ? unsettableFields(lineType, described, hinted === undefined ? undefined : hinted.fields ?? {}, lineLeave) : [],
        group: groupDecl !== undefined && cellMetas !== undefined && adds("insertGroups")
            ? unsettableFields(groupType, cellMetas, hinted === undefined ? undefined : hinted.groupFields ?? {},
                new Set([groupDecl.lines, ...(idField !== undefined ? [idField] : []), ...(keyField !== undefined ? [keyField] : [])]))
            : [],
    };
    const lineWord = groupDecl === undefined ? "row's" : loose ? "line's or loose row's" : "line's";
    if (unsettable.row[0] !== undefined && opts.newRow === undefined) {
        throw new Error(
            `Sheet: a new ${lineWord} "${unsettable.row[0].field}" is required, and no column or form sets it — ` +
            "give it in `newRow`, make it an Option, or `edits={{ insertRows: false }}`",
        );
    }
    if (unsettable.group[0] !== undefined && opts.newGroup === undefined) {
        throw new Error(
            `Sheet: a new group's "${unsettable.group[0].field}" is required, and no band cell or form sets it — ` +
            "give it in `newGroup`, make it an Option, or `edits={{ insertGroups: false }}`",
        );
    }

    // The bridge.
    const bridge = buildBridge({
        rowType, idField, metas, dataMetas, registers, driver,
        source: resolved.kind === "inline"
            ? keyType !== undefined
                ? { kind: "keyed", rows: resolved.rows as ExprType<DictType<EastType, EastType>>, keyType }
                : { kind: "inline", rows: resolved.rows as ExprType<ArrayType<StructType>> }
            : { kind: "paged", source: resolved.source, keyed, keyType },
        ...(groupDecl !== undefined && cellMetas !== undefined ? { group: { linesField: groupDecl.lines, cellMetas } } : {}),
        ...(opts.subRows !== undefined ? { subRows: opts.subRows } : {}),
        ...(internal.hold !== undefined ? { hold: internal.hold } : {}),
    });

    // Pass 2 — the wire columns, in the columns map's order: one for each column, and for a column from data one for each
    // of its members, keyed `column:member` — a struct's fields fixed here, a register's members mapped as the page runs,
    // their groups' order theirs where `groups` heads them, so each group is a run of adjacent columns.
    // Each wire column's marks cross as two unrendered cells beside its own (#1559): their words, and whether they lock.
    const markCells = (key: SubtypeExprOrValue<StringType>, marked: boolean): ExprType<OptionType<SheetMarkCellsType>> => (marked
        ? East.value(some({ words: East.str`$mark:${key}`, lock: East.str`$lock:${key}` }), OptionType(SheetMarkCellsType))
        : East.value(none, OptionType(SheetMarkCellsType)));
    const parts: ExprType<ArrayType<SheetColumnType>>[] = [];
    let fixed: ExprType<SheetColumnType>[] = [];
    for (const m of described) {
        const data = m.data;
        if (data === undefined) {
            fixed.push(East.value({
                key:         m.key,
                header:      m.config.header ?? m.key,
                sub:         optionOf(m.config.sub, StringType),
                width:       optionOf(m.config.width, StringType),
                kind:        buildKind(m, bridge, driver, { metas, registers, groupCells: cellMetas }),
                dataType:    toEastTypeValue(m.fieldType),
                payloadType: toEastTypeValue(m.payloadType),
                editable:    m.editable,
                fill:        (m.config.fill ?? []).map((f, i) => wrapProvider(bridge, m, f, i)),
                detailCell:  ruleCellKey(m, "detail"),
                from:        none,
                mark:        markCells(m.key, m.mark !== undefined),
            }, SheetColumnType));
            continue;
        }
        if (data.from === "fields") {
            for (const member of data.members) {
                const key = `${m.key}:${member.name}`;
                fixed.push(East.value({
                    key,
                    header:      member.header,
                    sub:         optionOf(m.config.sub, StringType),
                    width:       optionOf(m.config.width, StringType),
                    kind:        buildKind(m, bridge, driver, undefined, East.value(key, StringType)),
                    dataType:    toEastTypeValue(member.valueType),
                    payloadType: toEastTypeValue(m.payloadType),
                    editable:    m.editable,
                    fill:        [],
                    detailCell:  ruleCellKey(m, "detail"),
                    from:        some({ column: m.key, field: m.field, member: member.name, clears: member.clears }),
                    mark:        markCells(key, data.mark !== undefined),
                }, SheetColumnType));
            }
            continue;
        }
        if (fixed.length > 0) parts.push(East.value(fixed, ArrayType(SheetColumnType)));
        fixed = [];
        const members = registers[data.register]!.members;
        const ordered = data.groups === undefined
            ? dedupeMembers(members)
            : groupMembers(members, registers[data.groups]!.members).flatMap((_$, group) => group.members);
        // The column's element type as TypeScript infers it expands the recursive type of a type, which the wire's names once.
        parts.push(ordered.map(($, member) => {
            const key = $.const(East.str`${m.key}:${member.key}`);
            return East.value({
                key,
                header:      member.label,
                sub:         optionOf(m.config.sub, StringType),
                width:       optionOf(m.config.width, StringType),
                kind:        buildKind(m, bridge, driver, undefined, key),
                dataType:    toEastTypeValue(data.valueType),
                payloadType: toEastTypeValue(m.payloadType),
                editable:    m.editable,
                fill:        [],
                detailCell:  ruleCellKey(m, "detail"),
                from:        some({ column: m.key, field: m.field, member: member.key, clears: data.clears }),
                mark:        markCells(key, data.mark !== undefined),
            }, SheetColumnType);
        }) as unknown as ExprType<ArrayType<SheetColumnType>>);
    }
    if (fixed.length > 0 || parts.length === 0) parts.push(East.value(fixed, ArrayType(SheetColumnType)));
    const columnValues = parts.slice(1).reduce((all, part) => all.concat(part), parts[0]!);

    // The rows — the same projection on both arms. A grouped sheet's row is
    // the group: the band's cells, its lines and the band; a loose row between
    // the groups (#846) is a row of the line type: its cells, no lines, no band.
    const ownedAccessor = opts.owned;
    const ownedFn = East.function([rowType], BooleanType, (_$, r) =>
        ownedAccessor !== undefined ? ownedAccessor(r as ExprType<StructType>) : East.value(false, BooleanType));
    const groupBridge = bridge.group;
    const subAccessor = groupDecl?.config.sub;
    const foldedAccessor = groupDecl?.config.folded;
    const subFn = East.function([groupType], StringType, (_$, r) =>
        subAccessor !== undefined ? subAccessor(r) : East.value("", StringType));
    const foldedFn = East.function([groupType], BooleanType, (_$, r) =>
        foldedAccessor !== undefined ? foldedAccessor(r) : East.value(false, BooleanType));
    const rowOf = East.function([rowType, StringType], SheetRowType, ($, r, id) => {
        const ownedOf = $.const(ownedFn);
        const owned = $.let(ownedOf(r), BooleanType);
        if (groupBridge === undefined) {
            const project = $.const(bridge.projectRow);
            const subRowsOf = $.const(bridge.projectSubRows);
            return $.let({ id, owned, cells: project(r as ExprType<StructType>), lines: [], band: none, subRows: subRowsOf(r as ExprType<StructType>) }, SheetRowType);
        }
        const cellsOf = $.const(groupBridge.projectGroupCells);
        const linesOf = $.const(groupBridge.projectLines);
        const subOf = $.const(subFn);
        const foldedOf = $.const(foldedFn);
        if (!loose) {
            const g = r as ExprType<StructType>;
            return $.let({ id, owned, cells: cellsOf(g), lines: linesOf(g), band: some({ sub: subOf(g), folded: foldedOf(g) }), subRows: [] }, SheetRowType);
        }
        const project = $.const(bridge.projectRow);
        const subRowsOf = $.const(bridge.projectSubRows);
        return (r as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>).match({
            group: ($2, g) => $2.let({ id, owned, cells: cellsOf(g), lines: linesOf(g), band: some({ sub: subOf(g), folded: foldedOf(g) }), subRows: [] }, SheetRowType),
            row: ($2, l) => $2.let({ id, owned, cells: project(l), lines: [], band: none, subRows: subRowsOf(l) }, SheetRowType),
        });
    });
    // A stored entry beside the rows made from it (#1599), as `editing.readEntry` answers one: its id, and its bytes at
    // the session's entry type.
    const entryOf = East.function([rowType, StringType], CarriedEntryType, (_$, r, id) => ({ id, entry: East.Blob.encodeBeast(r, "v2") }));
    // A keyed row's id is its key's text (#1182): a String key itself, any
    // other key its `.east` printing, which `Record.onApply` reads back.
    const idOfKey = keyType !== undefined && keyType.type !== "String"
        ? (k: ExprType<EastType>): ExprType<StringType> => East.print(k)
        : (k: ExprType<EastType>): ExprType<StringType> => k as ExprType<StringType>;
    // A positional row's id is its id field — an entry's, through whichever arm it holds (#846).
    const idAt = (r: ExprType<EastType>): ExprType<StringType> => (loose
        ? (r as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>).match({
            group: (_$, g) => (g as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>,
            row: (_$, l) => (l as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>,
        })
        : (r as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>);
    // Each of a window's entries through `each`, in the source's order: a keyed source's by its key's text, a positional
    // one's by its id field, an index's by its entry's key.
    const over = <T extends EastType>(each: ExprType<FunctionType<[EastType, StringType], T>>) =>
        (collection: ExprType<EastType>): ExprType<ArrayType<T>> => (ordered !== undefined
            ? (collection as ExprType<ArrayType<StructType>>).map((_$, entry) => each(ordered.valueOf(entry), ordered.idOf(entry.key!)))
            : keyed
                ? (collection as unknown as ExprType<DictType<EastType, EastType>>).toArray((_$, v, k) => each(v, idOfKey(k)))
                : (collection as unknown as ExprType<ArrayType<EastType>>).map((_$, r) => each(r, idAt(r)))) as unknown as ExprType<ArrayType<T>>;
    // Whether a window carries the stored entries its rows were made from (#1599): on a sheet that writes over rows read
    // a window at a time. Its rows stand at the revision they were read at while their windows are read again — after a
    // Save, or another session's write — and an entry read as a gesture runs is read at the revision now, on its way:
    // arriving with its window, it is at hand, and a gesture on a row the sheet shows is taken at once. A sheet over rows
    // held whole reads an entry from them, and one that writes nothing begins no gesture: neither carries any.
    const carriesEntries = writes && resolved.kind !== "inline";
    const rowsValue = buildCarriedRowSource(
        incoming, SheetRowsCollectionType,
        over(rowOf as unknown as ExprType<FunctionType<[EastType, StringType], typeof SheetRowType>>),
        carriesEntries ? over(entryOf as unknown as ExprType<FunctionType<[EastType, StringType], typeof CarriedEntryType>>) : undefined,
    );

    // The copilot's row proposals.
    const suggest = opts.suggest !== undefined
        ? (() => {
            const s = opts.suggest!;
            for (const t of s.triggers ?? []) {
                if (!metaByKey.has(t as string)) throw new Error(`Sheet: suggest.triggers names "${String(t)}", which is not a column`);
            }
            return East.value(some({
                ahead:    typeof s.ahead === "number" ? BigInt(s.ahead) : (s.ahead ?? 2n),
                triggers: East.value((s.triggers ?? metas.filter((m) => m.editable).map((m) => m.key)) as string[], ArrayType(StringType)),
                ghost:    s.ghost ?? true,
                propose:  s.propose.map((p, i) => wrapProposer(bridge, p, i)),
            }), OptionType(SheetSuggestType));
        })()
        : East.value(none, OptionType(SheetSuggestType));

    // The narrowing's chrome, as `<Sheet>` checked it (#1345): one rail over its Slice.bindRecords.
    const slice = East.value(internal.slice ?? none, OptionType(RecordSlicesChromeType));

    const editing = buildSheetEditing(resolved, bridge, idField, {
        ...opts,
        ...(ordered !== undefined && opts.onApply !== undefined ? { onApply: undefined, applyKeyed: opts.onApply } : {}),
        ...(internal.applyKeyed !== undefined ? { applyKeyed: internal.applyKeyed } : {}),
        ...(internal.sourceId !== undefined ? { sourceId: internal.sourceId } : {}),
        unsettable, keyField, rowKey: internal.rowKey,
    }, rowOf as unknown as ExprType<FunctionType<[EastType, StringType], typeof SheetRowType>>, driver?.column);
    // The group declaration on the wire (#740).
    const groupValue = groupBridge !== undefined && groupDecl !== undefined && cellMetas !== undefined
        ? East.value(some({
            lines: groupDecl.lines,
            cells: East.value(cellMetas.map((m) => East.value({
                key:         m.key,
                field:       m.field,
                kind:        buildKind(m, bridge, driver),
                dataType:    toEastTypeValue(m.fieldType),
                payloadType: toEastTypeValue(m.payloadType),
                editable:    m.editable,
            }, SheetGroupCellType)), ArrayType(SheetGroupCellType)),
            // The host's word; with none, the renderer says its own (#861).
            noun: optionOf(groupDecl.config.noun, SheetNounType),
            // Loose rows between the groups (#846): a row without a band.
            loose,
        }), OptionType(SheetGroupType))
        : East.value(none, OptionType(SheetGroupType));

    const footer = East.value((opts.footer ?? []).map((f) => ({
        text: f.text,
        tone: f.tone !== undefined ? some(resolveTag(f.tone, StatusValueType)) : none,
    })), ArrayType(SheetFooterItemType));
    const style = opts.style !== undefined
        ? East.value(some({
            gutterWidth: optionOf(opts.style.gutterWidth, StringType),
        }), OptionType(SheetStyleType))
        : East.value(none, OptionType(SheetStyleType));
    // On a phone (`Mobile Sheet Spec.md` §9): a pinned column one of the sheet's, and one to three columns in view.
    const narrowOpt = opts.narrow;
    if (narrowOpt?.pin !== undefined && !metaByKey.has(narrowOpt.pin)) {
        throw new Error(`Sheet: \`narrow.pin\` names "${narrowOpt.pin}", which is not a column (${[...metaByKey.keys()].join(", ")})`);
    }
    if (narrowOpt?.columns !== undefined && ![1, 2, 3].includes(narrowOpt.columns)) {
        throw new Error(`Sheet: \`narrow.columns\` is how many columns a phone shows at once beside any pinned one, 1 to 3 — got ${String(narrowOpt.columns)}`);
    }
    const narrow = narrowOpt !== undefined
        ? East.value(some({
            pin:     optionOf(narrowOpt.pin, StringType),
            columns: narrowOpt.columns !== undefined ? some(BigInt(narrowOpt.columns)) : none,
        }), OptionType(SheetNarrowType))
        : East.value(none, OptionType(SheetNarrowType));

    const root = East.value({
        rows:          rowsValue,
        editing,
        cellsAt:       bridge.cellsAt !== undefined ? some(bridge.cellsAt) : none,
        columns:       columnValues,
        registers:     East.value(new Map(Object.entries(registers).map(([name, register]) => [name, East.value({ members: register.members }, SheetRegisterType)])), DictType(StringType, SheetRegisterType)),
        driver:        driver !== undefined
            ? East.value(some({ column: driver.column, members: driver.register.members }), OptionType(SheetDriverType))
            : East.value(none, OptionType(SheetDriverType)),
        suggest,
        slice,
        views:         East.value(opts.views ?? [], ArrayType(SheetRecordViewType)),
        activeView:    opts.activeView !== undefined ? East.value(opts.activeView, OptionType(StringType)) : East.value(none, OptionType(StringType)),
        onViewsChange: opts.onViewsChange !== undefined
            ? some(East.value(opts.onViewsChange, FunctionType([ArrayType(SheetRecordViewType)], NullType)))
            : none,
        onSelect:      opts.onSelect !== undefined
            ? some(East.value(opts.onSelect, FunctionType([SheetSelectionType], NullType)))
            : none,
        selection:     opts.selection !== undefined ? East.value(opts.selection, OptionType(SheetSelectionType)) : East.value(none, OptionType(SheetSelectionType)),
        newKey:        newKey !== undefined ? some(newKey) : none,
        group:         groupValue,
        readOnly:      opts.readOnly !== undefined ? some(opts.readOnly) : none,
        blanks:        opts.blanks !== undefined ? some(typeof opts.blanks === "number" ? BigInt(opts.blanks) : opts.blanks) : none,
        density:       opts.density !== undefined ? some(resolveTag(opts.density, DensityType)) : none,
        footer,
        style,
        narrow,
        ordered: ordered !== undefined,
    }, SheetRootType);
    return { root, bridge, metas, data: dataMetas, registers: Object.keys(registers), keyType, keyField };
}
