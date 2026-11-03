/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A run's plan (#941), over #875's shared fixture: N1 at the words level — the
 * golden explanation of every combine kind, every reason a query runs as one
 * unit, every read that prunes, and every reason a query that splits is still
 * one call; the path by what the dataset weighs, against e3's smallest piece
 * or the options' own; the path by its estimated time and memory (#1143) — a
 * dataset within one piece, or a little over it with cheap rows, one call; a
 * split chosen for time over 1 GB, and one call estimated to hold more than
 * the memory it may use split; no rows known, or the options' own piece, by
 * weight; a re-keyed join's two calls; what one call holds; and the estimates
 * and what they assumed in words; the split call's request, decoded back — each
 * argument's partition, the output kind, its programs and a fold's zero, the
 * runner and the limits — its answer at the type the one-shot translation
 * gives; the visual view's split program, its sort's first rows kept in the
 * pieces and its counts run once after them; joins (#942) — two dicts keyed
 * alike cut at the same keys, and a join of two large datasets re-keyed into
 * two split calls, the second over the first's output by its hash; and every
 * split, run in memory over 1, 3 and 7 pieces, answering as its one-shot call
 * does.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
    ArrayType, DictType, FloatType, IntegerType, NullType, SetType, SortedMap, StringType,
    checkJq, compareFor, decodeBeast2, decodeBeast2For, decodeEastIR, equalFor, fromEastTypeValue, isTypeEqual, isVariant, none, some, splitJq,
    toEastTypeValue, variant, walkIR,
    type EastType, type EastTypeValue,
} from "@elaraai/east";
import { PIECE_SIZES, TreePathType, pieceSizesFor, type SplitCallRequest, type TreePath } from "@elaraai/e3-types";
import { formatters } from "@elaraai/east-ui-components";
import { createInMemoryQueryCall, createInMemorySplitCall } from "./in-memory-call.js";
import { planBadge, planWords, queryWords } from "./model/words.js";
import { prepareQuery, queryResultOf, queryRoot, type QueryResult, type QueryRootEntry } from "./one-shot.js";
import { PLAN_COSTS, planQuery, splitCallRequest, type PlanExplanation, type PlanOptions, type QueryPlan, type SourceWeight } from "./plan.js";

// ─── The fixture as a root ───────────────────────────────────────────────────

/** The shared fixture: its root type and its datasets. */
const fixture = decodeBeast2(readFileSync(join(import.meta.dirname, "../../../../../east/test/fixtures/query-fixture.beast2")));
const DATASETS = fixture.value as Readonly<Record<string, unknown>>;

/** A dataset's path: an input of the workspace. */
const pathOf = (name: string): TreePath => [variant("field", "inputs"), variant("field", name)];

/** The fixture's datasets as a root's data sources, in its order: bom, byId, cells, customers, forecast, model, orders. */
function rootFields(type: EastTypeValue): { name: string; type: EastTypeValue }[] {
    if (type.type !== "Struct") throw new Error(`the fixture's root is a Struct, not ${type.type}`);
    return type.value;
}
const ENTRIES: QueryRootEntry[] = rootFields(fixture.type).map(({ name, type }) => ({ name, path: pathOf(name), type }));
const ROOT = queryRoot(ENTRIES);

/** The fixture's datasets, in memory, as the stand-ins hold them. */
const IN_MEMORY = ENTRIES.map(e => ({ path: e.path, type: fromEastTypeValue(e.type), value: DATASETS[e.name] }));

const words = queryWords(formatters("en-US"));

/** 1.5 GiB: a dataset far larger than one piece. */
const LARGE = 1_610_612_736;

/**
 * Every dataset the fixture's queries split over, weighed as large, their rows
 * not known: each path is by weight alone, as before the estimates (#1143),
 * whose own tests weigh rows too.
 */
const HEAVY: ReadonlyMap<string, SourceWeight> = new Map([["orders", { bytes: LARGE, rows: undefined }], ["byId", { bytes: LARGE, rows: undefined }], ["cells", { bytes: LARGE, rows: undefined }]]);

/** A program's plan; the test fails when the program does not check. */
function plan(program: string, weights: ReadonlyMap<string, SourceWeight> = HEAVY, pieceBytes?: number): QueryPlan {
    const planned = planQuery(program, ROOT, weights, pieceBytes === undefined ? {} : { pieceBytes });
    if ("result" in planned) throw new Error(`${program} does not check`);
    return planned.plan;
}

/** A plan's explanation as text: a line per sentence, each with the jq it is about in «». */
function explained(explanation: PlanExplanation, run: Parameters<typeof planWords>[2] = {}): string {
    return planWords(explanation, words, run).map(line => (line.code === undefined ? line.text : `${line.text} «${line.code}»`)).join("\n");
}

// ─── N1: golden explanations ─────────────────────────────────────────────────

/** A split call over orders, weighed as 1.5 GiB. */
const SPLIT = "Split call over orders: it weighs 1.5 GB, more than one piece (16 MB).";

