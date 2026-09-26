/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The execution state's version. A stored state is decoded against the whole
 * type it was written with, so each state here is one that version's e3 wrote:
 * the current version reads, and an older or a newer one is refused, naming
 * its version.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, StringType, StructType, encodeBeast2For, none, some } from '@elaraai/east';
import { EXECUTION_STATE_VERSION, decodeDataflowExecutionState } from './dataflow.js';

/** Version 1, written by the released e3: task `double` completed, `sum`
 *  ready, and four events. */
const STATE_V1 = Buffer.from(
  'iUVhc3QNCgUAnwgeHwEFAgQACAIEbm9uZQQEc29tZQAKAAkFBG5hbWUABGhhc2gABmlucHV0cwYGb3V0cHV0AAlkZXBlbmRz' +
  'T24GCgcJAQV0YXNrcwgIAgRub25lBARzb21lCQgCBG5vbmUEBHNvbWUDCAIEbm9uZQQEc29tZQIIAgRub25lBARzb21lAQkJ' +
  'BG5hbWUABnN0YXR1cwAGY2FjaGVkCwpvdXRwdXRIYXNoBQVlcnJvcgUIZXhpdENvZGUMCXN0YXJ0ZWRBdA0LY29tcGxldGVk' +
  'QXQNCGR1cmF0aW9uDAsADgsAAAsAEAkDA3NlcQIJdGltZXN0YW1wAQZyZWFzb24FCQgDc2VxAgl0aW1lc3RhbXABB3N1Y2Nl' +
  'c3MDCGV4ZWN1dGVkAgZjYWNoZWQCBmZhaWxlZAIHc2tpcHBlZAIIZHVyYXRpb24CCQQDc2VxAgl0aW1lc3RhbXABC2V4ZWN1' +
  'dGlvbklkAAp0b3RhbFRhc2tzAgkFA3NlcQIJdGltZXN0YW1wAQRwYXRoAAxwcmV2aW91c0hhc2gAB25ld0hhc2gACQYDc2Vx' +
  'Agl0aW1lc3RhbXABBHRhc2sABmNhY2hlZAMKb3V0cHV0SGFzaAAIZHVyYXRpb24CCQQDc2VxAgl0aW1lc3RhbXABBHRhc2sA' +
  'DGNvbmZsaWN0UGF0aAAJBgNzZXECCXRpbWVzdGFtcAEEdGFzawAFZXJyb3IFCGV4aXRDb2RlDAhkdXJhdGlvbgIJBANzZXEC' +
  'CXRpbWVzdGFtcAEEdGFzawAGcmVhc29uAAkDA3NlcQIJdGltZXN0YW1wAQR0YXNrAAkEA3NlcQIJdGltZXN0YW1wAQR0YXNr' +
  'AAVjYXVzZQAICxNleGVjdXRpb25fY2FuY2VsbGVkEhNleGVjdXRpb25fY29tcGxldGVkExFleGVjdXRpb25fc3RhcnRlZBQN' +
  'aW5wdXRfY2hhbmdlZBUOdGFza19jb21wbGV0ZWQWDXRhc2tfZGVmZXJyZWQXC3Rhc2tfZmFpbGVkGBB0YXNrX2ludmFsaWRh' +
  'dGVkGQp0YXNrX3JlYWR5Ggx0YXNrX3NraXBwZWQbDHRhc2tfc3RhcnRlZBoKHAkXAmlkAARyZXBvAAl3b3Jrc3BhY2UACXN0' +
  'YXJ0ZWRBdAELY29uY3VycmVuY3kCBWZvcmNlAwZmaWx0ZXIFBWdyYXBoCglncmFwaEhhc2gFBXRhc2tzDwhleGVjdXRlZAIG' +
  'Y2FjaGVkAgZmYWlsZWQCB3NraXBwZWQCBnN0YXR1cwALY29tcGxldGVkQXQNBWVycm9yBQ52ZXJzaW9uVmVjdG9ycxENaW5w' +
  'dXRTbmFwc2hvdBAPdGFza091dHB1dFBhdGhzBgpyZWV4ZWN1dGVkAgZldmVudHMdCGV2ZW50U2VxAgEAAcoCtgFjNGcpSi3I' +
  'ZyovnrDpzKn3aRwMDIwMTGwp+aVJOalMiYYMjJx6mXkFpSXFehUMvHolicXZxXoQWQYG5uLSXKYkIwZGNAkuKBcozcAINYsB' +
  'CGDmQinO5PzcgpzUktQURgZGpmRjoNUQR8AoCZAFIMxalJqYUgkyAmwMELMXleblZealA5nILkRiM6WYoEqCBZhQnYrsUgYG' +
  'FiYGqM3mLFxMECbUrSwsKFwGoHMlONggYiAXMnAAAA==',
  'base64',
);

