/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, OptionType, StringType, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Calendar, Record } from "@elaraai/e3-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { initializeRecordApi, type RecordApi } from "../platform/index.js";
import { act, calendarHarness, card, event, mount, settle, slot, width, WORKSPACE } from "./harness.test-utils.js";
const h = calendarHarness();
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }

describe("Calendar in the shared frame", () => {
    test("the bound operations calendar has one toolbar, ordered library tabs, three event kinds and cross-kind overlaps", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        expect(container.querySelectorAll("[data-builder-frame]")).toHaveLength(1);
        expect(slot(container, "toolbar")).not.toBeNull();
        expect([...slot(container, "start").querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["Templates 4", "Backlog 4", "Technicians 3"]);
        expect(event(container, "job", "job1").textContent).toContain("Mounting brackets");
        expect(event(container, "service", "service1").hasAttribute("data-overlap")).toBe(true);
        expect(event(container, "shift", "shift1").hasAttribute("data-overlap")).toBe(false);
        expect(container.querySelector("[data-calendar-overlaps]")?.textContent).toContain("1");
    });
    test("optional library and inspector really omit their panes; every example is the same Calendar", async () => {
        const { container } = mount(ex.calendarMinimal); await settle();
        expect(slot(container, "start")).toBeNull(); expect(slot(container, "end")).toBeNull();
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(history(container, editingMessages.apply())).not.toBeNull();
    });
    test("selection, multi-selection, empty grid and Escape use canonical event identities", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await press(event(container, "job", "job1"));
        expect(slot(container, "end").textContent).toContain("Mounting brackets");
        await act(async () => { fireEvent.click(event(container, "service", "service1"), { ctrlKey: true }); }); await settle();
        expect(container.querySelectorAll("[data-calendar-event][data-selected]")).toHaveLength(2);
        expect(slot(container, "end").textContent).toContain("2 events");
        await act(async () => { fireEvent.keyDown(event(container, "job", "job1"), { key: "Escape" }); }); await settle();
        expect(container.querySelectorAll("[data-calendar-event][data-selected]")).toHaveLength(0);
    });
    test("editing a field drafts, Undo and Redo share history, and Save patches the original record", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await press(event(container, "job", "job1"));
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        const user = userEvent.setup(); await user.clear(input); await user.type(input, "New customer{Enter}"); await settle();
        expect(h.read(ex.calendarJobs).get("job1")!.customer).toBe("Alder Works");
        expect(event(container, "job", "job1").hasAttribute("data-drafted")).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect((slot(container, "end").querySelector('[data-field="customer"] input') as HTMLInputElement).value).toBe("Alder Works");
        await press(history(container, editingMessages.redo()));
        await press(history(container, editingMessages.apply()));
        expect(h.read(ex.calendarJobs).get("job1")!.customer).toBe("New customer");
        expect(event(container, "job", "job1").hasAttribute("data-drafted")).toBe(false);
        expect((await h.memory.history(WORKSPACE, ex.calendarJobs.name, undefined)).commits.some(c => c.mutation === "patch")).toBe(true);
    });
    test("bound template and resource records update their library and headers", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        const templates = new Map(h.read(ex.calendarJobTemplates));
        templates.set("brackets", { ...templates.get("brackets")!, name: "Live template" });
        await h.commit(ex.calendarJobTemplates, templates);
        expect(slot(container, "start").textContent).toContain("Live template");
        const resources = new Map(h.read(ex.calendarMachines)); resources.set("press1", { name: "Live press", area: "Press shop" });
        await h.commit(ex.calendarMachines, resources);
        await press(within(slot(container, "toolbar")).getByRole("radio", { name: "Resources" }));
        expect(slot(container, "main").textContent).toContain("Live press");
    });
    test("Resources keeps Day selected and keyboard navigation skips disabled periods", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await press(within(slot(container, "toolbar")).getByRole("radio", { name: "Resources" }));
        const group = within(slot(container, "toolbar")).getByRole("radiogroup", { name: "Period" });
        const day = within(group).getByRole("radio", { name: "Day" });
        expect(within(group).getByRole("radio", { name: "Week" }).hasAttribute("disabled")).toBe(true);
        expect(within(group).getByRole("radio", { name: "Month" }).hasAttribute("disabled")).toBe(true);
        await act(async () => { day.focus(); fireEvent.keyDown(day, { key: "ArrowRight" }); });
        expect(document.activeElement).toBe(day); expect(day.getAttribute("aria-checked")).toBe("true");
    });
    test("readOnly retains selection and warnings without history, fields or record writes", async () => {
        const { container } = mount(ex.calendarReadOnly); await settle();
        expect(container.querySelector('[data-calendar-readonly]')).not.toBeNull();
        expect(within(slot(container, "toolbar")).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        expect(container.querySelector('[data-draggable]')).toBeNull();
        await press(event(container, "job", "job1"));
        expect(slot(container, "end").textContent).toContain("Mounting brackets");
        expect(container.querySelector('[data-calendar-event-actions]')).toBeNull();
        await act(async () => { fireEvent.keyDown(event(container, "job", "job1"), { key: "Delete" }); }); await settle();
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(h.read(ex.calendarJobs).get("job1")!.start).toEqual(some(new Date("2026-10-01T06:00:00Z")));
    });
    test("below 480px of main the agenda has explicit actions and no drag elements, and drafts and selection survive resize", async () => {
        const { container } = mount(ex.calendarMinimal); await settle();
        await press(event(container, "job", "job1"));
        await width(479);
        expect(container.querySelector('[data-calendar-agenda]')).not.toBeNull();
        expect(container.querySelector('[data-calendar-cell], [data-draggable], [data-edge]')).toBeNull();
        expect(card(container, "job", "job1").hasAttribute("data-selected")).toBe(true);
        await press(within(card(container, "job", "job1")).getByRole("button", { name: "Return to backlog" }));
        expect(card(container, "job", "job1")).toBeNull();
        expect(h.read(ex.calendarJobs).get("job1")!.start.type).toBe("some");
        await width(480);
        expect(container.querySelector('[data-calendar-agenda]')).toBeNull();
        await press(history(container, editingMessages.undo()));
        expect(event(container, "job", "job1")).not.toBeNull();
        await width(360);
        expect(card(container, "job", "job1")).not.toBeNull();
        await press(within(card(container, "job", "job1")).getByRole("button", { name: "Delete" }));
        await press(history(container, editingMessages.apply()));
        expect(h.read(ex.calendarJobs).has("job1")).toBe(false);
    });
});


