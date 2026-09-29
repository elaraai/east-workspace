/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Feed specs — which pollers a view mounts, the execution event cursor,
 * the repositories view's lazy facts, the workspaces view's summaries, and
 * what holds a workspace a first deploy is deploying, all over the in-memory
 * API and fake timers.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { none, variant } from '@elaraai/east';
import { fakeRepo } from '../api.fake.js';
import { createFeeds } from './feeds.js';
import { initialState } from '../state/actions.js';
import { createStore } from '../state/store.js';
import type { PollClock } from '../state/poll.js';

function fakeClock(): PollClock & { advance(ms: number): Promise<void> } {
    let now = 1_000_000;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
        now: () => now,
        setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimeout(handle) { timers.delete(handle as number); },
        async advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (due === undefined) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].fn();
                for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
            }
            now = target;
        },
    };
}

const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
};

const session = { kind: 'local' as const, label: 'demo-repo', repo: 'default', apiUrl: 'http://x', path: '/x', origin: null, identity: null, stateKey: '/x', target: '/x' };

describe('feeds', () => {
    test('the dashboard mounts status, execution, datasets, task list, workspace state, the budget and the workspace list', async () => {
        const api = fakeRepo();
        api.task('main', { name: 'left', status: variant('ready', null), inputs: ['.inputs.a'], dependsOn: [] });
        api.input('main', { name: 'a', type: { type: 'Integer', value: null } as never, value: 1n });
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        store.dispatch({ type: 'view/root', view: { kind: 'dashboard', ws: 'main', list: { sel: 0, top: 0 } } });
        const clock = fakeClock();
        const feeds = createFeeds({ store, api: () => api, clock });
        feeds.start();
        await settle();
        assert.deepEqual(feeds.pollers().map(p => p.status().key).sort(), ['budget:main', 'datasets:main', 'execution:main', 'status:main', 'taskList:main', 'workspaceState:main', 'workspaces']);
        const state = store.getState();
        assert.equal(state.data.status['main']?.result.tasks[0]?.name, 'left');
        assert.equal(state.data.workspaces?.[0]?.name, 'main');
        assert.equal(state.data.datasets['main']?.length, 2);
        assert.equal(state.data.execution['main']?.state, null);
        assert.equal(state.connection.kind, 'connected');
        // fire() polls one feed now; unknown keys are ignored.
        const before = api.calls.length;
        feeds.fire('status:main');
        feeds.fire('nothing:here');
        await settle();
        assert.deepEqual(api.calls.slice(before), ['workspaceStatus main']);
        // Leaving the workspace stops its feeds.
        store.dispatch({ type: 'view/root', view: { kind: 'help', tab: 'everywhere' } });
        assert.deepEqual(feeds.pollers().map(p => p.status().key), ['workspaces']);
        feeds.stop();
        assert.deepEqual(feeds.pollers(), []);
    });

    test('the execution cursor accumulates events and resets on a new run', async () => {
        const api = fakeRepo();
        api.workspace('main');
        api.task('main', { name: 'a', status: variant('ready', null), inputs: [], dependsOn: [] });
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        store.dispatch({ type: 'view/root', view: { kind: 'dashboard', ws: 'main', list: { sel: 0, top: 0 } } });
        const clock = fakeClock();
        const feeds = createFeeds({ store, api: () => api, clock });
        feeds.start();
        await settle();
        api.run({ events: [variant('start', { task: 'a', timestamp: 't' }), variant('complete', { task: 'a', timestamp: 't', duration: 1_500, peakBytes: none })], final: 'completed' });
        await api.dataflowExecuteLaunch('main');
        feeds.refresh();
        await settle();
        let execution = store.getState().data.execution['main']!;
        assert.equal(execution.state?.status.type, 'completed');
        assert.equal(execution.events.length, 2);
        const polls = api.calls.filter(c => c.startsWith('dataflowExecutePoll'));
        assert.ok(polls.some(c => c.endsWith(' 0')), 'the first poll starts at offset 0');
        // The next poll asks from the cursor and adds nothing.
        await clock.advance(5_000);
        assert.ok(api.calls.filter(c => c.startsWith('dataflowExecutePoll')).some(c => c.endsWith(' 2')), 'polls continue from the cursor');
        execution = store.getState().data.execution['main']!;
        assert.equal(execution.events.length, 2);
        // A new run resets the cursor: its events restart at 0.
        api.run({ events: [variant('cached', { task: 'a', timestamp: 't2' })], final: 'completed' });
        await api.dataflowExecuteLaunch('main');
        await clock.advance(5_000);
        execution = store.getState().data.execution['main']!;
        assert.equal(execution.events.length, 1);
        assert.equal(execution.events[0]?.type, 'cached');
        feeds.stop();
    });

    test('the repositories view fetches each repository\'s counts and last deployment lazily', async () => {
        const api = fakeRepo();
        api.workspace('main');
        api.repos['sandbox'] = { path: '/fake/sandbox', objectCount: 0n, packageCount: 0n, workspaces: [] };
        const store = createStore(initialState({ columns: 120, rows: 36 }, 'https://h'));
        store.dispatch({ type: 'session', session: { ...session, kind: 'origin', repo: null, origin: 'https://h', label: 'h' } });
        store.dispatch({ type: 'view/root', view: { kind: 'repos', list: { sel: 0, top: 0 } } });
        const feeds = createFeeds({ store, api: () => api, clock: fakeClock() });
        feeds.start();
        await settle();
        await settle();
        const repos = store.getState().data.repos!;
        assert.deepEqual(repos.names, ['default', 'sandbox']);
        assert.equal(repos.status['default']?.workspaceCount, 1n);
        assert.equal(repos.deploy['default']?.workspace, 'main');
        assert.equal(repos.deploy['default']?.packageName, 'demand');
        assert.equal(repos.deploy['sandbox'], null);
        feeds.stop();
    });

    test('the workspaces view polls each workspace\'s summary, state and last run one at a time', async () => {
        const api = fakeRepo();
        api.task('main', { name: 'a', status: variant('up-to-date', { cached: false }), inputs: [], dependsOn: [] });
        api.workspace('scratch', { packageName: undefined, packageVersion: undefined });
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        store.dispatch({ type: 'view/root', view: { kind: 'workspaces', list: { sel: 0, top: 0 } } });
        const feeds = createFeeds({ store, api: () => api, clock: fakeClock() });
        feeds.start();
        await settle();
        await settle();
        const state = store.getState();
        assert.equal(state.data.workspaces?.length, 2);
        assert.equal(state.data.status['main']?.result.summary.tasks.upToDate, 1n);
        assert.equal(state.data.workspaceState['main']?.packageName, 'demand');
        assert.equal(state.data.execution['main']?.state, null);
        assert.equal(state.data.workspaceState['scratch'], null);
        feeds.stop();
    });

    test('a workspace nothing is deployed to yet is no error: its status feed reads what holds it, as a first deploy does', async () => {
        const api = fakeRepo();
        const deploying = {
            state: { operation: variant('deployment', null), holder: variant('process', { pid: 4242n, bootId: 'boot', startTime: 1n, command: 'e3 workspace deploy' }), acquiredAt: new Date(0), expiresAt: none },
            progress: none,
        };
        api.workspace('scratch', { packageName: undefined, packageVersion: undefined, lockStatus: deploying as never });
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        store.dispatch({ type: 'view/root', view: { kind: 'dashboard', ws: 'scratch', list: { sel: 0, top: 0 } } });
        const feeds = createFeeds({ store, api: () => api, clock: fakeClock() });
        feeds.start();
        await settle();
        let state = store.getState();
        assert.equal(state.data.statusError['scratch'], undefined, 'nothing deployed is not a status error');
        assert.equal(state.data.workspaceState['scratch'], null);
        assert.equal(state.data.lock['scratch'], deploying);
        assert.equal(state.connection.kind, 'connected', 'no status, tasks or datasets to read yet is no failed feed');
        // The deploy lets go: nothing holds the workspace, and what the title,
        // the tasks and the inputs show is read again at once, not on its next turn.
        api.workspace('scratch').lockStatus = undefined;
        const before = api.calls.length;
        feeds.fire('status:scratch');
        await settle();
        state = store.getState();
        assert.equal(state.data.lock['scratch'], null);
        assert.deepEqual(api.calls.slice(before).sort(), [
            'datasetList scratch', 'taskList scratch', 'workspaceGet scratch', 'workspaceList', 'workspaceLock scratch', 'workspaceStatus scratch',
        ]);
        feeds.stop();
    });

    test('a first deploy that begins and ends between two looks still has the title, the tasks and the inputs read again at once', async () => {
        const api = fakeRepo();
        api.workspace('scratch', { packageName: undefined, packageVersion: undefined });
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        store.dispatch({ type: 'view/root', view: { kind: 'dashboard', ws: 'scratch', list: { sel: 0, top: 0 } } });
        const feeds = createFeeds({ store, api: () => api, clock: fakeClock() });
        feeds.start();
        await settle();
        assert.equal(store.getState().data.workspaceState['scratch'], null);
        // The whole deploy lands between two looks: no lock is ever seen.
        Object.assign(api.workspace('scratch'), { packageName: 'demand', packageVersion: '1.5.0' });
        const before = api.calls.length;
        feeds.fire('status:scratch');
        await settle();
        assert.deepEqual(api.calls.slice(before).sort(), ['datasetList scratch', 'taskList scratch', 'workspaceGet scratch', 'workspaceList', 'workspaceStatus scratch']);
        assert.equal(store.getState().data.workspaceState['scratch']?.packageVersion, '1.5.0');
        // Once seen deployed, a status reads nothing more.
        const after = api.calls.length;
        feeds.fire('status:scratch');
        await settle();
        assert.deepEqual(api.calls.slice(after), ['workspaceStatus scratch']);
        feeds.stop();
    });
});
