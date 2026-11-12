/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's key, the session's to make (#1583), held to what it promises
 * over orderings and states rather than examples: sessions that each make
 * their new rows' keys by one rule, beside another session that saves rows of
 * its own under the very keys that rule makes (`keys-world.test-utils.ts` says
 * what a keys world is, what its operations are and what must hold after
 * each) — a key made is free; no row is saved over another's, and none twice;
 * a new row is no conflict; a row is followed under its new key; and at rest
 * every row made and kept is in the record once.
 *
 * - **Replays**: each fault the model found, by name, proved to fail over the
 *   code as it stood.
 * - **Every ordering to a depth**, from a fresh world each, and seeded random
 *   runs past it (`EDITING_MODEL_DEPTH`, `EDITING_MODEL_RUNS`, as
 *   `session-model.test.ts`).
 * - **Every state** a budgeted world can reach (`EDITING_MODEL_STATES`, as
 *   `states-model.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { everyOrdering, everyState, seeded, type StatesWalked } from "./explore.test-utils.js";
import { KeysWorld, keysIndependent, keysWorldAfter, type KeysOp, type KeysOptions } from "./keys-world.test-utils.js";

const DEEPER = Number(process.env["EDITING_MODEL_DEPTH"] ?? 0);
const RUNS = Number(process.env["EDITING_MODEL_RUNS"] ?? 1);
/** Whether this is a proof run of every state: each family at its larger budgets. */
const PROOF = Number(process.env["EDITING_MODEL_STATES"] ?? 0) > 0;
/** The most states a walk meets before it gives up saying it met them all. */
const LIMIT = 2_000_000;

/** What an exploration covered. */
interface Explored {
    /** How many orderings it ran, each from a fresh world, and brought to rest. */
    worlds: number;
    /** In how many of them a session gave a new row another key. */
    remade: number;
    /** In how many of them a page was reloaded while a Save's outcome was not known. */
    unsure: number;
    /** In how many of them a session's steps went under its person. */
    stepsLost: number;
    /** In how many of them a person was asked to choose, no page having been reloaded with a Save unresolved. */
    asked: number;
}

/**
 * Runs every ordering of a keys world's operations to a depth.
 *
 * @param options - What each world is made of
 * @param depth - How many operations an ordering holds at most
 * @param allow - Which operations it explores
 * @returns What it covered
 * @throws {ModelFault} The first fault, with the operations that led to it
 */
async function explore(options: KeysOptions, depth: number, allow: RegExp): Promise<Explored> {
    const found: Explored = { worlds: 0, remade: 0, unsure: 0, stepsLost: 0, asked: 0 };
    found.worlds = await everyOrdering((ops) => keysWorldAfter(options, ops), depth, (op) => allow.test(op), keysIndependent, (world) => {
        if (world.remade > 0) found.remade++;
        if (world.unsure) found.unsure++;
        if (world.stepsLost > 0) found.stepsLost++;
        if (world.asked > 0) found.asked++;
    });
    return found;
}

/** What an exploration covered, in a line. */
function said(name: string, found: Explored): string {
    return `[editing model] ${name}: ${found.worlds} orderings; a new row given another key in ${found.remade}; a person asked to choose in ${found.asked}; a page reloaded with a Save unresolved in ${found.unsure}; steps lost in ${found.stepsLost}`;
}

/** What a walk of every state covered, in a line. */
function walkedSaid(name: string, walked: StatesWalked): string {
    return `[editing model] ${name}: ${walked.states} states, ${walked.transitions} operations run from them, the furthest ${walked.depth} operations away`;
}

/** Every state a keys world can reach. */
async function states(options: KeysOptions, allow: RegExp): Promise<StatesWalked> {
    return everyState((ops) => keysWorldAfter(options, ops), (world) => world.print(), (op) => allow.test(op), () => undefined, LIMIT);
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
async function wander(options: KeysOptions, seed: number, length: number): Promise<KeysWorld> {
    const random = seeded(seed);
    const world = new KeysWorld(options);
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

/** A world with some operations run in it, brought to rest. */
async function rested(options: KeysOptions, ops: readonly KeysOp[]): Promise<KeysWorld> {
    const world = await keysWorldAfter(options, ops);
    await world.rest();
    return world;
}

/** The record's keys, in order. */
const keysOf = (world: KeysWorld): string[] => [...world.record.now.keys()];

/** A person's rows, another session's rows under the same keys, and every way their reads and Saves can meet. */
const BESIDE = /^(c\d\.(make|edit|remove|undo|redo|save|deliver|see|read|redraw)|remote\.add)$/;
/** Another session's rows out of view, under the keys a person's rule makes: each found taken only as a Save is refused. */
const UNSEEN = /^(c\d\.(make|edit|save|deliver|see|read|redraw)|remote\.addUnseen)$/;
/** The same with every way a request can go: its answer lost, the request lost, asked again. */
const ANSWERS = /^(c\d\.(make|edit|save|deliver|deliverUnanswered|lose|retry|see|read|redraw)|remote\.add)$/;
/** Two people who each make rows by the one rule. */
const TWO = /^c\d\.(make|edit|save|deliver|see|read|redraw)$/;
/** The page reloaded with its drafts and its keys kept, at every point of a Save and of another session's row. */
const RELOADED = /^(c\d\.(make|edit|save|deliver|deliverUnanswered|reload|see|read|redraw|settle\((draft|source)\))|remote\.add)$/;
/** A source read whole: no reads by key, each new collection read and drawn at once. */
const INLINE = /^(c\d\.(make|edit|remove|undo|save|deliver|deliverUnanswered|retry|see)|remote\.add)$/;

describe("a new row's key: the faults the model found, by name", () => {
    for (const shape of ["fields", "whole"] as const) {
        it(`two people each make a row under the one key their rule makes: the second to save goes on under the next, nothing to choose, both kept (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", clients: 2, remotes: 0 }, ["c0.make", "c1.make", "c0.save", "c0.deliver", "c1.see", "c1.read"]);
            expect([keysOf(world), world.remade, world.unsure]).toEqual([["j1", "j1-2", "j1-3"], 1, false]);
        });

        it(`a key taken twice over — another session's rows under the key made here and under the next — is made again until it is free, a refused Save carrying the row on (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 2 }, ["c0.make", "remote.add", "remote.add", "c0.see", "c0.read"]);
            expect([keysOf(world), world.remade]).toEqual([["j1", "j1-2", "j1-3", "j1-4"], 2]);
        });

        it(`rows out of view under the next three keys a rule makes — an earlier copy's each, which no page shows — are each found taken as a Save is refused, and the row made here is saved past them all (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 3 }, ["remote.addUnseen", "remote.addUnseen", "remote.addUnseen", "c0.see", "c0.redraw", "c0.make"]);
            expect([keysOf(world), world.remade, world.unsure]).toEqual([["j1", "j1-2", "j1-3", "j1-4", "j1-5"], 3, false]);
        });

        it(`a row changed after its key was made again is changed under its new key, and saved there (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 1 }, ["c0.make", "remote.add", "c0.see", "c0.read", "c0.edit", "c0.edit"]);
            expect([keysOf(world), world.remade]).toEqual([["j1", "j1-2", "j1-3"], 1]);
        });

        it(`a key taken while the page was away is made again after the reload, as before it: the keys a session made are kept with its drafts (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 1 }, ["c0.make", "remote.add", "c0.reload"]);
            expect([keysOf(world), world.remade, world.unsure]).toEqual([["j1", "j1-2", "j1-3"], 1, false]);
        });

        it(`a page reloaded while the Save of a new row has no answer, the record having taken it, saves the row once — never again under another key (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 0 }, ["c0.make", "c0.save", "c0.deliverUnanswered", "c0.reload"]);
            expect([keysOf(world), world.remade, world.unsure]).toEqual([["j1", "j1-2"], 0, true]);
        });

        it(`a row made once a Save has landed and the record moved on, before the page shows what the Save left, takes no key that Save took: it would begin from that row and be saved over it (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 1 }, ["c0.make", "c0.save", "c0.deliver", "c0.read", "remote.add", "c0.see", "c0.make"]);
            // The first made here, saved; another session's under the next key; and the second made here, past both.
            expect([keysOf(world), world.remade]).toEqual([["j1", "j1-2", "j1-3", "j1-4"], 1]);
        });

        it(`read whole, a row made while a Save is unresolved takes no key the collection has come to hold as another's since: it would begin from that row and be saved over it (${shape})`, async () => {
            const world = await rested({ shape, rule: "madeFrom", remotes: 1, inline: true }, ["c0.make", "c0.save", "c0.deliverUnanswered", "remote.add", "c0.see", "c0.make"]);
            expect(keysOf(world)).toEqual(["j1", "j1-2", "j1-3", "j1-4"]);
        });

        it(`an Integer key is one past the largest the record and the drafts hold, and made again where another session saves under it (${shape})`, async () => {
            const world = await rested({ shape, rule: "nextInteger", remotes: 1 }, ["c0.make", "c0.make", "remote.add", "c0.see", "c0.read"]);
            // Theirs took 1; the two made here, 1 and 2, go on under keys past every one taken.
            expect([keysOf(world).length, world.remade]).toEqual([4, 1]);
        });
    }
});

