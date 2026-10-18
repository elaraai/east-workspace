/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Library follows the rail (#1339, A95, A98, A99) over the kiln yard's
 * records: each source of the one `Slice.bindRecords` narrows every place its
 * rows appear — the Resources tab with the resources, the Events tab and the
 * board's bins with the events — and each tab counts what it shows, `10 of
 * 33`; a tab its source empties says so and clears that source alone; fits,
 * loads, issues and totals still read every lane, resource and event; and each
 * field of the rail carries its source's icon.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { FloatType, StringType, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { pathText } from "../platform/record-paging.test-utils.js";
import { act, allocationHarness, mount, settle, slot } from "./harness.test-utils.js";

const h = allocationHarness();
type Tab = "events" | "resources";
const SEARCH = { events: "Find an event or site", resources: "Find a resource or group" } as const;
const HALL_A = ["K-101", "K-102", "K-103", "K-104", "K-105", "K-106", "K-107", "K-108", "K-109", "K-110"];
async function press(node: Element | null) { expect(node).not.toBeNull(); await act(async () => { fireEvent.click(node!); }); await settle(); }
/** An example mounted over a store of its own, where each source's state is kept. */
async function open(example: { fn: { toIR(): unknown } }) {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const r = mount(example); await settle();
    return { c: r.container, store };
}
/** A source's narrowing written as the rail writes it: one field's values. */
async function narrow(store: UIStore, example: string, source: "lanes" | "resources" | "events", field: string, values: readonly string[]) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none,
        where: new Map([[field, variant("values", values.map(v => printFor(StringType)(v)))]]) })); });
    await settle();
}
/** A source's narrowing: each field's choice. */
type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];
type Choice = Where extends Map<string, infer C> ? C : never;
/** A source's narrowing written whole, as the rail writes it: any choices one index answers. */
async function write(store: UIStore, example: string, source: string, where: Where) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}
const where = (store: UIStore, example: string, source: string) => decodeBeast2For(RecordSliceStateType)(store.read(`ex.${example}.${source}`)!).where;
const pane = (c: HTMLElement, tab: Tab) => c.querySelector<HTMLElement>(`[data-allocation-library="${tab}"]`)!;
const keys = (c: HTMLElement, tab: Tab) => [...pane(c, tab).querySelectorAll("[data-library-item]")].map(el => el.getAttribute("data-library-item"));
const heads = (c: HTMLElement, tab: Tab) => [...pane(c, tab).querySelectorAll("[data-library-head]")].map(head => head.textContent);
const tabs = (c: HTMLElement) => within(slot(c, "start")).getAllByRole("tab").map(t => t.textContent);
const cards = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-card]")].map(el => el.getAttribute("data-allocation-card")!).sort();
const cell = (c: HTMLElement, lane: string, at: Date) => c.querySelector<HTMLElement>(`[data-allocation-cell="${lane}|${at.getTime()}"]`)!;
const hour = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));
const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`);
const summary = (c: HTMLElement) => slot(c, "toolbar").querySelector("[data-record-slices-summary]")?.textContent;
async function tab(c: HTMLElement, name: "Events" | "Resources") {
    await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith(name))!);
}
async function search(c: HTMLElement, t: Tab, text: string) {
    await act(async () => { fireEvent.change(within(pane(c, t)).getByRole("textbox", { name: SEARCH[t] }), { target: { value: text } }); });
    await settle();
}
/** The collapsed pane's rail: its badge and its mark. */
async function rail(c: HTMLElement) {
    await press(within(slot(c, "start")).getByRole("button", { name: "Collapse Library" }));
    const start = slot(c, "start");
    const seen = { badge: start.querySelector("[data-dock-badge]")?.textContent, mark: start.querySelector("[data-dock-mark]")?.getAttribute("aria-label") ?? null };
    await press(within(start).getByRole("button", { name: "Expand Library" }));
    return seen;
}
/** The Table's bands, folded, each head's row count, bins and free slots, summed. */
async function folded(c: HTMLElement) {
    for (let i = 0; i < 4; i++) {
        const open = c.querySelector<HTMLElement>("[data-allocation-band][aria-expanded=true]");
        if (open === null) break;
        await press(open);
    }
    return [...c.querySelectorAll<HTMLElement>("[data-allocation-band]")].reduce((sum, head) => {
        const count = head.querySelector("[data-allocation-band-count]")!;
        const [, bins, free] = /(\d+) bins? · (?:\d+ reserved · )?(\d+) free/.exec(head.textContent!.slice(head.textContent!.indexOf(count.textContent!, 11) + count.textContent!.length))!;
        return { rows: sum.rows + Number(count.textContent), bins: sum.bins + Number(bins), free: sum.free + Number(free) };
    }, { rows: 0, bins: 0, free: 0 });
}
async function drop(from: Element, into: Element) {
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
    await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
afterEach(() => { vi.restoreAllMocks(); });

describe("the Library follows the rail (A98)", () => {
    test("a resource narrowing narrows the Resources tab as it narrows the board: its cards, `Resources 10 of 33`, the rail's badge; the Events tab is the events' alone", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        expect(tabs(c)).toEqual(["Events 27", "Resources 33"]);
        await narrow(store, "allocationKilnYard", "resources", "group", ["Hall A"]);
        await waitFor(() => expect(tabs(c)).toEqual(["Events 27", "Resources 10 of 33"]));
        await tab(c, "Resources");
        expect([...keys(c, "resources")].sort()).toEqual(HALL_A);
        expect((await rail(c)).badge).toBe("10");
        // A lane narrowing hides the board's bins in other lanes, never an Events card.
        await narrow(store, "allocationKilnYard", "lanes", "area", ["South"]);
        await waitFor(() => expect(cards(c)).toHaveLength(8));
        expect(tabs(c)).toEqual(["Events 27", "Resources 10 of 33"]);
    });

    test("a tab its source empties says `No resources match the filters`; its Clear filters clears that source alone", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await narrow(store, "allocationKilnYard", "lanes", "area", ["North"]);
        await narrow(store, "allocationKilnYard", "resources", "group", ["Nowhere"]);
        await tab(c, "Resources");
        const empty = await waitFor(() => { const el = pane(c, "resources").querySelector<HTMLElement>("[data-library-empty][data-narrowed]"); expect(el).not.toBeNull(); return el!; });
        expect(within(empty).getByText("No resources match the filters")).toBeTruthy();
        expect(within(empty).getByText("Change or clear the filters to see more resources.")).toBeTruthy();
        expect(tabs(c)).toEqual(["Events 27", "Resources 0 of 33"]);
        await press(within(empty).getByRole("button", { name: "Clear filters" }));
        expect(where(store, "allocationKilnYard", "resources").size).toBe(0);
        expect([...where(store, "allocationKilnYard", "lanes").keys()]).toEqual(["area"]);
        await waitFor(() => expect(tabs(c)).toEqual(["Events 27", "Resources 33"]));
        await waitFor(() => expect(summary(c)).toBe("2 of 3 lanes·33 of 33 resources·27 of 27 events"));
    });

    test("a tab's search finds among what the rail shows, and its empty search counts what shows", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await narrow(store, "allocationKilnYard", "resources", "group", ["Hall A"]);
        await tab(c, "Resources");
        await search(c, "resources", "K-20");
        const empty = pane(c, "resources").querySelector<HTMLElement>("[data-library-empty]")!;
        expect(empty.hasAttribute("data-narrowed")).toBe(false);
        expect(within(empty).getByText("No resources match")).toBeTruthy();
        expect(within(empty).getByText("Clear the search to see all 10 resources.")).toBeTruthy();
        await search(c, "resources", "K-1");
        expect([...keys(c, "resources")].sort()).toEqual(HALL_A);
    });
});

