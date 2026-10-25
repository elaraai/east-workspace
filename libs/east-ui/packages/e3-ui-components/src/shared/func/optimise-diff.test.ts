/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The diff of a run's result against its request (#1409, #1415; R7): by key,
 * an add, a change and a remove, each the builder's change for one step and
 * the operation the landing draws; untouched rows are not in the edit; a
 * result equal to the request is no edit; keys of another type are named as
 * their session names them; several kinds merge into one step; on a builder
 * with a backlog the operations are told by place (§9.5).
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, none, some, type ValueTypeOf } from "@elaraai/east";
import { diffOptimiseRows, mergeOptimiseDiffs, opKey, optimiseIdOf, optimisePlacementOps } from "./optimise-diff.js";

const Row = StructType({ task: StringType, hours: IntegerType });
type RowValue = ValueTypeOf<typeof Row>;
const rows = (entries: readonly [string, RowValue][]) => new SortedMap<string, RowValue>(entries, compareFor(StringType));
const byId = optimiseIdOf<string>(StringType);
const decode = decodeBeast2For(Row);

describe("diffOptimiseRows", () => {
    test("absent → present adds, a different row changes, present → absent removes; untouched rows are not in the edit", () => {
        const before = rows([["a", { task: "Pick", hours: 8n }], ["b", { task: "Pack", hours: 8n }], ["c", { task: "Load", hours: 4n }]]);
        const after = rows([["a", { task: "Pick", hours: 8n }], ["b", { task: "Pack", hours: 6n }], ["d", { task: "Count", hours: 2n }]]);
        const diff = diffOptimiseRows("duty", Row, byId, before, after);
        expect(diff.counts).toEqual({ added: 1, changed: 1, removed: 1 });
        expect(diff.changes.map((c) => [c.kind, c.id, "remove" in c ? "remove" : "created" in c && c.created ? "created" : "row"])).toEqual([
            ["duty", "b", "row"], ["duty", "d", "created"], ["duty", "c", "remove"],
        ]);
        // The rows go as bytes the session decodes back.
        const b = diff.changes.find((c) => c.id === "b")!;
        expect("row" in b && decode(b.row)).toEqual({ task: "Pack", hours: 6n });
        expect([...diff.ops.keys()]).toEqual([opKey("duty", "b"), opKey("duty", "d"), opKey("duty", "c")]);
        expect(diff.ops.get(opKey("duty", "b"))).toEqual({ kind: "duty", op: "chg", row: { task: "Pack", hours: 6n }, previous: { task: "Pack", hours: 8n } });
        expect(diff.ops.get(opKey("duty", "d"))).toEqual({ kind: "duty", op: "add", row: { task: "Count", hours: 2n } });
        expect(diff.ops.get(opKey("duty", "c"))).toEqual({ kind: "duty", op: "del", previous: { task: "Load", hours: 4n } });
    });

    test("a result equal to the request is no edit (R10)", () => {
        const same = rows([["a", { task: "Pick", hours: 8n }]]);
        const diff = diffOptimiseRows("duty", Row, byId, same, rows([["a", { task: "Pick", hours: 8n }]]));
        expect([diff.changes, diff.ops.size, diff.counts]).toEqual([[], 0, { added: 0, changed: 0, removed: 0 }]);
    });

    test("a key of another type is named as its session names it: East's text", () => {
        const idOf = optimiseIdOf<bigint>(IntegerType);
        const before = new SortedMap<bigint, RowValue>([[9n, { task: "Pick", hours: 8n }]], compareFor(IntegerType));
        const after = new SortedMap<bigint, RowValue>([[9n, { task: "Pick", hours: 8n }], [10n, { task: "Pack", hours: 8n }]], compareFor(IntegerType));
        const diff = diffOptimiseRows("job", Row, idOf, before, after);
        expect(diff.changes.map((c) => c.id)).toEqual(["10"]);
        expect(byId("J-1")).toBe("J-1");
    });

    test("several kinds merge into one step, their counts summed and their operations apart", () => {
        const jobs = diffOptimiseRows("job", Row, byId, rows([]), rows([["x", { task: "Pick", hours: 1n }]]));
        const maintenance = diffOptimiseRows("maintenance", Row, byId, rows([["x", { task: "Oil", hours: 1n }]]), rows([]));
        const merged = mergeOptimiseDiffs([jobs, maintenance]);
        expect(merged.counts).toEqual({ added: 1, changed: 0, removed: 1 });
        expect(merged.changes.map((c) => c.kind)).toEqual(["job", "maintenance"]);
        expect([merged.ops.get(opKey("job", "x"))?.op, merged.ops.get(opKey("maintenance", "x"))?.op]).toEqual(["add", "del"]);
        expect([some(1n).type, none.type]).toEqual(["some", "none"]);
    });

    test("told by place (§9.5): a backlog row given a time is an add, a scheduled row sent back a remove, a moved row a change; the session's changes stay the diff's own", () => {
        const Job = StructType({ task: StringType, start: OptionType(DateTimeType) });
        type JobValue = ValueTypeOf<typeof Job>;
        const jobs = (entries: readonly [string, JobValue][]) => new SortedMap<string, JobValue>(entries, compareFor(StringType));
        const monday = new Date("2026-10-05T09:00:00Z"), tuesday = new Date("2026-10-06T09:00:00Z");
        const before = jobs([["a", { task: "Cut", start: none }], ["b", { task: "Pack", start: some(monday) }], ["c", { task: "Load", start: some(monday) }], ["d", { task: "Count", start: none }]]);
        const after = jobs([["a", { task: "Cut", start: some(tuesday) }], ["b", { task: "Pack", start: none }], ["c", { task: "Load", start: some(tuesday) }], ["d", { task: "Recount", start: none }], ["e", { task: "Ship", start: some(tuesday) }]]);
        const byKey = diffOptimiseRows("job", Job, byId, before, after);
        expect(byKey.counts).toEqual({ added: 1, changed: 4, removed: 0 });
        const told = optimisePlacementOps(byKey, (row) => row.start.type === "some");
        expect(told.counts).toEqual({ added: 2, changed: 2, removed: 1 });
        expect(["a", "b", "c", "d", "e"].map((id) => told.ops.get(opKey("job", id))?.op)).toEqual(["add", "del", "chg", "chg", "add"]);
        // The session rewrites the rows the request held, and creates only the new key.
        expect(told.changes).toBe(byKey.changes);
        expect(told.changes.map((c) => [c.id, "created" in c && c.created === true])).toEqual([["a", false], ["b", false], ["c", false], ["d", false], ["e", true]]);
    });
});
