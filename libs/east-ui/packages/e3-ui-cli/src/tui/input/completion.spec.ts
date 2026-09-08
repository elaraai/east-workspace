/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { complete, fuzzyScore, jump, type Catalogue } from './completion.js';

const catalogue: Catalogue = {
    items: [
        { kind: 'task', name: 'forecast', workspace: 'main', status: '● up-to-date', type: 'Dict<String, Struct>', detail: '84.2 MB · 38.4s' },
        { kind: 'task', name: 'forecast_v2', workspace: 'staging', status: '○ ready', type: 'Dict<String, Struct>', detail: '—' },
        { kind: 'task', name: 'features', workspace: 'main', status: '● up-to-date', type: 'Struct', detail: '412.6 MB · 12.0s' },
        { kind: 'task', name: 'report', workspace: 'main', status: '✗ failed · exit 2', type: 'String', detail: '— · 0.8s' },
        { kind: 'input', name: 'overrides', workspace: 'main', status: '○ unset', type: 'Dict<String, Float>', detail: '—' },
        { kind: 'input', name: 'params', workspace: 'main', status: '◐ stale', type: 'Struct', detail: '1.2 KB' },
        { kind: 'dataset', name: '.tasks.forecast.output', workspace: 'main', status: '● up-to-date', type: '', detail: '84.2 MB' },
        { kind: 'workspace', name: 'main', workspace: null, status: '● DEPLOYED', type: 'demand@1.4.2', detail: '' },
        { kind: 'workspace', name: 'staging', workspace: null, status: '● DEPLOYED', type: 'demand@1.5.0-rc.1', detail: '' },
    ],
    tags: ['Weekly', 'Monthly', 'none'],
};

describe('fuzzyScore', () => {
    test('prefix beats word-start beats scattered; non-subsequences are null', () => {
        const prefix = fuzzyScore('fore', 'forecast')!;
        const wordStart = fuzzyScore('fv', 'forecast_v2')!;
        const scattered = fuzzyScore('fst', 'forecast')!;
        assert.ok(prefix > wordStart && wordStart > scattered);
        assert.equal(fuzzyScore('xyz', 'forecast'), null);
        assert.equal(fuzzyScore('FORE', 'forecast'), fuzzyScore('fore', 'forecast'));
        assert.ok(fuzzyScore('', 'ab')! > fuzzyScore('', 'abc')!);
    });
});

describe('complete', () => {
    test('nothing typed → nothing; a lone slash lists commands', () => {
        assert.deepEqual(complete('', catalogue), []);
        const all = complete('/', catalogue);
        assert.equal(all.length, 8);
        assert.equal(all[0]!.kind, 'command');
    });

    test('command names complete with their usage and effect', () => {
        const c = complete('/ta', catalogue);
        assert.equal(c[0]!.insert, '/task ');
        assert.deepEqual(c[0]!.cells, ['/task', '<name>', 'open a task']);
        assert.equal(complete('/quit', catalogue)[0]!.insert, '/quit');
    });

    test('/task completes tasks with status, type and size columns', () => {
        const c = complete('/task fore', catalogue);
        assert.deepEqual(c.map(x => x.insert), ['/task forecast', '/task forecast_v2']);
        assert.equal(complete('/task fe', catalogue)[0]!.insert, '/task features');
        assert.deepEqual(c[0]!.cells, ['/task', 'forecast', '● up-to-date', 'Dict<String, Struct>', '84.2 MB · 38.4s']);
        assert.deepEqual(complete('/task ', catalogue).map(x => x.cells[1]), ['report', 'forecast', 'features', 'forecast_v2']);
        assert.equal(complete('/logs re', catalogue)[0]!.insert, '/logs report');
        assert.deepEqual(complete('/input o', catalogue).map(x => x.insert), ['/input overrides']);
        assert.deepEqual(complete('/workspace st', catalogue).map(x => x.insert), ['/workspace staging']);
        assert.deepEqual(complete('/dataset fore', catalogue).map(x => x.insert), ['/dataset .tasks.forecast.output']);
    });

    test('/run completes its flags, skipping the ones already given', () => {
        assert.deepEqual(complete('/run ', catalogue).map(x => x.cells[1]), ['--force', '--filter <glob>', '--concurrency <n>']);
        assert.deepEqual(complete('/run --force ', catalogue).map(x => x.cells[1]), ['--filter <glob>', '--concurrency <n>']);
        assert.deepEqual(complete('/run --f', catalogue).map(x => x.insert), ['/run --force ', '/run --filter ']);
        assert.deepEqual(complete('/run fore', catalogue), []);
    });

    test('/tag completes the row\'s tags', () => {
        assert.deepEqual(complete('/tag ', catalogue).map(x => x.insert), ['/tag none', '/tag Weekly', '/tag Monthly']);
        assert.deepEqual(complete('/tag mo', catalogue).map(x => x.insert), ['/tag Monthly']);
    });

    test('plain text fuzzy-jumps across everything with kind, name, workspace and detail', () => {
        const c = jump('forc', catalogue);
        assert.deepEqual(c.map(x => x.insert), ['/task forecast', '/task forecast_v2', '/dataset .tasks.forecast.output']);
        assert.deepEqual(c[0]!.cells, ['task', 'forecast', 'main', '● up-to-date · Dict<String, Struct> · 84.2 MB · 38.4s']);
        assert.equal(complete('forc', catalogue).length, 3);
        assert.equal(complete('zzz', catalogue).length, 0);
    });
});
