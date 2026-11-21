/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Asking a visual's programs on e3 (#1670): each drafted, planned and called
 * as the query builder runs a query (`run-draft.ts`) — one call, or a split
 * call over a large dataset's pieces — and its answer read; kept by its
 * program and the hashes of the datasets it read ({@link VisualAnswers}), so
 * two tiles with one program make one call, and a dataset's new hash asks
 * again only the programs that read it.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { ArrayType, IntegerType, StructType, decodeBeast2, fromEastTypeValue, isValueOf, printType, type EastType, type option } from "@elaraai/east";
import { AnswerCache, readHashes, withMinute, type KeptRequest, type KeptResult } from "../model/summaries.js";
import { minuteOf, queryResultOf, type QueryResult, type QueryRoot } from "../one-shot.js";
import { draftPlan, type PlanOptions } from "../plan.js";
import { runDraft, type DraftRunSeams } from "../run-draft.js";
import { messageOf } from "../../shared/message.js";
import { optionPayload, rowOf } from "../steps/shape.js";
import type { VisualValue } from "./print.js";

/**
 * One program's answer.
 *
 * @remarks
 * - `answered` — its rows, each column's East type, how many groups there
 *   were before the cut, and how many source rows it read: none is "no data";
 *   and what a paged view's program answers beside its page (#1667): Other,
 *   its largest value, its heat ramp's top.
 * - `problem` — it ended otherwise: the checker's problems, an error the run
 *   raised, a dataset with no value yet, out of time or too large — its
 *   result, which says which.
 */
export type VisualAnswer =
    | {
        readonly kind: "answered"; readonly result: QueryResult; readonly rows: readonly Readonly<Record<string, unknown>>[];
        readonly columns: ReadonlyMap<string, EastType>; readonly groups: number; readonly n: number;
        /** The groups past a group's first N, folded — Other; `undefined` where none was asked, or no fold is exact. */
        readonly other?: VisualRest | undefined;
        /** A list's largest first value among its first N, for its ranking bar; `undefined` where none was asked, or it has none. */
        readonly largest?: number | undefined;
        /** A heat map's top step: its value's 95th percentile over every pair; `undefined` where none was asked, or it has none. */
        readonly heat?: number | undefined;
    }
    | { readonly kind: "problem"; readonly result: QueryResult };

/**
 * Other, as a paged view's program answers it (#1667): the groups past a
 * group's first N, folded — one row, of a list's or a summary's; one a key of
 * its second group, of a pivot's rows — and each column's East type.
 *
 * @property rows - Its rows: each value's parts, folded, its keys of the second group where it has one, and its rows
 * @property columns - Each column's East type
 */
export interface VisualRest {
    /** Its rows: each value's parts, folded, its keys of the second group where it has one, and its rows. */
    readonly rows: readonly Readonly<Record<string, unknown>>[];
    /** Each column's East type. */
    readonly columns: ReadonlyMap<string, EastType>;
}

/** A program's answer that answered: its rows, each column's East type, its groups and the source rows it read. */
export type VisualAnswered = Extract<VisualAnswer, { kind: "answered" }>;

/** A call that never answered: e3 could not be reached, or refused it — what a tile shows as its source's error. */
export class VisualAskError extends Error {
    /**
     * @param reason - Unreachable, or refused by the server
     * @param message - What was said, when anything was
     */
    constructor(readonly reason: "unreachable" | "refused", message: string) {
        super(message);
        this.name = "VisualAskError";
    }
}

/** Whether a type is a number's, or an Option of one, as East's type equality tells it: what a value read beside a page is. */
function isNumberType(type: EastType): boolean {
    const payload = optionPayload(type) ?? type;
    return payload.type === "Integer" || payload.type === "Float";
}

/** A field of an answer's type that is an Array of structs — its rows, its Other — as that Array; `undefined` for any other. */
function rowsType(type: EastType): ArrayType<StructType> | undefined {
    const row = rowOf(type);
    return row?.type === "Struct" ? ArrayType(row) : undefined;
}

