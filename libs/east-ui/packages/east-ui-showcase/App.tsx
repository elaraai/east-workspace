/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Box,
    Button,
    Container,
    Flex,
    Heading,
    Input,
    InputGroup,
    Kbd,
    Stack,
    Text,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faMagnifyingGlass,
    faHandPointer,
    faFont,
    faTableCells,
    faBox,
    faIdBadge,
    faBell,
    faRectangleList,
    faCompass,
    faChevronDown,
    faWindowMaximize,
    faTableList,
    faChartLine,
    faPuzzlePiece,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { UIStoreProvider, UIStore, OverlayManagerProvider } from "@elaraai/east-ui-components";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ElaraLogo } from "./components/ElaraLogo";
import { ExampleCard } from "./components/ExampleCard";

// Per-component example module imports. Each entry in SOURCES below pairs a
// module with its preferred column count in the showcase grid.
import * as buttonExamples from "@elaraai/east-ui/examples/buttons/button";
import * as iconButtonExamples from "@elaraai/east-ui/examples/buttons/icon-button";
import * as copyButtonExamples from "@elaraai/east-ui/examples/buttons/copy-button";
import * as closeButtonExamples from "@elaraai/east-ui/examples/buttons/close-button";
import * as toggleExamples from "@elaraai/east-ui/examples/buttons/toggle";
import * as buttonGroupExamples from "@elaraai/east-ui/examples/buttons/button-group";
import * as textExamples from "@elaraai/east-ui/examples/typography/text";
import * as codeExamples from "@elaraai/east-ui/examples/typography/code";
import * as codeBlockExamples from "@elaraai/east-ui/examples/typography/code-block";
import * as headingExamples from "@elaraai/east-ui/examples/typography/heading";
import * as linkExamples from "@elaraai/east-ui/examples/typography/link";
import * as highlightExamples from "@elaraai/east-ui/examples/typography/highlight";
import * as markExamples from "@elaraai/east-ui/examples/typography/mark";
import * as listExamples from "@elaraai/east-ui/examples/typography/list";
import * as numericExamples from "@elaraai/east-ui/examples/typography/numeric";
import * as noteExamples from "@elaraai/east-ui/examples/typography/note";
import * as boxExamples from "@elaraai/east-ui/examples/layout/box";
import * as flexExamples from "@elaraai/east-ui/examples/layout/flex";
import * as gridExamples from "@elaraai/east-ui/examples/layout/grid";
import * as separatorExamples from "@elaraai/east-ui/examples/layout/separator";
import * as splitterExamples from "@elaraai/east-ui/examples/layout/splitter";
import * as stackExamples from "@elaraai/east-ui/examples/layout/stack";
import * as chipRailExamples from "@elaraai/east-ui/examples/layout/chip-rail";
import * as scrollAreaExamples from "@elaraai/east-ui/examples/layout/scroll-area";
import * as stickyExamples from "@elaraai/east-ui/examples/layout/sticky";
import * as cardExamples from "@elaraai/east-ui/examples/container";
import * as badgeExamples from "@elaraai/east-ui/examples/display/badge";
import * as tagExamples from "@elaraai/east-ui/examples/display/tag";
import * as avatarExamples from "@elaraai/east-ui/examples/display/avatar";
import * as statExamples from "@elaraai/east-ui/examples/display/stat";
import * as iconExamples from "@elaraai/east-ui/examples/display/icon";
import * as alertExamples from "@elaraai/east-ui/examples/feedback/alert";
import * as progressExamples from "@elaraai/east-ui/examples/feedback/progress";
import * as emptyStateExamples from "@elaraai/east-ui/examples/feedback/empty-state";
import * as spinnerExamples from "@elaraai/east-ui/examples/feedback/spinner";
import * as skeletonExamples from "@elaraai/east-ui/examples/feedback/skeleton";
import * as statusExamples from "@elaraai/east-ui/examples/feedback/status";
import * as checkboxExamples from "@elaraai/east-ui/examples/forms/checkbox";
import * as switchExamples from "@elaraai/east-ui/examples/forms/switch";
import * as selectExamples from "@elaraai/east-ui/examples/forms/select";
import * as sliderExamples from "@elaraai/east-ui/examples/forms/slider";
import * as textareaExamples from "@elaraai/east-ui/examples/forms/textarea";
import * as tagsInputExamples from "@elaraai/east-ui/examples/forms/tags-input";
import * as fileUploadExamples from "@elaraai/east-ui/examples/forms/file-upload";
import * as fieldExamples from "@elaraai/east-ui/examples/forms/field";
import * as inputExamples from "@elaraai/east-ui/examples/forms/input";
import * as comboboxExamples from "@elaraai/east-ui/examples/forms/combobox";
import * as breadcrumbExamples from "@elaraai/east-ui/examples/navigation";
import * as accordionExamples from "@elaraai/east-ui/examples/disclosure/accordion";
import * as carouselExamples from "@elaraai/east-ui/examples/disclosure/carousel";
import * as tabsExamples from "@elaraai/east-ui/examples/disclosure/tabs";
import * as segmentGroupExamples from "@elaraai/east-ui/examples/disclosure/segment-group";
import * as collapsibleExamples from "@elaraai/east-ui/examples/disclosure/collapsible";
import * as showMoreExamples from "@elaraai/east-ui/examples/disclosure/show-more";
import * as stepsExamples from "@elaraai/east-ui/examples/disclosure/steps";
import * as timelineExamples from "@elaraai/east-ui/examples/disclosure/timeline";
import * as optionListExamples from "@elaraai/east-ui/examples/disclosure/option-list";
import * as tooltipExamples from "@elaraai/east-ui/examples/overlays/tooltip";
import * as menuExamples from "@elaraai/east-ui/examples/overlays/menu";
import * as popoverExamples from "@elaraai/east-ui/examples/overlays/popover";
import * as hoverCardExamples from "@elaraai/east-ui/examples/overlays/hover-card";
import * as dialogExamples from "@elaraai/east-ui/examples/overlays/dialog";
import * as drawerExamples from "@elaraai/east-ui/examples/overlays/drawer";
import * as toggleTipExamples from "@elaraai/east-ui/examples/overlays/toggle-tip";
import * as dataListExamples from "@elaraai/east-ui/examples/collections/data-list";
import * as treeViewExamples from "@elaraai/east-ui/examples/collections/tree-view";
import * as tableExamples from "@elaraai/east-ui/examples/collections/table";
import * as ganttExamples from "@elaraai/east-ui/examples/collections/gantt";
import * as plannerExamples from "@elaraai/east-ui/examples/collections/planner";
import * as areaExamples from "@elaraai/east-ui/examples/charts/area";
import * as barExamples from "@elaraai/east-ui/examples/charts/bar";
import * as barListExamples from "@elaraai/east-ui/examples/charts/bar-list";
import * as barSegmentExamples from "@elaraai/east-ui/examples/charts/bar-segment";
import * as composedExamples from "@elaraai/east-ui/examples/charts/composed";
import * as lineExamples from "@elaraai/east-ui/examples/charts/line";
import * as pieExamples from "@elaraai/east-ui/examples/charts/pie";
import * as radarExamples from "@elaraai/east-ui/examples/charts/radar";
import * as scatterExamples from "@elaraai/east-ui/examples/charts/scatter";
import * as sparklineExamples from "@elaraai/east-ui/examples/charts/sparkline";
import * as integrationExamples from "@elaraai/east-ui/examples/integration";

