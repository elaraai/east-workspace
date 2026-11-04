/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's details (#1507, `Flowchart Records Spec.md` §3, R18–R21):
 * `Flowchart.details` and its four reads — `Flowchart.figure`, `.histogram`,
 * `.list` and `.tags` — over the app's rows keyed as a kind's are, read only.
 *
 * - **A read is a frozen description behind a phantom brand**, as the Plan's
 *   named reads are (`plan/reads.ts`): the row it reads, its kind, where it
 *   shows and, for tags, whether the legend lists them. The row is inferred
 *   where the read is placed — in a `Flowchart.details` array — so a field
 *   name is checked against the row it reads, and a misfit is a type error
 *   naming the fields that fit (R20). A read's return type keeps its show and
 *   its legend from inference (`NoInfer`), so each is the one given — `"all"`
 *   and `false` unless given — wherever the read is placed, and `details`'
 *   keeps its row and its reads from the place it is put, so a kind's `details`
 *   never infers them in its stead.
 * - **One array, in order** (R21): each kind's `details` is one array of
 *   reads, any mix of the four, drawn in its order and shown in full, in the
 *   same order, in the inspector, each where its `show` says. A transition's
 *   label draws lines, so its tags and histograms take `show: "inspector"`: a
 *   type error otherwise, with its words.
 * - **Read as the kind is** (R19): beside a kind read whole the details bind
 *   `Data.bind(record)`, read whole; beside one read through its source,
 *   `Data.bindPaged(record)`, read by the drawn rows' keys, every key in one
 *   request. They are read only (R18): `Record.bind` is refused.
 * - **The row type never reaches the payload**: `values` turns a row's bytes
 *   into one value a read, one type whatever the row holds.
 *
 * What only the built value shows is refused as the Flowchart is built, in
 * the tag's words (§3, "What the editor and the tag say").
 *
 * @packageDocumentation
 */

import {
    ArrayType, BlobType, DictType, East, Expr, FloatType, IntegerType, OptionType, StringType, StructType, isTypeEqual, none, some, variant,
    type EastType, type ExprType, type SetType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { ColorSchemeType, StyleVariantType, resolveRowSource, resolveTag, type ColorSchemeLiteral, type StyleVariantLiteral } from "@elaraai/east-ui/internal";
import { fieldOf } from "../schedule/fields.js";
import { checkEntries, optionOf, typeText } from "../schedule/window.js";
import type { FlowchartBinding } from "./kinds.js";
import { FlowchartDetailRowType, FlowchartDetailsType, FlowchartTagColorType } from "./types.js";

// ============================================================================
// The fields a read takes (R20)
// ============================================================================

/** Fields of R a figure reads: a number, or an Option of one. */
export type FlowchartFigureField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends IntegerType | FloatType | OptionType<IntegerType | FloatType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R a histogram reads: a Dict from a duration to its count, both numbers — or, beside the app's bins, an Array of counts, one a bin. */
export type FlowchartHistogramField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends DictType<IntegerType | FloatType, IntegerType | FloatType> | ArrayType<IntegerType | FloatType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R a list reads: a Dict from an item's name to a number, or to a struct its draw reads. */
export type FlowchartListField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends DictType<StringType, IntegerType | FloatType | StructType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R a tags read reads: an Array or a Set of strings. */
export type FlowchartTagsField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends ArrayType<StringType> | SetType<StringType> ? K : never;
}[keyof R["fields"] & string];

/** An item of the list at F: what its draw is handed. */
export type FlowchartListItem<R extends StructType, F extends FlowchartListField<R>> =
    R["fields"][F] extends DictType<StringType, infer V> ? V : never;

// ============================================================================
// The reads' options
// ============================================================================

/** The unit a histogram's durations are in; the axis prints them as 15m, 4h, 2d, 1w. */
export type FlowchartDurationUnit = "minutes" | "hours" | "days";

/**
 * How the bars space the bins along the axis, in the Chart's words for its x
 * scales (`ChartScaleLiteral`): `"band"`, a bar a bin whatever its span;
 * `"linear"`, each bar as wide as its span.
 */
export type FlowchartBarScale = "band" | "linear";

/** An edge the axis names: a number, printed as a duration in the unit, or the app's own words. */
export type FlowchartTick = number | { at: number; label: string };

/** What a histogram takes beside its field. */
export interface FlowchartHistogramOptions {
    /** The unit its durations are in. */
    unit: FlowchartDurationUnit;
    /** Its title; the field's name unless given. */
    label?: string;
    /** What is counted: `"parcels"`. */
    counts?: string;
    /** The app's edges, ascending, any spacing: a literal, or bound. Left out, every row's edges merged. */
    bins?: SubtypeExprOrValue<ArrayType<FloatType>>;
    /** `"band"` unless given. */
    scale?: FlowchartBarScale;
    /** The edges the axis names, besides the first; left out, round durations. */
    ticks?: ReadonlyArray<FlowchartTick>;
}

/** A tag's look, as a Tag takes it: east-ui's `ColorSchemeType` and `StyleVariantType`. */
export interface FlowchartTagColor {
    /** Its palette. */
    colorPalette: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Its variant: subtle unless given. */
    variant?: SubtypeExprOrValue<StyleVariantType> | StyleVariantLiteral;
}

/**
 * Where a read shows — `"all"`, the default: on the canvas, a state's card or
 * a transition's label, and in the inspector; `"canvas"`: there alone;
 * `"inspector"`: in the inspector alone. A variant on the wire, as the
 * Schematic carries its narrowed `show`.
 */
export type FlowchartShow = "all" | "canvas" | "inspector";

/** A read's kind. */
export type FlowchartReadKind = "figure" | "histogram" | "list" | "tags";

/** The phantom brand a read carries: what it reads, its kind, where it shows and whether the legend lists it. */
export const FlowchartReadBrand: unique symbol = Symbol("FlowchartRead");
/** The type of {@link FlowchartReadBrand}. */
export type FlowchartReadBrand = typeof FlowchartReadBrand;

