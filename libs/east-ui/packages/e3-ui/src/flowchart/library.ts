/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.library` (#1501, `Flowchart Records Spec.md` R14, D5, D8): the
 * library pane's tabs, which `library` lists in order, and their wire, which
 * the renderer draws. A kind's cards are on the kind, as the Schematic's are —
 * `Flowchart.templates(rows, { name, group?, values, source })`, rows of a
 * record of the app's — and its tab lists them, following their source of the
 * slice:
 *
 * - `Flowchart.library.states()` — the Steps tab, the states' cards: one
 *   dropped on a lane adds a state there from its values, keyed `state-<n>`,
 *   its order between the cards it lands between.
 * - `Flowchart.library.transitions()` — the Transitions tab, the transitions'
 *   cards: one dropped on a transition gives it its values, its ends kept.
 * - `Flowchart.library.lanes()` — the Lanes tab, the lanes' cards: one dropped
 *   between two lanes, or at the band row's tail, adds a lane there from its
 *   values, keyed `lane-<n>`, its order between theirs.
 * - `Flowchart.library.tab(rows, { … })` — the app's own cards: its `drop` a
 *   `Flowchart.patch(R, { … })` over one kind's row type, which names the kind
 *   its cards land on — a state's, a transition's, a lane's or a decision's —
 *   through the shared `buildScheduleTab`, as the Schematic's tabs are.
 *
 * There is no Flows tab: the Flowchart draws one flowchart. Left out, or
 * empty, the Flowchart has no library pane.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, Expr, OptionType, StringType, StructType, VariantType, isTypeEqual, none, printType, some, variant,
    type DictType, type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { ScheduleAuthorTabType, buildScheduleTab, type ScheduleLibraryTabConfig } from "../schedule/library.js";
import type { FlowchartKindSort } from "./kinds.js";

export { ScheduleLibraryCardType as FlowchartLibraryCardType } from "../schedule/library.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * A kind's tab on the wire: its name and icon, the author's when given; left
 * out, the renderer names it in its words (`Steps`, `Transitions`, `Lanes`),
 * so a host translates it. Its cards are its kind's. The tab an author lists
 * is a {@link FlowchartKindTab}, which this is built from.
 */
export const FlowchartKindTabWireType = StructType({
    name: OptionType(StringType),
    icon: OptionType(StringType),
});

/** Type representing {@link FlowchartKindTabWireType}. */
export type FlowchartKindTabWireType = typeof FlowchartKindTabWireType;

/**
 * One tab of the library pane on the wire, in the order `library` lists them.
 *
 * @property states - The Steps tab: the states' cards, which the states kind carries
 * @property transitions - The Transitions tab: the transitions' cards
 * @property lanes - The Lanes tab: the lanes' cards
 * @property tab - The author's own: its name, its icon, the kind its cards land on, its cards and the source they follow
 */
export const FlowchartLibraryTabType = VariantType({
    states: FlowchartKindTabWireType,
    transitions: FlowchartKindTabWireType,
    lanes: FlowchartKindTabWireType,
    tab: ScheduleAuthorTabType,
});

/** Type representing {@link FlowchartLibraryTabType}. */
export type FlowchartLibraryTabType = typeof FlowchartLibraryTabType;

// ============================================================================
// The author's surface
// ============================================================================

/** The kinds that take cards, each with a tab of its own: the states, the transitions and the lanes. */
export type FlowchartCardKind = "states" | "transitions" | "lanes";

/** A kind's tab's options: its name and its icon. */
export interface FlowchartKindTabOptions {
    /** The tab's name; left out, the Flowchart's words: `Steps`, `Transitions` or `Lanes`. */
    name?: string;
    /** A Font Awesome solid icon name for the tab. */
    icon?: string;
}

/** A kind's tab, as `Flowchart.library.states()`, `.transitions()` or `.lanes()` returns it. */
export interface FlowchartKindTab {
    /** The kind whose cards it lists. */
    readonly kind: FlowchartCardKind;
    /** Its name, when given. */
    readonly name: string | undefined;
    /** Its icon, when given. */
    readonly icon: string | undefined;
}

/** An author's tab, as `Flowchart.library.tab(…)` returns it: its rows and how it reads them. */
export interface FlowchartAuthorTab {
    /** Identifies an author's tab. */
    readonly kind: "tab";
    /** Its rows: an Array, or a Dict by String keys. */
    readonly rows: unknown;
    /** How it reads them. */
    readonly config: ScheduleLibraryTabConfig<EastType, EastType>;
}

/** One tab of the library pane: what each `Flowchart.library.*` call returns, and `library` lists. */
export type FlowchartLibraryTab = FlowchartKindTab | FlowchartAuthorTab;

/**
 * An author's tab's options — `Flowchart.library.tab(rows, { … })`: its name
 * and icon, what each card shows, the source of the slice it follows, and the
 * patch a card dropped on a row sets.
 *
 * @typeParam T - The rows' element type
 * @typeParam P - The patch `drop` returns
 */
export type FlowchartTabConfig<T extends EastType, P extends EastType = EastType> = ScheduleLibraryTabConfig<StringType, T, P>;

/** The rows an author's tab reads: an Array, each card keyed by its index, printed; or a Dict by String keys — a record's, when it follows a source. */
export type FlowchartLibraryRows<T extends EastType> = SubtypeExprOrValue<ArrayType<T>> | SubtypeExprOrValue<DictType<StringType, T>>;

/** The cards a kind's `templates` takes, as a refusal writes them. */
const CARDS = "templates: Flowchart.templates(cards.read(), { name, values, source })";

/** How each kind's tab is named in a refusal, what its kind is called, and the kind with its cards, as a refusal writes it. */
const KIND_TABS: { readonly [K in FlowchartCardKind]: { readonly call: string; readonly noun: string; readonly declare: string } } = {
    states: { call: "Flowchart.library.states()", noun: "states", declare: `Flowchart.states(record, { label, …, ${CARDS} })` },
    transitions: { call: "Flowchart.library.transitions()", noun: "transitions", declare: `Flowchart.transitions(record, { from, to, …, ${CARDS} })` },
    lanes: { call: "Flowchart.library.lanes()", noun: "lanes", declare: `Flowchart.lanes(record, { label, …, ${CARDS} })` },
};

/**
 * A kind's tab, its options checked.
 *
 * @param kind - The kind whose cards it lists
 * @param options - The call's first argument
 * @param rest - Any argument after it
 * @returns The tab
 * @throws {Error} When given anything but `{ name?, icon? }` — rows and a config, as the earlier form took, among them — naming the cards on the kind
 */
function kindTab(kind: FlowchartCardKind, options: unknown, rest: readonly unknown[]): FlowchartKindTab {
    const { call, noun, declare } = KIND_TABS[kind];
    const words = `${call} lists the ${noun}' cards, which are on the kind — ${declare} — and takes at most { name, icon }`;
    if (rest.length > 0 || options instanceof Expr || (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options)))) {
        throw new Error(words);
    }
    const o = (options ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(o)) {
        if (key !== "name" && key !== "icon") throw new Error(`${words} — \`${key}\` is neither`);
    }
    if (o["name"] !== undefined && (typeof o["name"] !== "string" || o["name"] === "")) throw new Error(`${call}: \`name\` is the tab's name, a string`);
    if (o["icon"] !== undefined && (typeof o["icon"] !== "string" || o["icon"] === "")) throw new Error(`${call}: \`icon\` is a Font Awesome solid icon's name`);
    return { kind, name: o["name"] as string | undefined, icon: o["icon"] as string | undefined };
}

