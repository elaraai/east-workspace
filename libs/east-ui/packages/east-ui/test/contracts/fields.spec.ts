/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The fields contract (#1147): `Fields.specs` over a struct with a field of
// every type the editors table names — each field's editor from its type;
// hints overriding the defaults; the order (hinted fields first, in hint
// order, then declared order, a nested struct's fields flattened by path under
// its name); `omit` and hidden fields left out; an `Option` cleared; and the
// refusals, at build and — where a hint's type says so — at compile time.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType,
    equalFor, isTypeEqual, none, printFor, some, toEastTypeValue, variant, type EastType,
} from "@elaraai/east";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import { FIELD_HINT, FieldSpecType, Fields, spellOut, type FieldEditorValue, type FieldSpecValue } from "@elaraai/east-ui/internal";
import * as ex from "./fields.examples.js";

describeEast("Fields contract examples", test => {
    Assert.examples(test, {
        fieldsSpecs: ex.fieldsSpecs,
        fieldsSelect: ex.fieldsSelect,
    });
}, { platformFns: TestImpl });

// ── Fixtures: a struct with a field of every type the editors table names ──

const Status = VariantType({ planned: NullType, in_progress: NullType });
const Item = StructType({ text: StringType, done: BooleanType });
const Geo = StructType({ lat: FloatType, lng: FloatType });
const Address = StructType({ street: StringType, geo: Geo });
const Every = StructType({
    name: StringType, crew: IntegerType, weight: FloatType, rush: BooleanType, due: DateTimeType,
    status: Status, tags: SetType(StringType), steps: ArrayType(StringType), checks: ArrayType(Item),
    address: Address, bay: OptionType(IntegerType), stock: DictType(StringType, IntegerType),
});

const specsEqual = equalFor(ArrayType(FieldSpecType));
const printSpecs = printFor(ArrayType(FieldSpecType));

/** The specs are these, as East compares them. */
function assertSpecs(actual: FieldSpecValue[], expected: FieldSpecValue[]): void {
    assert.ok(specsEqual(actual, expected), `resolved\n${printSpecs(actual)}\nexpected\n${printSpecs(expected)}`);
}

/** A spec as the resolver makes one. */
function spec(path: string[], label: string, type: EastType, editor: FieldEditorValue, more: { group?: string; help?: string } = {}): FieldSpecValue {
    return {
        path, label,
        help: more.help === undefined ? none : some(more.help),
        group: more.group === undefined ? none : some(more.group),
        type: toEastTypeValue(type),
        optional: type.type === "Variant" && type.cases["some"] !== undefined && isTypeEqual(type, OptionType(type.cases["some"])),
        editor,
    };
}

const text = (placeholder?: string): FieldEditorValue => variant("text", { placeholder: placeholder === undefined ? none : some(placeholder) });
const number = (o: { unit?: string; step?: number; min?: number; max?: number } = {}): FieldEditorValue => variant("number", {
    unit: o.unit === undefined ? none : some(o.unit), step: o.step === undefined ? none : some(o.step),
    min: o.min === undefined ? none : some(o.min), max: o.max === undefined ? none : some(o.max),
});
const tags = (options: string[] = []): FieldEditorValue => variant("tags", { options });
const select = (...options: [string, string][]): FieldEditorValue => variant("select", options.map(([c, label]) => ({ case: c, label })));
const checkbox: FieldEditorValue = variant("checkbox", null);
const datetime: FieldEditorValue = variant("datetime", null);
const readonly: FieldEditorValue = variant("readonly", null);
const checklist = (textField: string, done: string): FieldEditorValue => variant("checklist", { text: textField, done });

test("with no hint, each field's editor is its type's, a nested struct's fields flattened under its name, in declared order", () => {
    assertSpecs(Fields.specs(Every), [
        spec(["name"], "Name", StringType, text()),
        spec(["crew"], "Crew", IntegerType, number()),
        spec(["weight"], "Weight", FloatType, number()),
        spec(["rush"], "Rush", BooleanType, checkbox),
        spec(["due"], "Due", DateTimeType, datetime),
        // East keeps a variant's cases in name order.
        spec(["status"], "Status", Status, select(["in_progress", "In progress"], ["planned", "Planned"])),
        spec(["tags"], "Tags", SetType(StringType), tags()),
        spec(["steps"], "Steps", ArrayType(StringType), tags()),
        spec(["checks"], "Checks", ArrayType(Item), checklist("text", "done")),
        spec(["address", "street"], "Street", StringType, text(), { group: "Address" }),
        spec(["address", "geo", "lat"], "Lat", FloatType, number(), { group: "Address · Geo" }),
        spec(["address", "geo", "lng"], "Lng", FloatType, number(), { group: "Address · Geo" }),
        // An Option: its value's editor, which can be cleared.
        spec(["bay"], "Bay", OptionType(IntegerType), number()),
        // Anything else: printed.
        spec(["stock"], "Stock", DictType(StringType, IntegerType), readonly),
    ]);
});

