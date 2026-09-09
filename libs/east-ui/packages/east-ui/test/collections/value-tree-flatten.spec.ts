/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ValueTree ROW MODEL (#719) — renderer-agnostic row math shared by the
 * browser renderer and the terminal, so a value reads identically in both.
 *
 * Pure `node:test` over decoded values (no East expression methods, so no
 * companion examples file): labels, summaries, item titles, path identity,
 * inline flatten with an open-set / openDepth, paged flatten prefix sums,
 * the page binary search, placeholder rows, root-row lookups, page
 * retention, and the key-search predicates.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    toEastTypeValue,
    variant,
} from "@elaraai/east";
import {
    ValueTree,
    flattenRows,
    flattenPaged,
    pageOfFlat,
    pagedRowAt,
    pagedFlatIndexOfRoot,
    flatIndexOfRoot,
    pruneRetainedPages,
    humanize,
    pathKey,
    itemTitle,
    summaryOf,
    childrenOf,
    keyRangePredicates,
    parseKeyInput,
    findKeyInline,
    DEFAULT_OPEN_DEPTH,
    type RowModel,
    type ValueTreePagedRow,
    type ValueTreePaging,
} from "@elaraai/east-ui/internal";

// ---------------------------------------------------------------------------
// Fixtures — one machine value the way a host holds it (decoded JS), and
// the node tree the materializer produces from it.
// ---------------------------------------------------------------------------

const StateType = VariantType({ Running: NullType, Stopped: NullType, Fault: StringType });
const MachineType = StructType({
    machine: StringType,
    flowRate: FloatType,
    state: StateType,
    note: OptionType(StringType),
    tags: ArrayType(StringType),
});
const PlantType = StructType({
    site: StringType,
    machines: ArrayType(MachineType),
    overrides: DictType(StringType, FloatType),
});

const press = {
    machine: "Press",
    flowRate: 2.5,
    state: variant("Running", null),
    note: none,
    tags: ["a", "b", "c"],
};
const deli = {
    machine: "Deli",
    flowRate: 1.25,
    state: variant("Fault", "belt"),
    note: some("watch"),
    tags: [],
};
const plant = {
    site: "North",
    machines: [press, deli],
    overrides: new Map([["base", 1.0], ["peak", 1.5]]),
};

const labels = (rows: RowModel[]): string[] => rows.map(r => `${"  ".repeat(r.depth)}${r.label}`);

