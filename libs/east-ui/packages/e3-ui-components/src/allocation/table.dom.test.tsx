/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Table (#1329) over the kiln yard's records and the yard's fit served by
 * name: its four time bands, its rows and their cells, the chips' ×, every
 * cell's Chooser — each section the fit's answer — and what a choice does, a
 * chip's drag onto a free row, and that it is never narrowed. Every word and
 * figure is the mock's, as it draws the same yard.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore, editingMessages } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, mount, settle, slot, TUE } from "./harness.test-utils.js";
import { dayKey } from "./model.js";

const h = allocationHarness();
const at = (hh: number, mm: number) => new Date(Date.UTC(2027, 4, 11, hh, mm));
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
const binRow = (c: HTMLElement, id: string) => row(c, `bin:${id}`);
const freeRow = (c: HTMLElement, lane: string, when: Date) => row(c, `slot:${lane}|${dayKey(when)}`);
const cells = (el: HTMLElement) => [...el.children].map(cell => cell.textContent);
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function open(example: { fn: { toIR(): unknown } } = ex.allocationTable) { const r = mount(example); await settle(); return r.container; }
/** A cell's Chooser, opened: its sections and their options, as the popover lists them. */
async function choose(cell: HTMLElement) {
    const trigger = cell.querySelector<HTMLElement>("[aria-haspopup=listbox]")!;
    await press(trigger);
    return chooser();
}
function chooser() {
    const list = document.querySelector<HTMLElement>("[data-chooser]")!;
    return {
        list,
        sections: () => [...list.querySelectorAll("[role=group]")].map(g => [g.getAttribute("aria-label"),
            [...g.querySelectorAll("[role=option]")].map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent)]),
        option: (label: string) => [...list.querySelectorAll<HTMLElement>("[role=option]")].find(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent === label)!,
        line: (label: string) => chooser().option(label).querySelector("span:nth-child(2) > span:nth-child(2)")?.textContent,
    };
}
const eventCell = (r: HTMLElement) => r.querySelector<HTMLElement>("[data-allocation-cell-side=event]")!;
const resourceCell = (r: HTMLElement) => r.querySelector<HTMLElement>("[data-allocation-cell-side=resource]")!;
const status = (r: HTMLElement) => r.querySelector("[data-status]")!.getAttribute("data-status");

