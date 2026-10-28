/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The three write forms and the one program each generates.
 *
 * What is asserted here is the DELTA — the program is only interesting for
 * what it emits — so every test runs the compiled program, reads the
 * `(key, op)` pairs off its emit, and sorts them by the delta's key as the
 * runner's RunSorter does. Three properties are load-bearing and none is
 * visible from the type: no key is emitted twice, since the delta is a dict
 * with no merge; in the delta's canonical order every target's ops are one
 * contiguous ascending run, since variant cases compare by NAME; and an index
 * entry whose key MOVED is a delete plus an insert rather than an update,
 * because `{ik, k}` is the entry's identity.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, IntegerType, NullType, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, equalFor, isVariant, parseFor, printFor, toEastTypeValue, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { DELTA_CONFLICT, RecordSummaryOpType, editTypeOf, mutationDeltaType } from '@elaraai/e3-types';
import e3 from './index.js';
import { record } from './record.js';
import type { MutationBuilder, MutationDraft } from './record-builders.js';
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

/** A record carrying `by_status` — one entry per row, with a covering title — and the mutations given. */
function indexedPlans<M extends Readonly<Record<string, MutationDraft>>>(mutations: (mutation: MutationBuilder<typeof PlansType>) => M) {
  return record('plans', PlansType, {
    initial: new Map(),
    indexes: (index) => ({
      by_status: index.key(
        East.function([StringType, RowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due })),
        { value: East.function([StringType, RowType], StringType, ($, _k, v) => v.title) },
      ),
    }),
    mutations,
  });
}

/** The delta a mutation's program writes for `state` and `args`: the
 *  `(key, op)` pairs it emits, sorted by the delta's key as the runner sorts
 *  them, none emitted twice. */
/** A delta's key or op, as the variant it is: the target it is of, and what it carries. */
function partOf(part: unknown): variant {
  assert.ok(isVariant(part), 'a delta entry is a variant of its target');
  return part;
}

/** One entry a write's program emitted: the target it changes, its key there, and its op. */
interface Emitted {
  /** `primary`, an index's name, or the conflict. */
  readonly target: string;
  /** The key, as East prints it at the target's key type. */
  readonly key: string;
  /** The key's value. */
  readonly keyValue: unknown;
  /** The target's op — `insert`, `delete`, `update`, `add` — or a conflict's Null. */
  readonly op: unknown;
  /** What went stale, in words, for the conflict's entry. */
  readonly conflict?: string;
}

/** What a write's program emits, in the delta's order: a dict, so no key twice. */
function emitted(rec: RecordDef, mut: MutationDef, state: ValueTypeOf<EastType>, args: ValueTypeOf<EastType>[]): Emitted[] {
  const out: [unknown, unknown][] = [];
  const run = buildMutationProgram(rec, mut).compile([]);
  run(state, ...args, (key: unknown, op: unknown) => {
    out.push([key, op]);
    return null;
  });
  const targets = deltaTargets(rec.type, Object.values(rec.indexes));
  const compare = compareFor(toEastTypeValue(mutationDeltaType(targets).key));
  out.sort(([a], [b]) => compare(a, b));
  for (let i = 1; i < out.length; i++) {
    assert.notEqual(compare(out[i - 1]![0], out[i]![0]), 0, 'the delta is a dict with no merge: no key is emitted twice');
  }
  const printers = new Map(targets.map((target) => [target.name, printFor(toEastTypeValue(target.keyType))]));
  printers.set(DELTA_CONFLICT, printFor(toEastTypeValue(StringType)));
  return out.map(([key, op]) => {
    const { type: target, value } = partOf(key);
    const print = printers.get(target);
    assert.ok(print !== undefined, `the delta's targets name '${target}'`);
    const conflict: string | undefined = target === DELTA_CONFLICT ? value : undefined;
    return { target, key: print(value), keyValue: value, op: partOf(op).value, ...(conflict !== undefined && { conflict }) };
  });
}

/** The conflict a delta names, if it names one: it sorts first. */
function conflictOf(out: Emitted[]): string | undefined {
  return out[0]?.conflict;
}

/** The delta's `(target, key)` / `(target, op-tag)` pairs, which is what the
 *  apply keys on — the payloads are asserted where they matter. */
