/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { encodeBeast2For, equalFor, variant } from "@elaraai/east";
import { RosterRequirementsType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { clearPagedApi, initializePagedApi, initializeRecordApi, type RecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging } from "../platform/record-paging.test-utils.js";
import { act, assignment, card, mount, NEXT, rosterHarness, settle, slot, START, width, WORKSPACE } from "./harness.test-utils.js";
const h = rosterHarness();
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
async function weekKey(c: HTMLElement, key: "[" | "]") { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key }); }); await settle(); }
afterEach(() => clearPagedApi());

describe("Roster week lifecycle", () => {
    test("forecast targets are detached on first edit, Copy has new identities and reset hours, Save creates only the active week", async () => {
        const { container } = mount(ex.rosterMinimal); await settle();
        expect(h.read(ex.rosterWeeks).has(NEXT)).toBe(false);
        expect(container.textContent).toContain("Week not started");
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        expect(container.querySelectorAll('[data-roster-assignment][data-drafted]').length).toBeGreaterThan(0);
        expect(h.read(ex.rosterWeeks).has(NEXT)).toBe(false);
        await press(history(container, editingMessages.apply()));
        const saved = h.read(ex.rosterWeeks).get(NEXT)!;
        expect(saved.assignments.size).toBe(316); expect(saved.status.type).toBe("draft");
        expect([...saved.assignments].every(([key, a]) => !h.read(ex.rosterWeeks).get(START)!.assignments.has(key) && a.offset === 0 && a.overtime === 0 && a.agreed.type === "none")).toBe(true);
        expect(equalFor(RosterRequirementsType)(saved.requirements, h.read(ex.rosterForecast).get(NEXT)!)).toBe(true);
        expect(saved.dismissed.size).toBe(0);
    });
    test("drafts and history stay with each week across navigation and remount; Save does not commit the other week", async () => {
        const first = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(first.container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await weekKey(first.container, "]");
        await press(within(first.container).getByRole("button", { name: "Copy previous week" }));
        await press(history(first.container, editingMessages.apply()));
        expect(h.read(ex.rosterWeeks).has(NEXT)).toBe(true);
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.has("s37")).toBe(true);
        await weekKey(first.container, "[");
        expect(assignment(first.container, "s37").hasAttribute("data-removed")).toBe(true);
        first.unmount(); const again = mount(ex.rosterWarehouse); await settle();
        expect(assignment(again.container, "s37").hasAttribute("data-removed")).toBe(true);
        await press(history(again.container, editingMessages.discard()));
        expect(assignment(again.container, "s37").hasAttribute("data-removed")).toBe(false);
    });
    test("Publish applies the pending assignments and published status in one checked patch", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        await press(history(container, "Publish"));
        const saved = h.read(ex.rosterWeeks).get(START)!;
        expect(saved.status.type).toBe("published"); expect(saved.assignments.has("s37")).toBe(false);
        expect(container.querySelector("[data-roster-readonly]")).not.toBeNull();
        expect(container.querySelector("[data-roster-grip], [data-roster-chip-action]")).toBeNull();
        expect((await h.memory.history(WORKSPACE, ex.rosterWeeks.name, undefined)).commits.map(c => c.mutation)).toEqual(["patch", "$init"]);
    });
    test("a failed Save retains the draft and explains the record failure", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        initializeRecordApi({ ...h.memory, mutate: async () => ({ outcome: variant("failed", { exitCode: 1n, stderr: "Roster locked" }) }) as Awaited<ReturnType<RecordApi["mutate"]>> }, h.cache, WORKSPACE);
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner="rejected"]')?.textContent).toContain("Roster locked");
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.has("s37")).toBe(true);
    });
    test("a refreshed week keeps its stale draft and preserves the newer record", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        const newer = h.read(ex.rosterWeeks), week = newer.get(START)!;
        week.assignments.set("s37", { ...week.assignments.get("s37")!, overtime: 2 });
        await h.commit(ex.rosterWeeks, newer);
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner="stale"]'), slot(container, "banners").textContent).not.toBeNull();
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.get("s37")!.overtime).toBe(2);
        await press(history(container, editingMessages.discard()));
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(false);
        expect(assignment(container, "s37").textContent).toContain("+2h OT");
    });
    test("a concurrent write during Save is a checked conflict with its draft retained", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" }));
        initializeRecordApi({ ...h.memory, mutate: async (ws, record, mutation, request) => {
            const newer = h.read(ex.rosterWeeks), week = newer.get(START)!;
            week.assignments.set("s37", { ...week.assignments.get("s37")!, overtime: 2 });
            await h.cache.write(ws, [variant("field", "records"), variant("field", record)], encodeBeast2For(ex.rosterWeeks.type)(newer));
            return h.memory.mutate(ws, record, mutation, request);
        } }, h.cache, WORKSPACE);
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner="conflict"]'), slot(container, "banners").textContent).not.toBeNull();
        expect(assignment(container, "s37").hasAttribute("data-removed")).toBe(true);
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.get("s37")!.overtime).toBe(2);
    });
    test("a lost Publish response stays unconfirmed and retry uses the same request identity", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        let lost = true; const keys: (string | undefined)[] = [];
        initializeRecordApi({ ...h.memory, mutate: async (ws, record, mutation, request) => {
            keys.push(request.idempotencyKey); const answer = await h.memory.mutate(ws, record, mutation, request);
            if (lost) { lost = false; throw new Error("Response lost"); } return answer;
        } }, h.cache, WORKSPACE);
        await press(history(container, "Publish"));
        expect(container.querySelector('[data-session-banner="unknown"]')).not.toBeNull();
        await press(history(container, editingMessages.retryRequest()));
        expect(keys.length).toBe(2); expect(keys[0]).toBeDefined(); expect(keys[1]).toBe(keys[0]);
        expect(container.querySelector('[data-session-banner="unknown"]')).toBeNull();
        expect(h.read(ex.rosterWeeks).get(START)!.status.type).toBe("published");
        expect((await h.memory.history(WORKSPACE, ex.rosterWeeks.name, undefined)).commits.map(c => c.mutation)).toEqual(["patch", "$init"]);
    });
    test("record-backed staff and configuration refresh, and hidden drafts still Save under their original identities", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        const staff = h.read(ex.rosterStaff); staff.set("cclover", { ...staff.get("cclover")!, name: "C. Live" });
        await h.commit(ex.rosterStaff, staff);
        expect(assignment(container, "s37").textContent).toContain("C. Live");
        await press(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Live" }));
        const user = userEvent.setup(); await user.type(within(slot(container, "toolbar")).getByPlaceholderText("Search…"), "Aspen"); await settle();
        expect(assignment(container, "s37")).toBeNull(); await press(history(container, editingMessages.apply()));
        expect(h.read(ex.rosterWeeks).get(START)!.assignments.has("s37")).toBe(false);
    });
    test("windowed history seeks only the active/copy weeks and open picker, and Save never reads the whole record", async () => {
        const reads = countWholeReads(h.cache); initializeRecordApi(reads.serve(h.memory), h.cache, WORKSPACE);
        const service = recordPaging(h.cache, reads.raw, [{ path: [variant("field", "records"), variant("field", ex.rosterWeeks.name)], type: ex.rosterWeeks.type }]);
        initializePagedApi(service.api, WORKSPACE);
        const { container } = mount(ex.rosterWindowed); await settle();
        expect(service.requests.some(r => r.includes("seek 2028-03-12"))).toBe(true);
        expect(service.requests.some(r => r.includes("seek 2028-03-05"))).toBe(true);
        expect(service.requests.some(r => r.includes("2028-02-27"))).toBe(false);
        await press(within(container).getByRole("button", { name: "Copy previous week" }));
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner]')).toBeNull();
        expect(reads.paths.filter(p => p === "records.roster_weeks")).toEqual([]);
        await press(history(container, "Choose roster week"));
        expect(service.requests.some(r => r.includes("2028-02-27"))).toBe(true);
    });
    test("desktop proposal actions retain identity through rejection, undo and acceptance", async () => {
        const { container } = mount(ex.rosterWarehouse); await settle();
        const proposal = () => container.querySelector<HTMLElement>('[data-roster-proposal="s317"]')!;
        await press(within(proposal()).getByRole("button", { name: "Reject proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(container, editingMessages.undo()));
        await press(within(proposal()).getByRole("button", { name: "Accept proposal for N. Ochre" }));
        expect(proposal()).toBeNull();
        await press(history(container, editingMessages.apply()));
        const saved = h.read(ex.rosterWeeks).get(START)!;
        expect(saved.dismissed.has("s317")).toBe(true);
        expect([...saved.assignments.values()].filter(a => a.who.type === "person" && a.who.value === "nochre" && a.slot.day === 4n)).toHaveLength(1);
    });
    test("mobile proposals Accept/Reject and Restore are single undoable gestures", async () => {
        const { container } = mount(ex.rosterMobile); await settle(); await width(390);
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
