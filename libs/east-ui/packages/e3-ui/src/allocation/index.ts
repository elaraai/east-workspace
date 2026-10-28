/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Allocation>` (#1371, `Builder Interfaces Spec.md` §6, `Allocation Spec.md`):
 * a day's arrivals booked into timed lane slots, and each bin allocated to
 * resources with room and time for its hold, over the app's own records, in the
 * renderer's BuilderFrame. It writes the app's bins through the bin kind's roles
 * (`Schedule.events`), reads its lanes and its resources (`Schedule.resources`)
 * and what it books from (`Allocation.arrivals`), and publishes the app's days
 * (`Schedule.periods`). It stores nothing in a shape of its own.
 *
 * The tag validates, builds the lanes, the resources and the arrivals from
 * their accessors, and assembles the closed payload; it composes no East UI
 * component and emits no layout, session or gesture program. The app's bin row
 * type `R` crosses the payload as beast2 bytes, as Schedule's kinds' rows do:
 * the app's `check` over bytes at `CheckContext(R)`, its columns over bytes at
 * `R`, and the fit's binding checked against `FitRequest(R)`. The renderer
 * compiles the Allocation's functions over `R`, the bin kind's `rowType`, and
 * calls the fit, the app's `e3.function`, by name: it computes no fit of its own.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, BooleanType, DateTimeType, East, Expr, FloatType, FunctionType, NullType, OptionType, StringType, StructType, VariantType,
    isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue, type ValueTypeOf,
} from "@elaraai/east";
import { EastUI, StatusTokenType, TimeStepType, type UIElement } from "@elaraai/east-ui";
import { RecordSlicesChromeType, RowSourceType, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { FuncBindingType, boundFuncSignature, type BoundFunc } from "../bind/func.js";
import { scheduleCheck } from "../schedule/index.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { SchedulePeriods } from "../schedule/periods.js";
import { SCHEDULE_DEF, type ScheduleResourceKind } from "../schedule/resources.js";
import { ScheduleAllocationKindType, SchedulePeriodsKindType } from "../schedule/types.js";
import { optimiseBinding, type OptimiseContract } from "../utils/optimise.js";
import { recordSources } from "../utils/record-sources.js";
import {
    allocationArrivals, allocationArrivalsOf, allocationInitial, allocationLanesOf, allocationResourcesOf, isAllocationArrivals, type AllocationArrivals,
} from "./adapters.js";
import {
    allocationAnswer, allocationCandidates, allocationCheck, allocationFit, allocationLoads, allocationLookahead, allocationSlots,
} from "./functions.js";
import * as T from "./types.js";

// ============================================================================
// The payload
// ============================================================================

/**
 * A declared library tab.
 *
 * @property arrivals - Arrivals: overdue, ready, removed from the plan, booked
 * @property resources - Resources: free, loading and busy today
 */
export const AllocationLibraryTabType = VariantType({ arrivals: NullType, resources: NullType });

/** Type representing {@link AllocationLibraryTabType}. */
export type AllocationLibraryTabType = typeof AllocationLibraryTabType;

/**
 * One of the app's bin fields shown as a Table column and an inspector row.
 *
 * @property key - Its key
 * @property label - Its heading (`Spec`)
 * @property text - Its text, from the bin's row as bytes at the row type
 * @property tone - Its tone, from the row as bytes; `none` for plain text
 * @property table - Whether the Table shows it; the inspector always does
 */
export const AllocationColumnType = StructType({
    key: StringType, label: StringType, text: FunctionType([BlobType], StringType),
    tone: OptionType(FunctionType([BlobType], OptionType(StatusTokenType))), table: BooleanType,
});

/** Type representing {@link AllocationColumnType}. */
export type AllocationColumnType = typeof AllocationColumnType;

/**
 * One of the board's nouns, resolved: as a heading writes it, its plural, and its article.
 *
 * @property one - The singular, as a heading writes it (`Bay`)
 * @property other - The plural (`Bays`)
 * @property article - `a` or `an`, before the singular in running text
 */
export const AllocationNounType = StructType({ one: StringType, other: StringType, article: StringType });

/** Type representing {@link AllocationNounType}. */
export type AllocationNounType = typeof AllocationNounType;

/**
 * The board's nouns, the app's, everywhere the board writes them (D12).
 *
 * @property lane - A lane (`Lane`)
 * @property arrival - What the board books from (`Arrival`)
 * @property resource - A resource (`Resource`)
 * @property quantity - The quantity's heading word (`QTY`)
 */
export const AllocationLabelsType = StructType({ lane: AllocationNounType, arrival: AllocationNounType, resource: AllocationNounType, quantity: StringType });

/** Type representing {@link AllocationLabelsType}. */
export type AllocationLabelsType = typeof AllocationLabelsType;

/**
 * One of the Table's time bands: it runs from its hour to the next band's, the last to midnight.
 *
 * @property from - Its first hour of the day, `0 ≤ from < 24` (a fraction is minutes: `7.5` is 07:30)
 * @property label - Its heading; `none`, its hours (`06:00–12:00`)
 */
export const AllocationBandType = StructType({ from: FloatType, label: OptionType(StringType) });

/** Type representing {@link AllocationBandType}. */
export type AllocationBandType = typeof AllocationBandType;

/**
 * The Table's options.
 *
 * @property bands - Its time bands, the first from 00:00, each later than the one before
 */
export const AllocationTableOptionsType = StructType({ bands: ArrayType(AllocationBandType) });

/** Type representing {@link AllocationTableOptionsType}. */
export type AllocationTableOptionsType = typeof AllocationTableOptionsType;

/**
 * The board's settings.
 *
 * @property layout - The first layout
 * @property date - The first day; today when `none`
 * @property horizon - The Timeline's resource axis around the day
 * @property title - The summary's heading
 * @property readOnly - No edits; a published day is always read-only
 */
export const AllocationSettingsType = StructType({
    layout: T.AllocationLayoutType, date: OptionType(DateTimeType), horizon: StructType({ before: TimeStepType, after: TimeStepType }),
    title: StringType, readOnly: BooleanType,
});

/** Type representing {@link AllocationSettingsType}. */
export type AllocationSettingsType = typeof AllocationSettingsType;

/**
 * The closed renderer payload (`Builder Interfaces Spec.md` §6). BuilderFrame
 * is internal to the renderer.
 *
 * @property bin - The bin kind: the app's bins read and written through their roles, over bytes at the row type — its `unit` the quantity's, its `values` the fields no role maps
 * @property lanes - Every lane, in order, from the lanes' resource kind's accessors
 * @property every - The slot spacing
 * @property resources - Every resource, from the resources' kind's accessors: the calculation scope, whatever the slice shows
 * @property arrivals - Every arrival the day may book, from `Allocation.arrivals`' accessors
 * @property initial - A booked bin's own fields, by its arrival's key, as bytes at the bin kind's `values`: what its `create` takes; `none`, their types' defaults
 * @property periods - The app's days: their status, and Publish; `none`, no status chip and no Publish
 * @property narrowed - Each narrowed source's keys, paged through its part of `slice`: the lanes, the resources and the arrivals that show
 * @property fit - The app's fit, by its `e3.function`'s name
 * @property optimise - The app's optimiser, by its `e3.function`'s name: what the Elara eye calls over the day in view, its result one edit of the session; `none`, no eye (#1409)
 * @property check - The app's issues, from a `CheckContext(R)` as bytes
 * @property columns - The app's bin fields as columns and inspector rows
 * @property rules - The built-in rules
 * @property library - The library's tabs, in order
 * @property inspector - Whether the inspector pane shows: the bin kind's own `inspector`, or its form over `fields`, draws in it
 * @property slice - The narrowing's chrome: a Slice over the bins', the lanes', the resources' and the arrivals' records, one rail
 * @property settings - The board's settings
 * @property id - Storage keys and drag-source ids
 * @property labels - The board's nouns
 * @property table - The Table's options
 */
export const AllocationPayloadType = StructType({
    bin: ScheduleAllocationKindType,
    lanes: ArrayType(T.AllocationLaneType),
    every: TimeStepType,
    resources: ArrayType(T.AllocationResourceType),
    arrivals: ArrayType(T.AllocationArrivalType),
    initial: FunctionType([StringType], OptionType(BlobType)),
    periods: OptionType(SchedulePeriodsKindType),
    narrowed: StructType({
        lanes: OptionType(RowSourceType(ArrayType(StringType))), resources: OptionType(RowSourceType(ArrayType(StringType))),
        arrivals: OptionType(RowSourceType(ArrayType(StringType))),
    }),
    fit: FuncBindingType,
    optimise: OptionType(FuncBindingType),
    check: OptionType(FunctionType([BlobType], ArrayType(T.AllocationIssueType))),
    columns: ArrayType(AllocationColumnType),
    rules: T.AllocationRulesType,
    library: ArrayType(AllocationLibraryTabType),
    inspector: BooleanType,
    slice: OptionType(RecordSlicesChromeType),
    settings: AllocationSettingsType,
    id: OptionType(StringType),
    labels: AllocationLabelsType,
    table: AllocationTableOptionsType,
});

/** Type representing {@link AllocationPayloadType}. */
export type AllocationPayloadType = typeof AllocationPayloadType;

/** Carrier registered by e3-ui-components. */
export const AllocationComponent = EastUI.component("Allocation", AllocationPayloadType, { optional: true });

// ============================================================================
// The props
// ============================================================================

/**
 * One of the board's nouns: the singular as a heading writes it (`Bay`), or with
 * its plural and article when they aren't regular. The plural defaults to the
 * singular and `s`; the article to `an` before a vowel letter, else `a`.
 */
export type AllocationNoun = string | { one: string; other?: string; article?: "a" | "an" };

/** A library tab declaration. Omit the library to omit its pane. */
export type AllocationLibraryDeclaration = { readonly kind: "arrivals" | "resources" };

/**
 * One of the app's bin fields shown as a column.
 *
 * @typeParam R - The app's bin row type
 */
export interface AllocationColumn<R extends EastType> {
    /** Its key, unique among the columns. */
    key: string;
    /** Its heading. */
    label: string;
    /** Its text from the bin's row. */
    text: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Its tone from the row: `some(variant("warning", null))` draws it in warning text. */
    tone?: (row: ExprType<R>) => SubtypeExprOrValue<OptionType<typeof StatusTokenType>>;
    /** Whether the Table shows it; `false` shows it in the inspector only. True by default. */
    table?: boolean;
}

/**
 * The `<Allocation>` props (§6.1).
 *
 * @typeParam R - The app's bin row type: the bin kind's row
 */
export interface AllocationProps<R extends EastType = EastType> {
    /**
     * Exactly one event kind, the bins, an instant kind keyed by String: `{ bin: Schedule.events(Record.bind(bins, [binsPatch]),
     * { at, resource, arrival, quantity, parts, hold, kind? }) }`.
     */
    events: Readonly<Record<string, ScheduleEventKind<EastType, R>>>;
    /**
     * The lanes' kind, under the slot the bin kind's `resource.of` names, and the resources' kind, under the slot its `parts.of`
     * names — `{ bays: Schedule.resources(rows, { name, icon, label, offset? }), kilns: Schedule.resources(rows, { name, icon,
     * label, min, max, … }) }` — each read whole and keyed by String. Fits, checks and totals read every one.
     */
    resources: Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;
    /** Every arrival the day may book: `Allocation.arrivals(rows, { label, quantity, hold, … })` over the app's rows. */
    arrivals: AllocationArrivals;
    /** What the board publishes, the app's days: `Schedule.periods(Record.bind(days, [daysPatch]), { every: "day", status })`. Omitted, no Publish. */
    periods?: SchedulePeriods;
    /** The fit: `Func.bind` of the app's `e3.function` from `Allocation.Types.FitRequest(R)` to `Allocation.Types.FitResult`. The board has no fit of its own. */
    fit: BoundFunc<[T.AllocationFitRequestType<R>], T.AllocationFitResultType>;
    /**
     * The app's optimiser (#1409): `Func.bind` of its `e3.function` from `Allocation.Types.OptimiseRequest(R)` — the day in view, the run
     * number, the day's bins as drafted, every arrival and the board's context — to `Allocation.Types.OptimiseResult(R)`, the day's bins
     * complete. The Elara eye in the toolbar calls it once per run; the result lands in the session as one edit, which one Undo
     * reverts and Save commits with everything else. Omitted, no eye.
     */
    optimise?: BoundFunc<[T.AllocationOptimiseRequestType<R>], T.AllocationOptimiseResultType<R>>;
    /** The app's issues, after the built-in ones wherever issues show: an East function from `Allocation.Types.CheckContext(R)` to `Array<Allocation.Types.Issue>`. */
    check?: SubtypeExprOrValue<FunctionType<[T.AllocationCheckContextType<R>], ArrayType<T.AllocationIssueType>>>;
    /** The app's bin fields as Table columns (after Quantity) and inspector rows, over the bin's row. */
    columns?: readonly AllocationColumn<R>[];
    /** The slot spacing for every lane; an hour by default. */
    every?: SubtypeExprOrValue<TimeStepType>;
    /**
     * The narrowing: one `Slice.bindRecords`, a source per record it narrows — the bin kind's slot (its interval index from `at`
     * to `at`, its `range` `"at"`, which the board's navigation writes; the kind given `entries`), the lanes' slot, the resources'
     * slot and `arrivals` — one rail in both layouts. Each source narrows every place its rows appear, the Library's tabs
     * included. Fits, checks and totals still read every lane, resource and arrival, and every bin of the day.
     */
    slice?: RecordSlicesChromeOptions;
    /** The built-in rules: whether `Allocation.fit` and `Allocation.check` warn under min (true). */
    rules?: { under?: SubtypeExprOrValue<BooleanType> };
    /** The library's tabs, in order: `Allocation.library.arrivals()`, `Allocation.library.resources()`. Omitted, no start pane. */
    library?: readonly AllocationLibraryDeclaration[];
    /** Shows the inspector pane: the bin kind's own `inspector`, or its form over `fields`, draws in it. */
    inspector?: boolean;
    /** The first view, then persisted under `id`. Today's date by default. */
    view?: { layout?: "timeline" | "table"; date?: SubtypeExprOrValue<DateTimeType> };
    /** The Timeline's resource axis around the day; 3 days before and 10 after by default. */
    horizon?: { before?: SubtypeExprOrValue<TimeStepType>; after?: SubtypeExprOrValue<TimeStepType> };
    /** The summary's heading; `Allocation` by default. */
    title?: string;
    /** No edits; a published day is always read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** Storage keys and drag-source ids, when a surface holds two boards. */
    id?: string;
    /**
     * The board's nouns, everywhere it writes them: `{ lane: "Bay", arrival: "Load", resource: "Kiln" }`. Lane, Arrival and
     * Resource by default; `quantity` is the quantity's heading word, `QTY` by default. Running text writes a noun in lower
     * case unless it is written in capitals.
     */
    labels?: { lane?: AllocationNoun; arrival?: AllocationNoun; resource?: AllocationNoun; quantity?: string };
    /**
     * The Table's time bands: each runs from its hour to the next band's, the last to midnight — `[{ from: 0, label: "Night" },
     * { from: 6, label: "Day" }, { from: 18 }]`. The first is from 0; each later than the one before; a band's heading is its
     * hours unless labelled. Four by default: 00–06 · 06–12 · 12–18 · 18–24.
     */
    table?: { bands?: readonly { from: number; label?: string }[] };
}

/** The bin kind, as the refusals write it. */
const BINS = "events={{ bin: Schedule.events(Record.bind(bins, [binsPatch]), { at, resource, arrival, quantity, parts, hold }) }}";

/** The arrivals' declaration, as the refusals write it. */
const ARRIVALS = "Allocation.arrivals(rows, { label, quantity, hold, … })";

/** The props §2 removed, each refused by name with the form that replaces it (B4). */
const REMOVED: readonly (readonly [string, string])[] = [
    ["days", `\`days\` is gone — the Allocation writes the app's own bins, ${BINS}, and publishes the app's own days, ` +
        "periods={Schedule.periods(Record.bind(days, [daysPatch]), { every: \"day\", status })}"],
    ["window", "`window` is gone — the Allocation reads a day's bins through the bin kind's source of its slice, an interval index from `at` to `at`: " +
        "slice={{ slice: Slice.bindRecords(key, { bin: { source: Data.bindPaged(bins, { indexes: [byTime] }), range: \"at\" } }) }}, the kind given " +
        "`entries`; or the record whole"],
    ["lanes", "`lanes` moves to `resources`: resources={{ <lanes>: Schedule.resources(rows, { name, icon, label, offset }), … }}, under the slot " +
        "the bin kind's `resource.of` names — Allocation.lanes is gone"],
    ["publish", "`publish` is gone — Publish is the app's own days, periods={Schedule.periods(Record.bind(days, [daysPatch]), { every: \"day\", status })}; " +
        "leave `periods` out for no Publish"],
    ["quantity", "`quantity` is gone — the unit is the bin kind's `quantity` role's: Schedule.events(record, { …, quantity: { field, unit: \"m³\" } })"],
];

