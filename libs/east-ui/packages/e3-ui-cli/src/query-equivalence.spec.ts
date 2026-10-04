/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's plans change what a query costs, never its answer (#942,
 * O1 and O2) — gated by `E3_UI_INTEGRATION=1`, as `query-plans.spec.ts` is:
 * embedded `@elaraai/e3-api-server`s over repositories seeded at test time,
 * each call planned and built by the builder's planner
 * (`@elaraai/e3-ui-components/query`) and sent with e3-api-client, as the
 * builder sends it.
 *
 * The queries:
 *
 * - **The corpus** (`libs/east/test/fixtures/query-corpus.beast2`): every case
 *   whose input is the fixture's root and whose program checks as an e3 root
 *   (`checkJq(program, root, { root: true })` with no error), whether the
 *   corpus marks it a root or not. Cases whose split calls are the same call
 *   run once. A query the planner runs as one unit has no second way to run:
 *   it is counted, by east's reason, and asserted no further — its answer
 *   against the case's recorded output is east's own specs' to hold.
 * - **The benchmark's questions** (`testing/query-bench.ts`, which
 *   `query-scale.spec.ts` asks at scale), over its generator at a small size.
 * - **Joins cut at the same keys**: two dicts keyed alike — the stock held of
 *   each SKU and each SKU's price, as the east split spec's stock root holds
 *   them, scaled — which neither the fixture's root nor the benchmark's holds.
 *
 * The data is the fixture (`query-fixture.beast2`) scaled, so that every
 * collection it holds is several segments, and so several pieces — a segment
 * holds 256 elements at least, so the file's own 40 orders would be one piece:
 * its orders from its own generator (seed 875; the first 40 are the file's,
 * and the rest draw their customer from every customer, not the file's 8, so
 * a join by customer re-keys into thousands of keys), `byId` those orders by
 * id, its customers and cells with more after the file's, and `bom`,
 * `forecast` and `model` as the file holds them. Every field of the root is a
 * dataset: e3 holds `model`, a function value, as it holds any other, so no
 * query is left out for what it reads.
 *
 * `E3_TEST_PIECE_BYTES` makes e3's pieces a segment each, and each plan's
 * `pieceBytes` is e3's smallest piece at that setting, so every query that
 * splits runs as a split call over several pieces, as e3's explain counts them
 * — and a join both of whose sides are large, as every join with the
 * customers is at that setting, as a re-keyed join's two (#942): the re-key
 * call, and the join call over its output, by its hash.
 *
 * - **O1**: on each runner, each query's split calls answer as its one-shot
 *   call does — byte for byte when the answer's type holds no Float, and
 *   Floats within rounding when it does, since the pieces add in another
 *   grouping.
 * - **O2**: on east-node, east-c and east-py, at `-j 1` and `-j 4`, the units
 *   give identical bytes: each piece's and merge's output, by its inputs, the
 *   assembled output, call by call, and the answer. A unit is cached by its
 *   task and inputs, and a task names its runner, so each runner runs its own
 *   units; each `-j` has a repository of its own, so no unit is served from
 *   another's cache.
 *
 * What ran is read from e3's execution records, as `query-plans.spec.ts` reads
 * them: every unit that runs writes one. The calls run on every stock runner
 * e3 finds: east-node, which this package's `node_modules/.bin` holds, and
 * east-c and east-py when they are on PATH — put this tree's first. e3 looks a
 * runner up in every `node_modules/.bin` and the first `.venv` above the
 * repository and the working directory before PATH (`testing/runners.ts`), so
 * the suite names the file e3 runs for each, and fails before its first call
 * when one is not a build of this tree: a runner from another release need not
 * speak this one's unit protocol. CI builds all three, and holds that each is
 * on PATH. The runners inherit this
 * process's environment, in which `OPENBLAS_NUM_THREADS` is 1: east-py imports
 * numpy, whose OpenBLAS otherwise starts a spinning thread a core as it
 * loads — about a second of CPU a unit on a many-core machine, for nothing a
 * query runs.
 */

import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, EastTypeType, FloatType, FunctionType, IRType, IntegerType, JqType, NullType, OptionType,
    QueryErrorType, QueryMultiplicityType, RecursiveType, SortedMap, StringType, StructType, VariantType,
    checkJq, compareFor, decodeBeast2, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeValueEqual, isVariant, none, printFor,
    some, toEastTypeValue, variant,
    type EastType, type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import { datasetGetStatus, oneShotExecute, splitCall, splitCallExplain, type SplitCallAnswer } from '@elaraai/e3-api-client';
import { SplitCallRequestType, type ExecuteResult, type RunnerValue, type SplitCallRequest, type TreePath } from '@elaraai/e3-types';
import {
    LocalStorage, computeHash, datasetRead, executionGet, executionList, executionListIds, packageImport, repoInit, workspaceCreate, workspaceDeploy,
    workspaceSetDataset,
} from '@elaraai/e3-core';
import {
    draftPlan, planQuery, prepareQuery, queryResultOf, queryRoot, splitCallRequest,
    type QueryPlan, type QueryResult, type QueryRoot, type SourceWeight,
} from '@elaraai/e3-ui-components/query';
import { startRepoServer, type RepoServerHandle } from './e3-server.js';
import * as bench from './testing/query-bench.js';
import { assertThisTreesRunner, runnerFile } from './testing/runners.js';

const enabled = process.env['E3_UI_INTEGRATION'] === '1';

// ─── The fixture: its types, as `libs/east/test/query.fixture.ts` writes them ─