/**
 * The Steps tab — `Flowchart.library.states()` (R14, D8): the states' cards,
 * `Flowchart.templates` on `Flowchart.states`, grouped by their `group` and
 * searched by their name, each a drag source. One dropped on a lane adds a
 * state there from its values, keyed `state-<n>`, its order between the
 * cards it lands between. It follows its cards' source of the slice, counting
 * what it shows.
 *
 * @param options - The tab's name — `Steps` unless given — and its icon
 * @param rest - Nothing: rows and a config, as the earlier form took, are refused
 * @returns The tab
 * @throws {Error} When given anything but `{ name?, icon? }`, naming the cards on the kind
 */
export function libraryStates(options?: FlowchartKindTabOptions, ...rest: readonly never[]): FlowchartKindTab {
    return kindTab("states", options, rest);
}

/**
 * The Transitions tab — `Flowchart.library.transitions()` (R14, D8): the
 * transitions' cards, `Flowchart.templates` on `Flowchart.transitions`. One
 * dropped on a transition gives it its values, its ends kept.
 *
 * @param options - The tab's name — `Transitions` unless given — and its icon
 * @param rest - Nothing: rows and a config, as the earlier form took, are refused
 * @returns The tab
 * @throws {Error} When given anything but `{ name?, icon? }`, naming the cards on the kind
 */
export function libraryTransitions(options?: FlowchartKindTabOptions, ...rest: readonly never[]): FlowchartKindTab {
    return kindTab("transitions", options, rest);
}

/**
 * The Lanes tab — `Flowchart.library.lanes()` (R14, D5): the lanes' cards,
 * `Flowchart.templates` on `Flowchart.lanes`. One dropped between two lanes,
 * or at the band row's tail, adds a lane there from its values, keyed
 * `lane-<n>`, its order between theirs. + LANE stays on the canvas.
 *
 * @param options - The tab's name — `Lanes` unless given — and its icon
 * @param rest - Nothing: anything after the options is refused
 * @returns The tab
 * @throws {Error} When given anything but `{ name?, icon? }`
 */
