/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The three write forms and the one program each generates.
 *
 * What is asserted here is the DELTA — the program is only interesting for
 * what it emits — so every test runs the compiled program and reads the
 * `(key, op)` pairs off its emit sink. Two properties are load-bearing and
 * neither is visible from the type: entries come out in the delta's own
 * canonical order (variant cases compare by NAME, so every target's ops are one
 * contiguous ascending run), and an index entry whose key MOVED is a delete
 * plus an insert rather than an update, because `{ik, k}` is the entry's
 * identity.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, IntegerType, NullType, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, variant,
} from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import e3 from './index.js';
import { record } from './record.js';
import { mutation, editMutation, patchMutation } from './mutation.js';
import { recordIndex } from './record-index.js';
import { buildMutationProgram, deltaTargets } from './record-programs.js';
import type { MutationDef, RecordDef } from './types.js';

const RowType = StructType({ status: StringType, due: IntegerType, title: StringType });
const PlansType = DictType(StringType, RowType);
const StatusKeyType = StructType({ status: StringType, due: IntegerType });
const CountsType = DictType(StringType, IntegerType);
const FlagsType = SetType(StringType);

const plans = new SortedMap<string, { status: string; due: bigint; title: string }>([
  ['p1', { status: 'late', due: 3n, title: 'One' }],
  ['p2', { status: 'ok', due: 1n, title: 'Two' }],
], compareFor(StringType));
const counts = new SortedMap<string, bigint>([['a', 1n], ['b', 2n]], compareFor(StringType));
const flags = new SortedSet<string>(['x', 'y'], compareFor(StringType));

/** A record carrying `by_status`: one entry per row, with a covering title. */
function indexedPlans(): RecordDef<typeof PlansType> {
  const rec = record('plans', PlansType, new Map());
  const index = recordIndex('by_status', rec, {
    key: East.function([StringType, RowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due })),
    value: East.function([StringType, RowType], StringType, ($, _k, v) => v.title),
  });
  (rec.indexes as Record<string, unknown>)[index.name] = index;
  return rec;
}

/** The `(key, op)` pairs a mutation's program emits for `state` and `args`. */
function emitted(rec: RecordDef, mut: MutationDef, state: unknown, args: unknown[]): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const run = buildMutationProgram(rec, mut).compile([]) as (...a: unknown[]) => unknown;
  run(state, ...args, (key: unknown, op: unknown) => {
    out.push([key, op]);
    return null;
  });
  return out;
}

/** The delta's `(target, key)` / `(target, op-tag)` pairs, which is what the
 *  apply keys on — the payloads are asserted where they matter. */
function shape(out: [unknown, unknown][]): string[] {
  return out.map(([key, op]) => {
    const k = key as { type: string; value: unknown };
    const o = op as { type: string; value: { type: string } };
    return `${k.type}:${JSON.stringify(k.value, (_n, v) => (typeof v === 'bigint' ? String(v) : v))}=${o.value.type}`;
  });
}

describe('the mutation delta — targets and canonical order', () => {
  it('names the primary and every index, in the order their cases compare', () => {
    const rec = indexedPlans();
    assert.deepEqual(deltaTargets(rec.type, Object.values(rec.indexes)).map((t) => t.name),
      ['by_status', 'primary']);
  });

  it('emits every target\'s ops in one contiguous ascending run', () => {
    const rec = indexedPlans();
    const retitle = mutation('retitle', rec,
      East.function([PlansType, StringType, StringType], PlansType, ($, state, id, title) => {
        const next = $.let(state.copy());
        const row = $.let(next.get(id));
        $(next.insertOrUpdate(id, { status: row.status, due: row.due, title }));
        return next;
      }));
    assert.deepEqual(shape(emitted(rec, retitle, plans, ['p1', 'Renamed'])), [
      'by_status:{"ik":{"status":"late","due":"3"},"k":"p1"}=update',
      'primary:"p1"=update',
    ]);
  });
});

describe('the reduce form', () => {
  it('turns a whole-state replace into per-key ops', () => {
    const rec = record('counts', CountsType, new Map());
    const reset = mutation('reset', rec, East.function([CountsType], CountsType, ($) => {
      const next = $.let(new Map(), CountsType);
      $(next.insert('q', 42n));
      return next;
    }));
    assert.deepEqual(shape(emitted(rec, reset, counts, [])),
      ['primary:"a"=delete', 'primary:"b"=delete', 'primary:"q"=insert']);
  });

  it('writes a Set record\'s delta too — the ops carry no value', () => {
    const rec = record('flags', FlagsType, new Set<string>());
    const raise = mutation('raise', rec, East.function([FlagsType, StringType], FlagsType, ($, state, flag) => {
      const next = $.let(state.copy());
      $(next.insert(flag));
      return next;
    }));
    const out = emitted(rec, raise, flags, ['z']);
    assert.deepEqual(shape(out), ['primary:"z"=insert']);
    assert.equal((out[0]![1] as { value: { value: unknown } }).value.value, null);
  });
});

