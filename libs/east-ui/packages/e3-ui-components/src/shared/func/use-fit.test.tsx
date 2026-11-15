/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A builder's fit as it is asked (east-workspace#1624) on e3: the kiln yard's
 * fit, called by name through the shared `Func` runtime, from a probe under
 * the file's e3 whose sessions a test says. An ask sends the request and,
 * after it, the drafts the builder's sessions hand over of the records the
 * function lists — made once for each context — and a derived plan's change
 * as one more draft after them (rule 10); a question whose own subject is an
 * edit not yet complete is not asked until it is (rule 8); while the sessions
 * cannot hand their edits over the question waits, and where they refuse them
 * the fit has failed in their words (rule 9); and a call e3 refuses because a
 * record moved under its drafts (rule 12) takes the optimiser's path — asked
 * again by itself with the drafts the sessions hand over then, failed in
 * their words where a conflict waits to be chosen, and failed in the
 * refusal's once it has been refused as many times in a row as a refused Save
 * is sent again. What a builder shows of an answer is its own tests'.
 */

import { describe, expect, test } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PatchType, SortedMap, StringType, compareFor, diffFor, encodeBeast2For, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { SAVE_RESENDS } from "@elaraai/east-ui-components/internal";
import { Allocation } from "@elaraai/e3-ui";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { E3Surface, act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { fitCalls } from "./fit-calls.test-utils.js";
import { useFit, type FitAnswers } from "./use-fit.js";
import type { FuncCallBinding, FuncCallDraft } from "./use-func-call.js";
import type { OptimiseRefused, OptimiseSessions } from "./use-optimise.js";

const h = e3Harness({ "allocation/allocation": ex });
const RequestType = Allocation.Types.FitRequest, ResultType = Allocation.Types.FitResult;
const calls = fitCalls(h, { request: RequestType, result: ResultType });
/** The yard's fit, by its `e3.function` name, and the record it lists in `drafts`: the yard's bins. */
const NAME = ex.yardFit.name, BINS = ex.kilnBins.name;
const BINDING: FuncCallBinding = { drafts: [BINS], reads: [BINS, ex.kilns.name, ex.arrivals.name] };
type Ask = ValueTypeOf<typeof Allocation.Types.FitAsk>;
type Result = ValueTypeOf<typeof ResultType>;
type Fit = FitAnswers<Ask, object, Result>;
const byString = compareFor(StringType);
const askKey = printFor(Allocation.Types.FitAsk);
const DAY = new Date("2027-05-11T00:00:00Z");
const place = (code: string, quantity: number): Ask => variant("place", { subject: variant("arrival", code), quantity });
const LD_2231 = place("LD-2231", 21), LD_2236 = place("LD-2236", 11);
const patchOf = diffFor(ex.kilnBins.type);
const encodePatch = encodeBeast2For(PatchType(ex.kilnBins.type));

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

/** What a probe is given beside its sessions: the plan and the context it asks in, and the builder's own parts of a question. */
interface Given {
    plan: object;
    context: object;
    binding?: FuncCallBinding;
    further?: (of: object, base: object) => FuncCallDraft | undefined;
    complete?: (ask: Ask) => boolean;
}

function Probe({ sessions, given, onFit }: { sessions: Sessions; given: Given; onFit: (fit: Fit) => void }) {
    // Read as the ask asks, never kept: each answer is of the sessions as they stand.
    const asked: OptimiseSessions = {
        drafts: (listed) => { sessions.asked.push(listed); return sessions.asked.length > 1 && sessions.carried !== undefined ? sessions.carried : sessions.drafts; },
        settled: () => sessions.settled,
        conflicts: () => sessions.conflicts,
    };
    const fit = useFit<Ask, object, object, Result>({
        name: NAME, binding: given.binding ?? BINDING, sessions: asked, requestType: RequestType, resultType: ResultType,
        key: askKey, answers: (result) => askKey(result.ask),
        request: (ask) => ({ day: DAY, ask, scope: new SortedMap([], byString) }),
        ...(given.further === undefined ? {} : { further: given.further }),
        ...(given.complete === undefined ? {} : { complete: given.complete }),
    }, given.plan, given.context);
    onFit(fit);
    return null;
}

/** The probe under the file's e3, its fit read as it renders. */
function mount(sessions: Sessions = sessionsOf(), given: Given = { plan: {}, context: {} }) {
    let latest!: Fit;
    const tree = (now: Given) => <E3Surface><Probe sessions={sessions} given={now} onFit={(fit) => { latest = fit; }} /></E3Surface>;
    const view = render(tree(given));
    const ask = async (question: Ask, of?: object) => { await act(async () => { latest.ask(question, of); }); await settle(); };
    /** Renders the probe again, as a builder renders as its sessions and its reads move. */
    const again = async (now: Given = given) => { await act(async () => { view.rerender(tree(now)); }); await settle(); };
    const answered = (question: Ask, of?: object) => waitFor(() => { const answer = latest.answer(question, of); expect(answer).toBeDefined(); return answer!; }, { timeout: 10_000 });
    return { fit: () => latest, ask, again, answered, sessions, given };
}

/**
 * A page's unsaved edit of a bin's time, as its session hands it over — a call of the bins' patch door, made over the
 * bins as the page read them.
 */
async function draft(id = "3101"): Promise<FuncCallDraft> {
    const read = await h.read(ex.kilnBins);
    const mine = new SortedMap([...read], byString);
    mine.set(id, { ...read.get(id)!, at: new Date(read.get(id)!.at.getTime() + 60_000) });
    return { record: BINS, mutation: "patch", args: [encodePatch(patchOf(read, mine) as never)] };
}
/** The same edit, and another page's save of the same bin's time after it: the draft no longer fits the record, and e3 refuses every call that passes it. */
async function staleDraft(): Promise<FuncCallDraft> {
    const mine = await draft();
    const read = await h.read(ex.kilnBins);
    const theirs = new SortedMap([...read], byString);
    theirs.set("3101", { ...read.get("3101")!, at: new Date(read.get("3101")!.at.getTime() + 120_000) });
    await h.patch(ex.kilnBins, theirs);
    return mine;
}

describe("useFit", () => {
    test("rule 1 — an ask sends the question and, after it, the sessions' drafts of the records the function lists, made once for each context; a new context asks them again", async () => {
        const sessions = sessionsOf();
        sessions.drafts = [await draft()];
        const { ask, answered, again } = mount(sessions);
        await ask(LD_2231);
        await answered(LD_2231);
        await ask(LD_2236);
        await answered(LD_2236);
        expect([calls.requests(NAME).map((request) => request.ask), calls.drafts(NAME)]).toEqual([[LD_2231, LD_2236], [[{ record: BINS, mutation: "patch" }], [{ record: BINS, mutation: "patch" }]]]);
        // Two questions in the one context: the sessions handed their drafts over once.
        expect(sessions.asked).toEqual([[BINS]]);
        // A new context — the drafts moved, or what the page reads — is new answers, of drafts made again.
        const moved = { plan: {}, context: {} };
        await again(moved);
        await ask(LD_2231);
        await answered(LD_2231);
        expect([calls.calls(NAME), sessions.asked]).toEqual([3, [[BINS], [BINS]]]);
    });

    test("a function that lists no drafts is called with its request alone, and its sessions are not asked", async () => {
        const sessions = sessionsOf();
        sessions.drafts = [await draft()];
        const { ask, answered } = mount(sessions, { plan: {}, context: {}, binding: { drafts: [], reads: BINDING.reads } });
        await ask(LD_2231);
        await answered(LD_2231);
        expect([calls.drafts(NAME), sessions.asked]).toEqual([[[]], []]);
    });

    test("rule 10 — a question about a derived plan carries the plan's change as one more draft, after the sessions'; a question of the plan as it stands carries none of it, and each is kept apart", async () => {
        const sessions = sessionsOf();
        sessions.drafts = [await draft("3101")];
        const more = await draft("3102");
        const derived = {};
        const seen: [object, object][] = [];
        const given: Given = { plan: {}, context: {}, further: (of, base) => { seen.push([of, base]); return more; } };
        const { ask, answered, fit } = mount(sessions, given);
        await ask(LD_2231);
        await answered(LD_2231);
        await ask(LD_2231, derived);
        await answered(LD_2231, derived);
        expect(calls.drafts(NAME).map((drafts) => drafts.length)).toEqual([1, 2]);
        // The derived plan's change was made from the plan it was derived from, for that question alone.
        expect(seen).toEqual([[derived, given.plan]]);
        // The same question, two answers: one of the drafts, one of the derived plan.
        expect([fit().answer(LD_2231) !== undefined, fit().answer(LD_2231, derived) !== undefined, fit().answer(LD_2236, derived)]).toEqual([true, true, undefined]);
    });

    test("rule 8 — a question whose own subject is an edit not yet complete is not asked until it is, and waits as no pending answer", async () => {
        let complete = false;
        const given: Given = { plan: {}, context: {}, complete: (question) => complete || askKey(question) !== askKey(LD_2231) };
        const { ask, answered, again, fit } = mount(sessionsOf(), given);
        await ask(LD_2231);
        expect([calls.calls(NAME), fit().pending, fit().answer(LD_2231), fit().error]).toEqual([0, false, undefined, undefined]);
        // Another question's subject is complete: it is asked past the one that waits.
        await ask(LD_2236);
        await answered(LD_2236);
        expect(calls.requests(NAME).map((request) => request.ask)).toEqual([LD_2236]);
        // Completed, the builder asks it again as it renders, and it goes.
        complete = true;
        await again();
        await ask(LD_2231);
        await answered(LD_2231);
        expect(calls.requests(NAME).map((request) => request.ask)).toEqual([LD_2236, LD_2231]);
    });

    test("sessions that cannot hand their edits over yet — a Save of their own on its way — keep the question waiting; once they stand, it goes", async () => {
        const sessions = sessionsOf();
        sessions.drafts = { refused: "A Save is on its way" };
        sessions.settled = false;
        const { ask, answered, again, fit } = mount(sessions);
        await ask(LD_2231);
        expect([calls.calls(NAME), fit().pending, fit().error]).toEqual([0, true, undefined]);
        // The Save answered: the sessions hand their edits over, and the builder renders as they move.
        sessions.drafts = [];
        sessions.settled = true;
        await again();
        await answered(LD_2231);
        expect(calls.calls(NAME)).toBe(1);
    });

    test("rule 9 — sessions whose record refuses the edits as they stand fail the fit in the refusal's words, and no call is made; Retry asks them again", async () => {
        const sessions = sessionsOf();
        sessions.drafts = { refused: "The entry was removed since this edit began" };
        const { ask, answered, fit } = mount(sessions);
        await ask(LD_2231);
        await waitFor(() => expect(fit().error).toBe("The entry was removed since this edit began"));
        expect([calls.calls(NAME), fit().pending]).toEqual([0, false]);
        // The edit undone, the person retries: the question goes with what the sessions hand over then.
        sessions.drafts = [];
        await act(async () => { fit().retry(); });
        await answered(LD_2231);
        expect([calls.calls(NAME), fit().error]).toEqual([1, undefined]);
    });

    describe("rule 12 — a record that changed under the edits", () => {
        test("a call e3 refuses because the record moved under its drafts lands nothing; with nothing to choose the question is asked again by itself, with the drafts the sessions hand over then, and answered", async () => {
            const sessions = sessionsOf();
            sessions.drafts = [await staleDraft()];
            // Carried over the other page's save, the sessions have no edit left to hand over.
            sessions.carried = [];
            const { ask, answered, fit } = mount(sessions);
            await ask(LD_2231);
            await answered(LD_2231);
            expect([calls.outcomes(NAME), calls.drafts(NAME).map((drafts) => drafts.length), sessions.asked]).toEqual([["conflict", "success"], [1, 0], [[BINS], [BINS]]]);
            expect(fit().error).toBeUndefined();
        });

        test("with a conflict to choose, the fit fails in the sessions' words, and no second call is made; once the person has chosen it is asked again, with the drafts the sessions hand over then", async () => {
            const sessions = sessionsOf();
            sessions.drafts = [await staleDraft()];
            sessions.conflicts = "1 of your changes conflicts with newer changes.";
            const { ask, answered, again, fit } = mount(sessions);
            await ask(LD_2231);
            await waitFor(() => expect(fit().error).toBe(sessions.conflicts), { timeout: 10_000 });
            expect([calls.outcomes(NAME), fit().pending, fit().answer(LD_2231)]).toEqual([["conflict"], false, undefined]);
            // Chosen — the other page's save kept — the sessions hold no conflict and no edit, and the builder renders as they move.
            sessions.conflicts = undefined;
            sessions.carried = [];
            await again();
            await answered(LD_2231);
            expect([calls.outcomes(NAME), calls.drafts(NAME).map((drafts) => drafts.length), fit().error]).toEqual([["conflict", "success"], [1, 0], undefined]);
        });

        test("refused again and again, the question goes again as many times in a row as a refused Save is sent again, then the fit fails in the refusal's words", async () => {
            const sessions = sessionsOf();
            // Sessions that hand the same stale edit over each time: every call is refused.
            sessions.drafts = [await staleDraft()];
            const { ask, fit } = mount(sessions);
            await ask(LD_2231);
            await waitFor(() => expect(fit().error).toBeDefined(), { timeout: 20_000 });
            expect(calls.outcomes(NAME)).toEqual(Array.from({ length: SAVE_RESENDS + 1 }, () => "conflict"));
            expect([fit().error !== "", fit().answer(LD_2231)]).toEqual([true, undefined]);
        });
    });
});
