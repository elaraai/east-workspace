/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { FloatType, IntegerType, OptionType, SortedMap, StringType, StructType, none, parseFor, printFor, some, type ValueTypeOf } from "@elaraai/east";
import { RosterAssignmentType, RosterRequirementType } from "@elaraai/e3-ui/internal";
import { Fields } from "@elaraai/east-ui";
import { FieldForm, SliceEditPopover, useFormatters } from "@elaraai/east-ui-components";
import { compareString, DAY, requirementOf, type Assignment, type RosterStyles, type RosterValue, type Slot, type Week } from "./model.js";
import type { RosterCommands, RosterSource } from "./actions.js";

const parseDay = parseFor(IntegerType);
const printDay = printFor(IntegerType);
const SlotForm = StructType({ day: StringType, group: StringType, shift: StringType });
const SLOT_FIELDS = Fields.specs(SlotForm, { day: Fields.reference({ of: "days" }), group: Fields.reference({ of: "groups" }), shift: Fields.reference({ of: "shifts" }) });
const PersonForm = StructType({ person: OptionType(StringType) });
const PERSON_FIELDS = Fields.specs(PersonForm, { person: Fields.reference({ of: "people" }) });
const ASSIGNMENT_FIELDS = Fields.specs(RosterAssignmentType, {
    position: Fields.reference({ of: "positions" }), activity: Fields.reference({ of: "activities" }),
    offset: Fields.number({ label: "Start offset", unit: "h", step: 0.5, min: -2, max: 6 }),
    overtime: Fields.number({ unit: "h", step: 0.5, min: 0, max: 4 }),
}, ["slot", "who"]);
const TARGET_FIELDS = Fields.specs(RosterRequirementType, { positions: Fields.number({ min: 0n, step: 1n }) }, ["hours"]);
const Hours = StructType({ hours: FloatType });
const HOUR_FIELDS = Fields.specs(Hours, { hours: Fields.number({ min: 0, step: 0.5, unit: "h" }) });
const AddLine = StructType({ activity: OptionType(StringType), hours: FloatType });
const ADD_FIELDS = Fields.specs(AddLine, { activity: Fields.reference({ of: "activities" }), hours: Fields.number({ min: 0, step: 0.5, unit: "h" }) });

