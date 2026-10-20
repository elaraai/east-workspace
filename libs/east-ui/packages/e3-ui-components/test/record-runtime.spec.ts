/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `RecordRuntime` — the `Record.bind` platform runtime — on e3
 * itself (#1378): its default API describes, mutates and reads the history of
 * the records the Record.bind examples' module deploys (the counter, with its
 * increment, reset and take, and the jobs, with their patch door), and its
 * read side is the dataset cache's, over e3 too. A write in flight is one the
 * harness holds on its way to e3, a lost answer or a refused history is a fault
 * there, another session's write is a real commit, and a write past e3's
 * deadline is one whose unit the harness holds as it starts while the clock e3
 * times it by moves on. What a test counts it reads from the request log, and
 * terminal states are awaited by settling on e3's requests.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    IntegerType,
    PatchType,
    SortedMap,
    StringType,
    StructType,
    compareFor,
    decodeBeast2For,
    diffFor,
    isValueOf,
    toEastTypeValue,
    variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { RecordBindHandleType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/record/record";
import { MutationCallRequestType, RecordCommitInfoType, type TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../src/e3-web.test-utils.js";
import {
    RecordRuntime,
    createDefaultRecordApi,
    recordChannelKey,
    signatureOfRecordHandleType,
} from "../src/platform/record-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/record/record": ex });

/** e3's deadline for a mutation that names none: what its reducer's unit runs under. */
const MUTATION_DEADLINE_MS = 60_000;

type Job = ValueTypeOf<typeof ex.JobType>;
const CUT: Job = { task: "Cut", qty: 2n };

const CounterHandle = RecordBindHandleType(IntegerType, { increment: [IntegerType], take: [IntegerType] });
const JobsType = ex.jobs.type;
const JobsHandleType = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)] });
/** A handle on the counter, as `Record.bind` builds it. */
type Handle = ValueTypeOf<typeof CounterHandle>;
/** A handle on the jobs record, through its patch door. */
type JobsHandle = ValueTypeOf<typeof JobsHandleType>;

/** A patch of the jobs that takes job `a` from `before` to `after`, as a client drafts it from what it read. */
function jobUpdate(before: Job, after: Job): unknown {
    return variant("patch", new SortedMap([["a", variant("update", diffFor(ex.JobType)(before, after))]], compareFor(StringType)));
}

/** Whether a request runs the mutation named. */
const mutates = (name: string) => (request: E3Request) => request.kind === "mutate" && request.name === name;

/**
 * A runtime over e3's record API in the test's workspace, its read side a
 * dataset cache that has loaded the record and polls it, and a handle bound to
 * it.
 *
 * @param record - The record the handle binds; the counter unless given
 * @param handleType - The handle's type; the counter's unless given
 */
async function newRuntime(record: { readonly name: string; readonly path: TreePath } = ex.counter, handleType: StructType = CounterHandle) {
    const bound = await h.bindRecord(record, handleType, { whole: true });
    return { ...bound, handle: bound.handle as Handle };
}

/** The runtime over the jobs record, once another session has committed job `a` as `CUT`. */
async function jobsRuntime() {
    await h.patch(ex.jobs, new SortedMap([["a", CUT]], compareFor(StringType)));
    const made = await newRuntime(ex.jobs, JobsHandleType);
    return { ...made, handle: made.handle as unknown as JobsHandle };
}

/**
 * Settles once a handle's write has ended, as its channel tells: however long
 * e3's client waits between its tries of a write the network failed, which no
 * request in flight shows.
 *
 * @param runtime - The runtime the handle is bound through
 * @param record - The record the handle writes
 * @param handle - The handle
 */
function ended(runtime: RecordRuntime, record: string, handle: Handle): Promise<void> {
    return new Promise((resolve) => {
        let off = () => {};
        const check = () => {
            if (handle.mutate.status().type === "running") return;
            off();
            resolve();
        };
        off = runtime.subscribe(recordChannelKey(h.workspace, record), check);
        check();
    });
}

/** The arguments the mutation requests sent, each decoded as an Integer. */
function sentIntegers(name: string): bigint[] {
    return h.requests("mutate").filter(mutates(name)).map((request) =>
        decodeBeast2For(IntegerType)(decodeBeast2For(MutationCallRequestType)(request.body!).args[0]!));
}

// =============================================================================
// signatureOfRecordHandleType
// =============================================================================

