/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's payload (#1386, #1401, `Schematic Builder Spec.md` §2, §5):
 * what `<Schematic>` hands the renderer through its `Schematic` carrier — the
 * drawing's extent and scale, its kinds by slot, its layers, its narrowing and
 * how a narrowed-out row draws, its library's tabs, whether it has an
 * inspector, whether it is read only, its `id`, the canvas's options, the
 * connect veto and what the host hears — and every refusal of its props, made
 * when the surface is built.
 *
 * Its props are the Plan's, the Roster's and the Calendar's (D31–D34): `id`
 * keeps its state apart, the inspector is opted into, the library's tabs cover
 * every kind, `onSelect` hears the whole selection, and `canConnect` answers a
 * candidate with the refusal's words. Its layers are the app's rows
 * (`Schematic.layers`, D36).
 *
 * Its kinds are the app's records (§1, `kinds.ts`): `items`, `zones`, `links`
 * and `nets` each map a slot to a kind, each closed over its record behind
 * East functions over beast2 bytes, so the payload is one type whatever the
 * rows hold. A slot names the kind in the payload and the source of the slice
 * that narrows it.
 *
 * Its narrowing is one `Slice.bindRecords` (§10.1): a source named after a
 * kind's slot narrows that kind, read complete through it (`window.ts`), and
 * each other source the templates list or the author's tab that names it. The
 * payload's block binds each source once (`recordSources(…).bind($)`, #1356),
 * and each kind reads its own source inside its functions.
 *
 * The props §2 removes are refused when the surface is built, each naming the
 * form that replaces it (SC3).
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DictType, East, Expr, FloatType, FunctionType, NullType, OptionType, StringType, StructType, none, some, variant,
    type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { EastUI, RowSourceType } from "@elaraai/east-ui";
import { RecordSlicesChromeType, isRecordSlices, type RecordSlicesChromeOptions } from "@elaraai/east-ui/internal";
import { recordSources, sliceSourceNames, templatesSource } from "../utils/record-sources.js";
import { isSchematicKind, type SchematicItems, type SchematicLinks, type SchematicNets, type SchematicZones } from "./kinds.js";
import { SchematicLibraryTabType, buildSchematicLibrary, schematicTabSources, type SchematicLibraryKind, type SchematicLibraryTab } from "./library.js";
import { isSchematicLayers, type SchematicLayers } from "./layers.js";
import {
    SchematicCandidateType, SchematicItemKindType, SchematicLayerType, SchematicLinkKindType, SchematicNarrowedType, SchematicNetKindType,
    SchematicRefType, SchematicZoneKindType,
} from "./types.js";

// ============================================================================
// The payload
// ============================================================================

/** Each source's shown keys on the wire, by the source's name. */
const ShownType = DictType(StringType, RowSourceType(ArrayType(StringType)));

/**
 * The `Schematic` renderer's payload: the Schematic's interface (§5).
 *
 * @property extent - The drawing's world bounds; the canvas fits them
 * @property scaleUnit - The scale bar's unit
 * @property items - The item kinds, in the order `items` lists their slots
 * @property zones - The zone kinds
 * @property links - The link kinds
 * @property nets - The net kinds
 * @property layers - The layers, from the app's record, and their author defaults, in their order (§8)
 * @property slice - The rail's chrome over the one `Slice.bindRecords`; `none`, no rail
 * @property shown - Each source's shown keys, paged through its own data, by the source's name: what a templates list's and a tab's cards follow, and what dims a narrowed-out row
 * @property narrowed - How a narrowed-out row draws (§10.3)
 * @property library - The library pane's tabs, in the order `library` lists them; none, no library pane
 * @property inspector - Whether the inspector pane shows (§9): off unless `inspector` is given
 * @property readOnly - No gesture, drop or inspector edit; selection stays
 * @property id - Keeps the Schematic's state apart, when a surface holds two
 * @property grid - The metric grid; on by default
 * @property minimap - The minimap; shown at 25 items or more by default
 * @property canConnect - Vetoes a link or a net before its draft snaps: `none` allows it, or the refusal's words
 * @property onSelect - Hears the whole selection after each change, each entity by its kind and key
 */
