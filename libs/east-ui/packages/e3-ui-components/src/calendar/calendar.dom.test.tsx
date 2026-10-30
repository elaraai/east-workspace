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
import { act, calendarHarness, card, event, settle, slot, width } from "./harness.test-utils.js";
import { conflictCards } from "../e3-web-mount.test-utils.js";
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
        // The footer is the legend, the "…" a cut legend ends with, and the one shared loading line (#1398) — saying nothing once
        // the window has landed.
        const footer = container.querySelector("[data-calendar-footer]")!;
        expect([...footer.querySelectorAll(":scope > [data-calendar-legend]")].map(item => item.getAttribute("data-calendar-legend"))).toEqual(["job", "service", "shift"]);
        expect([...footer.children].every(item => item.hasAttribute("data-calendar-legend") || item.hasAttribute("data-footer-more")
            || item.hasAttribute("data-footer-line"))).toBe(true);
        expect(footer.querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
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


describe("the board keeps the keyboard (retest C4 and C5, 27 Oct 2026)", () => {
    /** The period the time navigator shows, as its trigger names it. */
    const period = (c: HTMLElement) => slot(c, "toolbar").querySelector("[data-time-navigation=calendar] [data-time-trigger]")?.textContent;
    const board = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-calendar-main]")!;

    test("Delete on the event the keyboard is on deletes it, the keyboard staying on the board, so Ctrl+Z there puts it back", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        const job = event(container, "job", "job1");
        await press(job);
        await act(async () => { job.focus(); });
        await act(async () => { fireEvent.keyDown(job, { key: "Delete" }); }); await settle();
        expect(event(container, "job", "job1")).toBeNull();
        // On the board, never the page's body: the keys go on to the Calendar.
        expect(document.activeElement).toBe(board(container));
        await act(async () => { fireEvent.keyDown(document.activeElement!, { key: "z", ctrlKey: true }); }); await settle();
        expect(event(container, "job", "job1")).not.toBeNull();
    });

    test("a click on an empty part of the board, or of the Backlog, puts the keyboard in the Calendar: `]` and `[` step its period from there", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        const user = userEvent.setup();
        const before = period(container);
        // The board's hours, clear of its events: a part of it that takes no gesture (jsdom lays no column out to draw in).
        await user.click(board(container).querySelector<HTMLElement>("[data-calendar-gutter]")!); await settle();
        expect(container.querySelector("[data-calendar-frame]")!.contains(document.activeElement)).toBe(true);
        await user.keyboard("]"); await settle();
        expect(period(container)).not.toBe(before);
        // The Backlog's list, clear of its cards.
        await press(within(slot(container, "start")).getByRole("tab", { name: /Backlog/ }));
        await act(async () => { (document.activeElement as HTMLElement | null)?.blur(); });
        await user.click(slot(container, "start").querySelector<HTMLElement>('[data-library$=".library.backlog"]')!); await settle();
        expect(container.querySelector("[data-calendar-frame]")!.contains(document.activeElement)).toBe(true);
        // `[[` is the `[` key in user-event's keys, whose `[` opens a key's name.
        await user.keyboard("[["); await settle();
        expect(period(container)).toBe(before);
    });

    test("Enter on an event, the Inspector folded, opens its Details — the key going no further than the Calendar", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(within(slot(container, "end")).getByRole("button", { name: "Collapse Inspector" }));
        expect(slot(container, "end").hasAttribute("data-collapsed")).toBe(true);
        const job = event(container, "job", "job1");
        await press(job);
        // A click selects it, and opens nothing.
        expect(slot(container, "end").hasAttribute("data-collapsed")).toBe(true);
        const heard: string[] = [];
        const hear = (e: KeyboardEvent) => { heard.push(e.key); };
        document.addEventListener("keydown", hear);
        try {
            await act(async () => { job.focus(); fireEvent.keyDown(job, { key: "Enter" }); }); await settle();
        } finally {
            document.removeEventListener("keydown", hear);
        }
        expect(slot(container, "end").hasAttribute("data-collapsed")).toBe(false);
        expect(slot(container, "end").textContent).toContain("Mounting brackets");
        expect(heard).toEqual([]);
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
            const jobs = $.let(Record.bind(ex.calendarJobs, ["patch"]));
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
    test("a kind whose record another session changes while its Save is out carries its drafts over — the job deleted here and changed there waits to be chosen — while another kind's patch commits", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        for (const [kind, key] of [["job", "job1"], ["service", "service1"]]) {
            await press(event(container, kind!, key!));
            await act(async () => { fireEvent.keyDown(event(container, kind!, key!), { key: "Delete" }); }); await settle();
        }
        // Another session changes the job it deletes while the jobs' patch is on its way to e3.
        await h.race(ex.calendarJobs, () => { fireEvent.click(history(container, editingMessages.apply())); }, (now) => {
            const others = new Map(now);
            others.set("job1", { ...others.get("job1")!, customer: "Changed elsewhere" });
            return others;
        });
        // The jobs' draft is carried over to the record as the other session left it: nothing is out of date, the deletion
        // stands until it is chosen, and Save is off.
        await waitFor(() => {
            expect([...container.querySelectorAll("[data-session-banner]")].map((b) => b.getAttribute("data-session-banner"))).toEqual(["conflicts"]);
            expect(slot(container, "toolbar").textContent).not.toContain(editingMessages.historyStatus({ status: "carrying" }));
        });
        expect(history(container, editingMessages.apply()).hasAttribute("disabled")).toBe(true);
        const [conflict, ...more] = await conflictCards(container);
        expect(more).toEqual([]);
        expect([conflict!.item, conflict!.yours]).toEqual(["job1", "Yours, Removed"]);
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

describe("the agenda keeps the keyboard as a card's action takes its card away (#1398)", () => {
    /** A card's control the focus is put on, then pressed: what holds the focus after. */
    async function pressFocused(control: HTMLElement): Promise<Element> {
        control.focus();
        expect(document.activeElement).toBe(control);
        await press(control);
        return document.activeElement ?? document.body;
    }
    /** The agenda's cards in its order, each by its event. */
    const cards = (c: HTMLElement) => [...c.querySelectorAll("[data-calendar-card]")].map(el => el.getAttribute("data-calendar-card")!);
    const cardOf = (c: HTMLElement, id: string) => [...c.querySelectorAll<HTMLElement>("[data-calendar-card]")].find(el => el.getAttribute("data-calendar-card") === id)!;
    /** The card an element stands in, by its event, and whether it is that card's head. */
    const standing = (el: Element) => {
        const at = el.closest("[data-calendar-card]");
        return [at?.getAttribute("data-calendar-card") ?? null, at !== null && at.querySelector("button") === el];
    };

    test("Delete and Return to backlog take a card away: the focus lands on the head of the card after it — the last one's, before it — never on the page's body", async () => {
        const { container } = await h.mount(ex.calendarOperations); await width(390);
        const order = cards(container);
        expect(order.length).toBeGreaterThan(3);
        let focused = await pressFocused(within(cardOf(container, order[0]!)).getByRole("button", { name: "Delete" }));
        expect(cards(container)).not.toContain(order[0]);
        expect(focused).not.toBe(document.body);
        expect(standing(focused)).toEqual([order[1], true]);
        // The first card that offers Return to backlog: the event goes to the Backlog, the focus to the card after it.
        const now = cards(container);
        const i = now.findIndex(id => within(cardOf(container, id)).queryByRole("button", { name: "Return to backlog" }) !== null);
        expect(i).toBeGreaterThanOrEqual(0);
        focused = await pressFocused(within(cardOf(container, now[i]!)).getByRole("button", { name: "Return to backlog" }));
        expect(cards(container)).not.toContain(now[i]);
        expect(standing(focused)).toEqual([now[i + 1] ?? now[i - 1], true]);
        // The agenda's last card: the focus lands on the one before it.
        const rest = cards(container);
        focused = await pressFocused(within(cardOf(container, rest.at(-1)!)).getByRole("button", { name: "Delete" }));
        expect(standing(focused)).toEqual([rest.at(-2), true]);
    });

    test("Move takes a card to another of the agenda's days, from the popover its card opened: the focus lands on its head there, never on the page's body", async () => {
        const { container } = await h.mount(ex.calendarOperations); await width(390);
        const days = [...container.querySelectorAll("[data-calendar-day]")].map(day => day.getAttribute("data-calendar-day"));
        const dayOf = (id: string) => cardOf(container, id)?.closest("[data-calendar-day]")?.getAttribute("data-calendar-day");
        // A card of Thursday 1 October, the week's fourth day: a day later is the agenda's Friday.
        const id = container.querySelector('[data-calendar-day="2026-10-01"] [data-calendar-card]')!.getAttribute("data-calendar-card")!;
        const move = within(cardOf(container, id)).getByRole("button", { name: "Move" });
        move.focus();
        await press(move);
        const dialog = within(document.body).getByRole("dialog");
        // A day later: the start's day stepped up, taken as the focus leaves its field.
        const start = dialog.querySelector<HTMLElement>('[data-field="start"]')!;
        const user = userEvent.setup();
        await user.click(start.querySelector<HTMLElement>('[role="spinbutton"][aria-label^="day"]')!);
        await user.keyboard("{ArrowUp}");
        while (start.contains(document.activeElement)) await user.tab();
        await settle();
        await press(within(dialog).getByRole("button", { name: "Move" }));
        expect(dayOf(id)).toBe("2026-10-02");
        expect(days).toContain("2026-10-02");
        const focused = document.activeElement ?? document.body;
        expect(focused).not.toBe(document.body);
        expect(standing(focused)).toEqual([id, true]);
    });
});

describe("the inspector keeps the keyboard as a control goes with its view (#1398)", () => {
    /** A Details control the focus is put on, then pressed: what holds the focus after — never the page's body. */
    async function pressFocused(control: HTMLElement): Promise<Element> {
        control.focus();
        expect(document.activeElement).toBe(control);
        await press(control);
        return document.activeElement ?? document.body;
    }
    test("Delete takes the event away: the focus lands on what the inspector shows in its place, Nothing selected, never on the page's body", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(event(container, "job", "job1"));
        const focused = await pressFocused(slot(container, "end").querySelector<HTMLElement>('[data-calendar-action="delete"]')!);
        expect(event(container, "job", "job1")).toBeNull();
        expect(focused).not.toBe(document.body);
        expect([focused.hasAttribute("data-focus-home"), slot(container, "end").contains(focused), focused.textContent]).toEqual([
            true, true, "Nothing selectedSelect an event to inspect its schedule and fields.",
        ]);
    });
    test("Return to backlog goes with the scheduled event's actions: the focus lands on the event's heading, never on the page's body", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(event(container, "job", "job1"));
        const focused = await pressFocused(slot(container, "end").querySelector<HTMLElement>('[data-calendar-action="unschedule"]')!);
        // The event is in the backlog now, Details showing it unscheduled.
        expect(slot(container, "end").querySelector('[data-calendar-action="unschedule"]')).toBeNull();
        expect(focused).not.toBe(document.body);
        expect([focused.hasAttribute("data-focus-home"), focused.querySelector("[data-inspector-title]")?.textContent, focused.querySelector("[data-inspector-when]")?.textContent])
            .toEqual([true, "Mounting brackets · batch 42", "Unscheduled"]);
    });
    test("Delete selected takes several away: the focus lands on Nothing selected, never on the page's body", async () => {
        const { container } = await h.mount(ex.calendarOperations);
        await press(event(container, "job", "job1"));
        await act(async () => { fireEvent.click(event(container, "service", "service1"), { ctrlKey: true }); }); await settle();
        const focused = await pressFocused(within(slot(container, "end")).getByRole("button", { name: "Delete selected" }));
        expect(focused).not.toBe(document.body);
        expect([focused.hasAttribute("data-focus-home"), focused.textContent]).toEqual([true, "Nothing selectedSelect an event to inspect its schedule and fields."]);
    });
});
