/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's plans against a real e3 (#941, N3 and N4) — gated by
 * `E3_UI_INTEGRATION=1`, as the terminal UI's integration spec is: an embedded
 * `@elaraai/e3-api-server` over a repository seeded at test time, each call
 * planned and built by the builder's planner (`@elaraai/e3-ui-components/query`)
 * and sent with e3-api-client, as the builder sends it.
 *
 * `E3_TEST_PIECE_BYTES` makes e3's pieces small, and each plan's `pieceBytes`
 * is e3's smallest piece at that setting, so a few MB of orders are many
 * pieces and every query that splits runs as a split call:
 *
 * - **N3**: each split call answers as the query's one-shot call does —
 *   revenue by region with the customers read whole, the first and the last
 *   row of a key, the least and the last greatest row, the first and the last
 *   total, the distinct values, the top rows kept in the pieces, a count of
 *   lines — a float to within rounding, since the pieces add in another
 *   grouping; and joins (#942): two dicts keyed alike, read only at the row's
 *   key, cut at the same keys, and a join both of whose sides weigh more than
 *   one piece re-keyed — two split calls, the second over the first's output
 *   by its hash. At two input sizes, the larger twice the pieces, every unit
 *   names its runner's peak. With `E3_UI_PERF=1`, no unit's peak passes the
 *   runner's baseline plus the RunSorter's cap, and the larger raises no unit's
 *   peak beyond a margin: a peak in MiB is the machine's and its garbage
 *   collector's, so on a shared runner it is a flaky test, never a CI gate —
 *   as the terminal UI's CPU budgets are (#1262).
 * - **N4**: a relaunch is served from the cache, running no unit; after an
 *   append, only the pieces around it run, and the answer is the one-shot
 *   call's over the new rows.
 *
 * What ran is read from e3's execution records: every unit that runs — a piece
 * or a merge — writes one, with its runner's peak, and a unit served from the
 * cache writes none. The calls run on every stock runner e3 finds: east-node,
 * which this package's `node_modules/.bin` holds, and east-c when it is on
 * PATH — put this tree's first. e3 looks a runner up in every
 * `node_modules/.bin` and the first `.venv` above the repository and the
 * working directory before PATH (`testing/runners.ts`), so each runner's leg
 * names the file e3 runs, and fails before its first call when that file is not
 * a build of this tree: a runner from another release need not speak this
 * one's unit protocol.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import {
    ArrayType, DictType, FloatType, IntegerType, RUN_MAX_BYTES, SortedMap, StringType, StructType,
    compareFor, decodeBeast2, equalFor, fromEastTypeValue, isTypeEqual, isVariant, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { datasetGetStatus, oneShotExecute, splitCall, splitCallExplain } from '@elaraai/e3-api-client';
import type { RunnerValue, TreePath } from '@elaraai/e3-types';
import {
    LocalStorage, executionGet, executionList, executionListIds, packageImport, repoInit, workspaceCreate, workspaceDeploy, workspaceSetDataset,
} from '@elaraai/e3-core';
import { planQuery, prepareQuery, queryResultOf, queryRoot, type QueryResult } from '@elaraai/e3-ui-components/query';
import { startRepoServer, type RepoServerHandle } from './e3-server.js';
import { assertThisTreesRunner, runnerFile } from './testing/runners.js';

const enabled = process.env['E3_UI_INTEGRATION'] === '1';
/** Whether the units' peaks are held to their budgets — a measure of the machine, so opt-in, as `perf.spec.tsx`'s are. */
const perf = process.env['E3_UI_PERF'] === '1';

// ─── The data ────────────────────────────────────────────────────────────────

const LineType = StructType({ sku: StringType, qty: IntegerType, price: FloatType });
const OrderType = StructType({ id: IntegerType, customer_id: StringType, total: FloatType, lines: ArrayType(LineType) });
const OrdersType = ArrayType(OrderType);
const CustomerType = StructType({ name: StringType, region: StringType });
const CustomersType = DictType(StringType, CustomerType);
/** Each customer's credit limit: a dict keyed as the customers are. */
const CreditType = DictType(StringType, FloatType);
type Order = ValueTypeOf<typeof OrderType>;

const ORDERS: TreePath = [variant('field', 'inputs'), variant('field', 'orders')];
const CUSTOMERS: TreePath = [variant('field', 'inputs'), variant('field', 'customers')];
const CREDIT: TreePath = [variant('field', 'inputs'), variant('field', 'credit')];
const ROOT = queryRoot([
    { name: 'orders', path: ORDERS, type: toEastTypeValue(OrdersType) },
    { name: 'customers', path: CUSTOMERS, type: toEastTypeValue(CustomersType) },
    { name: 'credit', path: CREDIT, type: toEastTypeValue(CreditType) },
]);
/** Each data source's path, by its name. */
const PATHS: ReadonlyMap<string, TreePath> = new Map([['orders', ORDERS], ['customers', CUSTOMERS], ['credit', CREDIT]]);

/** The smaller input's orders, about 2.5 MB: some 8 pieces at the test's piece size. The larger holds twice as many. */
const ORDER_COUNT = 40_000;
/** The customers, and the regions they are in. */
const CUSTOMER_COUNT = 500;
/** The customers a re-keyed join reads (#942), some 130 KB as e3 stores them: more than one piece at the test's piece size, so a join of the orders with them is re-keyed. */
const REKEY_CUSTOMERS = 20_000;
/**
 * The customers a join cut at the same keys reads (#942), some 2 MB as e3
 * stores them — about 7 bytes a customer: as the orders are, many pieces at
 * the test's piece size, since e3 closes a piece only between a dict's
 * segments, which its writer cuts at 64 KiB to 8 MiB.
 */
const COPARTITIONED_CUSTOMERS = 300_000;
const REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Coast', 'Inland'];
/** The pieces e3 aims for, in stored bytes: 64 KiB to 1 MiB, a few segments each. */
const PIECE_TARGET = 256 * 1024;
/** e3's smallest piece at that setting, which a plan weighs a dataset against. */
const PIECE_MIN = PIECE_TARGET / 4;
const MiB = 2 ** 20;
const NO_TOKEN = { token: null };

/** A customer's id. */
const customerId = (i: number): string => `C${String(i).padStart(4, '0')}`;

/** The first `count` customers, each in a region. */
function customers(count = CUSTOMER_COUNT): SortedMap<string, ValueTypeOf<typeof CustomerType>> {
    return new SortedMap(
        Array.from({ length: count }, (_, i) => [customerId(i), { name: `Customer ${i}`, region: REGIONS[(i * 7) % REGIONS.length]! }] as const),
        compareFor(StringType),
    );
}

/** The first `count` customers' credit limits, but every fifth customer's, which has none. */
function credit(count: number): SortedMap<string, number> {
    return new SortedMap(
        Array.from({ length: count }, (_, i) => i).filter((i) => i % 5 !== 0).map((i) => [customerId(i), ((i * 37) % 1000) + 0.5] as const),
        compareFor(StringType),
    );
}

/**
 * Orders `first` to `first + n - 1`, their noise seeded by `seed` and each id,
 * so a run writes the same orders: one of the first `customerCount` customers,
 * a total to the cent — so totals tie — and one to four lines.
 */
function orders(first: number, n: number, seed: number, customerCount = CUSTOMER_COUNT): Order[] {
    return Array.from({ length: n }, (_, j) => {
        const id = first + j;
        let state = ((id * 2654435761) ^ (seed * 0x9e3779b9)) >>> 0 || 7;
        const rnd = (): number => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({
            sku: `SKU-${Math.floor(rnd() * 300)}`, qty: BigInt(1 + Math.floor(rnd() * 9)), price: Math.round(rnd() * 2000) / 100,
        }));
        return { id: BigInt(id), customer_id: customerId(Math.floor(rnd() * customerCount)), total: Math.round(rnd() * 5000) / 100, lines };
    });
}

