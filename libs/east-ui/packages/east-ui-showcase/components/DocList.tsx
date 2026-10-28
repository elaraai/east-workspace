/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Box, chakra, Flex, Heading, Text } from "@chakra-ui/react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { PatternEntry } from "./PatternEntry";
import type { CatalogEntry } from "../catalog";

/* Doc column — spec `.shell main`: rule-separated entries on a centred
 * measure rather than a card grid. */
const CONTENT_MAX_WIDTH = "1100px";
// #356: comfortable desktop gutters, tight on phones.
const CONTENT_GUTTER = { base: "12px", md: "40px" };
/** Virtualizer padding above the first / below the last item. */
const PAD_START = 8;
const PAD_END = 96;
/** Scroll offset slack when deciding which group the viewport is "in". */
const ACTIVE_SLACK = 90;

/** A component-group heading row (`disclosure/tabs` → "Tabs"). */
interface HeadItem {
    kind: "head";
    key: string;
    pathKey: string;
    category: string;
    title: string;
    count: number;
}
/** One example, rendered by `PatternEntry`. */
interface EntryItem {
    kind: "entry";
    key: string;
    groupKey: string;
    entry: CatalogEntry;
}
type DocItem = HeadItem | EntryItem;

interface TocEntry { name: string; index: number }
interface TocGroup { key: string; title: string; index: number; entries: TocEntry[] }

