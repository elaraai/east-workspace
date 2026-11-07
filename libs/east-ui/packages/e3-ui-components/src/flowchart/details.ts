/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's details model (#1508, `Flowchart Records Spec.md` R19, R22,
 * R26, R27, R33, R34, R38): the app's rows a state's card and a transition's
 * label draw from, read as their kind is, counted into the flowchart's bins,
 * and each card's size — pure, but for its reader.
 *
 * - **Read as the kind is** (R19). Beside a kind read whole the details are
 *   read whole, through their `rows`; beside one read through its source, by
 *   the keys of the rows drawn, every key in one request, through the paged
 *   read they name (`defaultPagedRuntime.rowsAll`, as the Schematic reads its
 *   far ends), each key's text read back at the kind's key type, as the
 *   details are keyed (#1549). Either way a row is matched to the kind's by
 *   its key: a key the details hold no row of draws *no data* (R33), and a
 *   details row keyed as no row drawn draws nothing and is no issue (R38). The
 *   last settled read stands while a newer one is in flight; a key no settled
 *   read asked of draws a placeholder (R34); a failed read keeps what it held,
 *   and says why.
 * - **The flowchart's bins** (R26, R27). A histogram read's bins are shared by
 *   every card that draws it, so a bar is the same span on each: the app's
 *   `bins`, checked as they land — an Array the app binds may hold no edge, one
 *   that is no finite number, or two that do not ascend, and is then listed in
 *   Issues, its bars drawn on no card — else every drawn row's edges merged. A
 *   Dict's durations count in the bin that holds them, one under the first edge
 *   in the first; an Array's counts are a bin each, each at its bin's edge. A
 *   count at no edge — an Array of another length than its bins, whose counts
 *   e3-ui puts at `NaN` — or one that is no count, negative or not finite, no
 *   bin holds: the row is listed in Issues, and a histogram none of whose
 *   counts a bin holds has nothing to show.
 * - **Bars** (R26): on a band axis, the default, a bar a bin, equal widths; on a
 *   linear axis each bar as wide as its span and as tall as its count over it,
 *   so its area is its count, the open last bin as wide as the one before it.
 *   Each card is scaled to its own tallest bar.
 * - **Each card's size** (R22, §4), the visual spec's, from the reads it shows:
 *   272 wide where a read draws on the canvas; its head, a rule, then each read
 *   in the details' order, 12 apart inside 12 of padding. A tag list wraps by
 *   its tags' widths — measured where the card draws, estimated elsewhere —
 *   three lines at most, then +n.
 * - **Weighed by the rail's picks** (#1522, R43–R46). Details that name a
 *   source of the rail are read by key whatever their kind's read: the drawn
 *   rows through their entries index's lean rows, and the picked keys' ranges
 *   of the index, re-read as the picks change — never the record's own rows.
 *   A row's picked entries are what each read the picks weigh draws, added up
 *   by kind in East (`fold`); a row holding none of them says *no data* in
 *   those reads and draws its own in the others; with no pick, every read
 *   draws the row's own. The source's other fields narrow the rows: a row they
 *   leave out reads as a row there is none of (R33). A source over another
 *   record than the details' is listed in Issues, and its picks weigh nothing.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
    BlobType, FloatType, IntegerType, SortedMap, SortedSet, StringType, compareFor, encodeBeast2For, equalFor, fromEastTypeValue, lessFor, none,
    printFor, some, variant, type EastType, type EastTypeValue, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { Flowchart } from "@elaraai/e3-ui/internal";
import type { RecordSliceBindType, RecordSliceChoiceType, RecordSliceEntry, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import { recordChoiceSummary, recordSliceWithin } from "@elaraai/east-ui-components/internal";
import { indexedBindingOf, type IndexedBindingRead } from "../platform/indexed-paged.js";
import { defaultPagedRuntime, pagedSourceOf, type PagedSource } from "../platform/paged-runtime.js";
import { STRING_KEYS, kindKeys, type KindKeys } from "../shared/schedule/kind-keys.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import type { FlowchartModel, FlowchartValue } from "./model.js";

/** A kind's details, decoded: each read described, and its rows' values. */
export type FlowchartDetailsValue = ValueTypeOf<typeof Flowchart.Types.Details>;

/** One read, described. */
export type FlowchartReadValue = ValueTypeOf<typeof Flowchart.Types.Read>;

/** A details row's values: one a read, in the reads' order. */
export type FlowchartDetailRowValue = ValueTypeOf<typeof Flowchart.Types.DetailRow>;

/** A histogram's value in a row: its counts, each at the lower edge of the bin it counts. */
type HistogramValue = Extract<FlowchartDetailRowValue[number], { type: "histogram" }>["value"];

/** A list's value in a row: its items, by name. */
type ListValue = Extract<FlowchartDetailRowValue[number], { type: "list" }>["value"];

/** A tags read's looks: each a tag's, first defined, first shown. */
export type FlowchartTagColors = Extract<FlowchartReadValue, { type: "tags" }>["value"]["colors"];

/** How the rail's picks weigh a kind's details, as the payload gives it (#1522). */
export type FlowchartWeighedValue = ValueTypeOf<typeof Flowchart.Types.Weighed>;

/** A source's part of the rail: its record Slice's controls, as the payload's chrome carries them. */
export type FlowchartSlicePart = ValueTypeOf<RecordSliceBindType>;

/** The kinds that carry details. */
export type FlowchartDetailsSort = "states" | "transitions";

/** A kind carrying details, as the payload gives it. */
export interface FlowchartDetailsKind {
    /** Its name: what Issues names its refused bins by. */
    readonly name: string;
    /** Its details. */
    readonly details: FlowchartDetailsValue;
    /** Its keys (#1549): the details, keyed as the kind is, are asked by each key's text read back at its key type; String's by default. */
    readonly keys?: KindKeys | undefined;
    /** The rail's part whose picks weigh them (#1522); `undefined` for details none weighs. */
    readonly weighing?: FlowchartSlicePart | undefined;
}

/** The kinds carrying details: `undefined` for a kind with none. */
export interface FlowchartDetailsKinds {
    /** The states'. */
    readonly states: FlowchartDetailsKind | undefined;
    /** The transitions'. */
    readonly transitions: FlowchartDetailsKind | undefined;
}

/**
 * The kinds carrying details, from the payload.
 *
 * @param value - The payload
 * @returns Each kind's name, details and keys, where it has some
 */
export function detailsKindsOf(value: FlowchartValue): FlowchartDetailsKinds {
    const chrome = getSomeorUndefined(value.slice);
    const kind = (name: string, details: FlowchartDetailsValue | undefined, keyType: EastTypeValue): FlowchartDetailsKind | undefined => {
        if (details === undefined) return undefined;
        // Weighed, the rail's part of the source whose picks weigh them (#1522): the payload refuses a source the slice lacks.
        const weighed = getSomeorUndefined(details.weighed);
        return { name, details, keys: kindKeys(keyType), weighing: weighed === undefined ? undefined : sourcePart(chrome, weighed.source) };
    };
    const transitions = getSomeorUndefined(value.transitions);
    return {
        states: kind(value.states.name, getSomeorUndefined(value.states.details), value.states.keyType),
        transitions: transitions === undefined ? undefined : kind(transitions.name, getSomeorUndefined(transitions.details), transitions.keyType),
    };
}

const compareKey = compareFor(StringType);
const sameString = equalFor(StringType);
const compareFloat = compareFor(FloatType);
const lessFloat = lessFor(FloatType);
const sameBytes = equalFor(BlobType);
const compareRow = compareFor(IntegerType);

/** Why a read failed, as the box says it. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// The rows drawn
// ============================================================================

/** The keys of the rows the canvas draws, by kind, each in their keys' order at its key type: what the details are matched to, and asked by. */
export interface FlowchartDrawnKeys {
    /** The states drawn: a ghost stands for no row, so none of them. */
    readonly states: readonly string[];
    /** The transitions drawn: those routed, and those in place, drawn as their state's `↻ n`. */
    readonly transitions: readonly string[];
}

/**
 * The keys of the rows a model draws (R19): what the details are asked by.
 *
 * @param model - What the canvas draws, the drafts in place
 * @returns Each kind's keys, in their keys' order at its key type (#1549)
 */
export function drawnKeysOf(model: FlowchartModel): FlowchartDrawnKeys {
    const states = new Set<string>();
    const transitions = new Set<string>();
    for (const node of model.nodes) {
        if (!node.ghost) states.add(node.key);
        for (const key of node.inPlaceKeys) transitions.add(key);
    }
    for (const link of model.links) transitions.add(link.key);
    return {
        states: model.keys.states.order(states).map(({ text }) => text),
        transitions: model.keys.transitions.order(transitions).map(({ text }) => text),
    };
}

/** Two lists of keys holding the same keys, in the same order. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((key, i) => sameString(key, b[i]!));
}

/**
 * The keys of the rows a model draws, the same object while they are the same:
 * a draft or a page landing moves the model, and seldom the keys it draws.
 *
 * @param model - What the canvas draws
 * @returns Each kind's keys
 */
export function useDrawnKeys(model: FlowchartModel): FlowchartDrawnKeys {
    const held = useRef<FlowchartDrawnKeys | undefined>(undefined);
    const now = useMemo(() => drawnKeysOf(model), [model]);
    const was = held.current;
    const kept = was !== undefined && sameKeys(was.states, now.states) && sameKeys(was.transitions, now.transitions) ? was : now;
    held.current = kept;
    return kept;
}

// ============================================================================
// The read
// ============================================================================

/** Each key's row, as bytes at the details' row type — `null` for a key the details hold no row of. */
export type FlowchartDetailBytes = ReadonlyMap<string, Uint8Array | null>;

/**
 * How the details are read by key, beside a kind read through its source
 * (R19): the rows of the keys asked, every key in one request, each key's text
 * read back at the kind's key type (#1549) — `none` while in flight. Throws
 * the read's failure.
 */
export type FlowchartPagedRows = (paged: string, keys: readonly string[], keyed: KindKeys) => option<FlowchartDetailBytes>;

/** Each paged source's row encoder: what turns a row read by key back into the bytes `values` reads. */
const ENCODERS = new WeakMap<PagedSource, (row: unknown) => Uint8Array>();

/**
 * The details read by key through the paged read named (R19):
 * `defaultPagedRuntime.rowsAll` over the keys asked, one request and one
 * channel, each row encoded back at the Dict's row type, as the details'
 * `values` reads it.
 *
 * @param paged - The paged read's handle id
 * @param keys - The keys of the rows drawn, as their texts
 * @param keyed - The kind's keys, which the details are keyed as: a text no key prints as holds no row
 * @returns Each key's row's bytes — `null` for none — once every one is known; `none` while in flight
 * @throws {Error} Naming the read, where `Data.bindPaged` has bound no handle of its id; the read's failure, until a read
 *   after the retry gap asks again
 */
export const pagedDetailRows: FlowchartPagedRows = (paged, keys, keyed) => {
    const source = pagedSourceOf(paged);
    if (source === undefined) throw new Error(`The details' paged read '${paged}' names no handle Data.bindPaged has bound`);
    const rows = new Map<string, Uint8Array | null>(keys.map((text) => [text, null] as const));
    // Each text read back at the kind's key type: one no key prints as holds no row, and is asked nothing.
    const asked = keys.flatMap((text) => {
        const key = keyed.keyOf(text);
        return key === undefined ? [] : [key];
    });
    if (asked.length === 0) return some(rows);
    const read = defaultPagedRuntime.rowsAll(source, asked);
    if (read.type !== "some") return none;
    let encode = ENCODERS.get(source);
    if (encode === undefined) {
        // A Dict's own rows: `rowsAll` reads none else.
        const rowType = (source.type.value as { readonly value: Parameters<typeof fromEastTypeValue>[0] }).value;
        encode = encodeBeast2For(fromEastTypeValue(rowType)) as (row: unknown) => Uint8Array;
        ENCODERS.set(source, encode);
    }
    for (const row of read.value) rows.set(keyed.textOf(row.key), row.row.type === "some" ? encode(row.row.value) : null);
    return some(rows);
};

/**
 * A weighed kind's rows, as one read found them (#1522): each drawn key's row
 * as bytes — `null` for a key the details hold no row of — the rows
 * themselves, which the source's other fields are asked of, and each row's
 * picked entries as bytes, each an entry's value, in the entries' key order.
 */
export interface FlowchartWeighedBytes {
    /** Each drawn key's lean row's bytes: the row with the Dict field the entries index files emptied. */
    readonly rows: FlowchartDetailBytes;
    /** Each drawn key's lean row, by key: what a membership read asks of the source's other fields. */
    readonly lean: ReadonlyMap<string, unknown>;
    /** Each drawn row's picked entries' bytes, by key — a row holding none of the picks absent. */
    readonly entries: ReadonlyMap<string, readonly Uint8Array[]>;
}

/**
 * How weighed details are read by key (#1522, R44): the drawn rows through
 * their entries index's lean rows, each key's text read back at the kind's key
 * type (#1549), and the picked keys' ranges of the index, each kept to the rows
 * drawn — `none` while in flight. Throws the read's failure.
 */
export type FlowchartWeighedRows = (paged: string, weighed: FlowchartWeighedValue, picks: readonly string[], keys: readonly string[], keyed: KindKeys) => option<FlowchartWeighedBytes>;

/** A binding's encoders, made once: a key's `.east` literal, a row's bytes, and an entry's, by its index. */
interface WeighedCodecs {
    readonly key: (key: unknown) => string;
    readonly row: (row: unknown) => Uint8Array;
    readonly entries: Map<string, (value: unknown) => Uint8Array>;
}

/** Each binding's encoders. */
const WEIGHED_CODECS = new WeakMap<IndexedBindingRead, WeighedCodecs>();

/** A binding's encoders, made the first time it is read. */
function codecsOf(binding: IndexedBindingRead): WeighedCodecs {
    let codecs = WEIGHED_CODECS.get(binding);
    if (codecs === undefined) {
        codecs = {
            key: printFor(binding.key as EastType) as (key: unknown) => string,
            row: encodeBeast2For(binding.row as EastType) as (row: unknown) => Uint8Array,
            entries: new Map(),
        };
        WEIGHED_CODECS.set(binding, codecs);
    }
    return codecs;
}

/** A run of a source's entries, as a search found it. */
type Run = { readonly found: boolean; readonly row: bigint; readonly count: bigint };

/**
 * The weighed details read through the binding they name (#1522, R44): the
 * drawn keys searched in the entries index's lean rows and the picked keys in
 * the index, in one request each, then the rows found and the picked keys'
 * ranges read, in one request each — so a pick reads its ranges, and the rows
 * by key, and never the record's own rows. Each entry is kept to the rows
 * drawn, a row's in the entries' key order.
 *
 * @param paged - The binding's id
 * @param weighed - How the picks weigh the details
 * @param picks - The picked keys, as `.east` literals of the Dict's keys
 * @param keys - The keys of the rows drawn, as their texts, in their keys' order
 * @param keyed - The kind's keys, which the details are keyed as: a text no key prints as holds no row
 * @returns The rows, and their picked entries, once every one is known; `none` while in flight
 * @throws {Error} Naming the read, where `Data.bindPaged` has bound no binding of its id, or one listing no such entries
 *   index; the read's failure, until a read after the retry gap asks again
 */
export const weighedDetailRows: FlowchartWeighedRows = (paged, weighed, picks, keys, keyed) => {
    const binding = indexedBindingOf(paged);
    if (binding === undefined) throw new Error(`The details' paged read '${paged}' names no binding Data.bindPaged has bound over a record's indexes`);
    const index = binding.entries.get(weighed.index);
    if (index === undefined) throw new Error(`The details' binding '${paged}' lists no entries index '${weighed.index}'`);
    const codecs = codecsOf(binding);
    let entry = codecs.entries.get(weighed.index);
    if (entry === undefined) {
        entry = encodeBeast2For(index.value) as (value: unknown) => Uint8Array;
        codecs.entries.set(weighed.index, entry);
    }
    const { seekAll, runsAll } = binding.batches;
    // The drawn rows, each a run of one of the lean rows — its text read back at the kind's key type, one no key prints
    // as asked nothing; the picked keys, each its range of the index — asked together.
    const asked = keys.flatMap((text) => {
        const key = keyed.keyOf(text);
        return key === undefined ? [] : [key];
    });
    const found = asked.length === 0 ? some([] as Run[]) : seekAll(index.rows, asked.map((key) => variant("key", codecs.key(key))));
    const ranges = picks.length === 0 ? some([] as Run[]) : seekAll(weighed.index, picks.map((pick) => variant("key", pick)));
    if (found.type === "none" || ranges.type === "none") return none;
    const rowRuns = found.value.filter((run) => run.found);
    // The ranges in the index's order — the picked keys' — so a row's entries come in their keys' order.
    const pickRuns = ranges.value.filter((run) => run.found && compareRow(run.count, 0n) > 0).sort((a, b) => compareRow(a.row, b.row));
    const lean = rowRuns.length === 0 ? some([] as RecordSliceEntry[]) : runsAll(index.rows, rowRuns) as option<RecordSliceEntry[]>;
    const held = pickRuns.length === 0 ? some([] as RecordSliceEntry[]) : runsAll(weighed.index, pickRuns) as option<RecordSliceEntry[]>;
    if (lean.type === "none" || held.type === "none") return none;
    const rows = new Map<string, Uint8Array | null>(keys.map((key) => [key, null] as const));
    const leanRows = new Map<string, unknown>();
    for (const read of lean.value) {
        const row = read.row === undefined ? undefined : getSomeorUndefined(read.row);
        if (row === undefined) continue;
        const key = keyed.textOf(read.key);
        rows.set(key, codecs.row(row));
        leanRows.set(key, row);
    }
    const entries = new Map<string, Uint8Array[]>();
    for (const read of held.value) {
        const key = keyed.textOf(read.key);
        const value = read.value === undefined ? undefined : getSomeorUndefined(read.value);
        // Kept to the rows drawn: a range holds every row's entry of its key.
        if (value === undefined || !leanRows.has(key)) continue;
        const list = entries.get(key);
        if (list === undefined) entries.set(key, [entry(value)]);
        else list.push(entry(value));
    }
    return some({ rows, lean: leanRows, entries });
};

/**
 * A Retry of the details (R34): each kind's paged read asked again what failed
 * of it, at once — not after the retry gap a read alone waits — as a Retry
 * asks a source of the rail (`defaultPagedRuntime.askAgain`). A kind read
 * whole is read again as the read's attempt moves; one weighed by the rail's
 * picks asks its binding's record again (#1522).
 *
 * @param kinds - The kinds carrying details
 */
export function askDetailsAgain(kinds: FlowchartDetailsKinds): void {
    for (const kind of [kinds.states, kinds.transitions]) {
        const paged = kind === undefined ? undefined : getSomeorUndefined(kind.details.paged);
        if (paged === undefined) continue;
        if (kind!.details.weighed.type === "some") {
            indexedBindingOf(paged)?.askAgain();
            continue;
        }
        const source = pagedSourceOf(paged);
        if (source !== undefined) defaultPagedRuntime.askAgain(source);
    }
}

/**
 * How the rail's picks weigh one kind's details, as one read found them
 * (#1522): the picks, and each drawn row's picked entries.
 */
interface WeighedRead {
    /** The picks, as `.east` literals of the Dict's keys: none, and every read draws the row's own. */
    readonly picks: readonly string[];
    /** Each drawn row's picked entries' bytes, by key: a row holding none of the picks absent. */
    readonly entries: ReadonlyMap<string, readonly Uint8Array[]>;
    /** Whether the rail's source narrows another record than the details read: its picks then weigh nothing. */
    readonly apart: boolean;
}

/** One kind's details as one read found them: each drawn key's row as bytes once landed, `undefined` while in flight; or why it failed. */
interface KindRead {
    readonly rows: FlowchartDetailBytes | undefined;
    readonly error: string | undefined;
    /** Weighed by the rail's picks (#1522); `undefined` for details none weighs. */
    readonly weighed?: WeighedRead | undefined;
}

/** A read in flight. */
const IN_FLIGHT: KindRead = { rows: undefined, error: undefined };

/** No row asked of: a kind with nothing drawn. */
const NO_BYTES: FlowchartDetailBytes = new Map<string, Uint8Array | null>();

/** No picked entries. */
const NO_ENTRIES: ReadonlyMap<string, readonly Uint8Array[]> = new Map<string, readonly Uint8Array[]>();

/** A narrowing without one field's choice: the source's other fields', which narrow the details' rows (#1522). */
function withoutField(where: ValueTypeOf<RecordSliceWhereType>, field: string): ValueTypeOf<RecordSliceWhereType> {
    return new SortedMap<string, ValueTypeOf<RecordSliceChoiceType>>([...where].filter(([at]) => !sameString(at, field)), compareKey);
}

/**
 * One kind's details weighed by the rail's picks (#1522, R44, R45): the picks
 * read from the source's part as they stand, so a pick reads again; the rows
 * and their picked entries read by key; and a row the source's other fields
 * leave out read as a row there is none of (R33). A source over another
 * record than the details' weighs nothing.
 *
 * @param kind - The kind
 * @param weighed - How the picks weigh its details
 * @param keys - The keys of its rows drawn
 * @param weighedRows - How weighed details are read by key
 * @returns The rows' bytes and their picked entries, in flight, or why the read failed
 */
function readWeighed(kind: FlowchartDetailsKind, weighed: FlowchartWeighedValue, keys: readonly string[], weighedRows: FlowchartWeighedRows): KindRead {
    const paged = getSomeorUndefined(kind.details.paged);
    if (paged === undefined) throw new Error("The details the rail's picks weigh name no paged read");
    const keyed = kind.keys ?? STRING_KEYS;
    const part = kind.weighing;
    const where = part?.read().where;
    // Two bindings of different records of one type: the source's picks are of another record's rows.
    const recordId = indexedBindingOf(paged)?.recordId;
    const apart = part !== undefined && recordId !== undefined && !sameString(part.sourceId, recordId);
    const choice = apart ? undefined : where?.get(weighed.field);
    const picks = choice?.type === "values" ? choice.value : [];
    if (keys.length === 0) return { rows: NO_BYTES, error: undefined, weighed: { picks, entries: NO_ENTRIES, apart } };
    // In flight, the picks asked: picks that moved draw the reads they weigh as placeholders until their ranges land (R44).
    const flight: KindRead = { rows: undefined, error: undefined, weighed: { picks, entries: NO_ENTRIES, apart } };
    const got = weighedRows(paged, weighed, picks, keys, keyed);
    if (got.type === "none") return flight;
    let rows = got.value.rows;
    const others = apart || where === undefined || part === undefined ? undefined : withoutField(where, weighed.field);
    if (others !== undefined && others.size > 0) {
        // The source's other fields narrow the details' rows: each drawn row asked of them, at its key, in one read.
        const asked = keys.flatMap((key) => {
            const row = got.value.lean.get(key);
            return row === undefined ? [] : [{ key, row }];
        });
        const within = asked.length === 0 ? some([] as boolean[])
            : recordSliceWithin(part!, others, asked.map(({ key, row }) => ({ key: keyed.keyOf(key), row })));
        if (within.type === "none") return flight;
        const kept = new Map(rows);
        asked.forEach(({ key }, i) => {
            if (within.value[i] !== true) kept.set(key, null);
        });
        rows = kept;
    }
    return { rows, error: undefined, weighed: { picks, entries: got.value.entries, apart } };
}

/**
 * One kind's details, read as the kind is (R19): whole — every drawn key
 * matched to the record's rows — or by the drawn keys, in one request; or,
 * weighed by the rail's picks, by key whatever the kind's read (#1522).
 *
 * @param kind - The kind
 * @param keys - The keys of its rows drawn
 * @param paged - How a paged read answers keys
 * @param weighedRows - How weighed details are read by key
 * @returns The rows' bytes, in flight, or why the read failed
 */
function readKind(kind: FlowchartDetailsKind, keys: readonly string[], paged: FlowchartPagedRows, weighedRows: FlowchartWeighedRows): KindRead {
    const details = kind.details;
    try {
        const weighed = getSomeorUndefined(details.weighed);
        if (weighed !== undefined) return readWeighed(kind, weighed, keys, weighedRows);
        const whole = getSomeorUndefined(details.rows);
        if (whole !== undefined) {
            const got = whole();
            if (got.type === "none") return IN_FLIGHT;
            const rows = new Map<string, Uint8Array | null>();
            for (const key of keys) rows.set(key, got.value.get(key) ?? null);
            return { rows, error: undefined };
        }
        const id = getSomeorUndefined(details.paged);
        if (keys.length === 0) return { rows: NO_BYTES, error: undefined };
        if (id === undefined) return { rows: new Map(keys.map((key) => [key, null] as const)), error: undefined };
        const got = paged(id, keys, kind.keys ?? STRING_KEYS);
        return got.type === "none" ? IN_FLIGHT : { rows: got.value, error: undefined };
    } catch (error) {
        return { rows: undefined, error: messageOf(error) };
    }
}

/**
 * How the rail's picks weigh one kind's details (#1522): the picks as they
 * stand, and the rows holding them as the last settled read found them.
 */
export interface FlowchartWeighedRead {
    /** The picks, as `.east` literals of the Dict's keys: none, and every read draws the row's own. */
    readonly picks: readonly string[];
    /** The drawn rows holding a pick, as the last settled read found them: a row holding none says *no data* in the reads the picks weigh. */
    readonly holding: ReadonlySet<string>;
    /** Whether the rail's source narrows another record than the details read: Issues lists it, and every read draws the row's own. */
    readonly apart: boolean;
    /** Whether the picks moved since the last settled read and their ranges are in flight: the reads they weigh draw their placeholder (R44). */
    readonly pending: boolean;
}

/** What the details read holds of one kind. */
export interface FlowchartDetailsRead {
    /**
     * Each drawn row's values the last settled read holds, by key — `null` for a key the details hold no row of, which
     * draws *no data* (R33). A key no settled read asked of is absent: its card draws a placeholder (R34).
     */
    readonly rows: ReadonlyMap<string, FlowchartDetailRowValue | null>;
    /** Whether a read is in flight, the last settled one standing in meanwhile. */
    readonly reading: boolean;
    /** Why the latest read failed, said once in the canvas's box (R34); what the last settled read held stands. */
    readonly error: string | undefined;
    /** How the rail's picks weigh them, as the last settled read found it (#1522); `undefined` for details none weighs. */
    readonly weighed?: FlowchartWeighedRead | undefined;
}

/** What the details read holds, by kind: `undefined` for a kind with no details. */
export interface FlowchartDetailsData {
    /** The states' details. */
    readonly states: FlowchartDetailsRead | undefined;
    /** The transitions' details. */
    readonly transitions: FlowchartDetailsRead | undefined;
}

/** The frame's details before the reader first reports: every kind's in flight. */
export const NO_DETAILS: FlowchartDetailsData = { states: undefined, transitions: undefined };

/** No row held. */
const NO_ROWS: ReadonlyMap<string, never> = new Map<string, never>();

/** Two reasons the same, or both none. */
function sameError(a: string | undefined, b: string | undefined): boolean {
    return a === undefined || b === undefined ? a === b : sameString(a, b);
}

/** A kind's rows' values as they were, where every key holds the same as it did. */
function steadyRows(
    was: ReadonlyMap<string, FlowchartDetailRowValue | null>,
    now: ReadonlyMap<string, FlowchartDetailRowValue | null>,
): ReadonlyMap<string, FlowchartDetailRowValue | null> {
    if (was.size !== now.size) return now;
    for (const [key, row] of now) {
        if (!was.has(key) || !Object.is(was.get(key), row)) return now;
    }
    return was;
}

/** Two lists of entries' bytes the same, entry by entry. */
function sameEntries(a: readonly Uint8Array[], b: readonly Uint8Array[]): boolean {
    return a.length === b.length && a.every((bytes, i) => sameBytes(bytes, b[i]!));
}

/** Two lists of picks the same, pick by pick. */
function samePicks(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((pick, i) => sameString(pick, b[i]!));
}

/** The same weighing as before, where nothing in it moved. */
function steadyWeighed(was: FlowchartWeighedRead | undefined, now: FlowchartWeighedRead): FlowchartWeighedRead {
    if (was === undefined || was.apart !== now.apart || was.pending !== now.pending || !samePicks(was.picks, now.picks) || was.holding.size !== now.holding.size) return now;
    for (const key of now.holding) if (!was.holding.has(key)) return now;
    return was;
}

/** Whether a read in flight asks other picks than the last settled read weighed by — or picks of a record it now reads apart from. */
function picksMoved(asked: WeighedRead | undefined, settled: FlowchartWeighedRead | undefined): boolean {
    return asked !== undefined && settled !== undefined && (asked.apart !== settled.apart || !samePicks(asked.picks, settled.picks));
}

/** No entries a row holds: its row's own values. */
const OWN: readonly Uint8Array[] = [];

/**
 * One kind's details across reads: each row's values worked out once for its
 * bytes — and, weighed, its picked entries' — the last settled rows standing
 * while a newer read is in flight or fails, and the same objects while nothing
 * moves.
 */
class KindDetails {
    /** The `values` the rows were worked out by: another payload's works them out afresh. */
    private by: FlowchartDetailsValue["values"] | undefined;
    /** Each row's values, by key, beside the bytes and the picked entries they came from. */
    private worked = new Map<string, { readonly bytes: Uint8Array; readonly entries: readonly Uint8Array[]; readonly row: FlowchartDetailRowValue }>();
    /** The read last taken, and what came of it: the same read taken again moves nothing. */
    private taken: {
        readonly read: KindRead; readonly rows: ReadonlyMap<string, FlowchartDetailRowValue | null>; readonly error: string | undefined;
        readonly weighed: FlowchartWeighedRead | undefined;
    } | undefined;
    /** The rows the last settled read held. */
    private settled: ReadonlyMap<string, FlowchartDetailRowValue | null> = NO_ROWS;
    /** How the picks weighed them, as the last settled read found it. */
    private settledWeighed: FlowchartWeighedRead | undefined;
    /** The picks in flight, as last handed out: the same picks in flight hand out the same object. */
    private pendingWeighed: FlowchartWeighedRead | undefined;
    /** What was handed out last. */
    private last: FlowchartDetailsRead | undefined;

    /**
     * Takes one read.
     *
     * @param details - The kind's details
     * @param read - What the read found
     * @returns What the kind's details hold now
     */
    take(details: FlowchartDetailsValue, read: KindRead): FlowchartDetailsRead {
        if (!Object.is(this.by, details.values)) {
            this.by = details.values;
            this.worked = new Map();
            this.taken = undefined;
        }
        const fold = getSomeorUndefined(details.weighed)?.fold;
        let rows = this.settled;
        let weighed = this.settledWeighed;
        let error = read.error;
        if (this.taken !== undefined && Object.is(this.taken.read, read)) {
            rows = this.taken.rows;
            error = this.taken.error;
            weighed = this.taken.weighed;
        } else if (read.rows !== undefined) {
            try {
                const next = new Map<string, FlowchartDetailRowValue | null>();
                const worked = new Map<string, { readonly bytes: Uint8Array; readonly entries: readonly Uint8Array[]; readonly row: FlowchartDetailRowValue }>();
                const holding = new Set<string>();
                const picked = read.weighed !== undefined && read.weighed.picks.length > 0 && !read.weighed.apart;
                for (const [key, bytes] of read.rows) {
                    if (bytes === null) {
                        next.set(key, null);
                        continue;
                    }
                    // Weighed by the picks, a row holding some draws them added up; one holding none, its own (R45).
                    const entries = picked ? read.weighed!.entries.get(key) ?? OWN : OWN;
                    if (entries.length > 0) holding.add(key);
                    const held = this.worked.get(key);
                    const row = held !== undefined && sameBytes(held.bytes, bytes) && sameEntries(held.entries, entries) ? held.row
                        : entries.length > 0 && fold !== undefined ? fold(bytes, [...entries]) : details.values(bytes);
                    worked.set(key, { bytes, entries, row });
                    next.set(key, row);
                }
                this.worked = worked;
                rows = this.settled = steadyRows(this.settled, next);
                weighed = this.settledWeighed = read.weighed === undefined ? undefined
                    : steadyWeighed(this.settledWeighed, { picks: read.weighed.picks, holding, apart: read.weighed.apart, pending: false });
            } catch (failure) {
                error = messageOf(failure);
            }
            this.taken = { read, rows, error, weighed };
        }
        const reading = read.rows === undefined && read.error === undefined;
        // Picks that moved, in flight: the reads they weigh wait for their ranges, the rows they hold as last settled.
        if (reading && picksMoved(read.weighed, weighed)) {
            weighed = this.pendingWeighed = steadyWeighed(this.pendingWeighed, { picks: read.weighed!.picks, holding: weighed!.holding, apart: read.weighed!.apart, pending: true });
        }
        const last = this.last;
        if (last !== undefined && Object.is(last.rows, rows) && last.reading === reading && sameError(last.error, error) && Object.is(last.weighed, weighed)) {
            return last;
        }
        this.last = weighed === undefined ? { rows, reading, error } : { rows, reading, error, weighed };
        return this.last;
    }
}

/**
 * Reads the details (see the module docs): each kind's beside its kind, by the
 * rows drawn.
 *
 * @param kinds - The kinds carrying details
 * @param drawn - The keys of the rows drawn
 * @param attempt - Moves to read every kind afresh: a Retry
 * @param paged - How a paged read answers keys: `pagedDetailRows`, unless a test gives its own
 * @param weighedRows - How weighed details are read by key: `weighedDetailRows`, unless a test gives its own
 * @returns What the details read holds
 */
export function useFlowchartDetails(
    kinds: FlowchartDetailsKinds, drawn: FlowchartDrawnKeys, attempt = 0, paged: FlowchartPagedRows = pagedDetailRows,
    weighedRows: FlowchartWeighedRows = weighedDetailRows,
): FlowchartDetailsData {
    const states = kinds.states;
    const transitions = kinds.transitions;
    const read = useCallback(() => {
        // A Retry reads every kind again.
        void attempt;
        return {
            states: states === undefined ? undefined : readKind(states, drawn.states, paged, weighedRows),
            transitions: transitions === undefined ? undefined : readKind(transitions, drawn.transitions, paged, weighedRows),
        };
    }, [states, transitions, drawn, paged, weighedRows, attempt]);
    const { result } = useTrackedEvaluation(read);
    const holders = useRef<{ readonly states: KindDetails; readonly transitions: KindDetails } | undefined>(undefined);
    holders.current ??= { states: new KindDetails(), transitions: new KindDetails() };
    const held = holders.current;
    const failed: KindRead | undefined = result.ok ? undefined : { rows: undefined, error: messageOf(result.error) };
    const statesRead = states === undefined ? undefined
        : held.states.take(states.details, failed ?? (result.ok ? result.value.states : undefined) ?? IN_FLIGHT);
    const transitionsRead = transitions === undefined ? undefined
        : held.transitions.take(transitions.details, failed ?? (result.ok ? result.value.transitions : undefined) ?? IN_FLIGHT);
    return useMemo((): FlowchartDetailsData => ({ states: statesRead, transitions: transitionsRead }), [statesRead, transitionsRead]);
}

/**
 * The details' reads, in a component of their own, as the records' are
 * (`read.ts`): each read that lands renders it again alone, and it hands the
 * frame what it read only when that moves.
 *
 * @param props - The kinds carrying details, the keys of the rows drawn, the read's attempt, and where the details go
 * @returns Nothing: it reads
 */
export function FlowchartDetailsReader({ kinds, drawn, attempt, onDetails }: {
    kinds: FlowchartDetailsKinds; drawn: FlowchartDrawnKeys; attempt: number; onDetails: (details: FlowchartDetailsData) => void;
}): null {
    const details = useFlowchartDetails(kinds, drawn, attempt);
    const reported = useRef<FlowchartDetailsData | undefined>(undefined);
    useEffect(() => {
        if (Object.is(reported.current, details)) return;
        reported.current = details;
        onDetails(details);
    });
    return null;
}

// ============================================================================
// The flowchart's bins
// ============================================================================

/** A histogram read's bins, shared by every card that draws it (R26). */
export interface FlowchartBins {
    /**
     * Its edges, ascending and finite: the app's, else every drawn row's edges merged — none while no row counts
     * anything. Each bin reaches from its edge to the next; the last is open.
     */
    readonly edges: readonly number[];
    /** How its bars space them. */
    readonly scale: "band" | "linear";
}

/** A histogram's counts in the flowchart's bins (R27). */
export interface FlowchartBinCounts {
    /** Each bin's count, in the bins' order. */
    readonly counts: readonly number[];
    /** What they count, together. */
    readonly total: number;
    /** Whether a count fell in no bin: one at no edge, or one that is no count — negative, or not finite. */
    readonly unheld: boolean;
}

/** Why the bins the app binds are refused (R27), as found. */
export type FlowchartBinsRefusal =
    | { readonly why: "empty" }
    | { readonly why: "number"; readonly edge: number }
    | { readonly why: "order"; readonly before: number; readonly after: number };

/** Why, in the app's locale: what Issues says. */
export type FlowchartBinsRefusalWord =
    | { readonly why: "empty" }
    | { readonly why: "number"; readonly edge: string }
    | { readonly why: "order"; readonly before: string; readonly after: string };

/**
 * The bins the app binds, checked as they land (R27) — as a literal's are
 * when built.
 *
 * @param edges - The edges
 * @returns Why they are refused — none given, an edge that is no finite number, or the first two that do not ascend; `undefined` for none
 */
export function binsRefusal(edges: readonly number[]): FlowchartBinsRefusal | undefined {
    if (edges.length === 0) return { why: "empty" };
    for (const edge of edges) if (!Number.isFinite(edge)) return { why: "number", edge };
    for (let i = 1; i < edges.length; i++) {
        if (!lessFloat(edges[i - 1]!, edges[i]!)) return { why: "order", before: edges[i - 1]!, after: edges[i]! };
    }
    return undefined;
}

/**
 * The bin that holds a duration (R27): the last whose edge it is at or past —
 * one under the first edge in the first.
 *
 * @param edges - The bins' edges, ascending
 * @param at - The duration, a number
 * @returns The bin's place
 */
function binOf(edges: readonly number[], at: number): number {
    let lo = 0;
    let hi = edges.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lessFloat(at, edges[mid]!)) hi = mid - 1;
        else lo = mid;
    }
    return lo;
}

