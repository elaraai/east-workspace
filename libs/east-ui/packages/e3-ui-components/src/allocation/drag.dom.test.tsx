/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board's drags on the Timeline (#1328) over the kiln yard, through the
 * shared drag layer and the yard's fit served by name through the `Func`
 * runtime: when the board asks the fit, the refusing runs, the three best fits
 * and their previews, the row under the pointer, the fits marker, the caption,
 * and every drop's outcome. Every word and figure the mock draws for the same
 * drag is the mock's.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { FloatType, compareFor, variant, type ValueTypeOf } from "@elaraai/east";
import { AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, mount, settle, slot, TUE } from "./harness.test-utils.js";
import { allocationWords } from "./model.js";

const h = allocationHarness();
type FitResult = ValueTypeOf<typeof AllocationFitResultType>;
const byScore = compareFor(FloatType);
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`)!;
const connector = (c: HTMLElement, id: string) => card(c, id).querySelector<HTMLElement>("[data-allocation-connector]")!;
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`)!;
const pane = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-allocation-timeline] [data-virtual-rows]")!;
const caption = () => document.querySelector<HTMLElement>("[data-drag-caption]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const undo = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.undo() });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function open(example: { fn: { toIR(): unknown } } = ex.allocationMinimal) { const r = mount(example); await settle(); return r.container; }
/** Scrolls the resource pane so a row far down it is mounted. */
async function reveal(c: HTMLElement, key: string) {
    const el = pane(c);
    await act(async () => { el.scrollTop = 25 * 36; fireEvent.scroll(el); });
    await settle();
    expect(row(c, key)).not.toBeNull();
}
/** Picks a grip up and brings it over a target, past the 5px a drag waits for. */
async function hover(from: Element, into: Element) {
    expect(from).not.toBeNull(); expect(into).not.toBeNull();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
/** Moves an under-way drag over another target. */
async function over(into: Element, x = 14) { await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: x, clientY: 12 }); }); await settle(); }
async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 14, clientY: 12 }); }); await settle(); }
async function cancel() { await act(async () => { fireEvent.keyDown(document, { key: "Escape", code: "Escape" }); }); await settle(); }
async function drop(from: Element, into: Element) { await hover(from, into); await release(); }
/** The yard fit's last answer. */
const answer = (name = "yard_fit") => h.fits.answers.get(name) as FitResult;
/** The resources an answer refuses, and its three best fits, the current resource excepted. */
const refusedBy = (a: FitResult) => [...a.resources].filter(([, f]) => f.type === "refused").map(([k]) => k);
const bestOf = (a: FitResult, current: string) => [...a.resources].flatMap(([k, f]) => f.type === "fits" && k !== current ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).slice(0, 3).map(f => f.k);

describe("when the board asks the fit (F1, A23)", () => {
    test("A23 — the selected bin's question is asked before a drag needs it; A35 — once per question, however far a drag goes", async () => {
        const c = await open();
        expect(h.fits.calls.get("yard_fit") ?? 0).toBe(0);
        await press(card(c, "3101"));
        expect(h.fits.calls.get("yard_fit")).toBe(1);
        expect(answer().ask).toEqual(variant("place", { subject: variant("bin", "3101"), quantity: 35 }));
        // Its connector's drag asks the same question: answered already.
        await hover(connector(c, "3101"), row(c, "K-101"));
        for (const key of ["K-102", "K-103", "K-104", "K-105", "K-201", "K-202"]) await over(row(c, key));
        expect(h.fits.calls.get("yard_fit")).toBe(1);
        await cancel();
    });

    test("F1 — a draft asks again: the drafts changed, the kept answer is not theirs", async () => {
        const c = await open();
        await press(card(c, "3101"));
        expect(h.fits.calls.get("yard_fit")).toBe(1);
        // A move selects its bin: its question, of the new drafts.
        await drop(card(c, "3103"), c.querySelector(`[data-allocation-cell="B-2|${Date.UTC(2027, 4, 11, 0, 35)}"]`)!);
        expect(h.fits.calls.get("yard_fit")).toBe(2);
        await press(card(c, "3101"));
        expect(h.fits.calls.get("yard_fit")).toBe(3);
    });
});

