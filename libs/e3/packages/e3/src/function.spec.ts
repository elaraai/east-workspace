/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yauzl from 'yauzl';
import {
  East,
  IntegerType,
  FloatType,
  StringType,
  StructType,
  DictType,
  decodeBeast2For,
  encodeBeast2For,
  toEastTypeValue,
  variant,
} from '@elaraai/east';
import {
  PackageObjectType,
  PackageDataType,
  FunctionObjectType,
  decodePackageObject,
  pathToString,
} from '@elaraai/e3-types';
import { function_ } from './function.js';
import { runnerToVariant } from './runner.js';
import { package_ } from './package.js';
import { export_ } from './export.js';
import { input } from './input.js';
import { record } from './record.js';
import { partition, task } from './task.js';
import type { IRBundle } from './types.js';
import type { FunctionSpec } from './index.js';

/**
 * Helper to read a zip file and return entries as a map of path -> buffer
 */
async function readZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));

      const entries = new Map<string, Buffer>();
      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err);
            if (!readStream) return reject(new Error('No read stream'));

            const chunks: Buffer[] = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              entries.set(entry.fileName, Buffer.concat(chunks));
              zipfile.readEntry();
            });
          });
        }
      });

      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}

function objectEntry(entries: Map<string, Buffer>, hash: string): Buffer | undefined {
  return entries.get(`objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`);
}

describe('function_', () => {
  it('infers argTypes/outputType from the East function, which reads no input', () => {
    const fn = function_(
      'forecast',
      East.function([IntegerType, FloatType], FloatType, ($, periods, rate) =>
        rate.multiply(periods.toFloat())
      )
    );

    assert.strictEqual(fn.kind, 'function');
    assert.strictEqual(fn.name, 'forecast');
    assert.deepStrictEqual(toEastTypeValue(fn.argTypes[0]!), toEastTypeValue(IntegerType));
    assert.deepStrictEqual(toEastTypeValue(fn.argTypes[1]!), toEastTypeValue(FloatType));
    assert.deepStrictEqual(toEastTypeValue(fn.outputType), toEastTypeValue(FloatType));
    assert.strictEqual(fn.inputs.length, 0);
    assert.deepStrictEqual(fn.drafts, [], 'and so takes no draft');
    assert.strictEqual(fn.deps.size, 0);
    // Defaults to DEFAULT_RUNNER (east-node + east-node-std)
    assert.deepStrictEqual(runnerToVariant(fn.runner), variant('east_node', {
      platforms: ['@elaraai/east-node-std'],
      decode: variant('lazy', null),
    }));
  });

  it('rejects an empty name', () => {
    assert.throws(() => function_(
      '',
      East.function([IntegerType], IntegerType, ($, x) => x)
    ), /non-empty name/);
  });

  it('accepts a custom runner (symmetric with tasks)', () => {
    const f = function_(
      'custom-ok',
      East.function([IntegerType], IntegerType, ($, x) => x),
      { runner: { runtime: 'custom', command: ['python3', 'my-runner.py'] } }
    );
    assert.equal(f.runner.runtime, 'custom');
  });
});

