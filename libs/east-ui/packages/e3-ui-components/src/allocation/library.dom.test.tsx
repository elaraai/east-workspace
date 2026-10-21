/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Library (#1330) over the kiln yard, through the dispatcher, the shared
 * drag layer and the yard's fit served by name: its tabs and their counts and
 * searches (A50), the Arrivals groups and cards (A51), the Resources by the
 * day's states (A52), the foot's hint and the picked card's action (A53, A87),
 * the rail and the empty search (A54), the cards' words (A83), the picks (A9–
 * A11) and every Library row of §10's drag table, with A32's marks and A36's
 * landing slot, and what a Library card's drag draws over the board: the
 * lines to an arrival's best fits (A30) and the target's links (A65). Every word
 * and figure is the mock's for the same day.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { FloatType, SortedMap, StringType, compareFor, none, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, offering, settle, slot, stubLinkGeometry, type FitResult } from "./harness.test-utils.js";

const h = allocationHarness();
const byScore = compareFor(FloatType);
type Tab = "arrivals" | "resources";
const SEARCH = { arrivals: "Find an arrival or site", resources: "Find a resource or group" } as const;
const pane = (c: HTMLElement, tab: Tab) => c.querySelector<HTMLElement>(`[data-allocation-library="${tab}"]`)!;
const card = (c: HTMLElement, tab: Tab, key: string) => pane(c, tab).querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;
const heads = (c: HTMLElement, tab: Tab) => [...pane(c, tab).querySelectorAll("[data-library-head]")].map(head => head.textContent);
const keys = (c: HTMLElement, tab: Tab) => [...pane(c, tab).querySelectorAll("[data-library-item]")].map(el => el.getAttribute("data-library-item"));
const note = (el: HTMLElement) => [el.querySelector("[data-library-note]")!.textContent, el.querySelector("[data-library-note]")!.getAttribute("data-tone")];
const figure = (el: HTMLElement) => el.querySelector("[data-library-figure]")!.textContent;
const sub = (el: HTMLElement) => el.querySelector("[data-library-figure]")!.parentElement!.nextElementSibling!.textContent;
const hint = (c: HTMLElement, tab: Tab) => pane(c, tab).querySelector("[data-allocation-library-hint]")!.textContent;
const action = (c: HTMLElement, tab: Tab) => pane(c, tab).querySelector<HTMLElement>("[data-allocation-library-action]");
const boardCard = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`)!;
const cell = (c: HTMLElement, lane: string, at: Date) => c.querySelector<HTMLElement>(`[data-allocation-cell="${lane}|${at.getTime()}"]`)!;
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`);
const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
const caption = () => document.querySelector<HTMLElement>("[data-drag-caption]");
const hour = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const undo = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.undo() });
const save = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.apply() });
async function press(node: Element) { expect(node).not.toBeNull(); await act(async () => { fireEvent.click(node); }); await settle(); }
async function open(example: { fn: { toIR(): unknown } }) { const r = await h.mount(example); return r.container; }
async function tab(c: HTMLElement, name: "Arrivals" | "Resources") {
    const tabs = within(slot(c, "start")).getAllByRole("tab");
    await press(tabs.find(t => t.textContent!.startsWith(name))!);
}
async function search(c: HTMLElement, t: Tab, text: string) {
    await act(async () => { fireEvent.change(within(pane(c, t)).getByRole("textbox", { name: SEARCH[t] }), { target: { value: text } }); });
    await settle();
}
/** The resource pane, scrolled until a row is mounted. */
async function reveal(c: HTMLElement, key: string) {
    const el = c.querySelector<HTMLElement>("[data-allocation-timeline] [data-virtual-rows]")!;
    for (let top = 0; row(c, key) === null && top <= 33 * 62; top += 6 * 36) { await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle(); }
    expect(row(c, key)).not.toBeNull();
    return row(c, key)!;
}
/** A row of the Table, its pane scrolled until it is mounted. */
async function revealRow(c: HTMLElement, key: string) {
    const el = c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
    for (let top = 0; c.querySelector(`[data-allocation-row="${key}"]`) === null && top <= 120 * 36; top += 10 * 36) { await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle(); }
    return tableRow(c, key);
}
/** A menu opened from the keyboard, and an item of it picked, as the shared Library's tests do in jsdom. */
async function pickFrom(trigger: HTMLElement, name: string) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
    const menu = within(document.body).getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
    await settle();
}
async function hover(from: Element, into: Element) {
    expect(from).not.toBeNull(); expect(into).not.toBeNull();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); }); await settle(); }
