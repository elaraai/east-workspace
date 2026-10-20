/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, OptionType, StringType, some } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Calendar, Record } from "@elaraai/e3-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { patchRecord } from "../e3-web.test-utils.js";
import { act, calendarHarness, card, event, settle, slot, width } from "./harness.test-utils.js";
const h = calendarHarness();
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
const jobs = () => h.read(ex.calendarJobs);
const commits = async (record: { name: string }) => (await h.history(record)).commits.map(commit => commit.mutation);

describe("Calendar in the shared frame", () => {
    test("the bound operations calendar has one toolbar, ordered library tabs, three event kinds and cross-kind overlaps", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        expect(container.querySelectorAll("[data-builder-frame]")).toHaveLength(1);
        expect(slot(container, "toolbar")).not.toBeNull();
        expect([...slot(container, "start").querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["Templates 6", "Backlog 4", "Technicians 3"]);
        expect(event(container, "job", "job1").textContent).toContain("Mounting brackets");
        expect(event(container, "service", "service1").hasAttribute("data-overlap")).toBe(true);
        expect(event(container, "shift", "shift1").hasAttribute("data-overlap")).toBe(false);
        expect(container.querySelector("[data-calendar-overlaps]")?.textContent).toContain("1");
        const footer = container.querySelector("[data-calendar-footer]")!;
        expect([...footer.children].map(item => item.getAttribute("data-calendar-legend"))).toEqual(["job", "service", "shift"]);
        expect(footer.textContent).not.toMatch(/pending|backlog|saved|events in view/);
    });
    test("optional library and inspector really omit their panes; every example is the same Calendar", async () => {
        const { container } = await h.mount(ex.calendarMinimal);
        expect(slot(container, "start")).toBeNull(); expect(slot(container, "end")).toBeNull();
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(history(container, editingMessages.apply())).not.toBeNull();
    });
    test("selection, multi-selection, empty grid and Escape use canonical event identities", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(event(container, "job", "job1"));
        expect(slot(container, "end").textContent).toContain("Mounting brackets");
        await act(async () => { fireEvent.click(event(container, "service", "service1"), { ctrlKey: true }); }); await settle();
        expect(container.querySelectorAll("[data-calendar-event][data-selected]")).toHaveLength(2);
        expect(slot(container, "end").textContent).toContain("2 events");
        await act(async () => { fireEvent.keyDown(event(container, "job", "job1"), { key: "Escape" }); }); await settle();
        expect(container.querySelectorAll("[data-calendar-event][data-selected]")).toHaveLength(0);
    });
    test("editing a field drafts, Undo and Redo share history, and Save patches the original record", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        const deployed = await commits(ex.calendarJobs);
        await press(event(container, "job", "job1"));
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        const user = userEvent.setup(); await user.clear(input); await user.type(input, "New customer{Enter}"); await settle();
        expect((await jobs()).get("job1")!.customer).toBe("Alder Works");
        expect(event(container, "job", "job1").hasAttribute("data-drafted")).toBe(true);
        await press(history(container, editingMessages.undo()));
        expect((slot(container, "end").querySelector('[data-field="customer"] input') as HTMLInputElement).value).toBe("Alder Works");
        await press(history(container, editingMessages.redo()));
        await press(history(container, editingMessages.apply()));
        expect((await jobs()).get("job1")!.customer).toBe("New customer");
        expect(event(container, "job", "job1").hasAttribute("data-drafted")).toBe(false);
        // One commit, through the record's patch door.
        expect(await commits(ex.calendarJobs)).toEqual(["patch", ...deployed]);
    });
    test("bound template and resource records another session changes update their library and headers", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        const templates = new Map(await h.read(ex.calendarJobTemplates));
        templates.set("brackets", { ...templates.get("brackets")!, name: "Live template" });
        await h.patch(ex.calendarJobTemplates, templates);
        await waitFor(() => expect(slot(container, "start").textContent).toContain("Live template"));
        const resources = new Map(await h.read(ex.calendarMachines)); resources.set("press1", { name: "Live press", area: "Press shop" });
        await h.patch(ex.calendarMachines, resources);
        await press(within(slot(container, "toolbar")).getByRole("radio", { name: "Resources" }));
        await waitFor(() => expect(slot(container, "main").textContent).toContain("Live press"));
    });
    test("Resources hides the fixed period and returning to Calendar restores the chosen period", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        const toolbar = within(slot(container, "toolbar"));
        for (const name of ["Week", "Month"]) {
            await press(toolbar.getByRole("radio", { name }));
            await press(toolbar.getByRole("radio", { name: "Resources" }));
            expect(toolbar.queryByRole("radiogroup", { name: "Period" })).toBeNull();
            expect(container.querySelector('[data-calendar-time-grid]')).not.toBeNull();
            await press(toolbar.getByRole("radio", { name: "Calendar" }));
            expect(toolbar.getByRole("radio", { name }).getAttribute("aria-checked")).toBe("true");
        }
    });
    test("readOnly retains selection and warnings without history, fields or record writes", async () => {
        const { container } = await h.mount(ex.calendarReadOnly);
        expect(container.querySelector('[data-calendar-readonly]')).not.toBeNull();
        expect(within(slot(container, "toolbar")).queryByRole("button", { name: editingMessages.apply() })).toBeNull();
        expect(container.querySelector('[data-draggable]')).toBeNull();
        await press(event(container, "job", "job1"));
        expect(slot(container, "end").textContent).toContain("Mounting brackets");
        expect(container.querySelector('[data-calendar-event-actions]')).toBeNull();
        await act(async () => { fireEvent.keyDown(event(container, "job", "job1"), { key: "Delete" }); }); await settle();
        expect(event(container, "job", "job1")).not.toBeNull();
        expect((await jobs()).get("job1")!.start).toEqual(some(new Date("2026-10-01T06:00:00Z")));
        expect(h.requests("mutate")).toEqual([]);
    });
    test("below 480px of main the agenda has explicit actions and no drag elements, and drafts and selection survive resize", async () => {
        const { container } = await h.mount(ex.calendarMinimal);
        await press(event(container, "job", "job1"));
        await width(479);
        expect(container.querySelector('[data-calendar-agenda]')).not.toBeNull();
        expect(container.querySelector('[data-calendar-cell], [data-draggable], [data-edge]')).toBeNull();
        expect(card(container, "job", "job1").hasAttribute("data-selected")).toBe(true);
        await press(within(card(container, "job", "job1")).getByRole("button", { name: "Return to backlog" }));
        expect(card(container, "job", "job1")).toBeNull();
        expect((await jobs()).get("job1")!.start.type).toBe("some");
        await width(480);
        expect(container.querySelector('[data-calendar-agenda]')).toBeNull();
        await press(history(container, editingMessages.undo()));
        expect(event(container, "job", "job1")).not.toBeNull();
        await width(360);
        expect(card(container, "job", "job1")).not.toBeNull();
        await press(within(card(container, "job", "job1")).getByRole("button", { name: "Delete" }));
        await press(history(container, editingMessages.apply()));
        expect((await jobs()).has("job1")).toBe(false);
    });
});


