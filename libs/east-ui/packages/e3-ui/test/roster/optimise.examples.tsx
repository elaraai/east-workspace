/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Roster's optimiser (#1409, east-workspace#1622): the period in view in —
 * the day in day view, the week in week view, the month in month view — and a
 * patch of the duties out — `Roster.Types.OptimiseRequest()` to
 * `Roster.Types.OptimiseResult(WarehouseDuties)`, an `e3.function` that reads
 * the period's duties and targets through their records' interval indexes, the
 * Roster's unsaved edits of both laid over them, and the staff, the shifts and
 * the teams from the warehouse's own records — bound to the Roster's
 * `optimise`, which the Elara eye calls once per run and whose answer lands in
 * the session as one edit. A warehouse whose week runs by when its shifts end
 * binds one that may change the duties at the week's edges too (#1553):
 * `Roster.Types.OptimiseRequest({ edges: true })`.
 */
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType, VariantType,
    compareFor, example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui";
import { WarehouseDuty, WarehousePerson, WarehouseShift } from "./warehouse.js";
import {
    MinimalShiftTime, minimalTeams, rosterActivities, rosterAgencies, rosterCover, rosterDuties, rosterPatterns, rosterPositions, rosterShiftTimes, rosterStaff, rosterStaffFit,
    rosterSuggestions, rosterTeams, rosterWeeks,
} from "./roster.examples.js";

/** The duties' record type: the warehouse's duties by key. */
export const WarehouseDuties = DictType(StringType, WarehouseDuty);
/** One person on one day of the week: who is booked when, so a run never books the same person twice on a day. */
const Booked = StructType({ day: IntegerType, person: StringType });
/** A person's duty's times: what a new duty of theirs keeps ten hours clear of — the warehouse's rest rule. */
const Span = StructType({ person: StringType, start: DateTimeType, end: DateTimeType });
/** A slot of the period: its day from the period's first, its team and its shift. */
const Slot = StructType({ day: IntegerType, group: StringType, shift: StringType });
/** A person's week, counted from the first week the period touches: a contract's hours are a week's. */
const PersonWeek = StructType({ person: StringType, week: IntegerType });
/** A shift's times on a day. */
const Times = StructType({ start: DateTimeType, end: DateTimeType });
/** One of the warehouse's staff, and their key. */
const Staffer = StructType({ key: StringType, person: WarehousePerson });

/**
 * The warehouse's optimiser, on e3, in two passes over the period it is asked of — a day, a week or a month, as the
 * Roster shows it — as drafted, every duty it holds kept as it is. First the targets: every slot of the period short of
 * its heads is filled from the people of its team who can take it, those with the fewest hours that week first. Then
 * everyone to their contract, whatever the targets — so an empty period fills, this one or any other: on each of their
 * days off in it, their usual shift in their own team. A person takes a shift only off that day, within their contract's
 * hours for the week the day is in — the warehouse's weeks run from Sunday — and ten hours clear of every other duty of
 * theirs (the warehouse's rest rule); the agency's workers are left out. A new duty runs the shift's hours on its day,
 * booked to its team's cost centre, under a key of the run's own, and none falls outside the period. It reads the
 * period's targets and the duties of the weeks the period touches through their interval indexes and each by its key,
 * the Roster's unsaved edits of both laid over them; the people who are not the agency's through the staff's index;
 * and the shifts and the teams by key — never a record whole. The answer is the new duties.
 */