export function libraryLanes(options?: FlowchartKindTabOptions, ...rest: readonly never[]): FlowchartKindTab {
    return kindTab("lanes", options, rest);
}

/**
 * A tab of the author's own cards — `Flowchart.library.tab(rows, { … })`
 * (R14): one card per row, its label and the line under it, grouped by its
 * `group` and searched by its key, label and line. Given a `drop` —
 * `Flowchart.patch(R, { … })` over one kind's row type, which names that kind
 * — a card dropped on a row of that kind sets the fields the patch sets:
 * an owner dropped on a decision's diamond, say. Without one, the cards are
 * read, never dragged.
 *
 * @remarks
 * The rows are an `Array<T>`, each card keyed by its index, printed, or a
 * `Dict<String, T>`, each by its key. Naming a `source` of the Flowchart's
 * slice, the tab follows it by its cards' keys, each a row's key in that
 * record — so its rows are that record's, a Dict; naming none, it lists its
 * rows whole. A tab's name is its identity in `library`. `Flowchart.templates`'
 * example, the depot, shows the tabs together, its Owners tab among them.
 *
 * @typeParam T - The rows' element type
 * @typeParam P - The patch `drop` returns
 * @param rows - The rows: an `Array<T>` or a `Dict<String, T>`, usually a record's `read()`
 * @param config - The tab's name and icon, what each card shows, its `drop` and its `source` ({@link FlowchartTabConfig})
 * @returns The tab
 */
export function libraryTab<T extends EastType, P extends EastType = EastType>(rows: FlowchartLibraryRows<T>, config: FlowchartTabConfig<T, P>): FlowchartAuthorTab {
    return { kind: "tab", rows, config: config as unknown as ScheduleLibraryTabConfig<EastType, EastType> };
}

/** The library pane's tabs — `Flowchart.library`. */
export interface FlowchartLibrary {
    /** The Steps tab: the states' cards ({@link libraryStates}). */
    states: typeof libraryStates;
    /** The Transitions tab: the transitions' cards ({@link libraryTransitions}). */
    transitions: typeof libraryTransitions;
    /** The Lanes tab: the lanes' cards ({@link libraryLanes}). */
    lanes: typeof libraryLanes;
    /** The author's own cards ({@link libraryTab}). */
    tab: typeof libraryTab;
}

/** The library pane's tabs, each a factory (`Flowchart.library`). */
export const FlowchartLibraryFactories: FlowchartLibrary = {
    states: libraryStates,
    transitions: libraryTransitions,
    lanes: libraryLanes,
    tab: libraryTab,
};

// ============================================================================
// The build
// ============================================================================

/** One of the Flowchart's kinds, as its library is built against it. */
export interface FlowchartLibraryKind {
    /** Its sort: the prop it fills. */
    readonly sort: FlowchartKindSort;
    /** Its record's row type. */
    readonly rowType: StructType;
    /** Whether it has cards. */
    readonly templates: boolean;
}

/**
 * What a Flowchart's library is built against.
 *
 * @internal
 */
export interface FlowchartLibraryContext {
    /** Its kinds, in order: its states, and its transitions, lanes and decisions where given. */
    readonly kinds: readonly FlowchartLibraryKind[];
    /** The slice's sources: an author's tab's `source` names one of them. */
    readonly sources: readonly string[];
}

/** How a tab names itself in a refusal. */
function tabName(tab: FlowchartLibraryTab): string {
    return tab.kind === "tab" ? `the "${tab.config.name}" tab` : KIND_TABS[tab.kind].call;
}

/** Whether a value is one of the library's tabs. */
function isTab(value: unknown): value is FlowchartLibraryTab {
    if (typeof value !== "object" || value === null) return false;
    const kind = (value as { kind?: unknown }).kind;
    if (kind === "tab") {
        const config = (value as { config?: unknown }).config;
        return typeof config === "object" && config !== null;
    }
    return kind === "states" || kind === "transitions" || kind === "lanes";
}

/**
 * An author's tab's rows, as the shared tab reads them: a Dict by String keys
 * as it is; an Array as a Dict keyed by each row's index, printed.
 *
 * @param tab - The tab
 * @returns Its declaration over Dict rows
 * @throws {Error} Naming the tab: rows that are neither an Array nor a `Dict<String, T>`; an Array following a source,
 *   whose cards' keys are its indexes, never that record's keys; and a `key`, which the rows' keys are
 */
