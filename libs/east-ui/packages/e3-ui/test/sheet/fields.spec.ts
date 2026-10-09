/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's inspector forms (#1188, `Sheet Builder Spec.md` §5.3, SB10,
 * SB58): every field of a row through `Fields` — each column's kind its
 * field's default editor, a field with no column by its type — the hints
 * overriding them and their order, a group's own fields through its band
 * cells, the cells a patch of each sets, every refusal naming the prop and
 * the field, and the author's `inspector` wrapped so a row and its edit cross
 * as bytes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SortedMap,
    StringType, StructType, VariantType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue,
    variant, type BlockBuilder, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Text, type FieldEditorValue, type FieldHints } from "@elaraai/east-ui/internal";
import { Sheet, SheetFieldType, SheetFormsType, SheetInspectorType, buildForms, buildInspector, createSheetBuild } from "@elaraai/e3-ui/internal";

// ── Fixtures: a part with a field under every column kind, and three without ──

const Activity = StructType({ name: StringType, uom: StringType });
const Stage = VariantType({ cut: NullType, fit: NullType });
const Part = StructType({
    activity: StringType, task: StringType, starts: OptionType(DateTimeType), qty: OptionType(FloatType), count: IntegerType,
    status: StringType, bay: OptionType(StringType), code: StringType, total: FloatType, size: StringType,
    route: Sheet.Types.Link, created_by: StringType, rush: BooleanType, stage: Stage,
});
const PARTS = new SortedMap([["P-1", {
    activity: "Cut", task: "Cut the side panels", starts: none, qty: some(12.0), count: 4n, status: "OPEN", bay: none,
    code: "Z-100", total: 0.0, size: "600x400", route: { from: [], to: [] }, created_by: "planner", rush: false, stage: variant("cut", null),
}]], compareFor(StringType));
const ACTIVITIES = [{ name: "Cut", uom: "panels" }];
const WORDS = ["OPEN", "DONE"];
const BAYS = ["B1", "B2"];
const MACHINES = ["M1", "M2"];

type Forms = ValueTypeOf<typeof SheetFormsType>;
type Field = ValueTypeOf<typeof SheetFieldType>;
type Hints = Readonly<Record<string, unknown>>;

/** The forms of a flat sheet over the parts — every column kind, a driver, three registers — with the hints given. */
function partForms(hints?: (h: typeof Sheet.field) => FieldHints<typeof Part["fields"]>, groupHints?: Hints): Forms {
    return East.compile(East.function([], SheetFormsType, ($) => {
        const parts = $.const(PARTS, DictType(StringType, Part));
        const acts = $.const(ACTIVITIES, ArrayType(Activity));
        const words = $.const(WORDS, ArrayType(StringType));
        const bays = $.const(BAYS, ArrayType(StringType));
        const machines = $.const(MACHINES, ArrayType(StringType));
        const parse = $.const(East.function([StringType, Sheet.Types.DraftContext(Part, Activity)], OptionType(StringType), (_$, text) => some(text.trim())));
        const print = $.const(East.function([StringType], StringType, (_$, size) => size));
        const build = createSheetBuild(parts, {
            activity: Sheet.column.lookup(Part, { header: "Activity" }),
            task:     Sheet.column.text(Part, { header: "Task", sub: "what it is" }),
            starts:   Sheet.column.date(Part, { header: "Starts" }),
            qty:      Sheet.column.quantity(Part, Activity, { header: "Qty", uom: (a) => a.uom }),
            count:    Sheet.column.integer(Part, { header: "Count" }),
            status:   Sheet.column.enum(Part, "statuses", { header: "Status" }),
            bay:      Sheet.column.reference(Part, "bays", { header: "Bay" }),
            code:     Sheet.column.stamped(Part, { header: "Code", owner: "ERP" }),
            total:    Sheet.column.quantity(Part, { header: "Total", value: () => 2.5 }),
            size:     Sheet.column.custom(Part, { header: "Size", accepts: "a size, 600x400", parse, print }),
            route:    Sheet.column.link(Part, Activity, "machines", { header: "Route", members: [{ kind: "machine", identified: true }] }),
        }, {
            driver: Sheet.driver("activity", acts, { key: (a) => a.name, label: (a) => a.name }),
            registers: {
                statuses: Sheet.register.members(words, { kind: "status", key: (w) => w, label: (w) => w }),
                bays:     Sheet.register.members(bays, { kind: "bay", key: (b) => b, label: (b) => b }),
                machines: Sheet.register.members(machines, { kind: "machine", key: (m) => m, label: (m) => m }),
            },
        }, { keyOrdered: true });
        return buildForms(build.bridge, build.metas, hints?.(Sheet.field) as Hints | undefined, groupHints, undefined, build.registers);
    }), [])() as Forms;
}

