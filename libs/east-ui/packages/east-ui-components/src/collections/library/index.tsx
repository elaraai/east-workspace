/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
    Avatar as ChakraAvatar, Box, chakra, Menu as ChakraMenu, Portal, useRecipe, useSlotRecipe, type SystemStyleObject,
} from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCheck, faFilter, faGrip, faGripVertical, faLayerGroup, faList, faMagnifyingGlass, faPlus, faSliders, faXmark,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { type IconName } from "@fortawesome/fontawesome-svg-core";
import { equivalentFor, match, type ValueTypeOf } from "@elaraai/east";
import { Library, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useDragSourceItem, useDropSink } from "../../dnd/drag-layer";
import { HOST_RANK, useSliceToolbarItems } from "../../slice/rail/index.js";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { radioGroupKey } from "../../primitives/radio-group.js";
import { Toolbar, type ToolbarItem } from "../../toolbar/index.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { parseCssSize } from "../../style/parse-size.js";
import { virtualScrollbarCss } from "../../style/scrollbar.js";
import { useFormatters } from "../../format/index.js";
import { EastChakraComponent } from "../../component";

const libraryEqual = equivalentFor(Library.Types.Library);

/** East Library value type. */
export type LibraryValue = ValueTypeOf<typeof Library.Types.Library>;

/** East Library item value type. */
export type LibraryItemValue = ValueTypeOf<typeof Library.Types.Item>;

/** A gallery's layout — derived from the East type, never mirrored. */
type LibraryLayout = ValueTypeOf<typeof Library.Types.Layout>["type"];

/** The bound slice handle, decoded. */
type SliceBindValue = ValueTypeOf<typeof SliceInternal.Types.Bind>;

export interface EastChakraLibraryProps {
    value: LibraryValue;
    storageKey: string;
    /**
     * Draws a gallery card's media, as React — a host renderer's thumbnail,
     * in place of the item's East `media`; every card of the gallery shows it.
     */
    renderMedia?: ((item: LibraryItemValue) => ReactNode) | undefined;
}

type SlotStyles = Record<string, SystemStyleObject>;

interface LibraryToolbarState {
    groupKey: string | null;
    activeDims: string[];
    /** The Filter menu's checked values, per facet key. */
    filters?: Record<string, string[]>;
    /** A gallery's layout, as the toolbar's switch last left it. */
    layout?: LibraryLayout | undefined;
    /** Top visible virtual-entry index — a clamped index survives data changes (#143 convention). */
    scrollIndex?: number;
}

function itemSearchText(item: LibraryItemValue): string {
    return (getSomeorUndefined(item.search) ?? item.label).toLowerCase();
}

// ============================================================================
// Virtual entry model — one flat list covering flat AND grouped layouts
// ============================================================================

/** One resolved group of cards (flat layout = a single `""`-labelled group). */
export interface LibraryGroup {
    label: string;
    summary: string | undefined;
    items: LibraryItemValue[];
}

/** One virtualizable row of the Library body: a group head or a chunk of ≤ `columns` cards. */
export type LibraryEntry =
    | { kind: "groupHead"; label: string; summary: string | undefined; count: number }
    | { kind: "cardRow"; items: LibraryItemValue[] };

/** Card min-width the responsive grid packs against (`minmax(220px, 1fr)`). */
const CARD_MIN_WIDTH = 220;
/** Gap between cards in px. */
const GRID_GAP = 6;
/** The body's horizontal padding in px, each side. */
const GRID_PAD_X = 14;
/** The virtualized body's padding above the first row, and below the last card row's own gap. */
const VIRTUAL_PAD_START = 14;
const VIRTUAL_PAD_END = 8;

/** The grouping menu's value for no grouping — no group-by option key can be it. */
const NO_GROUP = "\u0000none";

/** The Library whose search box ⌘ / focuses: the one last pointed at or focused, else the first mounted. */
let searchOwner: symbol | undefined;

/**
 * Computes the card-column count for a container width — the same arithmetic
 * CSS `repeat(auto-fill, minmax(220px, 1fr))` performs, so the virtualized
 * chunk rows pack identically to the non-virtual grid.
 */
