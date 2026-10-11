/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FunctionType, IntegerType, NullType, OptionType, StringType,
    StructType, VariantType, none, some, variant, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, type UIElement } from "@elaraai/east-ui";
import { SliceAffordanceType, SliceBindType, SliceChromeType, type SliceAffordanceLiteral } from "@elaraai/east-ui/internal";
import { Schedule, scheduleCheck, type ScheduleNamespace } from "../schedule/index.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { ScheduleAuthorTabType, buildScheduleTab, type ScheduleTabDeclaration, type ScheduleLibraryTabConfig } from "../schedule/library.js";
import { ScheduleCandidateType, ScheduleEventRefType, ScheduleKindType, ScheduleResourcesType } from "../schedule/types.js";

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
/** Calendar's closed interface to its React renderer. The frame is a renderer detail. */
export const CalendarPayloadType = StructType({
    events: ArrayType(ScheduleKindType), resources: ArrayType(ScheduleResourcesType), settings: CalendarSettingsType,
    library: ArrayType(CalendarLibraryTabType), inspector: BooleanType, slice: OptionType(SliceChromeType),
    canDrop: OptionType(FunctionType([ScheduleCandidateType], OptionType(StringType))),
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
    /** Resource kinds read from keyed data, commonly bound records. */
    resources?: Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;
    /**
     * Author-bound Slice, as in Plan. Its datetime range drives the indexed
     * event window; navigation writes the same range. Narrow event rows with
     * the shared Slice engine in each kind's `filter` accessor. The renderer
     * never creates its own filter dataset. Omitted, no Slice controls.
     */
    slice?: {
        /** The handle declared with Slice.bind in the authoring Reactive block. */
        slice: SubtypeExprOrValue<SliceBindType>;
        /** Shared controls to mount, in order; defaults to filter and search. */
        affordances?: SliceAffordanceLiteral[];
    };
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
 * @throws {Error} When kinds or library tabs are invalid, or working hours are outside the day
 * @internal
 */
export function createCalendarPayload(props: CalendarProps): ExprType<typeof CalendarPayloadType> {
    const resources = props.resources ?? {};
    scheduleCheck(resources, props.events, "Calendar");
    if (Object.keys(props.events).length === 0) throw new Error("Calendar: declare at least one event kind");
    const hours = props.hours ?? { from: 6n, to: 22n };
    if (hours.from < 0n || hours.to > 24n || hours.from >= hours.to) throw new Error("Calendar: hours must satisfy 0 <= from < to <= 24");
    const events = Object.entries(props.events);
    const seen = new Set<string>();
    const library = (props.library ?? []).map(tab => {
        const name = tab.kind === "tab" ? "tab:" + tab.config.name : tab.kind;
        if (seen.has(name)) throw new Error("Calendar: library tab " + name + " is listed twice");
        seen.add(name);
        return tab.kind === "tab"
            ? East.value(variant("tab", buildScheduleTab(tab, events, "Calendar")), CalendarLibraryTabType)
            : East.value(variant(tab.kind, null), CalendarLibraryTabType);
    });
    return East.value({
        events: events.map(([slot, kind]) => kind.build(slot)),
        resources: Object.entries(resources).map(([slot, kind]) => kind.build(slot)),
        settings: {
            layout: variant(props.view?.layout ?? "calendar", null), period: variant(props.view?.period ?? "week", null),
            date: props.view?.date === undefined ? none : some(props.view.date), hours,
            weekStart: variant(props.week?.start ?? "monday", null), weekends: props.week?.weekends ?? true,
            density: variant(props.density ?? "comfortable", null), now: props.now === undefined ? none : some(props.now),
            readOnly: props.readOnly ?? false,
        },
        library, inspector: props.inspector ?? false,
        slice: props.slice === undefined ? none : some(East.value({
            slice: props.slice.slice,
            affordances: East.value((props.slice.affordances ?? ["filter", "search"]).map(a => variant(a, null)), ArrayType(SliceAffordanceType)),
        }, SliceChromeType)),
        canDrop: props.canDrop === undefined ? none : some(props.canDrop),
        onSelect: props.onSelect === undefined ? none : some(props.onSelect), id: props.id === undefined ? none : some(props.id),
    }, CalendarPayloadType);
}

/** The tag and the shared Schedule authoring helpers. */
export interface CalendarNamespace extends Omit<ScheduleNamespace, "Types"> {
    /** Renders a record-backed calendar. */
    (props: CalendarProps): UIElement;
    /** Declares the library's tabs. */
    library: { templates: typeof templatesTab; backlog: typeof backlogTab; tab: typeof authorTab };
    /** Shared schedule types and Calendar's view state. */
    Types: ScheduleNamespace["Types"] & { Layout: typeof CalendarLayoutType; Period: typeof CalendarPeriodType; View: typeof CalendarViewType };
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
        Types: { ...Schedule.Types, Layout: CalendarLayoutType, Period: CalendarPeriodType, View: CalendarViewType } },
);
