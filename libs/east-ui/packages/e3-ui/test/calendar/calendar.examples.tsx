/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import { BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, NullType, OptionType, SetType, StringType, StructType, VariantType, example, none, some, variant } from "@elaraai/east";
import { Box, Input, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** The resources of a small metal fabrication shop. */
export const CalendarMachine = StructType({ name: StringType, area: StringType });
/** People the shifts run on and the maintenance library assigns. */
export const CalendarPerson = StructType({ name: StringType, team: StringType });
/** A job's lifecycle. */
export const CalendarJobState = VariantType({ planned: NullType, active: NullType, done: NullType });
/** A job may wait in the backlog; its own record holds its unscheduled rows. */
export const CalendarJob = StructType({ title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), machine: OptionType(StringType),
    status: CalendarJobState, hours: FloatType, customer: StringType, due: OptionType(DateTimeType) });
/** The initial job fields a template record supplies. */
export const CalendarJobValues = StructType({ title: StringType, status: CalendarJobState, hours: FloatType, customer: StringType, due: OptionType(DateTimeType) });
/** Maintenance is a different record, with its own fields and patch mutation. */
export const CalendarService = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, machine: StringType, technician: StringType, notes: StringType });
/** A person's shift is its own event kind. */
export const CalendarShift = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, person: StringType, notes: StringType });
/** Job templates are live record data, including their duration and initial values. */
export const CalendarJobTemplate = StructType({ name: StringType, group: StringType, hours: FloatType, values: CalendarJobValues });
/** Maintenance templates are also bound data. */
export const CalendarServiceTemplate = StructType({ name: StringType, hours: FloatType, values: StructType({ title: StringType, technician: StringType, notes: StringType }) });
/** Shift templates start at a particular time when dropped on a day. */
export const CalendarShiftTemplate = StructType({ name: StringType, values: StructType({ title: StringType, notes: StringType }) });

