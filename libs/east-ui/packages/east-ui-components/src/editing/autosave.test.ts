/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * An automatic Save's timing, under a clock the test moves: when it sends,
 * what it waits for, and how it tries again what failed. What it sends is its
 * target's to say (`session-autosave.test.ts` runs it over a session).
 */

import { expect, test } from "vitest";
import {
    AUTOSAVE_PAUSE_MS, AUTOSAVE_RETRY_MAX_MS, AUTOSAVE_STALLED_MS, autosaveBackoff, autosaveStalled, createAutosave,
    type AutosaveClock, type AutosaveState, type AutosaveTarget,
} from "./autosave.js";

/** A clock the test moves: its time, its waits, and how many wait. */
function testClock() {
    let now = 0;
    let serial = 0;
    const waits = new Map<number, { at: number; run: () => void }>();
    const clock: AutosaveClock = {
        now: () => now,
        after: (ms, run) => {
            const id = serial++;
            waits.set(id, { at: now + ms, run });
            return () => { waits.delete(id); };
        },
    };
    /** Moves the time on, each wait run as its time comes — those made meanwhile too. */
    const advance = (ms: number): void => {
        const end = now + ms;
        for (;;) {
            let next: { id: number; at: number; run: () => void } | undefined;
            for (const [id, wait] of waits) if (wait.at <= end && (next === undefined || wait.at < next.at)) next = { id, ...wait };
            if (next === undefined) break;
            waits.delete(next.id);
            now = Math.max(now, next.at);
            next.run();
        }
        now = end;
    };
    return { clock, advance, waiting: () => waits.size, time: () => now };
}

/** Lets what a promise's settling sets going run to its end. */
const settled = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** What a scripted target says of itself. */
interface Said {
    edits: number;
    canAutosave: boolean;
    saving: AutosaveState;
}

/**
 * A target the test scripts: what it says of itself, each Save it was asked
 * to send — the time, and its count of gestures then — and each ask again.
 */
function scripted(clock: AutosaveClock) {
    const listeners = new Set<() => void>();
    const state: Said = { edits: 0, canAutosave: false, saving: "idle" };
    const sent: { at: number; edits: number }[] = [];
    const asked: number[] = [];
    let reads = 0;
    let out: { resolve: (took: boolean) => void; reject: (error: Error) => void } | undefined;
    /** What an ask again does to the target, as the test sets it. */
    let onRetry: (() => void) | undefined;
    const said = (): void => { for (const listener of [...listeners]) listener(); };
    const target: AutosaveTarget = {
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        get edits() { return state.edits; },
        get canAutosave() { reads += 1; return state.canAutosave; },
        get saving() { return state.saving; },
        autosave: () => {
            sent.push({ at: clock.now(), edits: state.edits });
            return new Promise<boolean>((resolve, reject) => { out = { resolve, reject }; });
        },
        retry: () => { asked.push(clock.now()); onRetry?.(); },
    };
    /** The target moves, and says so. */
    const say = (next: Partial<Said>): void => { Object.assign(state, next); said(); };
    return {
        target, sent, asked, listeners, say,
        /** How many times it was asked whether it had something to send. */
        reads: () => reads,
        /** A gesture: a change to send, said. */
        edit: (): void => { state.edits += 1; state.canAutosave = true; said(); },
        /**
         * The Save on its way settles, the target as it stands then — said first, as a session says each state it
         * passes — and whether the source took it.
         */
        answer: async (next: Partial<Said>, took = true): Promise<void> => { say(next); out!.resolve(took); await settled(); },
        /** The Save on its way throws, the target as it stands then. */
        fail: async (next: Partial<Said>): Promise<void> => { say(next); out!.reject(new Error("no answer")); await settled(); },
        /** A Save answered and read back, as a session passes through each: sent, read back, then idle. */
        through: (): void => { say({ saving: "sending" }); say({ saving: "readingBack" }); say({ saving: "idle" }); },
        retrying: (run: (() => void) | undefined): void => { onRetry = run; },
    };
}

/** An automatic Save over a scripted target, on. */
function running(on = true) {
    const { clock, advance, waiting, time } = testClock();
    const script = scripted(clock);
    const autosave = createAutosave(script.target, clock);
    autosave.enable(on);
    return { ...script, autosave, advance, waiting, time };
}

