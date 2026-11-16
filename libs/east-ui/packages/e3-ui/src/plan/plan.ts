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
 * Its rows come from two sources, in this order down the canvas:
 * - **`data` and its `series`**: a keyed source's entries laid out by
 *   `Plan.series.*`, on any axis, `hidden` naming the series off to start and
 *   the library's Series tab picking among them (#1541), edited in place and
 *   saved through `record`, the record they are read from (#880, #1541). Its
 *   resources are among them (#1541, U1): a `Plan.series.resources` series'
 *   rows, or a `Plan.series.kinds` case's, on which the event kinds land;
 * - **`rows`**: hand-built rows (`Plan.chart`, …) and `Plan.over(data,
 *   [series…])`, read only.
 *
 * The event kinds, `events`, are `Schedule`'s — the very values a Calendar
 * takes, each kind a record of its own committed through its patch mutation —
 * placed on the rows by their `resource` field: `of` names a resources
 * series or a kinds case by its key, and an event lands on the row whose key
 * its field holds. Pinned rows of any source sit under the ruler. An event is
 * scheduled in time, so event kinds need a time axis.
 *
 * Its narrowing is one `Slice.bindRecords`, one rail on its toolbar (#1344):
 * its `rows` source gives the canvas its rows, paged from it; a source named
 * after an event kind narrows that kind's events and its backlog through its
 * interval index; and one a templates list or a tab names narrows its cards.
 * Every source holding a `range` holds the window with the others — an event
 * kind's, a tab's that lists what is in the dates on screen. The canvas's rows
 * never follow the dates: a `range` on the `rows` source would hold the
 * window, and is refused — a date field there is a field of the rail the
 * viewer sets. Templates are records, each list its own source (#1340).
 *
 * Over rows read a page at a time every event kind is read a cell at a time
 * (#1039, #1541): its source of the slice lists a series index and a summary
 * index of its record, filed by its resource field over its own times, and
 * anything else — the source's interval index alone, no source, the record
 * read whole, its days read through a day index — is refused, naming both
 * declarations over the kind's own fields. Over rows read whole, a kind is
 * counted before its events are read, and past `SCHEDULE_EVENT_CAP` of them in
 * the range the canvas reads none is read or drawn: its rows shade from its
 * source's summary, or are hatched and the frame says how many there are.
 *
 * The Plan is an interface. Its payload holds the canvas whole
 * ({@link PlanRootType}, its narrowing's chrome among it) beside the event
 * kinds as Plan takes them (`PlanEventKindType`, #1190), the series they land
 * on (`landings`) and the seam that joins their events into those rows
 * (`seam`, #1541), the event kinds' drop veto, the settings — where it opens,
 * and whether its Autosave begins on — the library's tabs, whether it has an
 * inspector, and each source's narrowed keys. The
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
    isTypeEqual,
    none,
    printType,
    some,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type ValueTypeOf,
    type option,
} from "@elaraai/east";
import { CanDropFnType, EastUI, RowSourceType, type UIElement } from "@elaraai/east-ui";
import {
    RecordSliceConfigType, resolveRowSource, type RecordSliceAffordance, type RecordSlicesChromeOptions,
} from "@elaraai/east-ui/internal";
import { FuncBindingType } from "../bind/func.js";
import type { OptimiseHandle } from "../utils/optimise.js";
import { PlanEventKindType, ScheduleCandidateType } from "../schedule/types.js";
import { scheduleTitled } from "../schedule/index.js";
import { checkSchedulePagedEventKinds, checkedScheduleTilings, type SchedulePaging } from "../schedule/cell-checks.js";
import { scheduleOptimiseBinding } from "../schedule/optimise.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import { SCHEDULE_DEF } from "../schedule/resources.js";
import { recordSources, sliceSourceNames, templatesSource } from "../utils/record-sources.js";
import { heldHandle } from "../utils/held.js";
import { PlanRootType } from "./ir.js";
import {
    PlanAxisType, PlanBlockType, PlanBlocksType, PlanLinkType, PlanRowsCollectionType, PlanRunRefType, type PlanAxisKindLiteral, type PlanRowsValue,
} from "./types.js";
import { WINDOWLESS_AXES, axisKindOf, linkEventKinds } from "./builders.js";
import { buildPlanRoot, type PlanConfig, type PlanRecordHandle } from "./root.js";
import { pickRefusal, planShown } from "./pick.js";
import { nestedPartOf } from "./nested-checks.js";
import { overSeriesKeys, type PlanOverRows } from "./over.js";
import { planLandings, planSeriesKeys, type PlanLanding, type PlanSeriesInput } from "./series.js";
import type { PlanNestedChecked, PlanRowsNestedOf } from "./nested.js";
import { PlanEventSeamType, PlanLandingType, createEventSeam, eventDrawsOf, landingsOnWire } from "./event-rows.js";
import { PlanLibraryTabType, buildLibrary, type PlanLibraryTab } from "./library.js";
import { VocabularyNounType, vocabularyNoun, vocabularyWord, type VocabularyNoun } from "../utils/vocabulary.js";

export {
    PlanEventDraftsType, PlanEventPlacedType, PlanEventReadsType, PlanEventSeamType, PlanEventShadeType, PlanEventShadingType, PlanLandingType,
} from "./event-rows.js";

// ============================================================================
// The Plan's shared keys
// ============================================================================

/**
 * The names a Plan keeps its viewer's state under, by its `id`: its frame's
 * panes (their open tab and collapsed state), the series this viewer hides,
 * the pick over `data`'s series, its library's drag-source id, and the Plan's
 * drop target.
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
    /** The pick over `data`'s series (#1541): the State key what a viewer switches of them is held under. */
    pick: string;
    /** The library's drag-source id: what the Plan takes cards from. */
    library: string;
    /** The Plan's drop target: where the library's cards and the canvas's elements land. */
    surface: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        frame: `plan${suffix}.frame`,
        series: `plan${suffix}.series`,
        pick: `plan${suffix}.pick`,
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
 * Where a Plan opens, and how it begins.
 *
 * @property date - The date brought into view first; `none`, the axis's window from its start
 * @property autosave - Whether its Autosave begins on
 */
export const PlanSettingsType = StructType({
    date: OptionType(DateTimeType),
    autosave: BooleanType,
});

/** Type representing {@link PlanSettingsType}. */
export type PlanSettingsType = typeof PlanSettingsType;

/**
 * The app's own words for what the Plan draws of its own (#1516): each one given, `none` where the Plan's message table
 * keeps its word, so a host's translation (`PlanMessagesProvider`) stands where the app gave none.
 *
 * @property unassigned - An event kind's row of events on no resource (`Unassigned`)
 * @property events - The library's templates tab (`Events`)
 * @property backlog - The library's unscheduled events (`Backlog`)
 * @property series - The library's tab of what can be hidden (`Series`)
 * @property groups - A phone's groups (`Group`, `Groups`)
 * @property rows - The rows (`Row`, `Rows`)
 * @property measures - A phone's chart rows (`Measure`, `Measures`)
 * @property dueThisWeek - A backlog group (`Due this week`)
 * @property dueNextWeek - A backlog group (`Due next week`)
 * @property later - A backlog group (`Later`)
 * @property noDate - A backlog group (`No date`)
 * @property estimated - A run's state (`estimated`)
 * @property proposed - A run's state (`proposed`)
 * @property recommended - A run's state (`recommended`)
 * @property removal - A run's state (`proposed removal`)
 * @property confirmed - A run's state (`confirmed`)
 * @property inProgress - A run's state (`in progress`)
 * @property actual - A run's state (`actual`)
 * @property rejected - A run's state (`rejected`)
 */
export const PlanVocabularyType = StructType({
    unassigned: OptionType(StringType), events: OptionType(StringType), backlog: OptionType(StringType), series: OptionType(StringType),
    groups: OptionType(VocabularyNounType), rows: OptionType(VocabularyNounType), measures: OptionType(VocabularyNounType),
    dueThisWeek: OptionType(StringType), dueNextWeek: OptionType(StringType), later: OptionType(StringType), noDate: OptionType(StringType),
    estimated: OptionType(StringType), proposed: OptionType(StringType), recommended: OptionType(StringType), removal: OptionType(StringType),
    confirmed: OptionType(StringType), inProgress: OptionType(StringType), actual: OptionType(StringType), rejected: OptionType(StringType),
});

/**
 * The `Plan` renderer's payload: the Plan's interface.
 *
 * @property plan - The canvas whole: its axis, its rows over `data` followed by `rows`, its links, editing session and the rest
 * @property landings - The series the event kinds land on (#1541, U1), in the canvas's order: each resources series and kinds case
 * @property events - The event kinds, in the order `events` lists them, each closed behind its seams
 * @property seam - How the event kinds' events join the canvas's rows (#1541, U1): read over a window, filed, and placed on
 *   the landing rows of any window of the canvas; `none` while the Plan has no event kinds
 * @property paged - Whether the canvas's rows are read a page at a time: every event kind is then read a cell at a time
 *   (#1039, #1541), and no event draws on an Unassigned row
 * @property canDrop - The event kinds' drop veto; `none`, every drop the kinds take lands
 * @property optimise - The app's optimiser, by its `e3.function`'s name and the records it lists in `drafts` (#1409, #1622):
 *   what the Elara eye calls over the plan window in view, the sessions' unsaved edits of those records sent with the call
 *   as drafts, its answer's patches one edit of the session; `none`, no eye
 * @property settings - The date brought into view first, and whether its Autosave begins on
 * @property library - The library pane's tabs, in the order `library` lists them; empty, no pane (#1195)
 * @property inspector - Whether the Plan has an inspector pane, showing what is selected (#1197)
 * @property vocabulary - The app's words for what the Plan draws of its own (#1516)
 * @property narrowed - Each source of the slice's narrowed keys, paged through its own data, by the source's name
 *   (#1344): what a templates list's cards and an author's tab read to show a source's rows; `rows` gives the canvas its
 *   rows, and an event kind reads its own narrowing through its part
 */
export const PlanPayloadType = StructType({
    plan: PlanRootType,
    landings: ArrayType(PlanLandingType),
    events: ArrayType(PlanEventKindType),
    seam: OptionType(PlanEventSeamType),
    paged: BooleanType,
    canDrop: OptionType(PlanEventCanDropType),
    optimise: OptionType(FuncBindingType),
    settings: PlanSettingsType,
    library: ArrayType(PlanLibraryTabType),
    inspector: BooleanType,
    vocabulary: PlanVocabularyType,
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

/** The words of {@link PlanVocabularyType}, as a word. */
type PlanVocabularyWord = Exclude<keyof typeof PlanVocabularyType.fields, "groups" | "rows" | "measures">;

/** The app's words for what the Plan draws of its own: any left out keeps the Plan's word. */
export type PlanVocabularyProp = { readonly [W in PlanVocabularyWord]?: string } & {
    readonly groups?: VocabularyNoun; readonly rows?: VocabularyNoun; readonly measures?: VocabularyNoun;
};

/** Each word's default, as a refusal names it. */
const PLAN_WORDS: Readonly<Record<PlanVocabularyWord, string>> = {
    unassigned: "Unassigned", events: "Events", backlog: "Backlog", series: "Series",
    dueThisWeek: "Due this week", dueNextWeek: "Due next week", later: "Later", noDate: "No date",
    estimated: "estimated", proposed: "proposed", recommended: "recommended", removal: "proposed removal",
    confirmed: "confirmed", inProgress: "in progress", actual: "actual", rejected: "rejected",
};

/**
 * The Plan's words as the payload carries them.
 *
 * @param given - The prop
 * @returns Each word given, and none for the rest
 * @throws {Error} Naming an entry given empty
 * @internal
 */
export function planVocabulary(given: PlanVocabularyProp | undefined): ValueTypeOf<typeof PlanVocabularyType> {
    const noun = (name: "groups" | "rows" | "measures", one: string) => {
        const word = given?.[name];
        return word === undefined ? none : some(vocabularyNoun("Plan", name, word, one));
    };
    return {
        ...Object.fromEntries((Object.keys(PLAN_WORDS) as PlanVocabularyWord[]).map((name) => {
            const word = given?.[name];
            return [name, word === undefined ? none : some(vocabularyWord("Plan", name, word, PLAN_WORDS[name]))];
        })) as Record<PlanVocabularyWord, option<string>>,
        groups: noun("groups", "Group"), rows: noun("rows", "Row"), measures: noun("measures", "Measure"),
    };
}

/**
 * `<Plan>`'s props: the canvas's ({@link PlanConfig}), with `data` optional,
 * and the event kinds and the read-only `rows`.
 *
 * @remarks
 * `K` is the canvas's axis kind, inferred from `axis` alone: every series and
 * hand-built row must lie within it (a `"time"` series on a `"number"` axis
 * fails to compile here), and event kinds need a time axis.
 *
 * Its `series` is held to its rows' nested series index too (#1435): beside
 * `data` or a `slice` whose `rows` source lists one
 * (`Data.bindPaged(record, { indexes })`), a series reading a collection the
 * index does not declare, by other times than it files by, items as values or
 * values as items, a subtotal by a rollup it does not keep, or runs rolled up
 * that it files under no parent, fails to compile here, the refusal in words.
 *
 * @typeParam K - The canvas's axis kind, inferred from `axis`
 * @typeParam D - The `data` prop's type, inferred: what the rows' nested series index declares, where it lists one
 * @typeParam S - The `slice` prop's type, inferred: its `rows` source's declarations, where it has one
 * @typeParam L - The `series` prop's type, inferred: held to the declarations ({@link PlanNestedChecked})
 */
export interface PlanProps<K extends PlanAxisKindLiteral = PlanAxisKindLiteral, D = unknown, S = unknown, L = unknown>
    extends Omit<PlanConfig<K>, "data" | "canDrop" | "series" | "editing" | "picked"> {
    /** The rows' source — a keyed collection, a bind handle over one or a paged source of one, laid out by `series` (see {@link PlanConfig}). Leave it out for a Plan of event kinds or `rows` alone, and beside `slice`'s `rows` source, which gives the rows. */
    data?: D & PlanConfig<K>["data"];
    /** The row series over the rows (see {@link PlanConfig}), each held to the rows' nested series index where they carry one (#1435). */
    series?: L & PlanSeriesInput<NoInfer<K>> & PlanNestedChecked<NoInfer<L>, NoInfer<PlanRowsNestedOf<D, S>>>;
    /**
     * The narrowing (#1344): `slice={{ slice: Slice.bindRecords(key, { rows, … }) }}`, one rail on the toolbar, with
     * its `affordances` and `persist`. Its `rows` source gives the canvas its rows, paged from it in its index's order —
     * `data` then gives none — laid out by `series`, edits reaching the record through `record`
     * (`Record.bind(record)`); the resources among them narrow as every row does. A source named after an event kind's
     * slot narrows that kind's events and its backlog through the source's interval index, its `range` the kind's start
     * field — over rows read a page at a time, it lists the kind's series and summary indexes too, and the kind is read
     * a cell at a time; one a templates list or a library tab names narrows its cards.
     * Every source holding a `range` holds the window with the others: the toolbar's navigation and range, the horizon
     * brush and the resolution write them together. The canvas's rows never follow the dates on screen: the `rows`
     * source takes no `range` — a date field there is a field of the rail the viewer sets — and a slice with no source
     * holding the window leaves the canvas its own, which the same controls move. Calculations — the footer's counts,
     * the overlaps — read every event. `Slice.bind`, a single `Slice.bindRecord` and a source nothing names are refused.
     */
    slice?: S & RecordSlicesChromeOptions;
    /**
     * The rows' save door (#1541): the record they are read from — `data`'s, or the `slice`'s `rows` source's — bound
     * with its patch mutation, `Record.bind(record)`, its record declaring `patch: mutation.patch()`. With it every
     * dropped card and every moved, resized or typed element is a draft of the entry it was made on, each gesture one
     * undoable step, and Save commits them to the record by key as one checked batch: a batch against a record that
     * moved is refused, never rebased. It is the Plan's one save door for its rows, so a Plan over `data` that is no
     * record does not edit: without `record` the rows take no gesture. An event kind saves through its own record
     * (`Schedule.events`).
     */
    record?: PlanRecordHandle;
    /** Observes every gesture on the rows — `Fn(Plan.Types.PatchEvent(R)) → Null`, `R` the rows' entry type. It observes the drafts `record` saves, so it needs `record`. */
    onPatch?: ExprType<EastType>;
    /**
     * The author's check over one drafted entry — `Fn(R, K) → Editing.Types.Readiness`, `R` and `K` the rows' entry and
     * key types: a refusal holds Save and names the entry. It checks the drafts `record` saves, so it needs `record`.
     */
    ready?: ExprType<EastType>;
    /**
     * The event kinds, by slot — `Schedule.events(record, { … })`, each a record of its own: at least one, when given.
     * Each lands on the canvas's rows (#1541, U1): its `resource.of` names a `Plan.series.resources` series or a
     * `Plan.series.kinds` case by its key, and an event lands on the row whose key its resource field holds — or, `of`
     * a name per case of a variant field, on the series its case names. An event is scheduled in time, so they need a
     * time axis.
     */
    events?: Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>;
    /** Read-only rows: hand-built rows (`Plan.chart({ … })`) and `Plan.over(data, [series…])`. Pinned rows sit under the ruler; the rest follow `data`'s rows. */
    rows?: readonly PlanRowsItem<NoInfer<K>>[];
    /** The date brought into view first; omitted, the axis's window from its start. */
    date?: SubtypeExprOrValue<DateTimeType>;
    /**
     * Whether Autosave — the switch in Save's menu — begins on; off by default. On, the Plan's changes are saved by
     * themselves a pause after the viewer's last act: never an optimiser's result, an Undo or a Redo, which wait for a
     * press of Save. A literal, or an expression data drives. The viewer's own choice, once made, is kept in their
     * browser for the data set and the Plan, and stands over it.
     */
    autosave?: SubtypeExprOrValue<BooleanType>;
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
     * pane. It shows the event kinds' events and the rows they land on, so it
     * needs `events`.
     */
    inspector?: boolean;
    /**
     * The app's own words for what the Plan draws of its own (#1516), each keeping the Plan's where left out: `unassigned`,
     * the tabs' `events`, `backlog`, `series`, `groups`, `rows` and `measures`, the backlog's groups (`dueThisWeek`,
     * `dueNextWeek`, `later`, `noDate`) and a run's states (`estimated`, `proposed`, `recommended`, `removal`, `confirmed`,
     * `inProgress`, `actual`, `rejected`).
     */
    vocabulary?: PlanVocabularyProp;
    /**
     * The drop veto, by what it vets — its arm from its East type:
     * `Fn(DragEvent) → Boolean` over a card or an element dragged onto
     * `data`'s rows, consulted where the drag rests and again before it
     * becomes a draft; or `Fn(Schedule.Types.Candidate) → Option<String>` over
     * an event kind's drop, its message on the ghost, as the Calendar's.
     */
    canDrop?: PlanConfig<K>["canDrop"] | SubtypeExprOrValue<PlanEventCanDropType>;
    /**
     * The app's optimiser (#1409, #1622): `Func.bind` of its `e3.function` from `Plan.Types.OptimiseRequest` — the plan
     * window in view, the run number and the rail's narrowing, and no row — to `Plan.Types.OptimiseResult(E)`, a patch of
     * each event kind's record by slot (`Plan.Types.OptimiseResult({ job: JobsType })`, `JobsType` the record's type). The
     * function reads the events it needs through its record's indexes and the records behind the rows, and lists each
     * event kind's record it reads in `drafts`: the Plan sends its unsaved edits of those records with the call, laid over
     * them and never saved. So the eye runs whatever the page holds: a kind read a cell at a time, and one past the events
     * cap, as any other. The Elara eye in the toolbar calls it once per run; the answer lands in the session as one edit,
     * which one Undo reverts and Save commits with everything else. It answers the event kinds' records, so it needs
     * `events`. Omitted, no eye. The tag cannot see its kinds' records in TypeScript, so it checks the handle at build, and
     * refuses another request or answer naming both; a function that reads an event kind's record and does not list it in
     * `drafts` is refused as the page is evaluated, naming the record.
     */
    optimise?: OptimiseHandle;
}

/** The props, erased — what the implementation reads. */
type PlanAnyProps = PlanProps & Record<string, unknown>;

/** The source of a Plan's slice that gives the canvas its rows (#1344). */
const ROWS = "rows";

/** The record rail's controls a Plan mounts unless its `slice` lists its own: the field chips, the presets, the summary and the horizon brush. */
const PLAN_AFFORDANCES: readonly RecordSliceAffordance[] = ["fields", "presets", "summary", "brush"];

/**
 * The words `<Plan>` refuses `editing` in (#1541, U4), naming the prop that replaces each of its parts.
 *
 * @returns The refusal
 */
function editingRefusal(): string {
    return "Plan: `editing` is removed (#1541) — the rows save through `record`, the record they are read from, bound with its patch " +
        "mutation: record={Record.bind(record)} in place of `editing.onApply` (Record.onApply(record, { keyed: true })); " +
        "`editing.onPatch` is the prop `onPatch`, and `editing.ready` the prop `ready`; `editing.onUpdate` has none — a Plan over " +
        "data that is no record does not edit";
}

/** What a Plan's slice narrows, as the refusal of a source nothing names says it. */
const NARROWS = "its rows, its event kinds, and the templates lists and tabs that name a source";

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
        // No entry of `data` makes them, so they say nothing of what one makes (#1398).
        if (isTypeEqual(type, PlanBlocksType)) {
            return (value as unknown as ExprType<PlanBlocksType>).map((_$, block) =>
                East.value({ fixed: true, parent: block.parent, charts: none, rows: block.rows }, PlanBlockType));
        }
        if (isTypeEqual(type, PlanRowsCollectionType)) {
            return East.value([{ fixed: true, parent: none, charts: none, rows: value as unknown as ExprType<PlanRowsCollectionType> }], PlanBlocksType);
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
 * A `range` on the `rows` source, checked as the Plan is evaluated, its
 * source's controls read only then (#1344): the dates on screen never decide
 * which rows are listed, so a range there would hold the window and narrow the
 * rows at every pan; it is refused in words naming the change to make.
 *
 * @param config - The source's controls, its `range` among them
 * @returns The check, an expression run for its refusal
 */
function checkedRowsRange(config: ExprType<RecordSliceConfigType>): ExprType<NullType> {
    const holds = "Plan: the slice's `rows` source gives the canvas its rows, and its range \"";
    const tail = "\" would hold the window — the rows never follow the dates on screen: leave `range` out, and \"";
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
 * @throws {Error} Naming the prop and the remedy: no rows from any source; `resources`, which is gone (#1541); event kinds
 *   over no rows, or over a `series` known only as it runs; an event kind's `resource.of` naming no resources series or
 *   kinds case, or one whose rows are not keyed by String; an event kind with no `title` (#1367); event kinds on a number
 *   or ordinal axis; a link naming an event kind `events` has not; a `rows` item that is neither a hand-built row nor
 *   `Plan.over`'s; a `canDrop` over neither a drag nor a candidate, or over a candidate with no event kinds; an
 *   `optimise` with no event kinds, or one that is not `Func.bind` of a function from `OptimiseRequest` to
 *   `OptimiseResult(E)` over the event kinds' records (#1409, #1622); an `inspector` with no event kinds; over rows read a
 *   page at a time, an event kind with no source of the slice — its record read whole, or the days in view read through
 *   its day index (`window`) — naming the series and summary indexes to declare over the kind's own fields (#1039,
 *   #1541); a key the Plan gives its event rows that another series has; a `slice` that is not
 *   `{ slice: Slice.bindRecords(…) }` — `Slice.bind`, a single `Slice.bindRecord`, the bare handle — or names a source
 *   nothing names, `data` beside its `rows` source, and a kind's own `slice` or `filter` (#1344); an axis stating no
 *   window beside a slice whose every source is the `rows` source, which holds none; a templates list written in the
 *   code or naming no source of the slice (#1340); and everything the canvas refuses ({@link createPlanRoot}). An axis
 *   held in a variable, and links whose kinds are not known at build, are refused in the same words as the Plan is
 *   evaluated; so are a `range` on the `rows` source, which the dates on screen never narrow (#1344), and the series
 *   and summary indexes an event kind's source lists (#1039), which the Plan reads only then: one filed by another
 *   field than the kind's resource, or over other times than its events'; a series index over rows read whole; two
 *   series, or two summaries, by one tile over the same fields; a series index with no summary beside it; and, over
 *   rows read a page at a time, a source listing no series index — its interval index alone, or a summary alone — each
 *   naming the indexes to declare over the kind's own fields
 * @internal
 */
export function createPlanPayload(props: PlanProps): ExprType<PlanPayloadType> {
    const { events, rows, date, autosave, canDrop, optimise, library, inspector, vocabulary, slice, record, onPatch, ready, ...canvas } = props as PlanAnyProps;
    const words = planVocabulary(vocabulary);
    // The rows are the resources (#1541, U1): `resources` is refused by name, naming its replacement.
    if ("resources" in canvas) throw new Error(resourcesRefusal());
    // The save door (#1541, U4): `record`, with `onPatch` and `ready` props of their own. `editing` is refused by name.
    if ("editing" in canvas) throw new Error(editingRefusal());
    // Which series show (#1541, U3): `series` with `hidden`, picked where the library lists the Series tab. `pick` is
    // refused by name, and the pick's own key is the Plan's to give.
    if ("pick" in canvas) throw new Error(pickRefusal());
    if ("picked" in canvas) throw new Error("Plan: `picked` is the canvas's own — `data`'s series are picked where `library` lists Plan.library.series()");
    for (const [prop, does] of [["onPatch", "observes"], ["ready", "checks"]] as const) {
        if ((prop === "onPatch" ? onPatch : ready) !== undefined && record === undefined) {
            throw new Error(`Plan: \`${prop}\` ${does} the drafts \`record\` saves, and this Plan has no \`record\` — give it the record the rows are read ` +
                "from, bound with its patch mutation: record={Record.bind(record)}");
        }
    }
    // The canvas's editing session, as its root takes it: built from the record.
    const editing = record === undefined ? undefined
        : { record: record as PlanRecordHandle, ...(onPatch === undefined ? {} : { onPatch: onPatch as ExprType<EastType> }), ...(ready === undefined ? {} : { ready: ready as ExprType<EastType> }) };
    // The narrowing's form #1344 retired, refused by name for an app that still passes it: the bare handle.
    if (slice instanceof Expr || (slice !== undefined && (typeof slice !== "object" || slice === null || !("slice" in slice)))) {
        throw new Error("Plan: `slice` takes { slice } — slice={{ slice: Slice.bindRecords(key, { rows, … }) }}: the bare handle is not taken");
    }
    const narrowing = slice as RecordSlicesChromeOptions | undefined;
    const kinds = events === undefined ? [] : Object.keys(events);
    const eventKinds = Object.entries(events ?? {});
    if (events !== undefined) {
        // Each kind is a kind, and a Plan draws each event's title, which `Schedule.events` takes as optional (#1367):
        // checked before where the kinds land.
        checkEventKinds(eventKinds);
        scheduleTitled(events, "Plan");
    }
    // The series the event kinds land on (#1541, U1): each resources series and kinds case in `series`, known as the
    // Plan is built.
    const landings = events === undefined ? [] : eventLandings(canvas.series, eventKinds);
    // The app's optimiser (#1409, #1622) answers a patch of each event kind's record: a Plan of none has no eye.
    if (optimise !== undefined && events === undefined) {
        throw new Error("Plan: `optimise` answers a patch of each event kind's record, and this Plan has no event kinds — declare `events` (Schedule.events), or leave `optimise` out");
    }
    const optimiser = East.value(optimise === undefined ? none : some(scheduleOptimiseBinding("Plan", optimise, eventKinds)), OptionType(FuncBindingType));
    // Templates are records (#1340): each event kind's list a `Schedule.templates` over its record, naming its source of
    // the slice — one written in the code, or naming none the slice holds, refused before a source no list names is, so
    // the refusal says the change to make. A slice of another kind is refused below, as such.
    const sliceNames = sliceSourceNames(narrowing);
    if (narrowing === undefined || sliceNames.length > 0) {
        for (const [slot, kind] of eventKinds) {
            if (kind.templatesList !== "none") templatesSource("Plan", `Schedule.templates(rows, { …, source: "${slot}Templates" })`, kind.templatesSource, sliceNames);
        }
    }
    // The sources a Plan takes: `rows`, an event kind's slot, or one a templates list or a tab names.
    const named = new Set<string>([ROWS, ...kinds,
        ...eventKinds.flatMap(([, kind]) => (kind.templatesSource === undefined ? [] : [kind.templatesSource])),
        ...(library ?? []).flatMap((tab) => (tab.kind === "tab" && tab.config.source !== undefined ? [tab.config.source] : []))]);
    const sources = recordSources(narrowing === undefined ? undefined : { ...narrowing, affordances: narrowing.affordances ?? PLAN_AFFORDANCES },
        { builder: "Plan", names: [...named], what: NARROWS, takes: (name) => named.has(name) });
    // The `rows` source gives the canvas its rows, paged from it in its index's order (#1344), held to its record's
    // nested series index, its type's (#1435).
    const pagesRows = sources.names.includes(ROWS);
    const rowsNested = pagesRows && narrowing !== undefined
        ? nestedPartOf(Expr.type(East.value(narrowing.slice) as Expr) as EastType) : undefined;
    if (pagesRows && canvas.data !== undefined) {
        throw new Error("Plan: `slice`'s `rows` source gives the canvas its rows, paged from it — leave `data` out: " +
            "data={Slice.rows(slice)} is gone, and the Plan reads its rows from the slice: slice={{ slice }}");
    }
    if (canvas.data === undefined && !pagesRows && rows === undefined) {
        throw new Error("Plan: needs its rows — `data` and its `series`, `slice`'s `rows` source, or read-only `rows`");
    }
    if (events !== undefined && canvas.data === undefined && !pagesRows) {
        throw new Error("Plan: the event kinds land on the canvas's rows, and this Plan has none — give the rows they land on, `data` or the slice's " +
            "`rows` source, laid out by a series of them: Plan.series.resources(Row, { key, title, label }), named by each kind's resource.of");
    }
    if (record !== undefined && canvas.data === undefined && !pagesRows) {
        throw new Error("Plan: `record` saves the rows `data` or the slice's `rows` source reads, and this Plan has neither — pass the rows with it: " +
            "data={Data.bindPaged(record)}, or slice={{ slice: Slice.bindRecords(key, { rows: { source: Data.bindPaged(record, { indexes }) } }) }}");
    }
    // Whether the rows are read a page at a time (#1541, U1): every event kind is then read a cell at a time.
    const paged = pagesRows || (canvas.data !== undefined && resolveRowSource(canvas.data, "Plan").kind !== "inline");
    const paging: SchedulePaging = {
        paged: paged ? "the rows" : undefined,
        split: (kind) => paged ? { paged: kind.takes.map((key) => `the rows of ${key}`), whole: [] } : { paged: [], whole: kind.takes.map((key) => `the rows of ${key}`) },
    };
    // The canvas's rows never follow the dates (#1344): an axis stating no window takes it from a source holding it,
    // and a slice of the `rows` source alone holds none.
    if (WINDOWLESS_AXES.has(canvas.axis as object) && sources.names.length > 0 && sources.names.every((name) => name === ROWS)) {
        throw new Error("Plan: the axis states no `window`, and no source of the slice holds one — the canvas's rows never follow the dates on " +
            "screen, so the `rows` source holds no window: declare it, Plan.axis({ window: { min, max }, … }), " +
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
        const linked = Array.isArray(links) ? (links as readonly unknown[]).map(linkEventKinds) : [undefined];
        linked.forEach((ends, i) => {
            for (const kind of ends ?? []) {
                if (!kinds.includes(kind)) throw new Error(`Plan: links[${i}] names the event kind "${kind}${linkKindRefusalTail(kinds)}`);
            }
        });
        if (linked.includes(undefined)) links = checkedLinkKinds(links, kinds) as unknown as typeof links;
    }
    if (inspector !== undefined && typeof inspector !== "boolean") {
        throw new Error("Plan: `inspector` is `true` for the inspector pane, or `false` or left out for none, and this one is no boolean — a kind's own inspector for one event is Schedule.events' `inspector`");
    }
    const inspected = inspector === true;
    if (inspected && events === undefined) {
        throw new Error("Plan: `inspector` shows the event kinds' events and the rows they land on, and this Plan has no event kinds — declare `events` (Schedule.events), or leave `inspector` out");
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
    const settings = East.value({ date: date === undefined ? none : some(date), autosave: autosave ?? false } as never, PlanSettingsType);
    // `data`'s series a viewer can hide are picked where the library lists the Series tab (#1541, U3), kept under the
    // Plan's `id`.
    const picked = canvas.series !== undefined && (library ?? []).some((tab) => tab.kind === "series");
    if (events !== undefined) {
        checkSchedulePagedEventKinds(paging, eventKinds, sources.names, "Plan");
        checkEventRows(landings, eventKinds, canvas.series, rows);
    }
    const onWire = landingsOnWire(landings, eventKinds, landingIcon);
    return Expr.block(($) => {
        const bound = sources.bind($);
        // The canvas's rows never follow the dates (#1344): a range on the `rows` source, which its controls name only as
        // the Plan is evaluated, is refused then.
        const rowsPart = bound.parts[ROWS] as unknown as { config: ExprType<RecordSliceConfigType> } | undefined;
        if (rowsPart !== undefined) $(checkedRowsRange(rowsPart.config));
        // Each source's narrowed keys, paged through its own data: what the renderer reads to show a source's rows.
        const narrowed = East.value(new Map(sources.names.map((name) => [name, bound.keys[name]])) as never, NarrowedType) as ExprType<typeof NarrowedType>;
        // The author's own handle for the rows, bound once here (`heldHandle`, #1599): the page the canvas's rows are
        // read through captures this block's constant, never the author's own variable, so it is the same function from
        // one evaluation of the author's block to the next.
        const data = bound.data[ROWS] ?? heldHandle($, canvas.data);
        // The canvas first, then the event kinds, then the library: each refuses in that order.
        // The binding the `rows` source narrows (#1438): what the canvas reads its rows' nested series index through.
        const rowsBinding = pagesRows ? (bound.parts[ROWS] as unknown as { source: ExprType<StructType> }).source : undefined;
        // What the canvas shows of its series (#1541, U3): the pick, bound and held here once — a constant, which a
        // function captures as its value, never as a box of its own each evaluation (#1599) — and the keys left out.
        const shown = planShown($, canvas.series, canvas.hidden, picked ? planKeys(canvas.id).pick : undefined);
        const plan = buildPlanRoot(
            { ...canvas, data, axis, links, ...(editing === undefined ? {} : { editing }), ...(canvasCanDrop === undefined ? {} : { canDrop: canvasCanDrop }) } as Parameters<typeof buildPlanRoot>[0],
            rows === undefined ? undefined : rowsBlocks(rows),
            sources.chrome,
            rowsNested,
            rowsBinding,
            shown,
        );
        if (events !== undefined) {
            // The series and summary indexes each event kind's source lists (#1039), its record's, read as the Plan is evaluated.
            for (const [slot, kind] of eventKinds) {
                const part = bound.parts[slot] as unknown as { config: ExprType<RecordSliceConfigType> } | undefined;
                if (part !== undefined) $(checkedScheduleTilings(slot, kind, paging, part.config, "Plan"));
            }
        }
        const tabs = buildLibrary(library, { events: eventKinds, rows, picked, sources: sources.names });
        if (events === undefined) {
            return East.value({ plan, landings: onWire, events: [], seam: none, paged, canDrop: veto, optimise: optimiser, settings, library: tabs, inspector: false, vocabulary: words, narrowed } as never, PlanPayloadType);
        }
        // The payload is assembled in one function, so each kind is built once: the seam made inside it captures the very
        // array of event kinds the payload holds (#1192).
        const assemble = East.function(
            [PlanRootType, ArrayType(PlanEventKindType), OptionType(PlanEventCanDropType), OptionType(FuncBindingType), PlanSettingsType, ArrayType(PlanLibraryTabType), NarrowedType],
            PlanPayloadType,
            (_$, root, built, canDropFn, optimiseFn, chosen, listed, keys) => East.value({
                plan: root,
                landings: onWire,
                events: built,
                seam: some(createEventSeam(landings, eventKinds, built, vocabulary?.unassigned)),
                paged,
                canDrop: canDropFn,
                optimise: optimiseFn,
                settings: chosen,
                library: listed,
                inspector: inspected,
                vocabulary: words,
                narrowed: keys,
            } as never, PlanPayloadType),
        );
        return assemble(
            plan,
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
 * A landing series' icon's name (#1541, U1): its own, given by name or as a solid icon; else the resources' mark.
 *
 * @param landing - The landing series
 * @returns The Font Awesome name
 */
function landingIcon(landing: PlanLanding): string {
    const icon = landing.icon;
    if (typeof icon === "string") return icon;
    if (typeof icon === "object" && icon !== null && !(icon instanceof Expr) && typeof (icon as { name?: unknown }).name === "string") return (icon as { name: string }).name;
    return "cubes";
}

/**
 * The words `<Plan>` refuses `resources` in (#1541, U1), naming what replaces it.
 *
 * @returns The refusal
 */
function resourcesRefusal(): string {
    return "Plan: `resources` is removed (#1541) — the rows are the resources: lay them out with " +
        "Plan.series.resources(Row, { key, title, label }) over the record they are read from (`data`, or the slice's `rows` source), or a case " +
        "of Plan.series.kinds for each kind of resource, and name that series' key in each event kind's resource.of — a resource kind's " +
        "`measures` are the series' `series`, its `parent` a tree (`children`), and its `group` a Plan.series.group around it";
}

/**
 * A Plan's `events`: at least one, each a `Schedule.events` kind.
 *
 * @param events - The event kinds, by slot
 * @throws {Error} Naming the slot and the remedy: none at all, or one that is no `Schedule.events` kind
 */
function checkEventKinds(events: readonly (readonly [string, ScheduleEventKind<EastType, EastType>])[]): void {
    if (events.length === 0) {
        throw new Error("Plan: `events` declares at least one event kind — Schedule.events(record, { … }) under its slot name");
    }
    for (const [slot, kind] of events) {
        if ((kind as { [SCHEDULE_DEF]?: string } | undefined)?.[SCHEDULE_DEF] !== "events") {
            throw new Error(`Plan: events.${slot} is an event kind — Schedule.events(record, { … })`);
        }
    }
}

/**
 * The series a Plan's event kinds land on (#1541, U1), each kind's `resource.of` checked against them: every name it
 * gives is a resources series' or a kinds case's key, whose rows are keyed by String — what an event's resource field
 * holds.
 *
 * @param series - The `series` prop
 * @param events - The event kinds, by slot, each checked a kind ({@link checkEventKinds})
 * @returns The landings, in the canvas's order
 * @throws {Error} Naming the slot and the remedy: a `series` known only as it runs, an `of` naming no landing series,
 *   and a landing series keyed by another type
 */
function eventLandings(series: unknown, events: readonly (readonly [string, ScheduleEventKind<EastType, EastType>])[]): readonly PlanLanding[] {
    const landings = planLandings(series);
    if (landings === undefined) {
        throw new Error("Plan: the event kinds land on the rows of a resources series, known as the Plan is built — give `series` the list " +
            "itself, each series written in place: [Plan.series.resources(Row, { key, title, label }), …]");
    }
    const keys = landings.map((landing) => landing.key);
    for (const [slot, kind] of events) {
        for (const taken of kind.takes) {
            const landing = landings.find((l) => l.key === taken);
            if (landing === undefined) {
                throw new Error(`Plan: events.${slot}'s resource names "${taken}", and no resources series or kinds case has that key ` +
                    `(${keys.join(", ") || "none"}) — the event kinds land on the rows of a Plan.series.resources series, or of a Plan.series.kinds case, by its key`);
            }
            if (!isTypeEqual(landing.keyType, StringType)) {
                throw new Error(`Plan: events.${slot}'s resource field "${kind.resourceField ?? ""}" holds .String, the key of a row of "${taken}" — ` +
                    `and those rows are keyed by ${printType(landing.keyType)}: key them by String`);
            }
        }
    }
    return landings;
}

/**
 * What a Plan of event kinds checks before it draws them (#1192, #1541): every key the Plan gives its own rows is no
 * other series' — a row's id is its series' key and its path: a landing row's further ways of drawing, and each
 * kind's Unassigned row.
 *
 * @param landings - The series the event kinds land on
 * @param events - The event kinds, by slot
 * @param series - `data`'s `series`, when given
 * @param rows - The `rows` prop, when given
 * @throws {Error} Naming the two series that share a key
 */
function checkEventRows(
    landings: readonly PlanLanding[],
    events: readonly (readonly [string, ScheduleEventKind<EastType, EastType>])[],
    series: unknown,
    rows: readonly unknown[] | undefined,
): void {
    const owners = new Map<string, string>();
    const claim = (key: string, who: string): void => {
        const prior = owners.get(key);
        if (prior !== undefined) {
            throw new Error(`Plan: ${prior} and ${who} have the same key, "${key}" — a row's id is its series' key and its path, so no two series share one`);
        }
        owners.set(key, who);
    };
    for (const landing of landings) {
        for (const draw of eventDrawsOf(landing.key, events).slice(1)) claim(`${landing.key}.${draw}`, `the ${draw} rows of "${landing.key}"`);
    }
    for (const [slot] of events) claim(`${slot}.unassigned`, `the Unassigned row of events.${slot}`);
    for (const key of planSeriesKeys(series) ?? []) claim(key, "a series in `series`");
    (rows ?? []).forEach((item, i) => {
        for (const key of overSeriesKeys(item) ?? []) claim(key, `rows[${i}] (Plan.over)`);
    });
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
 * @typeParam D - The `data` prop's type, inferred
 * @typeParam S - The `slice` prop's type, inferred
 * @typeParam L - The `series` prop's type, inferred, held to the rows' nested series index (#1435)
 * @param props - The Plan's props ({@link PlanProps})
 * @returns The Plan — the `Plan` carrier over its payload
 */
export function PlanTag<K extends PlanAxisKindLiteral = PlanAxisKindLiteral, D = unknown, S = unknown, L = unknown>(props: PlanProps<K, D, S, L>): UIElement {
    return PlanComponent.Root(createPlanPayload(props as unknown as PlanProps));
}

/** The type of `<Plan>` as a tag. */
export type PlanTagType = typeof PlanTag;
