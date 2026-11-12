/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The fingers a surface holds (`touches.ts`): what one, two and three begin,
 * the pinch's steps, each way a finger ends, and — over every order of every
 * event three fingers can send or fail to send — that no finger outlives the
 * next first finger's landing.
 */

import { describe, expect, test } from "vitest";
import { makeTouches, pinchMoves, type Touches } from "./touches.js";

describe("one finger", () => {
    test("is a press, its moves the surface's own, and gone as it ends", () => {
        const touches = makeTouches();
        expect(touches.down(1, { x: 10, y: 10 }, true)).toBe("press");
        expect(touches.move(1, { x: 40, y: 30 })).toBeUndefined();
        expect([touches.size, touches.holds(1)]).toEqual([1, true]);
        touches.end(1);
        expect([touches.size, touches.holds(1)]).toEqual([0, false]);
    });

    test("a move of a finger the surface never heard put down is no finger of its: nothing is held of it", () => {
        const touches = makeTouches();
        expect(touches.move(7, { x: 5, y: 5 })).toBeUndefined();
        expect(touches.size).toBe(0);
        touches.end(7);
        expect(touches.size).toBe(0);
    });
});

describe("two fingers", () => {
    test("pinch: each move says how much further apart they stand, and where the point midway between them stood and stands", () => {
        const touches = makeTouches();
        touches.down(1, { x: 100, y: 200 }, true);
        expect(touches.down(2, { x: 200, y: 200 }, false)).toBe("pinch");
        // One draws away to twice the distance: the midpoint moves half as far.
        expect(touches.move(2, { x: 300, y: 200 })).toEqual({ factor: 2, from: { x: 150, y: 200 }, to: { x: 200, y: 200 } });
        // The other draws in to half of it.
        expect(touches.move(1, { x: 200, y: 200 })).toEqual({ factor: 0.5, from: { x: 200, y: 200 }, to: { x: 250, y: 200 } });
        // Both carried the same way, one after the other: their distance moves and comes back, the point between them with them.
        const there = touches.move(1, { x: 200, y: 260 })!;
        const back = touches.move(2, { x: 300, y: 260 })!;
        expect(there.factor * back.factor).toBeCloseTo(1, 12);
        expect([there.from, there.to, back.from, back.to]).toEqual([{ x: 250, y: 200 }, { x: 250, y: 230 }, { x: 250, y: 230 }, { x: 250, y: 260 }]);
    });

    test("fingers on one point are no distance to zoom by: the step zooms by nothing, then and as they part, and still carries the point between them", () => {
        const touches = makeTouches();
        touches.down(1, { x: 50, y: 50 }, true);
        touches.down(2, { x: 50, y: 50 }, false);
        const still = touches.move(2, { x: 50, y: 50 })!;
        expect([still, pinchMoves(still)]).toEqual([{ factor: 1, from: { x: 50, y: 50 }, to: { x: 50, y: 50 } }, false]);
        const parted = touches.move(2, { x: 90, y: 50 })!;
        expect([parted, pinchMoves(parted)]).toEqual([{ factor: 1, from: { x: 50, y: 50 }, to: { x: 70, y: 50 } }, true]);
        expect(touches.move(2, { x: 130, y: 50 })).toEqual({ factor: 2, from: { x: 70, y: 50 }, to: { x: 90, y: 50 } });
    });

    test("one ending leaves the other a single finger: its moves are the surface's own again", () => {
        for (const first of [1, 2]) {
            const touches = makeTouches();
            touches.down(1, { x: 0, y: 0 }, true);
            touches.down(2, { x: 100, y: 0 }, false);
            touches.end(first);
            const rest = first === 1 ? 2 : 1;
            expect([touches.size, touches.holds(rest)]).toEqual([1, true]);
            expect(touches.move(rest, { x: 500, y: 500 })).toBeUndefined();
        }
    });
});