/**
 * A row's histogram counted into the flowchart's bins (R27): each count in the
 * bin that holds its edge, one under the first edge in the first — an Array's
 * each at its own bin's edge, so a bin each.
 *
 * @param value - The row's histogram: its counts, each at an edge
 * @param edges - The flowchart's bins' edges, ascending
 * @returns Each bin's count, their total, and whether a count fell in no bin
 */
export function countIntoBins(value: HistogramValue, edges: readonly number[]): FlowchartBinCounts {
    const counts = edges.map(() => 0);
    let total = 0;
    let unheld = false;
    for (const bin of value) {
        // At no edge — NaN, an Array of another length than its bins — or no count: no bin holds it.
        if (edges.length === 0 || Number.isNaN(bin.from) || !Number.isFinite(bin.count) || lessFloat(bin.count, 0)) {
            unheld = true;
            continue;
        }
        const at = binOf(edges, bin.from);
        counts[at] = counts[at]! + bin.count;
        total += bin.count;
    }
    return { counts, total, unheld };
}

/**
 * The edges of every drawn row's histogram at a read, merged (R26): the bins
 * the rows share where the app gives none.
 *
 * @param keys - The rows drawn
 * @param rows - Their values
 * @param index - The read's place
 * @param skipOf - Which of a row's reads count nothing: those saying *no data*, where the rail's picks weigh a row holding none of them,
 *   and those waiting on picks that moved (#1522)
 * @returns The finite edges, ascending, each once
 */
