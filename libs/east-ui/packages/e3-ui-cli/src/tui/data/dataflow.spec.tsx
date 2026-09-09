/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `/run` and `/stop` through the command box (mocks S06b, S18): the flag
 * hint row and the consequence line, the launch call with its options, the
 * started toast, the settling / running / stopping pills, the double-⏎
 * guard, the locked-workspace and remote-caveat toasts.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { fakeRepo, type FakeApi } from '../api.fake.js';
import type { Action } from '../state/actions.js';
import { KEY, NOW, dashboardView, mountApp, type Mounted } from '../testing/harness.js';
import { launchFailureText, lockHolderText } from './dataflow.js';
import { UNICODE } from '../render/glyphs.js';
import { ApiError } from '@elaraai/e3-api-client';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const SPIN = '[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]';

/** A six-task workspace on the fake, with its status already in the store. */
async function sixTasks(api: FakeApi): Promise<Action[]> {
    for (const name of ['ingest', 'features', 'forecast', 'optimise', 'report', 'dashboard']) {
        api.task('main', { name, status: variant('ready', null), inputs: [], dependsOn: [] });
    }
    api.workspace('main').deployedAt = new Date(NOW - 3 * 86_400_000);
    return [
        { type: 'data/workspaces', workspaces: await api.workspaceList() },
        { type: 'data/workspaceState', ws: 'main', state: await api.workspaceGet('main') },
        { type: 'data/status', ws: 'main', result: await api.workspaceStatus('main'), at: NOW - 400 },
        { type: 'data/execution', ws: 'main', state: null, events: [], startedAt: null },
    ];
}