/**
 * The struct every visual program answers — its rows, how many groups there
 * were before the cut, and how many source rows it read — and what a paged
 * view's answers beside its page (#1667): Other's rows (`other`), a list's
 * largest value (`largest`), a heat map's top (`heat`); its rows' types the
 * answer's own, known only once it is read: what an answer's value is checked
 * against.
 *
 * @param type - The answer's type
 * @returns The struct of `rows`, `groups` and `n`, and those beside them it has;
 *   `undefined` for a type that is no such struct, or that has another field
 */
export function visualAnswerType(type: EastType): StructType | undefined {
    if (type.type !== "Struct") return undefined;
    const expected: [string, EastType][] = [];
    for (const [name, field] of Object.entries(type.fields as Record<string, EastType>)) {
        switch (name) {
            case "rows": case "other": {
                const rows = rowsType(field);
                if (rows === undefined) return undefined;
                expected.push([name, rows]);
                break;
            }
            case "groups": case "n":
                expected.push([name, IntegerType]);
                break;
            case "largest": case "heat":
                if (!isNumberType(field)) return undefined;
                expected.push([name, field]);
                break;
            default:
                return undefined;
        }
    }
    const names = new Set(expected.map(([name]) => name));
    return names.has("rows") && names.has("groups") && names.has("n") ? StructType(expected) : undefined;
}

/**
 * Whether any of a visual's programs read a row of its source: "no data" when
 * none did — counted over every period's program, so a visual whose earlier
 * period has no rows still draws this one's.
 *
 * @param answers - Its programs' answers
 * @returns Whether one read a row
 */
export function visualReadRows(answers: readonly VisualAnswer[]): boolean {
    return answers.some((answer) => answer.kind === "answered" && answer.n > 0);
}

/**
 * Asks one program on e3: drafted, planned and called as the query builder
 * runs a query, and its answer read.
 *
 * @param program - The program, as the printer gave it
 * @param root - The root its data sources make
 * @param seams - How its calls are made
 * @param options - How it plans; its `now`, the minute it is asked — the current one when omitted
 * @param signal - Gives it up
 * @returns Its answer and the hashes of the datasets it read — and, for a
 *   program that read `.now`, the minute it was asked, under `now`
 *   ({@link withMinute}, #1670); `undefined` when it was given up
 * @throws {VisualAskError} When a call never answered: e3 could not be reached,
 *   or refused it; and when its answer is not a visual program's
 *   ({@link visualAnswerType})
 */
export async function askProgram(
    program: string, root: QueryRoot, seams: DraftRunSeams, options: PlanOptions, signal: AbortSignal,
): Promise<KeptResult<VisualAnswer> | undefined> {
    // One minute for the call and for what its answer is kept by.
    const now = minuteOf(options.now ?? new Date());
    let drafted: ReturnType<typeof draftPlan>;
    try {
        drafted = draftPlan(program, root, { ...options, now });
    } catch (err) {
        throw new VisualAskError("refused", messageOf(err));
    }
    if ("result" in drafted) return { value: { kind: "problem", result: drafted.result }, hashes: new Map() };
    const ran = await runDraft(drafted.draft, seams, signal);
    switch (ran.kind) {
        case "abandoned":
            return undefined;
        case "refused":
            return { value: { kind: "problem", result: ran.result }, hashes: new Map() };
        case "failed":
            throw new VisualAskError(ran.reason, ran.message);
        case "answered": {
            let result: QueryResult;
            try {
                result = queryResultOf(ran.reading, ran.answer);
            } catch (err) {
                throw new VisualAskError("refused", messageOf(err));
            }
            // An answer that read `.now` is the minute's (#1670).
            const hashes = drafted.draft.readsNow ? withMinute(readHashes(result), now) : readHashes(result);
            if (result.outcome.type !== "ok") return { value: { kind: "problem", result }, hashes };
            const decoded = decodeBeast2(result.outcome.value.result);
            const read = fromEastTypeValue(decoded.type);
            // The answer is checked against the struct its type says it is, its rows' fields read by their types.
            const type = visualAnswerType(read);
            if (type === undefined || !isValueOf(decoded.value, type)) {
                throw new VisualAskError("refused", `A visual's program answered ${printType(read)}, not its rows, groups and n`);
            }
            return { value: answeredOf(type, decoded.value, result), hashes };
        }
    }
}

