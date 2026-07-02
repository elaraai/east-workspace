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
import {
    LibraryRootType,
    LibraryItemType,
    LibraryCardFaceType,
    LibraryStatusType,
    LibraryDimValueType,
    LibraryGroupPlacementType,
    LibraryGroupMetaType,
    LibraryDimMetaType,
} from "./types.js";

// Re-export types
export {
    LibraryRootType,
    LibraryItemType,
    LibraryCardFaceType,
    LibraryStatusType,
    LibraryDimValueType,
    LibraryGroupPlacementType,
    LibraryGroupMetaType,
    LibraryDimMetaType,
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
}

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
        const groups = $.let(new Map(), DictType(StringType, LibraryGroupPlacementType));
        for (const group of groupDefs) {
            $(groups.insert(group.key, East.value({
                value: group.value(row),
                summary: group.summary !== undefined
                    ? some(group.summary(
                        data_expr.filter((_$, peer) => East.equal(
                            East.value(group.value(peer), StringType),
                            East.value(group.value(row), StringType),
                        ))))
                    : none,
            }, LibraryGroupPlacementType)));
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
            search: config.search !== undefined ? some(config.search(row)) : none,
            groups,
            dims,
        }, LibraryItemType);
    });

    return East.value(variant("Library", {
        id: config.id,
        hint: config.hint !== undefined ? some(config.hint) : none,
        items,
        groupOptions: East.value(
            groupDefs.map(g => ({ key: g.key, label: g.label })),
            ArrayType(LibraryGroupMetaType)),
        dimOptions: East.value(
            dimensions.map(d => ({ key: d.key, label: d.label })),
            ArrayType(LibraryDimMetaType)),
        defaultDimensions: East.value(
            config.defaultDimensions ?? dimensions.slice(0, 2).map(d => d.key),
            ArrayType(StringType)),
        searchable: config.search !== undefined,
        addLabel: config.addLabel !== undefined ? some(config.addLabel) : none,
        onAdd: config.onAdd !== undefined ? some(config.onAdd) : none,
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
         * @property dimOptions - SECONDARY dimension toggles
         * @property defaultDimensions - Initially-visible dimension keys
         * @property searchable - Whether the search input renders
         * @property addLabel - Optional footer action label
         * @property onAdd - Optional footer action callback
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
         * @property search - Optional filter text
         * @property groups - Group placement per group-by option key
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
    },
} as const;