function mergedEdges(
    keys: readonly string[], rows: ReadonlyMap<string, FlowchartDetailRowValue | null>, index: number, skipOf: (key: string) => readonly boolean[],
): number[] {
    const edges = new SortedSet<number>([], compareFloat);
    for (const key of keys) {
        if (skipOf(key)[index] === true) continue;
        const value = rows.get(key)?.[index];
        if (value?.type !== "histogram") continue;
        for (const bin of value.value) if (Number.isFinite(bin.from)) edges.add(bin.from);
    }
    return [...edges];
}

// ============================================================================
// Bars and the axis
// ============================================================================

/** One bar, across its axis: where it starts and ends, and how tall it is — each a share of the axis and of the card's tallest bar. */
export interface FlowchartBar {
    /** Where it starts, from 0 at the axis's start to 1 at its end. */
    readonly from: number;
    /** Where it ends. */
    readonly to: number;
    /** How tall it is, the card's tallest 1. */
    readonly height: number;
    /** What it counts. */
    readonly count: number;
}

/**
 * Each bin's span as a linear axis draws it: to the next edge, the open last as
 * wide as the one before it — one bin alone the whole axis.
 */
function spansOf(edges: readonly number[]): number[] {
    const n = edges.length;
    return edges.map((edge, i) => (i < n - 1 ? edges[i + 1]! - edge : n > 1 ? edge - edges[n - 2]! : 1));
}

