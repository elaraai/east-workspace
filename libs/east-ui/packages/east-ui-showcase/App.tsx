/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase chrome built to the brand-system spec
 * (`libs/east-ui/design/index.html`, `#brand-system` section).
 *
 * Sidebar recipe: 240 px paper-2 panel · 1 px right rule · mono 12 px
 * uppercase items @ 36 px height · active state = 3 px brand-d left rule
 * + brand-tint fill. Collapses to a 56 px logo + chevron rail; toggle is
 * the chevron in the panel header *or* the `[` key. State is persisted to
 * `localStorage` per the spec. The icon column the spec mandates is
 * intentionally omitted (this surface doesn't carry per-item icons) — in
 * collapsed mode only the toggle button is shown beneath the logo.
 *
 * Logo region (bsys): fixed-height identity strip at the top of the sidebar
 * — 64 px expanded · 56 px collapsed · 16 px left/right padding · vertically
 * centred · 12 px rule-free gap below to the first item. No badges /
 * version stamps / toggles / search inside the region — identity only.
 *
 * Header recipe: sticky to viewport top · 84 px tall · 1 px bottom rule.
 *   Row 1 — breadcrumb left, search right.
 *   Row 2 — surface title left, state eyebrow right.
 *
 * Main recipe: 32 px top/bottom · 24 px left/right viewport padding,
 * 1480 px max content width. Grid layout (one of the three allowed).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Box, Flex, Heading, Input, InputGroup, Kbd, Text, useSlotRecipe,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { LogoCollapsed, LogoFull } from "./components/ElaraLogo";
import { VirtualizedGrid } from "./components/VirtualizedGrid";
import { catalog, categories } from "./catalog";

const SIDEBAR_KEY = "east-ui-showcase.sidebar-collapsed";

function useSidebarCollapsed(): [boolean, () => void] {
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem(SIDEBAR_KEY) === "true"; } catch { return false; }
    });
    const toggle = useCallback(() => {
        setCollapsed(prev => {
            const next = !prev;
            try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);
    /* bsys Sidebar recipe: `[` toggles collapse globally (not bound to focus
     * on the toggle button so the operator can hit it from anywhere). */
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key !== "[") return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            toggle();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [toggle]);
    return [collapsed, toggle];
}

export function App() {
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]);

    const filtered = useMemo(() => {
        let results = catalog.filter(e => e.category === selectedCategory);
        if (search.trim()) {
            const q = search.toLowerCase();
            results = results.filter(e =>
                e.description.toLowerCase().includes(q) ||
                e.keywords.some(k => k.toLowerCase().includes(q)) ||
                e.name.toLowerCase().includes(q)
            );
        }
        return results;
    }, [search, selectedCategory]);

    const categoryCount = useMemo(
        () => catalog.filter(e => e.category === selectedCategory).length,
        [selectedCategory],
    );

    return (
        /* h=100vh locks the shell to the viewport — the Main content area
         * scrolls internally; the page itself never overflows. */
        <Flex h="100vh" w="100vw" overflow="hidden" bg="bg.canvas" align="stretch">
            <Sidebar selected={selectedCategory} onSelect={setSelectedCategory} />
            <Flex flex="1" minW={0} direction="column" h="100vh">
                <Header
                    category={selectedCategory}
                    categoryCount={categoryCount}
                    search={search}
                    onSearch={setSearch}
                />
                {/* Main scroll region. VirtualizedGrid owns the scroll
                 *  container so the scrollbar sits flush against the
                 *  viewport's right edge — the 24 px side gutters are
                 *  applied to the grid's inner content area, not here. */}
                <Box flex="1" minH={0} display="flex" flexDirection="column">
                    {filtered.length === 0
                        ? <Text color="fg.muted" px="24px" py="32px">No examples match your search.</Text>
                        : <VirtualizedGrid entries={filtered} />}
                </Box>
            </Flex>
        </Flex>
    );
}

/* ------------------------------------------------------------------ */
/* Sidebar — bsys "Sidebar recipe"                                    */
/* ------------------------------------------------------------------ */

/** 22 × 22 chevron toggle — matches bsys Sidebar header button dims (line 643). */
function ToggleButton({
    onClick, icon, ...rest
}: { onClick: () => void; icon: import("@fortawesome/fontawesome-svg-core").IconDefinition } & React.AriaAttributes) {
    return (
        <Box
            as="button"
            type="button"
            onClick={onClick}
            width="22px"
            height="22px"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            border="0"
            background="transparent"
            color="fg.muted"
            cursor="pointer"
            borderRadius="{radii.sm}"
            _hover={{ color: "brand.700", background: "bg.muted" }}
            {...rest}
        >
            <FontAwesomeIcon icon={icon} style={{ fontSize: "10px" }} />
        </Box>
    );
}

