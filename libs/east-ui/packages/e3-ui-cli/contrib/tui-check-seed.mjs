/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Seeds a repository for the TUI check (tui-check-probe.mjs), shaped like the
// data the platform now stores:
// - `wide`, a Dict of §17's wide struct rows (about 850 stored bytes a row);
// - `cols`, a Dict of 150-column rows (about 2.5 KB a row);
// - `big`, a Dict of rows carrying a 4,000-float series (about 32 KB a row),
//   which the size-aware cut stores a few rows to a segment;
// - `enrich`, a task split over `wide` whose pieces splice, and `by_site`, one
//   whose keyed partials merge;
// - `ledger`, a record with a secondary index.
// The inputs stream through the store's door, so this process never holds one.
//
//   node contrib/tui-check-seed.mjs <repo-dir> [wideRows] [colsRows] [bigRows] [ledgerRows]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import e3 from '@elaraai/e3';
import { ArrayType, DictType, East, FloatType, IntegerType, StringType, StructType, variant } from '@elaraai/east';
import {
  LocalStorage, LocalTaskRunner, packageImport, repoInit, storeCollection, workspaceCreate, workspaceDeploy, workspaceSetDatasetByHash,
} from '@elaraai/e3-core';

const [repo, wideArg = '700000', colsArg = '250000', bigArg = '20000', ledgerArg = '200000'] = process.argv.slice(2);
if (repo === undefined) throw new Error('usage: tui-check-seed.mjs <repo-dir> [wideRows] [colsRows] [bigRows] [ledgerRows]');
const [wideRows, colsRows, bigRows, ledgerRows] = [wideArg, colsArg, bigArg, ledgerArg].map(Number);

const WideRowType = StructType({
  id: IntegerType,
  site: StringType,
  amounts: ArrayType(FloatType),
  note: StringType,
  nested: StructType({ a: IntegerType, b: StringType }),
});
const WideType = DictType(StringType, WideRowType);
const colName = (i) => `c${String(i).padStart(3, '0')}`;
const ColsRowType = StructType(Object.fromEntries(Array.from({ length: 150 }, (_, i) =>
  [colName(i), i % 3 === 0 ? FloatType : i % 3 === 1 ? IntegerType : StringType])));
const ColsType = DictType(StringType, ColsRowType);
const BigRowType = StructType({ id: IntegerType, label: StringType, series: ArrayType(FloatType) });
const BigType = DictType(StringType, BigRowType);
const LedgerRowType = StructType({ site: StringType, amount: FloatType, status: StringType, note: StringType });
const LedgerType = DictType(StringType, LedgerRowType);

mkdirSync(repo, { recursive: true });
repoInit(repo);
const storage = new LocalStorage();

const wide = e3.input('wide', WideType, variant('value', new Map()));
const cols = e3.input('cols', ColsType, variant('value', new Map()));
const big = e3.input('big', BigType, variant('value', new Map()));
const EnrichedType = StructType({ id: IntegerType, site: StringType, total: FloatType });
const enrich = e3.streamTask('enrich', {
  inputs: [e3.partition(wide)],
  output: e3.output.dict(StringType, EnrichedType),
}, ($, rows, emit) => {
  $.for(rows, ($, row, key) => {
    $(emit(key, {
      id: row.id,
      site: row.site,
      total: row.amounts.reduce(($, total, amount, _i) => total.add(amount), 0.0),
    }));
  });
});
const bySite = e3.streamTask('by_site', {
  inputs: [e3.partition(wide)],
  output: e3.output.dict(StringType, IntegerType, { merge: ($, _site, a, b) => a.add(b) }),
}, ($, rows, emit) => {
  $.for(rows, ($, row, _key) => {
    $(emit(row.site, 1n));
  });
});
const count = e3.task('count', [cols, big],
  East.function([ColsType, BigType], IntegerType, ($, c, b) => c.size().add(b.size())));

const ledgerInitial = new Map();
for (let i = 0; i < ledgerRows; i++) {
  ledgerInitial.set(`L${String(i).padStart(7, '0')}`, {
    site: `site-${i % 97}`,
    amount: Math.round(Math.random() * 1e6) / 100,
    status: ['open', 'held', 'closed'][i % 3],
    note: randomBytes(24).toString('base64'),
  });
}
const ledger = e3.record('ledger', LedgerType, ledgerInitial);
const ledgerBySite = e3.recordIndex('by_site', ledger, {
  key: East.function([StringType, LedgerRowType], StructType({ site: StringType, id: StringType }),
    ($, id, row) => ({ site: row.site, id })),
  value: East.function([StringType, LedgerRowType], FloatType, ($, _id, row) => row.amount),
});

const zips = join(repo, '..', 'zips');
mkdirSync(zips, { recursive: true });
const zip = join(zips, 'tuicheck-1.0.0.zip');
await e3.export(e3.package('tuicheck', '1.0.0', enrich, bySite, count, ledger, ledgerBySite, e3.mutation.patch(ledger)), zip);
await packageImport(storage, repo, zip);
await workspaceCreate(storage, repo, 'big');
// The record's index is built at deploy, on a runner.
await workspaceDeploy(storage, repo, 'big', 'tuicheck', '1.0.0', { runner: new LocalTaskRunner(repo) });

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
async function* colsElements() {
  for (let i = 0; i < colsRows; i++) {
    const row = {};
    for (let c = 0; c < 150; c++) {
      row[colName(c)] = c % 3 === 0 ? Math.random() * 1e4 : c % 3 === 1 ? BigInt(i * 150 + c) : randomBytes(18).toString('base64');
    }
    yield [`r${String(i).padStart(7, '0')}`, row];
  }
}
async function* bigElements() {
  for (let i = 0; i < bigRows; i++) {
    yield [`s${String(i).padStart(6, '0')}`, {
      id: BigInt(i),
      label: `series ${i}`,
      series: Array.from({ length: 4000 }, () => Math.random()),
    }];
  }
}

for (const [name, type, elements] of [['wide', WideType, wideElements], ['cols', ColsType, colsElements], ['big', BigType, bigElements]]) {
  const t0 = Date.now();
  const hash = await storeCollection(storage, repo, type, [{ elements: elements() }]);
  const path = [variant('field', 'inputs'), variant('field', name)];
  await workspaceSetDatasetByHash(storage, repo, 'big', path, hash, new Map([[`.inputs.${name}`, hash]]));
  console.log(`${name}: ${hash} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
