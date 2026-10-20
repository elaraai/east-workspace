/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Slice.bindRecords` over two real records (#1336), on e3 itself (#1378):
 * the Allocation examples' bays and kilns, each read through its own index —
 * the bays by area, the kilns by group — through the paging runtime's default
 * API over the harness's fetch. Its parts are ordinary record Slices under
 * their own keys, a choice in one never reaches another, its presets and Clear
 * all are East functions over its parts, and it reads each record through its
 * indexes only; each part carries how the rail names its source (#1339).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { East, Expr, decodeBeast2For, equalFor, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { RecordSliceStateType, RecordSlicesChromeType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { Data } from "@elaraai/e3-ui/internal";
import * as ax from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Request } from "../src/e3-web.test-utils.js";
import { PagedRuntime, createDefaultPagedApi } from "../src/platform/paged-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "allocation/allocation": ax });

const bays = ax.yardBays;
const kilns = ax.kilns;
const yard = Slice.bindRecords("test.yard", {
    lanes: { source: Data.bindPaged(bays, { indexes: [ax.yardBaysByArea] }), label: "Bays", icon: { prefix: "fas", name: "warehouse" }, fields: { area: { label: "Area" } } },
    resources: { source: Data.bindPaged(kilns, { indexes: [ax.kilnsByGroup] }),
        fields: { group: { label: "Group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
}, {
    presets: [
        { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
        { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
    ],
});
const Yard = Expr.type(yard);
const program = East.function([], Yard, $ => $.return(yard));
const resources = East.function([], Expr.type(Slice.rows(yard, "resources")), $ => $.return(Slice.rows(yard, "resources")));
const chrome = East.function([], RecordSlicesChromeType, $ => $.return(recordSlicesChrome({ slice: yard })));

/** Whether a request names the bays or the kilns. */
const ofYard = (request: E3Request) => request.dataset === `records.${bays.name}` || request.dataset === `records.${kilns.name}`;
/** How many times the bays or the kilns were read whole. */
const wholeReads = () => h.requests("read").filter(ofYard).length;

/** A host: a paging runtime over e3's paging API in the test's workspace, its UI store, and the platform the slice is made on. */
function host() {
    const { cache } = h.cache();
    const runtime = new PagedRuntime();
    runtime.initialize(createDefaultPagedApi(h.e3.apiUrl, h.e3.repo, h.options, cache), h.workspace);
    const store = new UIStore();
    StateRuntime.initializeStore(store);
    const implementations = [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return { store, runtime, implementations, create: East.compile(program, implementations) };
}

test("its parts are record Slices under `${key}.${source}`, in source order, each read alone with Slice.rows(slice, source)", async () => {
    const here = host();
    const slice = here.create();
    assert.equal(slice.key, "test.yard");
    assert.deepEqual(slice.parts.map(part => [part.source, part.slice.key]), [["lanes", "test.yard.lanes"], ["resources", "test.yard.resources"]]);
    assert.deepEqual(slice.presets, [{ id: "north", name: "North bays, halls" }, { id: "halls", name: "Halls" }]);
    assert.deepEqual(slice.parts.map(part => part.slice.config.fields.map(field => field.fieldId)), [["area"], ["group"]]);
    assert.deepEqual(slice.parts.map(part => part.slice.sourceId), [bays.name, kilns.name], "each part's editing identity is its own record");
    // How the rail names each source: its label and its icon, or none.
    assert.deepEqual(slice.parts.map(part => [part.label, part.icon]), [
        [some("Bays"), some({ prefix: "fas", name: "warehouse", label: none, style: none })], [none, none],
    ]);
    assert.deepEqual((await h.ready(() => slice.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-1", "B-2", "B-3"]);
    const rows = East.compile(resources, here.implementations)();
    const every = [...(await h.read(kilns)).keys()];
    assert.equal(every.length, 33);
    assert.deepEqual((await h.ready(() => rows.page(0n, 40n))).map(row => row.key), every, "every kiln, in key order");
    assert.equal(wholeReads(), 0);
    here.runtime.clear();
});

test("a choice in one source leaves the other's stored state and counts exactly as they were", async () => {
    const here = host();
    const slice = here.create();
    const [lanes, kilnPart] = slice.parts.map(part => part.slice);
    assert.equal(await h.ready(() => kilnPart!.count()), 33n);
    const before = here.store.read("test.yard.resources");
    lanes!.choose("area", ['"North"']);
    assert.ok(equalFor(RecordSliceStateType)(decodeBeast2For(RecordSliceStateType)(here.store.read("test.yard.resources")!), decodeBeast2For(RecordSliceStateType)(before!)));
    assert.deepEqual(here.store.read("test.yard.resources"), before, "the other part's stored bytes are untouched");
    assert.equal(await h.ready(() => lanes!.count()), 2n);
    assert.equal(await h.ready(() => kilnPart!.count()), 33n, "a lane choice never reaches a kiln count");
    kilnPart!.choose("group", ['"Large"', '"Bulk"']);
    assert.equal(await h.ready(() => kilnPart!.count()), 6n);
    assert.equal(await h.ready(() => lanes!.count()), 2n);
    const changed = here.create();
    assert.deepEqual((await h.ready(() => changed.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-1", "B-2"]);
    assert.deepEqual((await h.ready(() => changed.sources.resources.data.page(0n, 10n))).map(row => row.key),
        ["K-601", "K-602", "K-501", "K-502", "K-503", "K-504"], "in the group index's order: Bulk before Large, each group's kilns by key");
    const reads = h.requests().filter(ofYard);
    assert.ok(reads.length > 0);
    assert.ok(reads.every(request => request.kind === "page" || request.kind === "find" || request.kind === "dataset-status"),
        "every read goes through a record's paging, beside the lookups of its revision");
    assert.equal(wholeReads(), 0);
    here.runtime.clear();
});

test("a preset over several sources lands in every part at once; a later choice deactivates it; toggled again it clears every part", async () => {
    const here = host();
    const slice = here.create();
    const [lanes, kilnPart] = slice.parts.map(part => part.slice);
    const presets = () => slice.parts.map(part => part.slice.read().preset);
    slice.togglePreset("north");
    assert.deepEqual(presets(), [some("north"), some("north")]);
    assert.deepEqual(lanes!.read().where.get("area"), variant("values", ['"North"']));
    assert.deepEqual(kilnPart!.read().where.get("group"), variant("values", ['"Hall A"', '"Hall B"']));
    assert.equal(await h.ready(() => lanes!.count()), 2n);
    assert.equal(await h.ready(() => kilnPart!.count()), 19n);
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
    slice.togglePreset("halls");
    assert.deepEqual(presets(), [some("halls"), some("halls")]);
    assert.equal(lanes!.read().where.size, 0, "a source the preset does not name is cleared");
    assert.deepEqual(kilnPart!.read().where.get("group"), variant("values", ['"Hall A"', '"Hall B"']));
    assert.throws(() => slice.togglePreset("missing"), /Unknown preset/);
    here.runtime.clear();
});

test("Clear all clears every part and keeps each part's presentation resolution", () => {
    const here = host();
    const slice = here.create();
    const [lanes, kilnPart] = slice.parts.map(part => part.slice);
    lanes!.choose("area", ['"South"']);
    kilnPart!.choose("group", ['"Bulk"']);
    kilnPart!.setResolution(some(variant("week", null)));
    slice.clearAll();
    assert.deepEqual(slice.parts.map(part => part.slice.read().where.size), [0, 0]);
    assert.deepEqual(kilnPart!.read().resolution, some(variant("week", null)));
    assert.deepEqual(slice.parts.map(part => part.slice.read().preset), [none, none]);
    here.runtime.clear();
});

test("the handle and its chrome survive serialization; the decoded product's functions act on the decoder's parts", async () => {
    const here = host();
    here.create().parts[0]!.slice.choose("area", ['"North"']);
    const bytes = encodeBeast2For(Yard)(here.create());
    const there = host();
    const decoded = decodeBeast2For(Yard, { platform: there.implementations })(bytes);
    assert.deepEqual(decoded.parts.map(part => part.slice.key), ["test.yard.lanes", "test.yard.resources"]);
    // A source reads its narrowing when its rows are read (#1354): a decoded
    // one reads the decoder's store, never the narrowing it was encoded under.
    assert.deepEqual((await h.ready(() => decoded.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-1", "B-2", "B-3"], "a decoded source reads the decoder's narrowing");
    decoded.parts[0]!.slice.choose("area", ['"South"']);
    assert.deepEqual((await h.ready(() => decoded.sources.lanes.data.page(0n, 10n))).map(row => row.key), ["B-3"], "a choice in the decoder narrows the decoded source's rows");
    assert.deepEqual(decodeBeast2For(RecordSliceStateType)(here.store.read("test.yard.lanes")!).where.get("area"), variant("values", ['"North"']), "the encoding host's narrowing stays its own");
    decoded.togglePreset("halls");
    const stored = (store: UIStore) => decodeBeast2For(RecordSliceStateType)(store.read("test.yard.resources")!);
    assert.deepEqual(stored(there.store).preset, some("halls"));
    assert.deepEqual(stored(here.store).preset, none, "the encoding host's store is not the decoder's");
    const projected = East.compile(chrome, there.implementations)();
    assert.deepEqual(projected.slice.parts.map(part => part.source), ["lanes", "resources"]);
    assert.deepEqual(projected.slice.parts.map(part => part.label), [some("Bays"), none], "the chrome keeps each source's name");
    assert.deepEqual(projected.affordances, [variant("fields", null), variant("presets", null), variant("summary", null)]);
    assert.deepEqual(projected.persist, none);
    projected.slice.clearAll();
    assert.equal(stored(there.store).where.size, 0, "the chrome's Clear all is the product's");
    here.runtime.clear();
    there.runtime.clear();
});

test("refusals name the fix", () => {
    const source = Data.bindPaged(bays, { indexes: [ax.yardBaysByArea] });
    assert.throws(() => Slice.bindRecords("bad", {} as never), /at least one source/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source } }, {
        presets: [{ id: "x", name: "X", where: {} }, { id: "x", name: "Y", where: {} }] }), /repeated preset 'x'/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source } }, {
        presets: [{ id: "x", name: "X", where: { kilns: {} } as never }] }), /preset 'x' narrows 'kilns', which is not one of its sources \(lanes\)/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source, presets: [] } as never }), /declares presets; declare them once/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source, fields: { name: {} } as never } }), /needs an index on it/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source } }, {
        presets: [{ id: "x", name: "X", where: { lanes: { area: [] } } }] }), /needs at least one value/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source, label: " " } }), /'lanes' has an empty label; give it a name or leave it out/);
    assert.throws(() => Slice.bindRecords("bad", { lanes: { source, icon: { prefix: "far" as never, name: "warehouse" } } }),
        /'lanes'.*`far warehouse` is not a Font Awesome solid icon/);
    assert.throws(() => Slice.rows(yard as never), /names its source: Slice.rows\(slice, "lanes"\)/);
    assert.throws(() => Slice.rows(yard, "kilns" as never), /'kilns' is not one of this Slice's sources \(lanes, resources\)/);
    const single = Slice.bindRecord("single", source);
    assert.throws(() => Slice.rows(single as never, "lanes" as never), /needs a Slice.bindRecords handle/);
    assert.throws(() => recordSlicesChrome({ slice: single as never }), /Invalid Slice.bindRecords member/);
});

function _typeRefusals() {
    const source = Data.bindPaged(bays, { indexes: [ax.yardBaysByArea] });
    // @ts-expect-error a part's fields are its own record's indexed fields
    Slice.bindRecords("bad", { lanes: { source, fields: { group: {} } } });
    // @ts-expect-error a preset narrows a part with its own fields
    Slice.bindRecords("bad", { lanes: { source } }, { presets: [{ id: "x", name: "X", where: { lanes: { group: ["Hall A"] } } }] });
    // @ts-expect-error a preset's values have the field's type
    Slice.bindRecords("bad", { lanes: { source } }, { presets: [{ id: "x", name: "X", where: { lanes: { area: [4n] } } }] });
    // @ts-expect-error Slice.rows names one of the handle's sources
    Slice.rows(yard, "kilns");
}
void _typeRefusals;
