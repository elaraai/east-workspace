/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Streaming task execution through `taskExecute` — a real `e3.streamTask`
 * body (an SDK-built TaskDef, serialized to a TaskObject exactly as
 * `e3.export` does) spawning the actual runner CLI with the `--emit` /
 * `--stream` flags its command IR bakes in. This is the layer above the
 * runner CLI specs (east-node-cli/src/runner.spec.ts): input marshalling,
 * command IR evaluation, the spawned runner, and the emitted output stored
 * verbatim as the execution result.
 *
 * The east-py case doubles as the cross-runtime pin for the python emit
 * sink (#507): the blob `_EmitSink` wrote through the python streaming
 * writer is decoded here by the TypeScript reader, index included.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  ArrayType, DictType, IntegerType, StringType,
  some, none,
  decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, encodeEastIR, openBeast2PagesFor,
  EastIR,
} from '@elaraai/east';
import { input, streamTask, runnerToVariant, type Runner, type TaskDef } from '@elaraai/e3';
import { TaskObjectType, type TaskObject } from '@elaraai/e3-types';
import { taskExecute } from './LocalTaskRunner.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const EventsType = ArrayType(IntegerType);

/** Whether an `east-py` CLI resolves on PATH — the e3 CI workflow installs
 *  it (uv tool) on every leg; locally the east-py case skips when absent. */
const eastPyAvailable = (() => {
  const probe = spawnSync('east-py', ['version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0;
})();

describe('streamTask through taskExecute', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  const events = input('events', EventsType);

  /** A running-sum fold over the streamed `events` input, as `e3.export`
   *  would ship it (fresh task name per runner — names are per-package
   *  unique). */
  function foldTask(name: string, runner: Runner): TaskDef {
    return streamTask(name, {
      stream: events,
      output: ArrayType(IntegerType),
      runner,
    }, ($, evs, emit) => {
      const acc = $.let(0n);
      $.for(evs, ($, v) => {
        $.assign(acc, acc.add(v));
        $(emit(acc));
      });
    });
  }

  /** Serializes a streamTask TaskDef to a stored TaskObject, mirroring the
   *  export.ts mapping (function_ir dataset default = the EastIR bundle). */
  async function writeTask(def: TaskDef): Promise<{ taskHash: string; fnIrHash: string }> {
    const fnIrHash = await objectWrite(repo, encodeEastIR(def.inputs[0]!.default as unknown as EastIR<never[], unknown>));
    const commandIrHash = await objectWrite(repo, encodeEastIR(def.command));
    const task: TaskObject = {
      commandIr: commandIrHash,
      inputs: def.inputs.map((i) => i.path),
      output: def.output.path,
      kind: some(def.taskKind!),
      metadata: some(def.metadata!),
      runner: runnerToVariant(def.runner!),
      environment: none,
    };
    const taskHash = await objectWrite(repo, encodeBeast2For(TaskObjectType)(task));
    return { taskHash, fnIrHash };
  }

  async function writeEvents(): Promise<string> {
    const eventsArr = Array.from({ length: 2500 }, (_, i) => BigInt(i));
    return storage.objects.write(repo, encodeBeast2PagedFor(EventsType, { batchSize: 500 })(eventsArr));
  }

  async function assertFoldOutput(outputHash: string): Promise<void> {
    const output = await storage.objects.read(repo, outputHash);
    const pages = openBeast2PagesFor(ArrayType(IntegerType))(output);
    assert.equal(pages.elementCount, 2500);
    assert.ok(pages.selfContained, 'emitted blob is not pageable');
    const sums = decodeBeast2For(ArrayType(IntegerType))(output);
    assert.equal(sums[0], 0n);
    assert.equal(sums[99], (99n * 100n) / 2n);
    assert.equal(sums[2499], (2499n * 2500n) / 2n);
  }

  it('runs a fold body on the east-node runner and stores the indexed emitted output', async () => {
    const { taskHash, fnIrHash } = await writeTask(foldTask('balances', { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] }));
    const eventsHash = await writeEvents();

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash, eventsHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    await assertFoldOutput(result.outputHash!);
  });

  it('an out-of-order dict emit succeeds and stores the canonical output (#518)', async () => {
    // The sink absorbs out-of-order emission (demote → spill → merge), so
    // a re-keying producer is an ordinary success whose stored output is
    // the canonical dict.
    const rekey = streamTask('rekey_dict', {
      output: DictType(IntegerType, StringType),
      runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] },
    }, ($, emit) => {
      $(emit(2n, 'b'));
      $(emit(1n, 'a'));
    });
    const { taskHash, fnIrHash } = await writeTask(rekey);

    const result = await taskExecute(storage, repo, taskHash, [fnIrHash]);
    assert.equal(result.state, 'success', result.error ?? '');
    const output = await storage.objects.read(repo, result.outputHash!);
    const decoded = decodeBeast2For(DictType(IntegerType, StringType))(output);
    assert.equal(decoded.size, 2);
    assert.equal(decoded.get(1n), 'a');
    assert.equal(decoded.get(2n), 'b');
  });

  it('runs the fold on the east-py runner and its emitted blob decodes under the TS reader',
    { skip: eastPyAvailable ? false : 'east-py CLI not on PATH' }, async () => {
      const { taskHash, fnIrHash } = await writeTask(foldTask('balances_py', { runtime: 'east-py', platforms: ['east-py-std'] }));
      const eventsHash = await writeEvents();

      const result = await taskExecute(storage, repo, taskHash, [fnIrHash, eventsHash]);
      assert.equal(result.state, 'success', result.error ?? '');
      await assertFoldOutput(result.outputHash!);
    });
});
