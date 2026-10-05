/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet.Builder>`'s frame and toolbar (#1184, `Sheet Builder Spec.md`
 * SB18–SB24). The builder's examples are mounted under the record runtime a
 * surface installs, over the in-memory stand-in records, whose patch door
 * applies each patch with East's own checks: the frame's regions, the sheet's
 * items in the frame's one toolbar, an Apply's banners — a conflict, a write
 * with no answer and its Retry, the out-of-date notice and its Discard — the
 * footer's last save, a week the record does not hold, and the panes' open
 * tab and collapsed state kept under the builder's id.
 */

import { test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For, diffFor, encodeBeast2For, none, some,
    variant, type EastIR, type ValueTypeOf,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { Record, Sheet, SheetBuilderPayloadType } from "@elaraai/e3-ui/internal";
import {
    EastChakraComponent, I18nProvider, StateRuntime, UIStore, formatters, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-builder";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../../platform/index.js";
import { measureRowsAsDrawn } from "../frame.test-utils.js";
import { todayUtc } from "../parse/date.js";
// The builder is an extension: its renderer registers as it loads.
import { EastChakraSheetBuilder } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `matchMedia`; a Box asks it whether the viewer wants less motion.
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
// jsdom has no `CSS.escape`; a segment group's radios are found with it.
(globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

// ── Layout stand-ins: the grid fills main, a 400px frame over its rows ───
const VIEWPORT = 400;
const frameHeight = (el: Element): number | undefined => (el.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined);
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
};
let restoreRows: () => void = () => {};

const WORKSPACE = "sheet-builder-test";
const JOBS = ex.sheetBuilderJobs;
type Jobs = ValueTypeOf<typeof JOBS.type>;
type Payload = ValueTypeOf<typeof SheetBuilderPayloadType>;
const JobsPatch = PatchType(JOBS.type);
const WORDS = formatters("en-US");

let memory: RecordApi;
let cache: ReactiveDatasetCache;

/** A record of the examples', in memory, its patch door applying each patch with East's checks. */
function patchable<T extends { name: string; type: Parameters<typeof applyFor>[0]; default?: unknown }>(record: T) {
    const applyPatch = applyFor(record.type);
    return {
        name: record.name, stateType: record.type, initial: record.default!,
        mutations: [{ name: "patch", argTypes: [PatchType(record.type)], reduce: (state: unknown, patch: unknown) => applyPatch(state as never, patch as never) }],
    };
}

beforeEach(() => {
    StateRuntime.initializeStore(new UIStore());
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; },
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true, get(this: Element) { return frameHeight(this) ?? 0; },
    });
    Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 10_000 : 0; },
    });
    restoreRows = measureRowsAsDrawn();
    const store = new Map<string, Uint8Array>();
    const api: DatasetApi = {
        async get(ws, path) {
            const bytes = store.get(datasetCacheKey(ws, path));
            if (!bytes) throw new Error(`no dataset ${datasetCacheKey(ws, path)}`);
            return { data: bytes, hash: null };
        },
        async set(ws, path, value) { store.set(datasetCacheKey(ws, path), value); },
        async launchDataflow() { /* in memory — nothing to launch */ },
        async listRoot() { return []; },
        async listAt() { return []; },
        async workspaceStatus() { return { datasets: [] }; },
    };
    cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    memory = createInMemoryRecordApi(cache, WORKSPACE, [
        patchable(ex.sheetBuilderJobs), patchable(ex.sheetBuilderPlans), patchable(ex.sheetBuilderOrders),
        { name: ex.sheetBuilderMachines.name, stateType: ex.sheetBuilderMachines.type, initial: ex.sheetBuilderMachines.default!, mutations: [] },
    ]);
    initializeRecordApi(memory, cache, WORKSPACE);
    // The workshop's activities: an input, its declared value.
    const activities = ex.sheetBuilderActivities;
    if (activities.source?.type !== "value") throw new Error("the activities input declares no value");
    void cache.write(WORKSPACE, activities.path, encodeBeast2For(activities.type)(activities.source.value));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    restoreRows();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
});

/** Let the records' reads, the session, the writes and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** Mounts an example of the builder's, as a surface does. */
function mount(example: { fn: { toIR(): unknown } }) {
    // An example's `fn` erases its output type at the package boundary; the builder's examples are UI components.
    const program = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    return render(
        <ChakraProvider value={system}>
            <I18nProvider locale="en-US">
                <EastChakraComponent value={program()} storageKey="sheet-builder" />
            </I18nProvider>
        </ChakraProvider>,
    );
}

/** Builds a builder's payload over the jobs record, as `<Sheet.Builder>` does, and mounts it as given. */
const jobsPayload = East.compile(East.function([], SheetBuilderPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
    return Sheet.BuilderPayload({ record: jobs, columns: { task: Sheet.column.text(ex.BuilderJob, { header: "Task" }) }, id: "jobs" });
}), getRegisteredPlatformImplementations()) as unknown as () => Payload;
const missingWeek = East.compile(East.function([], SheetBuilderPayloadType, ($) => {
    const plans = $.let(Record.bind(ex.sheetBuilderPlans, [ex.sheetBuilderPlansPatch]));
    return Sheet.BuilderPayload({ record: plans, entry: { key: "2026-W50", rows: "rows", id: "id" }, columns: { task: Sheet.column.text(ex.BuilderPlanRow, { header: "Task" }) } });
}), getRegisteredPlatformImplementations()) as unknown as () => Payload;

function mountPayload(value: Payload) {
    return render(
        <ChakraProvider value={system}>
            <I18nProvider locale="en-US">
                <EastChakraSheetBuilder value={value} storageKey="sheet-builder" />
            </I18nProvider>
        </ChakraProvider>,
    );
}

/** The record as it stands — what its patch door last wrote. */
function readJobs(): Jobs {
    const bytes = cache.read(WORKSPACE, [variant("field", "records"), variant("field", JOBS.name)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(JOBS.type)(bytes);
}

/** The jobs record with one job's task changed. */
function withTask(jobs: Jobs, key: string, task: string): Jobs {
    const next = new SortedMap([...jobs], compareFor(StringType));
    next.set(key, { ...jobs.get(key)!, task });
    return next;
}

const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`);
const tabs = (pane: HTMLElement) => [...pane.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
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

test("the builder is a BuilderFrame: the toolbar, the library, main holding the grid and its strip, the inspector, the footer (SB18, SB21)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    expect(container.querySelector("[data-builder-frame]")).not.toBeNull();
    expect(tabs(slot(container, "start")!)).toEqual(["Rows", "Registers", "Columns"]);
    expect(tabs(slot(container, "end")!)).toEqual(["Details", "Issues"]);
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

test("the toolbar is the frame's one row, the sheet's items in §7.1's order; the grid draws none of its own (SB19)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    expect(container.querySelector('[data-slot="toolbar"]')).toBeNull();
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
    const { container, getByRole } = mount(ex.sheetBuilder);
    await settle();
    await typeTask(container, 0, "Panel cutting, oak");
    expect(banners(container)).toEqual([]);
    // Another write moves the job just as Apply goes.
    const moved = encodeBeast2For(JobsPatch)(diffFor(JOBS.type)(readJobs(), withTask(readJobs(), "J-0001", "Panel cutting, walnut")));
    await act(async () => {
        void memory.mutate(WORKSPACE, JOBS.name, "patch", { args: [moved] });
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
    const { container, getByRole } = mount(ex.sheetBuilder);
    await settle();
    await typeTask(container, 1, "Edge banding, both edges");
    // The write goes out and nothing comes back.
    initializeRecordApi({ ...memory, mutate: async () => { throw new Error("The connection closed"); } }, cache, WORKSPACE);
    await act(async () => { press(getByRole("button", { name: "Apply changes" })); });
    await settle();
    expect(banners(container)).toEqual(["unknown"]);
    const unknown = slot(container, "banners")!.querySelector('[data-session-banner="unknown"]')!;
    expect(unknown.textContent).toContain("No answer from the source — the changes may have been applied");
    expect(unknown.textContent).toContain("The connection closed");
    expect(slot(container, "toolbar")!.querySelector('[role="alert"]')).toBeNull();

    initializeRecordApi(memory, cache, WORKSPACE);
    await act(async () => { press(unknown.querySelector('[data-banner-action="apply"]')!); });
    await settle();
    expect(banners(container)).toEqual([]);
    expect(readJobs().get("J-0002")!.task).toBe("Edge banding, both edges");
    const { commits } = await memory.history(WORKSPACE, JOBS.name, undefined);
    expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
});

test("the footer is the sheet's, with the record's last save: the time when it was today, in full otherwise (SB22)", async () => {
    const { container, unmount } = mount(ex.sheetBuilder);
    await settle();
    // The stand-in records commit at the epoch.
    expect(slot(container, "footer")!.querySelector('[data-slot="footerSaved"]')!.textContent).toBe(`saved ${WORDS.dateTime(new Date(0))}`);
    unmount();

    const at = new Date(todayUtc().getTime() + (14 * 60 + 2) * 60_000);
    const today = mountPayload({
        ...jobsPayload(),
        history: () => some([{ hash: "h1", parent: none, state: "s1", mutation: "patch", actor: "planner", at, delta: none }]),
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

    const { container, getByText } = mount(ex.sheetBuilderWeeks);
    await settle();
    expect(banners(container)).toEqual([]);
    fireEvent.click(getByText("2026-W44"));
    await settle();
    expect(banners(container)).toEqual(["missing"]);
    fireEvent.click(getByText("2026-W42"));
    await settle();
    expect(banners(container)).toEqual([]);
});

test("the panes are BuilderFrame's: their open tab and collapsed state persist under the builder's id (SB24)", async () => {
    const first = mountPayload(jobsPayload());
    await settle();
    fireEvent.click([...slot(first.container, "start")!.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Columns")!);
    fireEvent.click(slot(first.container, "end")!.querySelector('button[aria-label="Collapse Inspector"]')!);
    await settle();
    expect(localStorage.getItem("sheet.builder.jobs.frame.start.dock.tab")).toBe(JSON.stringify({ key: "columns" }));
    expect(localStorage.getItem("sheet.builder.jobs.frame.end.dock.collapsed")).toBe("true");
    first.unmount();

    const again = mountPayload(jobsPayload());
    await settle();
    const selected = slot(again.container, "start")!.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("Columns");
    expect(slot(again.container, "end")!.hasAttribute("data-collapsed")).toBe(true);
});
