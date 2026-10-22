/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, PatchType, StringType, StructType,
    example, none, some, variant,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Field, Reactive, Slice, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui";
import {
    WarehouseActivity, WarehouseAgency, WarehouseCover, WarehouseDuty, WarehousePerson, WarehousePosition, WarehouseShift, WarehouseSuggestion,
    WarehouseTeam, WarehouseWeek, warehouseActivities, warehouseAgencies, warehouseCover, warehouseDuties, warehousePayRates, warehousePeople,
    warehousePositions, warehouseShifts, warehouseSuggestions, warehouseTeams, warehouseWeeks,
} from "./warehouse.js";

// The warehouse's row types, and its seeded weeks as the Roster reads them, for the renderer's specs on e3 (#1368).
export {
    WarehouseCover, WarehouseDuty, WarehouseRosterWeek, warehouseNextStart, warehousePrevious, warehousePreviousStart, warehouseStart, warehouseWeek,
} from "./warehouse.js";

// The warehouse's own records (`Builder Interfaces Spec.md` §5.7): its duties, the weeks of its rota and its cover
// targets, which the Roster writes, each through its patch door; and what it reads — its suggestions, its pay rates,
// its staff and agencies, and its shift times, teams, positions and activities.

/** The duties, both weeks', each the warehouse's own row. */
export const rosterDuties = e3.record("roster_duties", DictType(StringType, WarehouseDuty), warehouseDuties);
export const rosterDutiesPatch = e3.mutation.patch(rosterDuties);
/** The duties by their times: what the Roster's slice reads a week of them through, its navigation writing the range. */
export const rosterDutiesByTime = e3.recordIndex("roster_duties_by_time", rosterDuties, { interval: { from: "start", to: "end" } });
/** The weeks of the rota: the one before issued, this one open. */
export const rosterWeeks = e3.record("roster_rota_weeks", DictType(DateTimeType, WarehouseWeek), warehouseWeeks);
export const rosterWeeksPatch = e3.mutation.patch(rosterWeeks);
/** The cover targets, a row per slot: the week before's, this week's and the forecast's for the week after. */
export const rosterCover = e3.record("roster_cover", DictType(StringType, WarehouseCover), warehouseCover);
export const rosterCoverPatch = e3.mutation.patch(rosterCover);
/** The suggestions: someone for a slot, and why. */
export const rosterSuggestions = e3.record("roster_suggestions", DictType(StringType, WarehouseSuggestion), warehouseSuggestions);
/** The pay rates, an hour, by the warehouse's own pay codes. */
export const rosterPayRates = e3.record("roster_pay_rates", DictType(StringType, FloatType), warehousePayRates);
export const rosterStaff = e3.record("roster_staff", DictType(StringType, WarehousePerson), warehousePeople);
export const rosterAgencies = e3.record("roster_agencies", DictType(StringType, WarehouseAgency), warehouseAgencies);
export const rosterShiftTimes = e3.record("roster_shift_times", DictType(StringType, WarehouseShift), warehouseShifts);
export const rosterTeams = e3.record("roster_teams", DictType(StringType, WarehouseTeam), warehouseTeams);
export const rosterPositions = e3.record("roster_positions", DictType(StringType, WarehousePosition), warehousePositions);
/** Every activity by its key: each group's skills, and the duty of none (#1342). */
export const rosterActivities = e3.record("roster_activities", DictType(StringType, WarehouseActivity), warehouseActivities);

// The rail's fields, each on an index of its own: the staff by group then name, position, trainer, agency, skill and name, the activities by group.
export const rosterStaffByTeamName = e3.recordIndex("roster_staff_by_team_name", rosterStaff, { on: ["team", "name"] });
export const rosterStaffByPosition = e3.recordIndex("roster_staff_by_position", rosterStaff, { on: ["position"] });
export const rosterStaffByTrainer = e3.recordIndex("roster_staff_by_trainer", rosterStaff, { on: ["trainer"] });
export const rosterStaffByAgency = e3.recordIndex("roster_staff_by_agency", rosterStaff, { on: ["agency"] });
export const rosterStaffBySkill = e3.recordIndex("roster_staff_by_skill", rosterStaff, { on: ["skills"] });
export const rosterStaffByName = e3.recordIndex("roster_staff_by_name", rosterStaff, { on: ["name"] });
export const rosterActivitiesByGroup = e3.recordIndex("roster_activities_by_group", rosterActivities, { on: ["group"] });

