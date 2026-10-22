/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schedule's records: what `Schedule.events`, `Schedule.resources` and
 * `Schedule.periods` are built over in Schedule's specs, which e3-ui-components
 * reads on e3 itself (#1379). Schedule draws nothing of its own — its kinds
 * are the Calendar's, the Plan's, the Roster's and the Allocation's, whose
 * examples show them — so this module declares records and no examples: a
 * `.examples.ts` module, of which the showcase builds no page.
 *
 * - Calendar Spec §3.1's: shifts on people, maintenance jobs on machines with
 *   a backlog, inspections on a site or a machine, tasks whose estimates run in
 *   every unit, and visits with a field named with a dot.
 * - Plan Builder Spec §3.1's print works: jobs as bars, stops as marks,
 *   deliveries as tiles in their lanes and crew shifts as chips.
 * - Builder Interfaces Spec §4's: a warehouse's duties and weeks, the
 *   Roster's, and a kiln yard's bins and days, the Allocation's.
 *
 * Each is bound as an app binds it, through its patch door.
 */

import { ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType, VariantType, compareFor, none, some, variant } from "@elaraai/east";
import { EventStateType, TimeStepType } from "@elaraai/east-ui";
import { Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ── Calendar Spec §3.1: a metal fabrication shop ────────────────────────────

/** A shift's or a job's status. */
export const ScheduleStatus = VariantType({ tentative: NullType, confirmed: NullType, in_progress: NullType, done: NullType });
/** A shift's handover checklist. */
export const ScheduleChecklist = ArrayType(StructType({ item: StringType, done: BooleanType }));
/** A shift: plain times, a person or none, its crew, the skills it needs and its handover. */
export const ScheduleShift = StructType({
    title: StringType, start: DateTimeType, end: DateTimeType, person: OptionType(StringType), status: ScheduleStatus,
    crew: IntegerType, skills: SetType(StringType), handover: ScheduleChecklist,
});
/** A maintenance job: Option times, so it can wait in the backlog, and its work order. */
export const ScheduleJob = StructType({
    title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), machine: OptionType(StringType),
    status: ScheduleStatus, work_order: StringType, estimate_h: FloatType, due: OptionType(DateTimeType),
});
/** An inspection: on a site or a machine, by the variant's case, its contact a nested struct an edit reaches into. */
export const ScheduleInspection = StructType({
    title: StringType, start: DateTimeType, end: DateTimeType, target: OptionType(VariantType({ site: StringType, machine: StringType })),
    status: ScheduleStatus, contact: StructType({ name: StringType, phone: StringType }),
});
/** A task: on no resource, its estimate a duration in any unit. */
export const ScheduleTask = StructType({ title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), estimate: Schedule.Types.Duration });
/** A visit: a field named with a dot beside a struct of that name, so a path names a field by its steps. */
export const ScheduleVisit = StructType({
    title: StringType, start: DateTimeType, end: DateTimeType, "contact.phone": StringType, contact: StructType({ phone: StringType }),
});

/** The shifts about Thursday 1 October 2026: a day shift, a night running on past midnight, and one a week later. */
export const scheduleShifts = e3.record("schedule_shifts", DictType(StringType, ScheduleShift), new Map([
    ["s1", { title: "Day shift", start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-10-01T14:00:00Z"), person: some("p1"),
        status: variant("confirmed", null), crew: 1n, skills: new Set<string>(), handover: [] }],
    ["s2", { title: "Night shift", start: new Date("2026-10-01T22:00:00Z"), end: new Date("2026-10-02T06:00:00Z"), person: none,
        status: variant("tentative", null), crew: 2n, skills: new Set<string>(), handover: [] }],
    ["s3", { title: "Day shift", start: new Date("2026-10-08T06:00:00Z"), end: new Date("2026-10-08T14:00:00Z"), person: some("p2"),
        status: variant("done", null), crew: 1n, skills: new Set<string>(), handover: [] }],
]));
export const scheduleShiftsPatch = e3.mutation.patch(scheduleShifts);
/** The jobs: one scheduled, and two in the backlog, one of them due. */
export const scheduleJobs = e3.record("schedule_jobs", DictType(StringType, ScheduleJob), new Map([
    ["j1", { title: "Bearing swap", start: some(new Date("2026-10-01T09:00:00Z")), end: some(new Date("2026-10-01T11:00:00Z")), machine: some("m1"),
        status: variant("confirmed", null), work_order: "WO-1041", estimate_h: 2, due: none }],
    ["j2", { title: "Belt check", start: none, end: none, machine: none,
        status: variant("tentative", null), work_order: "", estimate_h: 2.5, due: some(new Date("2026-10-02T00:00:00Z")) }],
    ["j3", { title: "Filter change", start: none, end: none, machine: none,
        status: variant("tentative", null), work_order: "WO-1050", estimate_h: 1, due: none }],
]));
export const scheduleJobsPatch = e3.mutation.patch(scheduleJobs);
/** The inspections: a safety walk of the north site. */
export const scheduleInspections = e3.record("schedule_inspections", DictType(StringType, ScheduleInspection), new Map([
    ["i1", { title: "Safety walk", start: new Date("2026-10-01T11:00:00Z"), end: new Date("2026-10-01T12:00:00Z"),
        target: some(variant("site", "north")), status: variant("tentative", null), contact: { name: "Cal Moss", phone: "0400 000 001" } }],
]));
export const scheduleInspectionsPatch = e3.mutation.patch(scheduleInspections);
/** The tasks, each estimated in a unit of its own. */
export const scheduleTasks = e3.record("schedule_tasks", DictType(StringType, ScheduleTask), new Map([
    ["t1", { title: "Deburr", start: none, end: none, estimate: variant("minutes", 90) }],
    ["t2", { title: "Paint", start: none, end: none, estimate: variant("hours", 1.5) }],
    ["t3", { title: "Cure", start: none, end: none, estimate: variant("days", 2) }],
    ["t4", { title: "Audit", start: none, end: none, estimate: variant("weeks", 1) }],
    ["t5", { title: "Overhaul", start: none, end: none, estimate: variant("months", 1) }],
]));
export const scheduleTasksPatch = e3.mutation.patch(scheduleTasks);
/** The visits: one, its dotted field and its contact's phone told apart. */
export const scheduleVisits = e3.record("schedule_visits", DictType(StringType, ScheduleVisit), new Map([
    ["v1", { title: "Site visit", start: new Date("2026-10-01T10:00:00Z"), end: new Date("2026-10-01T11:00:00Z"),
        "contact.phone": "0400 000 003", contact: { phone: "0400 000 004" } }],
]));
export const scheduleVisitsPatch = e3.mutation.patch(scheduleVisits);

