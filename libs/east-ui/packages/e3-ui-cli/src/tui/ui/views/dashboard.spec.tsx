/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the dashboard (mocks S05, S06, S18): the counts and the
 * accounted bar, the execution panel in its states (while running, the
 * budget in use, a split task's progress, a unit requeued and one waiting
 * for room), the tasks and inputs tables with each task's peak, `⏎` on each
 * row kind, a deploy in progress, scrolling a long column, and the narrow
 * layout.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, DictType, FloatType, StringType, StructType, none, some, toEastTypeValue, variant } from '@elaraai/east';
import type { Action, ExecutionData } from '../../state/actions.js';
import { breakpoint } from '../../render/layout.js';
import { initialState, type TuiState } from '../../state/actions.js';
import { createStore } from '../../state/store.js';
import { dashboardFixture } from '../../testing/fixtures.js';
import { KEY, NOW, dashboardView, mountApp, type Mounted } from '../../testing/harness.js';
import { accountedBar, dashboardLines, dashboardModel, latestPerTask, liveRows, type DashboardCtx } from './dashboard.js';
import { UNICODE } from '../../render/glyphs.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** A task of the status result, with the peak of the execution its status comes from. */
const task = (name: string, status: unknown, dependsOn: string[], inputs: string[], peak: number | null = null) =>
    ({ name, hash: `hash-${name}`, status, inputs, output: `.tasks.${name}.output`, dependsOn, peakBytes: peak !== null ? some(BigInt(Math.round(peak))) : none });

/** A dataset of the status result. */
const dataset = (path: string, status: string, hash: string | null, producedBy: string | null) =>
    ({ path, status: variant(status, null), hash: hash !== null ? some(hash) : none, isTaskOutput: producedBy !== null, producedBy: producedBy !== null ? some(producedBy) : none });

/** A dataset list entry (type / size / hash). */
const entry = (path: string, type: unknown, size: number | null, hash: string | null) =>
    variant('dataset', { path, type, hash: hash !== null ? some(hash) : none, size: size !== null ? some(BigInt(size)) : none });

const rowsType = toEastTypeValue(ArrayType(StructType({ sku: StringType, units: FloatType })));
const paramsType = toEastTypeValue(StructType({ horizon: FloatType }));
const overridesType = toEastTypeValue(DictType(StringType, FloatType));
const forecastType = toEastTypeValue(DictType(StringType, StructType({ units: FloatType })));

/**
 * The mock's six tasks and four inputs, with `forecast` optionally in
 * progress: split into 8 pieces, 3 done, and piece 5, stopped past the
 * server's budget of 8 cores and 14 GB, waiting for room to run again.
 */