/** Each combine kind, and the explanation its split gives. */
const SPLITS: readonly (readonly [program: string, explanation: string])[] = [
    // The rows joined; or a sort's first rows kept, each piece's and then theirs together (#942), and what runs once after.
    [".orders | map(.id)", [SPLIT, "Each piece of orders runs: «.orders | map(.id)»", "Their rows are joined in order."].join("\n")],
    [".orders | map(select(.total > 500)) | sort_by(-.total) | .[:5]", [
        SPLIT,
        "Each piece of orders runs: «.orders | map(select(.total > 500))»",
        "The first 5 rows of the sort are kept, each piece's and then theirs together, by: «-.total»",
        "Then, once, over what they combine to: «.[:5]»",
    ].join("\n")],
    [".orders | sort_by(.total) | .[0].id", [
        SPLIT,
        "Each piece of orders runs: «.orders»",
        "The first row of the sort is kept, each piece's and then theirs together, by: «.total»",
        "Then, once, over what they combine to: «.[0].id»",
    ].join("\n")],
    // Totals, each by its rule.
    [".orders | map(.total) | add", [
        SPLIT, "Each piece of orders runs: «.orders | map(.total)»", "Their totals combine, each by its rule:", "Added up: «add»",
    ].join("\n")],
    [".orders | map(select(.total > 500)) | length", [
        SPLIT, "Each piece of orders runs: «.orders | map(select(.total > 500))»", "Their totals combine, each by its rule:", "Counted: «length»",
    ].join("\n")],
    [".orders | {n: length, mean: (map(.total) | add / length)}", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their totals combine, each by its rule:",
        "Counted: «length»", "Added up: «map(.total) | add»", "Counted: «map(.total) | add / length»",
    ].join("\n")],
    [".orders | min_by(.total) | .id", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their totals combine, each by its rule:", "The lowest kept: «min_by(.total)»",
        "Then, once, over what they combine to: «.id»",
    ].join("\n")],
    [".orders | map(.total) | max", [
        SPLIT, "Each piece of orders runs: «.orders | map(.total)»", "Their totals combine, each by its rule:", "The highest kept: «max»",
    ].join("\n")],
    [".orders | map(.total) | first", [
        SPLIT, "Each piece of orders runs: «.orders | map(.total)»", "Their totals combine, each by its rule:", "The first kept: «first»",
    ].join("\n")],
    [".orders | map(.total) | .[-1]", [
        SPLIT, "Each piece of orders runs: «.orders | map(.total)»", "Their totals combine, each by its rule:", "The last kept: «.[-1]»",
    ].join("\n")],
    [".orders | any(.total > 3000)", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their totals combine, each by its rule:", "True if any is: «any(.total > 3000)»",
    ].join("\n")],
    [".orders | all(.total > 10)", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their totals combine, each by its rule:", "True if all are: «all(.total > 10)»",
    ].join("\n")],
    [".orders | {customers: (map(.customer_id) | unique | length)}", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their totals combine, each by its rule:", "The distinct values kept: «map(.customer_id) | unique»",
    ].join("\n")],
    // Grouped by a key: each group's totals, or its rows.
    [".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add})", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their rows are grouped by: «.customer_id»", "Each group's totals combine, each by its rule:",
        "The first kept: «.[0]»", "Added up: «map(.total) | add»",
    ].join("\n")],
    [".orders | group_by(.customer_id) | map(sort_by(.total) | .[0].id)", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their rows are grouped by: «.customer_id»", "Each group's rows are collected.",
    ].join("\n")],
    // The distinct rows, and the first row of each key.
    [".orders | map(.customer_id) | unique | length", [
        SPLIT, "Each piece of orders runs: «.orders | map(.customer_id)»", "Their distinct rows are kept: «unique»",
        "Then, once, over what they combine to: «length»",
    ].join("\n")],
    [".orders | unique_by(.customer_id) | map(.id)", [
        SPLIT, "Each piece of orders runs: «.orders»", "The first row of each key is kept, by: «.customer_id»",
        "Then, once, over what they combine to: «map(.id)»",
    ].join("\n")],
    // A reduce's updates, added or the last kept.
    ["reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)", [
        SPLIT, "Each piece of orders runs: «reduce .orders[]»", "Their updates combine by key, added: «$o.customer_id»",
    ].join("\n")],
    [".orders | reduce .[] as $o ({}; .[$o.customer_id] = $o.id)", [
        SPLIT, "Each piece of orders runs: «.orders»", "Their updates combine by key, the last kept: «$o.customer_id»",
    ].join("\n")],
    // A stream's first rows, in input order (#1113): each piece stops once it has them.
    ["first(.orders[] | select(.total > 1000)) | .id", [
        SPLIT, "Each piece of orders runs: «.orders[] | select(.total > 1000)»",
        "The first row, in input order, is kept: each piece stops at its first, and the call once the pieces before the rest have one: «first(.orders[] | select(.total > 1000))»",
        "Then, once, over what they combine to: «.id»",
    ].join("\n")],
    ["limit(3; .orders[] | select(.total > 100) | .id)", [
        SPLIT, "Each piece of orders runs: «.orders[] | select(.total > 100) | .id»",
        "The first 3 rows, in input order, are kept: each piece stops once it has 3, and the call once the pieces before the rest have them: «limit(3; .orders[] | select(.total > 100) | .id)»",
    ].join("\n")],
    // A data source every piece reads whole.
    [".customers as $c | .orders | map($c[.customer_id].region) | unique", [
        SPLIT, "Each piece of orders runs: «.orders | map($c[.customer_id].region)»", "Their distinct rows are kept: «unique»",
        "Every piece reads customers whole.",
    ].join("\n")],
];

/** Each reason a query runs as one unit, and each read that prunes, and the explanation it gives. */
const WHOLES: readonly (readonly [program: string, explanation: string])[] = [
    [".orders | length", [
        "One call: it reads a count, a key or a value of orders, and works through none of its rows.",
        "Reads the count from the index of orders, and no segment: «.orders | length»",
    ].join("\n")],
    [".byId[1010] | .total", [
        "One call: it reads a count, a key or a value, and works through no data source's rows.",
        "Reads only the segment of byId that holds the key: «.byId[1010]»",
    ].join("\n")],
    [".byId | has(1010)", [
        "One call: it reads a count, a key or a value of byId, and works through none of its rows.",
        "Reads only the segment of byId that holds the key: «.byId | has(1010)»",
    ].join("\n")],
    [".forecast", "One call: it reads a count, a key or a value of forecast, and works through none of its rows."],
    ["{revenue: (.orders | map(.total) | add)}", "One call: it works through rows inside an expression, not as its own pipeline: «.orders | map(.total) | add»"],
    [".orders[] | .id", [
        "One call: its outputs stream from orders, and one call stops once it has as many as a run returns.",
        "Reads only the segments of orders it reaches before it stops: «.orders[]»",
    ].join("\n")],
    // A count the query computes is the one call's to read.
    ["limit(.orders | length; .orders[] | .id)",
        "One call: it keeps only its first outputs, and one call stops as soon as it has them: «limit(.orders | length; .orders[] | .id)»"],
    [".orders | .[0:3]", "One call: it takes rows by their position, and one call reads only as far as it needs: «.[0:3]»"],
    // A sort whose every row the query keeps: no first rows to keep in the pieces.
    [".orders | sort_by(.total) | reverse", "One call: a step needs every row at once, and no work is done row by row before it: «sort_by(.total)»"],
    [".orders | foreach .[] as $o (0; . + 1)", "One call: a step carries state from row to row: «foreach .[] as $o (0; . + 1)»"],
    [".model as $m | .orders | map(call($m; {price: .total, region: \"NSW\"}))",
        "One call: the work on each row calls a function value, which may call a platform function the runner doesn't load: «call($m; {price: .total, region: \"NSW\"})»"],
    [".orders as $all | .orders | map(.total / ($all | length))",
        "One call: it reads orders again, outside the rows it works through: «.orders as $all | .orders | map(.total / ($all | length))»"],
    [".orders | group_by(.lines) | map(length)", "One call: it groups by a key that isn't one value a lookup table can hold: «.lines»"],
    ["def big: .total > 1000; .orders | map(select(big))",
        "One call: it isn't a pipeline the planner splits: «def big: .total > 1000; .orders | map(select(big))»"],
];

