/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Inspector (#1331) over the kiln yard, through the dispatcher, the shared
 * drag layer and the yard's fit served by name: its tabs (A55), a bin (A56–
 * A59), a free slot (A60), a reservation (A61), a resource (A62), the summary
 * (A63, A89), the Issues tab (A64), the drop list (A34, A86), the refusal's
 * note (A40), the connector's Chooser (A8, A21), the words and the marks (A85,
 * A90), the app's bin form, a published day and pointer motion (A35). Every
 * word and figure the mock draws for the same day is the mock's; every fit is
 * the yard's answer.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatType, SortedMap, StringType, compareFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, mount, settle, slot, TUE } from "./harness.test-utils.js";
import { allocationWords } from "./model.js";
import { RESERVE_PROBE } from "./table.js";

const h = allocationHarness();
type FitResult = ValueTypeOf<typeof AllocationFitResultType>;
const byScore = compareFor(FloatType), byKey = compareFor(StringType);
const pane = (c: HTMLElement) => slot(c, "end");
const details = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[data-allocation-inspector="details"]')!;
const issuesTab = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[data-allocation-inspector="issues"]')!;
const tabs = (c: HTMLElement) => within(pane(c)).getAllByRole("tab");
const activeTab = (c: HTMLElement) => tabs(c).find(t => t.getAttribute("aria-selected") === "true")?.textContent;
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`)!;
const connector = (c: HTMLElement, id: string) => card(c, id).querySelector<HTMLElement>("[data-allocation-connector]")!;
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`)!;
const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
const libraryCard = (c: HTMLElement, key: string) => slot(c, "start").querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const undo = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.undo() });
const save = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.apply() });
const text = (el: Element | null | undefined) => el?.textContent ?? null;
/** What the inspected head says: its kind, its title, its line, its status and its tone, and a draft's chip. */
const headOf = (c: HTMLElement) => {
    const d = details(c);
    return {
        kind: text(d.querySelector("[data-inspector-kind]")), title: text(d.querySelector("[data-inspector-title]")), when: text(d.querySelector("[data-inspector-when]")),
        status: text(d.querySelector("[data-inspector-status]")), tone: d.querySelector("[data-inspector-status]")?.getAttribute("data-tone") ?? null,
        chip: text(d.querySelector("[data-inspector-marks] [data-state]")),
    };
};
const actions = (c: HTMLElement) => [...details(c).querySelectorAll("[data-allocation-bin-actions] button")].map(b => b.textContent);
const banners = (c: HTMLElement) => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-banner]")].map(b => [b.getAttribute("data-allocation-banner"), b.querySelector("[role]")!.textContent]);
/** A dl's rows: each its label and its value, and its value's tone. */
const rowsOf = (dl: Element | null) => {
    const cells = [...(dl?.children ?? [])];
    const out: (string | null)[][] = [];
    for (let i = 0; i + 1 < cells.length; i += 2) out.push([cells[i]!.textContent, cells[i + 1]!.textContent, cells[i + 1]!.getAttribute("data-tone")]);
    return out;
};
const mates = (c: HTMLElement) => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-mate]")].map(m => [...m.children].map(s => s.textContent).concat(m.hasAttribute("data-current") ? ["current"] : []));
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
async function open(example: { fn: { toIR(): unknown } } = ex.allocationKilnYard) { const r = mount(example); await settle(); return r.container; }
async function tab(c: HTMLElement, name: "Details" | "Issues") { await press(tabs(c).find(t => t.textContent!.startsWith(name))); }
const button = (root: HTMLElement, name: string | RegExp) => within(root).getByRole("button", { name });
/** A row of the Table, its pane scrolled until it is mounted. */
async function revealRow(c: HTMLElement, key: string) {
    const el = c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
    for (let top = 0; c.querySelector(`[data-allocation-row="${key}"]`) === null && top <= 120 * 36; top += 10 * 36) { await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle(); }
    return tableRow(c, key);
}
/** Scrolls the resource pane until a row far down it is mounted. */
async function reveal(c: HTMLElement, key: string) {
    const el = c.querySelector<HTMLElement>("[data-allocation-timeline] [data-virtual-rows]")!;
    for (let top = 0; c.querySelector(`[data-allocation-resource="${key}"]`) === null && top <= 33 * 62; top += 6 * 36) { await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle(); }
    return row(c, key);
}
async function hover(from: Element, into: Element) {
    expect(from).toBeTruthy(); expect(into).toBeTruthy();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
async function over(into: Element, x = 14) { await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: x, clientY: 12 }); }); await settle(); }
async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 14, clientY: 12 }); }); await settle(); }
async function cancel() { await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle(); }
/** The yard fit's answer to a question, the latest. */
const answerTo = (match: (ask: FitResult["ask"]) => boolean) => [...h.fits.history].reverse().find(a => match((a as FitResult).ask)) as FitResult;
const placing = (bin: string) => (ask: FitResult["ask"]) => ask.type === "place" && ask.value.subject.type === "bin" && ask.value.subject.value === bin;
/** An answer's best fits, the current resource excepted. */
const bestOf = (a: FitResult, current?: string) => [...a.resources].flatMap(([k, f]) => f.type === "fits" && k !== current ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).slice(0, 3).map(f => f.k);
const whyOf = (a: FitResult, key: string) => { const f = a.resources.get(key)!; return f.type === "fits" ? f.value.why : f.value.reason; };
const hour = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));

