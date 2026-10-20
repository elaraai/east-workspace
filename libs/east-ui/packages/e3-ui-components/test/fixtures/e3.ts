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
 * session's change goes in through e3's API.
 *
 * @packageDocumentation
 */

import { after, afterEach, before, beforeEach } from "node:test";
import { toEastTypeValue, type EastType, type StructType, type ValueTypeOf } from "@elaraai/east";
import type { RecordHistoryResult, RequestOptions } from "@elaraai/e3-api-client";
import {
    patchRecord, readDataset, recordHistory, runDataflow, settleE3, startTestE3, workspaceRequests, writeDataset,
    type E3Dataset, type E3Record, type E3Request, type TestE3,
} from "../../src/e3-web.test-utils.js";
import { ReactiveDatasetCache, createDefaultDatasetApi } from "../../src/platform/dataset-store.js";
import { RecordRuntime, createDefaultRecordApi } from "../../src/platform/record-runtime.js";
import { createFakeClock, type FakeClock } from "./fake-clock.js";

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
     * The requests made of the test's workspace so far.
     *
     * @param kind - Only those of this kind (`read`, `find`, `page`, …)
     * @param of - Only those naming this dataset (`records.jobs`) or record (`jobs`)
     * @returns The requests, in order
     */
    requests(kind?: E3Request["kind"], of?: string): E3Request[];
    /**
     * A dataset cache over e3 in the test's workspace — the one a page's
     * provider makes, its polls timed by a clock the test drives — destroyed
     * as the test ends.
     *
     * @returns The cache and its clock
     */
    cache(): E3Cache;
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
}

/** The timer real time passes on, as the spec started with it: a test whose clock is mocked settles on it too. */
const realSetTimeout = globalThis.setTimeout;

/** Lets real time pass for a few turns, so what e3's answers settled runs. */
async function turns(): Promise<void> {
    for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
}

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
        for (const cache of caches.splice(0)) cache.destroy();
        state.workspace = undefined;
    });
    const cache = (): E3Cache => {
        const clock = createFakeClock();
        const made = new ReactiveDatasetCache({ workspace: workspace() }, createDefaultDatasetApi(e3().apiUrl, e3().repo, () => e3().options), clock);
        caches.push(made);
        return { cache: made, clock };
    };
    return {
        get e3() { return e3(); },
        get workspace() { return workspace(); },
        options: () => e3().options,
        settle: () => settleE3(state.e3, turns),
        read: (dataset) => readDataset(e3(), workspace(), dataset),
        write: (dataset, value) => writeDataset(e3(), workspace(), dataset, value),
        async patch(record, next) { await patchRecord(e3(), workspace(), record, next); },
        history: (record) => recordHistory(e3(), workspace(), record),
        run: () => runDataflow(e3(), workspace()),
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
    };
}
