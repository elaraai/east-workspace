/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Slice.bindRecords` over two real records (#1336): its parts are ordinary
 * record Slices under their own keys, a choice in one never reaches another,
 * its presets and Clear all are East functions over its parts, and it reads
 * each record through its indexes only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, Expr, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type option,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { RecordSliceStateType, RecordSlicesChromeType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import * as e3 from "@elaraai/e3";
import { Data } from "@elaraai/e3-ui/internal";
import { PagedRuntime } from "../src/platform/paged-runtime.js";
import { ReactiveDatasetCache, type DatasetApi } from "../src/platform/index.js";
import { pathText, recordPaging } from "../src/platform/record-paging.test-utils.js";

const Bay = StructType({ name: StringType, area: StringType, minute: IntegerType });
const Bays = DictType(StringType, Bay);
const Kiln = StructType({ name: StringType, group: StringType });
const Kilns = DictType(StringType, Kiln);
const bays = e3.record("sources_bays", Bays, new Map());
const baysByArea = e3.recordIndex("sources_bays_by_area", bays, { on: ["area"] });
const kilns = e3.record("sources_kilns", Kilns, new Map());
const kilnsByGroup = e3.recordIndex("sources_kilns_by_group", kilns, { on: ["group"] });
const bayRows = new Map([
    ["B-1", { name: "B-1", area: "North", minute: 15n }],
    ["B-2", { name: "B-2", area: "North", minute: 35n }],
    ["B-3", { name: "B-3", area: "South", minute: 55n }],
]);
const kilnRows = new Map([
    ["K-1", { name: "K-1", group: "A" }], ["K-2", { name: "K-2", group: "A" }],
    ["K-3", { name: "K-3", group: "B" }], ["K-4", { name: "K-4", group: "C" }],
]);

const yard = Slice.bindRecords("test.yard", {
    lanes: { source: Data.bindPaged(bays, { indexes: [baysByArea] }), fields: { area: { label: "Area" } } },
    resources: { source: Data.bindPaged(kilns, { indexes: [kilnsByGroup] }), fields: { group: { label: "Group", hints: ["A", "B", "C"] } } },
}, {
    presets: [
        { id: "north", name: "North, group A", where: { lanes: { area: ["North"] }, resources: { group: ["A"] } } },
        { id: "a", name: "Group A", where: { resources: { group: ["A"] } } },
    ],
});
const Yard = Expr.type(yard);
const program = East.function([], Yard, $ => $.return(yard));
const resources = East.function([], Expr.type(Slice.rows(yard, "resources")), $ => $.return(Slice.rows(yard, "resources")));
const chrome = East.function([], RecordSlicesChromeType, $ => $.return(recordSlicesChrome({ slice: yard })));
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function ready<T>(read: () => option<T>): Promise<T> {
    for (let attempt = 0; attempt < 12; attempt++) {
        const value = read();
        if (value.type === "some") return value.value;
        await settle();
    }
    assert.fail("bounded fixture read did not settle");
}

/** Both records served a window at a time through their declared indexes; a whole read fails. */
function host() {
    let whole = 0;
    const api: DatasetApi = {
        async get() { whole++; throw new Error("No whole record reads"); }, async set() {},
        async launchDataflow() {}, async listRoot() { return []; }, async listAt() { return []; }, async workspaceStatus() { return { datasets: [] }; },
    };
    const cache = new ReactiveDatasetCache({ workspace: "yard" }, api);
    const bytes = new Map([[pathText(bays.path), encodeBeast2For(Bays)(bayRows)], [pathText(kilns.path), encodeBeast2For(Kilns)(kilnRows)]]);
    const spec = (index: typeof baysByArea | typeof kilnsByGroup) => {
        const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
        return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => index.multi ? keys(key, row) as Iterable<unknown> : [keys(key, row)] };
    };
    const service = recordPaging(cache, (_ws, path) => bytes.get(pathText(path)), [
        { path: bays.path, type: Bays, indexes: [spec(baysByArea)] },
        { path: kilns.path, type: Kilns, indexes: [spec(kilnsByGroup)] },
    ]);
    const runtime = new PagedRuntime();
    runtime.initialize(service.api, "yard");
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const implementations = [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return { store, runtime, service, implementations, wholeReads: () => whole, create: East.compile(program, implementations) };
}

test("its parts are record Slices under `${key}.${source}`, in source order, each read alone with Slice.rows(slice, source)", async () => {
    const h = host();
    const slice = h.create();
    assert.equal(slice.key, "test.yard");
    assert.deepEqual(slice.parts.map(part => [part.source, part.slice.key]), [["lanes", "test.yard.lanes"], ["resources", "test.yard.resources"]]);
    assert.deepEqual(slice.presets, [{ id: "north", name: "North, group A" }, { id: "a", name: "Group A" }]);
    assert.deepEqual(slice.parts.map(part => part.slice.config.fields.map(field => field.fieldId)), [["area"], ["group"]]);
    assert.deepEqual(slice.parts.map(part => part.slice.sourceId), [bays.name, kilns.name], "each part's editing identity is its own record");
    assert.deepEqual((await ready(() => slice.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-1", "B-2", "B-3"]);
    const rows = East.compile(resources, h.implementations)();
    assert.deepEqual((await ready(() => rows.page(0n, 10n))).map(row => row.key), ["K-1", "K-2", "K-3", "K-4"]);
    assert.equal(h.wholeReads(), 0);
    h.runtime.clear();
});

test("a choice in one source leaves the other's stored state and counts exactly as they were", async () => {
    const h = host();
    const slice = h.create();
    const [lanes, kilnPart] = slice.parts.map(part => part.slice);
    assert.equal(await ready(() => kilnPart!.count()), 4n);
    const before = h.store.read("test.yard.resources");
    lanes!.choose("area", ['"North"']);
    assert.ok(equalFor(RecordSliceStateType)(decodeBeast2For(RecordSliceStateType)(h.store.read("test.yard.resources")!), decodeBeast2For(RecordSliceStateType)(before!)));
    assert.deepEqual(h.store.read("test.yard.resources"), before, "the other part's stored bytes are untouched");
    assert.equal(await ready(() => lanes!.count()), 2n);
    assert.equal(await ready(() => kilnPart!.count()), 4n, "a lane choice never reaches a kiln count");
    kilnPart!.choose("group", ['"B"', '"C"']);
    assert.equal(await ready(() => kilnPart!.count()), 2n);
    assert.equal(await ready(() => lanes!.count()), 2n);
    const changed = h.create();
    assert.deepEqual((await ready(() => changed.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-1", "B-2"]);
    assert.deepEqual((await ready(() => changed.sources.resources.data.page(0n, 10n))).map(row => row.key), ["K-3", "K-4"]);
    assert.ok(h.service.requests.every(request => request.includes(" index ") || request.includes(" page ")), "every read goes through a record's paging");
    assert.equal(h.wholeReads(), 0);
    h.runtime.clear();
});

test("a preset over several sources lands in every part at once; a later choice deactivates it; toggled again it clears every part", async () => {
    const h = host();
    const slice = h.create();
    const [lanes, kilnPart] = slice.parts.map(part => part.slice);
    const presets = () => slice.parts.map(part => part.slice.read().preset);
    slice.togglePreset("north");
    assert.deepEqual(presets(), [some("north"), some("north")]);
    assert.deepEqual(lanes!.read().where.get("area"), variant("values", ['"North"']));
    assert.deepEqual(kilnPart!.read().where.get("group"), variant("values", ['"A"']));
    assert.equal(await ready(() => lanes!.count()), 2n);
    assert.equal(await ready(() => kilnPart!.count()), 2n);
    slice.togglePreset("north");
    assert.deepEqual(presets(), [none, none], "toggled while every part has it, it clears every part");
    assert.deepEqual(slice.parts.map(part => part.slice.read().where.size), [0, 0]);
    // A later choice in one part deactivates the preset there alone.
    slice.togglePreset("north");
    lanes!.choose("area", ['"South"']);
    assert.deepEqual(presets(), [none, some("north")]);
    slice.togglePreset("north");
    assert.deepEqual(presets(), [some("north"), some("north")], "selecting it again sets only the parts that left it");
    assert.deepEqual(lanes!.read().where.get("area"), variant("values", ['"North"']));
    // A preset naming one source clears the other.
    slice.togglePreset("a");
    assert.deepEqual(presets(), [some("a"), some("a")]);
    assert.equal(lanes!.read().where.size, 0, "a source the preset does not name is cleared");
    assert.deepEqual(kilnPart!.read().where.get("group"), variant("values", ['"A"']));
    assert.throws(() => slice.togglePreset("missing"), /Unknown preset/);
    h.runtime.clear();
});

test("Clear all clears every part and keeps each part's presentation resolution", () => {
    const h = host();
    const slice = h.create();
    const [lanes, kilnPart] = slice.parts.map(part => part.slice);
    lanes!.choose("area", ['"South"']);
    kilnPart!.choose("group", ['"C"']);
    kilnPart!.setResolution(some(variant("week", null)));
    slice.clearAll();
    assert.deepEqual(slice.parts.map(part => part.slice.read().where.size), [0, 0]);
    assert.deepEqual(kilnPart!.read().resolution, some(variant("week", null)));
    assert.deepEqual(slice.parts.map(part => part.slice.read().preset), [none, none]);
    h.runtime.clear();
});

test("the handle and its chrome survive serialization; the decoded product's functions act on the decoder's parts", async () => {
    const h = host();
    h.create().parts[0]!.slice.choose("area", ['"North"']);
    // A handle captures the narrowing it was made under.
    const bytes = encodeBeast2For(Yard)(h.create());
    const other = host();
    const decoded = decodeBeast2For(Yard, { platform: other.implementations })(bytes);
    assert.deepEqual(decoded.parts.map(part => part.slice.key), ["test.yard.lanes", "test.yard.resources"]);
    assert.deepEqual((await ready(() => decoded.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-1", "B-2"], "a decoded source keeps its captured narrowing");
    decoded.togglePreset("a");
    const stored = (store: UIStore) => decodeBeast2For(RecordSliceStateType)(store.read("test.yard.resources")!);
    assert.deepEqual(stored(other.store).preset, some("a"));
    assert.deepEqual(stored(h.store).preset, none, "the encoding host's store is not the decoder's");
    const projected = East.compile(chrome, other.implementations)();
    assert.deepEqual(projected.slice.parts.map(part => part.source), ["lanes", "resources"]);
    assert.deepEqual(projected.affordances, [variant("fields", null), variant("presets", null), variant("summary", null)]);
    assert.deepEqual(projected.persist, none);
    projected.slice.clearAll();
    assert.equal(stored(other.store).where.size, 0, "the chrome's Clear all is the product's");
    h.runtime.clear();
    other.runtime.clear();
});

test("refusals name the fix", () => {
    const source = Data.bindPaged(bays, { indexes: [baysByArea] });
    assert.throws(() => Slice.bindRecords("bad", {} as never), /at least one source/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source } }, {
        presets: [{ id: "x", name: "X", where: {} }, { id: "x", name: "Y", where: {} }] }), /repeated preset 'x'/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source } }, {
        presets: [{ id: "x", name: "X", where: { kilns: {} } as never }] }), /preset 'x' narrows 'kilns', which is not one of its sources \(lanes\)/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source, presets: [] } as never }), /declares presets; declare them once/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source, fields: { name: {} } as never } }), /needs an index on it/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source } }, {
        presets: [{ id: "x", name: "X", where: { lanes: { area: [] } } }] }), /needs at least one value/);
    assert.throws(() => Slice.rows(yard as never), /names its source: Slice.rows\(slice, "lanes"\)/);
    assert.throws(() => Slice.rows(yard, "kilns" as never), /'kilns' is not one of this Slice's sources \(lanes, resources\)/);
    const single = Slice.bindRecord("single", source);
    assert.throws(() => Slice.rows(single as never, "lanes" as never), /needs a Slice.bindRecords handle/);
    assert.throws(() => recordSlicesChrome({ slice: single as never }), /Invalid Slice.bindRecords member/);
});

function _typeRefusals() {
    const source = Data.bindPaged(bays, { indexes: [baysByArea] });
    // @ts-expect-error a part's fields are its own record's indexed fields
    Slice.bindRecords("bad", { lanes: { source, fields: { group: {} } } });
    // @ts-expect-error a preset narrows a part with its own fields
    Slice.bindRecords("bad", { lanes: { source } }, { presets: [{ id: "x", name: "X", where: { lanes: { group: ["A"] } } }] });
    // @ts-expect-error a preset's values have the field's type
    Slice.bindRecords("bad", { lanes: { source } }, { presets: [{ id: "x", name: "X", where: { lanes: { area: [4n] } } }] });
    // @ts-expect-error Slice.rows names one of the handle's sources
    Slice.rows(yard, "kilns");
}
void _typeRefusals;
