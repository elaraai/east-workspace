/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Logs loader specs — 64 KB chunking across ticks, a truncated log
 * (a new run) starting over, a task with no run, and the line helpers.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { fakeRepo } from '../api.fake.js';
import { initialState } from '../state/actions.js';
import { createStore } from '../state/store.js';
import { LOG_CHUNK, createLogsLoader, findInLines, logLines } from './logs.js';

const session = { kind: 'local' as const, label: 'demo-repo', repo: 'default', apiUrl: 'http://x', path: '/x', origin: null, identity: null, stateKey: '/x', target: '/x' };

describe('logs loader', () => {
    test('fetches a stream in 64 KB chunks and appends them; an unchanged stream dispatches nothing', async () => {
        const api = fakeRepo();
        const line = (i: number): string => `[info] line ${i} ${'x'.repeat(90)}\n`;
        const stdout = Array.from({ length: 2_000 }, (_, i) => line(i + 1)).join('');
        api.task('main', { name: 'forecast', status: variant('ready', null), inputs: [], dependsOn: [], logs: { stdout, stderr: 'warn 1\n' } });
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        const loader = createLogsLoader({ store, api: () => api });
        await loader.tick('main', 'forecast', 'stdout');
        const logs = store.getState().data.logs['main']!['forecast']!['stdout']!;
        assert.equal(logs.text, stdout);
        assert.equal(logs.offset, Buffer.byteLength(stdout));
        assert.equal(logs.complete, true);
        assert.equal(logs.capped, false);
        const chunks = api.calls.filter(c => c.startsWith('taskLogs main.forecast stdout'));
        assert.equal(chunks.length, Math.ceil(Buffer.byteLength(stdout) / LOG_CHUNK), 'one request per 64 KB chunk');
        const before = store.getState();
        await loader.tick('main', 'forecast', 'stdout');
        assert.equal(store.getState(), before, 'nothing new: no dispatch');
        await loader.tick('main', 'forecast', 'stderr');
        assert.equal(store.getState().data.logs['main']!['forecast']!['stderr']!.text, 'warn 1\n');
    });

    test('a log that shrank (a new run) starts over; a task with no run reads as empty', async () => {
        const api = fakeRepo();
        const task = api.task('main', { name: 'a', status: variant('ready', null), inputs: [], dependsOn: [], logs: { stdout: 'one\ntwo\nthree\n' } }).workspace('main').tasks.find(t => t.name === 'a')!;
        const store = createStore(initialState({ columns: 120, rows: 36 }, '/x'));
        store.dispatch({ type: 'session', session });
        const loader = createLogsLoader({ store, api: () => api });
        await loader.tick('main', 'a', 'stdout');
        assert.equal(store.getState().data.logs['main']!['a']!['stdout']!.text, 'one\ntwo\nthree\n');
        task.logs = { stdout: 'new\n' };
        await loader.tick('main', 'a', 'stdout');
        const restarted = store.getState().data.logs['main']!['a']!['stdout']!;
        assert.equal(restarted.text, 'new\n');
        assert.equal(restarted.offset, 4);
        api.task('main', { name: 'b', status: variant('ready', null), inputs: [], dependsOn: [], executions: [] });
        await loader.tick('main', 'b', 'stdout');
        const none = store.getState().data.logs['main']!['b']!['stdout']!;
        assert.equal(none.text, '');
        assert.equal(none.error, 'no run yet');
        assert.equal(none.complete, true);
    });

    test('logLines and findInLines', () => {
        assert.deepEqual(logLines(''), []);
        assert.deepEqual(logLines('a\nb\n'), ['a', 'b']);
        assert.deepEqual(logLines('a\nb'), ['a', 'b']);
        assert.deepEqual(findInLines(['Deli ok', 'other', 'deli again'], 'deli'), [0, 2]);
        assert.deepEqual(findInLines(['x'], ''), []);
    });
});
