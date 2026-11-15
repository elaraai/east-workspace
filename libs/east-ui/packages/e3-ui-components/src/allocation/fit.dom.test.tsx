/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The board's fit as it is asked (east-workspace#1624), over the kiln yard's
 * records on e3: a request is the plan day, the question and the page's scope,
 * and no row (rule 1); the call carries the board's unsaved edits as drafts,
 * which the yard's function reads laid over the bins and nothing saves; a
 * question about the day as it would be — a bin's arrival cell asking of the
 * day without it, a free slot's probe reservation, a removed bin back on it —
 * carries that change as one more draft of the bins' record, laid after the
 * pending Save, and a record that refuses it gives the question no answer
 * (rule 10); and a subject an answer names no verdict for has none: a drop on
 * it is refused, and each Chooser leaves it out (rule 6). When the board asks
 * — a draft, a record committed under it — is `drag.dom.test.tsx`'s (F1), and
 * a record that changed under the edits the shared fit's, which the Roster's
 * `fit.dom.test.tsx` holds on e3 (rule 12).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { TUE, act, allocationHarness, kilnYard, offering, settle, slot, type Example, type FitRequest, type FitResult } from "./harness.test-utils.js";
import { dayKey } from "./model.js";
import { RESERVE_PROBE } from "./table.js";

const h = allocationHarness();
const byKey = compareFor(StringType);
const BINS = ex.kilnBins.name;
const at = (hh: number, mm: number) => new Date(Date.UTC(2027, 4, 11, hh, mm));
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
const binRow = (c: HTMLElement, id: string) => row(c, `bin:${id}`);
const freeRow = (c: HTMLElement, lane: string, when: Date) => row(c, `slot:${lane}|${dayKey(when)}`);
const arrivalCell = (r: HTMLElement) => r.querySelector<HTMLElement>("[data-allocation-cell-side=arrival]")!;
const resourceCell = (r: HTMLElement) => r.querySelector<HTMLElement>("[data-allocation-cell-side=resource]")!;
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`)!;
const connector = (c: HTMLElement, id: string) => card(c, id).querySelector<HTMLElement>("[data-allocation-connector]")!;
const resourceRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`)!;
const caption = () => document.querySelector<HTMLElement>("[data-drag-caption]");
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const failure = (c: HTMLElement) => within(slot(c, "banners")).queryAllByRole("alert").find(el => el.textContent?.includes("Fits couldn't be checked"));
const commits = async (record: { readonly name: string }) => (await h.history(record)).commits.map(commit => commit.mutation);
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
/** An example mounted over a store of its own, where each source's state is kept. */
async function open(example: Example = ex.allocationTable) {
    const store = new UIStore(); StateRuntime.initializeStore(store);
    const r = await h.mount(example);
    return { c: r.container, store };
}
/** A source's narrowing written as the rail writes it: one field's values. */
async function narrow(store: UIStore, example: string, source: "kilns", field: string, values: readonly string[]) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none,
        where: new Map([[field, variant("values", values.map(v => printFor(StringType)(v)))]]) })); });
    await settle();
}
/** A cell's Chooser, opened: its options by their labels, each with its line. */
async function choose(cell: HTMLElement) {
    await press(cell.querySelector<HTMLElement>("[aria-haspopup=listbox]"));
    await settle();
    return chooser();
}
function chooser() {
    const list = document.querySelector<HTMLElement>("[data-chooser]")!;
    const label = (o: Element) => o.querySelector("span:nth-child(2) > span:first-child")!.textContent;
    return {
        labels: () => [...list.querySelectorAll("[role=option]")].map(label),
        option: (name: string) => [...list.querySelectorAll<HTMLElement>("[role=option]")].find(o => label(o) === name),
    };
}
/** Closes an open Chooser. */
async function dismiss() { await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" }); }); await settle(); }
/** Picks a grip up and brings it over a target, past the 5px a drag waits for. */
async function hover(from: Element, into: Element) {
    expect(from).not.toBeNull(); expect(into).not.toBeNull();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 12, clientY: 12 }); });
    await settle();
}
async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 14, clientY: 12 }); }); await settle(); }
type Ask = FitRequest["ask"];
const isTake = (resource: string) => (ask: Ask) => ask.type === "take" && ask.value.resource === resource;
const isPlace = (bin: string) => (ask: Ask) => ask.type === "place" && ask.value.subject.type === "bin" && ask.value.subject.value === bin;
/**
 * The fit's latest call of a question — a row's Chooser asks its own, and the row it selects another: what it asked,
 * the drafts it carried, each one's record and mutation, and e3's answer to it.
 */
