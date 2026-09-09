/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Frame specs for the task view's Stdout / Stderr, Runs and Reads tabs
 * (mocks S10, S11, S17): follow-tail and its pause / resume, the Stderr
 * tab's line count and each stream tab keeping its own place, `/find` with
 * n / N / esc, save and copy; the runs table and the expanded input hashes;
 * a `ui` task's manifest title, its Reads tab and `⏎ open`.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { StringType, StructType, none, some, variant } from '@elaraai/east';
import { encodeManifest } from '@elaraai/e3-ui/internal';
import { dictOf, fakeRepo, type FakeApi } from '../../api.fake.js';
import { taskView } from '../../state/actions.js';
import { KEY, mountApp, type Mounted } from '../../testing/harness.js';

let mounted: Mounted | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const STDOUT = Array.from({ length: 40 }, (_, i) => `[info] line ${i + 1}${i === 6 ? ' store "Deli" has 3 missing days' : i === 20 ? ' store "Deli" forecast confidence below 0.5' : ''}`).join('\n') + '\n';
const STDERR = Array.from({ length: 12 }, (_, i) => `[warn] err ${i + 1}`).join('\n') + '\n';

const tp = (...parts: string[]) => parts.map(p => variant('field', p)) as never;

function repo(): FakeApi {
    const api = fakeRepo();
    const up = variant('up-to-date', { cached: true });
    api.task('main', {
        name: 'forecast', status: up, inputs: ['.inputs.params', '.tasks.features.output'], dependsOn: ['features'], output: dictOf(10),
        logs: { stdout: STDOUT, stderr: STDERR },
        executions: [
            // Two attempts under one inputs hash (a retry after a failure): both are rows.
            { inputsHash: '1c07aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3f', inputHashes: ['0a44eeee', '7be2ffff'], status: variant('success', null), startedAt: '2026-09-07T18:10:00Z', completedAt: some('2026-09-07T18:10:31Z'), duration: some(31_000n), exitCode: some(0n) },
            { inputsHash: '1c07aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3f', inputHashes: ['0a44eeee', '7be2ffff'], status: variant('failed', null), startedAt: '2026-09-07T18:03:21Z', completedAt: some('2026-09-07T18:03:23Z'), duration: some(2_100n), exitCode: some(2n) },
            { inputsHash: '4be1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba9', inputHashes: ['0a44eeee', '7be2ffff'], status: variant('success', null), startedAt: '2026-09-08T11:42:10Z', completedAt: some('2026-09-08T11:42:48Z'), duration: some(38_400n), exitCode: some(0n) },
            { inputsHash: 'e0d2cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc77', inputHashes: ['0a44eeee', '7be2ffff'], status: variant('error', null), startedAt: '2026-09-06T08:00:00Z', completedAt: none, duration: none, exitCode: none },
        ] as never,
    });
    api.task('main', {
        name: 'dashboard', status: up, inputs: ['.inputs.sales', '.inputs.params', '.tasks.forecast.output'], dependsOn: ['forecast'], kind: 'ui',
        output: { type: StructType({ title: StringType }), value: { title: 'Demand planner' } },
        metadata: encodeManifest({ paths: [tp('inputs', 'sales'), tp('inputs', 'params'), tp('tasks', 'forecast', 'output')], functions: ['refresh'], records: [], pages: [] }),
    });
    api.input('main', { name: 'sales', type: StringType, value: 'rows' });
    return api;
}

