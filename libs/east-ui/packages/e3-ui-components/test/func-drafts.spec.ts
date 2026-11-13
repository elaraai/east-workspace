/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bound function called over a page's drafts (#1620), on e3 itself: a page
 * of the print shop the Func.bind examples' module deploys binds its jobs and
 * its presses, whose handles make the drafts, and the functions that read
 * them, whose calls take the drafts — each through the platform a UI task's
 * preview gives it. e3 lays a call's drafts over the records its function
 * reads, runs the function over that state, and saves nothing, which each test
 * reads back from e3 itself: the record's state, its history, and a read of it
 * by the page and by another.
 *
 * Another page's Save is a real commit through the record's patch door before
 * the call; a draft a record refuses is refused by e3's own checks, as a Save
 * of it is; a call past its timeout is one whose first unit, its draft's, the
 * harness holds as it starts while the clock e3 times it by moves on; and a
 * host's refusal of a draft is a fault at the harness's fetch, since only a
 * host's auth refuses one. A draft whose unit a test holds is one no other
 * test here lays: e3 serves a mutation's program it has run before, over the
 * same state and arguments, from its execution cache, and starts no unit. A builder's pending Save handed over to a call —
 * a real editing session's, through a Sheet's own draft form — is
 * `src/sheet/sheet-draft-call.test.ts`'s, where a session runs.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    ArrayType, East, FloatType, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import {
    Func, FuncBindDraftsHandleType, FuncBindHandleType, FuncDraftedType, FuncErrorType, Record, RecordBindHandleType,
} from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/func/func";
import { workspaceCallGet, workspaceCallList } from "@elaraai/e3-api-client";
import { FunctionCallRequestType } from "@elaraai/e3-types";
import type { E3Request } from "../src/e3-web.test-utils.js";
import { funcChannelKey, type FuncRuntime } from "../src/platform/func-runtime.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "bind/func/func": ex });

/** e3's timeout for a call that names none: a call's drafts and its function run under it together, ten minutes. */
const CALL_TIMEOUT_MS = 600_000;

const JobType = ex.PressJobType;
const JobsType = ex.PressJobsType;
const ShopType = ex.PressesType;
const JobsHandleType = RecordBindHandleType(JobsType, { patch: [PatchType(JobsType)], move: [StringType, StringType] });
const ShopHandleType = RecordBindHandleType(ShopType, { patch: [PatchType(ShopType)] });
const CountHandleType = FuncBindDraftsHandleType([StringType], IntegerType);
const LoadHandleType = FuncBindDraftsHandleType([StringType], ex.PressLoadType);
const ForecastHandleType = FuncBindHandleType([IntegerType, FloatType], FloatType);
/** What the page binds: the shop's two records, the two functions that list them, and one that lists none. */
const PageType = StructType({
    jobs: JobsHandleType, shop: ShopHandleType, count: CountHandleType, load: LoadHandleType, forecast: ForecastHandleType,
});

type Job = ValueTypeOf<typeof JobType>;
type Jobs = ValueTypeOf<typeof JobsType>;
type Shop = ValueTypeOf<typeof ShopType>;
type Load = ValueTypeOf<typeof ex.PressLoadType>;
type Page = ValueTypeOf<typeof PageType>;

const keys = compareFor(StringType);
const sameJobs = equalFor(JobsType);
const sameShop = equalFor(ShopType);
const sameLoad = equalFor(OptionType(ex.PressLoadType));
const sameCount = equalFor(OptionType(IntegerType));
const sameDrafted = equalFor(ArrayType(FuncDraftedType));
const sameRequest = equalFor(FunctionCallRequestType);
const sameError = equalFor(OptionType(FuncErrorType));
const printJobs = printFor(JobsType);
const printLoad = printFor(OptionType(ex.PressLoadType));
const printCount = printFor(OptionType(IntegerType));
const printDrafted = printFor(ArrayType(FuncDraftedType));
const printRequest = printFor(FunctionCallRequestType);
const printError = printFor(OptionType(FuncErrorType));
const jobsPatch = diffFor(JobsType);
const shopPatch = diffFor(ShopType);
const asText = encodeBeast2For(StringType);

