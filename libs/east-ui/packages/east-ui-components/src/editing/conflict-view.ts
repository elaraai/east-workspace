/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a conflict reads to a person — the conflicts popover's words for one
 * (merge.ts): which entry, where in it, and each side's value there, in plain
 * words. Yes or No; a number or a date in the reader's locale; text as it is;
 * a choice by its name, then its details; a list or a map by its size;
 * absence said in words. Two values that would read the same — numbers alike
 * to the digits shown, dates alike to the day — are written in full, so the
 * sides read apart.
 *
 * @packageDocumentation
 */
import { StringType, equalFor, parseFor, printFor, toEastTypeValue, type EastType, type PatchPath, type option, type variant } from "@elaraai/east";
import { isDraftField } from "./merge.js";
import type { EditingWords } from "./messages.js";
import type { ConflictRange } from "./session.js";

const textEqual = equalFor(StringType);

/**
 * How a value reads in its row: numbers, dates and ids in mono, tabular;
 * text in the body face, two lines then Show all; absence — removed, cleared,
 * empty — in words, in the absent style.
 */
export type ValueForm = "mono" | "text" | "absent";

/** One conflict, as a person reads it. */
export interface ConflictView {
    /** The entry, by its key in words, else its id: its name where the collection gives none. */
    readonly name: string;
    /** The steps from the entry down to the part's own label, in words — `Crew 1`: what follows the entry's name. A field a key or an item names goes, the key or the item saying which. */
    readonly path: readonly string[];
    /** The part's own label, a step at a time — `Hours`, then `Nov 9, 2026`: its field and every step under it; none for the entry itself. */
    readonly label: readonly string[];
    /** The draft's value there. */
    readonly yours: string;
    /** The source's value there. */
    readonly theirs: string;
    /** How the draft's value reads ({@link ValueForm}). */
    readonly yoursForm: ValueForm;
    /** How the source's value reads. */
    readonly theirsForm: ValueForm;
    /** What both began from there; `undefined` where neither held the part. */
    readonly was: string | undefined;
}

/** A conflict's three values, each the whole entry's draft — present or absent — and where it is. */
export interface ConflictValues {
    /** The entry's id. */
    readonly id: string;
    /** A keyed source's key; `undefined` for an Array source's entry. */
    readonly key: unknown;
    /** A keyed source's key type; `undefined` for an Array source. */
    readonly keyType: EastType | undefined;
    /** The steps from the entry to the part (`ConflictPoint.at`). */
    readonly at: PatchPath;
    /** What both began from. */
    readonly was: option<unknown>;
    /** The draft. */
    readonly draft: option<unknown>;
    /** The source's value. */
    readonly source: option<unknown>;
}

/** A step down to a part, in words: a field's, an item's or a key's, or a choice's. */
interface Step { readonly kind: "field" | "item" | "choice"; readonly words: string }

/** A name as a person reads it: `maxWeeklyHours` and `max_weekly_hours` read `Max weekly hours`. */
export function sentenceOf(name: string): string {
    const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
    return words.length === 0 ? name : words[0]!.toUpperCase() + words.slice(1);
}

/** Whether a type is an option: none, or some value — a wrapper of its value, no step a person reads. */
function isOption(type: EastType): boolean {
    return type.type === "Variant" && Object.keys(type.cases).length === 2 && "none" in type.cases && "some" in type.cases;
}

/** A part of a draft: its type there, and its value — `undefined` for none. */
interface Part { readonly type: EastType | undefined; readonly value: { readonly held: unknown } | undefined }

/**
 * The part of an entry's draft a conflict is at, walking its steps with the
 * draft's type; each step in words beside it.
 *
 * @param draftType - The entry's draft type
 * @param value - The entry's draft, present or absent
 * @param at - The steps
 * @param words - The words
 * @returns The part, and the steps in words
 */
