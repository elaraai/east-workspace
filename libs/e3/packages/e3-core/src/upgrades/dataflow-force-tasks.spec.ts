/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries stored dataflow runs into the form that names the
 * tasks a run forces: it reads what the releases before it stored, and writes
 * this release's form. The contract suite (`contract/repository-record.ts`)
 * runs it over every backend; this holds its two forms to the bytes a release
 * stored and to the type this release reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBeast2For, equalFor, isTypeValueEqual, printFor, toEastTypeValue } from '@elaraai/east';
import { DataflowExecutionStateType, dataflowForce, decodeDataflowExecutionState } from '@elaraai/e3-types';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { DataflowStateBeforeForceTasksType, DataflowStateWithForceTasksType, dataflowForceTasks } from './dataflow-force-tasks.js';

/** A run release 1.0.79 stored in workspace `ws` of `repo`, forcing no task:
 *  task `double` completed, `sum` split, and seven events. */
const STATE_1_0_79 = Buffer.from(
  'iUVhc3QNCgUAngsoKQEFBAAIAgRub25lAwRzb21lAAoACQUEbmFtZQAEaGFzaAAGaW5wdXRzBQZvdXRwdXQACWRlcGVuZHNP' +
  'bgUKBgkBBXRhc2tzBwgCBG5vbmUDBHNvbWUICAIEbm9uZQMEc29tZQICCAIEbm9uZQMEc29tZQsIAgRub25lAwRzb21lAQkC' +
  'CmlucHV0c0hhc2gAC2V4ZWN1dGlvbklkAAgCBG5vbmUDBHNvbWUOCQsEbmFtZQAGc3RhdHVzAAZjYWNoZWQKCm91dHB1dEhh' +
  'c2gEBWVycm9yBAhleGl0Q29kZQwJc3RhcnRlZEF0DQtjb21wbGV0ZWRBdA0IZHVyYXRpb24MBHBsYW4ECWV4ZWN1dGlvbg8L' +
  'ABALAAALABIJAwNzZXELCXRpbWVzdGFtcAEGcmVhc29uBAkIA3NlcQsJdGltZXN0YW1wAQdzdWNjZXNzAghleGVjdXRlZAsG' +
  'Y2FjaGVkCwZmYWlsZWQLB3NraXBwZWQLCGR1cmF0aW9uCwkEA3NlcQsJdGltZXN0YW1wAQtleGVjdXRpb25JZAAKdG90YWxU' +
  'YXNrcwsJBQNzZXELCXRpbWVzdGFtcAEEcGF0aAAMcHJldmlvdXNIYXNoAAduZXdIYXNoAAkHA3NlcQsJdGltZXN0YW1wAQR0' +
  'YXNrAAZjYWNoZWQCCm91dHB1dEhhc2gACGR1cmF0aW9uCwlwZWFrQnl0ZXMMCQQDc2VxCwl0aW1lc3RhbXABBHRhc2sADGNv' +
  'bmZsaWN0UGF0aAAJBgNzZXELCXRpbWVzdGFtcAEEdGFzawAFZXJyb3IECGV4aXRDb2RlDAhkdXJhdGlvbgsJBANzZXELCXRp' +
  'bWVzdGFtcAEEdGFzawAGcmVhc29uAAkFA3NlcQsJdGltZXN0YW1wAQR0YXNrAAVsZXZlbAsGbGV2ZWxzCwkGA3NlcQsJdGlt' +
  'ZXN0YW1wAQR0YXNrAAVsZXZlbAsGbGV2ZWxzCwV1bml0cwsJAwNzZXELCXRpbWVzdGFtcAEEdGFzawAJBANzZXELCXRpbWVz' +
  'dGFtcAEEdGFzawAFY2F1c2UACQQDc2VxCwl0aW1lc3RhbXABBHRhc2sABnBpZWNlcwsJAgVsZXZlbAsGbGV2ZWxzCwgCBG5v' +
  'bmUDBHNvbWUhCQMFbWVyZ2UiBWluZGV4CwV1bml0cwsIAwZidWRnZXQDA2NhcAMHbWFjaGluZQMJBwNzZXELCXRpbWVzdGFt' +
  'cAEEdGFzawAEdW5pdCMGcmVhc29uJARwZWFrCwhyZXNlcnZlcwsIDxNleGVjdXRpb25fY2FuY2VsbGVkFBNleGVjdXRpb25f' +
  'Y29tcGxldGVkFRFleGVjdXRpb25fc3RhcnRlZBYNaW5wdXRfY2hhbmdlZBcOdGFza19jb21wbGV0ZWQYDXRhc2tfZGVmZXJy' +
  'ZWQZC3Rhc2tfZmFpbGVkGhB0YXNrX2ludmFsaWRhdGVkGxR0YXNrX21lcmdlX2NvbXBsZXRlZBwSdGFza19tZXJnZV9zdGFy' +
  'dGVkHQp0YXNrX3JlYWR5Hgx0YXNrX3NraXBwZWQfCnRhc2tfc3BsaXQgDHRhc2tfc3RhcnRlZB4NdW5pdF9yZXF1ZXVlZCUK' +
  'JgkXB3JlbGVhc2UAAmlkAARyZXBvAAl3b3Jrc3BhY2UACXN0YXJ0ZWRBdAEFZm9yY2UCBmZpbHRlcgQFZ3JhcGgJCWdyYXBo' +
  'SGFzaAQFdGFza3MRCGV4ZWN1dGVkCwZjYWNoZWQLBmZhaWxlZAsHc2tpcHBlZAsGc3RhdHVzAAtjb21wbGV0ZWRBdA0FZXJy' +
  'b3IEDnZlcnNpb25WZWN0b3JzEw1pbnB1dFNuYXBzaG90Eg90YXNrT3V0cHV0UGF0aHMFCnJlZXhlY3V0ZWQLBmV2ZW50cycI' +
  'ZXZlbnRTZXELAQAB5QaaAmMz1DPQM7dUMTC0NEg0SDLQtQACXXMDAyALRAAxHLAUpRbkM5UXNzw5fep9GgMDIwMTW0p+aVJO' +
  'qkMihYCBkVMvM6+gtKRYr4KBV68ksTi7WA9iNgMDc3FprkMKhYCBEc1YLigXaDgDI9QfDEAA8xOU4kzOzy3ISS1JTWFkYHRI' +
  'phAAA+3CZ1DoMS5oPgOiJICGJlEIiIk8Q1AggjB3Zl58QVF+elFqcTHIu4wfJoEcAmQwpZoCfQ8UYi8qzcvLzEsHSSNHjEMa' +
  'hQBoPGokIMcB0F4mJkjSIi418rJAghIaUSxskCCFRSXFcSXB2NDQkMDLAQkgUNjxcCHYLHw8BxbBOAxMLAxAxdNAOqYxcvJN' +
  '2ASTYWJiYuADAA==',
  'base64',
);