async function drop(from: Element, into: Element) { await hover(from, into); await release(); }
/** Moves the pointer carrying a drag — its button held, as a hand's is — to a point over a target: the window's px, the links' layer 48 under the board's top. */
async function moveTo(into: Element, x: number, y: number) {
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x, clientY: y }); });
    await settle();
}
/** Picks a card up with its button held and carries it to a point over a target. */
async function carry(from: Element, into: Element, x: number, y: number) {
    expect(from).not.toBeNull(); expect(into).not.toBeNull();
    await act(async () => {
        pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: x - 12, clientY: y });
        pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x - 6, clientY: y });
    });
    await settle();
    await moveTo(into, x, y);
}
/** The lines from the pointer into the best fits (A30): each one's band and head. */
const guides = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-link-lines] [data-plan-link-guide]")]
    .map(g => [g.querySelector("[data-plan-ribbon-band]")!.getAttribute("d"), g.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")]);
/** The links the layer draws: each one's bin and resource, its tone, and whether it is a `was` line. */
const drawn = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-links] [data-plan-link]")]
    .map(g => [g.querySelector("[data-link]")!.getAttribute("data-allocation-link"), g.getAttribute("data-tone"), g.hasAttribute("data-was")] as const);
/** The fit's answer to placing an arrival, and its three best. */
const answerFor = (arrival: string) => [...h.fits.answers()].reverse().find(a => {
    const ask = (a as FitResult).ask;
    return ask.type === "place" && ask.value.subject.type === "arrival" && ask.value.subject.value === arrival;
}) as FitResult;
const bestOf = (a: FitResult) => [...a.resources].flatMap(([k, f]) => f.type === "fits" ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).slice(0, 3).map(f => f.k);

describe("the tabs and their words (A50, A54)", () => {
    test("A50 — Arrivals and Resources, each with its count — every arrival the day shows, every resource — and its own search", async () => {
        const c = await open(ex.allocationKilnYard);
        expect(within(slot(c, "start")).getAllByRole("tab").map(t => t.textContent)).toEqual(["Arrivals 27", "Resources 33"]);
        expect(within(pane(c, "arrivals")).getByRole("textbox", { name: SEARCH.arrivals }).getAttribute("placeholder")).toBe(SEARCH.arrivals);
        await tab(c, "Resources");
        expect(within(pane(c, "resources")).getByRole("textbox", { name: SEARCH.resources }).getAttribute("placeholder")).toBe(SEARCH.resources);
    });

    test("A54 — collapsed, a rail: the open tab's count, the overdue mark, the label; Resources has no mark", async () => {
        const c = await open(ex.allocationKilnYard);
        await press(within(slot(c, "start")).getByRole("button", { name: "Collapse Library" }));
        const rail = slot(c, "start");
        expect(rail.querySelector("[data-dock-badge]")!.textContent).toBe("27");
        expect(rail.querySelector("[data-dock-mark]")!.getAttribute("aria-label")).toBe("Overdue arrival");
        expect(rail.querySelector("[data-dock-mark] svg[data-icon='triangle-exclamation']")).not.toBeNull();
        await press(within(rail).getByRole("button", { name: "Expand Library" }));
        await tab(c, "Resources");
        await press(within(slot(c, "start")).getByRole("button", { name: "Collapse Library" }));
        expect(slot(c, "start").querySelector("[data-dock-badge]")!.textContent).toBe("33");
        expect(slot(c, "start").querySelector("[data-dock-mark]")).toBeNull();
    });

    test("A54, A83 — a search that hides every card: `No arrivals match · Clear the search to see all 27 arrivals.`, and the resources' own", async () => {
        const c = await open(ex.allocationKilnYard);
        await search(c, "arrivals", "no such load");
        const empty = pane(c, "arrivals").querySelector("[data-library-empty]")!;
        expect(within(empty as HTMLElement).getByText("No arrivals match")).toBeTruthy();
        expect(within(empty as HTMLElement).getByText("Clear the search to see all 27 arrivals.")).toBeTruthy();
        await tab(c, "Resources");
        await search(c, "resources", "no such kiln");
        expect(within(pane(c, "resources").querySelector<HTMLElement>("[data-library-empty]")!).getByText("Clear the search to see all 33 resources.")).toBeTruthy();
        expect(within(pane(c, "resources").querySelector<HTMLElement>("[data-library-empty]")!).getByText("No resources match")).toBeTruthy();
    });
});

describe("the Arrivals (A51, A83)", () => {
    test("A51 — Overdue (warn, its triangle), Ready around now, then Allocated, each counted; a search finds a load by its meta", async () => {
        const c = await open(ex.allocationKilnYard);
        expect(heads(c, "arrivals")).toEqual(["Overdue1", "Ready around now5", "Allocated21"]);
        const overdue = pane(c, "arrivals").querySelector<HTMLElement>("[data-library-head]")!;
        expect([overdue.getAttribute("data-tone"), overdue.querySelector("[data-library-group-mark]")!.getAttribute("aria-label")]).toEqual(["warning", "Overdue"]);
        expect(keys(c, "arrivals").slice(0, 7)).toEqual(["arrival:LD-2231", "arrival:LD-2232", "arrival:LD-2233", "arrival:LD-2234", "arrival:LD-2235", "arrival:LD-2236", "arrival:LD-2201"]);
        await search(c, "arrivals", "RDG");
        expect(keys(c, "arrivals")).toEqual(["arrival:LD-2232", "arrival:LD-2233", "arrival:LD-2208", "arrival:LD-2212", "arrival:LD-2215", "arrival:LD-2220"]);
    });

    test("A51 — a card: grip, code, quantity, its meta and hold, its ready line (`was due Sun 9 · overdue` in warn; `due Wed 12 · window Tue–Fri`)", async () => {
        const c = await open(ex.allocationKilnYard);
        const late = card(c, "arrivals", "arrival:LD-2231");
        expect([late.querySelector("[data-drag-grip]") !== null, figure(late), sub(late), ...note(late)]).toEqual([true, "21 m³", "BRK · R2 · spec MC12 · 8 d", "was due Sun 9 · overdue", "warning"]);
        expect(note(card(c, "arrivals", "arrival:LD-2233"))).toEqual(["due Wed 12 · window Tue–Fri", null]);
        expect(note(card(c, "arrivals", "arrival:LD-2236"))).toEqual(["due Thu 13 · window Wed–Sat", null]);
    });

    test("A51, A83 — Allocated: the day's arrivals where they are, `in B-3 01:55 on K-209`, `2 bins · …`; sunken, no grip; `In the plan · click to highlight its 2 bins`", async () => {
        const c = await open(ex.allocationKilnYard);
        const one = card(c, "arrivals", "arrival:LD-2201");
        expect([figure(one), sub(one), ...note(one), one.getAttribute("data-look"), one.querySelector("[data-drag-grip]"), one.title])
            .toEqual(["35 m³", "BRK · R1 · spec MC14 · 7 d", "in B-3 01:55 on K-209", null, "sunken", null, "In the plan · click to highlight its bin"]);
        await search(c, "arrivals", "LD-2206");
        const two = card(c, "arrivals", "arrival:LD-2206");
        expect([figure(two), note(two)[0], two.title]).toEqual(["36 m³", "2 bins · B-2 05:35 on K-304 · B-2 05:36 on K-201", "In the plan · click to highlight its 2 bins"]);
    });

    test("A83 — an arrival's tooltip names where it drags, on the Timeline and in the Table", async () => {
        const timeline = await open(ex.allocationKilnYard);
        expect(card(timeline, "arrivals", "arrival:LD-2231").title).toBe("Click to see where LD-2231 fits · drag it onto a lane hour or a resource");
        const table = await open(ex.allocationTable);
        expect(card(table, "arrivals", "arrival:LD-2231").title).toBe("Click to see where LD-2231 fits · drag it onto a free row");
    });

    test("A51, A76 — a committed bin the drafts remove moves to Removed from plan, dashed, `was B-2 10:35 on K-108`; dragged back it books again with its own bin", async () => {
        const c = await open(ex.allocationKilnYard);
        await press(boardCard(c, "3113"));
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Delete" }); }); await settle();
        expect(heads(c, "arrivals")).toEqual(["Overdue1", "Ready around now5", "Removed from plan1", "Allocated20"]);
        const removed = card(c, "arrivals", "removed:3113");
        expect([removed.getAttribute("data-look"), figure(removed), sub(removed), note(removed)[0], removed.title]).toEqual([
            "dashed", "32 m³", "FRN · R2 · spec MC08 · 7 d", "was B-2 10:35 on K-108", "Click to see where it fits · drag LD-2210 back onto a lane hour or a resource"]);
        await hover(removed, cell(c, "B-1", hour(0, 15)));
        expect(caption()!.textContent).toBe("to B-1 00:15");
        await release();
        expect(boardCard(c, "3113").querySelector("[data-allocation-to]")!.textContent).toBe("not linked");
        expect(pane(c, "arrivals").querySelector("[data-library-item='removed:3113']")).toBeNull();
        await press(save(c));
        // Its own row back, its key and its yard's fields as they were.
        const back = (await h.read(ex.kilnBins)).get("3113")!;
        expect([back.bay, back.at, back.kilns.size, back.specMeasured]).toEqual(["B-1", hour(0, 15), 0, "MC22"]);
    });
});

describe("the Resources (A52, A83)", () => {
    test("A52 — grouped Free today · Loading today · Busy today, as the day's states; loading in its first bins' order", async () => {
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        expect(heads(c, "resources").slice(0, 2)).toEqual(["Free today10", "Loading today21"]);
        expect(keys(c, "resources").slice(0, 13)).toEqual(["K-103", "K-104", "K-107", "K-110", "K-204", "K-208", "K-305", "K-502", "K-601", "K-602", "K-209", "K-102", "K-109"]);
        await search(c, "resources", "Large");
        expect(heads(c, "resources")).toEqual(["Free today1", "Loading today1", "Busy today2"]);
        expect(keys(c, "resources")).toEqual(["K-502", "K-501", "K-503", "K-504"]);
    });

    test("A52 — a card: name, range, group, and its line; over max in danger, into its next job in warn; busy and free", async () => {
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        const free = card(c, "resources", "K-601");
        expect([figure(free), sub(free), ...note(free)]).toEqual(["40–60 m³", "Bulk · 60 m³", "free · no next job", null]);
        expect(note(card(c, "resources", "K-103"))).toEqual(["free · next job Tue 18", null]);
        expect(note(card(c, "resources", "K-209"))).toEqual(["35 m³ today · to Mon 17", null]);
        await search(c, "resources", "K-207");
        expect(note(card(c, "resources", "K-207"))).toEqual(["44 m³ today · to Wed 19 · 4 m³ over", "danger"]);
        await search(c, "resources", "K-105");
        expect(note(card(c, "resources", "K-105"))).toEqual(["32 m³ today · to Tue 18 · 2 d into next job", "warning"]);
        await search(c, "resources", "K-50");
        expect(note(card(c, "resources", "K-503"))).toEqual(["busy until Fri 14", null]);
        expect(note(card(c, "resources", "K-504"))).toEqual(["busy until Sat 15", null]);
    });

    test("A52 — the day's states are the tab's groups, and every filter is the rail's: the tab has its search and no Filter of its own (ruled 18 Oct)", async () => {
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        expect(within(pane(c, "resources")).queryByRole("button", { name: /^Filter/ })).toBeNull();
        expect(within(pane(c, "resources")).getByRole("textbox", { name: SEARCH.resources })).toBeTruthy();
        expect(within(pane(c, "arrivals")).queryByRole("button", { name: /^Filter/ })).toBeNull();
    });

    test("A83 — a resource's tooltip names where it drags, on the Timeline and in the Table", async () => {
        const timeline = await open(ex.allocationKilnYard);
        await tab(timeline, "Resources");
        await search(timeline, "resources", "K-203");
        expect(card(timeline, "resources", "K-203").title).toBe("Click to highlight its bins · drag K-203 onto a bin or an empty lane hour");
        const table = await open(ex.allocationTable);
        await tab(table, "Resources");
        await search(table, "resources", "K-203");
        expect(card(table, "resources", "K-203").title).toBe("Click to highlight its bins · drag K-203 onto a row’s resource cell");
    });
});

describe("the foot's hint and the picked card's action (A53, A87)", () => {
    test("A53 — the hint is the tab's and the layout's", async () => {
        const timeline = await open(ex.allocationKilnYard);
        expect(hint(timeline, "arrivals")).toBe("Drag onto a lane hour or a resource");
        expect(hint(timeline, "resources")).toBe("Drag onto a bin or an empty lane hour");
        const table = await open(ex.allocationTable);
        expect(hint(table, "arrivals")).toBe("Drag onto a row’s arrival cell");
        expect(hint(table, "resources")).toBe("Drag onto a row’s resource cell");
    });

    test("A53 — a picked arrival with nothing selected says where a click books it; A87 — the Table's words", async () => {
        const timeline = await open(ex.allocationKilnYard);
        expect(action(timeline, "arrivals")).toBeNull();
        await press(card(timeline, "arrivals", "arrival:LD-2235"));
        expect(action(timeline, "arrivals")!.textContent).toBe("Click a free lane hour or a ranked resource to book LD-2235 there, or select a free slot first.");
        expect(within(action(timeline, "arrivals")!).queryByRole("button")).toBeNull();
        const table = await open(ex.allocationTable);
        await press(card(table, "arrivals", "arrival:LD-2235"));
        expect(action(table, "arrivals")!.textContent).toBe("Click a highlighted arrival cell to book LD-2235 there, or select a free slot first.");
    });

    test("A53 — with a free slot selected: `Book into B-1 00:15`, `LD-2235 · 8 m³ · then choose its resource`; it books the arrival there, not linked", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span")!);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        const box = action(c, "arrivals")!;
        expect(box.firstElementChild!.textContent).toBe("LD-2235 · 8 m³ · then choose its resource");
        offering(["N1"]);
        await press(within(box).getByRole("button", { name: "Book into B-1 00:15" }));
        const booked = tableRow(c, "bin:N1");
        expect(booked.querySelector("[data-allocation-chip=arrival]")!.textContent).toContain("LD-2235");
        expect(booked.querySelector("[data-allocation-placeholder=resource]")).not.toBeNull();
        // A draft booking is Allocated, first, with its ×; the × returns it (A51).
        const allocated = card(c, "arrivals", "arrival:LD-2235");
        expect([allocated.title, ...note(allocated)]).toEqual(["Allocated · click to show its bin", "in B-1 00:15 · not linked", "warning"]);
        expect(keys(c, "arrivals").indexOf("arrival:LD-2235")).toBe(keys(c, "arrivals").indexOf("arrival:LD-2201") - 1);
        await press(within(allocated).getByRole("button", { name: "Return LD-2235 to the list" }));
        expect(c.querySelector("[data-allocation-row='bin:N1']")).toBeNull();
        expect(heads(c, "arrivals")).toEqual(["Overdue1", "Ready around now5", "Allocated21"]);
    });

    test("A53 — a resource picked for a free slot: `Reserve B-1 01:15 on K-305`; then a reservation selected: `Book into B-1 01:15`, checked against its resource", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T01:15:00.000").querySelector("span")!);
        await tab(c, "Resources");
        await press(card(c, "resources", "K-305"));
        expect(card(c, "resources", "K-305").hasAttribute("data-placed")).toBe(true);
        const reserve = action(c, "resources")!;
        offering(["V1"]);
        await press(within(reserve).getByRole("button", { name: "Reserve B-1 01:15 on K-305" }));
        const reserved = tableRow(c, "bin:V1");
        expect([reserved.getAttribute("data-kind"), reserved.querySelector("[data-allocation-chip=resource]")!.textContent]).toEqual(["reserved", "K-305"]);
        await tab(c, "Arrivals");
        // Too big for K-305: refused, in warn, the button off.
        await press(card(c, "arrivals", "arrival:LD-2232"));
        let box = action(c, "arrivals")!;
        expect([box.firstElementChild!.textContent, box.firstElementChild!.getAttribute("data-tone")]).toEqual(["Doesn’t fit K-305: over max by 20 m³", "warning"]);
        expect(within(box).getByRole("button", { name: "Book into B-1 01:15" })).toHaveProperty("disabled", true);
        // LD-2235 fits it: the fit's reason, and Book fills the reservation.
        await press(card(c, "arrivals", "arrival:LD-2235"));
        box = action(c, "arrivals")!;
        expect(box.firstElementChild!.textContent!.startsWith("Reserved on K-305 · ")).toBe(true);
        offering(["N1"]);
        await press(within(box).getByRole("button", { name: "Book into B-1 01:15" }));
        expect(c.querySelector("[data-allocation-row='bin:V1']")).toBeNull();
        expect(tableRow(c, "bin:N1").querySelector("[data-allocation-chip=resource]")!.textContent).toBe("K-305");
    });

    test("A53, F1 — a record the board reads, committed under it, asks the picked card's question again: its reason is of the kilns as they are", async () => {
        // The Timeline: no Table's rows ask a pick's questions of its reservations beside the foot.
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        // A reservation is a draft: the day as drafted is the session's, whatever the record under it does.
        await hover(card(c, "resources", "K-305"), cell(c, "B-1", hour(0, 15)));
        offering(["V1"]);
        await release();
        expect(boardCard(c, "V1").hasAttribute("data-selected")).toBe(true);
        await tab(c, "Arrivals");
        await press(card(c, "arrivals", "arrival:LD-2235"));
        const note = () => action(c, "arrivals")!.firstElementChild!.textContent;
        expect(note()).toContain("leaves 8 m³ · takes 4–10");
        // Another session raises K-305's minimum past LD-2235's 8 m³.
        const kilns = await h.read(ex.kilns);
        kilns.set("K-305", { ...kilns.get("K-305")!, min: 9 });
        await h.patch(ex.kilns, kilns);
        // Its question asked again: the reason is the fit's for the kilns as they are.
        const fit = answerFor("LD-2235").resources.get("K-305")!;
        expect(fit.type === "fits" ? fit.value.why : "").toContain("leaves 8 m³ · min 9 · 1 short");
        expect(note()).toBe(`Reserved on K-305 · ${fit.type === "fits" ? fit.value.why : ""}`);
    });
});