/** `"sales-dashboard"` → `"Sales Dashboard"`. */
function titleFor(pathKey: string): string {
    const slug = pathKey.split("/").at(-1) ?? pathKey;
    return slug
        .split(/[-_]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/** Flatten entries (already in document order) into the virtualizer's item
 *  list — one head per consecutive pathKey run, then its entries — plus the
 *  TOC's groups. */
function buildItems(entries: readonly CatalogEntry[]): {
    items: DocItem[];
    groups: TocGroup[];
} {
    const items: DocItem[] = [];
    const groups: TocGroup[] = [];
    let group: TocGroup | undefined;
    for (const entry of entries) {
        if (group === undefined || group.key !== entry.pathKey) {
            const count = entries.filter(e => e.pathKey === entry.pathKey).length;
            items.push({
                kind: "head",
                key: `h:${entry.pathKey}`,
                pathKey: entry.pathKey,
                category: entry.category,
                title: titleFor(entry.pathKey),
                count,
            });
            group = { key: entry.pathKey, title: titleFor(entry.pathKey), index: items.length - 1, entries: [] };
            groups.push(group);
        }
        items.push({ kind: "entry", key: `e:${entry.pathKey}:${entry.name}`, groupKey: entry.pathKey, entry });
        group.entries.push({ name: entry.name, index: items.length - 1 });
    }
    return { items, groups };
}

/** Pre-measurement height estimate; the virtualizer's ResizeObserver
 *  corrects it once the row mounts. */
function estimateItem(item: DocItem): number {
    if (item.kind === "head") return 110;
    if (item.entry.tier === "live") return 360;
    const lines = item.entry.source.raw.split("\n").length;
    return Math.min(lines, 44) * 19 + 210;
}

/**
 * Single-column documentation flow for the showcase: component-group
 * headings + rule-separated `PatternEntry` sections, virtualized by row
 * with dynamic measurement, plus a sticky right-hand "on this page" TOC
 * (spec `.toc` recipe, mirrored to the right edge).
 */
/** A deep-link scroll request: jump to a group head (`name` omitted) or a
 *  specific example. `nonce` retriggers the jump for identical targets. */
export interface DocScrollTarget {
    pathKey: string;
    name?: string;
    nonce: number;
}

export function DocList({
    entries,
    scrollTarget,
}: {
    entries: readonly CatalogEntry[];
    scrollTarget?: DocScrollTarget;
}) {
    const { items, groups } = useMemo(() => buildItems(entries), [entries]);
    const parentRef = useRef<HTMLDivElement>(null);
    const targetIndex = scrollTarget === undefined ? -1 : items.findIndex(item => scrollTarget.name !== undefined
        ? item.kind === "entry" && item.groupKey === scrollTarget.pathKey && item.entry.name === scrollTarget.name
        : item.kind === "head" && item.pathKey === scrollTarget.pathKey);
    const itemKey = useCallback((index: number) => items[index].key, [items]);
    /* The linked entry stays mounted wherever the list scrolls: what a link
     * opened is never dropped from the page while the link stands. Anything
     * that moves the list far enough — a reader, or a test's pointer
     * scrolling a control into view while the rows around the link measure —
     * otherwise left the window without it, and nothing scrolled it back:
     * each spec driving an entry it opened by its link waited for it until
     * it timed out. Kept, it is where its row says, and scrolling to it
     * shows it as it was left. */
    const rangeExtractor = useCallback((range: Range) => {
        const indexes = defaultRangeExtractor(range);
        return targetIndex < 0 || indexes.includes(targetIndex)
            ? indexes
            : [...indexes, targetIndex].sort((a, b) => a - b);
    }, [targetIndex]);

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        getItemKey: itemKey,
        estimateSize: i => estimateItem(items[i]),
        // Start at the link, without first mounting the category's earlier
        // examples. Measured heights refine this estimate below.
        initialOffset: () => targetIndex < 0 ? 0
            : PAD_START + items.slice(0, targetIndex).reduce((height, item) => height + estimateItem(item), 0),
        // Keep one adjacent entry mounted while asynchronous examples grow and
        // scroll anchoring settles. Larger overscan mounts several expensive
        // builders and adds their subscriptions to every interaction.
        overscan: 1,
        rangeExtractor,
        paddingStart: PAD_START,
        paddingEnd: PAD_END,
    });
    /* A row above the fold that changes size moves the scroll by as much, so
     * what shows at the fold holds still — whichever way the list last
     * scrolled. The virtualizer's default skips a row measured before while
     * the list scrolls backward: a live example above a deep link that grew
     * as it rendered and shrank once it had, just after a correction of a
     * few pixels upward, left the list past its link at the end of the page.
     * Otherwise the default's rule stands: a row's first measure moves the
     * scroll when its top is above the fold, a later one only when the whole
     * row is, so a row spanning the fold that grows at its bottom never drags
     * the view. */
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
        const fold = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
        // A link near the end may be clamped before it reaches the fold.
        // Preserve that end position while a preceding preview grows,
        // including one spanning the fold, or it pushes the linked row out
        // of the mounted window before the reader can reach it.
        const atEnd = instance.getTotalSize() - fold - (instance.scrollRect?.height ?? 0) <= 1;
        if (atEnd && item.index < targetIndex) return true;
        return instance.itemSizeCache.has(item.key) ? item.end <= fold : item.start < fold;
    };

    /* Navigate before paint. The virtualizer follows measurement changes;
     * waiting for a first window at zero would start unrelated examples.
     * A category without a link resets to its beginning. `nonce` permits
     * revisiting the same link after scrolling away. */
    useLayoutEffect(() => {
        if (targetIndex >= 0) virtualizer.scrollToIndex(targetIndex, { align: "start" });
        else virtualizer.scrollToOffset(0);
    }, [entries, scrollTarget, targetIndex, virtualizer]);

    const virtualItems = virtualizer.getVirtualItems();
    const offset = virtualizer.scrollOffset ?? 0;
    const current = virtualItems.find(v => v.end > offset + ACTIVE_SLACK) ?? virtualItems[0];
    const currentItem = current ? items[current.index] : undefined;
    const activeGroupKey = currentItem
        ? (currentItem.kind === "head" ? currentItem.pathKey : currentItem.groupKey)
        : null;

    return (
        <Flex h="100%" minH={0} align="stretch">
            <Box ref={parentRef} data-doc-scroll="" flex="1" minW={0} h="100%" overflowY="auto">
                <Box
                    position="relative"
                    maxW={CONTENT_MAX_WIDTH}
                    mx="auto"
                    h={`${virtualizer.getTotalSize()}px`}
                >
                    {virtualItems.map(virtualRow => {
                        const item = items[virtualRow.index];
                        return (
                            <Box
                                key={item.key}
                                data-index={virtualRow.index}
                                ref={virtualizer.measureElement}
                                position="absolute"
                                /* Offset via `top`, NOT `transform: translateY(...)` — a
                                 * transformed ancestor becomes the containing block for
                                 * `position: fixed` descendants, trapping <Expandable>'s
                                 * fill-the-window takeover inside the row. */
                                top={`${virtualRow.start}px`}
                                left={CONTENT_GUTTER}
                                right={CONTENT_GUTTER}
                            >
                                {item.kind === "head"
                                    ? <GroupHead item={item} first={virtualRow.index === 0} />
                                    : <PatternEntry entry={item.entry} />}
                            </Box>
                        );
                    })}
                </Box>
            </Box>
            <Toc
                groups={groups}
                activeGroupKey={activeGroupKey}
                onJump={i => virtualizer.scrollToIndex(i, { align: "start" })}
            />
        </Flex>
    );
}