/** Version 2: task `sum` split into pieces, its `$plan` named, and the
 *  events of its stages. */
const STATE_V2 = Buffer.from(
  'iUVhc3QNCgUA2QkhIgIBBQQACAIEbm9uZQQEc29tZQEKAQkFBG5hbWUBBGhhc2gBBmlucHV0cwYGb3V0cHV0AQlkZXBlbmRz' +
  'T24GCgcJAQV0YXNrcwgIAgRub25lBARzb21lCQgCBG5vbmUEBHNvbWUDCAIEbm9uZQQEc29tZQAIAgRub25lBARzb21lAgkK' +
  'BG5hbWUBBnN0YXR1cwEGY2FjaGVkCwpvdXRwdXRIYXNoBQVlcnJvcgUIZXhpdENvZGUMCXN0YXJ0ZWRBdA0LY29tcGxldGVk' +
  'QXQNCGR1cmF0aW9uDARwbGFuBQsBDgsBAQsBEAkDA3NlcQAJdGltZXN0YW1wAgZyZWFzb24FCQgDc2VxAAl0aW1lc3RhbXAC' +
  'B3N1Y2Nlc3MDCGV4ZWN1dGVkAAZjYWNoZWQABmZhaWxlZAAHc2tpcHBlZAAIZHVyYXRpb24ACQQDc2VxAAl0aW1lc3RhbXAC' +
  'C2V4ZWN1dGlvbklkAQp0b3RhbFRhc2tzAAkFA3NlcQAJdGltZXN0YW1wAgRwYXRoAQxwcmV2aW91c0hhc2gBB25ld0hhc2gB' +
  'CQYDc2VxAAl0aW1lc3RhbXACBHRhc2sBBmNhY2hlZAMKb3V0cHV0SGFzaAEIZHVyYXRpb24ACQQDc2VxAAl0aW1lc3RhbXAC' +
  'BHRhc2sBDGNvbmZsaWN0UGF0aAEJBgNzZXEACXRpbWVzdGFtcAIEdGFzawEFZXJyb3IFCGV4aXRDb2RlDAhkdXJhdGlvbgAJ' +
  'BANzZXEACXRpbWVzdGFtcAIEdGFzawEGcmVhc29uAQkFA3NlcQAJdGltZXN0YW1wAgR0YXNrAQVsZXZlbAAGbGV2ZWxzAAkG' +
  'A3NlcQAJdGltZXN0YW1wAgR0YXNrAQVsZXZlbAAGbGV2ZWxzAAV1bml0cwAJAwNzZXEACXRpbWVzdGFtcAIEdGFzawEJBANz' +
  'ZXEACXRpbWVzdGFtcAIEdGFzawEFY2F1c2UBCQQDc2VxAAl0aW1lc3RhbXACBHRhc2sBBnBpZWNlcwAIDhNleGVjdXRpb25f' +
  'Y2FuY2VsbGVkEhNleGVjdXRpb25fY29tcGxldGVkExFleGVjdXRpb25fc3RhcnRlZBQNaW5wdXRfY2hhbmdlZBUOdGFza19j' +
  'b21wbGV0ZWQWDXRhc2tfZGVmZXJyZWQXC3Rhc2tfZmFpbGVkGBB0YXNrX2ludmFsaWRhdGVkGRR0YXNrX21lcmdlX2NvbXBs' +
  'ZXRlZBoSdGFza19tZXJnZV9zdGFydGVkGwp0YXNrX3JlYWR5HAx0YXNrX3NraXBwZWQdCnRhc2tfc3BsaXQeDHRhc2tfc3Rh' +
  'cnRlZBwKHwkYB3ZlcnNpb24AAmlkAQRyZXBvAQl3b3Jrc3BhY2UBCXN0YXJ0ZWRBdAILY29uY3VycmVuY3kABWZvcmNlAwZm' +
  'aWx0ZXIFBWdyYXBoCglncmFwaEhhc2gFBXRhc2tzDwhleGVjdXRlZAAGY2FjaGVkAAZmYWlsZWQAB3NraXBwZWQABnN0YXR1' +
  'cwELY29tcGxldGVkQXQNBWVycm9yBQ52ZXJzaW9uVmVjdG9ycxENaW5wdXRTbmFwc2hvdBAPdGFza091dHB1dFBhdGhzBgpy' +
  'ZWV4ZWN1dGVkAAZldmVudHMgCGV2ZW50U2VxAAEAAfEBjAFjYTRnKUotyGcqL56w6cyp92kcDAyMDIzMxaW5TElGDIycepl5' +
  'BaUlxXoVDFx6JYnF2cV6QCkGEAArAmHuzLz4gqL89KLU4mKwBMQkIIMp1RSslL2oNC8vMy8dJIlkIhKbKcUEVRIswIhqJysT' +
  'A8RoRnMmXiYIE+QAHhYEm42TDcFhYmLi4EDmMnABAA==',
  'base64',
);

