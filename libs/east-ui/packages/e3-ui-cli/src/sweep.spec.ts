/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sweep, isSweepableSource, outputStemFor, type SweepResult } from './sweep.js';
import type { SessionCaptureOptions } from './capture.js';

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'sweep-project');

test('isSweepableSource: ts/tsx in, specs and declarations out', () => {
    assert.equal(isSweepableSource('src/ui/index.tsx'), true);
    assert.equal(isSweepableSource('src/tasks.ts'), true);
    assert.equal(isSweepableSource('src/tasks.spec.ts'), false);
    assert.equal(isSweepableSource('src/ui/screen.spec.tsx'), false);
    assert.equal(isSweepableSource('src/types.d.ts'), false);
    assert.equal(isSweepableSource('README.md'), false);
});

test('outputStemFor mirrors the source tree relative to cwd', () => {
    assert.equal(outputStemFor(join('/proj', 'src', 'ui', 'index.tsx'), '/proj'), join('src', 'ui', 'index'));
    // Outside cwd → flattened basename (never a ..-escaping path).
    assert.equal(outputStemFor('/elsewhere/thing.tsx', '/proj'), 'thing');
});

/** Run the sweep over the fixture project with a fake renderer. */
async function run(html: boolean): Promise<{ result: SweepResult; outDir: string; captured: SessionCaptureOptions[] }> {
    const outDir = mkdtempSync(join(tmpdir(), 'e3-ui-shots-'));
    const captured: SessionCaptureOptions[] = [];
    const result = await sweep({
        cwd: PROJECT,
        paths: ['src'],
        outDir,
        html,
        json: true,
        log: () => { /* silent in tests */ },
        render: async (opts) => { captured.push(opts); },
    });
    return { result, outDir, captured };
}

test('sweep renders every renderable export to <out>/<rel-path>/<export>.png and writes the manifest', async () => {
    const { result, outDir, captured } = await run(false);
    try {
        const rendered = new Map(result.rendered.map(r => [r.exportName, r]));
        assert.deepEqual([...rendered.keys()].sort(), ['chipExample', 'stateBound', 'surface']);
        // Output layout mirrors the source tree: src/kinds/<export>.png.
        assert.ok(rendered.get('surface')!.png.endsWith(join('src', 'kinds', 'surface.png')));
        // The fake renderer received the sweep's faithful-width default.
        assert.ok(captured.length === 3 && captured.every(c => c.frameWidth === 'full'));
        // Skips carry typed reasons; plain exports (columns) are suppressed.
        const skipped = new Map(result.skipped.map(s => [s.exportName ?? s.file, s.reason]));
        assert.match(skipped.get('sumExample') ?? '', /output type is Integer/);
        assert.match(skipped.get('withInputs') ?? '', /input/);
        assert.match(skipped.get('workspaceBound') ?? '', /data_read/);
        assert.equal(skipped.has('columns'), false);
        assert.equal(result.failed.length, 0);
        // Manifest mirrors the result.
        const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as SweepResult;
        assert.equal(manifest.rendered.length, 3);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
});

test('sweep --html pairs an .html beside each png; --frame-width none restores shrink-to-fit', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'e3-ui-shots-'));
    const captured: SessionCaptureOptions[] = [];
    try {
        const result = await sweep({
            cwd: PROJECT,
            paths: ['src'],
            outDir,
            html: true,
            frameWidth: 'none',
            log: () => { /* silent */ },
            render: async (opts) => { captured.push(opts); },
        });
        assert.ok(result.rendered.every(r => r.html !== undefined && r.html.endsWith('.html')));
        assert.ok(captured.every(c => c.frameWidth === undefined));
        // No manifest without --json.
        assert.equal(existsSync(join(outDir, 'manifest.json')), false);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
});

test('sweep records unloadable files as skips (with the load error), not crashes', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'e3-ui-shots-'));
    try {
        const result = await sweep({
            cwd: PROJECT,
            paths: ['broken'],
            outDir,
            log: () => { /* silent */ },
            render: async () => { /* unreached */ },
        });
        assert.equal(result.rendered.length, 0);
        assert.equal(result.failed.length, 0);
        assert.equal(result.skipped.length, 1);
        assert.ok(result.skipped[0]!.file.split(sep).includes('broken'));
        assert.match(result.skipped[0]!.reason, /failed to load/);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
});
