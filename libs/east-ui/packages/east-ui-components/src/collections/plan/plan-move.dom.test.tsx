/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Moving and resizing (#825) — a run, a chip or a tile picked up by the
 * pointer or the keyboard is a gesture of the editing session (#880): it moves
 * by whole weeks from where it was grabbed (Shift: by days), an end handle
 * resizes it, it reaches rows of its own item type and no other, `canDrop`
 * refuses it before anything is drafted, and Undo, Redo, Discard and Apply
 * treat it as any other draft.
 *
 * Pointer geometry is laid out in jsdom (`layOutPlots`): every row's plot
 * spans twelve weeks, 100px each.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { equalFor, variant } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { announced, layOut } from "../../dnd/dnd.test-utils.js";
import { rowSel } from "./plan.test-utils.js";
import {
    MARKS, PENDING, history, historyButton, mountCanvas, releaseCanvases, type PressValue,
} from "./plan-editing.test-utils.js";
import {
    D, Job, SEED, W,
    carry, carrySaid, dragTo, elementOf, keyOn, keysOf, layOutPlots, markOf, mountMoves, plotOf, xAt,
    type JobValue, type MoveCanvas,
} from "./plan-move.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    releaseCanvases();
    localStorage.clear();
    vi.restoreAllMocks();
});

const sameJob = equalFor(Job);
const sameInstant = equalFor(Plan.Types.Instant);
/** Each gesture's origin and label, in order. */
const gestures = (canvas: MoveCanvas) => canvas.patches.map((p) => [p.origin.type, p.label]);
/** The job a machine's list holds, as the source stores it. */
const storedJobs = (canvas: MoveCanvas, machine: string, list: "jobs" | "backlog" = "jobs"): JobValue[] => [...canvas.stored().get(machine)![list]];
/** An element's left edge, as a window fraction. */
const fracOf = (el: HTMLElement | null) => el?.getAttribute("data-plan-frac");

