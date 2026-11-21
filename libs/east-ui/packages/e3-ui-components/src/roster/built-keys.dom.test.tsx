/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

/**
 * A Roster whose duty kind builds each duty's key from its row (`key`,
 * east-workspace#1709): the warehouse's duties keyed by their note. A duty's
 * own form that writes its note moves the duty under the key it then builds,
 * still selected, and Save writes it there; a note that builds a key another
 * duty stands under is refused, the board saying whose key it is. And a duty
 * the Roster adds — an agency's, requested from a shift's cell — under each of
 * the other two options a kind takes: keyed by the app's own rule (`newKey`),
 * and holding the key its session makes in its own field (`keyField`).
 */
import { describe, expect, test } from "vitest";
import { within } from "@testing-library/react";
import { East, FunctionType, NullType, SetType, StringType, equalFor, variant, type ExprType } from "@elaraai/east";
import { Button, Reactive, Stack, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { START, assignment, cell, history, press, rosterHarness, slot } from "./harness.test-utils.js";
const h = rosterHarness();
const sameDuty = equalFor(ex.WarehouseDuty);
const sameKey = equalFor(StringType);

/** How a test's Roster keys its duties: by the key a duty's row builds, by the app's own rule, or holding each one's key in a field. */
type DutyKeys =
    | { readonly key: (duty: ExprType<typeof ex.WarehouseDuty>) => ExprType<StringType> }
    | { readonly newKey: true }
    | { readonly keyField: "note" };

/**
 * The warehouse's Roster on Sunday, its duties keyed as a test says, whose duty's own form writes a note: N-1, or s6 — the
 * key H. Aspen's Sunday early stands under.
 *
 * @param keys - How the duties are keyed; told the app's rule, a new duty is the next `D-<n>`
 * @returns The example
 */
const keyedRoster = (keys: DutyKeys) => ({
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const rota = $.let(Record.bind(ex.rosterDuties, ["patch"]));
        const people = $.let(Data.bind(ex.rosterStaff));
        const firms = $.let(Data.bind(ex.rosterAgencies));
        const times = $.let(Data.bind(ex.rosterShiftTimes));
        const teams = $.let(Data.bind(ex.rosterTeams));
        const form = $.const(East.function([ex.WarehouseDuty, FunctionType([ex.WarehouseDuty], NullType)], UIComponentType, (_$2, row, update) => Stack.Root([
            Button.Root("Note N-1", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: row.shift, team: row.team, role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: "N-1" })); }) }),
            Button.Root("Note s6", { onClick: East.function([], NullType, ($3) => { $3(update({
                who: row.who, start: row.start, end: row.end, shift: row.shift, team: row.team, role: row.role, task: row.task,
                unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: "s6" })); }) }),
        ])));
        return Roster({
            id: "keyedByNote", inspector: true, week: { start: "sunday" }, view: { layout: "shifts", period: "day", date: START },
            events: { duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", inspector: form,
                ...("newKey" in keys ? { newKey: $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`D-${taken.size().add(1n)}`)) } : keys),
            }) },
            resources: {
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
            groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
        });
    }))),
});

/** The duties keyed by their note. */
const keyedByNote = keyedRoster({ key: (duty) => duty.note });

/** Requests Northside Staffing for Sunday's inbound night shift, Saves, and gives the duties as they were and as e3 then holds them. */
async function requested(example: ReturnType<typeof keyedRoster>) {
    const { container: c } = await h.mount(example);
    const before = await h.read(ex.rosterDuties);
    await press(within(cell(c, 0, "inbound", "night")).getByRole("button", { name: "Request Northside Staffing" }));
    await press(history(c, "Save"));
    const after = await h.read(ex.rosterDuties);
    return { before, after, added: [...after.keys()].filter((key) => !before.has(key)) };
}

describe("a Roster's new duty under the app's rule, and holding its key in a field (east-workspace#1709)", () => {
    test("ruling 1 — told the app's rule (`newKey`), a duty requested of an agency is keyed by it — the next D-n, never a key made up — and Save writes it there", async () => {
        const { before, after, added } = await requested(keyedRoster({ newKey: true }));
        expect(added).toEqual([`D-${before.size + 1}`]);
        expect(after.get(added[0]!)!.who).toEqual(variant("agency", "northside"));
    });

    test("ruling 1 — holding its key in a field (`keyField`), a duty requested of an agency holds its own key in its note from the first, and Save writes it so", async () => {
        const { after, added } = await requested(keyedRoster({ keyField: "note" }));
        expect(added).toHaveLength(1);
        const duty = after.get(added[0]!)!;
        expect([sameKey(duty.note, added[0]!), duty.who]).toEqual([true, variant("agency", "northside")]);
    });
});

describe("a Roster whose duty kind builds each duty's key from its row", () => {
    test("ruling 1 — a duty's own form that writes what its key reads moves the duty under the key it then builds, still selected; a key another duty stands under is refused, the board saying whose; and Save writes the duty under its new key", async () => {
        const { container: c } = await h.mount(keyedByNote);
        const before = await h.read(ex.rosterDuties);
        const end = () => slot(c, "end");
        await press(assignment(c, "s15"));
        await press(within(end()).getByRole("button", { name: "Note N-1" }));
        // Under the key its note builds, on the shift it was on, its own form open on it still.
        expect(cell(c, 0, "inbound", "early").contains(assignment(c, "N-1"))).toBe(true);
        // Its note made the key H. Aspen's duty stands under: refused, the duty where it was.
        await press(within(end()).getByRole("button", { name: "Note s6" }));
        expect([...c.querySelectorAll("[role='alert']")].map(alert => alert.textContent)).toContain('Another duty is keyed "s6" already');
        expect(cell(c, 0, "inbound", "early").contains(assignment(c, "N-1"))).toBe(true);
        await press(within(slot(c, "toolbar")).getByRole("button", { name: "Save" }));
        const saved = await h.read(ex.rosterDuties);
        expect([saved.has("s15"), sameDuty(saved.get("N-1")!, { ...before.get("s15")!, note: "N-1" }), sameDuty(saved.get("s6")!, before.get("s6")!), saved.size])
            .toEqual([false, true, true, before.size]);
    });
});
