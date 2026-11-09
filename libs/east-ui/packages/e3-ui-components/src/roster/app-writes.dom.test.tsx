/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * An app's own writes of a duty — its form for the duty, and its library
 * cards — carry what they leave as it was, as the Roster's own move does
 * (#1584). A write that changes a duty's shift keeps it on its day: D.
 * Bracken's Sunday early made a night. Times the write leaves as they were
 * move with the shift, kept against its start; times it gives are its own,
 * refused where they start on another day. A write that changes a duty's team
 * keeps its activity only where the new team offers it: D. Bracken's Sunday
 * cross-dock made Picking's loses it, and B. Swale's Sunday general duties made
 * Inbound's keep them, a shared duty; an activity the write gives is held to
 * the new team.
 */
import { describe, expect, test } from "vitest";
import { within } from "@testing-library/react";
import { East, FunctionType, NullType, equalFor, none, some } from "@elaraai/east";
import { Button, Reactive, Stack, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { START, assignment, at, cell, drop, libraryCard, press, rosterHarness, slot } from "./harness.test-utils.js";
const h = rosterHarness();
const sameDuty = equalFor(ex.WarehouseDuty);

/**
 * The warehouse's Roster on Sunday, its duties' activities its own, whose duty's own form, Shifts tab and Teams tab
 * each write a duty's shift or team: the form's Night shift its shift alone, Night shift from 7 am its own times with
 * it, an hour on; Picking team its team alone, and with order picking or put-away an activity with it; each Shifts
 * card its shift alone, and each Teams card its team alone.
 */
const appWrites = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const rota = $.let(Record.bind(ex.rosterDuties, ["patch"]));
        const people = $.let(Data.bind(ex.rosterStaff));
        const firms = $.let(Data.bind(ex.rosterAgencies));
        const times = $.let(Data.bind(ex.rosterShiftTimes));
        const teams = $.let(Data.bind(ex.rosterTeams));
        const acts = $.let(Data.bind(ex.rosterActivities));
        const form = $.const(East.function([ex.WarehouseDuty, FunctionType([ex.WarehouseDuty], NullType)], UIComponentType, (_$2, row, update) => Stack.Root([
            Button.Root("Night shift", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: "night", team: row.team, role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
            Button.Root("Night shift from 7 am", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start.addHours(1n), end: row.end.addHours(1n), shift: "night", team: row.team, role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
            Button.Root("Picking team", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: row.shift, team: "picking", role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
            Button.Root("Picking team, order picking", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: row.shift, team: "picking", role: row.role, task: some("pick"),
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
            Button.Root("Picking team, put-away", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: row.shift, team: "picking", role: row.role, task: some("putaway"),
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
        ])));
        return Roster({
            id: "appWrites", inspector: true, week: { start: "sunday" }, view: { layout: "shifts", period: "day", date: START },
            events: { duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", activity: "task", inspector: form,
            }) },
            resources: {
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
            groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
            activities: Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
            library: [Roster.library.tab(times.read(), {
                name: "Shifts", icon: "clock", label: s => s.label, meta: s => some(s.code),
                drop: (_s, key) => Schedule.patch(ex.WarehouseDuty, { shift: key }),
            }), Roster.library.tab(teams.read(), {
                name: "Teams", icon: "table-columns", label: t => t.label, meta: t => some(t.costCentre),
                drop: (_t, key) => Schedule.patch(ex.WarehouseDuty, { team: key }),
            })],
        });
    }))),
};

describe("A write that changes a duty's shift keeps it on its day (#1584)", () => {
    test("the duty's own form: Sunday's early made a night with its times as they were runs Sunday's night, from 10 PM, and one given its own times an hour on, which start on Saturday's night, is refused", async () => {
        const { container: c } = await h.mount(appWrites);
        const before = await h.read(ex.rosterDuties);
        const end = () => slot(c, "end");
        await press(assignment(c, "s15"));
        // A night from 7 AM: Saturday's night's start, so refused, and the duty is still Sunday's early.
        await press(within(end()).getByRole("button", { name: "Night shift from 7 am" }));
        expect([...c.querySelectorAll("[role='alert']")].map(alert => alert.textContent))
            .toContain("A duty starts up to 12 hours before its shift's start, or less than 12 hours after it.");
        expect(cell(c, 0, "inbound", "early").contains(assignment(c, "s15"))).toBe(true);
        // The shift alone: its times move with it, kept against the shift's start.
        await press(within(end()).getByRole("button", { name: "Night shift" }));
        expect(cell(c, 0, "inbound", "night").contains(assignment(c, "s15"))).toBe(true);
        await press(within(slot(c, "toolbar")).getByRole("button", { name: "Save" }));
        expect(sameDuty((await h.read(ex.rosterDuties)).get("s15")!,
            { ...before.get("s15")!, shift: "night", start: at("2028-03-05T22:00:00"), end: at("2028-03-06T06:00:00") })).toBe(true);
    });
    test("a library card: the Night card dropped on Sunday's early runs Sunday's night, from 10 PM, its times kept against the shift's start", async () => {
        const { container: c } = await h.mount(appWrites);
        const before = await h.read(ex.rosterDuties);
        await drop(await libraryCard(c, "Night"), assignment(c, "s15"));
        expect(cell(c, 0, "inbound", "night").contains(assignment(c, "s15"))).toBe(true);
        await press(within(slot(c, "toolbar")).getByRole("button", { name: "Save" }));
        expect(sameDuty((await h.read(ex.rosterDuties)).get("s15")!,
            { ...before.get("s15")!, shift: "night", start: at("2028-03-05T22:00:00"), end: at("2028-03-06T06:00:00") })).toBe(true);
    });
});

describe("A write that changes a duty's team keeps its activity only where the new team offers it (#1584)", () => {
    test("the duty's own form: Sunday's cross-dock early made Picking's loses its cross-dock, which Picking doesn't offer; one given order picking with it takes it, and one given put-away, which Picking doesn't offer, is refused", async () => {
        const { container: c } = await h.mount(appWrites);
        const before = await h.read(ex.rosterDuties);
        const end = () => slot(c, "end");
        await press(assignment(c, "s15"));
        // Put-away with it: an Inbound skill, so refused, and the duty is still Inbound's.
        await press(within(end()).getByRole("button", { name: "Picking team, put-away" }));
        expect([...c.querySelectorAll("[role='alert']")].map(alert => alert.textContent)).toContain("Choose an activity for this group, or a shared duty.");
        expect(cell(c, 0, "inbound", "early").contains(assignment(c, "s15"))).toBe(true);
        // The team alone: its cross-dock, an Inbound skill, goes.
        await press(within(end()).getByRole("button", { name: "Picking team" }));
        expect(cell(c, 0, "picking", "early").contains(assignment(c, "s15"))).toBe(true);
        // H. Aspen's Sunday early given order picking with the team: Picking's own skill, so taken.
        await press(assignment(c, "s6"));
        await press(within(end()).getByRole("button", { name: "Picking team, order picking" }));
        expect(cell(c, 0, "picking", "early").contains(assignment(c, "s6"))).toBe(true);
        await press(within(slot(c, "toolbar")).getByRole("button", { name: "Save" }));
        const saved = await h.read(ex.rosterDuties);
        expect([sameDuty(saved.get("s15")!, { ...before.get("s15")!, team: "picking", task: none }),
            sameDuty(saved.get("s6")!, { ...before.get("s6")!, team: "picking", task: some("pick") })]).toEqual([true, true]);
    });
    test("a library card: the Picking card dropped on Sunday's cross-dock early clears the cross-dock, and the Inbound card dropped on Sunday's late general duties keeps them, a shared duty every team offers", async () => {
        const { container: c } = await h.mount(appWrites);
        const before = await h.read(ex.rosterDuties);
        await press(within(slot(c, "start")).getByRole("tab", { name: /^Teams/ }));
        await drop(await libraryCard(c, "Picking"), assignment(c, "s15"));
        expect(cell(c, 0, "picking", "early").contains(assignment(c, "s15"))).toBe(true);
        await drop(await libraryCard(c, "Inbound"), assignment(c, "s227"));
        expect(cell(c, 0, "inbound", "late").contains(assignment(c, "s227"))).toBe(true);
        await press(within(slot(c, "toolbar")).getByRole("button", { name: "Save" }));
        const saved = await h.read(ex.rosterDuties);
        expect([sameDuty(saved.get("s15")!, { ...before.get("s15")!, team: "picking", task: none }),
            sameDuty(saved.get("s227")!, { ...before.get("s227")!, team: "inbound" })]).toEqual([true, true]);
    });
});