describe("ValueTree row model", () => {
    test("humanize turns field names into end-user labels", () => {
        assert.equal(humanize("flowRate"), "Flow rate");
        assert.equal(humanize("flow_rate"), "Flow rate");
        assert.equal(humanize("min-confidence"), "Min confidence");
        assert.equal(humanize("id"), "Id");
        assert.equal(humanize(""), "");
        assert.equal(humanize("_"), "_");
    });

    test("summaryOf previews the first leaf parts of a struct, counts collections", () => {
        const node = ValueTree.materialize(MachineType, press);
        assert.equal(summaryOf(node), "Press · 2.5 · Running");
        const tags = ValueTree.materialize(ArrayType(StringType), ["a", "b", "c"]);
        assert.equal(summaryOf(tags), "3 items");
        assert.equal(summaryOf(ValueTree.materialize(ArrayType(StringType), [])), "Empty");
        assert.equal(summaryOf(ValueTree.materialize(ArrayType(StringType), ["x"])), "1 item");
        const dict = ValueTree.materialize(DictType(StringType, FloatType), plant.overrides);
        assert.equal(summaryOf(dict), "2 entries");
        const bare = ValueTree.materialize(StructType({ a: NullType, b: NullType }), { a: null, b: null });
        assert.equal(summaryOf(bare), "2 fields");
    });

    test("itemTitle is the first non-empty string leaf, else Item N", () => {
        assert.equal(itemTitle(ValueTree.materialize(MachineType, press), 0), "Press");
        assert.equal(itemTitle(ValueTree.materialize(StructType({ n: IntegerType }), { n: 1n }), 4), "Item 5");
        assert.equal(itemTitle(ValueTree.materialize(StringType, "plain"), 0), "Item 1");
    });

    test("childrenOf labels struct fields, array items and dict entries", () => {
        const node = ValueTree.materialize(PlantType, plant);
        assert.deepEqual(childrenOf(node).map(c => c.label), ["Site", "Machines", "Overrides"]);
        const machines = childrenOf(node)[1]!.node;
        assert.deepEqual(childrenOf(machines).map(c => c.label), ["Press", "Deli"]);
        assert.deepEqual(childrenOf(machines).map(c => c.step), [variant("index", 0n), variant("index", 1n)]);
        const overrides = childrenOf(node)[2]!.node;
        assert.deepEqual(childrenOf(overrides).map(c => c.label), ["base", "peak"]);
        assert.deepEqual(childrenOf(overrides).map(c => c.step), [variant("key", "base"), variant("key", "peak")]);
    });

    test("pathKey is a stable text identity for a node path", () => {
        assert.equal(pathKey([]), "$");
        assert.equal(pathKey([variant("field", "machines"), variant("index", 1n)]), ".machines[1]");
        assert.equal(pathKey([variant("field", "overrides"), variant("key", "base")]), ".overrides{base}");
        assert.equal(pathKey([variant("field", "note"), some(null)]), ".note?");
        assert.equal(pathKey([variant("field", "state"), variant("tag", null)]), ".state!");
    });

    test("flattenRows lists a compound root's children with the default open depth", () => {
        const root = ValueTree.materialize(PlantType, plant);
        const rows = flattenRows(root, {}, DEFAULT_OPEN_DEPTH, false, false);
        // Depth 0 rows start expanded (DEFAULT_OPEN_DEPTH = 1); their children start collapsed.
        assert.deepEqual(labels(rows), [
            "Site",
            "Machines",
            "  Press",
            "  Deli",
            "Overrides",
            "  base",
            "  peak",
        ]);
        const machines = rows[1]!;
        assert.equal(machines.kind, "array");
        assert.equal(machines.summary, "2 items");
        assert.equal(machines.expandable, true);
        assert.equal(machines.expanded, true);
        assert.equal(machines.id, ".machines");
        const pressRow = rows[2]!;
        assert.equal(pressRow.parentId, ".machines");
        assert.equal(pressRow.expanded, false);
        // The content-derived title already IS the first preview part.
        assert.equal(pressRow.summary, "2.5 · Running");
        assert.deepEqual(pressRow.path, [variant("field", "machines"), variant("index", 0n)]);
        assert.equal(pressRow.posinset, 1);
        assert.equal(pressRow.setsize, 2);
    });

    test("flattenRows honours the open-set over the open depth, in both directions", () => {
        const root = ValueTree.materialize(PlantType, plant);
        const rows = flattenRows(root, { ".machines[1]": true, ".overrides": false }, DEFAULT_OPEN_DEPTH, false, false);
        assert.deepEqual(labels(rows), [
            "Site",
            "Machines",
            "  Press",
            "  Deli",
            "    Machine",
            "    Flow rate",
            "    State",
            "    Note",
            "    Tags",
            "Overrides",
        ]);
        const state = rows[6]!;
        assert.equal(state.kind, "leaf");
        assert.deepEqual(state.variantCtl, {
            path: [variant("field", "machines"), variant("index", 1n), variant("field", "state")],
            tag: "Fault",
            tags: ["Fault", "Running", "Stopped"],
        });
        assert.deepEqual(state.path, [variant("field", "machines"), variant("index", 1n), variant("field", "state"), variant("tag", null)]);
        const note = rows[7]!;
        assert.equal(note.kind, "leaf");
        assert.deepEqual(note.optionCtl, {
            path: [variant("field", "machines"), variant("index", 1n), variant("field", "note")],
            isSome: true,
        });
        assert.equal(rows[8]!.summary, "Empty");
    });

    test("flattenRows renders a none option as Not set, and a scalar root as one Value row", () => {
        const root = ValueTree.materialize(MachineType, press);
        const rows = flattenRows(root, {}, 0, false, false);
        const note = rows.find(r => r.label === "Note")!;
        assert.equal(note.kind, "emptyOption");
        assert.equal(note.summary, "Not set");
        assert.deepEqual(note.optionCtl, { path: [variant("field", "note")], isSome: false });
        const scalar = flattenRows(ValueTree.materialize(IntegerType, 7n), {}, 1, false, false);
        assert.equal(scalar.length, 1);
        assert.equal(scalar[0]!.label, "Value");
        assert.equal(scalar[0]!.id, "$");
        assert.deepEqual(scalar[0]!.leaf, variant("integer", 7n));
    });

    test("flattenRows appends the add ghost row and marks items removable when editable", () => {
        const root = ValueTree.materialize(ArrayType(StringType), ["a", "b"]);
        const rows = flattenRows(root, {}, 1, true, true);
        assert.deepEqual(rows.map(r => r.kind), ["leaf", "leaf", "appendArray"]);
        assert.deepEqual(rows.map(r => r.removable), [true, true, false]);
        assert.equal(rows[2]!.id, "$/$append");
        assert.equal(rows[2]!.label, "Add item");
        assert.deepEqual(rows[2]!.path, []);
        const dict = ValueTree.materialize(DictType(StringType, FloatType), plant.overrides);
        const dictRows = flattenRows(dict, {}, 1, true, true);
        assert.equal(dictRows[2]!.kind, "appendDict");
        assert.equal(dictRows[2]!.label, "Add entry");
        // Non-string keys cannot be typed as text: no ghost row, nothing removable.
        const intDict = ValueTree.materialize(DictType(IntegerType, StringType), new Map([[1n, "x"]]));
        const intRows = flattenRows(intDict, {}, 1, true, true);
        assert.deepEqual(intRows.map(r => r.kind), ["leaf"]);
        assert.equal(intRows[0]!.removable, false);
    });

    test("flatIndexOfRoot finds the N-th depth-0 row past expanded children", () => {
        const root = ValueTree.materialize(PlantType, plant);
        const rows = flattenRows(root, {}, DEFAULT_OPEN_DEPTH, false, false);
        assert.equal(flatIndexOfRoot(rows, 0), 0);
        assert.equal(flatIndexOfRoot(rows, 1), 1);
        assert.equal(flatIndexOfRoot(rows, 2), 4);
        assert.equal(flatIndexOfRoot(rows, 3), undefined);
    });
});

