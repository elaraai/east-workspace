/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Every change is a draft (#880) — each dropped job drafts the entry its row
 * came from, drawn where it was made with the Sheet's marks; Undo and Redo
 * through the history bar and the keys; Discard; and Save as ONE checked batch
 * whose drafts retire only once the source reads back what it committed. What
 * the session cannot do says so in the frame's banners, with their Retry and
 * Discard (#1193, PB24). Every test runs inline and paged: the behaviour is
 * the canvas's, whatever the source.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { equalFor, variant } from "@elaraai/east";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { UIStore } from "@elaraai/east-ui-components";
import {
    Presses, SEED, type PressValue,
    banner, bannerAction, dropCellOf, dropJob, history, historyButton, hoverJob, jobsDrawn, key, markOf, marks,
    mountCanvas, releaseCanvases, settle, statusLine, type EditingCanvas,
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
/** The jobs each press draws, as the canvas draws them. */
const jobs = (c: HTMLElement, presses: readonly string[] = ["p1", "p2", "p3"]) => presses.map((p) => jobsDrawn(c, p));
/** A job another writer puts on a press — in the axis's second week. */
const ELSEWHERE = { key: "job-9", at: variant("time", new Date("2026-07-06T00:00:00Z")) };

for (const arm of ["inline", "paged"] as const) {
    describe(`${arm}: every change is a draft (#880)`, () => {
        test("a job dropped on a press drafts that press — drawn and marked pending there, one patch, nothing written", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            expect(dropCellOf(c, "p2")).not.toBeNull();
            await dropJob(canvas, "job-1", "p2");
            // The canvas draws the drafted press: its job, and the pending mark.
            expect(jobsDrawn(c, "p2")).toEqual(["job-1"]);
            expect(marks(c)).toEqual({ p2: "pending" });
            // One gesture, one patch — the press's whole entry drafted.
            expect(labels(canvas)).toEqual(["Drop job-1 on Press 2"]);
            expect(origins(canvas)).toEqual(["drop"]);
            expect(canvas.patches[0]!.draftChanges.map((d) => d.id)).toEqual(["p2"]);
            // A draft: nothing saved, the source as it was.
            expect(canvas.applies).toHaveLength(0);
            expect(canvas.stored().get("p2")!.jobs).toEqual([]);
            expect(samePresses(canvas.stored(), SEED)).toBe(true);
            expect(historyButton(canvas, "Save").disabled).toBe(false);
        }, 30_000);

        test("Undo and Redo walk the gestures — through the history bar and the keys", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await dropJob(canvas, "job-1", "p1");
            await dropJob(canvas, "job-2", "p2");
            expect(jobs(c)).toEqual([["job-1"], ["job-2"], []]);
            await history(canvas, "Undo");
            expect(jobs(c)).toEqual([["job-1"], [], []]);
            expect(marks(c)).toEqual({ p1: "pending" });
            // Ctrl+Z undoes, as ⌘Z does.
            await key(c, { key: "z", ctrlKey: true });
            expect(jobs(c)).toEqual([[], [], []]);
            expect(marks(c)).toEqual({});
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            // Ctrl+Shift+Z and Ctrl+Y redo.
            await key(c, { key: "z", ctrlKey: true, shiftKey: true });
            expect(jobs(c)).toEqual([["job-1"], [], []]);
            await key(c, { key: "y", ctrlKey: true });
            expect(jobs(c)).toEqual([["job-1"], ["job-2"], []]);
            await key(c, { key: "z", metaKey: true });
            expect(jobs(c)).toEqual([["job-1"], [], []]);
            await key(c, { key: "Z", metaKey: true, shiftKey: true });
            expect(jobs(c)).toEqual([["job-1"], ["job-2"], []]);
            await history(canvas, "Undo");
            await history(canvas, "Redo");
            expect(jobs(c)).toEqual([["job-1"], ["job-2"], []]);
            expect(origins(canvas)).toEqual(["drop", "drop", "undo", "undo", "redo", "redo", "undo", "redo", "undo", "redo"]);
            expect(canvas.applies).toHaveLength(0);
            expect(samePresses(canvas.stored(), SEED)).toBe(true);
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
            await dropJob(canvas, "job-1", "p1");
            await dropJob(canvas, "job-2", "p2");
            await history(canvas, "Discard");
            expect(marks(c)).toEqual({});
            expect(jobs(c)).toEqual([[], [], []]);
            expect(origins(canvas)).toEqual(["drop", "drop", "discard"]);
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            expect(historyButton(canvas, "Save").disabled).toBe(true);
            expect(canvas.applies).toHaveLength(0);
        }, 30_000);

        test("Save sends ONE checked batch — and its drafts retire only once the source reads back what it committed", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await dropJob(canvas, "job-1", "p1");
            await dropJob(canvas, "job-2", "p2");
            await history(canvas, "Save");
            // One request for the two gestures, written once.
            expect(canvas.applies).toHaveLength(1);
            expect(canvas.writes()).toBe(1);
            const stored = canvas.stored();
            expect(stored.get("p1")!.jobs.map((j) => j.key)).toEqual(["job-1"]);
            expect(stored.get("p2")!.jobs.map((j) => j.key)).toEqual(["job-2"]);
            // Committed — but not read back yet: the drafts stand.
            expect(statusLine(canvas)).toBe("Saved — loading the confirmed revision…");
            expect(marks(c)).toEqual({ p1: "pending", p2: "pending" });
            await canvas.confirm();
            // Read back: the source's own rows, as the drafts drew them — no longer drafts.
            expect(marks(c)).toEqual({});
            expect(statusLine(canvas)).toBeNull();
            expect(jobs(c)).toEqual([["job-1"], ["job-2"], []]);
            expect(historyButton(canvas, "Save").disabled).toBe(true);
            expect(canvas.applies).toHaveLength(1);
        }, 30_000);

        test("a source that moves under pending drafts refuses them — until they are discarded, from the out-of-date banner", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await dropJob(canvas, "job-1", "p1");
            expect(banner(c, "stale")).toBeNull();
            // Another writer puts a job on Press 2.
            await canvas.move(new Map([...SEED, ["p2", { ...SEED.get("p2")!, jobs: [ELSEWHERE] }]]));
            expect(statusLine(canvas)).toBe("Source changed — review or discard these drafts");
            expect(banner(c, "stale")).not.toBeNull();
            expect(historyButton(canvas, "Save").disabled).toBe(true);
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            // The canvas takes no gesture meanwhile: no press is a drop target.
            expect(dropCellOf(c, "p3")).toBeNull();
            await bannerAction(c, "stale", "discard");
            expect(banner(c, "stale")).toBeNull();
            expect(statusLine(canvas)).toBeNull();
            // The source as it now stands…
            expect(jobs(c)).toEqual([[], ["job-9"], []]);
            expect(marks(c)).toEqual({});
            // …and it takes a gesture again.
            await dropJob(canvas, "job-1", "p1");
            expect(marks(c)).toEqual({ p1: "pending" });
            expect(canvas.applies).toHaveLength(0);
        }, 30_000);

        test("an acknowledgement lost after the write freezes the session — and Retry sends the SAME request, written once", async () => {
            const canvas = await mountCanvas({ arm });
            const c = canvas.container;
            await dropJob(canvas, "job-1", "p1");
            canvas.loseNextAck();
            await history(canvas, "Save");
            // The banner says so, with its Retry; the toolbar keeps one row.
            expect(banner(c, "unknown")!.textContent).toContain("Acknowledgement lost");
            expect(c.querySelector('[data-frame-slot="toolbar"] [role="alert"]')).toBeNull();
            expect(historyButton(canvas, "Undo").disabled).toBe(true);
            expect(historyButton(canvas, "Discard").disabled).toBe(true);
            // The canvas takes no gesture until the answer is known.
            expect(dropCellOf(c, "p2")).toBeNull();
            await bannerAction(c, "unknown", "apply");
            expect(banner(c, "unknown")).toBeNull();
            expect(canvas.queryByRole("alert")).toBeNull();
            expect(canvas.applies).toHaveLength(2);
            expect(canvas.applies[1]).toEqual(canvas.applies[0]);
            expect(canvas.writes()).toBe(1);
            await canvas.confirm();
            expect(marks(c)).toEqual({});
            expect(jobsDrawn(c, "p1")).toEqual(["job-1"]);
        }, 30_000);

        test("the author's check marks the press it refuses — and Save waits for it", async () => {
            const canvas = await mountCanvas({ arm, ready: true });
            const c = canvas.container;
            await dropJob(canvas, "job-1", "p1");
            expect(markOf(c, "p1")).toBe("pending");
            await dropJob(canvas, "job-2", "p1");
            expect(markOf(c, "p1")).toBe("invalid");
            expect(historyButton(canvas, "Save").disabled).toBe(true);
            // Press 2 has no crew: a job there waits for one.
            await dropJob(canvas, "job-1", "p2");
            expect(markOf(c, "p2")).toBe("incomplete");
            expect(historyButton(canvas, "2 issues").disabled).toBe(false);
            await history(canvas, "Undo");
            await history(canvas, "Undo");
            expect(marks(c)).toEqual({ p1: "pending" });
            expect(historyButton(canvas, "Save").disabled).toBe(false);
        }, 30_000);
    });
}