/** A noun, resolved: its plural the singular and `s`, its article `an` before a vowel letter, unless given. */
function nounOf(input: AllocationNoun | undefined, fallback: string, prop: string): ValueTypeOf<typeof AllocationNounType> {
    const given = input === undefined ? { one: fallback } : typeof input === "string" ? { one: input } : input;
    if (given.one.trim() === "") throw new Error(`Allocation: \`labels.${prop}\` must not be empty`);
    return { one: given.one, other: given.other ?? `${given.one}s`, article: given.article ?? (/^[aeiou]/i.test(given.one) ? "an" : "a") };
}

/**
 * The board's nouns, resolved (D12): each the app's, or Lane, Arrival and
 * Resource, with its plural and article; the quantity's heading `QTY`.
 *
 * @param labels - The `labels` prop, if given
 * @returns The nouns, as the payload carries them
 * @throws {Error} For `labels.event`, which is gone, naming `labels.arrival`; and for a noun that is empty
 * @internal
 */
export function allocationLabels(labels: AllocationProps["labels"]): ValueTypeOf<typeof AllocationLabelsType> {
    if (labels !== undefined && (labels as Readonly<Record<string, unknown>>)["event"] !== undefined) {
        throw new Error("Allocation: `labels.event` is gone — the board's noun for what it books is `labels.arrival`, \"Arrival\" by default");
    }
    return {
        lane: nounOf(labels?.lane, "Lane", "lane"), arrival: nounOf(labels?.arrival, "Arrival", "arrival"),
        resource: nounOf(labels?.resource, "Resource", "resource"), quantity: labels?.quantity ?? "QTY",
    };
}