/**
 * A read: a frozen description behind a phantom brand — the row R it reads,
 * its kind K, where it shows (W) and, for tags, whether the legend lists them
 * (L).
 *
 * @typeParam R - The details' row type, inferred where the read is placed
 * @typeParam K - Its kind
 * @typeParam W - Where it shows
 * @typeParam L - Whether the legend lists it: tags only
 */
export type FlowchartRead<R extends StructType, K extends FlowchartReadKind, W extends FlowchartShow = FlowchartShow, L extends boolean = false> =
    { readonly [FlowchartReadBrand]: { row: R; kind: K; show: W; legend: L } };

// ============================================================================
// Behind the reads — the descriptions the details build from
// ============================================================================

/** A list's draw, its types erased. */
type AnyDraw = (item: ExprType<EastType>, name: ExprType<StringType>, row: ExprType<EastType>) => unknown;

/** A read as `Flowchart.details` builds from it: its kind, its field, where it shows, and its options, checked. */
type ReadSpec =
    | { readonly kind: "figure"; readonly field: string; readonly show: FlowchartShow; readonly label: string | undefined; readonly unit: string | undefined }
    | {
        readonly kind: "histogram"; readonly field: string; readonly show: FlowchartShow; readonly label: string | undefined;
        readonly unit: FlowchartDurationUnit; readonly counts: string | undefined; readonly bins: ExprType<ArrayType<FloatType>> | undefined;
        readonly scale: FlowchartBarScale; readonly ticks: ReadonlyArray<FlowchartTick> | undefined;
    }
    | {
        readonly kind: "list"; readonly field: string; readonly show: FlowchartShow; readonly label: string | undefined;
        readonly unit: string | undefined; readonly top: 1 | 2 | 3 | undefined; readonly draw: AnyDraw | undefined;
    }
    | {
        readonly kind: "tags"; readonly field: string; readonly show: FlowchartShow; readonly label: string | undefined;
        readonly colors: ExprType<ArrayType<typeof FlowchartTagColorType>>; readonly legend: boolean;
    };

const READS = new WeakMap<object, ReadSpec>();

/** A read made: a frozen description, its spec kept beside it. */
function described<T>(spec: ReadSpec): T {
    const read = Object.freeze({ kind: spec.kind, field: spec.field });
    READS.set(read, spec);
    return read as unknown as T;
}

/** A read's options, as given: an object, or none. */
function optionsOf(where: string, options: unknown, required = false): Record<string, unknown> {
    if (options === undefined && !required) return {};
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
        throw new Error(`${where}: its options are an object — { label, unit, show, … }`);
    }
    return options as Record<string, unknown>;
}

/** A read's field, named. */
function fieldName(where: string, field: unknown): string {
    if (typeof field !== "string" || field === "") throw new Error(`${where}: name the field it reads — a field of the details' row`);
    return field;
}

/** A read's words: a label, a unit, what is counted. */
function wordOf(where: string, prop: string, given: unknown): string | undefined {
    if (given === undefined) return undefined;
    if (typeof given !== "string") throw new Error(`${where}: \`${prop}\` is a string`);
    return given;
}

/** Where a read shows: "all" unless given. */
function showOf(where: string, show: unknown): FlowchartShow {
    if (show === undefined) return "all";
    if (show === "all" || show === "canvas" || show === "inspector") return show;
    throw new Error(`${where}: \`show\` is "all", "canvas" or "inspector" — where the read shows`);
}

/**
 * A histogram's bins, checked: a literal's edges ascend, refused when built;
 * bins the app binds are checked as they land, by the renderer (R27, R38).
 */
function binsOf(where: string, bins: unknown): ExprType<ArrayType<FloatType>> | undefined {
    if (bins === undefined) return undefined;
    if (bins instanceof Expr) {
        const type = Expr.type(bins) as EastType;
        if (!isTypeEqual(type, ArrayType(FloatType))) throw new Error(`${where}: \`bins\` are the app's edges, an Array of Floats — and these are ${typeText(type)}`);
        return bins as ExprType<ArrayType<FloatType>>;
    }
    if (!Array.isArray(bins)) throw new Error(`${where}: \`bins\` are the app's edges, ascending — [0, …], or an Array the app binds`);
    if (bins.every((edge) => typeof edge === "number")) {
        const edges = bins as number[];
        if (edges.length === 0) throw new Error(`${where}: \`bins\` are the app's edges, ascending — give the first, [0, …]`);
        for (const edge of edges) if (!Number.isFinite(edge)) throw new Error(`${where}: the bins' edges are numbers — and one is ${edge}`);
        for (let i = 1; i < edges.length; i++) {
            if (!(edges[i]! > edges[i - 1]!)) throw new Error(`${where}: the bins' edges ascend — ${edges[i - 1]}, then ${edges[i]}`);
        }
    }
    return East.value(bins as SubtypeExprOrValue<ArrayType<FloatType>>, ArrayType(FloatType)) as ExprType<ArrayType<FloatType>>;
}

/** The axis's ticks, checked: each a number, or `{ at, label }`. */
function ticksOf(where: string, ticks: unknown): ReadonlyArray<FlowchartTick> | undefined {
    if (ticks === undefined) return undefined;
    const tick = (t: unknown): t is FlowchartTick => (typeof t === "number" && Number.isFinite(t))
        || (typeof t === "object" && t !== null && typeof (t as { at?: unknown }).at === "number" && Number.isFinite((t as { at: number }).at)
            && typeof (t as { label?: unknown }).label === "string");
    if (!Array.isArray(ticks) || !ticks.every(tick)) throw new Error(`${where}: \`ticks\` lists the edges the axis names — each a number, or { at, label }`);
    return Object.freeze(ticks.map((t: FlowchartTick) => typeof t === "number" ? t : Object.freeze({ at: t.at, label: t.label })));
}

/** The cases of a variant of nulls, as a refusal names them. */
function casesOf(type: EastType): string[] {
    return type.type === "Variant" ? Object.keys(type.cases as Record<string, EastType>) : [];
}

/**
 * The tags' looks, checked: a literal — each tag's `{ colorPalette, variant }`,
 * first defined, first shown — or an Array of `Flowchart.Types.TagColor` the
 * app binds.
 */