export const SchematicPayloadType = StructType({
    extent: StructType({ width: FloatType, height: FloatType }),
    scaleUnit: OptionType(StringType),
    items: ArrayType(SchematicItemKindType),
    zones: ArrayType(SchematicZoneKindType),
    links: ArrayType(SchematicLinkKindType),
    nets: ArrayType(SchematicNetKindType),
    layers: ArrayType(SchematicLayerType),
    slice: OptionType(RecordSlicesChromeType),
    shown: ShownType,
    narrowed: SchematicNarrowedType,
    library: ArrayType(SchematicLibraryTabType),
    inspector: BooleanType,
    readOnly: BooleanType,
    id: OptionType(StringType),
    grid: OptionType(BooleanType),
    minimap: OptionType(BooleanType),
    canConnect: OptionType(FunctionType([SchematicCandidateType], OptionType(StringType))),
    onSelect: OptionType(FunctionType([ArrayType(SchematicRefType)], NullType)),
});

/** Type representing the `Schematic` renderer's payload. */
export type SchematicPayloadType = typeof SchematicPayloadType;

/**
 * The `Schematic` carrier: `<Schematic>` builds a {@link SchematicPayloadType}
 * and returns it through this {@link EastUI.component}. The React renderer
 * registers against it in `@elaraai/e3-ui-components` via
 * `implementUIComponent`.
 */
export const SchematicComponent = EastUI.component("Schematic", SchematicPayloadType, { optional: true });

// ============================================================================
// The Schematic's shared keys
// ============================================================================

/**
 * The names a Schematic keeps its viewer's state under, by its `id` (§5,
 * D31): its frame's panes, its library's id, the layers the viewer shows,
 * hides and locks, the tool it holds, and its drop surface, where its
 * library's cards land.
 *
 * @remarks
 * As the Plan's `planKeys(id)`: two Schematics on one surface keep apart only
 * when each has an `id`.
 *
 * @param id - The Schematic's `id`, when a surface holds more than one; omitted, the one Schematic
 * @returns The keys
 */
export function schematicKeys(id: string | undefined): {
    /** The frame's storage key: each pane's open tab and collapsed state. */
    frame: string;
    /** The library's id: what its tabs' cards are drawn from. */
    library: string;
    /** The Layers tab's UI store key: the layers the viewer shows, hides, isolates and locks. */
    layers: string;
    /** The tools' UI store key: the tool the viewer holds, and the link kind Connect draws. */
    tools: string;
    /** The Schematic's drop surface: where its canvas takes its library's cards. */
    surface: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        frame: `schematic${suffix}.frame`,
        library: `schematic.library${suffix}`,
        layers: `schematic${suffix}.layers`,
        tools: `schematic${suffix}.tools`,
        surface: `schematic${suffix}.surface`,
    };
}

// ============================================================================
// <Schematic>'s props
// ============================================================================

/**
 * How a narrowed-out row draws, in full (§10.3).
 *
 * @property show - `hide` (the default) or `dim`
 * @property opacity - A dimmed row's opacity (0.35 by default)
 * @property desaturate - Whether a dimmed row is drained of colour (on by default)
 * @property dot - Whether a dimmed row draws as a bare marker
 * @property emphasis - A ring on each match — `halo`, or `pulse`, which breathes — whatever `show` is
 * @property frame - Whether the matches are boxed
 * @property fit - Whether the camera flies to the matches when the narrowing changes
 */
export interface SchematicNarrowedOptions {
    /** `hide` (the default) or `dim`. */
    show: "hide" | "dim";
    /** A dimmed row's opacity (0.35 by default). */
    opacity?: number;
    /** Whether a dimmed row is drained of colour (on by default). */
    desaturate?: boolean;
    /** Whether a dimmed row draws as a bare marker. */
    dot?: boolean;
    /** A ring on each match, whatever `show` is: `halo`, or `pulse`, which breathes. */
    emphasis?: "halo" | "pulse";
    /** Whether the matches are boxed. */
    frame?: boolean;
    /** Whether the camera flies to the matches when the narrowing changes. */
    fit?: boolean;
}