describe("the pointer moves a run, a chip and a tile (#825)", () => {
    test("a run dragged along its row moves by whole weeks from the one it was grabbed in — drawn at once, one gesture, applied as a batch", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        const bar = elementOf(c, "jobs", "m1", "j1")!;
        expect(bar.hasAttribute("data-draggable")).toBe(true);
        // J1 spans W28–W30. Grabbed late in W28, let go early in W30: two weeks.
        await dragTo(bar, { x: xAt(28, 6), y: y("jobs", "m1") }, { x: xAt(30, 1), y: y("jobs", "m1") });
        // Drawn where it was made: two weeks on (W30 is 3/12 of the window), marked.
        expect(fracOf(elementOf(c, "jobs", "m1", "j1"))).toBe("0.2500");
        expect(markOf(c, "jobs", "m1")).toBe("pending");
        expect(gestures(canvas)).toEqual([["move", "Move J1"]]);
        // A draft: nothing written until Apply.
        expect(sameJob(storedJobs(canvas, "m1")[0]!, { key: "j1", label: "J1", start: W(28), end: W(30) })).toBe(true);
        await history(canvas, "Apply changes");
        expect(sameJob(storedJobs(canvas, "m1")[0]!, { key: "j1", label: "J1", start: W(30), end: W(32) })).toBe(true);
    }, 30_000);

    test("a run let go in the week it was grabbed in moved nowhere — said as not dropped, and nothing drafted", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        // Grabbed early in W28, let go late in W28: no whole week.
        await dragTo(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28, 1), y: y("jobs", "m1") }, { x: xAt(28, 5), y: y("jobs", "m1") });
        expect(announced()).toBe("J1 was not dropped.");
        expect(canvas.patches).toEqual([]);
        expect(markOf(c, "jobs", "m1")).toBeUndefined();
    }, 30_000);

    test("with Shift held it moves by days — the finer unit under a week", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        const bar = elementOf(c, "jobs", "m1", "j1")!;
        // Grabbed on Monday of W28, let go on its Thursday: three days.
        await dragTo(bar, { x: xAt(28, 0.5), y: y("jobs", "m1") }, { x: xAt(28, 3.5), y: y("jobs", "m1") }, true);
        await history(canvas, "Apply changes");
        expect(sameJob(storedJobs(canvas, "m1")[0]!, { key: "j1", label: "J1", start: D(28, 3), end: D(30, 3) })).toBe(true);
    }, 30_000);

    test("an end handle resizes — the end by whole weeks, the start never past the end's last week", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        const end = elementOf(c, "jobs", "m1", "j1")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!;
        await dragTo(end, { x: xAt(29, 6.5), y: y("jobs", "m1") }, { x: xAt(31, 2), y: y("jobs", "m1") });
        expect(gestures(canvas)).toEqual([["resize", "Resize J1"]]);
        // The start dragged far past the end stops a week short of it.
        const start = elementOf(c, "jobs", "m1", "j1")!.querySelector<HTMLElement>('[data-plan-edge="start"]')!;
        await dragTo(start, { x: xAt(28, 0.2), y: y("jobs", "m1") }, { x: xAt(36), y: y("jobs", "m1") });
        await history(canvas, "Apply changes");
        expect(sameJob(storedJobs(canvas, "m1")[0]!, { key: "j1", label: "J1", start: W(31), end: W(32) })).toBe(true);
        expect(gestures(canvas)).toEqual([["resize", "Resize J1"], ["resize", "Resize J1"]]);
    }, 30_000);

    test("a canvas that names no drop target still moves its own elements — only a card needs the canvas's id", async () => {
        const canvas = await mountMoves({ id: false });
        const c = canvas.container;
        const y = layOutPlots(c);
        const bar = elementOf(c, "jobs", "m1", "j1")!;
        expect(bar.hasAttribute("data-draggable")).toBe(true);
        await dragTo(bar, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(29), y: y("jobs", "m2") });
        expect(keysOf(c, "jobs", "m2")).toEqual(["j1"]);
        expect(gestures(canvas)).toEqual([["move", "Move J1 to M2"]]);
        // And by keyboard.
        elementOf(c, "jobs", "m2", "j1")!.focus();
        await keyOn({ key: " " });
        await keyOn({ key: "ArrowRight" });
        await keyOn({ key: " " });
        expect(gestures(canvas)).toEqual([["move", "Move J1 to M2"], ["move", "Move J1"]]);
    }, 30_000);

    test("a chip moves and resizes on its own fields; a tile moves to another week", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        // S1 spans W27–W29: a week on, then its end a week further.
        await dragTo(elementOf(c, "shifts", "m1", "s1")!, { x: xAt(27), y: y("shifts", "m1") }, { x: xAt(28), y: y("shifts", "m1") });
        const end = elementOf(c, "shifts", "m1", "s1")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!;
        await dragTo(end, { x: xAt(29, 6.5), y: y("shifts", "m1") }, { x: xAt(30, 6.5), y: y("shifts", "m1") });
        // T1 at W29: two weeks on. A tile has no ends to drag.
        const tile = elementOf(c, "slots", "m1", "t1")!;
        expect(tile.querySelector("[data-plan-edge]")).toBeNull();
        await dragTo(tile, { x: xAt(29), y: y("slots", "m1") }, { x: xAt(31), y: y("slots", "m1") });
        expect(gestures(canvas)).toEqual([["move", "Move S1"], ["resize", "Resize S1"], ["move", "Move T1"]]);
        await history(canvas, "Apply changes");
        const m1 = canvas.stored().get("m1")!;
        expect([m1.shifts[0]!.from, m1.shifts[0]!.to]).toEqual([W(28), W(31)]);
        expect(m1.slots[0]!.at).toEqual(W(31));
    }, 30_000);
});