function walk(draftType: EastType, value: option<unknown>, at: PatchPath, words: EditingWords): { part: Part; steps: Step[] } {
    let type: EastType | undefined = draftType;
    let held: { held: unknown } | undefined = value.type === "some" ? { held: value.value } : undefined;
    const steps: Step[] = [];
    for (const segment of at) {
        switch (segment.kind) {
            case "field": {
                steps.push({ kind: "field", words: sentenceOf(segment.name) });
                const next: EastType | undefined = type?.type === "Struct" ? type.fields[segment.name] : undefined;
                held = held === undefined || next === undefined ? undefined : { held: (held.held as Record<string, unknown>)[segment.name] };
                type = next;
                break;
            }
            case "index": {
                steps.push({ kind: "item", words: words.m.conflictItem({ n: Number(segment.index) + 1, count: words.number(Number(segment.index) + 1) }) });
                const items = type?.type === "Array" && held !== undefined ? held.held as readonly unknown[] : undefined;
                const index = Number(segment.index);
                held = items !== undefined && index < items.length ? { held: items[index] } : undefined;
                type = type?.type === "Array" ? type.value : undefined;
                break;
            }
            case "key": {
                const keyType: EastType | undefined = type?.type === "Dict" ? type.key : undefined;
                const read = keyType === undefined ? undefined : parseFor(toEastTypeValue(keyType))(segment.key);
                const key = read !== undefined && read.success ? read.value : undefined;
                steps.push({ kind: "item", words: key === undefined || keyType === undefined ? segment.key : describe(keyType, { held: key }, words, false) });
                let found: { held: unknown } | undefined;
                if (held !== undefined && keyType !== undefined && key !== undefined) {
                    // A key read back from its printing is found by East's own equality, as the map holds it.
                    const same = equalFor(toEastTypeValue(keyType));
                    for (const [k, v] of held.held as ReadonlyMap<unknown, unknown>) if (same(k, key)) { found = { held: v }; break; }
                }
                held = found;
                type = type?.type === "Dict" ? type.value : undefined;
                break;
            }
            case "variant": {
                if (type !== undefined && (isDraftField(type) || isOption(type))) {
                    // The draft's own field, or an option's value: no step of the entry's.
                    const cell = held?.held as variant<string, unknown> | undefined;
                    const inside = cell !== undefined && textEqual(cell.type, segment.tag);
                    held = inside ? { held: cell.value } : held;
                    type = inside && type.type === "Variant" ? type.cases[segment.tag] : type;
                    break;
                }
                steps.push({ kind: "choice", words: sentenceOf(segment.tag) });
                const choice = held?.held as variant<string, unknown> | undefined;
                held = choice !== undefined && textEqual(choice.type, segment.tag) ? { held: choice.value } : undefined;
                type = type?.type === "Variant" ? type.cases[segment.tag] : undefined;
                break;
            }
        }
    }
    return { part: { type, value: held }, steps };
}

/**
 * A value in words — see the module docs.
 *
 * @param type - Its type, where known
 * @param value - The value; `undefined` for none
 * @param words - The words
 * @param full - Every digit, and the time beside a date: what tells two values apart that read alike
 * @returns The words
 */