describe("a connector's drag over the resources", () => {
    test("A27 — every refusing row recedes, one label per run of contiguous refusing rows of one group, as the mock draws LD-2201's", async () => {
        const c = await open();
        await hover(connector(c, "3101"), row(c, "K-101"));
        const refused = [...c.querySelectorAll("[data-allocation-resource][data-refused]")].map(r => r.getAttribute("data-allocation-resource"));
        expect(refused).toEqual(refusedBy(answer()).filter(k => refused.includes(k)));
        expect(refused.length).toBeGreaterThan(20);
        const runs = [...c.querySelectorAll<HTMLElement>("[data-run]")].map(el => {
            const meta = el.lastElementChild!.textContent!;
            return [el.textContent!.slice(0, -meta.length), meta];
        });
        expect(runs).toEqual([
            ["Over max", "3 resources · by 3–34 m³"],
            ["Gap too short", "2 resources · next job Fri 14 – Mon 17"],
            ["Over max", "4 resources · by 11–35 m³"],
            ["Gap too short", "next job Fri 14"],
            ["Over max", "3 resources · by 30–34 m³"],
            ["Gap too short", "next job Sat 15"],
            ["Over max", "3 resources · by 32–39 m³"],
            ["Gap too short", "next job Thu 13"],
            ["Gap too short", "next job Sun 16"],
            ["Over max", "8 resources · by 25–35 m³"],
            ["Gap too short", "next job Fri 14"],
            ["Busy", "2 resources · until Fri 14 – Sat 15"],
            ["Gap too short", "next job Sun 16"],
        ]);
        // Its tooltip: every row's reason.
        expect(c.querySelector<HTMLElement>("[data-run]")!.title).toBe("over max by 34 m³ · over max by 30 m³ · over max by 3 m³");
        // What each refusal is about is outlined: K-101's load over max, K-503's charge in the way.
        expect(row(c, "K-101").querySelector("[data-allocation-load]")!.hasAttribute("data-refusal")).toBe(true);
        expect([...row(c, "K-103").querySelectorAll("[data-refusal]")]).toHaveLength(0);
        await cancel();
        expect(c.querySelectorAll("[data-refused], [data-run]")).toHaveLength(0);
    });

    test("A28 — the three best, the current resource excepted, carry #1 #2 #3 and a dashed preview `+Q m³ · after m³`", async () => {
        const c = await open();
        await reveal(c, "K-601");
        await hover(connector(c, "3101"), row(c, "K-601"));
        const best = bestOf(answer(), "K-209");
        expect(best).toEqual(["K-601"]);
        const ranked = [...c.querySelectorAll("[data-allocation-rank]")].map(b => [b.textContent, b.closest("[data-allocation-resource]")!.getAttribute("data-allocation-resource")]);
        expect(ranked).toEqual([["1", "K-601"]]);
        expect(row(c, "K-601").querySelector("[data-allocation-preview]")!.textContent).toBe("+35 m³ · 35 m³");
        // A ranked row says why, at rest or under the pointer: the yard's fit's words, the mock's built-in ones and what it leaves for the day's other loads.
        const fit = answer().resources.get("K-601")!;
        const why = row(c, "K-601").querySelector("[data-allocation-reason]")!.textContent!;
        expect(why).toBe(fit.type === "fits" ? fit.value.why : "");
        expect(why.startsWith("open gap · leaves 35 m³ · min 40 · 5 short")).toBe(true);
        await cancel();
    });

    test("A29 — the row under the pointer: a refusal says `✕ why`, its bins outlined warn and its run's label aside; a fit takes it", async () => {
        const c = await open();
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect(row(c, "K-101").hasAttribute("data-drop-invalid")).toBe(true);
        const why = row(c, "K-101").querySelector("[data-allocation-reason]")!;
        expect([why.hasAttribute("data-refused"), why.textContent!.trim(), why.querySelector("[aria-label]")!.getAttribute("aria-label")]).toEqual([true, "over max by 34 m³", "Doesn't fit"]);
        expect(card(c, "3125").getAttribute("data-drop-target")).toBe("refused");
        expect(c.querySelector("[data-run][data-from='0']")!.hasAttribute("data-pointer")).toBe(true);
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["over max by 34 m³", true]);
        await over(row(c, "K-102"), 16);
        expect(card(c, "3125").hasAttribute("data-drop-target")).toBe(false);
        expect(card(c, "3102").getAttribute("data-drop-target")).toBe("refused");
        await cancel();
        expect(c.querySelectorAll("[data-drop-target], [data-run][data-pointer]")).toHaveLength(0);
    });

    test("A31 — the #1 out of view: one marker at the pane's edge, `1 fit below · #1 K-601 · drop here`; a drop on it links there", async () => {
        const c = await open();
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-virtual-rows") ? 700 : 0; });
        await hover(connector(c, "3101"), row(c, "K-101"));
        const marker = c.querySelector<HTMLElement>("[data-allocation-marker]")!;
        expect([marker.getAttribute("data-allocation-marker"), marker.textContent]).toEqual(["below", "1 fit below · #1 K-601 · drop here"]);
        expect(marker.querySelector("svg[data-icon='arrow-down']")).not.toBeNull();
        await over(marker, 16);
        expect(caption()!.textContent).toBe("to K-601 · #1 · under min");
        await release();
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-601");
        expect(c.querySelector("[data-allocation-marker]")).toBeNull();
    });

    test("A39 — a connector dropped on a fitting resource links its quantity there, one draft that Saves; on its own resource nothing", async () => {
        const c = await open();
        await drop(connector(c, "3101"), row(c, "K-209"));
        expect(undo(c)).toHaveProperty("disabled", true);
        await reveal(c, "K-601");
        await drop(connector(c, "3101"), row(c, "K-601"));
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-601");
        expect(card(c, "3101").hasAttribute("data-draft")).toBe(true);
        await press(undo(c));
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-209");
        await press(toolbar(c).getByRole("button", { name: editingMessages.redo() }));
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        expect([...h.read(ex.kilnPlans).get(TUE)!.bins.get("3101")!.parts]).toEqual([["K-601", 35]]);
    });

    test("A40 — a refused drop moves nothing and adds no banner; a connector onto a lane hour is refused `drop on a resource`", async () => {
        const c = await open();
        const banners = slot(c, "banners")?.childElementCount ?? 0;
        await drop(connector(c, "3101"), row(c, "K-101"));
        expect(undo(c)).toHaveProperty("disabled", true);
        expect(slot(c, "banners")?.childElementCount ?? 0).toBe(banners);
        await hover(connector(c, "3101"), c.querySelector("[data-allocation-cell][data-free]")!);
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["drop on a resource", true]);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
    });
});