function shape(out: Emitted[]): string[] {
  return out.map((entry) => `${entry.target}:${entry.key}=${partOf(entry.op).type}`);
}

describe('the mutation delta — targets and canonical order', () => {
  it('names the primary and every index, in the order their cases compare', () => {
    const rec = indexedPlans(() => ({}));
    assert.deepEqual(deltaTargets(rec.type, Object.values(rec.indexes)).map((t) => t.name),
      ['by_status', 'primary']);
  });

  it('writes every target\'s ops in one contiguous ascending run', () => {
    const rec = indexedPlans((mutation) => ({
      retitle: mutation.reduce(East.function([PlansType, StringType, StringType], PlansType, ($, state, id, title) => {
        const next = $.let(state.copy());
        const row = $.let(next.get(id));
        $(next.insertOrUpdate(id, { status: row.status, due: row.due, title }));
        return next;
      })),
    }));
    assert.deepEqual(shape(emitted(rec, rec.mutations.retitle, plans, ['p1', 'Renamed'])), [
      'by_status:(ik=(status="late", due=3), k="p1")=update',
      'primary:"p1"=update',
    ]);
  });
});

describe('the reduce form', () => {
  it('turns a whole-state replace into per-key ops', () => {
    const rec = record('counts', CountsType, {
      initial: new Map(),
      mutations: (mutation) => ({
        reset: mutation.reduce(East.function([CountsType], CountsType, ($) => {
          const next = $.let(new Map(), CountsType);
          $(next.insert('q', 42n));
          return next;
        })),
      }),
    });
    const reset = rec.mutations.reset;
    assert.deepEqual(shape(emitted(rec, reset, counts, [])),
      ['primary:"a"=delete', 'primary:"b"=delete', 'primary:"q"=insert']);
  });

  it('writes a Set record\'s delta too — the ops carry no value', () => {
    const rec = record('flags', FlagsType, {
      initial: new Set<string>(),
      mutations: (mutation) => ({
        raise: mutation.reduce(East.function([FlagsType, StringType], FlagsType, ($, state, flag) => {
          const next = $.let(state.copy());
          $(next.insert(flag));
          return next;
        })),
      }),
    });
    const raise = rec.mutations.raise;
    const out = emitted(rec, raise, flags, ['z']);
    assert.deepEqual(shape(out), ['primary:"z"=insert']);
    assert.equal(partOf(out[0]!.op).value, null);
  });
});

