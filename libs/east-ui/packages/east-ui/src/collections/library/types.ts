/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";
import { SliceChromeType } from "../../platform/slice/index.js";

// ============================================================================
// Card status
// ============================================================================

/**
 * Status pill on a Library card.
 *
 * @remarks
 * The card's availability/assignment state (`ON ROSTER`, `AT CAP`,
 * `PTO MAR 4–8`, `IN SERVICE`), rendered as a small pill in the card's top
 * right using the standard status tone set.
 *
 * @property label - Pill text (rendered uppercase)
 * @property tone - Standard status tone
 */
export const LibraryStatusType = StructType({
    /** Pill text (rendered uppercase) */
    label: StringType,
    /** Standard status tone */
    tone: StatusTokenType,
});

/**
 * Type representing Library card status values.
 */
export type LibraryStatusType = typeof LibraryStatusType;

// ============================================================================
// Secondary dimension values
// ============================================================================

/**
 * A secondary dimension's value on one card.
 *
 * @remarks
 * Secondary dimensions are the configurable card facts (hours, skills,
 * certifications, capacity, range, location) that the toolbar toggles on and
 * off. Each renders by kind: `meter` (utilisation bar + right-aligned text),
 * `chips` (a row of small chips), or `text` (a muted caption).
 *
 * @property meter - Utilisation bar with optional right-aligned text
 * @property chips - A row of small chips
 * @property text - A muted caption line
 */
export const LibraryDimValueType = VariantType({
    /** Utilisation bar with optional right-aligned text */
    meter: StructType({
        /** Current value */
        value: FloatType,
        /** Full-scale value */
        max: FloatType,
        /** Optional right-aligned text (e.g. `38h`) */
        text: OptionType(StringType),
    }),
    /** A row of small chips */
    chips: ArrayType(StringType),
    /** A muted caption line */
    text: StringType,
});

/**
 * Type representing secondary dimension values.
 */
export type LibraryDimValueType = typeof LibraryDimValueType;

// ============================================================================
// Card / group / dimension metadata
// ============================================================================

/**
 * A resolved Library card.
 *
 * @remarks
 * Produced by the `item` accessor plus the dimension / group / search
 * accessors at authoring time — the renderer never sees the host's row type.
 *
 * @property key - Item identity; carried by `LibraryRef` when dragged
 * @property label - Primary identity line
 * @property sublabel - Optional muted second line (role / class)
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status pill
 * @property draggable - Whether the card can start a drag
 * @property filtered - Whether the card renders de-emphasised (dimmed, drag disabled) — the `Slice.partition` "keep the excluded" feed
 * @property search - Optional filter text (card dims when unmatched)
 * @property groups - Group value per group-by option key
 * @property dims - Secondary dimension value per dimension key
 */
export const LibraryItemType = StructType({
    /** Item identity; carried by `LibraryRef` when dragged */
    key: StringType,
    /** Primary identity line */
    label: StringType,
    /** Optional muted second line (role / class) */
    sublabel: OptionType(StringType),
    /** Optional Font Awesome solid icon name */
    icon: OptionType(StringType),
    /** Optional status pill */
    status: OptionType(LibraryStatusType),
    /** Whether the card can start a drag */
    draggable: BooleanType,
    /** Whether the card renders de-emphasised (dimmed, drag disabled) */
    filtered: BooleanType,
    /** Optional filter text (card dims when unmatched) */
    search: OptionType(StringType),
    /** Group value per group-by option key */
    groups: DictType(StringType, StringType),
    /** Secondary dimension value per dimension key */
    dims: DictType(StringType, LibraryDimValueType),
});

/**
 * Type representing resolved Library cards.
 */
export type LibraryItemType = typeof LibraryItemType;

/**
 * The card face — the per-item fields produced by the `item` accessor
 * (via `Library.card`), before the factory merges in dimensions, group
 * placements, and search text.
 *
 * @property key - Item identity; carried by `LibraryRef` when dragged
 * @property label - Primary identity line
 * @property sublabel - Optional muted second line
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status pill
 * @property draggable - Whether the card can start a drag
 * @property filtered - Whether the card renders de-emphasised (dimmed, drag disabled)
 */
export const LibraryCardFaceType = StructType({
    /** Item identity; carried by `LibraryRef` when dragged */
    key: StringType,
    /** Primary identity line */
    label: StringType,
    /** Optional muted second line */
    sublabel: OptionType(StringType),
    /** Optional Font Awesome solid icon name */
    icon: OptionType(StringType),
    /** Optional status pill */
    status: OptionType(LibraryStatusType),
    /** Whether the card can start a drag */
    draggable: BooleanType,
    /** Whether the card renders de-emphasised (dimmed, drag disabled) */
    filtered: BooleanType,
});

/**
 * Type representing card face values.
 */
export type LibraryCardFaceType = typeof LibraryCardFaceType;

/**
 * Toolbar metadata for one group-by option.
 *
 * @property key - Option identity (matches each card's `groups` key)
 * @property label - Segment label in the GROUP BY toolbar
 */