function keyedRows(tab: FlowchartAuthorTab): FlowchartAuthorTab {
    if ("key" in tab.config) {
        throw new Error(`Flowchart: ${tabName(tab)}'s cards are keyed by its rows' keys — a Dict's key, or an Array's index — leave \`key\` out`);
    }
    const rows = East.value(tab.rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(rows as unknown as Expr) as EastType;
    if (type.type === "Dict" && isTypeEqual(type.key as EastType, StringType)) return { ...tab, rows };
    if (type.type !== "Array") {
        throw new Error(`Flowchart: ${tabName(tab)} reads its rows as an Array<T> or a Dict<String, T> — a value, or an expression such as a record's read() — ` +
            `and these are ${printType(type)}`);
    }
    if (tab.config.source !== undefined) {
        throw new Error(`Flowchart: ${tabName(tab)} follows the source '${tab.config.source}' by its cards' keys, each a row's key in that record — ` +
            "read its rows as that record's, a Dict<String, T>, its binding's read(), never an Array keyed by index");
    }
    const array = rows as unknown as ExprType<ArrayType<EastType>>;
    return { ...tab, rows: array.toDict(($, _row, index) => East.print(index), ($, row, _index) => row) };
}

/**
 * Builds the library pane on the wire (R14): its tabs in the order `library`
 * lists them; none when it is left out.
 *
 * @param tabs - The tabs, each a `Flowchart.library.*` call
 * @param ctx - What the library is built against
 * @returns The tabs on the wire
 * @throws {Error} Naming the tab: a `library` that is no list of `Flowchart.library.*` calls; a tab listed twice (an
 *   author's tab by its name); a kind's tab when the Flowchart has no such kind, or the kind has no cards; and each of
 *   an author's tab's refusals — rows that are neither an Array nor a `Dict<String, T>`, an Array following a source,
 *   a `key`, a source the slice lacks, and a `drop` over no kind's row type, or over one several kinds share
 * @internal
 */
export function buildFlowchartLibrary(tabs: unknown, ctx: FlowchartLibraryContext): ExprType<ArrayType<FlowchartLibraryTabType>> {
    if (tabs === undefined) return East.value([], ArrayType(FlowchartLibraryTabType));
    if (!Array.isArray(tabs) || !tabs.every(isTab)) {
        throw new Error("Flowchart: `library` lists the library pane's tabs, in order, each a Flowchart.library.* call — " +
            "states(), transitions(), lanes() or tab(rows, { … })");
    }
    const seen = new Set<string>();
    for (const tab of tabs as readonly FlowchartLibraryTab[]) {
        const id = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(id)) {
            throw new Error(tab.kind === "tab"
                ? `Flowchart: the library lists two tabs named "${tab.config.name}" — each tab's name is its own`
                : `Flowchart: the library lists ${tabName(tab)} twice — each tab once`);
        }
        seen.add(id);
        if (tab.kind !== "tab") {
            const { noun, declare } = KIND_TABS[tab.kind];
            const kind = ctx.kinds.find((one) => one.sort === tab.kind);
            if (kind === undefined) {
                throw new Error(`Flowchart: the library lists ${tabName(tab)}, and this Flowchart has no ${noun} — give ${tab.kind}={${declare}}`);
            }
            if (!kind.templates) {
                throw new Error(`Flowchart: the library lists ${tabName(tab)}, and the ${noun} have no cards — give them their cards: ${declare}`);
            }
        }
    }
    const landsOn = ctx.kinds.map((kind) => [kind.sort, { rowType: kind.rowType }] as const);
    const wires = (tabs as readonly FlowchartLibraryTab[]).map((tab): ExprType<FlowchartLibraryTabType> => {
        if (tab.kind === "tab") {
            const keyed = keyedRows(tab);
            return East.value(variant("tab", buildScheduleTab(keyed, landsOn, "Flowchart", ctx.sources, { kind: "kind", patch: "Flowchart.patch" })),
                FlowchartLibraryTabType);
        }
        return East.value(variant(tab.kind, {
            name: tab.name === undefined ? none : some(tab.name),
            icon: tab.icon === undefined ? none : some(tab.icon),
        }), FlowchartLibraryTabType);
    });
    return East.value(wires, ArrayType(FlowchartLibraryTabType));
}

/**
 * The sources of the slice the author's tabs name: each one the slice may
 * hold, and its tab refused when the slice lacks it.
 *
 * @param tabs - The Flowchart's `library`
 * @returns The sources its tabs name, in order
 * @internal
 */
export function flowchartTabSources(tabs: unknown): string[] {
    if (!Array.isArray(tabs)) return [];
    return tabs.filter(isTab).flatMap((tab) => tab.kind === "tab" && tab.config.source !== undefined ? [tab.config.source] : []);
}
