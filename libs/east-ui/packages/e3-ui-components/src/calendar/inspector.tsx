/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Optional Calendar inspector: shared fields over the same Schedule drafts. */
import { useCallback, useMemo, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { decodeBeast2For, fromEastTypeValue, none, some, OptionType, StringType, StructType, type ValueTypeOf } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { BannerView, EastChakraComponent, FieldForm, useFormatters, useTrackedEvaluation, type BuilderFrameDock } from "@elaraai/east-ui-components";
import { ScheduleInspectorHead } from "../shared/schedule/inspector-head.js";
import { EMPTY_SCHEDULE_DRAFTS } from "../shared/schedule/editing.js";
import type { ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import { EventActions, PlacementFields } from "./controls.js";
import { type CalendarCommands } from "./actions.js";
import { eventKey, parseResourceKey, resourceKey, type CalendarItem, type CalendarKind, type CalendarRange, type CalendarRef, type CalendarStyles, type CalendarValue } from "./model.js";

export type Inspected = { kind: CalendarKind; item: CalendarItem; row: Uint8Array };
interface InspectorArgs {
    value: CalendarValue; refs: readonly CalendarRef[]; range: CalendarRange; commands: CalendarCommands | undefined;
    styles: CalendarStyles; storageKey: string; overlaps: ScheduleOverlaps<CalendarItem>; select: (refs: CalendarRef[]) => void;
}
/** Selected rows are read through the shared by-key seam, including paged records. */
export function useCalendarSelection(args: Pick<InspectorArgs, "value" | "refs" | "range" | "commands">) {
    const { value, refs, range, commands } = args;
    const read = useCallback((): Inspected[] => {
        return refs.flatMap(ref => {
            const kind = value.events.find(kind => kind.key === ref.kind); if (kind === undefined) return [];
            const event = kind.event(ref.key, commands?.editing.draftsOf(kind.key) ?? EMPTY_SCHEDULE_DRAFTS, range.from, range.to);
            return event.type === "some" ? [{ kind, ...event.value }] : [];
        });
    }, [value.events, refs, commands, range.from, range.to]);
    const { result } = useTrackedEvaluation(read);
    return result;
}
/** The optional end pane displays the same by-key selection that commands edit. */
export function useCalendarInspector(args: InspectorArgs & { selection: ReturnType<typeof useCalendarSelection> }): BuilderFrameDock | undefined {
    const { value, refs, selection: result } = args;
    const recipe = useSlotRecipe({ key: "planInspector" });
    const styles = { ...args.styles, ...recipe({}) } as unknown as CalendarStyles;
    if (!value.inspector) return undefined;
    const events = result.ok ? result.value : [];
    return { label: "Inspector", icon: "sliders", badge: String(refs.length), size: "320px", persist: "local", detail: events.length === 1 ? events[0]!.item.title : undefined, active: refs.length > 0,
        body: <Box css={styles.root} data-calendar-inspector="">
            {!result.ok && <Box role="alert" css={args.styles.error}>The selected event could not be read.</Box>}
            {events.length === 0 && <Box css={styles.empty}><Box css={styles.emptyTitle}>{refs.length > 0 ? "Reading selection…" : "Nothing selected"}</Box><Box css={styles.emptyHint}>Select an event to inspect its schedule and fields.</Box></Box>}
            {events.length === 1 && <OneEvent key={eventKey(events[0]!.item)} {...args} styles={styles} event={events[0]!} />}
            {events.length > 1 && <ManyEvents {...args} styles={styles} events={events} />}
        </Box>,
    };
}
function OneEvent({ event, value, styles, commands, storageKey, range, overlaps, select }: InspectorArgs & { event: Inspected }) {
    const { kind, item } = event;
    const format = useFormatters();
    const [error, setError] = useState<string>();
    const rowType = useMemo(() => fromEastTypeValue(kind.editing.entryType) as StructType, [kind.editing.entryType]);
    const row = useMemo(() => decodeBeast2For(rowType)(event.row), [rowType, event.row]);
    const options = useMemo(() => Object.fromEntries(value.resources.map(kind => [kind.key, kind.rows.map(row => ({ key: row.key, label: row.label }))])), [value.resources]);
    const roleNames = useMemo(() => [kind.schedule.title, ...(kind.schedule.status.type === "some" ? [kind.schedule.status.value] : [])], [kind.schedule]);
    const roleSpecs = useMemo(() => Fields.specs(rowType, {}, Object.keys(rowType.fields).filter(field => !roleNames.includes(field))), [rowType, roleNames]);
    const drafted = commands?.editing.draftsOf(kind.key).has(item.key) === true;
    const baseline = commands?.editing.held(kind.key, item.key) ?? (drafted ? {} : row);
    const onField = useCallback((path: readonly string[], next: unknown) => commands?.field(item, path, next), [commands, item]);
    const update = useCallback((bytes: Uint8Array): null => { commands?.editing.record([{ kind: kind.key, id: item.key, row: bytes }], "typed", `Edit ${item.title}`); return null; }, [commands, kind.key, item]);
    const own = useMemo(() => {
        if (commands === undefined || kind.inspector.type === "none") return undefined;
        try { return { value: kind.inspector.value(event.row, update) }; }
        catch { return { error: "The custom inspector could not be rendered." }; }
    }, [commands, kind.inspector, event.row, update]);
    const peers = overlaps.peers.get(eventKey(item)) ?? [];
    const session = commands?.editing.sessions.find(held => held.kind === kind.key)?.session;
    const readiness = session?.readiness;
    const issues = (readiness !== undefined && readiness.type !== "ready" ? readiness.value : session?.issues ?? []).filter(issue => issue.entry === item.key);
    return <>
        <ScheduleInspectorHead styles={styles} kind={kind} title={item.title}
            when={item.start.type === "some" ? `${format.weekdayDate(item.start.value)} · ${format.time(item.start.value)}–${item.end.type === "some" ? format.time(item.end.value) : ""}` : "Unscheduled"}
            status={item.status.type === "some" ? item.status.value : undefined} pending={drafted ? commands?.editing.held(kind.key, item.key) === undefined ? "new" : "pending" : undefined} />
        {peers.length > 0 && <Box css={styles.section} data-calendar-inspector-overlaps=""><Box css={styles.detail}>Overlaps {peers.length} event{peers.length === 1 ? "" : "s"}</Box>
            {peers.map(peer => <Button key={eventKey(peer)} size="xs" variant="ghost" onClick={() => select([{ kind: peer.kind, key: peer.key }])}>{peer.title}</Button>)}
        </Box>}
        {issues.length > 0 && <BannerView status="warning" title={item.title} description={issues.map(issue => `${issue.field.type === "some" ? `${issue.field.value}: ` : ""}${issue.message}`).join("; ")} />}
        <Box css={styles.fields}><Box css={styles.sectionHead}>Schedule</Box>
        <FieldForm specs={roleSpecs} value={row} baseline={baseline} options={options} onChange={onField} readOnly={commands === undefined || !commands.editing.available(kind.key)} />
        {commands !== undefined && item.start.type === "some" && item.end.type === "some" && <PlacementFields source={{ kind, item }} value={value} readOnly={!commands.editing.available(kind.key)}
            placement={{ start: item.start.value, end: item.end.value, resource: item.resource }} onChange={at => setError(commands.place({ kind, item }, at))} />}
        {commands === undefined && <Box css={styles.detail}>{item.start.type === "some" ? `${format.dateTime(item.start.value)} – ${item.end.type === "some" ? format.dateTime(item.end.value) : ""}` : "Unscheduled"}</Box>}
        </Box>
        <Box css={styles.fields}><Box css={styles.sectionHead}>{kind.name} fields</Box>
        {own?.value !== undefined ? <EastChakraComponent value={own.value} storageKey={`${storageKey}.inspector.${kind.key}`} />
            : <FieldForm specs={kind.fields.filter(field => !roleNames.includes(field.path[0]!))} value={row} baseline={baseline} options={options} onChange={onField} readOnly={commands === undefined || !commands.editing.available(kind.key)} />}
        </Box>
        {own?.error !== undefined && <Box role="alert" css={styles.error}>{own.error}</Box>}
        {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
        {commands !== undefined && <EventActions item={item} value={value} commands={commands} day={range.from} styles={styles} />}
    </>;
}
function ManyEvents({ events, commands, styles, select, value }: InspectorArgs & { events: Inspected[] }) {
    const [error, setError] = useState<string>();
    const items = events.map(event => event.item);
    return <>
        <Box css={styles.head}><Box css={styles.summary}>{events.length} events</Box></Box>
        {events.map(event => <Button key={eventKey(event.item)} size="xs" variant="ghost" onClick={() => select(events.filter(other => other !== event).map(other => ({ kind: other.item.kind, key: other.item.key })))}>{event.item.title} · Remove from selection</Button>)}
        {commands !== undefined && <Box css={styles.bulk}><Box css={styles.sectionHead}>Bulk edit</Box><BulkFields events={events} value={value} commands={commands} onError={setError} /></Box>}
        {commands !== undefined && <Box css={styles.actions}>
            {[-24, -1, 1, 24].map(hours => <Button key={hours} size="xs" variant="outline" disabled={events.some(event => !commands.editing.available(event.kind.key))} onClick={() => setError(commands.move(items, hours * 3_600_000))}>{hours > 0 ? "+" : ""}{hours} h</Button>)}
            <Button size="xs" variant="outline" disabled={events.some(event => !commands.editing.available(event.kind.key))} onClick={() => setError(commands.duplicate(items))}>Duplicate selected</Button>
            <Button size="xs" variant="outline" disabled={events.some(event => !commands.editing.available(event.kind.key))} onClick={() => commands.remove(items)}>Delete selected</Button>
        </Box>}
        {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
    </>;
}

const BulkType = StructType({ resource: OptionType(StringType), status: OptionType(StringType) });
const BULK_SPECS = Fields.specs(BulkType, { resource: Fields.reference({ of: "resources" }), status: Fields.reference({ of: "statuses" }) });
/** Bulk edits retain each event's type and pass through the same checked commands. */
function BulkFields({ events, value, commands, onError }: { events: Inspected[]; value: CalendarValue; commands: CalendarCommands; onError: (error: string | undefined) => void }) {
    const items = events.map(event => event.item);
    const statuses = events[0]!.kind.status.filter(status => events.every(event => event.kind.status.some(other => other.case === status.case)));
    const resources = value.resources.filter(kind => events.every(event => event.kind.takes.includes(kind.key)));
    const options = { statuses: statuses.map(status => ({ key: status.case, label: status.status.label })),
        resources: resources.flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }), label: row.label }))) };
    const form: ValueTypeOf<typeof BulkType> = { resource: none, status: none };
    return <FieldForm specs={BULK_SPECS.filter(spec => spec.path[0] === "status" ? statuses.length > 0 : resources.length > 0)} value={form} options={options}
        readOnly={events.some(event => !commands.editing.available(event.kind.key))} onChange={(path, next) => {
            const picked = next as ValueTypeOf<OptionType<StringType>>;
            if (path[0] === "status" && picked.type === "some") onError(commands.status(items, picked.value));
            else if (path[0] === "resource") {
                const parsed = picked.type === "some" ? parseResourceKey(picked.value) : undefined;
                if (parsed?.success) onError(commands.move(items, 0, some(parsed.value)));
                else if (picked.type === "none") onError(commands.move(items, 0, none));
            }
        }} />;
}
