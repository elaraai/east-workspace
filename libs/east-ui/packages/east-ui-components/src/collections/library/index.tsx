/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { type IconName } from "@fortawesome/fontawesome-svg-core";
import { equalFor, match, type ValueTypeOf } from "@elaraai/east";
import { Library, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useDragSourceItem, useDropSink } from "../../dnd/drag-layer";
import { SliceRailCluster } from "../../slice/rail";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { parseCssSize } from "../../style/parse-size.js";

const libraryEqual = equalFor(Library.Types.Library);

/** East Library value type. */
export type LibraryValue = ValueTypeOf<typeof Library.Types.Library>;

/** East Library item value type. */
export type LibraryItemValue = ValueTypeOf<typeof Library.Types.Item>;

export interface EastChakraLibraryProps {
    value: LibraryValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

interface LibraryToolbarState {
    groupKey: string | null;
    activeDims: string[];
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
/** Grid gap in px (`{spacing.3}`). */
const GRID_GAP = 12;
/** Horizontal grid padding in px (`{spacing.4}` each side). */
const GRID_PAD_X = 16;

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

interface LibraryCardProps {
    libraryId: string;
    item: LibraryItemValue;
    dimOrder: string[];
    activeDims: string[];
    filtered: boolean;
    styles: SlotStyles;
}

function LibraryCard({ libraryId, item, dimOrder, activeDims, filtered, styles }: LibraryCardProps) {
    const status = getSomeorUndefined(item.status);
    const sublabel = getSomeorUndefined(item.sublabel);
    const icon = getSomeorUndefined(item.icon);
    const draggable = item.draggable && !filtered;
    const visibleDims = dimOrder.filter(k => activeDims.includes(k) && item.dims.get(k) !== undefined);
    const compact = sublabel === undefined && visibleDims.length === 0;

    const from = useMemo(() => ({ library: libraryId, key: item.key, label: item.label }), [libraryId, item.key, item.label]);
    const ghost = useMemo(() => (
        <Box css={styles.ghost}>{item.label}</Box>
    ), [styles.ghost, item.label]);
    const onPointerDown = useDragSourceItem(from, ghost, !draggable);

    return (
        <Box
            css={styles.card}
            onPointerDown={onPointerDown}
            {...(filtered ? { "data-filtered": "" } : {})}
            {...(draggable && onPointerDown ? { "data-draggable": "" } : {})}
            {...(compact ? { "data-compact": "" } : {})}
        >
            {draggable && onPointerDown && (
                <Box as="span" css={styles.grip}>
                    <FontAwesomeIcon icon={faGripVertical} />
                </Box>
            )}
            {icon && (
                <Box css={styles.iconTile}>
                    <FontAwesomeIcon icon={["fas", icon as IconName]} />
                </Box>
            )}
            <Box css={styles.cardBody}>
                <Box css={styles.cardHead}>
                    <Box as="span" css={styles.cardLabel}>{item.label}</Box>
                    {status && (
                        <Box as="span" css={styles.statusPill} data-tone={status.tone.type}>
                            {status.label}
                        </Box>
                    )}
                </Box>
                {sublabel && <Box css={styles.cardSublabel}>{sublabel}</Box>}
                {visibleDims.map(key => {
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
                })}
            </Box>
        </Box>
    );
}

// ============================================================================
// Group head (shared by the virtual and non-virtual paths)
// ============================================================================

function LibraryGroupHead({ label, count, summary, styles }: { label: string; count: number; summary: string | undefined; styles: SlotStyles }) {
    return (
        <Box css={styles.groupHead}>
            <Box as="span" css={styles.groupLabel}>{label} · {count}</Box>
            {summary !== undefined && (
                <Box as="span" css={styles.groupSummary}>{summary}</Box>
            )}
        </Box>
    );
}

// ============================================================================
// Library core
// ============================================================================

interface LibraryCoreProps extends EastChakraLibraryProps {
    /** Set when the slice rail mounts a `search` affordance — the rail's
     *  search narrows the fed rows, so the built-in input is suppressed. */
    suppressSearch?: boolean;
}

function LibraryCore({ value, storageKey, suppressSearch }: LibraryCoreProps) {
    const styles = useSlotRecipe({ key: "library" })() as SlotStyles;
    // Toolbar controls share the slice vocabulary: toggle pills are the
    // `chip` recipe (brand tone when active — the cohort-pill precedent),
    // the quick search wears the sliceFrame `searchPill` chrome.
    const chip = useRecipe({ key: "chip" });
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })() as SlotStyles;