describe("ValueTree paged row model", () => {
    const pagedRow = (i: number): ValueTreePagedRow => ({
        node: ValueTree.materialize(MachineType, { ...press, machine: `m${i}` }),
        step: variant("index", BigInt(i)),
    });
    const pageOf = (p: number, size: number, total: number): ValueTreePagedRow[] => {
        const rows: ValueTreePagedRow[] = [];
        for (let i = p * size; i < Math.min(total, (p + 1) * size); i++) rows.push(pagedRow(i));
        return rows;
    };
    const paging = (pages: ReadonlyMap<number, readonly ValueTreePagedRow[]>, totalRows = 1200, pageSize = 500): ValueTreePaging => ({
        totalRows, pageSize, pages, onNeedRows: () => undefined,
    });

    test("flattenPaged places one placeholder per unloaded root and the loaded rows in between", () => {
        const pages = new Map([[1, pageOf(1, 500, 1200)]]);
        const flat = flattenPaged(paging(pages), {}, 0);
        assert.equal(flat.pageCount, 3);
        assert.deepEqual(flat.prefix, [0, 500, 1000, 1200]);
        assert.equal(flat.totalFlat, 1200);
        assert.equal(flat.loadedRows.length, 500);
        assert.equal(flat.rootRowsInPage(2), 200);
        assert.equal(flat.loadedRows[0]!.label, "m500");
        assert.equal(flat.loadedRows[0]!.posinset, 501);
        assert.equal(flat.loadedRows[0]!.setsize, 1200);
    });

    test("flattenPaged expands loaded rows and shifts the prefix sums accordingly", () => {
        const pages = new Map([[0, pageOf(0, 500, 1200)]]);
        const flat = flattenPaged(paging(pages), { "[0]": true }, 0);
        // Row 0 expanded: its 5 fields sit between root 0 and root 1.
        assert.deepEqual(flat.prefix, [0, 505, 1005, 1205]);
        assert.equal(flat.pageModels.get(0)!.length, 505);
        assert.deepEqual(labels(flat.pageModels.get(0)!.slice(0, 7)), ["m0", "  Machine", "  Flow rate", "  State", "  Note", "  Tags", "m1"]);
    });

    test("pageOfFlat binary-searches the page of a flat index", () => {
        const prefix = [0, 505, 1005, 1205];
        assert.equal(pageOfFlat(prefix, 0), 0);
        assert.equal(pageOfFlat(prefix, 504), 0);
        assert.equal(pageOfFlat(prefix, 505), 1);
        assert.equal(pageOfFlat(prefix, 1004), 1);
        assert.equal(pageOfFlat(prefix, 1005), 2);
        assert.equal(pageOfFlat(prefix, 1204), 2);
    });

    test("pagedRowAt resolves loaded models and placeholders", () => {
        const pages = new Map([[1, pageOf(1, 500, 1200)]]);
        const p = paging(pages);
        const flat = flattenPaged(p, {}, 0);
        assert.deepEqual(pagedRowAt(flat, p, 7), { kind: "placeholder", globalRow: 7 });
        const loaded = pagedRowAt(flat, p, 503);
        assert.equal(loaded.kind, "model");
        assert.equal(loaded.kind === "model" && loaded.row.label, "m503");
        assert.deepEqual(pagedRowAt(flat, p, 1199), { kind: "placeholder", globalRow: 1199 });
    });

    test("pagedFlatIndexOfRoot walks loaded pages and clamps to the collection", () => {
        const pages = new Map([[0, pageOf(0, 500, 1200)]]);
        const p = paging(pages);
        const flat = flattenPaged(p, { "[0]": true }, 0);
        assert.equal(pagedFlatIndexOfRoot(flat, p, 0), 0);
        assert.equal(pagedFlatIndexOfRoot(flat, p, 1), 6);
        assert.equal(pagedFlatIndexOfRoot(flat, p, 600), 505 + 100);
        assert.equal(pagedFlatIndexOfRoot(flat, p, 99_999), 1005 + 199);
        assert.equal(pagedFlatIndexOfRoot(flat, paging(new Map(), 0), 3), undefined);
    });

    test("pruneRetainedPages keeps the window and the nearest pages up to the cap", () => {
        const pages = new Map<number, string>([[0, "a"], [1, "b"], [2, "c"], [10, "d"], [11, "e"], [12, "f"], [20, "g"]]);
        assert.equal(pruneRetainedPages(pages, 10, 12, 8), pages);
        const kept = pruneRetainedPages(pages, 10, 12, 4);
        assert.deepEqual([...kept.keys()], [2, 10, 11, 12]);
        const far = pruneRetainedPages(pages, 1000, 1001, 3);
        assert.deepEqual([...far.keys()], [11, 12, 20]);
    });
});