describe("the pane and its tabs (A55)", () => {
    test("A55 — two tabs, Details and Issues with its count; collapsed, the rail's badge is the count", async () => {
        const c = await open();
        expect(tabs(c).map(t => t.textContent)).toEqual(["Details", "Issues 3"]);
        await press(button(pane(c), "Collapse Inspector"));
        expect(pane(c).querySelector("[data-dock-badge]")!.textContent).toBe("3");
        expect(pane(c).querySelector("[data-dock-mark]")!.getAttribute("aria-label")).toBe("3 issues");
        await press(button(pane(c), "Expand Inspector"));
        expect(details(c)).not.toBeNull();
    });

    test("A55 — Details shows the summary with nothing selected, the selection when there is one, and the drop list during a drag", async () => {
        const c = await open();
        expect(headOf(c).kind).toBe("Plan · Tue 11 May");
        await press(card(c, "3101"));
        expect(headOf(c).kind).toBe("Bin 3101");
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(details(c).querySelector("[data-allocation-drop-head]")!.firstElementChild!.textContent).toBe("Gaps that fit");
        // The selection waits for the drag to end.
        expect(details(c).querySelector("[data-inspector-kind]")).toBeNull();
        await cancel();
        expect(headOf(c).kind).toBe("Bin 3101");
        expect(details(c).querySelector("[data-allocation-drop-head]")).toBeNull();
    });

    test("A55, A8, A22 — an inspection opens Details; a command's selection keeps the tab; a drag shows Details and gives the tab back", async () => {
        const c = await open();
        await tab(c, "Issues");
        expect(activeTab(c)).toBe("Issues 3");
        await press(card(c, "3113"));
        expect(activeTab(c)).toBe("Details");
        await tab(c, "Issues");
        // Delete removes the selected bin, a command: the tab stays.
        await key(c, "Delete");
        expect(activeTab(c)).toBe("Issues 3");
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(activeTab(c)).toBe("Details");
        await cancel();
        expect(activeTab(c)).toBe("Issues 3");
    });
});

