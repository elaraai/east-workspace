/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a record target's preview draws (`Decision Queue Spec.md` P6, P10,
 * P11, P24–P26): a record no builder draws, by what its target declares —
 * its rows' changed fields, at most two, each as it stands and as the change
 * leaves it, those it leaves plain (P6); with a `measure` over a record of at
 * most five rows read whole, its mix — every row on one axis from zero, the
 * value held and the one proposed joined (P10); with a `group`, a row a group
 * — its size, how many of its rows change and their measure's net change
 * (P11). Pure: the preview reads the rows, and this works out what they draw.
 *
 * @packageDocumentation
 */

import { FloatType, StringType, compareFor, equalFor } from "@elaraai/east";

/** The most fields a record's preview draws (P6): two blocks fill its frame. */
export const RECORD_FIELDS = 2;
/** The most rows a mix draws, and the most rows a record holds for its mix (P10). */
export const MIX_ROWS = 5;
/** The most groups a preview draws (P11). */
export const GROUP_ROWS = 5;

const compareString = compareFor(StringType);
const compareNumber = compareFor(FloatType);
const stringEqual = equalFor(StringType);
const sameNumber = equalFor(FloatType);

/** One field of the record's rows, as the preview reads and prints it. */
export interface RecordFieldSpec {
    /** Its label. */
    readonly label: string;
    /** Its value in a row, decoded. */
    readonly read: (row: unknown) => unknown;
    /** Whether two of its values are the same, as East compares them. */
    readonly equal: (a: unknown, b: unknown) => boolean;
    /** A value printed, as the row's form prints it. */
    readonly print: (value: unknown) => string;
}

/** One row a change touches, decoded: as it stands and as the change leaves it — `undefined` where it is none. */
export interface RecordRowInput {
    /** Its key's text. */
    readonly key: string;
    /** Its name: the target's `label`, else its key. */
    readonly name: string;
    /** As it stands. */
    readonly before: unknown;
    /** As the change leaves it. */
    readonly after: unknown;
    /** Its confidence, where the option guessed it (P26). */
    readonly confidence: number | undefined;
}

/** One field a record's preview draws (P6). */
export interface RecordFieldItem {
    /** Its row's key. */
    readonly key: string;
    /** Its row's name. */
    readonly row: string;
    /** Its label. */
    readonly field: string;
    /** As it stands, printed; `undefined` for a row the change adds. */
    readonly was: string | undefined;
    /** As the change leaves it, printed; `undefined` for a row it removes. */
    readonly is: string | undefined;
    /** Whether the change sets it: proposed, the steady glow; else plain. */
    readonly changed: boolean;
    /** Its row's confidence, where the option guessed it and the change sets it (P26). */
    readonly confidence: number | undefined;
}

/** What {@link recordFields} works from. */
export interface RecordFieldsInput {
    /** The record's fields, in its form's order. */
    readonly specs: readonly RecordFieldSpec[];
    /** The rows the change touches, in its order. */
    readonly rows: readonly RecordRowInput[];
    /** The fields to draw where the change sets none: those the recommendation would set (P4), by label; empty for the first. */
    readonly lands: readonly string[];
    /** Whether the change's fields are marked: not for rows drawn as they stand (P4, P21). */
    readonly marked: boolean;
}

/**
 * The fields a record's preview draws (P6): each row's fields the change sets, in the form's order, at most
 * {@link RECORD_FIELDS} across the rows; where it sets none, the fields the recommendation would set, else the form's
 * first — each as it stands, unmarked.
 *
 * @param input - The fields, the rows and how the change marks them
 * @returns The fields, in order
 */
export function recordFields(input: RecordFieldsInput): RecordFieldItem[] {
    const out: RecordFieldItem[] = [];
    const item = (row: RecordRowInput, spec: RecordFieldSpec, changed: boolean): RecordFieldItem => ({
        key: row.key, row: row.name, field: spec.label,
        was: row.before === undefined ? undefined : spec.print(spec.read(row.before)),
        is: row.after === undefined ? undefined : spec.print(spec.read(row.after)),
        changed, confidence: changed ? row.confidence : undefined,
    });
    for (const row of input.rows) {
        for (const spec of input.specs) {
            if (out.length >= RECORD_FIELDS) return out;
            if (!input.marked) continue;
            const was = row.before === undefined ? undefined : spec.read(row.before);
            const is = row.after === undefined ? undefined : spec.read(row.after);
            const sets = row.before === undefined || row.after === undefined || !spec.equal(was, is);
            if (sets) out.push(item(row, spec, true));
        }
    }
    if (out.length > 0) return out;
    // Nothing set: the fields the recommendation would set, else the first, as they stand.
    const landing = input.specs.filter(spec => input.lands.some(label => stringEqual(label, spec.label)));
    const shown = landing.length > 0 ? landing : input.specs;
    for (const row of input.rows) {
        for (const spec of shown) {
            if (out.length >= RECORD_FIELDS) return out;
            out.push(item(row, spec, false));
        }
    }
    return out;
}

/** One row of a record's mix, by its measure (P10). */
export interface MixRowInput {
    /** Its key's text. */
    readonly key: string;
    /** Its name. */
    readonly name: string;
    /** Its measure as it stands; `undefined` for a row the change adds. */
    readonly before: number | undefined;
    /** As the change leaves it; `undefined` for a row it removes. */
    readonly after: number | undefined;
    /** Its confidence, where the option guessed it (P26). */
    readonly confidence: number | undefined;
}

