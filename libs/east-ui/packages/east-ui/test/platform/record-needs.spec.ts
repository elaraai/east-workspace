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
 *
 * And a page's scope (#1621), which is part of every narrowing of its source:
 * a choice is answered only by an index that takes the scope's fields with it,
 * what it answers holds the scope, and a scoped field takes no choice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceChoiceType, RecordSliceIndexType, RecordSliceWhereType } from "../../src/platform/slice/record-types.js";
import {
    planRecordSlice, recordChoiceNeeds, recordChoiceWhere, recordChoicesOf, recordScopeEmpty, recordScopedWhere,
    recordSliceBase, recordSliceChoices, recordSliceChoicesOf, recordSliceChosen, recordSliceScoped, recordSliceScopedWhere,
    type RecordSlicePaths,
} from "../../src/platform/slice/record-plan.js";

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
/** What a source with no scope is planned over: its indexes alone. */
const unscoped = (indexes: Index[]): RecordSlicePaths => ({ indexes, scope: new Map() });
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
    const paths = unscoped([interval("by_time", []), interval("by_status_time", ["status"]), interval("by_machine_time", ["machine"])]);
    const offered = new Set(["status", "machine", "start"]);
    const window: Where = new Map<string, Choice>([["start", RANGE], ["status", exactly("Ready")]]);
    assert.equal(recordChoiceWhere(paths, window, "machine", variant("prefix", "press")), null);
    assert.equal(recordChoiceNeeds(paths, window, "machine", "prefix", offered), null);
    assert.notEqual(recordChoiceWhere(paths, window, "machine", exactly("press-a")), null);
    assert.deepEqual(recordChoiceNeeds(paths, window, "machine", "values", offered), []);
});

test("a range of a field an index takes after another names that field, until it is chosen exactly", () => {
    // The kiln yard's kilns: by group then max, and by name.
    const paths = unscoped([plain("by_group_max", ["group", "max"]), plain("by_name", ["name"])]);
    const offered = new Set(["group", "max", "name"]);
    assert.equal(recordChoiceWhere(paths, new Map(), "max", RANGE), null);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "max", "range", offered), ["group"]);
    // A prefix of it is chosen, but not exactly: still named.
    assert.deepEqual(recordChoiceNeeds(paths, new Map([["group", variant("prefix", "Hall")]]), "max", "range", offered), ["group"]);
    // Chosen exactly, the range is taken, and nothing more is named.
    const grouped: Where = new Map([["group", exactly("Hall A")]]);
    assert.notEqual(recordChoiceWhere(paths, grouped, "max", RANGE), null);
    assert.deepEqual(recordChoiceNeeds(paths, grouped, "max", "range", offered), []);
});

test("the index needing the fewest fields is named; one that needs a field the rail does not offer is never named", () => {
    const paths = unscoped([plain("by_a_b_c", ["a", "b", "c"]), plain("by_d_c", ["d", "c"])]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "c", "prefix", new Set(["a", "b", "c", "d"])), ["d"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "c", "prefix", new Set(["a", "b", "c"])), ["a", "b"]);
    // What is chosen already counts: with a chosen, b alone is still to choose on the first path — as few as the other's
    // d, so the first index's is named.
    assert.deepEqual(recordChoiceNeeds(paths, new Map([["a", exactly("x")]]), "c", "prefix", new Set(["a", "b", "c", "d"])), ["b"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map([["a", exactly("x")], ["b", exactly("y")]]), "c", "prefix", new Set(["a", "b", "c", "d"])), []);
    assert.equal(recordChoiceNeeds(paths, new Map(), "c", "prefix", new Set(["c"])), null);
});

test("a Set field an index fans out over is named until one value of it is chosen; a prefix of the Set field itself no index takes", () => {
    const paths = unscoped([plain("by_tag_name", ["tag", "name"], ["tag"])]);
    const offered = new Set(["tag", "name"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "name", "prefix", offered), ["tag"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map([["tag", exactly("a", "b")]]), "name", "prefix", offered), ["tag"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map([["tag", exactly("a")]]), "name", "prefix", offered), []);
    assert.equal(recordChoiceNeeds(paths, new Map(), "tag", "prefix", offered), null);
});

