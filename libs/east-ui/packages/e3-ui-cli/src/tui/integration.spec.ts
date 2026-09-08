/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The integration smoke — gated by `E3_UI_INTEGRATION=1`: a real embedded
 * `@elaraai/e3-api-server` over a repository seeded at test time, driven
 * through the same harness the frame specs use (no PTY): the workspaces
 * list → a dashboard → a task's output, logs and runs; a 20,000-entry
 * paged Dict input (page latency, retained pages, heap growth — design
 * §17); a real `/run`; an input edited and applied, then read back
 * through the API.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { IntegerType, decodeBeast2For } from '@elaraai/east';
import { treePathOf } from './api.js';
import { MAX_RETAINED_PAGES } from './data/dataset.js';
import { startRepoServer, type RepoServerHandle } from '../e3-server.js';
import { openSession, type Session } from './session.js';
import { KEY, mountApp, type Mounted } from './testing/harness.js';
import { seedFixtureRepo, type SeededRepo } from './testing/seed.js';

const enabled = process.env['E3_UI_INTEGRATION'] === '1';
/** Turns of the harness's `waitFor` for a dataflow run (≈ 5 ms each). */
const RUN_TURNS = 12_000;

/** A full collection, so heap growth measures retention rather than garbage. */
function collectGarbage(): void {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    gc();
    gc();
}

/** The heap in use after a full collection, in bytes. */
function heapUsed(): number {
    collectGarbage();
    return process.memoryUsage().heapUsed;
}

