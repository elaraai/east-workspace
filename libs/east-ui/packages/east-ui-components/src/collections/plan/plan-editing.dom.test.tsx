/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Every change is a draft (#880) — a verdict, Approve all and a dropped job
 * each draft the entry their row came from, drawn where they were made with
 * the Sheet's marks; Undo and Redo through the history bar and the keys;
 * Discard; and Apply as ONE checked batch whose drafts retire only once the
 * source reads back what it committed. Every test runs inline and paged: the
 * behaviour is the canvas's, whatever the source.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { equalFor } from "@elaraai/east";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import {
    APPROVED, Presses, SEED, type PressValue,
    batch, decide, dropCellOf, dropJob, history, historyButton, hoverJob, jobsDrawn, key, markOf, marks, mountCanvas,
    releaseCanvases, statusLine, verdictButton, verdictOf, type EditingCanvas,
} from "./plan-editing.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    releaseCanvases();
    localStorage.clear();
});

const pressesEqual = equalFor(Presses);
/** Whether two sets of presses hold the same — East's equality over them. */
const samePresses = (a: ReadonlyMap<string, PressValue>, b: ReadonlyMap<string, PressValue>) => pressesEqual(new Map(a), new Map(b));
/** What each gesture was, in order. */
const origins = (canvas: EditingCanvas) => canvas.patches.map((p) => p.origin.type);
/** Each gesture's label, in order. */
const labels = (canvas: EditingCanvas) => canvas.patches.map((p) => p.label);
/** Each press's verdict, as the canvas draws it. */
const verdicts = (c: HTMLElement, presses: readonly string[] = ["p1", "p2", "p3"]) => presses.map((p) => verdictOf(c, p));

