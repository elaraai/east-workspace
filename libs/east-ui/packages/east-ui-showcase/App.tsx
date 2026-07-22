/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase chrome built to the brand-system spec
 * (`libs/east-ui/app_design_system/guidelines/reference/index.html`,
 * `#brand-system` section).
 *
 * Sidebar recipe: 240 px paper-2 panel · 1 px right rule · mono 12 px
 * uppercase items @ 36 px height · active state = inset brand-tint pill
 * (8 px side inset, brand-700 at weight 700). Collapses to a 56 px logo
 * + chevron rail; toggle is
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

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
    Box, chakra, Drawer, Flex, Heading, Input, InputGroup, Kbd, Portal, Text, useSlotRecipe,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faChevronLeft, faChevronRight, faBars, faXmark, faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { LogoCollapsed, LogoFull } from "./components/ElaraLogo";
import { useThemeMode } from "./theme-mode";
import { DocList, type DocScrollTarget } from "./components/DocList";
import { catalog, navSections, type CatalogEntry } from "./catalog";
import { ALL_PAGES, SECTION_EAST } from "./showcase-config";

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

/** The section whose "All" page `selected` is, or undefined for a plain
 *  category. */
function sectionForAllPage(selected: string): string | undefined {
    return Object.keys(ALL_PAGES).find(section => ALL_PAGES[section] === selected);
}

/** Entries for the current page. The All pseudo-categories concatenate a
 *  whole section, ordered (category, pathKey) to match the sidebar; the
 *  stable sort preserves each file's example order. */
/** Resolve a location.hash to a selection + optional scroll target.
 *
 *  Grammar (all derived from catalog pathKeys, so URLs stay slug-clean):
 *    #<pathKey>/<exampleName>  → category + scroll to that example
 *    #<pathKey>                → category + scroll to the group head
 *    #<categorySlug>           → category only (e.g. #disclosure)
 */
