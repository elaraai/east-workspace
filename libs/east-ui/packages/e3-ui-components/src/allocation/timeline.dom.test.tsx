/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Timeline (#1326) over the kiln yard's records: the lane grid and its
 * cards, the lane heads, the resource rows in their fixed order with their
 * lines and bars, the ruler, the focus and its chip; and the frame's day
 * sessions (#1325) acted on through the Timeline's cards. Every expected word
 * and figure is the mock's, as it draws the same yard.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, mount, settle, slot, TUE, TUE_4 } from "./harness.test-utils.js";

const h = allocationHarness();
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`);
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`);
const cssVar = (el: Element | null, name: string) => (el as HTMLElement | null)?.style.getPropertyValue(name);
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
async function open(example: { fn: { toIR(): unknown } } = ex.allocationKilnYard) { const r = mount(example); await settle(); return r.container; }

describe("the lane grid", () => {
    test("A14 — a card per bin at its lane and its hour; an hour's batch stacks a 36px row per bin; free lane hours are cells of their own", async () => {
        const c = await open();
        expect(c.querySelectorAll("[data-allocation-card]")).toHaveLength(26);
        // LD-2201 and LD-2202 are B-3's 01:55 batch: rows 1 and 2, the band of hour 01 two rows high.
        expect([cssVar(card(c, "3101"), "--card-lane"), cssVar(card(c, "3101"), "--card-row")]).toEqual(["2", "1"]);
        expect([cssVar(card(c, "3102"), "--card-lane"), cssVar(card(c, "3102"), "--card-row")]).toEqual(["2", "2"]);
        expect([cssVar(card(c, "3103"), "--card-lane"), cssVar(card(c, "3103"), "--card-row")]).toEqual(["0", "3"]);
        // Each hour's band is as many rows as its largest batch, the mock's hour heights over 36px.
        const spans = [...c.querySelectorAll("[data-allocation-band]")].map(band => Number(cssVar(band, "--band-span")));
        expect(spans).toEqual([1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 3, 1, 1, 2, 1, 1, 1]);
        expect([...c.querySelectorAll("[data-allocation-band]")].map(band => band.textContent)).toEqual(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")));
        expect(c.querySelectorAll("[data-allocation-cell]")).toHaveLength(72);
        expect(c.querySelectorAll("[data-allocation-cell][data-free]")).toHaveLength(54);
    });

    test("A15 — each lane's head: the lane, `at :15` and its tooltip, and `N bins · Q m³` over its bins", async () => {
        const c = await open();
        const heads = [...c.querySelectorAll("[data-allocation-lane]")].map(head => {
            const [name, meta] = [...head.children] as HTMLElement[];
            return [name!.textContent, name!.title, meta!.textContent, meta!.title];
        });
        expect(heads).toEqual([
            ["B-1at :15", "B-1 takes one bin at :15 past each hour", "7 bins · 131 m³", "Bins booked in this lane today · m³"],
            ["B-2at :35", "B-2 takes one bin at :35 past each hour", "11 bins · 242 m³", "Bins booked in this lane today · m³"],
            ["B-3at :55", "B-3 takes one bin at :55 past each hour", "8 bins · 183 m³", "Bins booked in this lane today · m³"],
        ]);
    });

    test("A16 — a card's lines: its code and quantity, `→ K-209`; its tooltip names its event, its slot and its resource", async () => {
        const c = await open();
        const ld2201 = card(c, "3101")!;
        expect(ld2201.querySelector("[data-allocation-code]")!.textContent).toBe("LD-2201");
        expect(ld2201.textContent).toContain("35 m³");
        expect(ld2201.querySelector("[data-allocation-to]")!.textContent).toBe("K-209");
        expect(ld2201.title).toBe("LD-2201 · BRK · R1 · spec MC14 · 35 m³ · B-3 01:55 on K-209 · drag to another lane hour to move it");
    });

    test("A16 — a card's marks: the app's flags (its tooltip the issue's title), ⚠ overlapping a next job, ● over max", async () => {
        const c = await open();
        const marks = (id: string) => [...card(c, id)!.querySelectorAll("[data-mark]")].map(m => m.getAttribute("data-mark"));
        const flagged = [...c.querySelectorAll("[data-allocation-card]")].filter(el => el.querySelector("[data-mark=flag]") !== null).map(el => el.getAttribute("data-allocation-card")).sort();
        expect(flagged).toEqual(["3102", "3105", "3106", "3108", "3112", "3113", "3115", "3116", "3117", "3119", "3121"]);
        expect(card(c, "3102")!.querySelector("[data-mark=flag]")!.textContent).toBe("≠ spec");
        expect(card(c, "3102")!.querySelector<HTMLElement>("[data-mark=flag]")!.title).toBe("LD-2202 · bin 3102");
        expect(marks("3109")).toEqual(["over"]);
        expect(marks("3117")).toEqual(["flag", "overlap"]);
        expect(marks("3124")).toEqual(["overlap"]);
        expect(card(c, "3124")!.querySelector("[data-mark=overlap] [aria-label]")!.getAttribute("aria-label")).toBe("Overlaps the next job");
        expect(marks("3101")).toEqual([]);
    });

    test("A16 — a card under its resource's minimum carries ↓, its tooltip the load it leaves", async () => {
        const c = await open(ex.allocationMinimal);
        const plans = h.read(ex.kilnPlans);
        const day = plans.get(TUE)!;
        day.bins.get("3113")!.quantity = 10;
        day.bins.get("3113")!.parts.set("K-108", 10);
        await h.commit(ex.kilnPlans, plans);
        const under = card(c, "3113")!.querySelector<HTMLElement>("[data-mark=under]")!;
        expect(under.title).toBe("K-108 is under its minimum: 10 m³ · min 16 · 6 short");
    });

    test("A16 — a reservation: dashed, `Reserved`, no quantity, and its own tooltip; an unlinked bin reads `not linked`", async () => {
        const c = await open(ex.allocationMinimal);
        const plans = h.read(ex.kilnPlans);
        const day = plans.get(TUE)!;
        day.bins.set("R1", { lane: "B-1", at: new Date(Date.UTC(2027, 4, 11, 0, 15)), event: none, quantity: 0, kind: none, hold: variant("days", 0),
            parts: new SortedMap([["K-601", 0]], compareFor(StringType)), values: { specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none } });
        day.bins.get("3101")!.parts.clear();
        await h.commit(ex.kilnPlans, plans);
        const reserved = card(c, "R1")!;
        expect(reserved.hasAttribute("data-reserved")).toBe(true);
        expect(reserved.querySelector("[data-allocation-code]")!.textContent).toBe("Reserved");
        expect(reserved.textContent).not.toContain("m³");
        expect(reserved.title).toBe("Reserved · B-1 00:15 on K-601 · no event yet · drag to another lane hour to move it");
        const unlinked = card(c, "3101")!;
        expect(unlinked.querySelector("[data-unlinked]")!.textContent).toBe("not linked");
        // The smallest board's events carry no meta.
        expect(unlinked.title).toBe("LD-2201 · 35 m³ · B-3 01:55 · not linked · drag to another lane hour to move it");
    });

    test("A17 — nothing that removes sits on a card: its only control is its connector", async () => {
        const c = await open();
        for (const el of c.querySelectorAll("[data-allocation-card]")) {
            expect([...el.querySelectorAll("button")].map(b => b.hasAttribute("data-allocation-connector"))).toEqual([true]);
        }
    });

    test("A21 — the connector's words: allocated, or not; a click selects its bin; a published day has none", async () => {
        const c = await open();
        const connector = (id: string) => card(c, id)!.querySelector<HTMLElement>("[data-allocation-connector]")!;
        expect(connector("3101").getAttribute("aria-label")).toBe("Allocated to K-209 · drag the connector onto a resource to move it · click to choose another");
        await press(connector("3101"));
        expect(card(c, "3101")!.getAttribute("aria-pressed")).toBe("true");
        const plans = h.read(ex.kilnPlans);
        plans.get(TUE)!.bins.get("3102")!.parts.clear();
        await h.commit(ex.kilnPlans, plans);
        expect(connector("3102").getAttribute("aria-label")).toBe("Drag the connector onto a resource to allocate LD-2202 · click to choose one");
        expect(card(c, "3102")!.querySelector("[data-allocation-connector] [data-state]")!.getAttribute("data-state")).toBe("unlinked");
        await key(c, "["); for (let i = 0; i < 6; i++) await key(c, "[");
        expect(Number(slot(c, "main").querySelector("[data-allocation-main]")!.getAttribute("data-allocation-day"))).toBe(TUE_4.getTime());
        expect(c.querySelectorAll("[data-allocation-card]").length).toBeGreaterThan(0);
        expect(c.querySelector("[data-allocation-connector]")).toBeNull();
    });
});

describe("the resource rows", () => {
    test("A18 — one fixed order, the resources' key order, with no status groups; an edit moves no row", async () => {
        const c = await open(ex.allocationMinimal);
        const order = () => [...c.querySelectorAll("[data-allocation-resource]")].map(r => r.getAttribute("data-allocation-resource"));
        const first = order();
        expect(first.slice(0, 12)).toEqual(["K-101", "K-102", "K-103", "K-104", "K-105", "K-106", "K-107", "K-108", "K-109", "K-110", "K-201", "K-202"]);
        await press(card(c, "3101")!);
        await key(c, "Delete");
        expect(card(c, "3101")).toBeNull();
        expect(order()).toEqual(first);
    });

    test("A18 — the narrowing hides rows but never reorders them; A13 — a focus it hides is `hidden by Filters`", async () => {
        const store = new UIStore(); StateRuntime.initializeStore(store);
        const c = await open();
        const order = () => [...c.querySelectorAll("[data-allocation-resource]")].map(r => r.getAttribute("data-allocation-resource"));
        await waitFor(() => expect(order().length).toBeGreaterThan(0));
        await press(card(c, "3101")!);
        const chip = () => toolbar(c).getByTitle("The focus: its links are drawn · Esc returns to all").textContent;
        expect(chip()).toBe("K-2091 bin · 35 m³");
        const key = "ex.allocationKilnYard.kilns";
        const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
        await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map([["group", variant("values", [printFor(StringType)("Hall A")])]]), preset: none })); });
        await waitFor(() => expect(order()).toEqual(["K-101", "K-102", "K-103", "K-104", "K-105", "K-106", "K-107", "K-108", "K-109", "K-110"]));
        expect(chip()).toBe("K-2091 bin · 35 m³ · hidden by Filters");
        // The lane grid is never narrowed: every bin still has its card.
        expect(c.querySelectorAll("[data-allocation-card]")).toHaveLength(26);
    });

    test("A19 — a row's line: its load, `· 2 d into next job` in warn-text, over max in neg-text, busy, or free", async () => {
        const c = await open(ex.allocationMinimal);
        const line = (k: string) => { const el = row(c, k)!.querySelector("[data-allocation-line]")!; return [el.textContent, el.getAttribute("data-tone")]; };
        expect(line("K-101")).toEqual(["31 m³ · takes 16–32", null]);
        expect(line("K-105")).toEqual(["32 m³ · takes 16–32 · 2 d into next job", "warning"]);
        expect(line("K-103")).toEqual(["takes 16–32 m³", null]);
        const yard = await open();
        expect(row(yard, "K-103")!.querySelector("[data-allocation-line]")!.textContent).toBe("Hall A · 32 m³ · takes 16–32 m³");
        expect(row(yard, "K-207")!.querySelector("[data-allocation-line]")!.getAttribute("data-tone")).toBe("danger");
    });

    test("A20 — a row's plot: the prior job, the next job `planned`, the day's load for its hold, the overlap wash", async () => {
        const c = await open(ex.allocationMinimal);
        const bars = (k: string) => [...row(c, k)!.querySelectorAll("[data-kind]")].map(b => [b.getAttribute("data-kind"), b.textContent]);
        expect(bars("K-103")).toEqual([["next", "planned"]]);
        expect(bars("K-105")).toEqual([["next", "planned"], ["load", "32 m³"]]);
        expect(row(c, "K-105")!.querySelector("[data-allocation-overlap]")).not.toBeNull();
        expect(row(c, "K-101")!.querySelector("[data-allocation-overlap]")).toBeNull();
        // The day's load starts at the plan day: Tue 11 is the fourth of the axis's thirteen days.
        const load = row(c, "K-105")!.querySelector<HTMLElement>("[data-allocation-load]")!;
        expect(Number.parseFloat(load.style.left)).toBeCloseTo(300 / 13, 6);
        expect(Number.parseFloat(load.style.width)).toBeCloseTo(800 / 13, 6);
        expect(row(c, "K-207")!.querySelector("[data-allocation-load]")!.hasAttribute("data-over")).toBe(true);
    });

    test("A20 — the ruler: the weeks over the days, the plan day badged", async () => {
        const c = await open(ex.allocationMinimal);
        const head = c.querySelector("[data-allocation-resource-head]")!;
        expect([...head.querySelectorAll("[data-time-ruler=units] [data-tick-label]")].map(l => l.textContent)).toEqual(["W18", "W19 · May 10", "W20 · May 17"]);
        const days = [...head.querySelectorAll("[data-time-ruler=ticks] > *")];
        expect(days).toHaveLength(13);
        expect(days.findIndex(d => d.hasAttribute("data-now"))).toBe(3);
    });
});

