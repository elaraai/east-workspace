/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a reader is handed of an input, given what it read of the input's
 * dataset: the one rule a run, a status, a collection's history and a
 * function's call decide by. Each case is titled by the requirement of the
 * composite-records design it checks.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, encodeBeast2For } from '@elaraai/east';
import { taskInputRead } from './input-read.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';

const REPO = 'r';
/** A state no store holds: reading it would fail. */
const UNHELD = 'a'.repeat(64);

describe('what a reader is handed of an input, given what it read of its dataset', () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.repos.create(REPO);
  });

  it('R27 — a composite record that waits for a first delivery is not read, naming the sources yet to deliver in the words a status gives', async () => {
    assert.deepEqual(await taskInputRead(storage, REPO, '.records.orders', { hash: UNHELD, pending: ['erp', 'wms'] }, null),
      { waiting: 'record \'orders\' waits for the first delivery of erp, wms', pending: ['erp', 'wms'] });
  });

  it('R83 — an index of such a record waits the same way, before the index is looked for: its state is not read', async () => {
    assert.deepEqual(await taskInputRead(storage, REPO, '.records.orders', { hash: UNHELD, pending: ['erp'] }, 'by_customer'),
      { waiting: 'record \'orders\' waits for the first delivery of erp', pending: ['erp'] });
    // Once nothing is pending, the same read looks for the index in the state, which no store holds
    await assert.rejects(taskInputRead(storage, REPO, '.records.orders', { hash: UNHELD, pending: [] }, 'by_customer'));
  });

  it('R27 — a dataset that waits for nothing is handed as the object it holds, and an index its state does not hold waits for a deploy, naming no source', async () => {
    const hash = await storage.objects.write(REPO, encodeBeast2For(IntegerType)(7n));
    const held = { hash, pending: [] };
    assert.deepEqual(await taskInputRead(storage, REPO, '.inputs.count', held, null), { object: hash });
    assert.deepEqual(await taskInputRead(storage, REPO, '.records.jobs', held, 'by_press'), {
      waiting: 'Input \'.records.jobs\': the record .records.jobs holds no index \'by_press\' at the state it stands at: '
        + 'deploy the package that declares the index again, which builds it',
    });
  });
});
