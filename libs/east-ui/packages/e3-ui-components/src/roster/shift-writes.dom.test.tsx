/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * A write that changes a duty's shift keeps it on its day (#1584), as the
 * Roster's own move to another shift does: an app's form for the duty, and a
 * library card, each writing D. Bracken's Sunday early a night. Times the
 * write leaves as they were move with the shift, kept against its start;
 * times it gives are its own, refused where they start on another day.
 */
import { describe, expect, test } from "vitest";
import { within } from "@testing-library/react";
import { East, FunctionType, NullType, equalFor, some } from "@elaraai/east";
import { Button, Reactive, Stack, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { assignment, at, cell, drop, libraryCard, press, rosterHarness, slot } from "./harness.test-utils.js";
const h = rosterHarness();
const sameDuty = equalFor(ex.WarehouseDuty);

/**
 * The warehouse's Roster on Sunday, whose duty's own form and Shifts tab each write a duty's shift: the form's Night
 * shift its shift alone, Night shift from 7 am its own times with it, an hour on; each Shifts card its shift alone.
 */
const shiftWrites = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const rota = $.let(Record.bind(ex.rosterDuties, ["patch"]));
        const people = $.let(Data.bind(ex.rosterStaff));
        const firms = $.let(Data.bind(ex.rosterAgencies));
        const times = $.let(Data.bind(ex.rosterShiftTimes));
        const teams = $.let(Data.bind(ex.rosterTeams));
        const form = $.const(East.function([ex.WarehouseDuty, FunctionType([ex.WarehouseDuty], NullType)], UIComponentType, (_$2, row, update) => Stack.Root([
            Button.Root("Night shift", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: "night", team: row.team, role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
            Button.Root("Night shift from 7 am", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start.addHours(1n), end: row.end.addHours(1n), shift: "night", team: row.team, role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: row.note })); }) }),
        ])));
        return Roster({
            id: "shiftWrites", inspector: true, week: { start: "sunday" }, view: { layout: "shifts", period: "day", date: at("2028-03-05T00:00:00") },
            events: { duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", inspector: form,
            }) },
            resources: {
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
            groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
            library: [Roster.library.tab(times.read(), {
                name: "Shifts", icon: "clock", label: s => s.label, meta: s => some(s.code),
                drop: (_s, key) => Schedule.patch(ex.WarehouseDuty, { shift: key }),
            })],
        });
    }))),
};

describe("A write that changes a duty's shift keeps it on its day (#1584)", () => {
    test("the duty's own form: Sunday's early made a night with its times as they were runs Sunday's night, from 10 PM, and one given its own times an hour on, which start on Saturday's night, is refused", async () => {
        const { container: c } = await h.mount(shiftWrites);
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
        const { container: c } = await h.mount(shiftWrites);
        const before = await h.read(ex.rosterDuties);
        await drop(await libraryCard(c, "Night"), assignment(c, "s15"));
        expect(cell(c, 0, "inbound", "night").contains(assignment(c, "s15"))).toBe(true);
        await press(within(slot(c, "toolbar")).getByRole("button", { name: "Save" }));
        expect(sameDuty((await h.read(ex.rosterDuties)).get("s15")!,
            { ...before.get("s15")!, shift: "night", start: at("2028-03-05T22:00:00"), end: at("2028-03-06T06:00:00") })).toBe(true);
    });
});
