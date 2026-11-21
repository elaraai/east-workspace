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
 * and holding the key its session makes in its own field (`keyField`). And
 * over duties and cover targets keyed by number, with neither, a duty and a
 * target the Roster adds are one past the largest (ruling 10).
 */
import { describe, expect, test } from "vitest";
import { within } from "@testing-library/react";
import { DictType, East, FunctionType, IntegerType, NullType, SetType, SortedMap, StringType, compareFor, equalFor, variant, type ExprType } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Button, Reactive, Stack, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Roster, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { retypeNumber } from "../e3-web-mount.test-utils.js";
import { START, assignment, cell, history, press, rosterHarness, slot } from "./harness.test-utils.js";
/** The warehouse's duties keyed by number, as the app counts them: none until a test writes some. */
const numberedDuties = e3.record("roster_numbered_duties", DictType(IntegerType, ex.WarehouseDuty), {
    initial: new SortedMap([], compareFor(IntegerType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
/** The warehouse's cover targets keyed by number: none until a test writes some. */
const numberedCover = e3.record("roster_numbered_cover", DictType(IntegerType, ex.WarehouseCover), {
    initial: new SortedMap([], compareFor(IntegerType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
const h = rosterHarness({ "roster/numbered": { numberedDuties, numberedCover } });
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
 * @param keys - How the duties are keyed; told the app's rule, a new duty is the next `D-<n>`; `undefined`, by the Roster
 * @param numbered - Over the duties keyed by number in place of the warehouse's, and with the cover targets keyed by number
 * @returns The example
 */
const keyedRoster = (keys: DutyKeys | undefined, numbered: { readonly duties?: true; readonly cover?: true } = {}) => ({
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const rota = $.let(Record.bind((numbered.duties === true ? numberedDuties : ex.rosterDuties) as typeof ex.rosterDuties, ["patch"]));
        const cover = numbered.cover === true ? $.let(Record.bind(numberedCover, ["patch"])) : undefined;
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
                ...(keys === undefined ? {} : "newKey" in keys ? { newKey: $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`D-${taken.size().add(1n)}`)) } : keys),
            }) },
            resources: {
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
            groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
            ...(cover === undefined ? {} : { targets: Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" }) }),
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

describe("a Roster over duties and cover targets keyed by number, given neither `key` nor `newKey` (east-workspace#1709)", () => {
    test("ruling 10 — over duties keyed by number, a duty requested of an agency is one past the largest number the record holds — 8, past 3 and 7 — never a key made up, and Save writes it there", async () => {
        // Two of the warehouse's duties, numbered 3 and 7.
        const [first, second] = [...(await h.read(ex.rosterDuties)).values()];
        await h.patch(numberedDuties, new SortedMap([[3n, first!], [7n, second!]], compareFor(IntegerType)));
        const { container: c } = await h.mount(keyedRoster(undefined, { duties: true }));
        await press(within(cell(c, 0, "inbound", "night")).getByRole("button", { name: "Request Northside Staffing" }));
        await press(history(c, "Save"));
        const saved = await h.read(numberedDuties);
        expect([[...saved.keys()], saved.get(8n)?.who]).toEqual([[3n, 7n, 8n], variant("agency", "northside")]);
    });

    test("ruling 10 — over cover targets keyed by number, a target added on a slot with none is one past the largest number the record holds — 8, past 3 and 7 — and Save writes it there", async () => {
        // Two of the warehouse's targets, Thursday's, numbered 3 and 7: Sunday's slots have none.
        const cover = await h.read(ex.rosterCover);
        await h.patch(numberedCover, new SortedMap([[3n, cover.get("2028-03-09-inbound-early")!], [7n, cover.get("2028-03-09-dispatch-early")!]], compareFor(IntegerType)));
        const { container: c } = await h.mount(keyedRoster(undefined, { cover: true }));
        await press(slot(c, "main").querySelector("[data-roster-requirement]"));
        await retypeNumber(within(slot(c, "end")).getByRole("spinbutton", { name: "Positions" }), "12");
        await press(history(c, "Save"));
        const saved = await h.read(numberedCover);
        expect([[...saved.keys()], saved.get(8n)?.heads]).toEqual([[3n, 7n, 8n], 12n]);
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