test("an entries field's picks need nothing chosen first, take exact values alone, stand beside every other choice, and no path reads them (#1522)", () => {
    const paths = unscoped([plain("by_status", ["status"]), entries("by_service", "byService")]);
    const offered = new Set(["status", "byService"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "byService", "values", offered), []);
    assert.equal(recordChoiceNeeds(paths, new Map(), "byService", "range", offered), null);
    assert.equal(recordChoiceNeeds(paths, new Map(), "byService", "prefix", offered), null);
    // Several picked at once; a range of the field refused.
    const picked = recordChoiceWhere(paths, new Map(), "byService", exactly("Standard", "Priority"));
    assert.ok(sameWhere(picked, [["byService", exactly("Standard", "Priority")]]));
    assert.equal(recordChoiceWhere(paths, new Map(), "byService", RANGE), null);
    // Another field's choice keeps the picks, and a pick replaces none of its choices.
    const both = recordChoiceWhere(paths, picked!, "status", exactly("held"));
    assert.ok(sameWhere(both, [["status", exactly("held")], ["byService", exactly("Standard", "Priority")]]));
    assert.ok(sameWhere(recordChoiceWhere(paths, both!, "byService", exactly("Economy")), [["status", exactly("held")], ["byService", exactly("Economy")]]));
    assert.ok(sameWhere(recordChoiceWhere(paths, both!, "byService", undefined), [["status", exactly("held")]]));
    assert.ok(sameWhere(recordChoiceWhere(paths, both!, "status", undefined), [["byService", exactly("Standard", "Priority")]]));
    // The plan reads the narrowing without the picks: the status's index, or the record's own rows.
    assert.equal(planRecordSlice(paths.indexes, both!, "primary")?.index, "by_status");
    assert.equal(planRecordSlice(paths.indexes, picked!, "primary")?.index, "primary");
});

test("an interval index takes its leading fields exactly together: one of them names the others", () => {
    const paths = unscoped([interval("by_status_machine_time", ["status", "machine"])]);
    const offered = new Set(["status", "machine", "start"]);
    assert.equal(recordChoiceWhere(paths, new Map(), "status", exactly("Ready")), null);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "status", "values", offered), ["machine"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "start", "range", offered), ["status", "machine"]);
    assert.equal(recordChoiceNeeds(paths, new Map(), "start", "prefix", offered), null);
});

test("a page's scope is part of every narrowing: a choice is answered only by an index that takes the scope's fields with it, and what it answers holds the scope (#1621)", () => {
    // A press's page: its jobs by status and by due date under the press, and by customer across every press.
    const scope = new Map<string, Choice>([["press", exactly("P-1")]]);
    const paths: RecordSlicePaths = {
        indexes: [plain("by_press_status", ["press", "status"]), plain("by_press_due", ["press", "due"]), plain("by_customer", ["customer"])], scope,
    };
    const offered = new Set(["status", "due", "customer"]);
    const held: readonly [string, Choice] = ["press", exactly("P-1")];
    // A field its index holds after the scope's: nothing is chosen first — the page chose the press — and the scope stands.
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "status", "values", offered), []);
    assert.ok(sameWhere(recordChoiceWhere(paths, new Map(), "status", exactly("Ready")), [held, ["status", exactly("Ready")]]));
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "due", "range", offered), []);
    assert.ok(sameWhere(recordChoiceWhere(paths, new Map(), "due", RANGE), [held, ["due", RANGE]]));
    // A field only an index without the scope's takes: no choice of it, whatever is chosen first.
    assert.equal(recordChoiceNeeds(paths, new Map(), "customer", "values", offered), null);
    assert.equal(recordChoiceWhere(paths, new Map(), "customer", exactly("Acme")), null);
    // A choice that cannot stand beside another replaces it, and a cleared one leaves it: the scope stays through both.
    const ready = recordChoiceWhere(paths, new Map(), "status", exactly("Ready"))!;
    assert.ok(sameWhere(recordChoiceWhere(paths, ready, "due", RANGE), [held, ["due", RANGE]]));
    assert.ok(sameWhere(recordChoiceWhere(paths, ready, "status", undefined), [held]));
    // The narrowing asked from need not hold the scope, and whatever it holds of a scoped field the page's clause stands.
    assert.ok(sameWhere(recordChoiceWhere(paths, new Map([["press", exactly("P-9")]]), "status", exactly("Ready")), [held, ["status", exactly("Ready")]]));
});

