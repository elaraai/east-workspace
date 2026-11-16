/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Roster's `optimise` contract (#1409, #1553, east-workspace#1622): the
 * request — the week, the run and the rail's narrowing, no row, and given
 * `{ edges: true }` the keys of the duties at the week's edges it must leave —
 * and the answer, a patch of the duties' record; the prop's refusals where the
 * page is built, and the drafts rule over the duties, the periods and the
 * targets as it is evaluated; the payload's `optimise`; and the examples' optimisers over the
 * warehouse's own records, each read through its indexes and answered as a
 * patch: the warehouse's week, every slot short filled then everyone to their
 * contract; the second step's week, every duty in no team placed; and the
 * night warehouse's week by when its shifts end, its edges among it.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    BooleanType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, StringType, StructType, VariantType, compareFor,
    diffFor, equalFor, isTypeEqual, none, printFor, printType, some, variant, type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Data, Roster, Schedule } from "@elaraai/e3-ui";
import { Func, FuncBindingType, Record, RosterPayloadType, RosterSlotType, createRosterPayload, rosterOptimise, type RosterProps } from "@elaraai/e3-ui/internal";
import {
    WarehouseDuty, warehouseCover, warehouseDuties, warehouseNextStart, warehousePeople, warehouseShifts, warehouseStart, warehouseTeams, warehouseWeek,
} from "./warehouse.js";
import { indexEntries } from "../index-entries.js";
import { patchedFor } from "../patches.js";
import { refusingPlatform } from "../refusing-platform.js";
import * as base from "./roster.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Roster — the optimiser's examples (#1409, #1553, #1622)", test => {
    Assert.examples(test, { rosterOptimise: ex.rosterOptimise, rosterOptimiseEdges: ex.rosterOptimiseEdges });
}, { platformFns: TestImpl });

type Duty = ValueTypeOf<typeof WarehouseDuty>;
const byString = compareFor(StringType);
const sameDuty = equalFor(WarehouseDuty);
const DAY = 86_400_000, HOUR = 3_600_000;
const SLICE = DictType(StringType, RecordSliceWhereType);