/** The warehouse's fit's body: the ready-made rule, then a greedy order — the people off that day with the most spare contract hours first, whatever their group. */
export const rosterStaffFitBody = East.function([Roster.Types.FitRequest(WarehouseDuty)], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer(WarehouseDuty));
    const rule = $.const(Roster.fit(WarehouseDuty));
    const weekHours = $.const(Roster.weekHours(WarehouseDuty));
    // Every person's hours this week, once: what is left of each one's contract ranks them.
    const hours = $.const(weekHours(req.week, req.context));
    return answer(req, East.function([Roster.Types.FitRequest(WarehouseDuty), Roster.Types.Person], Roster.Types.Fit, ($2, request, person) => {
        const verdict = $2.const(rule(request, person));
        $2.match(verdict, { refused: ($3) => { $3.return(verdict); } });
        const fits = $2.const(verdict.unwrap("fits"));
        return variant("fits", { score: person.contract.subtract(hours.get(person.key, () => 0.0)), why: fits.why, warn: fits.warn });
    }));
});
// The warehouse's fit, on e3: who fits a Find fix's need on its slot.
export const rosterStaffFit = e3.function("roster_staff_fit", rosterStaffFitBody);

// What the renderer's tests on e3 write and ask beside the examples (#1376): another session's edits of the
// reference data, a roster the warehouse has locked, and another app's fit over the same staff.

/** The staff's patch door: another session's edit of the staff. */
export const rosterStaffPatch = e3.mutation.patch(rosterStaff);
/** The shift times' patch door: another session's edit of them. */
export const rosterShiftTimesPatch = e3.mutation.patch(rosterShiftTimes);
/** The teams' patch door: another session's edit of them. */
export const rosterTeamsPatch = e3.mutation.patch(rosterTeams);
/** The positions' patch door: another session's edit of them. */
export const rosterPositionsPatch = e3.mutation.patch(rosterPositions);
/** The suggestions' patch door: another session's edit of them. */
export const rosterSuggestionsPatch = e3.mutation.patch(rosterSuggestions);

/** The duties of a roster the warehouse has locked: the warehouse's own duties, which no Save changes. */
export const rosterLockedDuties = e3.record("roster_locked_duties", DictType(StringType, WarehouseDuty), warehouseDuties);
/** The locked duties by their times: what a roster over them reads a week of them through. */
export const rosterLockedDutiesByTime = e3.recordIndex("roster_locked_duties_by_time", rosterLockedDuties, { interval: { from: "start", to: "end" } });
/** The locked roster's door, a checked one: it refuses every change, naming why — what a Save over it is answered. */
export const rosterLockedDutiesPatch = e3.mutation.reduce("patch", rosterLockedDuties,
    East.function([DictType(StringType, WarehouseDuty), PatchType(DictType(StringType, WarehouseDuty))], DictType(StringType, WarehouseDuty), ($, duties, _patch) => {
        $.error("the roster is locked for the week");
        return duties;
    }));

/**
 * Another app's fit over the same staff: the warehouse's order — the most spare contract hours first, whatever
 * their group — and a warning on whoever the slot's shift would take past their contract.
 */
export const rosterContractFitBody = East.function([Roster.Types.FitRequest(WarehouseDuty)], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer(WarehouseDuty));
    const rule = $.const(Roster.fit(WarehouseDuty));
    const weekHours = $.const(Roster.weekHours(WarehouseDuty));
    const hours = $.const(weekHours(req.week, req.context));
    // What the slot's shift adds to a person's week.
    const shifts = $.const(req.context.shifts.toDict((_$2, shift) => shift.key, (_$2, shift) => shift.hours));
    const shift = $.const(shifts.get(req.slot.shift, () => 0.0));
    return answer(req, East.function([Roster.Types.FitRequest(WarehouseDuty), Roster.Types.Person], Roster.Types.Fit, ($2, request, person) => {
        const verdict = $2.const(rule(request, person));
        $2.match(verdict, { refused: ($3) => { $3.return(verdict); } });
        const fits = $2.const(verdict.unwrap("fits"));
        const spare = $2.const(person.contract.subtract(hours.get(person.key, () => 0.0)));
        const warn = $2.const(East.less(spare, shift).ifElse(() => some("past contract"), () => none), OptionType(StringType));
        return variant("fits", { score: spare, why: fits.why, warn });
    }));
});
// Another app's fit, on e3.
export const rosterContractFit = e3.function("roster_contract_fit", rosterContractFitBody);

