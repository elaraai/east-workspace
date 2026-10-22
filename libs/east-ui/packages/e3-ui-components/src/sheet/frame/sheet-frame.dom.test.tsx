/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>`'s frame and toolbar (#1184, #1216, `Sheet Builder Spec.md`
 * SB18–SB24). The Sheet's examples are mounted as a surface mounts them, over
 * their records on e3 itself (`harness.test-utils.tsx`, #1376): the frame's
 * regions and the panes it is given — none, a library, an inspector, or both
 * — the sheet's items in the frame's one toolbar, a Save's banners — a
 * conflict, a write with no answer and its Retry, the out-of-date notice and
 * its Discard — the footer's last save, a week the record does not hold, and
 * the panes' open tab and collapsed state kept under the sheet's name. A
 * record read a window at a time (`sheetPaged`, #1199) names a Save's
 * conflicting rows with the record never read whole: each row read by its key
 * at the record's new revision.
 */

import { test, expect, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { act, sheetHarness, settle, slot, tabs } from "./harness.test-utils.js";

const h = sheetHarness();
const JOBS = ex.sheetJobs;
/** The jobs' record, as its dataset's requests name it. */
const JOBS_DATASET = `records.${JOBS.name}`;
type Jobs = ValueTypeOf<typeof JOBS.type>;
const WORDS = formatters("en-US");

/** Builds a sheet's payload over the jobs record, as `<Sheet>` does — both panes, named `jobs` — and mounts it as given. */
const jobsPayload = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
    return Sheet.Payload({ record: jobs, columns: { task: Sheet.column.text(ex.SheetJob, { header: "Task" }) },
        library: [Sheet.library.rows(), Sheet.library.columns()], inspector: true, name: "jobs" });
});
const missingWeek = East.function([], SheetPayloadType, ($) => {
    const plans = $.let(Record.bind(ex.sheetWeekPlans, [ex.sheetWeekPlansPatch]));
    return Sheet.Payload({ record: plans, entry: { key: "2026-W50", rows: "rows", id: "id" }, columns: { task: Sheet.column.text(ex.WeekRow, { header: "Task" }) } });
});

/** The jobs as e3 holds them now. */
const readJobs = () => h.read(JOBS);
/** The record's commits, newest first, by the mutation that made each. */
const commits = async () => (await h.history(JOBS)).commits.map((c) => c.mutation);

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
/** The footer's last save. */
const footerSaved = (container: HTMLElement) => slot(container, "footer")!.querySelector('[data-slot="footerSaved"]')!.textContent;

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
    const workshop = await h.mount(ex.sheetWorkshop);
    // Both panes: the library's tabs, as `library` lists them, each counting its cards; the inspector's Details and Issues (#1188, SB46).
    expect(tabs(slot(workshop.container, "start")!)).toEqual(["Rows 11", "Statuses 3", "Columns 6"]);
    expect(tabs(slot(workshop.container, "end")!)).toEqual(["Details", "Issues 0"]);
    cleanup();
    const { container } = await h.mount(ex.sheetBasic);
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
    const library = await h.mount(ex.sheetLibrary);
    expect(tabs(slot(library.container, "start")!)).toEqual(["Tasks 5", "Columns 3"]);
    expect(slot(library.container, "end")).toBeNull();
    cleanup();
    const weeks = await h.mount(ex.sheetWeeks);
    expect(slot(weeks.container, "start")).toBeNull();
    expect(tabs(slot(weeks.container, "end")!)).toEqual(["Details", "Issues 0"]);
});

test("the toolbar is the frame's one row, the sheet's items in §7.1's order; the grid draws none of its own (SB19)", async () => {
    const { container } = await h.mount(ex.sheetWorkshop);
    // Main holds no toolbar: the sheet's items are the frame's (each library tab keeps its own search band).
    expect(slot(container, "main")!.querySelector('[data-slot="toolbar"], [data-toolbar]')).toBeNull();
    // The view tabs, the key search over the `rows` source, the rail over the slice's sources and its summary (#1345), and the history item last.
    expect(toolbarKeys(container)).toEqual(["tabs", "seek", "record-slices", "record-summary", "history"]);
    // ⌘F in the grid finds the key search's box in the frame's toolbar.
    const grid = slot(container, "main")!.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: "f", metaKey: true });
    await settle();
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(slot(container, "toolbar")!.contains(document.activeElement)).toBe(true);
});

test("a Save's conflict is a banner naming its row and who changed the record last, then the out-of-date notice, both gone with Discard (SB23)", async () => {
    const { container, getByRole } = await h.mount(ex.sheetBasic);
    await typeTask(container, 0, "Panel cutting, oak");
    expect(banners(container)).toEqual([]);
    // Another session moves the job just as Save goes: the Save's patch reaches e3 after its write.
    await h.race(JOBS, () => press(getByRole("button", { name: "Save" })), (jobs) => withTask(jobs, "J-0001", "Panel cutting, walnut"));
    expect(banners(container)).toEqual(["conflict", "stale"]);
    const conflict = slot(container, "banners")!.querySelector('[data-session-banner="conflict"]')!;
    expect(conflict.textContent).toContain("Save stopped — 1 conflict with the source");
    expect(conflict.textContent).toContain("J-0001: Changed since this edit began — last changed by another session");
    // The history item says nothing under its buttons: the toolbar keeps one row.
    expect(slot(container, "toolbar")!.querySelector('[role="alert"]')).toBeNull();

    press(slot(container, "banners")!.querySelector('[data-session-banner="stale"] [data-banner-action="discard"]')!);
    await settle();
    expect(banners(container)).toEqual([]);
    expect(container.querySelector('[data-slot="row"] [data-key="task"]')!.textContent).toBe("Panel cutting, walnut");
});

test("a record read a window at a time names a Save's conflicting row — read by its key at the record's new revision — and never reads the record whole (#1199, SB23)", async () => {
    const { container, getByRole } = await h.mount(ex.sheetPaged);
    expect([...container.querySelectorAll('[data-slot="row"] [data-key="task"]')].slice(0, 4).map((cell) => cell.textContent))
        .toEqual(["Panel cutting", "Edge banding", "CNC routing", "Spray finish"]);
    await typeTask(container, 0, "Panel cutting, oak");
    await typeTask(container, 1, "Edge banding, both edges");
    // Another session moves the first job just as Save goes; the second it leaves as its edit began.
    const asked = h.requests("find", JOBS_DATASET).length;
    await h.race(JOBS, () => press(getByRole("button", { name: "Save" })), (jobs) => withTask(jobs, "J-0001", "Panel cutting, walnut"));
    await waitFor(() => expect(banners(container)).toEqual(["conflict", "stale"]));
    const conflict = slot(container, "banners")!.querySelector('[data-session-banner="conflict"]')!;
    expect(conflict.textContent).toContain("Save stopped — 1 conflict with the source");
    expect(conflict.textContent).toContain("J-0001: Changed since this edit began — last changed by another session");
    expect(conflict.textContent).not.toContain("J-0002");
    // Each row the Save changed was sought by its key once it answered; the record never whole.
    const sought = h.requests("find", JOBS_DATASET).slice(asked).map((request) => request.query.get("key"));
    expect(sought).toEqual(expect.arrayContaining(['"J-0001"', '"J-0002"']));
    expect(h.requests("read", JOBS_DATASET)).toEqual([]);
});

test("a write with no answer is a banner with Retry, which sends the same request again and commits once (SB23)", async () => {
    const { container, getByRole } = await h.mount(ex.sheetBasic);
    await typeTask(container, 1, "Edge banding, both edges");
    const deployed = await commits();
    // The write reaches e3, and every answer to it is lost on its way back: the client tries again under the same
    // key until it gives up, which leaves the write unknown.
    const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === JOBS.name, "lost");
    await act(async () => { press(getByRole("button", { name: "Save" })); });
    await waitFor(() => expect(banners(container)).toEqual(["unknown"]), { timeout: 15_000 });
    const unknown = slot(container, "banners")!.querySelector('[data-session-banner="unknown"]')!;
    expect(unknown.textContent).toContain("No answer from the source — the changes may have been saved");
    expect(unknown.textContent).toContain("fetch failed: the test lost e3's answer");
    expect(slot(container, "toolbar")!.querySelector('[role="alert"]')).toBeNull();

    losing();
    await act(async () => { press(unknown.querySelector('[data-banner-action="apply"]')!); });
    await settle();
    expect(banners(container)).toEqual([]);
    expect((await readJobs()).get("J-0002")!.task).toBe("Edge banding, both edges");
    // Every try, Retry's too, under the one request id: one commit.
    const keys = h.requests("mutate", JOBS.name).map((request) => request.idempotencyKey);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys[0]).toBeDefined();
    expect(new Set(keys).size).toBe(1);
    expect(await commits()).toEqual(["patch", ...deployed]);
});

test("the footer is the sheet's, with the record's last save: the time when it was today, in full otherwise (SB22)", async () => {
    // A clock from 14:02 of one day, running, so e3 stamps another session's save on the day the sheet calls today.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-06T14:02:00Z"));
    try {
        await h.patch(JOBS, withTask(await readJobs(), "J-0004", "Spray finish, matt"));
        const saved = (await h.history(JOBS)).commits[0]!.at;
        const today = await h.mount(ex.sheetBasic);
        expect(footerSaved(today.container)).toBe("saved 14:02");
        today.unmount();
        // Two days on, the same save is said in full.
        vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
        const later = await h.mount(ex.sheetBasic);
        expect(footerSaved(later.container)).toBe(`saved ${WORDS.dateTime(saved)}`);
    } finally {
        vi.useRealTimers();
    }
});

test("an entry the record does not hold is a banner, last, until the viewer picks one it holds (SB15, SB23)", async () => {
    const direct = await h.mountPayload(missingWeek);
    expect(banners(direct.container)).toEqual(["missing"]);
    expect(slot(direct.container, "banners")!.textContent).toContain('The record holds no entry "2026-W50"');
    cleanup();

    const { container, getByText } = await h.mount(ex.sheetWeeks);
    expect(banners(container)).toEqual([]);
    fireEvent.click(getByText("2026-W44"));
    await settle();
    expect(banners(container)).toEqual(["missing"]);
    fireEvent.click(getByText("2026-W42"));
    await settle();
    expect(banners(container)).toEqual([]);
});

test("the panes are BuilderFrame's: their open tab and collapsed state persist under the sheet's name (SB24)", async () => {
    const first = await h.mountPayload(jobsPayload);
    fireEvent.click([...slot(first.container, "start")!.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Columns 1")!);
    fireEvent.click(slot(first.container, "end")!.querySelector('button[aria-label="Collapse Inspector"]')!);
    await settle();
    expect(localStorage.getItem("sheet.jobs.frame.start.dock.tab")).toBe(JSON.stringify({ key: "columns" }));
    expect(localStorage.getItem("sheet.jobs.frame.end.dock.collapsed")).toBe("true");
    first.unmount();

    const again = await h.mountPayload(jobsPayload);
    const selected = slot(again.container, "start")!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("Columns 1");
    expect(slot(again.container, "end")!.hasAttribute("data-collapsed")).toBe(true);
});
