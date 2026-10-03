/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a route reads from a query, as a host's own route reads it through the
 * helpers both entries export: a window's offset and limit, refused as the
 * dataset routes refuse them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import * as root from '../index.js';
import * as portable from '../portable.js';
import { badQuery, pathsQuery, wholeQuery } from './query.js';

/** A host's own route over a window, reading its offset and limit as upstream's do. */
function windowRoute(): Hono {
  const app = new Hono();
  app.get('/window', (c) => {
    const read = wholeQuery(c, { offset: 0, limit: 1 });
    return read instanceof Response ? read : c.json(read);
  });
  return app;
}

describe('the query a route reads', () => {
  it('reads a window\'s offset and limit, and refuses one that is no whole number at or above its least', async () => {
    const app = windowRoute();
    assert.deepEqual(await (await app.request('/window?offset=0&limit=5')).json(), { offset: 0, limit: 5 });
    assert.deepEqual(await (await app.request('/window?limit=')).json(), {}, 'a parameter given empty is left out');
    for (const [query, message] of [
      ['limit=0', 'limit must be a positive integer, got "0"'],
      ['offset=-1', 'offset must be a non-negative integer, got "-1"'],
      ['offset=1.5', 'offset must be a non-negative integer, got "1.5"'],
      ['limit=9007199254740993', 'limit must be at most 9007199254740991, got "9007199254740993"'],
    ] as const) {
      const refused = await app.request(`/window?${query}`);
      assert.equal(refused.status, 400, query);
      assert.deepEqual(await refused.json(), { error: { type: 'bad_request', message } }, query);
    }
  });

  it('is read through the helpers both entries export', () => {
    for (const entry of [root, portable]) {
      assert.equal(entry.wholeQuery, wholeQuery);
      assert.equal(entry.badQuery, badQuery);
      assert.equal(entry.pathsQuery, pathsQuery);
    }
  });
});
