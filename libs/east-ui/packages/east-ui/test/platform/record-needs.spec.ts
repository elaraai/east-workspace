/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a field's choice needs chosen first (retest C3, 27 Oct 2026): the
 * fields an index taking that kind of choice on the field takes exact choices
 * of beside it, less those chosen so, the index needing the fewest — each
 * index held to the matcher — and none at all where no index takes that kind
 * of choice on the field: a prefix of a field only an interval index leads,
 * which no field chosen first makes possible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceChoiceType, RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import { planRecordSlice, recordChoiceNeeds, recordChoiceWhere } from "../../src/platform/slice/record-plan.js";

type Index = ValueTypeOf<typeof RecordSliceIndexType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = ValueTypeOf<typeof RecordSliceChoiceType>;

/** An index on fields in order, fanning out over the Set fields named. */
const plain = (name: string, fields: string[], sets: string[] = []): Index => ({
    name, fields, sets: new Set(sets), structured: fields.length > 1, interval: none, area: none, series: none, summary: none, entries: false,
});
/** An interval index from `start` to `end`, led by the fields named: its fields its `on` alone (#1432). */
const interval = (name: string, on: string[]): Index => ({
    name, fields: on, sets: new Set(), structured: true, interval: some({ from: "start", to: "end", optional: true }),
    area: none, series: none, summary: none, entries: false,
});
/** An entries index over a Dict field of the rows (#1522): its keys picked, several at once, weighing a reader's rows. */
const entries = (name: string, field: string): Index => ({
    name, fields: [field], sets: new Set(), structured: false, interval: none, area: none, series: none, summary: none, entries: true,
});
const exactly = (...values: string[]) => variant("values", values.map(value => JSON.stringify(value)));
const RANGE = variant("range", { from: "1", to: "2" });
const sameChoice = equalFor(RecordSliceChoiceType);
/** Whether a narrowing holds exactly these choices, field by field. */
function sameWhere(actual: ReadonlyMap<string, Choice> | null, expected: readonly (readonly [string, Choice])[]): boolean {
    return actual !== null && actual.size === expected.length && expected.every(([field, choice]) => {
        const held = actual.get(field);
        return held !== undefined && sameChoice(held, choice);
    });
}

test("a prefix of a field only an interval index leads: no index takes it, whatever is chosen first — an exact value it takes, the window kept", () => {
    // The Calendar's records example: its jobs by time, by status then time, and by machine then time.
    const indexes = [interval("by_time", []), interval("by_status_time", ["status"]), interval("by_machine_time", ["machine"])];
    const offered = new Set(["status", "machine", "start"]);
    const window: Where = new Map<string, Choice>([["start", RANGE], ["status", exactly("Ready")]]);
    assert.equal(recordChoiceWhere(indexes, window, "machine", variant("prefix", "press")), null);
    assert.equal(recordChoiceNeeds(indexes, window, "machine", "prefix", offered), null);
    assert.notEqual(recordChoiceWhere(indexes, window, "machine", exactly("press-a")), null);
    assert.deepEqual(recordChoiceNeeds(indexes, window, "machine", "values", offered), []);
});

test("a range of a field an index takes after another names that field, until it is chosen exactly", () => {
    // The kiln yard's kilns: by group then max, and by name.
    const indexes = [plain("by_group_max", ["group", "max"]), plain("by_name", ["name"])];
    const offered = new Set(["group", "max", "name"]);
    assert.equal(recordChoiceWhere(indexes, new Map(), "max", RANGE), null);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "max", "range", offered), ["group"]);
    // A prefix of it is chosen, but not exactly: still named.
    assert.deepEqual(recordChoiceNeeds(indexes, new Map([["group", variant("prefix", "Hall")]]), "max", "range", offered), ["group"]);
    // Chosen exactly, the range is taken, and nothing more is named.
    const grouped: Where = new Map([["group", exactly("Hall A")]]);
    assert.notEqual(recordChoiceWhere(indexes, grouped, "max", RANGE), null);
    assert.deepEqual(recordChoiceNeeds(indexes, grouped, "max", "range", offered), []);
});