describe('the edit form', () => {
  it('types the capability from the record: the documented bodies, verbatim, with no casts', () => {
    // Two documented record examples, written as an author would — so they
    // keep compiling. `edit` is typed from `e3.mutation.editType(PlansType)`,
    // so `edit.set` checks the key and the whole row; a body that leaves a
    // field out does not build.
    const PlanType = StructType({
      title: StringType, owner: StringType, status: StringType,
      due: DateTimeType, resources: SetType(StringType),
    });
    const PlansType = DictType(StringType, PlanType);
    const StatusKeyType = StructType({ status: StringType, due: DateTimeType });

    const plans = e3.record('plans', PlansType, {
      initial: new Map(),
      indexes: (index) => ({
        by_status: index.key(
          East.function([StringType, PlanType], StatusKeyType, ($, k, v) => ({ status: v.status, due: v.due })),
          { value: East.function([StringType, PlanType], StringType, ($, k, v) => v.title) },
        ),
        by_resource: index.keys(East.function([StringType, PlanType], SetType(StringType), ($, k, v) => v.resources)),
      }),
      mutations: (mutation) => ({
        // `edit` is typed from the record: edit.set(key, row), edit.delete(key),
        // edit.update(key, patch) — each checked against the record's key and row.
        reschedule: mutation.edit(East.function([PlansType, StringType, DateTimeType, e3.mutation.editType(PlansType)], NullType,
          ($, state, id, due, edit) => {
            const plan = $.let(state.get(id));       // one segment decoded, not the record
            $(edit.set(id, { title: plan.title, owner: plan.owner, status: plan.status, due, resources: plan.resources }));
          })),
        patch: mutation.patch(),
      }),
    });

    const pkg = e3.package('planning', '1.0.0', plans);
    assert.deepEqual(Object.keys(pkg.records.plans!.indexes).sort(), ['by_resource', 'by_status']);

    // And the body does what it says: the row moves in by_status, and
    // by_resource — whose entry neither moved nor carries a value — is untouched.
    const row = { title: 'Pour', owner: 'ana', status: 'late', due: new Date('2026-10-01T00:00:00Z'), resources: new Set(['crane']) };
    const state = new SortedMap([['p1', row]], compareFor(StringType));
    assert.deepEqual(shape(emitted(pkg.records.plans!, plans.mutations.reschedule, state, ['p1', new Date('2026-11-01T00:00:00Z')])), [
      'by_status:(ik=(status="late", due=2026-10-01T00:00:00.000), k="p1")=delete',
      'by_status:(ik=(status="late", due=2026-11-01T00:00:00.000), k="p1")=insert',
      'primary:"p1"=update',
    ]);
  });

  const EditCounts = editTypeOf(CountsType);
  /** The counts record declaring one edit body, `write`: the record, and the mutation as `e3.record` built it. */
  const writing = (fn: unknown) => {
    const rec = record('counts', CountsType, { initial: new Map(), mutations: (mutation) => ({ write: mutation.edit(fn as never) }) });
    return { rec, write: rec.mutations.write };
  };

  it('resolves a set against the record: an update where it is held, an insert where it is not', () => {
    const { rec, write: write } = writing(East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.set('a', 10n));
      $(edit.set('z', 10n));
    }));
    assert.deepEqual(shape(emitted(rec, write, counts, [])), ['primary:"a"=update', 'primary:"z"=insert']);
  });

  it('folds an update after a set into the set value', () => {
    const { rec, write: write } = writing(East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.set('a', 10n));
      $(edit.update('a', variant('replace', { before: 10n, after: 11n })));
    }));
    const out = emitted(rec, write, counts, []);
    assert.deepEqual(shape(out), ['primary:"a"=update']);
    assert.deepEqual(partOf(partOf(out[0]!.op).value).value, { before: 1n, after: 11n }, 'one op against the state, not two');
  });

  it('composes an update after an update', () => {
    const { rec, write: write } = writing(East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.update('b', variant('replace', { before: 2n, after: 5n })));
      $(edit.update('b', variant('replace', { before: 5n, after: 7n })));
    }));
    const out = emitted(rec, write, counts, []);
    assert.deepEqual(partOf(partOf(out[0]!.op).value).value, { before: 2n, after: 7n });
  });

  it('writes a conflict naming the key for a delete or update of one the record does not hold', () => {
    const deleted = writing(East.function([CountsType, EditCounts], NullType, ($, _s, edit) => {
      $(edit.delete('zz'));
    }));
    assert.equal(conflictOf(emitted(deleted.rec, deleted.write, counts, [])), 'delete of "zz", which the record does not hold');
    const updated = writing(East.function([CountsType, EditCounts], NullType, ($, _s, edit) => {
      $(edit.update('zz', variant('replace', { before: 1n, after: 2n })));
    }));
    assert.equal(conflictOf(emitted(updated.rec, updated.write, counts, [])), 'update of "zz", which the record does not hold');
  });

  it('writes nothing for a key the body created and deleted again', () => {
    // The record never held `zz`, so creating and removing it changed nothing:
    // folded into a delete, the pair would be refused as a stale write that no
    // resubmission could ever get past.
    const { rec, write: churn } = writing(East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.set('zz', 10n));
      $(edit.delete('zz'));
    }));
    assert.deepEqual(shape(emitted(rec, churn, counts, [])), []);
  });

  it('deletes a held key the body set before deleting it', () => {
    const { rec, write: drop } = writing(East.function([CountsType, EditCounts], NullType, ($, _state, edit) => {
      $(edit.set('a', 10n));
      $(edit.delete('a'));
    }));
    assert.deepEqual(shape(emitted(rec, drop, counts, [])), ['primary:"a"=delete']);
  });

  it('refuses, at definition time, a body that is not (state, …args, edit) => Null', () => {
    assert.throws(() => writing(East.function([CountsType, StringType], NullType, ($) => { void $; })),
      /LAST parameter must be the edit capability/);
    assert.throws(() => writing(East.function([CountsType, EditCounts], CountsType, ($, state) => state)), /returns Null/);
    assert.throws(
      () => record('n', IntegerType, { initial: 0n, mutations: (mutation) => ({ scalar: mutation.edit(East.function([IntegerType], NullType, ($) => { void $; }) as never) }) }),
      /needs a Dict or Set record/);
  });
});