describe("N1: golden explanations, at the words level", () => {
    for (const [program, expected] of SPLITS) {
        test(`a split: ${program}`, () => {
            const p = plan(program);
            expect(p.kind).toBe("split");
            expect(explained(p.explanation)).toBe(expected);
        });
    }
    for (const [program, expected] of WHOLES) {
        test(`one unit: ${program}`, () => {
            const p = plan(program);
            expect(p.kind).toBe("one_shot");
            expect(explained(p.explanation)).toBe(expected);
        });
    }

    test("a split's pieces, once e3 says how many — and how far it has got while it goes", () => {
        const p = plan(".orders | map(.total) | add");
        const lines = (run: Parameters<typeof planWords>[2]) => planWords(p.explanation, words, run).filter(line => line.kind === "pieces").map(line => line.text);
        expect(lines({})).toEqual([]);
        expect(lines({ pieces: 24 })).toEqual(["Orders is cut into 24 pieces, about 64 MB each."]);
        expect(lines({ pieces: 1 })).toEqual(["Orders is cut into 1 piece, about 1.5 GB each."]);
        expect(lines({ pieces: 24, progress: { phase: variant("partition", null), done: 3n, units: 24n } })).toEqual(["3 of 24 pieces done"]);
        expect(lines({ pieces: 24, progress: { phase: variant("combine", null), done: 0n, units: 1n } })).toEqual(["0 of 1 fold done"]);
        expect(lines({ pieces: 24, progress: { phase: variant("merge", null), done: 1n, units: 3n } })).toEqual(["1 of 3 merges done"]);
    });

    test("how a split call's units ran, once it answered (#1105): in the read-out the units the cache served, and in the explanation all of them", () => {
        const p = plan(".orders | map(.total) | add");
        const report = (ran: bigint, cached: bigint) => ({ pieces: 24n, ran, cached, peakBytes: none });
        const units = (run: Parameters<typeof planWords>[2]) => planWords(p.explanation, words, run).filter(line => line.kind === "units").map(line => line.text);
        expect([planBadge(p, words, { pieces: 24 }), units({ pieces: 24 })]).toEqual(["Split call · 24 pieces", []]);
        expect([planBadge(p, words, { pieces: 24, report: report(25n, 0n) }), units({ pieces: 24, report: report(25n, 0n) })])
            .toEqual(["Split call · 24 pieces", ["All 25 of its units ran: the cache held none."]]);
        expect([planBadge(p, words, { pieces: 24, report: report(3n, 22n) }), units({ pieces: 24, report: report(3n, 22n) })])
            .toEqual(["Split call · 24 pieces · 22 units cached", ["The cache served 22 of its 25 units, and 3 ran."]]);
        // Served whole: it consulted no unit.
        expect([planBadge(p, words, { pieces: 24, report: report(0n, 0n) }), units({ pieces: 24, report: report(0n, 0n) })])
            .toEqual(["Split call · 24 pieces · all cached", ["The cache served the whole call: no unit ran."]]);
        // While it goes, its progress alone.
        const going = { pieces: 24, progress: { phase: variant("partition", null), done: 3n, units: 24n }, report: report(3n, 22n) };
        expect([planBadge(p, words, going), units(going)]).toEqual(["Split call · 3 of 24 pieces done", []]);
    });

    test("a query that would split is one call within one piece, or when what its dataset weighs isn't known", () => {
        expect(explained(plan(".orders | map(.total) | add", new Map([["orders", { bytes: 4_096, rows: 40 }]])).explanation))
            .toBe("One call: orders weighs 4 KB, within one piece (16 MB).");
        expect(explained(plan(".orders | map(.total) | add", new Map()).explanation)).toBe("One call: what orders weighs isn't known.");
        // A weight with no bytes is not known either.
        expect(explained(plan(".orders | map(.total) | add", new Map([["orders", { bytes: undefined, rows: 40 }]])).explanation))
            .toBe("One call: what orders weighs isn't known.");
    });

    test("a split call that could not be made is one call, and says why", () => {
        const explanation: PlanExplanation = {
            program: ".orders | map(.total) | add",
            path: { kind: "one_shot", why: { kind: "unsplit", over: "orders", message: "the run's split program splits otherwise than the query: fold over orders" } },
            estimates: null,
            pruning: [],
        };
        expect(explained(explanation)).toBe("One call: the split call couldn't be made — the run's split program splits otherwise than the query: fold over orders");
    });
});

// ─── The path, by what the dataset weighs ────────────────────────────────────

describe("the path, by what the dataset weighs", () => {
    const program = ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, n: length})";
    // Its rows not known: by weight alone (#1143).
    const weighing = (bytes: number | undefined) => new Map([["orders", { bytes, rows: undefined }]]);

    test("e3's smallest piece by default: within it one call, over it a split call", () => {
        expect(PIECE_SIZES.min).toBe(16 * 2 ** 20);
        expect(plan(program, weighing(PIECE_SIZES.min)).kind).toBe("one_shot");
        expect(plan(program, weighing(PIECE_SIZES.min + 1)).kind).toBe("split");
        expect(plan(program, weighing(undefined)).kind).toBe("one_shot");
    });

    test("e3's piece sizes for the dataset (#1108): one call where they make it one piece, a split call where they cut it", () => {
        // A dataset of at most 16 MiB gets the platform's sizes, whose least
        // piece holds all of it; past that, its pieces are smaller than it.
        for (const bytes of [1, 4 * 2 ** 20, PIECE_SIZES.min]) {
            expect(pieceSizesFor(bytes).min).toBeGreaterThanOrEqual(bytes);
            expect(plan(program, weighing(bytes)).kind).toBe("one_shot");
        }
        for (const bytes of [PIECE_SIZES.min + 1, 100e6, 1e9, 16 * 2 ** 30]) {
            expect(pieceSizesFor(bytes).max).toBeLessThan(bytes);
            expect(plan(program, weighing(bytes)).kind).toBe("split");
        }
    });

    test("the options' own piece: a small dataset splits over a small one", () => {
        expect(plan(program, weighing(64 * 1024), 32 * 1024).kind).toBe("split");
        expect(plan(program, weighing(32 * 1024), 32 * 1024).kind).toBe("one_shot");
        expect(() => planQuery(program, ROOT, weighing(1), { pieceBytes: -1 })).toThrow(new RangeError("planQuery: pieceBytes is -1, not a whole number of bytes"));
    });

    test("a query that runs as one unit is one call however much its dataset weighs", () => {
        expect(plan(".orders | sort_by(.total) | reverse", weighing(LARGE)).kind).toBe("one_shot");
    });

    test("one call is the one-shot call prepareQuery prepares, as before plans", async () => {
        const p = plan(program, weighing(4_096));
        const prepared = prepareQuery(program, ROOT);
        if (p.kind !== "one_shot" || !("prepared" in prepared)) throw new Error("expected one call");
        // The body's IR names the builder's own source locations, so its bytes are compared by what it is and what it answers.
        const { bodyIr, ...rest } = p.prepared.request;
        const { bodyIr: expectedIr, ...expectedRest } = prepared.prepared.request;
        expect(rest).toEqual(expectedRest);
        expect(p.prepared.entries).toEqual(prepared.prepared.entries);
        expect(isTypeEqual(fromEastTypeValue(decodeEastIR(bodyIr).ir.value.type), fromEastTypeValue(decodeEastIR(expectedIr).ir.value.type))).toBe(true);
        const call = createInMemoryQueryCall(IN_MEMORY);
        expect(queryResultOf(p.prepared, await call(p.prepared.request))).toEqual(queryResultOf(prepared.prepared, await call(prepared.prepared.request)));
    });

    test("a query that does not check is the checker's refusal, as a one-shot call's", () => {
        const planned = planQuery(".orders | map(.totl)", ROOT, HEAVY);
        const prepared = prepareQuery(".orders | map(.totl)", ROOT);
        if (!("result" in planned) || !("result" in prepared)) throw new Error("expected a refusal");
        expect(planned.result).toEqual(prepared.result);
    });
});