describe("the bands and the rows", () => {
    test("A41, A42 — four time bands of 20 rows, each its counts: `7 bins · 13 free · 208 m³`, `· collapsed` folded; the fold is kept", async () => {
        const first = mount(ex.allocationTable); await settle();
        const c = first.container;
        const bands = () => [...c.querySelectorAll<HTMLElement>("[data-allocation-band]")];
        // Folded, every band's head shows: what each holds, as the mock's.
        for (let i = 0; i < 4; i++) { const head = bands().find(b => b.getAttribute("aria-expanded") === "true")!; await press(head); }
        expect(bands().map(b => b.textContent)).toEqual([
            "00:00–06:00207 bins · 13 free · 208 m³ · collapsed", "06:00–12:00206 bins · 14 free · 114 m³ · collapsed",
            "12:00–18:00207 bins · 13 free · 94 m³ · collapsed", "18:00–24:00206 bins · 14 free · 140 m³ · collapsed",
        ]);
        expect(c.querySelectorAll("[data-allocation-row]")).toHaveLength(0);
        // The fold survives a remount.
        first.unmount();
        const again = await open();
        expect([...again.querySelectorAll("[data-allocation-band]")].map(b => b.getAttribute("aria-expanded"))).toEqual(["false", "false", "false", "false"]);
    });

    test("A41 — rows in time then lane order: a free slot's one, a batch's bin each", async () => {
        const c = await open();
        const keys = [...c.querySelectorAll("[data-allocation-row]")].slice(0, 8).map(r => r.getAttribute("data-allocation-row"));
        expect(keys).toEqual([`slot:B-1|${dayKey(at(0, 15))}`, `slot:B-2|${dayKey(at(0, 35))}`, `slot:B-3|${dayKey(at(0, 55))}`,
            `slot:B-1|${dayKey(at(1, 15))}`, `slot:B-2|${dayKey(at(1, 35))}`, "bin:3101", "bin:3102", "bin:3103"]);
    });

    test("A43 — the column heads; a bin's row: time, lane, its chip, quantity, the app's column, its resource, its load, Committed; a free row's placeholders", async () => {
        const c = await open();
        expect([...c.querySelector("[data-allocation-table-head]")!.children].map(e => e.textContent)).toEqual(["Time", "Lane", "Event", "Quantity", "Spec", "Resource", "Load", "Status"]);
        expect(cells(binRow(c, "3101"))).toEqual(["01:55", "B-3", "LD-2201BRK · R1 · spec MC14", "35 m³", "MC14", "K-209", "35 m³ · takes 20–40", "Committed"]);
        expect(binRow(c, "3101").querySelector("[data-holds]")).not.toBeNull();
        const free = freeRow(c, "B-1", at(0, 15));
        expect([eventCell(free).textContent, resourceCell(free).textContent, status(free)]).toEqual(["no eventdrop to move heredoesn’t fit", "no resourcedrop to move heredoesn’t fit", "Free"]);
        expect(eventCell(free).querySelector("[data-say=idle]")!.textContent).toBe("no event");
        expect(eventCell(free).querySelector("button")!.title).toBe("Choose an event, or drag one here from Events");
        expect(resourceCell(free).querySelector("button")!.title).toBe("Choose a resource, or drag one here from Resources");
        // The chips' words (A84).
        const chip = binRow(c, "3101").querySelector<HTMLElement>("[data-allocation-chip=event]")!;
        expect(chip.title).toBe("LD-2201 · BRK · R1 · spec MC14 · 35 m³ · drag onto an empty row to move it");
        expect(within(chip).getByRole("button", { name: "Replace LD-2201 with another event" })).not.toBeNull();
        expect(within(chip).getByRole("button", { name: "Remove LD-2201 from the plan · it moves to Events" })).not.toBeNull();
        const resource = binRow(c, "3101").querySelector<HTMLElement>("[data-allocation-chip=resource]")!;
        expect(resource.title).toBe("K-209 · Hall B · 40 m³");
        expect(within(resource).getByRole("button", { name: "Unlink LD-2201 from K-209" })).not.toBeNull();
        expect(binRow(c, "3101").querySelector<HTMLElement>("[data-allocation-row] > span:nth-last-child(2)")!.title).toBe("K-209 · 35 m³ · takes 20–40");
    });

    test("A43 — the statuses: Not linked, Check (its resource overlapping or over max), Draft", async () => {
        const c = await open();
        const plans = h.read(ex.kilnPlans);
        // LD-2201 50 m³ puts K-209 over its 40 m³ max.
        plans.get(TUE)!.bins.get("3101")!.quantity = 50;
        plans.get(TUE)!.bins.get("3101")!.parts.set("K-209", 50);
        plans.get(TUE)!.bins.get("3102")!.parts.clear();
        await h.commit(ex.kilnPlans, plans);
        expect(status(binRow(c, "3101"))).toBe("Check");
        expect(binRow(c, "3101").querySelector("[data-mark=over]")).not.toBeNull();
        expect(status(binRow(c, "3102"))).toBe("Not linked");
        expect(resourceCell(binRow(c, "3102")).textContent).toContain("no resource");
        await press(within(binRow(c, "3103")).getByRole("button", { name: "Unlink LD-2203 from K-109" }));
        expect(status(binRow(c, "3103"))).toBe("Not linked");
        await press(within(binRow(c, "3104")).getByRole("button", { name: "Remove LD-2204 from the plan · it moves to Events" }));
        await press(toolbar(c).getByRole("button", { name: editingMessages.undo() }));
        expect(status(binRow(c, "3104"))).toBe("Committed");
        // A draft that leaves its resource well: Draft.
        await choose(resourceCell(binRow(c, "3104")));
        await settle();
        const gaps = chooser().sections().find(s => s[0] === "Gaps that fit")?.[1] as string[] | undefined;
        expect(gaps?.length).toBeGreaterThan(0);
        await press(chooser().option(gaps![0]!));
        expect(status(binRow(c, "3104"))).toBe("Draft");
    });

    test("A44 — a click selects its row; a selected resource marks every row of its bins", async () => {
        const c = await open(ex.allocationKilnYard);
        await press(c.querySelector('[data-allocation-resource="K-209"]')!);
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        expect(binRow(c, "3101").hasAttribute("data-selected")).toBe(true);
        expect(binRow(c, "3102").hasAttribute("data-selected")).toBe(false);
        await press(freeRow(c, "B-2", at(0, 35)));
        expect(freeRow(c, "B-2", at(0, 35)).hasAttribute("data-selected")).toBe(true);
        expect(binRow(c, "3101").hasAttribute("data-selected")).toBe(false);
    });

    test("A12 — the Table shows the selection: a bin selected on the Timeline scrolls its row into view, a third from the top", async () => {
        const c = await open(ex.allocationMinimal);
        await press(c.querySelector('[data-allocation-card="3125"]')!);
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        const pane = c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
        // LD-2220 is B-2's 22:35 bin: the 72nd line under its band heads, far below the first view.
        expect(pane.scrollTop).toBeGreaterThan(36 * 40);
        expect(pane.scrollTop % 36).toBe(0);
    });

    test("A41 — the Table is never narrowed: a kiln group's narrowing leaves every row", async () => {
        const store = new UIStore(); StateRuntime.initializeStore(store);
        const c = await open(ex.allocationKilnYard);
        await waitFor(() => expect(c.querySelector("[data-allocation-resource]")).not.toBeNull());
        const key = "ex.allocationKilnYard.kilns";
        const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
        await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map([["group", variant("values", [printFor(StringType)("Hall A")])]]), preset: none })); });
        await waitFor(() => expect(c.querySelector('[data-allocation-resource="K-209"]')).toBeNull());
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        // LD-2201 is on K-209, in Hall B, which the narrowing hides from the Timeline.
        expect(binRow(c, "3101")).not.toBeNull();
    });
});

