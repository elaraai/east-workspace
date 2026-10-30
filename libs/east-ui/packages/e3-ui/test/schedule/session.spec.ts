/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * A type's value as a record's session carries it on its wire
 * (`scheduleTypeValue`): one beast2 constant, read where the wire is built —
 * the type's own value, in a program of the same few nodes however large the
 * type. Written out a node at a time, a decision's case, its change a patch of
 * another record's rows, was 8,600 nodes, twice in each of the queue's
 * programs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, EastTypeType, FloatType, IntegerType, OptionType, RecursiveType, SetType, StringType, StructType,
    VariantType, equalFor, toEastTypeValue, walkIR, type EastType,
} from "@elaraai/east";
import { scheduleTypeValue } from "@elaraai/e3-ui/internal";

/** A program returning a type's value as a session carries it. */
const program = (type: EastType) => East.function([], EastTypeType, () => scheduleTypeValue(type));

/** A program's IR nodes, counted as the examples' size spec counts them. */
function nodesOf(type: EastType): number {
    let nodes = 0;
    walkIR(program(type).toIR().ir, () => { nodes += 1; });
    return nodes;
}

const equalType = equalFor(EastTypeType);

/** A row, a recursive type, and the type of types — a recursive variant of every kind of type. */
const types: ReadonlyArray<readonly [string, EastType]> = [
    ["a row", StructType({ id: StringType, at: DateTimeType, amount: OptionType(FloatType), tags: SetType(StringType), parts: DictType(StringType, IntegerType) })],
    ["a recursive type", RecursiveType(self => VariantType({ leaf: IntegerType, node: ArrayType(self) }))],
    ["the type of types", EastTypeType],
];

test("reads each type's own value", () => {
    for (const [name, type] of types) {
        assert.ok(equalType(East.compile(program(type), [])(), toEastTypeValue(type)), name);
    }
});

test("its program is the same few nodes however large the type", () => {
    const integer = nodesOf(IntegerType);
    assert.deepEqual(types.map(([name, type]) => [name, nodesOf(type)]), types.map(([name]) => [name, integer]));
});