/**
 * The Table's bands, checked: from 00:00, increasing, inside the day; four by
 * default.
 *
 * @param bands - `table.bands`, if given
 * @returns The bands, as the payload carries them
 * @throws {Error} When there is none, the first is not from 0, one does not start after the one before, or one starts outside the day
 * @internal
 */
export function allocationBands(bands: readonly { from: number; label?: string }[] | undefined): ValueTypeOf<typeof AllocationBandType>[] {
    const given = bands ?? [{ from: 0 }, { from: 6 }, { from: 12 }, { from: 18 }];
    if (given.length === 0) throw new Error("Allocation: `table.bands` needs at least one band, from 0");
    given.forEach((band, i) => {
        if (!Number.isFinite(band.from) || band.from < 0 || band.from >= 24) throw new Error(`Allocation: \`table.bands\`' band ${i + 1} starts at ${band.from}: a band starts within the day, 0 to under 24`);
        if (i === 0 && band.from !== 0) throw new Error("Allocation: `table.bands`' first band starts at 0, so every slot of the day is in one");
        if (i > 0 && band.from <= given[i - 1]!.from) throw new Error(`Allocation: \`table.bands\` start in order: band ${i + 1} starts at ${band.from}, not after ${given[i - 1]!.from}`);
    });
    return given.map(band => ({ from: band.from, label: band.label === undefined ? none : some(band.label) }));
}