describe("an events source (A99)", () => {
    test("narrows the Events tab in every group, `Events 3 of 27`; Overdue shows while an event of it does, and the rail's mark with it", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC12"]);
        await waitFor(() => expect(tabs(c)).toEqual(["Events 3 of 27", "Resources 33"]));
        // LD-2231 is overdue, LD-2234 still to book, LD-2205 in the plan.
        expect(heads(c, "events")).toEqual(["Overdue1", "Ready around now1", "Allocated1"]);
        expect(keys(c, "events")).toEqual(["event:LD-2231", "event:LD-2234", "event:LD-2205"]);
        expect(await rail(c)).toEqual({ badge: "3", mark: "Overdue event" });
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC10"]);
        await waitFor(() => expect(heads(c, "events")).toEqual(["Ready around now3"]));
        expect(await rail(c)).toEqual({ badge: "3", mark: null });
    });

    test("on the Timeline, a bin of a hidden event has no card and its hour is still booked; a reservation stays", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        await search(c, "resources", "K-305");
        await drop(pane(c, "resources").querySelector("[data-library-item='K-305']")!, cell(c, "B-1", hour(0, 15)));
        expect(cards(c)).toContain("V1");
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC12"]);
        await waitFor(() => expect(cards(c)).toEqual(["3105", "V1"]));
        // LD-2201's bin 3101 is MC14: gone from B-3 01:55, whose hour stays booked.
        expect(cell(c, "B-3", hour(1, 55)).hasAttribute("data-free")).toBe(false);
        expect(cell(c, "B-3", hour(1, 55)).querySelector("[data-allocation-placeholder]")).toBeNull();
        // Its lane head counts every bin it holds, hidden or not.
        const meta = () => c.querySelector('[data-allocation-lane="B-3"]')!.textContent;
        const before = meta();
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC08", "MC10", "MC12", "MC14", "MC16", "MC18", "MC20", "MC22"]);
        await waitFor(() => expect(cards(c)).toHaveLength(27));
        expect(meta()).toBe(before);
    });

    test("in the Table, the rows of a hidden event's bins go; free rows stay, and each band counts what it shows", async () => {
        const { c, store } = await open(ex.allocationTable);
        await narrow(store, "allocationTable", "events", "spec", ["MC12"]);
        await waitFor(() => expect(tableRow(c, "bin:3101")).toBeNull());
        expect(await folded(c)).toEqual({ rows: 55, bins: 1, free: 54 });
        await waitFor(() => expect(summary(c)).toBe("3 of 3 lanes·33 of 33 resources·3 of 27 events"));
    });

    test("the event Chooser offers the events the narrowing shows: a free row's Book here, and no Allocated event it hides", async () => {
        const { c, store } = await open(ex.allocationTable);
        const sections = async () => {
            await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000")!.querySelector("[data-allocation-cell-side=event] [aria-haspopup=listbox]"));
            const list = document.querySelector<HTMLElement>("[data-chooser]")!;
            const seen = [...list.querySelectorAll<HTMLElement>("[role=group]")].map(group => [group.getAttribute("aria-label"),
                [...group.querySelectorAll("[role=option]")].map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent)]);
            await act(async () => { fireEvent.keyDown(list.querySelector("input")!, { key: "Escape" }); }); await settle();
            return seen;
        };
        const all = await sections();
        expect(all.map(([label]) => label)).toEqual(["Book here", "Allocated"]);
        await narrow(store, "allocationTable", "events", "spec", ["MC10"]);
        await waitFor(() => expect(tableRow(c, "bin:3101")).toBeNull());
        expect(await sections()).toEqual([["Book here", ["LD-2232", "LD-2233", "LD-2235"]]]);
    });

    test("loads, issues and fits read every event, whatever the narrowing hides", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        const issues = () => slot(c, "toolbar").querySelector("[data-allocation-issues]")?.getAttribute("aria-label");
        await waitFor(() => expect(issues()).toBeDefined());
        const before = issues();
        await tab(c, "Resources");
        await search(c, "resources", "K-207");
        const line = () => pane(c, "resources").querySelector("[data-library-item='K-207'] [data-library-note]")!.textContent;
        const load = line();
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC10"]);
        await waitFor(() => expect(cards(c)).toEqual([]));
        // K-207 holds two MC14 bins: hidden, its load is theirs still.
        expect([issues(), line()]).toEqual([before, load]);
    });

    test("a failed events read keeps the last membership, says `Event results unavailable`, the Events tab takes no gesture; Retry reads again", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC12"]);
        await waitFor(() => expect(tabs(c)).toEqual(["Events 3 of 27", "Resources 33"]));
        h.paging.failing.add(pathText(ex.arrivals.path));
        await narrow(store, "allocationKilnYard", "events", "spec", ["MC16"]);
        const banner = () => within(slot(c, "banners")).queryByText("Event results unavailable");
        await waitFor(() => expect(banner()).not.toBeNull());
        expect(tabs(c)).toEqual(["Events 3 of 27", "Resources 33"]);
        expect([pane(c, "events").hasAttribute("inert"), pane(c, "events").getAttribute("aria-busy")]).toEqual([true, "true"]);
        expect(pane(c, "resources").hasAttribute("inert")).toBe(false);
        h.paging.failing.clear();
        await press(within(slot(c, "banners")).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(banner()).toBeNull());
        // LD-2211 is in the plan; LD-2236 still to book.
        await waitFor(() => expect(tabs(c)).toEqual(["Events 2 of 27", "Resources 33"]));
        expect(pane(c, "events").hasAttribute("inert")).toBe(false);
    });
});

