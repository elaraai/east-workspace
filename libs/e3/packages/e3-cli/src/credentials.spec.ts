/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A server's token as a command sends it: refreshed near its expiry, one
 * refresh at a time for a server, the login kept through a refresh that fails
 * to be answered and removed by one the token endpoint refuses, unless another
 * process renewed it meanwhile. The token endpoint is the test's own, and
 * rotates its refresh tokens: one used twice is refused.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCredential, getValidToken, setCredential } from './credentials.js';

const SERVER = 'https://e3.example.com';

/** How the test's token endpoint answers a refresh. */
type Answer = 'rotate' | 'unavailable';

describe('getValidToken', () => {
  let dir: string;
  let kept: string | undefined;
  let fetched: typeof globalThis.fetch;
  /** The refresh tokens the endpoint was sent, in order. */
  let sent: string[];
  let answer: Answer;
  /** The refresh token the endpoint takes next. */
  let current: string;
  /** What happens as the endpoint is asked, before it answers: another process's doing. */
  let meanwhile: () => void;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-credentials-'));
    kept = process.env.E3_CREDENTIALS_PATH;
    process.env.E3_CREDENTIALS_PATH = join(dir, 'credentials.json');
    fetched = globalThis.fetch;
    sent = [];
    answer = 'rotate';
    current = 'refresh-1';
    meanwhile = () => undefined;
    globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ token_endpoint: `${SERVER}/token` });
      // Answered a turn later, as a request over a network is
      await new Promise((resolve) => { setImmediate(resolve); });
      const refresh = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      sent.push(refresh);
      meanwhile();
      if (answer === 'unavailable') return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
      if (refresh !== current) return Response.json({ error: 'invalid_grant', error_description: 'the refresh token was used' }, { status: 400 });
      current = `refresh-${sent.length + 1}`;
      return Response.json({ access_token: `access-${sent.length + 1}`, refresh_token: current, token_type: 'Bearer', expires_in: 3600 });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetched;
    if (kept === undefined) delete process.env.E3_CREDENTIALS_PATH;
    else process.env.E3_CREDENTIALS_PATH = kept;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Logs in with a token that expires `inMs` from now. */
  const login = (inMs: number): void => {
    setCredential(SERVER, { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + inMs).toISOString() });
  };

  it('sends a token that has more than a minute left as it is', async () => {
    login(10 * 60_000);
    assert.equal(await getValidToken(SERVER), 'access-1');
    assert.deepEqual(sent, []);
  });

  it('refreshes once for requests that find the token near its expiry together: each sends the new token, and the login stands', async () => {
    login(30_000);
    const tokens = await Promise.all([getValidToken(SERVER), getValidToken(SERVER), getValidToken(SERVER), getValidToken(`${SERVER}/`)]);
    assert.deepEqual(tokens, ['access-2', 'access-2', 'access-2', 'access-2']);
    assert.deepEqual(sent, ['refresh-1'], 'the refresh token was used once');
    assert.deepEqual([getCredential(SERVER)?.accessToken, getCredential(SERVER)?.refreshToken], ['access-2', 'refresh-2']);

    // The refresh over, the next one near an expiry refreshes again
    setCredential(SERVER, { ...getCredential(SERVER)!, expiresAt: new Date(Date.now() + 30_000).toISOString() });
    assert.equal(await getValidToken(SERVER), 'access-3');
    assert.deepEqual(sent, ['refresh-1', 'refresh-2']);
  });

  it('keeps the login through a refresh that fails to be answered: a token not yet expired serves, and an expired one says to run again', async () => {
    answer = 'unavailable';
    login(30_000);
    assert.equal(await getValidToken(SERVER), 'access-1', 'the token has 30 seconds left');
    assert.equal(getCredential(SERVER)?.refreshToken, 'refresh-1', 'the login is kept');

    login(-1_000);
    await assert.rejects(getValidToken(SERVER), /^Error: Session expired and its refresh failed: .*temporarily_unavailable.*The login is kept: run the command again$/);
    assert.equal(getCredential(SERVER)?.refreshToken, 'refresh-1');

    // The endpoint answers again: the same login refreshes
    answer = 'rotate';
    assert.equal(await getValidToken(SERVER), 'access-4');
  });

  it('ends the session when the endpoint refuses the refresh token: the login is removed, and the error says to log in', async () => {
    login(30_000);
    current = 'another';
    await assert.rejects(getValidToken(SERVER), /^Error: Session expired and refresh failed: .*invalid_grant.*Run: e3 login https:\/\/e3\.example\.com$/);
    assert.equal(getCredential(SERVER), null);
  });

  it('keeps a login another process renewed while this one\'s refresh was refused: the token that process stored is sent, and the login stands', async () => {
    login(30_000);
    // Another process sharing the credentials file refreshed first: the endpoint rotated the token this one holds,
    // and that process stored the login it was given
    const renewed = { accessToken: 'access-theirs', refreshToken: 'refresh-theirs', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    current = renewed.refreshToken;
    meanwhile = () => setCredential(SERVER, renewed);
    assert.equal(await getValidToken(SERVER), 'access-theirs');
    assert.deepEqual(sent, ['refresh-1'], 'the refused refresh was not asked again');
    assert.deepEqual(getCredential(SERVER), renewed, 'the other process\'s login is kept');

    // One that process stored near its own expiry is refreshed in its turn, with its refresh token
    meanwhile = () => undefined;
    login(30_000);
    meanwhile = () => {
      meanwhile = () => undefined;
      setCredential(SERVER, { ...renewed, expiresAt: new Date(Date.now() + 30_000).toISOString() });
    };
    assert.equal(await getValidToken(SERVER), 'access-4');
    assert.deepEqual(sent.slice(1), ['refresh-1', 'refresh-theirs']);
    assert.equal(getCredential(SERVER)?.refreshToken, 'refresh-4');
  });
});