export const calendarMachines = e3.record("calendar_machines", DictType(StringType, CalendarMachine), new Map([
    ["press1", { name: "Press 1", area: "Press shop" }], ["press2", { name: "Press 2", area: "Press shop" }],
    ["lathe1", { name: "Lathe 1", area: "Machine shop" }], ["lathe2", { name: "Lathe 2", area: "Machine shop" }],
]));
export const calendarPeople = e3.record("calendar_people", DictType(StringType, CalendarPerson), new Map([
    ["ash", { name: "A. Ash", team: "Maintenance" }], ["birch", { name: "B. Birch", team: "Production" }], ["cedar", { name: "C. Cedar", team: "Maintenance" }],
]));
export const calendarJobs = e3.record("calendar_jobs", DictType(StringType, CalendarJob), new Map([
    ["job1", { title: "Mounting brackets · batch 42", start: some(new Date("2026-10-01T06:00:00Z")), end: some(new Date("2026-10-01T10:00:00Z")), machine: some("press1"), status: variant("active", null), hours: 4.0, customer: "Alder Works", due: some(new Date("2026-10-02T00:00:00Z")) }],
    ["job2", { title: "Pump housings", start: some(new Date("2026-10-01T08:00:00Z")), end: some(new Date("2026-10-01T13:00:00Z")), machine: some("lathe1"), status: variant("planned", null), hours: 5.0, customer: "Birch Engineering", due: none }],
    ["job3", { title: "Long title: stainless steel mounting plates for the prototype assembly", start: some(new Date("2026-10-01T11:00:00Z")), end: some(new Date("2026-10-01T11:30:00Z")), machine: some("press2"), status: variant("planned", null), hours: 0.5, customer: "Cedar Fabrication", due: none }],
    ["job4", { title: "Bearing collars", start: some(new Date("2026-10-02T09:00:00Z")), end: some(new Date("2026-10-02T12:00:00Z")), machine: some("lathe2"), status: variant("planned", null), hours: 3.0, customer: "Alder Works", due: none }],
    ["job5", { title: "Overnight batch", start: some(new Date("2026-10-01T22:00:00Z")), end: some(new Date("2026-10-02T02:00:00Z")), machine: some("press1"), status: variant("planned", null), hours: 4.0, customer: "Birch Engineering", due: none }],
    ["job6", { title: "September closeout", start: some(new Date("2026-09-30T08:00:00Z")), end: some(new Date("2026-09-30T10:00:00Z")), machine: some("press2"), status: variant("done", null), hours: 2.0, customer: "Alder Works", due: none }],
    ["backlog1", { title: "Torque-test fixtures", start: none, end: none, machine: some("press1"), status: variant("planned", null), hours: 2.0, customer: "Alder Works", due: some(new Date("2026-10-02T00:00:00Z")) }],
    ["backlog2", { title: "Valve bodies", start: none, end: none, machine: none, status: variant("planned", null), hours: 3.0, customer: "Cedar Fabrication", due: some(new Date("2026-10-06T00:00:00Z")) }],
    ["backlog3", { title: "Replacement shims", start: none, end: none, machine: none, status: variant("planned", null), hours: 1.0, customer: "Birch Engineering", due: some(new Date("2026-10-20T00:00:00Z")) }],
    ["backlog4", { title: "Prototype spacers", start: none, end: none, machine: none, status: variant("planned", null), hours: 2.5, customer: "Alder Works", due: none }],
]));
export const calendarJobsPatch = e3.mutation.patch(calendarJobs);
export const calendarServices = e3.record("calendar_services", DictType(StringType, CalendarService), new Map([
    ["service1", { title: "Preventive maintenance", start: new Date("2026-10-01T09:00:00Z"), end: new Date("2026-10-01T11:00:00Z"), machine: "press1", technician: "ash", notes: "Inspect the tooling and check torque." }],
    ["service2", { title: "Calibration", start: new Date("2026-10-02T13:00:00Z"), end: new Date("2026-10-02T14:00:00Z"), machine: "lathe1", technician: "cedar", notes: "Check against the reference gauge." }],
]));
export const calendarServicesPatch = e3.mutation.patch(calendarServices);
export const calendarShifts = e3.record("calendar_shifts", DictType(StringType, CalendarShift), new Map([
    ["shift1", { title: "Day shift", start: new Date("2026-10-01T06:00:00Z"), end: new Date("2026-10-01T14:00:00Z"), person: "ash", notes: "Press shop" }],
    ["shift2", { title: "Late shift", start: new Date("2026-10-01T14:00:00Z"), end: new Date("2026-10-01T22:00:00Z"), person: "birch", notes: "Machine shop" }],
]));
export const calendarShiftsPatch = e3.mutation.patch(calendarShifts);
export const calendarJobTemplates = e3.record("calendar_job_templates", DictType(StringType, CalendarJobTemplate), new Map([
    ["brackets", { name: "Bracket batch", group: "Production", hours: 4.0, values: { title: "Bracket batch", status: variant("planned", null), hours: 4.0, customer: "", due: none } }],
    ["housings", { name: "Housing batch", group: "Production", hours: 2.0, values: { title: "Housing batch", status: variant("planned", null), hours: 2.0, customer: "", due: none } }],
]));
export const calendarServiceTemplates = e3.record("calendar_service_templates", DictType(StringType, CalendarServiceTemplate), new Map([
    ["service", { name: "Preventive maintenance", hours: 2.0, values: { title: "Preventive maintenance", technician: "ash", notes: "" } }],
]));
export const calendarShiftTemplates = e3.record("calendar_shift_templates", DictType(StringType, CalendarShiftTemplate), new Map([
    ["day", { name: "Day shift", values: { title: "Day shift", notes: "" } }],
]));

