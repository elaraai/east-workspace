/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schematic.library` (#1386, #1401, `Schematic Builder Spec.md` §8): the
 * library pane's tabs, which `library` lists in order, and their wire, which
 * the renderer draws (#1389). Like the Calendar's, each covers every kind
 * (D33).
 *
 * - `Schematic.library.templates()`: every kind's templates (§4.6), each
 *   kind's under its name, then grouped by their `group`, each card a drag
 *   source. Each kind's cards follow their templates' source of the slice.
 * - `Schematic.library.backlog()`: every item kind's rows with no position,
 *   each kind's under its name, each a drag source: the Backlog tab, as the
 *   Calendar's is.
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

import { ArrayType, East, NullType, VariantType, variant, type DictType, type EastType, type ExprType, type StructType, type SubtypeExprOrValue } from "@elaraai/east";
import { ScheduleAuthorTabType, buildScheduleTab, type ScheduleLibraryTabConfig } from "../schedule/library.js";

export { ScheduleLibraryCardType as SchematicLibraryCardType, type ScheduleLibraryTabConfig as SchematicLibraryTabConfig } from "../schedule/library.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * One tab of the library pane on the wire, in the order `library` lists them.
 *
 * @property templates - Every kind's templates
 * @property backlog - Every item kind's rows with no position
 * @property index - The zones, nested by containment
 * @property layers - The layers
 * @property tab - The author's own: its name, its icon, the kind its cards land on, and its cards
 */
export const SchematicLibraryTabType = VariantType({
    templates: NullType,
    backlog: NullType,
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
    | { readonly kind: "templates" }
    | { readonly kind: "backlog" }
    | { readonly kind: "index" }
    | { readonly kind: "layers" }
    | { readonly kind: "tab"; readonly rows: unknown; readonly config: ScheduleLibraryTabConfig<EastType, EastType> };

/**
 * Refuses a slot given to a tab that covers every kind (D33), naming the form
 * to use.
 *
 * @param tab - The tab's factory, as the refusal names it
 * @param given - What it was given
 * @throws {Error} When it was given anything
 */
function takesNoSlot(tab: "templates" | "backlog", given: readonly unknown[]): void {
    if (given.length === 0) return;
    throw new Error(tab === "templates"
        ? "Schematic.library.templates() lists every kind's templates, each kind's under its name, as the Calendar's does — leave the slot out"
        : "Schematic.library.backlog() lists every item kind's rows with no position, each kind's under its name, as the Calendar's does — leave the slot out");
}

/**
 * The library's Templates tab (§8, D33): every kind's templates, each kind's
 * under its name, then grouped by their `group`, each card a drag source.
 * Dropped on the canvas, an item template adds an item at the drop point;
 * dropped on a link, a link template retypes it. Each kind's cards follow
 * their templates' source of the slice, counting what they show.
 *
 * @param given - Nothing: a slot given, as the earlier form took, is refused
 * @returns The tab
 * @throws {Error} When given a slot, naming the form to use
 */
export function libraryTemplates(...given: readonly never[]): SchematicLibraryTab {
    takesNoSlot("templates", given);
    return { kind: "templates" };
}

/**
 * The library's Backlog tab (§8, D33): every item kind's rows with no
 * position, each kind's under its name, each a drag source a drop places, as
 * the Calendar's Backlog is. An item kind whose `x` and `y` are Options of
 * Float has a backlog.
 *
 * @param given - Nothing: a slot given is refused
 * @returns The tab
 * @throws {Error} When given a slot, naming the form to use
 */
export function libraryBacklog(...given: readonly never[]): SchematicLibraryTab {
    takesNoSlot("backlog", given);
    return { kind: "backlog" };
}

/**
 * `Schematic.library.unplaced(slot)`, removed (D33): refused, naming the
 * Backlog tab that replaces it.
 *
 * @returns Never
 * @throws {Error} Always, naming `Schematic.library.backlog()`
 */
function libraryUnplaced(): never {
    throw new Error("Schematic.library.unplaced(slot) is gone — Schematic.library.backlog() lists every item kind's rows with no position, each kind's under its name");
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
    /** Every kind's templates ({@link libraryTemplates}). */
    templates: libraryTemplates,
    /** Every item kind's rows with no position ({@link libraryBacklog}). */
    backlog: libraryBacklog,
    /** @deprecated Removed (#1401): every item kind's rows with no position are `Schematic.library.backlog()`. */
    unplaced: libraryUnplaced as (...args: never[]) => never,
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
    /** Whether it declares its layers (`Schematic.layers`). */
    readonly layers: boolean;
    /** The slice's sources, which an author's tab's `source` must be one of. */
    readonly sources: readonly string[];
}

/** How a tab names itself in a refusal. */
function tabName(tab: SchematicLibraryTab): string {
    return tab.kind === "tab" ? `the "${tab.config.name}" tab` : `Schematic.library.${tab.kind}()`;
}

/** Whether a value is one of the library's tabs. */
function isTab(value: unknown): value is SchematicLibraryTab {
    if (typeof value !== "object" || value === null) return false;
    const kind = (value as { kind?: unknown }).kind;
    return kind === "templates" || kind === "backlog" || kind === "index" || kind === "layers" || kind === "tab";
}

/**
 * Builds the library pane on the wire (§8): its tabs in the order `library`
 * lists them; none when it is left out.
 *
 * @param tabs - The tabs, each a `Schematic.library.*` call
 * @param ctx - What the library is built against
 * @returns The tabs on the wire
 * @throws {Error} Naming the tab: a `library` that is no list of `Schematic.library.*` calls; a tab listed twice (an
 *   author's tab by its name); the Templates tab when no kind has templates; the Backlog tab when no item kind's `x` and
 *   `y` are Options; the Index tab with no zone kinds; the Layers tab with no layers; and each of an author's tab's
 *   refusals
 * @internal
 */
export function buildSchematicLibrary(tabs: unknown, ctx: SchematicLibraryContext): ExprType<ArrayType<SchematicLibraryTabType>> {
    if (tabs === undefined) return East.value([], ArrayType(SchematicLibraryTabType));
    if (!Array.isArray(tabs) || !tabs.every(isTab)) {
        throw new Error("Schematic: `library` lists the library pane's tabs, in order, each a Schematic.library.* call — " +
            "templates(), backlog(), index(), layers() or tab(rows, { … })");
    }
    const seen = new Set<string>();
    for (const tab of tabs as readonly SchematicLibraryTab[]) {
        const id = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(id)) {
            throw new Error(tab.kind === "tab"
                ? `Schematic: the library lists two tabs named "${tab.config.name}" — each tab's name is its own`
                : `Schematic: the library lists ${tabName(tab)} twice — each tab once`);
        }
        seen.add(id);
        if (tab.kind === "templates" && !ctx.kinds.some((kind) => kind.templates)) {
            throw new Error(`Schematic: the library lists ${tabName(tab)}, and none of its kinds has templates — give an item, link or net kind templates: ` +
                "Schematic.templates(templates.read(), { name, values, source })");
        }
        if (tab.kind === "backlog" && !ctx.kinds.some((kind) => kind.sort === "items" && kind.backlog)) {
            const items = ctx.kinds.filter((kind) => kind.sort === "items").map((kind) => `"${kind.slot}"`).join(", ");
            throw new Error(`Schematic: the library lists ${tabName(tab)}, and every item kind places every row — ${items} take Float \`x\` and \`y\` fields: ` +
                "make an item kind's Options of Float to give it rows with no position");
        }
        if (tab.kind === "index" && !ctx.kinds.some((kind) => kind.sort === "zones")) {
            throw new Error("Schematic: the library lists Schematic.library.index(), and this Schematic has no zone kinds — the Index tab lists the zones (Schematic.zones), nested by containment");
        }
        if (tab.kind === "layers" && !ctx.layers) {
            throw new Error("Schematic: the library lists Schematic.library.layers(), and this Schematic declares no layers — read them from the app's record: " +
                "layers={Schematic.layers(systems.read(), { label })}");
        }
    }
    const landsOn = ctx.kinds.map((kind) => [kind.slot, { rowType: kind.rowType }] as const);
    const wires = (tabs as readonly SchematicLibraryTab[]).map((tab): ExprType<SchematicLibraryTabType> => {
        switch (tab.kind) {
            case "templates":
            case "backlog":
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
