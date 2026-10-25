/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Plan>` (#1191): the axis-aligned planning canvas, the one Plan. It renders
 * in its `BuilderFrame` wherever it is used — one toolbar holding every
 * control, the banners, the canvas in main and the footer (#1193) — and its
 * panes are optional props (#1195, #1197): no prop, no pane.
 *
 * Its rows come from any of three sources, in this order down the canvas:
 * - **event kinds over records**: `resources`, the rows, and `events`, the
 *   kinds placed on them — `Schedule`'s, the very values a Calendar takes,
 *   each kind a record of its own committed through its patch mutation;
 * - **`data` and its `series`** (or `pick`): a keyed source's entries laid out
 *   by `Plan.series.*`, on any axis, edited in place through `editing` (#880);
 * - **`rows`**: hand-built rows (`Plan.chart`, …) and `Plan.over(data,
 *   [series…])`, read only.
 *
 * Pinned rows of any source sit under the ruler. An event is scheduled in
 * time, so event kinds need a time axis.
 *
 * Its narrowing is one `Slice.bindRecords`, one rail on its toolbar (#1344):
 * its `rows` source gives the canvas its rows, paged from it; a source named
 * after an event kind narrows that kind's events and its backlog through its
 * interval index; one named after a resource kind narrows its rows — a paged
 * kind's paged from it, the narrowing's rows in its index's order; and one a
 * templates list or a tab names narrows its cards. Every source holding a
 * `range` holds the window with the others — an event kind's, a tab's that
 * lists what is in the dates on screen. The canvas's rows never follow the
 * dates: a `range` on the `rows` source or a resource kind's would hold the
 * window, and is refused — a date field there is a field of the rail the
 * viewer sets. Templates are records, each list its own source (#1340).
 *
 * An event kind on a paged resource kind is read a cell at a time (#1039):
 * its source of the slice lists a series index and a summary index of its
 * record, filed by its resource field over its own times, and anything else
 * — the source's interval index alone, no source, the record read whole, its
 * days read through a day index — is refused, naming both declarations over
 * the kind's own fields. Every other kind is counted before its events are
 * read, and past `SCHEDULE_EVENT_CAP` of them in the range the canvas reads,
 * none is read or drawn: its rows shade from its source's summary, or are
 * hatched and the frame says how many there are.
 *
 * The Plan is an interface. Its payload holds the canvas whole
 * ({@link PlanRootType}, its narrowing's chrome among it) beside the event
 * kinds and resources as Plan takes them (`PlanEventKindType`,
 * `PlanResourcesType`, #1190), the resources' rows over a window (`blocks`,
 * #1192) and a paged resource kind's a window of its resources at a time
 * (`paged`, #1199), the event kinds' drop veto, the settings, the library's
 * tabs, whether it has an inspector, and each source's narrowed keys. The
 * `Plan` renderer in `@elaraai/e3-ui-components` draws it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    DateTimeType,
    DictType,
    East,
    Expr,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    none,
    printType,
    some,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { CanDropFnType, EastUI, RowSourceType, type UIElement } from "@elaraai/east-ui";
import {
    RecordSliceConfigType, resolveRowSource, type RecordSliceAffordance, type RecordSlicesChromeOptions,
} from "@elaraai/east-ui/internal";
import { FuncBindingType } from "../bind/func.js";
import type { OptimiseHandle } from "../utils/optimise.js";
import { PlanEventKindType, PlanResourcesType, ScheduleCandidateType } from "../schedule/types.js";
import { scheduleCheck, scheduleTitled } from "../schedule/index.js";
import { checkSchedulePagedEventKinds, checkSchedulePagedKinds, checkedScheduleTilings } from "../schedule/cell-checks.js";
import { scheduleOptimiseBinding } from "../schedule/optimise.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { recordSources, sliceSourceNames, templatesSource } from "../utils/record-sources.js";
import { PlanRootType } from "./ir.js";
import { PlanAxisType, PlanBlocksType, PlanLinkType, PlanRowsCollectionType, PlanRunRefType, type PlanAxisKindLiteral, type PlanRowsValue } from "./types.js";
import { WINDOWLESS_AXES, axisKindOf, linkEventKinds } from "./builders.js";
import { buildPlanRoot, type PlanConfig } from "./root.js";
import { overSeriesKeys, type PlanOverRows } from "./over.js";
import { planSeriesKeys } from "./series.js";
import { PlanEventBlocksType, PlanEventPagedType, createEventBlocks, createEventPaged, eventDrawsOf } from "./event-rows.js";
import { PlanLibraryTabType, buildLibrary, type PlanLibraryTab } from "./library.js";

export {
    PlanEventBlocksType, PlanEventDraftsType, PlanEventPagedType, PlanEventPlacedType, PlanEventReadsType, PlanEventShadeType, PlanEventShadingType,
    PlanEventShownType,
} from "./event-rows.js";

// ============================================================================
// The Plan's shared keys
// ============================================================================

/**
 * The names a Plan keeps its viewer's state under, by its `id`: its frame's
 * panes (their open tab and collapsed state), the series this viewer hides,
 * its library's drag-source id, and the Plan's drop target.
 *
 * @remarks
 * As the Sheet's `sheetKeys` and Studio's `builderKeys`: two Plans on one
 * surface keep apart only when each is named.
 *
 * @param id - The Plan's `id`, when a surface holds more than one; omitted, the one Plan
 * @returns The keys
 */
export function planKeys(id: string | undefined): {
    /** The frame's storage key: each pane's open tab and collapsed state. */
    frame: string;
    /** The series, kinds and measures this viewer hides. */
    series: string;
    /** The library's drag-source id: what the Plan takes cards from. */
    library: string;
    /** The Plan's drop target: where the library's cards and the canvas's elements land. */
    surface: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        frame: `plan${suffix}.frame`,
        series: `plan${suffix}.series`,
        library: `plan.library${suffix}`,
        surface: `plan${suffix}.surface`,
    };
}

// ============================================================================
// The renderer's payload
// ============================================================================

/** An event kind's drop veto: where the drop would put the event, to the refusal's message, or `none` to let it land. */
export const PlanEventCanDropType = FunctionType([ScheduleCandidateType], OptionType(StringType));

/** Type representing {@link PlanEventCanDropType}. */
export type PlanEventCanDropType = typeof PlanEventCanDropType;

/**
 * How a Plan's event kinds behave beside its canvas.
 *
 * @property applyMode - When the event kinds' ready drafts go: on Save (`batch`), or as each gesture lands (`auto`)
 * @property date - The date brought into view first; `none`, the axis's window from its start
 */
export const PlanSettingsType = StructType({
    applyMode: VariantType({ batch: NullType, auto: NullType }),
    date: OptionType(DateTimeType),
});

/** Type representing {@link PlanSettingsType}. */
export type PlanSettingsType = typeof PlanSettingsType;

/**
 * The `Plan` renderer's payload: the Plan's interface.
 *
 * @property plan - The canvas whole: its axis, its rows over `data` followed by `rows`, its links, editing session and the rest
 * @property resources - The resource kinds, in the order `resources` lists them, their rows resolved
 * @property events - The event kinds, in the order `events` lists them, each closed behind its seams
 * @property blocks - The resources' rows over a window, every kind's drafts in place; `none` while the Plan has no event kinds
 * @property paged - A paged resource kind's rows, a window of its resources at a time (#1199) — of the narrowing's, when its source of the slice narrows it (#1344); `none` while no resource kind is paged
 * @property canDrop - The event kinds' drop veto; `none`, every drop the kinds take lands
 * @property optimise - The app's optimiser, by its `e3.function`'s name (#1409): what the Elara eye calls over the plan window in
 *   view, its result one edit of the session; `none`, no eye
 * @property settings - When the event kinds' drafts go, and the date brought into view first
 * @property library - The library pane's tabs, in the order `library` lists them; empty, no pane (#1195)
 * @property inspector - Whether the Plan has an inspector pane, showing what is selected (#1197)
 * @property narrowed - Each source of the slice's narrowed keys, paged through its own data, by the source's name
 *   (#1344): what the rows of a resource kind read whole, a templates list's cards and an author's tab read to show a
 *   source's rows; `rows` gives the canvas its rows, a paged resource kind's source its windows (`paged`), and an event
 *   kind reads its own narrowing through its part
 */
export const PlanPayloadType = StructType({
    plan: PlanRootType,
    resources: ArrayType(PlanResourcesType),
    events: ArrayType(PlanEventKindType),
    blocks: OptionType(PlanEventBlocksType),
    paged: OptionType(PlanEventPagedType),
    canDrop: OptionType(PlanEventCanDropType),
    optimise: OptionType(FuncBindingType),
    settings: PlanSettingsType,
    library: ArrayType(PlanLibraryTabType),
    inspector: BooleanType,
    narrowed: DictType(StringType, RowSourceType(ArrayType(StringType))),
});

/** Type representing the `Plan` renderer's payload. */
export type PlanPayloadType = typeof PlanPayloadType;

/**
 * The `Plan` carrier: `<Plan>` builds a {@link PlanPayloadType} and returns
 * it through this {@link EastUI.component}. The React renderer registers
 * against it in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const PlanComponent = EastUI.component("Plan", PlanPayloadType, { optional: true });

// ============================================================================
// <Plan>'s props
// ============================================================================

/**
 * One of a Plan's `rows`: a hand-built row stream (`Plan.chart`, `Plan.span`,
 * …) or `Plan.over(data, [series…])`'s blocks. Either is branded with the
 * axis kind its instants ride, so a row on another arm than the axis's fails
 * to compile; an erased one — held in a variable — is held to it at render.
 *
 * @typeParam K - The axis kind its instants ride
 */
export type PlanRowsItem<K extends PlanAxisKindLiteral = never> = PlanRowsValue<K> | PlanOverRows<K>;

/**
 * `<Plan>`'s props: the canvas's ({@link PlanConfig}), with `data` optional,
 * and the event kinds, the read-only `rows`, and how the kinds' drafts go.
 *
 * @remarks
 * `K` is the canvas's axis kind, inferred from `axis` alone: every series and
 * hand-built row must lie within it (a `"time"` series on a `"number"` axis
 * fails to compile here), and event kinds need a time axis.
 *
 * @typeParam K - The canvas's axis kind, inferred from `axis`
 */
export interface PlanProps<K extends PlanAxisKindLiteral = PlanAxisKindLiteral> extends Omit<PlanConfig<K>, "data" | "canDrop"> {
    /** The rows' source — a keyed collection, a bind handle over one or a paged source of one, laid out by `series` or `pick` (see {@link PlanConfig}). Leave it out for a Plan of event kinds or `rows` alone, and beside `slice`'s `rows` source, which gives the rows. */
    data?: PlanConfig<K>["data"];
    /**
     * The narrowing (#1344): `slice={{ slice: Slice.bindRecords(key, { rows, … }) }}`, one rail on the toolbar, with
     * its `affordances` and `persist`. Its `rows` source gives the canvas its rows, paged from it in its index's order —
     * `data` then gives none — laid out by `series`, edits reaching the record through `editing.onApply`
     * (`Record.onApply(record, { keyed: true })`). A source named after an event kind's slot narrows that kind's events
     * and its backlog through the source's interval index, its `range` the kind's start field; one named after a
     * resource kind's slot narrows that kind's rows — a paged kind's (`Schedule.resources(Data.bindPaged(record), …)`)
     * are paged from the source itself, `Data.bindPaged(record, { indexes })` over the kind's own record, the narrowing's
     * rows in its index's order, so a choice reads only the narrowed resources in view; one a templates list or a
     * library tab names narrows its cards.
     * Every source holding a `range` holds the window with the others: the toolbar's navigation and range, the horizon
     * brush and the resolution write them together. The canvas's rows never follow the dates on screen: the `rows`
     * source and a resource kind's take no `range` — a date field there is a field of the rail the viewer sets — and a
     * slice with no source holding the window leaves the canvas its own, which the same controls move. Calculations —
     * the footer's counts, the overlaps — read every event. `Slice.bind`, a single `Slice.bindRecord` and a source
     * nothing names are refused.
     */
    slice?: RecordSlicesChromeOptions;
    /** The resource kinds, by slot — `Schedule.resources(rows, { … })`, or a paged read of them: the rows events are placed on, in this order. */
    resources?: Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;
    /** The event kinds, by slot — `Schedule.events(record, { … })`, each a record of its own: at least one, when given. An event is scheduled in time, so they need a time axis. */
    events?: Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>;
    /** Read-only rows: hand-built rows (`Plan.chart({ … })`) and `Plan.over(data, [series…])`. Pinned rows sit under the ruler; the rest follow the resources and `data`'s rows. */
    rows?: readonly PlanRowsItem<NoInfer<K>>[];
    /** When the event kinds' ready drafts go: on Save (`"batch"`, the default), or as each gesture lands (`"auto"`). `data`'s session takes `editing.mode`. */
    applyMode?: "batch" | "auto";
    /** The date brought into view first; omitted, the axis's window from its start. */
    date?: SubtypeExprOrValue<DateTimeType>;
    /**
     * The library pane's tabs, in order (#1195) — `Plan.library.events()`,
     * `Plan.library.backlog()`, `Plan.library.series()` and
     * `Plan.library.tab(rows, { … })`, cards of the author's own. Left out, or
     * empty, the Plan has no library pane.
     */
    library?: readonly PlanLibraryTab[];
    /**
     * The inspector pane (#1197): what is selected on the canvas — one event,
     * several, a row, or the window's totals when nothing is. One event shows
     * its kind's form over `fields`, or the kind's own `inspector`
     * (`Schedule.events`). Left out, or `false`, the Plan has no inspector
     * pane. It shows the event kinds' events and the resources' rows, so it
     * needs `events`.
     */
    inspector?: boolean;
    /**
     * The drop veto, by what it vets — its arm from its East type:
     * `Fn(DragEvent) → Boolean` over a card or an element dragged onto
     * `data`'s rows, consulted where the drag rests and again before it
     * becomes a draft; or `Fn(Schedule.Types.Candidate) → Option<String>` over
     * an event kind's drop, its message on the ghost, as the Calendar's.
     */
    canDrop?: PlanConfig<K>["canDrop"] | SubtypeExprOrValue<PlanEventCanDropType>;
    /**
     * The app's optimiser (#1409): `Func.bind` of its `e3.function` from `Plan.Types.OptimiseRequest(E, S)` — the plan window in
     * view, the run number, every event kind's rows in the window and its backlog by slot and by key, and the resource kinds'
     * rows as context — to `Plan.Types.OptimiseResult(E)`, the events complete. `E` and `S` are the kinds' row types by slot
     * (`Plan.Types.OptimiseRequest({ job: PrintJob }, { presses: PrintPress })`); a kind keyed otherwise than by String gives
     * its record type, `DictType(K, R)`. The Elara eye in the toolbar calls it once per run; the result lands in the session as
     * one edit, which one Undo reverts and Save commits with everything else. It sends the event kinds' rows, so it needs
     * `events`. Omitted, no eye. The tag cannot see its kinds' row types in TypeScript, so it checks the handle at build, and
     * refuses one over other rows naming both.
     */
    optimise?: OptimiseHandle;
}

/** The props, erased — what the implementation reads. */
type PlanAnyProps = PlanProps & Record<string, unknown>;

/** The ways a Plan's event kinds' drafts go. */
const APPLY_MODES: readonly string[] = ["batch", "auto"];

/** The source of a Plan's slice that gives the canvas its rows (#1344). */
const ROWS = "rows";

/** The record rail's controls a Plan mounts unless its `slice` lists its own: the field chips, the presets, the summary and the horizon brush. */
const PLAN_AFFORDANCES: readonly RecordSliceAffordance[] = ["fields", "presets", "summary", "brush"];

/** What a Plan's slice narrows, as the refusal of a source nothing names says it. */
const NARROWS = "its rows, its event kinds, its resource kinds, and the templates lists and tabs that name a source";

/** Each source's narrowed keys on the wire, by the source's name. */
const NarrowedType = PlanPayloadType.fields.narrowed;

/**
 * A Plan's `rows` as fixed blocks: each hand-built stream one block, each
 * `Plan.over` its blocks, in order. Every one is fixed: no entry of `data`
 * produces it, so a paged canvas serves it with every window and draws it
 * once.
 *
 * @param rows - The `rows` prop
 * @returns The blocks
 * @throws {Error} Naming an item that is neither
 */
function rowsBlocks(rows: readonly unknown[]): ExprType<PlanBlocksType> {
    return rows.map((item, i) => {
        const value = East.value(item as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const type = Expr.type(value as unknown as Expr) as EastType;
        if (isTypeEqual(type, PlanBlocksType)) {
            return (value as unknown as ExprType<PlanBlocksType>).map((_$, block) => ({ fixed: true, parent: block.parent, rows: block.rows }));
        }
        if (isTypeEqual(type, PlanRowsCollectionType)) {
            return East.value([{ fixed: true, parent: none, rows: value as unknown as ExprType<PlanRowsCollectionType> }], PlanBlocksType);
        }
        throw new Error(`Plan: rows[${i}] is a row a kind factory builds (Plan.chart, Plan.span, …) or Plan.over(data, [series…]) — and this one is ${printType(type)}`);
    }).reduce<ExprType<PlanBlocksType>>((all, part) => all.concat(part) as ExprType<PlanBlocksType>, East.value([], PlanBlocksType));
}

/**
 * The words a Plan refuses event kinds on a number or ordinal axis in, at
 * build or as it is evaluated.
 *
 * @param arm - The axis, as the words name it
 * @param kinds - The event kinds' slots
 * @returns The refusal
 */
function timeAxisRefusal(arm: "a number" | "an ordinal", kinds: readonly string[]): string {
    return `Plan: an event is scheduled in time, and this is ${arm} axis — the event kinds (${kinds.join(", ")}) need a time axis: Plan.axis({ window, resolution })`;
}

/**
 * The words that follow a link's index and kind when a Plan refuses a link
 * naming an event kind it has not, at build or as it is evaluated.
 *
 * @param kinds - The event kinds' slots
 * @returns The refusal's tail
 */
function linkKindRefusalTail(kinds: readonly string[]): string {
    return `", and \`events\` has no kind of that name (${kinds.join(", ") || "none"})`;
}