interface CatalogEntry {
    name: string;
    category: string;
    keywords: string[];
    description: string;
    fn: any;
    inputs: any[];
    /** Target column width in the showcase grid — 1 = full-width, 2 = half, 3 = third. */
    columns: number;
    /** Pixel height for the rendered example body (default 280). */
    bodyHeight: number;
}

/**
 * Each row: [sub-component display name, sidebar category, example module, grid column count,
 * optional body pixel height]. Entries sharing both columns and bodyHeight are grouped into
 * the same virtualized row.
 *   Columns = 3 for narrow components (lists, badges), 2 for medium, 1 for wide (tables, charts).
 *   bodyHeight defaults to 280 — override when a demo needs more vertical room.
 */
const SOURCES: [string, string, Record<string, unknown>, number, number?][] = [
    ["SalesDashboard", "Integration", integrationExamples, 1, 680],
    ["Button",       "Buttons",     buttonExamples,       3],
    ["IconButton",   "Buttons",     iconButtonExamples,   3],
    ["CopyButton",   "Buttons",     copyButtonExamples,   3],
    ["CloseButton",  "Buttons",     closeButtonExamples,  3],
    ["Toggle",       "Buttons",     toggleExamples,       3],
    ["ButtonGroup",  "Buttons",     buttonGroupExamples,  2],
    ["Text",        "Typography",  textExamples,        3],
    ["Code",        "Typography",  codeExamples,        3],
    ["CodeBlock",   "Typography",  codeBlockExamples,   2],
    ["Heading",     "Typography",  headingExamples,     3],
    ["Link",        "Typography",  linkExamples,        3],
    ["Highlight",   "Typography",  highlightExamples,   3],
    ["Mark",        "Typography",  markExamples,        3],
    ["List",        "Typography",  listExamples,        3],
    ["Numeric",     "Typography",  numericExamples,     3],
    ["Note",        "Typography",  noteExamples,        2],
    ["Box",         "Layout",      boxExamples,         3],
    ["Flex",        "Layout",      flexExamples,        2],
    ["Grid",        "Layout",      gridExamples,        2],
    ["Separator",   "Layout",      separatorExamples,   3],
    ["Splitter",    "Layout",      splitterExamples,    1],
    ["Stack",       "Layout",      stackExamples,       2],
    ["ChipRail",    "Layout",      chipRailExamples,    2],
    ["ScrollArea",  "Layout",      scrollAreaExamples,  2],
    ["Sticky",      "Layout",      stickyExamples,      2],
    ["Card",        "Container",   cardExamples,        2],
    ["Badge",       "Display",     badgeExamples,       3],
    ["Tag",         "Display",     tagExamples,         3],
    ["Avatar",      "Display",     avatarExamples,      3],
    ["Stat",        "Display",     statExamples,        3],
    ["Icon",        "Display",     iconExamples,        3],
    ["Alert",       "Feedback",    alertExamples,       2],
    ["Progress",    "Feedback",    progressExamples,    2],
    ["EmptyState",  "Feedback",    emptyStateExamples,  2],
    ["Spinner",     "Feedback",    spinnerExamples,     3],
    ["Skeleton",    "Feedback",    skeletonExamples,    2],
    ["Status",      "Feedback",    statusExamples,      3],
    ["Checkbox",    "Forms",       checkboxExamples,    3],
    ["Switch",      "Forms",       switchExamples,      3],
    ["Select",      "Forms",       selectExamples,      2],
    ["Slider",      "Forms",       sliderExamples,      2],
    ["Textarea",    "Forms",       textareaExamples,    2],
    ["TagsInput",   "Forms",       tagsInputExamples,   2],
    ["FileUpload",  "Forms",       fileUploadExamples,  2],
    ["Field",       "Forms",       fieldExamples,       2],
    ["Input",       "Forms",       inputExamples,       2],
    ["Combobox",    "Forms",       comboboxExamples,    2],
    ["Breadcrumb",  "Navigation",  breadcrumbExamples,  2],
    ["Accordion",   "Disclosure",  accordionExamples,   2],
    ["Carousel",    "Disclosure",  carouselExamples,    1],
    ["Tabs",        "Disclosure",  tabsExamples,        2],
    ["SegmentGroup","Disclosure",  segmentGroupExamples,2],
    ["Collapsible", "Disclosure",  collapsibleExamples, 2],
    ["Disclosure",  "Disclosure",  showMoreExamples,    2],
    ["Steps",       "Disclosure",  stepsExamples,       1],
    ["Timeline",    "Disclosure",  timelineExamples,    1],
    ["OptionList",  "Disclosure",  optionListExamples,  2],
    ["Tooltip",     "Overlays",    tooltipExamples,     3],
    ["Menu",        "Overlays",    menuExamples,        3],
    ["Popover",     "Overlays",    popoverExamples,     3],
    ["HoverCard",   "Overlays",    hoverCardExamples,   3],
    ["Dialog",      "Overlays",    dialogExamples,      2],
    ["Drawer",      "Overlays",    drawerExamples,      2],
    ["ToggleTip",   "Overlays",    toggleTipExamples,   3],
    ["DataList",    "Collections", dataListExamples,    3],
    ["TreeView",    "Collections", treeViewExamples,    3],
    ["Table",       "Collections", tableExamples,       1],
    ["Gantt",       "Collections", ganttExamples,       1],
    ["Planner",     "Collections", plannerExamples,     1],
    ["Area",        "Charts",      areaExamples,        1],
    ["Bar",         "Charts",      barExamples,         1],
    ["BarList",     "Charts",      barListExamples,     2],
    ["BarSegment",  "Charts",      barSegmentExamples,  2],
    ["Composed",    "Charts",      composedExamples,    1],
    ["Line",        "Charts",      lineExamples,        1],
    ["Pie",         "Charts",      pieExamples,         2],
    ["Radar",       "Charts",      radarExamples,       2],
    ["Scatter",     "Charts",      scatterExamples,     1],
    ["Sparkline",   "Charts",      sparklineExamples,   3],
];

