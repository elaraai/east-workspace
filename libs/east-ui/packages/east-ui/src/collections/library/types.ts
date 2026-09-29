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
// Trailing glyph
// ============================================================================

/**
 * A glyph at a Library card's right edge — a lock on something fixed, a dot
 * for a status.
 *
 * @remarks
 * Drawn in the card's quiet ink, or the brand ink while the card is placed,
 * unless it carries a tone.
 *
 * @property icon - Font Awesome solid icon name
 * @property label - What the glyph says, for assistive technology and the tooltip
 * @property tone - Optional status tone that colours the glyph
 */
export const LibraryGlyphType = StructType({
    /** Font Awesome solid icon name */
    icon: StringType,
    /** What the glyph says, for assistive technology and the tooltip */
    label: StringType,
    /** Optional status tone that colours the glyph */
    tone: OptionType(StatusTokenType),
});

/**
 * Type representing a Library card's trailing glyph.
 */
export type LibraryGlyphType = typeof LibraryGlyphType;

/**
 * What the Library calls its items — "Search 47 components…".
 *
 * @property singular - One item ("component")
 * @property plural - Any other count ("components")
 */
export const LibraryNounType = StructType({
    /** One item ("component") */
    singular: StringType,
    /** Any other count ("components") */
    plural: StringType,
});

/**
 * Type representing the Library's noun.
 */
export type LibraryNounType = typeof LibraryNounType;

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
 * @property trailing - Optional glyph at the card's right edge
 * @property draggable - Whether the card can start a drag
 * @property filtered - Whether the card renders de-emphasised (dimmed, drag disabled) — the `Slice.partition` "keep the excluded" feed
 * @property placed - Whether the card shows its placed state — the brand border and tint
 * @property search - Optional filter text (card hides when unmatched)
 * @property groups - Group value per group-by option key
 * @property facets - The values the card holds per filter key
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
    /** Optional glyph at the card's right edge */
    trailing: OptionType(LibraryGlyphType),
    /** Whether the card can start a drag */
    draggable: BooleanType,
    /** Whether the card renders de-emphasised (dimmed, drag disabled) */
    filtered: BooleanType,
    /** Whether the card shows its placed state — the brand border and tint */
    placed: BooleanType,
    /** Optional filter text (card hides when unmatched) */
    search: OptionType(StringType),
    /** Group value per group-by option key */
    groups: DictType(StringType, StringType),
    /** The values the card holds per filter key */
    facets: DictType(StringType, ArrayType(StringType)),
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
 * @property trailing - Optional glyph at the card's right edge
 * @property draggable - Whether the card can start a drag
 * @property filtered - Whether the card renders de-emphasised (dimmed, drag disabled)
 * @property placed - Whether the card shows its placed state
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
    /** Optional glyph at the card's right edge */
    trailing: OptionType(LibraryGlyphType),
    /** Whether the card can start a drag */
    draggable: BooleanType,
    /** Whether the card renders de-emphasised (dimmed, drag disabled) */
    filtered: BooleanType,
    /** Whether the card shows its placed state */
    placed: BooleanType,
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
    /** Uniform sizing (#320): bound the Library — a CSS length — a bare number (`"320"`), `"fill"` (fill the parent box), a percentage, `calc(...)`, or explicit `px` (`"480px"`, `"100%"`); constraining it makes the card grid the Library's own scroll region */
    height?: SubtypeExprOrValue<StringType>;
    /** Uniform sizing (#320): max-height cap — a pixel `number` or CSS length */
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
 * @property filterOptions - The Filter menu's facets (empty = no Filter menu)
 * @property searchable - Whether the search input renders
 * @property noun - Optional name for the items ("Search 47 components…")
 * @property addLabel - Optional footer action label
 * @property onAdd - Optional footer action callback
 * @property onCardClick - Optional callback fired with a card's key when it is clicked
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
    /** The Filter menu's facets (empty = no Filter menu) */
    filterOptions: ArrayType(LibraryGroupMetaType),
    /** Whether the search input renders */
    searchable: BooleanType,
    /** Optional name for the items ("Search 47 components…") */
    noun: OptionType(LibraryNounType),
    /** Optional footer action label */
    addLabel: OptionType(StringType),
    /** Optional footer action callback */
    onAdd: OptionType(FunctionType([], NullType)),
    /** Optional callback fired with a card's key when it is clicked */
    onCardClick: OptionType(FunctionType([StringType], NullType)),
    /** Optional slice chrome (bound handle + rail affordances) */
    slice: OptionType(SliceChromeType),
    /** Optional layout style (height / maxHeight / virtualization) */
    style: OptionType(LibraryStyleType),
});

/**
 * Type representing the Library component.
 */
export type LibraryRootType = typeof LibraryRootType;
