/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's plans at scale (#941, #1093) — an opt-in benchmark, run
 * by hand with `E3_QUERY_SCALE=1`; `make test` and CI skip it. The README's
 * "Query plans at scale" says how to run it.
 *
 * For each size it runs:
 *
 * - **The data.** The shared fixture's types (`libs/east/test/query.fixture.ts`):
 *   `orders`, an `Array<Order>`, and 100,000 `customers`, generated from fixed
 *   seeds — the same orders at every size, the larger ones going on — and
 *   written as beast2 through the canonical element writer, in the data
 *   directory, kept for the next run.
 * - **The oracle.** Each query's answer, computed from the generator in the
 *   same pass as East values — independent of e3, east-c and the translator — a
 *   sum adding the totals in input order, as one unit does.
 * - **The repository.** Both files taken into a workspace (`datasetAdoptFile`),
 *   kept for the next run too.
 * - **The calls.** Each benchmark query planned as the builder plans it
 *   (`planQuery`), as a split call on east-c — whichever `east-c` is first on
 *   PATH — and run in this process through e3-core (`splitCallPrepare`,
 *   `splitCallRun`, `splitCallResult`) with a server's ceilings raised, so a
 *   large size is neither timed out nor too large to answer. Every run is cold:
 *   every execution is forgotten before it, as gc forgets them.
 *
 * It holds every answer to the oracle — East equality, a Float within 1e-9 of
 * it relatively, since the pieces add in another grouping — and, over two
 * sizes or more, each query's highest piece peak at the largest to a margin
 * over the smallest's: memory flat whatever the size. It times nothing against
 * a budget. It reports, per query, the call's time, the time e3 took to plan
 * the pieces and to run its units, the pieces' work per order per core, the
 * CPU this process and its runners used per order — which what else the
 * machine runs moves least — each piece's peak and the load the run started
 * under, as a markdown table on its output and appended to `report.md` beside
 * the data (`report.jsonl` holds the rows).
 *
 * With `E3_QUERY_SCALE_ONE_SHOT=1` each query also runs as the one-shot call
 * the builder would make of it, under the one-shot deadline (120 s unless
 * `E3_QUERY_SCALE_ONE_SHOT_MS` says otherwise): its time, its outcome — at
 * scale it may run out of time or memory — and east-c's peak.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import {
    ArrayType, Beast2ElementWriter, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, VariantType,
    compareFor, decodeBeast2, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, isVariant, lessFor, none, some, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from '@elaraai/east';
import type { RunnerValue, TreePath } from '@elaraai/e3-types';
import {
    LocalStorage, LocalTaskRunner, datasetAdoptFile, executionGet, executionList, executionListIds, executionReadLog, oneShotExecute, packageImport,
    pruneHistory, repoInit, resolveBudget, splitCallPrepare, splitCallResult, splitCallRun, workspaceCreate, workspaceDeploy,
} from '@elaraai/e3-core';
import { draftPlan, planQuery, prepareQuery, queryResultOf, queryRoot, type QueryResult } from '@elaraai/e3-ui-components/query';

const enabled = process.env['E3_QUERY_SCALE'] === '1';

// ─── The settings ────────────────────────────────────────────────────────────

/** The sizes by name, in orders: about 36 B an order once stored. */
const SIZES: Readonly<Record<string, number>> = { '100m': 2_900_000, '1g': 29_000_000, '4g': 116_000_000, '16g': 463_000_000 };

/** A size to run: its name, and its orders. */
interface Size {
    readonly label: string;
    readonly orders: number;
}

/**
 * The sizes `E3_QUERY_SCALE_SIZES` names — `100m`, `1g`, `4g`, `16g`, or a
 * number of orders — comma-separated; `100m` when it names none.
 */
function sizesOf(text: string | undefined): Size[] {
    return (text ?? '100m').split(',').map((name) => name.trim()).filter((name) => name !== '').map((name) => {
        const known = SIZES[name];
        if (known !== undefined) return { label: name, orders: known };
        if (/^[1-9]\d*$/.test(name)) return { label: name, orders: Number(name) };
        throw new RangeError(`E3_QUERY_SCALE_SIZES: ${name} is not ${Object.keys(SIZES).join(', ')} or a number of orders`);
    });
}

