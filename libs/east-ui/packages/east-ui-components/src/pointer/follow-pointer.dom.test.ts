/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A drag a part draws itself follows the pointer that pressed
 * (`follow-pointer.ts`): its moves alone, ended once by its own release, by the
 * browser taking it back, by a mouse moved with its button no longer held or by
 * the window losing the page, and hearing nothing after — no later pointer
 * moves what it was dragging. The rule is the gestures' own (`gestures.ts`,
 * every order of whose events `gestures.test.ts` walks); what is held here is
 * that the window's events reach it, and that no listener outlives the drag.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { followPointer } from "./follow-pointer.js";

/** What a followed pointer was heard to do, in order. */
function follow(pointerId: number, pointerType: "mouse" | "touch" = "mouse"): { heard: string[]; stop: () => void } {
    const heard: string[] = [];
    const stop = followPointer({ pointerId, pointerType, isPrimary: true, clientX: 0, clientY: 0, buttons: 1, target: document.body }, {
        move: (event) => { heard.push(`move ${event.clientX}`); },
        up: (event) => { heard.push(`up ${event.clientX}`); },
        cancel: () => { heard.push("cancel"); },
    });
    return { heard, stop };
}

/** A pointer's event, as the page hears it wherever the pointer is: a mouse's with its button held as it moves, unless told. */
function pointer(type: "pointermove" | "pointerup" | "pointercancel", pointerId: number, clientX = 0, init: PointerEventInit = {}): void {
    document.body.dispatchEvent(new PointerEvent(type, { pointerId, clientX, pointerType: "mouse", buttons: type === "pointermove" ? 1 : 0, bubbles: true, ...init }));
}

/** The page shown or hidden, as its document says it. */
function visibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
});

describe("followPointer", () => {
    test("follows the moves of the pointer that pressed, and no other pointer's", () => {
        const { heard, stop } = follow(3);
        pointer("pointermove", 3, 10);
        pointer("pointermove", 9, 99);
        pointer("pointermove", 3, 20);
        expect(heard).toEqual(["move 10", "move 20"]);
        stop();
    });

    test("another pointer's release neither ends nor commits the drag; its own ends it, once, and it hears nothing after", () => {
        const { heard } = follow(3);
        pointer("pointerup", 9, 99);
        pointer("pointermove", 3, 10);
        pointer("pointerup", 3, 12);
        // Ended: a pointer of the same id pressed again later is not this drag's.
        pointer("pointermove", 3, 30);
        pointer("pointerup", 3, 31);
        pointer("pointercancel", 3);
        expect(heard).toEqual(["move 10", "up 12"]);
    });

    test("the browser taking its pointer back lets go of the drag: cancelled, never released, and nothing after", () => {
        const { heard } = follow(3);
        pointer("pointercancel", 9);
        pointer("pointermove", 3, 10);
        pointer("pointercancel", 3);
        pointer("pointermove", 3, 30);
        pointer("pointerup", 3, 31);
        expect(heard).toEqual(["move 10", "cancel"]);
    });

    test("a mouse moved with its button no longer held — released where the window could not hear it — lets go of the drag, and nothing follows it after", () => {
        const { heard } = follow(1);
        pointer("pointermove", 1, 10);
        // Another button held is not the drag's.
        pointer("pointermove", 1, 20, { buttons: 1 | 2 });
        pointer("pointermove", 1, 30, { buttons: 0 });
        pointer("pointermove", 1, 40);
        pointer("pointerup", 1, 41);
        expect(heard).toEqual(["move 10", "move 20", "cancel"]);
    });

    test("a finger's drag is its finger's: another finger's moves, lift and loss are none of its, and its own lift lands it", () => {
        const { heard } = follow(3, "touch");
        const touch = { pointerType: "touch" };
        pointer("pointermove", 3, 10, touch);
        pointer("pointermove", 4, 99, touch);
        pointer("pointerup", 4, 99, touch);
        pointer("pointercancel", 5, 0, touch);
        pointer("pointermove", 3, 20, touch);
        pointer("pointerup", 3, 22, touch);
        expect(heard).toEqual(["move 10", "move 20", "up 22"]);
    });

    test("the window losing the page lets go of the drag: no release may ever be heard", () => {
        const blurred = follow(3);
        window.dispatchEvent(new Event("blur"));
        pointer("pointermove", 3, 30);
        pointer("pointerup", 3, 31);
        expect(blurred.heard).toEqual(["cancel"]);
        const hidden = follow(4);
        // A page shown again says nothing of the drag.
        visibility("visible");
        pointer("pointermove", 4, 5);
        visibility("hidden");
        pointer("pointermove", 4, 30);
        expect(hidden.heard).toEqual(["move 5", "cancel"]);
    });

    test("stopped by its part, it ends silently — and stopping a drag that has ended does nothing", () => {
        const stopped = follow(3);
        stopped.stop();
        pointer("pointermove", 3, 10);
        pointer("pointerup", 3, 11);
        window.dispatchEvent(new Event("blur"));
        expect(stopped.heard).toEqual([]);
        const ended = follow(4);
        pointer("pointerup", 4, 7);
        ended.stop();
        window.dispatchEvent(new Event("blur"));
        expect(ended.heard).toEqual(["up 7"]);
    });

    test("two drags at once are each their own pointer's", () => {
        const touch = { pointerType: "touch" };
        const first = follow(3, "touch"), second = follow(4, "touch");
        pointer("pointermove", 3, 1, touch);
        pointer("pointermove", 4, 2, touch);
        pointer("pointerup", 3, 3, touch);
        pointer("pointermove", 4, 4, touch);
        pointer("pointercancel", 4, 0, touch);
        expect([first.heard, second.heard]).toEqual([["move 1", "up 3"], ["move 2", "move 4", "cancel"]]);
    });

    test("no listener of a drag outlives it, however it ends: released, taken back, let go by a mouse, lost with the window, or stopped", () => {
        const ends: readonly (readonly [string, (stop: () => void) => void])[] = [
            ["released", () => pointer("pointerup", 1, 5)],
            ["taken back", () => pointer("pointercancel", 1)],
            ["no button held", () => pointer("pointermove", 1, 5, { buttons: 0 })],
            ["the window lost", () => window.dispatchEvent(new Event("blur"))],
            ["stopped", (stop) => stop()],
        ];
        for (const [how, end] of ends) {
            const adds = [vi.spyOn(window, "addEventListener"), vi.spyOn(document, "addEventListener")];
            const removes = [vi.spyOn(window, "removeEventListener"), vi.spyOn(document, "removeEventListener")];
            const { stop } = follow(1);
            const added = adds.flatMap((spy) => spy.mock.calls.map(([type, listener]) => [type, listener]));
            expect(added.map(([type]) => type), how).toEqual(["pointermove", "pointerup", "pointercancel", "blur", "visibilitychange"]);
            end(stop);
            // Each listener it put on the page, taken off it: the very function, under the very event.
            const removed = removes.flatMap((spy) => spy.mock.calls.map(([type, listener]) => [type, listener]));
            expect(removed, how).toEqual(added);
            vi.restoreAllMocks();
        }
    });
});
