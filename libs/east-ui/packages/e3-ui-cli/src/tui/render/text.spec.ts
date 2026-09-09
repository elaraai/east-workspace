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

describe('display width — the ASCII fast path agrees with the segmenter', () => {
    // A zero-width space adds no cells but takes a string off the ASCII fast
    // path, so `displayWidth(s)` and `displayWidth(s + ZWSP)` measure the same
    // text through the two paths.
    const ZWSP = '​';
    const corpus = [
        '', 'e3-ui', 'forecast_count', '  NAME        STATUS', '.tasks.forecast.output · Dict<String, Struct>',
        ' ▌', '▁▃▅▇', '日本語テキスト', '한국어', 'ｆｕｌｌｗｉｄｔｈ', 'Bakery · 2025-09-01 · 1,204',
        'é', 'é', 'naïve café', 'a​b', 'ff﻿',
        '👨‍👩‍👧', '👍🏽', '❤️', '🇦🇺',
        'tab\there', 'bell\x07', '\x1b', 'del\x7f', 'nul\x00', '\r\n',
    ];
    const widths = [0, 1, 2, 3, 5, 8, 13, 40];

    test('hand-counted cells: ASCII one each, wide two, combining marks / ZWJ sequences one cluster, controls none', () => {
        assert.equal(displayWidth('forecast_count'), 14);
        assert.equal(displayWidth('  NAME        STATUS'), 20);
        assert.equal(displayWidth('日本語テキスト'), 14);
        assert.equal(displayWidth('한국어'), 6);
        assert.equal(displayWidth('ｆｕｌｌｗｉｄｔｈ'), 18);
        assert.equal(displayWidth('é'), 1, 'e + combining acute is one cluster');
        assert.equal(displayWidth('naïve café'), 10);
        assert.equal(displayWidth('👨‍👩‍👧'), 2, 'a ZWJ family is one wide cluster');
        assert.equal(displayWidth('👍🏽'), 2, 'a skin-tone modifier joins its base');
        assert.equal(displayWidth('a​b'), 2);
        assert.equal(displayWidth('tab\there'), 7);
        assert.equal(displayWidth('bell\x07'), 4);
        assert.equal(displayWidth('\x1b'), 0);
        assert.equal(displayWidth('del\x7f'), 3);
        assert.equal(displayWidth('nul\x00'), 3);
    });

    test('parity: every corpus string measures the same on both paths', () => {
        for (const s of corpus) {
            assert.equal(displayWidth(s), displayWidth(s + ZWSP), JSON.stringify(s));
            assert.equal(displayWidth(s), displayWidth(ZWSP + s), JSON.stringify(s));
        }
    });

    test('truncate / padEnd / padStart / center / fit keep their contracts on both paths', () => {
        for (const s of corpus) {
            for (const w of widths) {
                const label = `${JSON.stringify(s)} @ ${w}`;
                assert.ok(displayWidth(truncate(s, w)) <= w, `truncate ${label}`);
                assert.ok(displayWidth(truncate(s, w, '')) <= w, `truncate '' ${label}`);
                assert.equal(displayWidth(padEnd(s, w)), w, `padEnd ${label}`);
                assert.equal(displayWidth(padStart(s, w)), w, `padStart ${label}`);
                assert.equal(displayWidth(center(s, w)), w, `center ${label}`);
                assert.equal(displayWidth(fit(s, w)), w, `fit ${label}`);
                // The segmenter path must agree with the fast path on the same text.
                assert.equal(displayWidth(truncate(s + ZWSP, w)), displayWidth(truncate(s, w)), `truncate parity ${label}`);
                // A string that fits is returned untouched (a zero budget is always empty); a cut is a prefix plus the marker.
                if (w > 0 && displayWidth(s) <= w) assert.equal(truncate(s, w), s, `untouched ${label}`);
                else if (w >= 2) {
                    const cut = truncate(s, w);
                    assert.ok(cut.endsWith('…') && s.startsWith(cut.slice(0, -1)), `prefix + ellipsis ${label}`);
                }
            }
        }
        // The ASCII cut is the slice form.
        assert.equal(truncate('abcdefgh', 5), 'abcd…');
        assert.equal(truncate('abcdefgh', 5, ''), 'abcde');
        assert.equal(padEnd('abcdefgh', 5), 'abcde');
        assert.equal(padStart('abcdefgh', 5), 'abcde');
        // A wide cluster that straddles the cut is dropped and the gap padded.
        assert.equal(padEnd('日本', 3), '日 ');
        assert.equal(padStart('日本', 3), ' 日');
        assert.equal(truncate('日本語', 3), '日…');
        assert.equal(truncate('日本語', 4), '日…');
        assert.equal(truncate('日本語', 6), '日本語');
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
        // Whole seconds, rounded down, so the hint holds still between the clock's ticks.
        assert.equal(agoShort(now - 400, now), 'just now');
        assert.equal(agoShort(now - 999, now), 'just now');
        assert.equal(agoShort(now + 500, now), 'just now', 'a poll stamped after the clock ticked');
        assert.equal(agoShort(now - 1_000, now), '1s ago');
        assert.equal(agoShort(now - 7_100, now), '7s ago');
        assert.equal(agoShort(now - 12_000, now), '12s ago');
        assert.equal(agoShort(now - 59_999, now), '59s ago');
        assert.equal(agoShort(now - 60_000, now), '1m ago');
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
