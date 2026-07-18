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
 * clickable-card chrome and collapsible group heads. Slice chrome mounts
 * exactly as Library's (rail cluster + derived-count footer).
 *
 * Layout is container-first: the grid uses
 * `repeat(auto-fill, minmax(minCardWidth, 1fr))`, so desktop shows rows of
 * wrapping cards per group and phones collapse to one column with no
 * breakpoint logic. Virtualization is deferred (#359 fast-follow) — a
 * height-constrained Deck scrolls its body.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { Box, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, type IconName } from "@fortawesome/fontawesome-svg-core";
import { faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Deck, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { usePersistedState } from "../../hooks/usePersistedState";
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

interface DeckToolbarState {
    groupKey: string | null;
    collapsed: string[];
}

interface DeckGroup {
    label: string;
    summary: string | undefined;
    items: DeckItemValue[];
}

function itemSearchText(item: DeckItemValue): string {
    const explicit = getSomeorUndefined(item.search);
    if (explicit !== undefined) return explicit.toLowerCase();
    return `${item.title} ${getSomeorUndefined(item.sublabel) ?? ""}`.toLowerCase();
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

function DeckCard({ item, styles, libStyles, onCardClick, storageKey }: {
    item: DeckItemValue;
    styles: SlotStyles;
    libStyles: SlotStyles;
    onCardClick: ((key: string) => void) | undefined;
    storageKey: string;
}) {
    const icon = solidIcon(getSomeorUndefined(item.icon));
    const sublabel = getSomeorUndefined(item.sublabel);
    const status = getSomeorUndefined(item.status);
    const face = getSomeorUndefined(item.face);
    const handleClick = useCallback(() => {
        if (onCardClick) queueMicrotask(() => onCardClick(item.key));
    }, [onCardClick, item.key]);

    return (
        <Box
            css={styles.card}
            data-clickable={onCardClick !== undefined ? "" : undefined}
            data-filtered={item.filtered ? "" : undefined}
            {...(onCardClick !== undefined
                ? { role: "button", tabIndex: 0, onClick: handleClick,
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } } }
                : {})}
        >
            {icon !== undefined && (
                <Box css={libStyles.iconTile}><FontAwesomeIcon icon={icon} /></Box>
            )}
            <Box css={libStyles.cardBody}>
                <Box css={libStyles.cardHead}>
                    <Box as="span" css={libStyles.cardLabel}>{item.title}</Box>
                    {status !== undefined && (
                        <Box as="span" css={libStyles.statusPill} data-tone={status.tone.type}>{status.label}</Box>
                    )}
                </Box>
                {sublabel !== undefined && <Box as="span" css={libStyles.cardSublabel}>{sublabel}</Box>}
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

interface DeckCoreProps extends EastChakraDeckProps {
    /** Set when the slice rail mounts a `search` affordance. */
    suppressSearch?: boolean;
}

function DeckCore({ value, storageKey, suppressSearch }: DeckCoreProps) {
    const styles = useSlotRecipe({ key: "deck" })() as SlotStyles;
    const libStyles = useSlotRecipe({ key: "library" })() as SlotStyles;
    const chip = useRecipe({ key: "chip" });
    const frameStyles = useSlotRecipe({ key: "sliceFrame" })() as SlotStyles;

    const groupOptions = value.groupOptions;
    const { state: toolbar, setState: setToolbar } = usePersistedState<DeckToolbarState>(`${storageKey}.toolbar`, {
        groupKey: groupOptions[0]?.key ?? null,
        collapsed: [],
    });
    const [query, setQuery] = useState("");

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

    const lowerQuery = query.trim().toLowerCase();
    const queryHides = useCallback(
        (item: DeckItemValue) => lowerQuery !== "" && !itemSearchText(item).includes(lowerQuery),
        [lowerQuery],
    );

    // Group items preserving first-appearance order; null group key = flat.
    const groups = useMemo<DeckGroup[]>(() => {
        const groupKey = toolbar.groupKey;
        const summaries = groupKey !== null ? value.groupSummaries.get(groupKey) : undefined;
        const out = new Map<string, DeckGroup>();
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

    const onCardClickFn = useMemo(() => getSomeorUndefined(value.onCardClick), [value.onCardClick]);
    const layout = getSomeorUndefined(value.layout)?.type ?? "grid";
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const height = parseCssSize(style ? getSomeorUndefined(style.height) : undefined);
    const maxHeight = parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined);
    const minCardWidth = parseCssSize(style ? getSomeorUndefined(style.minCardWidth) : undefined) ?? "240px";
    const scrollable = height !== undefined || maxHeight !== undefined;

    const showToolbar = groupOptions.length > 0 || (value.searchable && suppressSearch !== true);

    return (
        <Box
            css={styles.root}
            data-scrollable={scrollable ? "" : undefined}
            style={{
                ...(height !== undefined ? { height } : {}),
                ...(maxHeight !== undefined ? { maxHeight } : {}),
            }}
        >
            {showToolbar && (
                <Box css={styles.toolbar}>
                    {groupOptions.length > 0 && (
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
                    )}
                    {value.searchable && suppressSearch !== true && (
                        <Box as="input"
                            css={{ ...frameStyles.searchPill, marginLeft: "auto" }}
                            {...{
                                placeholder: "Search",
                                value: query,
                                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
                            }}
                        />
                    )}
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
                                            onCardClick={onCardClickFn}
                                            storageKey={storageKey}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

// ============================================================================
// Slice wrapper
// ============================================================================

/**
 * Renders an East UI Deck value — the grouped card collection. With slice
 * chrome bound, mounts the shared rail cluster + derived-count footer
 * (the Library convention).
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
                <DeckCore {...props} suppressSearch={affordanceKinds.includes("search")} />
            </Box>
            <Box css={{ ...frameStyles.frameFooter, flexShrink: 0 }}>
                <Box as="span" css={frameStyles.frameFooterStat}>{result.toLocaleString()}</Box>
                <Box as="span">{`cards · of ${total.toLocaleString()}`}</Box>
                {pct > 0 && <Box as="span" css={frameStyles.frameFooterDelta}>{`· −${pct}%`}</Box>}
            </Box>
        </Box>
    );
}, (prev, next) => deckEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
