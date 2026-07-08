/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Library` — a draggable palette of things that get assigned onto grid
 * surfaces (Roster, Blend): people, assets, vehicles, rooms. Each card
 * carries a primary identity plus configurable secondary dimensions that are
 * filterable, groupable, and visible on the card. The Library declares the
 * drag & drop **source** role under its `id`; targets connect by listing
 * that id in their `sources`.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    type FunctionType,
    type NullType,
    type OptionType,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { mapRowsBlock } from "../../shared/reify.js";
import { type IconName } from "../../display/icon/types.js";
import { StatusTokenType, type StatusTokenLiteral } from "../../style/interaction.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import {
    LibraryRootType,
    LibraryItemType,
    LibraryCardFaceType,
    LibraryStatusType,
    LibraryDimValueType,
    LibraryGroupMetaType,
    LibraryDimMetaType,
    LibraryStyleType,
    type LibraryStyle,
} from "./types.js";

// Re-export types
export {
    LibraryRootType,
    LibraryItemType,
    LibraryCardFaceType,
    LibraryStatusType,
    LibraryDimValueType,
    LibraryGroupMetaType,
    LibraryDimMetaType,
    LibraryStyleType,
    type LibraryStyle,
} from "./types.js";

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Card face
// ============================================================================

/**
 * Input to {@link createCard}.
 *
 * @property key - Item identity; carried by `LibraryRef` when dragged
 * @property label - Primary identity line
 * @property sublabel - Optional muted second line (role / class)
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status pill (`some(Library.status(...))` or a conditional option expression)
 * @property draggable - Whether the card can start a drag (default `true`)
 * @property filtered - Whether the card renders de-emphasised (default `false`) — map `Slice.partition`'s `matched.not()` here to keep filtered-out cards as dimmed context
 */
export interface LibraryCardFields {
    /** Item identity; carried by `LibraryRef` when dragged */
    key: SubtypeExprOrValue<StringType>;
    /** Primary identity line */
    label: SubtypeExprOrValue<StringType>;
    /** Optional muted second line (role / class) */
    sublabel?: SubtypeExprOrValue<StringType>;
    /** Optional Font Awesome solid icon name (the icon set is `fas`-only per the spec) */
    icon?: IconName | ExprType<StringType>;
    /** Optional status pill (`some(Library.status(...))` or a conditional option expression) */
    status?: SubtypeExprOrValue<OptionType<LibraryStatusType>>;
    /** Whether the card can start a drag (default `true`) */
    draggable?: SubtypeExprOrValue<BooleanType>;
    /** Whether the card renders de-emphasised — dimmed, drag disabled (default `false`) */
    filtered?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a card face — the per-item identity the `item` accessor returns.
 *
 * @param input - Card face fields
 * @returns An East expression of the card face
 *
 * @example
 * ```ts
 * import { East, some, none } from "@elaraai/east";
 * import { Library } from "@elaraai/east-ui";
 *
 * // Inside an `item` accessor:
 * //   p => ({
 * //       key: p.id,
 * //       label: p.name,
 * //       sublabel: p.role,
 * //       icon: "user",
 * //       status: p.atCap.ifElse(() => some(Library.status("At cap", "neutral")), () => none),
 * //       draggable: p.atCap.not(),
 * //   })
 * ```
 */
function createCard(input: LibraryCardFields): ExprType<LibraryCardFaceType> {
    return East.value({
        key: input.key,
        label: input.label,
        sublabel: input.sublabel !== undefined ? some(input.sublabel) : none,
        icon: input.icon !== undefined ? some(input.icon) : none,
        status: input.status !== undefined ? input.status : none,
        draggable: input.draggable !== undefined ? input.draggable : true,
        filtered: input.filtered !== undefined ? input.filtered : false,
    }, LibraryCardFaceType);
}

/**
 * Creates a status pill value for a card face.
 *
 * @param label - Pill text (rendered uppercase)
 * @param tone - Standard status tone
 * @returns An East expression of the status pill
 *
 * @example
 * ```ts
 * import { Library } from "@elaraai/east-ui";
 *
 * // status: some(Library.status("On roster", "info"))
 * ```
 */
function createStatus(
    label: SubtypeExprOrValue<StringType>,
    tone: SubtypeExprOrValue<StatusTokenType> | StatusTokenLiteral,
): ExprType<LibraryStatusType> {
    return East.value({
        label,
        tone: typeof tone === "string" ? variant(tone, null) : tone,
    }, LibraryStatusType);
}

// ============================================================================
// Secondary dimension definitions
// ============================================================================

/**
 * A meter dimension — utilisation bar with optional right-aligned text.
 *
 * @typeParam R - The struct type of each data row
 * @property kind - Discriminant
 * @property key - Dimension identity
 * @property label - Toggle label in the SECONDARY toolbar
 * @property value - Current-value accessor over the row
 * @property max - Full-scale value (static or accessor)
 * @property format - Optional text formatter over the value expression
 */
export interface LibraryMeterDimDef<R extends StructType> {
    kind: "meter";
    /** Dimension identity */
    key: string;
    /** Toggle label in the SECONDARY toolbar */
    label: string;
    /** Current-value accessor over the row */
    value: (row: ExprType<R>) => SubtypeExprOrValue<FloatType>;
    /** Full-scale value (static or accessor) */
    max: SubtypeExprOrValue<FloatType> | ((row: ExprType<R>) => SubtypeExprOrValue<FloatType>);
    /** Optional text formatter over the value expression */
    format?: (value: ExprType<FloatType>) => SubtypeExprOrValue<StringType>;
}

/**
 * A chips dimension — a row of small chips (skills, certifications).
 *
 * @typeParam R - The struct type of each data row
 * @property kind - Discriminant
 * @property key - Dimension identity
 * @property label - Toggle label in the SECONDARY toolbar
 * @property values - Chip-text accessor over the row
 */
export interface LibraryChipsDimDef<R extends StructType> {
    kind: "chips";
    /** Dimension identity */
    key: string;
    /** Toggle label in the SECONDARY toolbar */
    label: string;
    /** Chip-text accessor over the row */
    values: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<StringType>>;
}

/**
 * A text dimension — a muted caption line (location, depot).
 *
 * @typeParam R - The struct type of each data row
 * @property kind - Discriminant
 * @property key - Dimension identity
 * @property label - Toggle label in the SECONDARY toolbar
 * @property value - Caption-text accessor over the row
 */
export interface LibraryTextDimDef<R extends StructType> {
    kind: "text";
    /** Dimension identity */
    key: string;
    /** Toggle label in the SECONDARY toolbar */
    label: string;
    /** Caption-text accessor over the row */
    value: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
}

/**
 * A secondary dimension definition — one of the three render kinds.
 */
export type LibraryDimensionDef<R extends StructType> =
    | LibraryMeterDimDef<R>
    | LibraryChipsDimDef<R>
    | LibraryTextDimDef<R>;

/**
 * A group-by option: toolbar segment + per-row group value + optional
 * group-head summary computed over the group's members.
 *
 * @typeParam R - The struct type of each data row
 * @property key - Option identity
 * @property label - Segment label in the GROUP BY toolbar
 * @property value - Group-value accessor over the row
 * @property summary - Optional summary accessor over the group's members
 */
export interface LibraryGroupDef<R extends StructType> {
    /** Option identity */
    key: string;
    /** Segment label in the GROUP BY toolbar */
    label: string;
    /** Group-value accessor over the row */
    value: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Optional summary accessor over the group's members */
    summary?: (members: ExprType<ArrayType<R>>) => SubtypeExprOrValue<StringType>;
}

function dimValue<R extends StructType>(
    dim: LibraryDimensionDef<R>,
    row: ExprType<R>,
): ExprType<LibraryDimValueType> {
    switch (dim.kind) {
        case "meter": {
            const value = East.value(dim.value(row), FloatType);
            return East.value(variant("meter", {
                value,
                max: typeof dim.max === "function" ? dim.max(row) : dim.max,
                text: dim.format !== undefined ? some(dim.format(value)) : none,
            }), LibraryDimValueType);
        }
        case "chips":
            return East.value(variant("chips", dim.values(row)), LibraryDimValueType);
        case "text":
            return East.value(variant("text", dim.value(row)), LibraryDimValueType);
    }
}

// ============================================================================
// Root factory
// ============================================================================

/**
 * Configuration for {@link createLibrary}.
 *
 * @typeParam R - The struct type of each data row
 * @property id - DnD source identity — targets list it in their `sources`
 * @property item - Item row mapper — returns card-face fields (or a resolved face expression)
 * @property hint - Optional header-right caption (defaults to the drag hint)
 * @property dimensions - Secondary dimensions (toolbar-toggleable card facts)
 * @property defaultDimensions - Initially-visible dimension keys (default: the first two)
 * @property groupBy - GROUP BY options; omit for a flat list
 * @property search - Filter-text accessor; unmatched cards dim rather than disappear
 * @property addLabel - Optional footer action label
 * @property onAdd - Optional footer action callback
 * @property slice - Optional slice chrome: the bound handle; the Library renders the rail + count footer, never narrows data itself
 * @property affordances - Rail affordances when `slice` is set (default `["filter", "search"]`)
 * @property style - Optional layout style (height / maxHeight / virtualization)
 */
export interface LibraryConfig<R extends StructType> {
    /** DnD source identity — targets list it in their `sources` */
    id: string;
    /** Item row mapper — returns card-face fields (or a resolved face expression). */
    item: (row: ExprType<R>) => LibraryCardFields;
    /** Optional header-right caption (defaults to the drag hint) */
    hint?: SubtypeExprOrValue<StringType>;
    /** Secondary dimensions (toolbar-toggleable card facts) */
    dimensions?: LibraryDimensionDef<R>[];
    /** Initially-visible dimension keys (default: the first two) */
    defaultDimensions?: string[];
    /** GROUP BY options; omit for a flat list */
    groupBy?: LibraryGroupDef<R>[];
    /** Filter-text accessor; unmatched cards dim rather than disappear */
    search?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** Optional footer action label */
    addLabel?: SubtypeExprOrValue<StringType>;
    /** Optional footer action callback */
    onAdd?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /**
     * Slice chrome — pass the bound handle and the Library renders the frame
     * chassis itself: a rail mounting the `affordances` (default
     * `["filter", "search"]`) and a derived-count footer. Chrome only: feed
     * the narrowed data explicitly via `data={Slice.rows([RowType], slice)}`,
     * or keep filtered-out cards as dimmed context by feeding
     * `Slice.partition([RowType], slice)` and mapping `matched.not()` into the
     * card face's `filtered`. `brush` / `legend` / `breakdown` are rejected —
     * the Library has no continuous axis or series, and slice breakdown would
     * fight the built-in GROUP BY toolbar. When the `search` affordance is
     * active the built-in search input is suppressed (the rail's search
     * narrows the fed rows; two search boxes with different semantics is a
     * trap).
     */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set (default `["filter", "search"]`) */
    affordances?: SliceAffordanceLiteral[];
    /** Optional layout style (height / maxHeight / virtualization) */
    style?: LibraryStyle;
}

/** Affordances a Library rail cannot mount: no continuous axis (`brush`), no
 *  series (`legend`), and slice breakdown would fight the built-in GROUP BY
 *  toolbar (`breakdown`). */
const REJECTED_AFFORDANCES: readonly SliceAffordanceLiteral[] = ["brush", "legend", "breakdown"];

function buildRoot(
    data: SubtypeExprOrValue<ArrayType<StructType>>,
    config: LibraryConfig<StructType>,
): ExprType<UIComponentType> {
    const data_expr = East.value(data) as ExprType<ArrayType<StructType>>;
    const dimensions = config.dimensions ?? [];
    const groupDefs = config.groupBy ?? [];

    const items = mapRowsBlock(data_expr, LibraryItemType, ($, row) => {
        const dims = $.let(new Map(), DictType(StringType, LibraryDimValueType));
        for (const dim of dimensions) {
            $(dims.insert(dim.key, dimValue(dim, row)));
        }
        const groups = $.let(new Map(), DictType(StringType, StringType));
        for (const group of groupDefs) {
            $(groups.insert(group.key, East.value(group.value(row), StringType)));
        }
        const raw: LibraryCardFields | ExprType<LibraryCardFaceType> = config.item(row);
        const face = $.let(raw instanceof Expr ? raw : createCard(raw), LibraryCardFaceType);
        return East.value({
            key: face.key,
            label: face.label,
            sublabel: face.sublabel,
            icon: face.icon,
            status: face.status,
            draggable: face.draggable,
            filtered: face.filtered,
            search: config.search !== undefined ? some(config.search(row)) : none,
            groups,
            dims,
        }, LibraryItemType);
    });

    // Group-head summaries, hoisted off the items: one O(n) bucketing pass per
    // group option (previously a per-row peer filter — O(n²) — with the same
    // summary string duplicated onto every item).
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
            throw new Error(`Library does not support the '${affordance}' affordance — it has no continuous axis or series, and slice breakdown would fight the built-in GROUP BY toolbar.`);
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
            virtualization: config.style.virtualization !== undefined ? some(config.style.virtualization) : none,
        }, LibraryStyleType)
        : undefined;

    return East.value(variant("Library", {
        id: config.id,
        hint: config.hint !== undefined ? some(config.hint) : none,
        items,
        groupOptions: East.value(
            groupDefs.map(g => ({ key: g.key, label: g.label })),
            ArrayType(LibraryGroupMetaType)),
        groupSummaries: summariesFn(data_expr),
        dimOptions: East.value(
            dimensions.map(d => ({ key: d.key, label: d.label })),
            ArrayType(LibraryDimMetaType)),
        defaultDimensions: East.value(
            config.defaultDimensions ?? dimensions.slice(0, 2).map(d => d.key),
            ArrayType(StringType)),
        searchable: config.search !== undefined,
        addLabel: config.addLabel !== undefined ? some(config.addLabel) : none,
        onAdd: config.onAdd !== undefined ? some(config.onAdd) : none,
        slice: sliceChromeValue !== undefined ? some(sliceChromeValue) : none,
        style: styleValue !== undefined ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Creates a Library — a draggable palette of assignable items.
 *
 * @typeParam R - The struct type of each data row
 * @param data - The rows (one card per element)
 * @param config - The Library configuration ({@link LibraryConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Library, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Library.Root(
 *         [{ id: "patel", name: "Patel, R.", role: "Senior SE", hours: 38.0 }],
 *         {
 *             id: "people",
 *             item: p => ({ key: p.id, label: p.name, sublabel: p.role, icon: "user" }),
 *             dimensions: [
 *                 { kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0,
 *                   format: h => East.str`${h}h` },
 *             ],
 *         },
 *     ),
 * );
 * ```
 */