describe('the task view — Stdout / Stderr', () => {
    test('follows the tail, pauses on scroll-up, resumes on F; the Stderr tab counts its lines and each tab keeps its place (S10)', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast', 'stdout') });
        await mounted.waitFor(() => /line 40/.test(mounted!.frame()) && /Stderr \(12\)/.test(mounted!.frame()));
        let lines = mounted.lines();
        assert.match(lines[2]!, /^ forecast    1 Output  ▌2 Stdout▐  3 Stderr \(12\)   4 Runs\s+DATA TASK · ● UP-TO-DATE · cached · inputs 4be1…a9$/);
        assert.match(lines[5]!, /^ 40 lines · [\d.]+ (B|KB) · following$/);
        assert.match(lines[6]!, /^    16  \[info\] line 16\s+▲$/);
        assert.match(lines[30]!, /^    40  \[info\] line 40\s+▼$/);
        assert.match(lines[31]!, /^ lines 16–40 of 40 · at end\s+↑ scroll up pauses follow · F resumes$/);
        assert.match(lines[35]!, /^ ↑↓ scroll   G end   F follow ● on   s save   c copy   1 output  3 stderr  4 runs\s+polled/);
        await mounted.press('k');
        lines = mounted.lines();
        assert.match(lines[6]!, /^    15  \[info\] line 15/);
        assert.match(lines[31]!, /^ lines 15–39 of 40\s+F follow$/);
        assert.match(lines[35]!, /F follow ○ off/);
        await mounted.press('F');
        assert.match(mounted.lines()[31]!, /^ lines 16–40 of 40 · at end/);
        await mounted.press('g');
        await mounted.press('g');
        assert.match(mounted.lines()[6]!, /^     1  \[info\] line 1\s/);
        // The Stderr tab: its own stream, following from the start.
        await mounted.press('3');
        await mounted.waitFor(() => /err 12/.test(mounted!.frame()));
        lines = mounted.lines();
        assert.match(lines[2]!, /^ forecast    1 Output   2 Stdout  ▌3 Stderr \(12\)▐  4 Runs\s+DATA TASK/);
        assert.match(lines[5]!, /^ 12 lines · [\d.]+ B · following$/);
        assert.match(lines[6]!, /^     1  \[warn\] err 1\s*$/);
        assert.match(lines[31]!, /^ lines 1–12 of 12 · at end/);
        assert.match(lines[35]!, /^ ↑↓ scroll   G end   F follow ● on   s save   c copy   1 output  2 stdout  4 runs\s+polled/);
        // Back on Stdout, the paused place is where it was left.
        await mounted.press('2');
        lines = mounted.lines();
        assert.match(lines[6]!, /^     1  \[info\] line 1\s/);
        assert.match(lines[35]!, /F follow ○ off/);
        await mounted.press('G');
        assert.match(mounted.lines()[30]!, /^    40  \[info\] line 40/);
    });

    test('/find holds matches with n / N until esc; c copies; /save writes the stream', async () => {
        const scratch = fs.mkdtempSync(path.join(tmpdir(), 'e3-ui-logs-'));
        try {
            mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast', 'stdout') });
            await mounted.waitFor(() => /line 40/.test(mounted!.frame()));
            await mounted.type('/find deli');
            await mounted.press(KEY.enter);
            let lines = mounted.lines();
            assert.match(lines[33]!, /^ ›  ◔ 2 matches · n N next\/prev · esc$/);
            assert.match(lines[8]!, /^     7  \[info\] line 7 store "Deli" has 3 missing days/);
            assert.match(lines[31]!, /^ lines 5–29 of 40 · match 1 of 2 · held until esc/);
            await mounted.press('n');
            lines = mounted.lines();
            // The window cannot start past line 16 (40 lines, 25 visible), so line 21 sits five rows down.
            assert.match(lines[11]!, /^    21  \[info\] line 21 store "Deli" forecast/);
            assert.match(lines[31]!, /^ lines 16–40 of 40 · at end · match 2 of 2/);
            await mounted.press('N');
            assert.match(mounted.lines()[31]!, /match 1 of 2/);
            await mounted.press(KEY.escape);
            assert.doesNotMatch(mounted.lines()[31]!, /match/);
            assert.equal(mounted.store.getState().view.kind, 'task');
            await mounted.type('/find nothing-here');
            await mounted.press(KEY.enter);
            assert.match(mounted.lines()[33]!, /no match for nothing-here in stdout/);
            await mounted.press(KEY.escape);
            await mounted.press('c');
            assert.deepEqual(mounted.copied, [STDOUT]);
            assert.match(mounted.lines()[33]!, /copied [\d.]+ (B|KB) to the clipboard via OSC 52/);
            const file = path.join(scratch, 'out.log');
            await mounted.type(`/save ${file}`);
            await mounted.press(KEY.enter);
            await mounted.waitFor(() => fs.existsSync(file));
            assert.equal(fs.readFileSync(file, 'utf8'), STDOUT);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });
});