describe("a bin (A56–A59)", () => {
    test("A56 — its eyebrow `Bin 3113` and status Committed, its title `LD-2210 · 32 m³`, its meta, and Unlink and Back to Events", async () => {
        const c = await open();
        await press(card(c, "3113"));
        expect(headOf(c)).toEqual({ kind: "Bin 3113", title: "LD-2210 · 32 m³", when: "FRN · R2 · spec MC08", status: "Committed", tone: "success", chip: null });
        expect(actions(c)).toEqual(["Unlink", "Back to Events"]);
        expect(banners(c)).toEqual([]);
    });

    test("A56 — a banner per issue: `Over max · K-207 holds 44 m³ against a 40 m³ max · 4 m³ over.`; `Overlaps the next job · The 8-day hold on K-105 runs to Tue 18, 2 d into the job planned Mon 17.`", async () => {
        const c = await open();
        await press(card(c, "3109"));
        expect([headOf(c).status, headOf(c).tone]).toEqual(["Check", "warning"]);
        expect(banners(c)).toEqual([["Over max", "Over maxK-207 holds 44 m³ against a 40 m³ max · 4 m³ over."]]);
        await press(card(c, "3124"));
        expect(banners(c)).toEqual([["Overlaps the next job", "Overlaps the next jobThe 8-day hold on K-105 runs to Tue 18, 2 d into the job planned Mon 17."]]);
        // The yard's Spec mismatch is neutral: listed in Issues, never a banner.
        await press(card(c, "3113"));
        expect(banners(c)).toEqual([]);
    });

    test("A56 — not linked: `Not linked · LD-2210 has no resource. Link it to a gap that fits, or it stays unplaced.`; under min: `… Another event can top it up; Save still works.`", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "Unlink"));
        expect([headOf(c).status, headOf(c).chip]).toEqual(["Not linked · unsaved", "Pending"]);
        expect(banners(c)).toEqual([["Not linked", "Not linkedLD-2210 has no resource. Link it to a gap that fits, or it stays unplaced."]]);
        // Linked to the bulk kiln through the field's Chooser: under its 40 m³ minimum.
        await press(details(c).querySelector("[data-allocation-resource-field]"));
        await press(within(details(c).querySelector<HTMLElement>("[data-chooser]")!).getByRole("option", { name: /K-601/ }));
        expect(banners(c)).toEqual([["Under min", "Under minK-601 holds 32 m³ against a 40 m³ minimum · 8 m³ short. Another event can top it up; Save still works."]]);
        expect(headOf(c).status).toBe("Allocated · unsaved");
    });

    test("A56, A76 — a changed committed bin: `Moved · unsaved`, Pending, Revert; Revert puts it back as the day holds it", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "One hour later"));
        expect([headOf(c).status, headOf(c).chip, headOf(c).tone]).toEqual(["Moved · unsaved", "Pending", "neutral"]);
        expect(details(c).querySelector("[data-allocation-time]")!.textContent).toBe("11:35");
        expect(actions(c)).toEqual(["Unlink", "Revert", "Back to Events"]);
        expect(text(details(c).querySelector("[data-allocation-was]"))).toBe("was K-108 · B-2 10:35");
        await press(button(details(c), "Revert"));
        expect([headOf(c).status, details(c).querySelector("[data-allocation-time]")!.textContent]).toEqual(["Committed", "10:35"]);
        expect(details(c).querySelector("[data-allocation-was]")).toBeNull();
        expect(undo(c)).toHaveProperty("disabled", false);
    });

    test("A56, A59 — a new bin: `New bin`, `Added · unsaved` and New, `new booking · not in the plan yet`; Back to Events returns its event", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        const book = details(c).querySelector<HTMLElement>('[data-allocation-option="event:LD-2235"]')!;
        await press(button(book, "Book"));
        expect(headOf(c)).toMatchObject({ kind: "New bin", title: "LD-2235 · 8 m³", status: "Not linked · unsaved", chip: "New" });
        expect(text(details(c).querySelector("[data-allocation-was]"))).toBe("new booking · not in the plan yet");
        expect(actions(c)).toEqual(["Back to Events"]);
        await press(button(details(c), "Back to Events"));
        expect(c.querySelector("[data-allocation-row='bin:N1']")).toBeNull();
        expect(headOf(c).kind).toBe("Plan · Tue 11 May");
    });

    test("A57 — Lane moves the bin to that lane's slot in the same hour; Bin time steps a slot, its help `B-2 bins at :35 · ± 1 h, 00–23 on Tue 11`; + is off at 23", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const help = () => text(details(c).querySelector('[data-field="at"]')?.querySelector("[data-part=helper-text], [id$=helpertext]") ?? null)
            ?? details(c).querySelector('[data-field="at"]')!.textContent;
        expect(details(c).querySelector('[data-field="at"]')!.textContent).toContain("B-2 bins at :35 · ± 1 h, 00–23 on Tue 11");
        expect(help()).toContain("± 1 h");
        const lanes = within(details(c).querySelector<HTMLElement>('[data-field="lane"]')!).getAllByRole("radio");
        expect(lanes.map(r => [r.textContent, r.getAttribute("aria-checked")])).toEqual([["B-1", "false"], ["B-2", "true"], ["B-3", "false"]]);
        await press(lanes[2]!);
        await press(button(details(c), "One hour earlier"));
        await press(save(c));
        const moved = h.read(ex.kilnPlans).get(TUE)!.bins.get("3113")!;
        expect([moved.lane, moved.at, [...moved.parts]]).toEqual(["B-3", hour(9, 55), [["K-108", 32]]]);
        expect(details(c).querySelector('[data-field="at"]')!.textContent).toContain("B-3 bins at :55 · ± 1 h, 00–23 on Tue 11");
        await press(card(c, "3126"));
        expect([button(details(c), "One hour later").hasAttribute("disabled"), button(details(c), "One hour earlier").hasAttribute("disabled")]).toEqual([true, false]);
    });

    test("A57 — the app's values as rows, a warning one in warn-text: `Spec · booked MC08 · measured MC22`", async () => {
        const c = await open();
        await press(card(c, "3113"));
        expect(rowsOf(details(c).querySelector("[data-allocation-values]"))).toEqual([
            ["Spec", "booked MC08 · measured MC22", "warning"], ["Grade", "R2", null], ["Instruction", "none", null],
        ]);
    });

    test("A57, A75 — the quantity is one draft; a bin wholly on its resource stays wholly there, and Saves", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const user = userEvent.setup();
        const quantity = within(details(c).querySelector<HTMLElement>('[data-field="quantity"]')!).getByRole("spinbutton");
        await user.clear(quantity);
        for (const k of "30") { await user.type(quantity, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        expect(headOf(c).title).toBe("LD-2210 · 30 m³");
        expect(headOf(c).status).toBe("Edited · unsaved");
        await press(save(c));
        const saved = h.read(ex.kilnPlans).get(TUE)!.bins.get("3113")!;
        expect([saved.quantity, [...saved.parts]]).toEqual([30, [["K-108", 30]]]);
    });

    test("A58 — Assigned to: the field, the fill and its meter with the min tick, the group line, Before · Hold · Next fill, its bins today and the batch line", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const assigned = details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!;
        expect(text(assigned.querySelector("[data-allocation-resource-field]"))).toBe("K-108");
        expect(text(assigned.querySelector("[data-allocation-fill]"))).toBe("32 m³ · takes 16–32");
        const meter = assigned.querySelector<HTMLElement>("[data-allocation-meter]")!;
        expect([meter.firstElementChild!.querySelector<HTMLElement>("div")!.style.width, meter.querySelector<HTMLElement>("[data-allocation-min]")!.style.left]).toEqual(["100%", "50%"]);
        expect(assigned.textContent).toContain("Hall A · min 16 m³ · max 32 m³");
        expect(rowsOf(assigned.querySelector("[data-allocation-facts]"))).toEqual([
            ["Before", "job C-3143 · released Mon 10", null], ["Hold", "Tue 11 to Mon 17 · 7 d", null], ["Next fill", "Thu 20 · 2 d spare · the plan had this charge on Wed 12", null],
        ]);
        expect(mates(c)).toEqual([["10:35", "B-2", "LD-2210", "32 m³", "current"]]);
        expect(text(assigned.querySelector("[data-allocation-batch]"))).toBe("One bin fills it.");
        // K-304 holds five bins: batched.
        await press(card(c, "3110"));
        expect(text(details(c).querySelector("[data-allocation-batch]"))).toBe("Batched · 5 bins · 7 m³");
        expect(mates(c).map(m => m[2])).toEqual(["LD-2206", "LD-2208", "LD-2209", "LD-2211", "LD-2218"]);
        expect(mates(c).find(m => m.includes("current"))![2]).toBe("LD-2208");
    });

    test("A58, A48 — the field opens the Chooser in the pane, the Table's sections, each the fit's; a choice re-links the bin, one draft", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(details(c).querySelector("[data-allocation-resource-field]"));
        const list = details(c).querySelector<HTMLElement>("[data-chooser]")!;
        const sections = [...list.querySelectorAll("[role=group]")].map(g => g.getAttribute("aria-label"));
        expect(sections).toEqual(["Current", "Gaps that fit", "Doesn’t fit"]);
        const fits = [...list.querySelectorAll('[role=group][aria-label="Gaps that fit"] [role=option]')].map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent);
        const answer = answerTo(placing("3113"));
        expect(fits).toEqual(bestOf(answer, "K-108").slice(0, fits.length));
        expect(fits).toEqual(["K-103", "K-601"]);
        await press(within(list).getByRole("option", { name: /K-103/ }));
        expect(details(c).querySelector("[data-chooser]")).toBeNull();
        expect(document.activeElement).toBe(details(c).querySelector("[data-allocation-resource-field]"));
        expect([text(details(c).querySelector("[data-allocation-resource-field]")), headOf(c).status]).toEqual(["K-103", "Allocated · unsaved"]);
        expect(text(card(c, "3113").querySelector("[data-allocation-to]"))).toBe("K-103");
        await press(undo(c));
        expect(text(details(c).querySelector("[data-allocation-resource-field]"))).toBe("K-108");
    });

    test("A58 — not linked: `+ Choose a resource` in warn, and the layout's hint", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "Unlink"));
        const field = details(c).querySelector<HTMLElement>("[data-allocation-resource-field]")!;
        expect([field.textContent, field.hasAttribute("data-unlinked")]).toEqual(["+ Choose a resource", true]);
        expect(details(c).querySelector("[data-allocation-assigned]")!.textContent).toContain("Or drag the bin’s connector onto a resource row.");
        expect(details(c).querySelector("[data-allocation-alternatives]")!.firstElementChild!.textContent).toBe("Gaps that fit");
        const t = await open(ex.allocationTable);
        await press(within(await revealRow(t, "bin:3113")).getByRole("button", { name: "Unlink LD-2210 from K-108" }));
        await press(tableRow(t, "bin:3113").querySelector("span"));
        expect(details(t).querySelector("[data-allocation-assigned]")!.textContent).toContain("Or use the chevron on its row in the table.");
    });

    test("A58 — `Open resource →` selects the resource; a bin of it today selects that bin", async () => {
        const c = await open();
        await press(card(c, "3110"));
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!, "Open resource"));
        expect(headOf(c)).toMatchObject({ kind: "Resource", title: "K-304" });
        await press(details(c).querySelector('[data-allocation-mate="3114"]'));
        expect(headOf(c).kind).toBe("Bin 3114");
    });

    test("A59 — other gaps that fit: the three best, its resource excepted, each its rank, the fit's reason and Move; Move re-links it", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const answer = answerTo(placing("3113"));
        const shown = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-alternative]")];
        expect(shown.map(o => [o.children[0]!.textContent, o.getAttribute("data-allocation-alternative"), o.children[1]!.lastElementChild!.textContent, o.children[2]!.textContent]))
            .toEqual(bestOf(answer, "K-108").map((k, i) => [String(i + 1), k, whyOf(answer, k), "Move"]));
        await press(button(shown[0]!, "Move"));
        expect(text(card(c, "3113").querySelector("[data-allocation-to]"))).toBe(bestOf(answer, "K-108")[0]);
    });

    test("A59 — with no other gap: `no other free gap is long enough`", async () => {
        const c = await open();
        // Every kiln but K-108 drying a charge through the plan day: busy, none takes the bin.
        const kilns = h.read(ex.kilns);
        const busy = new SortedMap([...kilns].map(([k, kiln]) => [k, k === "K-108" ? kiln
            : { ...kiln, charges: [{ label: "C-9000", start: new Date("2027-05-01T00:00:00Z"), end: new Date("2027-06-01T00:00:00Z") }] }] as const), compareFor(StringType));
        await h.commit(ex.kilns, busy);
        await press(card(c, "3113"));
        expect(text(details(c).querySelector("[data-allocation-alternatives]"))).toBe("Other gaps that fitno other free gap is long enough");
    });

    test("A59 — the event's details (`Settings`)", async () => {
        const c = await open();
        await press(card(c, "3113"));
        expect(rowsOf(details(c).querySelector("[data-allocation-details] dl"))).toEqual([["Settings", "Schedule KS-7 · 80 °C · equalise 12 h · direct", null]]);
    });
});