/** Version 3: the version 2 state, without its `concurrency`. */
const STATE_V3 = Buffer.from(
  'iUVhc3QNCgUAzAkhIgIBBQQACAIEbm9uZQQEc29tZQEKAQkFBG5hbWUBBGhhc2gBBmlucHV0cwYGb3V0cHV0AQlkZXBlbmRz' +
  'T24GCgcJAQV0YXNrcwgIAgRub25lBARzb21lCQgCBG5vbmUEBHNvbWUDCAIEbm9uZQQEc29tZQAIAgRub25lBARzb21lAgkK' +
  'BG5hbWUBBnN0YXR1cwEGY2FjaGVkCwpvdXRwdXRIYXNoBQVlcnJvcgUIZXhpdENvZGUMCXN0YXJ0ZWRBdA0LY29tcGxldGVk' +
  'QXQNCGR1cmF0aW9uDARwbGFuBQsBDgsBAQsBEAkDA3NlcQAJdGltZXN0YW1wAgZyZWFzb24FCQgDc2VxAAl0aW1lc3RhbXAC' +
  'B3N1Y2Nlc3MDCGV4ZWN1dGVkAAZjYWNoZWQABmZhaWxlZAAHc2tpcHBlZAAIZHVyYXRpb24ACQQDc2VxAAl0aW1lc3RhbXAC' +
  'C2V4ZWN1dGlvbklkAQp0b3RhbFRhc2tzAAkFA3NlcQAJdGltZXN0YW1wAgRwYXRoAQxwcmV2aW91c0hhc2gBB25ld0hhc2gB' +
  'CQYDc2VxAAl0aW1lc3RhbXACBHRhc2sBBmNhY2hlZAMKb3V0cHV0SGFzaAEIZHVyYXRpb24ACQQDc2VxAAl0aW1lc3RhbXAC' +
  'BHRhc2sBDGNvbmZsaWN0UGF0aAEJBgNzZXEACXRpbWVzdGFtcAIEdGFzawEFZXJyb3IFCGV4aXRDb2RlDAhkdXJhdGlvbgAJ' +
  'BANzZXEACXRpbWVzdGFtcAIEdGFzawEGcmVhc29uAQkFA3NlcQAJdGltZXN0YW1wAgR0YXNrAQVsZXZlbAAGbGV2ZWxzAAkG' +
  'A3NlcQAJdGltZXN0YW1wAgR0YXNrAQVsZXZlbAAGbGV2ZWxzAAV1bml0cwAJAwNzZXEACXRpbWVzdGFtcAIEdGFzawEJBANz' +
  'ZXEACXRpbWVzdGFtcAIEdGFzawEFY2F1c2UBCQQDc2VxAAl0aW1lc3RhbXACBHRhc2sBBnBpZWNlcwAIDhNleGVjdXRpb25f' +
  'Y2FuY2VsbGVkEhNleGVjdXRpb25fY29tcGxldGVkExFleGVjdXRpb25fc3RhcnRlZBQNaW5wdXRfY2hhbmdlZBUOdGFza19j' +
  'b21wbGV0ZWQWDXRhc2tfZGVmZXJyZWQXC3Rhc2tfZmFpbGVkGBB0YXNrX2ludmFsaWRhdGVkGRR0YXNrX21lcmdlX2NvbXBs' +
  'ZXRlZBoSdGFza19tZXJnZV9zdGFydGVkGwp0YXNrX3JlYWR5HAx0YXNrX3NraXBwZWQdCnRhc2tfc3BsaXQeDHRhc2tfc3Rh' +
  'cnRlZBwKHwkXB3ZlcnNpb24AAmlkAQRyZXBvAQl3b3Jrc3BhY2UBCXN0YXJ0ZWRBdAIFZm9yY2UDBmZpbHRlcgUFZ3JhcGgK' +
  'CWdyYXBoSGFzaAUFdGFza3MPCGV4ZWN1dGVkAAZjYWNoZWQABmZhaWxlZAAHc2tpcHBlZAAGc3RhdHVzAQtjb21wbGV0ZWRB' +
  'dA0FZXJyb3IFDnZlcnNpb25WZWN0b3JzEQ1pbnB1dFNuYXBzaG90EA90YXNrT3V0cHV0UGF0aHMGCnJlZXhlY3V0ZWQABmV2' +
  'ZW50cyAIZXZlbnRTZXEAAQAB8AGJAWNjNGcpSi3IZyovnrDpzKn3aQwMjAyMzMWluUxJRgyMnHqZeQWlJcV6FQxceiWJxdnF' +
  'ekApBhAAKwJh7sy8+IKi/PSi1OJisATcIKZUU7BS9qLSvLzMvHSQJJKJSGymFBNUSbAAI6qdrEwMEKMZzZl4mSBMkAN4WBBs' +
  'Nk42BIeJiYmDA5nLwAUA',
  'base64',
);

