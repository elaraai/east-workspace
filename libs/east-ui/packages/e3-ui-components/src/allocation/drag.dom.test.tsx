/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board's drags on the Timeline (#1328) over the kiln yard, through the
 * shared drag layer and the yard's fit served by name through the `Func`
 * runtime: when the board asks the fit, the refusing runs, the three best fits
 * and their previews, the row under the pointer, the fits marker, the caption,
 * every drop's outcome, and a link's drag with the links it draws. Every word
 * and figure the mock draws for the same drag is the mock's.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { FloatType, SortedMap, StringType, compareFor, none, variant, type ValueTypeOf } from "@elaraai/east";
import { AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { pointAt, press as key, stubScrollIntoView, tick } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, settle, slot, stubLinkGeometry, TUE } from "./harness.test-utils.js";
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
async function open(example: { fn: { toIR(): unknown } } = ex.allocationMinimal) { const r = await h.mount(example); return r.container; }
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
const answer = (name = "yard_fit") => h.fits.answers(name).at(-1) as FitResult;
const timeline = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-allocation-timeline]")!;
const linkCaption = (c: HTMLElement, bin: string, resource: string) => c.querySelector<SVGGElement>(`[data-allocation-caption="${bin}|${resource}"]`)!;
const linkLine = (c: HTMLElement, bin: string, resource: string) => c.querySelector<SVGPathElement>(`[data-allocation-link="${bin}|${resource}"]`)!;
/** The links the layer draws, in its order: each one's bin and resource, its tone, and whether it is the `was` line. */
const drawn = (c: HTMLElement) => [...c.querySelectorAll("[data-allocation-links] [data-plan-link]")]
    .map(g => [g.querySelector("[data-link]")!.getAttribute("data-allocation-link"), g.getAttribute("data-tone"), g.hasAttribute("data-was")] as const);
/** The new line that follows the pointer (A69): its band and its head. */
const newLine = (c: HTMLElement) => {
    const g = c.querySelector("[data-allocation-link-lines] [data-plan-link-preview]");
    return g === null ? undefined : [g.querySelector("[data-plan-ribbon-band]")!.getAttribute("d"), g.querySelector("[data-plan-ribbon-head]")!.getAttribute("d")];
};
/**
 * Picks a grip up with its button held, as a hand carries a drag, and brings
 * it to a point over a target: the window's px, the links' layer 48px under the
 * board's top (`stubLinkGeometry`).
 */
async function carry(from: Element, into: Element, x: number, y: number) {
    expect(from).not.toBeNull(); expect(into).not.toBeNull();
    await act(async () => {
        pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: x - 12, clientY: y });
        pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x - 6, clientY: y });
    });
    await settle();
    await moveTo(into, x, y);
}
/** Moves the pointer carrying a drag to a point over a target, or over nothing. */
async function moveTo(into: Element | null, x: number, y: number) {
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x, clientY: y }); });
    await settle();
}
/** A reservation of a lane hour on a resource, in the day as the record holds it. */
async function reserve(id: string, lane: string, at: Date, resource: string) {
    const plans = await h.read(ex.kilnPlans);
    plans.get(TUE)!.bins.set(id, { lane, at, event: none, quantity: 0, kind: none, hold: variant("days", 0),
        parts: new SortedMap([[resource, 0]], compareFor(StringType)), values: { specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none } });
    await h.patch(ex.kilnPlans, plans);
}
/** A kiln's minimum changed in the record, as another session's commit lands under the board. */
async function setMinimum(key: string, min: number) {
    const kilns = await h.read(ex.kilns);
    kilns.set(key, { ...kilns.get(key)!, min });
    await h.patch(ex.kilns, kilns);
}
/** An answer's reason for a resource it fits. */
const whyOf = (a: FitResult, key: string) => { const fit = a.resources.get(key); return fit?.type === "fits" ? fit.value.why : undefined; };
/** The resources an answer refuses, and its three best fits, the current resource excepted. */
const refusedBy = (a: FitResult) => [...a.resources].filter(([, f]) => f.type === "refused").map(([k]) => k);
const bestOf = (a: FitResult, current: string) => [...a.resources].flatMap(([k, f]) => f.type === "fits" && k !== current ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).slice(0, 3).map(f => f.k);

