/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The issue #106 lock for `Data.bindPaged` — the paged sibling of
 * `data-serialize.spec.ts`.
 *
 * A paged handle (and any callback that captures one) must survive beast2
 * encode → decode and re-bind to the DECODER's runtime, because an e3 `ui()`
 * task's whole component tree is decoded on the client. That works only while
 * every handle method stays an IR-bearing `East.function` over the
 * `data_page*` primitives, capturing nothing but the plain-data source path.
 *
 * The scoped-platform test is the one that catches the documented failure
 * mode: a `ui()` task renders through `createScoped*()` arrays, NOT the global
 * registry, so a primitive missing from that array decodes to "Platform
 * function 'data_page' is not available" — at render time, in production only,
 * with every unit test still green.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType,
    East,
    FloatType,
    FunctionType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    variant,
    toEastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
    encodeEastIR,
    decodeEastIR,
} from "@elaraai/east";
import { SeekQueryType, SeekRangeType } from "@elaraai/east-ui";
import { TreePathType, type TreePath } from "@elaraai/e3-types";
import { DataPagedHandleType } from "@elaraai/e3-ui/internal";
import type { DatasetPage } from "@elaraai/e3-api-client";
import { PagedRuntime, createScopedPagedPlatform, type PagedApi } from "../src/platform/paged-runtime.js";
import { datasetPathToString } from "../src/platform/dataset-store.js";

const ws = "ws";
const pathOf = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
const opsPath = pathOf("inputs", "ops");
const REVISION = "a".repeat(64);

const Row = StructType({ id: StringType, v: FloatType });
const RowsType = ArrayType(Row);
const rowsTypeValue = toEastTypeValue(RowsType);
const encodeRows = encodeBeast2For(RowsType);
const HandleType = DataPagedHandleType(RowsType);

const settle = () => new Promise<void>(res => setTimeout(res, 0));

/** A `PagedApi` that answers immediately from a local array. */
function localApi(elements: { id: string; v: number }[]): PagedApi {
    return {
        async getPage(_workspace, _path, window): Promise<DatasetPage> {
            const slice = elements.slice(window.offset, window.offset + window.limit);
            const data = encodeRows(slice);
            return {
                data, totalElements: elements.length, totalBytes: data.length, totalExact: true,
                segmentCount: 0, offset: window.offset, count: slice.length, hash: REVISION,
            };
        },
        async findKey() {
            return { found: false, row: 0, count: 0, hash: REVISION };
        },
        async getRevision() {
            return REVISION;
        },
        watchRevision() {
            return () => {};
        },
    };
}

function newRuntime(elements: { id: string; v: number }[]) {
    const runtime = new PagedRuntime();
    runtime.initialize(localApi(elements), ws);
    return runtime;
}

test("#106 — a Data.bindPaged handle ENCODES (its methods carry IR)", () => {
    const runtime = newRuntime([{ id: "a", v: 1.0 }]);
    const handle = runtime.buildHandle(rowsTypeValue, opsPath, { index: null, join: false }, "pinned");
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — page() round-trips and re-binds to the DECODER's runtime", async () => {
    const enc = newRuntime([{ id: "encoder-side", v: 0.0 }]);
    const bytes = encodeBeast2For(HandleType)(enc.buildHandle(rowsTypeValue, opsPath, { index: null, join: false }, "pinned") as never);

    // A different runtime, with different data behind the same path: a decoded
    // handle must read through the DECODER, never carry the encoder's answers.
    const dec = newRuntime([{ id: "decoder-side", v: 7.0 }, { id: "b", v: 8.0 }]);
    const decoded = decodeBeast2For(HandleType, { platform: dec.buildPrimitives() })(bytes) as unknown as {
        page: (o: bigint, l: bigint) => { type: string; value: { id: string }[] };
        total: () => { type: string; value: bigint };
        revision: () => { type: string; value: string };
    };

    assert.equal(decoded.page(0n, 2n).type, "none", "the first read looks the revision up");
    await settle();
    assert.deepEqual(decoded.revision(), some(REVISION));
    assert.equal(decoded.page(0n, 2n).type, "none", "then starts the pinned fetch");
    await settle();
    const landed = decoded.page(0n, 2n);
    assert.equal(landed.type, "some");
    assert.equal(landed.value[0]!.id, "decoder-side");
    assert.equal(decoded.total().value, 2n);
});