/**
 * An axis held in a variable, checked as the Plan is evaluated: beside event
 * kinds it must be a time axis, or the Plan is refused in the words a build
 * uses.
 *
 * @param axis - The `axis` prop, held in a variable
 * @param kinds - The event kinds' slots
 * @returns The axis, checked
 */
function checkedTimeAxis(axis: unknown, kinds: readonly string[]): ExprType<PlanAxisType> {
    const onNumber = timeAxisRefusal("a number", kinds);
    const onOrdinal = timeAxisRefusal("an ordinal", kinds);
    const check = East.function([PlanAxisType], PlanAxisType, ($, held) => {
        $.match(held, {
            number: ($2) => { $2.error(onNumber); },
            ordinal: ($2) => { $2.error(onOrdinal); },
        });
        return held;
    });
    return check(East.value(axis as SubtypeExprOrValue<PlanAxisType>, PlanAxisType));
}

/**
 * Links whose kinds are not all known at build — a list held in a variable or
 * built in East, or a link whose event end was held in a variable — checked as
 * the Plan is evaluated: an end at no path is an event's (every row's path
 * holds at least its entry's key), and it names a kind the Plan has, or the
 * Plan is refused in the words a build uses.
 *
 * @param links - The `links` prop
 * @param kinds - The event kinds' slots
 * @returns The links, checked
 */