describe("Calendar explicit action forms", () => {
    test("a bound template creates a typed event on the first free compatible resource; Undo removes the entire creation", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(within(slot(container, "start")).getByRole("button", { name: "Create" }));
        await press(within(document.body).getByRole("dialog").querySelector<HTMLButtonElement>('[data-part="footer"] button:last-child')
            ?? within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Create" }));
        const created = [...container.querySelectorAll<HTMLElement>('[data-calendar-event][data-drafted]')];
        expect(created).toHaveLength(1); expect(created[0]!.textContent).toContain("Bracket batch");
        expect((await jobs()).size).toBe(10);
        await press(history(container, editingMessages.undo()));
        expect(container.querySelectorAll('[data-calendar-event][data-drafted]')).toHaveLength(0);
        await press(history(container, editingMessages.redo()));
        await press(history(container, editingMessages.apply()));
        const row = [...(await jobs()).values()].find(row => row.title === "Bracket batch")!;
        expect(row.machine).toEqual(some("lathe2")); expect(row.hours).toBe(4); expect(row.customer).toBe("");
    });
    test("the agenda schedules a backlog row from a shared form and returns the same row to backlog", async () => {
        const { container } = await h.mount(ex.calendarOperations); await width(390);
        await press(within(slot(container, "start")).getByRole("tab", { name: /Backlog/ }));
        await press([...slot(container, "start").querySelectorAll('[data-library-item]')].find(card => card.textContent?.includes("Torque-test fixtures"))!);
        await press(within(slot(container, "start")).getByRole("button", { name: "Schedule" }));
        await press(within(within(document.body).getByRole("dialog")).getByRole("button", { name: "Schedule" }));
        expect(card(container, "job", "backlog1")).not.toBeNull();
        expect((await jobs()).get("backlog1")!.start.type).toBe("none");
        await press(history(container, editingMessages.apply()));
        expect((await jobs()).get("backlog1")!.start.type).toBe("some");
        await press(within(card(container, "job", "backlog1")).getByRole("button", { name: "Return to backlog" }));
        await press(history(container, editingMessages.apply()));
        expect((await jobs()).get("backlog1")!.start.type).toBe("none");
        expect((await jobs()).get("backlog1")!.customer).toBe("Alder Works");
    });
    test("an explicit placement displays canDrop's refusal and records no draft", async () => {
        const guarded = { fn: East.function([], UIComponentType, _$ => Reactive.Root(East.function([], UIComponentType, $ => {
            const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
            return Calendar({ view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
                events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end" }) },
                canDrop: East.function([Calendar.Types.Candidate], OptionType(StringType), () => some("Closed for maintenance")),
            });
        }))) };
        const { container } = await h.mount(guarded); await width(390);
        await press(within(card(container, "job", "job1")).getByRole("button", { name: "Move" }));
        const dialog = within(document.body).getByRole("dialog");
        await press(within(dialog).getByRole("button", { name: "Move" }));
        expect(within(dialog).getByRole("alert").textContent).toBe("Closed for maintenance");
        expect(container.querySelector('[data-calendar-card][data-drafted]')).toBeNull();
    });
    test("Calendar drafts outlive a renderer remount and Discard restores the record", async () => {
        const first = await h.mount(ex.calendarMinimal); await width(390);
        await press(within(card(first.container, "job", "job1")).getByRole("button", { name: "Delete" }));
        first.unmount();
        const second = await h.mount(ex.calendarMinimal);
        expect(card(second.container, "job", "job1")).toBeNull();
        expect((await jobs()).has("job1")).toBe(true);
        await press(history(second.container, editingMessages.discard()));
        expect(card(second.container, "job", "job1")).not.toBeNull();
    });
    test("two Calendars over the same record keep their drafts and selection isolated", async () => {
        const first = await h.mount(ex.calendarMinimal, { storageKey: "first" }); const second = await h.mount(ex.calendarMinimal, { storageKey: "second" });
        await press(event(first.container, "job", "job1"));
        await act(async () => { fireEvent.keyDown(event(first.container, "job", "job1"), { key: "Delete" }); }); await settle();
        expect(event(first.container, "job", "job1")).toBeNull();
        expect(event(second.container, "job", "job1")).not.toBeNull();
        expect(second.container.querySelector('[data-selected]')).toBeNull();
        expect(history(second.container, editingMessages.apply()).hasAttribute("disabled")).toBe(true);
        await press(history(first.container, editingMessages.undo()));
        expect(event(first.container, "job", "job1")).not.toBeNull();
    });
    test("a custom inspector's complete row update is undoable and saves through the appointment record", async () => {
        const { container } = await h.mount(ex.calendarCustomInspector);
        await press(event(container, "appointment", "check"));
        const input = within(slot(container, "end")).getByPlaceholderText("Appointment title");
        await act(async () => { fireEvent.change(input, { target: { value: "Checked" } }); fireEvent.blur(input); }); await settle();
        expect((await h.read(ex.calendarAppointments)).get("check")!.title).toBe("Safety check");
        expect(event(container, "appointment", "check").textContent).toContain("Checked");
        await press(history(container, editingMessages.undo()));
        expect(event(container, "appointment", "check").textContent).toContain("Safety check");
        await press(history(container, editingMessages.redo())); await press(history(container, editingMessages.apply()));
        expect((await h.read(ex.calendarAppointments)).get("check")!.title).toBe("Checked");
    });
    test("a kind's ready check blocks Save and points to the invalid field", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(event(container, "job", "job1"));
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="hours"] input')!;
        const user = userEvent.setup(); await user.clear(input); await user.type(input, "0{Enter}"); await settle();
        expect(history(container, editingMessages.apply()).hasAttribute("disabled")).toBe(true);
        expect(event(container, "job", "job1").hasAttribute("data-drafted")).toBe(true);
        expect(container.textContent).toContain("Duration must be positive");
        await act(async () => { fireEvent.keyDown(event(container, "job", "job1"), { key: "Escape" }); }); await settle();
        await press(history(container, editingMessages.issues({ n: 1, count: "1" })));
        expect(event(container, "job", "job1").hasAttribute("data-selected")).toBe(true);
        expect((await jobs()).get("job1")!.hours).toBeGreaterThan(0);
    });
    test("a kind whose record another session changes while its Save is out conflicts and keeps its drafts, while another kind's patch commits", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        for (const [kind, key] of [["job", "job1"], ["service", "service1"]]) {
            await press(event(container, kind!, key!));
            await act(async () => { fireEvent.keyDown(event(container, kind!, key!), { key: "Delete" }); }); await settle();
        }
        // The jobs' patch held on its way to e3 while another session changes the job it deletes.
        const jobsWrite = h.e3.hold(request => request.kind === "mutate" && request.record === ex.calendarJobs.name);
        await act(async () => { fireEvent.click(history(container, editingMessages.apply())); });
        await jobsWrite.holding;
        const others = new Map(await jobs());
        others.set("job1", { ...others.get("job1")!, customer: "Changed elsewhere" });
        await patchRecord(h.e3, h.workspace, ex.calendarJobs, others);
        await act(async () => { jobsWrite.release(); });
        await settle();
        expect(container.querySelector('[data-session-banner="conflict"]')).not.toBeNull();
        expect((await jobs()).get("job1")!.customer).toBe("Changed elsewhere");
        expect((await h.read(ex.calendarServices)).has("service1")).toBe(false);
        expect(event(container, "job", "job1")).toBeNull();
        await press(history(container, editingMessages.discard()));
        expect(event(container, "job", "job1")).not.toBeNull(); expect(event(container, "service", "service1")).toBeNull();
    });
    test("a write whose answers are lost leaves its kind unknown; Retry resends the same request, and nothing is written twice", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        for (const [kind, key] of [["job", "job1"], ["service", "service1"]]) {
            await press(event(container, kind!, key!));
            await act(async () => { fireEvent.keyDown(event(container, kind!, key!), { key: "Delete" }); }); await settle();
        }
        const deployed = { jobs: await commits(ex.calendarJobs), services: await commits(ex.calendarServices) };
        // Every answer to the jobs' patch is lost on its way back: it reaches e3, and the client tries again under the
        // same key until it gives up, which leaves the write unknown.
        const losing = h.e3.fail(request => request.kind === "mutate" && request.record === ex.calendarJobs.name, "lost");
        await act(async () => { fireEvent.click(history(container, editingMessages.apply())); });
        await waitFor(() => expect(container.querySelector('[data-session-banner="unknown"]')).not.toBeNull(), { timeout: 15_000 });
        expect((await h.read(ex.calendarServices)).has("service1")).toBe(false);
        losing();
        await press(history(container, editingMessages.retryRequest()));
        const sent = h.requests("mutate", ex.calendarJobs.name).map(request => request.idempotencyKey);
        expect(sent.length).toBeGreaterThan(1); expect(sent[0]).toBeDefined();
        expect(new Set(sent).size).toBe(1);
        expect(container.querySelector('[data-session-banner]')).toBeNull();
        expect(await commits(ex.calendarJobs)).toEqual(["patch", ...deployed.jobs]);
        expect(await commits(ex.calendarServices)).toEqual(["patch", ...deployed.services]);
    });

});