describe("a free slot (A60)", () => {
    test("A60 — `Slot · Free`, `B-1 · 00:15`, `Tue 11 May · no event · no resource`; every event it can book, overdue first in warn, a Book each", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        expect(headOf(c)).toEqual({ kind: "Slot", title: "B-1 · 00:15", when: "Tue 11 May · no event · no resource", status: "Free", tone: "neutral", chip: null });
        const books = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-book] [data-allocation-option]")];
        expect(books.map(o => o.getAttribute("data-allocation-option"))).toEqual(["event:LD-2231", "event:LD-2232", "event:LD-2233", "event:LD-2234", "event:LD-2235", "event:LD-2236"]);
        const late = books[0]!.querySelector<HTMLElement>("[title]")!;
        expect([books[0]!.textContent!.startsWith("LD-223121 m³"), late.textContent, late.getAttribute("data-tone")]).toEqual([true, "BRK · R2 · spec MC12 · overdue", "warning"]);
        await press(button(books[0]!, "Book"));
        expect(tableRow(c, "bin:N1").querySelector("[data-allocation-chip=event]")!.textContent).toContain("LD-2231");
    });

    test("A60 — Reserve a resource: the five best for a reservation, free ones first, each the fit's reason; Reserve reserves the slot on it", async () => {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        const answer = answerTo(placing(RESERVE_PROBE));
        const offered = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-reserve] [data-allocation-option]")];
        const lines = offered.map((o): [string, string] => [o.getAttribute("data-allocation-option")!, o.querySelector("[title]")!.textContent!]);
        const fits = [...answer.resources].filter(([, f]) => f.type === "fits");
        for (const [key, line] of lines) expect(line.replace(/^(free|loading) · /, "")).toBe(whyOf(answer, key));
        // Free first, each best first: a resource is loading when a bin of the day is on it (the probe in the slot holds none).
        const loading = new Set([...h.read(ex.kilnPlans).get(TUE)!.bins.values()].flatMap(bin => [...bin.parts.keys()]));
        const ranked = fits.map(([key, f]) => ({ key, score: f.type === "fits" ? f.value.score : 0, loading: loading.has(key) }))
            .sort((x, y) => Number(x.loading) - Number(y.loading) || byScore(y.score, x.score) || byKey(x.key, y.key));
        expect(lines.map(([key, line]) => [key, line.split(" · ")[0]])).toEqual(ranked.slice(0, 5).map(f => [f.key, f.loading ? "loading" : "free"]));
        // Both kinds are among the fits, so the order is the rule's, not the scores'.
        expect([ranked.some(f => f.loading), ranked.some(f => !f.loading)]).toEqual([true, true]);
        expect(details(c).querySelector("[data-allocation-reserve]")!.textContent).toContain("Or drag an event or a resource from the library onto this row.");
        await press(button(offered[0]!, "Reserve"));
        expect([tableRow(c, "bin:V1").getAttribute("data-kind"), text(tableRow(c, "bin:V1").querySelector("[data-allocation-chip=resource]"))]).toEqual(["reserved", lines[0]![0]]);
    });
});

