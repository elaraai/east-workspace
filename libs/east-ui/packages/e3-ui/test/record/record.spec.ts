/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record (`Record - DX Proposal.md`): the examples, the indexed work
 * orders paged and never read whole; the Record's column kinds on the wire — a title, a person, a boolean, a toggle, a cycle, an age
 * and an audit, and a quantity's unit — their cells, the age's count to a
 * clock and the audit's who and what; a cycle over a variant's steps
 * (`Record Columns From Data - DX Proposal.md` §2.3); columns from data — a
 * column per member of a register or per field of a struct, their groups and
 * the functions their cells read and write through (§2), their cells and
 * every column's marks read at the Record's day over a row's entry or its
 * draft, and a gesture's edits written over the draft (§5.2); the columns
 * map's typing; and every refusal, naming the column or the prop — a new
 * row's field no person can set among them (#1526).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant, type EastIR, type ValueTypeOf,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { FieldSpecType } from "@elaraai/east-ui/internal";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import {
    Data, Record, RecordPayloadType, Sheet, SheetInspectorPaneType, SheetReadFromType, SheetUnsettableType, buildInspectorPane, createSheetBuild, createSheetRootWith,
    deriveManifest,
} from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import { indexedWorkOrders } from "../sheet/sheet-records.examples.js";
import * as ex from "./record.examples.js";

describeEast("Record — examples", test => {
    Assert.examples(test, {
        recordBasic: ex.recordBasic,
        recordSkillsMatrix: ex.recordSkillsMatrix,
        recordShiftPreferences: ex.recordShiftPreferences,
        recordEveryKind: ex.recordEveryKind,
        recordSkillsReadOnly: ex.recordSkillsReadOnly,
        recordLooks: ex.recordLooks,
        recordFinishes: ex.recordFinishes,
        recordOrderStatus: ex.recordOrderStatus,
        recordHoursByProject: ex.recordHoursByProject,
        recordRosterByDay: ex.recordRosterByDay,
        recordSkillHistory: ex.recordSkillHistory,
        recordPreferenceSnapshots: ex.recordPreferenceSnapshots,
        recordIndexedWorkOrders: ex.recordIndexedWorkOrders,
        recordIndexedWorkOrdersMobile: ex.recordIndexedWorkOrdersMobile,
    });
}, { platformFns: TestImpl });

describe("the Record over 50,000 indexed work orders", () => {
    for (const [frame, example] of [["the desktop", ex.recordIndexedWorkOrders], ["the phone", ex.recordIndexedWorkOrdersMobile]] as const) {
        test(`${frame}'s pages the record through its indexes, never reading it whole, and commits through its patch door`, () => {
            const manifest = deriveManifest(example.fn);
            assert.deepEqual(manifest.pages, [indexedWorkOrders.path]);
            assert.equal(manifest.paths.length, 0, "the Record never reads the whole record");
            assert.ok(manifest.records.length > 0, "the record's patch door is declared");
            const component = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
            // The reactive function and the index definitions it captures survive the UI wire.
            const roundtrip = decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component));
            assert.equal(roundtrip.type, component.type);
        });
    }
});

// ── Fixtures: one row of every Record kind, inline ──

const Person = StructType({
    id: StringType, name: StringType, lead: OptionType(StringType), inducted: BooleanType, night: BooleanType,
    level: StringType, hours: FloatType, updated: OptionType(Record.Types.Change), since: DateTimeType,
});
type PersonValue = ValueTypeOf<typeof Person>;
const PEOPLE: PersonValue[] = [
    { id: "P-1", name: "A. Morgan", lead: some("S. Park"), inducted: true, night: false, level: "2", hours: 38.5,
        updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }), since: new Date("2026-11-01T00:00:00Z") },
    { id: "P-2", name: "B. Ellis", lead: none, inducted: false, night: true, level: "0", hours: 12.0,
        updated: none, since: new Date("2026-11-04T00:00:00Z") },
];
const Level = StructType({ key: StringType, name: StringType });
const LEVELS = [{ key: "0", name: "Not trained" }, { key: "1", name: "Supervised" }, { key: "2", name: "Competent" }];
const LEADS = ["S. Park", "M. Hale"];

/** One column of every Record kind, over the people. */
const PEOPLE_COLUMNS = {
    name:       Record.column.title(Person, { header: "Name", avatar: true }),
    lead:       Record.column.person(Person, "leads", { header: "Lead", unassigned: "No lead" }),
    inducted:   Record.column.boolean(Person, { header: "Inducted" }),
    night:      Record.column.toggle(Person, { header: "Nights", on: "yes", off: "no", look: "mark" }),
    level:      Record.column.cycle(Person, "levels", { header: "Forklift", scale: true }),
    hours:      Record.column.quantity(Person, { header: "Hours", unit: "hrs" }),
    days_since: Record.column.age(Person, { header: "Days since", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
    weeks_in:   Record.column.age(Person, { header: "Weeks in", since: p => p.since, unit: "weeks" }),
    updated:    Record.column.audit(Person, { header: "Last updated", mode: "blame" }),
};
const PEOPLE_OPTIONS = {
    id: "id" as const,
    registers: {
        levels: Record.register.members(East.value(LEVELS, ArrayType(Level)), { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }),
        leads: Record.register.members(East.value(LEADS, ArrayType(StringType)), { kind: "person", key: p => p, label: p => p }),
    },
};

/** The people's root, inline. */
const people = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(PEOPLE, ArrayType(Person));
    return createSheetRootWith(rows, PEOPLE_COLUMNS, PEOPLE_OPTIONS, { recordKinds: true });
}), []);

/** The people's inspector pane, over the same columns. */
const peopleForms = East.compile(East.function([], OptionType(SheetInspectorPaneType), ($) => {
    const rows = $.const(PEOPLE, ArrayType(Person));
    const built = createSheetBuild(rows, PEOPLE_COLUMNS, PEOPLE_OPTIONS, { recordKinds: true });
    return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
}), []);

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type Kind = ValueTypeOf<typeof Sheet.Types.ColumnKind>;
const ROOT: Root = people();

/** A column's kind, by its key. */
function kindOf(key: string): Kind {
    const column = ROOT.columns.find((c) => c.key === key);
    if (column === undefined) assert.fail(`no column ${key}`);
    return column.kind;
}

/** A row's cell, by the row's id and the cell's key. */
function cellOf(id: string, key: string): ValueTypeOf<typeof Sheet.Types.Cell> | undefined {
    if (ROOT.rows.type !== "inline") assert.fail(`expected inline rows, got ${ROOT.rows.type}`);
    const row = ROOT.rows.value.find((r) => r.id === id);
    if (row === undefined) assert.fail(`no row ${id}`);
    return row.cells.get(key);
}

