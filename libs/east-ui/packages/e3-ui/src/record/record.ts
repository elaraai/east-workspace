/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Record>`: the table for a system of records (`Record - DX Proposal.md`).
 * Its rows are an e3 record's entries, its grid the east-ui Table's anatomy,
 * and its column kinds the Sheet's, with the Record's own beside them — a
 * title, a person, a boolean, a toggle, a cycle, the time since a moment and
 * the last change the app kept. Every edit is a draft of the shared editing
 * session behind one history bar; Add drafts a record and Delete drafts a
 * removal. The app hears the rows its select column ticks (`onTick`).
 *
 * Its rows come from one of two sources:
 * - `record`, an e3 record bound with its patch mutation: its entries, in key
 *   order, each row's id its key's text; `window` (`Data.bindPaged(record)`)
 *   reads a large one a window at a time;
 * - the `rows` source of its `slice`, a `Slice.bindRecords` over the record:
 *   its rows, paged from it, the source's narrowing drawn over them. The
 *   record is handed beside it, `record`, as in the first form, and edits are
 *   committed through it (east-workspace#1622); without it, read only.
 *
 * Its columns from data read and write their cells at its day, and its ages in
 * days and weeks count to it: the day the page sets, `day`, as the page gives
 * it — else the viewer's own, the browser's local calendar date at UTC
 * midnight, which turns over at their midnight (east-workspace#1746).
 *
 * The Record is an interface. Its payload holds the Sheet's root — the grid,
 * the rows and the session, built by the very code `<Sheet>` builds it with,
 * its title column the one a phone pins at the left — beside what only a
 * Record has: its title and noun, its column groups and its inspector's
 * forms. The `Record` renderer in `@elaraai/e3-ui-components` draws it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    DateTimeType,
    East,
    Expr,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    type EastType,
    type ExprType,
    type FunctionType,
    type NullType,
    type SetType,
    type StructType as StructTypeOf,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { Table, type UIElement } from "@elaraai/east-ui";
import { EastUI, type FieldHints, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { SheetRootType, SheetNounType } from "../sheet/types.js";
import {
    createSheetPayload, SheetInspectorPaneType, SheetHistoryType,
    type SheetCommon, type SheetRecordHandle,
} from "../sheet/sheet.js";
import type { SheetOptions } from "../sheet/root.js";
import type { RecordAgeColumn, RecordNamedColumn, SheetColumn, SheetFieldKey } from "../sheet/columns.js";
import type { RecordKeyField } from "../bind/record.js";
import type { KindKeyBuilder } from "../utils/record-kind.js";
import { groupMembers } from "../sheet/registers.js";

/** The Sheet's payload, as the Record reads the parts it keeps. */
type SheetPayloadParts = ExprType<StructType<{
    sheet: SheetRootType; inspector: OptionType<SheetInspectorPaneType>; history: OptionType<SheetHistoryType>;
    missing: OptionType<StringType>; autosave: BooleanType; name: OptionType<StringType>;
}>>;

// ============================================================================
// The renderer's payload
// ============================================================================

/**
 * The `Record` renderer's payload: the Record's interface.
 *
 * @property sheet - The Sheet's root — the grid, the rows, the narrowing's chrome and the session, its columns the Record's, its title column the one a phone pins (`narrow.pin`)
 * @property title - The toolbar's lead, before the count of the record's rows
 * @property noun - What a row is called (`person`, `people`); `none`, the renderer's own word
 * @property columnGroups - The column-group row: each group a run of adjacent columns under one label, `""` drawing none — the Table's own type; a column from data's `groups`, one per member of that register with columns under it
 * @property inspector - The inspector pane: the selected row's every field, and the batch's issues; `none`, no pane
 * @property history - Over `record`, its commits; `none` over the rail's rows
 * @property missing - The entry's key while the record does not hold it — never, for a Record over the record's own entries
 * @property autosave - Whether its Autosave begins on
 * @property day - The day its columns from data are read and written at, and its ages in days and weeks count to, as the page gives it; `none`, the viewer's own — the browser's local calendar date at UTC midnight
 * @property name - Names the Record, when a surface holds two
 */
export const RecordPayloadType = StructType({
    sheet: SheetRootType,
    title: OptionType(StringType),
    noun: OptionType(SheetNounType),
    columnGroups: ArrayType(Table.Types.ColumnGroup),
    inspector: OptionType(SheetInspectorPaneType),
    history: OptionType(SheetHistoryType),
    missing: OptionType(StringType),
    autosave: BooleanType,
    day: OptionType(DateTimeType),
    name: OptionType(StringType),
});

/** Type representing the `Record` renderer's payload. */
export type RecordPayloadType = typeof RecordPayloadType;

/**
 * The `Record` carrier: `<Record>` builds a {@link RecordPayloadType} and
 * returns it through this {@link EastUI.component}. The React renderer
 * registers against it in `@elaraai/e3-ui-components`.
 */
export const RecordComponent = EastUI.component("Record", RecordPayloadType, { optional: true });

// ============================================================================
// <Record>'s props
// ============================================================================

/**
 * A Record's `columns`: a row field's key holds a column over that field, as
 * the Sheet's do, and any other key an age column, which shows no field, or a
 * column from data naming the field it reads with `field`.
 *
 * @typeParam R - The record's row type
 * @typeParam C - The columns given
 */
export type RecordColumnSpec<R extends StructTypeOf, C> = {
    [K in keyof C]: K extends SheetFieldKey<R> ? SheetColumn<R, R["fields"][K]> : RecordAgeColumn<R> | RecordNamedColumn<R>;
};

/** Where a Record's row type is read from its columns: each one's row type. */
type RecordColumnsOf<R extends StructTypeOf> = Readonly<Record<string, { readonly __row?: (r: R) => void }>>;

/**
 * One column group: a run of adjacent columns under one label — the Table's
 * own (`TableColumnGroupInput`).
 *
 * @typeParam K - The columns' keys
 * @property label - The group's label; `""` draws no label and no rule
 * @property columnKeys - The group's columns, adjacent and in column order
 */
export interface RecordColumnGroupInput<K extends string> {
    /** The group's label; `""` draws none. */
    label: string;
    /** The group's columns, adjacent and in column order. */
    columnKeys: K[];
}

/**
 * What a row is called: `18 people`, `Added a person`, `No people match the
 * search`.
 *
 * @property singular - One row (`person`)
 * @property plural - Several (`people`)
 */
export interface RecordNounInput {
    /** One row. */
    singular: string;
    /** Several. */
    plural: string;
}

/**
 * The Sheet's options a Record takes as they are — its selection among them: `onSelect` as the ring moves, `selection`
 * to place it, and `onRowClick` (east-workspace#1727) for each click on a row, its key typed at the record's.
 */
type RecordSheetOptions = "registers" | "newRow" | "newKey" | "edits" | "owned" | "readOnly" | "density" | "ready" | "onSelect" | "selection" | "onRowClick";

/**
 * What every `<Record>` takes beside its rows and its columns.
 *
 * @typeParam R - The record's row type
 * @typeParam C - The columns given
 */
export interface RecordCommon<R extends StructTypeOf, C> {
    /** The toolbar's lead: the title, then the count of the record's rows. */
    title?: string;
    /** What a row is called; left out, the renderer's own word. */
    noun?: RecordNounInput;
    /**
     * The column-group row: each group a run of adjacent columns under one label, `""` drawing none. The inspector's
     * sections follow them. A group may name a column made from a struct's fields, whose columns are known when the page
     * is built, and never one made from a register's members: those are grouped by its `groups`.
     */
    columnGroups?: RecordColumnGroupInput<Extract<keyof C, string>>[];
    /** The inspector pane: Details, the selected row's every field, and the batch's Issues; given the author's own Details for one row, those. */
    inspector?: SheetCommon<R>["inspector"];
    /** Hints for the inspector's form, by the row's field — `Record.field.*`. */
    fields?: FieldHints<R["fields"]>;
    /**
     * Whether Autosave — the switch in Save's menu — begins on; off by default. On, the Record's changes are saved by
     * themselves a pause after the viewer's last act: never an Undo or a Redo, which wait for a press of Save. A
     * literal, or an expression data drives. The viewer's own choice, once made, is kept in their browser for the data
     * set and the Record, and stands over it.
     */
    autosave?: SubtypeExprOrValue<BooleanType>;
    /**
     * The day the Record's columns from data read and write their cells at — each one's `read`, `write` and `mark`
     * handed it as the page gives it, never rounded — and its ages in days and weeks count to: a value, or an
     * expression, a reactive state's `read()` or a dataset's value, so a page plans as at a day that is not the
     * viewer's today. As it changes, every row's cells from data are read again at the new day, with no rebuild, and
     * the drafts stay: a draft is the row's field, so a drafted field shows as read at the new day, Undo takes back
     * each edit whatever day it was made at, and Save commits the fields. Left out, the viewer's own day: the browser's
     * local calendar date at UTC midnight, which turns over at their midnight. An age in hours counts to the browser's
     * clock either way. The Record draws nothing for the day: the page shows the day it sets, and lets a person change
     * it if it wants to.
     */
    day?: SubtypeExprOrValue<DateTimeType>;
    /** Names the Record — needed only when one surface holds two. */
    name?: string;
}

/**
 * What a Record's app hears of the rows its select column ticks (east-workspace#1737).
 *
 * @typeParam K - The record's key type
 */
export interface RecordTickOptions<K extends EastType> {
    /**
     * The ticked rows' keys, after each change of the ticks: a row's box ticked or unticked, the header's box ticking
     * every row shown or unticking them, and the ticks the Record lets go itself — Delete's, Discard's, a new search's or
     * filter's, a row Details deletes, a row an Undo or a Redo takes away, and every tick as the select column goes — in
     * a phone's frame — and as the Record is let go. Each change is one call with the whole Set as it now stands, at the
     * record's key type, a ticked row a paged record has scrolled away from among it, a ticked row an edit moves under
     * another key (`rowKey`) under the key it stands under now — an Undo putting it back — and a ticked new row the
     * drafts' carry-over gives another key, another Save having taken its own, under that key. The Record starts with
     * none ticked, and calls it then for nothing. Given, the select column shows — Delete on or off, read only too — as
     * it does wherever Delete is on; with neither, the Record has none, and on a phone it has none. Passed through
     * untouched, never called at build: an East function over `SetType(K)`, or a bare lambda, which is built at that
     * type — on `<Record slice>` alone, which says nothing else of K, an East function at the `rows` source's key type.
     */
    onTick?: SubtypeExprOrValue<FunctionType<[SetType<K>], NullType>>;
}

// ============================================================================
// The payload
// ============================================================================

/** The props, erased — what the implementation reads. */
type RecordAnyProps = {
    columns: Readonly<Record<string, SheetColumn<StructTypeOf, EastType> | undefined>>;
    title?: string;
    noun?: RecordNounInput;
    columnGroups?: readonly RecordColumnGroupInput<string>[];
    onTick?: unknown;
    day?: SubtypeExprOrValue<DateTimeType>;
} & Record<string, unknown>;

/** The Sheet's props a Record has no use for, each with what the Record does instead. */
const NOT_A_RECORD_PROP: Readonly<Record<string, string>> = {
    data: "a Record reads an e3 record — pass `record`, or the `rows` source of `slice`",
    entry: "a Record's rows are the record's own entries",
    group: "a Record draws no group rows — filter by the field through `slice`'s rail, over the record's index on it",
    templates: "a Record adds an empty record with Add",
    library: "a Record has no library pane",
    optimise: "a Record has no optimiser",
    views: "a Record's narrowing is its `slice`",
    vocabulary: "a Record's words are its `noun`",
    subRows: "a Record has no sub rows",
    suggest: "a Record proposes no rows",
    driver: "a Record has no driver",
    footer: "a Record's footer counts its rows",
    style: "a Record has no gutter",
    narrow: "a Record pins its title column on a phone",
    blanks: "a Record has no blank rows",
    groupFields: "a Record has no groups",
    newGroup: "a Record has no groups",
    id: "a Record's rows are identified by their key — where a field of theirs holds it too, name it with `keyField`",
    onUpdate: "a Record commits through the record",
    onApply: "a Record commits through the record it is handed — pass `record`, beside `slice` too",
    onPatch: "a Record commits through the record",
};

/**
 * Creates the Record's payload alone — what `<Record>` returns through the
 * `Record` carrier — for the tests and the renderer's fixtures, which read it
 * whole.
 *
 * @param props - The Record's props, as `<Record>` takes them
 * @returns An East expression of {@link RecordPayloadType}
 * @throws Error naming the prop and the remedy: a Sheet's prop a Record has no use for; an `onTick` over anything but a Set of the record's keys; a `keyField` on a Record handed no record, or that is no field of its rows of its key's type; a `rowKey` on a Record handed no record, beside `newKey`, that builds no key of its key's type, or that reads the field `keyField` names; a column group naming a key that is not a column or a column made from a register's members, holding no columns, or columns that are not adjacent, and a column in two groups; and everything the Sheet's root refuses of the rows, the columns and the registers
 * @internal
 */
export function createRecordPayload(props: { columns: unknown } & { [prop: string]: unknown }): ExprType<RecordPayloadType> {
    const { title, noun, columnGroups, onTick, day, ...sheet } = props as RecordAnyProps;
    for (const [prop, instead] of Object.entries(NOT_A_RECORD_PROP)) {
        if (prop in sheet) throw new Error(`Record: takes no \`${prop}\` — ${instead}`);
    }
    const columns = Object.entries(sheet.columns).filter(([, col]) => col !== undefined) as [string, SheetColumn<StructTypeOf, EastType>][];
    const keys = columns.map(([key]) => key);
    // Column groups: runs of adjacent columns, each column in one group at most.
    const grouped = new Map<string, string>();
    for (const group of columnGroups ?? []) {
        const name = group.label === "" ? "an unlabelled group" : `group "${group.label}"`;
        if (group.columnKeys.length === 0) throw new Error(`Record: column ${name} holds no columns — give it its columns' keys`);
        const at = group.columnKeys.map((key) => {
            const index = keys.indexOf(key);
            if (index < 0) throw new Error(`Record: column ${name} names "${key}", which is not a column (${keys.join(", ")})`);
            // A register's members are its columns, and they are known only once the page runs.
            const each = columns[index]![1].config.each;
            if (typeof each === "string") {
                throw new Error(`Record: column ${name} names "${key}", whose columns are the members of "${each}", known only once the page runs — head them with its \`groups\``);
            }
            const other = grouped.get(key);
            if (other !== undefined) throw new Error(`Record: column "${key}" is in ${other} and ${name} — a column sits in one group at most`);
            grouped.set(key, name);
            return index;
        });
        const sorted = [...at].sort((a, b) => a - b);
        if (sorted.some((index, i) => i > 0 && index !== sorted[i - 1]! + 1) || at.some((index, i) => index !== sorted[i])) {
            throw new Error(`Record: column ${name} holds ${group.columnKeys.join(", ")} — a group is a run of adjacent columns, named in column order`);
        }
    }
    // On a phone the title column is pinned at the left, the Sheet's pager stepping through the rest: a row is picked by its title.
    const titleKey = columns.find(([, col]) => col.kind === "title" && col.config.each === undefined)?.[0];
    let built: SheetPayloadParts;
    try {
        // A Record draws its own rows alone: Add drafts a new one, and no blank row invites it.
        // The rows its select column ticks reach the app at the record's key type, read back from their ids as the Sheet's root reads a key (east-workspace#1737).
        built = createSheetPayload({ ...sheet, blanks: 0, ...(titleKey !== undefined && { narrow: { pin: titleKey } }) }, { recordKinds: true, ...(onTick !== undefined ? { onTick } : {}) }) as unknown as SheetPayloadParts;
    } catch (e) {
        throw new Error(`Record: ${(e as Error).message.replace(/^Sheet: /, "")}`);
    }
    // What only a Record has, as the payload holds it.
    const own = {
        title: title === undefined ? none : some(title),
        noun: noun === undefined ? none : some({ singular: noun.singular, plural: noun.plural }),
        day: day === undefined ? none : some(day),
    };
    const startsAt = new Map((columnGroups ?? []).map((group) => [group.columnKeys[0]!, group]));
    const GroupsType = RecordPayloadType.fields.columnGroups;
    return Expr.block(($) => {
        const payload = $.const(built);
        const registers = $.const(payload.sheet.registers);
        // The column groups, in column order: the author's, a struct's columns named by their column's key; and each column
        // from data's own, one for each member of its `groups` register that heads any of its columns.
        const parts: ExprType<typeof GroupsType>[] = [];
        let fixed: { label: string; columnKeys: string[] }[] = [];
        for (const [key, col] of columns) {
            const group = startsAt.get(key);
            if (group !== undefined) {
                fixed.push({
                    label: group.label,
                    columnKeys: group.columnKeys.flatMap((named) => {
                        const each = columns.find(([k]) => k === named)![1].config.each;
                        return each !== undefined && typeof each !== "string" ? Object.keys(each).map((field) => `${named}:${field}`) : [named];
                    }),
                });
            }
            const { each, groups } = col.config;
            if (typeof each !== "string" || groups === undefined) continue;
            if (fixed.length > 0) parts.push(East.value(fixed, GroupsType));
            fixed = [];
            parts.push(groupMembers(registers.get(each).members, registers.get(groups).members).map((_$2, heads) => East.value({
                label: heads.label,
                columnKeys: heads.members.map((_$3, member) => East.str`${key}:${member.key}`),
            }, GroupsType.value)));
        }
        if (fixed.length > 0 || parts.length === 0) parts.push(East.value(fixed, GroupsType));
        return $.const({
            sheet: payload.sheet, ...own,
            columnGroups: parts.slice(1).reduce((all, part) => all.concat(part), parts[0]!),
            inspector: payload.inspector, history: payload.history, missing: payload.missing, autosave: payload.autosave, name: payload.name,
        }, RecordPayloadType);
    }) as ExprType<RecordPayloadType>;
}

