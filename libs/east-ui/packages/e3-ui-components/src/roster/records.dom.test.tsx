/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Roster over the app's own records (#1369, `Builder Interfaces Spec.md`
 * §7, §8): each record it writes — the duties, the weeks, the cover targets —
 * is a session of one history, on e3 itself. A gesture across them is one step
 * (B5); Save sends each record's changes as its own request, a refusal keeping
 * that record's drafts alone (B6); Publish saves, then writes the week's status
 * (B7); a published week is read-only in every layout (B8); two sessions'
 * edits of different duties both commit (B9); coverage, pay, checks and fits
 * read every duty of the week whatever the rail shows (B11); a new duty's key
 * is minted unique in its record (B15); and pay is asked a person at a time
 * (B17).
 */
import { afterEach, describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, equalFor, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import {
    START, act, assignment, at, cell, drop, history, libraryCard, narrow, open, press, rosterHarness, settle, slot, warehouseRoster, weekDuties, width, type Choice,
} from "./harness.test-utils.js";
import { setRosterPayProbe } from "./model.js";
import { offering } from "../shared/schedule/keys.test-utils.js";

const h = rosterHarness();
const sameDate = equalFor(DateTimeType);
/** What a request's record is, for every mutation the Roster sent so far, in order. */
const mutated = () => h.requests("mutate").map(request => request.record);
/** The desktop proposal chip of a suggestion. */
const proposal = (c: HTMLElement, key: string) => slot(c, "main").querySelector<HTMLElement>(`[data-roster-proposal="${key}"]`);
/** The board's drafted duties of a person, by the name their chip shows. */
const drafted = (c: HTMLElement, name: string) => [...slot(c, "main").querySelectorAll("[data-roster-assignment][data-drafted]")].filter(el => el.textContent?.includes(name));
/** The inspector summary's figure under a label: `Cost`, `Positions`. */
const stat = (c: HTMLElement, label: string) => within(slot(c, "end")).getByText(label, { selector: "div" }).nextElementSibling?.textContent ?? "";
/** A figure as the summary prints it, read as a number: what a test compares totals by. */
const amount = (text: string) => Number(text.replace(/[^0-9.-]/g, ""));
/** The coverage marks the board draws, by what they say. */
const marks = (c: HTMLElement) => [...slot(c, "main").querySelectorAll('[role="img"][aria-label]')].map(el => el.getAttribute("aria-label"));
/** The Issues tab's count. */
const issueCount = (c: HTMLElement) => within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }).textContent;
/** The issues of a title the inspector's Issues tab lists. */
const titled = (c: HTMLElement, title: string) => [...slot(c, "end").querySelectorAll("[data-roster-issue]")].filter(el => el.querySelector("button")?.textContent === title);
afterEach(() => { setRosterPayProbe(undefined); });

