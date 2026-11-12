/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing core held to what it promises, over orderings rather than
 * examples: every ordering of a world's operations to a depth, and seeded
 * random runs past it (`world.test-utils.ts` says what a world is, what its
 * operations are and what must hold after each).
 *
 * Each ordering is run from a fresh world, checked after every operation, and
 * then brought to rest — every request answered, every revision read and
 * drawn, every conflict chosen for the draft, every change saved — and checked
 * at rest. Two operations whose order is no matter (`independent`) are run in
 * one order only.
 *
 * `EDITING_MODEL_DEPTH` deepens every exploration by that many operations, and
 * `EDITING_MODEL_RUNS` multiplies the random runs: a proof run, by hand
 * (`EDITING_MODEL_DEPTH=1 EDITING_MODEL_RUNS=20`, some minutes). The unit
 * suite runs the depths below, with no clock and no retry.
 *
 * Each exploration also says what it only counts (`--silent=false
 * --reporter=verbose` shows it): in how many orderings a session's steps went
 * under its person, and in how many a reload lost a change or asked of one
 * already saved.
 *
 * One history over several sessions is `history-model.test.ts`'s.
 */
import { describe, expect, it } from "vitest";
import { everyOrdering, seeded } from "./explore.test-utils.js";
import { ModelWorld, independent, worldAfter, type ModelOp, type WorldOptions } from "./world.test-utils.js";

const DEEPER = Number(process.env["EDITING_MODEL_DEPTH"] ?? 0);
const RUNS = Number(process.env["EDITING_MODEL_RUNS"] ?? 1);

/** What an exploration covered. */
interface Explored {
    /** How many orderings it ran, each from a fresh world, and brought to rest. */
    worlds: number;
    /** In how many of them a session's steps went under its person: Undo lost as the source moved. */
    stepsLost: number;
    /** In how many of them a person was asked to choose, with nothing to save, over a row of a request with no answer that was sent again and refused. */
    unansweredAsked: number;
    /** In how many of them a Save over a source read whole waited for good to be read back: every part it wrote put back since, exactly. */
    waitedForGood: number;
    /** In how many of them a Save's late answer stepped a screen back to the revision the Save committed. */
    lateAnswer: number;
    /** In how many of them a session whose host cannot say when it read took a collection read before its Save landed for one read after. */
    readEarly: number;
}

/**
 * Runs every ordering of a world's operations to a depth.
 *
 * @param options - What each world is made of
 * @param depth - How many operations an ordering holds at most
 * @param allow - Which operations it explores
 * @returns What it covered
 * @throws {ModelFault} The first fault, with the operations that led to it
 */
async function explore(options: WorldOptions, depth: number, allow: (op: ModelOp) => boolean): Promise<Explored> {
    const found: Explored = { worlds: 0, stepsLost: 0, unansweredAsked: 0, waitedForGood: 0, lateAnswer: 0, readEarly: 0 };
    found.worlds = await everyOrdering((ops) => worldAfter(options, ops), depth, allow, independent, (world) => {
        if (world.stepsLost > 0) found.stepsLost++;
        if (world.unansweredAsked > 0) found.unansweredAsked++;
        if (world.waitedForGood > 0) found.waitedForGood++;
        if (world.lateAnswer > 0) found.lateAnswer++;
        if (world.readEarly > 0) found.readEarly++;
    });
    return found;
}

/** What an exploration covered, in a line. */
function said(name: string, found: Explored): string {
    const waited = `${found.waitedForGood === 0 ? "" : `; a Save read whole waited for good in ${found.waitedForGood}`}${found.readEarly === 0 ? "" : `; a collection read before a Save landed was taken for one read after in ${found.readEarly}`}${found.lateAnswer === 0 ? "" : `; a late answer stepped a screen back in ${found.lateAnswer}`}`;
    return `[editing model] ${name}: ${found.worlds} orderings; steps lost in ${found.stepsLost}; asked with nothing to save, after a request with no answer was refused, in ${found.unansweredAsked}${waited}`;
}

/**
 * One random run: operations picked by a seed among those that can run, then the world brought to rest.
 *
 * @param options - What the world is made of
 * @param seed - The seed
 * @param length - How many operations it runs
 * @returns The world, at rest
 * @throws {Error} The fault, with the seed and the operations that led to it
 */