describe('dataflow-force-tasks', () => {
  it('reads a run an earlier release stored, as that release stored it', () => {
    const state = decodeBeast2For(DataflowStateBeforeForceTasksType)(STATE_1_0_79);
    assert.deepEqual([state.release, state.workspace, state.force], ['1.0.79', 'ws', false]);
  });

  it('writes this release\'s form', () => {
    assert.ok(isTypeValueEqual(toEastTypeValue(DataflowStateWithForceTasksType), toEastTypeValue(DataflowExecutionStateType)),
      'the execution state\'s type changed: its form is the next upgrade\'s to carry, from this one\'s frozen form');
  });

  it('carries a run an earlier release stored into this release\'s form, forcing none of its tasks', async () => {
    const storage = new InMemoryStorage();
    const earlier = decodeBeast2For(DataflowStateBeforeForceTasksType)(STATE_1_0_79);
    const store = storage.runStates('repo');
    await store.create({ ...earlier, force: dataflowForce(false) });
    const [stored] = await store.readStored('repo');
    assert.ok(stored !== undefined && stored.workspace === 'ws', 'the store holds the run');
    await stored.replace(STATE_1_0_79);
    await assert.rejects(store.read('repo', 'ws', earlier.id), /written by e3 1\.0\.79/, 'before the upgrade, the run does not read');

    assert.equal(await dataflowForceTasks.apply(storage, 'repo', null, Date.now() + 60_000), null, 'a part with time to spare does the step whole');
    const read = await store.read('repo', 'ws', earlier.id);
    const carried = { ...earlier, force: dataflowForce(false) };
    assert.ok(read !== null && equalFor(DataflowExecutionStateType)(read, carried),
      `the run reads as it was, forcing none: ${read === null ? 'none' : printFor(DataflowExecutionStateType)(read)}`);
    const [rewritten] = await store.readStored('repo');
    assert.ok(rewritten !== undefined && equalFor(DataflowExecutionStateType)(decodeDataflowExecutionState(rewritten.bytes), carried),
      'it is stored in this release\'s form');
  });
});
