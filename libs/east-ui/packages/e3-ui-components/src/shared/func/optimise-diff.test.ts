/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A run's answer landed on a record, key by key (#1409, east-workspace#1622,
 * rules 7, 8 and 11): an insert adds, an update changes the held row by its
 * patch, a delete removes — each the builder's change for one step and the
 * operation the landing draws; a patch of the whole Dict lands the same, key
 * by key, never as the record replaced; an answer that changes nothing is no
 * edit; a row the page does not hold is named to be read first, and one whose
 * edit is incomplete refuses the answer; a key no row stands under takes an
 * insert, drops a delete and fits no update; keys of another type are named as
 * their session names them; several kinds merge into one step, and several
 * records' answers land all or none; on a builder with a backlog the
 * operations are told by place (§9.5).
 */

import { describe, expect, test } from "vitest";
import {
    DateTimeType, DictType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, diffFor, none, some, variant, type ValueTypeOf,
    type option,
} from "@elaraai/east";
import {
    diffOptimisePatch, isOptimiseDiff, landOptimisePatches, mergeOptimiseDiffs, opKey, optimiseIdOf, optimisePlacementOps, type OptimiseDiff,
} from "./optimise-diff.js";

const Row = StructType({ task: StringType, hours: IntegerType });
const Rows = DictType(StringType, Row);
type RowValue = ValueTypeOf<typeof Row>;
const rows = (entries: readonly [string, RowValue][]) => new SortedMap<string, RowValue>(entries, compareFor(StringType));
const byId = optimiseIdOf<string>(StringType);
const decode = decodeBeast2For(Row);
const diff = diffFor(Rows);
/** The rows a page holds, as a landing asks them: a row held, or `undefined` for one it does not hold. */
const holding = <R,>(held: ReadonlyMap<string, R>) => (id: string): option<R> | undefined => {
    const row = held.get(id);
    return row === undefined ? undefined : some(row);
};

/** The landing over rows the page holds, as one that lands. */
function landed<R>(result: ReturnType<typeof diffOptimisePatch<string, R>>): OptimiseDiff<R> {
    if (!isOptimiseDiff(result)) throw new Error(`no landing: ${JSON.stringify(result)}`);
    return result;
}

