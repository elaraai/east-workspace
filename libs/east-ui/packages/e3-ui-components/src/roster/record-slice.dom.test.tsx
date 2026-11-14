/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { East, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, variant } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster-records";
import * as rx from "@elaraai/e3-ui/examples/roster/roster";
import { act, assignment, open, press, rosterHarness, settle, slot, START, weekDuties, width } from "./harness.test-utils.js";

// The indexed examples read the warehouse's activities, cover targets and suggestions beside their own records.
const h = rosterHarness({ "roster/roster-records": ex });
/** The indexed staff's, weeks' and duties' records, as the request log names their datasets. */
const STAFF = "records.indexed_roster_staff", WEEKS = "records.indexed_roster_weeks", DUTIES = "records.indexed_roster_duties";

test("indexed staff visibility replaces atomically without narrowing coverage, and hidden edits Save the original duty on mobile", async () => {
    const { container, store, unmount } = await open(ex.rosterRecordIndexes);
    await waitFor(() => expect(assignment(container, "s37")).not.toBeNull());
    await settle();
    // The rail opens on Inbound: the staff are read through their group-then-name index.
    expect(h.requests(undefined, STAFF).some(request => request.query.get("index") === "staff_by_team_name")).toBe(true);
    const marks = () => [...slot(container, "main").querySelectorAll('[role="img"][aria-label]')].map(el => el.getAttribute("aria-label"));
    await act(async () => { fireEvent.click(within(assignment(container, "s37")).getByRole("button", { name: "Remove C. Clover" })); });
    await settle();
    const coverage = marks();
    const drafted = assignment(container, "s37");
    expect(drafted.hasAttribute("data-removed")).toBe(true);
    const key = "ex.rosterRecordIndexes.people";
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    // The staff's key searches held on their way to e3: the new narrowing stays pending.
    const searching = h.e3.hold(request => request.kind === "find" && request.dataset === STAFF);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, where: new Map([["name", variant("prefix", "Z. Nobody")]]), preset: none })); });
    await settle();
    expect(assignment(container, "s37")).toBe(drafted);
    // Retained (#1398, CL8): aria-disabled, never inert.
    const main = slot(container, "main").querySelector("[data-roster-main]")!;
    expect([main.getAttribute("aria-disabled"), main.hasAttribute("inert")]).toEqual(["true", false]);
    await act(async () => { searching.release(); });
    await waitFor(() => expect(assignment(container, "s37")).toBeNull());
    expect(marks()).toEqual(coverage);
    unmount();
    const again = await h.mount(ex.rosterRecordIndexes); await width(390);
    const save = within(slot(again.container, "toolbar")).getByRole("button", { name: "Save" });
    expect(save).toHaveProperty("disabled", false);
    // Save runs to its end — the narrowing's notice read, the commit, and its confirmation — and leaves nothing to save.
    await press(save);
    expect(within(slot(again.container, "toolbar")).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    const committed = await h.read(ex.indexedRosterDuties);
    expect(committed.has("s37")).toBe(false);
    expect(weekDuties(committed, START).size).toBe(315);
    // A year of duties and of weeks, and neither read whole.
    expect([h.requests("read", WEEKS), h.requests("read", DUTIES)]).toEqual([[], []]);
});

/**
 * The indexed Roster on the leads' own page (#1621): its people's source scoped to the position `lead` through the staff's
 * index by position — a narrowing the page holds and the viewer cannot clear — the rail offering no field beside it.
 */
const leadsPage = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rota = $.let(Record.bind(ex.indexedRosterDuties));
    const entries = $.let(Data.bindPaged(ex.indexedRosterDuties));
    const byTime = $.let(Data.bindPaged(ex.indexedRosterDuties, { indexes: ["indexed_roster_duties_by_time"] }));
    const weeks = $.let(Record.bind(ex.indexedRosterWeeks));
    const weekEntries = $.let(Data.bindPaged(ex.indexedRosterWeeks));
    const cover = $.let(Record.bind(rx.rosterCover));
    const staff = $.let(Data.bind(ex.indexedRosterStaff));
    const acts = $.let(Data.bind(rx.rosterActivities));
    const slice = $.let(Slice.bindRecords("spec.rosterLeads", {
        duty: { source: byTime, range: "start" },
        people: { source: Data.bindPaged(ex.indexedRosterStaff, { indexes: ["staff_by_position"] }), scope: { position: ["lead"] }, fields: {} },
    }));
    const firms = $.let(Data.bind(rx.rosterAgencies));
    const times = $.let(Data.bind(rx.rosterShiftTimes));
    const teams = $.let(Data.bind(rx.rosterTeams));
    const roles = $.let(Data.bind(rx.rosterPositions));
    return Roster({
        id: "rosterLeads", week: { start: "sunday" }, slice: { slice },
        view: { layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") },
        events: { duty: Schedule.events(rota, {
            name: "Duty", icon: "user-clock", entries,
            start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
            shift: "shift", group: "team", position: "role", activity: "task",
            hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
        }) },
        resources: {
            people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
            agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
        },
        periods: Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed", entries: weekEntries }),
        targets: Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" }),
        shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
        groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
        positions: Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order }),
        activities: Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
        rules: { rest: 10.0 },
        library: [Roster.library.people()],
    });
}))) };

/** Search Records' box, in the toolbar's row. */
const searchBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
/** The keys the box's lines name, in order: the listbox its input controls. */
const keysListed = (c: HTMLElement) => {
    const list = document.getElementById(searchBox(c).querySelector("input")!.getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => (option.textContent ?? "").split(" · ")[0]);
};

test("Search Records on the leads' own page lists the leads alone, in their keys' order (#1621): the staff it holds whole are held to the page's scope, asked of e3", async () => {
    const order = compareFor(StringType);
    const staff = await h.read(ex.indexedRosterStaff);
    const isLead = (key: string) => equalFor(StringType)(staff.get(key)!.position, "lead");
    // The pool, by key: the people a search of `pool-1` finds, whatever the page holds.
    const pool = [...staff.keys()].filter((key) => order(key, "pool-1") >= 0 && order(key, "pool-2") < 0).sort(order);
    const leads = pool.filter(isLead);
    expect(leads.length).toBeGreaterThan(0);
    const { container } = await open(leadsPage as never);
    await waitFor(() => expect(searchBox(container)).not.toBeNull());
    await settle();
    const input = searchBox(container).querySelector<HTMLInputElement>("input")!;
    await act(async () => { input.focus(); fireEvent.input(input, { target: { value: "pool-1" } }); });
    await settle();
    await waitFor(() => expect(keysListed(container).length).toBeGreaterThan(0), { timeout: 10_000 });
    const listed = keysListed(container);
    // The first of the pool's leads, as many as the box shows — and not the pool's first, among whom are people who lead nothing.
    expect(listed).toEqual(leads.slice(0, listed.length));
    expect(pool.slice(0, listed.length).every(isLead)).toBe(false);
});