    const groupOptions = value.groupOptions;
    const dimOptions = value.dimOptions;
    const dimOrder = useMemo(() => dimOptions.map(d => d.key), [dimOptions]);

    const { state: toolbar, setState: setToolbar } = usePersistedState<LibraryToolbarState>(`${storageKey}.toolbar`, {
        groupKey: groupOptions[0]?.key ?? null,
        activeDims: [...value.defaultDimensions],
    });
    const [query, setQuery] = useState("");

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

    const lowerQuery = query.trim().toLowerCase();
    const queryHides = useCallback(
        (item: LibraryItemValue) => lowerQuery !== "" && !itemSearchText(item).includes(lowerQuery),
        [lowerQuery],
    );

    // Group items preserving first-appearance order; null group key = flat.
    // The quick search HIDES unmatched cards (the footer carries the hidden
    // count + Show all); only the explicit `filtered` face field dims — the
    // host's deliberate Slice.partition de-emphasis. Group-head summaries
    // come from the root-level `groupSummaries` dict.
    const groups = useMemo<LibraryGroup[]>(() => {
        const groupKey = toolbar.groupKey;
        const summaries = groupKey !== null ? value.groupSummaries.get(groupKey) : undefined;
        const out = new Map<string, LibraryGroup>();
        for (const item of value.items) {
            if (queryHides(item)) continue;
            const label = (groupKey !== null ? item.groups.get(groupKey) : undefined) ?? "";
            let entry = out.get(label);
            if (entry === undefined) {
                entry = { label, summary: summaries?.get(label), items: [] };
                out.set(label, entry);
            }
            entry.items.push(item);
        }
        return [...out.values()];
    }, [value.items, value.groupSummaries, toolbar.groupKey, queryHides]);

    const hiddenCount = useMemo(
        () => value.items.filter(queryHides).length,
        [value.items, queryHides],
    );

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
    const virtualEnabled = scrollable && (style ? getSomeorUndefined(style.virtualization) : undefined) !== false;

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
        estimateSize: (index) => (entries[index]?.kind === "groupHead" ? 33 : 104),
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

    const searchable = value.searchable && suppressSearch !== true;

