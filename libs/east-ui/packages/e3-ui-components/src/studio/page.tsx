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
 * builder's publish preview's. A placement renders its component's function,
 * re-run when what it read changes; a frameless component (`frame: "none"`)
 * is bare; a placement whose component the surface does not list is a
 * placeholder naming its key, and one whose key two listed components share
 * is an error naming it.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { StudioCellType, StudioComponentType, StudioEntryType, StudioKeyType, StudioPageComponent } from "@elaraai/e3-ui/internal";
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

/** The renderer's payload, decoded. */
type StudioPageValue = ValueTypeOf<typeof StudioPageComponent.schema>;
/** A listed component. */
type Component = ValueTypeOf<typeof StudioComponentType>;
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

/** Props of {@link StudioPlacement}. */
export interface StudioPlacementProps {
    /** The key of the component it places. */
    component: string;
    /** The listed components under that key — one, when the surface lists it once. */
    listed: readonly Component[];
    /** Where its component's UI keeps its state. */
    storageKey: string;
}

/**
 * One placement's content: its component's own UI; a placeholder naming its
 * component's key when the surface lists none under it; an error naming the
 * key when two listed components share it.
 *
 * @param props - The component's key and the components listed under it
 * @returns The content
 */
export function StudioPlacement({ component: key, listed, storageKey }: StudioPlacementProps) {
    const m = useStudioMessages();
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
    /** Where its placements' UIs keep their state. */
    storageKey: string;
}

/**
 * A layout's placements on the snap grid, each its component's own UI — a
 * frameless component bare, a placement the surface cannot draw its
 * placeholder, in a tile. Under a narrow container the tiles stack in row
 * order.
 *
 * @param props - The placements and the listed components
 * @returns The grid
 */
export function StudioLayout({ cells, components, storageKey }: StudioLayoutProps) {
    // The listed components under each key — more than one is an error.
    const listed = useMemo(() => {
        const byKey = new Map<string, Component[]>();
        for (const component of components) {
            const same = byKey.get(component.key);
            if (same === undefined) byKey.set(component.key, [component]);
            else same.push(component);
        }
        return byKey;
    }, [components]);
    const tiles = useMemo(() => cells.map((cell): SnapGridLayoutCell & { cell: Cell } => {
        const first = listed.get(cell.component)?.[0];
        return {
            key: cell.key,
            row: cell.row,
            span: cell.span,
            height: cell.height,
            align: cell.align,
            frame: first === undefined ? true : first.frame.type === "card",
            cell,
        };
    }), [cells, listed]);
    return (
        <SnapGridTiles
            cells={tiles}
            content={(tile) => (
                <StudioPlacement component={tile.cell.component} listed={listed.get(tile.cell.component) ?? []} storageKey={`${storageKey}.${tile.key}`} />
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
    return <StudioLayout cells={layout.cells} components={value.components} storageKey={storageKey} />;
}, (prev, next) => pageEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(StudioPageComponent, EastChakraStudioPage);