/** Version 4: the version 3 state, each task with the execution it completed
 *  with — `double`, completed since, by its inputs hash and id. */
const STATE_V4 = Buffer.from(
  'iUVhc3QNCgUAgAojJAIBBQQACAIEbm9uZQQEc29tZQEKAQkFBG5hbWUBBGhhc2gBBmlucHV0cwYGb3V0cHV0AQlkZXBlbmRz' +
  'T24GCgcJAQV0YXNrcwgIAgRub25lBARzb21lCQgCBG5vbmUEBHNvbWUDCAIEbm9uZQQEc29tZQAIAgRub25lBARzb21lAgkC' +
  'CmlucHV0c0hhc2gBC2V4ZWN1dGlvbklkAQgCBG5vbmUEBHNvbWUOCQsEbmFtZQEGc3RhdHVzAQZjYWNoZWQLCm91dHB1dEhh' +
  'c2gFBWVycm9yBQhleGl0Q29kZQwJc3RhcnRlZEF0DQtjb21wbGV0ZWRBdA0IZHVyYXRpb24MBHBsYW4FCWV4ZWN1dGlvbg8L' +
  'ARALAQELARIJAwNzZXEACXRpbWVzdGFtcAIGcmVhc29uBQkIA3NlcQAJdGltZXN0YW1wAgdzdWNjZXNzAwhleGVjdXRlZAAG' +
  'Y2FjaGVkAAZmYWlsZWQAB3NraXBwZWQACGR1cmF0aW9uAAkEA3NlcQAJdGltZXN0YW1wAgtleGVjdXRpb25JZAEKdG90YWxU' +
  'YXNrcwAJBQNzZXEACXRpbWVzdGFtcAIEcGF0aAEMcHJldmlvdXNIYXNoAQduZXdIYXNoAQkGA3NlcQAJdGltZXN0YW1wAgR0' +
  'YXNrAQZjYWNoZWQDCm91dHB1dEhhc2gBCGR1cmF0aW9uAAkEA3NlcQAJdGltZXN0YW1wAgR0YXNrAQxjb25mbGljdFBhdGgB' +
  'CQYDc2VxAAl0aW1lc3RhbXACBHRhc2sBBWVycm9yBQhleGl0Q29kZQwIZHVyYXRpb24ACQQDc2VxAAl0aW1lc3RhbXACBHRh' +
  'c2sBBnJlYXNvbgEJBQNzZXEACXRpbWVzdGFtcAIEdGFzawEFbGV2ZWwABmxldmVscwAJBgNzZXEACXRpbWVzdGFtcAIEdGFz' +
  'awEFbGV2ZWwABmxldmVscwAFdW5pdHMACQMDc2VxAAl0aW1lc3RhbXACBHRhc2sBCQQDc2VxAAl0aW1lc3RhbXACBHRhc2sB' +
  'BWNhdXNlAQkEA3NlcQAJdGltZXN0YW1wAgR0YXNrAQZwaWVjZXMACA4TZXhlY3V0aW9uX2NhbmNlbGxlZBQTZXhlY3V0aW9u' +
  'X2NvbXBsZXRlZBURZXhlY3V0aW9uX3N0YXJ0ZWQWDWlucHV0X2NoYW5nZWQXDnRhc2tfY29tcGxldGVkGA10YXNrX2RlZmVy' +
  'cmVkGQt0YXNrX2ZhaWxlZBoQdGFza19pbnZhbGlkYXRlZBsUdGFza19tZXJnZV9jb21wbGV0ZWQcEnRhc2tfbWVyZ2Vfc3Rh' +
  'cnRlZB0KdGFza19yZWFkeR4MdGFza19za2lwcGVkHwp0YXNrX3NwbGl0IAx0YXNrX3N0YXJ0ZWQeCiEJFwd2ZXJzaW9uAAJp' +
  'ZAEEcmVwbwEJd29ya3NwYWNlAQlzdGFydGVkQXQCBWZvcmNlAwZmaWx0ZXIFBWdyYXBoCglncmFwaEhhc2gFBXRhc2tzEQhl' +
  'eGVjdXRlZAAGY2FjaGVkAAZmYWlsZWQAB3NraXBwZWQABnN0YXR1cwELY29tcGxldGVkQXQNBWVycm9yBQ52ZXJzaW9uVmVj' +
  'dG9ycxMNaW5wdXRTbmFwc2hvdBIPdGFza091dHB1dFBhdGhzBgpyZWV4ZWN1dGVkAAZldmVudHMiCGV2ZW50U2VxAAEAAYkD' +
  'xwHjYDRnKUotyGcqL56w6cyp92kMDIwMjMzFpblMSUYMjJx6mXkFpSXFehUMXHolicXZxXpAKQYQYGJLyS9NykmFUpzJ+bkF' +
  'OaklqSlA/UwpJkBzIAbCKC4GRockCoGKgaGlQaJBkoGuBRDomhsYAFkgAohhwBDkeBDmzsyLLyjKTy9KLS4GORjqECCDKdUU' +
  '7AUG9qLSvLzMvHSQLJJXkdhgn2AIMKIGBisTA9ST5ky8TBAmyAU8LAg2GycbgsPExMTBgcxl4AIA',
  'base64',
);

