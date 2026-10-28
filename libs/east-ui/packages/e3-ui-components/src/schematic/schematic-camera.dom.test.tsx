/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What a camera move renders, on e3 itself (#1393, `canvas/CLAUDE.md`
 * invariant 13): no card. The canvas renders a frame at a time as its camera
 * moves — its culling, its tiers, the minimap's box — and each card is a
 * component of its own (`canvas/card.tsx`), told how it stands in values, so a
 * pan renders none whose standing holds; a tap that selects a card renders it
 * again, and no other. A card's renders are counted by a card of the test's own
 * around the real one, which renders whenever the real one would: a memo of
 * the same props; the canvas's, by a Profiler around the example, which hears
 * each commit that renders any of it.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { Profiler } from "react";
import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import type { SchematicCardProps } from "./canvas/card.js";
import { at, card, cameraOf, fitted, layOutCanvas, near, tap } from "./schematic.test-utils.js";
import "./index.js";

/** Each card's renders, by its item's id. */
const renders = vi.hoisted(() => new Map<string, number>());

vi.mock("./canvas/card", async (importOriginal) => {
    const real = await importOriginal<typeof import("./canvas/card.js")>();
    const { createElement, memo } = await import("react");
    return {
        ...real,
        // The real card, its renders counted: a memo of the same props, so it renders exactly when the real one would.
        SchematicCard: memo(function CountedCard(props: SchematicCardProps) {
            renders.set(props.item.key, (renders.get(props.item.key) ?? 0) + 1);
            return createElement(real.SchematicCard, props);
        }),
    };
});

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

const canvasLayout = layOutCanvas();

/** The camera the canvas fits the data centre's floor with, 28 × 14 m. */
const CAM = fitted(28, 14);

/** Longer than a frame: run on the test's clock, a camera move is drawn. */
const FRAME_MS = 20;

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** How many renders the cards have had, all of them. */
const total = () => [...renders.values()].reduce((sum, n) => sum + n, 0);

test("a pan renders no card — the canvas renders as its camera moves — and a tap that selects a card renders it again, and no other (#1393, invariant 13)", async () => {
    // Each commit that renders any of the example: the canvas's, as its camera moves.
    let commits = 0;
    const { container } = await h.mount(ex.schematicDataCentre, {
        host: (example) => <Profiler id="schematic" onRender={() => { commits++; }}>{example}</Profiler>,
    });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")).not.toBeNull());
    await settle();
    const canvas = canvasOf(container);
    const before = cameraOf(container).tx;
    renders.clear();
    commits = 0;
    // A pan of 24 px, every card in view staying in view: six moves, each drawn and committed in a frame of the test's
    // clock, as a page draws them.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        const from = at(CAM, 14.0, 7.0);
        await act(async () => { fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...from }); });
        for (let dx = 4; dx <= 24; dx += 4) {
            await act(async () => {
                fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: from.clientX + dx, clientY: from.clientY });
                vi.advanceTimersByTime(FRAME_MS);
            });
        }
        await act(async () => {
            fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: from.clientX + 24, clientY: from.clientY });
            vi.advanceTimersByTime(FRAME_MS);
        });
    } finally {
        vi.useRealTimers();
    }
    await settle();
    // The camera moved, and the canvas rendered as it did: a commit a frame.
    expect(cameraOf(container).tx).toBeCloseTo(before + 24, 6);
    expect(commits).toBeGreaterThanOrEqual(6);
    // No card rendered: each stood as it did.
    expect(total()).toBe(0);
    // A tap on A05 selects it: its card renders again, and no other.
    canvasLayout.hits((px, py) => (near(cameraOf(container), px, py, 16.8, 2.9) ? card(container, "racks", "A05") : null));
    await tap(canvas, cameraOf(container), 16.8, 2.9);
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")?.hasAttribute("data-selected")).toBe(true));
    expect([...renders.keys()]).toEqual([card(container, "racks", "A05")!.getAttribute("data-card-key")]);
});
