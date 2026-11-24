/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A wait for the press in progress (`press-wait.ts`, #1673): a step runs at
 * once where no press is in progress, else once every press has ended and the
 * click the last made has landed — a press ending the ways a followed drag
 * ends (`follow-pointer.ts`); a step cancelled, or waiting as the wait stops,
 * never runs; and no listener outlives the wait.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { pressWait, usePressWait } from "./press-wait.js";

/** A pointer's event, as the page hears it: a mouse's, its button held as it presses and moves, unless told. */
function pointer(type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", pointerId: number, init: PointerEventInit = {}): void {
    const buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0;
    document.body.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: "mouse", buttons, bubbles: true, ...init }));
}

/** The task after this one: what a release's click lands in has run by then. */
const nextTask = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/** The page shown or hidden, as its document says it. */
function visibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
});

describe("pressWait", () => {
    test("runs a step at once where no press is in progress", () => {
        const wait = pressWait(window);
        const ran: string[] = [];
        wait.after(() => ran.push("step"));
        expect(ran).toEqual(["step"]);
        wait.stop();
    });

    test("runs a step once the press in progress has ended and its click has landed", async () => {
        const wait = pressWait(window);
        const heard: string[] = [];
        const click = () => heard.push("click");
        document.body.addEventListener("click", click);
        pointer("pointerdown", 1);
        wait.after(() => heard.push("step"));
        pointer("pointermove", 1);
        pointer("pointerup", 1);
        // The release's click, in the release's own task.
        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(heard).toEqual(["click"]);
        await nextTask();
        expect(heard).toEqual(["click", "step"]);
        document.body.removeEventListener("click", click);
        wait.stop();
    });

    test("waits for every pointer pressed — a second finger's, and a press begun as the first's release was heard", async () => {
        const wait = pressWait(window);
        const ran: string[] = [];
        const touch = { pointerType: "touch" };
        pointer("pointerdown", 3, touch);
        pointer("pointerdown", 4, touch);
        wait.after(() => ran.push("step"));
        pointer("pointerup", 3, touch);
        await nextTask();
        expect(ran).toEqual([]);
        pointer("pointerup", 4, touch);
        // Pressed again before the step's task: it waits on.
        pointer("pointerdown", 5, touch);
        await nextTask();
        expect(ran).toEqual([]);
        pointer("pointerup", 5, touch);
        await nextTask();
        expect(ran).toEqual(["step"]);
        wait.stop();
    });

    test("a press ends as a drag does: taken back by the browser, released where the window could not hear it, or the window losing the page", async () => {
        const ends: readonly (readonly [string, () => void])[] = [
            ["taken back", () => pointer("pointercancel", 1)],
            ["a mouse moved with no button held", () => pointer("pointermove", 1, { buttons: 0 })],
            ["the window lost", () => window.dispatchEvent(new Event("blur"))],
            ["the page hidden", () => visibility("hidden")],
        ];
        for (const [how, end] of ends) {
            const wait = pressWait(window);
            const ran: string[] = [];
            pointer("pointerdown", 1);
            wait.after(() => ran.push("step"));
            // Another pointer's end, a button still held, the page shown: none ends the press.
            pointer("pointerup", 9);
            pointer("pointermove", 1);
            visibility("visible");
            await nextTask();
            expect(ran, how).toEqual([]);
            end();
            await nextTask();
            expect(ran, how).toEqual(["step"]);
            wait.stop();
        }
    });

    test("a step cancelled never runs; another waiting still does", async () => {
        const wait = pressWait(window);
        const ran: string[] = [];
        pointer("pointerdown", 1);
        const cancel = wait.after(() => ran.push("cancelled"));
        wait.after(() => ran.push("kept"));
        cancel();
        pointer("pointerup", 1);
        await nextTask();
        expect(ran).toEqual(["kept"]);
        wait.stop();
    });

    test("stopped, a step still waiting never runs, and no listener of it outlives it", async () => {
        const adds = [vi.spyOn(window, "addEventListener"), vi.spyOn(document, "addEventListener")];
        const removes = [vi.spyOn(window, "removeEventListener"), vi.spyOn(document, "removeEventListener")];
        const wait = pressWait(window);
        const added = adds.flatMap((spy) => spy.mock.calls.map(([type, listener, capture]) => [type, listener, capture]));
        expect(added.map(([type]) => type)).toEqual(["pointerdown", "pointerup", "pointercancel", "pointermove", "blur", "visibilitychange"]);
        const ran: string[] = [];
        pointer("pointerdown", 1);
        wait.after(() => ran.push("step"));
        pointer("pointerup", 1);
        wait.stop();
        await nextTask();
        expect(ran).toEqual([]);
        // Each listener it put on the page, taken off it: the very function, under the very event and phase.
        const removed = removes.flatMap((spy) => spy.mock.calls.map(([type, listener, capture]) => [type, listener, capture]));
        expect(removed).toEqual(added);
    });
});

describe("usePressWait", () => {
    test("hears the presses from its part's mount; a step waiting as the part goes never runs", async () => {
        const { result, unmount } = renderHook(() => usePressWait());
        const ran: string[] = [];
        result.current(() => ran.push("at once"));
        pointer("pointerdown", 1);
        result.current(() => ran.push("after"));
        pointer("pointerup", 1);
        await nextTask();
        pointer("pointerdown", 2);
        result.current(() => ran.push("never"));
        unmount();
        pointer("pointerup", 2);
        await nextTask();
        expect(ran).toEqual(["at once", "after"]);
    });
});
