/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries kept function calls into the form in which a call
 * holds its drafts: it reads what the releases before it stored, and writes
 * this release's form. The contract suite (`contract/repository-record.ts`)
 * runs it over every backend; this holds its two forms to the bytes a release
 * stored and to the type this release reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBeast2For, equalFor, isTypeValueEqual, printFor, toEastTypeValue } from '@elaraai/east';
import { FunctionCallJobType, decodeFunctionCallJob } from '@elaraai/e3-types';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { FunctionCallJobBeforeDraftsType, FunctionCallJobWithDraftsType, functionCallDrafts } from './function-call-drafts.js';

/** A call of `quote` release 1.0.107 kept in workspace `dev`, which succeeded:
 *  of a value and a dataset, with an input it read. Its lifetime ended in
 *  2025. */
const SUCCEEDED_1_0_107 = Buffer.from(
  'iUVhc3QNCgUAxgUkJQEACAIEbm9uZQEEc29tZQAFCAIEbm9uZQEEc29tZQMJAQJieQICCQEIZXhpdENvZGUGCAIEbm9uZQEE' +
  'c29tZQYJBAdtZXNzYWdlAAhmaWxlbmFtZQIEbGluZQgGY29sdW1uCAoJCQELZGlhZ25vc3RpY3MKCQEHbWVzc2FnZQAJAQV2' +
  'YWx1ZQAJAQJtcwYJAgVieXRlcwYFbGltaXQGCAgJY2FuY2VsbGVkBQZmYWlsZWQHB2ludmFsaWQLBGxvc3QMB3J1bm5pbmcB' +
  'CXN1Y2NlZWRlZA0JdGltZWRfb3V0Dgl0b29fbGFyZ2UPCQIEbmFtZQAHdmVyc2lvbgAIAgRub25lAQRzb21lEQgBBWZpZWxk' +
  'AAoTCQIEcGF0aBQEaGFzaAAIAgdkYXRhc2V0FQV2YWx1ZQAKFgoVCQMJdGltZW91dE1zBg5tYXhSZXN1bHRCeXRlcwYLbWF4' +
  'TG9nQnl0ZXMGBAkPAmlkAAhmdW5jdGlvbgIGY2FsbGVyAglzdGFydGVkQXQDB2VuZGVkQXQEBXN0YXRlEAdwYWNrYWdlEgRh' +
  'cmdzFwZpbnB1dHMYBmxpbWl0cxkJZXhwaXJlc0F0AwZzdGRvdXQABnN0ZGVycgAPc3Rkb3V0VHJ1bmNhdGVkGg9zdGRlcnJU' +
  'cnVuY2F0ZWQaCgAJAQdjb21tYW5kHAgCBGxhenkBBXdob2xlAQkCCXBsYXRmb3JtcxwGZGVjb2RlHggEBmN1c3RvbR0GZWFz' +
  'dF9jHwllYXN0X25vZGUfB2Vhc3RfcHkfCQICYnkCAmF0AwgCBG5vbmUBBHNvbWUhCQIJc3VjY2VlZGVkBgZmYWlsZWQGCQgE' +
  'Y2FsbBsJd29ya3NwYWNlAA5mdW5jdGlvbk9iamVjdAAGcnVubmVyIAd2ZXJib3NlGghkZWFkbGluZQMGY2FuY2VsIgRrZWVw' +
  'IwEAAZ8E6wFTMTC0TDRPM0rVNUkyS9Y1TzFM1LVMNk7VNU0zSzRPski2TDFIZWQtLM0vSWXkT0xJdEitSMwtyEnVS87Pbfjx' +
  'Yv35NMaO+S+BFKtDIoWAkb2gKDM5My+d1VDPSM+AgYnRIYlCwMDAxMCWmVdQWlLMwFqcmJNazOCQTCFgYGAEmspelJqcX5RS' +
  'zMCSlZ8ENDWFQsBwYCV7Q0MDY0MDR8fNBZvPp/GDAiM1RcFYISczL7WYi4GBgTkltcwhlULAxMAo5pCak1iUmJipn5pYXKKb' +
  'l5+SqltckgK04cDCD8CoZGjYtZ25YcKTAywA',
  'base64',
);

/** A one-shot started as a call, which release 1.0.107 kept in workspace
 *  `dev`: running, verbose, and asked to stop. Its lifetime ended in 2025. */
