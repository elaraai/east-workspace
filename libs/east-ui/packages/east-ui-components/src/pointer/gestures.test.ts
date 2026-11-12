/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One gesture in flight, and whose it is (`gestures.ts`): what a press, a
 * second finger, another pointer and each way a pointer ends do — and, over
 * every state two fingers and a mouse can bring a surface to, in every order of
 * every event they can send or fail to send, that a gesture begins only at
 * rest, ends exactly once, lands only on its own pointer's release, and is
 * never left in flight once no pointer is on the page.
 */

import { describe, expect, test } from "vitest";
import { makeGestures, type GestureHost, type Gestures, type PointerState } from "./gestures.js";

/** What a host heard, in order, and whether a gesture or a pinch stands as it heard it. */
interface Heard {
    readonly calls: string[];
    /** The event that pressed the gesture in flight; `undefined` while none is. */
    pressed: string | undefined;
    pinching: boolean;
    /** What the host heard that it never should have, as it stood. */
    readonly wrong: string[];
}

/** A host that keeps what it hears, and says what it should never have heard as it stood. */
function listen(): { heard: Heard; host: GestureHost<string> } {
    const heard: Heard = { calls: [], pressed: undefined, pinching: false, wrong: [] };
    const say = (call: string, ok: boolean): void => {
        heard.calls.push(call);
        if (!ok) heard.wrong.push(`${call} after ${heard.calls.slice(0, -1).join(", ") || "nothing"}`);
    };
    return {
        heard,
        host: {
            press: (event) => { say(`press ${event}`, heard.pressed === undefined && !heard.pinching); heard.pressed = event; },
            drag: (event) => { say(`drag ${event}`, heard.pressed !== undefined); },
            release: (event) => { say(`release ${event}`, heard.pressed !== undefined); heard.pressed = undefined; },
            drop: () => { say("drop", heard.pressed !== undefined); heard.pressed = undefined; },
            hover: (event) => { say(`hover ${event}`, heard.pressed === undefined && !heard.pinching); },
            pinchStart: () => { say("pinchStart", heard.pressed === undefined && !heard.pinching); heard.pinching = true; },
            pinch: (step, event) => { say(`pinch ${event} ×${step.factor.toFixed(2)}`, heard.pinching); },
            pinchEnd: () => { say("pinchEnd", heard.pinching); heard.pinching = false; },
        },
    };
}

const finger = (id: number, x: number, primary = false): PointerState => ({ id, kind: "touch", at: { x, y: 0 }, primary, buttons: 1 });
const mouse = (x: number, buttons = 1): PointerState => ({ id: 1, kind: "mouse", at: { x, y: 0 }, primary: true, buttons });

describe("a press", () => {
    test("begins a gesture its pointer owns: its moves drag it, its release lands it, and at rest again a move hovers", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.move(mouse(0, 0), "m0");
        gestures.down(mouse(0), "m1");
        expect([gestures.owner, gestures.idle]).toEqual([1, false]);
        gestures.move(mouse(10), "m2");
        gestures.up(mouse(10, 0), "m3");
        gestures.move(mouse(20, 0), "m4");
        expect(heard.calls).toEqual(["hover m0", "press m1", "drag m2", "release m3", "hover m4"]);
        expect([gestures.owner, gestures.idle, heard.wrong]).toEqual([undefined, true, []]);
    });

    test("another pointer's moves, release and cancel are never the gesture's: it lands only on its own pointer's release", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(mouse(0), "m1");
        // A finger the surface never heard put down — pressed on a part of the page with its own gestures — moves and lifts over it.
        gestures.move(finger(7, 50), "f1");
        gestures.up(finger(7, 50), "f2");
        gestures.cancel(finger(8, 50));
        gestures.move(mouse(10), "m2");
        gestures.up(mouse(10, 0), "m3");
        expect([heard.calls, heard.wrong]).toEqual([["press m1", "drag m2", "release m3"], []]);
    });

    test("is let go of, landing nothing, as its pointer is taken back, as the window loses the page, and as a mouse moves with its button no longer held", () => {
        for (const [how, end] of [
            ["taken back", (g: Gestures<string>) => g.cancel(mouse(10))],
            ["the window lost", (g: Gestures<string>) => g.lose()],
            ["no button held", (g: Gestures<string>) => g.move(mouse(10, 0), "m2")],
        ] as const) {
            const { heard, host } = listen();
            const gestures = makeGestures(host);
            gestures.down(mouse(0), "m1");
            end(gestures);
            // Its release, heard after all, lands nothing.
            gestures.up(mouse(10, 0), "m3");
            expect(heard.calls.filter((call) => !call.startsWith("hover")), how).toEqual(["press m1", "drop"]);
            expect([gestures.owner, heard.wrong], how).toEqual([undefined, []]);
        }
    });

    test("while one is in flight — its pointer's end never heard — lets go of that one first", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(mouse(0), "m1");
        gestures.down(finger(5, 40, true), "f1");
        gestures.up(finger(5, 40), "f2");
        expect([heard.calls, heard.wrong]).toEqual([["press m1", "drop", "press f1", "release f2"], []]);
    });

    test("a mouse's other buttons held are no press of the gesture's button: released, the gesture is let go of", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(mouse(0), "m1");
        gestures.move(mouse(5, 1 | 4), "m2");
        gestures.move(mouse(9, 4), "m3");
        expect(heard.calls).toEqual(["press m1", "drag m2", "drop", "hover m3"]);
    });
});

