/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The function call store's contract: what any backend's kept calls do
 * (east-workspace#1554). A call is filed as it starts, ended once, asked to
 * stop while it runs, listed the latest first, kept for its lifetime and no
 * longer, rooted for gc while it is kept, and removed with its workspace. Each
 * is read and written as the bytes the store holds, for a repository upgrade
 * step (east-workspace#1619).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SortedMap, equalFor, none, some, variant } from '@elaraai/east';
import { FunctionCallJobType, decodeFunctionCallJob, encodeFunctionCallJob, type FunctionCallJob, type FunctionCallState } from '@elaraai/e3-types';
import { collectAllRoots } from '../gc.js';
import type { FunctionCallEnd, FunctionCallListOptions, StorageBackend } from '../storage/interfaces.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate } from '../workspaces.js';
import { MALFORMED_IDS, MALFORMED_NAMES, idRefusal, nameRefusal } from './malformed.js';
import type { BackendSetup } from './setup.js';

const WS = 'calls-ws';
const HOUR_MS = 60 * 60 * 1000;
const jobEqual = equalFor(FunctionCallJobType);

/** What {@link filed} files. */
interface Filed {
  id?: string;
  /** The function's name (default `quote`); `null` for a one-shot started as a call, which names none and no package */
  function?: string | null;
  functionObject?: string;
  expiresAt?: Date;
  args?: FunctionCallJob['call']['args'];
  inputs?: FunctionCallJob['call']['inputs'];
  drafts?: FunctionCallJob['call']['drafts'];
  drafted?: FunctionCallJob['drafted'];
}

/** A call as it starts, in a workspace: running, and kept for an hour unless told otherwise. */
function filed(workspace: string, options: Filed = {}): FunctionCallJob {
  const now = Date.now();
  const fn = options.function === undefined ? 'quote' : options.function;
  return {
    call: {
      id: options.id ?? uuidv7(),
      function: fn === null ? none : some(fn),
      caller: some('ada@example.com'),
      startedAt: new Date(now),
      endedAt: none,
      state: variant('running', null),
      package: fn === null ? none : some({ name: 'calls-pkg', version: '1.0.0' }),
      args: options.args ?? [],
      inputs: options.inputs ?? [],
      drafts: options.drafts ?? [],
      limits: { timeoutMs: 60_000n, maxResultBytes: 1024n, maxLogBytes: 1024n },
      expiresAt: options.expiresAt ?? new Date(now + HOUR_MS),
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    },
    workspace,
    functionObject: options.functionObject ?? 'f'.repeat(64),
    runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    verbose: false,
    deadline: new Date(now + 60_000),
    cancel: none,
    keep: { succeeded: BigInt(HOUR_MS), failed: BigInt(7 * 24 * HOUR_MS) },
    drafted: options.drafted ?? [],
  };
}

/** A record's place in a workspace, as a call's input names it. */
function recordPath(name: string): FunctionCallJob['call']['inputs'][number]['path'] {
  return [variant('field', 'records'), variant('field', name)];
}

/**
 * Every call a list finds, by id, page by page, each from the last one's next
 * until a page names none: a store may stop a page short of its limit, and
 * name a next. Each page holds at most its limit.
 */
async function listAll(storage: StorageBackend, repo: string, workspace: string, options: Omit<FunctionCallListOptions, 'before'>): Promise<string[]> {
  const found: string[] = [];
  let before: string | undefined;
  for (let pages = 1; ; pages++) {
    const page = await storage.calls.list(repo, workspace, { ...options, ...(before !== undefined && { before }) });
    assert.ok(page.calls.length <= options.limit, `a page holds at most ${options.limit} calls`);
    found.push(...page.calls.map((job) => job.call.id));
    if (page.next === undefined) return found;
    assert.ok(pages < 100, 'a list of a few calls ends');
    before = page.next;
  }
}

/** How a call ended, kept for `keepMs` from now. */
function ending(state: FunctionCallState, keepMs: number = HOUR_MS): FunctionCallEnd {
  const now = Date.now();
  return {
    state,
    endedAt: new Date(now),
    expiresAt: new Date(now + keepMs),
    stdout: 'out\n',
    stderr: 'err\n',
    stdoutTruncated: false,
    stderrTruncated: true,
  };
}

/**
 * Registers the function call store's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function functionCallStoreTests(setup: BackendSetup): void {
  describe('the function call store', () => {
    it('files a call and reads it back as filed, and refuses a second call of its id', async (t) => {
      const { storage, repo } = await setup(t);
      const job = filed(WS);
      await storage.calls.create(repo, job);
      const read = await storage.calls.get(repo, WS, job.call.id);
      assert.ok(read !== null && jobEqual(read, job), 'read back as filed');
      await assert.rejects(storage.calls.create(repo, job), /keeps a call/);
    });

    it('reads no call it does not keep, nor one of another workspace', async (t) => {
      const { storage, repo } = await setup(t);
      const job = filed(WS);
      await storage.calls.create(repo, job);
      assert.equal(await storage.calls.get(repo, WS, uuidv7()), null);
      assert.equal(await storage.calls.get(repo, 'other-ws', job.call.id), null);
    });

    it('records how a call ended once, the first end standing, and ends no call it does not keep', async (t) => {
      const { storage, repo } = await setup(t);
      const job = filed(WS);
      await storage.calls.create(repo, job);

      const succeeded = ending(variant('succeeded', { value: 'a'.repeat(64) }));
      const ended = await storage.calls.end(repo, WS, job.call.id, succeeded);
      assert.equal(ended?.call.state.type, 'succeeded');
      assert.equal(ended?.call.endedAt.type, 'some');
      assert.equal(ended?.call.expiresAt.getTime(), succeeded.expiresAt.getTime());
      assert.equal(ended?.call.stdout, 'out\n');
      assert.equal(ended?.call.stderrTruncated, true);

      const again = await storage.calls.end(repo, WS, job.call.id, ending(variant('failed', { exitCode: 1n })));
      assert.equal(again?.call.state.type, 'succeeded', 'the first end stands');
      const read = await storage.calls.get(repo, WS, job.call.id);
      assert.ok(read !== null && ended !== null && jobEqual(read, ended), 'and is what a read finds');

      assert.equal(await storage.calls.end(repo, WS, uuidv7(), succeeded), null);
    });

    it('records a request to cancel a running call once, and none of a call that has ended', async (t) => {
      const { storage, repo } = await setup(t);
      const running = filed(WS);
      await storage.calls.create(repo, running);
      const at = new Date();
      const asked = await storage.calls.requestCancel(repo, WS, running.call.id, { by: some('grace@example.com'), at });
      assert.ok(asked?.cancel.type === 'some');
      assert.equal(asked.cancel.value.by.type === 'some' && asked.cancel.value.by.value, 'grace@example.com');
      assert.equal(asked.call.state.type, 'running', 'the call runs on until its run stops it');
      const second = await storage.calls.requestCancel(repo, WS, running.call.id, { by: none, at: new Date() });
      assert.ok(second?.cancel.type === 'some' && second.cancel.value.by.type === 'some', 'the first request stands');

      const done = filed(WS);
      await storage.calls.create(repo, done);
      await storage.calls.end(repo, WS, done.call.id, ending(variant('succeeded', { value: 'a'.repeat(64) })));
      const late = await storage.calls.requestCancel(repo, WS, done.call.id, { by: none, at: new Date() });
      assert.equal(late?.cancel.type, 'none', 'an ended call is left as it is');
      assert.equal(await storage.calls.requestCancel(repo, WS, uuidv7(), { by: none, at: new Date() }), null);
    });

    it("lists a workspace's calls the latest first, a page at a time, a function's or a state's alone", async (t) => {
      const { storage, repo } = await setup(t);
      const jobs = [
        filed(WS, { function: 'quote' }), filed(WS, { function: 'price' }), filed(WS, { function: 'quote' }), filed(WS, { function: 'quote' }),
        filed(WS, { function: null }),
      ];
      for (const job of jobs) await storage.calls.create(repo, job);
      await storage.calls.create(repo, filed('other-ws'));
      await storage.calls.end(repo, WS, jobs[2]!.call.id, ending(variant('failed', { exitCode: 2n })));
      const latestFirst = jobs.map((job) => job.call.id).reverse();

      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10 }), latestFirst, 'the latest first, a one-shot among them, and none of another workspace');
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 2 }), latestFirst, 'page by page, each from the last one\'s next');
      const first = await storage.calls.list(repo, WS, { limit: 2 });
      assert.ok(first.next !== undefined, 'a page that leaves calls before it names its next');
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10, function: 'price' }), [jobs[1]!.call.id]);
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10, state: 'failed' }), [jobs[2]!.call.id]);
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10, function: 'quote', state: 'running' }), [jobs[3]!.call.id, jobs[0]!.call.id],
        'a one-shot, which names no function, is no function\'s call');
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10, state: 'running' }), [jobs[4]!.call.id, jobs[3]!.call.id, jobs[1]!.call.id, jobs[0]!.call.id]);
      const oneShot = await storage.calls.get(repo, WS, jobs[4]!.call.id);
      assert.ok(oneShot !== null && jobEqual(oneShot, jobs[4]!), 'a one-shot reads back as filed: no function, no package');
      assert.deepEqual(await listAll(storage, repo, 'empty-ws', { limit: 10 }), []);
      await assert.rejects(storage.calls.list(repo, WS, { limit: 0 }), RangeError);
    });

    it('forgets a call once its lifetime has ended, for every read', async (t) => {
      const { storage, repo } = await setup(t);
      const gone = filed(WS, { expiresAt: new Date(Date.now() - 1) });
      await storage.calls.create(repo, gone);
      assert.equal(await storage.calls.get(repo, WS, gone.call.id), null, 'filed past its expiry, it is gone');

      const kept = filed(WS);
      await storage.calls.create(repo, kept);
      await storage.calls.end(repo, WS, kept.call.id, ending(variant('succeeded', { value: 'a'.repeat(64) }), -1));
      assert.equal(await storage.calls.get(repo, WS, kept.call.id), null, 'ended with a lifetime past, it is gone');
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10 }), [], 'and no list finds either');
      assert.equal(await storage.calls.end(repo, WS, kept.call.id, ending(variant('failed', { exitCode: 1n }))), null, 'nor can it be ended again');
      await storage.calls.create(repo, gone);
      assert.ok((await storage.calls.get(repo, WS, gone.call.id)) === null, 'its id is free once it has expired');
    });

    it('roots what a kept call names for gc: its function object, its value arguments, the versions it read and its value, and nothing of an expired call', async (t) => {
      const { storage, repo } = await setup(t);
      await workspaceCreate(storage, repo, WS);
      const [fnObject, arg, dataset, input, value, oneShot, expired, expiredFn] = ['1', '2', '3', '4', '5', '6', '7', '8'].map((digit) => digit.repeat(64));
      const job = filed(WS, {
        functionObject: fnObject!,
        args: [variant('value', arg!), variant('dataset', { path: [variant('field', 'inputs'), variant('field', 'sales')], hash: dataset! })],
        inputs: [{ path: [variant('field', 'inputs'), variant('field', 'rate')], hash: input! }],
      });
      await storage.calls.create(repo, job);
      await storage.calls.end(repo, WS, job.call.id, ending(variant('succeeded', { value: value! })));
      // A one-shot's function object, its program's, which no package names: the call alone keeps it
      await storage.calls.create(repo, filed(WS, { function: null, functionObject: oneShot! }));
      await storage.calls.create(repo, filed(WS, { functionObject: expiredFn!, args: [variant('value', expired!)], expiresAt: new Date(Date.now() - 1) }));

      const roots = await collectAllRoots(storage.repos, repo);
      for (const hash of [fnObject, arg, dataset, input, value, oneShot]) assert.ok(roots.has(hash!), `the kept calls root ${hash!.slice(0, 1)}…`);
      assert.equal(roots.has(expired!), false, 'an expired call roots nothing');
      assert.equal(roots.has(expiredFn!), false, 'not even its function object');
    });

    it('files a call with the drafts it passed and what it lays them from, reads it back as filed, and ends it with a conflict', async (t) => {
      const { storage, repo } = await setup(t);
      const [state, args, base, patch, clear, commit] = ['1', '2', '3', '4', '5', '6'].map((digit) => digit.repeat(64));
      const job = filed(WS, {
        inputs: [{ path: recordPath('jobs'), hash: state! }],
        drafts: [
          { record: 'jobs', mutation: 'patch', args: some(args!), commit: commit! },
          { record: 'jobs', mutation: 'clear', args: none, commit: commit! },
        ],
        drafted: [{ record: 'jobs', path: recordPath('jobs'), base: base!, mutations: new SortedMap([['clear', clear!], ['patch', patch!]]) }],
      });
      await storage.calls.create(repo, job);
      const read = await storage.calls.get(repo, WS, job.call.id);
      assert.ok(read !== null && jobEqual(read, job), 'read back as filed');

      const conflict = variant('conflict', { record: 'jobs', mutation: 'patch', message: 'the row at "j1" changed under the edit' });
      const ended = await storage.calls.end(repo, WS, job.call.id, ending(conflict));
      assert.ok(ended?.call.state.type === 'conflict');
      assert.equal(ended.call.state.value.message, 'the row at "j1" changed under the edit');
      assert.ok(jobEqual(ended, { ...job, call: { ...ended.call, drafts: job.call.drafts } }), 'its drafts and what it lays them from as filed');
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10, state: 'conflict' }), [job.call.id], 'and a list finds it by how it ended');
    });

    it("roots what a kept call lays its drafts from: each draft's arguments, the state each drafted record stood at and its mutations", async (t) => {
      const { storage, repo } = await setup(t);
      await workspaceCreate(storage, repo, WS);
      const [args, base, patch, clear, commit, expired] = ['1', '2', '3', '4', '5', '6'].map((digit) => digit.repeat(64));
      const drafted = (state: string): Filed => ({
        drafts: [
          { record: 'jobs', mutation: 'patch', args: some(args!), commit: commit! },
          { record: 'jobs', mutation: 'clear', args: none, commit: commit! },
        ],
        drafted: [{ record: 'jobs', path: recordPath('jobs'), base: state, mutations: new SortedMap([['clear', clear!], ['patch', patch!]]) }],
      });
      await storage.calls.create(repo, filed(WS, drafted(base!)));
      await storage.calls.create(repo, filed(WS, { ...drafted(expired!), expiresAt: new Date(Date.now() - 1) }));

      const roots = await collectAllRoots(storage.repos, repo);
      for (const hash of [args, base, patch, clear]) assert.ok(roots.has(hash!), `the kept call roots ${hash!.slice(0, 1)}…`);
      assert.equal(roots.has(commit!), false, 'the commit a record stood at is named, and not kept: the record keeps its own history');
      assert.equal(roots.has(expired!), false, 'an expired call roots nothing');
    });

    it('reads every call it holds as the bytes stored, an expired one among them, and writes one over whatever its state', async (t) => {
      const { storage, repo } = await setup(t);
      const running = filed(WS);
      const ended = filed(WS);
      const expired = filed('other-ws', { expiresAt: new Date(Date.now() - 1) });
      for (const job of [running, ended, expired]) await storage.calls.create(repo, job);
      await storage.calls.end(repo, WS, ended.call.id, ending(variant('failed', { exitCode: 1n })));

      const stored = await storage.calls.readStored(repo);
      assert.deepEqual(
        stored.map((call) => `${call.workspace}/${call.id}`).sort(),
        [`${WS}/${running.call.id}`, `${WS}/${ended.call.id}`, `other-ws/${expired.call.id}`].sort(),
        'each by its workspace and its id, the expired one too',
      );
      for (const call of stored) {
        const bytes = await call.read();
        assert.ok(bytes !== null);
        assert.equal(decodeFunctionCallJob(bytes).call.id, call.id, 'the bytes are the call');
      }

      // Written over as it stands: an ended call is no more closed to it than a running one
      const of = (id: string) => stored.find((call) => call.id === id)!;
      for (const job of [running, ended]) {
        const bytes = await of(job.call.id).read();
        const held = decodeFunctionCallJob(bytes!);
        await of(job.call.id).replace(encodeFunctionCallJob({ ...held, verbose: true }));
        const read = await storage.calls.get(repo, WS, job.call.id);
        assert.ok(read !== null && jobEqual(read, { ...held, verbose: true }), 'a read finds what was written');
      }
    });

    it("removes a workspace's calls with it, so a workspace made again under its name has none", async (t) => {
      const { storage, repo } = await setup(t);
      await workspaceCreate(storage, repo, WS);
      const job = filed(WS);
      await storage.calls.create(repo, job);
      await storage.calls.create(repo, filed('kept-ws'));
      await storage.refs.workspaceRemove(repo, WS);
      await workspaceCreate(storage, repo, WS);
      assert.equal(await storage.calls.get(repo, WS, job.call.id), null);
      assert.deepEqual(await listAll(storage, repo, WS, { limit: 10 }), []);
      assert.equal((await listAll(storage, repo, 'kept-ws', { limit: 10 })).length, 1, 'another workspace keeps its own');
    });

    it("refuses a workspace's name or a call's id that is not of its form, before it reads or writes anything", async (t) => {
      const { storage, repo } = await setup(t);
      for (const name of MALFORMED_NAMES.workspace) {
        const refused = nameRefusal('workspace', name);
        await assert.rejects(storage.calls.create(repo, filed(name)), refused);
        await assert.rejects(storage.calls.get(repo, name, uuidv7()), refused);
        await assert.rejects(storage.calls.end(repo, name, uuidv7(), ending(variant('failed', { exitCode: 1n }))), refused);
        await assert.rejects(storage.calls.requestCancel(repo, name, uuidv7(), { by: none, at: new Date() }), refused);
        await assert.rejects(storage.calls.list(repo, name, { limit: 1 }), refused);
      }
      for (const id of MALFORMED_IDS) {
        const refused = idRefusal('call id', id);
        await assert.rejects(storage.calls.create(repo, filed(WS, { id })), refused);
        await assert.rejects(storage.calls.get(repo, WS, id), refused);
        await assert.rejects(storage.calls.end(repo, WS, id, ending(variant('failed', { exitCode: 1n }))), refused);
        await assert.rejects(storage.calls.requestCancel(repo, WS, id, { by: none, at: new Date() }), refused);
        await assert.rejects(storage.calls.list(repo, WS, { limit: 1, before: id }), refused);
      }
    });
  });
}
