/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    IntegerType,
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
 * A Library card's status.
 *
 * @remarks
 * The card's availability/assignment state (`ON ROSTER`, `AT CAP`,
 * `PTO MAR 4–8`, `IN SERVICE`), in the standard status tone set. A compact
 * card draws it as a small pill in its top right; a gallery card draws it as
 * `<Status>` does — a dot and the word, the dot open when `ring` is set.
 *
 * @property label - Pill text (rendered uppercase)
 * @property tone - Standard status tone
 * @property ring - The dot drawn open, a state not reached yet (a draft never
 *   published); a gallery card's, which a compact card's pill has none of
 */
export const LibraryStatusType = StructType({
    /** Pill text (rendered uppercase) */
    label: StringType,
    /** Standard status tone */
    tone: StatusTokenType,
    /** The dot drawn open — a gallery card's */
    ring: BooleanType,
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
// Variant, layout and media
// ============================================================================

/**
 * How a Library draws its cards.
 *
 * @property compact - A line per card: the grip, the icon tile, the name over
 *   its meta line, and any status and glyph at the right — the palette a
 *   surface drags from
 * @property gallery - A large card per item: its media, then its name and
 *   status, its meta line, and a foot holding a byline and an action — the
 *   library a person browses
 */
export const LibraryVariantType = VariantType({
    compact: NullType,
    gallery: NullType,
});

/**
 * Type representing how a Library draws its cards.
 */
export type LibraryVariantType = typeof LibraryVariantType;

/** Literal shorthand for {@link LibraryVariantType}. */
export type LibraryVariantLiteral = "compact" | "gallery";

/**
 * How a gallery lays its cards out.
 *
 * @property grid - Cards across the style's `columns`, fewer as the Library
 *   narrows, and one on a phone
 * @property list - A card per row, its media at the start
 */
export const LibraryLayoutType = VariantType({
    grid: NullType,
    list: NullType,
});

/**
 * Type representing how a gallery lays its cards out.
 */
export type LibraryLayoutType = typeof LibraryLayoutType;

/** Literal shorthand for {@link LibraryLayoutType}. */
export type LibraryLayoutLiteral = "grid" | "list";

/**
 * Where a gallery card's media sits, in the grid layout.
 *
 * @property top - Above the face, the style's `mediaSize` tall
 * @property start - At the face's start, the style's `mediaSize` wide
 */
export const LibraryMediaPlacementType = VariantType({
    top: NullType,
    start: NullType,
});

/**
 * Type representing where a gallery card's media sits.
 */
export type LibraryMediaPlacementType = typeof LibraryMediaPlacementType;

/** Literal shorthand for {@link LibraryMediaPlacementType}. */
export type LibraryMediaPlacementLiteral = "top" | "start";

// ============================================================================
// Card / group / dimension metadata
// ============================================================================

/**
 * The card face, over its media's type — the per-item fields produced by the
 * `item` accessor, before the factory merges in dimensions, group placements,
 * and search text.
 *
 * @typeParam C - The media's type
 * @param content - The media's type — the recursion node in the inline arm,
 *   `UIComponentType` in `Library.Types.CardFace`
 * @returns The card face struct
 *
 * @property key - Item identity; carried by `LibraryRef` when dragged
 * @property label - Primary identity line
 * @property sublabel - Optional muted second line
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status
 * @property trailing - Optional glyph at the card's right edge — a gallery
 *   card's foot's end
 * @property draggable - Whether the card can start a drag
 * @property filtered - Whether the card renders de-emphasised (dimmed, drag disabled)
 * @property placed - Whether the card shows its placed state
 * @property media - A gallery card's media: any UI component
 * @property avatar - A gallery card's byline avatar: the name whose initials it shows
 * @property byline - A gallery card's byline: the line in its foot, after the avatar
 * @property action - A gallery card's action: a label in the link voice at its
 *   foot's end, which a click on the card follows
 */
export function LibraryCardFaceOf<const C>(content: C) {
    return StructType({
        key: StringType,
        label: StringType,
        sublabel: OptionType(StringType),
        icon: OptionType(StringType),
        status: OptionType(LibraryStatusType),
        trailing: OptionType(LibraryGlyphType),
        draggable: BooleanType,
        filtered: BooleanType,
        placed: BooleanType,
        media: OptionType(content),
        avatar: OptionType(StringType),
        byline: OptionType(StringType),
        action: OptionType(StringType),
    });
}

/**
 * A resolved Library card, over its media's type.
 *
 * @remarks
 * Produced by the `item` accessor plus the dimension / group / search
 * accessors at authoring time — the renderer never sees the host's row type.
 * The face's fields ({@link LibraryCardFaceOf}), then:
 *
 * @typeParam C - The media's type
 * @param content - The media's type — the recursion node in the inline arm,
 *   `UIComponentType` in `Library.Types.Item`
 * @returns The card struct
 *
 * @property search - Optional filter text (card hides when unmatched)
 * @property groups - Group value per group-by option key
 * @property facets - The values the card holds per filter key
 * @property dims - Secondary dimension value per dimension key
 */
export function LibraryItemOf<const C>(content: C) {
    return StructType({
        ...LibraryCardFaceOf(content).fields,
        search: OptionType(StringType),
        groups: DictType(StringType, StringType),
        facets: DictType(StringType, ArrayType(StringType)),
        dims: DictType(StringType, LibraryDimValueType),
    });
}

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
 * @property virtualization - Whether rows virtualize inside the scroll region (default `true`); a gallery mounts every card
 * @property columns - A gallery's cards across, in the grid layout
 * @property mediaPlacement - Where a gallery card's media sits in the grid layout
 * @property mediaSize - A gallery card's media height, placed on top, or width, placed at the start — a CSS length
 */
export const LibraryStyleType = StructType({
    /** Optional CSS height (e.g. `"480px"`, `"100%"`) */
    height: OptionType(StringType),
    /** Optional CSS max-height */
    maxHeight: OptionType(StringType),
    /** Whether rows virtualize inside the scroll region (default `true`) */
    virtualization: OptionType(BooleanType),
    /** A gallery's cards across, in the grid layout */
    columns: OptionType(IntegerType),
    /** Where a gallery card's media sits in the grid layout */
    mediaPlacement: OptionType(LibraryMediaPlacementType),
    /** A gallery card's media height (top) or width (start) — a CSS length */
    mediaSize: OptionType(StringType),
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
 * @property columns - A gallery's cards across, in the grid layout (default 3)
 * @property mediaPlacement - Where a gallery card's media sits in the grid layout (default `"top"`)
 * @property mediaSize - A gallery card's media height, placed on top, or width, placed at the start
 */
export interface LibraryStyle {
    /** Uniform sizing (#320): bound the Library — a CSS length — a bare number (`"320"`), `"fill"` (fill the parent box), a percentage, `calc(...)`, or explicit `px` (`"480px"`, `"100%"`); constraining it makes the card grid the Library's own scroll region */
    height?: SubtypeExprOrValue<StringType>;
    /** Uniform sizing (#320): max-height cap — a pixel `number` or CSS length */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Whether rows virtualize inside the scroll region (default `true`; set `false` to always mount every card). A gallery mounts every card. */
    virtualization?: SubtypeExprOrValue<BooleanType>;
    /** A gallery's cards across, in the grid layout (default 3); a narrower Library holds fewer, and a phone one. */
    columns?: SubtypeExprOrValue<IntegerType>;
    /** Where a gallery card's media sits in the grid layout: `"top"` (the default), above the face, or `"start"`, at its start. The list layout puts it at the start. */
    mediaPlacement?: LibraryMediaPlacementLiteral;
    /** A gallery card's media height, placed on top, or width, placed at the start — a CSS length. */
    mediaSize?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Root
// ============================================================================

/**
 * The Library component's value, over its cards' media type.
 *
 * @remarks
 * A draggable palette of things that get assigned onto grid surfaces
 * (Roster, Blend): people, assets, vehicles, rooms. Declares the DnD
 * **source** role under `id`; targets connect by listing that id in their
 * `sources`. Pure source — it never receives drops, except as the
 * return-to-palette sink for its connected targets. A gallery draws the same
 * cards large, each with its media.
 *
 * @typeParam C - The cards' media type
 * @param content - The cards' media type — the recursion node in the inline
 *   arm, `UIComponentType` in `Library.Types.Library`
 * @returns The root struct
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
 * @property addLabel - Optional footer action label — a gallery's dashed last card
 * @property onAdd - Optional footer action callback
 * @property onCardClick - Optional callback fired with a card's key when it is clicked
 * @property slice - Optional slice chrome (bound handle + rail affordances)
 * @property style - Optional layout style (height / maxHeight / virtualization, and a gallery's columns and media)
 * @property variant - How the cards are drawn; `none` is compact
 * @property layout - How a gallery lays its cards out; `none` is the grid
 */
export function LibraryRootOf<const C>(content: C) {
    return StructType({
        id: StringType,
        hint: OptionType(StringType),
        items: ArrayType(LibraryItemOf(content)),
        groupOptions: ArrayType(LibraryGroupMetaType),
        groupSummaries: DictType(StringType, DictType(StringType, StringType)),
        dimOptions: ArrayType(LibraryDimMetaType),
        defaultDimensions: ArrayType(StringType),
        filterOptions: ArrayType(LibraryGroupMetaType),
        searchable: BooleanType,
        noun: OptionType(LibraryNounType),
        addLabel: OptionType(StringType),
        onAdd: OptionType(FunctionType([], NullType)),
        onCardClick: OptionType(FunctionType([StringType], NullType)),
        slice: OptionType(SliceChromeType),
        style: OptionType(LibraryStyleType),
        variant: OptionType(LibraryVariantType),
        layout: OptionType(LibraryLayoutType),
    });
}