describe('function_ with inputs', () => {
  const prices = input('prices', DictType(StringType, FloatType), variant('value', new Map([['a', 2.5]])));
  const stock = input('stock', DictType(StringType, IntegerType), variant('value', new Map([['a', 4n]])));

  it('takes its inputs as the body\'s first parameters and its arguments after them', () => {
    const quote = function_('quote', {
      inputs: [prices, stock],
      args: [StringType, IntegerType],
      output: FloatType,
    }, ($, prices, stock, sku, quantity) => {
      const held = $.let(stock.get(sku));
      return prices.get(sku).multiply(East.min(held, quantity).toFloat());
    });

    assert.deepStrictEqual(quote.inputs, [prices, stock]);
    assert.deepStrictEqual(quote.argTypes.map((t) => toEastTypeValue(t)), [toEastTypeValue(StringType), toEastTypeValue(IntegerType)]);
    assert.deepStrictEqual(toEastTypeValue(quote.outputType), toEastTypeValue(FloatType));
    // The body is one East function over all of them, in that order
    assert.strictEqual(quote.body.ir.type, 'Function');
    const compiled = (quote.body as IRBundle).compile([]);
    assert.strictEqual(compiled(new Map([['a', 2.5]]), new Map([['a', 4n]]), 'a', 3n), 7.5);
    assert.strictEqual(quote.deps.has(prices), true);
    assert.strictEqual(quote.deps.has(stock), true);
  });

  it('builds an async body when asked', () => {
    const fn = function_('later', { inputs: [stock], args: [], output: IntegerType, async: true }, ($, stock) => stock.size());
    assert.strictEqual(fn.body.ir.type, 'AsyncFunction');
    assert.strictEqual(fn.argTypes.length, 0);
  });

  it('refuses an input marked with e3.partition, since a call runs as one unit', () => {
    // The types take no partition: an untyped caller can still pass one
    const untyped = function_ as unknown as (name: string, spec: object, fn: () => bigint) => unknown;
    assert.throws(() => untyped('split', { inputs: [partition(stock)], args: [], output: IntegerType }, () => 0n),
      /e3.function 'split': input 'stock' is marked with e3.partition, and a call runs as one unit — pass the dataset itself/);
  });

  it('refuses the custom runtime with inputs', () => {
    assert.throws(() => function_('custom', {
      inputs: [stock],
      args: [],
      output: IntegerType,
      runner: { runtime: 'custom', command: ['python3', 'my-runner.py'] },
    }, ($, stock) => stock.size()), /e3.function 'custom': the custom runtime takes no inputs/);
  });

  it('takes a spec named through the package entry, apart from the call', () => {
    const spec: FunctionSpec<[typeof stock], [IntegerType], IntegerType> = { inputs: [stock], args: [IntegerType], output: IntegerType };
    const held = function_('held', spec, ($, stock, extra) => stock.size().add(extra));
    assert.deepStrictEqual(held.inputs, [stock]);
    assert.strictEqual(held.argTypes.length, 1);
    assert.strictEqual((held.body as IRBundle).compile([])(new Map([['a', 4n]]), 2n), 3n);
  });

  it('is collected by e3.package with its inputs and what they depend on', () => {
    const value = task('value', [stock], East.function([DictType(StringType, IntegerType)], IntegerType, ($, stock) => stock.size()));
    const fn = function_('read_value', { inputs: [value.output], args: [], output: IntegerType }, ($, value) => value);
    const pkg = package_('fn-inputs', '1.0.0', fn);

    assert.strictEqual(pkg.functions['read_value'], fn);
    assert.ok(pkg.contents.includes(value), 'the task producing the input');
    assert.ok(pkg.contents.includes(value.output), 'the input');
    assert.ok(pkg.contents.includes(stock), 'the task\'s own input');
  });
});

