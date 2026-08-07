/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Wire-freeze pin for the persisted execution-state event variant.
 *
 * beast2 v5 encodes variant cases POSITIONALLY against the alphabetically
 * sorted case list ({@link VariantType} sorts at construction), so the case
 * list below IS the wire of every persisted `execution.beast2`: adding,
 * removing or renaming a case shifts later indices and released readers
 * mis-decode (or fail to decode) existing states. This spec exists to make
 * that impossible to do silently — see the wire warning in `dataflow.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toEastTypeValue } from '@elaraai/east';
import { ExecutionEventType } from './dataflow.js';

describe('ExecutionEventType wire freeze', () => {
  it('keeps the released, alphabetically-sorted case list', () => {
    const typeValue = toEastTypeValue(ExecutionEventType) as { type: string; value: { name: string }[] };
    assert.equal(typeValue.type, 'Variant');
    assert.deepEqual(
      typeValue.value.map((c) => c.name),
      [
        'execution_cancelled',
        'execution_completed',
        'execution_started',
        'input_changed',
        'task_completed',
        'task_deferred',
        'task_failed',
        'task_invalidated',
        'task_ready',
        'task_skipped',
        'task_started',
      ],
      'the persisted event wire is frozen — do not change this list without a state-file version/migration story',
    );
  });
});
