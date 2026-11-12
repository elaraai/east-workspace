/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A surface's handlers (`surface.ts`): its element's pointer events reach the
 * one rule its gestures are held to (`gestures.ts`, every order of whose events
 * `gestures.test.ts` walks). What is held here is the wiring: which presses the
 * surface takes, that it captures every pointer it takes, that a pointer taken
 * back and a capture lost each let go, that the window is listened to only
 * while the surface holds a pointer, that the host is read as each event
 * arrives, and that a surface inside another keeps the events of its own
 * pointers.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useSurfaceGestures, type SurfaceOptions } from "./surface.js";

/** Each pointer captured, by the surface that captured it, in order. */
const captured: string[] = [];

beforeEach(() => {
    captured.length = 0;
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
        configurable: true,
        value(this: HTMLElement, pointerId: number) { captured.push(`${this.dataset["surface"]}:${pointerId}`); },
    });
});

afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture;
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
});

/** A surface that keeps what its gestures do, each call with where its event stood. */
function Surface({ name = "s", heard, options, says = "", children }: {
    name?: string; heard: string[]; options?: SurfaceOptions; says?: string; children?: ReactNode;
}) {
    const handlers = useSurfaceGestures({
        press: (event) => { heard.push(`${says}press ${event.clientX}`); },
        drag: (event) => { heard.push(`${says}drag ${event.clientX}`); },
        release: (event) => { heard.push(`${says}release ${event.clientX}`); },
        drop: () => { heard.push(`${says}drop`); },
        hover: (event) => { heard.push(`${says}hover ${event.clientX}`); },
        pinchStart: () => { heard.push(`${says}pinchStart`); },
        pinch: (step) => { heard.push(`${says}pinch ×${step.factor.toFixed(2)}`); },
        pinchEnd: () => { heard.push(`${says}pinchEnd`); },
    }, options);
    return <div data-surface={name} {...handlers}>{children}</div>;
}

type Sent = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel" | "lostPointerCapture";