describe("a move reaches the rows of its item type (#825)", () => {
    test("onto another machine: the job leaves one entry and joins the other, as ONE gesture over both", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        await dragTo(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(29), y: y("jobs", "m2") });
        expect(keysOf(c, "jobs", "m1")).toEqual([]);
        expect(keysOf(c, "jobs", "m2")).toEqual(["j1"]);
        expect(markOf(c, "jobs", "m2")).toBe("pending");
        expect(gestures(canvas)).toEqual([["move", "Move J1 to M2"]]);
        expect(canvas.patches[0]!.draftChanges.map((d) => d.id).sort()).toEqual(["m1", "m2"]);
        await history(canvas, "Apply changes");
        expect(storedJobs(canvas, "m1")).toEqual([]);
        expect(sameJob(storedJobs(canvas, "m2")[0]!, { key: "j1", label: "J1", start: W(29), end: W(31) })).toBe(true);
    }, 30_000);

    test("onto another series of the same item type — the machine's backlog — in one request over its entry", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        await dragTo(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(28), y: y("backlog", "m1") });
        expect(keysOf(c, "jobs", "m1")).toEqual([]);
        expect(keysOf(c, "backlog", "m1")).toEqual(["j1"]);
        expect(canvas.patches[0]!.draftChanges.map((d) => d.id)).toEqual(["m1"]);
        await history(canvas, "Apply changes");
        expect(storedJobs(canvas, "m1")).toEqual([]);
        expect(sameJob(storedJobs(canvas, "m1", "backlog")[0]!, { key: "j1", label: "J1", start: W(28), end: W(30) })).toBe(true);
    }, 30_000);

    test("a row of another item type is no destination — it never lights up, and a drop there drafts nothing", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        const bar = elementOf(c, "jobs", "m1", "j1")!;
        const letGo = await carry(bar, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(29), y: y("slots", "m2") });
        expect(bar.hasAttribute("data-dragging")).toBe(true);
        // Its own item type lights up; the shifts' and the slots' rows do not.
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-valid")).toBe(true);
        expect(plotOf(c, "backlog", "m2").hasAttribute("data-drop-valid")).toBe(true);
        for (const series of ["shifts", "slots"] as const) {
            expect(plotOf(c, series, "m2").hasAttribute("data-drop-valid")).toBe(false);
            expect(plotOf(c, series, "m2").hasAttribute("data-drop-active")).toBe(false);
        }
        await letGo();
        expect(canvas.patches).toEqual([]);
        expect(keysOf(c, "jobs", "m1")).toEqual(["j1"]);
    }, 30_000);

    test("a row already drawing the job's key refuses it — the ⊘ stage and the refusal said, by pointer and by keyboard, and nothing drafted", async () => {
        // Machine 2 already holds a job keyed j1 — another job, the same key. A
        // row's jobs keep their keys unique, so Machine 2's jobs row cannot take
        // Machine 1's j1; its backlog, which holds no j1, can.
        const seed = new Map([...SEED, ["m2", {
            label: "M2", jobs: [{ key: "j1", label: "J1 of M2", start: W(34), end: W(36) }], backlog: [], shifts: [], slots: [],
        }]]);
        const canvas = await mountMoves({ seed });
        const c = canvas.container;
        const y = layOutPlots(c);
        const letGo = await carry(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(29), y: y("jobs", "m2") });
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-invalid")).toBe(true);
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-active")).toBe(false);
        expect(announced()).toBe("M2, Jul 13, 2026 – Jul 27, 2026 does not take J1.");
        await letGo();
        expect(announced()).toBe("J1 was not dropped.");
        expect(canvas.patches).toEqual([]);
        // By keyboard: ↓ reaches Machine 2's jobs, which refuses it — said, and the carry goes on.
        elementOf(c, "jobs", "m1", "j1")!.focus();
        await keyOn({ key: " " });
        await keyOn({ key: "ArrowDown" });
        expect(carrySaid(c)).toBe("J1 cannot be dropped on M2, Jul 6, 2026 – Jul 20, 2026");
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-invalid")).toBe(true);
        await keyOn({ key: " " });
        expect(canvas.patches).toEqual([]);
        await keyOn({ key: "Escape" });
        // The backlog holds no j1: it takes the job.
        await dragTo(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(28), y: y("backlog", "m2") });
        expect(keysOf(c, "backlog", "m2")).toEqual(["j1"]);
        expect(keysOf(c, "jobs", "m2")).toEqual(["j1"]);
    }, 30_000);

    test("the landing band spans the extent it would take, labelled with it", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        const letGo = await carry(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(30), y: y("jobs", "m2") });
        const band = plotOf(c, "jobs", "m2").querySelector<HTMLElement>("[data-plan-drop-preview]")!;
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-active")).toBe(true);
        // W30–W32: three twelfths in, two twelfths wide.
        expect(band.style.left).toBe("25%");
        expect(parseFloat(band.style.width)).toBeCloseTo(100 / 6, 6);
        expect(band.querySelector("[data-plan-drop-preview-text]")!.textContent).toBe("Jul 20, 2026 – Aug 3, 2026");
        expect(announced()).toBe("J1 is over M2, Jul 20, 2026 – Aug 3, 2026.");
        await letGo();
    }, 30_000);
});