const Line = StructType({ price: FloatType, qty: IntegerType, sku: StringType });
const Status = VariantType({
    cancelled: StructType({ reason: StringType }),
    pending: NullType,
    shipped: StructType({ date: DateTimeType }),
});
const Order = StructType({
    customer_id: StringType,
    discount: OptionType(FloatType),
    id: IntegerType,
    lines: ArrayType(Line),
    status: Status,
    total: FloatType,
});
const Customer = StructType({ name: StringType, region: StringType, tier: VariantType({ gold: NullType, standard: NullType }) });
const Cell = StructType({ region: StringType, week: IntegerType });
const FixtureRoot = StructType({
    bom: RecursiveType(self => StructType({ children: ArrayType(self), cost: FloatType, sku: StringType })),
    byId: DictType(IntegerType, Order),
    cells: DictType(Cell, FloatType),
    customers: DictType(StringType, Customer),
    forecast: StructType({ regions: DictType(StringType, StructType({ weekly: ArrayType(FloatType) })) }),
    model: FunctionType([StructType({ price: FloatType, region: StringType })], FloatType),
    orders: ArrayType(Order),
});
type Fixture = ValueTypeOf<typeof FixtureRoot>;
type FixtureOrder = ValueTypeOf<typeof Order>;

/** The corpus fixture, as `libs/east/test/query.corpus.ts` writes it (`QueryCorpusFixtureType`). */
const CorpusType = StructType({
    cases: ArrayType(StructType({
        called: OptionType(IRType),
        canonical: StringType,
        case: StructType({ input: EastTypeType, name: StringType, output: OptionType(StringType), program: StringType, root: BooleanType }),
        checked: OptionType(StructType({ element_type: EastTypeType, multiplicity: QueryMultiplicityType, program: JqType })),
        diagnostics: ArrayType(QueryErrorType),
        translated: OptionType(BlobType),
    })),
    types: DictType(StringType, BlobType),
});

/** The fixtures east's tests write, read from the monorepo as east-c's tests read them. */
const FIXTURES = new URL('../../../../east/test/fixtures/', import.meta.url);

/** The fields of the root, each a dataset at `inputs.<field>`, in the root's order. */
const FIELDS = Object.keys(FixtureRoot.fields) as (keyof Fixture)[];

/** A data source's path in a workspace. */
const inputPath = (name: string): TreePath => [variant('field', 'inputs'), variant('field', name)];

/** The root every corpus query is checked against: the fixture's root, a data source per field. */
const CORPUS_ROOT = queryRoot(FIELDS.map((name) => ({ name, path: inputPath(name), type: toEastTypeValue(FixtureRoot.fields[name]) })));

// ─── The fixture, scaled ─────────────────────────────────────────────────────

/** The orders: some 5 segments, so some 5 pieces; the answers that hold every order stay under a call's 1 MiB. */
const ORDER_COUNT = 6_000;
/** The customers, the file's 8 among them: some 3 segments. */
const CUSTOMER_COUNT = 3_000;
/** The regions of cells added after the file's, each with 52 weeks: some 3 segments. */
const CELL_REGIONS = 60;
/** The benchmark's orders: some 5 segments, over its 100,000 customers. */
const BENCH_ORDER_COUNT = 6_000;

/** The fixture generator's SKUs and unit prices, customers, cancellation reasons and discounts, in the order it draws them. */
const SKUS: readonly (readonly [sku: string, price: number])[] = [
    ['BRK-100', 12.4], ['HNG-220', 8.9], ['PLT-310', 46.0], ['BLT-045', 0.85],
    ['SCR-012', 0.32], ['WSH-008', 0.18], ['RAL-900', 64.5], ['CLP-150', 3.75],
];
const CUSTOMER_IDS: readonly string[] = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'];
const REASONS: readonly string[] = ['Customer request', 'Out of stock', 'Payment failed'];
const DISCOUNTS: readonly number[] = [0.05, 0.1, 0.15];
const FIRST_SHIP_DAY_MS = Date.UTC(2025, 9, 1);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The file's own orders: the first its generator draws. */
const FILE_ORDERS = 40;

/** A scaled customer's id, from 1: the file's eight first (`C01` … `C08`), then those after them (`C0009` …). */
const customerIdAt = (i: number): string => (i <= CUSTOMER_IDS.length ? CUSTOMER_IDS[i - 1]! : `C${String(i).padStart(4, '0')}`);

