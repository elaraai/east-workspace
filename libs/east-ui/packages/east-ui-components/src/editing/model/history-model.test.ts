/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One history over a session a record (`EditHistory`), held to what it
 * promises over orderings rather than examples: every ordering of a desk's
 * operations to a depth, and seeded random runs past it (`desk.test-utils.ts`
 * says what a desk is, what its operations are and what must hold after each).
 *
 * Each ordering is run from a fresh desk, checked after every operation, then
 * brought to rest — every request answered, every read landed and drawn, every
 * change saved — and checked at rest.
 *
 * `EDITING_MODEL_DEPTH` deepens every exploration by that many operations, and
 * `EDITING_MODEL_RUNS` multiplies the random runs, as `session-model.test.ts`'s
 * do.
 */
import { describe, expect, it } from "vitest";
import { ModelDesk, deskAfter, deskIndependent } from "./desk.test-utils.js";
import { everyOrdering, seeded } from "./explore.test-utils.js";

const DEEPER = Number(process.env["EDITING_MODEL_DEPTH"] ?? 0);
const RUNS = Number(process.env["EDITING_MODEL_RUNS"] ?? 1);
/**
 * How long one exploration may take: a backstop against a walk that never ends, never a budget. An exploration is
 * bounded by what it walks — a depth, so many runs, a limit of states — and takes what that takes on the machine it
 * runs on: a proof run's take minutes each, and on a CI runner some times what they take on a desk.
 */
const WITHIN = DEEPER > 0 || RUNS > 1 ? 10_800_000 : 600_000;

/** A person's gestures in each record and across both, Undo, Redo, Discard, Save and each record's answer and reads. */
const OWN = /^(edit|both|undo|redo|discard|save|deliver\(|read|redraw)/;
/** A Save's ways in each record: answered, its answer lost, or lost itself, with the gestures and Undo around it. */
const ANSWERS = /^(edit|both|undo|save|deliver|lose|read|retry|askAgain)/;
/** An optimiser's result among the gestures, a person's Save and an automatic one. */
const AUTOMATIC = /^(edit|both|optimise|undo|redo|save|autosave|deliver\()/;

for (const shape of ["fields", "whole"] as const) {
    describe(`one history over two records, drafting ${shape === "fields" ? "a field at a time" : "a row whole"}`, () => {
        const explore = async (depth: number, allow: RegExp): Promise<number> =>
            everyOrdering((ops) => deskAfter(shape, ops), depth, (op) => allow.test(op), deskIndependent, () => undefined);

        it("gestures in each record and across both: every ordering with Undo, Redo, Discard, Save and each record's answer and reads", async () => {
            const count = await explore(5 + DEEPER, OWN);
            console.info(`[editing model] ${shape} desk own: ${count} orderings`);
            expect(count).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, WITHIN);

        it("a Save answered, its answer lost, or lost itself, in each record: every ordering with gestures and Undo", async () => {
            const count = await explore(5 + DEEPER, ANSWERS);
            console.info(`[editing model] ${shape} desk answers: ${count} orderings`);
            expect(count).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, WITHIN);

        it("an automatic Save: every ordering with gestures in each record, an optimiser's result, Undo, Redo and a person's Save", async () => {
            const count = await explore(5 + DEEPER, AUTOMATIC);
            console.info(`[editing model] ${shape} desk automatic: ${count} orderings`);
            expect(count).toBeGreaterThan(DEEPER < 0 ? 0 : 2_000);
        }, WITHIN);

        it("random runs past that depth, each from its seed", async () => {
            for (let seed = 1; seed <= 500 * RUNS; seed++) {
                const random = seeded(seed);
                const desk = new ModelDesk(shape);
                try {
                    await desk.start();
                    for (let i = 0; i < 40; i++) {
                        const ops = desk.enabled();
                        if (ops.length === 0) break;
                        await desk.run(ops[Math.floor(random() * ops.length)]!);
                    }
                    await desk.rest();
                } catch (error) {
                    throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
                }
            }
        }, WITHIN);
    });
}

describe("the desk's exploration itself", () => {
    it("runs two records' screens drawn again in one order only, and nothing else", () => {
        expect(deskIndependent("redraw(A)", "redraw(B)")).toBe(true);
        expect(deskIndependent("redraw(A)", "redraw(A)")).toBe(false);
        expect(deskIndependent("read(A)", "read(B)")).toBe(false);
        expect(deskIndependent("deliver(A)", "deliver(B)")).toBe(false);
        expect(deskIndependent("edit(A)", "edit(B)")).toBe(false);
    });
});