/** The jobs as the shop is deployed: j1 and j2 on P1, six hours between them, and j3 on P2. */
const SAVED: Jobs = new SortedMap([
    ["j1", { press: "P1", hours: 4n }],
    ["j2", { press: "P1", hours: 2n }],
    ["j3", { press: "P2", hours: 6n }],
], keys);
/** The presses as the shop is deployed: each runs eight hours a day. */
const SHOP: Shop = new SortedMap([
    ["P1", { name: "Offset", hoursPerDay: 8n }],
    ["P2", { name: "Digital", hoursPerDay: 8n }],
], keys);

/**
 * The saved jobs with one job set, the rest as they are.
 *
 * @param key - The job
 * @param job - What it holds
 */
function withJob(key: string, job: Job): Jobs {
    const next = new SortedMap([...SAVED], keys);
    next.set(key, job);
    return next;
}

/** The page: each record bound with every mutation it declares, each function bound from its definition. */
const page = East.function([], PageType, ($) => {
    const jobs = $.let(Record.bind(ex.pressJobs));
    const shop = $.let(Record.bind(ex.presses));
    const count = $.let(Func.bind(ex.jobsOnFn));
    const load = $.let(Func.bind(ex.pressLoadFn));
    const forecast = $.let(Func.bind(ex.forecastFn));
    return { jobs, shop, count, load, forecast };
});

/** The page opened over e3 as a UI task's preview opens it: what it binds, and the runtimes behind them. */
async function opened() {
    const made = await h.platform(page);
    return { ...made, page: East.compile(page, made.platform)() as Page };
}

/** Whether a request calls the function named. */
const calls = (name: string) => (request: E3Request) => request.kind === "call" && request.method === "POST" && request.name === name;
/** What the last call of the function named sent, decoded. */
function sent(name: string) {
    const request = h.requests("call").filter(calls(name)).at(-1);
    if (request?.body === undefined) assert.fail(`no call of ${name} was sent whole`);
    return { request, body: decodeBeast2For(FunctionCallRequestType)(request.body) };
}

/** The commit a record stands at, as e3's history of it names it. */
async function head(record: { readonly name: string }): Promise<string> {
    const [newest] = (await h.history(record)).commits;
    if (newest === undefined) assert.fail(`${record.name} has no commit`);
    return newest.hash;
}

/**
 * Settles once a handle's call has ended, as its channel tells: a call whose
 * end no request in flight shows — one e3's clock ends, or one a fault answers.
 *
 * @param runtime - The runtime the handle is bound through
 * @param name - The function the handle calls
 * @param handle - The handle
 */
function ended(runtime: FuncRuntime, name: string, handle: { status: () => { type: string } }): Promise<void> {
    return new Promise((resolve) => {
        let off = () => {};
        const check = () => {
            if (handle.status().type === "running") return;
            off();
            resolve();
        };
        off = runtime.subscribe(funcChannelKey(h.workspace, name), check);
        check();
    });
}

/**
 * Holds that nothing of the jobs was saved: no write was sent, e3 holds them
 * as deployed at the commit they stood at, and a read of them gives them so.
 *
 * @param stood - The commit the jobs stood at before the call
 * @param read - A handle's read of them
 */
async function assertJobsAsSaved(stood: string, read: () => Jobs): Promise<void> {
    assert.deepEqual(h.requests("mutate"), [], "no write was sent");
    const held = await h.read(ex.pressJobs);
    assert.ok(sameJobs(held, SAVED), `e3 holds ${printJobs(held)}`);
    assert.equal(await head(ex.pressJobs), stood, "no commit was made");
    assert.ok(sameJobs(read(), SAVED), `the handle reads ${printJobs(read())}`);
}