test("hints override the defaults, the hinted fields first in hint order, a nested struct's by path; a hidden field is left out", () => {
    assertSpecs(Fields.specs(Every, {
        weight: Fields.number({ unit: "kg", step: 0.5, min: 0, max: 40 }),
        name: Fields.text({ label: "Job", placeholder: "What it is", help: "As the client named it" }),
        status: Fields.select({ labels: { planned: "Not started" } }),
        tags: Fields.tags({ options: ["urgent", "fragile", "urgent"] }),
        checks: Fields.checklist({ label: "Checklist" }),
        crew: Fields.readonly({ help: "Set by the roster" }),
        address: { geo: { lng: Fields.hidden() }, street: Fields.text({ label: "Street address" }) },
        bay: Fields.number({ unit: "bay", min: 1n, max: 12n }),
    }), [
        spec(["weight"], "Weight", FloatType, number({ unit: "kg", step: 0.5, min: 0, max: 40 })),
        spec(["name"], "Job", StringType, text("What it is"), { help: "As the client named it" }),
        // The cases the hint labels first, then the rest.
        spec(["status"], "Status", Status, select(["planned", "Not started"], ["in_progress", "In progress"])),
        // An option suggested once.
        spec(["tags"], "Tags", SetType(StringType), tags(["urgent", "fragile"])),
        spec(["checks"], "Checklist", ArrayType(Item), checklist("text", "done")),
        spec(["crew"], "Crew", IntegerType, readonly, { help: "Set by the roster" }),
        spec(["address", "geo", "lat"], "Lat", FloatType, number(), { group: "Address · Geo" }),
        spec(["address", "street"], "Street address", StringType, text(), { group: "Address" }),
        spec(["bay"], "Bay", OptionType(IntegerType), number({ unit: "bay", min: 1, max: 12 })),
        spec(["rush"], "Rush", BooleanType, checkbox),
        spec(["due"], "Due", DateTimeType, datetime),
        spec(["steps"], "Steps", ArrayType(StringType), tags()),
        spec(["stock"], "Stock", DictType(StringType, IntegerType), readonly),
    ]);
});

test("omit leaves a host's own fields out; a reference names its keyed set; a hidden field of any type is gone", () => {
    const Visit = StructType({ title: StringType, start: DateTimeType, crew: OptionType(StringType), site: StringType, notes: StringType });
    assertSpecs(Fields.specs(Visit, { crew: Fields.reference({ of: "people", label: "Lead" }), notes: Fields.hidden() }, ["title", "start"]), [
        spec(["crew"], "Lead", OptionType(StringType), variant("reference", { of: "people" })),
        spec(["site"], "Site", StringType, text()),
    ]);
});

test("an Option is its value's editor, cleared to none; an Option of a struct is printed whole", () => {
    const Loose = StructType({
        when: OptionType(DateTimeType), status: OptionType(Status), ok: OptionType(BooleanType),
        labels: OptionType(ArrayType(StringType)), at: OptionType(Address),
    });
    assertSpecs(Fields.specs(Loose, { status: Fields.select({ labels: { in_progress: "Started" } }) }), [
        spec(["status"], "Status", OptionType(Status), select(["in_progress", "Started"], ["planned", "Planned"])),
        spec(["when"], "When", OptionType(DateTimeType), datetime),
        spec(["ok"], "Ok", OptionType(BooleanType), checkbox),
        spec(["labels"], "Labels", OptionType(ArrayType(StringType)), tags()),
        spec(["at"], "At", OptionType(Address), readonly),
    ]);
});

test("a checklist's text and done fields: the item's one String and one Boolean, or the ones the hint names among several", () => {
    const Noted = StructType({ text: StringType, done: BooleanType, note: OptionType(StringType) });
    const Two = StructType({ step: StringType, detail: StringType, done: BooleanType });
    const Lists = StructType({ noted: ArrayType(Noted), two: ArrayType(Two), named: ArrayType(Two) });
    assertSpecs(Fields.specs(Lists, { named: Fields.checklist({ text: "detail" }) }), [
        spec(["named"], "Named", ArrayType(Two), checklist("detail", "done")),
        // An Option field beside them does not count.
        spec(["noted"], "Noted", ArrayType(Noted), checklist("text", "done")),
        // Two String fields and no hint: printed.
        spec(["two"], "Two", ArrayType(Two), readonly),
    ]);
});

