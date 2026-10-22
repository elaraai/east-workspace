/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Computed record indexes under a record Slice, on e3 itself (#1378): the
 * Data.bind examples' computed flows, whose indexes e3 computes from their
 * steps — how many, their lanes, their owners — read through the paging
 * runtime's default API over the harness's fetch, and another session's edit
 * committed through the record's patch door.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { East, Expr, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { Data } from "@elaraai/e3-ui/internal";
import { bindRecord } from "@elaraai/east-ui/internal";
import { createRecordSliceImplementation, StateRuntime, UIStore } from "@elaraai/east-ui-components/platform";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { PagedRuntime, createDefaultPagedApi } from "../src/platform/paged-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/data/data": ex });

const flows = ex.computedFlows;
const indexes = [
    ex.computedByDescription, ex.computedByStateCount, ex.computedByDescriptionCount, ex.computedByLane,
    ex.computedByOwner, ex.computedByLabel, ex.computedBySize, ex.computedByDecisionOwner,
] as const;
const binding = Data.bindPaged(flows, { indexes });
const slice = bindRecord("computed", binding, {
    fields: { description: {}, stateCount: {}, lane: {}, owner: {} },
    presets: [{ id: "large-inbound", name: "Large inbound", where: { description: ["Inbound"], stateCount: { from: 2n, to: 4n } } }],
});
const Slice = Expr.type(slice);
const program = East.function([], Slice, () => slice);
const revisionEqual = equalFor(OptionType(StringType));
/** A step of a flow, in its lane, owned by whoever is given. */
const step = (lane: string, owner: string | null = null): ValueTypeOf<typeof ex.ComputedStep> => ({ lane, owner: owner === null ? none : some(owner) });

/** The pages of the flows asked of the test's workspace so far. */
const pages = () => h.requests("page", `records.${flows.name}`);
/** How many times the flows were read whole. */
const wholeReads = () => h.requests("read", `records.${flows.name}`).length;

/** A paging runtime over e3's paging API in the test's workspace, the platform a record Slice runs on over it, and the slice. */
function fixture() {
    const { cache } = h.cache();
    const runtime = new PagedRuntime();
    runtime.initialize(createDefaultPagedApi(h.e3.apiUrl, h.e3.repo, h.options, cache), h.workspace);
    StateRuntime.initializeStore(new UIStore());
    const platform = [...runtime.indexed.platform(null), ...runtime.buildPrimitives()];
    platform.push(...createRecordSliceImplementation(() => platform));
    const create = East.compile(program, platform);
    return { create, platform, runtime };
}

/** The content hash e3 holds the flows' state under now. */
async function stateHash(): Promise<string> {
    const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, flows.path, h.e3.direct);
    assert.equal(status.hash.type, "some", "the record has a state");
    return status.hash.value!;
}

test("named computed fields retain their types and use bounded exact, range and compound queries", async () => {
    const f = fixture();
    try {
        const handle = f.create();
        assert.deepEqual(handle.config.fields.map(field => [field.fieldId, field.kind, field.set]), [
            ["description", "string", false], ["stateCount", "integer", false], ["lane", "string", true], ["owner", "string", true],
        ]);
        assert.equal(await h.ready(() => handle.total()), 4n);
        assert.deepEqual(await h.ready(() => handle.domain("stateCount")), { from: "0", to: "3" });
        handle.choose("stateCount", ["1"]);
        assert.deepEqual((await h.ready(() => f.create().data.page(0n, 10n))).map(row => row.key), ["b", "c"]);
        handle.togglePreset("large-inbound");
        assert.equal(await h.ready(() => handle.count()), 1n);
        assert.deepEqual((await h.ready(() => f.create().data.page(0n, 10n))).map(row => row.key), ["a"]);
        assert.deepEqual(await h.ready(() => handle.domain("stateCount")), { from: "1", to: "3" });
        assert.equal(handle.sourceId, flows.name);
        const asked = h.requests().length;
        await h.ready(() => handle.count());
        assert.equal(h.requests().length, asked, "repeat counts reuse revision-pinned bounds");
        assert.equal(wholeReads(), 0);
        assert.ok(pages().every(request => Number(request.query.get("limit")) <= 10));
    } finally { f.runtime.clear(); }
});