describe("diffOptimisePatch", () => {
    const held = rows([["a", { task: "Pick", hours: 8n }], ["b", { task: "Pack", hours: 8n }], ["c", { task: "Load", hours: 4n }]]);
    const holds = holding(held);

    test("an insert adds under the optimiser's key, an update changes the held row by its patch, a delete removes; an untouched row is no edit", () => {
        const after = rows([["a", { task: "Pick", hours: 8n }], ["b", { task: "Pack", hours: 6n }], ["d", { task: "Count", hours: 2n }]]);
        const patch = diff(held, after);
        expect(patch.type).toBe("patch");
        const got = landed(diffOptimisePatch("duty", Rows, byId, patch, holds));
        expect(got.counts).toEqual({ added: 1, changed: 1, removed: 1 });
        expect(got.changes.map((c) => [c.kind, c.id, "remove" in c ? "remove" : "created" in c && c.created ? "created" : "row"])).toEqual([
            ["duty", "b", "row"], ["duty", "c", "remove"], ["duty", "d", "created"],
        ]);
        // The rows go as bytes the session decodes back.
        const b = got.changes.find((c) => c.id === "b")!;
        expect("row" in b && decode(b.row)).toEqual({ task: "Pack", hours: 6n });
        expect(got.ops.get(opKey("duty", "b"))).toEqual({ kind: "duty", op: "chg", row: { task: "Pack", hours: 6n }, previous: { task: "Pack", hours: 8n } });
        expect(got.ops.get(opKey("duty", "d"))).toEqual({ kind: "duty", op: "add", row: { task: "Count", hours: 2n } });
        expect(got.ops.get(opKey("duty", "c"))).toEqual({ kind: "duty", op: "del", previous: { task: "Load", hours: 4n } });
    });

    test("a patch of the whole Dict lands key by key — what East.diff answers for a few rows against none — and never as the record replaced", () => {
        const whole = variant("replace", { before: rows([["c", { task: "Load", hours: 4n }]]), after: rows([["e", { task: "Ship", hours: 3n }]]) });
        const got = landed(diffOptimisePatch("duty", Rows, byId, whole, holds));
        expect(got.counts).toEqual({ added: 1, changed: 0, removed: 1 });
        expect(got.changes.map((c) => c.id)).toEqual(["c", "e"]);
        // What East.diff gives of a few rows against none is such a patch: only those rows go.
        const cleared = landed(diffOptimisePatch("duty", Rows, byId, diff(rows([["c", { task: "Load", hours: 4n }]]), rows([])), holds));
        expect(cleared.changes).toMatchObject([{ kind: "duty", id: "c", remove: true }]);
        // The row it removes goes with the change: what the step begins from where the session holds none of it.
        const removal = cleared.changes[0]!;
        expect("was" in removal && removal.was !== undefined && decode(removal.was)).toEqual({ task: "Load", hours: 4n });
    });

    test("an answer that changes nothing is no edit (R10): an unchanged patch, or an insert of the row the page holds", () => {
        const none_ = landed(diffOptimisePatch("duty", Rows, byId, variant("unchanged", null), holds));
        expect([none_.changes, none_.ops.size, none_.counts]).toEqual([[], 0, { added: 0, changed: 0, removed: 0 }]);
        const same = landed(diffOptimisePatch("duty", Rows, byId, diff(rows([]), rows([["a", { task: "Pick", hours: 8n }]])), holds));
        expect(same.changes).toEqual([]);
    });

    test("a row the answer updates or deletes that the page does not hold is named, to be read by its key first (rule 8); an insert needs none", () => {
        const far = rows([["x", { task: "Pick", hours: 8n }], ["y", { task: "Pack", hours: 8n }]]);
        const patch = diff(far, rows([["x", { task: "Pick", hours: 4n }], ["z", { task: "New", hours: 1n }]]));
        expect(diffOptimisePatch("duty", Rows, byId, patch, holds)).toEqual({ missing: [{ kind: "duty", id: "x" }, { kind: "duty", id: "y" }] });
        // Read in, it lands.
        const got = landed(diffOptimisePatch("duty", Rows, byId, patch, holding(far)));
        expect(got.counts).toEqual({ added: 1, changed: 1, removed: 1 });
    });

    test("a key no row stands under — the record holds none, or the drafts removed it — takes an insert and drops a delete; an update of it fits nothing", () => {
        const gone = (id: string): option<RowValue> | undefined => (id === "g" ? none : holds(id));
        // Deleted here and by the answer: gone already, no edit. Inserted by the answer: an add.
        const dropped = landed(diffOptimisePatch("duty", Rows, byId, diff(rows([["g", { task: "Ship", hours: 3n }]]), rows([])), gone));
        expect([dropped.changes, dropped.counts]).toEqual([[], { added: 0, changed: 0, removed: 0 }]);
        const added = landed(diffOptimisePatch("duty", Rows, byId, diff(rows([]), rows([["g", { task: "Ship", hours: 3n }]])), gone));
        expect(added.changes.map((c) => [c.id, "created" in c && c.created === true])).toEqual([["g", true]]);
        // Updated by the answer: the answer is of another state.
        const updated = diff(rows([["g", { task: "Ship", hours: 3n }]]), rows([["g", { task: "Ship", hours: 5n }]]));
        expect(diffOptimisePatch("duty", Rows, byId, updated, gone)).toBeUndefined();
    });

    test("a row whose own edit is still incomplete refuses the answer (rule 11): the function read it as saved", () => {
        const patch = diff(held, rows([["a", { task: "Pick", hours: 6n }], ["b", { task: "Pack", hours: 8n }], ["c", { task: "Load", hours: 4n }]]));
        expect(diffOptimisePatch("duty", Rows, byId, patch, holds, (id) => id === "a")).toEqual({ incomplete: [{ kind: "duty", id: "a" }] });
        expect(isOptimiseDiff(diffOptimisePatch("duty", Rows, byId, patch, holds, (id) => id === "b"))).toBe(true);
    });

    test("a patch made against another row than the page holds does not fit it: no landing", () => {
        // Made against `a` as Cut, 1 h: its patch of the row replaces 1 h, and the page holds Pick, 8 h.
        const patch = diff(rows([["a", { task: "Cut", hours: 1n }]]), rows([["a", { task: "Cut", hours: 2n }]]));
        expect(diffOptimisePatch("duty", Rows, byId, patch, holds)).toBeUndefined();
    });

    test("a key of another type is named as its session names it: East's text", () => {
        const Numbered = DictType(IntegerType, Row);
        const idOf = optimiseIdOf<bigint>(IntegerType);
        const before = new SortedMap<bigint, RowValue>([[9n, { task: "Pick", hours: 8n }]], compareFor(IntegerType));
        const after = new SortedMap<bigint, RowValue>([[9n, { task: "Pick", hours: 8n }], [10n, { task: "Pack", hours: 8n }]], compareFor(IntegerType));
        // The page holds its rows by the text its session names each key by.
        const byText = new Map([...before].map(([key, row]) => [idOf(key), row] as const));
        const got = landed(diffOptimisePatch<bigint, RowValue>("job", Numbered, idOf, diffFor(Numbered)(before, after), holding(byText)));
        expect(got.changes.map((c) => c.id)).toEqual(["10"]);
        expect(byId("J-1")).toBe("J-1");
    });

    test("several kinds merge into one step, their counts summed and their operations apart", () => {
        const jobs = landed(diffOptimisePatch("job", Rows, byId, diff(rows([]), rows([["x", { task: "Pick", hours: 1n }]])), () => undefined));
        const oil = rows([["x", { task: "Oil", hours: 1n }]]);
        const maintenance = landed(diffOptimisePatch("maintenance", Rows, byId, diff(oil, rows([])), holding(oil)));
        const merged = mergeOptimiseDiffs([jobs, maintenance]);
        expect(merged.counts).toEqual({ added: 1, changed: 0, removed: 1 });
        expect(merged.changes.map((c) => c.kind)).toEqual(["job", "maintenance"]);
        expect([merged.ops.get(opKey("job", "x"))?.op, merged.ops.get(opKey("maintenance", "x"))?.op]).toEqual(["add", "del"]);
    });

    test("told by place (§9.5): a backlog row given a time is an add, a scheduled row sent back a remove, a moved row a change; the session's changes stay the landing's own", () => {
        const Job = StructType({ task: StringType, start: OptionType(DateTimeType) });
        const Jobs = DictType(StringType, Job);
        type JobValue = ValueTypeOf<typeof Job>;
        const jobs = (entries: readonly [string, JobValue][]) => new SortedMap<string, JobValue>(entries, compareFor(StringType));
        const monday = new Date("2026-10-05T09:00:00Z"), tuesday = new Date("2026-10-06T09:00:00Z");
        const before = jobs([["a", { task: "Cut", start: none }], ["b", { task: "Pack", start: some(monday) }], ["c", { task: "Load", start: some(monday) }], ["d", { task: "Count", start: none }]]);
        const after = jobs([["a", { task: "Cut", start: some(tuesday) }], ["b", { task: "Pack", start: none }], ["c", { task: "Load", start: some(tuesday) }], ["d", { task: "Recount", start: none }], ["e", { task: "Ship", start: some(tuesday) }]]);
        const byKey = landed(diffOptimisePatch("job", Jobs, byId, diffFor(Jobs)(before, after), holding(before)));
        expect(byKey.counts).toEqual({ added: 1, changed: 4, removed: 0 });
        const told = optimisePlacementOps(byKey, (row) => row.start.type === "some");
        expect(told.counts).toEqual({ added: 2, changed: 2, removed: 1 });
        expect(["a", "b", "c", "d", "e"].map((id) => told.ops.get(opKey("job", id))?.op)).toEqual(["add", "del", "chg", "chg", "add"]);
        // The session rewrites the rows the page held, and creates only the new key.
        expect(told.changes).toBe(byKey.changes);
        expect(told.changes.map((c) => [c.id, "created" in c && c.created === true])).toEqual([["a", false], ["b", false], ["c", false], ["d", false], ["e", true]]);
        // The reader is told each operation's key and which side it reads: the row before the run, or the one it leaves.
        const sides: string[] = [];
        optimisePlacementOps(byKey, (row, key, side) => { sides.push(`${key === opKey("job", "a") ? "a" : "."}${side}`); return row.start.type === "some"; });
        expect(sides.filter((said) => said.startsWith("a"))).toEqual(["awas", "anow"]);
    });
});