/** A mouse's event on an element: its primary button held but as it lifts, unless told. */
function mouse(type: Sent, on: Element, clientX: number, init: PointerEventInit = {}): void {
    act(() => {
        fireEvent[type](on, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerDown" || type === "pointerMove" ? 1 : 0, clientX, bubbles: true, ...init });
    });
}

/** A finger's event on an element. */
function finger(type: Sent, on: Element, pointerId: number, clientX: number, isPrimary = false): void {
    act(() => {
        fireEvent[type](on, { pointerId, pointerType: "touch", isPrimary, button: 0, buttons: type === "pointerDown" || type === "pointerMove" ? 1 : 0, clientX, bubbles: true });
    });
}

const surface = (container: HTMLElement, name = "s"): HTMLElement => container.querySelector<HTMLElement>(`[data-surface="${name}"]`)!;

/** The window's and the document's listeners for the page being lost, as a surface adds and removes them. */
function watched(): () => number {
    const adds = [vi.spyOn(window, "addEventListener"), vi.spyOn(document, "addEventListener")];
    const removes = [vi.spyOn(window, "removeEventListener"), vi.spyOn(document, "removeEventListener")];
    const count = (spies: typeof adds): number => spies.reduce((n, spy) => n + spy.mock.calls.filter(([type]) => type === "blur" || type === "visibilitychange").length, 0);
    return () => count(adds) - count(removes);
}

describe("useSurfaceGestures", () => {
    test("its element's events are its gestures': a move at rest hovers, a press begins a gesture its moves drag and its release lands, each handed the event that brought it — and the pointer it takes it captures", () => {
        const heard: string[] = [];
        const { container } = render(<Surface heard={heard} />);
        const el = surface(container);
        mouse("pointerMove", el, 5, { buttons: 0 });
        mouse("pointerDown", el, 10);
        mouse("pointerMove", el, 30);
        mouse("pointerUp", el, 40);
        mouse("lostPointerCapture", el, 40);
        mouse("pointerMove", el, 50, { buttons: 0 });
        expect(heard).toEqual(["hover 5", "press 10", "drag 30", "release 40", "hover 50"]);
        expect(captured).toEqual(["s:1"]);
    });

    test("a press of another button, and one it does not accept, are left to what they landed on: not captured, and nothing of them the surface's", () => {
        const heard: string[] = [];
        const { container } = render(
            <Surface heard={heard} options={{ accepts: (event) => (event.target as Element).closest("button") === null }}>
                <button type="button">Retry</button>
            </Surface>);
        const el = surface(container);
        // The secondary button.
        mouse("pointerDown", el, 10, { button: 2, buttons: 2 });
        mouse("pointerUp", el, 10, { button: 2 });
        // A press on its own button.
        const button = container.querySelector("button")!;
        mouse("pointerDown", button, 20);
        mouse("pointerUp", button, 20);
        expect(heard.filter((call) => !call.startsWith("hover"))).toEqual([]);
        expect(captured).toEqual([]);
        // And one it accepts, after.
        mouse("pointerDown", el, 30);
        expect([heard.filter((call) => !call.startsWith("hover")), captured]).toEqual([["press 30"], ["s:1"]]);
    });

    test("a surface told to capture none takes its pointers all the same — their events reaching it through what they landed on — and captures nothing, so a child's tap stays the child's", () => {
        const heard: string[] = [];
        const { container } = render(
            <Surface heard={heard} options={{ accepts: (event) => event.pointerType === "touch", capture: false }}>
                <button type="button">Open</button>
            </Surface>);
        const el = surface(container), card = container.querySelector("button")!;
        // Two fingers, the second on a card of the list: a pinch, each finger's events bubbling to the surface.
        finger("pointerDown", el, 11, 0, true);
        finger("pointerDown", card, 12, 100);
        finger("pointerMove", card, 12, 200);
        finger("pointerUp", card, 12, 200);
        finger("pointerUp", el, 11, 0);
        // A mouse is not the surface's: its press on the card is the card's alone.
        mouse("pointerDown", card, 50);
        mouse("pointerUp", card, 50);
        expect(heard.filter((call) => !call.startsWith("hover"))).toEqual(["press 0", "drop", "pinchStart", "pinch ×2.00", "pinchEnd"]);
        expect(captured).toEqual([]);
    });

    test("a pointer the browser takes back, a capture the surface loses and a mouse moved with its button no longer held each let go of the gesture, landing nothing", () => {
        for (const [how, end] of [
            ["taken back", (el: Element) => mouse("pointerCancel", el, 20)],
            ["capture lost", (el: Element) => mouse("lostPointerCapture", el, 20)],
            ["no button held", (el: Element) => mouse("pointerMove", el, 20, { buttons: 0 })],
        ] as const) {
            const heard: string[] = [];
            const { container, unmount } = render(<Surface heard={heard} />);
            const el = surface(container);
            mouse("pointerDown", el, 10);
            end(el);
            // Its release, heard after all, lands nothing.
            mouse("pointerUp", el, 20);
            expect(heard.filter((call) => !call.startsWith("hover")), how).toEqual(["press 10", "drop"]);
            unmount();
        }
    });

    test("two fingers pinch — each captured, what the first began let go of — and the pinch is over as one lifts; a finger whose end is never heard is let go of as the page's next first finger lands", () => {
        const heard: string[] = [];
        const { container } = render(<Surface heard={heard} />);
        const el = surface(container);
        finger("pointerDown", el, 11, 0, true);
        finger("pointerDown", el, 12, 100);
        finger("pointerMove", el, 12, 200);
        finger("pointerUp", el, 12, 200);
        // The first finger's lift is never heard. The next finger is the page's first: a press, never a pinch.
        finger("pointerDown", el, 13, 50, true);
        finger("pointerMove", el, 13, 70);
        finger("pointerUp", el, 13, 70);
        expect(heard).toEqual(["press 0", "drop", "pinchStart", "pinch ×2.00", "pinchEnd", "press 50", "drag 70", "release 70"]);
        expect(captured).toEqual(["s:11", "s:12", "s:13"]);
    });

    test("the window losing the page — blurred, or hidden — lets go of what the surface holds; and the window is listened to only while it holds a pointer", () => {
        const listening = watched();
        const heard: string[] = [];
        const { container, unmount } = render(<Surface heard={heard} />);
        const el = surface(container);
        expect(listening()).toBe(0);
        mouse("pointerMove", el, 5, { buttons: 0 });
        expect(listening()).toBe(0);
        // Held: listened to, once however many events arrive.
        mouse("pointerDown", el, 10);
        mouse("pointerMove", el, 20);
        expect(listening()).toBe(2);
        act(() => { window.dispatchEvent(new Event("blur")); });
        expect([heard.filter((call) => !call.startsWith("hover")), listening()]).toEqual([["press 10", "drag 20", "drop"], 0]);
        // Released: let go of.
        mouse("pointerDown", el, 30);
        expect(listening()).toBe(2);
        mouse("pointerUp", el, 30);
        expect(listening()).toBe(0);
        // Hidden, with two fingers down: both gone, the pinch over.
        finger("pointerDown", el, 11, 0, true);
        finger("pointerDown", el, 12, 100);
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        act(() => { document.dispatchEvent(new Event("visibilitychange")); });
        expect([heard.slice(-4), listening()]).toEqual([["press 0", "drop", "pinchStart", "pinchEnd"], 0]);
        // Gone mid-gesture: nothing of it is left listening.
        mouse("pointerDown", el, 40);
        expect(listening()).toBe(2);
        unmount();
        expect(listening()).toBe(0);
    });

    test("the host is read as each event arrives: rendered again mid-gesture, the surface answers with what it was last given — through the same handlers", () => {
        const heard: string[] = [];
        const seen: unknown[] = [];
        function Probe({ says }: { says: string }) {
            const handlers = useSurfaceGestures({
                press: () => { heard.push(`${says} press`); },
                drag: () => { heard.push(`${says} drag`); },
                release: () => { heard.push(`${says} release`); },
                drop: () => { heard.push(`${says} drop`); },
            });
            seen.push(handlers.onPointerDown, handlers.onPointerMove, handlers.onPointerUp, handlers.onPointerCancel, handlers.onLostPointerCapture);
            return <div data-surface="s" {...handlers} />;
        }
        const { container, rerender } = render(<Probe says="first" />);
        const el = surface(container);
        mouse("pointerDown", el, 10);
        rerender(<Probe says="second" />);
        mouse("pointerMove", el, 20);
        mouse("pointerUp", el, 20);
        expect(heard).toEqual(["first press", "second drag", "second release"]);
        expect(new Set(seen).size).toBe(5);
    });

    test("a surface inside another keeps the events of the pointers it holds, and those of no pointer of its go on to the outer one", () => {
        const heard: string[] = [];
        const { container } = render(
            <Surface name="outer" heard={heard} says="outer ">
                <Surface name="inner" heard={heard} says="inner " options={{ contained: true }} />
            </Surface>);
        const inner = surface(container, "inner"), outer = surface(container, "outer");
        // A move over the inner one at rest hovers both: the outer one says what is under its pointer.
        mouse("pointerMove", inner, 5, { buttons: 0 });
        expect(heard.splice(0)).toEqual(["inner hover 5", "outer hover 5"]);
        // Its press, drags and release are its alone.
        mouse("pointerDown", inner, 10);
        mouse("pointerMove", inner, 20);
        mouse("pointerUp", inner, 30);
        expect([heard.splice(0), captured]).toEqual([["inner press 10", "inner drag 20", "inner release 30"], ["inner:1"]]);
        // A finger of the outer one's, moving over the inner one, is the outer one's still.
        finger("pointerDown", outer, 11, 100, true);
        finger("pointerMove", inner, 11, 120);
        finger("pointerUp", inner, 11, 120);
        expect(heard.filter((call) => call.startsWith("outer"))).toEqual(["outer press 100", "outer drag 120", "outer release 120"]);
    });
});
