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
 * removal.
 *
 * Its rows come from one of two sources:
 * - `record`, an e3 record bound with its patch mutation: its entries, in key
 *   order, each row's id its key's text; `window` (`Data.bindPaged(record)`)
 *   reads a large one a window at a time;
 * - the `rows` source of its `slice`, a `Slice.bindRecords` over the record:
 *   its rows, paged from it, the source's narrowing drawn over them, edits
 *   committed through `onApply` (`Record.onApply(record, { keyed: true })`).
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
    East,
    Expr,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    type EastType,
    type ExprType,
    type StructType as StructTypeOf,
} from "@elaraai/east";
import { Table, type UIElement } from "@elaraai/east-ui";
import { EastUI, type FieldHints, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { SheetRootType, SheetNounType } from "../sheet/types.js";
import {
    createSheetPayload, SheetInspectorPaneType, SheetHistoryType,
    type SheetCommon, type SheetRecordHandle,
} from "../sheet/sheet.js";
import type { SheetOptions, SheetIndexedOptions } from "../sheet/root.js";
import type { RecordAgeColumn, RecordNamedColumn, SheetColumn, SheetFieldKey } from "../sheet/columns.js";
import { groupMembers } from "../sheet/registers.js";

/** The Sheet's payload, as the Record reads the parts it keeps. */
type SheetPayloadParts = ExprType<StructType<{
    sheet: SheetRootType; inspector: OptionType<SheetInspectorPaneType>; history: OptionType<SheetHistoryType>;
    missing: OptionType<StringType>; name: OptionType<StringType>;
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

/** The Sheet's options a Record takes as they are. */
type RecordSheetOptions = "registers" | "newRow" | "newKey" | "edits" | "owned" | "readOnly" | "density" | "ready";

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
    /** Names the Record — needed only when one surface holds two. */
    name?: string;
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
    id: "a Record's rows are identified by their key",
    onUpdate: "a Record commits through the record",
    onPatch: "a Record commits through the record",
};

/**
 * Creates the Record's payload alone — what `<Record>` returns through the
 * `Record` carrier — for the tests and the renderer's fixtures, which read it
 * whole.
 *
 * @param props - The Record's props, as `<Record>` takes them
 * @returns An East expression of {@link RecordPayloadType}
 * @throws Error naming the prop and the remedy: a Sheet's prop a Record has no use for; a column group naming a key that is not a column or a column made from a register's members, holding no columns, or columns that are not adjacent, and a column in two groups; and everything the Sheet's root refuses of the rows, the columns and the registers
 * @internal
 */
export function createRecordPayload(props: { columns: unknown } & { [prop: string]: unknown }): ExprType<RecordPayloadType> {
    const { title, noun, columnGroups, ...sheet } = props as RecordAnyProps;
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
        built = createSheetPayload({ ...sheet, blanks: 0, ...(titleKey !== undefined && { narrow: { pin: titleKey } }) }, { recordKinds: true }) as unknown as SheetPayloadParts;
    } catch (e) {
        throw new Error(`Record: ${(e as Error).message.replace(/^Sheet: /, "")}`);
    }
    // What only a Record has, as the payload holds it.
    const own = {
        title: title === undefined ? none : some(title),
        noun: noun === undefined ? none : some({ singular: noun.singular, plural: noun.plural }),
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
            inspector: payload.inspector, history: payload.history, missing: payload.missing, name: payload.name,
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
 * commits each batch through the record's patch mutation.
 */
export function RecordTag<K extends EastType, R extends StructTypeOf, C extends RecordColumnSpec<R, C>>(
    props: {
        record: SheetRecordHandle<K, R>;
        window?: unknown;
        columns: C & RecordColumnsOf<R>;
    } & RecordCommon<R, C> & Pick<SheetOptions<R, K>, RecordSheetOptions>,
): UIElement;
/**
 * `<Record slice={{ slice }} columns={{ … }} onApply={Record.onApply(record, { keyed: true })} />`
 * — the rows of the record the `rows` source of `slice` narrows, paged from
 * it, each row's id its record key: the rail draws its narrowing over them,
 * and Apply commits through `onApply` by key. Without `onApply`, read only.
 */
export function RecordTag<K extends EastType, R extends StructTypeOf, C extends RecordColumnSpec<R, C>>(
    props: {
        slice: RecordSlicesChromeOptions;
        columns: C & RecordColumnsOf<R>;
    } & RecordCommon<R, C> & Pick<SheetOptions<R, K>, RecordSheetOptions> & Pick<SheetIndexedOptions<K, R>, "onApply">,
): UIElement;
export function RecordTag(props: { columns: unknown }): UIElement {
    return RecordComponent.Root(createRecordPayload(props as { columns: unknown } & { [prop: string]: unknown }));
}

/** The type of `<Record>` as a tag: every form its props take. */
export type RecordTagType = typeof RecordTag;
