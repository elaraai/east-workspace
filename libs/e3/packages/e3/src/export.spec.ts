/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { East, DictType, IntegerType, StringType, beast2HasIndex, decodeBeast2For, openBeast2PagesFor } from '@elaraai/east';
import { PackageObjectType, DatasetRefType, EnvironmentSpecType, decodePackageObject, decodeTaskObject, decodeFunctionObject } from '@elaraai/e3-types';
import { addObject, export_ } from './export.js';
import { package_ } from './package.js';
import { task } from './task.js';
import { function_ } from './function.js';
import { input } from './input.js';

describe('addObject', () => {
  it('returns correct SHA256 hash for empty buffer', () => {
    const zipfile = new yazl.ZipFile();
    const data = Buffer.from('');
    const hash = addObject(zipfile, data);
    // SHA256 of empty string
    assert.strictEqual(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns correct SHA256 hash for known input', () => {
    const zipfile = new yazl.ZipFile();
    const data = Buffer.from('hello');
    const hash = addObject(zipfile, data);
    // SHA256 of "hello"
    assert.strictEqual(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('adds object at correct path in zip', () => {
    const zipfile = new yazl.ZipFile();
    const data = Buffer.from('hello');
    const hash = addObject(zipfile, data);

    // Verify the path format: objects/xx/yyyy...beast2
    const expectedPath = `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`;
    assert.strictEqual(expectedPath, 'objects/2c/f24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.beast2');
  });

  it('returns consistent hash for same input', () => {
    const zipfile1 = new yazl.ZipFile();
    const zipfile2 = new yazl.ZipFile();
    const data = Buffer.from('test data');

    const hash1 = addObject(zipfile1, data);
    const hash2 = addObject(zipfile2, data);

    assert.strictEqual(hash1, hash2);
  });

  it('returns different hash for different input', () => {
    const zipfile = new yazl.ZipFile();
    const data1 = Buffer.from('hello');
    const data2 = Buffer.from('world');

    const hash1 = addObject(zipfile, data1);
    const hash2 = addObject(zipfile, data2);

    assert.notStrictEqual(hash1, hash2);
  });
});

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
          // Directory entry, skip
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

describe('export_', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'e3-export-test-'));
  });

  after(async () => {
    await fs.promises.rm(tempDir, { recursive: true });
  });

  it('exports empty package', async () => {
    const pkg = package_('empty-pkg', '1.0.0') as any;
    const zipPath = path.join(tempDir, 'empty.zip');

    await export_(pkg, zipPath);

    // Verify zip exists
    const stat = await fs.promises.stat(zipPath);
    assert.ok(stat.isFile());

    // Read zip contents
    const entries = await readZip(zipPath);

    // Should have package ref
    assert.ok(entries.has('packages/empty-pkg/1.0.0'));

    // Package ref should contain a hash
    const refContent = entries.get('packages/empty-pkg/1.0.0')!.toString().trim();
    assert.match(refContent, /^[a-f0-9]{64}$/);

    // Should have just the package object (no tree objects in new format)
    const objectEntries = Array.from(entries.keys()).filter(k => k.startsWith('objects/'));
    assert.ok(objectEntries.length >= 1, `Expected at least 1 object, got ${objectEntries.length}`);

    // Decode and verify package object
    const packageObjectPath = `objects/${refContent.slice(0, 2)}/${refContent.slice(2)}.beast2`;
    assert.ok(entries.has(packageObjectPath), `Missing package object at ${packageObjectPath}`);

    const packageObjectData = entries.get(packageObjectPath)!;
    const decoder = decodeBeast2For(PackageObjectType);
    const packageObject = decoder(packageObjectData);

    // Empty package should have no tasks
    assert.strictEqual(packageObject.tasks.size, 0);

    // Structure should be an empty struct
    assert.strictEqual(packageObject.data.structure.type, 'struct');
    assert.strictEqual(packageObject.data.structure.value.size, 0);
  });

  it('exports package with input dataset', async () => {
    const myInput = input('greeting', StringType, 'hello');
    const pkg = package_('input-pkg', '1.0.0', myInput);
    const zipPath = path.join(tempDir, 'input.zip');

    await export_(pkg, zipPath);

    // Read zip contents
    const entries = await readZip(zipPath);

    // Get package object
    const refContent = entries.get('packages/input-pkg/1.0.0')!.toString().trim();
    const packageObjectPath = `objects/${refContent.slice(0, 2)}/${refContent.slice(2)}.beast2`;
    const packageObjectData = entries.get(packageObjectPath)!;
    const decoder = decodeBeast2For(PackageObjectType);
    const packageObject = decoder(packageObjectData);

    // Should have no tasks (input only)
    assert.strictEqual(packageObject.tasks.size, 0);

    // Structure should have inputs.greeting as a value with writable flag
    assert.strictEqual(packageObject.data.structure.type, 'struct');
    const inputs = packageObject.data.structure.value.get('inputs');
    assert.ok(inputs, 'Missing inputs in structure');
    assert.strictEqual(inputs.type, 'struct');
    const greeting = inputs.value.get('greeting');
    assert.ok(greeting, 'Missing greeting in inputs structure');
    assert.strictEqual(greeting.type, 'value');
    // The value should contain a String type and writable flag
    assert.strictEqual(greeting.value.type.type, 'String');
    assert.strictEqual(greeting.value.writable, true);

    // Should have a DatasetRef file for the input
    const refData = entries.get('data/inputs/greeting.ref');
    assert.ok(refData, 'Missing data/inputs/greeting.ref');
    const refDecoder = decodeBeast2For(DatasetRefType);
    const datasetRef = refDecoder(refData);
    assert.strictEqual(datasetRef.type, 'value');
    assert.ok(datasetRef.value.hash, 'Missing hash in dataset ref');
  });

  it('produces identical output for same package', async () => {
    const myInput = input('name', StringType, 'world');
    const pkg = package_('deterministic', '1.0.0', myInput);

    const zipPath1 = path.join(tempDir, 'deterministic1.zip');
    const zipPath2 = path.join(tempDir, 'deterministic2.zip');

    await export_(pkg, zipPath1);
    await export_(pkg, zipPath2);

    // Read both zips
    const entries1 = await readZip(zipPath1);
    const entries2 = await readZip(zipPath2);

    // Should have same entries
    assert.deepStrictEqual(
      Array.from(entries1.keys()).sort(),
      Array.from(entries2.keys()).sort()
    );

    // Each entry should have identical content
    for (const [path, data1] of entries1) {
      const data2 = entries2.get(path)!;
      assert.ok(data1.equals(data2), `Content mismatch at ${path}`);
    }
  });
});