/** Component-group heading — spec `.mode-head` scaled to an in-page h2:
 *  mono pathKey eyebrow + brand-font title, count on the right. */
function GroupHead({ item, first }: { item: HeadItem; first: boolean }) {
    return (
        <Box pt={first ? "28px" : "64px"} pb="16px">
            <Flex align="baseline" gap="3">
                <Text textStyle="eyebrow.mono">{item.pathKey}</Text>
                <Text textStyle="state.eyebrow" ml="auto">
                    {item.count} example{item.count === 1 ? "" : "s"}
                </Text>
            </Flex>
            <Heading as="h2" textStyle="display.xs" mt="6px">
                {item.title}
            </Heading>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/* TOC — spec `.toc` recipe, mirrored to the page's right edge        */
/* ------------------------------------------------------------------ */

function Toc({
    groups,
    activeGroupKey,
    onJump,
}: {
    groups: TocGroup[];
    activeGroupKey: string | null;
    onJump: (index: number) => void;
}) {
    if (groups.length === 0) return null;
    return (
        <Box
            as="nav"
            aria-label="On this page"
            w="232px"
            flexShrink={0}
            hideBelow="xl"
            h="100%"
            overflowY="auto"
            py="32px"
            pl="20px"
            pr="24px"
            borderLeftWidth="1px"
            borderLeftColor="border.subtle"
        >
            <Text textStyle="nav.eyebrow" mb="10px">On this page</Text>
            <Box mb="6px">
                {groups.map(g => {
                    const active = g.key === activeGroupKey;
                    return (
                        <Box key={g.key}>
                            <TocLink active={active} onClick={() => onJump(g.index)}>
                                {g.title}
                            </TocLink>
                            {/* Only the active group expands its examples —
                             *  keeps the TOC bounded on example-heavy pages. */}
                            {active && g.entries.map(en => (
                                <chakra.button
                                    key={en.name}
                                    type="button"
                                    onClick={() => onJump(en.index)}
                                    display="block"
                                    textAlign="left"
                                    w="100%"
                                    py="2px"
                                    pl="14px"
                                    border="0"
                                    background="transparent"
                                    cursor="pointer"
                                    fontFamily="mono"
                                    fontSize="10.5px"
                                    color="fg.muted"
                                    overflow="hidden"
                                    textOverflow="ellipsis"
                                    whiteSpace="nowrap"
                                    _hover={{ color: "brand.700" }}
                                >
                                    {en.name}
                                </chakra.button>
                            ))}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

function TocLink({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            display="block"
            textAlign="left"
            w="100%"
            py="3px"
            border="0"
            background="transparent"
            cursor="pointer"
            fontFamily="mono"
            fontSize="11px"
            fontWeight={active ? "semibold" : "medium"}
            letterSpacing="0.06em"
            textTransform="uppercase"
            color={active ? "fg" : "fg.muted"}
            _hover={{ color: "brand.700" }}
        >
            {children}
        </chakra.button>
    );
}
