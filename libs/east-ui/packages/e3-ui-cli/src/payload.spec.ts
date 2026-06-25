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
            /not valid component IR/,
        );
    } finally {
        await rm(tmp, { force: true });
    }
});

test('loadComponentFromSource resolves the default export from a .tsx', async () => {
    const fn = await loadComponentFromSource(FIXTURE);
    assert.equal(typeof fn.toIR, 'function');
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
