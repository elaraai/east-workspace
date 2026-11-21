/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Asking a visual's programs (#1670): answers kept by program and dataset
 * hash, one call however many tiles ask, given up once none waits, a failure
 * never kept; and each program run as the query builder runs one — one call,
 * or a split call over a large dataset's pieces.
 */

import { describe, expect, it } from "vitest";
import { ArrayType, DateTimeType, FloatType, IntegerType, StringType, StructType, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import type { QueryCall, QuerySplitCall } from "../hooks.js";
import { createInMemoryQueryCall, createInMemorySourceStatus, createInMemorySplitCall } from "../in-memory-call.js";
import { AnswerCache, type KeptResult } from "../model/summaries.js";
import { queryRoot } from "../one-shot.js";
import { askProgram, VisualAnswers, VisualAskError, visualAnswerType, visualReadRows, visualValue, type VisualAnswer } from "./ask.js";
import { printVisual } from "./print.js";
import { printSourceOf } from "./source.js";

const Row =StructType({ ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType });
const PATH = [variant("field", "inputs"), variant("field", "orders")];
const ORDERS: ValueTypeOf<typeof Row>[] = [
    { ordered_at: at("2026-07-03T10:00:00"), region: "SA", revenue: 100, units: 4n },
    { ordered_at: at("2026-07-20T10:00:00"), region: "NSW", revenue: 50, units: 1n },
    { ordered_at: at("2026-08-02T10:00:00"), region: "SA", revenue: 60, units: 2n },
];
const DATASETS = [{ path: PATH, type: ArrayType(Row), value: ORDERS }];
const ROOT = queryRoot([{ name: "orders", path: PATH, type: toEastTypeValue(ArrayType(Row)) }]);
const SOURCE = printSourceOf({
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", PATH), type: toEastTypeValue(ArrayType(Row)) },
    fields: [], range: some("ordered_at"),
})!;

const v = Studio.visual;
/** A visual's content's visual. */
function visualOf(content: ReturnType<typeof Studio.visual.of>) {
    if (content.type !== "visual") throw new Error("not a visual");
    return content.value;
}
/** A visual's first program. */
function programOf(content: ReturnType<typeof Studio.visual.of>): string {
    const printed = printVisual(visualOf(content), SOURCE, { filters: [] });
    if (printed.kind !== "asks") throw new Error(printed.kind);
    return printed.asks[0]!.program;
}

/** A one-shot call that counts its calls. */
function counted(call: QueryCall): { call: QueryCall; calls: () => number } {
    let n = 0;
    return { call: (request, options) => { n += 1; return call(request, options); }, calls: () => n };
}

const NO_HASHES: ReadonlyMap<string, string> = new Map();

describe("AnswerCache", () => {
    it("runs a program once however many ask while it is in flight, and keeps it until a source it read moves", async () => {
        let runs = 0;
        const cache = new AnswerCache<{ prefix: string; reads: string[] }, number>(async (request) => {
            runs += 1;
            return { value: request.prefix.length, hashes: new Map([["orders", "h1"]]) };
        });
        const request = { prefix: ".orders | length", reads: ["orders"] };
        const [a, b] = await Promise.all([cache.ensure(request, NO_HASHES), cache.ensure(request, NO_HASHES)]);
        expect([a, b, runs]).toEqual([16, 16, 1]);
        expect(cache.get(request, new Map([["orders", "h1"]]))).toBe(16);
        expect(cache.get(request, new Map([["orders", "h2"]]))).toBeUndefined();
        await cache.ensure(request, new Map([["orders", "h2"]]));
        expect(runs).toBe(2);
    });

    it("keeps an answer that read nothing by the hashes its asker saw, and the run's hash over the asker's", async () => {
        // A problem: the run ended before it read the dataset, and names no hash for it.
        let runs = 0;
        const problems = new AnswerCache<{ prefix: string; reads: string[] }, string>(async () => {
            runs += 1;
            return { value: "problem", hashes: new Map() };
        });
        const request = { prefix: ".orders | .nope", reads: ["orders"] };
        const seen = new Map([["orders", "h1"]]);
        await problems.ensure(request, seen);
        expect(problems.get(request, seen)).toBe("problem");
        expect(problems.get(request, new Map([["orders", "h2"]]))).toBeUndefined();
        expect(runs).toBe(1);

        // The run read a newer hash than its asker saw: the answer is that hash's.
        const newer = new AnswerCache<{ prefix: string; reads: string[] }, string>(async () => ({ value: "rows", hashes: new Map([["orders", "h2"]]) }));
        await newer.ensure(request, seen);
        expect(newer.get(request, new Map([["orders", "h2"]]))).toBe("rows");
        expect(newer.get(request, seen)).toBeUndefined();
    });

    it("gives a run up once every asker has stopped waiting, and keeps no failure", async () => {
        let given: AbortSignal | undefined;
        const cache = new AnswerCache<{ prefix: string; reads: string[] }, number>((_request, signal) => {
            given = signal;
            return new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined)));
        });
        const request = { prefix: ".x", reads: [] };
        const one = new AbortController();
        const two = new AbortController();
        const answers = [cache.ensure(request, NO_HASHES, one.signal), cache.ensure(request, NO_HASHES, two.signal)];
        one.abort();
        await Promise.resolve();
        expect(given?.aborted).toBe(false);
        two.abort();
        await Promise.resolve();
        expect(given?.aborted).toBe(true);
        expect(await Promise.all(answers)).toEqual([undefined, undefined]);

        let tries = 0;
        const failing = new AnswerCache<{ prefix: string; reads: string[] }, number>(async () => {
            tries += 1;
            throw new VisualAskError("unreachable", "no server");
        });
        await expect(failing.ensure(request, NO_HASHES)).rejects.toThrow("no server");
        await expect(failing.ensure(request, NO_HASHES)).rejects.toThrow("no server");
        expect(tries).toBe(2);
    });

    it("serves an asker who has come to know a hash its run's askers did not, and runs again for another hash", async () => {
        let runs = 0;
        const finish: ((result: KeptResult<string>) => void)[] = [];
        const cache = new AnswerCache<{ prefix: string; reads: string[] }, string>(() => {
            runs += 1;
            return new Promise((resolve) => { finish.push(resolve); });
        });
        const request = { prefix: ".orders | length", reads: ["orders"] };
        // A tile asks before the page's poll has read its source's hash, and again once it has: one run.
        const before = cache.ensure(request, NO_HASHES);
        const after = cache.ensure(request, new Map([["orders", "h1"]]));
        expect(runs).toBe(1);
        // Another hash than the run's askers knew: another run.
        const moved = cache.ensure(request, new Map([["orders", "h2"]]));
        expect(runs).toBe(2);
        // The first run ends before it reads: its answer is kept by the hash its later asker knew.
        finish[0]!({ value: "problem", hashes: NO_HASHES });
        expect(await Promise.all([before, after])).toEqual(["problem", "problem"]);
        expect(cache.get(request, new Map([["orders", "h1"]]))).toBe("problem");
        finish[1]!({ value: "rows", hashes: new Map([["orders", "h2"]]) });
        expect(await moved).toBe("rows");
        expect(runs).toBe(2);
    });

    it("keeps a run whose last asker stops and asks again in the same turn, as a page drawn again does", async () => {
        let runs = 0;
        let given: AbortSignal | undefined;
        let finish: (result: KeptResult<number>) => void = () => undefined;
        const cache = new AnswerCache<{ prefix: string; reads: string[] }, number>((_request, signal) => {
            runs += 1;
            given = signal;
            return new Promise((resolve) => { finish = resolve; });
        });
        const request = { prefix: ".x", reads: [] };
        const drawn = new AbortController();
        void cache.ensure(request, NO_HASHES, drawn.signal);
        // Drawn again: its effect stops, and starts again at once.
        drawn.abort();
        const again = cache.ensure(request, NO_HASHES, new AbortController().signal);
        await Promise.resolve();
        expect(given?.aborted).toBe(false);
        finish({ value: 7, hashes: NO_HASHES });
        expect([await again, runs]).toEqual([7, 1]);
    });
});