// ─── The queries ─────────────────────────────────────────────────────────────

/** Revenue by region, the customers read whole by every piece: the issue's N3 query. */
const REVENUE_BY_REGION =
    '.customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})';

/** A query of each kind of split, the order-keeping ones among them, and what each splits as. */
const SPLITS: readonly (readonly [program: string, output: string])[] = [
    [REVENUE_BY_REGION, 'dict'],
    // The first row of each key, and the last value a reduce sets.
    ['.orders | unique_by(.customer_id) | map(.id)', 'dict'],
    ['reduce .orders[] as $o ({}; .[$o.customer_id] = $o.id)', 'dict'],
    // The least row, the last of the greatest — totals tie, and customers repeat — the first and the last total.
    ['.orders | {n: length, lowest: (min_by(.total) | .id), last_greatest: (max_by(.customer_id) | .id), first: (map(.total) | first), last: (map(.total) | .[-1]), any_big: any(.total > 49.5), all_lines: all(.lines | length > 0)}', 'fold'],
    ['.orders | map(.customer_id) | unique', 'set'],
    // The sort's first 20 rows kept in each piece, then across them (#942).
    ['.orders | map(select(.total > 49.5)) | sort_by(-.total) | .[:20] | map(.id)', 'fold'],
    ['.orders | map(.lines | length) | add', 'fold'],
];

