/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>` over paged rows reading their nested series a cell at a time
 * (#1438), on e3 itself, over the nested series records (`plan-nested`): a
 * thousand machines, each with its jobs, stops, alarms, load and output, paged
 * as lean rows through their rail's index, their collections read through
 * their nested series index. What each request asked is read from the
 * harness's request log.
 *
 * - Opening reads the lean machines a page at a time through their index by
 *   name, joining nothing, then one batch of every cell's searches and one
 *   read of their entries; it never reads a machine whole, nor a window of the
 *   record's own rows. Each of the first twelve machines draws what a Plan
 *   over the same machines read whole draws for it.
 */

import { describe, test, expect, beforeEach, afterEach, onTestFinished, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, some, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { layOut } from "@elaraai/east-ui-components/testing";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan-nested/plan-nested";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { carry } from "../plan-move.test-utils.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan-nested/plan-nested": ex });

// ── The records, and what the Plan asks e3 of them ───────────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The machines' record, as e3's requests name it. */
const MACHINES = pathText(ex.machines.path as TreePath);
/** The machines' index by name, which pages them lean in their names' order, and their nested series index. */
const BY_NAME = ex.machines.indexes.machines_by_name;
const IN_TIME = ex.machines.indexes.machines_in_time;

/** Whether a request reads the machines through one of their indexes. */
const through = (index: { readonly name: string }) => (request: E3Request) =>
    request.dataset === MACHINES && (request.query.get("index") ?? undefined) === index.name;

/** What one of the machines' indexes was asked: each request's kind — a batch of searches as `find`, its size after it. */
const askedOf = (index: { readonly name: string }) => h.requests().filter(through(index))
    .map((request) => (request.kind === "find" ? `find ${request.searches.length}` : request.kind));

/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
    errors = vi.spyOn(console, "error");
});
afterEach(() => {
    // Nothing failed to read, not even for a moment: no window, no search, no cell.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ── The Plans ────────────────────────────────────────────────────────────────

/** Monday 2 to Monday 16 March 2026, a day at a time. */
const FROM = new Date("2026-03-02T00:00:00Z");
const TO = new Date("2026-03-16T00:00:00Z");
const axis = () => Plan.axis({ window: { min: FROM, max: TO }, resolution: "day", resolutions: ["day", "week", "month", "quarter", "year"] });

/** The machines' series: each machine's jobs as runs and its alarms as decisions, then its load. */
const machineSeries = () => [
    Plan.series.span(ex.Machine, {
        key: "presses", title: "Presses", label: (m) => m.name,
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
        decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
    }),
    Plan.series.heat(ex.Machine, { key: "load", title: "Load", label: (m) => m.name, cells: Plan.heatCells(Plan.values("load", (pct) => ({ value: some(pct) }))) }),
];

/** The thousand machines paged lean by their names beside their nested series index. Unbounded: jsdom lays nothing out. */
const nestedPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.const(Data.bindPaged(ex.machines, { indexes: ["machines_by_name", "machines_in_time"] }));
    return Plan({ axis: axis(), data: machines, series: machineSeries() });
}))) };

/**
 * The machines through a Slice's `rows` source over the same binding: the
 * canvas holds its own window, which a pan and a zoom move.
 */
const slicePlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.const(Slice.bindRecords("plan.nested.dom", {
        rows: { source: Data.bindPaged(ex.machines, { indexes: ["machines_by_name", "machines_by_site_status", "machines_in_time"] }), fields: { site: { label: "Site" } } },
    }));
    return Plan({ axis: axis(), series: machineSeries(), slice: { slice } });
}))) };

/** The same machines' first twelve read whole: what the paged Plan draws the same as, for them. */
const wholePlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.const(Data.bind(ex.machinesFew));
    return Plan({ axis: axis(), data: machines.read(), series: machineSeries() });
}))) };

/** The first twelve read whole, over a window a number of days on: what the slice Plan draws, panned so far. */
const wholePlanOn = (days: number) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const machines = $.const(Data.bind(ex.machinesFew));
    const on = (at: Date) => new Date(at.getTime() + days * 86_400_000);
    return Plan({
        axis: Plan.axis({ window: { min: on(FROM), max: on(TO) }, resolution: "day", resolutions: ["day", "week", "month", "quarter", "year"] }),
        data: machines.read(), series: machineSeries(),
    });
}))) });

// ── What the canvas draws ────────────────────────────────────────────────────

/** The first twelve machines' keys, which both records hold. */
const TWELVE = Array.from({ length: 12 }, (_, i) => `M-${10_001 + i}`);

/** What a row draws: each run, mark and cell, by its key, its place and its name. */
function drawnRow(c: HTMLElement, series: string, key: string): string[] {
    const row = slot(c, "main")!.querySelector<HTMLElement>(rowAt(entry(series, key)));
    if (row === null) return [`${series} ${key}: no row`];
    return [...row.querySelectorAll<HTMLElement>("[data-run], [data-mark], [data-cell]")].map((node) =>
        [node.getAttribute("data-run") ?? node.getAttribute("data-mark") ?? `cell ${node.getAttribute("data-cell")}`,
            node.getAttribute("data-plan-frac"), node.getAttribute("aria-label")].join(" ")).sort();
}

/** Pans the canvas a day: `]` on, `[` back. */
async function pan(c: HTMLElement, key: "[" | "]", times = 1) {
    for (let i = 0; i < times; i++) {
        await act(async () => { fireEvent.keyDown(c.querySelector(rowAt(entry("presses", "M-10001")))!, { key }); });
        await settle();
    }
}

/** Zooms the canvas to a resolution through the toolbar's segment, as a planner does. */
async function zoomTo(c: HTMLElement, resolution: "day" | "week" | "month" | "quarter" | "year") {
    const seg = slot(c, "toolbar")!.querySelector<HTMLElement>("[data-plan-seg='resolution']")!;
    const radio = [...seg.querySelectorAll<HTMLElement>("[role='radio']")][["day", "week", "month", "quarter", "year"].indexOf(resolution)]!;
    await act(async () => {
        fireEvent.mouseDown(radio, { button: 0 });
        fireEvent.click(radio);
    });
    await settle();
}

/** What the first twelve machines' presses rows draw: the rows the canvas opens on. */
const drawnTwelve = (c: HTMLElement) => TWELVE.flatMap((key) => drawnRow(c, "presses", key));

// ============================================================================
// Opening (#1438)
// ============================================================================

describe("a Plan over paged rows reads their nested series a cell at a time (#1438)", () => {
    test("opens on one page of lean machines, then one batch of the cells' searches and one read of their entries, drawing each machine as a Plan reading them whole does", async () => {
        onTestFinished(emulateWindowScroll());
        const { container } = await h.mount(nestedPlan);
        await settle();
        // The machines paged lean by their names — their count, and the windows the canvas lays out — joining nothing.
        const pages = h.requests("page", MACHINES);
        expect(pages.length).toBeGreaterThan(0);
        expect(pages.every((request) => through(BY_NAME)(request) && request.query.get("join") !== "true")).toBe(true);
        // Their collections: every cell's searches in one request, their entries in one more. The first block's fifty
        // machines, each its jobs at the four levels they are filed at and its alarms at the week: 250 searches.
        expect(askedOf(IN_TIME)).toEqual(["find 250", "runs"]);
        // No machine read whole, nor the record.
        expect(h.requests("rows", MACHINES)).toEqual([]);
        expect(h.requests("read", MACHINES)).toEqual([]);
        const paged = drawnTwelve(container);
        expect(paged.filter((line) => line.endsWith("no row"))).toEqual([]);
        expect(paged.length).toBeGreaterThan(TWELVE.length);
        const { container: whole } = await h.mount(wholePlan, { storageKey: "whole" });
        await settle();
        expect(paged).toEqual(drawnTwelve(whole));
    });

    test("a pan within the tiles it holds reads nothing; a week on reads the new week's tiles alone, a range a machine a collection", async () => {
        onTestFinished(emulateWindowScroll());
        const { container } = await h.mount(slicePlan);
        await settle();
        const opened = askedOf(IN_TIME).length;
        // A day at a time for a week: the pans within the runs held read nothing, and the one that grows the week's run
        // reads its new tile — the first block's fifty machines, their jobs and their alarms, at the week alone.
        const read: string[][] = [];
        for (let day = 0; day < 7; day++) {
            const before = askedOf(IN_TIME).length;
            await pan(container, "]");
            read.push(askedOf(IN_TIME).slice(before));
        }
        expect(read.filter((asked) => asked.length > 0)).toEqual([["find 100", "runs"]]);
        expect(askedOf(IN_TIME).length).toBe(opened + 2);
        const { container: whole } = await h.mount(wholePlanOn(7), { storageKey: "whole" });
        await settle();
        expect(drawnTwelve(container)).toEqual(drawnTwelve(whole));
    });

    test("a scroll to machines further down reads their blocks' cells alone, two requests", async () => {
        onTestFinished(emulateWindowScroll());
        const { container } = await h.mount(nestedPlan);
        await settle();
        const opened = askedOf(IN_TIME).length;
        act(() => { window.scrollTo({ top: 140 * PLAN_GEOMETRY.default.row }); });
        await waitFor(() => expect(container.querySelector(rowAt(entry("presses", "M-10150")))).not.toBeNull(), { timeout: 10_000 });
        // The view reported as its scroll rests: the blocks around it read.
        await waitFor(() => expect(askedOf(IN_TIME).length).toBeGreaterThanOrEqual(opened + 2), { timeout: 10_000 });
        await settle();
        const asked = askedOf(IN_TIME).slice(opened);
        expect(asked).toHaveLength(2);
        expect(asked[1]).toBe("runs");
        // Each machine of the blocks wanted, five ranges: its jobs at four levels, its alarms at one.
        const searches = Number(asked[0]!.replace("find ", ""));
        expect(searches % 5).toBe(0);
        expect(searches).toBeGreaterThan(0);
        expect(drawnRow(container, "presses", "M-10150").length).toBeGreaterThan(0);
    });

    test("zoomed out to a year over 150 machines, past 10,000 jobs: their counts, then their month totals, each machine's months shaded by the share booked", async () => {
        onTestFinished(emulateWindowScroll());
        const { container } = await h.mount(slicePlan);
        await settle();
        // The view on the second block: the first three blocks wanted, 150 machines, 80 jobs each over the year.
        const opened = askedOf(IN_TIME).length;
        act(() => { window.scrollTo({ top: 70 * PLAN_GEOMETRY.default.row }); });
        await waitFor(() => expect(container.querySelector(rowAt(entry("presses", "M-10075")))).not.toBeNull(), { timeout: 10_000 });
        // The view reported as its scroll rests: the blocks around it read.
        await waitFor(() => expect(askedOf(IN_TIME).length).toBeGreaterThanOrEqual(opened + 2), { timeout: 10_000 });
        await settle();
        const before = askedOf(IN_TIME).length;
        await zoomTo(container, "year");
        const asked = askedOf(IN_TIME).slice(before);
        // The cells' searches, counted past the cap; then the jobs' month totals, searched and read with the alarms'. (The
        // view the zoomed rows report at rest is counted after.)
        expect(asked.slice(0, 3).map((kind) => kind.replace(/\d+/, "n"))).toEqual(["find n", "find n", "runs"]);
        // A machine's jobs draw as its months booked: no run, and a weight a bucket.
        const row = slot(container, "main")!.querySelector<HTMLElement>(rowAt(entry("presses", "M-10075")))!;
        expect(row.querySelectorAll("[data-run]")).toHaveLength(0);
        expect(row.querySelectorAll("[data-cell]").length).toBeGreaterThan(0);
    });
});
// ── The ledgers: their parents' subtotals (#1438) ─────────────────────────────

/** The ledgers' record, as e3's requests name it, and their nested series index. */
const LEDGERS = pathText(ex.ledgers.path as TreePath);
const LEDGERS_IN_TIME = ex.ledgers.indexes.ledgers_in_time;

/** The searches of the ledgers' nested series index, each its lower bound's literals: `[place, row, path, run, level, tile]`. */
const ledgerSearches = () => h.requests().filter((request) => request.kind === "find" && request.dataset === LEDGERS
    && (request.query.get("index") ?? undefined) === LEDGERS_IN_TIME.name)
    .flatMap((request) => request.searches.map((search) => ("from" in search ? search.from ?? [] : [])));

/** A window over each resolution the ledgers are compared at, holding whole buckets of it. */
const LEDGER_WINDOWS = {
    week: { min: new Date("2026-01-05T00:00:00Z"), max: new Date("2026-03-02T00:00:00Z") },
    month: { min: new Date("2026-01-01T00:00:00Z"), max: new Date("2026-07-01T00:00:00Z") },
    quarter: { min: new Date("2026-01-01T00:00:00Z"), max: new Date("2027-01-01T00:00:00Z") },
    year: { min: new Date("2026-01-01T00:00:00Z"), max: new Date("2028-01-01T00:00:00Z") },
} as const;
type LedgerResolution = keyof typeof LEDGER_WINDOWS;

/** Each ledger a group, its measures a table tree subtotalling their readings by their sum: what e3 keeps. */
const ledgerSeries = (collapsed: boolean) => [Plan.series.group(ex.Ledger, {
    key: "ledgers", title: "Ledgers", label: (l) => l.name,
    children: Plan.children("measures", [Plan.series.table(ex.Measure, {
        key: "readings", title: "Readings", label: (m) => m.label, children: "children", aggregate: "sum", collapsed,
        cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))),
    })]),
})];

/** The twenty ledgers paged lean beside their nested series index, at a resolution, their measures open or folded. */
const ledgersPaged = (resolution: LedgerResolution, collapsed = false) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const ledgers = $.const(Data.bindPaged(ex.ledgers, { indexes: ["ledgers_by_site", "ledgers_in_time"] }));
    return Plan({ axis: Plan.axis({ window: LEDGER_WINDOWS[resolution], resolution }), data: ledgers, series: ledgerSeries(collapsed) });
}))) });

/** The same ledgers read whole: what the paged Plan draws the same as. */
const ledgersWhole = (resolution: LedgerResolution, collapsed = false) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const ledgers = $.const(Data.bind(ex.ledgers));
    return Plan({ axis: Plan.axis({ window: LEDGER_WINDOWS[resolution], resolution }), data: ledgers.read(), series: ledgerSeries(collapsed) });
}))) });

/** Ledger 101's measures, each its path: its two top measures, each one's three, and each of those one's three. */
const LEDGER_101 = ["101.1", "101.2"].flatMap((top) => [[top], ...[1, 2, 3].flatMap((m) => [[top, `${top}.${m}`],
    ...[1, 2, 3].map((l) => [top, `${top}.${m}`, `${top}.${m}.${l}`])])]);

/** What a table row draws: each cell, by its bucket and its text. */
function drawnCells(c: HTMLElement, path: readonly string[]): string[] {
    const row = slot(c, "main")!.querySelector<HTMLElement>(rowAt(entry("readings", "L-101", ...path)));
    if (row === null) return [`${path.join("/")}: no row`];
    return [...row.querySelectorAll<HTMLElement>("[data-cell]")].map((node) => `${path.join("/")} ${node.getAttribute("data-cell")} ${node.textContent}`);
}

describe("a parent's subtotals are e3's (#1438)", () => {
    for (const resolution of ["week", "month", "quarter", "year"] as const) {
        test(`at the ${resolution}, each parent's are one range at its level, and every measure draws what the tree read whole derives`, async () => {
            onTestFinished(emulateWindowScroll());
            const { container } = await h.mount(ledgersPaged(resolution));
            await settle();
            const searches = ledgerSearches();
            // A parent's subtotals, one range at the resolution's level; a leaf's none — its readings at the week alone.
            const subtotals = searches.filter((from) => from[3]!.startsWith(".subtotals"));
            expect(subtotals.length).toBeGreaterThan(0);
            expect(subtotals.every((from) => from[4] === `.${resolution}`)).toBe(true);
            const parentOf = (from: readonly string[]) => from[2]!;
            expect(new Set(subtotals.map(parentOf)).size).toBe(subtotals.length);
            expect(searches.filter((from) => from[3] === ".items").every((from) => from[4] === ".week")).toBe(true);
            const paged = LEDGER_101.flatMap((path) => drawnCells(container, path));
            expect(paged.filter((line) => line.endsWith("no row"))).toEqual([]);
            const { container: whole } = await h.mount(ledgersWhole(resolution), { storageKey: "whole" });
            await settle();
            expect(paged).toEqual(LEDGER_101.flatMap((path) => drawnCells(whole, path)));
        });
    }

    test("a folded top measure reads its subtotals alone — one range — and no cell of a measure beneath it, and draws what the tree read whole derives", async () => {
        onTestFinished(emulateWindowScroll());
        const { container } = await h.mount(ledgersPaged("week", true));
        await settle();
        const searches = ledgerSearches();
        // Only the top measures show: each one's own readings — none — and its subtotals, and nothing of the measures beneath
        // them.
        const deeper = (from: readonly string[]) => from[2]!.includes("rest=.step");
        expect(searches.filter(deeper)).toEqual([]);
        expect(searches.filter((from) => from[3]!.startsWith(".subtotals") && from[1] === '"L-101"').map((from) => from[2])).toEqual([
            '.step (key="101.1", rest=.end)', '.step (key="101.2", rest=.end)',
        ]);
        const tops = [["101.1"], ["101.2"]];
        const paged = tops.flatMap((path) => drawnCells(container, path));
        const { container: whole } = await h.mount(ledgersWhole("week", true), { storageKey: "whole" });
        await settle();
        expect(paged).toEqual(tops.flatMap((path) => drawnCells(whole, path)));
    });
});