/** The directory the data, the repositories and the report are kept in. */
const DIR = process.env['E3_QUERY_SCALE_DIR'] ?? join(tmpdir(), 'e3-query-scale');

/** The cold runs of each query, each of every execution forgotten first. */
const RUNS = Number(process.env['E3_QUERY_SCALE_RUNS'] ?? '1');

/** Whether each query also runs as the builder's one-shot call. */
const ONE_SHOT = process.env['E3_QUERY_SCALE_ONE_SHOT'] === '1';

/** The one-shot call's deadline, in milliseconds: a server's sync deadline. */
const ONE_SHOT_MS = Number(process.env['E3_QUERY_SCALE_ONE_SHOT_MS'] ?? '120000');

const MiB = 2 ** 20;
const WS = 'ws';

/** What a call may answer with and run for, raised past a server's 1 MiB and ten minutes. */
const CEILINGS = { timeoutMs: 6 * 3_600_000, maxResultBytes: 4 * 1024 * MiB, maxLogBytes: 256 * 1024 };

/** east-c given no platform package, each collection read lazily: the builder's runner. */
const EAST_C: RunnerValue = variant('east_c', { platforms: [], decode: variant('lazy', null) });

// ─── The data: the shared fixture's types ────────────────────────────────────

const LineType = StructType({ price: FloatType, qty: IntegerType, sku: StringType });
const StatusType = VariantType({
    cancelled: StructType({ reason: StringType }),
    pending: NullType,
    shipped: StructType({ date: DateTimeType }),
});
const OrderType = StructType({
    customer_id: StringType,
    discount: OptionType(FloatType),
    id: IntegerType,
    lines: ArrayType(LineType),
    status: StatusType,
    total: FloatType,
});
const OrdersType = ArrayType(OrderType);
const CustomerType = StructType({ name: StringType, region: StringType, tier: VariantType({ gold: NullType, standard: NullType }) });
const CustomersType = DictType(StringType, CustomerType);
type Order = ValueTypeOf<typeof OrderType>;
type Customer = ValueTypeOf<typeof CustomerType>;

const ORDERS: TreePath = [variant('field', 'inputs'), variant('field', 'orders')];
const CUSTOMERS: TreePath = [variant('field', 'inputs'), variant('field', 'customers')];
const ROOT = queryRoot([
    { name: 'orders', path: ORDERS, type: toEastTypeValue(OrdersType) },
    { name: 'customers', path: CUSTOMERS, type: toEastTypeValue(CustomersType) },
]);

/** The customers, and the share of them in each region. */
const CUSTOMER_COUNT = 100_000;
const REGIONS: readonly (readonly [region: string, share: number])[] = [
    ['NSW', 0.32], ['VIC', 0.26], ['QLD', 0.20], ['WA', 0.10], ['SA', 0.07], ['TAS', 0.02], ['ACT', 0.02], ['NT', 0.01],
];
const FIRST = ['Harbour', 'Coastline', 'Ridge', 'Southbank', 'Sunfield', 'Northgate', 'Westend', 'Ironbark', 'Riverbend', 'Granite', 'Bluegum', 'Saltbush'];
const SECOND = ['Foods', 'Retail', 'Grocers', 'Market', 'Traders', 'Supply', 'Provisions', 'Stores', 'Wholesale', 'Pantry'];
const REASONS = ['Customer request', 'Out of stock', 'Payment failed'];
const DISCOUNTS = [0.05, 0.1, 0.15];
const FIRST_SHIP_DAY_MS = Date.UTC(2025, 9, 1);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The total the selective queries keep above: about the 99.9th percentile, so about 0.1% of orders pass. */
const THRESHOLD = 7850;

/** mulberry32: a 32-bit seeded generator, each draw in [0, 1). */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The catalog: 200 SKUs, cheap fasteners to dear assemblies. */
function catalog(): (readonly [sku: string, price: number])[] {
    const draw = mulberry32(941);
    return Array.from({ length: 200 }, (_, i) => {
        const cheap = draw() < 0.45;
        const price = cheap ? Math.round((0.1 + draw() * 4.8) * 100) / 100 : Math.round((5 + draw() * 120) * 100) / 100;
        return [`SKU-${String(i).padStart(4, '0')}`, price] as const;
    });
}

/** A customer's id: its index, zero-padded, so ids sort as their indexes do. */
const customerId = (i: number): string => `C${String(i).padStart(6, '0')}`;

