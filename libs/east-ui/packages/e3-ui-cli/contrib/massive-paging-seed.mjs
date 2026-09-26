/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Seeds a repository with two massive paged inputs for the TUI's paging probe
// (massive-paging-probe.mjs): `wide`, a Dict of wide struct rows (§17's shape,
// about 850 stored bytes a row), and `narrow`, a Dict of integers. The rows
// stream through the store's door, so this process never holds a dataset.
//
//   node contrib/massive-paging-seed.mjs <repo-dir> [wideRows] [narrowRows]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import e3 from '@elaraai/e3';
import { ArrayType, DictType, East, FloatType, IntegerType, StringType, StructType, variant } from '@elaraai/east';
import {
  LocalStorage, packageImport, repoInit, storeCollection, workspaceCreate, workspaceDeploy, workspaceSetDatasetByHash,
} from '@elaraai/e3-core';

const [repo, wideArg = '700000', narrowArg = '5000000'] = process.argv.slice(2);
if (repo === undefined) throw new Error('usage: massive-paging-seed.mjs <repo-dir> [wideRows] [narrowRows]');
const wideRows = Number(wideArg);
const narrowRows = Number(narrowArg);

const WideRowType = StructType({
  id: IntegerType,
  site: StringType,
  amounts: ArrayType(FloatType),
  note: StringType,
  nested: StructType({ a: IntegerType, b: StringType }),
});
const WideType = DictType(StringType, WideRowType);
const NarrowType = DictType(StringType, IntegerType);

mkdirSync(repo, { recursive: true });
repoInit(repo);
const storage = new LocalStorage();

const wide = e3.input('wide', WideType, variant('value', new Map()));
const narrow = e3.input('narrow', NarrowType, variant('value', new Map()));
const count = e3.task('count', [wide, narrow],
  East.function([WideType, NarrowType], IntegerType, ($, w, n) => w.size().add(n.size())));
const zips = join(repo, '..', 'zips');
mkdirSync(zips, { recursive: true });
const zip = join(zips, 'massive-1.0.0.zip');
await e3.export(e3.package('massive', '1.0.0', count), zip);
await packageImport(storage, repo, zip);
await workspaceCreate(storage, repo, 'big');
await workspaceDeploy(storage, repo, 'big', 'massive', '1.0.0');

async function* wideElements() {
  for (let i = 0; i < wideRows; i++) {
    yield [`k${String(i).padStart(7, '0')}`, {
      id: BigInt(i),
      site: `site-${i % 97}`,
      amounts: Array.from({ length: 8 }, () => Math.random() * 1e6),
      note: randomBytes(600).toString('base64'),
      nested: { a: BigInt(i * 3), b: `b${i % 1013}` },
    }];
  }
}
async function* narrowElements() {
  for (let i = 0; i < narrowRows; i++) yield [`k${String(i).padStart(7, '0')}`, BigInt(i * 7)];
}

for (const [name, type, elements] of [['wide', WideType, wideElements], ['narrow', NarrowType, narrowElements]]) {
  const t0 = Date.now();
  const hash = await storeCollection(storage, repo, type, [{ elements: elements() }]);
  const path = [variant('field', 'inputs'), variant('field', name)];
  await workspaceSetDatasetByHash(storage, repo, 'big', path, hash, new Map([[`.inputs.${name}`, hash]]));
  console.log(`${name}: ${hash} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
