/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Roster's optimiser (#1409, `Optimise Spec.md` §3): the warehouse's week
 * in, the week out — `Roster.Types.OptimiseRequest(WarehouseDuty)` to
 * `Roster.Types.OptimiseResult(WarehouseDuty)`, an `e3.function` — bound to the
 * Roster's `optimise`, which the Elara eye calls once per run and whose answer
 * lands in the session as one edit. A warehouse whose week runs by when its
 * shifts end binds one that takes the duties at the week's edges too (#1553):
 * `Roster.Types.OptimiseRequest(NightsShift, { edges: true })`.
 */
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType, VariantType,
    compareFor, example, none, some, variant, type BlockBuilder, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui";
import { WarehouseDuty } from "./warehouse.js";
import {
    MinimalShiftTime, minimalTeams, rosterActivities, rosterAgencies, rosterCover, rosterDuties, rosterPatterns, rosterPositions, rosterShiftTimes, rosterStaff, rosterStaffFit,
    rosterSuggestions, rosterTeams, rosterWeeks,
} from "./roster.examples.js";

/** One person on one day of the week: who is booked when, so a run never books the same person twice on a day. */
const Booked = StructType({ day: IntegerType, person: StringType });
/** A person's duty's times: what a new duty of theirs keeps ten hours clear of — the warehouse's rest rule. */
const Span = StructType({ person: StringType, start: DateTimeType, end: DateTimeType });
const Request = Roster.Types.OptimiseRequest(WarehouseDuty), Result = Roster.Types.OptimiseResult(WarehouseDuty);
type Block = BlockBuilder<typeof Result>;
type PersonExpr = ExprType<typeof Roster.Types.Person>;
type ShiftExpr = ExprType<typeof Roster.Types.Shift>;

/**
 * The warehouse's optimiser's body, in two passes over the week as drafted, every duty it held kept as it was. First the
 * targets: every slot short of its heads is filled from the people of its group who can take it, those with the fewest
 * hours this week first. Then everyone to their contract, whatever the week's targets — so an empty week fills, this one
 * or any other: on each of their days off, their usual shift in their own group. A person takes a shift only off that
 * day, within their contract's hours and ten hours clear of every other duty of theirs (the warehouse's rest rule); the
 * agency's workers are left out. A new duty runs the shift's hours on its day, booked to the team's cost centre, under a
 * key of the run's own.
 */