/** Park–Miller's minimal standard generator, as the fixture draws from it. */
function parkMiller(seed: number): () => number {
    let state = seed;
    return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

/**
 * The fixture's orders, ids from 1001, as its generator (`makeOrders`, seed
 * 875) draws them: the first 40 of any count are the file's, and the rest go
 * on from the same seed, each drawing its customer from every scaled
 * customer rather than the file's 8 — so a join by customer re-keys into
 * thousands of keys, as a deployment's would (#942).
 */
function fixtureOrders(count: number): FixtureOrder[] {
    const draw = parkMiller(875);
    const out: FixtureOrder[] = [];
    for (let i = 0; i < count; i++) {
        const pick = draw();
        const customerId = i < FILE_ORDERS ? CUSTOMER_IDS[Math.floor(pick * CUSTOMER_IDS.length)]! : customerIdAt(1 + Math.floor(pick * CUSTOMER_COUNT));
        const lineCount = 1 + Math.floor(draw() * 4);
        const used = new Set<number>();
        const lines: ValueTypeOf<typeof Line>[] = [];
        const quantities: number[] = [];
        for (let j = 0; j < lineCount; j++) {
            let k: number;
            do { k = Math.floor(draw() * SKUS.length); } while (used.has(k));
            used.add(k);
            const [sku, price] = SKUS[k]!;
            const qty = 1 + Math.floor(draw() * (price < 5 ? 400 : 30));
            quantities.push(qty);
            lines.push({ price, qty: BigInt(qty), sku });
        }
        const roll = draw();
        let status: ValueTypeOf<typeof Status>;
        if (roll < 0.62) {
            const days = Math.floor(draw() * 354);
            const hours = 8 + Math.floor(draw() * 9);
            status = variant('shipped', { date: new Date(FIRST_SHIP_DAY_MS + days * DAY_MS + hours * HOUR_MS) });
        } else if (roll < 0.86) {
            status = variant('pending', null);
        } else {
            status = variant('cancelled', { reason: REASONS[Math.floor(draw() * REASONS.length)]! });
        }
        const discount = draw() < 0.35 ? DISCOUNTS[Math.floor(draw() * DISCOUNTS.length)]! : undefined;
        const gross = lines.reduce((sum, line, j) => sum + quantities[j]! * line.price, 0);
        out.push({
            customer_id: customerId,
            discount: discount === undefined ? none : some(discount),
            id: BigInt(1001 + i),
            lines,
            status,
            total: Math.round(gross * (1 - (discount ?? 0)) * 100) / 100,
        });
    }
    return out;
}

/**
 * The fixture scaled: its orders from its own generator, `byId` those orders
 * by id, the file's customers and cells with more after them, and the rest as
 * the file holds it.
 */
function scaledFixture(file: Fixture): Fixture {
    const orders = fixtureOrders(ORDER_COUNT);
    const regions = [...file.forecast.regions.keys()];
    const customers = new SortedMap(file.customers, compareFor(StringType));
    for (let i = file.customers.size + 1; i <= CUSTOMER_COUNT; i++) {
        customers.set(customerIdAt(i), {
            name: `Customer ${i}`, region: regions[i % regions.length]!, tier: variant(i % 4 === 0 ? 'gold' : 'standard', null),
        });
    }
    const cells = new SortedMap(file.cells, compareFor(Cell));
    for (let r = 1; r <= CELL_REGIONS; r++) {
        for (let week = 1; week <= 52; week++) {
            cells.set({ region: `R${String(r).padStart(3, '0')}`, week: BigInt(week) }, Math.round((300 + 11 * r + 2.5 * week) * 10) / 10);
        }
    }
    return {
        ...file,
        byId: new SortedMap(orders.map((order) => [order.id, order] as const), compareFor(IntegerType)),
        cells,
        customers,
        orders,
    };
}

// ─── Two dicts keyed alike: what a join cut at the same keys reads (#942) ────

/** The stock held of each SKU, and each SKU's price. */
const StockRoot = StructType({ prices: DictType(StringType, FloatType), stock: DictType(StringType, IntegerType) });
type Stock = ValueTypeOf<typeof StockRoot>;
/** The fields of the stock root, each a dataset at `inputs.<field>`. */
const STOCK_FIELDS = Object.keys(StockRoot.fields) as (keyof Stock)[];
/** The root the joins are asked of. */
const STOCK_ROOT = queryRoot(STOCK_FIELDS.map((name) => ({ name, path: inputPath(name), type: toEastTypeValue(StockRoot.fields[name]) })));
/** The SKUs in stock: some 6 segments, and some 7 of prices. */
const SKU_COUNT = 6_000;

/**
 * The stock and the prices, as the east split spec's stock root holds them,
 * scaled: every third SKU in stock unpriced, and half as many again priced
 * with none in stock.
 */
function stockData(): Stock {
    const compare = compareFor(StringType);
    const sku = (i: number): string => `S${String(i).padStart(5, '0')}`;
    const stock = new SortedMap(Array.from({ length: SKU_COUNT }, (_, i): [string, bigint] => [sku(i * 2), BigInt((i * 7) % 11)]), compare);
    const prices = new SortedMap([
        ...Array.from({ length: SKU_COUNT }, (_, i) => i).filter((i) => i % 3 !== 0).map((i): [string, number] => [sku(i * 2), ((i * 37) % 100) / 4 + 0.1]),
        ...Array.from({ length: SKU_COUNT / 2 }, (_, i): [string, number] => [sku(i * 4 + 1), i + 0.5]),
    ], compare);
    return { prices, stock };
}

// ─── The queries ─────────────────────────────────────────────────────────────

/** A query asked both ways: what it is called, its program, and the workspace and root it reads. */
interface Asked {
    readonly label: string;
    readonly program: string;
    readonly workspace: 'corpus' | 'bench' | 'joins';
    readonly root: QueryRoot;
}

/** The corpus as this suite asks it: how each of its root queries plans. */
interface CorpusPlans {
    /** The cases over the fixture's root that check as e3 roots. */
    readonly cases: number;
    /** The split calls, each once, named by every case that makes it. */
    readonly split: Asked[];
    /** The cases those split calls stand for. */
    readonly splitCases: number;
    /** The cases that run as one unit, by east's reason. */
    readonly one: SortedMap<string, string[]>;
    /** The cases whose split could not be made, and why. */
    readonly failed: string[];
}

/**
 * The corpus's cases over the fixture's root that check as e3 roots, and how
 * each plans: a split call, or one unit and why. Cases whose split calls are
 * the same call — the same program, or programs that translate alike — are
 * asked once.
 */
function corpusQueries(): CorpusPlans {
    const corpus = decodeBeast2For(CorpusType)(readFileSync(new URL('query-corpus.beast2', FIXTURES)));
    const rootType = toEastTypeValue(FixtureRoot);
    const byProgram = new SortedMap<string, string[]>([], compareFor(StringType));
    for (const entry of corpus.cases) {
        if (!isTypeValueEqual(entry.case.input, rootType)) continue;
        if (checkJq(entry.case.program, FixtureRoot, { root: true }).program === null) continue;
        byProgram.set(entry.case.program, [...byProgram.get(entry.case.program) ?? [], entry.case.name]);
    }
    const byCall = new SortedMap<string, { program: string; names: string[] }>([], compareFor(StringType));
    const one = new SortedMap<string, string[]>([], compareFor(StringType));
    const failed: string[] = [];
    let cases = 0;
    for (const [program, names] of byProgram) {
        cases += names.length;
        const drafted = draftPlan(program, CORPUS_ROOT);
        if ('result' in drafted) {
            failed.push(`${names.join(', ')}: checks as a root, and its plan's check refused it`);
            continue;
        }
        const split = drafted.draft.split;
        if (split.kind === 'failed') {
            failed.push(`${names.join(', ')}: ${split.message}`);
        } else if (split.kind === 'whole') {
            one.set(split.reason.code, [...one.get(split.reason.code) ?? [], ...names]);
        } else {
            const call = computeHash(encodeBeast2For(SplitCallRequestType)(splitCallRequest(split, CORPUS_ROOT)));
            const known = byCall.get(call);
            byCall.set(call, known === undefined ? { program, names } : { program: known.program, names: [...known.names, ...names] });
        }
    }
    const byLabel = compareFor(StringType);
    const split = [...byCall.values()]
        .map(({ program, names }): Asked => ({ label: names.join(', '), program, workspace: 'corpus', root: CORPUS_ROOT }))
        .sort((a, b) => byLabel(a.label, b.label));
    return { cases, split, splitCases: [...byCall.values()].reduce((n, { names }) => n + names.length, 0), one, failed };
}

/** The benchmark's questions, over its data. */
const BENCH: readonly Asked[] = bench.QUERIES.map((q) => ({ label: `${q.id}, ${q.label}`, program: q.program, workspace: 'bench', root: bench.ROOT }));

/** Each workspace the queries are asked of, and its root. */
const WORKSPACES: readonly (readonly [workspace: Asked['workspace'], root: QueryRoot])[] = [['corpus', CORPUS_ROOT], ['bench', bench.ROOT], ['joins', STOCK_ROOT]];

/** Joins of the stock with the prices, read only at the row's own SKU: cut at the same keys (#942), as the east split spec asks them. */
const JOINS: readonly Asked[] = ([
    ['the worth of each SKU held', '.prices as $p | .stock | to_entries | map({sku: .key, worth: (.value * ($p[.key] // 0))})'],
    ['the worth of the stock', '.prices as $p | .stock | to_entries | map(.value * ($p[.key] // 0)) | add'],
    ['the SKUs held and not priced', '.prices as $p | [.stock | to_entries[] | .key as $k | select($p | has($k) | not) | $k]'],
    ['the four held worth the most', '.prices as $p | .stock | to_entries | map(select(.value > 3)) | map({sku: .key, worth: (.value * ($p[.key] // 0))}) | sort_by(-.worth) | .[:4]'],
    ['the SKUs priced and not held', '.stock as $s | .prices | to_entries | map(select($s[.key] == null) | .key)'],
] as const).map(([label, program]) => ({ label, program, workspace: 'joins', root: STOCK_ROOT }));

// ─── The runners and the repositories ────────────────────────────────────────

/** A stock runner given no platform package, each collection read lazily, as the builder's runner is. */
const stock = (runtime: 'east_node' | 'east_c' | 'east_py'): RunnerValue => variant(runtime, { platforms: [], decode: variant('lazy', null) });

/** A repository's directory, as the suite makes its own under the system's temporary directory: where e3 looks a runner up from, beside the working directory. */
const REPO_AT = join(tmpdir(), 'e3-ui-query-equivalence', 'repo');

/** The stock runners, and the file e3 runs for each: `null` when it finds none. */
const RUNNERS: readonly { readonly name: string; readonly runner: RunnerValue; readonly file: string | null }[] = [
    { name: 'east-node', runner: stock('east_node'), file: enabled ? runnerFile('east-node', REPO_AT) : null },
    { name: 'east-c', runner: stock('east_c'), file: enabled ? runnerFile('east-c', REPO_AT) : null },
    { name: 'east-py', runner: stock('east_py'), file: enabled ? runnerFile('east-py', REPO_AT) : null },
];
const FOUND = RUNNERS.filter((r) => r.file !== null);

/** The `-j` each repository's server runs under; the one-shot calls run under the last. */
const JOBS: readonly number[] = [1, 4];

/** The pieces e3 aims for, in stored bytes: a segment holds more, so each piece is a segment. */
const PIECE_TARGET = 64;
/** e3's smallest piece at that setting, which a plan weighs a dataset against. */
const PIECE_MIN = PIECE_TARGET / 4;

/** A call's options: no token, and no retry, so a call that fails fails the test. */
const CALL = { token: null, retry: { attempts: 1 } };

/** A repository, its `-j`, and the server over it. */
interface Repo {
    readonly jobs: number;
    readonly path: string;
    readonly server: RepoServerHandle;
}

// ─── Reading what came back ──────────────────────────────────────────────────

/** Whether a type holds a Float anywhere: its answers agree within rounding rather than byte for byte. */
function holdsFloat(type: EastTypeValue): boolean {
    switch (type.type) {
        case 'Float':
            return true;
        case 'Never': case 'Null': case 'Boolean': case 'Integer': case 'String': case 'DateTime': case 'Blob':
            return false;
        case 'Ref': case 'Array': case 'Set': case 'Vector': case 'Matrix':
            return holdsFloat(type.value);
        case 'Dict':
            return holdsFloat(type.value.key) || holdsFloat(type.value.value);
        case 'Struct': case 'Variant':
            return type.value.some((field) => holdsFloat(field.type));
        case 'Function': case 'AsyncFunction':
            return type.value.inputs.some(holdsFloat) || holdsFloat(type.value.output);
        case 'Recursive':
            // A reference back into a type already walked holds what that type holds.
            return type.value.type === 'wrapper' && holdsFloat(type.value.value.inner);
    }
}

/** Whether two East values of a type are equal, Floats to within rounding: a sum's grouping changes its last bits. */
function close(type: EastType, a: unknown, b: unknown): boolean {
    const t = type.type === 'Recursive' ? type.node as EastType : type;
    switch (t.type) {
        case 'Float': {
            const [x, y] = [a as number, b as number];
            return equalFor(t)(x, y) || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
        }
        case 'Array': {
            const [xs, ys] = [a as unknown[], b as unknown[]];
            return xs.length === ys.length && xs.every((x, i) => close(t.value as EastType, x, ys[i]));
        }
        case 'Struct':
            return Object.entries(t.fields as Record<string, EastType>).every(([name, field]) => close(field, (a as Record<string, unknown>)[name], (b as Record<string, unknown>)[name]));
        case 'Variant':
            // Each a variant by East's brand, and the same case, its payloads close.
            return isVariant(a) && isVariant(b) && a.type === b.type && close((t.cases as Record<string, EastType>)[a.type]!, a.value, b.value);
        case 'Dict': {
            const [x, y] = [[...(a as SortedMap<unknown, unknown>).entries()], [...(b as SortedMap<unknown, unknown>).entries()]];
            const sameKey = equalFor(t.key as EastType);
            return x.length === y.length && x.every(([k, v], i) => sameKey(k as never, y[i]![0] as never) && close(t.value as EastType, v, y[i]![1]));
        }
        default:
            return equalFor(type)(a as never, b as never);
    }
}

/** An answer: its bytes, decoded at the type they carry, and how many outputs it holds. */
interface Answer {
    readonly bytes: Uint8Array;
    readonly type: EastTypeValue;
    readonly value: unknown;
    readonly outputs: bigint;
    readonly truncated: boolean;
}

/** A result's answer; the test fails on any other outcome, naming it. */
function answerOf(result: QueryResult, what: string): Answer {
    if (result.outcome.type !== 'ok') {
        const said = result.outcome.type === 'error' ? `: ${result.outcome.value.map((diagnostic) => diagnostic.message).join('; ')}` : '';
        assert.fail(`${what} answered ${result.outcome.type}${said}`);
    }
    const { result: bytes, outputs, truncated } = result.outcome.value;
    const decoded = decodeBeast2(bytes);
    return { bytes, type: decoded.type, value: decoded.value, outputs, truncated };
}

/** An East value as East's text prints it, cut to a length a message can hold. */
function printed(type: EastTypeValue, value: unknown): string {
    const text = printFor(type)(value);
    return text.length <= 600 ? text : `${text.slice(0, 600)}… (${text.length} characters)`;
}

/** Each dataset a run read, by its data source's name, with the hash e3 pinned it at. */
const pinned = (result: QueryResult): Map<string, string> => new Map(result.inputs.map((input) => [input.name, input.hash]));

/** The (task, inputs) pairs the repository records executions under, as `task/inputs`. */
async function pairsOf(storage: LocalStorage, repo: string): Promise<Set<string>> {
    return new Set((await executionList(storage, repo)).map(({ taskHash, inputsHash }) => `${taskHash}/${inputsHash}`));
}

/** The units recorded under pairs `before` does not hold — the ones a call ran — each output by its inputs, and any that did not succeed. */
async function unitsSince(storage: LocalStorage, repo: string, before: ReadonlySet<string>): Promise<{ units: Map<string, string>; failures: string[] }> {
    const units = new Map<string, string>();
    const failures: string[] = [];
    for (const { taskHash, inputsHash } of await executionList(storage, repo)) {
        if (before.has(`${taskHash}/${inputsHash}`)) continue;
        for (const id of await executionListIds(storage, repo, taskHash, inputsHash)) {
            const status = await executionGet(storage, repo, taskHash, inputsHash, id);
            // The split task's own execution is not one of its units.
            if (status === null || !status.value.unit) continue;
            if (status.type !== 'success') {
                failures.push(`a unit over inputs ${inputsHash} ended ${status.type}`);
                continue;
            }
            const was = units.get(inputsHash);
            if (was !== undefined && was !== status.value.outputHash) failures.push(`the unit over inputs ${inputsHash} ran twice, to ${was} and ${status.value.outputHash}`);
            units.set(inputsHash, status.value.outputHash);
        }
    }
    return { units, failures };
}

/** A plan this suite runs as split calls: one, or a re-keyed join's two (#942). */
type CallPlan = Exclude<QueryPlan, { readonly kind: 'one_shot' }>;

/** One split call of a query's: what it is, the pieces e3 cut, the assembled output's hash, each unit's output by its inputs, and any unit that did not succeed. */
interface Stage {
    readonly what: 'split call' | 're-key call' | 'join call';
    readonly pieces: number;
    readonly output: string | null;
    readonly units: Map<string, string>;
    readonly failures: string[];
}

/** A query's split calls on one runner: where they ran, what the query answered, each call in order, and how long they took. */
interface SplitRun {
    readonly runner: string;
    readonly jobs: number;
    readonly repo: string;
    readonly result: QueryResult;
    /** The split call; or a re-keyed join's re-key call, then its join call. */
    readonly stages: Stage[];
    readonly ms: number;
}

/** A query asked of one repository: its one-shot calls by runner (in the one repository that makes them), and its split calls. */
interface RepoRun {
    readonly jobs: number;
    readonly oneShots: Map<string, QueryResult>;
    readonly calls: SplitRun[];
}

// ─── The spec ────────────────────────────────────────────────────────────────

describe('query plans answer as one unit does (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    const corpus: CorpusPlans = enabled
        ? corpusQueries()
        : { cases: 0, split: [], splitCases: 0, one: new SortedMap([], compareFor(StringType)), failed: [] };
    const storage = new LocalStorage();
    const repos: Repo[] = [];
    let scratch: string;
    let pieceBytes: string | undefined;
    let blasThreads: string | undefined;
    let file: Fixture;
    let fixture: Fixture;
    /** What each data source weighs, by workspace and name: what a plan is weighed by. */
    const weights = new Map<Asked['workspace'], Map<string, SourceWeight>>();
    /** The calls' times, by what ran: a runner's split calls at a `-j`, or its one-shot calls. */
    const times = new Map<string, { calls: number; ms: number }>();
    /** The query whose units assembled each output, by runner, `-j` and the output's hash. */
    const assembledBy = new Map<string, string>();
    let started = 0;

    const timed = (what: string, ms: number): void => {
        const was = times.get(what) ?? { calls: 0, ms: 0 };
        times.set(what, { calls: was.calls + 1, ms: was.ms + ms });
    };

    /** A query's split calls on a runner, as the builder plans them: the test fails unless it makes some. */
    function callPlan(asked: Asked, runner: RunnerValue): CallPlan {
        const planned = planQuery(asked.program, asked.root, weights.get(asked.workspace)!, { pieceBytes: PIECE_MIN, runner });
        if ('result' in planned) assert.fail(`${asked.label}: ${asked.program} does not check`);
        const plan = planned.plan;
        if (plan.kind === 'one_shot') {
            const why = plan.explanation.path.kind === 'one_shot' ? plan.explanation.path.why.kind : '';
            assert.fail(`${asked.label}: ${asked.program} planned one call (${why}), though its split cuts a dataset of several pieces`);
        }
        return plan;
    }

    /**
     * A query asked of one repository: the one-shot calls when asked for, and
     * each runner's split calls in turn — each explained by e3 first, once a
     * repository, since the pieces are the inputs' and not the runner's.
     */
    async function runOn(repo: Repo, asked: Asked, plans: { name: string; runner: RunnerValue; plan: CallPlan }[], oneShots: boolean): Promise<RepoRun> {
        const { apiUrl, repo: id } = repo.server;
        /** The pieces of each of the query's calls, in order, as e3 explains them. */
        const explained: number[] = [];
        const shots = new Map<string, QueryResult>();
        if (oneShots) {
            for (const { name, runner } of plans) {
                const prepared = prepareQuery(asked.program, asked.root, { runner });
                if ('result' in prepared) assert.fail(`${asked.label}: ${asked.program} does not check`);
                const at = performance.now();
                shots.set(name, queryResultOf(prepared.prepared, await oneShotExecute(apiUrl, id, asked.workspace, prepared.prepared.request, CALL)));
                timed(`${name} one-shot`, performance.now() - at);
            }
        }
        const calls: SplitRun[] = [];
        for (const { name, plan } of plans) {
            const stages: Stage[] = [];
            let ms = 0;
            /** One split call: its pieces, the call, and the units it ran. */
            const call = async (request: SplitCallRequest, what: Stage['what']): Promise<SplitCallAnswer> => {
                const at = stages.length;
                if (explained[at] === undefined) explained[at] = Number((await splitCallExplain(apiUrl, id, asked.workspace, request, CALL)).pieces);
                const before = await pairsOf(storage, repo.path);
                const started = performance.now();
                const answer = await splitCall(apiUrl, id, asked.workspace, request, CALL).catch((err: unknown) => {
                    throw new Error(`${asked.label}: the ${what} on ${name} at -j ${repo.jobs} failed: ${err instanceof Error ? err.message : String(err)}`);
                });
                ms += performance.now() - started;
                const { units, failures } = await unitsSince(storage, repo.path, before);
                stages.push({ what, pieces: explained[at]!, output: answer.output, units, failures });
                return answer;
            };
            let answer: ExecuteResult;
            if (plan.kind === 'split') {
                answer = (await call(plan.request, 'split call')).result;
            } else {
                // A re-keyed join (#942): the re-key call, then the join call over its output, by its hash.
                const first = await call(plan.first, 're-key call');
                const joined = first.output === null ? undefined : (await call(plan.join(first.output), 'join call')).result;
                answer = plan.answer(first.result, joined);
            }
            timed(`${name} -j ${repo.jobs}`, ms);
            calls.push({ runner: name, jobs: repo.jobs, repo: repo.path, result: queryResultOf(plan.reading, answer), stages, ms });
        }
        return { jobs: repo.jobs, oneShots: shots, calls };
    }

    /** A unit's output, decoded and printed, for a message. */
    async function unitOutput(call: SplitRun, hash: string): Promise<string> {
        const { type, value } = await datasetRead(storage, call.repo, hash);
        return printFor(type)(value).slice(0, 400);
    }

    /** Every way the units of one split call differ from another's: inputs one ran and the other did not, and outputs that differ. */
    async function unitDifferences(reference: SplitRun, theirs: Stage, call: SplitRun, mine: Stage): Promise<string[]> {
        const out: string[] = [];
        for (const [inputs, output] of theirs.units) {
            const other = mine.units.get(inputs);
            if (other === undefined) {
                out.push(`no unit over inputs ${inputs}, which ${reference.runner} at -j ${reference.jobs} ran`);
            } else if (other !== output) {
                out.push(`the unit over inputs ${inputs} wrote ${other}, not ${output}:\n      ${call.runner}: ${await unitOutput(call, other)}\n      ${reference.runner}: ${await unitOutput(reference, output)}`);
            }
        }
        for (const inputs of mine.units.keys()) {
            if (!theirs.units.has(inputs)) out.push(`a unit over inputs ${inputs}, which ${reference.runner} at -j ${reference.jobs} did not run`);
        }
        return out;
    }

    /** O1 and O2 for one query: both repositories, every runner found. */
    async function equivalence(t: TestContext, asked: Asked): Promise<void> {
        assert.ok(FOUND.length > 0, 'e3 finds no stock runner');
        const plans = FOUND.map(({ name, runner }) => ({ name, runner, plan: callPlan(asked, runner) }));
        const runs = await Promise.all(repos.map((repo) => runOn(repo, asked, plans, repo.jobs === JOBS[JOBS.length - 1])));
        const calls = runs.flatMap((run) => run.calls);

        // Every runner, at every -j, makes the same calls: one split call, or a re-keyed join's two.
        const made = calls[0]!.stages.map((stage) => stage.what);
        for (const call of calls) {
            assert.deepEqual(call.stages.map((stage) => stage.what), made, `${asked.label}: on ${call.runner} at -j ${call.jobs}, the calls made`);
            for (const stage of call.stages) {
                assert.ok(stage.pieces > 1, `${asked.label}: on ${call.runner} at -j ${call.jobs}, e3 cut its ${stage.what} into ${stage.pieces} piece, not several`);
                assert.deepEqual(stage.failures, [], `${asked.label}: on ${call.runner} at -j ${call.jobs}, a unit of its ${stage.what} did not succeed`);
            }
        }
        if (made.length > 1) t.diagnostic(`a re-keyed join: ${calls[0]!.stages.map((stage) => `its ${stage.what}, ${stage.pieces} pieces`).join(', then ')}`);
        // A split task is its piece program, its runner, its arguments' partitions and its output kind — not
        // `then` — so a call that differs from an earlier query's only after its pieces assemble is that query's
        // task, served whole from the cache: no unit runs, on any runner at any -j, and each assembles what that
        // query's units did. Those units were compared when that query ran. Each of a query's calls is its own task.
        for (const [s, what] of made.entries()) {
            const cached = calls.filter((call) => call.stages[s]!.units.size === 0);
            if (cached.length > 0) {
                assert.equal(cached.length, calls.length, `${asked.label}: ${cached.length} of its ${calls.length} ${what}s ran no unit, and a task is served whole from the cache or not at all`);
                const sources = new Set<string>();
                for (const call of calls) {
                    const output = call.stages[s]!.output;
                    const source = assembledBy.get(`${call.runner} -j ${call.jobs} ${output}`);
                    assert.ok(source !== undefined, `${asked.label}: on ${call.runner} at -j ${call.jobs}, its ${what} ran no unit, and no query before it assembled ${output}`);
                    sources.add(source);
                }
                t.diagnostic(`its ${what}'s task is ${[...sources].join(', ')}'s, served from the cache: the units ran, and were compared, then`);
            } else {
                for (const call of calls) {
                    const stage = call.stages[s]!;
                    assert.ok(stage.units.size >= stage.pieces, `${asked.label}: on ${call.runner} at -j ${call.jobs}, ${stage.units.size} units of its ${what} ran for ${stage.pieces} pieces`);
                    assembledBy.set(`${call.runner} -j ${call.jobs} ${stage.output}`, asked.label);
                }
            }
        }

        // O1: each runner's split calls answer as its one-shot call does.
        const shots = runs.find((run) => run.oneShots.size > 0)!.oneShots;
        for (const call of calls) {
            const one = shots.get(call.runner)!;
            const want = answerOf(one, `${asked.label}: the one-shot call on ${call.runner}`);
            const got = answerOf(call.result, `${asked.label}: the split calls on ${call.runner} at -j ${call.jobs}`);
            const where = `${asked.label}: on ${call.runner} at -j ${call.jobs}`;
            assert.ok(isTypeValueEqual(got.type, want.type), `${where}, the split call answers at another type than the one-shot call:\n  split:    ${printFor(EastTypeType)(got.type)}\n  one-shot: ${printFor(EastTypeType)(want.type)}`);
            if (holdsFloat(want.type)) {
                assert.ok(close(fromEastTypeValue(want.type), got.value, want.value),
                    `${where}, the split call's answer is not the one-shot call's within rounding:\n  split:    ${printed(got.type, got.value)}\n  one-shot: ${printed(want.type, want.value)}`);
                assert.ok(equalFor(IntegerType)(got.outputs, want.outputs) && equalFor(BooleanType)(got.truncated, want.truncated),
                    `${where}, the split call answers ${printFor(IntegerType)(got.outputs)} outputs (truncated ${printFor(BooleanType)(got.truncated)}), the one-shot call ${printFor(IntegerType)(want.outputs)} (truncated ${printFor(BooleanType)(want.truncated)})`);
            } else {
                assert.ok(equalFor(BlobType)(got.bytes, want.bytes),
                    `${where}, the split call's answer is not the one-shot call's byte for byte (${got.bytes.length} and ${want.bytes.length} bytes):\n  split:    ${printed(got.type, got.value)}\n  one-shot: ${printed(want.type, want.value)}`);
            }
            assert.deepEqual(pinned(call.result), pinned(one), `${where}, the split call read what the one-shot call read`);
        }

        // O2: every runner, at every -j, runs the same units to the same bytes in each call, and assembles and answers alike.
        const reference = calls[0]!;
        for (const call of calls.slice(1)) {
            const where = `${asked.label}: ${call.runner} at -j ${call.jobs} against ${reference.runner} at -j ${reference.jobs}`;
            for (const [s, theirs] of reference.stages.entries()) {
                const mine = call.stages[s]!;
                const differences = await unitDifferences(reference, theirs, call, mine);
                if (differences.length > 0) assert.fail(`${where}, the units of its ${mine.what} differ:\n  ${differences.join('\n  ')}`);
                assert.ok(mine.output !== null && theirs.output !== null && mine.output === theirs.output,
                    `${where}, its ${mine.what} assembled ${mine.output}, not ${theirs.output}`);
            }
            const [got, want] = [answerOf(call.result, where), answerOf(reference.result, where)];
            assert.ok(equalFor(BlobType)(got.bytes, want.bytes),
                `${where}, the answers differ (${got.bytes.length} and ${want.bytes.length} bytes):\n  ${call.runner}: ${printed(got.type, got.value)}\n  ${reference.runner}: ${printed(want.type, want.value)}`);
        }
    }

    before(async () => {
        started = performance.now();
        pieceBytes = process.env['E3_TEST_PIECE_BYTES'];
        process.env['E3_TEST_PIECE_BYTES'] = String(PIECE_TARGET);
        blasThreads = process.env['OPENBLAS_NUM_THREADS'];
        process.env['OPENBLAS_NUM_THREADS'] = '1';
        scratch = mkdtempSync(join(tmpdir(), 'e3-ui-query-equivalence-'));
        // Each runner e3 runs is this tree's, before anything is made for it.
        for (const { name, file } of FOUND) assertThisTreesRunner(name, file!, join(scratch, `repo-j${JOBS[0]}`));

        file = decodeBeast2For(FixtureRoot)(readFileSync(new URL('query-fixture.beast2', FIXTURES)));
        fixture = scaledFixture(file);
        const benchOrders = Array.from(bench.orders(BENCH_ORDER_COUNT), ({ order }) => order);
        const benchCustomers = new SortedMap(Array.from(bench.customers(), ({ id, customer }) => [id, customer] as const), compareFor(StringType));
        const benchShipments = new SortedMap(benchOrders.flatMap((order) => {
            const shipment = bench.shipmentOf(order);
            return shipment === undefined ? [] : [[order.id, shipment] as [bigint, bench.Shipment]];
        }), compareFor(IntegerType));
        const stock = stockData();

        const fixtureZip = join(scratch, 'fixture.zip');
        const benchZip = join(scratch, 'bench.zip');
        const joinsZip = join(scratch, 'joins.zip');
        await e3.export(e3.package('fixture', '1.0.0', ...FIELDS.map((name) => e3.input(name, FixtureRoot.fields[name]))), fixtureZip);
        await e3.export(e3.package('bench', '1.0.0', e3.input('orders', bench.OrdersType), e3.input('customers', bench.CustomersType), e3.input('shipments', bench.ShipmentsType)), benchZip);
        await e3.export(e3.package('joins', '1.0.0', ...STOCK_FIELDS.map((name) => e3.input(name, StockRoot.fields[name]))), joinsZip);

        // A repository a -j: a unit another -j ran is never served from the cache.
        for (const jobs of JOBS) {
            const path = join(scratch, `repo-j${jobs}`);
            mkdirSync(path);
            repoInit(path);
            await packageImport(storage, path, fixtureZip);
            await packageImport(storage, path, benchZip);
            await packageImport(storage, path, joinsZip);
            await workspaceCreate(storage, path, 'corpus');
            await workspaceDeploy(storage, path, 'corpus', 'fixture', '1.0.0');
            for (const name of FIELDS) await workspaceSetDataset(storage, path, 'corpus', inputPath(name), fixture[name], FixtureRoot.fields[name]);
            await workspaceCreate(storage, path, 'bench');
            await workspaceDeploy(storage, path, 'bench', 'bench', '1.0.0');
            await workspaceSetDataset(storage, path, 'bench', bench.ORDERS, benchOrders, bench.OrdersType);
            await workspaceSetDataset(storage, path, 'bench', bench.CUSTOMERS, benchCustomers, bench.CustomersType);
            await workspaceSetDataset(storage, path, 'bench', bench.SHIPMENTS, benchShipments, bench.ShipmentsType);
            await workspaceCreate(storage, path, 'joins');
            await workspaceDeploy(storage, path, 'joins', 'joins', '1.0.0');
            for (const name of STOCK_FIELDS) await workspaceSetDataset(storage, path, 'joins', inputPath(name), stock[name], StockRoot.fields[name]);
            repos.push({ jobs, path, server: await startRepoServer(path, { jobs: String(jobs) }) });
        }

        // What each data source weighs, as e3's status says: the data is the same in every repository.
        const { apiUrl, repo } = repos[0]!.server;
        for (const [workspace, root] of WORKSPACES) {
            const byName = new Map<string, SourceWeight>();
            for (const entry of root.entries) {
                const status = await datasetGetStatus(apiUrl, repo, workspace, entry.path, CALL);
                byName.set(entry.name, {
                    bytes: status.size.type === 'some' ? Number(status.size.value) : undefined,
                    rows: status.rows.type === 'some' ? Number(status.rows.value) : undefined,
                });
            }
            weights.set(workspace, byName);
        }
    });

    after(async () => {
        for (const repo of repos) await repo.server.stop();
        if (pieceBytes === undefined) delete process.env['E3_TEST_PIECE_BYTES'];
        else process.env['E3_TEST_PIECE_BYTES'] = pieceBytes;
        if (blasThreads === undefined) delete process.env['OPENBLAS_NUM_THREADS'];
        else process.env['OPENBLAS_NUM_THREADS'] = blasThreads;
        if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    });

    it('the fixture scaled: its own generator draws the file\'s orders first, and every collection is several segments', async () => {
        assert.equal(file.orders.length, FILE_ORDERS, 'the file holds its generator\'s first orders');
        assert.ok(equalFor(ArrayType(Order))(fixture.orders.slice(0, file.orders.length), file.orders),
            'the fixture\'s generator, as this spec draws it, gives the file\'s orders first');
        assert.ok(equalFor(DictType(IntegerType, Order))(new SortedMap([...fixture.byId].slice(0, file.byId.size), compareFor(IntegerType)), file.byId),
            'byId holds the file\'s orders by id first');
        const { apiUrl, repo } = repos[0]!.server;
        for (const [workspace, root] of WORKSPACES) {
            for (const entry of root.entries) {
                const status = await datasetGetStatus(apiUrl, repo, workspace, entry.path, CALL);
                if (status.segments.type === 'none') continue;
                assert.ok(status.segments.value > 1n, `${workspace}'s ${entry.name} is ${printFor(IntegerType)(status.segments.value)} segment: a split over it would be one piece`);
            }
        }
    });

    it('the corpus: every case over the fixture\'s root that checks as an e3 root, some of them split', (t) => {
        const reasons = [...corpus.one].map(([reason, names]) => `${reason} ${names.length}`).join(', ');
        t.diagnostic(`${corpus.cases} corpus cases over the fixture's root check as e3 roots: ${corpus.splitCases} run as ${corpus.split.length} split calls, ${corpus.cases - corpus.splitCases - corpus.failed.length} as one unit (${reasons})`);
        assert.ok(corpus.cases > 0, 'the corpus holds cases over the fixture\'s root');
        assert.deepEqual(corpus.failed, [], 'every split east makes of a corpus query builds');
        assert.ok(corpus.split.length > 0, 'some corpus queries split');
    });

    for (const asked of [...corpus.split, ...BENCH, ...JOINS]) {
        const which = asked.workspace === 'corpus' ? 'corpus' : asked.workspace === 'bench' ? 'benchmark' : 'join';
        it(`${which} ${asked.label}: the split calls answer as one unit does, and every runner at every -j runs the same units`, (t) => equivalence(t, asked));
    }

    for (const { name } of RUNNERS.filter((r) => r.file === null)) {
        it(`on ${name}`, { skip: `e3 finds no ${name}` }, () => {});
    }

    it('reports what the calls took', (t: TestContext) => {
        for (const { name, file } of FOUND) t.diagnostic(`${name}: e3 runs ${file}`);
        for (const [what, { calls, ms }] of times) t.diagnostic(`${what}: ${calls} calls, ${(ms / 1000).toFixed(1)} s`);
        t.diagnostic(`the suite so far: ${((performance.now() - started) / 1000).toFixed(1)} s`);
    });
});