describe("a reservation (A61)", () => {
    /** A new reservation of B-1 00:15 on K-305, selected. */
    async function reserved() {
        const c = await open(ex.allocationTable);
        await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        await press(button(details(c).querySelector<HTMLElement>('[data-allocation-reserve] [data-allocation-option="K-305"]')!, "Reserve"));
        return c;
    }

    test("A61 — `New reservation`, `Added · unsaved`, `B-1 · 00:15`, `Reserved on K-305 · no event yet`; Assigned to with Remove and Open resource, its fill and meter", async () => {
        const c = await reserved();
        expect(headOf(c)).toEqual({ kind: "New reservation", title: "B-1 · 00:15", when: "Reserved on K-305 · no event yet", status: "Added · unsaved", tone: "neutral", chip: "New" });
        const assigned = details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!;
        expect(button(assigned, "Remove").getAttribute("title")).toBe("Remove the reservation · the slot becomes free");
        expect(within(assigned).getByRole("button", { name: "Open resource" })).toBeTruthy();
        expect([text(assigned.querySelector("[data-allocation-fill]")), assigned.querySelector("[data-allocation-meter]") !== null]).toEqual(["0 m³ · takes 4–10", true]);
    });

    test("A61 — Book an event: each checked against the resource, one take of it — Book off and `doesn’t fit · …` in warn when refused; a fit fills the reservation", async () => {
        const c = await reserved();
        const take = () => answerTo(ask => ask.type === "take" && ask.value.resource === "K-305");
        const option = (key: string) => details(c).querySelector<HTMLElement>(`[data-allocation-book] [data-allocation-option="${key}"]`)!;
        const said = (key: string) => [option(key).querySelector("[title]")!.textContent, option(key).querySelector("[title]")!.getAttribute("data-tone"), button(option(key), "Book").hasAttribute("disabled")];
        const refusal = take().events.get("LD-2232")!;
        expect(said("event:LD-2232")).toEqual([`doesn’t fit · ${refusal.type === "refused" ? refusal.value.reason : ""}`, "warning", true]);
        const fit = take().events.get("LD-2235")!;
        expect(said("event:LD-2235")).toEqual([fit.type === "fits" ? fit.value.why : "", null, false]);
        expect(details(c).querySelector("[data-allocation-book]")!.textContent).toContain("Each event is checked against K-305. Book is off when it doesn’t fit.");
        await press(button(option("event:LD-2235"), "Book"));
        expect(c.querySelector("[data-allocation-row='bin:V1']")).toBeNull();
        expect(text(tableRow(c, "bin:N1").querySelector("[data-allocation-chip=resource]"))).toBe("K-305");
    });

    test("A61 — Remove frees the slot; a committed reservation moved says `was …`, and Revert puts it back", async () => {
        const c = await reserved();
        await press(save(c));
        await press(tableRow(c, "bin:V1").querySelector("span"));
        expect([headOf(c).kind, headOf(c).status, headOf(c).tone]).toEqual(["Reserved slot", "Reserved", "info"]);
        // Moved to another kiln through its row's resource Chooser: a draft.
        await press(tableRow(c, "bin:V1").querySelector("[data-allocation-cell-side=resource] [aria-haspopup=listbox]"));
        await press(within(document.querySelector<HTMLElement>("[data-chooser]")!).getByRole("option", { name: /K-601/ }));
        await press(tableRow(c, "bin:V1").querySelector("span"));
        expect([headOf(c).status, text(details(c).querySelector("[data-allocation-was] span"))]).toEqual(["Moved · unsaved", "was K-305 · B-1 00:15"]);
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-was]")!, "Revert"));
        expect(text(tableRow(c, "bin:V1").querySelector("[data-allocation-chip=resource]"))).toBe("K-305");
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!, "Remove"));
        expect(c.querySelector("[data-allocation-row='bin:V1']")).toBeNull();
    });
});

describe("a resource (A62)", () => {
    test("A62 — `Resource`, Check, `K-207`, `Hall B · min 20 m³ · max 40 m³`; its banner; today's fill and meter; Before · Hold · Next fill; its bins today; the hint", async () => {
        const c = await open();
        await press(await reveal(c, "K-207"));
        expect(headOf(c)).toEqual({ kind: "Resource", title: "K-207", when: "Hall B · min 20 m³ · max 40 m³", status: "Check", tone: "warning", chip: null });
        expect(banners(c)).toEqual([["Over max", "Over maxK-207 holds 44 m³ against a 40 m³ max · 4 m³ over."]]);
        const fill = details(c).querySelector<HTMLElement>("[data-allocation-fill-section]")!;
        expect([text(fill.querySelector("[data-allocation-fill]")), fill.querySelector("[data-allocation-fill]")!.getAttribute("data-tone")]).toEqual(["44 m³ · max 40 · 4 over", "danger"]);
        expect(rowsOf(fill.querySelector("[data-allocation-facts]"))).toEqual([
            ["Before", "job C-3148 · released Fri 7", null], ["Hold", "Tue 11 to Wed 19 · 9 d", null], ["Next fill", "Thu 20 · 0 d spare", null],
        ]);
        expect(mates(c)).toEqual([["06:36", "B-2", "LD-2207", "44 m³"]]);
        expect(details(c).querySelector("[data-allocation-bins]")!.textContent).toContain("Drag a bin’s connector or an event onto this row to load it.");
    });

    test("A62, A85 — busy: `busy until Fri 14`, `no bins today` and its hint; free: `not started` and `none planned to Thu 20`; held into its next fill in warn", async () => {
        const c = await open();
        await press(await reveal(c, "K-503"));
        expect([headOf(c).status, rowsOf(details(c).querySelector("[data-allocation-facts]"))[1]![1]]).toEqual(["Busy", "busy until Fri 14"]);
        expect(details(c).querySelector("[data-allocation-bins]")!.textContent).toBe("Bins on it todayno bins todayBusy resources take no load until their current job is released.");
        await press(await reveal(c, "K-601"));
        const facts = details(c).querySelector("[data-allocation-facts]")!;
        expect([headOf(c).status, ...rowsOf(facts).map(r => r[1])]).toEqual(["Free", "empty in the plan", "not started", "none planned to Thu 20"]);
        expect(facts.children[3]!.hasAttribute("data-absent")).toBe(true);
        await press(await reveal(c, "K-105"));
        expect(rowsOf(details(c).querySelector("[data-allocation-facts]"))[2]).toEqual(["Next fill", "Mon 17 · hold overlaps it by 2 d", "warning"]);
    });

    test("A62 — the Table's hint", async () => {
        const c = await open(ex.allocationTable);
        await press((await revealRow(c, "bin:3113")).querySelector("span"));
        await press(button(details(c).querySelector<HTMLElement>("[data-allocation-assigned]")!, "Open resource"));
        expect(details(c).querySelector("[data-allocation-bins]")!.textContent).toContain("Choose it with the resource chevron on a row, or drag it from the Library onto a row.");
    });
});