test("a scoped field takes no choice and is never one to choose first: a field its index holds after it and another needs that other alone (#1621)", () => {
    const scope = new Map<string, Choice>([["press", exactly("P-1")]]);
    const paths: RecordSlicePaths = { indexes: [plain("by_press_group_max", ["press", "group", "max"])], scope };
    const offered = new Set(["group", "max"]);
    for (const kind of ["values", "range", "prefix"] as const) assert.equal(recordChoiceNeeds(paths, new Map(), "press", kind, offered), null, kind);
    assert.equal(recordChoiceWhere(paths, new Map(), "press", exactly("P-2")), null, "another value of it is no choice");
    assert.equal(recordChoiceWhere(paths, new Map(), "press", undefined), null, "nor is it cleared");
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "max", "range", offered), ["group"], "the press is the page's: the group alone is still to choose");
    assert.deepEqual(recordChoiceNeeds(paths, new Map([["group", exactly("Hall A")]]), "max", "range", offered), []);
    // Without the scope the press is a field to choose first, and one the rail does not offer: no choice at all.
    assert.equal(recordChoiceNeeds(unscoped([...paths.indexes]), new Map(), "max", "range", offered), null);
});

test("an index holding the scope's field after the chosen one takes an exact choice of that field, and neither a range nor a prefix of it (#1621)", () => {
    const scope = new Map<string, Choice>([["press", exactly("P-1")]]);
    const paths: RecordSlicePaths = { indexes: [plain("by_status_press", ["status", "press"])], scope };
    const offered = new Set(["status"]);
    assert.deepEqual(recordChoiceNeeds(paths, new Map(), "status", "values", offered), []);
    assert.ok(sameWhere(recordChoiceWhere(paths, new Map(), "status", exactly("Ready")), [["status", exactly("Ready")], ["press", exactly("P-1")]]));
    // A range or a prefix ends the path at the status, and the press after it would go unread.
    assert.equal(recordChoiceNeeds(paths, new Map(), "status", "range", offered), null);
    assert.equal(recordChoiceWhere(paths, new Map(), "status", RANGE), null);
    assert.equal(recordChoiceWhere(paths, new Map(), "status", variant("prefix", "Re")), null);
});

test("the narrowing a read carries is the choices with the scope laid over them, and its choices are that narrowing without the scope's fields: one answer a narrowing (#1621)", () => {
    const scope = new Map<string, Choice>([["press", exactly("P-1")]]);
    const choices = new Map<string, Choice>([["status", exactly("Ready")], ["press", exactly("P-9")]]);
    const where = recordScopedWhere(scope, choices);
    assert.ok(sameWhere(where, [["status", exactly("Ready")], ["press", exactly("P-1")]]), "a scoped field's clause is the scope's, whatever the choices hold of it");
    assert.ok(sameWhere(choices, [["status", exactly("Ready")], ["press", exactly("P-9")]]), "the choices are left as they were");
    assert.ok(sameWhere(recordChoicesOf(scope, where), [["status", exactly("Ready")]]));
    assert.ok(Object.is(recordChoicesOf(scope, where), recordChoicesOf(scope, where)), "the same answer whenever the same narrowing is asked");
    // A source with no scope: each is the map it was given.
    const unheld = new Map<string, Choice>();
    assert.ok(Object.is(recordScopedWhere(unheld, choices), choices));
    assert.ok(Object.is(recordChoicesOf(unheld, choices), choices));
});

/** A source as a reader holds it: its config's scope, and the narrowing a read of it carries, which `reads` counts. */
function sourceOf(scope: Where, where: Where): { config: { scope: Where }; read(): { where: Where }; reads: () => number } {
    let reads = 0;
    return { config: { scope }, read: () => { reads++; return { where }; }, reads: () => reads };
}