/**
 * The orders, ids from 1001, each with the index of its customer: a customer
 * drawn skewed (a few buy often), one to five lines, a status and a discount.
 * The first `n` of any count are the same orders.
 */
function* orders(count: number): Generator<{ order: Order; customer: number }> {
    const draw = mulberry32(875941);
    const skus = catalog();
    for (let i = 0; i < count; i++) {
        const customer = Math.floor(CUSTOMER_COUNT * draw() ** 1.8);
        const roll = draw();
        const lineCount = roll < 0.35 ? 1 : roll < 0.65 ? 2 : roll < 0.85 ? 3 : roll < 0.95 ? 4 : 5;
        const lines: ValueTypeOf<typeof LineType>[] = [];
        let gross = 0;
        for (let j = 0; j < lineCount; j++) {
            const [sku, price] = skus[Math.floor(draw() * skus.length)]!;
            const qty = 1 + Math.floor(draw() * (price < 5 ? 400 : 30));
            gross += qty * price;
            lines.push({ price, qty: BigInt(qty), sku });
        }
        const s = draw();
        let status: ValueTypeOf<typeof StatusType>;
        if (s < 0.62) {
            const days = Math.floor(draw() * 354);
            const hours = 8 + Math.floor(draw() * 9);
            status = variant('shipped', { date: new Date(FIRST_SHIP_DAY_MS + days * DAY_MS + hours * HOUR_MS) });
        } else if (s < 0.86) {
            status = variant('pending', null);
        } else {
            status = variant('cancelled', { reason: REASONS[Math.floor(draw() * REASONS.length)]! });
        }
        const discount = draw() < 0.35 ? DISCOUNTS[Math.floor(draw() * DISCOUNTS.length)]! : undefined;
        yield {
            order: {
                customer_id: customerId(customer),
                discount: discount === undefined ? none : some(discount),
                id: BigInt(1001 + i),
                lines,
                status,
                total: Math.round(gross * (1 - (discount ?? 0)) * 100) / 100,
            },
            customer,
        };
    }
}

/** The customers, in id order, each with the index of its region. */
function* customers(): Generator<{ id: string; customer: Customer; region: number }> {
    const draw = mulberry32(100);
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
        let r = draw();
        let region = REGIONS.length - 1;
        for (let k = 0; k < REGIONS.length; k++) {
            if (r < REGIONS[k]![1]) {
                region = k;
                break;
            }
            r -= REGIONS[k]![1];
        }
        const name = `${FIRST[Math.floor(draw() * FIRST.length)]} ${SECOND[Math.floor(draw() * SECOND.length)]} ${i}`;
        yield { id: customerId(i), customer: { name, region: REGIONS[region]![0], tier: variant(draw() < 0.15 ? 'gold' : 'standard', null) }, region };
    }
}

// ─── The queries ─────────────────────────────────────────────────────────────

/** The benchmark's queries, each of which splits, and what it splits as. */
const QUERIES: readonly { readonly id: string; readonly label: string; readonly program: string }[] = [
    { id: 'q1', label: 'the sum', program: '.orders | map(.total) | add' },
    { id: 'q2', label: 'four totals', program: '.orders | {n: length, total: (map(.total) | add), any_big: any(.total > 2000), all_lines: all(.lines | length > 0)}' },
    {
        id: 'q3', label: 'revenue by region',
        program: '.customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})',
    },
    { id: 'q4', label: 'the distinct ids', program: '.orders | map(.customer_id) | unique' },
    { id: 'q5', label: 'the reduce', program: 'reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)' },
    { id: 'q6', label: 'the ids of the largest 0.1%', program: `.orders | map(select(.total > ${THRESHOLD})) | map(.id)` },
    { id: 'q6t', label: 'the same, sorted, top 100', program: `.orders | map(select(.total > ${THRESHOLD})) | sort_by(-.total) | .[:100] | map(.id)` },
];

/** The queries `E3_QUERY_SCALE_QUERIES` names, comma-separated; all when it names none. */
function queriesOf(text: string | undefined): typeof QUERIES {
    if (text === undefined || text.trim() === '') return QUERIES;
    const ids = text.split(',').map((id) => id.trim());
    for (const id of ids) {
        if (!QUERIES.some((q) => q.id === id)) throw new RangeError(`E3_QUERY_SCALE_QUERIES: ${id} is not one of ${QUERIES.map((q) => q.id).join(', ')}`);
    }
    return QUERIES.filter((q) => ids.includes(q.id));
}