// A grouped sheet: batches of lines, the title and a due date on the band.
const Line = StructType({ task: StringType, ends: OptionType(DateTimeType), notes: StringType });
const Batch = StructType({ name: StringType, due: OptionType(DateTimeType), note: StringType, lines: ArrayType(Line) });
const BATCHES = new SortedMap([["B-1", { name: "B-1 · Doors", due: none, note: "", lines: [] }]], compareFor(StringType));

/** The forms of a grouped sheet over the batches, with the group's hints given. */
function batchForms(groupHints?: (h: typeof Sheet.field) => Hints): Forms {
    return East.compile(East.function([], SheetFormsType, ($) => {
        const batches = $.const(BATCHES, DictType(StringType, Batch));
        const build = createSheetBuild(batches, {
            task:  Sheet.column.text(Line, { header: "Task" }),
            ends:  Sheet.column.date(Line, { header: "Ends" }),
            notes: Sheet.column.text(Line, { header: "Notes" }),
        }, {
            group: Sheet.group(Batch, "lines", { title: "name", cells: { ends: Sheet.group.cell.date(Batch, "due") } }),
        }, { keyOrdered: true });
        return buildForms(build.bridge, build.metas, undefined, groupHints?.(Sheet.field), undefined, build.registers);
    }), [])() as Forms;
}

const fieldsEqual = equalFor(ArrayType(SheetFieldType));
const printFields = printFor(ArrayType(SheetFieldType));

/** The fields are these, as East compares them. */
function assertFields(actual: readonly Field[], expected: readonly Field[]): void {
    assert.ok(fieldsEqual(actual as Field[], expected as Field[]), `resolved\n${printFields(actual as Field[])}\nexpected\n${printFields(expected as Field[])}`);
}

/** A field as the forms resolve it: its spec, and the column it is read through. */
function field(path: string[], label: string, type: EastType, editor: FieldEditorValue, column: string | undefined, help?: string): Field {
    const optional = type.type === "Variant" && Object.keys(type.cases).length === 2 && "some" in type.cases && "none" in type.cases;
    return {
        spec: { path, label, help: help === undefined ? none : some(help), group: none, type: toEastTypeValue(type), optional, editor },
        column: column === undefined ? none : some(column),
    };
}

const text: FieldEditorValue = variant("text", { placeholder: none });
const readonly: FieldEditorValue = variant("readonly", null);
const number = (o: { unit?: string; min?: number; max?: number } = {}): FieldEditorValue => variant("number", {
    unit: o.unit === undefined ? none : some(o.unit), step: none, min: o.min === undefined ? none : some(o.min), max: o.max === undefined ? none : some(o.max),
});
const reference = (of: string): FieldEditorValue => variant("reference", { of });
const datetime: FieldEditorValue = variant("datetime", { precision: none });