export const rotaOptimise = e3.function("rota_optimise", {
    inputs: [
        e3.index(rosterDuties.indexes.roster_duties_by_time), rosterDuties,
        e3.index(rosterCover.indexes.roster_cover_by_day), rosterCover,
        e3.index(rosterStaff.indexes.roster_staff_by_agency), rosterStaff,
        rosterShiftTimes, rosterTeams,
    ],
    // The Roster's unsaved edits of the duties and of the targets are laid over them, and over their indexes
    drafts: [rosterDuties, rosterCover],
    args: [Roster.Types.OptimiseRequest()],
    output: Roster.Types.OptimiseResult(WarehouseDuties),
}, ($, dutiesByTime, duties, coverByDay, cover, staffByAgency, staff, shifts, teams, request) => {
    // The period asked, in days from its first; and the warehouse's weeks it touches, each from its Sunday: a contract's
    // hours are a week's, so a day's plan reads the rest of its week, and a month's every week it holds a day of.
    const days = $.const(request.from.durationMilliseconds(request.to).divide(86_400_000n));
    const sunday = $.const(new Date("2000-01-02T00:00:00Z"));
    const lead = $.const(sunday.durationMilliseconds(request.from).divide(86_400_000n).remainder(7n));
    const weeksFrom = $.const(request.from.addDays(lead.negate()));
    const weeksTo = $.const(weeksFrom.addDays(days.add(lead).add(6n).divide(7n).multiply(7n)));
    // The week a day of the period is in, from the first the period touches.
    const weekOf = $.const(East.function([IntegerType], IntegerType, (_$2, day) => day.add(lead).divide(7n)));
    const booked = $.let(new Set<ValueTypeOf<typeof Booked>>(), SetType(Booked));
    const spans = $.let(new Set<ValueTypeOf<typeof Span>>(), SetType(Span));
    const hours = $.let(new Map(), DictType(PersonWeek, FloatType));
    // Each slot's heads, from the period's targets, less the duties on it already.
    const open = $.let(new Map(), DictType(Slot, IntegerType));
    coverByDay.overlapping({ from: request.from, to: request.to }).each($, ($2, _carried, key) => {
        const target = $2.const(cover.get(key));
        const day = $2.const(request.from.durationMilliseconds(target.day).divide(86_400_000n));
        $2(open.insertOrUpdate({ day, group: target.team, shift: target.shift }, target.heads, (_$3, held, more) => held.add(more)));
    });
    // The duties of the weeks the period touches: each person's times, for the rest rule, their days and their hours a
    // week; and the period's own, on their slots.
    dutiesByTime.overlapping({ from: weeksFrom, to: weeksTo }).each($, ($2, _carried, key) => {
        const duty = $2.const(duties.get(key));
        $2.match(duty.who, { staff: ($3, person) => { $3(spans.tryInsert({ person, start: duty.start, end: duty.end })); } });
        $2.if(East.greaterEqual(duty.start, weeksFrom), ($3) => {
            const since = $3.const(weeksFrom.durationMilliseconds(duty.start).divide(86_400_000n));
            // Its day from the period's first: before it, a day of the week the period starts in.
            const day = $3.const(since.subtract(lead));
            $3.if(East.greaterEqual(duty.start, request.from).and(() => East.less(duty.start, request.to)), ($4) => {
                const slot = $4.const({ day, group: duty.team, shift: duty.shift });
                $4.if(open.has(slot), ($5) => { $5(open.update(slot, open.get(slot).subtract(1n))); });
            });
            $3.match(duty.who, { staff: ($4, person) => {
                $4(booked.tryInsert({ day, person }));
                $4(hours.insertOrUpdate({ person, week: since.divide(7n) }, duty.start.durationHours(duty.end), (_$5, held, more) => held.add(more)));
            } });
        });
    });
    // The people who are not the agency's, through the staff's index on it, in their keys' order.
    const people = $.let([], ArrayType(Staffer));
    staffByAgency.of(false).each($, ($2, _carried, key) => { $2(people.pushLast({ key, person: staff.get(key) })); });
    const added = $.let(new Map(), WarehouseDuties);
    // A shift's start on a day of the period, and its end for its hours — fractional hours as whole minutes.
    const timesOf = $.const(East.function([IntegerType, WarehouseShift], Times, ($2, day, shift) => {
        const start = $2.const(request.from.addDays(day).addHours(shift.start.hour).addMinutes(shift.start.minute));
        return { start, end: start.addMinutes(East.Float.roundHalf(shift.hours.multiply(60.0))) };
    }));
    // Whether a person can take a shift on a day: off that day, within their contract for the day's week, and ten hours clear
    // of every other duty of theirs.
    const takes = $.const(East.function([Staffer, IntegerType, WarehouseShift, Times], BooleanType, ($2, staffer, day, shift, times) =>
        booked.has({ day, person: staffer.key }).not()
            .and(() => hours.get({ person: staffer.key, week: weekOf(day) }, () => 0.0).add(shift.hours).lessEqual(staffer.person.contract))
            .and(() => spans.filter(($3, span) => span.person.equal(staffer.key)
                .and(() => span.end.durationHours(times.start).less(10.0)).and(() => times.end.durationHours(span.start).less(10.0))).size().equal(0n))));
    // A new duty: the person on the shift that day in the team, at the shift's times, booked to the team's cost centre, under a key of the run's own.
    const place = $.const(East.function([Staffer, IntegerType, StringType, StringType, Times], NullType, ($2, staffer, day, code, group, times) => {
        $2(added.insert(East.str`elara-${request.run}-${added.size().add(1n)}`, {
            who: variant("staff", staffer.key), start: times.start, end: times.end, shift: code, team: group, role: staffer.person.position, task: none,
            unpaidBreak: 0.0, agreed: none, costCentre: teams.has(group).ifElse(() => teams.get(group).costCentre, () => ""), note: "",
        }));
        $2(booked.insert({ day, person: staffer.key }));
        $2(spans.tryInsert({ person: staffer.key, start: times.start, end: times.end }));
        $2(hours.insertOrUpdate({ person: staffer.key, week: weekOf(day) }, times.start.durationHours(times.end), (_$3, held, more) => held.add(more)));
    }));
    // First the targets: every slot short of its heads, from the team's own people who can take it, the fewest hours first.
    $.for(open, ($2, short, slot) => {
        $2.if(short.greater(0n).and(() => shifts.has(slot.shift)), ($3) => {
            const shift = $3.const(shifts.get(slot.shift));
            const times = $3.const(timesOf(slot.day, shift));
            const free = $3.const(people
                .filter(($4, staffer) => staffer.person.team.equal(slot.group).and(() => takes(staffer, slot.day, shift, times)))
                .sort(($4, staffer) => hours.get({ person: staffer.key, week: weekOf(slot.day) }, () => 0.0)));
            $3.for(free, ($4, staffer, i) => {
                $4.if(i.less(short), ($5) => { $5(place(staffer, slot.day, slot.shift, slot.group, times)); });
            });
        });
    });
    // Then everyone to their contract, whatever the targets: on each of their days off in the period, their usual shift in
    // their own team, while another fits within their contract that week and keeps ten hours clear of their other duties.
    const each = $.const(East.Array.range(0n, days));
    $.for(people, ($2, staffer) => {
        $2.match(staffer.person.usual, { some: ($3, usual) => {
            $3.if(shifts.has(usual), ($4) => {
                const shift = $4.const(shifts.get(usual));
                $4.for(each, ($5, day) => {
                    const times = $5.const(timesOf(day, shift));
                    $5.if(takes(staffer, day, shift, times), ($6) => { $6(place(staffer, day, usual, staffer.person.team, times)); });
                });
            });
        } });
    });
    // The answer: the new duties, each an insert.
    const held = $.const(new Map(), WarehouseDuties);
    return { duties: East.diff(held, added) };
});