/** A query's result type, as its split gives it. */
function resultTypeOf(program: string): EastType {
    const drafted = draftPlan(program, ROOT);
    if ('result' in drafted) throw new Error(`${program} does not check`);
    const split = drafted.draft.split;
    if (split.kind !== 'split') throw new Error(`${program} does not split: ${split.kind === 'whole' ? split.reason.code : split.message}`);
    return split.resultType;
}

// ─── Writing the data, and the oracle ────────────────────────────────────────

/** A file written by way of `<path>.partial`, renamed once it is whole, so a run stopped halfway leaves nothing that reads as done. */
function writeWhole(path: string, write: (sink: (bytes: Uint8Array) => void) => void): void {
    const partial = `${path}.partial`;
    const fd = openSync(partial, 'w');
    try {
        write((bytes) => {
            for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at);
        });
    } finally {
        closeSync(fd);
    }
    renameSync(partial, path);
}

/** The files of a size: its orders, the customers every size shares, and each query's answer. */
function filesOf(size: Size) {
    return {
        orders: join(DIR, `orders-${size.label}.beast2`),
        customers: join(DIR, 'customers.beast2'),
        oracle: (id: string) => join(DIR, `oracle-${size.label}-${id}.beast2`),
    };
}

/**
 * Writes a size's orders and the customers, unless they are there, and each
 * query's answer from the same pass over the generator.
 */
function ensureData(size: Size): void {
    mkdirSync(DIR, { recursive: true });
    const files = filesOf(size);
    const regionOf = new Uint8Array(CUSTOMER_COUNT);
    let i = 0;
    for (const { region } of customers()) regionOf[i++] = region;
    if (!existsSync(files.customers)) {
        writeWhole(files.customers, (sink) => {
            const writer = new Beast2ElementWriter(CustomersType, sink, { parallel: true });
            for (const { id, customer } of customers()) writer.add([id, customer]);
            writer.finish();
        });
    }
    if (existsSync(files.orders) && QUERIES.every((q) => existsSync(files.oracle(q.id)))) return;

    const started = Date.now();
    let n = 0;
    let total = 0;
    let anyBig = false;
    let allLines = true;
    const revenue = new Float64Array(REGIONS.length);
    const inRegion = new Float64Array(REGIONS.length);
    const byCustomer = new Float64Array(CUSTOMER_COUNT);
    const bought = new Uint8Array(CUSTOMER_COUNT);
    const selected: bigint[] = [];
    const top: { total: number; id: bigint; seq: number }[] = [];
    // The queries' comparisons, as East makes them.
    const less = lessFor(FloatType);
    writeWhole(files.orders, (sink) => {
        const writer = new Beast2ElementWriter(OrdersType, sink, { parallel: true });
        for (const { order, customer } of orders(size.orders)) {
            writer.add(order);
            total += order.total;
            if (less(2000, order.total)) anyBig = true;
            if (order.lines.length === 0) allLines = false;
            revenue[regionOf[customer]!]! += order.total;
            inRegion[regionOf[customer]!]! += 1;
            byCustomer[customer]! += order.total;
            bought[customer] = 1;
            if (less(THRESHOLD, order.total)) {
                selected.push(order.id);
                top.push({ total: order.total, id: order.id, seq: n });
            }
            n++;
            if (n % 10_000_000 === 0) console.log(`# ${size.label}: ${n} orders written, ${Math.round((Date.now() - started) / 1000)} s`);
        }
        writer.finish();
    });

    // Each answer as an East value, written at the query's result type.
    const ids: string[] = [];
    const sums: [string, number][] = [];
    for (let c = 0; c < CUSTOMER_COUNT; c++) {
        if (bought[c] === 0) continue;
        ids.push(customerId(c));
        sums.push([customerId(c), byCustomer[c]!]);
    }
    const regionKey = compareFor(OptionType(StringType));
    // sort_by(-.total): ascending by the negated total in East's order, and stable, so ties keep input order.
    const byKey = compareFor(FloatType);
    top.sort((a, b) => byKey(-a.total, -b.total) || (a.seq - b.seq));
    const answers: Record<string, unknown> = {
        q1: total,
        q2: { n: BigInt(n), total, any_big: anyBig, all_lines: allLines },
        q3: REGIONS.flatMap(([region], k) => inRegion[k]! > 0 ? [{ region: some(region), revenue: revenue[k]!, n: BigInt(inRegion[k]!) }] : [])
            .sort((a, b) => regionKey(a.region, b.region)),
        q4: ids,
        q5: new SortedMap(sums, compareFor(StringType)),
        q6: selected,
        q6t: top.slice(0, 100).map((row) => row.id),
    };
    for (const q of QUERIES) writeFileSync(files.oracle(q.id), encodeBeast2For(resultTypeOf(q.program))(answers[q.id] as never));
    console.log(`# ${size.label}: ${n} orders and the oracle written in ${Math.round((Date.now() - started) / 1000)} s`);
}