describe("picks (A9–A11)", () => {
    test("A9 — a click on an arrival card picks it, again unpicks it; a resource card with no free slot selected selects the resource, again unselects it", async () => {
        const c = await open(ex.allocationKilnYard);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        expect(card(c, "arrivals", "arrival:LD-2235").hasAttribute("data-placed")).toBe(true);
        expect(c.querySelector("[data-allocation-timeline]")!.hasAttribute("data-allocation-pick")).toBe(true);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        expect(card(c, "arrivals", "arrival:LD-2235").hasAttribute("data-placed")).toBe(false);
        expect(c.querySelector("[data-allocation-timeline]")!.hasAttribute("data-allocation-pick")).toBe(false);
        await tab(c, "Resources");
        await press(card(c, "resources", "K-209"));
        expect([row(c, "K-209")!.hasAttribute("data-selected"), card(c, "resources", "K-209").hasAttribute("data-placed")]).toEqual([true, true]);
        await press(card(c, "resources", "K-209"));
        expect(row(c, "K-209")!.hasAttribute("data-selected")).toBe(false);
    });

    test("A9 — in the Table a selected free slot stays selected when an arrival is picked; Esc clears the pick, then the selection", async () => {
        const c = await open(ex.allocationTable);
        const slotRow = () => tableRow(c, "slot:B-1|2027-05-11T00:15:00.000");
        await press(slotRow().querySelector("span")!);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        expect([slotRow().hasAttribute("data-selected"), card(c, "arrivals", "arrival:LD-2235").hasAttribute("data-placed")]).toEqual([true, true]);
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Escape" }); }); await settle();
        expect([slotRow().hasAttribute("data-selected"), card(c, "arrivals", "arrival:LD-2235").hasAttribute("data-placed")]).toEqual([true, false]);
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Escape" }); }); await settle();
        expect(slotRow().hasAttribute("data-selected")).toBe(false);
    });

    test("A10 — an Allocated card selects its arrival's first bin and highlights every bin of it; again, it clears", async () => {
        const c = await open(ex.allocationKilnYard);
        await search(c, "arrivals", "LD-2206");
        await press(card(c, "arrivals", "arrival:LD-2206"));
        expect([boardCard(c, "3106").hasAttribute("data-selected"), boardCard(c, "3107").hasAttribute("data-selected"), boardCard(c, "3101").hasAttribute("data-selected")]).toEqual([true, true, false]);
        expect(card(c, "arrivals", "arrival:LD-2206").hasAttribute("data-placed")).toBe(true);
        await press(card(c, "arrivals", "arrival:LD-2206"));
        expect([boardCard(c, "3106").hasAttribute("data-selected"), boardCard(c, "3107").hasAttribute("data-selected")]).toEqual([false, false]);
        // In the Table every row of it is marked.
        const t = await open(ex.allocationTable);
        await search(t, "arrivals", "LD-2207");
        await press(card(t, "arrivals", "arrival:LD-2207"));
        expect([(await revealRow(t, "bin:3108")).hasAttribute("data-selected"), (await revealRow(t, "bin:3109")).hasAttribute("data-selected")]).toEqual([true, true]);
    });

    test("A11 — a picked arrival ranks the resources as its drag would, and a click on a ranked resource books it there, at the day's first free slot (A36)", async () => {
        const c = await open(ex.allocationKilnYard);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        const best = bestOf(answerFor("LD-2235"));
        expect(best.length).toBeGreaterThan(0);
        const first = await reveal(c, best[0]!);
        expect(first.querySelector("[data-allocation-rank]")!.textContent).toBe("1");
        offering(["N1"]);
        await press(first);
        const booked = boardCard(c, "N1");
        expect([booked.querySelector("[data-allocation-code]")!.textContent, booked.querySelector("[data-allocation-to]")!.textContent]).toEqual(["LD-2235", best[0]]);
        expect(cell(c, "B-1", hour(0, 15)).hasAttribute("data-free")).toBe(false);
    });

    test("A11 — a picked arrival marks the free lane hours, and a click on one books it there, not linked; a click on an occupied hour clears", async () => {
        const c = await open(ex.allocationKilnYard);
        await press(card(c, "arrivals", "arrival:LD-2236"));
        expect(cell(c, "B-2", hour(0, 35)).querySelector("[data-allocation-placeholder]")).not.toBeNull();
        offering(["N1"]);
        await press(cell(c, "B-2", hour(0, 35)));
        expect([boardCard(c, "N1").querySelector("[data-allocation-code]")!.textContent, boardCard(c, "N1").querySelector("[data-allocation-to]")!.textContent]).toEqual(["LD-2236", "not linked"]);
        expect(c.querySelector("[data-allocation-timeline]")!.hasAttribute("data-allocation-pick")).toBe(false);
    });

    test("A11, A45 — in the Table a picked arrival's free rows read `click to book LD-2235 here`; a click books it; a row's time selects and books nothing", async () => {
        const c = await open(ex.allocationTable);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        const placeholder = () => tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector<HTMLElement>("[data-allocation-placeholder=arrival]")!;
        expect([placeholder().getAttribute("data-verdict"), placeholder().querySelector("[data-say=pick]")!.textContent]).toEqual(["pick", "click to book LD-2235 here"]);
        await press(tableRow(c, "slot:B-2|2027-05-11T00:35:00.000").querySelector("span")!);
        expect(undo(c)).toHaveProperty("disabled", true);
        await press(card(c, "arrivals", "arrival:LD-2235"));
        offering(["N1"]);
        await press(placeholder());
        expect(tableRow(c, "bin:N1").querySelector("[data-allocation-chip=arrival]")!.textContent).toContain("LD-2235");
    });
});

