/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, StringType, StructType, BooleanType, example } from "@elaraai/east";

// ---------------------------------------------------------------------------
// Struct Creation and Field Access
// ---------------------------------------------------------------------------

export const structFieldAccess = example({
    keywords: ["struct", "StructType", "field", "access", "property"],
    description: "Create a struct and access its fields",
    fn: East.function([], StringType, ($) => {
        const person = $.const({ name: "Alice", age: 30n });
        return person.name;
    }),
    inputs: [],
    returns: "Alice",
});

export const structNested = example({
    keywords: ["struct", "StructType", "nested", "field", "access"],
    description: "Access fields of a nested struct",
    fn: East.function([], StringType, ($) => {
        const nested = $.const({
            user: { name: "Bob", age: 25n },
            active: true,
        });
        return nested.user.name;
    }),
    inputs: [],
    returns: "Bob",
});

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

export const structIs = example({
    keywords: ["struct", "StructType", "is", "identity", "equality"],
    description: "Check structural equality with East.is",
    fn: East.function([], BooleanType, ($) => {
        const s1 = $.const({ x: 10n, y: "test" });
        const s2 = $.const({ x: 10n, y: "test" });
        return East.is(s1, s2);
    }),
    inputs: [],
    returns: true,
});

export const structEqual = example({
    keywords: ["struct", "StructType", "equal", "equality", "comparison"],
    description: "Check struct equality with East.equal",
    fn: East.function([], BooleanType, ($) => {
        const s1 = $.const({ x: 10n, y: "test" });
        const s2 = $.const({ x: 10n, y: "test" });
        return East.equal(s1, s2);
    }),
    inputs: [],
    returns: true,
});

export const structNotEqual = example({
    keywords: ["struct", "StructType", "notEqual", "inequality", "comparison"],
    description: "Check struct inequality with East.notEqual",
    fn: East.function([], BooleanType, ($) => {
        const s1 = $.const({ x: 10n, y: "test" });
        const s2 = $.const({ x: 5n, y: "test" });
        return East.notEqual(s1, s2);
    }),
    inputs: [],
    returns: true,
});

// ---------------------------------------------------------------------------
// Printing and Parsing
// ---------------------------------------------------------------------------

export const structPrint = example({
    keywords: ["struct", "StructType", "print", "string", "display"],
    description: "Print a struct as a string representation",
    fn: East.function([], StringType, ($) => {
        const s = $.const({ a: 1n, b: "hello" });
        return East.print(s);
    }),
    inputs: [],
    returns: '(a=1, b="hello")',
});

export const structParse = example({
    keywords: ["struct", "StructType", "parse", "string", "deserialize"],
    description: "Parse a string into a struct",
    fn: East.function([], StructType({ a: IntegerType, b: StringType }), ($) => {
        const s = $.const('(a = 1, b = "hello")');
        return s.parse(StructType({ a: IntegerType, b: StringType }));
    }),
    inputs: [],
    returns: { a: 1n, b: "hello" },
});

// ---------------------------------------------------------------------------
// Fields named like integers
// ---------------------------------------------------------------------------

/** A struct with fields named like integers: an object lists `"10"` and `"2"`
 *  before `b`, wherever they were written, so the fields are given as a list,
 *  in the struct's order. */
const Counts = StructType([["b", IntegerType], ["10", IntegerType], ["2", IntegerType]]);

export const structIntegerNamedFields = example({
    keywords: ["struct", "StructType", "field order", "integer-like names", "list of fields", "print"],
    description: "Declare a struct whose fields are named like integers as a list of its fields, which keeps their order",
    fn: East.function([Counts], StringType, ($, counts) => East.print(counts)),
    inputs: [{ b: 1n, "10": 2n, "2": 3n }],
    returns: "(b=1, `10`=2, `2`=3)",
});