/**
 * A card's bars over the flowchart's bins (R26): on a band axis a bar a bin,
 * equal widths, as tall as its count; on a linear axis each as wide as its span
 * and as tall as its count over it, so its area is its count, the open last
 * bin as wide as the one before it. Scaled to the card's tallest.
 *
 * @param bins - The flowchart's bins
 * @param counts - The card's count in each
 * @returns Each bin's bar, in order
 */
export function barsOf(bins: FlowchartBins, counts: readonly number[]): FlowchartBar[] {
    const n = bins.edges.length;
    if (n === 0) return [];
    const spans = spansOf(bins.edges);
    const extent = spans.reduce((sum, span) => sum + span, 0);
    const linear = bins.scale === "linear";
    const heights = counts.map((count, i) => (linear ? count / spans[i]! : count));
    const tallest = heights.reduce((max, h) => Math.max(max, h), 0);
    let at = 0;
    return counts.map((count, i) => {
        const width = linear ? spans[i]! / extent : 1 / n;
        const from = linear ? at : i / n;
        at += width;
        return { from, to: from + width, height: tallest > 0 ? heights[i]! / tallest : 0, count };
    });
}

/**
 * Where a duration sits across the axis (R26, R28): on a band axis, as far
 * across its bin as it is across its span — the open last bin as wide as the
 * one before it; on a linear axis, to scale. Under the first edge, the axis's
 * start; past the end, the end.
 *
 * @param bins - The flowchart's bins
 * @param at - The duration
 * @returns Its place, from 0 at the axis's start to 1 at its end
 */
