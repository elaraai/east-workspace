/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import { DateTimeType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Box, HStack, Reactive, Select, Slice, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Calendar, Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** One of a print works' crew: the press they run. */
export const PressCrewMember = StructType({ name: StringType, press: StringType });
/** A run on a press: the crew member it is on, and its times — none while it waits in the press's backlog. */
export const PressRun = StructType({ title: StringType, press: StringType, crew: OptionType(StringType), start: OptionType(DateTimeType), end: OptionType(DateTimeType),
    hours: FloatType, due: OptionType(DateTimeType) });
/** What a template gives a run made from it: every field a drop does not place, its press among them. */
export const PressRunValues = StructType({ title: StringType, press: StringType, hours: FloatType, due: OptionType(DateTimeType) });
/** A run template, which every press's page offers: its press is left empty, for the page a run is made on to give. */
export const PressRunTemplate = StructType({ name: StringType, group: StringType, hours: FloatType, values: PressRunValues });

export const pressCrew = e3.record("press_crew", DictType(StringType, PressCrewMember), {
    initial: new Map([
        ["c1", { name: "A. Alder", press: "P-1" }], ["c2", { name: "B. Birch", press: "P-1" }],
        ["c3", { name: "C. Cedar", press: "P-2" }], ["c4", { name: "D. Dunn", press: "P-2" }],
    ]),
    indexes: (index) => ({
        // A press's page reads its crew through the press: the scope's field leads.
        press_crew_by_press: index.on(["press"]),
    }),
});
export const pressRuns = e3.record("press_runs", DictType(StringType, PressRun), {
    initial: new Map([
        ["r1", { title: "Catalogue covers", press: "P-1", crew: some("c1"), start: some(new Date("2026-10-01T06:00:00Z")), end: some(new Date("2026-10-01T10:00:00Z")), hours: 4.0, due: none }],
        ["r2", { title: "Annual report", press: "P-1", crew: some("c2"), start: some(new Date("2026-10-01T09:00:00Z")), end: some(new Date("2026-10-01T14:00:00Z")), hours: 5.0, due: none }],
        ["r3", { title: "Letterheads", press: "P-1", crew: some("c1"), start: some(new Date("2026-10-02T06:00:00Z")), end: some(new Date("2026-10-02T08:00:00Z")), hours: 2.0, due: none }],
        ["r4", { title: "Menu cards", press: "P-2", crew: some("c3"), start: some(new Date("2026-10-01T07:00:00Z")), end: some(new Date("2026-10-01T09:00:00Z")), hours: 2.0, due: none }],
        ["r5", { title: "Posters", press: "P-2", crew: some("c4"), start: some(new Date("2026-10-02T08:00:00Z")), end: some(new Date("2026-10-02T12:00:00Z")), hours: 4.0, due: none }],
        ["r6", { title: "Flyers", press: "P-1", crew: none, start: none, end: none, hours: 2.0, due: some(new Date("2026-10-03T00:00:00Z")) }],
        ["r7", { title: "Order forms", press: "P-1", crew: none, start: none, end: none, hours: 1.5, due: none }],
        ["r8", { title: "Labels", press: "P-2", crew: none, start: none, end: none, hours: 3.0, due: some(new Date("2026-10-05T00:00:00Z")) }],
    ]),
    indexes: (index) => ({
        // A press's page reads its runs through the press and the dates in view together: the scope's field first. A run
        // with no start stays selectable, so the press's backlog is read through it too.
        press_runs_by_press_time: index.interval({ on: ["press"], from: "start", to: "end" }),
        // And a choice of crew member beside the press: the scope's field first, then the rail's.
        press_runs_by_press_crew_time: index.interval({ on: ["press", "crew"], from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
export const pressRunTemplates = e3.record("press_run_templates", DictType(StringType, PressRunTemplate), {
    initial: new Map([
        ["flyers", { name: "Flyer run", group: "Short runs", hours: 2.0, values: { title: "Flyer run", press: "", hours: 2.0, due: none } }],
        ["section", { name: "Book section", group: "Long runs", hours: 6.0, values: { title: "Book section", press: "", hours: 6.0, due: none } }],
    ]),
    indexes: (index) => ({
        press_run_templates_by_group: index.on(["group"]),
    }),
});

export const calendarScoped = example({
    inputs: [],
    description: "A press's own page: the Calendar's sources scoped to the press the page is for (`scope`, beside `initial`), a narrowing the page holds and the viewer cannot clear. Every read of each source carries it — the runs in the dates in view, the press's backlog and its count, and the crew whose rows the runs sit on — through an index the scope's field leads; the rail offers no control of the press, and Clear all leaves it. A run made on the page takes its press from the scope and its crew member from the row it is dropped on. The page's parameter is chosen above it, and each press is its own page.",
    keywords: ["Calendar", "Slice.bindRecords", "scope", "page parameter", "a press's page", "narrowing", "Clear all", "index.interval", "on", "index.on", "backlog", "templates", "Record.bind", "Data.bindPaged", "State", "Select"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        // The page's parameter: the press it is for, which an app's page takes from its route — chosen here.
        const chosen = $.let(State.bind([StringType], "ex.calendarScoped.press", "P-1"));
        const press = $.let(chosen.read());
        const onPress = $.const(East.function([StringType], NullType, ($, next) => { $(chosen.write(next)); }));
        const crew = $.let(Data.bind(pressCrew));
        const runs = $.let(Record.bind(pressRuns));
        const templates = $.let(Data.bind(pressRunTemplates));
        const runIndex = $.let(Data.bindPaged(pressRuns, { indexes: ["press_runs_by_press_time", "press_runs_by_press_crew_time"] }));
        const crewIndex = $.let(Data.bindPaged(pressCrew, { indexes: ["press_crew_by_press"] }));
        const templateIndex = $.let(Data.bindPaged(pressRunTemplates, { indexes: ["press_run_templates_by_group"] }));
        const runEntries = $.let(Data.bindPaged(pressRuns));
        // The runs and the crew scoped to the press, a list of exact values each of its field's type: the runs' read
        // together with the dates the navigation writes and a choice of crew member. The templates, which every press
        // offers, are not. Each press's page keeps its own choices.
        const slice = $.let(Slice.bindRecords(East.str`ex.calendarScoped.${press}`, {
            run: { source: runIndex, icon: { prefix: "fas", name: "print" }, scope: { press: [press] }, range: "start",
                fields: { crew: { label: "Crew", hints: ["c1", "c2", "c3", "c4", null] }, start: { label: "Dates" } } },
            crew: { source: crewIndex, icon: { prefix: "fas", name: "users" }, scope: { press: [press] } },
            runTemplates: { source: templateIndex, icon: { prefix: "fas", name: "layer-group" },
                fields: { group: { label: "Template", hints: ["Short runs", "Long runs"] } } },
        }));
        return <VStack gap="3" align="stretch" width="100%">
            <HStack gap="2" align="center"><Text>Press</Text><Select value={press} onChange={onPress}
                items={[Select.Item("P-1", "Press 1"), Select.Item("P-2", "Press 2")]} /></HStack>
            <Box height="620px"><Calendar id="calendarScoped" view={{ date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
                slice={{ slice }}
                resources={{ crew: Calendar.resources(crew.read(), { name: "Crew", icon: "users", label: row => row.name }) }}
                events={{
                    run: Calendar.events(runs, { name: "Run", icon: "print", title: "title", start: "start", end: "end", resource: { field: "crew", of: "crew" },
                        entries: runEntries,
                        backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
                        templates: Calendar.templates(templates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "runTemplates" }),
                    }),
                }}
                library={[Calendar.library.templates(), Calendar.library.backlog()]} />
            </Box>
        </VStack>;
    }}</Reactive>),
});