/** `<Schematic>`'s props (§5). */
export interface SchematicProps {
    /** The drawing's world bounds; the canvas fits them. */
    extent: { width: number; height: number };
    /** The scale bar's unit. */
    scaleUnit?: SubtypeExprOrValue<StringType>;
    /** The item kinds, by slot: `items={{ racks: Schematic.items(record, { … }) }}`, one at least. */
    items: Readonly<Record<string, SchematicItems>>;
    /** The zone kinds, by slot. */
    zones?: Readonly<Record<string, SchematicZones>>;
    /** The link kinds, by slot. */
    links?: Readonly<Record<string, SchematicLinks>>;
    /** The net kinds, by slot. */
    nets?: Readonly<Record<string, SchematicNets>>;
    /**
     * The layers, from the app's record (§8, D36): `Schematic.layers(systems.read(), { label, order?, tone?, color?,
     * visible?, locked?, opacity? })`. An entity's `layer` field names one by its record's key.
     */
    layers?: SchematicLayers;
    /**
     * The narrowing (§10.1): slice={{ slice: Slice.bindRecords(key, { … }), affordances?, persist? }}, one rail on the
     * toolbar. A source named after a kind's slot narrows that kind — `Data.bindPaged(record, { indexes, join: true })`
     * over the kind's record — and each other source the templates list or the author's tab that names it.
     */
    slice?: RecordSlicesChromeOptions;
    /** How a narrowed-out row draws (§10.3): `"hide"` (the default), `"dim"`, or the options in full. */
    narrowed?: "hide" | "dim" | SchematicNarrowedOptions;
    /** The library pane's tabs, in order, each a `Schematic.library.*` call; left out, or empty, no library pane. */
    library?: readonly SchematicLibraryTab[];
    /**
     * Shows the inspector pane (§9, D32): Details and Issues. Left out, or `false`, no pane. A kind's own Details is its
     * kind's `inspector`.
     */
    inspector?: boolean;
    /** No gesture, drop or inspector edit; selection stays. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Keeps this Schematic's panes, layers and tools apart when one surface holds two (`schematicKeys(id)`, D31). */
    id?: string;
    /** The metric grid; on by default. */
    grid?: SubtypeExprOrValue<BooleanType> | boolean;
    /** The minimap; shown at 25 items or more by default. */
    minimap?: SubtypeExprOrValue<BooleanType> | boolean;
    /**
     * Vetoes a link or a net before its draft snaps (D34): an East function from `Schematic.Types.Candidate` — the slot
     * of the link or net kind the gesture writes, and its two items — to `none`, which allows it, or the refusal's
     * words, which the draft shows. A veto that throws allows the pair and logs it.
     */
    canConnect?: SubtypeExprOrValue<FunctionType<[typeof SchematicCandidateType], OptionType<StringType>>>;
    /** Hears the whole selection after each change, items, zones, links and nets alike, each by its kind and key (D34). */
    onSelect?: SubtypeExprOrValue<FunctionType<[ArrayType<typeof SchematicRefType>], NullType>>;
}

/** The props, erased: what the implementation reads. */
type SchematicAnyProps = { [K in keyof SchematicProps]?: unknown } & Record<string, unknown>;

/** The refusal of rows and their mappers: kinds over the app's records replace them (§2). */
function rowsRefusal(prop: string): string {
    const sort = prop.startsWith("item") ? "items" : prop.startsWith("zone") ? "zones" : prop.startsWith("link") ? "links" : "nets";
    const example = {
        items: "items={{ racks: Schematic.items(Record.bind(racks, [e3.mutation.patch(racks)]), { name, icon, x, y, label }) }}",
        zones: "zones={{ halls: Schematic.zones(Data.bind(halls), { name, icon, x, y, width, height, label }) }}",
        links: "links={{ fibre: Schematic.links(Record.bind(fibres, [e3.mutation.patch(fibres)]), { name, icon, from: { field, of }, to: { field, of } }) }}",
        nets: "nets={{ feeds: Schematic.nets(Record.bind(feeds, [e3.mutation.patch(feeds)]), { name, icon, sources: { field, of }, destinations: { field, of } }) }}",
    }[sort];
    return `Schematic: rows and their mappers are gone — an app's rows are its records, each kind's fields mapped to its roles: ${example}`;
}

/** The refusal of a callback for an edit: the editing session's gestures replace them (§2, §7). */
const SESSION = "every gesture is a transaction of the Schematic's editing session, and Save writes each record through its patch door — " +
    "bind a kind with Record.bind(record, [e3.mutation.patch(record)]) to edit it";

/** The refusal of the slice's effect props: `narrowed` replaces them (§2, §10.3). */
const NARROWED = "how a narrowed-out row draws is `narrowed` — narrowed=\"dim\", or narrowed={{ show: \"dim\", opacity, desaturate, dot, emphasis, frame, fit }}";