/**
 * An app's function over a request of the bin row type, checked, then wrapped
 * so the request crosses as bytes.
 *
 * @param fn - The app's function
 * @param asks - The request type over the bin row type
 * @param answers - What it answers
 * @param refusal - What a function of another type is refused with, naming the prop
 * @returns The function over bytes
 * @throws {Error} With `refusal` when the function asks or answers another type
 */
function overBytes<O extends EastType>(fn: unknown, asks: EastType, answers: O, refusal: string): ExprType<FunctionType<[BlobType], O>> {
    const author = East.value(fn as SubtypeExprOrValue<FunctionType>) as ExprType<FunctionType>;
    const type = Expr.type(author as unknown as Expr) as EastType;
    if (type.type !== "Function" || type.inputs.length !== 1 || !isTypeEqual(type.inputs[0]!, asks) || !isTypeEqual(type.output, answers)) {
        throw new Error(refusal);
    }
    return East.function([BlobType], answers as EastType, ($, bytes) => {
        const call = $.const(author as unknown as ExprType<FunctionType<[EastType], EastType>>);
        return call(bytes.decodeBeast(asks, "v2"));
    }) as unknown as ExprType<FunctionType<[BlobType], O>>;
}

/**
 * The fit's binding, checked: `Func.bind` of an `e3.function` from `Allocation.Types.FitRequest(R)` to `Allocation.Types.FitResult`.
 *
 * @param fit - What the app passed as `fit`
 * @param rowType - The bin kind's row type
 * @returns The binding's descriptor, which names the function
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it — a fit over
 *   another row type naming both row types
 */
