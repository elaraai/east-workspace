/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>`'s selection and its inspector (#1197, `Plan Builder Spec.md` §8,
 * §9.8, PB38–PB41, PB60): an event's click on the canvas selects it and its
 * row, Shift, ⌘ or Ctrl adding it to the selection or taking it out (the
 * Calendar's B15); a row's click selects the row in place of the events; Esc
 * clears it all; and an element of a row no event kind draws selects its row,
 * as it always has. The inspector shows what is selected — one event, its
 * kind's own inspector in place of its form, several, a row with its
 * measures at the bucket a click on it named, or nothing — its edit controls
 * on, in one fieldset, as the event kinds take edits (#1194; what each does
 * is `plan-builder-editing.dom.test.tsx`'s). Each Plan is the print works', or
 * a test's own over its records, mounted through the dispatcher under the
 * record runtime a surface installs.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { East, none, some, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { el, entry, mount, planHarness, programOf, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness();

// ── The print works' rows and events ─────────────────────────────────────────

/** Press A1's bars, its marks, and Crew 1's chips. */
const A1 = entry("presses.span", "Hall A", "a1");
const A1_MARKS = entry("presses.marks", "Hall A", "a1");
const A2 = entry("presses.span", "Hall A", "a2");
const C1 = entry("crews.cards", "Hall A", "c1");

/** A job's bar on Press A1. */
const job = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(A1)} ${el("data-run", "job", key)}`)!;
/** A stop's glyph on Press A1 — its label carries its key too, and is no button. */
const stop = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(A1_MARKS)} [role="button"]${el("data-mark", "stop", key)}`)!;
/** A shift's chip on Crew 1. */
const shift = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(C1)} ${el("data-chip", "shift", key)}`)!;

/** The events drawn selected, by their element's key — each pressed, and marked for the recipe's ring. */
const selectedEvents = (c: HTMLElement) => {
    const pressed = [...slot(c, "main")!.querySelectorAll("[aria-pressed='true']")];
    expect(pressed.every((node) => node.hasAttribute("data-selected"))).toBe(true);
    expect(slot(c, "main")!.querySelectorAll("[data-selected]:not([data-plan-row])")).toHaveLength(pressed.length);
    return pressed.map((node) => node.getAttribute("data-run") ?? node.getAttribute("data-chip") ?? node.getAttribute("data-mark"));
};
/** The selected row, by its id's text, or `null`. */
const selectedRow = (c: HTMLElement) => slot(c, "main")!.querySelector("[data-plan-row][aria-selected='true']")?.getAttribute("data-plan-row") ?? null;
/** What the canvas's live region said last. */
const announced = (c: HTMLElement) => c.querySelector("[data-plan-announce]")!.textContent;

/** An element's key, as the canvas prints it. */
const key = (node: HTMLElement) => node.getAttribute("data-run") ?? node.getAttribute("data-chip") ?? node.getAttribute("data-mark");
/** A row's id's text. */
const rowKey = (c: HTMLElement, id: ReturnType<typeof entry>) => c.querySelector(rowAt(id))!.getAttribute("data-plan-row");

// ============================================================================
// Selecting events on the canvas (the Calendar's B15)
// ============================================================================

