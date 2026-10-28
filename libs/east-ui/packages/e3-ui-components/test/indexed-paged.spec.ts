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
    DateTimeType, East, Expr, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, isValueOf, none, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { SeekQueryType } from "@elaraai/east-ui";
import {
    RecordSliceReadType, RecordSliceWhereType, areaQueries, bindRecord, resolveRowSource, type RecordSliceJoined, type ResolvedRowSource,
} from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import {
    recordSliceCellEntries, recordSliceCellJoins, recordSliceCellRuns, recordSliceOnPrinter, recordSlicePlace, recordSliceWithin, recordSliceWithinAt,
} from "@elaraai/east-ui-components/internal";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import {
    RecordLevelType, RecordNestedPathType, RecordNestedRunType, type RecordLevel, type RecordNestedPath, type RecordNestedRun, type TreePath,
} from "@elaraai/e3-types";
import { Data, deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import * as nx from "@elaraai/e3-ui/examples/bind/data/data-nested";
import { patchRecord, readDataset } from "../src/e3-web.test-utils.js";
import { recordSliceBatchesOf } from "../src/platform/indexed-paged.js";
import { PagedRuntime, createDefaultPagedApi } from "../src/platform/paged-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex, "bind/data/data-nested": nx });

const people = ex.indexedPeople;
const Person = ex.IndexedPerson;
const binding = Data.bindPaged(people, { indexes: ["by_name", "by_skill"] });
const Binding = Expr.type(binding);
const program = East.function([], Binding, $ => $.return(binding));
const coverBinding = Data.bindPaged(people, { indexes: ["by_name", "by_skill"], join: false });
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
    const otherSource = Data.bindPaged(people, { indexes: ["by_name"] });
    const otherSlice = bindRecord("test.names", otherSource, { search: "name" });
    const otherHandle = East.compile(East.function([], Expr.type(otherSlice), () => otherSlice), implementations)();
    assert.equal(otherHandle.sourceId, handle.sourceId, "different index lists share the record's save gate");
    assert.equal(await h.ready(() => handle.count()), 2n);
    assert.equal(await h.ready(() => handle.total()), 3n);
    assert.equal(await h.ready(() => handle.countWhere({ where: new Map([["skills", variant("values", ['"a"'])]]), area: none })), 1n);
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
    assert.equal(await h.ready(() => decoded.countWhere({ where: new Map([["name", variant("prefix", "Abe M")]]), area: none })), 1n,
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
    const source = Data.bindPaged(events, { indexes: ["by_start", "by_status_time", "by_time"] });
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

test("a String search through an interval index finds the values its leading field holds, each once with its count, and none past the text (#1432)", async () => {
    const events = ex.indexedIntervals;
    // The status leads an interval index alone: its values are its key's leading field, under `on`.
    const source = Data.bindPaged(events, { indexes: ["by_start", "by_status_time", "by_time"] });
    const sliced = bindRecord("test.intervals.search", source, { range: "start", search: "status" });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(program, slicePlatform(runtime))();
    const found = (text: string) => h.ready(() => handle.suggest("status", text));
    assert.deepEqual((await found("")).map(value => [value.label, value.count]), [["Cancelled", some(1n)], ["Ready", some(8n)]],
        "each status once, in the index's order, counted under no other choice");
    assert.deepEqual((await found("Re")).map(value => [value.label, value.count]), [["Ready", some(8n)]]);
    assert.deepEqual(await found("Rex"), [], "no status starts so");
    assert.deepEqual(await found("re"), [], "a search keeps the text's case");
    assert.equal(h.requests("read", `records.${events.name}`).length, 0, "the record is never read whole");
    runtime.clear();
});

test("a window over an area index reads the racks whose box meets it from the index alone, each with its row, once (#1385)", async () => {
    const racks = ex.indexedRacks;
    const stored = await h.read(racks);
    const source = Data.bindPaged(racks, { indexes: ["racks_by_area", "racks_by_hall_area", "racks_by_hall"] });
    const sliced = bindRecord("test.racks", source, { fields: { hall: { label: "Hall", hints: ["A", "B"] } } });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(program, slicePlatform(runtime))();
    // The binding marks each area index's kind with its box, which the slice reads back; the rail is offered the
    // leading fields alone (#1432).
    assert.deepEqual(handle.config.fields.map(field => field.fieldId), ["hall"]);
    const area = (name: string) => handle.config.indexes.find(index => index.name === name)!.area;
    const box = { x: "x", y: "y", width: some("w"), height: some("h"), centre: true, cell: 2 ** -7, optional: true };
    assert.deepEqual([area("racks_by_area"), area("racks_by_hall_area"), area("racks_by_hall")], [some(box), some(box), none]);
    const rowOf = equalFor(ex.IndexedRack);
    const keyOrder = compareFor(StringType);
    /** A read by area's racks, by key, each read once and carrying the row the record holds. */
    const windowed = async (read: ValueTypeOf<typeof RecordSliceReadType>) => {
        const rows = await h.ready(() => handle.pageWhere(read, 0n, 100n));
        assert.equal(await h.ready(() => handle.countWhere(read)), BigInt(rows.length), "the count is the rows the window reads");
        for (const row of rows) {
            assert.ok(row.row.type === "some" && rowOf(row.row.value, stored.get(row.key)!), `${row.key} carries its row`);
            assert.deepEqual(row.value, some(null), "beside an index that carries nothing, the binding's projection is Null (D29)");
        }
        const keys = rows.map(row => row.key).sort(keyOrder);
        assert.equal(new Set(keys).size, keys.length, "each rack once");
        return keys;
    };
    // Hall A's row of racks: every rack whose box meets the window is read, and the far one and the unplaced one never.
    // A read by area asks its window, or its unplaced rows, beside the narrowing, never as a field's choice (#1432).
    type Choice = ValueTypeOf<typeof RecordSliceWhereType> extends Map<string, infer C> ? C : never;
    const NOTHING = new Map<string, Choice>();
    const row = await windowed({ where: NOTHING, area: some(variant("window", { minX: 0.5, minY: 0.4, maxX: 3.5, maxY: 1.6 })) });
    assert.ok(["r1", "r2", "r3"].every(key => row.includes(key)), `the row's racks: ${row.join(", ")}`);
    assert.ok(!row.includes("far") && !row.includes("unplaced"));
    // The rail's hall beside the window reads through the area index it leads: hall B's rack across the aisle.
    const across = new Map<string, Choice>([["hall", variant("values", ['"B"'])]]);
    assert.deepEqual(await windowed({ where: across, area: some(variant("window", { minX: 1.5, minY: 3.0, maxX: 2.5, maxY: 4.0 })) }), ["r4"]);
    assert.deepEqual(await windowed({ where: NOTHING, area: some(variant("unplaced", null)) }), ["unplaced"]);
    // From the index alone: no page and no run of the record is joined, and the record is never read whole.
    const reads = [...pagesOf(racks), ...h.requests("runs", `records.${racks.name}`)].filter(request => request.query.has("index"));
    assert.ok(reads.length > 0 && reads.every(request => !request.query.has("join")), "an area index's reads join nothing");
    assert.equal(h.requests("read", `records.${racks.name}`).length, 0, "the record is never read whole");
    runtime.clear();
});

test("a row's fields named `area`, `__area`, `tile` and `__tile` are each offered, chosen and counted on e3, and `area` and `__area` beside a window read through the area index they lead (#1432)", async () => {
    const racks = ex.namedRacks;
    const source = Data.bindPaged(racks, {
        indexes: ["named_by_area", "named_by_under_area", "named_by_tile", "named_by_under_tile", "named_by_place", "named_by_area_place"],
    });
    const sliced = bindRecord("test.named", source, {
        fields: { area: { hints: ["A1", "A2"] }, __area: { hints: ["B", "C"] }, tile: { hints: ["T1", "T2"] }, __tile: { hints: ["U1", "U2"] } },
    });
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(East.function([], Expr.type(sliced), $ => $.return(sliced)), slicePlatform(runtime))();
    assert.deepEqual(handle.config.fields.map(field => field.fieldId), ["area", "__area", "tile", "__tile"], "each offered");
    const printString = printFor(StringType);
    for (const [field, value, expected] of [["area", "A1", 4n], ["__area", "B", 4n], ["tile", "T1", 3n], ["__tile", "U1", 3n]] as const) {
        handle.choose(field, [printString(value)]);
        assert.deepEqual([...handle.read().where.keys()], [field], `${field} chosen`);
        assert.equal(await h.ready(() => handle.count()), expected, `${field} counted on e3`);
        handle.clearAll();
    }
    // A read by area asks its window, or its unplaced rows, beside the choice of both: through the area index they lead.
    type Choice = ValueTypeOf<typeof RecordSliceWhereType> extends Map<string, infer C> ? C : never;
    const where = new Map<string, Choice>([["area", variant("values", [printString("A1")])], ["__area", variant("values", [printString("B")])]]);
    const keysOf = async (read: ValueTypeOf<typeof RecordSliceReadType>) => {
        const rows = await h.ready(() => handle.pageWhere(read, 0n, 100n));
        assert.equal(await h.ready(() => handle.countWhere(read)), BigInt(rows.length));
        return rows.map(row => row.key).sort(compareFor(StringType));
    };
    assert.deepEqual(await keysOf({ where, area: some(variant("window", { minX: 0, minY: 0, maxX: 3, maxY: 3 })) }), ["n1"],
        "the window's rack in A1 by B: never the one by C or in A2 inside it, nor the far one");
    assert.deepEqual(await keysOf({ where, area: some(variant("unplaced", null)) }), ["unplaced"]);
    const searched = h.requests("find", `records.${racks.name}`).filter(request => request.query.get("index") === "named_by_area_place");
    assert.ok(searched.length > 0, "read through the area index `area` and `__area` lead");
    const leading = searched.flatMap(request => request.searches.flatMap(search => "fields" in search ? [search.fields[0]] : []));
    assert.ok(leading.length > 0 && leading.every(on => on === '(area="A1", __area="B")'), `each exact search names both as one \`on\`: ${leading.join(", ")}`);
    runtime.clear();
});

test("a window's details are read by the runs its area index's cells are — the keys read by e3, none sent — pinned to both records, and read again as either moves (#1393)", async () => {
    const racks = ex.indexedRacks;
    const loads = ex.indexedRackLoads;
    const source = Data.bindPaged(racks, { indexes: ["racks_by_area", "racks_by_hall_area", "racks_by_hall"] });
    const sliced = bindRecord("test.racks.details", source, { fields: { hall: { label: "Hall", hints: ["A", "B"] } } });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    const loadsBinding = Data.bindPaged(loads);
    const loadsProgram = East.function([], Expr.type(loadsBinding), $ => $.return(loadsBinding));
    const { runtime, clock } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const implementations = slicePlatform(runtime);
    const handle = East.compile(program, implementations)();
    // The loads' paged read: the details a Schematic's kind names by its `id`.
    const dict = East.compile(loadsProgram, [runtime.buildPinnedPlatform(null), ...runtime.buildPrimitives()])().id;
    const loadEqual = equalFor(OptionType(ex.IndexedRackLoad));
    const printSeek = printFor(SeekQueryType);
    /** A window's cells, a search each, as the Schematic's window reads them. */
    const cellsOf = (box: { minX: number; minY: number; maxX: number; maxY: number }) =>
        areaQueries([], box, 2 ** -7, recordSliceOnPrinter(handle, "racks_by_area")).map((query) => ({ id: printSeek(query), queries: [query] }));
    /** What a read of the loads holds, by its rack's key: each a load as the loads' record types it. */
    const byKey = (read: ReadonlyMap<string, readonly RecordSliceJoined[]>) =>
        new Map([...read.values()].flat().map((joined) => [joined.key as string, joined.row as ValueTypeOf<OptionType<typeof ex.IndexedRackLoad>>] as const));
    const joins = () => h.requests("rows", `records.${loads.name}`);
    const row = cellsOf({ minX: 0.5, minY: 0.4, maxX: 3.5, maxY: 1.6 });
    const R1 = await h.ready(() => handle.data.revision());
    const L1 = await hashOf(loads.path);

    const read = await h.ready(() => recordSliceCellJoins(handle, "racks_by_area", row, dict));
    const entries = await h.ready(() => recordSliceCellEntries(handle, "racks_by_area", row));
    for (const cell of row) {
        assert.deepEqual(read.get(cell.id)!.map((joined) => joined.key), entries.get(cell.id)!.map((entry) => entry.key),
            `${cell.id}: each entry's key, in the cell's order`);
    }
    const first = byKey(read);
    assert.ok(loadEqual(first.get("r1")!, some({ kw: 4.2, alarm: "ok" })) && loadEqual(first.get("r2")!, some({ kw: 9.9, alarm: "warm" })));
    assert.ok(loadEqual(first.get("r3")!, none), "a rack with no load reads none");
    assert.ok(!first.has("far") && !first.has("unplaced") && !first.has("gone"), "only the window's racks");
    // One request of the loads, naming the area index's runs: no key travels, pinned to both records' content.
    assert.equal(joins().length, 1, "every cell in one request");
    const body = JSON.parse(new TextDecoder().decode(joins()[0]!.body)) as { keys?: unknown; keysOf: { path: string; index: string; hash: string } };
    assert.equal(body.keys, undefined, "no key travels");
    assert.deepEqual([body.keysOf.path, body.keysOf.index, body.keysOf.hash, joins()[0]!.query.get("hash")],
        [".records.indexed_racks", "racks_by_area", R1, L1]);
    assert.equal(h.requests("read", `records.${loads.name}`).length, 0, "the loads are never read whole");
    // Read again, the runtime holds the answer: nothing is asked.
    assert.ok(recordSliceCellJoins(handle, "racks_by_area", row, dict).type === "some");
    assert.equal(joins().length, 1);

    // Another session loads r3: the next poll moves the loads, and the read asks again, pinned to their new content.
    await h.patch(loads, new Map([...await h.read(loads), ["r3", { kw: 3.0, alarm: "ok" }]]));
    const L2 = await hashOf(loads.path);
    clock.tickAll();
    await h.settle();
    const again = byKey(await h.ready(() => recordSliceCellJoins(handle, "racks_by_area", row, dict)));
    assert.ok(loadEqual(again.get("r3")!, some({ kw: 3.0, alarm: "ok" })), "r3's new load");
    assert.deepEqual(joins().slice(1).map((request) => request.query.get("hash")), [L2]);

    // The racks move under a read whose runs were found before: a commit no poll has reported. The read pinned to their old
    // content is refused, naming their new content; the runtime moves them there at once, and the read asks again there.
    // The far rack's window: a cell no read has joined yet (the row's racks and the one across the aisle share theirs).
    const distant = cellsOf({ minX: 39.5, minY: 39.5, maxX: 40.5, maxY: 40.5 });
    await h.ready(() => recordSliceCellRuns(handle, "racks_by_area", distant));
    const refused = h.e3.answers((request) => request.kind === "rows" && request.dataset === `records.${loads.name}`);
    await h.patch(racks, new Map([...await h.read(racks), ["r4", { hall: "B", x: some(2.1), y: some(3.5), w: 0.6, h: 1.2 }]]));
    const R2 = await hashOf(racks.path);
    const moved = byKey(await h.ready(() => recordSliceCellJoins(handle, "racks_by_area", distant, dict)));
    assert.ok(loadEqual(moved.get("far")!, some({ kw: 1.0, alarm: "ok" })), "the far rack's load, read by its runs at the racks' new content");
    assert.deepEqual(refused.map((answer) => answer.status), [409, 200], "refused at the old content, answered at the new");
    assert.ok(revisionEqual(handle.data.revision(), some(R2)), "the refusal moved the racks, with no poll");
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
    assert.equal(body.index, "by_skill");
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

test("which of a page's rows a narrowing holds, asked again at every read while its answer is on its way, prints the page's entries' keys once: each read asks the runtime of the same keys (#1398)", async () => {
    const { runtime } = newRuntime();
    // What every membership read asks the runtime of: the entries' keys, as the binding prints them.
    const withinAll = runtime.withinAll.bind(runtime);
    const asked: (readonly string[])[] = [];
    runtime.withinAll = (source, runs, keys) => { asked.push(keys); return withinAll(source, runs, keys); };
    StateRuntime.initializeStore(new UIStore());
    const handle = East.compile(sliceProgram, slicePlatform(runtime))();
    const where = handle.read().where;
    // Skill b's membership of the record's own first page, as the Sheet's lens asks it, the answer held on its way.
    const read = () => recordSliceWithinAt(handle, where, 0n, 3n);
    const held = h.e3.hold(request => request.kind === "within" && request.dataset === `records.${people.name}`);
    assert.equal((await h.inFlight(read, held)).type, "none", "its answer in flight");
    // Read again while it is on its way, as a lens does at every evaluation, and once it has landed.
    assert.equal(read().type, "none");
    assert.equal(read().type, "none");
    held.release();
    assert.deepEqual(await h.ready(read), [true, false, true], "Ada and Amy hold skill b; Abe holds none");
    assert.ok(asked.length >= 3, `asked at every read once the page had landed: ${asked.length}`);
    assert.equal(asked[0]!.length, 3, "Ada's two skills are two entries, Abe's none, Amy's one");
    assert.ok(asked.every(keys => Object.is(keys, asked[0])), "the same keys, printed once");
    runtime.clear();
});

test("a window over an interval index is two requests — its searches in one, the runs they select in one — and its count's readers re-fire once (#1351)", async () => {
    const events = ex.indexedIntervals;
    const source = Data.bindPaged(events, { indexes: ["by_start", "by_status_time", "by_time"] });
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
    for (const key of runtime.disableTracking().keys()) runtime.subscribe(key, reader);
    await h.settle();
    assert.equal(fired, 1, "the count's reader re-fires once, as every search lands together");
    const searches = findsOf(events);
    assert.deepEqual(searches.map(request => [request.method, request.query.get("index"), request.query.get("hash")]),
        [["POST", "by_status_time", R1]], "one request for the window's searches");
    assert.ok(searches[0]!.searches.length > 50, "the start range and the carry-in ranges at each span");
    assert.deepEqual(handle.count(), some(4n));
    const rows = await h.ready(() => handle.data.page(0n, 4n));
    assert.deepEqual(rows.map(row => row.key).sort(compareFor(StringType)), ["carry", "inside", "instant-at-from", "span"]);
    assert.deepEqual(h.requests("runs", `records.${events.name}`).map(request => [request.method, request.query.get("index"), request.query.get("hash")]),
        [["POST", "by_status_time", R1]], "one request for the runs the searches select");
    assert.deepEqual([pagesOf(events).length, findsOf(events).length], [0, 1], "no run is paged, and no search asked, on its own");
    runtime.clear();
});

// ── Beside a nested series index (#1435) ─────────────────────────────────────

const machines = nx.nestedMachines;
type Machine = ValueTypeOf<typeof nx.NestedMachine>;
const machinesBinding = Data.bindPaged(machines, { indexes: ["machines_by_site_status", "machines_in_time"] });
const machinesProgram = East.function([], Expr.type(machinesBinding), $ => $.return(machinesBinding));
const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);
const machineEqual = equalFor(nx.NestedMachine);
const printString = printFor(StringType);
const printInstant = printFor(DateTimeType);
const printPath = printFor(RecordNestedPathType);
const printRun = printFor(RecordNestedRunType);
const printLevel = printFor(RecordLevelType);
/** Monday 5 October 2026, the machines' week, and the Monday after it. */
const WEEK = new Date(Date.UTC(2026, 9, 5));
const NEXT_WEEK = new Date(Date.UTC(2026, 9, 12));
const DAY_MS = 86_400_000;

/** A machine as the record's other indexes carry it beside its nested series index: each collection it files, empty. */
function leanOf(machine: Machine): Machine {
    return {
        ...machine, jobs: new SortedMap(undefined, keyOrder), stops: new SortedMap(undefined, keyOrder), alarms: new SortedMap(undefined, keyOrder),
        load: new SortedMap(undefined, instantOrder), output: new SortedMap(undefined, instantOrder),
    };
}

/** A place, or a node's path, as a nested key holds it: its names, folded from the last. */
function pathOf(names: readonly string[]): RecordNestedPath {
    return names.reduceRight<RecordNestedPath>((rest, key) => variant("step", { key, rest }), variant("end", null));
}

/** A search over one run of a nested index at one level (#1433, #1434): its tiles from `from` to before `to`. */
function nestedRange(collection: readonly string[], row: string, path: readonly string[], run: RecordNestedRun, level: RecordLevel["type"], from: Date, to: Date) {
    const lead = [printPath(pathOf(collection)), printString(row), printPath(pathOf(path)), printRun(run), printLevel(variant(level, null))];
    return variant("range", { from: [...lead, printInstant(from)], to: [...lead, printInstant(to)] });
}

test("beside a nested series index, a window of two hundred machines through another index is one request, joins none, and carries each machine without its collections (#1435)", async () => {
    const stored = await h.read(machines);
    const { runtime } = newRuntime();
    const handle = East.compile(machinesProgram, platform(runtime))();
    assert.deepEqual([handle.joined, handle.defaultIndex], [false, "machines_by_site_status"], "never joined; the unfiltered view pages the machines");
    const window = await h.ready(() => handle.page("machines_by_site_status", 0n, 200n));
    assert.equal(window.length, nx.MACHINE_COUNT);
    assert.deepEqual(pagesOf(machines).map(request => [request.query.get("index"), request.query.has("join"), request.query.get("limit")]),
        [["machines_by_site_status", false, "200"]], "one request through the index, joining none");
    const ordered = [...stored].sort(([ka, a], [kb, b]) => keyOrder(a.site, b.site) || keyOrder(a.status, b.status) || keyOrder(ka, kb)).map(([key]) => key);
    assert.deepEqual(window.map(entry => entry.key), ordered, "in the index's order: by site, then state");
    for (const entry of window) {
        const lean = leanOf(stored.get(entry.key)!);
        assert.ok(entry.value.type === "some" && machineEqual(entry.value.value, lean), `${entry.key} carries its lean row as its value`);
        assert.ok(entry.row.type === "some" && machineEqual(entry.row.value, lean), `${entry.key} carries its lean row as its row`);
    }
    assert.equal(await h.ready(() => handle.total("primary")), 200n, "counted through the index paging the machines");
    assert.ok(pagesOf(machines).every(request => request.query.get("index") === "machines_by_site_status" && !request.query.has("join")),
        "no page of the record's own rows");
    runtime.clear();
});

test("the nested index's cells — a block of machines' jobs at a level, a ledger's subtotals, a part's subtree — are read by their searches in one request and their runs in one more, never paged (#1435)", async () => {
    const stored = await h.read(machines);
    const { runtime } = newRuntime();
    const handle = East.compile(machinesProgram, platform(runtime))();
    const reads = recordSliceBatchesOf(handle)!;
    const R1 = await h.ready(() => handle.revision());
    // Five machines' jobs in the week, a range a machine: each one's 8- and 30-hour jobs; its 40-day one is filed at the quarter.
    const block = ["M-000", "M-001", "M-002", "M-003", "M-004"];
    const found = await h.ready(() => reads.seekAll("machines_in_time",
        block.map(row => nestedRange(["jobs"], row, [], variant("items", null), "week", WEEK, NEXT_WEEK))));
    const entries = await h.ready(() => reads.runsAll("machines_in_time", found));
    const expected = block.flatMap(row => [...stored.get(row)!.jobs].filter(([id]) => !id.endsWith("-c")).map(([id, job]) => ({ row, id, job })));
    const entryEqual = equalFor(OptionType(nx.nestedMachines.indexes.machines_in_time.valueType));
    assert.deepEqual(entries.map(entry => entry.key), expected.map(({ row }) => row));
    for (const [i, { id, job }] of expected.entries()) {
        const entry = entries[i]!;
        const value = entry.value!;
        assert.ok(isValueOf(value, OptionType(nx.nestedMachines.indexes.machines_in_time.valueType)) && entryEqual(value as Parameters<typeof entryEqual>[0], some(variant("item", variant("jobs", job)))), `${id} carried whole`);
        assert.deepEqual(entry.row, none, `${id} names its machine, and carries no row`);
    }
    assert.deepEqual(h.requests("find", `records.${machines.name}`).map(request => [request.method, request.query.get("index"), request.query.get("hash"), request.searches.length]),
        [["POST", "machines_in_time", R1, block.length]], "every search in one request");
    assert.deepEqual(h.requests("runs", `records.${machines.name}`).map(request => [request.method, request.query.get("index"), request.query.has("join")]),
        [["POST", "machines_in_time", false]], "the runs they select in one more, joining none");
    assert.equal(pagesOf(machines).length, 0, "nothing paged");
    // A ledger's subtotals of its measures' readings over two weeks: each week, the sum of each measure's sum.
    const ledgers = Data.bindPaged(nx.nestedLedgers, { indexes: ["ledgers_by_name", "ledgers_in_time"] });
    const ledgerReads = recordSliceBatchesOf(East.compile(East.function([], Expr.type(ledgers), $ => $.return(ledgers)), platform(runtime))())!;
    const SUM = variant("subtotals", { fold: variant("sum", null), aggregate: variant("sum", null) });
    const weeks = [WEEK, NEXT_WEEK];
    const sought = await h.ready(() => ledgerReads.seekAll("ledgers_in_time",
        [nestedRange(["measures", "readings"], "L-1", [], SUM, "week", WEEK, new Date(NEXT_WEEK.getTime() + 7 * DAY_MS))]));
    const subtotals = await h.ready(() => ledgerReads.runsAll("ledgers_in_time", sought));
    const ledger = (await h.read(nx.nestedLedgers)).get("L-1")!;
    const sums = weeks.map(week => [...ledger.measures.values()].reduce((sum, measure) => sum + [...measure.readings]
        .filter(([at]) => instantOrder(at, week) >= 0 && at.getTime() < week.getTime() + 7 * DAY_MS).reduce((own, [, reading]) => own + reading, 0), 0));
    const subtotalEqual = equalFor(OptionType(nx.nestedLedgers.indexes.ledgers_in_time.valueType));
    assert.equal(subtotals.length, weeks.length, "a subtotal a week");
    for (const [i, entry] of subtotals.entries()) {
        const value = entry.value!;
        assert.ok(isValueOf(value, OptionType(nx.nestedLedgers.indexes.ledgers_in_time.valueType)) && subtotalEqual(value as Parameters<typeof subtotalEqual>[0], some(variant("subtotal", sums[i]!))),
            `the week of ${printInstant(weeks[i]!)}: the measures' sums' sum, ${sums[i]}`);
    }
    // A part's subtree: the jobs of the parts beneath the frame, each by its path below it.
    const assemblies = Data.bindPaged(nx.nestedAssemblies, { indexes: ["assemblies_by_name", "assemblies_in_time"] });
    const assemblyReads = recordSliceBatchesOf(East.compile(East.function([], Expr.type(assemblies), $ => $.return(assemblies)), platform(runtime))())!;
    const beneath = await h.ready(() => assemblyReads.seekAll("assemblies_in_time",
        [nestedRange(["parts", "jobs"], "A-1", ["frame"], variant("subtree", null), "week", WEEK, NEXT_WEEK)]));
    const subtree = await h.ready(() => assemblyReads.runsAll("assemblies_in_time", beneath));
    const printKey = printFor(nx.nestedAssemblies.indexes.assemblies_in_time.keyType);
    assert.deepEqual(subtree.map(entry => printKey(entry.ik.value as never)), [
        subtreeKey(["motor"], "wind"), subtreeKey(["motor", "rotor"], "turn"),
    ].map(key => printKey(key as never)), "the motor's job and the rotor's, under the frame, by their paths beneath it");
    runtime.clear();
});

/** An entry of the frame's subtree in the machines' week (#1434): a descendant's job, by its path beneath the frame. */
function subtreeKey(beneath: readonly string[], id: string) {
    return {
        collection: pathOf(["parts", "jobs"]), row: "A-1", path: pathOf(["frame"]), run: variant("subtree", null), level: variant("week", null), tile: WEEK,
        item: variant("under", { path: pathOf(beneath), id }),
    };
}

test("a machine is read whole by its key beside a nested series index, and the nested index refuses a page, a count, a placement and a membership read, in its words (#1435)", async () => {
    const stored = await h.read(machines);
    const { runtime } = newRuntime();
    const handle = East.compile(machinesProgram, platform(runtime))();
    const reads = recordSliceBatchesOf(handle)!;
    const rows = await h.ready(() => reads.rowsAll(["M-007", "M-404"]));
    assert.ok(rows[0]!.type === "some" && machineEqual(rows[0]!.value as Machine, stored.get("M-007")!), "M-007 whole, its collections with it");
    assert.equal(rows[1]!.type, "none", "a key the record does not hold");
    const refusal = { message: `Data.bindPaged: '${"machines_in_time"}' is a nested series index, whose entries are items, totals and subtotals: a reader reads its cells` };
    assert.throws(() => handle.page("machines_in_time", 0n, 10n), refusal);
    assert.throws(() => handle.total("machines_in_time"), refusal);
    assert.throws(() => reads.placeAll("machines_in_time", [{ found: true, row: 0n, count: 1n }]), refusal);
    assert.throws(() => reads.withinAll("machines_in_time", [{ found: true, row: 0n, count: 1n }], []), refusal);
    assert.equal(pagesOf(machines).length, 0, "nothing paged");
    runtime.clear();
});

test("a record Slice over the machines carries its binding's index metadata and nested part on its handle, through encode and decode (#1435)", async () => {
    const { runtime } = newRuntime();
    StateRuntime.initializeStore(new UIStore());
    const binding = East.compile(machinesProgram, platform(runtime))();
    const sliced = bindRecord("test.machines", machinesBinding, { fields: { site: { label: "Site", hints: [...nx.SITES] } } });
    const Sliced = Expr.type(sliced);
    const handle = East.compile(East.function([], Sliced, $ => $.return(sliced)), slicePlatform(runtime))();
    const nestedEqual = equalFor(Expr.type(machinesBinding).fields.nested);
    const indexesEqual = equalFor(Expr.type(machinesBinding).fields.indexes);
    assert.ok(nestedEqual(handle.nested, binding.nested), "the nested part, as the binding gives it");
    assert.ok(indexesEqual(handle.indexes, binding.indexes), "each index's metadata, as the binding gives it");
    assert.deepEqual(handle.config.indexes.map(index => index.name), ["machines_by_site_status"], "the rail plans through no part of the nested index");
    const decoded = decodeBeast2For(Sliced, { platform: slicePlatform(runtime) })(encodeBeast2For(Sliced)(handle));
    assert.ok(nestedEqual(decoded.nested, binding.nested) && indexesEqual(decoded.indexes, binding.indexes), "carried through encode and decode");
    const rows = await h.ready(() => handle.data.page(0n, 3n));
    assert.ok(rows.every(entry => entry.row.type === "some" && entry.row.value.jobs.size === 0), "the narrowed rows lean");
    runtime.clear();
});

test("a component given the binding as its rows pages its unfiltered view: lean machines in its default index's order, joining none (#1435)", async () => {
    const stored = await h.read(machines);
    const { runtime } = newRuntime();
    const resolved = resolveRowSource(machinesBinding, "Rows") as Extract<ResolvedRowSource, { kind: "ordered" }>;
    assert.deepEqual([resolved.kind, resolved.pinned, resolved.query], ["ordered", true, false]);
    const Window = OptionType(resolved.collectionType);
    const source = resolved.source as unknown as { page(offset: bigint, limit: bigint): Expr };
    const page = East.compile(East.function([], Window, $ => $.return(source.page(0n, 4n) as never)), platform(runtime));
    const window = await h.ready(() => page() as never) as { key: string; value: { type: string; value: Machine }; row: { type: string; value: Machine } }[];
    const ordered = [...stored].sort(([ka, a], [kb, b]) => keyOrder(a.site, b.site) || keyOrder(a.status, b.status) || keyOrder(ka, kb)).map(([key]) => key);
    assert.deepEqual(window.map(entry => entry.key), ordered.slice(0, 4), "the default index's order");
    for (const entry of window) assert.ok(entry.row.type === "some" && machineEqual(entry.row.value, leanOf(stored.get(entry.key)!)), `${entry.key} lean`);
    assert.deepEqual(pagesOf(machines).map(request => [request.query.get("index"), request.query.has("join")]), [["machines_by_site_status", false]]);
    runtime.clear();
});