describe("signatureOfRecordHandleType (record)", () => {
    test("recovers the state type and per-mutation arg types", () => {
        const sig = signatureOfRecordHandleType(toEastTypeValue(RecordBindHandleType(IntegerType, { increment: [IntegerType], add: [IntegerType, StringType] })));
        assert.equal(sig.stateType.type, "Integer");
        assert.equal(sig.mutations.get("increment")!.length, 1);
        assert.equal(sig.mutations.get("increment")![0]!.type, "Integer");
        assert.equal(sig.mutations.get("add")!.length, 2);
        assert.equal(sig.mutations.get("add")![1]!.type, "String");
    });

    test("rejects a non-struct handle type", () => {
        assert.throws(() => signatureOfRecordHandleType(toEastTypeValue(IntegerType)), /must be a Struct/);
    });
});

// =============================================================================
// Read side (via cache)
// =============================================================================

describe("RecordRuntime — read side", () => {
    test("read() decodes the state the cache loaded from e3", async () => {
        const { handle } = await newRuntime();
        assert.equal(handle.read(), 0n);
    });

    test("read() throws when the record is not loaded", async () => {
        const { handle: bound } = await h.bindRecord(ex.counter, CounterHandle);
        const handle = bound as Handle;
        assert.throws(() => handle.read(), /not loaded/);
    });

    test("binding lists the record name + mutation names from the handle type", async () => {
        const { handle } = await newRuntime();
        assert.equal(handle.binding.name, "counter");
        assert.deepEqual(handle.binding.mutations, ["increment", "take"]);
    });
});

// =============================================================================
// Mutation lifecycle
// =============================================================================

describe("RecordRuntime — mutation lifecycle", () => {
    test("idle until first mutation; running while in flight; committed once e3 commits", async () => {
        const { handle } = await newRuntime();
        assert.equal(handle.mutate.status().type, "idle");
        assert.equal(handle.mutate.pending(), false);

        const held = h.e3.hold(mutates("increment"));
        handle.mutate.increment(5n);
        await held.holding;
        assert.equal(handle.mutate.status().type, "running");
        assert.equal(handle.mutate.pending(), true);

        held.release();
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");
        assert.equal(handle.mutate.error().type, "none");
        assert.equal(handle.mutate.pending(), false);
        assert.equal(await h.read(ex.counter), 5n);
    });

    test("args are beast2-encoded per the mutation's declared types", async () => {
        const { handle } = await newRuntime();
        handle.mutate.increment(7n);
        await h.settle();
        assert.deepEqual(sentIntegers("increment"), [7n]);
        assert.equal(await h.read(ex.counter), 7n);
    });

    test("a committed mutation refreshes the dataset cache once: one status poll, which loads the record's new state", async () => {
        // The record is read whole, and polled.
        const { handle } = await newRuntime();
        const polls = h.requests("status").length;

        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");
        assert.equal(h.requests("status").length, polls + 1);
        assert.equal(handle.read(), 1n);
    });

    test("a write another session's commit left stale maps onto a conflict", async () => {
        const { handle } = await jobsRuntime();
        await h.patch(ex.jobs, new SortedMap([["a", { task: "Cut", qty: 5n }]], compareFor(StringType)));

        // Drafted from the job as the runtime read it: a cut of 2.
        handle.mutate.patch(jobUpdate(CUT, { task: "Cut", qty: 3n }));
        await h.settle();
        assert.equal(handle.mutate.status().type, "failed");
        assert.equal(handle.mutate.error().value!.kind.type, "conflict");
    });

    test("a reducer that fails maps onto failed, with its exit code and stderr", async () => {
        const { handle } = await newRuntime();
        handle.mutate.take(5n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "failed");
        const error = handle.mutate.error().value!;
        assert.equal(error.kind.type, "failed");
        assert.match(error.message, /reducer exited with code/);
        assert.match(error.stderr, /the counter holds fewer than that/);
    });

    test("a mutation past e3's deadline maps onto timed_out", async (t) => {
        const { runtime, handle } = await newRuntime();
        // e3 times a mutation's reducer from when it starts it: held as it starts, it runs on past its deadline while
        // the clock e3 times it by moves on. The clock is e3's until the write has ended: e3 clears its deadline's
        // timer as the run stops, which only the clock that set it knows. e3 serves a reducer it has run over the same
        // state and arguments from its execution cache, the repository's, so this write's amount is its own.
        const units = h.e3.holdUnits();
        t.mock.timers.enable({ apis: ["setTimeout"] });
        handle.mutate.increment(60n);
        await units.holding;
        t.mock.timers.tick(MUTATION_DEADLINE_MS);
        await ended(runtime, ex.counter.name, handle);
        t.mock.timers.reset();
        await h.settle();
        assert.equal(handle.mutate.status().type, "failed");
        assert.equal(handle.mutate.error().value!.kind.type, "timed_out");
        assert.match(handle.mutate.error().value!.message, new RegExp(`timed out after ${MUTATION_DEADLINE_MS}ms`));
    });

    test("a write the network never carries maps to failed / transport, and refreshes nothing", async () => {
        const { runtime, handle } = await newRuntime();
        const polls = h.requests("status").length;

        h.e3.fail(mutates("increment"), "network");
        handle.mutate.increment(1n);
        // e3's client tries the write again after the network fails it, and gives up after its last try.
        await ended(runtime, ex.counter.name, handle);
        await h.settle();
        assert.equal(handle.mutate.error().value!.kind.type, "transport");
        assert.equal(h.requests("status").length, polls, "no refresh");
        assert.equal(await h.read(ex.counter), 0n);
    });
});

