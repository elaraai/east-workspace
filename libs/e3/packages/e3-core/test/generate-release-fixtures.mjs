/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/*
 * Writes the checked-in zips a released e3 exported, which every later e3
 * imports (`src/packages.spec.ts`), and what that release made of them:
 *
 * - `sdk.zip`, the SDK's `e3.export` of a package: its entries deflated, as
 *   yazl writes them;
 * - `core.zip`, e3-core's `packageExport` of the same package once the
 *   release imported it: its entries stored, by the release's own zip writer;
 * - `release.json`, the release, and the package, object count and objects
 *   its import of `sdk.zip` took in, which an import of either is held to.
 *
 * The package holds what an import takes in: a value, a collection of several
 * hundred rows, a task, and a record with an index, whose state is a record's
 * and an index's manifests.
 *
 * The fixtures must not depend on the machine that wrote them, so the package
 * is built with East's source-location capture off: a captured location names
 * the file that built a node as that machine lays it out, which would put its
 * paths in the repository and make the bytes differ by where the generator
 * ran. Capture is switched off in the release's own East, the one its SDK and
 * e3-core build with, before anything is loaded that builds East.
 *
 * Run it with the release's packages installed outside the workspace, never
 * from the workspace's own builds:
 *
 *   mkdir -p /tmp/e3-release && cd /tmp/e3-release && echo '{"type":"module"}' > package.json
 *   npm install --ignore-scripts @elaraai/e3@1.0.84 @elaraai/e3-core@1.0.84 @elaraai/east@1.0.84
 *   node libs/e3/packages/e3-core/test/generate-release-fixtures.mjs /tmp/e3-release
 *
 * It writes `test/fixtures/release-<release>/`, the release as the installed
 * e3 names it.
 */

import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [installed] = process.argv.slice(2);
if (installed === undefined) throw new Error('usage: generate-release-fixtures.mjs <the directory the release is installed in>');
const require = createRequire(join(installed, 'package.json'));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const EAST = require.resolve('@elaraai/east');
for (const name of ['@elaraai/e3', '@elaraai/e3-core']) {
  const theirs = createRequire(require.resolve(name)).resolve('@elaraai/east');
  if (theirs !== EAST) throw new Error(`${name} builds with the East at ${theirs}, not the one at ${EAST} this generator switches capture off in`);
}
const east = await load('@elaraai/east');
east.setLocationCapture(false);
const { East, DictType, IntegerType, SortedMap, StringType, StructType, compareFor, variant } = east;
const { default: e3 } = await load('@elaraai/e3');
const { LocalStorage, packageExport, packageImport, repoInit } = await load('@elaraai/e3-core');
const { E3_RELEASE } = await load('@elaraai/e3-types');

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', `release-${E3_RELEASE}`);
mkdirSync(out, { recursive: true });

const RowType = StructType({ name: StringType, units: IntegerType });
const RowsType = DictType(IntegerType, RowType);
const OrderType = StructType({ status: StringType });
const greeting = e3.input('greeting', StringType, variant('value', `exported by e3 ${E3_RELEASE}`));
const rows = e3.input('rows', RowsType, variant('value', new SortedMap(
  Array.from({ length: 400 }, (_, i) => [BigInt(i), { name: `row ${i}`, units: BigInt(i * 7) }]),
  compareFor(IntegerType),
)));
const count = e3.task('count', [rows], East.function([RowsType], IntegerType, ($, rows) => rows.size()));
const orders = e3.record('orders', DictType(StringType, OrderType), new Map([['o-1', { status: 'open' }], ['o-2', { status: 'shipped' }]]));
const byStatus = e3.recordIndex('by_status', orders, {
  key: East.function([StringType, OrderType], StringType, ($, _id, order) => order.status),
});
const pkg = e3.package('released', '1.0.0', greeting, rows, count, orders, byStatus);

const sdkZip = join(out, 'sdk.zip');
await e3.export(pkg, sdkZip);

const dir = mkdtempSync(join(tmpdir(), 'e3-release-'));
try {
  const created = repoInit(join(dir, 'repo'));
  if (!created.success) throw created.error;
  const storage = new LocalStorage();
  const imported = await packageImport(storage, created.repoPath, sdkZip);
  const coreZip = join(out, 'core.zip');
  const exported = await packageExport(storage, created.repoPath, imported.name, imported.version, coreZip);
  if (exported.packageHash !== imported.packageHash || exported.objectCount !== imported.objectCount) {
    throw new Error(`the release exported ${JSON.stringify(exported)} of the package it imported as ${JSON.stringify(imported)}`);
  }
  const objects = (await storage.objects.list(created.repoPath)).sort();
  writeFileSync(join(out, 'release.json'), `${JSON.stringify({
    release: E3_RELEASE,
    name: imported.name,
    version: imported.version,
    packageHash: imported.packageHash,
    objectCount: imported.objectCount,
    objects,
    zips: { 'sdk.zip': statSync(sdkZip).size, 'core.zip': exported.bytes },
  }, null, 2)}\n`);
  console.log(`e3 ${E3_RELEASE}: ${imported.name}@${imported.version}, ${imported.objectCount} objects, into ${out}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
