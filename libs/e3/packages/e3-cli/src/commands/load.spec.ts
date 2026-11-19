/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 load` (§4.3, §7.13): the lines a load prints from the steps it reports,
 * handed real loads over a gated runner and the steps alone; what it prints
 * of what a load did; and the command against a local repository — a file
 * loaded, the same delivery by its hash answered again, an older one
 * superseded, and refusals before anything is stored.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DateTimeType, StringType, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LocalStorage, LocalTaskRunner, computeHash, packageImport, recordHistory, recordLoad } from '@elaraai/e3-core';
import {
  ErpDeliveryType, GatedTaskRunner, LEDGER_ORDERS, SourcedOrderType, createTempDir, createTestRepo, encodeInSegmentsOf, ledgerOrders,
  ledgerWorkspaces, removeTempDir, removeTestRepo, type LedgerWorkspaces,
} from '@elaraai/e3-core/test';
import type { RecordLoadProgress, RecordLoadResult } from '@elaraai/e3-types';
import { captured, withExitStub } from '../cli-test-helpers.js';
import { fedRefusal, loadCommand, loadLines, parseAsOf, parseDelivery, resultLine, terminalPrinter, type LoadPrinter } from './load.js';

type OrderRow = ValueTypeOf<typeof SourcedOrderType>;

const sameTime = equalFor(DateTimeType);
const { acme, birch, cedar } = LEDGER_ORDERS;
const COMMIT = '3f2a9c1e5d7b'.padEnd(64, '0');
const LATER = new Date('2026-11-02T03:00:00.000Z');
const EARLIER = new Date('2026-11-01T03:00:00.000Z');

/** A printer that keeps each line, and each line drawn in place. */
function recorder(): LoadPrinter & { readonly lines: string[]; readonly lives: string[] } {
  const lines: string[] = [];
  const lives: string[] = [];
  return { lines, lives, line: (text) => { lines.push(text); }, live: (text) => { lives.push(text); } };
}

/** A load's step: its pieces, so many done of so many, so many from the cache. */
const pieces = (done: bigint, total: bigint, cached = 0n): RecordLoadProgress => variant('pieces', { done, total, cached });

describe('e3 load', () => {
  describe('its lines', () => {
    let repoDir: string;
    let dir: string;
    let storage: LocalStorage;
    let runner: LocalTaskRunner;
    let ledger: LedgerWorkspaces;

    before(async () => {
      repoDir = createTestRepo();
      dir = createTempDir();
      storage = new LocalStorage(dirname(repoDir));
      runner = new LocalTaskRunner(repoDir);
      ledger = ledgerWorkspaces(storage, repoDir, runner);
      await e3.export(e3.package('ledger', '1.0.0', ledgerOrders()), join(dir, 'ledger.zip'));
      await packageImport(storage, repoDir, join(dir, 'ledger.zip'));
    });

    after(() => {
      removeTestRepo(repoDir);
      removeTempDir(dir);
    });

    /** A delivery of orders, stored as an upload stores one. */
    const deliver = (rows: Array<[string, OrderRow]>): Promise<string> =>
      storage.objects.write(repoDir, encodeInSegmentsOf(ErpDeliveryType, 2)(new Map(rows)));

    it('R14 — a load that waits its turn says so once, then takes its delivery in, and prints its pieces once they settle', async () => {
      const ws = await ledger.fresh();
      const gated = new GatedTaskRunner(runner, ['orders.erp']);
      const first = recordLoad(storage, gated, repoDir, ws, 'orders', 'erp', await deliver([['SO-1401', acme]]), { actor: 'cli:ada' });
      await gated.launched('orders.erp');

      const printed = recorder();
      const lines = loadLines('orders.erp', printed);
      let queued!: () => void;
      const waits = new Promise<void>((resolve) => { queued = resolve; });
      const second = recordLoad(storage, gated, repoDir, ws, 'orders', 'erp', await deliver([['SO-1402', birch], ['SO-1403', cedar]]), {
        actor: 'cli:ada',
        onProgress: (step) => {
          lines.progress(step);
          if (step.type === 'queued') queued();
        },
      });
      await waits;
      gated.pass('orders.erp');
      gated.release('orders.erp');
      await Promise.all([first, second]);
      lines.end();

      assert.deepEqual(printed.lines.slice(0, 2), ['Waiting for an earlier load of orders.erp to finish…', 'Taking the delivery in… done']);
      assert.match(printed.lines[2] ?? '', /^Pieces (\d+)\/\1$/, 'its pieces, once they settled');
      assert.equal(printed.lines.length, 3);
    });

    it('prints a step heard again as it was once, its pieces as they settle, stop or restart, and why it went on as it did', () => {
      const printed = recorder();
      const lines = loadLines('orders.erp', printed);
      const stopped = 'a deploy of main started. The load goes on once the deploy is done…';
      for (const step of [
        variant('queued', null), variant('queued', null),
        pieces(3n, 37n), pieces(3n, 37n), variant('stopped', stopped), variant('stopped', stopped),
        pieces(37n, 37n, 3n), variant('commit', null),
        variant('restarted', 'the entries of source \'erp\' changed under its load'),
        pieces(37n, 37n, 37n),
      ] satisfies RecordLoadProgress[]) lines.progress(step);
      lines.end();
      assert.deepEqual(printed.lines, [
        'Waiting for an earlier load of orders.erp to finish…',
        'Pieces 3/37',
        `Stopped: ${stopped}`,
        'Pieces 37/37 (3 from the cache)',
        'Loading again: the entries of source \'erp\' changed under its load',
        'Pieces 37/37 (37 from the cache)',
      ]);
      assert.deepEqual(printed.lives, ['Pieces 3/37', 'Pieces 37/37 (3 from the cache)', 'Pieces 37/37 (37 from the cache)']);
    });

    it('says the intake is done only once the load has gone on from it: one refused, cancelled or stopped during it prints its line as it stood', () => {
      const intake = (done: bigint): RecordLoadProgress =>
        variant('intake', { path: 'inputs/delivery', step: variant('taking_in', { pieces: 10n, done }), bytes: done, total: 10n });
      const stopped = 'a deploy of main started. The load goes on once the deploy is done…';
      const said = (steps: RecordLoadProgress[]): string[] => {
        const printed = recorder();
        const lines = loadLines('orders.erp', printed);
        for (const step of steps) lines.progress(step);
        lines.end();
        return printed.lines;
      };

      // It went on to its pieces, or straight to its commit: done
      assert.deepEqual(said([intake(3n), intake(10n), pieces(1n, 1n)]), ['Taking the delivery in… done', 'Pieces 1/1']);
      assert.deepEqual(said([intake(3n), variant('commit', null)]), ['Taking the delivery in… done']);
      // The load ended during it, refused or cancelled: as it stood
      assert.deepEqual(said([intake(3n)]), ['Taking the delivery in… 3/10 pieces']);
      // A deploy stopped it, and its intake ran again once the deploy was done
      assert.deepEqual(said([intake(3n), variant('stopped', stopped), intake(10n), pieces(1n, 1n)]), [
        'Taking the delivery in… 3/10 pieces',
        `Stopped: ${stopped}`,
        'Taking the delivery in… done',
        'Pieces 1/1',
      ]);
    });

    it('draws the line that counts up in place on a terminal alone, and clears it before the next line', () => {
      const written: string[] = [];
      const tty = terminalPrinter({ write: (chunk) => written.push(chunk), isTTY: true });
      tty.live('Pieces 1/2');
      tty.live('Pieces 2/2');
      tty.line('Pieces 2/2');
      tty.line('done');
      assert.deepEqual(written, ['\r\x1b[KPieces 1/2', '\r\x1b[KPieces 2/2', '\r\x1b[KPieces 2/2\n', 'done\n']);

      const piped: string[] = [];
      const pipe = terminalPrinter({ write: (chunk) => piped.push(chunk) });
      pipe.live('Pieces 1/2');
      pipe.line('Pieces 2/2');
      assert.deepEqual(piped, ['Pieces 2/2\n'], 'a pipe is given settled lines alone');
    });
  });

  describe('its answers', () => {
    const result = (outcome: RecordLoadResult['outcome'], commit: RecordLoadResult['commit'] = some(COMMIT)): RecordLoadResult => ({
      commit, state: none, delivery: 'd'.repeat(64), set: 1_204n, deleted: 31n, unchanged: 98_112n, outcome,
    });

    it('says what a load did: its commit as e3 history names it, its as-of, and its counts as East prints them', () => {
      assert.equal(resultLine('orders.erp', result(variant('loaded', null)), LATER),
        'Loaded orders.erp at 3f2a9c1e5d7b, as of 2026-11-02T03:00:00.000: 1,204 set, 31 deleted, 98,112 unchanged');
      assert.equal(resultLine('orders.erp', result(variant('loaded', null)), undefined),
        'Loaded orders.erp at 3f2a9c1e5d7b: 1,204 set, 31 deleted, 98,112 unchanged');
      assert.equal(resultLine('orders.erp', result(variant('again', null)), undefined), 'orders.erp already holds this delivery, loaded at 3f2a9c1e5d7b');
      assert.equal(resultLine('orders.erp', result(variant('again', null), none), undefined), 'orders.erp already holds this delivery',
        'a commit a compaction cut is not named');
    });

    it('R11 — says a delivery older than the source\'s was superseded, naming both as-ofs', () => {
      assert.equal(resultLine('orders.erp', result(variant('superseded', LATER), none), EARLIER),
        'orders.erp holds a delivery as of 2026-11-02T03:00:00.000, later than this one\'s 2026-11-01T03:00:00.000: nothing loaded (superseded)');
    });

    it('reads --as-of as East reads a time, in UTC, and refuses one it cannot read, naming the form', () => {
      assert.ok(sameTime(parseAsOf('2026-11-02T03:00:00'), LATER));
      assert.throws(() => parseAsOf('yesterday'), /^Error: --as-of takes a time as East writes one, such as 2026-11-02T03:00:00 \(UTC\): /);
    });

    it('names a delivery the repository holds by its hash, any other argument a file, and refuses a # that names no SHA-256', () => {
      assert.deepEqual(parseDelivery(`#${COMMIT}`), { kind: 'stored', hash: COMMIT });
      assert.deepEqual(parseDelivery('erp.beast2'), { kind: 'file', file: join(process.cwd(), 'erp.beast2') });
      assert.throws(() => parseDelivery('#5e7a3b0c'), /a delivery the repository holds is named #<hash>, its SHA-256 in 64 lowercase hex digits: got '#5e7a3b0c'/);
    });

    it('R20 — refuses a source the dataflow loads, naming its feed and the run that loads it', () => {
      assert.equal(fedRefusal('.', 'main', 'orders', 'erp', '.tasks.combine_erp.output'),
        'orders.erp is fed by .tasks.combine_erp.output, and the dataflow loads it: e3 dataflow run . main --filter orders.erp');
    });
  });

  describe('against a local repository', () => {
    let repoDir: string;
    let dir: string;
    let storage: LocalStorage;
    let ledger: LedgerWorkspaces;

    before(async () => {
      repoDir = createTestRepo();
      dir = createTempDir();
      storage = new LocalStorage(dirname(repoDir));
      ledger = ledgerWorkspaces(storage, repoDir, new LocalTaskRunner(repoDir));
      await e3.export(e3.package('ledger', '1.0.0', ledgerOrders()), join(dir, 'ledger.zip'));
      await packageImport(storage, repoDir, join(dir, 'ledger.zip'));
    });

    after(() => {
      removeTestRepo(repoDir);
      removeTempDir(dir);
    });

    /** A file of a delivery of orders. */
    const file = (name: string, rows: Array<[string, OrderRow]>): string => {
      const path = join(dir, name);
      writeFileSync(path, encodeInSegmentsOf(ErpDeliveryType, 2)(new Map(rows)));
      return path;
    };

    it('loads a file, answers the same delivery named by its hash again, and an older one superseded, each in its line', async () => {
      const ws = await ledger.fresh();
      const delivered = file('erp.beast2', [['SO-7001', acme], ['SO-7002', birch]]);
      const loaded = await captured(() => loadCommand(repoDir, 'orders.erp', delivered, { workspace: ws, asOf: '2026-11-02T03:00:00' }));
      const [head] = await recordHistory(storage, repoDir, ws, 'orders');
      assert.equal(head!.commit.mutation, '$load:erp');
      assert.equal(loaded, `Loaded orders.erp at ${head!.hash.slice(0, 12)}, as of 2026-11-02T03:00:00.000: 2 set, 0 deleted, 0 unchanged`);

      // The file was stored as the object it is: its hash names the same delivery
      const again = await captured(() => loadCommand(repoDir, 'orders.erp', `#${computeHash(readFileSync(delivered))}`, { workspace: ws }));
      assert.equal(again, `orders.erp already holds this delivery, loaded at ${head!.hash.slice(0, 12)}`);

      const older = file('erp-older.beast2', [['SO-7001', cedar]]);
      const superseded = await captured(() => loadCommand(repoDir, 'orders.erp', older, { workspace: ws, asOf: '2026-11-01T03:00:00' }));
      assert.equal(superseded,
        'orders.erp holds a delivery as of 2026-11-02T03:00:00.000, later than this one\'s 2026-11-01T03:00:00.000: nothing loaded (superseded)');
      assert.equal((await recordHistory(storage, repoDir, ws, 'orders')).filter(({ commit }) => commit.mutation === '$load:erp').length, 1);
    });

    it('refuses a file of another type than the source\'s delivery before storing it, a missing --workspace, and a source no delivery is loaded into', async () => {
      const ws = await ledger.fresh();
      const before = await recordHistory(storage, repoDir, ws, 'orders');
      // A beast2 file of a String, which no source is delivered
      const text = join(dir, 'text.beast2');
      writeFileSync(text, encodeBeast2For(StringType)('five'));
      for (const [spec, delivery, options, words] of [
        ['orders.erp', text, { workspace: ws }, /^Error: source 'erp' of record 'orders' /],
        ['orders.erp', text, {}, /^Error: e3 load requires --workspace/],
        ['orders.own', file('own.beast2', [['SO-7101', acme]]), { workspace: ws },
          /^Error: source 'own' of record 'orders' is the solution's: its mutations write it, and no delivery is loaded into it$/],
      ] as const) {
        const said: string[] = [];
        await assert.rejects(withExitStub(() => loadCommand(repoDir, spec, delivery, options), said), /exit 1/);
        assert.match(said[0] ?? '', words);
      }
      assert.deepEqual(await recordHistory(storage, repoDir, ws, 'orders'), before, 'nothing was loaded');
    });
  });
});