const NEW_VERSION = 'a change to the execution state\'s type is a new version: raise EXECUTION_STATE_VERSION, move this state to the older-version refusal, and add one the new version writes';

describe('decodeDataflowExecutionState', () => {
  it('refuses a state an older e3 wrote, naming its version and the fix', () => {
    for (const [state, version] of [[STATE_V1, 1n], [STATE_V2, 2n], [STATE_V3, 3n]] as const) {
      assert.throws(
        () => decodeDataflowExecutionState(state),
        { message: `the execution state was written by an older e3: it is version ${version}, and this e3 reads version ${EXECUTION_STATE_VERSION} — re-create the repository: deploy again and import its data again` },
      );
    }
  });

  it('reads a version 4 state', () => {
    const state = decodeDataflowExecutionState(STATE_V4);
    assert.equal(state.version, 4n, NEW_VERSION);
    assert.deepEqual(state.tasks.get('sum')!.plan, some('e5'));
    assert.deepEqual(state.tasks.get('sum')!.execution, none);
    assert.deepEqual(state.tasks.get('double')!.execution, some({ inputsHash: 'b'.repeat(64), executionId: '0190a0b0-8888-7000-8000-000000000001' }));
    assert.deepEqual(state.events.map((event) => event.type), ['execution_started', 'task_started', 'task_split', 'task_merge_started', 'task_merge_completed']);
    assert.deepEqual(state.events[3]!.value, { seq: 3n, timestamp: new Date('2026-01-02T03:04:05.000Z'), task: 'sum', level: 1n, levels: 1n, units: 1n });
  });

  it('refuses a state a newer e3 wrote, naming its version', () => {
    const newer = encodeBeast2For(StructType({ version: IntegerType, id: StringType }))({ version: EXECUTION_STATE_VERSION + 1n, id: '7' });
    assert.throws(
      () => decodeDataflowExecutionState(newer),
      { message: `the execution state was written by a newer e3: it is version ${EXECUTION_STATE_VERSION + 1n}, and this e3 reads version ${EXECUTION_STATE_VERSION}` },
    );
  });

  it('refuses data that is not an execution state', () => {
    const other = encodeBeast2For(StructType({ id: StringType }))({ id: '7' });
    assert.throws(() => decodeDataflowExecutionState(other), /not an execution state/);
  });
});