/** The full surface, reusable as real East IR; record and template bindings stay reactive. */
export const calendarOperationsUI = East.function([BooleanType], UIComponentType, (_$, readOnly) => (
    <Reactive>{$ => {
        const machines = $.let(Record.bind(calendarMachines, []));
        const people = $.let(Record.bind(calendarPeople, []));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const services = $.let(Record.bind(calendarServices, [calendarServicesPatch]));
        const shifts = $.let(Record.bind(calendarShifts, [calendarShiftsPatch]));
        const jobTemplates = $.let(Record.bind(calendarJobTemplates, []));
        const serviceTemplates = $.let(Record.bind(calendarServiceTemplates, []));
        const shiftTemplates = $.let(Record.bind(calendarShiftTemplates, []));
        return <Calendar id="operations" inspector readOnly={readOnly} view={{ date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            resources={{
                machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name, meta: row => some(row.area) }),
                people: Calendar.resources(people.read(), { name: "People", icon: "users", label: row => row.name, meta: row => some(row.team) }),
            }}
            events={{
                job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    status: { field: "status", cases: { planned: { label: "Planned", tone: variant("neutral", null), ring: true }, active: { label: "Active", tone: variant("info", null), ring: false }, done: { label: "Done", tone: variant("success", null), ring: false } } },
                    backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
                    ready: row => row.hours.lessEqual(0).ifElse(() => variant("incomplete", [{ field: "hours", message: "Duration must be positive" }]), () => variant("ready", null)),
                    templates: Calendar.templates(jobTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values }),
                }),
                service: Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    fields: { technician: Calendar.field.reference({ of: "people" }) },
                    templates: Calendar.templates(serviceTemplates.read(), { name: row => row.name, duration: row => variant("hours", row.hours), values: row => row.values }),
                }),
                shift: Calendar.events(shifts, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" }, overlaps: "allow",
                    templates: Calendar.templates(shiftTemplates.read(), { name: row => row.name, at: () => some({ hour: 6n, minute: 0n }), duration: () => variant("hours", 8.0), values: row => row.values }),
                }),
            }}
            library={[Calendar.library.templates(), Calendar.library.backlog(), Calendar.library.tab(people.read(), {
                name: "Technicians", icon: "user-gear", label: row => row.name, meta: row => some(row.team), group: row => row.team,
                drop: (_row, key) => Calendar.patch(CalendarService, { technician: key }),
            })]} />;
    }}</Reactive>
));

export const calendarOperations = example({
    inputs: [],
    description: "A metal fabrication calendar over three event records and bound machines, people and templates: Calendar, Resources and Timeline share one frame, Slice filters and Save history. Its library schedules the event record's backlog and assigns technicians; overlapping production and maintenance warn without blocking Save.",
    keywords: ["Calendar", "Record.bind", "Calendar.templates", "Schedule", "BuilderFrame", "library", "backlog", "inspector", "overlaps", "Save"],
    fn: East.function([], UIComponentType, $ => {
        const surface = $.const(calendarOperationsUI);
        return <Box height="760px">{surface(false)}</Box>;
    }),
});
export const calendarMobile = example({
    inputs: [],
    description: "The same bound calendar in a phone-width container: chronological agenda cards with explicit Move, Resize, Duplicate, Delete and Return to backlog actions, Create and Schedule in the library, shared forms and Save history. Resizing preserves the view, selection and drafts; no dragging on the agenda.",
    keywords: ["Calendar", "mobile", "responsive", "agenda", "cards", "no dragging", "explicit actions", "Record.bind", "templates"],
    fn: East.function([], UIComponentType, $ => {
        const surface = $.const(calendarOperationsUI);
        return <Box width="100%" maxWidth="390px" height="760px">{surface(false)}</Box>;
    }),
});
export const calendarReadOnly = example({
    inputs: [],
    description: "The same record calendar given readOnly: navigation, filtering, selection and overlaps, with a read-only inspector and no mutation session or editing actions.",
    keywords: ["Calendar", "readOnly", "records", "selection", "overlaps"],
    fn: East.function([], UIComponentType, $ => {
        const surface = $.const(calendarOperationsUI);
        return <Box height="760px">{surface(true)}</Box>;
    }),
});
export const calendarMinimal = example({
    inputs: [],
    description: "A day calendar bound to jobs and machines, with no library or inspector. The shared frame and editing history are internal; on a phone the agenda's explicit action forms remain available without an inspector.",
    keywords: ["Calendar", "minimal", "Record.bind", "day", "mobile", "optional panes"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const machines = $.let(Record.bind(calendarMachines, []));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        return <Box height="680px"><Calendar id="minimal" view={{ period: "day", date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            events={{ job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" }, backlog: { duration: row => variant("hours", row.hours), due: row => row.due } }) }} />
        </Box>;
    }}</Reactive>),
});

/** Each job is indexed under every UTC day it touches, leaving an exact midnight end out. */
export const calendarJobsByDay = e3.recordIndex("calendar_jobs_by_day", calendarJobs, {
    keys: East.function([StringType, CalendarJob], SetType(DateTimeType), ($, _key, row) => {
        const days = $.const(Calendar.days);
        return row.start.match({
            some: (_$, start) => row.end.match({ some: (_$, end) => days(start, end), none: () => East.value(new Set<Date>(), SetType(DateTimeType)) }),
            none: () => East.value(new Set<Date>(), SetType(DateTimeType)),
        });
    }),
});
/** The unscheduled rows are indexed by due date; they remain in the jobs record. */
export const calendarJobsUnscheduled = e3.recordIndex("calendar_jobs_unscheduled", calendarJobs, {
    keys: East.function([StringType, CalendarJob], SetType(OptionType(DateTimeType)), ($, _key, row) => {
        const unscheduled = $.const(Calendar.unscheduled);
        return unscheduled(row.start, row.due);
    }),
});
export const calendarWindowed = example({
    inputs: [],
    description: "The jobs calendar read by its day and backlog indexes, with by-key reads for the inspector and checked saves. Navigation changes the loaded window; filtering and counts say what they cover. The same mobile agenda and explicit actions work over the paged record.",
    keywords: ["Calendar", "Data.bindPaged", "recordIndex", "window", "backlogWindow", "entries", "mobile", "Save"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const machines = $.let(Record.bind(calendarMachines, []));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const days = $.let(Data.bindPaged(calendarJobs, { index: calendarJobsByDay, join: true }));
        const backlog = $.let(Data.bindPaged(calendarJobs, { index: calendarJobsUnscheduled, join: true }));
        const entries = $.let(Data.bindPaged(calendarJobs));
        return <Box height="760px"><Calendar id="windowed" inspector view={{ period: "day", date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            events={{ job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                window: days, backlogWindow: backlog, entries, backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
            }) }} library={[Calendar.library.backlog()]} />
        </Box>;
    }}</Reactive>),
});