// ─── The path, by estimated time and memory (#1143) ──────────────────────────

describe("the path, by estimated time and memory (#1143)", () => {
    /** The orders weighed: their stored bytes, and the rows e3's status counts. */
    const orders = (bytes: number, rows: number | undefined) => new Map([["orders", { bytes, rows }]]);
    /** A program's plan, its explanation in words, and its estimates. */
    const planned = (program: string, weights: ReadonlyMap<string, SourceWeight>, options: PlanOptions = {}) => {
        const p = planQuery(program, ROOT, weights, options);
        if ("result" in p) throw new Error(`${program} does not check`);
        return { kind: p.plan.kind, words: explained(p.plan.explanation), estimates: p.plan.explanation.estimates };
    };

    test("a dataset within one piece stays one call, its rows known or not: one piece is all a split call could cut", () => {
        for (const rows of [466_000, undefined]) {
            const p = planned(".orders | map(.total) | add", orders(PIECE_SIZES.min, rows));
            expect([p.kind, p.words, p.estimates]).toEqual(["one_shot", "One call: orders weighs 16 MB, within one piece (16 MB).", null]);
        }
    });

    test("a small dataset a little over one piece stays one call: a cheap row is done sooner than a split call's pieces start", () => {
        const p = planned(".orders | map(.id)", orders(20 * 2 ** 20, 580_000));
        expect(p.kind).toBe("one_shot");
        expect(p.words).toBe([
            "One call: estimated faster than a split call over orders.",
            "As one call: about 430 ms, holding about 10 MB.",
            "As a split call: about 500 ms, 5 pieces, 8 at a time, each holding about 10 MB.",
            "Assumed: 580,000 rows of orders, each about 0.65 µs in one call and 0.9 µs in a piece.",
        ].join("\n"));
    });

    test("a split chosen for time over 1 GB: its pieces run side by side; with one core to run them on, one call is faster", () => {
        const program = ".orders | map(.total) | add";
        const p = planned(program, orders(2 ** 30, 30_000_000));
        expect(p.kind).toBe("split");
        expect(p.words).toBe([
            "Split call over orders: estimated faster than one call.",
            "As one call: about 24 s, holding about 10 MB.",
            "As a split call: about 4.7 s, 32 pieces, 8 at a time, each holding about 14 MB.",
            "Assumed: 30,000,000 rows of orders, each about 0.8 µs in one call and 1 µs in a piece.",
            "Each piece of orders runs: «.orders | map(.total)»",
            "Their totals combine, each by its rule:",
            "Added up: «add»",
        ].join("\n"));
        // e3's piece sizes for 1 GiB cut it into 32 pieces of 32 MiB.
        expect([p.estimates?.pieces, pieceSizesFor(2 ** 30).target]).toEqual([32, 32 * 2 ** 20]);
        const one = planned(program, orders(2 ** 30, 30_000_000), { cores: 1 });
        expect([one.kind, one.words.split("\n")[0], one.estimates?.cores]).toEqual(["one_shot", "One call: estimated faster than a split call over orders.", 1]);
    });

    test("a one-call path estimated over memoryBytes is split instead, however fast one call would be", () => {
        const program = ".orders | map(.customer_id) | unique";
        const weights = orders(100_000_000, 2_900_000);
        // With one core to run the pieces on, one call is estimated faster: by time alone, one call.
        const byTime = planned(program, weights, { cores: 1 });
        expect([byTime.kind, byTime.words.split("\n").slice(0, 2)]).toEqual(["one_shot", [
            "One call: estimated faster than a split call over orders.",
            "As one call: about 7.9 s, holding about 300 MB.",
        ]]);
        // It holds every customer id it keeps distinct: more than 256 MiB, so it is split; within 512 MiB it stays one call.
        const p = planned(program, weights, { cores: 1, memoryBytes: 256 * 2 ** 20 });
        expect(p.kind).toBe("split");
        expect(p.words).toBe([
            "Split call over orders: one call would hold more memory than it may use.",
            "As one call: about 7.9 s, holding about 300 MB, more than the 256 MB it may use.",
            "As a split call: about 10 s, 24 pieces, 1 at a time, each holding about 30 MB.",
            "Assumed: 2,900,000 rows of orders, each about 2.7 µs in one call and 2.3 µs in a piece, one call holding every row at about 105 B each.",
            "Each piece of orders runs: «.orders | map(.customer_id)»",
            "Their distinct rows are kept: «unique»",
        ].join("\n"));
        const within = planned(program, weights, { cores: 1, memoryBytes: 512 * 2 ** 20 });
        expect([within.kind, within.words.split("\n")[1]]).toEqual(["one_shot", "As one call: about 7.9 s, holding about 300 MB, within the 512 MB it may use."]);
    });

    test("a dataset with no rows known keeps the rule by weight, and so does the options' own piece: there is nothing to estimate", () => {
        const program = ".orders | map(.total) | add";
        const unknown = planned(program, orders(2 ** 30, undefined), { memoryBytes: 1 });
        expect([unknown.kind, unknown.words.split("\n")[0], unknown.estimates]).toEqual(["split", "Split call over orders: it weighs 1 GB, more than one piece (16 MB).", null]);
        expect(planned(program, orders(4_096, undefined)).words).toBe("One call: orders weighs 4 KB, within one piece (16 MB).");
        // A server cutting pieces of its own size is not one the estimates are of, its rows known or not.
        const own = planned(program, orders(64 * 1024, 40), { pieceBytes: 32 * 1024 });
        expect([own.kind, own.words.split("\n")[0], own.estimates]).toEqual(["split", "Split call over orders: it weighs 64 KB, more than one piece (32 KB).", null]);
    });

    test("a re-keyed join is estimated as its two calls, each cutting the orders' pieces", () => {
        const p = planned(REKEYED[1]!, new Map([["orders", { bytes: LARGE, rows: 45_000_000 }], ["customers", { bytes: LARGE, rows: undefined }]]));
        expect(p.kind).toBe("rekey");
        expect(p.words).toBe([
            "Split call over orders: estimated faster than one call.",
            "As one call: about 3.8 min, holding about 18 GB.",
            "As a re-keyed join: about 48 s, two calls of 48 pieces, 8 at a time, each holding about 30 MB.",
            "Assumed: 45,000,000 rows of orders, each about 5 µs in one call and 7.7 µs in a piece, one call holding every row at about 440 B each.",
            "Re-key: both sides large and unaligned — customers weighs more than one piece too.",
            "First, orders is re-keyed by this, about 1.5 GB, and each piece then reads customers cut at the same keys: «.customer_id»",
            "Each piece of orders runs: «.orders | map($c[.customer_id].region)»",
            "Their distinct rows are kept: «unique»",
        ].join("\n"));
    });

    test("what one call holds: every row for a sort, a group, the distinct rows, the last row or the distinct values; none for a folded total, a reduce, rows answered or a stream's first", () => {
        const weights = orders(2 ** 30, 30_000_000);
        const holds = (program: string): boolean | undefined => planned(program, weights).estimates?.holdsRows;
        for (const program of [
            ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add})",
            ".orders | map(.customer_id) | unique",
            ".orders | unique_by(.customer_id) | map(.id)",
            ".orders | map(select(.total > 500)) | sort_by(-.total) | .[:5]",
            ".orders | map(.total) | .[-1]",
            ".orders | {customers: (map(.customer_id) | unique | length)}",
        ]) expect(holds(program), program).toBe(true);
        for (const program of [
            ".orders | map(.total) | add",
            ".orders | {n: length, mean: (map(.total) | add / length)}",
            "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)",
            ".orders | map(.id)",
            "limit(3; .orders[] | select(.total > 100) | .id)",
        ]) expect(holds(program), program).toBe(false);
        // What it holds of each row is its kind's, beside what any unit holds.
        const group = planned(".orders | group_by(.customer_id) | map({customer: .[0].customer_id, n: length})", weights).estimates!;
        expect(group.oneCall.peakBytes).toBe(PLAN_COSTS.unitBytes + 30_000_000 * PLAN_COSTS.rows.dict.heldBytes);
        expect(planned(".orders | map(.total) | add", weights).estimates!.oneCall.peakBytes).toBe(PLAN_COSTS.unitBytes);
    });

    test("the cores the options give, else the table's; memoryBytes and cores whole numbers", () => {
        const weights = orders(2 ** 30, 30_000_000);
        expect(planned(".orders | map(.total) | add", weights).estimates?.cores).toBe(PLAN_COSTS.cores);
        expect(planned(".orders | map(.total) | add", weights, { cores: 14 }).estimates?.cores).toBe(14);
        expect(() => planQuery(".orders | map(.total) | add", ROOT, weights, { memoryBytes: -1 })).toThrow(new RangeError("planQuery: memoryBytes is -1, not a whole number of bytes"));
        expect(() => planQuery(".orders | map(.total) | add", ROOT, weights, { cores: 0 })).toThrow(new RangeError("planQuery: cores is 0, not a whole number of at least 1"));
        expect(() => planQuery(".orders | map(.total) | add", ROOT, weights, { cores: 1.5 })).toThrow(new RangeError("planQuery: cores is 1.5, not a whole number of at least 1"));
    });
});

