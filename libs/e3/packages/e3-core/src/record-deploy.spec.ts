/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A deploy's record migrations, on the real runner: the plan it makes for each
 * record, the steps it runs before it writes, the commits it leaves, and the
 * reserved slots those commits keep.
 *
 * A workspace moves through one record's versions. v1 holds rows of a title;
 * v2 adds an owner to each row (a `rows` step) and indexes the rows by owner;
 * v3 keys the rows by their title (a `rekey` step, which keeps the type).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  DictType, East, IntegerType, SetType, StringType, StructType, decodeBeast2For, encodeBeast2For, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import e3, { type PackageDef } from '@elaraai/e3';
import type { RecordIndexPlan, RecordPlan, TreePath } from '@elaraai/e3-types';
import { appliedMigrations, readRecordState, recordCompact, recordHistory, recordMutate, recordReindex } from './records.js';
import { readDatasetWhole } from './dataset-open.js';
import { repoGc } from './storage/local/gc.js';
import { RecordDeployRefusedError } from './errors.js';
import { workspaceGetDataset } from './trees.js';
import { packageImport } from './packages.js';
import { workspaceCreate, workspaceDeploy, workspaceGetPackage, type WorkspaceDeployOptions } from './workspaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend, TaskRunner } from './index.js';

const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const PlansV1Type = DictType(StringType, RowV1Type);
const PlansV2Type = DictType(StringType, RowV2Type);
const plansPath: TreePath = [variant('field', 'records'), variant('field', 'plans')];
const encodeInt = encodeBeast2For(IntegerType);
const encodeStr = encodeBeast2For(StringType);

/** Runs `fn` with the given env vars set, restoring them after. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev = Object.keys(vars).map((k) => [k, process.env[k]] as const);
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** v1: rows of a title, and `seed(n)`, which writes rows p-0 … p-(n-1). */
function v1(version = '1.0.0'): PackageDef<Record<string, unknown>> {
  const plans = e3.record('plans', PlansV1Type, new Map());
  const seed = e3.mutation.reduce('seed', plans, East.function([PlansV1Type, IntegerType], PlansV1Type, ($, _state, n) => {
    const out = $.let(new Map(), PlansV1Type);
    $.for(East.Array.range(0n, n), ($, i) => {
      $(out.insert(East.str`p-${i}`, { title: East.str`Plan ${i}` }));
    });
    return out;
  }));
  return e3.package('planning', version, plans, seed);
}

/** What a later version adds to a record at v2's type: `add(id)`, a row of
 *  that title, and an index by owner. */
function v2Declarations(plans: ReturnType<typeof e3.record<'plans', typeof PlansV2Type>>) {
  const add = e3.mutation.reduce('add', plans, East.function([PlansV2Type, StringType], PlansV2Type, ($, state, id) => {
    const next = $.let(state.copy());
    $(next.insert(id, { title: id, owner: 'someone' }));
    return next;
  }));
  const byOwner = e3.recordIndex('by_owner', plans, {
    key: East.function([StringType, RowV2Type], StringType, ($, _id, row) => row.owner),
  });
  return [add, byOwner] as const;
}

