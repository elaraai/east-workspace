/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Allocation>` (`Allocation Spec.md`): a day's events booked into timed lane
 * slots, and each bin allocated to a resource with room and time for its
 * hold, edited as a Timeline or a Table over one plans record, in the
 * renderer's BuilderFrame.
 *
 * The tag validates, reifies the accessors once and assembles the closed
 * payload; it composes no East UI component and emits no layout, session or
 * gesture program. The app's bin values `V` cross the payload as beast2 bytes,
 * as Schedule's event kinds' rows do. The fit is the app's `e3.function`,
 * bound with `Func.bind`; the renderer calls it by name and computes no fit of
 * its own.
 *
 * @packageDocumentation
 */

import {
    ArrayType, AsyncFunctionType, BlobType, BooleanType, DateTimeType, East, EastTypeType, Expr, FunctionType, IntegerType, NullType,
    OptionType, StringType, StructType, VariantType, isTypeEqual, none, printType, some, toEastTypeValue, variant,
    type DictType, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, Editing, StatusTokenType, TimeStepType, UIComponentType, type UIElement } from "@elaraai/east-ui";
import {
    RecordSlicesChromeType, RowSourceType, isRecordSlices, recordSlicesChrome, type RecordSlicesChromeOptions,
} from "@elaraai/east-ui/internal";
import { DataPagedHandleType, type PagedValue } from "../bind/data.js";
import { FuncBindingType, type BoundFunc } from "../bind/func.js";
import { Record, type RecordBindingType } from "../bind/record.js";
import { RowInspectorType, rowInspector } from "../utils/row-inspector.js";
import { keyVisibility } from "../utils/key-visibility.js";
import { ALLOCATION_EVENTS, allocationEvents, allocationLanes, allocationResources, resolveAllocationEvents, type AllocationEvents } from "./adapters.js";
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
 * @property events - Events: overdue, ready, removed from the plan, allocated
 * @property resources - Resources: free, loading and busy today
 */
export const AllocationLibraryTabType = VariantType({ events: NullType, resources: NullType });

/** Type representing {@link AllocationLibraryTabType}. */
export type AllocationLibraryTabType = typeof AllocationLibraryTabType;

/**
 * The inspector's options.
 *
 * @property bin - The app's bin form, over the bin and a writer of the edited bin as bytes; `none`, the built-in quantity field and value rows
 */
export const AllocationInspectorType = StructType({ bin: OptionType(RowInspectorType) });

/** Type representing {@link AllocationInspectorType}. */
export type AllocationInspectorType = typeof AllocationInspectorType;

/**
 * One of the app's bin values shown as a Table column and an inspector row.
 *
 * @property key - Its key
 * @property label - Its heading (`Spec`)
 * @property text - Its text, from the bin's values as bytes
 * @property tone - Its tone, from the values as bytes; `none` for plain text
 * @property table - Whether the Table shows it; the inspector always does
 */
export const AllocationColumnType = StructType({
    key: StringType, label: StringType, text: FunctionType([BlobType], StringType),
    tone: OptionType(FunctionType([BlobType], OptionType(StatusTokenType))), table: BooleanType,
});

/** Type representing {@link AllocationColumnType}. */
export type AllocationColumnType = typeof AllocationColumnType;

/** The plans read a day at a time: `Data.bindPaged(plans)`'s handle, its windows as bytes at `Days(V)`. */
export const AllocationWindowType = DataPagedHandleType(BlobType);

/** Type representing {@link AllocationWindowType}. */
export type AllocationWindowType = typeof AllocationWindowType;

/**
 * The board's settings.
 *
 * @property layout - The first layout
 * @property date - The first day; today when `none`
 * @property horizon - The Timeline's resource axis around the day
 * @property title - The summary's heading
 * @property publish - Whether the status chip and Publish show
 * @property readOnly - No edits; a published day is always read-only
 */
export const AllocationSettingsType = StructType({
    layout: T.AllocationLayoutType, date: OptionType(DateTimeType), horizon: StructType({ before: TimeStepType, after: TimeStepType }),
    title: StringType, publish: BooleanType, readOnly: BooleanType,
});

/** Type representing {@link AllocationSettingsType}. */
export type AllocationSettingsType = typeof AllocationSettingsType;

/**
 * The closed renderer payload (§5.2). BuilderFrame is internal to the
 * renderer.
 *
 * @property sourceId - The plans record's name
 * @property read - The plans, as bytes at `Days(V)`; not read when `window` is given
 * @property apply - Commits one day's batch, as bytes at `Editing.Types.ChangeSet(Day(V), DateTime)`, through the record's patch door
 * @property window - The plans read a day at a time
 * @property valuesType - The app's bin values type `V`
 * @property lanes - The lanes, in order
 * @property every - The slot spacing
 * @property events - Every event the day may book
 * @property resources - Every resource
 * @property initial - An event's starting values, by its key, as bytes at `V`
 * @property narrowed - Each narrowed source's keys, paged through its part of `slice`: the lanes and the resources that show
 * @property fit - The app's fit, by its `e3.function`'s name
 * @property check - The app's issues, from the check context as bytes at `CheckContext(V)`
 * @property columns - The app's values as columns and inspector rows
 * @property rules - The built-in rules
 * @property quantity - The quantity's unit
 * @property library - The library's tabs, in order
 * @property inspector - The inspector's options; `none`, no inspector
 * @property slice - The narrowing's chrome: a Slice over the lanes' and the resources' records, one rail
 * @property settings - The board's settings
 * @property id - Storage keys and drag-source ids
 */
export const AllocationPayloadType = StructType({
    sourceId: StringType,
    read: FunctionType([], BlobType),
    apply: AsyncFunctionType([BlobType], Editing.Types.ApplyResult),
    window: OptionType(AllocationWindowType),
    valuesType: EastTypeType,
    lanes: ArrayType(T.AllocationLaneType),
    every: TimeStepType,
    events: ArrayType(T.AllocationEventType),
    resources: ArrayType(T.AllocationResourceType),
    initial: FunctionType([StringType], BlobType),
    narrowed: StructType({ lanes: OptionType(RowSourceType(ArrayType(StringType))), resources: OptionType(RowSourceType(ArrayType(StringType))) }),
    fit: FuncBindingType,
    check: OptionType(FunctionType([BlobType], ArrayType(T.AllocationIssueType))),
    columns: ArrayType(AllocationColumnType),
    rules: T.AllocationRulesType,
    quantity: StructType({ unit: OptionType(StringType) }),
    library: ArrayType(AllocationLibraryTabType),
    inspector: OptionType(AllocationInspectorType),
    slice: OptionType(RecordSlicesChromeType),
    settings: AllocationSettingsType,
    id: OptionType(StringType),
});

/** Type representing {@link AllocationPayloadType}. */
export type AllocationPayloadType = typeof AllocationPayloadType;

/** Carrier registered by e3-ui-components. */
export const AllocationComponent = EastUI.component("Allocation", AllocationPayloadType, { optional: true });

// ============================================================================
// The props
// ============================================================================

/** The plans record bound with its patch mutation: what `days` takes. */
export type AllocationDaysHandle<V extends EastType> = ExprType<StructType<{ read: FunctionType<[], T.AllocationDaysType<V>>; binding: RecordBindingType }>>;

/** A library tab declaration. Omit the library to omit its pane. */
export type AllocationLibraryDeclaration = { readonly kind: "events" | "resources" };

/**
 * One of the app's bin values shown as a column.
 *
 * @typeParam V - The app's bin values
 */
export interface AllocationColumn<V extends EastType> {
    /** Its key, unique among the columns. */
    key: string;
    /** Its heading. */
    label: string;
    /** Its text from the bin's values. */
    text: (values: ExprType<V>) => SubtypeExprOrValue<StringType>;
    /** Its tone from the values: `some(variant("warning", null))` draws it in warning text. */
    tone?: (values: ExprType<V>) => SubtypeExprOrValue<OptionType<typeof StatusTokenType>>;
    /** Whether the Table shows it; `false` shows it in the inspector only. True by default. */
    table?: boolean;
}

/**
 * The `<Allocation>` props (§4.2).
 *
 * @typeParam V - The app's bin values: the plans record's `V`
 */
export interface AllocationProps<V extends EastType> {
    /** The plans record, `Allocation.Types.Days(V)`, bound with its patch mutation: what the board reads and saves through, a day an entry. */
    days: AllocationDaysHandle<V>;
    /** `Data.bindPaged(plans)` on the same record, no index: the board reads a day at a time, for a long history. */
    window?: PagedValue<T.AllocationDaysType<V>>;
    /** The lanes, in order; at least one: `Allocation.lanes(rows, { … })` over the app's record, or the lanes themselves. */
    lanes: SubtypeExprOrValue<ArrayType<typeof T.AllocationLaneType>>;
    /** The slot spacing for every lane; an hour by default. */
    every?: SubtypeExprOrValue<typeof TimeStepType>;
    /** Every event the day may book: `Allocation.events(rows, { … })`. */
    events: AllocationEvents;
    /** Every resource: `Allocation.resources(rows, { … })`. Fits, checks and totals read all of them. */
    resources: SubtypeExprOrValue<ArrayType<typeof T.AllocationResourceType>>;
    /** The fit: `Func.bind` of the app's `e3.function` from `Allocation.Types.FitRequest(V)` to `Allocation.Types.FitResult`. The board has no fit of its own. */
    fit: BoundFunc<[T.AllocationFitRequestType<V>], typeof T.AllocationFitResultType>;
    /** The app's issues, after the built-in ones wherever issues show. */
    check?: SubtypeExprOrValue<FunctionType<[T.AllocationCheckContextType<V>], ArrayType<typeof T.AllocationIssueType>>>;
    /** The app's bin values as Table columns (after Quantity) and inspector rows. */
    columns?: readonly AllocationColumn<V>[];
    /**
     * The narrowing: `Slice.bindRecords(key, { lanes, resources })` over the lanes' and the resources' records, one rail in both
     * layouts. The board reads each source's narrowed keys itself; fits, checks and totals still read every lane and resource.
     */
    slice?: RecordSlicesChromeOptions;
    /** The unit everywhere a quantity shows. */
    quantity?: { unit?: string };
    /** The built-in rules: whether `Allocation.fit` and `Allocation.check` warn under min (true). */
    rules?: { under?: SubtypeExprOrValue<BooleanType> };
    /** The library's tabs, in order; omitted, no start pane. */
    library?: readonly AllocationLibraryDeclaration[];
    /** The inspector: `true`, or a typed bin form in place of the built-in quantity field and value rows. */
    inspector?: boolean | {
        /** The bin form: the bin and a writer of the edited bin, to what the inspector shows. */
        bin?: SubtypeExprOrValue<FunctionType<[T.AllocationBinType<V>, FunctionType<[T.AllocationBinType<V>], NullType>], UIComponentType>>;
    };
    /** The first view, then persisted under `id`. Today's date by default. */
    view?: { layout?: "timeline" | "table"; date?: SubtypeExprOrValue<DateTimeType> };
    /** The Timeline's resource axis around the day; 3 days before and 10 after by default. */
    horizon?: { before?: SubtypeExprOrValue<typeof TimeStepType>; after?: SubtypeExprOrValue<typeof TimeStepType> };
    /** The summary's heading; `Allocation` by default. */
    title?: string;
    /** The status chip and Publish; true by default. */
    publish?: boolean;
    /** No edits; a published day is always read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** Storage keys and drag-source ids, when a surface holds two boards. */
    id?: string;
}

/** The plans' bin values type, read from the plans record's type. */
function valuesOf(daysType: EastType): EastType | undefined {
    if (daysType.type !== "Dict" || daysType.key.type !== "DateTime" || daysType.value.type !== "Struct") return undefined;
    const bins = daysType.value.fields["bins"];
    if (bins?.type !== "Dict" || bins.value.type !== "Struct") return undefined;
    const values = bins.value.fields["values"];
    return values !== undefined && isTypeEqual(daysType, T.AllocationDaysTypeFor(values)) ? values : undefined;
}

/**
 * Assembles the payload; domain and interaction programs live outside the tag.
 *
 * @typeParam V - The app's bin values
 * @param props - The board's props
 * @returns The payload
 * @throws {Error} When `days` is not a plans record, `fit` is bound over other bin values, `lanes` is empty, a library tab repeats, a column key repeats, a callback has another type, or `slice` is not `Slice.bindRecords` over `lanes` and `resources`
 * @internal
 */
export function createAllocationPayload<V extends EastType>(props: AllocationProps<V>): ExprType<typeof AllocationPayloadType> {
    const handle = props.days as unknown as ExprType<StructType<{ read: FunctionType<[], DictType<DateTimeType, EastType>>; binding: RecordBindingType }>>;
    const daysType = ((Expr.type(handle as unknown as Expr) as StructType).fields["read"] as FunctionType).output as EastType;
    const values = valuesOf(daysType);
    if (values === undefined) {
        throw new Error(`Allocation: \`days\` is the plans record, Allocation.Types.Days(V), bound with its patch mutation — this one holds ${printType(daysType)}`);
    }
    const dayType = T.AllocationDayTypeFor(values);
    // The fit, bound over the same bin values.
    const fitType = Expr.type(props.fit as unknown as Expr) as EastType;
    const call = fitType.type === "Struct" ? fitType.fields["call"] : undefined;
    const read = fitType.type === "Struct" ? fitType.fields["read"] : undefined;
    const asked = call?.type === "Function" && call.inputs.length === 1 ? call.inputs[0]! : undefined;
    const answered = read?.type === "Function" && read.output.type === "Variant" ? read.output.cases["some"] : undefined;
    if (asked === undefined || answered === undefined || fitType.type !== "Struct" || fitType.fields["binding"] === undefined) {
        throw new Error("Allocation: `fit` is Func.bind of the app's e3.function from Allocation.Types.FitRequest(V) to Allocation.Types.FitResult");
    }
    if (!isTypeEqual(asked, T.AllocationFitRequestTypeFor(values))) {
        const theirs = asked.type === "Struct" && asked.fields["plan"]?.type === "Struct" && asked.fields["plan"].fields["bins"]?.type === "Dict"
            && asked.fields["plan"].fields["bins"].value.type === "Struct" ? asked.fields["plan"].fields["bins"].value.fields["values"] : undefined;
        throw new Error(theirs !== undefined
            ? `Allocation: \`fit\` is bound over bin values ${printType(theirs)}, and \`days\` holds bin values ${printType(values)} — bind a fit over Allocation.Types.FitRequest of the plans' bin values`
            : `Allocation: \`fit\` asks ${printType(asked)}, not Allocation.Types.FitRequest(${printType(values)})`);
    }
    if (!isTypeEqual(answered, T.AllocationFitResultType)) {
        throw new Error(`Allocation: \`fit\` answers ${printType(answered)}, not Allocation.Types.FitResult`);
    }
    if (Array.isArray(props.lanes) && props.lanes.length === 0) throw new Error("Allocation: `lanes` must not be empty");
    if (props.events?.[ALLOCATION_EVENTS] !== true) throw new Error("Allocation: `events` is Allocation.events(rows, { label, quantity, hold, values })");
    const events = resolveAllocationEvents(props.events, values);
    // The library's tabs, each once.
    const seen = new Set<string>();
    const library = (props.library ?? []).map(tab => {
        if (seen.has(tab.kind)) throw new Error(`Allocation: duplicate library tab ${tab.kind}`);
        seen.add(tab.kind);
        return East.value(variant(tab.kind, null), AllocationLibraryTabType);
    });
    // The app's columns over its bin values, as bytes.
    const keys = new Set<string>();
    const columns = (props.columns ?? []).map(column => {
        if (keys.has(column.key)) throw new Error(`Allocation: duplicate column ${column.key}`);
        keys.add(column.key);
        // An author's accessor may return a subtype (a tone of one case): widened to the column's type here.
        const text = East.function([values], StringType, (_$, v) => East.as(column.text(v as ExprType<V>), StringType));
        const tone = column.tone === undefined ? undefined
            : East.function([values], OptionType(StatusTokenType), (_$, v) => East.as(column.tone!(v as ExprType<V>) as never, OptionType(StatusTokenType)));
        return East.value({
            key: column.key, label: column.label,
            text: East.function([BlobType], StringType, ($, bytes) => {
                const textOf = $.const(text);
                return textOf(bytes.decodeBeast(values, "v2"));
            }),
            tone: tone === undefined ? none : some(East.function([BlobType], OptionType(StatusTokenType), ($, bytes) => {
                const toneOf = $.const(tone);
                return toneOf(bytes.decodeBeast(values, "v2"));
            })),
            table: column.table ?? true,
        }, AllocationColumnType);
    });
    // The app's check, over the check context as bytes.
    let check: ExprType<FunctionType<[BlobType], ArrayType<typeof T.AllocationIssueType>>> | undefined;
    if (props.check !== undefined) {
        const contextType = T.AllocationCheckContextTypeFor(values);
        const author = East.value(props.check as SubtypeExprOrValue<FunctionType>) as ExprType<FunctionType>;
        const authorType = Expr.type(author as unknown as Expr) as EastType;
        if (authorType.type !== "Function" || authorType.inputs.length !== 1 || !isTypeEqual(authorType.inputs[0]!, contextType)
            || !isTypeEqual(authorType.output, ArrayType(T.AllocationIssueType))) {
            throw new Error(`Allocation: \`check\` is an East function from Allocation.Types.CheckContext(${printType(values)}) to Array<Allocation.Types.Issue>`);
        }
        check = East.function([BlobType], ArrayType(T.AllocationIssueType), ($, bytes) => {
            const checkOf = $.const(author as unknown as ExprType<FunctionType<[EastType], ArrayType<typeof T.AllocationIssueType>>>);
            return checkOf(bytes.decodeBeast(contextType, "v2"));
        });
    }
    // The plans, as bytes; and each day's batch, as bytes, through the patch door.
    const commit = Record.onApply(handle as never, { keyed: true }) as unknown as ExprType<AsyncFunctionType<[EastType], typeof Editing.Types.ApplyResult>>;
    const batchType = Editing.Types.ChangeSet(dayType as unknown as StructType<Record<never, never>>, DateTimeType);
    // The window: the same record, paged, its windows as bytes.
    let window: ExprType<typeof AllocationWindowType> | undefined;
    if (props.window !== undefined) {
        const paged = props.window as unknown as ExprType<StructType>;
        if (!isTypeEqual(Expr.type(paged as unknown as Expr) as EastType, DataPagedHandleType(daysType))) {
            throw new Error("Allocation: `window` is Data.bindPaged(plans) — the plans record itself, with no index");
        }
        const handleOf = paged as unknown as ExprType<ReturnType<typeof DataPagedHandleType<DictType<DateTimeType, EastType>>>>;
        window = East.value({
            id: handleOf.id,
            page: East.function([IntegerType, IntegerType], OptionType(BlobType), ($, offset, limit) => {
                const pageOf = $.const(handleOf.page);
                const got = $.let(none, OptionType(BlobType));
                $.match(pageOf(offset, limit), { some: ($2, days) => { $2.assign(got, some(East.Blob.encodeBeast(days, "v2"))); } });
                return got;
            }),
            total: handleOf.total, seek: handleOf.seek, revision: handleOf.revision, refresh: handleOf.refresh,
        }, AllocationWindowType);
    }
    // The narrowing names each source after what it narrows; the board reads each one's keys itself.
    const narrowed: { lanes?: unknown; resources?: unknown } = {};
    if (props.slice !== undefined) {
        if (!isRecordSlices(props.slice.slice)) {
            throw new Error("Allocation: `slice` is Slice.bindRecords(key, { lanes, resources }) — name each source after what it narrows");
        }
        const handle = East.value(props.slice.slice) as unknown as ExprType<StructType>;
        const sources = (Expr.type(handle as unknown as Expr) as StructType).fields["sources"];
        const names = sources?.type === "Struct" ? Object.keys(sources.fields) : [];
        for (const name of names) {
            if (name !== "lanes" && name !== "resources") {
                throw new Error(`Allocation: \`slice\` narrows its lanes and its resources — its source '${name}' is neither; name the sources \`lanes\` and \`resources\``);
            }
            const rows = ((handle as unknown as { sources: Record<string, { data: unknown }> }).sources)[name]!.data;
            const keys = keyVisibility(rows, `Allocation.slice's ${name}`);
            if (keys.source === undefined) throw new Error(`Allocation: \`slice\`'s ${name} is a record Slice with String primary keys`);
            narrowed[name] = keys.source;
        }
    }
    const form = typeof props.inspector === "object" ? props.inspector.bin : undefined;
    return East.value({
        sourceId: handle.binding.name,
        read: East.function([], BlobType, (_$) => East.Blob.encodeBeast(handle.read(), "v2")),
        apply: East.asyncFunction([BlobType], Editing.Types.ApplyResult, ($, bytes) => {
            const commitOf = $.const(commit);
            return commitOf(bytes.decodeBeast(batchType, "v2"));
        }),
        window: window === undefined ? none : some(window),
        valuesType: toEastTypeValue(values),
        lanes: props.lanes, every: props.every ?? variant("hours", 1.0),
        events: events.events, resources: props.resources, initial: events.initial,
        narrowed: { lanes: narrowed.lanes === undefined ? none : some(narrowed.lanes as never), resources: narrowed.resources === undefined ? none : some(narrowed.resources as never) },
        fit: (props.fit as unknown as ExprType<StructType<{ binding: typeof FuncBindingType }>>).binding,
        check: check === undefined ? none : some(check),
        columns, rules: { under: props.rules?.under ?? true },
        quantity: { unit: props.quantity?.unit === undefined ? none : some(props.quantity.unit) },
        library,
        inspector: props.inspector === undefined || props.inspector === false ? none : some({
            bin: form === undefined ? none : some(rowInspector(form, T.AllocationBinTypeFor(values) as unknown as StructType,
                `Allocation: \`inspector.bin\` is an East function of the bin, Allocation.Types.Bin(${printType(values)}), and a writer of the edited bin, returning UIComponentType`)),
        }),
        slice: props.slice === undefined ? none : some(recordSlicesChrome(props.slice)),
        settings: {
            layout: variant(props.view?.layout ?? "timeline", null), date: props.view?.date === undefined ? none : some(props.view.date),
            horizon: { before: props.horizon?.before ?? variant("days", 3.0), after: props.horizon?.after ?? variant("days", 10.0) },
            title: props.title ?? "Allocation", publish: props.publish ?? true, readOnly: props.readOnly ?? false,
        },
        id: props.id === undefined ? none : some(props.id),
    }, AllocationPayloadType);
}