function buildCatalog(): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    for (const [, category, mod, columns, bodyHeight] of SOURCES) {
        for (const [name, ex] of Object.entries(mod)) {
            const e = ex as any;
            entries.push({
                name,
                category,
                keywords: e.keywords,
                description: e.description,
                fn: e.fn,
                inputs: e.inputs,
                columns,
                bodyHeight: bodyHeight ?? 280,
            });
        }
    }
    return entries;
}

const catalog = buildCatalog();
const categories = [...new Set(catalog.map(e => e.category))];
const store = new UIStore();

const CATEGORY_ICONS: Record<string, IconDefinition> = {
    Integration: faPuzzlePiece,
    Buttons: faHandPointer,
    Typography: faFont,
    Layout: faTableCells,
    Container: faBox,
    Display: faIdBadge,
    Feedback: faBell,
    Forms: faRectangleList,
    Navigation: faCompass,
    Disclosure: faChevronDown,
    Overlays: faWindowMaximize,
    Collections: faTableList,
    Charts: faChartLine,
};
// Card chrome (description + keyword tags + padding) adds ~110px on top of the body.
const CARD_CHROME = 110;
const GAP = 16;

function useViewportWidth(): number {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const onResize = () => setW(window.innerWidth);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return w;
}

/** Clamp each entry's preferred column count to what fits in the viewport. */
function columnsForEntry(e: CatalogEntry, viewportW: number): number {
    if (viewportW < 768) return 1;
    if (viewportW < 1280) return Math.min(e.columns, 2);
    return e.columns;
}