describe("fingers", () => {
    test("a second finger lets go of what the first began and starts a pinch; each move of either is a step; the pinch is over as one lifts, and the finger left begins nothing", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(finger(1, 0, true), "a1");
        gestures.move(finger(1, 10), "a2");
        gestures.down(finger(2, 110), "b1");
        expect([gestures.owner, gestures.pinching]).toEqual([undefined, true]);
        gestures.move(finger(2, 210), "b2");
        gestures.move(finger(1, 110), "a3");
        gestures.up(finger(2, 210), "b3");
        expect(gestures.pinching).toBe(false);
        // The finger left: its moves are no drag, and its lift lands nothing.
        gestures.move(finger(1, 150), "a4");
        gestures.up(finger(1, 150), "a5");
        expect(heard.calls).toEqual(["press a1", "drag a2", "drop", "pinchStart", "pinch b2 ×2.00", "pinch a3 ×0.50", "pinchEnd", "hover a4"]);
        expect([gestures.idle, heard.wrong]).toEqual([true, []]);
    });

    test("a third finger starts nothing and its lift lands nothing; a finger pressed again while two are held is the second of the two still", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(finger(1, 0, true), "a1");
        gestures.down(finger(2, 100), "b1");
        gestures.down(finger(3, 400), "c1");
        gestures.move(finger(3, 500), "c2");
        gestures.up(finger(3, 500), "c3");
        // The second finger's lift is never heard, and it lands again: one pinch still, never a second begun inside it.
        gestures.down(finger(2, 150), "b2");
        gestures.move(finger(2, 300), "b3");
        expect(heard.calls).toEqual(["press a1", "drop", "pinchStart", "pinch b3 ×2.00"]);
        expect([gestures.pinching, heard.wrong]).toEqual([true, []]);
    });

    test("a mouse's press lets go of every finger held and presses: a pinch whose fingers were never heard to end keeps no press from the surface", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(finger(5, 0, true), "a1");
        gestures.down(finger(6, 100), "b1");
        gestures.down(mouse(0), "m1");
        // The fingers, were they still down, move and lift as no part of the press.
        gestures.move(finger(5, 30), "a2");
        gestures.up(finger(6, 100), "b2");
        gestures.up(mouse(0, 0), "m2");
        expect(heard.calls).toEqual(["press a1", "drop", "pinchStart", "pinchEnd", "press m1", "release m2"]);
        expect([gestures.idle, heard.wrong]).toEqual([true, []]);
    });

    test("a finger taken back mid-pinch ends the pinch; taken back alone, it is gone: the next finger presses, never pinches", () => {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        gestures.down(finger(1, 0, true), "a1");
        gestures.down(finger(2, 100), "b1");
        gestures.cancel(finger(1, 0));
        gestures.cancel(finger(2, 100));
        // No other finger is on the page, but the browser says so of none: a finger of another part's rests there.
        gestures.down(finger(3, 50), "c1");
        gestures.move(finger(3, 80), "c2");
        expect(heard.calls).toEqual(["press a1", "drop", "pinchStart", "pinchEnd", "press c1", "drag c2"]);
        expect(heard.wrong).toEqual([]);
    });

    test("a finger whose end is never heard is let go of as the page's next first finger lands — its pinch over, and the new finger a press — and as the window loses the page", () => {
        const first = listen();
        const one = makeGestures(first.host);
        one.down(finger(1, 0, true), "a1");
        one.down(finger(2, 100), "b1");
        // Neither end is heard. The next finger is the page's first.
        one.down(finger(3, 50, true), "c1");
        one.move(finger(3, 90), "c2");
        expect(first.heard.calls).toEqual(["press a1", "drop", "pinchStart", "pinchEnd", "press c1", "drag c2"]);
        const second = listen();
        const two = makeGestures(second.host);
        two.down(finger(1, 0, true), "a1");
        two.down(finger(2, 100), "b1");
        two.lose();
        expect([two.idle, second.heard.calls]).toEqual([true, ["press a1", "drop", "pinchStart", "pinchEnd"]]);
        expect([...first.heard.wrong, ...second.heard.wrong]).toEqual([]);
    });
});

