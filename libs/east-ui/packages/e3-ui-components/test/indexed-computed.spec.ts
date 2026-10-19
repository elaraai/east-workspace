/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, Expr, IntegerType, OptionType, SetType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, none, some, type option,
} from "@elaraai/east";
import * as e3 from "@elaraai/e3";
import { Data } from "@elaraai/e3-ui/internal";
import { bindRecord } from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { PagedRuntime } from "../src/platform/paged-runtime.js";
import { ReactiveDatasetCache, type DatasetApi } from "../src/platform/index.js";
import { recordPaging, contentHash } from "../src/platform/record-paging.test-utils.js";

const Step = StructType({ lane: StringType, owner: OptionType(StringType) });
const Flow = StructType({ description: StringType, states: ArrayType(Step) });
const Flows = DictType(StringType, Flow);
const step = (lane: string, owner: string | null = null) => ({ lane, owner: owner === null ? none : some(owner) });
const rows = new Map([
    ["a", { description: "Inbound", states: [step("load", "team-a"), step("load", "team-a"), step("review")] }],
    ["b", { description: "Inbound", states: [step("load", "team-b")] }],
    ["c", { description: "Returns", states: [step("review")] }],
    ["d", { description: "Empty", states: [] }],
]);
const flows = e3.record("computed_flows", Flows, rows);
const byDescription = e3.recordIndex("description", flows, { on: ["description"] });
const byCount = e3.recordIndex("state_count", flows, {
    key: East.function([StringType, Flow], StructType({ stateCount: IntegerType }), (_$, _id, flow) => ({ stateCount: flow.states.size() })),
});
const byDescriptionCount = e3.recordIndex("description_count", flows, {
    key: East.function([StringType, Flow], StructType({ description: StringType, stateCount: IntegerType }),
        (_$, _id, flow) => ({ description: flow.description, stateCount: flow.states.size() })),
});
const byLane = e3.recordIndex("lane", flows, {
    keys: East.function([StringType, Flow], SetType(StructType({ lane: StringType })),
        (_$, _id, flow) => flow.states.toSet((_$2, state) => ({ lane: state.lane }))),
});
const byOwner = e3.recordIndex("owner", flows, {
    keys: East.function([StringType, Flow], SetType(StructType({ owner: OptionType(StringType) })),
        (_$, _id, flow) => flow.states.toSet((_$2, state) => ({ owner: state.owner }))),
});
const byLabel = e3.recordIndex("label", flows, {
    key: East.function([StringType, Flow], StringType, (_$, _id, flow) => flow.description),
});
const bySize = e3.recordIndex("size", flows, {
    key: East.function([StringType, Flow], IntegerType, (_$, _id, flow) => flow.states.size()),
});
const byScalarOwner = e3.recordIndex("decisionOwner", flows, {
    keys: East.function([StringType, Flow], SetType(OptionType(StringType)),
        (_$, _id, flow) => flow.states.toSet((_$2, state) => state.owner)),
});
const indexes = [byDescription, byCount, byDescriptionCount, byLane, byOwner, byLabel, bySize, byScalarOwner] as const;
const binding = Data.bindPaged(flows, { indexes });
const slice = bindRecord("computed", binding, {
    fields: { description: {}, stateCount: {}, lane: {}, owner: {} },
    presets: [{ id: "large-inbound", name: "Large inbound", where: { description: ["Inbound"], stateCount: { from: 2n, to: 4n } } }],
});
const Slice = Expr.type(slice);
const program = East.function([], Slice, () => slice);

