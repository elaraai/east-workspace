/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries kept function calls into the form in which a call's
 * input names the index it read: it reads the form `function-call-drafts`
 * writes, and writes this release's. The contract suite
 * (`contract/repository-record.ts`) runs it over every backend, after the step
 * before it; this holds its written form to the type this release reads, and
 * what it carries to the call as it was.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SortedMap, encodeBeast2For, equalFor, isTypeValueEqual, none, printFor, some, toEastTypeValue, variant, type ValueTypeOf } from '@elaraai/east';
import { FunctionCallJobType, decodeFunctionCallJob, encodeFunctionCallJob, type FunctionCallJob } from '@elaraai/e3-types';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { FunctionCallJobWithDraftsType } from './function-call-drafts.js';
import { FunctionCallJobWithIndexInputsType, functionCallIndexInputs } from './function-call-index-inputs.js';

/** A kept call in the form the step reads. */
type Earlier = ValueTypeOf<typeof FunctionCallJobWithDraftsType>;

const jobsPath = [variant('field', 'records'), variant('field', 'jobs')];
const pricesPath = [variant('field', 'inputs'), variant('field', 'prices')];

/** A call as the release before the step kept it: of `jobs_on`, which read a
 *  record and an input, and laid a draft over the record, which ended it as
 *  `draftEnd` says: none unless given. */
function earlierCall(id: string, state: Earlier['call']['state'], draftEnd: Earlier['call']['draftEnd'] = none): Earlier {
  return {
    call: {
      id,
      function: some('jobs_on'),
      caller: some('ada@example.com'),
      startedAt: new Date('2026-11-14T08:00:00.000Z'),
      endedAt: state.type === 'running' ? none : some(new Date('2026-11-14T08:00:02.000Z')),
      state,
      package: some({ name: 'planning', version: '1.0.0' }),
      args: [variant('value', 'a'.repeat(64)), variant('dataset', { path: pricesPath, hash: 'b'.repeat(64) })],
      inputs: [{ path: jobsPath, hash: 'c'.repeat(64) }, { path: pricesPath, hash: 'b'.repeat(64) }],
      drafts: [{ record: 'jobs', mutation: 'patch', args: some('d'.repeat(64)) }],
      draftEnd,
      limits: { timeoutMs: 60_000n, maxResultBytes: 1024n, maxLogBytes: 1024n },
      expiresAt: new Date('2026-11-21T08:00:02.000Z'),
      stdout: 'laid\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    },
    workspace: 'dev',
    functionObject: 'f'.repeat(64),
    runner: variant('east_c', { platforms: [], decode: variant('lazy', null) }),
    verbose: false,
    deadline: new Date('2026-11-14T08:01:00.000Z'),
    cancel: none,
    keep: { succeeded: 3_600_000n, failed: 604_800_000n },
    drafted: [{ record: 'jobs', path: jobsPath, base: '1'.repeat(64), commit: 'e'.repeat(64), mutations: new SortedMap([['patch', '2'.repeat(64)]]) }],
  };
}

/** A call the step reads, as it carries it: each of its inputs a dataset
 *  itself, naming no index, and everything else as it was. */
function carriedOf(earlier: Earlier): FunctionCallJob {
  return { ...earlier, call: { ...earlier.call, inputs: earlier.call.inputs.map(({ path, hash }) => ({ path, index: none, hash })) } };
}

describe('function-call-index-inputs', () => {
  it('writes this release\'s form', () => {
    assert.ok(isTypeValueEqual(toEastTypeValue(FunctionCallJobWithIndexInputsType), toEastTypeValue(FunctionCallJobType)),
      'the kept call\'s type changed: its form is the next upgrade\'s to carry, from this one\'s frozen form');
  });

  it('carries the calls the release before it kept into this release\'s form, each input naming no index, and leaves a call of this form as it is', async () => {
    const storage = new InMemoryStorage();
    const encodeEarlier = encodeBeast2For(FunctionCallJobWithDraftsType);
    const kept = [
      earlierCall('019a7f2e-4b6c-7d1a-9c3e-5f6a7b8c9d0e', variant('succeeded', { value: '3'.repeat(64) })),
      earlierCall('019a7f2e-5c7d-7e2b-8d4f-6a7b8c9d0e1f', variant('running', null)),
      earlierCall('019a7f2e-6d8e-7f3c-9e5a-7b8c9d0e1f2a', variant('conflict', { record: 'jobs', mutation: 'patch', place: 1n, of: 1n, message: 'the row changed' })),
      // One its draft ended, which it carries as it was (#1680's review)
      earlierCall('019a7f2e-8fa0-7b5e-9a7c-9d0e1f2a3b4c', variant('failed', { exitCode: 1n }),
        some(variant('draft', { record: 'jobs', mutation: 'patch', place: 1n, of: 1n, how: variant('failed', null) }))),
    ];
    const stored = async (id: string) => {
      const found = (await storage.calls.readStored('repo')).find((call) => call.id === id);
      assert.ok(found !== undefined && found.workspace === 'dev', 'the store holds the call');
      return found;
    };
    for (const earlier of kept) {
      const bytes = encodeEarlier(earlier);
      await storage.calls.create('repo', carriedOf(earlier));
      await (await stored(earlier.call.id)).replace(bytes);
      assert.throws(() => decodeFunctionCallJob(bytes), 'this release reads no call in the earlier form');
    }
    // A call this release filed, which read an index of a record beside it
    const filed: FunctionCallJob = {
      ...carriedOf(earlierCall('019a7f2e-7e9f-7a4d-8f6b-8c9d0e1f2a3b', variant('running', null))),
    };
    const current: FunctionCallJob = {
      ...filed,
      call: { ...filed.call, inputs: [{ path: jobsPath, index: some('jobs_by_press'), hash: 'c'.repeat(64) }, { path: jobsPath, index: none, hash: 'c'.repeat(64) }] },
    };
    await storage.calls.create('repo', current);
    const currentBytes = encodeFunctionCallJob(current);
    await (await stored(current.call.id)).replace(currentBytes);

    assert.equal(await functionCallIndexInputs.apply(storage, 'repo', null, Date.now() + 60_000), null, 'a part with time to spare does the step whole');
    const same = equalFor(FunctionCallJobType);
    const print = printFor(FunctionCallJobType);
    for (const earlier of kept) {
      const rewritten = await (await stored(earlier.call.id)).read();
      assert.ok(rewritten !== null, 'the store holds the call still');
      const read = decodeFunctionCallJob(rewritten);
      assert.ok(same(read, carriedOf(earlier)), `the ${earlier.call.state.type} call is stored in this release's form, as it was: ${print(read)}`);
    }
    assert.deepEqual(await (await stored(current.call.id)).read(), currentBytes, 'a call in this release\'s form is left as it is');
  });
});