async function wander(options: WorldOptions, seed: number, length: number): Promise<ModelWorld> {
    const random = seeded(seed);
    const world = new ModelWorld(options);
    try {
        await world.start();
        for (let i = 0; i < length; i++) {
            const ops = world.enabled();
            if (ops.length === 0) break;
            await world.run(ops[Math.floor(random() * ops.length)]!);
        }
        await world.rest();
    } catch (error) {
        throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return world;
}

/** Several rows drafted and several conflicts at once: reads landing a row at a time, choices made one at a time. */
const SEVERAL = /^(c\d\.(edit\(k[12],a\)|edit\(k1,b\)|save|deliver|see|read|read1|redraw|settle|settle1)|remote\.edit)/;
/** A person's own acts and their Save's ways: nothing of another session. */
const OWN = /^c\d\.(edit|remove|add|undo|redo|discard|save|deliver|deliverUnanswered|lose|retry|read|redraw)\b/;
/** One person's gestures on one row, and everything a write of another session's can meet. */
const BESIDE = /^(c\d\.(edit\(k1,[ab]\)|undo|redo|save|deliver|deliverUnanswered|retry|see|read|redraw|settle)|remote\.(edit|remove))/;
/** Rows added and removed on both sides. */
const ROWS = /^(c\d\.(remove|add|edit\(k1,a\)|undo|save|deliver|see|read|redraw|settle)|remote\.(remove|add))/;
/** A row removed here that another session changes: the removal, its Save and the choice it asks, with the row added again under its key. */
const REMOVED_HERE = /^(c\d\.(remove\(k1\)|add\(k1\)|edit\(k1,a\)|undo|redo|save|deliver|deliverUnanswered|retry|see|read|redraw|settle)|remote\.edit\(k1,[ab]\))/;
/** A key removed and added again on either side, and a row added that is then changed or removed — by the one who added it, or by the other. */
const ADDED = /^(c\d\.(remove\(k1\)|add\(k[13]\)|edit\(k3,a\)|remove\(k3\)|undo|save|deliver|see|read|redraw|settle)|remote\.(remove\(k[13]\)|add\(k[13]\)|edit\(k3,a\)))/;
/** A person's gestures, an optimiser's result among them, with a Save of their own and an automatic one. */
const AUTOMATIC = /^c\d\.(edit\(k1,[ab]\)|optimise|undo|redo|save|autosave|deliver|read|redraw)/;
/** A page reloaded with drafts kept, at every point of a Save and of another session's write. */
const RELOADED = /^(c\d\.(edit\(k[12],a\)|optimise|undo|save|autosave|deliver|deliverUnanswered|reload|read|redraw|settle\(draft\))|remote\.edit\(k1,a\))/;
/** A Save prepared before it is sent, done or failing, at every point of the gestures, an automatic Save and another session's write. */
const PREPARED = /^(c\d\.(edit\(k1,[ab]\)|optimise|undo|save|autosave|prepared|prepareFails|deliver|see|read|redraw|settle\(draft\))|remote\.edit\(k1,a\))/;
/** A source read whole: a person's gestures, Saves and choices with another session's writes, each new collection read and drawn at once. */
const INLINE = /^(c\d\.(edit\(k1,[ab]\)|remove|undo|redo|save|deliver|deliverUnanswered|retry|see|settle)|remote\.(edit|remove))/;
/** Two people over a source read whole: a row one adds and the other removes, each Save read back as the other's lands. */
const INLINE_TWO = /^c\d\.(add|remove\(k3\)|edit\(k1,a\)|save|deliver|see|settle\(draft\))/;
/** A Save's answer that comes late: the record takes the Save, another session writes, the page hears of that write — and then the answer arrives. */
const LATE = /^(c\d\.(edit\(k1,a\)|save|land|deliver|see|read|redraw|settle\(draft\))|remote\.edit\(k[12],a\))/;
/** A field's change taken back by hand while its conflict waits — typed back to what both sides began from — and what a Save may then write. */
const BACK_FIELD = /^(c\d\.(edit\(k1,[ab]\)|revert|undo|save|deliver|see|read|redraw|settle\((draft|source)\))|remote\.edit\(k1,a\))/;
/** A row's change taken back by hand while its conflict waits: a new row removed again, a removed row put back, a changed row typed back. */
const BACK_ROWS = /^(c\d\.(add\(k3\)|remove\(k[13]\)|edit\(k1,a\)|revert|restore|save|deliver|see|read|redraw|settle\((draft|source)\))|remote\.(add\(k3\)|remove\(k1\)|edit\(k1,a\)))/;
/**
 * One person's gestures on one row, never taken back nor saved — so a change of theirs waits from the first on —
 * beside another session's writes of another row.
 */
const ELSEWHERE = /^(c\d\.(edit\(k1,[ab]\)|remove\(k1\)|see|read|redraw)|remote\.edit\(k2,a\))/;
/** Two people on one field and its neighbour. */
const TWO = /^c\d\.(edit\(k1,[ab]\)|save|deliver|see|read|redraw|settle\(draft\))/;

for (const shape of ["fields", "whole"] as const) {
    describe(`the editing core, drafting ${shape === "fields" ? "a field at a time" : "a row whole"}`, () => {
        it("one person: every ordering of gestures, Undo, Redo, Discard, Save and what becomes of its request", async () => {
            const found = await explore({ shape, remotes: 0 }, 4 + DEEPER, (op) => OWN.test(op));
            console.info(said(`${shape} own`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 1_500);
            // Alone, nothing moves under a person: no step of theirs goes.
            expect(found.stepsLost).toBe(0);
        }, 600_000);

        it("another session's writes: every ordering of them with a person's gestures, Saves, reads and choices", async () => {
            const found = await explore({ shape, remotes: 2 }, 5 + DEEPER, (op) => BESIDE.test(op));
            console.info(said(`${shape} beside`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
        }, 600_000);

        it("rows added and removed on both sides: every ordering", async () => {
            const found = await explore({ shape, remotes: 2 }, 5 + DEEPER, (op) => ROWS.test(op));
            console.info(said(`${shape} rows`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 4_000);
        }, 600_000);

        it("a row removed here that another session changes: every ordering of the removal, its Save and the choice it asks", async () => {
            const found = await explore({ shape, remotes: 2 }, 5 + DEEPER, (op) => REMOVED_HERE.test(op));
            console.info(said(`${shape} removed here`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 1_500);
        }, 600_000);

        it("a key removed and added again, and a row added then changed or removed, on either side: every ordering", async () => {
            const found = await explore({ shape, remotes: 2 }, 5 + DEEPER, (op) => ADDED.test(op));
            console.info(said(`${shape} added`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
        }, 600_000);

        it("several rows and several conflicts: reads landing a row at a time, and choices made one at a time", async () => {
            const found = await explore({ shape, remotes: 3 }, 5 + DEEPER, (op) => SEVERAL.test(op));
            console.info(said(`${shape} several`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
        }, 600_000);

        it("an automatic Save: every ordering of it with gestures, an optimiser's result, Undo, Redo and a person's Save", async () => {
            const found = await explore({ shape, remotes: 0 }, 5 + DEEPER, (op) => AUTOMATIC.test(op));
            console.info(said(`${shape} automatic`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
            expect(found.stepsLost).toBe(0);
        }, 600_000);

        it("a page reloaded with its drafts kept: every ordering of it with gestures, Saves, their answers and another session's write", async () => {
            const found = await explore({ shape, remotes: 1 }, 5 + DEEPER, (op) => RELOADED.test(op));
            console.info(said(`${shape} reloaded`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
        }, 600_000);

        it("a Save prepared before it is sent: every ordering of its preparation, done or failing, with gestures, an automatic Save and another session's write", async () => {
            const found = await explore({ shape, remotes: 1, prepares: true }, 5 + DEEPER, (op) => PREPARED.test(op));
            console.info(said(`${shape} prepared`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, 600_000);

        it("a source read whole: every ordering of a person's gestures, Saves and choices with another session's writes", async () => {
            const found = await explore({ shape, remotes: 2, inline: true }, 5 + DEEPER, (op) => INLINE.test(op));
            console.info(said(`${shape} inline`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, 600_000);

        it("two people over a source read whole: every ordering of their gestures and Saves, a row one adds and the other removes among them", async () => {
            const found = await explore({ shape, clients: 2, remotes: 0, inline: true }, 6 + DEEPER, (op) => INLINE_TWO.test(op));
            console.info(said(`${shape} inline two`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, 600_000);

        it("a source read whole whose host cannot say what it read: every ordering of a person's gestures, Saves and choices with another session's writes, and two people's", async () => {
            // A collection of the page's own, which no runtime reads for it: its session reads a Save back by what the
            // collection's entries show. Every other family read whole has a host that says, as e3's record runtime does.
            const found = await explore({ shape, remotes: 2, inline: true, says: false }, 5 + DEEPER, (op) => INLINE.test(op));
            console.info(said(`${shape} inline, its host silent`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
            const two = await explore({ shape, clients: 2, remotes: 0, inline: true, says: false }, 6 + DEEPER, (op) => INLINE_TWO.test(op));
            console.info(said(`${shape} inline two, its host silent`, two));
            expect(two.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, 600_000);

        it("a Save's answer that comes late: every ordering of the record taking the Save, another session's writes, the page hearing of them, and the answer", async () => {
            // Eight operations reach it: an edit, its Save, the record taking it, another session's write, the page
            // hearing of that and drawing it, the answer, and the page drawn again.
            const found = await explore({ shape, remotes: 2 }, 8 + DEEPER, (op) => LATE.test(op));
            console.info(said(`${shape} late`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 5_000);
            // The answer names the revision the Save committed, which the page may have passed: it is never put back there.
            expect(found.lateAnswer).toBe(0);
        }, 600_000);

        it("a field's change taken back by hand while its conflict waits: every ordering of it with the choices, Undo and the Saves around it", async () => {
            const found = await explore({ shape, remotes: 1, flips: true }, 8 + DEEPER, (op) => BACK_FIELD.test(op));
            console.info(said(`${shape} taken back, a field`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 1);
        }, 600_000);

        it("a row's change taken back by hand while its conflict waits: every ordering of a new row removed again, a removed row put back and a changed row typed back", async () => {
            const found = await explore({ shape, remotes: 1, flips: true }, 7 + DEEPER, (op) => BACK_ROWS.test(op));
            console.info(said(`${shape} taken back, a row`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 1);
        }, 600_000);

        it("another session's writes of another row, while changes wait here: every ordering of them with a person's gestures — and no step of theirs goes", async () => {
            const found = await explore({ shape, remotes: 2 }, 7 + DEEPER, (op) => ELSEWHERE.test(op));
            console.info(said(`${shape} elsewhere`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 500);
            // The source moves under the drafts, and holds each row the session knows as its edits began: its history
            // stands. (With nothing waiting — every change saved, or taken back — a source that moves starts the history
            // over still: counted in the families above, and still to close.)
            expect(found.stepsLost).toBe(0);
        }, 600_000);

        it("two people: every ordering of their gestures, Saves, reads and choices on one row", async () => {
            const found = await explore({ shape, clients: 2, remotes: 0 }, 6 + DEEPER, (op) => TWO.test(op));
            console.info(said(`${shape} two`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 5_000);
        }, 600_000);

        it("a record that has forgotten a request sent again: every ordering of a Save with no answer, another session's writes and Retry, the page reloaded among them", async () => {
            // What a record is to a request sixteen others have followed: sent again, the request is checked afresh, and
            // one that had landed is refused over what its own first sending wrote. The session judges it by evidence.
            const beside = await explore({ shape, remotes: 2, remembers: 0 }, 5 + DEEPER, (op) => BESIDE.test(op));
            console.info(said(`${shape} beside, forgotten`, beside));
            expect(beside.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
            const removed = await explore({ shape, remotes: 2, remembers: 0 }, 5 + DEEPER, (op) => REMOVED_HERE.test(op));
            console.info(said(`${shape} removed here, forgotten`, removed));
            expect(removed.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 1_500);
            const reloaded = await explore({ shape, remotes: 1, remembers: 0 }, 5 + DEEPER, (op) => RELOADED.test(op));
            console.info(said(`${shape} reloaded, forgotten`, reloaded));
            expect(reloaded.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 2_500);
        }, 600_000);

        it("random runs past that depth, each from its seed", async () => {
            let lost = 0, waited = 0;
            for (let seed = 1; seed <= 1_000 * RUNS; seed++) {
                // A third of them with each Save prepared first, a quarter over a source read whole — half of those with a
                // host that cannot say what it read — and a fifth over a record that has forgotten every request sent again.
                const world = await wander({
                    shape, clients: 1 + (seed % 2), remotes: 3, prepares: seed % 3 === 0, inline: seed % 4 === 1, says: seed % 8 !== 5,
                    ...(seed % 5 === 2 && { remembers: 0 }),
                }, seed, 40);
                if (world.stepsLost > 0) lost++;
                if (world.waitedForGood > 0) waited++;
            }
            console.info(`[editing model] ${shape} random: ${1_000 * RUNS} runs; steps lost in ${lost}; a Save read whole waited for good in ${waited}`);
        }, 600_000);
    });
}

describe("what the harness found, each replayed", () => {
    for (const shape of ["fields", "whole"] as const) {
        it(`a Save refused after its every draft was taken back says nothing, and stops no later Save (${shape})`, async () => {
            // The request is on its way as its edit is undone; another session's write then refuses it.
            const world = await worldAfter({ shape }, ["c0.edit(k1,a)", "c0.save", "c0.undo", "remote.edit(k1,a)", "c0.deliver"]);
            const { session } = world.clients[0]!;
            expect([session.status, session.issues, session.pending]).toEqual(["idle", [], 0]);
            await world.rest();
        });

        it(`a refusal whose drafts are taken back while they are carried over is said no more once the source is read (${shape})`, async () => {
            // Refused; the source's new revision heard of, its rows still read; Undo meanwhile leaves nothing to carry.
            const world = await worldAfter({ shape }, ["c0.edit(k1,a)", "c0.save", "remote.edit(k1,a)", "c0.deliver", "c0.see", "c0.undo", "c0.read"]);
            const { session } = world.clients[0]!;
            expect([session.status, session.issues, session.pending]).toEqual(["idle", [], 0]);
            await world.rest();
        });

        it(`the other side taken of a row both sessions added leaves nothing to save (${shape})`, async () => {
            const world = await worldAfter({ shape }, ["c0.add(k3)", "remote.add(k3)", "c0.see", "c0.read", "c0.settle(source)"]);
            const { session } = world.clients[0]!;
            expect([session.pending, session.canApply]).toEqual([0, false]);
            await world.rest();
        });

        it(`Undo past a choice a Save has taken brings no conflict back, and a later change of the source's there is no conflict (${shape})`, async () => {
            const world = await worldAfter({ shape }, [
                // A conflict, chosen for the draft, saved and read back.
                "c0.edit(k1,a)", "remote.edit(k1,a)", "c0.see", "c0.read", "c0.settle(draft)", "c0.save", "c0.deliver", "c0.read", "c0.redraw",
                // Undo of the choice, a draft elsewhere, and the source's next change of the field.
                "c0.undo", "c0.edit(k2,a)", "remote.edit(k1,a)", "c0.see", "c0.read",
            ]);
            const client = world.clients[0]!;
            expect([client.session.unsettled, client.session.entries.has("k1")]).toEqual([0, false]);
            await world.rest();
        });

        it(`a conflict left by hand — the row removed, as the source removed it — is no conflict when the source adds the row again (${shape})`, async () => {
            const world = await worldAfter({ shape }, [
                "c0.edit(k1,a)", "remote.remove(k1)", "c0.see", "c0.read",
                // No choice made: the row removed by hand, a draft elsewhere, and another session's new row under the key.
                "c0.remove(k1)", "c0.edit(k2,a)", "remote.add(k1)", "c0.see", "c0.read",
            ]);
            const client = world.clients[0]!;
            expect([client.session.unsettled, client.session.entries.has("k1")]).toEqual([0, false]);
            await world.rest();
        });

        it(`a Save read back after another session put its row back as it was is acknowledged, never waited on for good (${shape})`, async () => {
            const world = await worldAfter({ shape, clients: 2, remotes: 0 }, [
                // A row added and saved, the answer lost; the other session removes the row.
                "c1.add(k3)", "c1.save", "c1.deliverUnanswered", "c0.see", "c0.redraw", "c0.remove(k3)", "c0.save", "c0.deliver",
                // Asked again, the record answers the request it remembers at the revision it is at now, where the row is
                // gone again: read there, the Save is acknowledged with the row as the other session left it.
                "c1.retry", "c1.deliver", "c1.read",
            ]);
            const { session } = world.clients[1]!;
            expect([session.status, session.locked, session.pending]).toEqual(["idle", false, 0]);
            // Saved once: the row the other session removed is not added again.
            expect([world.record.applied, world.record.now.has("k3")]).toEqual([2, false]);
            await world.rest();
            expect(world.record.now.has("k3")).toBe(false);
        });

        it(`over a record that has forgotten the request, the same Save sent again is applied again, and read back at the revision it committed, then the one after (${shape})`, async () => {
            const world = await worldAfter({ shape, clients: 2, remotes: 0, remembers: 0 }, [
                "c1.add(k3)", "c1.save", "c1.deliverUnanswered", "c0.see", "c0.redraw", "c0.remove(k3)", "c0.save", "c0.deliver",
                "c1.retry", "c1.deliver", "c1.see", "c1.read",
            ]);
            const { session } = world.clients[1]!;
            expect([session.status, session.locked, session.pending]).toEqual(["idle", false, 0]);
            await world.rest();
        });
    }
});

describe("what the harness found of a page reloaded", () => {
    for (const shape of ["fields", "whole"] as const) {
        it(`Discard pressed as a reloaded page's kept drafts are still read leaves no row as the page before held it (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 0 }, [
                // A row added and saved: landed, its read back still to come as the page reloads with the draft kept.
                "c0.add(k3)", "c0.save", "c0.deliver", "c0.reload",
                // Discard before the kept draft is read at the page's revision.
                "c0.discard",
            ]);
            const client = world.clients[0]!;
            expect(client.session.entries.size).toBe(0);
            // The row the Save added is on the page, as the record holds it.
            expect(client.shown("k3")).toEqual(world.record.now.get("k3"));
            await world.rest();
        });

        it(`a Save that landed with no answer, another session's write, then Retry: the record answers the request it remembers, and a change put back by Undo since is still the next Save's (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1 }, ["c0.edit(k1,a)", "c0.save", "c0.undo", "c0.deliverUnanswered", "remote.edit(k2,a)", "c0.retry", "c0.deliver", "c0.read"]);
            const client = world.clients[0]!;
            // Answered, never refused: the Save is read back at the revision the record is at, and the Undo is a change from it.
            expect([client.session.status, client.session.pending, client.session.unsettled, client.shown("k1")?.a, world.record.applied]).toEqual(["idle", 1, 0, 1n, 1]);
            await world.rest();
            expect([world.record.now.get("k1")?.a, world.unansweredAsked]).toEqual([1n, 0]);
        });

        it(`a Save that landed with no answer, another session's write, then Retry: a record that has forgotten the request refuses it, and a change put back by Undo since is still the next Save's (${shape})`, async () => {
            // A record answers a request again only while it remembers it. Forgotten, the same request is checked afresh
            // and refused over what its own first sending wrote. Taken at its word, the refusal had the Undo read as no
            // change at all, and the row stayed as the Save left it.
            const world = await worldAfter({ shape, remotes: 1, remembers: 0 }, ["c0.edit(k1,a)", "c0.save", "c0.undo", "c0.deliverUnanswered", "remote.edit(k2,a)", "c0.retry", "c0.deliver", "c0.see", "c0.read"]);
            const client = world.clients[0]!;
            expect([client.session.pending, client.session.unsettled, client.shown("k1")?.a]).toEqual([1, 0, 1n]);
            await world.rest();
            expect([world.record.now.get("k1")?.a, world.unansweredAsked]).toEqual([1n, 0]);
        });

        it(`after such a refusal, a change of another row saved before the page hears of the other session's write does not make the first request forgotten: what Undo put back is still the next Save's (${shape})`, async () => {
            // The second Save lands — e3 checks a row's change against that row alone — and says nothing of whether the
            // first had: its rows are still to be judged by what the record holds.
            const world = await worldAfter({ shape, remotes: 1, remembers: 0 }, [
                "c0.edit(k1,a)", "c0.save", "c0.undo", "c0.deliverUnanswered", "remote.edit(k2,a)", "c0.retry", "c0.deliver",
                "c0.edit(k2,b)", "c0.save", "c0.deliver", "c0.see", "c0.read", "c0.read",
            ]);
            const client = world.clients[0]!;
            expect([client.session.pending, client.session.unsettled, client.shown("k1")?.a]).toEqual([1, 0, 1n]);
            await world.rest();
            expect(world.record.now.get("k1")?.a).toBe(1n);
        });

        it(`the page reloaded while a Save has no answer, the record having taken it: the request is sent again as the page loads, and a change put back by Undo since is still the next Save's (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 0 }, ["c0.edit(k1,a)", "c0.save", "c0.undo", "c0.deliverUnanswered", "c0.reload", "c0.see", "c0.deliver", "c0.read"]);
            const client = world.clients[0]!;
            expect([client.session.pending, client.session.unsettled, client.shown("k1")?.a]).toEqual([1, 0, 1n]);
            await world.rest();
            expect([world.record.now.get("k1")?.a, world.unansweredAsked]).toEqual([1n, 0]);
        });

        it(`the page reloaded while a Save is on its way, the record never having heard of it: the page sends it, and the change is saved once (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 0 }, ["c0.edit(k1,a)", "c0.save", "c0.reload", "c0.see", "c0.deliver", "c0.read"]);
            const client = world.clients[0]!;
            expect([client.session.pending, client.session.status, world.record.commits.length]).toEqual([0, "idle", 1]);
            await world.rest();
        });

        it(`a change that landed with no answer and was then written over at the same part by another session is no conflict on Retry: the record answers the request it remembers, and the row is the other session's (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1 }, ["c0.edit(k1,a)", "c0.save", "c0.deliverUnanswered", "remote.edit(k1,a)", "c0.retry", "c0.deliver", "c0.read"]);
            const client = world.clients[0]!;
            expect([client.session.status, client.session.unsettled, client.session.pending, client.shown("k1")?.a, world.unansweredAsked]).toEqual(["idle", 0, 0, 900n, 0]);
            await world.rest();
            expect(world.record.now.get("k1")?.a).toBe(900n);
        });

        it(`over a record that has forgotten the request, such a change is asked of, on Retry: nothing the record holds tells it from a Save another write got ahead of (${shape})`, async () => {
            // Counted, never excused in general: only the record's own word on the request closes it, and it has none left.
            const world = await worldAfter({ shape, remotes: 1, remembers: 0 }, ["c0.edit(k1,a)", "c0.save", "c0.deliverUnanswered", "remote.edit(k1,a)", "c0.retry", "c0.deliver", "c0.see", "c0.read"]);
            const client = world.clients[0]!;
            expect([client.session.unsettled, world.unansweredAsked]).toEqual([1, 1]);
        });

        it(`a Save the source acknowledged is no draft to a page reloaded before its read back: another session's later change of it is no conflict (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1 }, ["c0.edit(k1,a)", "c0.save", "c0.deliver", "c0.reload", "remote.edit(k1,a)", "c0.see", "c0.read"]);
            const client = world.clients[0]!;
            expect([client.session.unsettled, client.session.pending]).toEqual([0, 0]);
            await world.rest();
        });

        it(`Undo of a change whose Save the source has acknowledged is kept through a reload as a change from what that Save left (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 0 }, ["c0.edit(k1,a)", "c0.save", "c0.undo", "c0.deliver", "c0.reload", "c0.read"]);
            const client = world.clients[0]!;
            // The Save wrote the edit; the Undo, kept, is the change still to save.
            expect([client.session.pending, client.shown("k1")?.a]).toEqual([1, 1n]);
            await world.rest();
            expect(world.record.now.get("k1")?.a).toBe(1n);
        });
    }
});

describe("what the harness found of a conflict chosen again", () => {
    for (const shape of ["fields", "whole"] as const) {
        /** A conflict in each of two rows, read and waiting: the person's 100 and 101 against another session's 900 and 901. */
        const rows: readonly ModelOp[] = ["c0.edit(k1,a)", "c0.edit(k2,a)", "remote.edit(k1,a)", "remote.edit(k2,a)", "c0.see", "c0.read"];

        it(`a row removed after the other side was taken of it stays removed when every conflict is kept as drafted (${shape})`, async () => {
            // The other side taken at k1; the row then removed; and k2's conflict, with every other, kept as drafted.
            const world = await worldAfter({ shape }, [...rows, "c0.settle1(source)", "c0.remove(k1)", "c0.settle(draft)"]);
            const client = world.clients[0]!;
            expect([client.shown("k1"), client.shown("k2")?.a, client.session.unsettled]).toEqual([undefined, 101n, 0]);
            await world.rest();
            expect([world.record.now.has("k1"), world.record.now.get("k2")?.a]).toEqual([false, 101n]);
        });
    }

    /** Two conflicts in one row, read and waiting: the person's 100 at `a` and 101 at `b` against another session's 900 and 901. */
    const parts: readonly ModelOp[] = ["c0.edit(k1,a)", "c0.edit(k1,b)", "remote.edit(k1,a)", "remote.edit(k1,b)", "c0.see", "c0.read"];

    it("the other side taken of a part, then the part changed again: keeping the draft keeps the change made since, never the value from before the first choice", async () => {
        const world = await worldAfter({ shape: "fields" }, [...parts, "c0.settle1(source)", "c0.edit(k1,a)", "c0.settle1(draft)"]);
        const client = world.clients[0]!;
        // The edit made since, 102: put back as it stood before the first choice it would be 100.
        expect([client.shown("k1")?.a, client.session.unsettled]).toEqual([102n, 1]);
        await world.rest();
        expect(world.record.now.get("k1")).toEqual({ a: 102n, b: 101n });
    });

    it("the other side taken of a part, then the part changed again: taking the other side again takes it", async () => {
        const world = await worldAfter({ shape: "fields" }, [...parts, "c0.settle1(source)", "c0.edit(k1,a)", "c0.settle1(source)"]);
        const client = world.clients[0]!;
        expect([client.shown("k1")?.a, client.session.unsettled]).toEqual([900n, 1]);
        // Coming to rest keeps every conflict as drafted, the one just chosen for the other side among them: the draft
        // there is put back as it stood before that choice — the change made since, 102.
        await world.rest();
        expect(world.record.now.get("k1")).toEqual({ a: 102n, b: 101n });
    });

    it("a row removed after its draft was kept at a part of it stays removed when the other side is taken of every conflict", async () => {
        const rows: readonly ModelOp[] = ["c0.edit(k1,a)", "c0.edit(k2,a)", "remote.edit(k1,a)", "remote.edit(k2,a)", "c0.see", "c0.read"];
        // The draft kept at k1.a; the row then removed; and the other side taken of k2's conflict, with every other.
        const world = await worldAfter({ shape: "fields" }, [...rows, "c0.settle1(draft)", "c0.remove(k1)", "c0.settle(source)"]);
        const client = world.clients[0]!;
        expect([client.shown("k1"), client.shown("k2")?.a, client.session.unsettled]).toEqual([undefined, 901n, 0]);
        await world.rest();
        expect([world.record.now.has("k1"), world.record.now.get("k2")?.a]).toEqual([false, 901n]);
    });
});

describe("a Save's answer that comes after the page has heard of a later write", () => {
    for (const shape of ["fields", "whole"] as const) {
        // The record takes the Save; another session writes k2; the page hears of that write and draws it; then the
        // Save's answer arrives, naming the revision the Save committed — one the page has passed.
        const late: readonly ModelOp[] = ["c0.edit(k1,a)", "c0.save", "c0.land", "remote.edit(k2,a)", "c0.see", "c0.read", "c0.redraw", "c0.deliver"];

        it(`never puts the page back at the revision the Save committed: the other session's write stays on the screen, and the Save is read back where the page is (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1 }, [...late, "c0.redraw"]);
            const client = world.clients[0]!;
            expect([client.shown("k2")?.a, client.shown("k1")?.a, world.lateAnswer]).toEqual([900n, 100n, 0]);
            await world.rest();
            expect([client.session.status, client.session.pending, world.lateAnswer]).toEqual(["idle", 0, 0]);
        });

        it(`counted, where its host cannot say when it read: the answer puts the page back at the revision the Save committed, the other session's write gone from the screen until the record is read again (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1, says: false }, [...late, "c0.redraw"]);
            expect([world.clients[0]!.shown("k2")?.a, world.lateAnswer]).toEqual([3n, 1]);
            await world.rest();
        });

        it(`is read back as put back where its source moved on in the very turn the answer came, the revision the session asked for never installed, and the other session's write had put the Save's own row back exactly: never left saving (${shape})`, async () => {
            // The other person removes the row the Save added, and the answer arrives as the page is told of the record's
            // state now: the paging layer installs the Save's revision no more, and follows the record. The session, not
            // told, reads at a revision where its row is as it began — put back, once its host says it has read since.
            const world = await worldAfter({ shape, clients: 2, remotes: 0 }, [
                "c0.add(k3)", "c0.save", "c0.land", "c1.see", "c1.read", "c1.redraw", "c1.remove(k3)", "c1.save", "c1.deliver", "c0.deliverPast", "c0.see", "c0.read", "c0.redraw",
            ]);
            const client = world.clients[0]!;
            await world.rest();
            expect([client.session.status, client.session.pending, client.shown("k3"), world.record.now.has("k3"), world.lateAnswer]).toEqual(["idle", 0, undefined, false, 0]);
        });

        it(`is read back as put back, where the other session's write put the Save's own row back exactly: never left saving (${shape})`, async () => {
            // The other session's write is of the very field the Save set, back to what it was — and the page had heard
            // of it before the answer came: the source reads there still once its host has read since the answer.
            const world = await worldAfter({ shape, clients: 2, remotes: 0 }, [
                "c0.add(k3)", "c0.save", "c0.land", "c1.see", "c1.read", "c1.redraw", "c1.remove(k3)", "c1.save", "c1.deliver", "c0.see", "c0.read", "c0.redraw", "c0.deliver",
            ]);
            const client = world.clients[0]!;
            await world.rest();
            expect([client.session.status, client.session.pending, client.shown("k3"), world.record.now.has("k3"), world.lateAnswer]).toEqual(["idle", 0, undefined, false, 0]);
        });
    }
});

describe("a change taken back by hand while its conflict waits makes no choice, and overwrites nothing", () => {
    for (const shape of ["fields", "whole"] as const) {
        for (const inline of [false, true]) {
            // The other session's write heard of, read and drawn: the conflict waits.
            const read = inline ? ["c0.see"] : ["c0.see", "c0.read", "c0.redraw"];
            const where = `${shape}${inline ? ", read whole" : ""}`;

            it(`a field typed back to what both sides began from takes the other side's value: nothing is left to save, and nothing of theirs is written over (${where})`, async () => {
                // Left as typed, the three values read no conflict — the draft as both began — yet the draft differed
                // from the record's: Save was on, and wrote 1 over the other session's 900, which its person had never
                // been asked about.
                const world = await worldAfter({ shape, remotes: 1, inline }, ["c0.edit(k1,a)", "remote.edit(k1,a)", ...read, "c0.revert(k1,a)"]);
                const client = world.clients[0]!;
                expect([client.shown("k1")?.a, client.session.unsettled, client.session.pending, client.session.canApply]).toEqual([900n, 0, 0, false]);
                await world.rest();
                expect(world.record.now.get("k1")).toEqual({ a: 900n, b: 2n });
            });

            it(`a new row both sides added, removed again here, removes nothing of the other side's: their row stands (${where})`, async () => {
                // Left removed, the draft read as a removal of the row under that key — the other session's, which its
                // person had never seen — and Save removed it.
                const world = await worldAfter({ shape, remotes: 1, inline }, ["c0.add(k3)", "remote.add(k3)", ...read, "c0.remove(k3)"]);
                const client = world.clients[0]!;
                expect([client.shown("k3"), client.session.unsettled, client.session.pending]).toEqual([{ a: 900n, b: 901n }, 0, 0]);
                await world.rest();
                expect(world.record.now.get("k3")).toEqual({ a: 900n, b: 901n });
            });

            it(`a row changed here that the other side removed, its change typed back, is gone as they left it; one removed here that they changed, put back as it was, stands as they left it (${where})`, async () => {
                const changed = await worldAfter({ shape, remotes: 1, inline }, ["c0.edit(k1,a)", "remote.remove(k1)", ...read, "c0.revert(k1,a)"]);
                expect([changed.clients[0]!.shown("k1"), changed.clients[0]!.session.pending]).toEqual([undefined, 0]);
                await changed.rest();
                expect(changed.record.now.has("k1")).toBe(false);
                const removed = await worldAfter({ shape, remotes: 1, inline }, ["c0.remove(k1)", "remote.edit(k1,a)", ...read, "c0.restore(k1)"]);
                expect([removed.clients[0]!.shown("k1"), removed.clients[0]!.session.pending]).toEqual([{ a: 900n, b: 2n }, 0]);
                await removed.rest();
                expect(removed.record.now.get("k1")).toEqual({ a: 900n, b: 2n });
            });

            it(`taken back, a change is one step: Undo brings the conflict back as it waited, and settled the other way the value typed is kept, and saved by its person's choice (${where})`, async () => {
                const undone = await worldAfter({ shape, remotes: 1, inline }, ["c0.edit(k1,a)", "remote.edit(k1,a)", ...read, "c0.revert(k1,a)", "c0.undo"]);
                expect([undone.clients[0]!.shown("k1")?.a, undone.clients[0]!.session.unsettled]).toEqual([100n, 1]);
                await undone.rest();
                const kept = await worldAfter({ shape, remotes: 1, inline, flips: true }, ["c0.edit(k1,a)", "remote.edit(k1,a)", ...read, "c0.revert(k1,a)", "c0.settle(draft)"]);
                expect([kept.clients[0]!.shown("k1")?.a, kept.clients[0]!.session.unsettled, kept.clients[0]!.session.canApply]).toEqual([1n, 0, true]);
                await kept.rest();
                expect(kept.record.now.get("k1")).toEqual({ a: 1n, b: 2n });
            });
        }
    }
});

describe("what the harness found of a choice made while a Save was out, each replayed", () => {
    for (const shape of ["fields", "whole"] as const) {
        it(`a conflict chosen after a Save was sent is still a choice the drafts before it wait on, once that Save is read back: no automatic Save sends the row as it stood before the choice, behind an optimiser's result (${shape})`, async () => {
            // The row changed here and removed there; their removal taken, the row added again and saved by itself.
            // While that Save is out, Undo goes back past the choice — the conflict waits again — an optimiser's result
            // lands on the row, and the conflict is chosen again. The Save, read back, took none of those steps: the
            // session forgot every step's choice with it, and an automatic Save then offered to send the row as it
            // stood before the result — in a conflict nobody had chosen.
            const world = await worldAfter({ shape, remotes: 1, inline: true }, [
                "c0.edit(k1,b)", "remote.remove(k1)", "c0.see", "c0.settle(source)", "c0.add(k1)", "c0.autosave",
                "c0.undo", "c0.undo", "c0.optimise(k1,a)", "c0.settle(draft)", "c0.deliver", "c0.see",
            ]);
            const { session } = world.clients[0]!;
            expect([session.status, session.unsettled, session.autosaveHeld, session.canAutosave]).toEqual(["idle", 0, true, false]);
            // A person's Save takes it all.
            expect(session.canApply).toBe(true);
            await world.rest();
        });
    }
});

describe("what the harness's own checks got wrong, each replayed", () => {
    for (const shape of ["fields", "whole"] as const) {
        it(`a row another session added and removed again, while a page still showed none, is no step back when the page first draws it: a shown value is one of the writes its source has read, or of its own Saves (${shape})`, async () => {
            // The record: k3 added (1), removed (2), c1's own Save (3), k3 added again (4). c1's source has read as far
            // as the first; its page, drawn late, showed no k3 until then. Read with c1's own Save for a bound, "no k3"
            // was the removal — a write its source never read — and the row's first drawing a step back from it.
            const world = await worldAfter({ shape, clients: 2, remotes: 3 }, [
                "remote.add(k3)", "c1.remove(k1)", "c1.save", "c1.see", "remote.remove(k3)", "c1.deliverUnanswered", "remote.add(k3)", "c1.undo", "c1.retry",
                "c1.edit(k2,a)", "c1.edit(k1,b)", "c1.redraw",
            ]);
            expect(world.clients[1]!.shown("k3")?.a).toBe(900n);
            await world.rest();
        });

        it(`a row its person adds and removes again, over a removal their unanswered Save made and a page reload kept, is no change of theirs — whatever another session has written under the key since (${shape})`, async () => {
            // The removal of k1 landed with no answer and is asked again; the page reloads, keeping it; another session
            // adds a row of its own under k1; the page reloads again. What the person then puts k1 at is still a change
            // from what their own Save wrote — no row — until the session reads that Save back: the check forgot the
            // Save's write once the record's last write there was another's, and took a row added and removed again
            // for a removal of the other session's row, which the session rightly never made.
            const world = await worldAfter({ shape, remotes: 1 }, [
                "c0.remove(k1)", "c0.save", "c0.deliverUnanswered", "c0.retry", "c0.reload", "remote.add(k1)", "c0.reload",
                "c0.add(k1)", "c0.deliver", "c0.remove(k1)", "c0.read",
            ]);
            const client = world.clients[0]!;
            // Read back: the row is the other session's, and nothing of k1 is left to save.
            expect([client.session.entries.has("k1"), client.shown("k1")?.a]).toEqual([false, 900n]);
            await world.rest();
            expect(world.record.now.get("k1")?.a).toBe(900n);
        });

        it(`a value typed back while its conflict waits, on a page then reloaded, is its person's still while the kept drafts are read where the record is — what a draft was kept beside says nothing of the record (${shape})`, async () => {
            // An automatic Save of k1.a is out as another session removes k1; its person removes the row, the page reloads,
            // and the Save is refused. They add k1 again — a conflict with the removal, over the row the Save sent — type
            // a back to what that row held, and the page reloads once more. The session restores the draft beside the row
            // the conflict stood on, still to be read at the record's revision: the check took that row for what the record
            // holds, found the value typed back in it, and called the value lost — the record holding no k1 — though the
            // session had still to judge it. (Found by a random run at the proof depth, seed 6867, 12 Nov 2026.)
            const world = await worldAfter({ shape, remotes: 1 }, [
                "c0.edit(k1,a)", "c0.autosave", "remote.remove(k1)", "c0.remove(k1)", "c0.reload", "c0.deliver", "c0.add(k1)", "c0.read", "c0.revert(k1,a)", "c0.reload",
            ]);
            const client = world.clients[0]!;
            // Restored, and still to be carried over: the row as typed back, a draft.
            expect([client.session.carrying, client.session.pending, client.shown("k1")?.a]).toEqual([true, 1, 100n]);
            // Read where the record is — it holds no k1 — the row is one the draft adds, the removal a conflict to choose.
            await world.run("c0.read");
            expect([client.session.carrying, client.session.unsettled, client.session.originals.get("k1")?.draft]).toEqual([false, 1, undefined]);
            // Kept, it is saved as typed back.
            await world.rest();
            expect(world.record.now.get("k1")?.a).toBe(100n);
        });
    }
});

describe("what the harness found of a source read whole", () => {
    for (const shape of ["fields", "whole"] as const) {
        it(`a Save another session's write overtook on the same part, before the record was read again, is read back with the newer value — never waited on for good (${shape})`, async () => {
            const world = await worldAfter({ shape, inline: true }, ["c0.edit(k1,a)", "c0.save", "c0.deliver", "remote.edit(k1,a)", "c0.see"]);
            const client = world.clients[0]!;
            expect([client.session.status, client.session.locked, client.session.pending, client.shown("k1")?.a]).toEqual(["idle", false, 0, 900n]);
            await world.rest();
        });

        it(`a Save whose row another session removed before the record was read again is read back as the record holds it (${shape})`, async () => {
            const world = await worldAfter({ shape, inline: true }, ["c0.edit(k1,a)", "c0.save", "c0.deliver", "remote.remove(k1)", "c0.see"]);
            const client = world.clients[0]!;
            expect([client.session.status, client.session.locked, client.session.pending, client.shown("k1")]).toEqual(["idle", false, 0, undefined]);
            await world.rest();
        });

        it(`a draft made while a Save was read back, from a row another session has since changed, is a conflict to choose once the Save is read back — never a Save refused with nothing to choose (${shape})`, async () => {
            // c1 adds a row and saves; while that is out it changes k1.a, which c0's Save has changed meanwhile.
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true }, [
                "c0.edit(k1,a)", "c0.save", "c1.add(k3)", "c1.save", "c1.edit(k1,a)", "c0.deliver", "c1.deliver", "c1.see",
            ]);
            const { session } = world.clients[1]!;
            expect([session.status, session.pending, session.unsettled]).toEqual(["idle", 1, 1]);
            await world.rest();
        });

        // Both fields of k1 changed and saved; the request is lost and sent again, another session changing k1.a
        // meanwhile, so it is refused. The change of a is taken back by Undo and the rest saved; Redo puts it back while
        // that Save is out. Read back, the record holds the other session's a: Redo's change and theirs both began from
        // the value the Save sent — a conflict to choose. But the request refused before was still to be judged, and
        // judged k1 from the row as the session held it by then — the other session's — which left Redo's change a
        // plain one, and the next Save wrote it over theirs with nothing asked. (Found by the every-state walk of a
        // source read whole at its proof budget, 12 Nov 2026.)
        const redone: readonly ModelOp[] = ["c0.edit(k1,b)", "c0.edit(k1,a)", "c0.save", "c0.lose", "c0.retry", "remote.edit(k1,a)", "c0.deliver", "c0.undo", "c0.save", "c0.redo", "c0.deliver", "c0.see"];

        it(`a change Redo puts back while a later Save of its row is out, over a request with no answer that was refused when sent again, is a conflict to choose where another session changed the same part — never written over theirs unasked (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1, inline: true }, redone);
            const { session } = world.clients[0]!;
            expect([session.status, session.pending, session.unsettled, session.canApply]).toEqual(["idle", 1, 1, false]);
            // Chosen for the draft, with theirs shown on its card, it is saved.
            await world.rest();
            expect(world.record.now.get("k1")).toEqual({ a: 101n, b: 100n });
        });

        it(`the same over a source read a revision at a time (${shape})`, async () => {
            const world = await worldAfter({ shape, remotes: 1 }, [...redone, "c0.read"]);
            const { session } = world.clients[0]!;
            expect([session.status, session.pending, session.unsettled, session.canApply]).toEqual(["idle", 1, 1, false]);
            await world.rest();
            expect(world.record.now.get("k1")).toEqual({ a: 101n, b: 100n });
        });

        // c0 adds a row and saves; c1 removes it before c0's page reads the record again: the record reads as it did
        // before c0's Save, which nothing a collection holds tells from one read before the Save landed.
        const putBack: readonly ModelOp[] = ["c0.add(k3)", "c0.save", "c0.deliver", "c1.see", "c1.remove(k3)", "c1.save", "c1.deliver"];

        it(`a Save whose every part another session put back exactly, before the record was read again, is read back once its host has read the record since the Save was answered — the row gone, as the record holds it (${shape})`, async () => {
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true }, putBack);
            const client = world.clients[0]!;
            // Answered, and not yet read since: the collection it holds is from before the Save, and it waits.
            expect([client.session.status, client.session.locked, client.awaitsRead]).toEqual(["reconciling", true, true]);
            await world.run("c0.see");
            expect([client.session.status, client.session.locked, client.session.pending, client.shown("k3")]).toEqual(["idle", false, 0, undefined]);
            await world.rest();
            expect(world.waitedForGood).toBe(0);
        });

        it(`a Save answered again by the record that remembers it, every part put back since, is read back by the read its host makes after that answer — at the revision it had read already (${shape})`, async () => {
            // The answer lost; c1 removes the row; c0's page reads the record, then asks again: the record answers at
            // the revision it is at, which the page has read — before the answer, so it says nothing of the Save yet.
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true }, [
                "c0.add(k3)", "c0.save", "c0.deliverUnanswered", "c1.see", "c1.remove(k3)", "c1.save", "c1.deliver", "c0.see", "c0.retry", "c0.deliver",
            ]);
            const client = world.clients[0]!;
            expect([client.session.status, client.awaitsRead, world.enabled().includes("c0.see")]).toEqual(["reconciling", true, true]);
            await world.run("c0.see");
            expect([client.session.status, client.session.locked, client.session.pending, client.shown("k3")]).toEqual(["idle", false, 0, undefined]);
            await world.rest();
            expect([world.waitedForGood, world.record.now.has("k3")]).toEqual([0, false]);
        });

        // c1 adds a row under the key c0's row, since removed, still stands under in the collection c1's page holds.
        const underTheirs: readonly ModelOp[] = ["c0.add(k3)", "c0.save", "c0.remove(k3)", "c0.deliver", "c1.add(k3)", "c1.save", "c1.deliverUnanswered", "c0.see", "c0.save", "c1.see", "c1.retry", "c0.deliver", "c0.see"];

        it(`a Save that lands over a key another session's row stood under, in the collection its page still holds, is read back at the collection its host reads after the answer — the row as it saved it, its screen never showing the other session's (${shape})`, async () => {
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true }, [...underTheirs, "c1.deliver"]);
            const client = world.clients[1]!;
            // Answered, and its page holds the collection from before: the other session's row under its key. It waits.
            expect([client.session.status, client.awaitsRead, client.shown("k3")?.a]).toEqual(["reconciling", true, 200n]);
            await world.rest();
            expect([world.readEarly, world.record.now.get("k3")?.a]).toEqual([0, 200n]);
        });

        it(`counted, where its host cannot say what it read: such a Save is taken as read back at the collection from before it, and its screen shows the other session's row until the record is read again (${shape})`, async () => {
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true, says: false }, [...underTheirs, "c1.deliver"]);
            await world.rest();
            expect(world.readEarly).toBeGreaterThan(0);
        });

        it(`counted, where its host cannot say what it read: such a Save waits to be read back until the page is reloaded (${shape})`, async () => {
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true, says: false }, [...putBack, "c0.see"]);
            const { session } = world.clients[0]!;
            expect([session.status, session.locked]).toEqual(["reconciling", true]);
            // The world reloads the page, as its person would, and comes to rest.
            await world.rest();
            expect(world.waitedForGood).toBe(1);
        });

        it(`a change made while such a Save was read back is kept, merged over the newer value (${shape})`, async () => {
            // k1.a saved at 100; another session's 900 lands before the record is read; meanwhile k1.b is changed here.
            const world = await worldAfter({ shape, inline: true }, ["c0.edit(k1,a)", "c0.save", "c0.deliver", "remote.edit(k1,a)", "c0.edit(k1,b)", "c0.see"]);
            const client = world.clients[0]!;
            expect([client.session.status, client.session.locked, client.shown("k1")?.b]).toEqual(["idle", false, 101n]);
            await world.rest();
            expect(world.record.now.get("k1")?.b).toBe(101n);
        });
    }
});

describe("the exploration itself", () => {
    it("runs operations of different actors in one order only, unless each reads or writes the record", () => {
        expect(independent("c0.edit(k1,a)", "remote.edit(k1,a)")).toBe(true);
        expect(independent("c0.redraw", "c1.deliver")).toBe(true);
        expect(independent("c0.edit(k1,a)", "c0.undo")).toBe(false);
        expect(independent("c0.deliver", "remote.edit(k1,a)")).toBe(false);
        expect(independent("c0.see", "c1.deliver")).toBe(false);
    });
});