describe("selection and the focus", () => {
    test("A8 — a click on a card selects its bin; on a resource row, the resource", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3101")!);
        expect(card(c, "3101")!.getAttribute("aria-pressed")).toBe("true");
        expect(row(c, "K-209")!.hasAttribute("data-selected")).toBe(true);
        await press(row(c, "K-103")!);
        expect(card(c, "3101")!.getAttribute("aria-pressed")).toBe("false");
        expect(row(c, "K-103")!.getAttribute("aria-pressed")).toBe("true");
        // A click on a lane hour clears it.
        await press(c.querySelector("[data-allocation-cell][data-free]")!);
        expect(row(c, "K-103")!.getAttribute("aria-pressed")).toBe("false");
    });

    test("A13 — the focus: every other card dims, its load outlined, its hold banded and its days in ink; the chip names it; × or Esc clears it", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3124")!);
        const dimmed = [...c.querySelectorAll("[data-allocation-card][data-dim]")].map(el => el.getAttribute("data-allocation-card"));
        expect(dimmed).toHaveLength(25);
        expect(dimmed).not.toContain("3124");
        expect(row(c, "K-105")!.querySelector("[data-allocation-load]")!.hasAttribute("data-focus")).toBe(true);
        expect(row(c, "K-101")!.querySelector("[data-allocation-span]")).not.toBeNull();
        const marked = [...c.querySelectorAll("[data-time-ruler=ticks] > [data-marked]")];
        expect(marked).toHaveLength(8);
        const chip = toolbar(c).getByTitle("The focus: its links are drawn · Esc returns to all");
        expect(chip.textContent).toBe("K-1051 bin · 32 m³");
        await press(within(chip).getByRole("button", { name: "Show all" }));
        expect(c.querySelectorAll("[data-allocation-card][data-dim]")).toHaveLength(0);
        expect(toolbar(c).queryByTitle("The focus: its links are drawn · Esc returns to all")).toBeNull();
        await press(row(c, "K-209")!);
        expect([...c.querySelectorAll("[data-allocation-card]:not([data-dim])")].map(el => el.getAttribute("data-allocation-card"))).toEqual(["3101"]);
        await key(c, "Escape");
        expect(c.querySelectorAll("[data-allocation-card][data-dim]")).toHaveLength(0);
    });
});