describe("selecting events (#1197, the Calendar's B15)", () => {
    test("a click selects one event and its row, the event drawn pressed; a click on another selects it instead, and again holds", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        // Every event's element is a toggle, none of them pressed.
        expect(job(container, "J-1001").getAttribute("aria-pressed")).toBe("false");
        expect(shift(container, "SH-01").getAttribute("aria-pressed")).toBe("false");
        expect(stop(container, "S-01").getAttribute("aria-pressed")).toBe("false");
        expect(selectedEvents(container)).toEqual([]);

        fireEvent.click(job(container, "J-1001"));
        await settle();
        expect(selectedEvents(container)).toEqual([key(job(container, "J-1001"))]);
        expect(selectedRow(container)).toBe(rowKey(container, A1));
        expect(announced(container)).toBe("1 event selected");

        fireEvent.click(job(container, "J-1002"));
        await settle();
        expect(selectedEvents(container)).toEqual([key(job(container, "J-1002"))]);
        fireEvent.click(job(container, "J-1002"));
        await settle();
        expect(selectedEvents(container)).toEqual([key(job(container, "J-1002"))]);
        expect(selectedRow(container)).toBe(rowKey(container, A1));
    });

    test("Shift, ⌘ or Ctrl adds an event of any kind, on any row, to the selection — or takes it out", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(job(container, "J-1001"));
        await settle();
        fireEvent.click(shift(container, "SH-01"), { shiftKey: true });
        await settle();
        // The row is the one clicked last.
        expect(selectedRow(container)).toBe(rowKey(container, C1));
        fireEvent.click(stop(container, "S-01"), { metaKey: true });
        await settle();
        expect(new Set(selectedEvents(container))).toEqual(new Set([key(job(container, "J-1001")), key(shift(container, "SH-01")), key(stop(container, "S-01"))]));
        expect(announced(container)).toBe("3 events selected");
        fireEvent.click(job(container, "J-1001"), { ctrlKey: true });
        await settle();
        expect(new Set(selectedEvents(container))).toEqual(new Set([key(shift(container, "SH-01")), key(stop(container, "S-01"))]));
        expect(announced(container)).toBe("2 events selected");
    });

    test("a click on a row selects the row in place of its events, a click in its plot too; Esc clears it all at once", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(job(container, "J-1001"));
        fireEvent.click(job(container, "J-1002"), { shiftKey: true });
        await settle();
        expect(selectedEvents(container)).toHaveLength(2);
        // Another press's name.
        fireEvent.click(container.querySelector(`${rowAt(A2)} [role="rowheader"]`)!);
        await settle();
        expect(selectedEvents(container)).toEqual([]);
        expect(selectedRow(container)).toBe(rowKey(container, A2));
        // The same press's plot, beside its jobs.
        fireEvent.click(job(container, "J-1001"));
        await settle();
        fireEvent.click(container.querySelector(`${rowAt(A1)} [data-plan-plot]`)!);
        await settle();
        expect(selectedEvents(container)).toEqual([]);
        expect(selectedRow(container)).toBe(rowKey(container, A1));
        expect(announced(container)).toBe("Selected Press A1");
        // Esc, from the row: the row and the events go in one press.
        fireEvent.click(job(container, "J-1003"));
        fireEvent.click(shift(container, "SH-01"), { shiftKey: true });
        await settle();
        fireEvent.keyDown(container.querySelector(rowAt(C1))!, { key: "Escape" });
        await settle();
        expect(selectedEvents(container)).toEqual([]);
        expect(selectedRow(container)).toBeNull();
        expect(announced(container)).toBe("Selection cleared");
    });

    test("Enter on an event's element selects it, and Shift+Enter adds it", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.keyDown(job(container, "J-1001"), { key: "Enter" });
        await settle();
        expect(selectedEvents(container)).toEqual([key(job(container, "J-1001"))]);
        fireEvent.keyDown(job(container, "J-1003"), { key: "Enter", shiftKey: true });
        await settle();
        expect(selectedEvents(container)).toEqual([key(job(container, "J-1001")), key(job(container, "J-1003"))]);
    });

    test("a commit that moves a selected event keeps it selected where it draws now", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(job(container, "J-1001"));
        await settle();
        const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
        jobs.set("J-1001", { ...jobs.get("J-1001")!, press: some("b3") });
        await h.commit(ex.planPrintJobs, jobs);
        expect(container.querySelector(`${rowAt(A1)} ${el("data-run", "job", "J-1001")}`)).toBeNull();
        const moved = container.querySelector<HTMLElement>(`${rowAt(entry("presses.span", "Hall B", "b3"))} ${el("data-run", "job", "J-1001")}`)!;
        expect(moved.getAttribute("aria-pressed")).toBe("true");
        expect(selectedEvents(container)).toEqual([key(moved)]);
    });

    test("an element of a row no event kind draws — a run of a series over a dataset — is no toggle: its click selects its row", async () => {
        const FIRST = new Date("2026-10-05T00:00:00Z");
        const LAST = new Date("2026-11-02T00:00:00Z");
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const stock = $.let(Data.bind(ex.planLinkStock));
            const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
            return Plan({
                axis,
                resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
                // Each paper stock's order, over the dataset: a run of the Plan's own.
                rows: [Plan.over(stock, [Plan.series.span(ex.PrintStock, {
                    key: "orders", title: "Orders", label: (s) => s.name,
                    runs: (s) => [Plan.run({ key: "order", start: FIRST, end: LAST, label: s.name, state: "actual" })],
                })])],
            });
        }))), getRegisteredPlatformImplementations());
        const { container } = mount(program);
        await settle();
        const board = container.querySelector<HTMLElement>(`${rowAt(entry("orders", "board"))} [data-run="order"]`)!;
        expect(board.hasAttribute("aria-pressed")).toBe(false);
        fireEvent.click(container.querySelector<HTMLElement>(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-1001")}`)!);
        await settle();
        fireEvent.click(board);
        await settle();
        expect(selectedEvents(container)).toEqual([]);
        expect(board.hasAttribute("data-selected")).toBe(false);
        expect(selectedRow(container)).toBe(rowKey(container, entry("orders", "board")));
        // Shift on it adds nothing either.
        fireEvent.click(container.querySelector<HTMLElement>(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-1001")}`)!);
        await settle();
        fireEvent.click(board, { shiftKey: true });
        await settle();
        expect(selectedEvents(container)).toEqual([]);
    });
});