    const bodyContent = virtualEnabled ? (
        <Box css={styles.canvas} style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map(virtualItem => {
                const entry = entries[virtualItem.index]!;
                return (
                    <Box
                        key={virtualItem.key}
                        ref={virtualizer.measureElement}
                        data-index={virtualItem.index}
                        css={styles.row}
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
            style={scrollable ? { height, maxHeight } : undefined}
        >
            {hint !== undefined && (
                <Box css={styles.header}>
                    <Box as="span" css={styles.hint}>{hint}</Box>
                </Box>
            )}
            {(searchable || groupOptions.length > 0 || dimOptions.length > 0) && (
                <Box css={styles.toolbar}>
                    {/* css ARRAY — both objects are `@layer recipes`-wrapped; an
                      * object spread would collide on that key and drop the pill. */}
                    {searchable && (
                        <Box css={[frameStyles.searchPill, styles.search]}>
                            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ width: 10, height: 10 }} />
                            <Box
                                as="input"
                                // @ts-expect-error chakra polymorphic input props
                                placeholder="Search…"
                                aria-label="Search library"
                                value={query}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                            />
                            {query !== "" && (
                                <Box as="button" css={frameStyles.searchClear} aria-label="Clear search" onClick={() => setQuery("")}>
                                    <FontAwesomeIcon icon={faXmark} style={{ width: 9, height: 9 }} />
                                </Box>
                            )}
                        </Box>
                    )}
                    {groupOptions.length > 0 && (
                        <Box css={styles.segGroup}>
                            <Box as="span" css={styles.segLabel}>Group by</Box>
                            {groupOptions.map(g => (
                                <Box
                                    as="button"
                                    key={g.key}
                                    css={{ ...chip({ tone: toolbar.groupKey === g.key ? "brand" : "neutral", size: "sm" }), cursor: "pointer" }}
                                    aria-pressed={toolbar.groupKey === g.key}
                                    onClick={() => setGroup(g.key)}
                                >
                                    {g.label}
                                </Box>
                            ))}
                            <Box
                                as="button"
                                css={{ ...chip({ tone: toolbar.groupKey === null ? "brand" : "neutral", size: "sm" }), cursor: "pointer" }}
                                aria-pressed={toolbar.groupKey === null}
                                onClick={() => setGroup(null)}
                            >
                                None
                            </Box>
                        </Box>
                    )}
                    {dimOptions.length > 0 && (
                        <Box css={styles.segGroup} marginLeft="auto">
                            <Box as="span" css={styles.segLabel}>Secondary</Box>
                            {dimOptions.map(d => (
                                <Box
                                    as="button"
                                    key={d.key}
                                    css={{ ...chip({ tone: toolbar.activeDims.includes(d.key) ? "brand" : "neutral", size: "sm" }), cursor: "pointer" }}
                                    aria-pressed={toolbar.activeDims.includes(d.key)}
                                    onClick={() => toggleDim(d.key)}
                                >
                                    {d.label}
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            )}
            <Box
                ref={scrollRef}
                css={styles.body}
                {...(scrollable ? { "data-scrollable": "" } : {})}
                onScroll={handleScrollPersist}
            >
                {bodyContent}
            </Box>
            {(hiddenCount > 0 || addLabel !== undefined) && (
                <Box css={styles.footer}>
                    {hiddenCount > 0 && (
                        <Box as="span" css={styles.hiddenNote}>
                            {hiddenCount} hidden by filter ·{" "}
                            <Box as="button" css={styles.showAll} onClick={() => setQuery("")}>Show all</Box>
                        </Box>
                    )}
                    {addLabel !== undefined && (
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
 * option it renders the frame chassis itself — a rail mounting the listed
 * affordances (the shared `SliceRailCluster` ladder) and a derived-count
 * footer. Chrome only: the items are whatever the host fed
 * (`Slice.rows([RowType], slice)` or `Slice.partition` + `filtered`
 * upstream); the Library never narrows its own data.
 */
export const EastChakraLibrary = memo(function EastChakraLibrary(props: EastChakraLibraryProps) {
    const chrome = getSomeorUndefined(props.value.slice as never) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const slice = chrome?.slice as ValueTypeOf<typeof SliceInternal.Types.Bind> | undefined;
    useSliceReactivity(slice?.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })() as SlotStyles;
    if (chrome === undefined || slice === undefined) return <LibraryCore {...props} />;

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const affordanceKinds = state.cohorts.length > 0 && !configuredKinds.includes("cohort")
        ? [...configuredKinds, "cohort"]
        : configuredKinds;
    const total = Number(slice.totalCount() as bigint);
    const result = Number(slice.resultCount() as bigint);
    const pct = total > 0 ? Math.round((1 - result / total) * 100) : 0;

    return (
        <Box css={{ ...frameStyles.root, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box css={{ ...frameStyles.frameEyebrow, flexShrink: 0 }}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            <Box css={{ ...frameStyles.frameBody, flex: "1 1 0%", minHeight: 0, overflow: "hidden" }}>
                <LibraryCore {...props} suppressSearch={affordanceKinds.includes("search")} />
            </Box>
            <Box css={{ ...frameStyles.frameFooter, flexShrink: 0 }}>
                <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                <Box as="span">{`items · of ${total.toLocaleString()}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
            </Box>
        </Box>
    );
}, (prev, next) => libraryEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