// =============================================================================
// commit.<name> — the awaited write
// =============================================================================

describe("RecordRuntime — the awaited write", () => {
    test("commit.<name> runs on the mutate channel and resolves to e3's outcome", async () => {
        const { handle } = await newRuntime();
        const held = h.e3.hold(mutates("increment"));
        const written = handle.commit.increment("req-1", 5n);
        await held.holding;
        assert.equal(handle.mutate.status().type, "running");
        assert.equal(handle.mutate.pending(), true);

        held.release();
        const outcome = await written;
        assert.equal(outcome.type, "committed");
        const { commits } = await h.history(ex.counter);
        assert.equal(outcome.value["commitHash"], commits[0]!.hash, "the commit e3 made, the record's head");
        assert.equal(handle.mutate.status().type, "committed");
        assert.deepEqual(sentIntegers("increment"), [5n]);
    });

    test("the request id travels as the idempotency key, and a write without one sends none", async () => {
        const { handle } = await newRuntime();
        await handle.commit.increment("req-7", 1n);
        await handle.commit.increment("", 1n);
        const sent = h.requests("mutate").filter(mutates("increment"));
        assert.deepEqual(sent.map((request) => request.idempotencyKey), ["req-7", undefined]);
    });

    test("a conflict reads the record and its history again before it settles", async () => {
        const { runtime, handle } = await jobsRuntime();
        const key = recordChannelKey(h.workspace, ex.jobs.name);
        handle.history();
        await h.settle();
        assert.ok(runtime.getKeyVersion(key) > 0, "history loaded");
        assert.equal(handle.history().value!.length, 2, "the initial state, and the job another session committed");
        await h.patch(ex.jobs, new SortedMap([["a", { task: "Cut", qty: 5n }]], compareFor(StringType)));

        const outcome = await handle.commit.patch("req-2", jobUpdate(CUT, { task: "Cut", qty: 3n }));
        assert.equal(outcome.type, "conflict");
        // Settled only once both were read again: no wait needed to see them.
        assert.equal(handle.history().value!.length, 3);
        assert.equal(handle.read().get("a")!.qty, 5n);
        // A stale write is resubmitted from a fresh read, never retried as it was.
        assert.match(handle.mutate.error().value!.message, /no longer matches the record .*re-read it and resubmit/);
    });

    test("an unanswered call is a transport outcome, and so is a record that cannot be described", async () => {
        const { runtime, handle } = await newRuntime();
        h.e3.fail(mutates("increment"), "network");
        const lost = await handle.commit.increment("req-3", 1n);
        assert.equal(lost.type, "transport");
        assert.match(lost.value["message"] as string, /fetch failed/);

        const undescribed = runtime.buildHandle(toEastTypeValue(CounterHandle), "no_such_record") as unknown as Handle;
        assert.equal((await undescribed.commit.increment("", 1n)).type, "transport");
    });

    test("a mutation the deployed record lacks is invalid, and nothing is sent", async () => {
        // The jobs record's one mutation is its patch door: it has no increment.
        const { handle } = await newRuntime(ex.jobs);
        const outcome = await handle.commit.increment("req-4", 1n);
        assert.equal(outcome.type, "invalid");
        assert.deepEqual(h.requests("mutate"), []);
    });

    test("a handle type exported before the awaited write binds without it", async () => {
        const { runtime } = await newRuntime();
        const fields = RecordBindHandleType(IntegerType, { increment: [IntegerType] }).fields;
        const { commit: _commit, ...released } = fields;
        const handle = runtime.buildHandle(toEastTypeValue(StructType(released)), "counter-before") as Record<string, unknown>;
        assert.equal("commit" in handle, false);
        assert.equal(typeof (handle["mutate"] as Record<string, unknown>)["increment"], "function");
    });
});