// ── Plan Builder Spec §3.1: a print works ───────────────────────────────────

/** A print job: Option times and press, so it can wait in the backlog; the lifecycle it wears; its sheets. */
export const SchedulePrintJob = StructType({
    title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), press: OptionType(StringType),
    state: EventStateType, sheets: FloatType, customer: StringType,
    stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }), due: OptionType(DateTimeType),
});
/** A stop: one instant at a press. */
export const SchedulePrintStop = StructType({ title: StringType, at: DateTimeType, press: StringType, kind: VariantType({ plate_change: NullType, service: NullType }) });
/** A crew's shift, and the lifecycle it wears. */
export const SchedulePrintShift = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, crew: StringType, state: EventStateType });
/** A delivery: one instant at a press, in the morning's lane or the afternoon's. */
export const SchedulePrintDelivery = StructType({ title: StringType, at: DateTimeType, press: StringType, slot: StringType });

/** The jobs about Monday 5 October 2026: a brochure run on press A, and a catalogue run waiting, due on the 9th. */
export const schedulePrintJobs = e3.record("schedule_print_jobs", DictType(StringType, SchedulePrintJob), new Map([
    ["j1", { title: "Brochure run", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T12:00:00Z")), press: some("pa"),
        state: variant("proposed", variant("added", null)), sheets: 40000, customer: "Harbour Lane Books", stock: variant("coated", null), due: none }],
    ["j2", { title: "Catalogue run", start: none, end: none, press: none,
        state: variant("estimated", null), sheets: 24000, customer: "Fernhill Garden Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
]));
export const schedulePrintJobsPatch = e3.mutation.patch(schedulePrintJobs);
/** The stops: a plate change on press A as the brochure run ends. */
export const schedulePrintStops = e3.record("schedule_print_stops", DictType(StringType, SchedulePrintStop), new Map([
    ["s1", { title: "Plate change", at: new Date("2026-10-05T12:00:00Z"), press: "pa", kind: variant("plate_change", null) }],
]));
export const schedulePrintStopsPatch = e3.mutation.patch(schedulePrintStops);
/** The crews' shifts: crew 1's early shift. */
export const schedulePrintShifts = e3.record("schedule_print_shifts", DictType(StringType, SchedulePrintShift), new Map([
    ["h1", { title: "Early", start: new Date("2026-10-05T06:00:00Z"), end: new Date("2026-10-05T14:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
]));
export const schedulePrintShiftsPatch = e3.mutation.patch(schedulePrintShifts);
/** The deliveries: a van to the depot from press B, in the morning's lane. */
export const schedulePrintDeliveries = e3.record("schedule_print_deliveries", DictType(StringType, SchedulePrintDelivery), new Map([
    ["d1", { title: "Van to depot", at: new Date("2026-10-05T09:00:00Z"), press: "pb", slot: "AM" }],
]));
export const schedulePrintDeliveriesPatch = e3.mutation.patch(schedulePrintDeliveries);

// ── Builder Interfaces Spec §4: a warehouse's duties, a kiln yard's bins ────

/** A duty: the Roster's roles beside fields of the app's own. */
export const ScheduleDuty = StructType({
    who: VariantType({ staff: StringType, agency: StringType }),
    start: DateTimeType, end: DateTimeType,
    shift: StringType, team: StringType, role: StringType, task: OptionType(StringType),
    unpaidBreak: FloatType, costCentre: StringType, note: StringType,
});
/** A duty with only the Roster's required roles, its person a plain key. */
export const SchedulePlainDuty = StructType({ person: StringType, start: DateTimeType, end: DateTimeType, shift: StringType, team: StringType });
/** A bin: the Allocation's roles beside the yard's own fields. */
export const ScheduleBin = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType), m3: FloatType, kilns: DictType(StringType, FloatType),
    dryFor: TimeStepType, spec: OptionType(StringType), specMeasured: StringType, instruction: OptionType(StringType),
});
/** A week of the app's: its status, the proposals it dismissed, and a field of its own. */
export const ScheduleWeek = StructType({
    state: VariantType({ open: NullType, issued: StructType({ at: DateTimeType }), cancelled: NullType }),
    dismissed: SetType(StringType), approver: OptionType(StringType),
});
/** A day of the app's, its published case holding nothing. */
export const ScheduleDay = StructType({ state: VariantType({ draft: NullType, issued: NullType }), notes: StringType });

/** The duties: a lead's early shift and an agency's late in the week of 8 March 2027, and the lead's a fortnight on. */
export const scheduleDuties = e3.record("schedule_duties", DictType(StringType, ScheduleDuty), new Map([
    ["d1", { who: variant("staff", "w-01"), start: new Date("2027-03-08T05:00:00Z"), end: new Date("2027-03-08T15:00:00Z"),
        shift: "early", team: "inbound", role: "lead", task: some("unloading"), unpaidBreak: 30, costCentre: "CC-10", note: "keys" }],
    ["d2", { who: variant("agency", "a-1"), start: new Date("2027-03-09T14:00:00Z"), end: new Date("2027-03-09T22:00:00Z"),
        shift: "late", team: "dispatch", role: "crew", task: none, unpaidBreak: 0, costCentre: "CC-20", note: "" }],
    ["d3", { who: variant("staff", "w-01"), start: new Date("2027-03-20T05:00:00Z"), end: new Date("2027-03-20T13:00:00Z"),
        shift: "early", team: "inbound", role: "lead", task: some("unloading"), unpaidBreak: 30, costCentre: "CC-10", note: "a later week" }],
]));
export const scheduleDutiesPatch = e3.mutation.patch(scheduleDuties);
/** The duties by the days each touches, as a large record's day index files them. */
export const scheduleDutiesByDay = e3.recordIndex("schedule_duties_by_day", scheduleDuties, {
    keys: East.function([StringType, ScheduleDuty], SetType(DateTimeType), ($, _id, duty) => {
        const days = $.const(Schedule.days);
        return days(duty.start, duty.end);
    }),
});
/** Duties with only the Roster's required roles. */
export const schedulePlainDuties = e3.record("schedule_plain_duties", DictType(StringType, SchedulePlainDuty), new Map([
    ["p1", { person: "w-02", start: new Date("2027-03-08T06:00:00Z"), end: new Date("2027-03-08T14:00:00Z"), shift: "early", team: "inbound" }],
]));
export const schedulePlainDutiesPatch = e3.mutation.patch(schedulePlainDuties);
/** The bins: one on Tuesday 11 May 2027, on its kiln. */
export const scheduleBins = e3.record("schedule_bins", DictType(StringType, ScheduleBin), new Map([
    ["3103", { bay: "B-1", at: new Date("2027-05-11T02:15:00Z"), load: some("LD-2203"), m3: 24, kilns: new Map([["K-109", 24]]),
        dryFor: variant("days", 9), spec: some("MC14"), specMeasured: "MC14", instruction: some("Hold at 40 °C on arrival") }],
]));
export const scheduleBinsPatch = e3.mutation.patch(scheduleBins);
/** The weeks: one issued, the next open, the one after cancelled. */
export const scheduleWeeks = e3.record("schedule_weeks", DictType(DateTimeType, ScheduleWeek), new SortedMap([
    [new Date("2027-03-07T00:00:00Z"), { state: variant("issued", { at: new Date("2027-03-05T09:00:00Z") }), dismissed: new Set(["pr-1"]), approver: some("Ops") }],
    [new Date("2027-03-14T00:00:00Z"), { state: variant("open", null), dismissed: new Set<string>(), approver: none }],
    [new Date("2027-03-21T00:00:00Z"), { state: variant("cancelled", null), dismissed: new Set<string>(), approver: none }],
], compareFor(DateTimeType)));
export const scheduleWeeksPatch = e3.mutation.patch(scheduleWeeks);
/** The days: Tuesday 11 May 2027, a draft. */
export const scheduleDays = e3.record("schedule_days", DictType(DateTimeType, ScheduleDay), new SortedMap([
    [new Date("2027-05-11T00:00:00Z"), { state: variant("draft", null), notes: "" }],
], compareFor(DateTimeType)));
export const scheduleDaysPatch = e3.mutation.patch(scheduleDays);