function describe(type: EastType | undefined, value: { readonly held: unknown } | undefined, words: EditingWords, full: boolean): string {
    const { m } = words;
    if (value === undefined) return m.conflictCleared();
    const held = value.held;
    if (type === undefined) return m.conflictNone();
    switch (type.type) {
        case "Null": return m.conflictNone();
        case "Boolean": return held === true ? m.conflictYes() : m.conflictNo();
        case "Integer": return full ? words.bare(held as bigint) : words.number(held as bigint);
        case "Float": return full ? words.float(held as number) : words.number(held as number);
        case "String": return (held as string).length === 0 ? m.conflictEmpty() : held as string;
        case "DateTime": return full ? words.dateTime(held as Date) : words.date(held as Date);
        case "Blob": return m.conflictFile({ size: words.number((held as Uint8Array).length) });
        case "Ref": return describe(type.value, { held: (held as { value: unknown }).value }, words, full);
        case "Array": { const n = (held as readonly unknown[]).length; return m.conflictItems({ n, count: words.number(n) }); }
        case "Set": case "Dict": { const n = (held as ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>).size; return m.conflictEntries({ n, count: words.number(n) }); }
        case "Vector": { const n = (held as ArrayLike<unknown>).length; return m.conflictNumbers({ n, count: words.number(n) }); }
        case "Matrix": { const grid = held as { rows: number; cols: number }; return m.conflictGrid({ rows: words.number(grid.rows), cols: words.number(grid.cols) }); }
        case "Recursive": return m.conflictTree();
        case "Struct": {
            // A block reads as its first fields.
            const fields = Object.entries(type.fields).map(([name, field]) => `${sentenceOf(name)}: ${describe(field, { held: (held as Record<string, unknown>)[name] }, words, full)}`);
            return fields.length > 3 ? `${fields.slice(0, 3).join(" · ")} · …` : fields.join(" · ");
        }
        case "Variant": {
            const choice = held as variant<string, unknown>;
            const cases = type.cases as Record<string, EastType>;
            // A draft's own field reads as its value; missing reads cleared, and text that could not be read as typed.
            if (isDraftField(type)) {
                if (choice.type === "missing") return m.conflictCleared();
                if (choice.type === "invalid") return choice.value as string;
                return describe(cases.value, { held: choice.value }, words, full);
            }
            // An option reads as its value, or cleared.
            if (Object.keys(cases).length === 2 && "none" in cases && "some" in cases) {
                return choice.type === "none" ? m.conflictCleared() : describe(cases.some, { held: choice.value }, words, full);
            }
            const payload = cases[choice.type];
            return payload === undefined || payload.type === "Null" ? sentenceOf(choice.type) : `${sentenceOf(choice.type)} · ${describe(payload, { held: choice.value }, words, full)}`;
        }
        default: return printFor(toEastTypeValue(type))(held);
    }
}

/**
 * How a part's value reads: absent where it holds none — removed, cleared,
 * missing, empty text — mono for a number, a date or a key, else text.
 *
 * @param part - The part
 * @returns Its form
 */
function formOf(part: Part): ValueForm {
    if (part.value === undefined) return "absent";
    let type = part.type;
    let held = part.value.held;
    // Through the draft's own field and an option to what it holds.
    while (type?.type === "Variant") {
        const cell = held as variant<string, unknown>;
        const cases = type.cases as Record<string, EastType>;
        const option = Object.keys(cases).length === 2 && "none" in cases && "some" in cases;
        if (isDraftField(type)) {
            if (textEqual(cell.type, "missing")) return "absent";
            if (!textEqual(cell.type, "value")) return "text";
        } else if (option) {
            if (textEqual(cell.type, "none")) return "absent";
        } else {
            return "text";
        }
        held = cell.value;
        type = cases[cell.type];
    }
    switch (type?.type) {
        case "Integer": case "Float": case "DateTime": return "mono";
        case "String": return (held as string).length === 0 ? "absent" : "text";
        default: return "text";
    }
}

/**
 * The steps down to a part, split where the part's own label begins: at its
 * last field, else at its last step. Above it, a field a key or an item
 * follows goes — `Crews / Crew 1` reads `Crew 1`.
 *
 * @param steps - The steps
 * @returns The path above the label, and the label
 */
function splitSteps(steps: readonly Step[]): { path: string[]; label: string[] } {
    let at = Math.max(steps.length - 1, 0);
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i]!.kind === "field") { at = i; break; }
    }
    const above = steps.slice(0, at);
    return {
        path: above.filter((step, i) => !(step.kind === "field" && above[i + 1]?.kind === "item")).map((step) => step.words),
        label: steps.slice(at).map((step) => step.words),
    };
}

/**
 * A conflict in words — see the module docs.
 *
 * @param draftType - The entry's draft type
 * @param conflict - Its three values, and where it is
 * @param words - The words
 * @returns The conflict as a person reads it
 */
