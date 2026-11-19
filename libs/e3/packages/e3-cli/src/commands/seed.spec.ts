/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 seed` adapter: against a local repo it resolves a record declared with
 * no initial value, takes the file in, commits it as the record's `$init` and
 * reports it; a record that holds a state, a composite record, a file of
 * another type, an unknown record or a missing --workspace exits non-zero,
 * writing nothing.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { East, IntegerType, PatchType, SortedMap, StringType, compareFor, encodeBeast2For, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, recordHistory, packageImport, workspaceCreate, workspaceDeploy, workspaceGetDataset } from '@elaraai/e3-core';
import { ErpDeliveryType, SourcedOrderType, createTestRepo, removeTestRepo, createTempDir, removeTempDir, ordersOverSources } from '@elaraai/e3-core/test';
import { compositeSeedRefusal, seedCommand } from './seed.js';

const encodeInt = encodeBeast2For(IntegerType);
const counterPath = [variant('field', 'records'), variant('field', 'counter')];

/** Run `fn` with process.exit stubbed to throw (so exitError surfaces as a
 *  rejection instead of killing the test runner) and console.error kept from
 *  the terminal: each line it was given goes to `said`. */
async function withExitStub(fn: () => Promise<void>, said: string[] = []): Promise<void> {
  const origExit = process.exit;
  const origErr = console.error;
  process.exit = ((code?: number) => { throw new Error(`exit ${code ?? 0}`); }) as never;
  console.error = (...a: unknown[]) => { said.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
}

/** Run `fn` with console.log captured. */
async function captured(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = origLog;
  }
  return lines.join('\n');
}

describe('seedCommand', () => {
  let repo: string;
  let tempDir: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));

    // A record declared with no initial value: unassigned until seeded
    const counter = e3.record('counter', IntegerType, {
      mutations: (mutation) => ({
        increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
      }),
    });
    const pkg = e3.package('counters', '1.0.0', counter);
    const zip = join(tempDir, 'counters.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'counters', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it("commits a local record's first state from a beast2 file, as its $init, and refuses a second", async () => {
    assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), [], 'unassigned after the deploy');
    const file = join(tempDir, 'five.beast2');
    writeFileSync(file, encodeInt(5n));

    const output = await captured(() => seedCommand(repo, 'counter', file, { workspace: 'main' }));

    assert.match(output, /Seeded 'counter' from .*five\.beast2/);
    const history = await recordHistory(storage, repo, 'main', 'counter');
    assert.equal(history.length, 1);
    assert.equal(history[0]!.commit.mutation, '$init');
    assert.match(history[0]!.commit.actor, /^cli:/);
    assert.equal(await workspaceGetDataset(storage, repo, 'main', counterPath), 5n);

    // A record that holds a state takes no second first state
    await assert.rejects(withExitStub(() => seedCommand(repo, 'counter', file, { workspace: 'main' })));
    assert.equal((await recordHistory(storage, repo, 'main', 'counter')).length, 1);
  });

  it('R5 — refuses a composite record, naming e3 load for its external source and its mutations for the rest, and writes nothing', async () => {
    // `orders`: its source erp loaded from a delivery, and own the solution's
    const orders = ordersOverSources();
    const zip = join(tempDir, 'sales.zip');
    await e3.export(e3.package('sales', '1.0.0', orders), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'sales');
    await workspaceDeploy(storage, repo, 'sales', 'sales', '1.0.0');
    const before = await recordHistory(storage, repo, 'sales', 'orders');

    // A file of the record's own type, as a seed of any other record takes
    const file = join(tempDir, 'orders.beast2');
    writeFileSync(file, encodeBeast2For(orders.type)(new SortedMap([], compareFor(orders.type.key))));
    const said: string[] = [];
    await assert.rejects(withExitStub(() => seedCommand(repo, 'orders', file, { workspace: 'sales' }), said));
    assert.equal(said[0], 'Error: Record \'orders\' is a composite, and takes no state from e3 seed: each entry is one of its sources\'. '
      + 'Load a delivery into erp (e3 load <repo> orders.erp <file> -w sales), '
      + 'and write the solution\'s own entries by the record\'s mutations (e3 mutate <repo> orders.<mutation> -w sales).');
    assert.deepEqual(await recordHistory(storage, repo, 'sales', 'orders'), before, 'nothing was written');

    // Several external sources are named together, and a composite with none is pointed at its mutations alone
    assert.match(compositeSeedRefusal('stock', 'main', ['erp', 'wms'], true), /Load a delivery into one of erp, wms \(e3 load <repo> stock\.<source> <file> -w main\), and write/);
    assert.equal(compositeSeedRefusal('plan', 'main', [], true), 'Record \'plan\' is a composite, and takes no state from e3 seed: each entry is one of its sources\'. '
      + 'Write the solution\'s own entries by the record\'s mutations (e3 mutate <repo> plan.<mutation> -w main).');
  });

  it('ruling 46 — the refusal of a composite whose sources are all external names e3 load alone: such a record has no mutation', async () => {
    // `stock`: erp and wms, each loaded from a delivery, and no source of the solution's own
    const load = East.function([ErpDeliveryType, ErpDeliveryType], PatchType(ErpDeliveryType), (_$, delivery, current) => East.diff(current, delivery));
    const stock = e3.recordComposite('stock', SourcedOrderType, {
      sources: (source) => ({ erp: source.load(StringType, ErpDeliveryType, load), wms: source.load(StringType, ErpDeliveryType, load) }),
    });
    const zip = join(tempDir, 'stock.zip');
    await e3.export(e3.package('stock', '1.0.0', stock), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'stock');
    await workspaceDeploy(storage, repo, 'stock', 'stock', '1.0.0');

    const file = join(tempDir, 'stock.beast2');
    writeFileSync(file, encodeBeast2For(stock.type)(new SortedMap([], compareFor(stock.type.key))));
    const said: string[] = [];
    await assert.rejects(withExitStub(() => seedCommand(repo, 'stock', file, { workspace: 'stock' }), said));
    assert.equal(said[0], 'Error: Record \'stock\' is a composite, and takes no state from e3 seed: each entry is one of its sources\'. '
      + 'Load a delivery into one of erp, wms (e3 load <repo> stock.<source> <file> -w stock).');
    assert.equal(compositeSeedRefusal('stock', 'main', ['erp'], false), 'Record \'stock\' is a composite, and takes no state from e3 seed: each entry is one of its sources\'. '
      + 'Load a delivery into erp (e3 load <repo> stock.erp <file> -w main).');
  });

  it('refuses a file of another type, writing nothing', async () => {
    const file = join(tempDir, 'text.beast2');
    writeFileSync(file, encodeBeast2For(StringType)('five'));
    await assert.rejects(withExitStub(() => seedCommand(repo, 'counter', file, { workspace: 'main' })));
    assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), []);
  });

  it('exits non-zero for an unknown record, and when --workspace is omitted', async () => {
    const file = join(tempDir, 'five.beast2');
    writeFileSync(file, encodeInt(5n));
    await assert.rejects(withExitStub(() => seedCommand(repo, 'ghost', file, { workspace: 'main' })));
    await assert.rejects(withExitStub(() => seedCommand(repo, 'counter', file, {})));
    assert.deepEqual(await recordHistory(storage, repo, 'main', 'counter'), []);
  });
});
