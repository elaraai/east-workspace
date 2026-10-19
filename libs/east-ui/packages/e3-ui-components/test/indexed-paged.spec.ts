/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, Expr, NullType, SetType, StringType, StructType, printFor,
    decodeBeast2For, encodeBeast2For, equalFor, compareFor, parseFor, OptionType, none, some, variant, type option,
} from "@elaraai/east";
import { RecordSliceWhereType, bindRecord } from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import * as e3 from "@elaraai/e3";
import { Data, deriveManifest } from "@elaraai/e3-ui/internal";
import { indexWindowType } from "@elaraai/e3-types";
import { PagedRuntime, type PagedApi, type PagedWindow } from "../src/platform/paged-runtime.js";
import { ReactiveDatasetCache, type DatasetApi } from "../src/platform/index.js";
import { recordPaging } from "../src/platform/record-paging.test-utils.js";

const Person = StructType({ name: StringType, skills: SetType(StringType) });
const People = DictType(StringType, Person);
const people = e3.record("indexed_people", People, new Map());
const byName = e3.recordIndex("by_name", people, { on: ["name"] });
const bySkill = e3.recordIndex("by_skill", people, { on: ["skills"] });
const binding = Data.bindPaged(people, { indexes: [byName, bySkill] });
const Binding = Expr.type(binding);
const program = East.function([], Binding, $ => $.return(binding));
const coverBinding = Data.bindPaged(people, { indexes: [byName, bySkill], join: false });
const coverProgram = East.function([], Expr.type(coverBinding), $ => $.return(coverBinding));
const indexRows = indexWindowType(StringType, StringType, NullType, Person);
const stringEqual = equalFor(StringType);
const revisionEqual = equalFor(OptionType(StringType));
const printWhere = printFor(RecordSliceWhereType);
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function ready<T>(read: () => option<T>): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const value = read();
        if (value.type === "some") return value.value;
        await settle();
    }
    assert.fail("bounded fixture read did not settle");
}

function server(marker: string) {
    let revision = marker;
    let watch: ((hash: string | null) => void) | undefined;
    const requests: PagedWindow[] = [];
    const seeks: unknown[] = [];
    const api: PagedApi = {
        async getRevision() { return revision; },
        watchRevision(_ws, _path, callback) { watch = callback; return () => { watch = undefined; }; },
        async getPage(_ws, _path, window) {
            requests.push(window);
            const all = new Map([
                ["p1", { name: `${revision} Ada`, skills: new Set(["a", "b"]) }],
                ["p2", { name: `${revision} Bea`, skills: new Set<string>() }],
                ["p3", { name: `${revision} Cal`, skills: new Set(["b"]) }],
            ]);
            const entries = [...all];
            const indexed = entries.flatMap(([key, row]) => (window.index === "by_skill" ? [...row.skills] : [row.name])
                .map(ik => ({ ik, key, value: null, row: window.join ? some(row) : none })))
                .sort((a, b) => compareFor(StringType)(a.ik, b.ik) || compareFor(StringType)(a.key, b.key));
            const total = window.index === undefined ? entries.length : indexed.length;
            const slice = window.index === undefined
                ? new Map(entries.slice(window.offset, window.offset + window.limit))
                : indexed.slice(window.offset, window.offset + window.limit);
            const data = window.index === undefined
                ? encodeBeast2For(People)(slice as never)
                : encodeBeast2For(indexRows)(slice as never);
            return { data, totalElements: total, totalExact: true, totalBytes: data.length,
                segmentCount: 1, offset: window.offset, count: Math.max(0, Math.min(window.limit, total - window.offset)), hash: revision };
        },
        async findKey(_ws, _path, query) {
            seeks.push(query);
            const keys = query.index === "by_skill" ? ["a", "b", "b"]
                : query.index === "by_name" ? [`${revision} Ada`, `${revision} Bea`, `${revision} Cal`] : ["p1", "p2", "p3"];
            let text: string;
            if ("key" in query) {
                const parsed = parseFor(StringType)(query.key);
                assert.ok(parsed.success);
                text = parsed.value;
            } else { assert.ok("prefix" in query && query.prefix !== undefined); text = query.prefix; }
            const row = keys.findIndex(key => compareFor(StringType)(key, text) >= 0);
            const count = keys.filter(key => "key" in query ? compareFor(StringType)(key, text) === 0 : key.startsWith(text)).length;
            return { found: count > 0, row: row < 0 ? keys.length : row, count, hash: revision };
        },
    };
    return { api, requests, seeks, move(hash: string) { revision = hash; watch?.(hash); } };
}

