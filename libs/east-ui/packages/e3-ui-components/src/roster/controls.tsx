/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { DateTimeType, FloatType, IntegerType, OptionType, SortedMap, StringType, StructType, none, parseFor, printFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { RosterRequirementType } from "@elaraai/e3-ui/internal";
import { Fields } from "@elaraai/east-ui";
import { FieldForm, SliceEditPopover, useFormatters } from "@elaraai/east-ui-components";
import { activityChoices, compareString, DAY, duties, groupSkills, requirementOf, type Assignment, type RosterStyles, type RosterValue, type Slot, type Week } from "./model.js";
import type { RolesChange, RosterCommands, RosterSource } from "./actions.js";

const parseDay = parseFor(IntegerType);
const printDay = printFor(IntegerType);
const SlotForm = StructType({ day: StringType, group: StringType, shift: StringType });
const SLOT_FIELDS = Fields.specs(SlotForm, { day: Fields.reference({ of: "days" }), group: Fields.reference({ of: "groups" }), shift: Fields.reference({ of: "shifts" }) });
const PersonForm = StructType({ person: OptionType(StringType) });
const PERSON_FIELDS = Fields.specs(PersonForm, { person: Fields.reference({ of: "people" }) });
/** What the Roster's own form edits of a duty beside its times: the position held and the activity. */
const DutyForm = StructType({ position: StringType, activity: OptionType(StringType) });
const DUTY_FIELDS = Fields.specs(DutyForm, { position: Fields.reference({ of: "positions" }), activity: Fields.reference({ of: "activities" }) });
/** A duty's own times (§5.5, rule 4). */
const TimesForm = StructType({ start: DateTimeType, end: DateTimeType });
const TIME_FIELDS = Fields.specs(TimesForm, {});
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
    if (!commands.available) return null;
    return <SliceEditPopover open={open} onOpenChange={next => { setOpen(next); if (next) { setSlot(initial); setError(undefined); } }} label={label}
        trigger={<Button size="xs" variant="outline" data-roster-action={label.toLowerCase()}>{label}</Button>}
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
/** What a duty's form starts from: its position, its activity and its times, as the draft holds them. */
export interface DutyFormValue { position: option<string>; activity: option<string>; start: Date; end: Date }
/** A duty's form, from the duty as the week holds it. */
export function dutyForm(a: Assignment): DutyFormValue { return { position: a.position === "" ? none : some(a.position), activity: a.activity, start: a.start, end: a.end }; }

/**
 * The Roster's own form over a duty's roles: the position held — where the
 * kind maps one — and, for a named person, the activity; each choice one edit.
 */
export function AssignmentFields({ assignment, form, baseline, value, onChange, readOnly = false }: {
    assignment: Assignment; form: DutyFormValue; baseline?: DutyFormValue | undefined; value: RosterValue; onChange: (change: RolesChange) => void; readOnly?: boolean;
}) {
    // The group's skills and the duties the slice shows, and the duty's own — as stored and as the edit has it — so a
    // stored activity the rail hides can be picked again after choosing another (#1342).
    const own = [form.activity, baseline?.activity].flatMap(activity => activity?.type === "some" ? [activity.value] : []);
    const activities = activityChoices(value, assignment.slot.group, own);
    const specs = DUTY_FIELDS.filter(field => field.path[0] === "position" ? value.duty.roles.position : value.duty.roles.activity && assignment.who.type === "person");
    if (specs.length === 0) return null;
    const shown = { position: form.position.type === "some" ? form.position.value : "", activity: form.activity };
    const held = baseline === undefined ? undefined : { position: baseline.position.type === "some" ? baseline.position.value : "", activity: baseline.activity };
    return <FieldForm specs={specs} value={shown} baseline={held} readOnly={readOnly}
        options={{ positions: value.positions.map(p => ({ key: p.key, label: p.label })), activities: activities.map(a => ({ key: a.key, label: a.label })) }}
        onChange={(path, next) => onChange(path[0] === "position" ? { position: some(next as string) } : { activity: next as option<string> })} />;
}
/** A duty's own times (§5.5, rule 4): each one an edit, held within twelve hours of its shift's start, its end after its start. */
export function TimesFields({ form, baseline, onChange, readOnly = false }: {
    form: DutyFormValue; baseline?: DutyFormValue | undefined; onChange: (change: RolesChange) => void; readOnly?: boolean;
}) {
    return <FieldForm specs={TIME_FIELDS} value={{ start: form.start, end: form.end }} baseline={baseline === undefined ? undefined : { start: baseline.start, end: baseline.end }}
        readOnly={readOnly} onChange={(path, next) => onChange(path[0] === "start" ? { start: next as Date } : { end: next as Date })} />;
}
/** Every mobile duty exposes its operations without opening the inspector. */
export function AssignmentActions({ id, assignment, value, start, commands, styles, removed = false }: {
    id: string; assignment: Assignment; value: RosterValue; start: Date; commands: RosterCommands; styles: RosterStyles; removed?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState<DutyFormValue>(() => dutyForm(assignment));
    const [error, setError] = useState<string>();
    if (!commands.available) return null;
    if (removed) return <Button size="xs" variant="outline" onClick={() => commands.restore(id)}>Restore</Button>;
    const change = (next: RolesChange) => setForm(before => ({ ...before, ...next }));
    return <><Box css={styles.actions} data-roster-assignment-actions="">
        <SliceEditPopover open={open} onOpenChange={next => { setOpen(next); if (next) { setForm(dutyForm(assignment)); setError(undefined); } }} label="Edit duty"
            trigger={<Button size="xs" variant="outline">Edit</Button>}
            footActions={<><Button size="xs" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button size="xs" variant="outline" onClick={() => {
                const refused = commands.update(id, { start: form.start, end: form.end, ...(value.duty.roles.position ? { position: form.position } : {}),
                    ...(value.duty.roles.activity ? { activity: form.activity } : {}) });
                setError(refused); if (refused === undefined) setOpen(false);
            }}>Update</Button></>}>
            <AssignmentFields assignment={assignment} form={form} baseline={dutyForm(assignment)} value={value} onChange={change} />
            <TimesFields form={form} baseline={dutyForm(assignment)} onChange={change} />
            {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
        </SliceEditPopover>
        <PlaceAction label="Move" source={{ type: "assignment", key: id }} slot={assignment.slot} value={value} start={start} commands={commands} styles={styles} />
        <Button size="xs" variant="outline" onClick={() => commands.remove(id)}>Remove</Button>
    </Box>{error !== undefined && !open && <Box role="alert" css={styles.error}>{error}</Box>}</>;
}
/** Targets use FieldForm for the headcount, every activity line, and adding a line. */
export function RequirementFields({ slot, week, held, value, commands, styles }: { slot: Slot; week: Week; held: Week; value: RosterValue; commands: RosterCommands; styles: RosterStyles }) {
    const target = requirementOf(week, slot);
    const baseline = held.requirements.get(slot);
    // Every target line shows; a new one is one of the activities the slice shows (#1342).
    const activities = [...groupSkills(value, slot.group), ...duties(value)];
    const choices = activityChoices(value, slot.group).filter(a => !target.hours.has(a.key));
    const [line, setLine] = useState<ValueTypeOf<typeof AddLine>>({ activity: none, hours: 8 });
    const editable = commands.available && value.targets.type === "some";
    const changeHours = (key: string, hours: number) => {
        const next = { ...target, hours: new SortedMap(target.hours, compareString) }; next.hours.set(key, hours); commands.requirement(slot, next);
    };
    return <>
        <FieldForm specs={TARGET_FIELDS} value={target} baseline={baseline} readOnly={!editable} onChange={(_path, next) => commands.requirement(slot, { ...target, positions: next as bigint })} />
        {activities.filter(a => target.hours.has(a.key)).map(a => <Box key={a.key} css={styles.paneFoot}>
            <Box css={styles.title}>{a.label}</Box>
            <FieldForm specs={HOUR_FIELDS} value={{ hours: target.hours.get(a.key) }} baseline={baseline === undefined ? undefined : { hours: baseline.hours.get(a.key) }} readOnly={!editable}
                onChange={(_path, next) => changeHours(a.key, next as number)} />
            {editable && <Button size="xs" variant="ghost" onClick={() => changeHours(a.key, 0)}>Remove {a.code}</Button>}
        </Box>)}
        {editable && choices.length > 0 && <Box css={styles.paneFoot}>
            <Box css={styles.eyebrow}>Add a target</Box>
            <FieldForm specs={ADD_FIELDS} value={line} options={{ activities: choices.map(a => ({ key: a.key, label: a.label })) }}
                onChange={(path, next) => setLine(previous => ({ ...previous, [path[0]!]: next }))} />
            <Button size="xs" variant="outline" disabled={line.activity.type === "none" || line.hours <= 0} onClick={() => { if (line.activity.type === "some") { changeHours(line.activity.value, line.hours); setLine({ activity: none, hours: 8 }); } }}>Add target</Button>
        </Box>}
    </>;
}
/** Target editing stays reachable from a narrow card when the inspector is collapsed. */
export function RequirementAction(props: Parameters<typeof RequirementFields>[0]) {
    const [open, setOpen] = useState(false);
    if (!props.commands.available || props.value.targets.type !== "some") return null;
    return <SliceEditPopover open={open} onOpenChange={setOpen} label="Shift targets" trigger={<Button size="xs" variant="outline">Edit targets</Button>}
        footActions={<Button size="xs" variant="outline" onClick={() => setOpen(false)}>Done</Button>}><RequirementFields {...props} /></SliceEditPopover>;
}
