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
 *   `orders`, an `Array<Order>`, 100,000 `customers`, and the `shipments`, one
 *   for each shipped order, by its id (#942), generated from fixed seeds — the
 *   same orders at every size, the larger ones going on — and written as beast2
 *   through the canonical element writer, in the data directory, kept for the
 *   next run. The generators and the questions are `testing/query-bench.ts`'s,
 *   which the equivalence suite (`query-equivalence.spec.ts`) asks at a small
 *   size.
 * - **The oracle.** Each query's answer, computed from the generator in the
 *   same pass as East values — independent of e3, east-c and the translator — a
 *   sum adding the totals in input order, as one unit does.
 * - **The repository.** The files taken into a workspace (`datasetAdoptFile`),
 *   kept for the next run too.
 * - **The calls.** Each benchmark query planned as the builder plans it
 *   (`planQuery`, every dataset weighed by e3's status — its stored bytes and
 *   rows — as the builder weighs it), as a split call
 *   on east-c — the first `east-c` on PATH, which the run refuses to start
 *   when e3 would run another: e3 looks a runner up in every
 *   `node_modules/.bin` and the first `.venv` above the data's directory and
 *   the working directory before PATH (`testing/runners.ts`), and the report
 *   names the file it runs — or, for a join of the
 *   orders with the shipments, both larger than a piece, as a re-keyed join's
 *   two (#942), and run in this process through e3-core (`splitCallPrepare`,
 *   `splitCallRun`, `splitCallResult`) with a server's ceilings raised, so a
 *   large size is neither timed out nor too large to answer. Every run is cold:
 *   every execution is forgotten before it, as gc forgets them.
 *
 * It holds every answer to the oracle — East equality, a Float within 1e-9 of
 * it relatively, since the pieces add in another grouping — and, over two
 * sizes or more, each query's highest piece peak at the largest size to a
 * margin over its peak at the smallest size it is planned the same way at:
 * memory flat whatever the size. A query planned another way at a smaller
 * size runs other programs there — q7 reads the shipments whole while they
 * are smaller than a piece, and re-keys the join once they are not — so its
 * peaks there are not compared. It times nothing against a budget. It
 * reports, per query, the calls' time, the time e3 took to plan the pieces
 * and to run its units, the pieces' work per order per core, the CPU this
 * process and its runners used per order — which what else the machine runs
 * moves least — each piece's peak and the load the run started under, as a
 * markdown table on its output and appended to `report.md` beside the data
 * (`report.jsonl` holds the rows). A re-keyed join's row is both its calls':
 * their pieces and merges, the times each took, and every peak.
 *
 * With `E3_QUERY_SCALE_ONE_SHOT=1` each query also runs as the one-shot call
 * the builder would make of it, under the one-shot deadline (120 s unless
 * `E3_QUERY_SCALE_ONE_SHOT_MS` says otherwise): its time, its outcome — at
 * scale it may run out of time or memory — and east-c's peak.
 *
 * **The pick** (#1143): the path the planner picks for each query, by its
 * estimates with the budget's cores to run pieces on and no memory limit —
 * the split calls above are the ones it would make, which it is made to by
 * letting one call use no memory — reported beside both paths' estimated and
 * measured times. With the one-shot calls run, each pick is held to the faster
 * path, or to within 20% of it.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import {
    Beast2ElementWriter, FloatType, OptionType, SortedMap, StringType,
    compareFor, decodeBeast2, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, isVariant, lessFor, none, some, variant,
    type EastType, type option,
} from '@elaraai/east';
import type { ExecuteResult, RunnerValue, SplitCallRequest } from '@elaraai/e3-types';
import {
    LocalStorage, LocalTaskRunner, datasetAdoptFile, executionGet, executionList, executionListIds, executionReadLog, oneShotExecute, packageImport,
    pruneHistory, repoInit, resolveBudget, splitCallPrepare, splitCallResult, splitCallRun, workspaceCreate, workspaceDeploy, workspaceGetDatasetStatus,
} from '@elaraai/e3-core';
import { draftPlan, planQuery, prepareQuery, queryResultOf, type PlanOptions, type QueryPlan, type QueryResult, type SourceWeight } from '@elaraai/e3-ui-components/query';
import {
    CUSTOMERS, CUSTOMER_COUNT, CustomersType, ORDERS, OrdersType, QUERIES, REGIONS, ROOT, SHIPMENTS, ShipmentsType, THRESHOLD, customerId, customers, orders,
    shipmentOf,
} from './testing/query-bench.js';
import { assertPathsRunner, runnerFile } from './testing/runners.js';

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

// ─── The queries ─────────────────────────────────────────────────────────────

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

/** The files of a size: its orders and their shipments, the customers every size shares, and each query's answer. */
function filesOf(size: Size) {
    return {
        orders: join(DIR, `orders-${size.label}.beast2`),
        shipments: join(DIR, `shipments-${size.label}.beast2`),
        customers: join(DIR, 'customers.beast2'),
        oracle: (id: string) => join(DIR, `oracle-${size.label}-${id}.beast2`),
    };
}

/**
 * Writes a size's orders and their shipments, and the customers, unless they
 * are there, and each query's answer from the same pass over the generator.
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
    if (existsSync(files.orders) && existsSync(files.shipments) && QUERIES.every((q) => existsSync(files.oracle(q.id)))) return;

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
    // Each carrier's orders and revenue, and the orders not shipped under none: in East's order of the key, as group_by keeps it.
    const byCarrier = new SortedMap<option<string>, { revenue: number; n: bigint }>([], compareFor(OptionType(StringType)));
    // The queries' comparisons, as East makes them.
    const less = lessFor(FloatType);
    writeWhole(files.orders, (sink) => writeWhole(files.shipments, (shipped) => {
        const writer = new Beast2ElementWriter(OrdersType, sink, { parallel: true });
        const shipments = new Beast2ElementWriter(ShipmentsType, shipped, { parallel: true });
        for (const { order, customer } of orders(size.orders)) {
            writer.add(order);
            // The orders come in id order, so the shipments are written in their dict's key order.
            const shipment = shipmentOf(order);
            if (shipment !== undefined) shipments.add([order.id, shipment]);
            const carrier = shipment === undefined ? none : some(shipment.carrier);
            const was = byCarrier.get(carrier) ?? { revenue: 0, n: 0n };
            byCarrier.set(carrier, { revenue: was.revenue + order.total, n: was.n + 1n });
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
        shipments.finish();
    }));

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
        q7: [...byCarrier].map(([carrier, { revenue: sum, n: count }]) => ({ carrier, revenue: sum, n: count })),
    };
    for (const q of QUERIES) writeFileSync(files.oracle(q.id), encodeBeast2For(resultTypeOf(q.program))(answers[q.id] as never));
    console.log(`# ${size.label}: ${n} orders and the oracle written in ${Math.round((Date.now() - started) / 1000)} s`);
}

// ─── The repository ──────────────────────────────────────────────────────────

/** What a size's repository holds, kept beside it once it is whole. */
interface RepoMark {
    readonly orders: number;
    /** The orders' file, in bytes. */
    readonly bytes: number;
    /** The customers' file, in bytes. */
    readonly customersBytes: number;
    /** The shipments' file, in bytes (#942). */
    readonly shipmentsBytes: number;
}

/**
 * A size's repository, its workspace deployed and the files taken in, unless
 * a run made it before: it is whole once its mark is written. One made before
 * the shipments (#942) is made again.
 */
async function ensureRepo(size: Size, storage: LocalStorage, runner: LocalTaskRunner): Promise<{ repo: string; mark: RepoMark }> {
    const repo = join(DIR, `repo-${size.label}`);
    const markFile = `${repo}.json`;
    if (existsSync(markFile)) {
        const kept = JSON.parse(readFileSync(markFile, 'utf8')) as Partial<RepoMark>;
        if (kept.shipmentsBytes !== undefined) return { repo, mark: kept as RepoMark };
    }
    const files = filesOf(size);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const made = repoInit(repo);
    if (!made.success) throw made.error ?? new Error(`could not make the repository ${repo}`);
    const zip = join(DIR, `package-${size.label}.zip`);
    await e3.export(e3.package('scale', '1.0.0', e3.input('orders', OrdersType), e3.input('customers', CustomersType), e3.input('shipments', ShipmentsType)), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'scale', '1.0.0');
    const started = Date.now();
    await datasetAdoptFile(storage, repo, WS, CUSTOMERS, files.customers, { runner });
    await datasetAdoptFile(storage, repo, WS, ORDERS, files.orders, { runner });
    await datasetAdoptFile(storage, repo, WS, SHIPMENTS, files.shipments, { runner });
    console.log(`# ${size.label}: the orders and their shipments taken in in ${Math.round((Date.now() - started) / 1000)} s`);
    const mark: RepoMark = {
        orders: size.orders, bytes: statSync(files.orders).size, customersBytes: statSync(files.customers).size, shipmentsBytes: statSync(files.shipments).size,
    };
    writeFileSync(markFile, JSON.stringify(mark));
    return { repo, mark };
}

/**
 * What each data source of the root weighs, as e3's status says it — its
 * stored bytes and the rows of a stored collection — as the builder weighs it
 * (its `sourceStatusOf`).
 */
async function weightsOf(storage: LocalStorage, repo: string): Promise<Map<string, SourceWeight>> {
    const weights = new Map<string, SourceWeight>();
    for (const entry of ROOT.entries) {
        const status = await workspaceGetDatasetStatus(storage, repo, WS, entry.path, { geometry: true });
        weights.set(entry.name, { bytes: status.storedBytes ?? status.size ?? undefined, rows: status.rows ?? undefined });
    }
    return weights;
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

/** A query's pick (#1143): the path the planner picks, both paths' estimates, and their times as measured. */
interface PickRow {
    readonly size: string;
    readonly query: string;
    /** The path it picks, and why. */
    readonly picks: QueryPlan['kind'];
    readonly why: string;
    /** Both paths' estimated seconds, when the planner estimated them. */
    readonly estimatedOneCall: number | null;
    readonly estimatedSplit: number | null;
    /** The split calls' seconds, the median of the runs. */
    readonly split: number;
    /** The one-shot call's seconds and outcome, when it ran. */
    readonly oneCall: { readonly seconds: number; readonly outcome: string } | null;
}

/** The pick's time over the faster path's, or `null` when the one-shot call did not run: one call that did not answer is slower than any split. */
function pickOverFaster(row: PickRow): number | null {
    if (row.oneCall === null) return null;
    const answered = row.oneCall.outcome === 'exact' || row.oneCall.outcome === 'within 1e-9';
    const one = answered ? row.oneCall.seconds : Infinity;
    return (row.picks === 'one_shot' ? one : row.split) / Math.min(one, row.split);
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

/** An execution the repository records, as {@link records} gives it. */
type Execution = Awaited<ReturnType<typeof records>>[number];
/** When an execution started, in epoch milliseconds. */
const startOf = (r: Execution): number => r.status.value.startedAt.getTime();
/** When it ended, in epoch milliseconds: NaN while it runs. */
const endOf = (r: Execution): number => (r.status.type === 'running' ? NaN : r.status.value.completedAt.getTime());

/**
 * The most bytes a split call's result is read inline, as a poll reads it: its
 * request's own limit — a re-key call's is one byte, its output read by its
 * hash — or the ceiling.
 */
function maxResultBytesOf(request: SplitCallRequest): number {
    const limits = request.limits;
    return limits.type === 'some' && limits.value.maxResultBytes.type === 'some' ? Number(limits.value.maxResultBytes.value) : CEILINGS.maxResultBytes;
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

/** A size's rows as a markdown table, then its one-shot calls' and its picks'. */
function table(size: Size, rows: readonly SplitRow[], oneShots: readonly OneShotRow[], picks: readonly PickRow[]): string {
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
    if (picks.length > 0) {
        const path = (kind: QueryPlan['kind']): string => (kind === 'one_shot' ? 'one call' : kind === 'rekey' ? 're-keyed join' : 'split call');
        const ratio = (row: PickRow): string => {
            const over = pickOverFaster(row);
            return over === null ? '-' : Number.isFinite(over) ? f(over, 2) : 'inf';
        };
        lines.push('', '| query | picks | why | estimated one call / split s | one call s | split s | pick / faster |', '|---|---|---|---|---|---|---|');
        lines.push(...picks.map((r) => `| ${r.query} | ${path(r.picks)} | ${r.why} | ${r.estimatedOneCall === null ? '-' : f(r.estimatedOneCall, 2)} / ${r.estimatedSplit === null ? '-' : f(r.estimatedSplit, 2)} | ${r.oneCall === null ? '-' : `${f(r.oneCall.seconds, 2)}${r.oneCall.outcome === 'exact' || r.oneCall.outcome === 'within 1e-9' ? '' : ` (${r.oneCall.outcome})`}`} | ${f(r.split, 2)} | ${ratio(r)} |`));
    }
    return lines.join('\n');
}

/** The environment a report was measured in: the file e3 runs for east-c and what it says its version is, the budget, the machine. */
function environment(eastC: string, budget: { cores: number; memory: number }): string {
    const real = realpathSync(eastC);
    const version = spawnSync(eastC, ['version'], { encoding: 'utf8' }).stdout.trim().split('\n').join(', ');
    return `east-c ${eastC}${real === eastC ? '' : ` (${real})`} (${version}); budget ${budget.cores} cores, ${f(budget.memory / 1024 ** 3, 2)} GiB; ${process.env['E3_QUERY_SCALE_NOTE'] ?? ''}`.trim();
}

// ─── The spec ────────────────────────────────────────────────────────────────

describe('query plans at scale (E3_QUERY_SCALE=1)', { skip: !enabled }, () => {
    const sizes = enabled ? sizesOf(process.env['E3_QUERY_SCALE_SIZES']) : [];
    const queries = enabled ? queriesOf(process.env['E3_QUERY_SCALE_QUERIES']) : [];
    const storage = new LocalStorage();
    /** Each query's highest piece peak, by size, and how it was planned there. */
    const peaks = new Map<string, Map<string, { peak: number; splitsAs: string }>>();
    const budget = resolveBudget();

    before(() => {
        // Each size's repository is made in DIR, so e3 looks east-c up from there, beside the working directory.
        const repoAt = join(DIR, 'repo');
        const eastC = runnerFile('east-c', repoAt);
        assert.ok(eastC !== null, 'e3 finds no east-c: build it Release (cmake -DCMAKE_BUILD_TYPE=Release) and put it first on PATH');
        assertPathsRunner('east-c', eastC, repoAt);
        mkdirSync(DIR, { recursive: true });
        appendFileSync(join(DIR, 'report.md'), `\n### ${new Date().toISOString()}\n\n${environment(eastC, budget)}\n`);
    });

    for (const size of sizes) {
        describe(`${size.label}: ${size.orders} orders`, () => {
            let repo: string;
            const runner = new LocalTaskRunner(join(DIR, `repo-${size.label}`), budget);
            const rows: SplitRow[] = [];
            const oneShots: OneShotRow[] = [];
            const picks: PickRow[] = [];
            let weights: Map<string, SourceWeight>;

            before(async () => {
                ensureData(size);
                ({ repo } = await ensureRepo(size, storage, runner));
                weights = await weightsOf(storage, repo);
            });

            for (const q of queries) {
                it(`${q.id}, ${q.label}: each cold run of its split calls answers as the oracle does`, async () => {
                    const type = resultTypeOf(q.program);
                    const oracle = decodeBeast2For(type)(readFileSync(filesOf(size).oracle(q.id)));
                    // Every dataset weighed by its status, as the builder weighs it: a join of the orders with the
                    // shipments, both larger than a piece, is re-keyed (#942); the customers, within one, are read whole.
                    // The path the builder picks, with the budget's cores to run the pieces on (#1143); and the split
                    // calls it would make, which it makes whatever it picks when one call may use no memory.
                    const options: PlanOptions = { runner: EAST_C, maxBytes: CEILINGS.maxResultBytes, cores: budget.cores };
                    const picked = planQuery(q.program, ROOT, weights, options);
                    const planned = planQuery(q.program, ROOT, weights, { ...options, memoryBytes: 0 });
                    if ('result' in picked || 'result' in planned) assert.fail(`${q.program} does not check`);
                    const plan = planned.plan;
                    if (plan.kind === 'one_shot') assert.fail(`${q.program} planned one call`);
                    const splitSeconds: number[] = [];
                    const path = plan.explanation.path;
                    const splitsAs = plan.kind === 'split' ? plan.request.output.type : `re-key, then ${path.kind === 'split' ? path.output : '?'}`;
                    for (let run = 1; run <= RUNS; run++) {
                        // Every execution forgotten, as gc forgets them, so the calls run every unit.
                        await pruneHistory(storage, repo, { keepRuns: 0, keepDays: 0, dryRun: false }, Date.now() + 60_000);
                        const loadAtStart = loadavg()[0]!;
                        const cpuAtStart = cpuSeconds();
                        const started = performance.now();
                        /** A split call, run cold through e3-core: its result, read as a poll answers it, and its assembled output's hash. */
                        const call = async (request: SplitCallRequest, what: string): Promise<{ result: ExecuteResult; output: string | null }> => {
                            const launched = await splitCallPrepare(storage, repo, WS, request, { grant: 'any', ceilings: CEILINGS });
                            if ('outcome' in launched) {
                                const why = launched.outcome.type === 'invalid' ? launched.outcome.value.diagnostics.map((d) => d.message).join('; ') : launched.outcome.type;
                                assert.fail(`${q.id}'s ${what} was refused: ${why}`);
                            }
                            const outcome = await splitCallRun(storage, runner, repo, launched);
                            const result = await splitCallResult(storage, repo, outcome, launched.read, maxResultBytesOf(request));
                            return { result, output: outcome.output.type === 'some' ? outcome.output.value : null };
                        };
                        let result: ExecuteResult;
                        if (plan.kind === 'split') {
                            result = (await call(plan.request, 'split call')).result;
                        } else {
                            // A re-keyed join (#942): the re-key call, then the join call over its output, by its hash.
                            const first = await call(plan.first, 're-key call');
                            const joined = first.output === null ? undefined : (await call(plan.join(first.output), 'join call')).result;
                            result = plan.answer(first.result, joined);
                        }
                        const seconds = (performance.now() - started) / 1000;
                        splitSeconds.push(seconds);
                        const cpuAtEnd = cpuSeconds();
                        const answer = decoded(queryResultOf(plan.reading, result), `${q.id}'s split calls`);
                        assert.ok(isTypeEqual(answer.type, type), `${q.id}: the split calls answer at the query's result type`);
                        const exact = equalFor(type)(answer.value as never, oracle as never);
                        assert.ok(exact || close(type, answer.value, oracle), `${q.id}: the split calls' answer is the oracle's`);

                        // What ran: each split task's own execution — the call's, or a re-keyed join's two — and their units.
                        const made = await records(storage, repo);
                        const own = made.filter((r) => !r.status.value.unit).sort((a, b) => startOf(a) - startOf(b));
                        const units = made.filter((r) => r.status.value.unit);
                        // Typed: `assert.equal` asserts, so inferring this from `plan`, narrowed around the loop, would be circular.
                        const calls: number = plan.kind === 'split' ? 1 : 2;
                        assert.equal(own.length, calls, `${q.id}: one execution of each of its ${calls} split tasks`);
                        let cut = 0;
                        const lines: UnitLine[] = [];
                        for (const task of own) {
                            const logged = await unitLines(storage, repo, task);
                            cut += logged.pieces;
                            lines.push(...logged.units);
                        }
                        const pieces = lines.filter((u) => u.kind === 'piece');
                        const merges = lines.filter((u) => u.kind !== 'piece');
                        assert.equal(pieces.length, cut, `${q.id}: the logs name every piece the plans cut`);
                        assert.deepEqual(lines.filter((u) => u.state !== 'completed').map((u) => `${u.kind} ${u.state}`), [], `${q.id}: every unit ran`);
                        const sum = (xs: readonly UnitLine[]): number => xs.reduce((s, u) => s + u.ms, 0) / 1000;
                        // Each call's time planning its pieces — from its start to its first unit's — and running its units.
                        let planSeconds = 0;
                        let unitSeconds = 0;
                        for (const task of own) {
                            const mine = units.filter((u) => startOf(u) >= startOf(task) && endOf(u) <= endOf(task));
                            assert.ok(mine.length > 0, `${q.id}: a split task ran units`);
                            const firstUnit = Math.min(...mine.map(startOf));
                            planSeconds += (firstUnit - startOf(task)) / 1000;
                            unitSeconds += (Math.max(...mine.map(endOf)) - firstUnit) / 1000;
                        }
                        const piecePeaks = pieces.map((u) => u.peakMiB).filter((p): p is number => p !== null);
                        const row: SplitRow = {
                            size: size.label, orders: size.orders, query: q.id, output: splitsAs, run, seconds,
                            planSeconds,
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
                        const highest = peaks.get(q.id) ?? new Map<string, { peak: number; splitsAs: string }>();
                        highest.set(size.label, { peak: Math.max(highest.get(size.label)?.peak ?? 0, row.pieceMaxPeakMiB), splitsAs });
                        peaks.set(q.id, highest);
                    }

                    const pathOf = picked.plan.explanation.path;
                    const pick = (oneCall: PickRow['oneCall']): PickRow => ({
                        size: size.label, query: q.id, picks: picked.plan.kind, why: pathOf.kind === 'split' ? pathOf.why : pathOf.why.kind,
                        estimatedOneCall: picked.plan.explanation.estimates?.oneCall.seconds ?? null,
                        estimatedSplit: picked.plan.explanation.estimates?.split.seconds ?? null,
                        split: median(splitSeconds), oneCall,
                    });
                    /** A pick, reported, and its row written to `report.jsonl`. */
                    const record = (row: PickRow): void => {
                        picks.push(row);
                        appendFileSync(join(DIR, 'report.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), pick: true, ...row })}\n`);
                    };
                    if (!ONE_SHOT) {
                        record(pick(null));
                        return;
                    }
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
                    record(pick({ seconds, outcome }));
                });
            }

            it('reports what each call took', () => {
                const text = table(size, rows, oneShots, picks);
                appendFileSync(join(DIR, 'report.md'), `\n${text}\n`);
                console.log(text);
            });

            it('picks the faster path for each query, or one within 20% of it (#1143)', { skip: !ONE_SHOT && 'it needs both paths timed: E3_QUERY_SCALE_ONE_SHOT=1' }, () => {
                const slow = picks.filter((row) => (pickOverFaster(row) ?? 1) > 1.2)
                    .map((row) => `${row.query}: picked ${row.picks}, ${f(pickOverFaster(row)!, 2)} times the faster path's time`);
                assert.deepEqual(slow, [], `at ${size.label}, a pick more than 20% slower than the other path`);
            });
        });
    }

    it('memory is flat: no query\'s highest piece peak at the largest size passes, by a margin, its peak at the smallest size it is planned the same way at', { skip: sizes.length < 2 }, (t) => {
        const largest = sizes[sizes.length - 1]!;
        for (const [query, bySize] of peaks) {
            const large = bySize.get(largest.label);
            if (large === undefined) continue;
            // A query planned another way at a smaller size runs other programs there, so its peaks are held to the
            // same plan's alone: q7 reads the shipments whole while they are smaller than a piece, and re-keys the join
            // once they are not.
            const smallest = sizes.find((size) => bySize.get(size.label)?.splitsAs === large.splitsAs)!;
            if (smallest === largest) {
                t.diagnostic(`${query}: planned as ${large.splitsAs} at ${largest.label} alone, so no smaller size is planned the same way to compare it with`);
                continue;
            }
            const small = bySize.get(smallest.label)!;
            assert.ok(large.peak <= small.peak * 1.25 + 16,
                `${query}, planned as ${large.splitsAs}: its highest piece peak went from ${f(small.peak)} MiB at ${smallest.label} to ${f(large.peak)} MiB at ${largest.label}`);
        }
    });
});