function checkedLinkKinds(links: unknown, kinds: readonly string[]): ExprType<ArrayType<PlanLinkType>> {
    const slots = new Set(kinds);
    const tail = linkKindRefusalTail(kinds);
    const check = East.function([ArrayType(PlanLinkType)], ArrayType(PlanLinkType), ($, all) => {
        const known = $.const(slots, SetType(StringType));
        const after = $.const(tail, StringType);
        const checkEnd = $.const(East.function([PlanRunRefType, IntegerType], NullType, ($2, end, i) => {
            $2.match(end.row, {
                entry: ($3, row) => {
                    $3.if(row.path.size().equal(0n).and(() => known.has(row.series).not()), ($4) => {
                        $4.error(East.value("Plan: links[").concat(East.print(i)).concat("] names the event kind \"").concat(row.series).concat(after));
                    });
                },
            });
        }));
        $.for(all, ($2, link, i) => {
            $2(checkEnd(link.from, i));
            $2(checkEnd(link.to, i));
        });
        return all;
    });
    return check(East.value(links as SubtypeExprOrValue<ArrayType<PlanLinkType>>, ArrayType(PlanLinkType)));
}

/**
 * A `range` on a source of the canvas's rows — the `rows` source's, or a
 * resource kind's — checked as the Plan is evaluated, its source's controls
 * read only then (#1344): the dates on screen never decide which rows are
 * listed, so a range there would hold the window and narrow the rows at every
 * pan; it is refused in words naming the change to make.
 *
 * @param source - The source's name: `rows`, or a resource kind's slot
 * @param config - The source's controls, its `range` among them
 * @returns The check, an expression run for its refusal
 */
