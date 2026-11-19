/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for a load's page (east-workspace#1465, ruling 41): the load of
 * a composite record's source, opened by the name it has as a step of a run,
 * has its logs and its runs as a task has, read through the same calls, and
 * no output of its own.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { fakeRepo } from '../../api.fake.js';
import { taskView } from '../../state/actions.js';
import { mountApp, type Mounted } from '../../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

describe('R77 — a load\'s page', () => {
    test('a load opened by its step\'s name shows its logs and its runs, no output tab, and the record it writes', async () => {
        const api = fakeRepo();
        api.task('main', { name: 'ingest', status: variant('up-to-date', { cached: false }), inputs: [], dependsOn: [] });
        api.workspace('main').loads = [{
            record: 'orders', source: 'erp', feed: '.tasks.ingest.output',
            logs: { stdout: 'loading 2 orders\n', stderr: 'the ERP sent order SO-9, which no order book holds\n' },
        }];
        mounted = await mountApp({ api, feeds: true, view: taskView('main', 'orders.erp', 'stdout') });
        await mounted.waitFor(() => mounted!.frame().includes('loading 2 orders') && /1 Stdout/.test(mounted!.lines()[2] ?? ''));
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  demo-repo › main › orders\.erp\s+● CONNECTED$/);
        // Its logs first, then its runs: what it writes is its record, which has a page of its own
        assert.match(lines[2]!, /^ orders\.erp   ▌1 Stdout▐  2 Stderr( \(1\))?   3 Runs\s+LOAD · /);
        assert.doesNotMatch(lines[2]!, /Output/);
        assert.match(lines[3]!, /^ \.records\.orders$/);

        await mounted.press('2');
        await mounted.waitFor(() => mounted!.frame().includes('which no order book holds'));
        assert.match(mounted.lines()[2]!, /^ orders\.erp    1 Stdout  ▌2 Stderr \(1\)▐  3 Runs\s+LOAD · /);
        // Read by the load's step name, through the calls that read a task's
        assert.ok(api.calls.includes('taskLogs main.orders.erp stdout 0') && api.calls.includes('taskLogs main.orders.erp stderr 0'), api.calls.join('\n'));
        assert.ok(api.calls.includes('taskGet main.orders.erp') && api.calls.includes('taskExecutionList main.orders.erp'), api.calls.join('\n'));
    });
});