describe("a bound function's call over drafts (#1620)", () => {
    test("the function reads a draft's insert, update and delete, and the record stays as saved: its state, its history, the page's read of it and another page's", async () => {
        const { page } = await opened();
        const stood = await head(ex.pressJobs);
        // One patch, as a builder's pending Save is: j4 added on P1, j3 moved onto it, j1 removed.
        const edited: Jobs = new SortedMap([
            ["j2", { press: "P1", hours: 2n }],
            ["j3", { press: "P1", hours: 6n }],
            ["j4", { press: "P1", hours: 1n }],
        ], keys);
        const pending = page.jobs.draft.patch(jobsPatch(SAVED, edited));
        page.load.call("P1", [pending]);
        await h.settle();
        assert.ok(sameError(page.load.error(), none), printError(page.load.error()));
        assert.equal(page.load.status().type, "succeeded");
        const expected: Load = { jobs: ["j2", "j3", "j4"], hours: 9n, capacity: 8n };
        assert.ok(sameLoad(page.load.read(), some(expected)), printLoad(page.load.read()));

        await assertJobsAsSaved(stood, page.jobs.read);
        assert.equal(page.jobs.mutate.status().type, "idle", "the handle's writes never moved");
        const other = await opened();
        assert.ok(sameJobs(other.page.jobs.read(), SAVED), `another page reads ${printJobs(other.page.jobs.read())}`);
    });

    test("an empty Array is a call as saved, and a draft of a mutation with arguments of its own is laid as a Save of it would land — several in the order given, each over what the one before left", async () => {
        const { page } = await opened();
        const stood = await head(ex.pressJobs);
        page.count.call("P1", []);
        await h.settle();
        assert.ok(sameCount(page.count.read(), some(2n)), `as saved: ${printCount(page.count.read())}`);
        assert.ok(sameRequest(sent("jobs_on").body, { args: [variant("value", asText("P1"))], runner: none, limits: none, drafts: [] }),
            printRequest(sent("jobs_on").body));

        const onto = page.jobs.draft.move("j3", "P1");
        page.count.call("P1", [onto]);
        await h.settle();
        assert.ok(sameCount(page.count.read(), some(3n)), `with j3 moved onto it: ${printCount(page.count.read())}`);

        const back = page.jobs.draft.move("j3", "P2");
        page.count.call("P1", [onto, back]);
        await h.settle();
        assert.ok(sameCount(page.count.read(), some(2n)), `with j3 moved onto it and back: ${printCount(page.count.read())}`);
        // The drafts ride the call's request after its arguments, as the handle was given them.
        const { request, body } = sent("jobs_on");
        assert.equal(request.path, `/repos/${h.e3.repo}/workspaces/${h.workspace}/functions/jobs_on/calls`, "started, as a call e3 keeps");
        assert.ok(sameRequest(body, { args: [variant("value", asText("P1"))], runner: none, limits: none, drafts: [onto, back] }), printRequest(body));
        await assertJobsAsSaved(stood, page.jobs.read);
    });

    test("drafts of two records ride one call: each is laid over its own record, and neither is saved", async () => {
        const { page } = await opened();
        const stood = { jobs: await head(ex.pressJobs), shop: await head(ex.presses) };
        const longer: Shop = new SortedMap([...SHOP], keys);
        longer.set("P1", { name: "Offset", hoursPerDay: 10n });
        page.load.call("P1", [page.shop.draft.patch(shopPatch(SHOP, longer)), page.jobs.draft.move("j3", "P1")]);
        await h.settle();
        assert.ok(sameError(page.load.error(), none), printError(page.load.error()));
        const expected: Load = { jobs: ["j1", "j2", "j3"], hours: 12n, capacity: 10n };
        assert.ok(sameLoad(page.load.read(), some(expected)), printLoad(page.load.read()));
        // Each drafted record once, in the order the drafts first name them, at the commit it stood at.
        const drafted = [{ record: "presses", commit: stood.shop }, { record: "press_jobs", commit: stood.jobs }];
        assert.ok(sameDrafted(page.load.drafted(), drafted), printDrafted(page.load.drafted()));

        await assertJobsAsSaved(stood.jobs, page.jobs.read);
        assert.ok(sameShop(await h.read(ex.presses), SHOP), "the presses as deployed");
        assert.equal(await head(ex.presses), stood.shop, "and no commit of them");
    });

    test("drafted() answers for the result read() gives: nothing before a call, the commit a drafted record stood at after one — a newer one once another page has saved between two calls — and nothing after a call as saved", async () => {
        const { page } = await opened();
        assert.ok(sameDrafted(page.count.drafted(), []), "before any call");
        const first = await head(ex.pressJobs);
        const onto = page.jobs.draft.move("j3", "P1");
        page.count.call("P1", [onto]);
        await h.settle();
        assert.ok(sameCount(page.count.read(), some(3n)), printCount(page.count.read()));
        assert.ok(sameDrafted(page.count.drafted(), [{ record: "press_jobs", commit: first }]), printDrafted(page.count.drafted()));

        // Another page saves a fourth job, onto P1.
        const more = withJob("j5", { press: "P1", hours: 3n });
        await h.patch(ex.pressJobs, more);
        const second = await head(ex.pressJobs);
        assert.notEqual(second, first, "another page's Save is a commit");
        page.count.call("P1", [onto]);
        await h.settle();
        assert.ok(sameCount(page.count.read(), some(4n)), `the function read that Save beneath the page's edit: ${printCount(page.count.read())}`);
        assert.ok(sameDrafted(page.count.drafted(), [{ record: "press_jobs", commit: second }]), printDrafted(page.count.drafted()));

        page.count.call("P1", []);
        await h.settle();
        assert.ok(sameCount(page.count.read(), some(3n)), printCount(page.count.read()));
        assert.ok(sameDrafted(page.count.drafted(), []), "a call as saved drafted nothing");
        assert.ok(sameJobs(await h.read(ex.pressJobs), more), "the jobs hold the other page's Save alone");
    });

    test("a handle names the records its function lists, and one of a function that lists none keeps the call it had: no drafted(), its arguments alone, and no draft sent", async () => {
        const { page } = await opened();
        assert.deepEqual([page.count.binding, page.load.binding, page.forecast.binding], [
            { name: "jobs_on", drafts: ["press_jobs"] },
            { name: "press_load", drafts: ["press_jobs", "presses"] },
            { name: "forecast", drafts: [] },
        ]);
        assert.deepEqual(["drafted" in page.count, "drafted" in page.forecast], [true, false]);
        page.forecast.call(12n, 1.5);
        await h.settle();
        assert.equal(page.forecast.status().type, "succeeded");
        assert.ok(equalFor(OptionType(FloatType))(page.forecast.read(), some(1.5)));
        const expected = {
            args: [variant("value", encodeBeast2For(IntegerType)(12n)), variant("value", encodeBeast2For(FloatType)(1.5))],
            runner: none, limits: none, drafts: [],
        };
        assert.ok(sameRequest(sent("forecast").body, expected), printRequest(sent("forecast").body));
    });
});

