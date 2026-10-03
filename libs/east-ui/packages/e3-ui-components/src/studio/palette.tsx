/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `useStudioPalette` — the builder's palette (#994), the pane before the
 * canvas: the components a surface lists, grouped by category, and the
 * project's pages, each a tab of one pane.
 *
 * - **Components.** Every listed component but the deprecated, in the
 *   surface's order, grouped by category, with a Filter menu over category,
 *   tags and collections. A card shows the component's icon, its name, the
 *   datasets its code reads, and a lock — what it shows is fixed by its
 *   developer. A card drags onto the canvas, which takes cards from the
 *   components library's id. The component the canvas has selected is
 *   placed, `ON CANVAS · ×N`; a click selects its first placement.
 * - **Pages.** The project's pages in key order, each with its status, and a
 *   status dot. The open page is placed; a click opens a page.
 * - **Collapsed**, the pane is a rail: the expand control, its icon, the
 *   number of components and its name.
 *
 * What a card says is East's (`paletteCards`, `palettePages`). The palette is
 * a pane description: the canvas's builder frame draws it (#1125), `auto` —
 * pinned beside the canvas on a desktop, over it on a narrow screen — and
 * each tab is the Library's.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { PaletteCardType, PalettePageType, StudioComponentType } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary,
    useFormatters,
    type BuilderFrameDock,
    type LibraryItemValue,
    type LibraryValue,
} from "@elaraai/east-ui-components";

import { useStudioMessages } from "./messages.js";

/** A listed component. */
type Component = ValueTypeOf<typeof StudioComponentType>;
/** A component's card, as East computed it. */
type PaletteCard = ValueTypeOf<typeof PaletteCardType>;
/** A page of the project, as East computed it. */
type PalettePage = ValueTypeOf<typeof PalettePageType>;

/** What {@link useStudioPalette} lists, and what its clicks do. */
export interface StudioPaletteProps {
    /** The components the palette offers — the listed, less the deprecated — in the surface's order. */
    components: readonly Component[];
    /** Each one's card: its meta line, and whether it is placed. */
    cards: ReadonlyMap<string, PaletteCard>;
    /** The project's pages, in key order. */
    pages: readonly PalettePage[];
    /** The open page's name in the project. */
    open: string;
    /** The ids of the palette's libraries — the components library's, which the canvas takes cards from, and the pages'. */
    ids: { components: string; pages: string };
    /** Selects the component's first placement on the page. */
    onSelect: (component: string) => void;
    /** Opens a page of the project. */
    onOpen: (page: string) => void;
    /** Where the palette's libraries keep their state. */
    storageKey: string;
}

/**
 * The builder's palette, as the pane the canvas's frame draws — see the
 * module docs.
 *
 * @param props - The components and pages it lists, and what its clicks do
 * @returns The palette's pane: the Components and Pages tabs, 264px wide
 */
export function useStudioPalette({
    components, cards, pages, open, ids, onSelect, onOpen, storageKey,
}: StudioPaletteProps): BuilderFrameDock {
    const m = useStudioMessages();
    const words = useFormatters();

    const componentsLibrary = useMemo((): LibraryValue => ({
        id: ids.components,
        hint: none,
        items: components.map((component): LibraryItemValue => {
            const card = cards.get(component.key);
            return {
                key: component.key,
                label: component.name,
                sublabel: card === undefined ? none : some(card.meta),
                icon: some(component.icon),
                status: none,
                trailing: some({ icon: "lock", label: m.logicFixed(), tone: none }),
                draggable: true,
                filtered: false,
                placed: card?.placed ?? false,
                media: none,
                avatar: none,
                byline: none,
                action: none,
                search: some(`${component.name} ${component.category} ${component.tags.join(" ")}`),
                groups: new Map([["category", component.category]]),
                facets: new Map([["category", [component.category]], ["tags", component.tags], ["collections", component.collections]]),
                dims: new Map(),
            };
        }),
        groupOptions: [{ key: "category", label: m.category() }],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [
            { key: "category", label: m.category() },
            { key: "tags", label: m.tags() },
            { key: "collections", label: m.collections() },
        ],
        searchable: true,
        noun: some(m.componentNoun()),
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onSelect(key); return null; }),
        slice: none,
        style: some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none }),
        variant: none,
        layout: none,
        toolbar: true,
    }), [ids.components, components, cards, m, onSelect]);

    const pagesLibrary = useMemo((): LibraryValue => ({
        id: ids.pages,
        hint: none,
        items: pages.map((page): LibraryItemValue => ({
            key: page.page,
            label: page.title,
            sublabel: some(page.meta),
            icon: some("file-lines"),
            status: none,
            trailing: some({
                icon: "circle",
                label: page.live ? m.live() : m.draft(),
                tone: some(page.live ? variant("success", null) : variant("neutral", null)),
            }),
            draggable: false,
            filtered: false,
            placed: page.page === open,
            media: none,
            avatar: none,
            byline: none,
            action: none,
            search: some(page.title),
            groups: new Map(),
            facets: new Map(),
            dims: new Map(),
        })),
        groupOptions: [],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: some(m.pageNoun()),
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onOpen(key); return null; }),
        slice: none,
        style: some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none }),
        variant: none,
        layout: none,
        toolbar: true,
    }), [ids.pages, pages, open, m, onOpen]);

    return useMemo((): BuilderFrameDock => ({
        label: m.components(),
        icon: "shapes",
        badge: words.number(components.length),
        size: "264px",
        tabs: [
            { key: "components", label: m.components(), body: <EastChakraLibrary value={componentsLibrary} storageKey={`${storageKey}.palette.components`} /> },
            { key: "pages", label: m.pages(), body: <EastChakraLibrary value={pagesLibrary} storageKey={`${storageKey}.palette.pages`} /> },
        ],
    }), [m, words, components.length, componentsLibrary, pagesLibrary, storageKey]);
}