describe('environment capture on export', () => {
  let projectDir: string;
  let outDir: string;

  before(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-project-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-out-'));
    // A locked node project with no dependencies (npm pack-able).
    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'e3-capture-fixture', version: '1.0.0', files: ['index.js'],
    }));
    fs.writeFileSync(path.join(projectDir, 'index.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify({
      name: 'e3-capture-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
      packages: { '': { name: 'e3-capture-fixture', version: '1.0.0' } },
    }));
  });

  after(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('rejects a mutable image reference at definition time', () => {
    const greeting = input('greeting', StringType, 'hi');
    assert.throws(
      () => task('bad_env', [greeting], East.function([StringType], StringType, (_$, g) => g), {
        environment: { image: { digest: 'example.com/img:latest' } },
      }),
      /image reference must be a full digest/,
    );
  });

  it('captures a node environment into the bundle and stamps the task + function', async () => {
    const greeting = input('greeting', StringType, 'hi');
    const echo = task('echo', [greeting], East.function([StringType], StringType, (_$, g) => g), {
      environment: { node: { project: projectDir } },
    });
    const fn = function_('shout',
      East.function([StringType], StringType, (_$, g) => g),
      { environment: { node: { project: projectDir } } });
    const pkg = package_('env-pkg', '1.0.0', greeting, echo, fn);

    const zipPath = path.join(outDir, 'env-pkg.zip');
    await export_(pkg, zipPath);

    const entries = await readZipEntries(zipPath);
    const pkgRef = entries.get('packages/env-pkg/1.0.0');
    assert.ok(pkgRef, 'package ref present');
    const readObj = (hash: string): Buffer => {
      const data = entries.get(`objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`);
      assert.ok(data, `object ${hash} present in bundle`);
      return data;
    };

    const pkgObj = decodePackageObject(readObj(pkgRef.toString('utf-8').trim()));
    const taskObj = decodeTaskObject(readObj(pkgObj.tasks.get('echo')!));
    assert.strictEqual(taskObj.environment.type, 'some');
    const fnObj = decodeFunctionObject(readObj(pkgObj.functions.get('shout')!));
    assert.strictEqual(fnObj.environment.type, 'some');

    // Task and function share one declaration — one spec object (memoized capture).
    const envHash = taskObj.environment.type === 'some' ? taskObj.environment.value : '';
    assert.strictEqual(fnObj.environment.type === 'some' && fnObj.environment.value, envHash);

    const spec = decodeBeast2For(EnvironmentSpecType)(readObj(envHash));
    assert.strictEqual(spec.type, 'node');
    if (spec.type === 'node') {
      // Every referenced blob rides the bundle: manifest, lockfile, tarball.
      const manifest = JSON.parse(readObj(spec.value.packageJson).toString('utf-8'));
      assert.strictEqual(manifest.name, 'e3-capture-fixture');
      readObj(spec.value.lock);
      assert.strictEqual(spec.value.tarballs.length, 1);
      readObj(spec.value.tarballs[0]!);
    }
  });
});