// ── The assemblies: a span parent's bands (#1438) ─────────────────────────────

/** The assemblies' record, as e3's requests name it, and their nested series index. */
const ASSEMBLIES = pathText(ex.assemblies.path as TreePath);
const ASSEMBLIES_IN_TIME = ex.assemblies.indexes.assemblies_in_time;

/** The searches of the assemblies' nested series index, each its lower bound's literals: `[place, row, path, run, level, tile]`. */
const assemblySearches = () => h.requests().filter((request) => request.kind === "find" && request.dataset === ASSEMBLIES
    && (request.query.get("index") ?? undefined) === ASSEMBLIES_IN_TIME.name)
    .flatMap((request) => request.searches.map((search) => ("from" in search ? search.from ?? [] : [])));

/** The assemblies' first four weeks, a day at a time. */
const ASSEMBLY_WINDOW = { min: new Date("2026-01-05T00:00:00Z"), max: new Date("2026-02-02T00:00:00Z") };

/** Each assembly a group, its parts a span tree rolling their jobs up into bands, folded or open. */
const assemblySeries = (collapsed: boolean) => [Plan.series.group(ex.Assembly, {
    key: "assemblies", title: "Assemblies", label: (a) => a.name,
    children: Plan.children("parts", [Plan.series.span(ex.Part, {
        key: "parts", title: "Parts", label: (p) => p.name, children: "parts", rollup: "union", collapsed,
        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
    })]),
})];