function fitBinding(fit: unknown, rowType: EastType): ExprType<typeof FuncBindingType> {
    const signature = boundFuncSignature(fit);
    if (signature === undefined) {
        throw new Error("Allocation: `fit` is Func.bind of the app's e3.function from Allocation.Types.FitRequest(R) to Allocation.Types.FitResult, R the bins' row type");
    }
    const asked = signature.asks;
    if (!isTypeEqual(asked, T.AllocationFitRequestTypeFor(rowType))) {
        // A FitRequest over another row: its day's bins' row.
        const plan = asked.type === "Struct" ? asked.fields["plan"] : undefined;
        const bins = plan?.type === "Struct" ? plan.fields["bins"] : undefined;
        const theirs = bins?.type === "Dict" && bins.value.type === "Struct" ? bins.value.fields["row"] : undefined;
        throw new Error(theirs !== undefined && isTypeEqual(asked, T.AllocationFitRequestTypeFor(theirs))
            ? `Allocation: \`fit\` is bound over bin rows ${printType(theirs)}, and the bin kind's rows are ${printType(rowType)} — bind a fit over Allocation.Types.FitRequest of the bins' row type`
            : `Allocation: \`fit\` asks ${printType(asked)}, not Allocation.Types.FitRequest(${printType(rowType)})`);
    }
    if (!isTypeEqual(signature.answers, T.AllocationFitResultType)) {
        throw new Error(`Allocation: \`fit\` answers ${printType(signature.answers)}, not Allocation.Types.FitResult`);
    }
    return (fit as ExprType<StructType<{ binding: typeof FuncBindingType }>>).binding;
}

/**
 * What the Allocation holds `optimise` to (#1409): `Func.bind` of an `e3.function` from `Allocation.Types.OptimiseRequest(R)` to
 * `Allocation.Types.OptimiseResult(R)`, R the bins' row type — a request over another row named by its bins' row.
 *
 * @param rowType - The bin kind's row type
 * @returns The contract, for {@link optimiseBinding}
 */
function allocationOptimiseContract(rowType: EastType): OptimiseContract {
    const rows = printType(rowType);
    return {
        builder: "Allocation", request: T.AllocationOptimiseRequestTypeFor(rowType), result: T.AllocationOptimiseResultTypeFor(rowType),
        signature: "from Allocation.Types.OptimiseRequest(R) to Allocation.Types.OptimiseResult(R), R the bins' row type",
        names: { request: "Allocation.Types.OptimiseRequest", result: "Allocation.Types.OptimiseResult" },
        rows: { request: rows, result: rows }, noun: { theirs: "bin rows", ours: "the bin kind's rows" }, of: "the bins' row type",
        otherRows: (asked) => {
            // An OptimiseRequest over another row: its bins' row.
            const bins = asked.type === "Struct" ? asked.fields["bins"] : undefined;
            const theirs = bins?.type === "Dict" ? bins.value : undefined;
            return theirs !== undefined && isTypeEqual(asked, T.AllocationOptimiseRequestTypeFor(theirs)) ? printType(theirs) : undefined;
        },
    };
}

/**
 * Validates the declarations and assembles the Allocation's interface. View
 * and interaction behaviour belong to the renderer, not this factory.
 *
 * @typeParam R - The app's bin row type
 * @param props - The board's props
 * @returns The closed payload
 * @throws {Error} Naming the change to make (B4): a removed prop — `days`, `window`, `lanes`, `publish`, `quantity`,
 *   `resources` as values, `inspector={{ bin }}` or `labels.event`; `events` holding other than one kind; a bin kind with
 *   no lane (`resource`) or no `parts`, or whose slot, lanes' slot or resources' slot names a source of the slice twice;
 *   `resources` holding other than the lanes' kind and the resources' kind, one read a window at a time, resources keyed
 *   by anything but String, or a resources kind with no `min` or `max`; `arrivals` that is not `Allocation.arrivals`, and
 *   its `values` returning another struct than the bin kind's own fields; `periods` that is not `Schedule.periods`; a
 *   `fit` that is not `Func.bind` of a function from `FitRequest(R)` to `FitResult`, one over another row type naming
 *   both; an `optimise` that is not `Func.bind` of a function from `OptimiseRequest(R)` to `OptimiseResult(R)`, one over
 *   another row type naming both (#1409); a `check` of another type; a library tab or a column key listed twice; a label that is empty; the Table's
 *   bands not starting at 0 and rising within the day; and as `Schedule`'s checks, the bin kind's build
 *   (`buildAllocation`) and the slice's (`recordSources`) do
 * @internal
 */