/** The refusal of a hover card: the inspector replaces them (§2, §9). */
const HOVER = "the inspector shows what is selected — give `inspector` for the pane, and a kind its own Details with its `inspector`: " +
    "Schematic.items(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })";

/** The refusal of a selection callback of another form: `onSelect` replaces them (§2, D34). */
const SELECT = "`onSelect` hears the whole selection after each change, items, zones, links and nets alike, each by its kind and key: " +
    "onSelect={East.function([ArrayType(Schematic.Types.Ref)], NullType, ($, selected) => …)}";

/** The refusal of a size: the Schematic fills the box it is given (§2). */
const SIZE = "the Schematic fills the box it is given — give it a box of its own height: <Box height=\"640px\"><Schematic … /></Box>";

/** Each prop §2 removes, with the form that replaces it (SC3). */
const REMOVED: Readonly<Record<string, string>> = {
    item: rowsRefusal("item"),
    zone: rowsRefusal("zone"),
    link: rowsRefusal("link"),
    net: rowsRefusal("net"),
    onMoveItem: SESSION,
    onCreateLink: SESSION,
    onEditLink: SESSION,
    onDeleteLink: SESSION,
    onEditNet: SESSION,
    linkMode: "the Connect tool always records a link, of the link kind its menu picks — an app that plans operations between items gives them a link kind of their own",
    readOnlyLinks: "a kind is read only when it is bound read only — Data.bind(record), or Data.bindPaged(record) read through its source",
    readOnlyItems: "a kind is read only when it is bound read only — Data.bind(record), or Data.bindPaged(record) read through its source",
    itemHover: HOVER,
    zoneHover: HOVER,
    linkHover: HOVER,
    affordances: "it moved into `slice`: slice={{ slice: Slice.bindRecords(key, { … }), affordances }}",
    sliceHidden: NARROWED,
    sliceOpacity: NARROWED,
    sliceDesaturate: NARROWED,
    sliceDot: NARROWED,
    sliceEmphasis: NARROWED,
    sliceFrame: NARROWED,
    sliceFrameFit: NARROWED,
    sliceSelectField: "the selection drives the inspector, and the rail is the only narrowing — leave it out",
    selectionMode: "selection is built in: a tap selects, Shift extends it, and the Marquee tool boxes — leave it out",
    navigator: "the library's Index tab lists the zones and the items inside them: library={[Schematic.library.index()]}",
    height: SIZE,
    maxHeight: SIZE,
    onSelectZone: SELECT,
    onSelectionChange: SELECT,
    onZoneSelectionChange: SELECT,
    onSelectLink: SELECT,
    onViewportChange: "the canvas reads its own window, and nothing hears where the camera settled — leave it out",
    onItemOpen: "Enter or a double-click opens the selection in the inspector's Details — give `inspector`, and a kind its own Details with its `inspector`",
    selectZoomFocus: "a tap selects in place, and Find, the Index tab and the arrow keys fly to what they pick — leave it out",
    name: "`id` names the Schematic, as the Plan's, the Roster's and the Calendar's do: <Schematic id=\"floor\" … />",
};

/** Every prop `<Schematic>` takes. */
const PROPS: ReadonlySet<string> = new Set([
    "extent", "scaleUnit", "items", "zones", "links", "nets", "layers", "slice", "narrowed", "library", "inspector", "readOnly", "id",
    "grid", "minimap", "canConnect", "onSelect",
]);

/** A sort's noun, as a refusal names a kind of it. */
const NOUN = { items: "item", zones: "zone", links: "link", nets: "net" } as const;

/** The declaration each sort takes, as a refusal names it. */
const DECLARE = {
    items: "Schematic.items(record, { name, icon, x, y, label })",
    zones: "Schematic.zones(record, { name, icon, x, y, width, height, label })",
    links: "Schematic.links(record, { name, icon, from, to })",
    nets: "Schematic.nets(record, { name, icon, sources, destinations })",
} as const;

/** A kind of any sort, declared. */
type AnyKind = SchematicItems | SchematicZones | SchematicLinks | SchematicNets;

/** A kind, under its slot. */
interface Slotted {
    readonly slot: string;
    readonly sort: "items" | "zones" | "links" | "nets";
    readonly kind: AnyKind;
}