describe('function_ with drafts', () => {
  const JobType = StructType({ press: StringType });
  const jobs = record('jobs', DictType(StringType, JobType), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
  });
  const presses = record('presses', DictType(StringType, StringType), { initial: new Map() });
  const prices = input('prices', DictType(StringType, FloatType), variant('value', new Map([['a', 2.5]])));

  it('lists the records a call may draft, each a record among its inputs, and its body is given the inputs as any function\'s is', () => {
    const jobsOn = function_('jobs_on', {
      inputs: [jobs, prices],
      drafts: [jobs],
      args: [StringType],
      output: IntegerType,
    }, ($, jobs, _prices, press) => {
      const count = $.let(0n);
      $.for(jobs, ($, job) => {
        $.if(East.equal(job.press, press), ($) => { $.assign(count, count.add(1n)); });
      });
      return count;
    });

    assert.deepStrictEqual(jobsOn.drafts, [jobs]);
    assert.deepStrictEqual(jobsOn.inputs, [jobs, prices]);
    assert.deepStrictEqual(jobsOn.argTypes.map((t) => toEastTypeValue(t)), [toEastTypeValue(StringType)]);
    const held = new Map([['j1', { press: 'P1' }], ['j2', { press: 'P2' }], ['j3', { press: 'P1' }]]);
    assert.strictEqual((jobsOn.body as IRBundle).compile([])(held, new Map([['a', 2.5]]), 'P1'), 2n);
  });

  it('takes no draft where it lists no record', () => {
    const count = function_('count', { inputs: [jobs], args: [], output: IntegerType }, ($, jobs) => jobs.size());
    assert.deepStrictEqual(count.drafts, []);
    const none = function_('none_listed', { inputs: [jobs], drafts: [], args: [], output: IntegerType }, ($, jobs) => jobs.size());
    assert.deepStrictEqual(none.drafts, []);
  });

  it('holds a record listed twice once, in the order first listed', () => {
    const both = function_('both', { inputs: [jobs, presses], drafts: [presses, jobs, presses], args: [], output: IntegerType },
      ($, jobs, presses) => jobs.size().add(presses.size()));
    assert.deepStrictEqual(both.drafts, [presses, jobs]);
  });

  // The types take the records among the inputs alone, which each spec below
  // is refused by where it is declared; an untyped caller is refused as it is built.
  it('refuses a draft of what is no record, naming it', () => {
    const priced: FunctionSpec<[typeof prices], [], IntegerType> = {
      inputs: [prices],
      // @ts-expect-error — of the inputs, only a record is listed in drafts
      drafts: [prices],
      args: [],
      output: IntegerType,
    };
    assert.throws(() => function_('priced', priced, ($, prices) => prices.size()), {
      message: 'e3.function \'priced\': \'prices\', listed in drafts, is no record — '
        + 'a draft is a call of a record\'s mutation that is not committed, so only an e3.record takes one',
    });
    // A record is listed as itself, not by its name
    const byName: FunctionSpec<[typeof jobs], [], IntegerType> = {
      inputs: [jobs],
      // @ts-expect-error — the record, not its name
      drafts: ['jobs'],
      args: [],
      output: IntegerType,
    };
    assert.throws(() => function_('by_name', byName, ($, jobs) => jobs.size()), {
      message: 'e3.function \'by_name\': an entry of drafts is no record — '
        + 'a draft is a call of a record\'s mutation that is not committed, so only an e3.record takes one',
    });
  });

  it('refuses a draft of a record none of its inputs reads, naming it', () => {
    const unread: FunctionSpec<[typeof presses, typeof prices], [], IntegerType> = {
      inputs: [presses, prices],
      // @ts-expect-error — jobs is not among the inputs
      drafts: [jobs],
      args: [],
      output: IntegerType,
    };
    assert.throws(() => function_('unread', unread, ($, presses) => presses.size()), {
      message: 'e3.function \'unread\': the record \'jobs\', listed in drafts, is read by none of its inputs — '
        + 'list it in inputs too, and a call reads it with its drafts laid over it',
    });
  });

  it('refuses the custom runtime, which takes no input for a draft to be laid over', () => {
    assert.throws(() => function_('custom', {
      inputs: [jobs],
      drafts: [jobs],
      args: [],
      output: IntegerType,
      runner: { runtime: 'custom', command: ['python3', 'my-runner.py'] },
    }, ($, jobs) => jobs.size()), /e3.function 'custom': the custom runtime takes no inputs/);
  });
});

describe('runnerToVariant', () => {
  it('maps each known runtime and coalesces missing platforms', () => {
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'east-py' }),
      variant('east_py', { platforms: [], decode: variant('lazy', null) })
    );
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'east-c', platforms: ['east-c-std'] }),
      variant('east_c', { platforms: ['east-c-std'], decode: variant('lazy', null) })
    );
  });

  it('collapses { custom: name } platform entries to plain strings', () => {
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'east-py', platforms: ['east-py-std', { custom: 'my-platform' }] }),
      variant('east_py', { platforms: ['east-py-std', 'my-platform'], decode: variant('lazy', null) })
    );
  });

  it('maps the custom runtime to the wire custom variant', () => {
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'custom', command: ['bash', '-c', 'true'] }),
      variant('custom', { command: ['bash', '-c', 'true'] })
    );
  });
});