describe('/run and /stop', () => {
    test('r prefills /run with the flag hints and the consequence; ⏎ launches with the options and toasts', async () => {
        const api = fakeRepo();
        api.run({ events: [variant('start', { task: 'ingest', timestamp: new Date(NOW).toISOString() })], final: 'completed', stepMs: 600_000 });
        mounted = await mountApp({ api, view: dashboardView(), actions: await sixTasks(api) });
        await mounted.press('r');
        let lines = mounted.lines();
        assert.match(lines[33]!, /^ › \/run _\s+run 6 tasks in main · concurrency 4\s+⏎ run · esc/);
        assert.match(lines[35]!, /^ --force  re-run everything    --filter <glob>  only matching tasks    --concurrency <n>$/);
        await mounted.type('--force --concurrency 2');
        assert.match(mounted.lines()[33]!, /^ › \/run --force --concurrency 2_\s+run 6 tasks in main, ignoring the cache · concurrency 2\s+⏎ run · esc/);
        await mounted.press(KEY.enter);
        assert.ok(api.calls.includes('dataflowExecuteLaunch main --force --concurrency 2'), api.calls.join('\n'));
        lines = mounted.lines();
        assert.match(lines[33]!, /^ ›  ● Dataflow started · main · 6 tasks queued$/);
        assert.match(lines[0]!, new RegExp(`◔ RUNNING 0/6 ${SPIN}  ● CONNECTED$`));
        assert.match(lines[8]!, new RegExp(`^ EXECUTION\\s+◔ STARTING · ${SPIN}$`));
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   x stop   \/ commands/);
        // Settling: a second ⏎ cannot start another run.
        const launches = api.calls.filter(c => c.startsWith('dataflowExecuteLaunch')).length;
        await mounted.press('r');
        assert.match(mounted.lines()[33]!, /a run is already in progress\s+esc/);
        await mounted.press(KEY.enter);
        assert.equal(api.calls.filter(c => c.startsWith('dataflowExecuteLaunch')).length, launches);
        assert.match(mounted.lines()[33]!, /^ ›  ◐ a run is already in progress — \/stop first$/);
        // The poll shows it running: settling clears, the pill counts events.
        const polled = await api.dataflowExecutePoll('main', 0);
        await mounted.dispatch({ type: 'data/execution', ws: 'main', state: polled, events: [...polled.events], startedAt: polled.startedAt });
        assert.equal(mounted.store.getState().data.execution['main']?.settling, false);
        lines = mounted.lines();
        assert.match(lines[0]!, new RegExp(`◔ RUNNING 0/6 ${SPIN}  ● CONNECTED$`));
        assert.match(lines[8]!, new RegExp(`^ EXECUTION\\s+◔ RUNNING · started just now · 0 of 6 tasks · ${SPIN}$`));
        // x → /stop → dataflowCancel, the cancelled toast, the STOPPING pill until the poll shows it stopped.
        await mounted.press('x');
        assert.match(mounted.lines()[33]!, /^ › \/stop_\s+cancel the run in main\s+⏎ stop · esc/);
        await mounted.press(KEY.enter);
        assert.ok(api.calls.includes('dataflowCancel main'));
        lines = mounted.lines();
        assert.match(lines[33]!, /^ ›  ■ Dataflow cancelled$/);
        assert.match(lines[0]!, new RegExp(`■ STOPPING ${SPIN}  ● CONNECTED$`));
        assert.match(lines[8]!, new RegExp(`^ EXECUTION\\s+■ STOPPING · started just now · 0 of 6 tasks · ${SPIN}$`));
        const stopped = await api.dataflowExecutePoll('main', 0);
        await mounted.dispatch({ type: 'data/execution', ws: 'main', state: stopped, events: [...stopped.events], startedAt: stopped.startedAt });
        lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main\s+● CONNECTED$/);
        assert.match(lines[8]!, /^ LAST EXECUTION\s+■ ABORTED · started just now · \d+\.\ds · executed 0 · cached 0 · failed 0 · skipped 0$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   r run   x stop   w workspaces/);
    });

    test('a locked workspace: the title shows the holder and /run toasts it', async () => {
        const api = fakeRepo();
        const actions = await sixTasks(api);
        api.workspace('main').lock = { pid: 4242, acquiredAt: new Date(NOW - 12_000).toISOString(), command: 'e3 dataflow run' };
        actions[2] = { type: 'data/status', ws: 'main', result: await api.workspaceStatus('main'), at: NOW - 400 };
        mounted = await mountApp({ api, view: dashboardView(), actions });
        assert.match(mounted.lines()[2]!, /^ main\s+● DEPLOYED · demand@1\.4\.2 · deployed 3d ago · lock: pid 4242 · e3 dataflow run · 12s ago$/);
        await mounted.press('r');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /^ ›  ✗ workspace main is locked by pid 4242 · e3 dataflow run · 12s ago$/);
        assert.equal(mounted.store.getState().data.execution['main']?.settling, false);
        assert.match(mounted.lines()[0]!, /^ e3-ui  demo-repo › main\s+● CONNECTED$/);
    });

    test('/stop with nothing running, and the remote caveat when the run belongs to another server', async () => {
        const api = fakeRepo();
        mounted = await mountApp({ api, view: dashboardView(), actions: await sixTasks(api) });
        await mounted.press('x');
        assert.match(mounted.lines()[33]!, /^ › \/stop_\s+no run in progress\s+esc/);
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /^ ›  ◐ no run in progress$/);
        assert.ok(!api.calls.includes('dataflowCancel main'));
        // Our poll says running, but this server process has no execution to cancel.
        const running = { status: variant('running', null), startedAt: new Date(NOW - 5_000).toISOString(), completedAt: none, summary: none, events: [], totalEvents: 0n };
        await mounted.dispatch({ type: 'data/execution', ws: 'main', state: running as never, events: [], startedAt: running.startedAt });
        await mounted.press('x');
        await mounted.press(KEY.enter);
        assert.ok(api.calls.includes('dataflowCancel main'));
        assert.match(mounted.lines()[33]!, /^ ›  ◐ nothing to cancel here — the run was started by another server process; stop it from there$/);
        assert.equal(mounted.store.getState().data.execution['main']?.stopping, false);
    });

    test('/run and /stop outside a workspace view ask for one', async () => {
        mounted = await mountApp({ view: { kind: 'workspaces', list: { sel: 0, top: 0 } } });
        await mounted.type('/run');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /open a workspace first/);
    });
});

describe('dataflow text', () => {
    test('lockHolderText and launchFailureText', () => {
        const holder = { pid: 4242n, acquiredAt: new Date(NOW - 12_000).toISOString(), command: some('e3 dataflow run') };
        assert.equal(lockHolderText(holder, NOW, UNICODE), 'pid 4242 · e3 dataflow run · 12s ago');
        assert.equal(lockHolderText({ ...holder, command: none }, NOW, UNICODE), 'pid 4242 · another process · 12s ago');
        assert.equal(launchFailureText(new ApiError('workspace_locked', { workspace: 'main', holder: variant('known', holder) }), 'main', NOW, UNICODE), 'workspace main is locked by pid 4242 · e3 dataflow run · 12s ago');
        assert.equal(launchFailureText(new ApiError('workspace_locked', { workspace: 'main', holder: variant('unknown', null) }), 'main', NOW, UNICODE), 'workspace main is locked by another process');
        assert.equal(launchFailureText(new ApiError('workspace_not_found', { workspace: 'main' }), 'main', NOW, UNICODE), 'Workspace not found: {"workspace":"main"}');
        assert.equal(launchFailureText(new Error('boom'), 'main', NOW, UNICODE), 'boom');
    });
});
