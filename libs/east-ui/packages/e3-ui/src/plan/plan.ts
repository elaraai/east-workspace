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
 * The Plan is an interface. Its payload holds the canvas whole
 * ({@link PlanRootType}) beside the event kinds and resources as Plan takes
 * them (`PlanEventKindType`, `PlanResourcesType`, #1190), the resources' rows
 * over a window (`blocks`, #1192), the event kinds' drop veto and the
 * settings. The `Plan` renderer in `@elaraai/e3-ui-components` draws it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
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
import { CanDropFnType, EastUI, type UIElement } from "@elaraai/east-ui";
import { PlanEventKindType, PlanResourcesType, ScheduleCandidateType, ScheduleDraftsType } from "../schedule/types.js";
import { scheduleCheck } from "../schedule/index.js";
import type { ScheduleEventKind } from "../schedule/events.js";
import type { ScheduleResourceKind } from "../schedule/resources.js";
import { PlanRootType } from "./ir.js";
import { PlanAxisType, PlanBlocksType, PlanLinkType, PlanRowsCollectionType, PlanRunRefType, type PlanAxisKindLiteral, type PlanRowsValue } from "./types.js";
import { axisKindOf, linkEventKinds } from "./builders.js";
import { buildPlanRoot, type PlanConfig } from "./root.js";
import type { PlanOverRows } from "./over.js";

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

/**
 * The resources' rows over a window, every event kind's drafts in place
 * (#1192): `(from, to, drafts by kind, then by entry id)` → the canvas's
 * blocks, `none` while a read is in flight.
 */
export const PlanEventBlocksType = FunctionType([DateTimeType, DateTimeType, DictType(StringType, ScheduleDraftsType)], OptionType(PlanBlocksType));

/** Type representing {@link PlanEventBlocksType}. */
export type PlanEventBlocksType = typeof PlanEventBlocksType;

/** An event kind's drop veto: where the drop would put the event, to the refusal's message, or `none` to let it land. */
export const PlanEventCanDropType = FunctionType([ScheduleCandidateType], OptionType(StringType));

/** Type representing {@link PlanEventCanDropType}. */
export type PlanEventCanDropType = typeof PlanEventCanDropType;

/**
 * How a Plan's event kinds behave beside its canvas.
 *
 * @property applyMode - When the event kinds' ready drafts go: on Apply (`batch`), or as each gesture lands (`auto`)
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
 * @property plan - The canvas whole: its axis, its rows over `data` followed by `rows`, its links, review, editing session and the rest
 * @property resources - The resource kinds, in the order `resources` lists them, their rows resolved
 * @property events - The event kinds, in the order `events` lists them, each closed behind its seams
 * @property blocks - The resources' rows over a window, every kind's drafts in place; `none` while the Plan has no event kinds
 * @property canDrop - The event kinds' drop veto; `none`, every drop the kinds take lands
 * @property settings - When the event kinds' drafts go, and the date brought into view first
 */
export const PlanPayloadType = StructType({
    plan: PlanRootType,
    resources: ArrayType(PlanResourcesType),
    events: ArrayType(PlanEventKindType),
    blocks: OptionType(PlanEventBlocksType),
    canDrop: OptionType(PlanEventCanDropType),
    settings: PlanSettingsType,
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
    /** The rows' source — a keyed collection, a bind handle over one or a paged source of one, laid out by `series` or `pick` (see {@link PlanConfig}). Leave it out for a Plan of event kinds or `rows` alone. */
    data?: PlanConfig<K>["data"];
    /** The resource kinds, by slot — `Schedule.resources(rows, { … })`: the rows events are placed on, in this order. */
    resources?: Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>;
    /** The event kinds, by slot — `Schedule.events(record, { … })`, each a record of its own: at least one, when given. An event is scheduled in time, so they need a time axis. */
    events?: Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>;
    /** Read-only rows: hand-built rows (`Plan.chart({ … })`) and `Plan.over(data, [series…])`. Pinned rows sit under the ruler; the rest follow the resources and `data`'s rows. */
    rows?: readonly PlanRowsItem<NoInfer<K>>[];
    /** When the event kinds' ready drafts go: on Apply (`"batch"`, the default), or as each gesture lands (`"auto"`). `data`'s session takes `editing.mode`. */
    applyMode?: "batch" | "auto";
    /** The date brought into view first; omitted, the axis's window from its start. */
    date?: SubtypeExprOrValue<DateTimeType>;
    /**
     * The drop veto, by what it vets — its arm from its East type:
     * `Fn(DragEvent) → Boolean` over a card or an element dragged onto
     * `data`'s rows, consulted where the drag rests and again before it
     * becomes a draft; or `Fn(Schedule.Types.Candidate) → Option<String>` over
     * an event kind's drop, its message on the ghost, as the Calendar's.
     */
    canDrop?: PlanConfig<K>["canDrop"] | SubtypeExprOrValue<PlanEventCanDropType>;
}

/** The props, erased — what the implementation reads. */
type PlanAnyProps = PlanProps & Record<string, unknown>;

/** The ways a Plan's event kinds' drafts go. */
const APPLY_MODES: readonly string[] = ["batch", "auto"];

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
 *   resource naming a slot `resources` has not, or one not keyed by String; event kinds on a number or ordinal axis; a
 *   link naming an event kind `events` has not; a `rows` item that is neither a hand-built row nor `Plan.over`'s; a
 *   `canDrop` over neither a drag nor a candidate, or over a candidate with no event kinds; an `applyMode` that is neither
 *   batch nor auto, or with no event kinds; and everything the canvas refuses ({@link createPlanRoot}). An axis held in
 *   a variable, and links whose kinds are not known at build, are refused in the same words as the Plan is evaluated
 * @internal
 */
export function createPlanPayload(props: PlanProps): ExprType<PlanPayloadType> {
    const { resources, events, rows, applyMode, date, canDrop, ...canvas } = props as PlanAnyProps;
    const kinds = events === undefined ? [] : Object.keys(events);
    if (events !== undefined) {
        scheduleCheck(resources ?? {}, events, "Plan");
    } else if (resources !== undefined) {
        throw new Error("Plan: `resources` are the rows events are placed on — declare `events`, the event kinds over records (Schedule.events)");
    }
    if (canvas.data === undefined && events === undefined && rows === undefined) {
        throw new Error("Plan: needs its rows — `data` and its `series`, event kinds (`events` over `resources`), or read-only `rows`");
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
    const plan = buildPlanRoot(
        { ...canvas, axis, links, ...(canvasCanDrop === undefined ? {} : { canDrop: canvasCanDrop }) } as Parameters<typeof buildPlanRoot>[0],
        rows === undefined ? (events !== undefined && canvas.data === undefined ? East.value([], PlanBlocksType) : undefined) : rowsBlocks(rows),
    );
    return East.value({
        plan,
        resources: Object.entries(resources ?? {}).map(([slot, kind]) => kind.buildPlan(slot)),
        events: Object.entries(events ?? {}).map(([slot, kind]) => kind.buildPlan(slot)),
        // The resources' rows over a window are #1192's.
        blocks: none,
        canDrop: eventCanDrop === undefined ? none : some(eventCanDrop),
        settings: {
            applyMode: variant(applyMode ?? "batch", null),
            date: date === undefined ? none : some(date),
        },
    } as never, PlanPayloadType);
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