test("a source's narrowing in its two parts, asked of the source itself: the rows its page holds, its viewer's choices, and whether they narrow it — a scope is no choice (#1621)", () => {
    const scope: Where = new Map<string, Choice>([["press", exactly("P-1")]]);
    // The page alone: the viewer has chosen nothing.
    const untouched = sourceOf(scope, recordScopedWhere(scope, new Map()));
    assert.equal(recordSliceScoped(untouched), true);
    assert.ok(sameWhere(recordSliceBase(untouched), [["press", exactly("P-1")]]), "the rows the page holds: its scope alone");
    assert.ok(Object.is(recordSliceBase(untouched), recordSliceBase(untouched)), "the same map while the source's config is");
    assert.equal(untouched.reads(), 0, "what the page holds is the config's to say: no read of the source's state");
    assert.equal(recordSliceChoices(untouched).size, 0);
    assert.equal(recordSliceChosen(untouched), false, "a page's scope is no choice of the viewer's");
    // The viewer chooses a status under it.
    const chosen = sourceOf(scope, recordScopedWhere(scope, new Map<string, Choice>([["status", exactly("Ready")]])));
    assert.ok(sameWhere(recordSliceChoices(chosen), [["status", exactly("Ready")]]), "the choices leave the scope's fields out");
    assert.ok(Object.is(recordSliceChoices(chosen), recordSliceChoices(chosen)), "the same answer while the narrowing is the same");
    assert.equal(recordSliceChosen(chosen), true);
    assert.ok(sameWhere(recordSliceBase(chosen), [["press", exactly("P-1")]]), "what the page holds is not narrowed by a choice");
});

test("a source with no scope: the rows its page holds are every row, and every clause of its narrowing is the viewer's (#1621)", () => {
    const none_: Where = new Map();
    const whole = sourceOf(none_, new Map());
    assert.equal(recordSliceScoped(whole), false);
    assert.equal(recordSliceBase(whole).size, 0, "no narrowing: every row");
    assert.equal(recordSliceChosen(whole), false);
    const where: Where = new Map<string, Choice>([["status", exactly("Ready")]]);
    const narrowed = sourceOf(none_, where);
    assert.ok(Object.is(recordSliceChoices(narrowed), where), "the narrowing itself");
    assert.equal(recordSliceChosen(narrowed), true);
});

test("choices a reader holds itself are read under the page they are asked on, and a narrowing read of a source gives its choices back (#1621)", () => {
    const scope: Where = new Map<string, Choice>([["press", exactly("P-1")]]);
    const source = sourceOf(scope, recordScopedWhere(scope, new Map()));
    // A view saved on another press's page holds its viewer's choices — and, were it to hold that press, never this page's.
    const saved: Where = new Map<string, Choice>([["status", exactly("Ready")], ["press", exactly("P-9")]]);
    const asked = recordSliceScopedWhere(source, saved);
    assert.ok(sameWhere(asked, [["status", exactly("Ready")], ["press", exactly("P-1")]]), "the page's scope stands over what the choices hold of its fields");
    assert.ok(sameWhere(recordSliceChoicesOf(source, asked), [["status", exactly("Ready")]]));
    assert.equal(source.reads(), 0, "neither reads the source's own state");
    // With no scope each is the map it was given.
    const whole = sourceOf(new Map(), new Map());
    assert.ok(Object.is(recordSliceScopedWhere(whole, saved), saved));
    assert.ok(Object.is(recordSliceChoicesOf(whole, saved), saved));
});

test("a narrowing holds no row where a scoped field of it chooses no value, a list only the page's own expression gives (#1621)", () => {
    const scope = new Map<string, Choice>([["press", variant("values", [])]]);
    assert.equal(recordScopeEmpty(scope, recordScopedWhere(scope, new Map())), true);
    assert.equal(recordScopeEmpty(scope, new Map()), false, "a narrowing that leaves the scope out is read as it is given");
    const held = new Map<string, Choice>([["press", exactly("P-1")]]);
    assert.equal(recordScopeEmpty(held, recordScopedWhere(held, new Map())), false);
    assert.equal(recordScopeEmpty(new Map(), new Map([["press", variant("values", [])]])), false, "a field no scope holds is the planner's to refuse");
});
