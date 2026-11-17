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
 * heading over its paragraphs, bare. A visual is a tile naming its view and
 * its source; one whose source the surface does not list says so.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import {
    StudioCellType, StudioComponentType, StudioContentType, StudioEntryType, StudioKeyType, StudioPageComponent, StudioSourceType,
} from "@elaraai/e3-ui/internal";
import {
    BannerView,
    EastChakraComponent,
    EmptyStateView,
    SnapGridTiles,
    implementUIComponent,
    useTrackedEvaluation,
    type SnapGridLayoutCell,
} from "@elaraai/east-ui-components";

import { useStudioMessages } from "./messages.js";
import { studioEast } from "./studio-east.js";
import { StudioText } from "./text.js";

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
}

/**
 * One placement's content, by what it holds: its component's own UI — a
 * placeholder naming its component's key when the surface lists none under
 * it, an error naming the key when two listed components share it; a text
 * block's heading and paragraphs; a visual's view and source by name, or that
 * the surface lists no source of its key.
 *
 * @param props - What it holds, the listed components and the listed sources' names
 * @returns The content
 */
export function StudioPlacement({ content, listed: byKey, sources, storageKey }: StudioPlacementProps) {
    const m = useStudioMessages();
    const east = studioEast();
    if (content.type === "text") return <StudioText text={content.value} />;
    if (content.type === "visual") {
        const visual = content.value;
        if (!sources.has(visual.source)) {
            return (
                <EmptyStateView icon={{ prefix: "fas", name: "database" }}
                    title={m.noSource({ key: visual.source })} description={m.noSourceHint()} />
            );
        }
        return <EmptyStateView icon={{ prefix: "fas", name: east.viewIcon(visual.view) }} title={east.contentWords(content, sources)} />;
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
    /** Where its placements' UIs keep their state. */
    storageKey: string;
}

/**
 * A layout's placements on the snap grid, each what it holds — a frameless
 * component and a text block bare; a visual, and a placement the surface
 * cannot draw, in a tile. Under a narrow container the tiles stack in row
 * order.
 *
 * @param props - The placements, the listed components and the listed sources
 * @returns The grid
 */
export function StudioLayout({ cells, components, sources, storageKey }: StudioLayoutProps) {
    const east = studioEast();
    const listed = useListedByKey(components);
    const names = useMemo(() => east.sourceNames([...sources]), [east, sources]);
    // Whether a placement is framed is its content's tile's: e3-ui's East.
    const framed = useMemo(() => east.canvasTiles([...components]), [east, components]);
    const tiles = useMemo(() => cells.map((cell): SnapGridLayoutCell & { cell: Cell } => {
        const tile = east.contentTile(cell.content, framed, names);
        return {
            key: cell.key,
            row: cell.row,
            span: cell.span,
            height: cell.height,
            align: cell.align,
            // A placement whose component the surface does not list is its placeholder, in a tile.
            frame: tile.type === "none" ? true : tile.value.frame,
            cell,
        };
    }), [east, cells, framed, names]);
    return (
        <SnapGridTiles
            cells={tiles}
            content={(tile) => (
                <StudioPlacement content={tile.cell.content} listed={listed} sources={names} storageKey={`${storageKey}.${tile.key}`} />
            )}
        />
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
    return <StudioLayout cells={layout.cells} components={value.components} sources={value.sources} storageKey={storageKey} />;
}, (prev, next) => pageEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(StudioPageComponent, EastChakraStudioPage);