export const rosterOptimise = example({
    inputs: [], description: "The warehouse roster with the Elara eye (#1409, #1622): `optimise` is Func.bind of the warehouse's optimiser on e3 — Roster.Types.OptimiseRequest() in, the period in view (the day in day view, the week in week view, the month in month view) and its kind, the run number and the rail's narrowing and no row; Roster.Types.OptimiseResult(WarehouseDuties) out, a patch of the duties' record. The function reads the period's targets and the duties of the weeks it touches through their interval indexes, the Roster's unsaved edits of both laid over them (drafts: [rosterDuties, rosterCover]), and the staff, the shifts and the teams from the warehouse's own records: every slot of the period short of its heads filled from the people of its team, then everyone to their contract from their usual shift — on any period, an empty one too — within their contract for each week and ten hours clear of their other duties, no duty outside the period it was asked of. A click on the eye runs it once over the period in view; its patch lands in the session as one edit, which one Undo reverts and Save commits with everything else.",
    keywords: ["Roster", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "e3.index", "drafts", "overlapping", "East.diff", "patch", "one edit", "Undo", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Roster.patterns", "people", "week", "fit"],
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
        // The app's optimiser: the eye calls it once per run over the period in view, with the duties' and the targets' unsaved edits as drafts.
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
/** The shifts' record type: the shifts by key. */
export const NightsShifts = DictType(StringType, NightsShift);
/** The shifts, which the Roster writes through the patch door, read by their times through their interval index. */
export const nightsShifts = e3.record("rota_nights_shifts", NightsShifts, {
    initial: nightsShiftRows,
    indexes: (index) => ({
        // The shifts by their times: what the plan reads the week and its edges through.
        rota_nights_shifts_by_time: index.interval({ from: "start", to: "end" }),
    }),
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

/** A person's day of the business week, Monday 0: one the plan already holds. */
const NightsHeld = StructType({ person: StringType, day: IntegerType });

/**
 * The night warehouse's optimiser (#1553): the business week — every shift ending from the week's Monday to the next —
 * planned by when each shift ends, each person on their usual shift Monday to Friday, in their own team. It reads every
 * shift the window holds — the week and the twelve hours either side — through the shifts' interval index, the Roster's
 * unsaved edits laid over them, and the staff and the shift times from the warehouse's own records. A shift among
 * `fixed`, at the week's edges in a published week, stands as it is and holds its person's day. Every other shift ending
 * in the business week — the night before the week among them — is kept at its shift's own times, where it is its
 * person's usual shift on a weekday not held yet, and taken away otherwise; one ending outside it stands as it is: the
 * week's last night is the next week's plan's. Each weekday left is planned under a key of the run's own, a night before
 * the week too. The answer is one patch, the edges' changes among it. Its plan is the business week's: asked of another
 * period — a day, a month — it changes nothing.
 */
export const rotaPlanNights = e3.function("rota_plan_nights", {
    inputs: [e3.index(nightsShifts.indexes.rota_nights_shifts_by_time), nightsShifts, nightsWorkers, nightsShiftTimes],
    // The Roster's unsaved edits of the shifts are laid over them, and over their index
    drafts: [nightsShifts],
    args: [Roster.Types.OptimiseRequest({ edges: true })],
    output: Roster.Types.OptimiseResult(NightsShifts),
}, ($, shiftsByTime, rota, staff, times, request) => {
    // A person's usual shift on a day of the business week: a shift past midnight — the night — starts the day before the
    // day it ends on.
    const planned = $.const(East.function([StringType, NightsWorker, StringType, MinimalShiftTime, IntegerType], NightsShift, ($2, key, person, code, shift, day) => {
        const from = $2.const(shift.starts.hour.multiply(60n).add(shift.starts.minute));
        const length = $2.const(East.Float.roundHalf(shift.hours.multiply(60.0)));
        const before = $2.const(from.add(length).subtract(1n).divide(1440n));
        const start = $2.const(request.from.addDays(day.subtract(before)).addMinutes(from));
        return { who: key, shift: code, team: person.team, start, end: start.addMinutes(length) };
    }));
    // The day of the business week a shift ending then belongs to, Monday 0; -1 for an end outside it.
    const dayOf = $.const(East.function([DateTimeType], IntegerType, ($2, end) => {
        const since = $2.const(request.from.durationMilliseconds(end));
        return East.greater(since, 0n).and(() => East.lessEqual(since, 604_800_000n)).ifElse(() => since.subtract(1n).divide(86_400_000n), () => -1n);
    }));
    // The plan is a week's: asked of a day or a month, it reads no shift and plans none.
    const week = $.const(request.period.hasTag("week"));
    // Every shift the window holds, the week and the twelve hours either side, as drafted.
    const seen = $.let(new Map(), NightsShifts);
    $.if(week, ($2) => {
        shiftsByTime.overlapping({ from: request.from.addHours(-12n), to: request.to.addHours(12n) }).each($2, ($3, _carried, key) => {
            $3(seen.insert(key, rota.get(key)));
        });
    });
    const kept = $.let(new Map(), NightsShifts);
    const held = $.let(new Set<ValueTypeOf<typeof NightsHeld>>(), SetType(NightsHeld));
    // A published week's shifts stand as they are, and hold their person's day.
    $.for(seen, ($2, duty, key) => {
        $2.if(request.fixed.has(key), ($3) => {
            $3(kept.insert(key, duty));
            const day = $3.const(dayOf(duty.end));
            $3.if(East.greaterEqual(day, 0n), ($4) => { $4(held.tryInsert({ person: duty.who, day })); });
        });
    });
    // Every other shift: one ending outside the business week stands as it is; one ending on a weekday is kept where it is
    // its person's usual shift on a day not held yet, at the shift's own times; any other is taken away.
    $.for(seen, ($2, duty, key) => {
        $2.if(request.fixed.has(key).not(), ($3) => {
            const day = $3.const(dayOf(duty.end));
            $3.if(East.less(day, 0n), ($4) => { $4(kept.insert(key, duty)); }).else(($4) => {
                $4.if(East.less(day, 5n).and(() => staff.has(duty.who)), ($5) => {
                    const person = $5.const(staff.get(duty.who));
                    $5.match(person.usual, { some: ($6, usual) => {
                        $6.if(usual.equal(duty.shift).and(() => times.has(usual)).and(() => held.has({ person: duty.who, day }).not()), ($7) => {
                            $7(kept.insert(key, planned(duty.who, person, usual, times.get(usual), day)));
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
    $.for(staff, ($2, person, key) => {
        $2.match(person.usual, { some: ($3, usual) => {
            $3.if(times.has(usual), ($4) => {
                const shift = $4.const(times.get(usual));
                $4.for(weekdays, ($5, day) => {
                    $5.if(week.and(() => held.has({ person: key, day }).not()), ($6) => {
                        $6.assign(added, added.add(1n));
                        $6(kept.insert(East.str`elara-${request.run}-${added}`, planned(key, person, usual, shift, day)));
                    });
                });
            });
        } });
    });
    return { duties: East.diff(seen, kept) };
});

/**
 * An optimiser that takes away every shift at the week's edges, whatever is fixed (#1553): what the Roster refuses where
 * one of them is in a published week, naming it, and records nothing — its tests' own, on no page.
 */
export const rotaClearEdges = e3.function("rota_clear_edges", {
    inputs: [e3.index(nightsShifts.indexes.rota_nights_shifts_by_time), nightsShifts],
    drafts: [nightsShifts],
    args: [Roster.Types.OptimiseRequest({ edges: true })],
    output: Roster.Types.OptimiseResult(NightsShifts),
}, ($, shiftsByTime, rota, request) => {
    // The shifts the window holds that start outside the week: each taken away.
    const edges = $.let(new Map(), NightsShifts);
    shiftsByTime.overlapping({ from: request.from.addHours(-12n), to: request.to.addHours(12n) }).each($, ($2, _carried, key) => {
        const duty = $2.const(rota.get(key));
        $2.if(East.less(duty.start, request.from).or(() => East.greaterEqual(duty.start, request.to)), ($3) => { $3(edges.insert(key, duty)); });
    });
    const cleared = $.const(new Map(), NightsShifts);
    return { duties: East.diff(edges, cleared) };
});

export const rosterOptimiseEdges = example({
    inputs: [], description: "A warehouse whose week runs by when its shifts end (#1553), as its payroll's does: its Roster's week starts on Monday, so the night from Sunday 22:00 is drawn on the Sunday of the week before, though it is the business week's first shift, and the week's own last night ends in the next week. `optimise` is Func.bind of an e3.function from Roster.Types.OptimiseRequest({ edges: true }) to Roster.Types.OptimiseResult(NightsShifts): the request names in `fixed` the shifts at the week's edges of a published week, and the function reads every shift the window holds through the shifts' interval index, the Roster's unsaved edits laid over them (drafts: [nightsShifts]). Its one patch may change the edges: here the night before the week is kept, its times changed to the shift's own, and taken away from a person off nights; the week's last night is left to the next week, and Mia's Monday early is added — one edit, which one Undo reverts and Save writes through the patch door. Publish the week before first and its shifts are fixed: the run leaves them as they are.",
    keywords: ["Roster", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "edges", "fixed", "night shift", "overnight", "week start", "monday", "payroll week", "Func.bind", "e3.function", "e3.index", "drafts", "East.diff", "patch", "Schedule.periods", "published", "one edit", "Undo"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(nightsShifts));
        const weeks = $.let(Record.bind(nightsWeeks));
        const staff = $.let(Data.bind(nightsWorkers));
        const times = $.let(Data.bind(nightsShiftTimes));
        const teams = $.let(Data.bind(minimalTeams));
        // The plan by when shifts end: its function may change the edges, so the eye's run plans the night before the week too.
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
