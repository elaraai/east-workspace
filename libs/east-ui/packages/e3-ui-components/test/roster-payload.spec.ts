/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's payload over the warehouse's own records on e3 itself (#1368,
 * `Builder Interfaces Spec.md` §5): its tag's East function binds the duties,
 * the weeks of the rota, the cover targets, the staff, the agencies and the
 * lists as the warehouse example does, and compiles against the platform a UI
 * task's preview gives it, so what the payload reads is e3's. The people come
 * from their kind's accessors; the week's duties through the slice's duty
 * source, each read as the Roster reads it — the warehouse's seeded week, the
 * fixture the e3-ui specs hold the Roster's functions to; a move and back
 * leaves a duty's row as it was (B10, B1); and the app's pay and check cross
 * as bytes, each request carrying every duty's own row (B16).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue,
    isTypeEqual, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { Roster } from "@elaraai/e3-ui";
import { Data, Func, Record, RosterPayloadType, Schedule, createRosterPayload, rosterMove, rosterPlacement } from "@elaraai/e3-ui/internal";
import * as rx from "@elaraai/e3-ui/examples/roster/roster";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "roster/roster": rx });

const DAY = 86_400_000;
const byString = compareFor(StringType);
const Duty = rx.WarehouseDuty;
const encodeDuty = encodeBeast2For(Duty);
const decodeDuty = decodeBeast2For(Duty);
const dutyEqual = equalFor(Duty);
const dateEqual = equalFor(DateTimeType);
const Assignments = DictType(StringType, Roster.Types.Assignment(Duty));
const encodeCover = encodeBeast2For(rx.WarehouseCover);
const decodeCover = decodeBeast2For(rx.WarehouseCover);
const placementOf = East.compile(rosterPlacement(Duty), []);
const move = East.compile(rosterMove, []);
type Payload = ValueTypeOf<typeof RosterPayloadType>;
type Context = ValueTypeOf<typeof Roster.Types.Context>;

