/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, FloatType, IntegerType, StringType, StructType, compareFor, printFor, variant } from "@elaraai/east";
import { Schedule } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import {
    act, assignment, at, card, history, narrow, NEXT, open, press, rosterHarness, searched, settle, slot, START, warehouseRoster, weekDuties, width,
    type Choice,
} from "./harness.test-utils.js";
const h = rosterHarness();
async function weekKey(c: HTMLElement, key: "[" | "]") { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); }); await settle(); }
/** The weeks' record, as the request log names its dataset. */
const WEEKS = "records.roster_rota_weeks";
/** The duties' record, as the request log names its dataset. */
const DUTIES = "records.roster_duties";
/** A record's commits, newest first, by the mutation that made each. */
const commits = async (record: { readonly name: string }) => (await h.history(record)).commits.map(c => c.mutation);
const byDate = compareFor(DateTimeType);
const byString = compareFor(StringType);
const printDuty = printFor(ex.WarehouseDuty);
/** A shift's own times on a day of a week: from its start, for its hours — by East's own arithmetic. */
const ownTimes = East.compile(East.function([DateTimeType, IntegerType, Schedule.Types.Clock, FloatType], StructType({ start: DateTimeType, end: DateTimeType }),
    ($, week, day, clock, hours) => {
        const start = $.const(week.addDays(day).addMinutes(clock.hour.multiply(60n).add(clock.minute)));
        return { start, end: start.addHours(hours) };
    }), []);