describe("a draft that ends its call (#1620)", () => {
    test("a draft of a record the function does not list ends the call invalid at the server, naming the draft and the records it lists, and the function does not run", async () => {
        const { page } = await opened();
        const stood = await head(ex.presses);
        const longer: Shop = new SortedMap([...SHOP], keys);
        longer.set("P1", { name: "Offset", hoursPerDay: 10n });
        // `jobs_on` lists the jobs alone.
        page.count.call("P1", [page.shop.draft.patch(shopPatch(SHOP, longer))]);
        await h.settle();
        assert.equal(page.count.status().type, "failed");
        const error = page.count.error();
        if (error.type !== "some") assert.fail("the call has no error");
        assert.equal(error.value.kind.type, "invalid");
        assert.match(error.value.message, /draft presses\.patch \(1 of 1\)/);
        assert.match(error.value.message, /does not list record 'presses' among those a call may draft: 'press_jobs'/);
        assert.ok(sameCount(page.count.read(), none), "the function did not run");
        assert.equal(await head(ex.presses), stood, "and nothing of the presses was saved");
    });

    test("a draft whose mutation fails ends the call failed, as the Save's failure would: the error names the draft and carries the mutation's words, and the function does not run", async () => {
        const { page } = await opened();
        const stood = await head(ex.pressJobs);
        // The shop holds no j9: its move refuses it, as a Save of the move does.
        const lost = page.jobs.draft.move("j9", "P1");
        page.count.call("P1", [lost]);
        await h.settle();
        assert.equal(page.count.status().type, "failed");
        const error = page.count.error();
        if (error.type !== "some") assert.fail("the call has no error");
        assert.equal(error.value.kind.type, "failed");
        assert.equal(error.value.message, "draft press_jobs.move (1 of 1) failed with exit code 1; the function did not run");
        assert.match(error.value.stderr, /the shop holds no job j9/);
        assert.ok(sameCount(page.count.read(), none), "the function did not run");

        const saved = await page.jobs.commit.move("save-1", "j9", "P1");
        assert.equal(saved.type, "failed", "a Save of the same move fails");
        assert.equal(await head(ex.pressJobs), stood, "and neither saved anything");
    });

    test("a Save by another page that changes a row under the edit ends the call conflict, as it refuses the Save: the error names the record and the mutation, the function does not run, and nothing lands", async () => {
        const { page } = await opened();
        // The page moves j3 onto P1 from what it read. Before its call, another page moves j3 onto P3.
        const change = jobsPatch(SAVED, withJob("j3", { press: "P1", hours: 6n }));
        const pending = page.jobs.draft.patch(change);
        const theirs = withJob("j3", { press: "P3", hours: 6n });
        await h.patch(ex.pressJobs, theirs);
        const stood = await head(ex.pressJobs);

        page.count.call("P1", [pending]);
        await h.settle();
        assert.equal(page.count.status().type, "failed");
        const error = page.count.error();
        if (error.type !== "some") assert.fail("the call has no error");
        if (error.value.kind.type !== "conflict") assert.fail(`expected a conflict, got ${error.value.kind.type}: ${error.value.message}`);
        assert.deepEqual([error.value.kind.value.record, error.value.kind.value.mutation], ["press_jobs", "patch"]);
        assert.equal(error.value.message,
            `draft press_jobs.patch no longer matches the record (${error.value.kind.value.message}); re-read it and call again`);
        assert.notEqual(error.value.kind.value.message, "", "in the record's own words");
        assert.ok(sameCount(page.count.read(), none), "the function did not run");

        // The Save of the same edit is refused the same, and the jobs hold the other page's Save alone.
        const saved = await page.jobs.commit.patch("save-1", change);
        assert.equal(saved.type, "conflict");
        assert.ok(sameJobs(await h.read(ex.pressJobs), theirs), printJobs(await h.read(ex.pressJobs)));
        assert.equal(await head(ex.pressJobs), stood, "no commit after theirs");
    });

    test("a call whose time runs out while its draft is being laid ends timed_out, naming the draft, and the function does not run", async (t) => {
        const { page, functions } = await opened();
        const stood = await head(ex.pressJobs);
        // e3 times a call from when it starts, its drafts first: the draft's unit, held as it starts, runs on past
        // the call's timeout while the clock e3 times it by moves on. The clock is e3's until the call has ended.
        const units = h.e3.holdUnits();
        t.mock.timers.enable({ apis: ["setTimeout"] });
        page.count.call("P1", [page.jobs.draft.move("j1", "P2")]);
        await units.holding;
        t.mock.timers.tick(CALL_TIMEOUT_MS);
        await ended(functions, "jobs_on", page.count);
        t.mock.timers.reset();
        await h.settle();
        assert.equal(page.count.status().type, "failed");
        const error = page.count.error();
        if (error.type !== "some") assert.fail("the call has no error");
        assert.equal(error.value.kind.type, "timed_out");
        assert.equal(error.value.message,
            `draft press_jobs.move (1 of 1) had not been laid when the call timed out after ${CALL_TIMEOUT_MS}ms; the function did not run`);
        assert.ok(sameCount(page.count.read(), none), "the function did not run");
        assert.equal(await head(ex.pressJobs), stood, "and nothing was saved");
    });

    test("a draft the host refuses surfaces as a refused call does: the error a call with no draft gets of the same refusal", async () => {
        const { page, functions } = await opened();
        // Only a host's auth refuses a draft: its answer, as e3's routes send it, is a fault here.
        const refusal = { status: 403, type: "permission_denied", message: "draft press_jobs.move" };
        h.e3.fail(calls("jobs_on"), refusal);
        h.e3.fail(calls("forecast"), refusal);
        page.count.call("P1", [page.jobs.draft.move("j3", "P1")]);
        page.forecast.call(12n, 1.5);
        await Promise.all([ended(functions, "jobs_on", page.count), ended(functions, "forecast", page.forecast)]);
        assert.deepEqual([page.count.status().type, page.forecast.status().type], ["failed", "failed"]);
        const error = page.count.error();
        if (error.type !== "some") assert.fail("the call has no error");
        assert.equal(error.value.kind.type, "transport");
        assert.match(error.value.message, /permission_denied/);
        assert.ok(sameError(error, page.forecast.error()), `${printError(error)} against ${printError(page.forecast.error())}`);
    });
});