export function axisAt(bins: FlowchartBins, at: number): number {
    const { edges } = bins;
    const n = edges.length;
    if (n === 0 || Number.isNaN(at) || lessFloat(at, edges[0]!)) return 0;
    const spans = spansOf(edges);
    if (bins.scale === "linear") {
        const extent = spans.reduce((sum, span) => sum + span, 0);
        return Math.min(1, (at - edges[0]!) / extent);
    }
    const bin = binOf(edges, at);
    return Math.min(1, (bin + Math.min(1, (at - edges[bin]!) / spans[bin]!)) / n);
}

// ============================================================================
// The details model
// ============================================================================

/** One row's details: its values, one a read, and each histogram's counts in the flowchart's bins. */
export interface FlowchartRowDetails {
    /** Its values, one a read, in the reads' order. */
    readonly values: FlowchartDetailRowValue;
    /** Each read's counts, by its place: a histogram's in its bins; `undefined` where its bins are refused, and for every other read. */
    readonly counts: readonly (FlowchartBinCounts | undefined)[];
    /** Whether each read says *no data*, by its place: one the rail's picks weigh, of a row holding none of them (#1522, R45). */
    readonly noData: readonly boolean[];
    /** Whether each read draws its placeholder, by its place: one the rail's picks weigh, while the ranges of picks that moved are in flight (#1522, R44). */
    readonly pending: readonly boolean[];
}