describe('integration (E3_UI_INTEGRATION=1)', { skip: !enabled }, () => {
    let seeded: SeededRepo;
    let server: RepoServerHandle;
    let session: Session;
    let mounted: Mounted | null = null;

    before(async () => {
        seeded = await seedFixtureRepo({ lookupEntries: 20_000 });
        server = await startRepoServer(seeded.path);
        session = await openSession(seeded.path, { startServer: async () => server });
    });
    after(async () => {
        mounted?.unmount();
        await session.stop();
        rmSync(seeded.scratch, { recursive: true, force: true });
    });

    test('workspaces → dashboard → a task\'s output, logs and runs', async () => {
        mounted = await mountApp({ api: session.api, session: session.info, feeds: true, view: { kind: 'workspaces', list: { sel: 0, top: 0 } } });
        const m = mounted;
        await m.waitFor(() => m.lines().some(l => /^ [ ▌]main\s+● DEPLOYED\s+demand@1\.4\.2/.test(l)) && /table/.test(m.frame()), 600);
        assert.match(m.lines()[2]!, /^ WORKSPACES · demo-repo\s+3 of 3$/);
        await m.type('/workspace main');
        await m.press(KEY.enter);
        await m.waitFor(() => /^ TASKS 3/.test(m.lines()[3] ?? '') && /merge/.test(m.frame()), 600);
        assert.match(m.lines()[2]!, /^ main\s+● DEPLOYED · demand@1\.4\.2 · deployed .* · lock: none$/);
        const merge = m.lines().find(l => /^\s.merge\s/.test(l)) ?? '';
        if (seeded.ran) assert.match(merge, /● up-to-date/);
        await m.type('/task merge');
        await m.press(KEY.enter);
        await m.waitFor(() => /DATA TASK/.test(m.lines()[2] ?? '') && (/^▌· Value\s+65/.test(m.lines()[5] ?? '') || /NO OUTPUT YET/.test(m.frame())), 600);
        if (seeded.ran) assert.match(m.lines()[5]!, /^▌· Value\s+65\s*$/);
        await m.press('2');
        await m.waitFor(() => /^ stdout ▾   stderr \(\d+\)/.test(m.lines()[5] ?? ''), 600);
        await m.press('3');
        await m.waitFor(() => /^  STATUS\s+STARTED/.test(m.lines()[5] ?? ''), 600);
        if (seeded.ran) await m.waitFor(() => /1 execution$/.test(m.lines()[35] ?? ''), 600);
    });

    test('a 20,000-entry Dict input pages: latency, retention, find, goto, heap (§17)', async () => {
        const m = mounted!;
        m.controller.openWorkspace('table');
        await m.waitFor(() => /lookup/.test(m.frame()), 600);
        await m.type('/input lookup');
        await m.press(KEY.enter);
        await m.waitFor(() => /^▌· k000000\s+0\b/.test(m.lines()[5] ?? ''), 1_200);
        assert.match(m.lines()[3]!, /^ \.inputs\.lookup · Dict<String, Integer> · 20,000 entries/);
        assert.match(m.lines()[35]!, /^ paged inputs are read-only here/);
        m.dropFrames();
        const heap0 = heapUsed();
        const t0 = Date.now();
        await m.type('/goto 10000');
        await m.press(KEY.enter);
        await m.waitFor(() => /^▌· k009999\s+69993\b/.test(m.lines()[7] ?? ''), 1_200);
        const latency = Date.now() - t0;
        assert.ok(latency < 2_000, `a page 10,000 rows in arrived in ${latency} ms`);
        await m.press('G');
        await m.waitFor(() => /k019999/.test(m.frame()), 1_200);
        await m.type('/find k01234');
        await m.press(KEY.enter);
        await m.waitFor(() => /^▌· k012340\s+86380\b/.test(m.lines()[7] ?? ''), 1_200);
        assert.match(m.lines()[33]!, /prefix · 10 matches from row 12,341/);
        for (let i = 0; i < 30; i++) await m.press(KEY.pageUp);
        await m.press('g');
        await m.press('g');
        await m.waitFor(() => /^▌· k000000/.test(m.lines()[5] ?? ''), 1_200);
        const dataset = m.store.getState().data.dataset['table']?.['.inputs.lookup'];
        assert.equal(dataset?.mode.kind, 'paged');
        if (dataset?.mode.kind === 'paged') assert.ok(dataset.mode.pages.size <= MAX_RETAINED_PAGES, `${dataset.mode.pages.size} pages retained`);
        m.dropFrames();
        const growth = heapUsed() - heap0;
        assert.ok(growth < 50 * 1024 * 1024, `heap grew ${Math.round(growth / 1024 / 1024)} MB`);
    });

    test('/run runs the dataflow; an input edited here is applied on the server', async () => {
        const m = mounted!;
        m.controller.openWorkspace('inputs');
        await m.waitFor(() => /^\s.add\s/.test(m.lines().find(l => /\badd\b/.test(l)) ?? '') , 600);
        await m.press('r');
        await m.press(KEY.enter);
        await m.waitFor(() => /Dataflow started · inputs · 1 task queued/.test(m.lines()[33] ?? ''), 600);
        await m.waitFor(() => {
            const execution = m.store.getState().data.execution['inputs'];
            return execution !== undefined && execution.state !== null && execution.state.status.type !== 'running' && !execution.settling;
        }, RUN_TURNS);
        assert.equal(m.store.getState().data.execution['inputs']?.state?.status.type, 'completed');
        await m.type('/task add');
        await m.press(KEY.enter);
        await m.waitFor(() => /^▌· Value\s+42\s*$/.test(m.lines()[5] ?? ''), 1_200);
        await m.type('/input a');
        await m.press(KEY.enter);
        await m.waitFor(() => /^▌· Value\s+40\s*$/.test(m.lines()[5] ?? ''), 1_200);
        await m.press('e');
        await m.press(KEY.backspace);
        await m.press(KEY.backspace);
        await m.type('41');
        await m.press(KEY.enter);
        assert.match(m.lines()[0]!, /◆ 1 DIRTY/);
        await m.type('/apply');
        await m.press(KEY.enter);
        await m.waitFor(() => m.store.getState().edit === null && /applied 1 change/.test(m.lines()[33] ?? ''), 1_200);
        const bytes = (await session.api.datasetGet('inputs', treePathOf('.inputs.a'))).data;
        assert.equal(decodeBeast2For(IntegerType)(bytes), 41n);
        await m.waitFor(() => /^▌· Value\s+41\s*$/.test(m.lines()[5] ?? '') && !/DIRTY/.test(m.lines()[0] ?? ''), 1_200);
    });
});
