/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * A record whose rows' keys the app builds from them (`key`,
 * east-workspace#1709), as a Sheet and a Record are told it: what the sheet
 * carries to keep each row under the key it builds — an entry's bytes to its
 * key's text (`rowKey`) — the one rule beside `newKey`, and what each tag
 * refuses. A row added and moved in a browser runs in e3-ui-components' record
 * spec, on e3.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, IntegerType, NullType, SetType, SortedMap, StringType, StructType,
    compareFor, encodeBeast2For, equalFor, none, printFor, variant, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { Record, Sheet, createSheetRootWith } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";

// Racks keyed by the code a person types.
const Rack = StructType({ code: StringType, bay: StringType });
const racksType = DictType(StringType, Rack);
const RACKS = new SortedMap([["R-1", { code: "R-1", bay: "North" }]], compareFor(StringType));
const racks = e3.record("built_key_racks", racksType, {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
const COLUMNS = { code: Sheet.column.text(Rack, { header: "Code" }), bay: Sheet.column.text(Rack, { header: "Bay" }) };
const saved = East.asyncFunction([Editing.Types.ChangeSet(Rack, StringType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

// Lanes keyed by a number their rows build.
const Lane = StructType({ aisle: IntegerType, slot: IntegerType });
const lanesType = DictType(IntegerType, Lane);
const LANES = new SortedMap([[101n, { aisle: 1n, slot: 1n }]], compareFor(IntegerType));
const LANE_COLUMNS = { aisle: Sheet.column.integer(Lane, { header: "Aisle" }), slot: Sheet.column.integer(Lane, { header: "Slot" }) };
const lanesSaved = East.asyncFunction([Editing.Types.ChangeSet(Lane, IntegerType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

// Moves keyed by where they go from and to: a key neither String nor Integer.
const Ends = StructType({ from: StringType, to: StringType });
const Move = StructType({ from: StringType, to: StringType, crates: IntegerType });
const movesType = DictType(Ends, Move);
const MOVES = new SortedMap([[{ from: "R-1", to: "R-2" }, { from: "R-1", to: "R-2", crates: 4n }]], compareFor(Ends));
const MOVE_COLUMNS = {
    from: Sheet.column.text(Move, { header: "From" }), to: Sheet.column.text(Move, { header: "To" }), crates: Sheet.column.integer(Move, { header: "Crates" }),
};
const movesSaved = East.asyncFunction([Editing.Types.ChangeSet(Move, Ends)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

// Orders keyed by their reference, each a group of lines: the key is the group's.
const Line = StructType({ item: StringType, qty: IntegerType });
const Order = StructType({ ref: StringType, customer: StringType, lines: ArrayType(Line) });
const ordersType = DictType(StringType, Order);
const ORDERS = new SortedMap([["O-1", { ref: "O-1", customer: "Kestrel", lines: [{ item: "Hinge", qty: 4n }] }]], compareFor(StringType));
const LINES = { item: Sheet.column.text(Line, { header: "Item" }), qty: Sheet.column.integer(Line, { header: "Qty" }) };
const ordersSaved = East.asyncFunction([Editing.Types.ChangeSet(Order, StringType)], Editing.Types.ApplyResult,
    (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
/** A sheet's `rowKey`, or a failure where it carries none. */
const rowKeyOf = (root: Root) => {
    if (root.editing.rowKey.type !== "some") assert.fail("expected the sheet to carry rowKey");
    return root.editing.rowKey.value;
};

/** Run `build` inside a bound handle's block, as a builder's factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}

describe("a sheet told how its record's rows are keyed from them", () => {
    test("ruling 1 — carries `rowKey`: a row's bytes to its key's text, a String key as itself; a sheet told none carries none", () => {
        const keyed = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const held = $.const(RACKS, racksType);
            return createSheetRootWith(held, COLUMNS, {}, { keyOrdered: true, applyKeyed: saved, key: (rack: { code: unknown }) => rack.code });
        }), [])();
        assert.equal(rowKeyOf(keyed)(encodeBeast2For(Rack)({ code: "R-9", bay: "South" })), "R-9");
        // A row whose cell is still empty builds what the empty cell builds.
        assert.equal(rowKeyOf(keyed)(encodeBeast2For(Rack)({ code: "", bay: "South" })), "");
        const plain = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const held = $.const(RACKS, racksType);
            return createSheetRootWith(held, COLUMNS, {}, { keyOrdered: true, applyKeyed: saved });
        }), [])();
        assert.equal(plain.editing.rowKey.type, "none");
    });

    test("ruling 1 — a key that is no String crosses as East prints it: an Integer's digits, a struct's fields", () => {
        const lanes = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const held = $.const(LANES, lanesType);
            return createSheetRootWith(held, LANE_COLUMNS, {}, {
                keyOrdered: true, applyKeyed: lanesSaved,
                key: (lane: { aisle: { multiply: (by: bigint) => { add: (n: unknown) => unknown } }; slot: unknown }) => lane.aisle.multiply(100n).add(lane.slot),
            });
        }), [])();
        assert.equal(rowKeyOf(lanes)(encodeBeast2For(Lane)({ aisle: 3n, slot: 7n })), "307");
        const moves = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const held = $.const(MOVES, movesType);
            return createSheetRootWith(held, MOVE_COLUMNS, {}, {
                keyOrdered: true, applyKeyed: movesSaved, key: (move: { from: unknown; to: unknown }) => ({ from: move.from, to: move.to }),
            });
        }), [])();
        assert.ok(equalFor(StringType)(rowKeyOf(moves)(encodeBeast2For(Move)({ from: "R-2", to: "R-5", crates: 1n })), printFor(Ends)({ from: "R-2", to: "R-5" })));
    });

    test("ruling 6 — a sheet told `key` carries no `newKey`: no key is made up or counted on for a row to stand under", () => {
        const build = (key: unknown) => East.compile(East.function([], Sheet.Types.Root, ($) => {
            const held = $.const(LANES, lanesType);
            return createSheetRootWith(held, LANE_COLUMNS, {}, { keyOrdered: true, applyKeyed: lanesSaved, key });
        }), [])();
        assert.equal(build((lane: { slot: unknown }) => lane.slot).newKey.type, "none");
        // Told neither, an Integer key is one past the largest, as before.
        assert.equal(build(undefined).newKey.type, "some");
    });

    test("ruling 3 — a record keyed by neither String nor Integer builds with `key`; given neither way to decide a new row's key it is refused, naming both", () => {
        const build = (key: unknown) => East.function([], NullType, ($) => {
            const held = $.const(MOVES, movesType);
            $(createSheetRootWith(held, MOVE_COLUMNS, {}, { keyOrdered: true, applyKeyed: movesSaved, key }));
        });
        build((move: { from: unknown; to: unknown }) => ({ from: move.from, to: move.to }));
        assert.throws(() => build(undefined),
            /the rows are keyed by \.Struct \[.*\], and a new row's key is made only for a String key or an Integer one — pass `key`, building a new row's key from the row, or `newKey`, an East function from the keys taken to a new one, or `edits=\{\{ insertRows: false \}\}`/);
    });

    test("ruling 2 — `key` beside `newKey` is refused, naming both", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const held = $.const(RACKS, racksType);
            $(createSheetRootWith(held, COLUMNS, { newKey: East.function([SetType(StringType)], StringType, (_$, keys) => East.str`R-${keys.size()}`) },
                { keyOrdered: true, applyKeyed: saved, key: (rack: { code: unknown }) => rack.code }));
        }), /Sheet: `key` and `newKey` each decide a new row's key — give one: `key` builds it from the row, `newKey` makes it from the keys taken/);
    });

    test("ruling 1 — a `key` that builds another type than the record's key is refused, naming both; and one that is no function", () => {
        const build = (key: unknown) => East.function([], NullType, ($) => {
            const held = $.const(RACKS, racksType);
            $(createSheetRootWith(held, COLUMNS, {}, { keyOrdered: true, applyKeyed: saved, key }));
        });
        assert.throws(() => build((rack: { code: { length: () => unknown } }) => rack.code.length()), /Sheet: `key` builds a row's key, of the record's key type \.String — and this one builds \.Integer/);
        assert.throws(() => build("code"), /Sheet: `key` builds a row's key from its row, \(row\) => …/);
    });

    test("ruling 1 — on a grouped sheet the key is the group's, built from the group", () => {
        const root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const held = $.const(ORDERS, ordersType);
            return createSheetRootWith(held, LINES, { group: Sheet.group(Order, "lines", { title: "customer" }), newGroup: East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(Order), (_$, _at) => ({ ref: none, customer: none, lines: none })) },
                { keyOrdered: true, applyKeyed: ordersSaved, key: (order: { ref: unknown }) => order.ref });
        }), [])();
        assert.equal(rowKeyOf(root)(encodeBeast2For(Order)({ ref: "O-7", customer: "Osprey", lines: [] })), "O-7");
    });

    test("ruling 1 — is refused over rows that are no record's own entries: an Array's, identified by `id`", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const held = $.const([...RACKS.values()], ArrayType(Rack));
            $(createSheetRootWith(held, { bay: COLUMNS.bay }, { id: "code" }, { key: (rack: { code: unknown }) => rack.code }));
        }), /Sheet: `key` builds the key of a record's own entries — its rows, or its groups — which a sheet over them reads by key/);
    });
});

describe("<Sheet> and <Record> with `key`", () => {
    test("ruling 7 — the tag's `key` reaches the sheet: `<Sheet record key>` and `<Record record key>` build, and a key the sheet refuses is refused through the tag", () => {
        inBlock(($) => {
            const held = $.let(Record.bind(racks));
            // The tags as an app writes them: built here, their props checked by the compiler.
            void <Sheet record={held} columns={COLUMNS} key={(rack) => rack.code} />;
            void <Record record={held} columns={{ code: Record.column.title(Rack, { header: "Code" }), bay: Record.column.text(Rack, { header: "Bay" }) }} key={(rack) => rack.code} />;
        });
        // A key of another type than the record's reaches the sheet too, and is refused there: the tag's `key` is no React key, dropped.
        assert.throws(() => inBlock(($) => {
            const held = $.let(Record.bind(racks));
            // @ts-expect-error — the racks are keyed by a String, and this builds an Integer
            void <Sheet record={held} columns={COLUMNS} key={(rack) => rack.code.length()} />;
        }), /Sheet: `key` builds a row's key, of the record's key type \.String — and this one builds \.Integer/);
    });

    test("ruling 1 — a Sheet handed no record takes none, and names `record`; nor one over one entry's rows", () => {
        assert.throws(() => inBlock(($) => {
            const held = $.const([...RACKS.values()], ArrayType(Rack));
            return Sheet.Payload({ data: held, id: "code", columns: { bay: COLUMNS.bay }, key: (rack: { code: unknown }) => rack.code });
        }), /Sheet: `key` builds a row's key from the row, for the rows a sheet adds to the record it is handed — pass `record`; `data`'s rows are identified by `id`/);
        const Week = StructType({ rows: ArrayType(StructType({ id: StringType, task: StringType })) });
        const weeks = e3.record("built_key_weeks", DictType(StringType, Week), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
        assert.throws(() => inBlock(($) => Sheet.Payload({
            record: $.let(Record.bind(weeks)), entry: { key: "W42", rows: "rows", id: "id" },
            columns: { task: Sheet.column.text(Week.fields.rows.value, { header: "Task" }) }, key: (row: { id: unknown }) => row.id,
        })), /Sheet: `key` builds a row's key from the row, for the rows a sheet adds to the record it is handed — and with `entry` the rows are one entry's, identified by `entry\.id`: leave it out/);
    });

    test("ruling 2 — a Record given `key` beside `newKey` is refused in its own name", () => {
        assert.throws(() => inBlock(($) => Record.Payload({
            record: $.let(Record.bind(racks)), columns: { code: Record.column.title(Rack, { header: "Code" }) },
            key: (rack: { code: unknown }) => rack.code, newKey: East.function([SetType(StringType)], StringType, (_$, keys) => East.str`R-${keys.size()}`),
        })), /Record: `key` and `newKey` each decide a new row's key — give one/);
    });
});