/**
 * An answer's value, checked against its type ({@link visualAnswerType}),
 * read: its rows and each column's East type, its counts, and what it answers
 * beside them.
 *
 * @param type - The answer's type
 * @param value - Its value, of that type
 * @param result - The run's result it was read from
 * @returns The answer
 */
function answeredOf(type: StructType, value: unknown, result: QueryResult): VisualAnswered {
    const fields = type.fields as Record<string, EastType | undefined>;
    const answer = value as Readonly<Record<string, unknown>>;
    // An Array of structs the answer holds: its rows, and each column's type.
    const tableOf = (name: string): VisualRest | undefined => {
        const field = fields[name];
        const rows = field === undefined ? undefined : rowsType(field);
        return rows === undefined ? undefined
            : { rows: answer[name] as readonly Readonly<Record<string, unknown>>[], columns: new Map(Object.entries(rows.value.fields as Record<string, EastType>)) };
    };
    const numberAt = (name: string): number | undefined => numberOf(fields[name], answer[name]);
    const rows = tableOf("rows")!;
    return {
        kind: "answered", result, rows: rows.rows, columns: rows.columns, groups: Number(answer["groups"] as bigint), n: Number(answer["n"] as bigint),
        other: tableOf("other"), largest: numberAt("largest"), heat: numberAt("heat"),
    };
}

/** A program a page asks: its text, which its answer is kept by, the source it reads, and the minute it asks for. */
export interface VisualRequest extends KeptRequest {
    /** The program's text. */
    readonly prefix: string;
    /** The source it reads, by its name in the root — and `now` for a program that reads `.now`, whose hash is the minute. */
    readonly reads: readonly string[];
    /** The minute it is asked for, when it reads `.now` (#1670): the page's, so its answer is kept by the minute it read. */
    readonly now?: Date;
}

/**
 * A page's answers: each program asked once per the hashes of what it read —
 * the minute, for one that reads `.now` — however many tiles ask it, and
 * given up once none waits for it.
 */
export class VisualAnswers extends AnswerCache<VisualRequest, VisualAnswer> {
    /**
     * @param ask - Asks a program ({@link askProgram} over the page's root, calls and options), for the minute the request names
     */
    constructor(ask: (program: string, signal: AbortSignal, now?: Date) => Promise<KeptResult<VisualAnswer> | undefined>) {
        super((request, signal) => ask(request.prefix, signal, request.now));
    }
}

/** A number of an answer, by its East type: an Integer's or a Float's; an Option's value when it holds one. */
function numberOf(type: EastType | undefined, part: unknown): number | undefined {
    if (type === undefined) return undefined;
    // An Option, as East's type equality tells it: its value, when it holds one.
    const payload = optionPayload(type);
    if (payload !== undefined) {
        const held = part as option<unknown>;
        return held.type === "some" ? numberOf(payload, held.value) : undefined;
    }
    switch (type.type) {
        case "Integer": return Number(part as bigint);
        case "Float": return part as number;
        default: return undefined;
    }
}

/**
 * A value's parts, as numbers (#1671): what the value is made of, and what a
 * group's rest folds into Other by.
 *
 * @remarks
 * - `added` — a count or a sum: `top` is the value, and two groups' add.
 * - `divided` — a mean (its sum over its count) or a ratio (its two sums):
 *   `top` over `bottom`, each added.
 * - `least`, `most` — a least or a most: `top`, `undefined` for no values;
 *   two groups' is the lesser or the greater.
 * - `distinct` — how many different values: two groups' counts make no
 *   count of both, since a value may be in each.
 */
export interface ValueParts {
    /** How the parts make the value, and fold. */
    readonly kind: "added" | "divided" | "least" | "most" | "distinct";
    /** The value; a mean's sum, a ratio's sum of what it is of. `undefined` for a least or a most of no values. */
    readonly top: number | undefined;
    /** A mean's count, a ratio's sum of what it is per; 0 for the others. */
    readonly bottom: number;
}

