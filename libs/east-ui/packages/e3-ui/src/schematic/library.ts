/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schematic.library` (#1386, `Schematic Builder Spec.md` §8): the library
 * pane's tabs, which `library` lists in order, and their wire, which the
 * renderer draws (#1389).
 *
 * - `Schematic.library.templates(slot)`: the slot's templates (§4.6), grouped
 *   by their `group`, each card a drag source. The tab follows its templates'
 *   source of the slice.
 * - `Schematic.library.unplaced(slot)`: an item kind's rows with no position,
 *   each a drag source. Refused for a slot whose `x` and `y` aren't Options.
 * - `Schematic.library.index()`: the zones, nested by containment, each
 *   opened listing the items inside it.
 * - `Schematic.library.layers()`: each layer, with Isolate, Lock and Show or
 *   Hide: the viewer's view settings.
 * - `Schematic.library.tab(rows, { … })`: the author's own cards, as
 *   `Plan.library.tab` takes them. A card's `drop` is a `Schematic.patch(R, …)`
 *   whose row type names the kind it lands on.
 *
 * Left out, or empty, the Schematic has no library pane.
 *
 * @packageDocumentation
 */

import { ArrayType, East, NullType, StringType, VariantType, variant, type DictType, type EastType, type ExprType, type StructType, type SubtypeExprOrValue } from "@elaraai/east";
import { ScheduleAuthorTabType, buildScheduleTab, type ScheduleLibraryTabConfig } from "../schedule/library.js";

export { ScheduleLibraryCardType as SchematicLibraryCardType, type ScheduleLibraryTabConfig as SchematicLibraryTabConfig } from "../schedule/library.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * One tab of the library pane on the wire, in the order `library` lists them.
 *
 * @property templates - The templates of the kind in this slot
 * @property unplaced - The rows with no position of the item kind in this slot
 * @property index - The zones, nested by containment
 * @property layers - The layers
 * @property tab - The author's own: its name, its icon, the kind its cards land on, and its cards
 */
export const SchematicLibraryTabType = VariantType({
    templates: StringType,
    unplaced: StringType,
    index: NullType,
    layers: NullType,
    tab: ScheduleAuthorTabType,
});

/** Type representing {@link SchematicLibraryTabType}. */
export type SchematicLibraryTabType = typeof SchematicLibraryTabType;

// ============================================================================
// The author's surface
// ============================================================================

/** One tab of the library pane: what each `Schematic.library.*` call returns, and `library` lists. */
export type SchematicLibraryTab =
    | { readonly kind: "templates"; readonly slot: string }
    | { readonly kind: "unplaced"; readonly slot: string }
    | { readonly kind: "index" }
    | { readonly kind: "layers" }
    | { readonly kind: "tab"; readonly rows: unknown; readonly config: ScheduleLibraryTabConfig<EastType, EastType> };

/**
 * The library's templates tab for a kind (§8): its templates, grouped by
 * their `group`, each card a drag source. Dropped on the canvas, an item
 * template adds an item at the drop point; dropped on a link, a link template
 * retypes it. The tab follows its templates' source of the slice, counting
 * what it shows.
 *
 * @param slot - The slot of the kind whose templates it lists: an item, link or net kind with `templates`
 * @returns The tab
 */
export function libraryTemplates(slot: string): SchematicLibraryTab {
    return { kind: "templates", slot };
}

/**
 * The library's Unplaced tab for an item kind (§8): its rows with no
 * position, each a drag source a drop places. The kind's `x` and `y` are
 * Options of Float, which give it a backlog.
 *
 * @param slot - The slot of the item kind whose unplaced rows it lists
 * @returns The tab
 */
export function libraryUnplaced(slot: string): SchematicLibraryTab {
    return { kind: "unplaced", slot };
}

/**
 * The library's Index tab (§8): the zones, nested by containment. The zone the
 * viewport is in is marked, a click flies to a zone and selects it, and an
 * opened zone lists the items inside it. Hatched zones hold no items.
 *
 * @returns The tab
 */
export function libraryIndex(): SchematicLibraryTab {
    return { kind: "index" };
}

/**
 * The library's Layers tab (§8): each layer's swatch, label and count, with
 * Isolate, Lock and Show or Hide, and Show all. The viewer's choices are kept
 * for them; a locked layer's entities never select, and a hidden layer's never
 * draw.
 *
 * @returns The tab
 */
export function libraryLayers(): SchematicLibraryTab {
    return { kind: "layers" };
}

/**
 * A tab of the author's own cards (§8): one card per row, its label and meta,
 * grouped by its `group`, searched by its key, label and meta. Given a `drop`
 * — `Schematic.patch(R, { … })` over one kind's row type, which names that
 * kind — a card dropped on an entity of that kind sets the fields the patch
 * sets. Naming a `source` of the slice, the tab follows it.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - Their row type
 * @typeParam P - The patch `drop` returns
 * @param rows - The rows: a `Dict<K, R>`, usually a record's `read()`
 * @param config - The tab's name and icon, and the accessors over a row and its key
 * @returns The tab
 */
export function libraryTab<K extends EastType, R extends EastType, P extends EastType = EastType>(
    rows: SubtypeExprOrValue<DictType<K, R>>,
    config: ScheduleLibraryTabConfig<K, R, P>,
): SchematicLibraryTab {
    return { kind: "tab", rows, config: config as unknown as ScheduleLibraryTabConfig<EastType, EastType> };
}

/**
 * The library's tabs, each a factory `library` lists: `Schematic.library`.
 */
export const SchematicLibraryFactories = {
    /** The templates of the kind in a slot ({@link libraryTemplates}). */
    templates: libraryTemplates,
    /** The unplaced rows of the item kind in a slot ({@link libraryUnplaced}). */
    unplaced: libraryUnplaced,
    /** The zones, nested by containment ({@link libraryIndex}). */
    index: libraryIndex,
    /** The layers ({@link libraryLayers}). */
    layers: libraryLayers,
    /** The author's own cards ({@link libraryTab}). */
    tab: libraryTab,
} as const;

/** The type of `Schematic.library`. */
export type SchematicLibrary = typeof SchematicLibraryFactories;

// ============================================================================
// The build
// ============================================================================

/** One of the Schematic's kinds, as its library is built against it. */
export interface SchematicLibraryKind {
    /** Its slot. */
    readonly slot: string;
    /** Its sort: an item, zone, link or net kind. */
    readonly sort: "items" | "zones" | "links" | "nets";
    /** Its record's row type. */
    readonly rowType: StructType;
    /** Whether it has templates. */
    readonly templates: boolean;
    /** Whether it has a backlog: an item kind whose `x` and `y` are Options. */
    readonly backlog: boolean;
}

/**
 * What a Schematic's library is built against.
 *
 * @internal
 */
export interface SchematicLibraryContext {
    /** Its kinds, in order: its items', its zones', its links' and its nets'. */
    readonly kinds: readonly SchematicLibraryKind[];
    /** How many layers it declares. */
    readonly layers: number;
    /** The slice's sources, which an author's tab's `source` must be one of. */
    readonly sources: readonly string[];
}

/** A sort's noun, as a refusal names a kind of it. */
const NOUN = { items: "item", zones: "zone", links: "link", nets: "net" } as const;

/** How a tab names itself in a refusal. */
function tabName(tab: SchematicLibraryTab): string {
    switch (tab.kind) {
        case "templates":
        case "unplaced":
            return `Schematic.library.${tab.kind}("${tab.slot}")`;
        case "index":
        case "layers":
            return `Schematic.library.${tab.kind}()`;
        case "tab":
            return `the "${tab.config.name}" tab`;
    }
}

/** Whether a value is one of the library's tabs. */
function isTab(value: unknown): value is SchematicLibraryTab {
    if (typeof value !== "object" || value === null) return false;
    const kind = (value as { kind?: unknown }).kind;
    return kind === "templates" || kind === "unplaced" ? typeof (value as { slot?: unknown }).slot === "string"
        : kind === "index" || kind === "layers" || kind === "tab";
}

/**
 * Builds the library pane on the wire (§8): its tabs in the order `library`
 * lists them; none when it is left out.
 *
 * @param tabs - The tabs, each a `Schematic.library.*` call
 * @param ctx - What the library is built against
 * @returns The tabs on the wire
 * @throws {Error} Naming the tab: a `library` that is no list of `Schematic.library.*` calls; a tab listed twice (an
 *   author's tab by its name); a templates tab for a slot that holds no kind, a zone kind or a kind with no templates;
 *   an Unplaced tab for a slot that holds no item kind, or one whose `x` and `y` aren't Options; the Index tab with no
 *   zone kinds; the Layers tab with no layers; and each of an author's tab's refusals
 * @internal
 */
export function buildSchematicLibrary(tabs: unknown, ctx: SchematicLibraryContext): ExprType<ArrayType<SchematicLibraryTabType>> {
    if (tabs === undefined) return East.value([], ArrayType(SchematicLibraryTabType));
    if (!Array.isArray(tabs) || !tabs.every(isTab)) {
        throw new Error("Schematic: `library` lists the library pane's tabs, in order, each a Schematic.library.* call — " +
            "templates(slot), unplaced(slot), index(), layers() or tab(rows, { … })");
    }
    const slots = ctx.kinds.map((kind) => `"${kind.slot}"`).join(", ");
    const seen = new Set<string>();
    for (const tab of tabs as readonly SchematicLibraryTab[]) {
        const id = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind === "templates" || tab.kind === "unplaced" ? `${tab.kind}:${tab.slot}` : tab.kind;
        if (seen.has(id)) {
            throw new Error(tab.kind === "tab"
                ? `Schematic: the library lists two tabs named "${tab.config.name}" — each tab's name is its own`
                : `Schematic: the library lists ${tabName(tab)} twice — each tab once`);
        }
        seen.add(id);
        if (tab.kind === "templates" || tab.kind === "unplaced") {
            const kind = ctx.kinds.find((k) => k.slot === tab.slot);
            if (kind === undefined) throw new Error(`Schematic: the library lists ${tabName(tab)}, and no kind is in the slot "${tab.slot}" — its kinds' slots are ${slots}`);
            if (tab.kind === "templates") {
                if (kind.sort === "zones") {
                    throw new Error(`Schematic: the library lists ${tabName(tab)}, and "${tab.slot}" is a zone kind — zones take no templates: a zone is added through its record`);
                }
                if (!kind.templates) {
                    throw new Error(`Schematic: the library lists ${tabName(tab)}, and the ${NOUN[kind.sort]} kind "${tab.slot}" has no templates — give it templates: ` +
                        "Schematic.templates(templates.read(), { name, values, source })");
                }
            } else {
                if (kind.sort !== "items") {
                    throw new Error(`Schematic: the library lists ${tabName(tab)}, and "${tab.slot}" is a ${NOUN[kind.sort]} kind — the Unplaced tab lists an item kind's rows with no position`);
                }
                if (!kind.backlog) {
                    throw new Error(`Schematic: the library lists ${tabName(tab)}, and the item kind "${tab.slot}" places every row — its \`x\` and \`y\` are Float fields: ` +
                        "make them Options of Float to give it rows with no position");
                }
            }
        }
        if (tab.kind === "index" && !ctx.kinds.some((kind) => kind.sort === "zones")) {
            throw new Error("Schematic: the library lists Schematic.library.index(), and this Schematic has no zone kinds — the Index tab lists the zones (Schematic.zones), nested by containment");
        }
        if (tab.kind === "layers" && ctx.layers === 0) {
            throw new Error("Schematic: the library lists Schematic.library.layers(), and this Schematic declares no layers — declare them: layers={[{ key, label }]}");
        }
    }
    const landsOn = ctx.kinds.map((kind) => [kind.slot, { rowType: kind.rowType }] as const);
    const wires = (tabs as readonly SchematicLibraryTab[]).map((tab): ExprType<SchematicLibraryTabType> => {
        switch (tab.kind) {
            case "templates":
            case "unplaced":
                return East.value(variant(tab.kind, tab.slot), SchematicLibraryTabType);
            case "index":
            case "layers":
                return East.value(variant(tab.kind, null), SchematicLibraryTabType);
            case "tab":
                return East.value(variant("tab", buildScheduleTab(tab, landsOn, "Schematic", ctx.sources, { kind: "kind", patch: "Schematic.patch" })), SchematicLibraryTabType);
        }
    });
    return East.value(wires, ArrayType(SchematicLibraryTabType));
}

/**
 * The sources of the slice the author's tabs name: each must be one of the
 * slice's, and is one it may hold.
 *
 * @param tabs - The Schematic's `library`
 * @returns The sources its tabs name, in order
 * @internal
 */
export function schematicTabSources(tabs: unknown): string[] {
    if (!Array.isArray(tabs)) return [];
    return tabs.filter(isTab).flatMap((tab) => tab.kind === "tab" && tab.config.source !== undefined ? [tab.config.source] : []);
}