describe("askProgram", () => {
    it("answers a visual's program as the builder runs it, and its values are made of their parts", async () => {
        const content = v.of("orders", v.column({ x: v.group("region"), values: [v.mean("revenue"), v.ratio("revenue", "units"), v.min("units")] }));
        const seams = { call: createInMemoryQueryCall(DATASETS), split: undefined, collection: undefined, status: createInMemorySourceStatus(DATASETS) };
        const kept = await askProgram(programOf(content), ROOT, seams, {}, new AbortController().signal);
        const answer = kept!.value;
        if (answer.kind !== "answered") throw new Error(answer.kind);
        expect([answer.groups, answer.n]).toEqual([2, 3]);
        const sa = answer.rows.find(row => row["g0"] === "SA")!;
        const values = visualOf(content).view;
        if (values.type !== "chart" || values.value.type !== "column") throw new Error("not a column");
        const [mean, ratio, min] = values.value.value.values;
        expect([visualValue(answer, sa, 0, mean!), visualValue(answer, sa, 1, ratio!), visualValue(answer, sa, 2, min!)]).toEqual([80, 160 / 6, 2]);
        expect([...kept!.hashes.keys()]).toEqual(["orders"]);
    });

    it("splits a program over a large dataset's pieces, and answers alike", async () => {
        const content = v.of("orders", v.bar({ x: v.group("region"), values: [v.sum("revenue")] }));
        const program = programOf(content);
        const oneCall = await askProgram(program, ROOT, { call: createInMemoryQueryCall(DATASETS), split: undefined, collection: undefined, status: undefined }, {}, new AbortController().signal);
        let splits = 0;
        const split = createInMemorySplitCall(DATASETS, { pieces: 3 });
        const counting: QuerySplitCall = (request, options) => { splits += 1; return split(request, options); };
        // A dataset that weighs more than one piece: the plan splits it.
        const weighed = [{ ...DATASETS[0]!, bytes: 64 * 2 ** 20 }];
        const pieces = await askProgram(program, ROOT, { call: undefined, split: counting, collection: undefined, status: createInMemorySourceStatus(weighed) }, { pieceBytes: 1 }, new AbortController().signal);
        expect(splits).toBe(1);
        const rows = (kept: typeof oneCall) => (kept?.value.kind === "answered" ? kept.value.rows : undefined);
        expect(rows(pieces)).toEqual(rows(oneCall));
    });

    it("says a call that never answered, and keeps the checker's refusal as an answer", async () => {
        await expect(askProgram(".orders | length", ROOT, { call: undefined, split: undefined, collection: undefined, status: undefined }, {}, new AbortController().signal))
            .rejects.toBeInstanceOf(VisualAskError);
        const refused = await askProgram(".orders | .nope", ROOT, { call: undefined, split: undefined, collection: undefined, status: undefined }, {}, new AbortController().signal);
        expect(refused?.value.kind).toBe("problem");
    });

    it("refuses an answer that is not a visual program's: its rows, groups and n", async () => {
        const seams = { call: createInMemoryQueryCall(DATASETS), split: undefined, collection: undefined, status: undefined };
        await expect(askProgram(".orders | length", ROOT, seams, {}, new AbortController().signal)).rejects.toThrow("not its rows, groups and n");
        expect(visualAnswerType(IntegerType)).toBeUndefined();
        expect(visualAnswerType(StructType({ rows: ArrayType(IntegerType), groups: IntegerType, n: IntegerType }))).toBeUndefined();
    });
});