function platform(runtime: PagedRuntime) {
    return [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
}

test("indexed binding survives serialization, scopes reads, and follows the decoder's revision", async () => {
    const encoding = new PagedRuntime();
    const handle = East.compile(program, platform(encoding))();
    const bytes = encodeBeast2For(Binding)(handle);
    const runtime = new PagedRuntime();
    const service = server("B");
    runtime.initialize(service.api, "ws");
    const decoded = decodeBeast2For(Binding, { platform: platform(runtime) })(bytes);
    assert.equal(decoded.recordId, people.name);
    assert.deepEqual(deriveManifest(program), { paths: [], functions: [], records: [], pages: [people.path] });
    assert.throws(() => East.compile(program, runtime.indexed.platform(new Set()))(), /not declared in manifest/);
    assert.equal(decoded.defaultIndex, "primary");
    assert.equal(decoded.page("primary", 0n, 3n).type, "none");
    const primary = await ready(() => decoded.page("primary", 0n, 3n));
    assert.deepEqual(primary.map(row => row.key), ["p1", "p2", "p3"], "a row with no skills remains present once");
    assert.ok(equalFor(OptionType(Person))(primary[1]!.row, some({ name: "B Bea", skills: new Set() })));
    assert.deepEqual(primary[0]!.value, none);
    assert.deepEqual(decoded.total("primary"), some(3n));
    const index = await ready(() => decoded.page("by_skill", 1n, 2n));
    assert.deepEqual(index.map(row => [row.ik, row.key]), [[variant("by_skill", "b"), "p1"], [variant("by_skill", "b"), "p3"]]);
    assert.deepEqual(index[0]!.value, some(null));
    assert.deepEqual(await ready(() => decoded.seek("by_skill", variant("key", '"b"'))),
        { found: true, row: 1n, count: 2n });
    assert.deepEqual(service.seeks, [{ index: "by_skill", key: '"b"', hash: "B" }]);
    assert.throws(() => decoded.page("undeclared", 0n, 1n), /not declared/);
    const requests = service.requests.length;
    const repeated = decoded.page("by_skill", 1n, 2n);
    assert.equal(repeated.type === "some" && repeated.value, index, "unchanged pages preserve identity for renderer memoization");
    assert.equal(service.requests.length, requests, "repeat reads use the existing page cache");
    service.move("C");
    assert.deepEqual(decoded.revision(), some("C"));
    assert.equal(decoded.page("primary", 0n, 3n).type, "none", "no old revision's rows are returned as current");
    const next = await ready(() => decoded.page("primary", 0n, 3n));
    assert.ok(equalFor(OptionType(Person))(next[1]!.row, some({ name: "C Bea", skills: new Set() })));
    assert.equal(service.requests.at(-1)?.hash, "C");
    runtime.clear();
});

test("covering-only binding reads and counts without primary segments; unsupported declarations fail early", async () => {
    const runtime = new PagedRuntime();
    const service = server("cover");
    runtime.initialize(service.api, "ws");
    const handle = East.compile(coverProgram, platform(runtime))();
    assert.equal(handle.defaultIndex, "by_name");
    assert.deepEqual(await ready(() => handle.total("primary")), 3n);
    const window = await ready(() => handle.page(handle.defaultIndex, 0n, 2n));
    assert.deepEqual(window.map(row => row.row), [none, none]);
    assert.ok(service.requests.every(request => request.index === "by_name" && request.join === false));
    assert.ok(service.requests.every(request => request.limit <= 2), "counting does not walk the record");
    assert.throws(() => Data.bindPaged(people, { indexes: [bySkill], join: false }), /without Set fields/);
    assert.throws(() => Data.bindPaged(people, { indexes: [] }), /at least one/);
    assert.throws(() => Data.bindPaged(people, { indexes: [byName, byName] }), /repeated index/);
    const computed = e3.recordIndex("computed_name", people, { key: East.function([StringType, Person], StringType, (_$, _k, person) => person.name) });
    assert.doesNotThrow(() => bindRecord("computed", Data.bindPaged(people, { indexes: [computed] }), { search: "computed_name" }));
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
    const runtime = new PagedRuntime();
    const service = server("A");
    runtime.initialize(service.api, "ws");
    StateRuntime.initializeStore(new UIStore());
    const implementations = slicePlatform(runtime);
    const create = East.compile(sliceProgram, implementations);
    const handle = create();
    assert.equal(handle.sourceId, people.name, "editing identity is the primary record, independent of index selection");
    const otherSource = Data.bindPaged(people, { indexes: [byName] });
    const otherSlice = bindRecord("test.names", otherSource, { search: "name" });
    const otherHandle = East.compile(East.function([], Expr.type(otherSlice), () => otherSlice), implementations)();
    assert.equal(otherHandle.sourceId, handle.sourceId, "different index lists share the record's save gate");
    assert.equal(await ready(() => handle.count()), 2n);
    assert.equal(await ready(() => handle.total()), 3n);
    assert.equal(await ready(() => handle.countWhere(new Map([["skills", variant("values", ['"a"'])]]))), 1n);
    assert.equal(await ready(() => handle.count()), 2n, "counting a saved query never changes the current narrowing");
    assert.deepEqual((await ready(() => handle.data.page(0n, 10n))).map(row => row.key), ["p1", "p3"]);
    assert.deepEqual(handle.config.fields.map(field => [field.fieldId, field.kind, field.set]), [["name", "string", false], ["skills", "string", true]]);
    const bytes = encodeBeast2For(Narrowed)(handle);
    assert.equal(handle.readEntry("p2").type, "none", "an unloaded primary read remains pending");
    const outside = await ready(() => handle.readEntry("p2"));
    assert.equal(outside.type, "some", "a filtered-out row is not a deletion");
    assert.ok(outside.type === "some" && equalFor(Person)(decodeBeast2For(Person)(outside.value), { name: "A Bea", skills: new Set() }));
    assert.deepEqual(await ready(() => handle.readEntry("missing")), none, "absence needs a confirmed primary seek");
    assert.ok(service.requests.filter(request => request.index === undefined).every(request => request.limit === 1), "confirmation reads one entry, never the whole record");
    const captured = handle.read().where;
    assert.equal(await ready(() => handle.contains(captured, "p1")), true, "membership includes a Set row once regardless of its other keys");
    assert.equal(await ready(() => handle.contains(captured, "p2")), false, "a present row outside the query is distinguished from a missing page");
    assert.equal(await ready(() => handle.contains(captured, "p3")), true, "membership does not depend on a resident page");
    assert.equal(await ready(() => handle.contains(captured, "missing")), false);
    assert.ok(stringEqual(handle.data.query(), printWhere(captured)), "`query` names the narrowing the rows serve");
    handle.choose("skills", ['"a"']);
    const changed = create();
    assert.equal(changed, handle, "the bind returns its binding's one handle, whatever the narrowing (#1354)");
    assert.ok(stringEqual(handle.data.query(), printWhere(handle.read().where)), "`query` moves with the narrowing");
    assert.ok(!stringEqual(handle.data.query(), printWhere(captured)));
    assert.deepEqual((await ready(() => handle.data.page(0n, 10n))).map(row => row.key), ["p1"], "a handle bound before the choice reads the narrowing as it stands");
    assert.ok(revisionEqual(handle.data.revision(), some("A")), "a narrowing never moves the revision a Save confirms against");
    assert.equal(changed.read().where.get("skills")?.type, "values");
    assert.throws(() => changed.choose("skills", ['"a"', '"b"']), /Choose one/);
    assert.throws(() => changed.prefix("skills", "b"), /exact value/);
    changed.prefix("name", "A B");
    const names = create();
    assert.deepEqual([...names.read().where.keys()], ["name"], "an incompatible choice replaces the old narrowing");
    assert.deepEqual((await ready(() => names.data.page(0n, 10n))).map(row => row.key), ["p2"]);
    changed.clearAll();
    const all = create();
    assert.deepEqual((await ready(() => all.data.page(0n, 10n))).map(row => row.key), ["p1", "p2", "p3"], "clearing includes empty Set rows exactly once");
    const suggestions = await ready(() => all.suggest("name", "A"));
    assert.deepEqual(suggestions.map(value => value.label), ["A Ada", "A Bea", "A Cal"]);
    assert.deepEqual(suggestions.map(value => value.count), [some(1n), some(1n), some(1n)]);
    const another = new PagedRuntime();
    const otherService = server("B");
    another.initialize(otherService.api, "ws");
    StateRuntime.initializeStore(new UIStore());
    const decoded = decodeBeast2For(Narrowed, { platform: slicePlatform(another) })(bytes);
    assert.ok(stringEqual(decoded.data.id, handle.data.id), "the source's id names no narrowing, so a payload written under one serves under every other");
    // The decoder's store is seeded from the declared initial narrowing, and
    // the decoded source reads it there, never the narrowing it was encoded under.
    const rows = await ready(() => decoded.data.page(0n, 10n));
    assert.deepEqual(rows.map(row => row.key), ["p1", "p3"]);
    assert.deepEqual(rows.map(row => row.row.type === "some" ? row.row.value.name : ""), ["B Ada", "B Cal"]);
    assert.deepEqual(await ready(() => decoded.data.revision()), "B");
    decoded.choose("skills", ['"a"']);
    assert.ok(stringEqual(decoded.data.query(), printWhere(decoded.read().where)));
    assert.deepEqual((await ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["p1"], "a decoded source reads the decoder's narrowing as it stands");
    assert.ok(revisionEqual(decoded.data.revision(), some("B")));
    const confirmed = await ready(() => decoded.readEntry("p2"));
    assert.ok(confirmed.type === "some" && equalFor(Person)(decodeBeast2For(Person)(confirmed.value), { name: "B Bea", skills: new Set() }), "decoded confirmation uses the new host");
    assert.equal(decoded.sourceId, handle.sourceId, "narrowing does not change editing identity");
    assert.equal(await ready(() => decoded.countWhere(new Map([["name", variant("prefix", "B B")]]))), 1n,
        "saved-query counts survive serialization and use the decoder's data");
    assert.equal(await ready(() => decoded.contains(decoded.read().where, "p1")), true, "membership survives serialization");
    decoded.togglePreset("a");
    assert.equal(await ready(() => decoded.count()), 1n);
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
    const Event = StructType({ status: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
    const Events = DictType(StringType, Event);
    const event = (start: Date | null, end: Date | null, status = "Ready") => ({
        status, start: start === null ? none : some(start), end: end === null ? none : some(end),
    });
    const rows = new Map([
        ["backlog", event(null, null)],
        ["carry", event(new Date("2026-10-01T22:00:00Z"), new Date("2026-10-02T06:00:00Z"))],
        ["span", event(new Date("2025-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"))],
        ["inside", event(new Date("2026-10-02T10:00:00Z"), new Date("2026-10-02T11:00:00Z"))],
        ["ends-at-from", event(new Date("2026-10-01T12:00:00Z"), new Date("2026-10-02T00:00:00Z"))],
        ["starts-at-to", event(new Date("2026-10-03T00:00:00Z"), new Date("2026-10-03T01:00:00Z"))],
        ["instant-at-from", event(new Date("2026-10-02T00:00:00Z"), null)],
        ["instant-at-to", event(new Date("2026-10-03T00:00:00Z"), null)],
        ["cancelled", event(new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), "Cancelled")],
    ]);
    const events = e3.record("indexed_intervals", Events, rows);
    // Put the scalar path first: a declared overlap field must never silently
    // choose start-only filtering because that index was listed first.
    const byStart = e3.recordIndex("by_start", events, { on: ["start"] });
    const byStatusTime = e3.recordIndex("by_status_time", events, { on: ["status"], interval: { from: "start", to: "end" } });
    const byTime = e3.recordIndex("by_time", events, { interval: { from: "start", to: "end" } });
    const source = Data.bindPaged(events, { indexes: [byStart, byStatusTime, byTime] });
    const from = new Date("2026-10-02T00:00:00Z");
    const to = new Date("2026-10-03T00:00:00Z");
    const sliced = bindRecord("test.intervals", source, { range: "start", initial: { status: ["Ready"], start: { from, to } } });
    const program = East.function([], Expr.type(sliced), $ => $.return(sliced));
    let wholeReads = 0;
    const api: DatasetApi = {
        async get() { wholeReads++; throw new Error("No whole record reads"); }, async set() {},
        async launchDataflow() {}, async listRoot() { return []; }, async listAt() { return []; }, async workspaceStatus() { return { datasets: [] }; },
    };
    const cache = new ReactiveDatasetCache({ workspace: "overlap" }, api);
    const bytes = encodeBeast2For(Events)(rows);
    const service = recordPaging(cache, () => bytes, [{ path: events.path, type: Events,
        indexes: [byStart, byStatusTime, byTime].map(index => {
            const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
            return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => index.multi ? keys(key, row) as Iterable<unknown> : [keys(key, row)] };
        }),
    }]);
    const runtime = new PagedRuntime();
    runtime.initialize(service.api, "overlap");
    StateRuntime.initializeStore(new UIStore());
    const implementations = slicePlatform(runtime);
    const create = East.compile(program, implementations);
    const handle = create();
    assert.equal(await ready(() => handle.count()), 4n);
    assert.equal(service.requests.filter(request => request.includes(" page ")).length, 0, "counts use bounds alone");
    const first = await ready(() => handle.data.page(0n, 2n));
    const next = await ready(() => handle.data.page(2n, 2n));
    const keys = [...first, ...next].map(row => row.key).sort(compareFor(StringType));
    assert.deepEqual(keys, ["carry", "inside", "instant-at-from", "span"]);
    assert.ok([...first, ...next].every(row => row.row.type === "some"));
    const captured = handle.read().where;
    for (const key of rows.keys()) {
        assert.equal(await ready(() => handle.contains(captured, key)), keys.includes(key), `indexed membership preserves overlap for ${key}`);
    }
    const print = printFor(OptionType(DateTimeType));
    assert.deepEqual(await ready(() => handle.domain("start")), {
        from: print(rows.get("span")!.start), to: print(rows.get("starts-at-to")!.start),
    }, "range domain skips Unset and internal carry-in entries");
    assert.equal(await ready(() => handle.total()), 9n);
    handle.clear("status");
    handle.range("start", print(some(from)), print(some(to)));
    const allStatuses = create();
    assert.equal(await ready(() => allStatuses.count()), 5n, "an unprefixed overlap still includes carry-in");
    assert.ok(service.requests.some(request => request.includes("index by_time seek")));
    handle.choose("start", [print(none)]);
    const backlog = create();
    assert.equal(await ready(() => backlog.count()), 1n);
    assert.deepEqual((await ready(() => backlog.data.page(0n, 2n))).map(row => row.key), ["backlog"]);
    assert.equal(wholeReads, 0);
    runtime.clear();
});
