/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Local placements in one linear pass (#859): the order a batch's placements
 * make, applied in turn — the same order the search-and-splice pass made, at
 * one id read per row however many rows move.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { placeInOrder } from "./placement.js";
import type { Placement } from "./transactions.js";

const before = (id: string): Placement => some(variant("ordered", variant("before", id)));
const after = (id: string): Placement => some(variant("ordered", variant("after", id)));
const START: Placement = some(variant("ordered", variant("start", null)));
const END: Placement = some(variant("ordered", variant("end", null)));
const KEYED: Placement = some(variant("keyOrder", null));
const self = (id: string) => id;

/** The pass `placeInOrder` replaces: a search and two splices per move. */
function spliceInOrder(rows: readonly string[], moves: readonly (readonly [string, Placement])[]): string[] {
    const out = [...rows];
    for (const [id, placement] of moves) {
        if (placement.type !== "some" || placement.value.type !== "ordered") continue;
        const at = out.indexOf(id);
        if (at < 0) continue;
        const position = placement.value.value;
        const anchored = position.type === "before" || position.type === "after";
        if (anchored && out.indexOf(position.value) < 0) continue;
        out.splice(at, 1);
        const target = position.type === "start" ? 0 : position.type === "end" ? out.length
            : out.indexOf(position.value) + (position.type === "after" ? 1 : 0);
        out.splice(target, 0, id);
    }
    return out;
}

/** A small deterministic generator — the same moves on every run. */
function generator(seed: number) {
    let s = seed >>> 0;
    return (n: number) => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s % n;
    };
}

describe("placeInOrder", () => {
    test("each placement applies in turn — before, after, the start, the end, and anchors that moved earlier", () => {
        const rows = ["a", "b", "c", "d"];
        expect(placeInOrder([...rows], self, [["d", START]])).toEqual(["d", "a", "b", "c"]);
        expect(placeInOrder([...rows], self, [["a", END]])).toEqual(["b", "c", "d", "a"]);
        expect(placeInOrder([...rows], self, [["a", after("c")]])).toEqual(["b", "c", "a", "d"]);
        expect(placeInOrder([...rows], self, [["d", before("b")]])).toEqual(["a", "d", "b", "c"]);
        // c moves to the start, then b follows c where it now is.
        expect(placeInOrder([...rows], self, [["c", START], ["b", after("c")]])).toEqual(["c", "b", "a", "d"]);
        expect(placeInOrder(["a"], self, [["a", END]])).toEqual(["a"]);
    });

    test("a missing row, a missing anchor, a row anchored on itself and a keyed placement move nothing", () => {
        const rows = ["a", "b", "c"];
        for (const move of [["z", START], ["a", after("z")], ["b", before("b")], ["a", KEYED], ["a", none]] as const) {
            const out = placeInOrder(rows, self, [move]);
            expect(out).toBe(rows);
        }
    });

    test("the order matches the search-and-splice pass on seeded random batches", () => {
        const next = generator(859);
        for (let round = 0; round < 200; round++) {
            const n = 1 + next(40);
            const rows = Array.from({ length: n }, (_u, i) => `r${i}`);
            const moves: [string, Placement][] = [];
            const count = next(30);
            for (let k = 0; k < count; k++) {
                // Now and then a row or an anchor that is not there.
                const id = next(10) === 0 ? "missing" : rows[next(n)]!;
                const anchor = next(10) === 0 ? "missing" : rows[next(n)]!;
                if (anchor === id) continue;
                const kind = next(4);
                moves.push([id, kind === 0 ? START : kind === 1 ? END : kind === 2 ? before(anchor) : after(anchor)]);
            }
            expect(placeInOrder([...rows], self, moves)).toEqual(spliceInOrder(rows, moves));
        }
    });

    test("one id read per row, however many rows move", () => {
        const n = 100_000;
        const rows = Array.from({ length: n }, (_u, i) => `r${i}`);
        const moves: [string, Placement][] = [];
        for (let k = 0; k < 10_000; k++) moves.push([`r${(k * 7919) % n}`, after(`r${(k * 104729 + 1) % n}`)]);
        let reads = 0;
        const out = placeInOrder(rows, (id) => { reads += 1; return id; }, moves);
        expect(reads).toBe(n);
        expect(out).toHaveLength(n);
        expect(new Set(out).size).toBe(n);
    });
});
