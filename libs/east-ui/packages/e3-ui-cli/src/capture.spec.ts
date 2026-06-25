/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escapeHtml, inlineFonts, resolveWithinRoot } from './capture.js';

test('escapeHtml escapes HTML metacharacters', () => {
    assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    assert.equal(escapeHtml('plain'), 'plain');
});

test('resolveWithinRoot maps paths and rejects traversal', () => {
    const root = '/srv/app';
    assert.equal(resolveWithinRoot(root, '/'), join(root, 'index.html'));
    assert.equal(resolveWithinRoot(root, '/assets/x.js'), join(root, 'assets/x.js'));
    // Traversal and sibling-prefix escapes are rejected.
    assert.equal(resolveWithinRoot(root, '/../../etc/passwd'), null);
    assert.equal(resolveWithinRoot(root, '/../app-secrets/x'), null);
});

test('inlineFonts replaces woff2 urls with data URIs and warns on a missing font', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'e3uishot-'));
    try {
        await mkdir(join(dir, 'assets'), { recursive: true });
        await writeFile(join(dir, 'assets', 'a.woff2'), Buffer.from([1, 2, 3, 4]));
        const css = '@font-face{src:url(./a.woff2) format("woff2"),url(./missing.woff2)}';

        const warnings: string[] = [];
        const origWarn = console.warn;
        console.warn = (m?: unknown) => { warnings.push(String(m)); };
        let out: string;
        try { out = await inlineFonts(css, dir); } finally { console.warn = origWarn; }

        assert.match(out, /data:font\/woff2;base64,AQIDBA==/);   // present font inlined
        assert.match(out, /url\(\.\/missing\.woff2\)/);          // missing font left as-is
        assert.ok(warnings.some(w => w.includes('missing.woff2')));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