describe("the narrow layout (#880)", () => {
    const realRect = Element.prototype.getBoundingClientRect;
    const realObserver = globalThis.ResizeObserver;
    /** Every ResizeObserver the frame and the canvas made — fired as a browser fires them when their container resizes. */
    const observers = new Set<ResizeObserverProbe>();
    class ResizeObserverProbe {
        constructor(readonly callback: ResizeObserverCallback) {}
        observe(): void { observers.add(this); }
        unobserve(): void {}
        disconnect(): void { observers.delete(this); }
    }
    beforeEach(() => { (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverProbe; });
    afterEach(() => {
        Element.prototype.getBoundingClientRect = realRect;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver;
        observers.clear();
    });

    /** The container narrows to `px`: every element measures it, every observer fires, and the canvas measures again on the next frame. */
    async function narrowTo(px: number): Promise<void> {
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: px, bottom: 600, width: px, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
        await act(async () => {
            for (const ro of [...observers]) ro.callback([], ro as unknown as ResizeObserver);
            await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
        });
        await settle();
    }

    for (const arm of ["inline", "paged"] as const) {
        test(`${arm}: drafts made on the canvas wear their marks on their cards once it narrows — the history item riding the frame's toolbar`, async () => {
            const canvas = await mountCanvas({ arm, ready: true });
            const c = canvas.container;
            expect(c.querySelector("[data-plan-narrow]")).toBeNull();
            await dropJob(canvas, "job-1", "p1");
            // Press 2 has no crew: its job waits for one.
            await dropJob(canvas, "job-2", "p2");
            expect(marks(c)).toEqual({ p1: "pending", p2: "incomplete" });
            await narrowTo(360);
            expect(c.querySelector("[data-plan-narrow]")).toBeTruthy();
            expect(c.querySelector("[data-plan-row]")).toBeNull();
            expect(c.querySelector("[data-frame-slot='toolbar'] [data-slot='history']")).toBeTruthy();
            // Each card wears its press's draft mark, its own refusal among them, as its row did.
            expect(marks(c)).toEqual({ p1: "pending", p2: "incomplete" });
            await history(canvas, "Undo");
            expect(marks(c)).toEqual({ p1: "pending" });
            await history(canvas, "Undo");
            expect(marks(c)).toEqual({});
        }, 30_000);
    }
});
