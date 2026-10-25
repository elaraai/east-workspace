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
 * lands in the session as one edit.
 */
import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, SetType, StringType, StructType, example, none, variant, type BlockBuilder, type ExprType } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui";
import { WarehouseDuty } from "./warehouse.js";
import {
    rosterActivities, rosterActivitiesByGroup, rosterAgencies, rosterCover, rosterCoverPatch, rosterDuties, rosterDutiesByTime, rosterDutiesPatch,
    rosterPatterns, rosterPositions, rosterShiftTimes, rosterStaff, rosterStaffByAgency, rosterStaffByName, rosterStaffByPosition, rosterStaffBySkill,
    rosterStaffByTeamName, rosterStaffByTrainer, rosterStaffFit, rosterSuggestions, rosterTeams, rosterWeeks, rosterWeeksPatch,
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
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope — and the optimiser's: the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
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
