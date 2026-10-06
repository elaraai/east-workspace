/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>`'s frame and toolbar (#1184, #1216, `Sheet Builder Spec.md`
 * SB18–SB24). The Sheet's examples are mounted under the record runtime a
 * surface installs, over the in-memory stand-in records, whose patch door
 * applies each patch with East's own checks (`harness.test-utils.tsx`): the
 * frame's regions and the panes it is given — none, a library, an inspector,
 * or both — the sheet's items in the frame's one toolbar, an Apply's banners
 * — a conflict, a write with no answer and its Retry, the out-of-date notice
 * and its Discard — the footer's last save, a week the record does not hold,
 * and the panes' open tab and collapsed state kept under the sheet's name.
 */

import { test, expect } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import {
    East, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { initializeRecordApi } from "../../platform/index.js";
import { todayUtc } from "../parse/date.js";
import { WORKSPACE, sheetHarness, mount, mountPayload, settle, slot, tabs } from "./harness.test-utils.js";

const harness = sheetHarness();
const JOBS = ex.sheetJobs;
type Jobs = ValueTypeOf<typeof JOBS.type>;
const JobsPatch = PatchType(JOBS.type);
const WORDS = formatters("en-US");

/** Builds a sheet's payload over the jobs record, as `<Sheet>` does — both panes, named `jobs` — and mounts it as given. */
const jobsPayload = East.compile(East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
    return Sheet.Payload({ record: jobs, columns: { task: Sheet.column.text(ex.SheetJob, { header: "Task" }) },
        library: [Sheet.library.rows(), Sheet.library.columns()], inspector: true, name: "jobs" });
}), getRegisteredPlatformImplementations());
const missingWeek = East.compile(East.function([], SheetPayloadType, ($) => {
    const plans = $.let(Record.bind(ex.sheetWeekPlans, [ex.sheetWeekPlansPatch]));
    return Sheet.Payload({ record: plans, entry: { key: "2026-W50", rows: "rows", id: "id" }, columns: { task: Sheet.column.text(ex.WeekRow, { header: "Task" }) } });
}), getRegisteredPlatformImplementations());

/** The record as it stands — what its patch door last wrote. */
function readJobs(): Jobs {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", JOBS.name)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(JOBS.type)(bytes);
}

/** The jobs record with one job's task changed. */
function withTask(jobs: Jobs, key: string, task: string): Jobs {
    const next = new SortedMap([...jobs], compareFor(StringType));
    next.set(key, { ...jobs.get(key)!, task });
    return next;
}

const banners = (container: HTMLElement) => [...(slot(container, "banners")?.querySelectorAll("[data-session-banner], [data-sheet-banner]") ?? [])]
    .map((el) => el.getAttribute("data-session-banner") ?? el.getAttribute("data-sheet-banner"));
const toolbarKeys = (container: HTMLElement) => (slot(container, "toolbar")!.querySelector("[data-toolbar]")!.getAttribute("data-toolbar-state") ?? "")
    .split(";").map((item) => item.split("=")[0]);

/** Types a job's new task in its row's cell, committed with ⏎. */
async function typeTask(container: HTMLElement, row: number, task: string) {
    const cell = container.querySelectorAll('[data-slot="row"] [data-key="task"]')[row]!;
    fireEvent.doubleClick(cell);
    await settle();
    const input = container.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: task } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
}

function press(button: Element) {
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
}

test("the Sheet is a BuilderFrame: main holding the grid and its strip, the footer, and the panes it is given (SB18, SB21)", async () => {
    const workshop = mount(ex.sheetWorkshop);
    await settle();
    // Both panes: the library's tabs, as `library` lists them, each counting its cards; the inspector's Details and Issues (#1188, SB46).
    expect(tabs(slot(workshop.container, "start")!)).toEqual(["Rows 11", "Statuses 3", "Columns 6"]);
    expect(tabs(slot(workshop.container, "end")!)).toEqual(["Details", "Issues 0"]);
    cleanup();
    const { container } = mount(ex.sheetBasic);
    await settle();
    expect(container.querySelector("[data-builder-frame]")).not.toBeNull();
    // The smallest is given no pane: no library (SB59), no inspector.
    expect(slot(container, "start")).toBeNull();
    expect(slot(container, "end")).toBeNull();
    const main = slot(container, "main")!;
    // The grid fills main, a bounded frame scrolling its own rows, in key order.
    expect(main.querySelector('[data-sheet] [role="grid"] [data-virtual-rows="bounded"]')).not.toBeNull();
    expect([...main.querySelectorAll('[data-slot="row"] [data-key="task"]')].slice(0, 4).map((cell) => cell.textContent))
        .toEqual(["Panel cutting", "Edge banding", "CNC routing", "Spray finish"]);
    // While a date is edited, the strip is docked under the grid, in main, saying what it accepts.
    fireEvent.doubleClick(main.querySelector('[data-slot="row"] [data-key="start"]')!);
    await settle();
    const strip = main.querySelector('[data-sheet] [data-slot="strip"]');
    expect(strip).not.toBeNull();
    const grid = main.querySelector('[data-sheet] [role="grid"]')!;
    expect(grid.compareDocumentPosition(strip!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot(container, "footer")!.querySelector('[data-slot="footer"]')).not.toBeNull();
});

test("the panes are optional props: a sheet given a library has a start pane alone, one given an inspector an end pane alone (#1216)", async () => {
    const library = mount(ex.sheetLibrary);
    await settle();
    expect(tabs(slot(library.container, "start")!)).toEqual(["Tasks 5", "Columns 3"]);
    expect(slot(library.container, "end")).toBeNull();
    cleanup();
    const weeks = mount(ex.sheetWeeks);
    await settle();
    expect(slot(weeks.container, "start")).toBeNull();
    expect(tabs(slot(weeks.container, "end")!)).toEqual(["Details", "Issues 0"]);
});

test("the toolbar is the frame's one row, the sheet's items in §7.1's order; the grid draws none of its own (SB19)", async () => {
    const { container } = mount(ex.sheetWorkshop);
    await settle();
    // Main holds no toolbar: the sheet's items are the frame's (each library tab keeps its own search band).
    expect(slot(container, "main")!.querySelector('[data-slot="toolbar"], [data-toolbar]')).toBeNull();
    // The view tabs, the slice's rail, and the history item last.
    expect(toolbarKeys(container)).toEqual(["tabs", "rail", "history"]);
    // ⌘F in the grid finds the search box in the frame's toolbar.
    const grid = slot(container, "main")!.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: "f", metaKey: true });
    await settle();
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(slot(container, "toolbar")!.contains(document.activeElement)).toBe(true);
});

test("an Apply's conflict is a banner naming its row and who changed the record last, then the out-of-date notice, both gone with Discard (SB23)", async () => {
    const { container, getByRole } = mount(ex.sheetBasic);
    await settle();
    await typeTask(container, 0, "Panel cutting, oak");
    expect(banners(container)).toEqual([]);
    // Another write moves the job just as Apply goes.
    const moved = encodeBeast2For(JobsPatch)(diffFor(JOBS.type)(readJobs(), withTask(readJobs(), "J-0001", "Panel cutting, walnut")));
    await act(async () => {
        void harness.memory.mutate(WORKSPACE, JOBS.name, "patch", { args: [moved] });
        press(getByRole("button", { name: "Apply changes" }));
    });
    await settle();
    expect(banners(container)).toEqual(["conflict", "stale"]);
    const conflict = slot(container, "banners")!.querySelector('[data-session-banner="conflict"]')!;
    expect(conflict.textContent).toContain("Apply stopped — 1 conflict with the source");
    expect(conflict.textContent).toContain("J-0001: Changed since this edit began — last changed by memory");
    // The history item says nothing under its buttons: the toolbar keeps one row.
    expect(slot(container, "toolbar")!.querySelector('[role="alert"]')).toBeNull();

    press(slot(container, "banners")!.querySelector('[data-session-banner="stale"] [data-banner-action="discard"]')!);
    await settle();
    expect(banners(container)).toEqual([]);
    expect(container.querySelector('[data-slot="row"] [data-key="task"]')!.textContent).toBe("Panel cutting, walnut");
});

test("a write with no answer is a banner with Retry, which sends the same request again and commits once (SB23)", async () => {
    const { container, getByRole } = mount(ex.sheetBasic);
    await settle();
    await typeTask(container, 1, "Edge banding, both edges");
    // The write goes out and nothing comes back.
    initializeRecordApi({ ...harness.memory, mutate: async () => { throw new Error("The connection closed"); } }, harness.cache, WORKSPACE);
    await act(async () => { press(getByRole("button", { name: "Apply changes" })); });
    await settle();
    expect(banners(container)).toEqual(["unknown"]);
    const unknown = slot(container, "banners")!.querySelector('[data-session-banner="unknown"]')!;
    expect(unknown.textContent).toContain("No answer from the source — the changes may have been applied");
    expect(unknown.textContent).toContain("The connection closed");
    expect(slot(container, "toolbar")!.querySelector('[role="alert"]')).toBeNull();

    initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
    await act(async () => { press(unknown.querySelector('[data-banner-action="apply"]')!); });
    await settle();
    expect(banners(container)).toEqual([]);
    expect(readJobs().get("J-0002")!.task).toBe("Edge banding, both edges");
    const { commits } = await harness.memory.history(WORKSPACE, JOBS.name, undefined);
    expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
});

test("the footer is the sheet's, with the record's last save: the time when it was today, in full otherwise (SB22)", async () => {
    const { container, unmount } = mount(ex.sheetBasic);
    await settle();
    // The stand-in records commit at the epoch.
    expect(slot(container, "footer")!.querySelector('[data-slot="footerSaved"]')!.textContent).toBe(`saved ${WORDS.dateTime(new Date(0))}`);
    unmount();

    const at = new Date(todayUtc().getTime() + (14 * 60 + 2) * 60_000);
    const today = mountPayload({
        ...jobsPayload(),
        history: some(() => some([{ hash: "h1", parent: none, state: "s1", mutation: "patch", actor: "planner", at, delta: none }])),
    });
    await settle();
    expect(slot(today.container, "footer")!.querySelector('[data-slot="footerSaved"]')!.textContent).toBe("saved 14:02");
});

test("an entry the record does not hold is a banner, last, until the viewer picks one it holds (SB15, SB23)", async () => {
    const direct = mountPayload(missingWeek());
    await settle();
    expect(banners(direct.container)).toEqual(["missing"]);
    expect(slot(direct.container, "banners")!.textContent).toContain('The record holds no entry "2026-W50"');
    cleanup();

    const { container, getByText } = mount(ex.sheetWeeks);
    await settle();
    expect(banners(container)).toEqual([]);
    fireEvent.click(getByText("2026-W44"));
    await settle();
    expect(banners(container)).toEqual(["missing"]);
    fireEvent.click(getByText("2026-W42"));
    await settle();
    expect(banners(container)).toEqual([]);
});

test("the panes are BuilderFrame's: their open tab and collapsed state persist under the sheet's name (SB24)", async () => {
    const first = mountPayload(jobsPayload());
    await settle();
    fireEvent.click([...slot(first.container, "start")!.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Columns 1")!);
    fireEvent.click(slot(first.container, "end")!.querySelector('button[aria-label="Collapse Inspector"]')!);
    await settle();
    expect(localStorage.getItem("sheet.jobs.frame.start.dock.tab")).toBe(JSON.stringify({ key: "columns" }));
    expect(localStorage.getItem("sheet.jobs.frame.end.dock.collapsed")).toBe("true");
    first.unmount();

    const again = mountPayload(jobsPayload());
    await settle();
    const selected = slot(again.container, "start")!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("Columns 1");
    expect(slot(again.container, "end")!.hasAttribute("data-collapsed")).toBe(true);
});
