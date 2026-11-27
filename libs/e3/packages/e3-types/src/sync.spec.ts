/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A sync's selection and description: their round trips, and a bundle's head
 * refused as a description.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, decodeBeast2For, encodeBeast2For, equalFor, toEastTypeValue, variant } from '@elaraai/east';
import { SyncDescriptionType, SyncSelectionType, type SyncDescription, type SyncSelection } from './sync.js';
import { WorkspaceBundleHeadType, type WorkspaceBundleHead } from './bundle.js';
import type { DatasetRef } from './dataset-ref.js';
import type { Structure } from './structure.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_T = 'c'.repeat(64);

const integer = (writable: boolean): Structure => variant('value', { type: toEastTypeValue(IntegerType), writable });

/** `inputs.a`, `inputs.b`, and the output of `double`. */
const structure: Structure = variant('struct', new Map([
  ['inputs', variant('struct', new Map([['a', integer(true)], ['b', integer(true)]]))],
  ['tasks', variant('struct', new Map([['double', variant('struct', new Map([['output', integer(false)]]))]]))],
]));

const description: SyncDescription = {
  release: '1.0.117',
  origin: { name: 'flow', version: '1.0.0', hash: HASH_B },
  package: {
    tasks: new Map([['double', HASH_T]]),
    data: { structure, refs: new Map() },
    functions: new Map(),
    records: new Map(),
    sources: new Map(),
  },
  deployedAt: new Date('2026-11-27T00:00:00.000Z'),
  datasets: new Map<string, DatasetRef>([
    ['inputs/a', variant('value', { hash: HASH_A, versions: new Map([['.inputs.a', HASH_A]]) })],
    ['inputs/b', variant('unassigned', null)],
  ]),
  executions: [],
};

describe('SyncDescriptionType', () => {
  it('round-trips a description of one task, one value dataset and one unassigned', () => {
    const bytes = encodeBeast2For(SyncDescriptionType)(description);
    const back = decodeBeast2For(SyncDescriptionType)(bytes);
    assert.ok(equalFor(SyncDescriptionType)(back, description));
  });

  it('refuses a workspace bundle\'s head as a description', () => {
    const head: WorkspaceBundleHead = {
      package: description.origin,
      deployedAt: description.deployedAt,
      datasets: description.datasets,
      executions: [],
    };
    const bytes = encodeBeast2For(WorkspaceBundleHeadType)(head);
    assert.throws(() => decodeBeast2For(SyncDescriptionType)(bytes));
  });
});

describe('SyncSelectionType', () => {
  const roundTrip = (selection: SyncSelection): void => {
    const back = decodeBeast2For(SyncSelectionType)(encodeBeast2For(SyncSelectionType)(selection));
    assert.ok(equalFor(SyncSelectionType)(back, selection));
  };

  it('round-trips a full selection', () => {
    roundTrip(variant('full', null));
  });

  it('round-trips a partial selection of tasks, bindings and a record\'s use', () => {
    roundTrip(variant('partial', {
      tasks: ['double', 'triple'],
      binds: {
        paths: [[variant('field', 'inputs'), variant('field', 'a')]],
        functions: ['score'],
        records: ['jobs'],
        pages: [[variant('field', 'inputs'), variant('field', 'b')]],
      },
      records: [{ record: 'jobs', mutations: ['edit'], indexes: ['byStatus'] }],
    }));
  });
});
