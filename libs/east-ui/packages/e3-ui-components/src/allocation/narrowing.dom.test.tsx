/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board's narrowing (#1336) over the kiln yard's records: one
 * `Slice.bindRecords` over the bays, the kilns and the loads, each source named
 * after the slot it narrows, read by the board itself —
 * one rail in both layouts, the Timeline's lane columns and resource rows, the
 * Table's rows, the Chooser's resources — while fits, loads and issues read
 * every lane and resource. A source with nothing chosen reads no key. Rows
 * are virtualised, so whole sets are measured by what the panes hold: the
 * resource pane's extent (36px a row) and the Table's folded band heads. A
 * filter change builds nothing again: the board's body runs no more, and no
 * payload is decoded (#1354).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, programOf, settle, slot, type Example, type MountOptions } from "./harness.test-utils.js";
import { countBuilds } from "../shared/builds.test-utils.js";

const h = allocationHarness();
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
/** An example mounted over a store of its own, where each source's state is kept. */
async function open(example: Example, options: MountOptions = {}) {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const r = await h.mount(example, options);
    return { c: r.container, store };
}
/** A source's narrowing written as the rail writes it, under the slot the slice names it by: one field's values. */
async function narrow(store: UIStore, example: string, source: "bays" | "kilns" | "arrivals", field: string, values: readonly string[]) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none,
        where: new Map([[field, variant("values", values.map(v => printFor(StringType)(v)))]]) })); });
    await settle();
}
const where = (store: UIStore, example: string, source: string) => decodeBeast2For(RecordSliceStateType)(store.read(`ex.${example}.${source}`)!).where;
const laneHeads = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-lane]")].map(el => el.getAttribute("data-allocation-lane"));
const cards = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-card]")].map(el => el.getAttribute("data-allocation-card")!).sort();
/** How many resource rows the Timeline holds, mounted or not: its pane's extent over 36px. */
const resourceCount = (c: HTMLElement) => Number(c.querySelector("[data-allocation-timeline] [data-virtual-extent]")!.getAttribute("data-virtual-extent")) / 36;
const mountedResources = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-resource]")].map(el => el.getAttribute("data-allocation-resource"));
const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`);
/** The Table's bands, folded, each head's words: its rows' count, and the bins and free slots it holds. */
async function folded(c: HTMLElement) {
    for (let i = 0; i < 4; i++) {
        const open = c.querySelector<HTMLElement>("[data-allocation-band][aria-expanded=true]");
        if (open === null) break;
        await press(open);
    }
    return [...c.querySelectorAll<HTMLElement>("[data-allocation-band]")].map(head => {
        const count = head.querySelector("[data-allocation-band-count]")!;
        const [, bins, free] = /(\d+) bins? · (?:\d+ reserved · )?(\d+) free/.exec(head.textContent!.slice(head.textContent!.indexOf(count.textContent!, 11) + count.textContent!.length))!;
        return { rows: Number(count.textContent), bins: Number(bins), free: Number(free) };
    });
}
const total = (bands: readonly { rows: number; bins: number; free: number }[]) => ({
    rows: bands.reduce((n, b) => n + b.rows, 0), bins: bands.reduce((n, b) => n + b.bins, 0), free: bands.reduce((n, b) => n + b.free, 0),
});
const summary = (c: HTMLElement) => slot(c, "toolbar").querySelector("[data-record-slices-summary]")?.textContent;
const HALL_A = ["K-101", "K-102", "K-103", "K-104", "K-105", "K-106", "K-107", "K-108", "K-109", "K-110"];
/** The reads of a record's rows through its indexes: its pages, and its reads of several runs in one (#1351). */
const indexReads = (dataset: string) => [...h.requests("page", dataset), ...h.requests("runs", dataset)];
const bayPages = () => indexReads("records.yard_bays").filter(r => r.query.get("index") === ex.yardBaysByArea.name);
const kilnPages = () => indexReads("records.kilns").filter(r => r.query.get("index")?.startsWith("kilns_by_") === true);
afterEach(() => { vi.restoreAllMocks(); });

describe("one rail over the lanes, the resources and the arrivals", () => {
    test("the rail stands in both layouts: each source's fields in source order — Area, Cover; Kiln group, Max m³, Name; Spec — then the presets, and a summary naming only the sources a narrowing hides rows of (#1358)", async () => {
        const { c } = await open(ex.allocationKilnYard);
        const chips = () => [...slot(c, "toolbar").querySelectorAll<HTMLElement>("[data-record-slice-field]")].map(el => `${el.dataset.recordSliceSource}.${el.dataset.recordSliceField}`);
        await waitFor(() => expect(chips()).toEqual(["bays.area", "bays.cover", "kilns.group", "kilns.max", "kilns.name", "arrivals.spec"]));
        // Nothing of the bays, the kilns or the arrivals is narrowed: the summary names the bins alone, the 26 of the record's 33
        // the day's window holds (#1358).
        expect(summary(c)).toBe("26 of 33 bin events");
        expect(toolbar(c).getByRole("button", { name: "North bays, halls" })).not.toBeNull();
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        expect(chips()).toEqual(["bays.area", "bays.cover", "kilns.group", "kilns.max", "kilns.name", "arrivals.spec"]);
        expect(summary(c)).toBe("26 of 33 bin events");
    });

    test("an Area choice through the rail narrows the Timeline's lanes; until a choice, the board reads no bay's key", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await waitFor(() => expect(cards(c)).toHaveLength(26));
        expect(bayPages()).toEqual([]);
        expect(kilnPages()).toEqual([]);
        await press(slot(c, "toolbar").querySelector('[data-record-slice-source="bays"][data-record-slice-field="area"]')!);
        await press(await within(document.body).findByRole("button", { name: "North 2" }));
        expect([...where(store, "allocationKilnYard", "bays").keys()]).toEqual(["area"]);
        expect(where(store, "allocationKilnYard", "kilns").size).toBe(0);
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2"]));
        // B-3's eight bins go with its column, and its 24 lane hours.
        expect(cards(c)).toHaveLength(18);
        expect(cards(c)).not.toContain("3101");
        expect(c.querySelectorAll("[data-allocation-cell]")).toHaveLength(48);
        expect(c.querySelectorAll("[data-allocation-cell][data-free]")).toHaveLength(34);
        expect(bayPages().length).toBeGreaterThan(0);
        // The kilns are not narrowed: none of their keys is read, and every row stays.
        expect(kilnPages()).toEqual([]);
        expect(resourceCount(c)).toBe(33);
        await waitFor(() => expect(summary(c)).toBe("26 of 33 bin events·2 of 3 lanes"));
    });

    test("a preset over both sources narrows each in one gesture; selected again, it clears both", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        const preset = () => toolbar(c).getByRole("button", { name: "North bays, halls" });
        await press(preset());
        expect(where(store, "allocationKilnYard", "bays").get("area")).toEqual(variant("values", ['"North"']));
        expect(where(store, "allocationKilnYard", "kilns").get("group")).toEqual(variant("values", ['"Hall A"', '"Hall B"']));
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2"]));
        await waitFor(() => expect(resourceCount(c)).toBe(19));
        expect(preset().getAttribute("aria-pressed")).toBe("true");
        await press(preset());
        expect([where(store, "allocationKilnYard", "bays").size, where(store, "allocationKilnYard", "kilns").size]).toEqual([0, 0]);
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2", "B-3"]));
        await waitFor(() => expect(resourceCount(c)).toBe(33));
    });
});

describe("the Table, narrowed", () => {
    test("unnarrowed: 80 rows, 26 bins and 54 free slots", async () => {
        const { c } = await open(ex.allocationTable);
        expect(total(await folded(c))).toEqual({ rows: 80, bins: 26, free: 54 });
    });

    test("a lane narrowing hides that lane's rows, free and booked; each band counts what it shows", async () => {
        const { c, store } = await open(ex.allocationTable);
        await narrow(store, "allocationTable", "bays", "area", ["North"]);
        await waitFor(() => expect(tableRow(c, "bin:3101")).toBeNull());
        for (const row of c.querySelectorAll<HTMLElement>("[data-allocation-row]")) expect(["B-1", "B-2"]).toContain(row.children[1]!.textContent);
        const bands = await folded(c);
        expect(bands).toHaveLength(4);
        for (const band of bands) expect(band.rows).toBe(band.bins + band.free);
        expect(total(bands)).toEqual({ rows: 52, bins: 18, free: 34 });
    });

    test("a resource narrowing hides a row whose resources it hides; a free row and a row not yet allocated stay", async () => {
        const { c, store } = await open(ex.allocationTable);
        await press(within(tableRow(c, "bin:3101")!).getByRole("button", { name: "Unlink LD-2201 from K-209" }));
        await narrow(store, "allocationTable", "kilns", "group", ["Hall A"]);
        // LD-2202 is on K-102, in Hall A; LD-2201 is now on no kiln.
        await waitFor(() => expect(tableRow(c, "bin:3102")).not.toBeNull());
        expect(tableRow(c, "bin:3101")!.querySelector("[data-status]")!.getAttribute("data-status")).toBe("Not linked");
        expect(tableRow(c, "bin:3104")).toBeNull();
        expect(kilnPages().length).toBeGreaterThan(0);
        expect(bayPages()).toEqual([]);
        // Every free slot, LD-2201, and the six bins on Hall A's kilns.
        expect(total(await folded(c))).toEqual({ rows: 61, bins: 7, free: 54 });
    });

    test("both together: a row shows when its lane and one of its resources show", async () => {
        const { c, store } = await open(ex.allocationTable);
        await narrow(store, "allocationTable", "bays", "area", ["North"]);
        await narrow(store, "allocationTable", "kilns", "group", ["Hall A"]);
        await waitFor(() => expect(summary(c)).toBe("26 of 33 bin events·2 of 3 lanes·10 of 33 resources"));
        // LD-2203 (B-1, K-109) shows; LD-2202 (B-3, K-102) is in a hidden lane; LD-2204 (B-1, K-501) on a hidden kiln.
        expect(tableRow(c, "bin:3103")).not.toBeNull();
        expect([tableRow(c, "bin:3102"), tableRow(c, "bin:3104")]).toEqual([null, null]);
        // B-1's and B-2's free slots, and LD-2203, LD-2210, LD-2212 and LD-2220 on Hall A's kilns.
        expect(total(await folded(c))).toEqual({ rows: 38, bins: 4, free: 34 });
    });

    test("a split bin shows while any of its resources shows", async () => {
        const { c, store } = await open(ex.allocationSplit);
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        await narrow(store, "allocationSplit", "kilns", "group", ["Bulk"]);
        // 3201's parts are on K-601 (Bulk) and K-208; 3202's and 3203's are none of them Bulk. Wed 12's window holds three bins.
        await waitFor(() => expect(summary(c)).toBe("3 of 33 bin events·2 of 33 resources"));
        expect(total(await folded(c))).toEqual({ rows: 70, bins: 1, free: 69 });
        await narrow(store, "allocationSplit", "kilns", "group", ["Hall A"]);
        // 3202 is on K-107 and K-110, 3203 on K-305 and K-110: each has a part in Hall A; 3201 has none.
        expect(total(await folded(c))).toEqual({ rows: 71, bins: 2, free: 69 });
    });

    test("the resource Chooser offers the resources the narrowing shows, and the current one; the fit still answers for every one", async () => {
        const { c, store } = await open(ex.allocationTable);
        await narrow(store, "allocationTable", "kilns", "group", ["Hall A"]);
        await waitFor(() => expect(tableRow(c, "bin:3102")).not.toBeNull());
        await press(tableRow(c, "bin:3102")!.querySelector("[data-allocation-cell-side=resource] [aria-haspopup=listbox]")!);
        await settle();
        const list = document.querySelector<HTMLElement>("[data-chooser]")!;
        const offered = [...list.querySelectorAll("[role=option]")].map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent).sort();
        expect(offered).toEqual(HALL_A);
        expect(list.querySelector("[role=group]")!.getAttribute("aria-label")).toBe("Current");
        type Answer = { resources: Map<string, unknown> };
        expect((h.fits.answers() as Answer[]).at(-1)!.resources.size).toBe(33);
    });

    test("loads and issues read every resource, whatever the narrowing hides", async () => {
        const { c, store } = await open(ex.allocationTable);
        const issues = () => slot(c, "toolbar").querySelector("[data-allocation-issues]")?.getAttribute("aria-label");
        const load = () => tableRow(c, "bin:3102")!.children[7]!.textContent;
        await waitFor(() => expect(issues()).toBeDefined());
        const before = [issues(), load()];
        await narrow(store, "allocationTable", "bays", "area", ["South"]);
        await narrow(store, "allocationTable", "kilns", "group", ["Hall A"]);
        await waitFor(() => expect(tableRow(c, "bin:3103")).toBeNull());
        expect([issues(), load()]).toEqual(before);
    });

    test("a narrowing that leaves nothing says so, in either layout, and Clear filters brings every row back", async () => {
        const { c, store } = await open(ex.allocationTable);
        await narrow(store, "allocationTable", "bays", "area", ["East"]);
        await narrow(store, "allocationTable", "kilns", "group", ["Bulk"]);
        await waitFor(() => expect(c.querySelector("[data-allocation-narrowed-empty]")).not.toBeNull());
        expect(c.querySelectorAll("[data-allocation-row], [data-allocation-band]")).toHaveLength(0);
        expect(c.querySelector("[data-allocation-table-head]")).not.toBeNull();
        expect(c.querySelector("[data-allocation-narrowed-empty]")!.textContent).toContain("No rows match the filters");
        await press(within(c.querySelector<HTMLElement>("[data-allocation-narrowed-empty]")!).getByRole("button", { name: "Clear filters" }));
        expect([where(store, "allocationTable", "bays").size, where(store, "allocationTable", "kilns").size]).toEqual([0, 0]);
        await waitFor(() => expect(c.querySelector("[data-allocation-narrowed-empty]")).toBeNull());
        expect(total(await folded(c))).toEqual({ rows: 80, bins: 26, free: 54 });
        await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
        await narrow(store, "allocationTable", "bays", "area", ["East"]);
        await waitFor(() => expect(c.querySelector("[data-allocation-narrowed-empty]")).not.toBeNull());
        expect(c.querySelector("[data-allocation-timeline]")).toBeNull();
    });
});

describe("the Timeline, narrowed", () => {
    test("a lane narrowing keeps every resource row; a resource narrowing every lane column", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await narrow(store, "allocationKilnYard", "bays", "area", ["South"]);
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-3"]));
        expect(resourceCount(c)).toBe(33);
        expect(cards(c)).toEqual(["3101", "3102", "3116", "3118", "3119", "3120", "3123", "3124"]);
        // A card stands in its lane's column among those shown.
        expect(c.querySelector<HTMLElement>('[data-allocation-card="3101"]')!.style.getPropertyValue("--card-lane")).toBe("0");
        await narrow(store, "allocationKilnYard", "bays", "area", ["North", "South"]);
        await narrow(store, "allocationKilnYard", "kilns", "group", ["Bulk"]);
        await waitFor(() => expect(mountedResources(c)).toEqual(["K-601", "K-602"]));
        expect(resourceCount(c)).toBe(2);
        expect(laneHeads(c)).toEqual(["B-1", "B-2", "B-3"]);
        expect(cards(c)).toHaveLength(26);
    });

    test("a focus's link to a card in a hidden lane is not drawn; the focus stays", async () => {
        const spy = vi.mocked(Element.prototype.getBoundingClientRect);
        const base = spy.getMockImplementation()!;
        spy.mockImplementation(function (this: Element) {
            const box = (left: number, width: number, height: number) => ({ x: left, y: 0, top: 0, left, right: left + width, bottom: height, width, height, toJSON() {} });
            if (this.hasAttribute("data-allocation-timeline")) return box(0, 1200, 700);
            if (this.hasAttribute("data-allocation-grid")) return box(10, 336, 1116);
            if (this.hasAttribute("data-allocation-channel")) return box(347, 48, 700);
            return base.call(this);
        });
        const { c, store } = await open(ex.allocationKilnYard);
        await press(c.querySelector('[data-allocation-resource="K-202"]')!);
        const links = () => [...c.querySelectorAll("[data-allocation-links] [data-link]")].map(l => l.getAttribute("data-allocation-link")).sort();
        // K-202 holds LD-2219 in B-3 and LD-2221 in B-2.
        expect(links()).toEqual(["3123|K-202", "3126|K-202"]);
        await narrow(store, "allocationKilnYard", "bays", "area", ["North"]);
        await waitFor(() => expect(links()).toEqual(["3126|K-202"]));
        expect(c.querySelector('[data-allocation-resource="K-202"]')!.getAttribute("aria-pressed")).toBe("true");
    });

    test("a narrowing read while the day stands in keeps the day's bins in their cells, retained — stale, aria-disabled, never inert: focusable and selectable, Delete and a drag refused — until it lands (#1398, CL5, CL8)", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await waitFor(() => expect(cards(c)).toHaveLength(26));
        const board = () => slot(c, "main").querySelector<HTMLElement>("[data-allocation-main]")!;
        const card = () => c.querySelector<HTMLElement>('[data-allocation-card="3103"]')!;
        expect(board().hasAttribute("data-allocation-stale")).toBe(false);
        // The bays' reads held on their way to e3: the lanes' new membership is in flight.
        const held = h.e3.hold(request => request.dataset === "records.yard_bays");
        await narrow(store, "allocationKilnYard", "bays", "area", ["North"]);
        expect([board().hasAttribute("data-allocation-stale"), board().getAttribute("aria-disabled"), board().hasAttribute("inert")]).toEqual([true, "true", false]);
        // The day stands in, whole: its lanes and its bins as they were, never a cover.
        expect([laneHeads(c), cards(c).length]).toEqual([["B-1", "B-2", "B-3"], 26]);
        expect(c.querySelector("[data-builder-loading]")).toBeNull();
        // A bin is focusable and selectable; Delete removes nothing, and a drag picks nothing up.
        card().focus();
        expect(document.activeElement).toBe(card());
        await press(card());
        expect(card().getAttribute("aria-pressed")).toBe("true");
        await act(async () => { fireEvent.keyDown(card(), { key: "Delete" }); });
        await settle();
        expect(cards(c)).toHaveLength(26);
        await act(async () => { fireEvent.pointerDown(card(), { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 });
            fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 20 }); });
        expect(card().hasAttribute("data-dragging")).toBe(false);
        await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 20 }); });
        await act(async () => { held.release(); });
        await settle();
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2"]));
        expect([board().hasAttribute("data-allocation-stale"), board().hasAttribute("aria-disabled"), board().hasAttribute("inert")]).toEqual([false, false, false]);
        // Landed: the selection kept, and Delete takes the bin back.
        expect(card().getAttribute("aria-pressed")).toBe("true");
        await act(async () => { fireEvent.keyDown(card(), { key: "Delete" }); });
        await settle();
        expect(cards(c)).not.toContain("3103");
    });

    test("a failed lane read keeps the last lanes, says `Lane results unavailable`, and Retry reads the lanes again", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await waitFor(() => expect(cards(c)).toHaveLength(26));
        const failing = h.unavailable(ex.yardBays);
        await narrow(store, "allocationKilnYard", "bays", "area", ["North"]);
        const banner = () => within(slot(c, "banners")).queryByText("Lane results unavailable");
        await waitFor(() => expect(banner()).not.toBeNull());
        expect(within(slot(c, "banners")).queryByText("Resource results unavailable")).toBeNull();
        // The last complete membership still shows, retained (#1398, CL8): aria-disabled, taking no gesture.
        expect(laneHeads(c)).toEqual(["B-1", "B-2", "B-3"]);
        const board = slot(c, "main").querySelector("[data-allocation-main]")!;
        expect([board.getAttribute("aria-disabled"), board.hasAttribute("inert")]).toEqual(["true", false]);
        // The service answers again: Retry asks again at once.
        failing();
        await press(within(slot(c, "banners")).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(banner()).toBeNull());
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2"]));
    });
});

describe("a filter change rebuilds no builder (#1354)", () => {
    test("a choice on the rail builds the board no more: the lanes, the resource rows and the summary follow it over the payload it mounted with", async () => {
        const builds = countBuilds("Allocation", programOf(ex.allocationKilnYard));
        const { c, store } = await open(ex.allocationKilnYard, { program: builds.program });
        await waitFor(() => expect(cards(c)).toHaveLength(26));
        const mounted = [builds.runs, builds.decodes];
        expect(Math.min(...mounted)).toBeGreaterThan(0);
        await narrow(store, "allocationKilnYard", "bays", "area", ["North"]);
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2"]));
        await narrow(store, "allocationKilnYard", "kilns", "group", ["Bulk"]);
        await waitFor(() => expect(resourceCount(c)).toBe(2));
        await waitFor(() => expect(summary(c)).toBe("26 of 33 bin events·2 of 3 lanes·2 of 33 resources"));
        expect([builds.runs, builds.decodes], "no choice runs the body again or decodes a payload").toEqual(mounted);
    });
});
