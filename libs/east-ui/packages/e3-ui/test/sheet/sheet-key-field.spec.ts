/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record whose rows hold their own key in a field (`keyField`,
 * east-workspace#1705), as a Sheet and a Record are told it: what the sheet
 * carries to keep a new row's key in the field — an entry's draft and its row
 * under a key (`underKey`) — the column over the field, which takes no edit,
 * the constructor it no longer needs, the Save it hands the field, and what
 * each tag refuses. A row added in a browser, and one its session gives
 * another key, run in e3-ui-components' record spec, on e3.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, variant, type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { RecordSaveTypeFor, RecordToDraftResultType } from "@elaraai/e3-ui";
import { Record, SHEET_TITLE_CELL, Sheet, createSheetRootWith, recordRows } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { refusingPlatform } from "../refusing-platform.js";

// A crew keyed by staff id, each member's `staff` their key.
const Member = StructType({ staff: StringType, name: StringType });
const crewType = DictType(StringType, Member);
const CREW = new SortedMap([["S-1", { staff: "S-1", name: "Ada" }]], compareFor(StringType));
const crew = e3.record("key_field_crew", crewType, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
/** The name alone: the key field shown by no column. */
const NAMED = { name: Sheet.column.text(Member, { header: "Name" }) };
/** The key field shown, beside the name. */
const SHOWN = { staff: Sheet.column.text(Member, { header: "Staff" }), name: Sheet.column.text(Member, { header: "Name" }) };
const saved = East.asyncFunction([Editing.Types.ChangeSet(Member, StringType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

// The same crew keyed by a number its rows hold too.
const Numbered = StructType({ no: IntegerType, name: StringType });
const numberedType = DictType(IntegerType, Numbered);
const NUMBERED = new SortedMap([[1n, { no: 1n, name: "Ada" }]], compareFor(IntegerType));
const numbered = e3.record("key_field_numbered_crew", numberedType, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
const NUMBERED_SHOWN = { no: Sheet.column.integer(Numbered, { header: "No." }), name: Sheet.column.text(Numbered, { header: "Name" }) };
const numberedSaved = East.asyncFunction([Editing.Types.ChangeSet(Numbered, IntegerType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

// Orders keyed by their reference, each a group of lines: the key field is the group's.
const Line = StructType({ item: StringType, qty: IntegerType });
const Order = StructType({ ref: StringType, customer: StringType, lines: ArrayType(Line) });
const ordersType = DictType(StringType, Order);
const ORDERS = new SortedMap([["O-1", { ref: "O-1", customer: "Kestrel", lines: [{ item: "Hinge", qty: 4n }] }]], compareFor(StringType));
const LINES = { item: Sheet.column.text(Line, { header: "Item" }), qty: Sheet.column.integer(Line, { header: "Qty" }) };
const ordersSaved = East.asyncFunction([Editing.Types.ChangeSet(Order, StringType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

/** The crew's sheet with its key field named and shown, compiled. */
const keyedSheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const members = $.const(CREW, crewType);
    return createSheetRootWith(members, SHOWN, {}, { keyOrdered: true, applyKeyed: saved, keyField: "staff" });
}), []);
/** The same sheet told no key field. */
const plainSheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const members = $.const(CREW, crewType);
    return createSheetRootWith(members, SHOWN, {}, { keyOrdered: true, applyKeyed: saved });
}), []);
/** The numbered crew's sheet, its key field named and shown. */
const numberedSheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const members = $.const(NUMBERED, numberedType);
    return createSheetRootWith(members, NUMBERED_SHOWN, {}, { keyOrdered: true, applyKeyed: numberedSaved, keyField: "no" });
}), []);
/** The orders' sheet, grouped, the group's key field named: its title shows the customer. */
const ordersSheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const orders = $.const(ORDERS, ordersType);
    return createSheetRootWith(orders, LINES, { group: Sheet.group(Order, "lines", { title: "customer" }) }, { keyOrdered: true, applyKeyed: ordersSaved, keyField: "ref" });
}), []);

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type Row = ValueTypeOf<typeof Sheet.Types.Row>;
const encodeRow = encodeBeast2For(Sheet.Types.Row);
const decodeRow = decodeBeast2For(Sheet.Types.Row);
const sameCell = equalFor(OptionType(Sheet.Types.Cell));
const cellOf = (row: Row, column: string) => { const cell = row.cells.get(column); return cell === undefined ? none : some(cell); };
/** A row as a sheet's gesture hands it: its cells as typed, none of them the key's. */
const rowOf = (id: string, cells: [string, ValueTypeOf<typeof Sheet.Types.Cell>][]): Row =>
    ({ id, owned: false, cells: new SortedMap(cells, compareFor(StringType)), lines: [], band: none, subRows: [] });
