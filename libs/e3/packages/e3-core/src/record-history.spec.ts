/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record's history with each commit's arguments previewed (#1130): each
 * argument's own type, its size, and its value as East text cut at
 * {@link RECORD_ARG_TEXT_CHARS} characters; an argument over
 * {@link RECORD_ARG_TEXT_BYTES} with its type and size alone; and an arguments'
 * object over {@link RECORD_ARGS_READ_BYTES} not read at all, so a page of
 * history reads at most that much of a commit's arguments however large a
 * patch is.
 *
 * And a composite record's description: what each of its sources is, and what
 * its ref keeps of each one's last delivery.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  ArrayType, BlobType, DictType, East, EastTypeType, IntegerType, StringType, StructType, encodeBeast2For, equalFor, none, some,
  toEastTypeValue, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  RECORD_ARGS_READ_BYTES, RECORD_ARG_TEXT_BYTES, RECORD_ARG_TEXT_CHARS, RecordLoadArgsType, RecordSignatureType, type RecordCommitArgs,
} from '@elaraai/e3-types';
import { recordCommitArgs, recordCompact, recordDescribe, recordHistory, recordMutate } from './records.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import {
  ErpDeliveryType, at, createTestRepo, removeTestRepo, createTempDir, removeTempDir, ordersOverSources, sourceDelivered,
} from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend } from './index.js';

const encodeArgs = encodeBeast2For(ArrayType(BlobType));
const encodeInt = encodeBeast2For(IntegerType);
const encodeStr = encodeBeast2For(StringType);
const encodeBlob = encodeBeast2For(BlobType);
const sameType = equalFor(EastTypeType);

/** `n` bytes deflate leaves at their size. */
function incompressible(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  let seed = 0x2545f491;
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    bytes[i] = seed >>> 24;
  }
  return bytes;
}

