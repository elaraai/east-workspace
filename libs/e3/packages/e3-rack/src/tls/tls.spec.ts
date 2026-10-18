/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:https';
import { certificateSha256, createHubCertificate, parseCertificateSha256, pinnedFetch, pinnedHttpsAgent } from './tls.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function serve(certificate = createHubCertificate(), port = 0) {
  const requests: string[] = [];
  const server: Server = createServer({ cert: certificate.certificatePem, key: certificate.privateKeyPem }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push(`${req.method} ${req.url} ${Buffer.concat(chunks).toString()}`);
      if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/plain', 'x-echo': req.headers['x-echo'] ?? '' });
      res.end(`${req.method} ${Buffer.concat(chunks).toString()}`);
    });
  });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  const close = async () => { if (!server.listening) return; server.closeAllConnections(); server.close(); await once(server, 'close'); };
  cleanup.push(close);
  const address = server.address(); assert(address && typeof address !== 'string');
  return { origin: `https://127.0.0.1:${address.port}`, port: address.port, pin: certificateSha256(certificate.certificatePem), requests, close };
}

it('creates a self-signed P-256 certificate naming e3-rack-hub, valid from an hour ago for ten years', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const { certificatePem, privateKeyPem } = createHubCertificate(now);
  const certificate = new X509Certificate(certificatePem);
  assert.equal(certificate.subject, 'CN=e3 rack hub');
  assert.equal(certificate.issuer, certificate.subject);
  assert.equal(certificate.subjectAltName, 'DNS:e3-rack-hub');
  assert.equal(certificate.ca, false);
  assert.equal(certificate.publicKey.asymmetricKeyDetails?.namedCurve, 'prime256v1');
  assert(certificate.checkPrivateKey(createPrivateKey(privateKeyPem)));
  assert(certificate.verify(certificate.publicKey));
  assert.equal(new Date(certificate.validFrom).getTime(), now.getTime() - 3_600_000);
  assert.equal(new Date(certificate.validTo).getTime(), now.getTime() + 3650 * 86_400_000);
  assert.notEqual(certificateSha256(createHubCertificate(now).certificatePem), certificateSha256(certificatePem));
});

it('writes a validity past 2049 as GeneralizedTime', () => {
  const certificate = new X509Certificate(createHubCertificate(new Date('2045-06-01T00:00:00Z')).certificatePem);
  assert.equal(new Date(certificate.validTo).getUTCFullYear(), 2055);
});

it('reads a fingerprint with or without colons, in either case, and refuses anything else', () => {
  const pin = certificateSha256(createHubCertificate().certificatePem);
  assert.match(pin, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(parseCertificateSha256(pin.toLowerCase()), pin);
  assert.equal(parseCertificateSha256(` ${pin.replaceAll(':', '')} `), pin);
  for (const bad of ['', pin.slice(3), `${pin}:00`, pin.replace(/^../, 'ZZ')]) assert.throws(() => parseCertificateSha256(bad), /64 hex digits/);
});

it('fetches through the pinned certificate, with headers, bodies and empty responses', async () => {
  const hub = await serve();
  const fetch = pinnedFetch(hub.pin);
  const posted = await fetch(`${hub.origin}/echo`, { method: 'POST', headers: { 'x-echo': 'yes' }, body: new TextEncoder().encode('payload') });
  assert.equal(posted.status, 200);
  assert.equal(posted.headers.get('x-echo'), 'yes');
  assert.equal(await posted.text(), 'POST payload');
  const streamed = await fetch(`${hub.origin}/stream`, { method: 'PUT', body: new Blob(['streamed']).stream(), duplex: 'half' } as RequestInit);
  assert.equal(await streamed.text(), 'PUT streamed');
  const empty = await fetch(`${hub.origin}/empty`);
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), '');
});

it('refuses another certificate before any request reaches it, and refuses plain HTTP', async () => {
  const hub = await serve();
  const other = certificateSha256(createHubCertificate().certificatePem);
  await assert.rejects(pinnedFetch(other)(`${hub.origin}/secret`, { method: 'POST', body: 'token' }), /not the pinned/);
  await assert.rejects(pinnedHttpsAgent(hub.origin, other), /not the pinned/);
  assert.deepEqual(hub.requests, [], 'nothing was sent to the wrong certificate');
  await assert.rejects(pinnedFetch(hub.pin)('http://127.0.0.1:1/x'), /https:\/\//);
  await assert.rejects(pinnedHttpsAgent('http://127.0.0.1:1', hub.pin), /https:\/\//);
  // An unpinned client refuses the self-signed certificate outright.
  await assert.rejects(globalThis.fetch(`${hub.origin}/secret`));
  assert.deepEqual(hub.requests, []);
});

it('refuses an origin it trusted once that origin presents another certificate', async () => {
  const first = await serve();
  const fetch = pinnedFetch(first.pin);
  // A connection kept alive would outlive the server; the next request must handshake again.
  assert.equal((await fetch(`${first.origin}/a`, { headers: { connection: 'close' } })).status, 200);
  await first.close();
  const replaced = await serve(createHubCertificate(), first.port);
  await assert.rejects(fetch(`${replaced.origin}/b`, { method: 'POST', body: 'token' }), /other than the pinned SHA-256/);
  assert.deepEqual(replaced.requests, [], 'the agent the first certificate made refuses the second');
});