/** The step v2 adds: an owner on each row. */
function addOwner(plans: ReturnType<typeof e3.record<'plans', typeof PlansV2Type>>) {
  return e3.migration.rows('add_owner', plans,
    East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' })));
}

/** v2: an owner on each row, by a `rows` step, and an index by owner. */
function v2(version = '2.0.0'): PackageDef<Record<string, unknown>> {
  const plans = e3.record('plans', PlansV2Type, new Map());
  return e3.package('planning', version, plans, addOwner(plans), ...v2Declarations(plans));
}

/** v3: the rows keyed by their title, by a `rekey` step after v2's. */
function v3(): PackageDef<Record<string, unknown>> {
  const plans = e3.record('plans', PlansV2Type, new Map());
  const byTitle = e3.migration.rekey('by_title', plans,
    East.function([StringType, RowV2Type], StructType({ key: StringType, value: RowV2Type }),
      ($, _id, row) => ({ key: row.title, value: row })),
    { after: addOwner(plans) });
  return e3.package('planning', '3.0.0', plans, byTitle, ...v2Declarations(plans));
}

describe('a deploy\'s record migrations', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: TaskRunner;
  const ws = 'main';

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);
    await workspaceCreate(storage, repo, ws);
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Export, import and deploy a package to `workspace`, on the real runner. */
  async function deploy(pkg: PackageDef<Record<string, unknown>>, options: WorkspaceDeployOptions = {}, workspace = ws): Promise<void> {
    const zip = join(tempDir, `${pkg.name}-${pkg.version}.zip`);
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceDeploy(storage, repo, workspace, pkg.name, pkg.version, { runner, ...options });
  }

  /** v1 deployed to `workspace` and seeded with `rows` rows. */
  async function seeded(rows: bigint, workspace = ws): Promise<void> {
    await deploy(v1(), {}, workspace);
    const outcome = await recordMutate(storage, runner, repo, workspace, 'plans', 'seed', [encodeInt(rows)], { actor: 'cli:test' });
    assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
  }

  /** The record's ref in `workspace`. */
  async function ref(workspace = ws): Promise<{ hash: string; versions: Map<string, string> }> {
    const held = await storage.datasets.read(repo, workspace, 'records/plans');
    assert.ok(held && held.type === 'value');
    return held.value;
  }

  /** The names of the record's commits, newest first. */
  async function history(workspace = ws): Promise<string[]> {
    return (await recordHistory(storage, repo, workspace, 'plans')).map((entry) => entry.commit.mutation);
  }

  /** How many executions the repository has recorded. */
  async function countExecutions(): Promise<number> {
    let total = 0;
    for (const { taskHash, inputsHash } of await storage.refs.executionList(repo)) {
      total += (await storage.refs.executionListIds(repo, taskHash, inputsHash)).length;
    }
    return total;
  }

  it('mints a record with the whole chain counted applied', async () => {
    await deploy(v2());
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner'],
      'the initial value is at the package\'s type, so every step counts as applied');
    assert.deepEqual(await history(), ['$reindex', '$init']);
  });

  it('migrates a record by the steps it has not applied, a commit each, and builds its indexes over the result', async () => {
    await seeded(600n);
    const plans: RecordPlan[] = [];
    await deploy(v2(), { onRecordPlan: (plan) => plans.push(plan) });
    assert.deepEqual(plans, [{ record: 'records/plans', action: variant('migrate', { steps: ['add_owner'] }) }]);

    const rows = await workspaceGetDataset(storage, repo, ws, plansPath) as Map<string, ValueTypeOf<typeof RowV2Type>>;
    assert.equal(rows.size, 600);
    assert.deepEqual(rows.get('p-7'), { title: 'Plan 7', owner: 'unassigned' });
    assert.deepEqual(await history(), ['$reindex', '$migrate:add_owner', 'seed', '$init']);
    const [, migrate] = await recordHistory(storage, repo, ws, 'plans');
    assert.equal(migrate!.commit.actor, 'system:deploy');
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner']);
    assert.deepEqual([...(await readRecordState(storage, repo, (await ref()).hash)).indexes.keys()], ['by_owner'],
      'the migrated state is indexed as the package declares');

    // v3 keys the rows by title, a step that keeps the type: only its name
    // tells the workspace it has not run.
    await deploy(v3());
    const keyed = await workspaceGetDataset(storage, repo, ws, plansPath) as Map<string, ValueTypeOf<typeof RowV2Type>>;
    assert.equal(keyed.size, 600);
    assert.deepEqual(keyed.get('Plan 7'), { title: 'Plan 7', owner: 'unassigned' });
    assert.deepEqual((await history()).slice(0, 2), ['$reindex', '$migrate:by_title']);
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner', 'by_title']);
  });

  it('keeps a record at the end of the chain, with a $deploy commit only when the package changed', async () => {
    // Two packages over the same record, differing in an input. Each is built
    // and exported from the same lines: an export's IR carries the source
    // locations it was built from, so the record's declarations are the same
    // objects in both.
    const [first, second] = ['2.0.0', '2.1.0'].map((version) => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      return e3.package('planning', version, plans, addOwner(plans), ...v2Declarations(plans),
        e3.input('note', StringType, variant('value', version)));
    });
    const plans: RecordPlan[] = [];
    let before: string[] = [];
    for (const pkg of [first!, second!]) {
      await deploy(pkg, { onRecordPlan: (plan) => plans.push(plan) });
      if (pkg === first) {
        before = await history();
        // The same package again, as imported.
        await workspaceDeploy(storage, repo, ws, 'planning', '2.0.0', { runner, onRecordPlan: (plan) => plans.push(plan) });
        assert.deepEqual(await history(), before, 'the same package again appends nothing');
      }
    }
    assert.deepEqual(plans, [
      { record: 'records/plans', action: variant('mint', null) },
      { record: 'records/plans', action: variant('keep', { deploy: false }) },
      { record: 'records/plans', action: variant('keep', { deploy: true }) },
    ]);
    assert.deepEqual(await history(), ['$deploy', ...before], 'another package over the record: its history says so');
  });

  it('refuses a type change with no migration, naming what changed and the fixes, and writes nothing', async () => {
    await seeded(10n);
    const before = await ref();
    const unmigrated = (() => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      return e3.package('planning', '2.0.1', plans);
    })();
    await assert.rejects(deploy(unmigrated), (err: unknown) => {
      assert.ok(err instanceof RecordDeployRefusedError);
      assert.match(err.message, /record 'records\/plans' changed type with no migration/);
      assert.match(err.message, /missing field "owner"/);
      assert.match(err.message, /Declare a migration for it/);
      assert.match(err.message, /--schema=reset/);
      return true;
    });
    assert.equal((await workspaceGetPackage(storage, repo, ws)).version, '1.0.0');
    assert.deepEqual(await ref(), before);
  });

  it('refuses a chain the workspace is not on, and one that does not start where it is', async () => {
    await deploy(v2());
    const renamed = (() => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      return e3.package('planning', '2.0.2', plans, e3.migration.rows('owned', plans,
        East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: '' }))));
    })();
    await assert.rejects(deploy(renamed),
      /record 'records\/plans' has had migrations 'add_owner' applied, and the package declares 'owned': an applied migration was renamed, reordered or removed, or the package is older than the workspace/);

    // A workspace at v1 applied none, and a chain that starts elsewhere
    // cannot carry it.
    const other = 'other';
    await workspaceCreate(storage, repo, other);
    await deploy(v1(), {}, other);
    const elsewhere = (() => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      return e3.package('planning', '2.0.3', plans, e3.migration.value('from_owners', plans,
        East.function([DictType(StringType, StringType)], PlansV2Type, ($, _old) => new Map())));
    })();
    await assert.rejects(deploy(elsewhere, {}, other),
      /record 'records\/plans' holds its state as .*, and its next migration, 'from_owners', takes it as /);
  });

  it('runs no migration under --schema=fail, and resets what it cannot keep under --schema=reset', async () => {
    await seeded(10n);
    await assert.rejects(deploy(v2(), { schema: 'fail' }),
      /record 'records\/plans' has migrations 'add_owner' to run, and this deploy runs none\. Deploy with --schema=migrate to run them\./);

    // A keyed write, then a type change with no migration, reset.
    const outcome = await recordMutate(storage, runner, repo, ws, 'plans', 'seed', [encodeInt(3n)], { actor: 'cli:test', idempotencyKey: 'k1' });
    assert.equal(outcome.kind, 'committed');
    const unmigrated = (() => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      return e3.package('planning', '2.0.1', plans);
    })();
    const plans: RecordPlan[] = [];
    await deploy(unmigrated, { schema: 'reset', onRecordPlan: (plan) => plans.push(plan) });
    assert.equal(plans[0]!.action.type, 'reset');
    assert.deepEqual(await history(), ['$reset'], 'a root commit: the reset is in the history, which starts over');
    const held = await ref();
    assert.equal(held.versions.get('$idem'), undefined, 'the keyed write went with the state');
    assert.equal(held.versions.get('$idem.commit'), undefined);
    assert.equal((await workspaceGetDataset(storage, repo, ws, plansPath) as Map<string, unknown>).size, 0);
  });

  it('refuses a record the package drops, and drops it when allowed', async () => {
    await seeded(10n);
    const without = e3.package('planning', '9.0.0', e3.input('note', StringType, variant('value', 'no records')));
    await assert.rejects(deploy(without),
      /record 'records\/plans' is not declared by the package, so deploying drops its state and history\. Deploy with --allow-drop-records to drop it\./);
    assert.equal((await workspaceGetPackage(storage, repo, ws)).version, '1.0.0');

    const plans: RecordPlan[] = [];
    await deploy(without, { allowDropRecords: true, onRecordPlan: (plan) => plans.push(plan) });
    assert.deepEqual(plans, [{ record: 'records/plans', action: variant('drop', null) }]);
    assert.equal(await storage.datasets.read(repo, ws, 'records/plans'), null);
  });

  it('plans without writing: what each record and index would do, refusals included', async () => {
    await seeded(10n);
    const before = { ref: await ref(), version: (await workspaceGetPackage(storage, repo, ws)).version };
    const records: RecordPlan[] = [];
    const indexes: RecordIndexPlan[] = [];
    await deploy(v2(), { plan: true, onRecordPlan: (plan) => records.push(plan), onRecordIndex: (plan) => indexes.push(plan) });
    assert.deepEqual(records, [{ record: 'records/plans', action: variant('migrate', { steps: ['add_owner'] }) }]);
    assert.deepEqual(indexes, [{ record: 'records/plans', index: 'by_owner', action: variant('build', null) }]);
    assert.deepEqual({ ref: await ref(), version: (await workspaceGetPackage(storage, repo, ws)).version }, before);

    const refused: RecordPlan[] = [];
    await deploy(v2(), { plan: true, schema: 'fail', onRecordPlan: (plan) => refused.push(plan) });
    assert.equal(refused[0]!.action.type, 'refused', 'a plan reports a refusal rather than throwing');
  });

  it('leaves the workspace as it was when a step fails, and is served the steps that finished when run again', async () => {
    await seeded(600n);
    const before = await ref();
    // A second step that fails on one row, and then the same step fixed. Each
    // package is built and exported from the same lines, as a package run
    // again is: an export's IR carries the source locations it was built
    // from, so the first step's program is the same program both times.
    const checks = [
      East.function([StringType, RowV2Type], RowV2Type, ($, id, row) => {
        $.if(East.equal(id, 'p-7'), ($) => $.error('p-7 cannot be carried'));
        return row;
      }),
      East.function([StringType, RowV2Type], RowV2Type, ($, _id, row) => row),
    ];
    let executions = 0;
    for (const [i, check] of checks.entries()) {
      const plans = e3.record('plans', PlansV2Type, new Map());
      const pkg = e3.package('planning', `2.0.${i}`, plans, e3.migration.rows('check', plans, check, { after: addOwner(plans) }));
      const failure = await deploy(pkg).then(() => undefined, (err: unknown) => err);
      if (i === 0) {
        assert.match(String(failure), /migrating record 'records\/plans' failed at 'check'.*p-7 cannot be carried/s);
        assert.deepEqual(await ref(), before, 'nothing was written');
        assert.equal((await workspaceGetPackage(storage, repo, ws)).version, '1.0.0');
        executions = await countExecutions();
      } else {
        assert.equal(failure, undefined);
      }
    }
    assert.deepEqual((await history()).slice(0, 2), ['$migrate:check', '$migrate:add_owner']);
    assert.equal(await countExecutions(), executions + 1, 'the first step was served from the execution cache');
  });

  it('writes by rows and by key, a piece at a time, what a whole-value step writes', async () => {
    // Pieces small enough to cut 8,000 rows into several.
    const whole = (() => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      const own = e3.migration.value('add_owner', plans,
        East.function([PlansV1Type], PlansV2Type, ($, old) => old.map(($, row) => ({ title: row.title, owner: 'unassigned' }))));
      const byTitle = e3.migration.value('by_title', plans, East.function([PlansV2Type], PlansV2Type, ($, old) => {
        const out = $.let(new Map(), PlansV2Type);
        $.for(old, ($, row) => {
          $(out.insert(row.title, row));
        });
        return out;
      }), { after: own });
      return e3.package('whole', '3.0.0', plans, byTitle);
    })();
    for (const workspace of ['pieces', 'whole']) await workspaceCreate(storage, repo, workspace);
    await seeded(8_000n, 'pieces');
    await seeded(8_000n, 'whole');

    const executions = await countExecutions();
    await withEnv({ E3_TEST_PIECE_BYTES: String(4 * 1024) }, () => deploy(v3(), {}, 'pieces'));
    assert.ok(await countExecutions() >= executions + 4, 'the steps ran as pieces');
    await deploy(whole, {}, 'whole');

    const states = async (workspace: string): Promise<string[]> =>
      (await recordHistory(storage, repo, workspace, 'plans'))
        .filter((entry) => entry.commit.mutation.startsWith('$migrate:'))
        .map((entry) => entry.commit.state);
    assert.deepEqual(await states('pieces'), await states('whole'), 'each step writes the same manifest either way');
  });

  it('refuses a rekey that lands two rows on one key, naming it, and keeps one of two elements of a Set', async () => {
    await seeded(10n);
    const collide = (() => {
      const plans = e3.record('plans', PlansV2Type, new Map());
      const own = addOwner(plans);
      return e3.package('planning', '2.0.4', plans, e3.migration.rekey('one_key', plans,
        East.function([StringType, RowV2Type], StructType({ key: StringType, value: RowV2Type }),
          ($, _id, row) => ({ key: 'everything', value: row })), { after: own }));
    })();
    await assert.rejects(deploy(collide), /failed at 'one_key'.*duplicate.*"everything"/s);

    const Flags = SetType(StringType);
    const flags = 'flags';
    await workspaceCreate(storage, repo, flags);
    await deploy(e3.package('flags', '1.0.0', e3.record('flags', Flags, new Set(['Ann', 'ann', 'Bo']))), {}, flags);
    const lowered = (() => {
      const record = e3.record('flags', Flags, new Set());
      return e3.package('flags', '2.0.0', record,
        e3.migration.rekey('lower', record, East.function([StringType], StringType, ($, flag) => flag.lowerCase())));
    })();
    await deploy(lowered, {}, flags);
    const held = await workspaceGetDataset(storage, repo, flags, [variant('field', 'records'), variant('field', 'flags')]) as Set<string>;
    assert.deepEqual([...held], ['ann', 'bo']);
  });

  it('keeps $schema through a mutation, a compaction and a reindex, and answers a keyed retry after a compaction or a migration', async () => {
    await deploy(v2());
    const retry = (): Promise<unknown> => recordMutate(storage,
      { execute: () => { throw new Error('the retry ran the mutation again'); } } as unknown as TaskRunner,
      repo, ws, 'plans', 'add', [encodeStr('q')], { actor: 'cli:test', idempotencyKey: 'k1' });

    const first = await recordMutate(storage, runner, repo, ws, 'plans', 'add', [encodeStr('q')], { actor: 'cli:test', idempotencyKey: 'k1' });
    assert.equal(first.kind, 'committed', JSON.stringify(first));
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner']);

    const compacted = await recordCompact(storage, repo, ws, 'plans', { actor: 'cli:test' });
    assert.equal(compacted.kind, 'committed');
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner']);
    assert.deepEqual(await retry(), compacted, 'the compaction, whose state holds the keyed write, answers the key');

    const reindexed = await recordReindex(storage, runner, repo, ws, 'plans', { actor: 'cli:test' });
    assert.equal(reindexed.kind, 'committed', JSON.stringify(reindexed));
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner']);

    await deploy(v3());
    const [head] = await recordHistory(storage, repo, ws, 'plans');
    assert.equal(head!.commit.mutation, '$reindex');
    const [, migrated] = await recordHistory(storage, repo, ws, 'plans');
    assert.equal(migrated!.commit.mutation, '$migrate:by_title');
    assert.deepEqual(appliedMigrations((await ref()).versions), ['add_owner', 'by_title']);
    assert.deepEqual(await retry(), { kind: 'committed', commitHash: migrated!.hash, stateHash: migrated!.commit.state },
      'the migration, whose state holds the keyed write at the new type, answers the key');
  });

  it('keeps a migrated record\'s history through gc, each state read under the type it was written with', async () => {
    await seeded(10n);
    await deploy(v2());
    await repoGc(storage, repo, { minAge: 0 });
    assert.equal((await repoGc(storage, repo, { minAge: 0 })).deletedObjects, 0, 'a second sweep takes nothing');

    const byName = new Map((await recordHistory(storage, repo, ws, 'plans')).map((entry) => [entry.commit.mutation, entry.commit.state]));
    const old = decodeBeast2For(PlansV1Type)(await readDatasetWhole(storage, repo, byName.get('seed')!));
    assert.deepEqual(old.get('p-3'), { title: 'Plan 3' });
    const migrated = decodeBeast2For(PlansV2Type)(await readDatasetWhole(storage, repo, byName.get('$migrate:add_owner')!));
    assert.deepEqual(migrated.get('p-3'), { title: 'Plan 3', owner: 'unassigned' });
  });
});
