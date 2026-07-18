/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraDeck` — renderer for the Deck grouped card collection (#359).
 *
 * Cards reuse the Library card grammar (the `library` slot recipe's
 * iconTile / label / status-pill / meter / chips slots) so palettes and
 * decks read as one family; the `deck` recipe adds the grid/list layout,
 * clickable-card chrome, tone accent bars, collapsible group heads, the
 * detail panel and the hover peek. Filtering and search flow through the
 * SLICE interface (rail cluster + derived-count footer, like Table) —
 * the deck has no bespoke search.
 *
 * Cards carry two states: the LIST face (summary) and an optional VIEW
 * state — items with a `detail` component open it in a fixed side panel
 * (a full-screen sheet on phones) with prev/next traversal, Esc / scrim
 * close, and `onOpen` / `onClose` callbacks. Items with a `hover`
 * component show a floating peek on hover-capable pointers.
 *
 * Layout is container-first: the grid uses
 * `repeat(auto-fill, minmax(minCardWidth, 1fr))`, so desktop shows rows of
 * wrapping cards per group and phones collapse to one column with no
 * breakpoint logic. Virtualization is deferred (#359 fast-follow) — a
 * height-constrained Deck scrolls its body.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, type IconName } from "@fortawesome/fontawesome-svg-core";
import { faChevronDown, faChevronLeft, faChevronRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Deck, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useHoverCapable } from "../../contracts/adaptive.js";
import { parseCssSize } from "../../style/parse-size.js";
import { SliceRailCluster } from "../../slice/rail";
import { railAffordanceKinds } from "../../slice/rail-kinds.js";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";

const deckEqual = equalFor(Deck.Types.Deck);

/** East Deck value type. */
export type DeckValue = ValueTypeOf<typeof Deck.Types.Deck>;

/** East Deck item value type. */
export type DeckItemValue = ValueTypeOf<typeof Deck.Types.Item>;

export interface EastChakraDeckProps {
    value: DeckValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

/** Hover-peek intent delay (ms) — long enough to skip pass-through. */
const PEEK_DELAY = 300;

interface DeckToolbarState {
    groupKey: string | null;
    collapsed: string[];
}

interface DeckGroup {
    label: string;
    summary: string | undefined;
    items: DeckItemValue[];
}

/** A resolved FA solid icon, or undefined for unknown names. */
function solidIcon(name: string | undefined) {
    if (name === undefined) return undefined;
    const def = findIconDefinition({ prefix: "fas", iconName: name as IconName });
    return def ?? undefined;
}

// ============================================================================
// Card
// ============================================================================

function DeckCard({ item, styles, libStyles, open, activatable, onActivate, onHoverStart, onHoverEnd, storageKey }: {
    item: DeckItemValue;
    styles: SlotStyles;
    libStyles: SlotStyles;
    open: boolean;
    activatable: boolean;
    onActivate: (item: DeckItemValue) => void;
    onHoverStart: (item: DeckItemValue, e: React.MouseEvent) => void;
    onHoverEnd: () => void;
    storageKey: string;
}) {
    const icon = solidIcon(getSomeorUndefined(item.icon));
    const sublabel = getSomeorUndefined(item.sublabel);
    const status = getSomeorUndefined(item.status);
    const tone = getSomeorUndefined(item.tone);
    const face = getSomeorUndefined(item.face);
    const handleClick = useCallback(() => { onActivate(item); }, [onActivate, item]);

    return (
        <Box
            css={styles.card}
            data-clickable={activatable ? "" : undefined}
            data-filtered={item.filtered ? "" : undefined}
            data-tone={tone?.type}
            data-open={open ? "" : undefined}
            onMouseEnter={(e: React.MouseEvent) => onHoverStart(item, e)}
            onMouseLeave={onHoverEnd}
            {...(activatable
                ? { role: "button", tabIndex: 0, onClick: handleClick,
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } } }
                : {})}
        >
            {icon !== undefined && (
                <Box css={styles.cardIcon}><FontAwesomeIcon icon={icon} /></Box>
            )}
            <Box css={styles.cardBody}>
                <Box css={styles.cardHead}>
                    <Box as="span" css={styles.cardName}>{item.title}</Box>
                    {status !== undefined && (
                        <Box as="span" css={libStyles.statusPill} data-tone={status.tone.type}>{status.label}</Box>
                    )}
                </Box>
                {sublabel !== undefined && <Box as="span" css={styles.cardSub}>{sublabel}</Box>}
                {item.facts.map((fact, i) => {
                    const v = fact.value;
                    if (v.type === "meter") {
                        const pct = v.value.max > 0 ? Math.min(100, Math.max(0, (v.value.value / v.value.max) * 100)) : 0;
                        const text = getSomeorUndefined(v.value.text);
                        return (
                            <Box key={i} css={libStyles.meter}>
                                <Box css={libStyles.meterTrack}><Box css={libStyles.meterFill} style={{ width: `${pct}%` }} /></Box>
                                {text !== undefined && <Box as="span" css={libStyles.meterText}>{text}</Box>}
                            </Box>
                        );
                    }
                    if (v.type === "chips") {
                        return (
                            <Box key={i} css={libStyles.chips}>
                                {v.value.map((chipText, j) => <Box key={j} as="span" css={libStyles.chip}>{chipText}</Box>)}
                            </Box>
                        );
                    }
                    return <Box key={i} as="span" css={libStyles.dimText}>{v.value}</Box>;
                })}
                {face !== undefined && (
                    <Box css={styles.face}>
                        <EastChakraComponent value={face} storageKey={`${storageKey}.face.${item.key}`} />
                    </Box>
                )}
            </Box>
        </Box>
    );
}

// ============================================================================
// Core
// ============================================================================

function DeckCore({ value, storageKey }: EastChakraDeckProps) {
    const styles = useSlotRecipe({ key: "deck" })() as SlotStyles;
    const libStyles = useSlotRecipe({ key: "library" })() as SlotStyles;
    const chip = useRecipe({ key: "chip" });

    const groupOptions = value.groupOptions;
    const { state: toolbar, setState: setToolbar } = usePersistedState<DeckToolbarState>(`${storageKey}.toolbar`, {
        groupKey: groupOptions[0]?.key ?? null,
        collapsed: [],
    });

    const setGroup = useCallback((key: string | null) => {
        setToolbar(prev => ({ ...prev, groupKey: key, collapsed: [] }));
    }, [setToolbar]);
    const toggleCollapsed = useCallback((label: string) => {
        setToolbar(prev => ({
            ...prev,
            collapsed: prev.collapsed.includes(label)
                ? prev.collapsed.filter(l => l !== label)
                : [...prev.collapsed, label],
        }));
    }, [setToolbar]);

    // Group items preserving first-appearance order; null group key = flat.
    const groups = useMemo<DeckGroup[]>(() => {
        const groupKey = toolbar.groupKey;
        const summaries = groupKey !== null ? value.groupSummaries.get(groupKey) : undefined;
        const out = new Map<string, DeckGroup>();
        for (const item of value.items) {
            const label = (groupKey !== null ? item.groups.get(groupKey) : undefined) ?? "";
            let entry = out.get(label);
            if (entry === undefined) {
                entry = { label, summary: summaries?.get(label), items: [] };
                out.set(label, entry);
            }
            entry.items.push(item);
        }
        return [...out.values()];
    }, [value.items, value.groupSummaries, toolbar.groupKey]);

    const onCardClickFn = useMemo(() => getSomeorUndefined(value.onCardClick), [value.onCardClick]);
    const onOpenFn = useMemo(() => getSomeorUndefined(value.onOpen), [value.onOpen]);
    const onCloseFn = useMemo(() => getSomeorUndefined(value.onClose), [value.onClose]);

    // View state — the open card's detail panel (transient, like selection).
    const [openKey, setOpenKey] = useState<string | null>(null);
    const viewItems = useMemo(
        () => groups.flatMap(g => g.items).filter(i => getSomeorUndefined(i.detail) !== undefined),
        [groups]);
    const openItem = useMemo(
        () => (openKey !== null ? viewItems.find(i => i.key === openKey) : undefined),
        [viewItems, openKey]);
    const openDetail = openItem !== undefined ? getSomeorUndefined(openItem.detail) : undefined;
    const panelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (openKey !== null) panelRef.current?.focus();
    }, [openKey]);

    const activate = useCallback((item: DeckItemValue) => {
        if (getSomeorUndefined(item.detail) !== undefined) {
            setOpenKey(item.key);
            if (onOpenFn) queueMicrotask(() => { void onOpenFn(item.key); });
        }
        if (onCardClickFn) queueMicrotask(() => onCardClickFn(item.key));
    }, [onOpenFn, onCardClickFn]);
    const close = useCallback(() => {
        setOpenKey(null);
        if (onCloseFn) queueMicrotask(() => { void onCloseFn(); });
    }, [onCloseFn]);
    const traverse = useCallback((dir: -1 | 1) => {
        if (openKey === null || viewItems.length === 0) return;
        const idx = viewItems.findIndex(i => i.key === openKey);
        const next = viewItems[(idx + dir + viewItems.length) % viewItems.length];
        if (next !== undefined && next.key !== openKey) {
            setOpenKey(next.key);
            if (onOpenFn) queueMicrotask(() => { void onOpenFn(next.key); });
        }
    }, [openKey, viewItems, onOpenFn]);

    // Hover peek — hover-capable pointers only; delayed to skip pass-through.
    const hoverCapable = useHoverCapable();
    const [peek, setPeek] = useState<{ key: string; left: number; top: number } | null>(null);
    const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hoverStart = useCallback((item: DeckItemValue, e: React.MouseEvent) => {
        if (!hoverCapable || getSomeorUndefined(item.hover) === undefined) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (peekTimer.current !== null) clearTimeout(peekTimer.current);
        peekTimer.current = setTimeout(() => {
            setPeek({
                key: item.key,
                left: Math.min(rect.right + 8, window.innerWidth - 360),
                top: Math.min(rect.top, window.innerHeight - 240),
            });
        }, PEEK_DELAY);
    }, [hoverCapable]);
    const hoverEnd = useCallback(() => {
        if (peekTimer.current !== null) clearTimeout(peekTimer.current);
        peekTimer.current = null;
        setPeek(null);
    }, []);
    useEffect(() => () => { if (peekTimer.current !== null) clearTimeout(peekTimer.current); }, []);
    const peekItem = useMemo(
        () => (peek !== null ? value.items.find(i => i.key === peek.key) : undefined),
        [value.items, peek]);
    const peekComponent = peekItem !== undefined ? getSomeorUndefined(peekItem.hover) : undefined;

    const layout = getSomeorUndefined(value.layout)?.type ?? "grid";
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const height = parseCssSize(style ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined);
    const minCardWidth = parseCssSize(style ? getSomeorUndefined(style.minCardWidth) : undefined) ?? "240px";
    const scrollable = height !== undefined || maxHeight !== undefined;

    return (
        <Box
            css={styles.root}
            data-scrollable={scrollable ? "" : undefined}
            style={{
                ...(height !== undefined ? { height } : {}),
                ...(maxHeight !== undefined ? { maxHeight } : {}),
            }}
        >
            {groupOptions.length > 0 && (
                <Box css={styles.toolbar}>
                    <Box css={styles.segGroup}>
                        <Box as="span" css={styles.segLabel}>Group by</Box>
                        {[...groupOptions, { key: null as string | null, label: "None" }].map(g => (
                            <Box
                                key={g.key ?? "∅"}
                                as="button"
                                css={{ ...chip({ tone: toolbar.groupKey === g.key ? "brand" : "neutral", size: "sm" }), cursor: "pointer" }}
                                onClick={() => setGroup(g.key)}
                            >
                                {g.label}
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
            <Box css={styles.body} data-scrollable={scrollable ? "" : undefined}>
                {groups.map(group => {
                    const collapsed = toolbar.collapsed.includes(group.label);
                    return (
                        <Box key={group.label || "∅"} css={styles.group}>
                            {group.label !== "" && (
                                <Box
                                    as="button"
                                    css={styles.groupHead}
                                    aria-expanded={!collapsed}
                                    onClick={() => toggleCollapsed(group.label)}
                                >
                                    <Box as="span" css={styles.groupChevron}>
                                        <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} />
                                    </Box>
                                    <Box as="span" css={styles.groupLabel}>{group.label}</Box>
                                    <Box as="span" css={styles.groupCount}>{group.items.length}</Box>
                                    {group.summary !== undefined && (
                                        <Box as="span" css={styles.groupSummary}>{group.summary}</Box>
                                    )}
                                </Box>
                            )}
                            {!collapsed && (
                                <Box
                                    css={layout === "list" ? styles.list : styles.grid}
                                    style={layout === "grid" ? { gridTemplateColumns: `repeat(auto-fill, minmax(min(${minCardWidth}, 100%), 1fr))` } : undefined}
                                >
                                    {group.items.map(item => (
                                        <DeckCard
                                            key={item.key}
                                            item={item}
                                            styles={styles}
                                            libStyles={libStyles}
                                            open={openKey === item.key}
                                            activatable={onCardClickFn !== undefined || getSomeorUndefined(item.detail) !== undefined}
                                            onActivate={activate}
                                            onHoverStart={hoverStart}
                                            onHoverEnd={hoverEnd}
                                            storageKey={storageKey}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>
            {peekComponent !== undefined && peek !== null && openKey === null && (
                <Box css={styles.peek} style={{ left: `${peek.left}px`, top: `${peek.top}px` }}>
                    <EastChakraComponent value={peekComponent} storageKey={`${storageKey}.peek.${peek.key}`} />
                </Box>
            )}
            {openItem !== undefined && openDetail !== undefined && (
                <>
                    <Box css={styles.overlay} onClick={close} />
                    <Box
                        css={styles.panel}
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={openItem.title}
                        tabIndex={-1}
                        onKeyDown={(e: React.KeyboardEvent) => {
                            if (e.key === "Escape") { e.preventDefault(); close(); }
                            else if (e.key === "ArrowRight") { e.preventDefault(); traverse(1); }
                            else if (e.key === "ArrowLeft") { e.preventDefault(); traverse(-1); }
                        }}
                    >
                        <Box css={styles.panelHead} data-tone={getSomeorUndefined(openItem.tone)?.type}>
                            <Box as="span" css={styles.panelTitle}>{openItem.title}</Box>
                            {(() => {
                                const status = getSomeorUndefined(openItem.status);
                                return status !== undefined
                                    ? <Box as="span" css={libStyles.statusPill} data-tone={status.tone.type}>{status.label}</Box>
                                    : null;
                            })()}
                            <chakra.button type="button" css={styles.panelClose} aria-label="Close"
                                onClick={close}>
                                <FontAwesomeIcon icon={faXmark} />
                            </chakra.button>
                        </Box>
                        <Box css={styles.panelBody}>
                            <EastChakraComponent value={openDetail} storageKey={`${storageKey}.detail.${openItem.key}`} />
                        </Box>
                        {viewItems.length > 1 && (
                            <Box css={styles.panelNav}>
                                <chakra.button type="button" css={styles.navBtn} aria-label="Previous"
                                    onClick={() => traverse(-1)}>
                                    <FontAwesomeIcon icon={faChevronLeft} />
                                </chakra.button>
                                <chakra.button type="button" css={styles.navBtn} aria-label="Next"
                                    onClick={() => traverse(1)}>
                                    <FontAwesomeIcon icon={faChevronRight} />
                                </chakra.button>
                            </Box>
                        )}
                    </Box>
                </>
            )}
        </Box>
    );
}

// ============================================================================
// Slice wrapper
// ============================================================================

/**
 * Renders an East UI Deck value — the grouped card collection. With slice
 * chrome bound, mounts the shared rail cluster + derived-count footer
 * (the Library convention) — filtering and search flow through it.
 */
export const EastChakraDeck = memo(function EastChakraDeck(props: EastChakraDeckProps) {
    const chrome = getSomeorUndefined(props.value.slice as never) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const slice = chrome?.slice as ValueTypeOf<typeof SliceInternal.Types.Bind> | undefined;
    useSliceReactivity(slice?.key);
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })() as SlotStyles;
    if (chrome === undefined || slice === undefined) return <DeckCore {...props} />;

    const state = slice.read();
    const configuredKinds = chrome.affordances.map(a => a.type);
    const affordanceKinds = railAffordanceKinds(configuredKinds, state);
    const total = Number(slice.totalCount() as bigint);
    const result = Number(slice.resultCount() as bigint);
    const pct = total > 0 ? Math.round((1 - result / total) * 100) : 0;

    return (
        <Box css={{ ...frameStyles.root, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box css={{ ...frameStyles.frameEyebrow, flexShrink: 0 }}>
                <SliceRailCluster slice={slice} affordanceKinds={affordanceKinds} />
            </Box>
            <Box css={{ ...frameStyles.frameBody, flex: "1 1 0%", minHeight: 0, overflow: "hidden" }}>
                <DeckCore {...props} />
            </Box>
            <Box css={{ ...frameStyles.frameFooter, flexShrink: 0 }}>
                <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                <Box as="span">{`cards · of ${total.toLocaleString()}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
            </Box>
        </Box>
    );
}, (prev, next) => deckEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
