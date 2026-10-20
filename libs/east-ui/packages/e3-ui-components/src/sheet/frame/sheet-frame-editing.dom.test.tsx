/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>`'s editing, undo and Save (#1185, #1216, `Sheet Builder Spec.md`
 * SB25–SB31), over the Sheet's records on e3 itself (`harness.test-utils.tsx`,
 * #1376): each gesture one transaction, undone and redone from the history
 * item and from the keys anywhere in the frame, never while typing in a field;
 * Save one commit through the record's patch door, the history item naming
 * each state on the way; a conflict and a refusal keeping the drafts; a write
 * with no answer retried under its own request id; the drafts retiring once
 * the rows read back — whatever another write did beside them — and going out
 * of date when the record moves under them; each week its own drafts; and
 * auto mode.
 */

import { test, expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, some, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record, Sheet } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { patchRecord } from "../../e3-web.test-utils.js";
import { act, sheetHarness, settle, slot } from "./harness.test-utils.js";

const h = sheetHarness();
const JOBS = ex.sheetJobs;
const PLANS = ex.sheetWeekPlans;
/** The jobs' record, as its dataset's requests name it. */
const JOBS_DATASET = `records.${JOBS.name}`;
type Jobs = ValueTypeOf<typeof JOBS.type>;
type Job = ValueTypeOf<typeof ex.SheetJob>;

/** The jobs, saved as each gesture lands (SB31). */
const autoJobs = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
        return Sheet({ record: jobs, columns: { task: Sheet.column.text(ex.SheetJob, { header: "Task" }) }, applyMode: "auto", name: "auto" });
    }))),
};

/** The jobs, given both panes: a library of the columns, with its search, and the inspector. */
const panedJobs = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
        return Sheet({ record: jobs, columns: { task: Sheet.column.text(ex.SheetJob, { header: "Task" }) },
            library: [Sheet.library.columns()], inspector: true, name: "panes" });
    }))),
};

/** The edge bander's jobs, whose patch door refuses jobs that band both edges: the bander is booked that week. */
const bookedJobs = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const jobs = $.let(Record.bind(ex.sheetBookedJobs, [ex.sheetBookedJobsPatch]));
        return Sheet({ record: jobs, columns: { task: Sheet.column.text(ex.SheetJob, { header: "Task" }) }, name: "booked" });
    }))),
};

/** The jobs as e3 holds them now. */
const readJobs = () => h.read(JOBS);
/** The plans as e3 holds them now. */
const readPlans = () => h.read(PLANS);

/** A record's commits, newest first, by the mutation that made each. */
async function commits(record: { readonly name: string }): Promise<string[]> {
    return (await h.history(record)).commits.map((c) => c.mutation);
}

/** The jobs given, with a job's fields changed: what another planner's write commits. */
function jobWith(jobs: Jobs, key: string, change: Partial<Job>): Jobs {
    const next = new SortedMap([...jobs], compareFor(StringType));
    next.set(key, { ...jobs.get(key)!, ...change });
    return next;
}

/** Another planner's write to the jobs: a job's fields changed through the record's patch door, as e3 holds them now. */
async function writeJob(key: string, change: Partial<Job>) {
    await h.patch(JOBS, jobWith(await readJobs(), key, change));
}

/** The rows' cells under a column — the rows the record holds and the new ones, never the blank tail. */
const cells = (container: HTMLElement, key: string) =>
    [...slot(container, "main")!.querySelectorAll(`[data-slot="row"]:not([data-blank]) [data-key="${key}"]`)];
const tasks = (container: HTMLElement) => cells(container, "task").map((cell) => cell.textContent);
/** The rows whose drafts differ from what the record holds. */
const drafted = (container: HTMLElement) => slot(container, "main")!.querySelectorAll('[data-slot="row"][data-draft]').length;
const card = (container: HTMLElement) => slot(container, "main")!.querySelector<HTMLElement>("[data-sheet-card]")!;
const toolbar = (container: HTMLElement) => within(slot(container, "toolbar")!);
/** The history item's status line, if it shows one. */
const statusLine = (container: HTMLElement) => slot(container, "toolbar")!.querySelector('[data-slot="history"] [role="status"]')?.textContent;
const banners = (container: HTMLElement) => [...(slot(container, "banners")?.querySelectorAll("[data-session-banner]") ?? [])]
    .map((el) => el.getAttribute("data-session-banner"));
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled;

/** Types a cell's new text in the row's editor, committed with ⏎. */
async function typeInto(cell: Element, text: string) {
    fireEvent.doubleClick(cell);
    await settle();
    const input = document.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: text } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
}

/** Clicks a button, as a pointer does. */
function click(button: Element) {
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
}

/** Presses a button and lets what it starts settle. */
async function press(button: Element) {
    await act(async () => { click(button); });
    await settle();
}

/** A key with ⌘ held, pressed on an element. */
async function command(el: Element, key: string, shift = false) {
    fireEvent.keyDown(el, { key, metaKey: true, shiftKey: shift });
    await settle();
}

test("each gesture is one transaction — typing, a paste across rows, an insert, a removal — undone and redone a step at a time from the history item (SB25)", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    const before = ["Panel cutting", "Edge banding", "CNC routing", "Spray finish"];
    expect(tasks(container)).toEqual(before);
    // Typing one cell.
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // A paste across two rows.
    fireEvent.mouseDown(cells(container, "task")[2]!, { button: 0 });
    await act(async () => { fireEvent.paste(card(container), { clipboardData: { getData: () => "CNC routing, oak\nSpray finish, matt" } }); });
    await settle();
    // A new job, typed on the blank tail: its minted key sorts after the record's.
    await typeInto(slot(container, "main")!.querySelector('[data-slot="row"][data-blank] [data-key="task"]')!, "Sanding");
    // J-0002 picked by its number and deleted.
    fireEvent.mouseDown(cells(container, "task")[1]!.closest('[data-slot="row"]')!.querySelector('[data-slot="gutter"]')!, { button: 0 });
    fireEvent.keyDown(card(container), { key: "Backspace" });
    await settle();
    const after = ["Panel cutting, oak", "CNC routing, oak", "Spray finish, matt", "Sanding"];
    expect(tasks(container)).toEqual(after);
    // Each Undo takes back one gesture, whole.
    const undo = toolbar(container).getByRole("button", { name: "Undo" });
    await press(undo);
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing, oak", "Spray finish, matt", "Sanding"]);
    await press(undo);
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing, oak", "Spray finish, matt"]);
    await press(undo);
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing", "Spray finish"]);
    await press(undo);
    expect(tasks(container)).toEqual(before);
    expect(disabled(undo)).toBe(true);
    // Redo replays them, a gesture at a time; the record holds none of it.
    const redo = toolbar(container).getByRole("button", { name: "Redo" });
    for (let i = 0; i < 4; i++) await press(redo);
    expect(tasks(container)).toEqual(after);
    expect(disabled(redo)).toBe(true);
    expect([...(await readJobs()).values()].map((job) => job.task)).toEqual(before);
});

test("⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the frame — the grid a step at a time, a pane's tab — never while typing in the library's search (SB26)", async () => {
    const { container } = await h.mount(panedJobs);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    await typeInto(cells(container, "task")[1]!, "Edge banding, oak");
    // In the grid: its own keys, one step — the frame does not take the same key again.
    card(container).focus();
    await command(card(container), "z");
    expect(tasks(container).slice(0, 2)).toEqual(["Panel cutting, oak", "Edge banding"]);
    // Typing in the library's search: the field's own undo, and the drafts stay.
    const search = slot(container, "start")!.querySelector("input")!;
    search.focus();
    await command(search, "z");
    expect(tasks(container).slice(0, 2)).toEqual(["Panel cutting, oak", "Edge banding"]);
    // On the inspector's tab: the frame's — undone.
    const details = slot(container, "end")!.querySelector('[role="tab"]')!;
    await command(details, "z");
    expect(tasks(container).slice(0, 2)).toEqual(["Panel cutting", "Edge banding"]);
    // ⇧⌘Z there, then Ctrl+Y on the library's tab, redo.
    await command(details, "Z", true);
    expect(tasks(container).slice(0, 2)).toEqual(["Panel cutting, oak", "Edge banding"]);
    fireEvent.keyDown(slot(container, "start")!.querySelector('[role="tab"]')!, { key: "y", ctrlKey: true });
    await settle();
    expect(tasks(container).slice(0, 2)).toEqual(["Panel cutting, oak", "Edge banding, oak"]);
});

test("Save is one commit through the record's patch door: the history item says saving, then confirming, and the drafts retire once the rows read back as it left them (SB26, SB27, SB29)", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    const deployed = await commits(JOBS);
    const save = toolbar(container).getByRole("button", { name: "Save" });
    // Nothing to save yet.
    expect(disabled(save)).toBe(true);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    expect(disabled(save)).toBe(false);
    expect(drafted(container)).toBe(1);
    // The write held on its way to e3: Saving.
    const writing = h.e3.hold((request) => request.kind === "mutate" && request.record === JOBS.name);
    await press(save);
    expect(statusLine(container)).toBe("Saving…");
    // It commits, the record's read back held on its way: Saved, confirming — the draft stays until the row reads back.
    const readBack = h.e3.hold((request) => request.kind === "read" && request.dataset === JOBS_DATASET);
    await act(async () => { writing.release(); });
    await readBack.holding;
    await settle();
    expect((await readJobs()).get("J-0001")!.task).toBe("Panel cutting, oak");
    expect(await commits(JOBS)).toEqual(["patch", ...deployed]);
    expect(statusLine(container)).toBe("Saved — loading the confirmed revision…");
    expect(drafted(container)).toBe(1);
    // The rows read back: the drafts retire, and the history item says nothing.
    await act(async () => { readBack.release(); });
    await settle();
    expect(statusLine(container)).toBeUndefined();
    expect(drafted(container)).toBe(0);
    expect(tasks(container)[0]).toBe("Panel cutting, oak");
    expect(disabled(save)).toBe(true);
});

test("a conflict keeps every draft, with its banner and the out-of-date notice; Save is off, and nothing is rebased (SB28, SB29)", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // Another write moves the same job just as Save goes: the Save's patch reaches e3 after it.
    await h.race(JOBS, () => click(toolbar(container).getByRole("button", { name: "Save" })),
        (jobs) => jobWith(jobs, "J-0001", { task: "Panel cutting, walnut" }));
    expect(banners(container)).toEqual(["conflict", "stale"]);
    expect(statusLine(container)).toBe("Source changed — review or discard these drafts");
    // The draft stands, unrebased, over the record's new value.
    expect(tasks(container)[0]).toBe("Panel cutting, oak");
    expect(drafted(container)).toBe(1);
    expect(disabled(toolbar(container).getByRole("button", { name: "Save" }))).toBe(true);
    expect((await readJobs()).get("J-0001")!.task).toBe("Panel cutting, walnut");
});

test("a refusal keeps every draft, with its banner and the reason; a revised draft may be saved again (SB28)", async () => {
    // The edge bander is booked that week: its jobs' patch door refuses a job that bands both edges.
    const { container } = await h.mount(bookedJobs);
    await typeInto(cells(container, "task")[1]!, "Edge banding, both edges");
    await press(toolbar(container).getByRole("button", { name: "Save" }));
    expect(banners(container)).toEqual(["rejected"]);
    const refused = slot(container, "banners")!.querySelector('[data-session-banner="rejected"]')!;
    expect(refused.textContent).toContain("The source refused these changes");
    expect(refused.textContent).toContain("The write failed: ");
    expect(refused.textContent).toContain("the edge bander is booked that week");
    expect(statusLine(container)).toBe("Changes rejected — revise the draft before saving");
    expect(tasks(container)[1]).toBe("Edge banding, both edges");
    expect(drafted(container)).toBe(1);
    // The same request is never sent again: Save waits for a revision.
    expect(disabled(toolbar(container).getByRole("button", { name: "Save" }))).toBe(true);
    await typeInto(cells(container, "task")[1]!, "Edge banding, one edge");
    expect(banners(container)).toEqual([]);
    await press(toolbar(container).getByRole("button", { name: "Save" }));
    expect((await h.read(ex.sheetBookedJobs)).get("J-0002")!.task).toBe("Edge banding, one edge");
    expect(drafted(container)).toBe(0);
});

test("a write with no answer leaves the session unknown: Save turns into Retry, which sends the same request — its id unchanged — and never writes twice (SB28)", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    await typeInto(cells(container, "task")[2]!, "CNC routing, both faces");
    const deployed = await commits(JOBS);
    // The write reaches e3, and every answer to it is lost on its way back: the client tries again under the same
    // id until it gives up, which leaves the session unknown.
    const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === JOBS.name, "lost");
    await act(async () => { click(toolbar(container).getByRole("button", { name: "Save" })); });
    await waitFor(() => expect(banners(container)).toEqual(["unknown"]), { timeout: 15_000 });
    expect(statusLine(container)).toBe("Awaiting confirmation — retry the same request");
    expect(toolbar(container).queryByRole("button", { name: "Save" })).toBeNull();
    // No gesture while the request is unresolved.
    expect(disabled(toolbar(container).getByRole("button", { name: "Undo" }))).toBe(true);
    losing();
    await press(toolbar(container).getByRole("button", { name: "Retry request" }));
    const keys = h.requests("mutate", JOBS.name).map((request) => request.idempotencyKey);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys[0]).toBeDefined();
    expect(new Set(keys).size).toBe(1);
    expect(await commits(JOBS)).toEqual(["patch", ...deployed]);
    expect(banners(container)).toEqual([]);
    expect(statusLine(container)).toBeUndefined();
    expect(drafted(container)).toBe(0);
    expect((await readJobs()).get("J-0003")!.task).toBe("CNC routing, both faces");
});

test("the record moving under pending drafts makes the session out of date: Save is off, a banner offers Discard, and nothing is rebased (SB29)", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // Another write, to another job.
    await writeJob("J-0003", { task: "CNC routing, ash" });
    expect(banners(container)).toEqual(["stale"]);
    expect(statusLine(container)).toBe("Source changed — review or discard these drafts");
    expect(disabled(toolbar(container).getByRole("button", { name: "Save" }))).toBe(true);
    // The draft as it was, over the record as it is.
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing, ash", "Spray finish"]);
    await press(slot(container, "banners")!.querySelector('[data-session-banner="stale"] [data-banner-action="discard"]')!);
    expect(banners(container)).toEqual([]);
    expect(tasks(container)).toEqual(["Panel cutting", "Edge banding", "CNC routing, ash", "Spray finish"]);
    expect(drafted(container)).toBe(0);
});

test("a commit to a record read whole confirms once its own rows read back, whatever another write did meanwhile — to another row, or to another field of its own (#1185, SB29)", async () => {
    const { container } = await h.mount(ex.sheetBasic);
    const deployed = await commits(JOBS);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // Right after this commit, before the sheet reads it back, another planner writes J-0003's task and J-0001's quantity.
    const readBack = h.e3.hold((request) => request.kind === "read" && request.dataset === JOBS_DATASET);
    await act(async () => { click(toolbar(container).getByRole("button", { name: "Save" })); });
    await readBack.holding;
    await patchRecord(h.e3, h.workspace, JOBS, jobWith(await readJobs(), "J-0003", { task: "CNC routing, ash" }));
    await patchRecord(h.e3, h.workspace, JOBS, jobWith(await readJobs(), "J-0001", { qty: some(52.0) }));
    await act(async () => { readBack.release(); });
    await settle();
    // Confirmed: no status line, no draft, the record as the three writes left it.
    expect(statusLine(container)).toBeUndefined();
    expect(banners(container)).toEqual([]);
    expect(drafted(container)).toBe(0);
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing, ash", "Spray finish"]);
    expect(cells(container, "qty")[0]!.textContent).toBe("52");
    expect(await commits(JOBS)).toEqual(["patch", "patch", "patch", ...deployed]);
    // The next edit of J-0001 begins from the record's version: its Save commits, keeping the other planner's quantity.
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak veneer");
    await press(toolbar(container).getByRole("button", { name: "Save" }));
    expect(banners(container)).toEqual([]);
    expect((await readJobs()).get("J-0001")).toEqual({ task: "Panel cutting, oak veneer", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(52.0) });
    expect(drafted(container)).toBe(0);
});

test("each week keeps its own drafts across a switch of the entry, and a remount finds them, until Save or Discard (SB17, SB30)", async () => {
    const view = await h.mount(ex.sheetWeeks);
    expect(tasks(view.container)).toEqual(["Cut the kitchen carcasses", "Band the carcass edges", "Route the door panels"]);
    await typeInto(cells(view.container, "task")[0]!, "Cut the oak carcasses");
    // Another week: its own rows, no draft of the first's.
    fireEvent.click(view.getByText("2026-W43"));
    await settle();
    expect(tasks(view.container)).toEqual(["Assemble the wardrobes", "Spray the vanity doors"]);
    expect(drafted(view.container)).toBe(0);
    await typeInto(cells(view.container, "task")[0]!, "Assemble the ash wardrobes");
    // Back: the first week's draft, as it was left.
    fireEvent.click(view.getByText("2026-W42"));
    await settle();
    expect(tasks(view.container)[0]).toBe("Cut the oak carcasses");
    expect(drafted(view.container)).toBe(1);
    // Its Save commits its own rows alone.
    await press(toolbar(view.container).getByRole("button", { name: "Save" }));
    expect((await readPlans()).get("2026-W42")!.rows[0]!.task).toBe("Cut the oak carcasses");
    expect((await readPlans()).get("2026-W43")!.rows[0]!.task).toBe("Assemble the wardrobes");
    // The other week's draft outlives the switch and a remount.
    fireEvent.click(view.getByText("2026-W43"));
    await settle();
    view.unmount();
    const again = await h.mount(ex.sheetWeeks);
    expect(tasks(again.container)[0]).toBe("Assemble the ash wardrobes");
    expect(drafted(again.container)).toBe(1);
    await press(toolbar(again.container).getByRole("button", { name: "Discard" }));
    expect(tasks(again.container)[0]).toBe("Assemble the wardrobes");
    expect(drafted(again.container)).toBe(0);
});

test("auto mode sends each ready gesture as it lands, through the same protocol; Undo then commits the inverse (SB31)", async () => {
    const { container } = await h.mount(autoJobs);
    const deployed = await commits(JOBS);
    await typeInto(cells(container, "task")[3]!, "Spray finish, matt");
    expect((await readJobs()).get("J-0004")!.task).toBe("Spray finish, matt");
    expect(drafted(container)).toBe(0);
    await press(toolbar(container).getByRole("button", { name: "Undo" }));
    expect((await readJobs()).get("J-0004")!.task).toBe("Spray finish");
    expect(await commits(JOBS)).toEqual(["patch", "patch", ...deployed]);
    expect(tasks(container)[3]).toBe("Spray finish");
});