describe("the Record's kinds on the wire", () => {
    test("a title, a person, a boolean and a toggle carry their words", () => {
        assert.deepEqual(kindOf("name"), variant("title", { avatar: true }));
        assert.deepEqual(kindOf("lead"), variant("person", { register: "leads", unassigned: some("No lead") }));
        assert.deepEqual(kindOf("inducted"), variant("boolean", null));
        assert.deepEqual(kindOf("night"), variant("toggle", { on: "yes", off: "no", look: variant("mark", null) }));
    });

    test("a title's `value` is a projection shown read only — a name, or the row's id where it has none", () => {
        const Named = StructType({ id: StringType, name: OptionType(StringType) });
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const([{ id: "P-1", name: some("A. Morgan") }, { id: "P-2", name: none }], ArrayType(Named));
            return createSheetRootWith(rows, {
                name: Record.column.title(Named, { header: "Name", value: (p) => p.name.match({ some: (_$, name) => name, none: () => p.id }) }),
            }, { id: "id" }, { recordKinds: true });
        }), [])();
        const column = root.columns.find((c) => c.key === "name") ?? assert.fail("no name column");
        const Kind = Sheet.Types.ColumnKind;
        assert.ok(equalFor(Kind)(column.kind, variant("title", { avatar: false })), printFor(Kind)(column.kind));
        assert.equal(column.editable, false);
        if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
        const Titles = ArrayType(Sheet.Types.Cell);
        const titles = root.rows.value.map((r) => r.cells.get("name") ?? variant("Null", null));
        assert.ok(equalFor(Titles)(titles, [variant("String", "A. Morgan"), variant("String", "P-2")]), printFor(Titles)(titles));
    });

    test("a cycle names its register, and a scale steps up the ramp", () => {
        assert.deepEqual(kindOf("level"), variant("cycle", { register: "levels", scale: true, look: variant("chip", null) }));
        assert.deepEqual(cellOf("P-1", "level"), variant("String", "2"));
    });

    test("a quantity carries one unit for every row", () => {
        const kind = kindOf("hours");
        if (kind.type !== "quantity") assert.fail(kind.type);
        assert.deepEqual(kind.value.unit, some("hrs"));
    });

    test("an age's cell is the moment since reads — a change's at, or none", () => {
        assert.deepEqual(cellOf("P-1", "days_since"), variant("DateTime", new Date("2026-09-18T09:12:00Z")));
        assert.deepEqual(cellOf("P-2", "days_since"), variant("Null", null));
        assert.deepEqual(cellOf("P-2", "weeks_in"), variant("DateTime", new Date("2026-11-04T00:00:00Z")));
        const column = ROOT.columns.find((c) => c.key === "days_since")!;
        assert.equal(column.editable, false);
    });

    test("an age counts whole units to the clock it is given, and 0 ahead of it", () => {
        const days = kindOf("days_since");
        const weeks = kindOf("weeks_in");
        if (days.type !== "age" || weeks.type !== "age") assert.fail(`${days.type}, ${weeks.type}`);
        assert.deepEqual(days.value.stale, some(90n));
        assert.deepEqual(days.value.absent, some("not confirmed"));
        const now = new Date("2026-11-05T09:30:00Z");
        assert.equal(days.value.elapsed(new Date("2026-09-18T09:12:00Z"), now), 48n);
        assert.equal(days.value.elapsed(new Date("2026-07-10T08:30:00Z"), now), 118n);
        assert.equal(weeks.value.elapsed(new Date("2026-10-01T00:00:00Z"), now), 5n);
        assert.equal(days.value.elapsed(new Date("2026-11-06T00:00:00Z"), now), 0n);
    });

    test("an audit's cell is the change's moment, its who and what in the rule cells", () => {
        assert.deepEqual(kindOf("updated"), variant("audit", { mode: variant("blame", null), absent: none, by: "$by:updated", verb: "$verb:updated" }));
        assert.deepEqual(cellOf("P-1", "updated"), variant("DateTime", new Date("2026-09-18T09:12:00Z")));
        assert.deepEqual(cellOf("P-1", "$by:updated"), variant("String", "M. Hale"));
        assert.deepEqual(cellOf("P-1", "$verb:updated"), variant("String", "confirmed"));
        assert.deepEqual(cellOf("P-2", "updated"), variant("Null", null));
        assert.deepEqual(cellOf("P-2", "$by:updated"), variant("Null", null));
    });

    test("the inspector edits each kind by its field, shows no age, and reads an audit only", () => {
        const pane = peopleForms();
        if (pane.type !== "some") assert.fail("no inspector pane");
        const editors = new Map(pane.value.forms.row.fields.map((f) => [f.spec.path.join("."), f.spec.editor]));
        assert.deepEqual(editors.get("name"), variant("text", { placeholder: none }));
        assert.deepEqual(editors.get("lead"), variant("reference", { of: "leads" }));
        assert.deepEqual(editors.get("level"), variant("reference", { of: "levels" }));
        assert.deepEqual(editors.get("inducted"), variant("checkbox", null));
        assert.deepEqual(editors.get("night"), variant("checkbox", null));
        assert.deepEqual(editors.get("updated"), variant("readonly", null));
        assert.equal(editors.has("days_since"), false);
        assert.equal(pane.value.forms.row.readonly.includes("days_since"), false);
        assert.ok(pane.value.forms.row.readonly.includes("updated"));
    });
});

// ── A cycle over a variant: its cases stepped in the order given ──

const Stage = VariantType({ draft: NullType, review: NullType, done: NullType });
const Order = StructType({ id: StringType, customer: StringType, stage: Stage });
const ORDERS: ValueTypeOf<typeof Order>[] = [
    { id: "O-1", customer: "Ashgrove", stage: variant("review", null) },
    { id: "O-2", customer: "Bellmoor", stage: variant("draft", null) },
];
const ORDER_COLUMNS = {
    customer: Record.column.title(Order, { header: "Customer" }),
    stage: Record.column.cycle(Order, Stage, {
        header: "Stage", scale: true,
        // Not the order East keeps the cases in — done, draft, review — but a click's.
        steps: [
            { case: "draft", label: "Draft", tone: "neutral" },
            { case: "review", label: "In review", meta: "With the checker", aliases: ["checking"] },
            { case: "done", label: "Done", tone: "success" },
        ],
    }),
};
const ORDERS_ROOT: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(ORDERS, ArrayType(Order));
    return createSheetRootWith(rows, ORDER_COLUMNS, { id: "id" }, { recordKinds: true });
}), [])();
const OrderDraft = Record.Types.Draft(Order);