function fixture(options: { running?: boolean } = {}): Action[] {
    const running = options.running === true;
    const tasks = [
        task('ingest', variant('up-to-date', { cached: false }), [], ['.inputs.sales', '.inputs.calendar'], 310 * MB),
        task('features', variant('up-to-date', { cached: false }), ['ingest'], ['.inputs.params', '.tasks.ingest.output'], 1.8 * GB),
        task('forecast', running ? variant('in-progress', { pid: some(4242n), startedAt: some(iso(9_000)) }) : variant('up-to-date', { cached: true }), ['features'], ['.tasks.features.output'], running ? null : 2.9 * GB),
        task('optimise', variant('waiting', { reason: 'Waiting for task \'forecast\'' }), ['forecast'], ['.inputs.overrides']),
        task('report', variant('failed', { exitCode: 2n, completedAt: none }), ['forecast', 'optimise'], [], 96 * MB),
        task('dashboard', variant('ready', null), [], ['.inputs.sales']),
    ];
    const datasets = [
        dataset('.inputs.sales', 'up-to-date', '9f3c1a7e2b41cafe', null),
        dataset('.inputs.calendar', 'up-to-date', '5b0e88a1c3d7beef', null),
        dataset('.inputs.params', 'stale', '0a44e1b7c9d2f00d', null),
        dataset('.inputs.overrides', 'unset', null, null),
        ...tasks.map(t => dataset(t.output, 'up-to-date', `out-${t.name}`, t.name)),
    ];
    const counts = (type: string) => BigInt(tasks.filter(t => (t.status as { type: string }).type === type).length);
    const status = {
        workspace: 'main',
        lock: none,
        datasets,
        tasks,
        summary: {
            datasets: { total: 10n, unset: 1n, stale: 1n, upToDate: 8n },
            tasks: { total: 6n, upToDate: counts('up-to-date'), ready: counts('ready'), waiting: counts('waiting'), inProgress: counts('in-progress'), failed: counts('failed'), error: 0n, staleRunning: 0n },
        },
    };
    const entries = [
        entry('inputs.sales', rowsType, 10_276_044, '9f3c1a7e2b41cafe'),
        entry('inputs.calendar', rowsType, 2_150, '5b0e88a1c3d7beef'),
        entry('inputs.params', paramsType, 1_229, '0a44e1b7c9d2f00d'),
        entry('inputs.overrides', overridesType, null, null),
        // The server lists a task's subtree as one leaf at `.tasks.<name>`, and a listing that walks
        // into one names its output `.tasks.<name>.output` — both must resolve.
        entry('tasks.ingest', rowsType, 12_687_000, 'out-ingest'),
        entry('tasks.features', paramsType, 432_600_000, 'out-features'),
        entry('tasks.forecast', forecastType, 88_300_000, 'out-forecast'),
        entry('tasks.optimise', rowsType, null, null),
        entry('tasks.report.output', toEastTypeValue(StringType), null, null),
        entry('tasks.dashboard', paramsType, 41_984, 'out-dashboard'),
    ];
    const piece5 = { merge: none, index: 4n, units: 8n };
    const execution = running
        ? {
            state: {
                status: variant('running', null), startedAt: iso(12_000), completedAt: none, summary: none, events: [], nextSeq: 5n,
                budget: some({ cores: 8n, memory: BigInt(14 * GB), coresInUse: 4n, memoryInUse: BigInt(Math.round(12.6 * GB)) }),
                waiting: [{ task: 'forecast', unit: some(piece5), needs: BigInt(Math.round(3.2 * GB)), since: iso(2_000) }],
                splits: [{ task: 'forecast', merge: none, done: 3n, units: 8n }],
            },
            events: [
                variant('cached', { task: 'ingest', timestamp: iso(12_000) }),
                variant('start', { task: 'features', timestamp: iso(12_000) }),
                variant('complete', { task: 'features', timestamp: iso(11_000), duration: 4_200, peakBytes: some(BigInt(Math.round(1.8 * GB))) }),
                variant('start', { task: 'forecast', timestamp: iso(9_000) }),
                variant('requeued', { task: 'forecast', timestamp: iso(4_000), unit: piece5, reason: variant('budget', null), peak: BigInt(Math.round(3.2 * GB)), reserves: BigInt(Math.round(3.2 * GB)) }),
            ],
            startedAt: iso(12_000),
        }
        : {
            state: {
                status: variant('failed', null), startedAt: iso(120_000), completedAt: some(iso(81_600)), summary: some({ executed: 4n, cached: 1n, failed: 1n, skipped: 0n, duration: 38_400 }), events: [], nextSeq: 8n,
                budget: some({ cores: 8n, memory: BigInt(14 * GB), coresInUse: 0n, memoryInUse: 0n }),
                waiting: [],
                splits: [],
            },
            events: [
                variant('start', { task: 'ingest', timestamp: iso(120_000) }),
                variant('complete', { task: 'ingest', timestamp: iso(116_900), duration: 3_100, peakBytes: some(BigInt(310 * MB)) }),
                variant('start', { task: 'features', timestamp: iso(116_900) }),
                variant('complete', { task: 'features', timestamp: iso(104_900), duration: 12_000, peakBytes: some(BigInt(Math.round(1.8 * GB))) }),
                variant('cached', { task: 'forecast', timestamp: iso(104_900) }),
                variant('start', { task: 'report', timestamp: iso(61_000) }),
                variant('failed', { task: 'report', timestamp: iso(60_000), duration: 800, exitCode: 2n }),
                variant('input_unavailable', { task: 'optimise', timestamp: iso(60_000), reason: 'waiting on forecast' }),
            ],
            startedAt: iso(120_000),
        };
    return [
        { type: 'data/workspaces', workspaces: [{ name: 'main', deployed: true, packageName: some('demand'), packageVersion: some('1.4.2') }] as never },
        { type: 'data/workspaceState', ws: 'main', state: { packageName: 'demand', packageVersion: '1.4.2', packageHash: 'p', deployedAt: new Date(NOW - 3 * 86_400_000), currentRunId: none } as never },
        { type: 'data/status', ws: 'main', result: status as never, at: NOW - 400 },
        { type: 'data/datasets', ws: 'main', entries: entries as never },
        { type: 'data/taskList', ws: 'main', tasks: tasks.map(t => ({
            name: t.name,
            hash: t.hash,
            role: t.name === 'dashboard' ? variant('ui', { paths: [], functions: [], records: [], pages: [] }) : variant('data', null),
        })) as never },
        { type: 'data/execution', ws: 'main', state: execution.state as never, events: execution.events as never, startedAt: execution.startedAt },
    ];
}

