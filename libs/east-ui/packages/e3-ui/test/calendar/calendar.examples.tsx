/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import { DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType, example, none, some, variant } from "@elaraai/east";
import { Box, Input, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
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
/** Job templates are live record data, including their duration and initial values; each has a group, which the rail narrows them by. */
export const CalendarJobTemplate = StructType({ name: StringType, group: StringType, hours: FloatType, values: CalendarJobValues });
/** Maintenance templates are also bound data, grouped as the job templates are. */
export const CalendarServiceTemplate = StructType({ name: StringType, group: StringType, hours: FloatType, values: StructType({ title: StringType, technician: StringType, notes: StringType }) });
/** Shift templates start at their hour when dropped on a day. */
export const CalendarShiftTemplate = StructType({ name: StringType, group: StringType, hour: IntegerType, values: StructType({ title: StringType, notes: StringType }) });

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
    ["brackets", { name: "Bracket batch", group: "Fabrication", hours: 4.0, values: { title: "Bracket batch", status: variant("planned", null), hours: 4.0, customer: "", due: none } }],
    ["housings", { name: "Housing batch", group: "Machining", hours: 2.0, values: { title: "Housing batch", status: variant("planned", null), hours: 2.0, customer: "", due: none } }],
]));
export const calendarServiceTemplates = e3.record("calendar_service_templates", DictType(StringType, CalendarServiceTemplate), new Map([
    ["calibration", { name: "Calibration", group: "Calibration", hours: 1.0, values: { title: "Calibration", technician: "cedar", notes: "Check against the reference gauge." } }],
    ["service", { name: "Preventive maintenance", group: "Preventive", hours: 2.0, values: { title: "Preventive maintenance", technician: "ash", notes: "" } }],
]));
export const calendarShiftTemplates = e3.record("calendar_shift_templates", DictType(StringType, CalendarShiftTemplate), new Map([
    ["day", { name: "Day shift", group: "Day", hour: 6n, values: { title: "Day shift", notes: "" } }],
    ["late", { name: "Late shift", group: "Late", hour: 14n, values: { title: "Late shift", notes: "" } }],
]));

// The rail narrows each record through its own indexes (#1343): each event kind over its interval index — on its own,
// and after its status, its machine or its person — so a narrowing keeps every event overlapping the window once.
export const calendarJobsByTime = e3.recordIndex("calendar_jobs_by_time", calendarJobs, { interval: { from: "start", to: "end" } });
export const calendarJobsByStatusTime = e3.recordIndex("calendar_jobs_by_status_time", calendarJobs, { on: ["status"], interval: { from: "start", to: "end" } });
export const calendarJobsByMachineTime = e3.recordIndex("calendar_jobs_by_machine_time", calendarJobs, { on: ["machine"], interval: { from: "start", to: "end" } });
export const calendarServicesByTime = e3.recordIndex("calendar_services_by_time", calendarServices, { interval: { from: "start", to: "end" } });
export const calendarServicesByMachineTime = e3.recordIndex("calendar_services_by_machine_time", calendarServices, { on: ["machine"], interval: { from: "start", to: "end" } });
export const calendarShiftsByTime = e3.recordIndex("calendar_shifts_by_time", calendarShifts, { interval: { from: "start", to: "end" } });
export const calendarShiftsByPersonTime = e3.recordIndex("calendar_shifts_by_person_time", calendarShifts, { on: ["person"], interval: { from: "start", to: "end" } });
export const calendarMachinesByArea = e3.recordIndex("calendar_machines_by_area", calendarMachines, { on: ["area"] });
export const calendarPeopleByTeam = e3.recordIndex("calendar_people_by_team", calendarPeople, { on: ["team"] });
export const calendarJobTemplatesByGroup = e3.recordIndex("calendar_job_templates_by_group", calendarJobTemplates, { on: ["group"] });
export const calendarServiceTemplatesByGroup = e3.recordIndex("calendar_service_templates_by_group", calendarServiceTemplates, { on: ["group"] });
export const calendarShiftTemplatesByGroup = e3.recordIndex("calendar_shift_templates_by_group", calendarShiftTemplates, { on: ["group"] });


