/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run of the app's optimiser (#1409, #1414, east-workspace#1622; R1–R6,
 * R10, O4, D5) on e3: the jobs calendar's optimiser, called by name through
 * the shared `Func` runtime, from a probe under the file's e3 — one call per
 * run, with the request made for the run's number and, after it, the drafts
 * the builder's sessions hand over of the records the function lists; the
 * seconds from 1; a result landed once the sessions stand on what the page
 * has read, told once with its request, and counted — changes, none with a
 * blink, an answer the builder cannot use, one it refuses, saying why (#1553);
 * an answer that touches rows the page does not hold, which the run reads by
 * their keys and asks the builder again with as they land, and one that waits
 * on the builder's own, asked again as its settle key moves; sessions that
 * cannot hand their edits over, in their
 * words; a call e3 refuses because a record moved under its drafts (rule 12)
 * — sent again by itself with the drafts the sessions hand over then, ended
 * in their words where a conflict waits to be chosen, and ended a failure
 * once it has been refused as many times in a row as a refused Save is sent
 * again; a failed call; Stop, and an answer arriving after it ignored; a
 * change of scope stops the run, a change of anything else does not; unmount
 * aborts; the run counter outlives a remount; and no optimiser bound offers
 * nothing.
 */

import { useEffect } from "react";
import { describe, expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PatchType, SortedMap, StringType, compareFor, diffFor, encodeBeast2For, equalFor, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { SAVE_RESENDS } from "@elaraai/east-ui-components/internal";
import { Calendar } from "@elaraai/e3-ui";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import * as opt from "@elaraai/e3-ui/examples/calendar/optimise";
import { E3Surface, act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { fitCalls } from "./fit-calls.test-utils.js";
import type { OptimiseRowsReader } from "./optimise-rows.js";
import type { FuncCallBinding, FuncCallDraft } from "./use-func-call.js";
import {
    OPTIMISE_STOPPED_MS, useOptimise, type OptimiseCounts, type OptimiseMissing, type OptimiseRefused, type OptimiseRowRead, type OptimiseRun, type OptimiseSessions,
    type OptimiseWaiting,
} from "./use-optimise.js";

const h = e3Harness({ "calendar/calendar": ex, "calendar/optimise": opt });
const RequestType = Calendar.Types.OptimiseRequest;
const calls = fitCalls(h, { request: RequestType, result: opt.CalendarOptimiseResult });
/** The shop's optimiser, by its `e3.function` name. */
const NAME = "calendar_schedule_backlog";
/** The record it lists in `drafts` and reads: the shop's jobs. */
const JOBS = "calendar_jobs";
const BINDING: FuncCallBinding = { drafts: [JOBS], reads: [JOBS] };
type Request = ValueTypeOf<typeof RequestType>;
type Result = ValueTypeOf<typeof opt.CalendarOptimiseResult>;
const byString = compareFor(StringType);
const sameRequest = equalFor(RequestType);
/** A window that holds no job of the shop's: nothing for the optimiser to schedule but the backlog. */
const FROM = new Date("2030-01-07T00:00:00Z"), TO = new Date("2030-01-14T00:00:00Z");
/** A run's request: the window, its kind, the run's number and no narrowing. */
const request = (run: number): Request => ({ from: FROM, to: TO, period: variant("week", null), run: BigInt(run), slice: new SortedMap([], byString) });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const COUNTS: OptimiseCounts = { added: 1, changed: 0, removed: 0 };

/**
 * What the builder answers a landed result with: its counts, its refusal's words, the rows it does not hold, that it
 * waits on its own reads, or nothing for an answer it cannot use.
 */
type Landed = OptimiseCounts | OptimiseRefused | OptimiseMissing | OptimiseWaiting | undefined;
/** What the builder does with a landed result, the rows the run read by their keys in its hand. */
type OnLanded = (result: Result, request: Request, run: number, read: OptimiseRowRead) => Landed;

/**
 * The builder's reads of rows by their keys, as a test says them: each read asked, by its kind and its keys, and what it
 * answers — `undefined` while on its way — through a reader made again as it lands, as a tracked read is.
 */
interface Reads {
    answer: ReadonlyMap<string, option<unknown>> | undefined;
    readonly asked: [string, readonly string[]][];
    by: OptimiseRowsReader;
}
const readerOf = (reads: Reads): OptimiseRowsReader => (kind, ids) => { reads.asked.push([kind, ids]); return reads.answer; };
const readsOf = (): Reads => { const reads: Reads = { answer: undefined, asked: [], by: () => undefined }; reads.by = readerOf(reads); return reads; };

/** The builder's sessions, as a test says them: no draft to hand over, standing on what the page read, nothing to choose. */
interface Sessions {
    drafts: readonly FuncCallDraft[] | OptimiseRefused;
    /** What they hand over from the second time they are asked, where that differs: their edits carried over newer saves. */
    carried?: readonly FuncCallDraft[] | OptimiseRefused;
    settled: boolean;
    conflicts: string | undefined;
    /** Each list of records its drafts were asked of. */
    readonly asked: (readonly string[])[];
}
const sessionsOf = (): Sessions => ({ drafts: [], settled: true, conflicts: undefined, asked: [] });

function Probe({ name, scope, layout, sessions, settleKey, rowsByKey, onLanded, onRun }: {
    name: string | null; scope: string; layout: string; sessions: Sessions; settleKey: number; rowsByKey: OptimiseRowsReader;
    onLanded: OnLanded; onRun: (run: OptimiseRun<Request>) => void;
}) {
    // Read as the run asks, never kept: each answer is of the sessions as they stand.
    const asked: OptimiseSessions = {
        drafts: (listed) => { sessions.asked.push(listed); return sessions.asked.length > 1 && sessions.carried !== undefined ? sessions.carried : sessions.drafts; },
        settled: () => sessions.settled,
        conflicts: () => sessions.conflicts,
    };
    const run = useOptimise<Request, Result>({
        name, binding: BINDING, sessions: asked, settleKey, rowsByKey, requestType: RequestType, resultType: opt.CalendarOptimiseResult, scope, storageKey: "test.optimise",
        onLanded,
    });
    onRun(run);
    useEffect(() => { void layout; });
    return null;
}

/** The probe under the file's e3, its run read as it renders. */
function mount(onLanded: OnLanded = () => COUNTS, name: string | null = NAME, sessions: Sessions = sessionsOf(), reads: Reads = readsOf()) {
    let latest!: OptimiseRun<Request>;
    const tree = (scope: string, layout = "week", settleKey = 0) =>
        <E3Surface><Probe name={name} scope={scope} layout={layout} sessions={sessions} settleKey={settleKey} rowsByKey={reads.by} onLanded={onLanded}
            onRun={(run) => { latest = run; }} /></E3Surface>;
    const view = render(tree("W11"));
    const start = async (period = "W11") => { await act(async () => { latest.start(request, period); }); };
    /** Waits for the run out to land, e3 having run the optimiser for it. */
    const landed = () => waitFor(() => expect(latest.running).toBe(false), { timeout: 10_000 });
    return { ...view, run: () => latest, tree, start, landed, sessions };
}

describe("useOptimise", () => {
    test("R1 — a run sends one call with the request made for its number, from 1, and the sessions' drafts of the records the function lists; the seconds count from 1; the result lands once, with its request, and is counted", async () => {
        const seen: [Result, Request, number][] = [];
        const { run, start, landed, sessions } = mount((result, asked, n) => { seen.push([result, asked, n]); return { added: 2, changed: 1, removed: 0 }; });
        await settle();
        expect([run().offered, run().running, run().run, run().outcome]).toEqual([true, false, 0, undefined]);
        const hold = calls.hold(NAME);
        await start();
        await hold.holding;
        expect([run().running, run().run, run().seconds]).toEqual([true, 1, 1]);
        expect(calls.requests(NAME)).toHaveLength(1);
        expect(sameRequest(calls.requests(NAME)[0]!, request(1))).toBe(true);
        // A second click while a call is out sends nothing.
        await start();
        expect([calls.requests(NAME).length, run().run]).toEqual([1, 1]);
        // The seconds, from 1, each whole second the call is out.
        await sleep(2100);
        expect(run().seconds).toBeGreaterThanOrEqual(2);
        hold.release();
        await landed();
        expect(seen).toHaveLength(1);
        // The answer is a patch of the kind's record; the request carries no row.
        expect([sameRequest(seen[0]![1], request(1)), seen[0]![2], seen[0]![0].events.job.type]).toEqual([true, 1, "patch"]);
        expect(run().outcome).toEqual({ kind: "done", run: 1, period: "W11", counts: { added: 2, changed: 1, removed: 0 } });
        // The sessions were asked their drafts of the record the function lists, once, as the call left.
        expect(sessions.asked).toEqual([[JOBS]]);
    });

    test("rule 1 — sessions that cannot hand their edits over end the run saying why, in their words, and no call is made", async () => {
        const sessions = sessionsOf();
        sessions.drafts = { refused: "A save is still on its way." };
        const { run, start } = mount(() => COUNTS, NAME, sessions);
        await settle();
        await start();
        expect([run().running, calls.requests(NAME).length]).toEqual([false, 0]);
        expect(run().outcome).toEqual({ kind: "fail", run: 1, period: "W11", message: "A save is still on its way.", refused: "A save is still on its way." });
    });

    test("rules 8 and 9 — an answer lands once the sessions stand on what the page has read; one that touches a row the page does not hold has the run read it by its key, and is asked again with the read in its hand as it lands", async () => {
        const sessions = sessionsOf();
        sessions.settled = false;
        const reads = readsOf();
        // What each landing read of the job the page does not hold.
        const readThen: (option<unknown> | undefined)[] = [];
        const seen = vi.fn<OnLanded>((_result, _request, _run, read) => {
            const far = read("job", "job9");
            readThen.push(far);
            return far === undefined ? { missing: [{ kind: "job", id: "job9" }] } : COUNTS;
        });
        const { run, start, tree, rerender } = mount(seen, NAME, sessions, reads);
        await settle();
        await start();
        // The call is answered, and the page has read the record again: the sessions have yet to take it in.
        await waitFor(() => expect(calls.answers(NAME)).toHaveLength(1), { timeout: 10_000 });
        await settle();
        expect([run().running, seen.mock.calls.length]).toEqual([true, 0]);
        // They stand on it: the answer is tried — it touches a job the page does not hold, which the run reads by its key.
        sessions.settled = true;
        rerender(tree("W11", "week", 1));
        await settle();
        expect([run().running, readThen.every((read) => read === undefined), reads.asked.length > 0]).toEqual([true, true, true]);
        expect(reads.asked.every(([kind, ids]) => kind === "job" && ids.length === 1 && ids[0] === "job9")).toBe(true);
        // The read lands: the answer is asked again with the job in hand, and lands.
        reads.answer = new Map([["job9", some("job9")]]);
        reads.by = readerOf(reads);
        rerender(tree("W11", "week", 1));
        await waitFor(() => expect(run().running).toBe(false));
        expect([readThen.at(-1)?.type, run().outcome?.kind]).toEqual(["some", "done"]);
        // One call was made for it all.
        expect(calls.requests(NAME)).toHaveLength(1);
    });

    test("a landing that waits on the builder's own reads — the period it was asked of not read yet — is asked again as the builder's settle key moves", async () => {
        let answer: Landed = { waiting: true };
        const seen = vi.fn(() => answer);
        const { run, start, tree, rerender, landed } = mount(seen);
        await settle();
        await start();
        await waitFor(() => expect(seen.mock.calls.length).toBeGreaterThan(0), { timeout: 10_000 });
        await settle();
        const asked = seen.mock.calls.length;
        expect(run().running).toBe(true);
        // Nothing of the builder's moved: it is not asked again.
        rerender(tree("W11"));
        await settle();
        expect(seen.mock.calls.length).toBe(asked);
        // The builder's reads land, its settle key moving: asked again, it lands.
        answer = COUNTS;
        rerender(tree("W11", "week", 1));
        await landed();
        expect([seen.mock.calls.length, run().outcome?.kind]).toEqual([asked + 1, "done"]);
    });

    describe("rule 12 — a record that changed under the edits", () => {
        const patchOf = diffFor(opt.CalendarJobs);
        const encodePatch = encodeBeast2For(PatchType(opt.CalendarJobs));
        /**
         * A page's unsaved edit of a job's customer, as its session hands it over — a call of the jobs' patch door, made
         * over the jobs as the page read them — and another page's save of the same field after it: the draft no longer
         * fits the record, and e3 refuses every call that passes it.
         */
        async function staleDraft(): Promise<FuncCallDraft> {
            const read = await h.read(ex.calendarJobs);
            const mine = new Map(read);
            mine.set("job1", { ...read.get("job1")!, customer: "Customer here" });
            const draft: FuncCallDraft = { record: JOBS, mutation: "patch", args: [encodePatch(patchOf(read, mine) as never)] };
            const theirs = new Map(read);
            theirs.set("job1", { ...read.get("job1")!, customer: "Customer there" });
            await h.patch(ex.calendarJobs, theirs);
            return draft;
        }

        test("a call e3 refuses because the record moved under its drafts lands nothing; with nothing to choose it goes again by itself, with the drafts the sessions hand over then, and lands as the one run", async () => {
            const sessions = sessionsOf();
            sessions.drafts = [await staleDraft()];
            // Carried over the other page's save, the sessions have no edit left to hand over.
            sessions.carried = [];
            const seen = vi.fn(() => COUNTS);
            const { run, start, landed } = mount(seen, NAME, sessions);
            await settle();
            await start();
            await landed();
            expect([calls.outcomes(NAME), calls.drafts(NAME).map((drafts) => drafts.length), sessions.asked]).toEqual([["conflict", "success"], [1, 0], [[JOBS], [JOBS]]]);
            expect([seen.mock.calls.length, run().outcome]).toEqual([1, { kind: "done", run: 1, period: "W11", counts: COUNTS }]);
        });

        test("with a conflict to choose, the run ends saying so in the sessions' words, and no second call is made", async () => {
            const sessions = sessionsOf();
            sessions.drafts = [await staleDraft()];
            sessions.conflicts = "1 of your changes conflicts with newer changes.";
            const seen = vi.fn(() => COUNTS);
            const { run, start, landed } = mount(seen, NAME, sessions);
            await settle();
            await start();
            await landed();
            expect([calls.outcomes(NAME), seen.mock.calls.length]).toEqual([["conflict"], 0]);
            expect(run().outcome).toEqual({ kind: "fail", run: 1, period: "W11", message: sessions.conflicts, refused: sessions.conflicts });
        });

        test("refused again and again, the call goes again as many times in a row as a refused Save is sent again, then the run ends a failure in the refusal's words", async () => {
            const sessions = sessionsOf();
            // Sessions that hand the same stale edit over each time: every call is refused.
            sessions.drafts = [await staleDraft()];
            const seen = vi.fn(() => COUNTS);
            const { run, start, landed } = mount(seen, NAME, sessions);
            await settle();
            await start();
            await landed();
            expect([calls.outcomes(NAME), seen.mock.calls.length]).toEqual([Array.from({ length: SAVE_RESENDS + 1 }, () => "conflict"), 0]);
            const failed = run().outcome;
            expect(failed?.kind === "fail" ? [failed.run, failed.message !== "", failed.refused] : failed).toEqual([1, true, undefined]);
        });
    });

    test("R10 — a result with nothing to change is the none outcome and one blink; an answer the builder cannot use, one it refuses, and a failed call, are failures", async () => {
        let counts: Landed = { added: 0, changed: 0, removed: 0 };
        const { run, start, landed } = mount(() => counts);
        await settle();
        await start();
        await landed();
        expect([run().outcome, run().blinks]).toEqual([{ kind: "none", run: 1, period: "W11" }, 1]);
        counts = undefined;
        await start("W12");
        await landed();
        expect([run().outcome, run().blinks]).toEqual([{ kind: "fail", run: 2, period: "W12", message: "the optimiser's answer could not be used" }, 1]);
        // An answer the builder refuses (#1553) is a failure that says why, in the builder's words, with no blink.
        const why = "Elara's answer removes M. Hart · Sun Mar 5 Night · Inbound, in a week not available to edit.";
        counts = { refused: why };
        await start("W12");
        await landed();
        expect([run().outcome, run().blinks]).toEqual([{ kind: "fail", run: 3, period: "W12", message: why, refused: why }, 1]);
        const restore = calls.fail(NAME);
        await start();
        await landed();
        const failed = run().outcome;
        expect(failed?.kind === "fail" ? [failed.run, failed.period, failed.message !== "", failed.refused] : failed).toEqual([4, "W11", true, undefined]);
        restore();
        act(() => { run().dismiss(); });
        expect(run().outcome).toBeUndefined();
    });

    test("R3 — Stop cancels the call: an answer arriving after it is ignored, nothing is counted, and the footer's note holds for 2.5s", async () => {
        const seen = vi.fn(() => COUNTS);
        const { run, start, landed } = mount(seen);
        await settle();
        const hold = calls.hold(NAME);
        await start();
        await hold.holding;
        act(() => { run().stop(); });
        expect([run().running, run().stopped, run().outcome]).toEqual([false, true, undefined]);
        hold.release();
        await settle();
        expect([seen.mock.calls.length, run().outcome]).toEqual([0, undefined]);
        await sleep(OPTIMISE_STOPPED_MS + 200);
        expect(run().stopped).toBe(false);
        // The next run lands as any does.
        await start();
        await landed();
        expect([seen.mock.calls.length, run().outcome?.kind, run().run]).toEqual([1, "done", 2]);
    });

    test("O4 — a change of scope stops the run as Stop does; a change of anything else does not", async () => {
        const seen = vi.fn(() => COUNTS);
        const { run, start, tree, rerender } = mount(seen);
        await settle();
        const hold = calls.hold(NAME);
        await start();
        await hold.holding;
        rerender(tree("W11", "month"));
        expect(run().running).toBe(true);
        rerender(tree("W12"));
        expect([run().running, run().stopped]).toEqual([false, true]);
        hold.release();
        await settle();
        expect(seen).not.toHaveBeenCalled();
    });

    test("R4 — unmount aborts the call; D5 — the run counter outlives a remount", async () => {
        const seen = vi.fn(() => COUNTS);
        const first = mount(seen);
        await settle();
        const hold = calls.hold(NAME);
        await first.start();
        await hold.holding;
        first.unmount();
        hold.release();
        await settle();
        expect(seen).not.toHaveBeenCalled();
        const second = mount(seen);
        await settle();
        expect(second.run().run).toBe(1);
        await second.start();
        expect(second.run().run).toBe(2);
        await second.landed();
    });

    test("R6 — with no optimiser bound nothing is offered, and a start sends nothing", async () => {
        const { run, start } = mount(() => COUNTS, null);
        await settle();
        expect(run().offered).toBe(false);
        await start();
        expect([run().running, run().run, calls.requests(NAME).length]).toEqual([false, 0, 0]);
    });
});
