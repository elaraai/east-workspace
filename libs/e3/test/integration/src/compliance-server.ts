/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local server the API compliance specs run the shared e3-api-tests
 * suites against, and the tokens they call it with.
 *
 * The server checks every request's token, as a deployed server does: the
 * suites run as an `admin`, and their reader cases as a caller with no role.
 */

import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer, generateKeyPair, signJwt, type KeyPair } from '@elaraai/e3-api-server';

/** Whom the harness's tokens name as their issuer and audience, which the
 *  server checks. */
const ISSUER = 'e3-api-compliance';
const AUDIENCE = 'e3-api-compliance';

/** A running compliance server, and what its callers call it with. */
export interface ComplianceServer {
  /** Where the server answers. */
  baseUrl: string;
  /** An `admin`'s token, which runs any one-shot. */
  adminToken: string;
  /** A token with no role: a reader, whose one-shots are platform-free. */
  readerToken: string;
  /** A credentials file holding the admin's token for the server, which the
   *  CLI suites run with. */
  credentialsPath: string;
  /** Stops the server and removes its repositories. */
  stop: () => Promise<void>;
}

/**
 * A token signed with the key pair the server checks, valid for the run.
 *
 * @param keys - The key pair whose public key the server holds
 * @param sub - Whom the token names
 * @param roles - The caller's roles, when it has any
 * @returns The signed token
 */
function signToken(keys: KeyPair, sub: string, roles?: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub, iss: ISSUER, aud: AUDIENCE, iat: now, nbf: now, exp: now + 4 * 3600, ...(roles && { roles }) }, keys);
}

/**
 * Start a compliance server over a fresh directory of repositories.
 *
 * @returns The running server, its callers' tokens, and how to stop it
 */
export async function startComplianceServer(): Promise<ComplianceServer> {
  const parentDir = mkdtempSync(join(tmpdir(), 'e3-compliance-'));
  const tempDir = join(parentDir, 'test');
  mkdirSync(tempDir, { recursive: true });

  const reposDir = join(tempDir, 'repos');
  mkdirSync(reposDir, { recursive: true });

  // The server holds the public key, as it holds an identity provider's
  const keys = generateKeyPair();
  const publicKeyPath = join(tempDir, 'public.pem');
  writeFileSync(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const adminToken = signToken(keys, 'admin', ['admin']);
  const readerToken = signToken(keys, 'reader');

  const server = await createServer({
    reposDir,
    port: 0,
    host: 'localhost',
    auth: { publicKeyPath, issuer: ISSUER, audience: AUDIENCE },
    // Small parts and no commit wait, so the suites' megabyte-sized uploads
    // go through the protocol's multi-part path and a polled commit.
    transferPartBytes: 256 * 1024,
    transferCommitWaitMs: 0,
  });
  await server.start();

  const baseUrl = `http://localhost:${server.port}`;
  // The CLI suites run as the admin
  const credentialsPath = join(tempDir, 'credentials.json');
  writeFileSync(credentialsPath, JSON.stringify({
    version: 1,
    credentials: {
      [baseUrl]: {
        accessToken: adminToken,
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    },
  }, null, 2));

  return {
    baseUrl,
    adminToken,
    readerToken,
    credentialsPath,
    stop: async () => {
      await server.stop();
      try {
        rmSync(parentDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}