/** Joins re-keyed when both sides are large (#942): the orders with the customers, read only at the order's customer. */
const REKEYED: readonly string[] = [
    REVENUE_BY_REGION,
    '.customers as $c | .orders | map($c[.customer_id].region) | unique',
];

/** A join of two dicts keyed alike, the credit read only at the customer's own key: cut at the same keys (#942). */
const CREDIT_BY_REGION =
    '.credit as $l | .customers | to_entries | map({region: .value.region, limit: ($l[.key] // 0)}) | group_by(.region) | map({region: .[0].region, limit: map(.limit) | add, n: length})';

// ─── Reading what came back ──────────────────────────────────────────────────

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

/** A result's answer, decoded at its type; the test fails on any other outcome, naming it. */
function decoded(result: QueryResult, what: string): { type: EastType; value: unknown } {
    if (result.outcome.type !== 'ok') {
        const said = result.outcome.type === 'error' ? `: ${result.outcome.value.map((diagnostic) => diagnostic.message).join('; ')}` : '';
        assert.fail(`${what} answered ${result.outcome.type}${said}`);
    }
    const answer = decodeBeast2(result.outcome.value.result);
    return { type: fromEastTypeValue(answer.type), value: answer.value };
}

/** Each dataset a run read, by its data source's name, with the hash e3 pinned it at. */
const pinned = (result: QueryResult): Map<string, string> => new Map(result.inputs.map((input) => [input.name, input.hash]));

/** Every unit execution the repository records — a piece or a merge — by its key, with its runner's peak in bytes. */
async function unitsOf(storage: LocalStorage, repo: string): Promise<Map<string, number | null>> {
    const units = new Map<string, number | null>();
    for (const { taskHash, inputsHash } of await executionList(storage, repo)) {
        for (const id of await executionListIds(storage, repo, taskHash, inputsHash)) {
            const status = await executionGet(storage, repo, taskHash, inputsHash, id);
            if (status === null || !status.value.unit) continue;
            const peak = status.type === 'success' || status.type === 'failed' ? status.value.peakBytes : null;
            units.set(`${taskHash}/${inputsHash}/${id}`, peak === null || peak.type === 'none' ? null : Number(peak.value));
        }
    }
    return units;
}

/** The units in `after` that `before` does not hold: the ones that ran between them. */
function ranBetween(before: ReadonlyMap<string, number | null>, after: ReadonlyMap<string, number | null>): (number | null)[] {
    return [...after].filter(([key]) => !before.has(key)).map(([, peak]) => peak);
}

/** A repository's directory, as the spec makes its own under the system's temporary directory: where e3 looks a runner up from, beside the working directory. */
const REPO_AT = join(tmpdir(), 'e3-ui-query-plans', 'repo');

/** The stock runners the calls run on, and the file e3 runs for each: east-node always — this package's own devDependency — and east-c when e3 finds one. */
const RUNNERS: { name: string; runner: RunnerValue; file: string | null; required: boolean }[] = [
    { name: 'east-node', runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }), file: enabled ? runnerFile('east-node', REPO_AT) : null, required: true },
    { name: 'east-c', runner: variant('east_c', { platforms: [], decode: variant('lazy', null) }), file: enabled ? runnerFile('east-c', REPO_AT) : null, required: false },
];

// ─── The spec ────────────────────────────────────────────────────────────────