for (const arm of ["inline", "paged"] as const) {
    describe(`${arm}: every change is a draft (#880)`, () => {
        test("Approve drafts the press it was made on — pressed and pending there, one patch, nothing written", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            expect(verdictOf(c, "p1")).toBe("pending");
            expect(verdictButton(c, "p1", "approve").disabled).toBe(false);
            await decide(c, "p1", "approve");
            // The canvas draws the drafted press: its verdict, pressed, and the pending mark.
            expect(verdictOf(c, "p1")).toBe("approved");
            expect(verdictButton(c, "p1", "approve").getAttribute("aria-pressed")).toBe("true");
            expect(marks(c)).toEqual({ p1: "pending" });
            // One gesture, one patch — the press's whole entry drafted.
            expect(labels(canvas)).toEqual(["Approve Press 1"]);
            expect(origins(canvas)).toEqual(["verdict"]);
            expect(canvas.patches[0]!.draftChanges.map((d) => d.id)).toEqual(["p1"]);
            // A draft: nothing applied, the source as it was.
            expect(canvas.applies).toHaveLength(0);
            expect(samePresses(canvas.stored(), SEED)).toBe(true);
            expect(historyButton(canvas, "Apply changes").disabled).toBe(false);
        }, 30_000);

        test("Undo and Redo walk the gestures — through the history bar and the keys", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await decide(c, "p1", "approve");
            await decide(c, "p2", "reject");
            expect(verdicts(c)).toEqual(["approved", "rejected", "approved"]);
            await history(canvas, "Undo");
            expect(verdicts(c)).toEqual(["approved", "pending", "approved"]);
            expect(marks(c)).toEqual({ p1: "pending" });
            // Ctrl+Z undoes, as ⌘Z does.
            await key(c, { key: "z", ctrlKey: true });
            expect(verdicts(c)).toEqual(["pending", "pending", "approved"]);
            expect(marks(c)).toEqual({});
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            // Ctrl+Shift+Z and Ctrl+Y redo.
            await key(c, { key: "z", ctrlKey: true, shiftKey: true });
            expect(verdicts(c)).toEqual(["approved", "pending", "approved"]);
            await key(c, { key: "y", ctrlKey: true });
            expect(verdicts(c)).toEqual(["approved", "rejected", "approved"]);
            await key(c, { key: "z", metaKey: true });
            expect(verdicts(c)).toEqual(["approved", "pending", "approved"]);
            await key(c, { key: "Z", metaKey: true, shiftKey: true });
            expect(verdicts(c)).toEqual(["approved", "rejected", "approved"]);
            await history(canvas, "Undo");
            await history(canvas, "Redo");
            expect(verdicts(c)).toEqual(["approved", "rejected", "approved"]);
            expect(origins(canvas)).toEqual(["verdict", "verdict", "undo", "undo", "redo", "redo", "undo", "redo", "undo", "redo"]);
            expect(canvas.applies).toHaveLength(0);
            expect(samePresses(canvas.stored(), SEED)).toBe(true);
        }, 30_000);

        test("Approve all is ONE gesture over every row that takes a verdict — and one Undo takes it all back", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await batch(c, "approve");
            expect(verdicts(c)).toEqual(["approved", "approved", "approved"]);
            // Press 3 was approved already: its draft changes nothing it draws.
            expect(marks(c)).toEqual({ p1: "pending", p2: "pending" });
            expect(labels(canvas)).toEqual(["Approve all"]);
            expect(canvas.patches[0]!.draftChanges.map((d) => d.id).sort()).toEqual(["p1", "p2"]);
            await history(canvas, "Undo");
            expect(verdicts(c)).toEqual(["pending", "pending", "approved"]);
            expect(marks(c)).toEqual({});
            await batch(c, "reject");
            expect(verdicts(c)).toEqual(["rejected", "rejected", "rejected"]);
            expect(marks(c)).toEqual({ p1: "pending", p2: "pending", p3: "pending" });
            expect(labels(canvas)).toEqual(["Approve all", "Undo Approve all", "Reject all"]);
        }, 30_000);

        test("a job dropped on a press is a draft — it joins the press where it landed", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            expect(dropCellOf(c, "p2")).not.toBeNull();
            await dropJob(canvas, "job-1", "p2");
            expect(jobsDrawn(c, "p2")).toEqual(["job-1"]);
            expect(marks(c)).toEqual({ p2: "pending" });
            expect(labels(canvas)).toEqual(["Drop job-1 on Press 2"]);
            expect(origins(canvas)).toEqual(["drop"]);
            expect(canvas.stored().get("p2")!.jobs).toEqual([]);
            await key(c, { key: "z", ctrlKey: true });
            expect(jobsDrawn(c, "p2")).toEqual([]);
            expect(marks(c)).toEqual({});
        }, 30_000);

        test("canDrop refuses before a draft — the refused press shows ⊘, and nothing is drafted", async () => {
            const canvas = await mountCanvas({ arm, onlyPress1: true });
            const c = canvas.container;
            const letGo = await hoverJob(canvas, "job-1", "p2");
            expect(dropCellOf(c, "p2")!.hasAttribute("data-drop-invalid")).toBe(true);
            await letGo();
            expect(canvas.patches).toHaveLength(0);
            expect(marks(c)).toEqual({});
            expect(jobsDrawn(c, "p2")).toEqual([]);
            // The press it admits takes the job.
            await dropJob(canvas, "job-1", "p1");
            expect(jobsDrawn(c, "p1")).toEqual(["job-1"]);
            expect(labels(canvas)).toEqual(["Drop job-1 on Press 1"]);
        }, 30_000);

        test("Discard drops every draft at once, and the history with them", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await decide(c, "p1", "approve");
            await dropJob(canvas, "job-1", "p2");
            await history(canvas, "Discard");
            expect(marks(c)).toEqual({});
            expect(verdictOf(c, "p1")).toBe("pending");
            expect(jobsDrawn(c, "p2")).toEqual([]);
            expect(origins(canvas)).toEqual(["verdict", "drop", "discard"]);
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
            expect(canvas.applies).toHaveLength(0);
        }, 30_000);

        test("Apply sends ONE checked batch — and its drafts retire only once the source reads back what it committed", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await decide(c, "p1", "approve");
            await decide(c, "p2", "reject");
            await dropJob(canvas, "job-1", "p1");
            await history(canvas, "Apply changes");
            // One request for the three gestures, written once.
            expect(canvas.applies).toHaveLength(1);
            expect(canvas.writes()).toBe(1);
            const stored = canvas.stored();
            expect(stored.get("p1")!.approval.type).toBe("approved");
            expect(stored.get("p1")!.jobs.map((j) => j.key)).toEqual(["job-1"]);
            expect(stored.get("p2")!.approval.type).toBe("rejected");
            // Committed — but not read back yet: the drafts stand.
            expect(statusLine(canvas)).toBe("Applied — loading the confirmed revision…");
            expect(marks(c)).toEqual({ p1: "pending", p2: "pending" });
            await canvas.confirm();
            // Read back: the source's own rows, as the drafts drew them — no longer drafts.
            expect(marks(c)).toEqual({});
            expect(statusLine(canvas)).toBeNull();
            expect(verdicts(c)).toEqual(["approved", "rejected", "approved"]);
            expect(jobsDrawn(c, "p1")).toEqual(["job-1"]);
            expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
            expect(canvas.applies).toHaveLength(1);
        }, 30_000);

        test("a source that moves under pending drafts refuses them — until they are discarded", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await decide(c, "p1", "approve");
            // Another writer approves Press 2.
            await canvas.move(new Map([...SEED, ["p2", { ...SEED.get("p2")!, approval: APPROVED }]]));
            expect(statusLine(canvas)).toBe("Source changed — review or discard these drafts");
            expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            expect(verdictButton(c, "p2", "reject").disabled).toBe(true);
            await history(canvas, "Discard");
            expect(statusLine(canvas)).toBeNull();
            // The source as it now stands…
            expect(verdicts(c)).toEqual(["pending", "approved", "approved"]);
            expect(marks(c)).toEqual({});
            // …and it takes a gesture again.
            await decide(c, "p1", "approve");
            expect(marks(c)).toEqual({ p1: "pending" });
            expect(canvas.applies).toHaveLength(0);
        }, 30_000);

        test("an acknowledgement lost after the write freezes the session — and Retry sends the SAME request, written once", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await decide(c, "p1", "approve");
            canvas.loseNextAck();
            await history(canvas, "Apply changes");
            expect(canvas.getByRole("alert").textContent).toBe("Acknowledgement lost");
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            expect(historyButton(canvas, "Discard").disabled).toBe(true);
            expect(verdictButton(c, "p2", "approve").disabled).toBe(true);
            await history(canvas, "Retry request");
            expect(canvas.queryByRole("alert")).toBeNull();
            expect(canvas.applies).toHaveLength(2);
            expect(canvas.applies[1]).toEqual(canvas.applies[0]);
            expect(canvas.writes()).toBe(1);
            await canvas.confirm();
            expect(marks(c)).toEqual({});
            expect(verdictOf(c, "p1")).toBe("approved");
        }, 30_000);

        test("the author's check marks the press it refuses — and Apply waits for it", async () => {
            const canvas = await mountCanvas({ arm, ready: true });
            const c = canvas.container;
            await dropJob(canvas, "job-1", "p1");
            expect(markOf(c, "p1")).toBe("pending");
            await dropJob(canvas, "job-2", "p1");
            expect(markOf(c, "p1")).toBe("invalid");
            expect(historyButton(canvas, "Apply changes").disabled).toBe(true);
            await decide(c, "p2", "reject");
            expect(markOf(c, "p2")).toBe("incomplete");
            expect(historyButton(canvas, "2 issues").disabled).toBe(false);
            await history(canvas, "Undo");
            await history(canvas, "Undo");
            expect(marks(c)).toEqual({ p1: "pending" });
            expect(historyButton(canvas, "Apply changes").disabled).toBe(false);
        }, 30_000);
    });
}

