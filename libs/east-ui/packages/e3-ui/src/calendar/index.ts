/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, Expr, FunctionType, IntegerType, NullType, OptionType, StringType,
    StructType, VariantType, none, some, variant, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, type UIElement } from "@elaraai/east-ui";
import { RecordSliceConfigType, RecordSlicesChromeType, RowSourceType, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { FuncBindingType } from "../bind/func.js";
import type { OptimiseHandle } from "../utils/optimise.js";
import { recordSources, sliceSourceNames, templatesSource } from "../utils/record-sources.js";
import { Schedule, scheduleCheck, scheduleTitled, type ScheduleNamespace } from "../schedule/index.js";
import { checkSchedulePagedEventKinds, checkSchedulePagedKinds, checkedScheduleTilings } from "../schedule/cell-checks.js";
import { ScheduleOptimiseRequestTypeFor, ScheduleOptimiseResultTypeFor, scheduleOptimiseBinding } from "../schedule/optimise.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { ScheduleAuthorTabType, buildScheduleTab, type ScheduleTabDeclaration, type ScheduleLibraryTabConfig } from "../schedule/library.js";
import { ScheduleCandidateType, ScheduleEventRefType, ScheduleKindType, ScheduleResourcesType } from "../schedule/types.js";
import { CalendarPagedType, createCalendarPaged } from "./paged.js";

export { CalendarPagedType, createCalendarPaged } from "./paged.js";

/** Calendar's layout: a time grid, resource columns or a horizontal timeline. */
export const CalendarLayoutType = VariantType({ calendar: NullType, resources: NullType, timeline: NullType });
/** The stretch shown: a day, week or month. */
export const CalendarPeriodType = VariantType({ day: NullType, week: NullType, month: NullType });
/** A viewer's layout, period and reference date. */
export const CalendarViewType = StructType({ layout: CalendarLayoutType, period: CalendarPeriodType, date: DateTimeType });
/** One library tab: templates, unscheduled events or author-defined cards. */
export const CalendarLibraryTabType = VariantType({ templates: NullType, backlog: NullType, tab: ScheduleAuthorTabType });
/** Initial view and working-time settings; every instant is shown in UTC. */
export const CalendarSettingsType = StructType({
    layout: CalendarLayoutType, period: CalendarPeriodType, date: OptionType(DateTimeType),
    hours: StructType({ from: IntegerType, to: IntegerType }),
    weekStart: VariantType({ monday: NullType, sunday: NullType }), weekends: BooleanType,
    density: VariantType({ compact: NullType, comfortable: NullType, spacious: NullType }),
    now: OptionType(DateTimeType), readOnly: BooleanType,
});
/**
 * Calendar's closed interface to its React renderer. The frame is a renderer detail.
 * @property resources - The resource kinds, their rows resolved — none for a kind paged a window at a time, whose resources come through `paged`
 * @property paged - A paged resource kind's resources a window at a time (#1424) — of the narrowing's, when its source of the slice narrows it; `none` while no resource kind is paged
 * @property slice - The narrowing's chrome: a Slice over the event kinds', the resource kinds' and the templates' records, one rail (#1343)
 * @property narrowed - Each source's narrowed keys, paged through its own data, by the source's name — a resource
 *   kind's read whole narrow its columns, rows and Choosers, a templates list's and a tab's their cards; an event kind
 *   reads its own narrowing through its part, and a paged resource kind its windows
 * @property optimise - The app's optimiser, by its `e3.function`'s name (#1409): what the Elara eye calls over the window in
 *   view, its result one edit of the session; `none`, no eye
 */
export const CalendarPayloadType = StructType({
    events: ArrayType(ScheduleKindType), resources: ArrayType(ScheduleResourcesType), paged: OptionType(CalendarPagedType), settings: CalendarSettingsType,
    library: ArrayType(CalendarLibraryTabType), inspector: BooleanType, slice: OptionType(RecordSlicesChromeType),
    narrowed: DictType(StringType, RowSourceType(ArrayType(StringType))),
    canDrop: OptionType(FunctionType([ScheduleCandidateType], OptionType(StringType))),
    optimise: OptionType(FuncBindingType),
    onSelect: OptionType(FunctionType([ScheduleEventRefType], NullType)), id: OptionType(StringType),
});
/** The extension carrier registered by e3-ui-components. */
export const CalendarComponent = EastUI.component("Calendar", CalendarPayloadType, { optional: true });

/** One declared library tab. Omit the library to omit its pane. */
export type CalendarLibraryTab = { readonly kind: "templates" | "backlog" } | ScheduleTabDeclaration;
/** Reads every kind's templates, including templates from bound records. */
function templatesTab(): CalendarLibraryTab { return { kind: "templates" }; }
/** Reads each kind's unscheduled rows from its bound event record. */
function backlogTab(): CalendarLibraryTab { return { kind: "backlog" }; }
/**
 * Declares an author's library tab over keyed data.
 * @param rows - The card rows, usually a bound record's read()
 * @param config - The card's name, accessors and optional field patch
 * @returns The declared tab
 */
function authorTab<K extends EastType, R extends EastType, P extends EastType = EastType>(
    rows: SubtypeExprOrValue<DictType<K, R>>, config: ScheduleLibraryTabConfig<K, R, P>,
): CalendarLibraryTab {
    return { kind: "tab", rows, config: config as unknown as ScheduleLibraryTabConfig<EastType, EastType> };
}

/** Calendar's author-facing props; no frame or layout plumbing is required. */
export interface CalendarProps {
    /** Event kinds, each bound to its own record and patch mutation. */
    events: Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>;
    /**
     * Resource kinds read from keyed data, commonly bound records — or one of them a paged read of its record
     * (`Calendar.resources(Data.bindPaged(record), { … })`, #1424): its resources come a window at a time, the timeline's
     * rows and the Resources view's columns the windows around the view, its Choosers searching it by key. An event kind
     * placed on it is read a cell at a time: its source of the slice lists a series index and a summary index of its
     * record (`e3.recordIndex.series`, `e3.recordIndex.summary`, filed by its resource field over its own times) beside
     * its interval index, or it is refused.
     */
    resources?: Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;
    /**
     * The narrowing: `Slice.bindRecords(key, { … })`, one rail, a source per record it narrows (#1343). A source named
     * after an event kind's slot (`job`) narrows that kind's events in every layout, its backlog and its choices,
     * through its interval index — its `range` the kind's start field, which the Calendar's navigation writes in
     * every event source at once — and the kind gives `entries` beside it. A source named after a resource kind's slot
     * (`machines`) narrows its columns, rows and choices — a paged kind's windows are its narrowed rows themselves,
     * `Data.bindPaged(record, { indexes })` over the kind's own record, in its index's order (#1424). A source a templates
     * list or a tab names narrows its cards. Overlaps and checks read every event. Omitted, no Slice controls.
     */
    slice?: RecordSlicesChromeOptions;
    /** The library's tabs, in order; omitted or empty, no start pane. */
    library?: readonly CalendarLibraryTab[];
    /** Shows the inspector pane. */
    inspector?: boolean;
    /** Disables every edit, write and drag while retaining navigation and selection. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** Initial layout, period and date. Viewer changes persist under id. */
    view?: { layout?: "calendar" | "resources" | "timeline"; period?: "day" | "week" | "month"; date?: SubtypeExprOrValue<DateTimeType> };
    /** Working hours, shaded outside this interval; defaults to 06–22 UTC. */
    hours?: { from: bigint; to: bigint };
    /** Initial week start and visibility of weekends. */
    week?: { start?: "monday" | "sunday"; weekends?: boolean };
    /** Time-grid and timeline spacing. */
    density?: "compact" | "comfortable" | "spacious";
    /** Pins the now line for a reproducible view; otherwise it follows the clock. */
    now?: SubtypeExprOrValue<DateTimeType>;
    /** Refuses a candidate placement with a message; none permits it. */
    canDrop?: SubtypeExprOrValue<FunctionType<[typeof ScheduleCandidateType], OptionType<StringType>>>;
    /**
     * The app's optimiser (#1409): `Func.bind` of its `e3.function` from `Calendar.Types.OptimiseRequest(E, S)` — the window in
     * view, the run number, every event kind's rows in the window and its backlog by slot and by key, and the resource kinds'
     * rows as context — to `Calendar.Types.OptimiseResult(E)`, the events complete. `E` and `S` are the kinds' row types by slot
     * (`Calendar.Types.OptimiseRequest({ job: Job }, { machines: Machine })`); a kind keyed otherwise than by String gives its
     * record type, `DictType(K, R)`. The Elara eye in the toolbar calls it once per run; the result lands in the session as one
     * edit, which one Undo reverts and Save commits with everything else. Omitted, no eye. The tag cannot see its kinds' row
     * types in TypeScript, so it checks the handle at build, and refuses one over other rows naming both.
     */
    optimise?: OptimiseHandle;
    /** Observes each selected event's kind and record key. */
    onSelect?: SubtypeExprOrValue<FunctionType<[typeof ScheduleEventRefType], NullType>>;
    /** Keeps this calendar's view, library, panes and editing history distinct. */
    id?: string;
}

/**
 * Validates the declarations and assembles Calendar's interface. View and
 * interaction behavior belongs to the renderer, not this factory.
 * @param props - Calendar's props
 * @returns The closed payload
 * @throws {Error} When kinds or library tabs are invalid, a kind has no `title` (#1367), working hours are outside the
 *   day, `slice` is not `Slice.bindRecords` or names a source no kind, templates list or tab names, a templates list is
 *   written in the code or names no source of the slice (templates are records, #1340), or a tab names a source the
 *   slice lacks, or `optimise` is not `Func.bind` of a function from `OptimiseRequest(E, S)` to `OptimiseResult(E)` over
 *   the kinds' rows (#1409); more than one resource kind is paged, or an event kind is placed on the paged kind and on
 *   another, or with no source of the slice — its record read whole, or the days in view read through its day index —
 *   each naming the series and summary indexes to declare over the kind's own fields (#1424). The series and summary
 *   indexes an event kind's source lists are refused in the same words as the Calendar is evaluated, the source's
 *   indexes read only then: one filed by another field than the kind's resource, or over other times than its events';
 *   a series index for a kind not placed on the paged kind alone; two series, or two summaries, by one tile over the
 *   same fields; a series index with no summary beside it; and, for a kind on the paged kind, a source listing no
 *   series index
 * @internal
 */
export function createCalendarPayload(props: CalendarProps): ExprType<typeof CalendarPayloadType> {
    const resources = props.resources ?? {};
    scheduleCheck(resources, props.events, "Calendar");
    // A calendar pages one resource kind (#1424), and an event kind placed on it is read a cell at a time.
    const resourceKinds = Object.entries(resources);
    checkSchedulePagedKinds(resourceKinds, "Calendar", "a calendar");
    // The Calendar draws each event's title, which `Schedule.events` takes as optional.
    scheduleTitled(props.events, "Calendar");
    if (Object.keys(props.events).length === 0) throw new Error("Calendar: declare at least one event kind");
    const hours = props.hours ?? { from: 6n, to: 22n };
    if (hours.from < 0n || hours.to > 24n || hours.from >= hours.to) throw new Error("Calendar: hours must satisfy 0 <= from < to <= 24");
    const events = Object.entries(props.events);
    // The app's optimiser (#1409), held to the kinds' rows by slot.
    const optimise = props.optimise === undefined ? undefined : scheduleOptimiseBinding("Calendar", props.optimise, events, Object.entries(resources));
    // Every templates list is a record of its own, naming its source of the slice (#1340): one written in the code,
    // or naming none the slice holds, is refused before a source no list names is, so the refusal says the change. A
    // slice of another kind is refused below, as such.
    const sliceNames = sliceSourceNames(props.slice);
    if (props.slice === undefined || sliceNames.length > 0) {
        for (const [slot, kind] of events) {
            if (kind.templatesList !== "none") templatesSource("Calendar", `Calendar.templates(rows, { …, source: "${slot}Templates" })`, kind.templatesSource, sliceNames);
        }
    }
    // The sources a Calendar takes: an event kind's or a resource kind's slot, or one a templates list or a tab names.
    const named = new Set([...Object.keys(props.events), ...Object.keys(resources),
        ...events.flatMap(([, kind]) => kind.templatesSource === undefined ? [] : [kind.templatesSource]),
        ...(props.library ?? []).flatMap(tab => tab.kind === "tab" && tab.config.source !== undefined ? [tab.config.source] : [])]);
    const narrowing = recordSources(props.slice, { builder: "Calendar", names: [...named], what: "its event kinds, its resource kinds and the templates and tabs that name a source",
        takes: name => named.has(name) });
    checkSchedulePagedEventKinds(resourceKinds, events, narrowing.names, "Calendar");
    const seen = new Set<string>();
    const library = (props.library ?? []).map(tab => {
        const name = tab.kind === "tab" ? "tab:" + tab.config.name : tab.kind;
        if (seen.has(name)) throw new Error("Calendar: library tab " + name + " is listed twice");
        seen.add(name);
        return tab.kind === "tab"
            ? East.value(variant("tab", buildScheduleTab(tab, events, "Calendar", narrowing.names)), CalendarLibraryTabType)
            : East.value(variant(tab.kind, null), CalendarLibraryTabType);
    });
    return Expr.block($ => {
        const bound = narrowing.bind($);
        // The series and summary indexes each event kind's source lists (#1424), its record's, read as the Calendar is evaluated.
        for (const [slot, kind] of events) {
            const part = bound.parts[slot] as unknown as { config: ExprType<typeof RecordSliceConfigType> } | undefined;
            if (part !== undefined) $(checkedScheduleTilings(slot, kind, resourceKinds, part.config, "Calendar"));
        }
        // A paged resource kind its source of the slice narrows pages the narrowing's rows themselves (#1424).
        const pagedSlot = resourceKinds.find(([, kind]) => kind.window !== undefined)?.[0];
        const paged = createCalendarPaged(resourceKinds, pagedSlot === undefined ? undefined : bound.data[pagedSlot]);
        return East.value({
            // Each event kind narrowed through its own source of the slice, when the slice has one.
            events: events.map(([slot, kind]) => kind.build(slot, bound.parts[slot])),
            resources: resourceKinds.map(([slot, kind]) => kind.build(slot)),
            paged: paged === undefined ? East.value(none, OptionType(CalendarPagedType)) : East.value(some(paged), OptionType(CalendarPagedType)),
            settings: {
                layout: variant(props.view?.layout ?? "calendar", null), period: variant(props.view?.period ?? "week", null),
                date: props.view?.date === undefined ? none : some(props.view.date), hours,
                weekStart: variant(props.week?.start ?? "monday", null), weekends: props.week?.weekends ?? true,
                density: variant(props.density ?? "comfortable", null), now: props.now === undefined ? none : some(props.now),
                readOnly: props.readOnly ?? false,
            },
            library, inspector: props.inspector ?? false,
            slice: narrowing.chrome,
            narrowed: new Map(narrowing.names.map(source => [source, bound.keys[source] as never])),
            canDrop: props.canDrop === undefined ? none : some(props.canDrop),
            optimise: optimise === undefined ? none : some(optimise),
            onSelect: props.onSelect === undefined ? none : some(props.onSelect), id: props.id === undefined ? none : some(props.id),
        }, CalendarPayloadType);
    }) as ExprType<typeof CalendarPayloadType>;
}

/** The tag and the shared Schedule authoring helpers. */
export interface CalendarNamespace extends Omit<ScheduleNamespace, "Types"> {
    /** Renders a record-backed calendar. */
    (props: CalendarProps): UIElement;
    /** Declares the library's tabs. */
    library: { templates: typeof templatesTab; backlog: typeof backlogTab; tab: typeof authorTab };
    /** Shared schedule types, Calendar's view state, and the optimiser's request and answer over its kinds (#1409). */
    Types: ScheduleNamespace["Types"] & {
        Layout: typeof CalendarLayoutType; Period: typeof CalendarPeriodType; View: typeof CalendarViewType;
        /** `OptimiseRequest(E, S)` — what the app's optimiser is asked: the window, the run, every event kind's rows and the resource kinds' by slot. */
        OptimiseRequest: typeof ScheduleOptimiseRequestTypeFor;
        /** `OptimiseResult(E)` — what it answers: the events, complete. */
        OptimiseResult: typeof ScheduleOptimiseResultTypeFor;
    };
}

/**
 * Schedules typed records in calendar, resource and timeline views. Optional
 * library and inspector panes share the builders' responsive frame; gestures
 * are drafts in the shared editing history, committed with Save. A readOnly
 * calendar keeps navigation, selection and overlap warnings.
 *
 * @param props - Event and resource kinds, library, inspector and initial view
 * @returns The Calendar extension
 * @remarks Carries Schedule's events, resources, templates, field, patch,
 * days and unscheduled helpers, its Types, and Calendar.library.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, StringType, StructType } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Calendar, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const CalendarAppointment = StructType({ title: StringType, start: DateTimeType, end: DateTimeType });
 * export const calendarAppointments = e3.record("calendar_appointments", DictType(StringType, CalendarAppointment), new Map([
 *     ["check", { title: "Safety check", start: new Date("2026-10-01T09:00:00Z"), end: new Date("2026-10-01T10:00:00Z") }],
 *     ["review", { title: "Production review", start: new Date("2026-10-01T11:00:00Z"), end: new Date("2026-10-01T12:00:00Z") }],
 * ]));
 * export const calendarAppointmentsPatch = e3.mutation.patch(calendarAppointments);
 *
 * const appointmentsCalendar = East.function([], UIComponentType, _$ => <Reactive>{$ => {
 *     const appointments = $.let(Record.bind(calendarAppointments, [calendarAppointmentsPatch]));
 *     return <Box height="640px"><Calendar inspector view={{ period: "day", date: new Date("2026-10-01T00:00:00Z") }}
 *         events={{ appointment: Calendar.events(appointments, { name: "Appointment", icon: "calendar", title: "title", start: "start", end: "end" }) }} />
 *     </Box>;
 * }}</Reactive>);
 * ```
 */
export const Calendar: CalendarNamespace = Object.assign(
    (props: CalendarProps): UIElement => CalendarComponent.Root(createCalendarPayload(props)),
    { ...Schedule, library: { templates: templatesTab, backlog: backlogTab, tab: authorTab },
        Types: { ...Schedule.Types, Layout: CalendarLayoutType, Period: CalendarPeriodType, View: CalendarViewType,
            OptimiseRequest: ScheduleOptimiseRequestTypeFor, OptimiseResult: ScheduleOptimiseResultTypeFor } },
);
