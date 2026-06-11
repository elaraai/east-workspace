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
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";

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
 * One card's group placement under a group-by option: the group value it
 * belongs to plus the (shared) group summary text.
 *
 * @property value - The group this card belongs to under the option
 * @property summary - Right-aligned group-head summary text
 */
export const LibraryGroupPlacementType = StructType({
    /** The group this card belongs to under the option */
    value: StringType,
    /** Right-aligned group-head summary text */
    summary: OptionType(StringType),
});

/**
 * Type representing a card's group placement.
 */
export type LibraryGroupPlacementType = typeof LibraryGroupPlacementType;

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
 * @property search - Optional filter text (card dims when unmatched)
 * @property groups - Group placement per group-by option key
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
    /** Optional filter text (card dims when unmatched) */
    search: OptionType(StringType),
    /** Group placement per group-by option key */
    groups: DictType(StringType, LibraryGroupPlacementType),
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
 * @property hint - Optional header-right caption (defaults to the drag hint)
 * @property items - The resolved cards
 * @property groupOptions - GROUP BY toolbar options (empty = no grouping toolbar)
 * @property dimOptions - SECONDARY dimension toggles (empty = no toggle toolbar)
 * @property defaultDimensions - Initially-visible dimension keys
 * @property searchable - Whether the search input renders
 * @property addLabel - Optional footer action label
 * @property onAdd - Optional footer action callback
 */
export const LibraryRootType = StructType({
    /** DnD source identity */
    id: StringType,
    /** Optional header-right caption (defaults to the drag hint) */
    hint: OptionType(StringType),
    /** The resolved cards */
    items: ArrayType(LibraryItemType),
    /** GROUP BY toolbar options (empty = no grouping toolbar) */
    groupOptions: ArrayType(LibraryGroupMetaType),
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
});

/**
 * Type representing the Library component.
 */
export type LibraryRootType = typeof LibraryRootType;
