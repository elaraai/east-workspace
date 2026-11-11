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
    /** In how many of them a reload lost a change made while a Save was unresolved. */
    reloadLost: number;
    /** In how many of them a reload made a change already saved a conflict to choose. */
    reloadAsked: number;
    /** In how many of them a Save over a source read whole waited for good to be read back: every part it wrote put back since, exactly. */
    waitedForGood: number;
    /** In how many of them a Save's late answer stepped a screen back to the revision the Save committed. */
    lateAnswer: number;
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
    const found: Explored = { worlds: 0, stepsLost: 0, reloadLost: 0, reloadAsked: 0, waitedForGood: 0, lateAnswer: 0 };
    found.worlds = await everyOrdering((ops) => worldAfter(options, ops), depth, allow, independent, (world) => {
        if (world.stepsLost > 0) found.stepsLost++;
        if (world.reloadLost > 0) found.reloadLost++;
        if (world.reloadAsked > 0) found.reloadAsked++;
        if (world.waitedForGood > 0) found.waitedForGood++;
        if (world.lateAnswer > 0) found.lateAnswer++;
    });
    return found;
}

/** What an exploration covered, in a line. */
function said(name: string, found: Explored): string {
    const waited = `${found.waitedForGood === 0 ? "" : `; a Save read whole waited for good in ${found.waitedForGood}`}${found.lateAnswer === 0 ? "" : `; a late answer stepped a screen back in ${found.lateAnswer}`}`;
    return `[editing model] ${name}: ${found.worlds} orderings; steps lost in ${found.stepsLost}; a reload lost a change in ${found.reloadLost}, and asked of a saved one in ${found.reloadAsked}${waited}`;
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

        it("two people: every ordering of their gestures, Saves, reads and choices on one row", async () => {
            const found = await explore({ shape, clients: 2, remotes: 0 }, 6 + DEEPER, (op) => TWO.test(op));
            console.info(said(`${shape} two`, found));
            expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 5_000);
        }, 600_000);

        it("random runs past that depth, each from its seed", async () => {
            let lost = 0, waited = 0;
            for (let seed = 1; seed <= 1_000 * RUNS; seed++) {
                // A third of them with each Save prepared first, and a quarter over a source read whole.
                const world = await wander({ shape, clients: 1 + (seed % 2), remotes: 3, prepares: seed % 3 === 0, inline: seed % 4 === 1 }, seed, 40);
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
                // Asked again and answered: its source reads at the revision it committed, then at the one after.
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
            expect([client.session.pending, client.shown("k1")?.a, world.reloadLost]).toEqual([1, 1n, 0]);
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

        it(`counted, not yet held: a Save whose every part another session put back exactly, before the record was read again, waits to be read back until the page is reloaded (${shape})`, async () => {
            // c0 adds a row and saves; c1 removes it before c0's page reads the record again: the record reads as it did
            // before c0's Save, which nothing a collection holds tells from one read before the Save landed.
            const world = await worldAfter({ shape, clients: 2, remotes: 0, inline: true }, [
                "c0.add(k3)", "c0.save", "c0.deliver", "c1.see", "c1.remove(k3)", "c1.save", "c1.deliver", "c0.see",
            ]);
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