function colorsOf(where: string, colors: unknown): ExprType<ArrayType<typeof FlowchartTagColorType>> {
    const Colors = ArrayType(FlowchartTagColorType);
    if (colors === undefined) return East.value([], Colors) as ExprType<typeof Colors>;
    if (colors instanceof Expr) {
        const type = Expr.type(colors) as EastType;
        if (!isTypeEqual(type, Colors)) {
            throw new Error(`${where}: \`colors\` gives each tag its look — { "Hazmat": { colorPalette, variant } }, or an Array of Flowchart.Types.TagColor ` +
                `the app binds — and this is ${typeText(type)}`);
        }
        return colors as ExprType<typeof Colors>;
    }
    if (Array.isArray(colors)) return East.value(colors as SubtypeExprOrValue<typeof Colors>, Colors) as ExprType<typeof Colors>;
    if (typeof colors !== "object" || colors === null) {
        throw new Error(`${where}: \`colors\` gives each tag its look — { "Hazmat": { colorPalette, variant } }, or an Array of Flowchart.Types.TagColor the app binds`);
    }
    const palettes = casesOf(ColorSchemeType);
    const variants = casesOf(StyleVariantType);
    const looks = Object.entries(colors as Record<string, unknown>).map(([tag, look]) => {
        const given = look as { colorPalette?: unknown; variant?: unknown } | null;
        if (typeof given !== "object" || given === null || given.colorPalette === undefined) {
            throw new Error(`${where}: "${tag}"'s look is { colorPalette, variant? }, as a Tag takes it`);
        }
        if (typeof given.colorPalette === "string" && !palettes.includes(given.colorPalette)) {
            throw new Error(`${where}: "${tag}"'s colorPalette is one of east-ui's colour schemes — "danger", "red", "brand", … — and this is "${given.colorPalette}"`);
        }
        if (typeof given.variant === "string" && !variants.includes(given.variant)) {
            throw new Error(`${where}: "${tag}"'s variant is one of a Tag's variants — "subtle", "solid", "outline", … — and this is "${given.variant}"`);
        }
        return {
            tag,
            colorPalette: resolveTag(given.colorPalette as SubtypeExprOrValue<ColorSchemeType> | string, ColorSchemeType),
            variant: resolveTag((given.variant ?? "subtle") as SubtypeExprOrValue<StyleVariantType> | string, StyleVariantType),
        };
    });
    return East.value(looks as never, Colors) as ExprType<typeof Colors>;
}

// ============================================================================
// The four reads (§3)
// ============================================================================

/**
 * A figure (R25): a number, or an Option of one — a line on the card or the
 * label, its label and its value with its unit; the inspector's stats.
 *
 * @typeParam R - The details' row type, inferred where the read is placed
 * @typeParam F - The field
 * @typeParam W - Where it shows: `"all"` unless given
 * @param field - The field it reads
 * @param options - Its label — the field's name unless given — its unit, and where it shows
 * @returns The read, for `Flowchart.details`
 * @throws {Error} When the field is named by no string, or an option is of another kind
 */
export function flowchartFigure<R extends StructType, F extends FlowchartFigureField<R>, const W extends FlowchartShow = "all">(
    field: F,
    options?: { label?: string; unit?: string; show?: W },
): FlowchartRead<R, "figure", NoInfer<W>> {
    const where = "Flowchart.figure";
    const given = optionsOf(where, options);
    return described({
        kind: "figure", field: fieldName(where, field), show: showOf(where, given["show"]),
        label: wordOf(where, "label", given["label"]), unit: wordOf(where, "unit", given["unit"]),
    });
}

/**
 * A histogram (R26–R28): a Dict from a duration to its count, both numbers —
 * or, beside the app's `bins`, an Array of counts, one a bin. The card's bars
 * on their axis; the inspector's chart.
 *
 * @typeParam R - The details' row type, inferred where the read is placed
 * @typeParam F - The field
 * @typeParam W - Where it shows: `"all"` unless given
 * @param field - The field it reads
 * @param options - Its unit, its label, what it counts, the app's bins — required beside an Array of counts — how the bars
 *   space them, the edges the axis names, and where it shows
 * @returns The read, for `Flowchart.details`
 * @throws {Error} When the unit, the scale or a tick is none of its words, and when the bins' edges do not ascend —
 *   "The bins' edges ascend — 12, then 4"
 */
export function flowchartHistogram<R extends StructType, F extends FlowchartHistogramField<R>, const W extends FlowchartShow = "all">(
    field: F,
    // an Array of counts is a bin each: beside one, the bins are required
    options: FlowchartHistogramOptions & { show?: W } & (R["fields"][F] extends ArrayType<IntegerType | FloatType> ? { bins: SubtypeExprOrValue<ArrayType<FloatType>> } : unknown),
): FlowchartRead<R, "histogram", NoInfer<W>> {
    const where = "Flowchart.histogram";
    const name = fieldName(where, field);
    const given = optionsOf(where, options, true);
    const unit = given["unit"];
    if (unit !== "minutes" && unit !== "hours" && unit !== "days") {
        throw new Error(`${where}: \`unit\` is the unit "${name}"'s durations are in — "minutes", "hours" or "days"`);
    }
    const scale = given["scale"] ?? "band";
    if (scale !== "band" && scale !== "linear") throw new Error(`${where}: \`scale\` is "band", a bar a bin, or "linear", each bar as wide as its span`);
    return described({
        kind: "histogram", field: name, show: showOf(where, given["show"]), label: wordOf(where, "label", given["label"]),
        unit, counts: wordOf(where, "counts", given["counts"]), bins: binsOf(where, given["bins"]), scale, ticks: ticksOf(where, given["ticks"]),
    });
}

/**
 * A list (R29): a Dict from an item's name to a number, or to a struct whose
 * `draw` says which number is the value, and a note. Lines on a card, under
 * the list's title, or under a transition's evidence; the inspector's list.
 *
 * @typeParam R - The details' row type, inferred where the read is placed
 * @typeParam F - The field
 * @typeParam W - Where it shows: `"all"` unless given
 * @param field - The field it reads
 * @param options - Its label, its unit, the lines it draws on the canvas — 2 on a card and 1 on a label unless given, at
 *   most 3: the inspector lists every item — and where it shows
 * @param draw - An item's value and its note, from the item, its name and the row: required for a Dict of structs
 * @returns The read, for `Flowchart.details`
 * @throws {Error} When `top` is not 1, 2 or 3, or `draw` is no function
 */
