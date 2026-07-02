/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envBrowserPath, systemBrowserCandidates, isRealBrowserBinary } from './browser.js';

test('envBrowserPath prefers E3_UI_CHROMIUM_PATH over PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', () => {
    assert.equal(envBrowserPath({}), null);
    assert.equal(envBrowserPath({ PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/b' }), '/b');
    assert.equal(envBrowserPath({ E3_UI_CHROMIUM_PATH: '/a', PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/b' }), '/a');
    assert.equal(envBrowserPath({ E3_UI_CHROMIUM_PATH: '' }), null); // empty string is unset
});

test('systemBrowserCandidates covers linux, darwin, and win32', () => {
    const linux = systemBrowserCandidates('linux', {});
    assert.ok(linux.includes('/opt/google/chrome/chrome'));
    assert.ok(linux.includes('/usr/bin/chromium-browser'));

    const darwin = systemBrowserCandidates('darwin', {});
    assert.ok(darwin.some(p => p.includes('Google Chrome.app')));
    assert.ok(darwin.some(p => p.includes('Microsoft Edge.app')));

    const win = systemBrowserCandidates('win32', {
        'ProgramFiles': 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        'LocalAppData': 'C:\\Users\\dev\\AppData\\Local',
    });
    assert.equal(win.filter(p => p.endsWith('chrome.exe')).length, 3);
    assert.equal(win.filter(p => p.endsWith('msedge.exe')).length, 3);

    // Missing Windows roots produce no phantom candidates.
    assert.deepEqual(systemBrowserCandidates('win32', {}), []);
    assert.deepEqual(systemBrowserCandidates('freebsd', {}), []);
});

test('isRealBrowserBinary rejects snap shims and accepts binaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-ui-browser-spec-'));
    try {
        // Ubuntu's /usr/bin/chromium-browser: a #! shell script that execs the snap.
        const shim = join(dir, 'chromium-browser');
        writeFileSync(shim, '#!/bin/sh\nexec /snap/bin/chromium "$@"\n');
        assert.equal(isRealBrowserBinary(shim), false);

        // A path whose realpath resolves under a snap mount.
        const snapDir = join(dir, 'snap', 'chromium');
        mkdirSync(snapDir, { recursive: true });
        const snapBinary = join(snapDir, 'chrome');
        writeFileSync(snapBinary, Buffer.from([0x7f, 0x45, 0x4c, 0x46])); // ELF magic
        // The link's own path has no snap segment — only its realpath does.
        const link = join(dir, 'chrome-link');
        symlinkSync(snapBinary, link);
        assert.equal(isRealBrowserBinary(link), false);

        // A real binary (non-#!, not under snap) passes.
        const binary = join(dir, 'chrome');
        writeFileSync(binary, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
        assert.equal(isRealBrowserBinary(binary), true);

        // Nonexistent path is not usable.
        assert.equal(isRealBrowserBinary(join(dir, 'missing')), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