describe("a cycle over a variant", () => {
    test("its steps are a register keyed by the cases' names, in the order its steps give, and its cell its case's key", () => {
        const column = ORDERS_ROOT.columns.find((c) => c.key === "stage");
        if (column === undefined) assert.fail("no stage column");
        const kind = variant("cycle", { register: "$steps:stage", scale: true, look: variant("chip", null) });
        assert.ok(equalFor(Sheet.Types.ColumnKind)(column.kind, kind), printFor(Sheet.Types.ColumnKind)(column.kind));
        const MembersType = Sheet.Types.Root.fields.registers.value.fields.members;
        const steps = ORDERS_ROOT.registers.get("$steps:stage");
        if (steps === undefined) assert.fail("no register of the steps");
        assert.ok(equalFor(MembersType)(steps.members, [
            { key: "draft", label: "Draft", kind: "stage", aliases: [], meta: none, parent: none, tone: some(variant("neutral", null)) },
            { key: "review", label: "In review", kind: "stage", aliases: ["checking"], meta: some("With the checker"), parent: none, tone: none },
            { key: "done", label: "Done", kind: "stage", aliases: [], meta: none, parent: none, tone: some(variant("success", null)) },
        ]), printFor(MembersType)(steps.members));
        if (ORDERS_ROOT.rows.type !== "inline") assert.fail(`expected inline rows, got ${ORDERS_ROOT.rows.type}`);
        const cell = ORDERS_ROOT.rows.value.find((r) => r.id === "O-1")?.cells.get("stage");
        assert.ok(cell !== undefined && equalFor(Sheet.Types.Cell)(cell, variant("String", "review")), cell === undefined ? "no cell" : printFor(Sheet.Types.Cell)(cell));
    });

    test("a step's key decodes to its case, and a key no case has is kept as typed", () => {
        const decode = East.compile(East.function([StringType], undefined, ($, key) => {
            const rows = $.const(ORDERS, ArrayType(Order));
            const built = createSheetBuild(rows, ORDER_COLUMNS, { id: "id" }, { recordKinds: true });
            const draftRow = $.const(built.bridge.draftRow);
            const cells = $.let(new Map(), DictType(StringType, Sheet.Types.Cell));
            $(cells.insert("stage", East.value(variant("String", key), Sheet.Types.Cell)));
            return draftRow("O-1", cells, none);
        }), []);
        const StageDraft = OrderDraft.fields.stage;
        const done = decode("done").stage;
        assert.ok(equalFor(StageDraft)(done, variant("value", variant("done", null))), printFor(StageDraft)(done));
        const lost = decode("lost").stage;
        assert.ok(equalFor(StageDraft)(lost, variant("invalid", "lost")), printFor(StageDraft)(lost));
    });

    test("the inspector chooses its field among the variant's cases, in its steps' order and words", () => {
        const pane = East.compile(East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(ORDERS, ArrayType(Order));
            const built = createSheetBuild(rows, ORDER_COLUMNS, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        if (pane.type !== "some") assert.fail("no inspector pane");
        const spec = pane.value.forms.row.fields.find((f) => f.spec.path.join(".") === "stage")?.spec;
        if (spec === undefined) assert.fail("no stage field");
        const select = variant("select", [{ case: "draft", label: "Draft" }, { case: "review", label: "In review" }, { case: "done", label: "Done" }]);
        assert.ok(equalFor(FieldSpecType.fields.editor)(spec.editor, select), printFor(FieldSpecType.fields.editor)(spec.editor));
        assert.ok(equalFor(FieldSpecType.fields.type)(spec.type, toEastTypeValue(Stage)), printFor(FieldSpecType.fields.type)(spec.type));
    });
});

// ── Refusals ──

const Row = StructType({ id: StringType, name: StringType, flag: BooleanType, updated: OptionType(Record.Types.Change) });
const ROWS = East.value([{ id: "a", name: "A", flag: true, updated: none }], ArrayType(Row));

describe("the Record's kinds refuse", () => {
    test("a Sheet refuses them, naming the column", () => {
        assert.throws(() => Sheet.Root(ROWS, { flag: Record.column.boolean(Row) } as never, { id: "id" }),
            /column "flag" is a boolean column, which a Record draws and a Sheet does not/);
    });

    // The Sheet's root says them in its words; the Record says them in its own (below).
    test("an age keyed by a field of the row", () => {
        assert.throws(() => createSheetRootWith(ROWS, { name: Record.column.age(Row, { since: r => r.updated }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: column "name" is an age column, which shows no field/);
    });

    test("an age whose since reads no moment", () => {
        assert.throws(() => createSheetRootWith(ROWS, { days: Record.column.age(Row, { since: r => r.name as never }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: age column "days" has a `since` returning String/);
    });

    test("an audit on a field that holds no change", () => {
        assert.throws(() => createSheetRootWith(ROWS, { name: Record.column.audit(Row) as never }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: audit column "name" must sit on a Record\.Types\.Change/);
    });

    test("a cycle or a toggle on a field of the wrong type", () => {
        assert.throws(() => createSheetRootWith(ROWS, { flag: Record.column.cycle(Row, "levels") as never }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: cycle column "flag" must sit on a String/);
        assert.throws(() => createSheetRootWith(ROWS, { name: Record.column.toggle(Row, { on: "y", off: "n" }) as never }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: toggle column "name" must sit on a Boolean/);
    });

    test("a cycle over a variant on a field not holding it, steps leaving out, repeating or inventing a case, and a register under its steps' name", () => {
        const rows = East.value(ORDERS, ArrayType(Order));
        const draft = { case: "draft" as const, label: "Draft" };
        const review = { case: "review" as const, label: "In review" };
        const done = { case: "done" as const, label: "Done" };
        assert.throws(() => createSheetRootWith(rows, { customer: Record.column.cycle(Order, Stage, { steps: [draft, review, done] }) as never }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: cycle column "customer" steps through a variant's cases, but sits on a String field/);
        assert.throws(() => createSheetRootWith(rows, { stage: Record.column.cycle(Order, Stage, { steps: [draft, done] }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: cycle column "stage" leaves "review" out of its steps — name every case of its variant/);
        assert.throws(() => createSheetRootWith(rows, { stage: Record.column.cycle(Order, Stage, { steps: [draft, review, draft, done] }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: cycle column "stage" names the case "draft" twice in its steps/);
        assert.throws(() => createSheetRootWith(rows, { stage: Record.column.cycle(Order, Stage, { steps: [draft, review, done, { case: "lost" as never, label: "Lost" }] }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: cycle column "stage" has a step "lost", which is not a case of its variant \(done, draft, review\)/);
        const taken = { "$steps:stage": Record.register.members(East.value(["x"], ArrayType(StringType)), { kind: "x", key: (x) => x, label: (x) => x }) };
        assert.throws(() => createSheetRootWith(rows, { stage: Record.column.cycle(Order, Stage, { steps: [draft, review, done] }) }, { id: "id", registers: taken }, { recordKinds: true }),
            /^Error: Sheet: `registers` declares "\$steps:stage", the name column "stage"'s steps take/);
    });
});

/** A record whose last change is no Option: a new row needs one, and no person can set it. */
const Audited = StructType({ name: StringType, updated: Record.Types.Change });
const recordAudited = e3.record("record_audited", DictType(StringType, Audited), {
    initial: new Map([["A-1", { name: "A. Morgan", updated: { at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" } }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

describe("<Record> refuses", () => {
    const columns = {
        name: Record.column.title(ex.Crew),
        inducted: Record.column.toggle(ex.Crew, { on: "yes", off: "no" }),
        forklift: Record.column.cycle(ex.Crew, "levels"),
    };
    const registers = { levels: Record.register.members(East.value(["0", "1"], ArrayType(StringType)), { kind: "level", key: l => l, label: l => l }) };

    test("a Sheet's prop it has no use for", () => {
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, group: {} }), /Record: takes no `group` — a Record draws no group rows/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, templates: [] }), /Record: takes no `templates`/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, narrow: { pin: "forklift" } }),
            /Record: takes no `narrow` — a Record pins its title column on a phone/);
    });

    test("a column group naming no column, holding none, out of order, or overlapping another", () => {
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, columnGroups: [{ label: "Core", columnKeys: ["shift"] }] }),
            /column group "Core" names "shift", which is not a column \(name, inducted, forklift\)/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, columnGroups: [{ label: "", columnKeys: [] }] }),
            /an unlabelled group holds no columns/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, columnGroups: [{ label: "Core", columnKeys: ["name", "forklift"] }] }),
            /a group is a run of adjacent columns/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, columnGroups: [{ label: "Core", columnKeys: ["forklift", "inducted"] }] }),
            /a group is a run of adjacent columns, named in column order/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns, registers, columnGroups: [{ label: "A", columnKeys: ["name"] }, { label: "B", columnKeys: ["name"] }] }),
            /column "name" is in group "A" and group "B"/);
    });

    test("the Sheet root's refusals, in the Record's words", () => {
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordCrew), columns }), /^Error: Record: column "forklift" names register "levels", which `registers` does not declare/);
    });

    test("a new row's field no person can set — an audit on a `Change`, not its Option — with Add on and no `newRow`, naming it; a `newRow` leaving it unset builds, the field the renderer refuses an Add over (#1526)", () => {
        const audited = { name: Record.column.title(Audited, { header: "Name" }), updated: Record.column.audit(Audited, { header: "Last updated" }) };
        assert.throws(() => Record.Payload({ record: Record.bind(recordAudited), columns: audited }),
            /^Error: Record: a new row's "updated" is required, and no column or form sets it — give it in `newRow`/);
        const payload = East.compile(East.function([], RecordPayloadType, ($) => {
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Audited), () => Record.patch(Audited, {})));
            return Record.Payload({ record: Record.bind(recordAudited), window: Data.bindPaged(recordAudited), columns: audited, newRow });
        }), refusingPlatform)();
        const unsettable = payload.sheet.editing.unsettable.row;
        assert.ok(equalFor(ArrayType(SheetUnsettableType))(unsettable, [{ field: "updated", label: "Last updated" }]), printFor(ArrayType(SheetUnsettableType))(unsettable));
    });

    test("builds a payload with its title, noun and column groups, and its title column the one a phone pins, as the renderer decodes them", () => {
        // Over a window, the payload is built without reading the record.
        const payload = East.compile(East.function([], RecordPayloadType, () => Record.Payload({
            record: Record.bind(ex.recordCrew), window: Data.bindPaged(ex.recordCrew), columns, registers, title: "Crew", noun: { singular: "crew member", plural: "crew members" },
            columnGroups: [{ label: "Skills", columnKeys: ["inducted", "forklift"] }],
        })), refusingPlatform)();
        const field = RecordPayloadType.fields;
        assert.ok(equalFor(field.title)(payload.title, some("Crew")));
        assert.ok(equalFor(field.noun)(payload.noun, some({ singular: "crew member", plural: "crew members" })));
        assert.ok(equalFor(field.columnGroups)(payload.columnGroups, [{ label: "Skills", columnKeys: ["inducted", "forklift"] }]));
        assert.ok(equalFor(field.name)(payload.name, none));
        const narrowEqual = equalFor(field.sheet.fields.narrow);
        assert.ok(narrowEqual(payload.sheet.narrow, some({ pin: some("name"), columns: none })));
        // With no title column, a phone pins none: every column pages. No column sets a name, so this Record adds no one.
        const untitled = East.compile(East.function([], RecordPayloadType, () => Record.Payload({
            record: Record.bind(ex.recordCrew), window: Data.bindPaged(ex.recordCrew), columns: { inducted: columns.inducted, forklift: columns.forklift }, registers,
            edits: { insertRows: false },
        })), refusingPlatform)();
        assert.ok(narrowEqual(untitled.sheet.narrow, none));
    });
});

describe("the columns map's typing", () => {
    // Each is refused by the compiler; built, each is refused again as the root is — in the Record's words, once.
    test("an age under a field's key, and another kind under a name no field has", () => {
        assert.throws(() => Record({
            record: Record.bind(ex.recordSkills),
            columns: {
                // @ts-expect-error — an age shows no field, so a field's key cannot hold one
                name: Record.column.age(ex.Skills, { since: p => p.updated }),
            },
        }), /^Error: Record: column "name" is an age column, which shows no field/);
        assert.throws(() => Record({
            record: Record.bind(ex.recordSkills),
            columns: {
                // @ts-expect-error — only an age column takes a name no field has
                nickname: Record.column.text(ex.Skills),
            },
        }), /column "nickname" is not a field of the row type/);
    });

    test("a kind on a field it cannot sit on", () => {
        assert.throws(() => Record({
            record: Record.bind(ex.recordCrew),
            registers: { levels: Record.register.members(East.value(["0"], ArrayType(StringType)), { kind: "level", key: l => l, label: l => l }) },
            columns: {
                // @ts-expect-error — a cycle sits on a String field
                inducted: Record.column.cycle(ex.Crew, "levels"),
            },
        }), /^Error: Record: cycle column "inducted" must sit on a String/);
    });

    test("a cycle over a variant one of whose cases holds data", () => {
        const Held = VariantType({ held: StringType, open: NullType });
        const Holding = StructType({ id: StringType, state: Held });
        const rows = East.value([{ id: "a", state: variant("open", null) }], ArrayType(Holding));
        assert.throws(() => createSheetRootWith(rows, {
            // @ts-expect-error — a step has no value to give a case, so no case of a cycle's variant holds data
            state: Record.column.cycle(Holding, Held, { steps: [{ case: "held", label: "Held" }, { case: "open", label: "Open" }] }),
        }, { id: "id" }, { recordKinds: true }), /^Error: Sheet: cycle column "state" steps through a variant whose "held" case holds String — a step has no value to give a case/);
    });
});

// ── Columns from data (`Record Columns From Data - DX Proposal.md` §2) ──

/** A person's hours on each project, by the project's code. */
const Staff = StructType({ id: StringType, name: StringType, hours: DictType(StringType, FloatType) });
const STAFF: ValueTypeOf<typeof Staff>[] = [
    { id: "H-1", name: "A. Morgan", hours: new Map([["P-100", 12.5], ["P-200", 4.0]]) },
    { id: "H-2", name: "B. Ellis", hours: new Map([["P-101", 30.0]]) },
];
const Hours = Staff.fields.hours;
const Project = StructType({ code: StringType, name: StringType, client: StringType });
const Client = StructType({ code: StringType, name: StringType });
/** The projects in an order that is not their clients': P-900's client is none of the clients, and C-03 has no project. */
const STAFF_OPTIONS = {
    id: "id" as const,
    registers: {
        projects: Record.register.members(East.value([
            { code: "P-200", name: "Shop front", client: "C-02" },
            { code: "P-100", name: "Kitchen fit-out", client: "C-01" },
            { code: "P-900", name: "Training", client: "" },
            { code: "P-101", name: "Stair rebuild", client: "C-01" },
        ], ArrayType(Project)), { kind: "project", key: p => p.code, label: p => p.name, parent: p => some(p.client) }),
        clients: Record.register.members(East.value([
            { code: "C-01", name: "Ashgrove" }, { code: "C-02", name: "Bellmoor" }, { code: "C-03", name: "Corran" },
        ], ArrayType(Client)), { kind: "client", key: c => c.code, label: c => c.name }),
    },
};
/** A rota's week: a day it always staffs, one it may not, and a note. */
const Week = StructType({ mon: IntegerType, sat: OptionType(IntegerType), note: StringType });
const Rostered = StructType({ id: StringType, week: Week });
const ROSTERED = East.value([{ id: "S-1", week: { mon: 4n, sat: some(2n), note: "" } }], ArrayType(Rostered));
const ColumnType = Sheet.Types.Root.fields.columns.value;
const Keys = ArrayType(StringType);
const Mark = OptionType(Record.Types.Mark);

describe("columns from data", () => {
    test("a register's members make the columns: in its order, each keyed by the column and the member, headed by the member's label, and holding the kind's value or none", () => {
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(STAFF, ArrayType(Staff));
            return createSheetRootWith(rows, {
                name: Record.column.title(Staff, { header: "Name" }),
                hours: Record.column.quantity(Staff, { each: "projects", unit: "hrs", width: "88px" }),
            }, STAFF_OPTIONS, { recordKinds: true });
        }), [])();
        const keys = root.columns.map((c) => c.key);
        assert.ok(equalFor(Keys)(keys, ["name", "hours:P-200", "hours:P-100", "hours:P-900", "hours:P-101"]), printFor(Keys)(keys));
        const headers = root.columns.map((c) => c.header);
        assert.ok(equalFor(Keys)(headers, ["Name", "Shop front", "Kitchen fit-out", "Training", "Stair rebuild"]), printFor(Keys)(headers));
        const column = root.columns.find((c) => c.key === "hours:P-100");
        if (column === undefined) assert.fail("no column for P-100");
        const quantity = variant("quantity", { uom: none, unit: some("hrs"), format: none });
        assert.ok(equalFor(ColumnType.fields.kind)(column.kind, quantity), printFor(ColumnType.fields.kind)(column.kind));
        assert.ok(equalFor(ColumnType.fields.dataType)(column.dataType, toEastTypeValue(OptionType(FloatType))), printFor(ColumnType.fields.dataType)(column.dataType));
        assert.ok(equalFor(ColumnType.fields.payloadType)(column.payloadType, toEastTypeValue(FloatType)), printFor(ColumnType.fields.payloadType)(column.payloadType));
        assert.ok(equalFor(ColumnType.fields.width)(column.width, some("88px")), printFor(ColumnType.fields.width)(column.width));
        assert.equal(column.editable, true);
    });

    test("a row carries no member's cell — each is read at the Record's day — but the row's own rules of a column from data", () => {
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(STAFF, ArrayType(Staff));
            return createSheetRootWith(rows, {
                name: Record.column.title(Staff, { header: "Name" }),
                hours: Record.column.quantity(Staff, { each: "projects", detail: p => p.name }),
            }, STAFF_OPTIONS, { recordKinds: true });
        }), [])();
        if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
        const cells = [...root.rows.value[0]!.cells.keys()];
        assert.ok(equalFor(Keys)(cells, ["$detail:hours", "name"]), printFor(Keys)(cells));
        const column = root.columns.find((c) => c.key === "hours:P-200");
        if (column === undefined) assert.fail("no column for P-200");
        assert.ok(equalFor(ColumnType.fields.detailCell)(column.detailCell, some("$detail:hours")), printFor(ColumnType.fields.detailCell)(column.detailCell));
    });

    test("`groups` heads the columns by each member's parent, in its own order — the members whose parent it lacks after them, unlabelled, and a member heading none drawing nothing — beside the author's groups, in column order", () => {
        const payload = East.compile(East.function([], RecordPayloadType, () => Record.Payload({
            record: Record.bind(ex.recordHours), window: Data.bindPaged(ex.recordHours), registers: STAFF_OPTIONS.registers,
            columns: {
                name: Record.column.title(ex.Person, { header: "Name" }),
                hours: Record.column.quantity(ex.Person, { each: "projects", groups: "clients", unit: "hrs" }),
            },
            columnGroups: [{ label: "Who", columnKeys: ["name"] }],
        })), refusingPlatform)();
        const keys = payload.sheet.columns.map((c) => c.key);
        assert.ok(equalFor(Keys)(keys, ["name", "hours:P-100", "hours:P-101", "hours:P-200", "hours:P-900"]), printFor(Keys)(keys));
        const Groups = RecordPayloadType.fields.columnGroups;
        assert.ok(equalFor(Groups)(payload.columnGroups, [
            { label: "Who", columnKeys: ["name"] },
            { label: "Ashgrove", columnKeys: ["hours:P-100", "hours:P-101"] },
            { label: "Bellmoor", columnKeys: ["hours:P-200"] },
            { label: "", columnKeys: ["hours:P-900"] },
        ]), printFor(Groups)(payload.columnGroups));
    });

    test("a struct's fields make the columns, fixed as the page is built: in the order `each` gives, headed as it says, and a column group naming the column holds them all", () => {
        const payload = East.compile(East.function([], RecordPayloadType, () => Record.Payload({
            record: Record.bind(ex.recordRoster), window: Data.bindPaged(ex.recordRoster),
            columns: {
                name: Record.column.title(ex.Shift, { header: "Shift" }),
                week: Record.column.integer(ex.Shift, { each: { sat: "Sat", sun: "Sun", mon: "Mon" } }),
            },
            columnGroups: [{ label: "Weekend first", columnKeys: ["week"] }],
        })), refusingPlatform)();
        const keys = payload.sheet.columns.map((c) => c.key);
        assert.ok(equalFor(Keys)(keys, ["name", "week:sat", "week:sun", "week:mon"]), printFor(Keys)(keys));
        const headers = payload.sheet.columns.map((c) => c.header);
        assert.ok(equalFor(Keys)(headers, ["Shift", "Sat", "Sun", "Mon"]), printFor(Keys)(headers));
        const Groups = RecordPayloadType.fields.columnGroups;
        assert.ok(equalFor(Groups)(payload.columnGroups, [{ label: "Weekend first", columnKeys: ["week:sat", "week:sun", "week:mon"] }]), printFor(Groups)(payload.columnGroups));
        const sat = payload.sheet.columns.find((c) => c.key === "week:sat");
        if (sat === undefined) assert.fail("no column for Saturday");
        assert.ok(equalFor(ColumnType.fields.dataType)(sat.dataType, toEastTypeValue(IntegerType)), printFor(ColumnType.fields.dataType)(sat.dataType));
        assert.equal(sat.editable, true);
    });

    test("with no functions, a Dict keyed by the member reads its entry, an edit setting it and a clear removing it; a struct reads itself, an edit writing the new one", () => {
        const day = new Date("2026-11-08T00:00:00Z");
        const register = createSheetBuild(East.value(STAFF, ArrayType(Staff)), { hours: Record.column.quantity(Staff, { each: "projects" }) }, STAFF_OPTIONS, { recordKinds: true }).data[0]?.data;
        if (register?.from !== "register" || register.write === undefined) assert.fail("no register's columns, or none written");
        assert.equal(register.clears, true);
        const Logged = OptionType(FloatType);
        const read = East.compile(register.read as never, []) as (hours: ValueTypeOf<typeof Hours>, project: string, day: Date) => ValueTypeOf<typeof Logged>;
        const write = East.compile(register.write as never, []) as (hours: ValueTypeOf<typeof Hours>, project: string, logged: ValueTypeOf<typeof Logged>, day: Date) => ValueTypeOf<typeof Hours>;
        const hours = new Map([["P-100", 12.5]]);
        assert.ok(equalFor(Logged)(read(hours, "P-100", day), some(12.5)));
        assert.ok(equalFor(Logged)(read(hours, "P-200", day), none));
        const set = write(hours, "P-200", some(4.0), day);
        assert.ok(equalFor(Hours)(set, new Map([["P-100", 12.5], ["P-200", 4.0]])), printFor(Hours)(set));
        const cleared = write(hours, "P-100", none, day);
        assert.ok(equalFor(Hours)(cleared, new Map()), printFor(Hours)(cleared));
        assert.ok(equalFor(Hours)(hours, new Map([["P-100", 12.5]])), "the field given is left as it was");

        const fields = createSheetBuild(ROSTERED, { week: Record.column.integer(Rostered, { each: { mon: "Mon", sat: "Sat" } }) }, { id: "id" }, { recordKinds: true }).data[0]?.data;
        if (fields?.from !== "fields" || fields.write === undefined) assert.fail("no struct's columns, or none written");
        // A clear writes none where the struct's field is an Option, and is refused where it isn't.
        assert.deepEqual(fields.members.map((m) => [m.name, m.header, m.clears]), [["mon", "Mon", false], ["sat", "Sat", true]]);
        const readWeek = East.compile(fields.read as never, []) as (week: ValueTypeOf<typeof Week>, day: Date) => ValueTypeOf<typeof Week>;
        const writeWeek = East.compile(fields.write as never, []) as (week: ValueTypeOf<typeof Week>, next: ValueTypeOf<typeof Week>, day: Date) => ValueTypeOf<typeof Week>;
        const week: ValueTypeOf<typeof Week> = { mon: 4n, sat: some(2n), note: "" };
        const next: ValueTypeOf<typeof Week> = { mon: 5n, sat: none, note: "" };
        assert.ok(equalFor(Week)(readWeek(week, day), week));
        assert.ok(equalFor(Week)(writeWeek(week, next, day), next));
    });

    test("builds over the functions it is given, and every kind but an action takes them — an action column takes a `mark` over its row", () => {
        const read = East.function([Hours, StringType, DateTimeType], OptionType(FloatType), (_$, hours, project) => hours.tryGet(project));
        const write = East.function([Hours, StringType, OptionType(FloatType), DateTimeType], Hours, ($, hours, project, logged) => {
            const next = $.let(hours.copy());
            $.match(logged, {
                some: ($2, value) => { $2(next.insertOrUpdate(project, value)); },
                none: ($2) => { $2(next.tryDelete(project)); },
            });
            return next;
        });
        const mark = East.function([Hours, StringType, DateTimeType], Mark, ($, _hours, project) => {
            $.if(project.equal("P-900"), ($2) => { $2.return(some(variant("lock", "Booked centrally"))); });
            return none;
        });
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(STAFF, ArrayType(Staff));
            return createSheetRootWith(rows, {
                name: Record.column.title(Staff, { header: "Name", mark: East.function([Staff, DateTimeType], Mark, () => none) }),
                hours: Record.column.quantity(Staff, { each: "projects", read, write, mark }),
            }, STAFF_OPTIONS, { recordKinds: true });
        }), [])();
        const editable = root.columns.map((c) => c.editable);
        assert.ok(equalFor(ArrayType(BooleanType))(editable, [true, true, true, true, true]), printFor(ArrayType(BooleanType))(editable));
        // Without a `write`, read only.
        const readOnly: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(STAFF, ArrayType(Staff));
            return createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", read, editable: false }) }, STAFF_OPTIONS, { recordKinds: true });
        }), [])();
        const shown = readOnly.columns.map((c) => c.editable);
        assert.ok(equalFor(ArrayType(BooleanType))(shown, [false, false, false, false]), printFor(ArrayType(BooleanType))(shown));
        // Keyed by a name of its own, a column names the field it reads.
        const named: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(STAFF, ArrayType(Staff));
            return createSheetRootWith(rows, { logged: Record.column.quantity(Staff, { each: "projects", field: "hours" }) }, STAFF_OPTIONS, { recordKinds: true });
        }), [])();
        const keys = named.columns.map((c) => c.key);
        assert.ok(equalFor(Keys)(keys, ["logged:P-200", "logged:P-100", "logged:P-900", "logged:P-101"]), printFor(Keys)(keys));
        assert.doesNotThrow(() => createSheetRootWith(East.value(ORDERS, ArrayType(Order)), {
            stage: Record.column.action(Order, Stage, {
                cases: { draft: { label: "Draft", state: "Drafted" }, review: { label: "Review", state: "In review" }, done: { label: "Finish", state: "Done" } },
                mark: East.function([Order, DateTimeType], Mark, () => none),
            }),
        }, { id: "id" }, { recordKinds: true }));
    });

    test("the inspector's form leaves out the field its columns write — a register's members, two columns over one field, a struct's fields — and refuses a hint naming it, naming the columns", () => {
        const Pane = OptionType(SheetInspectorPaneType);
        const formPaths = (pane: ValueTypeOf<typeof Pane>) => {
            if (pane.type !== "some") assert.fail("no inspector pane");
            return pane.value.forms.row.fields.map((f) => f.spec.path.join("."));
        };
        const hours = East.compile(East.function([], Pane, ($) => {
            const rows = $.const(STAFF, ArrayType(Staff));
            const built = createSheetBuild(rows, {
                name: Record.column.title(Staff, { header: "Name" }),
                hours: Record.column.quantity(Staff, { each: "projects", unit: "hrs" }),
                byClient: Record.column.quantity(Staff, { each: "clients", field: "hours" }),
            }, STAFF_OPTIONS, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        assert.ok(equalFor(Keys)(formPaths(hours), ["name"]), printFor(Keys)(formPaths(hours)));
        const week = East.compile(East.function([], Pane, ($) => {
            const rows = $.const(ROSTERED);
            const built = createSheetBuild(rows, { week: Record.column.integer(Rostered, { each: { mon: "Mon", sat: "Sat" } }) }, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        assert.ok(equalFor(Keys)(formPaths(week), []), printFor(Keys)(formPaths(week)));
        const columns = {
            name: Record.column.title(ex.Person, { header: "Name" }),
            hours: Record.column.quantity(ex.Person, { each: "projects", unit: "hrs" }),
            byClient: Record.column.quantity(ex.Person, { each: "clients", field: "hours" }),
        };
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordHours), columns, registers: STAFF_OPTIONS.registers, inspector: true, fields: { hours: Record.field.readonly() } }),
            /^Error: Record: `fields` names "hours", which the inspector does not show as a field of its own — the columns "hours" and "byClient" from data write it, and each member shows as a line of its own, labelled by its header/);
    });
});

// ── Columns from data at the day (§5.2): their cells read over a row's entry or its draft, a gesture's edits written ──

const Cells = DictType(StringType, Sheet.Types.Cell);
type CellValue = ValueTypeOf<typeof Sheet.Types.Cell>;
const StaffDraft = Record.Types.Draft(Staff);
const RosteredDraft = Record.Types.Draft(Rostered);
const encodeRow = encodeBeast2For(Sheet.Types.Row);
const encodeStaffDraft = encodeBeast2For(StaffDraft);
const decodeStaffDraft = decodeBeast2For(StaffDraft);
const encodeRosteredDraft = encodeBeast2For(RosteredDraft);
const decodeRosteredDraft = decodeBeast2For(RosteredDraft);
/** Days as the Record's clock gives them: the local calendar date, at UTC midnight. */
const MONDAY = new Date("2026-11-09T00:00:00Z");
const SATURDAY = new Date("2026-11-07T00:00:00Z");
/** A. Morgan's entry, and her draft as the session lifts it. */
const MORGAN = variant("entry", encodeBeast2For(Staff)(STAFF[0]!));
const MORGAN_DRAFT: ValueTypeOf<typeof StaffDraft> = {
    id: variant("value", "H-1"), name: variant("value", "A. Morgan"), hours: variant("value", new Map([["P-100", 12.5], ["P-200", 4.0]])),
};

/** The hours by project, a project booked centrally locked and a weekend's noted, and by client over the same field; a lead's name noted. */
const STAFF_AT_DAY: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(STAFF, ArrayType(Staff));
    return createSheetRootWith(rows, {
        name: Record.column.title(Staff, {
            header: "Name",
            mark: East.function([Staff, DateTimeType], Mark, ($2, person) => {
                $2.if(person.name.equal("A. Morgan"), ($3) => { $3.return(some(variant("note", "Lead"))); });
                return none;
            }),
        }),
        hours: Record.column.quantity(Staff, {
            each: "projects",
            mark: East.function([Hours, StringType, DateTimeType], Mark, ($2, _hours, project, day) => {
                $2.if(project.equal("P-900"), ($3) => { $3.return(some(variant("lock", "Booked centrally"))); });
                $2.if(day.getDayOfWeek().greaterEqual(6n), ($3) => { $3.return(some(variant("note", "Weekend"))); });
                return none;
            }),
        }),
        byClient: Record.column.quantity(Staff, { each: "clients", field: "hours" }),
    }, STAFF_OPTIONS, { recordKinds: true });
}), [])();