/** The fifty assemblies paged lean beside their nested series index. */
const assembliesPaged = (collapsed: boolean) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const assemblies = $.const(Data.bindPaged(ex.assemblies, { indexes: ["assemblies_by_line", "assemblies_in_time"] }));
    return Plan({ axis: Plan.axis({ window: ASSEMBLY_WINDOW, resolution: "day" }), data: assemblies, series: assemblySeries(collapsed) });
}))) });

/** The same assemblies read whole: what the paged Plan draws the same as. */
const assembliesWhole = (collapsed: boolean) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const assemblies = $.const(Data.bind(ex.assemblies));
    return Plan({ axis: Plan.axis({ window: ASSEMBLY_WINDOW, resolution: "day" }), data: assemblies.read(), series: assemblySeries(collapsed) });
}))) });

/** What a part's row draws: each band and run, by its place, its width, its state and its words. */
function drawnPart(c: HTMLElement, part: string): string[] {
    const row = slot(c, "main")!.querySelector<HTMLElement>(rowAt(entry("parts", "A-101", part)));
    if (row === null) return [`${part}: no row`];
    return [...row.querySelectorAll<HTMLElement>("[data-plan-band], [data-run]")].map((node) => [part,
        node.hasAttribute("data-plan-band") ? "band" : node.getAttribute("data-run"), node.style.left, node.style.width,
        node.getAttribute("data-state"), node.textContent].join(" ")).sort();
}