describe("when the board asks the fit (F1, A23)", () => {
    test("A23 — the selected bin's question is asked before a drag needs it; A35 — once per question, however far a drag goes", async () => {
        const c = await open();
        expect(h.fits.calls("yard_fit")).toBe(0);
        await press(card(c, "3101"));
        expect(h.fits.calls("yard_fit")).toBe(1);
        expect(answer().ask).toEqual(variant("place", { subject: variant("bin", "3101"), quantity: 35 }));
        // Its connector's drag asks the same question: answered already.
        await hover(connector(c, "3101"), row(c, "K-101"));
        for (const key of ["K-102", "K-103", "K-104", "K-105", "K-201", "K-202"]) await over(row(c, key));
        expect(h.fits.calls("yard_fit")).toBe(1);
        await cancel();
    });

    test("F1 — a draft asks again: the drafts changed, the kept answer is not theirs", async () => {
        const c = await open();
        await press(card(c, "3101"));
        expect(h.fits.calls("yard_fit")).toBe(1);
        // A move selects its bin: its question, of the new drafts.
        await drop(card(c, "3103"), c.querySelector(`[data-allocation-cell="B-2|${Date.UTC(2027, 4, 11, 0, 35)}"]`)!);
        expect(h.fits.calls("yard_fit")).toBe(2);
        await press(card(c, "3101"));
        expect(h.fits.calls("yard_fit")).toBe(3);
    });

    test("F1 — a record the board reads, committed under it, asks again of the same drafts: the kept answer was of the kilns as they were", async () => {
        const c = await open();
        // A draft first: the day as drafted is the session's, whatever the record under it does.
        await drop(card(c, "3103"), c.querySelector(`[data-allocation-cell="B-2|${Date.UTC(2027, 4, 11, 0, 35)}"]`)!);
        await press(card(c, "3101"));
        const asked = h.fits.calls("yard_fit");
        expect(whyOf(answer(), "K-601")?.startsWith("open gap · leaves 35 m³ · min 40 · 5 short")).toBe(true);
        // Another session lowers K-601's minimum: LD-2201's 35 m³ there no longer leaves it short.
        await setMinimum("K-601", 30);
        await reveal(c, "K-601");
        expect([row(c, "K-601").textContent, card(c, "3103").hasAttribute("data-draft")]).toEqual([expect.stringContaining("takes 30–60 m³"), true]);
        expect(h.fits.calls("yard_fit")).toBe(asked + 1);
        expect(whyOf(answer(), "K-601")?.startsWith("open gap · leaves 35 m³ · takes 30–60")).toBe(true);
        // Its connector's drag shows that answer, and asks nothing more.
        await hover(connector(c, "3101"), row(c, "K-601"));
        expect(row(c, "K-601").querySelector("[data-allocation-reason]")!.textContent).toBe(whyOf(answer(), "K-601"));
        expect(h.fits.calls("yard_fit")).toBe(asked + 1);
        await cancel();
    });

    test("F1 — committed under the board while its question is on its way, the question is asked again of what the board reads once that answer lands", async () => {
        const c = await open();
        await drop(card(c, "3103"), c.querySelector(`[data-allocation-cell="B-2|${Date.UTC(2027, 4, 11, 0, 35)}"]`)!);
        const answerFit = h.fits.hold();
        await press(card(c, "3101"));
        const asked = h.fits.calls("yard_fit");
        await setMinimum("K-601", 30);
        // One question in flight at a time: the board's next waits for it.
        expect(h.fits.calls("yard_fit")).toBe(asked);
        await act(async () => { answerFit.release(); }); await settle();
        // That answer was of the kilns as they were: the same question, asked again of these.
        expect(h.fits.calls("yard_fit")).toBe(asked + 1);
        expect(whyOf(answer(), "K-601")?.startsWith("open gap · leaves 35 m³ · takes 30–60")).toBe(true);
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

    test("A31, A26 — the #1 out of view: one marker at the pane's edge, `1 fit below · #1 K-601 · drop here`; a drop on it links there", async () => {
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
        expect([...(await h.read(ex.kilnPlans)).get(TUE)!.bins.get("3101")!.parts]).toEqual([["K-601", 35]]);
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

    test("A26 — the drop target is the element under the pointer: a lane hour, a card, a resource row and the fits marker each take the drop as their own", async () => {
        const c = await open();
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-virtual-rows") ? 700 : 0; });
        const hour = c.querySelector<HTMLElement>("[data-allocation-cell][data-free]")!;
        await hover(connector(c, "3101"), hour);
        expect([hour.hasAttribute("data-drop-invalid"), caption()!.textContent]).toEqual([true, "drop on a resource"]);
        // A card is its lane hour's target, so a connector's drop there is refused as the hour's is.
        await over(card(c, "3102"), 16);
        expect([hour.hasAttribute("data-drop-invalid"), card(c, "3102").hasAttribute("data-drop-invalid"), caption()!.textContent]).toEqual([false, true, "drop on a resource"]);
        await over(row(c, "K-101"), 18);
        expect([card(c, "3102").hasAttribute("data-drop-invalid"), row(c, "K-101").hasAttribute("data-drop-invalid"), caption()!.textContent]).toEqual([false, true, "over max by 34 m³"]);
        const marker = c.querySelector<HTMLElement>("[data-allocation-marker]")!;
        await over(marker, 20);
        expect([row(c, "K-101").hasAttribute("data-drop-invalid"), marker.hasAttribute("data-drop-active"), caption()!.textContent]).toEqual([false, true, "to K-601 · #1 · under min"]);
        await release();
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-601");
    });

    test("A29 — the drag gone from a row, into the channel or onto nothing, lets its marks go: no bin outlined, its run's label back", async () => {
        const c = await open();
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect([card(c, "3125").getAttribute("data-drop-target"), c.querySelector("[data-run][data-from='0']")!.hasAttribute("data-pointer")]).toEqual(["refused", true]);
        await over(c.querySelector("[data-allocation-channel]")!, 16);
        expect(c.querySelectorAll("[data-drop-target], [data-run][data-pointer]")).toHaveLength(0);
        await over(row(c, "K-102"), 18);
        expect(card(c, "3102").getAttribute("data-drop-target")).toBe("refused");
        await act(async () => { pointAt(null); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 12 }); });
        await settle();
        expect(c.querySelectorAll("[data-drop-target], [data-run][data-pointer]")).toHaveLength(0);
        await cancel();
    });
});

describe("a drag's start (A22)", () => {
    test("A22 — a press that travels short of a drag's start is a click: no drag, no ghost, nothing moved; the click selects", async () => {
        const c = await open();
        const body = card(c, "3103");
        await act(async () => {
            pointAt(body); fireEvent.pointerDown(body, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 });
            fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 2, clientY: 1 });
        });
        await settle();
        expect([timeline(c).hasAttribute("data-allocation-drag"), document.querySelector("[data-drag-ghost]")]).toEqual([false, null]);
        await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 2, clientY: 1 }); fireEvent.click(body); });
        await settle();
        expect([card(c, "3103").getAttribute("aria-pressed"), undo(c).hasAttribute("disabled")]).toEqual(["true", true]);
    });

    test("A22 — as a drag goes nothing above the board comes or goes: a fit that fails during the drag says so once it is dropped", async () => {
        const c = await open();
        const banners = () => slot(c, "banners")?.textContent ?? "";
        // e3 cannot serve the fit: it answers each call 503, unavailable.
        h.fits.fail();
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["fits unavailable", true]);
        expect(banners()).not.toContain("Fits couldn't be checked");
        await over(row(c, "K-102"), 16);
        expect(banners()).not.toContain("Fits couldn't be checked");
        await release();
        expect(banners()).toContain("Fits couldn't be checked");
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
        const moved = (await h.read(ex.kilnPlans)).get(TUE)!.bins.get("3103")!;
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
        const moved = (await h.read(ex.kilnPlans)).get(TUE)!.bins.get("3103")!;
        expect([moved.lane, moved.at]).toEqual(["B-3", hour(1, 57)]);
    });

    test("§10 — a body onto a resource row is refused: `lane hours only · drag its connector to change the resource`", async () => {
        const c = await open();
        await hover(card(c, "3103"), row(c, "K-101"));
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["lane hours only · drag its connector to change the resource", true]);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
    });

    test("A38 — a bin dropped on a reservation fills it: the bin takes its lane, its time and its resource, and the reservation goes", async () => {
        const c = await open();
        await reserve("R1", "B-1", hour(0, 15), "K-601");
        await hover(card(c, "3103"), card(c, "R1"));
        expect([card(c, "R1").hasAttribute("data-drop-active"), caption()!.textContent]).toEqual([true, "into the reservation on K-601 · under min"]);
        await release();
        expect(card(c, "R1")).toBeNull();
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        const day = (await h.read(ex.kilnPlans)).get(TUE)!;
        const filled = day.bins.get("3103")!;
        expect([filled.lane, filled.at, [...filled.parts], day.bins.has("R1")]).toEqual(["B-1", hour(0, 15), [["K-601", 24]], false]);
    });

    test("A38 — a reservation whose resource refuses the bin says why, and takes nothing", async () => {
        const c = await open();
        await reserve("R2", "B-2", hour(0, 35), "K-101");
        await hover(card(c, "3103"), card(c, "R2"));
        expect([card(c, "R2").hasAttribute("data-drop-invalid"), caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual([true, "over max by 23 m³", true]);
        await release();
        expect([undo(c).hasAttribute("disabled"), card(c, "R2") !== null, card(c, "3103").querySelector("[data-allocation-to]")!.textContent]).toEqual([true, true, "K-109"]);
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
        await act(async () => { releaseFit.release(); }); await settle();
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-601");
    });

    test("F3 — a failed call: `Fits couldn't be checked` with the call's message and Retry; a drop meanwhile is refused `fits unavailable`", async () => {
        const c = await open();
        // e3 cannot serve the fit: it answers each call 503, unavailable.
        const failing = h.fits.fail();
        await press(card(c, "3101"));
        expect(slot(c, "banners").textContent).toContain("Fits couldn't be checked");
        // What e3's client makes of the answer.
        expect(slot(c, "banners").textContent).toContain("API error: unavailable");
        await hover(connector(c, "3101"), row(c, "K-101"));
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["fits unavailable", true]);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
        failing();
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
        expect(h.fits.calls("yard_fit")).toBe(0);
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

    test("A35 — a link's drag: the new line and the drag's families follow the pointer, and no card body, no row and no head says a quantity again", async () => {
        stubLinkGeometry();
        const c = await open();
        await press(row(c, "K-202"));
        await carry(linkCaption(c, "3123", "K-202"), row(c, "K-101"), 600, 300);
        const said = vi.spyOn(allocationWords(), "quantity");
        for (const [i, key] of ["K-102", "K-105", "K-201", "K-101"].entries()) await moveTo(row(c, key), 610 + i * 10, 336 + i * 36);
        expect(said).not.toHaveBeenCalled();
        // The line's head is at the pointer, (640, 444) in the window; K-101's family drawn for it, its bin outlined.
        expect(newLine(c)![1]).toBe("M 631.0 390.0 L 640.0 396.0 L 631.0 402.0 Z");
        expect(drawn(c).filter(([link]) => link!.endsWith("|K-101")).map(([, tone]) => tone)).toEqual(["refused"]);
        expect(card(c, "3125").getAttribute("data-drop-target")).toBe("refused");
        await cancel();
    });
});

describe("a link's drag (A69, A65)", () => {
    test("A69 — a link's line and its caption are grips, a reservation's line too; a link is one control, its caption: Enter selects the link, Space picks it up", async () => {
        stubLinkGeometry(); stubScrollIntoView();
        const c = await open();
        await reserve("R1", "B-1", new Date(Date.UTC(2027, 4, 11, 0, 15)), "K-202");
        await press(row(c, "K-202"));
        const grip = (el: Element) => [el.hasAttribute("data-allocation-grip"), el.getAttribute("role"), el.getAttribute("aria-roledescription"), el.getAttribute("tabindex")];
        expect(grip(linkCaption(c, "3123", "K-202"))).toEqual([true, "button", "draggable", "0"]);
        // Its line holds the drag for the pointer alone: no second control of the same name.
        expect(grip(linkLine(c, "3123", "K-202"))).toEqual([true, null, null, null]);
        // A reservation's link has no caption: its line is its grip, and its control.
        expect(linkCaption(c, "R1", "K-202")).toBeNull();
        expect(grip(linkLine(c, "R1", "K-202"))).toEqual([true, "button", "draggable", "0"]);
        await act(async () => { linkCaption(c, "3123", "K-202").focus(); });
        await act(async () => { fireEvent.keyDown(linkCaption(c, "3123", "K-202"), { key: "Enter", code: "Enter" }); });
        await settle();
        expect([linkCaption(c, "3123", "K-202").hasAttribute("data-selected"), timeline(c).hasAttribute("data-allocation-drag")]).toEqual([true, false]);
        // Space picks the link up: its families draw, its own link the `was` line; a keyboard's drag has no pointer for a new line to follow.
        await act(async () => { linkCaption(c, "3123", "K-202").focus(); });
        key("Space"); await tick(); await settle();
        expect(timeline(c).getAttribute("data-allocation-drag")).toBe("link");
        expect(drawn(c).find(([link]) => link === "3123|K-202")).toEqual(["3123|K-202", null, true]);
        expect(newLine(c)).toBeUndefined();
        key("Escape"); await tick(); await settle();
        expect(timeline(c).hasAttribute("data-allocation-drag")).toBe(false);
    });

    test("A69 — a link's drag: its link fades to its `was` line, the new line follows the pointer from its card; dropped on a fitting row it re-links its part, one draft that Saves", async () => {
        stubLinkGeometry();
        const c = await open();
        await press(row(c, "K-202"));
        // LD-2219's 22 m³ on K-202, the B-3 20:55 bin: its card's right edge at 342, its middle 954 down the layer — row 26's, below the panes' view.
        await carry(linkCaption(c, "3123", "K-202"), row(c, "K-107"), 600, 300);
        expect(timeline(c).getAttribute("data-allocation-drag")).toBe("link");
        expect(drawn(c)).toEqual([["3126|K-202", null, false], ["3123|K-202", null, true]]);
        // Out of its card, up the riser past the card's own row, to the pointer at (600, 252) in the layer, into a 9 × 12 head.
        expect(newLine(c)).toEqual([
            "M 342.0 954.0 L 360.0 954.0 A 8.0 8.0 0 0 0 368.0 946.0 L 368.0 260.0 A 8.0 8.0 0 0 1 376.0 252.0 L 592.0 252.0",
            "M 591.0 246.0 L 600.0 252.0 L 591.0 258.0 Z",
        ]);
        await moveTo(row(c, "K-107"), 650, 320);
        expect(newLine(c)![1]).toBe("M 641.0 266.0 L 650.0 272.0 L 641.0 278.0 Z");
        // The ghost says the part it carries; the caption, the drop's verdict.
        expect([document.querySelector("[data-drag-ghost]")!.textContent, caption()!.textContent]).toEqual(["LD-2219 · 22 m³", "to K-107 · #1"]);
        await release();
        expect(c.querySelector("[data-allocation-link-lines]")).toBeNull();
        expect([card(c, "3123").querySelector("[data-allocation-to]")!.textContent, card(c, "3123").hasAttribute("data-draft")]).toEqual(["K-107", true]);
        // The drop selects its bin: the focus its new resource, its link there a draft's.
        expect([card(c, "3123").getAttribute("aria-pressed"), drawn(c)]).toEqual(["true", [["3123|K-107", "draft", false]]]);
        await press(toolbar(c).getByRole("button", { name: editingMessages.apply() }));
        expect([...(await h.read(ex.kilnPlans)).get(TUE)!.bins.get("3123")!.parts]).toEqual([["K-107", 22]]);
    });

    test("A69 — a link dropped on the fits marker goes to the #1", async () => {
        stubLinkGeometry();
        const c = await open();
        vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-virtual-rows") ? 700 : 0; });
        await press(row(c, "K-202"));
        // The rows scrolled past K-107, LD-2219's #1; its link picked up by its line.
        await reveal(c, "K-601");
        await carry(linkLine(c, "3123", "K-202"), row(c, "K-601"), 600, 300);
        const marker = c.querySelector<HTMLElement>("[data-allocation-marker]")!;
        expect([marker.getAttribute("data-allocation-marker"), marker.textContent]).toEqual(["above", "1 fit above · #1 K-107 · drop here"]);
        await moveTo(marker, 610, 300);
        expect(caption()!.textContent).toBe("to K-107 · #1");
        await release();
        expect(card(c, "3123").querySelector("[data-allocation-to]")!.textContent).toBe("K-107");
    });

    test("A69 — a link dropped on a row that refuses it moves nothing, its caption the fit's reason; by its line onto its own resource, nothing", async () => {
        stubLinkGeometry();
        const c = await open();
        await press(row(c, "K-202"));
        await carry(linkCaption(c, "3123", "K-202"), row(c, "K-201"), 600, 300);
        expect([caption()!.textContent, caption()!.hasAttribute("data-refused")]).toEqual(["over max by 17 m³", true]);
        await release();
        expect([undo(c).hasAttribute("disabled"), card(c, "3123").querySelector("[data-allocation-to]")!.textContent]).toEqual([true, "K-202"]);
        await carry(linkLine(c, "3123", "K-202"), row(c, "K-202"), 600, 300);
        expect([timeline(c).getAttribute("data-allocation-drag"), caption()!.textContent]).toEqual(["link", "already on it"]);
        await release();
        expect(undo(c)).toHaveProperty("disabled", true);
    });

    test("A65 — during a drag, the dragged bin's resource's family and the target's: ink-2 where the drop fits, warn where it refuses, plain while the fit is on its way; over its own resource, its own family alone", async () => {
        stubLinkGeometry();
        const c = await open();
        await press(row(c, "K-304"));
        const answerFit = h.fits.hold();
        // LD-2210's 1 m³ part on K-304 over K-202, which holds LD-2219 and LD-2221: while the fit is asked, plain.
        await carry(linkCaption(c, "3110", "K-304"), row(c, "K-202"), 600, 300);
        const family = (key: string) => drawn(c).filter(([link]) => link!.endsWith(`|${key}`));
        expect(family("K-202")).toEqual([["3123|K-202", null, false], ["3126|K-202", null, false]]);
        await act(async () => { answerFit.release(); }); await settle();
        expect(family("K-202")).toEqual([["3123|K-202", "fits", false], ["3126|K-202", "fits", false]]);
        // The dragged bin's resource's family plain, before the target's; its own link last, the `was` line.
        expect(family("K-304")).toEqual([["3106|K-304", null, false], ["3112|K-304", null, false], ["3114|K-304", null, false], ["3121|K-304", null, false], ["3110|K-304", null, true]]);
        expect(drawn(c).map(([link]) => link)).toEqual(["3106|K-304", "3112|K-304", "3114|K-304", "3121|K-304", "3123|K-202", "3126|K-202", "3110|K-304"]);
        await moveTo(row(c, "K-105"), 610, 300);
        expect([family("K-202"), family("K-105")]).toEqual([[], [["3124|K-105", "refused", false]]]);
        await moveTo(row(c, "K-304"), 620, 300);
        expect(drawn(c).map(([link, tone]) => [link, tone])).toEqual([["3106|K-304", null], ["3112|K-304", null], ["3114|K-304", null], ["3121|K-304", null], ["3110|K-304", null]]);
        await cancel();
        // A body's drag: its bin's resource's family alone, plain, wherever it goes.
        await hover(card(c, "3110"), row(c, "K-202"));
        expect(drawn(c)).toEqual([["3106|K-304", null, false], ["3110|K-304", null, false], ["3112|K-304", null, false], ["3114|K-304", null, false], ["3121|K-304", null, false]]);
        await cancel();
    });
});