describe("the day's sessions, through the Timeline (#1325)", () => {
    test("A5 — each day keeps its own drafts and history while the viewer moves between days", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3101")!); await key(c, "Delete");
        expect(card(c, "3101")).toBeNull();
        await key(c, "]");
        expect(c.querySelector("[data-allocation-card]")).not.toBeNull();
        await key(c, "[");
        expect(card(c, "3101")).toBeNull();
        expect(toolbar(c).getByRole("button", { name: editingMessages.undo() })).toHaveProperty("disabled", false);
    });

    test("A6 — Delete or Backspace removes the selected bin; Esc clears the selection", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3101")!); await key(c, "Delete");
        expect(card(c, "3101")).toBeNull();
        await press(card(c, "3102")!); await key(c, "Backspace");
        expect(card(c, "3102")).toBeNull();
        await press(card(c, "3103")!); await key(c, "Escape");
        expect(card(c, "3103")!.getAttribute("aria-pressed")).toBe("false");
        await key(c, "Delete");
        expect(card(c, "3103")).not.toBeNull();
    });

    test("A7 — Table and back keeps the drafts, the selection and the history, and is not a change", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3101")!); await key(c, "Delete");
        await press(card(c, "3103")!);
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
        expect(card(c, "3101")).toBeNull();
        expect(card(c, "3103")!.getAttribute("aria-pressed")).toBe("true");
        await press(toolbar(c).getByRole("button", { name: editingMessages.undo() }));
        expect(card(c, "3101")).not.toBeNull();
        expect(toolbar(c).getByRole("button", { name: editingMessages.undo() })).toHaveProperty("disabled", true);
    });

    test("A75 — every gesture is one transaction: each removal one undo step", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3101")!); await key(c, "Delete");
        await press(card(c, "3102")!); await key(c, "Delete");
        const undo = toolbar(c).getByRole("button", { name: editingMessages.undo() });
        await press(undo);
        expect([card(c, "3101") === null, card(c, "3102") === null]).toEqual([true, false]);
        await press(undo);
        expect(card(c, "3101")).not.toBeNull();
    });

    test("A77 — Discard drops the day's drafts at once; Save applies the day as one checked patch", async () => {
        const c = await open(ex.allocationMinimal);
        await press(card(c, "3101")!); await key(c, "Delete");
        await press(card(c, "3102")!); await key(c, "Delete");
        await press(toolbar(c).getByRole("button", { name: editingMessages.discard() }));
        expect([card(c, "3101") !== null, card(c, "3102") !== null]).toEqual([true, true]);
        await press(card(c, "3101")!); await key(c, "Delete");
        await press(card(c, "3102")!); await key(c, "Delete");
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        const saved = h.read(ex.kilnPlans).get(TUE)!;
        expect(saved.bins.size).toBe(24);
        expect([saved.bins.has("3101"), saved.bins.has("3102")]).toEqual([false, false]);
    });
});