describe("Roster week lifecycle", () => {
    test("a week not started offers Copy previous week: each of its duties under a new key at its shift's own times, its other fields as they were", async () => {
        const { container } = await h.mount(ex.rosterWindowed);
        const before = await h.read(ex.rosterDuties);
        expect(weekDuties(before, NEXT).size).toBe(0);
        expect(container.textContent).toContain("Week not started");
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        expect(container.querySelectorAll('[data-roster-assignment][data-drafted]').length).toBeGreaterThan(0);
        expect(weekDuties(await h.read(ex.rosterDuties), NEXT).size).toBe(0);
        await press(history(container, editingMessages.apply()));
        const after = await h.read(ex.rosterDuties), copied = weekDuties(after, NEXT);
        expect([...copied.keys()].every(key => !before.has(key))).toBe(true);
        // Each duty of the week before at its shift's own times, a later start or a longer duty running its shift as it
        // stands, and every other field as it was.
        const shifts = await h.read(ex.rosterShiftTimes);
        const expected = [...ex.warehouseWeek.assignments.values()].map(duty => {
            const shift = shifts.get(duty.slot.shift)!;
            return printDuty({ ...duty.row, ...ownTimes(NEXT, duty.slot.day, shift.start, shift.hours) });
        }).sort(byString);
        expect([...copied.values()].map(duty => printDuty(duty)).sort(byString)).toEqual(expected);
        // Copy writes duties alone: the week's row and its targets stand as they were.
        expect((await h.read(ex.rosterWeeks)).has(NEXT)).toBe(false);
        expect(h.requests("mutate").map(request => request.record)).toEqual([ex.rosterDuties.name]);
    });
    test("drafts stay in their session across navigation and remount, and Save includes those of another week", async () => {
        const first = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(first.container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await weekKey(first.container, "]");
        await press(within(first.container).getByRole("button", { name: "Copy previous week" }));
        await weekKey(first.container, "[");
        expect(assignment(first.container, "s37").hasAttribute("data-removed")).toBe(true);
        first.unmount(); const again = await h.mount(ex.rosterWarehouse);
        expect(assignment(again.container, "s37").hasAttribute("data-removed")).toBe(true);
        await weekKey(again.container, "]");
        expect(again.container.querySelectorAll('[data-roster-assignment][data-drafted]').length).toBeGreaterThan(0);
        await press(history(again.container, editingMessages.apply()));
        const duties = await h.read(ex.rosterDuties);
        expect(duties.has("s37")).toBe(false);
        expect(weekDuties(duties, NEXT).size).toBe(316);
    });
    test("Discard drops every week's drafts with their history", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await weekKey(container, "]");
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        await press(history(container, editingMessages.discard()));
        expect(container.textContent).toContain("Week not started");
        await weekKey(container, "[");
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(false);
    });
    test("Publish saves the pending duties, then writes the week's published status", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const deployed = { duties: await commits(ex.rosterDuties), weeks: await commits(ex.rosterWeeks) };
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(container, "Publish"));
        expect((await h.read(ex.rosterWeeks)).get(START)!.state.type).toBe("issued");
        expect((await h.read(ex.rosterDuties)).has("s37")).toBe(false);
        expect(container.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(container.querySelector("[data-roster-grip], [data-roster-chip-action]")).toBeNull();
        expect([await commits(ex.rosterDuties), await commits(ex.rosterWeeks)]).toEqual([["patch", ...deployed.duties], ["patch", ...deployed.weeks]]);
    });
    test("a failed Save retains the draft and explains the record failure", async () => {
        // The warehouse has locked its duties: their patch door refuses every change, naming why.
        const { container } = await h.mount(warehouseRoster({ locked: true }));
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(container, editingMessages.apply()));
        const refused = container.querySelector('[data-session-banner="rejected"]')?.textContent;
        expect(refused).toContain("The write failed: ");
        expect(refused).toContain("the roster is locked for the week");
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterLockedDuties)).has("s37")).toBe(true);
    });
    test("a refreshed record keeps its stale draft and preserves the newer duty", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        // Another session's write to the duties: C. Clover starts an hour early.
        const newer = await h.read(ex.rosterDuties);
        newer.set("s37", { ...newer.get("s37")!, start: at("2028-03-09T05:00:00") });
        await h.patch(ex.rosterDuties, newer);
        expect(container.querySelector('[data-session-banner="stale"]'), slot(container, "banners").textContent ?? "").not.toBeNull();
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        await press(history(container, editingMessages.discard()));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(false);
        // Its own times differ from its shift's now: the chip says them.
        expect(assignment(container, "s37").textContent).toContain("05:00–14:00");
    });
    test("a concurrent write during Save is a checked conflict with its draft retained", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        // Another session's write lands between this Save's read and its commit: C. Clover starts an hour early.
        await h.race(ex.rosterDuties, () => { fireEvent.click(history(container, editingMessages.apply())); }, (now) => {
            now.set("s37", { ...now.get("s37")!, start: at("2028-03-09T05:00:00") });
            return now;
        });
        expect(container.querySelector('[data-session-banner="conflict"]'), slot(container, "banners").textContent ?? "").not.toBeNull();
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterDuties)).get("s37")!.start).toEqual(at("2028-03-09T05:00:00"));
    });
    test("a lost Publish response stays unconfirmed and retry uses the same request identity", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const deployed = await commits(ex.rosterWeeks);
        // The Publish lands on e3, and every answer to it is lost on the way back: the client tries again under the same id
        // until it gives up, which leaves the write unknown.
        const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.rosterWeeks.name, "lost");
        await act(async () => { fireEvent.click(history(container, "Publish")); });
        await waitFor(() => expect(container.querySelector('[data-session-banner="unknown"]')).not.toBeNull(), { timeout: 15_000 });
        losing();
        await press(history(container, editingMessages.retryRequest()));
        const keys = h.requests("mutate", ex.rosterWeeks.name).map(request => request.idempotencyKey);
        expect(keys.length).toBeGreaterThan(1); expect(keys[0]).toBeDefined(); expect(new Set(keys).size).toBe(1);
        expect(container.querySelector('[data-session-banner="unknown"]')).toBeNull();
        expect((await h.read(ex.rosterWeeks)).get(START)!.state.type).toBe("issued");
        expect(await commits(ex.rosterWeeks)).toEqual(["patch", ...deployed]);
    });
    test("record-backed staff refresh, and hidden drafts still Save under their original identities", async () => {
        const { container, store } = await open(ex.rosterWarehouse);
        // Another session renames C. Clover in the staff record.
        const staff = await h.read(ex.rosterStaff); staff.set("cclover", { ...staff.get("cclover")!, name: "C. Live" });
        await h.patch(ex.rosterStaff, staff);
        expect(assignment(container, "s37").textContent).toContain("C. Live");
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Live" }));
        await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "H. Aspen")]]));
        expect(assignment(container, "s37")).toBeNull(); await press(history(container, editingMessages.apply()));
        expect((await h.read(ex.rosterDuties)).has("s37")).toBe(false);
    });
    test("the windowed roster seeks the week's row and the open picker's alone, and neither record is read whole", async () => {
        const { container } = await h.mount(ex.rosterWindowed);
        /** Whether the weeks were searched for a week, by its key's text. */
        const sought = (text: string) => h.requests("find", WEEKS).some(request => searched(request, undefined, text));
        expect(sought("2028-03-12")).toBe(true);
        expect(sought("2028-02-27")).toBe(false);
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner]')).toBeNull();
        expect([h.requests("read", WEEKS), h.requests("read", DUTIES)]).toEqual([[], []]);
        await press(history(container, "Choose roster week"));
        expect(sought("2028-02-27")).toBe(true);
    });
    test("desktop proposal actions retain identity through rejection, undo and acceptance", async () => {
        // The warehouse's roster with no check of its own on a draft: an accepted proposal saves with no cost centre given.
        const { container } = await h.mount(warehouseRoster());
        const proposal = () => container.querySelector<HTMLElement>('[data-roster-proposal="s317"]')!;
        await press(within(proposal()).getByRole("button", { name: "Reject proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(container, editingMessages.undo()));
        await press(within(proposal()).getByRole("button", { name: "Accept proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(container, editingMessages.apply()));
        expect((await h.read(ex.rosterWeeks)).get(START)!.dismissed.has("s317")).toBe(true);
        const thursday = at("2028-03-09T00:00:00"), friday = at("2028-03-10T00:00:00");
        expect([...(await h.read(ex.rosterDuties)).values()].filter(duty => duty.who.type === "staff" && duty.who.value === "nochre"
            && byDate(duty.start, thursday) >= 0 && byDate(duty.start, friday) < 0)).toHaveLength(1);
    });
    test("mobile proposals Accept/Reject and Restore are single undoable gestures", async () => {
        const { container } = await h.mount(ex.rosterMobile); await width(390);
        const main = slot(container, "main");
        const p = main.querySelector<HTMLElement>('[data-roster-proposal="s317"]')!;
        await press(within(p).getByRole("button", { name: "Accept" }));
        expect(main.querySelector('[data-roster-proposal="s317"]')).toBeNull();
        expect([...main.querySelectorAll('[data-roster-card][data-drafted]')].some(c => c.textContent?.includes("N. Ochre"))).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect(main.querySelector('[data-roster-proposal="s317"]')).not.toBeNull();
        await press(within(card(container, "s37")).getByRole("button", { name: "Remove" }));
        await press(within(card(container, "s37")).getByRole("button", { name: "Restore" }));
        expect(within(card(container, "s37")).getByRole("button", { name: "Remove" })).not.toBeNull();
    });
});