/** The warehouse's payload, the tag over its records as the warehouse example binds them, with its pay and its check. */
const program = East.function([], RosterPayloadType, ($) => {
    const rota = $.let(Record.bind(rx.rosterDuties, [rx.rosterDutiesPatch]));
    const entries = $.let(Data.bindPaged(rx.rosterDuties));
    const byTime = $.let(Data.bindPaged(rx.rosterDuties, { indexes: [rx.rosterDutiesByTime] }));
    const weeks = $.let(Record.bind(rx.rosterWeeks, [rx.rosterWeeksPatch]));
    const cover = $.let(Record.bind(rx.rosterCover, [rx.rosterCoverPatch]));
    const people = $.let(Data.bind(rx.rosterStaff));
    const acts = $.let(Data.bind(rx.rosterActivities));
    const firms = $.let(Data.bind(rx.rosterAgencies));
    const times = $.let(Data.bind(rx.rosterShiftTimes));
    const teams = $.let(Data.bind(rx.rosterTeams));
    const roles = $.let(Data.bind(rx.rosterPositions));
    const ideas = $.let(Data.bind(rx.rosterSuggestions));
    const fit = $.let(Func.bind(rx.rosterStaffFit));
    const slice = $.let(Slice.bindRecords("spec.rosterPayload", { duty: { source: byTime, range: "start" } }));
    // The warehouse's pay and check (§5.6, §5.8), as its example writes them: ordinary time to the contract, OT1 past it, an agency at its rate.
    const rateRows = $.let(Data.bind(rx.rosterPayRates));
    const rates = $.const(rateRows.read());
    const pay = $.const(East.function([Roster.Types.PayRequest(Duty)], Roster.Types.Pay, ($2, req) => {
        const out = $2.let(new Map(), Roster.Types.Pay);
        const zero = $2.const(0.0, FloatType);
        const agency = $2.let(true);
        const contract = $2.let(0.0, FloatType);
        $2.match(req.who, { person: ($3, key) => {
            $3.if(req.context.people.has(key), ($4) => {
                const person = $4.const(req.context.people.get(key));
                $4.assign(agency, person.agency);
                $4.assign(contract, person.contract);
            });
        } });
        const worked = $2.let(0.0, FloatType);
        const ordered = $2.const(req.duties.toArray(($3, duty, key) => ({ key, duty })).sort(($3, d) => d.duty.start));
        $2.for(ordered, ($3, d) => {
            const costs = $3.let(new Map(), DictType(StringType, FloatType));
            $3.if(agency, ($4) => {
                $4(costs.insert("AGENCY", d.duty.hours.multiply(rates.get("AGENCY", () => 0.0))));
            }).else(($4) => {
                const ordinary = $4.const(East.max(East.min(d.duty.hours, contract.subtract(worked)), zero));
                const over = $4.const(d.duty.hours.subtract(ordinary));
                $4(costs.insert("ORD", ordinary.multiply(rates.get("ORD", () => 0.0))));
                $4.if(East.greater(over, 0.0), ($5) => { $5(costs.insert("OT1", over.multiply(rates.get("OT1", () => 0.0)))); });
            });
            $3.assign(worked, worked.add(d.duty.hours));
            $3(out.insert(d.key, costs));
        });
        return out;
    }));
    const check = $.const(East.function([Roster.Types.CheckContext(Duty)], ArrayType(Roster.Types.Issue), ($2, cx) => {
        const issues = $2.let([], ArrayType(Roster.Types.Issue));
        $2.for(cx.week.assignments, ($3, a, id) => {
            const costs = $3.const(cx.pay.get(id, () => East.value(new Map(), DictType(StringType, FloatType))));
            $3.if(costs.has("OT1").and(() => East.notEqual(a.row.agreed, some(true))), ($4) => {
                $4(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null), title: "Overtime not agreed",
                    detail: East.str`${a.row.team} · ${a.row.shift}`, slot: some(a.slot), assignment: some(id), flag: some("OT"), fix: none }));
            });
        });
        return issues;
    }));
    return createRosterPayload({
        id: "spec", week: { start: "sunday" }, view: { date: new Date("2028-03-09T00:00:00Z") }, slice: { slice }, fit, pay, currency: "AUD", check, inspector: true,
        events: { duty: Schedule.events(rota, {
            name: "Duty", icon: "user-clock", entries,
            start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
            shift: "shift", group: "team", position: "role", activity: "task",
            hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
        }) },
        resources: {
            people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
            agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
        },
        periods: Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" }),
        targets: Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" }),
        shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }),
        groups: Roster.groups(teams.read(), { label: t => t.label, order: t => t.order }),
        positions: Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order }),
        activities: Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
        proposals: Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why }),
    });
});

/** The payload, built over e3 as a UI task's preview builds it, its slice made on the record Slice's platform over e3's pages. */
async function built(): Promise<Payload> {
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    const implementations = [...platform];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return East.compile(program, implementations)();
}
/** The context the Roster's functions read, from the payload: every person, list and rule. */
const contextOf = (value: Payload): Context => ({
    people: new SortedMap(value.people.map((person) => [person.key, person]), byString), groups: value.groups, activities: value.activities,
    shifts: value.shifts, positions: value.positions, agencies: value.agencies, rules: value.rules,
});
/** The week of `start` as the Roster reads it from the duty kind's rows: every duty placed in it, by key. */
async function weekOf(value: Payload, start: Date): Promise<ValueTypeOf<typeof Assignments>> {
    // A duty of the week starts within twelve hours of a shift start on one of its days.
    const rows = await h.ready(() => value.duty.rows(new Date(start.getTime() - DAY / 2), new Date(start.getTime() + 7.5 * DAY)));
    const context = contextOf(value);
    const placed: ValueTypeOf<typeof Assignments> = new SortedMap([], byString);
    for (const [key, entry] of rows) {
        const placement = placementOf(entry.roles, decodeDuty(entry.row), key, start, context);
        if (placement.type === "placed") placed.set(key, placement.value);
        else assert.equal(placement.type, "elsewhere", `${key} is a duty of another week, or placed`);
    }
    return placed;
}