describe("a record commit's arguments, previewed", () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** An arguments' object holding `args`, stored, and its preview. */
  async function preview(args: Uint8Array[], from: StorageBackend = storage): Promise<{ bytes: Uint8Array; hash: string; got: RecordCommitArgs }> {
    const bytes = encodeArgs(args);
    const hash = await storage.objects.write(repo, bytes);
    return { bytes, hash, got: await recordCommitArgs(from, repo, hash) };
  }

  it('gives each argument its own type and size, and its value as East text', async () => {
    const count = encodeInt(42n);
    const title = encodeStr('Q3 plan');
    const { bytes, hash, got } = await preview([count, title]);
    assert.equal(got.hash, hash);
    assert.equal(got.bytes, BigInt(bytes.length));
    assert.deepEqual(got.values.map(({ text, truncated }) => [text, truncated]), [['42', false], ['"Q3 plan"', false]]);
    assert.deepEqual(got.values.map(({ bytes: size }) => size), [BigInt(count.length), BigInt(title.length)]);
    assert.ok(sameType(got.values[0]!.type, toEastTypeValue(IntegerType)));
    assert.ok(sameType(got.values[1]!.type, toEastTypeValue(StringType)));
  });

  it(`cuts the text at ${RECORD_ARG_TEXT_CHARS} characters, and never inside one`, async () => {
    // The text's first characters are a quote, letters and an emoji, which is
    // two UTF-16 code units: the cut falls just after it
    const letters = 'a'.repeat(RECORD_ARG_TEXT_CHARS - 2);
    const [cut] = (await preview([encodeStr(`${letters}😀${'b'.repeat(10)}`)])).got.values;
    assert.equal(cut!.truncated, true);
    assert.equal([...cut!.text].length, RECORD_ARG_TEXT_CHARS);
    assert.equal(cut!.text, `"${letters}😀`, 'the emoji is kept whole');

    // A text of exactly that many characters is whole
    const [whole] = (await preview([encodeStr(letters)])).got.values;
    assert.deepEqual([whole!.text, whole!.truncated], [`"${letters}"`, false]);
  });

  it(`gives an argument over ${RECORD_ARG_TEXT_BYTES} bytes its type and size, and no text`, async () => {
    const large = encodeBlob(incompressible(RECORD_ARG_TEXT_BYTES + 1024));
    assert.ok(large.length > RECORD_ARG_TEXT_BYTES);
    const [small, big] = (await preview([encodeInt(1n), large])).got.values;
    assert.equal(small!.text, '1');
    assert.deepEqual([big!.bytes, big!.text, big!.truncated], [BigInt(large.length), '', true]);
    assert.ok(sameType(big!.type, toEastTypeValue(BlobType)));
  });

  it(`reads no arguments' object over ${RECORD_ARGS_READ_BYTES} bytes, and says what it weighs`, async () => {
    // A store whose objects can be weighed and not read
    const objects = Object.create(storage.objects, {
      read: { value: () => { throw new Error('the arguments were read'); } },
    }) as StorageBackend['objects'];
    const unread = Object.create(storage, { objects: { value: objects } }) as StorageBackend;
    const { bytes, hash, got } = await preview([encodeBlob(incompressible(RECORD_ARGS_READ_BYTES))], unread);
    assert.ok(bytes.length > RECORD_ARGS_READ_BYTES);
    assert.deepEqual([got.hash, got.bytes, got.values.length], [hash, BigInt(bytes.length), 0]);
  });

  it('previews an argument that cannot be printed by its type and size', async () => {
    // A String whose payload is cut short: its header still names its type
    const whole = encodeStr('a title that no longer decodes');
    const broken = whole.subarray(0, whole.length - 3);
    const [got] = (await preview([broken])).got.values;
    assert.ok(sameType(got!.type, toEastTypeValue(StringType)));
    assert.deepEqual([got!.bytes, got!.text, got!.truncated], [BigInt(broken.length), '', true]);
  });

  it('R33 — previews a load commit\'s arguments as any commit\'s: a tuple of the one value that says what the load did, by its type, and names the object that holds it whole', async () => {
    const loaded = encodeBeast2For(RecordLoadArgsType)({
      delivery: 'd'.repeat(64), load: 'l'.repeat(64), asOf: some(at('2026-11-02T03:00:00.000')), first: true,
      execution: { inputsHash: 'i'.repeat(64), executionId: '019a3f52-7c1e-7b3a-9d0e-4f6a8b2c1d3e' }, set: 1_204n, deleted: 31n, unchanged: 98_112n,
    });
    const { hash, got } = await preview([loaded]);
    assert.equal(got.values.length, 1);
    assert.ok(sameType(got.values[0]!.type, toEastTypeValue(RecordLoadArgsType)), 'its type says it is a load\'s');
    assert.equal(got.values[0]!.bytes, BigInt(loaded.length));
    // Its text is cut as any argument's is: a reader that says the load in words decodes the object the preview names
    assert.deepEqual([[...got.values[0]!.text].length, got.values[0]!.truncated], [RECORD_ARG_TEXT_CHARS, true]);
    assert.match(got.values[0]!.text, /^\(delivery="d{64}", load="l{64}", asOf=\.some 2026-11-02T03:00:00\.000, first=true, /);
    assert.equal(got.hash, hash);
  });

  it('names arguments that are not East values, as a system commit may record them, and previews none', async () => {
    // A caller's own bytes beside an East value: no argument has a type to give
    const { bytes, hash, got } = await preview([encodeInt(1n), new TextEncoder().encode('backup-42')]);
    assert.deepEqual([got.hash, got.bytes, got.values.length], [hash, BigInt(bytes.length), 0]);

    // An object that is no arguments' tuple at all
    const other = encodeStr('not a tuple');
    const otherHash = await storage.objects.write(repo, other);
    const named = await recordCommitArgs(storage, repo, otherHash);
    assert.deepEqual([named.hash, named.bytes, named.values.length], [otherHash, BigInt(other.length), 0]);
  });
});