for (const shape of ["fields", "whole"] as const) {
    for (const rule of ["madeFrom", "nextInteger"] as const) {
        describe(`a new row's key, drafting ${shape === "fields" ? "a field at a time" : "a row whole"}, keyed ${rule === "madeFrom" ? "from the row it is made from" : "one past the largest"}`, () => {
            it("another session's rows under the keys made here: every ordering of them with a person's rows, Saves and reads", async () => {
                const found = await explore({ shape, rule, remotes: 2 }, 5 + DEEPER, BESIDE);
                console.info(said(`keys ${shape} ${rule} beside`, found));
                expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 300);
                expect(found.remade).toBeGreaterThan(0);
            }, 600_000);

            it("another session's rows out of view, under the keys made here: every ordering", async () => {
                const found = await explore({ shape, rule, remotes: 3 }, 5 + DEEPER, UNSEEN);
                console.info(said(`keys ${shape} ${rule} out of view`, found));
                expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 300);
                expect(found.remade).toBeGreaterThan(0);
                expect(found.asked).toBe(0);
            }, 600_000);

            it("every way a request can go, beside another session's rows", async () => {
                const found = await explore({ shape, rule, remotes: 1 }, 5 + DEEPER, ANSWERS);
                console.info(said(`keys ${shape} ${rule} answers`, found));
                expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 300);
                // Nothing here removes a row or takes a step back: no one is asked to choose.
                expect(found.asked).toBe(0);
            }, 600_000);

            it("two people who each make rows by the one rule: every ordering", async () => {
                const found = await explore({ shape, rule, clients: 2, remotes: 0 }, 5 + DEEPER, TWO);
                console.info(said(`keys ${shape} ${rule} two`, found));
                expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 300);
                expect(found.remade).toBeGreaterThan(0);
                // Two people's new rows under one key are two rows: no one is asked to choose.
                expect(found.asked).toBe(0);
            }, 600_000);

            it("the page reloaded with its drafts and its keys kept: every ordering", async () => {
                const found = await explore({ shape, rule, remotes: 1 }, 5 + DEEPER, RELOADED);
                console.info(said(`keys ${shape} ${rule} reloaded`, found));
                expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 300);
            }, 600_000);

            it("a source read whole: every ordering", async () => {
                const found = await explore({ shape, rule, remotes: 2, inline: true }, 5 + DEEPER, INLINE);
                console.info(said(`keys ${shape} ${rule} read whole`, found));
                expect(found.worlds).toBeGreaterThan(DEEPER < 0 ? 0 : 300);
            }, 600_000);

            it("every state a budgeted world can reach: a person's rows beside another session's", async () => {
                const walked = await states({ shape, rule, remotes: 1, ...(PROOF ? { acts: 3, sends: 2 } : { acts: 2, sends: 1 }) }, BESIDE);
                console.info(walkedSaid(`keys ${shape} ${rule} beside`, walked));
                expect(walked.closed).toBe(true);
            }, 3_600_000);

            it("every state a budgeted world can reach: the page reloaded at every point", async () => {
                const walked = await states({ shape, rule, remotes: 1, ...(PROOF ? { acts: 3, sends: 2 } : { acts: 2, sends: 1 }) }, RELOADED);
                console.info(walkedSaid(`keys ${shape} ${rule} reloaded`, walked));
                expect(walked.closed).toBe(true);
            }, 3_600_000);

            it("random runs past the depth: two people and another session, every operation", async () => {
                for (let seed = 1; seed <= 40 * RUNS; seed++) {
                    await wander({ shape, rule, clients: 2, remotes: 4 }, seed, 40);
                    await wander({ shape, rule, clients: 2, remotes: 3, inline: true }, seed, 40);
                }
            }, 600_000);
        });
    }
}
