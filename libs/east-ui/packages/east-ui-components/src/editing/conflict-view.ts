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

const textEqual = equalFor(StringType);

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
                if (type !== undefined && isDraftField(type)) {
                    // The draft's own field: no step of the entry's.
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
        was: wasAt.part.value === undefined ? undefined : describe(wasAt.part.type, wasAt.part.value, words, alike),
    };
}