describe('the patch form', () => {
  const rec = record('counts', CountsType, {
    initial: new Map(),
    mutations: (mutation) => ({
      patch: mutation.patch(),
    }),
  });
  const patch = rec.mutations.patch;

  it('takes one argument, the state\'s patch type, and is named patch', () => {
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
    assert.equal(conflictOf(emitted(rec, patch, counts, [variant('replace', {
      before: new SortedMap<string, bigint>([['a', 99n]], compareFor(StringType)),
      after,
    })])), 'the patch replaces a state the record no longer holds');
  });
});

describe('index maintenance inside the delta', () => {
  const EditPlans = editTypeOf(PlansType);

  it('moves an entry as a delete plus an insert when its index key changes', () => {
    const rec = indexedPlans((mutation) => ({
      move: mutation.edit(East.function([PlansType, EditPlans], NullType, ($, state, edit) => {
        const row = $.let(state.get('p1'));
        $(edit.set('p1', { status: 'ok', due: row.due, title: row.title }));
      })),
    }));
    assert.deepEqual(shape(emitted(rec, rec.mutations.move, plans, [])), [
      'by_status:(ik=(status="late", due=3), k="p1")=delete',
      'by_status:(ik=(status="ok", due=3), k="p1")=insert',
      'primary:"p1"=update',
    ]);
  });

  it('updates an entry in place when only the covering projection changes', () => {
    const rec = indexedPlans((mutation) => ({
      retitle: mutation.edit(East.function([PlansType, EditPlans], NullType, ($, state, edit) => {
        const row = $.let(state.get('p2'));
        $(edit.set('p2', { status: row.status, due: row.due, title: 'Renamed' }));
      })),
    }));
    assert.deepEqual(shape(emitted(rec, rec.mutations.retitle, plans, [])), [
      'by_status:(ik=(status="ok", due=1), k="p2")=update',
      'primary:"p2"=update',
    ]);
  });

  it('writes a stale update as a conflict naming the key', () => {
    // An indexed record applies the patch itself, to learn where the row's
    // entries move. A row that no longer matches the patch is a stale write
    // here exactly as it is where the engine applies an unindexed record's
    // patch: a caller re-reads and resubmits a conflict, but gives up on a
    // failed program.
    const stale = new SortedMap<string, unknown>([['p1', variant('update', variant('patch', {
      status: variant('unchanged', null),
      due: variant('unchanged', null),
      title: variant('replace', { before: 'Not the title', after: 'Renamed' }),
    }))]], compareFor(StringType));
    const rec = indexedPlans((mutation) => ({ patch: mutation.patch() }));
    assert.equal(conflictOf(emitted(rec, rec.mutations.patch, plans, [variant('patch', stale)])),
      'update of "p1", whose row no longer matches the patch');
  });

  it('leaves the index alone when neither its key nor its projection moved', () => {
    const rec2 = record('plans', PlansType, {
      initial: new Map(),
      indexes: (index) => ({
        by_status: index.key(East.function([StringType, RowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due }))),
      }),
      mutations: (mutation) => ({
        retitle: mutation.edit(East.function([PlansType, editTypeOf(PlansType)], NullType, ($, state, edit) => {
          const row = $.let(state.get('p2'));
          $(edit.set('p2', { status: row.status, due: row.due, title: 'Renamed' }));
        })),
      }),
    });
    assert.deepEqual(shape(emitted(rec2, rec2.mutations.retitle, plans, [])), ['primary:"p2"=update']);
  });

  it('carries a multi-valued index\'s entries one per element of the returned set', () => {
    const TagRowType = StructType({ tags: SetType(StringType) });
    const TaggedType = DictType(StringType, TagRowType);
    const rec2 = record('tagged', TaggedType, {
      initial: new Map(),
      indexes: (index) => ({
        by_tag: index.keys(East.function([StringType, TagRowType], SetType(StringType), ($, _k, v) => v.tags)),
      }),
      mutations: (mutation) => ({
        retag: mutation.edit(East.function([TaggedType, editTypeOf(TaggedType)], NullType, ($, _s, edit) => {
          $(edit.set('t1', { tags: new Set(['b', 'c']) }));
        })),
      }),
    });
    const retag = rec2.mutations.retag;
    const state = new SortedMap<string, { tags: Set<string> }>([
      ['t1', { tags: new Set(['a', 'b']) }],
    ], compareFor(StringType));
    assert.deepEqual(shape(emitted(rec2, retag, state, [])), [
      'by_tag:(ik="a", k="t1")=delete',
      'by_tag:(ik="c", k="t1")=insert',
      'primary:"t1"=update',
    ]);
  });
});