function checkedRowsRange(source: string, config: ExprType<RecordSliceConfigType>): ExprType<NullType> {
    const holds = source === ROWS
        ? "Plan: the slice's `rows` source gives the canvas its rows, and its range \""
        : `Plan: the slice's source "${source}" narrows resources.${source}, and its range "`;
    const rule = source === ROWS ? "the rows never follow the dates on screen" : "a resource kind's rows never follow the dates on screen";
    const tail = `" would hold the window — ${rule}: leave \`range\` out, and "`;
    const check = East.function([RecordSliceConfigType], NullType, ($, held) => {
        $.match(held.range, {
            some: ($2, field) => {
                $2.error(East.value(holds).concat(field).concat(tail).concat(field).concat("\" stays a field of the rail the viewer sets"));
            },
        });
        return null;
    });
    return check(config);
}

// ============================================================================
// The payload
// ============================================================================

/**
 * Creates the Plan's payload alone — what `<Plan>` returns through the
 * `Plan` carrier — for the tests and the renderer's fixtures, which read it
 * whole.
 *
 * @param props - The Plan's props, as `<Plan>` takes them
 * @returns An East expression of {@link PlanPayloadType}
 * @throws {Error} Naming the prop and the remedy: no rows from any source; `resources` without `events`; an event kind's
 *   resource naming a slot `resources` has not, or one not keyed by String; an event kind with no `title` (#1367); event
 *   kinds on a number or ordinal axis; a
 *   link naming an event kind `events` has not; a `rows` item that is neither a hand-built row nor `Plan.over`'s; a
 *   `canDrop` over neither a drag nor a candidate, or over a candidate with no event kinds; an `optimise` with no event kinds,
 *   or one that is not `Func.bind` of a function from `OptimiseRequest(E, S)` to `OptimiseResult(E)` over the kinds' rows
 *   (#1409); an `applyMode` that is neither
 *   batch nor auto, or with no event kinds; an `inspector` with no event kinds; a resource kind with no event kind
 *   placed on it and no measures; more than one paged resource kind, or one beside a paged `data` (#1199); an event
 *   kind placed on a paged resource kind and on another, or with no source of the slice — its record read whole, or the
 *   days in view read through its day index (`window`) — each naming the series and summary indexes to declare over the
 *   kind's own fields (#1039);
 *   a key the Plan gives its event rows that another series has; a `slice` that is not `{ slice: Slice.bindRecords(…) }`
 *   — `Slice.bind`, a single `Slice.bindRecord`, the bare handle — or names a source nothing names, `data` beside its
 *   `rows` source, a resource kind not keyed by String its source would narrow, a paged one's source over rows not the
 *   kind's, and a kind's own `slice` or `filter` (#1344); an axis stating no window beside a slice whose every source is
 *   the canvas's rows' — `rows` or a resource kind's — which hold none; a templates list written in the code or naming
 *   no source of the slice (#1340); and everything the canvas refuses ({@link createPlanRoot}). An axis held in a
 *   variable, and links whose kinds are not known at build, are refused in the same words as the Plan is evaluated; so
 *   are a `range` on the `rows` source or a resource kind's, which the dates on screen never narrow (#1344), and the
 *   series and summary indexes an event kind's source lists (#1039), which the Plan reads only then: one filed by
 *   another field than the kind's resource, or over other times than its events'; a series index for a kind not placed
 *   on a paged resource kind alone; two series, or two summaries, by one tile over the same fields; a series index
 *   with no summary beside it; and, for a kind placed on a paged resource kind, a source listing no series index — its
 *   interval index alone, or a summary alone — each naming the indexes to declare over the kind's own fields
 * @internal
 */
