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
 * `EDITING_MODEL_STATES=1` runs each family at its larger budgets: a proof
 * run, by hand, some tens of minutes. The unit suite runs the smaller ones.
 */
import { describe, expect, it } from "vitest";
import { deskAfter } from "./desk.test-utils.js";
import { everyState, type StatesWalked } from "./explore.test-utils.js";
import { worldAfter, type WorldOptions } from "./world.test-utils.js";

/** Whether this is a proof run: each family at its larger budgets. */
const PROOF = Number(process.env["EDITING_MODEL_STATES"] ?? 0) > 0;
/** The most states a walk meets before it gives up saying it met them all. */
const LIMIT = 2_000_000;

/** A family's budgets: the unit suite's, or a proof run's. */
function budgets<T>(unit: T, proof: T): T {
    return PROOF ? proof : unit;
}

/** What a walk covered, in a line. */
function said(name: string, walked: StatesWalked): string {
    return `[editing model] ${name}: ${walked.states} states, ${walked.transitions} operations run from them, the furthest ${walked.depth} operations away`;
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
            const walked = await states({ shape, remotes: 0, ...budgets({ acts: 2, sends: 1 }, { acts: 3, sends: 2 }) }, OWN);
            console.info(said(`${shape} own`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("another session's write to the same field: gestures, Saves, and the choice it asks", async () => {
            const walked = await states({ shape, remotes: 1, ...budgets({ acts: 1, sends: 1 }, { acts: 2, sends: 2 }) }, BESIDE);
            console.info(said(`${shape} beside`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("one person's rows: a row removed and added again, a row added and removed, with every way a request can go", async () => {
            const walked = await states({ shape, remotes: 0, ...budgets({ acts: 2, sends: 1 }, { acts: 3, sends: 2 }) }, ROWS_OWN);
            console.info(said(`${shape} rows own`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("rows added and removed on both sides: a row changed here and removed there, removed here and changed there, added by both, and the choice each asks", async () => {
            const walked = await states({ shape, ...budgets({ remotes: 1, acts: 1, sends: 1 }, { remotes: 2, acts: 2, sends: 2 }) }, ROWS_BESIDE);
            console.info(said(`${shape} rows beside`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("an automatic Save: gestures, an optimiser's result, Undo, Redo and a person's Save", async () => {
            const walked = await states({ shape, remotes: 0, ...budgets({ acts: 2, sends: 2 }, { acts: 3, sends: 2 }) }, AUTOMATIC);
            console.info(said(`${shape} automatic`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a source read whole, with another session's write", async () => {
            const walked = await states({ shape, remotes: 1, inline: true, ...budgets({ acts: 2, sends: 1 }, { acts: 2, sends: 2 }) }, PROOF ? INLINE : INLINE_ANSWERED);
            console.info(said(`${shape} inline`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a Save's answer that comes late: the record taking the Save, another session's writes, the page hearing of them, and the answer — before, after, or as the page moves on", async () => {
            const walked = await states({ shape, ...budgets({ remotes: 1, acts: 1, sends: 1 }, { remotes: 2, acts: 2, sends: 2 }) }, LATE);
            console.info(said(`${shape} late`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a change taken back by hand while its conflict waits: a field typed back to what both sides began from, with the choices, Undo, Redo and the Saves around it", async () => {
            const walked = await states({ shape, remotes: 1, flips: true, ...budgets({ acts: 2, sends: 1 }, { acts: 3, sends: 2 }) }, BACK);
            console.info(said(`${shape} taken back`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a row's change taken back by hand while its conflict waits: a new row removed again, a removed row put back, a changed row typed back", async () => {
            const walked = await states({ shape, remotes: 1, flips: true, ...budgets({ acts: 2, sends: 1 }, { acts: 3, sends: 2 }) }, BACK_ROWS);
            console.info(said(`${shape} rows taken back`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a page reloaded with its drafts kept, with another session's write", async () => {
            const walked = await states({ shape, remotes: 1, ...budgets({ acts: 2, sends: 1 }, { acts: 2, sends: 2 }) }, RELOADED);
            console.info(said(`${shape} reloaded`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a record that has forgotten a request sent again: another session's write to the same field, with every way a request can go", async () => {
            // What a record is to a request sixteen others have followed: sent again it is checked afresh, and the
            // session judges what it finds by evidence. Every other family's record remembers its requests, as e3 does.
            const walked = await states({ shape, remotes: 1, remembers: 0, ...budgets({ acts: 1, sends: 1 }, { acts: 2, sends: 2 }) }, BESIDE);
            console.info(said(`${shape} beside, forgotten`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("a record that has forgotten a request sent again: a page reloaded with its drafts kept, with another session's write", async () => {
            const walked = await states({ shape, remotes: 1, remembers: 0, ...budgets({ acts: 2, sends: 1 }, { acts: 2, sends: 2 }) }, RELOADED);
            console.info(said(`${shape} reloaded, forgotten`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);

        it("one history over two records: gestures in each and across both, an optimiser's result and an automatic Save among them", async () => {
            const budget = budgets({ acts: 2, sends: 1 }, { acts: 2, sends: 2 });
            const walked = await everyState((ops) => deskAfter(shape, ops, budget), (desk) => desk.print(), (op) => PROOF || DESK.test(op), () => undefined, LIMIT);
            console.info(said(`${shape} desk`, walked));
            expect(walked.closed).toBe(true);
        }, 3_600_000);
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