// ─── The request ─────────────────────────────────────────────────────────────

/** The split call of a program that splits. */
function splitOf(program: string): Extract<QueryPlan, { kind: "split" }> {
    const p = plan(program);
    if (p.kind !== "split") throw new Error(`${program} does not split`);
    return p;
}

/** A program's function type, decoded from its IR. */
function functionType(ir: Uint8Array): { inputs: EastType[]; output: EastType } {
    const type = fromEastTypeValue(decodeEastIR(ir).ir.value.type);
    if (type.type !== "Function") throw new Error("a program is a function");
    return { inputs: type.inputs as EastType[], output: type.output as EastType };
}

/** The type a split call answers at: its final function's, else its assembled output's. */
function answerType(request: SplitCallRequest): EastType {
    if (request.then.type === "some") return functionType(request.then.value).output;
    const emit = functionType(request.bodyIr).inputs.at(-1)!;
    if (emit.type !== "Function") throw new Error("the body's last parameter is its emit function");
    const emitted = emit.inputs as EastType[];
    switch (request.output.type) {
        case "array": return ArrayType(emitted[0]!);
        case "first": return ArrayType(emitted[0]!);
        case "set": return SetType(emitted[0]!);
        case "dict": return DictType(emitted[0]!, emitted[1]!);
        case "fold": return emitted[0]!;
    }
}

/** The platform functions a program calls, at any depth: what e3 refuses a reader's split call for. */
function platformCalls(ir: Uint8Array): string[] {
    const names: string[] = [];
    walkIR(decodeEastIR(ir).ir, node => {
        if (node.type === "Platform") names.push(node.value.name);
    });
    return names;
}