describe("a card body's drag between lane hours", () => {
    const cell = (c: HTMLElement, lane: string, at: Date) => c.querySelector<HTMLElement>(`[data-allocation-cell="${lane}|${at.getTime()}"]`)!;
    const hour = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));

    test("A24 — free lane hours become dashed targets; A37 — the bin moves to the slot's time; its own hour does nothing", async () => {
        const c = await open();
        await hover(card(c, "3103"), cell(c, "B-2", hour(0, 35)));
        expect(c.querySelector("[data-allocation-timeline]")!.getAttribute("data-allocation-drag")).toBe("body");
        expect(cell(c, "B-2", hour(0, 35)).querySelector("[data-allocation-placeholder]")).not.toBeNull();
        expect(caption()!.textContent).toBe("to B-2 00:35");
        // A body's drag ranks and marks no resource (A24).
        expect(c.querySelectorAll("[data-allocation-rank], [data-refused], [data-run]")).toHaveLength(0);
        await release();
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        const moved = h.read(ex.kilnPlans).get(TUE)!.bins.get("3103")!;
        expect([moved.lane, moved.at, [...moved.parts]]).toEqual(["B-2", hour(0, 35), [["K-109", 24]]]);
        await drop(card(c, "3103"), cell(c, "B-2", hour(0, 35)));
        expect(card(c, "3103").hasAttribute("data-draft")).toBe(false);
    });

    test("A37 — into a slot that holds bins it follows the last of them by a minute", async () => {
        const c = await open();
        await hover(card(c, "3103"), cell(c, "B-3", hour(1, 55)));
        expect(caption()!.textContent).toBe("to B-3 01:57");
        await release();
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        const moved = h.read(ex.kilnPlans).get(TUE)!.bins.get("3103")!;
        expect([moved.lane, moved.at]).toEqual(["B-3", hour(1, 57)]);
    });

    test("§10 — a body onto a resource row is refused: `lane hours only · drag its connector to change the resource`", async () => {
        const c = await open();
        await hover(card(c, "3103"), row(c, "K-101"));
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["lane hours only · drag its connector to change the resource", true]);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
    });
});