describe('the edit form', () => {
  it('types the capability from the record: the documented bodies, verbatim, with no casts', () => {
    // The SKILL's two record examples, as written there — so they keep
    // compiling. `edit` is typed from `editTypeOf(plans.type)`, so `edit.set`
    // checks the key and the whole row; a body that leaves a field out does
    // not build.
    const PlanType = StructType({
      title: StringType, owner: StringType, status: StringType,
      due: DateTimeType, resources: SetType(StringType),
    });
    const plans = e3.record('plans', DictType(StringType, PlanType), new Map());

    // `edit` is typed from the record: edit.set(key, row), edit.delete(key),
    // edit.update(key, patch) — each checked against the record's key and row.
    const reschedule = e3.editMutation('reschedule', plans,
      East.function([plans.type, StringType, DateTimeType, e3.editTypeOf(plans.type)], NullType,
        ($, state, id, due, edit) => {
          const plan = $.let(state.get(id));       // one segment decoded, not the record
          $(edit.set(id, { title: plan.title, owner: plan.owner, status: plan.status, due, resources: plan.resources }));
        }));

    const StatusKeyType = StructType({ status: StringType, due: DateTimeType });

    const byStatus = e3.recordIndex('by_status', plans, {
      key:   East.function([StringType, PlanType], StatusKeyType,
               ($, k, v) => ({ status: v.status, due: v.due })),
      value: East.function([StringType, PlanType], StringType, ($, k, v) => v.title),
    });
    const byResource = e3.recordIndex('by_resource', plans, {
      keys: East.function([StringType, PlanType], SetType(StringType), ($, k, v) => v.resources),
    });

    const pkg = e3.package('planning', '1.0.0', plans, reschedule, e3.patchMutation(plans), byStatus, byResource);
    assert.deepEqual(Object.keys(pkg.records.plans!.indexes).sort(), ['by_resource', 'by_status']);

    // And the body does what it says: the row moves in by_status, and
    // by_resource — whose entry neither moved nor carries a value — is untouched.
    const row = { title: 'Pour', owner: 'ana', status: 'late', due: new Date('2026-10-01T00:00:00Z'), resources: new Set(['crane']) };
    const state = new SortedMap([['p1', row]], compareFor(StringType));
    assert.deepEqual(shape(emitted(pkg.records.plans!, reschedule, state, ['p1', new Date('2026-11-01T00:00:00Z')])), [
      'by_status:{"ik":{"status":"late","due":"2026-10-01T00:00:00.000Z"},"k":"p1"}=delete',
      'by_status:{"ik":{"status":"late","due":"2026-11-01T00:00:00.000Z"},"k":"p1"}=insert',
      'primary:"p1"=update',
    ]);
  });

  const EditCounts = editTypeOf(CountsType);
  const rec = record('counts', CountsType, new Map());

  it('resolves a set against the record: an update where it is held, an insert where it is not', () => {
    const write = editMutation('write', rec, East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.set('a', 10n));
      $(edit.set('z', 10n));
    }));
    assert.deepEqual(shape(emitted(rec, write, counts, [])), ['primary:"a"=update', 'primary:"z"=insert']);
  });

  it('folds an update after a set into the set value', () => {
    const write = editMutation('write', rec, East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.set('a', 10n));
      $(edit.update('a', variant('replace', { before: 10n, after: 11n })));
    }));
    const out = emitted(rec, write, counts, []);
    assert.deepEqual(shape(out), ['primary:"a"=update']);
    assert.deepEqual((out[0]![1] as { value: { value: { value: unknown } } }).value.value.value,
      { before: 1n, after: 11n }, 'one op against the state, not two');
  });

  it('composes an update after an update', () => {
    const write = editMutation('write', rec, East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.update('b', variant('replace', { before: 2n, after: 5n })));
      $(edit.update('b', variant('replace', { before: 5n, after: 7n })));
    }));
    const out = emitted(rec, write, counts, []);
    assert.deepEqual((out[0]![1] as { value: { value: { value: unknown } } }).value.value.value,
      { before: 2n, after: 7n });
  });

  it('refuses, naming the key, a delete or update of one the record does not hold', () => {
    for (const write of [
      editMutation('delete', rec, East.function([CountsType, EditCounts], NullType, ($, _s, edit) => {
        $(edit.delete('zz'));
      })),
      editMutation('update', rec, East.function([CountsType, EditCounts], NullType, ($, _s, edit) => {
        $(edit.update('zz', variant('replace', { before: 1n, after: 2n })));
      })),
    ]) {
      assert.throws(() => emitted(rec, write, counts, []),
        /'zz'|"zz"/, `${write.name} of an absent key must name it`);
    }
  });

  it('refuses, at definition time, a body that is not (state, …args, edit) => Null', () => {
    const rec2 = record('counts', CountsType, new Map());
    assert.throws(
      () => editMutation('no_edit', rec2, East.function([CountsType, StringType], NullType, ($) => { void $; }) as never),
      /LAST parameter must be the edit capability/);
    assert.throws(
      () => editMutation('returns', rec2,
        East.function([CountsType, EditCounts], CountsType, ($, state) => state) as never),
      /returns Null/);
    const scalar = record('n', IntegerType, 0n);
    assert.throws(
      () => editMutation('scalar', scalar as never, East.function([IntegerType], NullType, ($) => { void $; }) as never),
      /needs a Dict or Set record/);
  });
});