test("#106 — createScopedPagedPlatform ships the binds and every backing primitive (e3 ui() task decode path)", () => {
    const names = new Set(createScopedPagedPlatform([opsPath]).map(p => p.name));
    for (const name of [
        "data_bind_paged", "data_bind_paged_pinned",
        "data_page", "data_page_total", "data_page_seek", "data_page_revision", "data_page_refresh",
    ]) {
        assert.ok(names.has(name), `scoped paged platform must include '${name}'`);
    }
    assert.equal(names.has("data_bind_paged_index"), false, "the index bind never shipped, and is gone");
});

test("the scoped platform refuses a path the manifest never declared", () => {
    const scoped = createScopedPagedPlatform([pathOf("inputs", "declared")]);
    for (const name of ["data_bind_paged", "data_bind_paged_pinned"]) {
        const bind = scoped.find(p => p.name === name);
        assert.ok(bind, name);
        // A generic platform impl's `fn` IS the curried factory: type params
        // first, then the value args.
        const build = (bind.fn as (t: unknown) => (p: unknown, i?: unknown, j?: unknown) => unknown)(rowsTypeValue);
        assert.throws(() => build(opsPath, none, false), /not declared in manifest/, name);
        assert.doesNotThrow(() => build(pathOf("inputs", "declared"), none, false), name);
    }
});

test("a UI exported before pinned reads still binds: data_bind_paged(path), exactly as released", () => {
    // Every UI package exported before pinned reads carries the one-argument
    // call and its four-field handle, and a platform call is checked against
    // its implementation's arity and return type exactly — so this declares
    // the call from the RELEASED signature, spelled out here rather than taken
    // from the current definitions, and compiles it against what the runtime
    // registers.
    const ReleasedHandle = StructType({
        id:    StringType,
        page:  FunctionType([IntegerType, IntegerType], OptionType("T")),
        total: FunctionType([], OptionType(IntegerType)),
        seek:  OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))),
    });
    const released = East.genericPlatform("data_bind_paged", ["T"], [TreePathType], ReleasedHandle, { optional: true });
    const body = East.function([], StringType, ($) => {
        const handle = $.let(released([RowsType], East.value(opsPath, TreePathType)));
        $.return(handle.id);
    });
    const exported = encodeEastIR(body.toIR());
    const bind = decodeEastIR(exported).compile(createScopedPagedPlatform([opsPath])) as () => string;
    assert.equal(bind(), datasetPathToString(opsPath), "the released call binds the dataset's own rows");
});

test("Data.bindPaged binds through data_bind_paged_pinned — plain and index reads, scoped to the path", () => {
    const plansPath = pathOf("records", "plans");
    const scoped = createScopedPagedPlatform([plansPath]);
    const bind = scoped.find(p => p.name === "data_bind_paged_pinned");
    assert.ok(bind, "the scoped platform ships the pinned bind");
    type Built = { id: string; revision?: unknown; refresh?: unknown };
    const build = (bind.fn as (t: unknown) => (p: unknown, i: unknown, j: unknown) => Built)(rowsTypeValue);
    // The selector is part of the handle's identity: two binds of one path
    // that read different indexes serve different rows.
    const plain = build(plansPath, none, false);
    assert.equal(plain.id, datasetPathToString(plansPath));
    assert.equal(build(plansPath, some("by_status"), false).id, `${datasetPathToString(plansPath)}@by_status`);
    assert.equal(build(plansPath, some("by_status"), true).id, `${datasetPathToString(plansPath)}@by_status+join`);
    assert.ok(plain.revision !== undefined && plain.refresh !== undefined, "the pinned handle carries revision and refresh");
    assert.throws(() => build(opsPath, some("by_status"), false), /not declared in manifest/);
});