test("off, nothing is sent however long changes wait; turned on, what was drafted before goes one pause after it is turned on, never at once", () => {
    const { autosave, edit, sent, advance, waiting } = running(false);
    edit();
    advance(60_000);
    expect([autosave.enabled(), sent, waiting()]).toEqual([false, [], 0]);
    autosave.enable(true);
    advance(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toEqual([{ at: 60_000 + AUTOSAVE_PAUSE_MS, edits: 1 }]);
});

test("a Save goes one pause after the last gesture: each gesture starts the pause again, so a run of edits is one Save", () => {
    const { edit, sent, advance } = running();
    edit();
    advance(1_500);
    edit();
    advance(1_500);
    edit();
    advance(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toEqual([{ at: 3_000 + AUTOSAVE_PAUSE_MS, edits: 3 }]);
});

test("with nothing to send, nothing waits", () => {
    const { say, sent, advance, waiting } = running();
    say({ edits: 1 });
    expect(waiting()).toBe(0);
    advance(60_000);
    expect(sent).toEqual([]);
});

test("a key pressed or a pointer let go starts the pause again, and asks the target nothing: the wait in hand looks again as it ends", () => {
    const { autosave, edit, sent, advance, reads } = running();
    edit();
    advance(1_900);
    const before = reads();
    autosave.touch();
    autosave.touch();
    expect(reads()).toBe(before);
    advance(100);
    // The pause as first counted is over, and the person has acted since: nothing goes until a pause after that.
    expect(sent).toEqual([]);
    advance(1_899);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toEqual([{ at: 1_900 + AUTOSAVE_PAUSE_MS, edits: 1 }]);
});

test("nothing is sent under a hold — a pointer held, a drag, an open editor, a run of the optimiser — and a Save due meanwhile goes as the last one lifts", () => {
    for (const reason of ["pointer", "drag", "editor", "run"] as const) {
        const { autosave, edit, sent, advance, time } = running();
        edit();
        autosave.hold(reason, true);
        advance(30_000);
        expect([reason, sent]).toEqual([reason, []]);
        // The pause passed long ago: it goes at once.
        autosave.hold(reason, false);
        advance(0);
        expect([reason, sent]).toEqual([reason, [{ at: time(), edits: 1 }]]);
    }
    // Two at once: it waits for both. The last let go within the pause of the person's last act, it waits the pause out.
    const { autosave, edit, sent, advance } = running();
    autosave.hold("pointer", true);
    autosave.hold("editor", true);
    edit();
    advance(500);
    autosave.hold("pointer", false);
    advance(10_000);
    expect(sent).toEqual([]);
    autosave.touch();
    autosave.hold("editor", false);
    advance(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toEqual([]);
    advance(1);
    expect(sent).toEqual([{ at: 10_500 + AUTOSAVE_PAUSE_MS, edits: 1 }]);
});

test("one request at a time: while its Save is on its way and read back nothing more is sent, and what was drafted meanwhile goes once it can — at once where the person's pause has passed", async () => {
    const { edit, say, answer, sent, advance, waiting } = running();
    edit();
    advance(AUTOSAVE_PAUSE_MS);
    expect(sent).toHaveLength(1);
    // The request out: the session has nothing an automatic Save may send. More is drafted meanwhile.
    say({ canAutosave: false, saving: "sending" });
    say({ edits: 2 });
    advance(30_000);
    expect([sent.length, waiting()]).toEqual([1, 0]);
    // Answered, and read back: the session can send again, the person's last act long ago.
    await answer({ saving: "readingBack" });
    say({ saving: "idle", canAutosave: true });
    advance(0);
    expect(sent).toEqual([{ at: AUTOSAVE_PAUSE_MS, edits: 1 }, { at: AUTOSAVE_PAUSE_MS + 30_000, edits: 2 }]);
});

test("a person's own Save on its way holds an automatic one as its own does: nothing is sent until it is read back", () => {
    const { edit, say, sent, advance, waiting } = running();
    edit();
    advance(1_000);
    // The person presses Save: the request is the session's, none of the automatic Save's doing.
    say({ canAutosave: false, saving: "sending" });
    say({ edits: 2 });
    advance(30_000);
    expect([sent, waiting()]).toEqual([[], 0]);
    say({ saving: "readingBack" });
    say({ saving: "idle", canAutosave: true });
    advance(0);
    expect(sent).toEqual([{ at: 31_000, edits: 2 }]);
});

test("a Save the source did not take — never asked, or refused — is tried again by itself, each wait twice the last up to a minute; a gesture ends the wait, and the pause is counted again", async () => {
    const { edit, answer, sent, advance, time } = running();
    edit();
    advance(AUTOSAVE_PAUSE_MS);
    // Its preparation failed, or another write got there first and it was refused: what it may send is as it was.
    await answer({}, false);
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
        const failed = time();
        advance(AUTOSAVE_RETRY_MAX_MS);
        waits.push(sent[sent.length - 1]!.at - failed);
        await answer({}, false);
    }
    expect(waits).toEqual([4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    expect(waits).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => autosaveBackoff(n)));
    // The person changes something: it goes a pause later, the waits forgotten.
    const count = sent.length;
    edit();
    advance(AUTOSAVE_PAUSE_MS - 1);
    expect(sent).toHaveLength(count);
    advance(1);
    expect(sent).toHaveLength(count + 1);
    // It goes through: the next change waits a pause, no longer.
    await answer({ canAutosave: false });
    edit();
    advance(AUTOSAVE_PAUSE_MS);
    expect(sent).toHaveLength(count + 2);
});

test("a write left with no answer is sent again by itself, its waits twice the last: its own, and a person's Save's, a first wait after it is seen", async () => {
    const { edit, fail, through, sent, asked, advance, time } = running();
    edit();
    advance(AUTOSAVE_PAUSE_MS);
    await fail({ canAutosave: false, saving: "unanswered" });
    const from = time();
    advance(3_999);
    expect(asked).toEqual([]);
    advance(1);
    expect(asked).toEqual([from + 4_000]);
    // Asked again, and it stands as it stood: twice as long.
    advance(8_000);
    expect(asked).toEqual([from + 4_000, from + 12_000]);
    // Answered at last, and read back: nothing more is asked, and the next change waits a pause.
    through();
    advance(120_000);
    expect(asked).toHaveLength(2);
    edit();
    advance(AUTOSAVE_PAUSE_MS);
    expect(sent).toHaveLength(2);

    // A person's Save left with no answer, none of its own tries: asked again after a first wait from when it is seen.
    const own = running();
    own.advance(50_000);
    own.say({ saving: "unanswered" });
    own.advance(3_999);
    expect(own.asked).toEqual([]);
    own.advance(1);
    expect(own.asked).toEqual([54_000]);
});

test("a write sent again that is left with no answer again waits twice as long, each time; answered, the count starts over", () => {
    const { say, retrying, asked, advance, time } = running();
    say({ saving: "unanswered" });
    // Each ask sends the request again, as a session does: on its way, then left with no answer again.
    let lands: (() => void) | undefined;
    retrying(() => { say({ saving: "sending" }); lands = () => say({ saving: "unanswered" }); });
    const waits: number[] = [];
    let failed = time();
    for (let i = 0; i < 4; i++) {
        advance(AUTOSAVE_RETRY_MAX_MS);
        waits.push(asked[asked.length - 1]! - failed);
        lands!();
        failed = time();
    }
    expect(waits).toEqual([4_000, 8_000, 16_000, 32_000]);
    // Answered at last, and read back: left with no answer once more, it starts at the first wait.
    lands = undefined;
    advance(AUTOSAVE_RETRY_MAX_MS);
    say({ saving: "readingBack" });
    say({ saving: "idle" });
    retrying(undefined);
    const count = asked.length;
    say({ saving: "sending" });
    say({ saving: "unanswered" });
    advance(4_000);
    expect(asked.slice(count)).toEqual([time()]);
});

test("a read back that failed is asked for again by itself, its waits twice the last while it goes on failing; read back at last, the count starts over", () => {
    const { say, retrying, asked, advance, time } = running();
    say({ saving: "readingBack" });
    advance(1_000);
    say({ saving: "readBackFailed" });
    // Each ask reads it back again, as a session's refresh does, and it fails again a second later.
    retrying(() => say({ saving: "readingBack" }));
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
        const failed = time();
        const count = asked.length;
        for (let second = 0; second < 120 && asked.length === count; second++) advance(1_000);
        waits.push(asked[asked.length - 1]! - failed);
        advance(1_000);
        say({ saving: "readBackFailed" });
    }
    expect(waits).toEqual([4_000, 8_000, 16_000]);
    // An ask that fails at once — the source refuses the refresh itself — waits longer too.
    retrying(undefined);
    const failed = time();
    advance(32_000);
    expect(asked[asked.length - 1]).toBe(failed + 32_000);
    advance(59_999);
    expect(asked[asked.length - 1]).toBe(failed + 32_000);
    advance(1);
    expect(asked[asked.length - 1]).toBe(failed + 32_000 + AUTOSAVE_RETRY_MAX_MS);
    // Read back at last: a failure after it starts at the first wait.
    say({ saving: "readingBack" });
    say({ saving: "idle" });
    say({ saving: "readingBack" });
    say({ saving: "readBackFailed" });
    const again = time();
    const count = asked.length;
    advance(4_000);
    expect(asked.slice(count)).toEqual([again + 4_000]);
});

test("a read back that does not move is asked for again after ten seconds, then twice as long; one that moves starts the wait again, and its own ask is no move", () => {
    const { say, retrying, asked, advance } = running();
    say({ saving: "readingBack" });
    advance(AUTOSAVE_STALLED_MS - 1);
    expect(asked).toEqual([]);
    // Asking says the target moved, as a session's refresh does: no move of the read back.
    retrying(() => say({}));
    advance(1);
    expect(asked).toEqual([10_000]);
    advance(20_000);
    expect(asked).toEqual([10_000, 30_000]);
    expect([autosaveStalled(0), autosaveStalled(1), autosaveStalled(2), autosaveStalled(9)]).toEqual([10_000, 20_000, 40_000, AUTOSAVE_RETRY_MAX_MS]);
    // The read back moves — an entry read: the wait starts again at ten seconds.
    advance(5_000);
    say({});
    advance(AUTOSAVE_STALLED_MS - 1);
    expect(asked).toHaveLength(2);
    advance(1);
    expect(asked).toEqual([10_000, 30_000, 45_000]);
    // Read back: nothing more is asked.
    say({ saving: "idle" });
    advance(600_000);
    expect(asked).toHaveLength(3);
});

test("as the page goes, what is due is sent at once whatever the pause and whatever the person holds — never off, never while a run of the optimiser is out, never twice", async () => {
    const { autosave, edit, answer, sent, advance } = running();
    edit();
    autosave.hold("pointer", true);
    autosave.hold("editor", true);
    advance(100);
    autosave.flush();
    expect(sent).toEqual([{ at: 100, edits: 1 }]);
    // Its Save on its way: a second flush sends nothing more.
    autosave.flush();
    expect(sent).toHaveLength(1);
    await answer({ canAutosave: false });
    // A run of the optimiser out: its result is drafted over what the page holds, and nothing is sent under it.
    edit();
    autosave.hold("run", true);
    autosave.flush();
    expect(sent).toHaveLength(1);
    // Off: nothing.
    const off = running(false);
    off.edit();
    off.autosave.flush();
    expect(off.sent).toEqual([]);
    // A write left with no answer is sent again as the page goes.
    const lost = running();
    lost.say({ saving: "unanswered" });
    lost.autosave.flush();
    expect(lost.asked).toEqual([0]);
});

test("turned off, a Save that waited is not sent; disposed, the target is heard no more and nothing waits", () => {
    const { autosave, edit, sent, advance, waiting, listeners } = running();
    edit();
    advance(1_000);
    autosave.enable(false);
    advance(60_000);
    expect([sent, waiting()]).toEqual([[], 0]);
    autosave.enable(true);
    expect(waiting()).toBe(1);
    autosave.dispose();
    expect([waiting(), listeners.size]).toEqual([0, 0]);
    edit();
    advance(60_000);
    expect(sent).toEqual([]);
});

test("a target that throws as it is asked to save is tried again as one that could not be sent, never left to throw", async () => {
    const { clock, advance } = testClock();
    let tries = 0;
    const listeners = new Set<() => void>();
    const target: AutosaveTarget = {
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        edits: 1, canAutosave: true, saving: "idle",
        autosave: (): Promise<boolean> => { tries += 1; throw new Error("could not prepare"); },
        retry: () => undefined,
    };
    const autosave = createAutosave(target, clock);
    autosave.enable(true);
    advance(AUTOSAVE_PAUSE_MS);
    expect(tries).toBe(1);
    await settled();
    advance(3_999);
    expect(tries).toBe(1);
    advance(1);
    expect(tries).toBe(2);
});