/**
 * A row's value at a read, as the canvas, a label and the inspector draw it:
 * `undefined` where it says *no data* — a read the rail's picks weigh, of a
 * row holding none of them (#1522, R45) — and where it waits on picks that
 * moved (R44).
 *
 * @param row - The row's details
 * @param index - The read's place
 * @returns Its value; `undefined` for *no data*, and while it waits
 */
export function valueAt(row: FlowchartRowDetails | undefined, index: number): FlowchartDetailRowValue[number] | undefined {
    return row === undefined || row.noData[index] === true || row.pending[index] === true ? undefined : row.values[index];
}

/**
 * Whether a row's read draws its placeholder: its row not landed (R34), or a
 * read the rail's picks weigh while the ranges of picks that moved are in
 * flight (#1522, R44).
 *
 * @param row - The row's details; `undefined` while it lands
 * @param index - The read's place
 * @returns Whether it waits
 */
export function waitsAt(row: FlowchartRowDetails | undefined, index: number): boolean {
    return row === undefined || row.pending[index] === true;
}

/** The line the inspector names the rail's picks in (#1522, R46): the field, as the rail names it, and the picks. */
export interface FlowchartWeighedLine {
    /** The field, as the rail labels it — `Service`. */
    readonly label: string;
    /** The picks, as the rail names them — `Standard, Priority`. */
    readonly picks: string;
}

/** One kind's details, as the canvas, the inspector and Issues draw them. */
export interface FlowchartKindDetails {
    /** Its reads, in the details' order: each described, and where it shows. */
    readonly reads: FlowchartDetailsValue["reads"];
    /** Whether a read shows on the canvas: a state's card is then 272 wide, its reads under its head (R22). */
    readonly onCanvas: boolean;
    /** Each read's bins, by its place: a histogram's; `undefined` for one whose bins the app binds are refused, and for every other read. */
    readonly bins: readonly (FlowchartBins | undefined)[];
    /** Each drawn row's details, by key: `null` for a key the details hold no row of; a key absent has not landed. */
    readonly rows: ReadonlyMap<string, FlowchartRowDetails | null>;
    /** Whether a read is in flight. */
    readonly reading: boolean;
    /** Why the latest read failed. */
    readonly error: string | undefined;
    /** The rail's picks that weigh them, as the inspector names them (#1522, R46); `undefined` with no pick, and for details none weighs. */
    readonly weighedBy: FlowchartWeighedLine | undefined;
}

/** What Issues lists of the details (R38). */
export type FlowchartDetailsFinding =
    /** A row's histogram holding counts no bin holds, by the row's kind and key and the read's label. */
    | { readonly finding: "counts"; readonly sort: FlowchartDetailsSort; readonly key: string; readonly read: string }
    /** A histogram's bins, as the app binds them, refused: by the kind's name and the read's label, and why. */
    | { readonly finding: "bins"; readonly sort: FlowchartDetailsSort; readonly kind: string; readonly read: string; readonly refusal: FlowchartBinsRefusalWord }
    /** The rail's source whose picks weigh a kind's details narrowing another record than they read (#1522): by the kind's name and the source. */
    | { readonly finding: "weighed"; readonly sort: FlowchartDetailsSort; readonly kind: string; readonly source: string };

/** The details model: each kind's, and what Issues lists. */
export interface FlowchartDetailsModel {
    /** The states' details; `undefined` for states with none. */
    readonly states: FlowchartKindDetails | undefined;
    /** The transitions' details. */
    readonly transitions: FlowchartKindDetails | undefined;
    /** What Issues lists: each kind's refused bins, in the reads' order, then its rows' counts no bin holds, in key order. */
    readonly findings: readonly FlowchartDetailsFinding[];
}

/** A read's label. */
function labelOf(read: FlowchartReadValue): string {
    return read.value.label;
}

/**
 * The line naming the rail's picks (#1522, R46): the field as the rail labels
 * it, and the picks as the rail names them — the field's own name where the
 * source offers no such field.
 *
 * @param part - The source's part of the rail
 * @param field - The Dict field the entries index files
 * @param picks - The picks, as `.east` literals of its keys
 * @param words - The app's formatters
 * @returns The line
 */
function weighedLineOf(part: FlowchartSlicePart | undefined, field: string, picks: readonly string[], words: Formatters): FlowchartWeighedLine {
    const offered = part?.config.fields.find((candidate) => sameString(candidate.fieldId, field));
    if (offered === undefined) return { label: field, picks: picks.join(", ") };
    return { label: offered.label, picks: recordChoiceSummary(offered, variant("values", [...picks]), words) };
}

/** Why the bins are refused, its numbers in the app's locale. */
function refusalWord(refusal: FlowchartBinsRefusal, words: Formatters): FlowchartBinsRefusalWord {
    switch (refusal.why) {
        case "empty": return refusal;
        case "number": return { why: "number", edge: words.number(refusal.edge) };
        case "order": return { why: "order", before: words.number(refusal.before), after: words.number(refusal.after) };
    }
}

/**
 * The details model (see the module docs): each kind's reads, its
 * histograms' bins, each drawn row's values counted into them, and what Issues
 * lists. Pure.
 *
 * @param kinds - The kinds carrying details
 * @param data - What the details read holds
 * @param drawn - The keys of the rows drawn
 * @param words - The formatters: Issues' numbers in the app's locale
 * @returns The model
 */