test("the index needing the fewest fields is named; one that needs a field the rail does not offer is never named", () => {
    const indexes = [plain("by_a_b_c", ["a", "b", "c"]), plain("by_d_c", ["d", "c"])];
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "c", "prefix", new Set(["a", "b", "c", "d"])), ["d"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "c", "prefix", new Set(["a", "b", "c"])), ["a", "b"]);
    // What is chosen already counts: with a chosen, b alone is still to choose on the first path — as few as the other's
    // d, so the first index's is named.
    assert.deepEqual(recordChoiceNeeds(indexes, new Map([["a", exactly("x")]]), "c", "prefix", new Set(["a", "b", "c", "d"])), ["b"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map([["a", exactly("x")], ["b", exactly("y")]]), "c", "prefix", new Set(["a", "b", "c", "d"])), []);
    assert.equal(recordChoiceNeeds(indexes, new Map(), "c", "prefix", new Set(["c"])), null);
});

test("a Set field an index fans out over is named until one value of it is chosen; a prefix of the Set field itself no index takes", () => {
    const indexes = [plain("by_tag_name", ["tag", "name"], ["tag"])];
    const offered = new Set(["tag", "name"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "name", "prefix", offered), ["tag"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map([["tag", exactly("a", "b")]]), "name", "prefix", offered), ["tag"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map([["tag", exactly("a")]]), "name", "prefix", offered), []);
    assert.equal(recordChoiceNeeds(indexes, new Map(), "tag", "prefix", offered), null);
});

test("an entries field's picks need nothing chosen first, take exact values alone, stand beside every other choice, and no path reads them (#1522)", () => {
    const indexes = [plain("by_status", ["status"]), entries("by_service", "byService")];
    const offered = new Set(["status", "byService"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "byService", "values", offered), []);
    assert.equal(recordChoiceNeeds(indexes, new Map(), "byService", "range", offered), null);
    assert.equal(recordChoiceNeeds(indexes, new Map(), "byService", "prefix", offered), null);
    // Several picked at once; a range of the field refused.
    const picked = recordChoiceWhere(indexes, new Map(), "byService", exactly("Standard", "Priority"));
    assert.ok(sameWhere(picked, [["byService", exactly("Standard", "Priority")]]));
    assert.equal(recordChoiceWhere(indexes, new Map(), "byService", RANGE), null);
    // Another field's choice keeps the picks, and a pick replaces none of its choices.
    const both = recordChoiceWhere(indexes, picked!, "status", exactly("held"));
    assert.ok(sameWhere(both, [["status", exactly("held")], ["byService", exactly("Standard", "Priority")]]));
    assert.ok(sameWhere(recordChoiceWhere(indexes, both!, "byService", exactly("Economy")), [["status", exactly("held")], ["byService", exactly("Economy")]]));
    assert.ok(sameWhere(recordChoiceWhere(indexes, both!, "byService", undefined), [["status", exactly("held")]]));
    assert.ok(sameWhere(recordChoiceWhere(indexes, both!, "status", undefined), [["byService", exactly("Standard", "Priority")]]));
    // The plan reads the narrowing without the picks: the status's index, or the record's own rows.
    assert.equal(planRecordSlice(indexes, both!, "primary")?.index, "by_status");
    assert.equal(planRecordSlice(indexes, picked!, "primary")?.index, "primary");
});

test("an interval index takes its leading fields exactly together: one of them names the others", () => {
    const indexes = [interval("by_status_machine_time", ["status", "machine"])];
    const offered = new Set(["status", "machine", "start"]);
    assert.equal(recordChoiceWhere(indexes, new Map(), "status", exactly("Ready")), null);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "status", "values", offered), ["machine"]);
    assert.deepEqual(recordChoiceNeeds(indexes, new Map(), "start", "range", offered), ["status", "machine"]);
    assert.equal(recordChoiceNeeds(indexes, new Map(), "start", "prefix", offered), null);
});
