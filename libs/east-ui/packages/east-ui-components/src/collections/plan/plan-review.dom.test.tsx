/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan's review chrome (#569, #880) — the decision column and the batch
 * foot, over the canvas's editing session.
 *
 * The canvas keeps NO verdict of its own: a verdict is a draft of its row's
 * entry, and the pressed button is that drafted data drawn again — so what a
 * decided row looks like always comes back through the data, and a verdict
 * never outlives the draft that made it. What the chrome offers follows what
 * could hold a change: a row whose series names no verdict field only shows
 * one, and a canvas without an editing session takes none.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import {
    PENDING, type PressValue,
    batch, batchButton, decide, history, mountCanvas, pressRow, releaseCanvases, settle, verdictButton, verdictOf,
} from "./plan-editing.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    releaseCanvases();
    localStorage.clear();
});

describe("Plan review chrome (#569, #880)", () => {
    test("no review, no chrome — the column and the foot are simply not there", async () => {
        const { container } = await mountCanvas({ arm: "inline", review: false });
        expect(container.querySelector('[data-slot="decisionHeader"]')).toBeNull();
        expect(container.querySelector('[data-slot="decisionCell"]')).toBeNull();
        expect(container.querySelector('[data-slot="reviewFoot"]')).toBeNull();
    }, 30_000);

    test("the column mounts from `review`, and a verdict names its row BY ID — never an index", async () => {
        const canvas = await mountCanvas({ arm: "inline" });
        const c = canvas.container;
        expect(c.querySelector('[data-slot="decisionHeader"]')!.textContent).toBe("Decision");
        expect(c.querySelectorAll('[data-slot="decisionCell"]')).toHaveLength(3);
        await decide(c, "p2", "approve");
        // The draft is the entry the row came from, by its key: an index would
        // reattach to another press the moment a window landed above it (#577).
        expect(canvas.patches.map((p) => [p.label, p.draftChanges.map((d) => d.id)])).toEqual([["Approve Press 2", ["p2"]]]);
        expect(verdictOf(c, "p2")).toBe("approved");
        expect(verdictOf(c, "p1")).toBe("pending");
    }, 30_000);

    test("without an editing session nothing could hold a verdict — the buttons are disabled and the foot has no batch", async () => {
        const canvas = await mountCanvas({ arm: "inline", editing: false });
        const c = canvas.container;
        expect(verdictButton(c, "p1", "approve").disabled).toBe(true);
        expect(verdictButton(c, "p1", "reject").disabled).toBe(true);
        expect(batchButton(c, "approve")).toBeNull();
        expect(batchButton(c, "reject")).toBeNull();
        // No history bar either: there is nothing to undo or apply.
        expect(c.querySelector('[data-slot="history"]')).toBeNull();
        fireEvent.click(verdictButton(c, "p1", "approve"));
        await settle();
        expect(verdictOf(c, "p1")).toBe("pending");
    }, 30_000);

    test("a row that only SHOWS its verdict draws it pressed, both buttons disabled — and the foot has nothing to batch", async () => {
        const canvas = await mountCanvas({ arm: "inline", verdicts: "shown" });
        const c = canvas.container;
        expect(verdictOf(c, "p3")).toBe("approved");
        expect(verdictButton(c, "p3", "approve").getAttribute("aria-pressed")).toBe("true");
        for (const press of ["p1", "p2", "p3"]) {
            expect(verdictButton(c, press, "approve").disabled).toBe(true);
            expect(verdictButton(c, press, "reject").disabled).toBe(true);
        }
        expect(batchButton(c, "approve")).toBeNull();
        expect(canvas.patches).toEqual([]);
    }, 30_000);

    test("Rerun fires the root's callback — and drafts nothing", async () => {
        const canvas = await mountCanvas({ arm: "inline", rerun: true });
        const c = canvas.container;
        expect(batchButton(c, "rerun")!.textContent).toBe("Rerun");
        await batch(c, "rerun");
        expect(canvas.reruns()).toBe(1);
        expect(canvas.patches).toEqual([]);
    }, 30_000);

    test("a verdict's draft repaints its row and NOTHING else — the selection survives it (#610)", async () => {
        const canvas = await mountCanvas({ arm: "inline" });
        const c = canvas.container;
        fireEvent.click(pressRow(c, "p2"));
        expect(pressRow(c, "p2").hasAttribute("data-selected")).toBe(true);
        await decide(c, "p1", "approve");
        expect(verdictOf(c, "p1")).toBe("approved");
        expect(pressRow(c, "p2").hasAttribute("data-selected")).toBe(true);
        await history(canvas, "Undo");
        expect(pressRow(c, "p2").hasAttribute("data-selected")).toBe(true);
    }, 30_000);

    for (const arm of ["inline", "paged"] as const) {
        test(`${arm}: a row that takes no verdict has no decision cell — and Approve all neither counts nor drafts it`, async () => {
            // Each press twice over: its reviewed row, and a row beside it that takes nothing.
            const canvas = await mountCanvas({ arm, alongside: true });
            const c = canvas.container;
            expect(c.querySelectorAll("[data-plan-row]")).toHaveLength(6);
            expect(c.querySelectorAll('[data-slot="decisionCell"]')).toHaveLength(3);
            expect(batchButton(c, "approve")!.textContent).toBe(arm === "paged" ? "Approve 3 loaded" : "Approve all");
            await batch(c, "approve");
            expect(canvas.patches.map((p) => p.draftChanges.map((d) => d.id).sort())).toEqual([["p1", "p2"]]);
        }, 30_000);
    }

    // 250 presses: a paged canvas holds the first window's 200 while the next
    // is in flight; inline, it holds them all.
    const MANY: ReadonlyMap<string, PressValue> = new Map(Array.from({ length: 250 }, (_u, i) => [
        `p${String(i).padStart(3, "0")}`, { label: `Press ${i}`, approval: PENDING, jobs: [] },
    ] as const));
    for (const arm of ["inline", "paged"] as const) {
        test(`${arm}: Approve all covers the rows the canvas holds — and a paged foot says how many`, async () => {
            const canvas = await mountCanvas({ arm, seed: MANY, heldFrom: 200 });
            const c = canvas.container;
            const held = arm === "paged" ? 200 : 250;
            expect(batchButton(c, "approve")!.textContent).toBe(arm === "paged" ? "Approve 200 loaded" : "Approve all");
            expect(batchButton(c, "reject")!.textContent).toBe(arm === "paged" ? "Reject 200 loaded" : "Reject all");
            await batch(c, "approve");
            // One gesture over every press the canvas holds — no further.
            expect(canvas.patches).toHaveLength(1);
            expect(canvas.patches[0]!.draftChanges).toHaveLength(held);
            expect(verdictOf(c, "p000")).toBe("approved");
            expect(verdictOf(c, "p199")).toBe("approved");
        }, 60_000);
    }
});