export function flowchartDetailsModel(kinds: FlowchartDetailsKinds, data: FlowchartDetailsData, drawn: FlowchartDrawnKeys, words: Formatters): FlowchartDetailsModel {
    const findings: FlowchartDetailsFinding[] = [];
    const kind = (sort: FlowchartDetailsSort, given: FlowchartDetailsKind | undefined, read: FlowchartDetailsRead | undefined): FlowchartKindDetails | undefined => {
        if (given === undefined) return undefined;
        const { name, details } = given;
        const keys = sort === "states" ? drawn.states : drawn.transitions;
        const held = read?.rows ?? NO_ROWS;
        const reads = details.reads;
        // Weighed by the rail's picks (#1522): a row holding none says no data in the reads the picks weigh.
        const weighed = getSomeorUndefined(details.weighed);
        const picked = read?.weighed;
        if (weighed !== undefined && picked?.apart === true) findings.push({ finding: "weighed", sort, kind: name, source: weighed.source });
        const weighing = weighed !== undefined && picked !== undefined && picked.picks.length > 0 && !picked.apart;
        const pending = weighed !== undefined && picked?.pending === true ? weighed.reads : undefined;
        const own = reads.map(() => false);
        // Picks in flight: the reads they weigh wait, whatever the rows held of the picks before.
        const noDataOf = (key: string): readonly boolean[] => (weighing && pending === undefined && !picked!.holding.has(key) ? weighed!.reads : own);
        const skipOf = (key: string): readonly boolean[] => pending ?? noDataOf(key);
        const bins = reads.map((entry, i): FlowchartBins | undefined => {
            if (entry.read.type !== "histogram") return undefined;
            const histogram = entry.read.value;
            const given = getSomeorUndefined(histogram.bins);
            if (given === undefined) return { edges: mergedEdges(keys, held, i, skipOf), scale: histogram.scale.type };
            const refusal = binsRefusal(given);
            if (refusal === undefined) return { edges: given, scale: histogram.scale.type };
            findings.push({ finding: "bins", sort, kind: name, read: histogram.label, refusal: refusalWord(refusal, words) });
            return undefined;
        });
        const rows = new Map<string, FlowchartRowDetails | null>();
        for (const key of keys) {
            const row = held.get(key);
            if (row === undefined) continue;
            if (row === null) {
                rows.set(key, null);
                continue;
            }
            const noData = noDataOf(key);
            const skip = skipOf(key);
            const counts = reads.map((_entry, i) => {
                const edges = bins[i]?.edges;
                const at = skip[i] === true ? undefined : row[i];
                return edges === undefined || at?.type !== "histogram" ? undefined : countIntoBins(at.value, edges);
            });
            reads.forEach((entry, i) => {
                if (counts[i]?.unheld === true) findings.push({ finding: "counts", sort, key, read: labelOf(entry.read) });
            });
            rows.set(key, { values: row, counts, noData, pending: pending ?? own });
        }
        return {
            reads, onCanvas: reads.some((entry) => entry.show.type !== "inspector"), bins, rows,
            reading: read === undefined || read.reading, error: read?.error,
            weighedBy: weighing ? weighedLineOf(given.weighing, weighed!.field, picked!.picks, words) : undefined,
        };
    };
    const states = kind("states", kinds.states, data.states);
    const transitions = kind("transitions", kinds.transitions, data.transitions);
    return { states, transitions, findings };
}

// ============================================================================
// Each card's size
// ============================================================================

/** A card's width where its details draw on it (R22): 116 without. */
export const DETAILS_CARD_W = 272;

/** The card's edge, top and bottom. */
const CARD_EDGE = 1;
/** The card's head inside its edge — the label over the key 4 apart, 12 in from either side: 56 with its edges, the visual spec's. */
const CARD_HEAD = 54;
/** The rule under the head. */
const CARD_RULE = 1;
/** The body's padding, on every side. */
const CARD_PAD = 12;
/** Between two reads. */
const READ_GAP = 12;
/** What the reads draw across: the card inside its edges and its padding — a card's bars and their axis span it. */
export const DETAILS_INNER_W = DETAILS_CARD_W - 2 * CARD_EDGE - 2 * CARD_PAD;
/** The card's head with its top edge and the rule under it: where an editor renaming the state sits. */
export const DETAILS_HEAD_H = CARD_EDGE + CARD_HEAD + CARD_RULE;
/** A figure's line — and *no data* in its place. */
const FIGURE_H = 16;
/** A line of tags — and *no data* or *none* in its place. */
const TAG_H = 15;
/** Between two lines of tags, and between two tags. */
const TAG_GAP = 4;
/** A tag list's lines at most: then +n. */
const TAG_LINES = 3;
/** Between a tag list's label column and its tags. */
const TAG_LABEL_GAP = 8;
/** A read's title, over its bars or its list. */
const TITLE_H = 14;
/** Between a title and what it is over, between the bars and their axis, and between a list's rows. */
const BLOCK_GAP = 4;
/** The bars on a card. */
const BARS_H = 28;
/** Their axis. */
const AXIS_H = 12;
/** A list's row. */
const LIST_ROW_H = 16;
/** *No data* or *none* under a title. */
const NO_DATA_H = 16;

/** How wide a card's words draw, in px: a read's label in a tag list's label column, and a tag — its padding and rule in. */
export interface FlowchartTextMeasure {
    /** A read's label, as the label column draws it. */
    readonly label: (text: string) => number;
    /** A tag, as a card draws it — and the +n that ends a list cut short. */
    readonly tag: (text: string) => number;
}

/** A label's width a character, the visual spec's: mono 9.5, 600, 0.14em apart, in capitals. */
const LABEL_CHAR = 7.33;
/** A tag's width a character, the visual spec's: mono 9.5, 500. */
const TAG_CHAR = 6;
/** A tag's padding, 4 either side, and its 1px rule. */
const TAG_PAD = 10;

/** The estimate where nothing measures — a test's, or a layout before the card draws: the visual spec's type, a character at a time. */
export const ESTIMATED_TEXT: FlowchartTextMeasure = {
    label: (text) => LABEL_CHAR * [...text].length,
    tag: (text) => TAG_CHAR * [...text].length + TAG_PAD,
};

/** One line of a card's list (R29): an item, its share of the list's total, and its note. */
export interface FlowchartListLine {
    /** The item's name. */
    readonly name: string;
    /** Its value. */
    readonly value: number;
    /** Its share of the list's total, 0 to 1. */
    readonly share: number;
    /** Its note, from its draw. */
    readonly note: string | undefined;
}

/** What a card draws of one read. */
export type FlowchartCardDraws =
    /** Its row has not landed: a placeholder (R34). */
    | { readonly kind: "placeholder" }
    /** No row, or nothing to show: *no data* (R33, R41). */
    | { readonly kind: "noData" }
    /** A figure's value. */
    | { readonly kind: "figure"; readonly value: number }
    /** A tag list's lines — none: *none* — and the tags past its third, behind +n. */
    | { readonly kind: "tags"; readonly lines: readonly (readonly string[])[]; readonly rest: readonly string[] }
    /** A histogram's bars. */
    | { readonly kind: "bars"; readonly bars: readonly FlowchartBar[] }
    /** A list's top lines — none: *none*. */
    | { readonly kind: "list"; readonly lines: readonly FlowchartListLine[] };

/** One read a card shows, in its block. */
export interface FlowchartCardRead {
    /** Its place in the details' order. */
    readonly index: number;
    /** Its block's top, from the card's. */
    readonly top: number;
    /** Its block's height. */
    readonly height: number;
    /** A tag list's label column, the widest label of the tag lists it stands among; `undefined` for any other read. */
    readonly column: number | undefined;
    /** What it draws. */
    readonly draws: FlowchartCardDraws;
}

/** A state's card where its details draw (R22): its size, and each read it shows in its block. */
export interface FlowchartCard {
    /** Its width. */
    readonly width: number;
    /** Its height: its head, a rule, then its reads 12 apart inside 12 of padding. */
    readonly height: number;
    /** The reads it shows, in the details' order. */
    readonly reads: readonly FlowchartCardRead[];
}

/** A placeholder, while the row lands. */
const PLACEHOLDER: FlowchartCardDraws = { kind: "placeholder" };
/** *No data*. */
const NO_DATA: FlowchartCardDraws = { kind: "noData" };

/**
 * A list's lines on the canvas, as its read gives them (R29): 1 to 3.
 *
 * @param read - The list read
 * @returns How many lines it draws on a card or a label
 */
export function listTopOf(read: Extract<FlowchartReadValue, { type: "list" }>["value"]): number {
    return Math.min(3, Math.max(1, Number(read.top)));
}

/**
 * A list's top lines by value (R29): its items by value, highest first — ties
 * in the row's order — each with its share of the list's total.
 *
 * @param items - The row's items
 * @param top - How many lines
 * @returns The lines
 */
export function listLines(items: ListValue, top: number): FlowchartListLine[] {
    const counts = (n: number): boolean => Number.isFinite(n) && !lessFloat(n, 0);
    const total = items.reduce((sum, item) => sum + (counts(item.value) ? item.value : 0), 0);
    return [...items].sort((a, b) => compareFloat(b.value, a.value)).slice(0, top).map((item) => ({
        name: item.name, value: item.value, share: total > 0 && counts(item.value) ? item.value / total : 0, note: getSomeorUndefined(item.note),
    }));
}

/**
 * A row's tags in the order their looks are defined, then the rest in the
 * row's order (R30): each once — as a card, the inspector and the legend show
 * them.
 *
 * @param colors - The read's looks
 * @param tags - The row's tags
 * @returns The tags, in that order
 */
export function orderedTags(colors: FlowchartTagColors, tags: readonly string[]): string[] {
    const held = new SortedSet<string>(tags, compareKey);
    const placed = new SortedSet<string>([], compareKey);
    const out: string[] = [];
    const place = (tag: string) => {
        if (placed.has(tag)) return;
        placed.add(tag);
        out.push(tag);
    };
    for (const color of colors) if (held.has(color.tag)) place(color.tag);
    for (const tag of tags) place(tag);
    return out;
}

