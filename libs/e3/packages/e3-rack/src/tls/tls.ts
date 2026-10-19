/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { Agent, request } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { connect } from 'node:tls';

// A hub's certificate is trusted by its SHA-256 fingerprint, which the hub
// prints at enrollment, never by a name or a public authority: a rack reaches
// its hub through whatever address a tunnel or relay gives it, and that
// address is not the hub's. So the certificate names only `e3-rack-hub`, lives
// ten years, and is replaced only on purpose (every pin must then change).

/** A hub's self-signed certificate and its private key, both PEM. */
export interface HubCertificate {
  /** The X.509 certificate a rack pins by its SHA-256 fingerprint. */
  certificatePem: string;
  /** The PKCS#8 private key; it never leaves the hub's private state. */
  privateKeyPem: string;
}

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const der = (tag: number, ...contents: Buffer[]): Buffer => {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...contents: Buffer[]) => der(0x30, ...contents);
const oid = (dotted: string): Buffer => {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const out = [40 * first! + second!];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let high = Math.floor(arc / 128); high > 0; high = Math.floor(high / 128)) groups.unshift(0x80 | (high & 0x7f));
    out.push(...groups);
  }
  return der(0x06, Buffer.from(out));
};
const positiveInteger = (bytes: Buffer): Buffer => {
  let value = bytes;
  while (value.length > 1 && value[0] === 0 && (value[1]! & 0x80) === 0) value = value.subarray(1);
  return der(0x02, (value[0]! & 0x80) === 0 ? value : Buffer.concat([Buffer.from([0]), value]));
};
const time = (date: Date): Buffer => {
  const iso = date.toISOString();
  const rest = `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  const year = date.getUTCFullYear();
  // RFC 5280 §4.1.2.5: UTCTime through 2049, GeneralizedTime from 2050.
  return year < 2050 ? der(0x17, Buffer.from(`${String(year).slice(2)}${rest}`)) : der(0x18, Buffer.from(`${year}${rest}`));
};
const pem = (label: string, bytes: Buffer) => `-----BEGIN ${label}-----\n${bytes.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;

/**
 * Creates a hub's self-signed ECDSA P-256 certificate, valid from an hour ago
 * (a rack's clock may lag) for ten years, naming `e3-rack-hub` only.
 * @param now - The issue time
 * @returns The certificate and its private key
 * @example
 * const { certificatePem, privateKeyPem } = createHubCertificate();
 */
export function createHubCertificate(now = new Date()): HubCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecdsaWithSha256 = sequence(oid('1.2.840.10045.4.3.2'));
  const name = sequence(der(0x31, sequence(oid('2.5.4.3'), der(0x0c, Buffer.from('e3 rack hub')))));
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const extensions = sequence(
    sequence(oid('2.5.29.19'), der(0x01, Buffer.from([0xff])), der(0x04, sequence())), // basicConstraints, critical: not a CA
    sequence(oid('2.5.29.17'), der(0x04, sequence(der(0x82, Buffer.from('e3-rack-hub'))))), // subjectAltName dNSName
  );
  const tbs = sequence(
    der(0xa0, positiveInteger(Buffer.from([2]))), positiveInteger(serial), ecdsaWithSha256, name,
    sequence(time(new Date(now.getTime() - 3_600_000)), time(new Date(now.getTime() + 3650 * 86_400_000))), name,
    publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, extensions),
  );
  const certificate = sequence(tbs, ecdsaWithSha256, der(0x03, Buffer.from([0]), sign('sha256', tbs, privateKey)));
  return { certificatePem: pem('CERTIFICATE', certificate), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

/**
 * The SHA-256 fingerprint a rack pins: uppercase hex pairs joined by colons,
 * as `openssl x509 -fingerprint -sha256` prints it.
 * @param certificatePem - A PEM certificate
 * @returns Its fingerprint
 * @example
 * console.log(certificateSha256(certificatePem)); // 'AB:CD:…'
 */
export function certificateSha256(certificatePem: string): string {
  return new X509Certificate(certificatePem).fingerprint256;
}

/**
 * Reads a pinned fingerprint as an operator writes it: 64 hex digits, with or
 * without colons, in either case.
 * @param text - The fingerprint
 * @returns It in {@link certificateSha256}'s form
 * @throws {Error} When it is not a SHA-256 fingerprint
 * @example
 * parseCertificateSha256('abcd…'); // 'AB:CD:…'
 */
export function parseCertificateSha256(text: string): string {
  const hex = text.trim().replaceAll(':', '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error('A certificate SHA-256 fingerprint is 64 hex digits, colons optional');
  return hex.match(/../g)!.join(':');
}

/** Reads the certificate a TLS server presents, sending no application data. */
function presentedCertificate(host: string, port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, rejectUnauthorized: false, ...(isIP(host) === 0 ? { servername: host } : {}) }, () => {
      const raw = socket.getPeerCertificate(true).raw;
      socket.destroy();
      if (raw === undefined) reject(new Error(`${host}:${port} presented no certificate`));
      else resolve(pem('CERTIFICATE', raw));
    });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`TLS handshake with ${host}:${port} timed out`)));
    socket.once('error', reject);
  });
}