/** Builds a payload's East function over the warehouse's records, the props the test gives beside the base's — refused, if it is, as it is built. */
function payload(change: Partial<RosterProps> | Readonly<Record<string, unknown>> = {}): void {
    East.function([], RosterPayloadType, ($) => {
        const rota = $.let(Record.bind(base.rosterDuties));
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

/** The weeks a test's Roster publishes: a record of the test's own, each week keyed by its first day, open or issued. */
const specWeeks = e3.record("roster_optimise_spec_weeks", DictType(DateTimeType, StructType({ state: VariantType({ open: NullType, issued: NullType }) })), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/**
 * The Roster's optimiser over the warehouse's duties — and its targets, where `withTargets`, and the weeks it publishes,
 * where `withPeriods` — evaluated as the page is: the binding its tag holds (`rosterOptimise`), alone, since the payload
 * around it reads the staff as it is evaluated, which a spec reads from no e3.
 */
function evaluated(def: unknown, withTargets: boolean, withPeriods = false): ValueTypeOf<typeof FuncBindingType> {
    return East.compile(East.function([], FuncBindingType, ($) => {
        const rota = $.let(Record.bind(base.rosterDuties));
        const cover = $.let(Record.bind(base.rosterCover));
        const weeks = $.let(Record.bind(specWeeks));
        const optimise = $.let(Func.bind(def as never));
        const kind = Schedule.events(rota, {
            name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
            shift: "shift", group: "team",
        });
        const targets = withTargets ? Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" }) : undefined;
        const periods = withPeriods ? Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" } }) : undefined;
        return rosterOptimise(optimise, kind as never, targets, periods).binding;
    }), refusingPlatform)();
}

describe("the types (#1622)", () => {
    test("OptimiseRequest() is the period in view and what kind it is, the run and each rail source's narrowing, and no row; OptimiseResult(D) a patch of the duties' record", () => {
        assert.ok(isTypeEqual(Roster.Types.OptimiseRequest(), StructType({ from: DateTimeType, to: DateTimeType, period: Roster.Types.OptimisePeriod, run: IntegerType, slice: SLICE })));
        assert.ok(isTypeEqual(Roster.Types.OptimisePeriod, VariantType({ day: NullType, week: NullType, month: NullType, quarter: NullType, year: NullType })));
        assert.ok(isTypeEqual(Roster.Types.OptimiseResult(ex.WarehouseDuties), StructType({ duties: PatchType(ex.WarehouseDuties) })));
        assert.equal(isTypeEqual(Roster.Types.OptimiseResult(base.NoGroupDuties), Roster.Types.OptimiseResult(ex.WarehouseDuties)), false);
    });

    test("given { edges: true } (#1553), the request also names the duties at the week's edges it must leave as they are; the answer is the same one patch", () => {
        assert.ok(isTypeEqual(Roster.Types.OptimiseRequest({ edges: true }),
            StructType({ from: DateTimeType, to: DateTimeType, period: Roster.Types.OptimisePeriod, run: IntegerType, slice: SLICE, fixed: SetType(StringType) })));
        assert.equal(isTypeEqual(Roster.Types.OptimiseRequest({ edges: true }), Roster.Types.OptimiseRequest()), false);
    });

    test("a request type takes no row, and a result type a record's type alone, each refused otherwise", () => {
        assert.throws(() => (Roster.Types.OptimiseRequest as (options: unknown) => unknown)(WarehouseDuty), {
            message: "Roster.Types.OptimiseRequest: takes nothing, or { edges: true } for an optimiser that may change the duties at the week's edges",
        });
        assert.throws(() => Roster.Types.OptimiseResult(WarehouseDuty as unknown as DictType<EastType, EastType>), {
            message: `Roster.Types.OptimiseResult: is given ${printType(WarehouseDuty)} — it takes the duties' record type, a Dict of duties by key: DictType(StringType, Duty)`,
        });
    });

    test("the payload carries the optimiser's binding and whether it takes the edges, or none", () => {
        assert.ok(isTypeEqual(RosterPayloadType.fields.optimise, OptionType(StructType({ binding: FuncBindingType, edges: BooleanType }))));
    });
});

describe("`optimise`: Func.bind of an e3.function from OptimiseRequest() to OptimiseResult(D), each record it reads that the Roster edits listed in its drafts", () => {
    test("the warehouse's optimiser is taken, its binding naming the duties and the targets it lists and what it reads; without the prop the Roster builds as before", () => {
        assert.doesNotThrow(() => payload({ optimise: Func.bind(ex.rotaOptimise) }));
        assert.doesNotThrow(() => payload());
        const binding = evaluated(ex.rotaOptimise, true);
        assert.ok(equalFor(FuncBindingType)(binding, {
            name: "rota_optimise", drafts: ["roster_duties", "roster_cover"],
            reads: ["roster_cover", "roster_duties", "roster_shift_times", "roster_staff", "roster_teams"],
        }), printFor(FuncBindingType)(binding));
    });

    test("one that reads the targets and does not list them fails the page as it is evaluated, naming the targets' record; the Roster with no targets edits none", () => {
        const undrafted = e3.function("roster_optimise_spec_targets_undrafted", {
            inputs: [e3.index(base.rosterDuties.indexes.roster_duties_by_time), e3.index(base.rosterCover.indexes.roster_cover_by_day)],
            drafts: [base.rosterDuties], args: [Roster.Types.OptimiseRequest()], output: Roster.Types.OptimiseResult(ex.WarehouseDuties),
        }, ($) => {
            const held = $.const(new Map(), ex.WarehouseDuties);
            return { duties: East.diff(held, held) };
        });
        assert.throws(() => evaluated(undrafted, true), (error: Error) => error.message.includes(
            "Roster: `optimise` is the function 'roster_optimise_spec_targets_undrafted', which reads the record 'roster_cover' that the Roster edits " +
            "and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [roster_cover], beside the function's inputs"));
        assert.doesNotThrow(() => evaluated(undrafted, false));
    });

    test("one that reads the weeks the Roster publishes and does not list them fails the page as it is evaluated, naming the periods' record: their unsaved status is the Roster's; a Roster that publishes none edits none", () => {
        const undrafted = e3.function("roster_optimise_spec_weeks_undrafted", {
            inputs: [specWeeks], args: [Roster.Types.OptimiseRequest()], output: Roster.Types.OptimiseResult(ex.WarehouseDuties),
        }, ($) => {
            const held = $.const(new Map(), ex.WarehouseDuties);
            return { duties: East.diff(held, held) };
        });
        assert.throws(() => evaluated(undrafted, false, true), (error: Error) => error.message.includes(
            "Roster: `optimise` is the function 'roster_optimise_spec_weeks_undrafted', which reads the record 'roster_optimise_spec_weeks' that the Roster edits " +
            "and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [roster_optimise_spec_weeks], beside the function's inputs"));
        assert.doesNotThrow(() => evaluated(undrafted, false, false));
    });

    test("one that reads the duties and does not list them fails the page, naming the duties' record", () => {
        const undrafted = e3.function("roster_optimise_spec_duties_undrafted", {
            inputs: [base.rosterDuties], args: [Roster.Types.OptimiseRequest()], output: Roster.Types.OptimiseResult(ex.WarehouseDuties),
        }, ($) => {
            const held = $.const(new Map(), ex.WarehouseDuties);
            return { duties: East.diff(held, held) };
        });
        assert.throws(() => evaluated(undrafted, false), (error: Error) => error.message.includes("which reads the record 'roster_duties' that the Roster edits"));
    });

    test("one answering a patch of another record, or asking the rows themselves, is refused naming what it answers or asks; a value that is no Func.bind handle naming the signature", () => {
        const otherRows = e3.function("roster_optimise_spec_other_rows", { inputs: [], args: [Roster.Types.OptimiseRequest()], output: Roster.Types.OptimiseResult(base.NoGroupDuties) }, ($) => {
            const held = $.const(new Map(), base.NoGroupDuties);
            return { duties: East.diff(held, held) };
        });
        assert.throws(() => payload({ optimise: Func.bind(otherRows) as never }), {
            message: `Roster: \`optimise\` answers ${printType(Roster.Types.OptimiseResult(base.NoGroupDuties))}, not Roster.Types.OptimiseResult(${printType(ex.WarehouseDuties)}) — ` +
                "a patch of each record the Roster edits",
        });
        const AsksRows = StructType({ from: DateTimeType, to: DateTimeType, run: IntegerType, duties: ex.WarehouseDuties });
        const asksRows = e3.function("roster_optimise_spec_asks_rows", { inputs: [], args: [AsksRows], output: Roster.Types.OptimiseResult(ex.WarehouseDuties) }, ($) => {
            const held = $.const(new Map(), ex.WarehouseDuties);
            return { duties: East.diff(held, held) };
        });
        assert.throws(() => payload({ optimise: Func.bind(asksRows) as never }), {
            message: `Roster: \`optimise\` asks ${printType(AsksRows)}, not Roster.Types.OptimiseRequest() — ` +
                "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace",
        });
        assert.throws(() => payload({ optimise: East.value("rota_optimise") as never }), {
            message: "Roster: `optimise` is Func.bind of the app's e3.function from Roster.Types.OptimiseRequest() to Roster.Types.OptimiseResult(D), or from " +
                `Roster.Types.OptimiseRequest({ edges: true }), D the duties' record type — here ${printType(ex.WarehouseDuties)} — the period in view and the page's narrowing in, ` +
                "a patch of each record the Roster edits out",
        });
    });

    test("one asked `fixed` (#1553) is taken as taking the edges, and held to the edges' request; the night warehouse's over other duties is refused naming what it answers", () => {
        const edges = e3.function("roster_optimise_spec_edges", {
            inputs: [], args: [Roster.Types.OptimiseRequest({ edges: true })], output: Roster.Types.OptimiseResult(ex.WarehouseDuties),
        }, ($) => {
            const held = $.const(new Map(), ex.WarehouseDuties);
            return { duties: East.diff(held, held) };
        });
        assert.doesNotThrow(() => payload({ optimise: Func.bind(edges) }));
        assert.throws(() => payload({ optimise: Func.bind(ex.rotaPlanNights) as never }), {
            message: `Roster: \`optimise\` answers ${printType(Roster.Types.OptimiseResult(ex.NightsShifts))}, not Roster.Types.OptimiseResult(${printType(ex.WarehouseDuties)}) — ` +
                "a patch of each record the Roster edits",
        });
    });
});

describe("the warehouse's optimiser over its own week, read through the duties', the targets' and the staff's indexes", () => {
    const _Asked = Roster.Types.OptimiseRequest();
    const request: ValueTypeOf<typeof _Asked> = { from: warehouseStart, to: warehouseNextStart, period: variant("week", null), run: 1n, slice: new Map() };
    const optimise = (ex.rotaOptimise.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => { duties: unknown };
    const patched = patchedFor(ex.WarehouseDuties);
    /** The duties a run leaves, over the duties given, and its patch. */
    const run = (duties: ReadonlyMap<string, Duty>, asked: typeof request = request) => {
        const answer = optimise(
            indexEntries(base.rosterDuties, base.rosterDuties.indexes.roster_duties_by_time, duties).entries, duties,
            indexEntries(base.rosterCover, base.rosterCover.indexes.roster_cover_by_day, warehouseCover).entries, warehouseCover,
            indexEntries(base.rosterStaff, base.rosterStaff.indexes.roster_staff_by_agency, warehousePeople).entries, warehousePeople,
            warehouseShifts, warehouseTeams, asked).duties;
        return { answer, after: patched(duties, answer) };
    };
    const all = new SortedMap<string, Duty>([...warehouseDuties], byString);
    const dayOf = (at: Date, from = warehouseStart) => Math.floor((at.getTime() - from.getTime()) / DAY);
    const inWeek = (duties: ReadonlyMap<string, Duty>) => new Map([...duties].filter(([, d]) => d.start >= warehouseStart && d.start < warehouseNextStart));
    /** Each slot's heads short of its target, summed over the week. */
    const open = (held: ReadonlyMap<string, Duty>): number => [...warehouseWeek.requirements].reduce((sum, [slot, need]) => {
        const filled = [...inWeek(held).values()].filter((d) => d.team === slot.group && d.shift === slot.shift && dayOf(d.start) === Number(slot.day)).length;
        return sum + Math.max(0, Number(need.positions) - filled);
    }, 0);

    test("every duty the record held stays as it was — the answer only adds — and the slots short of their heads are filled under keys of the run's own", () => {
        const { after } = run(all);
        for (const [key, duty] of all) assert.ok(sameDuty(after.get(key)!, duty), key);
        const added = [...after].filter(([key]) => !all.has(key));
        assert.ok(added.length > 0, "the week is short somewhere");
        assert.ok(added.every(([key]) => /^elara-1-\d+$/.test(key)), "a new duty's key is the run's own");
        assert.ok(open(after) < open(all), "fewer heads short after the run");
    });

    test("a new duty is one of the team's own people, not the agency's, off that day, on the shift's own times, booked to the team's cost centre", () => {
        const { after } = run(all);
        const booked = new Set<string>();
        for (const [, duty] of inWeek(after)) {
            if (duty.who.type !== "staff") continue;
            const key = `${dayOf(duty.start)}|${duty.who.value}`;
            assert.ok(!booked.has(key), `${key} booked once a day`);
            booked.add(key);
        }
        for (const [key, duty] of after) {
            if (all.has(key)) continue;
            assert.equal(duty.who.type, "staff");
            const person = warehousePeople.get(duty.who.type === "staff" ? duty.who.value : "")!;
            assert.equal(person.team, duty.team, key);
            assert.equal(person.agency, false, key);
            const shift = warehouseShifts.get(duty.shift)!;
            assert.equal(duty.start.getTime(), warehouseStart.getTime() + dayOf(duty.start) * DAY + Number(shift.start.hour) * HOUR + Number(shift.start.minute) * 60_000, key);
            assert.equal(duty.end.getTime(), duty.start.getTime() + shift.hours * HOUR, key);
            assert.equal(duty.costCentre, warehouseTeams.get(duty.team)!.costCentre, key);
            assert.deepEqual([duty.task.type, duty.agreed.type, duty.unpaidBreak, duty.note], ["none", "none", 0, ""]);
        }
    });

    test("a new duty keeps its person within their contract's hours, and ten hours clear of every other duty of theirs", () => {
        const { after } = run(all);
        const byPerson = new Map<string, Duty[]>();
        for (const [, duty] of after) {
            if (duty.who.type !== "staff") continue;
            const theirs = byPerson.get(duty.who.value);
            if (theirs === undefined) byPerson.set(duty.who.value, [duty]);
            else theirs.push(duty);
        }
        for (const [key, duty] of after) {
            if (all.has(key) || duty.who.type !== "staff") continue;
            const person = warehousePeople.get(duty.who.value)!;
            const theirs = byPerson.get(duty.who.value)!;
            const worked = theirs.filter((d) => d.start >= warehouseStart && d.start < warehouseNextStart).reduce((sum, d) => sum + (d.end.getTime() - d.start.getTime()) / HOUR, 0);
            assert.ok(worked <= person.contract + 1e-9, `${key}: ${worked} h is past the contract`);
            for (const other of theirs) {
                if (Object.is(other, duty)) continue;
                const gap = Math.max(other.start.getTime() - duty.end.getTime(), duty.start.getTime() - other.end.getTime()) / HOUR;
                assert.ok(gap >= 10, `${key}: ${gap} h from another duty of theirs`);
            }
        }
    });

    test("a week with nothing short is answered with a patch that changes nothing", () => {
        const { after } = run(all);
        const again = run(after, { ...request, run: 2n }).answer;
        const unchanged = diffFor(ex.WarehouseDuties)(new SortedMap([], byString), new SortedMap([], byString));
        assert.ok(equalFor(PatchType(ex.WarehouseDuties))(again as never, unchanged), printFor(PatchType(ex.WarehouseDuties))(again as never));
    });

    test("a week with no targets and no duties — any week, this one or two years on — fills everyone to their contract from their usual shift, in their own team; the agency's workers are left off", () => {
        const from = new Date(warehouseNextStart.getTime() + 7 * DAY);
        const { after } = run(all, { from, to: new Date(from.getTime() + 7 * DAY), period: variant("week", null), run: 3n, slice: new Map() });
        const added = new Map([...after].filter(([key]) => !all.has(key)));
        const byPerson = new Map<string, Duty[]>();
        for (const [key, duty] of added) {
            assert.equal(duty.who.type, "staff", key);
            if (duty.who.type !== "staff") continue;
            const theirs = byPerson.get(duty.who.value);
            if (theirs === undefined) byPerson.set(duty.who.value, [duty]);
            else theirs.push(duty);
        }
        let filled = 0;
        for (const [key, person] of warehousePeople) {
            const theirs = byPerson.get(key) ?? [];
            if (person.agency || person.usual.type === "none") { assert.equal(theirs.length, 0, key); continue; }
            const usual = person.usual.value;
            const shift = warehouseShifts.get(usual)!;
            const worked = theirs.reduce((sum, d) => sum + (d.end.getTime() - d.start.getTime()) / HOUR, 0);
            // As many of their usual shift as the contract takes, each in their own team, on days of their own.
            assert.ok(worked <= person.contract + 1e-9 && worked > person.contract - shift.hours, `${key}: as full as the contract takes`);
            assert.ok(theirs.every((d) => d.shift === usual && d.team === person.team && d.costCentre === warehouseTeams.get(person.team)!.costCentre), key);
            assert.equal(new Set(theirs.map((d) => dayOf(d.start, from))).size, theirs.length, key);
            filled += theirs.length;
        }
        assert.ok(filled > 100, "the week fills");
    });

    /** Each person's hours in each of the warehouse's weeks, from Sunday: what a contract holds. */
    const hoursByWeek = (duties: ReadonlyMap<string, Duty>): Map<string, number> => {
        const worked = new Map<string, number>();
        for (const [, duty] of duties) {
            if (duty.who.type !== "staff") continue;
            const key = `${duty.who.value}|${Math.floor(dayOf(duty.start) / 7)}`;
            worked.set(key, (worked.get(key) ?? 0) + (duty.end.getTime() - duty.start.getTime()) / HOUR);
        }
        return worked;
    };

    test("asked of a day, it plans that day alone — no new duty starts outside it — each person within their contract's hours for the week the day is in, the rest of that week's duties counted", () => {
        // Thursday of the warehouse's week: the Roster's day view.
        const from = new Date(warehouseStart.getTime() + 4 * DAY);
        const asked = { from, to: new Date(from.getTime() + DAY), period: variant("day", null), run: 4n, slice: new Map() };
        const { after } = run(all, asked);
        for (const [key, duty] of all) assert.ok(sameDuty(after.get(key)!, duty), key);
        const added = [...after].filter(([key]) => !all.has(key));
        assert.ok(added.length > 0, "the day is short somewhere");
        assert.ok(added.every(([, duty]) => duty.start >= asked.from && duty.start < asked.to), "every new duty starts within the day");
        // The week holds each person's other duties: none is taken past their contract by the day's plan.
        for (const [key, hours] of hoursByWeek(after)) {
            const person = warehousePeople.get(key.split("|")[0]!)!;
            const before = hoursByWeek(all).get(key) ?? 0;
            assert.ok(hours <= Math.max(person.contract, before) + 1e-9, `${key}: ${hours} h is past the contract`);
        }
        // Asked again of the same day, nothing is left to do.
        const again = run(after, { ...asked, run: 5n }).answer;
        const unchanged = diffFor(ex.WarehouseDuties)(new SortedMap([], byString), new SortedMap([], byString));
        assert.ok(equalFor(PatchType(ex.WarehouseDuties))(again as never, unchanged), printFor(PatchType(ex.WarehouseDuties))(again as never));
    });

    test("asked of a month — the weeks the Roster's month view shows, from a Sunday — it plans every week of it and no day past it, each person within their contract's hours each week", () => {
        // April 2028 as the month view shows it: Sun 26 Mar to Sat 6 May, six weeks with no duty yet.
        const from = new Date("2028-03-26T00:00:00Z"), to = new Date("2028-05-07T00:00:00Z");
        const { after } = run(all, { from, to, period: variant("month", null), run: 6n, slice: new Map() });
        const added = new Map([...after].filter(([key]) => !all.has(key)));
        assert.ok([...added.values()].every((duty) => duty.start >= from && duty.start < to), "every new duty starts within the month's weeks");
        const weeks = new Set([...added.values()].map((duty) => Math.floor(dayOf(duty.start, from) / 7)));
        assert.deepEqual([...weeks].sort(), [0, 1, 2, 3, 4, 5], "each of its six weeks is planned");
        for (const [key, hours] of hoursByWeek(added)) {
            const person = warehousePeople.get(key.split("|")[0]!)!;
            assert.ok(hours <= person.contract + 1e-9, `${key}: ${hours} h is past the contract`);
        }
    });
});

describe("the second step's optimiser over the first step's week, every duty in no team (#1548), read through the duties' and the targets' indexes", () => {
    type Loose = ValueTypeOf<typeof base.NoGroupDuty>;
    type Slot = ValueTypeOf<typeof RosterSlotType>;
    const sameLoose = equalFor(base.NoGroupDuty);
    const sameTeam = equalFor(OptionType(StringType));
    const bySlot = compareFor(RosterSlotType);
    const slotText = printFor(RosterSlotType);
    const monday = new Date("2028-03-06T00:00:00Z");
    const dayOf = (at: Date) => Math.floor((at.getTime() - monday.getTime()) / DAY);
    const teams = new Map([["inbound", { name: "Inbound" }], ["dispatch", { name: "Dispatch" }]]);
    const request = { from: monday, to: new Date(monday.getTime() + 7 * DAY), period: variant("week", null), run: 1n, slice: new Map() };
    const place = (base.rotaPlaceShifts.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => { duties: unknown };
    const patched = patchedFor(base.NoGroupDuties);
    const run = (duties: ReadonlyMap<string, Loose>, run = 1n) => {
        const answer = place(
            indexEntries(base.noGroupDuties, base.noGroupDuties.indexes.rota_no_group_duties_by_time, duties).entries, duties,
            indexEntries(base.noGroupCover, base.noGroupCover.indexes.rota_no_group_cover_by_day, base.noGroupCoverRows).entries, base.noGroupCoverRows,
            base.noGroupStaffRows, teams, { ...request, run }).duties;
        return { answer, after: patched(duties, answer) };
    };
    const week = new SortedMap<string, Loose>([...base.noGroupShifts], byString);
    const teamOf = (duties: ReadonlyMap<string, Loose>, key: string) => duties.get(key)!.team;
    // The week's targets by slot, from the example's own rows.
    const requirements = new SortedMap([...base.noGroupCoverRows.values()].map((row) => [{ day: BigInt(dayOf(row.day)), group: row.team, shift: row.shift }, row.heads] as const), bySlot);

    test("each duty in no team goes to its person's own team where a head is open, then to any team with one; one no team needs stays in none", () => {
        const { after } = run(week);
        assert.deepEqual([...after.keys()], [...week.keys()], "no duty added or removed");
        for (const [key, duty] of after) assert.ok(sameLoose({ ...duty, team: none }, week.get(key)!), `${key}: its person, times and shift as they were`);
        // Monday: everyone in their own team.
        for (const [person, worker] of base.noGroupStaffRows) assert.ok(sameTeam(teamOf(after, `mon-${person}`), some(worker.team)), person);
        // Wednesday: Mia's late takes Inbound's one late, and Lea's, the one late too many, stays in no team.
        assert.ok(sameTeam(teamOf(after, "wed-w-03"), some("inbound")));
        assert.ok(sameTeam(teamOf(after, "wed-w-05"), none));
        // Thursday, with Ben off: Lea's late goes to Dispatch, the team with a late open.
        assert.ok(sameTeam(teamOf(after, "thu-w-05"), some("dispatch")));
    });

    test("no slot holds more duties than its heads", () => {
        const { after } = run(week);
        const held = new SortedMap<Slot, number>([], bySlot);
        for (const duty of after.values()) {
            if (duty.team.type !== "some") continue;
            const slot: Slot = { day: BigInt(dayOf(duty.start)), group: duty.team.value, shift: duty.shift };
            held.set(slot, (held.get(slot) ?? 0) + 1);
        }
        for (const [slot, count] of held) assert.ok(count <= Number(requirements.get(slot) ?? 0n), slotText(slot));
    });

    test("a duty in a team stays where it is and holds its head: run again on the answer, nothing moves; a duty moved by hand keeps its team", () => {
        const once = run(week).after;
        const again = run(once, 2n).after;
        for (const [key, duty] of once) assert.ok(sameLoose(again.get(key)!, duty), key);
        // Ada's Monday early moved to Dispatch by hand, and Tom's taken out to no team.
        const moved = new SortedMap<string, Loose>([...once], byString);
        moved.set("mon-w-01", { ...once.get("mon-w-01")!, team: some("dispatch") });
        moved.set("mon-w-02", { ...once.get("mon-w-02")!, team: none });
        const after = run(moved, 3n).after;
        assert.ok(sameTeam(teamOf(after, "mon-w-01"), some("dispatch")), "a duty in a team stays there");
        assert.ok(sameTeam(teamOf(after, "mon-w-02"), some("inbound")), "Ada holds Dispatch's one early, so Tom's goes to Inbound's open one");
    });
});

describe("the night warehouse's optimiser, its week by when its shifts end (#1553), read through the shifts' index, its edges among it", () => {
    type Shift = ValueTypeOf<typeof ex.NightsShift>;
    const sameShift = equalFor(ex.NightsShift);
    const monday = new Date("2028-03-06T00:00:00Z");
    const _Asked = Roster.Types.OptimiseRequest({ edges: true });
    const request: ValueTypeOf<typeof _Asked> = {
        from: monday, to: new Date(monday.getTime() + 7 * DAY), period: variant("week", null), run: 1n, slice: new Map(), fixed: new Set<string>(),
    };
    const plan = (ex.rotaPlanNights.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => { duties: unknown };
    const clear = (ex.rotaClearEdges.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => { duties: unknown };
    const patched = patchedFor(ex.NightsShifts);
    const byTime = (rows: ReadonlyMap<string, Shift>) => indexEntries(ex.nightsShifts, ex.nightsShifts.indexes.rota_nights_shifts_by_time, rows).entries;
    const run = (rows: ReadonlyMap<string, Shift>, asked: typeof request = request) => {
        const answer = plan(byTime(rows), rows, ex.nightsWorkerRows, ex.nightsShiftTimeRows, asked).duties;
        return { answer, after: patched(rows, answer) };
    };
    const rows = new SortedMap<string, Shift>([...ex.nightsShiftRows], byString);
    /** The shifts of an answer not in the rows asked over, by key. */
    const addedTo = (after: ReadonlyMap<string, Shift>, asked: ReadonlyMap<string, Shift>) => [...after].filter(([key]) => !asked.has(key));
    const unchanged = diffFor(ex.NightsShifts)(new SortedMap([], byString), new SortedMap([], byString));
    const samePatch = equalFor(PatchType(ex.NightsShifts));
    const printPatch = printFor(PatchType(ex.NightsShifts));

    test("the night before the week is kept at the shift's own times and taken away from a person off nights, and the Monday left is added; the week's last night and the next week's early stand as they are", () => {
        const { after } = run(rows);
        assert.equal(after.has("mia-sun-before"), false, "Mia's night before the week taken away");
        assert.ok(sameShift(after.get("tom-sun-before")!, {
            ...rows.get("tom-sun-before")!, start: new Date("2028-03-05T22:00:00Z"), end: new Date("2028-03-06T06:00:00Z"),
        }), "Tom's night before the week at the night's own times");
        for (const key of ["ada-next-mon", "tom-sun", "ada-mon", "tom-mon", "mia-tue"]) assert.ok(sameShift(after.get(key)!, rows.get(key)!), key);
        const added = addedTo(after, rows);
        assert.equal(added.length, 1);
        assert.match(added[0]![0], /^elara-1-\d+$/);
        assert.ok(sameShift(added[0]![1], { who: "w-03", shift: "early", team: "inbound", start: new Date("2028-03-06T06:00:00Z"), end: new Date("2028-03-06T14:00:00Z") }),
            "Mia's Monday early");
    });

    test("with the week before published, its shifts among `fixed` stand as they are and hold their people's Monday: the answer changes nothing", () => {
        const { answer } = run(rows, { ...request, fixed: new Set(["mia-sun-before", "tom-sun-before"]) });
        assert.ok(samePatch(answer as never, unchanged), printPatch(answer as never));
    });

    test("a night before the week the plan adds is planned from the Sunday, under a key of the run's own", () => {
        const without = new SortedMap<string, Shift>([...rows].filter(([key]) => key !== "tom-sun-before"), byString);
        const added = addedTo(run(without).after, without);
        assert.equal(added.length, 2, "Tom's night before the week, and Mia's Monday early");
        assert.ok(added.some(([key, shift]) => /^elara-1-\d+$/.test(key) && sameShift(shift,
            { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-05T22:00:00Z"), end: new Date("2028-03-06T06:00:00Z") })), "Tom's night from the Sunday before the week");
    });

    test("run again on its answer, nothing changes", () => {
        const once = run(rows).after;
        const { answer } = run(once, { ...request, run: 2n });
        assert.ok(samePatch(answer as never, unchanged), printPatch(answer as never));
    });

    test("its plan is the business week's: asked of a day, or of a month, it changes nothing", () => {
        const tuesday = new Date(monday.getTime() + DAY);
        const day = run(rows, { ...request, from: tuesday, to: new Date(tuesday.getTime() + DAY), period: variant("day", null) }).answer;
        assert.ok(samePatch(day as never, unchanged), printPatch(day as never));
        const month = run(rows, { ...request, from: new Date("2028-02-28T00:00:00Z"), to: new Date("2028-04-03T00:00:00Z"), period: variant("month", null) }).answer;
        assert.ok(samePatch(month as never, unchanged), printPatch(month as never));
    });

    test("the test's own optimiser takes away every shift at the week's edges, fixed or not: what the Roster refuses for a fixed one", () => {
        const after = patched(rows, clear(byTime(rows), rows, request).duties);
        assert.deepEqual(["ada-next-mon", "mia-sun-before", "tom-sun-before"].map((key) => after.has(key)), [false, false, false]);
        assert.ok(sameShift(after.get("tom-sun")!, rows.get("tom-sun")!), "the week's last night starts in the week");
    });
});