/** The rota's week as Monday's and Saturday's columns, locked once Monday is over its cap. */
const WEEK_AT_DAY: Root = East.compile(East.function([], Sheet.Types.Root, () => createSheetRootWith(ROSTERED, {
    week: Record.column.integer(Rostered, {
        each: { mon: "Mon", sat: "Sat" },
        mark: East.function([Week, DateTimeType], Mark, ($, week) => {
            $.if(week.mon.greater(4n), ($2) => { $2.return(some(variant("lock", "Over the cap"))); });
            return none;
        }),
    }),
}, { id: "id" }, { recordKinds: true })), [])();

/** A root's cells at a day, which a root with a column from data or a mark has. */
function cellsAtOf(root: Root): (from: ValueTypeOf<typeof SheetReadFromType>, day: Date) => ValueTypeOf<typeof Cells> {
    if (root.cellsAt.type !== "some") assert.fail("the root reads no cells at a day");
    return root.cellsAt.value;
}

describe("columns from data at the day", () => {
    test("a wire column names the column and member it was made for and whether a clear writes none, and where its marks cross; a root reading nothing at the day has no `cellsAt`", () => {
        const From = ColumnType.fields.from;
        const Marks = ColumnType.fields.mark;
        const column = (root: Root, key: string) => root.columns.find((c) => c.key === key) ?? assert.fail(`no column ${key}`);
        const name = column(STAFF_AT_DAY, "name");
        assert.ok(equalFor(From)(name.from, none), printFor(From)(name.from));
        assert.ok(equalFor(Marks)(name.mark, some({ words: "$mark:name", lock: "$lock:name" })), printFor(Marks)(name.mark));
        const booked = column(STAFF_AT_DAY, "hours:P-900");
        assert.ok(equalFor(From)(booked.from, some({ column: "hours", member: "P-900", clears: true })), printFor(From)(booked.from));
        assert.ok(equalFor(Marks)(booked.mark, some({ words: "$mark:hours:P-900", lock: "$lock:hours:P-900" })), printFor(Marks)(booked.mark));
        const client = column(STAFF_AT_DAY, "byClient:C-01");
        assert.ok(equalFor(From)(client.from, some({ column: "byClient", member: "C-01", clears: true })), printFor(From)(client.from));
        assert.ok(equalFor(Marks)(client.mark, none), printFor(Marks)(client.mark));
        // A struct's field takes a clear where it is an Option.
        const mon = column(WEEK_AT_DAY, "week:mon");
        assert.ok(equalFor(From)(mon.from, some({ column: "week", member: "mon", clears: false })), printFor(From)(mon.from));
        const sat = column(WEEK_AT_DAY, "week:sat");
        assert.ok(equalFor(From)(sat.from, some({ column: "week", member: "sat", clears: true })), printFor(From)(sat.from));
        assert.ok(equalFor(Marks)(sat.mark, some({ words: "$mark:week:sat", lock: "$lock:week:sat" })), printFor(Marks)(sat.mark));
        assert.equal(ROOT.cellsAt.type, "none");
    });

    test("a row's cells are read over its entry at the day: each member's value, a member it holds none of blank, and the marks beside them, the day's own", () => {
        const cellsAt = cellsAtOf(STAFF_AT_DAY);
        const monday = cellsAt(MORGAN, MONDAY);
        const expected = new Map<string, CellValue>([
            ["$lock:hours:P-900", variant("Boolean", true)], ["$lock:name", variant("Boolean", false)],
            ["$mark:hours:P-900", variant("String", "Booked centrally")], ["$mark:name", variant("String", "Lead")],
            ["byClient:C-01", variant("Null", null)], ["byClient:C-02", variant("Null", null)], ["byClient:C-03", variant("Null", null)],
            ["hours:P-100", variant("Float", 12.5)], ["hours:P-101", variant("Null", null)], ["hours:P-200", variant("Float", 4.0)], ["hours:P-900", variant("Null", null)],
        ]);
        assert.ok(equalFor(Cells)(monday, expected), printFor(Cells)(monday));
        // On a Saturday each project not locked is noted.
        const saturday = cellsAt(MORGAN, SATURDAY);
        const Cell = Sheet.Types.Cell;
        assert.ok(equalFor(Cell)(saturday.get("$mark:hours:P-100") ?? variant("Null", null), variant("String", "Weekend")), printFor(Cells)(saturday));
        assert.ok(equalFor(Cell)(saturday.get("$lock:hours:P-100") ?? variant("Null", null), variant("Boolean", false)), printFor(Cells)(saturday));
        assert.ok(equalFor(Cell)(saturday.get("$mark:hours:P-900") ?? variant("Null", null), variant("String", "Booked centrally")), printFor(Cells)(saturday));
    });

    test("over a draft, the cells are the draft's; a field not yet set shows none, and a mark over the row waits until its draft is whole", () => {
        const cellsAt = cellsAtOf(STAFF_AT_DAY);
        const drafted = cellsAt(variant("draft", encodeStaffDraft({ ...MORGAN_DRAFT, hours: variant("value", new Map([["P-101", 2.0]])) })), MONDAY);
        const Cell = Sheet.Types.Cell;
        assert.ok(equalFor(Cell)(drafted.get("hours:P-101") ?? variant("Null", null), variant("Float", 2.0)), printFor(Cells)(drafted));
        assert.ok(equalFor(Cell)(drafted.get("hours:P-100") ?? variant("Invalid", "absent"), variant("Null", null)), printFor(Cells)(drafted));
        assert.ok(equalFor(Cell)(drafted.get("$mark:name") ?? variant("Null", null), variant("String", "Lead")), printFor(Cells)(drafted));
        const fresh = cellsAt(variant("draft", encodeStaffDraft({ id: variant("value", "H-9"), name: variant("value", "A. Morgan"), hours: variant("missing", null) })), MONDAY);
        assert.ok(equalFor(Cells)(fresh, new Map()), printFor(Cells)(fresh));
    });

    test("`decode` writes each cell a gesture changed through its column's `write`, over the field as drafted so far — a second column on the field chaining onto the first — and a cell left as it read, or holding text no column could read, writes nothing", () => {
        const cellsAt = cellsAtOf(STAFF_AT_DAY);
        const decode = (cells: ValueTypeOf<typeof Cells>, base: ValueTypeOf<typeof StaffDraft>) => decodeStaffDraft(STAFF_AT_DAY.editing.decode(
            encodeRow({ id: "H-1", owned: false, cells, lines: [], band: none, subRows: [] }), some(encodeStaffDraft(base)), none, MONDAY));
        const shown = cellsAt(MORGAN, MONDAY);
        const typed = new Map<string, CellValue>([...shown, ["hours:P-200", variant("Float", 9.0)], ["byClient:C-01", variant("Float", 1.5)], ["hours:P-101", variant("Invalid", "lots")]]);
        const written = decode(typed, MORGAN_DRAFT);
        const chained = { ...MORGAN_DRAFT, hours: variant("value", new Map([["C-01", 1.5], ["P-100", 12.5], ["P-200", 9.0]])) };
        assert.ok(equalFor(StaffDraft)(written, chained), printFor(StaffDraft)(written));
        // The next gesture reads over the draft it left: a clear removes the member's entry, and the rest stand.
        const cleared = decode(new Map<string, CellValue>([...cellsAt(variant("draft", encodeStaffDraft(written)), MONDAY), ["hours:P-100", variant("Null", null)]]), written);
        const left = { ...MORGAN_DRAFT, hours: variant("value", new Map([["C-01", 1.5], ["P-200", 9.0]])) };
        assert.ok(equalFor(StaffDraft)(cleared, left), printFor(StaffDraft)(cleared));
        const untouched = decode(shown, MORGAN_DRAFT);
        assert.ok(equalFor(StaffDraft)(untouched, MORGAN_DRAFT), printFor(StaffDraft)(untouched));
    });

    test("over a struct's fields, each changed one is set on the struct and the struct written once — a clear writing none where the field is an Option and nothing where it isn't — and a field not yet set starts from its type's default, written or not", () => {
        const cellsAt = cellsAtOf(WEEK_AT_DAY);
        const decode = (id: string, cells: ValueTypeOf<typeof Cells>, base: ValueTypeOf<typeof RosteredDraft> | undefined) => decodeRosteredDraft(WEEK_AT_DAY.editing.decode(
            encodeRow({ id, owned: false, cells, lines: [], band: none, subRows: [] }), base === undefined ? none : some(encodeRosteredDraft(base)), none, MONDAY));
        const base: ValueTypeOf<typeof RosteredDraft> = { id: variant("value", "S-1"), week: variant("value", { mon: 4n, sat: some(2n), note: "" }) };
        const shown = cellsAt(variant("draft", encodeRosteredDraft(base)), MONDAY);
        assert.ok(equalFor(Cells)(shown, new Map<string, CellValue>([["week:mon", variant("Integer", 4n)], ["week:sat", variant("Integer", 2n)]])), printFor(Cells)(shown));
        const written = decode("S-1", new Map<string, CellValue>([["week:mon", variant("Integer", 5n)], ["week:sat", variant("Null", null)]]), base);
        const week = { ...base, week: variant("value", { mon: 5n, sat: none, note: "" }) };
        assert.ok(equalFor(RosteredDraft)(written, week), printFor(RosteredDraft)(written));
        // The struct's one mark, on each of its columns.
        const locked = cellsAt(variant("draft", encodeRosteredDraft(written)), MONDAY);
        assert.ok(equalFor(Cells)(locked, new Map<string, CellValue>([
            ["$lock:week:mon", variant("Boolean", true)], ["$lock:week:sat", variant("Boolean", true)],
            ["$mark:week:mon", variant("String", "Over the cap")], ["$mark:week:sat", variant("String", "Over the cap")],
            ["week:mon", variant("Integer", 5n)], ["week:sat", variant("Null", null)],
        ])), printFor(Cells)(locked));
        const refused = decode("S-1", new Map<string, CellValue>([["week:mon", variant("Null", null)], ["week:sat", variant("Integer", 2n)]]), base);
        assert.ok(equalFor(RosteredDraft)(refused, base), printFor(RosteredDraft)(refused));
        const fresh = decode("S-9", new Map<string, CellValue>([["week:sat", variant("Integer", 3n)]]), undefined);
        assert.ok(equalFor(RosteredDraft)(fresh, { id: variant("value", "S-9"), week: variant("value", { mon: 0n, sat: some(3n), note: "" }) }), printFor(RosteredDraft)(fresh));
        // A new row's field no column has written yet is its type's default all the same: no person sets it but through its
        // columns, so Save never waits for it.
        const unwritten = decode("S-9", new Map(), undefined);
        assert.ok(equalFor(RosteredDraft)(unwritten, { id: variant("value", "S-9"), week: variant("value", { mon: 0n, sat: none, note: "" }) }), printFor(RosteredDraft)(unwritten));
    });
});