describe("a record's history, each commit's arguments previewed", () => {
  const PlansType = DictType(StringType, StructType({ title: StringType }));
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('previews the arguments of each commit that has any, when the walk is asked for them', async () => {
    const plans = e3.record('plans', PlansType, {
      initial: new Map(),
      mutations: (mutation) => ({
        seed: mutation.reduce(East.function([PlansType, IntegerType], PlansType, ($, _state, n) => {
          const out = $.let(new Map(), PlansType);
          $.for(East.Array.range(0n, n), ($, i) => {
            $(out.insert(East.str`p-${i}`, { title: East.str`Plan ${i}` }));
          });
          return out;
        })),
      }),
    });
    const pkg = e3.package('planning', '1.0.0', plans);
    const zip = join(tempDir, 'planning.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    const runner = new LocalTaskRunner(repo);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'planning', '1.0.0', { runner });
    const outcome = await recordMutate(storage, runner, repo, 'main', 'plans', 'seed', [encodeInt(3n)], { actor: 'cli:test' });
    assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));

    const [seeded, init] = await recordHistory(storage, repo, 'main', 'plans', { args: true });
    assert.equal(seeded!.commit.mutation, 'seed');
    assert.ok(seeded!.commit.args.type === 'some');
    assert.equal(seeded!.args?.hash, seeded!.commit.args.value, 'the preview names the commit\'s arguments');
    assert.deepEqual(seeded!.args?.values.map(({ text }) => text), ['3']);
    assert.equal(init!.commit.mutation, '$init');
    assert.equal(init!.args, undefined, 'a commit with no arguments has none to preview');

    const [plain] = await recordHistory(storage, repo, 'main', 'plans');
    assert.equal(plain!.args, undefined, 'a walk not asked for them previews none');
  });
});

describe('a composite record, described', () => {
  const sameSources = equalFor(RecordSignatureType.fields.sources);
  type Sources = ValueTypeOf<typeof RecordSignatureType.fields.sources>;
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('R33 — describes each source: whether its load alone writes it, what it is delivered, its last delivery with its commit and as-of, and whether the record waits for it', async () => {
    const plain = e3.record('notes', DictType(StringType, StringType), { initial: new Map() });
    const zip = join(tempDir, 'sales.zip');
    await e3.export(e3.package('sales', '1.0.0', ordersOverSources(), plain), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'sales', '1.0.0');
    const sources = async (record = 'orders'): Promise<Sources> => {
      const described = await recordDescribe(storage, repo, 'main', record);
      assert.ok(described !== null, `the workspace has a record ${record}`);
      return described.sources;
    };
    const erp = { name: 'erp', key: toEastTypeValue(StringType), external: true, delivery: some(toEastTypeValue(ErpDeliveryType)), feed: none };
    const own = { name: 'own', key: toEastTypeValue(IntegerType), external: false, delivery: none, feed: none, last: none, pending: false };

    // As deployed: erp has delivered nothing, and the record waits for it
    assert.ok(sameSources(await sources(), [{ ...erp, last: none, pending: true }, own]), 'each source, in the order of their names');

    // Once erp has delivered: the delivery, the commit that applied it, and when it was as of
    const applied = await sourceDelivered(storage, repo, 'main', 'records/orders', 'erp', '2026-11-02T03:00:00.000');
    const [delivered] = await sources();
    assert.equal(delivered!.pending, false);
    if (delivered!.last.type !== 'some') assert.fail('erp holds a delivery');
    assert.ok(sameSources([delivered!], [{
      ...erp, pending: false,
      last: some({ delivery: delivered!.last.value.delivery, commit: some(applied), asOf: some(at('2026-11-02T03:00:00.000')) }),
    }]));

    // A compaction cuts the commit from the chain: the source still holds its delivery, and names no commit
    assert.equal((await recordCompact(storage, repo, 'main', 'orders', { actor: 'cli:test' })).kind, 'committed');
    const [compacted] = await sources();
    assert.ok(sameSources([compacted!], [{ ...delivered!, last: some({ ...delivered!.last.value, commit: none }) }]));

    assert.deepEqual(await sources('notes'), [], 'a record with no sources has none to describe');
  });
});
