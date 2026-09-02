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
 * both handle methods stay IR-bearing `East.function`s over the `data_page*`
 * primitives, capturing nothing but the plain-data source path.
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
    FloatType,
    StringType,
    StructType,
    variant,
    toEastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
} from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import { DataPagedHandleType } from "@elaraai/e3-ui/internal";
import type { DatasetPage } from "@elaraai/e3-api-client";
import { PagedRuntime, createScopedPagedPlatform, type PagedApi } from "../src/platform/paged-runtime.js";

const ws = "ws";
const pathOf = (...segs: string[]): TreePath => segs.map(s => variant("field", s));
const opsPath = pathOf("inputs", "ops");

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
                segmentCount: 0, offset: window.offset, count: slice.length, hash: "",
            };
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
    const handle = runtime.buildHandle(rowsTypeValue, opsPath);
    assert.doesNotThrow(() => encodeBeast2For(HandleType)(handle as never));
});

test("#106 — page() round-trips and re-binds to the DECODER's runtime", async () => {
    const enc = newRuntime([{ id: "encoder-side", v: 0.0 }]);
    const bytes = encodeBeast2For(HandleType)(enc.buildHandle(rowsTypeValue, opsPath) as never);

    // A different runtime, with different data behind the same path: a decoded
    // handle must read through the DECODER, never carry the encoder's answers.
    const dec = newRuntime([{ id: "decoder-side", v: 7.0 }, { id: "b", v: 8.0 }]);
    const decoded = decodeBeast2For(HandleType, { platform: dec.buildPrimitives() })(bytes) as unknown as {
        page: (o: bigint, l: bigint) => { type: string; value: { id: string }[] };
        total: () => { type: string; value: bigint };
    };

    assert.equal(decoded.page(0n, 2n).type, "none", "first read starts the fetch");
    await settle();
    const landed = decoded.page(0n, 2n);
    assert.equal(landed.type, "some");
    assert.equal(landed.value[0]!.id, "decoder-side");
    assert.equal(decoded.total().value, 2n);
});

test("#106 — createScopedPagedPlatform ships the backing primitives (e3 ui() task decode path)", () => {
    const names = new Set(createScopedPagedPlatform([opsPath]).map(p => p.name));
    for (const name of ["data_bind_paged", "data_page", "data_page_total"]) {
        assert.ok(names.has(name), `scoped paged platform must include '${name}'`);
    }
});

test("the scoped platform refuses a path the manifest never declared", () => {
    const scoped = createScopedPagedPlatform([pathOf("inputs", "declared")]);
    const bind = scoped.find(p => p.name === "data_bind_paged");
    assert.ok(bind);
    // A generic platform impl's `fn` IS the curried factory: type params
    // first, then the value args.
    const build = (bind.fn as (t: unknown) => (p: unknown) => unknown)(rowsTypeValue);
    assert.throws(() => build(opsPath), /not declared in manifest/);
    assert.doesNotThrow(() => build(pathOf("inputs", "declared")));
});
