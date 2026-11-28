/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An index of a record as an input — `e3.index(record.indexes.<name>)`
 * (#1617): what it takes and refuses, the type of the entries it hands a body,
 * and the body's parameter in each form that declares inputs.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType,
  compareFor, isTypeValueEqual, none, printType, toEastTypeValue, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { RecordSummaryTotalsType, indexCollectionType } from '@elaraai/e3-types';
import { index } from './index-input.js';
import { function_ } from './function.js';
import { input } from './input.js';
import { output } from './output.js';
import { package_ } from './package.js';
import { record } from './record.js';
import { builtIndex } from './record-programs.js';
import { customTask, partition, streamTask, task } from './task.js';
import type { IRBundle, RecordIndexDef } from './types.js';

/** Whether two East types are one type, as East tells them. */
function sameType(a: EastType, b: EastType): boolean {
  return isTypeValueEqual(toEastTypeValue(a), toEastTypeValue(b));
}

/** Asserts a type is the one expected, printing both when it is not. */
function assertType(actual: EastType, expected: EastType, what: string): void {
  assert.ok(sameType(actual, expected), `${what}: ${printType(actual)}, expected ${printType(expected)}`);
}

const JobType = StructType({
  title: StringType, press: StringType,
  start: OptionType(DateTimeType), end: OptionType(DateTimeType), sheets: FloatType,
});
const JobsType = DictType(StringType, JobType);
const jobs = record('jobs', JobsType, {
  initial: new Map(),
  indexes: (index) => ({
    jobs_by_press: index.on(['press']),
    jobs_titles: index.on(['press'], { value: East.function([StringType, JobType], StringType, (_$, _key, job) => job.title) }),
    jobs_by_press_week: index.flatSeries({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
    press_weeks: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
const presses = input('presses', DictType(StringType, StringType), variant('value', new Map([['P1', 'Heidelberg']])));

/** The entries of `jobs_by_press`: `Dict<{ ik: press, k: job }, Null>`. */
const ByPressKey = StructType({ ik: StringType, k: StringType });
const ByPress = DictType(ByPressKey, NullType);

/** Entries of `jobs_by_press` for the jobs given, as `[press, job]`. */
function byPressOf(entries: readonly (readonly [string, string])[]): ValueTypeOf<typeof ByPress> {
  return new SortedMap(entries.map(([ik, k]): [ValueTypeOf<typeof ByPressKey>, null] => [{ ik, k }, null]), compareFor(ByPressKey));
}

describe('e3.index', () => {
  it('takes an index as its record carries it, and types its entries Dict<{ ik, k }, P>', () => {
    const byPress = index(jobs.indexes.jobs_by_press);
    assert.strictEqual(byPress.kind, 'index');
    assert.strictEqual(byPress.index, jobs.indexes.jobs_by_press);
    assert.strictEqual(byPress.record, jobs);
    assertType(byPress.type, ByPress, 'an index that carries nothing');
    // What it carries is the entries' value: a `value` of its own, or the row
    assertType(index(jobs.indexes.jobs_titles).type, DictType(ByPressKey, StringType), 'an index with a value');
    const series = jobs.indexes.jobs_by_press_week;
    assertType(index(series).type, DictType(StructType({ ik: series.keyType, k: StringType }), JobType), 'a series index, which carries the row');
  });

  it('types a summary index\'s entries with a Null row key, as the store holds them', () => {
    const weeks = jobs.indexes.press_weeks;
    assertType(index(weeks).type, DictType(StructType({ ik: weeks.keyType, k: NullType }), RecordSummaryTotalsType), 'a summary index');
  });

  it('types the entries as the index is built: beside an entries index, one that carries nothing carries the lean row', () => {
    const Evidence = StructType({ parcels: IntegerType, site: StringType, byService: DictType(StringType, IntegerType) });
    const evidence = record('evidence', DictType(StringType, Evidence), {
      initial: new Map(),
      indexes: (index) => ({
        by_site: index.on(['site']),
        by_service: index.entries('byService'),
      }),
    });
    const bySite = index(evidence.indexes.by_site);
    assertType(bySite.type, DictType(StructType({ ik: StringType, k: StringType }), Evidence), 'the lean row, whose type is the row\'s');
    // The type is the one the store keeps the built index in
    const built = builtIndex(evidence, evidence.indexes.by_site);
    assertType(bySite.type, indexCollectionType(StringType, built.keyType, built.valueType), 'the built index\'s collection');
    // An entries index files its field's entries, each under its own key
    assertType(index(evidence.indexes.by_service).type, DictType(StructType({ ik: StringType, k: StringType }), IntegerType), 'an entries index');
  });

  it('takes the indexes e3 keeps beside one: an entries index\'s lean rows, and a nested series index\'s span', () => {
    const Evidence = StructType({ parcels: IntegerType, byService: DictType(StringType, IntegerType) });
    const evidence = record('evidence', DictType(StringType, Evidence), {
      initial: new Map(),
      indexes: (index) => ({ by_service: index.entries('byService') }),
    });
    const rows = evidence.indexes.by_service.entries.rows;
    assertType(index(rows).type, DictType(StructType({ ik: StringType, k: StringType }), Evidence), 'an entries index\'s lean rows');

    const Machine = StructType({ name: StringType, load: DictType(DateTimeType, FloatType) });
    const machines = record('machines', DictType(StringType, Machine), {
      initial: new Map(),
      indexes: (index) => ({ machines_in_time: index.nestedSeries({ collections: { load: index.nestedSeries.values() }, tile: 'week', summary: ['month'] }) }),
    });
    const span = machines.indexes.machines_in_time.nested.span;
    assertType(index(span).type, DictType(StructType({ ik: span.keyType, k: NullType }), RecordSummaryTotalsType), 'a nested series index\'s span, summed as a summary is');
    assert.strictEqual(index(span).record, machines);
  });

  it('refuses anything but an index a record carries by name, naming what it was given', () => {
    const untyped = index as unknown as (def: unknown) => unknown;
    const takes = 'e3.index takes an index of a record, as the record carries it by name — e3.index(record.indexes.<name>) — and was given ';
    assert.throws(() => untyped(jobs), {
      message: `${takes}the record 'jobs' itself — pass one of its indexes, as jobs.indexes.<name>; ` +
        `its indexes are 'jobs_by_press', 'jobs_titles', 'jobs_by_press_week', 'press_weeks'`,
    });
    assert.throws(() => untyped(record('bare', JobsType, { initial: new Map() })), {
      message: `${takes}the record 'bare' itself — pass one of its indexes, as bare.indexes.<name>; it declares no index`,
    });
    assert.throws(() => untyped(presses), { message: `${takes}the dataset 'presses', which is no record: only an e3.record has indexes` });
    assert.throws(() => untyped(partition(presses)), { message: `${takes}e3.partition of 'presses': a partition marks a dataset, and an index is read whole` });
    assert.throws(() => untyped(index(jobs.indexes.jobs_by_press)), { message: `${takes}an e3.index already: pass the record's index, as record.indexes.<name>` });
    assert.throws(() => untyped('jobs_by_press'), { message: `${takes}a string` });
    assert.throws(() => untyped(null), { message: `${takes}null` });
    // An index's definition its record does not carry: a copy, or one under another record
    const copy: RecordIndexDef = { ...jobs.indexes.jobs_by_press };
    assert.throws(() => untyped(copy), {
      message: `${takes}an index named 'jobs_by_press' that no record carries by that name — pass it as the record holds it, record.indexes.jobs_by_press`,
    });
    // What the `index` builder makes, before a record builds it
    let draft: unknown;
    record('drafting', JobsType, { initial: new Map(), indexes: (index) => { draft = index.on(['press']); return {}; } });
    assert.throws(() => untyped(draft), {
      message: `${takes}an index the \`index\` builder made, before its record built it — declare it in e3.record's \`indexes\`, and pass record.indexes.<name>`,
    });
  });

  it('refuses a record\'s other parts and e3\'s other definitions, each named by what it is', () => {
    const untyped = index as unknown as (def: unknown) => unknown;
    const takes = 'e3.index takes an index of a record, as the record carries it by name — e3.index(record.indexes.<name>) — and was given ';
    assert.throws(() => untyped(jobs.mutations.patch), {
      message: `${takes}the mutation 'patch': a mutation writes its record, and has no index — pass one of the record's indexes, as record.indexes.<name>`,
    });
    const count = function_('count', { inputs: [jobs], args: [], output: IntegerType }, ($, rows) => rows.size());
    assert.throws(() => untyped(count), { message: `${takes}the function 'count': a function has no index` });
    assert.throws(() => untyped(package_('planning', '1.0.0', count)), { message: `${takes}the package 'planning': a package has no index` });
    assert.throws(() => untyped(output.dict(StringType, FloatType)), { message: `${takes}e3.output.dict, an output kind: it has no index` });
    // What a record's other builders make, before a record builds it
    let mutation: unknown;
    record('drafting_mutation', JobsType, { initial: new Map(), mutations: (builder) => { mutation = builder.patch(); return {}; } });
    assert.throws(() => untyped(mutation), { message: `${takes}a mutation the \`mutation\` builder made, which has no index` });
    assert.throws(() => untyped({ name: 'jobs_by_press' }), { message: `${takes}a value that is no definition of e3's` });
  });
});

describe('e3.index as an input', () => {
  const held = byPressOf([['P1', 'j1'], ['P1', 'j3'], ['P2', 'j2'], ['P3', 'j4']]);

  it('gives a function\'s body the index\'s entries, before its arguments', () => {
    const jobsOnPress = function_('jobs_on_press', {
      inputs: [index(jobs.indexes.jobs_by_press)],
      args: [StringType],
      output: IntegerType,
    }, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size());

    assert.strictEqual(jobsOnPress.inputs.length, 1);
    assert.strictEqual(jobsOnPress.inputs[0]!.kind, 'index');
    assert.deepStrictEqual(jobsOnPress.argTypes.map((type) => printType(type)), [printType(StringType)]);
    const compiled = (jobsOnPress.body as IRBundle).compile([]);
    assert.strictEqual(compiled(held, 'P1'), 2n);
    assert.strictEqual(compiled(held, 'P2'), 1n);
    assert.strictEqual(compiled(held, 'P9'), 0n);
    // The package collects the index's record, as it collects any input's
    assert.ok(jobsOnPress.deps.has(jobs), 'its record is among what it depends on');
    const pkg = package_('index-fn', '1.0.0', jobsOnPress);
    assert.ok(pkg.contents.includes(jobs), 'the package holds the record');
    assert.strictEqual(pkg.records['jobs'], jobs);
  });

  it('reads more of a row than the index carries from the record beside it, by the entry\'s key', () => {
    const titlesOnPress = function_('titles_on_press', {
      inputs: [index(jobs.indexes.jobs_by_press), jobs],
      args: [StringType],
      output: DictType(StringType, StringType),
    }, ($, jobsByPress, jobs, press) => {
      const titles = $.let(new Map(), DictType(StringType, StringType));
      $.for(jobsByPress.prefix({ ik: press }), ($, _carried, key) => {
        $(titles.insert(key.k, jobs.get(key.k).title));
      });
      return titles;
    });
    const job = (title: string, press: string): ValueTypeOf<typeof JobType> => ({ title, press, start: none, end: none, sheets: 1.0 });
    const rows = new Map([['j1', job('Annual report', 'P1')], ['j2', job('Posters', 'P2')], ['j3', job('Catalogue', 'P1')], ['j4', job('Flyers', 'P3')]]);
    const titles = (titlesOnPress.body as IRBundle).compile([])(held, rows, 'P1') as Map<string, string>;
    assert.deepStrictEqual([...titles], [['j1', 'Annual report'], ['j3', 'Catalogue']]);
  });

  it('gives a task\'s body the index\'s entries, its parameter the input\'s type', () => {
    const byPress = index(jobs.indexes.jobs_by_press);
    const busiest = task('busiest_press', [byPress, presses],
      East.function([byPress.type, DictType(StringType, StringType)], StringType, ($, jobsByPress, presses) => {
        const best = $.let('');
        const most = $.let(0n);
        $.for(presses, ($, _press, code) => {
          const count = $.const(jobsByPress.prefix({ ik: code }).size());
          $.if(East.less(most, count), ($) => { $.assign(most, count); $.assign(best, code); });
        });
        return best;
      }));

    assert.deepStrictEqual(busiest.inputs, [byPress, presses]);
    assert.ok(busiest.deps.has(jobs), 'its record is among what the task depends on');
    assert.ok(package_('index-task', '1.0.0', busiest).contents.includes(jobs), 'and the package holds it');
    assert.strictEqual(busiest.body.kind, 'east');
    const compiled = (busiest.body.kind === 'east' ? busiest.body.program as IRBundle : undefined)!.compile([]);
    assert.strictEqual(compiled(held, new Map([['P1', 'Heidelberg'], ['P2', 'Komori'], ['P3', 'Roland']])), 'P1');
  });

  it('refuses a task whose body\'s parameter is not the index\'s type, naming it', () => {
    const byPress = index(jobs.indexes.jobs_by_press);
    const untyped = task as unknown as (name: string, inputs: unknown[], fn: unknown) => unknown;
    assert.throws(() => untyped('rows_for_entries', [byPress], East.function([JobsType], IntegerType, (_$, rows) => rows.size())), {
      message: `task 'rows_for_entries': its input 'jobs.jobs_by_press' is an index whose entries are ${printType(ByPress)}, and the body's parameter for it ` +
        `is ${printType(JobsType)} — declare the parameter as the input's type, e3.index(…).type`,
    });
    assert.throws(() => untyped('no_parameter', [byPress], East.function([], IntegerType, () => 0n)), {
      message: `task 'no_parameter': its input 'jobs.jobs_by_press' is an index whose entries are ${printType(ByPress)}, and the body's parameter for it ` +
        `is missing — declare the parameter as the input's type, e3.index(…).type`,
    });
  });

  it('reaches every piece of a stream task whole, beside the input its work is split over', () => {
    const sales = input('sales', DictType(StringType, StructType({ press: StringType, amount: FloatType })));
    const totals = streamTask('totals_on_busy_presses', {
      inputs: [partition(sales), index(jobs.indexes.jobs_by_press)],
      output: output.dict(StringType, FloatType, { merge: (_$, _press, a, b) => a.add(b) }),
    }, ($, sales, jobsByPress, emit) => {
      $.for(sales, ($, sale) => {
        $.if(East.greater(jobsByPress.prefix({ ik: sale.press }).size(), 0n), ($) => { $(emit(sale.press, sale.amount)); });
      });
    });
    assert.strictEqual(totals.inputs.length, 2);
    assert.strictEqual(totals.inputs[0]!.kind, 'partition');
    assert.strictEqual(totals.inputs[1]!.kind, 'index');
    assert.ok(totals.deps.has(jobs) && totals.deps.has(sales), 'the record and the dataset are both collected');
  });

  it('is refused inside e3.partition, as an input of a custom task, and of a function on the custom runtime, each naming the change to make', () => {
    const byPress = index(jobs.indexes.jobs_by_press);
    const untypedPartition = partition as unknown as (dataset: unknown) => unknown;
    assert.throws(() => untypedPartition(byPress), {
      message: 'e3.partition: \'jobs.jobs_by_press\' is an index of a record, which a stream task\'s work is not split over — '
        + 'pass the e3.index itself: every piece reads it whole, a run at a time',
    });
    const untypedCustom = customTask as unknown as (name: string, inputs: unknown[], type: EastType, command: () => string) => unknown;
    assert.throws(() => untypedCustom('copy', [byPress], StringType, () => 'true'), {
      message: 'customTask \'copy\': input \'jobs.jobs_by_press\' is an index of a record, and a custom task\'s command reads its inputs as files — '
        + 'read the index in an e3.task or an e3.streamTask, and pass that task\'s output',
    });
    assert.throws(() => function_('custom', {
      inputs: [byPress],
      args: [],
      output: IntegerType,
      runner: { runtime: 'custom', command: ['python3', 'my-runner.py'] },
    }, ($, jobsByPress) => jobsByPress.size()), /e3.function 'custom': the custom runtime takes no inputs/);
  });

  it('lets a function draft a record it reads by an index alone, and refuses a record none of its inputs reads', () => {
    const drafted = function_('drafted_by_index', {
      inputs: [index(jobs.indexes.jobs_by_press)],
      drafts: [jobs],
      args: [StringType],
      output: IntegerType,
    }, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size());
    assert.deepStrictEqual(drafted.drafts, [jobs]);

    const other = record('other', JobsType, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) });
    assert.throws(() => function_('unread', {
      inputs: [index(jobs.indexes.jobs_by_press)],
      drafts: [other],
      args: [],
      output: IntegerType,
    }, ($, jobsByPress) => jobsByPress.size()), {
      message: 'e3.function \'unread\': the record \'other\', listed in drafts, is read by none of its inputs — '
        + 'list it in inputs too, or an index of it, and a call reads it with its drafts laid over it',
    });
  });
});