describe('a series and a summary index inside the delta (#1433)', () => {
  const JobRow = StructType({ press: StringType, start: DateTimeType, end: DateTimeType });
  const JobsType = DictType(StringType, JobRow);
  const instant = (text: string) => {
    const read = parseFor(DateTimeType)(text);
    if (!read.success) throw new Error(`'${text}' is not an instant East reads`);
    return read.value;
  };
  const HOUR = 3_600_000n;

  it('moves an event that changes its level as a delete at the old level and an insert at the new, and the summary by what each month lost and gained', () => {
    const rec = record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({
        jobs_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        jobs_by_press_month: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'month' }),
      }),
      mutations: (mutation) => ({
        stretch: mutation.edit(East.function([JobsType, editTypeOf(JobsType)], NullType, ($, _state, edit) => {
          $(edit.set('W-1', { press: 'P-1', start: instant('2026-10-07T06:00:00.000'), end: instant('2026-11-16T06:00:00.000') }));
        })),
      }),
    });
    const stretch = rec.mutations.stretch;
    const { jobs_by_press_month: summary, jobs_by_press_week: series } = rec.indexes;
    // Eight hours on Wednesday 30 September, in the week of the 28th; then moved to 7 October and stretched to forty days.
    const state = new SortedMap([['W-1', { press: 'P-1', start: instant('2026-09-30T06:00:00.000'), end: instant('2026-09-30T14:00:00.000') }]],
      compareFor(StringType));
    const out = emitted(rec, stretch, state, []);
    const of = (target: string) => out.filter((entry) => entry.target === target)
      .map((entry) => ({ key: entry.keyValue, op: partOf(entry.op) }));

    // The series: its week entry deleted, a quarter entry inserted — forty days is past a month's 28, within a quarter's 90.
    const SeriesEntry = StructType({ ik: series.keyType, k: StringType });
    const moved = of(series.name);
    assert.deepEqual(moved.map(({ op }) => op.type).sort(), ['delete', 'insert'], 'one entry out, one in');
    const expected: Record<string, ValueTypeOf<typeof SeriesEntry>> = {
      delete: { ik: { on: {}, key: 'P-1', level: variant('week', null), tile: instant('2026-09-28T00:00:00.000') }, k: 'W-1' },
      insert: { ik: { on: {}, key: 'P-1', level: variant('quarter', null), tile: instant('2026-10-01T00:00:00.000') }, k: 'W-1' },
    };
    for (const { key, op } of moved) {
      assert.ok(equalFor(SeriesEntry)(key as never, expected[op.type]!), `the series' ${op.type}: ${printFor(SeriesEntry)(key as never)}`);
    }

    // The summary: September loses the job and its eight hours; October and November gain it, and the hours of each it covers.
    const SummaryEntry = StructType({ ik: summary.keyType, k: NullType });
    const totals = of(summary.name);
    const months: Array<[string, bigint, bigint]> = [
      ['2026-09-01T00:00:00.000', -1n, -8n * HOUR], ['2026-10-01T00:00:00.000', 1n, 594n * HOUR], ['2026-11-01T00:00:00.000', 1n, 366n * HOUR],
    ];
    assert.equal(totals.length, months.length, 'one change a month');
    totals.forEach(({ key, op }, i) => {
      const [month, count, ms] = months[i]!;
      assert.ok(equalFor(SummaryEntry)(key as never, { ik: { on: {}, key: 'P-1', tile: instant(month) }, k: null }), `the ${month} total`);
      assert.ok(equalFor(RecordSummaryOpType)(op as never, variant('add', { count, ms })), `${month}: ${printFor(RecordSummaryOpType)(op as never)}`);
    });
  });
});
