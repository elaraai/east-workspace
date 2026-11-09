/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record` — the tag and the namespace at once, as `Sheet` is: `<Record>`,
 * the table for a system of records, with the record binding beside it
 * (`Record.bind`, `Record.onApply`) and the vocabulary its tables are
 * written with: the columns (`Record.column.*`), the registers
 * (`Record.register.*`), the inspector's hints (`Record.field.*`), a new
 * row's values (`Record.patch`) and the types (`Record.Types.*`).
 *
 * @packageDocumentation
 */

import { Record as RecordBinding } from "../bind/record.js";
import {
    text, stamped, integer, quantity, date, enumColumn, reference, set,
    title, person, booleanColumn, toggle, cycle, age, audit,
} from "../sheet/columns.js";
import { action } from "../sheet/actions.js";
import { createMembers, concatMembers } from "../sheet/registers.js";
import { SheetField } from "../sheet/fields.js";
import { createPatch } from "../sheet/index.js";
import {
    RecordChangeType, RecordMarkType, SheetLinkType, SheetMemberType, SheetPatchTypeFor, sheetContextType,
} from "../sheet/types.js";
import { SheetNewRowType, SheetReadinessType, SheetFieldIssueType, SheetDraftTypeFor } from "../sheet/transactions.js";
import { RecordTag, RecordComponent, createRecordPayload, type RecordTagType } from "./record.js";

export {
    RecordTag,
    RecordComponent,
    RecordPayloadType,
    createRecordPayload,
    type RecordTagType,
    type RecordColumnSpec,
    type RecordColumnGroupInput,
    type RecordNounInput,
    type RecordCommon,
} from "./record.js";

/**
 * The type of `Record`: the `<Record>` tag — every form its props take — the
 * record binding, and the vocabulary a Record is written with. Declared
 * explicitly so the declaration emit stays within TypeScript's serialization
 * limit.
 */
export interface RecordNamespace extends RecordTagType {
    /** Binds an `e3.record` and its mutations to a reactive read/mutate handle. */
    bind: typeof RecordBinding.bind;
    /** Commits an editable collection's batches to the record, each Apply one commit through its patch door. */
    onApply: typeof RecordBinding.onApply;
    /** The column builders — each takes the row type first. */
    column: {
        /** Free text, edited in place. */
        text: typeof text;
        /** A read-only code an upstream system owns. */
        stamped: typeof stamped;
        /** A whole number. */
        integer: typeof integer;
        /** A float, with one `unit` for every row. */
        quantity: typeof quantity;
        /** A date, with the Sheet's date grammar. */
        date: typeof date;
        /** An upper-cased register word with a valence dot. */
        enum: typeof enumColumn;
        /** A lookup over a register. */
        reference: typeof reference;
        /** Comma members of a register. */
        set: typeof set;
        /** A variant's state machine — each case a state and the action into it. */
        action: typeof action;
        /** A checkbox. */
        boolean: typeof booleanColumn;
        /** A record's title, its initials before it with `avatar`. */
        title: typeof title;
        /** A person, by a register's key. */
        person: typeof person;
        /** Two states on a Boolean, each a word. */
        toggle: typeof toggle;
        /** A register's members, stepped by a click. */
        cycle: typeof cycle;
        /** Whole units from a moment to the browser's clock, keyed by a name of its own. */
        age: typeof age;
        /** The last change the app kept. */
        audit: typeof audit;
    };
    /** Registers — the members the reference, enum, set, person and cycle columns name. */
    register: {
        /** Members from rows through accessors, reified once; duplicates fold by key. */
        members: typeof createMembers;
        /** Joins member sets of different kinds into one register. */
        concat: typeof concatMembers;
    };
    /** The inspector's hints — `Fields`' own. */
    field: typeof SheetField;
    /** A row patch — `newRow`'s values: the fields it sets, every other `none`. */
    patch: typeof createPatch;
    /** The Record's East types. */
    Types: {
        /** The last change to a row, as the app keeps it — what an audit column shows and an age column counts from ({@link RecordChangeType}). */
        Change: typeof RecordChangeType;
        /** A cell's mark, what a column's `mark` returns: words drawn in the cell, or a lock the grid then won't edit through ({@link RecordMarkType}). */
        Mark: typeof RecordMarkType;
        /** What `newRow` is asked: where the new row lands. */
        NewRow: typeof SheetNewRowType;
        /** `Patch(R)` — a row patch, every field an `Option`. */
        Patch: typeof SheetPatchTypeFor;
        /** `Draft(R)` — a row's draft, each field missing, a value or unread text: what `ready.row` checks. */
        Draft: typeof SheetDraftTypeFor;
        /** `DraftContext(R)` — the draft-aware context `ready.row` reads. */
        DraftContext: typeof sheetContextType;
        /** A row's readiness, as `ready.row` answers. */
        Readiness: typeof SheetReadinessType;
        /**
         * One field's issue in a readiness answer: its `field` the row's field — or one cell of a column from data, by
         * the cell's column key (`hours:P-100`); an issue naming the field such columns write marks no cell.
         */
        FieldIssue: typeof SheetFieldIssueType;
        /** The typed link a set column holds — `{ from, to }` member lists. */
        Link: typeof SheetLinkType;
        /** One member of a link. */
        Member: typeof SheetMemberType;
    };
}

/** The namespace's members — everything `Record` carries beside the tag itself. */
const RECORD_MEMBERS = {
    bind: RecordBinding.bind,
    onApply: RecordBinding.onApply,
    column: {
        text, stamped, integer, quantity, date, enum: enumColumn, reference, set, action,
        boolean: booleanColumn, title, person, toggle, cycle, age, audit,
    },
    register: { members: createMembers, concat: concatMembers },
    field: SheetField,
    patch: createPatch,
    Types: {
        Change: RecordChangeType,
        Mark: RecordMarkType,
        NewRow: SheetNewRowType,
        Patch: SheetPatchTypeFor,
        Draft: SheetDraftTypeFor,
        DraftContext: sheetContextType,
        Readiness: SheetReadinessType,
        FieldIssue: SheetFieldIssueType,
        Link: SheetLinkType,
        Member: SheetMemberType,
    },
};

/**
 * The table for a system of records, `<Record>`: the record's entries in the
 * east-ui Table's anatomy, its columns the Sheet's kinds and the Record's own
 * — a title, a person, a boolean, a toggle, a cycle, the time since a moment
 * and the last change the app kept — each edit a draft of the shared editing
 * session behind one history bar. It renders in its `BuilderFrame`: one
 * toolbar (the title, the rail, the status line, Add and Delete, the history
 * bar), the grid with the strip under it, the footer, and the inspector pane.
 *
 * @remarks
 * - **The rows** are `record`'s entries, in key order, each row's id its
 *   key's text (`window` reads a large one a window at a time), or the record
 *   the `rows` source of `slice` narrows, paged from it, the narrowing drawn
 *   over them; then `onApply={Record.onApply(record, { keyed: true })}`
 *   commits.
 * - **The columns** are keyed by the row's fields, each built over the row
 *   type: a kind on a field it cannot sit on is a type error. An age column
 *   alone is keyed by a name of its own, since it shows no field.
 * - **The journal** is the row's own fields: an audit column shows a
 *   `Record.Types.Change` field the app's own processes write, and an age
 *   column counts from it to the browser's clock. The Record never writes it.
 * - **Column groups** run over adjacent columns under one label, and the
 *   inspector's sections follow them. A Record draws no group rows: the rail
 *   filters by a field, over the record's index on it.
 * - **Add** drafts an empty record, every field empty unless `newRow` sets it;
 *   **Delete** drafts the ticked rows' removal. Apply waits for every issue —
 *   a new row's empty required field, and each refusal of `ready`.
 *
 * The Record fills its parent and draws no border of its own. `name` keeps two
 * Records on one surface apart.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { ArrayType, BooleanType, DictType, East, StringType, StructType, some } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const Crew = StructType({ name: StringType, inducted: BooleanType, forklift: StringType });
 * export const recordCrew = e3.record("record_crew", DictType(StringType, Crew), {
 *     initial: new Map([
 *         ["C-001", { name: "A. Morgan", inducted: true, forklift: "2" }],
 *         ["C-002", { name: "B. Ellis", inducted: false, forklift: "0" }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 *
 * const crew = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const members = $.let(Record.bind(recordCrew));
 *         const LevelType = StructType({ key: StringType, name: StringType });
 *         const levels = $.let([
 *             { key: "0", name: "Not trained" },
 *             { key: "1", name: "Supervised" },
 *             { key: "2", name: "Competent" },
 *         ], ArrayType(LevelType));
 *         return (
 *             <Box height="360px">
 *                 <Record
 *                     record={members}
 *                     title="Crew"
 *                     noun={{ singular: "crew member", plural: "crew members" }}
 *                     registers={{ levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }) }}
 *                     columns={{
 *                         name:     Record.column.title(Crew, { header: "Name", width: "160px" }),
 *                         inducted: Record.column.toggle(Crew, { header: "Inducted", width: "80px", on: "yes", off: "no" }),
 *                         forklift: Record.column.cycle(Crew, "levels", { header: "Forklift", width: "72px", scale: true }),
 *                     }}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export const Record: RecordNamespace = Object.assign(RecordTag, RECORD_MEMBERS);

/**
 * The type of the internal Record namespace — the public one, the payload the
 * tag returns through its carrier, and the carrier the renderer registers
 * against.
 */
export interface RecordInternalNamespace extends RecordNamespace {
    /** Creates the Record's payload alone ({@link createRecordPayload}). */
    Payload: typeof createRecordPayload;
    /** The `Record` carrier ({@link RecordComponent}). */
    Component: typeof RecordComponent;
}

/** `<Record>`, for the internal namespace: the tag, on an object of its own, so the public `Record` carries none of the internal members. */
function RecordInternalTag(props: { columns: unknown }): ReturnType<RecordTagType> {
    return (RecordTag as (p: { columns: unknown }) => ReturnType<RecordTagType>)(props);
}

/**
 * The internal Record namespace — `@elaraai/e3-ui/internal`'s `Record`: the
 * public one, `Record.Payload` and the `Record` carrier, for the renderer and
 * the tests.
 *
 * @internal
 */
export const RecordInternal: RecordInternalNamespace = Object.assign(RecordInternalTag as RecordTagType, RECORD_MEMBERS, {
    Payload: createRecordPayload,
    Component: RecordComponent,
});
