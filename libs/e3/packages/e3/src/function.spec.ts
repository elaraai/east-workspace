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
} from '@elaraai/e3-types';
import { function_ } from './function.js';
import { runnerToVariant } from './runner.js';
import { package_ } from './package.js';
import { export_ } from './export.js';
import { input } from './input.js';
import { task } from './task.js';

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
  it('infers inputTypes/outputType from the East function', () => {
    const fn = function_(
      'forecast',
      East.function([IntegerType, FloatType], FloatType, ($, periods, rate) =>
        rate.multiply(periods.toFloat())
      )
    );

    assert.strictEqual(fn.kind, 'function');
    assert.strictEqual(fn.name, 'forecast');
    assert.deepStrictEqual(toEastTypeValue(fn.inputTypes[0]!), toEastTypeValue(IntegerType));
    assert.deepStrictEqual(toEastTypeValue(fn.inputTypes[1]!), toEastTypeValue(FloatType));
    assert.deepStrictEqual(toEastTypeValue(fn.outputType), toEastTypeValue(FloatType));
    // Defaults to DEFAULT_RUNNER (east-node + east-node-std)
    assert.deepStrictEqual(runnerToVariant(fn.runner), variant('east_node', {
      platforms: ['@elaraai/east-node-std'],
    }));
  });

  it('rejects an empty name', () => {
    assert.throws(() => function_(
      '',
      East.function([IntegerType], IntegerType, ($, x) => x)
    ), /non-empty name/);
  });

  it('rejects a custom runner at definition time', () => {
    assert.throws(() => function_(
      'bad',
      East.function([IntegerType], IntegerType, ($, x) => x),
      // Cast: the typed signature already forbids this — verify the runtime backstop
      { runner: { runtime: 'custom', command: ['python3'] } as never }
    ), /custom/);
  });
});

describe('runnerToVariant', () => {
  it('maps each known runtime and coalesces missing platforms', () => {
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'east-py' }),
      variant('east_py', { platforms: [] })
    );
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'east-c', platforms: ['east-c-std'] }),
      variant('east_c', { platforms: ['east-c-std'] })
    );
  });

  it('collapses { custom: name } platform entries to plain strings', () => {
    assert.deepStrictEqual(
      runnerToVariant({ runtime: 'east-py', platforms: ['east-py-std', { custom: 'my-platform' }] }),
      variant('east_py', { platforms: ['east-py-std', 'my-platform'] })
    );
  });

  it('rejects the custom runtime', () => {
    assert.throws(
      () => runnerToVariant({ runtime: 'custom', command: ['bash', '-c', 'true'] }),
      /custom/
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
    const greeting = input('greeting', StringType, 'hello');
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
    const refData = entries.get('packages/fn-pkg/1.0.0');
    assert.ok(refData, 'package ref missing');
    const pkgHash = refData.toString('utf-8').trim();
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
    assert.strictEqual(fnObject.inputTypes.length, 1);
    assert.strictEqual(fnObject.inputTypes[0]!.type, 'Integer');
    assert.strictEqual(fnObject.outputType.type, 'Integer');
    assert.deepStrictEqual(fnObject.runner, variant('east_node', { platforms: ['@elaraai/east-node-std'] }));

    // The body IR object itself is in the bundle
    assert.ok(objectEntry(entries, fnObject.bodyIr), 'bodyIr object missing from bundle');
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
    });
    const decoded = decodePackageObject(bytes);
    assert.strictEqual(decoded.functions.get('f'), 'b'.repeat(64));
  });

  it('decodes a pre-functions (legacy) package with functions defaulted empty', () => {
    const LegacyPackageObjectType = StructType({
      tasks: DictType(StringType, StringType),
      data: PackageDataType,
    });
    const bytes = encodeBeast2For(LegacyPackageObjectType)({
      tasks: new Map([['t', 'a'.repeat(64)]]),
      data: { structure: variant('struct', new Map()), refs: new Map() },
    });

    // The strict decoder rejects old bytes...
    assert.throws(() => decodeBeast2For(PackageObjectType)(bytes));
    // ...but the tolerant decoder accepts them
    const decoded = decodePackageObject(bytes);
    assert.strictEqual(decoded.tasks.get('t'), 'a'.repeat(64));
    assert.strictEqual(decoded.functions.size, 0);
  });
});
