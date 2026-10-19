/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, decodeBeast2For, encodeBeast2For, equalFor, variant } from '@elaraai/east';
import { ResponseType } from './api.js';
import { BEAST2_CONTENT_TYPE } from './constants.js';
import { beast2Error, beast2Success, decodeBeast2Request } from './beast2-http.js';

const sameAnswer = equalFor(ResponseType(IntegerType));
const decodeAnswer = decodeBeast2For(ResponseType(IntegerType));

describe('beast2 over Request and Response', () => {
  it('decodes a BEAST2 request body and refuses another content type', async () => {
    const body = encodeBeast2For(IntegerType)(42n);
    const request = new Request('http://e3.test/v1', { method: 'POST', headers: { 'content-type': BEAST2_CONTENT_TYPE }, body });
    assert.equal(await decodeBeast2Request(request, IntegerType), 42n);
    const json = new Request('http://e3.test/v1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '42' });
    await assert.rejects(decodeBeast2Request(json, IntegerType), /Expected Content-Type/);
  });

  it('answers success and error envelopes with the status and headers asked for', async () => {
    const ok = beast2Success(IntegerType, 7n, { status: 202, headers: { ETag: '"a"' } });
    assert.equal(ok.status, 202);
    assert.equal(ok.headers.get('content-type'), BEAST2_CONTENT_TYPE);
    assert.equal(ok.headers.get('etag'), '"a"');
    const bytes = new Uint8Array(await ok.arrayBuffer());
    assert.equal(ok.headers.get('content-length'), String(bytes.byteLength));
    assert(sameAnswer(decodeAnswer(bytes), variant('success', 7n)));
    const failed = beast2Error(IntegerType, variant('internal', { message: 'no' }));
    assert.equal(failed.status, 200);
    assert(sameAnswer(decodeAnswer(new Uint8Array(await failed.arrayBuffer())), variant('error', variant('internal', { message: 'no' }))));
  });
});