export function flowchartList<R extends StructType, F extends FlowchartListField<R>, const W extends FlowchartShow = "all">(
    field: F,
    options?: { label?: string; unit?: string; top?: 1 | 2 | 3; show?: W },   // top: the card's or label's lines
    draw?: (item: ExprType<FlowchartListItem<R, F>>, name: ExprType<StringType>, row: ExprType<R>) => {
        value: SubtypeExprOrValue<IntegerType | FloatType>;
        note?: SubtypeExprOrValue<OptionType<StringType>>;
    },
): FlowchartRead<R, "list", NoInfer<W>> {
    const where = "Flowchart.list";
    const given = optionsOf(where, options);
    const top = given["top"];
    if (top !== undefined && top !== 1 && top !== 2 && top !== 3) throw new Error(`${where}: \`top\` is 1, 2 or 3 — the inspector lists every item`);
    if (draw !== undefined && typeof draw !== "function") throw new Error(`${where}: \`draw\` gives an item's value and note — (item, name, row) => ({ value, note })`);
    return described({
        kind: "list", field: fieldName(where, field), show: showOf(where, given["show"]), label: wordOf(where, "label", given["label"]),
        unit: wordOf(where, "unit", given["unit"]), top, draw: draw as unknown as AnyDraw | undefined,
    });
}

/**
 * A tags read (R30, R31): an Array or a Set of strings, the row's tags. On a
 * card, a list beside its label, wrapping to three lines; the inspector shows
 * every tag.
 *
 * @typeParam R - The details' row type, inferred where the read is placed
 * @typeParam F - The field
 * @typeParam W - Where it shows: `"all"` unless given
 * @typeParam L - Whether the canvas's legend lists the defined tags
 * @param field - The field it reads
 * @param options - Its label; each tag's look as a Tag takes it — `{ colorPalette, variant }`, first defined, first shown,
 *   a literal or an Array the app binds (`Flowchart.Types.TagColor`) — a tag with none neutral and subtle; whether the
 *   legend lists the defined tags, for tags on the canvas only; and where it shows
 * @returns The read, for `Flowchart.details`
 * @throws {Error} When a look's palette or variant is none of east-ui's, or `legend` is given beside `show: "inspector"` —
 *   "Only tags on the canvas go in the legend — show them on the canvas, or drop legend"
 */
export function flowchartTags<R extends StructType, F extends FlowchartTagsField<R>, const W extends FlowchartShow = "all", const L extends boolean = false>(
    field: F,
    options?: {
        label?: string;
        // first defined, first shown: a literal, or an Array the app binds (Flowchart.Types.TagColor)
        colors?: Record<string, FlowchartTagColor> | SubtypeExprOrValue<ArrayType<typeof FlowchartTagColorType>>;
        legend?: L;                                   // list the defined tags in the canvas's legend — tags on the canvas only
        show?: W;
    },
): FlowchartRead<R, "tags", NoInfer<W>, NoInfer<L>> {
    const where = "Flowchart.tags";
    const given = optionsOf(where, options);
    const show = showOf(where, given["show"]);
    const legend = given["legend"] ?? false;
    if (typeof legend !== "boolean") throw new Error(`${where}: \`legend\` is true to list the defined tags in the canvas's legend`);
    if (legend && show === "inspector") throw new Error(`${where}: only tags on the canvas go in the legend — show them on the canvas, or drop legend`);
    return described({
        kind: "tags", field: fieldName(where, field), show, label: wordOf(where, "label", given["label"]),
        colors: colorsOf(where, given["colors"]), legend,
    });
}

// ============================================================================
// Flowchart.details (R18, R19, R21)
// ============================================================================

/**
 * The refusal's words as a type, as `plan/nested.ts` carries them: unknown
 * unless a tags read in the legend shows in the inspector alone.
 */
export type FlowchartLegendOnCanvas<S> = S extends { details: ReadonlyArray<infer D> }
    ? [Extract<D, FlowchartRead<StructType, "tags", "inspector", true>>] extends [never] ? unknown
        : { "Only tags on the canvas go in the legend — show them on the canvas, or drop legend": never }
    : unknown;

/**
 * Whether a transition's label draws a details' reads, with its words as a
 * type: `true` unless a histogram or a tags read shows on the canvas — a
 * transition's label draws lines, figures and lists (R21).
 */
export type FlowchartLabelDraws<S> = S extends { details: ReadonlyArray<infer D> }
    ? [Extract<D, FlowchartRead<StructType, "histogram", "all" | "canvas", boolean>>] extends [never]
        ? [Extract<D, FlowchartRead<StructType, "tags", "all" | "canvas", boolean>>] extends [never] ? true
            : { "A transition's label draws lines: a figure or a list — give the tags show: \"inspector\"": never }
        : { "A transition's label draws lines: a figure or a list — give the histogram show: \"inspector\"": never }
    : true;

/** What a kind's details take: every read, in the order drawn. */
export interface FlowchartDetailsSpec<R extends StructType> {
    /**
     * Every read, any mix of the four, in the order drawn — on a state's card
     * or a transition's label, and in the inspector — each where its show says.
     */
    details: ReadonlyArray<FlowchartRead<R, FlowchartReadKind, FlowchartShow, boolean>>;
}

/**
 * A transition's: its label draws lines — figures and lists — so a tags or a
 * histogram read shows in the inspector alone, a type error otherwise, with
 * the words "A transition's label draws lines: a figure or a list — give the
 * histogram show: "inspector"".
 */
export interface FlowchartTransitionDetailsSpec {
    /** Its reads: figures and lists anywhere, tags and histograms in the inspector alone. */
    details: ReadonlyArray<FlowchartRead<StructType, "figure" | "list"> | FlowchartRead<StructType, "tags" | "histogram", "inspector">>;
}