function Sidebar({ selected, onSelect }: { selected: string; onSelect: (cat: string) => void }) {
    const recipe = useSlotRecipe({ key: "navList" });
    const styles = recipe({ surface: "shell" });
    const [collapsed, toggle] = useSidebarCollapsed();
    return (
        <Box
            as="aside"
            layerStyle="nav.panel"
            w={collapsed ? "56px" : "240px"}
            flexShrink={0}
            position="sticky"
            top="0"
            alignSelf="flex-start"
            h="100vh"
            overflowY="auto"
            overflowX="hidden"
            transitionProperty="width"
            transitionDuration="{durations.normal}"
            transitionTimingFunction="{easings.smooth}"
        >
            {/* Logo region — bsys "Logo region" rules. Fixed-height strip
             *  pinned to the top of the sidebar. The wordmark anchors to
             *  the left padding edge expanded · app-mark centres collapsed.
             *  No bottom rule — visual separation from the first item
             *  below comes from a 12 px rule-free gap. */}
            <Box
                layerStyle="nav.logo"
                display="flex"
                alignItems="center"
                h={collapsed ? "56px" : "64px"}
                justifyContent={collapsed ? "center" : "flex-start"}
                px={collapsed ? "0" : "16px"}
                mb="12px"
            >
                {collapsed ? <LogoCollapsed height={8} width={8} /> : <LogoFull height={8} />}
            </Box>

            {collapsed ? (
                <Flex justify="center">
                    <ToggleButton aria-label="Expand sidebar" onClick={toggle} icon={faChevronRight} />
                </Flex>
            ) : (
                <Box as="nav" css={styles.root}>
                    {/* Section eyebrow + collapse toggle — bsys line 641
                     *  padding: 4px 10px 10px 14px · 9.5 px / 0.18 em eyebrow · 22 px button */}
                    <Flex
                        align="center"
                        justify="space-between"
                        pt="4px"
                        pb="10px"
                        pl="14px"
                        pr="10px"
                    >
                        <Box
                            fontFamily="mono"
                            fontSize="9.5px"
                            fontWeight="semibold"
                            letterSpacing="0.18em"
                            textTransform="uppercase"
                            color="fg.muted"
                        >
                            Components
                        </Box>
                        <ToggleButton aria-label="Collapse sidebar" onClick={toggle} icon={faChevronLeft} />
                    </Flex>
                    {categories.map(cat => {
                        const active = selected === cat;
                        return (
                            <Box
                                key={cat}
                                as="button"
                                type="button"
                                onClick={() => onSelect(cat)}
                                aria-current={active ? "page" : undefined}
                                css={styles.item}
                            >
                                <Box flex="1" textAlign="left">{cat}</Box>
                                <Text as="span" textStyle="mono.sm" color="fg.muted" letterSpacing="0">
                                    {catalog.filter(e => e.category === cat).length}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/* Header — bsys "Header recipe"                                      */
/* ------------------------------------------------------------------ */

function Header({
    category, categoryCount, search, onSearch,
}: { category: string; categoryCount: number; search: string; onSearch: (q: string) => void }) {
    return (
        <Box as="header" layerStyle="header.bar" position="sticky" top="0" zIndex={10}>
            {/* Row 1 — breadcrumb left · search right · 28 px tall */}
            <Flex align="center" gap="3" mb="6px" h="28px">
                <Breadcrumb category={category} />
                <Box ml="auto">
                    <InputGroup
                        maxW="280px"
                        startElement={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                        endElement={<Kbd>⌘K</Kbd>}
                    >
                        <Input
                            size="sm"
                            placeholder="Search examples"
                            value={search}
                            onChange={(e) => onSearch(e.target.value)}
                        />
                    </InputGroup>
                </Box>
            </Flex>

            {/* Row 2 — surface title left · state eyebrow right · 36 px tall */}
            <Flex align="baseline" gap="3.5" h="36px">
                <Heading as="h1" textStyle="surface.title">{category}</Heading>
                <Text textStyle="state.eyebrow">
                    {categoryCount} example{categoryCount === 1 ? "" : "s"}
                </Text>
            </Flex>
        </Box>
    );
}

function Breadcrumb({ category }: { category: string }) {
    return (
        <Text textStyle="breadcrumb">
            <Box as="span" color="brand.700">East UI</Box>
            <Box as="span" px="1">/</Box>
            <Box as="span" color="fg">{category}</Box>
        </Text>
    );
}
