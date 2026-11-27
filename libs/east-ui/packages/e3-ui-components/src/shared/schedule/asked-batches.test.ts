/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * How a reader of a schedule's events asks e3 for the parts it wants, a batch
 * at a time (#1797): a batch on its way is asked again as it was — while the
 * parts are still counted, every one; once they are, each a read still wants a
 * part of — the parts no batch holds go in one batch more, none while they are
 * still counted, and a batch the counted read wants none of is let go.
 * The readers' own tests carry it through e3: a read on its way is never given
 * up while the next is counted (`plan/frame/plan-grouped-scale.dom.test.tsx`,
 * `plan/frame/plan-nested.dom.test.tsx`).
 */

import { describe, test, expect } from "vitest";
import { scheduleBatchesAsked } from "./asked-batches.js";

/**
 * A stand-in for e3: each batch it is asked, by its parts, in order; the batches that have landed, which answer every
 * part of theirs as they are asked; and the parts answered so far, which the reader keeps.
 */
function e3() {
    const asked: string[][] = [];
    const landed = new Set<string>();
    const answered = new Set<string>();
    return {
        asked,
        answered: (part: string) => answered.has(part),
        /** Lands a batch, by its parts: asked again, it answers them. */
        land: (batch: readonly string[]) => { landed.add(batch.join("\u0000")); },
        ask: (batch: readonly string[]): boolean => {
            asked.push([...batch]);
            if (!landed.has(batch.join("\u0000"))) return false;
            for (const part of batch) answered.add(part);
            return true;
        },
    };
}

/** A part's name: the part itself, here. */
const name = (part: string): string => part;

describe("how a reader of a schedule's events asks for the parts it wants (#1797)", () => {
    test("the parts no batch holds go in one batch, in flight until it lands, which answers them; parts answered ask nothing", () => {
        const e = e3();
        const inFlight: string[][] = [];
        expect(scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask)).toBe(false);
        expect(e.asked).toEqual([["a", "b"]]);
        expect(inFlight).toEqual([["a", "b"]]);
        e.land(["a", "b"]);
        expect(scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask)).toBe(true);
        expect(inFlight).toEqual([]);
        expect(scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask)).toBe(true);
        expect(e.asked).toEqual([["a", "b"], ["a", "b"]]);
    });

    test("a batch on its way holding a part still wanted is asked again as it was, and only the parts no batch holds go in one more", () => {
        const e = e3();
        const inFlight: string[][] = [];
        scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask);
        expect(scheduleBatchesAsked(["b", "c"], name, e.answered, inFlight, e.ask)).toBe(false);
        expect(e.asked).toEqual([["a", "b"], ["a", "b"], ["c"]]);
        expect(inFlight).toEqual([["a", "b"], ["c"]]);
        // Both landing, every part is answered, each asked once more as it was.
        e.land(["a", "b"]);
        e.land(["c"]);
        expect(scheduleBatchesAsked(["b", "c"], name, e.answered, inFlight, e.ask)).toBe(true);
        expect(e.asked.slice(3)).toEqual([["a", "b"], ["c"]]);
        expect(inFlight).toEqual([]);
    });

    test("while the parts are still counted, only the batches on their way are asked again: the parts no batch holds wait", () => {
        const e = e3();
        const inFlight: string[][] = [];
        scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask);
        expect(scheduleBatchesAsked(["b", "c"], name, e.answered, inFlight, e.ask, false)).toBe(false);
        expect(e.asked).toEqual([["a", "b"], ["a", "b"]]);
        expect(inFlight).toEqual([["a", "b"]]);
        // Counted, the rest go in one more.
        scheduleBatchesAsked(["b", "c"], name, e.answered, inFlight, e.ask);
        expect(e.asked.slice(2)).toEqual([["a", "b"], ["c"]]);
    });

    test("while the parts are still counted, every batch on its way is asked again, though it holds none of them: counted, one they are none of is let go", () => {
        const e = e3();
        const inFlight: string[][] = [];
        scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask);
        // The next read's parts are named apart from the batch's, as a change of period names its cells, and still counted:
        // what it wants is not known yet, so the batch is asked again, and so never given up.
        expect(scheduleBatchesAsked(["x", "y"], name, e.answered, inFlight, e.ask, false)).toBe(false);
        expect(e.asked).toEqual([["a", "b"], ["a", "b"]]);
        expect(inFlight).toEqual([["a", "b"]]);
        // Counted, the batch it wants none of is let go unasked, and its parts go in one batch.
        expect(scheduleBatchesAsked(["x", "y"], name, e.answered, inFlight, e.ask)).toBe(false);
        expect(e.asked.slice(2)).toEqual([["x", "y"]]);
        expect(inFlight).toEqual([["x", "y"]]);
    });

    test("a batch landing while the next read is counted answers its parts, which are never asked again", () => {
        const e = e3();
        const inFlight: string[][] = [];
        scheduleBatchesAsked(["a", "b"], name, e.answered, inFlight, e.ask);
        e.land(["a", "b"]);
        expect(scheduleBatchesAsked(["b", "c"], name, e.answered, inFlight, e.ask, false)).toBe(false);
        expect(inFlight).toEqual([]);
        expect(scheduleBatchesAsked(["b", "c"], name, e.answered, inFlight, e.ask)).toBe(false);
        expect(e.asked).toEqual([["a", "b"], ["a", "b"], ["c"]]);
    });

    test("a batch no read wants a part of is let go unasked, its request given up: a part of it wanted again is asked alone, never the batch whole", () => {
        const e = e3();
        const inFlight: string[][] = [];
        scheduleBatchesAsked(["a", "b", "c"], name, e.answered, inFlight, e.ask);
        // The view moved on: none of the batch is wanted, so nothing asks it, and it is let go.
        scheduleBatchesAsked(["d"], name, e.answered, inFlight, e.ask);
        expect(inFlight).toEqual([["d"]]);
        // One of its parts wanted again goes in a batch of its own; the batch still on its way is asked again as it was.
        scheduleBatchesAsked(["b", "d"], name, e.answered, inFlight, e.ask);
        expect(e.asked).toEqual([["a", "b", "c"], ["d"], ["d"], ["b"]]);
        expect(inFlight).toEqual([["d"], ["b"]]);
        // Nothing wanted lets every batch go.
        expect(scheduleBatchesAsked([], name, e.answered, inFlight, e.ask)).toBe(true);
        expect(inFlight).toEqual([]);
    });
});