// ============================================================================
// The inspector (PB38–PB41, PB60)
// ============================================================================

/** The inspector pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** What the inspector shows: `event`, `events`, `row` or `none`. */
const showing = (c: HTMLElement) => pane(c).querySelector("[data-plan-inspector]")?.getAttribute("data-plan-inspector") ?? null;
/** One of the inspector's facts, by its name: its value's words. */
const fact = (c: HTMLElement, name: string) => pane(c).querySelector(`[data-fact=${JSON.stringify(name)}]`)?.textContent ?? null;
/** The facts the inspector shows, by name, in order. */
const factNames = (c: HTMLElement, within: string) => [...pane(c).querySelectorAll(`${within} [data-fact]`)].map((node) => node.getAttribute("data-fact"));
/** A count the inspector shows when nothing is selected. */
const stat = (c: HTMLElement, name: string) => pane(c).querySelector(`[data-count="${name}"]`)?.children[0]?.textContent ?? null;
/** The edit controls' fieldset. */
const edits = (c: HTMLElement) => pane(c).querySelector<HTMLFieldSetElement>("fieldset[data-inspector-edits]")!;

/** Stubs each plot's box at 280px from the left edge — ten pixels a day over the print works' four weeks — so a click names its bucket. */
function plotBoxes(): () => void {
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (!this.hasAttribute("data-plan-plot")) return real.call(this);
        return { x: 0, y: 0, left: 0, top: 0, width: 280, height: 32, right: 280, bottom: 32, toJSON() { return {}; } } as DOMRect;
    };
    return () => { Element.prototype.getBoundingClientRect = real; };
}

