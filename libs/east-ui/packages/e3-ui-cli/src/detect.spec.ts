/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSourceExports } from './load-source.js';
import { classifyExports, describeSkip, detectContextFor, type ExportClassification } from './detect.js';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'sweep-project', 'src', 'kinds.tsx');

async function classified(): Promise<Map<string, ExportClassification>> {
    const moduleExports = await loadSourceExports(FIXTURE);
    const ctx = await detectContextFor(FIXTURE);
    assert.ok(ctx, 'the fixture project must resolve @elaraai/east');
    assert.notEqual(ctx.uiComponentTypeValue, null, 'the fixture project must resolve @elaraai/east-ui');
    return new Map(classifyExports(moduleExports, ctx).map(c => [c.name, c]));
}

test('detect: a bare zero-input UI fn and a UI example() are renderable', async () => {
    const byName = await classified();
    assert.equal(byName.get('surface')?.renderable, true);
    assert.equal(byName.get('surface')?.shape, 'function');
    assert.equal(byName.get('chipExample')?.renderable, true);
    assert.equal(byName.get('chipExample')?.shape, 'example');
});

test('detect: a non-UI example() is skipped with its OUTPUT TYPE named', async () => {
    const byName = await classified();
    const c = byName.get('sumExample');
    assert.equal(c?.renderable, false);
    assert.equal(c?.skip?.kind, 'wrong-output');
    assert.match(describeSkip(c!.skip!), /Integer/);
});

test('detect: a UI fn WITH inputs is skipped as has-inputs', async () => {
    const byName = await classified();
    const c = byName.get('withInputs');
    assert.equal(c?.renderable, false);
    assert.equal(c?.skip?.kind, 'has-inputs');
});

test('detect: browser-local State platforms render standalone; data_* platforms are workspace-bound', async () => {
    const byName = await classified();
    assert.equal(byName.get('stateBound')?.renderable, true);
    const ws = byName.get('workspaceBound');
    assert.equal(ws?.renderable, false);
    assert.equal(ws?.skip?.kind, 'workspace-bound');
    assert.deepEqual(ws?.skip?.kind === 'workspace-bound' ? ws.skip.platforms : [], ['data_read']);
});

test('detect: a plain non-East export has shape null (suppressed noise)', async () => {
    const byName = await classified();
    const c = byName.get('columns');
    assert.equal(c?.renderable, false);
    assert.equal(c?.shape, null);
});

test('detect: a parameterized ui() task is skipped with the --from-task pointer', async () => {
    const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'ui-task-parameterized.tsx');
    const moduleExports = await loadSourceExports(fixture);
    const ctx = await detectContextFor(fixture);
    assert.ok(ctx);
    const tasks = classifyExports(moduleExports, ctx).filter(c => c.shape === 'ui-task');
    assert.ok(tasks.length >= 1, 'fixture must contain a ui() task export');
    assert.equal(tasks[0]!.renderable, false);
    assert.equal(tasks[0]!.skip?.kind, 'parameterized-ui-task');
    assert.match(describeSkip(tasks[0]!.skip!), /--from-task/);
});
