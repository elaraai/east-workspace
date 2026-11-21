/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `useStudioPalette` — the builder's palette (#994), the pane before the
 * canvas: the visuals an operator configures and the components a surface
 * lists, and the project's pages, each a tab of one pane.
 *
 * - **Components.** First the visuals an operator configures (#1672, BLD-1)
 *   — the KPI, the seven charts, the three tables, the list, from each kind's
 *   declaration, while the surface lists a source for them to read — and the
 *   text block; then every listed component but the deprecated, in the
 *   surface's order. They group by who configures them, "Visuals · you
 *   configure" over "Built by developers", or by category; a Filter menu
 *   narrows by category, tags and collections. A component's card shows its
 *   icon, its name, the datasets its code reads, and a lock — what it shows
 *   is fixed by its developer; a visual's its icon and its name. A card drags
 *   onto the canvas, which takes cards from the components library's id. The
 *   component the canvas has selected is placed, `ON CANVAS · ×N`; a click on
 *   a component's card selects its first placement.
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
 * On a phone (`Studio Mobile Spec.md` ST22, ST23) each tab opens with a line of
 * what to do; a card has no grip, and a tap on it starts placing it; a card says
 * when its component is on the page.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { PaletteCardType, PalettePageType, StudioComponentType, type StudioKind, type StudioViewEditor } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary,
    useFormatters,
    type BuilderFrameDock,
    type LibraryItemValue,
    type LibraryValue,
} from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";

import { useStudioMessages } from "./messages.js";

/** A listed component. */
type Component = ValueTypeOf<typeof StudioComponentType>;
/** A component's card, as East computed it. */
type PaletteCard = ValueTypeOf<typeof PaletteCardType>;
/** A page of the project, as East computed it. */
type PalettePage = ValueTypeOf<typeof PalettePageType>;

/** What a visual's card's key starts with: no component a surface lists under such a key is offered a card beside it. */
const VISUAL_CARD = "visual:";

/**
 * A card of the palette's visuals (#1672): a kind an operator configures, or
 * the text block.
 *
 * @property key - Its card's key — `visual:column`, `visual:text`
 * @property label - Its name — "Column", "Text"
 * @property icon - A Font Awesome solid icon name
 * @property span - The span it is placed at (BLD-2)
 * @property kind - The kind it places; `undefined` for the text block
 */
export interface VisualCard {
    readonly key: string;
    readonly label: string;
    readonly icon: string;
    readonly span: bigint;
    readonly kind: StudioKind | undefined;
}

/**
 * The palette's visual cards (BLD-1): each kind of each view's editors, in
 * order, while the surface lists a source for them to read, then the text
 * block at the full width — less any whose key a listed component holds,
 * which keeps its own card.
 *
 * @param editors - Each view's editors
 * @param sources - How many sources the surface lists
 * @param components - The components the palette offers
 * @param text - The text block's card's name
 * @returns The cards, in order
 */
export function visualCards(editors: readonly StudioViewEditor[], sources: number, components: readonly Component[], text: string): VisualCard[] {
    const kinds = sources === 0 ? [] : editors.flatMap((view) => view.kinds.map((editor): VisualCard => ({
        key: `${VISUAL_CARD}${editor.kind.type}`, label: editor.label, icon: editor.icon, span: editor.span, kind: editor.kind,
    })));
    const cards = [...kinds, { key: `${VISUAL_CARD}text`, label: text, icon: "heading", span: 12n, kind: undefined }];
    const held = new Set(components.map((component) => component.key));
    for (const card of cards) {
        if (held.has(card.key)) console.warn(`[Studio.Builder] a listed component holds the key "${card.key}": its card stands for it, not the visual's`);
    }
    return cards.filter((card) => !held.has(card.key));
}

/** A card a phone's tap starts placing: its key, its name and its span. */
export interface PlacedCard {
    readonly key: string;
    readonly label: string;
    readonly span: number;
}

/** What {@link useStudioPalette} lists, and what its clicks do. */
export interface StudioPaletteProps {
    /** The visuals an operator configures and the text block, in order ({@link visualCards}). */
    visuals: readonly VisualCard[];
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
    /** In a phone's frame: what a card's tap starts, and the components on the page. */
    phone?: { onPlace: (card: PlacedCard) => void; onPage: ReadonlySet<string> } | undefined;
}

