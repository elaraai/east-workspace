/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The press tasks' examples (#1541 §3.7, U1, U2, U12), on e3 itself, each
 * mounted as a surface mounts it:
 *
 * - `planPressTasks`, the works' page: every machine with its rows beneath it,
 *   the machines read lean a page at a time and a press's kinds of task — its
 *   own child rows, keyed by a variant — with them; each task on its kind's
 *   row in its half's lane, read a cell at a time by its press;
 * - `planOnePress`, one press's own page: the works' page scoped to the press,
 *   its own row not drawn, so its pinned ink temperature and its kinds' rows
 *   stand at the root — the tasks read by the press the rows stand beneath,
 *   and the pinned chart's readings read though it is none of the rows laid
 *   out;
 * - `planPressKinds`: the works' list of kinds beneath every press
 *   (`Plan.children.of`), a row for each whether the press takes it or not.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { planMessages } from "../messages.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { axisFormatter } from "../rows/chart-geometry.js";
import { el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";
import { pressKindStep } from "./press.test-utils.js";

const h = planHarness();

// The examples' frames as a browser lays them: 700px tall, each mounted row as tall as it draws. And what a Plan says
// on the console of a read it could not make: a page whose records lack an index a read needs says so there alone.
let restore: (() => void)[] = [];
const said: string[] = [];
beforeEach(() => {
    said.length = 0;
    // The console's own words are plain text: a Plan's start with its name.
    const spy = vi.spyOn(console, "error").mockImplementation((...words: unknown[]) => { said.push(words.map((word) => `${word as string}`).join(" ")); });
    restore = [boundFrame(700), frameScrolls(), () => spy.mockRestore()];
});
afterEach(() => { for (const undo of restore.reverse()) undo(); });
/** What the Plan said on the console of reads it could not make. */
const unread = () => said.filter((line) => line.startsWith("[Plan]"));

/** A press's row of a kind of task. */
const kindRow = (press: string, kind: Parameters<typeof pressKindStep>[0]) => entry("kinds", press, pressKindStep(kind));
const WASH_3 = kindRow("P03", "blanket_wash");
const INK_3 = kindRow("P03", "ink_fill");
const PLATES_3 = kindRow("P03", "plate_check");
const ROLLERS_3 = kindRow("P03", "roller_wash");
const WASH_4 = kindRow("P04", "blanket_wash");
const INK_4 = kindRow("P04", "ink_fill");
const PLATES_4 = kindRow("P04", "plate_check");
const ROLLERS_4 = kindRow("P04", "roller_wash");

/** The rows a mounted Plan draws, in order, each by its key. */
const rowsOf = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-plan-row]")].map((row) => row.getAttribute("data-plan-row"));
/** Some rows' keys, as a Plan prints them. */
const keys = (...ids: PlanRowId[]) => ids.map(rowKeyOf);
/** A task's tile on a row. */
const task = (c: HTMLElement, key: string, row: PlanRowId) => c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-event", "task", key)}`);
/** The cell a tile is in: its bucket's place among the days, and its lane's among the row's. */
const cellOf = (node: HTMLElement | null) => node?.closest("[data-plan-cell]")?.getAttribute("data-plan-cell") ?? null;
/** The tasks of the works, by their keys. */
const TASKS = ["T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07", "T-08"] as const;
/** The tasks a row draws, each by its key and its cell, in the tasks' order. */
const tasksOn = (c: HTMLElement, row: PlanRowId) => TASKS.flatMap((key) => {
    const tile = task(c, key, row);
    return tile === null ? [] : [`${key} ${cellOf(tile)}`];
});
/** Anything a mounted Plan could not draw. */
const refused = (c: HTMLElement) => [...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((node) => node.textContent ?? "");
/** The inspector's pane. */
const pane = (c: HTMLElement) => slot(c, "end")!;
/** One of the inspector's facts, by its name: its value's words; `null` where it shows none. */
const fact = (c: HTMLElement, name: string) => pane(c).querySelector(`[data-fact=${JSON.stringify(name)}]`)?.textContent ?? null;
/** What the inspector says the row is: its eyebrow. */
const eyebrow = (c: HTMLElement) => pane(c).querySelector('[data-plan-inspector="row"] [data-inspector-kind]')?.textContent ?? null;
/** Selects a row by a click on it, as a planner does — a press's head folds its rows: the inspector shows the row. */
async function selectRow(c: HTMLElement, row: PlanRowId) {
    fireEvent.click(c.querySelector<HTMLElement>(rowAt(row))!);
    await settle();
    expect(pane(c).querySelector('[data-plan-inspector="row"]')).not.toBeNull();
}

/** What a chart of a press's ink temperature says: its least, greatest and last reading in the window. */
const temperatureSaid = (min: number, max: number, last: number) => {
    const fmt = axisFormatter(undefined, "en-US");
    return planMessages.chartSummary({ parts: [planMessages.chartLayerValues({
        layer: planMessages.chartLayer({ kind: "line", index: undefined }), min: fmt(min), max: fmt(max), last: fmt(last), n: 0, breaches: "0",
    })] });
};

describe("the works' page (planPressTasks)", () => {
    test("every machine with its rows beneath it: a folder its utilisation, a press its ink temperature and a row for each kind of task it takes", async () => {
        const { container: c } = await h.mount(ex.planPressTasks);
        await settle();
        await waitFor(() => expect(rowsOf(c)).toEqual(keys(
            entry("folder", "F1"), entry("utilisation", "F1"),
            entry("press", "P03"), entry("temperature", "P03"), WASH_3, INK_3, PLATES_3,
            entry("press", "P04"), entry("temperature", "P04"), WASH_4, ROLLERS_4,
        )));
        expect(refused(c)).toEqual([]);
        expect(unread()).toEqual([]);
    });

    test("each task is on its press's row of its kind, in its half's lane, and a press's own row draws none", async () => {
        const { container: c } = await h.mount(ex.planPressTasks);
        await settle();
        // Tuesday 6 October: the blankets washed in the morning, the cyan filled in the afternoon.
        await waitFor(() => expect(tasksOn(c, WASH_3)).toEqual(["T-01 1:0", "T-05 4:1"]));
        expect(tasksOn(c, INK_3)).toEqual(["T-02 1:1", "T-03 2:0"]);
        expect(tasksOn(c, PLATES_3)).toEqual(["T-04 3:0"]);
        expect(tasksOn(c, WASH_4)).toEqual(["T-06 1:1"]);
        expect(tasksOn(c, ROLLERS_4)).toEqual(["T-07 2:0", "T-08 4:0"]);
        expect(tasksOn(c, entry("press", "P03"))).toEqual([]);
        expect(tasksOn(c, entry("press", "P04"))).toEqual([]);
    });

    test("both lanes of a kind's row are drawn on a day with no task, each named once in the row's gutter (#1680's review)", async () => {
        const { container: c } = await h.mount(ex.planPressTasks);
        await settle();
        await waitFor(() => expect(task(c, "T-01", WASH_3)).not.toBeNull());
        const row = c.querySelector<HTMLElement>(rowAt(WASH_3))!;
        // Saturday 10 October holds no task of the blankets': its morning and its afternoon are drawn all the same — each
        // lane's wash runs across every day — and no empty cell stands there to say so.
        expect(row.querySelectorAll("[data-plan-cellwash]")).toHaveLength(2);
        expect(row.querySelector('[data-plan-cell="5:0"], [data-plan-cell="5:1"]')).toBeNull();
        // Each lane is named once, on its line of the gutter, never in every cell.
        expect([...row.querySelectorAll("[data-plan-lane]")].map((caption) => caption.textContent)).toEqual(["AM", "PM"]);
    });

    test("the inspector shows a kind's row as its press's tasks of that kind, and the press's own row as the press with all of them (#1660's review)", async () => {
        const { container: c } = await h.mount(ex.planPressTasks);
        await settle();
        await waitFor(() => expect(task(c, "T-02", INK_3)).not.toBeNull());
        // The cyan and the black: the press's tasks on its row of ink fills, read by the press its row stands beneath.
        await selectRow(c, INK_3);
        expect(eyebrow(c)).toBe("Tasks");
        await waitFor(() => expect(fact(c, "events")).toBe("2"));
        // The press's own row draws none of them, and stands for the press: every task of its kinds' rows.
        await selectRow(c, entry("press", "P03"));
        expect(eyebrow(c)).toBe("Presses");
        await waitFor(() => expect(fact(c, "events")).toBe("5"));
    });

    test("the horizon holds the window the canvas shows, though the tasks fill four days of it: the stated four weeks on the strip, narrowed and widened back, and a day past the tasks keeps a window (#1680's review)", async () => {
        const { container: c } = await h.mount(ex.planPressTasks);
        await settle();
        const band = () => c.querySelector<HTMLElement>("[data-slot='horizon']");
        await waitFor(() => expect(band()?.querySelector("[data-brush-window]")).not.toBeNull());
        const handle = (edge: "lo" | "hi") => band()!.querySelector<HTMLElement>(`[data-brush-handle="${edge}"]`)!;
        const at = () => [handle("lo").getAttribute("aria-valuenow"), handle("hi").getAttribute("aria-valuenow")];
        const said = () => band()!.querySelector("[data-brush-window]")?.getAttribute("aria-valuetext") ?? null;
        // The tasks fall on 6 to 9 October; the canvas shows the stated four weeks, 5 October to 1 November: the window
        // is the whole strip, and it names the days the navigator does.
        expect(at()).toEqual(["0", "100"]);
        expect(said()).toBe("Oct 5, 2026 – Nov 1, 2026");
        // A day off its end, and back: the strip still holds the stated window, so the window widens back out.
        fireEvent.keyDown(handle("hi"), { key: "ArrowLeft" });
        await settle();
        await waitFor(() => expect(said()).toBe("Oct 5, 2026 – Oct 31, 2026"));
        fireEvent.keyDown(handle("hi"), { key: "ArrowRight" });
        await settle();
        await waitFor(() => expect(said()).toBe("Oct 5, 2026 – Nov 1, 2026"));
        expect(at()).toEqual(["0", "100"]);
        // Six days on, the window starts past every task: it is the canvas's still, and on the strip.
        const next = within(slot(c, "toolbar")!).getAllByRole("button", { name: /^Next / })[0]!;
        for (let i = 0; i < 6; i++) {
            fireEvent.click(next);
            await settle();
        }
        await waitFor(() => expect(said()).toBe("Oct 11, 2026 – Nov 7, 2026"));
    });

    test("the machines are read a page at a time through their indexes, and the tasks a cell at a time by their press", async () => {
        const { container: c } = await h.mount(ex.planPressTasks);
        await settle();
        await waitFor(() => expect(task(c, "T-07", ROLLERS_4)).not.toBeNull());
        expect(h.readKinds("records.plan_press_machines", "plan_press_machines_by_name")).toContain("page");
        expect(h.readKinds("records.plan_press_machines", "plan_press_machines_in_time")).toEqual(expect.arrayContaining(["find", "runs"]));
        expect(h.readKinds("records.plan_press_tasks", "plan_press_tasks_by_press_week")).toEqual(expect.arrayContaining(["find", "runs"]));
        // The footer counts the tasks of the window, eight of them, through their days' index.
        await waitFor(() => expect(c.querySelector('[data-plan-count="events"]')?.textContent).toMatch(/^8 /));
        expect(unread()).toEqual([]);
        // A press's ink temperature, read through the machines' nested series index: 28 °C rising half a degree a day, five days round.
        await waitFor(() => expect(c.querySelector(`${rowAt(entry("temperature", "P03"))} [data-plan-chart]`)?.getAttribute("aria-label"))
            .toBe(temperatureSaid(28, 30, 29.5)));
    });
});

describe("one press's own page (planOnePress)", () => {
    test("the press's own row is not drawn: its ink temperature and its kinds' rows stand at the root, and no other machine's", async () => {
        const { container: c } = await h.mount(ex.planOnePress);
        await settle();
        await waitFor(() => expect(rowsOf(c)).toEqual(keys(entry("temperature", "P03"), WASH_3, INK_3, PLATES_3)));
        expect(refused(c)).toEqual([]);
        expect(unread()).toEqual([]);
    });

    test("its tasks are read by the press its rows stand beneath, though the page draws no row of the press's own", async () => {
        const { container: c } = await h.mount(ex.planOnePress);
        await settle();
        await waitFor(() => expect(tasksOn(c, WASH_3)).toEqual(["T-01 1:0", "T-05 4:1"]));
        expect(tasksOn(c, INK_3)).toEqual(["T-02 1:1", "T-03 2:0"]);
        expect(tasksOn(c, PLATES_3)).toEqual(["T-04 3:0"]);
        // Read a cell at a time by the press, under the page's scope: never another press's.
        expect(h.readKinds("records.plan_press_tasks", "plan_press_tasks_by_press_week")).toEqual(expect.arrayContaining(["find", "runs"]));
        expect(c.querySelectorAll(`${el("data-event", "task", "T-06")}, ${el("data-event", "task", "T-07")}`).length).toBe(0);
    });

    test("its pinned ink temperature is read, though a pinned row is none of the rows laid out", async () => {
        const { container: c } = await h.mount(ex.planOnePress);
        await settle();
        await waitFor(() => expect(c.querySelector(`${rowAt(entry("temperature", "P03"))} [data-plan-chart]`)?.getAttribute("aria-label"))
            .toBe(temperatureSaid(28, 30, 29.5)));
        expect(h.readKinds("records.plan_press_machines", "plan_press_machines_in_time")).toEqual(expect.arrayContaining(["find", "runs"]));
        // The machines' rows are read under the page's scope, through the index of their codes.
        expect(h.readKinds("records.plan_press_machines", "plan_press_machines_by_code")).toContain("page");
    });
});

describe("the works' own list of kinds beneath every press (planPressKinds)", () => {
    test("every press draws a row for each kind the works lists, whether it takes the kind or not, and each task lands on its kind's", async () => {
        const { container: c } = await h.mount(ex.planPressKinds);
        await settle();
        await waitFor(() => expect(rowsOf(c)).toEqual(keys(
            entry("folder", "F1"),
            entry("press", "P03"), WASH_3, INK_3, PLATES_3, ROLLERS_3,
            entry("press", "P04"), WASH_4, INK_4, PLATES_4, ROLLERS_4,
        )));
        expect(refused(c)).toEqual([]);
        expect(unread()).toEqual([]);
        expect(tasksOn(c, WASH_3)).toEqual(["T-01 1:0", "T-05 4:1"]);
        expect(tasksOn(c, ROLLERS_3)).toEqual([]);
        expect(tasksOn(c, INK_4)).toEqual([]);
        expect(tasksOn(c, ROLLERS_4)).toEqual(["T-07 2:0", "T-08 4:0"]);
    });
});
