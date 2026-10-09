/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { join } from 'node:path';
import { decodeBeast2For, encodeBeast2For, none } from '@elaraai/east';
import { ensureRackHome, HUB_CONFIG_FILE, rackHome } from '../paths.js';
import { readStateFile, writeStateFile } from '../state-file.js';

import { HubConfigType, type HubConfig } from '../protocol/control.js';
export { HubConfigType, type HubConfig } from '../protocol/control.js';

/** Creates independent defaults with external access disabled. */
export function defaultHubConfig(): HubConfig {
  return { listen: none, allow: [], idleExitMinutes: 15n, advertiseUrl: none };
}

/** Validates addresses and finite timers before changing a running hub. */
export function validateHubConfig(config: HubConfig): void {
  if (config.listen.type === 'some') {
    if (!config.listen.value.host.trim()) throw new Error('Rack listen host is empty');
    const port = Number(config.listen.value.port);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Rack listen port must be 0–65535');
  }
  const minutes = Number(config.idleExitMinutes);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 35_000) throw new Error('Rack idle timeout must be 0–35000 minutes');
  if (config.advertiseUrl.type === 'some') {
    const url = new URL(config.advertiseUrl.value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Rack advertise URL must be an HTTP(S) origin without credentials, path or query');
    }
  }
}

/**
 * Reads the hub configuration, using defaults only when it is absent.
 * @param home - Private rack home
 * @returns The validated configuration
 * @throws {Error} When state is corrupt or requires a newer release
 * @example
 * const config = await loadHubConfig();
 */
export async function loadHubConfig(home = rackHome()): Promise<HubConfig> {
  const bytes = await readStateFile(join(home, HUB_CONFIG_FILE));
  const config = bytes === null ? defaultHubConfig() : decodeBeast2For(HubConfigType)(bytes);
  validateHubConfig(config);
  return config;
}

/**
 * Atomically persists a validated configuration in the private rack home.
 * @param config - Configuration to persist
 * @param home - Private rack home
 * @example
 * await saveHubConfig(config);
 */
export async function saveHubConfig(config: HubConfig, home = rackHome()): Promise<void> {
  validateHubConfig(config);
  ensureRackHome(home);
  await writeStateFile(join(home, HUB_CONFIG_FILE), encodeBeast2For(HubConfigType)(config));
}
