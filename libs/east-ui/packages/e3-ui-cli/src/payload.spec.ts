/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { decodeEastIR, toJSONFor, decodeBeast2For } from '@elaraai/east';
import { IRType } from '@elaraai/east/internal';
import { detectFormat, buildPayload } from './payload.js';
import { loadComponentFromSource } from './load-source.js';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'component.tsx');

test('detectFormat maps extensions to formats', () => {
    assert.equal(detectFormat('component.ts'), 'ts');
    assert.equal(detectFormat('component.tsx'), 'ts');
    assert.equal(detectFormat('/abs/path/Widget.TSX'), 'ts');
    assert.equal(detectFormat('data.beast2'), 'beast2');
    assert.equal(detectFormat('ir.json'), 'json');
});

test('detectFormat throws on an unknown extension', () => {
    assert.throws(() => detectFormat('image.png'), /Cannot detect format/);
    assert.throws(() => detectFormat('noext'), /Cannot detect format/);
});

test('buildPayload rejects a TypeScript source read from stdin', async () => {
    await assert.rejects(
        () => buildPayload({ path: null, from: 'ts' }),
        /cannot be read from stdin/,
    );
});

test('buildPayload surfaces a clear error for non-IR beast2 bytes', async () => {
    // A bare buffer that is not valid component IR.
    const tmp = new URL('./__not_ir__.beast2', import.meta.url);
    const { writeFile, rm } = await import('node:fs/promises');
    await writeFile(tmp, Buffer.from([0, 1, 2, 3, 4, 5]));
    try {
        await assert.rejects(
            () => buildPayload({ path: tmp.pathname, from: 'beast2' }),
            /not a renderable component/,
        );
    } finally {
        await rm(tmp, { force: true });
    }
});

test('loadComponentFromSource resolves the default export from a .tsx', async () => {
    const fn = await loadComponentFromSource(FIXTURE);
    assert.equal(typeof fn.toIR, 'function');
});

test('loadComponentFromSource unwraps a zero-input ui() task to its stored fn IR', async () => {
    const fixture = resolve(dirname(FIXTURE), 'ui-task.tsx');
    const fn = await loadComponentFromSource(fixture, 'surface');
    const bundle = fn.toIR() as { ir?: unknown };
    assert.ok(bundle.ir, 'unwrapped ui() task carries the EastIR bundle');
    // The sole-renderable-export fallback finds it too (a TaskDef itself has
    // no toIR, so only the unwrap makes it renderable).
    const sole = await loadComponentFromSource(fixture);
    assert.deepEqual(sole.toIR(), fn.toIR());
    // And the bundle is real component IR: it encodes into a payload.
    const { kind, b64 } = await buildPayload({ path: fixture, from: 'ts' });
    assert.equal(kind, 'component');
    assert.ok(decodeEastIR(Buffer.from(b64, 'base64')).ir);
});

test('loadComponentFromSource rejects a parameterized ui() task with the --from-task remediation', async () => {
    const fixture = resolve(dirname(FIXTURE), 'ui-task-parameterized.tsx');
    await assert.rejects(() => loadComponentFromSource(fixture, 'surface'), /--from-task/);
    await assert.rejects(() => loadComponentFromSource(fixture), /--from-task/);
});

test('loadComponentFromSource names the in-memory module after its file, so a payload is not bundle text (#606)', async () => {
    // The bundle is imported from a `data:` URL; without a `sourceURL` V8
    // reports that whole URL — the base64 of the entire bundle — as every
    // frame's filename, and east's source map stores it per location, so a
    // payload was ~99% duplicated bundle text (87 MB for a 64k-node IR) and
    // the loader's heap scaled with locations × bundle size.
    const fn = await loadComponentFromSource(FIXTURE);
    const bundle = fn.toIR() as { source_map?: unknown };
    assert.ok(bundle.source_map, 'the bundle carries a source map');
    const text = JSON.stringify(bundle.source_map, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
    assert.ok(!text.includes('data:text/javascript'), 'no frame names the data: URL');
    assert.ok(text.includes('component.tsx'), 'frames name the source file');
    // And the whole encoded payload of this small fixture stays small.
    const { b64 } = await buildPayload({ path: FIXTURE, from: 'ts' });
    assert.ok(b64.length < 2_000_000, `payload is ${b64.length} b64 chars`);
});

test('buildPayload: .tsx source loads, encodes, and round-trips to a Function IR', async () => {
    const { kind, b64 } = await buildPayload({ path: FIXTURE, from: 'ts' });
    assert.equal(kind, 'component');
    assert.ok(b64.length > 0);
    const ir = decodeEastIR(Buffer.from(b64, 'base64'));
    assert.ok(ir.ir);
});

test('buildPayload: .json IR path round-trips to renderable bytes', async () => {
    const fn = await loadComponentFromSource(FIXTURE);
    const irNode = (fn.toIR() as { ir: unknown }).ir;
    const json = toJSONFor(IRType)(irNode as never);
    const { writeFile, rm } = await import('node:fs/promises');
    const tmp = new URL('./__fixture_ir__.json', import.meta.url);
    await writeFile(tmp, JSON.stringify(json), 'utf8');
    try {
        const { b64 } = await buildPayload({ path: tmp.pathname, from: 'json' });
        assert.ok(decodeBeast2For(IRType)(Buffer.from(b64, 'base64')));
    } finally {
        await rm(tmp, { force: true });
    }
});

test('buildPayload refuses a workspace-bound component up front, naming --from-task', async () => {
    // #567 D11 / #573: component mode has no provider and no workspace, and
    // there is deliberately no offline stand-in for `data_*` — so the refusal
    // must arrive here, with the remedy, instead of as `Render failed` after a
    // browser launch. Same verdict the sweep already applies.
    const fixture = resolve(dirname(FIXTURE), 'sweep-project', 'src', 'kinds.tsx');
    await assert.rejects(
        () => buildPayload({ path: fixture, from: 'ts', exportName: 'workspaceBound' }),
        (err: Error) => /Cannot render "workspaceBound" standalone/.test(err.message)
            && /data_read/.test(err.message)
            && /--from-task/.test(err.message),
    );
    // A browser-local `State.bind` component in the SAME file still renders.
    const { kind } = await buildPayload({ path: fixture, from: 'ts', exportName: 'stateBound' });
    assert.equal(kind, 'component');
});