/**
 * A value's parts in an answer's row, read by each column's East type.
 *
 * @param answer - The answer, or its Other ({@link VisualRest}): its rows' columns and their types
 * @param row - The row
 * @param index - The value's index among the visual's values
 * @param value - The value
 * @returns Its parts
 */
export function visualParts(answer: Pick<VisualAnswered, "columns">, row: Readonly<Record<string, unknown>>, index: number, value: VisualValue): ValueParts {
    const part = (name: string) => numberOf(answer.columns.get(name), row[name]);
    const v = `v${index}`;
    switch (value.measure.type) {
        case "count": case "sum": return { kind: "added", top: part(v), bottom: 0 };
        case "distinct": return { kind: "distinct", top: part(v), bottom: 0 };
        case "min": return { kind: "least", top: part(v), bottom: 0 };
        case "max": return { kind: "most", top: part(v), bottom: 0 };
        case "mean": return { kind: "divided", top: part(`${v}s`), bottom: part(`${v}c`) ?? 0 };
        case "ratio": return { kind: "divided", top: part(`${v}o`), bottom: part(`${v}p`) ?? 0 };
    }
}

/**
 * The value parts make: a mean's or a ratio's division, the others as they
 * are.
 *
 * @param parts - The parts
 * @returns The number, or `undefined` for "no data": a mean or a ratio over nothing, a least or a most of no values
 */
export function partsValue(parts: ValueParts): number | undefined {
    if (parts.kind !== "divided") return parts.top;
    return parts.top === undefined || parts.bottom === 0 ? undefined : parts.top / parts.bottom;
}

/** Two numbers added, either absent. */
function addedOf(a: number | undefined, b: number | undefined): number | undefined {
    return a === undefined ? b : b === undefined ? a : a + b;
}

/**
 * Two groups' parts folded into one's: what Other and a group's head hold.
 *
 * @param a - One group's parts
 * @param b - The other's, of the same value
 * @returns The folded parts; `undefined` for a distinct count, which no fold makes
 */
export function foldParts(a: ValueParts, b: ValueParts): ValueParts | undefined {
    switch (a.kind) {
        case "added": case "divided": return { kind: a.kind, top: addedOf(a.top, b.top), bottom: a.bottom + b.bottom };
        case "least": case "most": {
            if (a.top === undefined || b.top === undefined) return { kind: a.kind, top: a.top ?? b.top, bottom: 0 };
            return { kind: a.kind, top: a.kind === "least" ? Math.min(a.top, b.top) : Math.max(a.top, b.top), bottom: 0 };
        }
        case "distinct": return undefined;
    }
}

/**
 * A total's parts less some groups' folded parts: what the rest of a total's
 * rows hold — a pie's Other past its first slices.
 *
 * @param total - The total's parts
 * @param shown - The groups' folded parts, of the same value
 * @returns The rest's parts; `undefined` for a least, a most or a distinct count, which no subtraction makes
 */
export function lessParts(total: ValueParts, shown: ValueParts): ValueParts | undefined {
    if (total.kind !== "added" && total.kind !== "divided") return undefined;
    return { kind: total.kind, top: total.top === undefined ? undefined : total.top - (shown.top ?? 0), bottom: total.bottom - shown.bottom };
}

/**
 * A value of an answer's row: its parts made one — a mean of its sum and
 * count, a ratio of its two sums — or `undefined` where there is none to
 * make: a mean or a ratio over nothing, a least or a most of no values.
 *
 * @param answer - The answer: its rows' columns and their types
 * @param row - The row
 * @param index - The value's index among the visual's values
 * @param value - The value
 * @returns The number, or `undefined` for "no data"
 */
export function visualValue(answer: VisualAnswered, row: Readonly<Record<string, unknown>>, index: number, value: VisualValue): number | undefined {
    return partsValue(visualParts(answer, row, index, value));
}