export function conflictViewOf(draftType: EastType, conflict: ConflictValues, words: EditingWords): ConflictView {
    const yoursAt = walk(draftType, conflict.draft, conflict.at, words);
    const theirsAt = walk(draftType, conflict.source, conflict.at, words);
    const wasAt = walk(draftType, conflict.was, conflict.at, words);
    // A part one side does not hold is removed there: the entry, an item or a key of it.
    const side = (at: { part: Part }, full: boolean): string =>
        at.part.value === undefined ? words.m.conflictRemoved() : describe(at.part.type, at.part.value, words, full);
    // Two that read alike are written in full, what both began from beside them.
    const alike = side(yoursAt, false) === side(theirsAt, false);
    const { path, label } = splitSteps(yoursAt.steps);
    const { keyType, key } = conflict;
    return {
        name: keyType !== undefined && key !== undefined ? describe(keyType, { held: key }, words, false) : conflict.id,
        path,
        label,
        yours: side(yoursAt, alike),
        theirs: side(theirsAt, alike),
        yoursForm: formOf(yoursAt.part),
        theirsForm: formOf(theirsAt.part),
        was: wasAt.part.value !== undefined ? describe(wasAt.part.type, wasAt.part.value, words, alike)
            : conflict.was.type === "some" ? words.m.conflictEmpty() : undefined,
    };
}

/** One end of a range, on each side: the whole entry each side reads it from, present or absent. */
export interface RangeEnd {
    /** What both began from. */
    readonly was: option<unknown>;
    /** The draft: Yours. */
    readonly yours: option<unknown>;
    /** What a choice of Theirs leaves there: the source's value where the end conflicts, else the draft's. */
    readonly theirs: option<unknown>;
}

/** A range's conflicts, as one card reads them: the entry, and each end's values. */
export interface RangeValues {
    /** The entry's id. */
    readonly id: string;
    /** A keyed source's key; `undefined` for an Array source's entry. */
    readonly key: unknown;
    /** A keyed source's key type; `undefined` for an Array source. */
    readonly keyType: EastType | undefined;
    /** Its start's values. */
    readonly start: RangeEnd;
    /** Its end's values. */
    readonly end: RangeEnd;
}

/**
 * One end of a range on one side: the field's part of the entry's draft, and
 * the date it holds through the draft's own wrapper and an option, where it
 * holds one; `undefined` for an entry the side does not hold.
 */
function endOf(draftType: EastType, value: option<unknown>, field: string, words: EditingWords): { part: Part; date: Date | undefined } | undefined {
    if (value.type !== "some") return undefined;
    const { part } = walk(draftType, value, [{ kind: "field", name: field }], words);
    let type = part.type;
    let held = part.value?.held;
    while (type?.type === "Variant" && held !== undefined) {
        const cell = held as variant<string, unknown>;
        const cases = type.cases as Record<string, EastType>;
        const option = Object.keys(cases).length === 2 && "none" in cases && "some" in cases;
        const through = isDraftField(type) ? textEqual(cell.type, "value") : option && textEqual(cell.type, "some");
        if (!through) break;
        held = cell.value;
        type = cases[cell.type];
    }
    return { part, date: type?.type === "DateTime" && held !== undefined ? held as Date : undefined };
}

/**
 * A range's conflict in words — an item's start and end as one value, its
 * dates: `Nov 16 – 20, 2026` on each side, written in full where the two
 * sides read alike to the day, so they read apart. A side that does not hold
 * the entry reads removed.
 *
 * @param draftType - The entry's draft type
 * @param range - The range's two fields
 * @param values - The entry, and each end's values
 * @param words - The words
 * @returns The conflict as a person reads it
 */