describe("the Roster's payload over the warehouse's records", () => {
    test("builds the people and the agencies from their kinds' accessors, each person's every one, and the lists in their order", async () => {
        const value = await built();
        assert.equal(value.people.length, 69);
        const alder = value.people.find((person) => person.key === "aalder")!;
        assert.ok(equalFor(Roster.Types.Person)(alder, {
            key: "aalder", name: "A. Alder", group: "inbound", position: "lead", skills: new Set(["unload", "reach", "xdock", "rcvqa", "yard"]),
            contract: 38, agency: false, trainer: false, trainee: false, usual: some("early"),
        }));
        assert.deepEqual(value.agencies, [{ key: "northside", name: "Northside Staffing" }]);
        assert.deepEqual(value.shifts.map((shift) => shift.key), ["early", "late", "night"]);
        assert.deepEqual(value.groups.map((group) => group.key), ["inbound", "picking", "dispatch"]);
        assert.deepEqual(value.positions.map((position) => [position.key, position.lead]), [["acting", true], ["crew", false], ["deputy", true], ["lead", true]]);
        assert.deepEqual([value.activities.length, value.activities.at(-1)?.key], [17, "general"]);
        assert.ok(equalFor(DateTimeType)(value.proposals[0]!.day, new Date("2028-03-09T00:00:00Z")));
        assert.deepEqual(value.proposals.map((proposal) => [proposal.key, proposal.person]), [["s317", "nochre"], ["s318", "bpumice"]]);
        assert.deepEqual(value.rules, { rest: 10, lead: true, trainer: true, skill: true });
        assert.deepEqual([value.currency, value.fit, value.inspector], [some("AUD"), some({ name: "roster_staff_fit" }), true]);
        assert.ok(isTypeEqual(fromEastTypeValue(value.duty.rowType), Duty));
        assert.deepEqual([value.duty.roles.position, value.duty.roles.activity], [true, true]);
    });

    test("reads the week's duties through the slice's duty source, each as the Roster reads it — the warehouse's seeded week — and the record never whole", async () => {
        const value = await built();
        assert.ok(equalFor(Assignments)(await weekOf(value, rx.warehouseStart), rx.warehouseWeek.assignments), "this week");
        assert.ok(equalFor(Assignments)(await weekOf(value, rx.warehousePreviousStart), rx.warehousePrevious.assignments), "the week before");
        assert.equal(h.requests("read", "records.roster_duties").length, 0, "the duties are never read whole");
        // Its session is over the record's revision, with no snapshot of the record.
        assert.equal(value.duty.kind.editing.snapshot.type, "none");
    });

    test("a duty counts what the kind's `hours` makes of it: its length less its unpaid break", async () => {
        const value = await built();
        const s1 = (await h.read(rx.rosterDuties)).get("s1")!;
        assert.equal(value.duty.read(encodeDuty(s1), "s1").hours, 8);
        assert.equal(value.duty.read(encodeDuty({ ...s1, unpaidBreak: 30 }), "s1").hours, 7.5);
    });

    test("a move and back through the duty kind leaves the duty's row as it was (B10, B1)", async () => {
        const value = await built();
        const context = contextOf(value);
        const s1 = (await h.read(rx.rosterDuties)).get("s1")!;
        const bytes = encodeDuty(s1);
        const moved = move(value.duty.read(bytes, "s1"), rx.warehouseStart, { day: 2n, group: "picking", shift: "late" }, context);
        if (moved.type !== "some") assert.fail("expected the duty moved");
        const written = value.duty.write(bytes, moved.value);
        if (written.type !== "some") assert.fail("expected the duty written");
        const there = decodeDuty(written.value);
        assert.ok(dutyEqual(there, { ...s1, start: new Date("2028-03-07T14:00:00Z"), end: new Date("2028-03-07T22:00:00Z"), shift: "late", team: "picking" }),
            "its slot's fields and its times written; its role, task, break, agreement, cost centre and note its own");
        const back = move(value.duty.read(written.value, "s1"), rx.warehouseStart, { day: 4n, group: "inbound", shift: "early" }, context);
        if (back.type !== "some") assert.fail("expected the duty moved back");
        const returned = value.duty.write(written.value, back.value);
        if (returned.type !== "some") assert.fail("expected the duty written back");
        assert.ok(dutyEqual(decodeDuty(returned.value), s1), "and back");
    });

    test("the targets: the week's by their day, a row's roles read and written, its other fields its own, a new one's their type's default", async () => {
        const value = await built();
        if (value.targets.type !== "some") assert.fail("expected the targets");
        const targets = value.targets.value;
        const rows = await h.ready(() => targets.rows(rx.warehouseStart, rx.warehouseNextStart));
        assert.equal(rows.size, 63, "a target per slot of the week");
        const [key, entry] = [...rows].find(([, row]) => row.roles.group === "inbound" && row.roles.shift === "early" && dateEqual(row.roles.day, rx.warehouseStart))!;
        assert.deepEqual([entry.roles.positions, [...entry.roles.hours.keys()]], [11n, ["putaway", "rcvqa", "reach", "unload", "xdock", "yard"]]);
        const written = decodeCover(targets.write(entry.row, { ...entry.roles, positions: 12n }));
        assert.deepEqual([written.heads, written.basis], [12n, "forecast"], `${key}: its heads written, and what it rests on its own`);
        const created = decodeCover(targets.create({ ...entry.roles, positions: 2n }));
        assert.deepEqual([created.heads, created.team, created.basis], [2n, "inbound", ""], "a new target's other fields their type's default");
        assert.ok(equalFor(rx.WarehouseCover)(decodeCover(encodeCover(written)), written));
    });

    test("the weeks: this one a draft, the one before published, and when", async () => {
        const value = await built();
        if (value.periods.type !== "some") assert.fail("expected the periods");
        const periods = value.periods.value;
        const rows = await h.ready(() => periods.rows(rx.warehousePreviousStart, rx.warehouseNextStart));
        assert.equal(rows.size, 2);
        assert.ok(equalFor(Roster.Types.Status)(periods.status(rows.get(rx.warehouseStart)!), variant("draft", null)));
        assert.ok(equalFor(Roster.Types.Status)(periods.status(rows.get(rx.warehousePreviousStart)!),
            variant("published", { at: some(new Date("2028-03-04T12:00:00Z")) })));
        assert.equal(periods.dismissible, true);
    });

    test("the app's pay and check cross as bytes, each request carrying every duty's own row (B16)", async () => {
        const value = await built();
        if (value.pay.type !== "some" || value.check.type !== "some") assert.fail("expected the pay and the check");
        const context = contextOf(value);
        const week = rx.warehouseWeek;
        // H. Aspen's five duties: ordinary time up to their 38 contracted hours, then two hours of OT1 on the last of them, Thursday's.
        const theirs = new SortedMap([...week.assignments].filter(([, a]) => a.who.type === "person" && a.who.value === "haspen"), byString);
        const PayRequest = Roster.Types.PayRequest(Duty);
        const pay = value.pay.value(encodeBeast2For(PayRequest)({ who: variant("person", "haspen"), start: rx.warehouseStart, duties: theirs, context }));
        assert.deepEqual([...pay].map(([key, costs]) => [key, [...costs]]), [
            ["s5", [["ORD", 252], ["OT1", 126]]], ["s6", [["ORD", 336]]], ["s7", [["ORD", 336]]], ["s8", [["ORD", 336]]], ["s9", [["ORD", 336]]],
        ]);
        // An agency's request is the agency's rate.
        const requests = new SortedMap([...week.assignments].filter(([, a]) => a.who.type === "request"), byString);
        const agency = value.pay.value(encodeBeast2For(PayRequest)({ who: variant("request", "northside"), start: rx.warehouseStart, duties: requests, context }));
        assert.deepEqual([...agency].map(([key, costs]) => [key, [...costs]]), [["s217", [["AGENCY", 408]]], ["s250", [["AGENCY", 408]]]]);
        // The check reads the pay and each duty's row: overtime nobody agreed.
        const CheckContext = Roster.Types.CheckContext(Duty);
        const coverage = East.compile(Roster.coverage(Duty), [])(week, context, pay);
        const issues = value.check.value(encodeBeast2For(CheckContext)({ start: rx.warehouseStart, week, context, coverage, pay }));
        assert.deepEqual(issues.map((issue) => [issue.title, issue.assignment]), [["Overtime not agreed", some("s5")]]);
    });
});
