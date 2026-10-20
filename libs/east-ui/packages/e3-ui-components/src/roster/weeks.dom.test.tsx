/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { equalFor, variant } from "@elaraai/east";
import { RosterRequirementsType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, card, narrow, NEXT, open, rosterHarness, searched, settle, slot, START, warehouseRoster, width, type Choice } from "./harness.test-utils.js";
const h = rosterHarness();
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function weekKey(c: HTMLElement, key: "[" | "]") { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); }); await settle(); }
/** The weeks' record, as the request log names its dataset. */
const WEEKS = "records.roster_weeks";
/** The weeks' commits, newest first, by the mutation that made each. */
const commits = async () => (await h.history(ex.rosterWeeks)).commits.map(c => c.mutation);

describe("Roster week lifecycle", () => {
    test("forecast targets are detached on first edit, Copy has new identities and reset hours, Save creates only the active week", async () => {
        const { container } = await h.mount(ex.rosterMinimal);
        expect((await h.read(ex.rosterWeeks)).has(NEXT)).toBe(false);
        expect(container.textContent).toContain("Week not started");
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        expect(container.querySelectorAll('[data-roster-assignment][data-drafted]').length).toBeGreaterThan(0);
        expect((await h.read(ex.rosterWeeks)).has(NEXT)).toBe(false);
        await press(history(container, editingMessages.apply()));
        const weeks = await h.read(ex.rosterWeeks), saved = weeks.get(NEXT)!;
        expect(saved.assignments.size).toBe(316); expect(saved.status.type).toBe("draft");
        expect([...saved.assignments].every(([key, a]) => !weeks.get(START)!.assignments.has(key) && a.offset === 0 && a.overtime === 0 && a.agreed.type === "none")).toBe(true);
        expect(equalFor(RosterRequirementsType)(saved.requirements, (await h.read(ex.rosterForecast)).get(NEXT)!)).toBe(true);
        expect(saved.dismissed.size).toBe(0);
    });
    test("drafts and history stay with each week across navigation and remount; Save does not commit the other week", async () => {
        const first = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(first.container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await weekKey(first.container, "]");
        await press(within(first.container).getByRole("button", { name: "Copy previous week" }));
        await press(history(first.container, editingMessages.apply()));
        const weeks = await h.read(ex.rosterWeeks);
        expect(weeks.has(NEXT)).toBe(true);
        expect(weeks.get(START)!.assignments.has("s37")).toBe(true);
        await weekKey(first.container, "[");
        expect(assignment(first.container, "s37").hasAttribute("data-removed")).toBe(true);
        first.unmount(); const again = await h.mount(ex.rosterWarehouse);
        expect(assignment(again.container, "s37").hasAttribute("data-removed")).toBe(true);
        await press(history(again.container, editingMessages.discard()));
        expect(assignment(again.container, "s37").hasAttribute("data-removed")).toBe(false);
    });
    test("Publish applies the pending assignments and published status in one checked patch", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const deployed = await commits();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(container, "Publish"));
        const saved = (await h.read(ex.rosterWeeks)).get(START)!;
        expect(saved.status.type).toBe("published"); expect(saved.assignments.has("s37")).toBe(false);
        expect(container.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(container.querySelector("[data-roster-grip], [data-roster-chip-action]")).toBeNull();
        expect(await commits()).toEqual(["patch", ...deployed]);
    });
    test("a failed Save retains the draft and explains the record failure", async () => {
        // The warehouse has locked the week: its weeks' patch door refuses every change, naming why.
        const { container } = await h.mount(warehouseRoster({ locked: true }));
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(container, editingMessages.apply()));
        const refused = container.querySelector('[data-session-banner="rejected"]')?.textContent;
        expect(refused).toContain("The write failed: ");
        expect(refused).toContain("the roster is locked for the week");
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterLockedWeeks)).get(START)!.assignments.has("s37")).toBe(true);
    });
    test("a refreshed week keeps its stale draft and preserves the newer record", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        // Another session's write to the week: C. Clover's overtime.
        const newer = await h.read(ex.rosterWeeks), week = newer.get(START)!;
        week.assignments.set("s37", { ...week.assignments.get("s37")!, overtime: 2 });
        await h.patch(ex.rosterWeeks, newer);
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner="stale"]'), slot(container, "banners").textContent).not.toBeNull();
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.get("s37")!.overtime).toBe(2);
        await press(history(container, editingMessages.discard()));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(false);
        expect(assignment(container, "s37").textContent).toContain("+2h OT");
    });
    test("a concurrent write during Save is a checked conflict with its draft retained", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        // Another session's write lands between this Save's read and its commit: C. Clover's overtime.
        await h.race(ex.rosterWeeks, () => { fireEvent.click(history(container, editingMessages.apply())); }, (now) => {
            const week = now.get(START)!;
            week.assignments.set("s37", { ...week.assignments.get("s37")!, overtime: 2 });
            return now;
        });
        expect(container.querySelector('[data-session-banner="conflict"]'), slot(container, "banners").textContent).not.toBeNull();
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.get("s37")!.overtime).toBe(2);
    });
    test("a lost Publish response stays unconfirmed and retry uses the same request identity", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const deployed = await commits();
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
        expect((await h.read(ex.rosterWeeks)).get(START)!.status.type).toBe("published");
        expect(await commits()).toEqual(["patch", ...deployed]);
    });
    test("record-backed staff and configuration refresh, and hidden drafts still Save under their original identities", async () => {
        const { container, store } = await open(ex.rosterWarehouse);
        // Another session renames C. Clover in the staff record.
        const staff = await h.read(ex.rosterStaff); staff.set("cclover", { ...staff.get("cclover")!, name: "C. Live" });
        await h.patch(ex.rosterStaff, staff);
        expect(assignment(container, "s37").textContent).toContain("C. Live");
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Live" }));
        await narrow(store, "rosterWarehouse", "people", new Map<string, Choice>([["name", variant("prefix", "H. Aspen")]]));
        expect(assignment(container, "s37")).toBeNull(); await press(history(container, editingMessages.apply()));
        expect((await h.read(ex.rosterWeeks)).get(START)!.assignments.has("s37")).toBe(false);
    });
    test("windowed history seeks only the active/copy weeks and open picker, and Save never reads the whole record", async () => {
        const { container } = await h.mount(ex.rosterWindowed);
        /** Whether the weeks were searched for a week, by its key's text. */
        const sought = (text: string) => h.requests("find", WEEKS).some(request => searched(request, undefined, text));
        expect(sought("2028-03-12")).toBe(true);
        expect(sought("2028-03-05")).toBe(true);
        expect(sought("2028-02-27")).toBe(false);
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner]')).toBeNull();
        expect(h.requests("read", WEEKS)).toEqual([]);
        await press(history(container, "Choose roster week"));
        expect(sought("2028-02-27")).toBe(true);
    });
    test("desktop proposal actions retain identity through rejection, undo and acceptance", async () => {
        const { container } = await h.mount(ex.rosterWarehouse);
        const proposal = () => container.querySelector<HTMLElement>('[data-roster-proposal="s317"]')!;
        await press(within(proposal()).getByRole("button", { name: "Reject proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(container, editingMessages.undo()));
        await press(within(proposal()).getByRole("button", { name: "Accept proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(container, editingMessages.apply()));
        const saved = (await h.read(ex.rosterWeeks)).get(START)!;
        expect(saved.dismissed.has("s317")).toBe(true);
        expect([...saved.assignments.values()].filter(a => a.who.type === "person" && a.who.value === "nochre" && a.slot.day === 4n)).toHaveLength(1);
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
