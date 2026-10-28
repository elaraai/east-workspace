/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schematic.layers` (#1401, `Schematic Builder Spec.md` §8, D36): the layers
 * a Schematic's entities are on, read from the app's own record as the
 * Roster's lists are (`Roster.groups(teams.read(), { label, order })`) — a
 * `Dict` keyed by String, usually a record's `read()`, through accessors none
 * of which writes it. Each accessor is reified once and called per row, held
 * to the type it returns; one returning another type is refused, naming the
 * accessor and what it returns.
 *
 * Each layer's key is its record's key, which an entity's `layer` field names.
 * The layers come in their `order`, lowest first, then in key order; with no
 * `order`, in key order. `visible`, `locked` and `opacity` are the author's
 * defaults, which the viewer's choices in the Layers tab override.
 *
 * @packageDocumentation
 */

import {
    BooleanType, East, FloatType, IntegerType, OptionType, StringType, none, some,
    type ArrayType, type DictType, type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { scheduleAccessor } from "../schedule/accessor.js";
import { keyedRows, orderedRows } from "../utils/keyed-rows.js";
import { SCHEMATIC_DEF } from "./kinds.js";
import { SchematicLayerType, SchematicToneType } from "./types.js";

/** One of the layers' accessors, over a row of the app's and its key. */
type Accessor<R extends EastType, T extends EastType> = (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

/**
 * Accessors adapting the app's rows to the Schematic's layers.
 *
 * @typeParam R - The app's row type
 */
export interface SchematicLayersConfig<R extends EastType> {
    /** Its name, in the Layers tab. */
    label: Accessor<R, StringType>;
    /** Where it shows among the layers, lowest first; layers of one order show in key order. */
    order?: Accessor<R, IntegerType>;
    /** Its swatch's tone. */
    tone?: Accessor<R, OptionType<typeof SchematicToneType>>;
    /** Its swatch's colour: a theme colour token (`status.warn`), over its tone. */
    color?: Accessor<R, OptionType<StringType>>;
    /** Whether it shows at first: the author's default, `true` by default. */
    visible?: Accessor<R, BooleanType>;
    /** Whether it is locked at first, its entities never selecting: the author's default, `false` by default. */
    locked?: Accessor<R, BooleanType>;
    /** Its items' dim, from 0 to 1: `1` by default. */
    opacity?: Accessor<R, FloatType>;
}

/** The layers, declared: what the Schematic's `layers` takes. */
export interface SchematicLayers {
    /** What it is. */
    readonly [SCHEMATIC_DEF]: "layers";
    /** The layers, in their order. */
    readonly rows: ExprType<ArrayType<typeof SchematicLayerType>>;
}

/** The layers' declaration, as a refusal names it. */
const DECLARATION = "Schematic.layers(rows, { label, order?, tone?, color?, visible?, locked?, opacity? })";

/**
 * An accessor reified over the layers' rows, held to the type it returns,
 * refused in the layers' words.
 *
 * @param rowType - The app's row type
 * @param prop - The accessor's name
 * @param out - The type it returns
 * @param what - What it returns, as a refusal says it
 * @param fn - The author's accessor
 * @returns The accessor, an East function `(row, key) => T`; `undefined` when not given
 * @throws {Error} When it is no function, or returns another type, naming it and what it returns
 */
function accessorOf<T extends EastType>(rowType: EastType, prop: string, out: T, what: string, fn: unknown): ExprType<FunctionType<[EastType, StringType], T>> | undefined {
    if (fn === undefined) return undefined;
    if (typeof fn !== "function") throw new Error(`Schematic.layers: \`${prop}\` is an accessor, (row, key) => ${what}`);
    return scheduleAccessor(rowType, StringType, out, fn as (row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<T>,
        (returns) => `Schematic.layers: \`${prop}\` returns ${what} — and this one returns ${returns}`) as unknown as ExprType<FunctionType<[EastType, StringType], T>>;
}

/**
 * Reads the app's rows as the Schematic's layers (see the module docs).
 *
 * @typeParam R - The app's row type
 * @param rows - The layers by String key, usually `Data.bind(record).read()`
 * @param config - The label accessor, and optional order, tone, colour and author defaults
 * @returns The layers, declared, for the Schematic's `layers`
 * @throws {Error} When the rows are not a Dict keyed by String, `label` is missing, or an accessor is no function or returns another type than it takes, naming it and what it returns
 */
export function schematicLayers<R extends EastType>(rows: ExprType<DictType<StringType, R>>, config: SchematicLayersConfig<R>): SchematicLayers {
    const where = "Schematic.layers";
    const { rows: held, rowType } = keyedRows(where, "layers", rows);
    const c = (config ?? {}) as unknown as Readonly<Record<keyof SchematicLayersConfig<EastType>, unknown>>;
    if (typeof c.label !== "function") throw new Error(`${where}: \`label\` is an accessor giving each layer's name — ${DECLARATION}`);
    const label = accessorOf(rowType, "label", StringType, "a String, a layer's name", c.label)!;
    const order = accessorOf(rowType, "order", IntegerType, "an Integer, where a layer shows", c.order);
    const tone = accessorOf(rowType, "tone", OptionType(SchematicToneType), "an Option of a Schematic.Types.Tone", c.tone);
    const color = accessorOf(rowType, "color", OptionType(StringType), "an Option of a String, a theme colour token", c.color);
    const visible = accessorOf(rowType, "visible", BooleanType, "a Boolean, whether a layer shows at first", c.visible);
    const locked = accessorOf(rowType, "locked", BooleanType, "a Boolean, whether a layer is locked at first", c.locked);
    const opacity = accessorOf(rowType, "opacity", FloatType, "a Float, its items' dim from 0 to 1", c.opacity);
    const item = East.function([rowType, StringType], SchematicLayerType, ($, row, key) => {
        const labelOf = $.const(label);
        const toneOf = tone === undefined ? undefined : $.const(tone);
        const colorOf = color === undefined ? undefined : $.const(color);
        const visibleOf = visible === undefined ? undefined : $.const(visible);
        const lockedOf = locked === undefined ? undefined : $.const(locked);
        const opacityOf = opacity === undefined ? undefined : $.const(opacity);
        return {
            key,
            label: labelOf(row as never, key),
            visible: visibleOf === undefined ? none : some(visibleOf(row as never, key)),
            locked: lockedOf === undefined ? none : some(lockedOf(row as never, key)),
            opacity: opacityOf === undefined ? none : some(opacityOf(row as never, key)),
            tone: toneOf === undefined ? none : toneOf(row as never, key),
            color: colorOf === undefined ? none : colorOf(row as never, key),
        } as never;
    }) as unknown as ExprType<FunctionType<[EastType, StringType], typeof SchematicLayerType>>;
    return { [SCHEMATIC_DEF]: "layers", rows: orderedRows(held, rowType, SchematicLayerType, item, order) };
}

/**
 * Whether a value is `Schematic.layers`' declaration: what the Schematic's
 * `layers` checks before it takes one.
 *
 * @param value - What the app passed
 * @returns Whether it is the layers, declared
 * @internal
 */
export function isSchematicLayers(value: unknown): value is SchematicLayers {
    return typeof value === "object" && value !== null && SCHEMATIC_DEF in value && (value as { [SCHEMATIC_DEF]: string })[SCHEMATIC_DEF] === "layers";
}
