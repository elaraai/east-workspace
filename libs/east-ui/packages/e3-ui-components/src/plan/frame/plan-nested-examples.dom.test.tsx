/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The nested series example (#1439), on e3 itself: `planNestedAll` mounts as
 * a surface mounts it, its rows read through the record's indexes and its
 * collections through the nested series index a cell at a time, its Plan built
 * with no refusal and every row drawn; its series picked, each switched off
 * and on from the library's Series tab; each series kind switched off to start
 * — a chart, events, cards and buckets — drawing, once switched on, what the
 * index holds of each works; and a crew's hours typed into a week, the works'
 * sum above moving at once, and saved: one commit, read back whole, nothing
 * left pending.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, FloatType, compareFor } from "@elaraai/east";
import { StateRuntime, UIStore, editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { instantKey, timeInstant } from "../instant.js";
import { planMessages } from "../messages.js";
import { axisFormatter } from "../rows/chart-geometry.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-nested": ex });

/** A record's path, as e3's requests name it. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

// The examples' frames as a browser lays them: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** What a mounted Plan drew: its rows — a group's strip among them — and anything it could not draw. */
function drawn(c: HTMLElement) {
    const main = slot(c, "main") ?? c;
    return {
        rows: main.querySelectorAll("[role='treegrid'] [role='row']").length,
        refused: [...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((el) => el.textContent ?? ""),
    };
}

/** Every series of planNestedAll, as the Series tab lists them. */
const SERIES = ["Jobs", "Load", "Crew hours", "Parts", "Load line", "Alarms", "Job chips", "Alarm tiles"] as const;

/** planNestedAll mounted with one series shown alone, from the library's Series tab: its works' rows at the top. */
async function alone(title: (typeof SERIES)[number]) {
    const { container: c } = await h.mount(ex.planNestedAll);
    await settle();
    const pane = slot(c, "start")!;
    fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
    await settle();
    const panel = () => pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    for (const name of SERIES) {
        const toggle = () => [...panel().querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!;
        if ((toggle().getAttribute("aria-pressed") === "true") === (name === title)) continue;
        fireEvent.click(toggle());
        await settle();
    }
    return c;
}

/** A mounted planNestedAll's Series tab, opened: its lines, each a series and whether it is on, and a toggle by its title. */
async function series(c: HTMLElement) {
    const pane = slot(c, "start")!;
    fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
    await settle();
    const panel = () => pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    return {
        lines: () => [...panel().querySelectorAll<HTMLElement>("[data-slot='pickPanel'] button[aria-pressed]")]
            .map((line) => [line.getAttribute("aria-label")!.replace(/^Toggle /, ""), line.getAttribute("aria-pressed") === "true"]),
        toggle: async (name: string) => {
            fireEvent.click([...panel().querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
            await settle();
        },
    };
}

/** The first works, W-10001, as the generator made it. */
const firstWorks = East.compile(ex.generateWorks, [])(0n, 522n);
/** The window the example opens at, its thirteen weeks from Monday 28 September 2026. */
const FROM = new Date("2026-09-28T00:00:00Z");
const TO = new Date("2026-12-28T00:00:00Z");
const order = compareFor(DateTimeType);
/** Whether an instant lies in the window. */
const inWindow = (at: Date) => order(at, FROM) >= 0 && order(at, TO) < 0;
/** The keys a row's elements draw, by the attribute naming them. */
const keysOf = (c: HTMLElement, row: string, attribute: string) =>
    [...c.querySelectorAll<HTMLElement>(`${row} [${attribute}]`)].map((el) => el.getAttribute(attribute)!);

/** The kinds of request a record was read with, through its nested series index or not. */
const kindsOf = (dataset: string, index?: string) => h.requests().filter((request) => request.dataset === dataset
    && (index === undefined || (request.query.get("index") ?? undefined) === index)).map((request) => request.kind);

/**
 * planNestedAll mounted with Jobs and Load switched off and every works unfolded, and the first crew's first week of
 * hours in the window typed 500: its cells, and how to read them.
 */
async function typedCrewHours() {
    const { container: c } = await h.mount(ex.planNestedAll);
    await settle();
    // Jobs and Load switched off, and every works unfolded: the first works' crews under its crew hours.
    const pane = slot(c, "start")!;
    fireEvent.click([...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!);
    await settle();
    for (const name of ["Jobs", "Load"]) {
        const panel = pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
        fireEvent.click([...panel.querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
        await settle();
    }
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: "Expand all" })); });
    await settle();
    // The first crew's first week of hours in the window, as the generator made it: its works' sum that week is its alone.
    const crews = [...East.compile(ex.generateWorks, [])(0n, 522n).crews.values()];
    const from = new Date("2026-09-28T00:00:00Z").getTime();
    const to = new Date("2026-12-28T00:00:00Z").getTime();
    const [week, hours] = [...crews[0]!.hours].find(([at]) => at.getTime() >= from && at.getTime() < to)!;
    expect(crews[1]!.hours.has(week)).toBe(false);
    const key = instantKey(timeInstant(week));
    const cellOf = (...path: string[]) => [...c.querySelectorAll<HTMLElement>(`${rowAt(entry(path.length === 1 ? "crews" : "crew", ...path))} [data-cell]`)]
        .find((cell) => cell.getAttribute("data-cell") === key);
    const printed = (cell: HTMLElement | undefined) => cell?.querySelector("[data-part='0']")?.textContent ?? "none";
    await waitFor(() => expect(printed(cellOf("W-10001", "C-10001-1"))).toBe(String(hours)));
    expect(printed(cellOf("W-10001"))).toBe(String(hours));
    await act(async () => { fireEvent.doubleClick(cellOf("W-10001", "C-10001-1")!); });
    const input = c.querySelector<HTMLInputElement>("[data-plan-typing] input")!;
    await act(async () => { fireEvent.input(input, { target: { value: "500" } }); });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await settle();
    return { c, cellOf, printed };
}

describe("the nested series example on e3 (#1439)", () => {
    test("planNestedAll: its rows paged lean, its collections read a cell at a time through plan_works_in_time, every row drawn", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        const { rows, refused } = drawn(c);
        expect(refused).toEqual([]);
        expect(rows).toBeGreaterThan(0);
        const dataset = pathText(ex.planWorks.path as TreePath);
        expect(kindsOf(dataset)).toContain("page");
        expect(kindsOf(dataset, ex.planWorks.indexes.plan_works_in_time.name)).toContain("runs");
        // Nothing read whole, nor a row by its key: no gesture asked for one.
        expect(h.requests("rows", dataset)).toEqual([]);
        expect(h.requests("read", dataset)).toEqual([]);
    });

    test("planNestedAll: the Series tab lists every series, and switching one off takes its rows and on brings them back", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        const pane = slot(c, "start")!;
        const tab = [...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith("Series "))!;
        fireEvent.click(tab);
        await settle();
        const panel = () => pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
        const lines = () => [...panel().querySelectorAll<HTMLElement>("[data-slot='pickPanel'] button[aria-pressed]")]
            .map((line) => [line.getAttribute("aria-label")!.replace(/^Toggle /, ""), line.getAttribute("aria-pressed") === "true"]);
        expect(lines()).toEqual([["Jobs", true], ["Load", true], ["Crew hours", true], ["Parts", true],
            ["Load line", false], ["Alarms", false], ["Job chips", false], ["Alarm tiles", false]]);
        const jobs = () => slot(c, "main")!.querySelector(rowAt(entry("works", "W-10001")));
        expect(jobs()).not.toBeNull();
        const toggle = async (name: string) => {
            fireEvent.click([...panel().querySelectorAll<HTMLElement>("button[aria-pressed]")].find((b) => b.getAttribute("aria-label") === `Toggle ${name}`)!);
            await settle();
        };
        await toggle("Jobs");
        await waitFor(() => expect(jobs()).toBeNull());
        // On again, its rows come back above the load the view kept: at the top, the first works' jobs draw again.
        await toggle("Jobs");
        await act(async () => { c.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!.scrollTo({ top: 0 }); });
        await waitFor(() => expect(jobs()?.querySelector("[data-run]")).not.toBeNull());
    });

    test("planNestedAll: the series a viewer switched open as they were left after a reload", async () => {
        const first = await h.mount(ex.planNestedAll);
        await settle();
        const tab = await series(first.container);
        // The load as a line alone, its rows at the top: the alarms, chips and tiles stay off, as they start.
        for (const name of ["Jobs", "Load", "Crew hours", "Parts", "Load line"]) await tab.toggle(name);
        first.unmount();

        // A reload: a new page's store, holding the pick as the program sets it, and the browser's storage kept.
        StateRuntime.initializeStore(new UIStore());
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        expect((await series(c)).lines()).toEqual([["Jobs", false], ["Load", false], ["Crew hours", false], ["Parts", false],
            ["Load line", true], ["Alarms", false], ["Job chips", false], ["Alarm tiles", false]]);
        expect(slot(c, "main")!.querySelector(rowAt(entry("works", "W-10001")))).toBeNull();
        await waitFor(() => expect(slot(c, "main")!.querySelector(rowAt(entry("load-line", "W-10001")))).not.toBeNull());
        // Kept under the pick's own key.
        expect(new Set(JSON.parse(localStorage.getItem("pick.ex.planNestedAll.series")!))).toEqual(new Set(["works", "load", "crews", "assembly", "alarm-marks", "job-chips", "alarm-tiles"]));
    });

    test("planNestedAll: with every series switched off, the strip still spans what they hold", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        const caption = () => c.querySelector("[data-plan-horizon-caption]")?.textContent;
        await waitFor(() => expect(caption()).toBeDefined());
        const spanned = caption();
        const tab = await series(c);
        for (const name of ["Jobs", "Load", "Crew hours", "Parts"]) await tab.toggle(name);
        expect(tab.lines().filter(([, on]) => on)).toEqual([]);
        // The horizon as it was — not the window and as much again either side. (Its bars are measured in the browser:
        // jsdom lays the strip out at no width.)
        expect(caption()).toBe(spanned);
    });

    test("planNestedAll: its load as a line, switched on, reads the works' load through the index: the chart says its least, greatest and last value in the window", async () => {
        const c = await alone("Load line");
        const values = [...firstWorks.load].filter(([at]) => inWindow(at)).map(([, value]) => value);
        expect(values.length).toBeGreaterThan(1);
        const sorted = [...values].sort(compareFor(FloatType));
        const fmt = axisFormatter(undefined, "en-US");
        const said = planMessages.chartSummary({ parts: [planMessages.chartLayerValues({
            layer: planMessages.chartLayer({ kind: "line", index: undefined }),
            min: fmt(sorted[0]!), max: fmt(sorted[sorted.length - 1]!), last: fmt(values[values.length - 1]!), n: 0, breaches: "0",
        })] });
        await waitFor(() => expect(c.querySelector(`${rowAt(entry("load-line", "W-10001"))} [data-plan-chart]`)?.getAttribute("aria-label")).toBe(said));
    });

    test("planNestedAll: its alarms as marks, switched on, read through the index: each mark one of the works' alarms, the one in the window among them", async () => {
        const c = await alone("Alarms");
        const row = rowAt(entry("alarm-marks", "W-10001"));
        const shown = [...firstWorks.alarms].filter(([, alarm]) => inWindow(alarm.at)).map(([id]) => id);
        expect(shown.length).toBeGreaterThan(0);
        await waitFor(() => expect(keysOf(c, row, "data-mark")).toEqual(expect.arrayContaining(shown)));
        expect(keysOf(c, row, "data-mark").filter((key) => !firstWorks.alarms.has(key))).toEqual([]);
    });

    test("planNestedAll: its jobs as chips, switched on, read through the index: each chip one of the works' jobs, those in the window among them", async () => {
        const c = await alone("Job chips");
        const row = rowAt(entry("job-chips", "W-10001"));
        const shown = [...firstWorks.jobs].filter(([, job]) => order(job.end, FROM) > 0 && order(job.start, TO) < 0).map(([id]) => id);
        expect(shown.length).toBeGreaterThan(0);
        await waitFor(() => expect(keysOf(c, row, "data-chip")).toEqual(expect.arrayContaining(shown)));
        expect(keysOf(c, row, "data-chip").filter((key) => !firstWorks.jobs.has(key))).toEqual([]);
    });

    test("planNestedAll: its alarms as tiles, switched on, read through the index: each tile one of the works' alarms, the one in the window among them", async () => {
        const c = await alone("Alarm tiles");
        const row = rowAt(entry("alarm-tiles", "W-10001"));
        const shown = [...firstWorks.alarms].filter(([, alarm]) => inWindow(alarm.at)).map(([id]) => id);
        expect(shown.length).toBeGreaterThan(0);
        await waitFor(() => expect(keysOf(c, row, "data-event")).toEqual(expect.arrayContaining(shown)));
        expect(keysOf(c, row, "data-event").filter((key) => !firstWorks.alarms.has(key))).toEqual([]);
    });

    test("planNestedAll: a crew's hours typed into a week move the works' sum above at once", async () => {
        const { c, cellOf, printed } = await typedCrewHours();
        await waitFor(() => expect(printed(cellOf("W-10001", "C-10001-1"))).toBe("500"));
        await waitFor(() => expect(printed(cellOf("W-10001"))).toBe("500"));
    });

    test("planNestedAll: a crew's hours typed are saved: one commit of the works record, read back with nothing pending", async () => {
        const { c, cellOf, printed } = await typedCrewHours();
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
        await settle();
        expect(h.requests("mutate", ex.planWorks.name)).toHaveLength(1);
        await waitFor(() => expect(slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent).toBe("0 pending"));
        expect([...(slot(c, "banners")?.querySelectorAll("[data-session-banner]") ?? [])].map((banner) => banner.textContent)).toEqual([]);
        expect(printed(cellOf("W-10001", "C-10001-1"))).toBe("500");
    });
});
