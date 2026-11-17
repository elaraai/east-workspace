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

import { decodeBeast2, fromEastTypeValue, type EastType, type option } from "@elaraai/east";
import { AnswerCache, readHashes, type KeptRequest, type KeptResult } from "../model/summaries.js";
import { queryResultOf, type QueryResult, type QueryRoot } from "../one-shot.js";
import { draftPlan, type PlanOptions } from "../plan.js";
import { messageOf, runDraft, type DraftRunSeams } from "../run-draft.js";
import { optionPayload, rowOf } from "../steps/shape.js";
import type { VisualValue } from "./print.js";

/**
 * One program's answer.
 *
 * @remarks
 * - `answered` — its rows, each column's East type, how many groups there
 *   were before the cut, and how many source rows it read: none is "no data".
 * - `problem` — it ended otherwise: the checker's problems, an error the run
 *   raised, a dataset with no value yet, out of time or too large — its
 *   result, which says which.
 */
export type VisualAnswer =
    | {
        readonly kind: "answered"; readonly result: QueryResult; readonly rows: readonly Readonly<Record<string, unknown>>[];
        readonly columns: ReadonlyMap<string, EastType>; readonly groups: number; readonly n: number;
    }
    | { readonly kind: "problem"; readonly result: QueryResult };

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

/** The answer's struct, as every visual program gives it. */
interface AnswerStruct {
    readonly rows: readonly Readonly<Record<string, unknown>>[];
    readonly groups: bigint;
    readonly n: bigint;
}

/** Each column of an answer's rows, with its East type: the fields of each row `rows` holds, as the query's steps read rows. */
function columnsOf(type: EastType): ReadonlyMap<string, EastType> {
    const rows = type.type === "Struct" ? (type.fields as Record<string, EastType | undefined>)["rows"] : undefined;
    const row = rows === undefined ? undefined : rowOf(rows);
    return row?.type === "Struct" ? new Map(Object.entries(row.fields as Record<string, EastType>)) : new Map();
}

/**
 * Asks one program on e3: drafted, planned and called as the query builder
 * runs a query, and its answer read.
 *
 * @param program - The program, as the printer gave it
 * @param root - The root its data sources make
 * @param seams - How its calls are made
 * @param options - How it plans
 * @param signal - Gives it up
 * @returns Its answer and the hashes of the datasets it read; `undefined` when it was given up
 * @throws {VisualAskError} When a call never answered: e3 could not be reached, or refused it
 */
export async function askProgram(
    program: string, root: QueryRoot, seams: DraftRunSeams, options: PlanOptions, signal: AbortSignal,
): Promise<KeptResult<VisualAnswer> | undefined> {
    let drafted: ReturnType<typeof draftPlan>;
    try {
        drafted = draftPlan(program, root, options);
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
            const hashes = readHashes(result);
            if (result.outcome.type !== "ok") return { value: { kind: "problem", result }, hashes };
            const decoded = decodeBeast2(result.outcome.value.result);
            const answer = decoded.value as AnswerStruct;
            return { value: { kind: "answered", result, rows: answer.rows, columns: columnsOf(fromEastTypeValue(decoded.type)), groups: Number(answer.groups), n: Number(answer.n) }, hashes };
        }
    }
}

/** A program a page asks: its text, which its answer is kept by, and the source it reads. */
export interface VisualRequest extends KeptRequest {
    /** The program's text. */
    readonly prefix: string;
    /** The source it reads, by its name in the root. */
    readonly reads: readonly string[];
}

/**
 * A page's answers: each program asked once per the hashes of what it read,
 * however many tiles ask it, and given up once none waits for it.
 */
export class VisualAnswers extends AnswerCache<VisualRequest, VisualAnswer> {
    /**
     * @param ask - Asks a program ({@link askProgram} over the page's root, calls and options)
     */
    constructor(ask: (program: string, signal: AbortSignal) => Promise<KeptResult<VisualAnswer> | undefined>) {
        super((request, signal) => ask(request.prefix, signal));
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
export function visualValue(answer: Extract<VisualAnswer, { kind: "answered" }>, row: Readonly<Record<string, unknown>>, index: number, value: VisualValue): number | undefined {
    const part = (name: string) => numberOf(answer.columns.get(name), row[name]);
    const v = `v${index}`;
    switch (value.measure.type) {
        case "count": case "sum": case "distinct": case "min": case "max":
            return part(v);
        case "mean": {
            const count = part(`${v}c`);
            const sum = part(`${v}s`);
            return count === undefined || sum === undefined || count === 0 ? undefined : sum / count;
        }
        case "ratio": {
            const per = part(`${v}p`);
            const of = part(`${v}o`);
            return per === undefined || of === undefined || per === 0 ? undefined : of / per;
        }
    }
}