test("a hint that does not fit its field's type is refused, naming the field", () => {
    const Ids = StructType({ ids: ArrayType(IntegerType), done: ArrayType(StructType({ done: BooleanType })), two: ArrayType(StructType({ a: StringType, b: StringType, done: BooleanType })) });
    const refusals: [() => unknown, RegExp][] = [
        [() => Fields.specs(Every, { name: Fields.number() as never }), /"name" is a String field — Fields\.number edits an Integer or a Float field/],
        [() => Fields.specs(Every, { crew: Fields.text() as never }), /"crew" is an Integer field — Fields\.text edits a String field/],
        [() => Fields.specs(Every, { crew: Fields.reference({ of: "people" }) as never }), /"crew" is an Integer field — Fields\.reference names a keyed set's key/],
        [() => Fields.specs(Every, { name: Fields.reference({ of: "" }) }), /"name" is a String field — Fields\.reference names the keyed set its key is of/],
        [() => Fields.specs(Every, { crew: Fields.number({ min: 0.5 }) as never }), /"crew" is an Integer field — its number hint's min is a bigint/],
        [() => Fields.specs(Every, { weight: Fields.number({ max: 10n }) as never }), /"weight" is a Float field — its number hint's max is a finite number, not a bigint/],
        [() => Fields.specs(Every, { crew: Fields.number({ min: 5n, max: 1n }) }), /its number hint's min, 5, is more than its max, 1/],
        [() => Fields.specs(Every, { crew: Fields.number({ step: 0n }) }), /its number hint's step is 0/],
        [() => Fields.specs(Every, { status: Fields.select({ labels: { cancelled: "Cancelled" } }) as never }), /labels "cancelled", a case the variant does not have \(in_progress, planned\)/],
        [() => Fields.specs(Every, { rush: Fields.select() as never }), /"rush" is a Boolean field — Fields\.select chooses among a variant's cases/],
        [() => Fields.specs(Ids, { ids: Fields.tags() as never }), /"ids" is an Array of Integer field — Fields\.tags edits a Set or an Array of String/],
        [() => Fields.specs(Every, { tags: Fields.tags({ options: [1] as never }) }), /its tags hint's options are the String values it suggests/],
        [() => Fields.specs(Every, { name: Fields.checklist() as never }), /"name" is a String field — Fields\.checklist edits an Array of item structs/],
        [() => Fields.specs(Ids, { done: Fields.checklist() }), /"done"'s items have no String field to be a checklist's text/],
        [() => Fields.specs(Ids, { two: Fields.checklist() }), /"two"'s items have 2 String fields \(a, b\) — name the checklist's text field/],
        [() => Fields.specs(Ids, { two: Fields.checklist({ text: "done" }) }), /"two"'s checklist names "done" as its text field/],
        [() => Fields.specs(Every, { name: { [FIELD_HINT]: "colour" } as never }), /"name"'s hint is "colour", which is not one of Fields' hints/],
        [() => Fields.specs(Every, { name: { placeholder: "x" } as never }), /"name" is a String field — its hint is one of Fields' hints/],
        [() => Fields.specs(StructType({ at: OptionType(Address) }), { at: { street: Fields.text() } as never }), /"at" is an Option of Struct field — its hint is one of Fields' hints/],
        [() => Fields.specs(Every, { colour: Fields.text() } as never), /a hint names "colour", a field the struct does not have/],
        [() => Fields.specs(Every, { address: { zip: Fields.text() } } as never), /a hint names "address\.zip", a field the struct does not have/],
        [() => Fields.specs(Every, {}, ["colour"] as never), /omit names "colour", a field the struct does not have/],
        [() => Fields.specs(StringType as never), /a form is over a struct, not a String/],
    ];
    for (const [resolve, message] of refusals) assert.throws(resolve, message);
});

test("a hint is checked against its field's type at compile time", () => {
    const Row = StructType({ name: StringType, crew: IntegerType, weight: FloatType, status: Status });
    // Each is refused at build too; the checker refuses it first.
    assert.throws(() => Fields.specs(Row, {
        // @ts-expect-error — a number hint on a String field
        name: Fields.number(),
    }), /String field/);
    assert.throws(() => Fields.specs(Row, {
        // @ts-expect-error — an Integer field's bounds are bigints
        crew: Fields.number({ min: 0.5 }),
    }), /a bigint/);
    assert.throws(() => Fields.specs(Row, {
        // @ts-expect-error — a Float field's bounds are numbers
        weight: Fields.number({ max: 10n }),
    }), /a finite number/);
    assert.throws(() => Fields.specs(Row, {
        // @ts-expect-error — a select labels the variant's cases
        status: Fields.select({ labels: { cancelled: "Cancelled" } }),
    }), /a case the variant does not have/);
    assert.throws(() => Fields.specs(Row, {
        // @ts-expect-error — a checklist edits an Array of item structs
        name: Fields.checklist(),
    }), /Array of item structs/);
});

test("a name spelled out: words split at underscores, dashes and case changes, the first capitalised", () => {
    assert.deepEqual(
        ["in_progress", "createdBy", "ON_HOLD", "qty", "due-date", "x", ""].map(spellOut),
        ["In progress", "Created by", "On hold", "Qty", "Due date", "X", ""],
    );
});