function called(pick: (ask: Ask) => boolean) {
    const asked = h.fits.requests(), drafts = h.fits.drafts();
    let at = -1;
    asked.forEach((request, i) => { if (pick(request.ask)) at = i; });
    expect(at).toBeGreaterThanOrEqual(0);
    const answer = [...(h.fits.answers() as FitResult[])].reverse().find(result => pick(result.ask));
    return { request: asked[at]!, drafts: drafts[at]!, answer };
}
const PATCH = { record: BINS, mutation: "patch" };
/** Books an arrival into a free row from its arrival cell's Chooser, under the key the test offers as it is minted. */
async function book(c: HTMLElement, lane: string, when: Date, arrival: string, key: string) {
    const list = await choose(arrivalCell(freeRow(c, lane, when)));
    offering([key]);
    await press(list.option(arrival));
}

describe("what an ask sends (rule 1)", () => {
    test("a request holds the day, the question and the scope, and no row; with nothing unsaved a question of the day as it stands carries no draft; a choice on the rail asks nothing again", async () => {
        const { c, store } = await open();
        await choose(resourceCell(binRow(c, "3102")));
        const { request, drafts, answer } = called(isPlace("3102"));
        expect(Object.keys(request).sort()).toEqual(["ask", "day", "scope"]);
        expect([request.day, request.ask, request.scope.size]).toEqual([TUE, variant("place", { subject: variant("bin", "3102"), quantity: 27 }), 0]);
        expect(drafts).toEqual([]);
        // The yard's function read the day's bins and every kiln for itself: a verdict for each of the 33.
        expect(answer!.resources.size).toBe(33);
        await dismiss();
        const asked = h.fits.calls();
        // A choice on the rail: the Chooser offers what the rail shows of the same answer, and nothing is asked.
        await narrow(store, "allocationTable", "kilns", "group", ["Hall A"]);
        await waitFor(() => expect(binRow(c, "3102")).not.toBeNull());
        const narrowed = await choose(resourceCell(binRow(c, "3102")));
        expect(narrowed.labels().length).toBeGreaterThan(0);
        expect(h.fits.calls()).toBe(asked);
    });

    test("a scoped page's request carries its scope: the halls the page holds its kilns to, as East prints them", async () => {
        const { c } = await open(kilnYard({ halls: ["Hall A"] }));
        await press(card(c, "3101"));
        await waitFor(() => expect(h.fits.calls()).toBe(1));
        const scope = called(isPlace("3101")).request.scope;
        expect([...scope.keys()]).toEqual(["kilns"]);
        expect([...scope.get("kilns")!]).toEqual([["group", variant("values", [printFor(StringType)("Hall A")])]]);
    });
});

describe("the board's unsaved edits, seen and not saved", () => {
    test("an unsaved bin's part counts in its kiln's load, and a place of an unsaved bin is answered; the bins' record is as it was", async () => {
        const { c } = await open();
        const before = await commits(ex.kilnBins);
        // LD-2231's 21 m³ booked into B-1 at 00:15, and not saved: its row's resource cell asks where the unsaved bin can go.
        await book(c, "B-1", at(0, 15), "LD-2231", "N1");
        const fits = await choose(resourceCell(binRow(c, "N1")));
        const placed = called(isPlace("N1"));
        expect([placed.request.ask, placed.drafts, placed.answer?.resources.get("K-107")?.type])
            .toEqual([variant("place", { subject: variant("bin", "N1"), quantity: 21 }), [PATCH], "fits"]);
        // Onto K-107, which takes 12–24 m³: still not saved.
        await press(fits.option("K-107"));
        // LD-2236's 11 m³ next: the function reads the unsaved 21 m³ on K-107, and refuses it there.
        await book(c, "B-2", at(0, 35), "LD-2236", "N2");
        await choose(resourceCell(binRow(c, "N2")));
        const refused = called(isPlace("N2")).answer?.resources.get("K-107");
        expect(refused?.type === "refused" ? refused.value.reason : refused).toBe("over max by 8 m³");
        // Nothing was saved: no commit was made, and the record holds neither bin.
        expect(await commits(ex.kilnBins)).toEqual(before);
        const bins = await h.read(ex.kilnBins);
        expect([bins.has("N1"), bins.has("N2")]).toEqual([false, false]);
    });
});

