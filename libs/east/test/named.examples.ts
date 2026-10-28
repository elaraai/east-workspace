/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    ArrayType, East, FloatType, IntegerType, RecursiveType, StringType, StructType, VariantType, example, variant,
} from "@elaraai/east";

// ---------------------------------------------------------------------------
// Names and types held as values: for code that builds East over types it is
// handed. Each builds what its name would build where it is written.
// ---------------------------------------------------------------------------

const Machine = StructType({ name: StringType, site: StringType, status: StringType });
const Place = StructType({ site: StringType, name: StringType });
const Pair = StructType({ low: IntegerType, high: IntegerType });
const Reading = VariantType({ load: FloatType, output: FloatType });
const Part = RecursiveType((self) => StructType({ name: StringType, parts: ArrayType(self) }));

/** A field a caller names: here the site, as a library would be handed it. */
const FIELD = "site";

export const namedField = example({
    keywords: ["struct", "field", "name", "by name", "dynamic", "generic", "East.field"],
    description: "Read a struct's field by a name held as a value, as code building East over types it is handed does",
    fn: East.function([Machine], StringType, ($, machine) => East.field(machine, FIELD, StringType)),
    inputs: [{ name: "Press 1", site: "North", status: "up" }],
    returns: "North",
});

export const namedFieldRecursive = example({
    keywords: ["struct", "field", "name", "recursive", "RecursiveType", "tree", "East.field"],
    description: "Read a recursive value's field by name: it is read through to its node",
    fn: East.function([Part], IntegerType, ($, part) => East.field(part, "parts", ArrayType(Part)).size()),
    inputs: [{ name: "p1", parts: [{ name: "p1.1", parts: [] }, { name: "p1.2", parts: [] }] }],
    returns: 2n,
});

export const namedFields = example({
    keywords: ["struct", "fields", "names", "project", "reorder", "East.fields", "East.struct"],
    description: "Take a struct's fields by name, in the order wanted, into a struct of another type",
    fn: East.function([Machine], Place, ($, machine) => East.struct(Place, East.fields(machine, ["site", "name"]))),
    inputs: [{ name: "Press 1", site: "North", status: "up" }],
    returns: { site: "North", name: "Press 1" },
});

export const namedStruct = example({
    keywords: ["struct", "build", "construct", "positional", "East.struct"],
    description: "Build a struct of a type held as a value from its fields in the type's order",
    fn: East.function([IntegerType, IntegerType], Pair, ($, a, b) => East.struct(Pair, [East.min(a, b), East.max(a, b)])),
    inputs: [7n, 3n],
    returns: { low: 3n, high: 7n },
});

export const namedStructByName = example({
    keywords: ["struct", "build", "construct", "by name", "East.struct"],
    description: "Build a struct of a type held as a value from its fields by name, in any order",
    fn: East.function([IntegerType, IntegerType], Pair, ($, a, b) => East.struct(Pair, { high: East.max(a, b), low: East.min(a, b) })),
    inputs: [7n, 3n],
    returns: { low: 3n, high: 7n },
});

export const namedWithField = example({
    keywords: ["struct", "replace", "update", "field", "by name", "East.withField"],
    description: "Replace one field of a struct by its name, every other field as it is",
    fn: East.function([Machine], Machine, ($, machine) => East.withField(machine, "status", "down")),
    inputs: [{ name: "Press 1", site: "North", status: "up" }],
    returns: { name: "Press 1", site: "North", status: "down" },
});

export const namedInCase = example({
    keywords: ["variant", "case", "by name", "construct", "East.inCase"],
    description: "Put a value in a variant's case by the case's name",
    fn: East.function([FloatType], Reading, ($, value) => East.inCase(Reading, "output", value)),
    inputs: [0.82],
    returns: variant("output", 0.82),
});

/** The machines' patch functions, built once and bound where they are called. */
const machinePatches = East.patchesFor(Machine);

export const namedPatchesFor = example({
    keywords: ["patch", "diff", "apply", "generic", "type", "East.patchesFor"],
    description: "Diff and apply patches of a type held as a value, through its patch functions",
    fn: East.function([Machine, Machine], Machine, ($, before, after) => {
        const diffFn = $.const(machinePatches.diff);
        const applyFn = $.const(machinePatches.apply);
        return applyFn(before, diffFn(before, after));
    }),
    inputs: [{ name: "Press 1", site: "North", status: "up" }, { name: "Press 1", site: "North", status: "down" }],
    returns: { name: "Press 1", site: "North", status: "down" },
});