/** Read all zip entries into a map of path -> content. */
function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err);
      zf.readEntry();
      zf.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zf.readEntry();
        zf.openReadStream(entry, (serr, stream) => {
          if (serr || !stream) return reject(serr);
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zf.readEntry();
          });
        });
      });
      zf.on('end', () => resolve(entries));
      zf.on('error', reject);
    });
  });
}

describe('collection defaults export PAGEABLE', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'e3-export-paged-'));
  });
  after(async () => {
    await fs.promises.rm(tempDir, { recursive: true });
  });

  /** The object a dataset ref points at, out of the bundle. */
  function blobOf(entries: Map<string, Buffer>, refPath: string): Buffer {
    const refData = entries.get(refPath);
    assert.ok(refData, `missing ${refPath}`);
    const ref = decodeBeast2For(DatasetRefType)(refData);
    assert.strictEqual(ref.type, 'value');
    const hash = ref.type === 'value' ? ref.value.hash : '';
    const blob = entries.get(`objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`);
    assert.ok(blob, `missing object ${hash}`);
    return blob;
  }

  it('a collection default carries a segment index — the store path\'s invariant, at export', async () => {
    // `datasetWrite` states it: collection roots are ALWAYS stored segmented
    // with a trailing index, at every size. The export path encoded them flat,
    // so a freshly DEPLOYED input could not be paged at all until something
    // wrote it — `dataset_not_indexed`, with no whole-decode fallback.
    const rows = new Map<string, bigint>();
    for (let i = 0; i < 40; i++) rows.set(`u${String(i).padStart(3, '0')}`, BigInt(i));
    const units = input('units', DictType(StringType, IntegerType), rows);
    const zipPath = path.join(tempDir, 'paged.zip');
    await export_(package_('paged-pkg', '1.0.0', units), zipPath);

    const blob = blobOf(await readZip(zipPath), 'data/inputs/units.ref');
    assert.ok(beast2HasIndex(blob), 'collection default must be exported with a segment index');

    // ...and it must actually open for paged reads, reporting the true total.
    const pages = openBeast2PagesFor(DictType(StringType, IntegerType))(blob);
    assert.strictEqual(pages.elementCount, 40);
    assert.ok(pages.segmentCount >= 1);
  });

  it('a scalar default stays unsegmented — only collection roots are paged', async () => {
    const greeting = input('greeting', StringType, 'hello');
    const zipPath = path.join(tempDir, 'scalar.zip');
    await export_(package_('scalar-pkg', '1.0.0', greeting), zipPath);

    const blob = blobOf(await readZip(zipPath), 'data/inputs/greeting.ref');
    assert.ok(!beast2HasIndex(blob), 'a scalar root must not be segmented');
  });
});