// ============================================================================
// The namespace
// ============================================================================

/** Declares the Events tab. */
function allocationEventsTab(): AllocationLibraryDeclaration { return { kind: "events" }; }
/** Declares the Resources tab. */
function allocationResourcesTab(): AllocationLibraryDeclaration { return { kind: "resources" }; }

/** The tag, its adapters, its pure functions and its types. */
export interface AllocationNamespace {
    /** Renders a board over one plans record. */
    <V extends EastType>(props: AllocationProps<V>): UIElement;
    /** Declares the events the day may book, from the app's keyed rows. */
    events: typeof allocationEvents;
    /** Reads every lane from the app's keyed rows. */
    lanes: typeof allocationLanes;
    /** Reads every resource from the app's keyed rows. */
    resources: typeof allocationResources;
    /** The built-in rules, one verdict per candidate. */
    fit: typeof allocationFit;
    /** Every resource's load on the plan day, over the plans' bin values. */
    loads: typeof allocationLoads;
    /** A fit's candidates, over the plans' bin values. */
    candidates: typeof allocationCandidates;
    /** A fit's answer from a fit per candidate, over the plans' bin values. */
    answer: typeof allocationAnswer;
    /** A greedy look-ahead over a fit, over the plans' bin values. */
    lookahead: typeof allocationLookahead;
    /** The built-in checks, over the plans' bin values. */
    check: typeof allocationCheck;
    /** The day's lane slots, over the plans' bin values. */
    slots: typeof allocationSlots;
    /** Declares the library's tabs. */
    library: { events: typeof allocationEventsTab; resources: typeof allocationResourcesTab };
    /** The Allocation's East types; those holding a bin are constructors of the app's bin values. */
    Types: {
        Lane: typeof T.AllocationLaneType; Status: typeof T.AllocationStatusType;
        Bin: typeof T.AllocationBinTypeFor; Day: typeof T.AllocationDayTypeFor; Days: typeof T.AllocationDaysTypeFor;
        Interval: typeof T.AllocationIntervalType; Job: typeof T.AllocationJobType; Detail: typeof T.AllocationDetailType;
        Event: typeof T.AllocationEventType; Resource: typeof T.AllocationResourceType; Rules: typeof T.AllocationRulesType;
        Context: typeof T.AllocationContextType; LoadState: typeof T.AllocationLoadStateType; Load: typeof T.AllocationLoadType;
        Candidate: typeof T.AllocationCandidateType; Refusal: typeof T.AllocationRefusalType; Fit: typeof T.AllocationFitType;
        FitAsk: typeof T.AllocationFitAskType; FitRequest: typeof T.AllocationFitRequestTypeFor; FitResult: typeof T.AllocationFitResultType;
        Fix: typeof T.AllocationFixType; IssueKind: typeof T.AllocationIssueKindType; Issue: typeof T.AllocationIssueType;
        CheckContext: typeof T.AllocationCheckContextTypeFor; SlotStatus: typeof T.AllocationSlotStatusType; Slot: typeof T.AllocationSlotType;
        Layout: typeof T.AllocationLayoutType;
    };
}

