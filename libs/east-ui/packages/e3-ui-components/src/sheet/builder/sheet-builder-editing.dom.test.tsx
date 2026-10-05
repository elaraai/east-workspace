/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet.Builder>`'s editing, undo and Apply (#1185, `Sheet Builder Spec.md`
 * SB25–SB31), over the in-memory stand-in records (`builder.test-utils.tsx`):
 * each gesture one transaction, undone and redone from the history item and
 * from the keys anywhere in the frame, never while typing in a field; Apply
 * one commit through the record's patch door, the history item naming each
 * state on the way; a conflict and a refusal keeping the drafts; a write with
 * no answer retried under its own request id; the drafts retiring once the
 * rows read back — whatever another write did beside them — and going out of
 * date when the record moves under them; each week its own drafts; and auto
 * mode.
 */

import { test, expect } from "vitest";
import { act, fireEvent, within } from "@testing-library/react";
import {
    East, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record, Sheet } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-builder";
import { initializeRecordApi, type RecordApi } from "../../platform/index.js";
import { WORKSPACE, builderHarness, mount, settle, slot } from "./builder.test-utils.js";

const harness = builderHarness();
const JOBS = ex.sheetBuilderJobs;
const PLANS = ex.sheetBuilderPlans;
type Jobs = ValueTypeOf<typeof JOBS.type>;
type Job = ValueTypeOf<typeof ex.BuilderJob>;
type Plans = ValueTypeOf<typeof PLANS.type>;
const encodeJobsPatch = encodeBeast2For(PatchType(JOBS.type));
const diffJobs = diffFor(JOBS.type);

/** The jobs, applied as each gesture lands (SB31). */
const autoJobs = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
        return Sheet.Builder({ record: jobs, columns: { task: Sheet.column.text(ex.BuilderJob, { header: "Task" }) }, applyMode: "auto", id: "auto" });
    }))),
};

/** A record as it stands — what its patch door last wrote. */
function readRecord<T>(name: string, decode: (bytes: Uint8Array) => T): T {
    const bytes = harness.cache.read(WORKSPACE, [variant("field", "records"), variant("field", name)]);
    if (bytes === undefined) throw new Error(`the record ${name} has not loaded`);
    return decode(bytes);
}
const readJobs = (): Jobs => readRecord(JOBS.name, decodeBeast2For(JOBS.type));
const readPlans = (): Plans => readRecord(PLANS.name, decodeBeast2For(PLANS.type));

/** The record's commits, newest first, by the mutation that made each. */
async function commits(name: string): Promise<string[]> {
    return (await harness.memory.history(WORKSPACE, name, undefined)).commits.map((c) => c.mutation);
}

/** Another planner's write to the jobs: a job's fields changed through the record's patch door, as the record has them now. */
function writeJob(api: RecordApi, key: string, change: Partial<Job>) {
    const now = readJobs();
    const next = new SortedMap([...now], compareFor(StringType));
    next.set(key, { ...now.get(key)!, ...change });
    return api.mutate(WORKSPACE, JOBS.name, "patch", { args: [encodeJobsPatch(diffJobs(now, next))] });
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
    const { container } = mount(ex.sheetBuilder);
    await settle();
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
    expect([...readJobs().values()].map((job) => job.task)).toEqual(before);
});

test("⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the frame — the grid a step at a time, a pane's tab — never while typing in the library's search (SB26)", async () => {
    const { container } = mount(ex.sheetBuilderLibrary);
    await settle();
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

test("Apply is one commit through the record's patch door: the history item says applying, then confirming, and the drafts retire once the rows read back as it left them (SB26, SB27, SB29)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    const apply = toolbar(container).getByRole("button", { name: "Apply changes" });
    // Nothing to apply yet.
    expect(disabled(apply)).toBe(true);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    expect(disabled(apply)).toBe(false);
    expect(drafted(container)).toBe(1);
    // The write held: Applying.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    initializeRecordApi({ ...harness.memory, mutate: async (ws, record, mutation, req) => { await held; return harness.memory.mutate(ws, record, mutation, req); } }, harness.cache, WORKSPACE);
    await press(apply);
    expect(statusLine(container)).toBe("Applying changes…");
    // It commits, the read-back held back: Applied, confirming — the draft stays until the row reads back.
    const notices: (() => void)[] = [];
    harness.cache.setScheduler((notify) => { notices.push(notify); });
    await act(async () => { release(); });
    await settle();
    expect(readJobs().get("J-0001")!.task).toBe("Panel cutting, oak");
    expect(await commits(JOBS.name)).toEqual(["patch", "$init"]);
    expect(statusLine(container)).toBe("Applied — loading the confirmed revision…");
    expect(drafted(container)).toBe(1);
    // The rows read back: the drafts retire, and the history item says nothing.
    harness.cache.setScheduler((notify) => queueMicrotask(notify));
    await act(async () => { for (const notify of notices) notify(); });
    await settle();
    expect(statusLine(container)).toBeUndefined();
    expect(drafted(container)).toBe(0);
    expect(tasks(container)[0]).toBe("Panel cutting, oak");
    expect(disabled(apply)).toBe(true);
});

test("a conflict keeps every draft, with its banner and the out-of-date notice; Apply is off, and nothing is rebased (SB28, SB29)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // Another write moves the same job just as Apply goes.
    await act(async () => {
        void writeJob(harness.memory, "J-0001", { task: "Panel cutting, walnut" });
        click(toolbar(container).getByRole("button", { name: "Apply changes" }));
    });
    await settle();
    expect(banners(container)).toEqual(["conflict", "stale"]);
    expect(statusLine(container)).toBe("Source changed — review or discard these drafts");
    // The draft stands, unrebased, over the record's new value.
    expect(tasks(container)[0]).toBe("Panel cutting, oak");
    expect(drafted(container)).toBe(1);
    expect(disabled(toolbar(container).getByRole("button", { name: "Apply changes" }))).toBe(true);
    expect(readJobs().get("J-0001")!.task).toBe("Panel cutting, walnut");
});

test("a refusal keeps every draft, with its banner and the reason; a revised draft may be applied again (SB28)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    await typeInto(cells(container, "task")[1]!, "Edge banding, both edges");
    initializeRecordApi({ ...harness.memory, mutate: async () => ({ outcome: variant("failed", { exitCode: 1n, stderr: "the edge bander is booked that week" }) }) }, harness.cache, WORKSPACE);
    await press(toolbar(container).getByRole("button", { name: "Apply changes" }));
    expect(banners(container)).toEqual(["rejected"]);
    const refused = slot(container, "banners")!.querySelector('[data-session-banner="rejected"]')!;
    expect(refused.textContent).toContain("The source refused these changes");
    expect(refused.textContent).toContain("The write failed: the edge bander is booked that week");
    expect(statusLine(container)).toBe("Changes rejected — revise the draft before applying");
    expect(tasks(container)[1]).toBe("Edge banding, both edges");
    expect(drafted(container)).toBe(1);
    // The same request is never sent again: Apply waits for a revision.
    expect(disabled(toolbar(container).getByRole("button", { name: "Apply changes" }))).toBe(true);
    initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
    await typeInto(cells(container, "task")[1]!, "Edge banding, one edge");
    expect(banners(container)).toEqual([]);
    await press(toolbar(container).getByRole("button", { name: "Apply changes" }));
    expect(readJobs().get("J-0002")!.task).toBe("Edge banding, one edge");
    expect(drafted(container)).toBe(0);
});

test("a write with no answer leaves the session unknown: Apply turns into Retry, which sends the same request — its id unchanged — and never writes twice (SB28)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    await typeInto(cells(container, "task")[2]!, "CNC routing, both faces");
    // The write lands, and its answer is lost.
    const keys: (string | undefined)[] = [];
    let lost = true;
    initializeRecordApi({ ...harness.memory, mutate: async (ws, record, mutation, req) => {
        keys.push(req.idempotencyKey);
        const result = await harness.memory.mutate(ws, record, mutation, req);
        if (lost) { lost = false; throw new Error("The connection closed"); }
        return result;
    } }, harness.cache, WORKSPACE);
    await press(toolbar(container).getByRole("button", { name: "Apply changes" }));
    expect(banners(container)).toEqual(["unknown"]);
    expect(statusLine(container)).toBe("Awaiting confirmation — retry the same request");
    expect(toolbar(container).queryByRole("button", { name: "Apply changes" })).toBeNull();
    // No gesture while the request is unresolved.
    expect(disabled(toolbar(container).getByRole("button", { name: "Undo" }))).toBe(true);
    await press(toolbar(container).getByRole("button", { name: "Retry request" }));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBe(keys[0]);
    expect(await commits(JOBS.name)).toEqual(["patch", "$init"]);
    expect(banners(container)).toEqual([]);
    expect(statusLine(container)).toBeUndefined();
    expect(drafted(container)).toBe(0);
    expect(readJobs().get("J-0003")!.task).toBe("CNC routing, both faces");
});

test("the record moving under pending drafts makes the session out of date: Apply is off, a banner offers Discard, and nothing is rebased (SB29)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // Another write, to another job.
    await act(async () => { await writeJob(harness.memory, "J-0003", { task: "CNC routing, ash" }); });
    await settle();
    expect(banners(container)).toEqual(["stale"]);
    expect(statusLine(container)).toBe("Source changed — review or discard these drafts");
    expect(disabled(toolbar(container).getByRole("button", { name: "Apply changes" }))).toBe(true);
    // The draft as it was, over the record as it is.
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing, ash", "Spray finish"]);
    await press(slot(container, "banners")!.querySelector('[data-session-banner="stale"] [data-banner-action="discard"]')!);
    expect(banners(container)).toEqual([]);
    expect(tasks(container)).toEqual(["Panel cutting", "Edge banding", "CNC routing, ash", "Spray finish"]);
    expect(drafted(container)).toBe(0);
});

test("a commit to a record read whole confirms once its own rows read back, whatever another write did meanwhile — to another row, or to another field of its own (#1185, SB29)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak");
    // Right after this commit, before the sheet reads it back, another planner writes J-0003's task and J-0001's quantity.
    initializeRecordApi({ ...harness.memory, mutate: async (ws, record, mutation, req) => {
        const result = await harness.memory.mutate(ws, record, mutation, req);
        await writeJob(harness.memory, "J-0003", { task: "CNC routing, ash" });
        await writeJob(harness.memory, "J-0001", { qty: some(52.0) });
        return result;
    } }, harness.cache, WORKSPACE);
    await press(toolbar(container).getByRole("button", { name: "Apply changes" }));
    // Confirmed: no status line, no draft, the record as the three writes left it.
    expect(statusLine(container)).toBeUndefined();
    expect(banners(container)).toEqual([]);
    expect(drafted(container)).toBe(0);
    expect(tasks(container)).toEqual(["Panel cutting, oak", "Edge banding", "CNC routing, ash", "Spray finish"]);
    expect(cells(container, "qty")[0]!.textContent).toBe("52");
    expect(await commits(JOBS.name)).toEqual(["patch", "patch", "patch", "$init"]);
    // The next edit of J-0001 begins from the record's version: its Apply commits, keeping the other planner's quantity.
    initializeRecordApi(harness.memory, harness.cache, WORKSPACE);
    await typeInto(cells(container, "task")[0]!, "Panel cutting, oak veneer");
    await press(toolbar(container).getByRole("button", { name: "Apply changes" }));
    expect(banners(container)).toEqual([]);
    expect(readJobs().get("J-0001")).toEqual({ task: "Panel cutting, oak veneer", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(52.0) });
    expect(drafted(container)).toBe(0);
});

test("each week keeps its own drafts across a switch of the entry, and a remount finds them, until Apply or Discard (SB17, SB30)", async () => {
    const view = mount(ex.sheetBuilderWeeks);
    await settle();
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
    // Its Apply commits its own rows alone.
    await press(toolbar(view.container).getByRole("button", { name: "Apply changes" }));
    expect(readPlans().get("2026-W42")!.rows[0]!.task).toBe("Cut the oak carcasses");
    expect(readPlans().get("2026-W43")!.rows[0]!.task).toBe("Assemble the wardrobes");
    // The other week's draft outlives the switch and a remount.
    fireEvent.click(view.getByText("2026-W43"));
    await settle();
    view.unmount();
    const again = mount(ex.sheetBuilderWeeks);
    await settle();
    expect(tasks(again.container)[0]).toBe("Assemble the ash wardrobes");
    expect(drafted(again.container)).toBe(1);
    await press(toolbar(again.container).getByRole("button", { name: "Discard" }));
    expect(tasks(again.container)[0]).toBe("Assemble the wardrobes");
    expect(drafted(again.container)).toBe(0);
});

test("auto mode sends each ready gesture as it lands, through the same protocol; Undo then commits the inverse (SB31)", async () => {
    const { container } = mount(autoJobs);
    await settle();
    await typeInto(cells(container, "task")[3]!, "Spray finish, matt");
    expect(readJobs().get("J-0004")!.task).toBe("Spray finish, matt");
    expect(drafted(container)).toBe(0);
    await press(toolbar(container).getByRole("button", { name: "Undo" }));
    expect(readJobs().get("J-0004")!.task).toBe("Spray finish");
    expect(await commits(JOBS.name)).toEqual(["patch", "patch", "$init"]);
    expect(tasks(container)[3]).toBe("Spray finish");
});