describe('the dashboard', () => {
    test('after a failed run: counts, the accounted bar, the failure row, the tasks and inputs tables (S05)', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture() });
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main\s+● CONNECTED$/);
        assert.match(lines[2]!, /^ main\s+● DEPLOYED · demand@1\.4\.2 · deployed 3d ago · lock: none$/);
        assert.match(lines[3]!, /^ TASKS 6\s+DATASETS 10$/);
        assert.match(lines[4]!, /^ ● up-to-date\s+3   ◐ waiting\s+1\s+● up-to-date\s+8   ◐ stale\s+1$/);
        assert.match(lines[5]!, /^ ✗ failed\s+1   ○ ready\s+1\s+○ unset\s+1$/);
        assert.match(lines[6]!, /^ ✗▁▃▇▇▇  5 of 6 accounted$/);
        assert.equal(lines[7], '');
        assert.match(lines[8]!, /^ LAST EXECUTION\s+✗ FAILED · started 2m ago · 38\.4s · executed 4 · cached 1 · failed 1 · skipped 0$/);
        assert.match(lines[9]!, /^ ▌  1m  ✗ failed      report\s+exit 2 · 0\.8s     ⏎ logs$/);
        assert.equal(lines[10], '');
        assert.match(lines[11]!, /^ TASKS$/);
        assert.match(lines[12]!, /^  NAME\s+STATUS\s+DEPENDS ON\s+INPUTS\s+OUTPUT\s+SIZE · LAST RUN\s+PEAK$/);
        assert.match(lines[13]!, /^  ingest\s+● up-to-date\s+—\s+sales, calendar\s+Array<Struct>\s+12\.1 MB · 3\.1s\s+310 MB$/);
        assert.match(lines[14]!, /^  features\s+● up-to-date\s+ingest\s+params\s+Struct\s+412\.6 MB · 12\.0s\s+1\.8 GB$/);
        assert.match(lines[15]!, /^  forecast\s+● up-to-date\s+features\s+—\s+Dict<String, Struct>\s+84\.2 MB · cached\s+2\.9 GB$/);
        assert.match(lines[16]!, /^  optimise\s+◐ waiting\s+forecast\s+overrides\s+Array<Struct>\s+— · waiting for …\s+—$/);
        assert.match(lines[17]!, /^  report\s+✗ failed · exit 2\s+forecast, optimise\s+—\s+String\s+— · 0\.8s\s+96 MB$/);
        assert.match(lines[18]!, /^  dashboard\s+○ ready\s+—\s+sales\s+UIComponentType\s+41 KB · never\s+—$/);
        assert.equal(lines[19], '');
        assert.match(lines[20]!, /^ INPUTS$/);
        assert.match(lines[21]!, /^  NAME\s+STATUS\s+TYPE\s+SIZE\s+HASH$/);
        assert.match(lines[22]!, /^  sales\s+● up-to-date\s+Array<Struct>\s+9\.8 MB\s+9f3c1a7e2b41$/);
        assert.match(lines[23]!, /^  calendar\s+● up-to-date\s+Array<Struct>\s+2\.1 KB\s+5b0e88a1c3d7$/);
        assert.match(lines[24]!, /^  params\s+◐ stale\s+Struct\s+1\.2 KB\s+0a44e1b7c9d2$/);
        assert.match(lines[25]!, /^  overrides\s+○ unset\s+Dict<String, Float>\s+—\s+—$/);
        assert.match(lines[33]!, /^ › _\s+\/ commands · type a name to jump · \? help$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   r run   x stop   w workspaces   \/ commands\s+polled just now$/);
    });

    test('⏎ opens the failed task\'s logs, a task, or an input; gg / G / page keys walk the rows', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture() });
        await mounted.press(KEY.enter);
        let view = mounted.store.getState().view;
        assert.equal(view.kind, 'task');
        assert.equal(view.kind === 'task' && view.task, 'report');
        assert.equal(view.kind === 'task' && view.tab, 'stdout');
        await mounted.press(KEY.escape);
        assert.equal(mounted.store.getState().view.kind, 'dashboard');
        await mounted.press('j');
        await mounted.press('j');
        await mounted.press('j');
        assert.match(mounted.lines()[15]!, /^ ▌forecast/);
        await mounted.press(KEY.enter);
        view = mounted.store.getState().view;
        assert.equal(view.kind === 'task' && view.task, 'forecast');
        assert.equal(view.kind === 'task' && view.tab, 'output');
        await mounted.press(KEY.escape);
        await mounted.press('G');
        assert.match(mounted.lines()[25]!, /^ ▌overrides/);
        await mounted.press(KEY.enter);
        view = mounted.store.getState().view;
        assert.equal(view.kind === 'input' && view.name, 'overrides');
        await mounted.press(KEY.escape);
        await mounted.press('g');
        await mounted.press('g');
        assert.match(mounted.lines()[9]!, /^ ▌  1m  ✗ failed/);
        await mounted.press(KEY.pageDown);
        assert.match(mounted.lines()[25]!, /^ ▌overrides/);
        await mounted.press(KEY.pageUp);
        assert.match(mounted.lines()[9]!, /^ ▌  1m  ✗ failed/);
    });

    test('while running: the budget in use, the live feed, the RUNNING pill, the in-progress row, and no r run hint (S06)', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture({ running: true }) });
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main\s+◔ RUNNING 2\/6 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]  ● CONNECTED$/);
        assert.match(lines[4]!, /^ ● up-to-date\s+2   ◐ waiting\s+1/);
        assert.match(lines[6]!, /^ ◔ in-progress\s+1$/);
        assert.match(lines[7]!, /^ ✗▁▃▅▇▇  5 of 6 accounted$/);
        assert.match(lines[9]!, /^ EXECUTION\s+◔ RUNNING · started 12s ago · 2 of 6 tasks · cores 4 of 8 · memory 12\.6 of 14 GB · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/);
        assert.match(lines[10]!, /^   12s  ● cached      ingest$/);
        assert.match(lines[11]!, /^   11s  ● complete    features\s+4\.2s · peak 1\.8 GB$/);
        // A split task's start names how far its stage has got; a unit stopped past the budget, and its wait for room.
        assert.match(lines[12]!, /^    9s  ◔ start       forecast · 3 of 8 pieces\s+[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 9s$/);
        assert.match(lines[13]!, /^    4s  ⟲ requeued    forecast · piece 5 of 8\s+over budget at 3\.2 GB$/);
        assert.match(lines[14]!, /^    2s  ◐ waiting     forecast · piece 5 of 8\s+needs 3\.2 GB · 1\.4 GB free$/);
        assert.equal(lines[15], '');
        assert.match(lines[16]!, /^ TASKS$/);
        // A task in progress has no peak yet.
        assert.match(lines[20]!, /^  forecast\s+◔ in-progress\s+features\s+—\s+Dict<String, Struct>\s+[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 9s\s+—$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   x stop   \/ commands\s+polled just now$/);
        // No failure rows while running: the first selectable row is the first task.
        assert.match(lines[18]!, /^ ▌ingest/);
    });

    test('short of room, the running header drops the run\'s age for the budget, then the budget', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture({ running: true }), size: { columns: 80, rows: 30 } });
        assert.ok(mounted.lines().some(line => /^ EXECUTION\s+◔ RUNNING · 2 of 6 tasks · cores 4 of 8 · memory 12\.6 of 14 GB · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*[│█▲▼]?$/.test(line)), mounted.frame());
        mounted.unmount();
        mounted = await mountApp({ view: dashboardView(), actions: fixture({ running: true }), size: { columns: 60, rows: 30 } });
        assert.ok(mounted.lines().some(line => /^ EXECUTION\s+◔ RUNNING · started 12s ago · 2 of 6 tasks · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*[│█▲▼]?$/.test(line)), mounted.frame());
    });

    test('never run, starting, and nothing deployed', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: [...fixture(), { type: 'data/execution', ws: 'main', state: null, events: [], startedAt: null }] });
        assert.match(mounted.lines()[8]!, /^ LAST EXECUTION\s+○ never run · r run$/);
        assert.match(mounted.lines()[10]!, /^ TASKS$/);
        assert.match(mounted.lines()[17]!, /^  dashboard\s+○ ready\s+.*41 KB · never\s+—$/);
        await mounted.dispatch({ type: 'data/executionFlag', ws: 'main', settling: true });
        assert.match(mounted.lines()[8]!, /^ EXECUTION\s+◔ STARTING · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/);
        assert.match(mounted.lines()[35]!, /^ ↑↓ move   ⏎ open   x stop/);
        mounted.unmount();
        mounted = await mountApp({
            view: dashboardView('scratch'),
            actions: [
                { type: 'data/workspaces', workspaces: [{ name: 'scratch', deployed: false, packageName: none, packageVersion: none }] as never },
                { type: 'data/workspaceState', ws: 'scratch', state: null },
            ],
        });
        assert.match(mounted.lines()[2]!, /^ scratch\s+○ EMPTY$/);
        assert.match(mounted.frame(), /○  NOTHING DEPLOYED/);
        assert.match(mounted.frame(), /e3 workspace deploy <repo> scratch <package>\[@version\]   deploy one/);
    });

    test('a deploy in progress: the INPUTS and RECORDS tables, each file and record at its step, first deploy and redeploy alike', async () => {
        /** The deploy's lock, as the lock route serves it, with the files and records it reports. */
        const deploying = (files: unknown[], records: unknown[]) => ({
            state: {
                operation: variant('deployment', null),
                holder: variant('process', { pid: 4242n, bootId: 'boot', startTime: 1n, command: 'e3 workspace deploy' }),
                acquiredAt: new Date(NOW - 12_000),
                expiresAt: none,
            },
            progress: some(variant('deployment', { package: { name: 'demand', version: '1.5.0' }, startedAt: new Date(NOW - 10_000), files, records })),
        }) as never;
        const file = (name: string, step: unknown, bytes: number, total: number) =>
            ({ path: `inputs/${name}`, step, bytes: BigInt(Math.round(bytes * MB)), total: BigInt(Math.round(total * MB)) });
        const orders = (step: unknown) => ({ plan: { record: 'records/orders', action: variant('migrate', { steps: ['add_owner', 'by_title'] }) }, indexes: ['by_customer'], step });
        const audit = (step: unknown) => ({ plan: { record: 'records/audit', action: variant('mint', null) }, indexes: [], step });

        // A first deploy, taking its files in: 17 of its 32 MB past their hash in 10 s.
        mounted = await mountApp({
            view: dashboardView('scratch'),
            actions: [
                { type: 'data/workspaces', workspaces: [{ name: 'scratch', deployed: false, packageName: none, packageVersion: none }] as never },
                { type: 'data/workspaceState', ws: 'scratch', state: null },
                { type: 'data/lock', ws: 'scratch', lock: deploying([
                    file('sales', variant('done', variant('taken', ['east-c'])), 10, 10),
                    file('calendar', variant('done', variant('known', null)), 2, 2),
                    file('stock', variant('taking_in', { pieces: 4n, done: 2n }), 4, 8),
                    file('prices', variant('hashing', null), 1, 6),
                    file('legacy', variant('taking_in', { pieces: 1n, done: 0n }), 1, 4),
                    file('extra', variant('waiting', null), 0, 2),
                ], [orders(variant('waiting', null)), audit(variant('waiting', null))]) },
            ],
        });
        let lines = mounted.lines();
        assert.match(lines[2]!, /^ scratch\s+◔ DEPLOYING · demand@1\.5\.0 · pid 4242 · started 12s ago$/);
        assert.match(lines[3]!, /^ DEPLOY\s+◔ TAKING IN · 2 of 6 files · 17 of 32 MB · 1\.7 MB\/s · ~8\.8s left$/);
        assert.equal(lines[4], '');
        assert.match(lines[5]!, /^ INPUTS$/);
        assert.match(lines[6]!, /^  NAME\s+STATUS\s+SIZE$/);
        assert.match(lines[7]!, /^  sales\s+● taken in by east-c\s+10 MB$/);
        assert.match(lines[8]!, /^  calendar\s+● unchanged\s+2 MB$/);
        assert.match(lines[9]!, /^  stock\s+◔ taking in █████░░░░░ 50%\s+8 MB$/);
        assert.match(lines[10]!, /^  prices\s+◔ hashing ██░░░░░░░░ 16%\s+6 MB$/);
        assert.match(lines[11]!, /^  legacy\s+◔ taking in ███░░░░░░░ 25%\s+4 MB$/);
        assert.match(lines[12]!, /^  extra\s+○ waiting\s+2 MB$/);
        assert.equal(lines[13], '');
        assert.match(lines[14]!, /^ RECORDS$/);
        assert.match(lines[15]!, /^  NAME\s+STATUS\s+INDEXES$/);
        assert.match(lines[16]!, /^  orders\s+○ migrate · 2 steps · waiting\s+by_customer$/);
        assert.match(lines[17]!, /^  audit\s+○ mint · waiting\s+—$/);
        assert.doesNotMatch(mounted.frame(), /NOTHING DEPLOYED|not deployed/i);
        mounted.unmount();

        // A redeploy over a workspace deployed before, its files in and a record migrating.
        const inFiles = ['sales', 'calendar', 'stock', 'prices', 'legacy', 'extra'].map((name, i) => file(name, variant('done', variant('carried', null)), [10, 2, 8, 6, 4, 2][i]!, [10, 2, 8, 6, 4, 2][i]!));
        mounted = await mountApp({ view: dashboardView(), actions: [...fixture(), { type: 'data/lock', ws: 'main', lock: deploying(inFiles, [
            orders(variant('migrating', { name: 'by_title', step: 2n, steps: 2n })),
            audit(variant('done', null)),
        ]) }] });
        lines = mounted.lines();
        assert.match(lines[2]!, /^ main\s+● DEPLOYED · demand@1\.4\.2 · deployed 3d ago · ◔ DEPLOYING · demand@1\.5\.0 · pid 4242 · started 12s ago$/);
        assert.match(lines[3]!, /^ DEPLOY\s+◔ MIGRATING · took in 6 files · 32 MB$/);
        assert.match(lines[16]!, /^  orders\s+◔ migrating · by_title · 2 of 2\s+by_customer$/);
        assert.match(lines[17]!, /^  audit\s+● minted\s+—$/);
    });

    test('a long column scrolls under the fixed title, with a scrollbar', async () => {
        const many = fixture();
        const status = (many[2] as Extract<Action, { type: 'data/status' }>).result;
        const tasks = Array.from({ length: 40 }, (_, i) => task(`task${String(i).padStart(2, '0')}`, variant('ready', null), [], []));
        const bigger = { ...status, tasks, datasets: status.datasets.filter(ds => !ds.isTaskOutput), summary: { ...status.summary, tasks: { total: 40n, upToDate: 0n, ready: 40n, waiting: 0n, inProgress: 0n, failed: 0n, error: 0n, staleRunning: 0n } } };
        many[2] = { type: 'data/status', ws: 'main', result: bigger as never, at: NOW - 400 };
        mounted = await mountApp({ view: dashboardView(), actions: [...many, { type: 'data/execution', ws: 'main', state: null, events: [], startedAt: null }] });
        let lines = mounted.lines();
        assert.match(lines[2]!, /^ main\s+● DEPLOYED/);
        assert.match(lines[6]!, /^ ▁{40}  0 of 40 accounted/);
        assert.match(lines[3]!, /▲$/);
        assert.match(lines[31]!, /▼$/);
        assert.match(lines[12]!, /^ ▌task00/);
        await mounted.press('G');
        lines = mounted.lines();
        assert.match(lines[2]!, /^ main\s+● DEPLOYED/, 'the title stays');
        assert.match(lines[31]!, /^ ▌overrides.*▼$/);
        assert.doesNotMatch(mounted.frame(), /TASKS 40/);
        await mounted.press('g');
        await mounted.press('g');
        assert.match(mounted.lines()[3]!, /^ TASKS 40/);
    });

    test('at 80 columns the counts stack and the tasks table drops its secondary columns', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture(), size: { columns: 80, rows: 30 } });
        const lines = mounted.lines();
        assert.match(lines[3]!, /^ TASKS 6\s+▲$/);
        assert.match(lines[6]!, /^ DATASETS 10\s+[│█]$/);
        assert.match(lines[9]!, /^ ✗▁▃▇▇▇  5 of 6 accounted\s+[│█]$/);
        assert.match(lines[15]!, /^  NAME\s+STATUS\s+DEPENDS ON\s+OUTPUT\s+SIZE · LAST RUN/);
        assert.doesNotMatch(lines[15]!, /INPUTS|PEAK/);
        assert.match(lines[16]!, /^  ingest\s+● up-to-date\s+—\s+Array<Struct>\s+12\.1 MB · 3\.1s/);
    });
});

