/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The diff chips' text, over real East values: each change is a pair of
 * `ValueTypeOf` values of its East type, decoded from East's own encoding as
 * the Diff holds them, diffed by East (`diffFor`) and walked into leaves
 * exactly as the Diff walks them. A leaf prints as East prints it, so a chip
 * shows what differs — every digit, every millisecond — never a rounded or
 * guessed form of it.
 */

import { describe, test, expect } from "vitest";
import {
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    decodeBeast2For,
    diffFor,
    encodeBeast2For,
    none,
    some,
    toEastTypeValue,
    variant,
    type EastType,
    type ValueTypeOf,
} from "@elaraai/east";
import { TreePathType, type TreePath } from "@elaraai/e3-types";
import { formatters, type Formatters } from "@elaraai/east-ui-components";

import { formatBindingLabel, formatLeafValue } from "./format.js";
import { collectLeaves, walkPatchToTree, type DiffNode, type GroupNode, type LeafNode } from "./walker.js";

const en = formatters("en-US");
const de = formatters("de-DE");

/** A value as the Diff holds it: decoded from East's own encoding. */
function stored<T extends EastType>(type: T, value: ValueTypeOf<T>): ValueTypeOf<T> {
    return decodeBeast2For(type)(encodeBeast2For(type)(value));
}

/** The change from `before` to `after` as a tree, walked as the Diff walks it. */
function treeOf<T extends EastType>(type: T, before: ValueTypeOf<T>, after: ValueTypeOf<T>): DiffNode | null {
    const leafType = toEastTypeValue(type);
    return walkPatchToTree(leafType, diffFor(leafType)(stored(type, before), stored(type, after)), "binding");
}

/** The leaves of the change from `before` to `after`, walked as the Diff walks them. */
function leavesOf<T extends EastType>(type: T, before: ValueTypeOf<T>, after: ValueTypeOf<T>): LeafNode[] {
    const tree = treeOf(type, before, after);
    return tree === null ? [] : collectLeaves(tree);
}

/** The one leaf a change touches. */
function onlyLeaf<T extends EastType>(type: T, before: ValueTypeOf<T>, after: ValueTypeOf<T>): LeafNode {
    const leaves = leavesOf(type, before, after);
    expect(leaves).toHaveLength(1);
    return leaves[0]!;
}

/** The one leaf's two chips, before → after. */
function change<T extends EastType>(type: T, before: ValueTypeOf<T>, after: ValueTypeOf<T>, words: Formatters = en): [string, string] {
    const leaf = onlyLeaf(type, before, after);
    expect(leaf.op).toBe("update");
    return [formatLeafValue(leaf.leafType, leaf.before, words), formatLeafValue(leaf.leafType, leaf.after, words)];
}

describe("formatLeafValue — a primitive leaf prints as East prints it", () => {
    test("a Boolean", () => {
        expect(change(BooleanType, true, false)).toEqual(["true", "false"]);
    });

    test("an Integer, every digit — past a float's 2^53, to either end of its range", () => {
        expect(change(IntegerType, 2025n, 2026n)).toEqual(["2025", "2026"]);
        expect(change(IntegerType, 9007199254740992n, 9007199254740993n)).toEqual(["9007199254740992", "9007199254740993"]);
        expect(change(IntegerType, -9223372036854775808n, 9223372036854775807n)).toEqual(["-9223372036854775808", "9223372036854775807"]);
    });

    test("a Float, as East prints it in the viewer's decimal separator (#850)", () => {
        expect(change(FloatType, 42, 1234.567, en)).toEqual(["42.0", "1234.567"]);
        expect(change(FloatType, 42, 1234.567, de)).toEqual(["42,0", "1234,567"]);
    });

    test("a Float's every digit: a change past the fourth decimal stays visible", () => {
        expect(change(FloatType, 0.12345, 0.12346)).toEqual(["0.12345", "0.12346"]);
    });

    test("a Float's special values, as East prints them", () => {
        expect(change(FloatType, -0, Number.NaN)).toEqual(["-0.0", "NaN"]);
        expect(change(FloatType, 1, Number.POSITIVE_INFINITY)).toEqual(["1.0", "Infinity"]);
        expect(change(FloatType, -0, 1, de)).toEqual(["-0,0", "1,0"]);
    });

    test("a String, quoted — an empty or a padded one is as plain as any other", () => {
        expect(change(StringType, "Mech A", "Mech B")).toEqual(['"Mech A"', '"Mech B"']);
        expect(change(StringType, "", " ")).toEqual(['""', '" "']);
    });

    test("a String prints whole: a string leaf is the change itself", () => {
        const long = "Tension berth 2 belt, then inspect the tailings line at the south yard";
        expect(change(StringType, "", long)[1]).toBe(JSON.stringify(long));
    });

    test("a DateTime, its exact UTC instant to the millisecond", () => {
        const at = new Date(Date.UTC(2026, 5, 29, 1, 30));
        const later = new Date(Date.UTC(2026, 5, 29, 1, 30, 0, 1));
        expect(change(DateTimeType, at, later)).toEqual(["2026-06-29T01:30:00.000", "2026-06-29T01:30:00.001"]);
    });

    test("a Blob, its bytes — cut at the chip's width", () => {
        expect(change(BlobType, new Uint8Array([1, 2]), new Uint8Array([1, 2, 255]))).toEqual(["0x0102", "0x0102ff"]);
        const long = change(BlobType, new Uint8Array([0]), new Uint8Array(40).fill(171))[1];
        expect(long).toHaveLength(48);
        expect(long.startsWith("0xabab")).toBe(true);
        expect(long.endsWith("…")).toBe(true);
    });
});