function resolveHash(raw: string): { category: string; pathKey?: string; name?: string } | undefined {
    const h = decodeURIComponent(raw.replace(/^#\/?/, "")).replace(/\/+$/, "");
    if (!h) return undefined;
    const exact = catalog.find(e => `${e.pathKey}/${e.name}` === h);
    if (exact) return { category: exact.category, pathKey: exact.pathKey, name: exact.name };
    const group = catalog.find(e => e.pathKey === h);
    if (group) return { category: group.category, pathKey: group.pathKey };
    const lower = h.toLowerCase();
    const cat = catalog.find(e =>
        e.category.toLowerCase() === lower || e.pathKey.split("/", 1)[0] === lower);
    if (cat) return { category: cat.category };
    const all = Object.values(ALL_PAGES).find(p => p.toLowerCase().replace(/\s+/g, "-") === lower);
    if (all) return { category: all };
    return undefined;
}

/** The hash slug written when a category is selected from the sidebar. */
function hashForCategory(category: string): string {
    const entry = catalog.find(e => e.category === category);
    if (entry) return entry.pathKey.split("/", 1)[0];
    return category.toLowerCase().replace(/\s+/g, "-");
}

function entriesFor(selected: string): CatalogEntry[] {
    const section = sectionForAllPage(selected);
    if (section !== undefined) {
        return catalog
            .filter(e => e.section === section)
            .sort((a, b) => a.category.localeCompare(b.category) || a.pathKey.localeCompare(b.pathKey));
    }
    return catalog.filter(e => e.category === selected);
}

export function App() {
    const [search, setSearch] = useState("");
    const initial = useMemo(() => resolveHash(window.location.hash), []);
    const [selectedCategory, setSelectedCategory] = useState<string>(
        initial?.category ?? ALL_PAGES[SECTION_EAST]);
    const [scrollTarget, setScrollTarget] = useState<DocScrollTarget | undefined>(
        initial?.pathKey ? { pathKey: initial.pathKey, name: initial.name, nonce: 0 } : undefined);
    const isAllPage = sectionForAllPage(selectedCategory) !== undefined;

    /* Deep links: the hash is the single source of shareable state. The
     * anchor on each example writes `#<pathKey>/<name>`; landing on (or
     * navigating to) such a URL selects the category and scrolls the
     * example into view. */
    useEffect(() => {
        const onHashChange = () => {
            const resolved = resolveHash(window.location.hash);
            if (!resolved) return;
            setSelectedCategory(resolved.category);
            setScrollTarget(prev => resolved.pathKey
                ? { pathKey: resolved.pathKey, name: resolved.name, nonce: (prev?.nonce ?? 0) + 1 }
                : undefined);
        };
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    const selectCategory = useCallback((cat: string) => {
        setSelectedCategory(cat);
        setScrollTarget(undefined);
        history.replaceState(null, "", `#${hashForCategory(cat)}`);
    }, []);

    const scoped = useMemo(() => entriesFor(selectedCategory), [selectedCategory]);
    const filtered = useMemo(() => {
        if (!search.trim()) return scoped;
        const q = search.toLowerCase();
        return scoped.filter(e =>
            e.description.toLowerCase().includes(q) ||
            e.keywords.some(k => k.toLowerCase().includes(q)) ||
            e.name.toLowerCase().includes(q)
        );
    }, [search, scoped]);

    /* Mobile nav (#356): below `md` the sidebar is hidden and the nav opens
     * as a left overlay drawer from the header's hamburger. */
    const [navOpen, setNavOpen] = useState(false);
    const selectFromDrawer = useCallback((cat: string) => {
        selectCategory(cat);
        setNavOpen(false);
    }, [selectCategory]);

    return (
        /* h=100vh locks the shell to the viewport — the Main content area
         * scrolls internally; the page itself never overflows. */
        <Flex h="100dvh" w="100%" overflow="hidden" bg="bg.canvas" align="stretch">
            <Sidebar selected={selectedCategory} onSelect={selectCategory} />
            <MobileNavDrawer
                open={navOpen}
                onOpenChange={setNavOpen}
                selected={selectedCategory}
                onSelect={selectFromDrawer}
            />
            <Flex flex="1" minW={0} direction="column" h="100vh">
                <Header
                    category={selectedCategory}
                    categoryCount={scoped.length}
                    search={search}
                    onSearch={setSearch}
                    onOpenNav={() => setNavOpen(true)}
                />
                {/* Main scroll region. DocList owns the scroll container so
                 *  the scrollbar sits flush against the right TOC rail; the
                 *  doc column centres itself within it. */}
                <Box flex="1" minH={0} display="flex" flexDirection="column">
                    {filtered.length === 0
                        ? <Text color="fg.muted" px="24px" py="32px">No examples match your search.</Text>
                        : <DocList entries={filtered} showCategories={isAllPage} scrollTarget={scrollTarget} />}
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
        <chakra.button
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
        </chakra.button>
    );
}

/** The section → categories nav list, shared by the desktop sidebar and the
 *  mobile nav drawer (#356). `headerExtra` renders trailing content in the
 *  first section's eyebrow row (the desktop collapse chevron). */
function NavSections({ selected, onSelect, headerExtra }: {
    selected: string;
    onSelect: (cat: string) => void;
    headerExtra?: React.ReactNode;
}) {
    const recipe = useSlotRecipe({ key: "navList" });
    const styles = recipe({ surface: "shell" });
    return (
        <Box as="nav" css={styles.root}>
            {navSections.map((sec, sIdx) => (
                <Fragment key={sec.section}>
                    <Flex
                        align="center"
                        justify="space-between"
                        pt={sIdx === 0 ? "4px" : "16px"}
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
                            {sec.section}
                        </Box>
                        {sIdx === 0 && headerExtra}
                    </Flex>
                    {(() => {
                        const items: Array<{ key: string; label: string; count: number }> = [
                            {
                                key: ALL_PAGES[sec.section],
                                label: "All",
                                count: catalog.filter(e => e.section === sec.section).length,
                            },
                            ...sec.categories.map(cat => ({
                                key: cat,
                                label: cat,
                                count: catalog.filter(e => e.category === cat).length,
                            })),
                        ];
                        return items.map(item => {
                            const active = selected === item.key;
                            return (
                                <chakra.button
                                    key={item.key}
                                    type="button"
                                    onClick={() => onSelect(item.key)}
                                    aria-current={active ? "page" : undefined}
                                    css={styles.item}
                                >
                                    <Box flex="1" textAlign="left">{item.label}</Box>
                                    <Text as="span" textStyle="mono.sm" color="fg.muted" letterSpacing="0">
                                        {item.count}
                                    </Text>
                                </chakra.button>
                            );
                        });
                    })()}
                </Fragment>
            ))}
        </Box>
    );
}

/** Mobile nav (#356): the same sections in a left overlay drawer. */
function MobileNavDrawer({ open, onOpenChange, selected, onSelect }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selected: string;
    onSelect: (cat: string) => void;
}) {
    return (
        <Drawer.Root open={open} onOpenChange={(d) => onOpenChange(d.open)} placement="start">
            <Portal>
                <Drawer.Backdrop />
                <Drawer.Positioner>
                    <Drawer.Content maxW="280px" layerStyle="nav.panel">
                        <Flex align="center" justify="space-between" h="56px" px="16px">
                            <LogoFull height={8} />
                            <ToggleButton aria-label="Close navigation" onClick={() => onOpenChange(false)} icon={faXmark} />
                        </Flex>
                        <Box overflowY="auto" pb="16px">
                            <NavSections selected={selected} onSelect={onSelect} />
                        </Box>
                    </Drawer.Content>
                </Drawer.Positioner>
            </Portal>
        </Drawer.Root>
    );
}

function Sidebar({ selected, onSelect }: { selected: string; onSelect: (cat: string) => void }) {
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
            /* Mobile (#356): the fixed sidebar yields to the nav drawer. */
            hideBelow="md"
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
                <NavSections
                    selected={selected}
                    onSelect={onSelect}
                    headerExtra={<ToggleButton aria-label="Collapse sidebar" onClick={toggle} icon={faChevronLeft} />}
                />
            )}
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/* Header — bsys "Header recipe"                                      */
/* ------------------------------------------------------------------ */

function Header({
    category, categoryCount, search, onSearch, onOpenNav,
}: { category: string; categoryCount: number; search: string; onSearch: (q: string) => void; onOpenNav: () => void }) {
    return (
        <Box as="header" layerStyle="header.bar" position="sticky" top="0" zIndex={10}>
            {/* Row 1 — (mobile) hamburger · breadcrumb · (desktop) search.
              * The breadcrumb never wraps: it truncates on one 28px line. */}
            <Flex align="center" gap="3" mb="6px" h="28px" minW="0">
                {/* Mobile nav trigger (#356): ≥44px tap target, hidden on md+. */}
                <chakra.button
                    type="button"
                    aria-label="Open navigation"
                    onClick={onOpenNav}
                    hideFrom="md"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    minW="44px"
                    minH="44px"
                    ml="-12px"
                    border="0"
                    background="transparent"
                    color="fg.muted"
                    cursor="pointer"
                    _hover={{ color: "fg" }}
                >
                    <FontAwesomeIcon icon={faBars} />
                </chakra.button>
                <Box minW="0" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    <Breadcrumb category={category} />
                </Box>
                {/* Desktop search keeps its spec position; mobile search moves
                  * to its own full-width row below (the coarse 44px input
                  * floor doesn't fit the 28px breadcrumb line). The theme
                  * toggle (#362) rides the same right-aligned cluster on
                  * every viewport. */}
                <Flex ml="auto" align="center" gap="2" flexShrink={0}>
                    <Box hideBelow="md">
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
                    <ThemeToggle />
                </Flex>
            </Flex>

            {/* Row 2 — surface title left · state eyebrow right · 36 px tall */}
            <Flex align="baseline" gap="3.5" h="36px" minW="0">
                <Heading as="h1" textStyle="surface.title" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{category}</Heading>
                <Text textStyle="state.eyebrow" flexShrink={0} hideBelow="sm">
                    {categoryCount} example{categoryCount === 1 ? "" : "s"}
                </Text>
            </Flex>

            {/* Row 3 (mobile only) — full-width search on its own line. */}
            <Box hideFrom="md" mt="8px">
                <InputGroup
                    w="100%"
                    startElement={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                >
                    <Input
                        size="sm"
                        w="100%"
                        placeholder="Search examples"
                        value={search}
                        onChange={(e) => onSearch(e.target.value)}
                    />
                </InputGroup>
            </Box>
        </Box>
    );
}

/** Sun/moon colour-mode flip (#362) — Chakra v3 class-based dark mode. */
function ThemeToggle() {
    const [mode, toggle] = useThemeMode();
    return (
        <ToggleButton
            aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggle}
            icon={mode === "dark" ? faSun : faMoon}
        />
    );
}

function Breadcrumb({ category }: { category: string }) {
    const section =
        sectionForAllPage(category) ??
        navSections.find(s => s.categories.includes(category))?.section ?? "East UI";
    return (
        <Text textStyle="breadcrumb">
            {/* `link` (brand.600 / brand.300) not a raw brand.600 — the latter
             *  stays dark and drops below AA on the dark surface (#362). */}
            <Box as="span" color="link">{section}</Box>
            <Box as="span" px="1">/</Box>
            <Box as="span" color="fg">{category}</Box>
        </Text>
    );
}
