/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared forms for the explicit actions and the inspector's schedule section. */
import { useMemo, useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { DateTimeType, OptionType, StringType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { FieldForm, SliceEditPopover } from "@elaraai/east-ui-components";
import { initialPlacement, type CalendarCommands, type CalendarPlacement, type CalendarSource } from "./actions.js";
import { parseResourceKey, resourceKey, type CalendarItem, type CalendarStyles, type CalendarValue } from "./model.js";

const PlacementFormType = StructType({ start: DateTimeType, end: DateTimeType, resource: OptionType(StringType) });
type PlacementForm = ValueTypeOf<typeof PlacementFormType>;
const SPECS = Fields.specs(PlacementFormType, { resource: Fields.reference({ of: "resources" }) }).map(spec => ({ ...spec, label: spec.path[0] === "start" ? "Start (UTC)" : spec.path[0] === "end" ? "End (UTC)" : spec.label }));

function formOf(at: CalendarPlacement): PlacementForm {
    return { start: at.start, end: at.end, resource: at.resource.type === "some" ? some(resourceKey(at.resource.value)) : none };
}
function placementOf(form: PlacementForm): CalendarPlacement | undefined {
    if (form.resource.type === "none") return { ...form, resource: none };
    const parsed = parseResourceKey(form.resource.value);
    return parsed.success ? { ...form, resource: some(parsed.value) } : undefined;
}
/** The placement form is one shared FieldForm in both the inspector and popovers. */
export function PlacementFields({ source, value, placement, onChange, readOnly = false }: { source: CalendarSource; value: CalendarValue; placement: CalendarPlacement; onChange: (at: CalendarPlacement) => void; readOnly?: boolean }) {
    const form = formOf(placement);
    const options = useMemo(() => ({ resources: value.resources.filter(kind => source.kind.takes.includes(kind.key)).flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }), label: `${row.label} · ${kind.name}` }))) }), [value.resources, source.kind.takes]);
    return <FieldForm specs={SPECS} readOnly={readOnly} value={form} options={options} onChange={(path, next) => {
        let changed = { ...form, [path[0]!]: next };
        if (path[0] === "start" && next instanceof Date) changed = { ...changed, end: new Date(next.getTime() + form.end.getTime() - form.start.getTime()) };
        if (path[0] === "end" && next instanceof Date && next <= changed.start) changed = { ...changed, end: new Date(next.getTime() + 86_400_000) };
        const at = placementOf(changed);
        if (at !== undefined) onChange(at);
    }} />;
}
/** An anchored action uses the same Schedule command as a desktop drop. */
export function PlacementAction({ label, source, value, day, commands, styles }: {
    label: string; source: CalendarSource; value: CalendarValue; day: Date; commands: CalendarCommands; styles: CalendarStyles;
}) {
    const [open, setOpen] = useState(false);
    const [placement, setPlacement] = useState(() => initialPlacement(source, day));
    const [error, setError] = useState<string>();
    const changeOpen = (next: boolean) => {
        if (next) { setPlacement(initialPlacement(source, day)); setError(undefined); }
        setOpen(next);
    };
    return <SliceEditPopover open={open} onOpenChange={changeOpen} label={`${label} · ${"template" in source ? source.template.name : source.item.title}`}
        trigger={<Button size="xs" variant="outline" data-calendar-action={label.toLowerCase()} disabled={!commands.editing.available(source.kind.key)}>{label}</Button>}
        footActions={<><Button size="xs" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button><Button size="xs" variant="outline" onClick={() => {
            const refused = commands.place(source, placement, label === "Resize" ? "resize" : "typed");
            setError(refused); if (refused === undefined) setOpen(false);
        }}>{label}</Button></>}>
        <PlacementFields source={source} value={value} placement={placement} onChange={setPlacement} />
        {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
    </SliceEditPopover>;
}
/** Mutations are explicit and visible in cards and in the inspector. */
export function EventActions({ item, value, commands, day, styles }: { item: CalendarItem; value: CalendarValue; commands: CalendarCommands; day: Date; styles: CalendarStyles }) {
    const kind = value.events.find(kind => kind.key === item.kind)!;
    const [error, setError] = useState<string>();
    return <>
        <Box css={styles.actions} data-calendar-event-actions="">
            <PlacementAction label={item.start.type === "none" ? "Schedule" : "Move"} source={{ kind, item }} value={value} day={day} commands={commands} styles={styles} />
            {item.start.type === "some" && <PlacementAction label="Resize" source={{ kind, item }} value={value} day={day} commands={commands} styles={styles} />}
            <Button size="xs" variant="outline" data-calendar-action="duplicate" disabled={!commands.editing.available(kind.key)} onClick={() => setError(commands.duplicate([item]))}>Duplicate</Button>
            <Button size="xs" variant="outline" data-calendar-action="delete" disabled={!commands.editing.available(kind.key)} onClick={() => commands.remove([item])}>Delete</Button>
            {kind.backlog && item.start.type === "some" && <Button size="xs" variant="outline" data-calendar-action="unschedule" disabled={!commands.editing.available(kind.key)} onClick={() => setError(commands.unschedule([item]))}>Return to backlog</Button>}
        </Box>
        {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
    </>;
}