describe("formatLeafValue — a variant and a container leaf print as East prints them", () => {
    test("a variant whose case changes: `.case`, with its payload when it has one", () => {
        expect(change(VariantType({ on: NullType, off: NullType }), variant("on", null), variant("off", null))).toEqual([".on", ".off"]);
        expect(change(OptionType(IntegerType), some(5n), none)).toEqual([".some 5", ".none"]);
    });

    test("a variant whose payload changes is a leaf of the payload's type", () => {
        expect(change(OptionType(IntegerType), some(5n), some(6n))).toEqual(["5", "6"]);
    });

    test("an inserted struct prints whole when it fits the chip", () => {
        const Crew = StructType({ crew: StringType, rate: FloatType });
        const leaf = onlyLeaf(ArrayType(Crew), [], [{ crew: "Mech A", rate: 1.5 }]);
        expect(leaf.op).toBe("insert");
        expect(leaf.before).toBeUndefined();
        expect(formatLeafValue(leaf.leafType, leaf.after, en)).toBe('(crew="Mech A", rate=1.5)');
    });

    test("a container past the chip's width is cut with …", () => {
        const Crew = StructType({ crew: StringType, rate: FloatType });
        const leaf = onlyLeaf(ArrayType(Crew), [], [{ crew: "Mechanical crew of the north berth", rate: 1234.5 }]);
        const text = formatLeafValue(leaf.leafType, leaf.after, en);
        expect(text).toHaveLength(48);
        expect(text.startsWith('(crew="Mechanical crew')).toBe(true);
        expect(text.endsWith("…")).toBe(true);
    });

    test("a deleted Dict entry prints its value; an added Set member prints itself", () => {
        const removed = onlyLeaf(DictType(StringType, IntegerType), new Map([["AU", 1n], ["NZ", 2n]]), new Map([["AU", 1n]]));
        expect(removed.op).toBe("delete");
        expect(removed.after).toBeUndefined();
        expect(formatLeafValue(removed.leafType, removed.before, en)).toBe("2");

        const added = onlyLeaf(SetType(StringType), new Set(["Mech A"]), new Set(["Mech A", "Struct"]));
        expect(added.op).toBe("insert");
        expect(formatLeafValue(added.leafType, added.after, en)).toBe('"Struct"');
    });
});

describe("formatBindingLabel", () => {
    test("the root", () => {
        expect(formatBindingLabel(stored(TreePathType, []))).toBe("(root)");
    });

    test("the last field on the path, by its name", () => {
        const path: TreePath = [variant("field", "inputs"), variant("field", "sales")];
        expect(formatBindingLabel(stored(TreePathType, path))).toBe("sales");
        expect(formatBindingLabel(stored(TreePathType, [variant("field", "work orders")]))).toBe("work orders");
    });
});

describe("walkPatchToTree — a Dict key's label is the key as East reads it back", () => {
    const Rates = DictType(StringType, StructType({ rate: FloatType }));

    /** The group a one-entry change opens under the root. */
    function entryOf(key: string): GroupNode {
        const root = treeOf(Rates, new Map([[key, { rate: 1 }]]), new Map([[key, { rate: 2 }]]));
        expect(root?.kind).toBe("group");
        const entry = (root as GroupNode).children[0];
        expect(entry?.kind).toBe("group");
        return entry as GroupNode;
    }

    test("a String key shows without its quotes; its path keeps East's printed form", () => {
        const entry = entryOf("Mech A");
        expect(entry.label).toBe("Mech A");
        expect(entry.path).toBe('{"Mech A"}');
        expect(entry.children.map((c) => c.label)).toEqual(["rate"]);
    });

    test("a quote or a backslash in a String key reads back as itself", () => {
        expect(entryOf('Berth "North"').label).toBe('Berth "North"');
        expect(entryOf("C:\\yard").label).toBe("C:\\yard");
    });

    test("a key of another type shows as East prints it", () => {
        const leaf = onlyLeaf(DictType(IntegerType, FloatType), new Map([[7n, 1]]), new Map([[7n, 2]]));
        expect(leaf.label).toBe("7");
        expect(leaf.path).toBe("{7}");
    });
});