describe("ValueTree key search", () => {
    const StringKey = toEastTypeValue(StringType);
    const MachineKey = toEastTypeValue(StructType({ machine: StringType, shift: IntegerType }));

    test("parseKeyInput types String keys as a prefix and struct keys as leading fields", () => {
        assert.deepEqual(parseKeyInput(StringKey, "k01"), { kind: "query", query: { prefix: "k01" } });
        assert.deepEqual(parseKeyInput(MachineKey, "press"), { kind: "query", query: { prefix: "press" } });
        assert.deepEqual(parseKeyInput(MachineKey, "press, 2"), { kind: "query", query: { fields: ['"press"', "2"] } });
        assert.deepEqual(parseKeyInput(MachineKey, "press,"), { kind: "query", query: { fields: ['"press"'] } });
        assert.deepEqual(parseKeyInput(MachineKey, '(machine="press", shift=2)'), { kind: "query", query: { key: '(machine="press", shift=2)' } });
        assert.deepEqual(parseKeyInput(MachineKey, "press, x"), { kind: "hint", hint: "shift is Integer — key is (machine: String, shift: Integer)" });
        assert.deepEqual(parseKeyInput(toEastTypeValue(IntegerType), "x"), { kind: "hint", hint: "Key is Integer" });
        assert.deepEqual(parseKeyInput(toEastTypeValue(IntegerType), "12"), { kind: "query", query: { key: "12" } });
    });

    test("keyRangePredicates bound a String prefix range, and null for an exact key", () => {
        const range = keyRangePredicates(StringKey, { prefix: "k01" })!;
        assert.equal(range.lower("a"), false);
        assert.equal(range.lower("k010"), true);
        assert.equal(range.upper("k015"), false);
        assert.equal(range.upper("k02"), true);
        assert.equal(keyRangePredicates(StringKey, { key: '"k010"' }), null);
    });

    test("keyRangePredicates bound struct-key ranges by exact leading fields then a prefix", () => {
        const keys = [
            { machine: "deli", shift: 1n },
            { machine: "press", shift: 1n },
            { machine: "press", shift: 2n },
            { machine: "pressure", shift: 1n },
            { machine: "saw", shift: 1n },
        ];
        const exact = keyRangePredicates(MachineKey, { fields: ['"press"'] })!;
        assert.deepEqual(keys.map(exact.lower), [false, true, true, true, true]);
        assert.deepEqual(keys.map(exact.upper), [false, false, false, true, true]);
        const prefixed = keyRangePredicates(MachineKey, { fields: [], prefix: "pre" })!;
        assert.deepEqual(keys.map(prefixed.lower), [false, true, true, true, true]);
        assert.deepEqual(keys.map(prefixed.upper), [false, false, false, false, true]);
        const nested = keyRangePredicates(MachineKey, { fields: ['"press"', "2"] })!;
        assert.deepEqual(keys.map(nested.lower), [false, false, true, true, true]);
        assert.deepEqual(keys.map(nested.upper), [false, false, false, true, true]);
    });

    test("findKeyInline locates exact, prefix and field queries over decoded keys", () => {
        const keys = ["a", "k010", "k011", "k02"];
        assert.deepEqual(findKeyInline(StringKey, keys, { prefix: "k01" }), { found: true, row: 1, count: 2 });
        assert.deepEqual(findKeyInline(StringKey, keys, { key: '"k011"' }), { found: true, row: 2, count: 1 });
        assert.deepEqual(findKeyInline(StringKey, keys, { key: '"k0105"' }), { found: false, row: 2, count: 0 });
        assert.deepEqual(findKeyInline(StringKey, keys, { prefix: "zz" }), { found: false, row: 4, count: 0 });
        const structKeys = [{ machine: "deli", shift: 1n }, { machine: "press", shift: 1n }, { machine: "press", shift: 2n }];
        assert.deepEqual(findKeyInline(MachineKey, structKeys, { fields: ['"press"'] }), { found: true, row: 1, count: 2 });
    });
});
