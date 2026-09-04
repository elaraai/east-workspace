/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `FileSystem.openBeast` across the stock runners (#660): a function that
 * opens a beast2 file lazily calls the GENERIC platform function
 * `fs_open_beast<T>`, provided by the std family on every runtime. Exported
 * from one language and imported into a task (#628), it links against the
 * east-node, east-c and east-py stock runners alike — the family rule
 * (`runnerProvides`) needs no change for a generic call — and a runner
 * without the family is refused naming the call. The std compliance corpus
 * pins the values the three implementations produce for the same IR.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yauzl from 'yauzl';
import {
  East, DictType, FunctionType, IntegerType, StringType, StructType,
  decodeBeast2For, decodeEastIR, walkIR, IMPORT_PLATFORM,
} from '@elaraai/east';
import { DatasetRefType } from '@elaraai/e3-types';
import { export_ } from './export.js';
import { package_ } from './package.js';
import { task } from './task.js';
import { input } from './input.js';
import { runnerProvides, type Runner } from './runner.js';

// The declaration every std package implements; the wrapper in
// @elaraai/east-node-std spells the same call.
const fs_open_beast = East.genericPlatform('fs_open_beast', ['T'], [StringType], 'T');
const TableType = DictType(IntegerType, StructType({ id: IntegerType, name: StringType }));

const total = East.function([StringType], IntegerType, ($, file) => {
  const table = $.let(fs_open_beast([TableType], file));
  const sum = $.let(0n);
  $.for(table, ($, row) => {
    $.assign(sum, sum.add(row.id));
  });
  return sum;
});
const manifest = East.exportFunctions('tables', '1.0.0', { total }, { providers: { fs_open_beast: 'east-py-std' } });
const tot = East.importFunction('tables', 'total', FunctionType([StringType], IntegerType));

function countImports(ir: unknown): number {
  let n = 0;
  walkIR(ir as any, (node) => { if (node.type === 'Platform' && node.value.name === IMPORT_PLATFORM) n += 1; });
  return n;
}

function genericPlatformCalls(ir: unknown): Array<{ name: string; typeParameters: number }> {
  const calls: Array<{ name: string; typeParameters: number }> = [];
  walkIR(ir as any, (node) => {
    if (node.type === 'Platform' && node.value.name !== IMPORT_PLATFORM) {
      calls.push({ name: node.value.name, typeParameters: node.value.type_parameters.length });
    }
  });
  return calls;
}

/** Reads a zip into a path → bytes map. */
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

/** The IR object a bundle holds for `data/<refPath>.ref`. */
function irAt(entries: Map<string, Buffer>, refPath: string) {
  const ref = decodeBeast2For(DatasetRefType)(new Uint8Array(entries.get(`data/${refPath}.ref`)!));
  assert.strictEqual(ref.type, 'value');
  const hash = (ref as any).value.hash as string;
  return decodeEastIR(new Uint8Array(entries.get(`objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`)!));
}

const STOCK_RUNNERS: ReadonlyArray<Runner> = [
  { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] },
  { runtime: 'east-c', platforms: ['east-c-std'] },
  { runtime: 'east-py', platforms: ['east-py-std'] },
];

describe('FileSystem.openBeast links on every stock runner (#660)', () => {
  let tempDir: string;
  before(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-open-beast-')); });
  after(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  it('the generic call is provided by the std family of each stock runner', () => {
    for (const runner of STOCK_RUNNERS) {
      assert.ok(runnerProvides(runner, 'east-py-std'), `${runner.runtime} provides the std family`);
    }
    assert.ok(!runnerProvides({ runtime: 'east-node', platforms: ['@elaraai/east-node-io'] }, 'east-py-std'));
  });

  for (const runner of STOCK_RUNNERS) {
    it(`embeds the imported function for the ${runner.runtime} runner, its generic platform call intact`, async () => {
      const file = input('file', StringType, 'rows.beast2');
      const use = task('sum_rows', [file], East.function([StringType], IntegerType, ($, p) => tot(p)), { runner });
      const pkg = package_('importer', '1.0.0', use);
      const zipPath = path.join(tempDir, `importer-${runner.runtime}.zip`);
      await export_(pkg, zipPath, { functions: [manifest] });

      const bundle = irAt(await readZip(zipPath), 'tasks/sum_rows/function_ir');
      assert.strictEqual(countImports(bundle.ir), 0, 'the import resolved to embedded IR');
      assert.deepStrictEqual(genericPlatformCalls(bundle.ir), [{ name: 'fs_open_beast', typeParameters: 1 }]);
    });
  }

  it("refuses a runner whose packages do not provide the call, naming it", async () => {
    const file = input('file', StringType, 'rows.beast2');
    const use = task('sum_rows', [file], East.function([StringType], IntegerType, ($, p) => tot(p)), {
      runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-io'] },
    });
    const pkg = package_('importer', '1.0.0', use);
    await assert.rejects(
      export_(pkg, path.join(tempDir, 'bad-runner.zip'), { functions: [manifest] }),
      /task "sum_rows" imports tables\.total, which calls platform function "fs_open_beast" provided by east-py-std, but its east-node runner lists @elaraai\/east-node-io/,
    );
  });
});