describe('query plans against e3 (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    const storage = new LocalStorage();
    let scratch: string;
    let repo: string;
    let server: RepoServerHandle;
    let pieceBytes: string | undefined;

    /** A workspace of the package, its orders and the first `customerCount` customers set. */
    async function workspace(name: string, rows: Order[], customerCount = CUSTOMER_COUNT): Promise<string> {
        await workspaceCreate(storage, repo, name);
        await workspaceDeploy(storage, repo, name, 'orders', '1.0.0');
        await workspaceSetDataset(storage, repo, name, CUSTOMERS, customers(customerCount), CustomersType);
        await workspaceSetDataset(storage, repo, name, ORDERS, rows, OrdersType);
        return name;
    }

    /** A query's plan on a workspace, the data sources named weighed by their statuses, as the builder weighs them. */
    async function planOf(ws: string, program: string, runner: RunnerValue, weighed: readonly string[]) {
        const weights = new Map<string, { bytes: number | undefined; rows: number | undefined }>();
        for (const name of weighed) {
            const status = await datasetGetStatus(server.apiUrl, server.repo, ws, PATHS.get(name)!, NO_TOKEN);
            weights.set(name, {
                bytes: status.size.type === 'some' ? Number(status.size.value) : undefined,
                rows: status.rows.type === 'some' ? Number(status.rows.value) : undefined,
            });
        }
        const plan = planQuery(program, ROOT, weights, { pieceBytes: PIECE_MIN, runner });
        if ('result' in plan) assert.fail(`${program} does not check`);
        return plan.plan;
    }

    /** A query's plan on a workspace, weighed by its orders' status: the test fails unless it is a split call. */
    async function planned(ws: string, program: string, runner: RunnerValue) {
        const plan = await planOf(ws, program, runner, ['orders']);
        if (plan.kind !== 'split') assert.fail(`${program} planned ${plan.kind}: ${plan.explanation.path.kind === 'one_shot' ? plan.explanation.path.why.kind : ''}`);
        return plan;
    }

    /** A query's split call on a workspace, its answer read as the builder reads it, and how many pieces e3 cut. */
    async function split(ws: string, program: string, runner: RunnerValue): Promise<{ result: QueryResult; output: string; pieces: number }> {
        const plan = await planned(ws, program, runner);
        const explained = await splitCallExplain(server.apiUrl, server.repo, ws, plan.request, NO_TOKEN);
        const answer = await splitCall(server.apiUrl, server.repo, ws, plan.request, NO_TOKEN);
        return { result: queryResultOf(plan.reading, answer.result), output: plan.request.output.type, pieces: Number(explained.pieces) };
    }

    /** A query's one-shot call on a workspace, read as the builder reads it. */
    async function oneShot(ws: string, program: string, runner: RunnerValue): Promise<QueryResult> {
        const prepared = prepareQuery(program, ROOT, { runner });
        if ('result' in prepared) assert.fail(`${program} does not check`);
        return queryResultOf(prepared.prepared, await oneShotExecute(server.apiUrl, server.repo, ws, prepared.prepared.request, NO_TOKEN));
    }

    before(async () => {
        pieceBytes = process.env['E3_TEST_PIECE_BYTES'];
        process.env['E3_TEST_PIECE_BYTES'] = String(PIECE_TARGET);
        scratch = mkdtempSync(join(tmpdir(), 'e3-ui-query-plans-'));
        repo = join(scratch, 'repo');
        mkdirSync(repo);
        repoInit(repo);
        const zip = join(scratch, 'orders.zip');
        await e3.export(e3.package('orders', '1.0.0', e3.input('orders', OrdersType), e3.input('customers', CustomersType), e3.input('credit', CreditType)), zip);
        await packageImport(storage, repo, zip);
        server = await startRepoServer(repo);
    });

    after(async () => {
        await server?.stop();
        if (pieceBytes === undefined) delete process.env['E3_TEST_PIECE_BYTES'];
        else process.env['E3_TEST_PIECE_BYTES'] = pieceBytes;
        if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    });

    for (const { name, runner, file, required } of RUNNERS) {
        describe(`on ${name}`, { skip: file !== null || required ? false : `e3 finds no ${name}` }, () => {
            before(() => {
                if (file === null) assert.fail(`e3 finds no ${name}, which this package's node_modules/.bin holds: run the spec from the package`);
                assertThisTreesRunner(name, file, repo);
            });

            it('N3: each split call answers as the query\'s one-shot call does', async (t) => {
                t.diagnostic(`e3 runs ${file}`);
                const ws = await workspace(`same-${name}`, orders(0, ORDER_COUNT, 1));
                for (const [program, output] of SPLITS) {
                    const got = await split(ws, program, runner);
                    assert.equal(got.output, output, `${program} splits as a ${output}`);
                    assert.ok(got.pieces > 4, `${program}: the orders are many pieces, not ${got.pieces}`);
                    const one = await oneShot(ws, program, runner);
                    const want = decoded(one, `${program}'s one-shot call`);
                    const value = decoded(got.result, `${program}'s split call`);
                    assert.ok(isTypeEqual(value.type, want.type), `${program}: the split call answers at the one-shot call's type`);
                    assert.ok(close(want.type, value.value, want.value), `${program}: the split call's answer is the one-shot call's`);
                    // Each dataset it read, pinned at the hash the one-shot call read it at.
                    assert.deepEqual(pinned(got.result), pinned(one), `${program}: the split call read what the one-shot call read`);
                }
            });

            it('N3: a join of two dicts keyed alike, read only at the row\'s key, is cut at the same keys and answers as its one-shot call does (#942)', async () => {
                const ws = await workspace(`copartitioned-${name}`, orders(0, ORDER_COUNT, 5, COPARTITIONED_CUSTOMERS), COPARTITIONED_CUSTOMERS);
                await workspaceSetDataset(storage, repo, ws, CREDIT, credit(COPARTITIONED_CUSTOMERS), CreditType);
                const plan = await planOf(ws, CREDIT_BY_REGION, runner, ['customers', 'credit']);
                if (plan.kind !== 'split' || plan.explanation.path.kind !== 'split') assert.fail(`the join planned ${plan.kind}`);
                assert.deepEqual([plan.explanation.path.over, plan.explanation.path.copartitioned, plan.explanation.path.broadcast], ['customers', ['credit'], []]);
                assert.deepEqual(plan.request.args.map((a) => a.partition.type), ['some', 'some'], 'both partitioned: e3 cuts them at the same keys');
                const explained = await splitCallExplain(server.apiUrl, server.repo, ws, plan.request, NO_TOKEN);
                assert.ok(Number(explained.pieces) > 4, `the customers are many pieces, not ${explained.pieces}: the heavier weighs ${explained.bytes} bytes`);
                const answer = await splitCall(server.apiUrl, server.repo, ws, plan.request, NO_TOKEN);
                const got = queryResultOf(plan.reading, answer.result);
                const one = await oneShot(ws, CREDIT_BY_REGION, runner);
                const [value, want] = [decoded(got, 'the join\'s split call'), decoded(one, 'the join\'s one-shot call')];
                assert.ok(isTypeEqual(value.type, want.type) && close(want.type, value.value, want.value), 'the split call\'s answer is the one-shot call\'s');
                assert.deepEqual(pinned(got), pinned(one), 'the split call read what the one-shot call read');
            });

            it('N3: a join both of whose sides weigh more than one piece is re-keyed — the second call over the first\'s output by its hash — and answers as its one-shot call does (#942)', async () => {
                const ws = await workspace(`rekeyed-${name}`, orders(0, ORDER_COUNT, 6, REKEY_CUSTOMERS), REKEY_CUSTOMERS);
                for (const program of REKEYED) {
                    const plan = await planOf(ws, program, runner, ['orders', 'customers']);
                    if (plan.kind !== 'rekey') assert.fail(`${program} planned ${plan.kind}, not a re-keyed join`);
                    // The re-key call's answer is asked to be one byte at most: its output is read by its hash.
                    const first = await splitCall(server.apiUrl, server.repo, ws, plan.first, NO_TOKEN);
                    assert.equal(first.result.outcome.type, 'too_large', `${program}: the re-key call's answer is its output's hash`);
                    if (first.output === null) assert.fail(`${program}: the re-key call gave no output`);
                    const join = plan.join(first.output);
                    const explained = await splitCallExplain(server.apiUrl, server.repo, ws, join, NO_TOKEN);
                    assert.ok(Number(explained.pieces) > 4, `${program}: the join is many pieces, not ${explained.pieces}: the heavier weighs ${explained.bytes} bytes`);
                    const joined = await splitCall(server.apiUrl, server.repo, ws, join, NO_TOKEN);
                    const got = queryResultOf(plan.reading, plan.answer(first.result, joined.result));
                    const one = await oneShot(ws, program, runner);
                    const [value, want] = [decoded(got, `${program}'s re-keyed join`), decoded(one, `${program}'s one-shot call`)];
                    assert.ok(isTypeEqual(value.type, want.type), `${program}: the re-keyed join answers at the one-shot call's type`);
                    assert.ok(close(want.type, value.value, want.value), `${program}: the re-keyed join's answer is the one-shot call's`);
                    assert.deepEqual(pinned(got), pinned(one), `${program}: the re-keyed join read what the one-shot call read`);
                }
            });

            it('N3: every unit names its runner\'s peak, and with E3_UI_PERF=1 none passes the runner\'s baseline and the RunSorter\'s cap, and twice the input raises none beyond a margin', async (t) => {
                const peaks: number[][] = [];
                const cut: number[] = [];
                for (const [size, seed] of [[ORDER_COUNT, 2], [2 * ORDER_COUNT, 3]] as const) {
                    const ws = await workspace(`peaks-${size}-${name}`, orders(0, size, seed));
                    const before = await unitsOf(storage, repo);
                    const { result, pieces } = await split(ws, REVENUE_BY_REGION, runner);
                    decoded(result, `revenue by region over ${size} orders`);
                    const ran = ranBetween(before, await unitsOf(storage, repo));
                    assert.ok(ran.length >= pieces, `every piece ran: ${ran.length} units for ${pieces} pieces`);
                    assert.deepEqual(ran.filter((peak) => peak === null), [], 'every unit names its runner\'s peak');
                    peaks.push(ran as number[]);
                    cut.push(pieces);
                }
                const [small, large] = peaks as [number[], number[]];
                assert.ok(cut[1]! > cut[0]!, `twice the orders is more pieces: ${cut[0]} then ${cut[1]}`);
                const baseline = Math.min(...small);
                const bound = baseline + RUN_MAX_BYTES + 32 * MiB;
                const [smallMax, largeMax] = [Math.max(...small), Math.max(...large)];
                t.diagnostic(`unit peaks: ${Math.round(smallMax / MiB)} MiB at most over ${cut[0]} pieces, ${Math.round(largeMax / MiB)} MiB over ${cut[1]} (baseline ${Math.round(baseline / MiB)} MiB, bound ${Math.round(bound / MiB)} MiB)`);
                // The budgets are the machine's: held only where asked (E3_UI_PERF=1, #1262).
                if (!perf) return;
                for (const peak of [...small, ...large]) {
                    assert.ok(peak <= bound, `a unit peaked at ${Math.round(peak / MiB)} MiB, over ${Math.round(bound / MiB)} MiB (baseline ${Math.round(baseline / MiB)} MiB)`);
                }
                assert.ok(largeMax <= smallMax * 1.25 + 16 * MiB,
                    `twice the orders raised the highest unit peak from ${Math.round(smallMax / MiB)} MiB to ${Math.round(largeMax / MiB)} MiB`);
            });

            it('N4: a relaunch is served from the cache; after an append only the pieces around it run', async () => {
                const rows = orders(0, ORDER_COUNT, 4);
                const ws = await workspace(`append-${name}`, rows);
                // An array's units are its pieces alone: its parts are concatenated, with no merge.
                const program = '.orders | map(select(.total > 49.5)) | map(.id)';
                const before = await unitsOf(storage, repo);
                const first = await split(ws, program, runner);
                const cold = ranBetween(before, await unitsOf(storage, repo)).length;
                assert.equal(cold, first.pieces, `every piece ran once: ${cold} units for ${first.pieces} pieces`);

                const served = await unitsOf(storage, repo);
                const again = await split(ws, program, runner);
                assert.equal(ranBetween(served, await unitsOf(storage, repo)).length, 0, 'no unit ran: the call was served from the cache');
                const [was, is] = [decoded(first.result, 'the first run'), decoded(again.result, 'the relaunch')];
                assert.ok(close(was.type, is.value, was.value), 'and answered as it did');

                await workspaceSetDataset(storage, repo, ws, ORDERS, [...rows, ...orders(ORDER_COUNT, 40, 4)], OrdersType);
                const grown = await unitsOf(storage, repo);
                const appended = await split(ws, program, runner);
                const ran = ranBetween(grown, await unitsOf(storage, repo)).length;
                assert.ok(ran >= 1 && ran <= 3, `only the pieces around the append ran: ${ran} of ${appended.pieces}`);
                const want = decoded(await oneShot(ws, program, runner), 'the one-shot call after the append');
                assert.ok(close(want.type, decoded(appended.result, 'the split call after the append').value, want.value), 'the answer is the one-shot call\'s over the new rows');
            });
        });
    }
});
