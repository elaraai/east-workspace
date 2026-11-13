/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing core held to what it promises in every state it can reach —
 * the code itself, never a model of it. A world whose people are budgeted (so
 * many gestures and choices, so many requests, so many of another session's
 * writes) can be in finitely many states; each is told by its print — every
 * field the record, the sessions, the history and their people's steps hold —
 * and every operation is run from every state until none is new
 * (`explore.test-utils.ts`' `everyState`). What `world.test-utils.ts` and
 * `desk.test-utils.ts` hold then holds of every state there is under those
 * budgets, however many operations away, and each is brought to rest.
 *
 * `session-model.test.ts` and `history-model.test.ts` run every ordering to a
 * depth with no budget: more operations at once, fewer of them in a row. The
 * two are run together.
 *
 * `EDITING_MODEL_STATES=1` is a proof run: each family past the unit suite's
 * budgets one way at a time — a world with one more gesture, one with one
 * more request, one with one more of another session's writes — on one core
 * for each draft shape, the shapes run side by side (`-t "drafting a field at
 * a time"`, `-t "drafting a row whole"`: the `states-fields` and
 * `states-whole` parts of `make proof-editing` in libs/east-ui, which CI runs
 * for a pull request labelled `proof:editing`). `EDITING_MODEL_STATES=2`
 * raises every one of them at once: the largest world, which grows with every
 * field the session gains — a state's print holds each — and no longer ends in
 * a sitting for most families (12 Nov 2026). The unit suite runs the smallest.
 */
import { describe, expect, it } from "vitest";
import { deskAfter } from "./desk.test-utils.js";
import { everyState, type StatesWalked } from "./explore.test-utils.js";
import { worldAfter, type WorldOptions } from "./world.test-utils.js";

/** How far past the unit suite's budgets a run goes: not at all; one way at a time, a proof run; or every way at once. */
const LEVEL = Number(process.env["EDITING_MODEL_STATES"] ?? 0);
/** Whether this is a proof run: each family past the unit suite's budgets. */
const PROOF = LEVEL > 0;
/** The most states a walk meets before it gives up saying it met them all. */
const LIMIT = 2_000_000;
/**
 * How long one exploration may take: a backstop against a walk that never ends, never a budget. An exploration is
 * bounded by what it walks — a depth, so many runs, a limit of states — and takes what that takes on the machine it
 * runs on: a proof run's take minutes each, and on a CI runner some times what they take on a desk.
 */
const WITHIN = PROOF ? 10_800_000 : 600_000;

/** A world's budgets: how many gestures and choices, requests, and writes of another session's it runs. */
type Budget = Readonly<Record<string, number>>;

/**
 * The worlds a family walks: the unit suite's; in a proof run, the unit's raised to the larger budget one way at a
 * time, a world for each way the two differ; at `EDITING_MODEL_STATES=2`, the larger budget whole.
 *
 * @param unit - The unit suite's budgets
 * @param larger - The larger budgets
 * @returns Each world's budgets
 */
function budgets<T extends Budget>(unit: T, larger: T): T[] {
    if (LEVEL <= 0) return [unit];
    if (LEVEL >= 2) return [larger];
    const raised = Object.keys(larger).filter((way) => larger[way] !== unit[way]).map((way) => ({ ...unit, [way]: larger[way] }) as T);
    return raised.length === 0 ? [unit] : raised;
}

/** A world's budgets, in words: `2 acts, 1 sends`. */
function worded(budget: Budget): string {
    return Object.entries(budget).map(([way, count]) => `${count} ${way}`).join(", ");
}

/** What a walk covered, in a line. */
function said(name: string, walked: StatesWalked): string {
    return `[editing model] ${name}: ${walked.states} states, ${walked.transitions} operations run from them, the furthest ${walked.depth} operations away`;
}

/**
 * Walks every state of a family's worlds, each closed under its operations.
 *
 * @param name - The family, as its line names it
 * @param unit - The unit suite's budgets
 * @param larger - The larger budgets
 * @param walk - Walks one world of the budgets given
 * @throws {ModelFault} The first fault a walk meets — and an assertion's error where a walk gave up before it met every state
 */
async function walked<T extends Budget>(name: string, unit: T, larger: T, walk: (budget: T) => Promise<StatesWalked>): Promise<void> {
    for (const budget of budgets(unit, larger)) {
        const found = await walk(budget);
        console.info(said(`${name}, ${worded(budget)}`, found));
        expect(found.closed, `${name}, ${worded(budget)}: every state met`).toBe(true);
    }
}

/** Every state a world can reach. */
async function states(options: WorldOptions, allow: RegExp): Promise<StatesWalked> {
    return everyState((ops) => worldAfter(options, ops), (world) => world.print(), (op) => allow.test(op), () => undefined, LIMIT);
}

/** One person's gestures, Undo, Redo, Discard, Save and every way its request can go. */
const OWN = /^c\d\.(edit\(k1,[ab]\)|undo|redo|discard|save|deliver|deliverUnanswered|lose|retry|see|read|redraw)$/;
/** The same, with another session's write to the same field, and the choice it asks. */
const BESIDE = /^(c\d\.(edit\(k1,[ab]\)|undo|redo|discard|save|deliver|deliverUnanswered|lose|retry|see|read|redraw|settle\((draft|source)\))|remote\.edit\(k1,a\))$/;
/** One person's rows: a row removed and added again under its key, a row added and removed, with every way a request can go. */
const ROWS_OWN = /^c\d\.(edit\(k1,a\)|remove\(k1\)|add\(k1\)|add\(k3\)|remove\(k3\)|undo|redo|discard|save|deliver|deliverUnanswered|lose|retry|see|read|redraw)$/;
/**
 * Rows added and removed on both sides: a row changed here that another session removes, one removed here that it
 * changes, one both add under a key, a removed key added again — and the choice each asks.
 */
const ROWS_BESIDE = /^(c\d\.(edit\(k1,a\)|remove\(k1\)|add\(k3\)|undo|redo|discard|save|deliver|see|read|redraw|settle\((draft|source)\))|remote\.(edit\(k1,a\)|remove\(k1\)|add\(k1\)|add\(k3\)|remove\(k3\)))$/;
/** An optimiser's result among the gestures, a person's Save and an automatic one. */
const AUTOMATIC = /^c\d\.(edit\(k1,a\)|optimise\(k1,a\)|undo|redo|save|autosave|deliver|read|redraw)$/;
/** A source read whole: no reads by key, each new collection read and drawn at once. */
const INLINE = /^(c\d\.(edit\(k1,[ab]\)|undo|redo|discard|save|deliver|deliverUnanswered|lose|retry|see|settle\((draft|source)\))|remote\.edit\(k1,a\))$/;
/** The same in the unit suite, where each request is answered: a lost answer and its retry are a proof run's. */
const INLINE_ANSWERED = /^(c\d\.(edit\(k1,[ab]\)|undo|save|deliver|see|settle\((draft|source)\))|remote\.edit\(k1,a\))$/;
/**
 * One history over two records, in the unit suite: a gesture in each record and across both, an optimiser's result,
 * Undo, Redo, Save, an automatic Save, and each record's answer and reads. A proof run runs every operation a desk has.
 */
const DESK = /^(edit\(|both$|optimise\(A\)|undo$|redo$|save$|autosave$|deliver\(|read\(|redraw\()/;
/**
 * A Save's answer that comes late: the record takes the Save apart from its answer's arrival, another session writes
 * between the two, and the answer arrives before the page has heard of that write, after it, or in the very turn it does.
 */
const LATE = /^(c\d\.(edit\(k1,a\)|save|land|deliver|deliverPast|see|read|redraw)|remote\.edit\(k[12],a\))$/;
/**
 * A change taken back by hand while its conflict waits — a field typed back to what both sides began from — among
 * the gestures, the choices, Undo, Redo and the Saves.
 */
const BACK = /^(c\d\.(edit\(k1,[ab]\)|revert\(k1,[ab]\)|undo|redo|save|deliver|see|read|redraw|settle\((draft|source)\))|remote\.edit\(k1,a\))$/;
/** The same of rows: a new row both sides added removed again, a removed row put back as it was, a changed row typed back. */
const BACK_ROWS = /^(c\d\.(edit\(k1,a\)|revert\(k1,a\)|remove\(k1\)|restore\(k1\)|add\(k3\)|remove\(k3\)|undo|save|deliver|see|read|redraw|settle\((draft|source)\))|remote\.(edit\(k1,a\)|remove\(k1\)|add\(k3\)))$/;
/** The page reloaded with its drafts kept, at every point of a Save. */
const RELOADED = /^(c\d\.(edit\(k1,a\)|undo|save|deliver|deliverUnanswered|retry|reload|see|read|redraw|settle\(draft\))|remote\.edit\(k1,a\))$/;

for (const shape of ["fields", "whole"] as const) {
    describe(`every state the editing core can reach, drafting ${shape === "fields" ? "a field at a time" : "a row whole"}`, () => {
        it("one person: their gestures and Saves, with every way a request can go", async () => {
            // Three gestures and two requests at once walked 968,052 states in 42 minutes on 12 Nov 2026, and on the core
            // as it stood that evening no longer ended in 75: a proof run walks the two worlds either side of it.
            await walked(`${shape} own`, { acts: 2, sends: 1 }, { acts: 3, sends: 2 }, (budget) => states({ shape, remotes: 0, ...budget }, OWN));
        }, WITHIN);

        it("another session's write to the same field: gestures, Saves, and the choice it asks", async () => {
            await walked(`${shape} beside`, { acts: 1, sends: 1 }, { acts: 2, sends: 2 }, (budget) => states({ shape, remotes: 1, ...budget }, BESIDE));
        }, WITHIN);

        it("one person's rows: a row removed and added again, a row added and removed, with every way a request can go", async () => {
            await walked(`${shape} rows own`, { acts: 2, sends: 1 }, { acts: 3, sends: 2 }, (budget) => states({ shape, remotes: 0, ...budget }, ROWS_OWN));
        }, WITHIN);

        it("rows added and removed on both sides: a row changed here and removed there, removed here and changed there, added by both, and the choice each asks", async () => {
            await walked(`${shape} rows beside`, { remotes: 1, acts: 1, sends: 1 }, { remotes: 2, acts: 2, sends: 2 }, (budget) => states({ shape, ...budget }, ROWS_BESIDE));
        }, WITHIN);

        it("an automatic Save: gestures, an optimiser's result, Undo, Redo and a person's Save", async () => {
            await walked(`${shape} automatic`, { acts: 2, sends: 2 }, { acts: 3, sends: 2 }, (budget) => states({ shape, remotes: 0, ...budget }, AUTOMATIC));
        }, WITHIN);

        it("a source read whole, with another session's write", async () => {
            await walked(`${shape} inline`, { acts: 2, sends: 1 }, { acts: 2, sends: 2 }, (budget) => states({ shape, remotes: 1, inline: true, ...budget }, PROOF ? INLINE : INLINE_ANSWERED));
        }, WITHIN);

        it("a Save's answer that comes late: the record taking the Save, another session's writes, the page hearing of them, and the answer — before, after, or as the page moves on", async () => {
            await walked(`${shape} late`, { remotes: 1, acts: 1, sends: 1 }, { remotes: 2, acts: 2, sends: 2 }, (budget) => states({ shape, ...budget }, LATE));
        }, WITHIN);

        it("a change taken back by hand while its conflict waits: a field typed back to what both sides began from, with the choices, Undo, Redo and the Saves around it", async () => {
            await walked(`${shape} taken back`, { acts: 2, sends: 1 }, { acts: 3, sends: 2 }, (budget) => states({ shape, remotes: 1, flips: true, ...budget }, BACK));
        }, WITHIN);

        it("a row's change taken back by hand while its conflict waits: a new row removed again, a removed row put back, a changed row typed back", async () => {
            await walked(`${shape} rows taken back`, { acts: 2, sends: 1 }, { acts: 3, sends: 2 }, (budget) => states({ shape, remotes: 1, flips: true, ...budget }, BACK_ROWS));
        }, WITHIN);

        it("a page reloaded with its drafts kept, with another session's write", async () => {
            await walked(`${shape} reloaded`, { acts: 2, sends: 1 }, { acts: 2, sends: 2 }, (budget) => states({ shape, remotes: 1, ...budget }, RELOADED));
        }, WITHIN);

        it("a record that has forgotten a request sent again: another session's write to the same field, with every way a request can go", async () => {
            // What a record is to a request sixteen others have followed: sent again it is checked afresh, and the
            // session judges what it finds by evidence. Every other family's record remembers its requests, as e3 does.
            await walked(`${shape} beside, forgotten`, { acts: 1, sends: 1 }, { acts: 2, sends: 2 }, (budget) => states({ shape, remotes: 1, remembers: 0, ...budget }, BESIDE));
        }, WITHIN);

        it("a record that has forgotten a request sent again: a page reloaded with its drafts kept, with another session's write", async () => {
            await walked(`${shape} reloaded, forgotten`, { acts: 2, sends: 1 }, { acts: 2, sends: 2 }, (budget) => states({ shape, remotes: 1, remembers: 0, ...budget }, RELOADED));
        }, WITHIN);

        it("one history over two records: gestures in each and across both, an optimiser's result and an automatic Save among them", async () => {
            await walked(`${shape} desk`, { acts: 2, sends: 1 }, { acts: 2, sends: 2 },
                (budget) => everyState((ops) => deskAfter(shape, ops, budget), (desk) => desk.print(), (op) => PROOF || DESK.test(op), () => undefined, LIMIT));
        }, WITHIN);
    });
}

describe("a state's print", () => {
    it("is the same for a world replayed, whatever ids its requests drew", async () => {
        const ops = ["c0.edit(k1,a)", "c0.save", "remote.edit(k1,a)", "c0.deliver", "c0.see", "c0.read"];
        const [a, b] = [await worldAfter({ shape: "fields" }, ops), await worldAfter({ shape: "fields" }, ops)];
        expect(a.print()).toBe(b.print());
    });

    it("tells apart two worlds that differ in what a session holds, and in nothing a person sees", async () => {
        // Both show k1.a as it began with nothing pending: one never touched it, the other edited it and took the edit back.
        const [untouched, undone] = [await worldAfter({ shape: "fields" }, []), await worldAfter({ shape: "fields" }, ["c0.edit(k1,a)", "c0.undo"])];
        expect([untouched.clients[0]!.session.pending, undone.clients[0]!.session.pending]).toEqual([0, 0]);
        expect(untouched.clients[0]!.shown("k1")).toEqual(undone.clients[0]!.shown("k1"));
        expect(untouched.print()).not.toBe(undone.print());
    });

    it("is the same for two orderings of operations that do not meet", async () => {
        const [a, b] = [
            await worldAfter({ shape: "fields", clients: 2 }, ["c0.edit(k1,a)", "c1.edit(k2,a)"]),
            await worldAfter({ shape: "fields", clients: 2 }, ["c1.edit(k2,a)", "c0.edit(k1,a)"]),
        ];
        expect(a.print()).toBe(b.print());
    });
});