export const rosterWarehouse = example({
    inputs: [], description: "The mock warehouse roster over its own records: its duties, the weeks of its rota, its cover targets and suggestions, 69 staff and an agency, its shift times, teams, positions and activities. One Slice.bindRecords rail over the week's duties, the staff and the activities; the warehouse's pay in its own codes and its check over the pay; Publish; a Positions tab; the inspector; and the warehouse's greedy fit on e3, which a Find fix asks who fits.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Roster.shifts", "Roster.groups", "Roster.positions", "Roster.activities", "Roster.proposals", "pay", "check", "Slice", "Slice.bindRecords", "Data.bindPaged", "Func.bind", "e3.function", "fit", "Find", "BuilderFrame", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // What the Roster writes: the duties, the weeks of the rota and the cover targets, each through its patch door.
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterWarehouse", {
            // The week's duties: the Roster's navigation writes the range; no chip picks the week.
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
        const rateRows = $.let(Data.bind(rosterPayRates));
        const rates = $.const(rateRows.read());
        // The app's fit: a Find fix asks it who fits, over every person, and the People tab shows its answer.
        const fit = $.let(Func.bind(rosterStaffFit));
        // The warehouse's pay (§5.6), in its own codes. One person's duties for the week in, or one agency's requests;
        // each duty's cost by code out: ordinary time up to the person's contracted hours in the week, OT1 past them,
        // and an agency's hours — its named worker's, or its request's — at its own rate.
        const pay = $.const(East.function([Roster.Types.PayRequest(WarehouseDuty)], Roster.Types.Pay, ($2, req) => {
            const out = $2.let(new Map(), Roster.Types.Pay);
            const zero = $2.const(0.0, FloatType);
            const agency = $2.let(true, BooleanType);
            const contract = $2.let(0.0, FloatType);
            $2.match(req.who, { person: ($3, key) => {
                $3.if(req.context.people.has(key), ($4) => {
                    const person = $4.const(req.context.people.get(key));
                    $4.assign(agency, person.agency);
                    $4.assign(contract, person.contract);
                });
            } });
            const worked = $2.let(0.0, FloatType);
            // The week's duties in time order, so the contract's hours run out where they do.
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
        // The warehouse's check sees the pay too (§5.8): overtime on a duty nobody has agreed.
        const check = $.const(East.function([Roster.Types.CheckContext(WarehouseDuty)], ArrayType(Roster.Types.Issue), ($2, cx) => {
            const issues = $2.let([], ArrayType(Roster.Types.Issue));
            $2.for(cx.week.assignments, ($3, a, id) => {
                const costs = $3.const(cx.pay.get(id, () => East.value(new Map(), DictType(StringType, FloatType))));
                $3.if(costs.has("OT1").and(() => East.notEqual(a.row.agreed, some(true))), ($4) => {
                    $4(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null),
                        title: "Overtime not agreed", detail: East.str`${a.row.team} · ${a.row.shift}`,
                        slot: some(a.slot), assignment: some(id), flag: some("OT"), fix: none }));
                });
            });
            return issues;
        }));
        return <Box width="100%" height="760px"><Roster id="rosterWarehouse" week={{ start: "sunday" }} slice={{ slice }} fit={fit}
            pay={pay} currency="AUD" check={check} inspector view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                // The hours a duty counts: its length less its unpaid break.
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
                fields: { unpaidBreak: Schedule.field.number({ label: "Unpaid break", unit: "min", step: 15.0, min: 0.0 }),
                    costCentre: Schedule.field.text({ label: "Cost centre" }), note: Schedule.field.text({ label: "Note" }) },
                // The app's check on a draft: Save waits until every duty has a cost centre.
                ready: d => East.equal(d.costCentre, "").ifElse(
                    () => variant("invalid", [{ field: "costCentre", message: "Give the duty a cost centre" }]),
                    () => variant("ready", null)),
            }) }}
            resources={{
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                    position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                    trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            }}
            periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" })}
            targets={Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" })}
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});

