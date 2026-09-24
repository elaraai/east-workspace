/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DictType, FloatType, StringType, StructType, encodeBeast2For, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { DataPagedHandleType } from "@elaraai/e3-ui/internal";
import type { DatasetFindQuery, DatasetFindResult, DatasetPage } from "@elaraai/e3-api-client";
import { PagedRuntime, type PagedApi, type PagedWindow } from "../src/platform/paged-runtime.js";

const Rows = DictType(StringType, StructType({ quantity: FloatType }));
const Handle = DataPagedHandleType(Rows);
const path = [variant("field", "entries")];
const encode = encodeBeast2For(Rows);
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function harness() {
    const revisions: ReturnType<typeof deferred<string>>[] = [];
    const pages: { request: PagedWindow; result: ReturnType<typeof deferred<DatasetPage>> }[] = [];
    const seeks: { query: DatasetFindQuery; result: ReturnType<typeof deferred<DatasetFindResult>> }[] = [];
    const api: PagedApi = {
        getRevision() { const result = deferred<string>(); revisions.push(result); return result.promise; },
        getPage(_ws, _path, request) { const result = deferred<DatasetPage>(); pages.push({ request, result }); return result.promise; },
        findKey(_ws, _path, query) { const result = deferred<DatasetFindResult>(); seeks.push({ query, result }); return result.promise; },
    };
    const runtime = new PagedRuntime();
    runtime.initialize(api, "workspace");
    const handle = runtime.buildHandle(toEastTypeValue(Rows), path) as ValueTypeOf<typeof Handle>;
    function page(index: number, hash: string, quantity: number, total = 1) {
        const request = pages[index]!;
        const data = encode(new Map([["row", { quantity }]]));
        request.result.resolve({ data, hash, totalElements: total, totalBytes: data.length, totalExact: true, segmentCount: 1, offset: request.request.offset, count: 1 });
    }
    return { api, runtime, handle, revisions, pages, seeks, page };
}

test("pages and seek wait for one discovered snapshot, then both pin it", async () => {
    const h = harness();
    assert.deepEqual(h.handle.page(0n, 10n), none);
    assert.equal(h.handle.seek.type, "some");
    if (h.handle.seek.type !== "some") return;
    assert.deepEqual(h.handle.seek.value(variant("prefix", "r")), none);
    assert.equal(h.revisions.length, 1);
    assert.equal(h.pages.length, 0);
    assert.equal(h.seeks.length, 0);
    h.revisions[0]!.resolve("A");
    await tick();
    assert.equal(h.pages[0]!.request.hash, "A");
    assert.equal(h.seeks[0]!.query.hash, "A");
    h.page(0, "A", 1);
    h.seeks[0]!.result.resolve({ hash: "A", found: true, row: 0, count: 1 });
    await tick();
    assert.deepEqual(h.handle.revision(), some("A"));
    assert.deepEqual(h.handle.total(), some(1n));
    assert.deepEqual(h.handle.seek.value(variant("prefix", "r")), some({ found: true, row: 0n, count: 1n }));
});

test("targeted refresh preserves demand and ignores late page success and total publication", async () => {
    const h = harness();
    h.handle.page(0n, 10n);
    h.revisions[0]!.resolve("A");
    await tick();
    h.handle.refresh(some("B"));
    assert.deepEqual(h.handle.total(), none);
    await tick();
    assert.equal(h.pages[1]!.request.hash, "B");
    h.page(1, "B", 7, 3);
    await tick();
    h.page(0, "A", 1, 99);
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    assert.deepEqual(h.handle.total(), some(3n));
    const window = h.handle.page(0n, 10n);
    assert.equal(window.type, "some");
    if (window.type === "some") assert.equal(window.value.get("row")!.quantity, 7);
});

test("refresh invalidates answered seek results and ignores a superseded search error", async () => {
    const h = harness();
    if (h.handle.seek.type !== "some") throw new Error("expected keyed source");
    const seek = h.handle.seek.value;
    seek(variant("prefix", "r"));
    h.revisions[0]!.resolve("A");
    await tick();
    h.handle.refresh(some("B"));
    await tick();
    h.seeks[1]!.result.resolve({ hash: "B", found: true, row: 4, count: 2 });
    await tick();
    h.seeks[0]!.result.reject(new Error("late A failure"));
    await tick();
    assert.deepEqual(seek(variant("prefix", "r")), some({ found: true, row: 4n, count: 2n }));
    h.handle.refresh(some("C"));
    assert.deepEqual(seek(variant("prefix", "r")), none);
    await tick();
    assert.equal(h.seeks[2]!.query.hash, "C");
});

test("superseded discovery cannot roll back a target snapshot or start stale demand", async () => {
    const h = harness();
    h.handle.page(0n, 10n);
    h.handle.refresh(some("B"));
    await tick();
    h.revisions[0]!.resolve("A");
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    assert.deepEqual(h.pages.map(p => p.request.hash), ["B"]);
});

