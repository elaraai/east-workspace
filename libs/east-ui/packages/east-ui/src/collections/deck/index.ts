/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deck — the declarative grouped card collection (#359).
 *
 * `Deck.Root(data, config)` renders rows as presentation cards: a
 * structured face (`card` accessor — title / sublabel / icon / status /
 * facts) or a fully custom face (`render` accessor returning any UI
 * component), grouped by named GROUP BY toolbar options, filtered by
 * slice chrome, laid out as a wrapping card grid or a single-column list.
 *
 * Shares the Library card grammar (status pills, meter / chips / text
 * fact values) so palettes and decks read as one family; unlike Library,
 * a Deck is a display/interaction surface — cards are tap targets
 * (`onCardClick`), never drag sources.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
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
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import type { RowElement } from "../library/index.js";
import {
    DeckFactType,
    DeckLayoutType,
    DeckStyleType,
    LibraryStatusType,
    LibraryDimValueType,
    LibraryGroupMetaType,
    type DeckLayoutLiteral,
    type DeckStyle,
} from "./types.js";

export {
    DeckFactType,
    DeckLayoutType,
    DeckStyleType,
    type DeckLayoutLiteral,
    type DeckStyle,
} from "./types.js";

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
    status: OptionType(LibraryStatusType),
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
    status: OptionType(LibraryStatusType),
    facts: ArrayType(DeckFactType),
    filtered: BooleanType,
    search: OptionType(StringType),
    groups: DictType(StringType, StringType),
    face: OptionType(UIComponentType),
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
    groupOptions: ArrayType(LibraryGroupMetaType),
    groupSummaries: DictType(StringType, DictType(StringType, StringType)),
    searchable: BooleanType,
    layout: OptionType(DeckLayoutType),
    onCardClick: OptionType(FunctionType([StringType], NullType)),
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
 * @property key - Card identity (reported by `onCardClick`)
 * @property title - Primary identity line
 * @property sublabel - Optional muted second line
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status pill (`Deck.status(...)`)
 * @property facts - Optional labelled facts (`Deck.meter` / `Deck.chips` / `Deck.text`)
 * @property filtered - Render de-emphasised (the `Slice.partition` "keep the excluded" feed)
 */
export interface DeckCardFields {
    /** Card identity (reported by `onCardClick`) */
    key: SubtypeExprOrValue<StringType>;
    /** Primary identity line */
    title: SubtypeExprOrValue<StringType>;
    /** Optional muted second line */
    sublabel?: SubtypeExprOrValue<StringType>;
    /** Optional Font Awesome solid icon name */
    icon?: SubtypeExprOrValue<StringType> | IconName;
    /** Optional status pill (`Deck.status(...)`) */
    status?: ExprType<typeof LibraryStatusType>;
    /** Optional labelled facts */
    facts?: Array<ExprType<typeof DeckFactType>>;
    /** Render de-emphasised (dimmed) */
    filtered?: SubtypeExprOrValue<BooleanType>;
}

/** Build a {@link DeckCardFaceType} value from plain face fields. */
function createCard(fields: DeckCardFields): ExprType<DeckCardFaceType> {
    return East.value({
        key: fields.key,
        title: fields.title,
        sublabel: fields.sublabel !== undefined ? some(fields.sublabel) : none,
        icon: fields.icon !== undefined ? some(fields.icon) : none,
        status: fields.status !== undefined ? some(fields.status) : none,
        facts: fields.facts !== undefined ? East.value(fields.facts, ArrayType(DeckFactType)) : East.value([], ArrayType(DeckFactType)),
        filtered: fields.filtered ?? false,
    }, DeckCardFaceType);
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
 * @property card - Accessor from a row to the structured card face
 * @property render - Optional accessor from a row to a fully custom card
 *   body (any UI component), rendered inside the card frame beneath the
 *   structured face fields
 * @property groupBy - Named GROUP BY toolbar options (empty = no toolbar)
 * @property search - Optional accessor feeding the quick search (the
 *   input renders only when set)
 * @property layout - `"grid"` (default — wrapping card rows) or `"list"`
 * @property onCardClick - Optional tap callback with the card `key`
 * @property slice - Optional bound slice handle (rail chrome renders above)
 * @property affordances - Rail affordances when `slice` is set (default
 *   `["filter", "search"]`)
 * @property style - Layout style (height / maxHeight / minCardWidth)
 */
export interface DeckConfig<R extends StructType> {
    /** Accessor from a row to the structured card face */
    card: (row: ExprType<R>) => DeckCardFields | ExprType<DeckCardFaceType>;
    /** Optional accessor from a row to a fully custom card body */
    render?: (row: ExprType<R>) => ExprType<UIComponentType>;
    /** Named GROUP BY toolbar options (empty = no toolbar) */
    groupBy?: Array<DeckGroupOption<R>>;
    /** Optional accessor feeding the quick search */
    search?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** `"grid"` (default) or `"list"` */
    layout?: DeckLayoutLiteral;
    /** Optional tap callback with the card `key` */
    onCardClick?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional bound slice handle */
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
            facts: face.facts,
            filtered: face.filtered,
            search: config.search !== undefined ? some(config.search(row)) : none,
            groups,
            face: render !== undefined ? some(render(row)) : none,
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

    return East.value(variant("Deck", {
        items,
        groupOptions: East.value(
            groupDefs.map(g => ({ key: g.key, label: g.label })),
            ArrayType(LibraryGroupMetaType)),
        groupSummaries: summariesFn(data_expr),
        searchable: config.search !== undefined,
        layout: config.layout !== undefined ? some(variant(config.layout, null)) : none,
        onCardClick: config.onCardClick !== undefined ? some(config.onCardClick) : none,
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
 * Creates a Deck status-pill value.
 *
 * @param label - Pill text (rendered uppercase)
 * @param tone - Standard status tone literal or expression
 * @returns A {@link LibraryStatusType} expression
 */
function createStatus(
    label: SubtypeExprOrValue<StringType>,
    tone: SubtypeExprOrValue<typeof LibraryStatusType.fields.tone> | StatusTokenLiteral,
): ExprType<typeof LibraryStatusType> {
    const toneValue = typeof tone === "string" ? variant(tone, null) : tone;
    return East.value({ label, tone: toneValue }, LibraryStatusType);
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
    /** Creates a status-pill value for a card face. */
    status: createStatus,
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
        /** A labelled card fact. */
        Fact: DeckFactType,
        /** Status pill (shared with Library). */
        Status: LibraryStatusType,
        /** Fact value kinds (shared with Library dimensions). */
        FactValue: LibraryDimValueType,
        /** Layout mode. */
        Layout: DeckLayoutType,
        /** Container style. */
        Style: DeckStyleType,
    },
} as const;