export const rosterMobile = example({
    inputs: [], description: "The warehouse roster in a phone-width container: explicit Assign, Move, Edit, Remove, Restore, Request, Accept, Reject and target actions over the warehouse's own records. The same session survives resizing; mobile cards register no drag sources or targets.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterMobile", {
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
        return <Box width="100%" maxWidth="390px" height="760px"><Roster id="rosterMobile" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
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
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});

export const rosterPeople = example({
    inputs: [], description: "Weekly people layout over the same records: each person keeps their original key, contract hours and daily duties, with a separate agency-requests row.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "people", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterPeople", {
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
        return <Box width="100%" height="760px"><Roster id="rosterPeople" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "people", period: "week", date: new Date("2028-03-09T00:00:00Z") }}
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
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});

export const rosterWeek = example({
    inputs: [], description: "Seven days of group-by-shift coverage over the warehouse's own records, opening any day for detailed staffing.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "week", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterWeek", {
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
        return <Box width="100%" height="760px"><Roster id="rosterWeek" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "shifts", period: "week", date: new Date("2028-03-09T00:00:00Z") }}
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
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});

export const rosterWindowed = example({
    inputs: [], description: "The duties read a week at a time through the slice's duty source — an interval index over their times, its range the Roster's own navigation — and the rota's weeks by key: only the week, the week before it (Copy's source) and the open picker's month are requested, never a record whole.",
    keywords: ["Roster", "Schedule.events", "Schedule.periods", "Slice.bindRecords", "Data.bindPaged", "recordIndex", "interval", "history", "BuilderFrame", "Save", "Publish"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        // The weeks of the rota read by key: the week, the week before it and the open picker's month.
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const weekEntries = $.let(Data.bindPaged(rosterWeeks));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        // One source: the week's duties, its range the Roster's navigation.
        const slice = $.let(Slice.bindRecords("ex.rosterWindowed", { duty: { source: byTime, range: "start" } }));
        const firms = $.let(Data.bind(rosterAgencies));
        const times = $.let(Data.bind(rosterShiftTimes));
        const teams = $.let(Data.bind(rosterTeams));
        const roles = $.let(Data.bind(rosterPositions));
        const ideas = $.let(Data.bind(rosterSuggestions));
        return <Box width="100%" height="760px"><Roster id="rosterWindowed" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "shifts", period: "day", date: new Date("2028-03-12T00:00:00Z") }}
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
            periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed", entries: weekEntries })}
            targets={Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" })}
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});

// The smallest roster (§5.7): duties with their times, shift and team; staff; shift times; teams.

/** A duty of the smallest roster: who, as a staff key; when, as worked; its shift and its team. */
export const MinimalDuty = StructType({ person: StringType, start: DateTimeType, end: DateTimeType, shift: StringType, team: StringType });
/** One of its staff: a name and a team. */
export const MinimalWorker = StructType({ name: StringType, team: StringType });
/** One of its shifts: a name, a code, when it starts, its hours and where it shows. */
export const MinimalShiftTime = StructType({ name: StringType, code: StringType, starts: Schedule.Types.Clock, hours: FloatType, order: IntegerType });
/** One of its teams: a name. */
export const MinimalTeam = StructType({ name: StringType });
export const minimalDuties = e3.record("rota_minimal_duties", DictType(StringType, MinimalDuty), new Map([
    ["d-1", { person: "w-01", start: new Date("2028-03-06T06:00:00Z"), end: new Date("2028-03-06T14:00:00Z"), shift: "early", team: "inbound" }],
    ["d-2", { person: "w-02", start: new Date("2028-03-06T14:00:00Z"), end: new Date("2028-03-06T22:00:00Z"), shift: "late", team: "dispatch" }],
    ["d-3", { person: "w-01", start: new Date("2028-03-07T05:30:00Z"), end: new Date("2028-03-07T14:00:00Z"), shift: "early", team: "inbound" }],
]));
export const minimalDutiesPatch = e3.mutation.patch(minimalDuties);
export const minimalWorkers = e3.record("rota_minimal_workers", DictType(StringType, MinimalWorker), new Map([
    ["w-01", { name: "Ada Brook", team: "inbound" }],
    ["w-02", { name: "Tom Vale", team: "dispatch" }],
]));
export const minimalShiftTimes = e3.record("rota_minimal_shift_times", DictType(StringType, MinimalShiftTime), new Map([
    ["early", { name: "Early", code: "E", starts: { hour: 6n, minute: 0n }, hours: 8.0, order: 1n }],
    ["late", { name: "Late", code: "L", starts: { hour: 14n, minute: 0n }, hours: 8.0, order: 2n }],
]));
export const minimalTeams = e3.record("rota_minimal_teams", DictType(StringType, MinimalTeam), new Map([
    ["inbound", { name: "Inbound" }], ["dispatch", { name: "Dispatch" }],
]));