describe("the request", () => {
    test("one dataset argument per data source read, in the split's order, the one cut partitioned with no by, the others whole", () => {
        const { request } = splitOf(".customers as $c | .orders | map($c[.customer_id].region) | unique");
        expect(request.args).toEqual([
            { arg: variant("dataset", pathOf("customers")), partition: none },
            { arg: variant("dataset", pathOf("orders")), partition: some({ by: [] }) },
        ]);
    });

    test("a one-shot call's runner and limits: east-c given no platform package, 1 MiB, and no time limit asked — the job runs to the server's ceiling; no program calls a platform function", () => {
        for (const [program] of SPLITS) {
            const { request } = splitOf(program);
            expect(request.runner).toEqual(variant("east_c", { decode: variant("lazy", null), platforms: [] }));
            expect(request.limits).toEqual(some({ timeoutMs: none, maxResultBytes: some(1_048_576n), maxLogBytes: none }));
            const programs = [request.bodyIr, ...(request.then.type === "some" ? [request.then.value] : [])];
            if (request.output.type === "dict" && request.output.value.merge.type === "some") programs.push(request.output.value.merge.value);
            if (request.output.type === "fold") programs.push(request.output.value.combine);
            for (const ir of programs) expect(platformCalls(ir)).toEqual([]);
        }
    });

    test("each output kind, its programs decoding as functions of the right shape, and a fold's zero as beast2 at its type", () => {
        const kinds = (program: string) => splitOf(program).request.output.type;
        expect(kinds(".orders | map(.id)")).toBe("array");
        expect(kinds(".orders | map(.customer_id) | unique | length")).toBe("set");
        // A stream's first rows: how many, and no final function when they are the result (#1113).
        const first = splitOf("limit(3; .orders[] | .id)").request;
        expect([first.output, first.then.type]).toEqual([variant("first", { limit: 3n }), "none"]);
        const dict = splitOf(".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add})").request;
        if (dict.output.type !== "dict" || dict.output.value.merge.type !== "some") throw new Error("expected a dict with a merge");
        const merge = functionType(dict.output.value.merge.value);
        // A merge is a function of the key and two values, giving a value.
        expect(merge.inputs.length).toBe(3);
        expect(isTypeEqual(merge.inputs[1]!, merge.output) && isTypeEqual(merge.inputs[2]!, merge.output)).toBe(true);
        const p = splitOf(".orders | {n: length, total: (map(.total) | add)}");
        const fold = p.request.output;
        if (fold.type !== "fold") throw new Error("expected a fold");
        const combine = functionType(fold.value.combine);
        expect(combine.inputs.length).toBe(2);
        // The zero is beast2 at the fold's type: no rows counted, nothing added.
        const zero = decodeBeast2(fold.value.zero);
        expect(isTypeEqual(fromEastTypeValue(zero.type), combine.output)).toBe(true);
        expect(equalFor(combine.output)(zero.value as never, decodeBeast2For(combine.output)(fold.value.zero) as never)).toBe(true);
        // The body takes the inputs, then emit; the final function the assembled output, then the inputs not
        // partitioned (#1107): here none, as the orders are cut.
        const body = functionType(p.request.bodyIr);
        expect([body.inputs.length, isTypeEqual(body.output, NullType)]).toEqual([2, true]);
        if (p.request.then.type !== "some") throw new Error("expected a final function");
        expect(functionType(p.request.then.value).inputs.length).toBe(1);
    });

    test("a split call answers at the type the one-shot translation gives: the query's result type", () => {
        for (const [program] of SPLITS) {
            const { request } = splitOf(program);
            const prepared = prepareQuery(program, ROOT);
            if (!("prepared" in prepared)) throw new Error(`${program} does not check`);
            expect(isTypeEqual(answerType(request), functionType(prepared.prepared.request.bodyIr).output), program).toBe(true);
        }
    });

    test("splitCallRequest builds, from a split and the root, exactly the request a plan sends", () => {
        const program = ".orders | map(.total) | add";
        const split = splitJq(checkJq(program, ROOT.type, { root: true }));
        if (split.kind !== "split") throw new Error("expected a split");
        expect(splitCallRequest(split, ROOT)).toEqual(splitOf(program).request);
        // The options set the limits and the runner, as a one-shot call's do: a time limit too, when they name one.
        const runner = variant("east_node", { decode: variant("whole", null), platforms: [] });
        expect(splitCallRequest(split, ROOT, { timeoutMs: 120_000, maxBytes: 4_096, runner })).toMatchObject({
            runner, limits: some({ timeoutMs: some(120_000n), maxResultBytes: some(4_096n), maxLogBytes: none }),
        });
    });
});

// ─── The visual view's split program ─────────────────────────────────────────

describe("the visual view's split program: the query, a rows result counted once its rows are combined", () => {
    /** The default query's canonical program, and the same followed by its counts: what a visual split run sends. */
    const QUERY = [
        ".customers as $customers",
        ".orders",
        "map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
        "map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
        "map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
        "sort_by(-.total)",
        ".[:10]",
    ].join("\n| ");
    const WRAPPED = `${QUERY}\n| {counts: [length], result: .[:1000]}`;

    test("east splits it as the sort's first 10 rows kept in each piece and then across them, with the counts run once after them", () => {
        const split = splitJq(checkJq(WRAPPED, ROOT.type, { root: true }));
        if (split.kind !== "split") throw new Error("expected a split");
        expect([split.over, split.output.kind, split.stages.combine.kind, split.broadcast]).toEqual(["orders", "fold", "top", ["customers"]]);
        expect(WRAPPED.slice(split.stages.then!.from, split.stages.then!.to)).toBe(".[:10]\n| {counts: [length], result: .[:1000]}");
    });

    test("the plan sends the wrapped program, and explains the query as its author reads it", () => {
        const planned = planQuery({ query: QUERY, split: WRAPPED }, ROOT, HEAVY);
        if ("result" in planned || planned.plan.kind !== "split") throw new Error("expected a split");
        const p = planned.plan;
        expect(p.explanation.program).toBe(QUERY);
        expect(explained(p.explanation)).toBe([
            SPLIT,
            "Each piece of orders runs: «.orders\n| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))\n| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})\n| map({order: .id, customer: .name, region, total, shipped: .status.value.date})»",
            "The first 10 rows of the sort are kept, each piece's and then theirs together, by: «-.total»",
            "Then, once, over what they combine to: «.[:10]»",
            "Every piece reads customers whole.",
        ].join("\n"));
        // What it reads its answer by is the wrapped program's: {counts, result}.
        const answer = p.reading.checked.elementType;
        expect(answer.type === "Struct" && Object.keys(answer.fields)).toEqual(["counts", "result"]);
    });

    test("a split program that splits otherwise than the query is one call, and says why", () => {
        const planned = planQuery({ query: ".orders | map(.total) | add", split: ".orders | map(.total)" }, ROOT, HEAVY);
        if ("result" in planned) throw new Error("expected a plan");
        expect(planned.plan.kind).toBe("one_shot");
        expect(explained(planned.plan.explanation)).toBe("One call: the split call couldn't be made — the run's split program splits otherwise than the query: array over orders");
    });
});

// ─── Every split, run in memory, answers as its one-shot call ────────────────

/** Whether two East values of a type are equal, Floats to within rounding: a sum's grouping changes its last bits. */
function close(type: EastType, a: unknown, b: unknown): boolean {
    const t = type.type === "Recursive" ? type.node as EastType : type;
    switch (t.type) {
        case "Float": {
            const [x, y] = [a as number, b as number];
            return equalFor(t)(x, y) || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
        }
        case "Array": {
            const [xs, ys] = [a as unknown[], b as unknown[]];
            return xs.length === ys.length && xs.every((x, i) => close(t.value as EastType, x, ys[i]));
        }
        case "Struct":
            return Object.entries(t.fields as Record<string, EastType>).every(([name, field]) => close(field, (a as Record<string, unknown>)[name], (b as Record<string, unknown>)[name]));
        case "Variant":
            // Each a variant by East's brand, and the same case, its payloads close.
            return isVariant(a) && isVariant(b) && a.type === b.type && close((t.cases as Record<string, EastType>)[a.type]!, a.value, b.value);
        case "Dict": {
            const [x, y] = [[...(a as SortedMap<unknown, unknown>).entries()], [...(b as SortedMap<unknown, unknown>).entries()]];
            const sameKey = equalFor(t.key as EastType);
            return x.length === y.length && x.every(([k, v], i) => sameKey(k as never, y[i]![0] as never) && close(t.value as EastType, v, y[i]![1]));
        }
        default:
            return equalFor(type)(a as never, b as never);
    }
}