/** A pointer of the walk: two fingers and a mouse, each at one of two places. */
const WALKERS = [
    { id: 11, kind: "touch", at: [0, 60] },
    { id: 12, kind: "touch", at: [200, 320] },
    { id: 1, kind: "mouse", at: [500, 540] },
] as const;

/** An event of the walk, as the surface is told it; `undefined` for an end it never hears. */
type Told = { readonly what: "down" | "move" | "up" | "cancel"; readonly pointer: PointerState } | { readonly what: "lose" };

/** The page's pointers beside what the surface was told of them. */
interface World {
    /** The pointers down on the page, by id, each at place 0 or 1. */
    readonly live: ReadonlyMap<number, number>;
    /** What the surface was told, in order: the shortest run that reaches this state. */
    readonly told: readonly Told[];
}

/** A surface told a run of events, made afresh, with what its host heard. */
function replay(told: readonly Told[]): { gestures: Gestures<string>; heard: Heard } {
    const { heard, host } = listen();
    const gestures = makeGestures(host);
    told.forEach((event, i) => {
        if (event.what === "lose") gestures.lose();
        else if (event.what === "cancel") gestures.cancel(event.pointer);
        else gestures[event.what](event.pointer, `e${i}`);
    });
    return { gestures, heard };
}

const said = (told: readonly Told[]): string => told.map((event) => (event.what === "lose" ? "lose" : `${event.what} ${event.pointer.id}`)).join(", ") || "nothing told";