describe("the inspector (#1197, PB38–PB41, PB60)", () => {
    test("nothing selected: the window's events, how long they run and the backlog — then three hints (PB41)", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(pane(container).getAttribute("data-frame-slot")).toBe("end");
        expect(showing(container)).toBe("none");
        // 22 jobs, 6 stops and 24 shifts in the four weeks: the jobs run 135 h and the shifts 192 h.
        expect(["events", "hours", "backlog"].map((name) => stat(container, name))).toEqual(["52", "327", "8"]);
        // A Plan approves and rejects nothing (#1260): nothing to review.
        expect(stat(container, "review")).toBeNull();
        expect(pane(container).querySelectorAll("li")).toHaveLength(3);
    });

    test("one event: its kind, its title, when it runs, its facts and its kind's form, the fields its roles read left to their lines — every edit control on, in one fieldset (PB38, #1194)", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(job(container, "J-1001"));
        await settle();
        expect(showing(container)).toBe("event");
        const head = pane(container);
        expect(head.querySelector("[data-inspector-kind]")!.textContent).toBe("Print job");
        expect(head.querySelector("[data-inspector-title]")!.textContent).toBe("Spring catalogue");
        expect(head.querySelector("[data-inspector-when]")!.textContent).toBe("Mon, Oct 5, 2026 · 06:00–14:00");
        expect(head.querySelector('svg[data-icon="file-lines"]')).not.toBeNull();
        expect(factNames(container, "[data-inspector-facts]")).toEqual(["resource", "start", "end", "state", "quantity"]);
        expect(["resource", "start", "end", "state", "quantity"].map((name) => fact(container, name)))
            .toEqual(["Press A1", "Oct 5, 2026, 06:00", "Oct 5, 2026, 14:00", "actual", "96,000 sheets"]);
        // A Plan approves and rejects nothing (#1260): no verdict, no Approve or Reject.
        expect(pane(container).querySelector("[data-inspector-verdict]")).toBeNull();
        // The kind's form: the customer, the stock and the due date — its state and sheets have their own lines.
        const form = pane(container).querySelector("[data-inspector-fields='form']")!;
        expect([...form.querySelectorAll("[data-field]")].map((field) => field.getAttribute("data-field"))).toEqual(["customer", "stock", "due"]);
        expect(form.querySelector<HTMLInputElement>("[data-field='customer'] input")!.value).toBe("Alder & Finch");
        // Every edit control in the one fieldset, on: the job's kind takes edits (#1194).
        expect(edits(container).disabled).toBe(false);
        expect(edits(container).contains(form)).toBe(true);
        const actions = [...edits(container).querySelectorAll<HTMLButtonElement>("button[data-inspector-action]")];
        expect(actions.map((b) => b.getAttribute("data-inspector-action"))).toEqual(["duplicate", "delete"]);
        expect(actions.every((b) => !b.disabled)).toBe(true);
    });

    test("a stop shows its kind's own inspector in place of a form — its title and its kind on a segment, in the edits' fieldset; an instant's one time (PB60)", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(stop(container, "S-01"));
        await settle();
        expect(showing(container)).toBe("event");
        expect(pane(container).querySelector("[data-inspector-when]")!.textContent).toBe("Wed, Oct 7, 2026 · 12:00");
        expect(factNames(container, "[data-inspector-facts]")).toEqual(["resource", "at"]);
        expect(fact(container, "at")).toBe("Oct 7, 2026, 12:00");
        const own = pane(container).querySelector("[data-inspector-fields='custom']")!;
        expect(pane(container).querySelector("[data-inspector-fields='form']")).toBeNull();
        expect(own.textContent).toContain("Plate change");
        expect(own.textContent).toContain("Service");
        expect(own.querySelector<HTMLInputElement>("input[value='plate_change']")!.checked).toBe(true);
        expect(edits(container).contains(own)).toBe(true);
        expect(edits(container).disabled).toBe(false);
    });

    test("several events: how many, each kind's count, the list in the order they were selected, and the bulk edit — the state, the resource and a shift — on (PB39, #1194)", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(job(container, "J-1001"));
        fireEvent.click(shift(container, "SH-01"), { shiftKey: true });
        fireEvent.click(stop(container, "S-01"), { shiftKey: true });
        await settle();
        expect(showing(container)).toBe("events");
        expect(pane(container).querySelector("[data-inspector-several]")!.textContent).toBe("3 events");
        expect([...pane(container).querySelectorAll("[data-inspector-kind-count]")].map((chip) => chip.textContent))
            .toEqual(["Print job ×1", "Stop ×1", "Crew shift ×1"]);
        expect([...pane(container).querySelectorAll("[data-inspector-event]")].map((item) => item.querySelector("span")!.textContent))
            .toEqual(["Spring catalogue", "Early", "Plate change"]);
        const bulk = pane(container).querySelector("[data-inspector-bulk]")!;
        expect([...bulk.querySelectorAll("[data-field]")].map((field) => field.getAttribute("data-field"))).toEqual(["state", "resource"]);
        expect([...bulk.querySelectorAll("[data-inspector-shift] button")].map((b) => b.textContent)).toEqual(["−1 d", "−1 h", "+1 h", "+1 d"]);
        expect(edits(container).contains(bulk)).toBe(true);
        expect(edits(container).disabled).toBe(false);
        expect([...edits(container).querySelectorAll<HTMLButtonElement>("button[data-inspector-action]")].every((b) => !b.disabled)).toBe(true);
    });

    test("a press: its name, its line and its hall, its events in the window, and its measures at the bucket a click on its plot named (PB40)", async () => {
        const restore = plotBoxes();
        try {
            const { container } = mount(programOf(ex.planPrintWorks));
            await settle();
            fireEvent.click(container.querySelector(`${rowAt(A1)} [role="rowheader"]`)!);
            await settle();
            expect(showing(container)).toBe("row");
            expect(pane(container).querySelector("[data-inspector-kind]")!.textContent).toBe("Presses");
            expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Press A1");
            expect(pane(container).querySelector("[data-inspector-line]")!.textContent).toBe("12,000 sheets/h");
            expect(pane(container).querySelector("[data-inspector-group]")!.textContent).toBe("Hall A");
            // Five jobs and two stops; the jobs run 33 h and print 396,000 sheets.
            expect(["events", "hours", "quantities"].map((name) => fact(container, name))).toEqual(["7", "33", "396,000 sheets"]);
            // No bucket named: a hint.
            expect(pane(container).querySelector("[data-inspector-no-bucket]")).not.toBeNull();
            // A click on its plot, halfway through the four weeks: Monday 19 October, its utilisation 75.
            fireEvent.click(container.querySelector(`${rowAt(A1)} [data-plan-plot]`)!, { clientX: 145 });
            await settle();
            expect(selectedRow(container)).toBe(rowKey(container, A1));
            expect(pane(container).querySelector("[data-inspector-measures] > div")!.textContent).toMatch(/^At .*19/);
            expect(fact(container, "measure:util")).toBe("75");
            // Its marks' row is the same press: the same view, the bucket its own click names.
            fireEvent.click(container.querySelector(`${rowAt(A1_MARKS)} [data-plan-plot]`)!, { clientX: 5 });
            await settle();
            expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Press A1");
            expect(fact(container, "measure:util")).toBe("50");
            // So is its utilisation row, a measure: Tuesday 6 October's reading, 12.
            fireEvent.click(container.querySelector(`${rowAt(entry("util", "Hall A", "a1"))} [data-plan-plot]`)!, { clientX: 15 });
            await settle();
            expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Press A1");
            expect(["events", "hours"].map((name) => fact(container, name))).toEqual(["7", "33"]);
            expect(fact(container, "measure:util")).toBe("12");
        } finally {
            restore();
        }
    });

    test("an event kind's Unassigned row: the kind's events on no resource; any other row, what it draws at the bucket (PB40)", async () => {
        const restore = plotBoxes();
        try {
            const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
            jobs.set("J-1001", { ...jobs.get("J-1001")!, press: none });
            await h.commit(ex.planPrintJobs, jobs);
            const { container } = mount(programOf(ex.planPrintWorks));
            await settle();
            fireEvent.click(container.querySelector(`${rowAt(entry("job.unassigned", "span"))} [role="rowheader"]`)!);
            await settle();
            expect(pane(container).querySelector("[data-inspector-kind]")!.textContent).toBe("Print job");
            expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Unassigned");
            expect(["events", "hours", "quantities"].map((name) => fact(container, name))).toEqual(["1", "8", "96,000 sheets"]);
            expect(pane(container).querySelector("[data-inspector-measures]")).toBeNull();
            // The pinned chart of the sheets printed each day: what it draws at the bucket.
            fireEvent.click(container.querySelector(`${rowAt(entry("", "output"))} [data-plan-plot]`)!, { clientX: 145 });
            await settle();
            expect(pane(container).querySelector("[data-inspector-kind]")!.textContent).toBe("Row");
            expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("SHEETS / DAY");
            // Monday 19 October's column: 144,000 sheets, as the chart's axis prints them.
            expect(fact(container, "measure:" + rowKey(container, entry("", "output")))).toMatch(/^144/);
            expect(pane(container).querySelector("[data-inspector-window]")).toBeNull();
        } finally {
            restore();
        }
    });

    test("the inspector reads its event again as its record commits; an event no longer there is left out, its row shown", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(job(container, "J-1001"));
        await settle();
        const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, ValueTypeOf<typeof ex.PrintJob>>);
        jobs.set("J-1001", { ...jobs.get("J-1001")!, title: "Spring catalogue reprint" });
        await h.commit(ex.planPrintJobs, jobs);
        expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Spring catalogue reprint");
        jobs.delete("J-1001");
        await h.commit(ex.planPrintJobs, jobs);
        expect(showing(container)).toBe("row");
        expect(pane(container).querySelector("[data-inspector-title]")!.textContent).toBe("Press A1");
    });

    test("collapsed, the pane is a rail with its icon and what is selected — the event's title, how many events, or the row's name", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Inspector" }));
        await settle();
        expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
        expect(pane(container).querySelector("[data-dock-detail]")).toBeNull();
        expect(pane(container).querySelector('svg[data-icon="sliders"]')).not.toBeNull();
        const detail = () => pane(container).querySelector("[data-dock-detail]")?.textContent;
        fireEvent.click(job(container, "J-1001"));
        await settle();
        expect(detail()).toBe("Spring catalogue");
        fireEvent.click(job(container, "J-1002"), { shiftKey: true });
        await settle();
        expect(detail()).toBe("2 events");
        fireEvent.click(container.querySelector(`${rowAt(A2)} [role="rowheader"]`)!);
        await settle();
        expect(detail()).toBe("Press A2");
    });

    test("a Plan given no inspector has no end pane", async () => {
        const { container } = mount(programOf(ex.planEvents));
        await settle();
        expect(slot(container, "end")).toBeNull();
    });
});