export function createAllocationPayload<R extends EastType>(props: AllocationProps<R>): ExprType<typeof AllocationPayloadType> {
    const given = props as unknown as Readonly<Record<string, unknown>>;
    for (const [prop, refusal] of REMOVED) {
        if (given[prop] !== undefined) throw new Error(`Allocation: ${refusal}`);
    }
    if (given["resources"] instanceof Expr) {
        throw new Error("Allocation: `resources` holds Schedule.resources kinds by slot — the lanes' (the bin kind's `resource.of`) and the resources' " +
            "(its `parts.of`): resources={{ bays: Schedule.resources(rows, { …, offset }), kilns: Schedule.resources(rows, { …, min, max }) }} — " +
            "Allocation.resources values are gone");
    }
    if (props.inspector !== undefined && typeof props.inspector !== "boolean") {
        throw new Error("Allocation: `inspector` is true or false — a bin's own form is the bin kind's `inspector` (Schedule.events(record, { …, inspector }))");
    }
    const labels = allocationLabels(props.labels);
    const bands = allocationBands(props.table?.bands);

    // The bins: exactly one event kind.
    const events = given["events"];
    if (events instanceof Expr || (events !== undefined && (typeof events !== "object" || events === null))) {
        throw new Error(`Allocation: \`events\` holds the bins, one Schedule.events kind — ${BINS}; what the board books from is arrivals={${ARRIVALS}}`);
    }
    const kinds = Object.entries(props.events ?? {});
    if (kinds.length !== 1) {
        throw new Error(kinds.length === 0
            ? `Allocation: \`events\` holds the bins — ${BINS}`
            : `Allocation: \`events\` holds one kind, the bins — and it holds ${kinds.length} (${kinds.map(([slot]) => slot).join(", ")})`);
    }
    const [slot, kind] = kinds[0]!;
    const resources = props.resources ?? {};
    scheduleCheck(resources, props.events as Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>, "Allocation");
    // The lanes' slot, the bin kind's `resource.of`; and the resources', its `parts.of`.
    if (kind.takes.length === 0) {
        throw new Error(`Allocation: events.${slot} books each bin into one lane — give it a \`resource\`, a String field naming a key of the lanes' kind: ` +
            "resource: { field, of: \"<lanes>\" }");
    }
    if (kind.takes.length > 1) {
        throw new Error(`Allocation: events.${slot} books each bin into one lane — its \`resource\` is a String field naming a key of the lanes' kind, ` +
            `and this one names a kind per case (${kind.takes.join(", ")})`);
    }
    const lanesSlot = kind.takes[0]!;
    const partsSlot = kind.partsOf;
    if (partsSlot === undefined) {
        throw new Error(`Allocation: events.${slot} allocates each bin to resources — give it \`parts\`, a Dict of String to Float field and the resources' slot: ` +
            "parts: { field, of: \"<resources>\" }");
    }
    // The slice names a source after each: the bins, the lanes, the resources and the arrivals.
    if (slot === "arrivals" || lanesSlot === "arrivals" || partsSlot === "arrivals" || slot === lanesSlot || slot === partsSlot) {
        throw new Error(`Allocation: the slice names a source after the bins' slot ("${slot}"), the lanes' ("${lanesSlot}"), the resources' ("${partsSlot}") ` +
            "and the arrivals (`arrivals`) — give the bins a slot of their own, and none of them `arrivals`");
    }
    for (const name of Object.keys(resources)) {
        if (name !== lanesSlot && name !== partsSlot) {
            throw new Error(`Allocation: \`resources\` holds the lanes' kind (\`${lanesSlot}\`, the slot events.${slot}'s resource names) and the resources' kind ` +
                `(\`${partsSlot}\`, the slot its parts name) — and it holds \`${name}\``);
        }
    }
    const resourcesKind = resources[partsSlot];
    if (resourcesKind === undefined) {
        throw new Error(`Allocation: events.${slot}'s parts name the slot "${partsSlot}", and \`resources\` has no slot of that name (${Object.keys(resources).join(", ") || "none"})`);
    }
    if (!isTypeEqual(resourcesKind.keyType, StringType)) {
        throw new Error(`Allocation: events.${slot}'s parts hold String keys of resources.${partsSlot}, which is keyed by ${printType(resourcesKind.keyType)} — key the resources by String`);
    }
    // The lanes' kind is there and keyed by String: `scheduleCheck` holds the slot the bin kind's resource names to it.
    const lanesKind = resources[lanesSlot]!;
    for (const [name, resourceKind, reads] of [
        [lanesSlot, lanesKind, "the board draws every lane, and slots and checks read every one"],
        [partsSlot, resourcesKind, "fits, checks and totals read every one"],
    ] as const) {
        if (resourceKind.source === undefined) {
            throw new Error(`Allocation: resources.${name} is read whole — ${reads} — so give the rows as a Dict, usually a record's read(), not a paged read`);
        }
    }
    if (resourcesKind.accessors.min === undefined || resourcesKind.accessors.max === undefined) {
        throw new Error(`Allocation: resources.${partsSlot} gives each resource's \`min\` and \`max\` — ` +
            `Schedule.resources(${partsSlot}.read(), { …, min: (k) => k.min, max: (k) => k.max })`);
    }
    // What the board books from.
    if (!isAllocationArrivals(given["arrivals"])) {
        throw new Error(`Allocation: \`arrivals\` is ${ARRIVALS} over the app's rows — every arrival the day may book` +
            (given["arrivals"] instanceof Expr ? " — Allocation.Types.Arrival values are gone" : ""));
    }
    const arrivals = given["arrivals"];
    const periods = props.periods;
    if (periods !== undefined && (periods as { [SCHEDULE_DEF]?: unknown })[SCHEDULE_DEF] !== "periods") {
        throw new Error("Allocation: `periods` is what the board publishes, the app's days — periods={Schedule.periods(Record.bind(days, [daysPatch]), { every: \"day\", status })}");
    }

    // The app's functions over the bin row type.
    const rowType = kind.rowType as EastType;
    const fit = fitBinding(props.fit, rowType);
    const optimise = props.optimise === undefined ? undefined : optimiseBinding(props.optimise, allocationOptimiseContract(rowType));
    const check = props.check === undefined ? undefined : overBytes(props.check, T.AllocationCheckContextTypeFor(rowType), ArrayType(T.AllocationIssueType),
        `Allocation: \`check\` is an East function from Allocation.Types.CheckContext(${printType(rowType)}) to Array<Allocation.Types.Issue>`);
    // A booked bin's own fields, the ones no role maps: each arrival's `values`, at the bin kind's (B13).
    const initial = allocationInitial(arrivals, kind.allocationValues);
    // The app's columns over its bin row, as bytes.
    const keys = new Set<string>();
    const columns = (props.columns ?? []).map(column => {
        if (keys.has(column.key)) throw new Error(`Allocation: duplicate column ${column.key}`);
        keys.add(column.key);
        // An author's accessor may return a subtype (a tone of one case): widened to the column's type here.
        const text = East.function([rowType], StringType, (_$, row) => East.as(column.text(row as ExprType<R>), StringType));
        const tone = column.tone === undefined ? undefined
            : East.function([rowType], OptionType(StatusTokenType), (_$, row) => East.as(column.tone!(row as ExprType<R>) as never, OptionType(StatusTokenType)));
        return East.value({
            key: column.key, label: column.label,
            text: East.function([BlobType], StringType, ($, bytes) => {
                const textOf = $.const(text);
                return textOf(bytes.decodeBeast(rowType, "v2"));
            }),
            tone: tone === undefined ? none : some(East.function([BlobType], OptionType(StatusTokenType), ($, bytes) => {
                const toneOf = $.const(tone);
                return toneOf(bytes.decodeBeast(rowType, "v2"));
            })),
            table: column.table ?? true,
        }, AllocationColumnType);
    });
    // The library's tabs, each once.
    const seen = new Set<string>();
    const library = (props.library ?? []).map(tab => {
        if (tab.kind !== "arrivals" && tab.kind !== "resources") {
            throw new Error(`Allocation: a library tab is Allocation.library.arrivals() or Allocation.library.resources() — and this one is ${String(tab.kind)}`);
        }
        if (seen.has(tab.kind)) throw new Error(`Allocation: duplicate library tab ${tab.kind}`);
        seen.add(tab.kind);
        return East.value(variant(tab.kind, null), AllocationLibraryTabType);
    });
    // The narrowing: a source per record it narrows, named after what it narrows.
    const narrowing = recordSources(props.slice, {
        builder: "Allocation", names: [...new Set([slot, lanesSlot, partsSlot, "arrivals"])],
        what: `its bins (${slot}), its lanes (${lanesSlot}), its resources (${partsSlot}) and its arrivals`,
    });
    return Expr.block($ => {
        const bound = narrowing.bind($);
        const shown = (name: string) => {
            const source = bound.keys[name];
            return source === undefined ? none : some(source as never);
        };
        return East.value({
            // The bins, narrowed through their own source of the slice when the slice has one.
            bin: kind.buildAllocation(slot, bound.parts[slot]),
            lanes: allocationLanesOf(lanesKind),
            every: props.every ?? variant("hours", 1.0),
            resources: allocationResourcesOf(resourcesKind),
            arrivals: allocationArrivalsOf(arrivals),
            initial,
            periods: periods === undefined ? none : some(periods.build()),
            narrowed: { lanes: shown(lanesSlot), resources: shown(partsSlot), arrivals: shown("arrivals") },
            fit,
            optimise: optimise === undefined ? none : some(optimise),
            check: check === undefined ? none : some(check),
            columns,
            rules: { under: props.rules?.under ?? true },
            library,
            inspector: props.inspector ?? false,
            slice: narrowing.chrome,
            settings: {
                layout: variant(props.view?.layout ?? "timeline", null), date: props.view?.date === undefined ? none : some(props.view.date),
                horizon: { before: props.horizon?.before ?? variant("days", 3.0), after: props.horizon?.after ?? variant("days", 10.0) },
                title: props.title ?? "Allocation", readOnly: props.readOnly ?? false,
            },
            id: props.id === undefined ? none : some(props.id),
            labels,
            table: { bands },
        } as never, AllocationPayloadType);
    }) as ExprType<typeof AllocationPayloadType>;
}