interface Row { entries: CatalogEntry[]; cols: number; bodyHeight: number; rowHeight: number }

/**
 * Group consecutive entries that share both column count and body height into
 * rows. Mixed-width sections (narrow DataLists followed by wide Tables) and
 * mixed-height sections (short cards followed by the tall dashboard) render in
 * a single virtualized scroll container.
 */
function buildRows(entries: CatalogEntry[], viewportW: number): Row[] {
    const out: Row[] = [];
    let buf: CatalogEntry[] = [];
    let bufCols: number | null = null;
    let bufHeight: number | null = null;
    const flush = () => {
        if (buf.length === 0 || bufCols === null || bufHeight === null) return;
        const rowHeight = bufHeight + CARD_CHROME;
        for (let i = 0; i < buf.length; i += bufCols) {
            out.push({ entries: buf.slice(i, i + bufCols), cols: bufCols, bodyHeight: bufHeight, rowHeight });
        }
        buf = [];
    };
    for (const e of entries) {
        const cols = columnsForEntry(e, viewportW);
        if ((bufCols !== null && cols !== bufCols) || (bufHeight !== null && e.bodyHeight !== bufHeight)) flush();
        bufCols = cols;
        bufHeight = e.bodyHeight;
        buf.push(e);
    }
    flush();
    return out;
}

