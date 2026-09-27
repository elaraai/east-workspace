/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The execution state's form. A stored state is decoded against the whole
 * type it was written with, so each state here is one an e3 wrote: this
 * release's form reads, and every other is refused, naming the release that
 * wrote it — or, for a state from before states recorded one, an older e3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, DictType, StringType, StructType, encodeBeast2For, none, some, variant } from '@elaraai/east';
import { decodeDataflowExecutionState } from './dataflow.js';
import { E3_RELEASE } from './release.js';

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

/** Version 5: task `double` completed with the peak its runners reached, and
 *  a piece of `sum` stopped past the budget and requeued. */
const STATE_V5 = Buffer.from(
  'iUVhc3QNCgUAngsoKQIBBQQACAIEbm9uZQQEc29tZQEKAQkFBG5hbWUBBGhhc2gBBmlucHV0cwYGb3V0cHV0AQlkZXBlbmRz' +
  'T24GCgcJAQV0YXNrcwgIAgRub25lBARzb21lCQgCBG5vbmUEBHNvbWUDCAIEbm9uZQQEc29tZQAIAgRub25lBARzb21lAgkC' +
  'CmlucHV0c0hhc2gBC2V4ZWN1dGlvbklkAQgCBG5vbmUEBHNvbWUOCQsEbmFtZQEGc3RhdHVzAQZjYWNoZWQLCm91dHB1dEhh' +
  'c2gFBWVycm9yBQhleGl0Q29kZQwJc3RhcnRlZEF0DQtjb21wbGV0ZWRBdA0IZHVyYXRpb24MBHBsYW4FCWV4ZWN1dGlvbg8L' +
  'ARALAQELARIJAwNzZXEACXRpbWVzdGFtcAIGcmVhc29uBQkIA3NlcQAJdGltZXN0YW1wAgdzdWNjZXNzAwhleGVjdXRlZAAG' +
  'Y2FjaGVkAAZmYWlsZWQAB3NraXBwZWQACGR1cmF0aW9uAAkEA3NlcQAJdGltZXN0YW1wAgtleGVjdXRpb25JZAEKdG90YWxU' +
  'YXNrcwAJBQNzZXEACXRpbWVzdGFtcAIEcGF0aAEMcHJldmlvdXNIYXNoAQduZXdIYXNoAQkHA3NlcQAJdGltZXN0YW1wAgR0' +
  'YXNrAQZjYWNoZWQDCm91dHB1dEhhc2gBCGR1cmF0aW9uAAlwZWFrQnl0ZXMMCQQDc2VxAAl0aW1lc3RhbXACBHRhc2sBDGNv' +
  'bmZsaWN0UGF0aAEJBgNzZXEACXRpbWVzdGFtcAIEdGFzawEFZXJyb3IFCGV4aXRDb2RlDAhkdXJhdGlvbgAJBANzZXEACXRp' +
  'bWVzdGFtcAIEdGFzawEGcmVhc29uAQkFA3NlcQAJdGltZXN0YW1wAgR0YXNrAQVsZXZlbAAGbGV2ZWxzAAkGA3NlcQAJdGlt' +
  'ZXN0YW1wAgR0YXNrAQVsZXZlbAAGbGV2ZWxzAAV1bml0cwAJAwNzZXEACXRpbWVzdGFtcAIEdGFzawEJBANzZXEACXRpbWVz' +
  'dGFtcAIEdGFzawEFY2F1c2UBCQQDc2VxAAl0aW1lc3RhbXACBHRhc2sBBnBpZWNlcwAJAgVsZXZlbAAGbGV2ZWxzAAgCBG5v' +
  'bmUEBHNvbWUhCQMFbWVyZ2UiBWluZGV4AAV1bml0cwAIAwZidWRnZXQEA2NhcAQHbWFjaGluZQQJBwNzZXEACXRpbWVzdGFt' +
  'cAIEdGFzawEEdW5pdCMGcmVhc29uJARwZWFrAAhyZXNlcnZlcwAIDxNleGVjdXRpb25fY2FuY2VsbGVkFBNleGVjdXRpb25f' +
  'Y29tcGxldGVkFRFleGVjdXRpb25fc3RhcnRlZBYNaW5wdXRfY2hhbmdlZBcOdGFza19jb21wbGV0ZWQYDXRhc2tfZGVmZXJy' +
  'ZWQZC3Rhc2tfZmFpbGVkGhB0YXNrX2ludmFsaWRhdGVkGxR0YXNrX21lcmdlX2NvbXBsZXRlZBwSdGFza19tZXJnZV9zdGFy' +
  'dGVkHQp0YXNrX3JlYWR5Hgx0YXNrX3NraXBwZWQfCnRhc2tfc3BsaXQgDHRhc2tfc3RhcnRlZB4NdW5pdF9yZXF1ZXVlZCUK' +
  'JgkXB3ZlcnNpb24AAmlkAQRyZXBvAQl3b3Jrc3BhY2UBCXN0YXJ0ZWRBdAIFZm9yY2UDBmZpbHRlcgUFZ3JhcGgKCWdyYXBo' +
  'SGFzaAUFdGFza3MRCGV4ZWN1dGVkAAZjYWNoZWQABmZhaWxlZAAHc2tpcHBlZAAGc3RhdHVzAQtjb21wbGV0ZWRBdA0FZXJy' +
  'b3IFDnZlcnNpb25WZWN0b3JzEw1pbnB1dFNuYXBzaG90Eg90YXNrT3V0cHV0UGF0aHMGCnJlZXhlY3V0ZWQABmV2ZW50cycI' +
  'ZXZlbnRTZXEAAQAB3waUAuNSMTC0NEg0SDLQtQACXXMDAyALRAAxHLAUpRbkM5UXNzw5fep9GgMDIwMTW0p+aVJOqkMihYCB' +
  'kVMvM6+gtKRYr4KBV68ksTi7WA9iNgMDc3FprkMKhYCBEc1YLigXaDgDI9QfDEAA8xOU4kzOzy3ISS1JTWFkYHRIphAAA+3C' +
  'Z1DoMS5oPgOiJICGJlEIiIk8Q1AggjB3Zl58QVF+elFqcTHIu4wfJoEcAmQwpZoCfQ8UYi8qzcvLzEsHSSNHjEMahQBoPGok' +
  'IMcB0F4mJkjSIi418rJAghIaUSxskCCFRSXFcSXB2NDQkMDLAQkgUNjxcCHYLHw8BxbBOAxMLAxAxdNAOqYxcvJN2ASTYWJi' +
  'YuADAA==',
  'base64',
);

