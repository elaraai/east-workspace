/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Roster's `optimise` contract (#1409, #1411, `Optimise Spec.md` §4, §5):
 * the request and result types over the duties' row type, the prop's refusals
 * — not `Func.bind`, bound over other rows, asking or answering another type
 * — the payload's `optimise`, and the warehouse's optimiser over its own week:
 * every duty kept, every slot short of its heads filled from its group's
 * people off that day, then everyone to their contract from their usual
 * shift on any week; nobody booked twice on a day, past their contract or
 * within ten hours of another duty of theirs.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, equalFor, isTypeEqual, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Data, Roster, Schedule } from "@elaraai/e3-ui";
import { Func, FuncBindingType, Record, RosterPayloadType, RosterSlotType, createRosterPayload, rosterAgenciesOf, rosterPeopleOf, type RosterProps } from "@elaraai/e3-ui/internal";
import {
    WarehouseActivity, WarehouseAgency, WarehouseDuty, WarehousePerson, WarehousePosition, WarehouseShift, WarehouseTeam,
    warehouseActivities, warehouseAgencies, warehouseDuties, warehouseNextStart, warehousePeople, warehousePositions, warehouseShifts, warehouseStart,
    warehouseTeams, warehouseWeek,
} from "./warehouse.js";
import * as base from "./roster.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Roster — the optimiser's example (#1409)", test => {
    Assert.examples(test, { rosterOptimise: ex.rosterOptimise });
}, { platformFns: TestImpl });

const Request = Roster.Types.OptimiseRequest(WarehouseDuty);
const Result = Roster.Types.OptimiseResult(WarehouseDuty);
type Request = ValueTypeOf<typeof Request>;
type Duty = ValueTypeOf<typeof WarehouseDuty>;
const byString = compareFor(StringType);
const sameDuty = equalFor(WarehouseDuty);
const DAY = 86_400_000, HOUR = 3_600_000;

/** Builds a payload's East function over the warehouse's records, the props the test gives beside the base's — refused, if it is, as it is built. */
function payload(change: Partial<RosterProps> | Readonly<Record<string, unknown>> = {}): void {
    East.function([], RosterPayloadType, ($) => {
        const rota = $.let(Record.bind(base.rosterDuties, [base.rosterDutiesPatch]));
        const staff = $.let(Data.bind(base.rosterStaff));
        const firms = $.let(Data.bind(base.rosterAgencies));
        const times = $.let(Data.bind(base.rosterShiftTimes));
        const teams = $.let(Data.bind(base.rosterTeams));
        return createRosterPayload({
            events: { duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
            }) },
            resources: {
                people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours }),
            groups: Roster.groups(teams.read(), { label: t => t.label }),
            ...change,
        } as RosterProps);
    });
}

