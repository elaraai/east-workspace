/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioPage` — the renderer of the `StudioPage` extension declared
 * in `@elaraai/e3-ui` (#993): one page's live or draft layout on the snap
 * grid, each placement its component's own UI, and what a page says when it
 * has nothing to draw — a page the record does not hold, or a live version
 * not yet published.
 *
 * {@link StudioLayout} draws a layout's placements — the page's, and the
 * builder's publish preview's — each by what it holds (#1669). A component's
 * placement renders its function, re-run when what it read changes; a
 * frameless component (`frame: "none"`) is bare; a placement whose component
 * the surface does not list is a placeholder naming its key, and one whose
 * key two listed components share is an error naming it. A text block is its
 * heading over its paragraphs, bare. A visual is a tile that asks its
 * programs on e3 and draws its state (#1670); one whose source the surface
 * does not list says so.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import {
    StudioCellType, StudioComponentType, StudioContentType, StudioEntryType, StudioKeyType, StudioPageComponent, StudioSourceType,
} from "@elaraai/e3-ui/internal";
import {
    BannerView,
    EastChakraComponent,
    EmptyStateView,
    SnapGridTiles,
    Toolbar,
    implementUIComponent,
    useTrackedEvaluation,
    type SnapGridLayoutCell,
} from "@elaraai/east-ui-components";

import { VisualAnswersProvider } from "../query/visual/answers.js";
import { useStudioMessages } from "./messages.js";
import { sourcesRead, useStudioFilterItems } from "./filter-rail.js";
import { PageClicksProvider } from "./page-clicks.js";
import { PageFiltersProvider } from "./page-filters.js";
import { studioEast } from "./studio-east.js";
import { StudioText } from "./text.js";
import { StudioVisualTile, type VisualEdit } from "./visual-tile.js";

/** The renderer's payload, decoded. */
type StudioPageValue = ValueTypeOf<typeof StudioPageComponent.schema>;
/** A listed component. */
type Component = ValueTypeOf<typeof StudioComponentType>;
/** A listed source. */
type Source = ValueTypeOf<typeof StudioSourceType>;
/** What a placement holds. */
type Content = ValueTypeOf<typeof StudioContentType>;
/** One placement. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** One entry of the pages record. */
type Entry = ValueTypeOf<typeof StudioEntryType>;
/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;

const pageEqual = equivalentFor(StudioPageComponent.schema);
const keyEqual = equalFor(StudioKeyType);

/** Props of {@link StudioComponentView}. */
interface StudioComponentViewProps {
    /** The component. */
    component: Component;
    /** Where its UI keeps its state. */
    storageKey: string;
}

/**
 * A listed component's own UI: its function, re-run when what it read
 * changes; what it threw, when it throws.
 */
function StudioComponentView({ component, storageKey }: StudioComponentViewProps) {
    const render = useCallback(() => component.render(), [component]);
    const { result } = useTrackedEvaluation(render);
    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return <BannerView status="error" title={component.name} description={message} />;
    }
    return <EastChakraComponent value={result.value} storageKey={storageKey} />;
}

/**
 * The listed components under each key — more than one under a key is an
 * error its placements name.
 *
 * @param components - The components the surface lists
 * @returns The components, by key
 */
export function useListedByKey(components: readonly Component[]): ReadonlyMap<string, readonly Component[]> {
    return useMemo(() => {
        const byKey = new Map<string, Component[]>();
        for (const component of components) {
            const same = byKey.get(component.key);
            if (same === undefined) byKey.set(component.key, [component]);
            else same.push(component);
        }
        return byKey;
    }, [components]);
}

/** Props of {@link StudioPlacement}. */
export interface StudioPlacementProps {
    /** What it holds: a component's key, a visual or a text block. */
    content: Content;
    /** The listed components, by key ({@link useListedByKey}). */
    listed: ReadonlyMap<string, readonly Component[]>;
    /** Each listed source's name, by its key — e3-ui's `sourceNames`, decoded. */
    sources: Map<string, string>;
    /** Where its component's UI keeps its state. */
    storageKey: string;
    /** What names it: its own title, which a visual's tile carries over its body (TIL-1); `undefined` for none. */
    title?: string | undefined;
    /** On the builder's canvas, what a visual's menu's Edit visual and Duplicate do (#1672); omitted on a page. */
    edit?: VisualEdit | undefined;
    /** Its key: what a visual's selection is kept under, and what a visual that follows it names (#1673); `undefined` outside a layout. */
    placement?: string | undefined;
    /** While the builder's canvas picks a leader (#1673, LNK-6): whether a visual is the one being linked, or one that can lead. */
    pick?: "follower" | "leader" | undefined;
}

/**
 * One placement's content, by what it holds: its component's own UI — a
 * placeholder naming its component's key when the surface lists none under
 * it, an error naming the key when two listed components share it; a text
 * block's heading and paragraphs; a visual's tile, which asks its programs
 * under the {@link VisualAnswersProvider} around it, or that the surface lists
 * no source of its key.
 *
 * @param props - What it holds, the listed components and the listed sources' names
 * @returns The content
 */
export function StudioPlacement({ content, listed: byKey, sources, storageKey, title, edit, placement, pick }: StudioPlacementProps) {
    const m = useStudioMessages();
    if (content.type === "text") return <StudioText text={content.value} />;
    if (content.type === "visual") {
        const visual = content.value;
        if (!sources.has(visual.source)) {
            return (
                <EmptyStateView icon={{ prefix: "fas", name: "database" }}
                    title={m.noSource({ key: visual.source })} description={m.noSourceHint()} />
            );
        }
        return <StudioVisualTile content={content} names={sources} storageKey={storageKey} title={title} edit={edit} placement={placement} pick={pick} />;
    }
    const key = content.value;
    const listed = byKey.get(key) ?? [];
    if (listed.length > 1) {
        return <BannerView status="error" title={m.twoComponents({ key })} description={m.twoComponentsHint()} />;
    }
    const component = listed[0];
    if (component === undefined) {
        return (
            <EmptyStateView icon={{ prefix: "fas", name: "puzzle-piece" }}
                title={m.noComponent({ key })} description={m.noComponentHint()} />
        );
    }
    return <StudioComponentView component={component} storageKey={storageKey} />;
}

/** Props of {@link StudioLayout}. */
export interface StudioLayoutProps {
    /** The layout's placements, in order. */
    cells: readonly Cell[];
    /** The components the surface lists. */
    components: readonly Component[];
    /** The sources the surface lists. */
    sources: readonly Source[];
    /** The page the layout is of, whose filters narrow its visuals. */
    page: Key;
    /** Where its placements' UIs keep their state. */
    storageKey: string;
    /** Told the key of the page a click on a visual opens (#1673), its filters already the clicked group; omitted, such a click opens nothing. */
    onOpen?: ((page: Key) => void) | undefined;
}

/**
 * A layout's placements on the snap grid, each what it holds — a frameless
 * component and a text block bare; a visual, and a placement the surface
 * cannot draw, in a tile. Under a narrow container the tiles stack in row
 * order. Its visuals are narrowed by the reader's filters of its page, and
 * their clicks run: they select, filter and open, as each visual says.
 *
 * @param props - The placements, the listed components, the listed sources, the page and who is told a click opens another
 * @returns The grid
 */
export function StudioLayout({ cells, components, sources, page, storageKey, onOpen }: StudioLayoutProps) {
    const east = studioEast();
    const filterStyles = useSlotRecipe({ key: "studioFilters" })();
    const listed = useListedByKey(components);
    const names = useMemo(() => east.sourceNames([...sources]), [east, sources]);
    // Whether a placement is framed is read by what it holds alone (e3-ui's East): a page makes no tile — no name, no
    // meta line of what a component reads — to draw its placements.
    const frames = useMemo(() => east.componentFrames([...components]), [east, components]);
    const tiles = useMemo(() => cells.map((cell): SnapGridLayoutCell & { cell: Cell } => ({
        key: cell.key,
        row: cell.row,
        span: cell.span,
        height: cell.height,
        align: cell.align,
        // A placement whose component the surface does not list is its placeholder, in a tile.
        frame: east.contentFramed(cell.content, frames),
        cell,
    })), [east, cells, frames]);
    // The reader's filters of the page, over the sources its visuals read: a row over the grid.
    const read = useMemo(() => sourcesRead(cells), [cells]);
    const filterItems = useStudioFilterItems(page, sources, read);
    return (
        <VisualAnswersProvider sources={sources}>
            <PageFiltersProvider page={page}>
                <PageClicksProvider page={page} cells={cells} live onOpen={onOpen}>
                    {filterItems.length > 0 && <Box css={filterStyles.row} data-studio-filters=""><Toolbar items={filterItems} /></Box>}
                    <SnapGridTiles
                        cells={tiles}
                        content={(tile) => (
                            <StudioPlacement content={tile.cell.content} listed={listed} sources={names} storageKey={`${storageKey}.${tile.key}`}
                                title={tile.cell.title.type === "some" ? tile.cell.title.value : undefined} placement={tile.key} />
                        )}
                    />
                </PageClicksProvider>
            </PageFiltersProvider>
        </VisualAnswersProvider>
    );
}

/** Props of {@link EastChakraStudioPage}. */
export interface EastChakraStudioPageProps {
    /** The payload, decoded. */
    value: StudioPageValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders one page — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The page
 */
export const EastChakraStudioPage = memo(function EastChakraStudioPage({ value, storageKey }: EastChakraStudioPageProps) {
    const m = useStudioMessages();
    const key = value.page;
    // Who is told a click opens a page: the host's function, as the payload carries it.
    const told = value.onOpen.type === "some" ? value.onOpen.value : undefined;
    const onOpen = useMemo(() => (told === undefined ? undefined : (page: Key) => { told(page); }), [told]);
    // The record's key order is its own: the entry is found by the key's value.
    let entry: Entry | undefined;
    for (const [at, found] of value.pages) {
        if (keyEqual(at, key)) {
            entry = found;
            break;
        }
    }
    if (entry === undefined) {
        return (
            <EmptyStateView icon={{ prefix: "fas", name: "file-circle-question" }}
                title={m.noPage({ page: key.page })} description={m.noPageHint({ project: key.project })} />
        );
    }
    const layout = entry.type === "template" ? entry.value
        : value.version.type === "draft" ? entry.value.draft
            : entry.value.live.type === "some" ? entry.value.live.value.page : undefined;
    if (layout === undefined) {
        return (
            <EmptyStateView icon={{ prefix: "fas", name: "file-circle-question" }}
                title={m.notPublished({ page: key.page })} description={m.notPublishedHint()} />
        );
    }
    return <StudioLayout cells={layout.cells} components={value.components} sources={value.sources} page={key} storageKey={storageKey} onOpen={onOpen} />;
}, (prev, next) => pageEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(StudioPageComponent, EastChakraStudioPage);