describe("a column from data refuses", () => {
    const rows = East.value(STAFF, ArrayType(Staff));
    const read = East.function([Hours, StringType, DateTimeType], OptionType(FloatType), (_$, hours, project) => hours.tryGet(project));
    const write = East.function([Hours, StringType, OptionType(FloatType), DateTimeType], Hours, (_$, hours) => hours);

    test("an option only a column from data takes, without `each`", () => {
        for (const option of ["groups", "field", "read", "write"]) {
            assert.throws(() => createSheetRootWith(rows, { name: Record.column.text(Staff, { [option]: "x" } as never) }, STAFF_OPTIONS, { recordKinds: true }),
                new RegExp(`^Error: Sheet: column "name" has \`${option}\`, which a column from data takes — give it \`each\``));
        }
    });

    test("`each` or `groups` naming a register `registers` does not declare", () => {
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projets" }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" names register "projets" in `each`, which `registers` does not declare \(projects, clients\)/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", groups: "customers" }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" names register "customers" in `groups`, which `registers` does not declare/);
    });

    test("a field of a shape with no default, given no `read` and `write`", () => {
        assert.throws(() => createSheetRootWith(rows, { name: Record.column.quantity(Staff, { each: "projects" }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "name" makes a column for each member of "projects" from its field "name" \(String\) — a field that is no Dict keyed by the member, of Float, takes a `read` and a `write`/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.text(Staff, { each: "projects" }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" makes a column for each member of "projects" from its field "hours" \(Dict\) — a field that is no Dict keyed by the member, of String/);
        assert.throws(() => createSheetRootWith(rows, { name: Record.column.text(Staff, { each: { first: "First" } }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "name" makes a column for each field of a struct from its field "name" \(String\) — a field that is no struct takes a `read` giving one, and a `write`/);
    });

    test("a `read`, `write` or `mark` over values other than the field's, the member's key, the kind's value and the day — or no East function", () => {
        assert.throws(() => createSheetRootWith(rows, {
            hours: Record.column.quantity(Staff, { each: "projects", write, read: East.function([Hours, StringType], OptionType(FloatType), (_$, hours, project) => hours.tryGet(project)) as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" has a `read` over \(Dict, String\) — it reads its field "hours" \(Dict\), the member's key \(String\) and the day \(DateTime\)/);
        assert.throws(() => createSheetRootWith(rows, {
            hours: Record.column.quantity(Staff, { each: "projects", write, read: East.function([Hours, StringType, DateTimeType], StringType, () => "") as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" has a `read` returning String — it returns Float, or an Option of it, for each member/);
        assert.throws(() => createSheetRootWith(rows, {
            hours: Record.column.quantity(Staff, { each: "projects", read, write: East.function([Hours, StringType, IntegerType, DateTimeType], Hours, (_$, hours) => hours) as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" has a `write` over \(Dict, String, Integer, DateTime\) — it writes its field "hours" \(Dict\) given the member's key \(String\), the value its `read` gives \(Float, or an Option of it\) and the day \(DateTime\)/);
        assert.throws(() => createSheetRootWith(rows, {
            hours: Record.column.quantity(Staff, { each: "projects", read, write: East.function([Hours, StringType, OptionType(FloatType), DateTimeType], StringType, () => "") as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" has a `write` returning String — it returns the field's new value, Dict/);
        assert.throws(() => createSheetRootWith(rows, {
            hours: Record.column.quantity(Staff, { each: "projects", read, write, mark: East.function([Hours, StringType], Mark, () => none) as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" has a `mark` over \(Dict, String\) returning Option<Variant> — it marks a cell over its field "hours" \(Dict\), the member's key \(String\) and the day \(DateTime\), returning Option<Record\.Types\.Mark>/);
        assert.throws(() => createSheetRootWith(rows, {
            name: Record.column.title(Staff, { mark: East.function([Staff], Mark, () => none) as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "name" has a `mark` over \(\{ id: String, name: String, hours: Dict \}\) returning Option<Variant> — it marks a cell over the row and the day: an East function from \(RowType, DateTime\) to Option<Record\.Types\.Mark>/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", write, read: 5n as never }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" has a `read` that is an Integer — give it an East\.function/);
        assert.throws(() => createSheetRootWith(rows, {
            hours: Record.column.quantity(Staff, { each: "projects", write, read: East.asyncFunction([Hours, StringType, DateTimeType], OptionType(FloatType), (_$, hours, project) => hours.tryGet(project)) as never }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" has a `read` that is an East\.asyncFunction, and a cell is read and written as it is drawn and edited — give it an East\.function/);
    });

    test("a `read` with no `write`, unless read only; a `write` with no `read`; and a `write` on a kind that is never written", () => {
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", read }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" reads its field "hours" \(Dict\) through its `read` — give it a `write` too, or `editable: false` to show it read only/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", write }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" has a `write` and no `read` — a write sets what its read reads, so give the column a `read` too/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.audit(Staff, { each: "projects", write: write as never }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" is an audit column, which is read only — it takes no `write`/);
    });

    test("an option a column from data takes none of, and a kind that makes no columns from data", () => {
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", fill: [] } as never) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" makes its columns from data, which take no `fill` — the first version takes none/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.enum(Staff, "projects", { each: "projects", options: none } as never) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" makes its columns from data, which take no `options`/);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.text(Staff, { each: "projects", value: () => "" } as never) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" makes its columns from data, which take no `value` — each cell reads its member's value through `read`/);
        assert.throws(() => createSheetRootWith(East.value(ORDERS, ArrayType(Order)), { stage: Record.column.action(Order, Stage, { each: "projects" } as never) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: column "stage" is an action column, whose buttons, forms and side-panel entry follow one field — it makes no columns from data, so give it no `each`/);
        assert.throws(() => createSheetRootWith(rows, { name: Sheet.column.lookup(Staff, { each: "projects" } as never) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "name" is a lookup column, the sheet's driver and one column of its own — it makes no columns from data, so give it no `each`/);
    });

    test("a `header` — a member's name heads each of its columns — refused by the compiler, and built, by the root, in the Record's words too", () => {
        assert.throws(() => createSheetRootWith(rows, {
            // @ts-expect-error — a column from data takes no header: its members head its columns
            hours: Record.column.quantity(Staff, { each: "projects", header: "Hours" }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "hours" makes its columns from data, which take no `header` — a member's name heads each of its columns: a register member's label, or the header `each` gives a struct's field/);
        assert.throws(() => createSheetRootWith(ROSTERED, {
            // @ts-expect-error — nor over a struct's fields, which `each` heads
            week: Record.column.integer(Rostered, { each: { mon: "Mon" }, header: "Week" }),
        }, { id: "id" }, { recordKinds: true }), /^Error: Sheet: column "week" makes its columns from data, which take no `header`/);
        assert.throws(() => createSheetRootWith(rows, {
            // @ts-expect-error — nor an age's, keyed by a name of its own
            seen: Record.column.age(Staff, { each: "projects", field: "hours", header: "Seen" }),
        }, STAFF_OPTIONS, { recordKinds: true }), /^Error: Sheet: column "seen" makes its columns from data, which take no `header`/);
        assert.throws(() => Record.Payload({
            record: Record.bind(ex.recordHours), registers: STAFF_OPTIONS.registers,
            columns: { hours: Record.column.quantity(ex.Person, { each: "projects", header: "Hours" } as never) },
        }), /^Error: Record: column "hours" makes its columns from data, which take no `header` — a member's name heads each of its columns/);
    });

    test("`field` on a column keyed by the field, naming a field the row lacks, or left out where the key is no field — an age's always", () => {
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Staff, { each: "projects", field: "hours" }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" is keyed by the row's "hours" field, and reads and writes it — key it by a name of its own to read "hours" with `field`/);
        assert.throws(() => createSheetRootWith(rows, { logged: Record.column.quantity(Staff, { each: "projects", field: "hourz" as never }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "logged" reads "hourz", which `field` names and the row type lacks \(id, name, hours\)/);
        assert.throws(() => createSheetRootWith(rows, { logged: Record.column.quantity(Staff, { each: "projects" }) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "logged" is not a field of the row type — key a column from data by the field it reads, or by a name of its own with `field` naming it \(id, name, hours\)/);
        assert.throws(() => createSheetRootWith(rows, { seen: Record.column.age(Staff, { each: "projects" } as never) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "seen" is an age column, which shows no field — keyed by a name of its own, it names the field its columns read with `field`/);
        assert.throws(() => createSheetRootWith(rows, { seen: Record.column.age(Staff, { each: "projects", field: "hours", since: () => none } as never) }, STAFF_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "seen" is an age column from data, which counts from each member's value — it takes no `since`/);
    });

    test("over a struct's fields: `groups`, an `each` naming no field or one the struct lacks, a field of the wrong value, and a `read` or `write` over other values", () => {
        assert.throws(() => createSheetRootWith(ROSTERED, { week: Record.column.integer(Rostered, { each: { mon: "Mon" }, groups: "clients" }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: column "week" makes a column for each field of a struct, and `groups` heads a register's members — group a struct's columns with `columnGroups`, by the column's key/);
        assert.throws(() => createSheetRootWith(ROSTERED, { week: Record.column.integer(Rostered, { each: {} }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: column "week" has an `each` naming no field — name each field of the struct it makes a column for, with its header/);
        assert.throws(() => createSheetRootWith(ROSTERED, { week: Record.column.integer(Rostered, { each: { mon: "Mon", sun: "Sun" } }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: column "week" names "sun" in `each`, which is not a field of its struct \(mon, sat, note\)/);
        assert.throws(() => createSheetRootWith(ROSTERED, { week: Record.column.integer(Rostered, { each: { note: "Note" } }) }, { id: "id" }, { recordKinds: true }),
            /^Error: Sheet: column "week" makes a column of its struct's "note", which holds String — an integer column's value is Integer, or an Option of it/);
        assert.throws(() => createSheetRootWith(ROSTERED, {
            week: Record.column.integer(Rostered, { each: { mon: "Mon" }, read: East.function([Week], Week, (_$, w) => w) as never }),
        }, { id: "id" }, { recordKinds: true }), /^Error: Sheet: column "week" has a `read` over \(\{ mon: Integer, sat: Option<Integer>, note: String \}\) — over a struct's fields it reads its field "week"/);
        assert.throws(() => createSheetRootWith(ROSTERED, {
            week: Record.column.integer(Rostered, { each: { mon: "Mon" }, read: East.function([Week, DateTimeType], IntegerType, (_$, w) => w.mon) as never }),
        }, { id: "id" }, { recordKinds: true }), /^Error: Sheet: column "week" has a `read` returning Integer — over a struct's fields it gives the struct whose fields `each` names/);
        assert.throws(() => createSheetRootWith(ROSTERED, {
            week: Record.column.integer(Rostered, {
                each: { mon: "Mon" },
                read: East.function([Week, DateTimeType], Week, (_$, w) => w),
                write: East.function([Week, DateTimeType], Week, (_$, w) => w) as never,
            }),
        }, { id: "id" }, { recordKinds: true }), /^Error: Sheet: column "week" has a `write` over \(.*\) — over a struct's fields it writes its field "week"/);
    });

    test("a Sheet refuses `each` and `mark`, naming the column", () => {
        assert.throws(() => Sheet.Root(rows, { hours: Sheet.column.quantity(Staff, { each: "projects" }) } as never, STAFF_OPTIONS),
            /^Error: Sheet: column "hours" makes its columns from data, with `each`, which a Record draws and a Sheet does not yet — show a system of records' rows with <Record>/);
        assert.throws(() => Sheet.Root(rows, { name: Sheet.column.text(Staff, { mark: East.function([Staff, DateTimeType], Mark, () => none) }) } as never, { id: "id" }),
            /^Error: Sheet: column "name" has a `mark`, which a Record draws and a Sheet does not yet/);
    });

    test("<Record> refuses a column group naming a column made from a register's members, and says the Sheet's refusals in its words", () => {
        const columns = { name: Record.column.title(ex.Person, { header: "Name" }), hours: Record.column.quantity(ex.Person, { each: "projects" }) };
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordHours), columns, registers: STAFF_OPTIONS.registers, columnGroups: [{ label: "Logged", columnKeys: ["hours"] }] }),
            /^Error: Record: column group "Logged" names "hours", whose columns are the members of "projects", known only once the page runs — head them with its `groups`/);
        assert.throws(() => Record.Payload({ record: Record.bind(ex.recordHours), columns: { hours: Record.column.quantity(ex.Person, { each: "projets" }) }, registers: STAFF_OPTIONS.registers }),
            /^Error: Record: column "hours" names register "projets" in `each`, which `registers` does not declare/);
    });
});
