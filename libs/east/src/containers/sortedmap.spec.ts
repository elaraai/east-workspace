/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SortedMap } from './sortedmap.js';

describe('SortedMap', () => {
    test('should create empty map', () => {
        const map = new SortedMap<number, string>();
        assert.equal(map.size, 0);
    });

    test('should create map from iterable', () => {
        const map = new SortedMap<number, string>([[1, 'one'], [2, 'two']]);
        assert.equal(map.size, 2);
        assert.equal(map.get(1), 'one');
        assert.equal(map.get(2), 'two');
    });

    test('should set and get values', () => {
        const map = new SortedMap<string, number>();
        map.set('a', 1);
        map.set('b', 2);
        assert.equal(map.get('a'), 1);
        assert.equal(map.get('b'), 2);
        assert.equal(map.size, 2);
    });

    test('should update existing key', () => {
        const map = new SortedMap<string, number>();
        map.set('a', 1);
        map.set('a', 42);
        assert.equal(map.get('a'), 42);
        assert.equal(map.size, 1);
    });

    test('should check key existence with has', () => {
        const map = new SortedMap<string, number>();
        map.set('a', 1);
        assert.equal(map.has('a'), true);
        assert.equal(map.has('b'), false);
    });

    test('should delete keys', () => {
        const map = new SortedMap<string, number>();
        map.set('a', 1);
        map.set('b', 2);
        assert.equal(map.delete('a'), true);
        assert.equal(map.has('a'), false);
        assert.equal(map.size, 1);
        assert.equal(map.delete('a'), false);
    });

    test('should clear all entries', () => {
        const map = new SortedMap<string, number>();
        map.set('a', 1);
        map.set('b', 2);
        map.clear();
        assert.equal(map.size, 0);
        assert.equal(map.has('a'), false);
        assert.equal(map.has('b'), false);
    });

    test('should iterate in sorted order', () => {
        const map = new SortedMap<number, string>();
        map.set(3, 'three');
        map.set(1, 'one');
        map.set(2, 'two');

        const keys = Array.from(map.keys());
        assert.deepEqual(keys, [1, 2, 3]);

        const values = Array.from(map.values());
        assert.deepEqual(values, ['one', 'two', 'three']);

        const entries = Array.from(map.entries());
        assert.deepEqual(entries, [[1, 'one'], [2, 'two'], [3, 'three']]);
    });

    test('should use custom comparator', () => {
        // Reverse order comparator
        const map = new SortedMap<number, string>(undefined, (a, b) => b - a);
        map.set(1, 'one');
        map.set(2, 'two');
        map.set(3, 'three');

        const keys = Array.from(map.keys());
        assert.deepEqual(keys, [3, 2, 1]);
    });

    test('should get min and max keys', () => {
        const map = new SortedMap<number, string>();
        assert.equal(map.minKey(), undefined);
        assert.equal(map.maxKey(), undefined);

        map.set(5, 'five');
        map.set(1, 'one');
        map.set(9, 'nine');

        assert.equal(map.minKey(), 1);
        assert.equal(map.maxKey(), 9);
    });

    test('should iterate from specific key', () => {
        const map = new SortedMap<number, string>();
        map.set(1, 'one');
        map.set(2, 'two');
        map.set(3, 'three');
        map.set(4, 'four');

        const keysFrom2 = Array.from(map.keys(2));
        assert.deepEqual(keysFrom2, [2, 3, 4]);

        const valuesFrom3 = Array.from(map.values(3));
        assert.deepEqual(valuesFrom3, ['three', 'four']);

        const entriesFrom2 = Array.from(map.entries(2));
        assert.deepEqual(entriesFrom2, [[2, 'two'], [3, 'three'], [4, 'four']]);
    });

    test('should work with forEach', () => {
        const map = new SortedMap<number, string>();
        map.set(2, 'two');
        map.set(1, 'one');
        map.set(3, 'three');

        const collected: [number, string][] = [];
        map.forEach((value, key) => {
            collected.push([key, value]);
        });

        assert.deepEqual(collected, [[1, 'one'], [2, 'two'], [3, 'three']]);
    });

    test('should be iterable with Symbol.iterator', () => {
        const map = new SortedMap<number, string>();
        map.set(3, 'three');
        map.set(1, 'one');
        map.set(2, 'two');

        const entries = [...map];
        assert.deepEqual(entries, [[1, 'one'], [2, 'two'], [3, 'three']]);
    });

    test('should have correct Symbol.toStringTag', () => {
        const map = new SortedMap<number, string>();
        assert.equal(map[Symbol.toStringTag], 'SortedMap');
        assert.equal(Object.prototype.toString.call(map), '[object SortedMap]');
    });

    test('should prevent modification when frozen', () => {
        const map = new SortedMap<string, number>();
        map.set('a', 1);
        Object.freeze(map);

        assert.throws(() => map.set('b', 2), TypeError);
        assert.throws(() => map.delete('a'), TypeError);
        assert.throws(() => map.clear(), TypeError);

        // Read operations should still work
        assert.equal(map.get('a'), 1);
        assert.equal(map.has('a'), true);
    });

    test('should group items by key', () => {
        const items = [
            { category: 'fruit', name: 'apple' },
            { category: 'vegetable', name: 'carrot' },
            { category: 'fruit', name: 'banana' },
            { category: 'vegetable', name: 'broccoli' },
        ];

        const grouped = SortedMap.groupBy(items, item => item.category);

        assert.equal(grouped.size, 2);
        assert.deepEqual(grouped.get('fruit'), [
            { category: 'fruit', name: 'apple' },
            { category: 'fruit', name: 'banana' },
        ]);
        assert.deepEqual(grouped.get('vegetable'), [
            { category: 'vegetable', name: 'carrot' },
            { category: 'vegetable', name: 'broccoli' },
        ]);
    });

    test('should group items with custom comparator', () => {
        const items = [
            { priority: 2, task: 'task2' },
            { priority: 1, task: 'task1' },
            { priority: 3, task: 'task3' },
            { priority: 1, task: 'task1b' },
        ];

        // Reverse order comparator
        const grouped = SortedMap.groupBy(
            items,
            item => item.priority,
            (a, b) => b - a
        );

        const priorities = Array.from(grouped.keys());
        assert.deepEqual(priorities, [3, 2, 1]);
    });

    describe('getOrInsert', () => {
        test('sets and returns the value when the key is absent', () => {
            const map = new SortedMap<string, number>();
            assert.equal(map.getOrInsert('a', 1), 1);
            assert.equal(map.get('a'), 1);
            assert.equal(map.size, 1);
        });

        test('returns the value held and sets nothing when the key is present', () => {
            const map = new SortedMap<string, number>([['a', 1]]);
            assert.equal(map.getOrInsert('a', 2), 1);
            assert.equal(map.get('a'), 1);
            assert.equal(map.size, 1);
        });

        test('keeps a falsy value and an undefined value held for a key', () => {
            const map = new SortedMap<string, number | undefined>([['zero', 0], ['none', undefined]]);
            assert.equal(map.getOrInsert('zero', 5), 0);
            assert.equal(map.getOrInsert('none', 5), undefined);
            assert.equal(map.size, 2);
        });

        test('finds a key by the comparison function, not by identity', () => {
            const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
            const held = { id: 1 };
            const map = new SortedMap<{ id: number }, string>([[held, 'held']], byId);
            assert.equal(map.getOrInsert({ id: 1 }, 'other'), 'held');
            assert.equal(map.size, 1);
            assert.equal(map.minKey(), held);
            assert.equal(map.getOrInsert({ id: 0 }, 'first'), 'first');
            assert.deepEqual([...map.values()], ['first', 'held']);
        });

        test('throws on a frozen map only when it would set', () => {
            const map = Object.freeze(new SortedMap<string, number>([['a', 1]]));
            assert.equal(map.getOrInsert('a', 2), 1);
            assert.throws(() => map.getOrInsert('b', 2), /frozen/);
            assert.equal(map.has('b'), false);
        });
    });

    describe('getOrInsertComputed', () => {
        test('computes from the key and sets when the key is absent', () => {
            const map = new SortedMap<string, number>();
            assert.equal(map.getOrInsertComputed('abc', key => key.length), 3);
            assert.equal(map.get('abc'), 3);
        });

        test('does not call the callback when the key is present, undefined value included', () => {
            const map = new SortedMap<string, number | undefined>([['a', 1], ['none', undefined]]);
            const never = () => assert.fail('callback called');
            assert.equal(map.getOrInsertComputed('a', never), 1);
            assert.equal(map.getOrInsertComputed('none', never), undefined);
        });

        test('finds a key by the comparison function, reversed order kept', () => {
            const map = new SortedMap<number, string>([[1, 'one']], (a, b) => b - a);
            assert.equal(map.getOrInsertComputed(1, () => assert.fail('callback called')), 'one');
            assert.equal(map.getOrInsertComputed(2, key => `#${key}`), '#2');
            assert.deepEqual([...map.keys()], [2, 1]);
        });

        test('leaves the computed value when the callback sets the same key', () => {
            const map = new SortedMap<string, number>();
            assert.equal(map.getOrInsertComputed('a', () => { map.set('a', 1); return 2; }), 2);
            assert.equal(map.get('a'), 2);
            assert.equal(map.size, 1);
        });

        test('throws on a frozen map before the callback when it would set', () => {
            const map = Object.freeze(new SortedMap<string, number>([['a', 1]]));
            assert.equal(map.getOrInsertComputed('a', () => assert.fail('callback called')), 1);
            assert.throws(() => map.getOrInsertComputed('b', () => assert.fail('callback called')), /frozen/);
        });
    });

    test('should handle falsy values', () => {
        const map = new SortedMap<string, number | boolean | null>();
        map.set('zero', 0);
        map.set('false', false);
        map.set('null', null);

        assert.equal(map.get('zero'), 0);
        assert.equal(map.get('false'), false);
        assert.equal(map.get('null'), null);
        assert.equal(map.has('zero'), true);
        assert.equal(map.has('false'), true);
        assert.equal(map.has('null'), true);
    });
});