/**
 * Books a day's events into timed lane slots and allocates each bin to a
 * resource, over one plans record, in an internal BuilderFrame.
 *
 * @param props - The plans, lanes, events, resources and fit, and the optional library, inspector and narrowing
 * @returns The Allocation extension
 * @remarks Every gesture is one undo step; Save and Publish each write one whole day. Issues never block either. Below 480px of main the same commands are explicit card actions.
 */
export const Allocation: AllocationNamespace = Object.assign(
    <V extends EastType>(props: AllocationProps<V>): UIElement => AllocationComponent.Root(createAllocationPayload(props)),
    {
        events: allocationEvents, lanes: allocationLanes, resources: allocationResources, fit: allocationFit, loads: allocationLoads,
        candidates: allocationCandidates, answer: allocationAnswer, lookahead: allocationLookahead, check: allocationCheck, slots: allocationSlots,
        library: { events: allocationEventsTab, resources: allocationResourcesTab },
        Types: {
            Lane: T.AllocationLaneType, Status: T.AllocationStatusType, Bin: T.AllocationBinTypeFor, Day: T.AllocationDayTypeFor, Days: T.AllocationDaysTypeFor,
            Interval: T.AllocationIntervalType, Job: T.AllocationJobType, Detail: T.AllocationDetailType, Event: T.AllocationEventType,
            Resource: T.AllocationResourceType, Rules: T.AllocationRulesType, Context: T.AllocationContextType, LoadState: T.AllocationLoadStateType,
            Load: T.AllocationLoadType, Candidate: T.AllocationCandidateType, Refusal: T.AllocationRefusalType, Fit: T.AllocationFitType,
            FitAsk: T.AllocationFitAskType, FitRequest: T.AllocationFitRequestTypeFor, FitResult: T.AllocationFitResultType, Fix: T.AllocationFixType,
            IssueKind: T.AllocationIssueKindType, Issue: T.AllocationIssueType, CheckContext: T.AllocationCheckContextTypeFor,
            SlotStatus: T.AllocationSlotStatusType, Slot: T.AllocationSlotType, Layout: T.AllocationLayoutType,
        },
    },
);