describe("the narrow layout (#880)", () => {
    const realRect = Element.prototype.getBoundingClientRect;
    beforeEach(() => {
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: 360, bottom: 600, width: 360, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
    });
    afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });

    for (const arm of ["inline", "paged"] as const) {
        test(`${arm}: the history bar rides the chips, and a card's verdict is a draft marked on its card`, async () => {
            const canvas = await mountCanvas({ arm, ready: true });
            const c = canvas.container;
            expect(c.querySelector("[data-plan-narrow]")).toBeTruthy();
            expect(c.querySelector("[data-slot='narrowChips'] [data-slot='history']")).toBeTruthy();
            await decide(c, "p1", "approve");
            expect(verdictButton(c, "p1", "approve").getAttribute("aria-pressed")).toBe("true");
            expect(labels(canvas)).toEqual(["Approve Press 1"]);
            expect(marks(c)).toEqual({ p1: "pending" });
            // A card wears its entry's own refusal, as a row does.
            await decide(c, "p2", "reject");
            expect(marks(c)).toEqual({ p1: "pending", p2: "incomplete" });
            await history(canvas, "Undo");
            await history(canvas, "Undo");
            expect(verdictButton(c, "p1", "approve").getAttribute("aria-pressed")).toBe("false");
            expect(marks(c)).toEqual({});
        }, 30_000);
    }
});