async function ready<T>(read: () => option<T>): Promise<T> {
    for (let attempt = 0; attempt < 12; attempt++) {
        const result = read();
        if (result.type === "some") return result.value;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    assert.fail("bounded computed-index read did not settle");
}

function fixture() {
    let bytes = encodeBeast2For(Flows)(rows);
    let wholeReads = 0;
    const api: DatasetApi = {
        async get() { wholeReads++; throw new Error("No whole-record reads"); }, async set() {},
        async launchDataflow() {}, async listRoot() { return []; }, async listAt() { return []; }, async workspaceStatus() { return { datasets: [] }; },
    };
    const cache = new ReactiveDatasetCache({ workspace: "computed" }, api);
    const service = recordPaging(cache, () => bytes, [{ path: flows.path, type: Flows,
        indexes: indexes.map(index => {
            const key = East.compile(index.keyFn as never, []) as (id: unknown, row: unknown) => unknown;
            return { name: index.name, keyType: index.keyType,
                keys: (id: unknown, row: unknown) => index.multi ? key(id, row) as Iterable<unknown> : [key(id, row)] };
        }),
    }]);
    const runtime = new PagedRuntime();
    runtime.initialize(service.api, "computed");
    StateRuntime.initializeStore(new UIStore());
    const platform = [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
    platform.push(...createRecordSliceImplementation(() => platform));
    const create = East.compile(program, platform);
    return { create, platform, service, runtime, wholeReads: () => wholeReads,
        commit(next: typeof rows) { bytes = encodeBeast2For(Flows)(next); return contentHash(bytes); } };
}

test("named computed fields retain their types and use bounded exact, range and compound queries", async () => {
    const f = fixture();
    try {
        const handle = f.create();
        assert.deepEqual(handle.config.fields.map(field => [field.fieldId, field.kind, field.set]), [
            ["description", "string", false], ["stateCount", "integer", false], ["lane", "string", true], ["owner", "string", true],
        ]);
        assert.equal(await ready(() => handle.total()), 4n);
        assert.deepEqual(await ready(() => handle.domain("stateCount")), { from: "0", to: "3" });
        handle.choose("stateCount", ["1"]);
        assert.deepEqual((await ready(() => f.create().data.page(0n, 10n))).map(row => row.key), ["b", "c"]);
        handle.togglePreset("large-inbound");
        assert.equal(await ready(() => handle.count()), 1n);
        assert.deepEqual((await ready(() => f.create().data.page(0n, 10n))).map(row => row.key), ["a"]);
        assert.deepEqual(await ready(() => handle.domain("stateCount")), { from: "1", to: "3" });
        assert.equal(handle.sourceId, flows.name);
        const reads = f.service.requests.length;
        await ready(() => handle.count());
        assert.equal(f.service.requests.length, reads, "repeat counts reuse revision-pinned bounds");
        assert.equal(f.wholeReads(), 0);
        assert.ok(f.service.requests.filter(request => request.includes(" page ")).every(request => Number(request.split("+").at(-1)) <= 10));
    } finally { f.runtime.clear(); }
});

test("computed membership deduplicates per record, searches nested values, survives serialization and follows edits", async () => {
    const f = fixture();
    try {
        const handle = f.create();
        assert.deepEqual((await ready(() => handle.suggest("lane", "lo"))).map(value => [value.label, value.count]), [["load", some(2n)]]);
        handle.choose("lane", ['"load"']);
        const captured = handle.read().where;
        const ids = (await ready(() => f.create().data.page(0n, 10n))).map(row => row.key);
        assert.deepEqual(ids, ["a", "b"], "two load states in a flow still give it one list entry");
        assert.throws(() => handle.choose("lane", ['"load"', '"review"']), /Choose one/);
        assert.throws(() => handle.prefix("lane", "lo"), /exact value/);
        assert.equal(await ready(() => handle.contains(captured, "a")), true);
        assert.equal(await ready(() => handle.contains(captured, "c")), false);
        assert.equal((await ready(() => handle.readEntry("c"))).type, "some");
        const saved = encodeBeast2For(Slice)(f.create());
        StateRuntime.initializeStore(new UIStore());
        const decoded = decodeBeast2For(Slice, { platform: f.platform })(saved);
        // Controls belong to the decoder's UI store, seeded from the declared
        // initial narrowing, and the decoded source reads its narrowing there
        // when its rows are read, never the one it was encoded under (#1354).
        assert.equal(decoded.read().where.size, 0);
        assert.deepEqual((await ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["a", "b", "c", "d"]);
        decoded.choose("lane", ['"load"']);
        assert.deepEqual((await ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["a", "b"]);
        const changed = new Map(rows);
        changed.set("a", { description: "Inbound", states: [step("review")] });
        const committed = f.commit(changed);
        decoded.data.refresh(some(committed));
        await ready(() => {
            const revision = decoded.data.revision();
            return revision.type === "some" && revision.value === committed ? some(null) : none;
        });
        assert.deepEqual((await ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["b"]);
        assert.equal(await ready(() => decoded.countWhere(captured)), 1n);
        assert.equal(await ready(() => decoded.contains(captured, "a")), false);
        assert.equal((await ready(() => decoded.readEntry("a"))).type, "some", "leaving the index never means the primary flow was deleted");
        decoded.clear("lane");
        decoded.choose("owner", [".none"]);
        assert.equal(await ready(() => decoded.count()), 2n);
        decoded.clearAll();
        assert.equal(await ready(() => decoded.count()), 4n, "empty graphs survive an unfiltered view");
        assert.equal(f.wholeReads(), 0);
    } finally { f.runtime.clear(); }
});

test("scalar computed keys infer controls from their index types and support covering-only paging", async () => {
    const f = fixture();
    try {
        const source = Data.bindPaged(flows, { indexes: [byLabel, bySize, byScalarOwner], join: false });
        const sliced = bindRecord("computed-scalars", source, { search: ["label", "decisionOwner"], range: "size" });
        const create = East.compile(East.function([], Expr.type(sliced), () => sliced), f.platform);
        const handle = create();
        assert.deepEqual(handle.config.fields.map(field => [field.fieldId, field.kind, field.set]), [
            ["label", "string", false], ["size", "integer", false], ["decisionOwner", "string", true],
        ]);
        assert.equal(await ready(() => handle.total()), 4n);
        handle.prefix("label", "In");
        const page = await ready(() => create().data.page(0n, 10n));
        assert.deepEqual(page.map(row => row.key), ["a", "b"]);
        assert.ok(page.every(row => row.row.type === "none"));
        assert.deepEqual((await ready(() => handle.suggest("label", "In"))).map(value => [value.label, value.count]), [["Inbound", some(2n)]]);
        assert.deepEqual(await ready(() => handle.domain("size")), { from: "0", to: "3" });
        handle.choose("size", ["1"]);
        assert.deepEqual((await ready(() => create().data.page(0n, 10n))).map(row => row.key), ["b", "c"]);
        handle.choose("decisionOwner", ['.some "team-a"']);
        assert.deepEqual((await ready(() => create().data.page(0n, 10n))).map(row => row.key), ["a"]);
        assert.equal(await ready(() => handle.count()), 1n);
        assert.equal(f.wholeReads(), 0);
    } finally { f.runtime.clear(); }
});

test("computed declarations reject ambiguous keys and incompatible field types before a view runs", () => {
    const empty = e3.recordIndex("empty", flows, { key: East.function([StringType, Flow], StructType({}), () => ({})) });
    assert.throws(() => Data.bindPaged(flows, { indexes: [empty] }), /at least one key field/);
    const compound = e3.recordIndex("compound", flows, {
        keys: East.function([StringType, Flow], SetType(StructType({ lane: StringType, owner: OptionType(StringType) })),
            (_$, _id, flow) => flow.states.toSet((_$2, state) => ({ lane: state.lane, owner: state.owner }))),
    });
    assert.throws(() => Data.bindPaged(flows, { indexes: [compound] }), /cannot duplicate records/);
    const wrong = e3.recordIndex("wrong", flows, { key: East.function([StringType, Flow], StructType({ description: IntegerType }),
        (_$, _id, flow) => ({ description: flow.states.size() })) });
    assert.throws(() => bindRecord("wrong", Data.bindPaged(flows, { indexes: [wrong] })), /inconsistent types/);
    assert.throws(() => Data.bindPaged(flows, { indexes: [byLane], join: false }), /without Set fields/);
});

function _computedTypeRefusals() {
    // @ts-expect-error computed integer controls require integers
    bindRecord("bad", binding, { initial: { stateCount: ["three"] } });
    // @ts-expect-error no index declares this computed field
    bindRecord("bad", binding, { fields: { unknown: {} } });
    // @ts-expect-error numeric computed fields are not text searches
    bindRecord("bad", binding, { search: ["stateCount"] });
}