/**
 * Reads one sort's kinds by slot (§1, rule 5), each checked to be a kind of
 * that sort.
 *
 * @param sort - The prop: `items`, `zones`, `links` or `nets`
 * @param given - What it was given
 * @returns Its kinds, in the order their slots are listed
 * @throws {Error} When it is rows rather than kinds by slot, or a slot holds no kind of its sort
 */
function kindsOf(sort: Slotted["sort"], given: unknown): Slotted[] {
    if (given === undefined) return [];
    if (given instanceof Expr || Array.isArray(given) || typeof given !== "object" || given === null || isSchematicKind(given, sort)) {
        throw new Error(isSchematicKind(given, sort)
            ? `Schematic: \`${sort}\` takes kinds by slot — ${sort}={{ <slot>: ${DECLARE[sort]} }}: a slot names the kind, and the source of the slice that narrows it`
            : rowsRefusal(sort));
    }
    return Object.entries(given as Record<string, unknown>).map(([slot, kind]) => {
        if (!isSchematicKind(kind, sort)) {
            const other = (["items", "zones", "links", "nets"] as const).find((s) => isSchematicKind(kind, s));
            throw new Error(`Schematic: \`${sort}.${slot}\` is ${sort === "items" ? "an" : "a"} ${NOUN[sort]} kind, ${DECLARE[sort]}` +
                (other === undefined ? "" : ` — and this is ${other === "items" ? "an" : "a"} ${NOUN[other]} kind: give it under \`${other}\``));
        }
        return { slot, sort, kind: kind as AnyKind };
    });
}

/** The drawing's world bounds, checked. */
function extentOf(extent: unknown): { width: number; height: number } {
    const box = extent as { width?: unknown; height?: unknown } | undefined;
    const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
    if (typeof extent !== "object" || extent === null || !positive(box?.width) || !positive(box?.height)) {
        throw new Error("Schematic: `extent` is the drawing's world bounds, { width, height }, each a positive number of world units — the canvas fits them");
    }
    return { width: box!.width as number, height: box!.height as number };
}

/** How a narrowed-out row draws, on the wire. */
function narrowedOf(narrowed: unknown): ExprType<SchematicNarrowedType> {
    const options = narrowed === undefined || narrowed === "hide" ? { show: "hide" } : narrowed === "dim" ? { show: "dim" } : narrowed;
    const o = options as Partial<Record<keyof SchematicNarrowedOptions, unknown>>;
    const flag = (value: unknown) => value === undefined || typeof value === "boolean";
    if (typeof options !== "object" || options === null || (o.show !== "hide" && o.show !== "dim")
        || !(o.opacity === undefined || (typeof o.opacity === "number" && o.opacity >= 0 && o.opacity <= 1))
        || !flag(o.desaturate) || !flag(o.dot) || !flag(o.frame) || !flag(o.fit)
        || !(o.emphasis === undefined || o.emphasis === "halo" || o.emphasis === "pulse")) {
        throw new Error("Schematic: `narrowed` is \"hide\" (the default), \"dim\", or { show: \"hide\" | \"dim\", opacity?: 0–1, desaturate?, dot?, emphasis?: \"halo\" | \"pulse\", frame?, fit? }");
    }
    return East.value({
        show: variant(o.show as "hide" | "dim", null),
        opacity: (o.opacity as number | undefined) ?? 0.35,
        desaturate: (o.desaturate as boolean | undefined) ?? true,
        dot: (o.dot as boolean | undefined) ?? false,
        emphasis: o.emphasis === undefined ? none : some(variant(o.emphasis as "halo" | "pulse", null)),
        frame: (o.frame as boolean | undefined) ?? false,
        fit: (o.fit as boolean | undefined) ?? false,
    }, SchematicNarrowedType);
}

/** The layers' declaration, as a refusal names it. */
const LAYERS = "layers={Schematic.layers(systems.read(), { label: (s) => s.label, order?, tone?, color?, visible?, locked?, opacity? })}";

/**
 * The layers on the wire: what `Schematic.layers` read from the app's record
 * (D36); none, when left out.
 *
 * @param layers - The Schematic's `layers`
 * @returns The layers, in their order
 * @throws {Error} For a list written in the code, or anything but `Schematic.layers`' declaration, naming it
 */