describe("one history over the Roster's records (#1369)", () => {
    test("B5 — accepting a proposal is one step across records: the duty and the week's dismissal are drafted together, and undone together", async () => {
        // The warehouse's roster with no check of its own on a draft: a new duty saves with no cost centre given.
        const { container: c } = await h.mount(warehouseRoster());
        await press(within(proposal(c, "s317")!).getByRole("button", { name: "Accept proposal for N. Ochre" }));
        expect(proposal(c, "s317")).toBeNull();
        expect(drafted(c, "N. Ochre")).toHaveLength(1);
        // One Undo takes both back: the duty, and the week's dismissal of the suggestion.
        await press(history(c, editingMessages.undo()));
        expect(proposal(c, "s317")).not.toBeNull();
        expect(drafted(c, "N. Ochre")).toHaveLength(0);
        expect(history(c, editingMessages.undo())).toHaveProperty("disabled", true);
        await press(history(c, editingMessages.redo()));
        expect(proposal(c, "s317")).toBeNull();
        expect(drafted(c, "N. Ochre")).toHaveLength(1);
        await press(history(c, editingMessages.apply()));
        // Saved, each record's changes its own request: the duty, and the week's dismissal.
        expect(mutated().sort()).toEqual([ex.rosterDuties.name, ex.rosterWeeks.name].sort());
        expect((await h.read(ex.rosterWeeks)).get(START)!.dismissed.has("s317")).toBe(true);
        const added = [...(await h.read(ex.rosterDuties)).values()].filter(duty => duty.who.type === "staff" && duty.who.value === "nochre"
            && sameDate(duty.start, at("2028-03-09T22:00:00")));
        expect(added).toHaveLength(1);
        expect([added[0]!.team, added[0]!.shift, added[0]!.end]).toEqual(["inbound", "night", at("2028-03-10T06:00:00")]);
    });

    test("B6 — Save sends each record's changes as its own request: the duties' door refusing keeps their drafts, and the week's commit stands", async () => {
        // The warehouse has locked its duties: their patch door refuses every change, naming why.
        const { container: c } = await h.mount(warehouseRoster({ locked: true }));
        await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(within(proposal(c, "s318")!).getByRole("button", { name: "Reject proposal for B. Pumice" }));
        await press(history(c, editingMessages.apply()));
        expect(mutated().sort()).toEqual([ex.rosterLockedDuties.name, ex.rosterWeeks.name].sort());
        // The week's dismissal committed; the duties' write refused, its draft kept.
        expect((await h.read(ex.rosterWeeks)).get(START)!.dismissed.has("s318")).toBe(true);
        expect((await h.read(ex.rosterLockedDuties)).has("s37")).toBe(true);
        expect(assignment(c, "s37").hasAttribute("data-removed")).toBe(true);
        expect(c.querySelector('[data-session-banner="rejected"]')?.textContent).toContain("the roster is locked for the week");
        expect(proposal(c, "s318")).toBeNull();
    });

    test("B7 — Publish saves the week's records first, then writes its status, and the week is read-only", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(c, "Publish"));
        // The duties' Save first; the week's status once the duties read back as saved.
        expect(mutated()).toEqual([ex.rosterDuties.name, ex.rosterWeeks.name]);
        expect((await h.read(ex.rosterDuties)).has("s37")).toBe(false);
        const week = (await h.read(ex.rosterWeeks)).get(START)!;
        expect(week.state.type).toBe("issued");
        expect(c.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(slot(c, "toolbar").querySelector("[data-roster-status]")?.textContent).toBe("Published");
    });

    test("B7 — a Save that fails leaves the week a draft, its drafts kept: the status is never written over unsaved duties", async () => {
        const { container: c } = await h.mount(warehouseRoster({ locked: true }));
        await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(c, "Publish"));
        expect(mutated()).toEqual([ex.rosterLockedDuties.name]);
        expect((await h.read(ex.rosterWeeks)).get(START)!.state.type).toBe("open");
        expect(assignment(c, "s37").hasAttribute("data-removed")).toBe(true);
        expect(c.querySelector('[data-session-banner="rejected"]')).not.toBeNull();
        expect(c.querySelector("[data-roster-readonly]")).toBeNull();
    });

    test("B8 — a published week is read-only in every layout, phones included", async () => {
        const { container: c } = await h.mount(ex.rosterPublished);
        const toolbar = within(slot(c, "toolbar"));
        expect(c.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(slot(c, "toolbar").querySelector("[data-roster-status]")?.textContent).toBe("Published");
        expect(c.querySelector("[data-roster-grip], [data-roster-chip-action], [data-roster-action]")).toBeNull();
        expect(toolbar.queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        // Publish keeps its slot, as on every week of a Roster that publishes and edits (#1398, CL1): there, and off.
        expect(toolbar.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
        await press(toolbar.getByRole("radio", { name: "People" }));
        expect(within(slot(c, "main")).queryAllByRole("button", { name: /assign/i })).toEqual([]);
        await width(390);
        const main = within(slot(c, "main"));
        for (const name of ["Edit", "Move", "Remove", "Restore", "Accept", "Reject", "Edit targets"]) expect(main.queryAllByRole("button", { name })).toEqual([]);
        expect(main.queryAllByRole("button", { name: /assign|request/i })).toEqual([]);
        await press(toolbar.getByRole("radio", { name: "Shifts" }));
        for (const name of ["Edit", "Move", "Remove", "Edit targets"]) expect(main.queryAllByRole("button", { name })).toEqual([]);
        expect(main.queryAllByRole("button", { name: /assign|request/i })).toEqual([]);
    });

    test("B9 — two sessions' edits of different duties of one week both commit; the same duty is the second's conflict, naming it", async () => {
        const { container: c } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(c, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        // Another session notes D. Bracken's Thursday between this Save's read and its commit: another duty, both commit.
        await h.race(ex.rosterDuties, () => { fireEvent.click(history(c, editingMessages.apply())); },
            now => { now.set("s14", { ...now.get("s14")!, note: "asked to swap" }); return now; });
        const duties = await h.read(ex.rosterDuties);
        expect(duties.has("s37")).toBe(false);
        expect(duties.get("s14")!.note).toBe("asked to swap");
        expect(c.querySelector("[data-session-banner]")).toBeNull();
        // Then both sessions edit R. Birch's Thursday: this one's Save is the conflict, naming the duty; the other's stands.
        await press(within(assignment(c, "s10")).getByRole("button", { name: "Remove R. Birch" }));
        await h.race(ex.rosterDuties, () => { fireEvent.click(history(c, editingMessages.apply())); },
            now => { now.set("s10", { ...now.get("s10")!, note: "covering for Tuesday" }); return now; });
        const conflict = c.querySelector('[data-session-banner="conflict"]');
        expect(conflict, slot(c, "banners").textContent ?? "").not.toBeNull();
        // Named as the Roster names a duty: whose it is.
        expect(conflict!.textContent).toContain("R. Birch");
        expect(assignment(c, "s10").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterDuties)).get("s10")!.note).toBe("covering for Tuesday");
    });

    test("B11 — coverage, pay, checks and fits read every duty of the week, whatever the rail shows", async () => {
        const { container: c, store } = await open(ex.rosterWarehouse);
        const coverage = marks(c), cost = stat(c, "Cost"), issues = issueCount(c);
        expect(amount(cost)).toBeGreaterThan(0);
        await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "C. Clo")]]));
        const people = [...slot(c, "main").querySelectorAll("[data-roster-assignment]:not([data-request])")];
        expect(people.map(el => el.getAttribute("data-roster-assignment"))).toEqual(["s37"]);
        expect(marks(c)).toEqual(coverage);
        expect(stat(c, "Cost")).toBe(cost);
        expect(issueCount(c)).toBe(issues);
        // A Find fix asks the fit over every duty of the week and every person, the rail's narrowing notwithstanding.
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        await press(within(slot(c, "end")).getAllByRole("button", { name: "Find a lead" })[0]);
        await waitFor(() => expect(h.fits.requests()).toHaveLength(1));
        const asked = h.fits.requests()[0]!;
        const week = weekDuties(await h.read(ex.rosterDuties), START);
        expect([asked.week.assignments.size, asked.context.people.size]).toEqual([week.size, 69]);
    });

    test("B15 — a new duty's key is minted unique in its record: a key the week holds is passed over, and so is one a draft holds", async () => {
        offering(["s37", "e5c3a1f0-0000-4000-8000-000000000001", "e5c3a1f0-0000-4000-8000-000000000001", "e5c3a1f0-0000-4000-8000-000000000002"]);
        // The warehouse's roster with no check of its own on a draft: a request saves with no cost centre given.
        const { container: c } = await h.mount(warehouseRoster());
        const before = await h.read(ex.rosterDuties);
        await press(within(cell(c, 4, "inbound", "night")).getByRole("button", { name: "Request Northside Staffing" }));
        await press(within(cell(c, 4, "inbound", "late")).getByRole("button", { name: "Request Northside Staffing" }));
        await press(history(c, editingMessages.apply()));
        const after = await h.read(ex.rosterDuties);
        const added = [...after.keys()].filter(key => !before.has(key));
        expect(added).toEqual(["e5c3a1f0-0000-4000-8000-000000000001", "e5c3a1f0-0000-4000-8000-000000000002"]);
        expect(after.get("e5c3a1f0-0000-4000-8000-000000000001")!.who).toEqual(variant("agency", "northside"));
        expect(equalFor(ex.WarehouseDuty)(after.get("s37")!, before.get("s37")!)).toBe(true);
    });

    test("B15 — over a record read whole, a key another week holds is passed over too: the key is unique across every period", async () => {
        // Another session books W-01 a duty a month on, a week no window of the Roster reads.
        const duties = await h.read(ex.minimalDuties);
        duties.set("far-1", { person: "w-01", start: at("2028-04-03T06:00:00"), end: at("2028-04-03T14:00:00"), shift: "early", team: "inbound" });
        await h.patch(ex.minimalDuties, duties);
        offering(["far-1", "c-1", "c-2", "c-3"]);
        const { container: c } = await h.mount(ex.rosterMinimal);
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "]" }); });
        await settle();
        await press(within(c).getByRole("button", { name: "Copy previous week" }));
        await press(history(c, editingMessages.apply()));
        const after = await h.read(ex.minimalDuties);
        expect([...after.keys()].sort()).toEqual(["c-1", "c-2", "c-3", "d-1", "d-2", "d-3", "far-1"]);
        expect(after.get("far-1")!.start).toEqual(at("2028-04-03T06:00:00"));
    });

    test("B17 — pay is asked a person at a time: a change asks again for the person it touched alone, and every total follows", async () => {
        const asked: string[] = [];
        setRosterPayProbe(who => { asked.push(who.type === "person" ? who.value : `request:${who.value}`); });
        const { container: c } = await h.mount(ex.rosterWarehouse);
        // Mounted, the pay is asked once for each person rostered this week, and once for the agency's requests.
        const week = weekDuties(await h.read(ex.rosterDuties), START);
        const rostered = new Set([...week.values()].map(duty => duty.who.type === "staff" ? duty.who.value : `request:${duty.who.value}`));
        expect(new Set(asked)).toEqual(rostered);
        expect(asked).toHaveLength(rostered.size);
        // The week's totals: the inspector's summary over the week.
        const toolbar = within(slot(c, "toolbar"));
        await press(toolbar.getByRole("radio", { name: "Week" }));
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        const overtime = titled(c, "Overtime not agreed").length;
        await press(within(slot(c, "end")).getByRole("tab", { name: "Details" }));
        const cost = amount(stat(c, "Cost"));
        asked.splice(0);
        // A. Alder works 32 of his 38 hours; a Wednesday duty takes him past them, and the last of his week is overtime.
        await drop(await libraryCard(c, "A. Alder"), cell(c, 3, "inbound", "early"));
        expect(asked).toEqual(["aalder"]);
        await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: "Escape" }); });
        await settle();
        // His Wednesday: 8 h of ordinary time at 42; his Saturday: 6 h at 42, 2 h at the OT1 rate of 63, where it was 8 h at 42.
        expect(amount(stat(c, "Cost")) - cost).toBe(8 * 42 + 6 * 42 + 2 * 63 - 8 * 42);
        // The warehouse's check is given the pay: his Saturday is overtime nobody agreed.
        await press(within(slot(c, "end")).getByRole("tab", { name: /^Issues/ }));
        expect(titled(c, "Overtime not agreed")).toHaveLength(overtime + 1);
        // His Saturday's pay, by the warehouse's codes.
        await press(toolbar.getByRole("radio", { name: "Day" }));
        await press(toolbar.getByRole("radio", { name: "Sat" }));
        await press(assignment(c, "s4"));
        const pay = slot(c, "end").querySelector("[data-roster-pay]")?.textContent ?? "";
        expect(pay).toContain("ORD");
        expect(pay).toContain("OT1");
        // And its Details name the check's issue on it.
        expect(within(slot(c, "end").querySelector<HTMLElement>('[data-roster-inspector="details"]')!).getByText("Overtime not agreed")).toBeTruthy();
    });
});
