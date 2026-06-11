/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useEffect, useMemo, useRef } from "react";
import { Box, chakra, Flex, Heading, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PatternEntry } from "./PatternEntry";
import type { CatalogEntry } from "../catalog";

/* Doc column — spec `.shell main`: rule-separated entries on a centred
 * measure rather than a card grid. */
const CONTENT_MAX_WIDTH = "1100px";
const CONTENT_GUTTER = "40px";
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
interface TocSection { category: string; groups: TocGroup[] }

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
 *  TOC tree. `withCategories` splits the TOC by category for the All pages. */
function buildItems(entries: readonly CatalogEntry[], withCategories: boolean): {
    items: DocItem[];
    sections: TocSection[];
} {
    const items: DocItem[] = [];
    const sections: TocSection[] = [];
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
            const category = withCategories ? entry.category : "";
            const section = sections.at(-1);
            if (section === undefined || section.category !== category) {
                sections.push({ category, groups: [group] });
            } else {
                section.groups.push(group);
            }
        }
        items.push({ kind: "entry", key: `e:${entry.pathKey}:${entry.name}`, groupKey: entry.pathKey, entry });
        group.entries.push({ name: entry.name, index: items.length - 1 });
    }
    return { items, sections };
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
export function DocList({
    entries,
    showCategories = false,
}: {
    entries: readonly CatalogEntry[];
    showCategories?: boolean;
}) {
    const { items, sections } = useMemo(
        () => buildItems(entries, showCategories),
        [entries, showCategories],
    );
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: i => estimateItem(items[i]),
        overscan: 3,
        paddingStart: PAD_START,
        paddingEnd: PAD_END,
    });

    /* Reset scroll on entry-set change so switching to a shorter category
     * doesn't leave the viewport pinned at an out-of-range offset. */
    useEffect(() => {
        parentRef.current?.scrollTo({ top: 0 });
    }, [entries]);

    const virtualItems = virtualizer.getVirtualItems();
    const offset = virtualizer.scrollOffset ?? 0;
    const current = virtualItems.find(v => v.end > offset + ACTIVE_SLACK) ?? virtualItems[0];
    const currentItem = current ? items[current.index] : undefined;
    const activeGroupKey = currentItem
        ? (currentItem.kind === "head" ? currentItem.pathKey : currentItem.groupKey)
        : null;

    return (
        <Flex h="100%" minH={0} align="stretch">
            <Box ref={parentRef} flex="1" minW={0} h="100%" overflowY="auto">
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
                                top="0"
                                left={CONTENT_GUTTER}
                                right={CONTENT_GUTTER}
                                transform={`translateY(${virtualRow.start}px)`}
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
                sections={sections}
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
    sections,
    activeGroupKey,
    onJump,
}: {
    sections: TocSection[];
    activeGroupKey: string | null;
    onJump: (index: number) => void;
}) {
    if (sections.length === 0) return null;
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
            {sections.map((sec, i) => (
                <Box key={sec.category || i} mb="6px">
                    {sec.category && (
                        <Text textStyle="nav.eyebrow" color="fg" mt="16px" mb="4px">
                            {sec.category}
                        </Text>
                    )}
                    {sec.groups.map(g => {
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
            ))}
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
