/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { DateTimeType, DictType, East, SortedMap, StringType, compareFor, example, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Func, Record, Roster, Schedule } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";
import { WarehouseDuty, WarehouseWeek, warehouseDuties, warehousePreviousStart, warehouseWeeks } from "./warehouse.js";
import {
    rosterStaff as warehouseStaff, rosterActivities, rosterActivitiesByGroup, rosterAgencies, rosterCover, rosterCoverPatch, rosterPositions,
    rosterShiftTimes, rosterStaffFit, rosterSuggestions, rosterTeams,
} from "./roster.examples.js";

const stringOrder = compareFor(StringType);
const WEEK = 7 * 86_400_000;

/** A larger staff pool for these indexed examples, preserving the mock's named people. */
function staffSeed() {
    const people = new Map(warehouseStaff.default);
    const originals = [...people.values()];
    for (let i = 0; people.size < 500; i++) {
        const person = originals[i % originals.length]!;
        people.set(`pool-${1000 + i}`, { ...person, name: `${person.name} ${i + 1}` });
    }
    return people;
}

/** How many weeks of history before the warehouse's two: with its two, a year. */
const HISTORY = 50;

/** A year of duties: the warehouse's two weeks, and each of the fifty weeks before them the week before's duties again, in its own week. */
function dutySeed() {
    const duties = new SortedMap<string, ValueTypeOf<typeof WarehouseDuty>>(warehouseDuties, stringOrder);
    const before = [...warehouseDuties].filter(([, duty]) => duty.start.getTime() < warehousePreviousStart.getTime() + WEEK);
    for (let week = 1; week <= HISTORY; week++) {
        for (const [key, duty] of before) {
            duties.set(`h${week}-${key}`, { ...duty, start: new Date(duty.start.getTime() - week * WEEK), end: new Date(duty.end.getTime() - week * WEEK) });
        }
    }
    return duties;
}

/** The rota's weeks over the year: the warehouse's two, and each week of history issued at its end. */
function weekSeed() {
    const weeks = new SortedMap<Date, ValueTypeOf<typeof WarehouseWeek>>(warehouseWeeks, compareFor(DateTimeType));
    const issued = warehouseWeeks.get(warehousePreviousStart)!;
    for (let week = 1; week <= HISTORY; week++) {
        const start = new Date(warehousePreviousStart.getTime() - week * WEEK);
        weeks.set(start, { ...issued, state: variant("issued", { at: new Date(start.getTime() + WEEK - 12 * 3_600_000) }) });
    }
    return weeks;
}

export const indexedRosterDuties = e3.record("indexed_roster_duties", DictType(StringType, WarehouseDuty), dutySeed());
export const indexedRosterDutiesPatch = e3.mutation.patch(indexedRosterDuties);
/** The year's duties by their times: what the Roster's slice reads a week of them through. */
export const indexedRosterDutiesByTime = e3.recordIndex("indexed_roster_duties_by_time", indexedRosterDuties, { interval: { from: "start", to: "end" } });
export const indexedRosterWeeks = e3.record("indexed_roster_weeks", DictType(DateTimeType, WarehouseWeek), weekSeed());
export const indexedRosterWeeksPatch = e3.mutation.patch(indexedRosterWeeks);
export const indexedRosterStaff = e3.record("indexed_roster_staff", warehouseStaff.type, staffSeed());

export const rosterStaffByName = e3.recordIndex("staff_by_name", indexedRosterStaff, { on: ["name"] });
export const rosterStaffByTeam = e3.recordIndex("staff_by_team_name", indexedRosterStaff, { on: ["team", "name"] });
export const rosterStaffByTrainer = e3.recordIndex("staff_by_trainer", indexedRosterStaff, { on: ["trainer"] });
export const rosterStaffBySkill = e3.recordIndex("staff_by_skill", indexedRosterStaff, { on: ["skills"] });
export const rosterStaffByPosition = e3.recordIndex("staff_by_position", indexedRosterStaff, { on: ["position"] });
export const rosterStaffByAgency = e3.recordIndex("staff_by_agency", indexedRosterStaff, { on: ["agency"] });