export const rosterOptimiseBody = East.function([Request], Result, ($, req) => {
    const planned = $.let(new Map(), DictType(StringType, WarehouseDuty));
    // Who is booked on each day, each person's hours this week and each team's cost centre, from the week as drafted.
    const booked = $.let(new Set<{ day: bigint; person: string }>(), SetType(Booked));
    const spans = $.let(new Set<{ person: string; start: Date; end: Date }>(), SetType(Span));
    const hours = $.let(new Map(), DictType(StringType, FloatType));
    const centres = $.let(new Map(), DictType(StringType, StringType));
    $.for(req.duties, ($2, duty, key) => {
        $2(planned.insert(key, duty));
        $2(centres.insertOrUpdate(duty.team, duty.costCentre, (_$3, held, _given) => held));
        $2.match(duty.who, { staff: ($3, person) => {
            const day = $3.const(req.from.durationMilliseconds(duty.start).divide(86_400_000n));
            // A person drafted twice on a day is booked once.
            $3.if(booked.has({ day, person }).not(), ($4) => { $4(booked.insert({ day, person })); });
            $3(spans.insert({ person, start: duty.start, end: duty.end }));
            $3(hours.insertOrUpdate(person, duty.start.durationHours(duty.end), (_$4, held, more) => held.add(more)));
        } });
    });
    const shifts = $.const(req.context.shifts.toDict(($2, shift) => shift.key, ($2, shift) => shift));
    const people = $.const(req.context.people.toArray(($2, person) => person));
    const days = $.let([0n, 1n, 2n, 3n, 4n, 5n, 6n], ArrayType(IntegerType));
    const added = $.let(0n, IntegerType);
    /** A shift's start on a day of the week, and its end for its hours — fractional hours as whole minutes. */
    const timesOf = (day: ExprType<IntegerType>, shift: ShiftExpr) => {
        const start = req.from.addDays(day).addHours(shift.start.hour).addMinutes(shift.start.minute);
        return { start, end: start.addMinutes(East.Float.roundHalf(shift.hours.multiply(60.0))) };
    };
    /** Whether a person can take a shift on a day: off that day, within their contract, and ten hours clear of every other duty of theirs. */
    const takes = (person: PersonExpr, day: ExprType<IntegerType>, shift: ShiftExpr, start: ExprType<DateTimeType>, end: ExprType<DateTimeType>) =>
        booked.has({ day, person: person.key }).not()
            .and(() => hours.get(person.key, () => 0.0).add(shift.hours).lessEqual(person.contract))
            .and(() => spans.filter(($2, span) => span.person.equal(person.key).and(() => span.end.durationHours(start).less(10.0)).and(() => end.durationHours(span.start).less(10.0))).size().equal(0n));
    /** A new duty: the person on the shift that day in the group, at the shift's times, booked to the group's cost centre, under a key of the run's own. */
    const place = ($2: Block, person: PersonExpr, day: ExprType<IntegerType>, shift: ShiftExpr, group: ExprType<StringType>, start: ExprType<DateTimeType>, end: ExprType<DateTimeType>) => {
        $2.assign(added, added.add(1n));
        $2(planned.insert(East.str`elara-${req.run}-${added}`, {
            who: variant("staff", person.key), start, end, shift: shift.key, team: group, role: person.position, task: none,
            unpaidBreak: 0.0, agreed: none, costCentre: centres.get(group, () => ""), note: "",
        }));
        $2(booked.insert({ day, person: person.key }));
        $2(spans.insert({ person: person.key, start, end }));
        $2(hours.insertOrUpdate(person.key, shift.hours, (_$3, held, more) => held.add(more)));
    };
    // First the targets: every slot short of its heads, from the group's own people who can take it, the fewest hours first.
    $.for(req.requirements, ($2, need, slot) => {
        // The slot's heads, less the duties already on it.
        const filled = $2.const(planned.filter(($3, duty) => duty.team.equal(slot.group).and(() => duty.shift.equal(slot.shift))
            .and(() => req.from.durationMilliseconds(duty.start).divide(86_400_000n).equal(slot.day))).size());
        const open = $2.const(need.positions.subtract(filled));
        $2.if(open.greater(0n).and(() => shifts.has(slot.shift)), ($3) => {
            const shift = $3.const(shifts.get(slot.shift));
            const times = timesOf(slot.day, shift);
            const start = $3.const(times.start), end = $3.const(times.end);
            const free = $3.const(people
                .filter(($4, person) => person.group.equal(slot.group).and(() => person.agency.not()).and(() => takes(person, slot.day, shift, start, end)))
                .sort(($4, person) => hours.get(person.key, () => 0.0)));
            $3.for(free, ($4, person, i) => {
                $4.if(i.less(open), ($5) => { place($5, person, slot.day, shift, slot.group, start, end); });
            });
        });
    });
    // Then everyone to their contract, whatever the week's targets: on each of their days off, their usual shift in their own
    // group, while another fits within their contract and keeps ten hours clear of their other duties.
    $.for(people, ($2, person) => {
        $2.match(person.usual, { some: ($3, usual) => {
            $3.if(person.agency.not().and(() => shifts.has(usual)), ($4) => {
                const shift = $4.const(shifts.get(usual));
                $4.for(days, ($5, day) => {
                    const times = timesOf(day, shift);
                    const start = $5.const(times.start), end = $5.const(times.end);
                    $5.if(takes(person, day, shift, start, end), ($6) => { place($6, person, day, shift, person.group, start, end); });
                });
            });
        } });
    });
    return { duties: planned };
});
/** The warehouse's optimiser, on e3: the week's duties in, the week's duties out — its targets met, then everyone to their contract, whatever the week. */
export const rotaOptimise = e3.function("rota_optimise", rosterOptimiseBody);

