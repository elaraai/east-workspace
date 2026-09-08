/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the repositories and workspaces views (mocks S03, S04)
 * and the breadcrumb / back-stack between them.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { KEY, NOW, fakeSession, mountApp, type Mounted } from '../../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const workspaces = [
    { name: 'main', deployed: true, packageName: some('demand'), packageVersion: some('1.4.2') },
    { name: 'staging', deployed: true, packageName: some('demand'), packageVersion: some('1.5.0-rc.1') },
    { name: 'scratch', deployed: false, packageName: none, packageVersion: none },
] as never;

const summary = (upToDate: number, waiting: number, failed: number, ready: number) => ({
    workspace: 'main', lock: none, datasets: [], tasks: [],
    summary: {
        datasets: { total: 10n, unset: 1n, stale: 1n, upToDate: 8n },
        tasks: { total: BigInt(upToDate + waiting + failed + ready), upToDate: BigInt(upToDate), ready: BigInt(ready), waiting: BigInt(waiting), inProgress: 0n, failed: BigInt(failed), error: 0n, staleRunning: 0n },
    },
}) as never;

describe('the repositories view', () => {
    test('lists repositories with their counts and last deployment, and ⏎ binds one', async () => {
        mounted = await mountApp({
            session: fakeSession({ kind: 'origin', label: 'e3.example.com', repo: null, origin: 'https://e3.example.com', apiUrl: 'https://e3.example.com', identity: 'cm@elara.ai', path: null }),
            view: { kind: 'repos', list: { sel: 0, top: 0 } },
            actions: [
                { type: 'data/repos', names: ['demo', 'forecasting', 'sandbox'] },
                { type: 'data/repoStatus', repo: 'demo', status: { path: '/srv/demo', objectCount: 12408n, packageCount: 2n, workspaceCount: 3n } },
                { type: 'data/repoDeploy', repo: 'demo', deploy: { workspace: 'main', packageName: 'demand', packageVersion: '1.4.2', deployedAt: new Date(NOW - 3 * 86_400_000) } },
                { type: 'data/repoStatus', repo: 'forecasting', status: { path: '/srv/f', objectCount: 3102n, packageCount: 1n, workspaceCount: 1n } },
                { type: 'data/repoDeploy', repo: 'forecasting', deploy: { workspace: 'main', packageName: 'fc', packageVersion: '0.1.0', deployedAt: new Date(NOW - 12 * 86_400_000) } },
                { type: 'data/repoStatus', repo: 'sandbox', status: { path: '/srv/s', objectCount: 0n, packageCount: 0n, workspaceCount: 0n } },
                { type: 'data/repoDeploy', repo: 'sandbox', deploy: null },
            ],
        });
        const lines = mounted.lines();
        assert.match(lines[0]!, /^ e3-ui  e3\.example\.com\s+● CONNECTED$/);
        assert.match(lines[2]!, /^ REPOSITORIES · https:\/\/e3\.example\.com\s+signed in as cm@elara\.ai · 3 of 3$/);
        assert.match(lines[4]!, /^  NAME\s+WORKSPACES\s+PACKAGES\s+OBJECTS\s+LAST DEPLOY/);
        assert.match(lines[5]!, /^ ▌demo\s+3\s+2\s+12,408\s+3d ago · demand@1\.4\.2 → main/);
        assert.match(lines[6]!, /^  forecasting\s+1\s+1\s+3,102\s+12d ago · fc@0\.1\.0 → main/);
        assert.match(lines[7]!, /^  sandbox\s+0\s+0\s+0\s+—/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   \/repo <name>   \/login\s+q quit$/);
        await mounted.press(KEY.down);
        assert.match(mounted.lines()[6]!, /^ ▌forecasting/);
        await mounted.press(KEY.enter);
        assert.deepEqual(mounted.opened, ['https://e3.example.com/repos/forecasting']);
        await mounted.type('/repo sandbox');
        await mounted.press(KEY.enter);
        assert.deepEqual(mounted.opened, ['https://e3.example.com/repos/forecasting', 'sandbox']);
    });
});

describe('the workspaces view', () => {
    test('lists workspaces with state, package, task summary and last run, and ⏎ opens one', async () => {
        mounted = await mountApp({
            view: { kind: 'workspaces', list: { sel: 0, top: 0 } },
            actions: [
                { type: 'data/workspaces', workspaces },
                { type: 'data/status', ws: 'main', result: summary(4, 1, 1, 0), at: NOW },
                { type: 'data/execution', ws: 'main', state: { status: variant('failed', null), startedAt: new Date(NOW - 2 * 60_000).toISOString(), completedAt: none, summary: some({ executed: 4n, cached: 1n, failed: 1n, skipped: 0n, duration: 38.4 }), events: [], totalEvents: 0n } as never, events: [], startedAt: 'x' },
                { type: 'data/status', ws: 'staging', result: summary(0, 0, 0, 6), at: NOW },
                { type: 'data/execution', ws: 'staging', state: null, events: [], startedAt: null },
            ],
        });
        const lines = mounted.lines();
        assert.match(lines[2]!, /^ WORKSPACES · demo-repo\s+3 of 3$/);
        assert.match(lines[4]!, /^  NAME\s+STATE\s+PACKAGE\s+TASKS\s+LAST RUN/);
        assert.match(lines[5]!, /^ ▌main\s+● DEPLOYED\s+demand@1\.4\.2\s+● 4  ◐ 1  ✗ 1\s+✗ failed · 2m ago · 38\.4s/);
        assert.match(lines[6]!, /^  staging\s+● DEPLOYED\s+demand@1\.5\.0-rc\.1\s+○ 6 ready\s+○ never run/);
        assert.match(lines[7]!, /^  scratch\s+○ EMPTY\s+—\s+—\s+—/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   \/workspace <name>\s+q quit$/);
        await mounted.press('j');
        await mounted.press(KEY.enter);
        assert.equal(mounted.store.getState().view.kind, 'dashboard');
        assert.match(mounted.lines()[0]!, /^ e3-ui  demo-repo › staging/);
        // The dashboard is the new root: back does not return to the list.
        assert.equal(mounted.store.getState().history.length, 0);
        await mounted.press('w');
        assert.match(mounted.lines()[33]!, /^ › \/workspaces_/);
        await mounted.press(KEY.enter);
        assert.equal(mounted.store.getState().view.kind, 'workspaces');
        await mounted.press(KEY.escape);
        assert.equal(mounted.store.getState().view.kind, 'dashboard');
    });

    test('/workspace switches, an unknown name toasts', async () => {
        mounted = await mountApp({ view: { kind: 'workspaces', list: { sel: 0, top: 0 } }, actions: [{ type: 'data/workspaces', workspaces }] });
        await mounted.type('/workspace nope');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /no workspace nope/);
        await mounted.type('/workspace staging');
        await mounted.press(KEY.enter);
        assert.equal(mounted.store.getState().view.kind, 'dashboard');
    });
});