export const rosterRecordIndexes = example({
    description: "500 staff and a year of duties. The week's duties are read through the slice's duty source — an interval index over their times — and the rota's weeks by key, so no record is read whole; indexed staff narrowing keeps full-staff coverage and rules, and a Find fix asks the warehouse's greedy fit over every person, whatever the rail shows. Hidden duty edits Save by their own keys.",
    keywords: ["Roster", "Schedule.events", "Schedule.periods", "Slice", "Slice.bindRecords", "Roster.activities", "Func.bind", "fit", "Find", "records", "indexes", "interval", "paging", "history"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(indexedRosterDuties, [indexedRosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(indexedRosterDuties));
        const byTime = $.let(Data.bindPaged(indexedRosterDuties, { indexes: [indexedRosterDutiesByTime] }));
        const weeks = $.let(Record.bind(indexedRosterWeeks, [indexedRosterWeeksPatch]));
        const weekEntries = $.let(Data.bindPaged(indexedRosterWeeks));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Complete staff is the calculation context; visibility is a separate indexed query.
        const staff = $.let(Data.bind(indexedRosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        // One rail over the week's duties, the staff, opening on Inbound, and the activities (#1342).
        const people = $.let(Data.bindPaged(indexedRosterStaff, { indexes: [rosterStaffByName, rosterStaffByTeam, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterRecordIndexes", {
            duty: { source: byTime, range: "start" },
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"], initial: { team: ["inbound"] },
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, name: { label: "Name" }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skills" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "trainers", name: "Trainers", where: { people: { trainer: [true] } } }] }));
        const firms = $.let(Data.bind(rosterAgencies));
        const times = $.let(Data.bind(rosterShiftTimes));
        const teams = $.let(Data.bind(rosterTeams));
        const roles = $.let(Data.bind(rosterPositions));
        const ideas = $.let(Data.bind(rosterSuggestions));
        // The app's fit: a Find fix asks it who fits, over all 500 people, and the People tab shows its answer among what the rail shows.
        const fit = $.let(Func.bind(rosterStaffFit));
        return <Box width="100%" height="760px"><Roster id="rosterRecordIndexes" week={{ start: "sunday" }} slice={{ slice }} fit={fit} inspector
            view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
            }) }}
            resources={{
                people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
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
            library={[Roster.library.people(), Roster.library.activities()]} />
        </Box>;
    }}</Reactive>),
});

export const rosterRecordIndexesMobile = example({
    description: "Phone roster over the same year of duties, with the shared indexed staff controls and explicit actions; weekly drafts survive filtering.",
    keywords: ["Roster", "Schedule.events", "Schedule.periods", "Slice", "Slice.bindRecords", "Roster.activities", "records", "indexes", "interval", "paging", "mobile"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const rota = $.let(Record.bind(indexedRosterDuties, [indexedRosterDutiesPatch]));
        const entries = $.let(Data.bindPaged(indexedRosterDuties));
        const byTime = $.let(Data.bindPaged(indexedRosterDuties, { indexes: [indexedRosterDutiesByTime] }));
        const weeks = $.let(Record.bind(indexedRosterWeeks, [indexedRosterWeeksPatch]));
        const weekEntries = $.let(Data.bindPaged(indexedRosterWeeks));
        const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
        // Complete staff is the calculation context; visibility is a separate indexed query.
        const staff = $.let(Data.bind(indexedRosterStaff));
        const acts = $.let(Data.bind(rosterActivities));
        // One rail over the week's duties, the staff, opening on Inbound, and the activities (#1342).
        const people = $.let(Data.bindPaged(indexedRosterStaff, { indexes: [rosterStaffByName, rosterStaffByTeam, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterRecordIndexesMobile", {
            duty: { source: byTime, range: "start" },
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"], initial: { team: ["inbound"] },
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, name: { label: "Name" }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skills" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "trainers", name: "Trainers", where: { people: { trainer: [true] } } }] }));
        const firms = $.let(Data.bind(rosterAgencies));
        const times = $.let(Data.bind(rosterShiftTimes));
        const teams = $.let(Data.bind(rosterTeams));
        const roles = $.let(Data.bind(rosterPositions));
        const ideas = $.let(Data.bind(rosterSuggestions));
        return <Box width="100%" maxWidth="390px" height="760px"><Roster id="rosterRecordIndexesMobile" week={{ start: "sunday" }} slice={{ slice }} inspector
            view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            events={{ duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", entries,
                start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
                hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
            }) }}
            resources={{
                people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
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
            library={[Roster.library.people(), Roster.library.activities()]} />
        </Box>;
    }}</Reactive>),
});

