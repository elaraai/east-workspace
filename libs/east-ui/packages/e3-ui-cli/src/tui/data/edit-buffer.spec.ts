/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, DictType, FloatType, IntegerType, NullType, StringType, StructType, VariantType, OptionType, none, some, toEastTypeValue, variant } from '@elaraai/east';
import { changedNames, describeOp, markOf, pushOp, replay, startEdit } from './edit-buffer.js';
import type { EditOp } from '../state/actions.js';

const ParamsType = toEastTypeValue(StructType({
    horizon: IntegerType,
    seasonality: VariantType({ weekly: NullType, monthly: NullType }),
    smoothing: FloatType,
    stores: ArrayType(StringType),
    holidays: DictType(StringType, IntegerType),
    notes: OptionType(StringType),
}));

const base = () => ({ horizon: 14n, seasonality: variant('weekly', null), smoothing: 0.35, stores: ['Bakery', 'Deli'], holidays: new Map([['xmas', 25n]]), notes: none });

const field = (name: string) => variant('field', name) as never;

describe('edit buffer', () => {
    test('ops build the draft in order and mark the rows they touched', () => {
        let edit = startEdit('main', '.inputs.params', ParamsType, base(), 'h1');
        assert.equal(edit.ops.length, 0);
        assert.equal(edit.root.type, 'struct');
        edit = pushOp(edit, { kind: 'edit', path: [field('smoothing')], leaf: variant('float', 0.5) as never });
        edit = pushOp(edit, { kind: 'tag', path: [field('seasonality')], tag: 'monthly' });
        edit = pushOp(edit, { kind: 'insert', path: [field('stores'), variant('append', null) as never] });
        edit = pushOp(edit, { kind: 'edit', path: [field('stores'), variant('index', 2n) as never], leaf: variant('string', 'Produce') as never });
        edit = pushOp(edit, { kind: 'remove', path: [field('stores'), variant('index', 0n) as never] });
        edit = pushOp(edit, { kind: 'insert', path: [field('holidays'), variant('key', 'easter') as never] });
        edit = pushOp(edit, { kind: 'tag', path: [field('notes')], tag: 'some' });
        edit = pushOp(edit, { kind: 'edit', path: [field('notes'), some(null) as never], leaf: variant('string', 'hi') as never });
        const draft = edit.draft as { smoothing: number; seasonality: { type: string }; stores: string[]; holidays: Map<string, bigint>; notes: { type: string; value: string } };
        assert.equal(draft.smoothing, 0.5);
        assert.equal(draft.seasonality.type, 'monthly');
        assert.deepEqual(draft.stores, ['Deli', 'Produce']);
        assert.deepEqual([...draft.holidays.keys()].sort(), ['easter', 'xmas']);
        assert.equal(draft.holidays.get('easter'), 0n);
        assert.equal(draft.notes.type, 'some');
        assert.equal(draft.notes.value, 'hi');
        assert.equal(edit.ops.length, 8);
        assert.deepEqual(edit.changed, ['.smoothing', '.seasonality', '.stores', '.stores[2]', '.holidays', '.notes', '.notes?']);
        assert.deepEqual(changedNames(edit), ['smoothing', 'seasonality', 'stores', 'stores', 'holidays', 'notes', 'notes']);
        assert.equal((edit.base as { smoothing: number }).smoothing, 0.35, 'the base is untouched');
    });

    test('replay re-applies the ops onto a new base and drops the ones that no longer apply', () => {
        let edit = startEdit('main', '.inputs.params', ParamsType, base(), 'h1');
        edit = pushOp(edit, { kind: 'edit', path: [field('smoothing')], leaf: variant('float', 0.5) as never });
        edit = pushOp(edit, { kind: 'edit', path: [field('holidays'), variant('key', 'xmas') as never], leaf: variant('integer', 26n) as never });
        const newer = { ...base(), horizon: 21n, holidays: new Map<string, bigint>() };
        const { edit: rebased, dropped } = replay(edit, newer, 'h2');
        assert.equal(rebased.baseHash, 'h2');
        assert.equal(rebased.conflict, null);
        assert.equal((rebased.draft as { horizon: bigint }).horizon, 21n);
        assert.equal((rebased.draft as { smoothing: number }).smoothing, 0.5);
        assert.equal(rebased.ops.length, 1);
        assert.equal(dropped.length, 1);
        assert.equal(describeOp(dropped[0]!), 'edit .holidays{xmas}');
    });

    test('markOf and describeOp', () => {
        const insert: EditOp = { kind: 'insert', path: [field('stores'), variant('append', null) as never] };
        assert.equal(markOf(insert), '.stores');
        assert.equal(describeOp(insert), 'add .stores!');
        const remove: EditOp = { kind: 'remove', path: [field('stores'), variant('index', 1n) as never] };
        assert.equal(markOf(remove), '.stores');
        assert.equal(describeOp({ kind: 'tag', path: [field('notes')], tag: 'none' }), 'tag .notes none');
    });
});