function createLibrary<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: LibraryConfig<RowElement<T>>,
): ExprType<UIComponentType> {
    return buildRoot(data, config as unknown as LibraryConfig<StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Library component namespace.
 *
 * @remarks
 * `Library.Root(data, config)` builds the palette; the `item` mapper returns
 * plain card-face fields per row; `Library.status` builds status-pill values.
 * Secondary dimensions and group-by options are plain discriminated config
 * literals (`{ kind: "meter", ... }`), like Planner column definitions.
 */
export const Library = {
    /**
     * Creates a Library — a draggable palette of assignable items.
     *
     * @typeParam R - The struct type of each data row
     * @param data - The rows (one card per element)
     * @param config - The Library configuration ({@link LibraryConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Declares the DnD **source** role under `config.id`. Cards with
     * `draggable: false` show no grip and never start a drag. Search text
     * dims unmatched cards instead of removing them.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Library, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Library.Root(
     *         [{ id: "patel", name: "Patel, R.", role: "Senior SE" }],
     *         {
     *             id: "people",
     *             item: p => ({ key: p.id, label: p.name, sublabel: p.role }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createLibrary,
    /**
     * Creates a status pill value for a card face.
     *
     * @param label - Pill text (rendered uppercase)
     * @param tone - Standard status tone (`success` / `warning` / `danger` / `info` / `neutral`)
     * @returns An East expression of the status pill
     *
     * @example
     * ```ts
     * import { Library } from "@elaraai/east-ui";
     *
     * // Library.status("At cap", "neutral")
     * ```
     */
    status: createStatus,
    Types: {
        /**
         * East StructType for the Library component.
         *
         * @remarks
         * The resolved palette: cards plus toolbar metadata. See
         * {@link LibraryRootType} for per-field docs.
         *
         * @property id - DnD source identity
         * @property hint - Optional header-right caption
         * @property items - The resolved cards
         * @property groupOptions - GROUP BY toolbar options
         * @property groupSummaries - Group-head summary text per option key, per group value
         * @property dimOptions - SECONDARY dimension toggles
         * @property defaultDimensions - Initially-visible dimension keys
         * @property searchable - Whether the search input renders
         * @property addLabel - Optional footer action label
         * @property onAdd - Optional footer action callback
         * @property slice - Optional slice chrome (bound handle + rail affordances)
         * @property style - Optional layout style (height / maxHeight / virtualization)
         */
        Library: LibraryRootType,
        /**
         * A resolved Library card.
         *
         * @property key - Item identity
         * @property label - Primary identity line
         * @property sublabel - Optional muted second line
         * @property icon - Optional Font Awesome solid icon name
         * @property status - Optional status pill
         * @property draggable - Whether the card can start a drag
         * @property filtered - Whether the card renders de-emphasised
         * @property search - Optional filter text
         * @property groups - Group value per group-by option key
         * @property dims - Secondary dimension value per dimension key
         */
        Item: LibraryItemType,
        /**
         * The card face produced by the `item` accessor.
         *
         * @property key - Item identity
         * @property label - Primary identity line
         * @property sublabel - Optional muted second line
         * @property icon - Optional Font Awesome solid icon name
         * @property status - Optional status pill
         * @property draggable - Whether the card can start a drag
         * @property filtered - Whether the card renders de-emphasised
         */
        CardFace: LibraryCardFaceType,
        /**
         * Status pill on a Library card.
         *
         * @property label - Pill text (rendered uppercase)
         * @property tone - Standard status tone
         */
        Status: LibraryStatusType,
        /**
         * A secondary dimension's value on one card.
         *
         * @property meter - Utilisation bar with optional right-aligned text
         * @property chips - A row of small chips
         * @property text - A muted caption line
         */
        DimValue: LibraryDimValueType,
        /**
         * East StructType for Library layout style.
         *
         * @property height - Optional CSS height; constraining it makes the card grid the Library's own scroll region
         * @property maxHeight - Optional CSS max-height
         * @property virtualization - Whether rows virtualize inside the scroll region (default `true`)
         */
        Style: LibraryStyleType,
    },
} as const;
