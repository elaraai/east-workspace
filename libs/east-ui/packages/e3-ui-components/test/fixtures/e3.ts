/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3 itself under a runtime spec (#1378), as it is under a DOM test
 * (`src/e3-web-mount.test-utils.tsx`): {@link e3Spec} starts e3-web for the
 * spec's file with the e3-ui example modules it names deployed
 * (`startTestE3`), and gives each test a workspace of its own, a copy of the
 * deployed one. A runtime reads e3 through its default API — the dataset
 * cache's, the paged, record and function runtimes' — over the harness's fetch
 * ({@link E3Spec.options}): what a spec counts it reads from the request log,
 * a fault is one at that fetch (`h.e3.hold`, `h.e3.fail`), and another
 * session's change goes in through e3's API. An e3-ui East function — a tag's
 * payload, a Schedule kind — compiles against the platform its UI task's
 * preview would give it ({@link E3Spec.platform}), so what it reads is e3's.
 * A read answers `none` until what it waits on lands: a spec reads it until it
 * does ({@link E3Spec.ready}), or until a hold holds what it waits on, to see
 * it in flight ({@link E3Spec.inFlight}).
 *
 * @packageDocumentation
 */

import { after, afterEach, before, beforeEach } from "node:test";
import { toEastTypeValue, type EastType, type option, type StructType, type ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { workspaceCopy, type RecordHistoryResult, type RequestOptions } from "@elaraai/e3-api-client";
import { deriveManifest, type DataManifest } from "@elaraai/e3-ui/internal";
import {
    patchRecord, readDataset, recordHistory, runDataflow, settleE3, startTestE3, workspaceRequests, writeDataset,
    type E3Dataset, type E3Hold, type E3Record, type E3Request, type TestE3,
} from "../../src/e3-web.test-utils.js";
import { BindRuntime } from "../../src/platform/bind-runtime.js";
import { ReactiveDatasetCache, createDefaultDatasetApi, datasetPathToString, type Visibility } from "../../src/platform/dataset-store.js";
import { FuncRuntime, createDefaultFunctionApi } from "../../src/platform/func-runtime.js";
import { PagedRuntime, createDefaultPagedApi } from "../../src/platform/paged-runtime.js";
import { RecordRuntime, createDefaultRecordApi } from "../../src/platform/record-runtime.js";
import { MemoryStagedAdapter, StagedStore } from "../../src/platform/staged-store.js";
import { createFakeClock, type FakeClock } from "./fake-clock.js";

/** How {@link E3Spec.cache} makes a cache. */
export interface E3CacheOptions {
    /** The workspace it reads; the test's own unless given. */
    readonly workspace?: string;
    /** Whether the page is hidden, as the cache sees it; the document's unless given. */
    readonly visibility?: Visibility;
    /** The interval its polls run at while what they show changes; the cache's default unless given. */
    readonly pollIntervalMs?: number;
    /** The longest its polls back off to; the cache's default unless given. */
    readonly pollBackoffMs?: number;
}

/** A dataset cache over e3 in the test's workspace, and the clock its polls are timed by. */
export interface E3Cache {
    /** The cache, over e3's dataset API through the harness's fetch. */
    readonly cache: ReactiveDatasetCache;
    /** Times its polls: nothing polls until the test moves it. */
    readonly clock: FakeClock;
}

/** A record bound through a record runtime over e3 — {@link E3Spec.bindRecord}. */
export interface E3BoundRecord extends E3Cache {
    /** The runtime: e3's record API for its writes, the cache for its reads. */
    readonly runtime: RecordRuntime;
    /** The handle bound to the record, as `Record.bind` builds it. */
    readonly handle: unknown;
}

/** e3's runtimes in a workspace, as a UI task's preview gives them, and the platform they give an East function — {@link E3Spec.platform}. */
export interface E3Platform extends E3Cache {
    /** What the function binds, derived as e3 derives a UI task's manifest. */
    readonly manifest: DataManifest;
    /** What the function is compiled against: each runtime's bind and its primitives, scoped to the manifest. */
    readonly platform: PlatformFunction[];
    /** `Data.bind`'s runtime, its staged buffers in memory. */
    readonly data: BindRuntime;
    /** `Data.bindPaged`'s runtime, over e3's paging API. */
    readonly pages: PagedRuntime;
    /** `Record.bind`'s runtime, over e3's record API. */
    readonly records: RecordRuntime;
    /** `Func.bind`'s runtime, over e3's function API. */
    readonly functions: FuncRuntime;
}

/** A spec file's e3, and what each test does with it: see {@link e3Spec}. */
export interface E3Spec {
    /** e3 under test: its fetch, its request log, its holds and faults. */
    readonly e3: TestE3;
    /** The test's own workspace: a fresh copy of the deployed package. */
    readonly workspace: string;
    /** e3's client's options over the harness's fetch, read as each request is made: what a runtime's default API is given. */
    readonly options: () => RequestOptions;
    /** Settles once no request to e3 is in flight — those a hold parks aside — and what they settled has run. */
    settle(): Promise<void>;
    /**
     * Reads until the read is answered, settling between reads: a read that
     * is not launches what it waits on — the revision, then the searches and
     * the windows — and e3 answers it before the next read.
     *
     * @param read - The read: `none` until what it waits on has landed
     * @returns What it answered
     * @throws {Error} When it has not answered in {@link READS} reads — what it waits on is held, or failed
     */
    ready<T>(read: () => option<T>): Promise<T>;
    /**
     * Reads until a hold holds a request the read waits on, settling between
     * reads, then reads once more with everything else settled: what the read
     * answers while that request is in flight.
     *
     * @param read - The read
     * @param hold - The hold, over what the read waits on
     * @returns What the read answers then — `none`, for a read that waits on what the hold holds
     * @throws {Error} When the read is answered before the hold holds anything, or the hold holds nothing in {@link READS} reads
     */
    inFlight<T>(read: () => option<T>, hold: E3Hold): Promise<option<T>>;
    /**
     * What e3 holds of a dataset or a record now, in the test's workspace.
     *
     * @param dataset - The dataset or record
     * @returns Its value
     */
    read<T extends EastType>(dataset: E3Dataset<T>): Promise<ValueTypeOf<T>>;
    /**
     * Writes a dataset as another session would.
     *
     * @param dataset - The dataset
     * @param value - Its new value
     */
    write<T extends EastType>(dataset: E3Dataset<T>, value: ValueTypeOf<T>): Promise<void>;
    /**
     * Commits a record's new state as another session would, through its patch door.
     *
     * @param record - The record, which declares a patch mutation
     * @param next - Its new state
     */
    patch<T extends EastType>(record: E3Record<T>, next: ValueTypeOf<T>): Promise<void>;
    /**
     * A record's commits in the test's workspace, newest first.
     *
     * @param record - The record
     * @returns Its history
     */
    history(record: { readonly name: string }): Promise<RecordHistoryResult>;
    /** Runs the test's workspace's dataflow, as another session's run would. */
    run(): Promise<void>;
    /**
     * Replaces the test's workspace with one the package is freshly deployed
     * to, its dataflow not run, as another session resetting it would: each
     * input holds its default, and each task's output has no value until the
     * next run ({@link run}).
     */
    unrun(): Promise<void>;
    /**
     * The requests made of the test's workspace so far.
     *
     * @param kind - Only those of this kind (`read`, `find`, `page`, …)
     * @param of - Only those naming this dataset (`records.jobs`) or record (`jobs`)
     * @returns The requests, in order
     */
    requests(kind?: E3Request["kind"], of?: string): E3Request[];
    /**
     * A dataset cache over e3 — the one a page's provider makes, its polls
     * timed by a clock the test drives — destroyed as the test ends.
     *
     * @param options - The workspace it reads (the test's own unless given), whether the page is hidden as the
     *   cache sees it (the document's unless given), and the intervals its polls run at
     * @returns The cache and its clock
     */
    cache(options?: E3CacheOptions): E3Cache;
    /**
     * A record bound through a record runtime over e3 in the test's workspace:
     * its writes through e3's record API, its reads through a cache of its own
     * ({@link cache}).
     *
     * @param record - The record
     * @param handleType - The handle's type, as `RecordBindHandleType` gives it
     * @param options - `whole`: the record read whole, as a surface that reads it whole holds it — loaded into the
     *   cache and polled, so another session's commit reaches it at the next poll (`cache.refresh`). Otherwise
     *   nothing of it is loaded: a read of it whole throws.
     * @returns The cache, the runtime and the handle
     */
    bindRecord(record: { readonly name: string; readonly path: E3Dataset["path"] }, handleType: StructType,
        options?: { readonly whole?: boolean }): Promise<E3BoundRecord>;
    /**
     * The platform a UI task's East function runs on over e3, as its preview
     * gives it: the function's manifest derived, each dataset and record it
     * reads whole loaded into a cache of its own and polled, and each
     * runtime's bind scoped to what the manifest names — so what the function
     * reads is e3's, and a read it does not declare is refused. The runtimes
     * are cleared as the test ends.
     *
     * @param program - The East function, whose IR names what it binds
     * @param options - The workspace it reads; the test's own unless given
     * @returns The manifest, the runtimes, their cache and its clock, and the platform
     */
    platform(program: Parameters<typeof deriveManifest>[0], options?: { readonly workspace?: string }): Promise<E3Platform>;
}

/** The timer real time passes on, as the spec started with it: a test whose clock is mocked settles on it too. */
const realSetTimeout = globalThis.setTimeout;

/** Lets real time pass for a few turns, so what e3's answers settled runs. */
async function turns(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

/**
 * The most reads {@link E3Spec.ready} and {@link E3Spec.inFlight} make before
 * giving up on a read: each read launches the next request its answer waits
 * on, and the longest a runtime makes — a revision, a search, a window and the
 * next — is a few.
 */
const READS = 16;

/**
 * Gives a spec file its e3, and each test a workspace of its own.
 *
 * Called as the file loads. Before the file's tests, e3-web starts with the
 * package of the given example modules deployed and its dataflow run once
 * (`startTestE3`); before each test, the test gets a fresh copy of the deployed
 * workspace; after each, its holds and faults stop, the request log empties
 * and what the test left in flight settles.
 *
 * @param modules - Each e3-ui example module the spec reads, by its key under e3-ui's `test/` (`bind/record/record`), as the spec imports it
 * @returns The spec's e3
 */
export function e3Spec(modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>): E3Spec {
    const state: { e3: TestE3 | undefined; workspace: string | undefined } = { e3: undefined, workspace: undefined };
    const e3 = (): TestE3 => {
        if (state.e3 === undefined) throw new Error("e3 has not started: the spec's before hook has not run");
        return state.e3;
    };
    const workspace = (): string => {
        if (state.workspace === undefined) throw new Error("the test has no workspace: the spec's beforeEach hook has not run");
        return state.workspace;
    };
    /** The caches the test made, destroyed as it ends. */
    const caches: ReactiveDatasetCache[] = [];
    /** What lets go of the runtimes the test made, as it ends. */
    const clears: (() => void)[] = [];
    // The first deploy pays for every record's initial value and index.
    before(async () => { state.e3 = await startTestE3(modules); }, { timeout: 120_000 });
    after(() => { state.e3?.close(); state.e3 = undefined; });
    beforeEach(async () => {
        state.workspace = await e3().workspace();
        e3().reset();
    });
    afterEach(async () => {
        // A request a hold parks goes on, so what the test started can settle.
        state.e3?.reset();
        await state.e3?.idle();
        for (const clear of clears.splice(0)) clear();
        for (const cache of caches.splice(0)) cache.destroy();
        state.workspace = undefined;
    });
    const cache = (options: E3CacheOptions = {}): E3Cache => {
        const clock = createFakeClock();
        const config = {
            workspace: options.workspace ?? workspace(),
            ...(options.pollIntervalMs !== undefined && { pollIntervalMs: options.pollIntervalMs }),
            ...(options.pollBackoffMs !== undefined && { pollBackoffMs: options.pollBackoffMs }),
        };
        const made = new ReactiveDatasetCache(config, createDefaultDatasetApi(e3().apiUrl, e3().repo, () => e3().options), clock, options.visibility);
        caches.push(made);
        return { cache: made, clock };
    };
    return {
        get e3() { return e3(); },
        get workspace() { return workspace(); },
        options: () => e3().options,
        settle: () => settleE3(state.e3, turns),
        async ready(read) {
            for (let reads = 0; reads < READS; reads++) {
                const value = read();
                if (value.type === "some") return value.value;
                await settleE3(state.e3, turns);
            }
            throw new Error(`the read was not answered in ${READS} reads: what it waits on is held, or failed`);
        },
        async inFlight(read, hold) {
            for (let reads = 0; reads < READS; reads++) {
                const value = read();
                await settleE3(state.e3, turns);
                if (hold.held > 0) return read();
                if (value.type === "some") throw new Error("the read was answered before the hold held anything it waits on");
            }
            throw new Error(`the hold held nothing the read waits on in ${READS} reads`);
        },
        read: (dataset) => readDataset(e3(), workspace(), dataset),
        write: (dataset, value) => writeDataset(e3(), workspace(), dataset, value),
        async patch(record, next) { await patchRecord(e3(), workspace(), record, next); },
        history: (record) => recordHistory(e3(), workspace(), record),
        run: () => runDataflow(e3(), workspace()),
        async unrun() {
            await workspaceCopy(e3().apiUrl, e3().repo, await e3().unrun(), workspace(), e3().direct);
        },
        requests: (kind, of) => workspaceRequests(e3(), workspace(), kind, of),
        cache,
        async bindRecord(record, handleType, options = {}) {
            const held = cache();
            if (options.whole === true) {
                await held.cache.preload(workspace(), record.path);
                held.cache.setRefetchInterval(workspace(), record.path);
                await settleE3(state.e3, turns);
            }
            const runtime = new RecordRuntime();
            runtime.initialize(createDefaultRecordApi(e3().apiUrl, e3().repo, () => e3().options), held.cache, workspace());
            return { ...held, runtime, handle: runtime.buildHandle(toEastTypeValue(handleType), record.name) };
        },
        async platform(program, options = {}) {
            const at = options.workspace ?? workspace();
            const held = cache(options.workspace === undefined ? {} : { workspace: options.workspace });
            const manifest = deriveManifest(program);
            // As a UI task's preview loads what it reads whole, and polls it while it shows.
            for (const path of manifest.paths) {
                await held.cache.preload(at, path);
                held.cache.setRefetchInterval(at, path);
            }
            await settleE3(state.e3, turns);
            const staged = new StagedStore(new MemoryStagedAdapter());
            await staged.ready();
            const data = new BindRuntime(staged);
            data.initializeCache(held.cache);
            const pages = new PagedRuntime();
            pages.initialize(createDefaultPagedApi(e3().apiUrl, e3().repo, () => e3().options, held.cache), at);
            const records = new RecordRuntime();
            records.initialize(createDefaultRecordApi(e3().apiUrl, e3().repo, () => e3().options), held.cache, at);
            const functions = new FuncRuntime();
            functions.initialize(createDefaultFunctionApi(e3().apiUrl, e3().repo, () => e3().options), at);
            clears.push(() => { pages.clear(); records.clear(); functions.clear(); data.clearCache(held.cache); });
            const paths = new Set(manifest.paths.map(datasetPathToString));
            const paged = new Set(manifest.pages.map(datasetPathToString));
            const platform = [
                data.buildPlatform(paths), ...data.buildPrimitives(),
                pages.buildPlatform(paged), pages.buildPinnedPlatform(paged), ...pages.indexed.platform(paged), ...pages.buildPrimitives(),
                functions.buildPlatform(new Set(manifest.functions)), ...functions.buildPrimitives(),
                records.buildPlatform(new Set(manifest.records)), ...records.buildPrimitives(),
            ];
            return { ...held, manifest, platform, data, pages, records, functions };
        },
    };
}