/** A result's answer, decoded, at its type. */
function decoded(result: QueryResult): { type: EastType; value: unknown } {
    if (result.outcome.type !== "ok") throw new Error(`the run answered ${result.outcome.type}`);
    const answer = decodeBeast2(result.outcome.value.result);
    return { type: fromEastTypeValue(answer.type), value: answer.value };
}

/** What an in-memory split call is given when nothing abandons it and nobody watches its progress. */
const QUIET = { signal: new AbortController().signal, onProgress: () => {} };

describe("every split, run in memory over 1, 3 and 7 pieces, answers as its one-shot call does", () => {
    const oneShot = createInMemoryQueryCall(IN_MEMORY);
    const samePath = equalFor(TreePathType);
    for (const [program] of SPLITS) {
        test(program, async () => {
            const prepared = prepareQuery(program, ROOT);
            if (!("prepared" in prepared)) throw new Error(`${program} does not check`);
            const expected = queryResultOf(prepared.prepared, await oneShot(prepared.prepared.request));
            const want = decoded(expected);
            const { request, reading } = splitOf(program);
            for (const pieces of [1, 3, 7]) {
                const answer = await createInMemorySplitCall(IN_MEMORY, { pieces })(request, QUIET);
                const result = queryResultOf(reading, answer.result);
                const got = decoded(result);
                expect(isTypeEqual(got.type, want.type), `${pieces} pieces: the type`).toBe(true);
                expect(close(want.type, got.value, want.value), `${pieces} pieces: the value`).toBe(true);
                // The datasets it read, each pinned, in the call's argument order.
                expect(result.inputs.every((input, i) => samePath(input.path, reading.entries[i]!.path))).toBe(true);
            }
        });
    }
});

// ─── Joins: cut at the same keys, or re-keyed (#942) ─────────────────────────

/** The stock held of each SKU and each SKU's price: two dicts keyed alike, as the east split spec's. */
const StockType = DictType(StringType, IntegerType);
const PricesType = DictType(StringType, FloatType);
const STOCK_ROOT = queryRoot([
    { name: "stock", path: pathOf("stock"), type: toEastTypeValue(StockType) },
    { name: "prices", path: pathOf("prices"), type: toEastTypeValue(PricesType) },
]);

/** 37 SKUs in stock, every third unpriced, and 19 priced with none in stock, in memory. */
const STOCK_IN_MEMORY = (() => {
    const compare = compareFor(StringType);
    const sku = (i: number): string => `S${String(i).padStart(3, "0")}`;
    const stock = new SortedMap<string, bigint>(Array.from({ length: 37 }, (_, i): [string, bigint] => [sku(i * 2), BigInt((i * 7) % 11)]), compare);
    const prices = new SortedMap<string, number>([
        ...Array.from({ length: 37 }, (_, i) => i).filter(i => i % 3 !== 0).map((i): [string, number] => [sku(i * 2), ((i * 37) % 100) / 4 + 0.1]),
        ...Array.from({ length: 19 }, (_, i): [string, number] => [sku(i * 4 + 1), i + 0.5]),
    ], compare);
    return [{ path: pathOf("stock"), type: StockType as EastType, value: stock }, { path: pathOf("prices"), type: PricesType as EastType, value: prices }];
})();

/** Both dicts weighed as large, the prices the heavier: e3 cuts the pieces at their keys. Their rows not known: by weight alone. */
const STOCK_HEAVY: ReadonlyMap<string, SourceWeight> = new Map([["stock", { bytes: LARGE, rows: undefined }], ["prices", { bytes: 2 * LARGE, rows: undefined }]]);

/** Joins of the stock with the prices, read only at the stock's own SKU: cut at the same keys. */
const COPARTITIONED: readonly string[] = [
    ".prices as $p | .stock | to_entries | map({sku: .key, worth: (.value * ($p[.key] // 0))}) | sort_by(-.worth) | .[:4]",
    ".prices as $p | [.stock | to_entries[] | .key as $k | select($p | has($k) | not) | $k]",
    ".stock as $s | .prices | to_entries | map(select($s[.key] == null) | .key)",
];

/** Joins of the orders with the customers, read only at the order's customer, whose combine the rows' order cannot change: re-keyed when both are large. */
const REKEYED: readonly string[] = [
    ".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})",
    ".customers as $c | .orders | map($c[.customer_id].region) | unique",
    ".customers as $c | .orders | map(select($c[.customer_id].tier.type == \"gold\") | .total) | add",
    ".customers as $c | reduce .orders[] as $o ({}; .[$c[$o.customer_id].region // \"?\"] += $o.total)",
    ".customers as $c | .orders | map({tier: $c[.customer_id].tier.type, total}) | group_by(.tier) | map({tier: .[0].tier, hi: (map(.total) | max), n: length})",
];

/** The orders and the customers both weighed as large. */
const BOTH_HEAVY: ReadonlyMap<string, SourceWeight> = new Map([...HEAVY, ["customers", { bytes: LARGE, rows: 8 }]]);

/** A program's re-keyed join; the test fails when it plans otherwise. */
function rekeyOf(program: string, weights: ReadonlyMap<string, SourceWeight> = BOTH_HEAVY): Extract<QueryPlan, { kind: "rekey" }> {
    const p = plan(program, weights);
    if (p.kind !== "rekey") throw new Error(`${program} plans ${p.kind}, not a re-keyed join`);
    return p;
}