/** The binding a kind's details take (R19): `Data.bind(record)`'s handle, read whole, or `Data.bindPaged(record)`'s, read by key. */
export type FlowchartDetailsBinding<R extends StructType> = FlowchartBinding<R>;

/** The key a kind's details carry their mark under. */
export const FLOWCHART_DETAILS: unique symbol = Symbol("Flowchart.details");

/** The phantom brand a kind's details carry: their row, their reads, and whether a transition's label draws them. */
export const FlowchartDetailsBrand: unique symbol = Symbol("FlowchartDetails");
/** The type of {@link FlowchartDetailsBrand}. */
export type FlowchartDetailsBrand = typeof FlowchartDetailsBrand;

/**
 * A kind's details, declared: what a state's or a transition's `details`
 * takes.
 *
 * @typeParam R - The details' row type
 * @typeParam S - Their reads, as given
 * @typeParam L - Whether a transition's label draws them: `true`, or the words saying why not
 */
export interface FlowchartDetails<R extends StructType, S, L = FlowchartLabelDraws<S>> {
    /** What it is. */
    readonly [FLOWCHART_DETAILS]: "details";
    /** The details' row type. */
    readonly rowType: StructType;
    /** Whether a read shows in the inspector alone: refused beside `inspector={false}`. */
    readonly inspectorReads: boolean;
    /**
     * Checks the details where their kind declares them: a transition's label
     * draws figures and lists, three lines at most under its evidence.
     *
     * @param noun - The kind's rows, `states` or `transitions`
     * @param where - The kind, as a refusal names it
     * @throws {Error} On a transition: a tags or a histogram read on the canvas, and lines past three
     */
    check(noun: "states" | "transitions", where: string): void;
    /**
     * The details on the wire, beside their kind.
     *
     * @param noun - The kind's rows, `states` or `transitions`: a list's lines, 2 on a card and 1 on a label unless given
     * @param where - The kind, as a refusal names it
     * @param throughSource - Whether the kind is read through its source of the slice
     * @returns The details, closed
     * @throws {Error} When they are bound in a form their kind's read does not take (R19), naming the one to use
     */
    build(noun: "states" | "transitions", where: string, throughSource: boolean): ExprType<typeof FlowchartDetailsType>;
    /** Their row, their reads, and whether a transition's label draws them (phantom). */
    readonly [FlowchartDetailsBrand]?: { readonly label: L; readonly row: R; readonly spec: S };
}

/**
 * Whether something is a kind's details: `Flowchart.details`'.
 *
 * @param value - What a kind's `details` holds
 * @returns Whether it is
 */
export function isFlowchartDetails(value: unknown): value is FlowchartDetails<StructType, unknown, unknown> {
    return typeof value === "object" && value !== null && FLOWCHART_DETAILS in value
        && (value as { [FLOWCHART_DETAILS]: unknown })[FLOWCHART_DETAILS] === "details";
}

/** The details' record, bound: read whole, or by key; its handle and its row type. */
interface DetailsBinding {
    readonly form: "data" | "paged";
    readonly handle: ExprType<EastType>;
    readonly rowType: StructType;
}

/**
 * Tells the details' binding by its handle's East struct (`bind/sources.ts`'
 * rule): a `page` field is `Data.bindPaged`'s, a `mutate` field
 * `Record.bind`'s, which is refused — the details are read only — and any
 * other `Data.bind`'s.
 */
function bindingOf(record: unknown, where: string): DetailsBinding {
    const forms = "details are read only: bind them with Data.bind(record), or Data.bindPaged(record) beside a kind read through its source";
    if (!(record instanceof Expr)) throw new Error(`${where}: ${forms}`);
    const type = Expr.type(record) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : undefined;
    if (fields === undefined) throw new Error(`${where}: ${forms} — and this is ${typeText(type)}`);
    let form: DetailsBinding["form"];
    let recordType: EastType;
    if (fields["page"] !== undefined) {
        form = "paged";
        if (fields["indexes"] !== undefined) {
            throw new Error(`${where}: the details are read by key through the record's own entries, Data.bindPaged(record) — and this one reads it through its indexes`);
        }
        const resolved = resolveRowSource(record, where);
        if (resolved.kind !== "paged") {
            throw new Error(`${where}: the details are read by key through the record's own entries, Data.bindPaged(record) — and this one pages an index's window`);
        }
        recordType = resolved.collectionType;
    } else {
        if (fields["mutate"] !== undefined) throw new Error(`${where}: ${forms}`);
        const read = fields["read"];
        if (read === undefined || read.type !== "Function" || read.inputs.length !== 0 || fields["binding"] === undefined) {
            throw new Error(`${where}: ${forms}`);
        }
        form = "data";
        recordType = read.output as EastType;
    }
    if (recordType.type !== "Dict" || !isTypeEqual(recordType.key as EastType, StringType) || (recordType.value as EastType).type !== "Struct") {
        throw new Error(`${where}: the details' record holds its rows by String key, keyed as the kind's are, each a struct — and this one holds ${typeText(recordType)}`);
    }
    const rowType = recordType.value as StructType;
    if (form === "paged") checkEntries(record, StringType, rowType, `${where}: Data.bindPaged(record)`);
    return { form, handle: record as ExprType<EastType>, rowType };
}

/** Whether a type is a number: an Integer or a Float. */
function isNumber(type: EastType | undefined): boolean {
    return type !== undefined && (type.type === "Integer" || type.type === "Float");
}

/** The fields of a row that fit a read, by what each read takes (R20). */
const FITS: Record<FlowchartReadKind, { readonly fits: (type: EastType) => boolean; readonly what: string }> = {
    figure: { fits: (t) => isNumber(t) || isNumber(optionOf(t)), what: "a figure reads a number, or an Option of one" },
    histogram: {
        fits: (t) => (t.type === "Dict" && isNumber(t.key as EastType) && isNumber(t.value as EastType)) || (t.type === "Array" && isNumber(t.value as EastType)),
        what: "a histogram reads a Dict from a duration to its count, both numbers, or an Array of counts beside its bins",
    },
    list: {
        fits: (t) => t.type === "Dict" && isTypeEqual(t.key as EastType, StringType) && (isNumber(t.value as EastType) || (t.value as EastType).type === "Struct"),
        what: "a list reads a Dict from an item's name to a number, or to a struct its draw reads",
    },
    tags: {
        fits: (t) => (t.type === "Array" || t.type === "Set") && isTypeEqual((t.type === "Array" ? t.value : t.key) as EastType, StringType),
        what: "tags read an Array or a Set of strings",
    },
};