/** One row a mix draws. */
export interface MixRow {
    /** Its key's text. */
    readonly key: string;
    /** Its name. */
    readonly name: string;
    /** Its measure as it stands, and as the change leaves it. */
    readonly was: number;
    readonly now: number;
    /** Whether the change leaves it as it stands: one dot, quiet. */
    readonly same: boolean;
    /** Where its dots stand, in percent of the axis. */
    readonly wasAt: number;
    readonly nowAt: number;
    /** Its confidence, where the option guessed it and the change moves it (P26). */
    readonly confidence: number | undefined;
}

/** What a mix draws (P10). */
export interface MixModel {
    /** Every row, in key order. */
    readonly rows: readonly MixRow[];
    /** The axis's end: zero to it. */
    readonly max: number;
    /** Its ticks: zero, its middle and its end. */
    readonly ticks: readonly number[];
}

/**
 * A nice number at or above a value: one, two, two and a half or five of its power of ten.
 *
 * @param value - A positive value
 * @returns The nice number
 */
export function niceCeil(value: number): number {
    if (!(value > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 2.5, 5, 10].find(nice => nice * power >= value * (1 - 1e-9)) ?? 10;
    return step * power;
}

/**
 * A record's mix (P10): every row on one axis from zero to a nice end that halves nicely, the value it holds and the
 * one the change proposes, each a dot — a row it leaves as it is one dot, quiet.
 *
 * @param rows - The record's rows, at most {@link MIX_ROWS}
 * @param marked - Whether the change's rows are marked: not for rows drawn as they stand (P4, P21)
 * @returns The mix
 */
export function recordMix(rows: readonly MixRowInput[], marked: boolean): MixModel {
    const sorted = [...rows].sort((a, b) => compareString(a.key, b.key)).slice(0, MIX_ROWS);
    let top = 0;
    for (const row of sorted) top = Math.max(top, row.before ?? 0, row.after ?? 0);
    const half = niceCeil(top / 2);
    const max = half * 2;
    const at = (value: number) => Math.min(100, Math.max(0, (value / max) * 100));
    return {
        max,
        ticks: [0, half, max],
        rows: sorted.map((row): MixRow => {
            const was = row.before ?? 0, now = marked ? row.after ?? 0 : was;
            const same = sameNumber(was, now);
            return { key: row.key, name: row.name, was, now, same, wasAt: at(was), nowAt: at(now), confidence: same ? undefined : row.confidence };
        }),
    };
}

/** One row a change touches, by its group (P11). */
export interface GroupRowInput {
    /** Its group. */
    readonly group: string;
    /** Its measure as it stands, and as the change leaves it: `undefined` where it is none, or there is no measure. */
    readonly before: number | undefined;
    readonly after: number | undefined;
}

/** One group a preview draws. */
export interface GroupRow {
    /** Its name. */
    readonly name: string;
    /** How many of its rows the change touches. */
    readonly n: number;
    /** How many rows it holds. */
    readonly of: number;
    /** Its track's width — its size against the largest group's — and the part that changes, in percent. */
    readonly size: number;
    readonly part: number;
    /** The net change of the measure over its rows the change touches, a fraction; `undefined` without a measure. */
    readonly net: number | undefined;
}

/**
 * The groups a change touches (P11): a row a group, the most rows first, at most {@link GROUP_ROWS} — its track its
 * size against the largest group's, the part the rows that change, and their measure's net change.
 *
 * @param rows - The rows the change touches
 * @param size - How many rows a group holds, by its name; `undefined` while it is read. Every group shown is asked, in
 *   one pass, before any answer is waited on: a read asks them together, never one as the last lands
 * @returns The groups, in order; `undefined` while a group's size is read
 */
export function recordGroups(rows: readonly GroupRowInput[], size: (group: string) => number | undefined): GroupRow[] | undefined {
    const byGroup = new Map<string, { n: number; before: number; after: number; measured: boolean }>();
    for (const row of rows) {
        let held = byGroup.get(row.group);
        if (held === undefined) { held = { n: 0, before: 0, after: 0, measured: false }; byGroup.set(row.group, held); }
        held.n += 1;
        if (row.before !== undefined || row.after !== undefined) {
            held.measured = true;
            held.before += row.before ?? 0;
            held.after += row.after ?? 0;
        }
    }
    const shown = [...byGroup].sort(([a, x], [b, y]) => compareNumber(y.n, x.n) || compareString(a, b)).slice(0, GROUP_ROWS);
    // Every group's size asked before one is waited on.
    const asked = shown.map(([name]) => size(name));
    const sizes: number[] = [];
    for (const [i, [, held]] of shown.entries()) {
        const of = asked[i];
        if (of === undefined) return undefined;
        sizes.push(Math.max(of, held.n));
    }
    const largest = Math.max(1, ...sizes);
    return shown.map(([name, held], i): GroupRow => ({
        name, n: held.n, of: sizes[i]!, size: (sizes[i]! / largest) * 100, part: (held.n / largest) * 100,
        net: !held.measured || !(held.before > 0) ? undefined : held.after / held.before - 1,
    }));
}