export function rangeViewOf(draftType: EastType, range: ConflictRange, values: RangeValues, words: EditingWords): ConflictView {
    const { m } = words;
    const side = (pick: (end: RangeEnd) => option<unknown>, full: boolean): string | undefined => {
        const start = endOf(draftType, pick(values.start), range.start, words);
        const end = endOf(draftType, pick(values.end), range.end, words);
        if (start === undefined || end === undefined) return undefined;
        if (start.date !== undefined && end.date !== undefined) {
            return full ? `${words.dateTime(start.date)} – ${words.dateTime(end.date)}` : words.range(start.date, end.date);
        }
        // An end with no date reads as its value does — cleared, say — and two that read alike, once.
        const from = describe(start.part.type, start.part.value, words, full), to = describe(end.part.type, end.part.value, words, full);
        return from === to ? from : `${from} – ${to}`;
    };
    const alike = side((end) => end.yours, false) === side((end) => end.theirs, false);
    // A side's range reads in mono where both its ends hold a date, absent where it holds no entry or no date at all.
    const rangeForm = (pick: (end: RangeEnd) => option<unknown>): ValueForm => {
        const start = endOf(draftType, pick(values.start), range.start, words);
        const end = endOf(draftType, pick(values.end), range.end, words);
        if (start === undefined || end === undefined) return "absent";
        if (start.date !== undefined && end.date !== undefined) return "mono";
        return formOf(start.part) === "absent" && formOf(end.part) === "absent" ? "absent" : "text";
    };
    const { keyType, key } = values;
    return {
        name: keyType !== undefined && key !== undefined ? describe(keyType, { held: key }, words, false) : values.id,
        path: [],
        label: [m.conflictDates()],
        yours: side((end) => end.yours, alike) ?? m.conflictRemoved(),
        theirs: side((end) => end.theirs, alike) ?? m.conflictRemoved(),
        yoursForm: rangeForm((end) => end.yours),
        theirsForm: rangeForm((end) => end.theirs),
        was: side((end) => end.was, alike),
    };
}

/** A run of a text's words: whether it differs from the other version's. */
export interface TextRun {
    readonly text: string;
    readonly differs: boolean;
}

/**
 * Two versions of a text, word by word: each split into runs, those the other
 * version does not hold marked — what a long text opened in place marks in
 * each. Two texts too long to compare word by word come back whole, unmarked.
 *
 * @param a - One version
 * @param b - The other
 * @returns Each version's runs
 */
export function wordRuns(a: string, b: string): { readonly a: readonly TextRun[]; readonly b: readonly TextRun[] } {
    const split = (text: string) => text.split(/(\s+)/).filter((part) => part.length > 0);
    const x = split(a), y = split(b);
    if (x.length * y.length > 40_000) return { a: [{ text: a, differs: false }], b: [{ text: b, differs: false }] };
    // The longest common subsequence of the words, spaces included.
    const lcs: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
    for (let i = x.length - 1; i >= 0; i--) {
        for (let j = y.length - 1; j >= 0; j--) {
            lcs[i]![j] = textEqual(x[i]!, y[j]!) ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
        }
    }
    const marksA: boolean[] = new Array<boolean>(x.length).fill(true), marksB: boolean[] = new Array<boolean>(y.length).fill(true);
    for (let i = 0, j = 0; i < x.length && j < y.length;) {
        if (textEqual(x[i]!, y[j]!)) { marksA[i] = false; marksB[j] = false; i++; j++; }
        else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
        else j++;
    }
    // Runs of the words alike or apart; a space between two marked words is marked with them.
    const runs = (parts: readonly string[], marks: readonly boolean[]): TextRun[] => {
        const out: TextRun[] = [];
        parts.forEach((part, i) => {
            const space = part.trim().length === 0;
            const differs = space ? (marks[i - 1] ?? false) && (marks[i + 1] ?? false) : marks[i]!;
            const last = out[out.length - 1];
            if (last !== undefined && last.differs === differs) out[out.length - 1] = { text: last.text + part, differs };
            else out.push({ text: part, differs });
        });
        return out;
    };
    return { a: runs(x, marksA), b: runs(y, marksB) };
}
