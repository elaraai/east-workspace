/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the dashboard (mocks S05, S06, S18): the counts and the
 * accounted bar, the execution panel in its states, the tasks and inputs
 * tables, `⏎` on each row kind, scrolling a long column, and the narrow
 * layout.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, DictType, FloatType, StringType, StructType, none, some, toEastTypeValue, variant } from '@elaraai/east';
import type { Action } from '../../state/actions.js';
import { KEY, NOW, dashboardView, mountApp, type Mounted } from '../../testing/harness.js';
import { accountedBar, latestPerTask } from './dashboard.js';
import { UNICODE } from '../../render/glyphs.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

/** A task of the status result. */
const task = (name: string, status: unknown, dependsOn: string[], inputs: string[]) =>
    ({ name, hash: `hash-${name}`, status, inputs, output: `.tasks.${name}.output`, dependsOn });

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

/** The mock's six tasks and four inputs, with `forecast` optionally in progress. */
function fixture(options: { running?: boolean } = {}): Action[] {
    const running = options.running === true;
    const tasks = [
        task('ingest', variant('up-to-date', { cached: false }), [], ['.inputs.sales', '.inputs.calendar']),
        task('features', variant('up-to-date', { cached: false }), ['ingest'], ['.inputs.params', '.tasks.ingest.output']),
        task('forecast', running ? variant('in-progress', { pid: some(4242n), startedAt: some(iso(9_000)) }) : variant('up-to-date', { cached: true }), ['features'], ['.tasks.features.output']),
        task('optimise', variant('waiting', { reason: 'Waiting for task \'forecast\'' }), ['forecast'], ['.inputs.overrides']),
        task('report', variant('failed', { exitCode: 2n, completedAt: none }), ['forecast', 'optimise'], []),
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
        // The server lists a function task's subtree as one leaf at `.tasks.<name>`; a custom task's
        // subtree is walked, so its output is listed at `.tasks.<name>.output` — both must resolve.
        entry('tasks.ingest', rowsType, 12_687_000, 'out-ingest'),
        entry('tasks.features', paramsType, 432_600_000, 'out-features'),
        entry('tasks.forecast', forecastType, 88_300_000, 'out-forecast'),
        entry('tasks.optimise', rowsType, null, null),
        entry('tasks.report.output', toEastTypeValue(StringType), null, null),
        entry('tasks.dashboard', paramsType, 41_984, 'out-dashboard'),
    ];
    const execution = running
        ? {
            state: { status: variant('running', null), startedAt: iso(12_000), completedAt: none, summary: none, events: [], totalEvents: 5n },
            events: [
                variant('cached', { task: 'ingest', timestamp: iso(12_000) }),
                variant('start', { task: 'features', timestamp: iso(12_000) }),
                variant('complete', { task: 'features', timestamp: iso(11_000), duration: 4_200 }),
                variant('start', { task: 'forecast', timestamp: iso(9_000) }),
                variant('input_unavailable', { task: 'optimise', timestamp: iso(9_000), reason: 'waiting on forecast' }),
            ],
            startedAt: iso(12_000),
        }
        : {
            state: { status: variant('failed', null), startedAt: iso(120_000), completedAt: some(iso(81_600)), summary: some({ executed: 4n, cached: 1n, failed: 1n, skipped: 0n, duration: 38_400 }), events: [], totalEvents: 8n },
            events: [
                variant('start', { task: 'ingest', timestamp: iso(120_000) }),
                variant('complete', { task: 'ingest', timestamp: iso(116_900), duration: 3_100 }),
                variant('start', { task: 'features', timestamp: iso(116_900) }),
                variant('complete', { task: 'features', timestamp: iso(104_900), duration: 12_000 }),
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
        { type: 'data/taskList', ws: 'main', tasks: tasks.map(t => ({ name: t.name, hash: t.hash, kind: t.name === 'dashboard' ? some('ui') : none })) as never },
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
        assert.match(lines[12]!, /^  NAME\s+STATUS\s+DEPENDS ON\s+INPUTS\s+OUTPUT\s+SIZE · LAST RUN$/);
        assert.match(lines[13]!, /^  ingest\s+● up-to-date\s+—\s+sales, calendar\s+Array<Struct>\s+12\.1 MB · 3\.1s$/);
        assert.match(lines[14]!, /^  features\s+● up-to-date\s+ingest\s+params\s+Struct\s+412\.6 MB · 12\.0s$/);
        assert.match(lines[15]!, /^  forecast\s+● up-to-date\s+features\s+—\s+Dict<String, Struct>\s+84\.2 MB · cached$/);
        assert.match(lines[16]!, /^  optimise\s+◐ waiting\s+forecast\s+overrides\s+Array<Struct>\s+— · waiting for task/);
        assert.match(lines[17]!, /^  report\s+✗ failed · exit 2\s+forecast, optimise\s+—\s+String\s+— · 0\.8s$/);
        assert.match(lines[18]!, /^  dashboard\s+○ ready\s+—\s+sales\s+UIComponentType\s+41 KB · never$/);
        assert.equal(lines[19], '');
        assert.match(lines[20]!, /^ INPUTS$/);
        assert.match(lines[21]!, /^  NAME\s+STATUS\s+TYPE\s+SIZE\s+HASH$/);
        assert.match(lines[22]!, /^  sales\s+● up-to-date\s+Array<Struct>\s+9\.8 MB\s+9f3c1a7e2b41$/);
        assert.match(lines[23]!, /^  calendar\s+● up-to-date\s+Array<Struct>\s+2\.1 KB\s+5b0e88a1c3d7$/);
        assert.match(lines[24]!, /^  params\s+◐ stale\s+Struct\s+1\.2 KB\s+0a44e1b7c9d2$/);
        assert.match(lines[25]!, /^  overrides\s+○ unset\s+Dict<String, Float>\s+—\s+—$/);
        assert.match(lines[33]!, /^ › _\s+\/ commands · type a name to jump · \? help$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   r run   x stop   w workspaces   \/ commands\s+polled 0\.4s ago$/);
    });

    test('⏎ opens the failed task\'s logs, a task, or an input; gg / G / page keys walk the rows', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture() });
        await mounted.press(KEY.enter);
        let view = mounted.store.getState().view;
        assert.equal(view.kind, 'task');
        assert.equal(view.kind === 'task' && view.task, 'report');
        assert.equal(view.kind === 'task' && view.tab, 'logs');
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

    test('while running: the live feed, the RUNNING pill, the in-progress row, and no r run hint (S06)', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: fixture({ running: true }) });
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main\s+◔ RUNNING 3\/6 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]  ● CONNECTED$/);
        assert.match(lines[4]!, /^ ● up-to-date\s+2   ◐ waiting\s+1/);
        assert.match(lines[6]!, /^ ◔ in-progress\s+1$/);
        assert.match(lines[7]!, /^ ✗▁▃▅▇▇  5 of 6 accounted$/);
        assert.match(lines[9]!, /^ EXECUTION\s+◔ RUNNING · started 12s ago · 3 of 6 tasks · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/);
        assert.match(lines[10]!, /^   12s  ● cached      ingest$/);
        assert.match(lines[11]!, /^   11s  ● complete    features\s+4\.2s$/);
        assert.match(lines[12]!, /^    9s  ◔ start       forecast\s+[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 9s$/);
        assert.match(lines[13]!, /^    9s  ◐ waiting     optimise\s+waiting on forecast$/);
        assert.equal(lines[14], '');
        assert.match(lines[15]!, /^ TASKS$/);
        assert.match(lines[19]!, /^  forecast\s+◔ in-progress\s+features\s+—\s+Dict<String, Struct>\s+[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 9s$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   x stop   \/ commands\s+polled 0\.4s ago$/);
        // No failure rows while running: the first selectable row is the first task.
        assert.match(lines[17]!, /^ ▌ingest/);
    });

    test('never run, starting, and nothing deployed', async () => {
        mounted = await mountApp({ view: dashboardView(), actions: [...fixture(), { type: 'data/execution', ws: 'main', state: null, events: [], startedAt: null }] });
        assert.match(mounted.lines()[8]!, /^ LAST EXECUTION\s+○ never run · r run$/);
        assert.match(mounted.lines()[10]!, /^ TASKS$/);
        assert.match(mounted.lines()[17]!, /^  dashboard\s+○ ready\s+.*41 KB · never$/);
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
        assert.doesNotMatch(lines[15]!, /INPUTS/);
        assert.match(lines[16]!, /^  ingest\s+● up-to-date\s+—\s+Array<Struct>\s+12\.1 MB · 3\.1s/);
    });
});

describe('dashboard model', () => {
    test('latestPerTask keeps one event per task in first-seen order', () => {
        const events = [
            variant('start', { task: 'a', timestamp: 't1' }),
            variant('start', { task: 'b', timestamp: 't2' }),
            variant('complete', { task: 'a', timestamp: 't3', duration: 1_000 }),
        ] as never[];
        assert.deepEqual(latestPerTask(events).map(e => `${e.value.task}:${e.type}`), ['a:complete', 'b:start']);
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