describe('dashboard model', () => {
    test('latestPerTask keeps one event per task in first-seen order, and a unit\'s requeue stands for no task', () => {
        const events = [
            variant('start', { task: 'a', timestamp: 't1' }),
            variant('start', { task: 'b', timestamp: 't2' }),
            variant('complete', { task: 'a', timestamp: 't3', duration: 1_000, peakBytes: none }),
            variant('requeued', { task: 'b', timestamp: 't4', unit: { merge: none, index: 0n, units: 2n }, reason: variant('cap', null), peak: 1n, reserves: 1n }),
        ] as never[];
        assert.deepEqual(latestPerTask(events).map(e => `${e.value.task}:${e.type}`), ['a:complete', 'b:start']);
    });

    test('liveRows: a task waiting whole shows its wait in place of its start, a split task\'s merges name their level, a unit requeued twice shows its latest', () => {
        const merge = { merge: some({ level: 1n, levels: 2n }), index: 1n, units: 2n };
        const execution = {
            state: {
                status: variant('running', null), startedAt: iso(20_000), completedAt: none, summary: none, events: [], nextSeq: 4n,
                budget: some({ cores: 2n, memory: BigInt(4 * GB), coresInUse: 2n, memoryInUse: BigInt(3 * GB) }),
                waiting: [{ task: 'b', unit: none, needs: 0n, since: iso(5_000) }],
                splits: [{ task: 'a', merge: some({ level: 1n, levels: 2n }), done: 1n, units: 2n }],
            },
            events: [
                variant('start', { task: 'a', timestamp: iso(20_000) }),
                variant('requeued', { task: 'a', timestamp: iso(15_000), unit: merge, reason: variant('cap', null), peak: BigInt(GB), reserves: BigInt(1.5 * GB) }),
                variant('start', { task: 'b', timestamp: iso(6_000) }),
                variant('requeued', { task: 'a', timestamp: iso(3_000), unit: merge, reason: variant('machine', null), peak: BigInt(2 * GB), reserves: BigInt(2 * GB) }),
            ],
            startedAt: iso(20_000),
            settling: false,
            stopping: false,
        } as never as ExecutionData;
        const rows = liveRows(execution, latestPerTask(execution.events), UNICODE);
        assert.deepEqual(rows.map(r => [r.cell.word, r.task, r.place, r.cell.detail, r.running]), [
            ['start', 'a', 'level 1 of 2 · 1 of 2 merges', '', true],
            ['waiting', 'b', '', 'needs a core · 2 of 2 in use', false],
            ['requeued', 'a', 'merge 2 of 2 · level 1 of 2', 'machine low at 2 GB', false],
        ]);
    });

    const dctxOf = (state: TuiState): DashboardCtx => ({ g: UNICODE, now: NOW, columns: state.size.columns, bp: breakpoint(state.size), spinner: 0 });

    test('the model is cached on the data, the size and the breakpoint — not the selection, the clock or the spinner', () => {
        const store = createStore(initialState({ columns: 120, rows: 36 }, './demo-repo'));
        store.dispatch({ type: 'view/root', view: dashboardView() });
        for (const action of fixture()) store.dispatch(action);
        const s1 = store.getState();
        const m1 = dashboardModel(s1, 'main', dctxOf(s1));
        assert.equal(dashboardModel(s1, 'main', dctxOf(s1)), m1, 'the same state hits');
        assert.equal(dashboardModel(s1, 'main', { ...dctxOf(s1), now: NOW + 5_000, spinner: 7 }), m1, 'the clock and the spinner restyle lines, they do not rebuild');
        store.dispatch({ type: 'view/set', view: { kind: 'dashboard', ws: 'main', list: { sel: 4, top: 3 } } });
        const s2 = store.getState();
        assert.equal(dashboardModel(s2, 'main', dctxOf(s2)), m1, 'a selection move hits');
        // Each data feed rebuilds once.
        const status = s2.data.status['main']!.result;
        store.dispatch({ type: 'data/status', ws: 'main', result: { ...status }, at: NOW + 1_000 });
        const m2 = dashboardModel(store.getState(), 'main', dctxOf(store.getState()));
        assert.notEqual(m2, m1, 'a new status rebuilds');
        assert.equal(dashboardModel(store.getState(), 'main', dctxOf(store.getState())), m2);
        const execution = store.getState().data.execution['main']!;
        store.dispatch({ type: 'data/execution', ws: 'main', state: execution.state, events: [...execution.events], startedAt: execution.startedAt });
        const m3 = dashboardModel(store.getState(), 'main', dctxOf(store.getState()));
        assert.notEqual(m3, m2, 'a new execution rebuilds');
        store.dispatch({ type: 'data/datasets', ws: 'main', entries: [...store.getState().data.datasets['main']!] });
        const m4 = dashboardModel(store.getState(), 'main', dctxOf(store.getState()));
        assert.notEqual(m4, m3, 'a new dataset list rebuilds');
        store.dispatch({ type: 'data/taskList', ws: 'main', tasks: [...store.getState().data.taskList['main']!] });
        const m5 = dashboardModel(store.getState(), 'main', dctxOf(store.getState()));
        assert.notEqual(m5, m4, 'a new task list rebuilds');
        store.dispatch({ type: 'size', size: { columns: 80, rows: 30 } });
        const s6 = store.getState();
        const m6 = dashboardModel(s6, 'main', dctxOf(s6));
        assert.notEqual(m6, m5, 'a new size and breakpoint rebuild');
        assert.ok(m6.taskPlan.every(c => c.key !== 'inputs'), 'the medium plan drops INPUTS');
        assert.deepEqual(m6.rows.map(r => `${r.kind}:${r.name}`), m1.rows.map(r => `${r.kind}:${r.name}`), 'the rows are the same');
    });

    test('the window renders only the lines on screen of a large workspace', () => {
        const store = createStore(initialState({ columns: 120, rows: 40 }, './demo-repo'));
        store.dispatch({ type: 'view/root', view: dashboardView() });
        for (const action of dashboardFixture(250, 50, NOW)) store.dispatch(action);
        const state = store.getState();
        const model = dashboardModel(state, 'main', dctxOf(state));
        assert.equal(model.rows.filter(r => r.kind === 'task').length, 250);
        assert.equal(model.rows.filter(r => r.kind === 'input').length, 50);
        assert.equal(model.rows.filter(r => r.kind === 'logs').length, 6, 'the panel lists at most six failures');
        assert.ok(model.total > 300);
        const window = dashboardLines(model, dctxOf(state), 100, 120, 30);
        assert.equal(window.length, 30);
        assert.equal(dashboardLines(model, dctxOf(state), 0, model.total - 5, 30).length, 5, 'the column ends first');
        const selectedLine = model.rows[100]!.line;
        const shown = dashboardLines(model, dctxOf(state), 100, selectedLine, 1)[0]!;
        assert.equal(shown[1]!.text, '▌', 'the selected row carries the bar');
        assert.match(shown.map(s => s.text).join(''), /task_9[0-9]|task_1\d\d/);
    });

    test('accountedBar sorts low to high, marks failures, samples past 40 tasks', () => {
        const mk = (type: string) => task('x', variant(type, null), [], []) as never;
        const { bar, accounted, total } = accountedBar([mk('up-to-date'), mk('ready'), mk('failed'), mk('waiting'), mk('in-progress')], UNICODE);
        assert.equal(bar.map(s => s.text).join(''), '✗▁▃▅▇');
        assert.equal(accounted, 4);
        assert.equal(total, 5);
        const big = accountedBar(Array.from({ length: 100 }, (_, i) => mk(i < 50 ? 'ready' : 'up-to-date')), UNICODE);
        assert.equal(big.bar.length, 40);
        assert.equal(big.bar.map(s => s.text).join(''), '▁'.repeat(20) + '▇'.repeat(20));
    });
});