export function libraryColumnsFor(containerWidth: number): number {
    const inner = containerWidth - 2 * GRID_PAD_X;
    return Math.max(1, Math.floor((inner + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
}

/**
 * Flattens resolved groups into the virtual entry list: a `groupHead` per
 * labelled group followed by its cards chunked into rows of `columns`. The
 * flat layout is the degenerate case with zero `groupHead` entries — grouped
 * and ungrouped share one virtualization path.
 */
export function libraryEntries(groups: readonly LibraryGroup[], columns: number): LibraryEntry[] {
    const cols = Math.max(1, columns);
    const out: LibraryEntry[] = [];
    for (const group of groups) {
        if (group.label !== "") {
            out.push({ kind: "groupHead", label: group.label, summary: group.summary, count: group.items.length });
        }
        for (let i = 0; i < group.items.length; i += cols) {
            out.push({ kind: "cardRow", items: group.items.slice(i, i + cols) });
        }
    }
    return out;
}

// ============================================================================
// Card
// ============================================================================

/** A card's secondary facts, in the toolbar's order — a compact card's and a gallery card's alike. */
function LibraryDims({ item, keys, styles }: { item: LibraryItemValue; keys: readonly string[]; styles: SlotStyles }) {
    return keys.map(key => {
        const dim = item.dims.get(key)!;
        return match(dim, {
            meter: (m) => (
                <Box key={key} css={styles.meter}>
                    <Box css={styles.meterTrack}>
                        <Box
                            css={styles.meterFill}
                            width={`${Math.max(0, Math.min(100, m.max > 0 ? (m.value / m.max) * 100 : 0))}%`}
                        />
                    </Box>
                    {getSomeorUndefined(m.text) !== undefined && (
                        <Box as="span" css={styles.meterText}>{getSomeorUndefined(m.text)}</Box>
                    )}
                </Box>
            ),
            chips: (chips) => (
                <Box key={key} css={styles.chips}>
                    {chips.map((chip, i) => (
                        <Box as="span" key={i} css={styles.chip}>{chip}</Box>
                    ))}
                </Box>
            ),
            text: (text) => (
                <Box key={key} css={styles.dimText}>{text}</Box>
            ),
        });
    });
}

interface LibraryCardProps {
    libraryId: string;
    item: LibraryItemValue;
    dimOrder: string[];
    activeDims: string[];
    filtered: boolean;
    styles: SlotStyles;
    onCardClick: ((key: string) => void) | undefined;
}

function LibraryCard({ libraryId, item, dimOrder, activeDims, filtered, styles, onCardClick }: LibraryCardProps) {
    const status = getSomeorUndefined(item.status);
    const glyph = getSomeorUndefined(item.trailing);
    const glyphTone = glyph !== undefined ? getSomeorUndefined(glyph.tone) : undefined;
    const sublabel = getSomeorUndefined(item.sublabel);
    const icon = getSomeorUndefined(item.icon);
    const draggable = item.draggable && !filtered;
    const visibleDims = dimOrder.filter(k => activeDims.includes(k) && item.dims.get(k) !== undefined);
    const tall = visibleDims.length > 0;

    const from = useMemo(() => ({ library: libraryId, key: item.key, label: item.label }), [libraryId, item.key, item.label]);
    const ghost = useMemo(() => (
        <Box css={styles.ghost}>{item.label}</Box>
    ), [styles.ghost, item.label]);
    // The card is its own drag handle — by pointer, or focused and picked up
    // with Space / Enter.
    const drag = useDragSourceItem(from, ghost, !draggable);
    // A click reports the card; a drag never clicks (the sensor swallows the
    // click it ends with). A card that cannot be dragged is a button, so the
    // keyboard clicks it too.
    const click = onCardClick === undefined ? {} : {
        onClick: () => onCardClick(item.key),
        ...(drag === undefined ? {
            role: "button",
            tabIndex: 0,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onCardClick(item.key);
            },
        } : {}),
    };

    return (
        <Box
            css={styles.card}
            {...drag}
            {...click}
            {...(filtered ? { "data-filtered": "" } : {})}
            {...(item.placed ? { "data-placed": "" } : {})}
            {...(draggable && drag ? { "data-draggable": "" } : {})}
            {...(onCardClick !== undefined ? { "data-clickable": "" } : {})}
            {...(tall ? { "data-tall": "" } : {})}
        >
            {draggable && drag && (
                <Box as="span" css={styles.grip} data-drag-grip="">
                    <FontAwesomeIcon icon={faGripVertical} />
                </Box>
            )}
            {icon && (
                <Box css={styles.iconTile}>
                    <FontAwesomeIcon icon={["fas", icon as IconName]} />
                </Box>
            )}
            <Box css={styles.cardBody}>
                {tall && status ? (
                    // Secondary facts take the body's full width, so the status rides the name's line.
                    <Box css={styles.cardHead}>
                        <Box as="span" css={styles.cardLabel}>{item.label}</Box>
                        <Box as="span" css={styles.statusPill} data-tone={status.tone.type}>{status.label}</Box>
                    </Box>
                ) : (
                    <Box as="span" css={styles.cardLabel}>{item.label}</Box>
                )}
                {sublabel && <Box as="span" css={styles.cardSublabel}>{sublabel}</Box>}
                <LibraryDims item={item} keys={visibleDims} styles={styles} />
            </Box>
            {((!tall && status) || glyph) && (
                <Box css={styles.trailing}>
                    {!tall && status && (
                        <Box as="span" css={styles.statusPill} data-tone={status.tone.type}>
                            {status.label}
                        </Box>
                    )}
                    {glyph && (
                        <Box
                            as="span"
                            css={styles.glyph}
                            role="img"
                            aria-label={glyph.label}
                            title={glyph.label}
                            {...(glyphTone !== undefined ? { "data-tone": glyphTone.type } : {})}
                        >
                            <FontAwesomeIcon icon={["fas", glyph.icon as IconName]} />
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}

interface LibraryGalleryCardProps extends LibraryCardProps {
    /** Where the card's media keeps its state. */
    storageKey: string;
    /** Draws the card's media, when the host does. */
    renderMedia: ((item: LibraryItemValue) => ReactNode) | undefined;
}

/**
 * A gallery card: its media on the sunken paper, then its face — the name and
 * status, the meta line, any secondary facts, and a foot holding the byline
 * and the action or glyph. The card is the one target: it drags, and a click
 * anywhere on it — the action it names included — is its click. The media is
 * a thumbnail, so nothing in it takes the pointer or the focus.
 */
function LibraryGalleryCard({ libraryId, item, dimOrder, activeDims, filtered, styles, onCardClick, storageKey, renderMedia }: LibraryGalleryCardProps) {
    const status = getSomeorUndefined(item.status);
    const statusStyles = useSlotRecipe({ key: "status" })({
        status: status?.tone.type ?? "neutral",
        size: "md",
        ring: status?.ring ?? false,
    }) as SlotStyles;
    const glyph = getSomeorUndefined(item.trailing);
    const glyphTone = glyph !== undefined ? getSomeorUndefined(glyph.tone) : undefined;
    const sublabel = getSomeorUndefined(item.sublabel);
    const media = getSomeorUndefined(item.media);
    const avatar = getSomeorUndefined(item.avatar);
    const byline = getSomeorUndefined(item.byline);
    const action = getSomeorUndefined(item.action);
    const draggable = item.draggable && !filtered;
    const visibleDims = dimOrder.filter(k => activeDims.includes(k) && item.dims.get(k) !== undefined);

    const from = useMemo(() => ({ library: libraryId, key: item.key, label: item.label }), [libraryId, item.key, item.label]);
    const ghost = useMemo(() => (
        <Box css={styles.ghost}>{item.label}</Box>
    ), [styles.ghost, item.label]);
    const drag = useDragSourceItem(from, ghost, !draggable);
    const click = onCardClick === undefined ? {} : {
        onClick: () => onCardClick(item.key),
        ...(drag === undefined ? {
            role: "button",
            tabIndex: 0,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onCardClick(item.key);
            },
        } : {}),
    };

    return (
        <Box
            css={styles.galleryCard}
            data-library-card={item.key}
            {...drag}
            {...click}
            {...(filtered ? { "data-filtered": "" } : {})}
            {...(item.placed ? { "data-placed": "" } : {})}
            {...(draggable && drag ? { "data-draggable": "" } : {})}
            {...(onCardClick !== undefined ? { "data-clickable": "" } : {})}
        >
            {(renderMedia !== undefined || media !== undefined) && (
                <Box css={styles.galleryMedia} data-library-media="" aria-hidden inert>
                    {renderMedia !== undefined ? renderMedia(item)
                        : media !== undefined && <EastChakraComponent value={media} storageKey={`${storageKey}.media.${item.key}`} />}
                </Box>
            )}
            <Box css={styles.galleryFace}>
                <Box css={styles.galleryHead}>
                    <Box as="span" css={styles.galleryTitle}>{item.label}</Box>
                    {status !== undefined && (
                        <Box as="span" css={statusStyles.root} data-library-status={status.tone.type}>
                            <Box as="span" css={statusStyles.indicator} />
                            <Box as="span" css={statusStyles.label}>{status.label}</Box>
                        </Box>
                    )}
                </Box>
                {sublabel !== undefined && <Box as="span" css={styles.gallerySublabel}>{sublabel}</Box>}
                <LibraryDims item={item} keys={visibleDims} styles={styles} />
                {(avatar !== undefined || byline !== undefined || action !== undefined || glyph !== undefined) && (
                    <Box css={styles.galleryFoot} data-library-foot="">
                        <Box css={styles.galleryByline}>
                            {avatar !== undefined && (
                                <ChakraAvatar.Root size="2xs">
                                    <ChakraAvatar.Fallback name={avatar} />
                                </ChakraAvatar.Root>
                            )}
                            {byline !== undefined && <Box as="span" css={styles.galleryBylineText}>{byline}</Box>}
                        </Box>
                        {action !== undefined && (
                            <Box as="span" css={styles.galleryAction} data-library-action="">{action}</Box>
                        )}
                        {glyph !== undefined && (
                            <Box
                                as="span"
                                css={styles.glyph}
                                role="img"
                                aria-label={glyph.label}
                                title={glyph.label}
                                {...(glyphTone !== undefined ? { "data-tone": glyphTone.type } : {})}
                            >
                                <FontAwesomeIcon icon={["fas", glyph.icon as IconName]} />
                            </Box>
                        )}
                    </Box>
                )}
            </Box>
        </Box>
    );
}

// ============================================================================
// Group head (shared by the virtual and non-virtual paths)
// ============================================================================

function LibraryGroupHead({ label, count, summary, styles }: { label: string; count: number; summary: string | undefined; styles: SlotStyles }) {
    const words = useFormatters();
    return (
        <Box css={styles.groupHead}>
            <Box as="span" css={styles.groupLabel}>{label}</Box>
            <Box as="span" css={styles.groupSummary}>{summary ?? words.number(count)}</Box>
        </Box>
    );
}

// ============================================================================
// Toolbar controls — the grouping, the secondary facts and the filter, each a
// menu; a gallery's layout switch
// ============================================================================

/** The Library's own fold ranks, after every step of its slice rail's: the
 *  caption goes, the secondary facts and the filter fold to their icons,
 *  then the grouping does, and last the search box narrows and drops its
 *  key cap. The layout switch never folds. */
const LIBRARY_RANK = {
    hint: HOST_RANK,
    menus: HOST_RANK + 1,
    group: HOST_RANK + 2,
    searchMid: HOST_RANK + 3,
    searchNarrow: HOST_RANK + 4,
} as const;

interface LibraryOption {
    key: string;
    label: string;
}

/** `GROUP · <the grouping>` — folded, its icon, the words its tooltip —
 *  opening a menu of every grouping and none. */
function LibraryGroupMenu({ options, active, onPick, compact, styles }: {
    options: readonly LibraryOption[];
    active: string | null;
    onPick: (key: string | null) => void;
    compact: boolean;
    styles: SlotStyles;
}) {
    const current = options.find(o => o.key === active);
    const choices: LibraryOption[] = [...options, { key: NO_GROUP, label: "None" }];
    const checked = active ?? NO_GROUP;
    const words = `Group · ${current?.label ?? "None"}`;
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-start" }}
            onSelect={(d) => onPick(d.value === NO_GROUP ? null : d.value)}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={styles.groupTrigger} aria-label="Group by" title={compact ? words : undefined}>
                    {compact ? <FontAwesomeIcon icon={faLayerGroup} /> : words}
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {choices.map(o => (
                            <ChakraMenu.Item key={o.key} value={o.key} aria-checked={o.key === checked}>
                                <Box as="span" css={styles.menuCheck}>
                                    {o.key === checked && <FontAwesomeIcon icon={faCheck} />}
                                </Box>
                                {o.label}
                            </ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/** The secondary facts a card shows, toggled in a menu that stays open —
 *  folded, the trigger is its icon, the word its name and tooltip. */
function LibraryDimMenu({ options, active, onToggle, compact, styles }: {
    options: readonly LibraryOption[];
    active: readonly string[];
    onToggle: (key: string) => void;
    compact: boolean;
    styles: SlotStyles;
}) {
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }} closeOnSelect={false}
            onSelect={(d) => onToggle(d.value)}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={styles.dimTrigger}
                    {...(compact ? { "aria-label": "Secondary", title: "Secondary" } : {})}>
                    <FontAwesomeIcon icon={faSliders} />
                    {!compact && "Secondary"}
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {options.map(o => (
                            <ChakraMenu.Item key={o.key} value={o.key} aria-checked={active.includes(o.key)}>
                                <Box as="span" css={styles.menuCheck}>
                                    {active.includes(o.key) && <FontAwesomeIcon icon={faCheck} />}
                                </Box>
                                {o.label}
                            </ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/** The Filter menu's value for clearing every checked value — a facet value's item is a JSON pair, so none can be it. */
const CLEAR_FILTERS = "\u0000clear";

/**
 * `Filter`, opening a menu of each facet's values: checking values keeps the
 * cards that hold one of them, in every facet with a value checked. It stays
 * open while values are checked. Folded, the trigger is its icon and the
 * count checked, the words its name and tooltip.
 */
function LibraryFilterMenu({ options, values, active, onToggle, onClear, compact, styles }: {
    options: readonly LibraryOption[];
    values: ReadonlyMap<string, readonly string[]>;
    active: Readonly<Record<string, readonly string[]>>;
    onToggle: (facet: string, value: string) => void;
    onClear: () => void;
    compact: boolean;
    styles: SlotStyles;
}) {
    const words = useFormatters();
    const checked = options.reduce((n, o) => n + (active[o.key]?.length ?? 0), 0);
    const count = checked > 0 ? words.number(checked) : "";
    const label = `Filter${count !== "" ? ` · ${count}` : ""}`;
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }} closeOnSelect={false}
            onSelect={(d) => {
                if (d.value === CLEAR_FILTERS) { onClear(); return; }
                const [facet, value] = JSON.parse(d.value) as [string, string];
                onToggle(facet, value);
            }}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={styles.dimTrigger}
                    {...(compact ? { "aria-label": label, title: label } : {})}>
                    <FontAwesomeIcon icon={faFilter} />
                    {compact ? count : label}
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {options.map(o => (
                            <ChakraMenu.ItemGroup key={o.key}>
                                <ChakraMenu.ItemGroupLabel>{o.label}</ChakraMenu.ItemGroupLabel>
                                {(values.get(o.key) ?? []).map(value => {
                                    const on = active[o.key]?.includes(value) ?? false;
                                    return (
                                        <ChakraMenu.Item key={value} value={JSON.stringify([o.key, value])} aria-checked={on}>
                                            <Box as="span" css={styles.menuCheck}>
                                                {on && <FontAwesomeIcon icon={faCheck} />}
                                            </Box>
                                            {value}
                                        </ChakraMenu.Item>
                                    );
                                })}
                            </ChakraMenu.ItemGroup>
                        ))}
                        {checked > 0 && (
                            <ChakraMenu.Item value={CLEAR_FILTERS}>
                                <Box as="span" css={styles.menuCheck} />
                                Clear filters
                            </ChakraMenu.Item>
                        )}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/** A gallery's layouts, in the switch's order. */
const LAYOUTS: ReadonlyArray<{ key: LibraryLayout; label: string; icon: IconDefinition }> = [
    { key: "grid", label: "Grid view", icon: faGrip },
    { key: "list", label: "List view", icon: faList },
];

/**
 * A gallery's Grid · List switch — the shared segment strip (`seg`), a radio
 * group: one tab stop, on the checked layout; ← / → and Home / End move and
 * pick, and a press picks. A gallery's toolbar draws it, and so does a host
 * whose one toolbar serves several galleries (`toolbar: false`).
 *
 * @param props - The layout it shows checked, and what a pick calls
 * @returns The switch
 */
export function LibraryLayoutSwitch({ layout, onPick }: { layout: LibraryLayout; onPick: (layout: LibraryLayout) => void }) {
    const seg = useSlotRecipe({ key: "seg" })() as SlotStyles;
    return (
        <Box css={seg.root} role="radiogroup" aria-label="Layout" data-library-layout=""
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                radioGroupKey(e, (j) => {
                    const next = LAYOUTS[j];
                    if (next !== undefined && next.key !== layout) onPick(next.key);
                });
            }}>
            {LAYOUTS.map(l => (
                <chakra.button key={l.key} type="button" css={seg.item} role="radio"
                    aria-checked={l.key === layout} aria-label={l.label} title={l.label}
                    tabIndex={l.key === layout ? 0 : -1} data-state={l.key === layout ? "on" : undefined}
                    onClick={() => onPick(l.key)}>
                    <FontAwesomeIcon icon={l.icon} />
                </chakra.button>
            ))}
        </Box>
    );
}

// ============================================================================
// Library core
// ============================================================================

interface LibraryCoreProps extends EastChakraLibraryProps {
    /** The slice rail: its affordances join the toolbar's row. A `search`
     *  among them narrows the fed rows, so the built-in search is not drawn. */
    rail?: { slice: SliceBindValue; kinds: readonly string[] } | undefined;
}

function LibraryCore({ value, storageKey, rail, renderMedia }: LibraryCoreProps) {
    const styles = useSlotRecipe({ key: "library" })() as SlotStyles;
    const kbd = useRecipe({ key: "kbd" });
    // Counts, in the app's locale (#850).
    const words = useFormatters();

    const groupOptions = value.groupOptions;
    const dimOptions = value.dimOptions;
    const dimOrder = useMemo(() => dimOptions.map(d => d.key), [dimOptions]);

    const { state: toolbar, setState: setToolbar } = usePersistedState<LibraryToolbarState>(`${storageKey}.toolbar`, {
        groupKey: groupOptions[0]?.key ?? null,
        activeDims: [...value.defaultDimensions],
        filters: {},
        layout: getSomeorUndefined(value.layout)?.type,
    });
    const [query, setQuery] = useState("");
    const filterOptions = value.filterOptions;
    const activeFilters = useMemo(() => toolbar.filters ?? {}, [toolbar.filters]);

    const onCardClickFn = useMemo(() => getSomeorUndefined(value.onCardClick), [value.onCardClick]);
    const handleCardClick = useCallback((key: string) => {
        if (onCardClickFn) queueMicrotask(() => onCardClickFn(key));
    }, [onCardClickFn]);

    const frameSink = useDropSink("library", value.id);

    const setGroup = useCallback((key: string | null) => {
        setToolbar(prev => ({ ...prev, groupKey: key }));
    }, [setToolbar]);
    const toggleDim = useCallback((key: string) => {
        setToolbar(prev => ({
            ...prev,
            activeDims: prev.activeDims.includes(key)
                ? prev.activeDims.filter(k => k !== key)
                : [...prev.activeDims, key],
        }));
    }, [setToolbar]);

    const toggleFilter = useCallback((facet: string, checked: string) => {
        setToolbar(prev => {
            const current = prev.filters?.[facet] ?? [];
            const next = current.includes(checked) ? current.filter(v => v !== checked) : [...current, checked];
            return { ...prev, filters: { ...prev.filters, [facet]: next } };
        });
    }, [setToolbar]);
    const clearFilters = useCallback(() => {
        setToolbar(prev => ({ ...prev, filters: {} }));
    }, [setToolbar]);

    // Each facet's values, in the order the cards first hold them.
    const facetValues = useMemo(() => {
        const out = new Map<string, string[]>();
        for (const option of filterOptions) {
            const seen = new Set<string>();
            for (const item of value.items) for (const v of item.facets.get(option.key) ?? []) seen.add(v);
            out.set(option.key, [...seen]);
        }
        return out;
    }, [filterOptions, value.items]);

    const lowerQuery = query.trim().toLowerCase();
    // A card hides when the search does not match it, or when a facet with
    // values checked holds none of them.
    const hides = useCallback((item: LibraryItemValue) => {
        if (lowerQuery !== "" && !itemSearchText(item).includes(lowerQuery)) return true;
        for (const option of filterOptions) {
            const checked = activeFilters[option.key] ?? [];
            if (checked.length === 0) continue;
            const held = item.facets.get(option.key) ?? [];
            if (!held.some(v => checked.includes(v))) return true;
        }
        return false;
    }, [lowerQuery, filterOptions, activeFilters]);
    const showAll = useCallback(() => { setQuery(""); clearFilters(); }, [clearFilters]);

    // Group items preserving first-appearance order; null group key = flat.
    // The quick search and the Filter menu HIDE unmatched cards (the footer
    // carries the hidden count + Show all); only the explicit `filtered` face
    // field dims — the host's deliberate Slice.partition de-emphasis.
    // Group-head summaries come from the root-level `groupSummaries` dict.
    const groups = useMemo<LibraryGroup[]>(() => {
        const groupKey = toolbar.groupKey;
        const summaries = groupKey !== null ? value.groupSummaries.get(groupKey) : undefined;
        const out = new Map<string, LibraryGroup>();
        for (const item of value.items) {
            if (hides(item)) continue;
            const label = (groupKey !== null ? item.groups.get(groupKey) : undefined) ?? "";
            let entry = out.get(label);
            if (entry === undefined) {
                entry = { label, summary: summaries?.get(label), items: [] };
                out.set(label, entry);
            }
            entry.items.push(item);
        }
        return [...out.values()];
    }, [value.items, value.groupSummaries, toolbar.groupKey, hides]);

    const hiddenCount = useMemo(
        () => value.items.filter(hides).length,
        [value.items, hides],
    );
    const noun = getSomeorUndefined(value.noun);

    const hint = getSomeorUndefined(value.hint);
    const addLabel = getSomeorUndefined(value.addLabel);
    const onAddFn = useMemo(() => getSomeorUndefined(value.onAdd), [value.onAdd]);
    const handleAdd = useCallback(() => {
        if (onAddFn) queueMicrotask(() => onAddFn());
    }, [onAddFn]);

    // ── Scroll region + virtualization ──────────────────────────────────────
    // With a height/maxHeight constraint the card grid becomes the Library's
    // own scroll region and rows virtualize; unconstrained, the component
    // grows to content height (the pre-#258 behaviour, ancestor scrolls).
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    // Uniform sizing (#320) — `"fill"` → 100% of the parent box.
    const height = parseCssSize(style ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined);
    const scrollable = height !== undefined || maxHeight !== undefined;
    // A gallery's layout: where its author starts it, then the viewer's pick
    // from the toolbar's switch, kept with the rest of the toolbar. An
    // author's layout that moves (an expression) moves it. Without its
    // toolbar there is no switch: the host that drives the layout says it.
    const gallery = getSomeorUndefined(value.variant)?.type === "gallery";
    const authorLayout = getSomeorUndefined(value.layout)?.type;
    const lastAuthorLayout = useRef(authorLayout);
    useEffect(() => {
        if (authorLayout === lastAuthorLayout.current) return;
        lastAuthorLayout.current = authorLayout;
        if (authorLayout !== undefined) setToolbar(prev => ({ ...prev, layout: authorLayout }));
    }, [authorLayout, setToolbar]);
    const layout = (value.toolbar ? toolbar.layout : undefined) ?? authorLayout ?? "grid";
    const pickLayout = useCallback((next: LibraryLayout) => {
        setToolbar(prev => ({ ...prev, layout: next }));
    }, [setToolbar]);
    // Its columns, and where its media sits — at the start in a list,
    // whatever the grid puts it.
    const placement = layout === "list" ? "start" : (style ? getSomeorUndefined(style.mediaPlacement)?.type : undefined) ?? "top";
    const galleryColumns = Number((style ? getSomeorUndefined(style.columns) : undefined) ?? 3n);
    const mediaSize = parseCssSize(style ? getSomeorUndefined(style.mediaSize) : undefined);
    // A gallery's cards are as tall as their media and facts, so it mounts every one.
    const virtualEnabled = !gallery && scrollable && (style ? getSomeorUndefined(style.virtualization) : undefined) !== false;

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [columns, setColumns] = useState(1);
    useEffect(() => {
        if (!scrollable) return;
        const el = scrollRef.current;
        if (el === null) return;
        const measure = () => setColumns(libraryColumnsFor(el.clientWidth));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [scrollable]);

    const entries = useMemo(
        () => (virtualEnabled ? libraryEntries(groups, columns) : []),
        [virtualEnabled, groups, columns],
    );

    const virtualizer = useVirtualizer({
        count: entries.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => (entries[index]?.kind === "groupHead" ? 36 : 56),
        paddingStart: VIRTUAL_PAD_START,
        paddingEnd: VIRTUAL_PAD_END,
        overscan: 4,
        // measureElement corrects the estimate — card rows vary with the
        // toggled dimensions; group heads differ from card rows.
        measureElement: (el) => el?.getBoundingClientRect().height,
    });

    // Persist the top visible ENTRY INDEX, debounced; never a pixel scrollTop
    // (#143 convention — a clamped index survives data and column changes).
    const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const handleScrollPersist = useCallback(() => {
        if (!virtualEnabled) return;
        if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
        scrollSaveTimer.current = setTimeout(() => {
            const topIndex = virtualizer.getVirtualItems()[0]?.index ?? 0;
            setToolbar(prev => (prev.scrollIndex === topIndex ? prev : { ...prev, scrollIndex: topIndex }));
        }, 150);
    }, [virtualEnabled, virtualizer, setToolbar]);

    const didRestoreScroll = useRef(false);
    useEffect(() => {
        if (!virtualEnabled || didRestoreScroll.current || entries.length === 0) return;
        didRestoreScroll.current = true;
        const saved = toolbar.scrollIndex ?? 0;
        if (saved <= 0) return;
        const index = Math.min(saved, entries.length - 1);
        // rAF so the scroll container has a measured height before scrolling.
        requestAnimationFrame(() => virtualizer.scrollToIndex(index, { align: "start" }));
    // Restore once, as soon as entries exist; deliberately not re-run on later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [virtualEnabled, entries.length]);

    const searchable = value.searchable && !(rail?.kinds.includes("search") ?? false);
    // The rail's affordances, as items of the toolbar's one row.
    const railItems = useSliceToolbarItems(rail?.slice, [{ key: "rail", kinds: rail?.kinds ?? [] }]);

    // ⌘ / focuses the search box of the Library last pointed at or focused.
    const searchRef = useRef<HTMLInputElement | null>(null);
    const [self] = useState(() => Symbol("library"));
    useEffect(() => {
        if (!searchable) return;
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key !== "/") return;
            searchOwner ??= self;
            const input = searchRef.current;
            if (searchOwner !== self || input === null) return;
            e.preventDefault();
            input.focus();
            input.select();
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (searchOwner === self) searchOwner = undefined;
        };
    }, [searchable, self]);
    const claimSearch = useCallback(() => {
        if (searchable) searchOwner = self;
    }, [searchable, self]);

    // The search box at a width the toolbar folds it to — one element in
    // every form, so the field keeps its focus and its text as the row folds.
    const searchBox = (size: "wide" | "mid" | "narrow") => (
        <Box css={styles.searchBox} data-size={size}>
            <Box as="span" css={styles.searchIcon} aria-hidden>
                <FontAwesomeIcon icon={faMagnifyingGlass} />
            </Box>
            <chakra.input
                ref={searchRef}
                css={styles.searchInput}
                placeholder={`Search ${words.number(value.items.length)} ${value.items.length === 1 ? (noun?.singular ?? "item") : (noun?.plural ?? "items")}…`}
                aria-label="Search library"
                aria-keyshortcuts="Meta+/ Control+/"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Escape" && query !== "") {
                        e.preventDefault();
                        setQuery("");
                    }
                }}
            />
            {query !== "" ? (
                <chakra.button type="button" css={styles.searchClear} aria-label="Clear search" onClick={() => setQuery("")}>
                    <FontAwesomeIcon icon={faXmark} />
                </chakra.button>
            ) : (
                <chakra.kbd css={[kbd({}), styles.searchKbd]} aria-hidden>⌘ /</chakra.kbd>
            )}
        </Box>
    );
    const checkedFilters = filterOptions.reduce((n, o) => n + (activeFilters[o.key]?.length ?? 0), 0);
    // One row, the shared toolbar's: the rail and the search, then the
    // grouping; at the row's end the caption, the secondary facts, the
    // filter and a gallery's layout switch — folded on one ladder, in the
    // order LIBRARY_RANK gives.
    const toolbarItems: ReadonlyArray<ToolbarItem | false | undefined> = [
        ...railItems,
        searchable && {
            key: "search",
            forms: [searchBox("wide"), searchBox("mid"), searchBox("narrow")],
            rank: [LIBRARY_RANK.searchMid, LIBRARY_RANK.searchNarrow],
        },
        groupOptions.length > 0 && {
            key: "group",
            forms: [
                <LibraryGroupMenu options={groupOptions} active={toolbar.groupKey} onPick={setGroup} compact={false} styles={styles} />,
                <LibraryGroupMenu options={groupOptions} active={toolbar.groupKey} onPick={setGroup} compact styles={styles} />,
            ],
            rank: LIBRARY_RANK.group,
            version: toolbar.groupKey,
        },
        hint !== undefined && {
            key: "hint",
            side: "end",
            forms: [<Box as="span" css={styles.hint}>{hint}</Box>, null],
            rank: LIBRARY_RANK.hint,
            version: hint,
        },
        dimOptions.length > 0 && {
            key: "dims",
            side: "end",
            forms: [
                <LibraryDimMenu options={dimOptions} active={toolbar.activeDims} onToggle={toggleDim} compact={false} styles={styles} />,
                <LibraryDimMenu options={dimOptions} active={toolbar.activeDims} onToggle={toggleDim} compact styles={styles} />,
            ],
            rank: LIBRARY_RANK.menus,
        },
        filterOptions.length > 0 && {
            key: "filter",
            side: "end",
            forms: [
                <LibraryFilterMenu options={filterOptions} values={facetValues} active={activeFilters}
                    onToggle={toggleFilter} onClear={clearFilters} compact={false} styles={styles} />,
                <LibraryFilterMenu options={filterOptions} values={facetValues} active={activeFilters}
                    onToggle={toggleFilter} onClear={clearFilters} compact styles={styles} />,
            ],
            rank: LIBRARY_RANK.menus,
            version: checkedFilters,
        },
        gallery && {
            key: "layout",
            side: "end",
            forms: [<LibraryLayoutSwitch layout={layout} onPick={pickLayout} />],
        },
    ];

    const galleryGridProps = {
        css: styles.galleryGrid,
        "data-layout": layout,
        "data-media": placement,
        style: {
            "--library-columns": String(galleryColumns),
            ...(mediaSize !== undefined ? { "--library-media": mediaSize } : {}),
        } as CSSProperties,
    };
    // A gallery's add action is its dashed last card.
    const addCard = gallery && addLabel !== undefined ? (
        <chakra.button type="button" css={styles.galleryAdd} onClick={handleAdd} data-library-add="">
            <Box as="span" css={styles.galleryAddIcon} aria-hidden>
                <FontAwesomeIcon icon={faPlus} />
            </Box>
            <Box as="span" css={styles.galleryAddLabel}>{addLabel}</Box>
        </chakra.button>
    ) : null;

    const bodyContent = gallery ? (
        groups.length === 0 ? (
            addCard !== null && <Box {...galleryGridProps}>{addCard}</Box>
        ) : groups.map((group, i) => (
            <Box key={group.label || "_flat"} css={styles.group}>
                {group.label !== "" && (
                    <LibraryGroupHead label={group.label} count={group.items.length} summary={group.summary} styles={styles} />
                )}
                <Box {...galleryGridProps}>
                    {group.items.map(item => (
                        <LibraryGalleryCard
                            key={item.key}
                            libraryId={value.id}
                            item={item}
                            dimOrder={dimOrder}
                            activeDims={toolbar.activeDims}
                            filtered={item.filtered}
                            styles={styles}
                            onCardClick={onCardClickFn ? handleCardClick : undefined}
                            storageKey={storageKey}
                            renderMedia={renderMedia}
                        />
                    ))}
                    {i === groups.length - 1 && addCard}
                </Box>
            </Box>
        ))
    ) : virtualEnabled ? (
        <Box css={styles.canvas} style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map(virtualItem => {
                const entry = entries[virtualItem.index]!;
                return (
                    <Box
                        key={virtualItem.key}
                        ref={virtualizer.measureElement}
                        data-index={virtualItem.index}
                        css={styles.row}
                        {...(entry.kind === "groupHead" ? { "data-head": "" } : { "data-cards": "" })}
                        {...(virtualItem.index === 0 ? { "data-first": "" } : {})}
                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                        {entry.kind === "groupHead" ? (
                            <LibraryGroupHead label={entry.label} count={entry.count} summary={entry.summary} styles={styles} />
                        ) : (
                            <Box css={styles.rowGrid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                                {entry.items.map(item => (
                                    <LibraryCard
                                        key={item.key}
                                        libraryId={value.id}
                                        item={item}
                                        dimOrder={dimOrder}
                                        activeDims={toolbar.activeDims}
                                        filtered={item.filtered}
                                        styles={styles}
                                        onCardClick={onCardClickFn ? handleCardClick : undefined}
                                    />
                                ))}
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Box>
    ) : (
        groups.map(group => (
            <Box key={group.label || "_flat"} css={styles.group}>
                {group.label !== "" && (
                    <LibraryGroupHead label={group.label} count={group.items.length} summary={group.summary} styles={styles} />
                )}
                <Box css={styles.grid}>
                    {group.items.map(item => (
                        <LibraryCard
                            key={item.key}
                            libraryId={value.id}
                            item={item}
                            dimOrder={dimOrder}
                            activeDims={toolbar.activeDims}
                            filtered={item.filtered}
                            styles={styles}
                            onCardClick={onCardClickFn ? handleCardClick : undefined}
                        />
                    ))}
                </Box>
            </Box>
        ))
    );

    return (
        <Box
            css={styles.root}
            ref={frameSink}
            data-library={value.id}
            {...(scrollable ? { "data-scrollable": "" } : {})}
            // Without its toolbar the Library is a host's: its cards sit in the host's frame.
            {...(value.toolbar ? {} : { "data-hosted": "" })}
            style={scrollable ? { height, maxHeight } : undefined}
            onPointerEnter={claimSearch}
            onFocus={claimSearch}
        >
            {value.toolbar && toolbarItems.some(Boolean) && (
                <Box css={styles.toolbar} data-slot="toolbar">
                    <Toolbar items={toolbarItems} />
                </Box>
            )}
            <Box
                ref={scrollRef}
                css={scrollable ? [styles.body, virtualScrollbarCss] : styles.body}
                {...(scrollable ? { "data-scrollable": "" } : {})}
                {...(virtualEnabled ? { "data-virtual": "" } : {})}
                onScroll={handleScrollPersist}
            >
                {bodyContent}
            </Box>
            {(hiddenCount > 0 || (!gallery && addLabel !== undefined)) && (
                <Box css={styles.footer}>
                    {hiddenCount > 0 && (
                        <Box as="span" css={styles.hiddenNote}>
                            {words.number(hiddenCount)} hidden by filter ·{" "}
                            <Box as="button" css={styles.showAll} onClick={showAll}>Show all</Box>
                        </Box>
                    )}
                    {!gallery && addLabel !== undefined && (
                        <Box as="button" css={styles.addAction} marginLeft="auto" onClick={handleAdd}>
                            + {addLabel}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Library — slice chrome wrapper
// ============================================================================

/**
 * Renders an East UI Library value — a draggable palette of assignable
 * items. Registers as the DnD **source** under `value.id` (cards start
 * `add` drags; the frame is the return-to-palette sink). The quick search
 * hides unmatched cards (footer: hidden count + Show all); the `filtered`
 * face field dims a card instead — the host's deliberate de-emphasis.
 *
 * Without `slice` it renders the bare palette. With the `slice` chrome
 * option it renders the frame chassis itself — the listed affordances join
 * the Library's one toolbar row, folding on its ladder, and a derived-count
 * footer. Chrome only: the items are whatever the host fed
 * (`Slice.rows([RowType], slice)` or `Slice.partition` + `filtered`
 * upstream); the Library never narrows its own data.
 */
export const EastChakraLibrary = memo(function EastChakraLibrary(props: EastChakraLibraryProps) {
    const chrome = getSomeorUndefined(props.value.slice as never) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const slice = chrome?.slice as SliceBindValue | undefined;
    useSliceReactivity(slice?.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })() as SlotStyles;
    // The footer's counts, in the app's locale (#850).
    const words = useFormatters();
    if (chrome === undefined || slice === undefined) return <LibraryCore {...props} />;

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const affordanceKinds = railAffordanceKinds(configuredKinds, state);
    const total = Number(slice.totalCount() as bigint);
    const result = Number(slice.resultCount() as bigint);
    const pct = total > 0 ? Math.round((1 - result / total) * 100) : 0;

    return (
        <Box css={{ ...frameStyles.root, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box css={{ ...frameStyles.frameBody, flex: "1 1 0%", minHeight: 0, overflow: "hidden" }}>
                <LibraryCore {...props} rail={{ slice, kinds: affordanceKinds }} />
            </Box>
            <Box css={{ ...frameStyles.frameFooter, flexShrink: 0 }}>
                <Box as="span" css={frameStyles.frameFooterStat}>{words.number(result)}</Box>
                <Box as="span">{`items · of ${words.number(total)}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${words.percent(pct / 100)}`}</Box>}
            </Box>
        </Box>
    );
}, (prev, next) => libraryEqual(prev.value, next.value) && prev.storageKey === next.storageKey && prev.renderMedia === next.renderMedia);