describe("a third finger", () => {
    test("is an extra: its moves are steps of no change, and its end leaves the pinch as it stood", () => {
        const touches = makeTouches();
        touches.down(1, { x: 0, y: 0 }, true);
        touches.down(2, { x: 100, y: 0 }, false);
        expect(touches.down(3, { x: 400, y: 400 }, false)).toBe("extra");
        const extra = touches.move(3, { x: 10, y: 900 })!;
        expect([extra, pinchMoves(extra)]).toEqual([{ factor: 1, from: { x: 50, y: 0 }, to: { x: 50, y: 0 } }, false]);
        touches.end(3);
        expect(touches.move(2, { x: 200, y: 0 })).toEqual({ factor: 2, from: { x: 50, y: 0 }, to: { x: 100, y: 0 } });
    });

    test("one of the two ending leaves the pinch to the two held longest: the next step is theirs alone, as they stand", () => {
        const touches = makeTouches();
        touches.down(1, { x: 0, y: 0 }, true);
        touches.down(2, { x: 100, y: 0 }, false);
        touches.down(3, { x: 0, y: 300 }, false);
        touches.end(1);
        // 2 and 3 now pinch, 316px apart as they stand: a move of 3 to 632px is a step of two, never of 632 over 100.
        const step = touches.move(3, { x: -100, y: 600 })!;
        expect(step.factor).toBeCloseTo(Math.hypot(200, 600) / Math.hypot(100, 300), 12);
        expect([step.from, step.to]).toEqual([{ x: 50, y: 150 }, { x: 0, y: 300 }]);
    });
});

describe("a finger whose end is never heard", () => {
    test("is let go of as the next first finger lands: that one is a press, never a pinch against it", () => {
        const touches = makeTouches();
        touches.down(1, { x: 10, y: 10 }, true);
        // No end is heard. The next is the page's first: no other finger is on it.
        expect(touches.down(2, { x: 300, y: 300 }, true)).toBe("press");
        expect([touches.size, touches.holds(1), touches.holds(2)]).toEqual([1, false, true]);
        expect(touches.move(2, { x: 350, y: 300 })).toBeUndefined();
    });

    test("stands in a pinch only until then: a finger that is not the page's first pinches against it", () => {
        const touches = makeTouches();
        touches.down(1, { x: 10, y: 10 }, true);
        expect(touches.down(2, { x: 300, y: 300 }, false)).toBe("pinch");
        touches.end(2);
        expect(touches.down(3, { x: 300, y: 300 }, true)).toBe("press");
        expect(touches.size).toBe(1);
    });

    test("a pointer's id pressed again is a new finger, the last to arrive: alone a press, and never the pinch's first", () => {
        const touches = makeTouches();
        touches.down(1, { x: 0, y: 0 }, true);
        expect(touches.down(1, { x: 40, y: 0 }, false)).toBe("press");
        touches.down(2, { x: 140, y: 0 }, false);
        // 1, pressed again while 2 is held: 2 and 1 pinch, as they stand now.
        expect(touches.down(1, { x: 240, y: 0 }, false)).toBe("pinch");
        expect(touches.move(1, { x: 340, y: 0 })).toEqual({ factor: 2, from: { x: 190, y: 0 }, to: { x: 240, y: 0 } });
    });

    test("every finger is let go of as the window loses the page", () => {
        const touches = makeTouches();
        touches.down(1, { x: 0, y: 0 }, true);
        touches.down(2, { x: 100, y: 0 }, false);
        touches.clear();
        expect(touches.size).toBe(0);
        expect(touches.down(3, { x: 5, y: 5 }, false)).toBe("press");
    });
});

/** A finger's two points, by its id: no two fingers share one, so no pair is ever no distance apart. */
const POINTS: Readonly<Record<number, readonly [{ x: number; y: number }, { x: number; y: number }]>> = {
    1: [{ x: 0, y: 0 }, { x: 30, y: 40 }],
    2: [{ x: 200, y: 0 }, { x: 260, y: 80 }],
    3: [{ x: 0, y: 300 }, { x: 90, y: 420 }],
};

