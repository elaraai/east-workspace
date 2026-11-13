/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optional Calendar inspector: shared fields over the same Schedule drafts. An event's overlaps are the ones the toolbar
 * counts. A placement the event refuses — its start, its end, its resource — and a bulk edit the selection refuses go
 * back to what the fields hold, the reason under the field changed.
 *
 * It keeps the keyboard (#1398): a control that goes with the view it was pressed in — Delete, Return to backlog,
 * Duplicate, an overlapping event's link, Remove from selection, Delete selected — leaves the focus on the heading of the
 * view drawn in its place, Nothing selected's included (`../shared/focus-home.ts`), never on the page's body. An issue or
 * a warning gone to from the toolbar gives the keyboard to the field it names, as the form draws it
 * (`../shared/schedule/field-ask.tsx`).
 *
 * A number an event's row holds outside its field's bounds (#1585) is said in the tone its Save stands in: a warning
 * while the event stands as stored, an error once its session refuses its change, holding Save.
 *
 * A field an issue of the event names is ringed in whichever of its forms draws it, the issue's words under it (ruled
 * 13 Nov 2026), as the Roster's, the Allocation's and the Plan's are: gone to, the reason is where the keyboard is,
 * whatever of the banner over the forms is in view.
 *
 * What is selected is drawn a moment after what selected it (#1594): a drop's event shows on the board and the page paints,
 * then its Details draw in a render of their own, which a pointer's next move can break into, so a form's many fields
 * never hold up the drop itself.
 */
import { memo, useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { BlobType, decodeBeast2For, equalFor, fromEastTypeValue, isValueOf, isVariant, none, some, OptionType, StringType, StructType, type ValueTypeOf } from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui";
import { Schedule } from "@elaraai/e3-ui/internal";
import { BannerView, EastChakraComponent, FieldForm, useFormatters, useTrackedEvaluation, type BuilderFrameDock, type TrackedResult } from "@elaraai/east-ui-components";
import { FOCUS_HOME_PROPS, useFocusHome } from "../shared/focus-home.js";
import { ScheduleInspectorHead } from "../shared/schedule/inspector-head.js";
import { EMPTY_SCHEDULE_DRAFTS, heldRowOf, type ScheduleHeldRows } from "../shared/schedule/editing.js";
import { useFieldAsk } from "../shared/schedule/field-ask.js";
import { refusalText, refusedFields } from "../shared/schedule/refusals.js";
import type { ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import { PagedChooser, pagedControl, useCalendarChooser } from "./chooser.js";
import { EventActions, PlacementFields, useCalendarFieldWords, type CalendarShownResources } from "./controls.js";
import { type CalendarCommands } from "./actions.js";
import { eventKey, parseResourceKey, resourceChoices, resourceKey, type CalendarItem, type CalendarKind, type CalendarRange, type CalendarRef, type CalendarResource, type CalendarStyles, type CalendarValue } from "./model.js";

export type Inspected = { kind: CalendarKind; item: CalendarItem; row: Uint8Array };
interface InspectorArgs {
    value: CalendarValue; refs: readonly CalendarRef[]; range: CalendarRange; commands: CalendarCommands | undefined;
    styles: CalendarStyles; storageKey: string; overlaps: ScheduleOverlaps<CalendarItem>; select: (refs: CalendarRef[]) => void;
    /** Each resource kind's rows the rail shows: what the inspector's Choosers offer, with the event's own (#1343). */
    shown: CalendarShownResources;
}

/**
 * The resources an event's reference fields name (`technician`): what their Choosers keep whatever the rail hides. A
 * field under a variant's case is read through the case the variant holds (#1549).
 */
function referenced(specs: readonly FieldSpecValue[], row: unknown): CalendarResource[] {
    return specs.flatMap(spec => {
        if (spec.editor.type !== "reference") return [];
        const at = spec.path.reduce<unknown>((value, name) => (isVariant(value) ? (stringEqual(value.type, name) ? value.value : undefined)
            : (value as Readonly<Record<string, unknown>> | undefined)?.[name]), row);
        let key: string | undefined;
        if (spec.optional && isValueOf(at, OptionType(StringType))) {
            const option = at as ValueTypeOf<OptionType<StringType>>;
            if (option.type === "some") key = option.value;
        } else if (isValueOf(at, StringType)) key = at as string;
        return key === undefined ? [] : [{ kind: spec.editor.value.of, key }];
    });
}
/** The selection as the inspector shows it: each selected event read, or why the read failed. */
export type CalendarSelection = TrackedResult<Inspected[]>;
/** No selection read yet. */
export const NO_SELECTION: CalendarSelection = { ok: true, value: [] };
const itemEqual = equalFor(Schedule.Types.Item);
const rowEqual = equalFor(BlobType);
const stringEqual = equalFor(StringType);

/** Whether two selections show alike: the same events, each read to the same row. */
function sameSelection(a: CalendarSelection, b: CalendarSelection): boolean {
    if (!a.ok || !b.ok) return !a.ok && !b.ok && Object.is(a.error, b.error);
    return a.value.length === b.value.length && a.value.every((event, i) => {
        const other = b.value[i]!;
        return Object.is(event.kind, other.kind) && itemEqual(event.item, other.item) && rowEqual(event.row, other.row);
    });
}

/**
 * Selected rows are read through the shared by-key seam, including paged records: a kind read by its cells (#1424) from
 * the rows they hold, else by its key — never over the window.
 */
export function useCalendarSelection(args: Pick<InspectorArgs, "value" | "refs" | "range" | "commands"> & { held: ScheduleHeldRows | undefined }): CalendarSelection {
    const { value, refs, range, commands, held } = args;
    const read = useCallback((): Inspected[] => {
        return refs.flatMap(ref => {
            const kind = value.events.find(kind => kind.key === ref.kind); if (kind === undefined) return [];
            const event = kind.event(ref.key, commands?.editing.draftsOf(kind.key) ?? EMPTY_SCHEDULE_DRAFTS, range.from, range.to, heldRowOf(held, kind.key, ref.key));
            return event.type === "some" ? [{ kind, ...event.value }] : [];
        });
    }, [value.events, refs, commands, range.from, range.to, held]);
    const { result } = useTrackedEvaluation(read);
    return result;
}

/**
 * The selection's read, in a component of its own (#1343): a selected event is read over the window, so each search
 * of a window read through an interval index re-runs it, and it hands the frame the selection only when what the
 * inspector shows moves.
 *
 * @param props - What the selection reads, and where it goes
 * @returns Nothing: it reads
 */
export function CalendarSelectionReader(props: Pick<InspectorArgs, "value" | "refs" | "range" | "commands"> & {
    held: ScheduleHeldRows | undefined; onSelection: (selection: CalendarSelection) => void;
}): null {
    const selection = useCalendarSelection(props);
    const reported = useRef<CalendarSelection | undefined>(undefined);
    const { onSelection } = props;
    useLayoutEffect(() => {
        const was = reported.current;
        if (was !== undefined && sameSelection(was, selection)) return;
        reported.current = selection;
        onSelection(selection);
    });
    return null;
}
/** What the inspector shows: the selection read, and what its views edit it through. */
type InspectorShown = InspectorArgs & { selection: CalendarSelection };
/** The optional end pane displays the same by-key selection that commands edit. */
export function useCalendarInspector(args: InspectorShown): BuilderFrameDock | undefined {
    const { value, refs, range, commands, styles: frameStyles, storageKey, overlaps, select, selection, shown } = args;
    const recipe = useSlotRecipe({ key: "planInspector" });
    const styles = useMemo(() => ({ ...frameStyles, ...recipe({}) }) as unknown as CalendarStyles, [frameStyles, recipe]);
    // One object while what the pane shows holds: its body draws it a moment later, and a new one would draw it again for nothing.
    const drawn = useMemo((): InspectorShown => ({ value, refs, range, commands, styles: frameStyles, storageKey, overlaps, select, selection, shown }),
        [value, refs, range, commands, frameStyles, storageKey, overlaps, select, selection, shown]);
    if (!value.inspector) return undefined;
    const events = selection.ok ? selection.value : [];
    return { label: "Inspector", icon: "sliders", badge: String(refs.length), size: "320px", persist: "local", detail: events.length === 1 ? events[0]!.item.title : undefined, active: refs.length > 0,
        body: <InspectorBody args={drawn} styles={styles} />,
    };
}
/** The pane's body: a region that keeps the keyboard as a control goes with its view, and what is selected drawn a moment after what selected it — see the module docs. */
function InspectorBody({ args, styles }: { args: InspectorShown; styles: CalendarStyles }) {
    const shown = useDeferredValue(args);
    const home = useFocusHome();
    return <Box ref={home.ref} css={styles.root} onFocus={home.onFocus} onBlur={home.onBlur} data-calendar-inspector="">
        <InspectorViews args={shown} styles={styles} />
    </Box>;
}
/** What is selected: none, one event's Details or several's. Drawn only as it moves, never in the pass that moved it. */
const InspectorViews = memo(function InspectorViews({ args, styles }: { args: InspectorShown; styles: CalendarStyles }) {
    const { refs, selection: result } = args;
    const events = result.ok ? result.value : [];
    return <>
        {!result.ok && <Box role="alert" css={args.styles.error}>The selected event could not be read.</Box>}
        {events.length === 0 && <Box css={styles.empty} {...FOCUS_HOME_PROPS}><Box css={styles.emptyTitle}>{refs.length > 0 ? "Reading selection…" : "Nothing selected"}</Box><Box css={styles.emptyHint}>Select an event to inspect its schedule and fields.</Box></Box>}
        {events.length === 1 && <OneEvent key={eventKey(events[0]!.item)} {...args} styles={styles} event={events[0]!} />}
        {events.length > 1 && <ManyEvents {...args} styles={styles} events={events} />}
    </>;
});
/**
 * Test-only render probe — lets "an event's Details draw once what the drop made it has been drawn" be asserted as the
 * Details' own renders (#1594). `undefined` outside tests.
 */
let detailsRenderProbe: (() => void) | undefined;
/**
 * Install (or clear) the Details render probe. Test use only.
 *
 * @param fn - Called each time one event's Details render; `undefined` clears it
 */
export function setCalendarDetailsRenderProbe(fn: (() => void) | undefined): void {
    detailsRenderProbe = fn;
}
function OneEvent({ event, value, shown, styles, commands, storageKey, range, overlaps, select }: InspectorArgs & { event: Inspected }) {
    detailsRenderProbe?.();
    const { kind, item } = event;
    const format = useFormatters();
    const rowType = useMemo(() => fromEastTypeValue(kind.editing.entryType) as StructType, [kind.editing.entryType]);
    const row = useMemo(() => decodeBeast2For(rowType)(event.row), [rowType, event.row]);
    // Each reference field's Chooser offers the rows the rail shows, and the event's own whatever it hides.
    const options = useMemo(() => Object.fromEntries(resourceChoices(value.resources, shown, referenced(kind.fields, row))
        .map(kind => [kind.key, kind.rows.map(row => ({ key: row.key, label: row.label }))])), [value.resources, shown, kind.fields, row]);
    const roleNames = useMemo(() => [kind.schedule.title, ...(kind.schedule.status.type === "some" ? [kind.schedule.status.value] : [])], [kind.schedule]);
    const roleSpecs = useMemo(() => Fields.specs(rowType, {}, Object.keys(rowType.fields).filter(field => !roleNames.includes(field))), [rowType, roleNames]);
    const drafted = commands?.editing.draftsOf(kind.key).has(item.key) === true;
    const baseline = commands?.editing.held(kind.key, item.key) ?? (drafted ? {} : row);
    const onField = useCallback((path: readonly string[], next: unknown) => commands?.field(item, path, next), [commands, item]);
    const fieldWords = useCalendarFieldWords(value);
    // A reference field to the paged resource kind chooses by key, through the kind's own paged read (#1424).
    const chooser = useCalendarChooser();
    const fieldsReadOnly = commands === undefined || !commands.editing.available(kind.key);
    const renderReference = useCallback((spec: FieldSpecValue) => {
        if (chooser === undefined || spec.editor.type !== "reference" || spec.editor.value.of !== chooser.paged.kind) return undefined;
        const held = referenced([spec], row)[0];
        return <PagedChooser chooser={chooser} chosen={held?.key} readOnly={fieldsReadOnly}
            onPick={key => onField(spec.path, spec.optional ? some(key) : key)} />;
    }, [chooser, row, fieldsReadOnly, onField]);
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
    // A bound its row breaks (#1585), said in the tone its Save stands in: as stored it warns; its change refused, holding
    // Save, it is an error.
    const breaches = readiness !== undefined && readiness.type !== "ready" && readiness.value.some(issue => stringEqual(issue.entry, item.key)) ? "error" : "warn";
    // Each field an issue names, ringed in whichever of its forms draws it, the issue's words under it.
    const refused = refusedFields(issues);
    // The field an issue or a warning gone to names takes the keyboard, in whichever of its forms draws it.
    const focus = useFieldAsk(kind.key, item.key);
    return <>
        <ScheduleInspectorHead styles={styles} kind={kind} title={item.title}
            when={item.start.type === "some" ? `${format.weekdayDate(item.start.value)} · ${format.time(item.start.value)}–${item.end.type === "some" ? format.time(item.end.value) : ""}` : value.vocabulary.unscheduled}
            status={item.status.type === "some" ? item.status.value : undefined} pending={drafted ? commands?.editing.held(kind.key, item.key) === undefined ? "new" : "pending" : undefined}
            writes={commands !== undefined} home />
        {peers.length > 0 && <Box css={styles.section} data-calendar-inspector-overlaps=""><Box css={styles.detail}>Overlaps {peers.length} event{peers.length === 1 ? "" : "s"}</Box>
            {peers.map(peer => <Button key={eventKey(peer)} size="xs" variant="ghost" onClick={() => select([{ kind: peer.kind, key: peer.key }])}>{peer.title}</Button>)}
        </Box>}
        {/* Each field it names by its form's label, as the Roster's, the Allocation's and the Plan's do. In its section, as
            the Plan's: standing alone in the pane's column, the banner was squeezed to its least height, its lines run out under it. */}
        {issues.length > 0 && <Box css={styles.refusals} data-calendar-inspector-refusals="">
            <BannerView status="warning" title={item.title} description={issues.map(issue => refusalText(issue, kind.fields)).join("; ")} />
        </Box>}
        <Box css={styles.fields}><Box css={styles.sectionHead}>Schedule</Box>
        <FieldForm specs={roleSpecs} words={fieldWords} value={row} baseline={baseline} options={options} onChange={onField} readOnly={fieldsReadOnly} renderControl={chooser === undefined ? undefined : renderReference}
            issues={refused} focus={focus} breaches={breaches} />
        {commands !== undefined && item.start.type === "some" && item.end.type === "some" && <PlacementFields source={{ kind, item }} value={value} shown={shown} readOnly={!commands.editing.available(kind.key)}
            placement={{ start: item.start.value, end: item.end.value, resource: item.resource }} onChange={at => commands.place({ kind, item }, at)} />}
        {commands === undefined && <Box css={styles.detail}>{item.start.type === "some" ? `${format.dateTime(item.start.value)} – ${item.end.type === "some" ? format.dateTime(item.end.value) : ""}` : value.vocabulary.unscheduled}</Box>}
        </Box>
        <Box css={styles.fields}><Box css={styles.sectionHead}>{kind.name} fields</Box>
        {own?.value !== undefined ? <EastChakraComponent value={own.value} storageKey={`${storageKey}.inspector.${kind.key}`} />
            : <FieldForm specs={kind.fields.filter(field => !roleNames.includes(field.path[0]!))} words={fieldWords} value={row} baseline={baseline} options={options} onChange={onField} readOnly={fieldsReadOnly}
                renderControl={chooser === undefined ? undefined : renderReference} issues={refused} focus={focus} breaches={breaches} />}
        </Box>
        {own?.error !== undefined && <Box role="alert" css={styles.error}>{own.error}</Box>}
        {commands !== undefined && <EventActions item={item} value={value} shown={shown} commands={commands} day={range.from} styles={styles} />}
    </>;
}
function ManyEvents({ events, commands, styles, select, value, shown }: InspectorArgs & { events: Inspected[] }) {
    const [error, setError] = useState<string>();
    const items = events.map(event => event.item);
    return <>
        <Box css={styles.head} {...FOCUS_HOME_PROPS}><Box css={styles.summary}>{events.length} events</Box></Box>
        {events.map(event => <Button key={eventKey(event.item)} size="xs" variant="ghost" onClick={() => select(events.filter(other => other !== event).map(other => ({ kind: other.item.kind, key: other.item.key })))}>{event.item.title} · Remove from selection</Button>)}
        {commands !== undefined && <Box css={styles.bulk}><Box css={styles.sectionHead}>Bulk edit</Box><BulkFields events={events} value={value} shown={shown} commands={commands} onEdit={() => setError(undefined)} /></Box>}
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
/** Whether a bulk edit's field is its resource. */
const isBulkResource = (spec: FieldSpecValue) => spec.path[0] === "resource";
/**
 * Bulk edits retain each event's type and pass through the same checked commands; their resource Chooser offers the
 * rows the rail shows — or, for events every one of which is placed on the paged resource kind, searches it by key (#1424).
 * One the selection refuses goes back, the reason under its field; each edit tells `onEdit`, which clears what the
 * selection's actions last said.
 */
function BulkFields({ events, value, shown, commands, onEdit }: { events: Inspected[]; value: CalendarValue; shown: CalendarShownResources; commands: CalendarCommands; onEdit: () => void }) {
    const items = events.map(event => event.item);
    const statuses = events[0]!.kind.status.filter(status => events.every(event => event.kind.status.some(other => other.case === status.case)));
    const resources = resourceChoices(value.resources, shown, []).filter(kind => events.every(event => event.kind.takes.includes(kind.key)));
    const options = { statuses: statuses.map(status => ({ key: status.case, label: status.status.label })),
        resources: resources.flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }), label: row.label }))) };
    const form: ValueTypeOf<typeof BulkType> = { resource: none, status: none };
    const readOnly = events.some(event => !commands.editing.available(event.kind.key));
    const chooser = useCalendarChooser();
    const paged = chooser !== undefined && resources.some(kind => kind.key === chooser.paged.kind) ? chooser : undefined;
    // Its resource in the app's word for one (#1516), as a single event's placement says it.
    const resourceWord = value.vocabulary.resources.one;
    const specs = useMemo(() => BULK_SPECS.map(spec => (isBulkResource(spec) ? { ...spec, label: resourceWord } : spec)), [resourceWord]);
    const fieldWords = useCalendarFieldWords(value);
    // A resource picked is the field's own edit, so one the selection refuses is said under it.
    const renderControl = useCallback((spec: FieldSpecValue, change: (next: unknown) => void) => pagedControl(paged, spec, isBulkResource, undefined,
        key => { if (paged !== undefined) change(resourceKey({ kind: paged.paged.kind, key })); }, readOnly),
    [paged, readOnly]);
    return <FieldForm specs={specs.filter(spec => spec.path[0] === "status" ? statuses.length > 0 : resources.length > 0)} value={form} options={options} words={fieldWords}
        renderControl={paged === undefined ? undefined : renderControl} readOnly={readOnly} onChange={(path, next) => {
            onEdit();
            const picked = next as ValueTypeOf<OptionType<StringType>>;
            if (path[0] === "status" && picked.type === "some") return commands.status(items, picked.value);
            if (path[0] === "resource") {
                const parsed = picked.type === "some" ? parseResourceKey(picked.value) : undefined;
                if (parsed?.success) return commands.move(items, 0, some(parsed.value));
                if (picked.type === "none") return commands.move(items, 0, none);
            }
            return undefined;
        }} />;
}