// ─── The repository ──────────────────────────────────────────────────────────

/** What a size's repository holds, kept beside it once it is whole. */
interface RepoMark {
    readonly orders: number;
    /** The orders' file, in bytes: what the planner weighs. */
    readonly bytes: number;
}

/**
 * A size's repository, its workspace deployed and both files taken in, unless
 * a run made it before: it is whole once its mark is written.
 */
async function ensureRepo(size: Size, storage: LocalStorage, runner: LocalTaskRunner): Promise<{ repo: string; mark: RepoMark }> {
    const repo = join(DIR, `repo-${size.label}`);
    const markFile = `${repo}.json`;
    if (existsSync(markFile)) return { repo, mark: JSON.parse(readFileSync(markFile, 'utf8')) as RepoMark };
    const files = filesOf(size);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const made = repoInit(repo);
    if (!made.success) throw made.error ?? new Error(`could not make the repository ${repo}`);
    const zip = join(DIR, `package-${size.label}.zip`);
    await e3.export(e3.package('scale', '1.0.0', e3.input('orders', OrdersType), e3.input('customers', CustomersType)), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'scale', '1.0.0');
    const started = Date.now();
    await datasetAdoptFile(storage, repo, WS, CUSTOMERS, files.customers, { runner });
    await datasetAdoptFile(storage, repo, WS, ORDERS, files.orders, { runner });
    console.log(`# ${size.label}: the orders taken in in ${Math.round((Date.now() - started) / 1000)} s`);
    const mark: RepoMark = { orders: size.orders, bytes: statSync(files.orders).size };
    writeFileSync(markFile, JSON.stringify(mark));
    return { repo, mark };
}

// ─── Reading what came back ──────────────────────────────────────────────────

/** Whether two East values of a type are equal, Floats to within 1e-9 relatively: a sum's grouping changes its last bits. */
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

/** The clock ticks a second that `/proc` counts CPU time in. */
const CLOCK_TICKS = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim()) || 100;

/**
 * The CPU seconds this process has used, and the runners it spawned and waited
 * for: what the calls cost whatever else the machine runs, since a runner
 * waiting for a core uses none. `null` off Linux, where `/proc` does not say.
 */