describe("a call with drafts through a workspace (#1620)", () => {
    /** Whether a request asks e3 to stop a call. */
    const isStop = (request: E3Request) => request.method === "POST" && /\/calls\/[^/]+\/cancel$/.test(request.path);
    /** Lets e3's answers in: their messages are a macrotask away. */
    const turn = () => new Promise<void>((resolve) => { setImmediate(resolve); });
    /** The test's calls as e3 keeps them, each whole, the latest first. */
    async function kept() {
        const listed = await workspaceCallList(h.e3.apiUrl, h.e3.repo, h.workspace, h.e3.direct);
        return Promise.all(listed.calls.map((call) => workspaceCallGet(h.e3.apiUrl, h.e3.repo, h.workspace, call.id, h.e3.direct)));
    }
    /** The states a kept call read its inputs at, in the order its function declares them. */
    const readAt = (call: { readonly inputs: readonly { readonly hash: string }[] }) => call.inputs.map((input) => input.hash);

    test("it is kept as any call is, each by how it ended and with the drafts it passed: one that ran, over the state its draft left, and one a draft ended", async () => {
        const { page } = await opened();
        const stood = await head(ex.pressJobs);
        page.count.call("P1", []);
        await h.settle();
        page.count.call("P1", [page.jobs.draft.move("j3", "P1")]);
        await h.settle();
        page.count.call("P1", [page.jobs.draft.move("j9", "P1")]);
        await h.settle();
        const [ended, ran, asSaved] = await kept();
        if (ended === undefined || ran === undefined || asSaved === undefined) assert.fail("e3 keeps fewer than the three calls");
        assert.deepEqual([ended.state.type, ran.state.type, asSaved.state.type], ["failed", "succeeded", "succeeded"]);
        assert.deepEqual(ran.drafts.map((draft) => [draft.record, draft.mutation, draft.commit]), [["press_jobs", "move", stood]]);
        assert.deepEqual(ended.drafts.map((draft) => [draft.record, draft.mutation, draft.commit]), [["press_jobs", "move", stood]]);
        assert.deepEqual(asSaved.drafts, []);
        // The call that ran read the jobs at the state its draft left, which nothing else names; the one its draft
        // ended names them as its start found them, as the call as saved read them.
        assert.notDeepEqual(readAt(ran), readAt(asSaved));
        assert.deepEqual(readAt(ended), readAt(asSaved));
    });

    test("it cancels as any call does: cancelled while its draft is being laid, e3 is asked to stop it and keeps it cancelled, its draft not laid, and nothing is saved", async () => {
        const { page } = await opened();
        const stood = await head(ex.pressJobs);
        page.count.call("P2", []);
        await h.settle();
        const units = h.e3.holdUnits();
        page.count.call("P2", [page.jobs.draft.move("j2", "P2")]);
        await units.holding;
        assert.equal(page.count.status().type, "running");
        page.count.cancel();
        assert.equal(page.count.status().type, "cancelled", "at once");
        while (!h.e3.requests.some(isStop)) await turn();
        await h.settle();
        const [cancelled, asSaved] = await kept();
        if (cancelled === undefined || asSaved === undefined) assert.fail("e3 keeps fewer than the two calls");
        assert.deepEqual([cancelled.state.type, asSaved.state.type], ["cancelled", "succeeded"]);
        // The unit held was its draft's: the call still names the jobs as its start found them, never at a drafted state.
        assert.deepEqual(readAt(cancelled), readAt(asSaved));
        assert.ok(sameCount(page.count.read(), some(1n)), "read() still answers for the call before it");
        assert.equal(await head(ex.pressJobs), stood, "nothing was saved");
    });
});