describe("the types (§5.1)", () => {
    test("OptimiseRequest(R) is the week, the run, the duties by key as the app's rows, the targets by slot and the context; OptimiseResult(R) the duties", () => {
        assert.ok(isTypeEqual(Request, StructType({
            from: DateTimeType, to: DateTimeType, run: IntegerType, duties: DictType(StringType, WarehouseDuty),
            requirements: Roster.Types.Requirements, context: Roster.Types.Context,
        })));
        assert.ok(isTypeEqual(Result, StructType({ duties: DictType(StringType, WarehouseDuty) })));
    });

    test("a constructor gives the same East type for the same row type, and another for another", () => {
        assert.ok(isTypeEqual(Roster.Types.OptimiseRequest(WarehouseDuty), Request));
        assert.ok(isTypeEqual(Roster.Types.OptimiseResult(WarehouseDuty), Result));
        assert.equal(isTypeEqual(Roster.Types.OptimiseRequest(base.MinimalDuty), Request), false);
        assert.equal(isTypeEqual(Roster.Types.OptimiseResult(base.MinimalDuty), Result), false);
    });

    test("the payload carries the optimiser's binding, or none (§5.2)", () => {
        assert.ok(isTypeEqual(RosterPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise` (§4): Func.bind of an e3.function from OptimiseRequest(R) to OptimiseResult(R), refused otherwise naming the row type", () => {
    test("the warehouse's optimiser is taken; without the prop the Roster builds as before", () => {
        assert.doesNotThrow(() => payload({ optimise: Func.bind(ex.rotaOptimise) }));
        assert.doesNotThrow(() => payload());
    });

    test("one bound over another row type is refused naming both rows", () => {
        const Other = StructType({ person: StringType, start: Schedule.Types.Clock });
        const otherRows = e3.function("roster_optimise_spec_other_rows", East.function([Roster.Types.OptimiseRequest(Other)], Roster.Types.OptimiseResult(Other), (_$, req) => ({ duties: req.duties })));
        assert.throws(() => payload({ optimise: Func.bind(otherRows) as never }),
            /^Error: Roster: `optimise` is bound over duty rows \.Struct \[.*person.*\], and the duty kind's rows are \.Struct \[.*costCentre.*\] — bind an optimiser over Roster\.Types\.OptimiseRequest of the duties' row type$/);
    });

    test("one asking or answering another type is refused naming it, and a value that is no Func.bind handle naming the signature", () => {
        const answersText = e3.function("roster_optimise_spec_answers_text", East.function([Request], StringType, () => "nothing"));
        assert.throws(() => payload({ optimise: Func.bind(answersText) as never }), /^Error: Roster: `optimise` answers \.String, not Roster\.Types\.OptimiseResult\(\.Struct \[/);
        const asksText = e3.function("roster_optimise_spec_asks_text", East.function([StringType], Result, () => ({ duties: new Map() })));
        assert.throws(() => payload({ optimise: Func.bind(asksText) as never }), /^Error: Roster: `optimise` asks \.String, not Roster\.Types\.OptimiseRequest\(\.Struct \[/);
        const notBound = /^Error: Roster: `optimise` is Func\.bind of the app's e3\.function from Roster\.Types\.OptimiseRequest\(R\) to Roster\.Types\.OptimiseResult\(R\), R the duties' row type — the period's rows in, the same rows out, complete$/;
        assert.throws(() => payload({ optimise: East.value("rota_optimise") as never }), notBound);
        assert.throws(() => payload({ optimise: East.function([Request], Result, (_$, req) => ({ duties: req.duties })) as never }), notBound);
    });
});

// The context the Roster sends: the warehouse's rows through the Roster's own adapters, as the examples bind them.
const contextOf = East.compile(East.function(
    [DictType(StringType, WarehousePerson), DictType(StringType, WarehouseActivity), DictType(StringType, WarehouseShift), DictType(StringType, WarehouseTeam),
        DictType(StringType, WarehousePosition), DictType(StringType, WarehouseAgency)],
    Roster.Types.Context, ($, staff, activities, shifts, teams, positions, agencies) => {
        const people = $.const(rosterPeopleOf(Schedule.resources(staff, {
            name: "People", icon: "user", label: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
            contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual,
        })));
        return {
            people: people.toDict((_$2, p) => p.key, (_$2, p) => p),
            groups: Roster.groups(teams, { label: t => t.label, order: t => t.order }).rows,
            activities: Roster.activities(activities, { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
            shifts: Roster.shifts(shifts, { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }).rows,
            positions: Roster.positions(positions, { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order }).rows,
            agencies: rosterAgenciesOf(Schedule.resources(agencies, { name: "Agencies", icon: "building", label: a => a.name })),
            rules: { rest: 10, lead: true, trainer: true, skill: true },
        };
    }), []);

describe("the warehouse's optimiser over its own week (§3.1)", () => {
    const context = contextOf(warehousePeople, warehouseActivities, warehouseShifts, warehouseTeams, warehousePositions, warehouseAgencies);
    /** This week's duties, the app's rows by key: what the Roster sends, base plus drafts. */
    const duties = new SortedMap<string, Duty>([...warehouseDuties].filter(([, duty]) => duty.start >= warehouseStart && duty.start < warehouseNextStart), byString);
    const request: Request = { from: warehouseStart, to: warehouseNextStart, run: 1n, duties, requirements: warehouseWeek.requirements, context };
    const optimise = East.compile(ex.rosterOptimiseBody, []);
    const dayOf = (at: Date) => Math.floor((at.getTime() - warehouseStart.getTime()) / DAY);
    /** Each slot's heads short of its target, summed over the week. */
    const open = (held: ReadonlyMap<string, Duty>): number => [...warehouseWeek.requirements].reduce((sum, [slot, need]) => {
        const filled = [...held.values()].filter((d) => d.team === slot.group && d.shift === slot.shift && dayOf(d.start) === Number(slot.day)).length;
        return sum + Math.max(0, Number(need.positions) - filled);
    }, 0);

    test("every duty the week held stays as it was, and the slots short of their heads are filled under keys of the run's own", () => {
        const result = optimise(request);
        for (const [key, duty] of request.duties) assert.ok(sameDuty(result.duties.get(key)!, duty), key);
        const added = [...result.duties].filter(([key]) => !request.duties.has(key));
        assert.ok(added.length > 0, "the week is short somewhere");
        assert.ok(added.every(([key]) => /^elara-1-\d+$/.test(key)), "a new duty's key is the run's own");
        assert.ok(open(result.duties) < open(request.duties), "fewer heads short after the run");
    });

    test("a new duty is one of the group's own people, off that day, on the shift's own times, booked to the team's cost centre", () => {
        const result = optimise(request);
        const booked = new Set<string>();
        for (const [, duty] of result.duties) {
            if (duty.who.type !== "staff") continue;
            const key = `${dayOf(duty.start)}|${duty.who.value}`;
            assert.ok(!booked.has(key), `${key} booked once a day`);
            booked.add(key);
        }
        const centres = new Map([...request.duties.values()].map((d) => [d.team, d.costCentre]));
        for (const [key, duty] of result.duties) {
            if (request.duties.has(key)) continue;
            assert.equal(duty.who.type, "staff");
            const person = context.people.get(duty.who.type === "staff" ? duty.who.value : "")!;
            assert.equal(person.group, duty.team, key);
            assert.equal(person.agency, false, key);
            const shift = warehouseShifts.get(duty.shift)!;
            assert.equal(duty.start.getTime(), warehouseStart.getTime() + dayOf(duty.start) * DAY + Number(shift.start.hour) * HOUR + Number(shift.start.minute) * 60_000, key);
            assert.equal(duty.end.getTime(), duty.start.getTime() + shift.hours * HOUR, key);
            assert.equal(duty.costCentre, centres.get(duty.team), key);
            assert.deepEqual([duty.task.type, duty.agreed.type, duty.unpaidBreak, duty.note], ["none", "none", 0, ""]);
        }
    });

    test("a new duty keeps its person within their contract's hours, and ten hours clear of every other duty of theirs", () => {
        const result = optimise(request);
        const byPerson = new Map<string, Duty[]>();
        for (const [, duty] of result.duties) {
            if (duty.who.type !== "staff") continue;
            const theirs = byPerson.get(duty.who.value);
            if (theirs === undefined) byPerson.set(duty.who.value, [duty]);
            else theirs.push(duty);
        }
        for (const [key, duty] of result.duties) {
            if (request.duties.has(key) || duty.who.type !== "staff") continue;
            const person = context.people.get(duty.who.value)!;
            const theirs = byPerson.get(duty.who.value)!;
            const worked = theirs.reduce((sum, d) => sum + (d.end.getTime() - d.start.getTime()) / HOUR, 0);
            assert.ok(worked <= person.contract + 1e-9, `${key}: ${worked} h is past the contract`);
            for (const other of theirs) {
                if (Object.is(other, duty)) continue;
                const gap = Math.max(other.start.getTime() - duty.end.getTime(), duty.start.getTime() - other.end.getTime()) / HOUR;
                assert.ok(gap >= 10, `${key}: ${gap} h from another duty of theirs`);
            }
        }
    });

    test("a week with nothing short is returned as it is", () => {
        const result = optimise(request);
        const again = optimise({ ...request, run: 2n, duties: result.duties });
        assert.deepEqual([...again.duties.keys()], [...result.duties.keys()]);
        for (const [key, duty] of result.duties) assert.ok(sameDuty(again.duties.get(key)!, duty), key);
    });

    test("a week with no targets and no duties — any week, this one or two years on — fills everyone to their contract from their usual shift, in their own group; the agency's workers are left off", () => {
        const from = new Date(warehouseNextStart.getTime() + 7 * DAY);
        const empty: Request = { from, to: new Date(from.getTime() + 7 * DAY), run: 3n, duties: new SortedMap<string, Duty>([], byString),
            requirements: new SortedMap([], compareFor(RosterSlotType)), context };
        const result = optimise(empty);
        const byPerson = new Map<string, Duty[]>();
        for (const [key, duty] of result.duties) {
            assert.equal(duty.who.type, "staff", key);
            if (duty.who.type !== "staff") continue;
            const theirs = byPerson.get(duty.who.value);
            if (theirs === undefined) byPerson.set(duty.who.value, [duty]);
            else theirs.push(duty);
        }
        let filled = 0;
        for (const [key, person] of context.people) {
            const theirs = byPerson.get(key) ?? [];
            if (person.agency || person.usual.type === "none") { assert.equal(theirs.length, 0, key); continue; }
            const usual = person.usual.value;
            const shift = warehouseShifts.get(usual)!;
            const worked = theirs.reduce((sum, d) => sum + (d.end.getTime() - d.start.getTime()) / HOUR, 0);
            // As many of their usual shift as the contract takes, each in their own group, on days of their own.
            assert.ok(worked <= person.contract + 1e-9 && worked > person.contract - shift.hours, `${key}: as full as the contract takes`);
            assert.ok(theirs.every((d) => d.shift === usual && d.team === person.group && d.costCentre === ""), key);
            assert.equal(new Set(theirs.map((d) => Math.floor((d.start.getTime() - from.getTime()) / DAY))).size, theirs.length, key);
            filled += theirs.length;
        }
        assert.ok(filled > 100, "the week fills");
    });
});
