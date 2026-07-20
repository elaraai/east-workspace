/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deck — the declarative grouped card collection (#359).
 *
 * `Deck.Root(data, config)` renders rows as presentation cards: a
 * structured face (`card` accessor — title / sublabel / icon / status /
 * tone / facts) or a fully custom face (`render` accessor returning any
 * UI component), grouped by named GROUP BY toolbar options, laid out as
 * a wrapping card grid or a single-column list. Filtering and search
 * flow through the SLICE interface (like Table) — a Deck has no bespoke
 * search of its own.
 *
 * Cards carry two states: the LIST face (the summary above) and an
 * optional VIEW state rendered in an anchored POPOVER CARD. The
 * `onClick` and `onHover` accessors return the popover's BODY content
 * (any UI component); the popover's head is INHERITED from the card
 * face (icon, title, sublabel, status, tone rule). Clicking opens a
 * sticky popover (Esc / outside / × closes); hovering shows a transient
 * peek on hover-capable pointers. `onOpen` / `onClose` report the
 * click-popover transitions; `onCardClick` remains the plain tap
 * callback. Cards are tap targets, never drag sources.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type ValueTypeOf,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    East,
    Expr,
    FloatType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    some,
    none,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { mapRowsBlock } from "../../shared/reify.js";
import { type IconName } from "../../display/icon/types.js";
import { type StatusTokenLiteral } from "../../style/interaction.js";
import { ValueFormatType } from "../../contracts/format.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import type { RowElement } from "../library/index.js";
import {
    DeckFactType,
    DeckFillType,
    DeckLayoutType,
    DeckMetricType,
    DeckNoteType,
    DeckReadoutType,
    DeckRowsType,
    DeckStatusColorType,
    DeckStatusType,
    DeckStatusesType,
    DeckStyleType,
    LibraryDimValueType,
    LibraryGroupMetaType,
    type DeckLayoutLiteral,
    type DeckStyle,
} from "./types.js";

export {
    DeckFactType,
    DeckFillType,
    DeckLayoutType,
    DeckMetricType,
    DeckNoteType,
    DeckReadoutType,
    DeckRowsType,
    DeckStatusColorType,
    DeckStatusType,
    DeckStatusesType,
    DeckStyleType,
    type DeckLayoutLiteral,
    type DeckStyle,
} from "./types.js";

/** The standard status tone literals (the `token` colour arm). */
const STATUS_TOKENS: readonly StatusTokenLiteral[] = ["success", "warning", "danger", "info", "neutral"];

// ============================================================================
// Card face
// ============================================================================

/**
 * The structured face produced by the `card` accessor — the per-row
 * fields before the factory merges in groups / search / custom face.
 */
export const DeckCardFaceType = StructType({
    key: StringType,
    title: StringType,
    sublabel: OptionType(StringType),
    icon: OptionType(StringType),
    status: OptionType(StringType),
    metrics: ArrayType(DeckMetricType),
    fill: OptionType(DeckFillType),
    facts: ArrayType(DeckFactType),
    filtered: BooleanType,
});

/**
 * Type representing the structured Deck card face.
 */
export type DeckCardFaceType = typeof DeckCardFaceType;

/**
 * A resolved Deck item — the face merged with groups / search / custom
 * face at factory time (the renderer never sees the host row type).
 *
 * @remarks
 * Mirrors the inline `Deck` variant's `items` element in `component.ts`
 * (the Card convention for containers whose payload references the
 * recursive `UIComponentType`).
 */
export const DeckItemType = StructType({
    key: StringType,
    title: StringType,
    sublabel: OptionType(StringType),
    icon: OptionType(StringType),
    status: OptionType(StringType),
    metrics: ArrayType(DeckMetricType),
    fill: OptionType(DeckFillType),
    facts: ArrayType(DeckFactType),
    filtered: BooleanType,
    groups: DictType(StringType, StringType),
    face: OptionType(UIComponentType),
    detail: OptionType(UIComponentType),
    hover: OptionType(UIComponentType),
});

/**
 * Type representing a resolved Deck item.
 */
export type DeckItemType = typeof DeckItemType;

/**
 * The full Deck payload — mirrors the inline `Deck` variant in
 * `component.ts`; use for `ValueTypeOf<typeof Deck.Types.Deck>` in
 * renderers and assertions.
 */
export const DeckRootType = StructType({
    items: ArrayType(DeckItemType),
    statuses: DeckStatusesType,
    groupOptions: ArrayType(LibraryGroupMetaType),
    groupSummaries: DictType(StringType, DictType(StringType, StringType)),
    footer: ArrayType(StructType({ label: StringType, value: StringType })),
    legend: BooleanType,
    layout: OptionType(DeckLayoutType),
    onCardClick: OptionType(FunctionType([StringType], NullType)),
    onOpen: OptionType(AsyncFunctionType([StringType], NullType)),
    onClose: OptionType(AsyncFunctionType([], NullType)),
    slice: OptionType(SliceChromeType),
    style: OptionType(DeckStyleType),
});

/**
 * Type representing the full Deck payload.
 */
export type DeckRootType = typeof DeckRootType;

/**
 * The structured card-face fields accepted by the `card` accessor.
 *
 * @property key - Card identity (reported by `onCardClick` / `onOpen`)
 * @property title - Primary identity line
 * @property sublabel - Optional muted mono-uppercase second line
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status KEY into the deck's `statuses`
 *   registry — drives the solid status tag (+ dot / pulse), the faint
 *   face wash and the fill-bar colour
 * @property metrics - Optional metric strip (`Deck.metric(...)`)
 * @property fill - Optional status-coloured fill bar
 * @property facts - Optional labelled facts (`Deck.meter` / `Deck.chips` / `Deck.text`)
 * @property filtered - Render de-emphasised (the `Slice.partition` "keep the excluded" feed)
 */
export interface DeckCardFields {
    /** Card identity (reported by `onCardClick` / `onOpen`) */
    key: SubtypeExprOrValue<StringType>;
    /** Primary identity line */
    title: SubtypeExprOrValue<StringType>;
    /** Optional muted mono-uppercase second line */
    sublabel?: SubtypeExprOrValue<StringType>;
    /** Optional Font Awesome solid icon name */
    icon?: SubtypeExprOrValue<StringType> | IconName;
    /** Optional status key into the deck's `statuses` registry */
    status?: SubtypeExprOrValue<StringType>;
    /** Optional metric strip (`Deck.metric(...)`) */
    metrics?: Array<ExprType<DeckMetricType>>;
    /** Optional status-coloured fill bar */
    fill?: DeckFillFields;
    /** Optional labelled facts */
    facts?: Array<ExprType<typeof DeckFactType>>;
    /** Render de-emphasised (dimmed) */
    filtered?: SubtypeExprOrValue<BooleanType>;
}

/**
 * The card fill-bar fields.
 *
 * @property value - Current value
 * @property max - Full-bar value
 * @property format - Reading format: a shared {@link ValueFormatType}
 *   spec over `value`, or an accessor over `(value, max)`; omitted, the
 *   renderer shows the percentage
 */
export interface DeckFillFields {
    /** Current value */
    value: SubtypeExprOrValue<FloatType>;
    /** Full-bar value */
    max: SubtypeExprOrValue<FloatType>;
    /** Reading format (spec over `value`, or accessor over `(value, max)`) */
    format?: ExprType<ValueFormatType>
        | ((value: ExprType<FloatType>, max: ExprType<FloatType>) => SubtypeExprOrValue<StringType>);
}

/** Build a {@link DeckFillType} value from plain fill fields. */
function createFill(fill: DeckFillFields): ExprType<DeckFillType> {
    const value = East.value(fill.value) as ExprType<FloatType>;
    const max = East.value(fill.max) as ExprType<FloatType>;
    const accessor = typeof fill.format === "function" ? fill.format : undefined;
    const spec = typeof fill.format === "function" ? undefined : fill.format;
    return East.value({
        value,
        max,
        format: spec !== undefined ? some(spec) : none,
        text: accessor !== undefined ? some(accessor(value, max)) : none,
    }, DeckFillType);
}

/** Build a {@link DeckCardFaceType} value from plain face fields. */
function createCard(fields: DeckCardFields): ExprType<DeckCardFaceType> {
    return East.value({
        key: fields.key,
        title: fields.title,
        sublabel: fields.sublabel !== undefined ? some(fields.sublabel) : none,
        icon: fields.icon !== undefined ? some(fields.icon) : none,
        status: fields.status !== undefined ? some(fields.status) : none,
        metrics: fields.metrics !== undefined ? East.value(fields.metrics, ArrayType(DeckMetricType)) : East.value([], ArrayType(DeckMetricType)),
        fill: fields.fill !== undefined ? some(createFill(fields.fill)) : none,
        facts: fields.facts !== undefined ? East.value(fields.facts, ArrayType(DeckFactType)) : East.value([], ArrayType(DeckFactType)),
        filtered: fields.filtered ?? false,
    }, DeckCardFaceType);
}

// ============================================================================
// Status registry + metric + popover-block builders (sub-factories)
// ============================================================================

/**
 * One entry of the `Deck.statuses` config.
 *
 * @property label - The tag / legend label
 * @property color - A standard status tone literal, or any custom CSS
 *   colour (the faint face tint is derived from it)
 * @property pulse - Pulse the tag dot (active states)
 * @property hint - Optional legend / group-head description
 */
export interface DeckStatusOption {
    /** The tag / legend label */
    label: string;
    /** Standard status tone literal, or a custom CSS colour */
    color: StatusTokenLiteral | (string & {});
    /** Pulse the tag dot (active states) */
    pulse?: boolean;
    /** Optional legend / group-head description */
    hint?: string;
}

/**
 * Builds the deck's status registry — the single definition per state
 * that drives the card's solid status tag (+ dot / pulse), the faint
 * face wash, the fill-bar colour, group-head swatches, the legend and
 * the popover head wash. Card faces reference entries by key via their
 * `status` field.
 *
 * @param statuses - Status key → definition
 * @returns The registry value for the `statuses` config option
 */
function createStatuses(
    statuses: Record<string, DeckStatusOption>,
): ValueTypeOf<DeckStatusesType> {
    return new Map(Object.entries(statuses).map(([key, s]) => [key, {
        label: s.label,
        color: (STATUS_TOKENS as readonly string[]).includes(s.color)
            ? variant("token", variant(s.color, null))
            : variant("custom", s.color),
        pulse: s.pulse ?? false,
        hint: s.hint !== undefined ? some(s.hint) : none,
    }])) as ValueTypeOf<DeckStatusesType>;
}

/** Format option: a shared {@link ValueFormatType} spec, or a text
 *  accessor over the raw value (reified at authoring time). */
type DeckFormatOption =
    | ExprType<ValueFormatType>
    | ((value: ExprType<FloatType>) => SubtypeExprOrValue<StringType>);

/** Normalize a metric/readout value to an Option expression + derived
 *  text for accessor formatters (`none` values render "—"). */
function normalizeScalar(
    value: SubtypeExprOrValue<FloatType> | Expr,
    format: DeckFormatOption | undefined,
): { value: Expr; format: unknown; text: unknown } {
    const v = East.value(value as never) as Expr;
    const t = Expr.type(v) as { type: string; cases?: Record<string, unknown> };
    const isOption = t.type === "Variant" && t.cases !== undefined
        && Object.keys(t.cases).length === 2 && "some" in t.cases && "none" in t.cases;
    const option = isOption
        ? v
        : East.value(some(v), OptionType(FloatType)) as unknown as Expr;
    const accessor = typeof format === "function" ? format : undefined;
    const spec = typeof format === "function" ? undefined : format;
    let text: unknown = none;
    if (accessor !== undefined) {
        text = (option as unknown as { match: (h: unknown) => Expr }).match({
            some: (_$: unknown, x: Expr) => East.value(some(accessor(x as ExprType<FloatType>)), OptionType(StringType)),
            none: () => East.value(none, OptionType(StringType)),
        });
    }
    return { value: option, format: spec !== undefined ? some(spec) : none, text };
}

/**
 * Builds one card metric — a label-over-value pair in the mono tabular
 * voice. The value stays RAW in the payload; display formatting uses
 * the shared {@link ValueFormatType} vocabulary (`Chart.format.*`) or a
 * text accessor. Option-valued metrics render "—" when `none`.
 *
 * @param label - Metric caption (mono uppercase)
 * @param value - The raw value (Float, or an Option of Float)
 * @param options - `format` (spec or accessor) + `warn` flag
 * @returns A {@link DeckMetricType} expression
 */
function createMetric(
    label: SubtypeExprOrValue<StringType>,
    value: SubtypeExprOrValue<FloatType> | Expr,
    options?: {
        /** Display format: a `Chart.format.*` spec or a text accessor */
        format?: DeckFormatOption;
        /** Render the value in the danger tone */
        warn?: SubtypeExprOrValue<BooleanType>;
    },
): ExprType<DeckMetricType> {
    const scalar = normalizeScalar(value, options?.format);
    return East.value({
        label,
        value: scalar.value,
        format: scalar.format,
        text: scalar.text,
        warn: options?.warn ?? false,
    } as never, DeckMetricType);
}

/**
 * One cell of a `Deck.Readout` rail.
 *
 * @property label - Cell caption (mono uppercase)
 * @property value - The raw value (Float, or an Option of Float)
 * @property format - Display format (spec or accessor)
 * @property unit - Optional small muted unit suffix
 * @property warn - Render the value in the danger tone
 */
export interface DeckReadoutCell {
    /** Cell caption (mono uppercase) */
    label: SubtypeExprOrValue<StringType>;
    /** The raw value (Float, or an Option of Float) */
    value: SubtypeExprOrValue<FloatType> | Expr;
    /** Display format (spec or accessor) */
    format?: DeckFormatOption;
    /** Optional small muted unit suffix */
    unit?: SubtypeExprOrValue<StringType>;
    /** Render the value in the danger tone */
    warn?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a readout rail — a bordered grid of big mono values with
 * units, the popover body's headline numbers.
 *
 * @param cells - The readout cells ({@link DeckReadoutCell})
 * @returns An East expression of `UIComponentType`
 */
function createReadout(cells: DeckReadoutCell[]): ExprType<UIComponentType> {
    return East.value(variant("DeckReadout", {
        cells: East.value(cells.map(cell => {
            const scalar = normalizeScalar(cell.value, cell.format);
            return East.value({
                label: cell.label,
                value: scalar.value,
                format: scalar.format,
                text: scalar.text,
                unit: cell.unit !== undefined ? some(cell.unit) : none,
                warn: cell.warn ?? false,
            } as never, DeckReadoutType.fields.cells.value);
        }), DeckReadoutType.fields.cells),
    }), UIComponentType);
}

/**
 * Creates key–value detail rows — the popover body's labelled facts
 * (mono uppercase key column, body-voice values).
 *
 * @param rows - The rows (`label` + `value`)
 * @returns An East expression of `UIComponentType`
 */
function createRows(
    rows: Array<{ label: SubtypeExprOrValue<StringType>; value: SubtypeExprOrValue<StringType> }>,
): ExprType<UIComponentType> {
    return East.value(variant("DeckRows", {
        rows: East.value(rows.map(row => East.value({
            label: row.label,
            value: row.value,
        }, DeckRowsType.fields.rows.value)), DeckRowsType.fields.rows),
    }), UIComponentType);
}

/**
 * Creates a dashed-top mono footnote — the popover body's trailing note.
 *
 * @param text - The note text
 * @returns An East expression of `UIComponentType`
 */
function createNote(text: SubtypeExprOrValue<StringType>): ExprType<UIComponentType> {
    return East.value(variant("DeckNote", { text }), UIComponentType);
}

// ============================================================================
// Config
// ============================================================================

/**
 * A named GROUP BY toolbar option.
 *
 * @property key - Option identity (persisted as the active grouping)
 * @property label - Toolbar label
 * @property value - Accessor from a row to its group value
 * @property summary - Optional accessor from a group's rows to the
 *   right-aligned group-head summary text
 */
export interface DeckGroupOption<R extends StructType> {
    /** Option identity (persisted as the active grouping) */
    key: string;
    /** Toolbar label */
    label: string;
    /** Accessor from a row to its group value */
    value: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Optional accessor from a group's rows to the group-head summary */
    summary?: (rows: ExprType<ArrayType<R>>) => SubtypeExprOrValue<StringType>;
}

/**
 * Configuration for {@link Deck.Root}.
 *
 * @property card - Accessor from a row to the structured card face (the
 *   LIST state — the summary)
 * @property render - Optional accessor from a row to a fully custom card
 *   body (any UI component), rendered inside the card frame beneath the
 *   structured face fields
 * @property onClick - Optional accessor from a row to the click
 *   popover's BODY (any UI component); the popover head is inherited
 *   from the card face. Opens sticky on tap (Esc / outside / × closes)
 * @property onHover - Optional accessor from a row to the hover peek's
 *   BODY (same inherited-head popover) — hover-capable pointers only
 * @property groupBy - Named GROUP BY toolbar options (empty = no toolbar)
 * @property layout - `"grid"` (default — wrapping card rows) or `"list"`
 * @property onCardClick - Optional tap callback with the card `key`
 * @property onOpen - Optional callback when the click popover opens (card `key`)
 * @property onClose - Optional callback when it closes
 * @property slice - Optional bound slice handle (rail chrome renders
 *   above) — filtering and search flow through the slice, like Table
 * @property affordances - Rail affordances when `slice` is set (default
 *   `["filter", "search"]`)
 * @property style - Layout style (height / maxHeight / minCardWidth)
 */
export interface DeckConfig<R extends StructType> {
    /** Accessor from a row to the structured card face (the LIST state) */
    card: (row: ExprType<R>) => DeckCardFields | ExprType<DeckCardFaceType>;
    /** Status registry (`Deck.statuses(...)`) — card `status` keys resolve here */
    statuses?: ValueTypeOf<DeckStatusesType>;
    /** Optional accessor from a row to a fully custom card body */
    render?: (row: ExprType<R>) => ExprType<UIComponentType>;
    /** Optional accessor from a row to the click popover's body */
    onClick?: (row: ExprType<R>) => ExprType<UIComponentType>;
    /** Optional accessor from a row to the hover peek's body */
    onHover?: (row: ExprType<R>) => ExprType<UIComponentType>;
    /** Optional board-foot key/value stats */
    footer?: Array<{ label: string; value: SubtypeExprOrValue<StringType> }>;
    /** Render the status legend beneath the board (from the registry) */
    legend?: boolean;
    /** Named GROUP BY toolbar options (empty = no toolbar) */
    groupBy?: Array<DeckGroupOption<R>>;
    /** `"grid"` (default) or `"list"` */
    layout?: DeckLayoutLiteral;
    /** Optional tap callback with the card `key` */
    onCardClick?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional view-opened callback with the card `key` */
    onOpen?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[StringType], NullType>>;
    /** Optional view-closed callback */
    onClose?: SubtypeExprOrValue<FunctionType<[], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[], NullType>>;
    /** Optional bound slice handle (filter/search flow through it) */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set (default `["filter", "search"]`) */
    affordances?: SliceAffordanceLiteral[];
    /** Layout style (height / maxHeight / minCardWidth) */
    style?: DeckStyle;
}

/** Affordances a Deck rail cannot mount — no continuous axis (`brush`),
 *  no series (`legend`); slice breakdown would fight the GROUP BY toolbar. */
const REJECTED_AFFORDANCES: readonly SliceAffordanceLiteral[] = ["brush", "legend", "breakdown"];

// ============================================================================
// Factory
// ============================================================================

function buildRoot(
    data: SubtypeExprOrValue<ArrayType<StructType>>,
    config: DeckConfig<StructType>,
): ExprType<UIComponentType> {
    const data_expr = East.value(data) as ExprType<ArrayType<StructType>>;
    const groupDefs = config.groupBy ?? [];
    const render = config.render;
    const view = config.onClick;
    const hover = config.onHover;

    const items = mapRowsBlock(data_expr, DeckItemType, ($, row) => {
        const groups = $.let(new Map(), DictType(StringType, StringType));
        for (const group of groupDefs) {
            $(groups.insert(group.key, East.value(group.value(row), StringType)));
        }
        const raw = config.card(row);
        const face = $.let(raw instanceof Expr ? raw : createCard(raw), DeckCardFaceType);
        return East.value({
            key: face.key,
            title: face.title,
            sublabel: face.sublabel,
            icon: face.icon,
            status: face.status,
            metrics: face.metrics,
            fill: face.fill,
            facts: face.facts,
            filtered: face.filtered,
            groups,
            face: render !== undefined ? some(render(row)) : none,
            detail: view !== undefined ? some(view(row)) : none,
            hover: hover !== undefined ? some(hover(row)) : none,
        }, DeckItemType);
    });

    // Group-head summaries, hoisted off the items — one O(n) bucketing pass
    // per group option (the Library convention).
    const summariesType = DictType(StringType, DictType(StringType, StringType));
    const summariesFn = East.function([Expr.type(data_expr)], summariesType, ($, rows) => {
        const out = $.let(new Map(), summariesType);
        for (const group of groupDefs) {
            if (group.summary !== undefined) {
                const summary = group.summary;
                $(out.insert(group.key,
                    rows.groupToArrays((_$, r) => East.value(group.value(r), StringType))
                        .map((_$, members) => East.value(summary(members), StringType))));
            }
        }
        return out;
    });

    const affordances = config.affordances ?? ["filter", "search"];
    for (const affordance of affordances) {
        if (REJECTED_AFFORDANCES.includes(affordance)) {
            throw new Error(`Deck does not support the '${affordance}' affordance — it has no continuous axis or series, and slice breakdown would fight the GROUP BY toolbar.`);
        }
    }
    const sliceChromeValue = config.slice !== undefined
        ? East.value({
            slice: config.slice,
            affordances: East.value(
                affordances.map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    const styleValue = config.style !== undefined
        ? East.value({
            height: config.style.height !== undefined ? some(config.style.height) : none,
            maxHeight: config.style.maxHeight !== undefined ? some(config.style.maxHeight) : none,
            minCardWidth: config.style.minCardWidth !== undefined ? some(config.style.minCardWidth) : none,
        }, DeckStyleType)
        : undefined;

    // Sync onOpen/onClose widen into the async slots at runtime
    // (FunctionType <: AsyncFunctionType) — the casts only quiet TS.
    return East.value(variant("Deck", {
        items,
        statuses: East.value(config.statuses ?? new Map(), DeckStatusesType),
        groupOptions: East.value(
            groupDefs.map(g => ({ key: g.key, label: g.label })),
            ArrayType(LibraryGroupMetaType)),
        groupSummaries: summariesFn(data_expr),
        footer: East.value(
            (config.footer ?? []).map(f => ({ label: f.label, value: East.value(f.value) })),
            DeckRootType.fields.footer),
        legend: config.legend ?? false,
        layout: config.layout !== undefined ? some(variant(config.layout, null)) : none,
        onCardClick: config.onCardClick !== undefined ? some(config.onCardClick) : none,
        onOpen: config.onOpen !== undefined ? some(config.onOpen as never) : none,
        onClose: config.onClose !== undefined ? some(config.onClose as never) : none,
        slice: sliceChromeValue !== undefined ? some(sliceChromeValue) : none,
        style: styleValue !== undefined ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Creates a Deck — a declarative grouped card collection.
 *
 * @typeParam T - The array-of-structs data expression type
 * @param data - The rows (one card per element)
 * @param config - The Deck configuration ({@link DeckConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Deck, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Deck.Root(
 *         [{ id: "a-201", name: "Line A", state: "RUNNING", load: 0.62 }],
 *         {
 *             card: r => ({
 *                 key: r.id, title: r.name,
 *                 status: Deck.status(r.state, "success"),
 *                 facts: [Deck.meter("Load", r.load.multiply(100.0), 100.0, East.str`${East.print(r.load.multiply(100.0))}%`)],
 *             }),
 *             groupBy: [{ key: "state", label: "Status", value: r => r.state }],
 *         },
 *     ),
 * );
 * ```
 */
function createDeck<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: DeckConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    return buildRoot(data, config as unknown as DeckConfig<StructType>);
}

/**
 * Creates a meter fact (utilisation bar + right-aligned text).
 *
 * @param label - Fact caption
 * @param value - Current value
 * @param max - Full-bar value
 * @param text - Right-aligned reading
 * @returns A {@link DeckFactType} expression
 */
function createMeterFact(
    label: SubtypeExprOrValue<StringType>,
    value: SubtypeExprOrValue<FloatType>,
    max: SubtypeExprOrValue<FloatType>,
    text: SubtypeExprOrValue<StringType>,
): ExprType<DeckFactType> {
    return East.value({
        label,
        value: variant("meter", { value, max, text: some(text) }),
    }, DeckFactType);
}

/**
 * Creates a chips fact (a row of small chips).
 *
 * @param label - Fact caption
 * @param values - Chip texts
 * @returns A {@link DeckFactType} expression
 */
function createChipsFact(
    label: SubtypeExprOrValue<StringType>,
    values: SubtypeExprOrValue<ArrayType<StringType>>,
): ExprType<DeckFactType> {
    return East.value({
        label,
        value: variant("chips", values),
    }, DeckFactType);
}

/**
 * Creates a text fact (a muted caption line).
 *
 * @param label - Fact caption
 * @param text - The caption text
 * @returns A {@link DeckFactType} expression
 */
function createTextFact(
    label: SubtypeExprOrValue<StringType>,
    text: SubtypeExprOrValue<StringType>,
): ExprType<DeckFactType> {
    return East.value({
        label,
        value: variant("text", text),
    }, DeckFactType);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Deck component namespace.
 *
 * @remarks
 * `Deck.Root(data, config)` builds the card collection; the `card` mapper
 * returns plain face fields per row; `Deck.status` / `Deck.meter` /
 * `Deck.chips` / `Deck.text` build the face values. Group-by options are
 * plain config literals, like Library's.
 */
export const Deck = {
    /**
     * Creates a Deck — a declarative grouped card collection.
     *
     * @param data - The rows (one card per element)
     * @param config - The Deck configuration ({@link DeckConfig})
     * @returns An East expression of `UIComponentType`
     */
    Root: createDeck,
    /** Builds the status registry for the `statuses` config option. */
    statuses: createStatuses,
    /** Builds one card metric (label-over-value, raw value + shared format). */
    metric: createMetric,
    /** Creates a readout rail (popover headline numbers). */
    Readout: createReadout,
    /** Creates key–value detail rows (popover labelled facts). */
    Rows: createRows,
    /** Creates a dashed-top mono footnote (popover trailing note). */
    Note: createNote,
    /** Creates a meter fact (utilisation bar + right-aligned text). */
    meter: createMeterFact,
    /** Creates a chips fact (a row of small chips). */
    chips: createChipsFact,
    /** Creates a text fact (a muted caption line). */
    text: createTextFact,
    Types: {
        /** The full Deck payload (mirrors the inline `component.ts` variant). */
        Deck: DeckRootType,
        /** A resolved Deck item. */
        Item: DeckItemType,
        /** The structured card face (`card` accessor target). */
        Face: DeckCardFaceType,
        /** The status registry (key → definition). */
        Statuses: DeckStatusesType,
        /** One status registry entry. */
        Status: DeckStatusType,
        /** A status colour (token or custom). */
        StatusColor: DeckStatusColorType,
        /** A card metric. */
        Metric: DeckMetricType,
        /** The card fill bar. */
        Fill: DeckFillType,
        /** The readout rail component payload. */
        Readout: DeckReadoutType,
        /** The detail-rows component payload. */
        Rows: DeckRowsType,
        /** The note component payload. */
        Note: DeckNoteType,
        /** A labelled card fact. */
        Fact: DeckFactType,
        /** Fact value kinds (shared with Library dimensions). */
        FactValue: LibraryDimValueType,
        /** Layout mode. */
        Layout: DeckLayoutType,
        /** Container style. */
        Style: DeckStyleType,
    },
} as const;