export const rosterOptimise = example({
    inputs: [], description: "The warehouse roster with the Elara eye (#1409): `optimise` is Func.bind of the warehouse's optimiser on e3 — Roster.Types.OptimiseRequest(WarehouseDuty) in, the week in view, the run number, the week's duties as drafted, its targets by slot and the Roster's context; Roster.Types.OptimiseResult(WarehouseDuty) out, the duties complete: every slot short of its heads filled from the people of its group, then everyone to their contract from their usual shift — on any week, an empty one too — within their contract and ten hours clear of their other duties. A click on the eye runs it once over the week; the result lands in the session as one edit, which one Undo reverts and Save commits with everything else.",
    keywords: ["Roster", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "one edit", "Undo", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Roster.patterns", "people", "week", "fit"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] }));
        const weeks = $.let(Record.bind(rosterWeeks));
        const cover = $.let(Record.bind(rosterCover));
        // Every person and activity is the calculation scope — and the optimiser's: the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: ["roster_staff_by_team_name", "roster_staff_by_position", "roster_staff_by_trainer", "roster_staff_by_agency", "roster_staff_by_skill", "roster_staff_by_name"] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: ["roster_activities_by_group"] }));
        const slice = $.let(Slice.bindRecords("ex.rosterOptimise", {
            duty: { source: byTime, range: "start" },
            people: { source: staffIndex, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: actIndex, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        const firms = $.let(Data.bind(rosterAgencies));
        const times = $.let(Data.bind(rosterShiftTimes));
        const teams = $.let(Data.bind(rosterTeams));
        const roles = $.let(Data.bind(rosterPositions));
        const ideas = $.let(Data.bind(rosterSuggestions));
        const weekPatterns = $.let(Data.bind(rosterPatterns));
        const fit = $.let(Func.bind(rosterStaffFit));
        // The app's optimiser: the eye calls it once per run over the week in view, and its answer is one edit.
        const optimise = $.let(Func.bind(rotaOptimise));
        return <Box width="100%" height="760px"><Roster id="rosterOptimise" week={{ start: "sunday" }} slice={{ slice }} inspector fit={fit} optimise={optimise}
            view={{ layout: "people", period: "week", date: new Date("2028-03-09T00:00:00Z") }}
            tileTimes="different"
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
            }) }}
            resources={{
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                    position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                    trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            }}
            periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" })}
            targets={Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" })}
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order, color: s => s.colour })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            patterns={Roster.patterns(weekPatterns.read(), { name: "Patterns", icon: "calendar-week", label: w => w.label, days: w => w.days, order: w => w.order })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.patterns(), Roster.library.activities()]} />
        </Box>;
    }}</Reactive>),
});

// A warehouse whose week runs by when its shifts end (#1553), as its payroll's does: a shift is planned in, and paid in, the
// week its end falls in. Its Roster's week starts on Monday, so the night from Sunday 22:00 to Monday 06:00 — the business
// week's first shift — is drawn on the Sunday, in the week before; and the week's own last night ends in the next week,
// whose plan owns it.

/** A shift of the night warehouse: who works it, which shift, in which team, and when. */
export const NightsShift = StructType({ who: StringType, shift: StringType, team: StringType, start: DateTimeType, end: DateTimeType });
/** One of its staff: a name, a team, and the shift they work the week being planned. */
export const NightsWorker = StructType({ name: StringType, team: StringType, usual: OptionType(StringType) });
/** A week of its rota, its first day a Monday: open, or issued and when. */
export const NightsWeek = StructType({ state: VariantType({ open: NullType, issued: StructType({ at: DateTimeType }) }) });

/**
 * The shifts, by key: the week planned (Monday 6 March 2028) and its edges. Ada works earlies and Tom nights, his night
 * before the week rostered from 21:00 and his last one ending in the next week; Mia, off nights this week, keeps the night
 * before it from her old plan, and her Monday is not rostered yet.
 */