function layersOf(layers: unknown): ExprType<ArrayType<SchematicLayerType>> {
    if (layers === undefined) return East.value([], ArrayType(SchematicLayerType));
    if (isSchematicLayers(layers)) return layers.rows;
    if (Array.isArray(layers)) {
        throw new Error(`Schematic: \`layers\` reads the app's own rows, as the Roster's lists do — ${LAYERS}: a list written in the code is gone, ` +
            "so each layer is a row of the app's record, keyed as an entity's `layer` field names it");
    }
    throw new Error(`Schematic: \`layers\` is ${LAYERS}`);
}

/**
 * The inspector pane (§9, D32): shown for `true`, none for `false` or left
 * out, as the Plan's, the Roster's and the Calendar's.
 *
 * @param inspector - The Schematic's `inspector`
 * @returns Whether the pane shows
 * @throws {Error} For an `inspector` that is no Boolean, naming the kind's own `inspector`, the one way to give it Details
 */
function inspectorOf(inspector: unknown): boolean {
    if (inspector === undefined || inspector === false) return false;
    if (inspector === true) return true;
    throw new Error("Schematic: `inspector` is true or false — a kind's own Details is its kind's `inspector`: " +
        "Schematic.items(record, { …, inspector: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) })");
}

/**
 * Creates the Schematic's payload alone — what `<Schematic>` returns through
 * the `Schematic` carrier — for the tests and the renderer's fixtures, which
 * read it whole.
 *
 * @param props - The Schematic's props ({@link SchematicProps})
 * @returns An East expression of {@link SchematicPayloadType}
 * @throws {Error} Naming the prop and the remedy (SC3): each prop §2 removes — rows and their mappers, the callbacks
 *   for an edit, `linkMode`, `readOnlyLinks` and `readOnlyItems`, the hover cards, `affordances` outside `slice`, the
 *   slice's effect props, `sliceSelectField`, `selectionMode`, `navigator`, `height` and `maxHeight`, `onSelectZone`,
 *   `onSelectionChange`, `onZoneSelectionChange`, `onSelectLink`, `onViewportChange`, `onItemOpen`, `selectZoomFocus`
 *   and `name` — and a prop the Schematic doesn't take; an `extent` that is no pair of positive numbers; no item kind;
 *   a sort given rows rather than kinds by slot, a slot holding a kind of another sort, and one slot holding two kinds;
 *   a link's end or a net's side holding keys of a slot that holds no item kind; a `slice` that is not `{ slice }`, or
 *   not `Slice.bindRecords`, or holding a source nothing names, or the brush; a templates list naming no source of the
 *   slice; a `narrowed` of another form; `layers` other than `Schematic.layers`' declaration, a list written in the code
 *   among them; an `inspector` that is no Boolean; an `id` that is no string; each of the library's refusals
 *   (`library.ts`); and each kind's refusals of its binding (SC33)
 * @internal
 */