describe("visualReadRows", () => {
    it("is no data only when no program read a row: an earlier period's empty answer leaves this one's", async () => {
        const seams = { call: createInMemoryQueryCall(DATASETS), split: undefined, collection: undefined, status: undefined };
        const ask = async (program: string) => (await askProgram(program, ROOT, seams, {}, new AbortController().signal))!.value;
        const empty = await ask(`.orders | map(select(.region == "WA")) | {rows: [{v0: length, n: length}], groups: 1, n: length}`);
        const read = await ask(".orders | {rows: [{v0: length, n: length}], groups: 1, n: length}");
        expect([visualReadRows([empty, read]), visualReadRows([empty]), visualReadRows([])]).toEqual([true, false, false]);
    });
});

describe("VisualAnswers", () => {
    it("asks a page of 20 visuals on two sources once a distinct program, and none when it draws again", async () => {
        const Asset = StructType({ machine: StringType, hours: FloatType });
        const ASSETS = [variant("field", "inputs"), variant("field", "assets")];
        const datasets = [...DATASETS, { path: ASSETS, type: ArrayType(Asset), value: [{ machine: "M-1", hours: 4 }, { machine: "M-2", hours: 6 }] }];
        const root = queryRoot([
            { name: "orders", path: PATH, type: toEastTypeValue(ArrayType(Row)) },
            { name: "assets", path: ASSETS, type: toEastTypeValue(ArrayType(Asset)) },
        ]);
        const { call, calls } = counted(createInMemoryQueryCall(datasets));
        const answers = new VisualAnswers((program, signal) => askProgram(program, root, { call, split: undefined, collection: undefined, status: undefined }, {}, signal));
        // Four distinct programs, each asked by five tiles.
        const programs = [
            ".orders | {rows: [{v0: length, n: length}], groups: 1, n: length}",
            ".orders | {rows: [{v0: (map(.revenue) | add), n: length}], groups: 1, n: length}",
            ".assets | {rows: [{v0: length, n: length}], groups: 1, n: length}",
            ".assets | {rows: [{v0: (map(.hours) | add), n: length}], groups: 1, n: length}",
        ];
        const tiles = Array.from({ length: 20 }, (_, i) => ({ prefix: programs[i % 4]!, reads: [i % 4 < 2 ? "orders" : "assets"] }));
        const first = await Promise.all(tiles.map(tile => answers.ensure(tile, NO_HASHES)));
        expect(calls()).toBe(4);
        expect(first.every((answer: VisualAnswer | undefined) => answer?.kind === "answered")).toBe(true);
        // Drawn again: every answer is held.
        expect(tiles.every(tile => answers.get(tile, NO_HASHES) !== undefined)).toBe(true);
        expect(calls()).toBe(4);
    });
});