describe('package_ with functions', () => {
  it('collects functions by name, separate from contents', () => {
    const fn = function_('double', East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
    const pkg = package_('fns', '1.0.0', fn);

    assert.strictEqual(pkg.functions['double'], fn);
    assert.strictEqual(pkg.contents.length, 0);
  });

  it('merges functions from nested packages', () => {
    const fn = function_('double', East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
    const inner = package_('inner', '1.0.0', fn);
    const outer = package_('outer', '1.0.0', inner);

    assert.strictEqual(outer.functions['double'], fn);
  });
});

describe('export_ with functions', () => {
  let tempDir: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-function-export-'));
  });

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('round-trips a FunctionObject through the bundle', async () => {
    const greeting = input('greeting', StringType, variant('value', 'hello'));
    const shout = task('shout', [greeting], East.function([StringType], StringType, ($, s) => s));
    const double = function_(
      'double',
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
      { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } }
    );
    const pkg = package_('fn-pkg', '1.0.0', shout, double);

    const zipPath = path.join(tempDir, 'fn-pkg-1.0.0.zip');
    await export_(pkg, zipPath);
    const entries = await readZip(zipPath);

    // Resolve the package object from the ref
    const refData = entries.get('packages/fn-pkg/1.0.0.beast2');
    assert.ok(refData, 'package ref missing');
    const pkgHash = decodeBeast2For(StringType)(refData);
    const pkgData = objectEntry(entries, pkgHash);
    assert.ok(pkgData, 'package object missing');

    const pkgObject = decodeBeast2For(PackageObjectType)(pkgData);

    // tasks/data unchanged by the function
    assert.ok(pkgObject.tasks.get('shout'), 'task missing');
    assert.ok(pkgObject.data.refs.get('inputs/greeting'), 'dataset ref missing');

    // functions map points at a FunctionObject
    const fnHash = pkgObject.functions.get('double');
    assert.ok(fnHash, 'functions map missing entry');
    const fnData = objectEntry(entries, fnHash);
    assert.ok(fnData, 'FunctionObject missing from bundle');

    const fnObject = decodeBeast2For(FunctionObjectType)(fnData);
    // Note: decoded type values lack toEastTypeValue's cache symbol, so
    // compare the structural fields rather than deep-equality on the object.
    assert.strictEqual(fnObject.argTypes.length, 1);
    assert.strictEqual(fnObject.argTypes[0]!.type, 'Integer');
    assert.strictEqual(fnObject.inputs.length, 0);
    assert.deepStrictEqual(fnObject.drafts, []);
    assert.strictEqual(fnObject.outputType.type, 'Integer');
    assert.deepStrictEqual(fnObject.runner, variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }));

    // The body IR object itself is in the bundle
    assert.ok(objectEntry(entries, fnObject.bodyIr), 'bodyIr object missing from bundle');
  });

  it('writes a function\'s inputs as their paths, and its inputs into the package\'s data', async () => {
    const greeting = input('greeting', StringType, variant('value', 'hello'));
    const shout = task('shout', [greeting], East.function([StringType], StringType, ($, s) => s));
    const echo = function_('echo', { inputs: [greeting, shout.output], args: [IntegerType], output: StringType },
      ($, greeting, shouted, times) => East.str`${greeting} ${shouted} ${times}`);
    const pkg = package_('fn-inputs-pkg', '1.0.0', echo);

    const zipPath = path.join(tempDir, 'fn-inputs-pkg-1.0.0.zip');
    await export_(pkg, zipPath);
    const entries = await readZip(zipPath);
    const pkgObject = decodeBeast2For(PackageObjectType)(objectEntry(entries, decodeBeast2For(StringType)(entries.get('packages/fn-inputs-pkg/1.0.0.beast2')!))!);

    // The function brought its inputs, and the task producing one, with it
    assert.ok(pkgObject.tasks.get('shout'), 'the task its input comes from');
    assert.ok(pkgObject.data.refs.get('inputs/greeting'), 'its input');

    const fnObject = decodeBeast2For(FunctionObjectType)(objectEntry(entries, pkgObject.functions.get('echo')!)!);
    assert.deepStrictEqual(fnObject.inputs.map((p) => pathToString(p)), ['.inputs.greeting', '.tasks.shout.output']);
    assert.deepStrictEqual(fnObject.argTypes.map((t) => t.type), ['Integer']);
    assert.strictEqual(fnObject.outputType.type, 'String');
    assert.deepStrictEqual(fnObject.drafts, [], 'and it lists no record a call may draft');
  });

  it('writes the records a function lists in its drafts by name, as the package holds each', async () => {
    const jobs = record('jobs', DictType(StringType, StringType), {
      initial: new Map(),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const presses = record('presses', DictType(StringType, StringType), { initial: new Map() });
    const jobsOn = function_('jobs_on', { inputs: [presses, jobs], drafts: [jobs], args: [], output: IntegerType },
      ($, presses, jobs) => presses.size().add(jobs.size()));
    const pkg = package_('fn-drafts-pkg', '1.0.0', jobsOn);

    const zipPath = path.join(tempDir, 'fn-drafts-pkg-1.0.0.zip');
    await export_(pkg, zipPath);
    const entries = await readZip(zipPath);
    const pkgObject = decodeBeast2For(PackageObjectType)(objectEntry(entries, decodeBeast2For(StringType)(entries.get('packages/fn-drafts-pkg/1.0.0.beast2')!))!);

    const fnObject = decodeBeast2For(FunctionObjectType)(objectEntry(entries, pkgObject.functions.get('jobs_on')!)!);
    assert.deepStrictEqual(fnObject.inputs.map((p) => pathToString(p)), ['.records.presses', '.records.jobs']);
    assert.deepStrictEqual(fnObject.drafts, ['jobs']);
    // The name is the one the package holds the record under, which a draft and `e3 mutate` address it by
    assert.deepStrictEqual([...pkgObject.records.keys()], ['jobs', 'presses']);
  });

  it('produces identical output for the same package (deterministic)', async () => {
    const fn = function_('double', East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
    const pkg = package_('det-pkg', '1.0.0', fn);

    const zip1 = path.join(tempDir, 'det1.zip');
    const zip2 = path.join(tempDir, 'det2.zip');
    await export_(pkg, zip1);
    await export_(pkg, zip2);

    assert.deepStrictEqual(fs.readFileSync(zip1), fs.readFileSync(zip2));
  });
});

describe('decodePackageObject', () => {
  it('decodes the current format', () => {
    const bytes = encodeBeast2For(PackageObjectType)({
      tasks: new Map([['t', 'a'.repeat(64)]]),
      data: { structure: variant('struct', new Map()), refs: new Map() },
      functions: new Map([['f', 'b'.repeat(64)]]),
      records: new Map([['r', 'c'.repeat(64)]]),
      sources: new Map([['inputs/table', variant('file', { path: '/deliveries/TABLE.beast2' })]]),
    });
    const decoded = decodePackageObject(bytes);
    assert.strictEqual(decoded.functions.get('f'), 'b'.repeat(64));
    assert.strictEqual(decoded.records.get('r'), 'c'.repeat(64));
    const source = decoded.sources.get('inputs/table');
    assert.strictEqual(source?.type, 'file');
    assert.strictEqual(source?.type === 'file' ? source.value.path : undefined, '/deliveries/TABLE.beast2');
  });

  it('refuses a package of an earlier shape, saying to re-export it', () => {
    const refused = /the package object does not decode: the package was exported by an older e3 SDK — re-export it with the current one \(/;
    // Before functions, before records, and before sources.
    const earlier = [
      encodeBeast2For(StructType({ tasks: DictType(StringType, StringType), data: PackageDataType }))({
        tasks: new Map([['t', 'a'.repeat(64)]]),
        data: { structure: variant('struct', new Map()), refs: new Map() },
      }),
      encodeBeast2For(StructType({
        tasks: DictType(StringType, StringType), data: PackageDataType, functions: DictType(StringType, StringType),
      }))({
        tasks: new Map([['t', 'a'.repeat(64)]]),
        data: { structure: variant('struct', new Map()), refs: new Map() },
        functions: new Map([['f', 'b'.repeat(64)]]),
      }),
      encodeBeast2For(StructType({
        tasks: DictType(StringType, StringType), data: PackageDataType,
        functions: DictType(StringType, StringType), records: DictType(StringType, StringType),
      }))({
        tasks: new Map([['t', 'a'.repeat(64)]]),
        data: { structure: variant('struct', new Map()), refs: new Map() },
        functions: new Map([['f', 'b'.repeat(64)]]),
        records: new Map([['r', 'c'.repeat(64)]]),
      }),
    ];
    for (const bytes of earlier) assert.throws(() => decodePackageObject(bytes), refused);
  });
});