describe("the chips' ×", () => {
    test("A46 — an event chip's × returns the event to Events; a resource chip's unlinks; on a reservation it removes it", async () => {
        const c = await open();
        await press(within(binRow(c, "3101")).getByRole("button", { name: "Remove LD-2201 from the plan · it moves to Events" }));
        expect(binRow(c, "3101")).toBeNull();
        expect(binRow(c, "3102")).not.toBeNull();
        await press(within(binRow(c, "3102")).getByRole("button", { name: "Unlink LD-2202 from K-102" }));
        expect(status(binRow(c, "3102"))).toBe("Not linked");
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        const saved = h.read(ex.kilnPlans).get(TUE)!;
        expect([saved.bins.has("3101"), saved.bins.get("3102")!.parts.size]).toEqual([false, 0]);
    });
});

describe("the Chooser on a cell (A48, A49)", () => {
    test("A48 — a bin's resource cell: Current, the gaps that fit best first, those that don't, the fit's answer; a choice re-links it", async () => {
        const c = await open();
        const list = await choose(resourceCell(binRow(c, "3101")));
        const sections = list.sections();
        expect(sections[0]).toEqual(["Current", ["K-209"]]);
        expect(sections[1]).toEqual(["Gaps that fit", ["K-601"]]);
        expect(sections[2]![0]).toBe("Doesn’t fit");
        expect(sections[2]![1]).toHaveLength(31);
        expect(list.line("K-601")!.startsWith("open gap · leaves 35 m³ · min 40 · 5 short")).toBe(true);
        expect(list.line("K-101")).toBe("over max by 34 m³");
        expect(list.option("K-101").getAttribute("aria-disabled")).toBe("true");
        await press(list.option("K-601"));
        expect(cells(binRow(c, "3101"))[5]).toBe("K-601");
        expect(binRow(c, "3101").querySelector("[data-allocation-chip=resource]")!.hasAttribute("data-draft")).toBe(true);
    });

    test("A48 — a free row's event cell: `Book here` with the six loads still to book, then the events already on the board; a choice books it there", async () => {
        const c = await open();
        const list = await choose(eventCell(freeRow(c, "B-1", at(0, 15))));
        const [book, allocated] = list.sections();
        expect(book).toEqual(["Book here", ["LD-2231", "LD-2232", "LD-2233", "LD-2234", "LD-2235", "LD-2236"]]);
        expect(list.line("LD-2231")).toBe("BRK · R2 · spec MC12 · overdue");
        expect(list.option("LD-2231").hasAttribute("data-warn")).toBe(true);
        expect(allocated![0]).toBe("Allocated");
        expect(list.line("LD-2206")).toBe("in B-2 05:35 on K-304 · +1 more");
        expect(list.option("LD-2206").getAttribute("aria-disabled")).toBe("true");
        // No resource, no question: the free row's events are not the fit's to judge.
        expect(h.fits.calls.get("yard_fit") ?? 0).toBe(0);
        await press(list.option("LD-2231"));
        const booked = c.querySelector<HTMLElement>('[data-allocation-row="bin:N1"]')!;
        expect(cells(booked).slice(0, 4)).toEqual(["00:15", "B-1", "LD-2231BRK · R2 · spec MC12", "21 m³"]);
        expect(status(booked)).toBe("Not linked");
    });

    test("A48 — a bin's event cell asks the fit what its resource takes without it: Current, the fits on K-209, those that don't; a choice replaces it", async () => {
        const c = await open();
        await choose(eventCell(binRow(c, "3101")));
        await settle();
        const sections = chooser().sections();
        expect(sections[0]).toEqual(["Current", ["LD-2201"]]);
        type Take = { ask: { type: string }; events: Map<string, { type: string }> };
        const take = (h.fits.history as Take[]).find(a => a.ask.type === "take")!;
        // The six loads still to book (LD-2201's own bin is the row's: Current), each as the fit judged it on K-209.
        const judged = [...take.events].filter(([k]) => k !== "LD-2201");
        const fits = judged.filter(([, f]) => f.type === "fits").map(([k]) => k);
        expect(sections.find(s => s[0] === "Fits K-209")?.[1] ?? []).toEqual(fits);
        expect(sections.find(s => s[0] === "Doesn’t fit K-209")?.[1] ?? []).toEqual(judged.filter(([, f]) => f.type === "refused").map(([k]) => k));
        // K-209 takes some of the loads and refuses others: both sections stand.
        expect([fits.length > 0, judged.length > fits.length]).toEqual([true, true]);
        await press(chooser().option(fits[0]!));
        expect(binRow(c, "3101")).toBeNull();
        const into = c.querySelector<HTMLElement>('[data-allocation-row="bin:N1"]')!;
        expect([cells(into)[0], cells(into)[5]]).toEqual(["01:55", "K-209"]);
    });

    test("A48, A49 — a free row's resource cell: what can be reserved there, the fit's; a choice reserves it, and its event cell then books into it", async () => {
        const c = await open();
        await choose(resourceCell(freeRow(c, "B-1", at(0, 15))));
        await settle();
        const sections = chooser().sections();
        expect(sections[0]![0]).toBe("Can be reserved");
        expect(sections[0]![1]).toContain("K-601");
        await press(chooser().option("K-601"));
        const reserved = c.querySelector<HTMLElement>('[data-allocation-row="bin:V1"]')!;
        expect([eventCell(reserved).querySelector("[data-say=idle]")!.textContent, cells(reserved)[3], status(reserved)]).toEqual(["no event · reserved", "K-601", "Draft"]);
        expect(within(reserved).getByRole("button", { name: "Remove the reservation" })).not.toBeNull();
        // Its event cell books into the reservation, each event checked against K-601.
        await choose(eventCell(reserved));
        await settle();
        expect(chooser().sections()[0]![0]).toBe("Fits K-601");
        await press(chooser().option("LD-2232"));
        expect(c.querySelector('[data-allocation-row="bin:V1"]')).toBeNull();
        const filled = c.querySelector<HTMLElement>('[data-allocation-row="bin:N1"]')!;
        expect([cells(filled)[0], cells(filled)[2], cells(filled)[5]]).toEqual(["00:15", "LD-2232RDG · R1 · spec MC10", "K-601"]);
    });

    test("F2 — while the fit's answer is on its way the Chooser says `checking fits…`, its options not yet choosable", async () => {
        const c = await open();
        const release = h.fits.hold();
        const list = await choose(resourceCell(binRow(c, "3101")));
        expect(list.sections()[1]![0]).toBe("Gaps that fit");
        expect(list.line("K-601")).toBe("checking fits…");
        expect(list.option("K-601").getAttribute("aria-disabled")).toBe("true");
        await act(async () => { release(); }); await settle();
        expect(chooser().line("K-601")!.startsWith("open gap")).toBe(true);
    });
});