describe("a span parent's bands are its subtree's runs, as e3 files them under it (#1438)", () => {
    test("a folded part reads its subtree's jobs, one range a level, and nothing of its parts', and draws the bands the tree read whole derives", async () => {
        onTestFinished(emulateWindowScroll());
        const { container } = await h.mount(assembliesPaged(true));
        await settle();
        const searches = assemblySearches();
        const under = searches.filter((from) => from[1] === '"A-101"' && from[2] === '.step (key="P101.1", rest=.end)' && from[3] === ".subtree");
        expect(under.map((from) => from[4])).toEqual([".week", ".month", ".quarter", ".year"]);
        // Only the top parts show: nothing of a part beneath one is searched.
        expect(searches.filter((from) => from[2]!.includes("rest=.step"))).toEqual([]);
        const tops = ["P101.1", "P101.2", "P101.3"];
        const paged = tops.flatMap((part) => drawnPart(container, part));
        expect(paged.filter((line) => line.includes(" band "))).not.toEqual([]);
        const { container: whole } = await h.mount(assembliesWhole(true), { storageKey: "whole" });
        await settle();
        expect(paged).toEqual(tops.flatMap((part) => drawnPart(whole, part)));
    });
});

// ── A gesture drafts its row whole (#1438) ────────────────────────────────────