// ============================================================================
// The namespace
// ============================================================================

/** Declares the Arrivals tab. */
function allocationArrivalsTab(): AllocationLibraryDeclaration { return { kind: "arrivals" }; }
/** Declares the Resources tab. */
function allocationResourcesTab(): AllocationLibraryDeclaration { return { kind: "resources" }; }

/**
 * Refuses a removed helper by name, with the form that replaces it.
 *
 * @param refusal - The words
 * @returns A function that refuses
 */
function removed(refusal: string): (...args: never[]) => never {
    return () => { throw new Error(refusal); };
}

/** The tag, its declaration of the arrivals, its pure functions over the bin row type, and its types. */
export interface AllocationNamespace {
    /** Renders a board over the app's own records. */
    <R extends EastType>(props: AllocationProps<R>): UIElement;
    /** Declares what the board books from, the arrivals, from the app's keyed rows. */
    arrivals: typeof allocationArrivals;
    /** The built-in rules, one verdict per candidate. */
    fit: typeof allocationFit;
    /** `loads(R)`: every resource's load on the plan day. */
    loads: typeof allocationLoads;
    /** `candidates(R)`: a fit's candidates. */
    candidates: typeof allocationCandidates;
    /** `answer(R)`: a fit's answer from a fit per candidate. */
    answer: typeof allocationAnswer;
    /** `lookahead(R)`: a greedy look-ahead over a fit. */
    lookahead: typeof allocationLookahead;
    /** `check(R)`: the built-in checks. */
    check: typeof allocationCheck;
    /** `slots(R)`: the day's lane slots. */
    slots: typeof allocationSlots;
    /** Declares the library's tabs. */
    library: {
        arrivals: typeof allocationArrivalsTab; resources: typeof allocationResourcesTab;
        /** @deprecated Removed (#1371): the Arrivals tab is `Allocation.library.arrivals()`. */
        events: (...args: never[]) => never;
    };
    /** @deprecated Removed (#1371): what the board books from is `arrivals={Allocation.arrivals(rows, { label, quantity, hold, … })}`. */
    events: (...args: never[]) => never;
    /** @deprecated Removed (#1371): the lanes are a `Schedule.resources` kind under the slot the bin kind's `resource` names. */
    lanes: (...args: never[]) => never;
    /** @deprecated Removed (#1371): the resources are a `Schedule.resources` kind under the slot the bin kind's `parts` name. */
    resources: (...args: never[]) => never;
    /** The Allocation's East types; those over a day are constructors of the app's bin row type. */
    Types: {
        Lane: typeof T.AllocationLaneType; Status: typeof T.AllocationStatusType;
        Bin: typeof T.AllocationBinTypeFor; Day: typeof T.AllocationDayTypeFor;
        Interval: typeof T.AllocationIntervalType; Job: typeof T.AllocationJobType; Detail: typeof T.AllocationDetailType;
        Arrival: typeof T.AllocationArrivalType; Resource: typeof T.AllocationResourceType; Rules: typeof T.AllocationRulesType;
        Context: typeof T.AllocationContextType; LoadState: typeof T.AllocationLoadStateType; Load: typeof T.AllocationLoadType;
        Candidate: typeof T.AllocationCandidateType; Refusal: typeof T.AllocationRefusalType; Fit: typeof T.AllocationFitType;
        FitAsk: typeof T.AllocationFitAskType; FitRequest: typeof T.AllocationFitRequestTypeFor; FitResult: typeof T.AllocationFitResultType;
        Fix: typeof T.AllocationFixType; IssueKind: typeof T.AllocationIssueKindType; Issue: typeof T.AllocationIssueType;
        CheckContext: typeof T.AllocationCheckContextTypeFor; SlotStatus: typeof T.AllocationSlotStatusType; Slot: typeof T.AllocationSlotType;
        Layout: typeof T.AllocationLayoutType;
        OptimiseRequest: typeof T.AllocationOptimiseRequestTypeFor; OptimiseResult: typeof T.AllocationOptimiseResultTypeFor;
    };
}