describe("joins (#942): two dicts keyed alike cut at the same keys, and two large datasets re-keyed", () => {
    test("a join of two dicts read only at the row's key: both partitioned, cut at the same keys by the heavier, and explained", () => {
        const planned = planQuery(COPARTITIONED[0]!, STOCK_ROOT, STOCK_HEAVY);
        if ("result" in planned || planned.plan.kind !== "split") throw new Error("expected a split");
        const p = planned.plan;
        expect(explained(p.explanation)).toBe([
            "Split call over stock: prices, cut with it, weighs 3 GB, more than one piece (16 MB).",
            "Each piece of stock runs: «.stock | to_entries | map({sku: .key, worth: (.value * ($p[.key] // 0))})»",
            "Prices is cut at the same keys as stock: each piece reads only its own keys of it.",
            "The first 4 rows of the sort are kept, each piece's and then theirs together, by: «-.worth»",
            "Then, once, over what they combine to: «.[:4]»",
        ].join("\n"));
        // Both partitioned with no by: e3 cuts them at the same keys, the heavier's.
        expect(p.request.args).toEqual([
            { arg: variant("dataset", pathOf("prices")), partition: some({ by: [] }) },
            { arg: variant("dataset", pathOf("stock")), partition: some({ by: [] }) },
        ]);
    });

    for (const program of COPARTITIONED) {
        test(`cut at the same keys, run in memory over 1, 3 and 7 pieces, it answers as its one-shot call does: ${program}`, async () => {
            const prepared = prepareQuery(program, STOCK_ROOT);
            if (!("prepared" in prepared)) throw new Error(`${program} does not check`);
            const want = decoded(queryResultOf(prepared.prepared, await createInMemoryQueryCall(STOCK_IN_MEMORY)(prepared.prepared.request)));
            const planned = planQuery(program, STOCK_ROOT, STOCK_HEAVY);
            if ("result" in planned || planned.plan.kind !== "split") throw new Error(`${program} does not split`);
            const { request, reading } = planned.plan;
            expect(request.args.every(a => a.partition.type === "some"), "every argument partitioned").toBe(true);
            for (const pieces of [1, 3, 7]) {
                const got = decoded(queryResultOf(reading, (await createInMemorySplitCall(STOCK_IN_MEMORY, { pieces })(request, QUIET)).result));
                expect(close(want.type, got.value, want.value), `${pieces} pieces`).toBe(true);
            }
        });
    }

    test("a join both of whose sides weigh more than one piece is re-keyed: the re-key call, the join call over its output, and the explanation", () => {
        const p = rekeyOf(REKEYED[1]!);
        expect(explained(p.explanation)).toBe([
            SPLIT,
            "Re-key: both sides large and unaligned — customers weighs more than one piece too.",
            "First, orders is re-keyed by this, about 1.5 GB, and each piece then reads customers cut at the same keys: «.customer_id»",
            "Each piece of orders runs: «.orders | map($c[.customer_id].region)»",
            "Their distinct rows are kept: «unique»",
        ].join("\n"));
        // The re-key call: the orders partitioned, into a dict by the join key, its answer asked to be one byte at most — its output is read by its hash.
        expect(p.first.args).toEqual([{ arg: variant("dataset", pathOf("orders")), partition: some({ by: [] }) }]);
        expect([p.first.output.type, p.first.then.type]).toEqual(["dict", "none"]);
        expect(p.first.limits).toEqual(some({ timeoutMs: none, maxResultBytes: some(1n), maxLogBytes: none }));
        // The join call: the re-keyed rows by their hash and the customers, both partitioned, into the split's output kind.
        const hash = "ab".repeat(32);
        const join = p.join(hash);
        expect(join.args).toEqual([
            { arg: variant("dataset", pathOf("customers")), partition: some({ by: [] }) },
            { arg: variant("object", hash), partition: some({ by: [] }) },
        ]);
        expect([join.output.type, join.limits]).toEqual(["set", some({ timeoutMs: none, maxResultBytes: some(1_048_576n), maxLogBytes: none })]);
        for (const ir of [p.first.bodyIr, join.bodyIr, ...(join.then.type === "some" ? [join.then.value] : [])]) expect(platformCalls(ir)).toEqual([]);
        // What the run reads: the orders, which the re-key call reads, then the customers.
        expect(p.reading.entries.map(e => e.name)).toEqual(["orders", "customers"]);
    });

    test("a time limit the options name reaches both calls of a re-keyed join, as a split call's (#1131)", () => {
        const planned = planQuery(REKEYED[1]!, ROOT, BOTH_HEAVY, { timeoutMs: 120_000 });
        if ("result" in planned || planned.plan.kind !== "rekey") throw new Error("expected a re-keyed join");
        expect(planned.plan.first.limits).toEqual(some({ timeoutMs: some(120_000n), maxResultBytes: some(1n), maxLogBytes: none }));
        expect(planned.plan.join("ab".repeat(32)).limits).toEqual(some({ timeoutMs: some(120_000n), maxResultBytes: some(1_048_576n), maxLogBytes: none }));
    });

    test("the other side within one piece, or not weighed, is read whole by every piece: one split call", () => {
        const program = REKEYED[1]!;
        for (const customers of [{ bytes: 4_096, rows: 8 }, { bytes: undefined, rows: 8 }]) {
            const p = plan(program, new Map([...HEAVY, ["customers", customers]]));
            if (p.kind !== "split" || p.explanation.path.kind !== "split") throw new Error("expected a split call");
            expect([p.explanation.path.broadcast, p.explanation.path.rekey]).toEqual([["customers"], null]);
            expect(p.request.args.map(a => [a.arg.type, a.partition.type])).toEqual([["dataset", "none"], ["dataset", "some"]]);
        }
    });

    for (const program of REKEYED) {
        test(`re-keyed, its two calls run in memory over 1, 3 and 7 pieces — the second over the first's output by its hash — answer as its one-shot call does: ${program}`, async () => {
            const prepared = prepareQuery(program, ROOT);
            if (!("prepared" in prepared)) throw new Error(`${program} does not check`);
            const want = decoded(queryResultOf(prepared.prepared, await createInMemoryQueryCall(IN_MEMORY)(prepared.prepared.request)));
            const p = rekeyOf(program);
            for (const pieces of [1, 3, 7]) {
                const call = createInMemorySplitCall(IN_MEMORY, { pieces });
                const first = await call(p.first, QUIET);
                // Its answer too large for one byte, its output kept by its hash.
                expect([first.result.outcome.type, first.output?.length], `${pieces} pieces: the re-key call`).toEqual(["too_large", 64]);
                const joined = await call(p.join(first.output!), QUIET);
                const result = queryResultOf(p.reading, p.answer(first.result, joined.result));
                const got = decoded(result);
                expect(isTypeEqual(got.type, want.type), `${pieces} pieces: the type`).toBe(true);
                expect(close(want.type, got.value, want.value), `${pieces} pieces: the value`).toBe(true);
                expect(result.inputs.map(i => i.name), `${pieces} pieces: what it read`).toEqual(["orders", "customers"]);
            }
        });
    }

    test("a re-key call that ends without an output is the run's answer, with what it read", async () => {
        const p = rekeyOf(REKEYED[1]!);
        const first = await createInMemorySplitCall(IN_MEMORY.filter(d => !equalFor(TreePathType)(d.path, pathOf("orders"))), { pieces: 3 })(p.first, QUIET);
        expect([first.result.outcome.type, first.output]).toEqual(["invalid", null]);
        const result = queryResultOf(p.reading, p.answer(first.result, undefined));
        if (result.outcome.type !== "error") throw new Error(`expected a refusal, got ${result.outcome.type}`);
        expect(result.outcome.value.map(d => d.message)).toEqual(["no_value: orders has no value yet."]);
    });
});