/** The version 5 state, as release 1.0.79 writes it: the release in place of
 *  the version. */
const STATE = Buffer.from(
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

const NEW_FORM = 'a change to the execution state\'s type is a new form: ship a repository upgrade step that carries a repository\'s states into it, move this state to the refusals, and add one the new form writes';

describe('decodeDataflowExecutionState', () => {
  it('refuses a state from before states recorded their release, naming the fix', () => {
    for (const state of [STATE_V1, STATE_V2, STATE_V3, STATE_V4, STATE_V5]) {
      assert.throws(
        () => decodeDataflowExecutionState(state),
        { message: `the execution state was written by an older e3, in a form this e3, ${E3_RELEASE}, does not read — re-create the repository: deploy again and import its data again` },
      );
    }
  });

  it('reads a state in this release\'s form', () => {
    assert.doesNotThrow(() => decodeDataflowExecutionState(STATE), NEW_FORM);
    const state = decodeDataflowExecutionState(STATE);
    assert.equal(state.release, '1.0.79');
    assert.deepEqual(state.tasks.get('sum')!.plan, some('e5'));
    assert.deepEqual(state.tasks.get('sum')!.execution, none);
    assert.deepEqual(state.tasks.get('double')!.execution, some({ inputsHash: 'b'.repeat(64), executionId: '0190a0b0-8888-7000-8000-000000000001' }));
    assert.deepEqual(state.events.map((event) => event.type),
      ['execution_started', 'task_started', 'task_completed', 'task_started', 'task_split', 'unit_requeued', 'task_merge_started']);
    assert.deepEqual(state.events[2]!.value, {
      seq: 3n, timestamp: new Date('2026-01-02T03:04:02.000Z'), task: 'double', cached: false, outputHash: 'c'.repeat(64), duration: 12n,
      peakBytes: some(96n * 1024n ** 2n),
    });
    assert.deepEqual(state.events[5]!.value, {
      seq: 6n, timestamp: new Date('2026-01-02T03:04:04.000Z'), task: 'sum', unit: { merge: none, index: 1n, units: 2n },
      reason: variant('budget', null), peak: 150n * 1024n ** 2n, reserves: 150n * 1024n ** 2n,
    });
  });

  it('refuses a state a newer release wrote, naming it', () => {
    const newer = encodeBeast2For(StructType({ release: StringType, id: StringType }))({ release: '999.0.0', id: '7' });
    assert.throws(
      () => decodeDataflowExecutionState(newer),
      { message: `the execution state was written by e3 999.0.0, in a form this e3, ${E3_RELEASE}, does not read — use e3 999.0.0 or a newer one` },
    );
  });

  it('refuses a state an older release wrote in another form, naming it and the fix', () => {
    const older = encodeBeast2For(StructType({
      release: StringType, workspace: StringType, tasks: DictType(StringType, StringType), events: ArrayType(StringType),
    }))({ release: '1.0.0', workspace: 'main', tasks: new Map(), events: [] });
    assert.throws(
      () => decodeDataflowExecutionState(older),
      { message: `the execution state was written by e3 1.0.0, in a form this e3, ${E3_RELEASE}, does not read — re-create the repository: deploy again and import its data again` },
    );
  });

  it('refuses data that is not an execution state', () => {
    const other = encodeBeast2For(StructType({ id: StringType }))({ id: '7' });
    assert.throws(() => decodeDataflowExecutionState(other), /not an execution state/);
  });
});