export const calendarOperations = example({
    inputs: [],
    description: "A metal fabrication calendar over three event records and bound machines, people and templates: Calendar, Resources and Timeline share one frame, one Slice.bindRecords rail — a source per event kind, resource kind and template record — and Save history. Its library schedules the event record's backlog and assigns technicians; overlapping production and maintenance warn without blocking Save.",
    keywords: ["Calendar", "Record.bind", "Data.bind", "Calendar.templates", "Schedule", "Slice", "Slice.bindRecords", "Data.bindPaged", "recordIndex", "interval", "BuilderFrame", "library", "backlog", "inspector", "overlaps", "Save"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // What the Calendar reads whole binds with Data.bind, which keeps it loaded beside its pages; the event records
        // it writes bind with Record.bind, and it reads their events through their pages alone.
        const machines = $.let(Data.bind(calendarMachines));
        const people = $.let(Data.bind(calendarPeople));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const services = $.let(Record.bind(calendarServices, [calendarServicesPatch]));
        const shifts = $.let(Record.bind(calendarShifts, [calendarShiftsPatch]));
        const jobTemplates = $.let(Data.bind(calendarJobTemplates));
        const serviceTemplates = $.let(Data.bind(calendarServiceTemplates));
        const shiftTemplates = $.let(Data.bind(calendarShiftTemplates));
        // Every record paged: each event kind's interval indexes and its own entries, the others' fields' indexes.
        const jobIndex = $.let(Data.bindPaged(calendarJobs, { indexes: [calendarJobsByTime, calendarJobsByStatusTime, calendarJobsByMachineTime] }));
        const serviceIndex = $.let(Data.bindPaged(calendarServices, { indexes: [calendarServicesByTime, calendarServicesByMachineTime] }));
        const shiftIndex = $.let(Data.bindPaged(calendarShifts, { indexes: [calendarShiftsByTime, calendarShiftsByPersonTime] }));
        const machineIndex = $.let(Data.bindPaged(calendarMachines, { indexes: [calendarMachinesByArea] }));
        const peopleIndex = $.let(Data.bindPaged(calendarPeople, { indexes: [calendarPeopleByTeam] }));
        const jobTemplateIndex = $.let(Data.bindPaged(calendarJobTemplates, { indexes: [calendarJobTemplatesByGroup] }));
        const serviceTemplateIndex = $.let(Data.bindPaged(calendarServiceTemplates, { indexes: [calendarServiceTemplatesByGroup] }));
        const shiftTemplateIndex = $.let(Data.bindPaged(calendarShiftTemplates, { indexes: [calendarShiftTemplatesByGroup] }));
        const jobEntries = $.let(Data.bindPaged(calendarJobs));
        const serviceEntries = $.let(Data.bindPaged(calendarServices));
        const shiftEntries = $.let(Data.bindPaged(calendarShifts));
        // One rail over every record, a source each (#1343): each event kind through its interval indexes, its range the
        // window the navigation writes in every kind at once; the machines, the people and each templates record by its fields.
        const slice = $.let(Slice.bindRecords("ex.calendarOperations", {
            job: { source: jobIndex, icon: { prefix: "fas", name: "industry" },
                fields: { status: { label: "Status" }, machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2", null] }, start: { label: "Dates" } }, range: "start" },
            service: { source: serviceIndex, icon: { prefix: "fas", name: "screwdriver-wrench" },
                fields: { machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2"] }, start: { label: "Dates" } }, range: "start" },
            shift: { source: shiftIndex, icon: { prefix: "fas", name: "user-clock" },
                fields: { person: { label: "Person", hints: ["ash", "birch", "cedar"] }, start: { label: "Dates" } }, range: "start" },
            machines: { source: machineIndex, icon: { prefix: "fas", name: "gears" },
                fields: { area: { label: "Area", hints: ["Press shop", "Machine shop"] } } },
            people: { source: peopleIndex, icon: { prefix: "fas", name: "users" },
                fields: { team: { label: "Team", hints: ["Maintenance", "Production"] } } },
            jobTemplates: { source: jobTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Job template", hints: ["Fabrication", "Machining"] } } },
            serviceTemplates: { source: serviceTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Service template", hints: ["Preventive", "Calibration"] } } },
            shiftTemplates: { source: shiftTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Shift template", hints: ["Day", "Late"] } } },
        }));
        return <Box height="760px"><Calendar id="operations" inspector view={{ date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            slice={{ slice }}
            resources={{
                machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name, meta: row => some(row.area) }),
                people: Calendar.resources(people.read(), { name: "People", icon: "users", label: row => row.name, meta: row => some(row.team) }),
            }}
            events={{
                job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    entries: jobEntries,
                    status: { field: "status", cases: { planned: { label: "Planned", tone: variant("neutral", null), ring: true }, active: { label: "Active", tone: variant("info", null), ring: false }, done: { label: "Done", tone: variant("success", null), ring: false } } },
                    backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
                    ready: row => row.hours.lessEqual(0).ifElse(() => variant("incomplete", [{ field: "hours", message: "Duration must be positive" }]), () => variant("ready", null)),
                    templates: Calendar.templates(jobTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "jobTemplates" }),
                }),
                service: Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    entries: serviceEntries,
                    fields: { technician: Calendar.field.reference({ of: "people" }) },
                    templates: Calendar.templates(serviceTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "serviceTemplates" }),
                }),
                shift: Calendar.events(shifts, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" }, overlaps: "allow",
                    entries: shiftEntries,
                    templates: Calendar.templates(shiftTemplates.read(), { name: row => row.name, group: row => some(row.group), at: row => some({ hour: row.hour, minute: 0n }), duration: () => variant("hours", 8.0), values: row => row.values, source: "shiftTemplates" }),
                }),
            }}
            library={[Calendar.library.templates(), Calendar.library.backlog(), Calendar.library.tab(people.read(), {
                name: "Technicians", icon: "user-gear", label: row => row.name, meta: row => some(row.team), group: row => row.team,
                drop: (_row, key) => Calendar.patch(CalendarService, { technician: key }), source: "people",
            })]} />
        </Box>;
    }}</Reactive>),
});
export const calendarMobile = example({
    inputs: [],
    description: "The same bound calendar in a phone-width container: chronological agenda cards with explicit Move, Resize, Duplicate, Delete and Return to backlog actions, Create and Schedule in the library, shared forms and Save history. Resizing preserves the view, selection and drafts; no dragging on the agenda.",
    keywords: ["Calendar", "mobile", "responsive", "agenda", "cards", "no dragging", "explicit actions", "Record.bind", "templates"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // What the Calendar reads whole binds with Data.bind, which keeps it loaded beside its pages; the event records
        // it writes bind with Record.bind, and it reads their events through their pages alone.
        const machines = $.let(Data.bind(calendarMachines));
        const people = $.let(Data.bind(calendarPeople));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const services = $.let(Record.bind(calendarServices, [calendarServicesPatch]));
        const shifts = $.let(Record.bind(calendarShifts, [calendarShiftsPatch]));
        const jobTemplates = $.let(Data.bind(calendarJobTemplates));
        const serviceTemplates = $.let(Data.bind(calendarServiceTemplates));
        const shiftTemplates = $.let(Data.bind(calendarShiftTemplates));
        // Every record paged: each event kind's interval indexes and its own entries, the others' fields' indexes.
        const jobIndex = $.let(Data.bindPaged(calendarJobs, { indexes: [calendarJobsByTime, calendarJobsByStatusTime, calendarJobsByMachineTime] }));
        const serviceIndex = $.let(Data.bindPaged(calendarServices, { indexes: [calendarServicesByTime, calendarServicesByMachineTime] }));
        const shiftIndex = $.let(Data.bindPaged(calendarShifts, { indexes: [calendarShiftsByTime, calendarShiftsByPersonTime] }));
        const machineIndex = $.let(Data.bindPaged(calendarMachines, { indexes: [calendarMachinesByArea] }));
        const peopleIndex = $.let(Data.bindPaged(calendarPeople, { indexes: [calendarPeopleByTeam] }));
        const jobTemplateIndex = $.let(Data.bindPaged(calendarJobTemplates, { indexes: [calendarJobTemplatesByGroup] }));
        const serviceTemplateIndex = $.let(Data.bindPaged(calendarServiceTemplates, { indexes: [calendarServiceTemplatesByGroup] }));
        const shiftTemplateIndex = $.let(Data.bindPaged(calendarShiftTemplates, { indexes: [calendarShiftTemplatesByGroup] }));
        const jobEntries = $.let(Data.bindPaged(calendarJobs));
        const serviceEntries = $.let(Data.bindPaged(calendarServices));
        const shiftEntries = $.let(Data.bindPaged(calendarShifts));
        // One rail over every record, a source each (#1343): each event kind through its interval indexes, its range the
        // window the navigation writes in every kind at once; the machines, the people and each templates record by its fields.
        const slice = $.let(Slice.bindRecords("ex.calendarMobile", {
            job: { source: jobIndex, icon: { prefix: "fas", name: "industry" },
                fields: { status: { label: "Status" }, machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2", null] }, start: { label: "Dates" } }, range: "start" },
            service: { source: serviceIndex, icon: { prefix: "fas", name: "screwdriver-wrench" },
                fields: { machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2"] }, start: { label: "Dates" } }, range: "start" },
            shift: { source: shiftIndex, icon: { prefix: "fas", name: "user-clock" },
                fields: { person: { label: "Person", hints: ["ash", "birch", "cedar"] }, start: { label: "Dates" } }, range: "start" },
            machines: { source: machineIndex, icon: { prefix: "fas", name: "gears" },
                fields: { area: { label: "Area", hints: ["Press shop", "Machine shop"] } } },
            people: { source: peopleIndex, icon: { prefix: "fas", name: "users" },
                fields: { team: { label: "Team", hints: ["Maintenance", "Production"] } } },
            jobTemplates: { source: jobTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Job template", hints: ["Fabrication", "Machining"] } } },
            serviceTemplates: { source: serviceTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Service template", hints: ["Preventive", "Calibration"] } } },
            shiftTemplates: { source: shiftTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Shift template", hints: ["Day", "Late"] } } },
        }));
        return <Box width="100%" maxWidth="390px" height="760px"><Calendar id="operations" inspector view={{ date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            slice={{ slice }}
            resources={{
                machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name, meta: row => some(row.area) }),
                people: Calendar.resources(people.read(), { name: "People", icon: "users", label: row => row.name, meta: row => some(row.team) }),
            }}
            events={{
                job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    entries: jobEntries,
                    status: { field: "status", cases: { planned: { label: "Planned", tone: variant("neutral", null), ring: true }, active: { label: "Active", tone: variant("info", null), ring: false }, done: { label: "Done", tone: variant("success", null), ring: false } } },
                    backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
                    ready: row => row.hours.lessEqual(0).ifElse(() => variant("incomplete", [{ field: "hours", message: "Duration must be positive" }]), () => variant("ready", null)),
                    templates: Calendar.templates(jobTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "jobTemplates" }),
                }),
                service: Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    entries: serviceEntries,
                    fields: { technician: Calendar.field.reference({ of: "people" }) },
                    templates: Calendar.templates(serviceTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "serviceTemplates" }),
                }),
                shift: Calendar.events(shifts, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" }, overlaps: "allow",
                    entries: shiftEntries,
                    templates: Calendar.templates(shiftTemplates.read(), { name: row => row.name, group: row => some(row.group), at: row => some({ hour: row.hour, minute: 0n }), duration: () => variant("hours", 8.0), values: row => row.values, source: "shiftTemplates" }),
                }),
            }}
            library={[Calendar.library.templates(), Calendar.library.backlog(), Calendar.library.tab(people.read(), {
                name: "Technicians", icon: "user-gear", label: row => row.name, meta: row => some(row.team), group: row => row.team,
                drop: (_row, key) => Calendar.patch(CalendarService, { technician: key }), source: "people",
            })]} />
        </Box>;
    }}</Reactive>),
});
export const calendarReadOnly = example({
    inputs: [],
    description: "The same record calendar given readOnly: navigation, filtering, selection and overlaps, with a read-only inspector and no mutation session or editing actions.",
    keywords: ["Calendar", "readOnly", "records", "selection", "overlaps"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // What the Calendar reads whole binds with Data.bind, which keeps it loaded beside its pages; the event records
        // it writes bind with Record.bind, and it reads their events through their pages alone.
        const machines = $.let(Data.bind(calendarMachines));
        const people = $.let(Data.bind(calendarPeople));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const services = $.let(Record.bind(calendarServices, [calendarServicesPatch]));
        const shifts = $.let(Record.bind(calendarShifts, [calendarShiftsPatch]));
        const jobTemplates = $.let(Data.bind(calendarJobTemplates));
        const serviceTemplates = $.let(Data.bind(calendarServiceTemplates));
        const shiftTemplates = $.let(Data.bind(calendarShiftTemplates));
        // Every record paged: each event kind's interval indexes and its own entries, the others' fields' indexes.
        const jobIndex = $.let(Data.bindPaged(calendarJobs, { indexes: [calendarJobsByTime, calendarJobsByStatusTime, calendarJobsByMachineTime] }));
        const serviceIndex = $.let(Data.bindPaged(calendarServices, { indexes: [calendarServicesByTime, calendarServicesByMachineTime] }));
        const shiftIndex = $.let(Data.bindPaged(calendarShifts, { indexes: [calendarShiftsByTime, calendarShiftsByPersonTime] }));
        const machineIndex = $.let(Data.bindPaged(calendarMachines, { indexes: [calendarMachinesByArea] }));
        const peopleIndex = $.let(Data.bindPaged(calendarPeople, { indexes: [calendarPeopleByTeam] }));
        const jobTemplateIndex = $.let(Data.bindPaged(calendarJobTemplates, { indexes: [calendarJobTemplatesByGroup] }));
        const serviceTemplateIndex = $.let(Data.bindPaged(calendarServiceTemplates, { indexes: [calendarServiceTemplatesByGroup] }));
        const shiftTemplateIndex = $.let(Data.bindPaged(calendarShiftTemplates, { indexes: [calendarShiftTemplatesByGroup] }));
        const jobEntries = $.let(Data.bindPaged(calendarJobs));
        const serviceEntries = $.let(Data.bindPaged(calendarServices));
        const shiftEntries = $.let(Data.bindPaged(calendarShifts));
        // One rail over every record, a source each (#1343): each event kind through its interval indexes, its range the
        // window the navigation writes in every kind at once; the machines, the people and each templates record by its fields.
        const slice = $.let(Slice.bindRecords("ex.calendarReadOnly", {
            job: { source: jobIndex, icon: { prefix: "fas", name: "industry" },
                fields: { status: { label: "Status" }, machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2", null] }, start: { label: "Dates" } }, range: "start" },
            service: { source: serviceIndex, icon: { prefix: "fas", name: "screwdriver-wrench" },
                fields: { machine: { label: "Machine", hints: ["press1", "press2", "lathe1", "lathe2"] }, start: { label: "Dates" } }, range: "start" },
            shift: { source: shiftIndex, icon: { prefix: "fas", name: "user-clock" },
                fields: { person: { label: "Person", hints: ["ash", "birch", "cedar"] }, start: { label: "Dates" } }, range: "start" },
            machines: { source: machineIndex, icon: { prefix: "fas", name: "gears" },
                fields: { area: { label: "Area", hints: ["Press shop", "Machine shop"] } } },
            people: { source: peopleIndex, icon: { prefix: "fas", name: "users" },
                fields: { team: { label: "Team", hints: ["Maintenance", "Production"] } } },
            jobTemplates: { source: jobTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Job template", hints: ["Fabrication", "Machining"] } } },
            serviceTemplates: { source: serviceTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Service template", hints: ["Preventive", "Calibration"] } } },
            shiftTemplates: { source: shiftTemplateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Shift template", hints: ["Day", "Late"] } } },
        }));
        return <Box height="760px"><Calendar id="operations" inspector readOnly view={{ date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            slice={{ slice }}
            resources={{
                machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name, meta: row => some(row.area) }),
                people: Calendar.resources(people.read(), { name: "People", icon: "users", label: row => row.name, meta: row => some(row.team) }),
            }}
            events={{
                job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    entries: jobEntries,
                    status: { field: "status", cases: { planned: { label: "Planned", tone: variant("neutral", null), ring: true }, active: { label: "Active", tone: variant("info", null), ring: false }, done: { label: "Done", tone: variant("success", null), ring: false } } },
                    backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
                    ready: row => row.hours.lessEqual(0).ifElse(() => variant("incomplete", [{ field: "hours", message: "Duration must be positive" }]), () => variant("ready", null)),
                    templates: Calendar.templates(jobTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "jobTemplates" }),
                }),
                service: Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    entries: serviceEntries,
                    fields: { technician: Calendar.field.reference({ of: "people" }) },
                    templates: Calendar.templates(serviceTemplates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "serviceTemplates" }),
                }),
                shift: Calendar.events(shifts, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" }, overlaps: "allow",
                    entries: shiftEntries,
                    templates: Calendar.templates(shiftTemplates.read(), { name: row => row.name, group: row => some(row.group), at: row => some({ hour: row.hour, minute: 0n }), duration: () => variant("hours", 8.0), values: row => row.values, source: "shiftTemplates" }),
                }),
            }}
            library={[Calendar.library.templates(), Calendar.library.backlog(), Calendar.library.tab(people.read(), {
                name: "Technicians", icon: "user-gear", label: row => row.name, meta: row => some(row.team), group: row => row.team,
                drop: (_row, key) => Calendar.patch(CalendarService, { technician: key }), source: "people",
            })]} />
        </Box>;
    }}</Reactive>),
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
    description: "The jobs calendar read by its day and backlog indexes, with by-key reads for the inspector and checked saves. The calendar's own navigation picks the days read. Counts describe the loaded window. The same mobile agenda and explicit actions work over the paged record.",
    keywords: ["Calendar", "Data.bindPaged", "recordIndex", "window", "backlogWindow", "entries", "day keys", "mobile", "Save"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const machines = $.let(Record.bind(calendarMachines, []));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        const days = $.let(Data.bindPaged(calendarJobs, { index: calendarJobsByDay, join: true }));
        const backlog = $.let(Data.bindPaged(calendarJobs, { index: calendarJobsUnscheduled, join: true }));
        const entries = $.let(Data.bindPaged(calendarJobs));
        // The days in view are the calendar's own navigation's: it reads them through the day index, never the record whole.
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
export const calendarCustomInspector = example({
    inputs: [],
    description: "A typed custom appointment inspector updates the whole row through Calendar's shared Undo, Redo and Save session.",
    keywords: ["Calendar", "inspector", "custom", "Schedule.events", "update", "Record.bind"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const appointments = $.let(Record.bind(calendarAppointments, [calendarAppointmentsPatch]));
        const inspect = $.const(East.function([CalendarAppointment, FunctionType([CalendarAppointment], NullType)], UIComponentType, ($2, row, update) => {
            const change = $2.const(East.function([StringType], NullType, ($3, title) => { $3(update({ title, start: row.start, end: row.end })); }));
            return <Input.String value={row.title} placeholder="Appointment title" onChange={change} />;
        }));
        return <Box height="640px"><Calendar inspector view={{ period: "day", date: new Date("2026-10-01T00:00:00Z") }}
            events={{ appointment: Calendar.events(appointments, { name: "Appointment", icon: "calendar", title: "title", start: "start", end: "end", inspector: inspect }) }} />
        </Box>;
    }}</Reactive>),
});