describe("Calendar explicit action forms", () => {
    test("a bound template creates a typed event on the first free compatible resource; Undo removes the entire creation", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await press(within(slot(container, "start")).getByRole("button", { name: "Create" }));
        await press(within(document.body).getByRole("dialog").querySelector<HTMLButtonElement>('[data-part="footer"] button:last-child')
            ?? within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" }));
        const created = [...container.querySelectorAll<HTMLElement>('[data-calendar-event][data-drafted]')];
        expect(created).toHaveLength(1); expect(created[0]!.textContent).toContain("Bracket batch");
        expect(h.read(ex.calendarJobs).size).toBe(10);
        await press(history(container, editingMessages.undo()));
        expect(container.querySelectorAll('[data-calendar-event][data-drafted]')).toHaveLength(0);
        await press(history(container, editingMessages.redo()));
        await press(history(container, editingMessages.apply()));
        const row = [...h.read(ex.calendarJobs).values()].find(row => row.title === "Bracket batch")!;
        expect(row.machine).toEqual(some("lathe2")); expect(row.hours).toBe(4); expect(row.customer).toBe("");
    });
    test("the agenda schedules a backlog row from a shared form and returns the same row to backlog", async () => {
        const { container } = mount(ex.calendarOperations); await settle(); await width(390);
        await press(within(slot(container, "start")).getByRole("tab", { name: /Backlog/ }));
        await press([...slot(container, "start").querySelectorAll('[data-library-item]')].find(card => card.textContent?.includes("Torque-test fixtures"))!);
        await press(within(slot(container, "start")).getByRole("button", { name: "Schedule" }));
        await press(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Schedule" }));
        expect(card(container, "job", "backlog1")).not.toBeNull();
        expect(h.read(ex.calendarJobs).get("backlog1")!.start.type).toBe("none");
        await press(history(container, editingMessages.apply()));
        expect(h.read(ex.calendarJobs).get("backlog1")!.start.type).toBe("some");
        await press(within(card(container, "job", "backlog1")).getByRole("button", { name: "Return to backlog" }));
        await press(history(container, editingMessages.apply()));
        expect(h.read(ex.calendarJobs).get("backlog1")!.start.type).toBe("none");
        expect(h.read(ex.calendarJobs).get("backlog1")!.customer).toBe("Alder Works");
    });
    test("an explicit placement displays canDrop's refusal and records no draft", async () => {
        const guarded = { fn: East.function([], UIComponentType, _$ => Reactive.Root(East.function([], UIComponentType, $ => {
            const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
            return Calendar({ view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
                events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end" }) },
                canDrop: East.function([Calendar.Types.Candidate], OptionType(StringType), () => some("Closed for maintenance")),
            });
        }))) };
        const { container } = mount(guarded); await settle(); await width(390);
        await press(within(card(container, "job", "job1")).getByRole("button", { name: "Move" }));
        const dialog = within(document.body).getByRole("dialog");
        await press(within(dialog).getByRole("button", { name: "Move" }));
        expect(within(dialog).getByRole("alert").textContent).toBe("Closed for maintenance");
        expect(container.querySelector('[data-calendar-card][data-drafted]')).toBeNull();
    });
    test("Calendar drafts outlive a renderer remount and Discard restores the record", async () => {
        const first = mount(ex.calendarMinimal); await settle(); await width(390);
        await press(within(card(first.container, "job", "job1")).getByRole("button", { name: "Delete" }));
        first.unmount();
        const second = mount(ex.calendarMinimal); await settle();
        expect(card(second.container, "job", "job1")).toBeNull();
        expect(h.read(ex.calendarJobs).has("job1")).toBe(true);
        await press(history(second.container, editingMessages.discard()));
        expect(card(second.container, "job", "job1")).not.toBeNull();
    });
    test("two Calendars over the same record keep their drafts and selection isolated", async () => {
        const first = mount(ex.calendarMinimal, "first"); const second = mount(ex.calendarMinimal, "second"); await settle();
        await press(event(first.container, "job", "job1"));
        await act(async () => { fireEvent.keyDown(event(first.container, "job", "job1"), { key: "Delete" }); }); await settle();
        expect(event(first.container, "job", "job1")).toBeNull();
        expect(event(second.container, "job", "job1")).not.toBeNull();
        expect(second.container.querySelector('[data-selected]')).toBeNull();
        expect(history(second.container, editingMessages.apply()).hasAttribute("disabled")).toBe(true);
        await press(history(first.container, editingMessages.undo()));
        expect(event(first.container, "job", "job1")).not.toBeNull();
    });
    test("the shared Slice search narrows events without changing their record", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        const search = within(slot(container, "toolbar")).getByPlaceholderText("Search…");
        const user = userEvent.setup(); await user.type(search, "Mounting"); await settle();
        const names = [...container.querySelectorAll('[data-calendar-event]')].map(node => node.getAttribute("aria-label"));
        expect(names).toHaveLength(2); expect(names.every(name => /mounting/i.test(name ?? ""))).toBe(true);
        expect(h.read(ex.calendarJobs).size).toBe(10);
        await user.clear(search); await settle(); expect(container.querySelectorAll('[data-calendar-event]').length).toBeGreaterThan(2);
    });
    test("a custom inspector's complete row update is undoable and saves through the appointment record", async () => {
        const { container } = mount(ex.calendarCustomInspector); await settle();
        await press(event(container, "appointment", "check"));
        const input = within(slot(container, "end")).getByPlaceholderText("Appointment title");
        await act(async () => { fireEvent.change(input, { target: { value: "Checked" } }); fireEvent.blur(input); }); await settle();
        expect(h.read(ex.calendarAppointments).get("check")!.title).toBe("Safety check");
        expect(event(container, "appointment", "check").textContent).toContain("Checked");
        await press(history(container, editingMessages.undo()));
        expect(event(container, "appointment", "check").textContent).toContain("Safety check");
        await press(history(container, editingMessages.redo())); await press(history(container, editingMessages.apply()));
        expect(h.read(ex.calendarAppointments).get("check")!.title).toBe("Checked");
    });
    test("a kind's ready check blocks Save and points to the invalid field", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        await press(event(container, "job", "job1"));
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="hours"] input')!;
        const user = userEvent.setup(); await user.clear(input); await user.type(input, "0{Enter}"); await settle();
        expect(history(container, editingMessages.apply()).hasAttribute("disabled")).toBe(true);
        expect(event(container, "job", "job1").hasAttribute("data-drafted")).toBe(true);
        expect(container.textContent).toContain("Duration must be positive");
        await act(async () => { fireEvent.keyDown(event(container, "job", "job1"), { key: "Escape" }); }); await settle();
        await press(history(container, editingMessages.issues({ n: 1, count: "1" })));
        expect(event(container, "job", "job1").hasAttribute("data-selected")).toBe(true);
        expect(h.read(ex.calendarJobs).get("job1")!.hours).toBeGreaterThan(0);
    });
    test("a refused kind keeps its drafts while another kind's patch commits", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        for (const [kind, key] of [["job", "job1"], ["service", "service1"]]) {
            await press(event(container, kind!, key!));
            await act(async () => { fireEvent.keyDown(event(container, kind!, key!), { key: "Delete" }); }); await settle();
        }
        initializeRecordApi({ ...h.memory, mutate: async (ws, record, mutation, request) => (record === ex.calendarJobs.name
            ? { outcome: variant("failed", { exitCode: 1n, stderr: "Record is locked" }) }
            : h.memory.mutate(ws, record, mutation, request)) as Awaited<ReturnType<RecordApi["mutate"]>> }, h.cache, WORKSPACE);
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner="rejected"]')?.textContent).toContain("Record is locked");
        expect(h.read(ex.calendarJobs).has("job1")).toBe(true); expect(h.read(ex.calendarServices).has("service1")).toBe(false);
        expect(event(container, "job", "job1")).toBeNull();
        await press(history(container, editingMessages.discard()));
        expect(event(container, "job", "job1")).not.toBeNull(); expect(event(container, "service", "service1")).toBeNull();
    });
    test("a lost response retries the same request without writing the other kind twice", async () => {
        const { container } = mount(ex.calendarOperations); await settle();
        for (const [kind, key] of [["job", "job1"], ["service", "service1"]]) {
            await press(event(container, kind!, key!));
            await act(async () => { fireEvent.keyDown(event(container, kind!, key!), { key: "Delete" }); }); await settle();
        }
        const keys: (string | undefined)[] = []; let lost = true;
        initializeRecordApi({ ...h.memory, mutate: async (ws, record, mutation, request) => {
            const result = await h.memory.mutate(ws, record, mutation, request);
            if (record === ex.calendarJobs.name) { keys.push(request.idempotencyKey); if (lost) { lost = false; throw new Error("Connection closed"); } }
            return result;
        } }, h.cache, WORKSPACE);
        await press(history(container, editingMessages.apply()));
        expect(container.querySelector('[data-session-banner="unknown"]')).not.toBeNull();
        expect(h.read(ex.calendarServices).has("service1")).toBe(false);
        await press(history(container, editingMessages.retryRequest()));
        expect(keys).toHaveLength(2); expect(keys[0]).toBeDefined(); expect(keys[0]).toBe(keys[1]);
        expect(container.querySelector('[data-session-banner]')).toBeNull();
        for (const record of [ex.calendarJobs, ex.calendarServices]) expect((await h.memory.history(WORKSPACE, record.name, undefined)).commits.map(commit => commit.mutation)).toEqual(["patch", "$init"]);
    });

});