describe("Library drags (§10, A32, A33, A36)", () => {
    test("§10, A33, A36 — an arrival onto a resource books it there at the day's first free slot: `to K-… · #1 · B-1 00:15`", async () => {
        const c = await open(ex.allocationKilnYard);
        // Picked and unpicked: the fit's answer for it, to read the expected rank from.
        await press(card(c, "arrivals", "arrival:LD-2235"));
        await press(card(c, "arrivals", "arrival:LD-2235"));
        const best = bestOf(answerFor("LD-2235"))[0]!;
        const fit = answerFor("LD-2235").resources.get(best)!;
        const warn = fit.type === "fits" && fit.value.warn.type === "some" ? ` · ${fit.value.warn.value}` : "";
        const target = await reveal(c, best);
        await hover(card(c, "arrivals", "arrival:LD-2235"), target);
        expect(caption()!.textContent).toBe(`to ${best} · #1${warn} · B-1 00:15`);
        offering(["N1"]);
        await release();
        expect(boardCard(c, "N1").querySelector("[data-allocation-to]")!.textContent).toBe(best);
        await press(save(c));
        const saved = (await h.read(ex.kilnBins)).get("N1")!;
        expect([saved.bay, saved.at, [...saved.kilns]]).toEqual(["B-1", hour(0, 15), [[best, 8]]]);
    });

    test("A36 — with no free slot left in the day, a drop onto a resource books nothing, under `Not booked · No free bin is left on Tue 11 for LD-2235.`", async () => {
        const c = await open(ex.allocationKilnYard);
        // Every free slot of the day reserved, on no resource: no slot is free.
        const bins = await h.read(ex.kilnBins);
        const held = [...bins.values()];
        const offsets = { "B-1": 15, "B-2": 35, "B-3": 55 } as const;
        for (const [lane, offset] of Object.entries(offsets)) {
            for (let n = 0; n < 24; n++) {
                const at = hour(n, offset);
                const taken = held.some(bin => bin.bay === lane && bin.at.getTime() >= at.getTime() - 600_000 && bin.at.getTime() < at.getTime() + 3_000_000);
                if (!taken) bins.set(`R${lane}${n}`, { bay: lane, at, load: none, m3: 0, spec: none, dryFor: variant("days", 0), kilns: new SortedMap([], compareFor(StringType)),
                    specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none });
            }
        }
        await h.patch(ex.kilnBins, bins);
        expect(c.querySelector("[data-allocation-cell][data-free]")).toBeNull();
        const target = await reveal(c, "K-305");
        await hover(card(c, "arrivals", "arrival:LD-2235"), target);
        expect(caption()!.textContent).toBe("to K-305 · #1");
        offering(["N1"]);
        await release();
        expect(c.querySelector("[data-allocation-card='N1']")).toBeNull();
        const banner = within(slot(c, "banners"));
        expect(banner.getByText("Not booked")).toBeTruthy();
        expect(banner.getByText("No free bin is left on Tue 11 for LD-2235.")).toBeTruthy();
        expect(undo(c)).toHaveProperty("disabled", true);
    });

    test("§10 — an arrival onto a lane hour books it there; onto a Table resource cell it is refused `drop on the arrival cell`", async () => {
        const c = await open(ex.allocationKilnYard);
        await hover(card(c, "arrivals", "arrival:LD-2236"), cell(c, "B-3", hour(0, 55)));
        expect(caption()!.textContent).toBe("to B-3 00:55");
        offering(["N1"]);
        await release();
        expect(boardCard(c, "N1").querySelector("[data-allocation-to]")!.textContent).toBe("not linked");
        const t = await open(ex.allocationTable);
        await hover(card(t, "arrivals", "arrival:LD-2236"), tableRow(t, "bin:3101").querySelector("[data-allocation-cell-side=resource]")!);
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["drop on the arrival cell", true]);
        await release();
        expect(undo(t)).toHaveProperty("disabled", true);
    });

    test("§10, A33, A38 — a resource onto a free lane hour reserves it; an arrival into the reservation fills it, or is refused by the fit", async () => {
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        await hover(card(c, "resources", "K-305"), cell(c, "B-1", hour(0, 15)));
        expect(caption()!.textContent).toBe("reserve B-1 00:15");
        offering(["V1"]);
        await release();
        expect(boardCard(c, "V1").hasAttribute("data-reserved")).toBe(true);
        await tab(c, "Arrivals");
        await hover(card(c, "arrivals", "arrival:LD-2232"), boardCard(c, "V1"));
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["over max by 20 m³", true]);
        offering(["N1"]);
        await release();
        expect(c.querySelector("[data-allocation-card='N1']")).toBeNull();
        await hover(card(c, "arrivals", "arrival:LD-2235"), boardCard(c, "V1"));
        expect(caption()!.textContent).toBe("into the reservation on K-305");
        offering(["N1"]);
        await release();
        expect(c.querySelector("[data-allocation-card='V1']")).toBeNull();
        expect(boardCard(c, "N1").querySelector("[data-allocation-to]")!.textContent).toBe("K-305");
    });

    test("§10, A33 — a resource onto a bin links it (`link LD-2201`); onto the bin's own resource, `already on it`", async () => {
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        await hover(card(c, "resources", "K-209"), boardCard(c, "3101"));
        expect(caption()!.textContent).toBe("already on it");
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
        await hover(card(c, "resources", "K-601"), boardCard(c, "3101"));
        expect(caption()!.textContent).toBe("link LD-2201");
        await release();
        expect(boardCard(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-601");
    });

    test("A32 — a resource's drag: the bins that refuse it outline warn, and the lane hours of one that takes no reservation warn — the fit's reason; dropped there, nothing", async () => {
        const c = await open(ex.allocationKilnYard);
        await tab(c, "Resources");
        await search(c, "resources", "K-207");
        await hover(card(c, "resources", "K-207"), cell(c, "B-1", hour(0, 15)));
        expect(c.querySelector("[data-allocation-timeline]")!.getAttribute("data-reserve")).toBe("refused");
        // K-207 is over its max already: the fit refuses it another reservation `over max by 4 m³`, as the mock's does.
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["over max by 4 m³", true]);
        expect(boardCard(c, "3101").hasAttribute("data-refuses")).toBe(true);
        expect(boardCard(c, "3109").hasAttribute("data-refuses")).toBe(false);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
        expect(c.querySelectorAll("[data-refuses]")).toHaveLength(0);
    });

    test("A32, A45 — in the Table a resource's drag says on each resource cell what a drop does: `drop to reserve`, or `doesn’t fit` with its reason", async () => {
        const c = await open(ex.allocationTable);
        await tab(c, "Resources");
        await search(c, "resources", "K-207");
        const free = () => tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector<HTMLElement>("[data-allocation-placeholder=resource]")!;
        await hover(card(c, "resources", "K-207"), free());
        expect([free().getAttribute("data-verdict"), free().title]).toEqual(["refused", "over max by 4 m³"]);
        expect(tableRow(c, "bin:3101").querySelector("[data-allocation-chip=resource]")!.getAttribute("data-verdict")).toBe("refused");
        // The bin already on K-207 says nothing: a drop there does nothing.
        expect((await revealRow(c, "bin:3109")).querySelector("[data-allocation-chip=resource]")!.hasAttribute("data-verdict")).toBe(false);
        await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle();
        const pane = c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
        await act(async () => { pane.scrollTop = 0; fireEvent.scroll(pane); }); await settle();
        await search(c, "resources", "K-305");
        await hover(card(c, "resources", "K-305"), free());
        expect([free().getAttribute("data-verdict"), free().querySelector("[data-say=drop]")!.textContent, caption()!.textContent]).toEqual(["fits", "drop to reserve", "reserve B-1 00:15"]);
        offering(["V1"]);
        await release();
        expect(tableRow(c, "bin:V1").getAttribute("data-kind")).toBe("reserved");
    });
});