describe("a move is a draft of the session (#825)", () => {
    test("Undo, Redo and Discard reverse a move and a resize; Apply sends both as ONE batch", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const y = layOutPlots(c);
        const moveAndResize = async () => {
            await dragTo(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(29), y: y("jobs", "m1") });
            const end = elementOf(c, "jobs", "m1", "j1")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!;
            await dragTo(end, { x: xAt(30, 6.5), y: y("jobs", "m1") }, { x: xAt(32, 6.5), y: y("jobs", "m1") });
        };
        await moveAndResize();
        const drawn = () => elementOf(c, "jobs", "m1", "j1")!.getAttribute("aria-label");
        expect(drawn()).toContain("Jul 13, 2026 – Aug 10, 2026");
        await history(canvas, "Undo");
        expect(drawn()).toContain("Jul 13, 2026 – Jul 27, 2026");
        await history(canvas, "Undo");
        expect(drawn()).toContain("Jul 6, 2026 – Jul 20, 2026");
        expect(markOf(c, "jobs", "m1")).toBeUndefined();
        await history(canvas, "Redo");
        await history(canvas, "Redo");
        expect(drawn()).toContain("Jul 13, 2026 – Aug 10, 2026");
        // Discard drops every draft, and the history with it.
        await history(canvas, "Discard");
        expect(drawn()).toContain("Jul 6, 2026 – Jul 20, 2026");
        expect(markOf(c, "jobs", "m1")).toBeUndefined();
        expect(historyButton(canvas, "Undo").disabled).toBe(true);
        // Made again, both go in one batch.
        await moveAndResize();
        expect(gestures(canvas).map(([origin]) => origin))
            .toEqual(["move", "resize", "undo", "undo", "redo", "redo", "discard", "move", "resize"]);
        expect(canvas.stored().get("m1")!.jobs[0]!.start).toEqual(W(28));
        await history(canvas, "Apply changes");
        expect(sameJob(storedJobs(canvas, "m1")[0]!, { key: "j1", label: "J1", start: W(29), end: W(33) })).toBe(true);
    }, 30_000);

    test("canDrop refuses a move before it becomes a draft — the ⊘ stage, and it says so", async () => {
        const canvas = await mountMoves({ veto: true });
        const c = canvas.container;
        const y = layOutPlots(c);
        const letGo = await carry(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(29), y: y("jobs", "m2") });
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-invalid")).toBe(true);
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-active")).toBe(false);
        expect(announced()).toBe("M2, Jul 13, 2026 – Jul 27, 2026 does not take J1.");
        await letGo();
        expect(announced()).toBe("J1 was not dropped.");
        expect(canvas.patches).toEqual([]);
        expect(keysOf(c, "jobs", "m1")).toEqual(["j1"]);
        // The same machine's backlog takes it.
        await dragTo(elementOf(c, "jobs", "m1", "j1")!, { x: xAt(28), y: y("jobs", "m1") }, { x: xAt(28), y: y("backlog", "m2") });
        expect(keysOf(c, "backlog", "m2")).toEqual(["j1"]);
    }, 30_000);
});

describe("the same move inline and paged (#825)", () => {
    for (const arm of ["inline", "paged"] as const) {
        test(`${arm}: a mark moved to another press takes its job there — drawn at once, undone, and applied`, async () => {
            const seed = new Map([
                ["p1", { label: "Press 1", approval: PENDING, jobs: [{ key: "k1", at: variant("time", W(28)) }] }],
                ["p2", { label: "Press 2", approval: PENDING, jobs: [] }],
            ]) as ReadonlyMap<string, PressValue>;
            const canvas = await mountCanvas({ arm, moves: true, seed });
            const c = canvas.container;
            const marksRow = (press: string) => c.querySelector<HTMLElement>(rowSel(press, "data-plan-row", MARKS))!;
            const plot = (press: string) => marksRow(press).querySelector<HTMLElement>("[data-plan-plot]")!;
            layOut(new Map([
                [plot("p1"), { left: 200, top: 0, width: 1200, height: 32 }],
                [plot("p2"), { left: 200, top: 40, width: 1200, height: 32 }],
            ]));
            const drawnMarks = (press: string) => [...marksRow(press).querySelectorAll("[data-mark][role='button']")].map((m) => m.getAttribute("data-mark"));
            await dragTo(marksRow("p1").querySelector<HTMLElement>('[data-mark="k1"]')!, { x: xAt(28), y: 16 }, { x: xAt(30), y: 56 });
            expect(drawnMarks("p1")).toEqual([]);
            expect(drawnMarks("p2")).toEqual(["k1"]);
            expect(canvas.patches.map((p) => [p.origin.type, p.label])).toEqual([["move", "Move k1 to Press 2"]]);
            await history(canvas, "Undo");
            expect(drawnMarks("p1")).toEqual(["k1"]);
            expect(drawnMarks("p2")).toEqual([]);
            await history(canvas, "Redo");
            await history(canvas, "Apply changes");
            await canvas.confirm();
            expect(canvas.stored().get("p1")!.jobs).toEqual([]);
            const moved = canvas.stored().get("p2")!.jobs;
            expect(moved.map((j) => j.key)).toEqual(["k1"]);
            expect(sameInstant(moved[0]!.at, variant("time", W(30)))).toBe(true);
            expect(drawnMarks("p2")).toEqual(["k1"]);
        }, 30_000);
    }
});