/**
 * Books a day's arrivals into timed lane slots and allocates each bin to
 * resources, over the app's own records, in an internal BuilderFrame.
 *
 * @param props - The bins, the lanes and resources, the arrivals and the fit, and the optional days, check, library, inspector and narrowing
 * @returns The Allocation extension
 * @remarks Every gesture is one undo step; Save sends each record's changes as its own request, and Publish saves, then the day's status. Issues never block either. Below 480px of main the same commands are explicit card actions.
 */
export const Allocation: AllocationNamespace = Object.assign(
    <R extends EastType>(props: AllocationProps<R>): UIElement => AllocationComponent.Root(createAllocationPayload(props)),
    {
        arrivals: allocationArrivals, fit: allocationFit, loads: allocationLoads, candidates: allocationCandidates, answer: allocationAnswer,
        lookahead: allocationLookahead, check: allocationCheck, slots: allocationSlots,
        library: {
            arrivals: allocationArrivalsTab, resources: allocationResourcesTab,
            events: removed("Allocation.library.events is gone — the Arrivals tab is Allocation.library.arrivals()"),
        },
        events: removed(`Allocation.events is gone — what the board books from is arrivals={${ARRIVALS}}, and its \`events\` are its bins, ${BINS}`),
        lanes: removed("Allocation.lanes is gone — the lanes are a Schedule.resources kind under the slot the bin kind's `resource` names: " +
            "resources={{ <lanes>: Schedule.resources(rows, { name, icon, label, offset }), … }}"),
        resources: removed("Allocation.resources is gone — the resources are a Schedule.resources kind under the slot the bin kind's `parts` name: " +
            "resources={{ …, <resources>: Schedule.resources(rows, { name, icon, label, min, max }) }}"),
        Types: {
            Lane: T.AllocationLaneType, Status: T.AllocationStatusType, Bin: T.AllocationBinTypeFor, Day: T.AllocationDayTypeFor,
            Interval: T.AllocationIntervalType, Job: T.AllocationJobType, Detail: T.AllocationDetailType, Arrival: T.AllocationArrivalType,
            Resource: T.AllocationResourceType, Rules: T.AllocationRulesType, Context: T.AllocationContextType, LoadState: T.AllocationLoadStateType,
            Load: T.AllocationLoadType, Candidate: T.AllocationCandidateType, Refusal: T.AllocationRefusalType, Fit: T.AllocationFitType,
            FitAsk: T.AllocationFitAskType, FitRequest: T.AllocationFitRequestTypeFor, FitResult: T.AllocationFitResultType, Fix: T.AllocationFixType,
            IssueKind: T.AllocationIssueKindType, Issue: T.AllocationIssueType, CheckContext: T.AllocationCheckContextTypeFor,
            SlotStatus: T.AllocationSlotStatusType, Slot: T.AllocationSlotType, Layout: T.AllocationLayoutType,
            OptimiseRequest: T.AllocationOptimiseRequestTypeFor, OptimiseResult: T.AllocationOptimiseResultTypeFor,
        },
    },
);