test("over every state two fingers and a mouse can bring a surface to — each put down, moved, released and heard, released and never heard, taken back, the mouse moved with no button, the window losing the page between any two: a gesture begins only at rest and ends once, nothing the host should never hear is heard, a pointer the surface heard released holds nothing, and with no pointer left on the page the next press presses", () => {
    const start: World = { live: new Map(), told: [] };
    /** A state, as the page and the surface stand: the pointers down, what the surface holds of each, and what stands. */
    const key = (world: World): string => {
        const { gestures, heard } = replay(world.told);
        return [
            WALKERS.map((w) => world.live.get(w.id) ?? "-").join(""),
            WALKERS.map((w) => (gestures.holds(w.id) ? "h" : "-")).join(""),
            gestures.owner ?? "-", gestures.pinching ? "p" : "-", heard.pressed === undefined ? "-" : "g",
        ].join("|");
    };
    const seen = new Set([key(start)]);
    const queue = [start];
    const reach = (world: World): void => {
        const k = key(world);
        if (seen.has(k)) return;
        seen.add(k);
        queue.push(world);
    };
    for (let world = queue.shift(); world !== undefined; world = queue.shift()) {
        const how = said(world.told);
        const { gestures, heard } = replay(world.told);
        // Nothing the host should never have heard, as it stood; and the surface and its host agree on what stands.
        expect(heard.wrong, how).toEqual([]);
        expect([gestures.owner !== undefined, gestures.pinching], how).toEqual([heard.pressed !== undefined, heard.pinching]);
        // No gesture and a pinch at once.
        expect(gestures.owner !== undefined && gestures.pinching, how).toBe(false);
        if (world.live.size === 0) {
            // No pointer on the page: whatever ends were never heard, the page's next first finger presses, and so does a mouse.
            for (const pointer of [finger(21, 5, true), mouse(5)]) {
                const probe = replay([...world.told, { what: "down", pointer }]);
                expect([probe.gestures.owner, probe.gestures.pinching, probe.heard.calls.at(-1), probe.heard.wrong], `${how}, then ${pointer.kind}`)
                    .toEqual([pointer.id, false, `press e${world.told.length}`, []]);
            }
        }
        for (const walker of WALKERS) {
            const at = world.live.get(walker.id);
            const touch = walker.kind === "touch";
            const state = (place: number, buttons = 1): PointerState => ({
                id: walker.id, kind: walker.kind, at: { x: walker.at[place]!, y: 0 }, buttons,
                // A finger is the page's first while no other finger is on it; a mouse always is.
                primary: !touch || ![...world.live.keys()].some((id) => id !== walker.id && WALKERS.find((w) => w.id === id)!.kind === "touch"),
            });
            if (at === undefined) {
                reach({ live: new Map([...world.live, [walker.id, 0]]), told: [...world.told, { what: "down", pointer: state(0) }] });
                continue;
            }
            // Moved to its other place.
            reach({ live: new Map([...world.live, [walker.id, 1 - at]]), told: [...world.told, { what: "move", pointer: state(1 - at) }] });
            const gone = new Map(world.live);
            gone.delete(walker.id);
            // Released, and heard: the surface holds nothing of it after.
            const released = [...world.told, { what: "up", pointer: state(at, 0) } as const];
            expect(replay(released).gestures.holds(walker.id), `${how}, up ${walker.id}`).toBe(false);
            reach({ live: gone, told: released });
            // Released where the surface never hears; taken back by the browser.
            reach({ live: gone, told: world.told });
            reach({ live: gone, told: [...world.told, { what: "cancel", pointer: state(at, 0) }] });
            // A mouse let go unheard moves on with no button held.
            if (!touch) reach({ live: gone, told: [...world.told, { what: "move", pointer: state(1 - at, 0) }] });
        }
        // The window loses the page: nothing is held after, whatever the page still has down.
        const lost = replay([...world.told, { what: "lose" }]);
        expect([lost.gestures.idle, lost.gestures.pinching, lost.heard.pressed, lost.heard.wrong], `${how}, lose`).toEqual([true, false, undefined, []]);
        reach({ live: world.live, told: [...world.told, { what: "lose" }] });
    }
    expect(seen.size).toBeGreaterThan(100);
});

test("over long runs of the same events in any order, the host never hears what it should not, and each gesture pressed ends exactly once", () => {
    let seed = 20261112;
    const random = (n: number): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    for (let run = 0; run < 300; run++) {
        const { heard, host } = listen();
        const gestures = makeGestures(host);
        const live = new Map<number, number>();
        for (let step = 0; step < 120; step++) {
            const walker = WALKERS[random(WALKERS.length)]!;
            const touch = walker.kind === "touch";
            const at = live.get(walker.id);
            const state = (place: number, buttons = 1): PointerState => ({
                id: walker.id, kind: walker.kind, at: { x: walker.at[place]! + random(40), y: random(40) }, buttons,
                primary: !touch || ![...live.keys()].some((id) => id !== walker.id && WALKERS.find((w) => w.id === id)!.kind === "touch"),
            });
            const choice = random(at === undefined ? 2 : 7);
            if (at === undefined) {
                if (choice === 0) { gestures.down(state(0), `e${step}`); live.set(walker.id, 0); } else if (random(20) === 0) gestures.lose();
            } else if (choice < 3) { gestures.move(state(1 - at), `e${step}`); live.set(walker.id, 1 - at); }
            else {
                live.delete(walker.id);
                if (choice === 3) gestures.up(state(at, 0), `e${step}`);
                else if (choice === 4) gestures.cancel(state(at, 0));
                else if (choice === 5 && !touch) gestures.move(state(at, 0), `e${step}`);
                // Else its end is never heard.
            }
        }
        const presses = heard.calls.filter((call) => call.startsWith("press")).length;
        const ends = heard.calls.filter((call) => call.startsWith("release") || call === "drop").length;
        expect(heard.wrong, `run ${run}`).toEqual([]);
        expect(presses - ends, `run ${run}`).toBe(heard.pressed === undefined ? 0 : 1);
    }
});