describe("the summary (A63, A89)", () => {
    test("A63 — `Plan · Tue 11 May`, the title, `3 lanes · 33 resources`; Bins, Loading, Issues and Drafts; A89 — the three hints", async () => {
        const c = await open();
        expect(headOf(c)).toMatchObject({ kind: "Plan · Tue 11 May", title: "Kiln loading", when: "3 lanes · 33 resources" });
        const stats = () => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-stat]")].map(s => [...s.children].map(e => e.textContent).concat([s.children[1]!.getAttribute("data-tone") ?? ""]));
        expect(stats()).toEqual([
            ["Bins", "26", "556 m³ · 0 reserved", ""], ["Loading", "21 of 33", "10 free · 2 busy", ""],
            ["Issues", "3", "2 overlaps · 1 over max", "warning"], ["Drafts", "0", "all saved", ""],
        ]);
        expect([...details(c).querySelectorAll("[data-allocation-hints] li")].map(li => li.textContent)).toEqual([
            "Select a bin or a resource to inspect it.", "Use the Library to book events and reserve resources.", "Every change is a draft until Save. Undo and Redo are in the toolbar.",
        ]);
        expect(details(c).querySelector("[data-allocation-scope]")).toBeNull();
        // A draft is counted, and Save is named.
        await press(card(c, "3113"));
        await key(c, "Delete");
        await key(c, "Escape");
        expect(stats()[3]).toEqual(["Drafts", "1", "unsaved · Save is in the toolbar", "brand"]);
    });

    test("A63 — the narrowing's note: `10 of 33 resources visible · fits, checks and totals include all`", async () => {
        const c = await open();
        await press(toolbar(c).getByRole("button", { name: "Halls" }));
        await vi.waitFor(() => expect(text(details(c).querySelector("[data-allocation-scope]"))).toBe("19 of 33 resources visible · fits, checks and totals include all"));
        // The counts are the whole day's.
        expect(text(details(c).querySelector('[data-allocation-stat="Loading"]'))).toContain("21 of 33");
    });
});

describe("Issues (A64)", () => {
    test("A64 — grouped, each with its mark and its count; an issue's title and `Show →`, its detail and its fix; the app's listed, not counted", async () => {
        const c = await open();
        await tab(c, "Issues");
        const groups = [...issuesTab(c).querySelectorAll<HTMLElement>("[data-allocation-issue-group]")];
        expect(groups.map(g => [g.firstElementChild!.textContent, g.firstElementChild!.getAttribute("data-tone"), g.firstElementChild!.querySelector("svg")?.getAttribute("data-icon") ?? null])).toEqual([
            ["Overlaps the next job2", "warning", "triangle-exclamation"], ["Over max1", "danger", "circle-exclamation"], ["Spec mismatch11", null, null],
        ]);
        const over = groups[1]!.querySelector<HTMLElement>("[data-allocation-issue]")!;
        expect([...over.children].map(e => e.textContent)).toEqual(["K-207Show", "44 m³ · max 40 · 4 over · over max", "Move LD-2207…"]);
        // The tab counts warnings and dangers, never the yard's neutral Spec mismatch.
        expect(activeTab(c)).toBe("Issues 3");
        expect(groups[2]!.querySelectorAll("[data-allocation-issue]")).toHaveLength(11);
        expect(groups[2]!.querySelector("[data-allocation-issue] button:not([type=button])")).toBeNull();
    });

    test("A64 — `Show →` selects its resource or its bin in Details; a fix opens the bin's resource Chooser", async () => {
        const c = await open();
        await tab(c, "Issues");
        const over = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="over"] [data-allocation-issue]')!;
        await press(button(over, "Show"));
        expect([activeTab(c), headOf(c).kind, headOf(c).title]).toEqual(["Details", "Resource", "K-207"]);
        await tab(c, "Issues");
        await press(button(issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="over"] [data-allocation-issue]')!, "Move LD-2207…"));
        expect([activeTab(c), headOf(c).kind]).toEqual(["Details", "Bin 3109"]);
        expect(details(c).querySelector("[data-allocation-assigned] [data-chooser]")).not.toBeNull();
        await tab(c, "Issues");
        await press(button(issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="custom:Spec mismatch"] [data-allocation-issue]')!, "Show"));
        expect(headOf(c).kind).toBe("Bin 3102");
    });

    test("A64 — not linked: its fix `Choose a resource` opens the bin's Chooser; with none: `No issues · Every event sits within its gap and its max.`", async () => {
        const c = await open();
        await press(card(c, "3113"));
        await press(button(details(c), "Unlink"));
        await tab(c, "Issues");
        const unlinked = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="unlinked"]')!;
        expect(unlinked.firstElementChild!.textContent).toBe("Not linked1");
        await press(button(unlinked, "Choose a resource"));
        expect(details(c).querySelector("[data-allocation-assigned] [data-chooser]")).not.toBeNull();
        // Thu 13 has no entry and no issue.
        await key(c, "]"); await key(c, "]");
        await tab(c, "Issues");
        expect(issuesTab(c).querySelector("[data-allocation-issues-empty]")!.textContent).toBe("No issuesEvery event sits within its gap and its max.");
    });
});

