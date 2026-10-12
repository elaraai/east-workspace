/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Each DOM test a run of its own (#1280).
 *
 * A test that times out is abandoned, not stopped: its body runs on, mid-`act`,
 * into the tests after it. React keeps one act scope for the whole file. A
 * scope closes by setting the scope's depth back to what it was when it
 * opened, so an abandoned scope that closes after the next test's has opened
 * leaves the depth above zero for good. No later scope flushes React's work
 * again, and nothing the later tests render is drawn.
 *
 * So, in a file that calls {@link isolateRuns}, each test runs in a run of its
 * own, which its body keeps through every await, after its test has ended too.
 * The work it starts is the run's work in flight until it settles:
 * - each `act` scope it opens over an async callback ({@link act});
 * - each interaction Testing Library runs through its async wrapper, which
 *   user-event's and `waitFor`'s go through.
 *
 * Once the test has ended, its afterEach hooks having unmounted what it
 * mounted, its work in flight settles before the next test begins. Anything
 * its body starts after that is refused — an `act`, an interaction, an event
 * fired through Testing Library's event wrapper — so the body stops there. A
 * test that fails or times out then fails alone. Outside such a run (a file
 * that does not call {@link isolateRuns}), `act` and the wrappers are Testing
 * Library's own.
 *
 * Every `act` a DOM test or its utilities open is this one, never Testing
 * Library's: a scope opened past it is one the run cannot wait for.
 *
 * @packageDocumentation
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { aroundEach } from "vitest";
import { act as testingAct, configure, getConfig } from "@testing-library/react";

/** One test's run: its name, whether it has ended, and its work in flight. */
interface Run {
    readonly name: string;
    ended: boolean;
    /** Each piece of work the test started that has not settled: an `act` scope, an interaction. */
    readonly inFlight: Set<Promise<void>>;
}

/** The run the code at hand belongs to: a test's body keeps its run through every await, after its test ends too. */
const runs = new AsyncLocalStorage<Run>();

/** What a test's body meets when it starts work after its test has ended. */
const endedError = (run: Run) =>
    new Error(`The test "${run.name}" has ended (it timed out or failed); the work its body went on with stops here (#1280).`);

/**
 * Starts a piece of a test's work and holds it in flight until it settles. Once
 * the test has ended, the work is not started; and work that settles after the
 * test ended hands its body an error, so the body goes no further.
 *
 * @param start - Starts the work
 * @returns What the work settles to
 */
function inFlight<T>(start: () => PromiseLike<T>): Promise<T> {
    const run = runs.getStore();
    if (run === undefined) return Promise.resolve(start());
    if (run.ended) return Promise.reject(endedError(run));
    const work = Promise.resolve(start());
    const settled = work.then(() => undefined, () => undefined);
    run.inFlight.add(settled);
    void settled.then(() => { run.inFlight.delete(settled); });
    return work.then((value) => (run.ended ? Promise.reject(endedError(run)) : value));
}

/** Whether a callback's result is a promise: an `act` over it is an async scope, open until it settles. */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";

/**
 * Testing Library's `act`, as a run takes it: a scope over an async callback
 * is the test's work in flight until it closes, and a test that has ended
 * opens none.
 *
 * @param callback - The work to do in the scope
 * @returns What Testing Library's `act` returns
 * @throws {Error} When the test whose body calls it has ended
 */
export const act = ((callback: () => unknown) => {
    const run = runs.getStore();
    if (run?.ended === true) throw endedError(run);
    let open = false;
    const result = testingAct(() => {
        const value = callback();
        open = isThenable(value);
        return value;
    });
    return open ? inFlight(() => result as PromiseLike<unknown>) : result;
}) as typeof testingAct;

// User-event's interactions and `waitFor` run through Testing Library's async
// wrapper, and every event it fires through its event wrapper: in a run, each
// is the test's work too.
const testing = getConfig();
configure({
    asyncWrapper: (cb) => inFlight(() => testing.asyncWrapper(cb)),
    eventWrapper: (cb) => {
        const run = runs.getStore();
        if (run?.ended === true) throw endedError(run);
        // What the event's dispatch answers: `fireEvent` returns it.
        return testing.eventWrapper(cb);
    },
});

/** Whether this file's tests are runs already: a file loads this module once, and two harnesses may ask. */
let isolated = false;

/**
 * Makes each test of the file a run of its own: its hooks and its body run in
 * it, and once the test ends — its afterEach hooks having unmounted what it
 * mounted — the run starts nothing more, and its work in flight settles before
 * the next test begins. Called as the file is collected: at its top, in a
 * harness the file calls there, or as a harness module loads. A second call
 * in the same file does nothing.
 */
export function isolateRuns(): void {
    if (isolated) return;
    isolated = true;
    aroundEach(async (runTest, context) => {
        const run: Run = { name: context.task.name, ended: false, inFlight: new Set() };
        try {
            await runs.run(run, runTest);
        } finally {
            // Nothing more starts in this run; what it has in flight settles before the next test begins.
            run.ended = true;
            while (run.inFlight.size > 0) await Promise.all(run.inFlight);
        }
    });
}
