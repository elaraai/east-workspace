/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The IndexedDB records' open, held up by a connection elsewhere — which a
 * browser's own database at this version never is, so an IndexedDB in place
 * of the browser's says it: the open is refused, naming why, once the
 * connection has not closed in the time given, rather than left waiting; one
 * that goes through within it is answered; and a connection that opens after
 * the open was refused is closed. The adapter itself runs its contract in
 * Chromium (`browser/storage.spec.ts`), where a deletion held up by a
 * connection that does not close is refused too.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openIndexedDbRecords } from './indexeddb.js';

/** An open request an IndexedDB in place of the browser's answers, as a test
 *  says. */
class HeldOpenRequest {
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onblocked: ((event: IDBVersionChangeEvent) => void) | null = null;
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;
  result: unknown = undefined;
  error: DOMException | null = null;
}

/** An IndexedDB in place of the browser's, whose open requests a test answers. */
function heldFactory(): { readonly factory: IDBFactory; request(): HeldOpenRequest } {
  let request: HeldOpenRequest | undefined;
  const factory = {
    open: () => {
      request = new HeldOpenRequest();
      return request;
    },
  } as unknown as IDBFactory;
  return {
    factory,
    request: () => {
      if (request === undefined) throw new Error('nothing was opened');
      return request;
    },
  };
}

describe('the IndexedDB records\' open', () => {
  it('answers an open held up only while a connection elsewhere finishes closing', async () => {
    const held = heldFactory();
    const opening = openIndexedDbRecords('e3', { factory: held.factory, blockedMs: 60_000 });
    const request = held.request();
    request.onblocked?.({ oldVersion: 0, newVersion: 1 } as IDBVersionChangeEvent);
    // The other connection's last transaction finishes, and it closes.
    let closed = 0;
    request.result = { close: () => closed++ };
    request.onsuccess?.(new Event('success'));
    const records = await opening;
    assert.equal(closed, 0, 'the connection opened is the records\'');
    await records.close();
  });

  it('refuses to open a database a connection elsewhere holds at an older version, naming why, and closes the connection that opens after', async () => {
    const held = heldFactory();
    const opening = openIndexedDbRecords('e3', { factory: held.factory, blockedMs: 10 });
    const request = held.request();
    assert.ok(request.onblocked !== null, 'the open hears that it is held up');
    request.onblocked({ oldVersion: 0, newVersion: 1 } as IDBVersionChangeEvent);
    await assert.rejects(opening, {
      message: /^IndexedDB cannot open the database 'e3': a connection elsewhere — another tab of this site, say — has it open at version 0, and has not closed it for version 1: close the site's other tabs, and open it again$/,
    });

    // The other connection closes, and the open goes through: nothing keeps
    // what it opens.
    let closed = 0;
    request.result = { close: () => closed++ };
    request.onsuccess?.(new Event('success'));
    assert.equal(closed, 1, 'the connection that opened after the open was refused is closed');
  });
});