/**
 * Makes an HTTPS agent that trusts exactly the certificate whose SHA-256 is
 * pinned. A first handshake, which sends nothing, reads the certificate the
 * origin presents; it is refused unless its fingerprint is the pin. Every
 * request then verifies the server against that certificate alone, and its
 * fingerprint again, so a different certificate is refused before any
 * request or credential is written.
 * @param origin - An https:// origin
 * @param certificateSha256 - The pinned fingerprint
 * @param timeoutMs - The first handshake's deadline
 * @returns The agent
 * @throws {Error} When the origin is not HTTPS or presents another certificate
 * @example
 * const agent = await pinnedHttpsAgent('https://10.0.0.2:7331', pin);
 */
export async function pinnedHttpsAgent(origin: string, certificateSha256: string, timeoutMs = 10_000): Promise<Agent> {
  const url = new URL(origin);
  if (url.protocol !== 'https:') throw new Error(`A pinned certificate needs an https:// origin, not ${url.protocol}`);
  const pin = parseCertificateSha256(certificateSha256);
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const presented = await presentedCertificate(host, Number(url.port || 443), timeoutMs);
  const found = new X509Certificate(presented).fingerprint256;
  if (found !== pin) throw new Error(`${url.host} presented certificate SHA-256 ${found}, not the pinned ${pin}`);
  return new Agent({ ca: presented, keepAlive: true, checkServerIdentity: (_host, certificate) =>
    certificate.fingerprint256 === pin ? undefined : Object.assign(new Error(`${url.host} presented certificate SHA-256 ${certificate.fingerprint256}, not the pinned ${pin}`), { code: 'ERR_RACK_CERTIFICATE_PIN' }) });
}

/** OpenSSL's refusals of a server certificate that is not the pinned one, and the pin's own. */
const CERTIFICATE_REFUSALS = new Set(['ERR_RACK_CERTIFICATE_PIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_SIGNATURE_FAILURE']);

/**
 * A fetch that reaches HTTPS origins only through {@link pinnedHttpsAgent},
 * one agent per origin; any other scheme is refused.
 * @param certificateSha256 - The pinned fingerprint
 * @returns A fetch-compatible function
 * @throws {Error} When the fingerprint is malformed
 * @example
 * const response = await pinnedFetch(pin)('https://10.0.0.2:7331/api/rack/heartbeat', { method: 'POST', body });
 */
export function pinnedFetch(certificateSha256: string): typeof fetch {
  const pin = parseCertificateSha256(certificateSha256);
  const agents = new Map<string, Promise<Agent>>();
  const agentFor = (url: URL): Promise<Agent> => {
    let agent = agents.get(url.origin);
    if (agent === undefined) {
      agent = pinnedHttpsAgent(url.origin, pin);
      agents.set(url.origin, agent);
      agent.catch(() => { agents.delete(url.origin); });
    }
    return agent;
  };
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.protocol !== 'https:') throw new TypeError(`A pinned certificate needs an https:// URL, not ${url.protocol}`);
    const agent = await agentFor(url);
    const method = init.method ?? 'GET';
    return new Promise<Response>((resolve, reject) => {
      const req = request(url, { method, agent, headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined }, (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const status = res.statusCode ?? 502;
        const empty = method === 'HEAD' || status === 204 || status === 304;
        if (empty) res.resume();
        resolve(new Response(empty ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage, headers }));
      });
      // A certificate that does not chain to the pinned one is refused by
      // the handshake itself, before the fingerprint is compared: either way
      // it is not the pinned certificate.
      req.once('error', (error: NodeJS.ErrnoException) => reject(error.code !== undefined && CERTIFICATE_REFUSALS.has(error.code)
        ? new Error(`${url.host} presented a certificate other than the pinned SHA-256 ${pin}`, { cause: error })
        : error));
      const body = init.body;
      if (body === undefined || body === null) req.end();
      else if (typeof body === 'string' || body instanceof Uint8Array) req.end(body);
      else if (body instanceof ArrayBuffer) req.end(Buffer.from(body));
      else if (body instanceof ReadableStream) Readable.fromWeb(body as import('node:stream/web').ReadableStream).once('error', (err) => req.destroy(err)).pipe(req);
      else { req.destroy(); reject(new TypeError('A pinned fetch sends a string, bytes or a stream')); }
    });
  };
}
