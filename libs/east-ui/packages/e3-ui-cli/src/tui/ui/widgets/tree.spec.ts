/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, StringType, StructType, toEastTypeValue } from '@elaraai/east';
import { parseFindText } from './tree.js';

describe('parseFindText', () => {
    const StringKey = toEastTypeValue(StringType);
    const MachineKey = toEastTypeValue(StructType({ machine: StringType, shift: IntegerType }));

    test('reads a key as the browser does: quoted is exact, bare a prefix, `..` a range', () => {
        // The terminal parses with the browser's grammar, so one typed key
        // means the same thing in both — the quote included, which is what
        // lets a key holding `..` be found at all.
        assert.deepEqual(parseFindText(StringKey, '"k0007"'), { kind: 'query', query: { key: '"k0007"' } });
        assert.deepEqual(parseFindText(StringKey, ' k015 '), { kind: 'query', query: { prefix: 'k015' } });
        assert.deepEqual(parseFindText(StringKey, 'k0150..k0152'),
            { kind: 'query', query: { from: ['"k0150"'], to: ['"k0152"'] } });
        assert.deepEqual(parseFindText(StringKey, '"a..b"'), { kind: 'query', query: { key: '"a..b"' } });
        assert.equal(parseFindText(StringKey, '..').kind, 'hint');
        assert.deepEqual(parseFindText(MachineKey, 'press|2'), { kind: 'query', query: { fields: ['"press"', '2'] } });
    });
});