/**
 * A tag list's lines across its width (R30): wrapping, three lines at most —
 * then the third ends in +n, a tag at a time leaving it until the +n fits.
 *
 * @param tags - The tags, in their order
 * @param width - The width beside the label column
 * @param measure - How wide a tag draws
 * @returns The lines, and the tags past them
 */
function tagLines(tags: readonly string[], width: number, measure: FlowchartTextMeasure): { lines: string[][]; rest: string[] } {
    const lines: string[][] = [];
    let line: string[] = [];
    let x = 0;
    for (const tag of tags) {
        const w = measure.tag(tag);
        if (line.length > 0 && x + TAG_GAP + w > width) {
            lines.push(line);
            line = [];
        }
        x = line.length === 0 ? w : x + TAG_GAP + w;
        line.push(tag);
    }
    if (line.length > 0) lines.push(line);
    if (lines.length <= TAG_LINES) return { lines, rest: [] };
    const kept = lines.slice(0, TAG_LINES);
    const rest = lines.slice(TAG_LINES).flat();
    const last = kept[TAG_LINES - 1]!;
    const across = (tagsOf: readonly string[]) => tagsOf.reduce((sum, tag, i) => sum + (i > 0 ? TAG_GAP : 0) + measure.tag(tag), 0);
    while (last.length > 0 && across(last) + TAG_GAP + measure.tag(`+${rest.length}`) > width) rest.unshift(last.pop()!);
    return { lines: kept, rest };
}

/** What a card draws of one read, its row's values given. */
function drawsOf(
    read: FlowchartReadValue, index: number, row: FlowchartRowDetails | null | undefined, kind: FlowchartKindDetails,
    column: number, measure: FlowchartTextMeasure,
): FlowchartCardDraws {
    if (row === undefined) return PLACEHOLDER;
    if (row === null) return NO_DATA;
    if (waitsAt(row, index)) return PLACEHOLDER;
    const at = valueAt(row, index);
    switch (read.type) {
        case "figure": {
            const figure = at?.type === "figure" ? getSomeorUndefined(at.value) : undefined;
            return figure === undefined ? NO_DATA : { kind: "figure", value: figure };
        }
        case "histogram": {
            const bins = kind.bins[index];
            const counts = row.counts[index];
            return bins === undefined || counts === undefined || !(counts.total > 0) ? NO_DATA : { kind: "bars", bars: barsOf(bins, counts.counts) };
        }
        case "list":
            return at?.type !== "list" ? NO_DATA : { kind: "list", lines: listLines(at.value, listTopOf(read.value)) };
        case "tags":
            return at?.type !== "tags" ? NO_DATA : { kind: "tags", ...tagLines(orderedTags(read.value.colors, at.value), DETAILS_INNER_W - column - TAG_LABEL_GAP, measure) };
    }
}

/** A read's block height on a card (§4). */
function heightOf(read: FlowchartReadValue, draws: FlowchartCardDraws): number {
    switch (read.type) {
        case "figure":
            return FIGURE_H;
        case "tags": {
            const lines = draws.kind === "tags" ? Math.max(1, draws.lines.length) : 1;
            return lines * TAG_H + (lines - 1) * TAG_GAP;
        }
        case "histogram":
            return TITLE_H + BLOCK_GAP + (draws.kind === "noData" ? NO_DATA_H : BARS_H + BLOCK_GAP + AXIS_H);
        case "list": {
            const lines = draws.kind === "list" ? draws.lines.length : draws.kind === "placeholder" ? listTopOf(read.value) : 0;
            return TITLE_H + BLOCK_GAP + (lines === 0 ? NO_DATA_H : lines * LIST_ROW_H + (lines - 1) * BLOCK_GAP);
        }
    }
}

/**
 * A state's card where its details draw (R22, §4): each read it shows, in the
 * details' order, in its block — a placeholder while its row lands, drawn as
 * full, *no data* for no row — and its size from them: 272 wide; its head, a
 * rule, then the blocks 12 apart inside 12 of padding.
 *
 * @param kind - The states' details
 * @param key - The state's key
 * @param measure - How wide its words draw: measured where the card draws, else {@link ESTIMATED_TEXT}
 * @returns The card; `undefined` where no read shows on the canvas, and the card is today's
 */
export function detailsCardOf(kind: FlowchartKindDetails, key: string, measure: FlowchartTextMeasure = ESTIMATED_TEXT): FlowchartCard | undefined {
    if (!kind.onCanvas) return undefined;
    const row = kind.rows.get(key);
    const shown = kind.reads.flatMap((entry, index) => (entry.show.type === "inspector" ? [] : [{ read: entry.read, index }]));
    // Tag lists one after another share a label column, as wide as their widest label.
    const columns = new Map<number, number>();
    for (let i = 0; i < shown.length;) {
        let j = i;
        let width = 0;
        while (j < shown.length && shown[j]!.read.type === "tags") {
            width = Math.max(width, Math.ceil(measure.label(labelOf(shown[j]!.read))));
            j += 1;
        }
        for (let k = i; k < j; k++) columns.set(shown[k]!.index, width);
        i = Math.max(j, i + 1);
    }
    let top = CARD_EDGE + CARD_HEAD + CARD_RULE + CARD_PAD;
    const reads = shown.map(({ read, index }): FlowchartCardRead => {
        const column = columns.get(index);
        const draws = drawsOf(read, index, row, kind, column ?? 0, measure);
        const height = heightOf(read, draws);
        const at = top;
        top += height + READ_GAP;
        return { index, top: at, height, column, draws };
    });
    return { width: DETAILS_CARD_W, height: top - READ_GAP + CARD_PAD + CARD_EDGE, reads };
}

// ============================================================================
// A transition label's lines
// ============================================================================

/** One line under a transition label's evidence (R32). */
export type FlowchartLabelLine =
    /** Its row has not landed: a placeholder, a line high (R34). */
    | { readonly kind: "placeholder" }
    /** A figure: its label, its value — `undefined` where the row lacks it, *no data* — and its unit (R25). */
    | { readonly kind: "figure"; readonly label: string; readonly value: number | undefined; readonly unit: string | undefined }
    /** One of a list's top items: its name, and its share of the list's total (R29). */
    | { readonly kind: "item"; readonly name: string; readonly share: number }
    /** A list with no items: *none*. */
    | { readonly kind: "none" }
    /** A list the rail's picks weigh, of a row holding none of them: its label, and *no data* (#1522, R45). */
    | { readonly kind: "noData"; readonly label: string };

/** A placeholder line, while the row lands. */
const PLACEHOLDER_LINE: FlowchartLabelLine = { kind: "placeholder" };
/** *None*, in a list's place. */
const NONE_LINE: FlowchartLabelLine = { kind: "none" };

/**
 * A transition label's lines under its evidence (R32): each read it shows on
 * the canvas, in the details' order — a figure a line, a list its top items by
 * value, or *none* — no line for a row there is none of, which keeps its
 * evidence line alone (R33), and while the row lands each read's lines as
 * placeholders, so the label is as tall as it will be (R34). The build refuses
 * tags and histograms on a label, and lines past three (R21).
 *
 * @param kind - The transitions' details
 * @param key - The transition's key
 * @returns Its lines, in order; none where no read shows on the canvas
 */
export function detailsLabelOf(kind: FlowchartKindDetails, key: string): FlowchartLabelLine[] {
    if (!kind.onCanvas) return [];
    const row = kind.rows.get(key);
    if (row === null) return [];
    const lines: FlowchartLabelLine[] = [];
    kind.reads.forEach((entry, index) => {
        if (entry.show.type === "inspector") return;
        const read = entry.read;
        const at = row === undefined ? undefined : valueAt(row, index);
        const waits = waitsAt(row, index);
        if (read.type === "figure") {
            lines.push(waits ? PLACEHOLDER_LINE : {
                kind: "figure", label: read.value.label, value: at?.type === "figure" ? getSomeorUndefined(at.value) : undefined, unit: getSomeorUndefined(read.value.unit),
            });
        } else if (read.type === "list") {
            const top = listTopOf(read.value);
            if (row === undefined || waits) {
                for (let i = 0; i < top; i++) lines.push(PLACEHOLDER_LINE);
                return;
            }
            if (row.noData[index] === true) {
                lines.push({ kind: "noData", label: read.value.label });
                return;
            }
            const items = at?.type === "list" ? listLines(at.value, top) : [];
            if (items.length === 0) lines.push(NONE_LINE);
            for (const item of items) lines.push({ kind: "item", name: item.name, share: item.share });
        }
    });
    return lines;
}
