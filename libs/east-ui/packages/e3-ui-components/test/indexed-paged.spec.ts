/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record bound with its indexes — `Data.bindPaged(record, { indexes })` —
 * and a record Slice over one, on e3 itself (#1378): the Data.bind examples'
 * people, by name and by skill, and their events about one day through three
 * indexes, read through the paging runtime's default API over the harness's
 * fetch. A move is another session's commit through the record's patch door,
 * reported by the next poll of a dataset cache timed by a clock the test
 * drives; another host is another runtime over another workspace, whose people
 * another session renamed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, East, Expr, OptionType, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { AREA_UNPLACED, RecordSliceWhereType, bindRecord } from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { recordSlicePlace, recordSliceWithin } from "@elaraai/east-ui-components/internal";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";
import { Data, deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { patchRecord, readDataset } from "../src/e3-web.test-utils.js";
import { PagedRuntime, createDefaultPagedApi } from "../src/platform/paged-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

const people = ex.indexedPeople;
const Person = ex.IndexedPerson;
const binding = Data.bindPaged(people, { indexes: [ex.peopleByName, ex.peopleBySkill] });
const Binding = Expr.type(binding);
const program = East.function([], Binding, $ => $.return(binding));
const coverBinding = Data.bindPaged(people, { indexes: [ex.peopleByName, ex.peopleBySkill], join: false });
const coverProgram = East.function([], Expr.type(coverBinding), $ => $.return(coverBinding));
const stringEqual = equalFor(StringType);
const revisionEqual = equalFor(OptionType(StringType));
const rowEqual = equalFor(OptionType(Person));
const printWhere = printFor(RecordSliceWhereType);

/** The pages, or the searches, of a record asked of the test's workspace so far. */
const pagesOf = (record: { readonly name: string }) => h.requests("page", `records.${record.name}`);
const findsOf = (record: { readonly name: string }) => h.requests("find", `records.${record.name}`);

/**
 * A paging runtime over e3's paging API, following each dataset through a
 * cache's poll, timed by the clock it gives.
 *
 * @param workspace - The workspace it reads; the test's own unless given
 * @returns The runtime, its API and the clock
 */
function newRuntime(workspace?: string) {
    const { cache, clock } = h.cache(workspace === undefined ? {} : { workspace });
    const api = createDefaultPagedApi(h.e3.apiUrl, h.e3.repo, h.options, cache);
    const runtime = new PagedRuntime();
    runtime.initialize(api, workspace ?? h.workspace);
    return { runtime, api, clock };
}

function platform(runtime: PagedRuntime) {
    return [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
}

/** The content hash e3 holds a record's state under now, in a workspace — the test's own unless given. */
async function hashOf(path: TreePath, workspace = h.workspace): Promise<string> {
    const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, workspace, path, h.e3.direct);
    assert.equal(status.hash.type, "some", "the record has a state");
    return status.hash.value!;
}

/** Another session's commit of the people, in a workspace: what e3 holds, the given people in place of theirs. */
async function commitPeople(workspace: string, changed: Iterable<readonly [string, ValueTypeOf<typeof Person>]>): Promise<void> {
    const next = await readDataset(h.e3, workspace, people);
    for (const [key, person] of changed) next.set(key, person);
    await patchRecord(h.e3, workspace, people, next);
}

test("indexed binding survives serialization, scopes reads, and follows the decoder's revision", async () => {
    const encoding = new PagedRuntime();
    const handle = East.compile(program, platform(encoding))();
    const bytes = encodeBeast2For(Binding)(handle);
    const { runtime, clock } = newRuntime();
    const decoded = decodeBeast2For(Binding, { platform: platform(runtime) })(bytes);
    assert.equal(decoded.recordId, people.name);
    assert.deepEqual(deriveManifest(program), { paths: [], functions: [], records: [], pages: [people.path] });
    assert.throws(() => East.compile(program, runtime.indexed.platform(new Set()))(), /not declared in manifest/);
    assert.equal(decoded.defaultIndex, "primary");
    assert.equal(decoded.page("primary", 0n, 3n).type, "none");
    const primary = await h.ready(() => decoded.page("primary", 0n, 3n));
    assert.deepEqual(primary.map(row => row.key), ["p1", "p2", "p3"], "a row with no skills remains present once");
    assert.ok(rowEqual(primary[1]!.row, some({ name: "Abe", skills: new Set<string>() })));
    assert.deepEqual(primary[0]!.value, none);
    assert.deepEqual(decoded.total("primary"), some(3n));
    const index = await h.ready(() => decoded.page("by_skill", 1n, 2n));
    assert.deepEqual(index.map(row => [row.ik, row.key]), [[variant("by_skill", "b"), "p1"], [variant("by_skill", "b"), "p3"]]);
    assert.deepEqual(index[0]!.value, some(null));
    const R1 = await hashOf(people.path);
    assert.deepEqual(await h.ready(() => decoded.seek("by_skill", variant("key", '"b"'))),
        { found: true, row: 1n, count: 2n });
    assert.deepEqual(findsOf(people).map(request => [request.query.get("index"), request.query.get("key"), request.query.get("hash")]),
        [["by_skill", '"b"', R1]], "the search is the skills index's, pinned to the revision");
    assert.throws(() => decoded.page("undeclared", 0n, 1n), /not declared/);
    const requests = pagesOf(people).length;
    const repeated = decoded.page("by_skill", 1n, 2n);
    assert.equal(repeated.type === "some" && repeated.value, index, "unchanged pages preserve identity for renderer memoization");
    assert.equal(pagesOf(people).length, requests, "repeat reads use the existing page cache");
    // Another session renames Abe; the cache's next poll reports the record's new state.
    await commitPeople(h.workspace, [["p2", { name: "Abel", skills: new Set<string>() }]]);
    const R2 = await hashOf(people.path);
    clock.tickAll();
    await h.settle();
    assert.deepEqual(decoded.revision(), some(R2));
    assert.equal(decoded.page("primary", 0n, 3n).type, "none", "no old revision's rows are returned as current");
    const next = await h.ready(() => decoded.page("primary", 0n, 3n));
    assert.ok(rowEqual(next[1]!.row, some({ name: "Abel", skills: new Set<string>() })));
    assert.equal(pagesOf(people).at(-1)?.query.get("hash"), R2);
    runtime.clear();
});

test("each indexed source builds its handle once, however often it is read (#1360)", async () => {
    // A window over an interval index is some fifty-five searches, each a read of
    // its source: each read once built the index's window type again and looked
    // its handle up by that type's structure.
    const { runtime, api } = newRuntime();
    const build = runtime.buildHandle.bind(runtime);
    const built: (string | null)[] = [];
    runtime.buildHandle = (type, path, selector, shape) => { built.push(selector.index); return build(type, path, selector, shape); };
    const handle = East.compile(program, platform(runtime))();
    const read = async () => {
        await h.ready(() => handle.revision());
        await h.ready(() => handle.seek("by_skill", variant("key", '"b"')));
        await h.ready(() => handle.page("by_skill", 0n, 2n));
        await h.ready(() => handle.total("by_skill"));
    };
    await read();
    assert.deepEqual(built, [null, "by_skill", "by_skill", "by_skill"],
        "each method's source is built as it is first read: the revision's over the record's own rows, the search's, the page's and the total's over the index's");
    await read();
    await read();
    assert.equal(built.length, 4, "read again, nothing is built");
    runtime.clear();
    runtime.initialize(api, h.workspace);
    await h.ready(() => handle.revision());
    assert.deepEqual(built.slice(4), [null], "a clear drops them with the windows, so the next read builds again");
    runtime.clear();
});

test("covering-only binding reads and counts without primary segments", async () => {
    const { runtime } = newRuntime();
    const handle = East.compile(coverProgram, platform(runtime))();
    assert.equal(handle.defaultIndex, "by_name");
    assert.deepEqual(await h.ready(() => handle.total("primary")), 3n);
    const window = await h.ready(() => handle.page(handle.defaultIndex, 0n, 2n));
    assert.deepEqual(window.map(row => row.row), [none, none]);
    const pages = pagesOf(people);
    assert.ok(pages.length > 0);
    assert.ok(pages.every(request => request.query.get("index") === "by_name" && !request.query.has("join")),
        "every page is the name index's, its rows never joined");
    assert.ok(pages.every(request => Number(request.query.get("limit")) <= 2), "counting does not walk the record");
    runtime.clear();
});


const narrowed = bindRecord("test.people", binding, {
    fields: { name: { label: "Name" }, skills: { label: "Skills", hints: ["a", "b"] } },
    initial: { skills: ["b"] },
    presets: [{ id: "a", name: "A skill", where: { skills: ["a"] } }],
});
const Narrowed = Expr.type(narrowed);
const sliceProgram = East.function([], Narrowed, $ => $.return(narrowed));

function slicePlatform(runtime: PagedRuntime) {
    const implementations = platform(runtime);
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return implementations;
}

test("record Slice binds typed controls, reads each narrowing when its rows are read, and survives decode into another host", async () => {
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const implementations = slicePlatform(runtime);
    const create = East.compile(sliceProgram, implementations);
    const handle = create();
    assert.equal(handle.sourceId, people.name, "editing identity is the primary record, independent of index selection");
    const otherSource = Data.bindPaged(people, { indexes: [ex.peopleByName] });
    const otherSlice = bindRecord("test.names", otherSource, { search: "name" });
    const otherHandle = East.compile(East.function([], Expr.type(otherSlice), () => otherSlice), implementations)();
    assert.equal(otherHandle.sourceId, handle.sourceId, "different index lists share the record's save gate");
    assert.equal(await h.ready(() => handle.count()), 2n);
    assert.equal(await h.ready(() => handle.total()), 3n);
    assert.equal(await h.ready(() => handle.countWhere(new Map([["skills", variant("values", ['"a"'])]]))), 1n);
    assert.equal(await h.ready(() => handle.count()), 2n, "counting a saved query never changes the current narrowing");
    assert.deepEqual((await h.ready(() => handle.data.page(0n, 10n))).map(row => row.key), ["p1", "p3"]);
    assert.deepEqual(handle.config.fields.map(field => [field.fieldId, field.kind, field.set]), [["name", "string", false], ["skills", "string", true]]);
    const bytes = encodeBeast2For(Narrowed)(handle);
    assert.equal(handle.readEntry("p2").type, "none", "an unloaded primary read remains pending");
    const outside = await h.ready(() => handle.readEntry("p2"));
    assert.equal(outside.type, "some", "a filtered-out row is not a deletion");
    assert.ok(outside.type === "some" && equalFor(Person)(decodeBeast2For(Person)(outside.value), { name: "Abe", skills: new Set<string>() }));
    assert.deepEqual(await h.ready(() => handle.readEntry("missing")), none, "absence needs a confirmed primary seek");
    assert.ok(pagesOf(people).filter(request => !request.query.has("index")).every(request => request.query.get("limit") === "1"),
        "confirmation reads one entry, never the whole record");
    const captured = handle.read().where;
    assert.equal(await h.ready(() => handle.contains(captured, "p1")), true, "membership includes a Set row once regardless of its other keys");
    assert.equal(await h.ready(() => handle.contains(captured, "p2")), false, "a present row outside the query is distinguished from a missing page");
    assert.equal(await h.ready(() => handle.contains(captured, "p3")), true, "membership does not depend on a resident page");
    assert.equal(await h.ready(() => handle.contains(captured, "missing")), false);
    assert.ok(stringEqual(handle.data.query(), printWhere(captured)), "`query` names the narrowing the rows serve");
    handle.choose("skills", ['"a"']);
    const changed = create();
    assert.equal(changed, handle, "the bind returns its binding's one handle, whatever the narrowing (#1354)");
    assert.ok(stringEqual(handle.data.query(), printWhere(handle.read().where)), "`query` moves with the narrowing");
    assert.ok(!stringEqual(handle.data.query(), printWhere(captured)));
    assert.deepEqual((await h.ready(() => handle.data.page(0n, 10n))).map(row => row.key), ["p1"], "a handle bound before the choice reads the narrowing as it stands");
    assert.ok(revisionEqual(handle.data.revision(), some(await hashOf(people.path))), "a narrowing never moves the revision a Save confirms against");
    assert.equal(changed.read().where.get("skills")?.type, "values");
    assert.throws(() => changed.choose("skills", ['"a"', '"b"']), /Choose one/);
    assert.throws(() => changed.prefix("skills", "b"), /exact value/);
    changed.prefix("name", "Ab");
    const names = create();
    assert.deepEqual([...names.read().where.keys()], ["name"], "an incompatible choice replaces the old narrowing");
    assert.deepEqual((await h.ready(() => names.data.page(0n, 10n))).map(row => row.key), ["p2"]);
    changed.clearAll();
    const all = create();
    assert.deepEqual((await h.ready(() => all.data.page(0n, 10n))).map(row => row.key), ["p1", "p2", "p3"], "clearing includes empty Set rows exactly once");
    const suggestions = await h.ready(() => all.suggest("name", "A"));
    assert.deepEqual(suggestions.map(value => value.label), ["Abe", "Ada", "Amy"]);
    assert.deepEqual(suggestions.map(value => value.count), [some(1n), some(1n), some(1n)]);
    // Another host: a runtime over another workspace, whose people another session renamed.
    const other = await h.e3.workspace();
    await commitPeople(other, [
        ["p1", { name: "Ada Moss", skills: new Set(["a", "b"]) }],
        ["p2", { name: "Abe Moss", skills: new Set<string>() }],
        ["p3", { name: "Amy Moss", skills: new Set(["b"]) }],
    ]);
    const otherRevision = await hashOf(people.path, other);
    const another = newRuntime(other).runtime;
    StateRuntime.initializeStore(new UIStore());
    const decoded = decodeBeast2For(Narrowed, { platform: slicePlatform(another) })(bytes);
    assert.ok(stringEqual(decoded.data.id, handle.data.id), "the source's id names no narrowing, so a payload written under one serves under every other");
    // The decoder's store is seeded from the declared initial narrowing, and
    // the decoded source reads it there, never the narrowing it was encoded under.
    const rows = await h.ready(() => decoded.data.page(0n, 10n));
    assert.deepEqual(rows.map(row => row.key), ["p1", "p3"]);
    assert.deepEqual(rows.map(row => row.row.type === "some" ? row.row.value.name : ""), ["Ada Moss", "Amy Moss"]);
    assert.deepEqual(await h.ready(() => decoded.data.revision()), otherRevision);
    decoded.choose("skills", ['"a"']);
    assert.ok(stringEqual(decoded.data.query(), printWhere(decoded.read().where)));
    assert.deepEqual((await h.ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["p1"], "a decoded source reads the decoder's narrowing as it stands");
    assert.ok(revisionEqual(decoded.data.revision(), some(otherRevision)));
    const confirmed = await h.ready(() => decoded.readEntry("p2"));
    assert.ok(confirmed.type === "some" && equalFor(Person)(decodeBeast2For(Person)(confirmed.value), { name: "Abe Moss", skills: new Set<string>() }), "decoded confirmation uses the new host");
    assert.equal(decoded.sourceId, handle.sourceId, "narrowing does not change editing identity");
    assert.equal(await h.ready(() => decoded.countWhere(new Map([["name", variant("prefix", "Abe M")]]))), 1n,
        "saved-query counts survive serialization and use the decoder's data");
    assert.equal(await h.ready(() => decoded.contains(decoded.read().where, "p1")), true, "membership survives serialization");
    decoded.togglePreset("a");
    assert.equal(await h.ready(() => decoded.count()), 1n);
    runtime.clear();
    another.clear();
});

function _recordTypeRefusals() {
    // @ts-expect-error an undeclared field is not among the binding's controls
    bindRecord("bad", binding, { fields: { missing: {} } });
    // @ts-expect-error Set membership takes its element type
    bindRecord("bad", binding, { initial: { skills: [4n] } });
    // @ts-expect-error the String field is not a numeric or date range
    bindRecord("bad", binding, { range: "name" });
    // @ts-expect-error local filtering is not an option for record slices
    bindRecord("bad", binding, { breakdown: ["name"] });
    // @ts-expect-error only an indexed binding can be narrowed
    bindRecord("bad", Data.bindPaged(people));
}


test("interval Slice pages and counts overlapping original records once, including carry-in and optional backlog", async () => {
    const events = ex.indexedIntervals;
    const rows = await h.read(events);
    const source = Data.bindPaged(events, { indexes: [ex.intervalsByStart, ex.intervalsByStatusTime, ex.intervalsByTime] });
    const from = new Date("2026-10-02T00:00:00Z");
    const to = new Date("2026-10-03T00:00:00Z");
    const sliced = bindRecord("test.intervals", source, { range: "start", initial: { status: ["Ready"], start: { from, to } } });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const implementations = slicePlatform(runtime);
    const create = East.compile(program, implementations);
    const handle = create();
    assert.equal(await h.ready(() => handle.count()), 4n);
    assert.equal(pagesOf(events).length, 0, "counts use bounds alone");
    const first = await h.ready(() => handle.data.page(0n, 2n));
    const next = await h.ready(() => handle.data.page(2n, 2n));
    const keys = [...first, ...next].map(row => row.key).sort(compareFor(StringType));
    assert.deepEqual(keys, ["carry", "inside", "instant-at-from", "span"]);
    assert.ok([...first, ...next].every(row => row.row.type === "some"));
    const captured = handle.read().where;
    for (const key of rows.keys()) {
        assert.equal(await h.ready(() => handle.contains(captured, key)), keys.includes(key), `indexed membership preserves overlap for ${key}`);
    }
    const print = printFor(OptionType(DateTimeType));
    assert.deepEqual(await h.ready(() => handle.domain("start")), {
        from: print(rows.get("span")!.start), to: print(rows.get("starts-at-to")!.start),
    }, "range domain skips Unset and internal carry-in entries");
    assert.equal(await h.ready(() => handle.total()), 9n);
    handle.clear("status");
    handle.range("start", print(some(from)), print(some(to)));
    const allStatuses = create();
    assert.equal(await h.ready(() => allStatuses.count()), 5n, "an unprefixed overlap still includes carry-in");
    assert.ok(findsOf(events).some(request => request.query.get("index") === "by_time"), "an overlap of every status searches the time index");
    handle.choose("start", [print(none)]);
    const backlog = create();
    assert.equal(await h.ready(() => backlog.count()), 1n);
    assert.deepEqual((await h.ready(() => backlog.data.page(0n, 2n))).map(row => row.key), ["backlog"]);
    assert.equal(h.requests("read", `records.${events.name}`).length, 0, "the record is never read whole");
    runtime.clear();
});

test("a window over an area index reads the racks whose box meets it from the index alone, each with its row, once (#1385)", async () => {
    const racks = ex.indexedRacks;
    const stored = await h.read(racks);
    const source = Data.bindPaged(racks, { indexes: [ex.racksByArea, ex.racksByHallArea, ex.racksByHall] });
    const sliced = bindRecord("test.racks", source, { fields: { hall: { label: "Hall", hints: ["A", "B"] } } });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(program, slicePlatform(runtime))();
    // The binding marks each area index's `__area` with its box, which the slice reads back; the rail is offered the
    // leading fields alone.
    assert.deepEqual(handle.config.fields.map(field => field.fieldId), ["hall"]);
    const area = (name: string) => handle.config.indexes.find(index => index.name === name)!.area;
    const box = { x: "x", y: "y", width: some("w"), height: some("h"), centre: true, cell: 2 ** -7, optional: true };
    assert.deepEqual([area("racks_by_area"), area("racks_by_hall_area"), area("racks_by_hall")], [some(box), some(box), none]);
    const rowOf = equalFor(ex.IndexedRack);
    const keyOrder = compareFor(StringType);
    /** A window's racks, by key, each read once and carrying the row the record holds. */
    const windowed = async (where: ValueTypeOf<typeof RecordSliceWhereType>) => {
        const rows = await h.ready(() => handle.pageWhere(where, 0n, 100n));
        assert.equal(await h.ready(() => handle.countWhere(where)), BigInt(rows.length), "the count is the rows the window reads");
        for (const row of rows) {
            assert.ok(row.row.type === "some" && rowOf(row.row.value, stored.get(row.key)!), `${row.key} carries its row`);
            assert.deepEqual(row.value, some(null), "beside an index that carries nothing, the binding's projection is Null (D29)");
        }
        const keys = rows.map(row => row.key).sort(keyOrder);
        assert.equal(new Set(keys).size, keys.length, "each rack once");
        return keys;
    };
    // Hall A's row of racks: every rack whose box meets the window is read, and the far one and the unplaced one never.
    type Choice = ValueTypeOf<typeof RecordSliceWhereType> extends Map<string, infer C> ? C : never;
    const rowWindow: Choice = variant("window", { minX: 0.5, minY: 0.4, maxX: 3.5, maxY: 1.6 });
    const row = await windowed(new Map<string, Choice>([["__area", rowWindow]]));
    assert.ok(["r1", "r2", "r3"].every(key => row.includes(key)), `the row's racks: ${row.join(", ")}`);
    assert.ok(!row.includes("far") && !row.includes("unplaced"));
    // The rail's hall beside the window reads through the area index it leads: hall B's rack across the aisle.
    const across = new Map<string, Choice>([["hall", variant("values", ['"B"'])], ["__area", variant("window", { minX: 1.5, minY: 3.0, maxX: 2.5, maxY: 4.0 })]]);
    assert.deepEqual(await windowed(across), ["r4"]);
    assert.deepEqual(await windowed(new Map<string, Choice>([["__area", variant("values", [AREA_UNPLACED])]])), ["unplaced"]);
    // A window's membership seeks each rack's maintained key against the window's searches.
    const captured = new Map<string, Choice>([["__area", rowWindow]]);
    assert.equal(await h.ready(() => handle.contains(captured, "r2")), true);
    assert.equal(await h.ready(() => handle.contains(captured, "far")), false);
    // From the index alone: no page and no run of the record is joined, and the record is never read whole.
    const reads = [...pagesOf(racks), ...h.requests("runs", `records.${racks.name}`)].filter(request => request.query.has("index"));
    assert.ok(reads.length > 0 && reads.every(request => !request.query.has("join")), "an area index's reads join nothing");
    assert.equal(h.requests("read", `records.${racks.name}`).length, 0, "the record is never read whole");
    runtime.clear();
});

test("a record Slice places its narrowing's rows in the record, and asks which of some rows it holds, from the index alone (#1349)", async () => {
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(sliceProgram, slicePlatform(runtime))();
    const R1 = await h.ready(() => handle.data.revision());
    const where = handle.read().where;
    // Skill b: Ada and Amy, two of the record's three people, all in its one segment.
    const placement = await h.ready(() => recordSlicePlace(handle));
    assert.deepEqual(placement, { segments: [{ offset: 0n, count: 3n, rows: 2n }], placed: 2n, total: 2n, records: 3n, complete: true });
    const stored = await h.read(people);
    const rows = [...stored].map(([key, row]) => ({ key, row }));
    assert.deepEqual(rows.map(row => row.key), ["p1", "p2", "p3"]);
    assert.deepEqual(await h.ready(() => recordSliceWithin(handle, where, rows)), [true, false, true]);
    // One placement and one membership read, pinned to the revision the narrowing's runs are at, and no page of the
    // record's own rows: Ada's two skills are two entries, Abe's none, Amy's one.
    assert.deepEqual(h.requests("place", `records.${people.name}`).map(request => [request.method, request.query.get("hash")]), [["POST", R1]]);
    const within = h.requests("within", `records.${people.name}`);
    assert.deepEqual(within.map(request => [request.method, request.query.get("hash")]), [["POST", R1]]);
    const body = JSON.parse(new TextDecoder().decode(within[0]!.body)) as { index: string; keys: string[] };
    assert.equal(body.index, ex.peopleBySkill.name);
    assert.equal(body.keys.length, 3);
    assert.deepEqual(pagesOf(people).filter(request => !request.query.has("index")), [], "no page of the record's own rows");
    // Asked again, both answer from what the runtime holds.
    const before = h.requests("place", `records.${people.name}`).length + within.length;
    assert.deepEqual(recordSlicePlace(handle), some(placement));
    assert.deepEqual(recordSliceWithin(handle, where, rows), some([true, false, true]));
    assert.equal(h.requests("place", `records.${people.name}`).length + h.requests("within", `records.${people.name}`).length, before);
    // A narrowing of no field holds every row, and has nothing to place.
    assert.deepEqual(recordSliceWithin(handle, new Map(), rows), some([true, true, true]));
    assert.throws(() => recordSlicePlace(handle, new Map()), /nothing narrows this record/);
    runtime.clear();
});

test("a window over an interval index is two requests — its searches in one, the runs they select in one — and its count's readers re-fire once (#1351)", async () => {
    const events = ex.indexedIntervals;
    const source = Data.bindPaged(events, { indexes: [ex.intervalsByStart, ex.intervalsByStatusTime, ex.intervalsByTime] });
    const from = new Date("2026-10-02T00:00:00Z");
    const to = new Date("2026-10-03T00:00:00Z");
    const sliced = bindRecord("test.intervals.batched", source, { range: "start", initial: { status: ["Ready"], start: { from, to } } });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(program, slicePlatform(runtime))();
    const R1 = await h.ready(() => handle.data.revision());
    // The count, read as a view reads it: under tracking, its reader subscribed to what it read.
    runtime.enableTracking();
    assert.equal(handle.count().type, "none", "its searches are in flight");
    let fired = 0;
    const reader = () => { fired += 1; };
    for (const key of runtime.disableTracking()) runtime.subscribe(key, reader);
    await h.settle();
    assert.equal(fired, 1, "the count's reader re-fires once, as every search lands together");
    const searches = findsOf(events);
    assert.deepEqual(searches.map(request => [request.method, request.query.get("index"), request.query.get("hash")]),
        [["POST", ex.intervalsByStatusTime.name, R1]], "one request for the window's searches");
    assert.ok(searches[0]!.searches.length > 50, "the start range and the carry-in ranges at each span");
    assert.deepEqual(handle.count(), some(4n));
    const rows = await h.ready(() => handle.data.page(0n, 4n));
    assert.deepEqual(rows.map(row => row.key).sort(compareFor(StringType)), ["carry", "inside", "instant-at-from", "span"]);
    assert.deepEqual(h.requests("runs", `records.${events.name}`).map(request => [request.method, request.query.get("index"), request.query.get("hash")]),
        [["POST", ex.intervalsByStatusTime.name, R1]], "one request for the runs the searches select");
    assert.deepEqual([pagesOf(events).length, findsOf(events).length], [0, 1], "no run is paged, and no search asked, on its own");
    runtime.clear();
});
