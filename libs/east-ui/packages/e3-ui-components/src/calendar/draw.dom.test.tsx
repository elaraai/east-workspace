/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A new event drawn on a day's lane of the time grid, on e3 itself (the
 * operations calendar): a press off an event, dragged, draws a span, and the
 * pressing pointer's release creates an event there — one step of the history.
 * The lane is a surface of the shared pointer core (east-ui-components'
 * `src/pointer/`, `useSurfaceGestures`), so the draw is its pointer's:
 *
 * - another pointer's lift creates nothing and ends nothing — the draw goes on,
 *   and its own pointer's lift creates its event;
 * - a second finger put down lets go of it, and nothing is created as the
 *   fingers lift;
 * - the browser taking the pointer back, the lane losing its capture, a mouse
 *   moved with its button no longer held and the window losing the page each
 *   let go of it, and a release heard after all creates nothing.
 *
 * jsdom lays nothing out: a lane is given a day 1152px tall, 48px an hour.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { act, calendarHarness, settle } from "./harness.test-utils.js";

const h = calendarHarness();
/** An hour of a lane, as the test lays it out. */
const HOUR = 48;

beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
});
afterEach(() => {
    delete (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture;
});

/** Lays each lane out as a browser does — a day 24 hours tall — over the harness's measures, which go with the test. */
function layOutLanes(): void {
    const rect = vi.mocked(Element.prototype.getBoundingClientRect);
    const measured = rect.getMockImplementation();
    if (measured === undefined) throw new Error("the lanes are laid out over the harness's measures: the harness measures nothing");
    rect.mockImplementation(function (this: Element) {
        return this.hasAttribute("data-calendar-cell") ? { x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 24 * HOUR, width: 120, height: 24 * HOUR, toJSON() {} } : measured.call(this);
    });
}

/** The time grid's lanes, a day each. */
const lanes = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-time-grid] [data-calendar-cell]")];
/** The events the board draws from a draft: those made here, still to save. */
const drafted = (c: HTMLElement): number => c.querySelectorAll("[data-calendar-event][data-drafted]").length;
/** Whether a lane shows a span being drawn. */
const drawing = (lane: HTMLElement): boolean => lane.querySelector("[data-calendar-draw]") !== null;
/** An hour of the day, as a point down a lane. */
const at = (hour: number): number => hour * HOUR;

type Sent = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel" | "lostPointerCapture";
/** Whether a pointer's button is held as an event of it is sent: from its press, through its moves. */
const held = (type: Sent): number => (type === "pointerDown" || type === "pointerMove" ? 1 : 0);
/** A finger's event on a lane, at a point down it. */
const finger = (type: Sent, lane: Element, pointerId: number, clientY: number, isPrimary = false) =>
    act(async () => { fireEvent[type](lane, { pointerId, pointerType: "touch", isPrimary, button: 0, buttons: held(type), clientX: 60, clientY, bubbles: true }); });
/** A mouse's event on a lane, at a point down it. */
const mouse = (type: Sent, lane: Element, clientY: number, buttons = held(type)) =>
    act(async () => { fireEvent[type](lane, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: 60, clientY, bubbles: true }); });

/** The operations calendar mounted, its week's lanes laid out. */
async function open(): Promise<{ c: HTMLElement; lane: HTMLElement }> {
    const { container: c } = await h.mount(ex.calendarOperations, { storageKey: "calendar-draw" });
    await waitFor(() => expect(lanes(c).length).toBeGreaterThan(0));
    await settle();
    layOutLanes();
    return { c, lane: lanes(c)[1]! };
}

test("a span drawn on a lane is created as the finger that drew it lifts — never as another pointer lifts over it, which neither creates nor ends anything", async () => {
    const { c, lane } = await open();
    expect([drafted(c), drawing(lane)]).toEqual([0, false]);
    await finger("pointerDown", lane, 11, at(14), true);
    // A press alone draws nothing.
    expect(drawing(lane)).toBe(false);
    await finger("pointerMove", lane, 11, at(15));
    expect(drawing(lane)).toBe(true);
    // Another finger, pressed elsewhere on the page, moves and lifts over the lane; so does a mouse.
    await finger("pointerMove", lane, 12, at(20));
    await finger("pointerUp", lane, 12, at(20));
    await mouse("pointerMove", lane, at(21), 0);
    await mouse("pointerUp", lane, at(21));
    await settle();
    expect([drafted(c), drawing(lane)]).toEqual([0, true]);
    // The finger that drew it lifts: its event is made, one step of the history.
    await finger("pointerUp", lane, 11, at(15));
    await settle();
    expect([drafted(c), drawing(lane)]).toEqual([1, false]);
});

test("a draw is let go of, creating nothing, as a second finger lands, as the browser takes its pointer back, as the lane loses its capture, as a mouse moves with its button no longer held and as the window loses the page — and a release heard after all creates nothing", async () => {
    const { c, lane } = await open();
    const ends: readonly (readonly [string, "finger" | "mouse", () => Promise<void>])[] = [
        ["a second finger", "finger", () => finger("pointerDown", lane, 12, at(18))],
        ["taken back", "finger", () => finger("pointerCancel", lane, 11, at(15))],
        ["capture lost", "finger", () => finger("lostPointerCapture", lane, 11, at(15))],
        ["no button held", "mouse", () => mouse("pointerMove", lane, at(16), 0)],
        ["the window lost", "mouse", () => act(async () => { fireEvent.blur(window); })],
    ];
    for (const [how, by, end] of ends) {
        if (by === "finger") {
            await finger("pointerDown", lane, 11, at(14), true);
            await finger("pointerMove", lane, 11, at(15));
        } else {
            await mouse("pointerDown", lane, at(14));
            await mouse("pointerMove", lane, at(15));
        }
        expect(drawing(lane), how).toBe(true);
        await end();
        expect([drafted(c), drawing(lane)], how).toEqual([0, false]);
        // Every pointer lifts, heard after all: nothing is made.
        await finger("pointerUp", lane, 12, at(18));
        if (by === "finger") await finger("pointerUp", lane, 11, at(15)); else await mouse("pointerUp", lane, at(15));
        await settle();
        expect([drafted(c), drawing(lane)], how).toEqual([0, false]);
    }
    // And the lane draws again after each: a mouse's span, created as its button lifts.
    await mouse("pointerDown", lane, at(14));
    await mouse("pointerMove", lane, at(15));
    await mouse("pointerUp", lane, at(15));
    await settle();
    expect([drafted(c), drawing(lane)]).toEqual([1, false]);
});