export function App() {
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string>(categories[0]);

    const filtered = useMemo<CatalogEntry[]>(() => {
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

    return (
        <UIStoreProvider store={store}>
            <OverlayManagerProvider>
                <Flex minH="100vh" bg="gray.50" _dark={{ bg: "gray.900" }}>
                    <Box
                        w="220px"
                        minH="100vh"
                        bg="white"
                        _dark={{ bg: "gray.800" }}
                        borderRightWidth="1px"
                        borderColor="gray.200"
                        py="6"
                        px="4"
                        flexShrink={0}
                        position="sticky"
                        top="0"
                        alignSelf="flex-start"
                        h="100vh"
                        overflowY="auto"
                    >
                        <Flex align="center" gap="2" mb="6">
                            <ElaraLogo height="24px" />
                            <Text fontSize="sm" fontWeight="semibold">East UI</Text>
                        </Flex>

                        <Stack gap="1">
                            {categories.map(cat => {
                                const count = catalog.filter(e => e.category === cat).length;
                                const isActive = selectedCategory === cat;
                                const icon = CATEGORY_ICONS[cat];
                                return (
                                    <Button
                                        key={cat}
                                        variant={isActive ? "subtle" : "ghost"}
                                        colorPalette={isActive ? "blue" : undefined}
                                        justifyContent="flex-start"
                                        w="full"
                                        size="sm"
                                        onClick={() => setSelectedCategory(cat)}
                                    >
                                        {icon && <FontAwesomeIcon icon={icon} fixedWidth />}
                                        {cat} ({count})
                                    </Button>
                                );
                            })}
                        </Stack>
                    </Box>

                    <Box flex="1" p="2" minW={0}>
                        <Container maxW="full" w="full">
                            <Flex align="center" justify="space-between" mb="6">
                                <Heading size="lg">{selectedCategory}</Heading>
                                <InputGroup
                                    maxW="300px"
                                    startElement={<FontAwesomeIcon icon={faMagnifyingGlass} />}
                                    endElement={<Kbd>⌘K</Kbd>}
                                >
                                    <Input
                                        placeholder="Search examples..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        bg="white"
                                        _dark={{ bg: "gray.800" }}
                                    />
                                </InputGroup>
                            </Flex>

                            {filtered.length === 0
                                ? <Text color="gray.400">No examples match your search.</Text>
                                : <VirtualizedGrid entries={filtered} />}
                        </Container>
                    </Box>
                </Flex>
            </OverlayManagerProvider>
        </UIStoreProvider>
    );
}

/**
 * Virtualizes the grid by row using TanStack Virtual against a scrollable
 * parent. Only rows currently in or near the viewport are mounted, so even
 * 130+ Chart cards don't all mount on category switch.
 */
function VirtualizedGrid({ entries }: { entries: CatalogEntry[] }) {
    const viewportWidth = useViewportWidth();
    const rows = useMemo(() => buildRows(entries, viewportWidth), [entries, viewportWidth]);
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (i) => rows[i].rowHeight,
        overscan: 2,
        gap: GAP,
    });

    // Reset scroll on entry-set change so switching to a shorter category
    // doesn't leave us pinned at an out-of-range offset.
    useEffect(() => {
        parentRef.current?.scrollTo({ top: 0 });
    }, [entries]);

    return (
        <Box ref={parentRef} h="calc(100vh - 120px)" overflow="auto">
            <Box position="relative" h={`${virtualizer.getTotalSize()}px`} w="full">
                {virtualizer.getVirtualItems().map(virtualRow => {
                    const row = rows[virtualRow.index];
                    return (
                        <Box
                            key={virtualRow.key}
                            position="absolute"
                            top="0"
                            left="0"
                            w="full"
                            h={`${row.rowHeight}px`}
                            transform={`translateY(${virtualRow.start}px)`}
                            display="grid"
                            gridTemplateColumns={`repeat(${row.cols}, minmax(0, 1fr))`}
                            gap={`${GAP}px`}
                        >
                            {row.entries.map(entry => (
                                <ExampleCard
                                    key={entry.name}
                                    name={entry.name}
                                    example={entry}
                                    bodyHeight={`${row.bodyHeight}px`}
                                />
                            ))}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}