export function createPlanPayload(props: PlanProps): ExprType<PlanPayloadType> {
    const { resources, events, rows, applyMode, date, canDrop, optimise, library, inspector, slice, ...canvas } = props as PlanAnyProps;
    // The narrowing's form #1344 retired, refused by name for an app that still passes it: the bare handle.
    if (slice instanceof Expr || (slice !== undefined && (typeof slice !== "object" || slice === null || !("slice" in slice)))) {
        throw new Error("Plan: `slice` takes { slice } — slice={{ slice: Slice.bindRecords(key, { rows, … }) }}: the bare handle is not taken");
    }
    const narrowing = slice as RecordSlicesChromeOptions | undefined;
    const kinds = events === undefined ? [] : Object.keys(events);
    if (events !== undefined) {
        scheduleCheck(resources ?? {}, events, "Plan");
        // A Plan draws each event's title, which `Schedule.events` takes as optional (#1367).
        scheduleTitled(events, "Plan");
    } else if (resources !== undefined) {
        throw new Error("Plan: `resources` are the rows events are placed on — declare `events`, the event kinds over records (Schedule.events)");
    }
    const resourceKinds = Object.entries(resources ?? {});
    const eventKinds = Object.entries(events ?? {});
    // The app's optimiser (#1409) is sent the event kinds' rows: a Plan of none has no eye.
    if (optimise !== undefined && events === undefined) {
        throw new Error("Plan: `optimise` sends the event kinds' rows to the app's optimiser, and this Plan has no event kinds — declare `events` (Schedule.events), or leave `optimise` out");
    }
    const optimiser = East.value(optimise === undefined ? none : some(scheduleOptimiseBinding("Plan", optimise, eventKinds, resourceKinds)), OptionType(FuncBindingType));
    // Templates are records (#1340): each event kind's list a `Schedule.templates` over its record, naming its source of
    // the slice — one written in the code, or naming none the slice holds, refused before a source no list names is, so
    // the refusal says the change to make. A slice of another kind is refused below, as such.
    const sliceNames = sliceSourceNames(narrowing);
    if (narrowing === undefined || sliceNames.length > 0) {
        for (const [slot, kind] of eventKinds) {
            if (kind.templatesList !== "none") templatesSource("Plan", `Schedule.templates(rows, { …, source: "${slot}Templates" })`, kind.templatesSource, sliceNames);
        }
    }
    // The sources a Plan takes: `rows`, an event kind's or a resource kind's slot, or one a templates list or a tab names.
    const named = new Set<string>([ROWS, ...kinds, ...resourceKinds.map(([slot]) => slot),
        ...eventKinds.flatMap(([, kind]) => (kind.templatesSource === undefined ? [] : [kind.templatesSource])),
        ...(library ?? []).flatMap((tab) => (tab.kind === "tab" && tab.config.source !== undefined ? [tab.config.source] : []))]);
    const sources = recordSources(narrowing === undefined ? undefined : { ...narrowing, affordances: narrowing.affordances ?? PLAN_AFFORDANCES },
        { builder: "Plan", names: [...named], what: NARROWS, takes: (name) => named.has(name) });
    // A resource kind's source narrows its rows by key, the source's record keys Strings: of resources read whole, the
    // ones it shows; a paged kind's (#1199) are paged from the source itself, the narrowing's rows in its index's order.
    for (const [slot, kind] of resourceKinds) {
        if (!sources.names.includes(slot)) continue;
        if (!isTypeEqual(kind.keyType, StringType)) {
            throw new Error(`Plan: the slice's source "${slot}" narrows resources.${slot} by its resources' keys, Strings as its record's are — ` +
                `and these are keyed by ${printType(kind.keyType)}`);
        }
    }
    // The `rows` source gives the canvas its rows, paged from it in its index's order (#1344).
    const pagesRows = sources.names.includes(ROWS);
    if (pagesRows && canvas.data !== undefined) {
        throw new Error("Plan: `slice`'s `rows` source gives the canvas its rows, paged from it — leave `data` out: " +
            "data={Slice.rows(slice)} is gone, and the Plan reads its rows from the slice: slice={{ slice }}");
    }
    if (canvas.data === undefined && !pagesRows && events === undefined && rows === undefined) {
        throw new Error("Plan: needs its rows — `data` and its `series`, `slice`'s `rows` source, event kinds (`events` over `resources`), or read-only `rows`");
    }
    // The canvas's rows never follow the dates (#1344): an axis stating no window takes it from a source holding it,
    // and a slice of the rows' sources alone — `rows`, the resource kinds' — holds none.
    const rowSources = [ROWS, ...resourceKinds.map(([slot]) => slot)];
    if (WINDOWLESS_AXES.has(canvas.axis as object) && sources.names.length > 0 && sources.names.every((name) => rowSources.includes(name))) {
        throw new Error("Plan: the axis states no `window`, and no source of the slice holds one — the canvas's rows never follow the dates on " +
            "screen, so neither the `rows` source nor a resource kind's holds the window: declare it, Plan.axis({ window: { min, max }, … }), " +
            "or name a range on an event kind's source or a tab's");
    }
    // An event is scheduled in time. An axis Plan.axis built is checked here;
    // one held in a variable as the Plan is evaluated, in the same words.
    const axisKind = axisKindOf(canvas.axis);
    if (kinds.length > 0 && axisKind !== undefined && axisKind !== "time") {
        throw new Error(timeAxisRefusal(axisKind === "number" ? "a number" : "an ordinal", kinds));
    }
    const axis = kinds.length > 0 && axisKind === undefined ? checkedTimeAxis(canvas.axis, kinds) : canvas.axis;
    // A link's event ends name kinds the Plan has. The kinds known at build
    // are checked here; the rest as the Plan is evaluated, in the same words.
    let links = canvas.links;
    if (links !== undefined) {
        const named = Array.isArray(links) ? (links as readonly unknown[]).map(linkEventKinds) : [undefined];
        named.forEach((ends, i) => {
            for (const kind of ends ?? []) {
                if (!kinds.includes(kind)) throw new Error(`Plan: links[${i}] names the event kind "${kind}${linkKindRefusalTail(kinds)}`);
            }
        });
        if (named.includes(undefined)) links = checkedLinkKinds(links, kinds) as unknown as typeof links;
    }
    if (applyMode !== undefined) {
        if (!APPLY_MODES.includes(applyMode)) throw new Error(`Plan: \`applyMode\` is "batch" or "auto" — and it is "${String(applyMode)}"`);
        if (events === undefined) throw new Error("Plan: `applyMode` says when the event kinds' drafts go, and this Plan has none — `data`'s session takes `editing.mode`");
    }
    if (inspector !== undefined && typeof inspector !== "boolean") {
        throw new Error("Plan: `inspector` is `true` for the inspector pane, or `false` or left out for none, and this one is no boolean — a kind's own inspector for one event is Schedule.events' `inspector`");
    }
    const inspected = inspector === true;
    if (inspected && events === undefined) {
        throw new Error("Plan: `inspector` shows the event kinds' events and the resources' rows, and this Plan has no event kinds — declare `events` (Schedule.events), or leave `inspector` out");
    }
    // The drop veto, by what it vets: a drag on `data`'s rows, or an event kind's drop.
    let canvasCanDrop: unknown;
    let eventCanDrop: ExprType<PlanEventCanDropType> | undefined;
    if (canDrop !== undefined) {
        const fn = East.value(canDrop as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const type = Expr.type(fn as unknown as Expr) as EastType;
        if (isTypeEqual(type, PlanEventCanDropType)) {
            if (events === undefined) throw new Error("Plan: `canDrop` over Schedule.Types.Candidate vets an event kind's drop, and this Plan has no event kinds");
            eventCanDrop = fn as unknown as ExprType<PlanEventCanDropType>;
        } else if (isTypeEqual(type, CanDropFnType)) {
            canvasCanDrop = fn;
        } else {
            throw new Error("Plan: `canDrop` vets a drop — Fn(DragEvent) → Boolean over a drag on `data`'s rows, or Fn(Schedule.Types.Candidate) → Option<String> over an event kind's drop, its message on the ghost — and this one is " + printType(type));
        }
    }
    const veto = East.value(eventCanDrop === undefined ? none : some(eventCanDrop), OptionType(PlanEventCanDropType));
    const settings = East.value({
        applyMode: variant(applyMode ?? "batch", null),
        date: date === undefined ? none : some(date),
    } as never, PlanSettingsType);
    // `data`'s series a viewer can hide are its picked ones, through the pick.
    const picked = canvas.pick !== undefined;
    return Expr.block(($) => {
        const bound = sources.bind($);
        // The canvas's rows never follow the dates (#1344): a range on the `rows` source or a resource kind's, which its
        // controls name only as the Plan is evaluated, is refused then.
        for (const name of sources.names) {
            const part = rowSources.includes(name) ? bound.parts[name] as unknown as { config: ExprType<RecordSliceConfigType> } | undefined : undefined;
            if (part !== undefined) $(checkedRowsRange(name, part.config));
        }
        // Each source's narrowed keys, paged through its own data: what the renderer reads to show a source's rows.
        const narrowed = East.value(new Map(sources.names.map((name) => [name, bound.keys[name]])) as never, NarrowedType) as ExprType<typeof NarrowedType>;
        const data = bound.data[ROWS] ?? canvas.data;
        // The canvas first, then the event kinds' rows, then the library: each refuses in that order.
        const plan = buildPlanRoot(
            { ...canvas, data, axis, links, ...(canvasCanDrop === undefined ? {} : { canDrop: canvasCanDrop }) } as Parameters<typeof buildPlanRoot>[0],
            rows === undefined ? (events !== undefined && data === undefined ? East.value([], PlanBlocksType) : undefined) : rowsBlocks(rows),
            sources.chrome,
        );
        if (events !== undefined) {
            checkPagedKinds(resourceKinds, data);
            checkSchedulePagedEventKinds(resourceKinds, eventKinds, sources.names, "Plan");
            checkEventRows(resourceKinds, eventKinds, canvas.series, rows);
            // The series and summary indexes each event kind's source lists (#1039), its record's, read as the Plan is evaluated.
            for (const [slot, kind] of eventKinds) {
                const part = bound.parts[slot] as unknown as { config: ExprType<RecordSliceConfigType> } | undefined;
                if (part !== undefined) $(checkedScheduleTilings(slot, kind, resourceKinds, part.config, "Plan"));
            }
        }
        const tabs = buildLibrary(library, { resources: resourceKinds, events: eventKinds, rows, picked, sources: sources.names });
        if (events === undefined) {
            return East.value({ plan, resources: [], events: [], blocks: none, paged: none, canDrop: veto, optimise: optimiser, settings, library: tabs, inspector: false, narrowed } as never, PlanPayloadType);
        }
        // A paged kind its source of the slice narrows pages the narrowing's rows themselves (#1344): its rows hold that
        // source alone, as the payload's block bound it.
        const pagedSlot = resourceKinds.find(([, kind]) => kind.window !== undefined)?.[0];
        const pagedSource = pagedSlot === undefined ? undefined : bound.data[pagedSlot];
        // The payload is assembled in one function, so each kind is built once:
        // the `blocks` seam made inside it captures the very array of event kinds
        // the payload holds (#1192), and so do a paged kind's rows (#1199).
        const assemble = East.function(
            [PlanRootType, ArrayType(PlanResourcesType), ArrayType(PlanEventKindType), OptionType(PlanEventCanDropType), OptionType(FuncBindingType), PlanSettingsType, ArrayType(PlanLibraryTabType), NarrowedType],
            PlanPayloadType,
            (_$, root, resolved, built, canDropFn, optimiseFn, chosen, listed, keys) => {
                const paged = createEventPaged(resourceKinds, eventKinds, built, pagedSource);
                return East.value({
                    plan: root,
                    resources: resolved,
                    events: built,
                    blocks: some(createEventBlocks(resourceKinds, eventKinds, built)),
                    paged: paged === undefined ? none : some(paged),
                    canDrop: canDropFn,
                    optimise: optimiseFn,
                    settings: chosen,
                    library: listed,
                    inspector: inspected,
                    narrowed: keys,
                } as never, PlanPayloadType);
            },
        );
        return assemble(
            plan,
            resourceKinds.map(([slot, kind]) => kind.buildPlan(slot)),
            // Each event kind narrowed through its own source of the slice, when the slice has one (#1344).
            eventKinds.map(([slot, kind]) => kind.buildPlan(slot, bound.parts[slot])),
            veto,
            optimiser,
            settings,
            tabs,
            narrowed,
        );
    }) as ExprType<PlanPayloadType>;
}

/**
 * What a Plan of event kinds checks before it draws them (#1192): every
 * resource kind has rows to draw, and every key the Plan gives its own rows
 * is no other series' — a row's id is its series' key and its path.
 *
 * @param resources - The resource kinds, by slot
 * @param events - The event kinds, by slot
 * @param series - `data`'s `series`, when given
 * @param rows - The `rows` prop, when given
 * @throws {Error} Naming a resource kind that would draw no rows, or the two series that share a key
 */
function checkEventRows(
    resources: readonly (readonly [string, ScheduleResourceKind<EastType, EastType>])[],
    events: readonly (readonly [string, ScheduleEventKind<EastType, EastType>])[],
    series: unknown,
    rows: readonly unknown[] | undefined,
): void {
    for (const [slot, kind] of resources) {
        if (eventDrawsOf(slot, events).length === 0 && kind.measures.length === 0) {
            throw new Error(`Plan: resources.${slot} has no event kind placed on it and no measures, so it would draw no rows — ` +
                `place an event kind on it (Schedule.events' \`resource: { field, of: "${slot}" }\`), or give it \`measures\``);
        }
    }
    const owners = new Map<string, string>();
    const claim = (key: string, who: string): void => {
        const prior = owners.get(key);
        if (prior !== undefined) {
            throw new Error(`Plan: ${prior} and ${who} have the same key, "${key}" — a row's id is its series' key and its path, so no two series share one`);
        }
        owners.set(key, who);
    };
    for (const [slot, kind] of resources) {
        if (kind.grouped) claim(`${slot}.group`, `the group strips of resources.${slot}`);
        for (const draw of eventDrawsOf(slot, events)) claim(`${slot}.${draw}`, `the ${draw} rows of resources.${slot}`);
        kind.measures.forEach((measure, i) => {
            for (const key of planSeriesKeys([measure]) ?? []) {
                // The resources' own series lays the measures out under each resource, keyed by the kind's slot.
                if (key === slot) {
                    throw new Error(`Plan: resources.${slot}.measures[${i}] has the key "${key}", the slot's own — ` +
                        "a resource kind's rows are laid out by a series of that key; give the measure another");
                }
                claim(key, `resources.${slot}.measures[${i}]`);
            }
        });
    }
    for (const [slot] of events) claim(`${slot}.unassigned`, `the Unassigned row of events.${slot}`);
    for (const key of planSeriesKeys(series) ?? []) claim(key, "a series in `series`");
    (rows ?? []).forEach((item, i) => {
        for (const key of overSeriesKeys(item) ?? []) claim(key, `rows[${i}] (Plan.over)`);
    });
}

/**
 * What a Plan with a paged resource kind checks (#1199): a canvas pages one
 * source, so one resource kind at most is paged, and `data` beside it is read
 * whole.
 *
 * @param resources - The resource kinds, by slot
 * @param data - The `data` prop, when given
 * @throws {Error} Naming the paged kinds, or the paged kind and `data`
 */
function checkPagedKinds(resources: readonly (readonly [string, ScheduleResourceKind<EastType, EastType>])[], data: unknown): void {
    checkSchedulePagedKinds(resources, "Plan", "a canvas");
    const paged = resources.filter(([, kind]) => kind.window !== undefined).map(([slot]) => `resources.${slot}`);
    if (paged.length === 1 && data !== undefined && resolveRowSource(data, "Plan").kind !== "inline") {
        throw new Error(`Plan: ${paged[0]} pages its rows (Data.bindPaged), and \`data\` is paged too, and a canvas pages one source — bind \`data\` whole, or read the resources whole`);
    }
}

// ============================================================================
// <Plan>
// ============================================================================

/**
 * `<Plan>` — the axis-aligned planning canvas (see the namespace's docs on
 * `Plan`). Props are {@link PlanProps}.
 *
 * @remarks
 * The tag is generic in the canvas's axis kind `K`, inferred from `axis`:
 * a series or hand-built row whose instants ride another arm is a compile
 * error here. That is why it is a function of its own rather than
 * `optionsTag(...)`, whose props would fix `K` at every kind.
 *
 * @typeParam K - The canvas's axis kind, inferred from `axis`
 * @param props - The Plan's props ({@link PlanProps})
 * @returns The Plan — the `Plan` carrier over its payload
 */
export function PlanTag<K extends PlanAxisKindLiteral = PlanAxisKindLiteral>(props: PlanProps<K>): UIElement {
    return PlanComponent.Root(createPlanPayload(props as unknown as PlanProps));
}

/** The type of `<Plan>` as a tag. */
export type PlanTagType = typeof PlanTag;
