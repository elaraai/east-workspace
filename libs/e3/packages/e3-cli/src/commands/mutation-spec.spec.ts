/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arityRefusal, parseMutationSpec } from './mutation-spec.js';

describe('parseMutationSpec', () => {
  it('splits a record and its mutation on the final dot', () => {
    assert.deepEqual(parseMutationSpec('jobs.patch'), { record: 'jobs', mutation: 'patch' });
    assert.deepEqual(parseMutationSpec('plant.jobs.move'), { record: 'plant.jobs', mutation: 'move' });
  });

  it('refuses a spec with no dot, or with nothing on one side of it', () => {
    for (const spec of ['jobs', '.patch', 'jobs.', '']) {
      assert.throws(() => parseMutationSpec(spec), (err: Error) => err.message === `Invalid mutation specifier '${spec}'. Expected '<record>.<mutation>'.`);
    }
  });
});

describe('arityRefusal', () => {
  it('passes the number of arguments a mutation takes, and refuses any other', () => {
    assert.equal(arityRefusal('add', { form: 'reduce', argTypes: [null] }, 1), null);
    assert.equal(arityRefusal('add', { form: 'reduce', argTypes: [null] }, 2), "Mutation 'add' expects 1 argument(s), got 2");
  });

  it('says what the one argument of a patch mutation is', () => {
    assert.equal(arityRefusal('patch', { form: 'patch', argTypes: [null] }, 0),
      "Mutation 'patch' expects 1 argument(s), got 0 — a patch mutation takes one argument, the record's patch (a .beast2/.json/.east file, or an .east literal)");
  });
});