/** The fingers a record should hold, as the events it was told leave them: in the order they landed, each at point 0 or 1. */
type Held = readonly (readonly [id: number, at: number])[];

/** The page's fingers beside what the surface was told of them. */
interface World {
    /** The fingers on the page, by id, each at point 0 or 1. */
    readonly live: ReadonlyMap<number, number>;
    /** What the record should hold. */
    readonly held: Held;
    /** The events the record was told, in order: the shortest run that reaches this state. */
    readonly told: readonly string[];
}

/** A record told a run of events, made afresh: no two states share one. */
function replay(told: readonly string[]): Touches {
    const touches = makeTouches();
    for (const event of told) {
        const [what, id, arg] = event.split(" ");
        const finger = Number(id);
        if (what === "down") touches.down(finger, POINTS[finger]![0], arg === "primary");
        else if (what === "move") touches.move(finger, POINTS[finger]![Number(arg)]!);
        else if (what === "end") touches.end(finger);
        else touches.clear();
    }
    return touches;
}

/** The two held longest, as a pinch measures them: how far apart, and the point midway; `undefined` while fewer are held. */
function pair(held: Held): { dist: number; x: number; y: number } | undefined {
    const [first, second] = held;
    if (first === undefined || second === undefined) return undefined;
    const a = POINTS[first[0]]![first[1]]!, b = POINTS[second[0]]![second[1]]!;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

test("over every state three fingers can reach — each put down, moved, ended and heard, ended and never heard, in every order, the window losing the page between any two: the record holds what a plain list of the events would, each step is the two held longest's alone, and with no finger left on the page the next is a press", () => {
    const key = (world: World) => `${[1, 2, 3].map((id) => world.live.get(id) ?? "-").join("")}|${world.held.map(([id, at]) => `${id}${at}`).join(",")}`;
    const start: World = { live: new Map(), held: [], told: [] };
    const seen = new Set([key(start)]);
    // Breadth first, so each state is reached by the shortest run of events, and told that run.
    const queue = [start];
    const reach = (world: World) => {
        const k = key(world);
        if (seen.has(k)) return;
        seen.add(k);
        queue.push(world);
    };
    for (let world = queue.shift(); world !== undefined; world = queue.shift()) {
        const how = world.told.join(", ") || "nothing told";
        const record = replay(world.told);
        // The record holds exactly what the list does.
        expect([1, 2, 3].filter((id) => record.holds(id)), how).toEqual(world.held.map(([id]) => id).sort());
        expect(record.size, how).toBe(world.held.length);
        // No finger on the page: whatever is still held of fingers never heard to end, the next is the page's first.
        if (world.live.size === 0) {
            const probe = replay(world.told);
            expect([probe.down(9, { x: 500, y: 500 }, true), probe.size, probe.move(9, { x: 600, y: 500 })], how).toEqual(["press", 1, undefined]);
        }
        for (const id of [1, 2, 3]) {
            const at = world.live.get(id);
            if (at === undefined) {
                // Put down: the page's first where no other is on it, which lets go of all the record still holds.
                const primary = world.live.size === 0;
                const held: Held = [...(primary ? [] : world.held.filter(([other]) => other !== id)), [id, 0]];
                const event = `down ${id}${primary ? " primary" : ""}`;
                expect(replay(world.told).down(id, POINTS[id]![0], primary), `${how}, ${event}`).toBe(held.length === 1 ? "press" : held.length === 2 ? "pinch" : "extra");
                reach({ live: new Map([...world.live, [id, 0]]), held, told: [...world.told, event] });
                continue;
            }
            // Moved, to its other point: a step of the two held longest, as they stood and as they stand, whoever moved —
            // and no step for a finger the record let go of, or the only one it holds.
            const holds = world.held.some(([other]) => other === id);
            const held: Held = world.held.map(([other, where]) => (other === id ? [other, 1 - at] : [other, where]));
            const was = pair(world.held), now = pair(held);
            const event = `move ${id} ${1 - at}`;
            const step = replay(world.told).move(id, POINTS[id]![1 - at]!);
            if (!holds || was === undefined || now === undefined) expect(step, `${how}, ${event}`).toBeUndefined();
            else {
                expect(step, `${how}, ${event}`).toBeDefined();
                expect(step!.factor, `${how}, ${event}`).toBeCloseTo(now.dist / was.dist, 12);
                expect([step!.from, step!.to], `${how}, ${event}`).toEqual([{ x: was.x, y: was.y }, { x: now.x, y: now.y }]);
                // A step moves something exactly where one of the two held longest moved: a third's moves nothing.
                expect(pinchMoves(step!), `${how}, ${event}`).toBe(world.held.findIndex(([other]) => other === id) < 2);
            }
            reach({ live: new Map([...world.live, [id, 1 - at]]), held, told: [...world.told, event] });
            // Ended — its lift, the browser taking it back, its capture lost — and the record told, or never told.
            const gone = new Map(world.live);
            gone.delete(id);
            reach({ live: gone, held: world.held.filter(([other]) => other !== id), told: [...world.told, `end ${id}`] });
            reach({ live: gone, held: world.held, told: world.told });
        }
        // The window loses the page: the record lets go of every finger, whatever the page still has down.
        reach({ live: world.live, held: [], told: [...world.told, "clear"] });
    }
    // Every finger absent or at either point, beside every list of up to three the record can be left holding.
    expect(seen.size).toBeGreaterThan(500);
});

test("over long runs of fingers put down, moved anywhere, ended and never heard to end, a record told every event answers each as a plain list of them would", () => {
    // A seeded run, the same each time it is run: the paths the walk above reaches each state by are its shortest, and
    // these are long.
    let seed = 20261112;
    const random = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    for (let run = 0; run < 200; run++) {
        const touches = makeTouches();
        // The page's fingers, and what the record should hold: each finger's point, in the order they landed.
        const live = new Set<number>();
        let held: (readonly [number, { x: number; y: number }])[] = [];
        const told: string[] = [];
        const span = () => {
            const [a, b] = held;
            return a === undefined || b === undefined ? undefined : { dist: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y), x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 };
        };
        for (let step = 0; step < 200; step++) {
            const id = 1 + random(4), at = { x: random(400), y: random(400) };
            const how = () => `run ${run}: ${told.join(", ")}`;
            if (!live.has(id)) {
                const primary = live.size === 0;
                told.push(`down ${id}${primary ? " primary" : ""}`);
                held = [...(primary ? [] : held.filter(([other]) => other !== id)), [id, at]];
                expect(touches.down(id, at, primary), how()).toBe(held.length === 1 ? "press" : held.length === 2 ? "pinch" : "extra");
                live.add(id);
            } else if (random(3) > 0) {
                told.push(`move ${id}`);
                const was = span();
                held = held.map(([other, where]) => (other === id ? [other, at] : [other, where]));
                const now = span();
                const answered = touches.move(id, at);
                if (!held.some(([other]) => other === id) || was === undefined || now === undefined) expect(answered, how()).toBeUndefined();
                else expect(answered, how()).toEqual({ factor: was.dist > 0 && now.dist > 0 ? now.dist / was.dist : 1, from: { x: was.x, y: was.y }, to: { x: now.x, y: now.y } });
            } else {
                live.delete(id);
                if (random(2) === 0) {
                    told.push(`end ${id}`);
                    held = held.filter(([other]) => other !== id);
                    touches.end(id);
                } else told.push(`never heard ${id}`);
            }
            expect([touches.size, [1, 2, 3, 4].filter((finger) => touches.holds(finger))], how()).toEqual([held.length, held.map(([finger]) => finger).sort()]);
        }
    }
});