function cpuSeconds(): number | null {
    if (process.platform !== 'linux') return null;
    // The fields after the command's name: utime, stime, cutime and cstime are the 14th to 17th.
    const stat = readFileSync('/proc/self/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = [11, 12, 13, 14].reduce((sum, at) => sum + Number(fields[at]), 0);
    return ticks / CLOCK_TICKS;
}

/** The median of some numbers. */
function median(xs: readonly number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? NaN : s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** A unit of a split call, as its task's log says it: a piece, or a merge or fold of what the pieces wrote. */
interface UnitLine {
    readonly kind: 'piece' | 'merge' | 'combine';
    readonly state: string;
    readonly ms: number;
    readonly peakMiB: number | null;
}

/** One cold run of a split call: what the report says of it. */
interface SplitRow {
    readonly size: string;
    readonly orders: number;
    readonly query: string;
    readonly output: string;
    readonly run: number;
    readonly seconds: number;
    readonly planSeconds: number;
    readonly unitSeconds: number;
    readonly pieces: number;
    readonly merges: number;
    readonly perOrderUs: number;
    readonly perOrderAllUs: number;
    /** The CPU this process and its runners used, per order: robust to what else the machine runs. */
    readonly cpuPerOrderUs: number;
    readonly busyCores: number;
    readonly pieceMaxPeakMiB: number;
    readonly pieceMedianPeakMiB: number;
    readonly mergeMaxPeakMiB: number;
    readonly loadAtStart: number;
    readonly answer: string;
}

/** One one-shot call: what the report says of it. */
interface OneShotRow {
    readonly size: string;
    readonly query: string;
    readonly seconds: number;
    readonly outcome: string;
    readonly peakMiB: number | null;
    readonly loadAtStart: number;
}

/** Every execution the repository records, with its record. */
async function records(storage: LocalStorage, repo: string) {
    const out = [];
    for (const { taskHash, inputsHash } of await executionList(storage, repo)) {
        for (const id of await executionListIds(storage, repo, taskHash, inputsHash)) {
            const status = await executionGet(storage, repo, taskHash, inputsHash, id);
            if (status !== null) out.push({ taskHash, inputsHash, id, status });
        }
    }
    return out;
}

/** The units a split task's log names, each with its kind, how it ended, its duration and its peak. */
async function unitLines(storage: LocalStorage, repo: string, task: { taskHash: string; inputsHash: string; id: string }): Promise<{ pieces: number; units: UnitLine[] }> {
    const log = await executionReadLog(storage, repo, task.taskHash, task.inputsHash, task.id, 'stdout', { limit: 64 * MiB });
    const plan = /^plan pieces=(\d+)/m.exec(log.data);
    const units = log.data.split('\n').flatMap((line): UnitLine[] => {
        const m = /^(piece|merge|combine) .*? (completed|cached|failed|cancelled) .*?duration=(\d+)(?: peak=(\d+))?/.exec(line);
        return m === null ? [] : [{ kind: m[1] as UnitLine['kind'], state: m[2]!, ms: Number(m[3]), peakMiB: m[4] === undefined ? null : Number(m[4]) / MiB }];
    });
    return { pieces: plan === null ? -1 : Number(plan[1]), units };
}

// ─── The report ──────────────────────────────────────────────────────────────

const f = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : '-');

/** A size's rows as a markdown table. */
function table(size: Size, rows: readonly SplitRow[], oneShots: readonly OneShotRow[]): string {
    const lines = [
        `#### ${size.label}: ${size.orders.toLocaleString('en-US')} orders`,
        '',
        '| query | splits as | wall s | plan s | units s | pieces + merges | per order per core, pieces / all units µs | CPU per order µs | cores busy | piece peak max / median MiB | merge peak MiB | load at start | answer |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.query} | ${r.output} | ${f(r.seconds, 2)} | ${f(r.planSeconds, 2)} | ${f(r.unitSeconds, 2)} | ${r.pieces} + ${r.merges} | ${f(r.perOrderUs, 3)} / ${f(r.perOrderAllUs, 3)} | ${f(r.cpuPerOrderUs, 3)} | ${f(r.busyCores)} | ${f(r.pieceMaxPeakMiB)} / ${f(r.pieceMedianPeakMiB)} | ${f(r.mergeMaxPeakMiB)} | ${f(r.loadAtStart, 2)} | ${r.answer} |`),
    ];
    if (oneShots.length > 0) {
        lines.push('', '| query | one-shot s | outcome | east-c peak MiB | load at start |', '|---|---|---|---|---|');
        lines.push(...oneShots.map((r) => `| ${r.query} | ${f(r.seconds, 2)} | ${r.outcome} | ${r.peakMiB === null ? '-' : f(r.peakMiB)} | ${f(r.loadAtStart, 2)} |`));
    }
    return lines.join('\n');
}

/** The environment a report was measured in: the runner, the budget, the machine. */
function environment(budget: { cores: number; memory: number }): string {
    const which = spawnSync('which', ['east-c'], { encoding: 'utf8' }).stdout.trim();
    const version = spawnSync('east-c', ['version'], { encoding: 'utf8' }).stdout.trim().split('\n').join(', ');
    return `east-c ${which} (${version}); budget ${budget.cores} cores, ${f(budget.memory / 1024 ** 3, 2)} GiB; ${process.env['E3_QUERY_SCALE_NOTE'] ?? ''}`.trim();
}

// ─── The spec ────────────────────────────────────────────────────────────────

describe('query plans at scale (E3_QUERY_SCALE=1)', { skip: !enabled }, () => {
    const sizes = enabled ? sizesOf(process.env['E3_QUERY_SCALE_SIZES']) : [];
    const queries = enabled ? queriesOf(process.env['E3_QUERY_SCALE_QUERIES']) : [];
    const storage = new LocalStorage();
    /** Each query's highest piece peak, by size. */
    const peaks = new Map<string, Map<string, number>>();
    const budget = resolveBudget();

    before(() => {
        assert.ok(spawnSync('east-c', ['version'], { stdio: 'ignore' }).status === 0,
            'east-c is not on PATH: build it Release (cmake -DCMAKE_BUILD_TYPE=Release) and put it first');
        mkdirSync(DIR, { recursive: true });
        appendFileSync(join(DIR, 'report.md'), `\n### ${new Date().toISOString()}\n\n${environment(budget)}\n`);
    });

    for (const size of sizes) {
        describe(`${size.label}: ${size.orders} orders`, () => {
            let repo: string;
            let mark: RepoMark;
            const runner = new LocalTaskRunner(join(DIR, `repo-${size.label}`), budget);
            const rows: SplitRow[] = [];
            const oneShots: OneShotRow[] = [];

            before(async () => {
                ensureData(size);
                ({ repo, mark } = await ensureRepo(size, storage, runner));
            });

            for (const q of queries) {
                it(`${q.id}, ${q.label}: each cold split call answers as the oracle does`, async () => {
                    const type = resultTypeOf(q.program);
                    const oracle = decodeBeast2For(type)(readFileSync(filesOf(size).oracle(q.id)));
                    const planned = planQuery(q.program, ROOT, new Map([['orders', { bytes: mark.bytes, rows: mark.orders }]]), {
                        runner: EAST_C, maxBytes: CEILINGS.maxResultBytes,
                    });
                    if ('result' in planned) assert.fail(`${q.program} does not check`);
                    const plan = planned.plan;
                    if (plan.kind !== 'split') assert.fail(`${q.program} planned one call`);
                    for (let run = 1; run <= RUNS; run++) {
                        // Every execution forgotten, as gc forgets them, so the call runs every unit.
                        await pruneHistory(storage, repo, { keepRuns: 0, keepDays: 0, dryRun: false }, Date.now() + 60_000);
                        const loadAtStart = loadavg()[0]!;
                        const cpuAtStart = cpuSeconds();
                        const started = performance.now();
                        const launched = await splitCallPrepare(storage, repo, WS, plan.request, { grant: 'any', ceilings: CEILINGS });
                        if ('outcome' in launched) {
                            const why = launched.outcome.type === 'invalid' ? launched.outcome.value.diagnostics.map((d) => d.message).join('; ') : launched.outcome.type;
                            assert.fail(`${q.id}'s split call was refused: ${why}`);
                        }
                        const outcome = await splitCallRun(storage, runner, repo, launched);
                        const result = await splitCallResult(storage, repo, outcome, launched.read, CEILINGS.maxResultBytes);
                        const seconds = (performance.now() - started) / 1000;
                        const cpuAtEnd = cpuSeconds();
                        const answer = decoded(queryResultOf(plan.reading, result), `${q.id}'s split call`);
                        assert.ok(isTypeEqual(answer.type, type), `${q.id}: the split call answers at the query's result type`);
                        const exact = equalFor(type)(answer.value as never, oracle as never);
                        assert.ok(exact || close(type, answer.value, oracle), `${q.id}: the split call's answer is the oracle's`);

                        // What ran: the task's own execution, and its units.
                        const made = await records(storage, repo);
                        const own = made.filter((r) => !r.status.value.unit);
                        const units = made.filter((r) => r.status.value.unit);
                        assert.equal(own.length, 1, `${q.id}: one execution of the split task`);
                        const { pieces: cut, units: lines } = await unitLines(storage, repo, own[0]!);
                        const pieces = lines.filter((u) => u.kind === 'piece');
                        const merges = lines.filter((u) => u.kind !== 'piece');
                        assert.equal(pieces.length, cut, `${q.id}: the log names every piece the plan cut`);
                        assert.deepEqual(lines.filter((u) => u.state !== 'completed').map((u) => `${u.kind} ${u.state}`), [], `${q.id}: every unit ran`);
                        const sum = (xs: readonly UnitLine[]): number => xs.reduce((s, u) => s + u.ms, 0) / 1000;
                        const startOf = (r: (typeof made)[number]): number => r.status.value.startedAt.getTime();
                        const endOf = (r: (typeof made)[number]): number => (r.status.type === 'running' ? NaN : r.status.value.completedAt.getTime());
                        const firstUnit = Math.min(...units.map(startOf));
                        const unitSeconds = (Math.max(...units.map(endOf)) - firstUnit) / 1000;
                        const piecePeaks = pieces.map((u) => u.peakMiB).filter((p): p is number => p !== null);
                        const row: SplitRow = {
                            size: size.label, orders: size.orders, query: q.id, output: plan.request.output.type, run, seconds,
                            planSeconds: (firstUnit - startOf(own[0]!)) / 1000,
                            unitSeconds,
                            pieces: pieces.length,
                            merges: merges.length,
                            perOrderUs: (sum(pieces) * 1e6) / size.orders,
                            perOrderAllUs: (sum(lines) * 1e6) / size.orders,
                            cpuPerOrderUs: cpuAtStart === null || cpuAtEnd === null ? NaN : ((cpuAtEnd - cpuAtStart) * 1e6) / size.orders,
                            busyCores: sum(lines) / unitSeconds,
                            pieceMaxPeakMiB: Math.max(...piecePeaks),
                            pieceMedianPeakMiB: median(piecePeaks),
                            mergeMaxPeakMiB: Math.max(0, ...merges.map((u) => u.peakMiB ?? 0)),
                            loadAtStart,
                            answer: exact ? 'exact' : 'within 1e-9',
                        };
                        rows.push(row);
                        appendFileSync(join(DIR, 'report.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
                        const highest = peaks.get(q.id) ?? new Map<string, number>();
                        highest.set(size.label, Math.max(highest.get(size.label) ?? 0, row.pieceMaxPeakMiB));
                        peaks.set(q.id, highest);
                    }

                    if (!ONE_SHOT) return;
                    const prepared = prepareQuery(q.program, ROOT, { runner: EAST_C, maxBytes: CEILINGS.maxResultBytes, timeoutMs: ONE_SHOT_MS });
                    if ('result' in prepared) assert.fail(`${q.program} does not check`);
                    const loadAtStart = loadavg()[0]!;
                    const started = performance.now();
                    const one = await oneShotExecute(storage, runner, repo, WS, prepared.prepared.request, {
                        grant: 'any', syncDeadlineMs: ONE_SHOT_MS, ceilings: CEILINGS, verbose: true,
                    });
                    const seconds = (performance.now() - started) / 1000;
                    const peak = /Peak RSS:\s+([\d.]+) MB/.exec(one.stderr);
                    let outcome: string = one.outcome.type;
                    if (one.outcome.type === 'success') {
                        const answer = decoded(queryResultOf(prepared.prepared, one), `${q.id}'s one-shot call`);
                        const exact = equalFor(type)(answer.value as never, oracle as never);
                        assert.ok(exact || close(type, answer.value, oracle), `${q.id}: the one-shot call's answer is the oracle's`);
                        outcome = exact ? 'exact' : 'within 1e-9';
                    }
                    const row: OneShotRow = { size: size.label, query: q.id, seconds, outcome, peakMiB: peak === null ? null : Number(peak[1]), loadAtStart };
                    oneShots.push(row);
                    appendFileSync(join(DIR, 'report.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), oneShot: true, ...row })}\n`);
                });
            }

            it('reports what each call took', () => {
                const text = table(size, rows, oneShots);
                appendFileSync(join(DIR, 'report.md'), `\n${text}\n`);
                console.log(text);
            });
        });
    }

    it('memory is flat: no query\'s highest piece peak at the largest size passes the smallest\'s by a margin', { skip: sizes.length < 2 }, () => {
        const [smallest, largest] = [sizes[0]!, sizes[sizes.length - 1]!];
        for (const [query, bySize] of peaks) {
            const [small, large] = [bySize.get(smallest.label), bySize.get(largest.label)];
            if (small === undefined || large === undefined) continue;
            assert.ok(large <= small * 1.25 + 16, `${query}: its highest piece peak went from ${f(small)} MiB at ${smallest.label} to ${f(large)} MiB at ${largest.label}`);
        }
    });
});