/** The machines through a Slice, their jobs moving: each Save one commit through the record's patch door, by key. */
const editingPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.const(Record.bind(ex.machines, ["patch"]));
    const slice = $.const(Slice.bindRecords("plan.nested.dom.editing", {
        rows: { source: Data.bindPaged(ex.machines, { indexes: ["machines_by_name", "machines_by_site_status", "machines_in_time"] }), fields: { site: { label: "Site" } } },
    }));
    return Plan({
        axis: axis(), slice: { slice },
        series: [Plan.series.span(ex.Machine, {
            key: "presses", title: "Presses", label: (m) => m.name, edit: true,
            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
        })],
        editing: { onApply: Record.onApply(record, { keyed: true }) },
    });
}))) };

/** The machines as e3 holds them now, read as another planner would. */
const readMachines = async () => (await h.read(ex.machines)) as ReadonlyMap<string, ValueTypeOf<typeof ex.Machine>>;

describe("a gesture drafts its row whole (#1438)", () => {
    test("a job dragged a day along its machine reads the machine whole once, draws at once, and its Save commits the job alone, every other job as it was", async () => {
        onTestFinished(emulateWindowScroll());
        const before = await readMachines();
        const { container: c } = await h.mount(editingPlan, { drag: true });
        await settle();
        const rowsAsked = h.requests("rows", MACHINES).length;
        // The machine's plot across the fortnight, a day 100px wide from x 200.
        const plot = c.querySelector(`${rowAt(entry("presses", "M-10001"))} [data-plan-plot]`)!;
        layOut(new Map([[plot, { left: 200, top: 0, width: 1400, height: 32 }]]));
        const job = () => c.querySelector<HTMLElement>(`${rowAt(entry("presses", "M-10001"))} [data-run="J-10001-114"]`);
        const frac = Number(job()!.getAttribute("data-plan-frac"));
        const x = 200 + frac * 1400 + 10;
        const letGo = await carry(job()!, { x, y: 16 }, { x: x + 100, y: 16 });
        await letGo();
        await settle();
        // The machine read whole, once; the job drawn a day on.
        expect(h.requests("rows", MACHINES).length - rowsAsked).toBe(1);
        await waitFor(() => expect(Number(job()!.getAttribute("data-plan-frac"))).toBeCloseTo(frac + 1 / 14, 3));
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
        await settle();
        // e3 holds the job a day on, and every other job, and every other machine, as it was.
        const after = await readMachines();
        const DAY = 86_400_000;
        const was = before.get("M-10001")!;
        const now = after.get("M-10001")!;
        expect(now.jobs.get("J-10001-114")!.start.getTime() - was.jobs.get("J-10001-114")!.start.getTime()).toBe(DAY);
        expect([...now.jobs.keys()]).toEqual([...was.jobs.keys()]);
        for (const [id, held] of was.jobs) if (id !== "J-10001-114") expect(now.jobs.get(id)).toEqual(held);
        expect(after.get("M-10002")).toEqual(before.get("M-10002"));
    });
});