export const rosterMinimal = example({
    inputs: [], description: "The smallest roster over the app's own records: duties with their times, shift and team; staff; shift times; teams. No library or inspector pane, and no Publish; explicit assignment actions still use the shared session.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Roster.shifts", "Roster.groups", "Record.bind", "minimal"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(minimalDuties, [minimalDutiesPatch]));
        const staff = $.let(Data.bind(minimalWorkers));
        const times = $.let(Data.bind(minimalShiftTimes));
        const groups = $.let(Data.bind(minimalTeams));
        return <Box width="100%" height="760px"><Roster id="rosterMinimal" view={{ date: new Date("2028-03-06T00:00:00Z") }}
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock",
                start: "start", end: "end", resource: { field: "person", of: "people" },
                shift: "shift", group: "team",
            }) }}
            resources={{ people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: w => w.name, group: w => w.team }) }}
            shifts={Roster.shifts(times.read(), { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(groups.read(), { label: t => t.name })} />
        </Box>;
    }}</Reactive>),
});

export const rosterPublished = example({
    inputs: [], description: "The week before, published, is read-only: navigation, staff filtering, coverage and inspection remain available.",
    keywords: ["Roster", "Schedule.events", "Schedule.resources", "Schedule.periods", "Roster.targets", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "published", "read-only", "Publish"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterPublished", {
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
        return <Box width="100%" height="760px"><Roster id="rosterPublished" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "shifts", period: "day", date: new Date("2028-03-02T00:00:00Z") }}
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
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});

export const rosterCustomInspector = example({
    inputs: [], description: "The duty kind's own inspector and the targets' own form replace the built-in fields while preserving the shared headers, coverage, actions and undo history.",
    keywords: ["Roster", "Schedule.events", "inspector", "Roster.targets", "Schedule.resources", "Schedule.periods", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(rosterDuties));
        const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const people = $.let(Data.bind(rosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterCustomInspector", {
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
        // The duty's own form: its unpaid break and its note, each change the duty written back whole.
        const dutyForm = $.const(East.function([WarehouseDuty, FunctionType([WarehouseDuty], NullType)], UIComponentType, (_$2, row, update) =>
            <VStack>
                <Field.FloatInput label="Custom unpaid break" value={row.unpaidBreak} min={0} max={120} step={15} onChange={(_$3, value) => update({
                    who: row.who, start: row.start, end: row.end, shift: row.shift, team: row.team, role: row.role, task: row.task,
                    unpaidBreak: value, agreed: row.agreed, costCentre: row.costCentre, note: row.note })} />
                <Field.StringInput label="Custom note" value={row.note} onChange={(_$3, value) => update({
                    who: row.who, start: row.start, end: row.end, shift: row.shift, team: row.team, role: row.role, task: row.task,
                    unpaidBreak: row.unpaidBreak, agreed: row.agreed, costCentre: row.costCentre, note: value })} />
            </VStack>));
        // The target's own form: the heads it needs.
        const coverForm = $.const(East.function([WarehouseCover, FunctionType([WarehouseCover], NullType)], UIComponentType, (_$2, row, update) =>
            <Field.IntegerInput label="Custom heads" value={row.heads} min={0n} step={1n} onChange={(_$3, value) => update({
                day: row.day, team: row.team, shift: row.shift, heads: value, hours: row.hours, basis: "planner" })} />));
        return <Box width="100%" height="760px"><Roster id="rosterCustomInspector" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
                inspector: dutyForm,
            }) }}
            resources={{
                people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
                    position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
                    trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            }}
            periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" })}
            targets={Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", inspector: coverForm })}
            shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
            groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
            positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
            activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
            proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
            rules={{ rest: 10.0 }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
                drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),
            })]} />
        </Box>;
    }}</Reactive>),
});