// =============================================================================
// start() — launch the workspace dataflow
// =============================================================================

describe("RecordRuntime — start", () => {
    /** The dataflow runs the test's code launched. */
    const launches = () => h.requests("dataflow").filter((request) => request.method === "POST");

    test("start with no mutation in flight launches the workspace dataflow at once", async () => {
        const { handle } = await newRuntime();
        handle.start();
        await h.settle();
        assert.equal(launches().length, 1);
    });

    test("start drains an in-flight mutation before launching", async () => {
        const { handle } = await newRuntime();
        const held = h.e3.hold(mutates("increment"));
        handle.mutate.increment(1n);
        await held.holding;
        assert.equal(handle.mutate.status().type, "running");
        // The launch is asked for while the mutation is still in flight; it waits for it to settle.
        handle.start();
        await h.settle();
        assert.deepEqual(launches(), []);

        held.release();
        await h.settle();
        assert.equal(launches().length, 1);
        const order = h.requests().filter((request) => mutates("increment")(request) || launches().includes(request)).map((request) => request.kind);
        assert.deepEqual(order, ["mutate", "dataflow"], "the run reads the committed state");
    });
});

// =============================================================================
// Validation
// =============================================================================

describe("RecordRuntime — validation", () => {
    test("unknown mutation parks failed/invalid; nothing is sent", async () => {
        const { handle } = await newRuntime(ex.jobs);
        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "failed");
        assert.equal(handle.mutate.error().value!.kind.type, "invalid");
        assert.deepEqual(h.requests("mutate"), []);
    });

    test("arity mismatch parks failed/invalid; nothing is sent", async () => {
        // The counter's reset takes no argument; this handle gives it one.
        const { handle } = await newRuntime(ex.counter, RecordBindHandleType(IntegerType, { reset: [IntegerType] }));
        (handle.mutate as unknown as { reset: (n: bigint) => null }).reset(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "failed");
        assert.match(handle.mutate.error().value!.message, /signature mismatch/);
        assert.deepEqual(h.requests("mutate"), []);
    });

    test("describe is fetched once across many mutations", async () => {
        const { handle } = await newRuntime();
        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");
        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(h.requests("mutate").length, 2);
        assert.equal(h.requests("describe").length, 1);
    });
});

// =============================================================================
// Latest-wins + cancel
// =============================================================================