/** The board's three boxes the links run between, as a browser lays them out: jsdom lays out nothing. */
function stubLinkGeometry() {
    const spy = vi.mocked(Element.prototype.getBoundingClientRect);
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(function (this: Element) {
        const box = (left: number, width: number, height: number) => ({ x: left, y: 0, top: 0, left, right: left + width, bottom: height, width, height, toJSON() {} });
        if (this.hasAttribute("data-allocation-timeline")) return box(0, 1200, 700);
        if (this.hasAttribute("data-allocation-grid")) return box(10, 336, 1116);
        if (this.hasAttribute("data-allocation-channel")) return box(347, 48, 700);
        return base.call(this);
    });
}
const links = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-links] [data-plan-link]")];
const hitOf = (c: HTMLElement, bin: string, resource: string) => c.querySelector<SVGPathElement>(`[data-allocation-link="${bin}|${resource}"]`)!;
const captionOf = (c: HTMLElement, bin: string, resource: string) => c.querySelector<SVGGElement>(`[data-allocation-caption="${bin}|${resource}"]`)!;

describe("the focus's links (#1327)", () => {
    test("A65 — links draw only for the focus: none at rest; the selected bin's resource's family; the selected resource's", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationMinimal);
        expect(c.querySelector("[data-allocation-links]")).toBeNull();
        await press(card(c, "3101")!);
        expect(links(c)).toHaveLength(1);
        await press(row(c, "K-202")!);
        expect(links(c)).toHaveLength(2);
        expect([...c.querySelectorAll("[data-allocation-links] [data-plan-ribbon-caption]")].map(t => t.textContent)).toEqual(["22 m³", "17 m³"]);
        await key(c, "Escape");
        expect(c.querySelector("[data-allocation-links]")).toBeNull();
    });

    test("A66 — each link is weighted by its share of the family's largest: K-304's 1 m³ bins at 4, its 2 m³ bins at 8", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationMinimal);
        await press(row(c, "K-304")!);
        const weights = Object.fromEntries(links(c).map(g => [g.querySelector("[data-link]")!.getAttribute("data-allocation-link"), g.querySelector("[data-plan-ribbon-band]")!.getAttribute("stroke-width")]));
        expect(weights).toEqual({ "3106|K-304": "4", "3110|K-304": "4", "3112|K-304": "8", "3114|K-304": "8", "3121|K-304": "4" });
    });

    test("A67 — a link under the pointer lights, its bin card and its resource's load haloed; its line's label and tooltip name it", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationMinimal);
        await press(row(c, "K-202")!);
        const hit = hitOf(c, "3123", "K-202");
        expect(hit.getAttribute("aria-label")).toBe("Link of LD-2219, 22 m³");
        expect(hit.querySelector("title")!.textContent).toBe("Link of LD-2219, 22 m³ · click to select");
        expect(captionOf(c, "3123", "K-202").querySelector("title")!.textContent).toBe("Click to select the link, then Delete · drag onto a resource row to move it");
        await act(async () => { fireEvent.pointerEnter(hit); });
        expect(card(c, "3123")!.hasAttribute("data-link-lit")).toBe(true);
        expect(card(c, "3126")!.hasAttribute("data-link-lit")).toBe(false);
        expect(row(c, "K-202")!.querySelector("[data-allocation-load]")!.hasAttribute("data-link-lit")).toBe(true);
        await act(async () => { fireEvent.pointerLeave(hit); });
        expect(card(c, "3123")!.hasAttribute("data-link-lit")).toBe(false);
        // The caption lights it too.
        await act(async () => { fireEvent.pointerEnter(captionOf(c, "3126", "K-202")); });
        expect(card(c, "3126")!.hasAttribute("data-link-lit")).toBe(true);
    });

    test("A68 — a click selects a link and its bin; its caption carries a × that unlinks; Delete unlinks too", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationMinimal);
        await press(row(c, "K-202")!);
        await press(hitOf(c, "3123", "K-202"));
        expect(card(c, "3123")!.getAttribute("aria-pressed")).toBe("true");
        const caption = captionOf(c, "3123", "K-202");
        expect(caption.hasAttribute("data-selected")).toBe(true);
        expect(caption.getAttribute("aria-label")).toBe("Selected link of LD-2219, 22 m³");
        expect(caption.querySelector("title")!.textContent).toBe("Selected · × or Delete removes the link");
        const unlink = c.querySelector<HTMLButtonElement>("[data-allocation-links] [data-plan-ribbon-unlink] button")!;
        expect(unlink.getAttribute("aria-label")).toBe("Unlink LD-2219 · Delete");
        await press(unlink);
        expect(card(c, "3123")!.querySelector("[data-unlinked]")).not.toBeNull();
        await press(toolbar(c).getByRole("button", { name: editingMessages.undo() }));
        expect(card(c, "3123")!.querySelector("[data-allocation-to]")!.textContent).toBe("K-202");
        // Selected by its caption, Delete unlinks it.
        await press(row(c, "K-202")!);
        await press(captionOf(c, "3126", "K-202"));
        await key(c, "Delete");
        expect(card(c, "3126")!.querySelector("[data-unlinked]")).not.toBeNull();
        expect(card(c, "3123")!.querySelector("[data-allocation-to]")!.textContent).toBe("K-202");
    });

    test("A68 — a reservation's link has no caption: selected by its line, Delete unlinks it", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationMinimal);
        const plans = h.read(ex.kilnPlans);
        plans.get(TUE)!.bins.set("R1", { lane: "B-1", at: new Date(Date.UTC(2027, 4, 11, 0, 15)), event: none, quantity: 0, kind: none, hold: variant("days", 0),
            parts: new SortedMap([["K-202", 0]], compareFor(StringType)), values: { specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none } });
        await h.commit(ex.kilnPlans, plans);
        await press(row(c, "K-202")!);
        expect(links(c)).toHaveLength(3);
        expect(captionOf(c, "R1", "K-202")).toBeNull();
        expect(hitOf(c, "R1", "K-202").getAttribute("aria-label")).toBe("Link of the reservation");
        await press(hitOf(c, "R1", "K-202"));
        await key(c, "Delete");
        expect(card(c, "R1")!.querySelector("[data-unlinked]")).not.toBeNull();
    });

    test("A7 — another layout closes the selected link; the bin stays selected", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationMinimal);
        await press(row(c, "K-202")!);
        await press(hitOf(c, "3123", "K-202"));
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
        expect(card(c, "3123")!.getAttribute("aria-pressed")).toBe("true");
        expect(c.querySelector("[data-allocation-links] [data-plan-ribbon-label][data-selected]")).toBeNull();
    });
});
