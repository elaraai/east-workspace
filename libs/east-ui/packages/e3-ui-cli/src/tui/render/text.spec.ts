/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    displayWidth, truncate, padEnd, padStart, center, fit, lr,
    formatInt, formatDuration, timeAgo, agoShort, hashShort, hashMid, hashTiny, formatStamp, percent, formatSize,
} from './text.js';

describe('text measurement', () => {
    test('displayWidth counts cells: glyphs are single, CJK double, combining marks zero', () => {
        assert.equal(displayWidth('e3-ui'), 5);
        assert.equal(displayWidth('▌▾ k0148 ● ◐ ◔ ○ ✗ ◆ ─ ┄ │ ▲ █ ▼ ░ ▒ ⠸ ▁▃▅▇ …'), 45);
        assert.equal(displayWidth('日本'), 4);
        assert.equal(displayWidth('é'), 1);
        assert.equal(displayWidth(''), 0);
    });

    test('truncate cuts to the budget with an ellipsis', () => {
        assert.equal(truncate('waiting on forecast', 10), 'waiting o…');
        assert.equal(truncate('short', 10), 'short');
        assert.equal(truncate('abcdef', 6), 'abcdef');
        assert.equal(truncate('abcdef', 1), '…');
        assert.equal(truncate('abcdef', 0), '');
        assert.equal(truncate('日本語テキスト', 5), '日本…');
    });

    test('padEnd / padStart / center / fit produce exactly the width', () => {
        assert.equal(padEnd('ab', 5), 'ab   ');
        assert.equal(padEnd('abcdefg', 5), 'abcde');
        assert.equal(padStart('ab', 5), '   ab');
        assert.equal(center('ab', 6), '  ab  ');
        assert.equal(center('ab', 5), ' ab  ');
        assert.equal(fit('abcdefg', 5), 'abcd…');
        assert.equal(fit('ab', 5), 'ab   ');
        for (const s of [padEnd('x', 7), padStart('x', 7), center('x', 7), fit('x'.repeat(20), 7)]) {
            assert.equal(displayWidth(s), 7);
        }
    });

    test('lr composes a left and a flush-right part, the left yielding', () => {
        assert.equal(lr('main', '● DEPLOYED', 20), 'main      ● DEPLOYED');
        assert.equal(lr('a very long left side text', 'R', 12), 'a very lo… R');
        assert.equal(lr('left', 'right', 5), 'right');
        assert.equal(displayWidth(lr('main', '● DEPLOYED', 20)), 20);
    });
});

describe('text formatting', () => {
    test('formatInt groups thousands', () => {
        assert.equal(formatInt(0), '0');
        assert.equal(formatInt(999), '999');
        assert.equal(formatInt(1240000), '1,240,000');
        assert.equal(formatInt(12408n), '12,408');
        assert.equal(formatInt(-1234), '-1,234');
    });

    test('formatDuration reads as the dashboard shows it', () => {
        assert.equal(formatDuration(800), '0.8s');
        assert.equal(formatDuration(38400), '38.4s');
        assert.equal(formatDuration(12000), '12.0s');
        assert.equal(formatDuration(125000), '2m 5s');
        assert.equal(formatDuration(3_720_000), '1h 02m');
        assert.equal(formatDuration(100_800_000), '1d 4h');
        assert.equal(formatDuration(-1), '—');
    });

    test('timeAgo / agoShort', () => {
        const now = Date.UTC(2026, 8, 8, 12, 0, 0);
        assert.equal(timeAgo(now - 400, now), 'just now');
        assert.equal(timeAgo(now - 12_000, now), '12s ago');
        assert.equal(timeAgo(now - 2 * 60_000, now), '2m ago');
        assert.equal(timeAgo(now - 3 * 3_600_000, now), '3h ago');
        assert.equal(timeAgo(now - 3 * 86_400_000, now), '3d ago');
        assert.equal(timeAgo(new Date(now - 12 * 86_400_000).toISOString(), now), '12d ago');
        assert.equal(timeAgo('not a date', now), '—');
        assert.equal(agoShort(now - 400, now), '0.4s ago');
        assert.equal(agoShort(now - 7_100, now), '7.1s ago');
        assert.equal(agoShort(now - 12_000, now), '12s ago');
    });

    test('hash abbreviations', () => {
        const hash = '4be1c0ffee0123456789abcdef0123456789abcdef0123456789abcdef00a9';
        assert.equal(hashShort(hash), '4be1c0ffee01');
        assert.equal(hashMid(hash), '4be1…a9');
        assert.equal(hashTiny(hash), '4be1…');
        assert.equal(hashMid('abc'), 'abc');
    });

    test('formatStamp / percent / formatSize', () => {
        assert.equal(formatStamp(Date.UTC(2026, 8, 8, 11, 42, 10)), '2026-09-08 11:42:10');
        assert.equal(formatStamp('garbage'), '—');
        assert.equal(percent(12_001, 1_240_000), '0.97%');
        assert.equal(percent(1, 0), '0%');
        assert.equal(formatSize(12_700_000), '12.1 MB');
        assert.equal(formatSize(41 * 1024), '41 KB');
    });
});
