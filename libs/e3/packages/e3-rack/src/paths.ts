/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The hashed machine credentials, under the rack home. */
export const IDENTITY_FILE = 'identity.beast2';
/** The enrolled machines and their security policy. */
export const RACKS_FILE = 'racks.beast2';
/** The hub's listening address and advertised origin. */
export const HUB_CONFIG_FILE = 'hub-config.beast2';
/** The single hub's ownership record. */
export const HUB_LOCK_FILE = 'hub.lock';
/** The hub process's diagnostic log. */
export const HUB_LOG_FILE = 'hub.log';

/**
 * Resolves this user's rack home, respecting `E3_RACK_HOME`.
 * @returns An absolute path
 * @example
 * const home = rackHome();
 */
export function rackHome(): string {
  return resolve(process.env.E3_RACK_HOME ?? join(homedir(), '.e3', 'rack'));
}

/**
 * Creates the private rack home, tightening its existing permissions too.
 * @param home - The rack home (default: this user's)
 * @returns Its path
 * @example
 * const home = ensureRackHome();
 */
export function ensureRackHome(home = rackHome()): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(home, 0o700);
  return home;
}

/**
 * Checks a socket path against the shortest supported Unix socket limit.
 * @param path - The socket's path
 * @throws {Error} When it exceeds 100 bytes on POSIX
 * @example
 * socketPathOk('/tmp/e3r/hub.sock');
 */
export function socketPathOk(path: string): void {
  if (process.platform !== 'win32' && Buffer.byteLength(path) > 100) {
    throw new Error('Rack socket path exceeds 100 bytes; set E3_RACK_HOME to a shorter path');
  }
}

/**
 * Names this rack home's hub socket or Windows named pipe.
 * @param home - The rack home
 * @returns Its socket path
 * @example
 * const socket = hubSocketPath(rackHome());
 */
export function hubSocketPath(home = rackHome()): string {
  const path = process.platform === 'win32'
    ? `\\\\.\\pipe\\e3-rack-hub-${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 12)}`
    : join(home, 'hub.sock');
  socketPathOk(path);
  return path;
}

/**
 * Names a fresh session socket or Windows named pipe.
 * @param home - The rack home
 * @returns Its socket path
 * @example
 * const socket = sessionSocketPath(rackHome());
 */
export function sessionSocketPath(home = rackHome()): string {
  const id = randomBytes(6).toString('hex');
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\e3-rack-s-${id}` : join(home, `s-${id}.sock`);
  socketPathOk(path);
  return path;
}