describe("the drop list (A34, A86)", () => {
    test("A34 — a connector's drag lists the three best as drop targets: `Gaps that fit · LD-2201 · 35 m³ · 7-day hold from Tue 11 · ` and the fit's basis; a drop on one links there", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        const head = details(c).querySelector<HTMLElement>("[data-allocation-drop-head]")!;
        const answer = answerTo(placing("3101"));
        expect([...head.children].map(e => e.textContent)).toEqual(["Gaps that fit", "LD-2201 · 35 m³", `7-day hold from Tue 11 · ${answer.basis}`]);
        expect(answer.basis).toBe("ranked by load, kind and spare days, and what it leaves for the day's other loads");
        const rows = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-drop-row]")];
        expect(rows.map(r => [r.children[0]!.textContent, r.getAttribute("data-allocation-drop-row"), r.querySelector('[data-drop-row="why"]')!.textContent]))
            .toEqual(bestOf(answer, "K-209").map((k, i) => [String(i + 1), k, whyOf(answer, k)]));
        expect(rows.every(r => r.querySelector("button") === null)).toBe(true);
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a resource row, or on a resource here.");
        await over(rows[0]!);
        await release();
        expect(text(card(c, "3101").querySelector("[data-allocation-to]"))).toBe(bestOf(answer, "K-209")[0]);
    });

    test("A34, A86 — a body's drag: `Move bin · LD-2203 · 24 m³ · Between lanes and hours · its resource stays K-109`; a resource card's: `Resource · K-305 · Compact · free today`", async () => {
        const c = await open();
        await hover(card(c, "3103"), c.querySelector(`[data-allocation-cell="B-2|${hour(0, 35).getTime()}"]`)!);
        const head = () => [...details(c).querySelector<HTMLElement>("[data-allocation-drop-head]")!.children].map(e => e.textContent);
        expect(head()).toEqual(["Move bin", "LD-2203 · 24 m³", "Between lanes and hours · its resource stays K-109"]);
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a lane hour. To change its resource, drag its connector instead.");
        await cancel();
        await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
        await hover(libraryCard(c, "K-305"), c.querySelector(`[data-allocation-cell="B-2|${hour(0, 35).getTime()}"]`)!);
        expect(head()).toEqual(["Resource", "K-305", "Compact · free today"]);
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a bin to link it, or on an empty lane hour to reserve that slot.");
        await cancel();
    });

    test("A86 — an event's drag says where it drops, on the Timeline and in the Table", async () => {
        const c = await open();
        await hover(libraryCard(c, "event:LD-2231"), row(c, "K-101"));
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a resource row or a lane hour, or on a resource here.");
        expect(details(c).querySelector<HTMLElement>("[data-allocation-drop-head]")!.children[2]!.textContent!.startsWith("8-day hold from Tue 11 · ")).toBe(true);
        await cancel();
        const t = await open(ex.allocationTable);
        await hover(libraryCard(t, "event:LD-2231"), tableRow(t, "slot:B-1|2027-05-11T00:15:00.000"));
        expect(text(details(t).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a free row’s event cell, or on a resource here to book its next free bin.");
        await cancel();
        await hover(tableRow(t, "bin:3103").querySelector("[data-allocation-chip=event]")!, tableRow(t, "slot:B-1|2027-05-11T00:15:00.000"));
        expect(text(details(t).querySelector("[data-allocation-drop-hint]"))).toBe("Drop on a free row’s event cell. To change its resource, use the chevron on its row.");
        await cancel();
    });

    test("A34 — a pick, no drag: the same list with a Book each, and `Book puts it in the day’s first free lane slot (B-1 00:15)…`; Book books it onto that resource there", async () => {
        const c = await open();
        await press(libraryCard(c, "event:LD-2235"));
        const answer = answerTo(ask => ask.type === "place" && ask.value.subject.type === "event" && ask.value.subject.value === "LD-2235");
        const rows = [...details(c).querySelectorAll<HTMLElement>("[data-allocation-drop-row]")];
        expect(rows.map(r => r.getAttribute("data-allocation-drop-row"))).toEqual(bestOf(answer));
        expect(text(details(c).querySelector("[data-allocation-drop-hint]"))).toBe(
            "Book puts it in the day’s first free lane slot (B-1 00:15). Or click a free lane hour or a ranked resource, or drag it there. Esc clears.");
        await press(button(rows[0]!, "Book"));
        expect([text(card(c, "N1").querySelector("[data-allocation-code]")), text(card(c, "N1").querySelector("[data-allocation-to]"))]).toEqual(["LD-2235", bestOf(answer)[0]]);
        await press(save(c));
        const booked = h.read(ex.kilnPlans).get(TUE)!.bins.get("N1")!;
        expect([booked.lane, booked.at]).toEqual(["B-1", hour(0, 15)]);
    });
});

