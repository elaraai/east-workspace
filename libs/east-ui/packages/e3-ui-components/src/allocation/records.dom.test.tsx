/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Allocation over the app's own records (#1372, `Builder Interfaces Spec.md`
 * §7, §8): each record it writes — the bins, the days — is a session of one
 * history, on e3 itself. A gesture that writes several bins is one step and
 * one request (B5); Save sends each record's changes as its own request, the
 * days' door refusing keeping the day's draft while the bins' commit stands
 * (B6); Publish saves, then writes the day's status, and a Save that fails
 * writes no status (B7); a published day is read-only in every layout, phones
 * included (B8); and a new bin's key is minted unique in its record (B15).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { OptionType, SortedMap, StringType, compareFor, equalFor, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { dayKey } from "./model.js";
import { TUE, act, allocationHarness, kilnYard, offering, settle, slot, width, type FitResult } from "./harness.test-utils.js";

const h = allocationHarness();
const byString = compareFor(StringType);
const sameLoad = equalFor(OptionType(StringType));
const binEqual = equalFor(ex.kilnBins.type.value);
const at = (hh: number, mm: number) => new Date(Date.UTC(2027, 4, 11, hh, mm));
/** What a request's record is, for every mutation the board sent so far, in order. */
const mutated = () => h.requests("mutate").map(request => request.record);
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const button = (c: HTMLElement, name: string) => toolbar(c).getByRole("button", { name });
const status = (c: HTMLElement) => c.querySelector("[data-allocation-status]")?.textContent;
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`);
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`);
const binRow = (c: HTMLElement, id: string) => row(c, `bin:${id}`);
const freeRow = (c: HTMLElement, lane: string, when: Date) => row(c, `slot:${lane}|${dayKey(when)}`)!;
const arrivalCell = (r: HTMLElement) => r.querySelector<HTMLElement>("[data-allocation-cell-side=arrival]")!;
async function press(node: Element | null) { expect(node).not.toBeNull(); await act(async () => { fireEvent.click(node!); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
/** Removes a bin of the day, as Delete does on its selected card. */
async function remove(c: HTMLElement, id: string) { await press(card(c, id)); await key(c, "Delete"); }
/** A cell's Chooser, opened: its options, by the label each shows. */
async function choose(cell: HTMLElement) {
    await press(cell.querySelector("[aria-haspopup=listbox]"));
    await settle();
    const list = document.querySelector<HTMLElement>("[data-chooser]")!;
    return (label: string) => [...list.querySelectorAll<HTMLElement>("[role=option]")].find(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent === label)!;
}

describe("one history over the Allocation's records (#1372)", () => {
    test("B5 — a gesture that writes several bins is one step and one request: a replace removes one bin and books another, Undo takes both back", async () => {
        const { container: c } = await h.mount(ex.allocationTable);
        const option = await choose(arrivalCell(binRow(c, "3101")!));
        // What K-209 takes without LD-2201: the fit's answer to its take question.
        const take = (h.fits.answers() as FitResult[]).find(answer => answer.ask.type === "take")!;
        const fits = [...take.arrivals].filter(([arrival, fit]) => arrival !== "LD-2201" && fit.type === "fits").map(([arrival]) => arrival);
        expect(fits.length).toBeGreaterThan(0);
        offering(["N1"]);
        await press(option(fits[0]!));
        expect([binRow(c, "3101"), binRow(c, "N1") !== null]).toEqual([null, true]);
        // One step: Undo takes the removal and the booking back together, and Redo makes both again.
        await press(button(c, editingMessages.undo()));
        expect([binRow(c, "3101") !== null, binRow(c, "N1")]).toEqual([true, null]);
        expect(button(c, editingMessages.undo())).toHaveProperty("disabled", true);
        await press(button(c, editingMessages.redo()));
        expect([binRow(c, "3101"), binRow(c, "N1") !== null]).toEqual([null, true]);
        // Saved, the bins' one request: both rows in it.
        await press(button(c, editingMessages.apply()));
        expect(mutated()).toEqual([ex.kilnBins.name]);
        const saved = await h.read(ex.kilnBins);
        expect(saved.has("3101")).toBe(false);
        expect(sameLoad(saved.get("N1")!.load, some(fits[0]!))).toBe(true);
    });

    test("B6 — Save sends each record's changes as its own request: the days' door refusing keeps the day's draft, and the bins' commit stands", async () => {
        // The site office issues the yard's days: their patch door refuses every change, naming why.
        const { container: c } = await h.mount(kilnYard({ locked: "days" }));
        await remove(c, "3101");
        await press(button(c, "Publish"));
        // The bins' Save first, then the day's status: the bins commit, the days are refused.
        expect(mutated()).toEqual([ex.kilnBins.name, ex.yardLockedDays.name]);
        expect((await h.read(ex.kilnBins)).has("3101")).toBe(false);
        expect((await h.read(ex.yardLockedDays)).get(TUE)!.state.type).toBe("draft");
        expect(c.querySelector('[data-session-banner="rejected"]')?.textContent).toContain("the site office issues the yard's days");
        // The day as the record holds it: a draft, and not read-only; its row as Publish wrote it still a draft, which Discard drops.
        expect(status(c)).toBe("Draft");
        expect(c.querySelector("[data-allocation-readonly]")).toBeNull();
        expect(button(c, editingMessages.discard())).toHaveProperty("disabled", false);
        // Discarded, the day takes edits again, and Publish is back.
        await press(button(c, editingMessages.discard()));
        expect(toolbar(c).getByRole("button", { name: "Publish" })).toBeTruthy();
        expect(mutated()).toEqual([ex.kilnBins.name, ex.yardLockedDays.name]);
    });

    test("B7 — Publish saves the day's bins first, then writes its status, and the day is read-only", async () => {
        const { container: c } = await h.mount(ex.allocationKilnYard);
        await remove(c, "3101");
        await press(button(c, "Publish"));
        // The bins' Save first; the day's status once the bins read back as saved.
        expect(mutated()).toEqual([ex.kilnBins.name, ex.yardDays.name]);
        expect((await h.read(ex.kilnBins)).has("3101")).toBe(false);
        expect((await h.read(ex.yardDays)).get(TUE)!.state.type).toBe("issued");
        expect(status(c)).toBe("Published");
        expect(c.querySelector("[data-allocation-readonly]")).not.toBeNull();
    });

    test("B7 — a Save that fails leaves the day a draft, its drafts kept: the status is never written over unsaved bins", async () => {
        // The yard's bins are locked for the day: their patch door refuses every change, naming why.
        const { container: c } = await h.mount(kilnYard({ locked: "bins" }));
        await remove(c, "3101");
        await press(button(c, "Publish"));
        expect(mutated()).toEqual([ex.kilnLockedBins.name]);
        expect((await h.read(ex.yardDays)).get(TUE)!.state.type).toBe("draft");
        expect((await h.read(ex.kilnLockedBins)).has("3101")).toBe(true);
        expect(card(c, "3101")).toBeNull();
        expect(c.querySelector('[data-session-banner="rejected"]')?.textContent).toContain("the yard's bins are locked for the day");
        expect(status(c)).toBe("Draft");
        expect(c.querySelector("[data-allocation-readonly]")).toBeNull();
    });

    test("B8 — a published day is read-only in every layout, phones included", async () => {
        const { container: c } = await h.mount(ex.allocationPublished);
        const edits = /^(Book|Reserve|Allocate|Split|Unlink|Move|Remove|Revert|Back to|Link)/;
        const main = () => within(slot(c, "main"));
        expect(c.querySelector("[data-allocation-readonly]")).not.toBeNull();
        expect(status(c)).toBe("Published");
        expect(toolbar(c).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        // Publish in its slot, off (#1398, CL1).
        expect(toolbar(c).getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
        // The Timeline: no connector, nothing the Library drags; a bin's Details edit nothing.
        expect(c.querySelector("[data-allocation-card]")).not.toBeNull();
        expect(c.querySelector("[data-allocation-connector]")).toBeNull();
        expect(slot(c, "start").querySelector("[data-drag-grip]")).toBeNull();
        await press(card(c, "3001"));
        expect(within(slot(c, "end")).queryAllByRole("button", { name: edits })).toEqual([]);
        expect(slot(c, "end").querySelector("[data-allocation-inspector=details] input:not([disabled]):not([readonly])")).toBeNull();
        // The Table: no chip ×, no Chooser, no placeholder that books.
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        expect(c.querySelector("[data-allocation-row]")).not.toBeNull();
        expect(main().queryAllByRole("button", { name: /^(Remove|Unlink|Replace|Choose|Return)/ })).toEqual([]);
        expect(c.querySelector("[data-allocation-row] [aria-haspopup=listbox]:not([disabled])")).toBeNull();
        // A phone's cards, in either layout: no action.
        await width(390);
        expect(c.querySelector("[data-allocation-cards]")).not.toBeNull();
        expect(main().queryAllByRole("button", { name: edits })).toEqual([]);
        await press(toolbar(c).getByRole("radio", { name: "Timeline" }));
        expect(c.querySelector('[data-allocation-cards="timeline"]')).not.toBeNull();
        expect(main().queryAllByRole("button", { name: edits })).toEqual([]);
    });

    test("B15 — a new bin's key is minted unique in its record: a key the day holds is passed over, and so is one a draft holds", async () => {
        const first = "e5c3a1f0-0000-4000-8000-000000000001", second = "e5c3a1f0-0000-4000-8000-000000000002";
        const { container: c } = await h.mount(ex.allocationTable);
        const before = await h.read(ex.kilnBins);
        let option = await choose(arrivalCell(freeRow(c, "B-1", at(0, 15))));
        // 3113 is the day's: passed over.
        offering(["3113", first]);
        await press(option("LD-2231"));
        expect(binRow(c, first)).not.toBeNull();
        option = await choose(arrivalCell(freeRow(c, "B-2", at(0, 35))));
        // The first is the draft's: passed over.
        offering([first, second]);
        await press(option("LD-2232"));
        expect(binRow(c, second)).not.toBeNull();
        await press(button(c, editingMessages.apply()));
        const after = await h.read(ex.kilnBins);
        expect([...after.keys()].filter(k => !before.has(k))).toEqual([first, second]);
        expect([sameLoad(after.get(first)!.load, some("LD-2231")), sameLoad(after.get(second)!.load, some("LD-2232"))]).toEqual([true, true]);
        expect(binEqual(after.get("3113")!, before.get("3113")!)).toBe(true);
    });

    test("B15 — over a record read whole, a key another day holds is passed over too: the key is unique across every day", async () => {
        // Another session books the smallest board a bin a month on, a day no read of the board's is of.
        const bins = await h.read(ex.minimalBins);
        bins.set("far-1", { bay: "B-1", at: new Date("2027-06-11T00:15:00Z"), load: some("LD-2231"), m3: 21, kilns: new SortedMap([], byString), dryFor: variant("days", 8) });
        await h.patch(ex.minimalBins, bins);
        const { container: c } = await h.mount(ex.allocationMinimal);
        await press(toolbar(c).getByRole("radio", { name: "Table" }));
        const option = await choose(arrivalCell(freeRow(c, "B-1", at(0, 15))));
        offering(["far-1", "m-1"]);
        await press(option("LD-2231"));
        expect(binRow(c, "m-1")).not.toBeNull();
        await press(button(c, editingMessages.apply()));
        const after = await h.read(ex.minimalBins);
        expect([...after.keys()].filter(k => !bins.has(k))).toEqual(["m-1"]);
        // The other session's bin as it wrote it; the new one where it was booked.
        expect(equalFor(ex.minimalBins.type.value)(after.get("far-1")!, bins.get("far-1")!)).toBe(true);
        const booked = after.get("m-1")!;
        expect([booked.bay, booked.at, sameLoad(booked.load, some("LD-2231"))]).toEqual(["B-1", at(0, 15), true]);
    });
});