describe("what a Library card's drag draws over the board (A30, A65)", () => {
    test("A30 — while an arrival is dragged over the lane grid, a thin line runs from the pointer into each of its three best fits' rows; over the rows, none", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationKilnYard);
        // Picked and unpicked: the fit's answer for LD-2236, and its three best — the mock's three, in the yard's fit's order.
        await press(card(c, "arrivals", "arrival:LD-2236")); await press(card(c, "arrivals", "arrival:LD-2236"));
        const best = bestOf(answerFor("LD-2236"));
        expect([best.length, best]).toEqual([3, expect.arrayContaining(["K-103", "K-107", "K-601"])]);
        // The pointer at (36, 353) in the layer, as the mock measures LD-2236's: a line into each, best first.
        await carry(card(c, "arrivals", "arrival:LD-2236"), cell(c, "B-1", hour(4, 15)), 36, 401);
        const into: Record<string, string[]> = {
            // K-107, the seventh row, and K-103, the third: out of the drag point, through the riser, into each row's leading edge.
            "K-107": ["M 36.0 353.0 L 360.0 353.0 A 8.0 8.0 0 0 0 368.0 345.0 L 368.0 242.0 A 8.0 8.0 0 0 1 376.0 234.0 L 387.0 234.0", "M 387.0 230.0 L 395.0 234.0 L 387.0 238.0 Z"],
            "K-103": ["M 36.0 353.0 L 360.0 353.0 A 8.0 8.0 0 0 0 368.0 345.0 L 368.0 98.0 A 8.0 8.0 0 0 1 376.0 90.0 L 387.0 90.0", "M 387.0 86.0 L 395.0 90.0 L 387.0 94.0 Z"],
            // K-601, below the rows' view: Plan's stub down the riser, toward it.
            "K-601": ["M 36.0 353.0 L 360.0 353.0 A 8.0 8.0 0 0 1 368.0 361.0 L 368.0 644.0", "M 364.0 644.0 L 368.0 652.0 L 372.0 644.0 Z"],
        };
        expect(guides(c)).toEqual(best.map(key => into[key]));
        // They follow the pointer across the grid, and go 12 short of the riser.
        await moveTo(cell(c, "B-3", hour(4, 55)), 355, 401);
        expect(guides(c).map(([band]) => band!.slice(0, 13))).toEqual(["M 355.0 353.0", "M 355.0 353.0", "M 355.0 353.0"]);
        await moveTo(cell(c, "B-3", hour(4, 55)), 356, 401);
        expect(guides(c)).toEqual([]);
        await moveTo(row(c, "K-106")!, 695, 246);
        expect(guides(c)).toEqual([]);
        await release();
        expect(c.querySelector("[data-allocation-link-lines]")).toBeNull();
    });

    test("A65 — a Library card's drag has no family of its own: over a row, that row's links in the drop's verdict — an arrival's refusal, and a resource card's, warn", async () => {
        stubLinkGeometry();
        const c = await open(ex.allocationKilnYard);
        await carry(card(c, "arrivals", "arrival:LD-2236"), cell(c, "B-1", hour(4, 15)), 36, 401);
        expect(c.querySelector("[data-allocation-links]")).toBeNull();
        // K-106 refuses LD-2236, `over max by 7 m³`, as the mock's drag of it does: its link warn.
        await moveTo(row(c, "K-106")!, 695, 246);
        expect(caption()!.textContent).toBe("over max by 7 m³");
        expect(drawn(c).map(([link, tone, was]) => [link!.split("|")[1], tone, was])).toEqual([["K-106", "refused", false]]);
        await release();
        // A resource card onto a resource row is no drop: that row's links warn.
        await tab(c, "Resources");
        await carry(card(c, "resources", "K-305"), row(c, "K-106")!, 695, 246);
        expect(drawn(c).map(([link, tone]) => [link!.split("|")[1], tone])).toEqual([["K-106", "refused"]]);
        expect(guides(c)).toEqual([]);
        await release();
        expect(c.querySelector("[data-allocation-links]")).toBeNull();
    });
});