describe("the keyboard moves an element (#825)", () => {
    test("Space picks a run up; ← → move it a week, Shift and Alt move an end, ↓ reaches the next row of its item type, Space drops it", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        const bar = elementOf(c, "jobs", "m1", "j1")!;
        bar.focus();
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("Picked up J1: M1, Jul 6, 2026 – Jul 20, 2026");
        expect(bar.hasAttribute("data-dragging")).toBe(true);
        expect(plotOf(c, "jobs", "m1").hasAttribute("data-drop-active")).toBe(true);
        await keyOn({ key: "ArrowRight" });
        expect(carrySaid(c)).toBe("J1: M1, Jul 13, 2026 – Jul 27, 2026");
        await keyOn({ key: "ArrowRight", shiftKey: true });
        expect(carrySaid(c)).toBe("J1: M1, Jul 13, 2026 – Aug 3, 2026");
        await keyOn({ key: "ArrowLeft", altKey: true });
        expect(carrySaid(c)).toBe("J1: M1, Jul 6, 2026 – Aug 3, 2026");
        // The landing band follows, labelled.
        const band = plotOf(c, "jobs", "m1").querySelector<HTMLElement>("[data-plan-drop-preview]")!;
        expect(band.querySelector("[data-plan-drop-preview-text]")!.textContent).toBe("Jul 6, 2026 – Aug 3, 2026");
        // Down reaches Machine 2's jobs — the next row of its item type.
        await keyOn({ key: "ArrowDown" });
        expect(carrySaid(c)).toBe("J1: M2, Jul 6, 2026 – Aug 3, 2026");
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-active")).toBe(true);
        expect(plotOf(c, "jobs", "m1").hasAttribute("data-drop-active")).toBe(false);
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("Dropped J1 on M2, Jul 6, 2026 – Aug 3, 2026");
        expect(gestures(canvas)).toEqual([["move", "Move J1 to M2"]]);
        expect(keysOf(c, "jobs", "m2")).toEqual(["j1"]);
        // Focus lands on the job where it now is.
        expect(document.activeElement).toBe(elementOf(c, "jobs", "m2", "j1"));
        await history(canvas, "Apply changes");
        expect(sameJob(storedJobs(canvas, "m2")[0]!, { key: "j1", label: "J1", start: W(28), end: W(32) })).toBe(true);
    }, 30_000);

    test("Escape and Tab cancel — it stays where it was, and focus returns to it", async () => {
        const canvas = await mountMoves();
        const c = canvas.container;
        for (const cancel of ["Escape", "Tab"]) {
            const bar = elementOf(c, "jobs", "m1", "j1")!;
            bar.focus();
            await keyOn({ key: " " });
            await keyOn({ key: "ArrowRight" });
            await keyOn({ key: cancel });
            expect(carrySaid(c)).toBe("J1 was not moved");
            expect(bar.hasAttribute("data-dragging")).toBe(false);
            expect(plotOf(c, "jobs", "m1").hasAttribute("data-drop-active")).toBe(false);
            expect(document.activeElement).toBe(bar);
        }
        expect(canvas.patches).toEqual([]);
    }, 30_000);

    test("a refused place is said, and the carry goes on; a tile has no ends to move", async () => {
        const canvas = await mountMoves({ veto: true });
        const c = canvas.container;
        elementOf(c, "jobs", "m1", "j1")!.focus();
        await keyOn({ key: " " });
        await keyOn({ key: "ArrowDown" });
        expect(carrySaid(c)).toBe("J1 cannot be dropped on M2, Jul 6, 2026 – Jul 20, 2026");
        expect(plotOf(c, "jobs", "m2").hasAttribute("data-drop-invalid")).toBe(true);
        await keyOn({ key: " " });
        expect(canvas.patches).toEqual([]);
        expect(carrySaid(c)).toBe("J1 cannot be dropped on M2, Jul 6, 2026 – Jul 20, 2026");
        await keyOn({ key: "Escape" });
        // A tile: Shift moves no end, the arrows move it.
        const tile = elementOf(c, "slots", "m1", "t1")!;
        tile.focus();
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("Picked up T1: M1, Jul 13, 2026");
        await keyOn({ key: "ArrowRight", shiftKey: true });
        expect(carrySaid(c)).toBe("Picked up T1: M1, Jul 13, 2026");
        await keyOn({ key: "ArrowRight" });
        expect(carrySaid(c)).toBe("T1: M1, Jul 20, 2026");
        await keyOn({ key: "Enter" });
        expect(gestures(canvas)).toEqual([["move", "Move T1"]]);
    }, 30_000);
});
