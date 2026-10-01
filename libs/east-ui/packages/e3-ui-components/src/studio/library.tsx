/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioLibrary` — the renderer of the `StudioLibrary`
 * extension declared in `@elaraai/e3-ui` (#997): the page library, built in
 * the browser from its interface — the pages record bound with its patch, the
 * listed components, the project it shows first, the builder it opens pages
 * in, and who to tell.
 *
 * - **One toolbar row**, the shared `Toolbar`: the search over both rows,
 *   Sort · Name, the Pages row's Grid · List, a rule, and the primary
 *   "+ New page in <project>", folded on one ladder.
 * - **The pane**: the projects, the shown one in the brand; the project's
 *   pages with their status dots, the one open in the builder in the strong
 *   ink; the legend at its foot.
 * - **The Templates and Pages rows**, under their heads: two Library
 *   galleries, which draw no toolbar of their own, each card's media a
 *   wireframe of its layout.
 * - **The New page popover**, under the primary action however it opens —
 *   from it, a template's card or the dashed card, which pick its template —
 *   taking a name the project does not hold and a template, or Blank grid.
 *
 * What it shows is e3-ui's East, compiled once ({@link studioEast}); the
 * project shown, the search, the order, the layout and the popover are its
 * own. "Open in builder →" writes the builder's open page, shared by `id`,
 * and tells the host; a new page is one commit through the record's patch
 * write. It draws no border around itself.
 *
 * Its layout is the `studioLibrary` recipe's; its controls are the
 * theme's shared ones — the Library's search box, the `button` recipe, the
 * `seg` strip, the `status` dots, the edit popover and the `select`.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import {
    Box, chakra, createListCollection, Menu as ChakraMenu, Portal, Select as ChakraSelect, useRecipe, useSlotRecipe,
    type SystemStyleObject,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowDownAZ, faArrowDownZA, faCaretDown, faCheck, faFolder, faFolderOpen, faMagnifyingGlass, faPlus, faXmark,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { StudioCellType, StudioLibraryComponent, builderKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, EastChakraLibrary, LibraryLayoutSwitch, SnapGridTiles, Toolbar, implementUIComponent, useFormatters,
    useTrackedEvaluation, type LibraryItemValue, type LibraryValue, type SnapGridLayoutCell, type ToolbarItem,
} from "@elaraai/east-ui-components";

import { NamePopover } from "../shared/name-popover.js";
import { useStudioMessages, type StudioMessages } from "./messages.js";
import { useOpenPage, type StudioKey } from "./open-page.js";
import { studioEast } from "./studio-east.js";

type Styles = Record<string, SystemStyleObject>;

/** The renderer's payload, decoded. */
type StudioLibraryValue = ValueTypeOf<typeof StudioLibraryComponent.schema>;
/** One placement. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** How the rows are ordered by name: A to Z, the record's key order, or Z to A. */
type Sort = "az" | "za";
/** How the Pages row lays its cards out. */
type Layout = "grid" | "list";

/** The toolbar's fold ranks: the primary action drops its project, Sort
 *  folds to its icon, the primary action to its plus, and last the search
 *  narrows twice. The layout switch never folds. */
const RANK = { newPage: 0, sort: 1, newPageIcon: 2, searchMid: 3, searchNarrow: 4 } as const;

/** The orders Sort offers, in its menu's order, with the icon it folds to. */
const SORTS: ReadonlyArray<{ key: Sort; icon: IconDefinition; name: (m: StudioMessages) => string }> = [
    { key: "az", icon: faArrowDownAZ, name: (m) => m.nameAz() },
    { key: "za", icon: faArrowDownZA, name: (m) => m.nameZa() },
];

/** The template picker's value for Blank grid — no template's name can be it. */
const BLANK = "\u0000blank";

/** Props of {@link EastChakraStudioLibrary}. */
export interface EastChakraStudioLibraryProps {
    /** The payload, decoded. */
    value: StudioLibraryValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Sort · Name, opening a menu of the two orders — folded, the trigger is the
 * order's icon, the words its name and tooltip.
 */
function SortMenu({ sort, onPick, compact, trigger, caret, check }: {
    sort: Sort;
    onPick: (sort: Sort) => void;
    compact: boolean;
    trigger: SystemStyleObject;
    caret: SystemStyleObject;
    check: SystemStyleObject;
}) {
    const m = useStudioMessages();
    const current = SORTS.find((s) => s.key === sort) ?? SORTS[0]!;
    const words = m.sortByName();
    return (
        <ChakraMenu.Root positioning={{ placement: "bottom-end" }}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={trigger} data-page-library-sort=""
                    {...(compact ? { "aria-label": words, title: words } : {})}>
                    {compact ? <FontAwesomeIcon icon={current.icon} /> : (
                        <>
                            {words}
                            <Box as="span" css={caret} aria-hidden><FontAwesomeIcon icon={faCaretDown} /></Box>
                        </>
                    )}
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        <ChakraMenu.RadioItemGroup value={sort} onValueChange={(d) => {
                            const picked = SORTS.find((s) => s.key === d.value);
                            if (picked !== undefined && picked.key !== sort) onPick(picked.key);
                        }}>
                            {SORTS.map((s) => (
                                <ChakraMenu.RadioItem key={s.key} value={s.key}>
                                    <Box as="span" css={check}>{s.key === sort && <FontAwesomeIcon icon={faCheck} />}</Box>
                                    {s.name(m)}
                                </ChakraMenu.RadioItem>
                            ))}
                        </ChakraMenu.RadioItemGroup>
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/**
 * Renders the page library — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The page library
 */
export const EastChakraStudioLibrary = memo(function EastChakraStudioLibrary({ value, storageKey }: EastChakraStudioLibraryProps) {
    const styles = useSlotRecipe({ key: "studioLibrary" })() as Styles;
    const library = useSlotRecipe({ key: "library" })() as Styles;
    const edit = useSlotRecipe({ key: "sliceEdit" })() as Styles;
    const status = useSlotRecipe({ key: "status" });
    const liveDot = status({ status: "success" }) as Styles;
    const draftDot = status({ status: "neutral", ring: true }) as Styles;
    const button = useRecipe({ key: "button" });
    const m = useStudioMessages();
    const words = useFormatters();
    const id = useId();
    const east = studioEast();
    const { pages: handle, components } = value;
    const home = value.project;
    const keys = useMemo(() => builderKeys(value.id.type === "some" ? value.id.value : undefined), [value.id]);
    const tellHost = value.onOpen.type === "some" ? value.onOpen.value : undefined;

    // The record, read where the page library renders, and again when it moves.
    const read = useCallback(() => handle.read(), [handle]);
    const { result } = useTrackedEvaluation(read);
    const records = result.ok ? result.value : undefined;

    // Its own view: the project it shows, the search, the order, the Pages
    // row's layout, and the New page popover — the template it starts from,
    // `""` for Blank grid, while it is open.
    const [project, setProject] = useState(home);
    const [text, setText] = useState("");
    const [sort, setSort] = useState<Sort>("az");
    const [layout, setLayout] = useState<Layout>("grid");
    const [popover, setPopover] = useState<string | undefined>(undefined);
    const needle = text.toLowerCase();

    // The builder's open page — the project's first to begin with.
    const first = useMemo((): StudioKey => {
        if (records !== undefined) {
            for (const [key, entry] of records) {
                if (key.project === home && entry.type === "page") return key;
            }
        }
        return { project: home, page: "" };
    }, [records, home]);
    const [open, writeOpen] = useOpenPage(keys.page, first);

    // The rows: the search narrows them by title, and Sort orders them by name
    // — the record's key order, or its reverse.
    const za = sort === "za";
    const everyPage = useMemo(() => (records === undefined ? [] : east.libraryPages(records, project)), [east, records, project]);
    const everyTemplate = useMemo(() => (records === undefined ? [] : east.libraryTemplates(records, project, components)),
        [east, records, project, components]);
    const pageRows = useMemo(() => {
        const matching = everyPage.filter((p) => p.title.toLowerCase().includes(needle));
        return za ? matching.reverse() : matching;
    }, [everyPage, needle, za]);
    const paneRows = useMemo(() => {
        const byName = records === undefined ? [] : east.palettePages(records, project);
        return za ? [...byName].reverse() : byName;
    }, [east, records, project, za]);
    const templateRows = useMemo(() => {
        const matching = everyTemplate.filter((t) => t.title.toLowerCase().includes(needle));
        const ordered = za ? matching.reverse() : matching;
        // Blank grid is built in, first; its name is none a template can have.
        const blank = { name: "", title: m.blankGrid(), summary: m.blankSummary(), cells: [] };
        return m.blankGrid().toLowerCase().includes(needle) ? [blank, ...ordered] : ordered;
    }, [everyTemplate, needle, za, m]);
    const projects = useMemo(() => (records === undefined ? [home] : east.libraryProjects(records, home)), [east, records, home]);
    const taken = useMemo(() => {
        const names = new Set<string>();
        if (records !== undefined) {
            for (const [key] of records) {
                if (key.project === project) names.add(key.page);
            }
        }
        return names;
    }, [records, project]);

    // "Open in builder →": the builder's open page, and the host told.
    const openPage = useCallback((name: string) => {
        const key = { project, page: name };
        writeOpen(key);
        if (tellHost !== undefined) queueMicrotask(() => tellHost(key));
    }, [project, writeOpen, tellHost]);

    // A template's card starts a new page from it, Blank grid's from nothing,
    // and the dashed card from nothing too — each opening the popover under
    // the New page button.
    const startFrom = useCallback((name: string) => setPopover(name), []);
    const startBlank = useCallback(() => setPopover(""), []);
    // Each card's media: a wireframe of its layout, at a twelfth of the page's
    // scale, a content-height placement a KPI's.
    const wireframes = useMemo(() => {
        const out = new Map<string, SnapGridLayoutCell[]>();
        const layouts: ReadonlyArray<readonly [string, readonly Cell[]]> = [
            ...templateRows.map((t) => [`template:${t.name}`, t.cells] as const),
            ...pageRows.map((p) => [`page:${p.page}`, p.cells] as const),
        ];
        for (const [card, cells] of layouts) {
            out.set(card, cells.map((c) => ({
                key: c.key,
                row: c.row,
                span: c.span,
                height: some(c.height.type === "some" ? c.height.value / 12n : 12n),
                align: c.align,
                frame: true,
            })));
        }
        return out;
    }, [templateRows, pageRows]);
    const templateMedia = useCallback((item: LibraryItemValue) => (
        <SnapGridTiles wireframe cells={wireframes.get(`template:${item.key}`) ?? []} content={() => null} />
    ), [wireframes]);
    const pageMedia = useCallback((item: LibraryItemValue) => (
        <SnapGridTiles wireframe cells={wireframes.get(`page:${item.key}`) ?? []} content={() => null} />
    ), [wireframes]);

    const templatesGallery = useMemo((): LibraryValue => ({
        id: `${storageKey}.templates`,
        hint: none,
        items: templateRows.map((t): LibraryItemValue => ({
            key: t.name, label: t.title, sublabel: some(t.summary), icon: none, status: none, trailing: none,
            draggable: false, filtered: false, placed: false, media: none, avatar: none, byline: none, action: none,
            search: none, groups: new Map(), facets: new Map(), dims: new Map(),
        })),
        groupOptions: [], groupSummaries: new Map(), dimOptions: [], defaultDimensions: [], filterOptions: [],
        searchable: false, noun: none, addLabel: none, onAdd: none,
        onCardClick: some((name: string) => { startFrom(name); return null; }),
        slice: none,
        style: some({ height: none, maxHeight: none, virtualization: none, columns: some(4n), mediaPlacement: none, mediaSize: some("80px") }),
        variant: some(variant("gallery", null)),
        layout: none,
        toolbar: false,
    }), [storageKey, templateRows, startFrom]);
    const pagesGallery = useMemo((): LibraryValue => ({
        id: `${storageKey}.pages`,
        hint: none,
        items: pageRows.map((p): LibraryItemValue => ({
            key: p.page, label: p.title,
            sublabel: some(m.placements({ n: p.cells.length, count: words.number(p.cells.length) })),
            icon: none,
            status: some(p.live
                ? { label: m.live(), tone: variant("success", null), ring: false }
                : { label: m.draft(), tone: variant("neutral", null), ring: true }),
            trailing: none, draggable: false, filtered: false, placed: false, media: none, avatar: none, byline: none,
            action: some(m.openInBuilder()),
            search: none, groups: new Map(), facets: new Map(), dims: new Map(),
        })),
        groupOptions: [], groupSummaries: new Map(), dimOptions: [], defaultDimensions: [], filterOptions: [],
        searchable: false, noun: none,
        addLabel: some(m.newPageFromTemplate()),
        onAdd: some(() => { startBlank(); return null; }),
        onCardClick: some((name: string) => { openPage(name); return null; }),
        slice: none,
        style: some({ height: none, maxHeight: none, virtualization: none, columns: some(2n), mediaPlacement: some(variant("start", null)), mediaSize: some("156px") }),
        variant: some(variant("gallery", null)),
        layout: some(layout === "list" ? variant("list", null) : variant("grid", null)),
        toolbar: false,
    }), [storageKey, pageRows, m, words, startBlank, openPage, layout]);

    // The New page popover, and the template it starts from — the one whose
    // card opened it, else Blank grid; each opening starts over.
    const from = popover !== undefined && popover !== "" ? popover : BLANK;
    const [template, setTemplate] = useState(from);
    const [openedFrom, setOpenedFrom] = useState(popover);
    if (popover !== openedFrom) {
        setOpenedFrom(popover);
        if (popover !== undefined) setTemplate(from);
    }
    const picker = useMemo(() => createListCollection({
        items: [{ value: BLANK, label: m.blankGrid() }, ...everyTemplate.map((t) => ({ value: t.name, label: t.title }))],
    }), [everyTemplate, m]);
    // A new page: one commit inserting it, its draft the template's placements.
    const create = async (name: string) => {
        const now = handle.read();
        const key = { project, page: name };
        const patch = east.newPage(now, key, name, template === BLANK ? none : some({ project, page: template }));
        const outcome = await handle.commit.patch("", patch);
        const refused = east.nameWriteRefusal(outcome, name);
        return refused.type === "some" ? refused.value : undefined;
    };

    const np = everyPage.length;
    const nt = everyTemplate.length + 1;
    const shown = pageRows.length;
    const current = open.project === project ? open.page : "";

    // The search box at a width the toolbar folds it to — one element in
    // every form, so the field keeps its focus and its text as the row folds.
    const searchBox = (size: "wide" | "mid" | "narrow") => (
        <Box css={library.searchBox} data-size={size}>
            <Box as="span" css={library.searchIcon} aria-hidden>
                <FontAwesomeIcon icon={faMagnifyingGlass} />
            </Box>
            <chakra.input
                css={library.searchInput}
                placeholder={m.searchLibrary({ pages: words.number(np), templates: words.number(nt), np, nt })}
                aria-label={m.searchLabel()}
                value={text}
                data-page-library-search=""
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Escape" && text !== "") {
                        e.preventDefault();
                        setText("");
                    }
                }}
            />
            {text !== "" && (
                <chakra.button type="button" css={library.searchClear} aria-label={m.clearSearch()} onClick={() => setText("")}>
                    <FontAwesomeIcon icon={faXmark} />
                </chakra.button>
            )}
        </Box>
    );
    const sortMenu = (compact: boolean) => (
        <SortMenu sort={sort} compact={compact} trigger={button({ variant: "outline", size: "sm" }) as SystemStyleObject}
            caret={styles.caret!} check={library.menuCheck!} onPick={setSort} />
    );
    // The primary action, in each of its forms, is the New page popover's trigger.
    const newPage = (form: "full" | "short" | "icon"): ReactNode => (
        <NamePopover
            open={popover !== undefined}
            onOpenChange={(next) => setPopover(next ? "" : undefined)}
            trigger={
                <chakra.button type="button" css={button({ variant: "solid", size: "sm" })} colorPalette="brand" data-page-library-new=""
                    {...(form !== "full" ? { title: m.newPageIn({ project }) } : {})}
                    {...(form === "icon" ? { "aria-label": m.newPageIn({ project }) } : {})}>
                    <Box as="span" css={styles.buttonIcon} aria-hidden><FontAwesomeIcon icon={faPlus} /></Box>
                    {form === "full" ? m.newPageIn({ project }) : form === "short" ? m.newPage() : null}
                </chakra.button>
            }
            label={<>{m.newPage()} · <Box as="span" css={edit.clauseField}>{project}</Box></>}
            placeholder={m.pageName()}
            initial=""
            taken={taken}
            missing={m.pageNameMissing()}
            nameTaken={(name) => m.nameTaken({ name })}
            confirm={m.createPage()}
            cancel={m.cancel()}
            onConfirm={create}
        >
            <ChakraSelect.Root collection={picker} value={[template]} onValueChange={(d) => setTemplate(d.value[0] ?? BLANK)}>
                <ChakraSelect.HiddenSelect />
                <ChakraSelect.Label>{m.template()}</ChakraSelect.Label>
                <ChakraSelect.Control>
                    <ChakraSelect.Trigger data-page-library-template="">
                        <ChakraSelect.ValueText />
                    </ChakraSelect.Trigger>
                    <ChakraSelect.IndicatorGroup>
                        <ChakraSelect.Indicator />
                    </ChakraSelect.IndicatorGroup>
                </ChakraSelect.Control>
                <Portal>
                    <ChakraSelect.Positioner>
                        <ChakraSelect.Content>
                            {picker.items.map((item) => (
                                <ChakraSelect.Item key={item.value} item={item}>
                                    {item.label}
                                    <ChakraSelect.ItemIndicator />
                                </ChakraSelect.Item>
                            ))}
                        </ChakraSelect.Content>
                    </ChakraSelect.Positioner>
                </Portal>
            </ChakraSelect.Root>
        </NamePopover>
    );
    const toolbarItems: ReadonlyArray<ToolbarItem> = [
        {
            key: "search",
            forms: [searchBox("wide"), searchBox("mid"), searchBox("narrow")],
            rank: [RANK.searchMid, RANK.searchNarrow],
        },
        { key: "sort", side: "end", forms: [sortMenu(false), sortMenu(true)], rank: RANK.sort, version: sort },
        {
            key: "layout",
            side: "end",
            forms: [<LibraryLayoutSwitch layout={layout} onPick={setLayout} />],
        },
        { key: "rule", side: "end", forms: [<Box as="span" css={styles.divider} aria-hidden />] },
        {
            key: "new",
            side: "end",
            forms: [newPage("full"), newPage("short"), newPage("icon")],
            rank: [RANK.newPage, RANK.newPageIcon],
            version: project,
        },
    ];

    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return <BannerView status="error" title={message} />;
    }
    return (
        <Box css={styles.root} data-studio-page-library="">
            <Box css={styles.toolbar} data-slot="toolbar">
                <Toolbar items={toolbarItems} />
            </Box>
            <Box css={styles.body}>
                <Box css={styles.pane} data-page-library-pane="">
                    <Box css={styles.paneSection} role="group" aria-labelledby={`${id}-projects`}>
                        <Box css={styles.paneHead}>
                            <Box as="span" id={`${id}-projects`} css={styles.paneCaption}>{m.projects()}</Box>
                        </Box>
                        {projects.map((p) => {
                            const active = p === project;
                            return (
                                <chakra.button key={p} type="button" css={styles.paneRow} data-page-library-project={p}
                                    {...(active ? { "data-active": "", "aria-current": "true" } : {})}
                                    onClick={() => { if (!active) setProject(p); }}>
                                    <Box as="span" css={styles.paneIcon} aria-hidden>
                                        <FontAwesomeIcon icon={active ? faFolderOpen : faFolder} />
                                    </Box>
                                    <Box as="span" css={styles.paneTitle}>{p}</Box>
                                </chakra.button>
                            );
                        })}
                    </Box>
                    <Box css={styles.paneRule} aria-hidden />
                    <Box css={styles.paneSection} role="group" aria-labelledby={`${id}-pages`}>
                        <Box css={styles.paneHead}>
                            <Box as="span" id={`${id}-pages`} css={styles.paneCaption}>{m.pages()}</Box>
                            <Box as="span" css={styles.paneCount}>{words.number(np)}</Box>
                        </Box>
                        {paneRows.map((p) => {
                            const dot = p.live ? liveDot : draftDot;
                            const state = p.live ? m.live() : m.draft();
                            return (
                                <chakra.button key={p.page} type="button" css={styles.paneRow} data-page="" data-page-library-page={p.page}
                                    {...(p.page === current ? { "data-current": "", "aria-current": "page" } : {})}
                                    onClick={() => openPage(p.page)}>
                                    <Box as="span" css={styles.paneTitle}>{p.title}</Box>
                                    <Box as="span" css={dot.root} role="img" aria-label={state} title={state}>
                                        <Box as="span" css={dot.indicator} />
                                    </Box>
                                </chakra.button>
                            );
                        })}
                    </Box>
                    <Box css={styles.legend} data-page-library-legend="">
                        <Box as="span" css={liveDot.root}>
                            <Box as="span" css={liveDot.indicator} />
                            <Box as="span" css={liveDot.label}>{m.live()}</Box>
                        </Box>
                        <Box as="span" css={draftDot.root}>
                            <Box as="span" css={draftDot.indicator} />
                            <Box as="span" css={draftDot.label}>{m.draft()}</Box>
                        </Box>
                    </Box>
                </Box>
                <Box css={styles.main}>
                    <Box as="section" css={styles.section} data-section="templates" aria-labelledby={`${id}-templates`}>
                        <Box css={styles.sectionHead}>
                            <Box as="h3" id={`${id}-templates`} css={styles.sectionTitle}>{m.templates()}</Box>
                            <Box as="span" css={styles.sectionSub}>{m.cloneToStart()}</Box>
                        </Box>
                        <EastChakraLibrary value={templatesGallery} storageKey={`${storageKey}.templates`} renderMedia={templateMedia} />
                    </Box>
                    <Box as="section" css={styles.section} data-section="pages" aria-labelledby={`${id}-rows`}>
                        <Box css={styles.sectionHead}>
                            <Box as="h3" id={`${id}-rows`} css={styles.sectionTitle}>{m.pages()}</Box>
                            <Box as="span" css={styles.sectionSub} data-page-library-shown="">
                                {m.pagesIn({ shown: words.number(shown), total: words.number(np), project, narrowed: shown !== np })}
                            </Box>
                        </Box>
                        <EastChakraLibrary value={pagesGallery} storageKey={`${storageKey}.pages`} renderMedia={pageMedia} />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
});

implementUIComponent(StudioLibraryComponent, EastChakraStudioLibrary);
