/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A drag a part draws itself follows the pointer that pressed
 * (`follow-pointer.ts`): its moves alone, ended once by its own release, by the
 * browser taking it back or by the window losing the page, and hearing nothing
 * after — no later pointer moves what it was dragging.
 */

import { afterEach, describe, expect, test } from "vitest";
import { followPointer } from "./follow-pointer.js";

/** What a followed pointer was heard to do, in order. */
function follow(pointerId: number): { heard: string[]; stop: () => void } {
    const heard: string[] = [];
    const stop = followPointer({ pointerId, target: document.body }, {
        move: (event) => { heard.push(`move ${event.clientX}`); },
        up: (event) => { heard.push(`up ${event.clientX}`); },
        cancel: () => { heard.push("cancel"); },
    });
    return { heard, stop };
}

/** A pointer's event, as the page hears it wherever the pointer is. */
function pointer(type: "pointermove" | "pointerup" | "pointercancel", pointerId: number, clientX = 0): void {
    document.body.dispatchEvent(new PointerEvent(type, { pointerId, clientX, bubbles: true }));
}

/** The page shown or hidden, as its document says it. */
function visibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => { delete (document as unknown as { visibilityState?: unknown }).visibilityState; });

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
        const first = follow(3), second = follow(4);
        pointer("pointermove", 3, 1);
        pointer("pointermove", 4, 2);
        pointer("pointerup", 3, 3);
        pointer("pointermove", 4, 4);
        pointer("pointercancel", 4);
        expect([first.heard, second.heard]).toEqual([["move 1", "up 3"], ["move 2", "move 4", "cancel"]]);
    });
});
