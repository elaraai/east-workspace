/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's payload (#1386, `Schematic Builder Spec.md` §2, §5): what
 * `<Schematic>` hands the renderer through its `Schematic` carrier — the
 * drawing's extent and scale, its kinds by slot, its layers, its narrowing and
 * how a narrowed-out row draws, its library's tabs, its inspector, whether it
 * is read only, its name, the canvas's options and what the host hears — and
 * every refusal of its props, made when the surface is built.
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
import { toneValue, type SchematicToneLiteral } from "./shapes.js";
import {
    SchematicItemKindType, SchematicLayerType, SchematicLinkKindType, SchematicNarrowedType, SchematicNetKindType, SchematicRefType,
    SchematicSelectionEventType, SchematicViewportEventType, SchematicZoneKindType, SchematicZoneSelectionEventType,
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
 * @property layers - The layers and their author defaults (§8)
 * @property slice - The rail's chrome over the one `Slice.bindRecords`; `none`, no rail
 * @property shown - Each source's shown keys, paged through its own data, by the source's name: what a templates list's and a tab's cards follow, and what dims a narrowed-out row
 * @property narrowed - How a narrowed-out row draws (§10.3)
 * @property library - The library pane's tabs, in the order `library` lists them; none, no library pane
 * @property inspector - Whether the inspector pane shows (§9): on by default
 * @property readOnly - No gesture, drop or inspector edit; selection stays
 * @property name - Names the Schematic, when a surface holds two
 * @property grid - The metric grid; on by default
 * @property minimap - The minimap; shown at 25 items or more by default
 * @property selectZoomFocus - Whether a selection flies the camera to it
 * @property canConnect - Vetoes a pair of items before a link's draft snaps
 * @property onSelectionChange - Hears each change of the selected items
 * @property onZoneSelectionChange - Hears each change of the selected zones
 * @property onSelectLink - Hears a link or a net selected
 * @property onViewportChange - Hears where the camera settled
 * @property onItemOpen - Hears an item opened (double-click or double-tap)
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
    name: OptionType(StringType),
    grid: OptionType(BooleanType),
    minimap: OptionType(BooleanType),
    selectZoomFocus: OptionType(BooleanType),
    canConnect: OptionType(FunctionType([SchematicRefType, SchematicRefType], BooleanType)),
    onSelectionChange: OptionType(FunctionType([SchematicSelectionEventType], NullType)),
    onZoneSelectionChange: OptionType(FunctionType([SchematicZoneSelectionEventType], NullType)),
    onSelectLink: OptionType(FunctionType([SchematicRefType], NullType)),
    onViewportChange: OptionType(FunctionType([SchematicViewportEventType], NullType)),
    onItemOpen: OptionType(FunctionType([SchematicRefType], NullType)),
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
 * The names a Schematic keeps its viewer's state under, by its `name` (§5):
 * its frame's panes, its library's id, the layers the viewer shows, hides and
 * locks, the tool it holds, and its drop surface, where its library's cards
 * land.
 *
 * @remarks
 * As the Flowchart's `flowchartKeys`: two Schematics on one surface keep apart
 * only when each is named.
 *
 * @param name - The Schematic's name, when a surface holds more than one; omitted, the one Schematic
 * @returns The keys
 */
export function schematicKeys(name: string | undefined): {
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
    const suffix = name === undefined ? "" : `.${name}`;
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
 * A layer, declared (§8): only `key` and `label` are required, the rest
 * author defaults the viewer's choices in the Layers tab override.
 *
 * @property key - The layer's identity: an entity's `layer` field names it
 * @property label - Its name
 * @property visible - Author default visibility (default `true`); `false` ships it hidden
 * @property locked - Author default lock (default `false`): a locked layer's entities never select
 * @property opacity - Its items' dim (0–1, default `1`)
 * @property tone - Its swatch's tone
 */
export interface SchematicLayerInput {
    /** The layer's identity: an entity's `layer` field names it. */
    key: string;
    /** Its name. */
    label: string;
    /** Author default visibility (default `true`); `false` ships it hidden. */
    visible?: boolean;
    /** Author default lock (default `false`): a locked layer's entities never select. */
    locked?: boolean;
    /** Its items' dim (0–1, default `1`). */
    opacity?: number;
    /** Its swatch's tone. */
    tone?: SchematicToneLiteral;
}

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
    /** The layers and their author defaults (§8): an entity's `layer` field names one. */
    layers?: readonly SchematicLayerInput[];
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
     * The inspector pane (§9): on by default; `false` removes it; `{ [slot]: Details }` gives a kind its own Details in
     * place of its form — an East function over the row and its writer, as a kind's own `inspector` is.
     */
    inspector?: boolean | Readonly<Record<string, unknown>>;
    /** No gesture, drop or inspector edit; selection stays. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Names the Schematic — needed only when one surface holds two. */
    name?: string;
    /** The metric grid; on by default. */
    grid?: SubtypeExprOrValue<BooleanType> | boolean;
    /** The minimap; shown at 25 items or more by default. */
    minimap?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Whether a selection flies the camera to it. */
    selectZoomFocus?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Vetoes a pair of items before a link's draft snaps; a throwing veto allows the pair and logs it. */
    canConnect?: SubtypeExprOrValue<FunctionType<[SchematicRefType, SchematicRefType], BooleanType>>;
    /** Hears each change of the selected items, each named by its kind and key. */
    onSelectionChange?: SubtypeExprOrValue<FunctionType<[SchematicSelectionEventType], NullType>>;
    /** Hears each change of the selected zones, with the items inside them. */
    onZoneSelectionChange?: SubtypeExprOrValue<FunctionType<[SchematicZoneSelectionEventType], NullType>>;
    /** Hears a link or a net selected. */
    onSelectLink?: SubtypeExprOrValue<FunctionType<[SchematicRefType], NullType>>;
    /** Hears where the camera settled after a pan, a zoom, a fly or a resize. */
    onViewportChange?: SubtypeExprOrValue<FunctionType<[SchematicViewportEventType], NullType>>;
    /** Hears an item opened: a double-click or a double-tap. */
    onItemOpen?: SubtypeExprOrValue<FunctionType<[SchematicRefType], NullType>>;
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
const HOVER = "the inspector, on by default, shows what is selected — give a kind its own Details with its `inspector`, " +
    "or inspector={{ <slot>: East.function([RowType, FunctionType([RowType], NullType)], UIComponentType, ($, row, update) => …) }}";

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
    onSelect: "onSelectionChange hears each change of the selection, each item named by its kind and key (Schematic.Types.Ref)",
    onSelectZone: "onZoneSelectionChange hears each change of the selected zones, each named by its kind and key (Schematic.Types.Ref)",
};

/** Every prop `<Schematic>` takes. */
const PROPS: ReadonlySet<string> = new Set([
    "extent", "scaleUnit", "items", "zones", "links", "nets", "layers", "slice", "narrowed", "library", "inspector", "readOnly", "name",
    "grid", "minimap", "selectZoomFocus", "canConnect", "onSelectionChange", "onZoneSelectionChange", "onSelectLink", "onViewportChange", "onItemOpen",
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

/** The layers on the wire, each checked: a key and a label, no key twice. */
function layersOf(layers: unknown): ExprType<ArrayType<SchematicLayerType>> {
    if (layers === undefined) return East.value([], ArrayType(SchematicLayerType));
    const valid = (l: unknown): l is SchematicLayerInput => typeof l === "object" && l !== null
        && typeof (l as SchematicLayerInput).key === "string" && typeof (l as SchematicLayerInput).label === "string";
    if (!Array.isArray(layers) || !layers.every(valid)) {
        throw new Error("Schematic: `layers` lists the layers, each { key, label, tone?, visible?, locked?, opacity? } — an entity's `layer` field names one by its key");
    }
    const seen = new Set<string>();
    for (const layer of layers) {
        if (seen.has(layer.key)) throw new Error(`Schematic: \`layers\` lists the layer "${layer.key}" twice — each layer's key is its own`);
        seen.add(layer.key);
    }
    return East.value(layers.map((l) => ({
        key: l.key,
        label: l.label,
        visible: l.visible !== undefined ? some(l.visible) : none,
        locked: l.locked !== undefined ? some(l.locked) : none,
        opacity: l.opacity !== undefined ? some(l.opacity) : none,
        tone: toneValue(l.tone),
    })), ArrayType(SchematicLayerType));
}

/**
 * The inspector pane (§9): on by default, or given `true`; off for `false`;
 * and each slot's own Details where `{ [slot]: Details }` gives them, checked
 * against the kinds.
 *
 * @param inspector - The Schematic's `inspector`
 * @param kinds - Its kinds
 * @returns Whether the pane shows, and each slot's own Details the prop gives
 * @throws {Error} Naming the prop and the remedy: an `inspector` of another kind, a key that is no kind's slot, and a
 *   slot whose kind gives its own Details too
 */
function inspectorOf(inspector: unknown, kinds: readonly Slotted[]): { pane: boolean; bySlot: Readonly<Record<string, unknown>> } {
    if (inspector === undefined || inspector === true) return { pane: true, bySlot: {} };
    if (inspector === false) return { pane: false, bySlot: {} };
    if (inspector === null || typeof inspector !== "object" || inspector instanceof Expr || Array.isArray(inspector)) {
        throw new Error("Schematic: `inspector` is on by default — inspector={false} removes the pane, and inspector={{ <slot>: Details }} gives a kind its own Details, " +
            "each an East function over the row and its writer");
    }
    const bySlot = inspector as Readonly<Record<string, unknown>>;
    for (const slot of Object.keys(bySlot)) {
        const kind = kinds.find((k) => k.slot === slot);
        if (kind === undefined) {
            throw new Error(`Schematic: \`inspector\` gives "${slot}" its own Details, and no kind is in that slot — its kinds' slots are ${kinds.map((k) => `"${k.slot}"`).join(", ")}`);
        }
        if (kind.kind.ownInspector) {
            throw new Error(`Schematic: \`inspector.${slot}\` gives the ${NOUN[kind.sort]} kind "${slot}" its own Details, and so does the kind's own \`inspector\` — give them in one place`);
        }
    }
    return { pane: true, bySlot };
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
 *   slice's effect props, `sliceSelectField`, `selectionMode`, `navigator`, `height` and `maxHeight`, `onSelect` and
 *   `onSelectZone` — and a prop the Schematic doesn't take; an `extent` that is no pair of positive numbers; no item
 *   kind; a sort given rows rather than kinds by slot, a slot holding a kind of another sort, and one slot holding two
 *   kinds; a link's end or a net's side holding keys of a slot that holds no item kind; a `slice` that is not
 *   `{ slice }`, or not `Slice.bindRecords`, or holding a source nothing names, or the brush; a templates list naming
 *   no source of the slice; a `narrowed` of another form; layers without a key and a label, or listing a key twice; an
 *   `inspector` of another kind, a key that is no kind's slot, or a slot whose kind gives its own Details too; each of
 *   the library's refusals (`library.ts`); and each kind's refusals of its binding (SC33)
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
        layers: Array.isArray(given.layers) ? given.layers.length : 0,
        sources: sources.names,
    });
    const inspector = inspectorOf(given.inspector, kinds);
    const narrowed = narrowedOf(given.narrowed);
    const layers = layersOf(given.layers);
    const name = given.name;
    if (name !== undefined && typeof name !== "string") throw new Error("Schematic: `name` names the Schematic — a string, needed only when one surface holds two");
    const optional = (value: unknown) => value === undefined ? none : some(value);

    return Expr.block(($) => {
        // Each source bound once (#1356): a kind reads its own source inside its functions.
        const bound = sources.bind($);
        const shown = East.value(new Map(Object.entries(bound.keys)) as never, ShownType) as ExprType<typeof ShownType>;
        const built = (sort: Slotted["sort"]) => kinds.filter((one) => one.sort === sort)
            .map((one) => one.kind.build(one.slot, bound.parts[one.slot], inspector.bySlot[one.slot]));
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
            inspector: inspector.pane,
            readOnly: given.readOnly ?? false,
            name: name === undefined ? none : some(name),
            grid: optional(given.grid),
            minimap: optional(given.minimap),
            selectZoomFocus: optional(given.selectZoomFocus),
            canConnect: optional(given.canConnect),
            onSelectionChange: optional(given.onSelectionChange),
            onZoneSelectionChange: optional(given.onZoneSelectionChange),
            onSelectLink: optional(given.onSelectLink),
            onViewportChange: optional(given.onViewportChange),
            onItemOpen: optional(given.onItemOpen),
        } as never, SchematicPayloadType);
    });
}