/** A sheet's `underKey`, or a failure where it carries none. */
const underKeyOf = (root: Root) => {
    if (root.editing.underKey.type !== "some") assert.fail("expected the sheet to carry underKey");
    return root.editing.underKey.value;
};

/** Run `build` inside a bound handle's block, as a builder's factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

describe("a sheet told its record's key field", () => {
    const MemberDraft = Sheet.Types.Draft(Member);
    const encodeDraft = encodeBeast2For(MemberDraft);
    const decodeDraft = decodeBeast2For(MemberDraft);
    const sameDraft = equalFor(MemberDraft);

    test("carries `underKey`: an entry's draft and its row under a key hold the key in the field and in the cell of the column over it, the rest as they were — a draft that held another key among them; a sheet told none carries none", () => {
        const underKey = underKeyOf(keyedSheet());
        // A member just added: the name typed, the key field as the gesture left it.
        const added = underKey(
            encodeDraft({ staff: variant("missing", null), name: variant("value", "Grace") }),
            encodeRow(rowOf("S-2", [["name", variant("String", "Grace")], ["staff", variant("Null", null)]])),
            "S-2");
        assert.ok(sameDraft(decodeDraft(added.draft), { staff: variant("value", "S-2"), name: variant("value", "Grace") }));
        const row = decodeRow(added.row);
        assert.equal(row.id, "S-2");
        assert.ok(sameCell(cellOf(row, "staff"), some(variant("String", "S-2"))));
        assert.ok(sameCell(cellOf(row, "name"), some(variant("String", "Grace"))));
        // The same member given S-3, another Save having taken S-2: the field and its cell follow.
        const moved = underKey(added.draft, encodeRow({ ...row, id: "S-3" }), "S-3");
        assert.ok(sameDraft(decodeDraft(moved.draft), { staff: variant("value", "S-3"), name: variant("value", "Grace") }));
        assert.ok(sameCell(cellOf(decodeRow(moved.row), "staff"), some(variant("String", "S-3"))));
        assert.equal(plainSheet().editing.underKey.type, "none");
    });

    test("a key that is no String is read from its id's text, into the field and its cell", () => {
        const NumberedDraft = Sheet.Types.Draft(Numbered);
        const underKey = underKeyOf(numberedSheet());
        const added = underKey(
            encodeBeast2For(NumberedDraft)({ no: variant("missing", null), name: variant("value", "Grace") }),
            encodeRow(rowOf("7", [["name", variant("String", "Grace")]])),
            "7");
        assert.ok(equalFor(NumberedDraft)(decodeBeast2For(NumberedDraft)(added.draft), { no: variant("value", 7n), name: variant("value", "Grace") }));
        assert.ok(sameCell(cellOf(decodeRow(added.row), "no"), some(variant("Integer", 7n))));
    });

    test("with no column over the field the draft alone holds the key, and the row's cells are as they were", () => {
        const root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const members = $.const(CREW, crewType);
            return createSheetRootWith(members, NAMED, {}, { keyOrdered: true, applyKeyed: saved, keyField: "staff" });
        }), [])();
        const given = rowOf("S-2", [["name", variant("String", "Grace")]]);
        const added = underKeyOf(root)(encodeDraft({ staff: variant("missing", null), name: variant("value", "Grace") }), encodeRow(given), "S-2");
        assert.ok(sameDraft(decodeDraft(added.draft), { staff: variant("value", "S-2"), name: variant("value", "Grace") }));
        assert.ok(equalFor(Sheet.Types.Row)(decodeRow(added.row), given));
    });

    test("the column over the key field shows it and takes no edit; told no key field, it is edited as any other", () => {
        const editable = (root: Root) => root.columns.map((column) => `${column.key}:${column.editable ? "edited" : "shown"}`);
        assert.deepEqual(editable(keyedSheet()), ["staff:shown", "name:edited"]);
        assert.deepEqual(editable(plainSheet()), ["staff:edited", "name:edited"]);
    });

    test("a new row's key field needs no `newRow`, and is none of the fields only the app can give: a sheet that adds rows and shows no column over the field is refused without `keyField`, and builds with it", () => {
        const build = (keyField: string | undefined) => East.compile(East.function([], Sheet.Types.Root, ($) => {
            const members = $.const(CREW, crewType);
            return createSheetRootWith(members, NAMED, {}, { keyOrdered: true, applyKeyed: saved, keyField });
        }), [])();
        assert.throws(() => build(undefined), /a new row's "staff" is required, and no column or form sets it — give it in `newRow`, make it an Option, or `edits=\{\{ insertRows: false \}\}`/);
        assert.deepEqual(build("staff").editing.unsettable.row, []);
    });

    test("on a grouped sheet the key field is the group's: its draft holds the key under it, and a new group needs no `newGroup` for it", () => {
        const root = ordersSheet();
        assert.deepEqual(root.editing.unsettable.group, []);
        const OrderDraft = Sheet.Types.DraftGroup(Order, "lines");
        const band = { ...rowOf("O-2", [[SHEET_TITLE_CELL, variant("String", "Osprey")]]), band: some({ sub: "", folded: false }) };
        const added = underKeyOf(root)(
            encodeBeast2For(OrderDraft)({ ref: variant("missing", null), customer: variant("value", "Osprey"), lines: [] }),
            encodeRow(band), "O-2");
        assert.ok(equalFor(OrderDraft)(decodeBeast2For(OrderDraft)(added.draft), { ref: variant("value", "O-2"), customer: variant("value", "Osprey"), lines: [] }));
        assert.ok(equalFor(Sheet.Types.Row)(decodeRow(added.row), band));
    });

    test("is refused over rows that are no record's own entries: an Array's, identified by `id`", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const members = $.const([...CREW.values()], ArrayType(Member));
            $(createSheetRootWith(members, NAMED, { id: "staff" }, { keyField: "staff" }));
        }), /Sheet: `keyField` names a field of a record's own entries — its rows, or its groups — which a sheet over them reads by key/);
    });
});

describe("a record's rows handed a sheet with `keyField`", () => {
    const Batch = Editing.Types.ChangeSet(Member, StringType);

    test("the record's Save is made with the field, so a row the sheet adds is saved with its key there: over the entries read whole, and a window at a time", () => {
        inBlock(($) => {
            const record = $.let(Record.bind(crew));
            const rows = recordRows(record, { keyField: "staff" });
            assert.equal(rows.internal.keyField, "staff");
            assert.equal(recordRows(record).internal.keyField, undefined);
        });
        const toDraft = East.compile(East.function([Batch], RecordToDraftResultType, ($, pending) => {
            const record = $.let(Record.bind(crew));
            const save = $.const(recordRows(record, { keyField: "staff" }).internal.applyKeyed as ExprType<ReturnType<typeof RecordSaveTypeFor<typeof Batch>>>);
            return save.toDraft(pending);
        }), refusingPlatform);
        const answer = toDraft({
            requestId: "", base: variant("revision", "r0"), label: "",
            changes: [{ id: "S-2", patch: diffFor(OptionType(Member))(none, some({ staff: "", name: "Grace" })), place: some(variant("keyOrder", null)) }],
        });
        if (answer.type !== "draft") assert.fail(`expected a draft, got ${answer.type}`);
        const byStaff = compareFor(StringType);
        assert.ok(equalFor(PatchType(crewType))(decodeBeast2For(PatchType(crewType))(answer.value.args[0]!),
            diffFor(crewType)(new SortedMap([], byStaff), new SortedMap([["S-2", { staff: "S-2", name: "Grace" }]], byStaff))));
    });

    test("refuses a field the rows do not have, one of another type than the key, and one beside `entry`, whose rows are one entry's", () => {
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(crew)), { keyField: "badge" })),
            /Sheet: `keyField` names the field of an entry that holds its key, a \.String as the key is — "badge" is not a field of \.Struct/);
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(numbered)), { keyField: "name" })),
            /Sheet: `keyField` names the field of an entry that holds its key, a \.Integer as the key is — "name" is a \.String field of \.Struct/);
        const Week = StructType({ rows: ArrayType(StructType({ id: StringType, task: StringType })) });
        const weeks = e3.record("key_field_weeks", DictType(StringType, Week), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(weeks)), { entry: { key: "W42", rows: "rows", id: "id" }, keyField: "rows" })),
            /Sheet: `keyField` names the field of the record's entries that holds their key, and with `entry` the rows are one entry's, identified by `entry\.id` — leave it out/);
    });
});

describe("<Sheet> and <Record> with `keyField`", () => {
    test("a Sheet handed no record takes none, and names `record`; `id` over a record names `keyField`", () => {
        assert.throws(() => inBlock(($) => {
            const members = $.const([...CREW.values()], ArrayType(Member));
            return Sheet.Payload({ data: members, id: "staff", columns: NAMED, keyField: "staff" });
        }), /Sheet: `keyField` names the field of a record's rows that holds each one's key, which a sheet keeps for the rows it adds to the record it is handed — pass `record`; `data`'s rows are identified by `id`/);
        assert.throws(() => inBlock(($) => Sheet.Payload({ record: $.let(Record.bind(crew)), id: "staff", columns: NAMED })),
            /Sheet: `id` names the identity field of `data`'s rows — a record's rows are identified by their key, or by `entry\.id`; to name the sheet, pass `name`; and where a field of the record's rows holds their key too, name it with `keyField`/);
    });

    test("a Sheet and a Record handed the record and its key field build, the column over it read only; a Record's `id` names `keyField`", () => {
        inBlock(($) => {
            const members = $.let(Record.bind(crew));
            Sheet.Payload({ record: members, columns: SHOWN, keyField: "staff" });
            Record.Payload({ record: members, columns: { name: Record.column.title(Member, { header: "Name" }) }, keyField: "staff" });
        });
        assert.throws(() => inBlock(($) => Record.Payload({ record: $.let(Record.bind(crew)), columns: NAMED, id: "staff" })),
            /Record: takes no `id` — a Record's rows are identified by their key — where a field of theirs holds it too, name it with `keyField`/);
        assert.throws(() => inBlock(($) => Record.Payload({ record: $.let(Record.bind(crew)), columns: NAMED, keyField: "badge" })),
            /Record: `keyField` names the field of an entry that holds its key, a \.String as the key is — "badge" is not a field of \.Struct/);
    });
});

/** The tags' type checks: never called — `tsc` checks what each line says. */
export function keyFieldTagChecks($: BlockBuilder<NullType>): void {
    const members = $.let(Record.bind(crew));
    const byNumber = $.let(Record.bind(numbered));
    Sheet({ record: members, columns: SHOWN, keyField: "staff" });
    Sheet({ record: byNumber, columns: NUMBERED_SHOWN, keyField: "no" });
    // @ts-expect-error — `name` is a String, and the crew is keyed by an Integer
    Sheet({ record: byNumber, columns: NUMBERED_SHOWN, keyField: "name" });
    // @ts-expect-error — `badge` is no field of a member
    Sheet({ record: members, columns: SHOWN, keyField: "badge" });
}