export const nightsShiftRows: Map<string, ValueTypeOf<typeof NightsShift>> = new Map([
    ["ada-mon", { who: "w-01", shift: "early", team: "inbound", start: new Date("2028-03-06T06:00:00Z"), end: new Date("2028-03-06T14:00:00Z") }],
    ["ada-tue", { who: "w-01", shift: "early", team: "inbound", start: new Date("2028-03-07T06:00:00Z"), end: new Date("2028-03-07T14:00:00Z") }],
    ["ada-wed", { who: "w-01", shift: "early", team: "inbound", start: new Date("2028-03-08T06:00:00Z"), end: new Date("2028-03-08T14:00:00Z") }],
    ["ada-thu", { who: "w-01", shift: "early", team: "inbound", start: new Date("2028-03-09T06:00:00Z"), end: new Date("2028-03-09T14:00:00Z") }],
    ["ada-fri", { who: "w-01", shift: "early", team: "inbound", start: new Date("2028-03-10T06:00:00Z"), end: new Date("2028-03-10T14:00:00Z") }],
    ["ada-next-mon", { who: "w-01", shift: "early", team: "inbound", start: new Date("2028-03-13T06:00:00Z"), end: new Date("2028-03-13T14:00:00Z") }],
    ["tom-sun-before", { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-05T21:00:00Z"), end: new Date("2028-03-06T05:00:00Z") }],
    ["tom-mon", { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-06T22:00:00Z"), end: new Date("2028-03-07T06:00:00Z") }],
    ["tom-tue", { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-07T22:00:00Z"), end: new Date("2028-03-08T06:00:00Z") }],
    ["tom-wed", { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-08T22:00:00Z"), end: new Date("2028-03-09T06:00:00Z") }],
    ["tom-thu", { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-09T22:00:00Z"), end: new Date("2028-03-10T06:00:00Z") }],
    ["tom-sun", { who: "w-02", shift: "night", team: "dispatch", start: new Date("2028-03-12T22:00:00Z"), end: new Date("2028-03-13T06:00:00Z") }],
    ["mia-sun-before", { who: "w-03", shift: "night", team: "inbound", start: new Date("2028-03-05T22:00:00Z"), end: new Date("2028-03-06T06:00:00Z") }],
    ["mia-tue", { who: "w-03", shift: "early", team: "inbound", start: new Date("2028-03-07T06:00:00Z"), end: new Date("2028-03-07T14:00:00Z") }],
    ["mia-wed", { who: "w-03", shift: "early", team: "inbound", start: new Date("2028-03-08T06:00:00Z"), end: new Date("2028-03-08T14:00:00Z") }],
    ["mia-thu", { who: "w-03", shift: "early", team: "inbound", start: new Date("2028-03-09T06:00:00Z"), end: new Date("2028-03-09T14:00:00Z") }],
    ["mia-fri", { who: "w-03", shift: "early", team: "inbound", start: new Date("2028-03-10T06:00:00Z"), end: new Date("2028-03-10T14:00:00Z") }],
]);
/** The shifts, which the Roster writes through the patch door. */
export const nightsShifts = e3.record("rota_nights_shifts", DictType(StringType, NightsShift), {
    initial: nightsShiftRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
/** The staff as rows, by key: each with the shift they work the week being planned. */
export const nightsWorkerRows: Map<string, ValueTypeOf<typeof NightsWorker>> = new Map([
    ["w-01", { name: "Ada Brook", team: "inbound", usual: some("early") }],
    ["w-02", { name: "Tom Vale", team: "dispatch", usual: some("night") }],
    ["w-03", { name: "Mia Hart", team: "inbound", usual: some("early") }],
]);
export const nightsWorkers = e3.record("rota_nights_staff", DictType(StringType, NightsWorker), { initial: nightsWorkerRows });
/** Its shift times as rows, by key: an early from 6:00, a late from 14:00 and a night from 22:00, eight hours each. */
export const nightsShiftTimeRows: Map<string, ValueTypeOf<typeof MinimalShiftTime>> = new Map([
    ["early", { name: "Early", code: "E", starts: { hour: 6n, minute: 0n }, hours: 8.0, order: 1n }],
    ["late", { name: "Late", code: "L", starts: { hour: 14n, minute: 0n }, hours: 8.0, order: 2n }],
    ["night", { name: "Night", code: "N", starts: { hour: 22n, minute: 0n }, hours: 8.0, order: 3n }],
]);
export const nightsShiftTimes = e3.record("rota_nights_shift_times", DictType(StringType, MinimalShiftTime), { initial: nightsShiftTimeRows });
/** The weeks of its rota as rows, each keyed by its Monday: the week before and the week planned, both open. */
export const nightsWeekRows: SortedMap<Date, ValueTypeOf<typeof NightsWeek>> = new SortedMap<Date, ValueTypeOf<typeof NightsWeek>>([
    [new Date("2028-02-28T00:00:00Z"), { state: variant("open", null) }],
    [new Date("2028-03-06T00:00:00Z"), { state: variant("open", null) }],
], compareFor(DateTimeType));
/** The weeks of its rota, which Publish writes through the patch door. */
export const nightsWeeks = e3.record("rota_nights_weeks", DictType(DateTimeType, NightsWeek), {
    initial: nightsWeekRows,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const NightsRequest = Roster.Types.OptimiseRequest(NightsShift, { edges: true }), NightsResult = Roster.Types.OptimiseResult(NightsShift, { edges: true });
/** A person's day of the business week, Monday 0: one the plan already holds. */
const NightsHeld = StructType({ person: StringType, day: IntegerType });

/**
 * The night warehouse's optimiser (#1553): the business week — every shift ending from the week's Monday to the next —
 * planned by when each shift ends, each person on their usual shift Monday to Friday, in their own team. It sees the
 * week's duties and the duties at its edges together. A duty of a published week, among `fixed`, stands as it is and
 * holds its person's day. Every other duty ending in the business week — the night before the week among them — is
 * kept at its shift's own times, where it is its person's usual shift on a weekday not held yet, and taken away
 * otherwise; one ending outside it stands as it is: the week's last night is the next week's plan's. Each weekday left is
 * planned under a key of the run's own, a night before the week too: a new duty starting outside the week goes back among
 * the edges.
 */
export const rosterPlanNightsBody = East.function([NightsRequest], NightsResult, ($, req) => {
    const shifts = $.const(req.context.shifts.toDict(($2, shift) => shift.key, ($2, shift) => shift));
    // A person's usual shift on a day of the business week: a shift past midnight — the night — starts the day before the
    // day it ends on.
    const planned = $.const(East.function([Roster.Types.Person, Roster.Types.Shift, IntegerType], NightsShift, ($2, person, shift, day) => {
        const from = $2.const(shift.start.hour.multiply(60n).add(shift.start.minute));
        const length = $2.const(East.Float.roundHalf(shift.hours.multiply(60.0)));
        const before = $2.const(from.add(length).subtract(1n).divide(1440n));
        const start = $2.const(req.from.addDays(day.subtract(before)).addMinutes(from));
        return { who: person.key, shift: shift.key, team: person.group, start, end: start.addMinutes(length) };
    }));
    // The day of the business week a shift ending then belongs to, Monday 0; -1 for an end outside it.
    const dayOf = $.const(East.function([DateTimeType], IntegerType, ($2, end) => {
        const since = $2.const(req.from.durationMilliseconds(end));
        return East.greater(since, 0n).and(() => East.lessEqual(since, 604_800_000n)).ifElse(() => since.subtract(1n).divide(86_400_000n), () => -1n);
    }));
    // The week's duties and its edges together, by key: the request holds them apart.
    const seen = $.let(req.duties.map(($2, duty) => duty));
    $.for(req.edges, ($2, duty, key) => { $2(seen.insert(key, duty)); });
    const kept = $.let(new Map(), DictType(StringType, NightsShift));
    const held = $.let(new Set<{ person: string; day: bigint }>(), SetType(NightsHeld));
    // A published week's duties stand as they are, and hold their person's day.
    $.for(seen, ($2, duty, key) => {
        $2.if(req.fixed.has(key), ($3) => {
            $3(kept.insert(key, duty));
            const day = $3.const(dayOf(duty.end));
            $3.if(East.greaterEqual(day, 0n).and(() => held.has({ person: duty.who, day }).not()), ($4) => { $4(held.insert({ person: duty.who, day })); });
        });
    });
    // Every other duty: one ending outside the business week stands as it is; one ending on a weekday is kept where it is
    // its person's usual shift on a day not held yet, at the shift's own times; any other is taken away.
    $.for(seen, ($2, duty, key) => {
        $2.if(req.fixed.has(key).not(), ($3) => {
            const day = $3.const(dayOf(duty.end));
            $3.if(East.less(day, 0n), ($4) => { $4(kept.insert(key, duty)); }).else(($4) => {
                $4.if(East.less(day, 5n).and(() => req.context.people.has(duty.who)), ($5) => {
                    const person = $5.const(req.context.people.get(duty.who));
                    $5.match(person.usual, { some: ($6, usual) => {
                        $6.if(usual.equal(duty.shift).and(() => shifts.has(usual)).and(() => held.has({ person: duty.who, day }).not()), ($7) => {
                            $7(kept.insert(key, planned(person, shifts.get(usual), day)));
                            $7(held.insert({ person: duty.who, day }));
                        });
                    } });
                });
            });
        });
    });
    // Each weekday left, planned on its person's usual shift under a key of the run's own.
    const weekdays = $.const([0n, 1n, 2n, 3n, 4n], ArrayType(IntegerType));
    const added = $.let(0n, IntegerType);
    $.for(req.context.people, ($2, person) => {
        $2.match(person.usual, { some: ($3, usual) => {
            $3.if(shifts.has(usual), ($4) => {
                const shift = $4.const(shifts.get(usual));
                $4.for(weekdays, ($5, day) => {
                    $5.if(held.has({ person: person.key, day }).not(), ($6) => {
                        $6.assign(added, added.add(1n));
                        $6(kept.insert(East.str`elara-${req.run}-${added}`, planned(person, shift, day)));
                    });
                });
            });
        } });
    });
    // Apart again: a duty the request held among the edges goes back among them, and a new one starting outside the week.
    const week = $.const(req.from.durationMilliseconds(req.to));
    const inWeek = $.const(East.function([DateTimeType], BooleanType, ($2, at) => {
        const since = $2.const(req.from.durationMilliseconds(at));
        return East.greaterEqual(since, 0n).and(() => East.less(since, week));
    }));
    return {
        duties: kept.filter(($2, duty, key) => req.duties.has(key).or(() => req.edges.has(key).not().and(() => inWeek(duty.start)))),
        edges: kept.filter(($2, duty, key) => req.edges.has(key).or(() => req.duties.has(key).not().and(() => inWeek(duty.start).not()))),
    };
});
/** The night warehouse's optimiser, on e3: the week's duties and the duties at its edges in, both out, planned by when each shift ends. */
export const rotaPlanNights = e3.function("rota_plan_nights", rosterPlanNightsBody);

/**
 * An optimiser that takes away every duty at the week's edges, whatever is fixed (#1553): what the Roster refuses where
 * one of them is in a published week, naming it, and records nothing — its tests' own, on no page.
 */
export const rotaClearEdges = e3.function("rota_clear_edges", East.function([NightsRequest], NightsResult, ($, req) => {
    const cleared = $.let(new Map(), DictType(StringType, NightsShift));
    return { duties: req.duties, edges: cleared };
}));

export const rosterOptimiseEdges = example({
    inputs: [], description: "A warehouse whose week runs by when its shifts end (#1553), as its payroll's does: its Roster's week starts on Monday, so the night from Sunday 22:00 is drawn on the Sunday of the week before, though it is the business week's first shift, and the week's own last night ends in the next week. `optimise` is Func.bind of an e3.function from Roster.Types.OptimiseRequest(NightsShift, { edges: true }) to Roster.Types.OptimiseResult(NightsShift, { edges: true }): the run sees the week's duties and, in `edges`, every duty the window holds that the Roster places in another week, as the session holds them, unsaved drafts in place — `fixed` naming those of a published week. Its answer's `edges` are the edge duties as it leaves them: here the night before the week is kept, its times changed to the shift's own, and taken away from a person off nights; the week's last night is left to the next week, and Mia's Monday early is added — one edit, which one Undo reverts and Save writes through the patch door. Publish the week before first and its duties are fixed: the run leaves them as they are.",
    keywords: ["Roster", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "edges", "fixed", "night shift", "overnight", "week start", "monday", "payroll week", "Func.bind", "e3.function", "Schedule.periods", "published", "one edit", "Undo"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(nightsShifts));
        const weeks = $.let(Record.bind(nightsWeeks));
        const staff = $.let(Data.bind(nightsWorkers));
        const times = $.let(Data.bind(nightsShiftTimes));
        const teams = $.let(Data.bind(minimalTeams));
        // The plan by when shifts end: its function takes the edges, so the eye's run sees and plans the night before the week.
        const optimise = $.let(Func.bind(rotaPlanNights));
        return <Box width="100%" height="760px"><Roster id="rosterOptimiseEdges" week={{ start: "monday" }} inspector optimise={optimise}
            view={{ layout: "people", period: "week", date: new Date("2028-03-06T00:00:00Z") }}
            events={{ duty: Schedule.events(rota, {
                name: "Shift", icon: "user-clock",
                start: "start", end: "end", resource: { field: "who", of: "people" },
                shift: "shift", group: "team",
            }) }}
            resources={{ people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: w => w.name, group: w => w.team, usual: w => w.usual }) }}
            periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" } })}
            shifts={Roster.shifts(times.read(), { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.name })} />
        </Box>;
    }}</Reactive>),
});
