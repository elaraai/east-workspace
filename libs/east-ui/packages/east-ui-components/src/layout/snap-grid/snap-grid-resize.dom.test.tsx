/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A tile's resize is its pointer's (`../../pointer/follow-pointer.ts`, the rule
 * every gesture is held to): the handle's press begins it, that pointer's moves
 * alone snap it, and it ends once — landed by that pointer's release, or let go
 * of, landing nothing, as the browser takes the pointer back, as a mouse moves
 * with its button no longer held, as the window loses the page, and at Esc.
 *
 * - Another pointer's move and lift over the handle neither snap the tile nor
 *   land the resize.
 * - A resize let go of leaves no preview standing, and no later pointer over
 *   the handle resizes the tile.
 * - A resize whose handle goes under it — the host lets go of the selection,
 *   and the handles with it — still ends as its pointer lifts: nothing is left
 *   following a pointer, and no tile is left drawn at a size it does not have.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { layOut } from "../../testing/drag-layer.js";
import { clickTile, key, layRows, mountSnapGrid, selectedTile, settle, spanOf, tileEl, type EditingSnapGrid } from "./snap-grid-editing.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
});

type Sent = "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel";
/** Whether a pointer's button is held as an event of it is sent: from its press, through its moves. */
const held = (type: Sent): number => (type === "pointerDown" || type === "pointerMove" ? 1 : 0);
/** A finger's event, where it lands: on the handle, or wherever the page hears it. */
const finger = (type: Sent, on: Element | Window, pointerId: number, clientX = 0) =>
    act(async () => { fireEvent[type](on, { pointerId, pointerType: "touch", isPrimary: pointerId === 3, button: 0, buttons: held(type), clientX, clientY: 0 }); });
/** A mouse's event. */
const mouse = (type: Sent, on: Element | Window, clientX: number, buttons = held(type)) =>
    act(async () => { fireEvent[type](on, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: type === "pointerMove" ? -1 : 0, buttons, clientX, clientY: 0 }); });

/** The page mounted, the trend selected and its rows laid out: its right-edge handle, a column 100px wide. */
async function open(): Promise<{ canvas: EditingSnapGrid; c: HTMLElement; handle: () => HTMLElement | null }> {
    const canvas = await mountSnapGrid();
    const c = canvas.container;
    await clickTile(c, "trend");
    layOut(layRows(c));
    return { canvas, c, handle: () => tileEl(c, "trend").querySelector<HTMLElement>('[data-handle="span"]') };
}

test("another pointer's move and lift over the handle neither snap the tile nor land the resize; its own pointer's lift lands it, one gesture", async () => {
    const { canvas, c, handle } = await open();
    await finger("pointerDown", handle()!, 3);
    await finger("pointerMove", handle()!, 3, 600);
    expect(spanOf(c, "trend")).toBe(6);
    // Another finger passes over the handle, and lifts there.
    await finger("pointerMove", handle()!, 9, 300);
    await finger("pointerUp", handle()!, 9, 300);
    await settle();
    expect([spanOf(c, "trend"), canvas.patches.length]).toEqual([6, 0]);
    // Its own goes on, and lifts: the resize lands where it stood.
    await finger("pointerMove", handle()!, 3, 500);
    await finger("pointerUp", handle()!, 3, 500);
    await settle();
    expect([spanOf(c, "trend"), canvas.patches.map((p) => p.label)]).toEqual([5, ["Resize Revenue trend"]]);
});

test("a resize is let go of, landing nothing, as the browser takes its pointer back, as a mouse moves with its button no longer held, as the window loses the page and at Esc — the tile drawn as it was, and no later pointer over the handle resizing it", async () => {
    const { canvas, c, handle } = await open();
    const ends: readonly (readonly [string, "finger" | "mouse", () => Promise<void>])[] = [
        ["taken back", "finger", () => finger("pointerCancel", handle()!, 3)],
        ["no button held", "mouse", () => mouse("pointerMove", handle()!, 700, 0)],
        ["the window lost", "finger", () => act(async () => { fireEvent.blur(window); })],
        ["Esc", "mouse", () => key(c, { key: "Escape" }, "trend")],
    ];
    for (const [how, by, end] of ends) {
        if (by === "finger") {
            await finger("pointerDown", handle()!, 3);
            await finger("pointerMove", handle()!, 3, 600);
        } else {
            await mouse("pointerDown", handle()!, 0);
            await mouse("pointerMove", handle()!, 600);
        }
        expect(spanOf(c, "trend"), how).toBe(6);
        await end();
        // Let go: the tile as it was, still selected, nothing recorded.
        expect([spanOf(c, "trend"), selectedTile(c), canvas.patches.length], how).toEqual([8, "trend", 0]);
        // Its pointer's later moves and lift, and another's, resize nothing.
        await finger("pointerMove", handle()!, 3, 300);
        await mouse("pointerMove", handle()!, 300);
        await finger("pointerUp", handle()!, 3, 300);
        await mouse("pointerUp", handle()!, 300);
        await settle();
        expect([spanOf(c, "trend"), canvas.patches.length], how).toEqual([8, 0]);
    }
});

test("a resize whose handle goes under it — the host lets go of the selection — still ends as its pointer lifts: it lands, and no preview is left standing", async () => {
    const { canvas, c, handle } = await open();
    await finger("pointerDown", handle()!, 3);
    await finger("pointerMove", handle()!, 3, 600);
    expect(spanOf(c, "trend")).toBe(6);
    // The host deselects: the tile's handles go, the pressed one among them.
    await canvas.hostSelects(null);
    expect(handle()).toBeNull();
    // The finger lifts, wherever the page hears it: the resize lands, one gesture.
    await finger("pointerUp", window, 3, 600);
    await settle();
    expect([spanOf(c, "trend"), canvas.patches.map((p) => p.label)]).toEqual([6, ["Resize Revenue trend"]]);
    // Undone, the tile is as it was: what it drew was the draft, never a preview left behind.
    await key(c, { key: "z", ctrlKey: true }, "trend");
    expect(spanOf(c, "trend")).toBe(8);
});