describe("an answer that names fewer (rule 6)", () => {
    test("a resource the answer names no verdict for is left out of a resource cell's Chooser, and an arrival out of an arrival cell's", async () => {
        const { c } = await open();
        // A function that considers fewer: its answers name neither K-601 nor LD-2231.
        const fewer = h.fits.answer((made) => ({
            ...made,
            resources: new SortedMap([...made.resources].filter(([key]) => key !== "K-601"), byKey),
            arrivals: new SortedMap([...made.arrivals].filter(([key]) => key !== "LD-2231"), byKey),
        }));
        // Bin 3101's resource cell: K-601, an open gap that fits it, is not offered — the answer names no verdict for it.
        const resources = await choose(resourceCell(binRow(c, "3101")));
        expect(called(isPlace("3101")).answer!.resources.has("K-601")).toBe(false);
        expect([resources.labels().includes("K-209"), resources.labels().length > 1, resources.labels().includes("K-601")]).toEqual([true, true, false]);
        await dismiss();
        // What K-209 takes without bin 3101: every load still to book but LD-2231, which the answer does not name.
        const arrivals = await choose(arrivalCell(binRow(c, "3101")));
        expect(called(isTake("K-209")).answer!.arrivals.has("LD-2231")).toBe(false);
        expect([arrivals.labels().includes("LD-2232"), arrivals.labels().includes("LD-2231")]).toEqual([true, false]);
        fewer();
    });

    test("a drop on a resource the answer names no verdict for is refused in the fit's words", async () => {
        const { c } = await open(kilnYard());
        const fewer = h.fits.answer((made) => ({ ...made, resources: new SortedMap([...made.resources].filter(([key]) => key !== "K-102"), byKey) }));
        await hover(connector(c, "3101"), resourceRow(c, "K-102"));
        await waitFor(() => expect(caption()!.textContent).toBe("no verdict from the fit"));
        await release();
        expect(card(c, "3101").querySelector("[data-allocation-to]")!.textContent).toBe("K-209");
        fewer();
    });
});

describe("a plan the board derives (rule 10)", () => {
    test("a bin's arrival cell asks of the day without it, and a free slot of the day with a probe reservation: each change one draft of the bins' record, after the pending Save where there is one", async () => {
        const { c } = await open();
        // The day without bin 3101: what K-209 takes then. Nothing is unsaved, so the derived change is the call's one draft.
        await choose(arrivalCell(binRow(c, "3101")));
        const without = called(isTake("K-209"));
        expect(without.drafts).toEqual([PATCH]);
        // Without it LD-2201 is a load to book again, as the function reads the day.
        expect(without.answer!.arrivals.has("LD-2201")).toBe(true);
        await dismiss();
        // A free slot's probe reservation: the function reads it among the day's bins, and answers for it.
        await choose(resourceCell(freeRow(c, "B-1", at(0, 15))));
        const probe = called(isPlace(RESERVE_PROBE));
        expect([probe.request.ask, probe.drafts, probe.answer?.resources.size]).toEqual([variant("place", { subject: variant("bin", RESERVE_PROBE), quantity: 0 }), [PATCH], 33]);
        await dismiss();
        // With an unsaved edit — bin 3103 unlinked — the pending Save goes first, and the derived change after it.
        await press(within(binRow(c, "3103")).getByRole("button", { name: "Unlink LD-2203 from K-109" }));
        await choose(arrivalCell(binRow(c, "3102")));
        expect(called(isTake("K-102")).drafts).toEqual([PATCH, PATCH]);
        // Nothing of it was saved.
        expect((await h.read(ex.kilnBins)).has(RESERVE_PROBE)).toBe(false);
    });

    test("a removed bin asked of the day with it back on, unlinked: the removal is the pending Save, and the bin back the draft after it", async () => {
        const { c } = await open(kilnYard());
        await press(card(c, "3113"));
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Delete" }); }); await settle();
        const removed = c.querySelector<HTMLElement>('[data-allocation-library="arrivals"] [data-library-item="removed:3113"]');
        const asked = h.fits.calls();
        await press(removed);
        await waitFor(() => expect(h.fits.calls()).toBe(asked + 1));
        const back = called(isPlace("3113"));
        expect([back.request.ask, back.drafts]).toEqual([variant("place", { subject: variant("bin", "3113"), quantity: 32 }), [PATCH, PATCH]]);
        // Back on the day unlinked, its 32 m³ are on no kiln: K-108, which held them, is free for them again.
        expect(back.answer?.resources.get("K-108")?.type).toBe("fits");
    });

    test("a derived change the record refuses gives that question no answer, and shows as a failed fit; a question of the day as it stands is answered", async () => {
        const { c } = await open(kilnYard({ locked: "bins" }));
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        // The day as it stands: no draft, and the locked bins' fit answers.
        await choose(resourceCell(binRow(c, "3101")));
        expect([h.fits.outcomes(ex.yardLockedFit.name).every(outcome => outcome === "success"), called(isPlace("3101")).drafts]).toEqual([true, []]);
        const answered = h.fits.answers(ex.yardLockedFit.name).length;
        await dismiss();
        // A free slot's probe reservation is one more bin laid over the record, which refuses every change.
        await choose(resourceCell(freeRow(c, "B-1", at(0, 15))));
        const banner = await waitFor(() => { const el = failure(c); expect(el).toBeTruthy(); return el!; });
        expect(banner.textContent).toContain("the yard's bins are locked for the day");
        expect(called(isPlace(RESERVE_PROBE)).drafts).toEqual([{ record: ex.kilnLockedBins.name, mutation: "patch" }]);
        expect([h.fits.outcomes(ex.yardLockedFit.name).at(-1), h.fits.answers(ex.yardLockedFit.name).length]).toEqual(["failed", answered]);
    });
});