describe("the fit's answer on its way, failed, and the app's own (F2–F4)", () => {
    test("F2 — pending, the rows show no verdict and the caption `checking fits…`; a drop waits for the answer, then runs", async () => {
        const c = await open();
        await reveal(c, "K-601");
        const releaseFit = h.fits.hold();
        await hover(connector(c, "3101"), row(c, "K-601"));
        expect(caption()!.textContent).toBe("checking fits…");
        expect(c.querySelectorAll("[data-refused], [data-allocation-rank]")).toHaveLength(0);
        await release();
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-209");
        await act(async () => { releaseFit(); }); await settle();
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-601");
    });

    test("F3 — a failed call: `Fits couldn't be checked` with the function's message and Retry; a drop meanwhile is refused `fits unavailable`", async () => {
        const c = await open();
        h.fits.failure = "the kiln service is down";
        await press(card(c, "3101"));
        expect(slot(c, "banners").textContent).toContain("Fits couldn't be checked");
        expect(slot(c, "banners").textContent).toContain("the kiln service is down");
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["fits unavailable", true]);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
        h.fits.failure = undefined;
        await press(within(slot(c, "banners")).getByRole("button", { name: "Retry" }));
        expect(slot(c, "banners").textContent).not.toContain("Fits couldn't be checked");
    });

    test("F4 — the board follows the function: the yard's bulk rule refuses K-601 a 1 m³ bin the built-in rules take, under min", async () => {
        const rule = await open(ex.allocationFitRule);
        await reveal(rule, "K-601");
        await hover(connector(rule, "3110"), row(rule, "K-601"));
        expect(row(rule, "K-601").hasAttribute("data-drop-invalid")).toBe(true);
        expect(row(rule, "K-601").querySelector("[data-allocation-reason]")!.textContent!.trim()).toBe("bulk kilns take 20 m³ and more");
        expect(caption()!.textContent).toBe("bulk kilns take 20 m³ and more");
        await cancel();
        expect(h.fits.calls.get("yard_fit") ?? 0).toBe(0);
        const minimal = await open(ex.allocationMinimal);
        await reveal(minimal, "K-601");
        await hover(connector(minimal, "3110"), row(minimal, "K-601"));
        expect(row(minimal, "K-601").hasAttribute("data-drop-active")).toBe(true);
        expect([caption()!.textContent!.endsWith("under min"), caption()!.hasAttribute("data-warn")]).toEqual([true, true]);
        await cancel();
    });
});

describe("pointer motion (A35)", () => {
    test("A35 — a drag's pointer motion over the rows repaints no card body, no row and no head: none of them says a quantity again", async () => {
        const c = await open();
        await press(card(c, "3101"));
        await hover(connector(c, "3101"), row(c, "K-101"));
        // Every card, row and lane head draws its quantities through the board's words: none is drawn again.
        const said = vi.spyOn(allocationWords(), "quantity");
        for (const [i, key] of ["K-101", "K-102", "K-103", "K-104", "K-101", "K-102"].entries()) await over(row(c, key), 20 + i);
        expect(said).not.toHaveBeenCalled();
        // The marks still followed the pointer: they are the elements', not a render's.
        expect(card(c, "3102").getAttribute("data-drop-target")).toBe("refused");
        await cancel();
    });
});