export const LibraryGroupMetaType = StructType({
    /** Option identity (matches each card's `groups` key) */
    key: StringType,
    /** Segment label in the GROUP BY toolbar */
    label: StringType,
});

/**
 * Type representing group-by option metadata.
 */
export type LibraryGroupMetaType = typeof LibraryGroupMetaType;

/**
 * Toolbar metadata for one secondary dimension.
 *
 * @property key - Dimension identity (matches each card's `dims` key)
 * @property label - Toggle label in the SECONDARY toolbar
 */
export const LibraryDimMetaType = StructType({
    /** Dimension identity (matches each card's `dims` key) */
    key: StringType,
    /** Toggle label in the SECONDARY toolbar */
    label: StringType,
});

/**
 * Type representing secondary dimension metadata.
 */
export type LibraryDimMetaType = typeof LibraryDimMetaType;

// ============================================================================
// Style
// ============================================================================

/**
 * East StructType for Library layout style.
 *
 * @remarks
 * When `height` or `maxHeight` constrains the component, the card grid
 * becomes the Library's own scroll region (header / toolbar / footer chrome
 * stay fixed) and rows virtualize. Unconstrained, the Library grows to its
 * content height and defers scrolling to an ancestor — the pre-#258
 * behaviour.
 *
 * @property height - Optional CSS height (e.g. `"480px"`, `"100%"`)
 * @property maxHeight - Optional CSS max-height
 * @property virtualization - Whether rows virtualize inside the scroll region (default `true`)
 */
export const LibraryStyleType = StructType({
    /** Optional CSS height (e.g. `"480px"`, `"100%"`) */
    height: OptionType(StringType),
    /** Optional CSS max-height */
    maxHeight: OptionType(StringType),
    /** Whether rows virtualize inside the scroll region (default `true`) */
    virtualization: OptionType(BooleanType),
});

/**
 * Type representing Library layout style values.
 */
export type LibraryStyleType = typeof LibraryStyleType;

/**
 * Style options for the Library component.
 *
 * @property height - Optional CSS height (e.g. `"480px"`, `"100%"`); constraining it makes the card grid the Library's own scroll region
 * @property maxHeight - Optional CSS max-height
 * @property virtualization - Whether rows virtualize inside the scroll region (default `true`; set `false` to always mount every card)
 */
export interface LibraryStyle {
    /** Optional CSS height (e.g. `"480px"`, `"100%"`); constraining it makes the card grid the Library's own scroll region */
    height?: SubtypeExprOrValue<StringType>;
    /** Optional CSS max-height */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Whether rows virtualize inside the scroll region (default `true`; set `false` to always mount every card) */
    virtualization?: SubtypeExprOrValue<BooleanType>;
}

// ============================================================================
// Root
// ============================================================================

/**
 * East StructType for the Library component.
 *
 * @remarks
 * A draggable palette of things that get assigned onto grid surfaces
 * (Roster, Blend): people, assets, vehicles, rooms. Declares the DnD
 * **source** role under `id`; targets connect by listing that id in their
 * `sources`. Pure source — it never receives drops, except as the
 * return-to-palette sink for its connected targets.
 *
 * @property id - DnD source identity
 * @property hint - Optional header-right caption (absent ⇒ no header band)
 * @property items - The resolved cards
 * @property groupOptions - GROUP BY toolbar options (empty = no grouping toolbar)
 * @property groupSummaries - Right-aligned group-head summary text per group-by option key, per group value
 * @property dimOptions - SECONDARY dimension toggles (empty = no toggle toolbar)
 * @property defaultDimensions - Initially-visible dimension keys
 * @property searchable - Whether the search input renders
 * @property addLabel - Optional footer action label
 * @property onAdd - Optional footer action callback
 * @property slice - Optional slice chrome (bound handle + rail affordances)
 * @property style - Optional layout style (height / maxHeight / virtualization)
 */
export const LibraryRootType = StructType({
    /** DnD source identity */
    id: StringType,
    /** Optional header-right caption (absent ⇒ no header band) */
    hint: OptionType(StringType),
    /** The resolved cards */
    items: ArrayType(LibraryItemType),
    /** GROUP BY toolbar options (empty = no grouping toolbar) */
    groupOptions: ArrayType(LibraryGroupMetaType),
    /** Right-aligned group-head summary text per group-by option key, per group value */
    groupSummaries: DictType(StringType, DictType(StringType, StringType)),
    /** SECONDARY dimension toggles (empty = no toggle toolbar) */
    dimOptions: ArrayType(LibraryDimMetaType),
    /** Initially-visible dimension keys */
    defaultDimensions: ArrayType(StringType),
    /** Whether the search input renders */
    searchable: BooleanType,
    /** Optional footer action label */
    addLabel: OptionType(StringType),
    /** Optional footer action callback */
    onAdd: OptionType(FunctionType([], NullType)),
    /** Optional slice chrome (bound handle + rail affordances) */
    slice: OptionType(SliceChromeType),
    /** Optional layout style (height / maxHeight / virtualization) */
    style: OptionType(LibraryStyleType),
});

/**
 * Type representing the Library component.
 */
export type LibraryRootType = typeof LibraryRootType;