describe("the rail names its sources (A95)", () => {
    test("each field's chip carries its source's icon; without one, the rail's own", async () => {
        const icons = (c: HTMLElement) => ["Area", "Kiln group", "Spec"].map(label =>
            slot(c, "toolbar").querySelector(`[data-slice-rail] [title="${label}"] svg`)?.getAttribute("data-icon") ?? null);
        const { c } = await open(ex.allocationKilnYard);
        await waitFor(() => expect(icons(c)).toEqual(["warehouse", "fire", "truck"]));
        const labels = await open(ex.allocationLabels);
        await waitFor(() => expect(icons(labels.c).slice(0, 2)).toEqual(["filter", "filter"]));
    });
});

describe("several indexes on a source", () => {
    const resourceCount = (c: HTMLElement) => Number(c.querySelector("[data-allocation-timeline] [data-virtual-extent]")!.getAttribute("data-virtual-extent")) / 36;
    const laneHeads = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-lane]")].map(el => el.getAttribute("data-allocation-lane"));
    const float = printFor(FloatType), text = printFor(StringType);

    test("a bay's cover, on an index of its own: chosen after an area, the rail says it replaces it, and the board shows the open bay alone", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await press(slot(c, "toolbar").querySelector('[data-record-slice-source="lanes"][data-record-slice-field="area"]'));
        await press(await within(document.body).findByRole("button", { name: "North 2" }));
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-1", "B-2"]));
        await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); }); await settle();
        await press(slot(c, "toolbar").querySelector('[data-record-slice-source="lanes"][data-record-slice-field="cover"]'));
        const openBay = await within(document.body).findByRole("button", { name: /^Open/ });
        expect(document.body.textContent).toContain("Replaces Area: North");
        await press(openBay);
        expect([...where(store, "allocationKilnYard", "lanes").keys()]).toEqual(["cover"]);
        await waitFor(() => expect(laneHeads(c)).toEqual(["B-2"]));
        await waitFor(() => expect(summary(c)).toBe("1 of 3 lanes·33 of 33 resources·27 of 27 events"));
    });

    test("a kiln group and a range of max, one index on group then max: the board and the Resources tab show the four Hall A kilns of 24 m³", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await write(store, "allocationKilnYard", "resources", new Map<string, Choice>([["group", variant("values", [text("Hall A")])], ["max", variant("range", { from: float(24), to: float(25) })]]));
        await waitFor(() => expect(resourceCount(c)).toBe(4));
        await waitFor(() => expect(tabs(c)).toEqual(["Events 27", "Resources 4 of 33"]));
        await tab(c, "Resources");
        expect([...keys(c, "resources")].sort()).toEqual(["K-106", "K-107", "K-109", "K-110"]);
        expect(h.paging.requests.some(r => / index kilns_by_group_max page /.test(r))).toBe(true);
    });

    test("a kiln's name, searched by its start on its own index: `K-2` shows Hall B's nine", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await write(store, "allocationKilnYard", "resources", new Map<string, Choice>([["name", variant("prefix", "K-2")]]));
        await waitFor(() => expect(resourceCount(c)).toBe(9));
        await waitFor(() => expect(tabs(c)).toEqual(["Events 27", "Resources 9 of 33"]));
        expect(h.paging.requests.some(r => / index kilns_by_name /.test(r))).toBe(true);
    });

    test("a max with no group first: bounds typed, its editor asks for the preceding field, and Apply is off", async () => {
        const { c, store } = await open(ex.allocationKilnYard);
        await press(slot(c, "toolbar").querySelector('[data-record-slice-source="resources"][data-record-slice-field="max"]'));
        const from = await within(document.body).findByLabelText("Max m³ from"), until = within(document.body).getByLabelText("Max m³ until");
        await act(async () => { fireEvent.change(from, { target: { value: "24" } }); }); await settle();
        await act(async () => { fireEvent.change(until, { target: { value: "25" } }); }); await settle();
        await waitFor(() => expect(document.body.textContent).toContain("Choose a preceding field first."));
        expect(within(document.body).getByRole("button", { name: "Apply" })).toHaveProperty("disabled", true);
        expect(where(store, "allocationKilnYard", "resources").size).toBe(0);
    });
});