describe("a chip's drag (A47, A45)", () => {
    async function hover(from: Element, into: Element) {
        await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
        await settle();
        await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
        await settle();
    }
    async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); }); await settle(); }
    const caption = () => document.querySelector<HTMLElement>("[data-drag-caption]");

    test("A47 — an event chip dragged onto a free row's event cell moves its bin to that row's lane and time; onto a resource cell it is refused", async () => {
        const c = await open();
        const chip = binRow(c, "3103").querySelector("[data-allocation-chip=event]")!;
        await hover(chip, eventCell(freeRow(c, "B-2", at(0, 35))));
        expect(c.querySelector("[data-allocation-table]")!.getAttribute("data-allocation-drag")).toBe("body");
        expect(eventCell(freeRow(c, "B-2", at(0, 35))).hasAttribute("data-drop-active")).toBe(true);
        expect(caption()!.textContent).toBe("to B-2 00:35");
        await act(async () => { pointAt(resourceCell(freeRow(c, "B-1", at(0, 15)))); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 16, clientY: 12 }); }); await settle();
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["drop on the event cell", true]);
        await act(async () => { pointAt(eventCell(freeRow(c, "B-2", at(0, 35)))); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 18, clientY: 12 }); }); await settle();
        await release();
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        const moved = h.read(ex.kilnPlans).get(TUE)!.bins.get("3103")!;
        expect([moved.lane, moved.at, [...moved.parts]]).toEqual(["B-2", at(0, 35), [["K-109", 24]]]);
    });
});
