/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FunctionType, NullType, OptionType, PatchType, StringType, example, none, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Field, Reactive, Slice, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Func, Record, Roster } from "@elaraai/e3-ui";
import { WarehouseActivity, WarehouseConfig, WarehousePerson, warehouseActivities, warehouseConfig, warehouseForecast, warehousePeople, warehouseProposals, warehouseWeeks } from "./warehouse.js";

export const rosterWeeks = e3.record("roster_weeks", Roster.Types.Weeks, warehouseWeeks);
export const rosterWeeksPatch = e3.mutation.patch(rosterWeeks);
export const rosterStaff = e3.record("roster_staff", DictType(StringType, WarehousePerson), warehousePeople);
export const rosterConfiguration = e3.record("roster_configuration", WarehouseConfig, warehouseConfig);
export const rosterForecast = e3.record("roster_forecast", DictType(DateTimeType, Roster.Types.Requirements), warehouseForecast);
export const rosterProposals = e3.record("roster_proposals", ArrayType(Roster.Types.Proposal), warehouseProposals);
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
export const rosterStaffFitBody = East.function([Roster.Types.FitRequest], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer);
    const rule = $.const(Roster.fit);
    const weekHours = $.const(Roster.weekHours);
    // Every person's hours this week, once: what is left of each one's contract ranks them.
    const hours = $.const(weekHours(req.week, req.context));
    return answer(req, East.function([Roster.Types.FitRequest, Roster.Types.Person], Roster.Types.Fit, ($2, request, person) => {
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
/** The configuration's door: another session's edit of it, a patch of the one struct it is. */
export const rosterConfigurationPatch = e3.mutation.reduce("patch", rosterConfiguration,
    East.function([WarehouseConfig, PatchType(WarehouseConfig)], WarehouseConfig, (_$, configuration, patch) => East.applyPatch(configuration, patch)));
/** The proposals' door: another session's edit of them, a patch of the one list they are. */
export const rosterProposalsPatch = e3.mutation.reduce("patch", rosterProposals,
    East.function([ArrayType(Roster.Types.Proposal), PatchType(ArrayType(Roster.Types.Proposal))], ArrayType(Roster.Types.Proposal),
        (_$, proposals, patch) => East.applyPatch(proposals, patch)));

/** The weeks of a roster the warehouse has locked: the warehouse's own weeks, which no Save changes. */
export const rosterLockedWeeks = e3.record("roster_locked_weeks", Roster.Types.Weeks, warehouseWeeks);
/** The locked roster's door, a checked one: it refuses every change, naming why — what a Save over it is answered. */
export const rosterLockedWeeksPatch = e3.mutation.reduce("patch", rosterLockedWeeks,
    East.function([Roster.Types.Weeks, PatchType(Roster.Types.Weeks)], Roster.Types.Weeks, ($, weeks, _patch) => {
        $.error("the roster is locked for the week");
        return weeks;
    }));

/**
 * Another app's fit over the same staff: the warehouse's order — the most spare contract hours first, whatever
 * their group — and a warning on whoever the slot's shift would take past their contract.
 */
export const rosterContractFitBody = East.function([Roster.Types.FitRequest], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer);
    const rule = $.const(Roster.fit);
    const weekHours = $.const(Roster.weekHours);
    const hours = $.const(weekHours(req.week, req.context));
    // What the slot's shift adds to a person's week.
    const shifts = $.const(req.context.shifts.toDict((_$2, shift) => shift.key, (_$2, shift) => shift.hours));
    const shift = $.const(shifts.get(req.slot.shift, () => 0.0));
    return answer(req, East.function([Roster.Types.FitRequest, Roster.Types.Person], Roster.Types.Fit, ($2, request, person) => {
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
    inputs: [], description: 'The mock warehouse roster: 69 bound staff, three groups and three shifts, live configuration and proposals, one Slice.bindRecords rail over the staff and activities records that the People and Activities tabs follow, a Positions tab, typed inspector, whole-week Save and Publish, and the warehouse\'s greedy fit on e3, which a Find fix asks who fits.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "Func.bind", "e3.function", "fit", "Find", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterWarehouse", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        // The app's fit: a Find fix asks it who fits, over every person, and the People tab shows its answer.
        const staffFit = $.let(Func.bind(rosterStaffFit));
        return <Box width="100%" height="760px"><Roster id="rosterWarehouse" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }} fit={staffFit}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterMobile = example({
    inputs: [], description: 'The warehouse roster in a phone-width container: explicit Assign, Move, Edit, Remove, Restore, Request, Accept, Reject and target actions. The same session survives resizing; mobile cards register no drag sources or targets.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterMobile", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        return <Box width="100%" maxWidth="390px" height="760px"><Roster id="rosterMobile" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterPeople = example({
    inputs: [], description: 'Weekly people layout over the same records: each person retains their original key, contract hours and daily shifts, with a separate agency-requests row.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterPeople", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        return <Box width="100%" height="760px"><Roster id="rosterPeople" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "people", period: "week", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterWeek = example({
    inputs: [], description: 'Seven days of group-by-shift coverage, opening any day for detailed staffing.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterWeek", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        return <Box width="100%" height="760px"><Roster id="rosterWeek" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "week", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterWindowed = example({
    inputs: [], description: 'A bounded history window using Data.bindPaged on the same weeks record. The roster\'s own navigation and its picker choose the week; only that week, the previous copy source and the open picker month are requested.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Data.bindPaged", "history", "BuilderFrame", "Save", "Publish"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const acts = $.let(Data.bind(rosterActivities));
        // The week history is paged: the roster reads the open week, the week before it and the open picker's month.
        const history = $.let(Data.bindPaged(rosterWeeks));
        return <Box width="100%" height="760px"><Roster id="rosterWindowed" weeks={weeks} window={history}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-12T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterMinimal = example({
    inputs: [], description: 'A minimal roster without a library or inspector pane. Explicit assignment actions and forecast targets still use the shared week session.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterMinimal", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        return <Box width="100%" height="760px"><Roster id="rosterMinimal" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-12T00:00:00Z") }}
 />
        </Box>;
    }}</Reactive>),
});

export const rosterPublished = example({
    inputs: [], description: 'The previous published roster is read-only: navigation, staff filtering, coverage and inspection remain available.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterPublished", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        return <Box width="100%" height="760px"><Roster id="rosterPublished" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-02T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterCustomInspector = example({
    inputs: [], description: 'Typed author assignment and requirement forms replace the built-in fields while preserving the shared headers, coverage, actions and undo history.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Roster.activities", "Slice", "Slice.bindRecords", "Data.bindPaged", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        // Every person and activity is the calculation scope; the narrowing only chooses which show (#1342).
        const acts = $.let(Data.bind(rosterActivities));
        const people = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffByPosition, rosterStaffByTrainer, rosterStaffByAgency, rosterStaffBySkill, rosterStaffByName] }));
        const activities = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.rosterCustomInspector", {
            people: { source: people, icon: { prefix: "fas", name: "user" }, search: ["name", "skills"],
                fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, position: { label: "Position", hints: ["lead", "deputy", "acting", "crew"] },
                    trainer: { label: "Trainer" }, agency: { label: "Agency" }, skills: { label: "Skill" }, name: { label: "Name" } } },
            activities: { source: activities, icon: { prefix: "fas", name: "list-check" }, fields: { group: { label: "Group", hints: ["inbound", "picking", "dispatch", null] } } },
        }, { presets: [{ id: "leads", name: "Leads", where: { people: { position: ["lead", "deputy", "acting"] } } }] }));
        const assignment = $.const(East.function([Roster.Types.Assignment, FunctionType([Roster.Types.Assignment], NullType)], UIComponentType, (_$2, row, update) =>
            <VStack><Field.FloatInput label="Custom overtime" value={row.overtime} min={0} max={4} step={0.5} onChange={(_$3, value) => update({ slot: row.slot, who: row.who, position: row.position, activity: row.activity, offset: row.offset, overtime: value, agreed: row.agreed })} /></VStack>));
        const requirement = $.const(East.function([Roster.Types.Requirement, FunctionType([Roster.Types.Requirement], NullType)], UIComponentType, (_$2, row, update) =>
            <Field.IntegerInput label="Custom positions" value={row.positions} min={0n} step={1n} onChange={(_$3, value) => update({ positions: value, hours: row.hours })} />));
        return <Box width="100%" height="760px"><Roster id="rosterCustomInspector" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector={{ assignment, requirement }} />
        </Box>;
    }}</Reactive>),
});
