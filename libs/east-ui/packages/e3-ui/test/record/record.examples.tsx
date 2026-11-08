/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Record (`Record - DX Proposal.md` §3): the table for a system of
 * records, and its columns from data (`Record Columns From Data - DX
 * Proposal.md` §2). Each example is the proposal's, whole: the record, its
 * binding, the Record.
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    example, none, some, variant,
} from "@elaraai/east";
import { Box, Configurator, Reactive, SegmentGroup, Slice, State, StatusValueType, Style, Text, UIComponentType } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// Example 1 — the least: a title, a toggle and a cycle
// ============================================================================

export const Crew = StructType({ name: StringType, inducted: BooleanType, forklift: StringType });
export const recordCrew = e3.record("record_crew", DictType(StringType, Crew), {
    initial: new Map([
        ["C-001", { name: "A. Morgan", inducted: true, forklift: "2" }],
        ["C-002", { name: "B. Ellis", inducted: false, forklift: "0" }],
        ["C-003", { name: "C. Patel", inducted: true, forklift: "1" }],
    ]),
    mutations: (mutation) => ({
        // The crew's patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordBasic = example({
    keywords: ["Record", "Record.column.title", "Record.column.toggle", "Record.column.cycle", "register", "scale", "system of records"],
    description: "The least a Record takes: a record bound with its patch door, a title, a toggle on a Boolean and a cycle over a register's members, stepped by a click",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const members = $.let(Record.bind(recordCrew));
            const LevelType = StructType({ key: StringType, name: StringType });
            const levels = $.let([
                { key: "0", name: "Not trained" },
                { key: "1", name: "Supervised" },
                { key: "2", name: "Competent" },
            ], ArrayType(LevelType));
            return (
                <Box height="360px">
                    <Record
                        record={members}
                        title="Crew"
                        noun={{ singular: "crew member", plural: "crew members" }}
                        registers={{ levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }) }}
                        columns={{
                            name:     Record.column.title(Crew, { header: "Name", width: "160px" }),
                            inducted: Record.column.toggle(Crew, { header: "Inducted", width: "80px", on: "yes", off: "no" }),
                            forklift: Record.column.cycle(Crew, "levels", { header: "Forklift", width: "72px", scale: true }),
                        }}
                        name="recordBasic"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 2 — the designer's 1a: a skills matrix
// ============================================================================

export const Skills = StructType({
    name: StringType, role: StringType,
    intake: StringType, review: StringType, dispatch: StringType, handover: StringType,
    scanner: StringType, console: StringType, reports: StringType,
    auditing: StringType, training: StringType, planning: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordSkills = e3.record("record_skills", DictType(StringType, Skills), {
    initial: new Map([
        ["P-0401", { name: "A. Morgan", role: "Operator", intake: "2", review: "2", dispatch: "2", handover: "2", scanner: "1", console: "1",
            reports: "0", auditing: "0", training: "0", planning: "0", updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }) }],
        ["P-0408", { name: "B. Ellis", role: "Operator", intake: "0", review: "0", dispatch: "0", handover: "0", scanner: "0", console: "0",
            reports: "0", auditing: "2", training: "2", planning: "2", updated: some({ at: new Date("2026-10-17T14:40:00Z"), by: "S. Park", verb: "changed" }) }],
        ["P-0415", { name: "C. Patel", role: "Contractor", intake: "2", review: "1", dispatch: "1", handover: "1", scanner: "0", console: "0",
            reports: "0", auditing: "0", training: "0", planning: "0", updated: some({ at: new Date("2026-11-02T11:05:00Z"), by: "J. Ortiz", verb: "changed" }) }],
        ["P-0450", { name: "H. Kim", role: "Operator", intake: "1", review: "0", dispatch: "1", handover: "0", scanner: "2", console: "2",
            reports: "2", auditing: "0", training: "0", planning: "0", updated: some({ at: new Date("2026-07-10T08:30:00Z"), by: "A. Rowe", verb: "changed" }) }],
        ["P-0520", { name: "V. Lowe", role: "Team lead", intake: "2", review: "2", dispatch: "1", handover: "0", scanner: "0", console: "1",
            reports: "1", auditing: "1", training: "1", planning: "1", updated: some({ at: new Date("2026-11-03T16:20:00Z"), by: "M. Hale", verb: "changed" }) }],
    ]),
    indexes: (index) => ({
        // What the rail searches and filters by.
        record_skills_by_name: index.on(["name"]),
        record_skills_by_role: index.on(["role"]),
    }),
    mutations: (mutation) => ({
        // The people's patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordSkillsMatrix = example({
    keywords: ["Record", "skills matrix", "Record.column.cycle", "scale", "columnGroups", "Record.column.age", "Record.column.audit", "Record.Types.Change", "stale", "slice"],
    description: "The designer's skills matrix: ten cycle columns on the heat ramp under three column groups, the rail searching names and roles and filtering by role, the age warning past 90 days and the last change in blame mode",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const people = $.let(Record.bind(recordSkills));
            const slice = $.let(Slice.bindRecords("record.skills", {
                rows: {
                    source: Data.bindPaged(recordSkills, { indexes: ["record_skills_by_name", "record_skills_by_role"] }),
                    label: "People",
                    fields: { name: { label: "Name" }, role: { label: "Role", hints: ["Operator", "Contractor", "Team lead"] } },
                    search: ["name", "role"],
                },
            }));
            const LevelType = StructType({ key: StringType, name: StringType });
            const levels = $.let([
                { key: "0", name: "Not trained" },
                { key: "1", name: "Supervised" },
                { key: "2", name: "Competent" },
            ], ArrayType(LevelType));
            const roles = $.let(["Operator", "Contractor", "Team lead"], ArrayType(StringType));
            return (
                <Box height="760px">
                    <Record
                        slice={{ slice }}
                        title="Skills matrix"
                        noun={{ singular: "person", plural: "people" }}
                        registers={{
                            levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }),
                            roles:  Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                        }}
                        columns={{
                            name:       Record.column.title(Skills, { header: "Name", width: "156px" }),
                            role:       Record.column.reference(Skills, "roles", { header: "Role", width: "136px" }),
                            intake:     Record.column.cycle(Skills, "levels", { header: "Intake", width: "72px", scale: true }),
                            review:     Record.column.cycle(Skills, "levels", { header: "Review", width: "72px", scale: true }),
                            dispatch:   Record.column.cycle(Skills, "levels", { header: "Dispatch", width: "72px", scale: true }),
                            handover:   Record.column.cycle(Skills, "levels", { header: "Handover to next shift", width: "72px", scale: true }),
                            scanner:    Record.column.cycle(Skills, "levels", { header: "Scanner", width: "72px", scale: true }),
                            console:    Record.column.cycle(Skills, "levels", { header: "Console", width: "72px", scale: true }),
                            reports:    Record.column.cycle(Skills, "levels", { header: "Reports", width: "72px", scale: true }),
                            auditing:   Record.column.cycle(Skills, "levels", { header: "Auditing", width: "72px", scale: true }),
                            training:   Record.column.cycle(Skills, "levels", { header: "Training", width: "72px", scale: true }),
                            planning:   Record.column.cycle(Skills, "levels", { header: "Planning", width: "72px", scale: true }),
                            days_since: Record.column.age(Skills, { header: "Days since", width: "92px", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
                            updated:    Record.column.audit(Skills, { header: "Last updated", width: "264px", mode: "blame" }),
                        }}
                        columnGroups={[
                            { label: "Core", columnKeys: ["intake", "review", "dispatch", "handover"] },
                            { label: "Tools", columnKeys: ["scanner", "console", "reports"] },
                            { label: "Advanced", columnKeys: ["auditing", "training", "planning"] },
                        ]}
                        inspector
                        onApply={Record.onApply(people, { keyed: true })}
                        name="skills"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 3 — the designer's 1b: shift preferences
// ============================================================================

export const Preferences = StructType({
    name: StringType, role: StringType,
    days: StringType, afternoon: StringType, nights: StringType, sat: StringType, sun: StringType, overtime: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordPreferences = e3.record("record_preferences", DictType(StringType, Preferences), {
    initial: new Map([
        ["P-0401", { name: "A. Morgan", role: "Operator", days: "prefer", afternoon: "can", nights: "can", sat: "can", sun: "can", overtime: "prefer",
            updated: some({ at: new Date("2026-10-21T10:15:00Z"), by: "K. Lund", verb: "changed" }) }],
        ["P-0415", { name: "C. Patel", role: "Contractor", days: "can", afternoon: "prefer", nights: "cannot", sat: "prefer", sun: "cannot", overtime: "can",
            updated: some({ at: new Date("2026-10-24T13:02:00Z"), by: "S. Park", verb: "changed" }) }],
        ["P-0422", { name: "D. Novak", role: "Operator", days: "prefer", afternoon: "can", nights: "can", sat: "can", sun: "can", overtime: "can",
            updated: some({ at: new Date("2026-05-13T09:41:00Z"), by: "S. Park", verb: "changed" }) }],
    ]),
    mutations: (mutation) => ({
        // The preferences' patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordShiftPreferences = example({
    keywords: ["Record", "shift preferences", "Record.column.cycle", "tone", "aliases", "avatar", "columnGroups", "Record.column.audit"],
    description: "The designer's shift preferences: cycles over a register whose members carry a tone and a digit alias, titles with their initials, three column groups one unlabelled, and the last change in date mode",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const people = $.let(Record.bind(recordPreferences));
            const ChoiceType = StructType({ key: StringType, label: StringType, name: StringType, aliases: ArrayType(StringType), tone: StatusValueType });
            const choices = $.let([
                { key: "can",    label: "can",    name: "Can work",   aliases: ["1"], tone: variant("neutral", null) },
                { key: "prefer", label: "prefer", name: "Prefers",    aliases: ["2"], tone: variant("success", null) },
                { key: "cannot", label: "can't",  name: "Can't work", aliases: ["3"], tone: variant("danger", null) },
            ], ArrayType(ChoiceType));
            const roles = $.let(["Operator", "Contractor"], ArrayType(StringType));
            return (
                <Box height="720px">
                    <Record
                        record={people}
                        title="Shift preferences"
                        noun={{ singular: "person", plural: "people" }}
                        registers={{
                            choices: Record.register.members(choices, { kind: "choice", key: c => c.key, label: c => c.label, meta: c => some(c.name),
                                aliases: c => c.aliases, tone: c => some(c.tone) }),
                            roles: Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                        }}
                        columns={{
                            name:       Record.column.title(Preferences, { header: "Name", width: "176px", avatar: true }),
                            role:       Record.column.reference(Preferences, "roles", { header: "Role", width: "136px" }),
                            days:       Record.column.cycle(Preferences, "choices", { header: "Days", width: "80px" }),
                            afternoon:  Record.column.cycle(Preferences, "choices", { header: "Afternoon", width: "80px" }),
                            nights:     Record.column.cycle(Preferences, "choices", { header: "Nights", width: "80px" }),
                            sat:        Record.column.cycle(Preferences, "choices", { header: "Sat", width: "80px" }),
                            sun:        Record.column.cycle(Preferences, "choices", { header: "Sun", width: "80px" }),
                            overtime:   Record.column.cycle(Preferences, "choices", { header: "Overtime", width: "80px" }),
                            days_since: Record.column.age(Preferences, { header: "Days since", width: "92px", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
                            updated:    Record.column.audit(Preferences, { header: "Last updated", width: "136px" }),
                        }}
                        columnGroups={[
                            { label: "Shifts", columnKeys: ["days", "afternoon", "nights"] },
                            { label: "Weekends", columnKeys: ["sat", "sun"] },
                            { label: "", columnKeys: ["overtime"] },
                        ]}
                        inspector
                        name="preferences"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 4 — every kind (1c)
// ============================================================================

export const Operator = StructType({
    name: StringType, badge: StringType, notes: StringType, shifts: IntegerType, hours: FloatType,
    started: OptionType(DateTimeType), status: StringType, role: StringType, certificates: Record.Types.Link,
    inducted: BooleanType, supervisor: OptionType(StringType), night: BooleanType, preference: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordOperators = e3.record("record_operators", DictType(StringType, Operator), {
    initial: new Map([
        ["P-0401", { name: "A. Morgan", badge: "EXT-88213", notes: "Prefers day shifts through March", shifts: 1482n, hours: 38.5,
            started: some(new Date("2026-09-18T00:00:00Z")), status: "active", role: "Operator",
            certificates: { from: [], to: [variant("identified", { key: "Forklift" }), variant("identified", { key: "Confined space" })] },
            inducted: true, supervisor: some("S. Park"), night: false, preference: "prefer",
            updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }) }],
        ["P-0408", { name: "B. Ellis", badge: "EXT-88240", notes: "", shifts: 96n, hours: 12.0,
            started: none, status: "leave", role: "Contractor", certificates: { from: [], to: [] },
            inducted: false, supervisor: none, night: true, preference: "can", updated: none }],
    ]),
    mutations: (mutation) => ({
        // The operators' patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordEveryKind = example({
    keywords: ["Record", "column kinds", "Record.column.person", "Record.column.boolean", "Record.column.stamped", "Record.column.set", "Record.column.quantity", "unit", "avatar"],
    description: "Every kind a Record draws, as the cell-kind catalogue does: text, stamped, integer, a quantity with its unit, date, enum, reference, set, boolean, title, person, toggle and cycle, with an age and the last change",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const records = $.let(Record.bind(recordOperators));
            const StatusType = StructType({ key: StringType, label: StringType, tone: StatusValueType });
            const statuses = $.let([
                { key: "active", label: "Active",   tone: variant("success", null) },
                { key: "leave",  label: "On leave", tone: variant("warning", null) },
                { key: "left",   label: "Left",     tone: variant("neutral", null) },
            ], ArrayType(StatusType));
            const roles = $.let(["Operator", "Contractor", "Team lead"], ArrayType(StringType));
            const certificates = $.let(["Forklift", "Confined space", "First aid", "Working at height"], ArrayType(StringType));
            const supervisors = $.let(["S. Park", "M. Hale", "J. Ortiz"], ArrayType(StringType));
            const ChoiceType = StructType({ key: StringType, label: StringType, name: StringType, tone: StatusValueType });
            const choices = $.let([
                { key: "can",    label: "can",    name: "Can work",   tone: variant("neutral", null) },
                { key: "prefer", label: "prefer", name: "Prefers",    tone: variant("success", null) },
                { key: "cannot", label: "can't",  name: "Can't work", tone: variant("danger", null) },
            ], ArrayType(ChoiceType));
            return (
                <Box height="480px">
                    <Record
                        record={records}
                        title="Operators"
                        noun={{ singular: "operator", plural: "operators" }}
                        // The operators and their badges come from the Gatehouse: this Record edits them, and adds none.
                        edits={{ insertRows: false }}
                        registers={{
                            statuses:     Record.register.members(statuses, { kind: "status", key: s => s.key, label: s => s.label, tone: s => some(s.tone) }),
                            roles:        Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                            certificates: Record.register.members(certificates, { kind: "certificate", key: c => c, label: c => c }),
                            supervisors:  Record.register.members(supervisors, { kind: "person", key: p => p, label: p => p }),
                            choices:      Record.register.members(choices, { kind: "choice", key: c => c.key, label: c => c.label, meta: c => some(c.name), tone: c => some(c.tone) }),
                        }}
                        columns={{
                            name:         Record.column.title(Operator, { header: "Name", width: "184px", avatar: true }),
                            badge:        Record.column.stamped(Operator, { header: "Badge", width: "120px", owner: "Gatehouse" }),
                            notes:        Record.column.text(Operator, { header: "Notes", width: "184px" }),
                            shifts:       Record.column.integer(Operator, { header: "Shifts", width: "120px" }),
                            hours:        Record.column.quantity(Operator, { header: "Hours", width: "120px", unit: "hrs" }),
                            started:      Record.column.date(Operator, { header: "Started", width: "120px" }),
                            status:       Record.column.enum(Operator, "statuses", { header: "Status", width: "120px" }),
                            role:         Record.column.reference(Operator, "roles", { header: "Role", width: "184px" }),
                            certificates: Record.column.set(Operator, "certificates", { header: "Certificates", width: "248px" }),
                            inducted:     Record.column.boolean(Operator, { header: "Inducted", width: "72px" }),
                            supervisor:   Record.column.person(Operator, "supervisors", { header: "Supervisor", width: "160px" }),
                            night:        Record.column.toggle(Operator, { header: "Nights", width: "80px", on: "yes", off: "no" }),
                            preference:   Record.column.cycle(Operator, "choices", { header: "Overtime", width: "80px" }),
                            days_since:   Record.column.age(Operator, { header: "Days since", width: "96px", since: o => o.updated, stale: 90n, absent: "not confirmed" }),
                            updated:      Record.column.audit(Operator, { header: "Last updated", width: "232px", mode: "blame" }),
                        }}
                        inspector
                        name="operators"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 5 — read only
// ============================================================================

export const recordSkillsReadOnly = example({
    keywords: ["Record", "readOnly", "read only", "skills matrix", "slice"],
    description: "The skills matrix read only: the same cells with no hover, no select column and no Add or Delete; the rail still narrows and counts, and the inspector shows every field read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const slice = $.let(Slice.bindRecords("record.skills.readonly", {
                rows: {
                    source: Data.bindPaged(recordSkills, { indexes: ["record_skills_by_name", "record_skills_by_role"] }),
                    label: "People",
                    fields: { name: { label: "Name" }, role: { label: "Role", hints: ["Operator", "Contractor", "Team lead"] } },
                    search: ["name", "role"],
                },
            }));
            const LevelType = StructType({ key: StringType, name: StringType });
            const levels = $.let([
                { key: "0", name: "Not trained" },
                { key: "1", name: "Supervised" },
                { key: "2", name: "Competent" },
            ], ArrayType(LevelType));
            const roles = $.let(["Operator", "Contractor", "Team lead"], ArrayType(StringType));
            return (
                <Box height="760px">
                    <Record
                        slice={{ slice }}
                        title="Skills matrix"
                        noun={{ singular: "person", plural: "people" }}
                        registers={{
                            levels: Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }),
                            roles:  Record.register.members(roles, { kind: "role", key: r => r, label: r => r }),
                        }}
                        columns={{
                            name:       Record.column.title(Skills, { header: "Name", width: "156px" }),
                            role:       Record.column.reference(Skills, "roles", { header: "Role", width: "136px" }),
                            intake:     Record.column.cycle(Skills, "levels", { header: "Intake", width: "72px", scale: true }),
                            review:     Record.column.cycle(Skills, "levels", { header: "Review", width: "72px", scale: true }),
                            dispatch:   Record.column.cycle(Skills, "levels", { header: "Dispatch", width: "72px", scale: true }),
                            handover:   Record.column.cycle(Skills, "levels", { header: "Handover to next shift", width: "72px", scale: true }),
                            scanner:    Record.column.cycle(Skills, "levels", { header: "Scanner", width: "72px", scale: true }),
                            console:    Record.column.cycle(Skills, "levels", { header: "Console", width: "72px", scale: true }),
                            reports:    Record.column.cycle(Skills, "levels", { header: "Reports", width: "72px", scale: true }),
                            auditing:   Record.column.cycle(Skills, "levels", { header: "Auditing", width: "72px", scale: true }),
                            training:   Record.column.cycle(Skills, "levels", { header: "Training", width: "72px", scale: true }),
                            planning:   Record.column.cycle(Skills, "levels", { header: "Planning", width: "72px", scale: true }),
                            days_since: Record.column.age(Skills, { header: "Days since", width: "92px", since: p => p.updated, stale: 90n, absent: "not confirmed" }),
                            updated:    Record.column.audit(Skills, { header: "Last updated", width: "264px", mode: "blame" }),
                        }}
                        columnGroups={[
                            { label: "Core", columnKeys: ["intake", "review", "dispatch", "handover"] },
                            { label: "Tools", columnKeys: ["scanner", "console", "reports"] },
                            { label: "Advanced", columnKeys: ["auditing", "training", "planning"] },
                        ]}
                        inspector
                        readOnly
                        name="skillsReadOnly"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 6 — the looks: every Record kind, a chip and a mark, three densities
// ============================================================================

export const Rota = StructType({
    name: StringType, supervisor: OptionType(StringType), inducted: BooleanType,
    nights: BooleanType, weekends: BooleanType, forklift: StringType, scanner: StringType, days: StringType, evenings: StringType,
    updated: OptionType(Record.Types.Change),
});
export const recordRota = e3.record("record_rota", DictType(StringType, Rota), {
    initial: new Map([
        ["R-01", { name: "A. Morgan", supervisor: some("S. Park"), inducted: true, nights: false, weekends: true, forklift: "2", scanner: "1",
            days: "prefer", evenings: "can", updated: some({ at: new Date("2026-09-18T09:12:00Z"), by: "M. Hale", verb: "confirmed" }) }],
        ["R-02", { name: "B. Ellis", supervisor: none, inducted: false, nights: true, weekends: false, forklift: "0", scanner: "2",
            days: "can", evenings: "cannot", updated: none }],
        ["R-03", { name: "C. Patel", supervisor: some("J. Ortiz"), inducted: true, nights: true, weekends: true, forklift: "1", scanner: "0",
            days: "cannot", evenings: "prefer", updated: some({ at: new Date("2026-05-13T09:41:00Z"), by: "S. Park", verb: "changed" }) }],
    ]),
    mutations: (mutation) => ({
        // The rota's patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordLooks = example({
    keywords: ["Record", "density", "compact", "condensed", "comfortable", "look", "chip", "mark", "pips", "Record.column.person", "Record.column.boolean", "Configurator"],
    description: "The Record's looks, as the designer's tweaks show them: a rota with a cell of every Record kind, each cycle and toggle as a chip and as a mark side by side, under a density control that steps its rows through comfortable, compact and condensed",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const rota = $.let(Record.bind(recordRota));
            // The density control: each segment a density, and the Record takes the one chosen.
            const densities = $.const([variant("comfortable", null), variant("compact", null), variant("condensed", null)], ArrayType(Style.Types.Density));
            const densityBind = $.let(State.bind([StringType], "record_looks_density", "comfortable"));
            const densityKey = $.let(densityBind.read());
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const density = $.let(densities.filter((_$, d) => d.getTag().equal(densityKey)).get(0n));
            const LevelType = StructType({ key: StringType, name: StringType });
            const levels = $.let([
                { key: "0", name: "Not trained" },
                { key: "1", name: "Supervised" },
                { key: "2", name: "Competent" },
            ], ArrayType(LevelType));
            const ChoiceType = StructType({ key: StringType, label: StringType, name: StringType, tone: StatusValueType });
            const choices = $.let([
                { key: "can",    label: "can",    name: "Can work",   tone: variant("neutral", null) },
                { key: "prefer", label: "prefer", name: "Prefers",    tone: variant("success", null) },
                { key: "cannot", label: "can't",  name: "Can't work", tone: variant("danger", null) },
            ], ArrayType(ChoiceType));
            const supervisors = $.let(["S. Park", "M. Hale", "J. Ortiz"], ArrayType(StringType));
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", densityKey,
                            <SegmentGroup value={densityKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, d) => SegmentGroup.Item(d.getTag(), <Text>{d.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={
                        <Box height="360px" width="100%">
                            <Record
                                record={rota}
                                title="Rota"
                                noun={{ singular: "person", plural: "people" }}
                                density={density}
                                registers={{
                                    levels:      Record.register.members(levels, { kind: "level", key: l => l.key, label: l => l.key, meta: l => some(l.name) }),
                                    choices:     Record.register.members(choices, { kind: "choice", key: c => c.key, label: c => c.label, meta: c => some(c.name), tone: c => some(c.tone) }),
                                    supervisors: Record.register.members(supervisors, { kind: "person", key: p => p, label: p => p }),
                                }}
                                columns={{
                                    name:       Record.column.title(Rota, { header: "Name", width: "176px", avatar: true }),
                                    supervisor: Record.column.person(Rota, "supervisors", { header: "Supervisor", width: "152px" }),
                                    inducted:   Record.column.boolean(Rota, { header: "Inducted", width: "80px" }),
                                    nights:     Record.column.toggle(Rota, { header: "Nights", width: "80px", on: "yes", off: "no" }),
                                    weekends:   Record.column.toggle(Rota, { header: "Weekends", width: "88px", on: "yes", off: "no", look: "mark" }),
                                    forklift:   Record.column.cycle(Rota, "levels", { header: "Forklift", width: "72px", scale: true }),
                                    scanner:    Record.column.cycle(Rota, "levels", { header: "Scanner", width: "72px", scale: true, look: "mark" }),
                                    days:       Record.column.cycle(Rota, "choices", { header: "Days", width: "80px" }),
                                    evenings:   Record.column.cycle(Rota, "choices", { header: "Evenings", width: "112px", look: "mark" }),
                                    days_since: Record.column.age(Rota, { header: "Days since", width: "136px", since: r => r.updated, stale: 90n, absent: "not confirmed" }),
                                    updated:    Record.column.audit(Rota, { header: "Last updated", width: "232px", mode: "blame" }),
                                }}
                                columnGroups={[
                                    { label: "Shifts", columnKeys: ["nights", "weekends"] },
                                    { label: "Skills", columnKeys: ["forklift", "scanner"] },
                                    { label: "Preferences", columnKeys: ["days", "evenings"] },
                                ]}
                                name="looks"
                            />
                        </Box>
                    }
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 7 — a variant field: its cases a choice, and the case held a block;
// and a reference to a record keyed by number
// ============================================================================

/** A bench of the joinery's shop, keyed by its number. */
export const Bench = StructType({ name: StringType });
export const recordBenches = e3.record("record_benches", DictType(IntegerType, Bench), {
    initial: new Map([[1n, { name: "Saw bench" }], [2n, { name: "Assembly bench" }], [10n, { name: "Finishing bench" }]]),
});
/** How a piece is finished: left bare, stained a shade, or painted a colour in coats, matt or with a sheen. */
export const Finish = VariantType({
    bare: NullType,
    stain: StringType,
    paint: StructType({ colour: StringType, coats: IntegerType, gloss: VariantType({ matt: NullType, sheen: FloatType }) }),
});
/** A piece of joinery: the bench it is made at, by the bench's number, and how it is finished. */
export const Piece = StructType({ name: StringType, room: StringType, bench: IntegerType, finish: Finish });
export const recordPieces = e3.record("record_pieces", DictType(StringType, Piece), {
    initial: new Map([
        ["J-101", { name: "Hall door", room: "Hall", bench: 2n, finish: variant("paint", { colour: "Teal", coats: 2n, gloss: variant("sheen", 0.4) }) }],
        ["J-102", { name: "Stair rail", room: "Stairs", bench: 1n, finish: variant("stain", "Walnut") }],
        ["J-103", { name: "Window seat", room: "Lounge", bench: 10n, finish: variant("bare", null) }],
    ]),
    mutations: (mutation) => ({
        // The joinery's patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordFinishes = example({
    keywords: ["Record", "Record.field.select", "cases", "variant", "block", "inspector", "Fields.select", "Record.field.reference", "Fields.reference", "register", "IntegerType", "Integer key"],
    description: "A Record's inspector over a piece of joinery: its finish, a variant, chosen among its cases, with the fields of the case it holds in a block under the choice — a stain's shade, a paint's colour, coats and gloss, the gloss a choice of its own — each case hinted through the select's `cases`; and its bench, a reference to a record keyed by number, the register keying each bench by its number as East prints it and the form reading the one chosen back as a number",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pieces = $.let(Record.bind(recordPieces));
            const benches = $.let(Data.bind(recordBenches));
            return (
                <Box height="480px">
                    <Record
                        record={pieces}
                        title="Joinery"
                        noun={{ singular: "piece", plural: "pieces" }}
                        registers={{
                            // A register's members are keyed by text: each bench by its number as East prints it.
                            benches: Record.register.members(benches.read().toArray((_$, bench, number) => ({ number, name: bench.name })), {
                                kind: "bench", key: (b) => East.print(b.number), label: (b) => b.name,
                            }),
                        }}
                        columns={{
                            name: Record.column.title(Piece, { header: "Piece", width: "176px" }),
                            room: Record.column.text(Piece, { header: "Room", width: "136px" }),
                        }}
                        fields={{
                            finish: Record.field.select({
                                labels: { bare: "Bare", stain: "Stain", paint: "Paint" },
                                cases: {
                                    stain: Record.field.text({ label: "Shade" }),
                                    paint: { colour: Record.field.text({ help: "As the tin names it" }), coats: Record.field.number({ min: 1n, max: 4n }) },
                                },
                            }),
                            bench: Record.field.reference({ of: "benches", help: "Where it is made" }),
                        }}
                        inspector
                        name="finishes"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 8 — a cycle over a variant, its cases stepped in the order given
// ============================================================================

/** Where an order is. East keeps a variant's cases in alphabetical order — packed, picked, received, shipped — so the cycle gives its own. */
export const Status = VariantType({ received: NullType, picked: NullType, packed: NullType, shipped: NullType });
export const Order = StructType({ customer: StringType, status: Status });
export const recordOrders = e3.record("record_orders", DictType(StringType, Order), {
    initial: new Map([
        ["SO-1041", { customer: "Ashgrove Joinery", status: variant("received", null) }],
        ["SO-1042", { customer: "Bellmoor Interiors", status: variant("packed", null) }],
        ["SO-1043", { customer: "Corran Builders", status: variant("shipped", null) }],
    ]),
    mutations: (mutation) => ({
        // The orders' patch door — every Apply commits through it.
        patch: mutation.patch(),
    }),
});

export const recordOrderStatus = example({
    keywords: ["Record", "Record.column.cycle", "steps", "variant", "VariantType", "cycle over a variant", "status"],
    description: "A cycle over a variant: an order's status, stepped by a click in the order its `steps` give — received, picked, packed, shipped — rather than the alphabetical order East keeps a variant's cases in, each step a chip with its tone, Details offering the steps in that order as one line, and Apply writing the case",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Record.bind(recordOrders));
            return (
                <Box height="320px">
                    <Record
                        record={orders}
                        title="Orders"
                        noun={{ singular: "order", plural: "orders" }}
                        columns={{
                            customer: Record.column.title(Order, { header: "Customer", width: "200px" }),
                            status:   Record.column.cycle(Order, Status, {
                                header: "Status", width: "96px",
                                steps: [
                                    { case: "received", label: "Received", tone: "neutral" },
                                    { case: "picked",   label: "Picked",   tone: "info" },
                                    { case: "packed",   label: "Packed",   tone: "info" },
                                    { case: "shipped",  label: "Shipped",  tone: "success" },
                                ],
                            }),
                        }}
                        inspector
                        name="orders"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 9 — columns from data: a value for each member of a register
// ============================================================================

/** A client of the joinery. */
export const Client = StructType({ name: StringType });
/** A project, for one client by the client's code. */
export const Project = StructType({ name: StringType, client: StringType });
/** A person's hours on each project, by the project's code. */
export const Person = StructType({ name: StringType, hours: DictType(StringType, FloatType) });
export const recordClients = e3.record("record_clients", DictType(StringType, Client), {
    initial: new Map([
        ["C-01", { name: "Ashgrove Joinery" }],
        ["C-02", { name: "Bellmoor Interiors" }],
        ["C-03", { name: "Corran Builders" }],
    ]),
});
export const recordProjects = e3.record("record_projects", DictType(StringType, Project), {
    initial: new Map([
        ["P-100", { name: "Kitchen fit-out", client: "C-01" }],
        ["P-101", { name: "Stair rebuild", client: "C-01" }],
        ["P-200", { name: "Shop front", client: "C-02" }],
        ["P-900", { name: "Training", client: "" }],
    ]),
});
export const recordHours = e3.record("record_hours", DictType(StringType, Person), {
    initial: new Map([
        ["H-01", { name: "A. Morgan", hours: new Map([["P-100", 12.5], ["P-200", 4.0]]) }],
        ["H-02", { name: "B. Ellis", hours: new Map([["P-101", 30.0], ["P-900", 6.0]]) }],
        ["H-03", { name: "C. Patel", hours: new Map() }],
    ]),
    mutations: (mutation) => ({
        // Every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordHoursByProject = example({
    keywords: ["Record", "columns from data", "each", "groups", "register", "parent", "Dict", "Record.column.quantity", "a column per member"],
    description: "Columns from data: a person's hours by project, the field a Dict keyed by the project's code — a column for each project in the projects record, in its order and headed by its name, each under its client in the clients record's order, a project whose client that record lacks after them unlabelled, and a client with no projects drawing nothing; with no functions, a cell shows the person's entry, an edit sets it and a clear removes it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const staff = $.let(Record.bind(recordHours));
            const clientRows = $.let(Data.bind(recordClients));
            const projectRows = $.let(Data.bind(recordProjects));
            return (
                <Box height="320px">
                    <Record
                        record={staff}
                        title="Hours"
                        noun={{ singular: "person", plural: "people" }}
                        registers={{
                            clients: Record.register.members(clientRows.read(), { kind: "client", key: (_c, code) => code, label: (c) => c.name }),
                            projects: Record.register.members(projectRows.read(), {
                                kind: "project", key: (_p, code) => code, label: (p) => p.name, parent: (p) => some(p.client),
                            }),
                        }}
                        columns={{
                            name: Record.column.title(Person, { header: "Name", width: "176px" }),
                            // The hours field: a column for each project, under its client.
                            hours: Record.column.quantity(Person, { each: "projects", groups: "clients", unit: "hrs", width: "88px" }),
                        }}
                        inspector
                        name="hours"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 10 — columns from data: a column for each field of a struct
// ============================================================================

/** A week's heads, a day each. */
export const Week = StructType({
    mon: IntegerType, tue: IntegerType, wed: IntegerType, thu: IntegerType, fri: IntegerType, sat: IntegerType, sun: IntegerType,
});
/** A shift and the heads it needs each day of the week. */
export const Shift = StructType({ name: StringType, week: Week });
export const recordRoster = e3.record("record_roster", DictType(StringType, Shift), {
    initial: new Map([
        ["S-1", { name: "Early", week: { mon: 4n, tue: 4n, wed: 4n, thu: 4n, fri: 4n, sat: 2n, sun: 0n } }],
        ["S-2", { name: "Late", week: { mon: 3n, tue: 3n, wed: 3n, thu: 3n, fri: 3n, sat: 1n, sun: 0n } }],
        ["S-3", { name: "Night", week: { mon: 2n, tue: 2n, wed: 2n, thu: 2n, fri: 2n, sat: 2n, sun: 2n } }],
    ]),
    mutations: (mutation) => ({
        // Every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordRosterByDay = example({
    keywords: ["Record", "columns from data", "each", "struct", "fields", "Record.column.integer", "columnGroups", "a column per field"],
    description: "Columns from data over a struct's fields: a shift's heads for each day as one struct field, a column for each day in the order `each` gives and headed as it says, fixed when the page is built, under a column group that names them all by the column's key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const shifts = $.let(Record.bind(recordRoster));
            return (
                <Box height="320px">
                    <Record
                        record={shifts}
                        title="Roster"
                        noun={{ singular: "shift", plural: "shifts" }}
                        columns={{
                            name: Record.column.title(Shift, { header: "Shift", width: "176px" }),
                            // The week field: a column for each day.
                            week: Record.column.integer(Shift, {
                                each: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
                                width: "56px",
                            }),
                        }}
                        columnGroups={[{ label: "Heads per day", columnKeys: ["week"] }]}
                        inspector
                        name="roster"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