/** The smallest event record needs only its title and two instants. */
export const CalendarAppointment = StructType({ title: StringType, start: DateTimeType, end: DateTimeType });
export const calendarAppointments = e3.record("calendar_appointments", DictType(StringType, CalendarAppointment), new Map([
    ["check", { title: "Safety check", start: new Date("2026-10-01T09:00:00Z"), end: new Date("2026-10-01T10:00:00Z") }],
    ["review", { title: "Production review", start: new Date("2026-10-01T11:00:00Z"), end: new Date("2026-10-01T12:00:00Z") }],
]));
export const calendarAppointmentsPatch = e3.mutation.patch(calendarAppointments);
export const calendarQuickstart = example({
    inputs: [],
    description: "The smallest Calendar: a bound appointment record and its patch mutation. Calendar owns its frame, toolbar and editing session; the app names the fields that scheduling writes.",
    keywords: ["Calendar", "quickstart", "Record.bind", "events", "Save"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const appointments = $.let(Record.bind(calendarAppointments, [calendarAppointmentsPatch]));
        return <Box height="640px"><Calendar inspector view={{ period: "day", date: new Date("2026-10-01T00:00:00Z") }}
            events={{ appointment: Calendar.events(appointments, { name: "Appointment", icon: "calendar", title: "title", start: "start", end: "end" }) }} />
        </Box>;
    }}</Reactive>),
});

/** A custom inspector edits the complete typed row through the same session. */
export const calendarInspectAppointment = East.function([CalendarAppointment, FunctionType([CalendarAppointment], NullType)], UIComponentType, ($, row, update) => {
    const change = $.const(East.function([StringType], NullType, ($2, title) => { $2(update({ title, start: row.start, end: row.end })); }));
    return <Input.String value={row.title} placeholder="Appointment title" onChange={change} />;
});
export const calendarCustomInspector = example({
    inputs: [],
    description: "A typed custom appointment inspector updates the whole row through Calendar's shared Undo, Redo and Save session.",
    keywords: ["Calendar", "inspector", "custom", "Schedule.events", "update", "Record.bind"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const appointments = $.let(Record.bind(calendarAppointments, [calendarAppointmentsPatch]));
        return <Box height="640px"><Calendar inspector view={{ period: "day", date: new Date("2026-10-01T00:00:00Z") }}
            events={{ appointment: Calendar.events(appointments, { name: "Appointment", icon: "calendar", title: "title", start: "start", end: "end", inspector: calendarInspectAppointment }) }} />
        </Box>;
    }}</Reactive>),
});
