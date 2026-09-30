/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioLibrary` — the renderer of the `StudioLibrary`
 * extension declared in `@elaraai/e3-ui` (#997): the page library's frame.
 *
 * - **One toolbar row**, the shared `Toolbar`: the search over both rows,
 *   Sort · Name, the Pages row's Grid · List, a rule, and the primary
 *   "+ New page in <project>", folded on one ladder.
 * - **The pane**: the projects, the shown one in the brand; the project's
 *   pages with their status dots, the one open in the builder in the strong
 *   ink; the legend at its foot.
 * - **The Templates and Pages rows**, under their heads: the payload's own
 *   Library galleries, which draw no toolbar of their own.
 * - **The New page popover**, under the primary action however it opens —
 *   from it, a template's card or the dashed card, which pick its template —
 *   taking a name the project does not hold and a template, or Blank grid.
 *
 * Everything it changes is the page library's East State, through the
 * payload's callbacks, and a new page is the payload's one commit.
 *
 * Its layout is the `studioLibrary` recipe's; its controls are the
 * theme's shared ones — the Library's search box, the `button` recipe, the
 * `seg` strip, the `status` dots, the edit popover and the `select`.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useId, useMemo, useState, type ReactNode } from "react";
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
import { StudioLibraryComponent } from "@elaraai/e3-ui/internal";
import {
    EastChakraComponent, LibraryLayoutSwitch, Toolbar, implementUIComponent, useFormatters, type ToolbarItem,
} from "@elaraai/east-ui-components";

import { useStudioMessages, type StudioMessages } from "./messages.js";
import { NamePopover } from "./name-popover.js";

type Styles = Record<string, SystemStyleObject>;

/** The renderer's payload, decoded. */
type StudioLibraryValue = ValueTypeOf<typeof StudioLibraryComponent.schema>;
/** How the rows are ordered. */
type Sort = StudioLibraryValue["sort"]["type"];

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
    const { onQuery, onSort, onLayout, onProject, onOpen, onPopover, onCreate } = value;

    // The search's text is East's; the field keeps its own while East takes it.
    const [text, setText] = useState(value.query);
    useEffect(() => { setText(value.query); }, [value.query]);
    const search = (next: string) => {
        setText(next);
        queueMicrotask(() => onQuery(next));
    };

    // The rows, as the payload's own East functions draw them.
    const templatesView = value.templatesView;
    const pagesView = value.pagesView;
    const templates = useMemo(() => templatesView(), [templatesView]);
    const pages = useMemo(() => pagesView(), [pagesView]);

    // The New page popover, and the template it starts from — the one whose
    // card opened it, else Blank grid; each opening starts over.
    const popover = value.popover;
    const from = popover.type === "open" && popover.value !== "" ? popover.value : BLANK;
    const opening = popover.type === "open" ? from : undefined;
    const [template, setTemplate] = useState(from);
    const [openedFrom, setOpenedFrom] = useState(opening);
    if (opening !== openedFrom) {
        setOpenedFrom(opening);
        if (opening !== undefined) setTemplate(opening);
    }
    const picker = useMemo(() => createListCollection({
        items: [{ value: BLANK, label: m.blankGrid() }, ...value.templates.map((t) => ({ value: t.name, label: t.title }))],
    }), [value.templates, m]);

    const project = value.project;
    const np = Number(value.counts.pages);
    const nt = Number(value.counts.templates);
    const shown = Number(value.counts.shownPages);

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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => search(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Escape" && text !== "") {
                        e.preventDefault();
                        search("");
                    }
                }}
            />
            {text !== "" && (
                <chakra.button type="button" css={library.searchClear} aria-label={m.clearSearch()} onClick={() => search("")}>
                    <FontAwesomeIcon icon={faXmark} />
                </chakra.button>
            )}
        </Box>
    );
    const sortMenu = (compact: boolean) => (
        <SortMenu sort={value.sort.type} compact={compact} trigger={button({ variant: "outline", size: "sm" }) as SystemStyleObject}
            caret={styles.caret!} check={library.menuCheck!}
            onPick={(next) => queueMicrotask(() => onSort(variant(next, null)))} />
    );
    // The primary action, in each of its forms, is the New page popover's trigger.
    const newPage = (form: "full" | "short" | "icon"): ReactNode => (
        <NamePopover
            open={popover.type === "open"}
            onOpenChange={(next) => queueMicrotask(() => onPopover(next ? variant("open", "") : variant("closed", null)))}
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
            taken={value.taken}
            missing={m.pageNameMissing()}
            confirm={m.createPage()}
            onConfirm={async (name) => {
                const refused = await onCreate({ name, template: template === BLANK ? none : some(template) });
                return refused.type === "some" ? refused.value : undefined;
            }}
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
        { key: "sort", side: "end", forms: [sortMenu(false), sortMenu(true)], rank: RANK.sort, version: value.sort.type },
        {
            key: "layout",
            side: "end",
            forms: [<LibraryLayoutSwitch layout={value.layout.type} onPick={(next) => queueMicrotask(() => onLayout(variant(next, null)))} />],
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
                        {value.projects.map((p) => {
                            const active = p === project;
                            return (
                                <chakra.button key={p} type="button" css={styles.paneRow} data-page-library-project={p}
                                    {...(active ? { "data-active": "", "aria-current": "true" } : {})}
                                    onClick={() => { if (!active) queueMicrotask(() => onProject(p)); }}>
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
                        {value.pages.map((p) => {
                            const dot = p.live ? liveDot : draftDot;
                            const state = p.live ? m.live() : m.draft();
                            return (
                                <chakra.button key={p.page} type="button" css={styles.paneRow} data-page="" data-page-library-page={p.page}
                                    {...(p.page === value.current ? { "data-current": "", "aria-current": "page" } : {})}
                                    onClick={() => queueMicrotask(() => onOpen(p.page))}>
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
                        <EastChakraComponent value={templates} storageKey={`${storageKey}.templates`} />
                    </Box>
                    <Box as="section" css={styles.section} data-section="pages" aria-labelledby={`${id}-rows`}>
                        <Box css={styles.sectionHead}>
                            <Box as="h3" id={`${id}-rows`} css={styles.sectionTitle}>{m.pages()}</Box>
                            <Box as="span" css={styles.sectionSub} data-page-library-shown="">
                                {m.pagesIn({ shown: words.number(shown), total: words.number(np), project, narrowed: shown !== np })}
                            </Box>
                        </Box>
                        <EastChakraComponent value={pages} storageKey={`${storageKey}.pages`} />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
});

implementUIComponent(StudioLibraryComponent, EastChakraStudioLibrary);