describe("the inspector's forms (SB10)", () => {
    test("with no hint, a column's field takes its kind's editor and is read through the column; a field with none, its type's", () => {
        const forms = partForms();
        assertFields(forms.row.fields, [
            field(["activity"], "Activity", StringType, reference("activity"), "activity"),
            field(["task"], "Task", StringType, text, "task", "what it is"),
            field(["starts"], "Starts", OptionType(DateTimeType), datetime, "starts"),
            field(["qty"], "Qty", OptionType(FloatType), number(), "qty"),
            field(["count"], "Count", IntegerType, number(), "count"),
            field(["status"], "Status", StringType, reference("statuses"), "status"),
            field(["bay"], "Bay", OptionType(StringType), reference("bays"), "bay"),
            // Stamped, a projection, and a link's members: read only here.
            field(["code"], "Code", StringType, readonly, "code"),
            field(["total"], "Total", FloatType, readonly, "total"),
            // A custom column's text: its print shows it, its parse reads it.
            field(["size"], "Size", StringType, text, "size"),
            field(["route"], "Route", Sheet.Types.Link, readonly, "route"),
            // No column: by type, as Fields resolves it.
            field(["created_by"], "Created by", StringType, text, undefined),
            field(["rush"], "Rush", BooleanType, variant("checkbox", null), undefined),
            field(["stage"], "Stage", Stage, variant("select", [{ case: "cut", label: "Cut" }, { case: "fit", label: "Fit" }]), undefined),
        ]);
        assert.equal(forms.group.type, "none", "a flat sheet has no group form");
        // A whole-row write sets the fields its editable columns write through `encode`, leaves those under a
        // read-only column — the stamped code, the projection — as they are, and sets the rest on the draft.
        assert.deepEqual([...forms.row.columns].sort(), ["activity", "bay", "count", "qty", "route", "size", "starts", "status", "task"]);
        assert.deepEqual([...forms.row.readonly].sort(), ["code", "total"]);
    });

    test("hints win: the hinted fields first in hint order, a label and help of their own, an editor checked against the field, a hidden field gone", () => {
        const forms = partForms((h) => ({
            qty: h.number({ label: "Quantity", unit: "pcs", min: 0, max: 500 }),
            task: h.readonly({ help: "Set by planning" }),
            created_by: h.hidden(),
            stage: h.select({ labels: { fit: "Fitting" } }),
            code: h.readonly({ label: "ERP code" }),
        }));
        assertFields(forms.row.fields.slice(0, 4), [
            field(["qty"], "Quantity", OptionType(FloatType), number({ unit: "pcs", min: 0, max: 500 }), "qty"),
            field(["task"], "Task", StringType, readonly, "task", "Set by planning"),
            field(["stage"], "Stage", Stage, variant("select", [{ case: "fit", label: "Fitting" }, { case: "cut", label: "Cut" }]), undefined),
            field(["code"], "ERP code", StringType, readonly, "code"),
        ]);
        // Then the rest, in declared order.
        assert.deepEqual(forms.row.fields.slice(4).map((f) => f.spec.path.join(".")),
            ["activity", "starts", "count", "status", "bay", "total", "size", "route", "rush"]);
        assert.equal(forms.row.fields.some((f) => f.spec.path[0] === "created_by"), false, "hidden");
    });

    test("a group's form: its own fields through the band's cells — the title, the due date under its column — and the rest by type; its lines left to the sheet", () => {
        const forms = batchForms();
        if (forms.group.type !== "some") assert.fail("a grouped sheet has a group form");
        assertFields(forms.group.value.fields, [
            field(["name"], "Name", StringType, text, "$title"),
            field(["due"], "Due", OptionType(DateTimeType), datetime, "ends"),
            field(["note"], "Note", StringType, text, undefined),
        ]);
        assert.deepEqual([...forms.group.value.columns].sort(), ["due", "name"], "the band's cells' fields");
        assert.deepEqual([...forms.group.value.readonly], [], "no band cell is read only");
        assertFields(forms.row.fields, [
            field(["task"], "Task", StringType, text, "task"),
            field(["ends"], "Ends", OptionType(DateTimeType), datetime, "ends"),
            field(["notes"], "Notes", StringType, text, "notes"),
        ]);
        const hinted = batchForms((h) => ({ note: h.text({ label: "Batch note", placeholder: "Anything the shop floor should know" }) }));
        if (hinted.group.type !== "some") assert.fail("a grouped sheet has a group form");
        assertFields(hinted.group.value.fields.slice(0, 1), [field(["note"], "Batch note", StringType, variant("text", { placeholder: some("Anything the shop floor should know") }), undefined)]);
    });

    test("a form's encode: a patch of its struct, as bytes, to the cells it sets through the editable columns — never a field no column shows, nor a stamped one", () => {
        const forms = partForms();
        const patch = { ...Object.fromEntries(Object.keys(Part.fields).map((k) => [k, none])), task: some("Fit the doors"), qty: some(some(3.0)), created_by: some("bench"), code: some("Z-200") };
        const cells = forms.row.encode(encodeBeast2For(Sheet.Types.Patch(Part))(patch as never));
        assert.deepEqual([...cells.keys()].sort(), ["qty", "task"]);
        assert.ok(equalFor(Sheet.Types.Cell)(cells.get("task")!, variant("String", "Fit the doors")));
        assert.ok(equalFor(Sheet.Types.Cell)(cells.get("qty")!, variant("Float", 3.0)));
        const group = batchForms().group;
        if (group.type !== "some") assert.fail("a grouped sheet has a group form");
        const groupPatch = { name: some("B-2 · Drawers"), due: none, note: none, lines: none };
        const band = group.value.encode(encodeBeast2For(Sheet.Types.Patch(Batch))(groupPatch as never));
        assert.ok(equalFor(Sheet.Types.Cell)(band.get("$title")!, variant("String", "B-2 · Drawers")), "the title's band cell");
    });

    test("refused, naming the prop and the field: an editor on a read-only column, a hint that does not fit, a field the type lacks, a hint per nested field, groupFields on a flat sheet", () => {
        assert.throws(() => partForms((h) => ({ code: h.text() })), /`fields.code` gives its field an editor, but its column is stamped/);
        assert.throws(() => partForms((h) => ({ total: h.number() })), /`fields.total` gives its field an editor, but its column is a `value` projection/);
        assert.throws(() => partForms((h) => ({ route: h.readonly(), size: h.text() })), /`fields.size` gives its field an editor, but its column is a custom column/);
        assert.throws(() => partForms((h) => ({ qty: h.text() as never })), /"qty" is a Float field — Fields\.text edits a String field/);
        assert.throws(() => partForms(() => ({ colour: Sheet.field.text() } as never)), /`fields` names "colour", which is not a field of the row type/);
        assert.throws(() => partForms(() => ({ task: { x: Sheet.field.text() } } as never)), /`fields.task` is shown through its column — its hint is one of Sheet.field's/);
        assert.throws(() => partForms(undefined, { name: Sheet.field.text() }), /`groupFields` hints a group's fields, and this sheet declares no group/);
        assert.throws(() => batchForms((h) => ({ lines: h.readonly() })), /`groupFields` names "lines", which the inspector does not show as a field of its own/);
        // A select lists one of the sheet's registers — the driver's among them, under its column.
        assert.throws(() => partForms((h) => ({ created_by: h.reference({ of: "crews" }) })),
            /`fields.created_by` is a reference to "crews", which is not one of the sheet's registers \(statuses, bays, machines, activity\)/);
        assert.throws(() => partForms((h) => ({ task: h.reference({ of: "crews" }) })), /`fields.task` is a reference to "crews"/);
        const named = partForms((h) => ({ created_by: h.reference({ of: "bays" }), task: h.reference({ of: "activity" }) }));
        assert.deepEqual(named.row.fields.slice(0, 2).map((f) => f.spec.editor), [reference("bays"), reference("activity")]);
    });
});

describe("the author's own Details (SB58)", () => {
    const Job = StructType({ task: StringType, qty: FloatType });
    type Inspector = ValueTypeOf<typeof SheetInspectorType>;
    const encodeJob = encodeBeast2For(Job);
    const decodeJob = decodeBeast2For(Job);

    /** The wrapped Details of an author's function: compiled, called where Details draws them. */
    const wrapped = (author: ($: BlockBuilder<typeof SheetInspectorType>) => unknown) =>
        East.compile(East.function([], SheetInspectorType, ($) => buildInspector(author($), Job)), [])() as Inspector;

    test("the row arrives as its own struct, and its writer takes the edited row back", () => {
        const inspector = wrapped(($) => $.const(East.function([Job, FunctionType([Job], NullType)], UIComponentType, ($2, row, update) => {
            // Doubling the quantity, for the test, as the author's UI would on a gesture.
            const edited = $2.const({ task: row.task, qty: row.qty.multiply(2.0) }, Job);
            $2(update(edited));
            return Text.Root(row.task);
        })));
        const written: Uint8Array[] = [];
        const ui = inspector(encodeJob({ task: "Hang doors", qty: 4.0 }), (bytes: Uint8Array) => { written.push(bytes); return null; });
        assert.equal(ui.type, "Text");
        assert.equal(written.length, 1, "one write");
        assert.ok(equalFor(Job)(decodeJob(written[0]!), { task: "Hang doors", qty: 8.0 }));
    });

    test("refused at build: a function over another type, or with no writer", () => {
        const Other = StructType({ name: StringType });
        assert.throws(() => wrapped(($) => $.const(East.function([Other, FunctionType([Other], NullType)], UIComponentType, (_$2, row) => Text.Root(row.name)))),
            /`inspector` is given alone, for the selected row's Details form, or as an East.function over the row and its writer/);
        assert.throws(() => wrapped(($) => $.const(East.function([Job], UIComponentType, (_$2, row) => Text.Root(row.task)))),
            /`inspector` is given alone, for the selected row's Details form, or as an East.function over the row and its writer/);
    });
});