const RUNNING_1_0_107 = Buffer.from(
  'iUVhc3QNCgUAxgUkJQEACAIEbm9uZQEEc29tZQAFCAIEbm9uZQEEc29tZQMJAQJieQICCQEIZXhpdENvZGUGCAIEbm9uZQEE' +
  'c29tZQYJBAdtZXNzYWdlAAhmaWxlbmFtZQIEbGluZQgGY29sdW1uCAoJCQELZGlhZ25vc3RpY3MKCQEHbWVzc2FnZQAJAQV2' +
  'YWx1ZQAJAQJtcwYJAgVieXRlcwYFbGltaXQGCAgJY2FuY2VsbGVkBQZmYWlsZWQHB2ludmFsaWQLBGxvc3QMB3J1bm5pbmcB' +
  'CXN1Y2NlZWRlZA0JdGltZWRfb3V0Dgl0b29fbGFyZ2UPCQIEbmFtZQAHdmVyc2lvbgAIAgRub25lAQRzb21lEQgBBWZpZWxk' +
  'AAoTCQIEcGF0aBQEaGFzaAAIAgdkYXRhc2V0FQV2YWx1ZQAKFgoVCQMJdGltZW91dE1zBg5tYXhSZXN1bHRCeXRlcwYLbWF4' +
  'TG9nQnl0ZXMGBAkPAmlkAAhmdW5jdGlvbgIGY2FsbGVyAglzdGFydGVkQXQDB2VuZGVkQXQEBXN0YXRlEAdwYWNrYWdlEgRh' +
  'cmdzFwZpbnB1dHMYBmxpbWl0cxkJZXhwaXJlc0F0AwZzdGRvdXQABnN0ZGVycgAPc3Rkb3V0VHJ1bmNhdGVkGg9zdGRlcnJU' +
  'cnVuY2F0ZWQaCgAJAQdjb21tYW5kHAgCBGxhenkBBXdob2xlAQkCCXBsYXRmb3JtcxwGZGVjb2RlHggEBmN1c3RvbR0GZWFz' +
  'dF9jHwllYXN0X25vZGUfB2Vhc3RfcHkfCQICYnkCAmF0AwgCBG5vbmUBBHNvbWUhCQIJc3VjY2VlZGVkBgZmYWlsZWQGCQgE' +
  'Y2FsbBsJd29ya3NwYWNlAA5mdW5jdGlvbk9iamVjdAAGcnVubmVyIAd2ZXJib3NlGghkZWFkbGluZQMGY2FuY2VsIgRrZWVw' +
  'IwEAAbsBfVMxMLRMNE8zStU1TTZP0TVPNUrStUgxSdM1SzRPski2TDFINUxjYDgw6ev682kMLAwg0DDfs6GhgbGhgaNh4vGP' +
  'l4HSDAzMKallDmkUAkYGBkbGAxv3bTifxsgomF6UmJzqkFqRmFuQk6qXnJ87YRHIEQ27tjM3THhygAUA',
  'base64',
);

const decodeEarlier = decodeBeast2For(FunctionCallJobBeforeDraftsType);

describe('function-call-drafts', () => {
  it('reads a call an earlier release kept, as that release stored it, whatever its state', () => {
    const succeeded = decodeEarlier(SUCCEEDED_1_0_107);
    assert.deepEqual(
      [succeeded.call.id, succeeded.workspace, succeeded.call.state.type, succeeded.call.args.length, succeeded.call.inputs.length],
      ['019a7f2e-4b6c-7d1a-9c3e-5f6a7b8c9d0e', 'dev', 'succeeded', 2, 1],
    );
    const running = decodeEarlier(RUNNING_1_0_107);
    assert.deepEqual(
      [running.call.id, running.call.function.type, running.call.state.type, running.verbose, running.cancel.type],
      ['019a7f2e-5c7d-7e2b-8d4f-6a7b8c9d0e1f', 'none', 'running', true, 'some'],
    );
  });

  it('writes this release\'s form', () => {
    assert.ok(isTypeValueEqual(toEastTypeValue(FunctionCallJobWithDraftsType), toEastTypeValue(FunctionCallJobType)),
      'the kept call\'s type changed: its form is the next upgrade\'s to carry, from this one\'s frozen form');
  });

  it('carries the calls an earlier release kept into this release\'s form, each holding no draft, though their lifetimes have ended', async () => {
    const storage = new InMemoryStorage();
    const kept = [SUCCEEDED_1_0_107, RUNNING_1_0_107].map((bytes) => ({ bytes, earlier: decodeEarlier(bytes) }));
    const stored = async (id: string) => {
      const found = (await storage.calls.readStored('repo')).find((call) => call.id === id);
      assert.ok(found !== undefined && found.workspace === 'dev', 'the store holds the call');
      return found;
    };
    for (const { bytes, earlier } of kept) {
      await storage.calls.create('repo', { ...earlier, call: { ...earlier.call, drafts: [] }, drafted: [] });
      await (await stored(earlier.call.id)).replace(bytes);
      assert.throws(() => decodeFunctionCallJob(bytes), 'this release reads no call in the earlier form');
      await assert.rejects(storage.calls.get('repo', 'dev', earlier.call.id), 'before the upgrade, the call does not read');
    }

    assert.equal(await functionCallDrafts.apply(storage, 'repo', null, Date.now() + 60_000), null, 'a part with time to spare does the step whole');
    for (const { earlier } of kept) {
      const rewritten = await (await stored(earlier.call.id)).read();
      assert.ok(rewritten !== null, 'the store holds the call still, its lifetime ended or not');
      const carried = { ...earlier, call: { ...earlier.call, drafts: [] }, drafted: [] };
      const read = decodeFunctionCallJob(rewritten);
      assert.ok(equalFor(FunctionCallJobType)(read, carried),
        `the ${earlier.call.state.type} call is stored in this release's form, as it was and holding no draft: ${printFor(FunctionCallJobType)(read)}`);
    }
  });
});
