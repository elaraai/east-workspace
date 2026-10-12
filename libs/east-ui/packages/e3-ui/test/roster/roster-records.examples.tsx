/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { DateTimeType, East, SortedMap, compareFor, example } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Roster } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";
import { rosterWeeks as warehouseWeeks, rosterStaff as warehouseStaff, rosterConfiguration, rosterForecast, rosterProposals } from "./roster.examples.js";

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

/** Ten years of weekly records; navigation still requests only its active window. */
function weekSeed() {
    const weeks = new SortedMap(warehouseWeeks.default, compareFor(DateTimeType));
    const originals = [...weeks.values()];
    const first = weeks.keys().next().value!;
    for (let i = 0; weeks.size < 520; i++) {
        const day = new Date(first.getTime() - (i + 1) * 7 * 86400000);
        weeks.set(day, originals[i % originals.length]!);
    }
    return weeks;
}

export const indexedRosterWeeks = e3.record("indexed_roster_weeks", warehouseWeeks.type, weekSeed());
export const indexedRosterWeeksPatch = e3.mutation.patch(indexedRosterWeeks);
export const indexedRosterStaff = e3.record("indexed_roster_staff", warehouseStaff.type, staffSeed());

export const rosterStaffByName = e3.recordIndex("staff_by_name", indexedRosterStaff, { on: ["name"] });
export const rosterStaffByTeam = e3.recordIndex("staff_by_team_name", indexedRosterStaff, { on: ["team", "name"] });
export const rosterStaffByTrainer = e3.recordIndex("staff_by_trainer", indexedRosterStaff, { on: ["trainer"] });
export const rosterStaffBySkill = e3.recordIndex("staff_by_skill", indexedRosterStaff, { on: ["skills"] });

export const rosterRecordIndexes = example({
    description: "500 staff and 520 weeks of history. Indexed staff narrowing retains full-staff coverage, costs and rules. Week history is paged; hidden assignment edits Save by the original week key.",
    keywords: ["Roster", "Slice", "bindRecord", "records", "indexes", "paging", "mobile"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(indexedRosterWeeks, [indexedRosterWeeksPatch]));
        const history = $.let(Data.bindPaged(indexedRosterWeeks));
        // Complete staff is the calculation context; visibility is a separate indexed query.
        const staff = $.let(Data.bind(indexedRosterStaff));
        const indexed = $.let(Data.bindPaged(indexedRosterStaff, { indexes: [rosterStaffByName, rosterStaffByTeam, rosterStaffByTrainer, rosterStaffBySkill] }));
        const slice = $.let(Slice.bindRecord("ex.rosterRecordIndexes.scope", indexed, {
            fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, name: { label: "Name" }, trainer: { label: "Trainer" }, skills: { label: "Skills" } },
            search: ["name", "skills"], initial: { team: ["inbound"] },
            presets: [{ id: "trainers", name: "Trainers", where: { trainer: [true] } }],
        }));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        return <Box width="100%"  height="760px"><Roster id="rosterRecordIndexes" weeks={weeks} window={history}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position,
                skills: p => p.skills, contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer,
                trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={Slice.rows(slice)} slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities()]} inspector />
        </Box>;
    }}</Reactive>),
});

export const rosterRecordIndexesMobile = example({
    description: "Phone roster with shared indexed staff controls and explicit actions; weekly drafts survive filtering.",
    keywords: ["Roster", "Slice", "bindRecord", "records", "indexes", "paging", "mobile"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const weeks = $.let(Record.bind(indexedRosterWeeks, [indexedRosterWeeksPatch]));
        const history = $.let(Data.bindPaged(indexedRosterWeeks));
        // Complete staff is the calculation context; visibility is a separate indexed query.
        const staff = $.let(Data.bind(indexedRosterStaff));
        const indexed = $.let(Data.bindPaged(indexedRosterStaff, { indexes: [rosterStaffByName, rosterStaffByTeam, rosterStaffByTrainer, rosterStaffBySkill] }));
        const slice = $.let(Slice.bindRecord("ex.rosterRecordIndexesMobile.scope", indexed, {
            fields: { team: { label: "Group", hints: ["inbound", "picking", "dispatch"] }, name: { label: "Name" }, trainer: { label: "Trainer" }, skills: { label: "Skills" } },
            search: ["name", "skills"], initial: { team: ["inbound"] },
            presets: [{ id: "trainers", name: "Trainers", where: { trainer: [true] } }],
        }));
        const configuration = $.let(Data.bind(rosterConfiguration));
        const forecast = $.let(Data.bind(rosterForecast));
        const proposals = $.let(Data.bind(rosterProposals));
        const cfg = $.const(configuration.read());
        return <Box width="100%" maxWidth="390px" height="760px"><Roster id="rosterRecordIndexesMobile" weeks={weeks} window={history}
            people={Roster.people(staff.read(), { name: p => p.name, group: p => p.team, position: p => p.position,
                skills: p => p.skills, contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer,
                trainee: p => p.trainee, usual: p => p.usual })}
            visiblePeople={Slice.rows(slice)} slice={{ slice }}
            groups={cfg.groups} shifts={cfg.shifts} duties={cfg.duties} positions={cfg.positions.toArray((_$2, p) => p)} agencies={cfg.agencies}
            rules={cfg.rules} costs={cfg.costs} forecast={forecast.read()} proposals={proposals.read()}
            week={{ start: "sunday" }} view={{ layout: "shifts", period: "day", date: new Date("2028-03-09T00:00:00Z") }}
            library={[Roster.library.people(), Roster.library.activities()]} inspector />
        </Box>;
    }}</Reactive>),
});