/** A number as a Float: an Integer converted, a Float as it is. */
function asFloat(value: ExprType<EastType>, type: EastType): ExprType<FloatType> {
    return (type.type === "Integer" ? (value as ExprType<IntegerType>).toFloat() : value) as ExprType<FloatType>;
}

/** What a list's draw gives: an item's value, and its note. */
const DrawnType = StructType({ value: FloatType, note: OptionType(StringType) });

/** The value a details row holds for one read, built in the `values` function's block. */
type ReadValue = ($: { const: (value: unknown) => unknown }, row: ExprType<StructType>) => unknown;

/** A read, resolved against the details' row: its spec, and its value. */
interface ResolvedRead {
    readonly spec: ReadSpec;
    readonly value: ReadValue;
}

/** One bin of a histogram's value. */
const BinType = StructType({ from: FloatType, count: FloatType });
/** One item of a list's value. */
const ItemType = StructType({ name: StringType, value: FloatType, note: OptionType(StringType) });

/** A list's draw, reified once over the item, its name and the row (`shared/reify.ts`' rule), its value a Float. */
function drawOf(where: string, field: string, itemType: EastType, rowType: StructType, draw: AnyDraw) {
    const words = `${where}: "${field}"'s draw gives { value, note? } — value a number, note an Option of a String`;
    return East.function([itemType, StringType, rowType], DrawnType, (_$, item, name, row) => {
        const given = draw(item as ExprType<EastType>, name, row as ExprType<EastType>) as { value?: unknown; note?: unknown } | null;
        if (typeof given !== "object" || given === null || given.value === undefined) throw new Error(words);
        let value: ExprType<FloatType>;
        if (typeof given.value === "number") value = East.value(given.value, FloatType);
        else if (typeof given.value === "bigint") value = East.value(given.value, IntegerType).toFloat();
        else if (given.value instanceof Expr && isNumber(Expr.type(given.value) as EastType)) {
            value = asFloat(given.value as ExprType<EastType>, Expr.type(given.value) as EastType);
        } else {
            throw new Error(`${words} — and its value is ${given.value instanceof Expr ? typeText(Expr.type(given.value) as EastType) : String(given.value)}`);
        }
        if (given.note instanceof Expr && !isTypeEqual(Expr.type(given.note) as EastType, OptionType(StringType))) {
            throw new Error(`${words} — and its note is ${typeText(Expr.type(given.note) as EastType)}`);
        }
        const note = given.note === undefined ? East.value(none, OptionType(StringType)) : East.value(given.note as never, OptionType(StringType));
        return East.value({ value, note } as never, DrawnType);
    });
}

/**
 * A read resolved against the details' row (R20): its field checked, and the
 * value a row holds for it.
 *
 * @throws {Error} Naming the read and the field: a field the row lacks, or one of another type, naming those that fit;
 *   an Array of counts without bins; a Dict of structs without a draw
 */
function resolve(spec: ReadSpec, rowType: StructType): ResolvedRead {
    const where = `Flowchart.${spec.kind}`;
    const fields = rowType.fields as Record<string, EastType>;
    const type = fields[spec.field];
    if (type === undefined) throw new Error(`${where}: "${spec.field}" is no field of the details' row (${Object.keys(fields).join(", ")})`);
    const { fits, what } = FITS[spec.kind];
    if (!fits(type)) {
        const fitting = Object.keys(fields).filter((name) => fits(fields[name]!)).map((name) => `"${name}"`);
        throw new Error(`${where}: "${spec.field}" holds ${typeText(type)} — ${what}: ${fitting.length > 0 ? fitting.join(", ") : "the details' row has none"}`);
    }
    switch (spec.kind) {
        case "figure": {
            const inner = optionOf(type);
            return {
                spec,
                value: (_$, row) => {
                    const held = fieldOf(row, spec.field);
                    if (inner === undefined) return variant("figure", some(asFloat(held, type)));
                    if (inner.type === "Float") return variant("figure", held);
                    return variant("figure", (held as unknown as ExprType<OptionType<IntegerType>>).match({
                        none: (_$2) => East.value(none, OptionType(FloatType)),
                        some: (_$2, n) => East.value(some(n.toFloat()), OptionType(FloatType)),
                    }));
                },
            };
        }
        case "histogram": {
            if (type.type === "Array") {
                const bins = spec.bins;
                if (bins === undefined) throw new Error(`${where}: "${spec.field}" is an Array of counts — give the bins it counts in, bins: [0, …]`);
                const countType = type.value as EastType;
                return {
                    spec,
                    // An Array's counts are a bin each, in the bins' order: each at its bin's edge — or, another number of
                    // them, each at NaN, which no bin holds, so the row is listed in Issues and its bars drawn absent (R27).
                    value: ($, row) => {
                        const counts = $.const(fieldOf(row, spec.field)) as ExprType<ArrayType<IntegerType | FloatType>>;
                        const edges = $.const(bins) as ExprType<ArrayType<FloatType>>;
                        const bars = counts.size().equal(edges.size()).ifElse(
                            (_$2) => counts.map((_$3, count, i) => East.value({ from: edges.get(i), count: asFloat(count as ExprType<EastType>, countType) }, BinType)),
                            (_$2) => counts.size().equal(0n).ifElse(
                                (_$3) => East.value([{ from: NaN, count: 0 }], ArrayType(BinType)),
                                (_$3) => counts.map((_$4, count) => East.value({ from: NaN, count: asFloat(count as ExprType<EastType>, countType) }, BinType)),
                            ),
                        );
                        return variant("histogram", bars);
                    },
                };
            }
            const durations = type as DictType<EastType, EastType>;
            const keyType = durations.key as EastType;
            const countType = durations.value as EastType;
            return {
                spec,
                // A Dict's durations as they are, keyed: the renderer counts each into the bin that holds it (R27).
                value: (_$, row) => variant("histogram", (fieldOf(row, spec.field) as ExprType<DictType<EastType, EastType>>).toArray((_$2, count, from) =>
                    East.value({ from: asFloat(from as ExprType<EastType>, keyType), count: asFloat(count as ExprType<EastType>, countType) }, BinType))),
            };
        }
        case "list": {
            const itemType = (type as DictType).value as EastType;
            if (itemType.type === "Struct" && spec.draw === undefined) {
                const number = Object.entries(itemType.fields as Record<string, EastType>).find(([, t]) => isNumber(t))?.[0];
                throw new Error(`${where}: "${spec.field}" holds structs — give a draw, (item) => ({ value: item.${number ?? "…"} })`);
            }
            if (spec.draw !== undefined) {
                const draw = drawOf(where, spec.field, itemType, rowType, spec.draw);
                return {
                    spec,
                    value: ($, row) => {
                        const drawn = $.const(draw) as (item: unknown, name: unknown, row: unknown) => ExprType<typeof DrawnType>;
                        return variant("list", (fieldOf(row, spec.field) as ExprType<DictType<StringType, EastType>>).toArray(($2, item, name) => {
                            const given = $2.const(drawn(item, name, row));
                            return East.value({ name, value: given.value, note: given.note }, ItemType);
                        }));
                    },
                };
            }
            return {
                spec,
                value: (_$, row) => variant("list", (fieldOf(row, spec.field) as ExprType<DictType<StringType, EastType>>).toArray((_$2, item, name) =>
                    East.value({ name, value: asFloat(item as ExprType<EastType>, itemType), note: none }, ItemType))),
            };
        }
        case "tags":
            return {
                spec,
                value: (_$, row) => {
                    const held = fieldOf(row, spec.field);
                    return variant("tags", type.type === "Set" ? (held as ExprType<SetType<StringType>>).toArray() : held);
                },
            };
    }
}

