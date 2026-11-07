/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record (`Record - DX Proposal.md`): the examples; the Record's column
 * kinds on the wire — a title, a person, a boolean, a toggle, a cycle, an age
 * and an audit, and a quantity's unit — their cells, the age's count to a
 * clock and the audit's who and what; the columns map's typing; and every
 * refusal, naming the column or the prop — a new row's field no person can
 * set among them (#1526).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType,
    equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import {
    Data, Record, RecordPayloadType, Sheet, SheetInspectorPaneType, SheetUnsettableType, buildInspectorPane, createSheetBuild, createSheetRootWith,
} from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
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
    });
}, { platformFns: TestImpl });

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
});
