/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's narrowing under test (#1344): record Slice parts over rows the test
 * holds, kept in the shared store — the product's functions as the runtime's
 * run them: each part's state under its key, each choice made through
 * `recordChoiceWhere` over its indexes, its counts and its range field's
 * domain over its rows — and the rail's chrome over them, as a Plan's root
 * carries it. What a renderer test narrows a canvas through without e3's
 * paging; the product's own paths run over real indexes in the frame's tests
 * (`frame/harness.test-utils.tsx`) and `test/record-sources.spec.ts`.
 *
 * @packageDocumentation
 */

import {
    DateTimeType, FloatType, IntegerType, StringType, decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import {
    RecordSliceConfigType, RecordSliceStateType, recordChoiceWhere,
    type RecordSliceBindType, type RecordSliceChoiceType, type RecordSliceFieldType, type RecordSlicesChromeType,
} from "@elaraai/east-ui/internal";
import { getStore, trackKey } from "@elaraai/east-ui-components/internal";

/** One record Slice's controls, decoded. */
export type RecordPart = ValueTypeOf<RecordSliceBindType>;
/** The rail's chrome, as a Plan's root carries it. */
export type RecordSlicesChrome = ValueTypeOf<RecordSlicesChromeType>;
/** A part's state. */
type State = ValueTypeOf<RecordSliceStateType>;
/** One field's choice. */
type Choice = ValueTypeOf<RecordSliceChoiceType>;
/** One field's control. */
type Field = ValueTypeOf<RecordSliceFieldType>;

const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeConfig = encodeBeast2For(RecordSliceConfigType);
const decodeConfig = decodeBeast2For(RecordSliceConfigType);
const printDateTime = printFor(DateTimeType);
const printInteger = printFor(IntegerType);
const printFloat = printFor(FloatType);
const parseDateTime = parseFor(DateTimeType);
const parseInteger = parseFor(IntegerType);
const parseFloat_ = parseFor(FloatType);

/** The kinds a range field takes: what a window speaks. */
export type RangeKind = "datetime" | "float" | "integer";

/** A String field a part narrows by: its id, its label, its known values, and each row's. */
export interface StringFieldSpec {
    readonly id: string;
    readonly label: string;
    /** Its known values, the chips it offers. */
    readonly hints: readonly string[];
    /** Each row's value, in the rows' order. */
    readonly values: readonly string[];
}

/** What a part narrows over: its range field, and a String field or two before it. */
export interface RecordPartSpec {
    /** The part's store key: the slice's key and the source's name, `${key}.${source}`. */
    readonly key: string;
    /** Its range field: its id, its kind, its label, and each row's value on the axis's domain (epoch ms on a datetime field). */
    readonly range?: { readonly id: string; readonly kind: RangeKind; readonly label?: string; readonly values: readonly number[] } | undefined;
    /** String fields before it, each in an index of its own beside the range. */
    readonly strings?: readonly StringFieldSpec[] | undefined;
    /** The window it holds at first, `[from, to)` on the axis's domain. */
    readonly window?: readonly [number, number] | undefined;
    /** The resolution it holds at first. */
    readonly resolution?: string | undefined;
    /** How many rows it holds, when it has no range field. */
    readonly rows?: number | undefined;
}

/**
 * A range endpoint's literal on the field's own type.
 *
 * @param kind - The range field's kind
 * @param value - The endpoint on the axis's domain
 * @returns Its literal, as the rail writes it
 */
export function rangeLiteral(kind: RangeKind, value: number): string {
    return kind === "datetime" ? printDateTime(new Date(value)) : kind === "integer" ? printInteger(BigInt(Math.round(value))) : printFloat(value);
}

/**
 * A range endpoint read back onto the axis's domain.
 *
 * @param kind - The range field's kind
 * @param text - The endpoint's literal
 * @returns It, as a number: epoch ms on a datetime field
 */
export function rangeValue(kind: RangeKind, text: string): number {
    if (kind === "datetime") {
        const read = parseDateTime(text);
        if (!read.success) throw new Error(`not a datetime literal: ${text}`);
        return read.value.getTime();
    }
    if (kind === "integer") {
        const read = parseInteger(text);
        if (!read.success) throw new Error(`not an integer literal: ${text}`);
        return Number(read.value);
    }
    const read = parseFloat_(text);
    if (!read.success) throw new Error(`not a float literal: ${text}`);
    return read.value;
}

/**
 * A record Slice's part over rows the test holds — see the module docs.
 *
 * @param spec - Its key, its range field and its String fields over its rows, and the window and resolution it holds at first
 * @returns The part, its state in the shared store
 */
export function recordPart(spec: RecordPartSpec): RecordPart {
    const strings = spec.strings ?? [];
    const range = spec.range;
    const printString = printFor(StringType);
    const fields: Field[] = [
        ...strings.map((s): Field => ({
            fieldId: s.id, label: s.label, kind: "string", optional: false, multiple: true, set: false,
            values: s.hints.map((hint) => ({ value: printString(hint), label: hint })), format: none,
        })),
        ...(range === undefined ? [] : [{
            fieldId: range.id, label: range.label ?? range.id, kind: range.kind, optional: false, multiple: false, set: false, values: [], format: none,
        } satisfies Field]),
    ];
    // An index per String field, the range after it, and one over the range alone.
    const indexes = [
        ...strings.map((s) => ({ name: `by_${s.id}`, fields: range === undefined ? [s.id] : [s.id, range.id], sets: new Set<string>(), structured: false, interval: none })),
        ...(range === undefined ? [] : [{ name: `by_${range.id}`, fields: [range.id], sets: new Set<string>(), structured: false, interval: none }]),
    ];
    const config = decodeConfig(encodeConfig({ fields, indexes, range: range === undefined ? none : some(range.id), search: [], presets: [] }));
    const key = spec.key;
    if (getStore().read(key) === undefined) {
        const where = new Map<string, Choice>();
        if (range !== undefined && spec.window !== undefined) {
            where.set(range.id, variant("range", { from: rangeLiteral(range.kind, spec.window[0]), to: rangeLiteral(range.kind, spec.window[1]) }));
        }
        getStore().write(key, encodeState({
            where, preset: none, resolution: spec.resolution === undefined ? none : some(variant(spec.resolution, null)) as State["resolution"],
        }));
    }
    const read = (): State => { trackKey(key); return decodeState(getStore().read(key)!); };
    const write = (state: State): null => { getStore().write(key, encodeState(state)); return null; };
    const choose = (id: string, choice: Choice | undefined): null => {
        const where = recordChoiceWhere(config.indexes, read().where, id, choice);
        if (where === null) throw new Error("Choose a preceding field first");
        return write({ ...read(), where, preset: none });
    };
    const count = spec.rows ?? range?.values.length ?? strings[0]?.values.length ?? 0;
    // Whether a row holds every choice of a narrowing: a String field's values, the range field's half-open range.
    const holds = (where: State["where"], row: number, ignore?: string): boolean => {
        for (const [id, choice] of where) {
            if (id === ignore) continue;
            const string = strings.find((s) => s.id === id);
            if (string !== undefined) {
                const value = printString(string.values[row]!);
                if (choice.type === "values" && !choice.value.includes(value)) return false;
                if (choice.type === "prefix" && !string.values[row]!.startsWith(choice.value)) return false;
            } else if (range !== undefined && id === range.id && choice.type === "range") {
                const at = range.values[row]!;
                if (at < rangeValue(range.kind, choice.value.from) || at >= rangeValue(range.kind, choice.value.to)) return false;
            }
        }
        return true;
    };
    const counted = (where: State["where"]) => some(BigInt(Array.from({ length: count }, (_x, i) => i).filter((row) => holds(where, row)).length));
    return {
        key, config, sourceId: key, read, write,
        choose: (id, values) => choose(id, values.length === 0 ? undefined : variant("values", values)),
        range: (id, from, to) => choose(id, variant("range", { from, to })),
        prefix: (id, value) => choose(id, variant("prefix", value)),
        clear: (id) => choose(id, undefined),
        clearAll: () => write({ ...read(), where: new Map(), preset: none }),
        count: () => counted(read().where),
        countWhere: (where) => counted(where),
        total: () => some(BigInt(count)),
        // The range field's extent over the rows the other choices keep, both ends inclusive.
        domain: (id) => {
            if (range === undefined || id !== range.id) return none;
            const where = read().where;
            const kept = range.values.filter((_v, row) => holds(where, row, range.id));
            if (kept.length === 0) return none;
            let min = kept[0]!;
            let max = kept[0]!;
            for (const value of kept) { if (value < min) min = value; if (value > max) max = value; }
            return some({ from: rangeLiteral(range.kind, min), to: rangeLiteral(range.kind, max) });
        },
        values: (id) => {
            const string = strings.find((s) => s.id === id);
            if (string === undefined) return [];
            const chosen = read().where.get(id);
            return string.hints.map((hint) => {
                const value = printString(hint);
                const where = new Map(read().where).set(id, variant("values", [value]) as Choice);
                return { value, label: hint, count: counted(where), selected: chosen?.type === "values" && chosen.value.includes(value), error: none };
            });
        },
        suggest: () => none,
        replaces: () => [],
        togglePreset: () => null,
        setResolution: (resolution) => write({ ...read(), resolution }),
        retry: () => null,
        readEntry: () => some(none),
        contains: () => some(false),
    };
}

/**
 * The rail's chrome over parts, as a Plan's root carries it.
 *
 * @param key - The slice's key
 * @param parts - Each source's name, its label when it has one, and its part, in the slice's order
 * @param affordances - The rail's controls
 * @returns The chrome
 */
export function recordSlices(key: string, parts: readonly { source: string; label?: string; slice: RecordPart }[], affordances: readonly string[]): RecordSlicesChrome {
    return {
        slice: {
            key,
            parts: parts.map(({ source, label, slice }) => ({ source, label: label === undefined ? none : some(label), icon: none, slice })),
            presets: [],
            clearAll: () => { for (const { slice } of parts) slice.clearAll(); return null; },
            togglePreset: () => null,
        },
        affordances: affordances.map((affordance) => variant(affordance, null)) as RecordSlicesChrome["affordances"],
        persist: none,
    };
}
