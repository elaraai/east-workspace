/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { decodeAsyncEastIR, decodeEastIR, walkIR, type IR } from '@elaraai/east';

/** Platform families that depend on host state or network access. */
export const HOST_COUPLED_PREFIXES = [
  'fs_', // Host files and directories.
  'env_', // Host environment variables and process state.
  'sqlite_', 'access_', // Local database files.
  'fetch_', 's3_', // HTTP and object storage.
  'postgres_', 'mysql_', 'redis_', 'mongodb_', // Network database services.
  'ftp_', 'sftp_', // Remote files.
] as const;

// These are exact names: json_open_text reads an argument, not a host file.
const HOST_COUPLED_NAMES = new Set(['json_open', 'json_value', 'path_resolve']);

/**
 * Collects every called platform name, including nested functions/dead branches.
 * @param bytes - A sync or async East IR envelope
 * @returns Sorted, distinct platform names
 * @throws When neither envelope decodes
 * @example
 * const platforms = collectPlatformNames(await storage.objects.read(repo, program));
 */
export function collectPlatformNames(bytes: Uint8Array): string[] {
  let ir: IR;
  try { ir = decodeAsyncEastIR(bytes).ir as unknown as IR; }
  catch { ir = decodeEastIR(bytes).ir as unknown as IR; }
  const names = new Set<string>();
  walkIR(ir, (node) => { if (node.type === 'Platform') names.add(node.value.name); });
  return [...names].sort();
}

/**
 * Selects platform calls whose host dependencies are unavailable in a guest.
 * @param names - The program's platform names
 * @returns Blocked names in input order
 * @example
 * hostCoupledPlatforms(['console_log', 'env_get']); // ['env_get']
 */
export function hostCoupledPlatforms(names: Iterable<string>): string[] {
  return [...names].filter((name) => HOST_COUPLED_NAMES.has(name) || HOST_COUPLED_PREFIXES.some((prefix) => name.startsWith(prefix)));
}

const scans = new Map<string, Promise<readonly string[]>>();

/** Reads and scans an immutable IR object once per process, bounded to 4096. @internal */
export function scanProgram(hash: string, read: () => Promise<Uint8Array>): Promise<readonly string[]> {
  let result = scans.get(hash);
  if (result === undefined) {
    if (scans.size >= 4096) scans.clear();
    result = read().then((bytes) => hostCoupledPlatforms(collectPlatformNames(bytes)));
    scans.set(hash, result);
    void result.catch(() => { if (scans.get(hash) === result) scans.delete(hash); });
  }
  return result;
}
