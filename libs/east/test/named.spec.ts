/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Names and types held as values: East.field, East.fields, East.struct,
 * East.withField, East.inCase and East.patchesFor build what their names
 * would build where they are written — run as an East suite (exported for
 * east-c and east-py like any spec) — and refuse, as the program is built,
 * a name the type does not have, naming it and the type. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, DictType, East, FloatType, IntegerType, NullType, RecursiveType, StringType, StructType, VariantType, variant,
} from "../src/index.js";
import { describeEast, assertEast } from "./platforms.spec.js";
import * as ex from "./named.examples.js";

const Machine = StructType({ name: StringType, site: StringType, status: StringType });
const Pair = StructType({ low: IntegerType, high: IntegerType });
const Reading = VariantType({ load: FloatType, output: FloatType });
const Part = RecursiveType((self) => StructType({ name: StringType, parts: ArrayType(self) }));
const List = RecursiveType((self) => VariantType({ nil: NullType, cons: StructType({ head: IntegerType, tail: self }) }));
const Loads = DictType(StringType, FloatType);

await describeEast("Names and types held as values", (test) => {
    assertEast.examples(test, {
        namedField: ex.namedField,
        namedFieldRecursive: ex.namedFieldRecursive,
        namedFields: ex.namedFields,
        namedStruct: ex.namedStruct,
        namedStructByName: ex.namedStructByName,
        namedWithField: ex.namedWithField,
        namedInCase: ex.namedInCase,
        namedPatchesFor: ex.namedPatchesFor,
    });

    test("a field read by name is the field read where it is written", $ => {
        const machine = $.let(East.value({ name: "Press 1", site: "North", status: "up" }, Machine));
        $(assertEast.equal(East.field(machine, "name", StringType), machine.name));
        $(assertEast.equal(East.field(machine, "site"), "North"));
        // Every field, in the struct's order; or the ones named, in their order.
        $(assertEast.equal(East.struct(Machine, East.fields(machine)), machine));
        $(assertEast.equal(East.struct(StructType({ status: StringType, name: StringType }), East.fields(machine, ["status", "name"])),
            { status: "up", name: "Press 1" }));
    });

    test("a recursive value is read, built and rebuilt through its node", $ => {
        const part = $.let(East.struct(Part, { name: "p1", parts: [East.struct(Part, { name: "p1.1", parts: [] })] }));
        $(assertEast.equal(East.field(part, "name", StringType), "p1"));
        $(assertEast.equal(East.field(part, "parts", ArrayType(Part)).size(), 1n));
        $(assertEast.equal(part.unwrap().parts.get(0n).unwrap().name, "p1.1"));
        // Rebuilt: the node with one field replaced, wrapped again in the recursive type.
        const renamed = $.let(East.withField(part, "name", "p2"));
        $(assertEast.equal(renamed.unwrap().name, "p2"));
        $(assertEast.equal(renamed.unwrap().parts, part.unwrap().parts));
        // A recursive variant's case: its node built, and wrapped.
        $(assertEast.equal(East.inCase(List, "nil", null).unwrap().hasTag("nil"), true));
        const one = $.let(East.inCase(List, "cons", { head: 1n, tail: East.inCase(List, "nil", null) }));
        $(assertEast.equal(one.unwrap().unwrap("cons").head, 1n));
    });

    test("a struct is built by name or in order, and a field replaced, as a literal builds them", $ => {
        $(assertEast.equal(East.struct(Pair, [3n, 7n]), { low: 3n, high: 7n }));
        $(assertEast.equal(East.struct(Pair, { high: 7n, low: 3n }), { low: 3n, high: 7n }));
        const machine = $.let(East.value({ name: "Press 1", site: "North", status: "up" }, Machine));
        $(assertEast.equal(East.withField(machine, "status", "down"), { ...machine, status: "down" }));
    });

    test("a variant's case is built by name as variant() builds it", $ => {
        $(assertEast.equal(East.inCase(Reading, "load", 0.5), East.value(variant("load", 0.5), Reading)));
        $(assertEast.equal(East.inCase(Reading, "output", East.value(2.0)).unwrap("output"), 2.0));
    });

    test("a type's patch functions diff, apply, compose and invert as East's patch operations do", $ => {
        const loads = East.patchesFor(Loads);
        const diff = $.const(loads.diff);
        const apply = $.const(loads.apply);
        const compose = $.const(loads.compose);
        const invert = $.const(loads.invert);
        const a = $.let(East.value(new Map([["m-1", 0.5], ["m-2", 0.6]]), Loads));
        const b = $.let(East.value(new Map([["m-1", 0.7], ["m-3", 0.2]]), Loads));
        const c = $.let(East.value(new Map([["m-3", 0.9]]), Loads));
        $(assertEast.equal(diff(a, b), East.diff(a, b)));
        $(assertEast.equal(apply(a, diff(a, b)), b));
        $(assertEast.equal(apply(a, compose(diff(a, b), diff(b, c))), c));
        $(assertEast.equal(apply(b, invert(diff(a, b))), a));
    });
});

describe("Names and types held as values — refused as the program is built, naming the name and the type", () => {
    const machine = (): ReturnType<typeof East.value> => East.value({ name: "Press 1", site: "North", status: "up" }, Machine);

    test("a field the struct does not have, or of another type than the one given", () => {
        assert.throws(() => East.field(machine(), "job"), /^Error: East\.field: \.Struct \{name, site, status\} has no field 'job'$/);
        assert.throws(() => East.field(machine(), "site", IntegerType), /^Error: East\.field: 'site' of \.Struct \{name, site, status\} is \.String, not \.Integer$/);
        assert.throws(() => East.field(East.value(1n), "site"), /^Error: East\.field 'site': \.Integer is not a struct$/);
        assert.throws(() => East.fields(machine(), ["name", "job"]), /^Error: East\.field: \.Struct \{name, site, status\} has no field 'job'$/);
    });

    test("a struct built of fields its type does not have, missing one, given the wrong number, or a value of another type", () => {
        assert.throws(() => East.struct(Pair, { low: 1n, high: 2n, mid: 3n }), /^Error: East\.struct: \.Struct \{low, high\} has no field 'mid'$/);
        assert.throws(() => East.struct(Pair, { low: 1n }), /^Error: East\.struct: no value for the field 'high' of \.Struct \{low, high\}$/);
        assert.throws(() => East.struct(Pair, [1n]), /^Error: East\.struct: \.Struct \{low, high\} has 2 fields, given 1$/);
        assert.throws(() => East.struct(Reading, [1.0]), /^Error: East\.struct: \.Variant \(load \| output\) is not a struct$/);
        assert.throws(() => East.struct(Pair, { low: "one", high: 2n }));
    });

    test("a field replaced that the struct does not have, or by a value of another type", () => {
        assert.throws(() => East.withField(machine(), "job", "x"), /^Error: East\.withField: \.Struct \{name, site, status\} has no field 'job'$/);
        assert.throws(() => East.withField(machine(), "status", 1n));
    });

    test("a case the variant does not have, a type that is not a variant, or a value of another type", () => {
        assert.throws(() => East.inCase(Reading, "speed", 1.0), /^Error: East\.inCase: \.Variant \(load \| output\) has no case 'speed'$/);
        assert.throws(() => East.inCase(Pair, "low", 1n), /^Error: East\.inCase: \.Struct \{low, high\} is not a variant$/);
        assert.throws(() => East.inCase(Reading, "load", "high"));
    });
});