export function createSchematicPayload(props: object): ExprType<SchematicPayloadType> {
    const given = props as SchematicAnyProps;
    for (const [prop, remedy] of Object.entries(REMOVED)) {
        if (prop in given) throw new Error(prop === "item" || prop === "zone" || prop === "link" || prop === "net" ? remedy : `Schematic: \`${prop}\` is gone — ${remedy}`);
    }
    for (const prop of Object.keys(given)) {
        if (!PROPS.has(prop) && !(prop === "children" && given[prop] === undefined)) {
            throw new Error(`Schematic: \`${prop}\` is not a prop of <Schematic> — it takes ${[...PROPS].join(", ")}`);
        }
    }
    const extent = extentOf(given.extent);

    // The kinds, by slot (§1, rule 5): each slot names its kind, and the source of the slice that narrows it.
    const items = kindsOf("items", given.items);
    if (items.length === 0) throw new Error(`Schematic: needs its items — items={{ <slot>: ${DECLARE.items} }}, one item kind at least, over the app's record`);
    const zones = kindsOf("zones", given.zones);
    const links = kindsOf("links", given.links);
    const nets = kindsOf("nets", given.nets);
    const kinds = [...items, ...zones, ...links, ...nets];
    const slotted = new Map<string, Slotted>();
    for (const one of kinds) {
        const held = slotted.get(one.slot);
        if (held !== undefined) {
            throw new Error(`Schematic: the slot "${one.slot}" holds two kinds — ${held.sort === "items" ? "an" : "a"} ${NOUN[held.sort]} kind and ` +
                `${one.sort === "items" ? "an" : "a"} ${NOUN[one.sort]} kind: each slot names one kind, and the source of the slice that narrows it`);
        }
        slotted.set(one.slot, one);
    }
    // A link's ends and a net's sides hold keys of item slots.
    const itemSlots = items.map((one) => one.slot);
    const holdsItems = (one: Slotted, prop: string, slot: string) => {
        if (!itemSlots.includes(slot)) {
            throw new Error(`Schematic: the ${NOUN[one.sort]} kind "${one.slot}"'s \`${prop}\` holds keys of "${slot}", which holds no item kind — ` +
                `its item slots are ${itemSlots.map((s) => `"${s}"`).join(", ")}`);
        }
    };
    for (const one of links) {
        const ends = (one.kind as SchematicLinks).ends;
        for (const slot of ends.from) holdsItems(one, "from", slot);
        for (const slot of ends.to) holdsItems(one, "to", slot);
    }
    for (const one of nets) {
        const sides = (one.kind as SchematicNets).sides;
        holdsItems(one, "sources", sides.sources);
        holdsItems(one, "destinations", sides.destinations);
    }

    // The narrowing (§10.1): one Slice.bindRecords, each source named after what it narrows.
    const slice = given.slice;
    if (slice !== undefined && (slice instanceof Expr || typeof slice !== "object" || slice === null || !("slice" in slice))) {
        throw new Error("Schematic: `slice` takes { slice } — slice={{ slice: Slice.bindRecords(key, { … }), affordances?, persist? }}, " +
            "each source named after the kind it narrows; a bare Slice.bind handle beside rows is gone");
    }
    const narrowing = slice as RecordSlicesChromeOptions | undefined;
    if (narrowing?.affordances?.includes("brush") === true) {
        throw new Error("Schematic: `slice`'s affordances list \"brush\", and a 2D canvas has no continuous axis to brush along — mount fields, search, presets or summary");
    }
    // Templates are records (#1340, ruling 9): each list names its source of the slice, refused with the change to make
    // before a source no list names is.
    const sliceNames = sliceSourceNames(narrowing);
    const templateSources: string[] = [];
    if (narrowing === undefined || isRecordSlices(narrowing.slice)) {
        for (const one of kinds) {
            if (one.kind.hasTemplates) templateSources.push(templatesSource("Schematic", "Schematic.templates(rows, { …, source })", one.kind.templatesSource, sliceNames));
        }
    }
    const tabSources = schematicTabSources(given.library);
    const names = [...new Set([...kinds.map((one) => one.slot), ...templateSources, ...tabSources])];
    const sources = recordSources(narrowing, {
        builder: "Schematic", names, what: "its kinds, each by its slot, and the templates lists and tabs that name a source",
    });
    const library = buildSchematicLibrary(given.library, {
        kinds: kinds.map((one): SchematicLibraryKind => ({
            slot: one.slot, sort: one.sort, rowType: one.kind.rowType,
            templates: one.kind.hasTemplates,
            backlog: one.sort === "items" && (one.kind as SchematicItems).backlog,
        })),
        layers: given.layers !== undefined,
        sources: sources.names,
    });
    const inspector = inspectorOf(given.inspector);
    const narrowed = narrowedOf(given.narrowed);
    const layers = layersOf(given.layers);
    const id = given.id;
    if (id !== undefined && typeof id !== "string") throw new Error("Schematic: `id` keeps the Schematic's state apart — a string, needed only when one surface holds two");
    const optional = (value: unknown) => value === undefined ? none : some(value);

    return Expr.block(($) => {
        // Each source bound once (#1356): a kind reads its own source inside its functions.
        const bound = sources.bind($);
        const shown = East.value(new Map(Object.entries(bound.keys)) as never, ShownType) as ExprType<typeof ShownType>;
        const built = (sort: Slotted["sort"]) => kinds.filter((one) => one.sort === sort)
            .map((one) => one.kind.build(one.slot, bound.parts[one.slot]));
        return East.value({
            extent,
            scaleUnit: optional(given.scaleUnit),
            items: built("items"),
            zones: built("zones"),
            links: built("links"),
            nets: built("nets"),
            layers,
            slice: sources.chrome,
            shown,
            narrowed,
            library,
            inspector,
            readOnly: given.readOnly ?? false,
            id: id === undefined ? none : some(id),
            grid: optional(given.grid),
            minimap: optional(given.minimap),
            canConnect: optional(given.canConnect),
            onSelect: optional(given.onSelect),
        } as never, SchematicPayloadType);
    });
}
