/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioLibrary` — the renderer of the `StudioLibrary` extension
 * declared in `@elaraai/e3-ui` (#997, #1762): the page library, a
 * builder-frame component — one toolbar over a grid of cards, and no pane.
 *
 * - **The toolbar**, the frame's one row: Pages · Templates, where its slice
 *   has a `templates` source; the rail's fields of the view it shows, their
 *   search, the presets and the count; then New page, which follows the rail
 *   (L12): with one project chosen it reads "New page in Ops console" and
 *   starts there; otherwise its popover asks for the project.
 * - **The cards**, main: the pages — or the templates — the rail narrows to,
 *   in the order e3 pages them, as the shared paged gallery: as many across as
 *   fit, a window read and a screenful mounted at a time. A card is the
 *   Library's gallery card: a wireframe of its layout; its title; what it
 *   places — "KPI rail ×2 · Revenue trend"; its tags; and a foot holding its
 *   project and how many components it places, then Open in builder, or Start
 *   a page on a template's. Nothing on it says Live or Draft (L9).
 * - **Opening**: a press on a page's card, or ⏎ or Space with the keyboard on
 *   it, tells the host which page is asked for, in a turn of its own, and does
 *   nothing else; the page the host says is open is marked. A press on a
 *   template's card opens New page, starting from that template.
 * - **New page**: in the edit popover under New page, a name, the project
 *   where the rail has chosen none, and tags; one commit through the record's
 *   patch write, the page the template's layout or a blank grid. A name the
 *   project holds — a page's or a template's — is refused by the commit, in the
 *   popover. Once it commits, the host is told the new page (L10).
 *
 * It reads the record a window at a time, through the slice, and never whole:
 * a card is a row of a page e3 read, and a new page is a patch built from what
 * its card and its popover hold. It shares no store entry with a builder
 * (#1668), and draws no border around itself.
 *
 * It draws nothing of its own recipe's: the grid, a card and New page are the
 * `library` recipe's — the parts every library of cards shares
 * (`shared/slice-gallery.tsx`) — a card's media the snap grid's wireframe,
 * Pages · Templates the `seg` strip, and New page's popover the edit popover's,
 * its fields the shared form's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { faFileLines, faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import {
    SetType, StringType, StructType, defaultValue, equalFor, equivalentFor, isValueOf, none, printFor, some,
    type ValueTypeOf, type option,
} from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import type { RecordSliceEntry } from "@elaraai/east-ui/internal";
import { StudioCellType, StudioEntryType, StudioKeyType, StudioLibraryComponent, StudioLibraryPayloadType } from "@elaraai/e3-ui/internal";
import {
    BuilderFrame, FieldForm, SnapGridTiles, getSomeorUndefined, implementUIComponent, useFormatters, usePersistedState,
    type Formatters, type LibraryItemValue, type SnapGridLayoutCell, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { keptRead, useSlotStyles, type PagedLibraryGallery } from "@elaraai/east-ui-components/internal";
import { useEquivalent } from "../shared/equivalent.js";
import { NamePopover } from "../shared/name-popover.js";
import { tellHost } from "../shared/open.js";
import { entryRow } from "../shared/records/entry-row.js";
import { Seg, SegMenu } from "../shared/schedule/segments.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { LibraryNewButton, SliceGallery, libraryCardMarks, libraryGallery, useLibraryRail, useRailValue } from "../shared/slice-gallery.js";
import { useStudioMessages, type StudioMessages } from "./messages.js";
import { studioEast } from "./studio-east.js";

/** The renderer's payload, decoded. */
type StudioLibraryValue = ValueTypeOf<typeof StudioLibraryComponent.schema>;
/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;
/** An entry of the pages record. */
type Entry = ValueTypeOf<typeof StudioEntryType>;
/** One placement. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** An entry of the pages record, as a source's page holds it: its key, and the entry. */
interface PageRow {
    readonly key: Key;
    readonly entry: Entry;
}
/** What the cards are: the pages, or the templates. */
type View = "pages" | "templates";
/** Where New page starts from while its popover is open: a template's card, or none — a blank grid. */
interface Starting {
    readonly from: PageRow | undefined;
}

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(StudioLibraryPayloadType);
/**
 * Its write, who it tells, the components and the slice, by the same equivalence: each kept while a new payload's is
 * equivalent (`useEquivalent`), so a press — which moves the open page alone — makes none of them again, nor the cards,
 * the rail and the reads over them.
 */
const pagesEquivalent = equivalentFor(StudioLibraryPayloadType.fields.pages);
const onOpenEquivalent = equivalentFor(StudioLibraryPayloadType.fields.onOpen);
const componentsEquivalent = equivalentFor(StudioLibraryPayloadType.fields.components);
const sliceEquivalent = equivalentFor(StudioLibraryPayloadType.fields.slice);
const keyEqual = equalFor(StudioKeyType);
const textEqual = equalFor(StringType);
/** A card's key: its page's key, as East prints it. */
const printKey = printFor(StudioKeyType);

/** Each view's source in the slice. */
const SOURCE: Readonly<Record<View, string>> = { pages: "rows", templates: "templates" };
/** The pages' field New page follows (L12): the one project the rail has chosen. */
const PROJECT_FIELD = "project";

/** A new page's tags, as its popover's form holds them. */
const TagsType = SetType(StringType);
type Tags = ValueTypeOf<typeof TagsType>;
/** What New page's form edits: the project, where the rail has chosen none, and the tags. */
const ProjectFormType = StructType({ project: StringType, tags: TagsType });
const TagsFormType = StructType({ tags: TagsType });
/** No tags. */
const NO_TAGS: Tags = defaultValue(TagsType);
/** No name is taken before the commit: the library holds no page's name, and the commit refuses one the project holds. */
const NONE_TAKEN: ReadonlySet<string> = new Set();

/** The view a viewer last showed, as storage keeps it. */
const readView = keptRead.record<{ view: View }>({ view: keptRead.oneOf("pages", "templates") });

/**
 * A page's row, as a source of the pages record reads it: its key and the entry it holds — the row it joins, or the
 * one its index carries (`entryRow`) — each checked of its type.
 *
 * @param entry - An entry of a page of the source
 * @returns The row; `undefined` for an entry that holds none, or a row of another type
 */
function pageRow(entry: RecordSliceEntry): PageRow | undefined {
    const row = entryRow(entry);
    return isValueOf(entry.key, StudioKeyType) && isValueOf(row, StudioEntryType) ? { key: entry.key as Key, entry: row as Entry } : undefined;
}

/** A placement holds no content in a wireframe: its frame alone. */
const noContent = () => null;

/** A layout's wireframe — a card's media: the snap grid, a frame a placement, at a twelfth of the page's scale. */
const LayoutWireframe = memo(function LayoutWireframe({ cells }: { cells: readonly Cell[] }) {
    const tiles = useMemo(() => cells.map((cell): SnapGridLayoutCell => ({
        key: cell.key, row: cell.row, span: cell.span,
        height: some(cell.height.type === "some" ? cell.height.value / 12n : 12n),
        align: cell.align, frame: true,
    })), [cells]);
    return <SnapGridTiles wireframe cells={tiles} content={noContent} />;
});

/**
 * An entry's card, as the Library's gallery card draws it: its title, and Open while it is the page its host says is
 * open, which is then the card marked; what it places; its tags; and a foot holding its project and how many
 * components it places, then Open in builder — or, on a template's, Start a page.
 *
 * @param row - The entry, and its key
 * @param view - Whether it is a page's card or a template's
 * @param open - Whether it is the page its host says is open
 * @param summary - What its layout places, in words
 * @param m - The words
 * @param words - The locale's formatters
 * @returns The card
 */
function entryItem(row: PageRow, view: View, open: boolean, summary: string, m: StudioMessages, words: Formatters): LibraryItemValue {
    const n = row.entry.draft.cells.length;
    return {
        key: printKey(row.key), label: row.entry.title,
        sublabel: some(textEqual(summary, "") ? m.blankSummary() : summary),
        icon: none,
        trailing: none, draggable: false, filtered: false, media: none, avatar: none,
        byline: some(m.entryByline({ project: row.key.project, placements: m.placements({ n, count: words.number(n) }) })),
        action: some(view === "pages" ? m.openInBuilder() : m.startFromTemplate()),
        search: none, groups: new Map(), facets: new Map(),
        ...libraryCardMarks(open, m.openNow(), row.entry.tags),
    };
}

/**
 * A view's gallery: each entry the Library's gallery card ({@link entryItem}), its media its layout's wireframe. A
 * press on a card is told the entry its card was drawn from, so the library holds none of the rows it draws. What a
 * layout places is worked out once an entry, and kept as the view and the open page move: a press marks another card,
 * and works out none again.
 *
 * @param view - The pages, or the templates
 * @param open - The page its host says is open
 * @param components - The listed components: what a summary names
 * @param onPress - Told the entry whose card was pressed
 * @returns The gallery the paged gallery draws
 */
function useEntryGallery(view: View, open: option<Key>, components: StudioLibraryValue["components"], onPress: (row: PageRow) => void): PagedLibraryGallery<PageRow> {
    const m = useStudioMessages();
    const words = useFormatters();
    const summaryOf = useMemo(() => {
        const east = studioEast();
        const summaries = new WeakMap<Entry, string>();
        return (row: PageRow): string => {
            const held = summaries.get(row.entry);
            if (held !== undefined) return held;
            const summary = east.layoutSummary(components, row.entry.draft.cells);
            summaries.set(row.entry, summary);
            return summary;
        };
    }, [components]);
    return useMemo((): PagedLibraryGallery<PageRow> => libraryGallery({
        item: (row) => entryItem(row, view, view === "pages" && open.type === "some" && keyEqual(open.value, row.key), summaryOf(row), m, words),
        media: (row) => <LayoutWireframe cells={row.entry.draft.cells} />,
        onOpen: (_key, row) => onPress(row),
    }), [view, open, summaryOf, onPress, m, words]);
}

/** Props of {@link NewPage}. */
interface NewPageProps {
    /** Its full words, or its plus alone: the toolbar's folded form. */
    readonly labelled: boolean;
    /** The one project the rail has chosen (L12); `undefined` while it has chosen none, or several. */
    readonly fixed: string | undefined;
    /** Where it starts from while its popover is open; `undefined` while it is closed. */
    readonly starting: Starting | undefined;
    /** Opens its popover from a blank grid, or closes it. */
    readonly onStarting: (next: Starting | undefined) => void;
    /** The project its popover offers while the rail has chosen none. */
    readonly home: string;
    /** Makes the page: its key, the layout it starts from and its tags — resolving to what refused it, or `undefined` once it is made. */
    readonly onCreate: (key: Key, from: PageRow | undefined, tags: Tags) => Promise<string | undefined>;
}

/**
 * New page (L12), and its popover: a name, the project where the rail has chosen none — the template's, else the
 * library's own — and tags, over Cancel and Create page. It hangs from the button, however it opens.
 */
function NewPage({ labelled, fixed, starting, onStarting, home, onCreate }: NewPageProps) {
    const m = useStudioMessages();
    const edit = useSlotStyles("sliceEdit");
    const label = fixed === undefined ? m.newPage() : m.newPageIn({ project: fixed });
    const open = starting !== undefined;
    // The form as it was last told — a tag typed and left for Create is told as the press lands, whether or not the
    // popover has drawn again by then. Each opening starts from the project it offers, and no tags.
    const offered = starting?.from?.key.project ?? home;
    const [form, setForm] = useState({ project: offered, tags: NO_TAGS });
    const latest = useRef(form);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            latest.current = { project: offered, tags: NO_TAGS };
            setForm(latest.current);
        }
    }
    const specs = useMemo(() => (fixed === undefined
        ? Fields.specs(ProjectFormType, { project: Fields.text({ label: m.pageProject() }), tags: Fields.tags({ label: m.tags(), help: m.pageTagsHelp() }) })
        : Fields.specs(TagsFormType, { tags: Fields.tags({ label: m.tags(), help: m.pageTagsHelp() }) })), [fixed, m]);
    const value = useMemo(() => (fixed === undefined ? form : { tags: form.tags }), [fixed, form]);
    const onField = useCallback((path: readonly string[], next: unknown) => {
        latest.current = path[0] === "project" ? { ...latest.current, project: next as string } : { ...latest.current, tags: next as Tags };
        setForm(latest.current);
    }, []);
    const create = (name: string) => {
        const project = (fixed ?? latest.current.project).trim();
        if (textEqual(project, "")) return Promise.resolve(m.pageProjectMissing());
        return onCreate({ project, page: name }, starting?.from, latest.current.tags);
    };
    return (
        <NamePopover
            open={open}
            onOpenChange={(next) => onStarting(next ? { from: undefined } : undefined)}
            trigger={<LibraryNewButton label={label} labelled={labelled} data-page-library-new={fixed ?? ""} />}
            label={fixed === undefined ? m.newPage() : <>{m.newPage()} · <Box as="span" css={edit.clauseField}>{fixed}</Box></>}
            placeholder={m.pageName()}
            initial=""
            taken={NONE_TAKEN}
            missing={m.pageNameMissing()}
            nameTaken={(name) => m.nameTaken({ name })}
            confirm={m.createPage()}
            cancel={m.cancel()}
            onConfirm={create}
        >
            <Box as="span" css={edit.hint} data-page-library-from="">{m.startsFrom({ template: starting?.from?.entry.title })}</Box>
            <Box data-page-library-form="">
                {/* Live: a project typed is told as it is typed, so Create — a press that may move no focus — reads it. */}
                <FieldForm specs={specs} value={value} onChange={onField} live />
            </Box>
        </NamePopover>
    );
}

/** Props of {@link EastChakraStudioLibrary}. */
export interface EastChakraStudioLibraryProps {
    /** The payload, decoded. */
    value: StudioLibraryValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders the page library — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The page library
 */
export const EastChakraStudioLibrary = memo(function EastChakraStudioLibrary({ value, storageKey }: EastChakraStudioLibraryProps) {
    const m = useStudioMessages();
    const id = getSomeorUndefined(value.id);
    const libraryKey = id === undefined ? "studio.library" : `studio.library.${id}`;
    // Its write, who to tell, the components and the slice: each the payload's last one while a new payload's is
    // equivalent, so a press, which moves the open page alone, makes none of them again.
    const pages = useEquivalent(value.pages, pagesEquivalent);
    const onOpen = useEquivalent(value.onOpen, onOpenEquivalent);
    const components = useEquivalent(value.components, componentsEquivalent);
    const chrome = useEquivalent(value.slice, sliceEquivalent);
    const parts = useMemo(() => ({ pages: sourcePart(chrome, SOURCE.pages), templates: sourcePart(chrome, SOURCE.templates) }), [chrome]);

    // The view shown: the pages, or — where the slice has them — the templates; the viewer's, kept.
    const { state: kept, setState: setKept } = usePersistedState<{ view: View }>(`${storageKey}.${libraryKey}.view`, { view: "pages" }, readView);
    const view: View = parts.templates === undefined ? "pages" : kept.view;
    const pickView = useCallback((next: View) => setKept({ view: next }), [setKept]);
    const shown = parts[view];

    // The rail, the shown view's source's fields alone, each source counted in its noun; then New page, which follows it.
    const nouns = useMemo(() => ({ [SOURCE.pages]: m.pageNoun().plural, [SOURCE.templates]: m.templateNoun().plural }), [m]);
    const hidden = useMemo(() => chrome.slice.parts.filter((part) => part.source !== SOURCE[view])
        .flatMap((part) => part.slice.config.fields.map((field) => `${part.source}.${field.fieldId}`)), [chrome, view]);
    const rail = useLibraryRail(chrome, nouns, hidden);
    const fixed = useRailValue(parts.pages, PROJECT_FIELD);

    // New page: open from a blank grid by its button, or from a template by its card. Made, it is one commit, and the host
    // is told of it (L10).
    const [starting, setStarting] = useState<Starting | undefined>(undefined);
    const onCreate = useCallback(async (key: Key, from: PageRow | undefined, tags: Tags): Promise<string | undefined> => {
        const east = studioEast();
        const outcome = await pages.commit.patch("", east.newPage(key, key.page, from === undefined ? none : some(from.entry.draft), tags));
        // A conflict is a name the project holds — before the popover opened, or since: the library holds no page's name
        // to refuse it by sooner, so it says the name is taken, never that another write took it first.
        if (outcome.type === "conflict") return m.nameTaken({ name: key.page });
        const refused = east.nameWriteRefusal(outcome, key.page);
        if (refused.type === "some") return refused.value;
        tellHost(onOpen, key);
        return undefined;
    }, [pages, onOpen, m]);

    // A press on a page's card asks the host for it; on a template's, New page opens from it.
    const onPress = useCallback((row: PageRow) => {
        if (view === "pages") tellHost(onOpen, row.key);
        else setStarting({ from: row });
    }, [view, onOpen]);
    const gallery = useEntryGallery(view, value.page, components, onPress);
    const empty = useMemo(() => (view === "pages" ? { title: m.noPages(), description: m.noPagesHint() } : { title: m.noTemplates(), description: m.noTemplatesHint() }), [view, m]);
    const narrowed = useMemo(() => ({ title: m.noneMatch({ templates: view === "templates" }), description: m.noneMatchHint({ templates: view === "templates" }) }), [view, m]);

    const toolbar = useMemo((): ReadonlyArray<ToolbarItem> => {
        const items = [
            { key: "pages", label: m.pages(), icon: faFileLines },
            { key: "templates", label: m.templates(), icon: faLayerGroup },
        ] as const;
        const newPage = (labelled: boolean) => (
            <NewPage key={labelled ? "full" : "compact"} labelled={labelled} fixed={fixed} starting={starting} onStarting={setStarting} home={value.project} onCreate={onCreate} />
        );
        return [
            ...(parts.templates === undefined ? [] : [{
                key: "studio-library-view",
                forms: [
                    <Seg key="strip" label={m.libraryView()} name="view" scope="studio-library" items={items} active={view} onPick={pickView} />,
                    <SegMenu key="menu" label={m.libraryView()} name="view" scope="studio-library" items={items} active={view} onPick={pickView} />,
                ],
                version: view,
            }]),
            ...rail,
            { key: "studio-library-new", side: "end" as const, forms: [newPage(true), newPage(false)], version: fixed },
        ];
    }, [parts.templates, view, pickView, rail, fixed, starting, value.project, onCreate, m]);

    return (
        <BuilderFrame storageKey={`${storageKey}.${libraryKey}.frame`} label={m.pageLibrary()} toolbar={toolbar}>
            {shown !== undefined && (
                <SliceGallery key={view} part={shown} id={`${libraryKey}.${view}`} gallery={gallery} decode={pageRow} empty={empty} narrowed={narrowed} />
            )}
        </BuilderFrame>
    );
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(StudioLibraryComponent, EastChakraStudioLibrary);