/** An ordinal, as a refusal names an element. */
function ordinal(i: number): string {
    const n = i + 1;
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    return `${n}${suffix}`;
}

/**
 * A read on the wire: how it draws, the words it draws in.
 *
 * @param spec - The read
 * @param top - A list's lines unless given: 2 on a card, 1 on a label
 */
function wireOf(spec: ReadSpec, top: 1 | 2): unknown {
    const label = spec.label ?? spec.field;
    const option = (word: string | undefined) => word === undefined ? none : some(word);
    switch (spec.kind) {
        case "figure":
            return variant("figure", { label, unit: option(spec.unit) });
        case "histogram":
            return variant("histogram", {
                label,
                unit: variant(spec.unit, null),
                counts: option(spec.counts),
                bins: spec.bins === undefined ? none : some(spec.bins),
                scale: variant(spec.scale, null),
                ticks: spec.ticks === undefined ? none
                    : some(spec.ticks.map((t) => typeof t === "number" ? { at: t, label: none } : { at: t.at, label: some(t.label) })),
            });
        case "list":
            return variant("list", { label, unit: option(spec.unit), top: BigInt(spec.top ?? top) });
        case "tags":
            return variant("tags", { label, colors: spec.colors, legend: spec.legend });
    }
}

/**
 * One kind's details over the app's rows (R18, R19, R21), keyed as the kind's
 * are, read only: `Data.bind(record)`, read whole beside a kind read whole,
 * or `Data.bindPaged(record)`, read by the drawn rows' keys beside one read
 * through its source.
 *
 * @typeParam R - The details' row type, inferred from the binding
 * @typeParam S - The reads, as given
 * @param binding - The details' record: `Data.bind(record)`, or `Data.bindPaged(record)`
 * @param spec - `{ details: [ … ] }`: every read, in the order drawn
 * @returns The details, for a state's or a transition's `details`
 * @throws {Error} Naming the binding or the read (R18–R20): `Record.bind` — "Details are read only: bind them with
 *   Data.bind(record), or Data.bindPaged(record) beside a kind read through its source" — or anything but a binding of
 *   a record of structs keyed by String; an element that is no read; a read's field the row lacks, or one of another
 *   type; an Array of counts without bins; a Dict of structs without a draw
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DictType, East, IntegerType, StringType, StructType, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Flowchart } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * // A support desk's tickets: the states they pass through, the transitions between them, and the minutes
 * // each spent in each state. The app's task counts each state's tickets into the app's own bins — minutes at
 * // first, then hours, a shift and a day — an Array of counts, one a bin, keyed as the states are.
 * export const DeskState = StructType({ name: StringType, stage: StringType });
 * export const DeskTransition = StructType({ from: StringType, to: StringType });
 * export const DeskStage = StructType({ label: StringType, seq: IntegerType });
 * export const deskStates = e3.input("flowchart_desk_states", DictType(StringType, DeskState), variant("value", new Map([
 *     ["NEW", { name: "New", stage: "open" }], ["TRI", { name: "Triaged", stage: "open" }],
 *     ["WIP", { name: "In progress", stage: "work" }], ["WAI", { name: "Waiting on customer", stage: "work" }],
 *     ["RES", { name: "Resolved", stage: "close" }],
 * ])));
 * export const deskTransitions = e3.input("flowchart_desk_transitions", DictType(StringType, DeskTransition), variant("value", new Map([
 *     ["t1", { from: "NEW", to: "TRI" }], ["t2", { from: "TRI", to: "WIP" }], ["t3", { from: "WIP", to: "WAI" }],
 *     ["t4", { from: "WAI", to: "WIP" }], ["t5", { from: "WIP", to: "RES" }],
 * ])));
 * export const deskStages = e3.input("flowchart_desk_stages", DictType(StringType, DeskStage), variant("value", new Map([
 *     ["open", { label: "Open", seq: 1n }], ["work", { label: "Work", seq: 2n }], ["close", { label: "Close", seq: 3n }],
 * ])));
 * export const TicketMinutes = StructType({ minutes: ArrayType(IntegerType) });
 * export const ticketMinutes = e3.input("flowchart_ticket_minutes", DictType(StringType, TicketMinutes), variant("value", new Map([
 *     ["NEW", { minutes: [140n, 96n, 120n, 64n, 30n, 22n, 9n, 4n, 2n, 1n, 0n, 0n] }],
 *     ["TRI", { minutes: [62n, 88n, 131n, 90n, 41n, 25n, 12n, 6n, 3n, 1n, 0n, 0n] }],
 *     ["WIP", { minutes: [3n, 8n, 41n, 96n, 120n, 150n, 132n, 88n, 40n, 18n, 9n, 4n] }],
 *     ["WAI", { minutes: [0n, 1n, 2n, 6n, 9n, 14n, 30n, 58n, 74n, 66n, 41n, 22n] }],
 *     // A resolved ticket stays resolved: the app counts no time in it, so its row is absent and its card says no data.
 * ])));
 *
 * const flowchartTicketMinutes = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const states = $.let(Data.bind(deskStates));
 *         const transitions = $.let(Data.bind(deskTransitions));
 *         const stages = $.let(Data.bind(deskStages));
 *         const minutes = $.let(Data.bind(ticketMinutes));
 *         return (
 *             <Box height="560px">
 *                 <Flowchart
 *                     states={Flowchart.states(states, {
 *                         label: "name", lane: "stage",
 *                         details: Flowchart.details(minutes, {
 *                             details: [Flowchart.histogram("minutes", {
 *                                 unit: "minutes",
 *                                 label: "Time in state",
 *                                 counts: "tickets",
 *                                 // The edges, in minutes: an Array of counts is a bin each, in this order.
 *                                 bins: [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440],
 *                                 // A bar a bin, whatever its span — the default; "linear" draws them to scale.
 *                                 scale: "band",
 *                                 // The edges the axis names besides 0: 5m and 1h printed from the unit,
 *                                 // the last two in the app's own words.
 *                                 ticks: [5, 60, { at: 480, label: "a shift" }, { at: 1440, label: "a day" }],
 *                             })],
 *                         }),
 *                     })}
 *                     transitions={Flowchart.transitions(transitions, { from: "from", to: "to" })}
 *                     lanes={Flowchart.lanes(stages, { label: "label", order: "seq" })}
 *                     name="ticketMinutes"
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function flowchartDetails<R extends StructType, const S extends FlowchartDetailsSpec<R>>(
    binding: FlowchartDetailsBinding<R>,
    spec: S & FlowchartLegendOnCanvas<S>,
): FlowchartDetails<NoInfer<R>, NoInfer<S>> {
    const where = "Flowchart.details";
    const bound = bindingOf(binding, where);
    const rowType = bound.rowType;
    const given = typeof spec === "object" && spec !== null ? (spec as { details?: unknown }).details : undefined;
    if (!Array.isArray(given)) throw new Error(`${where}: give the reads as { details: [ … ] } — Flowchart.figure, .histogram, .list or .tags, in the order drawn`);
    const reads = given.map((read: unknown, i) => {
        const found = typeof read === "object" && read !== null ? READS.get(read) : undefined;
        if (found === undefined) {
            throw new Error(`${where}: \`details\` holds reads — Flowchart.figure, .histogram, .list or .tags — and the ${ordinal(i)} is none`);
        }
        return resolve(found, rowType);
    });

    // A row's values, from its bytes: one a read, in the reads' order.
    const values = East.function([BlobType], FlowchartDetailRowType, ($, bytes) => {
        const row = $.const(bytes.decodeBeast(rowType, "v2")) as ExprType<StructType>;
        return East.value(reads.map((read) => read.value($ as unknown as { const: (value: unknown) => unknown }, row)) as never, FlowchartDetailRowType);
    });
    // The details read whole, beside a kind read whole: each row's bytes, by key — built only then, since a paged
    // read has no whole to read.
    const Rows = DictType(StringType, BlobType);
    const whole = () => {
        const read = (bound.handle as unknown as { read: () => ExprType<DictType<StringType, StructType>> }).read;
        return East.function([], OptionType(Rows), (_$) =>
            East.value(some(read().map((_$2, row) => East.Blob.encodeBeast(row as ExprType<EastType>, "v2"))), OptionType(Rows)));
    };

    return {
        [FLOWCHART_DETAILS]: "details",
        rowType,
        inspectorReads: reads.some((r) => r.spec.show === "inspector"),
        check(noun, at) {
            if (noun !== "transitions") return;
            // A transition's label draws lines under its evidence: figures and lists, three at most (R21, R32).
            let lines = 0;
            for (const { spec: r } of reads) {
                if (r.show === "inspector") continue;
                if (r.kind === "histogram" || r.kind === "tags") {
                    throw new Error(`${at}: a transition's label draws lines: a figure or a list — give the ${r.kind === "tags" ? "tags" : "histogram"} show: "inspector"`);
                }
                lines += r.kind === "list" ? (r.top ?? 1) : 1;
            }
            if (lines > 3) {
                throw new Error(`${at}: a transition's label draws three lines at most under its evidence, and these draw ${lines} — ` +
                    "give one show: \"inspector\", or lower its top");
            }
        },
        build(noun, at, throughSource) {
            if (throughSource && bound.form === "data") {
                throw new Error(`${at}: the ${noun} are read through their source, so their details are read by key: bind them with Data.bindPaged(record)`);
            }
            if (!throughSource && bound.form === "paged") {
                throw new Error(`${at}: the ${noun} are read whole, so their details are read whole: bind them with Data.bind(record)`);
            }
            const top = noun === "states" ? 2 : 1;
            return East.value({
                reads: reads.map((r) => ({ show: variant(r.spec.show, null), read: wireOf(r.spec, top) })),
                rows: throughSource ? none : some(whole()),
                // The paged read the details are read by key through: a reader asks the drawn rows' keys of it, in one request.
                paged: throughSource ? some(fieldOf(bound.handle, "id")) : none,
                values,
            } as never, FlowchartDetailsType) as ExprType<typeof FlowchartDetailsType>;
        },
    } as FlowchartDetails<NoInfer<R>, NoInfer<S>>;
}