/** Shared typed destination form for desktop inspector and narrow actions. */
export function SlotFields({ value, start, slot, onChange }: { value: RosterValue; start: Date; slot: Slot; onChange: (next: Slot) => void }) {
    const format = useFormatters();
    const options = { days: Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: format.weekdayDate(new Date(start.getTime() + day * DAY)) })),
        groups: value.groups.map(g => ({ key: g.key, label: g.label })), shifts: value.shifts.map(s => ({ key: s.key, label: s.label })) };
    return <FieldForm specs={SLOT_FIELDS} value={{ ...slot, day: printDay(slot.day) }} options={options} onChange={(path, next) => {
        const key = path[0];
        if (key === "day" && typeof next === "string") { const parsed = parseDay(next); if (parsed.success && parsed.value >= 0n && parsed.value <= 6n) onChange({ ...slot, day: parsed.value }); }
        else if (key === "group" && typeof next === "string") onChange({ ...slot, group: next });
        else if (key === "shift" && typeof next === "string") onChange({ ...slot, shift: next });
    }} />;
}
/** One anchored place action; absent source offers a staff picker. */
export function PlaceAction({ label, source, slot: initial, value, start, commands, styles }: {
    label: string; source?: RosterSource; slot: Slot; value: RosterValue; start: Date; commands: RosterCommands; styles: RosterStyles;
}) {
    const [open, setOpen] = useState(false);
    const [slot, setSlot] = useState(initial);
    const [person, setPerson] = useState<ValueTypeOf<typeof PersonForm>>({ person: none });
    const [error, setError] = useState<string>();
    return <SliceEditPopover open={open} onOpenChange={next => { setOpen(next); if (next) { setSlot(initial); setError(undefined); } }} label={label}
        trigger={<Button size="xs" variant="outline" disabled={!commands.editing.available} data-roster-action={label.toLowerCase()}>{label}</Button>}
        footActions={<><Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button size="xs" variant="outline" disabled={source === undefined && person.person.type === "none"} onClick={() => {
            const from = source ?? (person.person.type === "some" ? { type: "person" as const, key: person.person.value } : undefined);
            if (from === undefined) return;
            const refusal = commands.place(from, slot); setError(refusal); if (refusal === undefined) setOpen(false);
        }}>{label}</Button></>}>
        {source === undefined && <FieldForm specs={PERSON_FIELDS} value={person} options={{ people: value.people.filter(p => value.visiblePeople.type === "none" || value.visiblePeople.value.has(p.key)).map(p => ({ key: p.key, label: p.name })) }} onChange={(_path, next) => setPerson({ person: next as typeof person.person })} />}
        <SlotFields value={value} start={start} slot={slot} onChange={setSlot} />
        {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
    </SliceEditPopover>;
}
/** The shared assignment form is also used inside an explicit Edit action. */
export function AssignmentFields({ assignment, baseline, value, onChange, readOnly = false }: {
    assignment: Assignment; baseline?: Assignment; value: RosterValue; onChange: (next: Assignment) => void; readOnly?: boolean;
}) {
    const activities = [...(value.groups.find(g => g.key === assignment.slot.group)?.skills ?? []), ...value.duties];
    return <FieldForm specs={ASSIGNMENT_FIELDS.filter(field => (assignment.who.type === "person" || field.path[0] === "position") && (field.path[0] !== "agreed" || assignment.offset !== 0 || assignment.overtime !== 0))} value={assignment} baseline={baseline}
        readOnly={readOnly} options={{ positions: value.positions.map(p => ({ key: p.key, label: p.label })), activities: activities.map(a => ({ key: a.key, label: a.label })) }}
        onChange={(path, next) => onChange({ ...assignment, [path[0]!]: next })} />;
}
/** Every mobile assignment exposes its operations without opening the inspector. */
export function AssignmentActions({ id, assignment, value, start, commands, styles, removed = false }: {
    id: string; assignment: Assignment; value: RosterValue; start: Date; commands: RosterCommands; styles: RosterStyles; removed?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(assignment);
    const [error, setError] = useState<string>();
    if (!commands.editing.available) return null;
    if (removed) return <Button size="xs" variant="outline" onClick={() => commands.restore(id)}>Restore</Button>;
    return <><Box css={styles.actions} data-roster-assignment-actions="">
        <SliceEditPopover open={open} onOpenChange={next => { setOpen(next); if (next) { setForm(assignment); setError(undefined); } }} label="Edit assignment"
            trigger={<Button size="xs" variant="outline">Edit</Button>}
            footActions={<><Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button size="xs" variant="outline" onClick={() => { const refused = commands.update(id, form); setError(refused); if (refused === undefined) setOpen(false); }}>Update</Button></>}>
            <AssignmentFields assignment={form} baseline={assignment} value={value} onChange={setForm} />
            {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
        </SliceEditPopover>
        <PlaceAction label="Move" source={{ type: "assignment", key: id }} slot={assignment.slot} value={value} start={start} commands={commands} styles={styles} />
        {assignment.who.type === "person" && (assignment.offset !== 0 || assignment.overtime !== 0) && (assignment.agreed.type !== "some" || !assignment.agreed.value)
            && <Button size="xs" variant="outline" onClick={() => setError(commands.update(id, { ...assignment, agreed: some(true) }))}>Mark agreed</Button>}
        <Button size="xs" variant="outline" onClick={() => commands.remove(id)}>Remove</Button>
    </Box>{error !== undefined && !open && <Box role="alert" css={styles.error}>{error}</Box>}</>;
}
/** Targets use FieldForm for the headcount, every activity line, and adding a line. */
export function RequirementFields({ slot, week, value, commands, styles }: { slot: Slot; week: Week; value: RosterValue; commands: RosterCommands; styles: RosterStyles }) {
    const target = requirementOf(week, slot);
    const baseline = commands.editing.held?.requirements.get(slot);
    const activities = [...(value.groups.find(g => g.key === slot.group)?.skills ?? []), ...value.duties];
    const [line, setLine] = useState<ValueTypeOf<typeof AddLine>>({ activity: none, hours: 8 });
    const changeHours = (key: string, hours: number) => {
        const next = { ...target, hours: new SortedMap(target.hours, compareString) }; next.hours.set(key, hours); commands.requirement(slot, next);
    };
    return <>
        <FieldForm specs={TARGET_FIELDS} value={target} baseline={baseline} readOnly={!commands.editing.available} onChange={(_path, next) => commands.requirement(slot, { ...target, positions: next as bigint })} />
        {activities.filter(a => target.hours.has(a.key)).map(a => <Box key={a.key} css={styles.paneFoot}>
            <Box css={styles.title}>{a.label}</Box>
            <FieldForm specs={HOUR_FIELDS} value={{ hours: target.hours.get(a.key) }} baseline={baseline === undefined ? undefined : { hours: baseline.hours.get(a.key) }} readOnly={!commands.editing.available}
                onChange={(_path, next) => changeHours(a.key, next as number)} />
            {commands.editing.available && <Button size="xs" variant="ghost" onClick={() => changeHours(a.key, 0)}>Remove {a.code}</Button>}
        </Box>)}
        {commands.editing.available && activities.some(a => !target.hours.has(a.key)) && <Box css={styles.paneFoot}>
            <Box css={styles.eyebrow}>Add a target</Box>
            <FieldForm specs={ADD_FIELDS} value={line} options={{ activities: activities.filter(a => !target.hours.has(a.key)).map(a => ({ key: a.key, label: a.label })) }}
                onChange={(path, next) => setLine(previous => ({ ...previous, [path[0]!]: next }))} />
            <Button size="xs" variant="outline" disabled={line.activity.type === "none" || line.hours <= 0} onClick={() => { if (line.activity.type === "some") { changeHours(line.activity.value, line.hours); setLine({ activity: none, hours: 8 }); } }}>Add target</Button>
        </Box>}
    </>;
}
/** Target editing stays reachable from a narrow card when the inspector is collapsed. */
export function RequirementAction(props: Parameters<typeof RequirementFields>[0]) {
    const [open, setOpen] = useState(false);
    return <SliceEditPopover open={open} onOpenChange={setOpen} label="Shift targets" trigger={<Button size="xs" variant="outline" disabled={!props.commands.editing.available}>Edit targets</Button>}
        footActions={<Button size="xs" variant="outline" onClick={() => setOpen(false)}>Done</Button>}><RequirementFields {...props} /></SliceEditPopover>;
}