describe('the patch form', () => {
  const rec = record('counts', CountsType, new Map());
  const patch = patchMutation(rec);

  it('takes one argument, the state\'s patch type, and is named patch by default', () => {
    assert.equal(patch.name, 'patch');
    assert.equal(patch.form, 'patch');
    assert.equal(patch.argTypes.length, 1);
    assert.equal(patch.body, undefined, 'there is no author body to ship');
  });

  it('carries a patch arm through as the primary ops', () => {
    const ops = new SortedMap<string, unknown>([['c', variant('insert', 3n)]], compareFor(StringType));
    assert.deepEqual(shape(emitted(rec, patch, counts, [variant('patch', ops)])), ['primary:"c"=insert']);
  });

  it('turns a replace arm into the ops that differ, after checking its before', () => {
    const after = new SortedMap<string, bigint>([['a', 1n], ['c', 3n]], compareFor(StringType));
    assert.deepEqual(shape(emitted(rec, patch, counts, [variant('replace', { before: counts, after })])),
      ['primary:"b"=delete', 'primary:"c"=insert']);
    assert.throws(
      () => emitted(rec, patch, counts, [variant('replace', {
        before: new SortedMap<string, bigint>([['a', 99n]], compareFor(StringType)),
        after,
      })]),
      /no longer holds/);
  });
});

describe('index maintenance inside the delta', () => {
  const rec = indexedPlans();
  const EditPlans = editTypeOf(PlansType);

  it('moves an entry as a delete plus an insert when its index key changes', () => {
    const move = editMutation('move', rec, East.function([PlansType, EditPlans], NullType, ($, state, edit) => {
      const row = $.let(state.get('p1'));
      $(edit.set('p1', { status: 'ok', due: row.due, title: row.title }));
    }));
    assert.deepEqual(shape(emitted(rec, move, plans, [])), [
      'by_status:{"ik":{"status":"late","due":"3"},"k":"p1"}=delete',
      'by_status:{"ik":{"status":"ok","due":"3"},"k":"p1"}=insert',
      'primary:"p1"=update',
    ]);
  });

  it('updates an entry in place when only the covering projection changes', () => {
    const retitle = editMutation('retitle', rec, East.function([PlansType, EditPlans], NullType, ($, state, edit) => {
      const row = $.let(state.get('p2'));
      $(edit.set('p2', { status: row.status, due: row.due, title: 'Renamed' }));
    }));
    assert.deepEqual(shape(emitted(rec, retitle, plans, [])), [
      'by_status:{"ik":{"status":"ok","due":"1"},"k":"p2"}=update',
      'primary:"p2"=update',
    ]);
  });

  it('leaves the index alone when neither its key nor its projection moved', () => {
    const rec2 = record('plans', PlansType, new Map());
    const index = recordIndex('by_status', rec2, {
      key: East.function([StringType, RowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due })),
    });
    (rec2.indexes as Record<string, unknown>)[index.name] = index;
    const retitle = editMutation('retitle', rec2,
      East.function([PlansType, editTypeOf(PlansType)], NullType, ($, state, edit) => {
        const row = $.let(state.get('p2'));
        $(edit.set('p2', { status: row.status, due: row.due, title: 'Renamed' }));
      }));
    assert.deepEqual(shape(emitted(rec2, retitle, plans, [])), ['primary:"p2"=update']);
  });

  it('carries a multi-valued index\'s entries one per element of the returned set', () => {
    const TagRowType = StructType({ tags: SetType(StringType) });
    const TaggedType = DictType(StringType, TagRowType);
    const rec2 = record('tagged', TaggedType, new Map());
    const index = recordIndex('by_tag', rec2, {
      keys: East.function([StringType, TagRowType], SetType(StringType), ($, _k, v) => v.tags),
    });
    (rec2.indexes as Record<string, unknown>)[index.name] = index;
    const retag = editMutation('retag', rec2,
      East.function([TaggedType, editTypeOf(TaggedType)], NullType, ($, _s, edit) => {
        $(edit.set('t1', { tags: new Set(['b', 'c']) }));
      }));
    const state = new SortedMap<string, { tags: Set<string> }>([
      ['t1', { tags: new Set(['a', 'b']) }],
    ], compareFor(StringType));
    assert.deepEqual(shape(emitted(rec2, retag, state, [])), [
      'by_tag:{"ik":"a","k":"t1"}=delete',
      'by_tag:{"ik":"c","k":"t1"}=insert',
      'primary:"t1"=update',
    ]);
  });
});