describe('the task view — Runs', () => {
    test('lists runs newest first with status / started / duration / exit / inputs; ⏎ expands the input hashes (S11)', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'forecast', 'runs') });
        await mounted.waitFor(() => /4be1…a9/.test(mounted!.lines()[6] ?? ''));
        await mounted.waitFor(() => mounted!.store.getState().data.taskDetails['main']?.['forecast'] !== undefined);
        let lines = mounted.lines();
        assert.match(lines[2]!, /^ forecast    1 Output   2 Stdout   3 Stderr( \(12\))?  ▌4 Runs▐\s+DATA TASK · ● UP-TO-DATE · cached · inputs 4be1…a9$/);
        assert.match(lines[5]!, /^  STATUS\s+STARTED\s+DURATION\s+EXIT\s+INPUTS\s*$/);
        assert.match(lines[6]!, /^ ▌● success\s+2026-09-08 11:42:10\s+38\.4s\s+0\s+4be1…a9\s+← current\s*$/);
        assert.match(lines[7]!, /^  ● success\s+2026-09-07 18:10:00\s+31\.0s\s+0\s+1c07…3f\s*$/);
        assert.match(lines[8]!, /^  ✗ failed\s+2026-09-07 18:03:21\s+2\.1s\s+2\s+1c07…3f\s*$/);
        assert.match(lines[9]!, /^  ◐ error\s+2026-09-06 08:00:00\s+—\s+—\s+e0d2…77\s*$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ inputs   1 output  2 stdout  3 stderr\s+4 executions$/);
        await mounted.press(KEY.enter);
        lines = mounted.lines();
        // Four rows, a blank, then the expansion line.
        assert.match(lines[11]!, /^ ▪ 4be1…a9 = sha256 of the inputs \(params 0a44…, \.tasks\.features\.output 7be2…\) · ⏎ collapses$/);
        await mounted.press('j');
        assert.match(mounted.lines()[11]!, /^ ▪ 1c07…3f = sha256 of the inputs/);
        await mounted.press(KEY.enter);
        assert.doesNotMatch(mounted.frame(), /sha256/);
    });
});

describe('the task view — a ui task', () => {
    test('shows the manifest in the title, a Reads tab whose rows open as datasets (S17)', async () => {
        mounted = await mountApp({ api: repo(), feeds: true, view: taskView('main', 'dashboard') });
        await mounted.waitFor(() => /3 reads · 1 function/.test(mounted!.frame()) && /5 Reads/.test(mounted!.frame()));
        let lines = mounted.lines();
        assert.match(lines[2]!, /^ dashboard   ▌1 Output▐  2 Stdout   3 Stderr   4 Runs   5 Reads\s+UI TASK · ● UP-TO-DATE · cached · 3 reads · 1 function$/);
        assert.match(lines[3]!, /^ \.tasks\.dashboard\.output · UIComponentType · \d+ B · [0-9a-f]{4}…$/);
        await mounted.waitFor(() => /Demand planner/.test(mounted!.frame()));
        assert.match(mounted.lines()[5]!, /^▌· Title\s+"Demand planner"/);
        await mounted.press('5');
        lines = mounted.lines();
        assert.match(lines[2]!, /▌5 Reads▐/);
        assert.match(lines[5]!, /^ READS\s*$/);
        assert.match(lines[6]!, /^ ▌\.inputs\.sales   ⏎ open/);
        assert.match(lines[7]!, /^  \.inputs\.params   ⏎ open/);
        assert.match(lines[8]!, /^  \.tasks\.forecast\.output   ⏎ open/);
        assert.match(lines[10]!, /^ FUNCTIONS/);
        assert.match(lines[11]!, /^  refresh\s*$/);
        assert.match(lines[35]!, /^ ↑↓ move   ⏎ open   1 output  2 stdout  3 stderr  4 runs/);
        await mounted.press('j');
        await mounted.press('j');
        await mounted.press('j');
        await mounted.press(KEY.enter);
        assert.match(mounted.lines()[33]!, /a package function has no view here/);
        await mounted.press('g');
        await mounted.press('g');
        await mounted.press(KEY.enter);
        const view = mounted.store.getState().view;
        assert.equal(view.kind, 'input');
        assert.equal(view.kind === 'input' && view.name, 'sales');
    });
});