test("computed membership deduplicates per record, searches nested values, survives serialization and follows edits", async () => {
    const f = fixture();
    try {
        const handle = f.create();
        assert.deepEqual((await h.ready(() => handle.suggest("lane", "lo"))).map(value => [value.label, value.count]), [["load", some(2n)]]);
        handle.choose("lane", ['"load"']);
        const captured = handle.read().where;
        const ids = (await h.ready(() => f.create().data.page(0n, 10n))).map(row => row.key);
        assert.deepEqual(ids, ["a", "b"], "two load states in a flow still give it one list entry");
        assert.throws(() => handle.choose("lane", ['"load"', '"review"']), /Choose one/);
        assert.throws(() => handle.prefix("lane", "lo"), /exact value/);
        assert.equal(await h.ready(() => handle.contains(captured, "a")), true);
        assert.equal(await h.ready(() => handle.contains(captured, "c")), false);
        assert.equal((await h.ready(() => handle.readEntry("c"))).type, "some");
        const saved = encodeBeast2For(Slice)(f.create());
        StateRuntime.initializeStore(new UIStore());
        const decoded = decodeBeast2For(Slice, { platform: f.platform })(saved);
        // Controls belong to the decoder's UI store, seeded from the declared
        // initial narrowing, and the decoded source reads its narrowing there
        // when its rows are read, never the one it was encoded under (#1354).
        assert.equal(decoded.read().where.size, 0);
        assert.deepEqual((await h.ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["a", "b", "c", "d"]);
        decoded.choose("lane", ['"load"']);
        assert.deepEqual((await h.ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["a", "b"]);
        // Another session moves flow a off the load lane, and the source is told the state it committed.
        const changed = await h.read(flows);
        changed.set("a", { description: "Inbound", states: [step("review")] });
        await h.patch(flows, changed);
        const committed = await stateHash();
        decoded.data.refresh(some(committed));
        await h.ready(() => revisionEqual(decoded.data.revision(), some(committed)) ? some(null) : none);
        assert.deepEqual((await h.ready(() => decoded.data.page(0n, 10n))).map(row => row.key), ["b"]);
        assert.equal(await h.ready(() => decoded.countWhere(captured)), 1n);
        assert.equal(await h.ready(() => decoded.contains(captured, "a")), false);
        assert.equal((await h.ready(() => decoded.readEntry("a"))).type, "some", "leaving the index never means the primary flow was deleted");
        decoded.clear("lane");
        decoded.choose("owner", [".none"]);
        assert.equal(await h.ready(() => decoded.count()), 2n);
        decoded.clearAll();
        assert.equal(await h.ready(() => decoded.count()), 4n, "empty graphs survive an unfiltered view");
        assert.equal(wholeReads(), 0);
    } finally { f.runtime.clear(); }
});

test("scalar computed keys infer controls from their index types and support covering-only paging", async () => {
    const f = fixture();
    try {
        const source = Data.bindPaged(flows, { indexes: [ex.computedByLabel, ex.computedBySize, ex.computedByDecisionOwner], join: false });
        const sliced = bindRecord("computed-scalars", source, { search: ["label", "decisionOwner"], range: "size" });
        const create = East.compile(East.function([], Expr.type(sliced), () => sliced), f.platform);
        const handle = create();
        assert.deepEqual(handle.config.fields.map(field => [field.fieldId, field.kind, field.set]), [
            ["label", "string", false], ["size", "integer", false], ["decisionOwner", "string", true],
        ]);
        assert.equal(await h.ready(() => handle.total()), 4n);
        handle.prefix("label", "In");
        const page = await h.ready(() => create().data.page(0n, 10n));
        assert.deepEqual(page.map(row => row.key), ["a", "b"]);
        assert.ok(page.every(row => row.row.type === "none"));
        assert.deepEqual((await h.ready(() => handle.suggest("label", "In"))).map(value => [value.label, value.count]), [["Inbound", some(2n)]]);
        assert.deepEqual(await h.ready(() => handle.domain("size")), { from: "0", to: "3" });
        handle.choose("size", ["1"]);
        assert.deepEqual((await h.ready(() => create().data.page(0n, 10n))).map(row => row.key), ["b", "c"]);
        handle.choose("decisionOwner", ['.some "team-a"']);
        assert.deepEqual((await h.ready(() => create().data.page(0n, 10n))).map(row => row.key), ["a"]);
        assert.equal(await h.ready(() => handle.count()), 1n);
        assert.equal(wholeReads(), 0);
    } finally { f.runtime.clear(); }
});

function _computedTypeRefusals() {
    // @ts-expect-error computed integer controls require integers
    bindRecord("bad", binding, { initial: { stateCount: ["three"] } });
    // @ts-expect-error no index declares this computed field
    bindRecord("bad", binding, { fields: { unknown: {} } });
    // @ts-expect-error numeric computed fields are not text searches
    bindRecord("bad", binding, { search: ["stateCount"] });
}