describe("RecordRuntime — latest-wins + cancel", () => {
    test("a superseded mutation's late response is discarded", async () => {
        const { handle } = await newRuntime();
        // The first write takes more than the counter will hold: e3 fails it, late.
        const first = h.e3.hold(mutates("take"));
        handle.mutate.take(100n);
        await first.holding;

        handle.mutate.increment(2n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");

        first.release();
        await h.settle();
        assert.equal(h.requests("mutate").filter(mutates("take")).length, 1, "e3 answered it");
        assert.equal(handle.mutate.status().type, "committed", "not clobbered by the stale failure");
    });

    test("cancel marks cancelled and discards the late response", async () => {
        const { handle } = await newRuntime();
        const held = h.e3.hold(mutates("increment"));
        handle.mutate.increment(1n);
        await held.holding;
        handle.mutate.cancel();
        assert.equal(handle.mutate.status().type, "cancelled");

        held.release();
        await h.settle();
        assert.equal(handle.mutate.status().type, "cancelled");
    });
});

// =============================================================================
// History
// =============================================================================

describe("RecordRuntime — history", () => {
    test("history() fetches once (none until loaded), then returns the chain, each commit of the binding's commit type", async () => {
        const { runtime, handle } = await newRuntime();
        // A commit e3 previews the arguments of, which the binding's commit type does not carry.
        handle.mutate.increment(3n);
        await h.settle();
        const key = recordChannelKey(h.workspace, ex.counter.name);
        const before = runtime.getKeyVersion(key);
        assert.equal(handle.history().type, "none");
        await h.settle();
        assert.ok(runtime.getKeyVersion(key) > before, "history loaded");
        assert.equal(handle.history().type, "some");
        assert.equal(handle.history().value!.length, 2, "the increment, and the initial state");
        assert.ok(isValueOf(handle.history().value![0], RecordCommitInfoType), "a RecordCommitInfo, and no more");
        assert.equal(h.requests("history").length, 1);
        // A second history() does not refetch.
        handle.history();
        await h.settle();
        assert.equal(h.requests("history").length, 1);
    });

    test("a committed mutation drops the history cache so the next history() refetches", async () => {
        const { handle } = await newRuntime();
        handle.history();
        await h.settle();
        assert.equal(h.requests("history").length, 1);

        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");
        // history cache dropped → next history() refetches.
        assert.equal(handle.history().type, "none");
        await h.settle();
        assert.equal(h.requests("history").length, 2);
        assert.equal(handle.history().value!.length, 2);
    });
});

// =============================================================================
// Tracking + scoping + lifecycle
// =============================================================================

describe("RecordRuntime — tracking, scoping, lifecycle", () => {
    test("mutate.* register the channel key while tracking", async () => {
        const { runtime, handle } = await newRuntime();
        runtime.enableTracking();
        handle.mutate.pending();
        handle.mutate.status();
        handle.mutate.error();
        const keys = runtime.disableTracking();
        assert.deepEqual(keys, [recordChannelKey(h.workspace, ex.counter.name)]);
    });

    test("clear() drops state and the api; status throws until re-init", async () => {
        const { cache, runtime, handle } = await newRuntime();
        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");
        runtime.clear();
        assert.throws(() => handle.mutate.status(), /no workspace configured/);
        runtime.initialize(createDefaultRecordApi(h.e3.apiUrl, h.e3.repo, h.options), cache, h.workspace);
        assert.equal(handle.mutate.status().type, "idle");
    });

    test("calling a mutation without a workspace throws a clear error", () => {
        const runtime = new RecordRuntime();
        const handle = runtime.buildHandle(toEastTypeValue(CounterHandle), ex.counter.name) as unknown as Handle;
        assert.throws(() => handle.mutate.increment(1n), /no workspace configured/);
    });
});

// =============================================================================
// history() — failed-fetch retry guard
// =============================================================================

describe("RecordRuntime — history retry guard", () => {
    test("a failing history fetch is not re-issued on every render", async () => {
        const { handle } = await newRuntime();
        h.e3.fail((request) => request.kind === "history", { status: 500, type: "internal", message: "the history is down" });
        // First read triggers a fetch that fails.
        assert.equal(handle.history().type, "none");
        await h.settle();
        assert.equal(h.requests("history").length, 1);
        // Subsequent reads must NOT re-issue while the failure stands.
        handle.history();
        handle.history();
        handle.history();
        await h.settle();
        assert.equal(h.requests("history").length, 1);
    });

    test("a commit clears the failed flag so history retries", async () => {
        const { handle } = await newRuntime();
        const recover = h.e3.fail((request) => request.kind === "history", { status: 500, type: "internal", message: "the history is down" });
        handle.history();
        await h.settle();
        assert.equal(h.requests("history").length, 1);
        // Recover, then commit a mutation — the commit drops the failed flag.
        recover();
        handle.mutate.increment(1n);
        await h.settle();
        assert.equal(handle.mutate.status().type, "committed");
        // Next read retries the now-recovered fetch.
        handle.history();
        await h.settle();
        assert.equal(h.requests("history").length, 2);
        assert.equal(handle.history().type, "some");
    });
});

// =============================================================================
// cancel() — clears the in-flight handle so start() doesn't drain it
// =============================================================================

describe("RecordRuntime — cancel clears inflight", () => {
    test("start() after cancel() launches without waiting on the cancelled mutation", async () => {
        const { handle } = await newRuntime();
        // Hold a mutation in flight, then cancel it: it is still held when the launch is asked for.
        const held = h.e3.hold(mutates("increment"));
        handle.mutate.increment(1n);
        await held.holding;
        handle.mutate.cancel();
        // start() must launch at once — if it still awaited the cancelled
        // mutation's inflight promise it would wait for the held write.
        handle.start();
        await h.settle();
        assert.equal(held.held, 1, "the cancelled write is still held");
        assert.equal(h.requests("dataflow").filter((request) => request.method === "POST").length, 1);
    });
});
