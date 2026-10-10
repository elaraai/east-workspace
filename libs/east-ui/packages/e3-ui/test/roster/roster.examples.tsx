/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FunctionType, NullType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Field, Reactive, Slice, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Record, Roster } from "@elaraai/e3-ui";
import { StaffScope, WarehouseConfig, WarehousePerson, warehouseConfig, warehouseForecast, warehousePeople, warehouseProposals, warehouseWeeks } from "./warehouse.js";

export const rosterWeeks = e3.record("roster_weeks", Roster.Types.Weeks, warehouseWeeks);
export const rosterWeeksPatch = e3.mutation.patch(rosterWeeks);
export const rosterStaff = e3.record("roster_staff", DictType(StringType, WarehousePerson), warehousePeople);
export const rosterConfiguration = e3.record("roster_configuration", WarehouseConfig, warehouseConfig);
export const rosterForecast = e3.record("roster_forecast", DictType(DateTimeType, Roster.Types.Requirements), warehouseForecast);
export const rosterProposals = e3.record("roster_proposals", ArrayType(Roster.Types.Proposal), warehouseProposals);

export const rosterWarehouse = example({
    inputs: [], description: 'The mock warehouse roster: 69 bound staff, three groups and three shifts, live configuration and proposals, a People/Activities/Positions library, shared Slice filtering, typed inspector, and whole-week Save and Publish.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterWarehouse.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        return <Box width="100%" height="760px"><Roster id="rosterWarehouse" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
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
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterMobile.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        return <Box width="100%" maxWidth="390px" height="760px"><Roster id="rosterMobile" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
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
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterPeople.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        return <Box width="100%" height="760px"><Roster id="rosterPeople" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
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
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterWeek.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        return <Box width="100%" height="760px"><Roster id="rosterWeek" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "week", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterWindowed = example({
    inputs: [], description: 'A bounded history window using Data.bindPaged on the same weeks record. The author-bound Slice range and roster navigation choose the same week. Only that week, the previous copy source and the open picker month are requested.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const history = $.let(Data.bindPaged(rosterWeeks));
        const WeekKey = StructType({ week: DateTimeType });
        const first = $.const(new Date("2028-03-12T00:00:00Z"), DateTimeType);
        const scope = Slice.config(WeekKey, { fields: { week: { label: "Week", format: { date: "MMM D" } } }, rangeFieldId: "week" });
        // A bounded horizon of keys, independent of the record's rows and history.
        const horizon = $.let(East.Array.generate(13n, WeekKey, (_$2, i) => ({ week: first.addDays(i.subtract(6n).multiply(7n)) })));
        const slice = $.let(Slice.bind([WeekKey], "ex.rosterWindowed.weeks", scope, Slice.state({
            range: some(variant("datetime", { from: first, to: first.addDays(7n).addMilliseconds(-1n) })),
        }), horizon, none));
        return <Box width="100%" height="760px"><Roster id="rosterWindowed" weeks={weeks} window={history}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            slice={{ slice, affordances: ["range"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
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
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterMinimal.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        return <Box width="100%" height="760px"><Roster id="rosterMinimal" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-12T00:00:00Z") }}
 />
        </Box>;
    }}</Reactive>),
});

export const rosterPublished = example({
    inputs: [], description: 'The previous published roster is read-only: navigation, staff filtering, coverage and inspection remain available.',
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterPublished.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        return <Box width="100%" height="760px"><Roster id="rosterPublished" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
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
    keywords: ["Roster", "Record.bind", "Roster.people", "Slice", "Slice.bind", "Slice.rows", "BuilderFrame", "mobile", "Save", "Publish", "FieldForm"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
        const staff = $.let(Data.bind(rosterStaff));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        const rows = $.let(staff.read().toArray((_$2, person, key) => ({ key, name: person.name, team: person.team, position: person.position, agency: person.agency, trainer: person.trainer })));
        const scope = Slice.config(StaffScope, {
            fields: { name: { label: "Name" }, team: { label: "Group" }, position: { label: "Position" }, agency: { label: "Agency" }, trainer: { label: "Trainer" } },
            searchFieldIds: ["name", "team", "position"],
        });
        const slice = $.let(Slice.bind([StaffScope], "ex.rosterCustomInspector.scope", scope, Slice.state({}), rows, none));
        const visible = $.let(Slice.rows([StaffScope], slice).toSet((_$2, person) => person.key));
        const assignment = $.const(East.function([Roster.Types.Assignment, FunctionType([Roster.Types.Assignment], NullType)], UIComponentType, (_$2, row, update) =>
            <VStack><Field.FloatInput label="Custom overtime" value={row.overtime} min={0} max={4} step={0.5} onChange={(_$3, value) => update({ slot: row.slot, who: row.who, position: row.position, activity: row.activity, offset: row.offset, overtime: value, agreed: row.agreed })} /></VStack>));
        const requirement = $.const(East.function([Roster.Types.Requirement, FunctionType([Roster.Types.Requirement], NullType)], UIComponentType, (_$2, row, update) =>
            <Field.IntegerInput label="Custom positions" value={row.positions} min={0n} step={1n} onChange={(_$3, value) => update({ positions: value, hours: row.hours })} />));
        return <Box width="100%" height="760px"><Roster id="rosterCustomInspector" weeks={weeks}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
                contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={visible} slice={{ slice, affordances: ["filter", "search"] }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(cfg.positions, {
                name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code), drop: (_p, key) => Roster.patch({ position: key }),
            })]} inspector={{ assignment, requirement }} />
        </Box>;
    }}</Reactive>),
});