/**
 * The builder's palette, as the pane the canvas's frame draws — see the
 * module docs.
 *
 * @param props - The visuals, the components and the pages it lists, and what its clicks do
 * @returns The palette's pane: the Components and Pages tabs, 264px wide
 */
export function useStudioPalette({
    visuals, components, cards, pages, open, ids, onSelect, onOpen, storageKey, phone,
}: StudioPaletteProps): BuilderFrameDock {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioPhone");
    const words = useFormatters();

    const componentsLibrary = useMemo((): LibraryValue => ({
        id: ids.components,
        hint: none,
        items: [...visuals.map((card): LibraryItemValue => ({
            key: card.key,
            label: card.label,
            sublabel: none,
            icon: some(card.icon),
            status: none,
            trailing: none,
            draggable: phone === undefined,
            filtered: false,
            placed: false,
            media: none,
            avatar: none,
            byline: none,
            action: none,
            search: some(`${card.label} ${m.visualsCategory()}`),
            groups: new Map([["configured", m.paletteVisuals()], ["category", m.visualsCategory()]]),
            facets: new Map([["category", [m.visualsCategory()]], ["tags", []], ["collections", []]]),
            dims: new Map(),
        })), ...components.map((component): LibraryItemValue => {
            const card = cards.get(component.key);
            return {
                key: component.key,
                label: component.name,
                sublabel: card === undefined ? none : some(phone?.onPage.has(component.key) === true && card.meta !== "" ? `${card.meta} · ${m.phoneOnPage()}` : card.meta),
                icon: some(component.icon),
                status: none,
                trailing: some({ icon: "lock", label: m.logicFixed(), tone: none }),
                draggable: phone === undefined,
                filtered: false,
                placed: card?.placed ?? false,
                media: none,
                avatar: none,
                byline: none,
                action: none,
                search: some(`${component.name} ${component.category} ${component.tags.join(" ")}`),
                groups: new Map([["configured", m.paletteDevelopers()], ["category", component.category]]),
                facets: new Map([["category", [component.category]], ["tags", component.tags], ["collections", component.collections]]),
                dims: new Map(),
            };
        })],
        // Who configures a card first, as the spec's palette groups them; its category the other way.
        groupOptions: [{ key: "configured", label: m.configuredBy() }, { key: "category", label: m.category() }],
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
        // A component's click selects its first placement; on a phone a card's tap starts placing it (ST22). A visual's card
        // has no placement of its own to select.
        onCardClick: some((key: string) => {
            const component = components.find((c) => c.key === key);
            const visual = component === undefined ? visuals.find((card) => card.key === key) : undefined;
            if (phone !== undefined && component !== undefined) phone.onPlace({ key: component.key, label: component.name, span: Number(component.span) });
            else if (phone !== undefined && visual !== undefined) phone.onPlace({ key: visual.key, label: visual.label, span: Number(visual.span) });
            else if (component !== undefined) onSelect(key);
            return null;
        }),
        slice: none,
        style: some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none }),
        variant: none,
        layout: none,
        toolbar: true,
    }), [ids.components, visuals, components, cards, m, onSelect, phone]);

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

    // Every card the Components tab offers: the visuals' and the components'.
    const offered = visuals.length + components.length;
    return useMemo((): BuilderFrameDock => ({
        label: m.components(),
        icon: "shapes",
        badge: words.number(offered),
        size: "264px",
        tabs: [
            {
                key: "components", label: m.components(), count: phone === undefined ? undefined : words.number(offered),
                body: phone === undefined ? <EastChakraLibrary value={componentsLibrary} storageKey={`${storageKey}.palette.components`} />
                    : <Box css={styles.paneBody} data-library-phone="studio"><Box css={styles.intro} data-studio-intro="">{m.phoneComponentsIntro()}</Box><EastChakraLibrary value={componentsLibrary} storageKey={`${storageKey}.palette.components`} /></Box>,
            },
            {
                key: "pages", label: m.pages(), count: phone === undefined ? undefined : words.number(pages.length),
                body: phone === undefined ? <EastChakraLibrary value={pagesLibrary} storageKey={`${storageKey}.palette.pages`} />
                    : <Box css={styles.paneBody} data-library-phone="studio"><Box css={styles.intro} data-studio-intro="">{m.phonePagesIntro()}</Box><EastChakraLibrary value={pagesLibrary} storageKey={`${storageKey}.palette.pages`} /></Box>,
            },
        ],
    }), [m, words, offered, pages.length, componentsLibrary, pagesLibrary, storageKey, phone, styles]);
}