test("shared handles observe refresh(none), including same-length updates", async () => {
    const h = harness();
    const other = h.runtime.buildHandle(toEastTypeValue(Rows), path) as ValueTypeOf<typeof Handle>;
    h.handle.page(0n, 10n);
    h.revisions[0]!.resolve("A");
    await tick();
    h.page(0, "A", 1);
    await tick();
    other.refresh(none);
    await tick();
    assert.deepEqual(h.handle.revision(), none);
    assert.deepEqual(other.total(), none);
    h.revisions[1]!.resolve("B");
    await tick();
    h.page(1, "B", 2);
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    assert.deepEqual(other.total(), some(1n));
    const window = other.page(0n, 10n);
    if (window.type !== "some") throw new Error("expected refreshed window");
    assert.equal(window.value.get("row")!.quantity, 2);
});

test("clear and reinitialize cannot let an old response overwrite a new window", async () => {
    const h = harness();
    h.handle.page(0n, 10n);
    h.revisions[0]!.resolve("A");
    await tick();
    h.runtime.clear();
    h.runtime.initialize(h.api, "workspace");
    h.handle.page(0n, 10n);
    h.revisions[1]!.resolve("B");
    await tick();
    h.page(1, "B", 8);
    await tick();
    h.page(0, "A", 1, 900);
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    assert.deepEqual(h.handle.total(), some(1n));
});

test("a server response for another hash is never exposed as the pinned snapshot", async () => {
    const h = harness();
    h.handle.page(0n, 10n);
    h.revisions[0]!.resolve("A");
    await tick();
    const log = console.error;
    console.error = () => {};
    try {
        h.page(0, "wrong", 5, 9);
        await tick();
    } finally {
        console.error = log;
    }
    // The mismatched page is that window's failure (#811): a read names it
    // rather than serving the other snapshot's rows, and it teaches no total.
    assert.throws(() => h.handle.page(0n, 10n), /does not match the requested content revision/);
    assert.deepEqual(h.handle.total(), none);
});


test("a synchronous read during targeted refresh cannot discover a competing current hash", async () => {
    const h = harness();
    h.handle.page(0n, 10n);
    h.revisions[0]!.resolve("A");
    await tick();
    h.handle.refresh(some("B"));
    assert.deepEqual(h.handle.revision(), none);
    assert.deepEqual(h.handle.page(0n, 10n), none);
    assert.equal(h.revisions.length, 1, "an exact target never starts current-content discovery");
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    assert.equal(h.pages[1]!.request.hash, "B");
});

test("a bound source follows its dataset: a new content hash moves it to that revision (#821)", async () => {
    const h = harness();
    const watchers: ((hash: string | null) => void)[] = [];
    let stopped = 0;
    h.runtime.initialize({
        ...h.api,
        watchRevision: (_ws, _path, onRevision) => {
            watchers.push(onRevision);
            return () => { stopped += 1; };
        },
    }, "workspace");
    h.handle.page(0n, 10n);
    assert.equal(watchers.length, 1, "the source watches its dataset from its first read");
    h.revisions[0]!.resolve("A");
    await tick();
    h.page(0, "A", 1);
    await tick();
    // The revision it serves: nothing to do.
    watchers[0]!("A");
    await tick();
    assert.equal(h.pages.length, 1);
    // The dataset was written: the source moves to B, pinned there.
    watchers[0]!("B");
    await tick();
    assert.equal(h.pages[1]!.request.hash, "B");
    h.page(1, "B", 7);
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    const window = h.handle.page(0n, 10n);
    if (window.type !== "some") throw new Error("expected the new revision's window");
    assert.equal(window.value.get("row")!.quantity, 7);
    // A dataset that holds no value leaves the served snapshot standing.
    watchers[0]!(null);
    await tick();
    assert.deepEqual(h.handle.revision(), some("B"));
    h.runtime.clear();
    assert.equal(stopped, 1, "clearing the runtime stops the watch");
});

test("a pinned read refused because the dataset moved rediscovers — never a window failure (#821)", async () => {
    const h = harness();
    h.handle.page(0n, 10n);
    h.revisions[0]!.resolve("A");
    await tick();
    h.pages[0]!.result.reject(Object.assign(new Error("Dataset content is B, not A"), { code: "dataset_hash_mismatch" }));
    await tick();
    // In flight again, not failed: the source is finding its revision.
    assert.deepEqual(h.handle.page(0n, 10n), none);
    assert.equal(h.revisions.length, 2);
    h.revisions[1]!.resolve("B");
    await tick();
    assert.equal(h.pages[1]!.request.hash, "B");
    h.page(1, "B", 3);
    await tick();
    assert.equal(h.handle.page(0n, 10n).type, "some");
});

test("a pinned key search refused because the dataset moved rediscovers too (#821)", async () => {
    const h = harness();
    if (h.handle.seek.type !== "some") throw new Error("expected keyed source");
    const seek = h.handle.seek.value;
    seek(variant("prefix", "r"));
    h.revisions[0]!.resolve("A");
    await tick();
    h.seeks[0]!.result.reject(Object.assign(new Error("stale pin"), { code: "dataset_hash_mismatch" }));
    await tick();
    assert.deepEqual(seek(variant("prefix", "r")), none);
    h.revisions[1]!.resolve("B");
    await tick();
    assert.equal(h.seeks[1]!.query.hash, "B");
});