// ============================================================================
// <Record>
// ============================================================================

/**
 * `<Record record={people} columns={{ … }} />` — the record's entries are the
 * rows, in key order, each row's id its key's text; `window`
 * (`Data.bindPaged(record)`) reads a large record a window at a time. Apply
 * commits each batch through the record's patch mutation. Beside a `slice`
 * whose `rows` source reads the record — `<Record slice={{ slice }}
 * record={people} columns={{ … }} />` — the rows are the source's, paged from
 * it, the rail's narrowing drawn over them, and Apply commits through
 * `record` by key (east-workspace#1622). Where the rows hold their own key in
 * a field, `keyField` names it, and a record the Record adds holds its key
 * there. Where the app builds a row's key from the row, `rowKey` does, and a row
 * stands under the key it builds. `onTick` hears the keys of the rows its select
 * column ticks, after each change of the ticks.
 */
export function RecordTag<K extends EastType, R extends StructTypeOf, C extends RecordColumnSpec<R, C>>(
    props: {
        record: SheetRecordHandle<K, R>;
        window?: unknown;
        /**
         * The field of the record's rows that holds each one's key, for a record whose rows carry their own — a crew
         * keyed by staff id, each member's `staff` their key. A row Add drafts shows its key there at once, and is
         * saved with it: where another Save takes the key first and the Record gives the row another, the field
         * follows. A column over the field shows it and takes no edit, and `newRow` need not give it. A row the
         * record holds already keeps what its field holds. The field is of the record's key type, and `rowKey` reads
         * another: one keyed by a field a person types takes `rowKey` alone.
         */
        keyField?: RecordKeyField<K, R>;
        /**
         * A row's key, built from the row: `(rack) => rack.code` keys each rack by the code a person types. A row Add
         * drafts goes under the key it builds at once, a cell still empty read as empty, and a row moves under another
         * key as an edit changes what its key reads — in the step of the edit, which Undo takes back with it. A key
         * another row stands under refuses the edit, and the Record says so. It builds a key of the record's key type,
         * and never reads the field `keyField` names. Never beside `newKey`.
         */
        rowKey?: KindKeyBuilder<R, K>;
        slice?: RecordSlicesChromeOptions;
        columns: C & RecordColumnsOf<R>;
    } & RecordCommon<R, C> & RecordTickOptions<K> & Pick<SheetOptions<R, K>, RecordSheetOptions>,
): UIElement;
/**
 * `<Record slice={{ slice }} columns={{ … }} />`
 * — the rows of the record the `rows` source of `slice` narrows, paged from
 * it, each row's id its record key: the rail draws its narrowing over them.
 * Handed no record, the Record is read only: with `record`, the record the
 * source reads, it saves (the form above). Nothing else this form is given
 * says the rows' key type, so its `onTick` is an East function at the `rows`
 * source's key type, `East.function([SetType(K)], NullType, …)`: a bare
 * lambda would hear a Set of no key type.
 */
export function RecordTag<K extends EastType, R extends StructTypeOf, C extends RecordColumnSpec<R, C>>(
    props: {
        slice: RecordSlicesChromeOptions;
        columns: C & RecordColumnsOf<R>;
    } & RecordCommon<R, C> & RecordTickOptions<K> & Pick<SheetOptions<R, K>, RecordSheetOptions>,
): UIElement;
export function RecordTag(props: { columns: unknown }): UIElement {
    return RecordComponent.Root(createRecordPayload(props as { columns: unknown } & { [prop: string]: unknown }));
}

/** The type of `<Record>` as a tag: every form its props take. */
export type RecordTagType = typeof RecordTag;