describe("the refusal's note (A40)", () => {
    test("A40 — a refused drop moves nothing; its reason stays at the top of Details, `Not allocated · LD-2201 can’t go into K-101: …`, until dismissed or the next action", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        await release();
        const note = () => details(c).querySelector<HTMLElement>("[data-allocation-refusal]");
        const answer = answerTo(placing("3101"));
        expect(note()!.textContent).toBe(`Not allocatedLD-2201 can’t go into K-101: ${whyOf(answer, "K-101")}.`);
        expect(details(c).firstElementChild).toBe(note());
        await press(button(note()!, /close|dismiss/i));
        expect(note()).toBeNull();
        await hover(connector(c, "3101"), row(c, "K-101"));
        await release();
        expect(note()).not.toBeNull();
        await press(card(c, "3113"));
        expect(note()).toBeNull();
    });

    test("A88, A40 — each refusal's word before its sentence: Not allocated, Not moved, Not booked, Not reserved", async () => {
        const c = await open();
        const note = () => text(details(c).querySelector("[data-allocation-refusal]"));
        // A connector onto a resource that refuses it.
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        await release();
        expect(note()).toBe(`Not allocatedLD-2201 can’t go into K-101: ${whyOf(answerTo(placing("3101")), "K-101")}.`);
        // A card's body onto a resource row.
        await hover(card(c, "3103"), row(c, "K-101"));
        await release();
        expect(note()).toBe("Not movedLD-2203 moves between lane hours only. To change its resource, drag its connector.");
        // A Library event onto a resource that refuses it.
        await hover(libraryCard(c, "event:LD-2232"), row(c, "K-101"));
        await release();
        const booking = answerTo(ask => ask.type === "place" && ask.value.subject.type === "event" && ask.value.subject.value === "LD-2232");
        expect(note()).toBe(`Not bookedLD-2232 can’t go into K-101: ${whyOf(booking, "K-101")}.`);
        // A Library resource onto a lane hour it takes no reservation in: K-207, over its max already.
        await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
        const resources = slot(c, "start").querySelector<HTMLElement>('[data-allocation-library="resources"]')!;
        await act(async () => { fireEvent.change(within(resources).getByRole("textbox", { name: "Find a resource or group" }), { target: { value: "K-207" } }); });
        await settle();
        await hover(libraryCard(c, "K-207"), c.querySelector(`[data-allocation-cell="B-1|${hour(0, 15).getTime()}"]`)!);
        await release();
        expect(note()).toBe("Not reservedK-207 can’t take B-1 00:15: over max by 4 m³.");
    });
});

describe("the connector (A8, A21)", () => {
    test("A21 — a click on a connector selects its bin, opens the inspector and its resource Chooser there", async () => {
        const c = await open();
        await press(button(pane(c), "Collapse Inspector"));
        await press(card(c, "3113"));
        await press(connector(c, "3113"));
        expect(pane(c).hasAttribute("data-collapsed")).toBe(false);
        expect(headOf(c).kind).toBe("Bin 3113");
        expect(details(c).querySelector("[data-allocation-assigned] [data-chooser]")).not.toBeNull();
        // Esc closes it, and keeps the bin.
        await act(async () => { fireEvent.keyDown(details(c).querySelector("[data-chooser] input")!, { key: "Escape" }); }); await settle();
        expect(details(c).querySelector("[data-chooser]")).toBeNull();
        expect(headOf(c).kind).toBe("Bin 3113");
        // The focus is back on the field it opened from, as a popover's goes back to its trigger.
        expect(document.activeElement).toBe(details(c).querySelector("[data-allocation-resource-field]"));
    });
});

describe("the app's bin form (`inspector={{ bin }}`)", () => {
    test("its own form in place of the quantity field and the values rows; its writes are drafts of the day, saved as one patch", async () => {
        const c = await open(ex.allocationCustomBin);
        await press(card(c, "3113"));
        const form = details(c).querySelector<HTMLElement>("[data-allocation-bin-form]")!;
        expect([details(c).querySelector('[data-field="quantity"]'), details(c).querySelector("[data-allocation-values]")]).toEqual([null, null]);
        expect([details(c).querySelector('[data-field="lane"]') !== null, details(c).querySelector('[data-field="at"]') !== null]).toEqual([true, true]);
        const instruction = within(form).getByRole("textbox");
        await act(async () => { fireEvent.change(instruction, { target: { value: "Stack under cover" } }); });
        await settle();
        expect(headOf(c).status).toBe("Edited · unsaved");
        expect(h.read(ex.kilnPlans).get(TUE)!.bins.get("3113")!.values.instruction).toEqual(none);
        await press(save(c));
        expect(h.read(ex.kilnPlans).get(TUE)!.bins.get("3113")!.values.instruction).toEqual(some("Stack under cover"));
    });
});

describe("words and marks (A85, A90)", () => {
    test("A85 — the field's `Choose the resource · the same list as the Table’s chevron`, the stepper's `One hour earlier` and `One hour later`; A90 — the Chooser's check and ×", async () => {
        const c = await open();
        await press(card(c, "3113"));
        const field = details(c).querySelector<HTMLElement>("[data-allocation-resource-field]")!;
        expect(field.title).toBe("Choose the resource · the same list as the Table’s chevron");
        expect([button(details(c), "One hour earlier").title, button(details(c), "One hour later").title]).toEqual(["One hour earlier", "One hour later"]);
        await press(field);
        const list = details(c).querySelector<HTMLElement>("[data-chooser]")!;
        expect(list.querySelector('[role=group][aria-label="Current"] [aria-label="Current"]')).not.toBeNull();
        expect(list.querySelector('[role=group][aria-label="Doesn’t fit"] [aria-label="Doesn\'t fit"]')).not.toBeNull();
    });
});

describe("a published day", () => {
    test("the inspector still works, read-only: no actions, the form printed, the field closed", async () => {
        const c = await open(ex.allocationPublished);
        await press(card(c, "3001"));
        expect(headOf(c)).toMatchObject({ kind: "Bin 3001", status: "Committed" });
        expect(details(c).querySelector("[data-allocation-bin-actions]")).toBeNull();
        expect(within(details(c)).queryAllByRole("spinbutton")).toHaveLength(0);
        expect(details(c).querySelector<HTMLButtonElement>("[data-allocation-resource-field]")!.disabled).toBe(true);
        expect([...details(c).querySelectorAll("[data-allocation-alternative] button")]).toHaveLength(0);
    });
});

describe("pointer motion (A35)", () => {
    test("A35 — a drag's motion repaints nothing in the inspector: its drop list says no quantity again", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(details(c).querySelector("[data-allocation-drop-head]")).not.toBeNull();
        const said = vi.spyOn(allocationWords(), "quantity");
        for (const [i, key] of ["K-102", "K-103", "K-104", "K-101"].entries()) await over(row(c, key), 20 + i);
        expect(said).not.toHaveBeenCalled();
        await cancel();
    });
});