describe("landOptimisePatches", () => {
    const jobs = rows([["j1", { task: "Cut", hours: 2n }]]);
    const stops = rows([["s1", { task: "Oil", hours: 1n }]]);
    const held = (kind: string, id: string): option<RowValue> | undefined => holding(kind === "job" ? jobs : stops)(id);
    const moreHours = diff(jobs, rows([["j1", { task: "Cut", hours: 3n }]]));

    test("each record's answer lands on its own rows, in the builder's order", () => {
        const got = landOptimisePatches<RowValue>([
            { kind: "job", record: Rows, patch: moreHours },
            { kind: "stop", record: Rows, patch: diff(stops, rows([])) },
        ], held);
        expect(Array.isArray(got)).toBe(true);
        const diffs = got as readonly OptimiseDiff<RowValue>[];
        expect(diffs.map((d) => d.counts)).toEqual([{ added: 0, changed: 1, removed: 0 }, { added: 0, changed: 0, removed: 1 }]);
        expect(diffs[1]!.changes).toMatchObject([{ kind: "stop", id: "s1", remove: true }]);
    });

    test("all or none: a row one record's answer touches that the page does not hold keeps every record's from landing, each named by its kind", () => {
        const far = diff(rows([["s9", { task: "Oil", hours: 1n }]]), rows([]));
        expect(landOptimisePatches<RowValue>([{ kind: "job", record: Rows, patch: moreHours }, { kind: "stop", record: Rows, patch: far }], held))
            .toEqual({ missing: [{ kind: "stop", id: "s9" }] });
    });

    test("an incomplete edit refuses them all, before any row is read; an answer that fits no row is no landing", () => {
        const far = diff(rows([["s9", { task: "Oil", hours: 1n }]]), rows([]));
        expect(landOptimisePatches<RowValue>([{ kind: "job", record: Rows, patch: moreHours }, { kind: "stop", record: Rows, patch: far }], held,
            (kind, id) => kind === "job" && id === "j1")).toEqual({ incomplete: [{ kind: "job", id: "j1" }] });
        const unfit = diff(rows([["j1", { task: "Fold", hours: 1n }]]), rows([["j1", { task: "Fold", hours: 2n }]]));
        expect(landOptimisePatches<RowValue>([{ kind: "job", record: Rows, patch: unfit }], held)).toBeUndefined();
    });
});
